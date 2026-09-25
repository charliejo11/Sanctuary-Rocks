import type { Metadata } from "next";
import ForgedFooter from "../components/ForgedFooter";
import ContactCrewCard from "./ContactCrewCard";
import { cinzel, oswald, robotoCondensed } from "./fonts";
import { generalManagers, owners } from "./staffData";
import styles from "./contact.module.css";

export const metadata: Metadata = {
  title: "Contact | Sanctuary Rocks",
  description: "Questions, bookings, applications, or ready to join the crew? Contact Sanctuary Rocks.",
};

const TELEPORT_URL = "http://maps.secondlife.com/secondlife/Rhage/160/106/24";
const GRIDSTER_URL = "https://gridster.elfavina89.workers.dev";
const DISCORD_URL = "https://discord.gg/239QyWDW4";
const VIP_APPLICATION_URL = "https://discord.gg/GdsJeQDnc";

const IMG = "/images/contact";

// Moose (owner) sits in the middle, a little larger, between the managers.
const [peacy, ...otherManagers] = generalManagers;

function TeleportIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 6.5c-2.3 0-4 1.8-4 4 0 3 4 7 4 7s4-4 4-7c0-2.2-1.7-4-4-4zm0 5.4a1.4 1.4 0 110-2.8 1.4 1.4 0 010 2.8z" fill="currentColor" />
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M20.3 4.4a19.8 19.8 0 00-4.9-1.5l-.6 1.3a18.3 18.3 0 00-5.5 0l-.6-1.3a19.7 19.7 0 00-4.9 1.5C.5 9 -.3 13.6.1 18.1a19.9 19.9 0 006 3l1.2-2a13 13 0 01-1.9-.9l.4-.3a14.2 14.2 0 0012.1 0l.4.3c-.6.4-1.2.7-1.9.9l1.2 2a19.8 19.8 0 006-3c.5-5.2-.8-9.7-3.5-13.7zM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4z"
      />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M2.5 12h19M12 2.5c2.6 2.6 3.9 5.8 3.9 9.5s-1.3 6.9-3.9 9.5M12 2.5C9.4 5.1 8.1 8.3 8.1 12s1.3 6.9 3.9 9.5M4.2 7h15.6M4.2 17h15.6" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1.2 1.2" />
      <path d="M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1.2-1.2" />
    </svg>
  );
}

/** Molten metal button with an icon and a chevron. */
function ForgedButton({ href, icon, children }: { href: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <a className={styles.button} href={href} target="_blank" rel="noopener noreferrer">
      <span className={styles.buttonIcon}>{icon}</span>
      <span>{children}</span>
      <span className={styles.chevron} aria-hidden="true">
        »
      </span>
    </a>
  );
}

function Divider({ crest = false }: { crest?: boolean }) {
  return (
    <div className={`${styles.divider} ${crest ? styles.dividerCrest : ""}`} aria-hidden="true">
      <img src={`${IMG}/dividers/${crest ? "dragon-wing-crest" : "dragon-divider"}.webp`} alt="" loading="lazy" />
    </div>
  );
}

// Contact page: dragon/forged-metal design. All text, links and buttons are
// real HTML; the dragon artwork is transparent decoration layered around it.
export default function ContactPage() {
  return (
    <main className={`${styles.page} ${cinzel.variable} ${oswald.variable} ${robotoCondensed.variable}`}>
      {/* ---------------------------------------------------------------- hero */}
      <section className={styles.hero} aria-labelledby="contact-title">
        <img className={`${styles.heroDragon} ${styles.heroDragonLeft}`} src={`${IMG}/hero/hero-dragon-left.webp`} alt="" aria-hidden="true" />
        <img className={`${styles.heroDragon} ${styles.heroDragonRight}`} src={`${IMG}/hero/hero-dragon-right.webp`} alt="" aria-hidden="true" />
        <img className={styles.heroEmbers} src={`${IMG}/overlays/ember-overlay.webp`} alt="" aria-hidden="true" />

        <div className={styles.heroContent}>
          <h1 id="contact-title" className={styles.heroTitle}>
            <span className={styles.heroContact}>Contact</span>
            <span className={styles.heroClub}>Sanctuary Rocks</span>
          </h1>
          <p className={styles.heroText}>
            Questions, bookings, applications,
            <br />
            or ready to join the crew?
          </p>
          <a className={styles.heroCta} href={TELEPORT_URL} target="_blank" rel="noopener noreferrer">
            <img src={`${IMG}/frames/dragon-banner-frame.webp`} alt="" aria-hidden="true" />
            <span className={styles.heroCtaLabel}>
              <span className={styles.buttonIcon}>
                <TeleportIcon />
              </span>
              Teleport to Sanctuary Rocks
            </span>
          </a>
        </div>
      </section>

      <Divider />

      {/* --------------------------------------------- application / visit */}
      <section className={`${styles.wrap} ${styles.twoUp}`} aria-label="Work with us and visit the club">
        <article className={`${styles.panel} ${styles.applyPanel}`}>
          <img className={styles.panelMedallion} src={`${IMG}/accents/dragon-medallion.webp`} alt="" aria-hidden="true" loading="lazy" />
          <h2 className={styles.panelTitle}>Work Application</h2>
          <p className={styles.panelText}>
            Want to work at Sanctuary Rocks? Join our crew! We are always looking for talented DJs, hosts, and creators.
          </p>
          <ul className={styles.steps}>
            <li>Join our VIP Discord</li>
            <li>Grab the application</li>
            <li>Apply to join the crew</li>
          </ul>
          <ForgedButton href={VIP_APPLICATION_URL} icon={<DiscordIcon />}>
            Apply in Discord
          </ForgedButton>
        </article>

        <article className={`${styles.panel} ${styles.visitPanel}`}>
          <h2 className={styles.panelTitle}>Visit Our Club</h2>
          <p className={styles.panelText}>Click below to teleport straight to Sanctuary Rocks.</p>
          <figure className={styles.clubImage}>
            <img
              src={`${IMG}/club/sanctuary-rocks-castle-1400.webp`}
              srcSet={`${IMG}/club/sanctuary-rocks-castle-760.webp 760w, ${IMG}/club/sanctuary-rocks-castle-1400.webp 1400w`}
              sizes="(min-width: 1000px) 560px, 90vw"
              alt="The Sanctuary Rocks castle on its volcanic peak, guarded by a fire-breathing dragon"
              width={1400}
              height={788}
              loading="lazy"
            />
            <img className={`${styles.clubCorner} ${styles.clubCornerTl}`} src={`${IMG}/accents/dragon-corner-frame.webp`} alt="" aria-hidden="true" loading="lazy" />
            <img className={`${styles.clubCorner} ${styles.clubCornerBr}`} src={`${IMG}/accents/dragon-corner-frame.webp`} alt="" aria-hidden="true" loading="lazy" />
          </figure>
          <ForgedButton href={TELEPORT_URL} icon={<TeleportIcon />}>
            Teleport Now
          </ForgedButton>
        </article>
      </section>

      <Divider crest />

      {/* ---------------------------------------------------------------- crew */}
      <section className={styles.crewSection} aria-labelledby="crew-title">
        <img className={`${styles.chain} ${styles.chainLeft}`} src={`${IMG}/accents/chain-vertical.webp`} alt="" aria-hidden="true" loading="lazy" />
        <img className={`${styles.chain} ${styles.chainRight}`} src={`${IMG}/accents/chain-vertical.webp`} alt="" aria-hidden="true" loading="lazy" />

        <header className={styles.sectionHead}>
          <h2 id="crew-title" className={styles.sectionTitle}>
            Meet the Crew
          </h2>
          <p className={styles.sectionSub}>Owners &amp; Management</p>
        </header>

        <div className={`${styles.wrap} ${styles.crewGrid}`}>
          {peacy && <ContactCrewCard member={peacy} />}
          {owners.map((member) => (
            <ContactCrewCard key={member.name} member={member} featured />
          ))}
          {otherManagers.map((member) => (
            <ContactCrewCard key={member.name} member={member} />
          ))}
        </div>
        <p className={styles.crewHint}>Tap a card for contact details</p>
      </section>

      <Divider crest />

      {/* --------------------------------------------------------------- links */}
      <section className={styles.linksSection} aria-labelledby="links-title">
        <header className={styles.sectionHead}>
          <h2 id="links-title" className={styles.sectionTitle}>
            Our Official Links
          </h2>
        </header>

        <div className={`${styles.wrap} ${styles.twoUp}`}>
          <article className={`${styles.panel} ${styles.linkPanel}`}>
            <span className={styles.medallion}>
              <img src={`${IMG}/accents/dragon-medallion.webp`} alt="" aria-hidden="true" loading="lazy" />
              <span className={`${styles.medallionIcon} ${styles.gridsterIcon}`}>
                <GlobeIcon />
              </span>
            </span>
            <div className={styles.linkBody}>
              <p className={styles.linkKicker}>Join our</p>
              <h3 className={styles.linkTitle}>Gridster</h3>
              <p className={styles.panelText}>All our links in one place!</p>
              <ForgedButton href={GRIDSTER_URL} icon={<LinkIcon />}>
                Visit Gridster
              </ForgedButton>
            </div>
          </article>

          <article className={`${styles.panel} ${styles.linkPanel}`}>
            <span className={styles.medallion}>
              <img src={`${IMG}/accents/dragon-medallion.webp`} alt="" aria-hidden="true" loading="lazy" />
              <span className={`${styles.medallionIcon} ${styles.discordIcon}`}>
                <DiscordIcon />
              </span>
            </span>
            <div className={styles.linkBody}>
              <p className={styles.linkKicker}>Join our</p>
              <h3 className={styles.linkTitle}>Discord</h3>
              <p className={styles.panelText}>Chat, hang out, get updates, and be part of the crew!</p>
              <ForgedButton href={DISCORD_URL} icon={<DiscordIcon />}>
                Join Discord
              </ForgedButton>
            </div>
          </article>
        </div>

        <img className={styles.chainDrape} src={`${IMG}/accents/chain-horizontal.webp`} alt="" aria-hidden="true" loading="lazy" />
      </section>

      <ForgedFooter />
    </main>
  );
}
