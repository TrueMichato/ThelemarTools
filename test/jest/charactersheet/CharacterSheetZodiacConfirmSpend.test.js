/**
 * Zodiac Form — confirm-before-spend.
 *
 * Assuming a constellation spends a Wild Shape use IRREVERSIBLY (there is no
 * refund path anywhere in the sheet), and the picker presents twelve visually
 * similar cards in a dense grid. Before this change a single stray tap burned a
 * use with no warning and no undo, which is the one destructive action on the
 * Druid Resources modal that had no confirmation.
 *
 * `_pSelectZodiacForm` now mirrors the deferred-spend pattern its siblings
 * (`_pTransformWildShapeFree`, `_pSummonWildCompanion`) already use:
 *   1. cheap pre-checks BEFORE any dialog (already-active, no uses left),
 *   2. a confirm naming the form and its cost,
 *   3. an `_isSelectingZodiac` re-entrancy guard around the await,
 *   4. a post-await affordability RE-CHECK, so a spend that lands elsewhere
 *      while the dialog is open cannot push the pool negative.
 *
 * These tests drive the module directly (DOM-free) against a real
 * CharacterSheetState, and assert on the Wild Shape pool — the thing a player
 * actually loses.
 */

import "./setup.js";

let CharacterSheetState;
let CharacterSheetDruidResources;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	await import("../../../js/charactersheet/charactersheet-class-utils.js");
	CharacterSheetDruidResources = (await import("../../../js/charactersheet/charactersheet-druid-resources.js")).CharacterSheetDruidResources;
});

/** A Zodiac druid with a Wild Shape pool, plus a stub page the module can drive. */
function makeZodiacDruid ({current = 2, max = 2} = {}) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Druid",
		source: "TGTT",
		level: 9,
		subclass: {name: "Circle of the Zodiac", shortName: "Zodiac", source: "TGTT"},
	});
	state.setAbilityBase("wis", 18);
	state.addFeature({name: "Wild Shape", source: "XPHB", uses: {current, max, recharge: "short"}});

	const page = {getState: () => state};
	const mod = new CharacterSheetDruidResources(page);
	// The modal isn't mounted in these tests; neutralise the render/persist hops.
	mod._refreshSheet = () => {};
	mod._renderModalBody = () => {};
	return {state, mod};
}

const usesOf = (state) => state.getWildShapeResource().current;

/** Install a `pGetUserBoolean` that records its calls and returns `answer`. */
function stubConfirm (answer, {onOpen} = {}) {
	const calls = [];
	globalThis.InputUiUtil.pGetUserBoolean = async (opts) => {
		calls.push(opts);
		if (onOpen) await onOpen();
		return answer;
	};
	return calls;
}

let originalConfirm;
let originalToast;
let toasts;

beforeEach(() => {
	originalConfirm = globalThis.InputUiUtil.pGetUserBoolean;
	originalToast = globalThis.JqueryUtil.doToast;
	toasts = [];
	globalThis.JqueryUtil.doToast = (opts) => { toasts.push(opts); };
});

afterEach(() => {
	globalThis.InputUiUtil.pGetUserBoolean = originalConfirm;
	globalThis.JqueryUtil.doToast = originalToast;
});

describe("Zodiac Form — confirm before spending a Wild Shape use", () => {
	it("opens a confirm that names the form and its cost", async () => {
		const {mod} = makeZodiacDruid();
		const calls = stubConfirm(true);

		await mod._pSelectZodiacForm("beaver");

		expect(calls).toHaveLength(1);
		expect(calls[0].title).toMatch(/Beaver/);
		expect(calls[0].htmlDescription).toMatch(/1 Wild Shape use/);
	});

	it("spends NOTHING when the confirm is cancelled", async () => {
		const {state, mod} = makeZodiacDruid({current: 2, max: 2});
		stubConfirm(false);

		await mod._pSelectZodiacForm("beaver");

		expect(usesOf(state)).toBe(2);
		expect(state.getActiveZodiacForm()).toBeFalsy();
	});

	it("spends EXACTLY one use when confirmed, and activates the chosen form", async () => {
		const {state, mod} = makeZodiacDruid({current: 2, max: 2});
		stubConfirm(true);

		await mod._pSelectZodiacForm("beaver");

		expect(usesOf(state)).toBe(1);
		expect(state.getActiveZodiacForm()?.formId).toBe("beaver");
	});

	it("blocks BEFORE opening the dialog when no uses remain", async () => {
		const {state, mod} = makeZodiacDruid({current: 0, max: 2});
		const calls = stubConfirm(true);

		await mod._pSelectZodiacForm("beaver");

		expect(calls).toHaveLength(0);
		expect(usesOf(state)).toBe(0);
		expect(state.getActiveZodiacForm()).toBeFalsy();
		expect(toasts.some(t => /No Wild Shape uses remaining/i.test(t.content))).toBe(true);
	});

	it("does not re-spend when the already-active form is picked again", async () => {
		const {state, mod} = makeZodiacDruid({current: 2, max: 2});
		stubConfirm(true);
		await mod._pSelectZodiacForm("beaver");
		expect(usesOf(state)).toBe(1);

		const calls = stubConfirm(true);
		await mod._pSelectZodiacForm("beaver");

		expect(calls).toHaveLength(0); // no dialog at all
		expect(usesOf(state)).toBe(1); // and no second use burned
	});

	it("still charges a use when SWITCHING to a different form", async () => {
		const {state, mod} = makeZodiacDruid({current: 2, max: 2});
		stubConfirm(true);

		await mod._pSelectZodiacForm("beaver");
		await mod._pSelectZodiacForm("horse");

		expect(usesOf(state)).toBe(0);
		expect(state.getActiveZodiacForm()?.formId).toBe("horse");
	});

	it("is single-shot under re-entrancy — a second click while the dialog is open is dropped", async () => {
		const {state, mod} = makeZodiacDruid({current: 2, max: 2});
		let secondCall;
		const calls = stubConfirm(true, {
			// Fire the racing click WHILE the first dialog is still awaiting.
			onOpen: () => { secondCall = mod._pSelectZodiacForm("horse"); },
		});

		await mod._pSelectZodiacForm("beaver");
		await secondCall;

		expect(calls).toHaveLength(1); // the re-entrant call never opened a dialog
		expect(usesOf(state)).toBe(1); // exactly one use spent
	});

	it("re-checks affordability AFTER the dialog, so a racing spend can't push the pool negative", async () => {
		const {state, mod} = makeZodiacDruid({current: 1, max: 2});
		stubConfirm(true, {
			// Something else (combat tab, Wild Companion, …) drains the pool while
			// the confirm is open.
			onOpen: () => { state.spendWildShapeUse(1); },
		});

		await mod._pSelectZodiacForm("beaver");

		expect(usesOf(state)).toBe(0);
		expect(state.getActiveZodiacForm()).toBeFalsy();
		expect(toasts.some(t => /No Wild Shape uses remaining/i.test(t.content))).toBe(true);
	});
});

describe("Zodiac Form — picker markup", () => {
	const src = () => globalThis.__zodiacSrc;

	beforeAll(async () => {
		const fs = await import("fs");
		const path = await import("path");
		const {fileURLToPath} = await import("url");
		const dir = path.dirname(fileURLToPath(import.meta.url));
		globalThis.__zodiacSrc = fs.readFileSync(
			path.resolve(dir, "../../../js/charactersheet/charactersheet-druid-resources.js"),
			"utf8",
		);
	});

	it("exposes aria-pressed on every constellation card", () => {
		expect(src()).toMatch(/aria-pressed="\$\{isActive \? "true" : "false"\}"/);
	});

	it("marks the active form in text as well as colour", () => {
		expect(src()).toMatch(/charsheet__druid-zodiac-activemark/);
		expect(src()).toMatch(/Active<\/span>/);
	});

	it("no longer needs the nested-hover-link escape hatch", () => {
		// The rules-text hover link used to live INSIDE the card <button>, which is
		// invalid nesting and forced a bail-out guard in every click handler that sat
		// near one. It is now a sibling, so no handler should still be guarding.
		// Comments are stripped so the explanatory prose in the module doesn't match.
		const code = src()
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/(^|[^:])\/\/.*$/gm, "$1");
		expect(code).not.toMatch(/closest\??\.?\(["']\.ve-help-subtle["']\)/);
	});
});

describe("Zodiac Form — constellation summaries", () => {
	it("names the save on Peacock rather than saying only 'must save'", () => {
		const def = CharacterSheetState.getZodiacFormDef("peacock");
		expect(def.summary).toMatch(/Wisdom save/i);
	});

	it("states Cat's floor in plain language", () => {
		const def = CharacterSheetState.getZodiacFormDef("cat");
		expect(def.summary).toMatch(/count as at least 8/i);
		expect(def.summary).not.toMatch(/Roll floor/i);
	});

	it("gives Bulette and Phoenix real numbers instead of vague nouns", () => {
		expect(CharacterSheetState.getZodiacFormDef("bulette").summary).toMatch(/proficiency bonus to AC/i);
		expect(CharacterSheetState.getZodiacFormDef("phoenix").summary).toMatch(/2d8/);
	});

	it("uses one consistent action-cost prefix across the action forms", () => {
		for (const id of ["bee", "hound", "horse"]) {
			expect(CharacterSheetState.getZodiacFormDef(id).summary).toMatch(/bonus action:/i);
		}
		expect(CharacterSheetState.getZodiacFormDef("beaver").summary).toMatch(/^Reaction:/);
	});
});
