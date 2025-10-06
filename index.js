// index.js
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

/// ────────────────────────────────────────────────
//  LOGGING MIDDLEWARE
// ────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log(`🔐 ${req.method} ${req.path}`);
  console.log("Headers:", req.headers.authorization);
  next();
});

// ────────────────────────────────────────────────
//  SIMPLE AUTH  (optional but recommended)
// ────────────────────────────────────────────────
app.use((req, res, next) => {
  // only protect the API routes (skip root GET /)
  if (["/health", "/tools", "/run", "/sse"].includes(req.path)) {
    const token = req.headers.authorization?.replace("Bearer ", "");
    if (AUTH_TOKEN && token !== AUTH_TOKEN) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }
  next();
});

// ────────────────────────────────────────────────
//  HEALTH ENDPOINT
// ────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Airtable MCP server healthy",
    timestamp: new Date().toISOString(),
  });
});

// ────────────────────────────────────────────────
//  TOOL DISCOVERY
// ────────────────────────────────────────────────
app.get("/tools", (req, res) => {
  res.json({
    tools: [
      {
        name: "listBases",
        description: "Fetches all Airtable bases available to the API key.",
        input_schema: {},
        output_schema: { type: "object" },
      },
      {
        name: "getRecords",
        description: "Fetch records from a specific Airtable base and table.",
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
  });
});

// ────────────────────────────────────────────────
//  TOOL EXECUTION
// ────────────────────────────────────────────────
app.post("/run", async (req, res) => {
  const { tool, arguments: args } = req.body || {};
  console.log(`🔧 Tool requested: ${tool}`, args);

  try {
    if (tool === "listBases") {
      const r = await fetch("https://api.airtable.com/v0/meta/bases", {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      });
      return res.json({ result: await r.json() });
    }

    if (tool === "getRecords") {
      const { baseId, tableName } = args;
      const r = await fetch(
        `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
      );
      return res.json({ result: await r.json() });
    }

    res.status(400).json({ error: `Unknown tool '${tool}'` });
  } catch (e) {
    console.error("❌ Error running tool:", e);
    res.status(500).json({ error: e.message });
  }
});

// ────────────────────────────────────────────────
//  SSE STREAM  (Claude / Make handshake + keep-alive)
// ────────────────────────────────────────────────
app.all("/sse", (req, res) => {
  console.log("🧠 [MCP] Client connected to /sse");
  console.log("🔹 Method:", req.method);
  console.log("🔹 Headers:", req.headers);

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  // log when headers have been sent
  res.flushHeaders?.();
  console.log("📡 [MCP] Response headers flushed to client");

  // ---- Handshake message ----
  const handshake = `data: {"jsonrpc":"2.0","method":"handshake","params":{"protocol":"MCP","version":"1.0"}}\n\n`;
  console.log("📤 [MCP] Sending handshake:", handshake.trim());
  res.write(handshake);

  // ---- Keep-alive ping ----
  const sendPing = () => {
    const ping = `data: {"jsonrpc":"2.0","method":"ping","params":{"t":${Date.now()}}}\n\n`;
    res.write(ping);
    console.log("📤 [MCP] Sent ping:", ping.trim());
  };
  const interval = setInterval(sendPing, 5000);

  // ---- Capture any incoming data (if Make writes anything) ----
  req.on("data", chunk => {
    console.log("📥 [MCP] Received data from client:", chunk.toString());
  });

  // ---- Monitor network lifecycle ----
  req.on("aborted", () => console.log("⚠️ [MCP] Client aborted connection"));
  req.on("error", err => console.error("❌ [MCP] Request error:", err));
  res.on("error", err => console.error("❌ [MCP] Response error:", err));
  res.on("close", () => console.log("🚪 [MCP] Response closed"));
  req.on("close", () => {
    clearInterval(interval);
    console.log("❌ [MCP] Client disconnected from /sse");
  });
});




// ────────────────────────────────────────────────
//  ROOT CHECK
// ────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("✅ Airtable MCP server live (root-level endpoints).");
});

app.listen(port, () => {
  console.log(`🚀 Root-level MCP server running on port ${port}`);
});
