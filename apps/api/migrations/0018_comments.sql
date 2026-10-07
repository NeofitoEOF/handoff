BEGIN;

CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL REFERENCES requests(id),
  item_id uuid REFERENCES request_items(id),
  field_key text,
  author_user_id uuid REFERENCES users(id),
  guest_link_id uuid REFERENCES guest_links(id),
  text text NOT NULL CHECK (length(text) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (author_user_id IS NOT NULL AND guest_link_id IS NULL)
    OR (author_user_id IS NULL AND guest_link_id IS NOT NULL)
  )
);

CREATE INDEX idx_comments_request
  ON comments (tenant_id, request_id, created_at);

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_comments ON comments
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

COMMIT;
