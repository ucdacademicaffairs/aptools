'use strict';

const DAY_MS = 86400000;
const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function utcDate(value) {
	return new Date(value + 'T00:00:00Z');
}

function calendarDays(start, end) {
	return Math.round((utcDate(end) - utcDate(start)) / DAY_MS) + 1;
}

function workDays(start, end) {
	let total = 0;
	const last = utcDate(end);
	for (const day = utcDate(start); day <= last; day.setUTCDate(day.getUTCDate() + 1)) {
		if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) total++;
	}
	return total;
}

function addDays(value, days) {
	const date = utcDate(value);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function formatDate(value) {
	return utcDate(value).toLocaleDateString('en-US', {
		month: '2-digit', day: '2-digit', year: 'numeric', timeZone: 'UTC'
	});
}

// Keep conversion and rounding consistent with the Leave Date Conversion Tool.
function scaleToPayDays(payDays, serviceDays, totalServiceDays) {
	return Math.round(Number(((serviceDays / totalServiceDays) * payDays).toPrecision(15)));
}

function calculateLeave(dates, start, end, annualSalary = null, partialPay = 0, periodsPerYear = 3) {
	const includePay = annualSalary !== null;
	const portions = Object.entries(dates)
		.sort((a, b) => a[1].serviceStart.localeCompare(b[1].serviceStart))
		.flatMap(([name, period]) => {
			const portionStart = start > period.serviceStart ? start : period.serviceStart;
			const portionEnd = end < period.serviceEnd ? end : period.serviceEnd;
			if (portionStart > portionEnd) return [];
			const serviceDays = calendarDays(period.serviceStart, period.serviceEnd);
			const leaveDays = calendarDays(portionStart, portionEnd);
			const payDays = calendarDays(period.payStart, period.payEnd);
			const daysBefore = calendarDays(period.serviceStart, portionStart) - 1;
			const payDaysBefore = scaleToPayDays(payDays, daysBefore, serviceDays);
			const convertedDays = scaleToPayDays(payDays, leaveDays, serviceDays);
			const payStart = addDays(period.payStart, payDaysBefore);
			const runsToEnd = portionEnd === period.serviceEnd;
			const payEnd = runsToEnd ? period.payEnd : addDays(payStart, convertedDays - 1);
			const serviceWorkDays = workDays(period.serviceStart, period.serviceEnd);
			const leaveWorkDays = workDays(portionStart, portionEnd);
			if (!serviceWorkDays) throw new Error('The configured service period has no work days.');
			const periodSalary = includePay ? annualSalary / periodsPerYear : null;
			const dailyRate = includePay ? periodSalary / serviceWorkDays : null;
			const fullUnpaid = includePay ? dailyRate * leaveWorkDays : null;
			return [{ name, period, portionStart, portionEnd, serviceDays, leaveDays, payDays,
				daysBefore, payDaysBefore, convertedDays, payStart, payEnd, runsToEnd,
				serviceWorkDays, leaveWorkDays, periodSalary, dailyRate, fullUnpaid }];
		});
	if (!portions.length) throw new Error('These dates fall entirely between service periods. There are no service days on leave to calculate.');
	const sum = key => portions.reduce((total, portion) => total + portion[key], 0);
	const fullUnpaid = includePay ? sum('fullUnpaid') : null;
	return {
		portions, payStart: portions[0].payStart, payEnd: portions[portions.length - 1].payEnd,
		serviceDays: sum('leaveDays'), serviceWorkDays: sum('serviceWorkDays'),
		leaveWorkDays: sum('leaveWorkDays'), breakDays: calendarDays(start, end) - sum('leaveDays'),
		fullUnpaid, partialUnpaid: includePay ? fullUnpaid * (100 - partialPay) / 100 : null
	};
}

function textElement(tag, text, className) {
	const element = document.createElement(tag);
	element.textContent = text;
	if (className) element.className = className;
	return element;
}

function renderWork(container, result, annualSalary, partialPay, periodsPerYear, term) {
	const includePay = annualSalary !== null;
	container.replaceChildren();
	result.portions.forEach(portion => {
		const section = document.createElement('div');
		section.className = 'work-portion';
		section.append(textElement('h3', portion.name));
		const lines = [
			`Service period: ${formatDate(portion.period.serviceStart)} – ${formatDate(portion.period.serviceEnd)}: ${portion.serviceDays} calendar days; ${portion.serviceWorkDays} Monday–Friday work days.`,
			`Service days on leave: ${formatDate(portion.portionStart)} – ${formatDate(portion.portionEnd)}: ${portion.leaveDays} calendar days; ${portion.leaveWorkDays} Monday–Friday work days.`,
			`Pay period: ${formatDate(portion.period.payStart)} – ${formatDate(portion.period.payEnd)}: ${portion.payDays} calendar days.`,
			`Pay days before leave = ROUND(${portion.daysBefore} ÷ ${portion.serviceDays} × ${portion.payDays}, 0) = ${portion.payDaysBefore}. Pay start = ${formatDate(portion.period.payStart)} + ${portion.payDaysBefore} days = ${formatDate(portion.payStart)}.`,
			`Converted leave days = ROUND(${portion.leaveDays} ÷ ${portion.serviceDays} × ${portion.payDays}, 0) = ${portion.convertedDays}.`,
			portion.runsToEnd
				? `The leave reaches the last service day of this ${term}, so the pay end is the ${term}'s pay period end: ${formatDate(portion.payEnd)}.`
				: `Pay end = ${formatDate(portion.payStart)} + ${portion.convertedDays} days − 1 (inclusive) = ${formatDate(portion.payEnd)}.`
		];
		if (includePay) lines.push(
			`${term[0].toUpperCase() + term.slice(1)} salary = ${currency.format(annualSalary)} ÷ ${periodsPerYear} = ${currency.format(portion.periodSalary)}.`,
			`Daily rate = (${currency.format(annualSalary)} ÷ ${periodsPerYear}) ÷ ${portion.serviceWorkDays} = $${portion.dailyRate.toFixed(6)} per work day.`,
			`Full unpaid amount = daily rate × ${portion.leaveWorkDays} work days on leave = ${currency.format(portion.fullUnpaid)}.`
		);
		lines.forEach(line => section.append(textElement('p', line)));
		container.append(section);
	});
	if (includePay) container.append(
		textElement('p', `Total Full Unpaid Amount = sum of the unpaid amounts for the affected ${term}s = ${currency.format(result.fullUnpaid)}.`),
		textElement('p', `Total Unpaid Amount at Partial Pay = full unpaid amount × (100 − ${partialPay}) ÷ 100 = ${currency.format(result.partialUnpaid)}.`),
		textElement('p', `Daily rates and intermediate amounts retain full precision; final totals are rounded to cents. Work days count Monday–Friday, including holidays that fall on weekdays. Calendar dates count both start and end dates. When a leave spans multiple ${term}s, the work days in service period total sums the complete service periods touched by the leave.`, 'help')
	);
	if (!includePay) container.append(textElement('p', 'Date conversion uses inclusive calendar days. Work days count Monday–Friday, including holidays that fall on weekdays. Days between service periods are excluded.', 'help'));
}

