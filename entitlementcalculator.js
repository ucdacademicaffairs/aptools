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
	function updateCounts(card) {
		const start = field(card, 'start').value;
		const end = field(card, 'end').value;
		field(card, 'end').min = start;
		const count = field(card, 'counts');
		if (!start || !end) {
			count.textContent = 'Enter dates to see calendar days and weekdays.';
			return;
		}
		try {
			const { calendarDays, weekdays } = entitlementDayCounts(start, end);
			count.textContent = `${calendarDays} calendar ${calendarDays === 1 ? 'day' : 'days'} · ${weekdays} ${weekdays === 1 ? 'weekday' : 'weekdays'}`;
		} catch (error) {
			count.textContent = error.message;
		}
	}
	function addPeriod(focus = true) {
		invalidate();
		const card = document.getElementById('period-template').content.firstElementChild.cloneNode(true);
		const prefix = `leave-${nextId++}`;
		card.querySelectorAll('[data-field]').forEach(element => { element.id = `${prefix}-${element.dataset.field}`; });
		card.querySelectorAll('[data-for]').forEach(label => { label.htmlFor = `${prefix}-${label.dataset.for}`; });
		card.setAttribute('aria-labelledby', field(card, 'heading').id);
		for (const name of ['start', 'end']) {
			field(card, name).setAttribute('aria-describedby', field(card, 'counts').id);
		}
		card.addEventListener('input', () => { invalidate(); updateCounts(card); });
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
		const body = document.getElementById('summary-rows');
		body.replaceChildren();
		results.forEach(result => {
			const row = document.createElement('tr');
			row.setAttribute('role', 'row');
			row.dataset.entitlement = result.type;
			const heading = document.createElement('th');
			heading.scope = 'row';
			heading.setAttribute('role', 'rowheader');
			heading.textContent = result.type;
			const periods = document.createElement('td');
			periods.setAttribute('role', 'cell');
			periods.className = 'summary-periods';
			periods.dataset.label = 'Leave periods';
			const list = document.createElement('ul');
			list.className = 'period-list';
			result.periods.forEach(period => {
				const item = document.createElement('li');
				item.textContent = `${formatEntitlementDate(period.start)} – ${formatEntitlementDate(period.end)}`;
				list.append(item);
			});
			periods.append(list);
			if (result.hasOverlap) {
				const note = document.createElement('p');
				note.className = 'overlap-note';
				note.textContent = 'Overlapping dates counted once.';
				periods.append(note);
			}
			row.append(heading, periods);
			for (const [key, label] of [['calendarDays', 'Calendar days'], ['weekdays', 'Workdays'], ['weeks', 'Weeks'], ['remaining', 'Remaining entitlement']]) {
				const cell = document.createElement('td');
				cell.className = 'numeric';
				cell.setAttribute('role', 'cell');
				cell.dataset.label = label;
				cell.dataset.metric = key;
				if (result[key] === null) {
					cell.textContent = key === 'remaining' ? 'Not calculated' : '—';
					cell.classList.add('not-calculated');
					cell.setAttribute('aria-label', `${label}: not calculated`);
				} else {
					cell.textContent = result[key].toLocaleString('en-US', { maximumFractionDigits: key === 'weeks' ? 2 : 0 });
					if (key === 'remaining') {
						const unit = document.createElement('span');
						unit.className = 'remaining-unit';
						unit.textContent = result.remainingUnit;
						cell.append(unit);
					}
				}
				row.append(cell);
			}
			body.append(row);
		});
		summary.hidden = false;
		document.getElementById('summary-heading').focus();
		announcements.textContent = `Entitlement summary calculated for ${cards().length} leave periods and ${results.length} entitlements.`;
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
