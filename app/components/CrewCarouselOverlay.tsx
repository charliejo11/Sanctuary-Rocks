"use client";

import { useState } from "react";
import CrewCard from "./CrewCard";
import { getVisibleItems } from "../data/crewTypes";
import type { CrewMember } from "../data/crewTypes";

function CarouselSection({
  items,
  visibleCount,
  slotClassPrefix,
  arrowClassPrefix,
  dotsClassName,
  sectionLabel,
}: {
  items: CrewMember[];
  visibleCount: number;
  slotClassPrefix: string;
  arrowClassPrefix: string;
  dotsClassName: string;
  sectionLabel: string;
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
  return (
    <>
      <CarouselSection
        items={djs}
        visibleCount={4}
        slotClassPrefix="crew-slot--dj"
        arrowClassPrefix="crew-arrow--dj"
        dotsClassName="crew-dots--dj"
        sectionLabel="DJs"
      />
      <CarouselSection
        items={hosts}
        visibleCount={5}
        slotClassPrefix="crew-slot--host"
        arrowClassPrefix="crew-arrow--host"
        dotsClassName="crew-dots--host"
        sectionLabel="Hosts"
      />
    </>
  );
}
