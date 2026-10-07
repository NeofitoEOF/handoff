import fs from "node:fs";

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const changelog = fs.readFileSync("CHANGELOG.md", "utf8");
const version = pkg.version;

if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid package.json version: ${String(version)}`);
}

const tag = process.env.RELEASE_TAG;
if (tag && tag !== `v${version}`) {
  throw new Error(`Release tag ${tag} does not match package version v${version}.`);
}

const lines = changelog.split(/\r?\n/);
const headingPrefix = `## [${version}]`;
const start = lines.findIndex((line) => line === headingPrefix || line.startsWith(`${headingPrefix} - `));

if (start < 0) {
  throw new Error(`CHANGELOG.md must contain a section for [${version}].`);
}

let end = lines.length;
for (let i = start + 1; i < lines.length; i += 1) {
  if (lines[i].startsWith("## [")) {
    end = i;
    break;
  }
}

const block = lines.slice(start + 1, end).join("\n").trim();
if (block.length < 20) {
  throw new Error(`CHANGELOG section [${version}] is empty or too small.`);
}

console.log(`Release metadata valid for v${version}.`);
