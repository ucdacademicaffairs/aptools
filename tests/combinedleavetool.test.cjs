const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(root, 'leave-tool-shared.js'), 'utf8'), context);
const config = JSON.parse(fs.readFileSync(path.join(root, 'calendar-dates.json'), 'utf8'));

test('combined date-only mode needs no salary and produces no unpaid amount', () => {
	const result = context.calculateLeave(config.QUARTER_DATES, '2026-10-05', '2026-10-16');
	assert.equal(result.payStart, '2026-07-22');
	assert.equal(result.payEnd, '2026-08-08');
	assert.equal(result.serviceDays, 12);
	assert.equal(result.fullUnpaid, null);
	assert.equal(result.partialUnpaid, null);
	assert.equal(result.partialPaid, null);
	assert.equal(result.monthlyPay, null);
});

test('combined optional pay mode uses the confirmed Quarter and Semester rates', () => {
	const quarter = context.calculateLeave(config.QUARTER_DATES, '2026-10-05', '2026-10-16', 120000, 50, 3);
	const semester = context.calculateLeave(config.SEMESTER_DATES, '2026-10-05', '2026-10-16', 120000, 25, 2);
	assert.equal(Math.round(quarter.partialUnpaid * 100), 333333);
	assert.equal(Math.round(semester.partialUnpaid * 100), 562500);
});

test('paid and unpaid leave amounts split the full amount for both calendars and multiple periods', () => {
	for (const [dates, divisor] of [[config.QUARTER_DATES, 3], [config.SEMESTER_DATES, 2]]) {
		for (const percent of [0, 50, 99]) {
			const result = context.calculateLeave(dates, '2026-09-21', '2027-03-08', 120000, percent, divisor);
			assert.ok(result.portions.length > 1);
			assert.equal(result.monthlyPay, 10000);
			assert.equal(result.partialPaid, result.fullUnpaid * percent / 100);
			assert.ok(Math.abs(result.partialPaid + result.partialUnpaid - result.fullUnpaid) < 1e-8);
		}
	}
});
