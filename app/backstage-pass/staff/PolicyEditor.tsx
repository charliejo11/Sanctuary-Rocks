"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, day, when } from "./api";
import { Action, Loading, Status, useLoad } from "./sections";
import roadie from "./roadie.module.css";
import styles from "./staff.module.css";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CHAPTERS = ["", "Welcome to the Crew", "The Crew Code", "The Setlist", "Know Your Gig", "When Things Go Sideways", "Keeping the Rock Alive"];
const STATUS_LABEL: Record<string, string> = { draft: "Draft", needs_review: "Needs Review", published: "Published", archived: "Archived" };
const ROLES = ["dj", "host", "management"];

function Editor({ id, onClose }: { id: number; onClose: () => void }) {
  const [p, setP] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [save, setSave] = useState("Saved");
  const [preview, setPreview] = useState(false);
  const [viewing, setViewing] = useState<any>(null);
  const [notify, setNotify] = useState(true);
  const [draft, setDraft] = useState("");
  const area = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stamp = useRef<number>(0);
  const html = useRef("");
  const queue = useRef<Promise<boolean>>(Promise.resolve(true));

  const load = useCallback(async () => {
    const d = await api(`policies/${id}`);
    setP(d.policy);
    setVersions(d.versions);
    stamp.current = d.policy.updated_at;
    html.current = d.policy.draft_html;
    setDraft(d.policy.draft_html);
  }, [id]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a fetch, set when it answers
    load();
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [load]);
  // the text is only pushed into the editable area when it isn't being typed in, so the caret never jumps
  useEffect(() => {
    if (area.current && !preview && !viewing) area.current.innerHTML = html.current;
  }, [p?.id, preview, viewing]);

  // One save at a time, each with the stamp the last one returned. Clicking a setting right after typing fires two saves at
  // once, and without this the second looks like someone else's edit.
  const push = useCallback((extra: object = {}): Promise<boolean> => {
    const run = queue.current.then(async () => {
      setSave("Saving…");
      const sent = html.current;
      try {
        const r = await api(`policies/${id}/draft`, { html: sent, expected_updated_at: stamp.current, ...extra });
        stamp.current = r.updated_at;
        // anything typed while this was on its way stays, and goes in the next save
        if (html.current === sent) html.current = r.html;
        setDraft(r.html);
        setSave(`Saved ${when(r.updated_at)}`);
        return true;
      } catch (e) {
        setSave(e instanceof Error ? e.message : "Couldn't save");
        return false;
      }
    });
    queue.current = run;
    return run;
  }, [id]);

  const typed = () => {
    if (!area.current) return;
    html.current = area.current.innerHTML;
    setSave("Unsaved changes");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => push(), 1500);
  };
  const command = (cmd: string, value?: string) => {
    area.current?.focus();
    document.execCommand(cmd, false, value);
    typed();
  };
  const flush = async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    return push();
  };
  const field = async (patch: object) => {
    setP({ ...p, ...patch });
    await push(patch);
  };
  const close = async () => {
    await flush();
    onClose();
  };

  if (!p) return <Loading />;
  const changedSincePublish = p.published_html != null && p.published_html !== draft;
  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <button type="button" className={styles.back} onClick={close}>◀ All policies</button>
        {p.published_at ? <a className={styles.linkButton} href={`#manual:${p.chapter === 2 ? "ch2" : `p-${p.slug}`}`}>See it in the book</a> : null}
      </div>
      <div className={styles.note}>
        <Status value={p.status} /> {p.published_at ? <>Published {day(p.published_at)}, version {p.version}. {changedSincePublish ? <strong>This draft has changes staff can&apos;t see yet.</strong> : null}</> : <strong>Staff can&apos;t see this: it has never been published.</strong>}
        <span className={styles.saveState} role="status"> · {save}</span>
      </div>
      <label>Title<input className={styles.wide} value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} onBlur={(e) => field({ title: e.target.value })} /></label>
      <div className={styles.row}>
        <label className={styles.inlineLabel}>Status
          <select value={p.status === "published" ? "" : p.status} onChange={async (e) => { await flush(); await api(`policies/${id}/status`, { status: e.target.value }); load(); }}>
            {p.status === "published" ? <option value="">Published</option> : null}
            <option value="draft">Draft</option><option value="needs_review">Needs Review</option><option value="archived">Archived</option>
          </select>
        </label>
        <fieldset className={styles.row}><legend>Who can read it</legend>
          {ROLES.map((r) => <label key={r} className={styles.check}><input type="checkbox" checked={p.visible_roles.includes(r)} onChange={(e) => field({ visible_roles: e.target.checked ? [...p.visible_roles, r] : p.visible_roles.filter((x: string) => x !== r) })} /> {r}</label>)}
        </fieldset>
        <label className={styles.check}><input type="checkbox" checked={!!p.ack_required} onChange={(e) => field({ ack_required: e.target.checked })} /> Staff must acknowledge</label>
      </div>
      <div className={styles.row} role="toolbar" aria-label="Formatting">
        <button type="button" className={styles.small} disabled={preview} onClick={() => command("bold")}><b>B</b></button>
        <button type="button" className={styles.small} disabled={preview} onClick={() => command("italic")}><i>I</i></button>
        <button type="button" className={styles.small} disabled={preview} onClick={() => command("formatBlock", "h3")}>Heading</button>
        <button type="button" className={styles.small} disabled={preview} onClick={() => command("formatBlock", "p")}>Paragraph</button>
        <button type="button" className={styles.small} disabled={preview} onClick={() => command("insertText", "✦ ")}>✦ List mark</button>
        <button type="button" className={styles.small} onClick={async () => { await flush(); setPreview(!preview); }}>{preview ? "Back to editing" : "Preview as staff"}</button>
        <Action label="Save version" onRun={async () => { if (timer.current) clearTimeout(timer.current); await push({ keep_version: true }); await load(); }} />
      </div>
      <div className={roadie.root}>
        <div className={roadie.editorPage}>
          <section className="sheet">
            <h2>{p.title}</h2>
            {preview ? (
              <div className="bookText" dangerouslySetInnerHTML={{ __html: draft }} />
            ) : (
              <div ref={area} className="editable bookText" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label="Policy text" onInput={typed} onBlur={() => { if (timer.current) flush(); }} />
            )}
          </section>
        </div>
      </div>
      <section className={styles.card}>
        <h3>Publish</h3>
        <p>Publishing makes this the official text in the Roadie Manual{p.ack_required ? ", and asks staff to acknowledge it" : ""}. No scheduling rule switches on because of it.</p>
        <label className={styles.check}><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Post a notice in Announcements</label>
        <Action className={styles.primary} label="Publish to staff" confirm="Publish this to staff now?" onRun={async () => { await flush(); await api(`policies/${id}/publish`, { confirm: true, notify }); await load(); setSave("Published"); }} />
      </section>
      <section className={styles.card}>
        <h3>Version history</h3>
        {viewing ? (
          <div className={styles.note}>
            <strong>{viewing.title}</strong> <span className={styles.muted}>({when(viewing.at)})</span>
            <div dangerouslySetInnerHTML={{ __html: viewing.html }} />
            <button type="button" className={styles.small} onClick={() => setViewing(null)}>Close</button>
          </div>
        ) : null}
        <ul className={styles.list}>
          {versions.map((v) => (
            <li key={v.id} className={styles.item}>
              <div className={styles.itemHead}><span><strong>{v.kind}</strong> {v.actor ? `by ${v.actor}` : ""}</span><span className={styles.muted}>{when(v.at)}</span></div>
              <div className={styles.row}>
                <button type="button" className={styles.small} onClick={async () => setViewing({ ...(await api(`policies/${id}/versions/${v.id}`)).version })}>View</button>
                <Action label="Restore into draft" confirm="Replace the current draft with this version? Staff won't see it until you publish." onRun={async () => { await flush(); await api(`policies/${id}/restore`, { version_id: v.id }); await load(); setPreview(false); if (area.current) area.current.innerHTML = html.current; }} />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Question({ q, reload }: { q: any; reload: () => void }) {
  const [answer, setAnswer] = useState(q.answer ?? "");
  return (
    <li className={styles.item}>
      <div className={styles.itemHead}><strong>{q.topic}</strong><Status value={q.status} /></div>
      <p className={styles.muted}>{q.chapter ? `Chapter ${q.chapter}: ${CHAPTERS[q.chapter]}` : "General"}{q.decided_by_name ? ` · last edited by ${q.decided_by_name}` : ""}</p>
      <div className={styles.form}>
        <label>Moose&apos;s decision<textarea rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} /></label>
        <div className={styles.row}>
          <Action label="Save for later" onRun={async () => { await api(`questions/${q.id}`, { answer, status: answer ? "needs_review" : "open" }); reload(); }} />
          <Action label="Mark as decided" onRun={async () => { await api(`questions/${q.id}`, { answer, status: "answered" }); reload(); }} />
        </div>
      </div>
    </li>
  );
}

export default function PolicyEditor({ initial }: { initial?: number | null }) {
  const { data, error, reload } = useLoad("policies");
  const { data: qs, reload: reloadQs } = useLoad("questions");
  const [open, setOpen] = useState<number | null>(initial ?? null);
  const [tab, setTab] = useState("policies");
  const [n, setN] = useState({ title: "", chapter: "1" });
  if (open) return <Editor id={open} onClose={() => { setOpen(null); reload(); }} />;
  if (!data) return <Loading error={error} />;
  const waiting = qs?.questions.filter((q: any) => q.status !== "answered").length ?? 0;
  return (
    <div className={styles.stack}>
      <nav className={styles.tabs} aria-label="Policy Editor">
        <button type="button" className={tab === "policies" ? styles.tabOn : styles.tab} onClick={() => setTab("policies")}>Chapters</button>
        <button type="button" className={tab === "questions" ? styles.tabOn : styles.tab} onClick={() => setTab("questions")}>Questions waiting ({waiting})</button>
      </nav>
      {tab === "policies" ? (
        <>
          <p className={styles.note}>Only <strong>Published</strong> text is official and visible to staff. Everything else stays here. Edits stay in the draft until you publish them.</p>
          {[1, 2, 3, 4, 5, 6].map((c) => (
            <section key={c} className={styles.card}>
              <h3>{c}. {CHAPTERS[c]}</h3>
              <ul className={styles.list}>
                {data.policies.filter((p: any) => p.chapter === c).map((p: any) => (
                  <li key={p.id} className={styles.item}>
                    <div className={styles.itemHead}>
                      <button type="button" className={styles.linkButton} onClick={() => setOpen(p.id)}>{p.title}</button>
                      <span className={styles.row}><Status value={p.status} />{p.has_unpublished ? <Status value="unpublished_changes" /> : null}</span>
                    </div>
                    <p className={styles.muted}>{STATUS_LABEL[p.status]}{p.published_at ? ` · published ${day(p.published_at)}` : ""} · edited {day(p.updated_at)}{p.updated_by_name ? ` by ${p.updated_by_name}` : ""} · read by {p.visible_roles.join(", ")}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className={styles.card}>
            <h3>Add a policy</h3>
            <div className={styles.form}>
              <div className={styles.grid2}>
                <label>Title<input value={n.title} onChange={(e) => setN({ ...n, title: e.target.value })} /></label>
                <label>Chapter<select value={n.chapter} onChange={(e) => setN({ ...n, chapter: e.target.value })}>{[1, 2, 3, 4, 5, 6].map((c) => <option key={c} value={c}>{c}. {CHAPTERS[c]}</option>)}</select></label>
              </div>
              <Action label="Add as draft" onRun={async () => { const r = await api("policies", { title: n.title, chapter: +n.chapter }); setN({ title: "", chapter: "1" }); reload(); setOpen(r.id); }} />
            </div>
          </section>
        </>
      ) : !qs ? <Loading /> : <ul className={styles.list}>{qs.questions.map((q: any) => <Question key={q.id} q={q} reload={reloadQs} />)}</ul>}
    </div>
  );
}
