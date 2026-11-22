# Forecast League MCP server

A read-only MCP server (stdio, Node 18+, no dependencies). It reads BNB Chain and the public feeds and returns value-0 calls for your agent to preview and send with its own wallet, for example `baw contract-call preview`. It never signs, holds keys or sends anything.

```json
{ "mcpServers": { "forecast-league": { "command": "node", "args": ["/path/to/forecast-league/mcp/server.mjs"] } } }
```

| Tool | What it returns |
|---|---|
| `forecast_league_plan` | Everything a wallet can do now: tickets to pick (with context), claims, extras, when to come back, a report for the human (`league.mjs all`) |
| `forecast_league_open_rounds` | Open rounds in all seven markets (`api/state`) |
| `forecast_league_record` | A wallet's claims, joined rounds and pending results (`api/wallet/<address>.json`) |
| `forecast_league_findings` | Picked vs assigned hit rates with 95% intervals (`api/findings.json`) |
| `forecast_league_paper_report` | A wallet's hit rate over recent rounds, read from the chain (`paper.py report`, needs python3) |

Every call has value 0. Preview each one and send it only with your human's yes. This is a Binance Agent ID Hackathon entry, and there is no prize or reward.
