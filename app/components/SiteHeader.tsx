"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import DragonNav from "./DragonNav";

const navLinks = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/events", label: "Events" },
  { href: "/lineup", label: "DJ Lineup" },
  { href: "/gallery", label: "Gallery" },
  { href: "/crew", label: "Crew" },
  { href: "/contact", label: "Contact" },
];

// Redesigned pages that use the forged-metal dragon navigation; every other
// page keeps this header exactly as it was.
const DRAGON_NAV_PAGES = new Set(["/contact", "/crew", "/gallery", "/lineup"]);

export default function SiteHeader() {
  const pathname = usePathname();

  if (DRAGON_NAV_PAGES.has(pathname)) return <DragonNav links={navLinks} pathname={pathname} />;

  return (
    <header className="site-header site-header--visible">
      <nav className="site-header__nav" aria-label="Main navigation">
        {navLinks.map((link) => {
          const isActive = pathname === link.href;

          return (
            <Link
              key={link.href}
              href={link.href}
              className={isActive ? "is-active" : undefined}
              aria-current={isActive ? "page" : undefined}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
