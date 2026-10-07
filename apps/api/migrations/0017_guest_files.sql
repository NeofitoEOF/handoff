BEGIN;

ALTER TABLE imports
  ALTER COLUMN uploaded_by DROP NOT NULL,
  ADD COLUMN uploaded_guest_link_id uuid REFERENCES guest_links(id);

ALTER TABLE attachments
  ALTER COLUMN uploaded_by DROP NOT NULL,
  ADD COLUMN uploaded_guest_link_id uuid REFERENCES guest_links(id);

ALTER TABLE imports
  ADD CONSTRAINT imports_uploader_check
  CHECK (
    (uploaded_by IS NOT NULL AND uploaded_guest_link_id IS NULL)
    OR (uploaded_by IS NULL AND uploaded_guest_link_id IS NOT NULL)
  );

ALTER TABLE attachments
  ADD CONSTRAINT attachments_uploader_check
  CHECK (
    (uploaded_by IS NOT NULL AND uploaded_guest_link_id IS NULL)
    OR (uploaded_by IS NULL AND uploaded_guest_link_id IS NOT NULL)
  );

COMMIT;
