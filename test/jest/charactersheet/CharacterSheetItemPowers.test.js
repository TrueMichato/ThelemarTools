import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";
import {jest} from "@jest/globals";

import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

if (typeof globalThis.document === "undefined") {
	globalThis.document = {
		addEventListener () {},
		getElementById () { return null; },
		querySelector () { return null; },
		querySelectorAll () { return []; },
	};
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;
const items = JSON.parse(readFileSync(resolve(REPO_ROOT, "data/items.json"), "utf8")).item;
const brewItems = JSON.parse(readFileSync(resolve(REPO_ROOT, "homebrew/TravelersGuidetoThelemar.json"), "utf8")).item;

function addActiveCatalogItem (state, item) {
	state.addItem({
		...item,
		id: `${item.name.toLowerCase().replace(/\W+/g, "-")}-${item.source.toLowerCase()}`,
		equipped: true,
		attuned: true,
		requiresAttunement: !!item.reqAttune,
		quantity: 1,
	});
	return state.getItems().find(it => it.name === item.name && it.source === item.source);
}

describe("Catalog magic-item powers and passive normalization", () => {
	it("normalizes Staff of Power spells, Power Strike, and Retributive Strike", () => {
		const state = new CharacterSheetState();
		const staff = items.find(it => it.name === "Staff of Power" && it.source === "DMG");
		const added = addActiveCatalogItem(state, staff);
		const powers = state.getItemPowers({activeOnly: true}).filter(power => power.itemId === added.id);

		expect(powers.filter(power => power.kind === "spell")).toHaveLength(9);
		expect(powers).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Fireball", chargesCost: 5, castLevel: 5, actionType: "action"}),
			expect.objectContaining({name: "Power Strike", chargesCost: 1, actionType: "onHit"}),
			expect.objectContaining({name: "Retributive Strike", actionType: "action", isDestructive: true}),
		]));
	});

	it("atomically spends Staff of Power charges and guards destructive use", () => {
		const state = new CharacterSheetState();
		const staff = items.find(it => it.name === "Staff of Power" && it.source === "DMG");
		const added = addActiveCatalogItem(state, staff);
		const fireball = state.getItemPowers({activeOnly: true}).find(power => power.itemId === added.id && power.name === "Fireball");
		const strike = state.getItemPowers({activeOnly: true}).find(power => power.itemId === added.id && power.name === "Retributive Strike");

		expect(state.invokeItemPower(added.id, fireball.id)).toEqual(expect.objectContaining({ok: true, chargesCurrent: 15}));
		expect(state.invokeItemPower(added.id, strike.id)).toEqual(expect.objectContaining({ok: false, needsConfirmation: true}));
		expect(state.getItems().some(item => item.id === added.id)).toBe(true);
		expect(state.invokeItemPower(added.id, strike.id, {confirmed: true})).toEqual(expect.objectContaining({ok: true, destroyed: true}));
		expect(state.getItems().some(item => item.id === added.id)).toBe(false);
	});

	it("normalizes Gae Bolg's bonus-action once-per-dawn power", () => {
		const state = new CharacterSheetState();
		const gaeBolg = brewItems.find(it => it.name === "Gae Bolg" && it.source === "TGTT");
		const added = addActiveCatalogItem(state, gaeBolg);
		const power = state.getItemPowers({activeOnly: true}).find(it => it.itemId === added.id && it.name === "Enemy-Blinding Radiance");

		expect(power).toEqual(expect.objectContaining({actionType: "bonus", chargesCost: 1, chargesCurrent: 1, recharge: "dawn"}));
		expect(state.invokeItemPower(added.id, power.id)).toEqual(expect.objectContaining({ok: true, chargesCurrent: 0}));
		expect(state.getItemPower(added.id, power.id)).toEqual(expect.objectContaining({isAvailable: false}));
	});

	it("derives Robe of the Archmagi's unarmored AC and magic-save advantage", () => {
		const state = new CharacterSheetState();
		state.setAbilityBase("dex", 14);
		const robe = items.find(it => it.name === "Robe of the Archmagi" && it.source === "DMG");
		const added = addActiveCatalogItem(state, robe);

		expect(state.getArmorClass()).toBe(17);
		expect(state.getNamedModifiers()).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "save:advantage:magic", sourceFeatureId: `item:${added.id}`}),
		]));

		state.setItemEquipped(added.id, false);
		expect(state.getArmorClass()).not.toBe(17);
		expect(state.getNamedModifiers().some(mod => mod.sourceFeatureId === `item:${added.id}`)).toBe(false);
	});

	it("casts an item spell through the spell result pipeline without spending a spell slot", async () => {
		const state = new CharacterSheetState();
		const spells = new CharacterSheetSpells({getState: () => state});
		spells._allSpells = [{
			name: "Fireball",
			source: "PHB",
			level: 3,
			duration: [{type: "instant"}],
		}];
		spells._pHandleCastingConstraints = jest.fn().mockResolvedValue(true);
		spells._showCastResult = jest.fn().mockResolvedValue(undefined);
		const slotsBefore = JSON.stringify(state.getSpellSlots());

		await expect(spells.pCastItemSpell({
			id: "fireball",
			itemId: "staff",
			itemName: "Staff of Power",
			spellName: "Fireball",
			spellSource: "PHB",
			castLevel: 5,
		})).resolves.toBe(true);

		expect(spells._showCastResult).toHaveBeenCalledWith(
			expect.objectContaining({name: "Fireball", level: 5, sourceItem: "Staff of Power"}),
			5,
			false,
			false,
			{sourceItem: "Staff of Power"},
		);
		expect(JSON.stringify(state.getSpellSlots())).toBe(slotsBefore);
	});
});
