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
});

test('combined optional pay mode uses the confirmed Quarter and Semester rates', () => {
	const quarter = context.calculateLeave(config.QUARTER_DATES, '2026-10-05', '2026-10-16', 120000, 50, 3);
	const semester = context.calculateLeave(config.SEMESTER_DATES, '2026-10-05', '2026-10-16', 120000, 25, 2);
	assert.equal(Math.round(quarter.partialUnpaid * 100), 333333);
	assert.equal(Math.round(semester.partialUnpaid * 100), 562500);
});
