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
		if (type === 'PDLL' && !completeEvents.some(event => event.type === 'Birth')) return [];
		if (type === 'CFRA' && !completeEvents.length) return [];
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
			validated.forEach(period => {
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

function entitlementLeaveContributions(periods, type) {
	const covered = [];
	let total = 0;
	let rawTotal = 0;
	const amounts = periods.map(period => {
		const first = entitlementDay(period.start); const last = entitlementDay(period.end);
		const raw = countEntitlementInterval(first, last);
		rawTotal += type === 'PFCB' ? raw.weekdays : raw.calendarDays;
		covered.push({ first, last });
		const next = mergeEntitlementIntervals(covered).reduce((sum, interval) => {
			const count = countEntitlementInterval(interval.first, interval.last);
			return sum + (type === 'PFCB' ? count.weekdays : count.calendarDays);
		}, 0);
		const amount = next - total; total = next;
		return amount;
	});
	return { amounts, hasOverlap: rawTotal > total };
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
	const grouping = result.type === 'CFRA' ? 'By event' : result.yearly.length ? 'By calendar year' : '';
	if (grouping) front.append(element('p', grouping, 'balance-group-label'));
	function metric(metrics, label, value, measure, key) {
		const group = element('div', null);
		if (key === 'remaining' && value < 0) {
			label = 'Exceeded by';
			value = Math.abs(value);
			key = 'exceeded';
			group.className = 'overage-metric';
		}
		const amount = element('dd', null);
		const number = element('span', formatNumber(value), 'metric-number');
		number.dataset.metric = key;
		amount.append(number, element('span', measure, 'metric-unit'));
		group.append(element('dt', label), amount);
		metrics.append(group);
	}
	const balances = result.type === 'CFRA' ? result.eventBalances : result.yearly;
	const balanceLabel = balance => balance.event ? `${balance.event.type} — ${formatEntitlementDate(balance.event.date)}` : String(balance.year);
	function appendBalances(parent, render) {
		const hasUsage = balances.some(balance => balance.used > 0);
		const active = result.type === 'CFRA' && hasUsage ? balances.filter(balance => balance.used > 0) : balances;
		active.forEach(balance => parent.append(render(balance)));
		const unused = result.type === 'CFRA' && hasUsage ? balances.filter(balance => balance.used === 0) : [];
		if (unused.length) {
			const details = element('details', null, 'unused-events');
			details.append(element('summary', `Unused events (${unused.length})`));
			unused.forEach(balance => details.append(render(balance)));
			parent.append(details);
		}
	}
	if (balances.length) {
		appendBalances(front, balance => {
			const section = element('section', null, 'annual-balance');
			if (balance.event) section.dataset.eventId = balance.event.id;
			else section.dataset.year = balance.year;
			section.append(element('h4', balanceLabel(balance)));
			const metrics = element('dl', null, 'entitlement-totals');
			metric(metrics, 'Used', balance.used, unit, 'used');
			metric(metrics, 'Remaining', balance.remaining, unit, 'remaining');
			section.append(metrics);
			return section;
		});
	} else {
		const metrics = element('dl', null, 'entitlement-totals');
		metric(metrics, 'Used', used, unit, 'used');
		if (result.remaining !== null) metric(metrics, 'Remaining', result.remaining, unit, 'remaining');
		else metric(metrics, 'Weeks', result.weeks, 'weeks', 'weeks');
		front.append(metrics);
	}
	const toggleButton = element('button', `Show ${result.type} leave periods and calculation`, 'sr-only card-toggle');
	toggleButton.type = 'button';
	toggleButton.setAttribute('aria-controls', back.id);
	toggleButton.setAttribute('aria-expanded', 'false');
	back.append(heading(`${result.type} · Details`));
	back.append(element('h4', 'Leaves', 'detail-section-heading'));
	function periodList(periods) {
		const list = element('ul', null, 'period-list');
		periods.forEach(period => {
			const counts = entitlementDayCounts(period.start, period.end);
			const amount = result.type === 'PFCB' ? counts.weekdays : counts.calendarDays;
			const item = element('li', `${formatEntitlementDate(period.start)} – ${formatEntitlementDate(period.end)} (${amount} ${unit})`);
			list.append(item);
		});
		return list;
	}
	const detailBalances = result.type === 'CFRA' ? balances.filter(balance => balance.periods.length) : [...balances].sort((a, b) => b.year - a.year);
	const grouped = detailBalances.length > 1;
	function detailGroup(parent, balance) {
		let groups = parent.lastElementChild;
		if (!groups?.classList.contains('detail-periods')) {
			groups = element('div', null, 'detail-periods');
			parent.append(groups);
		}
		const group = element('section', null, 'detail-period-group');
		group.append(element('h4', balanceLabel(balance)));
		groups.append(group);
		return group;
	}
	if (detailBalances.length) {
		detailBalances.forEach(balance => {
			const parent = grouped ? detailGroup(back, balance) : back;
			if (balance.periods.length) parent.append(periodList(balance.periods));
			else parent.append(element('p', 'No leave used.'));
		});
	} else if (result.periods.length) back.append(periodList(result.periods));
	else back.append(element('p', 'No leave used.'));
	back.append(element('h4', 'Calculation', 'detail-section-heading'));
	let hasOverlap = false;
	if (result.type === 'PDLL') {
		const contributions = entitlementLeaveContributions(result.periods, result.type);
		back.append(element('p', 'PDLL weeks are calendar days used ÷ 7.'));
		back.append(element('p', `${contributions.amounts.join(' + ') || 0} = ${used} calendar days used. ${used} ÷ 7 = ${formatNumber(result.weeks)} weeks.`));
		hasOverlap = contributions.hasOverlap;
	} else {
		const allowance = result.type === 'PFCB' ? 40 : 84;
		back.append(element('p', result.type === 'CFRA'
			? 'CFRA entitlement is 84 calendar days per associated event.'
			: `${result.type} entitlement is ${allowance} ${unit} per year and resets annually.`, 'calculation-explanation'));
		if (result.type === 'PFCB') back.append(element('p', 'Workdays are Monday–Friday, including weekday holidays.'));
		function calculation(parent, balance) {
			const contributions = entitlementLeaveContributions(balance.periods, result.type);
			const equation = element('ul', null, 'period-list calculation-list');
			equation.append(element('li', `${allowance} − ${contributions.amounts.join(' − ') || 0} = ${balance.remaining} unused, ${balance.used} used.`));
			parent.append(equation);
			if (balance.remaining < 0) parent.append(element('p', `Exceeded by ${Math.abs(balance.remaining)} ${unit}.`, 'overage-note'));
			hasOverlap ||= contributions.hasOverlap;
		}
		detailBalances.forEach(balance => {
			calculation(grouped ? detailGroup(back, balance) : back, balance);
		});
		if (!detailBalances.length) calculation(back, { used: 0, remaining: allowance, periods: [] });
		if (result.type === 'CFRA') {
			const unused = balances.filter(balance => !balance.periods.length);
			if (unused.length) {
				const details = element('details', null, 'unused-events');
				details.append(element('summary', `Unused events (${unused.length})`));
				unused.forEach(balance => calculation(detailGroup(details, balance), balance));
				back.append(details);
			}
		}
	}
	const footer = element('div', null, 'card-detail-footer');
	if (hasOverlap) footer.append(element('p', result.type === 'PDLL'
		? 'Overlapping dates count once. The equation includes only new days from each leave.'
		: 'Overlapping dates count once. The equation subtracts only new days from each leave.', 'overlap-note'));
	footer.append(element('p', 'Click the card to return to balances.', 'card-return-hint'));
	back.append(footer);
	function flip(showBack) {
		front.hidden = showBack;
		back.hidden = !showBack;
		card.dataset.flipped = String(showBack);
		toggleButton.textContent = showBack ? `Back to ${result.type} balances` : `Show ${result.type} leave periods and calculation`;
		toggleButton.setAttribute('aria-expanded', String(showBack));
		const incoming = showBack ? back : front;
		if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			incoming.animate([{ transform: 'rotateY(-90deg)', opacity: 0.4 }, { transform: 'rotateY(0deg)', opacity: 1 }], { duration: 180, easing: 'ease-out' });
		}
		toggleButton.focus({ preventScroll: true });
	}
	toggleButton.addEventListener('click', () => flip(back.hidden));
	card.addEventListener('click', event => {
		if (event.target.closest('button, summary, a, input, select, textarea')) return;
		const selection = window.getSelection();
		if (selection?.toString() && card.contains(selection.anchorNode)) return;
		flip(back.hidden);
	});
	card.addEventListener('keydown', event => {
		if (event.key === 'Escape' && !back.hidden) {
			event.preventDefault();
			flip(false);
		}
	});
	card.append(toggleButton, front, back);
	return card;
}

document.addEventListener('DOMContentLoaded', () => {
	const form = document.getElementById('entitlement-form');
	const periodsContainer = document.getElementById('leave-periods');
	const addButton = document.getElementById('add-period');
	const errorMessage = document.getElementById('form-error');
	const summary = document.getElementById('entitlement-summary');
	const announcements = document.getElementById('announcements');
	const events = [];
	let nextId = 1;
	let nextEventId = 1;
	let nextEditorId = 1;
	let validationAttempted = false;
	const cards = () => [...periodsContainer.querySelectorAll('.leave-period')];
	const field = (card, name) => card.querySelector(`[data-field="${name}"]`);
	const eventLabel = event => `${event.type} — ${formatEntitlementDate(event.date)}`;
	const checkbox = (card, type) => card.querySelector(`input[value="${type}"]`);
	function invalidate() {
		if (summary.dataset.calculated === 'true') {
			summary.dataset.stale = 'true';
			document.getElementById('recalculate-notice').hidden = false;
		}
		errorMessage.hidden = true;
		if (validationAttempted) queueMicrotask(() => { if (validationAttempted) validateLeaves(); });
	}
	function validateLeaves(focus = false) {
		let firstInvalid = null;
		cards().forEach(card => {
			const message = field(card, 'validation-message');
			card.classList.remove('has-errors');
			card.querySelectorAll('.needs-correction').forEach(target => {
				target.classList.remove('needs-correction'); target.removeAttribute('aria-invalid');
				const describedBy = (target.getAttribute('aria-describedby') || '').split(' ').filter(id => id && id !== message.id);
				if (describedBy.length) target.setAttribute('aria-describedby', describedBy.join(' ')); else target.removeAttribute('aria-describedby');
			});
			const errors = [];
			function mark(target, text) {
				card.classList.add('has-errors'); target.classList.add('needs-correction'); target.setAttribute('aria-invalid', 'true');
				target.setAttribute('aria-describedby', [...new Set([...(target.getAttribute('aria-describedby') || '').split(' ').filter(Boolean), message.id])].join(' '));
				errors.push(text);
				if (!firstInvalid) firstInvalid = target.matches('fieldset') ? target.querySelector('input:not(:disabled), button:not(:disabled), select:not(:disabled)') : target;
			}
			for (const [name, label] of [['start', 'Start date'], ['end', 'End date']]) {
				if (!field(card, name).validity.valid) mark(field(card, name), `Enter a valid ${label.toLowerCase()}.`);
			}
			if (field(card, 'start').value && field(card, 'end').value && field(card, 'end').value < field(card, 'start').value) {
				mark(field(card, 'end'), 'End date must be on or after start date.');
			}
			if (!card.querySelector('input[name="entitlements"]:checked')) mark(field(card, 'entitlements'), 'Select at least one entitlement.');
			const draft = field(card, 'event-editor').firstElementChild;
			if (draft) {
				let incomplete = false;
				for (const name of ['type', 'date']) {
					const input = draft.querySelector(`[data-editor-field="${name}"]`);
					if (!input.validity.valid) { mark(input, `Enter the event ${name}.`); incomplete = true; }
				}
				if (!incomplete) mark(draft.querySelector('[data-editor-field="save"]'), 'Save or cancel this event before calculating.');
			} else if (checkbox(card, 'PDLL').checked || checkbox(card, 'CFRA').checked) {
				const event = events.find(event => event.id === card.dataset.eventId);
				if (!event || (checkbox(card, 'PDLL').checked && event.type !== 'Birth')) {
					mark(field(card, 'event-choice'), 'Select or add an associated event.');
				}
			}
			const text = [...new Set(errors)].join(' ');
			if (message.textContent !== text) message.textContent = text;
		});
		if (focus && firstInvalid) {
			firstInvalid.focus();
			announcements.textContent = 'Review the highlighted leave periods and fields before calculating.';
		}
		document.getElementById('validation-warning').hidden = !firstInvalid;
		return !firstInvalid;
	}
	function updateChoices(card, autoCreate = false) {
		closeEventMenu(card);
		const pdll = checkbox(card, 'PDLL').checked;
		const cfra = checkbox(card, 'CFRA').checked;
		checkbox(card, 'PDLL').disabled = cfra || checkbox(card, 'PFCB').checked;
		checkbox(card, 'CFRA').disabled = pdll;
		checkbox(card, 'PFCB').disabled = pdll;
		// Missing event details block calculation, not the initial entitlement choice.
		const explanation = pdll ? 'PDLL cannot be combined with CFRA or PFCB.' : '';
		field(card, 'entitlement-help').textContent = explanation;
		field(card, 'entitlement-help').hidden = !explanation;
		const available = pdll ? events.filter(event => event.type === 'Birth') : events;
		const selected = pdll || cfra;
		if (!selected) field(card, 'event-editor').replaceChildren();
		const event = selected ? resolveCfraEvent(available, card.dataset.eventId) : null;
		card.dataset.eventId = event?.id || '';
		const choice = field(card, 'event-choice');
		field(card, 'event-text').textContent = event ? eventLabel(event) : 'Select an event';
		const hasDraft = Boolean(field(card, 'event-editor').firstElementChild);
		field(card, 'event-choice-label').textContent = event && !hasDraft ? 'Associated Event' : 'Associate Event Type';
		choice.setAttribute('aria-label', `${field(card, 'event-choice-label').textContent}: ${event ? eventLabel(event) : 'Select an event'}`);
		choice.removeAttribute('aria-invalid');
		field(card, 'event-choice-label').htmlFor = hasDraft
			? field(card, 'event-editor').querySelector(`[data-editor-field="${pdll ? 'date' : 'type'}"]`).id : choice.id;
		choice.hidden = false;
		choice.disabled = !selected || hasDraft;
		field(card, 'event-selector').hidden = hasDraft;
		field(card, 'event-help').textContent = selected && !available.length ? (pdll ? 'PDLL requires a Birth event.' : 'CFRA requires an event.') : '';
		field(card, 'event-help').hidden = hasDraft || Boolean(available.length) || !selected;
		const draftType = field(card, 'event-editor').querySelector('[data-editor-field="type"]');
		if (draftType) {
			if (pdll) draftType.value = 'Birth';
			draftType.disabled = pdll;
			field(card, 'event-editor').querySelector('[data-editor-for="date"]').textContent = pdll ? 'Birth event date' : 'Event date';
			const editor = field(card, 'event-editor').firstElementChild;
			editor.querySelector('[data-editor-field="save"]').textContent = editor.dataset.editing === 'true' ? 'Edit Event' : 'Add Event';
		}
		field(card, 'event-section').hidden = !selected;
		for (const type of ['PDLL', 'CFRA']) checkbox(card, type).setAttribute('aria-expanded', String(!field(card, 'event-section').hidden));
		if (autoCreate && selected && !available.length && !hasDraft) openEditor(field(card, 'event-editor'), choice, card);
	}
	function closeEventMenu(card, restoreFocus = false) {
		field(card, 'event-menu').hidden = true;
		field(card, 'event-choice').setAttribute('aria-expanded', 'false');
		if (restoreFocus) field(card, 'event-choice').focus({ preventScroll: true });
	}
	function openEventMenu(card, focusLast = false) {
		cards().forEach(other => closeEventMenu(other));
		const menu = field(card, 'event-menu');
		menu.replaceChildren();
		const heading = document.createElement('p');
		heading.className = 'event-menu-heading'; heading.textContent = 'Select an event'; menu.append(heading);
		const available = checkbox(card, 'PDLL').checked ? events.filter(event => event.type === 'Birth') : events;
		function action(text, className, label, onClick) {
			const button = document.createElement('button');
			button.type = 'button'; button.className = className; button.textContent = text;
			button.setAttribute('aria-label', label); button.addEventListener('click', onClick);
			return button;
		}
		available.forEach(event => {
			const row = document.createElement('div'); row.className = 'event-menu-row';
			row.dataset.eventId = event.id;
			const choose = action(eventLabel(event), 'event-option', `Select ${eventLabel(event)}`, () => {
				invalidate(); card.dataset.eventId = event.id; updateChoices(card);
				field(card, 'event-choice').focus({ preventScroll: true });
			});
			choose.setAttribute('aria-pressed', String(event.id === card.dataset.eventId));
			const edit = action('', 'event-icon', `Edit ${eventLabel(event)}`, () => {
				closeEventMenu(card); openEditor(field(card, 'event-editor'), field(card, 'event-choice'), card, event);
			});
			edit.title = `Edit ${eventLabel(event)}`;
			const remove = action('', 'event-icon remove-event-icon', `Remove ${eventLabel(event)} from all leaves`, () => {
				const index = events.indexOf(event); if (index === -1) return;
				invalidate(); events.splice(index, 1); syncEvents();
				field(card, 'event-choice').focus({ preventScroll: true });
				announcements.textContent = 'Event removed from all leaves. Select or add an event where required.';
			});
			remove.title = 'Remove event from all leaves';
			function icon(button, path) {
				const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
				for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', width: '18', height: '18', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(name, value);
				const line = document.createElementNS('http://www.w3.org/2000/svg', 'path'); line.setAttribute('d', path);
				svg.append(line); button.append(svg);
			}
			icon(edit, 'm16 3 5 5-12 12-6 1 1-6Z M14 5l5 5');
			icon(remove, 'm4 4 16 16M20 4 4 20');
			row.append(choose, edit, remove); menu.append(row);
		});
		menu.append(action('+ New event…', 'event-option new-event-option', 'Add a new event', () => {
			closeEventMenu(card); openEditor(field(card, 'event-editor'), field(card, 'event-choice'), card);
		}));
		menu.hidden = false; field(card, 'event-choice').setAttribute('aria-expanded', 'true');
		const bounds = field(card, 'event-choice').getBoundingClientRect();
		menu.classList.toggle('opens-above', window.innerHeight - bounds.bottom < Math.min(menu.scrollHeight, 288) && bounds.top > window.innerHeight - bounds.bottom);
		const buttons = menu.querySelectorAll('button');
		buttons[focusLast ? buttons.length - 1 : 0].focus({ preventScroll: true });
	}
	function syncEvents() {
		cards().forEach(card => updateChoices(card));
	}
	function openEditor(host, trigger, card = null, existing = null) {
		if (host.firstElementChild) {
			host.querySelector('[data-editor-field="date"]').focus({ preventScroll: true });
			return;
		}
		const editor = document.getElementById('event-template').content.firstElementChild.cloneNode(true);
		editor.dataset.editing = String(Boolean(existing));
		const prefix = `event-editor-${nextEditorId++}`;
		const input = name => editor.querySelector(`[data-editor-field="${name}"]`);
		for (const name of ['date', 'type']) {
			input(name).id = `${prefix}-${name}`;
			editor.querySelector(`[data-editor-for="${name}"]`).htmlFor = input(name).id;
		}
		input('heading').textContent = existing ? 'Edit event' : 'New event';
		input('save').textContent = existing ? 'Edit Event' : 'Add Event';
		input('date').value = existing?.date || '';
		input('type').value = existing?.type || '';
		if (card && checkbox(card, 'PDLL').checked) {
			input('type').value = 'Birth';
			input('type').disabled = true;
		}
		function close() {
			editor.remove();
			if (trigger.matches('button')) trigger.setAttribute('aria-expanded', 'false');
			if (card) updateChoices(card);
			if (trigger.isConnected && !trigger.hidden) trigger.focus({ preventScroll: true });
		}
		input('cancel').addEventListener('click', close);
		input('save').addEventListener('click', () => {
			if (!input('date').reportValidity() || !input('type').reportValidity()) return;
			if (existing && !events.includes(existing)) {
				input('error').textContent = 'This event was removed. Cancel and add a new event.';
				input('error').hidden = false; return;
			}
			const event = existing || { id: `event-${nextEventId++}` };
			event.date = input('date').value; event.type = input('type').value;
			if (!isCompleteEntitlementEvent(event)) return;
			if (!existing) events.push(event);
			if (card && !existing) card.dataset.eventId = event.id;
			invalidate(); editor.remove(); syncEvents();
			if (card) field(card, 'event-choice').focus({ preventScroll: true });
			announcements.textContent = `${eventLabel(event)} saved and available to other leaves.`;
		});
		editor.addEventListener('keydown', event => {
			if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
			if (event.key === 'Enter' && event.target.matches('input')) { event.preventDefault(); input('save').click(); }
		});
		host.append(editor);
		if (trigger.matches('button')) trigger.setAttribute('aria-expanded', 'true');
		if (card) updateChoices(card);
		input(card && checkbox(card, 'PDLL').checked ? 'date' : 'type').focus({ preventScroll: true });
	}
	function renumber() {
		cards().forEach((card, index) => {
			card.setAttribute('aria-label', `Leave dates ${index + 1}`);
			field(card, 'remove').setAttribute('aria-label', `Remove date range ${index + 1}`);
		});
		const count = cards().length;
		document.getElementById('period-count').textContent = `${count} leave ${count === 1 ? 'period' : 'periods'}`;
		document.getElementById('empty-periods').hidden = cards().length > 0;
	}
	function addPeriod(focus = true) {
		invalidate();
		const card = document.getElementById('period-template').content.firstElementChild.cloneNode(true);
		const prefix = `leave-${nextId++}`;
		card.querySelectorAll('[data-field]').forEach(element => { element.id = `${prefix}-${element.dataset.field}`; });
		card.querySelectorAll('[data-for]').forEach(label => { label.htmlFor = `${prefix}-${label.dataset.for}`; });
		for (const type of ['PDLL', 'CFRA']) checkbox(card, type).setAttribute('aria-controls', field(card, 'event-section').id);
		card.querySelectorAll('input[name="entitlements"]').forEach(input => input.setAttribute('aria-describedby', field(card, 'entitlement-help').id));
		field(card, 'event-choice').setAttribute('aria-describedby', field(card, 'event-help').id);
		field(card, 'event-choice').setAttribute('aria-controls', field(card, 'event-menu').id);
		field(card, 'event-choice').addEventListener('click', () => {
			if (field(card, 'event-menu').hidden) openEventMenu(card); else closeEventMenu(card);
		});
		field(card, 'event-choice').addEventListener('keydown', event => {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault(); openEventMenu(card, event.key === 'ArrowUp');
			}
		});
		field(card, 'event-menu').addEventListener('keydown', event => {
			if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeEventMenu(card, true); return; }
			const buttons = [...field(card, 'event-menu').querySelectorAll('button')];
			let index = buttons.indexOf(document.activeElement);
			if (event.key === 'ArrowDown') index = (index + 1) % buttons.length;
			else if (event.key === 'ArrowUp') index = (index - 1 + buttons.length) % buttons.length;
			else if (event.key === 'Home') index = 0;
			else if (event.key === 'End') index = buttons.length - 1;
			else return;
			event.preventDefault(); buttons[index].focus();
		});
		field(card, 'event-selector').addEventListener('focusout', event => {
			if (event.relatedTarget && !field(card, 'event-selector').contains(event.relatedTarget)) closeEventMenu(card);
		});
		card.addEventListener('input', event => {
			invalidate();
			const start = field(card, 'start'); const end = field(card, 'end');
			if (event.target === start && end.min !== start.value) end.min = start.value;
			if (event.target.matches('input[name="entitlements"]')) {
				const needsEvent = event.target.checked && ['PDLL', 'CFRA'].includes(event.target.value);
				updateChoices(card, needsEvent);
			}
		});
		field(card, 'remove').addEventListener('click', () => {
			const index = cards().indexOf(card); invalidate(); card.remove(); renumber();
			const remaining = cards(); const next = remaining[Math.min(index, remaining.length - 1)];
			if (next) field(next, 'start').focus({ preventScroll: true }); else addButton.focus({ preventScroll: true });
			announcements.textContent = 'Leave period removed. Saved events are still available.';
		});
		periodsContainer.append(card); updateChoices(card); renumber();
		if (focus) field(card, 'start').focus();
	}
	addButton.addEventListener('click', () => addPeriod());
	document.addEventListener('pointerdown', event => {
		cards().forEach(card => { if (!field(card, 'event-selector').contains(event.target)) closeEventMenu(card); });
	});
	form.addEventListener('submit', event => {
		event.preventDefault(); invalidate();
		validationAttempted = true;
		if (!validateLeaves(true)) return;
		try {
			const periods = cards().map(card => ({
				start: field(card, 'start').value, end: field(card, 'end').value,
				entitlements: [...card.querySelectorAll('input[name="entitlements"]:checked')].map(input => input.value),
				eventId: card.dataset.eventId || ''
			}));
			const results = summarizeEntitlements(periods, events);
			document.getElementById('summary-cards').replaceChildren(...results.map(createEntitlementSummaryCard));
			summary.dataset.calculated = 'true'; summary.dataset.stale = 'false';
			form.querySelector('.calculate-button').textContent = 'Recalculate';
			validationAttempted = false;
			document.getElementById('recalculate-notice').hidden = true;
			document.getElementById('summary-empty').hidden = true;
			document.getElementById('summary-heading').focus();
			announcements.textContent = 'Entitlement balances updated.';
		} catch (error) {
			const card = cards()[error.periodIndex];
			if (card) {
				document.getElementById('validation-warning').hidden = false;
				card.classList.add('has-errors'); field(card, 'entitlements').classList.add('needs-correction');
				field(card, 'validation-message').textContent = error.message.replace(/^Date range \d+:\s*/, '');
				card.querySelector('input[name="entitlements"]:not(:disabled)').focus();
			} else { errorMessage.textContent = error.message; errorMessage.hidden = false; addButton.focus(); }
		}
	});
	addPeriod(false);
});
