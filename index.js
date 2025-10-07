// index.js — Airtable MCP Server (Make-compatible)
// ================================================

import express from "express";
import fetch from "node-fetch";

const app = express();
const port = process.env.PORT || 3000;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

// -----------------------------------------------------
// 🔧 Middleware: Smart body parsing (works for Make, curl, PowerShell)
// -----------------------------------------------------
app.use(express.text({ type: "*/*" }));
app.use((req, res, next) => {
  if (typeof req.body === "string") {
    try {
      req.body = JSON.parse(req.body);
    } catch {
      // leave as string if not valid JSON
    }
  }
  next();
});

// -----------------------------------------------------
// 🔐 Authentication middleware
// -----------------------------------------------------
app.use((req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace("Bearer ", "") || req.query.access_token;
  if (MCP_AUTH_TOKEN && token !== MCP_AUTH_TOKEN) {
    console.log("❌ Unauthorized access attempt:", req.method, req.path);
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// -----------------------------------------------------
// 🧭 Logging middleware
// -----------------------------------------------------
app.use((req, res, next) => {
  console.log(`🔐 ${req.method} ${req.path}`);
  console.log("Headers:", req.headers.authorization || "None");
  next();
});

// -----------------------------------------------------
// 🌡️ Health check endpoint
// -----------------------------------------------------
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Airtable MCP server is healthy and reachable",
    timestamp: new Date().toISOString(),
  });
});

// -----------------------------------------------------
// 🧰 Tools listing (for discovery)
// -----------------------------------------------------
app.get("/tools", (req, res) => {
  console.log("🧰 Listing tools");
  res.json({
    tools: [
      {
        name: "listBases",
        description: "Fetches list of Airtable bases accessible via your API key.",
        input_schema: {},
        output_schema: { type: "object" },
      },
      {
        name: "getRecords",
        description: "Fetches records from a specific Airtable base and table.",
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
      {
        name: "listTables",
        description: "Fetches tables and their IDs from a specific Airtable base.",
        input_schema: {
          type: "object",
          properties: {
            baseId: { type: "string" },
          },
          required: ["baseId"],
        },
        output_schema: { type: "object" },
      },
    ],
  });
});

// -----------------------------------------------------
// 🚀 Root endpoint
// -----------------------------------------------------
app.get("/", (req, res) => {
  res.send("✅ Airtable MCP server running and ready for Make!");
});

// -----------------------------------------------------
// 🧠 SSE Endpoint (Make.com-compatible handshake)
// -----------------------------------------------------
app.get("/sse", (req, res) => {
  console.log("🧠 [MCP] Client connected to SSE");
  console.log("🔹 Method:", req.method);
  console.log("🔹 Headers:", req.headers);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  console.log("📡 [MCP] SSE headers flushed to client");

  // Send Make-compatible handshake
  const handshake = {
    jsonrpc: "2.0",
    method: "handshake",
    params: {
      protocolVersion: "2024-11-05",
      serverInfo: {
        name: "Airtable MCP Server",
        version: "0.3.0",
      },
      capabilities: {
        tools: { list: true, execute: true },
        resources: {},
        logging: {},
      },
    },
  };

  res.write(`event: message\n`);
  res.write(`data: ${JSON.stringify(handshake)}\n\n`);
  console.log("📤 Sent Make-compliant handshake:", JSON.stringify(handshake));

  // Keep-alive pings
  const interval = setInterval(() => {
    res.write(`event: ping\n`);
    res.write(`data: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
  }, 15000);

  req.on("close", () => {
    console.log("❌ [MCP] Client disconnected from SSE");
    clearInterval(interval);
  });
});

// Mirror GET /sse for Make’s POST /sse handshake
app.post("/sse", (req, res) => {
  console.log("🧠 [MCP] Client connected via POST /sse");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  console.log("📡 [MCP] SSE headers flushed");

  const handshake = {
    jsonrpc: "2.0",
    method: "handshake",
    params: {
      protocolVersion: "2024-11-05",
      serverInfo: {
        name: "Airtable MCP Server",
        version: "0.3.0",
      },
      capabilities: {
        tools: { list: true, execute: true },
        resources: {},
        logging: {},
      },
    },
  };

  res.write(`event: message\n`);
  res.write(`data: ${JSON.stringify(handshake)}\n\n`);
  console.log("📤 Sent Make handshake:", JSON.stringify(handshake));

  const interval = setInterval(() => {
    res.write(`event: ping\n`);
    res.write(`data: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
  }, 15000);

  req.on("close", () => {
    console.log("❌ [MCP] Client disconnected from /sse");
    clearInterval(interval);
  });
});


// -----------------------------------------------------
// 🧩 Redirect POST / → /sse (Make's initial POST request)
// -----------------------------------------------------
app.post("/", (req, res) => {
  console.log("📨 Make POST / received, redirecting to /sse");
  res.redirect(307, "/sse");
});

// -----------------------------------------------------
// 🧰 Tool execution route
// -----------------------------------------------------
app.post("/run", async (req, res) => {
  console.log("📥 Received /run request:", req.body);
  const { tool, arguments: args } = req.body || {};

  if (!tool) {
    return res.status(400).json({ error: "Missing tool name" });
  }

  try {
    if (tool === "listBases") {
      const response = await fetch("https://api.airtable.com/v0/meta/bases", {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      });
      const data = await response.json();
      return res.status(200).json({ result: data });
    }

    if (tool === "getRecords") {
      const { baseId, tableName } = args || {};
      if (!baseId || !tableName) {
        return res.status(400).json({ error: "Missing baseId or tableName" });
      }

      const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(
        tableName
      )}`;
      console.log("📡 Fetching Airtable:", url);

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      });

      const data = await response.json();
      return res.status(200).json({ result: data });
    }
    if (tool === "listTables") {
      const { baseId } = args || {};
      if (!baseId) return res.status(400).json({ error: "Missing baseId" });

      const response = await fetch(
        `https://api.airtable.com/v0/meta/bases/${baseId}/tables`,
        { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
      );

      const data = await response.json();
      return res.status(200).json({ result: data });
    }
    

    res.status(400).json({ error: `Unknown tool '${tool}'` });
  } catch (err) {
    console.error("❌ Error running tool:", err);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------
// 🏁 Start the server
// -----------------------------------------------------
app.listen(port, () => {
  console.log(`🚀 MCP server listening on port ${port}`);
});
