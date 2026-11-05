# Backstage Pass and SR 2.0: deployment and rollback

For whoever deploys this. Run commands from the website repo unless a step says otherwise. Secrets are entered at the
`wrangler secret put` prompt and never go in a file, a log or a chat.

## What runs where

| Piece | Staging | Production |
| --- | --- | --- |
| Website | `sanctuary-rocks-staging` (`wrangler.staging.jsonc`) | `sanctuary-rocks` (`wrangler.jsonc`) |
| Staff API | `sr2-api-staging` (`--env staging`) | `sr2-api-prod` (`--env production`) |
| Database | D1 `sr2-staging` | D1 `sr2-prod` |
| Discord | dry-run | events on, staff server only; channel messages off |

`sr2-api-dev` and D1 `sr2-dev` are the older development pair. The boards in-world talk to them. Nothing here changes them.

## Deploy to staging

```
cd workers/sr2-api
node --test test/*.test.mjs
npx wrangler d1 migrations apply sr2-staging --env staging --remote -c wrangler.toml
npx wrangler deploy --env staging -c wrangler.toml
cd ../..
npx opennextjs-cloudflare build
npx opennextjs-cloudflare deploy --config wrangler.staging.jsonc
```

Add a staging user with a one-time sign-in code. The code goes to the file you name, never the screen:

```
cd workers/sr2-api
node scripts/bootstrap_staff.mjs --env staging --name "Moose" --roles owner --out <private file>
```

## Go-live checklist (done 2026-11-01; kept for reference)

1. Take a checkpoint: `Documents\Sanctuary_Rocks_Build\SR2_System\Backups\make_checkpoint.ps1`.
2. All backend tests and the browser tests pass on staging.
3. Create the production pair: `npx wrangler d1 create sr2-prod`, then add an `[env.production]` block to
   `workers/sr2-api/wrangler.toml` copying the staging block, with `SITE_URL` set to the live site and `DISCORD_MODE = "dry-run"`.
4. Apply migrations and deploy with `--env production`.
5. Set a shared proxy secret on both workers: `STAFF_PROXY_SECRET`.
6. Set `STAFF_API_URL` on the live site (add it to `vars` in `wrangler.jsonc`), then `npm run cf:deploy`. Until this variable
   exists, `/api/staff/*` answers 503 and the staff page says it isn't open.
7. Bootstrap Moose's owner account and sign in.
8. Migration 0006 publishes the Roadie Manual as written. Moose edits and republishes from the Policy Editor or the book's Edit links.
9. Add the Backstage Pass staff link to the site navigation when Moose is ready. It is not linked anywhere today.

## Turning on Discord

The staff webhook ("The Riff Report") is the one flagged as exposed, and both webhooks have been pasted in chat. The project owner
chose to use them as they are (2026-10-31). Staging holds them as secrets, with sending blocked. Set them the same way on
each environment: `DISCORD_STAFF_WEBHOOK` and `DISCORD_VIP_WEBHOOK`. Migration 0006 already points both communities at their channels.

**Sign-in.** Create a Discord application and a bot, invite the bot to the staff server, and add the redirect
`<SITE_URL>/api/staff/auth/discord/callback`. Then:

```
npx wrangler secret put DISCORD_CLIENT_ID --env <env> -c wrangler.toml
npx wrangler secret put DISCORD_CLIENT_SECRET --env <env> -c wrangler.toml
npx wrangler secret put DISCORD_BOT_TOKEN --env <env> -c wrangler.toml
npx wrangler secret put DISCORD_STAFF_GUILD_ID --env <env> -c wrangler.toml
npx wrangler secret put DISCORD_ROLE_MAP --env <env> -c wrangler.toml      # {"<role id>":"dj","<role id>":"host","<role id>":"management"}
npx wrangler secret put OWNER_DISCORD_IDS --env <env> -c wrangler.toml     # Moose's Discord user ID
```

**Live on Stage messages.** In Backstage Pass → Management → Discord & System, enter each community's server and channel
IDs and choose bot or webhook. Webhooks are `DISCORD_STAFF_WEBHOOK` and `DISCORD_VIP_WEBHOOK`. Review the preview. Set
`DISCORD_MODE = "live"` only after that review, and with approval. The live event under the server name needs the bot in each server, `DISCORD_EVENTS = "on"`, and `DISCORD_EVENT_DESTS` naming the
servers allowed (`staff`, then `staff,vip` once VIP is approved). The bot only needs the Create Events permission.

Staff-only live event test, once authorised. Turn the channel messages off for the test, so `live` mode can't post to either channel:

```
cd workers/sr2-api
npx wrangler d1 execute sr2-staging --env staging --remote -c wrangler.toml --yes --command "UPDATE discord_dest SET transport = 'off'"
npx wrangler deploy --env staging -c wrangler.toml --var DISCORD_MODE:live --var DISCORD_EVENTS:on --var DISCORD_EVENT_DESTS:staff
node scripts/live_event_test.mjs start
node scripts/live_event_test.mjs change
node scripts/live_event_test.mjs end
npx wrangler deploy --env staging -c wrangler.toml
npx wrangler d1 execute sr2-staging --env staging --remote -c wrangler.toml --yes --command "UPDATE discord_dest SET transport = 'webhook'"
```

## Google Sheets

Follow the setup at the top of `google-apps-script/sanctuary-staff-sync.gs`, then set `SHEETS_SYNC_URL` and
`SHEETS_SYNC_SECRET`. Sync runs hourly and reports failures on the overview.

## Rollback

**Website.** `npx wrangler rollback <version id>` from the repo root. The live version before this work is
`f34aca71-4c7a-4eeb-a6ba-ff6a810e3570`. A faster way to close only the staff area is to remove `STAFF_API_URL` from the
site and redeploy: the rest of the site is untouched.

**Staff API.** `npx wrangler rollback <version id> --env <env> -c wrangler.toml`. List versions with
`npx wrangler deployments list --env <env> -c wrangler.toml`.

**Discord.** Set `DISCORD_MODE = "dry-run"` and redeploy the staff API. Nothing further is sent. Messages already posted stay until someone deletes them.

**Database.** Migrations 0004 and 0005 only add tables. Older code ignores them, so a code rollback doesn't need a database
rollback. For a restore, use `npx wrangler d1 time-travel restore <database> --timestamp <time>`, which also discards everything saved since.

**In-world.** Put `SR_STAFF_CONTROLLER` back in the board and remove `SR_STAFF_CONTROLLER_V2`, `SR_STAFF_MENUS` and
`SR_STAFF_BRIDGE`. Role records stay in linkset data, so nobody loses their login. Originals are in
`Sanctuary_Rocks_2.0\Optimized_Boards` and were not edited.

**Full checkpoint.** `Documents\Sanctuary_Rocks_Build\SR2_System\Backups\2026-10-31_before_staff_system` holds a git bundle,
a zip of the working tree, a dev database dump, deployment lists and asset hashes from before this work.

## Vote Board (added 2026-11-02)

The club's 4-button Vote Board (DJs, Hosts, Songs, Staff Shoutouts) uses the signed `/sl/vb_*` actions in
`src/lib/voteboard.js`, and the website reads `GET /public/votes`. Migration `0011_vote_board.sql` only adds tables
(`vote_events`, `monthly_snapshots`). In-world install and test list: `SR2_System\LSL\Vote_Board_4Button\INSTALL.md`.

Migration `0012_autodj_in_song_chart.sql` (2026-11-04) lets AutoDJ songs into the Top 10. It sets `chart_ok = 1` on every
real song outside a DJ trial. Finished weeks are frozen snapshots, so only the current week changes. DJ credit still needs a
verified, logged-in DJ, and a song needs at least one like to be listed. Undo, if ever needed (the old rule):
`UPDATE plays SET chart_ok = 0 WHERE attribution != 'ok';`.

The public Backstage Pass page now reads its backend through the site's own `/api/sr2/*` route, which uses
`STAFF_API_URL`. Staging reads staging, and the live site reads production. Before this change, the live page read `sr2-api-dev`.

**Staging**
```
cd workers/sr2-api
node --test test/*.test.mjs
npx wrangler d1 migrations apply sr2-staging --env staging --remote -c wrangler.toml
npx wrangler secret put SL_SECRET --env staging -c wrangler.toml      # once: the test board's secret
npx wrangler deploy --env staging -c wrangler.toml
node scripts/vote_board_staging_check.mjs <private secret file>        # then: ... --cleanup
cd ../..
npx opennextjs-cloudflare build
npx opennextjs-cloudflare deploy --config wrangler.staging.jsonc
```

**Production** (only after the in-world test list passes and the go-live is approved): the same commands with
`sr2-prod` / `--env production`, then `npm run cf:deploy` for the site. Point the board's `SR2 Secret` at `sr2-api-prod`.

**Rollback**
- Website: `npx wrangler rollback <version id>`. The Backstage Pass page goes back to reading `sr2-api-dev`.
- API: `npx wrangler rollback <version id> --env <env> -c wrangler.toml`. The staging version before the Vote Board is
  `0322f8e9-656c-4e76-9b87-d5356064bce8`. Older code ignores the new tables, so the database needs no rollback.
- In-world: put `SR_VOTE_CONTROLLER` back (see INSTALL.md).
- Files from before the change: `SR2_System\Backups\2026-11-02_before_vote_board`.

## Auto Clerk (added 2026-11-04)

Automatic DJ and host covers. The design, settings, the credentials still needed, and the deploy order are in
`AUTO_CLERK.md`. Staging only so far. In production, migration `0013_auto_clerk.sql` must be applied before the API is
deployed.
