import type { CrewMember, SponsorEntry } from "./crewTypes";
import { cleanDisplayName, listImageFiles, loadRoster } from "../lib/crewImages";

// Server-only: reads the public/images/{djs,hosts,owners,managers,sponsors}
// folders via app/lib/crewImages.ts (node:fs). Never import this file from a
// "use client" component - it will break the browser bundle. Client
// components that need CrewMember/SponsorEntry or the shuffle/pagination
// helpers should import from "./crewTypes" instead.

export const DJ_DEFAULT_BIO = "Keeps the Sanctuary loud, wild, and rocking.";
export const HOST_DEFAULT_BIO = "Keeping the crowd moving and the night alive.";
export const OWNER_DEFAULT_BIO = "Runs the Sanctuary.";
export const MANAGER_DEFAULT_BIO = "Keeps the Sanctuary running smoothly.";
export const SPONSOR_DEFAULT_BIO = "Proud supporter of Sanctuary Rocks.";

type CrewOverride = Partial<Pick<CrewMember, "name" | "role" | "bio" | "quote">>;

// Optional per-person overrides, keyed by the exact image filename on disk
// (see public/images/djs, public/images/hosts, public/images/sponsors).
// Anything not listed here falls back to the cleaned filename as the name,
// the default role, and the default bio above - so new photos "just work"
// the moment they're dropped into the folder, no code change required.
const DJ_OVERRIDES: Record<string, CrewOverride> = {
  "DJ RICK BLOOD.png": { name: "DJ Rick Blood" },
  "DJ Rose - Profile - 09 30 2026.png": { name: "DJ Rose" },
  "DJ_Frenchie_Fry.jpg": { name: "DJ Frenchie" },
  "JIMMY_PROFILE_JUL25.png": { name: "DJ Jimmy" },
  "Zet_Solo_2026_2026-08-18_144403_001_crop.png": { name: "Zet Vortex" },
};
const HOST_OVERRIDES: Record<string, CrewOverride> = {
  "Nikcara_Snorty_Nutcase.png": { name: "Nikcara" },
  "Pepper_dragons.png": { name: "Pepper" },
  "Tea_cyber.png": { name: "Tea" },
  "Troya__host.jpg": { name: "Troya" },
};

export { cleanDisplayName };

// defaultBio is overridable per page (e.g. the DJ Lineup page uses its own
// default line) - a per-person DJ_OVERRIDES entry still wins either way.
export function loadDjs(defaultBio: string = DJ_DEFAULT_BIO): CrewMember[] {
  return loadRoster("djs", "Resident DJ", defaultBio, DJ_OVERRIDES);
}

export function loadHosts(): CrewMember[] {
  return loadRoster("hosts", "Host", HOST_DEFAULT_BIO, HOST_OVERRIDES);
}

export function loadOwners(): CrewMember[] {
  return loadRoster("owners", "Owner", OWNER_DEFAULT_BIO);
}

export function loadManagers(): CrewMember[] {
  return loadRoster("managers", "Manager", MANAGER_DEFAULT_BIO);
}

export function loadSponsors(): SponsorEntry[] {
  return loadRoster("sponsors", "Sponsor", SPONSOR_DEFAULT_BIO);
}

// Raw filenames for a role folder, exposed for pages that need to key
// lookups (e.g. contact-info overrides) off the file on disk rather than
// the roster's cleaned display name.
export { listImageFiles };


