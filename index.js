import express from "express";
import fetch from "node-fetch";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

// Track active SSE clients
const clients = new Map();

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "Airtable MCP server is healthy and reachable",
    time: new Date().toISOString(),
  });
});

// Auth middleware - check for Bearer token in Authorization header
app.use((req, res, next) => {
  if (req.path === "/health" || req.path === "/") {
    return next(); // Skip auth for health check and root
  }
  
  const authHeader = req.headers.authorization;
  if (MCP_AUTH_TOKEN && authHeader !== `Bearer ${MCP_AUTH_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

// Root endpoint - Make.com will POST here for initial connection
app.post("/", async (req, res) => {
  console.log("📥 Received request at root:", req.body);
  
  // Handle JSON-RPC requests at root
  const { id, method, params } = req.body;

  if (!id || !method) {
    return res.status(400).json({
      jsonrpc: "2.0",
      id: id || null,
      error: { code: -32600, message: "Invalid JSON-RPC request" },
    });
  }

  try {
    let result;

    if (method === "tools/list") {
      result = {
        tools: [
          {
            name: "listBases",
            description: "List Airtable bases accessible by your API key",
            input_schema: {
              type: "object",
              properties: {},
            },
          },
          {
            name: "getRecords",
            description: "Fetch records from a specific Airtable base/table",
            input_schema: {
              type: "object",
              properties: {
                baseId: { type: "string" },
                tableName: { type: "string" },
              },
              required: ["baseId", "tableName"],
            },
          },
        ],
      };
    }
    else if (method === "tools/call") {
      const { name, arguments: args } = params;
      console.log(`🛠 Running tool: ${name}`, args);

      if (name === "listBases") {
        const response = await fetch("https://api.airtable.com/v0/meta/bases", {
          headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
        });
        const data = await response.json();
        result = {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
        };
      } else if (name === "getRecords") {
        const { baseId, tableName } = args;
        const response = await fetch(
          `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`,
          {
            headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
          }
        );
        const data = await response.json();
        result = {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }]
        };
      } else {
        throw new Error(`Unknown tool: ${name}`);
      }
    }
    else {
      throw new Error(`Unsupported method: ${method}`);
    }

    const rpcResponse = { jsonrpc: "2.0", id, result };
    console.log("📤 Sending response:", rpcResponse);
    res.json(rpcResponse);
  } catch (err) {
    console.error("❌ Error:", err);
    res.json({
      jsonrpc: "2.0",
      id,
      error: { code: -32001, message: err.message },
    });
  }
});

// SSE endpoint for streaming connections
app.get("/sse", (req, res) => {
  console.log("🧠 [MCP] Client connected via GET /sse");
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const clientId = Date.now().toString();
  clients.set(clientId, res);

  // Send initial handshake
  const handshake = {
    jsonrpc: "2.0",
    method: "notifications/initialized",
    params: {
      protocolVersion: "2024-11-05",
      serverInfo: {
        name: "Airtable MCP Server",
        version: "0.3.0",
      },
      capabilities: {
        tools: { list: true, call: true },
        resources: {},
        logging: {},
      },
    },
  };

  res.write(`data: ${JSON.stringify(handshake)}\n\n`);

  // Keepalive
  const interval = setInterval(() => {
    if (clients.has(clientId)) {
      res.write(`: keepalive ${new Date().toISOString()}\n\n`);
    }
  }, 30000);

  req.on("close", () => {
    console.log(`❌ [MCP] Client ${clientId} disconnected`);
    clearInterval(interval);
    clients.delete(clientId);
  });
});

// Root GET for basic info
app.get("/", (req, res) => {
  res.send("✅ Airtable MCP Server running (Make-compatible)");
});

app.listen(PORT, () => {
  console.log(`🚀 MCP server running on port ${PORT}`);
});
