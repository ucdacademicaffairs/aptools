'use strict';

// Date utilities use UTC and count both endpoints.
const ONE_DAY_MS = 1000 * 60 * 60 * 24;

const errorModal = document.getElementById('error-modal');
const errorModalTitle = document.getElementById('error-modal-title');
const errorModalMessage = document.getElementById('error-modal-message');
const errorModalClose = document.getElementById('error-modal-close');

function showModal(title, message) {
	errorModalTitle.textContent = title;
	errorModalMessage.textContent = message;
	errorModal.classList.remove('hidden');
}
errorModalClose.addEventListener('click', () => {
	errorModal.classList.add('hidden');
});


/**
 * Format YYYY-MM-DD dates as MM/DD/YYYY without timezone shifts.
 */
function formatDate(dateString) {
	if (!dateString) return "N/A";
	const date = new Date(dateString + 'T00:00:00Z'); // Force UTC
	return date.toLocaleDateString('en-US', {
		month: '2-digit',
		day: '2-digit',
		year: 'numeric',
		timeZone: 'UTC'
	});
}

/**
 * Parse a YYYY-MM-DD date at midnight UTC.
 */
function getUTCDate(dateString) {
	return new Date(dateString + 'T00:00:00Z');
}

/**
 * Calculate the inclusive number of calendar days.
 * (e.g., 10/1 to 10/2 is 2 days, not 1)
 */
function inclusiveDateDiff(dateStrEnd, dateStrStart) {
	const dateEnd = getUTCDate(dateStrEnd);
	const dateStart = getUTCDate(dateStrStart);
	const diffTime = dateEnd.getTime() - dateStart.getTime();
	// Convert the UTC duration to whole calendar days.
	const diffDays = Math.round(diffTime / ONE_DAY_MS);
	return diffDays + 1; // Add 1 to make it inclusive
}

/**
 * Simple function to add X days to a date.
 * Takes a 'YYYY-MM-DD' string, returns a 'YYYY-MM-DD' string.
 */
function addDays(dateStr, days) {
	const date = getUTCDate(dateStr);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().split('T')[0];
}

/**
 * Scales service days onto pay days, rounded to the nearest whole day, the same way the
 * official Excel calculator does it. toPrecision(15) matches Excel's 15 significant digits,
 * so a value that should be exactly x.5 doesn't round down on a floating-point crumb.
 */
function scaleToPayDays(totalPayDays, serviceDays, totalServiceDays) {
	const raw = (serviceDays / totalServiceDays) * totalPayDays;
	return Math.round(Number(raw.toPrecision(15)));
}


// Date conversion and tab behavior.
function initializeCalendar(panel, periodDates, term) {
	const termTitle = term[0].toUpperCase() + term.slice(1);
	const getElement = id => panel.querySelector('[data-field="' + id + '"]');
	let periodKeys = []; // Newest term first
	let earliestServiceDate = '';
	let latestServiceDate = '';

	// Common Elements
	const baseDatesTableBody = getElement('base-dates-table');

	// Leave by Dates Calculator
	const leaveStartDateInput = getElement('leave-start-date');
	const leaveEndDateInput = getElement('leave-end-date');
	const leaveStartInfo = getElement('leave-start-info');
	const leaveEndInfo = getElement('leave-end-info');
	const coverageInfo = getElement('coverage-info');
	const calculateBtnPartial = getElement('calculate-btn-partial');
	const resultsSectionPartial = getElement('results-section-partial');
	const breakDaysNote = getElement('break-days-note');
	const workExplanationElPartial = getElement('work-explanation-partial');

	// Initialize this calendar independently using its configured dates.
	periodKeys = Object.keys(periodDates)
		.sort((a, b) => periodDates[b].serviceStart.localeCompare(periodDates[a].serviceStart));
	earliestServiceDate = periodDates[periodKeys[periodKeys.length - 1]].serviceStart;
	latestServiceDate = periodDates[periodKeys[0]].serviceEnd;
	populateBaseDatesTable();
	setDateLimits();

	// Populate Base Dates Table
	function populateBaseDatesTable() {
		if (baseDatesTableBody) {
			baseDatesTableBody.innerHTML = ''; // Clear existing rows
			periodKeys.forEach(periodName => {
				const data = periodDates[periodName];
				const row = baseDatesTableBody.insertRow();
				row.className = "text-sm";

				row.insertCell(0).textContent = periodName;
				row.cells[0].className = "px-4 py-3 font-medium text-gray-900 whitespace-nowrap";

				row.insertCell(1).textContent = `${formatDate(data.serviceStart)} - ${formatDate(data.serviceEnd)}`;
				row.cells[1].className = "px-4 py-3 text-gray-600 whitespace-nowrap";

				row.insertCell(2).textContent = `${formatDate(data.payStart)} - ${formatDate(data.payEnd)}`;
				row.cells[2].className = "px-4 py-3 text-gray-600 whitespace-nowrap";
			});
		} else {
			console.error("Could not find 'base-dates-table' element.");
		}
	}

	// Date pickers only offer dates the tool has term dates for
	function setDateLimits() {
		[leaveStartDateInput, leaveEndDateInput].forEach(input => {
			input.min = earliestServiceDate;
			input.max = latestServiceDate;
		});
		coverageInfo.textContent = `${termTitle} dates on file run from ${formatDate(earliestServiceDate)} to ${formatDate(latestServiceDate)}.`;
	}

	// Which term a date falls in, or that it's in a break
	function describeDate(dateStr) {
		if (!dateStr) return '';
		const inPeriod = periodKeys.find(q => periodDates[q].serviceStart <= dateStr && dateStr <= periodDates[q].serviceEnd);
		if (inPeriod) {
			const data = periodDates[inPeriod];
			return `In ${inPeriod} (service ${formatDate(data.serviceStart)} - ${formatDate(data.serviceEnd)})`;
		}
		const endedBefore = periodKeys.find(q => periodDates[q].serviceEnd < dateStr);
		const startsAfter = [...periodKeys].reverse().find(q => periodDates[q].serviceStart > dateStr);
		if (endedBefore && startsAfter) return `Between ${endedBefore} and ${startsAfter}, so not a service day`;
		return `Outside the ${term} dates on file`;
	}

	leaveStartDateInput.addEventListener('input', () => {
		leaveStartInfo.textContent = describeDate(leaveStartDateInput.value);
		const minimum = leaveStartDateInput.value || earliestServiceDate;
		if (leaveEndDateInput.min !== minimum) leaveEndDateInput.min = minimum;
		resultsSectionPartial.classList.add('hidden');
	});
	leaveEndDateInput.addEventListener('input', () => {
		leaveEndInfo.textContent = describeDate(leaveEndDateInput.value);
		resultsSectionPartial.classList.add('hidden');
	});

	// Leave by Dates Calculator Button
	calculateBtnPartial.addEventListener('click', () => {
		const leaveStartDate = leaveStartDateInput.value;
		const leaveEndDate = leaveEndDateInput.value;

		// Validate dates before converting service days to pay dates.
		if (!leaveStartDate || !leaveEndDate) {
			showModal("Input Error", "Please enter both a start and end date for the leave.");
			return;
		}
		if (leaveEndDate < leaveStartDate) {
			showModal("Input Error", "Leave End Date cannot be before Leave Start Date.");
			return;
		}
		if (leaveStartDate < earliestServiceDate || leaveEndDate > latestServiceDate) {
			showModal("Date Range Error", `${termTitle} dates are on file from ${formatDate(earliestServiceDate)} to ${formatDate(latestServiceDate)}. Please enter leave dates within that range.`);
			return;
		}

		// Convert each overlapping service period into pay dates.
		// Split the leave by term, oldest first
		const portions = [...periodKeys].reverse().map(periodName => {
			const data = periodDates[periodName];
			const portionStart = leaveStartDate > data.serviceStart ? leaveStartDate : data.serviceStart;
			const portionEnd = leaveEndDate < data.serviceEnd ? leaveEndDate : data.serviceEnd;
			if (portionStart > portionEnd) return null;

			// 1. Get total days for both periods
			const totalServiceDays = inclusiveDateDiff(data.serviceEnd, data.serviceStart);
			const totalPayDays = inclusiveDateDiff(data.payEnd, data.payStart);

			// 2. Figure out the leave days, and the days *before* the leave starts (0 if it starts on day 1)
			const serviceDaysOnLeave = inclusiveDateDiff(portionEnd, portionStart);
			const serviceDaysPrior = inclusiveDateDiff(portionStart, data.serviceStart) - 1;

			// 3. Scale the days before the leave and the days on leave onto the pay period,
			// each rounded on its own (same as the Excel sheet)
			const payDaysPrior = scaleToPayDays(totalPayDays, serviceDaysPrior, totalServiceDays);
			const payDaysOnLeave = scaleToPayDays(totalPayDays, serviceDaysOnLeave, totalServiceDays);
			const payStart = addDays(data.payStart, payDaysPrior);

			// 4. A leave that runs to the last service day takes the pay period's end, which
			// stops the rounding from pushing it past the term (the sheet does this too)
			const runsToPeriodEnd = portionEnd === data.serviceEnd;

			return {
				periodName, data, portionStart, portionEnd,
				totalServiceDays, totalPayDays, serviceDaysOnLeave, serviceDaysPrior,
				payDaysPrior, payDaysOnLeave, runsToPeriodEnd,
				whole: serviceDaysOnLeave === totalServiceDays,
				payStart,
				payEnd: runsToPeriodEnd ? data.payEnd : addDays(payStart, payDaysOnLeave - 1) // -1 because it's inclusive
			};
		}).filter(Boolean);

		if (portions.length === 0) {
			showModal("No Service Days", `These dates fall entirely between ${term}s, so there are no service days to convert to pay.`);
			return;
		}

		const first = portions[0];
		const last = portions[portions.length - 1];
		const totalServiceDaysOnLeave = portions.reduce((sum, p) => sum + p.serviceDaysOnLeave, 0);
		const breakDays = inclusiveDateDiff(leaveEndDate, leaveStartDate) - totalServiceDaysOnLeave;

		// Display Results
		getElement('pay-start-date-partial').textContent = formatDate(first.payStart);
		getElement('pay-end-date-partial').textContent = formatDate(last.payEnd);
		getElement('service-days-summary').textContent = `${totalServiceDaysOnLeave} ${totalServiceDaysOnLeave === 1 ? 'day' : 'days'}`;
		getElement('service-quarters-summary').textContent =
			`${formatDate(first.portionStart)} - ${formatDate(last.portionEnd)}, across ${portions.map(p => p.periodName).join(', ')}`;

		if (breakDays > 0) {
			breakDaysNote.innerHTML = `<strong>${breakDays} ${breakDays === 1 ? 'day' : 'days'}</strong> of this leave ${breakDays === 1 ? 'falls' : 'fall'} between ${term}s. Days between ${term}s aren't service days, so they don't add to the pay period.`;
			breakDaysNote.classList.remove('hidden');
		} else {
			breakDaysNote.classList.add('hidden');
		}

		// ...and "Show Your Work"
		const portionHtml = portions.map(p => {
			const serviceRange = `${formatDate(p.data.serviceStart)} - ${formatDate(p.data.serviceEnd)}`;
			const payRange = `${formatDate(p.data.payStart)} - ${formatDate(p.data.payEnd)}`;

			if (p.whole) {
				return `
					<div class="border-l-4 border-[#022851] pl-4 space-y-1">
						<p class="font-semibold text-gray-800">${p.periodName} <span class="ml-2 text-xs uppercase tracking-wide text-[#022851]">Whole ${term}</span></p>
						<p>The leave covers all <strong>${p.totalServiceDays} service days</strong> (${serviceRange}), so it takes the ${term}'s full pay period:
						   <strong>${formatDate(p.payStart)} - ${formatDate(p.payEnd)}</strong> (${p.totalPayDays} days).</p>
					</div>`;
			}

			const percentOnLeave = (p.serviceDaysOnLeave / p.totalServiceDays * 100).toFixed(2);
			const rawStart = (p.serviceDaysPrior / p.totalServiceDays * p.totalPayDays).toFixed(2);
			const rawLength = (p.serviceDaysOnLeave / p.totalServiceDays * p.totalPayDays).toFixed(2);
			const endLine = p.runsToPeriodEnd
				? `Pay end: the leave runs to the last service day of the ${term}, so it takes the pay period's end → <strong>${formatDate(p.payEnd)}</strong>`
				: `Pay end: ${formatDate(p.payStart)} + ${p.payDaysOnLeave} days − 1 → <strong>${formatDate(p.payEnd)}</strong>`;

			return `
				<div class="border-l-4 border-[#FFBF00] pl-4 space-y-2">
					<p class="font-semibold text-gray-800">${p.periodName} <span class="ml-2 text-xs uppercase tracking-wide text-[#266040]">Partial ${term}</span></p>
					<p>Service period ${serviceRange} is <strong>${p.totalServiceDays} days</strong>; pay period ${payRange} is <strong>${p.totalPayDays} days</strong>.</p>
					<p>Leave in this ${term}: ${formatDate(p.portionStart)} - ${formatDate(p.portionEnd)}, which is <strong>${p.serviceDaysOnLeave} service days</strong>
					   (${percentOnLeave}% of the ${term}), with <strong>${p.serviceDaysPrior} service days</strong> before it.</p>
					<div class="font-mono text-xs bg-white border border-gray-200 rounded p-3 space-y-1 overflow-x-auto whitespace-nowrap">
						<p>Pay start: ${p.serviceDaysPrior} ÷ ${p.totalServiceDays} × ${p.totalPayDays} = ${rawStart} → ${p.payDaysPrior} days after ${formatDate(p.data.payStart)} → <strong>${formatDate(p.payStart)}</strong></p>
						<p>Pay days on leave: ${p.serviceDaysOnLeave} ÷ ${p.totalServiceDays} × ${p.totalPayDays} = ${rawLength} → <strong>${p.payDaysOnLeave} days</strong></p>
						<p>${endLine}</p>
					</div>
				</div>`;
		}).join('');

		workExplanationElPartial.innerHTML = portionHtml + `
			<p class="font-semibold text-gray-800">
			   The days before the leave and the days on leave are each rounded to the nearest whole pay day, and a leave that runs to the end of a ${term} takes that ${term}'s pay period end.
			</p>
		`;

		resultsSectionPartial.classList.remove('hidden');
	});

}


document.addEventListener('DOMContentLoaded', async () => {
	const quarterPanel = document.getElementById('quarter-panel');
	const semesterPanel = document.getElementById('semester-panel');
	// Reuse the Quarter layout while keeping IDs, labels and input state independent.
	semesterPanel.innerHTML = quarterPanel.innerHTML;
	for (const [panel, prefix] of [[quarterPanel, ''], [semesterPanel, 'semester-']]) {
		panel.querySelectorAll('[id]').forEach(element => {
			element.dataset.field = element.id;
			element.id = prefix + element.id;
		});
		panel.querySelectorAll('label[for]').forEach(label => {
			label.htmlFor = prefix + label.htmlFor;
		});
	}
	const walker = document.createTreeWalker(semesterPanel, NodeFilter.SHOW_TEXT);
	while (walker.nextNode()) {
		walker.currentNode.textContent = walker.currentNode.textContent
			.replace(/Quarter/g, 'Semester').replace(/quarter/g, 'semester')
			.replace('all of Fall and Winter', 'all of Fall and Spring');
	}

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
			if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') next = tabs[1 - index];
			if (event.key === 'Home') next = tabs[0];
			if (event.key === 'End') next = tabs[tabs.length - 1];
			if (next) {
				event.preventDefault();
				selectTab(next);
				next.focus();
			}
		});
	});

	const calendarDates = fetch('calendar-dates.json').then(response => {
		if (!response.ok) throw new Error('Unable to load calendar dates');
		return response.json();
	});

	async function loadCalendar(panel, key, term) {
		try {
			const config = await calendarDates;
			if (!config[key] || !Object.keys(config[key]).length) throw new Error('Missing calendar dates');
			initializeCalendar(panel, config[key], term);
		} catch (error) {
			console.error('Failed to load ' + term + ' configuration:', error);
			panel.querySelectorAll('button, input, select').forEach(control => { control.disabled = true; });
			const message = document.createElement('p');
			message.setAttribute('role', 'alert');
			message.textContent = 'Failed to load ' + term + ' date configuration. Please reload to try again.';
			panel.prepend(message);
		}
	}
	await Promise.all([
		loadCalendar(quarterPanel, 'QUARTER_DATES', 'quarter'),
		loadCalendar(semesterPanel, 'SEMESTER_DATES', 'semester')
	]);
});
