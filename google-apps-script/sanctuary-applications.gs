/**
 * SANCTUARY ROCKS - staff applications -> this private Google Sheet.
 *
 * The website's /join form posts to the site's own server (/api/apply), which
 * forwards each application here with a shared secret. This script only ever
 * ADDS rows: it has no doGet and returns no sheet data, so the web app URL
 * can't be used to read applications.
 *
 * SETUP (once, by the Sheet's owner):
 *   1. Create a Google Sheet (e.g. "Sanctuary Rocks Applications"). Keep it
 *      shared ONLY with management.
 *   2. In the Sheet: Extensions > Apps Script. Replace the code with this file
 *      and Save.
 *   3. Choose the function "setup" in the toolbar and click Run (allow the
 *      permissions). It makes the "Applications" tab, the column headers and
 *      the Status dropdown, and creates the shared secret.
 *      View > Logs (or Execution log) shows the secret: copy it.
 *   4. Deploy > New deployment > type "Web app":
 *        Execute as: Me
 *        Who has access: Anyone
 *      ("Anyone" is needed so the website's server can post without a Google
 *      login; the secret is what keeps everyone else out.)
 *      Copy the Web app URL (ends in /exec).
 *   5. Give both to the applications relay Worker (workers/applications in the
 *      website repo), from that folder:
 *        npx wrangler secret put APPLICATIONS_SCRIPT_URL   (paste the /exec URL)
 *        npx wrangler secret put APPLICATIONS_SECRET       (paste the secret from step 3)
 *      The website itself needs no secrets.
 *
 * Changing the script later: Deploy > Manage deployments > edit > Version:
 * "New version", so the same URL keeps working.
 * New secret: run rotateSecret, then put the new APPLICATIONS_SECRET into the Worker.
 */

const SHEET_NAME = "Applications";
const HEADERS = [
  "Date Submitted",
  "Second Life Name",
  "Display Name",
  "Discord Name",
  "Position",
  "Previous Experience",
  "Position Experience",
  "Availability",
  "Music Type",
  "Why Sanctuary Rocks",
  "Currently Works at Another Club",
  "Additional Information",
  "Status",
  "Management Notes",
  "Submission ID", // hidden; lets a retried submission be recognised instead of added twice
];
const STATUS_COL = 13;
const ID_COL = 15;
const STATUSES = ["New", "Reviewing", "Contacted", "Interview", "Accepted", "Declined"];

function setup() {
  const sheet = getSheet_();
  sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
  sheet.setFrozenRows(1);
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build();
  sheet.getRange(2, STATUS_COL, sheet.getMaxRows() - 1, 1).setDataValidation(rule);
  sheet.getRange(2, 1, sheet.getMaxRows() - 1, 1).setNumberFormat("yyyy-mm-dd hh:mm");
  sheet.getRange(1, 1, sheet.getMaxRows(), HEADERS.length).setWrap(true).setVerticalAlignment("top");
  sheet.hideColumns(ID_COL);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("APPLICATIONS_SECRET")) props.setProperty("APPLICATIONS_SECRET", newSecret_());
  Logger.log("APPLICATIONS_SECRET = " + props.getProperty("APPLICATIONS_SECRET"));
}

function rotateSecret() {
  PropertiesService.getScriptProperties().setProperty("APPLICATIONS_SECRET", newSecret_());
  Logger.log("New APPLICATIONS_SECRET = " + PropertiesService.getScriptProperties().getProperty("APPLICATIONS_SECRET"));
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ ok: false, error: "bad_request" });
  }
  const secret = PropertiesService.getScriptProperties().getProperty("APPLICATIONS_SECRET");
  if (!secret || !data || data.secret !== secret) return out_({ ok: false, error: "unauthorized" });

  const a = data.application || {};
  const id = String(data.submissionId || "").slice(0, 64);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getSheet_();
    if (id && isDuplicate_(sheet, id)) return out_({ ok: true, duplicate: true });
    const row = [
      new Date(),
      safe_(a.secondLifeName),
      safe_(a.displayName),
      safe_(a.discordName),
      safe_(a.position),
      safe_(a.previousExperience),
      safe_(a.positionExperience),
      safe_(a.availability),
      safe_(a.musicType),
      safe_(a.whyJoin),
      safe_(a.otherClub),
      safe_(a.additionalInfo),
      "New",
      "",
      id,
    ];
    const at = sheet.getLastRow() + 1;
    sheet.getRange(at, 1, 1, row.length).setValues([row]);
    // Rows past the ones setup() prepared still get the Status dropdown.
    if (!sheet.getRange(at, STATUS_COL).getDataValidation()) {
      sheet.getRange(at, STATUS_COL).setDataValidation(
        SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).setAllowInvalid(false).build()
      );
    }
    return out_({ ok: true });
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function isDuplicate_(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return false;
  const n = Math.min(500, last - 1);
  const ids = sheet.getRange(last - n + 1, ID_COL, n, 1).getValues();
  return ids.some((r) => r[0] === id);
}

// Text only: a typed answer starting with = + - @ would otherwise run as a
// spreadsheet formula, so it gets a leading apostrophe (shown as plain text).
function safe_(value) {
  let s = String(value == null ? "" : value).slice(0, 5000);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function newSecret_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, "");
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
