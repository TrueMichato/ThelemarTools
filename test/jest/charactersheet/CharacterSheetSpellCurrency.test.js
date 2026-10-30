import {jest} from "@jest/globals";
import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";
import {CharacterSheetSpellMaterials as Materials} from "../../../js/charactersheet/charactersheet-spell-materials.js";

const State = globalThis.CharacterSheetState;
const Spells = globalThis.CharacterSheetSpells;
const pool = [...fs.readdirSync("data/spells")].filter(file => /^spells-.*\.json$/.test(file))
	.flatMap(file => JSON.parse(fs.readFileSync(`data/spells/${file}`, "utf8")).spell || []);
const find = (name, source = "XPHB") => pool.find(row => row.name === name && row.source === source);
globalThis.document ||= {addEventListener () {}, getElementById () { return null; }, querySelector () { return null; }, querySelectorAll () { return []; }};

function harness (name = "Gentle Repose", source = "XPHB", level = null) {
	const spell = {...find(name, source), ...(level == null ? {} : {level})};
	const state = new State();
	state.setId("currency-caster");
	state.addClass({name: "Wizard", source: "XPHB", level: 15, spellcastingAbility: "int"});
	state.addSpell({...spell, ritual: !!spell.meta?.ritual, sourceClass: "Wizard", sourceClassSource: "XPHB"}, true);
	state.calculateSpellSlots();
	const page = {getState: () => state, saveCharacter: jest.fn(), renderCharacter: jest.fn(), _renderQuickSpells: jest.fn()};
	const spells = Object.assign(Object.create(Spells.prototype), {_state: state, _page: page, _allSpells: [spell], renderSlots: jest.fn(), _updateConcentrationUI: jest.fn(), _refreshSorceryPointUI: jest.fn()});
	const permission = jest.spyOn(spells, "_pConfirmMaterialPermission").mockResolvedValue(false);
	return {
		state,
		spell,
		page,
		spells,
		permission,
		cast: () => spells._castSpell(state.getSpells()[0].id, {withMetamagic: false, decision: {autoSlot: true, castAsRitual: false, skipComponentPrompt: true}}),
		prepare: () => spells._pConsumeMaterialComponent({spell, spellData: spell, materialContext: spells._createMaterialContext(), isPrepareOnly: true, isRequired: true}),
	};
}

afterEach(() => jest.restoreAllMocks());

describe("currency is a payment source, not a generated inventory product", () => {
	it("projects exact totals, explicit OR routes and physical-only catalog leaves", () => {
		const detect = Materials.getRequirements(find("Detect Thoughts"))[0];
		const repose = Materials.getRequirements(find("Gentle Repose"))[0];
		const courier = Materials.getRequirements(find("Galder's Speedy Courier", "LLK"))[0];
		expect(detect).toMatchObject({kind: "currency", cost: 1, consume: false});
		expect(repose).toMatchObject({kind: "currency", cost: 2, consume: true, quantity: 1});
		expect(courier).toMatchObject({kind: "choice", options: [{kind: "currency", cost: 2500}, {kind: "item", name: "Mineral Goods", cost: 2500, priceScope: "total"}]});
		expect(Materials.buildCatalog([find("Detect Thoughts"), find("Gentle Repose")])).toEqual([]);
		expect(Materials.buildCatalog([find("Galder's Speedy Courier", "LLK")])).toMatchObject([{name: "Mineral Goods (25 gp total)", value: 2500}]);
		expect(Materials.getRequirements(find("Detect Thoughts", "PHB"))).toEqual([]);
		expect(Materials.getRequirements(find("Gentle Repose", "PHB"))).toEqual([]);
	});

	it("never substitutes money for priced gems or qualified coins", () => {
		const state = new State();
		state.setCurrency("gp", 10000);
		for (const spell of [find("Simulacrum"), {name: "Qualified", source: "Brew", components: {m: {text: "a coin previously possessed by the target and a crown worth 800 GP", cost: 80000, consume: true}}}]) {
			const [requirement] = Materials.getRequirements(spell);
			expect(requirement.kind).toBe("item");
			expect(Materials.getMissing(state, [requirement])).toHaveLength(1);
		}
	});

	it.each([
		["Draconic Transformation", "FTD", "Dragon Statuette"],
		["Fizban's Platinum Shield", "FTD", "Platinum-plated Dragon Scale"],
		["Summon Draconic Spirit", "FTD", "Dragon-engraved Object"],
	])("gives %s a factual reusable name and keeps saved complete identities", (name, source, expected) => {
		const spell = find(name, source);
		const [requirement] = Materials.getRequirements(spell);
		expect(requirement).toMatchObject({name: expected, cost: 50000, manual: false, consume: false});
		const state = new State();
		const material = `set:${spell.components.m.text.toLowerCase()}`;
		state.addItem({name: `${name} Material Set`, source, value: 50000, spellComponent: {key: `${material}|50000`, material, spells: [`${name}|${source}`]}});
		const loaded = new State();
		loaded.loadFromJson(state.toJson());
		expect(Materials.getMissing(loaded, [requirement])).toEqual([]);
		loaded.addItem({name: expected, source: "Custom", value: 50000});
		expect(loaded.getSpellMaterialCandidates(requirement)).toHaveLength(2);
	});

	it("retains complete bundle prices, alternatives and unknown target quantities", () => {
		const linked = find("Linked Glyphs", "AitFR-AVT");
		expect(Materials.getRequirements(linked)).toMatchObject([{name: "Incense and Powdered Diamond", cost: 30000, priceScope: "total", consume: true, timing: "cast", manual: false}]);
		expect(Materials.buildCatalog([linked])).toMatchObject([{name: "Incense and Powdered Diamond (300 gp total)", value: 30000}]);
		for (const name of ["Astral Projection", "Create Undead"]) {
			for (const source of ["PHB", "XPHB"]) expect(Materials.getRequirements(find(name, source))[0]).toMatchObject({manual: true, cost: 0, text: find(name, source).components.m.text});
		}
		expect(Materials.buildCatalog(pool).some(row => /Material Set/.test(row.name))).toBe(false);
	});
});

describe("canonical wallet-backed casting", () => {
	it("casts an actual 7cp material through the ordinary spell payment path", async () => {
		const {state, spell, cast} = harness();
		spell.components = {m: {text: "7 Copper Pieces, which the spell consumes", cost: 7, consume: true}};
		state.setCurrency("cp", 10);
		await cast();
		expect(state.getCurrency("cp")).toBe(3);
		expect(state.getSpellSlotsCurrent(2)).toBe(2);
	});

	it.each([true, false, null])("requires opt-in for optional currency consumption: %s", async approved => {
		const {state, spell, cast} = harness();
		spell.components = {m: {text: "7 Copper Pieces, which the spell consumes", cost: 7, consume: "optional"}};
		state.setCurrency("sp", 1);
		const wallet = state._data.currency;
		const prompt = jest.spyOn(InputUiUtil, "pGetUserBoolean").mockResolvedValue(approved);
		await cast();
		expect(prompt).toHaveBeenCalledWith(expect.objectContaining({title: "Gentle Repose — Consume Currency?", textNo: "Keep it"}));
		expect(Math.round(state.getTotalGold() * 100)).toBe(approved ? 3 : 10);
		if (!approved) expect(state._data.currency).toBe(wallet);
		expect(state.getSpellSlotsCurrent(2)).toBe(2);
	});

	it("checks reusable currency using total value without exchanging or mutating wallet", async () => {
		const {state, cast, permission} = harness("Detect Thoughts");
		state.setCurrency("pp", 1);
		const wallet = state._data.currency;
		const before = state.getCurrency();
		await cast();
		expect(state.getCurrency()).toEqual(before);
		expect(state._data.currency).toBe(wallet);
		expect(state.getSpellSlotsCurrent(2)).toBe(2);
		expect(permission).not.toHaveBeenCalled();
		expect(state.getInventory()).toEqual([]);
	});

	describe("canonical deductGold exact-copper arithmetic", () => {
		it("deducts 7cp from a copper balance without binary-float ceil overcharging", () => {
			const state = new State();
			state.setCurrency("cp", 100);
			expect(state.deductGold(0.07)).toEqual({success: true});
			expect(state.getCurrency("cp")).toBe(93);
		});

		it("directly debits 1..100cp, mixed balances and exact funds without candidate guards", () => {
			for (const currency of [{cp: 100}, {cp: 3, sp: 4, ep: 1, gp: 0.12}, {cp: 9, sp: 9, ep: 1, gp: 1, pp: 2}]) {
				for (let costCp = 1; costCp <= 100; ++costCp) {
					const state = new State();
					Object.entries(currency).forEach(([type, value]) => state.setCurrency(type, value));
					const beforeCp = Math.round(state.getTotalGold() * 100);
					expect(state.deductGold(costCp / 100)).toEqual({success: true});
					expect(Math.round(state.getTotalGold() * 100)).toBe(beforeCp - costCp);
				}
			}
			const state = new State();
			state.setCurrency("pp", 1);
			state.setCurrency("gp", 1);
			expect(state.deductGold(1.02)).toEqual({success: true});
			expect(state.getCurrency()).toEqual({cp: 0, sp: 0, ep: 0, gp: 9.98, pp: 0});
			expect(state.deductGold(9.98)).toEqual({success: true});
			expect(state.getTotalGold()).toBe(0);
		});

		it("does not mutate insufficient or nonrepresentable payments, including positive sub-copper costs", () => {
			const state = new State();
			state.setCurrency("cp", 6);
			const wallet = state._data.currency;
			const before = state.toJson();
			for (const cost of [0.07, 0.001, NaN, Infinity, -1]) {
				expect(state.deductGold(cost)).toMatchObject({success: false, error: expect.any(String)});
				expect(state.toJson()).toEqual(before);
				expect(state._data.currency).toBe(wallet);
			}
		});
	});

	it.each([null, 0])("consumes exactly 2cp with automatic exchange, level override %s", async level => {
		const {state, cast, permission, spell} = harness("Gentle Repose", "XPHB", level);
		state.setCurrency("sp", 1);
		await cast();
		expect(state.getTotalGold()).toBeCloseTo(0.08);
		expect(state.getCurrency()).toEqual({cp: 0, sp: 0, ep: 0, gp: 0.08, pp: 0});
		await cast();
		expect(state.getTotalGold()).toBeCloseTo(0.06);
		expect(state.getInventory()).toEqual([]);
		expect(permission).not.toHaveBeenCalled();
		if (spell.level) expect(state.getSpellSlotsCurrent(2)).toBe(1);
	});

	it("charges a ritual's currency once without spending a slot", async () => {
		const {state, spells, permission} = harness();
		state.setCurrency("cp", 3);
		const slots = state.getSpellSlotsCurrent(2);
		await spells._castSpellAsRitual(state.getSpells()[0].id);
		expect(state.getCurrency("cp")).toBe(1);
		expect(state.getSpellSlotsCurrent(2)).toBe(slots);
		expect(permission).not.toHaveBeenCalled();
	});

	it("cancels insufficient funds with precise copy and asks fresh after a material-only override", async () => {
		const {state, cast, permission} = harness();
		state.setCurrency("cp", 1);
		const before = state.toJson();
		await cast();
		expect(state.toJson()).toEqual(before);
		expect(permission.mock.calls[0][0].htmlDescription).toContain("Wallet balance: 1 cp");
		permission.mockResolvedValueOnce(true);
		await cast();
		expect(state.getCurrency("cp")).toBe(1);
		expect(state.getSpellSlotsCurrent(2)).toBe(2);
		permission.mockClear();
		await cast();
		expect(permission).toHaveBeenCalledTimes(1);
		expect(state.getSpellSlotsCurrent(2)).toBe(2);
	});

	it.each(["wallet", "goods", "cancel"])("uses only the selected Courier branch: %s", async branch => {
		const {state, spell, cast, permission} = harness("Galder's Speedy Courier", "LLK");
		state.setCurrency("gp", 25);
		state.addItem(Materials.buildCatalog([spell])[0]);
		const id = state.getInventory()[0].id;
		const before = state.toJson();
		jest.spyOn(CharacterSheetModal, "pGetUserEnum").mockImplementation(async ({values}) =>
			branch === "cancel" ? null : values.find(row => row.requirement.kind === (branch === "wallet" ? "currency" : "item")));
		await cast();
		expect(permission).not.toHaveBeenCalled();
		if (branch === "cancel") expect(state.toJson()).toEqual(before);
		else {
			expect(state.getCurrency("gp")).toBe(branch === "wallet" ? 0 : 25);
			expect(state.getInventory().some(row => row.id === id)).toBe(branch === "wallet");
		}
	});

	it.each(["state", "data", "generation", "selection"])("guards the new payment-choice await against a changed %s binding", async binding => {
		const {state, spell, page, spells, cast} = harness("Galder's Speedy Courier", "LLK");
		state.setCurrency("gp", 25);
		state.addItem(Materials.buildCatalog([spell])[0]);
		const raw = state._data;
		const before = state.toJson();
		const other = new State();
		const otherBefore = other.toJson();
		jest.spyOn(CharacterSheetModal, "pGetUserEnum").mockImplementation(async ({values}) => {
			if (binding === "state") spells._state = other;
			if (binding === "data") state._data = other._data;
			if (binding === "generation") page._characterLoadGeneration = 1;
			if (binding === "selection") page._currentCharacterId = "other";
			return values.find(row => row.requirement.kind === "currency");
		});
		await cast();
		expect(raw).toEqual(before);
		expect(other.toJson()).toEqual(otherBefore);
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});

	it("keeps an exact saved coin stack as an explicit alternative, not a wallet debit", async () => {
		const {state, cast} = harness();
		state.setCurrency("gp", 10);
		state.addItem({name: "Copper Piece (0.01 gp)", source: "XPHB", value: 1, spellComponent: {key: "copper piece|1", material: "copper piece", spells: ["Gentle Repose|XPHB"]}}, 3);
		const loaded = new State();
		loaded.loadFromJson(state.toJson());
		state._data = loaded._data;
		jest.spyOn(CharacterSheetModal, "pGetUserEnum").mockImplementation(async ({values}) => values.find(row => row.requirement.legacyOnly));
		await cast();
		expect(state.getCurrency("gp")).toBe(10);
		expect(state.getInventory()[0].quantity).toBe(1);
		const [requirement] = Materials.getRequirements(find("Gentle Repose"));
		const wrong = new State();
		wrong.addItem({...state.getInventory()[0].item, source: "Brew"});
		expect(Materials.getMissing(wrong, [requirement])).toHaveLength(1);
	});

	it("accepts the exact old Courier whole set without minting money or duplicating ingredient credit", async () => {
		const {state, spell, cast, permission} = harness("Galder's Speedy Courier", "LLK");
		const material = `set:${spell.components.m.text.toLowerCase()}`;
		state.addItem({name: "Galder's Speedy Courier Material Set", source: "LLK", value: 2500, spellComponent: {key: `${material}|2500`, material, spells: ["Galder's Speedy Courier|LLK"]}});
		await cast();
		expect(state.getInventory()).toEqual([]);
		expect(state.getTotalGold()).toBe(0);
		expect(permission).not.toHaveBeenCalled();
	});

	it.each(["funds", "state", "data", "cancel"])("preserves payments across result failure: %s", async reason => {
		const {state, spells, cast, page} = harness();
		state.setCurrency("gp", 1);
		const original = state._data;
		const other = new State();
		const otherBefore = other.toJson();
		jest.spyOn(spells, "_showCastResult").mockImplementation(async () => {
			if (reason === "funds") state.setCurrency("gp", 0);
			if (reason === "state") spells._state = other;
			if (reason === "data") state._data = other._data;
			return {cancelled: reason === "cancel"};
		});
		await cast();
		expect(original.spellcasting.spellSlots[2].current).toBe(3);
		expect(original.currency.gp).toBe(reason === "funds" ? 0 : 1);
		expect(other.toJson()).toEqual(otherBefore);
		expect(page.saveCharacter).not.toHaveBeenCalled();
	});

	it("does not switch a vanished selected goods source to an available wallet", async () => {
		const {state, spell, spells, cast} = harness("Galder's Speedy Courier", "LLK");
		state.setCurrency("gp", 25);
		state.addItem(Materials.buildCatalog([spell])[0]);
		jest.spyOn(CharacterSheetModal, "pGetUserEnum").mockImplementation(async ({values}) => values.find(row => row.requirement.kind === "item"));
		jest.spyOn(spells, "_showCastResult").mockImplementation(async () => {
			state.removeItem(state.getInventory()[0].id);
			return {cancelled: false};
		});
		await cast();
		expect(state.getCurrency("gp")).toBe(25);
		expect(state.getSpellSlotsCurrent(4)).toBe(3);
	});

	it("does not silently replace a reusable supply captured before the result await", async () => {
		const {state, spell, spells, cast} = harness("Draconic Transformation", "FTD");
		const supply = Materials.buildCatalog([spell])[0];
		state.addItem(supply);
		const originalId = state.getInventory()[0].id;
		const slots = state.getSpellSlotsCurrent(7);
		jest.spyOn(spells, "_showCastResult").mockImplementation(async () => {
			state.removeItem(originalId);
			state.addItem(supply);
			return {cancelled: false};
		});
		await cast();
		expect(state.getSpellSlotsCurrent(7)).toBe(slots);
		expect(state.getInventory()).toHaveLength(1);
		expect(state.getInventory()[0].id).not.toBe(originalId);
	});

	it("rejects a second commit of a staged wallet payment", async () => {
		const {state, prepare} = harness();
		state.setCurrency("cp", 4);
		const staged = await prepare();
		staged.commit();
		expect(() => staged.commit()).toThrow("already been committed");
		expect(state.getCurrency("cp")).toBe(2);
	});
});

describe("detached synchronous material-payment boundary", () => {
	function paymentState () {
		const state = new State();
		state.addItem({id: "bag", name: "Bag", source: "Custom", type: "G", containerCapacity: {weight: [30]}});
		state.addItem({id: "supply", name: "Ruby Shield", source: "Custom", type: "S", ac: 2, effects: [{type: "initiative", value: 2, name: "Ruby Readiness"}]});
		state.setItemEquipped("supply", true);
		expect(state.putItemInContainer("supply", "bag")).toEqual({success: true});
		state.addItem({id: "untouched", name: "Notebook", source: "Custom"});
		state.setCurrency("cp", 1);
		state.setCurrency("sp", 1);
		return state;
	}

	it("publishes canonical last-item cleanup while preserving raw, survivor, global and runtime identities", () => {
		const state = paymentState();
		const toast = jest.spyOn(JqueryUtil, "doToast");
		const raw = state._data;
		const survivor = raw.inventory.find(row => row.id === "untouched");
		const bag = raw.inventory.find(row => row.id === "bag");
		const hooks = state._committedSpellCastHooks;
		const observer = jest.fn();
		hooks.set("observer", observer);
		const global = globalThis.__csState;
		expect(raw.namedModifiers.some(row => row.sourceFeatureId === "item:supply")).toBe(true);
		state.commitSpellMaterialPayment({itemIds: ["supply"], costCp: 2});
		expect(state._data).toBe(raw);
		expect(raw.inventory.find(row => row.id === "untouched")).toBe(survivor);
		expect(raw.inventory.find(row => row.id === "bag")).toBe(bag);
		expect(raw.inventory.some(row => row.id === "supply")).toBe(false);
		expect(bag.item.containedItems || []).not.toContain("supply");
		expect(raw.namedModifiers.some(row => row.sourceFeatureId === "item:supply")).toBe(false);
		expect(raw.ac.shield).toBe(false);
		expect(state.getTotalGold()).toBeCloseTo(0.09);
		expect(state._committedSpellCastHooks).toBe(hooks);
		expect(globalThis.__csState).toBe(global);
		expect(observer).not.toHaveBeenCalled();
		expect(toast).not.toHaveBeenCalled();
	});

	it("publishes nothing when a later candidate removal fails", () => {
		const state = paymentState();
		const toast = jest.spyOn(JqueryUtil, "doToast");
		const raw = state._data;
		const rows = [...raw.inventory];
		const before = state.toJson();
		const hooks = state._committedSpellCastHooks;
		const featureHooks = state._committedFeatureUseHooks;
		const receipts = state._improvedPotentSpellcastingReceipts;
		const observer = jest.fn();
		hooks.set("observer", observer);
		const global = globalThis.__csState;
		const consume = State.prototype.consumeItem;
		let calls = 0;
		jest.spyOn(State.prototype, "consumeItem").mockImplementation(function (id) {
			expect(this).not.toBe(state);
			expect(this._isDetached).toBe(true);
			expect(this._committedSpellCastHooks).not.toBe(hooks);
			expect(this._committedFeatureUseHooks).not.toBe(featureHooks);
			expect(this._improvedPotentSpellcastingReceipts).not.toBe(receipts);
			const result = consume.call(this, id);
			if (++calls === 2) throw new Error("late candidate failure");
			return result;
		});
		expect(() => state.commitSpellMaterialPayment({itemIds: ["supply", "untouched"], costCp: 2})).toThrow("late candidate failure");
		expect(state.toJson()).toEqual(before);
		expect(state._data).toBe(raw);
		rows.forEach((row, i) => expect(raw.inventory[i]).toBe(row));
		expect(state._committedSpellCastHooks).toBe(hooks);
		expect(state._committedFeatureUseHooks).toBe(featureHooks);
		expect(state._improvedPotentSpellcastingReceipts).toBe(receipts);
		expect(globalThis.__csState).toBe(global);
		expect(observer).not.toHaveBeenCalled();
		expect(toast).not.toHaveBeenCalled();
	});

	it("keeps a surviving consumed-stack wrapper and every unrelated companion wrapper", () => {
		const state = paymentState();
		state.setItemQuantity("supply", 2);
		state.addCompanion({name: "Unrelated Familiar"});
		const row = state._data.inventory.find(item => item.id === "supply");
		const companion = state._data.companions[0];
		const catalog = globalThis.__csMaterialCatalog;
		state.commitSpellMaterialPayment({itemIds: ["supply"]});
		expect(state._data.inventory.find(item => item.id === "supply")).toBe(row);
		expect(row.quantity).toBe(1);
		expect(state._data.companions[0]).toBe(companion);
		expect(globalThis.__csMaterialCatalog).toBe(catalog);
	});

	it("rejects insufficient funds before removal and never pays twice during preparation", async () => {
		const state = paymentState();
		const before = state.toJson();
		expect(() => state.commitSpellMaterialPayment({itemIds: ["supply"], costCp: 12})).toThrow("Insufficient funds");
		expect(state.toJson()).toEqual(before);
		const h = harness();
		h.state.setCurrency("cp", 3);
		const staged = await h.prepare();
		expect(h.state.getCurrency("cp")).toBe(3);
		staged.commit();
		expect(h.state.getCurrency("cp")).toBe(1);
	});

	it("reconciles integer copper payments across denomination boundaries", () => {
		for (const currency of [{cp: 100}, {cp: 3, sp: 4, ep: 1, gp: 0.12}, {cp: 9, sp: 9, ep: 1, gp: 1, pp: 2}]) {
			for (let costCp = 1; costCp <= 100; ++costCp) {
				const state = new State();
				Object.entries(currency).forEach(([type, value]) => state.setCurrency(type, value));
				const beforeCp = Math.round(state.getTotalGold() * 100);
				state.commitSpellMaterialPayment({costCp});
				expect(Math.round(state.getTotalGold() * 100)).toBe(beforeCp - costCp);
			}
		}
	});
});
