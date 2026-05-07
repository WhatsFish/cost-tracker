-- cost_tracker: one events table, one event = one billable AI call.
--
-- Apply once with:
--   docker exec -i traffic-monitor-db-1 psql -U postgres -f /tmp/schema.sql
-- (or the equivalent superuser path; see README for the bootstrap script.)

-- Run as the umami superuser to create the role + db, then connect into it
-- to create the table.

-- Step 1 — role + db (run as a superuser):
--   CREATE ROLE cost_tracker WITH LOGIN PASSWORD '<from .env>';
--   CREATE DATABASE cost_tracker OWNER cost_tracker;
--   GRANT ALL PRIVILEGES ON DATABASE cost_tracker TO cost_tracker;

-- Step 2 — connect into cost_tracker DB and create the table:
CREATE TABLE IF NOT EXISTS cost_event (
  id              BIGSERIAL    PRIMARY KEY,
  ts              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- 'claude-code-agent' | 'foundry-interpret' | 'foundry-chat' | …
  service         TEXT         NOT NULL,
  -- 'anthropic' | 'azure-foundry'
  provider        TEXT         NOT NULL,
  -- e.g. 'claude-opus-4-7-1m', 'Llama-3.3-70B-Instruct'; nullable for runs where
  -- we don't know the model (Claude Code agent uses whatever its session settings
  -- decide).
  model           TEXT,

  input_tokens    INT,
  output_tokens   INT,

  -- Best estimate; for agent runs this is a flat per-run guess, for Foundry
  -- it's tokens × per-model rate.
  cost_usd        NUMERIC(12,6),

  -- Wall-clock duration of the call. Useful as a rough proxy for cost when
  -- tokens aren't available.
  duration_ms     INT,

  -- Free-form structured context: which agent script, which interpret target,
  -- the API response status, etc.
  metadata        JSONB        NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS cost_event_ts_idx      ON cost_event (ts DESC);
CREATE INDEX IF NOT EXISTS cost_event_service_idx ON cost_event (service, ts DESC);
