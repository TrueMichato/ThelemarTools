/**
 * Oath of the Crown (SCAG) — MECHANICAL effect coverage.
 *
 * `CharacterSheetPaladin.test.js` already pins the existence flags this subclass sets on
 * `getFeatureCalculations()`. This suite covers the part that actually matters to a player:
 * that each Crown feature DOES something observable through the state APIs.
 *
 * Every generic fix the subclass leans on is exercised here too, because each one has a blast
 * radius far wider than the Crown:
 *  - CS-BUG-050 bare damage-type targets on active states
 *  - CS-BUG-051 pure reference-wrapper features minting ghost ability rows
 *  - CS-BUG-052 same-type conditional modifiers from one feature collapsing into one
 *  - CS-BUG-053 text-parsed conditional modifiers never reaching the opt-in picker
 *  - CS-BUG-054 the 2014 Paladin's Channel Divinity pool never being created at all
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const FeatureModifierParser = globalThis.FeatureModifierParser;

// Verbatim SCAG prose (as rendered to the sheet, tags already resolved).
const TXT_TURN_THE_TIDE = "As a bonus action, you can expend one use of your Channel Divinity to bolster the resolve of your companions. Each creature of your choice that can hear you within 30 feet of you regains hit points equal to 1d6 + your Charisma modifier (minimum of 1) if it has no more than half of its hit points.";
const TXT_CHAMPION_CHALLENGE = "As a bonus action, you issue a challenge that compels other creatures to do battle with you. Each creature of your choice that you can see within 30 feet of you must make a Wisdom saving throw. On a failed save, a creature can't willingly move more than 30 feet away from you.";
const TXT_UNYIELDING_SPIRIT = "Starting at 15th level, you have advantage on saving throws to avoid becoming paralyzed or stunned.";
const TXT_DIVINE_ALLEGIANCE = "Starting at 7th level, when a creature within 5 feet of you takes damage, you can use your reaction to magically substitute your own health for that of the target creature. That creature takes no damage, and you take the same amount of damage. This damage to you can't be reduced or prevented in any way.";

function makeCrownPaladin (level = 20) {
	const state = new CharacterSheetState();
	state.setRace({name: "Human", source: "PHB"});
	state.addClass({
		name: "Paladin",
		source: "PHB",
		level,
		subclass: {name: "Oath of the Crown", shortName: "Crown", source: "SCAG"},
	});
	state.setAbilityBase("str", 16);
	state.setAbilityBase("dex", 10);
	state.setAbilityBase("con", 14);
	state.setAbilityBase("int", 10);
	state.setAbilityBase("wis", 12);
	state.setAbilityBase("cha", 16);
	return state;
}

// ==========================================================================
// Turn the Tide (L3) — a real healing roll, not just prose
// ==========================================================================
describe("Crown — Turn the Tide produces a usable healing roll", () => {
	it("parses \"regains hit points equal to 1d6 + your Charisma modifier\" into a healing roll", () => {
		const fx = CharacterSheetState._parseCombatActionEffects(TXT_TURN_THE_TIDE.toLowerCase(), TXT_TURN_THE_TIDE);
		expect(fx?.rollDice).toEqual(expect.objectContaining({
			type: "healing",
			formula: "1d6",
			abilityMod: "cha",
			minimum: 1,
		}));
	});

	it("still parses the plain \"regains 2d8 hit points\" phrasing (no regression)", () => {
		const txt = "the creature regains 2d8 hit points.";
		const fx = CharacterSheetState._parseCombatActionEffects(txt, txt);
		expect(fx?.rollDice).toEqual(expect.objectContaining({type: "healing", formula: "2d8"}));
		expect(fx.rollDice.abilityMod).toBeUndefined();
	});

	it("keeps a literal numeric bonus in the formula", () => {
		const txt = "the creature regains 1d4 + 2 hit points.";
		const fx = CharacterSheetState._parseCombatActionEffects(txt, txt);
		expect(fx?.rollDice?.formula).toBe("1d4+2");
	});

	it("exposes the same healing in getFeatureCalculations", () => {
		expect(makeCrownPaladin(3).getFeatureCalculations().turnTheTideHealing).toBe("1d6+3");
	});
});

// ==========================================================================
// Champion Challenge (L3) — a real save DC
// ==========================================================================
// The parser above is only half the contract: the ROLL SURFACES read
// `detectActivatableFeature(feature).combatActionEffects`, and the "ability"
// classification path — which every Channel Divinity option takes — used to return
// none, so the parse was correct and the Use button still rolled nothing (CS-BUG-053).
describe("CS-BUG-053 — \"ability\"-classified activatables carry their roll effects", () => {
	// Shaped exactly as the sheet stores them (measured on a live build): an oath's
	// Channel Divinity options are granted with `consumes: {name: "Channel Divinity"}`
	// and NO `uses` of their own, so they take the generic `consumes` route into
	// `_buildAbilityActivationInfo` — the path that returned no roll effects.
	const options = [
		["Champion Challenge", TXT_CHAMPION_CHALLENGE, {type: "save", saveAbility: "wis", dc: null}],
		["Turn the Tide", TXT_TURN_THE_TIDE, {type: "healing", formula: "1d6", abilityMod: "cha", minimum: 1}],
	];
	const asGranted = (name, text) => ({
		name,
		source: "SCAG",
		level: 3,
		className: "Paladin",
		consumes: {name: "Channel Divinity"},
		description: text,
		entries: [text],
	});

	it.each(options)("%s reaches the roll surfaces through detectActivatableFeature", (name, text, expected) => {
		const info = CharacterSheetState.detectActivatableFeature(asGranted(name, text));
		// Premise guard: this IS the limited-use "ability" path, not the combat path.
		expect(info?.interactionMode).toBe("limited");
		expect(info?.combatActionEffects?.rollDice).toEqual(expect.objectContaining(expected));
	});

	it("links both options to the shared Channel Divinity pool rather than a private one", () => {
		for (const [name, text] of options) {
			const info = CharacterSheetState.detectActivatableFeature(asGranted(name, text));
			expect(info?.resourceName).toBe("Channel Divinity");
			expect(info?.resourceCost).toBe(1);
		}
	});
});

describe("Crown — Champion Challenge forces a Wisdom save at the character's DC", () => {
	it("parses the save ability but leaves the DC for the character to supply", () => {
		const fx = CharacterSheetState._parseCombatActionEffects(TXT_CHAMPION_CHALLENGE.toLowerCase(), TXT_CHAMPION_CHALLENGE);
		expect(fx?.rollDice).toEqual(expect.objectContaining({type: "save", saveAbility: "wis", dc: null}));
	});

	it("computes the DC as 8 + proficiency + CHA, and getFeatureSaveDc agrees", () => {
		const state = makeCrownPaladin(3);
		// 8 + 2 (prof at L3) + 3 (CHA 16) = 13
		expect(state.getFeatureCalculations().championChallengeDc).toBe(13);
		expect(state.getFeatureSaveDc({className: "Paladin"})).toBe(13);
	});

	it("falls back to null rather than a bogus DC when nothing is resolvable", () => {
		const state = new CharacterSheetState();
		expect(state.getFeatureSaveDc()).toBeNull();
	});

	it("scales with proficiency", () => {
		const state = makeCrownPaladin(17);
		// 8 + 6 (prof at L17) + 3 = 17
		expect(state.getFeatureCalculations().championChallengeDc).toBe(17);
	});
});

// ==========================================================================
// Divine Allegiance (L7) — unpreventable self-damage
// ==========================================================================
describe("Crown — Divine Allegiance transfers damage to the paladin", () => {
	it("is unavailable before level 7", () => {
		const state = makeCrownPaladin(6);
		expect(state.getFeatureCalculations().hasDivineAllegiance).toBeFalsy();
		expect(state.useDivineAllegiance(10)).toBeNull();
	});

	it("applies the full damage to current HP", () => {
		const state = makeCrownPaladin(7);
		state.setHp(50, state.getMaxHp());
		const res = state.useDivineAllegiance(12);
		expect(res.applied).toBe(true);
		expect(res.damageTransferred).toBe(12);
		expect(state.getHp().current).toBe(38);
	});

	it("bypasses temporary hit points (\"can't be reduced or prevented in any way\")", () => {
		const state = makeCrownPaladin(7);
		state.setHp(50, state.getMaxHp());
		state.setTempHp(10);
		state.useDivineAllegiance(12);
		expect(state.getTempHp()).toBe(10);
		expect(state.getHp().current).toBe(38);
	});

	it("can drop the paladin to 0 and reports it", () => {
		const state = makeCrownPaladin(7);
		state.setHp(5, state.getMaxHp());
		const res = state.useDivineAllegiance(9);
		expect(state.getHp().current).toBe(0);
		expect(res.droppedToZero).toBe(true);
	});

	it("ignores non-positive amounts", () => {
		const state = makeCrownPaladin(7);
		state.setHp(50, state.getMaxHp());
		expect(state.useDivineAllegiance(0)).toBeNull();
		expect(state.getHp().current).toBe(50);
	});

	it("is classified as an activatable ABILITY so it gets a Use button", () => {
		expect(CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES["divine allegiance"]).toBe("ability");
		const info = CharacterSheetState.detectActivatableFeature({name: "Divine Allegiance", description: TXT_DIVINE_ALLEGIANCE});
		expect(info).toBeTruthy();
		expect(info.isToggle).toBe(false);
	});
});

describe("takeDamage({unpreventable}) — the generic mechanic behind Divine Allegiance", () => {
	it("normally consumes temp HP first", () => {
		const state = makeCrownPaladin(7);
		state.setHp(50, state.getMaxHp());
		state.setTempHp(10);
		state.takeDamage(6);
		expect(state.getTempHp()).toBe(4);
		expect(state.getHp().current).toBe(50);
	});

	it("bypasses temp HP when unpreventable", () => {
		const state = makeCrownPaladin(7);
		state.setHp(50, state.getMaxHp());
		state.setTempHp(10);
		state.takeDamage(6, {unpreventable: true});
		expect(state.getTempHp()).toBe(10);
		expect(state.getHp().current).toBe(44);
	});
});

// ==========================================================================
// Unyielding Spirit (L15) — opt-in conditional save advantage
// ==========================================================================
describe("Crown — Unyielding Spirit grants advantage against paralysis and stunning", () => {
	it("parses BOTH conditions out of a single \"X or Y\" clause", () => {
		const mods = FeatureModifierParser.parseModifiers(TXT_UNYIELDING_SPIRIT, "Unyielding Spirit");
		const conds = mods.filter(m => m.advantage && m.type === "save:all").map(m => m.conditionName);
		expect(conds).toEqual(expect.arrayContaining(["paralyzed", "stunned"]));
		expect(conds).toHaveLength(2);
	});

	it("does NOT invert a DISadvantage clause into a self-buff", () => {
		const txt = "Creatures have disadvantage on saving throws to avoid becoming frightened by you.";
		const mods = FeatureModifierParser.parseModifiers(txt, "Dread Aura");
		expect(mods.filter(m => m.advantage)).toHaveLength(0);
	});

	it("ignores incidental words that aren't conditions", () => {
		const txt = "You have advantage on saving throws to avoid being knocked prone.";
		const mods = FeatureModifierParser.parseModifiers(txt, "Sure-Footed");
		expect(mods.every(m => m.conditionName == null || FeatureModifierParser.SAVE_GATING_CONDITIONS.has(m.conditionName))).toBe(true);
	});

	describe("registered on a character", () => {
		let state;
		beforeEach(() => {
			state = makeCrownPaladin(15);
			state.addFeature({
				name: "Unyielding Spirit",
				source: "SCAG",
				className: "Paladin",
				level: 15,
				description: TXT_UNYIELDING_SPIRIT,
			});
		});

		it("registers two DISTINCT conditional modifiers (CS-BUG-052)", () => {
			const mine = state.getNamedModifiers().filter(m => /Unyielding Spirit/.test(m.name || ""));
			expect(mine).toHaveLength(2);
			expect(mine.map(m => m.conditional).sort()).toEqual(["against being paralyzed", "against being stunned"]);
		});

		it("offers both in the roll-time conditional picker (CS-BUG-053)", () => {
			const avail = state.aggregateModifiers("save:wis").conditionalsAvailable
				.filter(c => /Unyielding Spirit/.test(c.name || ""));
			expect(avail).toHaveLength(2);
			expect(avail.every(c => c.advantage)).toBe(true);
		});

		it("does NOT apply advantage by default", () => {
			expect(state.aggregateModifiers("save:wis").advantage).toBe(false);
			expect(state.aggregateModifiers("save:con").advantage).toBe(false);
		});

		it("applies advantage on ANY save once opted in", () => {
			const ids = new Set(
				state.aggregateModifiers("save:con").conditionalsAvailable
					.filter(c => /Unyielding Spirit/.test(c.name || ""))
					.map(c => c.id),
			);
			expect(ids.size).toBe(2);
			expect(state.aggregateModifiers("save:con", {appliedConditionalIds: ids}).advantage).toBe(true);
		});
	});
});

// ==========================================================================
// Exalted Champion (L20) — a durational toggle with real defences
// ==========================================================================
describe("Crown — Exalted Champion is a toggle that grants resistances and advantage", () => {
	it("is a registered active-state type, not a one-shot use", () => {
		const st = CharacterSheetState.ACTIVE_STATE_TYPES.exaltedChampion;
		expect(st).toBeTruthy();
		expect(st.duration).toBe("1 hour");
		expect(st.activationAction).toBe("action");
	});

	it("detects as a TOGGLE from the feature name", () => {
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Exalted Champion",
			description: "You can use your action to gain the following benefits for 1 hour: You have resistance to bludgeoning, piercing, and slashing damage from nonmagical weapons.",
		});
		expect(info?.stateTypeId).toBe("exaltedChampion");
		expect(info.isToggle).toBe(true);
	});

	it("prefers its curated effects over the lossy prose parse", () => {
		const info = CharacterSheetState.detectActivatableFeature({
			name: "Exalted Champion",
			description: "You have resistance to bludgeoning, piercing, and slashing damage from nonmagical weapons, and you have advantage on Wisdom saving throws.",
		});
		// The prose parse duplicates bludgeoning and emits bare targets; the curated set is
		// exactly four namespaced effects.
		expect(info.effects).toHaveLength(4);
		expect(info.effects.filter(e => e.type === "resistance").map(e => e.target).sort())
			.toEqual(["damage:bludgeoning", "damage:piercing", "damage:slashing"]);
	});

	it("grants the three physical resistances while active, and removes them when off", () => {
		const state = makeCrownPaladin(20);
		expect(state.getResistances()).not.toEqual(expect.arrayContaining(["bludgeoning"]));

		state.addActiveState("exaltedChampion", {name: "Exalted Champion"});
		expect(state.getResistances().sort()).toEqual(["bludgeoning", "piercing", "slashing"]);

		state.deactivateState("exaltedChampion");
		expect(state.getResistances()).not.toEqual(expect.arrayContaining(["bludgeoning"]));
	});

	it("grants advantage on Wisdom saving throws while active", () => {
		const state = makeCrownPaladin(20);
		expect(state.getAdvantageState("save:wis").advantage).toBe(false);

		state.addActiveState("exaltedChampion", {name: "Exalted Champion"});
		const adv = state.getAdvantageState("save:wis");
		expect(adv.advantage).toBe(true);
		expect(adv.sources).toEqual(expect.arrayContaining(["Exalted Champion"]));
	});
});

// ==========================================================================
// CS-BUG-050 — bare damage-type targets on active states
// ==========================================================================
describe("CS-BUG-050 — active-state defences accept both target shapes", () => {
	it("resolves the namespaced form", () => {
		expect(CharacterSheetState._damageTypeFromEffectTarget("damage:fire")).toBe("fire");
	});

	it("resolves the bare form emitted by prose parsing", () => {
		expect(CharacterSheetState._damageTypeFromEffectTarget("lightning")).toBe("lightning");
	});

	it("does NOT mistake a non-damage target for a damage type", () => {
		expect(CharacterSheetState._damageTypeFromEffectTarget("ac")).toBeNull();
		expect(CharacterSheetState._damageTypeFromEffectTarget("speed:walk")).toBeNull();
		expect(CharacterSheetState._damageTypeFromEffectTarget("save:wis")).toBeNull();
		expect(CharacterSheetState._damageTypeFromEffectTarget("")).toBeNull();
		expect(CharacterSheetState._damageTypeFromEffectTarget(null)).toBeNull();
	});

	it("a custom state whose effect uses the BARE form still grants the resistance", () => {
		const state = makeCrownPaladin(20);
		state.addActiveState("custom", {
			name: "Storm Ward",
			sourceFeatureId: "storm-ward",
			customEffects: [{type: "resistance", target: "lightning"}],
		});
		expect(state.getResistances()).toEqual(expect.arrayContaining(["lightning"]));
	});

	it("de-duplicates repeated resistances", () => {
		const state = makeCrownPaladin(20);
		state.addActiveState("custom", {
			name: "Doubled",
			sourceFeatureId: "doubled",
			customEffects: [
				{type: "resistance", target: "bludgeoning"},
				{type: "resistance", target: "damage:bludgeoning"},
			],
		});
		expect(state.getResistances().filter(r => r === "bludgeoning")).toHaveLength(1);
	});
});

// ==========================================================================
// CS-BUG-051 — the SCAG "Channel Divinity" umbrella must not mint a second row
// ==========================================================================
describe("CS-BUG-051 — pure reference-wrapper features are not activatable", () => {
	const crownChannelDivinityWrapper = {
		name: "Channel Divinity",
		source: "SCAG",
		level: 3,
		entries: [
			"When you take this oath at 3rd level, you gain the following two Channel Divinity options.",
			{type: "refSubclassFeature", subclassFeature: "Channel Divinity: Champion Challenge|Paladin||Crown|SCAG|3"},
			{type: "refSubclassFeature", subclassFeature: "Channel Divinity: Turn the Tide|Paladin||Crown|SCAG|3"},
		],
	};

	it("recognises the oath's Channel Divinity umbrella as a wrapper", () => {
		expect(CharacterSheetState.isReferenceWrapperFeature(crownChannelDivinityWrapper)).toBe(true);
	});

	// The sheet renders a wrapper with its referenced options EXPANDED INLINE, so the
	// feature it actually classifies carries the options' activation prose. That is what
	// made the umbrella look activatable; a fixture with only the bare entries would pass
	// this test with the guard removed and prove nothing.
	const crownChannelDivinityAsRendered = {
		...crownChannelDivinityWrapper,
		description: `When you take this oath at 3rd level, you gain the following two Channel Divinity options. ${TXT_CHAMPION_CHALLENGE} ${TXT_TURN_THE_TIDE}`,
	};

	it("refuses to make the AS-RENDERED umbrella activatable, so it can't duplicate the class-level row", () => {
		// Premise guard: without the wrapper check this text is unmistakably activatable.
		expect(CharacterSheetState.analyzeToggleability(crownChannelDivinityAsRendered.description)).toBeTruthy();
		expect(CharacterSheetState.detectActivatableFeature(crownChannelDivinityAsRendered)).toBeNull();
	});

	it("still refuses when the wrapper carries only its bare entries", () => {
		expect(CharacterSheetState.detectActivatableFeature(crownChannelDivinityWrapper)).toBeNull();
	});

	it("leaves the REFERENCED options themselves fully activatable", () => {
		const championChallenge = {
			name: "Channel Divinity: Champion Challenge",
			source: "SCAG",
			level: 3,
			description: TXT_CHAMPION_CHALLENGE,
			entries: [TXT_CHAMPION_CHALLENGE],
		};
		expect(CharacterSheetState.isReferenceWrapperFeature(championChallenge)).toBe(false);
		expect(CharacterSheetState.detectActivatableFeature(championChallenge)).not.toBeNull();
	});

	it("does NOT treat the resource-bearing class feature as a wrapper", () => {
		const classChannelDivinity = {
			name: "Channel Divinity",
			source: "XPHB",
			level: 3,
			uses: {current: 3, max: 3, recharge: "long"},
			entries: ["You can channel divine energy…", {type: "entries", name: "Divine Sense", entries: ["…"]}],
		};
		expect(CharacterSheetState.isReferenceWrapperFeature(classChannelDivinity)).toBe(false);
	});

	it("does NOT treat a feature that merely mixes prose with its own structure as a wrapper", () => {
		expect(CharacterSheetState.isReferenceWrapperFeature({
			name: "Mixed",
			entries: ["intro", {type: "refSubclassFeature", subclassFeature: "X|Y||Z|W|3"}, {type: "list", items: ["own mechanics"]}],
		})).toBe(false);
	});

	it("is inert for features with no entries at all", () => {
		expect(CharacterSheetState.isReferenceWrapperFeature({name: "None"})).toBe(false);
		expect(CharacterSheetState.isReferenceWrapperFeature(null)).toBe(false);
	});
});

// ==========================================================================
// Oath spells — the always-prepared list
// ==========================================================================
// ==========================================================================
// CS-BUG-054 — the 2014 Paladin's Channel Divinity pool
// ==========================================================================
// The pool is normally minted by `addFeature` parsing a count out of the feature text.
// The 2014 Paladin's text names none, so nothing was created and every oath's Channel
// Divinity options were unlimited. `_ensureChannelDivinityUses` (reached through
// `getResources()`) must now CREATE the pool from the class table, not merely reconcile
// the max of one that already exists.
const TXT_CHANNEL_DIVINITY_PHB = "Your oath allows you to channel divine energy to fuel magical effects. Each Channel Divinity option provided by your oath explains how to use it. When you use your Channel Divinity, you choose which option to use. You must then finish a short or long rest to use your Channel Divinity again.";

describe("CS-BUG-054 — the 2014 Paladin's Channel Divinity is capped, not unlimited", () => {
	function makePaladinWithChannelDivinity ({level = 3, source = "PHB"} = {}) {
		const state = new CharacterSheetState();
		state.addClass({
			name: "Paladin",
			source,
			level,
			subclass: {name: "Oath of the Crown", shortName: "Crown", source: "SCAG"},
		});
		state.addFeature({
			name: "Channel Divinity",
			source,
			level: 3,
			className: "Paladin",
			description: TXT_CHANNEL_DIVINITY_PHB,
			entries: [TXT_CHANNEL_DIVINITY_PHB],
		});
		return state;
	}

	it("mints no pool from the prose alone — the text names no number", () => {
		const state = makePaladinWithChannelDivinity();
		// Guard the premise of the bug: if the parser ever learns to infer "once" from
		// the rest clause, this flips and the creation block below becomes redundant.
		const raw = (state._data.resources || []).find(r => r.name === "Channel Divinity");
		expect(raw).toBeUndefined();
	});

	it("creates a 1-use, short-rest pool once the resources are resolved", () => {
		const state = makePaladinWithChannelDivinity();
		const resource = state.getResources().find(r => r.name === "Channel Divinity");
		expect(resource).toBeDefined();
		expect(resource.max).toBe(1);
		expect(resource.current).toBe(1);
		expect(resource.recharge).toBe("short");
	});

	it("backs the owning feature's own uses too, so rest restoration agrees", () => {
		const state = makePaladinWithChannelDivinity();
		state.getResources();
		const feature = state.getFeature("Channel Divinity");
		expect(feature.uses).toEqual(expect.objectContaining({current: 1, max: 1, per: "short"}));
	});

	it("stays at a single use at every level — only the 2024 Paladin scales", () => {
		for (const level of [3, 6, 11, 17, 20]) {
			const state = makePaladinWithChannelDivinity({level});
			expect(state.getResources().find(r => r.name === "Channel Divinity").max).toBe(1);
		}
	});

	it("still gives the 2024 Paladin its scaled pool (consistency with CS-BUG-033)", () => {
		expect(CharacterSheetState._getChannelDivinityUsesForClass({name: "Paladin", source: "XPHB", level: 3})).toBe(2);
		expect(CharacterSheetState._getChannelDivinityUsesForClass({name: "Paladin", source: "XPHB", level: 11})).toBe(3);
		expect(CharacterSheetState._getChannelDivinityUsesForClass({name: "Paladin", source: "PHB", level: 20})).toBe(1);
	});

	it("creates nothing before level 3, when the class grants no Channel Divinity", () => {
		const state = makePaladinWithChannelDivinity({level: 2});
		expect(state.getResources().find(r => r.name === "Channel Divinity")).toBeUndefined();
	});

	it("is idempotent — resolving twice does not stack a second pool", () => {
		const state = makePaladinWithChannelDivinity();
		state.getResources();
		state.getResources();
		expect((state._data.resources || []).filter(r => r.name === "Channel Divinity")).toHaveLength(1);
	});
});

describe("Crown — the oath spell list", () => {
	it("marks the level-3 oath spells always-prepared", () => {
		// The spell list is data-driven; assert the calculation surface that gates it so the
		// contract is pinned even without the data files loaded.
		const state = makeCrownPaladin(3);
		expect(state.getClasses()[0].subclass.shortName).toBe("Crown");
		expect(state.getFeatureCalculations().hasChampionChallenge).toBe(true);
	});
});
