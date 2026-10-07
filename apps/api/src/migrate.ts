import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const migrationUrl = process.env.MIGRATION_DATABASE_URL;
if (!migrationUrl) throw new Error("MIGRATION_DATABASE_URL is required.");

const appUser = process.env.APP_DATABASE_USER ?? "handoff_app";
const appPassword = process.env.APP_DATABASE_PASSWORD ?? "handoff_app";

if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(appUser)) {
  throw new Error("APP_DATABASE_USER contains invalid characters.");
}

function sqlLiteral(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}

function sqlIdentifier(value: string): string {
  return '"' + value.replaceAll('"', '""') + '"';
}

const client = new Client({ connectionString: migrationUrl });
await client.connect();

try {
  const role = await client.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists",
    [appUser],
  );

  if (!role.rows[0]?.exists) {
    await client.query(
      `CREATE ROLE "${appUser}" LOGIN PASSWORD ${sqlLiteral(appPassword)} NOBYPASSRLS`,
    );
  } else {
    await client.query(
      `ALTER ROLE "${appUser}" WITH LOGIN PASSWORD ${sqlLiteral(appPassword)} NOBYPASSRLS`,
    );
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrationsDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../migrations",
  );
  const files = (await fs.readdir(migrationsDir))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort();

  for (const filename of files) {
    const applied = await client.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [filename],
    );
    if (applied.rowCount === 1) continue;

    const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
    process.stdout.write(`[migrate] applying ${filename}\n`);
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1)",
      [filename],
    );
  }

  const databaseResult = await client.query<{ name: string }>(
    "SELECT current_database() AS name",
  );
  const databaseName = databaseResult.rows[0]!.name;

  await client.query(
    `GRANT CONNECT ON DATABASE ${sqlIdentifier(databaseName)} TO "${appUser}"`,
  );
  await client.query(`GRANT USAGE ON SCHEMA public TO "${appUser}"`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${appUser}"`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${appUser}"`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appUser}"`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${appUser}"`);

  process.stdout.write("[migrate] done\n");
} finally {
  await client.end();
}
