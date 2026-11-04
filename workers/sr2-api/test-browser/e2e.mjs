// End-to-end test of Backstage Pass on STAGING, in a real browser, as each role. Sends nothing to Discord (dry-run).
// Needs playwright-core and Edge. Run: node e2e.mjs <codes file>, one "name<TAB>roles<TAB>code" line per account from scripts/bootstrap_staff.mjs.
// Accounts: TEST Moose (owner), TEST DJ (dj), TEST Host (host), TEST Manager (management), TEST Phone (dj). Reset staging data between runs.
import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";

const SITE = "https://sanctuary-rocks-staging.elfavina89.workers.dev";
const PAGE = `${SITE}/backstage-pass/staff`;
const DIR = new URL("./shots/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
mkdirSync(DIR, { recursive: true });
const codes = Object.fromEntries(readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => { const [n, , c] = l.split("\t"); return [n, c.trim()]; }));

let pass = 0; const failed = [];
const check = (name, ok, extra = "") => { if (ok) { pass++; console.log(`  ok   ${name}`); } else { failed.push(name); console.log(`  FAIL ${name} ${extra}`); } };

const browser = await chromium.launch({ channel: "msedge", headless: true });
const consoleErrors = [];

async function session(name, viewport = { width: 1400, height: 950 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => consoleErrors.push(`${name}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/status of (401|403|409|503)/.test(m.text())) consoleErrors.push(`${name}: ${m.text()} ${m.location().url}`); });
  await page.goto(PAGE, { waitUntil: "networkidle" });
  if (codes[name]) {
    await page.getByRole("button", { name: /recovery code/i }).click();
    await page.getByLabel(/Recovery code/i).fill(codes[name]);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByText("Signed in as").waitFor({ timeout: 15000 });
  }
  return { ctx, page };
}
const apiGet = (page, p) => page.evaluate(async (u) => { const r = await fetch(`/api/staff/${u}`); return { status: r.status, body: await r.json().catch(() => null) }; }, p);
const openPanel = async (page, name) => { await page.getByRole("button", { name }).first().click(); await page.getByRole("heading", { level: 1 }).first().waitFor(); };
const home = async (page) => { await page.goto(PAGE, { waitUntil: "networkidle" }); await page.getByText("Signed in as").waitFor(); };

console.log("\n== Anonymous visitor");
{
  const { page, ctx } = await session("anon");
  await page.screenshot({ path: `${DIR}anon-desktop.png`, fullPage: true });
  check("the ticket artwork shows", await page.locator('img[alt^="Sanctuary Rocks Backstage Pass"]').evaluate((i) => i.complete && i.naturalWidth === 1536));
  check("sign-in is offered", await page.getByRole("heading", { name: "Staff sign in" }).isVisible());
  await page.getByRole("button", { name: /^My Schedule/ }).first().click();
check("a panel asks visitors to sign in, and opens nothing", await page.getByText(/sign in first/i).isVisible() && !(await page.getByRole("heading", { name: "My Schedule" }).count()));
  for (const p of ["me", "overview", "roster", "policies", "donations", "manual", "issues", "made/up"]) check(`API ${p} answers 401`, (await apiGet(page, p)).status === 401);
  check("the page source holds no staff data", !/needs_review|draft_html|Moose's Overview/.test(await page.content()));
  const bad = await page.evaluate(async () => (await fetch("/api/staff/auth/recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: "x".repeat(30) }) })).status);
  check("a wrong recovery code is refused", bad === 401);
  const robots = await page.locator('meta[name="robots"]').getAttribute("content");
  check("search engines are told to stay out", /noindex/.test(robots ?? ""));
  await ctx.close();
}

console.log("\n== Owner (Moose)");
const { page: moose } = await session("TEST Moose");
await moose.screenshot({ path: `${DIR}owner-ticket.png`, fullPage: true });
const me = (await apiGet(moose, "me")).body;
check("owner session carries the owner role", me.user.roles.includes("owner"));
const cookies = await moose.context().cookies();
const sess = cookies.find((c) => c.name === "__Host-sr_staff");
check("session cookie is HttpOnly, Secure, Lax", sess && sess.httpOnly && sess.secure && sess.sameSite === "Lax");

// hotspots line up with the printed panels: click the centre of each panel by its artwork coordinates
const CENTRES = { "My Schedule": [256, 566], "Roadie Manual": [557, 566], "My Sets / Shifts": [857, 566], "Trial Center": [1157, 566], "Crew Help": [256, 820], Announcements: [557, 820], Recognition: [857, 820], Management: [1157, 820] };
for (const [title, [x, y]] of Object.entries(CENTRES)) {
  await moose.waitForTimeout(400);
  const ticket = await moose.locator('img[alt^="Sanctuary Rocks Backstage Pass"]').boundingBox();
  await moose.mouse.click(ticket.x + (x / 1536) * ticket.width, ticket.y + (y / 1024) * ticket.height);
  const h1 = moose.getByRole("heading", { level: 1 }).first();
  await h1.waitFor();
  check(`clicking the printed "${title}" panel opens it`, (await h1.textContent()) === title, await h1.textContent());
  await moose.waitForTimeout(600);
  await moose.screenshot({ path: `${DIR}owner-${title.replace(/\W+/g, "-")}.png`, fullPage: true });
  await moose.getByRole("button", { name: /Backstage Pass/ }).first().click();
  await moose.locator('img[alt^="Sanctuary Rocks Backstage Pass"]').waitFor();
}

console.log("\n== Roadie Manual before anything is published");
const { page: dj } = await session("TEST DJ");
await openPanel(dj, /^Roadie Manual/);
await dj.getByRole("button", { name: "Open Book ▶" }).waitFor();
await dj.waitForFunction(() => { const i = document.querySelector("img.cover"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 }).catch(() => {});
check("the leather cover is the approved image", await dj.locator("img.cover").evaluate((i) => i.complete && i.naturalWidth > 500), await dj.locator("img.cover").evaluate((i) => i.currentSrc + " " + i.naturalWidth));
await dj.screenshot({ path: `${DIR}book-cover.png`, fullPage: true });
await dj.getByRole("button", { name: "Open Book ▶" }).click();
check("the book opens to a two-page spread", (await dj.locator("section.sheet").count()) === 2);
await dj.waitForTimeout(700);
await dj.screenshot({ path: `${DIR}book-open.png`, fullPage: true });
const bookCss = await dj.locator(".book").evaluate((b) => { const c = getComputedStyle(b); return { border: c.borderTopStyle, w: c.borderTopWidth, grid: c.gridTemplateColumns.split(" ").length }; });
check("binding, ridge border and spread match the approved CSS", bookCss.border === "ridge" && bookCss.w === "10px" && bookCss.grid === 2, JSON.stringify(bookCss));
await dj.getByRole("button", { name: /THE CREW CODE/ }).click();
check("contents jumps to a chapter", await dj.getByRole("heading", { name: "THE CREW CODE" }).isVisible());
const visible = await dj.locator(".book").innerText();
check("unpublished chapter text is not shown to staff", !/Because even rock s/.test(visible) && /still with Moose/.test(visible), visible.slice(0, 200));
const manualRaw = (await apiGet(dj, "manual")).body;
check("the manual API gives staff no drafts", manualRaw.policies.length === 0 && !JSON.stringify(manualRaw).includes("draft_html"));
for (const p of ["overview", "policies", "policies/1", "questions", "roster", "audit", "donations", "votes", "discord", "settings"]) check(`DJ blocked from ${p}`, (await apiGet(dj, p)).status === 403);
const forged = await dj.evaluate(async () => (await fetch("/api/staff/policies/1/publish", { method: "POST", headers: { "content-type": "application/json", "x-sr-role": "owner" }, body: JSON.stringify({ confirm: true, role: "owner" }) })).status);
check("publish refused to a DJ who claims to be owner", forged === 403);

console.log("\n== Policy Editor");
await moose.goto(`${PAGE}#management`, { waitUntil: "networkidle" });
await moose.getByRole("button", { name: "Policy Editor" }).click();
await moose.getByRole("heading", { name: /2\. The Crew Code/ }).waitFor();
const ch2 = moose.locator("section", { has: moose.getByRole("heading", { name: /2. The Crew Code/ }) }).last();
const titleBtn = ch2.getByRole("button").first();
const policyTitle = (await titleBtn.textContent()).trim();
await titleBtn.click();
const box = moose.getByRole("textbox", { name: "Policy text" });
await box.waitFor({ timeout: 10000 }).catch(async () => { console.log("MAIN:", (await moose.locator("main").innerText()).slice(0, 700), "TITLE:", policyTitle); await moose.screenshot({ path: DIR + "fail.png", fullPage: true }); process.exit(2); });
check("the imported text opens in the editor", (await box.innerText()).length > 50);
check("it warns staff can't see it", await moose.getByText(/never been published/).isVisible());
await moose.screenshot({ path: `${DIR}editor.png`, fullPage: true });
await box.click();
await moose.keyboard.press("Control+End");
const MARK = `E2E wording ${Date.now()}`;
await moose.keyboard.type(` ${MARK}`);
await moose.getByText(/Saved .* SLT/).waitFor({ timeout: 8000 });
check("autosave saved the typing to the server", true);
const pid = (await apiGet(moose, "policies")).body.policies.find((p) => p.title === policyTitle).id;
check("the draft is on the server", (await apiGet(moose, `policies/${pid}`)).body.policy.draft_html.includes(MARK));
check("saving a draft doesn't reach staff", !JSON.stringify((await apiGet(dj, "manual")).body).includes(MARK));
await moose.getByRole("button", { name: "Preview as staff" }).click();
check("preview shows the draft", await moose.getByText(MARK).first().isVisible());
await moose.getByRole("button", { name: "Back to editing" }).click();
await box.waitFor();
check("back in the editor the text is intact", (await box.innerText()).includes(MARK));

// a stale save is refused rather than overwriting someone else's edit
const stale = await moose.evaluate(async (id) => {
  const me = await (await fetch("/api/staff/me")).json();
  const r = await fetch(`/api/staff/policies/${id}/draft`, { method: "POST", headers: { "content-type": "application/json", "x-sr-csrf": me.csrf }, body: JSON.stringify({ html: "<p>x</p>", expected_updated_at: 1 }) });
  return r.status;
}, pid);
check("a save over someone else's newer edit is refused", stale === 409);
const noConfirm = await moose.evaluate(async (id) => {
  const me = await (await fetch("/api/staff/me")).json();
  return (await fetch(`/api/staff/policies/${id}/publish`, { method: "POST", headers: { "content-type": "application/json", "x-sr-csrf": me.csrf }, body: "{}" })).status;
}, pid);
check("publishing without the clear confirmation is refused", noConfirm === 400);
const noCsrf = await moose.evaluate(async (id) => (await fetch(`/api/staff/policies/${id}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) })).status, pid);
check("a request without the CSRF token is refused", noCsrf === 403);

await moose.getByLabel("Staff must acknowledge").check();
await moose.getByText(/Saved .* SLT/).waitFor({ timeout: 8000 });
await moose.getByRole("button", { name: "Publish to staff" }).click();
await moose.getByRole("button", { name: "Yes" }).click();
await moose.getByText(/Published/).first().waitFor();
await moose.waitForTimeout(800);
const pub = (await apiGet(dj, "manual")).body;
check("after Publish, staff get the new text", JSON.stringify(pub).includes(MARK));

// a later draft edit must not leak
await box.click();
await moose.keyboard.press("Control+End");
const SECRET_EDIT = `NOT YET ${Date.now()}`;
await moose.keyboard.type(` ${SECRET_EDIT}`);
await moose.getByText(/Saved .* SLT/).waitFor({ timeout: 8000 });
await moose.waitForTimeout(600);
check("editing a published policy leaves the official text alone", !JSON.stringify((await apiGet(dj, "manual")).body).includes(SECRET_EDIT));
check("the editor says staff can't see the changes", await moose.getByText(/changes staff can.t see/).isVisible());

// version history + restore
const vs = (await apiGet(moose, `policies/${pid}`)).body.versions;
check("version history has the import and the publish", vs.some((v) => v.kind === "imported") && vs.some((v) => v.kind === "published"), JSON.stringify(vs.map((v) => v.kind)));
await moose.locator("li", { hasText: /^imported/i }).first().getByRole("button", { name: "Restore into draft" }).click();
await moose.getByRole("button", { name: "Yes" }).click();
await moose.waitForTimeout(1500);
const restored = (await apiGet(moose, `policies/${pid}`)).body.policy;
check("restore replaces the draft only", !restored.draft_html.includes(MARK) && restored.published_html.includes(MARK));
check("the textbox shows the restored text", !(await box.innerText()).includes(SECRET_EDIT));

console.log("\n== Published text in the book, acknowledgement, search");
await dj.goto(`${PAGE}#manual:ch2`, { waitUntil: "networkidle" });
await dj.reload({ waitUntil: "networkidle" });
await dj.locator(".book").waitFor();
await dj.locator("details.policy summary", { hasText: policyTitle }).click();
check("the published policy appears, with its last-updated date", await dj.getByText(MARK).first().isVisible() && await dj.getByText(/Last updated/).first().isVisible());
await dj.getByRole("button", { name: /read and understood/ }).click();
await dj.getByText(/You acknowledged/).waitFor();
check("the acknowledgement is recorded on the server", (await apiGet(dj, "manual")).body.acks.includes(pid));
await dj.screenshot({ path: `${DIR}book-published.png`, fullPage: true });
await dj.getByLabel("Search the manual").fill(MARK.slice(0, 11));
await dj.locator(".results button").first().waitFor();
check("search finds published wording", (await dj.locator(".results").innerText()).includes("CREW CODE"));
await dj.getByLabel("Search the manual").fill("Vote Board");
await dj.locator(".results button").first().click();
check("a search result jumps to its page", await dj.getByRole("heading", { name: "WHEN THINGS GO SIDEWAYS" }).isVisible());
await dj.getByLabel("Search the manual").fill("NOT YET");
await dj.waitForTimeout(200);
check("search can't find unpublished wording", await dj.getByText("Nothing found.").isVisible());
await dj.getByLabel("Search the manual").fill("");

console.log("\n== Checklist, troubleshooting, coverage, Crew Help");
await dj.getByRole("button", { name: "Contents" }).click();
await dj.getByRole("button", { name: /WELCOME TO THE CREW/ }).click();
let orient = dj.getByRole("heading", { name: "Orientation checklist" });
for (let i = 0; i < 3 && !(await orient.isVisible()); i++) await dj.getByRole("button", { name: "Next ▶" }).click();
await dj.getByLabel("Read The Crew Code").check();
await dj.waitForTimeout(900);
check("the orientation checklist saves to the account", (await apiGet(dj, "manual")).body.progress.includes("orient:code"));
const ctx2 = await browser.newContext({ storageState: await dj.context().storageState(), viewport: { width: 1400, height: 950 } });
const dj2 = await ctx2.newPage();
await dj2.goto(`${PAGE}#manual:orientation`, { waitUntil: "networkidle" });
await dj2.getByLabel("Read The Crew Code").waitFor();
check("it is still ticked on another device", await dj2.getByLabel("Read The Crew Code").isChecked());
await ctx2.close();

await dj.goto(`${PAGE}#manual:ch5`, { waitUntil: "networkidle" });
await dj.reload({ waitUntil: "networkidle" });
const problems = dj.locator("details.policy");
await problems.first().waitFor();
check("all ten troubleshooting problems are listed", (await problems.count()) === 10, String(await problems.count()));
await dj.locator("summary", { hasText: "The stream is disconnected" }).click();
await dj.getByRole("button", { name: /Still broken/ }).first().click();
await dj.getByLabel("Details").fill("E2E: stream dropped at the top of the hour");
await dj.getByRole("button", { name: "Report it", exact: true }).click();
await dj.getByText(/Reported as #/).waitFor();
const issues = (await apiGet(dj, "issues")).body.issues;
check("Report Issue reaches the tracker", issues[0]?.title === "The stream is disconnected" && issues[0]?.source === "manual");
const issueId = issues[0].id;

await dj.goto(`${PAGE}#manual:setlist`, { waitUntil: "networkidle" });
await dj.reload({ waitUntil: "networkidle" });
await dj.getByRole("button", { name: "Request Coverage" }).click();
await dj.getByLabel("Which shift?").fill("E2E Saturday set");
await dj.getByLabel("When is it?").fill("2030-01-05T18:00");
await dj.getByRole("button", { name: "Send request" }).click();
await dj.getByText(/Sent\. It shows below/).waitFor();
const reqs = (await apiGet(dj, "requests")).body.mine;
check("a coverage request is recorded", reqs[0]?.kind === "coverage" && reqs[0]?.status === "pending");
const reqId = reqs[0].id;

const { page: host } = await session("TEST Host");
const open = (await apiGet(host, "requests")).body.open;
check("another staff member sees the open shift", open.some((r) => r.id === reqId));
await home(host);
await openPanel(host, /^My Schedule/);
await host.getByRole("button", { name: "I can cover this" }).first().click();
await host.waitForTimeout(1000);
check("they can offer to cover it", (await apiGet(host, "requests")).body.mine.some((r) => r.id === reqId));
const notApproved = (await apiGet(dj, "requests")).body.mine.find((r) => r.id === reqId);
check("offering doesn't approve anything by itself", notApproved.status === "pending");
check("a host can't see the DJ's issue", (await apiGet(host, `issues/${issueId}`)).status === 404);

const { page: mgr } = await session("TEST Manager");
await openPanel(mgr, /^My Schedule/);
await mgr.getByRole("heading", { name: "Waiting for a decision" }).waitFor();
await mgr.locator("li", { hasText: "E2E Saturday set" }).first().getByRole("button", { name: "Approve" }).first().click();
await mgr.waitForTimeout(1200);
check("management can approve it", (await apiGet(dj, "requests")).body.mine.find((r) => r.id === reqId).status === "approved");
check("a manager can't open the Policy Editor", (await apiGet(mgr, "policies")).status === 403);

await home(mgr);
await openPanel(mgr, /^Crew Help/);
await mgr.getByRole("button", { name: new RegExp(`#${issueId} `) }).click();
await mgr.getByLabel("Status").first().selectOption("resolved");
await mgr.waitForTimeout(1500);
const resolved = (await apiGet(dj, `issues/${issueId}`)).body;
check("the reporter sees it resolved, with who and when", resolved.issue.status === "resolved" && resolved.issue.resolved_by && resolved.log.some((l) => l.action === "resolved"));

console.log("\n== Trials, announcements, recognition");
await home(mgr);
await openPanel(mgr, /^Trial Center/);
await mgr.getByLabel("Applicant", { exact: true }).fill("E2E Applicant");
await mgr.getByLabel("Notes").fill("Private manager note");
await mgr.getByRole("button", { name: "Add", exact: true }).click();
await mgr.getByText("E2E Applicant: DJ").waitFor();
await mgr.getByLabel("Add feedback").fill("Good transitions");
await mgr.getByRole("button", { name: "Save feedback" }).click();
await mgr.getByText("Good transitions").waitFor();
await mgr.getByRole("button", { name: "Approve" }).click();
await mgr.getByRole("button", { name: "Yes" }).click();
await mgr.getByText("Previous decisions").waitFor();
await mgr.waitForTimeout(800);
check("a trial is recorded with feedback and a decision", (await apiGet(mgr, "trials")).body.trials[0].status === "approved");
const djTrials = (await apiGet(dj, "trials")).body;
check("other staff don't see trial records", djTrials.manage === false && djTrials.trials.length === 0);

await home(mgr);
await openPanel(mgr, /^Announcements/);
await mgr.getByLabel("Title").fill("E2E hosts only");
await mgr.getByLabel("Message").fill("For hosts");
await mgr.getByLabel("dj", { exact: true }).uncheck();
await mgr.getByRole("button", { name: "Publish", exact: true }).click();
await mgr.getByRole("button", { name: "Yes" }).click();
await mgr.waitForTimeout(1500);
check("an announcement reaches its audience", (await apiGet(host, "announcements")).body.published.some((a) => a.title === "E2E hosts only"));
check("and stays hidden from others", !(await apiGet(dj, "announcements")).body.published.some((a) => a.title === "E2E hosts only"));
const djAnn = await dj.evaluate(async () => { const me = await (await fetch("/api/staff/me")).json(); return (await fetch("/api/staff/announcements", { method: "POST", headers: { "content-type": "application/json", "x-sr-csrf": me.csrf }, body: JSON.stringify({ title: "x", body: "y", publish: true }) })).status; });
check("a DJ can't publish an announcement", djAnn === 403);

await home(dj);
await openPanel(dj, /^Recognition/);
await dj.getByLabel("Who is it for?").fill("E2E Star");
await dj.getByLabel("What did they do?").fill("Saved the show");
await dj.getByRole("button", { name: "Send for approval" }).click();
await dj.getByText(/once management approves/).waitFor();
check("a shoutout stays hidden until approved", !(await apiGet(dj, "recognition")).body.approved.some((r) => r.subject === "E2E Star"));
await home(mgr);
await openPanel(mgr, /^Recognition/);
await mgr.locator("li", { hasText: "E2E Star" }).getByRole("button", { name: "Approve" }).click();
await mgr.waitForTimeout(1200);
check("and appears once approved", (await apiGet(dj, "recognition")).body.approved.some((r) => r.subject === "E2E Star"));

console.log("\n== Management overview, roster, donations, Discord");
await home(moose);
await openPanel(moose, /^Management/);
await moose.getByText(/what needs my attention/).waitFor();
for (const label of ["On stage now", "Uncovered shifts", "Trials waiting", "Sanctuary Rocks donations", "Maphra donations", "Staff activity", "Voting", "Policy decisions", "System status"]) check(`overview: ${label}`, await moose.getByRole("heading", { name: new RegExp(label) }).first().isVisible());
await moose.waitForTimeout(500);
await moose.screenshot({ path: `${DIR}overview.png`, fullPage: true });
const ov = (await apiGet(moose, "overview")).body;
check("overview reports the Discord mode", ["live", "dry-run"].includes(ov.system.discord_mode));
await moose.getByRole("button", { name: "Staff Roster" }).click();
await moose.getByText("TEST DJ").first().waitFor();
check("the roster shows no recovery codes or secrets", !/code_hash|token/.test(JSON.stringify((await apiGet(moose, "roster")).body)));

await moose.getByRole("button", { name: "Donation Reports" }).click();
await moose.getByLabel("Amount (L$)").fill("250");
await moose.getByLabel("Transaction reference").fill(`E2E-${Date.now()}`);
await moose.getByRole("button", { name: "Record" }).click();
await moose.getByRole("cell", { name: "Manual entry" }).waitFor();
const dn = (await apiGet(moose, "donations")).body.rows;
check("a reconciled donation lands in the right fund only", dn[0].fund === "sr" && dn[0].amount_l === 250);
const ov2 = (await apiGet(moose, "overview")).body.donations;
check("SR and Maphra totals stay separate", ov2.sr.total === 250 && ov2.maphra.total === 0);

await moose.getByRole("button", { name: "Discord & System" }).click();
await moose.getByRole("heading", { name: "Preview" }).waitFor();
check("the live-on-stage preview renders", await moose.getByText("SANCTUARY ROCKS — LIVE ON STAGE").isVisible());
await moose.getByRole("button", { name: "Check now" }).click();
await moose.waitForTimeout(1200);
const dd = (await apiGet(moose, "discord")).body;
check("webhooks are held as secrets, and channel messages are off", dd.secrets.staff_webhook && dd.secrets.vip_webhook && dd.dests.every((x) => x.transport === "off"));
check("no status message was posted to either Discord", dd.dests.length === 2 && dd.dests.every((x) => !x.message_id));
check("both communities point at their own channel", new Set(dd.dests.map((x) => x.channel_id)).size === 2);
check("no webhook or token is ever returned", !/discord\.com\/api\/webhooks|Bot /.test(JSON.stringify(dd)));
await moose.screenshot({ path: `${DIR}discord.png`, fullPage: true });

console.log("== Calendar names");
await home(dj);
await openPanel(dj, /^My Schedule/);
await dj.getByLabel(/My name on the calendar/).fill("DJ Test Name");
await dj.getByRole("button", { name: "Save calendar name" }).click();
await dj.getByText(/match the name .DJ Test Name./).waitFor();
check("a staff member can save their calendar name", (await apiGet(dj, "me")).body.user.calendar_name === "DJ Test Name");
await mgr.goto(PAGE + "#management", { waitUntil: "networkidle" });
await mgr.reload({ waitUntil: "networkidle" });
await mgr.getByRole("button", { name: "Staff Roster" }).click();
await mgr.getByLabel("Calendar name").first().waitFor();
check("management can see calendar names in the roster", (await mgr.getByLabel("Calendar name").count()) >= 2);

console.log("== Moose's edit spots and club links");
await moose.goto(PAGE + "#manual:ch2", { waitUntil: "networkidle" });
await moose.reload({ waitUntil: "networkidle" });
await moose.locator("details.policy summary", { hasText: policyTitle }).click();
await moose.getByRole("link", { name: /Edit this section/ }).click();
await moose.getByRole("textbox", { name: "Policy text" }).waitFor();
check("the book's Edit link opens that section in the editor", (await moose.getByRole("textbox", { name: "Policy text" }).innerText()).length > 50);
await moose.getByRole("link", { name: "See it in the book" }).click();
await moose.locator(".book").waitFor();
check("and the editor links back to the book", await moose.getByRole("heading", { name: "THE CREW CODE" }).isVisible());
await dj.goto(PAGE + "#manual:ch2", { waitUntil: "networkidle" });
await dj.reload({ waitUntil: "networkidle" });
await dj.locator("details.policy summary", { hasText: policyTitle }).click();
check("a DJ gets no Edit link", (await dj.getByRole("link", { name: /Edit this section/ }).count()) === 0);
await dj.goto(PAGE + "#manual:links", { waitUntil: "networkidle" });
await dj.reload({ waitUntil: "networkidle" });
check("the VIP Discord link is in the book", (await dj.getByRole("link", { name: "VIP Discord" }).getAttribute("href")).startsWith("https://discord.gg/"));
await home(moose);

console.log("\n== Phone layout");
const phone = { width: 390, height: 844 };
const { page: ph } = await session("TEST Phone", phone);
const noScroll = () => ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
await ph.waitForTimeout(800);
await ph.screenshot({ path: `${DIR}phone-ticket.png`, fullPage: true });
check("phone: no sideways scrolling on the ticket", await noScroll());
const panels = ph.getByRole("button", { name: /^My Schedule/ });
check("phone: the cropped panels are the tappable ones", await panels.last().isVisible());
const sz = await panels.last().boundingBox();
check("phone: tap targets are big enough", sz.height >= 44 && sz.width >= 44, JSON.stringify(sz));
await ph.getByRole("button", { name: /^Roadie Manual/ }).last().click();
await ph.getByRole("button", { name: "Open Book ▶" }).click();
check("phone: the book shows one page at a time", (await ph.locator("section.sheet").count()) === 1);
await ph.waitForTimeout(700);
await ph.screenshot({ path: `${DIR}phone-book.png`, fullPage: true });
check("phone: no sideways scrolling in the book", await noScroll());
await ph.getByRole("button", { name: "Next ▶" }).click();
check("phone: page turn advances one page", (await ph.getByRole("heading", { name: "Choose your chapter" }).isVisible()));
await ph.goto(`${PAGE}#help`, { waitUntil: "networkidle" });
await ph.reload({ waitUntil: "networkidle" });
await ph.getByRole("heading", { name: "Report a problem or ask for help" }).waitFor();
check("phone: no sideways scrolling in Crew Help", await noScroll());

console.log("\n== Sign-out and session");
const beforeOut = (await apiGet(moose, "me")).status;
await moose.getByRole("button", { name: "Sign out" }).click();
await moose.getByRole("heading", { name: "Staff sign in" }).waitFor();
check("signing out ends the session", beforeOut === 200 && (await apiGet(moose, "me")).status === 401);
check("a used recovery code can't be used twice", await moose.evaluate(async (code) => (await fetch("/api/staff/auth/recovery", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) })).status === 401, codes["TEST Moose"]));

console.log(`\nBrowser errors: ${consoleErrors.length}`);
consoleErrors.slice(0, 20).forEach((e) => console.log("  " + e));
console.log(`\nRESULT: ${pass} passed, ${failed.length} failed`);
failed.forEach((f) => console.log("  - " + f));
await browser.close();
process.exit(failed.length ? 1 : 0);
