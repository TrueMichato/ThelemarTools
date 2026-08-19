/**
 * Pass-3 fixes: the fan-out from making powers activatable (CS-BUG-167), the Action Economy
 * collapse, hover-link construction, and the power picker's gating.
 */
import fs from "fs";
import path from "path";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const root = path.resolve(process.cwd());
const pathPsiUi = path.join(root, "js/charactersheet/charactersheet-psionics-ui.js");
const pathPowers = path.join(root, "js/charactersheet/charactersheet-powers.js");
const pathPicker = path.join(root, "js/charactersheet/charactersheet-power-picker.js");
const pathCss = path.join(root, "css/charactersheet.css");

function makePower ({name, order, type = "TK", manifestationTime = "1 action"}) {
	return {
		name,
		source: "TalPsi",
		type,
		order,
		entries: [`{@b Manifestation Time:} ${manifestationTime}`, "{@b Range:} 60 feet", "Some effect text."],
		modes: [],
	};
}

function makeTalent (powers = [], {level = 9} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Talent", source: "TalPsi", level});
	state.setAbilityBase("int", 18);
	state.setMaxHp(40);
	state.setCurrentHp(40);
	state.setPsionicCatalog(powers);
	for (const p of powers) state.learnPsionicPower(p);
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	return {state, combat};
}

describe("CS-BUG-167 — powers stay out of the generic ability surfaces", () => {
	it("hides a power from the surfaces that list activatable features", () => {
		const {state} = makeTalent([makePower({name: "Adapt", order: "2nd-Order"})]);
		const power = state.getFeatures().find(f => f.name === "Adapt");
		// It IS activatable — that is correct and CS-BUG-166 fixed it deliberately.
		expect(CharacterSheetState.detectActivatableFeature(power)).toBeTruthy();
		// …but it has canonical homes of its own, so the generic lists must skip it.
		expect(CharacterSheetState.isHiddenFromGenericAbilitySurfaces(power, state.getFeatures())).toBe(true);
	});

	it("leaves an ordinary activatable feature alone", () => {
		const {state} = makeTalent([]);
		state.addFeature({name: "Second Wind", level: 1, className: "Fighter", source: "PHB", description: "As a bonus action, you regain hit points.", uses: {max: 1, current: 1}});
		const feature = state.getFeatures().find(f => f.name === "Second Wind");
		expect(CharacterSheetState.isHiddenFromGenericAbilitySurfaces(feature, state.getFeatures())).toBe(false);
	});
});

describe("Action Economy — collapsing the numerous kinds", () => {
	it("declares spells and powers collapsible, and nothing else", () => {
		const kinds = CharacterSheetCombat.ACTION_ECONOMY_COLLAPSIBLE_KINDS.map(k => k.kind);
		expect(kinds).toEqual(["spell", "power"]);
	});

	it("gives every collapsible kind a plural and a singular label", () => {
		for (const k of CharacterSheetCombat.ACTION_ECONOMY_COLLAPSIBLE_KINDS) {
			expect(typeof k.label).toBe("string");
			expect(typeof k.labelOne).toBe("string");
			expect(k.label.length).toBeGreaterThan(0);
		}
	});

	it("has display metadata for the power kind so a collapsed row is not blank", () => {
		const meta = CharacterSheetCombat.ACTION_ECONOMY_KIND_META.power;
		expect(meta).toBeTruthy();
		expect(meta.label).toMatch(/power/i);
		expect(meta.glyph).toBeTruthy();
	});
});

describe("power hover links", () => {
	it("builds a site hover when the power has a source and the page can link", () => {
		const power = {name: "Adapt", source: "TalPsi"};
		const page = {getHoverLink: (pg, name, source, hash, label) => `<a data-page="${pg}" data-src="${source}">${label}</a>`};
		const html = CharacterSheetClassUtils.getPsionicPowerHoverLink(power, page);
		expect(html).toContain("psionics.html");
		expect(html).toContain("Adapt");
	});

	it("accepts a different visible label, so a glyph can carry the hover", () => {
		const page = {getHoverLink: (pg, name, source, hash, label) => `<a>${label}</a>`};
		const html = CharacterSheetClassUtils.getPsionicPowerHoverLink({name: "Adapt", source: "TalPsi"}, page, {label: "ⓘ"});
		expect(html).toContain("ⓘ");
		expect(html).not.toContain("Adapt<");
	});

	it("falls back to the power's own text when no page link is available", () => {
		const power = {name: "Adapt", entries: ["Some effect."]};
		const html = CharacterSheetClassUtils.getPsionicPowerHoverLink(power, null);
		expect(html).toContain("Adapt");
	});

	it("never loses the name, even with nothing to hover", () => {
		expect(CharacterSheetClassUtils.getPsionicPowerHoverLink({name: "Adapt"}, null)).toContain("Adapt");
	});

	it("returns null for a nameless power rather than rendering an empty link", () => {
		expect(CharacterSheetClassUtils.getPsionicPowerHoverLink(null, null)).toBeNull();
		expect(CharacterSheetClassUtils.getPsionicPowerHoverLink({}, null)).toBeNull();
	});

	it("escapes a name that contains markup", () => {
		const html = CharacterSheetClassUtils.getPsionicPowerHoverLink({name: "<script>x</script>"}, null);
		expect(html).not.toContain("<script>");
	});
});

describe("the power picker's order gate", () => {
	const CU = globalThis.CharacterSheetClassUtils;
	const opt = (name, order, type = "TK") => ({
		name,
		source: "TalPsi",
		_psionicOrder: order,
		_psionicPowerType: type,
		featureType: [order === 1 ? "PsiP1" : "PsiPH"],
	});
	const groupByOrder = (...args) => globalThis.CharacterSheetPowerPicker.groupByOrder(...args);

	beforeAll(async () => {
		await import("../../../js/charactersheet/charactersheet-power-picker.js");
	});

	it("groups ascending by order and sorts within a group", () => {
		const groups = groupByOrder({
			options: [opt("Zephyr", 3), opt("Adapt", 2), opt("Bolt", 1), opt("Apparition", 2)],
			maxOrder: 6,
		});
		expect(groups.map(g => g.order)).toEqual([1, 2, 3]);
		expect(groups[1].powers.map(p => p.option.name)).toEqual(["Adapt", "Apparition"]);
	});

	it("locks a power above the character's ceiling and says when it unlocks", () => {
		const groups = groupByOrder({
			options: [opt("Adapt", 2), opt("Farsight", 5)],
			maxOrder: 4,
			className: "Talent",
			orderUnlockLevels: {2: 1, 3: 5, 4: 9, 5: 13, 6: 17},
		});
		const fifth = groups.find(g => g.order === 5).powers[0];
		expect(fifth.isLocked).toBe(true);
		expect(fifth.lockReason).toBe("unlocks at Talent 13");
		expect(groups.find(g => g.order === 2).powers[0].isLocked).toBe(false);
	});

	it("keeps a locked power in the list rather than hiding it", () => {
		const groups = groupByOrder({options: [opt("Farsight", 6)], maxOrder: 2});
		expect(groups).toHaveLength(1);
		expect(groups[0].powers[0].isLocked).toBe(true);
	});

	it("falls back to a generic reason when the unlock table has no entry", () => {
		const groups = groupByOrder({options: [opt("Farsight", 5)], maxOrder: 2, orderUnlockLevels: {}});
		expect(groups[0].powers[0].lockReason).toContain("5th-order");
	});

	it("marks an already-known power without hiding it", () => {
		const groups = groupByOrder({
			options: [opt("Adapt", 2), opt("Apparition", 2)],
			maxOrder: 6,
			knownKeys: new Set(["adapt|talpsi"]),
		});
		const byName = Object.fromEntries(groups[0].powers.map(p => [p.option.name, p]));
		expect(byName["Adapt"].isKnown).toBe(true);
		expect(byName["Apparition"].isKnown).toBe(false);
		expect(groups[0].powers).toHaveLength(2);
	});

	it("sorts what the player can take ahead of what they cannot", () => {
		// Alphabetically "Adapt" precedes "Bolt"; being already known must send it down,
		// or a group's first screen can be entirely dead rows.
		const groups = groupByOrder({
			options: [opt("Adapt", 2), opt("Bolt", 2), opt("Zephyr", 2)],
			maxOrder: 6,
			knownKeys: new Set(["adapt|talpsi"]),
		});
		expect(groups[0].powers.map(p => p.option.name)).toEqual(["Bolt", "Zephyr", "Adapt"]);
	});

	it("sorts a locked power last too", () => {
		const groups = groupByOrder({
			options: [opt("Aaa", 3), opt("Zzz", 3)],
			maxOrder: 2,
		});
		// Both locked, so alphabetical order is preserved among them.
		expect(groups[0].powers.map(p => p.option.name)).toEqual(["Aaa", "Zzz"]);
	});

	it("carries the discipline through for the chip", () => {
		const groups = groupByOrder({options: [opt("Adapt", 2, "MM")], maxOrder: 6});
		expect(groups[0].powers[0].discipline).toBe("MM");
	});

	it("drops an entry with no resolvable order rather than grouping it under zero", () => {
		const groups = groupByOrder({options: [{name: "Broken", source: "TalPsi"}], maxOrder: 6});
		expect(groups).toEqual([]);
	});

	it("survives an empty pool", () => {
		expect(groupByOrder({options: [], maxOrder: 6})).toEqual([]);
		expect(groupByOrder({})).toEqual([]);
	});
});

/**
 * The strain meter's colour is the only thing on the sheet that says "you are close to
 * dying" without a number, so it has to be true. Painting the gradient on the filled
 * portion scaled it with the fill, making the bar's tip red at any amount of strain.
 */
describe("strain meter geometry", () => {
	it("masks from the fill percentage rather than sizing a gradient to it", () => {
		const src = fs.readFileSync(pathPsiUi, "utf8");
		expect(src).toContain("cs-psi-strain__mask");
		expect(src).toContain("left:$" + "{pct}%");
		expect(src).not.toContain("cs-psi-strain__fill");
	});

	it("paints the gradient across the whole meter, not the filled part", () => {
		const css = fs.readFileSync(pathCss, "utf8");
		const meter = css.slice(css.indexOf(".cs-psi-strain__meter {"));
		expect(meter.slice(0, meter.indexOf("}"))).toContain("linear-gradient");
		const mask = css.slice(css.indexOf(".cs-psi-strain__mask {"));
		expect(mask.slice(0, mask.indexOf("}"))).not.toContain("linear-gradient");
	});
});

/**
 * Giving up a power and gaining one are a single decision. Asking for them in two dialogs
 * made the player commit to the loss before seeing what it bought — and the first dialog
 * opened on a disabled placeholder, so confirming it did nothing at all.
 */
describe("power swap flow", () => {
	it("chooses the outgoing power inside the picker, not in a separate prompt", () => {
		const src = fs.readFileSync(pathPowers, "utf8");
		const fn = src.slice(src.indexOf("async _pReplacePower"));
		const body = fn.slice(0, fn.indexOf("\n\t_renderFilters"));
		expect(body).toContain("swap:");
		expect(body).toContain("fnGetCandidates");
		expect(body).not.toContain("pGetUserEnum");
	});

	it("offers only powers that have something to trade for", () => {
		const src = fs.readFileSync(pathPowers, "utf8");
		const fn = src.slice(src.indexOf("async _pReplacePower"));
		expect(fn.slice(0, 1400)).toContain("getPowerReplacementCandidates(p.id).length");
	});

	it("rebuilds the candidate list when the outgoing power changes", () => {
		const src = fs.readFileSync(pathPicker, "utf8");
		expect(src).toContain("swap.fnGetCandidates(outgoing)");
		expect(src).toMatch(/js-outgoing[\s\S]{0,600}mount\(\)/);
	});

	it("still reports the counter string the E2E autofill harness matches on", () => {
		const src = fs.readFileSync(pathPicker, "utf8");
		expect(src).toContain("Selected: <span class=\"js-count\">0</span> / $" + "{pickCount}");
	});
});

/** The dialog is where a variant is chosen, so it is where the variant must be legible. */
describe("manifest dialog variant modes", () => {
	it("shows the selected mode's text and keeps it in sync", () => {
		const src = fs.readFileSync(pathPowers, "utf8");
		expect(src).toContain("js-mode-text");
		expect(src).toContain("syncModeText");
		expect(src).toMatch(/querySelector\("\.js-mode"\)\?\.addEventListener\("change", syncModeText\)/);
	});
});

/** Over budget is reachable via respec, and is the number that should argue back. */
describe("known-power budget", () => {
	it("flags a pool that is over its maximum", () => {
		const src = fs.readFileSync(pathPowers, "utf8");
		expect(src).toContain("charsheet__power-stat-value--over");
		expect(src).toContain("budget.higherOrder.used > budget.higherOrder.max");
		expect(fs.readFileSync(pathCss, "utf8")).toContain(".charsheet__power-stat-value--over");
	});
});

/**
 * CS-BUG-168: `pGetUserEnum` opens on a disabled placeholder, so a caller that omits
 * `default` has a confirm button that returns null — indistinguishable from Cancel.
 */
describe("enum prompts in the psionics surface", () => {
	it("gives every remaining prompt a default so OK always means something", () => {
		const src = fs.readFileSync(pathPowers, "utf8");
		const calls = src.split("InputUiUtil.pGetUserEnum({").slice(1);
		expect(calls.length).toBeGreaterThan(0);
		calls.forEach(call => expect(call.slice(0, call.indexOf("});"))).toContain("default:"));
	});
});

/**
 * The Powers tab's name is a button that expands the row, so the rules hover used to hang
 * off a separate 12px ⓘ at 45% opacity beside it — easy to miss entirely, which read as
 * "powers aren't hoverable". The hover now lives on the name itself.
 */
describe("hovering a power by its name", () => {
	// The real helpers live in js/render.js, which the jsdom suite does not load.
	beforeAll(() => {
		globalThis.Renderer = globalThis.Renderer || {};
		globalThis.Renderer.hover = {
			getHoverElementAttributes: ({page, source, hash}) =>
				`onmouseover="Renderer.hover.pHandleLinkMouseOver(event, this)" onmouseleave="x" onclick="nope" data-page="${page}" data-source="${source}" data-hash="${hash}"`,
			getInlineHover: () => ({html: `onmouseover="a" onmouseleave="b" onclick="c"`}),
		};
	});
	afterAll(() => { delete globalThis.Renderer.hover; });

	it("exposes the hover as bare attributes, so a button can carry it", () => {
		const attrs = CharacterSheetClassUtils.getPsionicPowerHoverAttributes({name: "Adapt", source: "TalPsi"});
		expect(attrs).toContain("onmouseover");
		expect(attrs).toContain("onmouseleave");
	});

	it("carries no onclick, so the host button's own click still wins", () => {
		const attrs = CharacterSheetClassUtils.getPsionicPowerHoverAttributes({name: "Adapt", source: "TalPsi"});
		expect(attrs).not.toContain("onclick");
	});

	it("returns nothing rather than broken markup for a nameless power", () => {
		expect(CharacterSheetClassUtils.getPsionicPowerHoverAttributes(null)).toBe("");
		expect(CharacterSheetClassUtils.getPsionicPowerHoverAttributes({})).toBe("");
	});

	it("puts the hover on the name and retires the separate peek glyph", () => {
		const src = fs.readFileSync(pathPowers, "utf8");
		expect(src).toContain("getPsionicPowerHoverAttributes(power)");
		expect(src).not.toContain("charsheet__power-peek");
		expect(fs.readFileSync(pathCss, "utf8")).not.toContain("charsheet__power-peek");
	});

	it("keeps expand-on-click on the same element", () => {
		const src = fs.readFileSync(pathPowers, "utf8");
		expect(src).toMatch(/charsheet__power-name js-expand/);
	});
});

/**
 * A power's meta lines live in `entries` and its actual effect text in `modes`, so a hover
 * composed from `entries` alone said nothing about what the power does.
 */
describe("psionic hover entry composition", () => {
	const power = {
		name: "Adapt",
		entries: ["{@b Manifestation Time:} 1 action", "{@b Range:} 15 feet"],
		modes: [
			{name: "2nd-Order", entries: ["Choose up to four willing creatures."]},
			{name: "Increased Order", entries: ["Target one additional creature."]},
		],
	};

	it("keeps the meta lines and appends every mode as a named section", () => {
		const entries = CharacterSheetClassUtils.getPsionicHoverEntries(power);
		expect(entries.slice(0, 2)).toEqual(power.entries);
		expect(entries.slice(2)).toEqual([
			{type: "entries", name: "2nd-Order", entries: ["Choose up to four willing creatures."]},
			{type: "entries", name: "Increased Order", entries: ["Target one additional creature."]},
		]);
	});

	it("skips a mode with no text rather than emitting an empty section", () => {
		const entries = CharacterSheetClassUtils.getPsionicHoverEntries({name: "X", entries: [], modes: [{name: "Empty"}]});
		expect(entries).toEqual([]);
	});

	it("survives a power with neither entries nor modes", () => {
		expect(CharacterSheetClassUtils.getPsionicHoverEntries({name: "X"})).toEqual([]);
		expect(CharacterSheetClassUtils.getPsionicHoverEntries(null)).toEqual([]);
	});
});
