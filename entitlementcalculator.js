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

function resolveCfraEvent(events, selectedId) {
	return events.length === 1 ? events[0] : events.find(event => event.id === selectedId) || null;
}

function isCompleteEntitlementEvent(event) {
	try {
		entitlementDay(event.date);
		return Boolean(event.id) && ['Birth', 'Placement', 'Adoption'].includes(event.type);
	} catch { return false; }
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

function mergeEntitlementIntervals(periods) {
	const merged = [];
	[...periods].sort((a, b) => a.first - b.first || a.last - b.last).forEach(period => {
		const previous = merged[merged.length - 1];
		if (previous && period.first <= previous.last + 1) previous.last = Math.max(previous.last, period.last);
		else merged.push({ first: period.first, last: period.last });
	});
	return merged;
}

function summarizeEntitlements(periods, events = []) {
	if (!periods.length) throw new Error('Add at least one leave period before calculating.');
	const completeEvents = events.filter(isCompleteEntitlementEvent);
	const validated = periods.map((period, index) => {
		try {
			const first = entitlementDay(period.start);
			const last = entitlementDay(period.end);
			if (last < first) throw new Error('End date must be on or after start date.');
			if (!period.entitlements.length) throw new Error('Select at least one applicable entitlement.');
			if (period.entitlements.some(type => !ENTITLEMENT_TYPES.includes(type))) {
				throw new Error('Choose one of the listed entitlements.');
			}
			if (period.entitlements.includes('PDLL') && period.entitlements.some(type => type === 'CFRA' || type === 'PFCB')) {
				throw new Error('PDLL cannot be combined with CFRA or PFCB in the same leave period.');
			}
			if (period.entitlements.includes('PDLL') && !completeEvents.some(event => event.type === 'Birth')) {
				throw new Error('Enter a complete Birth event to use PDLL.');
			}
			const event = period.entitlements.includes('CFRA') ? completeEvents.find(event => event.id === period.eventId) : null;
			if (period.entitlements.includes('CFRA') && !event) {
				throw new Error('Enter a complete Birth, Placement, or Adoption event and associate it with this CFRA leave.');
			}
			return { ...period, first, last, eventDate: event?.date || '', eventType: event?.type || '' };
		} catch (error) {
			error.periodIndex = index;
			error.message = `Date range ${index + 1}: ${error.message}`;
			throw error;
		}
	});
	return ENTITLEMENT_TYPES.flatMap(type => {
		const selected = validated.filter(period => period.entitlements.includes(type))
			.sort((a, b) => a.first - b.first || a.last - b.last);
		if (!selected.length) return [];
		const merged = mergeEntitlementIntervals(selected);
		const counts = merged.reduce((total, interval) => {
			const next = countEntitlementInterval(interval.first, interval.last);
			return { calendarDays: total.calendarDays + next.calendarDays, weekdays: total.weekdays + next.weekdays };
		}, { calendarDays: 0, weekdays: 0 });
		const unmergedDays = selected.reduce((total, period) => total + period.last - period.first + 1, 0);
		const annual = type === 'FMLA' || type === 'PFCB';
		const eventBalances = type === 'CFRA' ? [...completeEvents]
			.sort((a, b) => b.date.localeCompare(a.date))
			.map(event => {
				const periods = selected.filter(period => period.eventId === event.id);
				const used = mergeEntitlementIntervals(periods).reduce((total, interval) => total + interval.last - interval.first + 1, 0);
				return { event, used, remaining: 84 - used, periods: periods.map(({ start, end }) => ({ start, end })),
					hasOverlap: periods.reduce((total, period) => total + period.last - period.first + 1, 0) > used };
			}) : [];
		const yearly = [];
		if (annual) {
			const years = new Set();
			selected.forEach(period => {
				for (let year = Number(period.start.slice(0, 4)); year <= Number(period.end.slice(0, 4)); year++) years.add(year);
			});
			[...years].sort((a, b) => a - b).forEach(year => {
				const yearStart = `${String(year).padStart(4, '0')}-01-01`;
				const yearEnd = `${String(year).padStart(4, '0')}-12-31`;
				const first = entitlementDay(yearStart);
				const last = entitlementDay(yearEnd);
				const used = merged.reduce((total, interval) => {
					const start = Math.max(first, interval.first);
					const end = Math.min(last, interval.last);
					if (start > end) return total;
					const days = countEntitlementInterval(start, end);
					return total + (type === 'PFCB' ? days.weekdays : days.calendarDays);
				}, 0);
				yearly.push({ year, used, remaining: (type === 'PFCB' ? 40 : 84) - used,
					periods: selected.filter(period => period.start <= yearEnd && period.end >= yearStart)
						.map(period => ({ start: period.start < yearStart ? yearStart : period.start, end: period.end > yearEnd ? yearEnd : period.end })) });
			});
		}
		return [{ type, periods: selected.map(({ start, end, eventDate, eventType }) => ({ start, end, ...(type === 'CFRA' && eventDate ? { eventDate, ...(eventType ? { eventType } : {}) } : {}) })),
			yearly,
			eventBalances,
			calendarDays: type === 'PFCB' ? null : counts.calendarDays,
			weekdays: type === 'PDLL' ? null : counts.weekdays,
			weeks: type === 'PDLL' ? counts.calendarDays / 7 : null,
			remaining: type === 'CFRA' ? (eventBalances.length === 1 ? eventBalances[0].remaining : null) : annual ? (yearly.length === 1 ? yearly[0].remaining : null) : null,
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
	function heading(text) {
		const title = element('h3', text, 'entitlement-card-heading');
		return title;
	}
	front.append(heading(result.type));
	function metric(metrics, label, value, measure, key) {
		const group = element('div', null);
		const amount = element('dd', null);
		const number = element('span', formatNumber(value), 'metric-number');
		number.dataset.metric = key;
		amount.append(number, element('span', measure, 'metric-unit'));
		group.append(element('dt', label), amount);
		metrics.append(group);
	}
	const balances = result.type === 'CFRA' ? result.eventBalances : result.yearly;
	const balanceLabel = balance => balance.event ? `${balance.event.type} — ${formatEntitlementDate(balance.event.date)}` : String(balance.year);
	if (balances.length) {
		balances.forEach(balance => {
			const section = element('section', null, 'annual-balance');
			if (balance.event) section.dataset.eventId = balance.event.id;
			else section.dataset.year = balance.year;
			section.append(element('h4', balanceLabel(balance)));
			const metrics = element('dl', null, 'entitlement-totals');
			metric(metrics, 'Used', balance.used, unit, 'used');
			metric(metrics, 'Remaining', balance.remaining, unit, 'remaining');
			section.append(metrics);
			front.append(section);
		});
	} else {
		const metrics = element('dl', null, 'entitlement-totals');
		metric(metrics, 'Used', used, unit, 'used');
		if (result.remaining !== null) metric(metrics, 'Remaining', result.remaining, unit, 'remaining');
		else metric(metrics, 'Weeks', result.weeks, 'weeks', 'weeks');
		front.append(metrics);
	}
	const viewButton = element('button', 'View periods & calculation', 'flip-card-button');
	viewButton.type = 'button';
	viewButton.setAttribute('aria-label', `Show ${result.type} leave periods and calculation`);
	viewButton.setAttribute('aria-controls', back.id);
	front.append(viewButton);
	back.append(heading(`${result.type} · Details`));
	function periodList(periods) {
		const list = element('ul', null, 'period-list');
		periods.forEach(period => {
			const counts = entitlementDayCounts(period.start, period.end);
			const amount = result.type === 'PFCB' ? counts.weekdays : counts.calendarDays;
			const item = element('li', `${formatEntitlementDate(period.start)} – ${formatEntitlementDate(period.end)} (${amount} ${unit})`);
			if (period.eventDate) item.append(element('span', `${period.eventType || 'Event'}: ${formatEntitlementDate(period.eventDate)}`, 'event-date-note'));
			list.append(item);
		});
		return list;
	}
	if (balances.length) {
		balances.forEach(balance => {
			back.append(element('h4', balanceLabel(balance)));
			if (balance.periods.length) back.append(periodList(balance.periods));
			else back.append(element('p', 'No CFRA leave associated with this event.'));
			back.append(element('p', `Used: ${balance.used} ${unit}. Remaining = ${result.type === 'PFCB' ? 40 : 84} − ${balance.used} = ${balance.remaining} ${unit}.`));
			if (balance.hasOverlap) back.append(element('p', 'Overlapping dates for this event count once.', 'overlap-note'));
		});
	} else back.append(periodList(result.periods));
	if (result.type !== 'CFRA' && result.hasOverlap) back.append(element('p', 'These periods overlap. The used total counts each date once, so the individual period amounts may add up to more than the total.', 'overlap-note'));
	back.append(element('h4', 'How this is calculated'));
	back.append(element('p', result.type === 'PFCB'
		? 'Count Monday–Friday workdays in the selected periods, including weekday holidays.'
		: 'Count calendar days in the selected periods, including both the start and end date.'));
	if (result.type === 'CFRA') {
		back.append(element('p', 'Each event has its own 84-calendar-day allowance. Add the unique calendar days from CFRA leave associated with that event, then subtract them from 84. The balance stays with the event when leave crosses calendar years.'));
	} else if (result.yearly.length) {
		back.append(element('p', `Each calendar year starts with ${result.type === 'PFCB' ? '40 workdays' : '84 calendar days'}. Split leave at January 1 and subtract only the days used in that year. Overlapping dates count once per year.`));
	} else if (result.type === 'PDLL') {
		back.append(element('p', `Weeks = ${used} ÷ 7 = ${formatNumber(result.weeks)} weeks.`));
	} else {
		const allowance = 84;
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
	const eventsContainer = document.getElementById('event-entries');
	const addEventButton = document.getElementById('add-event');
	let nextId = 1;
	let nextEventId = 1;
	const cards = () => [...periodsContainer.querySelectorAll('.leave-period')];
	const field = (card, name) => card.querySelector(`[data-field="${name}"]`);
	function collectEvents() {
		return [...eventsContainer.querySelectorAll('.event-entry')].flatMap(row => {
			const date = row.querySelector('[data-event-field="date"]').value;
			const type = row.querySelector('input[type="radio"]:checked')?.value;
			try { entitlementDay(date); } catch { return []; }
			return type ? [{ id: row.dataset.eventId, date, type }] : [];
		});
	}
	const eventLabel = event => `${event.type} — ${formatEntitlementDate(event.date)}`;
	function collectPeriods() {
		const events = collectEvents();
		return cards().map(card => {
			const entitlements = [...card.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value);
			const event = entitlements.includes('CFRA') ? resolveCfraEvent(events, card.dataset.eventId) : null;
			return {
				start: field(card, 'start').value,
				end: field(card, 'end').value,
				entitlements,
				eventId: event?.id || '',
				eventDate: event?.date || '',
				eventType: event?.type || ''
			};
		});
	}
	function updateCfraEvent(card) {
		const selected = card.querySelector('input[value="CFRA"]').checked;
		const events = collectEvents();
		const event = resolveCfraEvent(events, card.dataset.eventId);
		card.dataset.eventId = event?.id || '';
		const choice = field(card, 'event-choice');
		const options = [new Option('Select an event', ''), ...events.map(item => new Option(eventLabel(item), item.id))];
		choice.replaceChildren(...options);
		choice.value = event?.id || '';
		choice.hidden = events.length === 1;
		choice.disabled = !selected || events.length === 1;
		choice.required = selected && events.length !== 1;
		field(card, 'event-choice-label').hidden = choice.hidden;
		field(card, 'assigned-event').hidden = events.length !== 1;
		field(card, 'assigned-event').textContent = events.length === 1 ? `CFRA event: ${eventLabel(events[0])}` : '';
		field(card, 'event-help').textContent = !events.length
			? 'Required for CFRA: enter an event date and type above, then associate the event with this leave.'
			: 'CFRA leave counts toward the 84-calendar-day allowance for its associated event.';
		field(card, 'event-section').hidden = !selected;
		card.querySelector('input[value="CFRA"]').setAttribute('aria-expanded', String(selected));
	}
	function syncEvents() {
		cards().forEach(card => {
			updateEntitlementChoices(card, true);
			updateCfraEvent(card);
		});	}
	function addEvent(focus = true) {
		invalidate();
		const row = document.getElementById('event-template').content.firstElementChild.cloneNode(true);
		const id = `event-${nextEventId++}`;
		row.dataset.eventId = id;
		const date = row.querySelector('[data-event-field="date"]');
		date.id = `${id}-date`;
		row.querySelector('[data-event-for="date"]').htmlFor = date.id;
		const radios = [...row.querySelectorAll('input[type="radio"]')];
		radios.forEach(radio => { radio.name = `${id}-type`; });
		row.addEventListener('input', () => {
			invalidate();
			const started = Boolean(date.value || date.validity.badInput || radios.some(radio => radio.checked));
			date.required = started;
			radios.forEach(radio => { radio.required = started; });
			// Keep existing associations while an event is only partly entered.
			if (!started || (date.value && radios.some(radio => radio.checked))) syncEvents();
			else cards().forEach(card => updateEntitlementChoices(card));
		});
		row.addEventListener('change', () => {
			// A committed edit/removal must not leave PDLL selected without a Birth event.
			cards().forEach(card => updateEntitlementChoices(card, true));
		});
		row.querySelector('[data-event-field="remove"]').addEventListener('click', () => {
			invalidate();
			row.remove();
			syncEvents();
			addEventButton.focus();
			announcements.textContent = 'Event removed. CFRA event associations updated.';
		});
		eventsContainer.append(row);
		if (focus) date.focus();
	}
	function updateEntitlementChoices(card, clearUnavailable = false) {
		const checkbox = type => card.querySelector(`input[value="${type}"]`);
		const hasBirth = collectEvents().some(event => event.type === 'Birth');
		if (!hasBirth && clearUnavailable && checkbox('PDLL').checked) {
			checkbox('PDLL').checked = false;
			announcements.textContent = 'PDLL deselected because no complete Birth event is entered.';
		}
		checkbox('PDLL').disabled = !hasBirth || checkbox('CFRA').checked || checkbox('PFCB').checked;
		checkbox('PDLL').closest('label').title = hasBirth ? '' : 'Enter a complete Birth event above to use PDLL.';
		checkbox('CFRA').disabled = checkbox('PDLL').checked;
		checkbox('PFCB').disabled = checkbox('PDLL').checked;
	}
	function invalidate() {
		if (!summary.hidden) announcements.textContent = 'Leave periods changed. Calculate again to update the summary.';
		summary.hidden = true;
		errorMessage.hidden = true;
	}
	function renumber() {
		const periods = cards();
		periods.forEach((card, index) => {
			card.setAttribute('aria-label', `Leave dates ${index + 1}`);
			field(card, 'remove').setAttribute('aria-label', `Remove date range ${index + 1}`);
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
		const cfraCheckbox = card.querySelector('input[value="CFRA"]');
		cfraCheckbox.setAttribute('aria-controls', field(card, 'event-section').id);
		cfraCheckbox.setAttribute('aria-expanded', 'false');
		field(card, 'event-choice').setAttribute('aria-describedby', field(card, 'event-help').id);
		card.addEventListener('input', event => {
			invalidate();
			if (event.target.matches('input[name="entitlements"]')) updateEntitlementChoices(card);
			const start = field(card, 'start');
			const end = field(card, 'end');
			// Changing a native date input's constraints can clear a partly typed date.
			if (event.target === start && end.min !== start.value) end.min = start.value;
			if (event.target === cfraCheckbox) {
				updateCfraEvent(card);
			}
			if (event.target === field(card, 'event-choice')) {
				card.dataset.eventId = event.target.value;
				updateCfraEvent(card);
			}		});
		field(card, 'remove').addEventListener('click', () => {
			const index = cards().indexOf(card);
			invalidate();
			card.remove();
			renumber();			const remaining = cards();
			const next = remaining[Math.min(index, remaining.length - 1)];
			if (next) field(next, 'start').focus();
			else addButton.focus();
			announcements.textContent = `Leave period removed. ${remaining.length} remaining.`;
		});
		periodsContainer.append(card);
		updateEntitlementChoices(card);
		updateCfraEvent(card);
		renumber();
		if (focus) {
			field(card, 'start').focus();
			announcements.textContent = `Date range ${cards().length} added.`;
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
	addEventButton.addEventListener('click', () => addEvent());
	form.addEventListener('submit', event => {
		event.preventDefault();
		invalidate();
		if (!form.reportValidity()) return;
		try {
			const periods = collectPeriods();
			renderSummary(summarizeEntitlements(periods, collectEvents()));
		} catch (error) {
			errorMessage.textContent = error.message;
			errorMessage.hidden = false;
			const card = cards()[error.periodIndex];
			if (card) card.querySelector('input[type="checkbox"]').focus();
			else addButton.focus();
		}
	});
	addEvent(false);
	addPeriod(false);
});
