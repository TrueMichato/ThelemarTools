/**
 * Quiver mechanic (#11 / #16) — dedicated regression coverage.
 *
 * The quiver mechanic was implemented by session S5 and is exercised indirectly
 * inside CharacterSheetS5AttackPipeline.test.js. This file pins the THREE
 * user-facing behaviours from the #11 report explicitly, so any regression of
 * the original complaints fails loudly and in isolation:
 *
 *   (a) EQUIP-TIME BACKFILL — arrows/darts ALREADY loose in inventory are pulled
 *       into the quiver the moment it is equipped (the "doesn't take arrows in"
 *       complaint). Driven through the inventory module's `_toggleEquipped`, the
 *       real equip path, not just the state helper. Type-restriction and
 *       no-poach-from-another-container are pinned too.
 *
 *   (b) COMBAT-TAB VISIBILITY — `renderCombatQuiver` un-hides the dedicated
 *       combat-tab section (`#charsheet-combat-quiver-section`) ONLY when a quiver
 *       is equipped, and hides it otherwise (the "in overview / not showing in
 *       combat" complaint). There is no overview quiver any more.
 *
 *   (c) NON-BLOCKING, RANGED-ONLY PICKER — the post-attack quiver hook fires for a
 *       ranged weapon attack and NOT for melee/spell; consumption happens exactly
 *       once and is additive (registered alongside Arcane Shot / crit riders, and
 *       deferred out of the synchronous roll so it never double-spends or gates
 *       the resolved attack).
 *
 *   (d) SAVE/LOAD round-trips the quiver's contents; a legacy save without
 *       `containedItems` loads without error.
 *
 * Plus a small hardening assertion: ranged detection flows from the shared
 * `_getAttackRollKind` / `_isMeleeWeaponAttack` helpers (consistent with the
 * Doubleshot gate), NOT a standalone flag.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

/**
 * Longbow (uses arrows) + 20 mundane arrows + 5 "+1" arrows + 10 crossbow bolts
 * (NOT arrow-typed) all loose in inventory, and an arrow-only Quiver.
 * @param {{equipQuiver?: boolean}} [opts]
 */
function mkQuiverState ({equipQuiver = false} = {}) {
	const state = new CharacterSheetState();
	state.setSetting("ammunitionTracking", true);
	state.addItem({id: "bow1", name: "Longbow", type: "R", ammoType: "arrow|phb"}, 1, true);
	state.addItem({id: "arrows", name: "Arrows", type: "A", arrow: true}, 20, false);
	state.addItem({id: "arrowsP1", name: "+1 Arrows", type: "A", arrow: true, bonusWeapon: "+1"}, 5, false);
	state.addItem({id: "bolts", name: "Crossbow Bolts", type: "A", bolt: true}, 10, false);
	state.addItem({
		id: "quiver1",
		name: "Quiver",
		type: "G",
		containerCapacity: {item: [{"arrow|phb": 20}]},
	}, 1, equipQuiver);
	return state;
}

/** Minimal inventory module wired to a state, with all render side-effects stubbed. */
function mkInventory (state) {
	const inv = Object.create(CharacterSheetInventory.prototype);
	inv._state = state;
	inv._page = {saveCharacter: () => {}};
	inv._renderItemList = () => {};
	inv._renderEquippedItems = () => {};
	inv._updateArmorClass = () => {};
	inv._updateEncumbrance = () => {};
	return inv;
}

/** Minimal combat module wired to a state stub. */
function mkCombat (stateStub) {
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._battleTacticToggles = {};
	combat._flankingEnabled = false;
	combat._state = stateStub;
	combat._page = {saveCharacter: () => {}};
	return combat;
}

/** Read a container's `containedItems` ids (defensive copy). */
function getContained (state, containerId) {
	const wrap = state._data.inventory.find(i => i.id === containerId);
	return (wrap?.item?.containedItems || []).slice();
}

// ===========================================================================
// (a) EQUIP-TIME BACKFILL — the "doesn't take arrows in" complaint
// ===========================================================================

describe("Quiver — equip-time backfill (the 'doesn't take arrows in' complaint)", () => {
	it("pulls pre-existing loose arrows into the quiver THE MOMENT it is equipped", () => {
		const state = mkQuiverState();
		const inv = mkInventory(state);

		// Before equip: quiver is empty and not equipped, arrows are loose.
		expect(state.getEquippedQuiver()).toBeNull();
		expect(getContained(state, "quiver1")).toEqual([]);

		inv._toggleEquipped("quiver1"); // the real equip path

		expect(state.getEquippedQuiver()?.id).toBe("quiver1");
		const contained = getContained(state, "quiver1").sort();
		expect(contained).toContain("arrows");
		expect(contained).toContain("arrowsP1");
		// And the state-level retrieval surfaces them too.
		expect(state.getQuiverAmmunition("quiver1").map(a => a.id).sort())
			.toEqual(["arrows", "arrowsP1"]);
	});

	it("respects the quiver's allowed ammo types — bolts stay OUT of an arrow-only quiver", () => {
		const state = mkQuiverState();
		mkInventory(state)._toggleEquipped("quiver1");
		expect(getContained(state, "quiver1")).not.toContain("bolts");
	});

	it("NEVER poaches ammo already inside another container", () => {
		const state = mkQuiverState();
		// Pre-stash the +1 arrows in a pouch.
		state.addItem({
			id: "pouch",
			name: "Component Pouch",
			type: "G",
			containerCapacity: {weight: [6]},
			containedItems: ["arrowsP1"],
		}, 1, false);

		mkInventory(state)._toggleEquipped("quiver1");

		const contained = getContained(state, "quiver1");
		expect(contained).toContain("arrows");
		expect(contained).not.toContain("arrowsP1"); // left in the pouch
		expect(state.getItemContainer("arrowsP1")?.id).toBe("pouch");
	});

	it("re-equipping does not DUPLICATE contained entries", () => {
		const state = mkQuiverState();
		const inv = mkInventory(state);
		inv._toggleEquipped("quiver1"); // equip → backfill
		inv._toggleEquipped("quiver1"); // unequip
		inv._toggleEquipped("quiver1"); // re-equip → must not re-add duplicates

		const arrowsEntries = getContained(state, "quiver1").filter(id => id === "arrows");
		expect(arrowsEntries.length).toBe(1);
	});
});

// ===========================================================================
// (b) COMBAT-TAB VISIBILITY — the "not showing in combat" complaint
// ===========================================================================

describe("Quiver — combat-tab visibility (the 'not showing in combat' complaint)", () => {
	let savedDocument;
	let section;
	let container;

	beforeEach(() => {
		savedDocument = globalThis.document;
		section = {style: {display: "PRESET"}, innerHTML: ""};
		container = {style: {}, innerHTML: "STALE"};
		globalThis.document = {
			getElementById: (id) => {
				if (id === "charsheet-combat-quiver-section") return section;
				if (id === "charsheet-combat-quiver") return container;
				return null;
			},
			querySelector: () => null,
			querySelectorAll: () => [],
			addEventListener: () => {},
			removeEventListener: () => {},
		};
	});

	afterEach(() => { globalThis.document = savedDocument; });

	it("keeps the quiver section HIDDEN when no quiver is equipped", () => {
		const state = mkQuiverState(); // quiver not equipped
		mkCombat(state).renderCombatQuiver();
		expect(section.style.display).toBe("none");
		expect(container.innerHTML).toBe("");
	});

	it("UN-HIDES the quiver section in the COMBAT tab when a quiver is equipped", () => {
		const state = mkQuiverState();
		state.setItemEquipped("quiver1", true);
		state.autoPlaceAmmunitionInQuiver("quiver1");

		mkCombat(state).renderCombatQuiver();

		expect(section.style.display).toBe(""); // un-hidden
		expect(container.innerHTML).toContain("Quiver");
		expect(container.innerHTML).toContain("Arrows");
	});

	it("re-hides the section if the quiver is later unequipped", () => {
		const state = mkQuiverState();
		state.setItemEquipped("quiver1", true);
		const combat = mkCombat(state);
		combat.renderCombatQuiver();
		expect(section.style.display).toBe("");

		state.setItemEquipped("quiver1", false);
		combat.renderCombatQuiver();
		expect(section.style.display).toBe("none");
		expect(container.innerHTML).toBe("");
	});
});

// ===========================================================================
// (c) NON-BLOCKING, RANGED-ONLY PICKER
// ===========================================================================

describe("Quiver — non-blocking, ranged-only post-attack picker", () => {
	const bow = {name: "Longbow", isRanged: true, sourceItem: {id: "bow1", ammoType: "arrow|phb"}};

	function mkPickerCombat (quiverAmmoForWeapon, {tracking = true} = {}) {
		return mkCombat({
			isAmmunitionTrackingEnabled: () => tracking,
			getQuiverAmmunitionForWeapon: () => quiverAmmoForWeapon,
		});
	}

	function quiverHook (combat) {
		return combat._getPostAttackHooks().find(h => h.id === "quiver");
	}

	it("FIRES on a ranged weapon attack with compatible quiver ammo", () => {
		const combat = mkPickerCombat([{id: "arrows", name: "Arrows", quantity: 20}]);
		expect(quiverHook(combat).predicate({isRanged: true, attack: bow})).toBe(true);
	});

	it("does NOT fire on a MELEE attack", () => {
		const combat = mkPickerCombat([{id: "arrows", name: "Arrows", quantity: 20}]);
		const melee = {name: "Longsword", isMelee: true, type: "melee", range: "melee"};
		expect(quiverHook(combat).predicate({isRanged: false, attack: melee})).toBe(false);
	});

	it("does NOT fire on a SPELL attack even when ranged", () => {
		const combat = mkPickerCombat([{id: "arrows", name: "Arrows", quantity: 20}]);
		const spell = {name: "Fire Bolt", isSpell: true, isRanged: true, sourceItem: {id: "bow1", ammoType: "arrow|phb"}};
		expect(quiverHook(combat).predicate({isRanged: true, attack: spell})).toBe(false);
	});

	it("does NOT fire when the quiver holds no compatible ammo", () => {
		const combat = mkPickerCombat([]);
		expect(quiverHook(combat).predicate({isRanged: true, attack: bow})).toBe(false);
	});

	it("does NOT fire when ammunition tracking is disabled", () => {
		const combat = mkPickerCombat([{id: "arrows", name: "Arrows", quantity: 20}], {tracking: false});
		expect(quiverHook(combat).predicate({isRanged: true, attack: bow})).toBe(false);
	});

	it("is ADDITIVE — registered alongside other post-attack riders, not replacing them", () => {
		const combat = mkPickerCombat([]);
		const ids = combat._getPostAttackHooks().map(h => h.id);
		expect(ids).toContain("quiver");
		expect(ids).toContain("arcaneShot");
		expect(ids).toContain("critWeaponRider");
		expect(ids.length).toBeGreaterThan(1);
	});

	it("the picker handler is ASYNC (non-blocking — never gates the resolved roll)", () => {
		const combat = mkPickerCombat([{id: "arrows", name: "Arrows", quantity: 20}]);
		expect(combat._pPickQuiverAmmo.constructor.name).toBe("AsyncFunction");
	});

	it("the picker guards a missing weapon id without opening a modal", async () => {
		const combat = mkPickerCombat([{id: "arrows", name: "Arrows", quantity: 20}]);
		// No sourceItem.id → early return; must resolve, not throw or open UiUtil modal.
		await expect(combat._pPickQuiverAmmo({attack: {name: "Longbow"}})).resolves.toBeUndefined();
	});

	it("a shot consumes EXACTLY one round and leaves OTHER ammo stacks untouched", () => {
		const state = mkQuiverState();
		state.setItemEquipped("quiver1", true);
		state.autoPlaceAmmunitionInQuiver("quiver1");

		const beforeArrows = state.getItems().find(i => i.id === "arrows").quantity;
		const beforeP1 = state.getItems().find(i => i.id === "arrowsP1").quantity;

		expect(state.consumeAmmunition("arrows", 1)).toBe(true);

		expect(state.getItems().find(i => i.id === "arrows").quantity).toBe(beforeArrows - 1);
		expect(state.getItems().find(i => i.id === "arrowsP1").quantity).toBe(beforeP1); // untouched
	});

	it("the synchronous _rollAttack DEFERS ammo consumption to the picker (no double-spend)", () => {
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

		const combat = mkCombat(state);
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
		combat._runPostAttackHooks = async () => {}; // picker would own consumption here
		combat._consumeOnAttackStates = () => {};
		combat._clearPendingSpellRider = () => {};

		const before = state.getItems().find(i => i.id === "arrows").quantity;
		combat._rollAttack("bowAtk", null);
		const after = state.getItems().find(i => i.id === "arrows").quantity;
		// The synchronous roll must NOT consume — the post-attack picker spends exactly one.
		expect(after).toBe(before);
	});
});

// ===========================================================================
// Hardening — ranged detection reuses the shared attack-kind helpers (#2)
// ===========================================================================

describe("Quiver — ranged detection reuses the shared attack-kind helpers", () => {
	function mkBareCombat () { return mkCombat({}); }

	it("_getAttackRollKind classifies a ranged weapon as ranged and a melee weapon as melee", () => {
		const combat = mkBareCombat();
		expect(combat._getAttackRollKind({isRanged: true, range: "150/600"}).isRanged).toBe(true);
		expect(combat._getAttackRollKind({isMelee: true, type: "melee", range: "melee"}).isRanged).toBe(false);
	});

	it("_isMeleeWeaponAttack agrees — a ranged weapon attack is NOT a melee weapon attack", () => {
		const combat = mkBareCombat();
		expect(combat._isMeleeWeaponAttack({isRanged: true, range: "150/600"})).toBe(false);
		expect(combat._isMeleeWeaponAttack({isMelee: true, type: "melee", range: "melee"})).toBe(true);
	});

	it("the quiver hook gates on the same ctx.isRanged the roll derives from those helpers", () => {
		const combat = mkCombat({
			isAmmunitionTrackingEnabled: () => true,
			getQuiverAmmunitionForWeapon: () => [{id: "arrows", name: "Arrows", quantity: 20}],
		});
		const hook = combat._getPostAttackHooks().find(h => h.id === "quiver");
		const bow = {name: "Longbow", isRanged: true, sourceItem: {id: "bow1", ammoType: "arrow|phb"}};
		// _getAttackRollKind on the same attack yields isRanged:true → hook fires.
		expect(combat._getAttackRollKind(bow).isRanged).toBe(true);
		expect(hook.predicate({isRanged: true, attack: bow})).toBe(true);
		// And the melee classification turns it off.
		expect(hook.predicate({isRanged: false, attack: bow})).toBe(false);
	});
});

// ===========================================================================
// (d) SAVE / LOAD round-trip
// ===========================================================================

describe("Quiver — save/load round-trip preserves contents", () => {
	it("round-trips the quiver's contained ammunition through toJson/loadFromJson", () => {
		const state = mkQuiverState();
		state.setItemEquipped("quiver1", true);
		state.autoPlaceAmmunitionInQuiver("quiver1");

		const before = state.getQuiverAmmunition("quiver1").map(a => a.id).sort();
		expect(before.length).toBeGreaterThan(0);

		const json = state.toJson();
		const restored = new CharacterSheetState();
		restored.loadFromJson(json);

		expect(restored.getEquippedQuiver()?.id).toBe("quiver1");
		expect(restored.getQuiverAmmunition("quiver1").map(a => a.id).sort()).toEqual(before);
	});

	it("a legacy save with no containedItems loads WITHOUT error (migration default)", () => {
		const state = mkQuiverState();
		state.setItemEquipped("quiver1", true);

		const json = state.toJson();
		// Simulate a pre-quiver save: strip the containedItems field entirely.
		json.inventory.forEach(i => { if (i.item) delete i.item.containedItems; });

		const restored = new CharacterSheetState();
		expect(() => restored.loadFromJson(json)).not.toThrow();
		expect(restored.getEquippedQuiver()?.id).toBe("quiver1");
		expect(restored.getQuiverAmmunition("quiver1")).toEqual([]);
	});
});
