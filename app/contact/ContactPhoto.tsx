"use client";

import { useState } from "react";
import { FALLBACK_LOGO } from "../data/crewTypes";

// Isolated client component so the Contact page itself can stay server
// rendered - onError needs to run in the browser. Falls back to the site
// logo once if the photo fails to load, and stops there (no infinite
// onError loop if the logo itself is ever unavailable).
export default function ContactPhoto({
  src,
  alt,
  objectPosition,
}: {
  src: string;
  alt: string;
  objectPosition?: string;
}) {
  const [imageSrc, setImageSrc] = useState(src);

  return (
    <img
      src={imageSrc}
      alt={alt}
      className="contact-photo-img"
      style={objectPosition ? { objectPosition } : undefined}
      onError={() => {
        if (imageSrc !== FALLBACK_LOGO) {
          setImageSrc(FALLBACK_LOGO);
        }
      }}
    />
  );
}
