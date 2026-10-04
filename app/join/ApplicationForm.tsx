"use client";

import { useEffect, useRef, useState } from "react";
import contact from "../contact/contact.module.css";
import styles from "./join.module.css";

// The staff application form. It posts to /api/apply, which forwards it to the
// private management Google Sheet. Nothing is kept in the browser (no
// localStorage), and the answers are never shown back after sending.

type Status = "idle" | "submitting" | "success" | "error";

const POSITIONS = ["DJ", "Host", "Dancer", "Promoter", "Other"];

function newSubmissionId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function Field({
  id,
  label,
  required = false,
  hint,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            {" "}
            *
          </span>
        ) : (
          <span className={styles.optional}> (optional)</span>
        )}
      </label>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      {children}
    </div>
  );
}

export default function ApplicationForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [position, setPosition] = useState("");
  const busy = useRef(false);
  // One id per application: a retry after a lost reply is recognised by the
  // Sheet instead of being added twice.
  const submissionId = useRef<string | null>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (status === "success") doneHeading.current?.focus();
  }, [status]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    // Read the answers before "submitting" disables the fields (FormData skips disabled ones).
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    setStatus("submitting");

    submissionId.current ??= newSubmissionId();

    try {
      const response = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secondLifeName: text("secondLifeName"),
          displayName: text("displayName"),
          discordName: text("discordName"),
          position: text("position"),
          previousExperience: text("previousExperience"),
          positionExperience: text("positionExperience"),
          availability: text("availability"),
          musicType: text("musicType"),
          whyJoin: text("whyJoin"),
          otherClub: text("otherClub"),
          additionalInfo: text("additionalInfo"),
          acknowledged: form.get("acknowledged") === "on",
          website: text("website"),
          submissionId: submissionId.current,
        }),
      });
      const result = (await response.json().catch(() => null)) as { ok?: boolean } | null;
      if (!response.ok || !result?.ok) throw new Error("not saved");
      setStatus("success");
    } catch {
      setStatus("error");
    } finally {
      busy.current = false;
    }
  }

  if (status === "success") {
    return (
      <div className={styles.done} role="status">
        <h2 ref={doneHeading} tabIndex={-1} className={`${contact.panelTitle} ${styles.doneTitle}`}>
          Application Received
        </h2>
        <p className={contact.panelText}>
          Thank you for your interest in Sanctuary Rocks. Your application has been received and will be reviewed by management. We will
          contact you if we need any additional information.
        </p>
      </div>
    );
  }

  const submitting = status === "submitting";

  return (
    <form className={styles.form} onSubmit={handleSubmit} aria-busy={submitting}>
      <p className={styles.requiredNote}>
        <span className={styles.required} aria-hidden="true">
          *
        </span>{" "}
        Required
      </p>

      <fieldset className={styles.group} disabled={submitting}>
        <legend className={styles.legend}>About you</legend>
        <div className={styles.row}>
          <Field id="secondLifeName" label="Second Life Name" required>
            <input className={styles.input} id="secondLifeName" name="secondLifeName" type="text" required maxLength={100} autoComplete="off" />
          </Field>
          <Field id="displayName" label="Display Name">
            <input className={styles.input} id="displayName" name="displayName" type="text" maxLength={100} autoComplete="off" />
          </Field>
          <Field id="discordName" label="Discord Name">
            <input className={styles.input} id="discordName" name="discordName" type="text" maxLength={100} autoComplete="off" />
          </Field>
          <Field id="position" label="Position Applying For" required>
            <select
              className={`${styles.input} ${styles.select}`}
              id="position"
              name="position"
              required
              value={position}
              onChange={(e) => setPosition(e.target.value)}
            >
              <option value="" disabled>
                Choose a position
              </option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </fieldset>

      <fieldset className={styles.group} disabled={submitting}>
        <legend className={styles.legend}>Your experience</legend>
        <Field id="previousExperience" label="Previous Club Experience" hint="Clubs you've worked at and what you did there.">
          <textarea className={`${styles.input} ${styles.textarea}`} id="previousExperience" name="previousExperience" maxLength={2000} rows={4} />
        </Field>
        <Field id="positionExperience" label="Experience in the Position">
          <textarea className={`${styles.input} ${styles.textarea}`} id="positionExperience" name="positionExperience" maxLength={2000} rows={4} />
        </Field>
        <Field id="availability" label="General Availability" hint="Days and times you can usually work (and your time zone).">
          <textarea className={`${styles.input} ${styles.textarea}`} id="availability" name="availability" maxLength={1000} rows={3} />
        </Field>
        {position === "DJ" ? (
          <Field id="musicType" label="What type(s) of music do you play?">
            <textarea className={`${styles.input} ${styles.textarea}`} id="musicType" name="musicType" maxLength={1000} rows={3} />
          </Field>
        ) : null}
      </fieldset>

      <fieldset className={styles.group} disabled={submitting}>
        <legend className={styles.legend}>A little more</legend>
        <Field id="whyJoin" label="Why would you like to join Sanctuary Rocks?">
          <textarea className={`${styles.input} ${styles.textarea}`} id="whyJoin" name="whyJoin" maxLength={2000} rows={4} />
        </Field>
        <div className={styles.field}>
          <p className={styles.label} id="otherClub-label">
            Do you currently work at another club?<span className={styles.optional}> (optional)</span>
          </p>
          <div className={styles.choices} role="radiogroup" aria-labelledby="otherClub-label">
            {["Yes", "No"].map((choice) => (
              <label key={choice} className={styles.choice}>
                <input type="radio" name="otherClub" value={choice} />
                <span>{choice}</span>
              </label>
            ))}
          </div>
        </div>
        <Field id="additionalInfo" label="Anything else you would like management to know?">
          <textarea className={`${styles.input} ${styles.textarea}`} id="additionalInfo" name="additionalInfo" maxLength={2000} rows={4} />
        </Field>
      </fieldset>

      {/* Hidden from people; only bots fill it in. */}
      <div className={styles.trap} aria-hidden="true">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <label className={styles.consent}>
        <input type="checkbox" name="acknowledged" required disabled={submitting} />
        <span>
          I understand that this application is being submitted privately to Sanctuary Rocks management for{" "}
          <span className={styles.nowrap}>
            review.
            <span className={styles.required} aria-hidden="true">
              {" "}*
            </span>
          </span>
        </span>
      </label>

      {status === "error" ? (
        <p className={styles.error} role="alert">
          We&rsquo;re sorry, but there was a problem submitting your application. Please try again or contact Sanctuary Rocks management.
        </p>
      ) : null}

      <div className={styles.actions}>
        <button type="submit" className={`${contact.button} ${styles.submit}`} disabled={submitting}>
          {submitting ? <span className={styles.spinner} aria-hidden="true" /> : null}
          <span>{submitting ? "Submitting..." : "Submit Application"}</span>
          {submitting ? null : (
            <span className={contact.chevron} aria-hidden="true">
              »
            </span>
          )}
        </button>
      </div>
    </form>
  );
}
