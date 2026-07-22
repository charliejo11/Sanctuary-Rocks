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
// Biography IMAGES (public/images/Bios/*) are matched to a crew member
// automatically by name - see loadBioImages() in app/lib/crewImages.ts -
// so most people never need an entry here just to get their bio image
// connected. Only set `bioImage` below when a bio graphic's filename
// doesn't normalize to the same name as the crew photo (a typo, a
// shortened/expanded name, etc.) - see the four overrides below for real
// examples found in this repo.
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
  // Optional override for when public/images/Bios/<file> doesn't normalize
  // to the same name as `name` (see loadBioImages() in crewImages.ts).
  bioImage?: string;
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
  {
    id: "dj-magas",
    name: "DJ Magas",
    role: "DJ",
    image: "/images/djs/DJ%20Magas.png.jpg",
    bio: "",
    // Bio file is "Megas Bio.png.jpg" - doesn't match "Magas" (roster photo).
    bioImage: "/images/Bios/Megas%20Bio.png.jpg",
  },
  {
    id: "dj-sound",
    name: "DJ Sound",
    role: "DJ",
    image: "/images/djs/DJ%20Sound.png.png",
    bio: "",
    // Bio file is "DJ Soundtrack Bio.png.png" - doesn't match "DJ Sound".
    bioImage: "/images/Bios/DJ%20Soundtrack%20Bio.png.png",
  },
  { id: "dj-trelk", name: "DJ Trelk", role: "DJ", image: "/images/djs/DJ%20Trelk.png.png", bio: "" },
  { id: "dj-vandon", name: "DJ Vandon", role: "DJ", image: "/images/djs/DJ%20Vandon.png.png", bio: "" },
  {
    id: "dj-dann",
    name: "Dann",
    role: "DJ",
    image: "/images/djs/Dann.png.jpg",
    bio: "",
    // Bio file is "Daan Bio.png.jpg" - doesn't match "Dann" (roster photo).
    bioImage: "/images/Bios/Daan%20Bio.png.jpg",
  },
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
  {
    id: "host-justi",
    name: "Justi",
    role: "Host",
    image: "/images/hosts/Justi.png.png",
    bio: "",
    // Bio file is "Justina Bio.png.png" - doesn't match "Justi" (roster photo).
    bioImage: "/images/Bios/Justina%20Bio.png.png",
  },
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

const BIO_ENTRY_BY_NORMALIZED_NAME = new Map(
  CREW_BIOS.map((entry) => [normalizeForMatch(entry.name), entry]),
);

// Looks up a crew member's hand-edited bio entry (text + optional bioImage
// override) by display name - matches the same way calendar/roster names
// are matched elsewhere (case/spacing/punctuation-insensitive, tolerant of
// a missing "DJ "/"Host " prefix). Returns undefined if there's no entry
// for this name at all.
export function findBioEntry(name: string): CrewBioEntry | undefined {
  return BIO_ENTRY_BY_NORMALIZED_NAME.get(normalizeForMatch(name));
}
