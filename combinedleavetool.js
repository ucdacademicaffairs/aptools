'use strict';

function initializePanel(panel, dates, term, periodsPerYear) {
	panel.append(document.getElementById('calculator-template').content.cloneNode(true));
	const field = name => panel.querySelector(`[data-field="${name}"]`);
	panel.querySelectorAll('[data-field]').forEach(element => { element.id = `${term}-${element.dataset.field}`; });
	panel.querySelectorAll('[data-for]').forEach(label => { label.htmlFor = `${term}-${label.dataset.for}`; });
	panel.querySelectorAll('[data-term-title]').forEach(element => { element.textContent = term[0].toUpperCase() + term.slice(1); });
	const form = panel.querySelector('form');
	const startInput = field('leave-start');
	const endInput = field('leave-end');
	const includePay = field('include-pay');
	const payInputs = field('pay-inputs');
	includePay.setAttribute('aria-controls', payInputs.id);
	function updatePayOption() {
		payInputs.hidden = !includePay.checked;
		payInputs.disabled = !includePay.checked;
		includePay.setAttribute('aria-expanded', String(includePay.checked));
		field('calculate').textContent = includePay.checked ? 'Calculate Leave Dates and Pay' : 'Convert Leave Dates';
		field('results').hidden = true;
		field('error').hidden = true;
	}
	includePay.addEventListener('change', updatePayOption);
	updatePayOption();
	const ordered = Object.entries(dates).sort((a, b) => a[1].serviceStart.localeCompare(b[1].serviceStart));
	const earliest = ordered[0][1].serviceStart;
	const latest = ordered[ordered.length - 1][1].serviceEnd;
	[startInput, endInput].forEach(input => { input.min = earliest; input.max = latest; });
	field('coverage').textContent = `${term[0].toUpperCase() + term.slice(1)} dates on file run from ${formatDate(earliest)} to ${formatDate(latest)}.`;
	field('pay-formula').textContent = `Work days are Monday–Friday; weekday holidays are included. Daily rate = (Annual Salary ÷ ${periodsPerYear}) ÷ Work Days in the Service Period.`;
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
			const annualSalary = includePay.checked ? Number(field('annual-salary').value) : null;
			const partialPay = includePay.checked ? Number(field('partial-pay').value) : 0;
			if (end < start) throw new Error('Leave End Date cannot be before Leave Start Date.');
			if (start < earliest || end > latest) throw new Error('Choose leave dates within the dates on file.');
			if (includePay.checked && (!Number.isFinite(annualSalary) || annualSalary <= 0)) throw new Error('Enter an annual salary greater than zero.');
			if (!Number.isInteger(partialPay) || partialPay < 0 || partialPay > 99) throw new Error('Partial Pay Percentage must be a whole number from 0 to 99.');
			const result = calculateLeave(dates, start, end, annualSalary, partialPay, periodsPerYear);
			field('pay-period').textContent = `${formatDate(result.payStart)} – ${formatDate(result.payEnd)}`;
			field('service-days').textContent = `${result.serviceDays} ${result.serviceDays === 1 ? 'day' : 'days'}`;
			field('service-range').textContent = `${formatDate(result.portions[0].portionStart)} – ${formatDate(result.portions[result.portions.length - 1].portionEnd)}, across ${result.portions.map(portion => portion.name).join(', ')}`;
			field('service-workdays').textContent = result.serviceWorkDays;
			field('leave-workdays').textContent = result.leaveWorkDays;
			field('pay-results').hidden = !includePay.checked;
			field('monthly-pay').textContent = includePay.checked ? currency.format(result.monthlyPay) : '';
			field('partial-paid').textContent = includePay.checked ? currency.format(result.partialPaid) : '';
			field('partial-unpaid').textContent = includePay.checked ? currency.format(result.partialUnpaid) : '';
			field('break-note').hidden = !result.breakDays;
			field('break-note').textContent = `${result.breakDays} calendar days fall between service periods. These days are excluded from service-day and work-day totals.`;
			renderWork(field('work'), result, annualSalary, partialPay, periodsPerYear, term);
			field('work-details').open = false;
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
