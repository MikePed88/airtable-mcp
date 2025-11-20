// src/http-mcp-server.ts
import express from "express";
import axios from "axios";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
if (!AIRTABLE_API_KEY) {
  throw new Error("AIRTABLE_API_KEY environment variable is required");
}

const airtable = axios.create({
  baseURL: "https://api.airtable.com/v0",
  headers: {
    Authorization: `Bearer ${AIRTABLE_API_KEY}`,
  },
});

// Create MCP server
const server = new McpServer({
  name: "airtable-mcp-http",
  version: "0.1.0",
});

/**
 * TOOL: list_bases
 */
server.registerTool(
  "list_bases",
  {
    title: "List Airtable bases",
    description: "List all Airtable bases accessible with this API key",
    inputSchema: {},
    outputSchema: {
      bases: z.any(),
    },
  },
  async () => {
    const resp = await airtable.get("/meta/bases");
    const output = { bases: resp.data.bases };
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(output, null, 2),
        },
      ],
      structuredContent: output,
    };
  }
);

/**
 * TOOL: list_records
 */
server.registerTool(
  "list_records",
  {
    title: "List records in a table",
    description: "List records from an Airtable base/table",
    inputSchema: {
      base_id: z.string().describe("Airtable base ID"),
      table_name: z.string().describe("Table name"),
      max_records: z.number().int().positive().optional().describe("Max records"),
    },
    outputSchema: {
      records: z.any(),
    },
  },
  async ({ base_id, table_name, max_records }) => {
    const params: Record<string, any> = {};
    if (max_records) {
      params.maxRecords = max_records;
    }

    const resp = await airtable.get(`/${base_id}/${encodeURIComponent(table_name)}`, {
      params,
    });

    const output = { records: resp.data.records };
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(output, null, 2),
        },
      ],
      structuredContent: output,
    };
  }
);

// TODO: add search_records, get_record, create_record, etc. as more registerTool calls.

// ----------------------
// HTTP wiring (Streamable HTTP MCP)
// ----------------------
const app = express();
app.use(express.json());

app.post("/mcp", async (req, res) => {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless, 1 transport per HTTP request
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("Error handling MCP HTTP request:", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Airtable MCP (Streamable HTTP) running on http://localhost:${PORT}/mcp`);
});
