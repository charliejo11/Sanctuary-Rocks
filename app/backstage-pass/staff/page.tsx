import type { Metadata } from "next";
import { cinzel, oswald, robotoCondensed } from "../../contact/fonts";
import StaffApp from "./StaffApp";
import styles from "./staff.module.css";

export const metadata: Metadata = {
  title: "Backstage Pass — Staff Only | Sanctuary Rocks",
  description: "Sanctuary Rocks staff access.",
  robots: { index: false, follow: false },
};

// This page holds no staff data. Everything private is fetched after sign-in, and the backend checks every request.
export default function StaffPage() {
  return (
    <main className={`${styles.page} ${cinzel.variable} ${oswald.variable} ${robotoCondensed.variable}`}>
      <StaffApp />
    </main>
  );
}
