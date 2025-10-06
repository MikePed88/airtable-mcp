import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ───────────────────────────────
// Environment setup
// ───────────────────────────────
const port = process.env.PORT || 3000;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

// ───────────────────────────────
// Utility logging helper
// ───────────────────────────────
const log = (msg, ...args) => console.log(`[${new Date().toISOString()}] ${msg}`, ...args);

// ───────────────────────────────
// Authorization middleware
// ───────────────────────────────
app.use((req, res, next) => {
  const token =
    req.headers.authorization?.replace("Bearer ", "") ||
    req.query.access_token ||
    null;
  if (MCP_AUTH_TOKEN && token !== MCP_AUTH_TOKEN) {
    log("❌ Unauthorized access attempt", req.path, token);
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// ───────────────────────────────
// Health check endpoint
// ───────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Airtable MCP server is healthy and reachable",
    timestamp: new Date().toISOString(),
  });
});

// ───────────────────────────────
// JSON-RPC over SSE (core MCP transport)
// ───────────────────────────────
app.all(["/sse", "/mcp/api/v1/sse"], (req, res) => {
  log("🧠 [MCP] Client connected to SSE");
  log("🔹 Method:", req.method);
  log("🔹 Headers:", req.headers);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
  log("📡 [MCP] SSE headers flushed to client");

  // ───────────── Handshake ─────────────
  const handshake = {
    jsonrpc: "2.0",
    id: 0,
    result: {
      type: "handshake",
      protocol: "MCP",
      version: "1.0",
      capabilities: { tools: true, run: true },
    },
  };
  const payload = `data: ${JSON.stringify(handshake)}\n\n`;
  res.write(payload);
  log("📤 [MCP] Sent handshake:", payload.trim());

  // ───────────── Keepalive pings ─────────────
  const interval = setInterval(() => {
    const ping = {
      jsonrpc: "2.0",
      method: "ping",
      params: { t: Date.now() },
    };
    const pingPayload = `data: ${JSON.stringify(ping)}\n\n`;
    res.write(pingPayload);
    log("📤 [MCP] Sent ping:", pingPayload.trim());
  }, 10000);

  // ───────────── Incoming messages ─────────────
  req.on("data", async (chunk) => {
    const raw = chunk.toString().trim();
    log("📥 [MCP] Received from client:", raw);
    try {
      const msg = JSON.parse(raw);

      // 1️⃣ Respond to list_tools
      if (msg.method === "list_tools") {
        const reply = {
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            tools: [
              {
                name: "listBases",
                description: "Fetches Airtable bases via API",
                input_schema: {},
                output_schema: { type: "object" },
              },
              {
                name: "getRecords",
                description: "Fetches records from a base/table",
                input_schema: {
                  type: "object",
                  properties: {
                    baseId: { type: "string" },
                    tableName: { type: "string" },
                  },
                  required: ["baseId", "tableName"],
                },
                output_schema: { type: "object" },
              },
            ],
          },
        };
        res.write(`data: ${JSON.stringify(reply)}\n\n`);
        log("📤 [MCP] Sent list_tools response:", reply);
      }

      // 2️⃣ Respond to run tool
      else if (msg.method === "run" && msg.params?.tool) {
        const { tool, arguments: args } = msg.params;
        log("🔧 [MCP] Running tool:", tool, args);

        let result;
        if (tool === "listBases") {
          const r = await fetch("https://api.airtable.com/v0/meta/bases", {
            headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
          });
          result = await r.json();
        } else if (tool === "getRecords") {
          const { baseId, tableName } = args;
          const r = await fetch(
            `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`,
            { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
          );
          result = await r.json();
        } else {
          result = { error: `Unknown tool: ${tool}` };
        }

        const reply = { jsonrpc: "2.0", id: msg.id, result };
        res.write(`data: ${JSON.stringify(reply)}\n\n`);
        log("📤 [MCP] Sent run response:", reply);
      } else {
        log("⚠️ [MCP] Unknown or unhandled method:", msg.method);
      }
    } catch (err) {
      log("❌ [MCP] Failed to parse JSON-RPC message:", err);
    }
  });

  // ───────────── Connection lifecycle ─────────────
  req.on("aborted", () => log("⚠️ [MCP] Client aborted connection"));
  req.on("error", (err) => log("❌ [MCP] Request error:", err));
  res.on("error", (err) => log("❌ [MCP] Response error:", err));
  req.on("close", () => {
    clearInterval(interval);
    log("❌ [MCP] Client disconnected from SSE");
  });
});

// ───────────────────────────────
// Root sanity check
// ───────────────────────────────
app.get("/", (req, res) => res.send("✅ Airtable MCP server (Make.com compatible) running."));

// ───────────────────────────────
// Start server
// ───────────────────────────────
app.listen(port, () => {
  log(`🚀 MCP server listening on port ${port}`);
});
