// The Auto Clerk's Apps Script (google-apps-script/sanctuary-auto-clerk.gs), run against a simulated sheet: the club
// system's mirror never overwrites management's columns, a newer "Pending" request survives a refresh, and both sides
// agree on what a request is.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { requestSig } from "../src/staff/clerk.js";

const code = readFileSync(new URL("../../../google-apps-script/sanctuary-auto-clerk.gs", import.meta.url), "utf8");
const gs = {};
vm.runInNewContext(code + "\nthis.api = { writeSchedule_, readPending_, upsert_, sig_, TABS };", gs);
const { writeSchedule_, upsert_, sig_, TABS } = gs.api;
const readPending_ = (sh) => JSON.parse(JSON.stringify(gs.api.readPending_(sh)));   // plain arrays from the script's sandbox

// a tiny stand-in for a Google Sheets tab: a grid of strings, row 1 = headers
function fakeSheet(headers) {
  const grid = [headers.slice()];
  const range = (r, c, nr, nc) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => grid[r - 1 + i]?.[c - 1 + j] ?? "")),
    getDisplayValues() { return this.getValues(); },
    setValues(vals) { vals.forEach((row, i) => { grid[r - 1 + i] ??= []; row.forEach((v, j) => { grid[r - 1 + i][c - 1 + j] = v; }); }); return this; },
    setNumberFormat() { return this; },
  });
  return { grid, getRange: range, getLastRow: () => grid.reduce((n, row, i) => (row.some((v) => String(v ?? "") !== "") ? i + 1 : n), 0) };
}
const row = (id, status, answer = "", sig = "") => [id, "Sat Nov 7, 8:00 PM - 10:00 PM SLT", "Sat, Nov 7, 2026", "8:00 PM", "10:00 PM", "DJ", "Rock Night",
  "DJ Raven", "Raven", status, "", "", "2026-11-08T04:00:00Z", "2026-11-08T06:00:00Z", "2026-11-05T12:00:00Z", answer, sig];

test("upsert: rows are updated by id and new ones appended, as text", () => {
  const sh = fakeSheet(TABS.callouts.headers);
  upsert_(sh, [["1", "S1", "x"], ["2", "S2", "y"]], 12);
  upsert_(sh, [["2", "S2", "changed"], ["3", "S3", "z"]], 12);
  assert.deepEqual(sh.grid.slice(1).map((r) => [r[0], r[2]]), [["1", "x"], ["2", "changed"], ["3", "z"]]);
});

test("SR Schedule: management's columns are never written; a newer Pending request survives the refresh", () => {
  const sh = fakeSheet(TABS.schedule.headers);
  writeSchedule_(sh, [row("S1", "Needs Cover"), row("S2", "Needs Cover")]);
  // management asks something on both rows (the edit trigger marks them Pending)
  sh.grid[1].splice(15, 4, "Assign cover", "Blaze", "Blaze offered", "Pending - moose@example.com, Nov 5, 9:00 AM SLT");
  sh.grid[2].splice(15, 4, "Assign cover", "Kai", "Kai is free", "Pending - moose@example.com, Nov 5, 9:01 AM SLT");
  const pending = readPending_(sh);
  assert.deepEqual(pending.map((p) => [p.shift_id, p.assign_to, p.requested_by]), [["S1", "Blaze", "moose@example.com"], ["S2", "Kai", "moose@example.com"]]);
  // the club system answered S1's request (same cells) and an OLDER request on S2 (different cells)
  writeSchedule_(sh, [row("S1", "Covered", "Applied Nov 5: Blaze assigned", requestSig("Assign cover", "Blaze", "Blaze offered")),
    row("S2", "Needs Cover", "Applied Nov 4: Luna assigned", requestSig("Assign cover", "Luna", "earlier"))]);
  assert.equal(sh.grid[1][9], "Covered");
  assert.equal(sh.grid[1][18], "Applied Nov 5: Blaze assigned");
  assert.match(sh.grid[2][18], /^Pending/);                                         // S2's newer request is still waiting
  assert.deepEqual(sh.grid[1].slice(15, 18), ["Assign cover", "Blaze", "Blaze offered"]);   // never overwritten
  assert.deepEqual(readPending_(sh).map((p) => p.shift_id), ["S2"]);
});

test("both sides describe a request the same way, whatever the spacing or capitals", () => {
  assert.equal(sig_("  assign COVER ", "blaze ", "Blaze  offered"), requestSig("Assign cover", "Blaze", "Blaze offered"));
  assert.notEqual(sig_("Assign cover", "Blaze", "reason A"), requestSig("Assign cover", "Blaze", "reason B"));
});
