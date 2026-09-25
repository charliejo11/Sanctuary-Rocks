"use client";

import { useEffect, useState } from "react";
import { oswald } from "../contact/fonts";
import { sanctuaryContent } from "../data/sanctuaryContent";
import styles from "./DragonNav.module.css";

type NavLink = { href: string; label: string };

// Forged-metal navigation with dragon end caps (Contact page). The links are
// real HTML; the dragons are decoration cut from dragon-nav-bar.png with its
// lettered plate removed. Sticky, shrinks its dragons once the page scrolls,
// and folds into a menu button on small screens.
export default function DragonNav({ links, pathname }: { links: NavLink[]; pathname: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <header className={`${styles.header} ${compact ? styles.compact : ""} ${oswald.variable}`}>
      <div className={styles.bar}>
        <img className={`${styles.cap} ${styles.capLeft}`} src="/images/contact/nav/dragon-nav-cap-left.webp" alt="" aria-hidden="true" />
        <img className={`${styles.cap} ${styles.capRight}`} src="/images/contact/nav/dragon-nav-cap-right.webp" alt="" aria-hidden="true" />

        <a className={styles.logo} href={sanctuaryContent.logo.homeHref} aria-label={sanctuaryContent.logo.ariaLabel}>
          <img src="/images/brand/sanctuary-rocks-logo-transparent.webp" alt="" width={640} height={640} />
        </a>

        <nav className={styles.nav} aria-label="Main navigation">
          <ul id="dragon-nav-links" className={`${styles.links} ${menuOpen ? styles.linksOpen : ""}`}>
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className={active ? styles.active : undefined}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuOpen(false)}
                  >
                    {link.label}
                  </a>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            className={styles.menuButton}
            aria-expanded={menuOpen}
            aria-controls="dragon-nav-links"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className={styles.menuIcon} aria-hidden="true" />
            <span className={styles.menuLabel}>{menuOpen ? "Close" : "Menu"}</span>
          </button>
        </nav>
      </div>
    </header>
  );
}
