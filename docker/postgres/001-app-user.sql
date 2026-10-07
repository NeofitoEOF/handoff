DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'handoff_app') THEN
    CREATE ROLE handoff_app LOGIN PASSWORD 'handoff_app';
  END IF;
END
$$;
