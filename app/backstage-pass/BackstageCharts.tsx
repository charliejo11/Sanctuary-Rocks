"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import styles from "./backstage.module.css";

// Charts from the SR 2.0 backend (Backstage Pass 2.0, 2026-11-10): the MOST-PLAYED songs, counting live DJ plays only
// (AutoDJ is tracked separately), with likes from the Vote Board and Now Playing shown alongside. Weeks run Monday to
// Sunday and months are calendar months, both in SLT (America/Los_Angeles). Finished weeks and months are frozen by the
// backend and stay selectable here. The current period refreshes every minute. Read through this site's own doorway.
const API = "/api/sr2";

type Trend = "up" | "down" | "same" | "new" | "reentry";
type Row = { rank: number; song_key: string; artist: string; title: string; plays: number; likes: number; last_rank: number | null; trend: Trend };
type Period = { week?: string; month?: string; label: string; current?: boolean };
type Chart = {
  label?: string;
  final?: boolean;
  top?: Row[];
  error?: string;
  weeks?: Period[];
  months?: Period[];
};
type Mow = { name: string; photo_url?: string | null; citation?: string | null };
export type ManagerFallback = { name: string; image: string; text: string };

function previousWeek(week: string) {
  const d = new Date(`${week}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

const Crown = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3 7l4.5 4L12 4l4.5 7L21 7l-2 11H5z" fill="currentColor" />
  </svg>
);
const Trophy = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 3h10v2h3v3a4 4 0 01-4 4h-.3A5 5 0 0113 14.9V18h3v3H8v-3h3v-3.1A5 5 0 018.3 12H8a4 4 0 01-4-4V5h3zm0 4H6v1a2 2 0 001 1.7zm10 0v2.7A2 2 0 0018 8V7z" fill="currentColor" />
  </svg>
);
const Star = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" fill="currentColor" />
  </svg>
);

const TREND_WORD: Record<Trend, string> = { up: "Rising", down: "Falling", same: "Unchanged", new: "New", reentry: "Re-entry" };

function TrendCell({ row }: { row: Row }) {
  const word = TREND_WORD[row.trend] ?? "";
  if (row.trend === "new" || row.trend === "reentry") return <span className={styles.trendNew}>{word}</span>;
  const cls = row.trend === "up" ? styles.trendUp : row.trend === "down" ? styles.trendDown : styles.trendSame;
  return (
    <span className={styles.trendCell}>
      <span className={cls} aria-hidden="true" />
      <span className={styles.trendWord}>{word}</span>
      <span className={styles.srOnly}>{row.last_rank ? ` (was ${row.last_rank})` : ""}</span>
    </span>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** One chart table (weekly or monthly) with its archive selector. */
function ChartTable({
  id,
  title,
  kind,
  size,
  emptyText,
}: {
  id: string;
  title: string;
  kind: "week" | "month";
  size: number;
  emptyText: string;
}) {
  const [chart, setChart] = useState<Chart | null>(null);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [pick, setPick] = useState("");
  const [failed, setFailed] = useState(false);
  const endpoint = kind === "week" ? "top10" : "top20";

  const load = useCallback(
    async (which: string) => {
      try {
        const r = await fetch(`${API}/public/${endpoint}${which ? `?${kind}=${which}` : ""}`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const c: Chart = await r.json();
        setChart(c);
        const list = (kind === "week" ? c.weeks : c.months) ?? [];
        if (list.length) setPeriods(list);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    },
    [endpoint, kind],
  );

  useEffect(() => {
    const first = window.setTimeout(() => load(pick), 0);
    // only the period still in progress changes; finished ones are frozen
    const viewingCurrent = !pick || periods.find((p) => (p.week ?? p.month) === pick)?.current;
    const t = viewingCurrent ? window.setInterval(() => load(pick), 60000) : undefined;
    return () => {
      window.clearTimeout(first);
      if (t) window.clearInterval(t);
    };
    // periods only matters for "is this the current one"; don't refetch when the list arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, pick]);

  const rows = (chart?.top ?? []).slice(0, size);
  const loading = !chart && !failed;
  const lastHeading = kind === "week" ? "Last week" : "Last month";

  return (
    <section id={id} className={styles.chartSection} aria-labelledby={`${id}-title`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={`${styles.banner} ${styles.bannerL}`} src="/images/crew/hero/crew-hero-banner-left.webp" alt="" aria-hidden="true" loading="lazy" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={`${styles.banner} ${styles.bannerR}`} src="/images/crew/hero/crew-hero-banner-right.webp" alt="" aria-hidden="true" loading="lazy" />
      <div className={styles.chartPanel}>
        <div className={styles.plate}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/home/headings/home-section-title-bar.webp" alt="" aria-hidden="true" />
          <h2 id={`${id}-title`}>{title}</h2>
        </div>

        <div className={styles.chartBar}>
          <p className={styles.chartWeek}>
            {chart?.label ?? ""}
            {chart?.label ? (chart.final ? " · final chart" : " · counting live") : ""}
          </p>
          {periods.length > 1 && (
            <label className={styles.chartPick}>
              <span>{kind === "week" ? "Week" : "Month"}</span>
              <select value={pick} onChange={(e) => setPick(e.target.value)}>
                {periods.map((p) => {
                  const v = p.week ?? p.month ?? "";
                  return (
                    <option key={v} value={p.current ? "" : v}>
                      {p.current ? `This ${kind} (${p.label})` : p.label}
                    </option>
                  );
                })}
              </select>
            </label>
          )}
        </div>

        {rows.length ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.srOnly}>
                {title}, {chart?.label}: the most-played songs by live DJs, with plays, last {kind}&rsquo;s position and the trend.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Rank</th>
                  <th scope="col">Song</th>
                  <th scope="col" className={styles.colArtist}>
                    Artist
                  </th>
                  <th scope="col">Plays</th>
                  <th scope="col">
                    <span className={styles.wide}>{lastHeading}</span>
                    <abbr className={styles.narrow} title={lastHeading}>
                      {kind === "week" ? "LW" : "LM"}
                    </abbr>
                  </th>
                  <th scope="col">Trend</th>
                  <th scope="col">Likes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.song_key}>
                    <td>
                      <span className={styles.rank}>{s.rank}</span>
                    </td>
                    <td className={styles.song}>
                      {s.title}
                      <span className={styles.songBy}>{s.artist}</span>
                    </td>
                    <td className={styles.colArtist}>{s.artist}</td>
                    <td className={styles.plays}>{s.plays}</td>
                    <td className={styles.lw}>{s.last_rank ?? "–"}</td>
                    <td>
                      <TrendCell row={s} />
                    </td>
                    <td className={styles.likes}>{s.likes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.chartEmpty}>
            {loading
              ? "Loading the chart…"
              : failed
                ? "The chart couldn't be loaded right now. Try again in a minute."
                : chart?.final || chart?.error
                  ? `No live DJ plays were recorded for that ${kind}.`
                  : emptyText}
          </p>
        )}
        <p className={styles.chartNote}>Counts songs played by our live DJs. Likes come from the Vote Board at the club and Now Playing above.</p>
      </div>
    </section>
  );
}

export default function BackstageCharts({ manager }: { manager: ManagerFallback }) {
  const [thisWeek, setThisWeek] = useState<Chart | null>(null);
  const [lastWeek, setLastWeek] = useState<Chart | null>(null);
  const [mow, setMow] = useState<Mow | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const c: Chart & { week?: string } = await fetch(`${API}/public/top10`, { cache: "no-store" }).then((r) => r.json());
        if (!live) return;
        setThisWeek(c);
        return c;
      } catch {
        if (live) setFailed(true);
      }
    };
    (async () => {
      const c = await load();
      const wk = c?.weeks?.find((w) => w.current)?.week;
      const [prev, archive] = await Promise.all([
        wk ? fetch(`${API}/public/top10?week=${previousWeek(wk)}`).then((r) => r.json()).catch(() => null) : null,
        fetch(`${API}/public/archive`).then((r) => r.json()).catch(() => null),
      ]);
      if (!live) return;
      setLastWeek(prev);
      if (archive?.manager_of_the_week?.[0]) setMow(archive.manager_of_the_week[0]);
    })();
    const t = window.setInterval(load, 60000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, []);

  const no1 = lastWeek?.top?.[0] ?? null;
  const top = thisWeek?.top?.[0] ?? null;
  const loading = !thisWeek && !failed;
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
                <p className={styles.songDj}>{plural(no1.plays, "play")}</p>
              </div>
            </div>
          ) : (
            <p className={styles.cardEmpty}>{loading ? "Loading…" : "Crowned after the first full week of live DJ plays."}</p>
          )}
          <a className={styles.cardButton} href="#top10">
            View this week&rsquo;s Top 10
          </a>
        </article>

        <article className={styles.card}>
          <h2 className={styles.cardTitle}>
            <span className={styles.cardIcon}>{Trophy}</span>
            Top Song of the Week
          </h2>
          {top ? (
            <div className={styles.cardBody}>
              <span className={styles.songArt} aria-label={`Ranked number ${top.rank}`}>
                {top.rank}
              </span>
              <div>
                <p className={styles.songTitle}>{top.title}</p>
                <p className={styles.songArtist}>{top.artist}</p>
                <p className={styles.climb}>
                  {plural(top.plays, "play")} · #{top.rank} this week
                </p>
              </div>
            </div>
          ) : (
            <p className={styles.cardEmpty}>{loading ? "Loading…" : failed ? "Couldn't load the chart right now." : "No live DJ plays yet this week - the first set crowns it!"}</p>
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

      <ChartTable
        id="top10"
        title="Sanctuary Rocks Top 10"
        kind="week"
        size={10}
        emptyText="No live DJ plays yet this week. The chart fills up as our DJs spin - come down to the club!"
      />
      <ChartTable
        id="top20"
        title="Monthly Top 20"
        kind="month"
        size={20}
        emptyText="No live DJ plays yet this month. The Top 20 builds itself from every live set."
      />
    </>
  );
}
