import express from "express";
import fetch from "node-fetch";
import { serveModelContextProtocol } from "model-context-protocol";

const app = express();
const port = process.env.PORT || 3000;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;

// Auth (optional but recommended)
app.use("/mcp", (req, res, next) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (process.env.MCP_AUTH_TOKEN && token !== process.env.MCP_AUTH_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// Define MCP tools
const tools = [
  {
    name: "listBases",
    description: "Fetches all Airtable bases.",
    inputSchema: {},
    outputSchema: { type: "object" },
    handler: async () => {
      const res = await fetch("https://api.airtable.com/v0/meta/bases", {
        headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
      });
      return await res.json();
    },
  },
  {
    name: "getRecords",
    description: "Fetch records from a base and table.",
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
      const res = await fetch(
        `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`,
        { headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` } }
      );
      return await res.json();
    },
  },
];

// Serve as a proper MCP endpoint
serveModelContextProtocol(app, { tools });

app.get("/", (req, res) => {
  res.send("✅ Full MCP server for Airtable ready!");
});

app.listen(port, () => {
  console.log(`🚀 MCP server running on port ${port}`);
});
