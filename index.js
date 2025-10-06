// index.js
import express from "express";
import { serveModelContextProtocol } from "model-context-protocol/express";
import fetch from "node-fetch";

const app = express();
const port = process.env.PORT || 3000;

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

app.use("/mcp", (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (process.env.MCP_AUTH_TOKEN && token !== process.env.MCP_AUTH_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// ✅ Define MCP Tools
const tools = [
  {
    name: "listBases",
    description: "Fetch all Airtable bases accessible by the configured API key.",
    inputSchema: {},
    outputSchema: { type: "object" },
    handler: async () => {
      const response = await fetch("https://api.airtable.com/v0/meta/bases", {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      });
      return await response.json();
    },
  },
  {
    name: "getRecords",
    description: "Fetch records from a specific Airtable base and table.",
    inputSchema: {
      type: "object",
      properties: {
        baseId: { type: "string" },
        tableName: { type: "string" },
      },
      required: ["baseId", "tableName"],
    },
    outputSchema: { type: "object" },
    handler: async ({ baseId, tableName }) => {
      const response = await fetch(
        `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
      );
      return await response.json();
    },
  },
];

// ✅ Plug in the MCP middleware
serveModelContextProtocol(app, { tools });

// ✅ Optional: a root health route
app.get("/", (req, res) => {
  res.send("✅ Airtable MCP server (full MCP JSON-RPC implementation)");
});

// ✅ Start the server
app.listen(port, () => {
  console.log(`🚀 Full MCP server running on port ${port}`);
});
