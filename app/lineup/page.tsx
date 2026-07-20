"use client";

import { useEffect, useMemo, useState } from "react";
import { FALLBACK_LOGO, findRosterMatch, getVisibleItems } from "../data/crewTypes";
import type { CrewMember } from "../data/crewTypes";

const LINEUP_VISIBLE_COUNT = 8;

type LineupSet = {
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

type LineupResponse = {
  updatedAt: string;
  nextSet: LineupSet | null;
  sets: LineupSet[];
  error?: {
    type: string;
    message: string;
  };
};

function findProfile(djName: string, profiles: CrewMember[]) {
  if (!djName) return undefined;

  return findRosterMatch(djName, profiles);
}

function findHostProfile(hostName: string, hostRoster: CrewMember[]) {
  if (!hostName || hostName.trim().toLowerCase() === "tba") return undefined;

  return findRosterMatch(hostName, hostRoster);
}

function findNextSet(profile: CrewMember, sets: LineupSet[]) {
  return sets.find((set) => findRosterMatch(set.djName, [profile]));
}

function DjImage({
  alt,
  className,
  src,
}: {
  alt: string;
  className: string;
  src?: string;
}) {
  const [imageSrc, setImageSrc] = useState(src || FALLBACK_LOGO);
  const [imageLoaded, setImageLoaded] = useState(false);

  useEffect(() => {
    setImageSrc(src || FALLBACK_LOGO);
    setImageLoaded(false);
  }, [src]);

  return (
    <div aria-label={alt} className={className} role="img">
      <img
        className={imageLoaded ? "lineup-photo-img lineup-photo-img--loaded" : "lineup-photo-img"}
        src={imageSrc}
        alt=""
        onLoad={() => {
          setImageLoaded(true);
        }}
        onError={() => {
          setImageLoaded(false);
          // Fall back to the logo once; if the logo itself ever fails to
          // load there's nowhere further to fall back to, so stop here
          // instead of looping onError forever.
          if (imageSrc !== FALLBACK_LOGO) {
            setImageSrc(FALLBACK_LOGO);
          }
        }}
      />
    </div>
  );
}

function HostPanelPhoto({ src, alt }: { src: string; alt: string }) {
  const [imageSrc, setImageSrc] = useState(src);

  useEffect(() => {
    setImageSrc(src);
  }, [src]);

  return (
    <img
      src={imageSrc}
      alt={alt}
      className="host-photo"
      onError={() => {
        if (imageSrc !== FALLBACK_LOGO) {
          setImageSrc(FALLBACK_LOGO);
        }
      }}
    />
  );
}

export default function LineupPage() {
  const [lineup, setLineup] = useState<LineupResponse>({
    updatedAt: "",
    nextSet: null,
    sets: [],
  });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [djRoster, setDjRoster] = useState<CrewMember[]>([]);
  const [hostRoster, setHostRoster] = useState<CrewMember[]>([]);
  const [djStartIndex, setDjStartIndex] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let didTimeout = false;
    const timeout = window.setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, 35000);

    async function loadLineup() {
      try {
        const response = await fetch("/api/lineup", {
          cache: "no-store",
          signal: controller.signal,
        });

        const data = (await response.json()) as LineupResponse;

        setLineup({
          updatedAt: data.updatedAt ?? "",
          nextSet: data.nextSet ?? null,
          sets: Array.isArray(data.sets) ? data.sets : [],
          error: data.error,
        });

        setStatus(response.ok && !data.error ? "ready" : "error");
      } catch (error) {
        if (controller.signal.aborted && !didTimeout) return;
        console.error(error);
        setLineup({
          updatedAt: "",
          nextSet: null,
          sets: [],
          error: {
            type: "fetch-failed",
            message: "Lineup request failed.",
          },
        });
        setStatus("error");
      } finally {
        window.clearTimeout(timeout);
      }
    }

    loadLineup();

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDjRoster() {
      try {
        const response = await fetch("/api/dj-roster", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json()) as { djs?: CrewMember[] };
        setDjRoster(Array.isArray(data.djs) ? data.djs : []);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(error);
        }
      }
    }

    loadDjRoster();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadHostRoster() {
      try {
        const response = await fetch("/api/host-roster", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await response.json()) as { hosts?: CrewMember[] };
        setHostRoster(Array.isArray(data.hosts) ? data.hosts : []);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(error);
        }
      }
    }

    loadHostRoster();

    return () => controller.abort();
  }, []);

  const nextSet = lineup.nextSet ?? lineup.sets[0] ?? null;
  const nextProfile = nextSet ? findProfile(nextSet.djName, djRoster) : null;
  const nextHostProfile = nextSet?.host ? findHostProfile(nextSet.host, hostRoster) : undefined;
  const nextPanelPhoto =
    nextSet?.stagePhoto ??
    nextSet?.hostPhoto ??
    nextHostProfile?.image ??
    FALLBACK_LOGO;
  const hasRealSets = status === "ready" && lineup.sets.length > 0;
  const canCycleDjs = djRoster.length > LINEUP_VISIBLE_COUNT;
  const djPageCount = canCycleDjs ? Math.ceil(djRoster.length / LINEUP_VISIBLE_COUNT) : 0;
  const djCurrentPage = canCycleDjs
    ? Math.round(djStartIndex / LINEUP_VISIBLE_COUNT) % djPageCount
    : 0;
  const crewCards = getVisibleItems(djRoster, djStartIndex, LINEUP_VISIBLE_COUNT);
  const upcomingSets = hasRealSets ? lineup.sets.slice(0, 8) : [];
  const updatedLabel = useMemo(() => {
    if (!lineup.updatedAt) return "";

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(lineup.updatedAt));
  }, [lineup.updatedAt]);

  const goToPrevDjPage = () => {
    setDjStartIndex((current) => (current - LINEUP_VISIBLE_COUNT + djRoster.length) % djRoster.length);
  };

  const goToNextDjPage = () => {
    setDjStartIndex((current) => (current + LINEUP_VISIBLE_COUNT) % djRoster.length);
  };

  return (
    <main className="lineup-page lineup-template-page">
      <section className="lineup-template-shell" aria-labelledby="lineup-title">
        <div className="lineup-template-wrap">
          <img
            className="lineup-template-image"
            src="/images/hero/dj-lineup-template-blank.png"
            alt=""
            aria-hidden="true"
          />

          <h1 className="lineup-template-sr-title" id="lineup-title">
            DJ Lineup
          </h1>

          {nextSet ? (
            <>
              <section className="lineup-next-photo-slot" aria-label="Next On Deck DJ photo">
                <DjImage
                  alt={`${nextSet.djName} photo`}
                  className="lineup-next-photo"
                  src={nextProfile?.image}
                />
              </section>

              <section className="lineup-next-info-slot" aria-label="Next On Deck details">
                <div className="lineup-next-main">
                  <h2>{nextSet.djName}</h2>
                  <p>{nextSet.eventTitle}</p>
                  <dl>
                    <div>
                      <dt>Date</dt>
                      <dd>{nextSet.dateLabel}</dd>
                    </div>
                    <div>
                      <dt>Time</dt>
                      <dd>{nextSet.timeLabel}</dd>
                    </div>
                    {nextSet.host ? (
                      <div>
                        <dt>Host</dt>
                        <dd>{nextSet.host}</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
              </section>

              <section className="lineup-next-host-slot" aria-label="About this set">
                <div className="host-panel">
                  {nextPanelPhoto && (
                    <HostPanelPhoto
                      src={nextPanelPhoto}
                      alt={`Host ${nextSet.host || nextSet.eventTitle}`}
                    />
                  )}

                  <div className="host-photo-shade" />

                  <div className="host-panel-copy lineup-next-about">
                    <h3>About This Set</h3>
                    <p>{nextSet.description}</p>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <section
              className={`lineup-next-info-slot lineup-next-info-slot--wide lineup-next-state${
                  status === "error" ? " lineup-next-state--error" : ""
                }`}
              aria-label="Next On Deck status"
              >
                <strong>
                  {status === "loading"
                    ? "Loading lineup"
                    : status === "error"
                      ? "Calendar lineup unavailable"
                      : "Next Set Coming Soon"}
                </strong>
                <span>
                  {status === "error"
                    ? "Please check back soon. The crew board is still available below."
                    : "Upcoming DJ sets will appear here when the calendar feed responds."}
                </span>
            </section>
          )}

          <section className="lineup-template-roster" aria-label="Full Crew">
            {crewCards.map((profile, index) => {
              const nextProfileSet = hasRealSets
                ? findNextSet(profile, lineup.sets)
                : null;

              return (
              <article
                className={`lineup-card-slot lineup-card-slot--${index + 1}`}
                key={profile.image}
              >
                <DjImage
                  alt={`${profile.name} photo`}
                  className="lineup-card-photo"
                  src={profile.image}
                />

                <div className="lineup-card-body">
                  <h3>{profile.name}</h3>
                  <p>{profile.role}</p>
                  <span className="lineup-card-bio">{profile.bio}</span>
                </div>

                <div className="lineup-card-next">
                  <strong>Next Set</strong>
                  {nextProfileSet ? (
                    <>
                      <p>{nextProfileSet.dateLabel}</p>
                      <span>{nextProfileSet.timeLabel}</span>
                    </>
                  ) : (
                    <p>Schedule TBA</p>
                  )}
                </div>
              </article>
              );
            })}

            {canCycleDjs ? (
              <>
                <button
                  type="button"
                  className="lineup-roster-arrow lineup-roster-arrow--prev"
                  onClick={goToPrevDjPage}
                  aria-label="Show previous DJs"
                >
                  <span aria-hidden="true">&#8249;</span>
                </button>
                <button
                  type="button"
                  className="lineup-roster-arrow lineup-roster-arrow--next"
                  onClick={goToNextDjPage}
                  aria-label="Show next DJs"
                >
                  <span aria-hidden="true">&#8250;</span>
                </button>

                <div className="lineup-roster-dots" aria-hidden="true">
                  {Array.from({ length: djPageCount }).map((_, page) => (
                    <span
                      key={page}
                      className={`lineup-roster-dot${page === djCurrentPage ? " is-active" : ""}`}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </section>

          {updatedLabel ? (
            <p className="lineup-template-updated">Updated {updatedLabel}</p>
          ) : null}
        </div>

        <section className="lineup-mobile-upcoming" aria-label="Upcoming Sets">
          <h2>Upcoming Sets</h2>
          {status === "loading" ? (
            <p>Checking calendar...</p>
          ) : status === "error" ? (
            <p>Calendar lineup unavailable. Please check back soon.</p>
          ) : upcomingSets.length > 0 ? (
            upcomingSets.map((set) => (
              <article key={`${set.start}-${set.djName}`}>
                <strong>{set.djName}</strong>
                <span>{set.dateLabel} / {set.timeLabel}</span>
                <p>{set.eventTitle}</p>
              </article>
            ))
          ) : (
            <p>No upcoming calendar sets are posted yet.</p>
          )}
        </section>
      </section>
    </main>
  );
}
