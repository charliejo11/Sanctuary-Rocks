import type { Metadata } from "next";
import Image from "next/image";
import ForgedFooter from "../components/ForgedFooter";
import { cinzel, oswald, robotoCondensed } from "../contact/fonts";
import { distressed } from "../gallery/fonts";
import AboutListenButton from "./AboutListenButton";
import styles from "./about.module.css";

export const metadata: Metadata = {
  title: "About | Sanctuary Rocks",
  description:
    "A Second Life rock and metal club built for loud nights, hard music, misfit pixels, and the people who refuse to stand quietly in the back.",
};

// Links already used across the site.
const TELEPORT_URL = "http://maps.secondlife.com/secondlife/Rhage/160/106/24";
const DISCORD_URL = "https://discord.gg/239QyWDW4";

const A = "/images/about";
const LOGO = "/images/brand/sanctuary-rocks-logo-transparent.webp";

// Copy carried over from the original About poster.
const values = [
  {
    title: "Loud is the language",
    text: "Rock, hard rock, metal, requests, and DJs who know how to wake the room up.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M13.5 2 4 13.5h6.5L9 22l10-12.5h-6.6z" fill="currentColor" />
      </svg>
    ),
  },
  {
    title: "Misfits belong here",
    text: "Regulars, hosts, DJs, chaos gremlins, night owls, and anyone who needs a place to land.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 2.5c-4.4 0-7.5 3-7.5 7 0 2.5 1.2 4.4 3 5.4V17c0 .6.4 1 1 1h1v1.6c0 .5.4.9.9.9h3.2c.5 0 .9-.4.9-.9V18h1c.6 0 1-.4 1-1v-2.1c1.8-1 3-2.9 3-5.4 0-4-3.1-7-7.5-7ZM9 13a1.9 1.9 0 1 1 0-3.8A1.9 1.9 0 0 1 9 13Zm3 2.4-1.2-2h2.4Zm3-2.4a1.9 1.9 0 1 1 0-3.8 1.9 1.9 0 0 1 0 3.8Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
  {
    title: "Nobody rocks alone",
    text: "This is the whole heartbeat of the club. You show up, you’re part of the noise.",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M7 3.5c.8 0 1.5.7 1.5 1.5v6.2l.5-.1V8.5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5V11h.5V5c0-.8.7-1.5 1.5-1.5s1.5.7 1.5 1.5v8.4c0 4.2-3 7.1-6.8 7.1C8.2 20.5 5.5 18 5.5 14.4V5c0-.8.7-1.5 1.5-1.5Z"
          fill="currentColor"
        />
      </svg>
    ),
  },
];

function Divider() {
  return (
    <div className={styles.divider} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${A}/dividers/about-divider.webp`} alt="" loading="lazy" />
    </div>
  );
}

// About: intro banner, Who We Are, our values, the personality strip, the
// Maphra spotlight and the closing call to action. Everything is HTML over
// the About-page frame artwork.
export default function AboutPage() {
  return (
    <main className={`${styles.page} ${cinzel.variable} ${oswald.variable} ${robotoCondensed.variable} ${distressed.variable}`}>
      {/* ------------------------------------------------------------- banner */}
      <section className={styles.banner} aria-labelledby="about-title">
        <Image className={styles.bannerArt} src={`${A}/art/about-banner-art.webp`} alt="" fill priority sizes="100vw" />
        <div className={`${styles.wrap} ${styles.bannerInner}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.bannerLogo} src={LOGO} alt="" width={640} height={640} />
          <div>
            <h1 id="about-title" className={styles.title}>
              <span>This is</span>
              Sanctuary Rocks
            </h1>
            <p className={styles.lede}>
              A Second Life rock and metal club built for loud nights, hard music, misfit pixels, and the people who refuse to
              stand quietly in the back.
            </p>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- who we are */}
      <section className={`${styles.wrap} ${styles.who}`} aria-labelledby="who-title">
        <div className={styles.whoFrame}>
          <h2 id="who-title" className={styles.heading}>
            Who we are
          </h2>
          <p>
            Sanctuary Rocks is more than a club. It&rsquo;s a global community of rock and metal fans in Second Life.
          </p>
          <p>We&rsquo;re here for the music, the people, the good trouble, and the nights that turn into stories.</p>
          <p className={styles.motto}>Loud music. Real friends. No judgment. Just rock.</p>
        </div>
        <div className={styles.whoArt}>
          <Image
            src={`${A}/art/about-club-still-life.webp`}
            alt="A Marshall amp, a flying-V guitar, whiskey bottles and cards on a table"
            fill
            sizes="(max-width: 900px) 100vw, 560px"
          />
        </div>
      </section>

      <Divider />

      {/* -------------------------------------------------------------- values */}
      <section className={`${styles.wrap} ${styles.values}`} aria-label="What Sanctuary Rocks is about">
        {values.map((value) => (
          <article key={value.title} className={styles.valueCard}>
            <span className={styles.valueIcon}>{value.icon}</span>
            <h3 className={styles.valueTitle}>{value.title}</h3>
            <p className={styles.valueText}>{value.text}</p>
          </article>
        ))}
      </section>

      {/* -------------------------------------------------- personality strip */}
      <div className={`${styles.wrap} ${styles.strip}`}>
        <Image
          src={`${A}/art/about-personality-art.webp`}
          alt=""
          aria-hidden="true"
          width={1800}
          height={381}
          sizes="(max-width: 1400px) 96vw, 1320px"
        />
      </div>

      {/* ---------------------------------------------------- Maphra spotlight */}
      <section className={`${styles.wrap} ${styles.spotlight}`} aria-labelledby="spotlight-title">
        <div className={styles.titlePlate}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${A}/frames/about-spotlight-title-plate.webp`} alt="" aria-hidden="true" />
          <p className={styles.titlePlateText}>Sanctuary Spotlight</p>
        </div>
        <div className={styles.spotFrame}>
          <div className={styles.spotBody}>
            <h2 id="spotlight-title" className={styles.spotName}>
              Maphra
            </h2>
            <p className={styles.spotTag}>★ Official sponsored artist ★</p>
            <p>
              MAPHRA is an American metal and alternative vocalist with the kind of voice that makes people stop, rewind, and
              question what they just heard.
            </p>
            <p>
              Known for powerful covers, haunting melodies, and brutal vocal intensity, she moves between soft emotional tones
              and heavy screams with a control that feels almost unreal.
            </p>
            <p>
              Sanctuary Rocks is proud to sponsor MAPHRA and support an artist who brings raw energy, gothic atmosphere, and
              serious vocal power to the heavy music scene.
            </p>
          </div>
          <div className={styles.spotPhoto}>
            <Image src="/images/artists/maphra.jpg" alt="Maphra at the microphone in the studio" fill sizes="300px" />
          </div>
        </div>
      </section>

      <Divider />

      {/* ------------------------------------------------------ call to action */}
      <section className={`${styles.wrap} ${styles.cta}`} aria-labelledby="cta-title">
        <div className={styles.ctaPanel}>
          <div className={styles.ctaContent}>
            <h2 id="cta-title" className={styles.ctaTitle}>
              Sanctuary Rocks
            </h2>
            <p className={styles.ctaTag}>Hard rock. Heavy metal. Always loud.</p>
            <div className={styles.ctaButtons}>
              <AboutListenButton className={styles.ctaButton} />
              <a className={styles.ctaButton} href={TELEPORT_URL} target="_blank" rel="noopener noreferrer">
                Teleport to the club
              </a>
              <a className={styles.ctaButton} href={DISCORD_URL} target="_blank" rel="noopener noreferrer">
                Join our Discord
              </a>
            </div>
          </div>
        </div>
      </section>

      <ForgedFooter />
    </main>
  );
}
