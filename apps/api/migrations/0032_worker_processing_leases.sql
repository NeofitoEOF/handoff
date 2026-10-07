BEGIN;

ALTER TABLE email_outbox
  ADD COLUMN processing_started_at timestamptz;

ALTER TABLE teams_outbox
  ADD COLUMN processing_started_at timestamptz;

ALTER TABLE webhook_outbox
  ADD COLUMN processing_started_at timestamptz;

ALTER TABLE closure_documents
  ADD COLUMN processing_started_at timestamptz;

CREATE INDEX idx_email_outbox_claimable
  ON email_outbox (tenant_id, status, available_at, processing_started_at)
  WHERE status IN ('PENDING', 'FAILED', 'PROCESSING');

CREATE INDEX idx_teams_outbox_claimable
  ON teams_outbox (tenant_id, status, available_at, processing_started_at)
  WHERE status IN ('PENDING', 'FAILED', 'PROCESSING');

CREATE INDEX idx_webhook_outbox_claimable
  ON webhook_outbox (tenant_id, status, available_at, processing_started_at)
  WHERE status IN ('PENDING', 'FAILED', 'PROCESSING');

CREATE INDEX idx_closure_documents_claimable
  ON closure_documents (tenant_id, status, available_at, processing_started_at)
  WHERE status IN ('PENDING', 'FAILED', 'PROCESSING');

COMMIT;
