"use client";

import { useEffect, useRef, useState, type ReactNode, type WheelEvent } from "react";

// Shared horizontal-scroll row used by the DJ Lineup and Meet the Crew
// pages: a real overflow-x: auto container (so touch swipe, trackpad, and
// keyboard focus-into-view all work natively for free), plus arrow buttons
// that scroll it and a wheel handler that redirects a plain vertical mouse
// wheel into horizontal movement while leaving native horizontal gestures
// (trackpad, shift+wheel) alone.
export default function ScrollRow({
  ariaLabel,
  className = "",
  children,
}: {
  ariaLabel: string;
  className?: string;
  children: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const updateArrows = () => {
      setCanScrollLeft(el.scrollLeft > 4);
      setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };

    updateArrows();
    el.addEventListener("scroll", updateArrows, { passive: true });
    window.addEventListener("resize", updateArrows);

    // The row's content (crew list, calendar sets) can arrive after this
    // mounts (both pages fetch it), so re-check once layout has settled.
    const settleTimer = window.setTimeout(updateArrows, 300);

    return () => {
      el.removeEventListener("scroll", updateArrows);
      window.removeEventListener("resize", updateArrows);
      window.clearTimeout(settleTimer);
    };
  });

  const scrollByAmount = (direction: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;

    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: "smooth" });
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el) return;

    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      el.scrollLeft += event.deltaY;
      event.preventDefault();
    }
  };

  return (
    <div className="crew-scroll-wrap">
      <button
        type="button"
        className="crew-scroll-arrow crew-scroll-arrow--prev"
        onClick={() => scrollByAmount(-1)}
        aria-label={`Scroll ${ariaLabel} left`}
        disabled={!canScrollLeft}
      >
        <span aria-hidden="true">&#8249;</span>
      </button>

      <div
        className={`crew-scroll ${className}`.trim()}
        ref={scrollRef}
        onWheel={handleWheel}
        role="list"
        aria-label={ariaLabel}
      >
        {children}
      </div>

      <button
        type="button"
        className="crew-scroll-arrow crew-scroll-arrow--next"
        onClick={() => scrollByAmount(1)}
        aria-label={`Scroll ${ariaLabel} right`}
        disabled={!canScrollRight}
      >
        <span aria-hidden="true">&#8250;</span>
      </button>
    </div>
  );
}
