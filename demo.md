# c1pay DB MCP Server — Demo

## What this is

An MCP (Model Context Protocol) server that gives Claude direct access to the `c1pay` PostgreSQL database. Claude can write and run its own SQL queries without any middleman app.

Normally when you use Claude in an app, the flow looks like this:

```
You → App → App queries DB → App sends results to Claude → Claude responds
```

The app acts as the middleman — it decides what data to fetch, runs the query, and hands Claude the results as text.

With MCP, the flow is:

```
You → Claude → Claude calls the query tool → DB → Claude responds
```

There's no app in between. Claude itself decides what SQL to write, calls the `query` tool directly, gets the raw rows back, and uses that to answer you. For example, when you ask "how many users are registered?", Claude writes `SELECT COUNT(*) FROM users` and runs it itself.

---

## How it works

When Claude Code starts, it loads this MCP server (`src/index.js`) as a subprocess. The server:

1. Checks if Postgres is running via `pg_ctl status`
2. If not running, starts it automatically via `pg_ctl start`
3. Opens Postgres.app GUI so the status indicator stays in sync
4. Connects to the `c1pay` database
5. Exposes three tools Claude can call directly

---

## Tools available to Claude

| Tool | What it does |
|---|---|
| `query` | Runs a read-only `SELECT` (or `WITH`) SQL query |
| `list_tables` | Lists all tables in the database |
| `describe_table` | Shows columns and types for a given table |

Only `SELECT` and `WITH` queries are allowed — no writes, deletes, or schema changes.

---

## MCP vs. your other app

Your other app also uses Claude with this database, but the architecture is different:

| | Other app | This MCP setup |
|---|---|---|
| Who writes the SQL | The app's backend | Claude |
| Who controls data exposure | The app (filters/shapes data) | Claude (direct DB access) |
| Requires the app to be running | Yes | No |
| Claude can explore schema freely | No | Yes |
| Security boundary | The app's API layer | Read-only query restriction in `index.js` |

In your other app, Claude is a **reader** — it receives data the app already fetched. Here, Claude is an **active agent** — it decides what to query and drives the database itself.

---

## Testing the MCP server

### 1. In Claude Code (primary method)
Just ask Claude questions about the database. It will call the tools automatically.

Example queries you can ask:
- "How many users are registered?"
- "Show me all transactions"
- "Describe the users table"

### 2. MCP Inspector (visual UI)
```bash
npx @modelcontextprotocol/inspector node src/index.js
```
Opens a browser UI where you can call each tool manually and inspect raw inputs/outputs. Good for debugging.

---

## Project structure

```
mcp-setup/
├── src/
│   └── index.js       # MCP server — tools, DB connection, Postgres auto-start
├── .mcp.json          # Tells Claude Code how to launch this MCP server
├── package.json
└── .gitignore
```

### `.mcp.json`
Registers the server with Claude Code:
```json
{
  "mcpServers": {
    "c1pay-db": {
      "command": "node",
      "args": ["/Users/vindhyasurampudi/Documents/Workspace/mcp-setup/src/index.js"]
    }
  }
}
```

---

## Database

- **Host:** localhost:5432
- **Database:** c1pay
- **Managed by:** Postgres.app (v18)
- **ORM/migrations:** Drizzle

Tables: `users`, `transactions`, `drizzle.__drizzle_migrations`

---

## Auto-start behavior

The server always ensures Postgres is running on startup. If you see Postgres.app showing "stopped" but Claude can still query the DB — that's expected. The server started Postgres via `pg_ctl` directly, and opening Postgres.app will reflect the running state.
