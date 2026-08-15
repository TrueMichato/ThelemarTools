/**
 * Circle of the Zodiac / Known-Forms — Round 25 S3 (bugs #12, #13).
 *
 * #12 Carry-capacity leak: Zodiac Form constellation FORM features (Aurochs,
 *     Octopus, Griffon, …) must NOT register always-on named modifiers. Their
 *     mechanical effects (e.g. Aurochs "count as one size larger for carrying
 *     capacity") belong to the ACTIVE Zodiac Form state and apply ONLY while the
 *     druid is transformed into that specific form. A stale, persisted form
 *     modifier double-counted the carrying-capacity size bump (×4 instead of ×2).
 *
 * #13 Magician (Primal Order): the Arcana/Nature bonus must equal the LIVE
 *     Wisdom modifier (minimum +1), tracking WIS as it changes instead of baking
 *     a numeric value that drifts.
 *
 * These assert REAL mechanics (named-modifier presence, carry multiplier, live
 * skill deltas), not existence-only / level counts.
 */

import "./setup.js";

let CharacterSheetState;
let state;

const AUROCHS_DESCRIPTION = "You have advantage on Strength checks and Strength saving throws, and you add your proficiency bonus to those rolls. You also count as one size larger when determining your carrying capacity and the weight you can push, drag, or lift.";

const makeZodiacFormFeature = (name, description) => ({
	name,
	id: `feat-${name.toLowerCase()}`,
	description,
	subclassName: "Circle of the Zodiac",
	subclassShortName: "Zodiac",
	isSubclassFeature: true,
	featureType: "Class",
	source: "TGTT",
});

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

beforeEach(() => {
	state = new CharacterSheetState();
});

describe("#12 — Zodiac Form feature detection (isZodiacFormFeature)", () => {
	test("matches a constellation FORM feature (Aurochs) of the Zodiac subclass", () => {
		expect(CharacterSheetState.isZodiacFormFeature(makeZodiacFormFeature("Aurochs", AUROCHS_DESCRIPTION))).toBe(true);
		expect(CharacterSheetState.isZodiacFormFeature(makeZodiacFormFeature("Octopus", "swim speed"))).toBe(true);
		expect(CharacterSheetState.isZodiacFormFeature(makeZodiacFormFeature("Griffon", "advantage vs frightened"))).toBe(true);
	});

	test("does NOT match the subclass framework features", () => {
		expect(CharacterSheetState.isZodiacFormFeature(makeZodiacFormFeature("Star Map", "framework"))).toBe(false);
		expect(CharacterSheetState.isZodiacFormFeature(makeZodiacFormFeature("Zodiac Form: Month", "framework"))).toBe(false);
		expect(CharacterSheetState.isZodiacFormFeature(makeZodiacFormFeature("Circle of the Zodiac", "framework"))).toBe(false);
	});

	test("does NOT match a same-named feature from a different subclass", () => {
		expect(CharacterSheetState.isZodiacFormFeature({
			name: "Aurochs",
			subclassName: "Circle of the Moon",
			subclassShortName: "Moon",
		})).toBe(false);
	});

	test("is null-safe", () => {
		expect(CharacterSheetState.isZodiacFormFeature(null)).toBe(false);
		expect(CharacterSheetState.isZodiacFormFeature(undefined)).toBe(false);
		expect(CharacterSheetState.isZodiacFormFeature({})).toBe(false);
	});
});

describe("#12 — addFeature must NOT register an always-on modifier for a form feature", () => {
	test("Aurochs (carrying-capacity size bump) registers no carryCapacity named modifier", () => {
		state.addFeature(makeZodiacFormFeature("Aurochs", AUROCHS_DESCRIPTION));
		const carryMods = (state._data.namedModifiers || [])
			.filter(m => m.type === "carryCapacity");
		expect(carryMods).toHaveLength(0);
	});

	test("a NON-form feature with the same text DOES still register (skip is form-scoped)", () => {
		// Same carrying-capacity prose, but on a generic racial trait — must NOT be skipped.
		state.addFeature({
			name: "Powerful Build",
			id: "feat-powerful-build",
			description: "You count as one size larger when determining your carrying capacity and the weight you can push, drag, or lift.",
			featureType: "Species",
			source: "PHB",
		});
		const carryMods = (state._data.namedModifiers || [])
			.filter(m => m.type === "carryCapacity" && m.sizeIncrease);
		expect(carryMods.length).toBeGreaterThan(0);
	});
});

describe("#12 — load migration strips stale form-sourced modifiers + fixes carry math", () => {
	const buildSave = () => ({
		abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
		features: [makeZodiacFormFeature("Aurochs", AUROCHS_DESCRIPTION)],
		namedModifiers: [
			// Legit, always-on racial size bump (Centaur Equine Build).
			{id: "m-equine", name: "Equine Build", note: "From Equine Build", type: "carryCapacity", sizeIncrease: true, enabled: true},
			// STALE residue: Aurochs form size bump persisted enabled while NOT transformed.
			{id: "m-aurochs", name: "Aurochs", note: "From Aurochs", type: "carryCapacity", sizeIncrease: true, enabled: true, sourceFeatureId: "feat-aurochs"},
		],
	});

	test("the stale Aurochs form modifier is removed on load; the legit Equine one survives", () => {
		state.loadFromJson(buildSave());
		const names = (state._data.namedModifiers || []).map(m => m.name);
		expect(names).toContain("Equine Build");
		expect(names).not.toContain("Aurochs");
	});

	test("carry multiplier is ×2 (Equine only), not ×4 (the double-counted bug)", () => {
		state.loadFromJson(buildSave());
		expect(state._data.customModifiers.carryCapacityMultiplier).toBe(2);
	});

	test("BEFORE the migration both size bumps would have doubled (×4) — guards against regression", () => {
		// Sanity: prove the two enabled sizeIncrease mods really do compound when present,
		// so the migration removing one is what brings it back to ×2.
		state.loadFromJson({
			abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
			features: [], // no form feature → migration can't identify the Aurochs source → both remain
			namedModifiers: [
				{id: "m-equine", name: "Equine Build", note: "From Equine Build", type: "carryCapacity", sizeIncrease: true, enabled: true},
				{id: "m-other", name: "Some Other Size Boost", note: "From Other", type: "carryCapacity", sizeIncrease: true, enabled: true},
			],
		});
		expect(state._data.customModifiers.carryCapacityMultiplier).toBe(4);
	});
});

describe("#13 — Magician (Primal Order) Arcana/Nature bonus equals the LIVE Wisdom modifier", () => {
	const makeMagicianDruid = (wisScore) => {
		state.addClass({name: "Druid", source: "TGTT", level: 1});
		state.addFeature({name: "Magician", source: "TGTT", description: "You learn one extra cantrip and add your Wisdom modifier to Intelligence (Arcana) and Wisdom (Nature) checks."});
		state.setAbilityBase("int", 10); // +0, keeps the magician contribution isolated
		state.setAbilityBase("wis", wisScore);
		state.setSpellcastingAbility("wis");
		state.applyClassFeatureEffects();
	};

	test("registers a LIVE abilityMod modifier (not a baked numeric value)", () => {
		makeMagicianDruid(16); // WIS +3
		for (const skill of ["arcana", "nature"]) {
			const mods = state.getNamedModifiersByType(`skill:${skill}`)
				.filter(m => /magician/i.test(m.name || ""));
			expect(mods).toHaveLength(1);
			expect(mods[0].abilityMod).toBe("wis");
			expect(mods[0].minValue).toBe(1);
			expect(mods[0].value).toBe(0); // no baked numeric bonus
		}
	});

	test("the dynamic skill bonus equals the current WIS modifier", () => {
		makeMagicianDruid(16); // WIS +3
		expect(state._getDynamicSkillFeatureBonus("arcana")).toBe(3);
		expect(state._getDynamicSkillFeatureBonus("nature")).toBe(3);
	});

	test("changing WIS updates the bonus LIVE — no re-apply / reconcile needed", () => {
		makeMagicianDruid(16); // WIS +3
		const arcanaBefore = state.getSkillMod("arcana");
		const natureBefore = state.getSkillMod("nature");

		// Bump WIS by +4 (16 → 20, mod +3 → +5) WITHOUT re-running applyClassFeatureEffects.
		state.setAbilityBase("wis", 20);

		expect(state.getSkillMod("arcana")).toBe(arcanaBefore + 2);
		expect(state.getSkillMod("nature")).toBe(natureBefore + 2);
		expect(state._getDynamicSkillFeatureBonus("arcana")).toBe(5);
	});

	test("applies the minimum +1 floor when the WIS modifier is negative", () => {
		makeMagicianDruid(8); // WIS -1
		expect(state._getDynamicSkillFeatureBonus("arcana")).toBe(1);
		expect(state._getDynamicSkillFeatureBonus("nature")).toBe(1);
	});

	test("does not bake a value that drifts when WIS later drops", () => {
		makeMagicianDruid(20); // WIS +5
		expect(state._getDynamicSkillFeatureBonus("arcana")).toBe(5);
		state.setAbilityBase("wis", 10); // +0 → floor to +1
		expect(state._getDynamicSkillFeatureBonus("arcana")).toBe(1);
	});
});

describe("#13 follow-up — orphaned feature-sourced named modifiers are cleaned up on load", () => {
	// A real feature that still exists on the character (its modifier must survive).
	const livingFeature = () => ({name: "Roving", id: "feat-roving", description: "Your walking speed increases.", featureType: "Class", source: "PHB"});

	test("strips a parser-minted modifier whose sourceFeatureId matches no current feature", () => {
		state.loadFromJson({
			abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
			features: [livingFeature()],
			namedModifiers: [
				// Orphan: "Forest Sage" feature was removed, but its abilitySwap mod lingers.
				{id: "m-orphan", name: "Forest Sage", type: "abilitySwap:arcana", newAbility: "wis", enabled: true, sourceFeatureId: "feat-forest-sage-GONE"},
			],
		});
		const names = (state._data.namedModifiers || []).map(m => m.name);
		expect(names).not.toContain("Forest Sage");
	});

	test("preserves a modifier whose sourceFeatureId references a feature that still exists", () => {
		state.loadFromJson({
			abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
			features: [livingFeature()],
			namedModifiers: [
				{id: "m-roving", name: "Roving", type: "speed:walk", value: 10, enabled: true, sourceFeatureId: "feat-roving"},
			],
		});
		const names = (state._data.namedModifiers || []).map(m => m.name);
		expect(names).toContain("Roving");
	});

	test("preserves a modifier that has NO sourceFeatureId (racial/manual/legit)", () => {
		state.loadFromJson({
			abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
			features: [],
			namedModifiers: [
				{id: "m-manual", name: "Manual Bonus", type: "skill:stealth", value: 2, enabled: true},
			],
		});
		const names = (state._data.namedModifiers || []).map(m => m.name);
		expect(names).toContain("Manual Bonus");
	});

	test("preserves a MANAGED modifier (sourceType set) even when its sourceFeatureId is not a feature", () => {
		// Custom-ability modifiers legitimately reference a non-feature owner (ca_… ids)
		// and own their own lifecycle, so the orphan sweep must never touch them.
		state.loadFromJson({
			abilities: {str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10},
			features: [],
			namedModifiers: [
				{id: "m-ca", name: "Pan's Apostle: ability:wis", type: "ability:wis", value: 2, enabled: true, sourceType: "customAbility", sourceFeatureId: "ca_pans-apostle"},
			],
		});
		const names = (state._data.namedModifiers || []).map(m => m.name);
		expect(names).toContain("Pan's Apostle: ability:wis");
	});

	test("an orphaned abilitySwap no longer swaps the skill's ability (Arcana stays INT, not WIS)", () => {
		state.loadFromJson({
			abilities: {str: 10, dex: 10, con: 10, int: 8, wis: 20, cha: 10}, // INT -1, WIS +5
			skillProficiencies: {arcana: 1},
			features: [],
			namedModifiers: [
				// Orphaned Forest Sage swap that would otherwise prefer WIS (+5) over INT (-1).
				{id: "m-orphan", name: "Forest Sage", type: "abilitySwap:arcana", newAbility: "wis", enabled: true, sourceFeatureId: "feat-forest-sage-GONE"},
			],
		});
		const bd = state.getSkillBreakdown("arcana");
		expect(bd.ability).toBe("int");
		const abilityComp = (bd.components || []).find(c => c.type === "ability");
		expect(abilityComp.name).toBe("INT modifier"); // NOT "INT modifier (swapped from …)"
	});
});

/**
 * CS-BUG-163 — the ACTIVATION analogue of the modifier leak above.
 *
 * `isZodiacFormFeature` already gated the modifier parser so a constellation's
 * bonuses cannot leak while the druid is NOT in that form. The same reasoning
 * applies to activation: a constellation DESCRIBES one option of "Zodiac Form:
 * Month" and is never independently activatable — the parent owns activation
 * (stateTypeId "zodiacForm" + needsFormChoice, routed to the Druid Resources
 * modal) and the form's mechanics come from ZODIAC_FORM_DEFS `getEffects()`
 * keyed off the active state's `formId`.
 *
 * Bee's prose ("When you activate this form, and as a Bonus Action … you can
 * make a ranged spell attack") tripped the generic activation analysis into
 * classifying it as its own `stateTypeId: "custom"` toggle. That surfaced a row
 * in the Overview "Available to Activate" strip which was present, enabled,
 * indistinguishable from a working toggle — and inert, because it never set a
 * formId and so never ran any getEffects().
 */
describe("CS-BUG-163 — Zodiac constellations are not independently activatable", () => {
	const mkForm = (name, description) => ({
		name,
		source: "TGTT",
		className: "Druid",
		classSource: "TGTT",
		subclassShortName: "Zodiac",
		subclassSource: "TGTT",
		level: 3,
		header: 2,
		description,
	});

	test("Bee — the form whose wording tripped the analysis — is not activatable", () => {
		const bee = mkForm("Bee", "When you activate this form, and as a Bonus Action on subsequent turns while it lasts, you can make a ranged spell attack against one creature within 60 feet. On a hit, the attack deals radiant damage equal to 1d8 + your Wisdom modifier.");
		expect(CharacterSheetState.detectActivatableFeature(bee)).toBeNull();
	});

	test("every ZODIAC_FORM_DEFS constellation is non-activatable, whatever its wording", () => {
		// Data-driven so a new tier's forms are covered as their defs are added,
		// rather than pinning the one name that happened to regress.
		const activatable = CharacterSheetState.ZODIAC_FORM_DEFS
			.filter(def => CharacterSheetState.detectActivatableFeature(
				mkForm(def.name, `When you activate this form you can ${def.summary || "do something"}.`),
			))
			.map(def => def.name);
		expect(activatable).toEqual([]);
	});

	test("the PARENT feature still owns activation and still routes to the Druid Resources modal", () => {
		// The guard must not disarm the working path: this is what makes the fix a
		// redirection rather than a removal.
		const parent = {
			name: "Zodiac Form: Month",
			source: "TGTT",
			className: "Druid",
			subclassShortName: "Zodiac",
			level: 3,
			description: "You can use your Wild Shape to assume a zodiac form.",
		};
		const detected = CharacterSheetState.detectActivatableFeature(parent);
		expect(detected).not.toBeNull();
		expect(detected.stateTypeId).toBe("zodiacForm");
		expect(detected.needsFormChoice).toBe(true);
		expect(CharacterSheetState.isDruidResourceActivatable({stateTypeId: detected.stateTypeId, feature: parent})).toBe(true);
	});

	test("a same-named feature OUTSIDE the Zodiac subclass is unaffected", () => {
		// The predicate is subclass-gated, so an unrelated 'Cat'/'Hound' feature
		// elsewhere must keep whatever classification it had.
		const impostor = {
			name: "Bee",
			source: "XPHB",
			className: "Ranger",
			subclassShortName: "Beast Master",
			description: "When you activate this form, and as a Bonus Action on subsequent turns while it lasts, you can make a ranged spell attack against one creature within 60 feet.",
		};
		expect(CharacterSheetState.detectActivatableFeature(impostor)).not.toBeNull();
	});
});
