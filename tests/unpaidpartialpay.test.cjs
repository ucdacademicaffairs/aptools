const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const context = vm.createContext({ document: { addEventListener() {} } });
vm.runInContext(fs.readFileSync(path.join(root, 'unpaidpartialpay.js'), 'utf8'), context);
const config = JSON.parse(fs.readFileSync(path.join(root, 'annual-config.json'), 'utf8'));
const cents = value => Math.round(value * 100);

test('weekdays include weekday holidays, exclude weekends, and count endpoints', () => {
	assert.equal(context.workDays('2026-11-26', '2026-11-27'), 2);
	assert.equal(context.workDays('2026-10-10', '2026-10-11'), 0);
	assert.equal(context.workDays('2026-10-09', '2026-10-12'), 2);
	assert.equal(context.calendarDays('2028-02-28', '2028-03-01'), 3);
});

test('Quarter uses one-third salary and weekday leave fraction', () => {
	const result = context.calculateLeave(config.QUARTER_DATES, '2026-10-05', '2026-10-16', 120000, 50, 3);
	assert.equal(result.serviceDays, 12);
	assert.equal(result.serviceWorkDays, 60);
	assert.equal(result.leaveWorkDays, 10);
	assert.equal(cents(result.fullUnpaid), 666667);
	assert.equal(cents(result.partialUnpaid), 333333);
	assert.equal(result.payStart, '2026-07-22');
	assert.equal(result.payEnd, '2026-08-08');
});

test('Semester uses one-half salary and its own service workdays', () => {
	const result = context.calculateLeave(config.SEMESTER_DATES, '2026-10-05', '2026-10-16', 120000, 25, 2);
	assert.equal(result.serviceWorkDays, 80);
	assert.equal(result.leaveWorkDays, 10);
	assert.equal(cents(result.fullUnpaid), 750000);
	assert.equal(cents(result.partialUnpaid), 562500);
});

test('full-period leave gives one-third or one-half salary for every configured period', () => {
	for (const [key, divisor] of [['QUARTER_DATES', 3], ['SEMESTER_DATES', 2]]) {
		for (const period of Object.values(config[key])) {
			const result = context.calculateLeave(config[key], period.serviceStart, period.serviceEnd, 120000, 0, divisor);
			assert.equal(cents(result.fullUnpaid), cents(120000 / divisor));
			assert.equal(cents(result.partialUnpaid), cents(result.fullUnpaid));
			assert.equal(result.payStart, period.payStart);
			assert.equal(result.payEnd, period.payEnd);
		}
	}
});

test('multi-quarter leave applies each quarter daily rate and excludes the break', () => {
	const result = context.calculateLeave(config.QUARTER_DATES, '2026-12-07', '2027-01-08', 120000, 99, 3);
	assert.equal(result.portions.length, 2);
	assert.equal(result.serviceDays, 10);
	assert.equal(result.serviceWorkDays, 115);
	assert.equal(result.leaveWorkDays, 10);
	assert.equal(result.breakDays, 23);
	assert.equal(cents(result.fullUnpaid), 696970);
	assert.equal(cents(result.partialUnpaid), 6970);
	assert.equal(result.portions[0].payEnd, '2026-10-31');
});

test('a weekend-only service leave has zero unpaid salary', () => {
	const result = context.calculateLeave(config.QUARTER_DATES, '2026-10-10', '2026-10-11', 120000, 0, 3);
	assert.equal(result.serviceDays, 2);
	assert.equal(result.leaveWorkDays, 0);
	assert.equal(result.fullUnpaid, 0);
});

test('a leave entirely between service periods has no calculation', () => {
	assert.throws(() => context.calculateLeave(config.SEMESTER_DATES, '2026-12-12', '2027-01-10', 120000, 0, 2), /no service days/);
});
