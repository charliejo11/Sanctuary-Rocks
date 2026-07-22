"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { CrewMember } from "../data/crewTypes";
import { FALLBACK_LOGO, normalizeForMatch } from "../data/crewTypes";
import { findBioEntry } from "../data/crewBios";

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

// Renders the hand-made biography graphic (public/images/Bios/*). Keyed by
// its own src so switching to a different person's bio image always starts
// from a clean "not failed" state instead of carrying over a stale error
// from whoever was open before. Reports failure up to the parent (via
// onError) so a broken/missing file falls back to "Bio coming soon." text
// instead of leaving a broken-image icon in the modal.
function BioImage({
  src,
  name,
  onError,
}: {
  src: string;
  name: string;
  onError: () => void;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      key={src}
      className="crew-bio-modal-image"
      src={src}
      alt={`${name} biography`}
      onError={() => {
        setFailed(true);
        onError();
      }}
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
  bioImages,
}: {
  member: CrewMember | null;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  bioImages: Record<string, string>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [bioImageFailed, setBioImageFailed] = useState(false);
  // Portal target only exists in the browser - guards against an SSR/
  // hydration mismatch (Next.js renders this component's shell on the
  // server, where document.body isn't the same tree it'll portal into).
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock background scroll and move focus into the panel while open;
  // restore both when it closes, including returning focus to whichever
  // crew card triggered it (not just "somewhere on the page").
  useEffect(() => {
    if (!member) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    setBioImageFailed(false);

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

  if (!member || !mounted) return null;

  const bioEntry = findBioEntry(member.name);
  const bioImage = bioEntry?.bioImage || bioImages[normalizeForMatch(member.name)];
  const hasBioImage = Boolean(bioImage) && !bioImageFailed;
  const bioText = bioEntry?.bio || "";

  // Rendered through a portal straight into document.body so nothing about
  // an ancestor's overflow/transform/filter/opacity/stacking context on
  // either page can clip or bury this behind other content - it always
  // sits at the true top of the DOM, independent of where the trigger
  // button that opened it happens to live.
  return createPortal(
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
          {hasBioImage ? (
            <BioImage
              src={bioImage as string}
              name={member.name}
              onError={() => setBioImageFailed(true)}
            />
          ) : (
            <p>{bioText || "Bio coming soon."}</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
