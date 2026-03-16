-- Initial schema for Felix
-- Migration 001 — applied once on first launch

CREATE TABLE IF NOT EXISTS projects (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  repo_url       TEXT NOT NULL,
  default_branch TEXT NOT NULL DEFAULT 'main',
  agent_runtime  TEXT NOT NULL DEFAULT 'claude-agent-sdk',
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tickets (
  id                     TEXT PRIMARY KEY,
  project_id             TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title                  TEXT NOT NULL,
  description            TEXT,
  acceptance_criteria    TEXT,
  test_commands          TEXT,
  additional_information TEXT,
  status                 TEXT NOT NULL DEFAULT 'TODO',
  branch_name            TEXT,
  pr_url                 TEXT,
  pr_number              INTEGER,
  blocked_reason         TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS executions (
  id            TEXT PRIMARY KEY,
  ticket_id     TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  mode          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'IN_PROGRESS',
  current_step  TEXT,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  started_at    TEXT NOT NULL,
  completed_at  TEXT
);

CREATE TABLE IF NOT EXISTS execution_logs (
  id            TEXT PRIMARY KEY,
  execution_id  TEXT NOT NULL REFERENCES executions(id) ON DELETE CASCADE,
  step          TEXT,
  message       TEXT NOT NULL,
  timestamp     TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tickets_project_id   ON tickets (project_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status        ON tickets (status);
CREATE INDEX IF NOT EXISTS idx_executions_ticket_id  ON executions (ticket_id);
CREATE INDEX IF NOT EXISTS idx_executions_status     ON executions (status);
CREATE INDEX IF NOT EXISTS idx_logs_execution_id     ON execution_logs (execution_id);
