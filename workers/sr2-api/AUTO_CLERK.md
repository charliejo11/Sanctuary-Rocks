# Auto Clerk: automatic DJ and host covers

Phase 1 is the backend: built, tested on staging, and **live in production since 2026-11-04**. Production reads the
Calendar and mirrors the managers' workbook. `CLERK_DISCORD` isn't set there yet, so covers are previews and nothing
is posted.

## What it does

1. **Callout.** The person scheduled for a shift says they can't make it. They do this from Backstage Pass, or from the
   Staff Board with a linked avatar. An open cover is created at once, with no manager approval.
2. **Notice.** The open cover is posted in the staff Discord channel. A new cover pings the DJ or Host role; an urgent
   one (under 24 h to go) pings management as well.
3. **Claim.** Any eligible DJ or host takes the cover. The first valid claim wins. One database transaction checks the
   cover is still open, re-checks schedule conflicts and assigns the shift, so two people can never both get it.
   The original person and the replacement are both mentioned in the "Covered" post.
4. **Clock.** Every minute, open covers move along these steps, each one sent once:
   - **Urgent:** marked under 24 h before the start.
   - **Reminders:** posted 24, 6 and 2 h before.
   - **Escalation:** management is pinged 12 and 3 h before.
   - **UNCOVERED:** at the start time, if nobody took it, management is alerted. A shift is never quietly marked covered.
5. **History.** Every callout, claim, refused claim, cancellation, reminder, escalation and override goes in `clerk_log`.
   Each entry records who, which shift, from whom to whom, when, and how (portal, board, manager, Sheet or system).

Eligible means: the DJ role for a DJ shift and the Host role for a host shift, not the person calling out, and no other
shift of theirs at the same time.

## Who owns what

| Data | Owner | Edited by |
| --- | --- | --- |
| The schedule: Shift ID, date, start, end, timezone, role, staff, event | the managers' **Google Sheet** | managers, in the Sheet |
| Callouts, covers, claims, reminders, history | **D1** (`clerk_shifts`, `shift_requests` with `auto = 1`, `clerk_log`) | only the Auto Clerk |
| The Sheet's Status / Covered By / Updated columns | the **Auto Clerk** | written back automatically |

- **Reading the Sheet.** The backend reads it every 10 minutes, through `google-apps-script/sanctuary-schedule-sync.gs`
  with a secret.
- **Manager edits win.** Changing the Staff column on a shift is a manager override: it replaces any callout or cover,
  and is logged. Deleting a row cancels that shift and its open cover.
- **Safety.** If the Sheet reads back empty, nothing is removed.
- **Mapping names.** A name in the Sheet is mapped to a Backstage Pass account by its calendar name, display name or
  Discord name. If a name matches no account, or more than one, it is reported in the board view, not guessed.
- **Retries.** Discord posts and Sheet updates go through `clerk_outbox`. They are retried with backoff and never sent twice.

Covers reuse the portal's `shift_requests` table. Backstage Pass's existing **I can cover this** button now claims an
Auto Clerk cover instantly, and **Approve** is refused for those covers. Ordinary requests work exactly as before.

## Interfaces

**Backstage Pass** (`/staff/...`, signed-in staff):

| Route | Who | What it does |
| --- | --- | --- |
| `GET clerk` | any staff | my shifts, my callouts, and the open covers I can claim |
| `POST clerk/callout` | any staff | `{shift_id, reason, idem}` |
| `POST clerk/claim/<id>` | any staff | claim an open cover |
| `POST clerk/cancel/<id>` | the person who called out, or management | cancel a callout |
| `GET clerk/board` | management | every shift, cover, the history, the import report and the outbox state |
| `POST clerk/assign` | management | `{shift_id, user_id, reason}`: a logged override |
| `POST clerk/sync` | management | import the Sheet now |

**Staff Board** (signed `/sl/...` actions, avatar linked to a Backstage Pass account):
- `clerk_mine`
- `clerk_callout`
- `clerk_claim`
- `clerk_cancel`

## Settings (Worker vars, optional)

| Var | Default | What it controls |
| --- | --- | --- |
| `CLERK_IMPORT_MINUTES` | 10 | how often the Sheet is read |
| `CLERK_URGENT_HOURS` | 24 | an open cover is urgent below this |
| `CLERK_REMIND_HOURS` | 24,6,2 | reminder posts |
| `CLERK_ESCALATE_HOURS` | 12,3 | management pings |
| `CLERK_WINDOW_DAYS` | 30 | shifts further ahead are ignored |
| `CLERK_PING` | role | `none` = no role mention on new covers |
| `CLERK_DISCORD` | (off) | `on` = really post, together with `DISCORD_MODE = "live"` |

## Still needed from you (credentials and permissions)

1. **The schedule Sheet.**
   - Create it and run `setup` in `sanctuary-schedule-sync.gs` (the steps are at the top of the file).
   - Then set these two secrets, staging first:
     ```
     npx wrangler secret put SCHEDULE_SYNC_URL    --env staging -c wrangler.toml
     npx wrangler secret put SCHEDULE_SYNC_SECRET --env staging -c wrangler.toml
     ```
2. **The Discord channel for covers.**
   - Create a webhook in that staff channel and set it as `CLERK_DISCORD_WEBHOOK` (a secret).
   - Set `CLERK_DISCORD = "on"`.
   - Staging stays dry-run: notices are only previewed there.
3. **Staff accounts.**
   - Every DJ and host needs a Backstage Pass account with the right role.
   - Their calendar name must match the Sheet's Staff column.
   - To call out from the Staff Board, their avatar must be linked (Link Account).

## Discord: two-way (added 2026-11-04)

Staff can call out and claim covers in Discord too. Every Discord route ends in the same `callout()` / `claim()` as
Backstage Pass and the Staff Board (`src/staff/clerk_discord.js`).

| In Discord | What happens |
| --- | --- |
| An ordinary message in a cover channel ("can't make my set Friday 8pm") | Within a minute the bot replies with the author's matching real shift(s): one shift gives a Yes / No question, several give a menu. Nothing changes until the author confirms. Vague messages ("might be late") are ignored. |
| `/callout [shift] [reason]` | A private question about your own upcoming shifts (autocomplete lists only yours), then a confirm |
| **Claim Cover** button on the announcement, or `/claim [cover]` | The same claim as Backstage Pass's "I can cover this", with the same checks: role, schedule conflicts, not your own callout, still open |
| A claim from any interface | The announcement is edited to **COVERED** and its button removed. Unsent reminders and escalations for it are dropped. The confirmation mentions the original person and the replacement. Cancelled, UNCOVERED and management overrides edit it the same way. |

**Trust:**
- Only requests carrying Discord's Ed25519 signature are accepted (`DISCORD_PUBLIC_KEY`).
- The person is identified by their signed Discord user id, which must belong to an active Backstage Pass account.
- Their role must be on that account **and** on their Discord roles at that moment (signed `member.roles`, through
  `DISCORD_ROLE_MAP`).
- Only the staff server and the approved channels are accepted.
- Only the person a question was asked of can answer it. Confirming uses a fixed idempotency key, so double clicks,
  repeated messages and retries never create a second cover. Each channel message is handled once; an edit keeps its id.

**Why messages are read once a minute:** Discord only streams ordinary messages through its Gateway, a connection that
has to stay open. A Cloudflare Worker can't hold one. So the bot reads the approved channels through Discord's REST API
once a minute instead. That needs the bot's **Message Content** intent.

**To switch it on (staging first):**
1. **Developer Portal, app 1566291698835783680, Bot:** turn on **Message Content Intent**.
2. **In each cover channel:** give the bot View Channel, Send Messages and Read Message History.
3. **Developer Portal, General Information:** set **Interactions Endpoint URL** to
   `https://sr2-api-staging.elfavina89.workers.dev/discord/interactions`, and put its **Public Key** in `DISCORD_PUBLIC_KEY`.
   - An app has only ONE endpoint URL, and staging and production share this app. A separate test app and test
     server for staging is the cleanest option.
4. **Set the channel ids** in `wrangler.toml`: `CLERK_DJ_CHANNEL` and `CLERK_HOST_CHANNEL` (and `CLERK_STAFF_CHANNEL`,
   optional). `CLERK_CHANNELS` overrides the list of approved channels.
5. **Install `/callout` and `/claim` in the staff server:** Backstage Pass (owner) → `POST /staff/clerk/discord/commands`.
6. **Switch on:**
   - `CLERK_DISCORD = "on"`: really post. Production already has `DISCORD_MODE = "live"`; staging stays a preview.
   - `CLERK_NL = "on"`: read ordinary messages.

**Without a bot channel:** a webhook (`CLERK_DISCORD_WEBHOOK`) can still post the notices, but **without buttons**, and
it can't edit an announcement to COVERED.

**Staging testing:** `scripts/clerk_discord_staging_check.mjs <test key file>` signs simulated interactions with a test
key. Its public half is `CLERK_TEST_PUBLIC_KEY` in the staging vars, which is ignored whenever Discord is live. The script
also feeds simulated messages through `/discord/test-message`, which is off unless that key is set. 22 checks, plus a
verified cleanup.

## The schedule source and the managers' Sheet (approved 2026-11-04)

**The schedule comes from the club Google Calendar.** Moose keeps working there; this replaced the earlier
"schedule in a Sheet" design.
- The site's Calendar reader gives the Auto Clerk the sets 60 days ahead (`/api/lineup?clerk=1`), with each event's id.
- Each set becomes a DJ shift, plus a Host shift when a host is named. The shift id comes from the event (and the
  occurrence, for a repeating set), so moving a set or changing its DJ keeps the same shift.
- A changed single occurrence ("this event only") replaces the original occurrence instead of adding a second one.
- Calendar edits are applied every 10 minutes and logged "via Calendar". A DJ change on a shift that has a callout is a
  logged management override.
- The Calendar import only ever removes shifts that came from the Calendar.
- `CLERK_SOURCE = "sheet"` brings back the Sheet-as-schedule importer (`sanctuary-schedule-sync` design); it isn't used.

**The Sheet: six tabs in the "Sanctuary Rocks Applications" workbook.** They're added by a **separate** script project,
`google-apps-script/sanctuary-auto-clerk.gs`. The Applications tab and the applications script are never touched.

| Tab | Content |
| --- | --- |
| SR Schedule | every shift, shown in SLT, with who is on it now, the status, and their SL key and Discord id; UTC times. Three white columns for management: Manager Action, Assign To, Reason. |
| SR Callouts | who called out, of what, why, when (UTC and SLT), and how |
| SR Cover Requests | each cover: status, urgent, who covered it, when and how it was claimed, reminders sent |
| SR Schedule Changes | Calendar adds, edits and removals, replacements, overrides, cancelled callouts |
| SR Staff Registry | Backstage Pass accounts: names, calendar names, roles, Discord ids, SL keys (managed in Backstage Pass) |
| SR Auto Clerk Log | every action |

**How the tabs behave:**
- They're a mirror of D1, refreshed every 5 minutes, or within a minute of a change.
- They're locked to the owner, apart from SR Schedule's three management columns.
- Everything is written as plain text, so the workbook's Eastern time zone changes nothing.
- The setup never creates a tab over an existing one, and never writes to a same-named tab that isn't an Auto Clerk tab.

**Management requests:**
1. Set Manager Action (**Assign cover** or **Cancel callout**), Assign To (a Staff Registry name) and Reason. The row shows
   **Pending** with the editor's email.
2. The club system checks it and applies it once. The request's identity is those three cells, so the same request read
   twice changes nothing.
3. Change Status then shows **Applied …** or **Rejected: why**.
4. A mirror refresh never replaces a Pending mark with the answer to an older request.

**Setup:** the steps are at the top of `sanctuary-auto-clerk.gs`:
1. Make a copy of the workbook for staging.
2. Create a new script project at script.google.com and paste the file in.
3. Set `SPREADSHEET_ID` to the copy's id, then run `setup`.
4. Deploy it as a web app.
5. Set the two staging secrets, typing them at the prompt:
   ```
   npx wrangler secret put SCHEDULE_SYNC_URL    --env staging -c wrangler.toml
   npx wrangler secret put SCHEDULE_SYNC_SECRET --env staging -c wrangler.toml
   ```

**Production:** the same steps with a NEW standalone project ("SR Auto Clerk"), `SPREADSHEET_ID` = the real workbook,
and the secrets set with `--env production`. Never in the workbook's own project (its Code.gs is the live Join form).

**Read-only inspection:** `google-apps-script/sanctuary-workbook-inspect.gs`.

**Volume and safety:**
- The club Calendar has about 12 sets a day, so roughly 24 shifts a day (about 700 over 30 days).
- The import reads everything up front and writes in batches. It makes at most `CLERK_IMPORT_MAX_WRITES` (300) writes
  per run, so the first fill finishes over a few minutes.
- `TBD`, `TBC`, `TBA` and the stand-in "Sanctuary Rocks DJ" are open slots (Unassigned), not names.
- A Calendar feed without event ids (the plain lineup, for example from an older site version during a deploy) is
  refused; nothing changes. **Deploy the website before the API** all the same. This happened once on staging
  (2026-11-04), and those stand-in rows were deleted.

## Not yet built (next phases)

- **Backstage Pass screens:** a Call out button on My Schedule and a management Auto Clerk board. The API is ready, and
  claiming already works through the existing button. The note on My Schedule that says requests wait for management
  needs rewording for Auto Clerk covers.
- **Staff Board in-world:** the Coverage Request button should call `clerk_callout` and `clerk_claim` instead of opening the site.
- **Discord direct messages:** none. Notices go to the one staff channel only.

## Deploy and rollback

- **Staging** (done 2026-11-04):
  - migration `0013_auto_clerk.sql`
  - `npx wrangler deploy --env staging -c wrangler.toml`
  - check: `node scripts/clerk_staging_check.mjs <private secret file>` (simulated shifts; it removes all its TEST rows).
- **Production** (approved and done 2026-11-04):
  - Website first (`npm run cf:deploy`, version `93410cd2`): `/api/lineup?clerk=1` with event ids.
  - Migrations `0013`-`0015` **before** the API. Without them, the portal's request screens fail (they read the new columns).
  - API `--env production`, version `61771c39`. The first Calendar import fills about 800 shifts over several minutes.
  - The Sheet secrets were then set. **Each `wrangler secret put` makes a new version** ("Secret Change"):
    `1a3b02de`, then `14bfd86c`.
- **Review fixes** (commit `7dd50bd`, approved and done 2026-11-04):
  - Staging `98c33dfe`: 124 tests, `clerk_staging_check` 26/26, `clerk_discord_staging_check` 22/22.
  - Production API **`7a4e1340-fb00-468b-876d-8e74e459fef5`** (current), replacing `14bfd86c`. API only: no migration,
    no website deploy. A read-only dry run predicted no data changes, 14/14 smoke tests passed, and the first import
    after it changed nothing (0 added / changed / removed / matched).
- **Rollback:**
  - API: `npx wrangler rollback <version> --env <env> -c wrangler.toml`.
  - **Production now: roll back to `14bfd86c-0aaf-4d47-a6bd-df9984d25bef`** (the code before the review fixes, with the
    Sheet secrets). Not to `61771c39`: it was made before the Sheet secrets were set.
  - Before the Auto Clerk: staging `a7bd3272-c3ec-43dd-a678-f2452c0268c3`, production
    `8804cf35-bfb8-4b8c-b2e3-3094df3398a1`.
  - Website: production before the Calendar change was `87421678-f1fe-48ed-ae99-972081ad978b`.
  - Production D1 just before the migrations: time-travel bookmark
    `00000019-000002f2-00005119-6fee0252d4a05d7ecea6a69896c0cbb1` (a restore undoes everything written after it).
  - The migration only adds tables and columns, so older code ignores them.
