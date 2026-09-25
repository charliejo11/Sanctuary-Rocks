"use client";

import { useEffect, useId, useState } from "react";
import styles from "./contact.module.css";
import type { StaffMember } from "./staffData";

type ContactCrewCardProps = {
  member: StaffMember;
  /** The owner's card is drawn a little larger. */
  featured?: boolean;
};

/** Trims and collapses a field down to `undefined` when it has nothing in
 *  it, so the popup can decide per-field whether there's anything to show
 *  without every call site repeating the same truthiness check. */
function presence(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// A crew member in the dragon crew-card frame: the photo sits in the frame's
// opening and the name is real text on the frame's built-in nameplate.
// Clicking opens the contact pop-up (SL names, Discord, profile, bio).
export default function ContactCrewCard({ member, featured = false }: ContactCrewCardProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const headingId = useId();

  const slDisplayName = presence(member.slDisplayName);
  const slUsername = presence(member.slUsername);
  const discord = presence(member.discord);
  const profileUrl = presence(member.profileUrl);
  const bio = presence(member.bio);

  // Escape closes the modal, and background scroll is locked while it's
  // open - both only wired up while a modal is actually on screen.
  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function copyDiscord() {
    if (!discord) return;

    try {
      await navigator.clipboard.writeText(discord);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.crewCard} ${featured ? styles.crewFeatured : ""}`}
        onClick={() => setOpen(true)}
        aria-label={`View contact information for ${member.name}`}
      >
        <span className={styles.crewPhoto}>
          <img
            src={member.cardImage ?? member.image}
            alt=""
            loading="lazy"
            style={member.imagePosition ? { objectPosition: member.imagePosition } : undefined}
          />
        </span>
        <img className={styles.crewFrame} src="/images/contact/crew/crew-card-frame.webp" alt="" aria-hidden="true" />
        <span className={styles.crewPlate}>
          <strong>{member.name}</strong>
          <small>{member.role}</small>
        </span>
      </button>

      {open && (
        <div
          className="contact-member-modal-backdrop"
          onClick={() => setOpen(false)}
        >
          <section
            className="contact-member-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="contact-member-close"
              onClick={() => setOpen(false)}
              aria-label="Close contact information"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>

            {/* The card photo above is cropped tight to fit its frame; this
                portrait box is a different shape, so cropping the same way
                here would just cut people off oddly. Showing the whole,
                un-cropped photo (object-fit: contain) over a blurred copy
                of itself avoids that without ever leaving flat black bars. */}
            <div className="contact-member-modal-photo">
              <div
                className="contact-member-modal-photo-bg"
                style={{ backgroundImage: `url("${encodeURI(member.image)}")` }}
                aria-hidden="true"
              />
              <img src={member.image} alt={member.name} />
            </div>

            <h2 id={headingId}>{member.name}</h2>
            <h3>{member.role}</h3>

            {(slDisplayName || slUsername || discord || profileUrl) && (
              <dl className="contact-member-rows">
                {slDisplayName && (
                  <div className="contact-member-row">
                    <dt>SL Display Name</dt>
                    <dd>{slDisplayName}</dd>
                  </div>
                )}

                {slUsername && (
                  <div className="contact-member-row">
                    <dt>SL Username</dt>
                    <dd>{slUsername}</dd>
                  </div>
                )}

                {discord && (
                  <div className="contact-member-row">
                    <dt>Discord</dt>
                    <dd>
                      <button
                        type="button"
                        className="contact-discord-copy"
                        onClick={copyDiscord}
                      >
                        {discord}
                      </button>
                      <span className="contact-copy-message">
                        {copied ? "Copied!" : "Tap to copy"}
                      </span>
                    </dd>
                  </div>
                )}

                {profileUrl && (
                  <div className="contact-member-row">
                    <dt>Profile</dt>
                    <dd>
                      <a
                        className="contact-profile-link"
                        href={profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View Second Life Profile
                      </a>
                    </dd>
                  </div>
                )}
              </dl>
            )}

            {bio && <p className="contact-member-bio">{bio}</p>}
          </section>
        </div>
      )}
    </>
  );
}
