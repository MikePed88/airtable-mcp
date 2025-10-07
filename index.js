import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Airtable MCP server is healthy and reachable",
    time: new Date().toISOString(),
  });
});

// Auth middleware - only for MCP endpoints
app.use((req, res, next) => {
  if (req.path === "/health" || req.method === "GET") {
    return next();
  }
  
  const authHeader = req.headers.authorization;
  if (MCP_AUTH_TOKEN && authHeader !== `Bearer ${MCP_AUTH_TOKEN}`) {
    return res.status(401).json({ 
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Unauthorized" }
    });
  }
  next();
});

// Main MCP endpoint - Handle JSON-RPC requests
app.post("/", async (req, res) => {
  console.log("📥 Received MCP request:", JSON.stringify(req.body, null, 2));
  
  // Validate basic JSON-RPC structure
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32700, message: "Parse error" }
    });
  }

  const { jsonrpc, id, method, params } = req.body;

  // Validate JSON-RPC 2.0 format
  if (jsonrpc !== "2.0") {
    return res.status(400).json({
      jsonrpc: "2.0",
      id: id || null,
      error: { code: -32600, message: "Invalid Request - jsonrpc must be '2.0'" }
    });
  }

  if (!method || typeof method !== 'string') {
    return res.status(400).json({
      jsonrpc: "2.0",
      id: id || null,
      error: { code: -32600, message: "Invalid Request - method is required" }
    });
  }

  try {
    let result;

    console.log(`🛠 Handling method: ${method}`);

    switch (method) {
      case "initialize":
        result = {
          protocolVersion: "2024-11-05",
          serverInfo: {
            name: "Airtable MCP Server",
            version: "0.3.0",
          },
          capabilities: {
            tools: { listChanged: true }
          }
        };
        break;

      case "tools/list":
        result = {
          tools: [
            {
              name: "listBases",
              description: "List Airtable bases accessible by your API key",
              inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false
              },
            },
            {
              name: "getRecords", 
              description: "Fetch records from a specific Airtable base/table",
              inputSchema: {
                type: "object",
                properties: {
                  baseId: { 
                    type: "string",
                    description: "The ID of the Airtable base"
                  },
                  tableName: { 
                    type: "string", 
                    description: "The name of the table to fetch records from"
                  },
                },
                required: ["baseId", "tableName"],
                additionalProperties: false
              },
            },
          ],
        };
        break;

      case "tools/call":
        const { name, arguments: args } = params || {};
        
        if (!name) {
          throw new Error("Tool name is required");
        }

        console.log(`🔧 Executing tool: ${name} with args:`, args);

        if (name === "listBases") {
          const response = await fetch("https://api.airtable.com/v0/meta/bases", {
            headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
          });
          
          if (!response.ok) {
            throw new Error(`Airtable API error: ${response.status} ${response.statusText}`);
          }
          
          const data = await response.json();
          result = {
            content: [
              { 
                type: "text", 
                text: JSON.stringify(data, null, 2) 
              }
            ]
          };
        } 
        else if (name === "getRecords") {
          const { baseId, tableName } = args || {};
          
          if (!baseId || !tableName) {
            throw new Error("baseId and tableName are required");
          }

          const response = await fetch(
            `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`,
            {
              headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
            }
          );
          
          if (!response.ok) {
            throw new Error(`Airtable API error: ${response.status} ${response.statusText}`);
          }
          
          const data = await response.json();
          result = {
            content: [
              { 
                type: "text", 
                text: JSON.stringify(data, null, 2) 
              }
            ]
          };
        } 
        else {
          throw new Error(`Unknown tool: ${name}`);
        }
        break;

      default:
        return res.status(400).json({
          jsonrpc: "2.0",
          id: id || null,
          error: { code: -32601, message: `Method not found: ${method}` }
        });
    }

    const response = { jsonrpc: "2.0", id: id || null, result };
    console.log("📤 Sending response:", JSON.stringify(response, null, 2));
    res.json(response);

  } catch (err) {
    console.error("❌ Error processing request:", err
