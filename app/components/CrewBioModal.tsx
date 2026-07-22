"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { CrewMember } from "../data/crewTypes";
import { FALLBACK_LOGO } from "../data/crewTypes";
import { findBio } from "../data/crewBios";

function BioPhoto({ member }: { member: CrewMember }) {
  const [failed, setFailed] = useState(false);
  const src = !member.image || failed ? FALLBACK_LOGO : member.image;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={member.image}
      src={src}
      alt={member.name}
      onError={() => setFailed(true)}
    />
  );
}

// Sanctuary Rocks-styled biography modal for the Meet the Crew page.
// Stays mounted the whole time (CrewCarouselOverlay renders it
// unconditionally); `member` toggling between a value and null is what
// opens/closes it, so the effects below key off `member` rather than
// mount/unmount to run their open/close logic correctly every time.
export default function CrewBioModal({
  member,
  onClose,
  returnFocusRef,
}: {
  member: CrewMember | null;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Lock background scroll and move focus into the panel while open;
  // restore both when it closes, including returning focus to whichever
  // crew card triggered it (not just "somewhere on the page").
  useEffect(() => {
    if (!member) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member]);

  // Escape closes; Tab/Shift+Tab is trapped to the modal's own focusable
  // elements so keyboard focus can't silently leave into the page behind it.
  useEffect(() => {
    if (!member) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [member, onClose]);

  if (!member) return null;

  const bio = findBio(member.name) || "Bio coming soon.";

  return (
    <div
      className="crew-bio-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crew-bio-modal-name"
    >
      <button
        type="button"
        className="crew-bio-modal-backdrop"
        aria-label="Close biography"
        onClick={onClose}
      />

      <div className="crew-bio-modal-panel" ref={panelRef}>
        <button
          type="button"
          className="crew-bio-modal-close"
          onClick={onClose}
          ref={closeButtonRef}
          aria-label="Close biography"
        >
          Close
        </button>

        <div className="crew-bio-modal-photo">
          <BioPhoto member={member} />
        </div>

        <h2 id="crew-bio-modal-name" className="crew-bio-modal-name">
          {member.name}
        </h2>
        <p className="crew-bio-modal-role">{member.role}</p>

        <div className="crew-bio-modal-bio">
          <p>{bio}</p>
        </div>
      </div>
    </div>
  );
}
