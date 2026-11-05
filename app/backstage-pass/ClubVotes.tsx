"use client";

import home from "../components/home/home.module.css";
import styles from "./backstage.module.css";
import { plural, useClubVotes, type Standing } from "./useClubVotes";

// Club Votes: what guests choose on the Vote Board in the club, counted by the
// backend as the votes come in. DJ and Host of the Month, this week's most
// requested songs and the latest staff shoutouts. Refreshes every minute.
const Crown = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5z" fill="currentColor" />
  </svg>
);
const Note = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M9 18.5a3 3 0 11-2-2.8V5l12-2.5v12.8a3 3 0 11-2-2.8V6.9l-8 1.7z" fill="currentColor" />
  </svg>
);
const Shout = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 10v4h3l6 4.5v-13L6 10zM15 8.5a5 5 0 010 7M17.5 6a8.5 8.5 0 010 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

function Ranked({ list, empty }: { list: Standing[]; empty: string }) {
  if (!list.length) return <p className={styles.voteEmpty}>{empty}</p>;
  return (
    <ol className={styles.voteList}>
      {list.slice(0, 5).map((s) => (
        <li key={s.name} className={styles.voteRow}>
          <span className={`${styles.rank} ${styles.voteRank}`}>{s.rank}</span>
          <span className={styles.voteName}>{s.name}</span>
          <span className={styles.voteCount}>{plural(s.votes, "vote")}</span>
        </li>
      ))}
    </ol>
  );
}

export default function ClubVotes() {
  const v = useClubVotes();
  const loading = "Loading…";

  return (
    <section className={`${home.panel} ${styles.votesPanel}`} aria-labelledby="club-votes-title">
      <div className={home.titleBar}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/home/headings/home-section-title-bar.webp" alt="" aria-hidden="true" />
        <h2 id="club-votes-title" className={home.titleText}>
          Club Votes
        </h2>
      </div>
      <p className={styles.staffLine}>Voted live on the Vote Board at the club{v ? ` · ${v.month_label}` : ""}</p>
      <ul className={styles.staffGrid}>
        <li className={styles.staffCard}>
          <h3 className={styles.staffHeading}>
            <span className={styles.cardIcon}>{Crown}</span>
            DJ of the Month
          </h3>
          {v ? <Ranked list={v.dj.month} empty="No DJ votes yet this month. Be the first at the Vote Board!" /> : <p className={styles.voteEmpty}>{loading}</p>}
        </li>
        <li className={styles.staffCard}>
          <h3 className={styles.staffHeading}>
            <span className={styles.cardIcon}>{Crown}</span>
            Host of the Month
          </h3>
          {v ? <Ranked list={v.host.month} empty="No Host votes yet this month. Be the first at the Vote Board!" /> : <p className={styles.voteEmpty}>{loading}</p>}
        </li>
        <li className={styles.staffCard}>
          <h3 className={styles.staffHeading}>
            <span className={styles.cardIcon}>{Note}</span>
            Most Requested
          </h3>
          {!v ? (
            <p className={styles.voteEmpty}>{loading}</p>
          ) : v.requests.week.length ? (
            <ol className={styles.voteList}>
              {v.requests.week.slice(0, 5).map((r) => (
                <li key={`${r.artist}|${r.title}`} className={styles.voteRow}>
                  <span className={`${styles.rank} ${styles.voteRank}`}>{r.rank}</span>
                  <span className={styles.voteName}>
                    {r.title}
                    <span className={styles.voteSub}>{r.artist}</span>
                  </span>
                  <span className={styles.voteCount}>{r.requests}×</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.voteEmpty}>No requests yet this week. Ask for your favourite at the Vote Board!</p>
          )}
        </li>
        <li className={styles.staffCard}>
          <h3 className={styles.staffHeading}>
            <span className={styles.cardIcon}>{Shout}</span>
            Staff Shoutouts
          </h3>
          {!v ? (
            <p className={styles.voteEmpty}>{loading}</p>
          ) : v.shoutouts.length ? (
            <ul className={styles.voteList}>
              {v.shoutouts.slice(0, 4).map((s) => (
                <li key={`${s.at}|${s.to}`} className={styles.shout}>
                  <span className={styles.shoutTo}>{s.to}</span>
                  <span className={styles.shoutText}>&ldquo;{s.text}&rdquo;</span>
                  {s.from && <span className={styles.voteSub}>from {s.from}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.voteEmpty}>No shoutouts yet. Thank your favourite crew member at the Vote Board!</p>
          )}
        </li>
      </ul>
    </section>
  );
}
