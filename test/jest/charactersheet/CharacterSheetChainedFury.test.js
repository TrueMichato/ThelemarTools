/**
 * Effect-level coverage for Barbarian / Path of the Chained Fury (TGTT).
 *
 * WHY A SEPARATE FILE FROM `CharacterSheetTGTT.test.js`.
 *
 * The pre-existing Chained Fury tests in that file assert `calculations.chain*`
 * keys and the presence of feature rows. Every one of them passed while the
 * subclass was COMPLETELY INERT — measured before this work: at L3/6/10/14/18/20
 * `grantedAttacks` was null, `getFeatureGrantedAttacks()` returned `[]` (even
 * with rage active), `weaponDamageRiders` was null, `getActivatableFeatures()`
 * returned `[]`, and `getMeleeReach()` was 5. A calc key nothing reads is not a
 * feature, and a test that asserts one is not coverage.
 *
 * So this file deliberately asserts only things a PLAYER can observe:
 *   - does a weapon appear in the attack list, and only when it should
 *   - what is its reach, its damage die, its ability, its rage bonus
 *   - is the toggle offered, and does it disappear correctly
 *   - do the on-hit riders carry the right DC and damage
 *   - does any of it survive a save/load round-trip
 *
 * Several tests here would have passed against the inert implementation only by
 * accident; each one is written to fail if the wiring is removed.
 */

import "./setup.js";

let CharacterSheetState;
let CharacterSheetClassUtils;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
	CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
});

/** The real subclass-feature text, verbatim from `homebrew/TravelersGuidetoThelemar.json`. */
const FEATURE_TEXT = {
	"Manifest Chains": "When you rage, you can choose to manifest a pair of spectral chains, connected to your arms. The chains function as an extension of your psyche. You determine the appearance of the chains, and they vanish when your rage ends.",
	"Chain Imprisonment": "The chains count as magical for the purpose of overcoming resistance and immunity to nonmagical attacks and damage.",
	"Chain Control": "When grappling a creature, or attempting to move a creature grappled by your chains, you count as 2 size categories larger than you regularly do, instead of 1.",
	"Unchained Fury": "You manifest 4 sets of chains when you enter rage instead of 2. You can grapple any creature with your chains, regardless of size.",
};
const FEATURE_LEVELS = [[3, "Manifest Chains"], [6, "Chain Imprisonment"], [10, "Chain Control"], [14, "Unchained Fury"]];

/** A Chained Fury barbarian at `level`, with STR/DEX/CON set for predictable maths. */
const mkFury = (level) => {
	const state = new CharacterSheetState();
	state.setAbilityBase("str", 18);
	state.setAbilityBase("dex", 14);
	state.setAbilityBase("con", 16);
	state.addClass({
		name: "Barbarian",
		source: "TGTT",
		level,
		subclass: {name: "Path of the Chained Fury", shortName: "Chained Fury", source: "TGTT"},
	});
	// Mirror what the Builder / Level-Up do: put the subclass feature rows on the
	// sheet. `getActivatableFeatures()` reads those rows, so a state-only setup
	// would silently under-test the toggle surface.
	FEATURE_LEVELS.forEach(([lvl, name]) => {
		if (level >= lvl) state.addFeature({name, source: "TGTT", description: FEATURE_TEXT[name]});
	});
	return state;
};

/** Rage, then manifest. Returns the state for chaining. */
const rageAndManifest = (state) => {
	state.activateState("rage");
	state.activateState("manifestChains");
	return state;
};

const getChains = (state) => (state.getFeatureGrantedAttacks() || []).find(a => a.sourceFeature === "Manifest Chains");

describe("Chained Fury — L3 Manifest Chains", () => {
	it("does NOT offer the chains toggle until the barbarian is raging", () => {
		const state = mkFury(3);
		const names = (state.getActivatableFeatures() || []).map(f => f.activationInfo?.stateType?.name);
		expect(names).not.toContain("Manifest Chains");
	});

	it("refuses to manifest outside rage — the state cannot be forced on", () => {
		const state = mkFury(3);
		expect(state.activateState("manifestChains")).toBeNull();
		expect(state.isStateTypeActive("manifestChains")).toBe(false);
	});

	it("offers the chains toggle once raging", () => {
		const state = mkFury(3);
		state.activateState("rage");
		const names = (state.getActivatableFeatures() || []).map(f => f.activationInfo?.stateType?.name);
		expect(names).toContain("Manifest Chains");
	});

	it("puts NO chain weapon in the attack list until manifested", () => {
		const state = mkFury(3);
		expect(getChains(state)).toBeUndefined();
		state.activateState("rage");
		expect(getChains(state)).toBeUndefined();
	});

	it("puts a Spectral Chains weapon in the attack list once manifested", () => {
		const state = rageAndManifest(mkFury(3));
		const chains = getChains(state);
		expect(chains).toBeDefined();
		expect(chains.name).toBe("Spectral Chains");
		expect(chains.isMelee).toBe(true);
		expect(chains.damage).toBe("1d8");
		expect(chains.damageType).toBe("force");
		expect(chains.isFeatureAttack).toBe(true);
	});

	it("gives the chains 15 ft. reach WITHOUT extending the barbarian's other melee reach", () => {
		const state = rageAndManifest(mkFury(3));
		expect(state.getAttackReach(getChains(state))).toBe(15);
		// The greataxe must NOT grow. A global reach effect would have broken this.
		expect(state.getMeleeReach()).toBe(5);
	});

	it("makes the chains finesse, so they can use DEX", () => {
		const state = rageAndManifest(mkFury(3));
		expect(getChains(state).abilityMod).toBe("finesse");
		expect(getChains(state).properties).toEqual(expect.arrayContaining(["F", "L"]));
	});

	it("delivers rage damage to the finesse chains (the bug that made them useless)", () => {
		const state = rageAndManifest(mkFury(3));
		// Before `resolveAttackAbilityKey`, this returned 0 for every finesse weapon
		// because `abilityMod` is the symbolic string "finesse", never "str".
		expect(state.getRageDamageBonus(true, "finesse")).toBe(2);
	});

	it("offers grapple and shove as on-hit riders, and nothing that needs a later level", () => {
		const state = rageAndManifest(mkFury(3));
		const ids = (state.getFeatureCalculations().attackOnHitOptions || []).map(o => o.id);
		expect(ids).toEqual(expect.arrayContaining(["chains-grapple", "chains-shove"]));
		expect(ids).not.toContain("chains-restrain");
		expect(ids).not.toContain("chains-control-shove");
	});

	it("counts the barbarian as one size larger when grappling", () => {
		const state = mkFury(3);
		const grapple = state.getGrappleSizeCategory();
		expect(grapple.base).toBe("Medium");
		expect(grapple.effective).toBe("Large");
		expect(grapple.bonus).toBe(1);
		expect(grapple.maxTargetSize).toBe("Huge");
	});

	it("drops the chains when rage ends", () => {
		const state = rageAndManifest(mkFury(3));
		expect(getChains(state)).toBeDefined();
		state.deactivateState("rage");
		expect(state.isStateTypeActive("manifestChains")).toBe(false);
		expect(getChains(state)).toBeUndefined();
	});

	it("is NOT yet magical at L3", () => {
		const state = rageAndManifest(mkFury(3));
		expect(getChains(state).countsAsMagical).toBe(false);
	});
});

describe("Chained Fury — L6 Chain Imprisonment", () => {
	it("makes the chains count as magical", () => {
		const state = rageAndManifest(mkFury(6));
		expect(getChains(state).countsAsMagical).toBe(true);
		expect(state.getFeatureCalculations().chainsAreMagical).toBe(true);
	});

	it("scales damage and reach off the subclass table, not off L3 values", () => {
		const state = rageAndManifest(mkFury(6));
		expect(getChains(state).damage).toBe("1d10");
		expect(state.getAttackReach(getChains(state))).toBe(20);
	});

	it("adds a restrain rider carrying a real save DC of 8 + prof + CON", () => {
		const state = rageAndManifest(mkFury(6));
		const restrain = (state.getFeatureCalculations().attackOnHitOptions || []).find(o => o.id === "chains-restrain");
		expect(restrain).toBeDefined();
		// L6 -> prof +3, CON 16 -> +3.
		expect(restrain.save).toEqual({ability: "str", dc: 8 + 3 + 3});
		expect(state.getFeatureCalculations().chainRestrainDc).toBe(8 + 3 + 3);
	});

	it("ties the restrain's recurring damage to barbarian level", () => {
		const state = rageAndManifest(mkFury(6));
		const restrain = (state.getFeatureCalculations().attackOnHitOptions || []).find(o => o.id === "chains-restrain");
		expect(restrain.recurringDamage).toMatchObject({amount: 6, type: "force"});
		const l14 = rageAndManifest(mkFury(14));
		const restrain14 = (l14.getFeatureCalculations().attackOnHitOptions || []).find(o => o.id === "chains-restrain");
		expect(restrain14.recurringDamage.amount).toBe(14);
	});
});

describe("Chained Fury — L10 Chain Control", () => {
	it("raises the grapple size bonus to two categories", () => {
		const state = mkFury(10);
		const grapple = state.getGrappleSizeCategory();
		expect(grapple.bonus).toBe(2);
		expect(grapple.effective).toBe("Huge");
		expect(grapple.maxTargetSize).toBe("Gargantuan");
	});

	it("adds the 10 ft. reposition rider", () => {
		const state = rageAndManifest(mkFury(10));
		const reposition = (state.getFeatureCalculations().attackOnHitOptions || []).find(o => o.id === "chains-control-shove");
		expect(reposition).toBeDefined();
		expect(state.getFeatureCalculations().chainShoveDistance).toBe(10);
	});

	it("scales to 1d12 / 25 ft.", () => {
		const state = rageAndManifest(mkFury(10));
		expect(getChains(state).damage).toBe("1d12");
		expect(state.getAttackReach(getChains(state))).toBe(25);
	});
});

describe("Chained Fury — L14 Unchained Fury", () => {
	it("doubles the chains to four sets", () => {
		expect(mkFury(10).getFeatureCalculations().chainCount).toBe(2);
		expect(mkFury(14).getFeatureCalculations().chainCount).toBe(4);
	});

	it("grants three attacks per Attack action through the generic allowance path", () => {
		const state = mkFury(14);
		const allowance = (state.getFeatureCalculations().attackActionAllowances || [])
			.find(a => a.sourceFeature === "Manifest Chains");
		expect(allowance).toBeDefined();
		expect(allowance.count).toBe(3);
		// Gated on the chains actually being out — three swings only with chains.
		expect(allowance.requiresState).toBe("manifestChains");
		// And strictly better than the barbarian's normal Extra Attack.
		expect(allowance.count).toBeGreaterThan(state.getFeatureCalculations().attackCount);
	});

	it("removes the grapple size ceiling entirely", () => {
		const grapple = mkFury(14).getGrappleSizeCategory();
		expect(grapple.unlimited).toBe(true);
		expect(grapple.maxTargetSize).toBe("Any");
	});

	it("scales to 2d6 / 30 ft. and stops there", () => {
		const l14 = rageAndManifest(mkFury(14));
		const l20 = rageAndManifest(mkFury(20));
		expect(getChains(l14).damage).toBe("2d6");
		expect(l14.getAttackReach(getChains(l14))).toBe(30);
		expect(getChains(l20).damage).toBe("2d6");
		expect(l20.getAttackReach(getChains(l20))).toBe(30);
	});

	it("grants free movement while grappling", () => {
		expect(mkFury(14).getFeatureCalculations().chainFreeMovement).toBe(true);
		expect(mkFury(10).getFeatureCalculations().chainFreeMovement).toBeFalsy();
	});
});

describe("Chained Fury — persistence", () => {
	it("survives a save/load round-trip with the chains still manifested", () => {
		const state = rageAndManifest(mkFury(14));
		expect(getChains(state)).toBeDefined();

		const restored = new CharacterSheetState();
		restored.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));

		expect(restored.isStateTypeActive("rage")).toBe(true);
		expect(restored.isStateTypeActive("manifestChains")).toBe(true);
		const chains = getChains(restored);
		expect(chains).toBeDefined();
		expect(chains.damage).toBe("2d6");
		expect(restored.getAttackReach(chains)).toBe(30);
	});

	it("restores a non-manifested rage without conjuring chains", () => {
		const state = mkFury(14);
		state.activateState("rage");
		const restored = new CharacterSheetState();
		restored.loadFromJson(JSON.parse(JSON.stringify(state.toJson())));
		expect(restored.isStateTypeActive("rage")).toBe(true);
		expect(restored.isStateTypeActive("manifestChains")).toBe(false);
		expect(getChains(restored)).toBeUndefined();
	});
});

describe("resolveAttackAbilityKey — the generic finesse fix", () => {
	it("resolves finesse to the better of STR and DEX", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("str", 18);
		state.setAbilityBase("dex", 8);
		expect(state.resolveAttackAbilityKey("finesse")).toBe("str");
		state.setAbilityBase("dex", 20);
		expect(state.resolveAttackAbilityKey("finesse")).toBe("dex");
	});

	it("resolves finesseWis across all three", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("str", 10);
		state.setAbilityBase("dex", 12);
		state.setAbilityBase("wis", 18);
		expect(state.resolveAttackAbilityKey("finesseWis")).toBe("wis");
	});

	it("defaults blank to STR and passes concrete keys through untouched", () => {
		const state = new CharacterSheetState();
		expect(state.resolveAttackAbilityKey("")).toBe("str");
		expect(state.resolveAttackAbilityKey(null)).toBe("str");
		expect(state.resolveAttackAbilityKey("cha")).toBe("cha");
	});

	it("keeps rage damage on a finesse weapon when STR is the ability actually used", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("str", 18);
		state.setAbilityBase("dex", 12);
		state.addClass({name: "Barbarian", source: "PHB", level: 5});
		state.activateState("rage");
		// Before the fix this returned 0: `abilityUsed` is the literal string
		// "finesse", which never equalled "str", so EVERY raging barbarian with a
		// rapier, scimitar or shortsword silently lost their rage damage.
		expect(state.getRageDamageBonus(true, "finesse")).toBeGreaterThan(0);
	});

	it("still withholds rage damage when finesse resolves to DEX (RAW: Strength only)", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("str", 12);
		state.setAbilityBase("dex", 18);
		state.addClass({name: "Barbarian", source: "PHB", level: 5});
		state.activateState("rage");
		// Rage damage is "melee weapon attacks using Strength". A DEX-based finesse
		// swing is correctly excluded — the fix resolves the ability, it does not
		// blanket-grant the bonus.
		expect(state.getRageDamageBonus(true, "finesse")).toBe(0);
	});
});

describe("Subclass progression tables are read, not hardcoded", () => {
	const TABLE = {
		colLabels: ["Level", "Chains Damage", "Chains Range"],
		rows: [
			["1st", "—", "—"],
			["2nd", "—", "—"],
			["3rd", "{@damage 1d8}", "15 ft."],
			["4th", "{@damage 1d8}", "15 ft."],
			["5th", "{@damage 1d8}", "15 ft."],
			["6th", "{@damage 1d10}", "20 ft."],
		],
	};
	const subclass = {name: "Path of the Chained Fury", subclassTableGroups: [TABLE]};

	it("indexes rows by character level", () => {
		expect(CharacterSheetClassUtils.getSubclassTableDice(subclass, 3, /chains damage/i)).toBe("1d8");
		expect(CharacterSheetClassUtils.getSubclassTableDice(subclass, 6, /chains damage/i)).toBe("1d10");
		expect(CharacterSheetClassUtils.getSubclassTableNumber(subclass, 3, /chains range/i)).toBe(15);
		expect(CharacterSheetClassUtils.getSubclassTableNumber(subclass, 6, /chains range/i)).toBe(20);
	});

	it("treats a dash cell as absent rather than as a value", () => {
		expect(CharacterSheetClassUtils.getSubclassTableCell(subclass, 1, /chains damage/i)).toBeNull();
		expect(CharacterSheetClassUtils.getSubclassTableDice(subclass, 2, /chains damage/i, "fallback")).toBe("fallback");
	});

	it("matches column labels case-insensitively by substring too", () => {
		expect(CharacterSheetClassUtils.getSubclassTableDice(subclass, 3, "chains damage")).toBe("1d8");
	});

	it("returns the fallback for a lean stored subclass ref with no table", () => {
		const lean = {name: "Path of the Chained Fury", source: "TGTT"};
		expect(CharacterSheetClassUtils.getSubclassTableDice(lean, 3, /chains damage/i, "1d8")).toBe("1d8");
		expect(CharacterSheetClassUtils.getSubclassTableNumber(lean, 3, /chains range/i, 15)).toBe(15);
	});

	it("returns the fallback for an unknown column", () => {
		expect(CharacterSheetClassUtils.getSubclassTableNumber(subclass, 3, /nonexistent/i, 99)).toBe(99);
	});
});
