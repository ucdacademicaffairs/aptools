"use strict";

// Source: supplied workbook-specifications.json and formula-mapping.csv.
// User-approved change: omit obsolete J52 from HSCP First's total (J54).
// User-approved change: round entered off-scale to the nearest $100 before addition.
// No leave-tool imports, network calls, or persistent storage.
const AboveScale = (() => {
    const FIRST = Object.freeze({ 0: 0, 0.5: 1.025, 1: 1.05, 1.5: 1.075 });
    const FURTHER = Object.freeze({ 1: 1.05, 1.5: 1.075, 2: 1.1 });
    const APU = Object.freeze([1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.65, 1.8, 2, 2.25]);
    const SOURCES = Object.freeze({ general: "General Campus_Protected_10.5.2026_Updated by Lauren(1).xlsx", hscp: "HS Comp Plan Protected_10.5.2026_updated by Lauren(1).xlsx" });

    function configuration(plan, advancement) {
        if (!["general", "hscp"].includes(plan) || !["first", "further"].includes(advancement)) throw new Error("Select a supported salary plan and advancement.");
        const hscp = plan === "hscp";
        const first = advancement === "first";
        const fields = [{ key: "steps", label: first ? "Steps beyond the first Above Scale" : "Proposed steps advancing", cell: hscp ? "F16" : "F19", options: Object.keys(first ? FIRST : FURTHER).map(Number).sort((a, b) => a - b) }];
        if (hscp) fields.push({ key: "apu", label: "APU scale", cell: "F18", options: APU.map((_, i) => i) });
        if (first) {
            fields.push({ key: "step9", label: hscp ? "Step 9 salary from Table 5-0" : "Step 9 salary from table", cell: hscp ? "F20" : "F21" });
            fields.push({ key: "step8", label: hscp ? "Step 8 salary from Table 5-0" : "Step 8 salary from table", cell: hscp ? "F22" : "F23" });
            fields.push({ key: "offscale", label: "Current off-scale (optional)", cell: hscp ? "F24" : "F25", optional: true });
        } else fields.push({ key: "current", label: hscp ? "Current UCHSAX" : "Current UCABVE", cell: hscp ? "F20" : "F21" });
        return { plan, advancement, hscp, first, fields, workbook: SOURCES[plan], sheet: first ? "First Above Scale" : "Further Above Scale", title: `${hscp ? "HSCP" : "General Campus"} · ${first ? "First" : "Further"} Above Scale` };
    }

    function parseAmount(raw) {
        const text = String(raw ?? "").trim();
        if (!text) return null;
        if (!/^[+-]?\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) throw new Error("Enter a number, such as 125000 or 125,000.50.");
        const value = Number(text.replace(/[$,]/g, ""));
        if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100) throw new Error("This amount exceeds the calculator’s supported numeric range.");
        return value;
    }

    function roundHundred(value) {
        // Excel ROUND(x,-2): half-way cases round away from zero.
        // Normalize the scaled value to 15 significant digits at the rounding
        // boundary so binary tails (e.g. 32249.999999999993) retain decimal ties.
        const scaled = Number((Math.abs(value) / 100).toPrecision(15));
        const rounded = Math.sign(value) * Math.floor(scaled + 0.5) * 100;
        return Object.is(rounded, -0) ? 0 : rounded;
    }

    function calculate(plan, advancement, input) {
        const config = configuration(plan, advancement);
        const values = {};
        for (const field of config.fields) {
            const value = input[field.key];
            if (value === null || value === undefined || value === "") {
                if (field.optional) { values[field.cell] = ""; continue; }
                throw new Error(`Enter ${field.label.toLowerCase()}.`);
            }
            if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100) throw new Error(`Enter a supported number for ${field.label.toLowerCase()}.`);
            if (field.options && !field.options.includes(value)) throw new Error(`Select a supported ${field.label.toLowerCase()}.`);
            values[field.cell] = value;
        }
        if (config.first && input.step8 === 0) throw new Error("Step 8 salary cannot be zero because the calculation divides by it.");
        const trace = [];
        const steps = [];
        function put(cell, formula, value) {
            if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100)) throw new Error("The calculation exceeds the supported numeric range.");
            values[cell] = value;
            trace.push({ cell, formula, value });
            return value;
        }
        const ref = (cell, from) => put(cell, from, values[from]);
        const describe = (label, value) => steps.push({ label, value });
        const h = config.hscp;
        const enteredOffscale = config.first ? (values[h ? "F24" : "F25"] || 0) : 0;
        const offscale = roundHundred(enteredOffscale);
        let base;
        if (config.first) {
            const salary9 = h ? "F20" : "F21";
            const salary8 = h ? "F22" : "F23";
            const stepCell = h ? "F16" : "F19";
            const cells = h ? ["J28", "J29", "J30", "J32", "J33", "J34", "J36", "J37", "J38"] : ["J29", "J30", "J31", "J33", "J34", "J35", "J37", "J38", "J39"];
            const [a,b,c,d,e,f,g,j,k] = cells;
            put(a, `IF(${salary9}="","",${salary9})`, input.step9);
            put(b, `IF(${salary8}="","",${salary8})`, input.step8);
            put(c, `IF(OR(${salary9}="",${salary8}=""),"",${salary9}/${salary8})`, input.step9 / input.step8);
            ref(d, a); ref(e, c);
            put(f, `IF(${c}="","",${d}*${e})`, values[d] * values[e]);
            ref(g, f);
            put(j, `IF(${stepCell}="","",IFS(${stepCell}=0,0,${stepCell}=0.5,1.025,${stepCell}=1,1.05,${stepCell}=1.5,1.075))`, FIRST[input.steps]);
            base = put(k, `IF(${g}="","",IF(${j}=0,${g},${g}*${j}))`, values[j] === 0 ? values[g] : values[g] * values[j]);
            describe("Step 9 ÷ Step 8", values[c]);
            describe("Step 9 × the ratio", values[f]);
            describe(input.steps === 0 ? "No additional advancement: retain that amount" : `Apply advancement multiplier ${FIRST[input.steps]}`, base);
        } else {
            const salary = h ? "F20" : "F21";
            const stepCell = h ? "F16" : "F19";
            put("J26", `IF(${salary}="","",${salary})`, input.current);
            put("J27", `IF(${stepCell}="","",IFS(${stepCell}=1,1.05,${stepCell}=1.5,1.075,${stepCell}=2,1.1))`, FURTHER[input.steps]);
            base = put("J28", `IF(OR(${salary}="",${stepCell}=""),"",J26*J27)`, input.current * values.J27);
            describe(`Current ${h ? "UCHSAX" : "UCABVE"} × ${FURTHER[input.steps]}`, base);
        }

        let total;
        const components = [];
        if (!h) {
            if (config.first) {
                ref("J41", "J39");
                put("J42", 'IF(J41="","",ROUND(J41,-2))', roundHundred(base));
                ref("J45", "J42");
                put("J46", 'IF(F25="","",ROUND(F25,-2))', values.F25 === "" ? "" : offscale);
                total = put("J47", 'IF(OR(J45=""),"",J45+IF(J46="",0,J46))', values.J45 + offscale);
                ref("L19", "J47");
                describe("Round base to nearest $100", values.J42);
                describe("Add off-scale rounded to the nearest $100", total);
            } else {
                ref("J30", "J28");
                total = put("J31", 'IF(J30="","",ROUND(J30,-2))', roundHundred(base));
                ref("L17", "J31");
                describe("Round to nearest $100", total);
            }
        } else {
            const first = config.first;
            const c = first ? ["J40", "J38", "J41", "J43", "J44", "J45", "J47", "J48"] : ["J30", "J28", "J31", "J33", "J34", "J35", "J37", "J38"];
            const [a,b,d,e,f,g,j,k] = c;
            ref(a, b);
            put(d, `IF(${a}="","",ROUND(${a},-2))`, roundHundred(base));
            ref(e, b);
            put(f, 'IF(TRIM(F18)="","",CHOOSE(F18+1,1,1.1,1.2,1.3,1.4,1.5,1.65,1.8,2,2.25)-1)', APU[input.apu] - 1);
            put(g, `IF(OR(${e}="",${f}=""),"",${e}*${f})`, base * values[f]);
            ref(j, g);
            put(k, `IF(${j}="","",ROUND(${j},-2))`, roundHundred(values[j]));
            describe("Round base to nearest $100", values[d]);
            describe(`Unrounded base × APU ${input.apu} differential (${Number(values[f].toPrecision(12))})`, values[g]);
            describe("Round differential to nearest $100 (UCHSAP)", values[k]);
            if (first) {
                put("J50", 'IF((J41=""),"",J41+ROUND(F24,-2))', values.J41 + offscale);
                ref("J51", "J48");
                // User identified J52 as an obsolete artifact. Approved adjustment.
                total = put("J54", 'IF(OR(J50="",J51=""),"",J50+J51)', values.J50 + values.J51);
                ref("L14", "J50"); ref("L16", "J51");
                components.push(["UCHSAX (including off-scale)", values.J50], ["UCHSAP", values.J51]);
                describe("Add off-scale to rounded base (UCHSAX)", values.J50);
                describe("Add UCHSAX and UCHSAP", total);
            } else {
                ref("J40", "J31"); ref("J41", "J38");
                total = put("J42", 'IF(OR(J40="",J41=""),"",J40+J41)', values.J40 + values.J41);
                ref("L14", "J40"); ref("L16", "J41"); ref("L18", "J42");
                components.push(["UCHSAX", values.J40], ["UCHSAP", values.J41]);
                describe("Add rounded UCHSAX and UCHSAP", total);
            }
        }
        if (h && config.first) {
            // Match the approved seven-step explanation without changing arithmetic.
            steps.splice(0, steps.length,
                { label: "Divide Step 9 by Step 8 (Table 5-0)", value: values.J30 },
                { label: "Multiply the Table 5-0 Step 9 base by the result of Step One", value: values.J34 },
                { label: input.steps === 0 ? "No additional advancement: retain the result of Step Two" : `Multiply the result of Step Two by the proposed step multiplier (${FIRST[input.steps]})`, value: values.J38 },
                { label: "Round the result of Step Three to the nearest $100", value: values.J41 },
                { label: `Multiply the unrounded result of Step Three by the APU ${input.apu} scale differential (${Number(values.J44.toPrecision(12))})`, value: values.J45 },
                { label: "Round the result of Step Five to the nearest $100", value: values.J48 },
                { label: "Add applicable off-scale (UCOFF1/UCHSO1), rounded to the nearest $100, to the rounded base to get UCHSAX. Add UCHSAX and UCHSAP to get the new Above Scale base salary (UCABVE)", value: total,
                    note: "Do not add temporary off-scales, such as supplements or other off-scales with special conditions (UCDEC5/UCHD51, UCOFF2/UCHSO2, and UCOFF3/UCHSO3)." }
            );
        }
        if (h && !config.first) {
            // Match the approved five-step explanation without changing arithmetic.
            steps.splice(0, steps.length,
                { label: `Multiply current base salary (UCHSAX) by the proposed step multiplier (${FURTHER[input.steps]})`, value: values.J28 },
                { label: "Round the result of Step One to the nearest $100 (new UCHSAX)", value: values.J31 },
                { label: `Multiply the unrounded result of Step One by the APU ${input.apu} scale differential (${Number(values.J34.toPrecision(12))})`, value: values.J35 },
                { label: "Round the result of Step Three to the nearest $100 (new UCHSAP)", value: values.J38 },
                { label: "Add the new UCHSAX and UCHSAP together", value: total }
            );
        }
        if (!h && config.first) {
            // Match the approved General Campus First five-step explanation.
            steps.splice(0, steps.length,
                { label: "Divide Step 9 by Step 8", value: values.J31 },
                { label: "Multiply Step 9 by the result of Step One", value: values.J35 },
                { label: input.steps === 0 ? "No additional advancement: retain the result of Step Two" : `Multiply the result of Step Two by the proposed step multiplier (${FIRST[input.steps]})`, value: values.J39 },
                { label: "Round the result of Step Three to the nearest $100", value: values.J42 },
                { label: "If applicable, add the off-scale (UCOFF1), rounded to the nearest $100, to the result of Step Four to get the new Above Scale base salary (UCABVE)", value: total }
            );
        }
        if (!h && !config.first) {
            // Match the approved General Campus Further two-step explanation.
            steps.splice(0, steps.length,
                { label: `Multiply current Above Scale salary (UCABVE) by the proposed step multiplier (${FURTHER[input.steps]})`, value: values.J28 },
                { label: "Round the result of Step One to the nearest $100", value: values.J31 }
            );
        }
        // Attach the actual operands used above; explanations never recalculate salary.
        const equation = (left, operator, right, result, prefix = "") => ({ left, operator, right, result, prefix });
        const rounding = (value, result) => ({ left: value, operator: "round", result });
        if (config.first) {
            steps[0].work = [equation(input.step9, "÷", input.step8, h ? values.J30 : values.J31)];
            steps[1].work = [equation(input.step9, "×", h ? values.J30 : values.J31, h ? values.J34 : values.J35)];
            // A selection of zero preserves the base rather than multiplying by zero.
            steps[2].work = [equation(h ? values.J34 : values.J35, "×", input.steps === 0 ? 1 : FIRST[input.steps], base)];
            steps[3].work = [rounding(base, h ? values.J41 : values.J42)];
            if (h) {
                steps[4].work = [equation(base, "×", values.J44, values.J45)];
                steps[5].work = [rounding(values.J45, values.J48)];
                steps[6].work = [
                    equation(values.J41, "+", offscale, values.J50, "UCHSAX"),
                    equation(values.J50, "+", values.J51, total, "UCABVE")
                ];
            } else steps[4].work = [equation(values.J42, "+", offscale, total)];
            if (enteredOffscale !== offscale) {
                steps[h ? 6 : 4].work.unshift(rounding(enteredOffscale, offscale));
            }
        } else {
            steps[0].work = [equation(input.current, "×", FURTHER[input.steps], values.J28)];
            steps[1].work = [rounding(values.J28, values.J31)];
            if (h) {
                steps[2].work = [equation(values.J28, "×", values.J34, values.J35)];
                steps[3].work = [rounding(values.J35, values.J38)];
                steps[4].work = [equation(values.J40, "+", values.J41, total)];
            }
        }
        return { config, total, components, steps, trace, values };
    }
    const workNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });
    function formatStepWork(step) {
        return step.work.map(work => {
            const left = workNumber.format(work.left);
            const result = workNumber.format(work.result);
            if (work.operator === "round") return `Round ${left} to the nearest $100 = ${result}`;
            return `${work.prefix ? `${work.prefix}: ` : ""}${left} ${work.operator} ${workNumber.format(work.right)} = ${result}`;
        }).join("; ");
    }
    return Object.freeze({ configuration, parseAmount, calculate, roundHundred, formatStepWork });
})();

if (typeof module !== "undefined" && module.exports) module.exports = AboveScale;

if (typeof document !== "undefined") {
    // Each tab owns its form and results, with unique IDs and memory-only state.
    function initializeCalculator(plan) {
    const panel = document.getElementById(`${plan}-panel`);
    const content = document.getElementById("calculator-template").content.cloneNode(true);
    content.querySelectorAll("[id]").forEach(element => { element.id = `${plan}-${element.id}`; });
    for (const attribute of ["for", "aria-labelledby", "aria-describedby"]) {
        content.querySelectorAll(`[${attribute}]`).forEach(element => {
            element.setAttribute(attribute, element.getAttribute(attribute).split(/\s+/).map(id => `${plan}-${id}`).join(" "));
        });
    }
    panel.append(content);
    const byId = id => panel.querySelector(`#${plan}-${id}`);
    const form = byId("above-scale-form");
    const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
    let config;
    function clearResult(message = "Enter a scenario, then select Calculate.") {
        byId("result-content").hidden = true;
        byId("result-status").textContent = message;
        byId("result-status").hidden = false;
    }
    function hideError() {
        byId("form-error").hidden = true;
        form.querySelectorAll('[aria-invalid="true"]').forEach(el => el.removeAttribute("aria-invalid"));
    }
    function renderFields() {
        config = AboveScale.configuration(plan, byId("advancement").value);
        const container = byId("scenario-fields"); container.replaceChildren();
        for (const field of config.fields) {
            const wrapper = document.createElement("div"); wrapper.className = "field";
            const label = document.createElement("label"); label.htmlFor = `${plan}-input-${field.key}`; label.textContent = field.label;
            if (!field.optional) {
                const marker = document.createElement("span");
                marker.className = "required-marker";
                marker.textContent = "*";
                marker.setAttribute("aria-hidden", "true");
                label.append(marker);
            }
            const control = document.createElement(field.options ? "select" : "input");
            control.id = label.htmlFor; control.name = field.key; control.required = !field.optional;
            if (field.options) {
                control.add(new Option("Select…", ""));
                field.options.forEach(value => control.add(new Option(String(value), String(value))));
            } else {
                control.type = "text"; control.inputMode = "decimal"; control.maxLength = 40;
                control.placeholder = field.optional ? "Optional" : "Enter salary amount"; control.spellcheck = false;
            }
            const help = document.createElement("p"); help.className = "help"; help.id = `${plan}-help-${field.key}`;
            help.textContent = field.optional ? "Automatically rounded to the nearest $100 before adding. Leave blank if not applicable." : "";
            if (field.key === "current" && config.hscp) help.textContent = "Without negotiated salary.";
            wrapper.append(label, control);
            if (help.textContent) {
                control.setAttribute("aria-describedby", help.id);
                wrapper.append(help);
            }
            container.append(wrapper);
        }
        byId("workflow-help").textContent = config.first ? "The first Above Scale salary is already included in the salary tables. Select any additional steps beyond it." : "Apply the proposed advancement to the current salary amount.";
        byId("scope-note").hidden = !config.hscp;
        byId("scope-note").textContent = config.hscp
            ? (config.first ? "Exclude temporary off-scales such as UCDEC5/UCHD51, UCOFF2/UCHSO2, and UCOFF3/UCHSO3 from the new base salary." : "This calculation uses current UCHSAX and has no separate off-scale input.")
            : "";
        hideError(); clearResult();
    }
    function renderResult(result) {
        byId("result-workflow").textContent = config.title;
        byId("total-label").textContent = config.hscp ? (config.first ? "Above Scale amount" : "Further Above Scale amount") : "New UCABVE";
        byId("total-amount").textContent = money.format(result.total);
        const components = byId("component-results"); components.replaceChildren();
        for (const [label, value] of result.components) {
            const term = document.createElement("dt"); term.textContent = label;
            const definition = document.createElement("dd"); definition.textContent = money.format(value);
            components.append(term, definition);
        }
        const steps = byId("calculation-steps"); steps.replaceChildren();
        result.steps.forEach(step => {
            const item = document.createElement("li");
            item.textContent = `${step.label}: ${AboveScale.formatStepWork(step)}`;
            if (step.note) {
                const note = document.createElement("p"); note.className = "step-note"; note.textContent = step.note; item.append(note);
            }
            steps.append(item);
        });
        byId("result-status").textContent = "";
        byId("result-status").hidden = true;
        byId("result-content").hidden = false; byId("results-heading").focus();
    }
    form.addEventListener("submit", event => {
        event.preventDefault(); hideError(); clearResult("Complete the scenario to calculate.");
        const input = {};
        try {
            for (const field of config.fields) {
                const control = byId(`input-${field.key}`);
                try {
                    input[field.key] = field.options ? (control.value === "" ? null : Number(control.value)) : AboveScale.parseAmount(control.value);
                    if (!field.optional && input[field.key] === null) throw new Error(`Enter ${field.label.toLowerCase()}.`);
                    if (field.key === "step8" && input[field.key] === 0) throw new Error("Step 8 salary cannot be zero.");
                } catch (error) { control.setAttribute("aria-invalid", "true"); control.focus(); throw error; }
            }
            renderResult(AboveScale.calculate(config.plan, config.advancement, input));
        } catch (error) { byId("form-error").textContent = error.message; byId("form-error").hidden = false; }
    });
    function handleEdit(event) {
        if (event.target.id === `${plan}-advancement`) {
            if (event.type === "change") renderFields();
        } else { hideError(); clearResult("Inputs changed. Select Calculate to update your result."); }
    }
    form.addEventListener("input", handleEdit); form.addEventListener("change", handleEdit);
    form.addEventListener("reset", event => { event.preventDefault(); renderFields(); byId("input-steps").focus(); });
    // Discard browser-restored salary fields on reload and back/forward navigation.
    window.addEventListener("pageshow", () => renderFields());
    renderFields();
    }
    initializeCalculator("general");
    initializeCalculator("hscp");

    const tabs = [...document.querySelectorAll('.salary-tabs [role="tab"]')];
    function selectTab(tab) {
        tabs.forEach(item => {
            const selected = item === tab;
            item.setAttribute("aria-selected", String(selected));
            item.tabIndex = selected ? 0 : -1;
            document.getElementById(item.getAttribute("aria-controls")).hidden = !selected;
        });
    }
    tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => selectTab(tab));
        tab.addEventListener("keydown", event => {
            let next;
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") next = tabs[1 - index];
            if (event.key === "Home") next = tabs[0];
            if (event.key === "End") next = tabs[tabs.length - 1];
            if (next) { event.preventDefault(); selectTab(next); next.focus(); }
        });
    });
}
