"use client";

import { useEffect, useRef, useState } from "react";
import CrewBioModal from "../components/CrewBioModal";
import type { CrewMember } from "../data/crewTypes";
import { shuffleCrew } from "../data/crewTypes";
import CrewMemberCard from "./CrewMemberCard";
import styles from "./crew.module.css";

type Group = { id: string; title: string; subtitle: string; members: CrewMember[] };

// Every DJ and every Host on their own card (no carousel), with one shared
// bio pop-up for the whole page.
//
// Shuffling happens here (client-side, after mount) rather than on the
// server: the page itself needs to stay statically generated (the roster
// comes from a build-time fs read - see app/crew/page.tsx - which doesn't
// exist on Cloudflare Workers at request time), but we still want a fresh
// random order each time someone visits. Starting from the unshuffled
// `groups` prop and only randomizing inside useEffect keeps the initial
// server-rendered HTML and the client's first render identical (useEffect
// never runs during SSR) - shuffling eagerly (e.g. in useMemo, which DOES
// run during SSR) would make the server's random order and the client's
// random order disagree and trigger a hydration mismatch.
export default function CrewRoster({ groups }: { groups: Group[] }) {
  const [active, setActive] = useState<CrewMember | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [shuffledGroups, setShuffledGroups] = useState(groups);

  useEffect(() => {
    setShuffledGroups(groups.map((group) => ({ ...group, members: shuffleCrew(group.members) })));
    // Only on mount - groups are static for the page's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const select = (member: CrewMember, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setActive(member);
  };

  return (
    <>
      {shuffledGroups.map((group) => (
        <section key={group.id} className={styles.roster} aria-labelledby={`crew-${group.id}`}>
          <header className={styles.sectionHead}>
            <img className={styles.headDivider} src="/images/crew/headings/crew-dragon-chain-divider.webp" alt="" aria-hidden="true" loading="lazy" />
            <div className={styles.titlePlate}>
              <img src="/images/crew/headings/crew-section-title-plate.webp" alt="" aria-hidden="true" loading="lazy" />
              <h2 id={`crew-${group.id}`} className={styles.titleText}>
                <span aria-hidden="true">✦</span> {group.title} <span aria-hidden="true">✦</span>
              </h2>
            </div>
            <div className={styles.subPlate}>
              <img src="/images/crew/cards/role-tag-plate.webp" alt="" aria-hidden="true" loading="lazy" />
              <p className={styles.subText}>{group.subtitle}</p>
            </div>
          </header>

          <div className={styles.rosterPanel}>
            {(["tl", "tr", "bl", "br"] as const).map((corner) => (
              <img
                key={corner}
                className={`${styles.corner} ${styles[`corner_${corner}`]}`}
                src="/images/crew/cards/card-corner-ornament.webp"
                alt=""
                aria-hidden="true"
                loading="lazy"
              />
            ))}
            <ul className={styles.grid}>
              {group.members.map((member) => (
                <CrewMemberCard key={member.image} member={member} onSelect={select} />
              ))}
            </ul>
          </div>
        </section>
      ))}

      <CrewBioModal member={active} onClose={() => setActive(null)} returnFocusRef={triggerRef} />
    </>
  );
}
