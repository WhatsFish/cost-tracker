# cost-tracker

AI spend dashboard for the services on
**https://ai-native.japaneast.cloudapp.azure.com/**.

Logs one row per billable AI call to a single Postgres table, aggregates
by day / service / model on `/cost`.

## Why

Two services on this VM cost real money:

1. **`claude-code-agent`** — the headless `claude -p` invocations the cron
   triggers twice a day. Subscription quota; observed budget ~$0.50–$1.00
   per run.
2. **`foundry-interpret`** — the live "AI explain" button on `/feed`,
   calling Azure AI Foundry per click.

Before this dashboard existed, the cost was a black box that surfaced
only on the monthly Azure / Anthropic bill. Now: month-to-date is one
glance away, and an unexpected spike (e.g. a runaway prompt) is visible
in hours instead of weeks.

## What's NOT here

Authoritative billing — that lives in Azure Cost Management for Foundry
and your Anthropic console for Claude. This dashboard is an *estimate*
based on observed budget caps + per-model published rates. Useful for
"is the spend roughly what I expect today" rather than "what does the
bill say".

Specifically:

- Claude Code agent: no per-call API to read exact $. We log a flat
  `AGENT_COST_USD_ESTIMATE` per run (default $0.50). Tune via env as
  observed real usage changes.
- Foundry: tokens come from `usage` in the response; cost is
  `input_tokens × in_rate + output_tokens × out_rate`. Per-model rates
  hardcoded in `ai-feed/web/src/lib/cost-log.ts`.

## Layout

```
cost-tracker/
├── docker-compose.yml         web container, joins traffic-monitor's network
├── nginx/cost-tracker.conf    reverse-proxy snippet at /cost
├── db/schema.sql              cost_event table
└── web/                       Next.js 14 dashboard
    ├── src/
    │   ├── app/page.tsx       totals + 30d stacked-bar chart + recent-events table
    │   └── lib/db.ts          ad-hoc Postgres client
    ├── Dockerfile
    └── package.json
```

## Schema

```sql
cost_event (
  id            BIGSERIAL PK,
  ts            TIMESTAMPTZ DEFAULT NOW(),
  service       TEXT       -- 'claude-code-agent' | 'foundry-interpret' | …
  provider      TEXT       -- 'anthropic' | 'azure-foundry'
  model         TEXT
  input_tokens  INT
  output_tokens INT
  cost_usd      NUMERIC(12,6)
  duration_ms   INT
  metadata      JSONB
)
```

Add a new service: just start writing rows with the new `service` value.
The dashboard auto-discovers it (the `SERVICES` const in `page.tsx` is
for chart legend ordering only — extend it if you want the new service
to show in the stacked bar legend).

## Where rows come from

| Service             | Where it's logged                                                | Token data | Cost basis           |
| ------------------- | ---------------------------------------------------------------- | ---------- | -------------------- |
| `claude-code-agent` | `~/src/ai-feed/scripts/run-agent.sh` (psql via `docker exec`)    | none       | `AGENT_COST_USD_ESTIMATE` env, default $0.50 |
| `foundry-interpret` | `~/src/ai-feed/web/src/app/api/interpret/route.ts` → `lib/cost-log.ts` | from response.usage | tokens × per-model rate |

To add a new logged caller (e.g. ai-playground chat), copy the pattern
from `interpret/route.ts`: capture `chatComplete` result, `void
logCostEvent({...})` after the response is sent.

## Bring it up

```bash
# 1. Bootstrap role + db (one-time, run as a Postgres superuser)
docker exec -i traffic-monitor-db-1 psql -U umami -d umami <<EOF
CREATE ROLE cost_tracker WITH LOGIN PASSWORD '<gen with openssl rand -hex 16>';
CREATE DATABASE cost_tracker OWNER cost_tracker;
GRANT ALL PRIVILEGES ON DATABASE cost_tracker TO cost_tracker;
EOF
# Then connect into cost_tracker as that role and apply db/schema.sql.

# 2. Stash the password where the agent shell script can read it
cat > ~/.config/cost-tracker.env <<EOF
COST_PG_HOST=127.0.0.1
COST_PG_PORT=5432
COST_PG_USER=cost_tracker
COST_PG_PASSWORD=<from step 1>
COST_PG_DB=cost_tracker
COST_DB_CONTAINER=traffic-monitor-db-1
EOF
chmod 600 ~/.config/cost-tracker.env

# 3. Set the same password (under different env var name) in ai-feed's .env
#    and restart the ai-feed container so /api/interpret can connect.

# 4. Set the same password in this project's .env
cp .env.example .env  # then fill PG_PASSWORD

# 5. Build and bring up
docker compose build
docker compose up -d

# 6. Wire nginx
sudo cp nginx/cost-tracker.conf /etc/nginx/snippets/
# add `include snippets/cost-tracker.conf;` to the personal-site server block
sudo nginx -t && sudo systemctl reload nginx
```

## What's not here yet

- **Authoritative reconciliation.** Pulling actual numbers from Azure
  Cost Management and the Anthropic API would let us flag drift between
  estimate and reality. Doable; not yet built.
- **Alerts.** Could publish a 5xx from a small "is my cost ahead of
  pace" endpoint that UptimeRobot watches — same trick `/status` uses.
- **Per-model breakdown.** Chart only stacks by service, not by model.
  Switching a Foundry deployment from Llama 70B to GPT-4o would change
  costs dramatically and the chart would just show "more orange".
