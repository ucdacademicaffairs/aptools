'use strict';

const ENTITLEMENT_TYPES = ['PDLL', 'FMLA', 'CFRA', 'PFCB'];
const ENTITLEMENT_DAY_MS = 86400000;

function entitlementDay(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) {
		throw new Error('Enter a valid date.');
	}
	const date = new Date(`${value}T00:00:00Z`);
	if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
		throw new Error('Enter a valid date.');
	}
	return Math.floor(date.getTime() / ENTITLEMENT_DAY_MS);
}

function entitlementDayCounts(start, end) {
	const first = entitlementDay(start);
	const last = entitlementDay(end);
	if (last < first) throw new Error('End date must be on or after start date.');
	return countEntitlementInterval(first, last);
}

function countEntitlementInterval(first, last) {
	const calendarDays = last - first + 1;
	let weekdays = Math.floor(calendarDays / 7) * 5;
	const startDay = new Date(first * ENTITLEMENT_DAY_MS).getUTCDay();
	for (let offset = 0; offset < calendarDays % 7; offset++) {
		const weekday = (startDay + offset) % 7;
		if (weekday !== 0 && weekday !== 6) weekdays++;
	}
	return { calendarDays, weekdays };
}

function summarizeEntitlements(periods) {
	if (!periods.length) throw new Error('Add at least one leave period before calculating.');
	const validated = periods.map((period, index) => {
		try {
			const first = entitlementDay(period.start);
			const last = entitlementDay(period.end);
			if (last < first) throw new Error('End date must be on or after start date.');
			if (!period.entitlements.length) throw new Error('Select at least one applicable entitlement.');
			if (period.entitlements.some(type => !ENTITLEMENT_TYPES.includes(type))) {
				throw new Error('Choose one of the listed entitlements.');
			}
			return { ...period, first, last };
		} catch (error) {
			error.periodIndex = index;
			error.message = `Leave Period ${index + 1}: ${error.message}`;
			throw error;
		}
	});
	return ENTITLEMENT_TYPES.flatMap(type => {
		const selected = validated.filter(period => period.entitlements.includes(type))
			.sort((a, b) => a.first - b.first || a.last - b.last);
		if (!selected.length) return [];
		const merged = [];
		selected.forEach(period => {
			const previous = merged[merged.length - 1];
			if (previous && period.first <= previous.last + 1) {
				previous.last = Math.max(previous.last, period.last);
			} else {
				merged.push({ first: period.first, last: period.last });
			}
		});
		const counts = merged.reduce((total, interval) => {
			const next = countEntitlementInterval(interval.first, interval.last);
			return { calendarDays: total.calendarDays + next.calendarDays, weekdays: total.weekdays + next.weekdays };
		}, { calendarDays: 0, weekdays: 0 });
		const unmergedDays = selected.reduce((total, period) => total + period.last - period.first + 1, 0);
		return [{ type, periods: selected.map(({ start, end }) => ({ start, end })),
			calendarDays: type === 'PFCB' ? null : counts.calendarDays,
			weekdays: type === 'PDLL' ? null : counts.weekdays,
			weeks: type === 'PDLL' ? counts.calendarDays / 7 : null,
			remaining: type === 'PDLL' ? null : type === 'PFCB' ? 56 - counts.weekdays : 84 - counts.calendarDays,
			remainingUnit: type === 'PFCB' ? 'workdays' : type === 'PDLL' ? null : 'calendar days',
			hasOverlap: unmergedDays > counts.calendarDays }];
	});
}

function formatEntitlementDate(value) {
	return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', {
		month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'
	});
}

function createEntitlementSummaryCard(result) {
	const element = (tag, text, className) => {
		const node = document.createElement(tag);
		if (text !== null) node.textContent = text;
		if (className) node.className = className;
		return node;
	};
	const formatNumber = value => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
	const unit = result.type === 'PFCB' ? 'workdays' : 'calendar days';
	const used = result.type === 'PFCB' ? result.weekdays : result.calendarDays;
	const card = element('article', null, 'entitlement-card');
	card.dataset.entitlement = result.type;
	card.dataset.flipped = 'false';
	card.setAttribute('aria-label', `${result.type} entitlement`);
	const front = element('div', null, 'entitlement-face entitlement-front');
	const back = element('div', null, 'entitlement-face entitlement-back');
	front.id = `entitlement-${result.type}-front`;
	back.id = `entitlement-${result.type}-back`;
	back.hidden = true;
	front.append(element('h3', result.type));
	const metrics = element('dl', null, 'entitlement-totals');
	function metric(label, value, measure, key) {
		const group = element('div', null);
		const amount = element('dd', null);
		const number = element('span', formatNumber(value), 'metric-number');
		number.dataset.metric = key;
		amount.append(number, element('span', measure, 'metric-unit'));
		group.append(element('dt', label), amount);
		metrics.append(group);
	}
	metric('Used', used, unit, 'used');
	if (result.remaining !== null) metric('Remaining', result.remaining, unit, 'remaining');
	else metric('Weeks', result.weeks, 'weeks', 'weeks');
	front.append(metrics);
	const viewButton = element('button', 'View periods & calculation', 'flip-card-button');
	viewButton.type = 'button';
	viewButton.setAttribute('aria-label', `Show ${result.type} leave periods and calculation`);
	viewButton.setAttribute('aria-controls', back.id);
	front.append(viewButton);
	back.append(element('h3', `${result.type} · Details`));
	const list = element('ul', null, 'period-list');
	result.periods.forEach(period => {
		const counts = entitlementDayCounts(period.start, period.end);
		const amount = result.type === 'PFCB' ? counts.weekdays : counts.calendarDays;
		list.append(element('li', `${formatEntitlementDate(period.start)} – ${formatEntitlementDate(period.end)} (${amount} ${unit})`));
	});
	back.append(list);
	if (result.hasOverlap) back.append(element('p', 'These periods overlap. The used total counts each date once, so the individual period amounts may add up to more than the total.', 'overlap-note'));
	back.append(element('h4', 'How this is calculated'));
	back.append(element('p', result.type === 'PFCB'
		? 'Count Monday–Friday workdays in the selected periods, including weekday holidays.'
		: 'Count calendar days in the selected periods, including both the start and end date.'));
	back.append(element('p', `Total used: ${used} ${unit}.`));
	if (result.type === 'PDLL') {
		back.append(element('p', `Weeks = ${used} ÷ 7 = ${formatNumber(result.weeks)} weeks.`));
	} else {
		const allowance = result.type === 'PFCB' ? 56 : 84;
		back.append(element('p', `Remaining = ${allowance} − ${used} = ${result.remaining} ${unit}.`));
	}
	const returnButton = element('button', 'Back to summary', 'flip-card-button');
	returnButton.type = 'button';
	returnButton.setAttribute('aria-label', `Back to ${result.type} summary`);
	returnButton.setAttribute('aria-controls', front.id);
	back.append(returnButton);
	function flip(showBack) {
		front.hidden = showBack;
		back.hidden = !showBack;
		card.dataset.flipped = String(showBack);
		const incoming = showBack ? back : front;
		if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			incoming.animate([{ transform: 'rotateY(-90deg)', opacity: 0.4 }, { transform: 'rotateY(0deg)', opacity: 1 }], { duration: 180, easing: 'ease-out' });
		}
		(showBack ? returnButton : viewButton).focus({ preventScroll: true });
	}
	viewButton.addEventListener('click', () => flip(true));
	returnButton.addEventListener('click', () => flip(false));
	card.addEventListener('keydown', event => {
		if (event.key === 'Escape' && !back.hidden) {
			event.preventDefault();
			flip(false);
		}
	});
	card.append(front, back);
	return card;
}

document.addEventListener('DOMContentLoaded', () => {
	const form = document.getElementById('entitlement-form');
	const periodsContainer = document.getElementById('leave-periods');
	const addButton = document.getElementById('add-period');
	const errorMessage = document.getElementById('form-error');
	const summary = document.getElementById('entitlement-summary');
	const announcements = document.getElementById('announcements');
	let nextId = 1;
	const cards = () => [...periodsContainer.querySelectorAll('.leave-period')];
	const field = (card, name) => card.querySelector(`[data-field="${name}"]`);
	function invalidate() {
		if (!summary.hidden) announcements.textContent = 'Leave periods changed. Calculate again to update the summary.';
		summary.hidden = true;
		errorMessage.hidden = true;
	}
	function renumber() {
		const periods = cards();
		periods.forEach((card, index) => {
			field(card, 'heading').textContent = `Leave Period ${index + 1}`;
			field(card, 'remove').setAttribute('aria-label', `Remove Leave Period ${index + 1}`);
		});
		document.getElementById('period-count').textContent = `${periods.length} leave ${periods.length === 1 ? 'period' : 'periods'}`;
		document.getElementById('empty-periods').hidden = periods.length > 0;
	}
	function addPeriod(focus = true) {
		invalidate();
		const card = document.getElementById('period-template').content.firstElementChild.cloneNode(true);
		const prefix = `leave-${nextId++}`;
		card.querySelectorAll('[data-field]').forEach(element => { element.id = `${prefix}-${element.dataset.field}`; });
		card.querySelectorAll('[data-for]').forEach(label => { label.htmlFor = `${prefix}-${label.dataset.for}`; });
		card.setAttribute('aria-labelledby', field(card, 'heading').id);
		card.addEventListener('input', () => {
			invalidate();
			field(card, 'end').min = field(card, 'start').value;
		});
		field(card, 'remove').addEventListener('click', () => {
			const index = cards().indexOf(card);
			invalidate();
			card.remove();
			renumber();
			const remaining = cards();
			const next = remaining[Math.min(index, remaining.length - 1)];
			if (next) field(next, 'start').focus();
			else addButton.focus();
			announcements.textContent = `Leave period removed. ${remaining.length} remaining.`;
		});
		periodsContainer.append(card);
		renumber();
		if (focus) {
			field(card, 'start').focus();
			announcements.textContent = `Leave Period ${cards().length} added.`;
		}
	}
	function renderSummary(results) {
		const container = document.getElementById('summary-cards');
		container.replaceChildren(...results.map(createEntitlementSummaryCard));
		summary.hidden = false;
		document.getElementById('summary-heading').focus();
		announcements.textContent = 'Entitlement summary calculated for ' + cards().length + ' leave periods and ' + results.length + ' entitlements.';
	}
	addButton.addEventListener('click', () => addPeriod());
	form.addEventListener('submit', event => {
		event.preventDefault();
		invalidate();
		if (!form.reportValidity()) return;
		try {
			const periods = cards().map(card => ({
				start: field(card, 'start').value,
				end: field(card, 'end').value,
				entitlements: [...card.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value)
			}));
			renderSummary(summarizeEntitlements(periods));
		} catch (error) {
			errorMessage.textContent = error.message;
			errorMessage.hidden = false;
			const card = cards()[error.periodIndex];
			if (card) card.querySelector('input[type="checkbox"]').focus();
			else addButton.focus();
		}
	});
	addPeriod(false);
});
