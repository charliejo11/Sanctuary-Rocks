"use client";

import { useRef, useState } from "react";
import CrewCard from "./CrewCard";
import CrewBioModal from "./CrewBioModal";
import ScrollRow from "./ScrollRow";
import type { CrewMember } from "../data/crewTypes";

// Renders every DJ and every host as two independent horizontal-scroll
// rows (no pagination, no shuffling subset, nothing auto-rotates) plus one
// shared bio modal. Each CrewCard renders with its own real member object
// (see the .map calls below) rather than a shared index into a visible
// window, so whichever card is clicked is unambiguously that exact
// person's bio - there's no stale/rotating state to get out of sync.
export default function CrewRoster({
  djs,
  hosts,
  bioImages,
}: {
  djs: CrewMember[];
  hosts: CrewMember[];
  bioImages: Record<string, string>;
}) {
  const [activeMember, setActiveMember] = useState<CrewMember | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const handleSelect = (member: CrewMember, trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    setActiveMember(member);
  };

  const handleClose = () => {
    setActiveMember(null);
  };

  return (
    <>
      <section className="crew-roster-section" aria-labelledby="crew-djs-heading">
        <h2 className="crew-roster-heading" id="crew-djs-heading">
          DJs
        </h2>
        <ScrollRow ariaLabel="DJs">
          {djs.map((member) => (
            <CrewCard key={member.image} member={member} onSelect={handleSelect} />
          ))}
        </ScrollRow>
      </section>

      <section className="crew-roster-section" aria-labelledby="crew-hosts-heading">
        <h2 className="crew-roster-heading" id="crew-hosts-heading">
          Hosts
        </h2>
        <ScrollRow ariaLabel="Hosts">
          {hosts.map((member) => (
            <CrewCard key={member.image} member={member} onSelect={handleSelect} />
          ))}
        </ScrollRow>
      </section>

      <CrewBioModal
        member={activeMember}
        onClose={handleClose}
        returnFocusRef={triggerRef}
        bioImages={bioImages}
      />
    </>
  );
}
