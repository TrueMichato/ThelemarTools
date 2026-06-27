/**
 * S5 — Attack/damage pipeline, battle-tactic combat effects & quiver.
 *
 * Asserts REAL mechanics for the four bugs owned by session S5:
 *
 *  #12 Archery / ranged-vs-melee attack-modifier scoping + itemized breakdown.
 *      `getAttackModifierContributions({isMelee})` must return Archery's +2 for a
 *      RANGED roll and NOT for a melee one, while a category-level `attack` bonus
 *      reaches both — and each source is itemized (name + value) for the toast.
 *
 *  #11 High Ground (and other conditional battle-tactic) attack toggles.
 *      `_getCombatLocalAttackBonus` must add a tactic's +2 ONLY when its toggle is
 *      on AND the attack matches its scope (High Ground = ranged-only; melee tactics
 *      = melee-only). Off by default.
 *
 *  #13 Life Stealing nat-20 weapon rider. `getCritWeaponRiders` detects "… of Life
 *      Stealing" weapons (edition-aware +10/+15 necrotic, temp HP = damage) and
 *      honors structured `critRiders`; `_applyCritWeaponRider` grants temp HP with
 *      take-higher semantics.
 *
 *  #16 Quiver. Equipping a quiver auto-places compatible loose ammo (respecting the
 *      quiver's allowed types and never poaching ammo already in another container);
 *      `getQuiverAmmunition[ForWeapon]` surface it; a ranged attack offers the quiver
 *      picker (hook predicate) and a shot consumes exactly one round.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkCombat (stateStub = {}) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._flankingEnabled = false;
	combat._battleTacticToggles = {};
	combat._state = stateStub;
	combat._page = {
		saveCharacter: () => {},
		renderCharacter: () => {},
		showDiceResult: () => {},
	};
	return combat;
}

const RANGED_ATTACK = {name: "Longbow", isRanged: true, range: "150/600"};
const MELEE_ATTACK = {name: "Longsword", isMelee: true, type: "melee", range: "melee"};

// ===========================================================================
// #12 — Archery / ranged-vs-melee attack-modifier scoping + itemization
// ===========================================================================

describe("#12 Archery attack-modifier scoping (getAttackModifierContributions)", () => {
	function mkState () {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		return state;
	}

	it("Archery (+2, attack:ranged) reaches RANGED attacks only", () => {
		const state = mkState();
		state.addNamedModifier({name: "Archery", type: "attack:ranged", value: 2});

		const ranged = state.getAttackModifierContributions({isMelee: false});
		const melee = state.getAttackModifierContributions({isMelee: true});

		expect(ranged).toEqual([{name: "Archery", value: 2}]);
		// THE BUG: Archery must NOT buff melee/unarmed attacks.
		expect(melee.find(c => c.name === "Archery")).toBeUndefined();
		expect(melee).toEqual([]);
	});

	it("a category-level `attack` bonus reaches BOTH melee and ranged", () => {
		const state = mkState();
		state.addNamedModifier({name: "Bless", type: "attack", value: 1});

		const ranged = state.getAttackModifierContributions({isMelee: false});
		const melee = state.getAttackModifierContributions({isMelee: true});

		expect(ranged).toContainEqual({name: "Bless", value: 1});
		expect(melee).toContainEqual({name: "Bless", value: 1});
	});

	it("a melee-scoped bonus (Dueling, attack:melee) reaches MELEE only", () => {
		const state = mkState();
		state.addNamedModifier({name: "Dueling", type: "attack:melee", value: 2});

		const ranged = state.getAttackModifierContributions({isMelee: false});
		const melee = state.getAttackModifierContributions({isMelee: true});

		expect(melee).toContainEqual({name: "Dueling", value: 2});
		expect(ranged.find(c => c.name === "Dueling")).toBeUndefined();
	});

	it("itemizes EACH source separately (breakdown, not a lumped sum)", () => {
		const state = mkState();
		state.addNamedModifier({name: "Archery", type: "attack:ranged", value: 2});
		state.addNamedModifier({name: "Bless", type: "attack", value: 1});

		const ranged = state.getAttackModifierContributions({isMelee: false});
		expect(ranged).toContainEqual({name: "Archery", value: 2});
		expect(ranged).toContainEqual({name: "Bless", value: 1});
		// Two discrete line items, not a single "+3".
		expect(ranged.length).toBe(2);
	});

	it("excludes conditional (opt-in) attack modifiers", () => {
		const state = mkState();
		state.addNamedModifier({name: "Situational", type: "attack:ranged", value: 5, conditional: "when prone"});

		const ranged = state.getAttackModifierContributions({isMelee: false});
		expect(ranged.find(c => c.name === "Situational")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// #12 INTEGRATION — exercise the REAL `_rollAttack` pipeline (not just the
// helper) so a regression of the old `getNamedModifiersByType("attack")` path
// would be caught. Uses a real CharacterSheetState + a stubbed `_page` that
// captures the dice-toast args.
// ---------------------------------------------------------------------------

describe("#12 _rollAttack pipeline: Archery reaches ranged rolls only, itemized", () => {
	function mkPipelineCombat () {
		const state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAbilityBase("dex", 16); // +3
		state.setAbilityBase("str", 16); // +3
		state.addNamedModifier({name: "Archery", type: "attack:ranged", value: 2});

		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._battleTacticToggles = {};
		combat._flankingEnabled = false;
		combat._state = state;

		const captured = [];
		combat._page = {
			rollD20: () => ({roll: 10, mode: "normal"}),
			getModeLabel: () => "",
			formatD20Breakdown: () => "",
			pAnimateD20: () => {},
			showDiceResult: (args) => { captured.push(args); return null; },
			getModifierString: (n) => `${n >= 0 ? "+" : ""}${n}`,
			_offerGuidedStrikePostAttack: () => {},
			saveCharacter: () => {},
		};
		// Stub the post-roll side effects that touch DOM / unrelated subsystems.
		combat._renderSneakAttackToggle = () => {};
		combat._isSneakAttackAvailableThisTurn = () => false;
		combat._runPostAttackHooks = async () => {};
		combat._consumeOnAttackStates = () => {};
		combat._clearPendingSpellRider = () => {};
		return {state, combat, captured};
	}

	it("a RANGED weapon attack includes Archery +2 and itemizes it in the toast", () => {
		const {state, combat, captured} = mkPipelineCombat();
		state.addAttack({id: "bowAtk", name: "Longbow", isRanged: true, abilityMod: "dex", range: "150/600", damage: "1d8"});

		combat._rollAttack("bowAtk", null);

		expect(captured.length).toBe(1);
		// dex +3, prof +3 (Fighter 5), Archery +2 → modifier 8.
		expect(captured[0].modifier).toBe(8);
		expect(captured[0].title).toContain("Archery +2");
	});

	it("a MELEE weapon attack does NOT include Archery and does not name it", () => {
		const {state, combat, captured} = mkPipelineCombat();
		state.addAttack({id: "swordAtk", name: "Longsword", isMelee: true, type: "melee", abilityMod: "str", range: "melee", damage: "1d8"});

		combat._rollAttack("swordAtk", null);

		expect(captured.length).toBe(1);
		// str +3, prof +3, NO Archery → modifier 6 (would wrongly be 8 with the bug).
		expect(captured[0].modifier).toBe(6);
		expect(captured[0].title).not.toContain("Archery");
	});
});

// ===========================================================================
// #11 — High Ground (conditional battle-tactic) attack toggle
// ===========================================================================

describe("#11 High Ground battle-tactic toggle (_getCombatLocalAttackBonus)", () => {
	function mkStateStub (tacticMods) {
		return {getConditionalAttackModifiers: () => tacticMods};
	}

	const HIGH_GROUND = {value: 2, source: "High Ground", attackType: "ranged", condition: "from higher ground"};
	const SWEEPING = {value: 2, source: "Sweeping Blows", attackType: "melee", condition: "vs adjacent foes"};

	it("is OFF by default (no bonus even on a ranged attack)", () => {
		const combat = mkCombat(mkStateStub([HIGH_GROUND]));
		const res = combat._getCombatLocalAttackBonus({attack: RANGED_ATTACK});
		expect(res.bonus).toBe(0);
		expect(res.parts.find(p => p.label === "High Ground")).toBeUndefined();
	});

	it("toggled ON adds +2 to a RANGED attack", () => {
		const combat = mkCombat(mkStateStub([HIGH_GROUND]));
		combat._battleTacticToggles["High Ground"] = true;
		const res = combat._getCombatLocalAttackBonus({attack: RANGED_ATTACK});
		expect(res.bonus).toBe(2);
		expect(res.parts).toContainEqual({label: "High Ground", value: 2});
	});

	it("toggled ON does NOT affect a MELEE attack (ranged-only scope)", () => {
		const combat = mkCombat(mkStateStub([HIGH_GROUND]));
		combat._battleTacticToggles["High Ground"] = true;
		const res = combat._getCombatLocalAttackBonus({attack: MELEE_ATTACK});
		expect(res.bonus).toBe(0);
		expect(res.parts.find(p => p.label === "High Ground")).toBeUndefined();
	});

	it("a melee tactic applies to melee only, never ranged", () => {
		const combat = mkCombat(mkStateStub([SWEEPING]));
		combat._battleTacticToggles["Sweeping Blows"] = true;

		const melee = combat._getCombatLocalAttackBonus({attack: MELEE_ATTACK});
		const ranged = combat._getCombatLocalAttackBonus({attack: RANGED_ATTACK});

		expect(melee.bonus).toBe(2);
		expect(ranged.bonus).toBe(0);
	});

	it("the production constructor initializes the toggle map empty (off by default)", () => {
		// Shim the DOM the constructor's `_initEventListeners` touches (the node test
		// env has no jsdom), so we can verify the REAL constructor default — not a
		// hand-set `{}` in a test helper.
		const hadDoc = typeof globalThis.document !== "undefined";
		if (!hadDoc) {
			globalThis.document = /** @type {*} */ ({addEventListener: () => {}, getElementById: () => null});
		}
		try {
			const inst = new CharacterSheetCombat({getState: () => ({})});
			expect(inst._battleTacticToggles).toEqual({});
			expect(inst._flankingEnabled).toBe(false);
		} finally {
			if (!hadDoc) delete globalThis.document;
		}
	});
});

// ===========================================================================
// #13 — Life Stealing nat-20 weapon rider
// ===========================================================================

describe("#13 Life Stealing crit weapon rider (getCritWeaponRiders)", () => {
	const state = new CharacterSheetState();

	it("detects a classic Rapier of Life Stealing: +10 necrotic, temp HP = damage, nat20", () => {
		const riders = state.getCritWeaponRiders({
			name: "Rapier of Life Stealing",
			sourceItem: {name: "Rapier of Life Stealing", source: "DMG"},
		});
		expect(riders.length).toBe(1);
		const r = riders[0];
		expect(r.trigger).toBe("nat20");
		expect(r.damageAmount).toBe(10);
		expect(r.damageType).toBe("necrotic");
		expect(r.tempHp).toBe("damage");
		expect(r.excludesTypes).toEqual(expect.arrayContaining(["construct", "undead"]));
	});

	it("detects a modern (XDMG) Life Stealing weapon: +15 necrotic", () => {
		const riders = state.getCritWeaponRiders({
			name: "Sword of Life Stealing",
			sourceItem: {name: "Sword of Life Stealing", source: "XDMG"},
		});
		expect(riders.length).toBe(1);
		expect(riders[0].damageAmount).toBe(15);
	});

	it("honors a structured critRiders array on the item", () => {
		const riders = state.getCritWeaponRiders({
			name: "Homebrew Smiter",
			sourceItem: {
				name: "Homebrew Smiter",
				critRiders: [{trigger: "crit", name: "Smite", damageDice: "2d8", damageType: "radiant"}],
			},
		});
		expect(riders.length).toBe(1);
		expect(riders[0].trigger).toBe("crit");
		expect(riders[0].damageDice).toBe("2d8");
		expect(riders[0].damageType).toBe("radiant");
	});

	it("returns NO riders for an ordinary weapon", () => {
		const riders = state.getCritWeaponRiders({name: "Longbow", sourceItem: {name: "Longbow", source: "PHB"}});
		expect(riders).toEqual([]);
	});

	it("returns NO riders for a spell attack", () => {
		const riders = state.getCritWeaponRiders({name: "Fire Bolt", isSpell: true});
		expect(riders).toEqual([]);
	});
});

describe("#13 Life Stealing application (_applyCritWeaponRider)", () => {
	function mkCritCombat (initialTemp = 0) {
		let temp = initialTemp;
		const combat = mkCombat({
			getTempHp: () => temp,
			setTempHp: (n) => { temp = n; },
		});
		combat._parseDamage = (str) => ({total: 0, rolls: []});
		return {combat, getTemp: () => combat._state.getTempHp()};
	}

	it("a flat-amount rider deals the necrotic and grants take-higher temp HP", () => {
		const {combat, getTemp} = mkCritCombat(0);
		const out = combat._applyCritWeaponRider(RANGED_ATTACK, {
			name: "Rapier of Life Stealing",
			trigger: "nat20",
			damageAmount: 10,
			damageType: "necrotic",
			tempHp: "damage",
		});
		expect(out.damage).toBe(10);
		expect(out.damageType).toBe("necrotic");
		expect(out.tempHpGranted).toBe(10);
		expect(getTemp()).toBe(10);
	});

	it("temp HP is take-higher — never reduces existing temp HP", () => {
		const {combat, getTemp} = mkCritCombat(15);
		const out = combat._applyCritWeaponRider(RANGED_ATTACK, {
			name: "Rapier of Life Stealing",
			trigger: "nat20",
			damageAmount: 10,
			damageType: "necrotic",
			tempHp: "damage",
		});
		expect(out.tempHpGranted).toBe(10);
		// Existing 15 temp HP stays — never clobbered down to 10.
		expect(getTemp()).toBe(15);
	});
});

describe("#13 nat-20 vs non-nat-20 firing (post-attack hook)", () => {
	it("the crit-rider hook predicate fires on nat20 with a Life Stealing weapon, not otherwise", () => {
		const combat = mkCombat({
			getCritWeaponRiders: (attack) => attack?.sourceItem?.name === "Rapier of Life Stealing"
				? [{trigger: "nat20", name: "Rapier of Life Stealing", damageAmount: 10}]
				: [],
		});
		const hook = combat._getPostAttackHooks().find(h => h.id === "critWeaponRider");
		expect(hook).toBeDefined();

		const lifeSteal = {name: "Rapier of Life Stealing", sourceItem: {name: "Rapier of Life Stealing"}};
		// nat20 → fires
		expect(hook.predicate({isNat20: true, isCrit: true, attack: lifeSteal})).toBe(true);
		// non-nat20 (ordinary hit) → does NOT fire
		expect(hook.predicate({isNat20: false, isCrit: false, attack: lifeSteal})).toBe(false);
		// EXPANDED crit (Champion 19–20) that is NOT a natural 20 → does NOT fire a
		// nat20-trigger rider. This is the explicit nat20-vs-crit distinction.
		expect(hook.predicate({isNat20: false, isCrit: true, attack: lifeSteal})).toBe(false);
		// nat20 but plain weapon → no rider → does NOT fire
		expect(hook.predicate({isNat20: true, isCrit: true, attack: {name: "Longbow", sourceItem: {name: "Longbow"}}})).toBe(false);
	});

	it("a `trigger:\"crit\"` rider DOES fire on an expanded crit (not just nat20)", () => {
		const combat = mkCombat({
			getCritWeaponRiders: () => [{trigger: "crit", name: "Smite", damageDice: "2d8"}],
		});
		const hook = combat._getPostAttackHooks().find(h => h.id === "critWeaponRider");
		const atk = {name: "Greatsword", sourceItem: {name: "Greatsword"}};
		// Expanded crit (isCrit true, isNat20 false) → crit-trigger rider fires.
		expect(hook.predicate({isNat20: false, isCrit: true, attack: atk})).toBe(true);
		// Ordinary hit → does not fire.
		expect(hook.predicate({isNat20: false, isCrit: false, attack: atk})).toBe(false);
	});
});

// ===========================================================================
// #16 — Quiver
// ===========================================================================

describe("#16 Quiver auto-place + retrieval (state)", () => {
	function mkQuiverState () {
		const state = new CharacterSheetState();
		state.setSetting("ammunitionTracking", true);

		// A longbow (uses arrows).
		state.addItem({id: "bow1", name: "Longbow", type: "R", ammoType: "arrow|phb"}, 1, true);
		// 20 mundane arrows + 5 +1 arrows (both arrow-typed), loose in inventory.
		state.addItem({id: "arrows", name: "Arrows", type: "A", arrow: true}, 20, false);
		state.addItem({id: "arrowsP1", name: "+1 Arrows", type: "A", arrow: true, bonusWeapon: "+1"}, 5, false);
		// 10 crossbow bolts (NOT arrow-typed) — must NOT go in an arrow-only quiver.
		state.addItem({id: "bolts", name: "Crossbow Bolts", type: "A", bolt: true}, 10, false);
		// The quiver: arrow-only capacity.
		state.addItem({
			id: "quiver1",
			name: "Quiver",
			type: "G",
			containerCapacity: {item: [{"arrow|phb": 20}]},
		}, 1, false);
		return state;
	}

	it("getEquippedQuiver returns the equipped quiver", () => {
		const state = mkQuiverState();
		expect(state.getEquippedQuiver()).toBeNull();
		state.setItemEquipped("quiver1", true);
		const q = state.getEquippedQuiver();
		expect(q?.id).toBe("quiver1");
	});

	it("autoPlaceAmmunitionInQuiver places arrows but NOT bolts (type-restricted)", () => {
		const state = mkQuiverState();
		state.setItemEquipped("quiver1", true);
		const placed = state.autoPlaceAmmunitionInQuiver("quiver1");
		expect(placed).toBe(2); // two arrow stacks (mundane + +1), bolts excluded

		const inQuiver = state.getQuiverAmmunition("quiver1").map(a => a.id).sort();
		expect(inQuiver).toEqual(["arrows", "arrowsP1"]);
		expect(inQuiver).not.toContain("bolts");
	});

	it("does not poach ammo already inside another container", () => {
		const state = mkQuiverState();
		// Put the +1 arrows in a different container first.
		state.addItem({
			id: "pouch",
			name: "Component Pouch",
			type: "G",
			containerCapacity: {weight: [6]},
			containedItems: ["arrowsP1"],
		}, 1, false);
		state.setItemEquipped("quiver1", true);
		state.autoPlaceAmmunitionInQuiver("quiver1");

		const inQuiver = state.getQuiverAmmunition("quiver1").map(a => a.id);
		expect(inQuiver).toContain("arrows");
		expect(inQuiver).not.toContain("arrowsP1"); // stayed in the pouch
		// And it really is still in the pouch, not orphaned.
		expect(state.getItemContainer("arrowsP1")?.id).toBe("pouch");
	});

	it("getQuiverAmmunitionForWeapon returns in-quiver arrows compatible with the bow", () => {
		const state = mkQuiverState();
		state.setItemEquipped("quiver1", true);
		state.autoPlaceAmmunitionInQuiver("quiver1");

		const forBow = state.getQuiverAmmunitionForWeapon("bow1").map(a => a.id).sort();
		expect(forBow).toEqual(["arrows", "arrowsP1"]);
	});

	it("a quiver stack with zero quantity is not offered for a weapon", () => {
		const state = mkQuiverState();
		state.setItemEquipped("quiver1", true);
		state.autoPlaceAmmunitionInQuiver("quiver1");
		state.setItemQuantity("arrowsP1", 0);

		const forBow = state.getQuiverAmmunitionForWeapon("bow1").map(a => a.id);
		expect(forBow).toContain("arrows");
		expect(forBow).not.toContain("arrowsP1");
	});

	it("a ranged shot consumes EXACTLY one round from the quiver", () => {
		const state = mkQuiverState();
		state.setItemEquipped("quiver1", true);
		state.autoPlaceAmmunitionInQuiver("quiver1");

		const before = state.getItems().find(i => i.id === "arrows").quantity;
		expect(state.consumeAmmunition("arrows", 1)).toBe(true);
		const after = state.getItems().find(i => i.id === "arrows").quantity;
		expect(after).toBe(before - 1);
	});

	it("_rollAttack DEFERS consumption to the quiver picker (no inline double-consume)", () => {
		const state = mkQuiverState();
		state.setItemEquipped("quiver1", true);
		state.autoPlaceAmmunitionInQuiver("quiver1");
		state.addClass({name: "Fighter", source: "PHB", level: 5});
		state.setAbilityBase("dex", 16);
		state.addAttack({
			id: "bowAtk",
			name: "Longbow",
			isRanged: true,
			abilityMod: "dex",
			range: "150/600",
			damage: "1d8",
			sourceItem: {id: "bow1", ammoType: "arrow|phb"},
		});

		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._battleTacticToggles = {};
		combat._flankingEnabled = false;
		combat._state = state;
		combat._page = {
			rollD20: () => ({roll: 10, mode: "normal"}),
			getModeLabel: () => "",
			formatD20Breakdown: () => "",
			pAnimateD20: () => {},
			showDiceResult: () => null,
			getModifierString: (n) => `${n}`,
			_offerGuidedStrikePostAttack: () => {},
			saveCharacter: () => {},
		};
		combat._renderSneakAttackToggle = () => {};
		combat._isSneakAttackAvailableThisTurn = () => false;
		combat._runPostAttackHooks = async () => {}; // picker would run here
		combat._consumeOnAttackStates = () => {};
		combat._clearPendingSpellRider = () => {};

		const before = state.getItems().find(i => i.id === "arrows").quantity;
		combat._rollAttack("bowAtk", null);
		const after = state.getItems().find(i => i.id === "arrows").quantity;
		// The synchronous roll must NOT consume from loose inventory — the post-attack
		// quiver picker owns consumption, so ammo is spent exactly once (not twice).
		expect(after).toBe(before);
	});
});

describe("#16 Quiver post-attack picker hook (combat)", () => {
	function mkQuiverCombat (quiverAmmoForWeapon) {
		return mkCombat({
			isAmmunitionTrackingEnabled: () => true,
			getQuiverAmmunitionForWeapon: () => quiverAmmoForWeapon,
		});
	}

	const bow = {name: "Longbow", isRanged: true, sourceItem: {id: "bow1", ammoType: "arrow|phb"}};

	it("offers the quiver picker on a ranged attack when the quiver holds compatible ammo", () => {
		const combat = mkQuiverCombat([{id: "arrows", name: "Arrows", quantity: 20}]);
		const hook = combat._getPostAttackHooks().find(h => h.id === "quiver");
		expect(hook).toBeDefined();
		expect(hook.predicate({isRanged: true, attack: bow})).toBe(true);
	});

	it("does NOT offer the picker on a melee attack", () => {
		const combat = mkQuiverCombat([{id: "arrows", name: "Arrows", quantity: 20}]);
		const hook = combat._getPostAttackHooks().find(h => h.id === "quiver");
		expect(hook.predicate({isRanged: false, attack: MELEE_ATTACK})).toBe(false);
	});

	it("does NOT offer the picker when the quiver has no compatible ammo", () => {
		const combat = mkQuiverCombat([]);
		const hook = combat._getPostAttackHooks().find(h => h.id === "quiver");
		expect(hook.predicate({isRanged: true, attack: bow})).toBe(false);
	});
});
