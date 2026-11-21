"use client";

import { useCallback, useEffect, useState } from "react";
import home from "../components/home/home.module.css";
import styles from "./community.module.css";

// Backstage Pass 2.0 (2026-11-10): VIP of the Month (the most interactive guest, automatic), The Sanctuary Chronicles (headlines from Loudwire's RSS feed: headline, publisher,
// date, their own teaser and a link - never the article), Song of the Day and Battle of the Bands. The song and both
// bands are picked at random from what the club's DJs really played, and the facts are the club's own play records.
// Votes count one per visitor. Everything is read through this site's own doorway (app/api/sr2).
const API = "/api/sr2";

type News = { id: number; source: string; title: string; link: string; summary: string | null; author: string | null; published_at: number };
type Chronicles = { featured: News | null; headlines: News[]; feed_ok: boolean };
type Reaction = "love" | "badass" | "rock" | "fav";
type Sotd = {
  today: { day: string; artist: string; title: string; facts: { plays?: number; first_at?: number | null; last_dj?: string | null }; reactions: Record<Reaction, number> } | null;
  archive: { day: string; artist: string; title: string }[];
};
type Battle = {
  current: { id: number; label: string; a: { name: string }; b: { name: string }; closes_at: number; votes: { a: number; b: number } } | null;
  previous: { week: string; label: string; a: { name: string; votes: number }; b: { name: string; votes: number }; winner: string | null; tie: boolean }[];
};

const date = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

function useJson<T>(path: string, every = 0) {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/${path}`, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setData(await r.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [path]);
  useEffect(() => {
    const first = window.setTimeout(load, 0);
    const t = every ? window.setInterval(load, every) : undefined;
    return () => {
      window.clearTimeout(first);
      if (t) window.clearInterval(t);
    };
  }, [load, every]);
  return { data, setData, failed, load };
}

function remember<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}
function keep(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage blocked: the vote still counted */
  }
}

function CopyLink({ hash, label }: { hash: string; label: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    const url = `${window.location.origin}/backstage-pass#${hash}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link:", url);
    }
    setDone(true);
    window.setTimeout(() => setDone(false), 2500);
  }
  return (
    <button type="button" className={styles.copy} onClick={copy} aria-label={`Copy a link to ${label}`}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10.6 13.4a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1.2 1.2 1.4 1.4 1.2-1.2a2 2 0 012.9 2.9l-3 3a2 2 0 01-2.9 0zm2.8-2.8a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1.2-1.2-1.4-1.4-1.2 1.2a2 2 0 01-2.9-2.9l3-3a2 2 0 012.9 0z" fill="currentColor" />
      </svg>
      <span role="status">{done ? "Link copied!" : "Copy link"}</span>
    </button>
  );
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div className={home.titleBar}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/home/headings/home-section-title-bar.webp" alt="" aria-hidden="true" />
      <h2 id={id} className={home.titleText}>
        {children}
      </h2>
    </div>
  );
}

// ------------------------------------------------------------------ The Sanctuary Chronicles
function TheChronicles() {
  const { data, failed } = useJson<Chronicles>("public/chronicles", 15 * 60e3);
  const f = data?.featured;
  return (
    <section id="chronicles" className={`${home.panel} ${styles.section}`} aria-labelledby="chronicles-title">
      <SectionTitle id="chronicles-title">The Sanctuary Chronicles</SectionTitle>
      <p className={styles.kicker}>Rock &amp; metal headlines</p>
      {!data ? (
        <p className={styles.empty}>{failed ? "The news desk can't be reached right now - try again soon." : "Loading the latest headlines…"}</p>
      ) : !f ? (
        <p className={styles.empty}>No fresh headlines right now. Check back soon!</p>
      ) : (
        <>
          <article className={styles.featured}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.featuredArt} src="/images/backstage/backstage-hero-art-960.webp" alt="" aria-hidden="true" loading="lazy" />
            <div className={styles.featuredBody}>
              <p className={styles.tag}>Featured story</p>
              <h3 className={styles.featuredTitle}>
                <a href={f.link} target="_blank" rel="noopener noreferrer">
                  {f.title}
                </a>
              </h3>
              <p className={styles.meta}>
                {f.source} · {date(f.published_at)}
                {f.author ? ` · ${f.author}` : ""}
              </p>
              {f.summary && <p className={styles.summary}>{f.summary}</p>}
              <a className={styles.read} href={f.link} target="_blank" rel="noopener noreferrer">
                Read the full story on {f.source} <span aria-hidden="true">→</span>
              </a>
            </div>
          </article>
          {data.headlines.length > 0 && (
            <ul className={styles.headlines} aria-label="Latest headlines">
              {data.headlines.slice(0, 6).map((n) => (
                <li key={n.id} className={styles.headline}>
                  <p className={styles.meta}>
                    {n.source} · {date(n.published_at)}
                  </p>
                  <h3 className={styles.headTitle}>
                    <a href={n.link} target="_blank" rel="noopener noreferrer">
                      {n.title}
                    </a>
                  </h3>
                  {n.summary && <p className={styles.headSummary}>{n.summary}</p>}
                </li>
              ))}
            </ul>
          )}
          <p className={styles.credit}>
            Headlines and summaries from {data.featured?.source ?? "Loudwire"}; every story links to the original article.
          </p>
        </>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Song of the Day
const SOTD_REACTIONS: { key: Reaction; label: string; emoji: string }[] = [
  { key: "love", label: "Love It", emoji: "❤" },
  { key: "badass", label: "Fire", emoji: "🔥" },
  { key: "rock", label: "Rock On", emoji: "🤘" },
  { key: "fav", label: "Favorite", emoji: "★" },
];

function SongOfTheDay() {
  const { data, setData, failed } = useJson<Sotd>("public/song-of-day", 30 * 60e3);
  const [mine, setMine] = useState<{ day: string; r: Reaction } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setMine(remember("sr-sotd-vote")), 0);
    return () => window.clearTimeout(t);
  }, []);
  const s = data?.today ?? null;
  const picked = mine && s && mine.day === s.day ? mine.r : null;

  async function react(r: Reaction) {
    if (!s || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/public/song-of-day`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ reaction: r, day: s.day }) }).then((x) => x.json());
      if (res.ok) {
        const v = { day: s.day, r };
        setMine(v);
        keep("sr-sotd-vote", v);
        setData((d) => (d?.today ? { ...d, today: { ...d.today, reactions: res.reactions } } : d));
        setNote("Thanks - your vote is in!");
      } else setNote(res.message ?? "That didn't go through - try again.");
    } catch {
      setNote("Couldn't reach the club right now - try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const f = s?.facts ?? {};
  return (
    <article id="song-of-the-day" className={styles.feature} aria-labelledby="sotd-title">
      <h2 id="sotd-title" className={styles.featureTitle}>
        <span aria-hidden="true">♫</span> Sanctuary Song of the Day
      </h2>
      {!s ? (
        <p className={styles.empty}>{failed ? "Couldn't load today's song." : data ? "Today's song is picked once our DJs have played a few." : "Loading…"}</p>
      ) : (
        <>
          <p className={styles.dayLine}>{dayLabel(s.day)}</p>
          <div className={styles.sotd}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className={styles.medallion} src="/images/shared/accents/dragon-medallion.webp" alt="" aria-hidden="true" loading="lazy" />
            <div>
              <p className={styles.songName}>{s.title}</p>
              <p className={styles.songBy}>{s.artist}</p>
            </div>
          </div>
          {f.plays ? (
            <p className={styles.fact}>
              <strong>Club fact:</strong>{" "}
              {f.plays === 1
                ? `played once at Sanctuary Rocks${f.first_at ? `, on ${date(f.first_at)}` : ""}`
                : `played ${f.plays} times at Sanctuary Rocks${f.first_at ? ` since ${date(f.first_at)}` : ""}`}
              {f.last_dj ? `, most recently by ${f.last_dj}` : ""}.
            </p>
          ) : null}
          <div className={styles.reacts} role="group" aria-label="React to the Song of the Day">
            {SOTD_REACTIONS.map((x) => (
              <button
                key={x.key}
                type="button"
                className={`${styles.react} ${picked === x.key ? styles.reactOn : ""}`}
                onClick={() => react(x.key)}
                disabled={busy}
                aria-pressed={picked === x.key}
                aria-label={`${x.label} (${s.reactions[x.key] ?? 0})`}
              >
                <span aria-hidden="true">{x.emoji}</span> {x.label} <b>{s.reactions[x.key] ?? 0}</b>
              </button>
            ))}
          </div>
          <p className={styles.note} role="status" aria-live="polite">
            {note}
          </p>
          <div className={styles.foot}>
            <CopyLink hash="song-of-the-day" label="the Song of the Day" />
            {data!.archive.length > 0 && (
              <details className={styles.archive}>
                <summary>Previous songs</summary>
                <ul>
                  {data!.archive.map((a) => (
                    <li key={a.day}>
                      <span>{dayLabel(a.day)}</span> {a.title} <em>{a.artist}</em>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </>
      )}
    </article>
  );
}

// ------------------------------------------------------------------ Battle of the Bands
function countdown(ms: number) {
  if (ms <= 0) return "Voting has closed";
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 3600e3), m = Math.floor((ms % 3600e3) / 60e3);
  return `Closes in ${d ? `${d}d ` : ""}${h}h ${m}m`;
}

function BattleOfTheBands() {
  const { data, setData, failed, load } = useJson<Battle>("public/battle", 60e3);
  const [mine, setMine] = useState<{ id: number; side: "a" | "b" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const first = window.setTimeout(() => {
      setMine(remember("sr-battle-vote"));
      setNow(Date.now());
    }, 0);
    const t = window.setInterval(() => setNow(Date.now()), 30e3);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(t);
    };
  }, []);
  const b = data?.current ?? null;
  const voted = mine && b && mine.id === b.id ? mine.side : null;

  async function vote(side: "a" | "b") {
    if (!b || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`${API}/public/battle`, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ side, battle_id: b.id }) }).then((x) => x.json());
      if (res.ok || res.error === "already_voted") {
        const v = { id: b.id, side: (res.side ?? side) as "a" | "b" };
        setMine(v);
        keep("sr-battle-vote", v);
        if (res.votes) setData((d) => (d?.current ? { ...d, current: { ...d.current, votes: res.votes } } : d));
        setNote(res.ok ? `Vote counted for ${side === "a" ? b.a.name : b.b.name}!` : res.message);
      } else {
        setNote(res.message ?? "That vote didn't go through - try again.");
        if (res.error === "battle_over") load();
      }
    } catch {
      setNote("Couldn't reach the club right now - try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const total = b ? b.votes.a + b.votes.b : 0;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return (
    <article id="battle-of-the-bands" className={styles.feature} aria-labelledby="battle-title">
      <h2 id="battle-title" className={styles.featureTitle}>
        <span aria-hidden="true">⚔</span> Battle of the Bands
      </h2>
      {!b ? (
        <p className={styles.empty}>{failed ? "Couldn't load the battle." : data ? "The next battle starts once our DJs have played a few bands." : "Loading…"}</p>
      ) : (
        <>
          <p className={styles.dayLine}>
            {b.label} · {now ? countdown(b.closes_at - now) : ""}
          </p>
          <div className={styles.versus}>
            {(["a", "b"] as const).map((side, i) => (
              <div key={side} className={styles.side}>
                {i === 1 && (
                  <span className={styles.vs} aria-hidden="true">
                    VS
                  </span>
                )}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.medallion} src="/images/shared/accents/dragon-medallion.webp" alt="" aria-hidden="true" loading="lazy" />
                <p className={styles.bandName}>{b[side].name}</p>
                <button
                  type="button"
                  className={`${styles.voteBtn} ${voted === side ? styles.voteOn : ""}`}
                  onClick={() => vote(side)}
                  disabled={busy || !!voted}
                  aria-pressed={voted === side}
                  aria-label={`Vote for ${b[side].name}`}
                >
                  {voted === side ? "Your pick" : "Vote"}
                </button>
                <div className={styles.bar} role="img" aria-label={`${b[side].name}: ${b.votes[side]} votes, ${pct(b.votes[side])}%`}>
                  <span style={{ width: `${pct(b.votes[side])}%` }} />
                </div>
                <p className={styles.count}>
                  {b.votes[side]} {b.votes[side] === 1 ? "vote" : "votes"} · {pct(b.votes[side])}%
                </p>
              </div>
            ))}
          </div>
          <p className={styles.note} role="status" aria-live="polite">
            {note || "One vote per fan. Bands are picked at random from what our DJs play at the club."}
          </p>
          <div className={styles.foot}>
            <CopyLink hash="battle-of-the-bands" label="Battle of the Bands" />
            {data!.previous.length > 0 && (
              <details className={styles.archive}>
                <summary>Previous winners</summary>
                <ul>
                  {data!.previous.map((p) => (
                    <li key={p.week}>
                      <span>{p.label}</span>{" "}
                      {p.tie ? (
                        <>
                          {p.a.name} &amp; {p.b.name} tied ({p.a.votes}-{p.b.votes})
                        </>
                      ) : (
                        <>
                          <strong>{p.winner}</strong> beat {p.winner === p.a.name ? p.b.name : p.a.name} ({Math.max(p.a.votes, p.b.votes)}-{Math.min(p.a.votes, p.b.votes)})
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </>
      )}
    </article>
  );
}

// ------------------------------------------------------------------ VIP of the Month (automatic: most interactive guest)
type Vip = {
  current: { month: string; label: string; vip: { name: string; active_days: number } } | null;
  hall_of_fame: { month: string; label: string; name: string }[];
  next: { label: string; crowned_on: number };
};

function VipOfTheMonth() {
  const { data, failed } = useJson<Vip>("public/vip", 30 * 60e3);
  const v = data?.current;
  return (
    <section id="vip-of-the-month" className={`${home.panel} ${styles.section}`} aria-labelledby="vip-title">
      <SectionTitle id="vip-title">VIP of the Month</SectionTitle>
      {!data ? (
        <p className={styles.empty}>{failed ? "Couldn't load the VIP right now." : "Loading…"}</p>
      ) : (
        <div className={styles.vip}>
          <div className={styles.vipFrame} aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/shared/accents/dragon-medallion.webp" alt="" loading="lazy" />
            <span className={styles.vipCrown}>♛</span>
          </div>
          <div className={styles.vipText}>
            {v ? (
              <>
                <p className={styles.tag}>{v.label}</p>
                <p className={styles.vipName}>{v.vip.name}</p>
                <p className={styles.vipLine}>
                  Our most interactive guest of {v.label}, rocking with us on {v.vip.active_days} {v.vip.active_days === 1 ? "night" : "nights"}. Thank you for
                  voting, cheering and keeping the Sanctuary loud!
                </p>
              </>
            ) : (
              <>
                <p className={styles.tag}>{data.next.label}</p>
                <p className={styles.vipName}>Could it be you?</p>
                <p className={styles.vipLine}>
                  Our VIP of the Month is the guest who joins in the most at the club - voting for DJs and hosts, liking songs, requesting
                  and sending shout-outs on the Vote Board. The {data.next.label} VIP is crowned on {date(data.next.crowned_on)}.
                </p>
              </>
            )}
            <div className={styles.foot}>
              <CopyLink hash="vip-of-the-month" label="VIP of the Month" />
              {data.hall_of_fame.length > 0 && (
                <details className={styles.archive}>
                  <summary>VIP Hall of Fame</summary>
                  <ul>
                    {data.hall_of_fame.map((h) => (
                      <li key={h.month}>
                        <span>{h.label}</span> {h.name}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ Did You Know? (one band fact a day)
type Fact = { day: string; band: string; fact: string; about_song_of_day: boolean };

function DidYouKnow() {
  const { data } = useJson<Fact>("public/did-you-know", 60 * 60e3);
  if (!data?.fact) return null;
  return (
    <aside id="did-you-know" className={styles.dyk} aria-labelledby="dyk-title">
      <h2 id="dyk-title" className={styles.featureTitle}>
        <span aria-hidden="true">✦</span> Did You Know?
      </h2>
      <p className={styles.dykBand}>
        {data.band}
        {data.about_song_of_day && <em> · today&rsquo;s Song of the Day band</em>}
      </p>
      <p className={styles.dykFact}>{data.fact}</p>
    </aside>
  );
}

export default function Community() {
  return (
    <>
      <VipOfTheMonth />
      <TheChronicles />
      <section className={`${home.panel} ${styles.section}`} aria-labelledby="fanzone-title">
        <SectionTitle id="fanzone-title">Fan Zone</SectionTitle>
        <div className={styles.pair}>
          <SongOfTheDay />
          <BattleOfTheBands />
        </div>
        <DidYouKnow />
      </section>
    </>
  );
}
