// Adds a portal user and a one-time, 24 hour sign-in code, for first access before Discord sign-in is configured.
// Only the code's hash goes in the database. The code itself is written to --out, never to the screen.
//   node scripts/bootstrap_staff.mjs --env staging --name "Moose" --roles owner --out <private file>
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const env = arg("env"), name = arg("name"), roles = (arg("roles") ?? "").split(",").filter(Boolean), out = arg("out");
if (!env || !name || !roles.length || !out) throw new Error("need --env --name --roles --out");
if (env !== "staging" && !process.argv.includes("--i-mean-it")) throw new Error("only staging without --i-mean-it");
const dbName = env === "staging" ? "sr2-staging" : env;
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const code = randomBytes(24).toString("base64url");
const hash = createHash("sha256").update(code).digest("hex");
const now = Date.now();
const sql = `INSERT INTO portal_users(display_name, roles, created_by, created_at) SELECT ${q(name)}, ${q(JSON.stringify(roles))}, 'bootstrap', ${now} WHERE NOT EXISTS (SELECT 1 FROM portal_users WHERE display_name = ${q(name)});
INSERT INTO portal_recovery(code_hash, user_id, created_by, created_at, expires_at) SELECT ${q(hash)}, id, 'bootstrap', ${now}, ${now + 24 * 3600e3} FROM portal_users WHERE display_name = ${q(name)};`;
const dir = mkdtempSync(join(tmpdir(), "sr-bootstrap-"));
const file = join(dir, "add.sql");
writeFileSync(file, sql);
try {
  execFileSync("npx", ["wrangler", "d1", "execute", dbName, "--env", env, "--remote", "-c", "wrangler.toml", "--yes", "--file", `"${file}"`], { stdio: "ignore", shell: true });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
appendFileSync(out, `${name}\t${roles.join(",")}\t${code}\n`);
console.log(`added ${name} (${roles.join(",")}); code written to the --out file`);
