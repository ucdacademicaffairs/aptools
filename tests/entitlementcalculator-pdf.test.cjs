const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ document: { addEventListener() {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'entitlementcalculator-pdf.js'), 'utf8'), context);

function layout(height, records, top = 0) {
	return {
		getBoundingClientRect: () => ({ top, height }),
		querySelectorAll: () => records.map(([tag, start, end]) => ({
			getBoundingClientRect: () => ({ top: top + start, bottom: top + end, height: end - start }),
			matches: selector => selector.split(', ').includes(tag)
		}))
	};
}

const slices = (...args) => JSON.parse(JSON.stringify(context.entitlementPdfSlices(...args)));

test('PDF filename uses the local date with zero-padded month and day', () => {
	assert.equal(context.entitlementPdfFilename(new Date(2026, 0, 2, 23, 30)), 'Leave_Entitlement_Summary_2026-01-02.pdf');
});

test('short details stay together on one page', () => {
	assert.deepEqual(slices(layout(400, [['h3', 20, 45], ['li', 70, 100]])), [{ y: 0, height: 400 }]);
});

test('page breaks never split a leave record, including when the element is below the overview', () => {
	const records = [['h3', 20, 45], ['li', 70, 100], ['li', 930, 990], ['li', 1850, 1920], ['p', 2200, 2250]];
	const result = slices(layout(2300, records, 1200));
	assert.ok(result.length >= 3);
	assert.equal(result[0].height, 930);
	assert.equal(result.at(-1).y + result.at(-1).height, 2300);
	for (const slice of result.slice(0, -1)) {
		const cut = slice.y + slice.height;
		assert.ok(records.every(([, start, end]) => !(start < cut && end > cut)));
	}
});

test('a calculation heading moves with the following record', () => {
	const result = slices(layout(1400, [['li', 50, 80], ['h4', 900, 920], ['p', 940, 990], ['p', 1200, 1240]]));
	assert.equal(result[0].height, 900);
});

test('a complete entered-leave row stays together across page breaks', () => {
	const result = slices(layout(1400, [['h2', 20, 50], ['[data-pdf-record]', 80, 250], ['[data-pdf-record]', 900, 1100], ['p', 1020, 1060]]));
	assert.equal(result[0].height, 900);
	assert.equal(result[1].y, 900);
});

test('an oversized entry is scaled as one page without an empty leading page', () => {
	assert.deepEqual(slices(layout(1500, [['h3', 20, 45], ['li', 70, 1480]])), [{ y: 0, height: 1500 }]);
});

test('bottom padding does not create an empty continuation page', () => {
	assert.deepEqual(slices(layout(980, [['li', 900, 950]])), [{ y: 0, height: 980 }]);
});
