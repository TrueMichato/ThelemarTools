import fs from "node:fs";
import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;
const CharacterSheetModal = globalThis.CharacterSheetModal;

const artificerData = JSON.parse(fs.readFileSync(new URL("../../../data/class/class-artificer.json", import.meta.url), "utf8"));
const fullArtificer = {
	...artificerData.class.find(cls => cls.name === "Artificer" && cls.source === "EFA"),
	subclasses: artificerData.subclass.filter(sc => sc.className === "Artificer" && sc.classSource === "EFA"),
};

function makeCartographer ({level = 5, classSource = "EFA", subclassSource = "EFA", int = 16} = {}) {
	const state = new CharacterSheetState();
	state.setClassCatalog([fullArtificer]);
	state.addClass({
		name: "Artificer",
		source: classSource,
		level,
		subclass: {name: "Cartographer", shortName: "Cartographer", source: subclassSource},
	});
	state.setAbilityBase("int", int);
	state.setMaxHp(40);
	state.setCurrentHp(40);
	return state;
}

function makeSpellHarness (state) {
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._state = state;
	spells._page = {
		rollDice: () => 1,
		pAnimateDamageDice: jest.fn(),
	};
	return spells;
}

function makeCombatDamageHarness () {
	const rider = {
		id: "guided-precision",
		name: "Guided Precision",
		sourceFeatureUid: CharacterSheetState.GUIDED_PRECISION_FEATURE_UID,
		receiptKey: CharacterSheetState.GUIDED_PRECISION_FEATURE_UID,
		valueResolver: {type: "abilityModifier", ability: "int"},
		requiresOwnSpellTargetUid: CharacterSheetState.GUIDED_PRECISION_FAERIE_FIRE_UID,
	};
	const attack = {
		id: "atk1",
		name: "Longbow",
		damage: "1d8",
		damageType: "piercing",
		abilityMod: "dex",
		isRanged: true,
		sourceItem: {name: "Longbow", baseItem: null},
	};
	const state = {
		getAttacks: () => [attack],
		getWeaponAbilityMod: () => 3,
		getNamedModifiersByType: () => [],
		getItemWeaponScopedDamageContributions: () => [],
		getFeatureCalculations: () => ({}),
		getDeferredFlatDamageRiderOptions: () => [rider],
		consumeDeferredFlatDamageRider: () => ({...rider, value: 4}),
	};
	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	combat._selectedCunningStrikes = [];
	combat._page = {
		showDiceResult: jest.fn(),
		pAnimateDamageDice: jest.fn(),
	};
	combat._parseDamage = () => ({total: 5, sides: 8, rolls: [5]});
	combat._canApplySneakAttack = () => false;
	combat._resolveChannelRiderDamage = () => ({channelSpell: null, channelSpellRoll: null, channelSpellDamage: 0, riderMatched: false});
	combat._promptUseCombatMethod = async () => null;
	return {combat, state};
}

afterEach(() => jest.restoreAllMocks());

describe("Guided Precision provider and shared receipt", () => {
	it("is exact-source level-gated and uses the complete class-data spell UID set", () => {
		const state = makeCartographer();
		expect(state.getFeatureCalculations()).toMatchObject({
			hasGuidedPrecision: true,
			guidedPrecisionSourceFeatureUid: CharacterSheetState.GUIDED_PRECISION_FEATURE_UID,
		});

		// Stored subclass payloads can be stale or partial. Eligibility is sourced from
		// the complete canonical class catalog, including spells not yet unlocked at L5.
		state._data.classes[0].subclass.additionalSpells = [{prepared: {"3": ["fireball|xphb"]}}];
		for (const uid of [
			"faerie fire|xphb",
			"guiding bolt|xphb",
			"healing word|xphb",
			"locate object|xphb",
			"mind spike|xphb",
			"call lightning|xphb",
			"clairvoyance|xphb",
			"banishment|xphb",
			"locate creature|xphb",
			"scrying|xphb",
			"teleportation circle|xphb",
		]) {
			const [name, source] = uid.split("|");
			expect(state.getDeferredFlatDamageRiderOptions({
				route: "spell",
				spell: {name, source},
			})).toHaveLength(1);
		}
		expect(state.getDeferredFlatDamageRiderOptions({
			route: "spell",
			spell: {name: "Faerie Fire", source: "PHB"},
		})).toEqual([]);
		expect(state.getDeferredFlatDamageRiderOptions({
			route: "spell",
			spell: {name: "Fireball", source: "XPHB"},
		})).toEqual([]);

		expect(makeCartographer({level: 4}).getDeferredFlatDamageRiderOptions({route: "attack"})).toEqual([]);
		expect(makeCartographer({classSource: "TCE"}).getDeferredFlatDamageRiderOptions({route: "attack"})).toEqual([]);
		expect(makeCartographer({subclassSource: "HB"}).getDeferredFlatDamageRiderOptions({route: "attack"})).toEqual([]);
	});

	it("shares one stable once-per-turn receipt across spell and attack routes", () => {
		const state = makeCartographer();
		state.startCombat();
		const spellRider = state.getDeferredFlatDamageRiderOptions({
			route: "spell",
			spell: {name: "Guiding Bolt", source: "XPHB"},
		})[0];
		expect(state.consumeDeferredFlatDamageRider(spellRider)).toMatchObject({
			name: "Guided Precision",
			value: 3,
			receiptKey: CharacterSheetState.GUIDED_PRECISION_FEATURE_UID,
		});
		expect(state.getDeferredFlatDamageRiderOptions({route: "attack"})).toEqual([]);

		state.advanceRound();
		const attackRider = state.getDeferredFlatDamageRiderOptions({route: "attack"})[0];
		expect(state.consumeDeferredFlatDamageRider(attackRider)).toMatchObject({value: 3});
		expect(state.getDeferredFlatDamageRiderOptions({
			route: "spell",
			spell: {name: "Mind Spike", source: "XPHB"},
		})).toEqual([]);
	});

	it("keeps the opposite route blocked until the canonical turn reset runs", () => {
		const state = makeCartographer();
		state.startCombat();
		const spellRider = state.getDeferredFlatDamageRiderOptions({
			route: "spell",
			spell: {name: "Guiding Bolt", source: "XPHB"},
		})[0];
		state.consumeDeferredFlatDamageRider(spellRider);

		expect(state.getDeferredFlatDamageRiderOptions({route: "attack"})).toEqual([]);
		expect(state.getCombatRound()).toBe(1);

		state.resetTurnEconomy();

		expect(state.getCombatRound()).toBe(1);
		expect(state.getDeferredFlatDamageRiderOptions({route: "attack"})).toHaveLength(1);
	});

	it("persists the receipt through save/load and releases it on the next turn", () => {
		const state = makeCartographer();
		state.startCombat();
		state.consumeDeferredFlatDamageRider(state.getDeferredFlatDamageRiderOptions({route: "attack"})[0]);

		const loaded = new CharacterSheetState();
		loaded.loadFromJson(state.toJson());
		loaded.setClassCatalog([fullArtificer]);
		expect(loaded.getDeferredFlatDamageRiderOptions({route: "attack"})).toEqual([]);
		loaded.advanceRound();
		expect(loaded.getDeferredFlatDamageRiderOptions({route: "attack"})).toHaveLength(1);
	});

	it("tears down eligibility and the source-keyed receipt when the subclass is removed", () => {
		const state = makeCartographer();
		state.startCombat();
		state.consumeDeferredFlatDamageRider(state.getDeferredFlatDamageRiderOptions({route: "attack"})[0]);
		state.setConcentration({name: "Faerie Fire", source: "XPHB", level: 1});
		expect(state.getDamageConcentrationProtection()).toBeTruthy();

		state.setSubclass("Artificer", null);
		expect(state.getDeferredFlatDamageRiderOptions({route: "attack"})).toEqual([]);
		expect(state.getDamageConcentrationProtection()).toBeNull();
		expect(state.queryTurnReceipt(CharacterSheetState.GUIDED_PRECISION_FEATURE_UID).used).toBe(false);
	});
});

describe("Guided Precision damage consumers", () => {
	it("requires explicit own-Faerie-Fire confirmation and decline/cancel do not consume", async () => {
		const state = makeCartographer();
		state.startCombat();
		const combat = Object.create(CharacterSheetCombat.prototype);
		combat._state = state;
		const prompt = jest.spyOn(CharacterSheetModal, "pGetUserBoolean");

		prompt.mockResolvedValueOnce(false);
		expect(await combat._pSelectDeferredFlatDamageRiderForAttack({name: "Longbow"})).toBeNull();
		expect(state.getDeferredFlatDamageRiderOptions({route: "attack"})).toHaveLength(1);

		prompt.mockResolvedValueOnce(null);
		expect(await combat._pSelectDeferredFlatDamageRiderForAttack({name: "Longbow"})).toBeNull();
		expect(state.getDeferredFlatDamageRiderOptions({route: "attack"})).toHaveLength(1);

		prompt.mockResolvedValueOnce(true);
		const accepted = await combat._pSelectDeferredFlatDamageRiderForAttack({name: "Longbow"});
		expect(prompt.mock.calls[2][0].htmlDescription).toMatch(/your own Faerie Fire/i);
		expect(state.consumeDeferredFlatDamageRider(accepted)).toMatchObject({value: 3});
		expect(state.getDeferredFlatDamageRiderOptions({route: "attack"})).toEqual([]);
	});

	it("folds the accepted attack rider into the canonical weapon damage result", async () => {
		const {combat} = makeCombatDamageHarness();
		jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(true);
		await combat._rollDamage("atk1");

		expect(combat._page.showDiceResult).toHaveBeenCalledWith(expect.objectContaining({
			modifier: 7,
			total: 12,
			subtitle: expect.stringMatching(/Guided Precision/),
		}));
	});

	it("cancelling a multi-roll choice does not consume, then applies current INT to the selected roll", async () => {
		const state = makeCartographer({int: 16});
		state.startCombat();
		const spells = makeSpellHarness(state);
		const spell = {name: "Guiding Bolt", source: "XPHB", level: 1};
		const spellData = {
			name: "Twofold Bolt",
			level: 1,
			damageInflict: ["fire", "cold"],
			entries: ["The target takes {@damage 1d6} fire damage and {@damage 2d6} cold damage."],
		};
		const booleanPrompt = jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(true);
		const enumPrompt = jest.spyOn(CharacterSheetModal, "pGetUserEnum");

		enumPrompt.mockResolvedValueOnce(null);
		expect(await spells._pSelectDeferredFlatDamageRiderForSpell({spell, spellData})).toBeNull();
		expect(state.getDeferredFlatDamageRiderOptions({route: "attack"})).toHaveLength(1);

		enumPrompt.mockImplementationOnce(async ({values}) => values[1]);
		const accepted = await spells._pSelectDeferredFlatDamageRiderForSpell({spell, spellData});
		expect(accepted.damageRollIndex).toBe(1);
		state.setAbilityBase("int", 18);

		const result = spells._rollSpellDamage(spellData, 1, 1, null, spell, accepted);
		expect(booleanPrompt).toHaveBeenCalledTimes(2);
		expect(result.total).toBe(7);
		expect(result.damageRolls).toEqual([
			expect.objectContaining({index: 0, total: 1, damageType: "fire", deferredFlatDamageRider: null}),
			expect.objectContaining({
				index: 1,
				total: 6,
				damageType: "cold",
				deferredFlatDamageRider: expect.objectContaining({name: "Guided Precision", value: 4}),
			}),
		]);
		expect(state.getDeferredFlatDamageRiderOptions({route: "attack"})).toEqual([]);
	});
});

describe("Guided Precision Faerie Fire concentration protection", () => {
	it("is exact-spell/source scoped and preserves ordinary concentration endings", () => {
		const state = makeCartographer();
		state.setConcentration({name: "Faerie Fire", source: "XPHB", level: 1});
		expect(state.getDamageConcentrationProtection()).toMatchObject({
			name: "Guided Precision",
			spellUid: "faerie fire|xphb",
		});

		state.setConcentration({name: "Faerie Fire", source: "PHB", level: 1});
		expect(state.getDamageConcentrationProtection()).toBeNull();
		state.setConcentration({name: "Faerie Fire", level: 1});
		expect(state.getDamageConcentrationProtection()).toBeNull();
		state.setConcentration({name: "Call Lightning", source: "XPHB", level: 3});
		expect(state.getDamageConcentrationProtection()).toBeNull();

		state.setConcentration({name: "Faerie Fire", source: "XPHB", level: 1});
		state.breakConcentration();
		expect(state.getConcentration()).toBeNull();

		state.setConcentration({name: "Faerie Fire", source: "XPHB", level: 1});
		state.setConcentration({name: "Haste", source: "XPHB", level: 3});
		expect(state.getConcentration().spellName).toBe("Haste");
		expect(state.getDamageConcentrationProtection()).toBeNull();

		state.setConcentration({name: "Faerie Fire", source: "XPHB", level: 1});
		state._resolveConditionEffects = jest.fn().mockReturnValue({effects: [{type: "incapacitated", value: true}]});
		state.addCondition({name: "Stunned", source: "XPHB"});
		expect(state.getConcentration()).toBeNull();

		state.setConcentration({name: "Faerie Fire", source: "XPHB", level: 1});
		state.setDeathSaveFailures(3);
		state.breakConcentration();
		expect(state.isDead()).toBe(true);
		expect(state.getConcentration()).toBeNull();
	});
});
