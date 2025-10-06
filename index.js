// index.js
import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

// ENV VARS
const port = process.env.PORT || 3000;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

app.use("/mcp", (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (process.env.MCP_AUTH_TOKEN && token !== process.env.MCP_AUTH_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// ────────────────────────────────────────────────
//  HEALTH ENDPOINT (Claude / Make checks this first)
// ────────────────────────────────────────────────
app.get("/mcp/api/v1/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    message: "Airtable MCP server is healthy and reachable",
    timestamp: new Date().toISOString(),
  });
});

// ────────────────────────────────────────────────
//  TOOL DISCOVERY (lists the tools your agent can call)
// ────────────────────────────────────────────────
app.get("/mcp/api/v1/tools", (req, res) => {
  res.status(200).json({
    tools: [
      {
        name: "listBases",
        description: "Fetches list of Airtable bases accessible via your API key.",
        input_schema: {},
        output_schema: { type: "object" },
      },
      {
        name: "getRecords",
        description: "Fetches records from a specific base and table.",
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

// redirect Make's POST /mcp/api/v1 to the proper SSE endpoint
app.post("/mcp/api/v1", (req, res) => {
  res.redirect(307, "/mcp/api/v1/sse");
});

// ────────────────────────────────────────────────
//  TOOL EXECUTION ENDPOINT
//  Claude / Make will POST { "tool": "<name>", "arguments": { ... } }
// ────────────────────────────────────────────────
app.post("/mcp/api/v1/run", async (req, res) => {
  const { tool, arguments: args } = req.body || {};
  console.log(`🔧 Tool requested: ${tool}`, args);

  try {
    if (tool === "listBases") {
      const response = await fetch("https://api.airtable.com/v0/meta/bases", {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      });
      const data = await response.json();
      return res.status(200).json({ result: data });
    }

    if (tool === "getRecords") {
      const { baseId, tableName } = args;
      const response = await fetch(
        `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`,
        {
          headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
        }
      );
      const data = await response.json();
      return res.status(200).json({ result: data });
    }

    // If unknown tool
    res.status(400).json({ error: `Unknown tool '${tool}'` });
  } catch (err) {
    console.error("❌ MCP tool execution failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────
//  BASIC ROOT ENDPOINT (for sanity / browser check)
// ────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.send("✅ Airtable MCP server running on Render!");
});

// ────────────────────────────────────────────────
//  SSE STREAM ENDPOINT (Claude / Make requires this)
// ────────────────────────────────────────────────
app.post("/mcp/api/v1/sse", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.status(200);

  console.log("🧠 Make or Claude connected via POST /mcp/api/v1/sse");

  // Initial connection message
  res.write(`event: message\n`);
  res.write(`data: {"status":"connected","message":"MCP POST SSE stream active"}\n\n`);

  // Periodic keepalive ping
  const interval = setInterval(() => {
    res.write(`event: ping\n`);
    res.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
  }, 10000);

  // Handle disconnect
  req.on("close", () => {
    console.log("❌ SSE client disconnected");
    clearInterval(interval);
  });
});


// ────────────────────────────────────────────────
//  START SERVER
// ────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`🚀 MCP server listening on port ${port}`);
});
