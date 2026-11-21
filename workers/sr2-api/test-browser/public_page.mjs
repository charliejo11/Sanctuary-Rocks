// Screenshots + basic checks of the PUBLIC Backstage Pass page on staging (desktop + phone). Read-only: casts no votes.
// Run: node test-browser/public_page.mjs [site]   (needs playwright-core and Edge, like e2e.mjs)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const SITE = process.argv[2] ?? "https://sanctuary-rocks-staging.elfavina89.workers.dev";
const DIR = new URL("./shots/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
mkdirSync(DIR, { recursive: true });

let pass = 0;
const failed = [];
const check = (name, ok, extra = "") => {
  if (ok) { pass++; console.log(`  ok   ${name}`); } else { failed.push(name); console.log(`  FAIL ${name} ${extra}`); }
};

const browser = await chromium.launch({ channel: "msedge", headless: true });
for (const [label, viewport] of [["desktop", { width: 1400, height: 950 }], ["phone", { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport, reducedMotion: label === "phone" ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${SITE}/backstage-pass`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  console.log(`-- ${label}`);
  check(`${label}: Now Playing heading`, await page.getByRole("heading", { name: /Live on Stage/i }).isVisible());
  check(`${label}: four labelled reactions`, (await page.locator('section[aria-labelledby=now-playing-title] button[aria-pressed]').count()) === 4);
  check(`${label}: Top Song of the Week card`, await page.getByRole("heading", { name: "Top Song of the Week" }).isVisible());
  check(`${label}: Biggest Climber gone`, (await page.getByText("Biggest Climber").count()) === 0);
  check(`${label}: Top 10 section`, await page.locator("#top10").isVisible());
  check(`${label}: Monthly Top 20 section below Top 10`, await page.evaluate(() => {
    const a = document.getElementById("top10"), b = document.getElementById("top20");
    return !!a && !!b && a.getBoundingClientRect().top < b.getBoundingClientRect().top;
  }));
  const heads = await page.$$eval("#top10 thead th", (ths) => ths.filter((th) => getComputedStyle(th).display !== "none").map((th) => th.innerText.trim()));
  if (heads.length) check(`${label}: Top 10 columns`, heads.join("|").toUpperCase() === (label === "phone" ? "RANK|SONG|PLAYS|LW|TREND|LIKES" : "RANK|SONG|ARTIST|PLAYS|LAST WEEK|TREND|LIKES"), heads.join("|"));
  check(`${label}: Chronicles featured story links to Loudwire`, /^https:\/\/(www\.)?loudwire\.com\//.test((await page.locator("#chronicles a[target=_blank]").first().getAttribute("href")) ?? ""));
  check(`${label}: Song of the Day shows four reactions`, (await page.locator("#song-of-the-day [aria-pressed]").count()) === 4);
  check(`${label}: Battle shows two vote buttons`, (await page.locator("#battle-of-the-bands button[aria-pressed]").count()) === 2);
  check(`${label}: VIP of the Month section`, await page.locator("#vip-of-the-month").isVisible());
  check(`${label}: Did You Know fact`, ((await page.locator("#did-you-know p").last().innerText()) ?? "").length > 20);
  for (const id of ["vip-of-the-month", "chronicles", "song-of-the-day", "battle-of-the-bands", "did-you-know"]) {
    await page.locator("#" + id).scrollIntoViewIfNeeded();
    await page.locator("#" + id).screenshot({ path: `${DIR}public_${label}_${id}.png` });
  }
  check(`${label}: no horizontal page scroll`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  check(`${label}: no console errors`, errors.length === 0, errors.slice(0, 3).join(" / "));
  await page.screenshot({ path: `${DIR}public_${label}_top.png` });
  await page.locator("#top10").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${DIR}public_${label}_charts.png` });
  await page.screenshot({ path: `${DIR}public_${label}_full.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
console.log(`\n${pass} passed, ${failed.length} failed${failed.length ? ": " + failed.join("; ") : ""}`);
process.exit(failed.length ? 1 : 0);
