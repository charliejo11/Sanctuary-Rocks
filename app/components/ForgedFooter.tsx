import { cinzel, robotoCondensed } from "../contact/fonts";
import { sanctuaryContent } from "../data/sanctuaryContent";
import styles from "./ForgedFooter.module.css";

// Forged-metal footer for the redesigned pages (Contact, Gallery): the real
// Sanctuary Rocks logo, the club line and the copyright.
export default function ForgedFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className={`${styles.footer} ${cinzel.variable} ${robotoCondensed.variable}`}>
      <img className={styles.embers} src="/images/shared/overlays/ember-overlay.webp" alt="" aria-hidden="true" loading="lazy" />
      <div className={styles.inner}>
        <a className={styles.logo} href={sanctuaryContent.logo.homeHref} aria-label={sanctuaryContent.logo.ariaLabel}>
          <img src="/images/brand/sanctuary-rocks-logo-transparent.webp" alt="" width={640} height={640} loading="lazy" />
        </a>
        <div className={styles.text}>
          <p className={styles.line}>{sanctuaryContent.footer.description}</p>
          <p className={styles.small}>
            © {year} Sanctuary Rocks. All rights reserved. <span className={styles.credit}>Designed by CharlieJo11</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
