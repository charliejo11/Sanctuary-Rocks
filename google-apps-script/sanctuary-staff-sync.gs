/**
 * SANCTUARY ROCKS - staff activity -> this private Google Sheet.
 *
 * The SR2 backend posts finished DJ sets, host and manager shifts and confirmed donations here once an hour. The backend
 * stays the one authoritative record of who is on now; this Sheet is a copy for reading. It only ever ADDS rows: it has no
 * doGet and returns no sheet data, so the web app URL can't be used to read anything. A row that arrives twice is ignored.
 *
 * SETUP (once, by the Sheet's owner):
 *   1. Create a Google Sheet (e.g. "Sanctuary Rocks Staff Activity"). Share it ONLY with management.
 *   2. Extensions > Apps Script. Replace the code with this file and Save.
 *   3. Choose "setup" in the toolbar and click Run (allow the permissions). The execution log shows the secret: copy it.
 *   4. Deploy > New deployment > Web app. Execute as: Me. Who has access: Anyone. Copy the URL (ends in /exec).
 *      ("Anyone" lets the backend post without a Google login; the secret keeps everyone else out.)
 *   5. From workers/sr2-api in the website repo:
 *        npx wrangler secret put SHEETS_SYNC_URL --env <staging or production> -c wrangler.toml
 *        npx wrangler secret put SHEETS_SYNC_SECRET --env <staging or production> -c wrangler.toml
 */
var TAB = "Activity";
var HEADERS = ["Type", "Who", "Started", "Finished", "Detail", "Key"];

function setup() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(TAB) || SpreadsheetApp.getActive().insertSheet(TAB);
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  sheet.setFrozenRows(1);
  sheet.hideColumns(HEADERS.length);
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty("SECRET")) props.setProperty("SECRET", Utilities.getUuid() + Utilities.getUuid());
  Logger.log("Secret: " + props.getProperty("SECRET"));
}

function doPost(e) {
  var out = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: "bad_json" }); }
  if (!body.secret || body.secret !== PropertiesService.getScriptProperties().getProperty("SECRET")) return out({ ok: false, error: "forbidden" });
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = SpreadsheetApp.getActive().getSheetByName(TAB);
    var last = sheet.getLastRow();
    var seen = {};
    if (last > 1) sheet.getRange(2, HEADERS.length, last - 1, 1).getValues().forEach(function (r) { seen[r[0]] = true; });
    var added = 0;
    (body.rows || []).forEach(function (r) {
      var key = [r.type, r.who, r.start, r.finish].join("|");
      if (seen[key]) return;
      seen[key] = true;
      // a leading ' stops Sheets treating a name or note as a formula
      sheet.appendRow([r.type, "'" + r.who, new Date(r.start), r.finish ? new Date(r.finish) : "", "'" + (r.detail || ""), key]);
      added++;
    });
    return out({ ok: true, added: added });
  } finally {
    lock.releaseLock();
  }
}
