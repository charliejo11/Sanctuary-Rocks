"use client";

import { useRef, useState } from "react";
import CrewCard from "./CrewCard";
import CrewBioModal from "./CrewBioModal";
import { getVisibleItems } from "../data/crewTypes";
import type { CrewMember } from "../data/crewTypes";

function CarouselSection({
  items,
  visibleCount,
  slotClassPrefix,
  arrowClassPrefix,
  dotsClassName,
  sectionLabel,
  onSelect,
}: {
  items: CrewMember[];
  visibleCount: number;
  slotClassPrefix: string;
  arrowClassPrefix: string;
  dotsClassName: string;
  sectionLabel: string;
  onSelect: (member: CrewMember, trigger: HTMLButtonElement) => void;
}) {
  const [startIndex, setStartIndex] = useState(0);
  const canCycle = items.length > visibleCount;
  const pageCount = canCycle ? Math.ceil(items.length / visibleCount) : 0;
  const currentPage = canCycle
    ? Math.round(startIndex / visibleCount) % pageCount
    : 0;

  const goNext = () => {
    setStartIndex((current) => (current + visibleCount) % items.length);
  };

  const goPrev = () => {
    setStartIndex((current) => (current - visibleCount + items.length) % items.length);
  };

  const visibleItems = getVisibleItems(items, startIndex, visibleCount);

  return (
    <>
      {visibleItems.map((member, index) => (
        <CrewCard
          key={member.image}
          member={member}
          className={`crew-slot ${slotClassPrefix}-${index + 1}`}
          onSelect={onSelect}
        />
      ))}

      {canCycle ? (
        <>
          <button
            type="button"
            className={`crew-arrow ${arrowClassPrefix}-prev`}
            onClick={goPrev}
            aria-label={`Show previous ${sectionLabel}`}
          />
          <button
            type="button"
            className={`crew-arrow ${arrowClassPrefix}-next`}
            onClick={goNext}
            aria-label={`Show next ${sectionLabel}`}
          />

          <div className={`crew-dots ${dotsClassName}`} aria-hidden="true">
            {Array.from({ length: pageCount }).map((_, page) => (
              <span
                key={page}
                className={`crew-dot${page === currentPage ? " is-active" : ""}`}
              />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

export default function CrewCarouselOverlay({
  djs,
  hosts,
}: {
  djs: CrewMember[];
  hosts: CrewMember[];
}) {
  // One modal shared by both carousels (DJs and Hosts), so only one can
  // ever be open. Each CrewCard already renders with its own real member
  // object (see getVisibleItems above) rather than a shared index, so
  // whichever card is clicked - including after paging the carousel - is
  // exactly the member whose bio opens here; nothing to keep in sync.
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
      <CarouselSection
        items={djs}
        visibleCount={4}
        slotClassPrefix="crew-slot--dj"
        arrowClassPrefix="crew-arrow--dj"
        dotsClassName="crew-dots--dj"
        sectionLabel="DJs"
        onSelect={handleSelect}
      />
      <CarouselSection
        items={hosts}
        visibleCount={5}
        slotClassPrefix="crew-slot--host"
        arrowClassPrefix="crew-arrow--host"
        dotsClassName="crew-dots--host"
        sectionLabel="Hosts"
        onSelect={handleSelect}
      />

      <CrewBioModal
        member={activeMember}
        onClose={handleClose}
        returnFocusRef={triggerRef}
      />
    </>
  );
}
