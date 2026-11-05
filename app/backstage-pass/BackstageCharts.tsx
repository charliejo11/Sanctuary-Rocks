"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./backstage.module.css";

// Live chart data from the SR 2.0 backend: song likes from the Vote Board in
// the club and the Now Playing icons. The current week is still being voted
// on (refreshed every minute); the backend finalises each week on Monday
// (America/Los_Angeles). Read through this site's own doorway (app/api/sr2).
const API = "/api/sr2";

type Credit = { dj_name: string };
type Song = { rank: number; song_key: string; artist: string; title: string; positive: number; credited?: Credit[]; autodj?: number };
type Climber = Song & { previous_rank: number; movement: number };
type Charts = {
  week: string;
  songs?: { label: string; top: Song[] };
  awards?: { last_week_no1: Song | null; biggest_climber: Climber | null };
};
type Mow = { name: string; photo_url?: string | null; citation?: string | null };
export type ManagerFallback = { name: string; image: string; text: string };

function previousWeek(week: string) {
  const d = new Date(`${week}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

// The verified DJ who played it; "AutoDJ" when only AutoDJ did. A DJ who wasn't logged in is never named.
const djOf = (s: Song) => s.credited?.[0]?.dj_name ?? (s.autodj ? "AutoDJ" : "");

const Crown = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5z" fill="currentColor" />
  </svg>
);
const Rise = (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
  </svg>
);
const Star = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" fill="currentColor" />
  </svg>
);

function Trend({ now, last }: { now: number; last?: number }) {
  if (!last) return <span className={styles.trendNew}>New</span>;
  if (last > now) return <span className={styles.trendUp} aria-label={`Up from ${last}`} />;
  if (last < now) return <span className={styles.trendDown} aria-label={`Down from ${last}`} />;
  return <span className={styles.trendSame} aria-label="No change" />;
}

export default function BackstageCharts({ manager }: { manager: ManagerFallback }) {
  const [charts, setCharts] = useState<Charts | null>(null);
  const [lastRanks, setLastRanks] = useState<Map<string, number>>(new Map());
  const [mow, setMow] = useState<Mow | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const c: Charts = await fetch(`${API}/public/charts`).then((r) => r.json());
        if (!live) return;
        setCharts(c);
        const [prev, archive] = await Promise.all([
          fetch(`${API}/public/charts?week=${previousWeek(c.week)}`).then((r) => r.json()).catch(() => null),
          fetch(`${API}/public/archive`).then((r) => r.json()).catch(() => null),
        ]);
        if (!live) return;
        setLastRanks(new Map(((prev?.songs?.top ?? []) as Song[]).map((s) => [s.song_key, s.rank])));
        if (archive?.manager_of_the_week?.[0]) setMow(archive.manager_of_the_week[0]);
      } catch {
        if (live) setFailed(true);
      }
    })();
    // keep this week's chart current while the page is open
    const t = setInterval(async () => {
      try {
        const c: Charts = await fetch(`${API}/public/charts`).then((r) => r.json());
        if (live && c?.songs) setCharts(c);
      } catch {
        /* keep the last good chart */
      }
    }, 60000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const top = (charts?.songs?.top ?? []).slice(0, 10);
  const no1 = charts?.awards?.last_week_no1 ?? null;
  const climber = charts?.awards?.biggest_climber ?? null;
  const loading = !charts && !failed;
  const mName = mow?.name ?? manager.name;
  const mText = mow?.citation ?? manager.text;
  const mImage = mow?.photo_url ?? manager.image;

  return (
    <>
      {/* ------------------------------------------------------ highlight cards */}
      <section className={styles.highlights} aria-label="This week's highlights">
        <article className={styles.card}>
          <h2 className={styles.cardTitle}>
            <span className={styles.cardIcon}>{Crown}</span>
            Last Week&rsquo;s <em>#1</em>
          </h2>
          {no1 ? (
            <div className={styles.cardBody}>
              <span className={styles.songArt} aria-hidden="true">1</span>
              <div>
                <p className={styles.songTitle}>{no1.title}</p>
                <p className={styles.songArtist}>{no1.artist}</p>
                {djOf(no1) && <p className={styles.songDj}>DJ: {djOf(no1)}</p>}
              </div>
            </div>
          ) : (
            <p className={styles.cardEmpty}>{loading ? "Loading…" : "Crowned after the first full week of voting."}</p>
          )}
          <a className={styles.cardButton} href="#top10">
            View this week&rsquo;s Top 10
          </a>
        </article>

        <article className={styles.card}>
          <h2 className={styles.cardTitle}>
            <span className={styles.cardIcon}>{Rise}</span>
            Biggest Climber
          </h2>
          {climber ? (
            <div className={styles.cardBody}>
              <span className={styles.songArt} aria-hidden="true">{climber.rank}</span>
              <div>
                <p className={styles.songTitle}>{climber.title}</p>
                <p className={styles.songArtist}>{climber.artist}</p>
                <p className={styles.climb}>▲ +{climber.movement}</p>
              </div>
            </div>
          ) : (
            <p className={styles.cardEmpty}>{loading ? "Loading…" : "Shows once there are two weeks of charts to compare."}</p>
          )}
          <a className={styles.cardButton} href="#top10">
            View full chart
          </a>
        </article>

        <article className={styles.card}>
          <h2 className={styles.cardTitle}>
            <span className={styles.cardIcon}>{Star}</span>
            Manager of the Week
          </h2>
          <div className={styles.cardBody}>
            {mImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className={styles.managerPhoto} src={mImage} alt={mName} loading="lazy" />
            ) : null}
            <div>
              <p className={styles.songTitle}>{mName}</p>
              <p className={styles.managerText}>{mText}</p>
            </div>
          </div>
          <Link className={styles.cardButton} href="/crew">
            Our management team
          </Link>
        </article>
      </section>

      {/* ------------------------------------------------------------ top 10 */}
      <section id="top10" className={styles.chartSection} aria-labelledby="top10-title">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={`${styles.banner} ${styles.bannerL}`} src="/images/crew/hero/crew-hero-banner-left.webp" alt="" aria-hidden="true" loading="lazy" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={`${styles.banner} ${styles.bannerR}`} src="/images/crew/hero/crew-hero-banner-right.webp" alt="" aria-hidden="true" loading="lazy" />
        <div className={styles.chartPanel}>
          <div className={styles.plate}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/home/headings/home-section-title-bar.webp" alt="" aria-hidden="true" />
            <h2 id="top10-title">Sanctuary Rocks Top 10</h2>
          </div>
          {charts?.songs?.label && <p className={styles.chartWeek}>{charts.songs.label} · voted live at the club</p>}
          {top.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">LW</th>
                    <th scope="col">Song</th>
                    <th scope="col">Artist</th>
                    <th scope="col">DJ</th>
                    <th scope="col">Likes</th>
                    <th scope="col">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((s) => {
                    const lw = lastRanks.get(s.song_key);
                    return (
                      <tr key={s.song_key}>
                        <td>
                          <span className={styles.rank}>{s.rank}</span>
                        </td>
                        <td className={styles.lw}>{lw ?? "–"}</td>
                        <td className={styles.song}>{s.title}</td>
                        <td>{s.artist}</td>
                        <td>{djOf(s)}</td>
                        <td className={styles.likes}>{s.positive}</td>
                        <td>
                          <Trend now={s.rank} last={lw} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.chartEmpty}>
              {loading
                ? "Loading the chart…"
                : failed
                  ? "The chart couldn't be loaded right now. Try again in a minute."
                  : "This week's chart is being voted on right now. Hit the Vote Board at the club and push your favourite songs up the Top 10!"}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
