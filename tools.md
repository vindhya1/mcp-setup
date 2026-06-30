# MCP Server Tools

## Core

| Tool | Description |
|------|-------------|
| `query` | Run a read-only SQL SELECT query |
| `list_tables` | List all tables in the database |
| `describe_table` | Show columns and types for a table |

## Analytics & Reporting

| Tool | Description |
|------|-------------|
| `get_dashboard_summary` | High-level stats overview |
| `get_all_users` | List all users with balance info |
| `get_user_details` | Full details for a single user |
| `get_payment_requests_by_status` | Payment requests filtered by status |
| `get_transaction_history` | Recent transactions |
| `get_recent_users` | Recently registered users |

## Dashboard Charts

| Tool | Description |
|------|-------------|
| `get_transaction_volume_by_day` | Transaction volume over N days |
| `get_top_users_by_balance` | Top N users by balance |
| `get_user_registrations_by_day` | Signup counts by day |
| `get_payment_requests_summary_by_status` | Payment request breakdown |

## User Management

| Tool | Description |
|------|-------------|
| `create_user` | Create a new user |
| `delete_user` | Delete a user by username or ID |
| `clear_test_users` | Delete all users with "test" in username |
