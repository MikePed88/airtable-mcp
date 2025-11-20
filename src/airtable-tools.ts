import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError,
  CallToolRequest,
} from "@modelcontextprotocol/sdk/types.js";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import axios, { AxiosInstance } from "axios";

import { 
  FieldOption, 
  fieldRequiresOptions, 
  getDefaultOptions, 
  FieldType 
} from "./types.js";


/**
 * Registers Airtable MCP tools on a shared MCP server instance.
 */
export function registerAirtableTools(
  server: Server,           // <— FIXED: explicitly typed
  API_KEY: string           // <— FIXED: explicitly typed
) {
  const axiosInstance: AxiosInstance = axios.create({
    baseURL: "https://api.airtable.com/v0",
    headers: { Authorization: `Bearer ${API_KEY}` },
    timeout: 10000,
  });

  function validateField(field: FieldOption): FieldOption {
    const { type } = field;

    if (!fieldRequiresOptions(type as FieldType)) {
      const { options, ...rest } = field;
      return rest;
    }

    return field.options
      ? field
      : { ...field, options: getDefaultOptions(type as FieldType) };
  }

  /**
   * MCP → tools/list
   */
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // 🔥 COPY YOUR EXACT tool definitions here
      // (everything from list_bases → get_record)
    ],
  }));


  /**
   * MCP → tools/call
   */
  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {     // <— FIXED: explicitly typed
      const tool = request.params.name;
      const args = request.params.arguments as Record<string, any>;

      try {
        switch (tool) {

          case "list_bases": {
            const res = await axiosInstance.get("/meta/bases");
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(res.data.bases, null, 2),
                },
              ],
            };
          }

          case "list_tables": {
            const { base_id } = args;
            const res = await axiosInstance.get(`/meta/bases/${base_id}/tables`);
            return {
              content: [
                { type: "text", text: JSON.stringify(res.data.tables, null, 2) },
              ],
            };
          }

          // 🔥 COPY ALL YOUR OTHER CASES EXACTLY AS-IS
          // - create_table
          // - update_table
          // - create_field
          // - update_field
          // - list_records
          // - create_record
          // - update_record
          // - delete_record
          // - search_records
          // - get_record

          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${tool}`
            );
        }
      } catch (err: any) {
        if (axios.isAxiosError(err)) {
          throw new McpError(
            ErrorCode.InternalError,
            `Airtable API error: ${
              err.response?.data?.error?.message ?? err.message
            }`
          );
        }
        throw err;
      }
    }
  );
}
