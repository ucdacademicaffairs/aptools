'use strict';

// Export the rendered calculation snapshot; no entitlement arithmetic belongs here.
const ENTITLEMENT_PDF_ORDER = ['PDLL', 'FMLA', 'CFRA', 'PFCB'];
const ENTITLEMENT_PDF_HEIGHT = 960; // 10 printable inches on US Letter.
let entitlementPdfLibraries;

function loadEntitlementPdfLibraries() {
	if (!entitlementPdfLibraries) {
		const load = source => new Promise((resolve, reject) => {
			const script = document.createElement('script');
			script.src = new URL(source, document.baseURI).href;
			script.onload = resolve;
			script.onerror = () => { script.remove(); reject(new Error('The PDF libraries could not be loaded. Please try again.')); };
			document.head.append(script);
		});
		entitlementPdfLibraries = Promise.all([
			load('vendor/html2canvas-1.4.1.min.js'),
			load('vendor/jspdf-4.2.1.umd.min.js')
		]).catch(error => { entitlementPdfLibraries = null; throw error; });
	}
	return entitlementPdfLibraries;
}

function buildEntitlementLeavesPdfPage(form) {
	const page = document.createElement('section');
	page.className = 'pdf-page pdf-leaves-page';
	const copy = form.cloneNode(true);
	copy.removeAttribute('id');
	copy.querySelector('h2').textContent = 'Leaves Entered';
	// Replace form controls with their current displayed values in the export only.
	copy.querySelectorAll('input').forEach(input => {
		const value = document.createElement('span');
		if (input.type === 'checkbox') {
			value.className = `pdf-checkbox${input.checked ? ' is-checked' : ''}`;
			value.textContent = input.checked ? '✓' : '';
		} else {
			value.className = 'pdf-input-value';
			const [year, month, day] = input.value.split('-');
			value.textContent = input.type === 'date' && year && month && day ? `${month}/${day}/${year}` : input.value;
		}
		input.replaceWith(value);
	});
	copy.querySelectorAll('[data-field="event-choice"]').forEach(choice => {
		const value = document.createElement('div');
		value.className = 'event-trigger pdf-event-value';
		value.textContent = choice.querySelector('[data-field="event-text"]').textContent;
		choice.replaceWith(value);
	});
	copy.querySelectorAll('.calculate-row, button, #leave-rule, #validation-warning, #form-error, #empty-periods, .sr-only, .event-menu, [data-field="event-editor"], [data-field="event-help"]').forEach(node => node.remove());
	copy.querySelectorAll('.leave-period').forEach(leave => { leave.dataset.pdfRecord = ''; });
	page.append(copy);
	return page;
}

function buildEntitlementPdfSnapshot(summary) {
	const cards = [...summary.querySelectorAll('#summary-cards > .entitlement-card')]
		.sort((a, b) => ENTITLEMENT_PDF_ORDER.indexOf(a.dataset.entitlement) - ENTITLEMENT_PDF_ORDER.indexOf(b.dataset.entitlement));
	if (!cards.length) throw new Error('Calculate balances before downloading.');
	const clean = node => {
		node.querySelectorAll('button, .card-flip-icon, .card-return-hint, #pdf-status, #card-instructions, #recalculate-notice, #summary-empty').forEach(item => item.remove());
		// Expand only the exported copies, so every event balance and explanation is included.
		node.querySelectorAll('details').forEach(details => { details.open = true; });
		return node;
	};
	const balances = clean(summary.cloneNode(true));
	balances.removeAttribute('data-stale');
	const grid = balances.querySelector('#summary-cards');
	grid.replaceChildren(...cards.map(card => {
		const copy = clean(card.cloneNode(true));
		copy.querySelector('.entitlement-back').remove();
		copy.querySelector('.entitlement-front').hidden = false;
		copy.dataset.flipped = 'false';
		return copy;
	}));
	const overview = document.createElement('section');
	overview.className = 'pdf-page pdf-summary-page';
	overview.append(balances);
	const details = cards.map(card => {
		const page = document.createElement('section');
		page.className = 'pdf-page pdf-detail-page';
		page.dataset.entitlement = card.dataset.entitlement;
		const shell = document.createElement('article');
		shell.className = 'entitlement-card';
		const back = clean(card.querySelector('.entitlement-back').cloneNode(true));
		back.hidden = false;
		shell.append(back);
		page.append(shell);
		return page;
	});
	return [buildEntitlementLeavesPdfPage(document.getElementById('entitlement-form')), overview, ...details];
}

async function createEntitlementPdfFrame(pages) {
	const frame = document.createElement('iframe');
	frame.title = 'Preparing entitlement PDF';
	frame.setAttribute('aria-hidden', 'true');
	frame.tabIndex = -1;
	Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: '1000px', height: '1200px', border: '0', pointerEvents: 'none' });
	document.body.append(frame);
	try {
		const doc = frame.contentDocument;
		// Match the standards-mode document html2canvas creates internally.
		doc.open();
		doc.write('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"></head><body></body></html>');
		doc.close();
		doc.title = 'Leave Entitlement Summary';
		doc.body.className = 'pdf-document';
		const styles = ['site.css', 'entitlementcalculator.css', 'entitlementcalculator-print.css'].map(source => new Promise((resolve, reject) => {
			const link = doc.createElement('link');
			link.rel = 'stylesheet';
			link.href = new URL(source, document.baseURI).href;
			link.onload = resolve;
			link.onerror = () => reject(new Error('The PDF styles could not be loaded. Please try again.'));
			doc.head.append(link);
		}));
		doc.body.append(...pages.map(page => doc.importNode(page, true)));
		await Promise.all(styles);
		await doc.fonts.ready;
		return frame;
	} catch (error) { frame.remove(); throw error; }
}

function entitlementPdfSlices(page, maxHeight = ENTITLEMENT_PDF_HEIGHT) {
	const origin = page.getBoundingClientRect().top;
	const height = Math.ceil(page.getBoundingClientRect().height);
	const nodes = [...page.querySelectorAll('h2, h3, h4, p, li, summary, tr, [data-pdf-record]')]
		.filter(node => node.getBoundingClientRect().height > 0);
	const bounds = node => {
		const rect = node.getBoundingClientRect();
		return { top: Math.floor(rect.top - origin), bottom: Math.ceil(rect.bottom - origin) };
	};
	const records = nodes.map(bounds);
	// Keep a heading with the first record underneath it, including nested year headings.
	nodes.forEach((node, index) => {
		if (!node.matches('h2, h3, h4, summary')) return;
		let next = index + 1;
		while (next < nodes.length - 1 && nodes[next].matches('h2, h3, h4, summary')) next++;
		if (next < nodes.length) records.push({ top: bounds(node).top, bottom: bounds(nodes[next]).bottom });
	});
	const blocks = [];
	records.sort((a, b) => a.top - b.top).forEach(record => {
		const previous = blocks[blocks.length - 1];
		if (previous && record.top < previous.bottom) previous.bottom = Math.max(previous.bottom, record.bottom);
		else blocks.push({ ...record });
	});
	const slices = [];
	let start = 0;
	while (start < height) {
		let end = Math.min(start + maxHeight, height);
		const crossing = blocks.find(record => record.top < end && record.bottom > end);
		if (crossing) {
			// A single unusually long entry gets its own scaled page rather than being cut.
			// Include leading padding instead of emitting a nearly empty page before it.
			const oversized = crossing.bottom - crossing.top > maxHeight && crossing.top - start < 80;
			end = crossing.top <= start || oversized ? crossing.bottom : crossing.top;
		}
		// Do not create a final page containing only the card's bottom padding/border.
		if (records.every(record => record.bottom <= end)) end = height;
		if (end <= start) throw new Error('Unable to lay out a calculation entry for the PDF.');
		slices.push({ y: start, height: end - start });
		start = end;
	}
	return slices;
}

function entitlementPdfFilename(date = new Date()) {
	const localDate = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
	return `Leave_Entitlement_Summary_${localDate}.pdf`;
}

async function generateEntitlementPdf(snapshot, reportProgress = () => {}) {
	await loadEntitlementPdfLibraries();
	const frame = await createEntitlementPdfFrame(snapshot);
	try {
		const pdf = new window.jspdf.jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter', compress: true });
		pdf.setProperties({ title: 'Leave Entitlement Summary', author: 'UC Davis Academic Affairs', subject: 'Calculated leave entitlement balances and details' });
		const pages = [...frame.contentDocument.querySelectorAll('.pdf-page')];
		let count = 0;
		for (const page of pages) {
			const width = page.getBoundingClientRect().width;
			const slices = page.classList.contains('pdf-summary-page')
				? [{ y: 0, height: Math.ceil(page.getBoundingClientRect().height) }]
				: entitlementPdfSlices(page, ENTITLEMENT_PDF_HEIGHT * width / 720);
			for (const slice of slices) {
				reportProgress(`Preparing PDF page ${++count}…`);
				// Render one measured page at a time to avoid browser limits on tall canvases.
				const canvas = await window.html2canvas(page, {
					backgroundColor: '#ffffff', scale: Math.min(2, 1920 / slice.height), logging: false,
					width, height: slice.height, y: slice.y,
					windowWidth: 1000, windowHeight: 1200, scrollX: 0, scrollY: 0
				});
				if (count > 1) pdf.addPage('letter', 'portrait');
				const scale = Math.min(540 / width, 720 / slice.height);
				const imageWidth = width * scale;
				pdf.addImage(canvas, 'PNG', 36 + (540 - imageWidth) / 2, 36, imageWidth, slice.height * scale, undefined, 'FAST');
				canvas.width = canvas.height = 0;
			}
		}
		await pdf.save(entitlementPdfFilename(), { returnPromise: true });
	} finally { frame.remove(); }
}

document.addEventListener('DOMContentLoaded', () => {
	const summary = document.getElementById('entitlement-summary');
	const button = document.getElementById('download-entitlement-pdf');
	const status = document.getElementById('pdf-status');
	let exporting = false;
	const update = () => {
		const ready = summary.dataset.calculated === 'true' && summary.dataset.stale !== 'true';
		button.disabled = exporting || !ready;
		button.title = ready ? 'Download the calculated balances and details.' : 'Calculate or recalculate balances before downloading.';
	};
	new MutationObserver(update).observe(summary, { attributes: true, attributeFilter: ['data-calculated', 'data-stale'] });
	button.addEventListener('click', async () => {
		if (button.disabled) return;
		exporting = true;
		update();
		button.setAttribute('aria-busy', 'true');
		status.hidden = false;
		status.textContent = 'Preparing PDF…';
		try {
			// Clone synchronously so edits made during export cannot change this document.
			const snapshot = buildEntitlementPdfSnapshot(summary);
			await generateEntitlementPdf(snapshot, message => { status.textContent = message; });
			status.textContent = 'PDF downloaded.';
		} catch (error) {
			status.textContent = `PDF download failed. ${error.message}`;
		} finally {
			exporting = false;
			button.removeAttribute('aria-busy');
			update();
		}
	});
	update();
});
