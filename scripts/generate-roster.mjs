// Generates app/data/djRoster.generated.json and hostRoster.generated.json:
// the full roster (name/role/image/bio/normalizedName), computed from
// public/images/djs and public/images/hosts the same way
// app/lib/crewImages.ts's loadRoster() does.
//
// Why this exists: /api/dj-roster and /api/host-roster need this data, but
// calling the real loadDjs()/loadHosts() (node:fs) at request time silently
// returns an empty roster on Cloudflare Workers - even with the route
// marked `force-static`, OpenNext still runs API Route Handlers as a Worker
// function rather than serving a true static asset, so there IS no
// filesystem when the code actually executes. A plain `next build` (no
// Cloudflare involved) produces the correct data at build time - confirmed
// by checking .next/server/app/api/dj-roster.body directly - so the real
// fix is precomputing it here into plain JSON the routes can import (no
// Node APIs, works identically whether served as an asset or run as a
// function). /api/lineup's DJ-name fallback matching also uses this now,
// instead of its own separate generated file.
//
// Run automatically via `npm run build`'s prebuild step. Safe to re-run any
// time - it only reads public/images/{djs,hosts} and overwrites the JSON.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = path.join(ROOT, "app", "data");

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const EXCLUDED_FILES = new Set(["default-dj.png", "Sanctuary Rocks DJ.png", "Sanctuary new logo.png"]);
const ROLE_PREFIXES = ["dj", "host"];

// Keep these in sync with app/data/crew.ts.
const DJ_DEFAULT_BIO = "Keeps the Sanctuary loud, wild, and rocking.";
const HOST_DEFAULT_BIO = "Keeping the crowd moving and the night alive.";
const SPONSOR_DEFAULT_BIO = "Proud supporter of Sanctuary Rocks.";
const DJ_OVERRIDES = {
  "DJ_Frenchie_Fry.jpg": { name: "DJ Frenchie" },
  "JIMMY_PROFILE_JUL25.png": { name: "DJ Jimmy" },
  "Zet_Solo_2026_2026-08-18_144403_001_crop.png": { name: "Zet Vortex" },
};
const HOST_OVERRIDES = {
  "Pepper_dragons.png": { name: "Pepper" },
  "Tea_Host.png": { name: "Tea" },
  "Troya__host.jpg": { name: "Troya" },
};
const SPONSOR_OVERRIDES = {
  "Ashes_to_Ashes_Logo.png": { name: "Ashes to Ashes" },
};

function stripAllExtensions(filename) {
  let base = filename;
  let ext = path.extname(base).toLowerCase();
  while (IMAGE_EXTENSIONS.has(ext)) {
    base = base.slice(0, -ext.length);
    ext = path.extname(base).toLowerCase();
  }
  return base;
}

function cleanDisplayName(filename) {
  const base = stripAllExtensions(filename);
  const spaced = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return spaced
    .split(" ")
    .map((word) => (/^[a-z0-9']+$/.test(word) ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

// Mirrors app/data/crewTypes.ts's normalizeForMatch exactly.
function normalizeForMatch(value) {
  let result = value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  for (const prefix of ROLE_PREFIXES) {
    const withSpace = `${prefix} `;
    if (result.startsWith(withSpace)) {
      result = result.slice(withSpace.length).trim();
      break;
    }
  }
  return result;
}

function listImageFiles(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isFile()) return false;
        if (entry.name.startsWith(".")) return false;
        if (EXCLUDED_FILES.has(entry.name)) return false;
        return IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase());
      })
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function buildRoster(folder, role, defaultBio, overrides) {
  return listImageFiles(path.join(ROOT, "public", "images", folder)).map((filename) => {
    const override = overrides[filename] ?? {};
    const name = override.name ?? cleanDisplayName(filename);
    return {
      name,
      role,
      image: `/images/${folder}/${encodeURIComponent(filename)}`,
      bio: override.bio ?? defaultBio,
      normalizedName: normalizeForMatch(name),
    };
  });
}

function write(filename, data) {
  const outFile = path.join(OUT_DIR, filename);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(data, null, 1) + "\n");
  console.log(`[generate-roster] wrote ${data.length} entr${data.length === 1 ? "y" : "ies"} to app/data/${filename}`);
}

write("djRoster.generated.json", buildRoster("djs", "Resident DJ", DJ_DEFAULT_BIO, DJ_OVERRIDES));
write("hostRoster.generated.json", buildRoster("hosts", "Host", HOST_DEFAULT_BIO, HOST_OVERRIDES));
write("sponsorRoster.generated.json", buildRoster("sponsors", "Sponsor", SPONSOR_DEFAULT_BIO, SPONSOR_OVERRIDES));
