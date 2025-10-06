// index.js
import express from "express";

const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("✅ Airtable MCP server running on Render!");
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
