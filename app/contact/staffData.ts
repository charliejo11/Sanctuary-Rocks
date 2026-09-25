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
//
// `cardImage` is an optional smaller copy used on the crew card (the
// full `image` still shows in the pop-up).

export type StaffMember = {
  name: string;
  role: "Owner" | "General Manager";
  image: string;
  cardImage?: string;
  imagePosition?: string;
  slDisplayName?: string;
  slUsername?: string;
  discord?: string;
  profileUrl?: string;
  bio?: string;
};

// Each person gets their own dragon-framed card on the Contact page, so
// adding or removing someone here is all it takes.
export const owners: StaffMember[] = [
  {
    name: "Moose Houston",
    role: "Owner",
    image: "/images/owners/moose.png.jpg",
    // Card copy is cropped inside that baked-in gold border.
    cardImage: "/images/contact/crew/moose-720.webp",
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
    cardImage: "/images/contact/crew/peacy-720.webp",
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
    cardImage: "/images/contact/crew/troya-720.webp",
    imagePosition: "center top",
    slDisplayName: "",
    slUsername: "",
    discord: "troya_fm",
    profileUrl: "",
    bio: "",
  },
];
