BEGIN;

ALTER TABLE imports
  ADD COLUMN size_bytes bigint NOT NULL DEFAULT 0
  CHECK (size_bytes >= 0);

COMMIT;
