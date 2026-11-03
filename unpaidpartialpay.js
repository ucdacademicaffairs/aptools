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

function calculateLeave(dates, start, end, annualSalary, partialPay, periodsPerYear) {
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
			const periodSalary = annualSalary / periodsPerYear;
			const dailyRate = periodSalary / serviceWorkDays;
			const fullUnpaid = dailyRate * leaveWorkDays;
			return [{ name, period, portionStart, portionEnd, serviceDays, leaveDays, payDays,
				daysBefore, payDaysBefore, convertedDays, payStart, payEnd, runsToEnd,
				serviceWorkDays, leaveWorkDays, periodSalary, dailyRate, fullUnpaid }];
		});
	if (!portions.length) throw new Error('These dates fall entirely between service periods. There are no service days on leave to calculate.');
	const sum = key => portions.reduce((total, portion) => total + portion[key], 0);
	const fullUnpaid = sum('fullUnpaid');
	return {
		portions, payStart: portions[0].payStart, payEnd: portions[portions.length - 1].payEnd,
		serviceDays: sum('leaveDays'), serviceWorkDays: sum('serviceWorkDays'),
		leaveWorkDays: sum('leaveWorkDays'), breakDays: calendarDays(start, end) - sum('leaveDays'),
		fullUnpaid, partialUnpaid: fullUnpaid * (100 - partialPay) / 100
	};
}

function textElement(tag, text, className) {
	const element = document.createElement(tag);
	element.textContent = text;
	if (className) element.className = className;
	return element;
}

function renderWork(container, result, annualSalary, partialPay, periodsPerYear, term) {
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
				: `Pay end = ${formatDate(portion.payStart)} + ${portion.convertedDays} days − 1 (inclusive) = ${formatDate(portion.payEnd)}.`,
			`${term[0].toUpperCase() + term.slice(1)} salary = ${currency.format(annualSalary)} ÷ ${periodsPerYear} = ${currency.format(portion.periodSalary)}.`,
			`Daily rate = (${currency.format(annualSalary)} ÷ ${periodsPerYear}) ÷ ${portion.serviceWorkDays} = $${portion.dailyRate.toFixed(6)} per work day.`,
			`Full unpaid amount = daily rate × ${portion.leaveWorkDays} work days on leave = ${currency.format(portion.fullUnpaid)}.`
		];
		lines.forEach(line => section.append(textElement('p', line)));
		container.append(section);
	});
	container.append(
		textElement('p', `Total Full Unpaid Amount = sum of the unpaid amounts for the affected ${term}s = ${currency.format(result.fullUnpaid)}.`),
		textElement('p', `Total Unpaid Amount at Partial Pay = full unpaid amount × (100 − ${partialPay}) ÷ 100 = ${currency.format(result.partialUnpaid)}.`),
		textElement('p', `Daily rates and intermediate amounts retain full precision; final totals are rounded to cents. Work days count Monday–Friday, including holidays that fall on weekdays. Calendar dates count both start and end dates. When a leave spans multiple ${term}s, the work days in service period total sums the complete service periods touched by the leave.`, 'help')
	);
}

function initializePanel(panel, dates, term, periodsPerYear) {
	panel.append(document.getElementById('calculator-template').content.cloneNode(true));
	const field = name => panel.querySelector(`[data-field="${name}"]`);
	panel.querySelectorAll('[data-field]').forEach(element => { element.id = `${term}-${element.dataset.field}`; });
	panel.querySelectorAll('[data-for]').forEach(label => { label.htmlFor = `${term}-${label.dataset.for}`; });
	panel.querySelectorAll('[data-term-title]').forEach(element => { element.textContent = term[0].toUpperCase() + term.slice(1); });
	const form = panel.querySelector('form');
	const startInput = field('leave-start');
	const endInput = field('leave-end');
	const ordered = Object.entries(dates).sort((a, b) => a[1].serviceStart.localeCompare(b[1].serviceStart));
	const earliest = ordered[0][1].serviceStart;
	const latest = ordered[ordered.length - 1][1].serviceEnd;
	[startInput, endInput].forEach(input => { input.min = earliest; input.max = latest; });
	field('coverage').textContent = `${term[0].toUpperCase() + term.slice(1)} dates on file run from ${formatDate(earliest)} to ${formatDate(latest)}.`;
	field('workday-definition').textContent = `Work days are Monday–Friday; weekday holidays are included. Daily rate = (Annual Salary ÷ ${periodsPerYear}) ÷ Work Days in the Service Period.`;
	field('percentage-help').textContent = 'Enter the percentage of normal pay received, from 0 to 99 in whole percentages. 0% means fully unpaid.';
	field('partial-pay').setAttribute('aria-describedby', field('percentage-help').id);
	ordered.slice().reverse().forEach(([name, period]) => {
		const row = document.createElement('tr');
		[name, `${formatDate(period.serviceStart)} – ${formatDate(period.serviceEnd)}`, `${formatDate(period.payStart)} – ${formatDate(period.payEnd)}`]
			.forEach(value => row.append(textElement('td', value)));
		field('base-dates').append(row);
	});
	form.addEventListener('input', event => {
		field('results').hidden = true;
		field('error').hidden = true;
		const minimum = startInput.value || earliest;
		// Leave the native End Date editor alone while a date is partly typed.
		if (event.target === startInput && endInput.min !== minimum) endInput.min = minimum;
	});
	form.addEventListener('submit', event => {
		event.preventDefault();
		field('results').hidden = true;
		field('error').hidden = true;
		try {
			if (!form.reportValidity()) return;
			const start = startInput.value;
			const end = endInput.value;
			const annualSalary = Number(field('annual-salary').value);
			const partialPay = Number(field('partial-pay').value);
			if (end < start) throw new Error('Leave End Date cannot be before Leave Start Date.');
			if (start < earliest || end > latest) throw new Error('Choose leave dates within the dates on file.');
			if (!Number.isFinite(annualSalary) || annualSalary <= 0) throw new Error('Enter an annual salary greater than zero.');
			if (!Number.isInteger(partialPay) || partialPay < 0 || partialPay > 99) throw new Error('Partial Pay Percentage must be a whole number from 0 to 99.');
			const result = calculateLeave(dates, start, end, annualSalary, partialPay, periodsPerYear);
			field('pay-period').textContent = `${formatDate(result.payStart)} – ${formatDate(result.payEnd)}`;
			field('service-days').textContent = result.serviceDays;
			field('service-workdays').textContent = result.serviceWorkDays;
			field('leave-workdays').textContent = result.leaveWorkDays;
			field('full-unpaid').textContent = currency.format(result.fullUnpaid);
			field('partial-unpaid').textContent = currency.format(result.partialUnpaid);
			field('break-note').hidden = !result.breakDays;
			field('break-note').textContent = `${result.breakDays} calendar days fall between service periods. These days are excluded from service-day and work-day totals.`;
			renderWork(field('work'), result, annualSalary, partialPay, periodsPerYear, term);
			field('results').hidden = false;
		} catch (error) {
			field('error').textContent = error.message;
			field('error').hidden = false;
		}
	});
}

document.addEventListener('DOMContentLoaded', async () => {
	const tabs = [...document.querySelectorAll('[role="tab"]')];
	function selectTab(tab) {
		tabs.forEach(item => {
			const selected = item === tab;
			item.setAttribute('aria-selected', String(selected));
			item.tabIndex = selected ? 0 : -1;
			document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
		});
	}
	tabs.forEach((tab, index) => {
		tab.addEventListener('click', () => selectTab(tab));
		tab.addEventListener('keydown', event => {
			let next;
			if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = tabs[1 - index];
			if (event.key === 'Home') next = tabs[0];
			if (event.key === 'End') next = tabs[tabs.length - 1];
			if (next) { event.preventDefault(); selectTab(next); next.focus(); }
		});
	});
	const status = document.getElementById('loading-status');
	try {
		const response = await fetch('calendar-dates.json');
		if (!response.ok) throw new Error('Unable to load calendar dates.');
		const config = await response.json();
		for (const [term, key, divisor] of [['quarter', 'QUARTER_DATES', 3], ['semester', 'SEMESTER_DATES', 2]]) {
			if (!config[key] || !Object.keys(config[key]).length) throw new Error(`Missing ${term} calendar dates.`);
			initializePanel(document.getElementById(`${term}-panel`), config[key], term, divisor);
		}
		status.hidden = true;
	} catch (error) {
		document.querySelectorAll('form input, form button').forEach(element => { element.disabled = true; });
		status.setAttribute('role', 'alert');
		status.textContent = 'Unable to load calendar dates. Please reload to try again.';
		console.error(error);
	}
});
