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
		// 10 crossbow bolts (arrow-typed sibling) — now also accepted by a quiver (#11).
		state.addItem({id: "bolts", name: "Crossbow Bolts", type: "A", bolt: true}, 10, false);
		// The quiver: declares arrow capacity (a default label, not a hard filter).
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

	it("autoPlaceAmmunitionInQuiver places ALL recognised ammo (arrows AND bolts)", () => {
		// A quiver accepts any recognised ammunition (#11): its containerCapacity
		// allowed-types are a default label, not a hard filter, so players' arrows
		// and bolts (and darts) all go in.
		const state = mkQuiverState();
		state.setItemEquipped("quiver1", true);
		const placed = state.autoPlaceAmmunitionInQuiver("quiver1");
		expect(placed).toBe(3); // two arrow stacks (mundane + +1) + bolts

		const inQuiver = state.getQuiverAmmunition("quiver1").map(a => a.id).sort();
		expect(inQuiver).toEqual(["arrows", "arrowsP1", "bolts"]);
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

// ===========================================================================
// #20 Doubleshot — S5-owned fold-in consumer in `_rollDamage`
// ===========================================================================
//
// Bug #20 (Doubleshot) is S4-owned: a pending one-shot rider grants +1 weapon
// damage die on the NEXT ranged WEAPON attack. S4 owns the pending flag, the
// rider lookup, and the one-shot consume helper `_consumePendingWeaponDamageDie`
// (returns a weapon damage-die STRING e.g. "1d8", or null/undefined). S5 owns
// the damage path, so S4 must NOT edit `_rollDamage`'s body — instead `_rollDamage`
// calls the helper and folds the die in. These tests pin the S5 side of that
// contract against a stubbed helper (S4 ships the helper's own tests):
//   (a) ranged-weapon gating  (b) crit-doubling via `isCrit`
//   (c) folded into the weapon's OWN damage-type total  (d) only when a die returns

describe("#20 Doubleshot consumer fold-in (_rollDamage)", () => {
	function mkDamageCombat ({die = null, attack} = {}) {
		const parseCalls = [];
		const captured = [];
		// Deterministic per-string damage so we can assert the folded total exactly.
		const PER = {"1d8": 5, "2d6": 7};

		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._weaponRiderEnabled = {};
		combat._selectedCunningStrikes = [];
		combat._state = {
			getAttacks: () => [attack],
			getFeatureCalculations: () => ({}),
			getActiveCombatMethodEffects: () => [],
			getWeaponAbilityMod: () => 3,
			getNamedModifiersByType: () => [],
			getItemWeaponScopedDamageContributions: () => [],
			getBonusFromStates: () => 0,
			isStateTypeActive: () => false,
			getExtraDamageFromStates: () => [],
		};
		combat._page = {
			pAnimateDamageDice: () => {},
			showDiceResult: (args) => { captured.push(args); },
		};
		// Deterministic parse that records (dice, isCrit) so we can assert crit-forwarding.
		combat._parseDamage = (dice, isCrit) => {
			parseCalls.push({dice, isCrit: !!isCrit});
			return {total: PER[dice] ?? 0, sides: 8, rolls: [PER[dice] ?? 0]};
		};
		combat._pushDiceGroup = () => {};
		combat._canApplySneakAttack = () => false;
		combat._resolveChannelRiderDamage = () => ({channelSpell: null, channelSpellRoll: null, channelSpellDamage: 0, riderMatched: false});
		combat._promptUseCombatMethod = async () => null;
		// The S4-owned helper — stubbed here to return a die (or null) on demand,
		// with a manual call counter (jest global isn't injected in this ESM setup).
		const consume = Object.assign(
			() => { consume.calls += 1; return die; },
			{calls: 0},
		);
		combat._consumePendingWeaponDamageDie = consume;
		return {combat, captured, parseCalls, consume};
	}

	const rangedBow = {id: "bow", name: "Longbow", isRanged: true, abilityMod: "dex", damage: "1d8", damageType: "piercing"};
	const meleeSword = {id: "sword", name: "Longsword", isMelee: true, abilityMod: "str", damage: "1d8", damageType: "slashing"};

	it("folds the pending die into the weapon's own damage-type total on a ranged attack", async () => {
		const {combat, captured, consume} = mkDamageCombat({die: "1d8", attack: rangedBow});
		await combat._rollDamage("bow", false);

		expect(consume.calls).toBe(1);
		expect(captured.length).toBe(1);
		// weapon 1d8=5 + dex +3 + Doubleshot 1d8=5 → 13, single (piercing) type → no typed-extras title.
		expect(captured[0].total).toBe(13);
		// dice-only `roll` display includes the extra die (5 weapon + 5 doubleshot).
		expect(captured[0].roll).toBe(10);
		expect(captured[0].subtitle).toContain("Doubleshot 2nd arrow 1d8");
		// It is itemized BEFORE the trailing weapon damage-type word (own-type fold-in).
		expect(captured[0].subtitle).toContain("(Doubleshot 2nd arrow 1d8) piercing");
	});

	it("never consumes or folds the die on a MELEE attack (ranged-weapon gating)", async () => {
		const {combat, captured, consume} = mkDamageCombat({die: "1d8", attack: meleeSword});
		await combat._rollDamage("sword", false);

		expect(consume.calls).toBe(0);
		// weapon 1d8=5 + str +3 = 8, no Doubleshot.
		expect(captured[0].total).toBe(8);
		expect(captured[0].subtitle).not.toContain("Doubleshot");
	});

	it("forwards `isCrit` to the pending die so it crit-doubles like the weapon dice", async () => {
		const {combat, parseCalls} = mkDamageCombat({die: "1d8", attack: rangedBow});
		await combat._rollDamage("bow", true);

		// The doubleshot die must be parsed with isCrit=true (the old crit path failed to double).
		const doubleshotParse = parseCalls.find(c => c.dice === "1d8" && c.isCrit === true);
		expect(doubleshotParse).toBeDefined();
		// Every parse in this crit roll carries isCrit=true (weapon + doubleshot).
		expect(parseCalls.every(c => c.isCrit === true)).toBe(true);
	});

	it("is an inert no-op on a ranged attack when the helper returns no die", async () => {
		const {combat, captured, consume} = mkDamageCombat({die: null, attack: rangedBow});
		await combat._rollDamage("bow", false);

		expect(consume.calls).toBe(1); // gating still asks the helper…
		expect(captured[0].total).toBe(8); // …but nothing is folded when it declines.
		expect(captured[0].subtitle).not.toContain("Doubleshot");
	});

	it("stays inert when the helper is absent (S4 has not shipped it yet)", async () => {
		const {combat, captured} = mkDamageCombat({die: "1d8", attack: rangedBow});
		delete combat._consumePendingWeaponDamageDie; // optional-chained call → undefined
		await combat._rollDamage("bow", false);

		expect(captured[0].total).toBe(8);
		expect(captured[0].subtitle).not.toContain("Doubleshot");
	});
});

// ===========================================================================
// #14 Weapon-upgrade damage-dice rider — S5-owned roll + attach (Saw-toothed)
// ===========================================================================
//
// Bug #14: flat weapon-upgrade attack/damage bonuses already flow; the gap is the
// non-flat DAMAGE DICE rider (e.g. Saw-toothed = +1d4 of a type on every hit). S6
// surfaces the aggregated `bonusDamageDice`/`bonusDamageType` additively in
// getEffectiveItemBonuses (EXTRACTION — S6-owned). S5 owns ROLLING it: per the
// LOCKED contract, `_rollDamage` reads those fields DIRECTLY off the attack's
// `sourceItem` (no pre-populated per-attack field, and NOT via the global
// feature-based weaponDamageRiders loop), rolling on EVERY hit, crit-doubled, under
// the upgrade's OWN damage type.

describe("#14 weapon-upgrade damage-dice rider consumer (_rollDamage)", () => {
	// `effectiveBonuses` may be a plain object (returned for ANY item id) OR a function
	// (id) => bonuses, so a test can prove per-item keying (no leak across weapons).
	// `featureCalcs` lets a test populate the GLOBAL feature weaponDamageRiders loop to
	// prove the item-upgrade path is a DISTINCT source (no double-count).
	function mkDamageCombat (attack, effectiveBonuses = null, featureCalcs = {}) {
		const captured = [];
		const PER = {"1d8": 5, "2d6": 7, "1d4": 3, "1d6": 4, "1d10": 6};
		const effFor = typeof effectiveBonuses === "function" ? effectiveBonuses : () => effectiveBonuses;
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._weaponRiderEnabled = {};
		combat._selectedCunningStrikes = [];
		combat._state = {
			getAttacks: () => [attack],
			getFeatureCalculations: () => featureCalcs,
			getActiveCombatMethodEffects: () => [],
			getWeaponAbilityMod: () => 3,
			getNamedModifiersByType: () => [],
			getItemWeaponScopedDamageContributions: () => [],
			getBonusFromStates: () => 0,
			isStateTypeActive: () => false,
			getExtraDamageFromStates: () => [],
			getEffectiveItemBonuses: (id) => effFor(id),
		};
		combat._page = {
			pAnimateDamageDice: () => {},
			showDiceResult: (args) => { captured.push(args); },
		};
		combat._parseDamage = (dice, isCrit) => ({total: PER[dice] ?? 0, sides: 8, rolls: [PER[dice] ?? 0], _isCrit: !!isCrit});
		combat._pushDiceGroup = () => {};
		combat._canApplySneakAttack = () => false;
		combat._isRiderAvailableThisTurn = () => true;
		combat._markRiderUsedThisTurn = () => {};
		combat._resolveChannelRiderDamage = () => ({channelSpell: null, channelSpellRoll: null, channelSpellDamage: 0, riderMatched: false});
		combat._promptUseCombatMethod = async () => null;
		return {combat, captured};
	}

	// The +1d4 is resolved at roll time from S6's effective-bonus fields keyed off
	// `sourceItem.id` — the weapon itself carries NO per-attack rider field.
	const SAW_EFF = {bonusDamageDice: "1d4", bonusDamageType: "slashing"};
	const sawtooth = {
		id: "saw",
		name: "Saw-toothed Longsword",
		isMelee: true,
		abilityMod: "str",
		damage: "1d8",
		damageType: "slashing",
		sourceItem: {id: "saw-item"},
	};

	it("rolls the upgrade die into the weapon's OWN damage-type total when the type matches", async () => {
		const {combat, captured} = mkDamageCombat(sawtooth, SAW_EFF);
		await combat._rollDamage("saw", false);
		// weapon 1d8=5 + str +3 + Saw-toothed 1d4=3 (same slashing type) = 11, single type.
		expect(captured[0].total).toBe(11);
		expect(captured[0].subtitle).toContain("Weapon Upgrade 1d4 slashing");
	});

	it("applies on EVERY hit with no manual toggle (auto-applied, fires twice in a row)", async () => {
		const {combat, captured} = mkDamageCombat(sawtooth, SAW_EFF);
		await combat._rollDamage("saw", false);
		await combat._rollDamage("saw", false);
		expect(captured.length).toBe(2);
		expect(captured[0].total).toBe(11);
		expect(captured[1].total).toBe(11); // still fires — never disabled like feature riders.
	});

	it("crit-doubles the upgrade die via isCrit", async () => {
		const {combat} = mkDamageCombat(sawtooth, SAW_EFF);
		let sawCrit = false;
		const realParse = combat._parseDamage;
		combat._parseDamage = (dice, isCrit) => { if (dice === "1d4" && isCrit) sawCrit = true; return realParse(dice, isCrit); };
		await combat._rollDamage("saw", true);
		expect(sawCrit).toBe(true);
	});

	it("reports a DIFFERENTLY-typed upgrade die under its own type (not the weapon's)", async () => {
		const fireBlade = {
			id: "fb",
			name: "Flaming Longsword",
			isMelee: true,
			abilityMod: "str",
			damage: "1d8",
			damageType: "slashing",
			sourceItem: {id: "fb-item"},
		};
		const {combat, captured} = mkDamageCombat(fireBlade, {bonusDamageDice: "1d6", bonusDamageType: "fire"});
		await combat._rollDamage("fb", false);
		// 1d8=5 + str 3 = 8 slashing; 1d6=4 fire reported separately → typed-extras title.
		expect(captured[0].total).toContain("8 slashing + 4 fire = 12");
		expect(captured[0].subtitle).toContain("Weapon Upgrade 1d6 fire");
	});

	it("is inert when the weapon carries no upgrade dice rider", async () => {
		const plain = {id: "p", name: "Longsword", isMelee: true, abilityMod: "str", damage: "1d8", damageType: "slashing"};
		const {combat, captured} = mkDamageCombat(plain);
		await combat._rollDamage("p", false);
		expect(captured[0].total).toBe(8);
		expect(captured[0].subtitle).not.toContain("Upgrade");
	});

	it("is inert when the sourceItem has flat bonuses but no bonusDamageDice", async () => {
		const attack = {id: "flat", name: "Longsword", isMelee: true, abilityMod: "str", damage: "1d8", damageType: "slashing", sourceItem: {id: "wflat"}};
		const {combat, captured} = mkDamageCombat(attack, {bonusWeaponDamage: 1}); // flat only
		await combat._rollDamage("flat", false);
		// +1 flat is handled by the bonus path, not the dice rider; no extra die rolled.
		expect(captured[0].subtitle).not.toContain("Upgrade");
	});

	// --- S6's recommended DIRECT read: the +1d4 is read from getEffectiveItemBonuses
	// keyed off the attack's sourceItem at roll time. ---
	it("derives the rider from getEffectiveItemBonuses when the weapon has a sourceItem (S6 path a)", async () => {
		const attack = {id: "raw", name: "Saw-toothed Longsword", isMelee: true, abilityMod: "str", damage: "1d8", damageType: "slashing", sourceItem: {id: "w9"}};
		const {combat, captured} = mkDamageCombat(attack, {bonusDamageDice: "1d4", bonusDamageType: "slashing"});
		await combat._rollDamage("raw", false);
		// 1d8=5 + str 3 + derived 1d4=3 (slashing) = 11.
		expect(captured[0].total).toBe(11);
		expect(captured[0].subtitle).toContain("Weapon Upgrade 1d4 slashing");
	});

	it("uses the upgrade's OWN type from getEffectiveItemBonuses, not the weapon's (path a)", async () => {
		const attack = {id: "raw2", name: "Flametongue", isMelee: true, abilityMod: "str", damage: "1d8", damageType: "slashing", sourceItem: {id: "w10"}};
		const {combat, captured} = mkDamageCombat(attack, {bonusDamageDice: "1d6", bonusDamageType: "fire"});
		await combat._rollDamage("raw2", false);
		expect(captured[0].total).toContain("8 slashing + 4 fire = 12");
		expect(captured[0].subtitle).toContain("Weapon Upgrade 1d6 fire");
	});

	it("rolls the upgrade die exactly ONCE per hit (no double-count)", async () => {
		const attack = {id: "once", name: "Saw-toothed", isMelee: true, abilityMod: "str", damage: "1d8", damageType: "slashing", sourceItem: {id: "w11"}};
		const {combat, captured} = mkDamageCombat(attack, {bonusDamageDice: "1d4", bonusDamageType: "slashing"});
		await combat._rollDamage("once", false);
		// 5 + 3 + ONE 1d4=3 = 11 (NOT 14 from double-counting).
		expect(captured[0].total).toBe(11);
	});

	it("falls back to the weapon's own type when the upgrade omits a type (path a)", async () => {
		const attack = {id: "raw3", name: "Longsword", isMelee: true, abilityMod: "str", damage: "1d8", damageType: "slashing", sourceItem: {id: "w12"}};
		const {combat, captured} = mkDamageCombat(attack, {bonusDamageDice: "1d4"}); // no bonusDamageType
		await combat._rollDamage("raw3", false);
		// Same slashing type → folds into the single-type total: 5 + 3 + 3 = 11.
		expect(captured[0].total).toBe(11);
		expect(captured[0].subtitle).toContain("Weapon Upgrade 1d4 slashing");
	});

	// --- Orchestrator's three explicit guarantees (S6 leak warning) ---

	// (1) NO LEAK ACROSS WEAPONS: getEffectiveItemBonuses is keyed by sourceItem.id, so a
	// DIFFERENT equipped weapon WITHOUT a dice-granting upgrade gets nothing — even though
	// the very same resolver returns a die for the upgraded weapon's id.
	it("does NOT leak across weapons — a non-upgraded weapon adds 0 bonus dice (per-item keyed)", async () => {
		const byId = (id) => (id === "saw-item" ? {bonusDamageDice: "1d4", bonusDamageType: "slashing"} : null);
		const plain = {id: "plain", name: "Plain Longsword", isMelee: true, abilityMod: "str", damage: "1d8", damageType: "slashing", sourceItem: {id: "plain-item"}};
		const {combat, captured} = mkDamageCombat(plain, byId);
		await combat._rollDamage("plain", false);
		expect(captured[0].total).toBe(8); // 5 + str 3, NO +1d4 from the other item's upgrade
		expect(captured[0].subtitle).not.toContain("Upgrade");
	});

	// (2) NO DOUBLE-COUNT / DISTINCT SOURCES: the item-upgrade die rides ONLY the
	// getEffectiveItemBonuses path; an unrelated ENABLED feature rider in the global
	// getFeatureCalculations().weaponDamageRiders loop applies independently. Both fire
	// exactly ONCE — the upgrade die is never also pulled through the feature loop.
	it("rides ONLY the item path, never the global feature loop — additive, each source once", async () => {
		const featureCalcs = {weaponDamageRiders: [{id: "colossus", name: "Colossus Slayer", dice: "1d6", damageType: "slashing", perTurn: false}]};
		const atk = {id: "saw2", name: "Saw-toothed Longsword", isMelee: true, abilityMod: "str", damage: "1d8", damageType: "slashing", sourceItem: {id: "saw-item"}};
		const {combat, captured} = mkDamageCombat(atk, {bonusDamageDice: "1d4", bonusDamageType: "slashing"}, featureCalcs);
		combat._weaponRiderEnabled = {colossus: true}; // enable the feature rider
		await combat._rollDamage("saw2", false);
		// 5 (1d8) + str 3 + item 1d4=3 + feature 1d6=4 = 15, all slashing → single type.
		expect(captured[0].total).toBe(15);
		const sub = captured[0].subtitle;
		expect((sub.match(/Colossus Slayer/g) || []).length).toBe(1); // feature once
		expect((sub.match(/Weapon Upgrade/g) || []).length).toBe(1); // item upgrade once (no double)
	});

	// (3) SCOPING: the upgrade rider is gated by `!attack.isSpell`, so it never bleeds
	// onto spell attacks even if a stray sourceItem is attached.
	it("does NOT ride spell attacks (gated by !isSpell)", async () => {
		const spellAtk = {id: "sp", name: "Booming Blade", isSpell: true, abilityMod: "int", damage: "1d8", damageType: "thunder", sourceItem: {id: "saw-item"}};
		const {combat, captured} = mkDamageCombat(spellAtk, {bonusDamageDice: "1d4", bonusDamageType: "slashing"});
		await combat._rollDamage("sp", false);
		expect((captured[0].subtitle || "")).not.toContain("Upgrade");
	});
});

describe("#14 auto-attack builder keeps sourceItem for the direct getEffectiveItemBonuses read", () => {
	const weapon = {id: "w1", name: "Saw-toothed Longsword", weapon: true, equipped: true, dmg1: "1d8", damageType: "slashing", property: []};

	function mkBuilderCombat (effectiveBonuses) {
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._battleTacticToggles = {};
		combat._state = {
			getAttacks: () => [],
			getItems: () => [weapon],
			isMonkWeapon: () => false,
			getEffectiveItemBonuses: () => effectiveBonuses,
			getFeatureCalculations: () => ({}),
			getTemporaryAttacks: () => [],
			getActiveStateAttacks: () => [],
			getMeleeReach: () => 5,
			getReachBonus: () => 0,
		};
		combat._page = {};
		combat._renderAttackItem = () => ({}); // skip heavy DOM rendering
		return combat;
	}

	let savedDoc;
	beforeAll(() => {
		savedDoc = globalThis.document;
		const fakeContainer = {innerHTML: "", append: () => {}};
		globalThis.document = {getElementById: () => fakeContainer};
	});
	afterAll(() => { globalThis.document = savedDoc; });

	it("attaches the weapon as sourceItem (with id) so _rollDamage can read getEffectiveItemBonuses directly", () => {
		const combat = mkBuilderCombat({bonusDamageDice: "1d4", bonusDamageType: "slashing"});
		combat.renderAttacks();
		const auto = combat._cachedAttacks.find(a => a.id === "auto_w1");
		expect(auto).toBeDefined();
		expect(auto.sourceItem).toBe(weapon);
		expect(auto.sourceItem.id).toBe("w1");
	});

	it("does NOT pre-populate a per-attack weaponDamageRiders field (riders resolved at roll time)", () => {
		const combat = mkBuilderCombat({bonusDamageDice: "1d4", bonusDamageType: "slashing"});
		combat.renderAttacks();
		const auto = combat._cachedAttacks.find(a => a.id === "auto_w1");
		// The locked #14 path reads getEffectiveItemBonuses(sourceItem.id) at roll time;
		// nothing is smuggled onto the attack at build time.
		expect(auto.weaponDamageRiders).toBeUndefined();
	});
});
