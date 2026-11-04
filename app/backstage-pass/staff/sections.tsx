"use client";

import { useCallback, useEffect, useState } from "react";
import { api, can, day, nameKey, when, type Me } from "./api";
import styles from "./staff.module.css";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function useLoad<T = any>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this.");
    }
  }, [path]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a fetch, set when it answers
    reload();
  }, [reload]);
  return { data, error, reload };
}

export function Status({ value }: { value: string }) {
  return <span className={`${styles.badge} ${styles[`b_${value}`] ?? ""}`}>{value.replace(/_/g, " ")}</span>;
}

export function Loading({ error }: { error?: string }) {
  return error ? <p className={styles.error} role="alert">{error}</p> : <p className={styles.muted}>Loading…</p>;
}

/** A form that shows its own errors and success, so no section repeats that logic. */
export function Action({ label, onRun, confirm, className }: { label: string; onRun: () => Promise<unknown>; confirm?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [asking, setAsking] = useState(false);
  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      await onRun();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work.");
    }
    setBusy(false);
    setAsking(false);
  };
  if (asking)
    return (
      <span className={styles.confirm}>
        {confirm}{" "}
        <button type="button" className={styles.small} disabled={busy} onClick={go}>Yes</button>{" "}
        <button type="button" className={styles.small} onClick={() => setAsking(false)}>Cancel</button>
      </span>
    );
  return (
    <>
      <button type="button" className={className ?? styles.small} disabled={busy} onClick={() => (confirm ? setAsking(true) : go())}>{label}</button>
      {err ? <span className={styles.error} role="alert"> {err}</span> : null}
    </>
  );
}

type LineupSet = { eventTitle: string; djName: string; host: string; start: string; end: string; dateLabel: string; timeLabel: string };

function RequestForm({ set, role, onDone, onCancel }: { set: LineupSet; role: string | null; onDone: () => void; onCancel: () => void }) {
  const [kind, setKind] = useState("coverage");
  const [details, setDetails] = useState("");
  const [swapWith, setSwapWith] = useState("");
  const [err, setErr] = useState("");
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("requests", {
        kind, details, swap_with: swapWith, role, shift_title: set.eventTitle, shift_key: `${set.start}|${set.eventTitle}`,
        shift_start: Date.parse(set.start), shift_end: Date.parse(set.end),
      });
      onDone();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "That didn't send.");
    }
  };
  return (
    <form className={styles.form} onSubmit={send}>
      <label>What do you need?
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="coverage">Someone to cover this shift</option>
          <option value="swap">To swap this shift</option>
          <option value="absence">To report I&apos;ll be absent or late</option>
        </select>
      </label>
      {kind === "swap" ? <label>Swapping with<input value={swapWith} onChange={(e) => setSwapWith(e.target.value)} /></label> : null}
      <label>Anything management should know? (no personal details needed)<textarea rows={2} value={details} onChange={(e) => setDetails(e.target.value)} /></label>
      <div className={styles.row}>
        <button className={styles.primary} type="submit">Send request</button>
        <button type="button" className={styles.linkButton} onClick={onCancel}>Cancel</button>
      </div>
      {err ? <p className={styles.error} role="alert">{err}</p> : null}
    </form>
  );
}

export function MySchedule({ me }: { me: Me }) {
  const { data, error, reload } = useLoad("requests");
  const [sets, setSets] = useState<LineupSet[] | null>(null);
  const [scheduleError, setScheduleError] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/lineup").then((r) => r.json()).then((d) => {
      setSets(d.sets ?? []);
      if (d.error) setScheduleError("The club calendar couldn't be read just now.");
    }).catch(() => setScheduleError("The club calendar couldn't be read just now."));
  }, []);
  const [calendarName, setCalendarName] = useState(me.user.calendar_name ?? "");
  const [savedName, setSavedName] = useState(me.user.calendar_name ?? "");
  const key = nameKey(savedName || me.user.name);
  const isMine = (s: LineupSet) => nameKey(s.djName ?? "") === key || nameKey(s.host ?? "") === key;
  const roleIn = (s: LineupSet) => (nameKey(s.djName ?? "") === key ? "dj" : nameKey(s.host ?? "") === key ? "host" : null);
  const mine = (sets ?? []).filter(isMine);
  const row = (s: LineupSet) => {
    const k = `${s.start}|${s.eventTitle}`;
    return (
      <li key={k} className={styles.item}>
        <div className={styles.itemHead}>
          <strong>{s.eventTitle}</strong>
          <span className={styles.muted}>{when(s.start)}</span>
        </div>
        <p className={styles.muted}>{[s.djName && `DJ: ${s.djName}`, s.host && `Host: ${s.host}`].filter(Boolean).join(" · ") || "Lineup to be confirmed"}</p>
        {asking === k ? (
          <RequestForm set={s} role={roleIn(s)} onCancel={() => setAsking(null)} onDone={() => { setAsking(null); reload(); }} />
        ) : isMine(s) ? (
          <button type="button" className={styles.small} onClick={() => setAsking(k)}>Request coverage, swap or absence</button>
        ) : null}
      </li>
    );
  };
  return (
    <div className={styles.stack}>
      <p className={styles.note}>The club calendar is the official schedule. Requests here are recorded for management: nothing changes on the calendar until someone updates it.</p>
      <section className={styles.card} aria-labelledby="mine">
        <h2 id="mine">My scheduled shifts</h2>
        {scheduleError ? <p className={styles.error}>{scheduleError}</p> : null}
        {sets === null ? <Loading /> : mine.length ? <ul className={styles.list}>{mine.map(row)}</ul> : <p className={styles.muted}>No upcoming shifts match the name “{savedName || me.user.name}” on the calendar.</p>}
        <div className={styles.form}>
          <label>My name on the calendar, if it&apos;s different from my Discord name<input value={calendarName} onChange={(e) => setCalendarName(e.target.value)} placeholder={me.user.name} maxLength={80} /></label>
          <Action label="Save calendar name" onRun={async () => setSavedName((await api("me/calendar-name", { calendar_name: calendarName })).calendar_name ?? "")} />
        </div>
      </section>
      <section className={styles.card} aria-labelledby="req">
        <h2 id="req">My requests</h2>
        {!data ? <Loading error={error} /> : data.mine.length ? (
          <ul className={styles.list}>
            {data.mine.map((r: any) => (
              <li key={r.id} className={styles.item}>
                <div className={styles.itemHead}><strong>{r.kind}: {r.shift_title ?? "general"}</strong><Status value={r.status} /></div>
                <p className={styles.muted}>{when(r.shift_start)}{r.volunteer_name ? ` · ${r.volunteer_name} offered to cover` : ""}{r.note ? ` · Note: ${r.note}` : ""}</p>
                {r.status === "pending" && r.requester_id === me.user.id ? <Action label="Cancel request" onRun={async () => { await api(`requests/${r.id}/cancel`, {}); reload(); }} /> : null}
              </li>
            ))}
          </ul>
        ) : <p className={styles.muted}>Nothing yet.</p>}
      </section>
      <section className={styles.card} aria-labelledby="open">
        <h2 id="open">Shifts you could cover</h2>
        {!data ? <Loading error={error} /> : data.open.length ? (
          <ul className={styles.list}>
            {data.open.map((r: any) => (
              <li key={r.id} className={styles.item}>
                <div className={styles.itemHead}><strong>{r.shift_title ?? "Open shift"}</strong><span className={styles.muted}>{when(r.shift_start)}</span></div>
                <Action label="I can cover this" onRun={async () => { await api(`requests/${r.id}/volunteer`, {}); reload(); }} />
              </li>
            ))}
          </ul>
        ) : <p className={styles.muted}>No open shifts for your role right now.</p>}
      </section>
      {can(me, "management") ? (
        <section className={styles.card} aria-labelledby="queue">
          <h2 id="queue">Waiting for a decision</h2>
          {!data ? <Loading error={error} /> : data.queue.length ? (
            <ul className={styles.list}>
              {data.queue.map((r: any) => (
                <li key={r.id} className={styles.item}>
                  <div className={styles.itemHead}><strong>{r.requester_name}: {r.kind}</strong><span className={styles.muted}>{r.shift_title ?? ""} {when(r.shift_start)}</span></div>
                  <p>{r.details}{r.swap_with ? ` (with ${r.swap_with})` : ""}{r.volunteer_name ? ` — ${r.volunteer_name} offered to cover` : ""}</p>
                  <div className={styles.row}>
                    <Action label="Approve" onRun={async () => { await api(`requests/${r.id}/decide`, { status: "approved" }); reload(); }} />
                    <Action label="Decline" onRun={async () => { await api(`requests/${r.id}/decide`, { status: "declined" }); reload(); }} />
                  </div>
                </li>
              ))}
            </ul>
          ) : <p className={styles.muted}>All clear.</p>}
        </section>
      ) : null}
      <section className={styles.card} aria-labelledby="up">
        <h2 id="up">Upcoming at the club</h2>
        {sets === null ? <Loading /> : <ul className={styles.list}>{sets.slice(0, 12).map(row)}</ul>}
      </section>
    </div>
  );
}

const minutes = (a: number, b: number | null) => (b ? `${Math.round((b - a) / 60000)} min` : "in progress");

function LinkAvatar({ onLinked }: { onLinked: () => void }) {
  const [code, setCode] = useState("");
  return (
    <section className={styles.card}>
      <h2>Link your avatar</h2>
      <p>Your sets and shifts come from the Staff Board, so we need to know which avatar is yours.</p>
      <div className={styles.row}>
        <Action label="Get a link code" onRun={async () => setCode((await api("me/link-code", {})).code)} />
        <button type="button" className={styles.linkButton} onClick={onLinked}>I&apos;ve linked it: refresh</button>
      </div>
      {code ? <p className={styles.note}>Your code is <strong className={styles.code}>{code}</strong>. On the Staff Control Board choose <em>Link Account</em> and enter it. It works once and lasts 15 minutes.</p> : null}
    </section>
  );
}

export function MySets({ me }: { me: Me }) {
  const { data, error, reload } = useLoad("my-sets");
  if (!data) return <Loading error={error} />;
  if (!data.linked) return <LinkAvatar onLinked={reload} />;
  const groups: [string, any[]][] = [["DJ sets", data.sets], ["Host shifts", data.hosts], ["Management shifts", data.managers]];
  return (
    <div className={styles.stack}>
      <p className={styles.note}>Times come from the board logins recorded for {me.user.name}.</p>
      {groups.map(([title, rows]) => rows.length ? (
        <section key={title} className={styles.card}>
          <h2>{title}</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th>Started</th><th>Finished</th><th>Length</th></tr></thead>
              <tbody>{rows.map((r: any) => <tr key={r.id}><td>{when(r.started_at)}{r.trial ? " (trial)" : ""}</td><td>{r.ended_at ? when(r.ended_at) : "On now"}</td><td>{minutes(r.started_at, r.ended_at)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      ) : null)}
      {!data.sets.length && !data.hosts.length && !data.managers.length ? <p className={styles.muted}>No completed sets or shifts recorded yet.</p> : null}
    </div>
  );
}

export function TrialCenter({ me }: { me: Me }) {
  const { data, error, reload } = useLoad("trials");
  const { data: roster } = useLoad(can(me, "management") ? "roster" : "me");
  const [form, setForm] = useState({ kind: "dj", applicant: "", applicant_uuid: "", applicant_user_id: "", when: "", notes: "" });
  const [err, setErr] = useState("");
  if (!data) return <Loading error={error} />;
  if (!data.manage) {
    return data.trials.length ? (
      <ul className={styles.list}>
        {data.trials.map((t: any) => <li key={t.id} className={styles.item}><div className={styles.itemHead}><strong>{t.kind.toUpperCase()} trial</strong><Status value={t.status} /></div><p className={styles.muted}>{t.scheduled_at ? `Scheduled ${when(t.scheduled_at)}` : "Not scheduled yet"}</p></li>)}
      </ul>
    ) : <p className={styles.notice}>Trials are run by management. If you have one, its status shows here.</p>;
  }
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      await api("trials", { kind: form.kind, applicant: form.applicant, applicant_uuid: form.applicant_uuid, applicant_user_id: form.applicant_user_id || null, scheduled_at: form.when ? Date.parse(form.when) : null, notes: form.notes });
      setForm({ kind: "dj", applicant: "", applicant_uuid: "", applicant_user_id: "", when: "", notes: "" });
      reload();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "That didn't save.");
    }
  };
  const open = data.trials.filter((t: any) => ["requested", "scheduled"].includes(t.status));
  const past = data.trials.filter((t: any) => !["requested", "scheduled"].includes(t.status));
  const card = (t: any) => <TrialCard key={t.id} t={t} reload={reload} />;
  return (
    <div className={styles.stack}>
      <p className={styles.note}>Approving here records the decision. Who may approve a trial is still a question for Moose, so no rule is enforced.</p>
      <section className={styles.card}>
        <h2>Add an audition</h2>
        <form className={styles.form} onSubmit={add}>
          <div className={styles.grid2}>
            <label>Type<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="dj">DJ</option><option value="host">Host</option></select></label>
            <label>Applicant<input required value={form.applicant} onChange={(e) => setForm({ ...form, applicant: e.target.value })} /></label>
            <label>Avatar UUID (optional)<input value={form.applicant_uuid} onChange={(e) => setForm({ ...form, applicant_uuid: e.target.value })} /></label>
            <label>Trial date and time<input type="datetime-local" value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} /></label>
            <label>Their Backstage account, if they have one (lets them see the status)<select value={form.applicant_user_id} onChange={(e) => setForm({ ...form, applicant_user_id: e.target.value })}><option value="">None</option>{roster?.users?.map((u: any) => <option key={u.id} value={u.id}>{u.display_name}</option>)}</select></label>
          </div>
          <label>Notes<textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button className={styles.primary} type="submit">Add</button>
          {err ? <p className={styles.error} role="alert">{err}</p> : null}
        </form>
      </section>
      <section className={styles.card}><h2>Open trials</h2>{open.length ? <ul className={styles.list}>{open.map(card)}</ul> : <p className={styles.muted}>None right now.</p>}</section>
      <section className={styles.card}><h2>Previous decisions</h2>{past.length ? <ul className={styles.list}>{past.map(card)}</ul> : <p className={styles.muted}>None yet.</p>}</section>
    </div>
  );
}

function TrialCard({ t, reload }: { t: any; reload: () => void }) {
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const decided = !["requested", "scheduled"].includes(t.status);
  return (
    <li className={styles.item}>
      <div className={styles.itemHead}><strong>{t.applicant}: {t.kind.toUpperCase()}</strong><Status value={t.status} /></div>
      <p className={styles.muted}>{t.scheduled_at ? when(t.scheduled_at) : "Not scheduled"}{t.decided_by_name ? ` · decided by ${t.decided_by_name}, ${day(t.decided_at)}` : ""}</p>
      {t.notes ? <p>{t.notes}</p> : null}
      {t.feedback.map((f: any) => <p key={f.id} className={styles.quote}>{f.note} <span className={styles.muted}>— {f.author}, {day(f.at)}</span></p>)}
      <div className={styles.form}>
        <label>Add feedback<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
        <div className={styles.row}>
          <Action label="Save feedback" onRun={async () => { await api(`trials/${t.id}/feedback`, { note }); setNote(""); reload(); }} />
          {!decided ? (
            <>
              <input aria-label="Trial date and time" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
              <Action label="Schedule" onRun={async () => { await api(`trials/${t.id}`, { status: "scheduled", scheduled_at: Date.parse(date) }); reload(); }} />
              <Action label="Approve" confirm="Approve this trial?" onRun={async () => { await api(`trials/${t.id}`, { status: "approved" }); reload(); }} />
              <Action label="Decline" confirm="Decline this trial?" onRun={async () => { await api(`trials/${t.id}`, { status: "declined" }); reload(); }} />
            </>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function ReportIssue({ preset, onDone }: { preset?: { title?: string; category?: string; source?: string }; onDone?: () => void }) {
  const [title, setTitle] = useState(preset?.title ?? "");
  const [category, setCategory] = useState(preset?.category ?? "technical");
  const [description, setDescription] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    try {
      const r = await api("issues", { title, category, description, source: preset?.source });
      setMsg(`Reported as #${r.id}. You can follow it in Crew Help.`);
      setTitle("");
      setDescription("");
      onDone?.();
    } catch (x) {
      setErr(x instanceof Error ? x.message : "That didn't send.");
    }
  };
  return (
    <form className={styles.form} onSubmit={send}>
      <label>What&apos;s wrong?<input required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} /></label>
      <label>Type
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="technical">Technical</option><option value="scheduling">Scheduling</option><option value="staffing">Staffing</option><option value="policy">Policy question</option><option value="other">Something else</option>
        </select>
      </label>
      <label>Details<textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <button className={styles.primary} type="submit">Report it</button>
      {msg ? <p className={styles.ok} role="status">{msg}</p> : null}
      {err ? <p className={styles.error} role="alert">{err}</p> : null}
    </form>
  );
}

export function IssueRow({ i, manage, reload, staff }: { i: any; manage: boolean; reload: () => void; staff?: any[] }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [note, setNote] = useState("");
  const [next, setNext] = useState(i.next_action ?? "");
  const show = async () => {
    setOpen(!open);
    if (!open) setDetail(await api(`issues/${i.id}`));
  };
  const refresh = async () => {
    setDetail(await api(`issues/${i.id}`));
    reload();
  };
  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <button type="button" className={styles.linkButton} aria-expanded={open} onClick={show}>#{i.id} {i.title}</button>
        <span className={styles.row}><Status value={i.priority} /><Status value={i.status} />{i.needs_moose ? <Status value="needs_moose" /> : null}</span>
      </div>
      <p className={styles.muted}>Reported {day(i.created_at)}{i.reporter_name ? ` by ${i.reporter_name}` : ""} · {i.assignee_name ? `${i.assignee_name} is handling it` : "Not assigned yet"}{i.next_action ? ` · Next: ${i.next_action}` : ""}</p>
      {open && detail ? (
        <div className={styles.form}>
          {detail.issue.description ? <p>{detail.issue.description}</p> : null}
          <ol className={styles.timeline}>{detail.log.map((l: any) => <li key={l.id}><span className={styles.muted}>{when(l.at)}{l.actor ? ` · ${l.actor}` : ""}:</span> {l.action}{l.note ? ` — ${l.note}` : ""}</li>)}</ol>
          <label>Add a note<textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <Action label="Add note" onRun={async () => { await api(`issues/${i.id}/note`, { note }); setNote(""); await refresh(); }} />
          {manage ? (
            <div className={styles.grid2}>
              <label>Status<select value={i.status} onChange={async (e) => { await api(`issues/${i.id}`, { status: e.target.value }); await refresh(); }}><option value="open">Open</option><option value="in_progress">In progress</option><option value="waiting">Waiting</option><option value="resolved">Resolved</option></select></label>
              <label>Priority<select value={i.priority} onChange={async (e) => { await api(`issues/${i.id}`, { priority: e.target.value }); await refresh(); }}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
              {staff ? <label>Assigned to<select value={i.assignee_id ?? ""} onChange={async (e) => { await api(`issues/${i.id}`, { assignee_id: e.target.value || null }); await refresh(); }}><option value="">Nobody yet</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.display_name}</option>)}</select></label> : null}
              <label>Next action<input value={next} onChange={(e) => setNext(e.target.value)} onBlur={async () => { if (next !== (i.next_action ?? "")) { await api(`issues/${i.id}`, { next_action: next }); await refresh(); } }} /></label>
              <label className={styles.check}><input type="checkbox" checked={!!i.needs_moose} onChange={async (e) => { await api(`issues/${i.id}`, { needs_moose: e.target.checked }); await refresh(); }} /> Moose needs to decide</label>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function CrewHelp({ me }: { me: Me }) {
  const { data, error, reload } = useLoad("issues");
  const { data: roster } = useLoad(can(me, "management") ? "roster" : "me");
  return (
    <div className={styles.stack}>
      <section className={styles.card}><h2>Report a problem or ask for help</h2><ReportIssue onDone={reload} /></section>
      <section className={styles.card}>
        <h2>{data?.manage ? "All issues" : "My issues"}</h2>
        {!data ? <Loading error={error} /> : data.issues.length ? <ul className={styles.list}>{data.issues.map((i: any) => <IssueRow key={i.id} i={i} manage={data.manage} reload={reload} staff={roster?.users} />)}</ul> : <p className={styles.muted}>Nothing reported.</p>}
      </section>
    </div>
  );
}

export function Announcements({ me }: { me: Me }) {
  const { data, error, reload } = useLoad("announcements");
  const [f, setF] = useState({ title: "", body: "", when: "", dj: true, host: true, management: true });
  const clear = () => setF({ title: "", body: "", when: "", dj: true, host: true, management: true });
  const save = (publish: boolean) => async () => {
    const audience = (["dj", "host", "management"] as const).filter((r) => f[r]);
    await api("announcements", { title: f.title, body: f.body, audience, publish, event_at: f.when ? Date.parse(f.when) : null });
    clear();
    reload();
  };
  if (!data) return <Loading error={error} />;
  return (
    <div className={styles.stack}>
      {can(me, "management") ? (
        <section className={styles.card}>
          <h2>New announcement</h2>
          <div className={styles.form}>
            <label>Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
            <label>Message<textarea rows={3} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
            <label>Event date (optional)<input type="datetime-local" value={f.when} onChange={(e) => setF({ ...f, when: e.target.value })} /></label>
            <fieldset className={styles.row}><legend>Who sees it</legend>{(["dj", "host", "management"] as const).map((r) => <label key={r} className={styles.check}><input type="checkbox" checked={f[r]} onChange={(e) => setF({ ...f, [r]: e.target.checked })} /> {r}</label>)}</fieldset>
            <div className={styles.row}><Action label="Save draft" onRun={save(false)} /><Action label="Publish" confirm="Publish to staff now?" onRun={save(true)} /></div>
          </div>
        </section>
      ) : null}
      {data.drafts.length ? <section className={styles.card}><h2>Drafts</h2><ul className={styles.list}>{data.drafts.map((a: any) => <li key={a.id} className={styles.item}><strong>{a.title}</strong><p>{a.body}</p><div className={styles.row}><Action label="Publish" onRun={async () => { await api(`announcements/${a.id}`, { title: a.title, body: a.body, audience: JSON.parse(a.audience), event_at: a.event_at, publish: true }); reload(); }} /><Action label="Discard" onRun={async () => { await api(`announcements/${a.id}/archive`, {}); reload(); }} /></div></li>)}</ul></section> : null}
      <section className={styles.card}>
        <h2>Current notices</h2>
        {data.published.length ? <ul className={styles.list}>{data.published.map((a: any) => (
          <li key={a.id} className={styles.item}>
            <div className={styles.itemHead}><strong>{a.title}</strong><span className={styles.muted}>{day(a.published_at)}</span></div>
            <p>{a.body}</p>
            {a.event_at ? <p className={styles.muted}>When: {when(a.event_at)}</p> : null}
            {data.manage ? <Action label="Archive" onRun={async () => { await api(`announcements/${a.id}/archive`, {}); reload(); }} /> : null}
          </li>
        ))}</ul> : <p className={styles.muted}>No notices right now.</p>}
      </section>
    </div>
  );
}

const AWARD: Record<string, string> = { dj_month: "DJ of the Month", host_month: "Host of the Month", shoutout: "Shoutout" };

export function Recognition({ me }: { me: Me }) {
  const { data, error, reload } = useLoad("recognition");
  const [s, setS] = useState({ subject: "", citation: "" });
  const [a, setA] = useState({ kind: "dj_month", subject: "", period: "", citation: "" });
  const [sent, setSent] = useState(false);
  if (!data) return <Loading error={error} />;
  const awards = data.approved.filter((r: any) => r.kind !== "shoutout");
  const shouts = data.approved.filter((r: any) => r.kind === "shoutout");
  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <h2>DJ &amp; Host of the Month</h2>
        {awards.length ? <ul className={styles.list}>{awards.map((r: any) => <li key={r.id} className={styles.item}><div className={styles.itemHead}><strong>{AWARD[r.kind]}: {r.subject}</strong><span className={styles.muted}>{r.period}</span></div>{r.citation ? <p>{r.citation}</p> : null}</li>)}</ul> : <p className={styles.muted}>To be announced.</p>}
      </section>
      <section className={styles.card}>
        <h2>Shoutouts</h2>
        {shouts.length ? <ul className={styles.list}>{shouts.map((r: any) => <li key={r.id} className={styles.item}><strong>{r.subject}</strong><p>{r.citation}</p></li>)}</ul> : <p className={styles.muted}>None yet: be the first.</p>}
      </section>
      <section className={styles.card}>
        <h2>Give someone a shoutout</h2>
        <div className={styles.form}>
          <label>Who is it for?<input value={s.subject} onChange={(e) => setS({ ...s, subject: e.target.value })} /></label>
          <label>What did they do?<textarea rows={2} value={s.citation} onChange={(e) => setS({ ...s, citation: e.target.value })} /></label>
          <Action label="Send for approval" onRun={async () => { await api("recognition/shoutout", s); setS({ subject: "", citation: "" }); setSent(true); }} />
          {sent ? <p className={styles.ok} role="status">Thanks! It appears here once management approves it.</p> : null}
        </div>
      </section>
      {can(me, "management") ? (
        <>
          <section className={styles.card}>
            <h2>Waiting for approval</h2>
            {data.pending.length ? <ul className={styles.list}>{data.pending.map((r: any) => <li key={r.id} className={styles.item}><strong>{r.subject}</strong><p>{r.citation}</p><p className={styles.muted}>from {r.submitter ?? "the Vote Board"}</p><div className={styles.row}><Action label="Approve" onRun={async () => { await api(`recognition/${r.id}/decide`, { status: "approved" }); reload(); }} /><Action label="Decline" onRun={async () => { await api(`recognition/${r.id}/decide`, { status: "declined" }); reload(); }} /></div></li>)}</ul> : <p className={styles.muted}>All clear.</p>}
          </section>
          <section className={styles.card}>
            <h2>Record an award</h2>
            <div className={styles.form}>
              <div className={styles.grid2}>
                <label>Award<select value={a.kind} onChange={(e) => setA({ ...a, kind: e.target.value })}><option value="dj_month">DJ of the Month</option><option value="host_month">Host of the Month</option></select></label>
                <label>Month<input type="month" value={a.period} onChange={(e) => setA({ ...a, period: e.target.value })} /></label>
                <label>Who<input value={a.subject} onChange={(e) => setA({ ...a, subject: e.target.value })} /></label>
                <label>Why (optional)<input value={a.citation} onChange={(e) => setA({ ...a, citation: e.target.value })} /></label>
              </div>
              <Action label="Save award" onRun={async () => { await api("recognition/award", a); setA({ kind: "dj_month", subject: "", period: "", citation: "" }); reload(); }} />
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
