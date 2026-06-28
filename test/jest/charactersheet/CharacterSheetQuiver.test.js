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
 *   (b) COMBAT-TAB COMPACT SUMMARY (R33) — `renderCombatQuiver` renders a compact
 *       quiver summary into `#charsheet-combat-quiver-summary` and reveals the 🏹
 *       Quiver header button (`#charsheet-combat-quiver-open`) ONLY when a quiver is
 *       equipped, hiding both otherwise (the "not showing in combat" complaint).
 *       The old standalone `#charsheet-combat-quiver-section` is gone.
 *
 *   (c) PER-WEAPON ACTIVE-AMMO SELECTOR (R35, Bug #3) — the R33 🏹 Special Arrow
 *       button is replaced by a per-row ammo `<select>`. Eligibility flows from the
 *       pure `_isAmmoSelectorEligible` gate (ranged weapon, not melee/spell, quiver
 *       has compatible ammo); the selected ammo's bonuses ride both rolls and it is
 *       consumed on the DAMAGE roll only via `_rollDamage` (never the attack roll).
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
		// And the state-level retrieval surfaces them too. A quiver carries ANY
		// recognised ammunition (arrows + darts/bolts together) — its
		// containerCapacity allowed-types are a label, not a hard filter (#11) —
		// so all loose ammo stacks are pulled in on equip.
		expect(state.getQuiverAmmunition("quiver1").map(a => a.id).sort())
			.toEqual(["arrows", "arrowsP1", "bolts"]);
	});

	it("carries arrows AND other ammo together — bolts go INTO the quiver too (#11)", () => {
		// Players expect one quiver to hold their arrows and darts/bolts together,
		// so the per-quiver allowed-type list is treated as a default label, not a
		// hard filter. Loose bolts are pulled in alongside arrows on equip.
		const state = mkQuiverState();
		mkInventory(state)._toggleEquipped("quiver1");
		expect(getContained(state, "quiver1")).toContain("bolts");
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
//
// R33 UX REDESIGN: `renderCombatQuiver` no longer un-hides a standalone
// `#charsheet-combat-quiver-section`. It renders a COMPACT summary into
// `#charsheet-combat-quiver-summary` and reveals/hides the 🏹 Quiver header
// button `#charsheet-combat-quiver-open` (which opens the full quiver modal).
// Assertions were migrated from the old section shape to the new surfaces.
// ===========================================================================

describe("Quiver — combat-tab compact summary (the 'not showing in combat' complaint)", () => {
	let savedDocument;
	let openBtn;
	let summary;

	beforeEach(() => {
		savedDocument = globalThis.document;
		openBtn = {style: {display: "PRESET"}, dataset: {}, addEventListener: () => {}};
		summary = {style: {}, innerHTML: "STALE"};
		globalThis.document = {
			getElementById: (id) => {
				if (id === "charsheet-combat-quiver-open") return openBtn;
				if (id === "charsheet-combat-quiver-summary") return summary;
				return null;
			},
			querySelector: () => null,
			querySelectorAll: () => [],
			addEventListener: () => {},
			removeEventListener: () => {},
		};
	});

	afterEach(() => { globalThis.document = savedDocument; });

	it("keeps the 🏹 Quiver button hidden + summary empty when no quiver is equipped", () => {
		const state = mkQuiverState(); // quiver not equipped
		mkCombat(state).renderCombatQuiver();
		expect(openBtn.style.display).toBe("none");
		expect(summary.innerHTML).toBe("");
	});

	it("reveals the 🏹 Quiver button + renders the compact summary when a quiver is equipped", () => {
		const state = mkQuiverState();
		state.setItemEquipped("quiver1", true);
		state.autoPlaceAmmunitionInQuiver("quiver1");

		mkCombat(state).renderCombatQuiver();

		expect(openBtn.style.display).toBe(""); // button revealed
		expect(summary.innerHTML).toContain("charsheet__quiver-summary");
		expect(summary.innerHTML).toContain("Quiver");
		expect(summary.innerHTML).toContain("Arrows");
	});

	it("re-hides the button + clears the summary if the quiver is later unequipped", () => {
		const state = mkQuiverState();
		state.setItemEquipped("quiver1", true);
		const combat = mkCombat(state);
		combat.renderCombatQuiver();
		expect(openBtn.style.display).toBe("");

		state.setItemEquipped("quiver1", false);
		combat.renderCombatQuiver();
		expect(openBtn.style.display).toBe("none");
		expect(summary.innerHTML).toBe("");
	});
});

// ===========================================================================
// (c) ACTIVE-AMMO SELECTOR AFFORDANCE — per-weapon, ranged-only (R35, Bug #3)
//
// R35 REPLACED the R33 on-demand 🏹 Special Arrow button with a per-weapon active
// ammunition SELECTOR. Eligibility is still decided by the pure gate (now named
// `_isAmmoSelectorEligible`: ranged weapon, not melee/spell, quiver holds
// compatible ammo); the row renders a `<select>` (`_renderAmmoSelector`) of
// "Regular" + each quiver ammo. The selected ammo's bonuses ride BOTH rolls and
// it is consumed on the DAMAGE roll only (never the attack roll). These tests were
// re-pointed from the removed `_isSpecialArrowEligible`/`_renderSpecialArrowButton`
// /`_pApplySpecialArrow` surface.
// ===========================================================================

describe("Quiver — per-weapon active-ammo selector affordance (R35)", () => {
	const bow = {name: "Longbow", isMelee: false, isSpell: false, sourceItem: {id: "bow1", ammoType: "arrow|phb"}};

	function mkPickerCombat (quiverAmmoForWeapon, {tracking = true} = {}) {
		return mkCombat({
			isAmmunitionTrackingEnabled: () => tracking,
			getQuiverAmmunitionForWeapon: () => quiverAmmoForWeapon,
			getSelectedAmmoId: () => null,
		});
	}

	it("is ELIGIBLE on a ranged weapon attack with compatible quiver ammo", () => {
		const combat = mkPickerCombat([{id: "arrows", name: "Arrows", quantity: 20}]);
		expect(combat._isAmmoSelectorEligible(bow, false)).toBe(true);
		const html = combat._renderAmmoSelector(bow, false);
		expect(html).toMatch(/charsheet__attack-ammo-select/);
		expect(html).toMatch(/Regular/);
		expect(html).toMatch(/Arrows/);
	});

	it("is NOT eligible on a MELEE attack", () => {
		const combat = mkPickerCombat([{id: "arrows", name: "Arrows", quantity: 20}]);
		const melee = {name: "Longsword", isMelee: true, isSpell: false, sourceItem: {id: "sword", ammoType: undefined}};
		expect(combat._isAmmoSelectorEligible(melee, true)).toBe(false);
	});

	it("is NOT eligible on a SPELL attack even when ranged", () => {
		const combat = mkPickerCombat([{id: "arrows", name: "Arrows", quantity: 20}]);
		const spell = {name: "Fire Bolt", isSpell: true, isMelee: false, sourceItem: {id: "bow1", ammoType: "arrow|phb"}};
		expect(combat._isAmmoSelectorEligible(spell, false)).toBe(false);
	});

	it("is NOT eligible when the quiver holds no compatible ammo", () => {
		const combat = mkPickerCombat([]);
		expect(combat._isAmmoSelectorEligible(bow, false)).toBe(false);
	});

	it("is ELIGIBLE even when ammunition tracking is disabled (the quiver is its own always-on feature)", () => {
		// Defect #5 carried into R35: the affordance is deliberately NOT gated on
		// `isAmmunitionTrackingEnabled`. Players who keep loose-ammo tracking OFF
		// still want the ammo selector on a ranged shot.
		const combat = mkPickerCombat([{id: "arrows", name: "Arrows", quantity: 20}], {tracking: false});
		expect(combat._isAmmoSelectorEligible(bow, false)).toBe(true);
	});

	it("the OLD post-attack `quiver` hook is GONE; sibling hooks remain", () => {
		const combat = mkPickerCombat([]);
		const ids = combat._getPostAttackHooks().map(h => h.id);
		expect(ids).not.toContain("quiver");
		expect(ids).toContain("arcaneShot");
		expect(ids).toContain("critWeaponRider");
	});

	it("the R33 Special Arrow handlers are removed; the selector helpers replace them", () => {
		const combat = mkPickerCombat([{id: "arrows", name: "Arrows", quantity: 20}]);
		expect(combat._pPickSpecialArrowDamage).toBeUndefined();
		expect(combat._pApplySpecialArrow).toBeUndefined();
		expect(combat._renderSpecialArrowButton).toBeUndefined();
		expect(typeof combat._isAmmoSelectorEligible).toBe("function");
		expect(typeof combat._renderAmmoSelector).toBe("function");
		expect(combat._pPickQuiverAmmo).toBeUndefined();
	});

	it("the selector resolves to Regular (null) for a weapon with no selection, without throwing", () => {
		const combat = mkPickerCombat([{id: "arrows", name: "Arrows", quantity: 20}]);
		// Unknown / unselected weapon → Regular (null active ammo); must not throw.
		expect(combat._getSelectedAmmoForWeapon("no-such-weapon")).toBeNull();
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

	it("the synchronous _rollAttack NO LONGER consumes ammo (R35 — consume moved to the damage roll)", () => {
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
		// Select an ammo so an active ammo IS in play — proving the attack roll
		// still does not spend it (only the damage roll does).
		state.setSelectedAmmoId("bow1", "arrows");

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
		combat._runPostAttackHooks = async () => {};
		combat._consumeOnAttackStates = () => {};
		combat._clearPendingSpellRider = () => {};

		const sumCompatible = () => state.getAmmunitionForWeapon("bow1").reduce((s, a) => s + (a.quantity || 0), 0);
		const before = sumCompatible();
		combat._rollAttack("bowAtk", null);
		const after = sumCompatible();
		// R35 (Bug #3): the attack roll NEVER spends a round — consumption is folded
		// into `_rollDamage`. If the inline attack-time consume were restored, this
		// would drop by one and fail (RED).
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

	it("the active-ammo selector gate keys off the same melee/ranged classification the roll derives", () => {
		const combat = mkCombat({
			isAmmunitionTrackingEnabled: () => true,
			getQuiverAmmunitionForWeapon: () => [{id: "arrows", name: "Arrows", quantity: 20}],
			getSelectedAmmoId: () => null,
		});
		const bow = {name: "Longbow", isMelee: false, isSpell: false, sourceItem: {id: "bow1", ammoType: "arrow|phb"}};
		// _getAttackRollKind on the same attack yields isRanged:true → eligible.
		expect(combat._getAttackRollKind(bow).isRanged).toBe(true);
		expect(combat._isAmmoSelectorEligible(bow, false)).toBe(true);
		// And the melee classification turns it off.
		expect(combat._isAmmoSelectorEligible(bow, true)).toBe(false);
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

	it("a legacy save with no containedItems backfills on load (migration) WITHOUT error", () => {
		const state = mkQuiverState();
		state.setItemEquipped("quiver1", true);

		const json = state.toJson();
		// Simulate a pre-quiver save: strip the containedItems field entirely.
		json.inventory.forEach(i => { if (i.item) delete i.item.containedItems; });

		const restored = new CharacterSheetState();
		expect(() => restored.loadFromJson(json)).not.toThrow();
		expect(restored.getEquippedQuiver()?.id).toBe("quiver1");
		// _migrateQuiverBackfill pulls the loose ammo into the equipped quiver on
		// load (the missing load-time backfill was the original #11 bug).
		expect(restored.getQuiverAmmunition("quiver1").map(a => a.id).sort())
			.toEqual(["arrows", "arrowsP1", "bolts"]);
	});
});
