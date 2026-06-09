/**
 * Wild Shape current-form display (round-5 Bug #5) — MECHANICS.
 *
 * While in Wild Shape the Combat-tab panel + Druid modal showed only the bare
 * creature NAME ("Currently: Velociraptor") with no stats and no hover target.
 * The WILD_SHAPE companion already carries a full statblock (added via
 * addCompanionFromBestiary), so the fix is presentational:
 *  - getCombatSummary().wildShape.beast exposes a DOM-free display model
 *    (name/source/ac/hp/speed/senses/ability mods + hover entries), sourced
 *    entirely from the stored companion so it survives save/load for free.
 *  - CharacterSheetClassUtils.buildCreatureHoverNameHtml builds a hoverable
 *    name (canonical bestiary statblock hover when a source is present), with
 *    the visible label ALWAYS HTML-escaped (imported names may be hostile).
 *  - CharacterSheetClassUtils.buildCreatureStatLineHtml builds a compact,
 *    escaped AC/HP/speed/senses/ability stat line.
 */

import "./setup.js";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";

const __dirnameLocal = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirnameLocal, "../../..");

let CharacterSheetState;
let CharacterSheetClassUtils;
let CharacterSheetDruidResources;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetClassUtils = (await import("../../../js/charactersheet/charactersheet-class-utils.js")).CharacterSheetClassUtils;
	CharacterSheetDruidResources = (await import("../../../js/charactersheet/charactersheet-druid-resources.js")).CharacterSheetDruidResources;
});

const direWolf = {
	name: "Dire Wolf",
	source: "MM",
	type: "beast",
	size: ["L"],
	ac: [{ac: 14}],
	hp: {average: 37, formula: "5d10 + 10"},
	speed: {walk: 50},
	str: 17,
	dex: 15,
	con: 15,
	int: 3,
	wis: 12,
	cha: 7,
	senses: ["darkvision 60 ft."],
	passive: 13,
	trait: [{name: "Pack Tactics", entries: ["Advantage when an ally is within 5 feet of the target."]}],
	action: [{name: "Bite", entries: ["{@atk mw} {@hit 5} to hit. {@damage 2d6 + 3} piercing damage."]}],
};

function makeWildShapeDruid (level = 3, {current = 2, max = 2, recharge = "short"} = {}) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Druid",
		source: "TGTT",
		level,
		subclass: level >= 3 ? {name: "Circle of the Zodiac", shortName: "Zodiac", source: "TGTT"} : undefined,
	});
	state.setAbilityBase("wis", 16);
	state.addFeature({name: "Wild Shape", source: "XPHB", uses: {current, max, recharge}});
	return state;
}

function makeModule (state, extra = {}) {
	const page = {getState: () => state, ...extra};
	return new CharacterSheetDruidResources(page);
}

describe("#5 — getCombatSummary().wildShape.beast exposes the current form's stats", () => {
	it("is null when not in a form", () => {
		const s = makeModule(makeWildShapeDruid(3)).getCombatSummary();
		expect(s.wildShape.inForm).toBe(false);
		expect(s.wildShape.beast).toBeNull();
	});

	it("carries AC/HP/speed/senses/ability mods sourced from the companion record", () => {
		const state = makeWildShapeDruid(3, {current: 1, max: 2});
		state.addCompanionFromBestiary(direWolf, CharacterSheetState.COMPANION_TYPES.WILD_SHAPE, "Wild Shape");
		const s = makeModule(state).getCombatSummary();

		expect(s.wildShape.inForm).toBe(true);
		// beastName preserved for back-compat (existing tests assert it).
		expect(s.wildShape.beastName).toBe("Dire Wolf");

		const beast = s.wildShape.beast;
		expect(beast).toBeTruthy();
		expect(beast.name).toBe("Dire Wolf");
		expect(beast.source).toBe("MM");
		expect(beast.ac).toBe(14);
		expect(beast.hpMax).toBe(37);
		expect(beast.speedLabel).toMatch(/50 ft\./);
		expect(beast.senses).toContain("darkvision 60 ft.");
		expect(beast.abilityMods.str).toBe("+3"); // 17 → +3
		expect(beast.abilityMods.int).toBe("-4"); // 3 → -4
		// Traits/actions retained for the inline-hover fallback.
		expect(beast.hoverEntries.some(e => e.name === "Pack Tactics")).toBe(true);
		expect(beast.hoverEntries.some(e => e.name === "Bite")).toBe(true);
	});

	it("flying/swimming speeds are summarised in the speed label", () => {
		const state = makeWildShapeDruid(3, {current: 1, max: 2});
		state.addCompanionFromBestiary({...direWolf, name: "Giant Eagle", speed: {walk: 10, fly: 80}}, CharacterSheetState.COMPANION_TYPES.WILD_SHAPE, "Wild Shape");
		const beast = makeModule(state).getCombatSummary().wildShape.beast;
		expect(beast.speedLabel).toMatch(/10 ft\./);
		expect(beast.speedLabel).toMatch(/fly 80 ft\./);
	});

	it("coerces object-valued speeds (e.g. {number, condition}) to a clean number", () => {
		// Some bestiary speeds are structured ({number: 60, condition: "(hover)"});
		// the label must never render "[object Object] ft.".
		const state = makeWildShapeDruid(3, {current: 1, max: 2});
		const comp = state.addCompanion({
			name: "Hover Beast",
			type: CharacterSheetState.COMPANION_TYPES.WILD_SHAPE,
			origin: "Wild Shape",
			speed: {walk: 0, fly: {number: 60, condition: "(hover)"}},
		});
		expect(comp).toBeTruthy();
		const beast = makeModule(state).getCombatSummary().wildShape.beast;
		expect(beast.speedLabel).toMatch(/fly 60 ft\./);
		expect(beast.speedLabel).not.toMatch(/\[object Object\]/);
	});

	it("survives a save/load round-trip (stats come from the persisted companion)", () => {
		const state = makeWildShapeDruid(3, {current: 1, max: 2});
		state.addCompanionFromBestiary(direWolf, CharacterSheetState.COMPANION_TYPES.WILD_SHAPE, "Wild Shape");

		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(state.toJson());

		const beast = makeModule(reloaded).getCombatSummary().wildShape.beast;
		expect(beast).toBeTruthy();
		expect(beast.name).toBe("Dire Wolf");
		expect(beast.ac).toBe(14);
		expect(beast.hpMax).toBe(37);
		expect(beast.abilityMods.str).toBe("+3");
	});
});

describe("#5 — class-utils render helpers (hover + stat line)", () => {
	it("buildCreatureStatLineHtml renders AC / HP / Speed / Senses / abilities", () => {
		const state = makeWildShapeDruid(3, {current: 1, max: 2});
		state.addCompanionFromBestiary(direWolf, CharacterSheetState.COMPANION_TYPES.WILD_SHAPE, "Wild Shape");
		const beast = makeModule(state).getCombatSummary().wildShape.beast;

		const html = CharacterSheetClassUtils.buildCreatureStatLineHtml(beast);
		expect(html).toMatch(/AC<\/strong>\s*14/);
		expect(html).toMatch(/HP<\/strong>\s*37/);
		expect(html).toMatch(/Speed<\/strong>\s*50 ft\./);
		expect(html).toMatch(/Senses<\/strong>\s*darkvision 60 ft\./);
		expect(html).toMatch(/STR \+3/);
	});

	it("buildCreatureStatLineHtml returns '' for no model", () => {
		expect(CharacterSheetClassUtils.buildCreatureStatLineHtml(null)).toBe("");
	});

	it("buildCreatureHoverNameHtml builds a canonical bestiary statblock hover when a source is present", () => {
		// The setup.js Renderer mock has no `hover`; inject the minimal surface
		// the helper uses so the real bestiary-hover branch is exercised.
		const prevHover = globalThis.Renderer.hover;
		const prevEncode = globalThis.UrlUtil.encodeForHash;
		const prevPg = globalThis.UrlUtil.PG_BESTIARY;
		globalThis.Renderer.hover = {getHoverElementAttributes: () => `data-test-hover="1"`};
		globalThis.UrlUtil.encodeForHash = (s) => String(s).toLowerCase().replace(/\s+/g, "%20");
		globalThis.UrlUtil.PG_BESTIARY = "bestiary.html";
		try {
			const beast = {name: "Dire Wolf", source: "MM", hoverEntries: []};
			const html = CharacterSheetClassUtils.buildCreatureHoverNameHtml(beast);
			expect(html).toMatch(/^<a /);
			expect(html).toContain("bestiary.html#");
			expect(html).toContain("data-test-hover");
			expect(html).toContain("Dire Wolf");
		} finally {
			globalThis.Renderer.hover = prevHover;
			globalThis.UrlUtil.encodeForHash = prevEncode;
			globalThis.UrlUtil.PG_BESTIARY = prevPg;
		}
	});

	it("HTML-escapes hostile creature names (no raw markup leaks)", () => {
		const beast = {name: `<img src=x onerror=alert(1)>`, source: null, hoverEntries: []};
		const html = CharacterSheetClassUtils.buildCreatureHoverNameHtml(beast);
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;img");
	});

	it("escapes a hostile name even in the canonical bestiary-hover branch", () => {
		const prevHover = globalThis.Renderer.hover;
		const prevEncode = globalThis.UrlUtil.encodeForHash;
		const prevPg = globalThis.UrlUtil.PG_BESTIARY;
		globalThis.Renderer.hover = {getHoverElementAttributes: () => `data-test-hover="1"`};
		globalThis.UrlUtil.encodeForHash = (s) => encodeURIComponent(String(s));
		globalThis.UrlUtil.PG_BESTIARY = "bestiary.html";
		try {
			const beast = {name: `<img src=x onerror=alert(1)>`, customName: `"><img onerror=alert(2)>`, source: "MM", hoverEntries: []};
			const html = CharacterSheetClassUtils.buildCreatureHoverNameHtml(beast);
			expect(html).toMatch(/^<a /); // hover branch taken
			expect(html).not.toContain("<img");
			expect(html).toContain("&lt;img");
		} finally {
			globalThis.Renderer.hover = prevHover;
			globalThis.UrlUtil.encodeForHash = prevEncode;
			globalThis.UrlUtil.PG_BESTIARY = prevPg;
		}
	});

	it("escapes a hostile name in the inline-entries hover fallback (no source)", () => {
		const prevHover = globalThis.Renderer.hover;
		// Provide getInlineHover so the inline-entries branch is exercised.
		globalThis.Renderer.hover = {getInlineHover: () => ({html: `data-inline="1"`})};
		try {
			const beast = {
				name: `<img src=x onerror=alert(3)>`,
				source: null,
				hoverEntries: [{type: "entries", name: "Trait", entries: ["text"]}],
			};
			const html = CharacterSheetClassUtils.buildCreatureHoverNameHtml(beast);
			expect(html).toContain("data-inline"); // inline branch taken
			expect(html).not.toContain("<img");
			expect(html).toContain("&lt;img");
		} finally {
			globalThis.Renderer.hover = prevHover;
		}
	});

	it("falls back to a plain (escaped) span when there is no source and no hover entries", () => {
		const beast = {name: "Homebrew Critter", source: null, hoverEntries: []};
		const html = CharacterSheetClassUtils.buildCreatureHoverNameHtml(beast);
		expect(html).toMatch(/<span[^>]*>Homebrew Critter<\/span>/);
	});
});

describe("#5 — render wiring is present in the combat panel + modal", () => {
	const combatSrc = fs.readFileSync(path.join(REPO_ROOT, "js/charactersheet/charactersheet-combat.js"), "utf8");
	const moduleSrc = fs.readFileSync(path.join(REPO_ROOT, "js/charactersheet/charactersheet-druid-resources.js"), "utf8");

	it("combat panel renders the beast name + stat line via the safe helpers", () => {
		expect(combatSrc).toMatch(/buildCreatureHoverNameHtml/);
		expect(combatSrc).toMatch(/buildCreatureStatLineHtml/);
		expect(combatSrc).toMatch(/charsheet__combat-druid-beaststats/);
	});

	it("the Druid modal Wild Shape section renders the beast name + stat line via the safe helpers", () => {
		expect(moduleSrc).toMatch(/buildCreatureHoverNameHtml/);
		expect(moduleSrc).toMatch(/buildCreatureStatLineHtml/);
	});
});
