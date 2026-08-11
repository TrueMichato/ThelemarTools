import "./setup.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;

describe("Chalice Gemstone Spell Storage", () => {
	let state;
	let hostId;
	let gemInstanceId;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addItem({
			name: "Attuned Shield",
			source: "PHB",
			type: "S",
			shield: true,
			requiresAttunement: true,
			storedSpells: [{id: "host-spell", name: "Shield", level: 1}],
			maxSpellLevels: 5,
		}, 1, true, true);
		hostId = state.getItems()[0].id;
		state.socketGemstone(hostId, {name: "Chalice", source: "TGTT", gemName: "Alexandrite", rarity: "rare"});
		gemInstanceId = state.getSocketedGemstones(hostId)[0].gemInstanceId;
	});

	it("stores 1st- and 2nd-level spells up to two spell levels", () => {
		expect(state.storeGemstoneSpell(gemInstanceId, {name: "Bless", level: 1, casterName: "Cleric", saveDc: 15, castingAbility: "wis"}).success).toBe(true);
		expect(state.storeGemstoneSpell(gemInstanceId, {name: "Shield", level: 1, casterName: "Wizard", spellAttackBonus: 7}).success).toBe(true);
		expect(state.storeGemstoneSpell(gemInstanceId, {name: "Magic Missile", level: 1}).success).toBe(false);

		expect(state.getGemstoneSpellStorage(gemInstanceId)).toMatchObject({capacity: 2, used: 2, remaining: 0, active: true});
	});

	it("rejects cantrips, 3rd-level spells, and over-capacity storage", () => {
		expect(state.storeGemstoneSpell(gemInstanceId, {name: "Light", level: 0}).success).toBe(false);
		expect(state.storeGemstoneSpell(gemInstanceId, {name: "Fireball", level: 3}).success).toBe(false);
		expect(state.storeGemstoneSpell(gemInstanceId, {name: "Misty Step", level: 2}).success).toBe(true);
		expect(state.storeGemstoneSpell(gemInstanceId, {name: "Bless", level: 1}).success).toBe(false);
	});

	it("casts with original metadata and removes the spell only on success", () => {
		const stored = state.storeGemstoneSpell(gemInstanceId, {
			name: "Hold Person",
			source: "PHB",
			level: 2,
			casterName: "Ilyra",
			saveDc: 16,
			spellAttackBonus: 8,
			castingAbility: "wis",
		}).spell;

		const cast = state.castGemstoneStoredSpell(gemInstanceId, stored.id);
		expect(cast).toEqual({
			success: true,
			spell: expect.objectContaining({name: "Hold Person", casterName: "Ilyra", saveDc: 16, spellAttackBonus: 8, castingAbility: "wis"}),
		});
		expect(state.getGemstoneSpellStorage(gemInstanceId).storedSpells).toEqual([]);
		expect(state.castGemstoneStoredSpell(gemInstanceId, stored.id).success).toBe(false);
	});

	it("allows storage while inactive but blocks casting until equipped and attuned", () => {
		const host = state._data.inventory.find(item => item.id === hostId);
		host.attuned = false;
		const stored = state.storeGemstoneSpell(gemInstanceId, {name: "Bless", level: 1}).spell;

		expect(state.getGemstoneSpellStorage(gemInstanceId).active).toBe(false);
		expect(state.castGemstoneStoredSpell(gemInstanceId, stored.id).success).toBe(false);
		expect(state.getGemstoneSpellStorage(gemInstanceId).storedSpells).toHaveLength(1);

		host.attuned = true;
		expect(state.castGemstoneStoredSpell(gemInstanceId, stored.id).success).toBe(true);
	});

	it("keeps Chalice storage isolated from host item spell storage", () => {
		const host = state._data.inventory.find(item => item.id === hostId);
		state.storeGemstoneSpell(gemInstanceId, {name: "Bless", level: 1});

		expect(host.item.storedSpells).toEqual([{id: "host-spell", name: "Shield", level: 1}]);
		expect(host.item.maxSpellLevels).toBe(5);
		expect(state.getGemstoneSpellStorage(gemInstanceId).storedSpells.map(it => it.name)).toEqual(["Bless"]);
	});

	it("preserves storage across unsocket and resocket", () => {
		state.storeGemstoneSpell(gemInstanceId, {name: "Misty Step", level: 2, casterName: "Wizard"});
		const removed = state.unsocketGemstone(hostId, "Chalice");
		const loose = state.getItems().find(item => item.id === removed.looseItemId);

		expect(state.getGemstoneSpellStorage(gemInstanceId)).toMatchObject({used: 2, active: false});
		state.socketGemstone(hostId, loose._gemstoneData);
		expect(state.getGemstoneSpellStorage(gemInstanceId)).toMatchObject({used: 2, active: true});
	});

	it("migrates legacy Chalice records with empty storage", () => {
		const json = state.toJson();
		delete json.inventory[0].item.socketedGemstones[0].runtime;
		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);
		const gem = loaded.getSocketedGemstones(hostId)[0];

		expect(gem.runtime.spellStorage).toEqual({capacity: 2, storedSpells: []});
		expect(loaded.getGemstoneSpellStorage(gem.gemInstanceId)).toMatchObject({capacity: 2, used: 0});
	});
});
