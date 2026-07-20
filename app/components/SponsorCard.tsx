"use client";

import { useState } from "react";
import type { SponsorEntry } from "../data/crewTypes";

export default function SponsorCard({ sponsor }: { sponsor: SponsorEntry }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="crew-sponsor-tile" title={sponsor.bio}>
      <div className="crew-sponsor-logo">
        {failed ? (
          <span className="crew-sponsor-fallback" aria-hidden="true">
            {sponsor.name.slice(0, 1).toUpperCase()}
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={sponsor.image}
            alt={sponsor.name}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <span className="crew-sponsor-name">{sponsor.name}</span>
    </div>
  );
}
