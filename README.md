The intention of these little tools is to (a) provide administrative staff working in the academic personnel and graduate education spaces with easily-referenced calculators to aid in faculty and student advising, while (b) also making the same tools those staff use accessible to faculty in a "non-actionable" form, so that they are able to play with live scenarios and to some extent self-advise. Check out the index for the latest. 

## Page files

Each page keeps its structure in HTML, its page styles in a matching CSS file,
and its interactive behavior in a matching JavaScript file:

- `index.html` and `index.css`. The index does not need JavaScript.
- `leavedates.html`, `leavedates.css`, and `leavedates.js`.
- `unpaidpartialpay.html`, `unpaidpartialpay.css`, and `unpaidpartialpay.js`.

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
