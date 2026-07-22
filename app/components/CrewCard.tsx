"use client";

import { useEffect, useRef, useState } from "react";
import type { CrewMember } from "../data/crewTypes";

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// A real <button> - the whole photo/name/role/bio card is one clickable
// element, not a decorative overlay with a separate hit-area layered on
// top. Every child is pointer-events: none (see .crew-card * in
// globals.css) so a click anywhere on the card - the photo, the name,
// the bio text - always resolves to this button, never gets intercepted.
export default function CrewCard({
  member,
  onSelect,
}: {
  member: CrewMember;
  onSelect: (member: CrewMember, trigger: HTMLButtonElement) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const canShowImage = Boolean(member.image) && !imageFailed;

  // The browser starts fetching a server-rendered <img> as soon as it parses
  // the HTML, which can finish (and fire "load") before React hydrates and
  // attaches onLoad below. Catch that race by checking img.complete on mount.
  useEffect(() => {
    const img = imgRef.current;

    if (!img || !img.complete) {
      return;
    }

    if (img.naturalWidth > 0) {
      setImageLoaded(true);
    } else {
      setImageFailed(true);
    }
  }, []);

  return (
    <button
      type="button"
      className="crew-card"
      onClick={(event) => onSelect(member, event.currentTarget)}
      aria-haspopup="dialog"
      aria-label={`View ${member.name}'s biography`}
    >
      <span className="crew-card-photo">
        {/* Initials sit underneath at all times so a failed photo never
            flashes the browser's default broken-image icon - the real
            photo (once it loads) simply covers this. */}
        <span
          className="crew-card-initials"
          aria-hidden="true"
          style={{ opacity: imageLoaded ? 0 : 1 }}
        >
          {getInitials(member.name)}
        </span>

        {canShowImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imgRef}
            src={member.image}
            alt=""
            style={{ opacity: imageLoaded ? 1 : 0 }}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageFailed(true)}
          />
        ) : null}
      </span>

      <span className="crew-card-name">{member.name}</span>
      <span className="crew-card-role">{member.role}</span>
      <span className="crew-card-bio">
        {member.bio}
        {member.quote ? (
          <span className="crew-card-quote">&ldquo;{member.quote}&rdquo;</span>
        ) : null}
      </span>
    </button>
  );
}
