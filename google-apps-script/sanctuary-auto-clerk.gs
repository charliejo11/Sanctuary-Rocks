/**
 * SANCTUARY ROCKS - AUTO CLERK tabs in the "Sanctuary Rocks Applications" workbook.
 *
 * A SEPARATE Apps Script project. It never touches the Applications tab or the applications script (Code.gs / doPost in
 * the workbook's own project). It only adds six tabs at the end of the workbook and keeps them up to date:
 *
 *   SR Schedule          every DJ / Host shift (from the club Google Calendar) and who is on it now
 *   SR Callouts          staff who can't make their shift
 *   SR Cover Requests    open and claimed covers
 *   SR Schedule Changes  Calendar edits, replacements, swaps and management overrides
 *   SR Staff Registry    names, roles, Discord ids, Second Life keys (copied from Backstage Pass accounts)
 *   SR Auto Clerk Log    every action
 *
 * The club system (SR2 backend, Cloudflare D1) is the record. These tabs are its mirror and are locked to the workbook's
 * owner, EXCEPT three columns in SR Schedule where management asks for a cover decision:
 *   Manager Action  (Assign cover | Cancel callout),  Assign To  (a Staff Registry name),  Reason.
 * Editing them marks the row "Pending"; the club system checks it (within 5 minutes) and writes "Applied ..." or
 * "Rejected: <why>" in Change Status. Shifts themselves are still added, moved and re-staffed in the Google Calendar.
 *
 * Shift times are shown in Second Life Time (SLT). Exact times are UTC text (2026-11-07T04:00:00Z). The workbook keeps its
 * own (Eastern) time zone: everything here is written as plain text, so that setting changes nothing.
 *
 * SETUP (once, by the workbook's owner; do it first on the STAGING copy):
 *   1. Go to https://script.google.com > New project. Rename it "SR Auto Clerk".
 *   2. Replace the code in Code.gs with this file. Put the workbook's id in SPREADSHEET_ID below
 *      (the long id in the workbook's address, between /d/ and /edit). Save.
 *   3. Choose "setup" and click Run. Allow the permissions (this spreadsheet, and running when it is edited).
 *      The Execution log lists the tabs it created and shows the secret: copy the secret.
 *   4. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the Web app URL (ends in /exec).
 *      ("Anyone" lets the club system reach it without a Google login; the secret keeps everyone else out.)
 *   5. In the website repo, from workers/sr2-api, type the two values at the prompts (never paste them in a chat):
 *        npx wrangler secret put SCHEDULE_SYNC_URL    --env staging -c wrangler.toml
 *        npx wrangler secret put SCHEDULE_SYNC_SECRET --env staging -c wrangler.toml
 */
var SPREADSHEET_ID = "PASTE-THE-WORKBOOK-ID-HERE";

var TABS = {
  registry: { name: "SR Staff Registry", widths: [70, 160, 160, 160, 170, 150, 270, 100, 70, 170],
    headers: ["Staff ID", "Name", "Calendar Name", "Roles", "Discord ID", "Discord Name", "SL UUID", "Avatar Linked", "Active", "Updated (UTC)"] },
  schedule: { name: "SR Schedule", widths: [150, 230, 130, 80, 80, 60, 180, 150, 150, 130, 270, 170, 170, 170, 170, 130, 150, 220, 320],
    headers: ["Shift ID", "When (SLT)", "Date (SLT)", "Start (SLT)", "End (SLT)", "Role", "Event", "Scheduled (Calendar)", "On Shift Now", "Status",
      "SL UUID (on shift)", "Discord ID (on shift)", "Start (UTC)", "End (UTC)", "Last Sync (UTC)", "Manager Action", "Assign To", "Reason", "Change Status"] },
  callouts: { name: "SR Callouts", widths: [80, 150, 230, 60, 150, 170, 270, 260, 170, 190, 120, 110],
    headers: ["Callout ID", "Shift ID", "Shift (SLT)", "Role", "Called Out By", "Discord ID", "SL UUID", "Reason", "Called Out (UTC)", "Called Out (SLT)", "Via", "Cover Status"] },
  covers: { name: "SR Cover Requests", widths: [80, 150, 230, 60, 150, 110, 70, 150, 170, 170, 120, 90, 170],
    headers: ["Cover ID", "Shift ID", "Shift (SLT)", "Role", "Original Staff", "Status", "Urgent", "Covered By", "Covered By Discord ID", "Claimed (UTC)", "Claimed Via", "Reminders Sent", "Opened (UTC)"] },
  changes: { name: "SR Schedule Changes", widths: [80, 170, 190, 150, 230, 190, 150, 150, 170, 110, 320],
    headers: ["Change ID", "When (UTC)", "When (SLT)", "Shift ID", "Shift (SLT)", "Change", "From", "To", "Changed By", "Via", "Detail"] },
  log: { name: "SR Auto Clerk Log", widths: [70, 170, 190, 120, 150, 70, 170, 170, 270, 150, 150, 110, 100, 320],
    headers: ["Log ID", "When (UTC)", "When (SLT)", "Action", "Shift ID", "Cover ID", "By", "By Discord ID", "By SL UUID", "From", "To", "Via", "Status", "Detail"] }
};
var ORDER = ["registry", "schedule", "callouts", "covers", "changes", "log"];   // the registry first: SR Schedule's Assign To list reads it
var SCHEDULE_SERVICE_COLS = 15;   // A..O are written by the club system
var COL_ACTION = 16, COL_ASSIGN = 17, COL_REASON = 18, COL_RESULT = 19;   // P, Q, R (management) and S (Change Status)

function book_() {
  if (SPREADSHEET_ID.indexOf("PASTE") === 0) throw new Error("Put the workbook's id in SPREADSHEET_ID first.");
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/** Creates the six tabs that don't exist yet (at the end), the secret and the edit trigger. Changes nothing else. */
function setup() {
  var ss = book_();
  var created = [], kept = [], blocked = [];
  ORDER.forEach(function (key) {
    var t = TABS[key];
    var sh = ss.getSheetByName(t.name);
    if (sh) {
      if (headersMatch_(sh, t)) kept.push(t.name);
      else blocked.push(t.name);                     // someone else's tab with this name: never written to
      return;
    }
    sh = ss.insertSheet(t.name, ss.getNumSheets());  // after every existing tab: nothing else moves
    build_(ss, sh, t, key);
    created.push(t.name);
  });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("SECRET")) props.setProperty("SECRET", Utilities.getUuid() + Utilities.getUuid());
  if (!ScriptApp.getProjectTriggers().some(function (tr) { return tr.getHandlerFunction() === "onScheduleEdit"; }))
    ScriptApp.newTrigger("onScheduleEdit").forSpreadsheet(ss).onEdit().create();
  Logger.log("Created: " + (created.join(", ") || "none"));
  Logger.log("Already there (kept as they are): " + (kept.join(", ") || "none"));
  if (blocked.length) Logger.log("NOT USED - a tab with this name exists but isn't an Auto Clerk tab: " + blocked.join(", ") + ". Rename it or tell Claude.");
  Logger.log("Secret: " + props.getProperty("SECRET"));
}

function headersMatch_(sh, t) {
  var row = sh.getRange(1, 1, 1, t.headers.length).getDisplayValues()[0];
  return row.join("|") === t.headers.join("|");
}

function build_(ss, sh, t, key) {
  var n = t.headers.length;
  if (sh.getMaxColumns() > n) sh.deleteColumns(n + 1, sh.getMaxColumns() - n);
  sh.getRange(1, 1, 1, n).setValues([t.headers]).setFontWeight("bold").setBackground("#2b0d0d").setFontColor("#ffffff").setWrap(true);
  sh.setFrozenRows(1);
  t.widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  var body = sh.getRange(2, 1, sh.getMaxRows() - 1, n);
  body.setNumberFormat("@").setBackground("#f3f3f3");                 // grey = written by the club system
  sh.getRange(1, 1, sh.getMaxRows(), n).createFilter();
  var rules = [];
  if (key === "schedule") {
    sh.getRange(2, COL_ACTION, sh.getMaxRows() - 1, 3).setBackground("#ffffff");   // white = management
    sh.getRange(2, COL_ACTION, sh.getMaxRows() - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(["Assign cover", "Cancel callout"], true).setAllowInvalid(false).build());
    var registry = ss.getSheetByName(TABS.registry.name);
    if (registry) sh.getRange(2, COL_ASSIGN, sh.getMaxRows() - 1, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInRange(registry.getRange("B2:B"), true).setAllowInvalid(false).build());
    var status = sh.getRange(2, 10, sh.getMaxRows() - 1, 1), result = sh.getRange(2, COL_RESULT, sh.getMaxRows() - 1, 1);
    rules.push(textRule_(status, "Needs Cover", "#ffe0a3"), textRule_(status, "UNCOVERED", "#f4a6a6"), textRule_(status, "Covered", "#c8ecc4"),
      textRule_(status, "Unassigned", "#ffd8b5"), textRule_(status, "Name not recognised", "#ffd8b5"), textRule_(status, "Cancelled", "#dddddd"),
      startsRule_(result, "Pending", "#cfe2ff"), startsRule_(result, "Rejected", "#f4a6a6"), startsRule_(result, "Applied", "#c8ecc4"));
  }
  if (key === "covers" || key === "callouts") {
    var col = key === "covers" ? 6 : 12;
    var st = sh.getRange(2, col, sh.getMaxRows() - 1, 1);
    rules.push(textRule_(st, "Open", "#ffe0a3"), textRule_(st, "UNCOVERED", "#f4a6a6"), textRule_(st, "Covered", "#c8ecc4"), textRule_(st, "Cancelled", "#dddddd"));
  }
  if (rules.length) sh.setConditionalFormatRules(rules);
  // locked to the owner (the club system writes as the owner); SR Schedule keeps its three management columns open
  var p = sh.protect().setDescription("Written by the Auto Clerk - change shifts in the club Google Calendar");
  if (key === "schedule") p.setUnprotectedRanges([sh.getRange(2, COL_ACTION, sh.getMaxRows() - 1, 3)]);
  p.removeEditors(p.getEditors());
  if (p.canDomainEdit()) p.setDomainEdit(false);
}
function textRule_(range, text, colour) { return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(colour).setRanges([range]).build(); }
function startsRule_(range, text, colour) { return SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith(text).setBackground(colour).setRanges([range]).build(); }

/** Management edited Manager Action / Assign To / Reason: show "Pending" until the club system has checked it. */
function onScheduleEdit(e) {
  var sh = e.range.getSheet();
  if (sh.getName() !== TABS.schedule.name || e.range.getRow() < 2) return;
  var c1 = e.range.getColumn(), c2 = c1 + e.range.getNumColumns() - 1;
  if (c2 < COL_ACTION || c1 > COL_REASON) return;
  var who = "";
  try { who = e.user && e.user.getEmail ? e.user.getEmail() : ""; } catch (err) { who = ""; }
  var stamp = Utilities.formatDate(new Date(), "America/Los_Angeles", "MMM d, h:mm a") + " SLT";
  for (var r = e.range.getRow(); r < e.range.getRow() + e.range.getNumRows(); r++) {
    var action = String(sh.getRange(r, COL_ACTION).getValue()).trim();
    sh.getRange(r, COL_RESULT).setValue(action ? "Pending - " + (who || "management") + ", " + stamp : "");
  }
}

// ------------------------------------------------------------------ the club system's calls
function norm_(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
function sig_(action, assignTo, reason) { return JSON.stringify([norm_(action).slice(0, 40).toLowerCase(), norm_(assignTo).slice(0, 80).toLowerCase(), norm_(reason).slice(0, 300)]); }

function doPost(e) {
  var out = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: "bad_json" }); }
  if (!body.secret || body.secret !== PropertiesService.getScriptProperties().getProperty("SECRET")) return out({ ok: false, error: "forbidden" });
  if (body.action !== "sync") return out({ ok: false, error: "unknown action" });
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var ss = book_();
    var sheets = {};
    for (var i = 0; i < ORDER.length; i++) {
      var t = TABS[ORDER[i]], sh = ss.getSheetByName(t.name);
      if (!sh) return out({ ok: false, error: "missing tab " + t.name + " - run setup" });
      if (!headersMatch_(sh, t)) return out({ ok: false, error: "the tab " + t.name + " isn't an Auto Clerk tab - not written" });
      sheets[ORDER[i]] = sh;
    }
    var pending = readPending_(sheets.schedule);                     // read management's requests BEFORE writing anything
    var tabs = body.tabs || {};
    if (tabs.registry) upsert_(sheets.registry, tabs.registry, TABS.registry.headers.length);
    if (tabs.schedule) writeSchedule_(sheets.schedule, tabs.schedule);
    if (tabs.callouts) upsert_(sheets.callouts, tabs.callouts, TABS.callouts.headers.length);
    if (tabs.covers) upsert_(sheets.covers, tabs.covers, TABS.covers.headers.length);
    if (tabs.changes) upsert_(sheets.changes, tabs.changes, TABS.changes.headers.length);
    if (tabs.log) upsert_(sheets.log, tabs.log, TABS.log.headers.length);
    var purged = purgeTest_(sheets, tabs);
    return out({ ok: true, pending: pending, purged: purged, stats: stats_(sheets) });
  } finally {
    lock.releaseLock();
  }
}

/** Rows where management asked for something that hasn't been answered yet. */
function readPending_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var v = sh.getRange(2, 1, last - 1, COL_RESULT).getDisplayValues();
  var out = [];
  v.forEach(function (r) {
    var action = norm_(r[COL_ACTION - 1]);
    if (!action || /^(Applied|Rejected)/.test(r[COL_RESULT - 1])) return;
    var m = String(r[COL_RESULT - 1]).match(/^Pending - ([^,]+), (.+)$/);
    out.push({ shift_id: r[0], action: action, assign_to: norm_(r[COL_ASSIGN - 1]), reason: norm_(r[COL_REASON - 1]),
      requested_by: m ? m[1] : "", requested_at: m ? m[2] : "" });
  });
  return out;
}

/**
 * Rows left by the club system's TEST checks, once the club system has removed them: shifts whose id starts with
 * "TEST-" (real shifts are "CAL-...") and Staff Registry rows named "TEST ..." whose account is gone. Nothing else is
 * ever deleted, and a TEST shift still in this sync's SR Schedule (a check in progress) is kept.
 */
function purgeTest_(sheets, tabs) {
  if (!tabs.schedule || !tabs.registry) return 0;
  var liveShift = {}, liveStaff = {}, removed = 0;
  tabs.schedule.forEach(function (r) { liveShift[String(r[0])] = true; });
  tabs.registry.forEach(function (r) { liveStaff[String(r[0])] = true; });
  var drop = function (sh, isOld) {
    var last = sh.getLastRow();
    if (last < 2) return;
    var v = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getDisplayValues();
    for (var i = v.length - 1; i >= 0; i--) if (isOld(v[i])) { sh.deleteRow(i + 2); removed++; }   // bottom up: rows above keep their place
  };
  var oldShift = function (col) { return function (r) { var id = String(r[col]); return id.indexOf("TEST-") === 0 && !liveShift[id]; }; };
  drop(sheets.schedule, oldShift(0));
  drop(sheets.callouts, oldShift(1));
  drop(sheets.covers, oldShift(1));
  drop(sheets.changes, oldShift(3));
  drop(sheets.log, oldShift(4));
  drop(sheets.registry, function (r) { return String(r[1]).indexOf("TEST ") === 0 && !liveStaff[String(r[0])]; });
  return removed;
}

/** Each tab's size after a sync, so the club system can check it without opening the workbook: rows, repeated ids, TEST rows. */
function stats_(sheets) {
  var out = {};
  ORDER.forEach(function (k) {
    var sh = sheets[k], last = sh.getLastRow(), ids = last > 1 ? sh.getRange(2, 1, last - 1, 1).getDisplayValues() : [];
    var seen = {}, dup = 0, test = 0;
    var shiftCol = { schedule: 0, callouts: 1, covers: 1, changes: 3, log: 4 }[k];
    var rows = shiftCol == null || last < 2 ? null : sh.getRange(2, shiftCol + 1, last - 1, 1).getDisplayValues();
    ids.forEach(function (r, i) {
      var id = String(r[0]);
      if (id && seen[id]) dup++;
      seen[id] = true;
      if (rows ? String(rows[i][0]).indexOf("TEST-") === 0 : false) test++;
    });
    out[k] = { rows: ids.length, duplicate_ids: dup, test_rows: test };
  });
  return out;
}

/** Updates rows by their first column (id) and appends new ones, in one write. Values are written as plain text. */
function upsert_(sh, rows, width) {
  var last = sh.getLastRow();
  var block = last > 1 ? sh.getRange(2, 1, last - 1, width).getValues() : [];
  var at = {};
  block.forEach(function (r, i) { at[String(r[0])] = i; });
  rows.forEach(function (r) {
    var v = r.slice(0, width).map(function (x) { return x == null ? "" : String(x); });
    while (v.length < width) v.push("");
    if (at.hasOwnProperty(v[0])) block[at[v[0]]] = v; else { at[v[0]] = block.length; block.push(v); }
  });
  if (block.length) sh.getRange(2, 1, block.length, width).setNumberFormat("@").setValues(block);
  return at;
}

/**
 * SR Schedule: columns A..O from the club system; Manager Action / Assign To / Reason (P..R) are never written here.
 * Change Status (S) gets the club system's answer, but a "Pending" mark is only replaced by the answer to THOSE cells.
 */
function writeSchedule_(sh, rows) {
  var at = upsert_(sh, rows.map(function (r) { return r.slice(0, SCHEDULE_SERVICE_COLS); }), SCHEDULE_SERVICE_COLS);
  var last = sh.getLastRow();
  if (last < 2) return;
  var mgmt = sh.getRange(2, COL_ACTION, last - 1, 4).getValues();     // P, Q, R, S
  var status = mgmt.map(function (r) { return [r[3]]; });
  rows.forEach(function (r) {
    var i = at[String(r[0])];
    if (i == null) return;
    var answer = r[15] == null ? "" : String(r[15]), answers = r[16] == null ? "" : String(r[16]);
    var current = String(mgmt[i][3]);
    if (/^Pending/.test(current) && answers !== sig_(mgmt[i][0], mgmt[i][1], mgmt[i][2])) return;   // a newer request is waiting
    status[i] = [answer];
  });
  sh.getRange(2, COL_RESULT, status.length, 1).setNumberFormat("@").setValues(status);
}
