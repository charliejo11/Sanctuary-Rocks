"use client";

import { useState } from "react";
import { api, day, when, type Me } from "./api";
import PolicyEditor from "./PolicyEditor";
import { Action, IssueRow, Loading, Status, useLoad } from "./sections";
import styles from "./staff.module.css";

/* eslint-disable @typescript-eslint/no-explicit-any */

function Overview({ goTo, canEdit }: { goTo: (t: string) => void; canEdit: boolean }) {
  const { data: o, error, reload } = useLoad("overview");
  const { data: roster } = useLoad("roster");
  if (!o) return <Loading error={error} />;
  const issueGroup = (title: string, rows: any[]) => (
    <section className={styles.card}>
      <h3>{title} ({rows.length})</h3>
      {rows.length ? <ul className={styles.list}>{rows.map((i) => <IssueRow key={i.id} i={i} manage reload={reload} staff={roster?.users} />)}</ul> : <p className={styles.muted}>Nothing open.</p>}
    </section>
  );
  const s = o.system;
  return (
    <div className={styles.stack}>
      <p className={styles.note}><strong>What&apos;s happening at SR, and what needs my attention?</strong></p>
      <div className={styles.tiles}>
        <div className={styles.tile}><h3>On stage now</h3><p>🎧 {o.stage.dj ? <>{o.stage.dj.name}{o.stage.dj.trial ? " (trial)" : ""}</> : "No DJ logged in"}</p><p>🎤 {o.stage.hosts.map((h: any) => h.name).join(", ") || "No host logged in"}</p><p>🛡 {o.stage.managers.map((m: any) => m.name).join(", ") || "No manager on duty"}</p>{o.stage.song ? <p className={styles.muted}>Playing: {o.stage.song.artist} – {o.stage.song.title}</p> : null}</div>
        <div className={styles.tile}><h3>Uncovered shifts</h3><p className={styles.big}>{o.uncovered.length}</p><p className={styles.muted}>{o.pending_requests} request(s) awaiting a decision</p>{o.uncovered.slice(0, 3).map((r: any) => <p key={r.id} className={styles.muted}>{r.shift_title ?? "Shift"}: {when(r.shift_start)}</p>)}</div>
        <div className={styles.tile}><h3>Trials waiting</h3><p className={styles.big}>{o.trials_pending.length}</p>{o.trials_pending.slice(0, 3).map((t: any) => <p key={t.id} className={styles.muted}>{t.applicant} ({t.kind}) · {t.scheduled_at ? when(t.scheduled_at) : "not scheduled"}</p>)}</div>
        <div className={styles.tile}><h3>Sanctuary Rocks donations</h3><p className={styles.big}>L${o.donations.sr.total.toLocaleString()}</p><p className={styles.muted}>{o.donations.sr.n} confirmed in {o.donations.month}</p></div>
        <div className={styles.tile}><h3>Maphra donations</h3><p className={styles.big}>L${o.donations.maphra.total.toLocaleString()}</p><p className={styles.muted}>{o.donations.maphra.n} confirmed in {o.donations.month}</p></div>
        <div className={styles.tile}><h3>Staff activity (7 days)</h3><p>{o.activity.dj_sets_7d} DJ sets · {o.activity.host_shifts_7d} host shifts · {o.activity.manager_shifts_7d} manager shifts</p><p className={styles.muted}>{o.activity.portal_logins_7d} staff signed in here</p></div>
        <div className={styles.tile}><h3>Voting &amp; recognition</h3><p>{o.voting.periods.length ? o.voting.periods.map((p: any) => `${p.label}: ${p.n} votes`).join(" · ") : "No vote open"}</p><p className={styles.muted}>{o.voting.shoutouts_pending} shoutout(s) to approve</p></div>
        <div className={styles.tile}><h3>Policy decisions</h3><p className={styles.big}>{o.policy.open_questions}</p><p className={styles.muted}>open questions · {o.policy.needs_review} sections to review · {o.policy.published} published</p>{canEdit ? <button type="button" className={styles.small} onClick={() => goTo("policy")}>Open Policy Editor</button> : null}</div>
        <div className={styles.tile}>
          <h3>System status</h3>
          <p>Stream: <Status value={s.stream ?? "unknown"} />{s.stream_down_since ? <span className={styles.muted}> since {when(+s.stream_down_since)}</span> : null}</p>
          <p className={styles.muted}>Last stream check {when(s.last_poll)}</p>
          <p>Staff Board: {s.board_last_seen ? `last report ${when(s.board_last_seen)}` : "not connected yet"}</p>
          <p>Music receiver: {s.receiver ?? "not connected yet"}</p>
          <p>Discord: <Status value={s.discord_mode} /> · sign-in {s.discord_login ? "on" : "not set up"}</p>
          <p>Sheets sync: {s.sheets} · Chat relay: {s.relay_enabled ? "enabled" : "disabled"}</p>
        </div>
      </div>
      <h2>Unresolved issues{o.issues.needs_moose ? ` (${o.issues.needs_moose} need Moose)` : ""}</h2>
      {issueGroup("Technical", o.issues.technical)}
      {issueGroup("Staffing & scheduling", o.issues.staffing)}
      {issueGroup("Policy decisions", o.issues.policy)}
    </div>
  );
}

const ROLE_LIST = ["dj", "host", "management", "owner"];

function CalendarName({ u, reload }: { u: any; reload: () => void }) {
  const [name, setName] = useState(u.calendar_name ?? "");
  return (
    <div className={styles.row}>
      <label className={styles.inlineLabel}>Calendar name<input value={name} placeholder={u.display_name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
      <Action label="Save" onRun={async () => { await api(`roster/${u.id}/calendar-name`, { calendar_name: name }); reload(); }} />
    </div>
  );
}

function RosterRow({ u, reload, canEdit }: { u: any; reload: () => void; canEdit: boolean }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ display_name: u.display_name, sl_uuid: u.sl_uuid ?? "", roles: u.roles as string[], active: !!u.active });
  const [code, setCode] = useState("");
  return (
    <li className={styles.item}>
      <div className={styles.itemHead}>
        <strong>{u.display_name}</strong>
        <span className={styles.row}>{u.roles.map((r: string) => <Status key={r} value={r} />)}{u.active ? null : <Status value="inactive" />}</span>
      </div>
      <p className={styles.muted}>{u.discord_name ? `Discord: ${u.discord_name}` : "No Discord linked"} · {u.sl_uuid ? "Avatar linked" : "No avatar linked"} · Last sign-in {day(u.last_login_at)}</p>
      {canEdit ? (
        <div className={styles.row}>
          <button type="button" className={styles.small} onClick={() => setEdit(!edit)} aria-expanded={edit}>Edit</button>
          <Action label="Make a recovery code" confirm={`Create a one-time sign-in code for ${u.display_name}?`} onRun={async () => setCode((await api(`roster/${u.id}/recovery`, {})).code)} />
        </div>
      ) : null}
      <CalendarName u={u} reload={reload} />
      {code ? <p className={styles.note}>One-time code, valid 24 hours. It won&apos;t be shown again. Send it privately: <strong className={styles.code}>{code}</strong></p> : null}
      {edit ? (
        <div className={styles.form}>
          <label>Name<input value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} /></label>
          <label>Avatar UUID<input value={f.sl_uuid} onChange={(e) => setF({ ...f, sl_uuid: e.target.value })} /></label>
          <fieldset className={styles.row}><legend>Roles</legend>{ROLE_LIST.map((r) => <label key={r} className={styles.check}><input type="checkbox" checked={f.roles.includes(r)} onChange={(e) => setF({ ...f, roles: e.target.checked ? [...f.roles, r] : f.roles.filter((x) => x !== r) })} /> {r}</label>)}</fieldset>
          <label className={styles.check}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>
          <Action label="Save" onRun={async () => { await api(`roster/${u.id}`, f); setEdit(false); reload(); }} />
        </div>
      ) : null}
    </li>
  );
}

function DiscordMembers() {
  const { data, error } = useLoad("roster/discord");
  if (!data) return <section className={styles.card}><h3>Staff on Discord</h3><Loading error={error} /></section>;
  return (
    <section className={styles.card}>
      <h3>Staff on Discord ({data.members.length})</h3>
      <p className={styles.muted}>Read live from the Sanctuary Staff server. {data.no_access} other member{data.no_access === 1 ? " has" : "s have"} no tag that opens Backstage Pass. To change someone&apos;s access, change their tag in Discord.</p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Name</th><th>Discord tags</th><th>Backstage access</th><th>Last sign-in</th></tr></thead>
          <tbody>
            {data.members.map((m: any) => (
              <tr key={m.username}>
                <td>{m.name}<br /><span className={styles.muted}>{m.username}</span></td>
                <td>{m.tags.join(", ")}</td>
                <td><span className={styles.row}>{m.access.map((r: string) => <Status key={r} value={r} />)}</span></td>
                <td>{m.last_login_at ? day(m.last_login_at) : "Not yet"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Roster() {
  const { data, error, reload } = useLoad("roster");
  const [n, setN] = useState({ display_name: "", sl_uuid: "", roles: [] as string[] });
  if (!data) return <Loading error={error} />;
  return (
    <div className={styles.stack}>
      <p className={styles.note}>People with a staff role on Discord appear here after they first sign in; their roles are re-read from Discord every time. You can also add someone by hand.</p>
      {data.can_edit ? (
        <section className={styles.card}>
          <h3>Add staff by hand</h3>
          <div className={styles.form}>
            <div className={styles.grid2}>
              <label>Name<input value={n.display_name} onChange={(e) => setN({ ...n, display_name: e.target.value })} /></label>
              <label>Avatar UUID (optional)<input value={n.sl_uuid} onChange={(e) => setN({ ...n, sl_uuid: e.target.value })} /></label>
            </div>
            <fieldset className={styles.row}><legend>Roles</legend>{ROLE_LIST.map((r) => <label key={r} className={styles.check}><input type="checkbox" checked={n.roles.includes(r)} onChange={(e) => setN({ ...n, roles: e.target.checked ? [...n.roles, r] : n.roles.filter((x) => x !== r) })} /> {r}</label>)}</fieldset>
            <Action label="Add" onRun={async () => { await api("roster", n); setN({ display_name: "", sl_uuid: "", roles: [] }); reload(); }} />
          </div>
        </section>
      ) : null}
      <DiscordMembers />
      <h3>Signed-in and hand-added staff</h3>
      <ul className={styles.list}>{data.users.map((u: any) => <RosterRow key={u.id} u={u} reload={reload} canEdit={data.can_edit} />)}</ul>
    </div>
  );
}

function Donations({ canEdit }: { canEdit: boolean }) {
  const [month, setMonth] = useState("");
  const { data, error, reload } = useLoad(`donations${month ? `?month=${month}` : ""}`);
  const [f, setF] = useState({ fund: "sr", amount_l: "", reference: "", payer: "", note: "" });
  if (!data) return <Loading error={error} />;
  const total = (fund: string) => data.rows.filter((r: any) => r.fund === fund).reduce((a: number, r: any) => a + r.amount_l, 0);
  return (
    <div className={styles.stack}>
      <p className={styles.note}>Only payments confirmed by a donation object&apos;s in-world payment event count, or a manual entry with a transaction reference. Button clicks never count. Personal tips go straight to the person and aren&apos;t recorded.</p>
      <label className={styles.inlineLabel}>Month <input type="month" value={data.month} onChange={(e) => setMonth(e.target.value)} /></label>
      <div className={styles.tiles}>
        <div className={styles.tile}><h3>Sanctuary Rocks</h3><p className={styles.big}>L${total("sr").toLocaleString()}</p></div>
        <div className={styles.tile}><h3>Maphra</h3><p className={styles.big}>L${total("maphra").toLocaleString()}</p></div>
      </div>
      <section className={styles.card}>
        <h3>Transactions</h3>
        {data.rows.length ? <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>When</th><th>Fund</th><th>Amount</th><th>From</th><th>Source</th><th>Reference</th></tr></thead><tbody>{data.rows.map((r: any) => <tr key={r.id}><td>{when(r.at)}</td><td>{r.fund === "sr" ? "SR" : "Maphra"}</td><td>L${r.amount_l}</td><td>{r.payer_name ?? r.payer_uuid ?? "—"}</td><td>{r.source === "manual" ? "Manual entry" : r.object ?? "In-world"}</td><td className={styles.small2}>{r.tx_id}</td></tr>)}</tbody></table></div> : <p className={styles.muted}>No confirmed donations this month.</p>}
      </section>
      {canEdit ? (
        <section className={styles.card}>
          <h3>Add from the SL account history (reconciliation)</h3>
          <div className={styles.form}>
            <div className={styles.grid2}>
              <label>Fund<select value={f.fund} onChange={(e) => setF({ ...f, fund: e.target.value })}><option value="sr">Sanctuary Rocks</option><option value="maphra">Maphra</option></select></label>
              <label>Amount (L$)<input inputMode="numeric" value={f.amount_l} onChange={(e) => setF({ ...f, amount_l: e.target.value })} /></label>
              <label>Transaction reference<input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
              <label>From<input value={f.payer} onChange={(e) => setF({ ...f, payer: e.target.value })} /></label>
            </div>
            <Action label="Record" onRun={async () => { await api("donations", f); setF({ fund: "sr", amount_l: "", reference: "", payer: "", note: "" }); reload(); }} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Votes() {
  const { data, error, reload } = useLoad("votes");
  const [f, setF] = useState({ kind: "dj", label: "", opens: "", closes: "" });
  if (!data) return <Loading error={error} />;
  return (
    <div className={styles.stack}>
      <section className={styles.card}>
        <h3>Open a vote on the Vote Board</h3>
        <div className={styles.form}>
          <div className={styles.grid2}>
            <label>For<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="dj">DJs</option><option value="host">Hosts</option></select></label>
            <label>Name<input value={f.label} placeholder="November 2026" onChange={(e) => setF({ ...f, label: e.target.value })} /></label>
            <label>Opens<input type="datetime-local" value={f.opens} onChange={(e) => setF({ ...f, opens: e.target.value })} /></label>
            <label>Closes<input type="datetime-local" value={f.closes} onChange={(e) => setF({ ...f, closes: e.target.value })} /></label>
          </div>
          <Action label="Create vote" onRun={async () => { await api("votes", { kind: f.kind, label: f.label, opens_at: Date.parse(f.opens), closes_at: Date.parse(f.closes) }); reload(); }} />
        </div>
      </section>
      {data.periods.map((p: any) => (
        <section key={p.id} className={styles.card}>
          <h3>{p.label} ({p.kind === "dj" ? "DJs" : "Hosts"})</h3>
          <p className={styles.muted}>{when(p.opens_at)} to {when(p.closes_at)}</p>
          {p.tally.length ? <ul className={styles.list}>{p.tally.map((t: any) => <li key={t.candidate_uuid} className={styles.itemHead}><span>{t.candidate_name}</span><strong>{t.n}</strong></li>)}</ul> : <p className={styles.muted}>No votes yet.</p>}
        </section>
      ))}
    </div>
  );
}

function DiscordSettings() {
  const { data, error, reload } = useLoad("discord");
  const { data: st, reload: reloadSettings } = useLoad("settings");
  const [report, setReport] = useState("");
  if (!data) return <Loading error={error} />;
  return (
    <div className={styles.stack}>
      <p className={styles.note}>Mode: <Status value={data.mode} />. While it says dry-run, nothing is sent to any Discord server. Tokens and webhook addresses are stored as protected server secrets, never here.</p>
      <section className={styles.card}>
        <h3>Preview</h3>
        <div className={styles.discordPreview}>
          <strong>{data.preview.embeds[0].title}</strong>
          <p className={styles.preWrap}>{data.preview.embeds[0].description.replace(/\*\*/g, "")}</p>
        </div>
        <div className={styles.row}>
          <Action label="Check now" onRun={async () => { setReport(JSON.stringify((await api("discord/sync", {})).report)); reload(); }} />
          {report ? <span className={styles.muted}>{report}</span> : null}
        </div>
      </section>
      <SettingField label="Current event or set name" k="stage_event" value={st?.settings?.stage_event ?? ""} onSaved={() => { reloadSettings(); reload(); }} />
      <SettingField label="Venue link" k="stage_link" value={st?.settings?.stage_link ?? ""} onSaved={() => { reloadSettings(); reload(); }} />
      {data.dests.map((d: any) => <Dest key={d.name} d={d} reload={reload} secrets={data.secrets} />)}
      <section className={styles.card}>
        <h3>Public chat relay</h3>
        <p>Marked {st?.settings?.relay_enabled === "0" ? "off" : "on"} here. The in-world relay doesn&apos;t read this setting yet, so to stop it right now use its own menu at the club.</p>
        <Action label={st?.settings?.relay_enabled === "0" ? "Mark as on" : "Mark as off"} onRun={async () => { await api("settings", { key: "relay_enabled", value: st?.settings?.relay_enabled === "0" ? "1" : "0" }); reloadSettings(); }} />
      </section>
    </div>
  );
}

function SettingField({ label, k, value, onSaved }: { label: string; k: string; value: string; onSaved: () => void }) {
  const [v, setV] = useState<string | null>(null);
  return (
    <section className={styles.card}>
      <div className={styles.form}>
        <label>{label}<input value={v ?? value} onChange={(e) => setV(e.target.value)} /></label>
        <Action label="Save" onRun={async () => { await api("settings", { key: k, value: v ?? value }); setV(null); onSaved(); }} />
      </div>
    </section>
  );
}

function Dest({ d, reload, secrets }: { d: any; reload: () => void; secrets: any }) {
  const [f, setF] = useState({ guild_id: d.guild_id ?? "", channel_id: d.channel_id ?? "", transport: d.transport });
  const ready = f.transport === "bot" ? secrets.bot : f.transport === "webhook" ? (d.name === "vip" ? secrets.vip_webhook : secrets.staff_webhook) : true;
  return (
    <section className={styles.card}>
      <h3>{d.name === "vip" ? "VIP Discord" : "Staff Discord"}</h3>
      <div className={styles.form}>
        <div className={styles.grid2}>
          <label>Server ID<input value={f.guild_id} onChange={(e) => setF({ ...f, guild_id: e.target.value })} /></label>
          <label>Status channel ID<input value={f.channel_id} onChange={(e) => setF({ ...f, channel_id: e.target.value })} /></label>
          <label>Send with<select value={f.transport} onChange={(e) => setF({ ...f, transport: e.target.value })}><option value="off">Off</option><option value="bot">Bot</option><option value="webhook">Webhook</option></select></label>
        </div>
        {!ready ? <p className={styles.error}>The secret for this option hasn&apos;t been set yet.</p> : null}
        <p className={styles.muted}>{d.message_id ? `Status message ${d.message_id}` : "No status message yet"}{d.last_ok_at ? ` · last updated ${when(d.last_ok_at)}` : ""}</p>
        {d.last_error ? <p className={styles.error}>Last error: {d.last_error}</p> : null}
        <Action label="Save" onRun={async () => { await api(`discord/${d.name}`, f); reload(); }} />
      </div>
    </section>
  );
}

function BoardControls() {
  return (
    <section className={styles.card}>
      <h3>Board override</h3>
      <p>Blanks a stuck slot in the record and Discord status. It never changes the music. The Staff Board&apos;s own panel still needs Clear Role in-world.</p>
      <div className={styles.row}>
        <Action label="DJ Log Out" confirm="Log the DJ out? The music keeps playing." onRun={() => api("board/clear", { role: "DJ" })} />
        <Action label="Clear Host" confirm="Clear the Host?" onRun={() => api("board/clear", { role: "HOST" })} />
        <Action label="Clear Manager" confirm="Clear the Manager?" onRun={() => api("board/clear", { role: "MANAGER" })} />
      </div>
    </section>
  );
}

function AuditLog() {
  const { data, error } = useLoad("audit");
  if (!data) return <Loading error={error} />;
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>{data.rows.map((r: any) => <tr key={r.id}><td>{when(r.at)}</td><td>{r.actor}</td><td>{r.action}</td></tr>)}</tbody></table></div>;
}

export default function Management({ me }: { me: Me }) {
  const owner = me.user.roles.includes("owner");
  const tabs: [string, string][] = [["overview", owner ? "Moose's Overview" : "Overview"], ["roster", "Staff Roster"], ["donations", "Donation Reports"], ["votes", "Voting"], ["board", "Board"],
    ...(owner ? ([["policy", "Policy Editor"], ["discord", "Discord & System"], ["audit", "Audit Log"]] as [string, string][]) : [])];
  // "#management:policy:<id>" is the Edit link in the book
  const [target] = useState(() => { const m = window.location.hash.match(/^#management:policy:(\d+)$/); return m ? +m[1] : null; });
  const [tab, setTab] = useState(target && owner ? "policy" : "overview");
  return (
    <div className={styles.stack}>
      <nav className={styles.tabs} aria-label="Management sections">
        {tabs.map(([id, label]) => <button key={id} type="button" className={tab === id ? styles.tabOn : styles.tab} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>{label}</button>)}
      </nav>
      {tab === "overview" ? <Overview goTo={setTab} canEdit={owner} /> : null}
      {tab === "roster" ? <Roster /> : null}
      {tab === "donations" ? <Donations canEdit={owner} /> : null}
      {tab === "votes" ? <Votes /> : null}
      {tab === "board" ? <BoardControls /> : null}
      {tab === "policy" && owner ? <PolicyEditor initial={target} /> : null}
      {tab === "discord" && owner ? <DiscordSettings /> : null}
      {tab === "audit" && owner ? <AuditLog /> : null}
    </div>
  );
}
