import Link from "next/link";
import { cinzel, robotoCondensed } from "../contact/fonts";
import { sanctuaryContent } from "../data/sanctuaryContent";
import styles from "./ForgedFooter.module.css";

// Forged-metal footer for the redesigned pages: the real Sanctuary Rocks
// logo, the club line and the copyright. A page can add its own extras on the
// right (the Home page adds links, Gridster and the visitor counter).
export default function ForgedFooter({ children }: { children?: React.ReactNode }) {
  const year = new Date().getFullYear();

  return (
    <footer className={`${styles.footer} ${cinzel.variable} ${robotoCondensed.variable}`}>
      <img className={styles.embers} src="/images/shared/overlays/ember-overlay.webp" alt="" aria-hidden="true" loading="lazy" />
      <div className={`${styles.inner} ${children ? styles.withExtras : ""}`}>
        <Link className={styles.logo} href={sanctuaryContent.logo.homeHref} aria-label={sanctuaryContent.logo.ariaLabel}>
          <img src="/images/brand/sanctuary-rocks-logo-transparent.webp" alt="" width={640} height={640} loading="lazy" />
        </Link>
        <div className={styles.text}>
          <p className={styles.line}>{sanctuaryContent.footer.description}</p>
          <p className={styles.small}>
            © {year} Sanctuary Rocks. All rights reserved. <span className={styles.credit}>Designed by CharlieJo11</span>
          </p>
        </div>
        {children ? <div className={styles.extras}>{children}</div> : null}
      </div>
    </footer>
  );
}
