const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ document: { addEventListener() {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'entitlementcalculator.js'), 'utf8'), context);
const period = (start, end, entitlements) => ({ start, end, entitlements });

test('mockup totals calendar days and weekdays separately for concurrent entitlements', () => {
	const summary = context.summarizeEntitlements([
		period('2026-01-05', '2026-01-16', ['PDLL', 'FMLA']),
		period('2026-02-02', '2026-02-13', ['PDLL', 'FMLA']),
		period('2026-03-02', '2026-03-13', ['CFRA', 'PFCB'])
	]);
	assert.equal(summary.length, 4);
	for (const type of ['PDLL', 'FMLA']) {
		const row = summary.find(item => item.type === type);
		assert.equal(row.calendarDays, 24);
		assert.equal(row.periods.length, 2);
	}
	const pdll = summary.find(item => item.type === 'PDLL');
	assert.equal(pdll.weekdays, null);
	assert.equal(pdll.weeks, 24 / 7);
	assert.equal(pdll.remaining, null);
	const fmla = summary.find(item => item.type === 'FMLA');
	assert.equal(fmla.weekdays, 20);
	assert.equal(fmla.weeks, null);
	assert.equal(fmla.remaining, 60);
	assert.equal(fmla.remainingUnit, 'calendar days');
	const cfra = summary.find(item => item.type === 'CFRA');
	assert.equal(cfra.calendarDays, 12);
	assert.equal(cfra.weekdays, 10);
	assert.equal(cfra.weeks, null);
	assert.equal(cfra.remaining, 72);
	const pfcb = summary.find(item => item.type === 'PFCB');
	assert.equal(pfcb.calendarDays, null);
	assert.equal(pfcb.weekdays, 10);
	assert.equal(pfcb.weeks, null);
	assert.equal(pfcb.remaining, 46);
	assert.equal(pfcb.remainingUnit, 'workdays');
});

test('overlapping and duplicate periods count dates once per entitlement', () => {
	const summary = context.summarizeEntitlements([
		period('2026-01-05', '2026-01-16', ['PDLL', 'FMLA']),
		period('2026-01-12', '2026-01-23', ['PDLL']),
		period('2026-01-05', '2026-01-16', ['PDLL'])
	]);
	const pdll = summary.find(row => row.type === 'PDLL');
	assert.equal(pdll.calendarDays, 19);
	assert.equal(pdll.weekdays, null);
	assert.equal(pdll.weeks, 19 / 7);
	assert.equal(pdll.hasOverlap, true);
	assert.equal(summary.find(row => row.type === 'FMLA').calendarDays, 12);
});

test('remaining entitlement uses exact subtraction even when the result is negative', () => {
	const summary = context.summarizeEntitlements([
		period('2026-01-01', '2026-04-30', ['FMLA', 'CFRA', 'PFCB'])
	]);
	assert.equal(summary.find(row => row.type === 'FMLA').remaining, -36);
	assert.equal(summary.find(row => row.type === 'CFRA').remaining, -36);
	assert.equal(summary.find(row => row.type === 'PFCB').remaining, -30);
});

test('overlapping dates reduce remaining entitlement only once', () => {
	const summary = context.summarizeEntitlements([
		period('2026-01-05', '2026-01-16', ['FMLA', 'CFRA', 'PFCB']),
		period('2026-01-12', '2026-01-23', ['FMLA', 'CFRA', 'PFCB'])
	]);
	assert.equal(summary.find(row => row.type === 'FMLA').remaining, 65);
	assert.equal(summary.find(row => row.type === 'CFRA').remaining, 65);
	assert.equal(summary.find(row => row.type === 'PFCB').remaining, 41);
});

test('inclusive dates handle leap years, weekends, and weekday holidays', () => {
	const leap = context.entitlementDayCounts('2028-02-28', '2028-03-01');
	assert.equal(leap.calendarDays, 3);
	assert.equal(leap.weekdays, 3);
	const weekend = context.entitlementDayCounts('2026-01-10', '2026-01-11');
	assert.equal(weekend.calendarDays, 2);
	assert.equal(weekend.weekdays, 0);
	assert.equal(context.entitlementDayCounts('2026-01-01', '2026-01-01').weekdays, 1);
});

test('entry order and nested intervals do not change the unique day total', () => {
	const summary = context.summarizeEntitlements([
		period('2026-02-03', '2026-02-03', ['CFRA']),
		period('2026-02-02', '2026-02-06', ['CFRA']),
		period('2026-02-06', '2026-02-09', ['CFRA'])
	]);
	assert.equal(summary[0].calendarDays, 8);
	assert.equal(summary[0].weekdays, 6);
	assert.equal(summary[0].periods[0].start, '2026-02-02');
});

test('missing selections, invalid dates, reversed dates and empty periods are rejected', () => {
	assert.throws(() => context.summarizeEntitlements([]), /Add at least one/);
	assert.throws(() => context.summarizeEntitlements([period('2026-01-01', '2026-01-02', [])]), /Select at least one/);
	assert.throws(() => context.entitlementDayCounts('2026-02-30', '2026-03-01'), /valid date/);
	assert.throws(() => context.entitlementDayCounts('', '2026-03-01'), /valid date/);
	assert.throws(() => context.entitlementDayCounts('2026-03-02', '2026-03-01'), /on or after/);
});

test('FMLA warns across calendar years without preventing a calculation', () => {
	const result = context.summarizeEntitlements([period('2026-12-15', '2027-01-15', ['FMLA'])])[0];
	assert.equal(result.calendarDays, 32);
	assert.equal(result.warning, 'Entitlement resets every calendar year. Please keep FMLA leave dates within the same calendar year.');
	assert.equal(context.summarizeEntitlements([period('2026-01-01', '2026-12-31', ['FMLA'])])[0].warning, null);
});

test('separate FMLA entries in different years also warn about a combined balance', () => {
	const warnings = context.getEntitlementWarnings([
		period('2026-01-05', '2026-01-16', ['FMLA']),
		period('2027-01-04', '2027-01-15', ['FMLA'])
	]);
	assert.equal(warnings.length, 1);
	assert.equal(warnings[0].type, 'FMLA');
	assert.equal(warnings[0].reasons[0], 'calendar-year');
});

test('CFRA event dates are optional and calendar-year boundaries still warn', () => {
	assert.equal(context.summarizeEntitlements([period('2026-02-01', '2026-02-28', ['CFRA'])])[0].warning, null);
	const result = context.summarizeEntitlements([period('2026-12-15', '2027-01-15', ['CFRA'])])[0];
	assert.equal(result.warning, 'Entitlement resets every calendar year or per birth/placement/adoption event. Please keep CFRA leave dates within the same entitlement period.');
});

test('CFRA warns when leave crosses an actual event date or yearly anniversary', () => {
	for (const [eventDate, reason] of [['2026-02-15', 'event-date'], ['2024-02-15', 'anniversary']]) {
		const warnings = context.getEntitlementWarnings([
			{ ...period('2026-02-01', '2026-02-28', ['CFRA']), eventDate }
		]);
		assert.equal(warnings[0].type, 'CFRA');
		assert.ok(warnings[0].reasons.includes(reason));
	}
	// The event date starts the next period; a leave wholly on that side is valid.
	assert.equal(context.getEntitlementWarnings([
		{ ...period('2026-02-15', '2026-02-28', ['CFRA']), eventDate: '2024-02-15' }
	]).length, 0);
	assert.equal(context.getEntitlementWarnings([
		{ ...period('2026-02-01', '2026-02-14', ['CFRA']), eventDate: '2024-02-15' }
	]).length, 0);
});

test('CFRA anniversary checks include boundary end dates and handle Feb 29 events', () => {
	assert.ok(context.getEntitlementWarnings([
		{ ...period('2026-02-01', '2026-02-15', ['CFRA']), eventDate: '2024-02-15' }
	])[0].reasons.includes('anniversary'));
	assert.ok(context.getEntitlementWarnings([
		{ ...period('2026-02-20', '2026-03-01', ['CFRA']), eventDate: '2024-02-29' }
	])[0].reasons.includes('anniversary'));
	assert.equal(context.getEntitlementWarnings([
		{ ...period('2026-02-01', '2026-02-28', ['CFRA']), eventDate: '2027-02-15' }
	]).length, 0);
});

test('CFRA warns for separate events, validates optional dates, and leaves other entitlements alone', () => {
	assert.ok(context.getEntitlementWarnings([
		{ ...period('2026-09-01', '2026-09-10', ['CFRA']), eventDate: '2026-01-01' },
		{ ...period('2026-10-01', '2026-10-10', ['CFRA']), eventDate: '2026-06-01' }
	])[0].reasons.includes('multiple-events'));
	assert.throws(() => context.summarizeEntitlements([
		{ ...period('2026-02-01', '2026-02-28', ['CFRA']), eventDate: '2026-02-30' }
	]), /valid date/);
	for (const row of context.summarizeEntitlements([period('2026-12-15', '2027-01-15', ['PDLL', 'PFCB'])])) {
		assert.equal(row.warning, null);
	}
});
