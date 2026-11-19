import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";

const CharacterSheetState = globalThis.CharacterSheetState;

const makeIllrigger = () => {
	const state = new CharacterSheetState();
	state.addClass({name: "Illrigger", source: "TGTT-IllR", level: 11});
	state.addFeature({name: "Baleful Interdict", source: "IllriggerRevised", classSource: "IllriggerRevised"});
	return state;
};

const addWeapon = (state, tier, overrides = {}) => {
	const variant = `${tier ? `+${tier} ` : ""}True Name`;
	state.addItem({
		name: `${variant} Longsword`,
		source: "IllriggerRevised",
		_variantName: variant,
		type: "M",
		weaponCategory: "martial",
		dmg1: "1d8",
		dmgType: "S",
		bonusWeapon: tier ? `+${tier}` : undefined,
		reqAttune: "by an illrigger",
		...overrides,
	});
	const row = state.getItems().at(-1);
	state.setItemEquipped(row.id, true);
	state.setItemAttuned(row.id, true);
	return row.id;
};

describe("True Name weapons and Baleful Interdict", () => {
	it.each([0, 1, 2, 3])("applies tier %i to actual seal damage without inflating weapon damage", tier => {
		const state = makeIllrigger();
		const id = addWeapon(state, tier);
		const calcs = state.getFeatureCalculations();
		expect(calcs.sealDamage).toBe(`${3 + tier}d6`);
		const placed = state.placeSeal("Ogre");
		expect(state.burnSeals(placed.id, 1).dice).toBe(`${3 + tier}d6`);
		expect(state.getItems().find(item => item.id === id).dmg1).toBe("1d8");
		state.setItemAttuned(id, false);
		expect(state.getFeatureCalculations().sealDamage).toBe("3d6");
	});

	it("requires an equipped, attuned weapon from the correct source and never stacks variants", () => {
		const state = makeIllrigger();
		addWeapon(state, 1);
		const stronger = addWeapon(state, 3);
		expect(state.getFeatureCalculations().sealDamage).toBe("6d6");
		state.setItemEquipped(stronger, false);
		expect(state.getFeatureCalculations().sealDamage).toBe("4d6");
		addWeapon(state, 3, {source: "Custom"});
		expect(state.getFeatureCalculations().sealDamage).toBe("4d6");
	});

	it("allows an extra pool seal only on a natural 18–20 with that exact weapon", () => {
		const state = makeIllrigger();
		const id = addWeapon(state, 0);
		const attack = {sourceItem: {id}, isSpell: false};
		expect(state.canPlaceTrueNameExtraSeal({attack, naturalRoll: 17})).toBe(false);
		expect(state.canPlaceTrueNameExtraSeal({attack, naturalRoll: 18})).toBe(true);
		expect(state.canPlaceTrueNameExtraSeal({attack: {sourceItem: {id: "other"}}, naturalRoll: 20})).toBe(false);
		expect(state.canPlaceTrueNameExtraSeal({attack: {...attack, isSpell: true}, naturalRoll: 20})).toBe(false);
		const before = state.getSealsAvailable();
		expect(state.placeSeal("Ogre", {round: 1, attack, naturalRoll: 19, extraSeal: true}).count).toBe(2);
		expect(state.getSealsAvailable()).toBe(before - 2);
		expect(state.placeSeal("Other", {round: 1, attack, naturalRoll: 20, extraSeal: true})).toBeNull();
		state._setSealsAvailable(1);
		expect(state.canPlaceTrueNameExtraSeal({attack, naturalRoll: 20})).toBe(false);
		expect(state.placeSeal("Last", {round: 2, attack, naturalRoll: 20, extraSeal: true}).count).toBe(1);
	});

	it.each([2, 3])("tier %i kill recovery persists until dusk and leaves live seals and turn gates alone", tier => {
		const state = makeIllrigger();
		const id = addWeapon(state, tier);
		const placement = state.placeSeal("Survivor", {round: 1});
		state._setSealsAvailable(0);
		expect(state.regainSealsFromTrueName(id, {enemyDefeated: false}).ok).toBe(false);
		const result = state.regainSealsFromTrueName(id, {enemyDefeated: true});
		expect(result.ok).toBe(true);
		expect(state.getSealsAvailable()).toBe(tier === 3 ? 2 : 1);
		expect(state.getFeature("Baleful Interdict").uses.current).toBe(state.getSealsAvailable());
		expect(state.getResources().find(r => r.name === "Baleful Interdict").current).toBe(state.getSealsAvailable());
		expect(state.getSealPlacements()).toEqual([placement]);
		expect(state.getTempHp()).toBe(tier === 3 ? 11 : 0);
		expect(state.placeSeal("Same turn", {round: 1})).toBeNull();
		const reloaded = new CharacterSheetState();
		reloaded.loadFromJson(state.toJson());
		expect(reloaded.regainSealsFromTrueName(id, {enemyDefeated: true}).ok).toBe(false);
		reloaded.onLongRest();
		reloaded._setSealsAvailable(0);
		expect(reloaded.regainSealsFromTrueName(id, {enemyDefeated: true}).ok).toBe(false);
		reloaded.onDusk();
		expect(reloaded.regainSealsFromTrueName(id, {enemyDefeated: true}).ok).toBe(true);
	});

	it("manual seal recovery is capped, synchronized, and does not clear placements", () => {
		const state = makeIllrigger();
		const placement = state.placeSeal("Ogre", {round: 1});
		state.spendSeal(2);
		expect(state.regainSeals(1)).toBe(1);
		expect(state.regainSeals(99)).toBe(2);
		expect(state.getSealsAvailable()).toBe(state.getSealsMax());
		expect(state.getSealPlacements()).toEqual([placement]);
		expect(state.getFeature("Baleful Interdict").uses.current).toBe(state.getSealsMax());
		expect(state.getResources().find(r => r.name === "Baleful Interdict").current).toBe(state.getSealsMax());
	});

	it("does not grant a recovery to lesser weapons or replace a larger temporary HP pool", () => {
		const state = makeIllrigger();
		const lesser = addWeapon(state, 1);
		expect(state.regainSealsFromTrueName(lesser, {enemyDefeated: true}).ok).toBe(false);
		const greater = addWeapon(state, 3, {_variantName: undefined});
		state.setTempHp(30);
		state._setSealsAvailable(state.getSealsMax() - 1);
		expect(state.regainSealsFromTrueName(greater, {enemyDefeated: true}).ok).toBe(true);
		expect(state.getSealsAvailable()).toBe(state.getSealsMax());
		expect(state.getTempHp()).toBe(30);
	});

	it("the real attack follow-up places the opted-in extra seal and persists it", async () => {
		const state = makeIllrigger();
		const id = addWeapon(state, 0);
		const controls = {
			".charsheet__interdict-target-ipt": {value: "Ogre", focus: () => {}},
			".charsheet__interdict-confirm": globalThis.e_(),
			".charsheet__interdict-skip": globalThis.e_(),
			".charsheet__interdict-true-name-extra": {checked: true},
		};
		const modal = {innerHTML: "", querySelector: selector => controls[selector]};
		const original = CharacterSheetModal.pGetRollFollowup;
		CharacterSheetModal.pGetRollFollowup = async () => ({eleModalInner: modal, doClose: () => {}});
		const combat = Object.create(globalThis.CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {saveCharacter: jest.fn()};
		combat.renderCombatInterdiction = jest.fn();
		try {
			const before = state.getSealsAvailable();
			const pending = combat._pPlaceBalefulInterdictSeal({attack: {sourceItem: {id}}, rollResult: {roll: 18}});
			await Promise.resolve();
			expect(modal.innerHTML).toContain("spend 2 seals total");
			controls[".charsheet__interdict-confirm"].click();
			expect(await pending).toBe(true);
			expect(state.getSealsAvailable()).toBe(before - 2);
			expect(state.getSealPlacements()[0]).toMatchObject({target: "Ogre", count: 2});
			expect(combat._page.saveCharacter).toHaveBeenCalledTimes(1);
		} finally {
			CharacterSheetModal.pGetRollFollowup = original;
		}
	});

	it("the rendered recovery controls honor confirmation and rerender both HP and resources", async () => {
		const state = makeIllrigger();
		const id = addWeapon(state, 3);
		state._setSealsAvailable(0);
		const manual = globalThis.e_();
		const recover = globalThis.e_();
		const dusk = globalThis.e_();
		recover.dataset.itemId = dusk.dataset.itemId = id;
		const container = {
			innerHTML: "",
			querySelector: selector => selector === ".charsheet__interdict-regain" ? manual : null,
			querySelectorAll: selector => selector === ".charsheet__interdict-true-name-regain" ? [recover]
				: selector === ".charsheet__interdict-true-name-dusk" ? [dusk] : [],
		};
		const originalDocument = globalThis.document;
		const originalConfirm = CharacterSheetModal.pGetUserBoolean;
		globalThis.document = {getElementById: id => id === "charsheet-combat-interdiction" ? container : null};
		const combat = Object.create(globalThis.CharacterSheetCombat.prototype);
		combat._state = state;
		combat._page = {saveCharacter: jest.fn(), _renderHp: jest.fn(), _features: {_renderResources: jest.fn()}};
		try {
			combat.renderCombatInterdiction();
			expect(container.innerHTML).toContain("Regain 1 (manual)");
			manual.click();
			expect(state.getSealsAvailable()).toBe(1);
			CharacterSheetModal.pGetUserBoolean = async () => false;
			await recover._handlers.click();
			expect(state.getSealsAvailable()).toBe(1);
			CharacterSheetModal.pGetUserBoolean = async () => true;
			await recover._handlers.click();
			expect(state.getSealsAvailable()).toBe(3);
			expect(state.getTempHp()).toBe(11);
			expect(combat._page._renderHp).toHaveBeenCalled();
			expect(combat._page._features._renderResources).toHaveBeenCalled();
			expect(container.innerHTML).toContain("Recharge at dusk");
			await dusk._handlers.click();
			expect(state.getTrueNameWeapons()[0].recoveryAvailable).toBe(true);
		} finally {
			globalThis.document = originalDocument;
			CharacterSheetModal.pGetUserBoolean = originalConfirm;
		}
	});
});
