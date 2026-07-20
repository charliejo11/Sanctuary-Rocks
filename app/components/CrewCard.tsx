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

export default function CrewCard({
  member,
  className,
}: {
  member: CrewMember;
  className: string;
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
    <article className={className}>
      <div className="crew-card-photo">
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
            alt={member.name}
            style={{ opacity: imageLoaded ? 1 : 0 }}
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageFailed(true)}
          />
        ) : null}
      </div>

      <h3 className="crew-card-name">{member.name}</h3>
      <p className="crew-card-role">{member.role}</p>
      <p className="crew-card-bio">
        {member.bio}
        {member.quote ? (
          <span className="crew-card-quote">&ldquo;{member.quote}&rdquo;</span>
        ) : null}
      </p>
    </article>
  );
}
