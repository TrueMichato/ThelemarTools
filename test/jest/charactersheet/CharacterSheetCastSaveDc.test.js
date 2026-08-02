/**
 * CS-BUG-109 — the CAST OUTPUT was a third hand-rolled spell save DC.
 *
 * CS-BUG-099 fixed the state API and CS-BUG-102 fixed the Spells-tab card, but
 * `_handleSpellEffects()` kept its own `8 + mod + prof - exhaustion`, consulting none of
 * `customModifiers.spellDc`, `itemBonuses.spellSaveDc` or `getBonusFromStates("spellDc")`.
 * The card printed 18 and pressing Cast on that same card printed 15. It is strictly wider
 * than CS-BUG-102: item bonuses are among the dropped terms, so plain published items
 * (Rod of the Pact Keeper, Robe of the Archmagi) are affected with no homebrew and no toggle.
 *
 * This file drives `_handleSpellEffects()` and reads back the number the player is SHOWN —
 * the toast body and the roll-history entry — rather than recomputing the formula. A pin
 * that re-derives `8 + mod + prof + bonuses` moves together with the accessor under any
 * change and is a tautology; that mistake was already made once on CS-BUG-102.
 *
 * `charactersheet-spells.js` captures `e_`/`ee` at module load (`const {e_, ee} = globalThis`)
 * and jest runs on the `node` environment with no DOM, so the stubs must be installed BEFORE
 * the module is imported — hence the dynamic import below.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

/** Every `html:` string handed to `e_()` — the toast body is built this way. */
let renderedHtml = [];

const makeStubNode = () => ({
	textContent: "",
	innerHTML: "",
	title: "",
	style: {},
	dataset: {},
	disabled: false,
	classList: {add () {}, remove () {}, toggle () {}, contains () { return false; }},
	addEventListener () {},
	setAttribute () {},
	append () {},
	appendChild () {},
	querySelector () { return null; },
	querySelectorAll () { return []; },
});

globalThis.e_ = (opts) => {
	if (opts?.html) renderedHtml.push(String(opts.html));
	return makeStubNode();
};
globalThis.ee = () => makeStubNode();

await import("../../../js/charactersheet/charactersheet-spells.js");
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

// The Gambler cast path rolls through `Renderer.dice`, which the site loads separately.
// Every die rolls its minimum, so for the `1d1` used below the stub returns exactly what
// the real roller would — the substituted modifier is a known constant, not a range.
globalThis.Renderer = globalThis.Renderer || {};
globalThis.Renderer.dice = globalThis.Renderer.dice || {
	parseRandomise2: (dice) => {
		const m = /^(\d+)d(\d+)$/.exec(String(dice));
		return m ? Number(m[1]) : 0;
	},
};

const FIREBALL = {
	name: "Probe Blast",
	source: "PHB",
	level: 3,
	school: "V",
	time: [{number: 1, unit: "action"}],
	range: {type: "point", distance: {type: "feet", amount: 150}},
	components: {v: true, s: true},
	duration: [{type: "instant"}],
	savingThrow: ["dexterity"],
	entries: ["Each creature in the area must make a Dexterity saving throw."],
};

/**
 * A level-5 Sorcerer with CHA 18 (+4) and proficiency +3, so the unmodified DC is 15 and
 * every added bonus is individually visible in the printed total.
 */
function makeSorcerer () {
	const state = new CharacterSheetState();
	state.setAbilityBase("cha", 18);
	state.setAbilityBase("con", 14);
	state._data.classes = [{name: "Sorcerer", source: "XPHB", level: 5}];
	state._data.spellcasting.ability = "cha";
	state.setHp(40, 40);
	return state;
}

/** Cast the probe spell and return what the player was shown. */
async function castAndReadDc (state, spellRef = {name: "Probe Blast", source: "PHB", level: 3}) {
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._state = state;
	spells._allSpells = [FIREBALL];
	const rolls = [];
	spells._page = {
		rollD20: () => ({roll: 10}),
		_rollHistory: {addRoll: (r) => rolls.push(r)},
		_renderActiveStates: () => {},
		_renderHp: () => {},
		_renderCompanions: () => {},
		_combat: {renderCombatStates: () => {}},
	};
	renderedHtml = [];

	await spells._handleSpellEffects(spellRef, 3);

	const toast = renderedHtml.join("\n");
	const printed = toast.match(/Save DC: <strong>(-?\d+)<\/strong>/);
	const logged = rolls.find(r => /^Spell Save DC:/.test(r.title || ""));
	return {
		printed: printed ? Number(printed[1]) : null,
		logged: logged ? logged.total : null,
	};
}

describe("the cast output prints the same spell save DC as the rest of the sheet (CS-BUG-109)", () => {
	it("PREMISE: the probe reaches the save-DC branch at all", async () => {
		// Without this, every assertion below would compare null to null and pass vacuously.
		const {printed, logged} = await castAndReadDc(makeSorcerer());
		expect(printed).not.toBeNull();
		expect(logged).not.toBeNull();
	});

	it("matches the canonical accessor with no bonuses in play", async () => {
		const state = makeSorcerer();
		const {printed, logged} = await castAndReadDc(state);
		expect(printed).toBe(state.getSpellSaveDcForAbility("cha"));
		expect(logged).toBe(printed);
	});

	it("includes a custom spellDc modifier", async () => {
		const state = makeSorcerer();
		const before = (await castAndReadDc(state)).printed;
		state._data.customModifiers.spellDc = 2;
		const {printed, logged} = await castAndReadDc(state);
		expect(printed).toBe(before + 2);
		expect(printed).toBe(state.getSpellSaveDcForAbility("cha"));
		expect(logged).toBe(printed);
	});

	it("includes a magic-item spell save DC bonus — the term no homebrew is needed to hit", async () => {
		const state = makeSorcerer();
		const before = (await castAndReadDc(state)).printed;
		state._data.itemBonuses = {...(state._data.itemBonuses || {}), spellSaveDc: 1};
		const {printed, logged} = await castAndReadDc(state);
		expect(printed).toBe(before + 1);
		expect(printed).toBe(state.getSpellSaveDcForAbility("cha"));
		expect(logged).toBe(printed);
	});

	it("includes an active-state spellDc bonus, and drops it again when the state ends", async () => {
		const state = makeSorcerer();
		const before = (await castAndReadDc(state)).printed;
		state.activateState("custom", {
			source: "Probe Buff",
			name: "Probe Buff",
			customEffects: [{type: "bonus", target: "spellDc", value: 3}],
		});
		expect((await castAndReadDc(state)).printed).toBe(before + 3);
		state.deactivateState("custom");
		expect((await castAndReadDc(state)).printed).toBe(before);
	});

	it("stacks all three sources at once, which is the reported 18-vs-15 case", async () => {
		const state = makeSorcerer();
		const base = (await castAndReadDc(state)).printed;
		state._data.customModifiers.spellDc = 2;
		state._data.itemBonuses = {...(state._data.itemBonuses || {}), spellSaveDc: 1};
		const {printed, logged} = await castAndReadDc(state);
		expect(printed).toBe(base + 3);
		expect(printed).toBe(state.getSpellSaveDcForAbility("cha"));
		expect(logged).toBe(printed);
	});

	// Exhaustion is the one term that exists on BOTH sides of the repair: the chokepoint
	// subtracts it (charactersheet-state.js:13180) and the cast site still reads it locally
	// to build the breakdown string. Routing through the chokepoint while keeping the local
	// term in the VALUE would subtract it twice — and because only a Thelemar-rules exhausted
	// caster can reach it, that mistake would ship green. Pinned so it cannot.
	describe("a Thelemar-rules exhausted caster is penalised exactly once", () => {
		function makeExhausted (level) {
			const state = makeSorcerer();
			state.setExhaustionRules("thelemar");
			state.setExhaustion(level);
			return state;
		}

		it("PREMISE: exhaustion actually moves the canonical DC under Thelemar rules", async () => {
			// Without this the two assertions below would compare an unchanged number to itself.
			const plain = makeSorcerer().getSpellSaveDcForAbility("cha");
			expect(makeExhausted(3).getSpellSaveDcForAbility("cha")).toBe(plain - 3);
		});

		it("prints the canonical DC, not one with exhaustion double-counted", async () => {
			const state = makeExhausted(3);
			const {printed, logged} = await castAndReadDc(state);
			expect(printed).toBe(state.getSpellSaveDcForAbility("cha"));
			expect(logged).toBe(printed);
		});

		it("still layers the three bonus sources on top of the exhaustion penalty", async () => {
			const state = makeExhausted(2);
			const before = (await castAndReadDc(state)).printed;
			state._data.customModifiers.spellDc = 2;
			state._data.itemBonuses = {...(state._data.itemBonuses || {}), spellSaveDc: 1};
			const {printed} = await castAndReadDc(state);
			expect(printed).toBe(before + 3);
			expect(printed).toBe(state.getSpellSaveDcForAbility("cha"));
		});
	});

	// Gambler spellcasting rolls a die in place of the ability modifier, which is why the
	// cast site cannot simply call the no-argument accessor. The override must replace the
	// ABILITY MOD ONLY — every other term still applies.
	describe("Gambler spellcasting substitutes the rolled die for the ability mod alone", () => {
		/** Force the Gambler branch through the two values the cast site actually reads. */
		function makeGambler (dice) {
			const state = makeSorcerer();
			const realCalcs = state.getFeatureCalculations.bind(state);
			state.getFeatureCalculations = () => ({
				...realCalcs(),
				hasGamblerSpellcasting: true,
				gamblerModifierDice: dice,
			});
			return state;
		}

		const GAMBLER_SPELL = {name: "Probe Blast", source: "PHB", level: 3, sourceClass: "Gambler"};

		it("PREMISE: a fixed 1d1 die yields a DC that differs from the ability-mod DC", async () => {
			// CHA 18 is +4, so a guaranteed roll of 1 must move the printed DC by exactly -3.
			// If this ever stops holding, the two assertions below stop discriminating.
			const state = makeGambler("1d1");
			const {printed} = await castAndReadDc(state, GAMBLER_SPELL);
			expect(printed).toBe(state.getSpellSaveDcForAbility("cha") - 4 + 1);
		});

		it("still applies custom, item and active-state bonuses on top of the die", async () => {
			const state = makeGambler("1d1");
			const before = (await castAndReadDc(state, GAMBLER_SPELL)).printed;
			state._data.customModifiers.spellDc = 2;
			state._data.itemBonuses = {...(state._data.itemBonuses || {}), spellSaveDc: 1};
			const {printed, logged} = await castAndReadDc(state, GAMBLER_SPELL);
			expect(printed).toBe(before + 3);
			expect(logged).toBe(printed);
		});
	});
});
