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

// Redirect Make’s POST / to the real SSE endpoint
app.post("/", (req, res) => {
  console.log("📨 Make POST / received, redirecting to /sse");
  res.redirect(307, "/sse");
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
  console.log("🧠 [MCP] Client connected to /sse");
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
  console.log("📡 [MCP] SSE headers flushed");

// --- Properly framed handshake (Make schema-compliant) ---
const handshake = {
  jsonrpc: "2.0",
  id: 0,
  result: {
    type: "handshake",
    protocol: "MCP",
    protocolVersion: "2024-11-05",
    serverInfo: {
      name: "Airtable MCP Server",
      version: "0.3.0"
    },
    capabilities: {
      tools: {},
      resources: {},
      logging: {}
    }
  }
};

const frame =
  `event: message\n` +
  `data: ${JSON.stringify(handshake)}\n\n`;
res.write(frame);
console.log("📤 Sent Make-compliant handshake:\n" + frame);

  // --- keep-alive pings ---
  const interval = setInterval(() => {
    const ping = {
      jsonrpc: "2.0",
      method: "ping",
      params: { t: Date.now() },
    };
    const pingFrame =
      `event: message\n` +
      `data: ${JSON.stringify(ping)}\n\n`;
    res.write(pingFrame);
    console.log("📤 Sent ping frame");
  }, 5000);

  // --- observe any inbound traffic ---
  req.on("data", c =>
    console.log("📥 Client wrote:", c.toString())
  );

  req.on("close", () => {
    clearInterval(interval);
    console.log("❌ Client disconnected /sse");
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
