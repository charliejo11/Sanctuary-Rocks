/**
 * SANCTUARY ROCKS - workbook inspection for the Auto Clerk.   READ ONLY: it changes nothing.
 *
 * It lists the structure of this workbook so the Auto Clerk tabs can be added without disturbing anything:
 * every tab (name, id, size, hidden, frozen rows), its HEADER ROW only, how many formulas / dropdowns / conditional
 * formats it has, filters, protected ranges, named ranges, charts, and the automatic triggers of this workbook's
 * script project (names only). No cell data beyond row 1 is read out.
 *
 * HOW TO RUN (by the workbook's owner):
 *   1. In the workbook: Extensions > Apps Script.
 *   2. Add a new file (+ > Script), name it "SR Inspect", paste this file in, Save.
 *   3. Choose "inspectWorkbook" in the toolbar and click Run. Allow the permissions it asks for (read this spreadsheet).
 *   4. Open "Execution log" at the bottom, select all the text and paste it to Claude.
 *   5. Afterwards you can delete the "SR Inspect" file again.
 */
function inspectWorkbook() {
  var ss = SpreadsheetApp.getActive();
  var report = {
    name: ss.getName(), id: ss.getId(), timezone: ss.getSpreadsheetTimeZone(), locale: ss.getSpreadsheetLocale(),
    named_ranges: ss.getNamedRanges().map(function (n) { return n.getName() + " = " + n.getRange().getSheet().getName() + "!" + n.getRange().getA1Notation(); }),
    // automations already in this workbook's script project (they might react to new tabs): names and kinds only
    triggers: ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction() + " (" + t.getEventType() + ")"; }),
    sheets: []
  };
  ss.getSheets().forEach(function (sh) {
    var lastRow = sh.getLastRow(), lastCol = Math.min(sh.getLastColumn(), 40);
    var header = lastCol ? sh.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function (v) { return String(v).slice(0, 40); }) : [];
    var sampleRows = Math.min(Math.max(lastRow, 1), 300);
    var formulas = 0, validations = 0;
    if (lastCol) {
      sh.getRange(1, 1, sampleRows, lastCol).getFormulas().forEach(function (r) { r.forEach(function (f) { if (f) formulas++; }); });
      sh.getRange(1, 1, sampleRows, lastCol).getDataValidations().forEach(function (r) { r.forEach(function (v) { if (v) validations++; }); });
    }
    var protections = sh.getProtections(SpreadsheetApp.ProtectionType.RANGE).concat(sh.getProtections(SpreadsheetApp.ProtectionType.SHEET));
    report.sheets.push({
      name: sh.getName(), gid: sh.getSheetId(), index: sh.getIndex(), hidden: sh.isSheetHidden(),
      rows_used: lastRow, cols_used: sh.getLastColumn(), frozen_rows: sh.getFrozenRows(), frozen_cols: sh.getFrozenColumns(),
      header_row: header,
      formulas_in_first_300_rows: formulas, dropdown_cells_in_first_300_rows: validations,
      conditional_format_rules: sh.getConditionalFormatRules().length,
      has_filter: !!sh.getFilter(), charts: sh.getCharts().length,
      protected: protections.map(function (p) {
        return { what: p.getProtectionType() == SpreadsheetApp.ProtectionType.SHEET ? "whole tab" : p.getRange().getA1Notation(),
          description: p.getDescription(), warning_only: p.isWarningOnly() };
      })
    });
  });
  var text = JSON.stringify(report, null, 1);
  // the execution log cuts very long lines, so it goes out in pieces
  for (var i = 0; i < text.length; i += 4000) console.log(text.slice(i, i + 4000));
  return report;
}
