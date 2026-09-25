import { Rubik_Distressed } from "next/font/google";

// Distressed metal display face for the big "GALLERY" title. The rest of the
// page reuses the redesign's Oswald and Roboto Condensed (app/contact/fonts).
export const distressed = Rubik_Distressed({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-gallery-display",
  display: "swap",
});
