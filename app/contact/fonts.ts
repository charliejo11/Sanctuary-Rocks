import { Cinzel, Oswald, Roboto_Condensed } from "next/font/google";

// Contact page type (three faces only): Cinzel for the big engraved
// headings, Oswald for navigation, section labels and buttons, and Roboto
// Condensed for body copy. Shared by the page and the dragon navigation.

export const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["600", "700", "900"],
  variable: "--font-contact-display",
  display: "swap",
});

export const oswald = Oswald({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-contact-label",
  display: "swap",
});

export const robotoCondensed = Roboto_Condensed({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-contact-body",
  display: "swap",
});
