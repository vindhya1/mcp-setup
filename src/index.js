import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pg from "pg";
import { z } from "zod";
import { spawnSync } from "child_process";
import os from "os";

const { Pool } = pg;

const PG_BIN = "/Applications/Postgres.app/Contents/Versions/latest/bin";
const PG_DATA = `${os.homedir()}/Library/Application Support/Postgres/var-18`;

function ensurePostgresRunning() {
  const status = spawnSync(`${PG_BIN}/pg_ctl`, ["status", "-D", PG_DATA], { encoding: "utf8" });
  if (status.status === 0) {
    spawnSync("open", ["-a", "Postgres"], { encoding: "utf8" });
    return;
  }

  process.stderr.write("Postgres not running — starting via pg_ctl...\n");
  const start = spawnSync(
    `${PG_BIN}/pg_ctl`,
    ["start", "-D", PG_DATA, "-l", "/tmp/postgres-mcp.log", "-w"],
    { encoding: "utf8" }
  );
  if (start.status !== 0) {
    process.stderr.write(`Failed to start Postgres: ${start.stderr}\n`);
    process.exit(1);
  }
  process.stderr.write("Postgres started.\n");
  spawnSync("open", ["-a", "Postgres"], { encoding: "utf8" });
}

ensurePostgresRunning();

const pool = new Pool({
  host: "localhost",
  port: 5432,
  database: "c1pay",
  user: process.env.PGUSER || process.env.USER,
  // password: process.env.PGPASSWORD,  // uncomment if your DB requires a password
});

// Verify connection on startup
pool.connect((err, client, release) => {
  if (err) {
    process.stderr.write(`Failed to connect to c1pay database: ${err.message}\n`);
    process.exit(1);
  }
  release();
  process.stderr.write("Connected to c1pay database\n");
});

const server = new McpServer({
  name: "c1pay-db",
  version: "1.0.0",
});

// Tool: run a read-only SQL query
server.tool(
  "query",
  "Run a read-only SQL SELECT query against the c1pay database",
  {
    sql: z.string().describe("The SQL SELECT query to execute"),
  },
  async ({ sql }) => {
    const trimmed = sql.trim().toLowerCase();
    if (!trimmed.startsWith("select") && !trimmed.startsWith("with")) {
      return {
        content: [{ type: "text", text: "Only SELECT (and WITH) queries are allowed." }],
        isError: true,
      };
    }

    try {
      const result = await pool.query(sql);
      const text =
        result.rows.length === 0
          ? "Query returned no rows."
          : JSON.stringify(result.rows, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Query error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: list all tables in the database
server.tool(
  "list_tables",
  "List all tables in the c1pay database",
  {},
  async () => {
    try {
      const result = await pool.query(
        `SELECT table_schema, table_name, table_type
         FROM information_schema.tables
         WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
         ORDER BY table_schema, table_name`
      );
      const text =
        result.rows.length === 0
          ? "No tables found."
          : JSON.stringify(result.rows, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

// Tool: describe a table's columns
server.tool(
  "describe_table",
  "Show columns and their types for a given table in the c1pay database",
  {
    table_name: z.string().describe("The table name to describe"),
    schema: z.string().optional().describe("Schema name (default: public)"),
  },
  async ({ table_name, schema = "public" }) => {
    try {
      const result = await pool.query(
        `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, table_name]
      );
      const text =
        result.rows.length === 0
          ? `Table "${schema}.${table_name}" not found or has no columns.`
          : JSON.stringify(result.rows, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
