// Owner / General Manager roster for the Contact page staff cards.
//
// This is the ONLY place you need to touch to add or update someone's
// contact information. Every field below except `name`, `role`, and
// `image` is optional - the popup only shows a row when that field
// actually has a value in it, so leaving something blank (or deleting
// the line entirely) simply hides that row rather than showing an
// empty one. Nothing here is invented; blank fields stay blank until
// you fill them in.
//
// `imagePosition` is not contact info - it is a CSS object-position
// value (e.g. "center top", "center 20%") that keeps the right part of
// the photo visible once it's cropped to fit inside the frame opening.
// Adjust it if a new photo crops awkwardly; everyone else's is untouched.

export type StaffMember = {
  name: string;
  role: "Owner" | "General Manager";
  image: string;
  imagePosition?: string;
  slDisplayName?: string;
  slUsername?: string;
  discord?: string;
  profileUrl?: string;
  bio?: string;
};

// The artwork has 3 Owner frames and 2 General Manager frames baked in.
// Add up to that many entries per group and the layout in page.tsx will
// place them automatically (a single Owner is centered; two take the
// outer two frames). Going beyond 3 owners / 2 managers needs new
// artwork before it can be wired up.
export const owners: StaffMember[] = [
  {
    name: "Moose Houston",
    role: "Owner",
    image: "/images/owners/moose.png.jpg",
    // The source photo has its own "Moose Houston / SR Owner" gold-frame
    // border baked in at the top and bottom - this crops past it so only
    // the portrait shows inside our frame, instead of a frame-in-a-frame.
    imagePosition: "center 40%",
    slDisplayName: "",
    slUsername: "",
    discord: "JackSteel#7603",
    profileUrl: "",
    bio: "",
  },
];

export const generalManagers: StaffMember[] = [
  {
    name: "Peacy",
    role: "General Manager",
    image: "/images/managers/Peacy.Graves.png.jpg",
    imagePosition: "center 12%",
    slDisplayName: "",
    slUsername: "",
    discord: "Peacy Snapping Input#6788",
    profileUrl: "",
    bio: "",
  },
  {
    name: "Troya",
    role: "General Manager",
    image: "/images/managers/Troya GM.jpg",
    imagePosition: "center top",
    slDisplayName: "",
    slUsername: "",
    discord: "troya_fm",
    profileUrl: "",
    bio: "",
  },
];
