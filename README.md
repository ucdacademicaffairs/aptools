The intention of these little tools is to (a) provide administrative staff working in the academic personnel and graduate education spaces with easily-referenced calculators to aid in faculty and student advising, while (b) also making the same tools those staff use accessible to faculty in a "non-actionable" form, so that they are able to play with live scenarios and to some extent self-advise. Check out the index for the latest. 

## Page files

Each page keeps its structure in HTML, its page styles in a matching CSS file,
and its interactive behavior in a matching JavaScript file:

- `index.html` and `index.css`. The index does not need JavaScript.
- `leavedates.html`, `leavedates.css`, and `leavedates.js`.
- `unpaidpartialpay.html`, `unpaidpartialpay.css`, and `unpaidpartialpay.js`.
- `entitlementcalculator.html`, `entitlementcalculator.css`, and `entitlementcalculator.js`.

### Entitlement PDF downloads

After calculating, **Download PDF** exports the visible entitlements in PDLL,
FMLA, CFRA, PFCB order. The PDF starts with **Leaves Entered**, including dates,
selected entitlements, and associated events from Leave Periods. Long leave lists
continue onto additional pages without splitting leave rows. The next page contains the two-column balances;
each selected entitlement's details begin on a new page and continue as needed.
Unselected entitlements remain excluded. Recalculate after editing inputs to
enable downloading again.

`entitlementcalculator-pdf.js` clones the existing rendered calculation snapshot;
it never recalculates values or changes the live cards. Exported copies include
collapsed event information and omit interactive controls.
`entitlementcalculator-print.css` reuses the page styles with a fixed desktop
balance layout and full printable-width details. The overview scales to fit one
page; exceptionally tall overviews therefore have smaller text. Details paginate
between records. PDF pages are high-resolution images of the styled HTML, so
their text is not selectable.

The PDF libraries load locally on the first download, with no external service
or upload: html2canvas 1.4.1 and jsPDF 4.2.1. Their bundled files and MIT licenses
are in `vendor/`. Verify the download and pagination helpers with:

```sh
node --test tests/entitlementcalculator-pdf.test.cjs
```

`site.css` contains the shared Academic Affairs branding, header, and footer.
Serve the pages over HTTP so the calculators can load their JSON date data.

## Updating calendar dates

Update **`calendar-dates.json`** to change dates for all leave tools. This is
the shared source for `QUARTER_DATES` and `SEMESTER_DATES`; do not add calendar
dates to the HTML, JavaScript, or `annual-config.json`.

Each named period has four dates, written as `YYYY-MM-DD`:

```json
"Fall 2026": {
  "serviceStart": "2026-09-21",
  "serviceEnd": "2026-12-11",
  "payStart": "2026-07-01",
  "payEnd": "2026-10-31"
}
```

Add or edit the entry under the appropriate calendar. All tools derive their
date limits and Base Dates & Definitions tables from this file. Periods display
in date order, regardless of their order in the JSON. Keep valid JSON syntax and
avoid overlapping service periods within the same calendar.

`annual-config.json` retains the separate salary, benefit, and rate settings.

Run calculation checks with:

```sh
node --test tests/unpaidpartialpay.test.cjs
```
