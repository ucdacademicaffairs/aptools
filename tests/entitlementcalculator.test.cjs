const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ document: { addEventListener() {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'entitlementcalculator.js'), 'utf8'), context);
const period = (start, end, entitlements) => ({ start, end, entitlements });

test('calculation equations subtract each leave once, excluding previously counted overlap', () => {
	const leaves = [{ start: '2026-01-05', end: '2026-01-11' }, { start: '2026-01-09', end: '2026-01-13' }];
	const calendar = context.entitlementLeaveContributions(leaves, 'FMLA');
	assert.deepEqual(Array.from(calendar.amounts), [7, 2]);
	assert.equal(calendar.hasOverlap, true);
	const workdays = context.entitlementLeaveContributions(leaves, 'PFCB');
	assert.deepEqual(Array.from(workdays.amounts), [5, 2]);
	assert.equal(workdays.hasOverlap, true);
	const separate = context.entitlementLeaveContributions([{ start: '2026-01-01', end: '2026-01-07' }, { start: '2026-02-01', end: '2026-02-05' }], 'CFRA');
	assert.deepEqual(Array.from(separate.amounts), [7, 5]);
	assert.equal(separate.hasOverlap, false);
});

// Calculation fixtures include complete events and explicit CFRA associations.
function summarize(periods) {
	const events = [{ id: 'birth', date: '2025-01-01', type: 'Birth' }];
	const associated = periods.map((entry, index) => {
		if (!entry.entitlements.includes('CFRA')) return entry;
		const date = entry.eventDate || '2025-01-01';
		const type = entry.eventType || 'Birth';
		let event = events.find(event => event.date === date && event.type === type);
		if (!event) {
			event = { id: `cfra-${index}`, date, type };
			events.push(event);
		}
		return { ...entry, eventId: event.id };
	});
	return context.summarizeEntitlements(associated, events);
}

test('CFRA requires a complete entered event and a matching association', () => {
	const leave = period('2026-02-02', '2026-02-06', ['CFRA']);
	const event = { id: 'adoption', date: '2026-01-01', type: 'Adoption' };
	assert.throws(() => context.summarizeEntitlements([leave]), /complete.*event/);
	assert.throws(() => context.summarizeEntitlements([leave], [event]), /associate/);
	assert.throws(() => context.summarizeEntitlements([{ ...leave, eventId: 'deleted' }], [event]), /associate/);
	for (const incomplete of [{ ...event, date: '' }, { ...event, date: '2026-02-30' }, { ...event, type: '' }]) {
		assert.throws(() => context.summarizeEntitlements([{ ...leave, eventId: event.id }], [incomplete]), /complete/);
	}
	const result = context.summarizeEntitlements([{ ...leave, eventId: event.id }], [event]).find(row => row.type === 'CFRA');
	assert.equal(result.periods[0].eventDate, '2026-01-01');
	assert.equal(result.periods[0].eventType, 'Adoption');
});

test('PDLL requires a complete Birth event; other entitlements do not', () => {
	const leave = period('2026-02-02', '2026-02-06', ['PDLL']);
	for (const events of [[], [{ id: 'e', date: '2026-01-01', type: 'Placement' }], [{ id: 'e', date: '', type: 'Birth' }]]) {
		assert.throws(() => context.summarizeEntitlements([leave], events), /complete Birth/);
	}
	assert.equal(context.summarizeEntitlements([leave], [{ id: 'e', date: '2026-01-01', type: 'Birth' }])[0].calendarDays, 5);
	assert.equal(context.summarizeEntitlements([period('2026-02-02', '2026-02-06', ['FMLA', 'PFCB'])]).length, 2);
});

test('CFRA auto-associates one event and requires an explicit choice among multiple events', () => {
	const birth = { id: 'event-1', date: '2026-01-01', type: 'Birth' };
	const adoption = { id: 'event-2', date: '2026-02-01', type: 'Adoption' };
	assert.equal(context.resolveCfraEvent([], ''), null);
	assert.equal(context.resolveCfraEvent([birth], ''), birth);
	assert.equal(context.resolveCfraEvent([birth, adoption], ''), null);
	assert.equal(context.resolveCfraEvent([birth, adoption], adoption.id), adoption);
	assert.equal(context.resolveCfraEvent([birth, adoption], 'removed'), null);
	const result = summarize([
		{ ...period('2026-02-02', '2026-02-06', ['CFRA']), eventDate: adoption.date, eventType: adoption.type }
	]).find(row => row.type === 'CFRA');
	assert.equal(result.periods[0].eventDate, adoption.date);
	assert.equal(result.periods[0].eventType, 'Adoption');
});

test('mockup totals calendar days and weekdays separately for concurrent entitlements', () => {
	const summary = summarize([
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
	assert.equal(pfcb.remaining, 30);
	assert.equal(pfcb.remainingUnit, 'workdays');
});

test('overlapping and duplicate periods count dates once per entitlement', () => {
	const summary = summarize([
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
	const summary = summarize([
		period('2026-01-01', '2026-04-30', ['FMLA', 'CFRA', 'PFCB'])
	]);
	assert.equal(summary.find(row => row.type === 'FMLA').remaining, -36);
	assert.equal(summary.find(row => row.type === 'CFRA').remaining, -36);
	assert.equal(summary.find(row => row.type === 'PFCB').remaining, -46);
});

test('overlapping dates reduce remaining entitlement only once', () => {
	const summary = summarize([
		period('2026-01-05', '2026-01-16', ['FMLA', 'CFRA', 'PFCB']),
		period('2026-01-12', '2026-01-23', ['FMLA', 'CFRA', 'PFCB'])
	]);
	assert.equal(summary.find(row => row.type === 'FMLA').remaining, 65);
	assert.equal(summary.find(row => row.type === 'CFRA').remaining, 65);
	assert.equal(summary.find(row => row.type === 'PFCB').remaining, 25);
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
	const summary = summarize([
		period('2026-02-03', '2026-02-03', ['CFRA']),
		period('2026-02-02', '2026-02-06', ['CFRA']),
		period('2026-02-06', '2026-02-09', ['CFRA'])
	]);
	const cfra = summary.find(row => row.type === 'CFRA');
	assert.equal(cfra.calendarDays, 8);
	assert.equal(cfra.weekdays, 6);
	assert.equal(cfra.periods[0].start, '2026-02-02');
});

test('missing selections, invalid dates, reversed dates and empty periods are rejected', () => {
	assert.throws(() => summarize([]), /Add at least one/);
	assert.throws(() => summarize([period('2026-01-01', '2026-01-02', [])]), /Select at least one/);
	assert.throws(() => context.entitlementDayCounts('2026-02-30', '2026-03-01'), /valid date/);
	assert.throws(() => context.entitlementDayCounts('', '2026-03-01'), /valid date/);
	assert.throws(() => context.entitlementDayCounts('2026-03-02', '2026-03-01'), /on or after/);
});

test('FMLA splits cross-year leave into independent annual balances without warnings', () => {
	const result = summarize([period('2026-12-15', '2027-01-15', ['FMLA'])]).find(row => row.type === 'FMLA');
	assert.equal(result.calendarDays, 32);	assert.equal(result.remaining, null);
	assert.deepEqual(JSON.parse(JSON.stringify(result.yearly.map(({ year, used, remaining }) => ({ year, used, remaining })))), [
		{ year: 2026, used: 17, remaining: 67 }, { year: 2027, used: 15, remaining: 69 }
	]);});

test('PFCB resets to 40 workdays each year and splits at January 1', () => {
	const result = summarize([period('2026-12-28', '2027-01-05', ['PFCB'])]).find(row => row.type === 'PFCB');
	assert.deepEqual(JSON.parse(JSON.stringify(result.yearly)), [
		{ year: 2026, used: 4, remaining: 36, periods: [{ start: '2026-12-28', end: '2026-12-31' }] },
		{ year: 2027, used: 3, remaining: 37, periods: [{ start: '2027-01-01', end: '2027-01-05' }] }
	]);});

test('annual balances deduplicate overlap, handle leap years, and omit untouched gap years', () => {
	for (const type of ['FMLA', 'PFCB']) {
		const result = summarize([
			period('2028-02-28', '2028-03-01', [type]),
			period('2028-02-29', '2028-03-01', [type]),
			period('2030-01-05', '2030-01-06', [type])
		]).find(row => row.type === type);
		assert.equal(result.yearly.length, 2);
		assert.equal(result.yearly[0].year, 2028);
		assert.equal(result.yearly[0].used, 3);
		assert.equal(result.yearly[1].year, 2030);
		assert.equal(result.yearly[1].used, type === 'PFCB' ? 0 : 2);
		assert.equal(result.hasOverlap, true);
	}
});

test('CFRA balances are independent per event and include unused entered events', () => {
	const events = [
		{ id: 'birth', date: '2025-04-10', type: 'Birth' },
		{ id: 'placement', date: '2026-11-10', type: 'Placement' }
	];
	const result = context.summarizeEntitlements([
		{ ...period('2025-04-10', '2025-07-02', ['CFRA']), eventId: 'birth' }
	], events).find(row => row.type === 'CFRA');
	assert.deepEqual(JSON.parse(JSON.stringify(result.eventBalances.map(({ event, used, remaining }) => ({ id: event.id, used, remaining })))), [
		{ id: 'placement', used: 0, remaining: 84 },
		{ id: 'birth', used: 84, remaining: 0 }
	]);
	assert.equal(result.remaining, null);
});

test('CFRA counts unique days within each event across years, anniversaries and leap days', () => {
	const events = [
		{ id: 'a', date: '2024-02-29', type: 'Birth' },
		{ id: 'b', date: '2024-02-29', type: 'Adoption' }
	];
	const result = context.summarizeEntitlements([
		{ ...period('2024-02-28', '2024-03-01', ['CFRA']), eventId: 'a' },
		{ ...period('2024-02-29', '2024-03-01', ['CFRA']), eventId: 'a' },
		{ ...period('2024-12-31', '2025-01-02', ['CFRA']), eventId: 'a' },
		{ ...period('2025-02-28', '2025-03-01', ['CFRA']), eventId: 'a' },
		{ ...period('2024-02-28', '2024-03-01', ['CFRA']), eventId: 'b' }
	], events).find(row => row.type === 'CFRA');
	assert.equal(result.eventBalances[0].used, 8);
	assert.equal(result.eventBalances[0].remaining, 76);
	assert.equal(result.eventBalances[0].hasOverlap, true);
	assert.equal(result.eventBalances[1].used, 3);
	assert.equal(result.eventBalances[1].remaining, 81);
	assert.equal(result.eventBalances[1].hasOverlap, false);
});

test('CFRA association changes move usage to the new event', () => {
	const events = [{ id: 'a', date: '2026-01-01', type: 'Birth' }, { id: 'b', date: '2026-02-01', type: 'Placement' }];
	const leave = period('2026-03-01', '2026-03-10', ['CFRA']);
	for (const id of ['a', 'b']) {
		const balances = context.summarizeEntitlements([{ ...leave, eventId: id }], events).find(row => row.type === 'CFRA').eventBalances;
		assert.equal(balances.find(balance => balance.event.id === id).used, 10);
		assert.equal(balances.find(balance => balance.event.id !== id).used, 0);
	}
});

test('PDLL conflicts with CFRA and PFCB only within the same leave period', () => {
	for (const selections of [['PDLL', 'CFRA'], ['PDLL', 'PFCB'], ['PDLL', 'FMLA', 'CFRA', 'PFCB']]) {
		assert.throws(() => summarize([period('2026-01-05', '2026-01-09', selections)]), /PDLL cannot be combined/);
	}
	for (const selections of [['PDLL', 'FMLA'], ['CFRA', 'PFCB', 'FMLA']]) {
		const results = summarize([period('2026-01-05', '2026-01-09', selections)]);
		assert.equal(results.length, 4);
		for (const type of selections) assert.ok(results.find(row => row.type === type));
	}
	assert.equal(summarize([
		period('2026-01-05', '2026-01-09', ['PDLL']),
		period('2026-02-02', '2026-02-06', ['CFRA', 'PFCB'])
	]).length, 4);
});

test('all available entitlements appear with unused balances', () => {
	const events = [{ id: 'birth', date: '2026-01-01', type: 'Birth' }];
	const results = context.summarizeEntitlements([period('2026-02-02', '2026-02-06', ['FMLA'])], events);
	assert.deepEqual(Array.from(results, row => row.type), ['PDLL', 'FMLA', 'CFRA', 'PFCB']);
	assert.equal(results.find(row => row.type === 'PDLL').calendarDays, 0);
	assert.equal(results.find(row => row.type === 'PDLL').weeks, 0);
	assert.equal(results.find(row => row.type === 'CFRA').eventBalances[0].used, 0);
	assert.equal(results.find(row => row.type === 'CFRA').eventBalances[0].remaining, 84);
	assert.equal(results.find(row => row.type === 'PFCB').yearly[0].used, 0);
	assert.equal(results.find(row => row.type === 'PFCB').yearly[0].remaining, 40);
	assert.equal(results.find(row => row.type === 'FMLA').yearly[0].remaining, 79);
});

test('event requirements control unused cards and annual cards include unused years', () => {
	const leaves = [period('2025-12-31', '2026-01-02', ['PFCB']), period('2027-02-01', '2027-02-05', ['FMLA'])];
	const noEvents = context.summarizeEntitlements(leaves);
	assert.deepEqual(Array.from(noEvents, row => row.type), ['FMLA', 'PFCB']);
	assert.deepEqual(Array.from(noEvents.find(row => row.type === 'FMLA').yearly, row => row.used), [0, 0, 5]);
	assert.deepEqual(Array.from(noEvents.find(row => row.type === 'PFCB').yearly, row => row.remaining), [39, 38, 40]);
	const placement = context.summarizeEntitlements(leaves, [{ id: 'e', date: '2026-01-01', type: 'Placement' }]);
	assert.deepEqual(Array.from(placement, row => row.type), ['FMLA', 'CFRA', 'PFCB']);
});
