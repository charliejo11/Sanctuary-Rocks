"use client";

import { useState } from "react";
import { getVisibleItems } from "../data/crewTypes";
import type { CrewMember } from "../data/crewTypes";

export type LineupSet = {
  eventTitle: string;
  djName: string;
  host: string;
  start: string;
  end: string;
  dateLabel: string;
  timeLabel: string;
  description: string;
  hostPhoto?: string;
  stagePhoto?: string;
};

const VISIBLE_COUNT = 8;

// Restores the original "The Full Crew" 8-frame grid baked into
// dj-lineup-template-blank.png (.lineup-card-slot--1 through --8, already
// measured/positioned in globals.css from before the full-scroll rework).
// Unlike the original version of this grid, the data source here is real
// Google Calendar sets (allScheduledSets in lineup/page.tsx), not the
// static DJ roster - showing "who happens to have a photo" was the wrong
// data source for a page whose entire point is the calendar schedule.
export default function LineupCarouselOverlay({
  sets,
  findPhoto,
  emptyMessage,
}: {
  sets: LineupSet[];
  findPhoto: (djName: string) => CrewMember | undefined;
  emptyMessage: string | null;
}) {
  const [startIndex, setStartIndex] = useState(0);
  const canCycle = sets.length > VISIBLE_COUNT;
  const pageCount = canCycle ? Math.ceil(sets.length / VISIBLE_COUNT) : 0;
  const currentPage = canCycle
    ? Math.round(startIndex / VISIBLE_COUNT) % pageCount
    : 0;

  const goNext = () => {
    setStartIndex((current) => (current + VISIBLE_COUNT) % sets.length);
  };

  const goPrev = () => {
    setStartIndex((current) => (current - VISIBLE_COUNT + sets.length) % sets.length);
  };

  if (sets.length === 0) {
    return emptyMessage ? (
      <p className="lineup-card-grid-status">{emptyMessage}</p>
    ) : null;
  }

  const visibleSets = getVisibleItems(sets, startIndex, VISIBLE_COUNT);

  return (
    <>
      {visibleSets.map((set, index) => {
        const profile = findPhoto(set.djName);

        return (
          <article
            key={`${set.start}-${set.djName}-${index}`}
            className={`lineup-card-slot lineup-card-slot--${index + 1}`}
          >
            <div className="lineup-card-photo">
              {profile?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.image} alt={set.djName} />
              ) : null}
            </div>
            <div className="lineup-card-body">
              <h3>{set.djName}</h3>
              <p>{set.dateLabel}</p>
            </div>
            <div className="lineup-card-next">
              <strong>{set.timeLabel}</strong>
              <span>{set.eventTitle}</span>
            </div>
          </article>
        );
      })}

      {canCycle ? (
        <>
          <button
            type="button"
            className="lineup-roster-arrow lineup-roster-arrow--prev"
            onClick={goPrev}
            aria-label="Show previous DJs"
          >
            <span aria-hidden="true">&#8249;</span>
          </button>
          <button
            type="button"
            className="lineup-roster-arrow lineup-roster-arrow--next"
            onClick={goNext}
            aria-label="Show next DJs"
          >
            <span aria-hidden="true">&#8250;</span>
          </button>

          <div className="lineup-roster-dots" aria-hidden="true">
            {Array.from({ length: pageCount }).map((_, page) => (
              <span
                key={page}
                className={`lineup-roster-dot${page === currentPage ? " is-active" : ""}`}
              />
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
