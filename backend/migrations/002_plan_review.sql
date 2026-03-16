-- Plan review: add plan fields to tickets and conversation table

ALTER TABLE tickets ADD COLUMN plan TEXT;
ALTER TABLE tickets ADD COLUMN require_plan_review INTEGER NOT NULL DEFAULT 1;

CREATE TABLE plan_messages (
    id         TEXT PRIMARY KEY,
    ticket_id  TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK(role IN ('agent', 'human')),
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_plan_messages_ticket ON plan_messages(ticket_id, created_at);
