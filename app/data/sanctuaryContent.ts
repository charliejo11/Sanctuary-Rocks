export const sanctuaryContent = {
  // OWNER EDITING GUIDE:
  // This is the main content file for Sanctuary Rocks Phase 1.
  // You can safely edit text values inside quotation marks, add future items to arrays,
  // and turn active flags on/off. Avoid renaming field names such as "title", "href",
  // or "active" unless the site code is updated too.

  site: {
    // Safe to edit: official site name used in metadata and future shared content.
    name: "Sanctuary Rocks",
    // Safe to edit: short search/social description for the site.
    description:
      "The official website for Sanctuary Rocks, the #1 Rock, Hard Rock & Heavy Metal club in Second Life.",
    // Safe to edit: short brand tagline. Keep this concise.
    tagline: "Hard. Fast. Loud.",
  },

  logo: {
    // Safe to edit: official logo artwork path in the public folder.
    imageSrc: "/images/hero/sanctuary-rocks-logo.png.png",
    // Safe to edit: where the logo links. "/" means homepage.
    homeHref: "/",
    // Safe to edit: accessibility label for screen readers.
    ariaLabel: "Sanctuary Rocks home",
  },

  footer: {
    // Safe to edit: short footer sentence.
    description: "Built for rock, hard rock, and heavy metal nights in Second Life.",
    // Safe to edit: footer tagline. Keep this short so it fits neatly on small screens.
    tagline: "Hard. Fast. Loud.",
  },

  navigation: [
    {
      // Safe to edit: label shown in the header navigation.
      label: "HOME",
      // Safe to edit: link target. Use "/" for the homepage or an anchor such as "#future-sections".
      href: "/",
      // Safe to edit: set one item to true to show the active page highlight.
      active: true,
    },
    {
      label: "ABOUT",
      href: "#future-sections",
      active: false,
    },
    {
      label: "EVENTS",
      href: "#future-sections",
      active: false,
    },
    {
      label: "DJ LINEUP",
      href: "#future-sections",
      active: false,
    },
    {
      label: "GALLERY",
      href: "#future-sections",
      active: false,
    },
    {
      label: "CREW",
      href: "#future-sections",
      active: false,
    },
    {
      label: "CONTACT",
      href: "#future-sections",
      active: false,
    },
  ],

  hero: {
    // Safe to edit: small line above the main headline.
    eyebrow: "The #1 Rock, Hard Rock & Heavy Metal club in Second Life",
    // Safe to edit: main hero headline.
    headline: "HARD. FAST. LOUD.",
    // Safe to edit: short paragraph under the headline.
    description:
      "Sanctuary Rocks is where the stage lights burn hot, the guitars hit harder, and the night belongs to the crowd.",
    // Safe to edit: main call-to-action button text.
    ctaLabel: "Join the Sanctuary",
    // Safe to edit: main call-to-action target.
    ctaHref: "#future-sections",
  },

  events: [
    {
      // Safe to edit carefully: stable internal id. Use lowercase words separated by hyphens.
      id: "friday-heavy-metal-night",
      // Safe to edit: event title shown in future event cards/calendars.
      title: "Heavy Metal Night",
      // Safe to edit: club or venue name.
      venue: "Sanctuary Rocks",
      // Safe to edit: day of the week or date text.
      day: "Friday",
      // Safe to edit: time label. SLT means Second Life Time.
      time: "10 PM SLT",
      // Safe to edit: short style or theme note.
      theme: "Rock, Hard Rock & Heavy Metal",
      // Safe to edit: set to true when this should appear on the live site later.
      active: true,
    },
  ],

  djs: [
    {
      // Safe to edit carefully: stable internal id. Use lowercase words separated by hyphens.
      id: "dj-charliejo",
      // Safe to edit: public DJ name.
      name: "DJ CharlieJo",
      // Safe to edit: short role or residency label.
      role: "Sanctuary Rocks DJ",
      // Safe to edit: main genres or sound.
      genres: ["Rock", "Hard Rock", "Heavy Metal"],
      // Safe to edit: short promo line for future DJ sections.
      tagline: "Crank it up. Bust the knob off.",
      // Safe to edit: set to true when this DJ should appear on the live site later.
      active: true,
    },
  ],

  liveStatus: {
    // Safe to edit: set this to true when Sanctuary Rocks is live on air.
    isLive: false,
    // Safe to edit: short label for radio/live sections.
    label: "Radio status",
    // Safe to edit: message shown when live.
    liveText: "Sanctuary Rocks is live now.",
    // Safe to edit: message shown when not live.
    offlineText: "The stage is quiet for now. Check back for the next set.",
    // Safe to edit: optional stream or listening URL for a future player.
    streamUrl: "",
  },

  announcements: [
    {
      // Safe to edit carefully: stable internal id. Use lowercase words separated by hyphens.
      id: "phase-one",
      // Safe to edit: announcement headline.
      title: "Sanctuary Rocks website foundation is underway.",
      // Safe to edit: short announcement body.
      message:
        "Phase 1 sets up the club identity, shell, and data structure before full homepage sections are added.",
      // Safe to edit: optional date label for future announcement cards.
      dateLabel: "Phase 1",
      // Safe to edit: set to true when this announcement should appear later.
      active: true,
    },
  ],

  galleryPlaceholders: [
    {
      // Safe to edit carefully: stable internal id. Use lowercase words separated by hyphens.
      id: "stage-lights",
      // Safe to edit: label for a future gallery item.
      title: "Stage Lights",
      // Safe to edit: image path for future real photos. Leave blank until an image is ready.
      imageSrc: "",
      // Safe to edit: alt text for accessibility once an image is added.
      alt: "Sanctuary Rocks stage lights",
    },
    {
      id: "dance-floor",
      title: "Dance Floor",
      imageSrc: "",
      alt: "Sanctuary Rocks dance floor",
    },
    {
      id: "dj-booth",
      title: "DJ Booth",
      imageSrc: "",
      alt: "Sanctuary Rocks DJ booth",
    },
  ],

  clubFeatures: [
    {
      // Safe to edit carefully: stable internal id. Use lowercase words separated by hyphens.
      id: "heavy-music",
      // Safe to edit: feature title for future club feature sections.
      title: "Heavy Music",
      // Safe to edit: short description for future feature cards.
      description: "Rock, hard rock, metal, and high-energy nights built for loud sets.",
    },
    {
      id: "second-life-club",
      title: "Second Life Club",
      description: "A virtual venue for music, dancing, and Sanctuary Rocks community nights.",
    },
    {
      id: "friday-energy",
      title: "Friday Energy",
      description: "Weekly hard rock atmosphere with room for future event details.",
    },
  ],
} as const;

export type SanctuaryContent = typeof sanctuaryContent;
export type SanctuaryHeroContent = SanctuaryContent["hero"];
