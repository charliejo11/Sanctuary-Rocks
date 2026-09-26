// Types and pure helpers shared by both the server-side folder loader
// (app/data/crew.ts, which touches node:fs and must stay server-only) and
// client components like CrewCarouselOverlay. Nothing here imports Node
// built-ins, so it's safe to bundle for the browser.

export type CrewMember = {
  name: string;
  role: string;
  image: string;
  bio: string;
  quote?: string;
  // Canonical match key (see normalizeForMatch below). Optional because
  // hand-written data (e.g. app/data/hosts.json, now unused) never set it.
  normalizedName?: string;
};

export type SponsorEntry = {
  name: string;
  image: string;
  bio: string;
};

// Official Sanctuary Rocks logo, reused as a safe fallback whenever a DJ or
// host photo is missing/unmatched/fails to load in the browser.
export const FALLBACK_LOGO = "/images/brand/sanctuary-rocks-logo.png";

const ROLE_PREFIXES = ["dj", "host"];

// Produces a canonical key for matching a free-form name (from a calendar
// event, a filename, anything) against roster entries: lowercase, drop
// punctuation, and treat spaces/hyphens/underscores as the same separator
// so "DJ_Lucky", "dj-lucky", and "DJ Lucky" all normalize to "lucky". Strips
// one leading role word (DJ/Host) so a bare name still matches its profile.
// Pure (no Node built-ins) so it can be imported from client components.
export function normalizeForMatch(value: string): string {
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

// Finds the roster entry whose normalized name best matches `query` (e.g. a
// DJ/host name pulled from a calendar event). Guards against a short or
// generic query wrongly matching an unrelated crew member: substring
// matches only count once the shorter of the two strings is long enough to
// be a meaningful name fragment, and an exact normalized match always wins.
const MIN_SUBSTRING_MATCH_LENGTH = 3;

export function findRosterMatch<T extends { name: string; normalizedName?: string }>(
  query: string,
  roster: T[],
): T | undefined {
  const normalizedQuery = normalizeForMatch(query);
  if (!normalizedQuery) return undefined;

  const nameOf = (entry: T) => entry.normalizedName ?? normalizeForMatch(entry.name);

  const exact = roster.find((entry) => nameOf(entry) === normalizedQuery);
  if (exact) return exact;

  return roster.find((entry) => {
    const normalizedEntry = nameOf(entry);
    if (!normalizedEntry) return false;

    const shorter = Math.min(normalizedEntry.length, normalizedQuery.length);
    if (shorter < MIN_SUBSTRING_MATCH_LENGTH) return false;

    return normalizedEntry.includes(normalizedQuery) || normalizedQuery.includes(normalizedEntry);
  });
}

// Shuffles the whole list (not a truncated pick) - the carousel needs every
// entry available to page through via its arrows, not just one random batch.
export function shuffleCrew<T>(pool: T[]): T[] {
  const shuffled = [...pool];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

// Returns `count` items starting at `startIndex`, wrapping around to the
// front of the list when it runs past the end.
export function getVisibleItems<T>(items: T[], startIndex: number, count: number): T[] {
  if (items.length === 0) {
    return [];
  }

  const visible: T[] = [];

  for (let i = 0; i < Math.min(count, items.length); i += 1) {
    visible.push(items[(startIndex + i) % items.length]);
  }

  return visible;
}

// Photo aliases for calendar DJ names that don't match a roster photo by
// their own name: a roster filename spelled differently, or someone who DJs
// but only has a photo in the Host folder. Exact normalized-key lookup only
// (never fuzzy), used by the DJ Lineup page and the Home page's Now On Air.
const DJ_PHOTO_ALIASES: Record<string, { source: "dj" | "host"; name: string }> = {
  daan: { source: "dj", name: "Dann" }, // calendar says "DJ Daan"; roster photo is "Dann.png.jpg"
  domi: { source: "host", name: "Domi" }, // calendar says "DJ Domi"; only a Host photo exists
  molokai: { source: "dj", name: "Moloaki" }, // calendar says "DJ Molokai"; roster photo is "Moloaki.png"
};

/** The roster entry (with photo) for a DJ name from the calendar. */
export function findDjProfile<T extends { name: string; normalizedName?: string }>(
  djName: string,
  djRoster: T[],
  hostRoster: T[] = [],
): T | undefined {
  if (!djName) return undefined;
  const direct = findRosterMatch(djName, djRoster);
  if (direct) return direct;
  const alias = DJ_PHOTO_ALIASES[normalizeForMatch(djName)];
  if (!alias) return undefined;
  return findRosterMatch(alias.name, alias.source === "host" ? hostRoster : djRoster);
}

