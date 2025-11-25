// src/http-mcp-server.ts
import express from "express";
import axios from "axios";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
if (!AIRTABLE_API_KEY) throw new Error("AIRTABLE_API_KEY env var is required");

// Configure your bases and tables here.
// Replace the example base/table names with your actual schema.
const properties = [
  {
    propertyId: "415394",
    name: "Serenity Zen Retreat",
    baseId: process.env.AIRTABLE_PROPERTY_BASE_ID || "appZjxFyoaNUFlwCT",
    tables: {
      bookings: {
        tableName: "Bookings",
        allowedFields: [
          "Booking_ID",
          "Property_Name",
          "Guest_Name",
          "Guest_Email",
          "Guest_Phone",
          "Arrival_Date",
          "Departure_Date",
          "Nights_Stay",
          "Booking_Status",
          "Listing_Site",
          "Notes"
        ],
        dateFields: { checkin: "Arrival_Date", checkout: "Departure_Date" },
      },
      guests: {
        tableName: "Guests",
        allowedFields: ["First_Name", "Last_Name", "email", "Phone", "Address_City", "Address_State", "Address_Postal_Code", "Notes"],
      },
      contacts: {
        tableName: "Contacts",
        allowedFields: ["Name"],
      },
    },
  },
  // Add more properties here as you grow.
];

// Basic request limits
const MAX_RECORDS = 50;
const DEFAULT_RANGE_DAYS = 31;

const airtable = axios.create({
  baseURL: "https://api.airtable.com/v0",
  headers: { Authorization: `Bearer ${AIRTABLE_API_KEY}` },
});

// Helpers
const getProperty = (propertyId: string) =>
  properties.find((p) => p.propertyId === propertyId);

const ensureProperty = (propertyId: string) => {
  const prop = getProperty(propertyId);
  if (!prop) throw new Error(`Unknown propertyId: ${propertyId}`);
  return prop;
};

const pickFields = (records: any[], allowed: string[]) =>
  records.map((r) => ({
    id: r.id,
    fields: Object.fromEntries(
      Object.entries(r.fields || {}).filter(([k]) => allowed.includes(k))
    ),
  }));

async function fetchTable(opts: {
  baseId: string;
  tableName: string;
  view?: string;
  maxRecords?: number;
  filterByFormula?: string;
  fields?: string[];
}) {
  const { baseId, tableName, view, maxRecords, filterByFormula, fields } = opts;
  const params: Record<string, any> = {};
  if (view) params.view = view;
  if (maxRecords) params.maxRecords = Math.min(maxRecords, MAX_RECORDS);
  if (filterByFormula) params.filterByFormula = filterByFormula;
  if (fields?.length) params.fields = fields;
  return airtable.get(`/${baseId}/${encodeURIComponent(tableName)}`, { params });
}

// Create MCP server
const server = new McpServer({
  name: "airtable-mcp-http",
  version: "0.2.0",
});

// Shared schemas
const propertyIdSchema = z.string().describe("Property ID");
const dateSchema = z.string().describe("YYYY-MM-DD");

// TOOL: list_properties
server.registerTool(
  "list_properties",
  {
    title: "List properties",
    description: "List configured properties and base IDs",
    inputSchema: {},
    outputSchema: { properties: z.any() },
  },
  async () => {
    const output = {
      properties: properties.map((p) => ({
        propertyId: p.propertyId,
        name: p.name,
        baseId: p.baseId,
        tables: Object.keys(p.tables),
      })),
    };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  }
);

// TOOL: get_property
server.registerTool(
  "get_property",
  {
    title: "Get property details",
    description: "Get configured property metadata",
    inputSchema: { property_id: propertyIdSchema },
    outputSchema: { property: z.any() },
  },
  async ({ property_id }) => {
    const prop = ensureProperty(property_id);
    const output = { property: prop };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  }
);

// TOOL: list_bookings_by_range
server.registerTool(
  "list_bookings_by_range",
  {
    title: "List bookings in date range",
    description: "List bookings for a property between start_date and end_date (inclusive). Defaults to next 31 days.",
    inputSchema: {
      property_id: propertyIdSchema,
      start_date: dateSchema.optional(),
      end_date: dateSchema.optional(),
      max_records: z.number().int().positive().max(MAX_RECORDS).optional(),
    },
    outputSchema: { bookings: z.any() },
  },
  async ({ property_id, start_date, end_date, max_records }) => {
    const prop = ensureProperty(property_id);
    const table = prop.tables.bookings;
    const rangeStart = start_date || new Date().toISOString().slice(0, 10);
    const rangeEnd =
      end_date ||
      new Date(Date.now() + DEFAULT_RANGE_DAYS * 24 * 3600 * 1000)
        .toISOString()
        .slice(0, 10);

    const f = table.dateFields;
    const filterByFormula = `AND(IS_BEFORE({${f.checkin}}, DATEADD('${rangeEnd}', 1, 'days')), IS_AFTER({${f.checkout}}, DATEADD('${rangeStart}', -1, 'days')))`;

    const resp = await fetchTable({
      baseId: prop.baseId,
      tableName: table.tableName,
      filterByFormula,
      maxRecords: max_records || MAX_RECORDS,
      fields: table.allowedFields,
    });

    const bookings = pickFields(resp.data.records, table.allowedFields);
    const output = { bookings, range: { start_date: rangeStart, end_date: rangeEnd } };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  }
);

// TOOL: todays_checkins_checkouts
server.registerTool(
  "todays_checkins_checkouts",
  {
    title: "Today/tomorrow check-ins and check-outs",
    description: "Check-ins/outs for today and tomorrow for a property",
    inputSchema: { property_id: propertyIdSchema },
    outputSchema: { today: z.any(), tomorrow: z.any() },
  },
  async ({ property_id }) => {
    const prop = ensureProperty(property_id);
    const table = prop.tables.bookings;
    const f = table.dateFields;

    const today = new Date().toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
      .toISOString()
      .slice(0, 10);

    const makeFilter = (date: string) =>
  `OR(
    IS_SAME({${f.checkin}}, '${date}', 'day'),
    IS_SAME({${f.checkout}}, '${date}', 'day')
  )`;

    const fetchDay = async (date: string) => {
      const resp = await fetchTable({
        baseId: prop.baseId,
        tableName: table.tableName,
        filterByFormula: makeFilter(date),
        maxRecords: MAX_RECORDS,
        fields: table.allowedFields,
      });
      return pickFields(resp.data.records, table.allowedFields);
    };

    const [todayData, tomorrowData] = await Promise.all([
      fetchDay(today),
      fetchDay(tomorrow),
    ]);

    const output = { today: todayData, tomorrow: tomorrowData };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  }
);

// TOOL: find_booking_by_guest
server.registerTool(
  "find_booking_by_guest",
  {
    title: "Find bookings by guest name/email",
    description: "Search bookings for a property by guest name or email (contains match, case-insensitive)",
    inputSchema: {
      property_id: propertyIdSchema,
      query: z.string().min(2).describe("Guest name or email substring"),
      max_records: z.number().int().positive().max(MAX_RECORDS).optional(),
    },
    outputSchema: { bookings: z.any() },
  },
  async ({ property_id, query, max_records }) => {
    const prop = ensureProperty(property_id);
    const table = prop.tables.bookings;
    const filterByFormula = `OR(
      FIND(LOWER('${query}'), LOWER({Guest_Name}))>0,
      FIND(LOWER('${query}'), LOWER({Guest_Email}))>0
    )`;

    const resp = await fetchTable({
      baseId: prop.baseId,
      tableName: table.tableName,
      filterByFormula,
      maxRecords: max_records || MAX_RECORDS,
      fields: table.allowedFields,
    });

    const bookings = pickFields(resp.data.records, table.allowedFields);
    const output = { bookings };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  }
);

// TOOL: get_guest_contact
server.registerTool(
  "get_guest_contact",
  {
    title: "Get guest contact",
    description: "Find guest contact info by partial name or email (case-insensitive substring match) across all properties and include their bookings",
    inputSchema: {
      query: z.string().min(2).describe("Guest name or email substring"),
      max_records: z.number().int().positive().max(MAX_RECORDS).optional(),
    },
    outputSchema: { guests: z.any() },
  },
  async ({ query, max_records }) => {
    if (properties.length === 0) throw new Error("No properties configured");
    const q = query.toLowerCase();
    const filterByFormula = `OR(
      FIND('${q}', LOWER({First_name}))>0,
      FIND('${q}', LOWER({Last_Name}))>0,
      FIND('${q}', LOWER(CONCATENATE({First_name}, ' ', {Last_Name})))>0,
      FIND('${q}', LOWER({email}))>0
    )`;

    const perPropertyMax = max_records || MAX_RECORDS;

    const results = await Promise.all(
      properties.map(async (prop) => {
        const guestTable = prop.tables.guests;
        const bookingTable = prop.tables.bookings;

        const guestsResp = await fetchTable({
          baseId: prop.baseId,
          tableName: guestTable.tableName,
          filterByFormula,
          maxRecords: perPropertyMax,
          fields: guestTable.allowedFields,
        });

        const bookingsFilter = `OR(
          FIND(LOWER('${q}'), LOWER({Guest_Name}))>0,
          FIND(LOWER('${q}'), LOWER({Guest_Email}))>0
        )`;

        const bookingsResp = await fetchTable({
          baseId: prop.baseId,
          tableName: bookingTable.tableName,
          filterByFormula: bookingsFilter,
          maxRecords: perPropertyMax,
          fields: bookingTable.allowedFields,
        });

        const bookings = pickFields(bookingsResp.data.records, bookingTable.allowedFields).map((b) => ({
          ...b
        }));

        const guests = pickFields(guestsResp.data.records, guestTable.allowedFields).map((g) => {
          const email = (g.fields as any)?.email?.toString().toLowerCase() || "";
          const name = `${(g.fields as any)?.["First name"] || ""} ${(g.fields as any)?.["Last Name"] || ""}`.trim().toLowerCase();
          const matchedBookings = bookings.filter((b) => {
            const be = (b.fields as any)?.Guest_Email?.toString().toLowerCase() || "";
            const bn = (b.fields as any)?.Guest_Name?.toString().toLowerCase() || "";
            return (email && be.includes(email)) || (name && bn.includes(name)) || bn.includes(q) || be.includes(q);
          });
          return {
            ...g,
            propertyId: prop.propertyId,
            propertyName: prop.name,
            bookings: matchedBookings,
          };
        });

        return guests;
      })
    );

    const guests = results.flat();

    const output = { guests };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  }
);

// TOOL: list_contacts
server.registerTool(
  "list_contacts",
  {
    title: "List property contacts",
    description: "Return trusted contacts for a property (e.g., cleaner, manager)",
    inputSchema: { property_id: propertyIdSchema, max_records: z.number().int().positive().max(MAX_RECORDS).optional() },
    outputSchema: { contacts: z.any() },
  },
  async ({ property_id, max_records }) => {
    const prop = ensureProperty(property_id);
    const table = prop.tables.contacts;

    const resp = await fetchTable({
      baseId: prop.baseId,
      tableName: table.tableName,
      maxRecords: max_records || MAX_RECORDS,
      fields: table.allowedFields,
    });

    const contacts = pickFields(resp.data.records, table.allowedFields);
    const output = { contacts };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output,
    };
  }
);

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
  console.log(`✅ Airtable MCP (Streamable HTTP, read-only) on http://localhost:${PORT}/mcp`);
});
