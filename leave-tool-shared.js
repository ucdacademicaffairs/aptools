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
		monthlyPay: includePay ? annualSalary / 12 : null,
		fullUnpaid, partialPaid: includePay ? fullUnpaid * partialPay / 100 : null,
		partialUnpaid: includePay ? fullUnpaid * (100 - partialPay) / 100 : null
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
	const dayCount = (count, kind) => `${count} ${kind} ${count === 1 ? 'day' : 'days'}`;
	function group(parent, title, dateRange, items) {
		const section = document.createElement('section');
		section.className = 'work-group';
		section.append(textElement('h4', title));
		if (dateRange) section.append(textElement('p', dateRange));
		const list = document.createElement('ul');
		items.forEach(item => list.append(textElement('li', item)));
		section.append(list);
		parent.append(section);
	}
	result.portions.forEach(portion => {
		const section = document.createElement('div');
		section.className = 'work-portion';
		section.append(textElement('h3', portion.name));
		group(section, 'Service Period', `${formatDate(portion.period.serviceStart)} – ${formatDate(portion.period.serviceEnd)}`, [
			dayCount(portion.serviceDays, 'calendar'),
			`${dayCount(portion.serviceWorkDays, 'work')} (Monday–Friday)`
		]);
		group(section, 'Service Days on Leave', `${formatDate(portion.portionStart)} – ${formatDate(portion.portionEnd)}`, [
			dayCount(portion.leaveDays, 'calendar'),
			dayCount(portion.leaveWorkDays, 'work')
		]);
		group(section, 'Pay Period', `${formatDate(portion.period.payStart)} – ${formatDate(portion.period.payEnd)}`, [
			dayCount(portion.payDays, 'calendar')
		]);
		group(section, 'How We Find Your Pay Dates', null, [
			`First, convert the days before your leave: ${portion.daysBefore} ÷ ${portion.serviceDays} × ${portion.payDays} = ${portion.payDaysBefore} pay days, rounded to a whole day.`,
			`Your pay starts ${portion.payDaysBefore} days after ${formatDate(portion.period.payStart)}: ${formatDate(portion.payStart)}.`,
			`Next, convert your leave days: ${portion.leaveDays} ÷ ${portion.serviceDays} × ${portion.payDays} = ${portion.convertedDays} pay days, rounded to a whole day.`,
			portion.runsToEnd
				? `Your leave reaches the last service day of the ${term}, so your pay ends on the period's last pay date: ${formatDate(portion.payEnd)}.`
				: `Count ${portion.convertedDays} pay days starting on ${formatDate(portion.payStart)}. The first day counts, so the end is ${formatDate(portion.payEnd)} (${formatDate(portion.payStart)} + ${portion.convertedDays} − 1).`
		]);
		if (includePay) group(section, 'How We Find Your Paid and Unpaid Amounts', null, [
			`Salary for this ${term}: ${currency.format(annualSalary)} ÷ ${periodsPerYear} = ${currency.format(portion.periodSalary)}.`,
			`Pay for one work day: ${currency.format(portion.periodSalary)} ÷ ${portion.serviceWorkDays} work days = about ${currency.format(portion.dailyRate)}.`,
			`Fully unpaid leave: the daily rate × ${portion.leaveWorkDays} work days on leave = ${currency.format(portion.fullUnpaid)}.`,
			`At ${partialPay}% pay, the amount paid is ${currency.format(portion.fullUnpaid)} × ${partialPay}% = ${currency.format(portion.fullUnpaid * partialPay / 100)}.`,
			`At ${partialPay}% pay, ${100 - partialPay}% is unpaid: ${currency.format(portion.fullUnpaid)} × ${100 - partialPay}% = ${currency.format(portion.fullUnpaid * (100 - partialPay) / 100)}.`
		]);
		container.append(section);
	});
	if (includePay) {
		const totals = document.createElement('div');
		totals.className = 'work-totals';
		totals.append(
			textElement('h3', result.portions.length > 1 ? 'Add the Periods Together' : 'Your Pay Totals'),
			textElement('p', `Normal Monthly Pay: ${currency.format(annualSalary)} ÷ 12 = ${currency.format(result.monthlyPay)}.`),
			textElement('p', `Total Full Unpaid Amount: ${currency.format(result.fullUnpaid)}.`),
			textElement('p', `Total Paid Amount at Partial Pay: ${currency.format(result.fullUnpaid)} × ${partialPay}% = ${currency.format(result.partialPaid)}.`),
			textElement('p', `Total Unpaid Amount at Partial Pay: ${currency.format(result.partialUnpaid)}.`),
			textElement('p', 'We keep the exact daily rate while calculating, then round the final totals to cents.', 'help')
		);
		container.append(totals);
	}
	container.append(textElement('p', 'Calendar days include weekends. Work days are Monday–Friday, including weekday holidays. Both the start and end dates count. Days between service periods are left out.', 'help'));
	if (result.portions.length > 1) container.append(textElement('p', `Work Days in Service Period adds together the work days in each full ${term} touched by your leave. Each ${term} uses its own daily rate when pay amounts are calculated.`, 'help'));
}

