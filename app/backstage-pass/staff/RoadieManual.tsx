"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { api, can, day, when, type Me } from "./api";
import { Action, Loading, ReportIssue, Status, useLoad } from "./sections";
import roadie from "./roadie.module.css";
import styles from "./staff.module.css";

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @next/next/no-img-element */

const COVER = "/images/backstage/roadie/roadie-cover.jpg";
const CREST = "/images/backstage/roadie/roadie-crest.png";
const KICKER = "SANCTUARY ROCKS • BACKSTAGE GUIDE";
const GUIDE_NOTE = "How-to guide for the tools. Club rules live in the published chapters.";

const CHAPTERS = [
  { n: 1, title: "WELCOME TO THE CREW", key: "ch1" },
  { n: 2, title: "THE CREW CODE", key: "ch2" },
  { n: 3, title: "THE SETLIST", key: "ch3" },
  { n: 4, title: "KNOW YOUR GIG", key: "ch4" },
  { n: 5, title: "WHEN THINGS GO SIDEWAYS", key: "ch5" },
  { n: 6, title: "KEEPING THE ROCK ALIVE", key: "ch6" },
];

const ORIENTATION = [
  ["signin", "Sign in to Backstage Pass"],
  ["avatar", "Link my avatar (My Sets / Shifts)"],
  ["contents", "Find the chapter list and quick links"],
  ["code", "Read The Crew Code"],
  ["schedule", "Find my shifts in My Schedule"],
  ["board", "Find the Staff Control Board at the club"],
  ["report", "Know where to report a problem"],
  ["contact", "Know how to reach management"],
];

const GUIDES: Record<string, { title: string; intro: string; steps: string[]; check: string[] }> = {
  dj: {
    title: "DJ Quick Guide",
    intro: "Your menu on the Staff Control Board: DJ Log In, Trial Set, Radio, My Stream, Now Playing, Schedule, Tips, Help.",
    steps: [
      "Press DJ on the board, then DJ Log In. You take over the board straight away, even if the last DJ never logged out.",
      "Logging in puts your name on the board. It doesn't prove your audio is reaching the club, so check you can hear yourself.",
      "You don't need to log out. The next DJ logs in and takes over. Management has a DJ Log Out for when one is needed.",
      "Radio switches the club to the radio only when someone picks it on purpose.",
      "My Stream shows the one shared SR stream. Please don't change it without coordinating first.",
    ],
    check: ["Broadcast software connected", "I can hear myself at the club", "Logged in on the Staff Board", "Host knows I'm on"],
  },
  host: {
    title: "Host Quick Guide",
    intro: "Your menu on the Staff Control Board: Host Log In, Host Log Out, Host Trial, Announcements, Schedule, Coverage Request, Tips, Help.",
    steps: [
      "Press HOST on the board, then Host Log In, when you start. Host Log Out when you finish.",
      "Announcements takes you to the current staff notices.",
      "Coverage Request starts a request for management. It doesn't confirm a replacement.",
      "If the music stops, give guests a short, friendly update and let the DJ and management know.",
    ],
    check: ["Logged in on the Staff Board", "Checked current announcements", "Know who the DJ is", "Know who to tell if something goes wrong"],
  },
  management: {
    title: "Management Quick Guide",
    intro: "Your menu on the Staff Control Board: Current Staff, Schedule and Coverage, Trials, Announcements, Music Control, Board Override, DJ Log Out, Chat Extender, Reports, Unresolved Issues, Donation Summary. Tips is under My Shift.",
    steps: [
      "Backstage Pass → Management is the overview: who's on, open shifts, trials, issues and donations.",
      "DJ Log Out is there for when it has to be used. Normally the next DJ just logs in and takes over. It never touches the music.",
      "Trials, then Start Trial, puts a trial DJ on the board and switches the club to the backup stream (the one with the 1 in it). The next DJ's login brings the club back to the SR stream, or use Music Control.",
      "Board Override blanks a stuck DJ, host or manager slot. It never touches the music.",
      "Coverage requests and trials are recorded for you to decide. Nothing is approved automatically.",
      "Donations count only when a donation object confirmed the payment or someone entered the transaction reference.",
    ],
    check: ["Checked who's on duty", "Checked uncovered shifts", "Checked unresolved issues", "Decided anything waiting on me"],
  },
};

const PROBLEMS: { id: string; title: string; category: string; steps: string[] }[] = [
  { id: "music", title: "DJ music is not playing", category: "technical", steps: ["DJ: check your broadcast software says it's connected and sending.", "DJ: check your internet connection and that your mic or music source isn't muted.", "Check you have media turned on in your viewer and can hear other parcels' sound.", "Tell the host, so guests get a short update.", "Do not change or disconnect the shared stream without coordinating."] },
  { id: "stream", title: "The stream is disconnected", category: "technical", steps: ["Reconnect from your broadcast software once.", "If it won't connect, stop retrying and tell the host and management.", "Management can check the stream status in Backstage Pass.", "Report the time it dropped."] },
  { id: "board", title: "The board shows the wrong DJ", category: "technical", steps: ["The correct DJ presses DJ, then DJ Log In. It takes over without anyone logging out first.", "Give it a minute to update.", "Still wrong? Management can use Board Override. It doesn't touch the music."] },
  { id: "host", title: "A host can't log in", category: "technical", steps: ["Stand near the board and try once more.", "If the board says you aren't authorised, management needs to check the roster.", "Host the show anyway and report it, so your shift can be corrected."] },
  { id: "schedule", title: "The schedule is incorrect", category: "scheduling", steps: ["Compare it with the club calendar on the Lineup page.", "Tell management what's wrong: the date, the time and the name.", "Backstage Pass reads the calendar, so it corrects itself once the calendar is fixed."] },
  { id: "coverage", title: "Someone needs coverage", category: "scheduling", steps: ["Use Request Coverage in The Setlist, or My Schedule.", "Don't promise a replacement until it's confirmed.", "If the shift is starting now, tell management directly as well."] },
  { id: "site", title: "The website is unavailable", category: "technical", steps: ["Reload, then try another device or connection.", "Use the Staff Board and Discord until it's back.", "If only Discord sign-in is down, ask Moose for a recovery code."] },
  { id: "vote", title: "The Vote Board is not responding", category: "technical", steps: ["Click once and wait: it can take a few seconds.", "Note which button you pressed and when.", "Report it. Don't reset the board."] },
  { id: "radio", title: "A radio fallback problem", category: "technical", steps: ["Radio plays only when someone picks it. Automatic switching on silence isn't turned on.", "If radio is playing when it shouldn't be, tell management.", "Don't change the shared stream to fix it."] },
  { id: "mgmt", title: "Someone needs management", category: "staffing", steps: ["Check who's on duty on the Staff Board.", "If nobody is, use Contact Management in this book.", "Keep private details out of open chat."] },
];

const CLUB_LINKS = [
  ["/lineup", "DJ Lineup and calendar"], ["/events", "Events"], ["/crew", "Meet the Crew"], ["/about", "About Sanctuary Rocks"],
  ["/gallery", "Gallery"], ["/contact", "Contact"], ["/join", "Staff applications"], ["/backstage-pass", "Public Backstage charts"],
];

const stripTags = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

const showForm = (el: HTMLElement | null) => el?.scrollIntoView({ block: "center" });
const PHONE = "(max-width:760px)";
const watchPhone = (cb: () => void) => {
  const m = window.matchMedia(PHONE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

type Page = { key: string; kicker: string; title?: string; search?: string; body: React.ReactNode; className?: string };

function Checklist({ items, prefix, done, onToggle }: { items: string[][]; prefix: string; done: Set<string>; onToggle: (id: string, on: boolean) => void }) {
  return (
    <div>
      {items.map(([id, label]) => {
        const key = `${prefix}:${id}`;
        return (
          <label key={key} className="checkline">
            <input type="checkbox" checked={done.has(key)} onChange={(e) => onToggle(key, e.target.checked)} /> {label}
          </label>
        );
      })}
    </div>
  );
}

function PolicyBlock({ p, acked, onAck, onAsk, canEdit }: { p: any; acked: boolean; onAck: (id: number) => Promise<void>; onAsk: (p: any) => void; canEdit: boolean }) {
  return (
    <>
      <div className="bookText" dangerouslySetInnerHTML={{ __html: p.html }} />
      <p className="note-line">Last updated {day(p.published_at)}</p>
      <div className="toolRow">
        {p.ack_required ? (acked ? <span className="ackDone">✓ You acknowledged this version</span> : <Action label="I've read and understood this" onRun={() => onAck(p.id)} />) : null}
        <button type="button" onClick={() => onAsk(p)}>Ask about this</button>
        {canEdit ? <a className="editLink" href={`#management:policy:${p.id}`}>✎ Edit this section</a> : null}
      </div>
    </>
  );
}

function GeneralRequest({ kind, label, onDone, onCancel }: { kind: string; label: string; onDone: () => void; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [at, setAt] = useState("");
  const [details, setDetails] = useState("");
  const [err, setErr] = useState("");
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      await api("requests", { kind, shift_title: title, shift_start: at ? Date.parse(at) : null, details });
      onDone();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "That didn't send.");
    }
  };
  return (
    <form className="approval" onSubmit={send}>
      <h3>{label}</h3>
      <label>Which shift?<input required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>When is it?<input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} /></label>
      <label>Anything management should know?<textarea value={details} onChange={(e) => setDetails(e.target.value)} /></label>
      <div className="toolRow"><button type="submit">Send request</button><button type="button" onClick={onCancel}>Cancel</button></div>
      {err ? <p className={styles.error} role="alert">{err}</p> : null}
    </form>
  );
}

function SetlistTools({ onNavigate }: { onNavigate: (v: string) => void }) {
  const { data, error, reload } = useLoad("requests");
  const [asking, setAsking] = useState<[string, string] | null>(null);
  const [sent, setSent] = useState(false);
  const choose = (kind: string, label: string) => { setSent(false); setAsking([kind, label]); };
  return (
    <>
      <p>These go to management. Sending a request records it: it doesn&apos;t change the calendar or approve anything by itself.</p>
      <div className="toolRow">
        <button type="button" onClick={() => onNavigate("schedule")}>View My Schedule</button>
        <button type="button" onClick={() => choose("coverage", "Request coverage")}>Request Coverage</button>
        <button type="button" onClick={() => choose("swap", "Request a swap")}>Request a Swap</button>
        <button type="button" onClick={() => choose("absence", "Report an absence")}>Report an Absence</button>
      </div>
      {asking ? <GeneralRequest kind={asking[0]} label={asking[1]} onCancel={() => setAsking(null)} onDone={() => { setAsking(null); setSent(true); reload(); }} /> : null}
      {sent ? <p className={styles.ok} role="status">Sent. It shows below until management decides.</p> : null}
      <h3>Request status</h3>
      {!data ? <Loading error={error} /> : data.mine.length ? data.mine.slice(0, 8).map((r: any) => (
        <div key={r.id} className="checkrow"><span className="checkitem">{r.kind}: {r.shift_title ?? "general"}</span> <Status value={r.status} /><br /><small>{when(r.shift_start)}{r.note ? ` · ${r.note}` : ""}</small></div>
      )) : <p>You have no requests.</p>}
    </>
  );
}

function SuggestionBox() {
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <div className="approval">
      <label>Got an idea for the club?<textarea value={body} onChange={(e) => { setBody(e.target.value); setSent(false); }} /></label>
      <Action label="Send suggestion" onRun={async () => { await api("suggestions", { body }); setBody(""); setSent(true); }} />
      {sent ? <p className={styles.ok} role="status">Thanks. Management will see it.</p> : null}
    </div>
  );
}

export default function RoadieManual({ me, onNavigate }: { me: Me; onNavigate: (view: string) => void }) {
  const { data, error, reload } = useLoad("manual");
  // the open page is remembered by name, so its place survives a reload and the chapter's length changing
  const [pageKey, setPageKey] = useState<string | null>(() => window.location.hash.split(":")[1] ?? null);
  const mobile = useSyncExternalStore(watchPhone, () => window.matchMedia(PHONE).matches, () => false);
  const [query, setQuery] = useState("");
  const [report, setReport] = useState<{ title: string; category: string; source: string } | null>(null);
  const step = mobile ? 1 : 2;

  const goKey = useCallback((key: string | null) => {
    setPageKey(key);
    setQuery("");
    window.history.replaceState(null, "", key ? `#manual:${key}` : "#manual");
  }, []);

  // ticks show at once; the account copy catches up, and a failed save puts the tick back
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const done = useMemo(() => {
    const set = new Set<string>(data?.progress ?? []);
    for (const [item, on] of Object.entries(ticks)) if (on) set.add(item); else set.delete(item);
    return set;
  }, [data, ticks]);
  const toggle = useCallback(async (item: string, on: boolean) => {
    setTicks((t) => ({ ...t, [item]: on }));
    try {
      await api("manual/progress", { item, done: on });
    } catch {
      setTicks((t) => ({ ...t, [item]: !on }));
    }
  }, []);
  const ack = useCallback(async (id: number) => {
    await api("manual/ack", { policy_id: id });
    await reload();
  }, [reload]);

  const pages: Page[] = useMemo(() => {
    if (!data) return [];
    const policies: any[] = data.policies;
    const acks: number[] = data.acks;
    const pending = (ch: number) => data.pending_by_chapter.find((p: any) => p.chapter === ch)?.n ?? 0;
    const owner = me.user.roles.includes("owner");
    const ask = (p: any) => setReport({ title: `Question about: ${p.title}`, category: "policy", source: "manual" });
    const blocks = (ch: number) => policies.filter((p) => p.chapter === ch);
    const underReview = (ch: number) => (pending(ch) ? <p className="callout">{pending(ch)} section{pending(ch) === 1 ? " is" : "s are"} still with Moose for review. Only published text is official, so it isn&apos;t shown here yet.</p> : null);
    const policyPages = (ch: number): Page[] => blocks(ch).map((p) => ({
      key: `p-${p.slug}`, kicker: KICKER, title: p.title, search: `${p.title} ${stripTags(p.html)}`,
      body: <PolicyBlock p={p} acked={acks.includes(p.id)} onAck={ack} onAsk={ask} canEdit={owner} />,
    }));
    const guide = (role: string): Page => {
      const g = GUIDES[role];
      return {
        key: `gig-${role}`, kicker: "KNOW YOUR GIG", title: g.title, search: `${g.title} ${g.intro} ${g.steps.join(" ")} ${g.check.join(" ")}`,
        body: (
          <>
            <p className="note-line">{GUIDE_NOTE}</p>
            <p>{g.intro}</p>
            {g.steps.map((s) => <p key={s} className="listline">✦ {s}</p>)}
            <h3>Show checklist</h3>
            <Checklist prefix={`gig-${role}`} items={g.check.map((c, i) => [String(i), c])} done={done} onToggle={toggle} />
          </>
        ),
      };
    };
    const list: Page[] = [
      {
        key: "opener", kicker: "STAFF EDITION • CREW ONLY", className: "opener",
        body: (
          <>
            <img className="crest" src={CREST} alt="Sanctuary Rocks logo" />
            <h1>THE ROADIE<br />MANUAL</h1>
            <p className="subtitle">Your backstage guide to keeping the rock alive</p>
            <p className="motto">THE MUSIC BRINGS THEM IN.<br />THE PEOPLE MAKE THEM STAY.</p>
          </>
        ),
      },
      {
        key: "contents", kicker: "BACKSTAGE DIRECTORY", title: "Choose your chapter",
        body: (
          <>
            <p>Flip through the book with the arrows, or jump straight to a chapter.</p>
            <div className="toc">
              {CHAPTERS.map((c) => <div key={c.n}><button type="button" onClick={() => goKey(c.key)}>{String(c.n).padStart(2, "0")} <span>{c.title}</span></button></div>)}
            </div>
            <p className="callout">Only pages Moose has published are official. Anything still under review stays out of this book.</p>
          </>
        ),
      },
      {
        key: "quick", kicker: "BACKSTAGE DIRECTORY", title: "Quick links",
        body: (
          <div className="toc">
            <div><button type="button" onClick={() => goKey("gig-dj")}>DJ Help</button></div>
            <div><button type="button" onClick={() => goKey("gig-host")}>Host Help</button></div>
            <div><button type="button" onClick={() => onNavigate("schedule")}>Schedule</button></div>
            <div><button type="button" onClick={() => goKey("setlist")}>Shift Coverage</button></div>
            <div><button type="button" onClick={() => { setReport({ title: "", category: "technical", source: "manual" }); }}>Report an Issue</button></div>
            <div><button type="button" onClick={() => setReport({ title: "I need management", category: "staffing", source: "manual" })}>Contact Management</button></div>
            <div><button type="button" onClick={() => goKey("links")}>Important Club Links</button></div>
            <div><button type="button" onClick={() => goKey("updates")}>Policy Updates</button></div>
          </div>
        ),
      },
      {
        key: "updates", kicker: "BACKSTAGE DIRECTORY", title: "Policy updates",
        body: policies.length ? (
          <>
            {[...policies].sort((a, b) => b.published_at - a.published_at).slice(0, 12).map((p) => (
              <div key={p.id} className="checkrow">
                <button type="button" className="textLink" onClick={() => goKey(p.chapter === 2 ? "ch2" : `p-${p.slug}`)}>{p.title}</button><br />
                <small>Updated {day(p.published_at)}{p.ack_required && !acks.includes(p.id) ? " · Please acknowledge" : ""}</small>
              </div>
            ))}
          </>
        ) : <p className="callout">No policies have been published yet.</p>,
      },
      { key: "ch1", kicker: KICKER, title: "WELCOME TO THE CREW", body: (<><p>New here, or back for a refresher? The orientation checklist is at the end of this chapter.</p>{underReview(1)}</>) },
      ...policyPages(1),
      {
        key: "orientation", kicker: "WELCOME TO THE CREW", title: "Orientation checklist", search: `Orientation checklist ${ORIENTATION.map((o) => o[1]).join(" ")}`,
        body: (
          <>
            <p>This saves to your account, so it follows you to any device.</p>
            <Checklist prefix="orient" items={ORIENTATION} done={done} onToggle={toggle} />
            <p className="note-line">{ORIENTATION.filter(([id]) => done.has(`orient:${id}`)).length} of {ORIENTATION.length} done</p>
          </>
        ),
      },
      {
        key: "ch2", kicker: KICKER, title: "THE CREW CODE", search: blocks(2).map((p) => `${p.title} ${stripTags(p.html)}`).join(" "),
        body: (
          <>
            {underReview(2)}
            {blocks(2).map((p) => (
              <details key={p.id} className="policy">
                <summary>{p.title}{p.ack_required && !acks.includes(p.id) ? " · Please acknowledge" : ""}</summary>
                <PolicyBlock p={p} acked={acks.includes(p.id)} onAck={ack} onAsk={ask} canEdit={owner} />
              </details>
            ))}
            {!blocks(2).length && !pending(2) ? <p>Nothing here yet.</p> : null}
          </>
        ),
      },
      { key: "ch3", kicker: KICKER, title: "THE SETLIST", body: (<><p>Showtime, schedules and shift changes. Your schedule tools are at the end of this chapter.</p>{underReview(3)}</>) },
      ...policyPages(3),
      { key: "setlist", kicker: "THE SETLIST", title: "Your schedule tools", search: "View My Schedule Request Coverage Swap Report Absence Request Status", body: <SetlistTools onNavigate={onNavigate} /> },
      {
        key: "ch4", kicker: KICKER, title: "KNOW YOUR GIG",
        body: (
          <>
            <p>Different roles, one show. Pick your quick guide:</p>
            <div className="toc">
              <div><button type="button" onClick={() => goKey("gig-dj")}>DJ Quick Guide</button></div>
              <div><button type="button" onClick={() => goKey("gig-host")}>Host Quick Guide</button></div>
              {can(me, "management") ? <div><button type="button" onClick={() => goKey("gig-management")}>Management Quick Guide</button></div> : null}
            </div>
            {underReview(4)}
          </>
        ),
      },
      ...policyPages(4),
      guide("dj"), guide("host"),
      ...(can(me, "management") ? [guide("management")] : []),
      {
        key: "ch5", kicker: KICKER, title: "WHEN THINGS GO SIDEWAYS", search: PROBLEMS.map((p) => `${p.title} ${p.steps.join(" ")}`).join(" "),
        body: (
          <>
            <p className="note-line">Troubleshooting center. {GUIDE_NOTE}</p>
            {PROBLEMS.map((p) => (
              <details key={p.id} className="policy">
                <summary>{p.title}</summary>
                {p.steps.map((s, i) => <p key={s} className="listline">{i + 1}. {s}</p>)}
                <button type="button" onClick={() => setReport({ title: p.title, category: p.category, source: "manual" })}>Still broken? Report it</button>
              </details>
            ))}
            {underReview(5)}
          </>
        ),
      },
      ...policyPages(5),
      {
        key: "ch6", kicker: KICKER, title: "KEEPING THE ROCK ALIVE", search: "suggestions recognition announcements event resources",
        body: (
          <>
            <SuggestionBox />
            <div className="toolRow">
              <button type="button" onClick={() => onNavigate("recognition")}>Recognition</button>
              <button type="button" onClick={() => onNavigate("announcements")}>Announcements</button>
              <button type="button" onClick={() => goKey("links")}>Event resources</button>
            </div>
            {underReview(6)}
          </>
        ),
      },
      ...policyPages(6),
      {
        key: "links", kicker: "KEEPING THE ROCK ALIVE", title: "Important club links", search: `Important club links ${CLUB_LINKS.map((l) => l[1]).join(" ")}`,
        body: (
          <div className="toc">
            {CLUB_LINKS.map(([href, label]) => <div key={href}><a href={href}>{label}</a></div>)}
            {data.links?.staff ? <div><a href={data.links.staff} rel="noopener noreferrer">Staff Discord</a></div> : null}
            {data.links?.vip ? <div><a href={data.links.vip} rel="noopener noreferrer">VIP Discord</a></div> : null}
          </div>
        ),
      },
      {
        key: "encore", kicker: "THE FINAL ENCORE", title: "Ready for the crew?",
        body: (
          <>
            <img className="crest smallcrest" src={CREST} alt="Sanctuary Rocks" />
            <p className="motto">THE MUSIC BRINGS THEM IN.<br />THE PEOPLE MAKE THEM STAY.</p>
            <p className="callout">Don&apos;t share passwords, stream credentials or private staff records, even in here.</p>
          </>
        ),
      },
    ];
    return list;
  }, [data, done, ack, toggle, me, onNavigate, goKey]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return pages.flatMap((p) => {
      const text = `${p.title ?? ""} ${p.search ?? ""}`;
      const at = text.toLowerCase().indexOf(q);
      return at < 0 ? [] : [{ key: p.key, title: p.title ?? p.key, snippet: text.slice(Math.max(0, at - 40), at + 80) }];
    }).slice(0, 12);
  }, [query, pages]);

  if (!data) return <Loading error={error} />;

  // -1 is the closed cover; a desktop spread always starts on an even page
  const found = pageKey ? pages.findIndex((p) => p.key === pageKey) : -1;
  const pos = found < 0 ? -1 : found - (found % step);
  const last = pages.length - step;
  const turn = (to: number) => goKey(to < 0 ? null : pages[Math.min(to, Math.max(0, last))].key);
  const visible = pos < 0 ? [] : pages.slice(pos, pos + step);

  return (
    <div className={roadie.root}>
      <div className="searchBar">
        <label htmlFor="manual-search">Search the manual</label>
        <input id="manual-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search published pages and guides" />
        {query.trim().length >= 2 ? (
          <ul className="results" aria-live="polite">
            {results.length ? results.map((r) => (
              <li key={r.key}><button type="button" onClick={() => goKey(r.key)}><strong>{r.title}</strong><br /><small>…{r.snippet}…</small></button></li>
            )) : <li className="noResults">Nothing found.</li>}
          </ul>
        ) : null}
      </div>
      <div className="stage">
        <div className={`book${pos < 0 ? " closed" : ""}`}>
          {pos < 0 ? (
            <img className="cover" src={COVER} alt="Sanctuary Rocks leather-bound Roadie Manual cover" />
          ) : visible.map((p) => (
            <section key={p.key} className={`sheet turning ${p.className ?? ""}`}>
              <div className="kicker">{p.kicker}</div>
              {p.title ? <h2>{p.title}</h2> : null}
              {p.body}
            </section>
          ))}
        </div>
      </div>
      {report ? (
        <div className="reportBox" ref={showForm}>
          <div className={roadie.reportInner}>
            <h3>{report.title || "Report an issue"}</h3>
            <ReportIssue key={report.title} preset={report} />
            <button type="button" onClick={() => setReport(null)}>Close</button>
          </div>
        </div>
      ) : null}
      <nav className="nav" aria-label="Book pages">
        <button type="button" disabled={pos < 0} onClick={() => turn(pos - step)}>◀ Previous</button>
        <strong aria-live="polite">{pos < 0 ? "Cover" : `Pages ${pos + 1}–${Math.min(pos + step, pages.length)} of ${pages.length}`}</strong>
        <button type="button" disabled={pos >= last} onClick={() => turn(pos < 0 ? 0 : pos + step)}>{pos < 0 ? "Open Book ▶" : "Next ▶"}</button>
        {pos >= 0 ? <button type="button" onClick={() => goKey("contents")}>Contents</button> : null}
      </nav>
    </div>
  );
}
