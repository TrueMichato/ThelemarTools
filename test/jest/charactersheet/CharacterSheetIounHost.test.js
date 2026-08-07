/**
 * Character Sheet — Ioun host items (settings)
 *
 * The Ioun Blade replaces the gemstones in its blade and crossguard with your own Ioun
 * Stones: "For each replaced stone, the sword's bonuses increase by 1." A stone in a
 * setting is *still working* — it keeps conferring its own effect — so a setting is a
 * change of PLACE, not a trade.
 *
 * Two decisions here are load-bearing and easy for a future contributor to "simplify"
 * into being wrong:
 *
 *  1. The per-stone bonus is MATERIALISED onto the item's own props rather than layered
 *     at read time. `bonusWeapon` is read raw at a dozen call sites across combat, ammo,
 *     rests and NPC export, and only some of them consult `getEffectiveItemBonuses`.
 *     Materialising is what makes every one of them correct. The safety of that hinges
 *     entirely on `iounBaseBonuses` — recomputing must always read the pristine base, so
 *     that setting, prying and re-setting can never compound.
 *  2. The attunement waiver is likewise materialised onto `requiresAttunement`, because
 *     `requiresAttunement && !attuned` is the gate at ~24 sites.
 *
 * The suite also pins the layered resolver, so a player's own declaration always beats
 * detection, and prose never invents a setting count it cannot know.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const BOND_TEXT = "An Ioun bond is a special form of attunement and doesn't count against the number of magic items to which a creature can normally be attuned.";
const WAIVER_TEXT = "If you're also attuned to an Ioun stone, you don't need to attune to this weapon to use its properties.";

function makeStone (name = "Ioun Stone #001, Pale Blue Rhomboid") {
	return {
		name,
		source: "MECIounStones",
		type: "wondrous",
		weight: 0,
		requiresAttunement: true,
		entries: [
			{type: "entries", name: "Stone Effect", entries: ["It grants a boon while it orbits your head."]},
			{type: "entries", name: "General Ioun Stone Rules", entries: [BOND_TEXT]},
		],
	};
}

/** The Ioun Blade exactly as TGS3 generates it — note the name never says "Ioun Blade". */
function makeIounBlade (baseName = "Longsword") {
	return {
		name: `Ioun ${baseName}`,
		_variantName: "Ioun Blade",
		source: "GriffonsSaddlebag3",
		type: "M",
		weapon: true,
		weight: 3,
		requiresAttunement: true,
		bonusWeapon: 1,
		bonusSavingThrow: 1,
		entries: [
			"This sword has a gemstone set into its blade and another into its crossguard.",
			WAIVER_TEXT,
			"While you're attuned to an Ioun stone, you can choose to have that stone magically replace one of the gemstones in the sword.",
		],
	};
}

function add (state, item, {equipped = false, attuned = false} = {}) {
	state.addItem(item);
	const rows = state.getItems();
	const row = rows[rows.length - 1];
	if (equipped) state.setItemEquipped(row.id, true);
	if (attuned) state.setItemAttuned(row.id, true);
	return row;
}

describe("Ioun host policy — the layered resolver", () => {
	it("recognises the Ioun Blade by its variant identity, which its generated name never carries", () => {
		const state = new CharacterSheetState();
		const blade = makeIounBlade("Greatsword");
		expect(blade.name).not.toContain("Ioun Blade");

		const policy = state.getIounHostPolicy(blade);
		expect(policy.isHost).toBe(true);
		expect(policy.settings).toBe(2);
		expect(policy.origin).toBe("registry");
		expect(policy.waivesAttunement).toBe(true);
	});

	it("lets a player's own declaration beat every form of detection", () => {
		const state = new CharacterSheetState();
		const ring = {name: "Signet Ring", source: "Custom", entries: ["A plain ring."], iounSettings: 3};
		const policy = state.getIounHostPolicy(ring);
		expect(policy.origin).toBe("user");
		expect(policy.settings).toBe(3);
		// Declaring settings must never invent an attunement waiver the item does not have.
		expect(policy.waivesAttunement).toBe(false);
	});

	it("reads an `iounHost` prop from editable homebrew", () => {
		const state = new CharacterSheetState();
		const crown = {
			name: "Crown of Stars",
			source: "Homebrew",
			entries: ["A crown."],
			iounHost: {settings: 4, grants: ["bonusAc"], settingLabel: "point"},
		};
		const policy = state.getIounHostPolicy(crown);
		expect(policy.origin).toBe("data");
		expect(policy.settings).toBe(4);
		expect(policy.grants).toEqual(["bonusAc"]);
	});

	it("never infers a setting count from prose — text can only reveal the waiver", () => {
		const state = new CharacterSheetState();
		const policy = state.getIounHostPolicy({name: "Odd Blade", source: "X", entries: [WAIVER_TEXT]});
		expect(policy.waivesAttunement).toBe(true);
		expect(policy.isHost).toBe(false);
		expect(policy.settings).toBe(0);
	});

	it("leaves ordinary items alone", () => {
		const state = new CharacterSheetState();
		expect(state.getIounHostPolicy({name: "Longsword", source: "PHB", entries: ["A sword."]}).isHost).toBe(false);
		expect(state.getIounHostPolicy(null).isHost).toBe(false);
	});
});

describe("Setting stones — a change of place, not a trade", () => {
	function setup () {
		const state = new CharacterSheetState();
		const blade = add(state, makeIounBlade(), {equipped: true});
		const stone = add(state, makeStone(), {equipped: true, attuned: true});
		return {state, blade, stone};
	}

	it("seats a bonded stone and raises the host's bonus by one", () => {
		const {state, blade, stone} = setup();
		expect(state.getItems().find(i => i.id === blade.id).bonusWeapon).toBe(1);

		expect(state.setIounStone(blade.id, stone.id)).toEqual({success: true});
		expect(state.getItems().find(i => i.id === blade.id).bonusWeapon).toBe(2);
		expect(state.getIounSetStoneIds(blade.id)).toEqual([stone.id]);
		expect(state.isIounStoneSet(stone.id)).toBe(true);
	});

	it("keeps a set stone functioning — it still orbits' worth of benefit applies", () => {
		const {state, blade, stone} = setup();
		state.setIounStone(blade.id, stone.id);
		const row = state.getItems().find(i => i.id === stone.id);
		expect(row.equipped).toBe(true);
		expect(row.attuned).toBe(true);
	});

	it("refuses an unbonded stone — a setting replaces orbit, not the bond", () => {
		const state = new CharacterSheetState();
		const blade = add(state, makeIounBlade(), {equipped: true});
		const stone = add(state, makeStone(), {equipped: true});
		const res = state.setIounStone(blade.id, stone.id);
		expect(res.success).toBe(false);
		expect(res.error).toMatch(/bonded/i);
	});

	it("refuses more stones than the item has settings", () => {
		const {state, blade, stone} = setup();
		const s2 = add(state, makeStone("Ioun Stone #002, Dusty Rose Prism"), {equipped: true, attuned: true});
		const s3 = add(state, makeStone("Ioun Stone #003, Deep Red Sphere"), {equipped: true, attuned: true});
		expect(state.setIounStone(blade.id, stone.id).success).toBe(true);
		expect(state.setIounStone(blade.id, s2.id).success).toBe(true);
		const res = state.setIounStone(blade.id, s3.id);
		expect(res.success).toBe(false);
		expect(res.error).toMatch(/full/i);
		expect(state.getItems().find(i => i.id === blade.id).bonusWeapon).toBe(3);
	});

	it("refuses to seat the same stone twice in the same item", () => {
		const {state, blade, stone} = setup();
		state.setIounStone(blade.id, stone.id);
		expect(state.setIounStone(blade.id, stone.id).success).toBe(false);
		expect(state.getIounSetStoneIds(blade.id)).toHaveLength(1);
	});

	it("moves a stone between hosts rather than duplicating it", () => {
		const {state, blade, stone} = setup();
		const blade2 = add(state, makeIounBlade("Rapier"), {equipped: true});
		state.setIounStone(blade.id, stone.id);
		expect(state.setIounStone(blade2.id, stone.id).success).toBe(true);
		expect(state.getIounSetStoneIds(blade.id)).toEqual([]);
		expect(state.getIounSetStoneIds(blade2.id)).toEqual([stone.id]);
		expect(state.getItems().find(i => i.id === blade.id).bonusWeapon).toBe(1);
		expect(state.getItems().find(i => i.id === blade2.id).bonusWeapon).toBe(2);
	});

	it("returns a pried-out stone to your possession stowed, not orbiting", () => {
		const {state, blade, stone} = setup();
		state.setIounStone(blade.id, stone.id);
		expect(state.unsetIounStone(blade.id, stone.id)).toEqual({success: true});
		const row = state.getItems().find(i => i.id === stone.id);
		expect(row.equipped).toBe(false);
		expect(row.attuned).toBe(true); // the bond survives; only the seat is vacated
	});
});

describe("Bonus materialisation — the invariant that makes it safe", () => {
	function setup () {
		const state = new CharacterSheetState();
		const blade = add(state, makeIounBlade(), {equipped: true});
		const stones = [1, 2].map(n => add(state, makeStone(`Ioun Stone #00${n}`), {equipped: true, attuned: true}));
		return {state, blade, stones, read: () => state.getItems().find(i => i.id === blade.id)};
	}

	it("never compounds across repeated set / unset cycles", () => {
		const {state, blade, stones, read} = setup();
		for (let i = 0; i < 5; ++i) {
			state.setIounStone(blade.id, stones[0].id);
			state.setIounStone(blade.id, stones[1].id);
			expect(read().bonusWeapon).toBe(3);
			state.unsetIounStone(blade.id, stones[0].id);
			state.unsetIounStone(blade.id, stones[1].id);
			expect(read().bonusWeapon).toBe(1);
		}
	});

	it("recomputing from scratch is a no-op, not an increment", () => {
		const {state, blade, stones, read} = setup();
		state.setIounStone(blade.id, stones[0].id);
		const before = read().bonusWeapon;
		state.reconcileIounHosts();
		state.reconcileIounHosts();
		expect(read().bonusWeapon).toBe(before);
	});

	it("preserves the pristine base so the item can be fully restored", () => {
		const {state, blade, stones, read} = setup();
		state.setIounStone(blade.id, stones[0].id);
		expect(read().iounBaseBonuses.bonusWeapon).toBe(1);
		state.unsetIounStone(blade.id, stones[0].id);
		expect(read().bonusWeapon).toBe(1);
	});

	it("raises every granted bonus, not just the weapon bonus", () => {
		const {state, blade, stones, read} = setup();
		state.setIounStone(blade.id, stones[0].id);
		const item = read();
		expect(item.bonusSavingThrowInt).toBe(2);
		expect(item.bonusSavingThrowWis).toBe(2);
		expect(item.bonusAbilityCheckCha).toBe(2);
		// STR/DEX/CON are deliberately untouched — the item's text names three abilities.
		expect(item.bonusSavingThrowStr || 0).toBe(0);
	});

	it("vacates the setting when the stone leaves the inventory", () => {
		const {state, blade, stones, read} = setup();
		state.setIounStone(blade.id, stones[0].id);
		state.removeItem(stones[0].id);
		expect(state.getIounSetStoneIds(blade.id)).toEqual([]);
		expect(read().bonusWeapon).toBe(1);
	});

	it("vacates the setting when the stone is stowed", () => {
		const {state, blade, stones, read} = setup();
		state.setIounStone(blade.id, stones[0].id);
		state.setItemEquipped(stones[0].id, false);
		expect(state.getIounSetStoneIds(blade.id)).toEqual([]);
		expect(read().bonusWeapon).toBe(1);
	});

	it("vacates the setting when the bond is broken", () => {
		const {state, blade, stones, read} = setup();
		state.setIounStone(blade.id, stones[0].id);
		state.setItemAttuned(stones[0].id, false);
		expect(state.getIounSetStoneIds(blade.id)).toEqual([]);
		expect(read().bonusWeapon).toBe(1);
	});
});

describe("The bond-borne attunement waiver", () => {
	it("frees the blade from attunement once any stone is bonded", () => {
		const state = new CharacterSheetState();
		const blade = add(state, makeIounBlade(), {equipped: true});
		const read = () => state.getItems().find(i => i.id === blade.id);
		expect(read().requiresAttunement).toBe(true);
		expect(state.isIounAttunementWaived(read())).toBe(false);

		const stone = add(state, makeStone(), {equipped: true, attuned: true});
		expect(read().requiresAttunement).toBe(false);
		expect(state.isIounAttunementWaived(read())).toBe(true);

		// ...and re-imposes it the moment the last bond ends.
		state.setItemAttuned(stone.id, false);
		expect(read().requiresAttunement).toBe(true);
		expect(state.isIounAttunementWaived(read())).toBe(false);
	});

	it("releases the slot the blade was occupying", () => {
		const state = new CharacterSheetState();
		const blade = add(state, makeIounBlade(), {equipped: true, attuned: true});
		expect(state.getAttunedCount()).toBe(1);

		add(state, makeStone(), {equipped: true, attuned: true});
		expect(state.getItems().find(i => i.id === blade.id).attuned).toBe(false);
		// The stone's own bond is slot-free, so the character is back to zero slots used.
		expect(state.getAttunedCount()).toBe(0);
	});

	it("leaves items with no waiver alone", () => {
		const state = new CharacterSheetState();
		const ring = add(state, {name: "Ring of Protection", source: "DMG", requiresAttunement: true, entries: ["+1 AC."]}, {equipped: true});
		add(state, makeStone(), {equipped: true, attuned: true});
		expect(state.getItems().find(i => i.id === ring.id).requiresAttunement).toBe(true);
	});
});

describe("Withdrawing host status", () => {
	function setup () {
		const state = new CharacterSheetState();
		const blade = add(state, makeIounBlade(), {equipped: true});
		const stones = [1, 2].map(n => add(state, makeStone(`Ioun Stone #00${n}`), {equipped: true, attuned: true}));
		return {state, blade, stones, read: () => state.getItems().find(i => i.id === blade.id)};
	}

	/**
	 * Materialisation is only safe if it is reversible. These are the three ways a host can
	 * stop being one, and each has to hand the item back exactly as it was found.
	 */
	it("restores the pristine base and drops the seats when the declaration is cleared", () => {
		const state = new CharacterSheetState();
		const sword = add(state, {
			name: "Plain Longsword",
			source: "PHB",
			type: "M",
			weapon: true,
			bonusWeapon: 1,
			iounSettings: 2,
			entries: ["A sword."],
		}, {equipped: true});
		const stone = add(state, makeStone(), {equipped: true, attuned: true});
		const read = () => state.getItems().find(i => i.id === sword.id);

		state.setIounStone(sword.id, stone.id);
		expect(read().bonusWeapon).toBe(2);

		// The ⚙ editor clearing the field is exactly this: the prop goes away, then reconcile runs.
		state._data.inventory.find(i => i.id === sword.id).item.iounSettings = null;
		state.reconcileIounHosts();

		expect(read().bonusWeapon).toBe(1);
		expect(state.getIounSetStoneIds(sword.id)).toEqual([]);
		expect(state.getIounHostPolicy(read()).isHost).toBe(false);
	});

	it("evicts from the END when the setting count shrinks, so stones seated first keep their places", () => {
		const state = new CharacterSheetState();
		const sword = add(state, {
			name: "Plain Longsword",
			source: "PHB",
			type: "M",
			weapon: true,
			bonusWeapon: 0,
			iounSettings: 3,
			entries: ["A sword."],
		}, {equipped: true});
		const a = add(state, makeStone("Ioun Stone #001, Pale Blue Rhomboid"), {equipped: true, attuned: true});
		const b = add(state, makeStone("Ioun Stone #002, Scarlet Sphere"), {equipped: true, attuned: true});
		const c = add(state, makeStone("Ioun Stone #003, Dusty Rose Prism"), {equipped: true, attuned: true});

		state.setIounStone(sword.id, a.id);
		state.setIounStone(sword.id, b.id);
		state.setIounStone(sword.id, c.id);
		expect(state.getIounSetStoneIds(sword.id)).toEqual([a.id, b.id, c.id]);

		state._data.inventory.find(i => i.id === sword.id).item.iounSettings = 1;
		state.reconcileIounHosts();

		expect(state.getIounSetStoneIds(sword.id)).toEqual([a.id]);
		expect(state.getItems().find(i => i.id === sword.id).bonusWeapon).toBe(1);
	});

	it("de-materialises on demand, so the item editor shows and receives BASE values", () => {
		const {state, blade, stones, read} = setup();
		state.setIounStone(blade.id, stones[0].id);
		state.setIounStone(blade.id, stones[1].id);
		expect(read().bonusWeapon).toBe(3);

		expect(state.dematerialiseIounHostBonuses(blade.id)).toBe(true);
		expect(read().bonusWeapon).toBe(1);
		expect(read().iounBaseBonuses).toBeNull();

		// The seats survive — only the arithmetic was undone — so reconcile restores the total
		// without the player having to re-seat anything.
		state.reconcileIounHosts();
		expect(read().bonusWeapon).toBe(3);
	});

	it("is a no-op on an item that was never a host", () => {
		const state = new CharacterSheetState();
		const ring = add(state, {name: "Ring of Protection", source: "DMG", bonusAc: 1, entries: ["+1 AC."]});
		expect(state.dematerialiseIounHostBonuses(ring.id)).toBe(false);
		expect(state.getItems().find(i => i.id === ring.id).bonusAc).toBe(1);
	});
});

describe("Overriding an inherited setting count", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	it("lets an explicit 0 declare that a registry host is NOT a host", () => {
		const blade = {
			name: "Ioun Longsword",
			source: "GriffonsSaddlebag3",
			_variantName: "Ioun Blade",
			type: "M",
			bonusWeapon: "+1",
			reqAttune: true,
		};
		expect(state.getIounHostPolicy(blade).settings).toBe(2);
		expect(state.getIounHostPolicy({...blade, iounSettings: 0})).toMatchObject({isHost: false, settings: 0, origin: "user"});
	});

	it("treats a null declaration as 'not declared' and keeps the inherited count", () => {
		const blade = {
			name: "Ioun Longsword",
			source: "GriffonsSaddlebag3",
			_variantName: "Ioun Blade",
			type: "M",
			bonusWeapon: "+1",
			reqAttune: true,
			iounSettings: null,
		};
		expect(state.getIounHostPolicy(blade)).toMatchObject({isHost: true, settings: 2, origin: "registry"});
	});
});

describe("Surviving the item editor", () => {
	// The editor stamps every edited row `source: "Custom"`. A generated generic variant also
	// carries the BASE item's source, never the variant's. Neither may cost the item its
	// host status — this is the exact regression that shipped and was caught live.
	it("still resolves the Ioun Blade when source is the base item's", () => {
		const state = new CharacterSheetState();
		expect(state.getIounHostPolicy({
			name: "Ioun Longsword", source: "XPHB", _variantName: "Ioun Blade",
		})).toMatchObject({isHost: true, settings: 2, origin: "registry"});
	});

	it("still resolves the Ioun Blade after the editor rewrites source to Custom", () => {
		const state = new CharacterSheetState();
		expect(state.getIounHostPolicy({
			name: "Ioun Longsword", source: "Custom", _isCustom: true, _variantName: "Ioun Blade",
		})).toMatchObject({isHost: true, settings: 2, origin: "registry"});
	});

	it("does not make every sword a host", () => {
		const state = new CharacterSheetState();
		expect(state.getIounHostPolicy({name: "Longsword", source: "XPHB"}).isHost).toBe(false);
	});
});
