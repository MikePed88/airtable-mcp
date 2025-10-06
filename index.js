import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

// Bearer-token auth (optional)
app.use("/mcp", (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (process.env.MCP_AUTH_TOKEN && token !== process.env.MCP_AUTH_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// alias /sse for Make compatibility
app.post("/sse", (req, res) => {
  // Just call your existing handler
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  console.log("🧠 Make connected via POST /sse");

  // Standard MCP handshake
  const handshake = {
    jsonrpc: "2.0",
    method: "handshake",
    params: { protocol: "MCP", version: "1.0" },
  };
  res.write(`data: ${JSON.stringify(handshake)}\n\n`);

  // Keep-alive pings
  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "ping", params: { t: Date.now() } })}\n\n`);
  }, 5000);

  req.on("close", () => {
    clearInterval(interval);
    console.log("❌ Make disconnected from /sse");
  });
});


// 🔹 Make expects to POST here to start the SSE stream
app.post("/mcp/api/v1/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  console.log("🧠  MCP client connected");

  // --- Required handshake ---
  const handshake = {
    jsonrpc: "2.0",
    method: "handshake",
    params: { protocol: "MCP", version: "1.0" },
  };
  res.write(`data: ${JSON.stringify(handshake)}\n\n`);

  // --- Periodic keep-alive ---
  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify({ jsonrpc: "2.0", method: "ping", params: { t: Date.now() } })}\n\n`);
  }, 5000);

  req.on("close", () => {
    clearInterval(interval);
    console.log("❌  MCP client disconnected");
  });
});

// 🔹 Basic tool endpoints Make will call
app.get("/mcp/api/v1/tools", (req, res) => {
  res.json({
    tools: [
      {
        name: "listBases",
        description: "Fetch all Airtable bases.",
        input_schema: {},
        output_schema: { type: "object" },
      },
      {
        name: "getRecords",
        description: "Fetch records from a base and table.",
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

app.post("/mcp/api/v1/run", async (req, res) => {
  const { tool, arguments: args } = req.body;
  try {
    if (tool === "listBases") {
      const r = await fetch("https://api.airtable.com/v0/meta/bases", {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      });
      return res.json(await r.json());
    }
    if (tool === "getRecords") {
      const { baseId, tableName } = args;
      const r = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`, {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      });
      return res.json(await r.json());
    }
    res.status(400).json({ error: "Unknown tool" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(port, () => console.log(`🚀 Minimal MCP server on ${port}`));
