import { normalizeForMatch } from "./crewTypes";

// Bio-only lookup for the Meet the Crew page's click-to-expand modal. This
// is deliberately NOT the source of truth for who's on the crew, their
// photo, or their on-card role - that's still the folder scan in
// app/lib/crewImages.ts (loadRoster), exactly as before, so dropping a new
// photo into public/images/djs or public/images/hosts still "just works"
// with no code change. This file only supplies bio text, looked up by
// name, and only for the modal.
//
// HOW TO ADD/EDIT A BIO: find the person below and paste their biography
// into the `bio` field (as a plain string). Leave it as "" to keep showing
// "Bio coming soon." on their card. Do not invent bios here - only real,
// provided text belongs in this file.
//
// Adding a brand-new crew member's photo to the image folder does not
// require an entry here - the modal will just show "Bio coming soon."
// for them until someone adds one.

export type CrewBioEntry = {
  id: string;
  name: string;
  role: "DJ" | "Host";
  image: string;
  bio: string;
};

export const CREW_BIOS: CrewBioEntry[] = [
  // ---- DJs (public/images/djs) ----
  { id: "dj-berry", name: "Berry", role: "DJ", image: "/images/djs/Berry.png.jpg", bio: "" },
  { id: "dj-angelo", name: "DJ Angelo", role: "DJ", image: "/images/djs/DJ%20Angelo.png.jpg", bio: "" },
  { id: "dj-bratty", name: "DJ Bratty", role: "DJ", image: "/images/djs/DJ%20Bratty.png.jpg", bio: "" },
  { id: "dj-calamity", name: "DJ Calamity", role: "DJ", image: "/images/djs/DJ%20Calamity.png.jpg", bio: "" },
  { id: "dj-charliejo", name: "DJ CharlieJo", role: "DJ", image: "/images/djs/DJ%20CharlieJo.png", bio: "" },
  { id: "dj-chellz", name: "DJ Chellz", role: "DJ", image: "/images/djs/DJ%20Chellz_.png.jpg", bio: "" },
  { id: "dj-corbyn", name: "DJ Corbyn", role: "DJ", image: "/images/djs/DJ%20Corbyn.png.jpg", bio: "" },
  { id: "dj-eros", name: "DJ Eros", role: "DJ", image: "/images/djs/DJ%20Eros.png.jpg", bio: "" },
  { id: "dj-hollywood", name: "DJ Hollywood", role: "DJ", image: "/images/djs/DJ%20Hollywood.png.jpg", bio: "" },
  { id: "dj-iggy", name: "DJ Iggy", role: "DJ", image: "/images/djs/DJ%20Iggy_.png.jpg", bio: "" },
  { id: "dj-jayme", name: "DJ Jayme", role: "DJ", image: "/images/djs/DJ%20Jayme.png.png", bio: "" },
  { id: "dj-kakou", name: "DJ Kakou", role: "DJ", image: "/images/djs/DJ%20Kakou.png.jpg", bio: "" },
  { id: "dj-kaya", name: "DJ Kaya", role: "DJ", image: "/images/djs/DJ%20Kaya.png.jpg", bio: "" },
  { id: "dj-krankee", name: "DJ Krankee", role: "DJ", image: "/images/djs/DJ%20Krankee.png.jpg", bio: "" },
  { id: "dj-lucky", name: "DJ Lucky", role: "DJ", image: "/images/djs/DJ%20Lucky_.png.jpg", bio: "" },
  { id: "dj-magas", name: "DJ Magas", role: "DJ", image: "/images/djs/DJ%20Magas.png.jpg", bio: "" },
  { id: "dj-sound", name: "DJ Sound", role: "DJ", image: "/images/djs/DJ%20Sound.png.png", bio: "" },
  { id: "dj-trelk", name: "DJ Trelk", role: "DJ", image: "/images/djs/DJ%20Trelk.png.png", bio: "" },
  { id: "dj-vandon", name: "DJ Vandon", role: "DJ", image: "/images/djs/DJ%20Vandon.png.png", bio: "" },
  { id: "dj-dann", name: "Dann", role: "DJ", image: "/images/djs/Dann.png.jpg", bio: "" },
  { id: "dj-manchester", name: "Manchester", role: "DJ", image: "/images/djs/Manchester.png.png", bio: "" },
  { id: "dj-moose", name: "Moose", role: "DJ", image: "/images/djs/Moose.png.jpg", bio: "" },
  { id: "dj-nashty", name: "Nashty", role: "DJ", image: "/images/djs/Nashty.png.jpg", bio: "" },
  { id: "dj-payne", name: "Payne", role: "DJ", image: "/images/djs/Payne.png.jpg", bio: "" },
  { id: "dj-peacy-graves", name: "Peacy.Graves", role: "DJ", image: "/images/djs/Peacy.Graves.png.jpg", bio: "" },
  { id: "dj-wylls", name: "Wylls", role: "DJ", image: "/images/djs/Wylls.png.jpg", bio: "" },

  // ---- Hosts (public/images/hosts) ----
  { id: "host-betsy", name: "Betsy", role: "Host", image: "/images/hosts/Betsy.png.jpg", bio: "" },
  { id: "host-dante", name: "Dante", role: "Host", image: "/images/hosts/Dante.png", bio: "" },
  { id: "host-domi", name: "Domi", role: "Host", image: "/images/hosts/Domi.png.jpg", bio: "" },
  { id: "host-ginny", name: "Ginny", role: "Host", image: "/images/hosts/Ginny.png.jpg", bio: "" },
  { id: "host-irish-beauty", name: "Irish Beauty", role: "Host", image: "/images/hosts/Irish_Beauty.png.png", bio: "" },
  { id: "host-justi", name: "Justi", role: "Host", image: "/images/hosts/Justi.png.png", bio: "" },
  { id: "host-legs", name: "Legs", role: "Host", image: "/images/hosts/Legs.png.png", bio: "" },
  { id: "host-lozzy", name: "Lozzy", role: "Host", image: "/images/hosts/Lozzy.png.jpg", bio: "" },
  { id: "host-mistine", name: "Mistine", role: "Host", image: "/images/hosts/Mistine.png.jpg", bio: "" },
  { id: "host-nawti", name: "Nawti", role: "Host", image: "/images/hosts/Nawti.png.jpg", bio: "" },
  { id: "host-nikcara", name: "Nikcara", role: "Host", image: "/images/hosts/Nikcara.png.jpg", bio: "" },
  { id: "host-rebekka", name: "Rebekka", role: "Host", image: "/images/hosts/Rebekka.png.png", bio: "" },
  { id: "host-rita", name: "Rita", role: "Host", image: "/images/hosts/Rita.png", bio: "" },
  { id: "host-shari", name: "Shari", role: "Host", image: "/images/hosts/Shari.png.jpg", bio: "" },
  { id: "host-skeeter", name: "Skeeter", role: "Host", image: "/images/hosts/Skeeter.png.jpg", bio: "" },
  { id: "host-troya", name: "Troya", role: "Host", image: "/images/hosts/Troya.png.png", bio: "" },
  { id: "host-victor", name: "Victor", role: "Host", image: "/images/hosts/Victor.png.jpg", bio: "" },
];

const BIO_BY_NORMALIZED_NAME = new Map(
  CREW_BIOS.map((entry) => [normalizeForMatch(entry.name), entry.bio]),
);

// Looks up a bio by display name (matches the same way calendar/roster
// names are matched elsewhere - case/spacing/punctuation-insensitive, and
// tolerant of a missing "DJ "/"Host " prefix). Returns undefined if there's
// no entry OR the entry's bio is still blank - callers should show "Bio
// coming soon." in either case.
export function findBio(name: string): string | undefined {
  const bio = BIO_BY_NORMALIZED_NAME.get(normalizeForMatch(name));
  return bio ? bio : undefined;
}
