import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetUpgrades = globalThis.CharacterSheetUpgrades;

describe("Gemstone Empowerment", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "PHB", level: 9});
	});

	const addHost = ({name = "Host Weapon", equipped = true, attuned = false, requiresAttunement = false} = {}) => {
		state.addItem({name, source: "PHB", type: "M", weapon: true, requiresAttunement}, 1, equipped, attuned);
		return state.getItems().find(item => item.name === name).id;
	};

	it("defines all 39 production gemstone descriptors", () => {
		expect(CharacterSheetUpgrades.getGemstoneRegistryNames()).toHaveLength(39);
		expect(new Set(CharacterSheetUpgrades.getGemstoneRegistryNames()).size).toBe(39);
	});

	it("aggregates only equipped, properly attuned exact hosts", () => {
		const activeId = addHost({name: "Active"});
		const inactiveId = addHost({name: "Inactive", equipped: false});
		const unattunedId = addHost({name: "Unattuned", requiresAttunement: true});
		state.socketGemstone(activeId, {name: "Journey", source: "TGTT", gemName: "Star Ruby"});
		state.socketGemstone(inactiveId, {name: "Volant", source: "TGTT", gemName: "Black Sapphire"});
		state.socketGemstone(unattunedId, {name: "Tempest", source: "TGTT", gemName: "Blue Sapphire"});

		expect(state.getGemstoneEffects().map(effect => effect.name)).toEqual(["Journey"]);
		expect(state.getGemstoneEffects({activeOnly: false})).toHaveLength(3);
		expect(state.getGemstoneEffects({hostItemId: inactiveId})).toEqual([]);
		expect(state.getGemstoneSpeedBonus()).toBe(10);

		state.getSettings().enableTgtt = false;
		expect(state.getGemstoneEffects()).toEqual([]);
		expect(state.getGemstoneSpeedBonus()).toBe(0);
	});

	it("moves runtime state with a gem through unsocket and resocket", () => {
		const hostId = addHost();
		state.socketGemstone(hostId, {name: "Magebane", source: "TGTT", gemName: "Amethyst", rarity: "rare"});
		const original = state.getSocketedGemstones(hostId)[0];
		state.setResourceCurrent(`gem:${original.gemInstanceId}:charges`, 1);

		const removed = state.unsocketGemstone(hostId, "Magebane");
		const loose = state.getItems().find(item => item.id === removed.looseItemId);
		expect(loose._gemstoneData.gemInstanceId).toBe(original.gemInstanceId);
		expect(loose._gemstoneData.runtime.resources.charges.current).toBe(1);
		expect(state.getGemstoneEffects()).toEqual([]);

		state.socketGemstone(hostId, loose._gemstoneData);
		expect(state.getSocketedGemstones(hostId)[0].runtime.resources.charges.current).toBe(1);
	});

	it("surfaces gemstone resources and routes tracker updates to gem runtime", () => {
		const hostId = addHost();
		state.socketGemstone(hostId, {name: "Thief", source: "TGTT", gemName: "Malachite"});
		const resource = state.getResources().find(it => it.gemstoneResource);

		expect(resource).toMatchObject({name: "Thief Gemstone", current: 1, max: 1, hostItemId: hostId});
		state.setResourceCurrent(resource.id, 0);
		expect(state.getResources().find(it => it.id === resource.id).current).toBe(0);
		expect(state.getSocketedGemstones(hostId)[0].usedToday).toBe(true);
	});

	it("surfaces resource and toggle gemstones through the item-power channel", () => {
		const knockHost = addHost({name: "Knock Host"});
		const boundHost = addHost({name: "Bound Host"});
		state.socketGemstone(knockHost, {name: "Knock", source: "TGTT"});
		state.socketGemstone(boundHost, {name: "Bound Weapon", source: "TGTT"});

		const knock = state.getItemPowers().find(power => power.itemId === knockHost && power.gemstonePower);
		const bound = state.getItemPowers().find(power => power.itemId === boundHost && power.gemstonePower);
		expect(knock).toMatchObject({name: "Knock", spellName: "Knock", resourceCurrent: 1});
		expect(state.invokeItemPower(knockHost, knock.id)).toMatchObject({ok: true, resourceCurrent: 0});
		expect(state.getItemPower(knockHost, knock.id).isAvailable).toBe(false);

		expect(bound).toMatchObject({name: "Bound Weapon", isToggle: true, isActive: false});
		expect(state.invokeItemPower(boundHost, bound.id)).toMatchObject({ok: true, isActive: true});
		expect(state.getItemPower(boundHost, bound.id).isActive).toBe(true);
	});

	it("honors activeOnly for gemstone item powers", () => {
		const hostId = addHost({equipped: false});
		state.socketGemstone(hostId, {name: "Knock", source: "TGTT"});
		expect(state.getItemPowers()).toContainEqual(expect.objectContaining({itemId: hostId, gemstonePower: true, isAvailable: false}));
		expect(state.getItemPowers({activeOnly: true}).filter(power => power.itemId === hostId)).toEqual([]);
	});

	it("uses partial dawn recovery and zero-on-rest policies", () => {
		const magebaneHost = addHost({name: "Magebane Host"});
		const conductorHost = addHost({name: "Conductor Host"});
		state.socketGemstone(magebaneHost, {name: "Magebane", source: "TGTT"});
		state.socketGemstone(conductorHost, {name: "Superconductor", source: "TGTT"});
		const magebane = state.getSocketedGemstones(magebaneHost)[0];
		const conductor = state.getSocketedGemstones(conductorHost)[0];
		state.setResourceCurrent(`gem:${magebane.gemInstanceId}:charges`, 0);
		state.setResourceCurrent(`gem:${conductor.gemInstanceId}:charges`, 2);
		const random = jest.spyOn(Math, "random").mockReturnValue(0.5);

		state.recoverGemstoneResources("long");

		expect(magebane.runtime.resources.charges.current).toBe(2);
		expect(conductor.runtime.resources.charges.current).toBe(0);
		random.mockRestore();
	});

	it("applies partial gemstone dawn recovery exactly once during onLongRest", () => {
		const hostId = addHost();
		state.socketGemstone(hostId, {name: "Magebane", source: "TGTT"});
		const gem = state.getSocketedGemstones(hostId)[0];
		state.setResourceCurrent(`gem:${gem.gemInstanceId}:charges`, 0);
		const random = jest.spyOn(Math, "random").mockReturnValue(0);

		state.onLongRest();

		expect(gem.runtime.resources.charges.current).toBe(1);
		random.mockRestore();
	});

	it("filters combat riders to the exact host and target type", () => {
		const dragonbaneHost = addHost({name: "Dragonbane Host"});
		const otherHost = addHost({name: "Other Host"});
		state.socketGemstone(dragonbaneHost, {name: "Dragonbane", source: "TGTT"});

		const matching = state.getGemstoneDamageRidersForAttack({sourceItem: {id: dragonbaneHost}}, {targetTypes: ["dragon"]});
		expect(matching).toEqual([expect.objectContaining({dice: "2d6", damageType: "weapon", hostItemId: dragonbaneHost})]);
		expect(state.getGemstoneDamageRidersForAttack({sourceItem: {id: dragonbaneHost}}, {targetTypes: ["giant"]})).toEqual([]);
		expect(state.getGemstoneDamageRidersForAttack({sourceItem: {id: otherHost}}, {targetTypes: ["dragon"]})).toEqual([]);
	});

	it("applies standard passive descriptors through live lifecycle gates", () => {
		const journeyHost = addHost({name: "Journey Host"});
		const overshieldHost = addHost({name: "Overshield Host"});
		state.socketGemstone(journeyHost, {name: "Journey", source: "TGTT"});
		state.socketGemstone(overshieldHost, {name: "Overshield", source: "TGTT"});

		expect(state.getGemstoneSpeedBonus()).toBe(10);
		expect(state.getTurnStartEffects()).toContainEqual({type: "tempHp", amount: 8, source: "Overshield"});
		state.setTempHp(2);
		state.applyTurnStartEffects();
		expect(state.getTempHp()).toBe(8);

		state.unsocketGemstone(overshieldHost, "Overshield");
		expect(state.getTurnStartEffects()).not.toContainEqual(expect.objectContaining({source: "Overshield"}));
	});

	it("migrates malformed legacy gemstone records idempotently", () => {
		const json = state.toJson();
		json.inventory = [{
			id: "legacy-host",
			item: {
				name: "Legacy Armor",
				source: "PHB",
				type: "LA",
				armor: true,
				socketedGemstones: [{name: "Magebane", source: "TGTT", rarity: "rare", upgradeType: "G", chargesCurrent: 1, chargesMax: 3}],
			},
			quantity: 1,
			equipped: true,
			attuned: false,
		}];

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(json);
		const first = loaded.getSocketedGemstones("legacy-host")[0];
		const firstId = first.gemInstanceId;
		expect(first.upgradeType).toBe("GS:R");
		expect(first.runtime.resources.charges.current).toBe(1);

		loaded.loadFromJson(loaded.toJson());
		const second = loaded.getSocketedGemstones("legacy-host")[0];
		expect(second.gemInstanceId).toBe(firstId);
		expect(second.runtime.resources.charges.current).toBe(1);
	});
});
