import fs from "node:fs";
import path from "node:path";
import { normalizeForMatch } from "../data/crewTypes";

// Server-only: reads public/images/<folder> via node:fs. Never import this
// from a "use client" component - it will break the browser bundle. Client
// components should receive the resulting data via props or an API route,
// and can still import the pure `normalizeForMatch`/`findRosterMatch`
// helpers directly from "../data/crewTypes" (no Node built-ins there).

export type RosterEntry = {
  name: string;
  role: string;
  image: string;
  bio: string;
  normalizedName: string;
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

// Filenames that are placeholder/fallback art, not a real crew member.
const EXCLUDED_FILES = new Set(["default-dj.png"]);

function stripAllExtensions(filename: string): string {
  let base = filename;
  let ext = path.extname(base).toLowerCase();

  while (IMAGE_EXTENSIONS.has(ext)) {
    base = base.slice(0, -ext.length);
    ext = path.extname(base).toLowerCase();
  }

  return base;
}

// Cleans a raw filename into a display-ready name: strips every recognized
// image extension (handles accidental double extensions like ".png.jpg"),
// swaps separators for spaces, and capitalizes any word that arrived fully
// lowercase (so "chellz" -> "Chellz") without touching words that already
// carry their own casing (so "DJ Bratty" is left alone, not "Dj Bratty").
export function cleanDisplayName(filename: string): string {
  const base = stripAllExtensions(filename);

  const spaced = base
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return spaced
    .split(" ")
    .map((word) => (/^[a-z0-9']+$/.test(word) ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
}

// Lists the valid image filenames directly inside public/images/<folder>,
// sorted alphabetically. Ignores hidden files (.DS_Store, ...), non-image
// extensions, known placeholder art, and subdirectories - so an "_archived"
// folder used to retire old images is invisible here without extra logic.
export function listImageFiles(folder: string): string[] {
  const dir = path.join(process.cwd(), "public", "images", folder);

  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isFile()) return false;
        if (entry.name.startsWith(".")) return false;
        if (EXCLUDED_FILES.has(entry.name)) return false;

        const ext = path.extname(entry.name).toLowerCase();
        return IMAGE_EXTENSIONS.has(ext);
      })
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

type RosterOverride = Partial<Pick<RosterEntry, "name" | "bio">>;

// Reads a role folder and returns one RosterEntry per image, in the shape
// used across the site (crew page, contact page, lineup roster APIs).
export function loadRoster(
  folder: string,
  role: string,
  defaultBio: string,
  overrides: Record<string, RosterOverride> = {},
): RosterEntry[] {
  return listImageFiles(folder).map((filename) => {
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

// Re-exported for convenience so server-side code can import everything
// (folder scanning + the fallback logo constant) from one place. The
// canonical definition lives in crewTypes.ts because it's a plain string
// with no Node dependency, so client components can import it too.
export { FALLBACK_LOGO } from "../data/crewTypes";
