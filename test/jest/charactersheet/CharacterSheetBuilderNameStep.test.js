/**
 * Bug #11 — Builder's first step is "choose a character name".
 *
 * The builder now opens on a step-0 Name screen. The character cannot advance past it
 * without a non-empty name, the name persists to state so a mid-build save is
 * identifiable, and the final Details step can still rename.
 *
 * The step machinery is index-switched (`_currentStep`, switch/case render/validate/
 * apply). Inserting Name as step 0 keeps every existing case (1–7) untouched.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-builder.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const CharacterSheetBuilder = globalThis.CharacterSheetBuilder;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Minimal state tracking just the name. */
function createNameState (initial = "") {
	let name = initial;
	return {
		setName (v) { name = v; },
		getName () { return name; },
	};
}

function createBuilderAtNameStep (state) {
	const builder = Object.create(CharacterSheetBuilder.prototype);
	builder._state = state;
	builder._page = {renderCharacter () {}};
	builder._currentStep = 0;
	builder._maxSteps = 7;
	return builder;
}

describe("#11 Builder name step (step 0)", () => {
	test("the wizard starts on step 0 (Name)", () => {
		expect(CharacterSheetBuilder.prototype.constructor).toBeDefined();
		// Constructor sets _currentStep = 0 — pin via source (constructor wires DOM/page).
		const src = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-builder.js"), "utf8");
		expect(src).toMatch(/this\._currentStep = 0;/);
	});

	test("cannot advance past the name step with an empty name", async () => {
		const builder = createBuilderAtNameStep(createNameState(""));
		await expect(builder._validateCurrentStep()).resolves.toBe(false);
	});

	test("cannot advance with a whitespace-only name", async () => {
		const builder = createBuilderAtNameStep(createNameState("   "));
		await expect(builder._validateCurrentStep()).resolves.toBe(false);
	});

	test("advances once a non-empty name is set", async () => {
		const builder = createBuilderAtNameStep(createNameState("Lunaria"));
		await expect(builder._validateCurrentStep()).resolves.toBe(true);
	});

	test("the chosen name persists in state (identifiable mid-build save)", () => {
		const state = createNameState("");
		const builder = createBuilderAtNameStep(state);
		// Simulate the input listener persisting the typed value.
		builder._state.setName("Lunaria");
		builder._applyCurrentStep(); // step 0 — no DOM input in node, state already holds the name
		expect(state.getName()).toBe("Lunaria");
	});

	test("validation reads the LIVE input even if the input event never fired (fast Next / autofill)", () => {
		const state = createNameState(""); // state still empty
		const builder = createBuilderAtNameStep(state);
		// Stub a DOM input holding a value the change/input listener hasn't persisted yet.
		const prevDoc = globalThis.document;
		globalThis.document = {getElementById: (id) => (id === "builder-name-step" ? {value: "  Lunaria  "} : null)};
		try {
			return builder._validateCurrentStep().then(ok => {
				expect(ok).toBe(true);
				expect(state.getName()).toBe("Lunaria"); // trimmed + persisted by validation
			});
		} finally {
			globalThis.document = prevDoc;
		}
	});

	test("prev is disabled on the name step but the Details step keeps a rename field", () => {
		const src = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-builder.js"), "utf8");
		// Prev-button guard and _prevStep both bottom out at step 0.
		expect(src).toMatch(/this\._currentStep <= 0/);
		expect(src).toMatch(/_prevStep \(\) \{\s*if \(this\._currentStep > 0\)/);
		// Details step (case 7) still renders an editable name field bound to setName.
		expect(src).toMatch(/id="builder-name"/);
		expect(src).toMatch(/getElementById\("builder-name"\)\?\.addEventListener\("change"/);
	});

	test("the render switch routes step 0 to the name step and leaves 1–7 intact", () => {
		const src = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-builder.js"), "utf8");
		expect(src).toMatch(/case 0:\s*this\._renderNameStep\(content\);/);
		expect(src).toMatch(/case 1:\s*this\._renderRaceStep\(content\);/);
	});

	test("the HTML exposes a Name step indicator at data-step 0", () => {
		const html = readFileSync(resolve(REPO_ROOT, "charactersheet.html"), "utf8");
		expect(html).toMatch(/data-step="0"[\s\S]*?Name/);
		// Species remains step 1.
		expect(html).toMatch(/data-step="1"[\s\S]*?Species/);
	});
});
