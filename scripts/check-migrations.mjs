import fs from "node:fs";
import path from "node:path";

const dir = path.resolve("apps/api/migrations");
const files = fs.readdirSync(dir)
  .filter((name) => /^\d{4}_.+\.sql$/.test(name))
  .sort();

if (files.length === 0) {
  throw new Error("No migrations found.");
}

const seen = new Map();
const errors = [];

for (const file of files) {
  const prefix = Number(file.slice(0, 4));

  if (seen.has(prefix)) {
    errors.push(
      `duplicate migration prefix ${String(prefix).padStart(4, "0")}: ${seen.get(prefix)} and ${file}`,
    );
  } else {
    seen.set(prefix, file);
  }
}

const prefixes = [...seen.keys()].sort((a, b) => a - b);
for (let i = 0; i < prefixes.length; i += 1) {
  const expected = i + 1;
  if (prefixes[i] !== expected) {
    errors.push(
      `migration sequence gap: expected ${String(expected).padStart(4, "0")} but found ${String(prefixes[i]).padStart(4, "0")}`,
    );
    break;
  }
}

const destructivePatterns = [
  { name: "DROP TABLE", regex: /\bDROP\s+TABLE\b/i },
  { name: "DROP COLUMN", regex: /\bDROP\s+COLUMN\b/i },
  { name: "DROP SCHEMA", regex: /\bDROP\s+SCHEMA\b/i },
  { name: "DROP TYPE", regex: /\bDROP\s+TYPE\b/i },
  { name: "TRUNCATE", regex: /\bTRUNCATE(?:\s+TABLE)?\b/i },
  { name: "DELETE FROM", regex: /\bDELETE\s+FROM\b/i },
];

function stripComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--.*$/gm, " ");
}

for (const file of files) {
  const fullPath = path.join(dir, file);
  const raw = fs.readFileSync(fullPath, "utf8");
  const allowDestructive = /^--\s*migration-safety:\s*allow-destructive\s+reason=.+$/im.test(raw);
  const sql = stripComments(raw);

  const detected = destructivePatterns
    .filter(({ regex }) => regex.test(sql))
    .map(({ name }) => name);

  if (detected.length > 0 && !allowDestructive) {
    errors.push(
      `${file}: destructive SQL detected (${detected.join(", ")}). Add "-- migration-safety: allow-destructive reason=<justification>" only after explicit review.`,
    );
  }
}

if (errors.length > 0) {
  console.error("Migration safety check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Migration safety check passed for ${files.length} migrations (${files[0]} .. ${files.at(-1)}).`);
