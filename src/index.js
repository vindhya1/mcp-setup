import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pg from "pg";
import { z } from "zod";
import { spawnSync } from "child_process";
import os from "os";
import crypto from "crypto";

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

// ─── Analytics & Reporting Tools ────────────────────────────────────────────

// Tool: high-level dashboard summary
server.tool(
  "get_dashboard_summary",
  "Get a high-level overview of the c1pay platform: total users, transaction volume, and payment request counts broken down by status",
  {},
  async () => {
    try {
      const [users, txns, requests] = await Promise.all([
        pool.query(`SELECT COUNT(*) AS total_users, SUM(balance_cents) AS total_balance_cents FROM users`),
        pool.query(`SELECT COUNT(*) AS total_transactions, COALESCE(SUM(amount_cents), 0) AS total_volume_cents FROM transactions`),
        pool.query(`SELECT status, COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS total_cents FROM payment_requests GROUP BY status ORDER BY status`),
      ]);

      const summary = {
        users: {
          total: Number(users.rows[0].total_users),
          total_balance_dollars: (Number(users.rows[0].total_balance_cents) / 100).toFixed(2),
        },
        transactions: {
          total: Number(txns.rows[0].total_transactions),
          total_volume_dollars: (Number(txns.rows[0].total_volume_cents) / 100).toFixed(2),
        },
        payment_requests_by_status: requests.rows.map((r) => ({
          status: r.status,
          count: Number(r.count),
          total_dollars: (Number(r.total_cents) / 100).toFixed(2),
        })),
      };

      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// Tool: list all users with balance info
server.tool(
  "get_all_users",
  "List all registered users with their id, username, balance, and registration date",
  {},
  async () => {
    try {
      const result = await pool.query(
        `SELECT id, username, balance_cents, ROUND(balance_cents / 100.0, 2) AS balance_dollars, created_at
         FROM users
         ORDER BY created_at DESC`
      );
      const text = result.rows.length === 0 ? "No users found." : JSON.stringify(result.rows, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// Tool: get full details for a single user
server.tool(
  "get_user_details",
  "Get full profile for a user by username or user id, including their balance, sent/received transactions, and payment requests",
  {
    identifier: z.string().describe("Username or numeric user ID"),
  },
  async ({ identifier }) => {
    try {
      const isId = /^\d+$/.test(identifier.trim());
      const userResult = await pool.query(
        `SELECT id, username, balance_cents, ROUND(balance_cents / 100.0, 2) AS balance_dollars, created_at
         FROM users WHERE ${isId ? "id = $1" : "username ILIKE $1"}`,
        [isId ? Number(identifier) : identifier]
      );

      if (userResult.rows.length === 0) {
        return { content: [{ type: "text", text: `User "${identifier}" not found.` }], isError: true };
      }

      const user = userResult.rows[0];

      const [txnsSent, txnsReceived, payReqsSent, payReqsReceived] = await Promise.all([
        pool.query(
          `SELECT t.id, u.username AS recipient, t.amount_cents, ROUND(t.amount_cents/100.0,2) AS amount_dollars, t.note, t.created_at
           FROM transactions t JOIN users u ON u.id = t.recipient_id
           WHERE t.sender_id = $1 ORDER BY t.created_at DESC`,
          [user.id]
        ),
        pool.query(
          `SELECT t.id, u.username AS sender, t.amount_cents, ROUND(t.amount_cents/100.0,2) AS amount_dollars, t.note, t.created_at
           FROM transactions t JOIN users u ON u.id = t.sender_id
           WHERE t.recipient_id = $1 ORDER BY t.created_at DESC`,
          [user.id]
        ),
        pool.query(
          `SELECT pr.id, u.username AS recipient, pr.amount_cents, ROUND(pr.amount_cents/100.0,2) AS amount_dollars, pr.note, pr.status, pr.created_at, pr.resolved_at
           FROM payment_requests pr JOIN users u ON u.id = pr.recipient_id
           WHERE pr.requester_id = $1 ORDER BY pr.created_at DESC`,
          [user.id]
        ),
        pool.query(
          `SELECT pr.id, u.username AS requester, pr.amount_cents, ROUND(pr.amount_cents/100.0,2) AS amount_dollars, pr.note, pr.status, pr.created_at, pr.resolved_at
           FROM payment_requests pr JOIN users u ON u.id = pr.requester_id
           WHERE pr.recipient_id = $1 ORDER BY pr.created_at DESC`,
          [user.id]
        ),
      ]);

      const details = {
        user,
        transactions_sent: txnsSent.rows,
        transactions_received: txnsReceived.rows,
        payment_requests_sent: payReqsSent.rows,
        payment_requests_received: payReqsReceived.rows,
      };

      return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// Tool: get payment requests filtered by status
server.tool(
  "get_payment_requests_by_status",
  "List payment requests filtered by status: PENDING, PAID, DECLINED, or CANCELLED — with requester and recipient usernames",
  {
    status: z
      .enum(["PENDING", "PAID", "DECLINED", "CANCELLED"])
      .describe("Status to filter by"),
    limit: z.number().optional().describe("Max number of results to return (default 100)"),
  },
  async ({ status, limit = 100 }) => {
    try {
      const result = await pool.query(
        `SELECT pr.id,
                req.username AS requester,
                rec.username AS recipient,
                pr.amount_cents,
                ROUND(pr.amount_cents / 100.0, 2) AS amount_dollars,
                pr.note,
                pr.status,
                pr.created_at,
                pr.resolved_at
         FROM payment_requests pr
         JOIN users req ON req.id = pr.requester_id
         JOIN users rec ON rec.id = pr.recipient_id
         WHERE pr.status = $1
         ORDER BY pr.created_at DESC
         LIMIT $2`,
        [status, limit]
      );
      const text =
        result.rows.length === 0
          ? `No ${status} payment requests found.`
          : JSON.stringify(result.rows, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// Tool: get recent transaction history
server.tool(
  "get_transaction_history",
  "List recent transactions with sender and recipient usernames and amounts",
  {
    limit: z.number().optional().describe("Max number of results (default 50)"),
  },
  async ({ limit = 50 }) => {
    try {
      const result = await pool.query(
        `SELECT t.id,
                s.username AS sender,
                r.username AS recipient,
                t.amount_cents,
                ROUND(t.amount_cents / 100.0, 2) AS amount_dollars,
                t.note,
                t.created_at
         FROM transactions t
         JOIN users s ON s.id = t.sender_id
         JOIN users r ON r.id = t.recipient_id
         ORDER BY t.created_at DESC
         LIMIT $1`,
        [limit]
      );
      const text =
        result.rows.length === 0
          ? "No transactions found."
          : JSON.stringify(result.rows, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── Dashboard Chart Tools ───────────────────────────────────────────────────

server.tool(
  "get_transaction_volume_by_day",
  "Get daily transaction count and volume for the last N days (default 30), for charting",
  {
    days: z.number().optional().describe("Number of days to look back (default 30)"),
  },
  async ({ days = 30 }) => {
    try {
      const result = await pool.query(
        `SELECT DATE(created_at) AS date,
                COUNT(*) AS count,
                ROUND(SUM(amount_cents) / 100.0, 2) AS volume_dollars
         FROM transactions
         WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
         GROUP BY DATE(created_at)
         ORDER BY date ASC`
      );
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "get_top_users_by_balance",
  "Get the top N users ranked by their current balance (default top 10)",
  {
    limit: z.number().optional().describe("Number of users to return (default 10)"),
  },
  async ({ limit = 10 }) => {
    try {
      const result = await pool.query(
        `SELECT username, ROUND(balance_cents / 100.0, 2) AS balance_dollars
         FROM users
         ORDER BY balance_cents DESC
         LIMIT $1`,
        [limit]
      );
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "get_user_registrations_by_day",
  "Get daily new user registration counts for the last N days (default 30), for charting",
  {
    days: z.number().optional().describe("Number of days to look back (default 30)"),
  },
  async ({ days = 30 }) => {
    try {
      const result = await pool.query(
        `SELECT DATE(created_at) AS date, COUNT(*) AS count
         FROM users
         WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
         GROUP BY DATE(created_at)
         ORDER BY date ASC`
      );
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

server.tool(
  "get_payment_requests_summary_by_status",
  "Get count and total dollar amount of payment requests grouped by status, for charting",
  {},
  async () => {
    try {
      const result = await pool.query(
        `SELECT status,
                COUNT(*) AS count,
                ROUND(SUM(amount_cents) / 100.0, 2) AS total_dollars
         FROM payment_requests
         GROUP BY status
         ORDER BY count DESC`
      );
      return { content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// ─── End Analytics & Reporting Tools ────────────────────────────────────────

// Tool: get recently registered users
server.tool(
  "get_recent_users",
  "List users who registered recently, ordered by newest first. Optionally filter by number of days or limit results.",
  {
    days: z.number().optional().describe("Only show users who registered within this many days (e.g. 7 for last week). Omit for all users."),
    limit: z.number().optional().describe("Max number of users to return (default 20)"),
  },
  async ({ days, limit = 20 }) => {
    try {
      const params = [limit];
      const dateFilter = days
        ? `AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'`
        : "";

      const result = await pool.query(
        `SELECT id, username, balance_cents, ROUND(balance_cents / 100.0, 2) AS balance_dollars, created_at
         FROM users
         WHERE 1=1 ${dateFilter}
         ORDER BY created_at DESC
         LIMIT $1`,
        params
      );

      const text =
        result.rows.length === 0
          ? days
            ? `No users registered in the last ${days} day(s).`
            : "No users found."
          : JSON.stringify(result.rows, null, 2);

      return { content: [{ type: "text", text }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// Tool: clear test users (usernames containing "test")
server.tool(
  "clear_test_users",
  "Delete all users whose username contains 'test' (use before demos)",
  {},
  async () => {
    try {
      const result = await pool.query("DELETE FROM users WHERE username ILIKE '%test%'");
      return { content: [{ type: "text", text: `Deleted ${result.rowCount} test user(s).` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// Tool: create a new user
server.tool(
  "create_user",
  "Create a new user with a username and password. Balance defaults to $1000 (100000 cents).",
  {
    username: z.string().min(1).describe("Unique username for the new user"),
    password: z.string().min(6).describe("Plain-text password (will be hashed before storing)"),
    balance_cents: z.number().int().min(0).optional().describe("Starting balance in cents (default: 100000 = $1000)"),
  },
  async ({ username, password, balance_cents = 100000 }) => {
    try {
      const password_hash = crypto.createHash("sha256").update(password + "_c1pay_salt").digest("hex");
      const result = await pool.query(
        `INSERT INTO users (username, password_hash, balance_cents)
         VALUES ($1, $2, $3)
         RETURNING id, username, balance_cents, created_at`,
        [username, password_hash, balance_cents]
      );
      const user = result.rows[0];
      return {
        content: [{
          type: "text",
          text: `User created successfully:\n  ID: ${user.id}\n  Username: ${user.username}\n  Balance: $${(user.balance_cents / 100).toFixed(2)}\n  Created: ${user.created_at}`,
        }],
      };
    } catch (err) {
      if (err.code === "23505") {
        return { content: [{ type: "text", text: `Error: Username "${username}" is already taken.` }], isError: true };
      }
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

// Tool: delete a user by username or ID
server.tool(
  "delete_user",
  "Delete a user by username or numeric ID.",
  {
    identifier: z.union([z.string(), z.number().int()]).describe("Username (string) or user ID (number)"),
  },
  async ({ identifier }) => {
    try {
      const isId = typeof identifier === "number";
      const result = await pool.query(
        `DELETE FROM users WHERE ${isId ? "id" : "username"} = $1 RETURNING id, username`,
        [identifier]
      );
      if (result.rowCount === 0) {
        return { content: [{ type: "text", text: `No user found with ${isId ? "ID" : "username"} "${identifier}".` }], isError: true };
      }
      const { id, username } = result.rows[0];
      return { content: [{ type: "text", text: `Deleted user: ${username} (ID: ${id})` }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
