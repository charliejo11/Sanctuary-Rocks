import type { Metadata } from "next";
import ForgedFooter from "../components/ForgedFooter";
import { cinzel, oswald, robotoCondensed } from "../contact/fonts";
import contact from "../contact/contact.module.css";
import ApplicationForm from "./ApplicationForm";
import styles from "./join.module.css";

export const metadata: Metadata = {
  title: "Join the Team | Sanctuary Rocks",
  description: "Apply to join the Sanctuary Rocks team. Applications go privately to Sanctuary Rocks management.",
};

const IMG = "/images/contact";

// Staff application page. Same dragon / forged-metal design as Contact (it
// reuses that page's hero, frames and dividers); the form posts privately to
// management through /api/apply.
export default function JoinPage() {
  return (
    <main className={`${contact.page} ${cinzel.variable} ${oswald.variable} ${robotoCondensed.variable}`}>
      <section className={`${contact.hero} ${styles.hero}`} aria-labelledby="join-title">
        <img className={`${contact.heroDragon} ${contact.heroDragonLeft}`} src={`${IMG}/hero/hero-dragon-left.webp`} alt="" aria-hidden="true" />
        <img className={`${contact.heroDragon} ${contact.heroDragonRight}`} src={`${IMG}/hero/hero-dragon-right.webp`} alt="" aria-hidden="true" />
        <img className={contact.heroEmbers} src={`${IMG}/overlays/ember-overlay.webp`} alt="" aria-hidden="true" />

        <div className={contact.heroContent}>
          <h1 id="join-title" className={contact.heroTitle}>
            <span className={`${contact.heroContact} ${styles.heroJoin}`}>Join the</span>
            <span className={`${contact.heroClub} ${styles.heroTeam}`}>Sanctuary Rocks Team</span>
          </h1>
          <p className={`${contact.heroText} ${styles.heroText}`}>
            Interested in becoming part of the Sanctuary Rocks team? Complete the application below. Your information is submitted privately
            to Sanctuary Rocks management for review.
          </p>
        </div>
      </section>

      <div className={contact.divider} aria-hidden="true">
        <img src={`${IMG}/dividers/dragon-divider.webp`} alt="" loading="lazy" />
      </div>

      <section className={`${contact.wrap} ${styles.formWrap}`} aria-labelledby="application-title">
        <article className={`${contact.panel} ${styles.formPanel}`}>
          <img className={contact.panelMedallion} src={`${IMG}/accents/dragon-medallion.webp`} alt="" aria-hidden="true" loading="lazy" />
          <h2 id="application-title" className={`${contact.panelTitle} ${styles.formTitle}`}>
            Team Application
          </h2>
          <ApplicationForm />
        </article>
      </section>

      <div className={`${contact.divider} ${contact.dividerCrest}`} aria-hidden="true">
        <img src={`${IMG}/dividers/dragon-wing-crest.webp`} alt="" loading="lazy" />
      </div>

      <ForgedFooter />
    </main>
  );
}
