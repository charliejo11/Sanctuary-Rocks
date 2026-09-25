"use client";

import Image from "next/image";
import { useState } from "react";
import type { CrewMember } from "../data/crewTypes";
import { FALLBACK_LOGO } from "../data/crewTypes";
import styles from "./crew.module.css";

// One crew member in the dragon card frame (crew-member-card-frame.png). The
// photo fills the frame's window; the name, role and line are real text on
// the frame's nameplate, role tag and lower panel. Clicking opens their bio.
export default function CrewMemberCard({
  member,
  onSelect,
}: {
  member: CrewMember;
  onSelect: (member: CrewMember, trigger: HTMLButtonElement) => void;
}) {
  const [failed, setFailed] = useState(false);
  const src = !member.image || failed ? FALLBACK_LOGO : member.image;
  const line = member.quote ?? member.bio;

  return (
    <li className={styles.cardItem}>
      <button
        type="button"
        className={styles.card}
        onClick={(event) => onSelect(member, event.currentTarget)}
        aria-haspopup="dialog"
        aria-label={`View ${member.name}'s biography`}
      >
        <span className={styles.cardPhoto}>
          <Image
            src={src}
            alt=""
            fill
            sizes="(max-width: 560px) 46vw, (max-width: 1100px) 30vw, 250px"
            onError={() => setFailed(true)}
          />
        </span>
        <img className={styles.cardFrame} src="/images/crew/cards/crew-member-card-frame.webp" alt="" aria-hidden="true" loading="lazy" />
        <span className={styles.cardName}>{member.name}</span>
        <span className={styles.cardRole}>{member.role}</span>
        {line ? <span className={styles.cardLine}>&ldquo;{line}&rdquo;</span> : null}
      </button>
    </li>
  );
}
