/**
 * Character Sheet — Attunement Slot Exemption
 *
 * Some magic items say, in their own rules text, that attuning to them does not
 * consume one of the character's attunement slots. The Ioun bond of the Moorchlyne
 * Ioun Stones brew is the archetype. Without an exemption those items are capped at
 * the normal 3-6 slots, and because every item aggregator gates on
 * `requiresAttunement && attuned`, anything beyond the cap contributes nothing.
 *
 * These tests pin both halves: the exemption fires on a genuine self-declaration, and
 * it does NOT fire on wording that exempts a *separate* sub-item (Orrery of the
 * Wanderer's installed components), where the parent item still occupies a slot.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-inventory.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetInventory = globalThis.CharacterSheetInventory;

const IOUN_BOND_TEXT = "An Ioun bond is a special form of attunement and doesn't count against the number of magic items to which a creature can normally be attuned.";
const ORRERY_TEXT = "You must attune to the orrery and all the components installed in it. Attuning to an installed component doesn't count against the number of magic items you can normally attune to.";

function makeStone (name, {entries, requiresAttunement = true} = {}) {
	return {
		name,
		source: "MECIounStones",
		type: "wondrous",
		weight: 0,
		equipped: false,
		attuned: false,
		requiresAttunement,
		entries: entries || ["A stone that orbits your head."],
	};
}

function makeOfficialStone (name = "Ioun Stone, Protection") {
	return makeStone(name, {
		entries: ["This stone orbits your head at a distance of 1d3 feet."],
	});
}

function addEquipAttune (state, item) {
	state.addItem(item);
	const items = state.getItems();
	const added = items[items.length - 1];
	state.setItemEquipped(added.id, true);
	state.setItemAttuned(added.id, true);
	return added.id;
}

describe("Attunement slot exemption", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
	});

	describe("isAttunementExempt", () => {
		it("exempts an item whose own text says its attunement doesn't count", () => {
			expect(state.isAttunementExempt({entries: [IOUN_BOND_TEXT]})).toBe(true);
		});

		it("does NOT exempt Orrery-style wording, where a separate component is exempt", () => {
			expect(state.isAttunementExempt({entries: [ORRERY_TEXT]})).toBe(false);
		});

		it("does not exempt an ordinary magic item", () => {
			expect(state.isAttunementExempt({entries: ["While wearing this ring, you gain a +1 bonus to AC."]})).toBe(false);
		});

		it("extends slot-free attunement to official Ioun Stones while TGTT is enabled", () => {
			expect(state.isAttunementExempt(makeOfficialStone())).toBe(true);
		});

		it("restores RAW official attunement when TGTT is disabled without disabling intrinsic bonds", () => {
			const official = makeOfficialStone();
			const intrinsic = makeStone("Ioun Stone #001", {entries: [IOUN_BOND_TEXT]});

			expect(state.isAttunementExempt(official)).toBe(true);
			state.setSetting("enableTgtt", false);
			expect(state.isAttunementExempt(official)).toBe(false);
			expect(state.isAttunementExempt(intrinsic)).toBe(true);
		});

		it("does not exempt an item that says its attunement DOES count", () => {
			expect(state.isAttunementExempt({
				entries: ["Attunement to this crown counts against the number of magic items you can normally attune to."],
			})).toBe(false);
		});

		it("finds the declaration nested inside an entries block", () => {
			expect(state.isAttunementExempt({
				entries: [
					"A pale blue rhomboid.",
					{type: "entries", name: "General Ioun Stone Rules", entries: [IOUN_BOND_TEXT]},
				],
			})).toBe(true);
		});

		it("finds the declaration in the real Ioun Stone shape, two sub-blocks deep", () => {
			// This is the shape the brew actually renders once `{#itemEntry}` is
			// dereferenced: item.entries -> "General Ioun Stone Rules" -> "Ioun Bond" -> text.
			// A shallower walk silently returned false here against live data.
			expect(state.isAttunementExempt({
				entries: [
					"{@b Source Type:} Permanent (P)",
					{type: "entries", name: "Stone Effect", entries: ["You gain a +1 bonus to AC."]},
					{
						type: "entries",
						name: "General Ioun Stone Rules",
						entries: [
							"An Ioun Stone is a naturally occurring conduit to the Positive Energy Plane.",
							{type: "entries", name: "Ioun Bond", entries: [`A creature forms an Ioun bond by keeping the stone within 1 foot of itself for 7 days. ${IOUN_BOND_TEXT}`]},
							{type: "entries", name: "Orbiting the Stone", entries: ["The stone orbits your head at a distance of 1d3 feet."]},
						],
					},
				],
			})).toBe(true);
		});

		it("tolerates missing or empty item data", () => {
			expect(state.isAttunementExempt(null)).toBe(false);
			expect(state.isAttunementExempt({})).toBe(false);
		});
	});

	describe("slot accounting", () => {
		it("does not consume a slot for exempt items", () => {
			for (let i = 0; i < 5; i++) addEquipAttune(state, makeStone(`Ioun Stone #${i}`, {entries: [IOUN_BOND_TEXT]}));
			expect(state.getAttunedCount()).toBe(0);
			expect(state.canAttune()).toBe(true);
		});

		it("still consumes a slot for ordinary items", () => {
			for (let i = 0; i < 3; i++) addEquipAttune(state, makeStone(`Ring ${i}`, {entries: ["A plain magic ring."]}));
			expect(state.getAttunedCount()).toBe(3);
			expect(state.canAttune()).toBe(false);
		});

		it("counts only the non-exempt items in a mixed inventory", () => {
			addEquipAttune(state, makeStone("Ring of Protection", {entries: ["A plain magic ring."]}));
			for (let i = 0; i < 4; i++) addEquipAttune(state, makeStone(`Ioun Stone #${i}`, {entries: [IOUN_BOND_TEXT]}));
			addEquipAttune(state, makeStone("Cloak of Displacement", {entries: ["A shimmering cloak."]}));

			expect(state.getAttunedCount()).toBe(2);
			expect(state.canAttune()).toBe(true);
		});

		it("lets a character attune beyond the cap using exempt items via attune()", () => {
			for (let i = 0; i < 3; i++) addEquipAttune(state, makeStone(`Ring ${i}`, {entries: ["A plain magic ring."]}));
			expect(state.canAttune()).toBe(false);

			state.addItem(makeStone("Ioun Stone #600", {entries: [IOUN_BOND_TEXT]}));
			const items = state.getItems();
			const stoneId = items[items.length - 1].id;
			expect(state.attune(stoneId)).toBe(true);
			expect(state.getItems().find(i => i.id === stoneId).attuned).toBe(true);
		});

		it("lets an official Ioun Stone complete attunement beyond the cap only with TGTT enabled", () => {
			for (let i = 0; i < 3; i++) addEquipAttune(state, makeStone(`Ring ${i}`, {entries: ["A plain magic ring."]}));
			state.addItem(makeOfficialStone());
			const officialId = state.getItems().at(-1).id;

			expect(state.attune(officialId)).toBe(true);
			expect(state.getAttunedCount()).toBe(3);

			state.unattune(officialId);
			state.setSetting("enableTgtt", false);
			expect(state.attune(officialId)).toBe(false);
			expect(state.getAttunedCount()).toBe(3);
		});

		it("keeps exempt attunements visible to getAttunedItems (Soul of Artifice counts them RAW)", () => {
			addEquipAttune(state, makeStone("Ring of Protection", {entries: ["A plain magic ring."]}));
			for (let i = 0; i < 4; i++) addEquipAttune(state, makeStone(`Ioun Stone #${i}`, {entries: [IOUN_BOND_TEXT]}));

			expect(state.getAttunedItems().length).toBe(5);
			expect(state.getAttunedCount()).toBe(1);
		});
	});

	describe("bonus application past the cap", () => {
		it("applies AC from a fifth exempt stone that the cap would otherwise have blocked", () => {
			for (let i = 0; i < 3; i++) addEquipAttune(state, makeStone(`Ring ${i}`, {entries: ["A plain magic ring."]}));

			const stone = makeStone("Ioun Stone #014, Dusty Rose Prism", {entries: [IOUN_BOND_TEXT]});
			stone.bonusAc = 1;
			const id = addEquipAttune(state, stone);

			const row = state.getItems().find(i => i.id === id);
			expect(row.attuned).toBe(true);
			expect(row.bonusAc).toBe(1);
		});
	});

	describe("inventory bond entry point", () => {
		it("opens the Ioun manager instead of instantly attuning a bond-policy stone", () => {
			let managerOpens = 0;
			const page = {
				getState: () => state,
				saveCharacter: () => {},
				_ioun: {openModal: () => { managerOpens++; }},
			};
			const inventory = Object.create(CharacterSheetInventory.prototype);
			inventory._page = page;
			inventory._state = state;
			state.addItem(makeOfficialStone());
			const stone = state.getItems().at(-1);

			inventory._toggleAttuned(stone.id);

			expect(state.getItems().find(i => i.id === stone.id).attuned).toBe(false);
			expect(managerOpens).toBe(1);
		});
	});
});
