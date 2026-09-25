import type { Metadata } from "next";
import ForgedFooter from "../components/ForgedFooter";
import { oswald, robotoCondensed } from "../contact/fonts";
import galleryData from "../data/gallery.json";
import { distressed } from "./fonts";
import GalleryGrid, { type GalleryPhoto } from "./GalleryGrid";
import styles from "./gallery.module.css";

type GalleryData = { title: string; subtitle: string; photos: GalleryPhoto[] };

const data = galleryData as GalleryData;
const ART = "/images/gallery/art";

export const metadata: Metadata = {
  title: "Gallery | Sanctuary Rocks",
  description: "Captured moments. Unforgettable nights. This is Sanctuary Rocks.",
};

// Gallery: cinematic dragon artwork top and bottom, a chain divider, and every
// photo from app/data/gallery.json in a photo-first grid with numbered pages.
export default function GalleryPage() {
  return (
    <main className={`${styles.page} ${distressed.variable} ${oswald.variable} ${robotoCondensed.variable}`}>
      {/* ---------------------------------------------------------------- hero */}
      <section className={styles.hero} aria-labelledby="gallery-title">
        <img
          className={styles.art}
          src={`${ART}/gallery-hero-art-1916.webp`}
          srcSet={`${ART}/gallery-hero-art-960.webp 960w, ${ART}/gallery-hero-art-1916.webp 1916w`}
          sizes="100vw"
          alt=""
          aria-hidden="true"
          width={1916}
          height={821}
          fetchPriority="high"
        />
        <div className={styles.heroContent}>
          <img className={styles.logo} src="/images/brand/sanctuary-rocks-logo-transparent.webp" alt="Sanctuary Rocks" width={640} height={640} />
          <h1 id="gallery-title" className={styles.title}>
            Gallery
          </h1>
          <p className={styles.tagline}>
            <span className={styles.rule} aria-hidden="true" />
            <span>
              Captured moments. Unforgettable nights.
              <br />
              This is Sanctuary Rocks.
            </span>
            <span className={styles.rule} aria-hidden="true" />
          </p>
        </div>
      </section>

      {/* ------------------------------------------------ chain / metal divider */}
      <div className={styles.divider} aria-hidden="true">
        <span className={`${styles.chainRun} ${styles.chainLeft}`} />
        <span className={styles.ornament} />
        <span className={`${styles.chainRun} ${styles.chainRight}`} />
      </div>

      {/* ------------------------------------------------------------- photos */}
      <section className={styles.photos} aria-label="Gallery photos">
        <GalleryGrid photos={data.photos} />
      </section>

      {/* --------------------------------------------------------- bottom art */}
      <section className={styles.closing} aria-labelledby="gallery-closing">
        <img
          className={styles.art}
          src={`${ART}/gallery-footer-art-1916.webp`}
          srcSet={`${ART}/gallery-footer-art-960.webp 960w, ${ART}/gallery-footer-art-1916.webp 1916w`}
          sizes="100vw"
          alt=""
          aria-hidden="true"
          width={1916}
          height={821}
          loading="lazy"
        />
        <div className={styles.closingContent}>
          <h2 id="gallery-closing" className={styles.closingLine}>
            Loud music. Good people.
            <br />
            No attitudes.
          </h2>
          <p className={styles.closingSmall}>
            <span className={styles.rule} aria-hidden="true" />
            This is Sanctuary Rocks
            <span className={styles.rule} aria-hidden="true" />
          </p>
        </div>
      </section>

      <ForgedFooter />
    </main>
  );
}
