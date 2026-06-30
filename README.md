# c1pay PostgreSQL MCP Server

An MCP (Model Context Protocol) server that exposes the c1pay PostgreSQL database as tools that any AI app (Claude Code, Claude Desktop, custom agents) can call directly. No REST API needed — the AI talks to the database through this server.

---

## How It Works

```
┌─────────────────────┐        MCP (stdio)        ┌──────────────────────────┐
│   AI App / Claude   │  ◄──────────────────────►  │  postgres-db-mcp-server  │
│  (Claude Code,      │     tools over JSON-RPC     │     (this repo)          │
│   c1pay-analytics)  │                             └────────────┬─────────────┘
└─────────────────────┘                                          │ pg client
                                                                 ▼
                                                     ┌───────────────────────┐
                                                     │  PostgreSQL (c1pay)   │
                                                     │  localhost:5432       │
                                                     └───────────────────────┘
```

1. The AI app loads this server via `.mcp.json` — no HTTP, no port, just a local process.
2. On startup, the server checks if Postgres is running and starts it if not.
3. The AI calls tools by name (e.g. `get_dashboard_summary`). The server runs the SQL and returns JSON.
4. The AI uses the result to answer questions, build UI, or chain further tool calls.

---

## Prerequisites

- **Node.js** 18+
- **Postgres.app** installed at `/Applications/Postgres.app` (macOS)
- A local PostgreSQL database named `c1pay`

---

## Setup

```bash
git clone https://github.com/vindhya1/mcp-setup.git
cd mcp-setup
npm install
```

No environment variables are required. The server connects as the current OS user (`$USER`) to `localhost:5432/c1pay`. If your database requires a password, uncomment the `password` line in `src/index.js` and set `PGPASSWORD`.

---

## Database Schema

| Table | Key Columns |
|---|---|
| `users` | `id`, `username`, `balance_cents`, `created_at` |
| `transactions` | `id`, `sender_id`, `recipient_id`, `amount_cents`, `note`, `created_at` |
| `payment_requests` | `id`, `requester_id`, `recipient_id`, `amount_cents`, `note`, `status`, `created_at`, `resolved_at` |

Payment request statuses: `PENDING` · `PAID` · `DECLINED` · `CANCELLED`

---

## Tools Reference

### Schema Tools

| Tool | Description | Parameters |
|---|---|---|
| `list_tables` | List all tables in the database | — |
| `describe_table` | Show columns and types for a table | `table_name` (required), `schema` (optional, default `public`) |
| `query` | Run any read-only `SELECT` or `WITH` query | `sql` (required) |

### Analytics & Reporting Tools

| Tool | Description | Parameters |
|---|---|---|
| `get_dashboard_summary` | KPI overview: total users, transaction volume, payment request counts by status | — |
| `get_all_users` | All registered users with balance and join date | — |
| `get_recent_users` | Users who registered recently, newest first | `days` (optional), `limit` (optional, default 20) |
| `get_user_details` | Full profile for one user: balance + all transactions + all payment requests | `identifier` — username or numeric user ID |
| `get_payment_requests_by_status` | Payment requests filtered by status, with requester/recipient usernames | `status` (`PENDING`/`PAID`/`DECLINED`/`CANCELLED`), `limit` (optional, default 100) |
| `get_transaction_history` | Recent transactions with sender/recipient names and amounts | `limit` (optional, default 50) |
| `get_transaction_volume_by_day` | Daily transaction count and volume for the last N days (for charts) | `days` (optional, default 30) |
| `get_user_registrations_by_day` | Daily new user registration counts for the last N days (for charts) | `days` (optional, default 30) |
| `get_top_users_by_balance` | Top N users ranked by current balance | `limit` (optional, default 10) |
| `get_payment_requests_summary_by_status` | Count and total dollars per payment request status (for charts) | — |

### Admin Tools

| Tool | Description | Parameters |
|---|---|---|
| `clear_test_users` | Delete all users whose username contains "test" | — |

---

## Testing Locally

### Option A — Claude Code (recommended)

Claude Code automatically picks up `.mcp.json` from the project root.

```bash
# In this repo
claude
```

Then just ask naturally:

```
Show me a dashboard summary
Who registered in the last 7 days?
Show me all declined payment requests
Give me full details for user "alice"
What's the daily transaction volume over the last 14 days?
```

### Option B — MCP Inspector (browser UI)

The MCP Inspector lets you call tools manually without an AI.

```bash
npx @modelcontextprotocol/inspector node src/index.js
```

Open the URL printed in the terminal (usually `http://localhost:5173`). You'll see all tools listed — click one, fill in parameters, and run it.

### Option C — Run the server directly

```bash
npm start
```

The server speaks JSON-RPC over stdio. You'll see:
```
Connected to c1pay database
```

You can pipe raw MCP JSON to it for debugging, but the Inspector (Option B) is easier.

---

## Using This Server in Another App

Add a `.mcp.json` to your other repo pointing to the absolute path of this server:

```json
{
  "mcpServers": {
    "c1pay-db": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-setup/src/index.js"]
    }
  }
}
```

The analytics app **c1pay-analytics** (`github.com/vindhya1/c1pay-analytics`) already has this wired in.

---

## Example Tool Outputs

**`get_dashboard_summary`**
```json
{
  "users": {
    "total": 42,
    "total_balance_dollars": "8340.00"
  },
  "transactions": {
    "total": 187,
    "total_volume_dollars": "24500.00"
  },
  "payment_requests_by_status": [
    { "status": "CANCELLED", "count": 5, "total_dollars": "320.00" },
    { "status": "DECLINED",  "count": 12, "total_dollars": "1450.00" },
    { "status": "PENDING",   "count": 8,  "total_dollars": "980.00" },
    { "status": "PAID",      "count": 63, "total_dollars": "9200.00" }
  ]
}
```

**`get_payment_requests_by_status` with `status: "DECLINED"`**
```json
[
  {
    "id": 14,
    "requester": "alice",
    "recipient": "bob",
    "amount_dollars": "25.00",
    "note": "dinner",
    "status": "DECLINED",
    "created_at": "2025-06-15T10:23:00Z",
    "resolved_at": "2025-06-15T11:00:00Z"
  }
]
```
