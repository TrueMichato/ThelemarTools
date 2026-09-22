import {jest} from "@jest/globals";
import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetSpells = globalThis.CharacterSheetSpells;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFICER_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/class/class-artificer.json"),
	"utf8",
));
const CHEMICAL_MASTERY = ARTIFICER_DATA.subclassFeature.find(feature =>
	feature.name === "Chemical Mastery"
	&& feature.source === "EFA"
	&& feature.className === "Artificer"
	&& feature.classSource === "EFA"
	&& feature.subclassShortName === "Alchemist"
	&& feature.subclassSource === "EFA"
	&& feature.level === 15,
);
const TCE_CHEMICAL_MASTERY = ARTIFICER_DATA.subclassFeature.find(feature =>
	feature.name === "Chemical Mastery"
	&& feature.source === "TCE"
	&& feature.className === "Artificer"
	&& feature.classSource === "TCE"
	&& feature.subclassShortName === "Alchemist"
	&& feature.subclassSource === "TCE"
	&& feature.level === 15,
);

const copy = value => JSON.parse(JSON.stringify(value));

function makeState ({
	classSource = "EFA",
	level = 15,
	subclassName = "Alchemist",
	subclassSource = "EFA",
	feature = CHEMICAL_MASTERY,
} = {}) {
	const state = new CharacterSheetState();
	state.addClass({
		name: "Artificer",
		source: classSource,
		level,
		subclass: subclassName
			? {name: subclassName, shortName: subclassName, source: subclassSource}
			: null,
	});
	if (feature) {
		state.addFeature({
			...copy(feature),
			featureType: "Subclass Feature",
			isSubclassFeature: true,
		});
	}
	return state;
}

function makeReceipt ({
	committed = true,
	castingClassUid = "Artificer|EFA",
	castingSubclassUid = null,
	damage = [{damageType: "acid", amount: 8}],
	targets = [{targetId: "target-1", targetName: "Goblin", outcome: "damaged"}],
	resolution = "confirmed",
	castType = "slot",
} = {}) {
	return {
		receiptVersion: 1,
		receiptId: "spell-cast-test",
		ok: true,
		committed,
		castingClassUid,
		castingSubclassUid,
		spellUid: "Acid Arrow|XPHB",
		spell: {name: "Acid Arrow", source: "XPHB", level: 2},
		castType,
		damageEvidence: damage == null
			? null
			: {version: 1, resolution, damage, targets},
	};
}

function forceRoll (total = 9) {
	return jest.fn(async () => ({dice: "2d8", damageType: "force", total}));
}

function makeSpells (state, {rollTotal = 9} = {}) {
	const page = {
		_rollHistory: {addRoll: jest.fn()},
		_renderQuickSpells: jest.fn(),
		_renderResources: jest.fn(),
		_renderActiveStates: jest.fn(),
		_combat: {render: jest.fn()},
	};
	const spells = Object.create(CharacterSheetSpells.prototype);
	spells._state = state;
	spells._page = page;
	spells.render = jest.fn();
	spells._rollDamageDiceDetailed = jest.fn(() => ({total: rollTotal}));
	return {spells, page};
}

function addArtificerTool (state) {
	state.addItem({
		id: "alchemist-tools",
		name: "Alchemist's Supplies",
		source: "PHB",
		type: "AT",
		quantity: 1,
		_isCustom: true,
	});
	state.setItemEquipped("alchemist-tools", true);
	state.addToolProficiency("Alchemist's Supplies");
	return state.getInventory().find(row => row.id === "alchemist-tools");
}

beforeEach(() => {
	jest.clearAllMocks();
});

describe("EFA Alchemist Alchemical Eruption eligibility", () => {
	it.each(["acid", "fire", "poison"])("uses exactly 2d8 Force after committed %s damage", async damageType => {
		const state = makeState();
		state.startCombat();
		const fnRollDamage = forceRoll(10);

		const result = await state.pUseAlchemicalEruption({
			receipt: makeReceipt({damage: [{damageType, amount: 12}]}),
			target: {targetId: "target-1", targetName: "Goblin"},
			fnRollDamage,
		});

		expect(result).toEqual(expect.objectContaining({
			ok: true,
			committed: true,
			status: "used",
			manuallyResolved: false,
			damage: {dice: "2d8", damageType: "force", total: 10},
		}));
		expect(fnRollDamage).toHaveBeenCalledTimes(1);
	});

	it.each([
		["Necrotic final damage", makeReceipt({damage: [{damageType: "necrotic", amount: 8}]}), "wrongDamageType"],
		["cancelled/uncommitted cast", makeReceipt({committed: false}), "uncommitted"],
		["missing damage evidence", makeReceipt({damage: null}), "noDamageEvidence"],
		["zero damage", makeReceipt({damage: [{damageType: "acid", amount: 0}]}), "noDamageEvidence"],
		["miss", makeReceipt({targets: [{targetId: "target-1", targetName: "Goblin", outcome: "miss"}]}), "noTargetDamaged"],
		["no-damage target", makeReceipt({targets: [{targetId: "target-1", targetName: "Goblin", outcome: "noDamage"}]}), "noTargetDamaged"],
	])("rejects %s without rolling", async (_label, receipt, reason) => {
		const state = makeState();
		state.startCombat();
		const fnRollDamage = forceRoll();

		const result = await state.pUseAlchemicalEruption({
			receipt,
			target: {targetId: "target-1", targetName: "Goblin"},
			fnRollDamage,
		});

		expect(result).toEqual(expect.objectContaining({ok: false, committed: false, reason}));
		expect(fnRollDamage).not.toHaveBeenCalled();
	});

	it.each([
		["wrong class", "Wizard|XPHB"],
		["wrong class source", "Artificer|TCE"],
		["item cast without exact Artificer ownership", null],
	])("rejects wrong casting class ownership before rolling: %s", async (_label, castingClassUid) => {
		const state = makeState();
		state.startCombat();
		const fnRollDamage = forceRoll();

		const result = await state.pUseAlchemicalEruption({
			receipt: makeReceipt({castingClassUid, castType: "item"}),
			target: {targetId: "target-1", targetName: "Goblin"},
			fnRollDamage,
		});

		expect(result).toEqual(expect.objectContaining({ok: false, reason: "wrongCastingClass"}));
		expect(fnRollDamage).not.toHaveBeenCalled();
	});

	it("rejects a mismatched exact casting subclass", () => {
		const state = makeState();
		expect(state.getAlchemicalEruptionEligibility(makeReceipt({
			castingSubclassUid: "Artillerist|EFA",
		}))).toEqual(expect.objectContaining({eligible: false, reason: "wrongCastingSubclass"}));
	});

	it.each([
		["below level", {level: 14}, "belowLevel"],
		["another EFA subclass", {subclassName: "Artillerist"}, "wrongSubclass"],
		["TCE compatibility Alchemist", {
			subclassSource: "TCE",
			feature: TCE_CHEMICAL_MASTERY,
		}, "wrongSubclass"],
		["wrong parent source", {classSource: "TCE"}, "wrongClass"],
	])("rejects %s ownership", (_label, options, reason) => {
		const state = makeState(options);
		expect(state.getAlchemicalEruptionEligibility(makeReceipt()))
			.toEqual(expect.objectContaining({eligible: false, reason}));
	});
});

describe("EFA Alchemist Alchemical Eruption targeting and turn use", () => {
	it("chooses and confirms exactly one creature from multiple tracked target candidates", async () => {
		const state = makeState();
		state.startCombat();
		const {spells, page} = makeSpells(state, {rollTotal: 11});
		const targets = [
			{targetId: "goblin-a", targetName: "Goblin A", outcome: "unconfirmed"},
			{targetId: "goblin-b", targetName: "Goblin B", outcome: "unconfirmed"},
		];
		const enumSpy = jest.spyOn(globalThis.CharacterSheetModal, "pGetUserEnum")
			.mockResolvedValue(targets[1]);

		try {
			const result = await spells._pHandleAlchemicalEruption(makeReceipt({targets}));
			expect(result).toEqual(expect.objectContaining({
				status: "used",
				target: {targetId: "goblin-b", targetName: "Goblin B"},
				damage: {dice: "2d8", damageType: "force", total: 11},
			}));
			expect(spells._rollDamageDiceDetailed).toHaveBeenCalledTimes(1);
			expect(spells._rollDamageDiceDetailed).toHaveBeenCalledWith("2d8");
			expect(page._rollHistory.addRoll).toHaveBeenCalledWith(expect.objectContaining({total: 11}));
			expect(page._combat.render).toHaveBeenCalledTimes(1);
		} finally {
			enumSpy.mockRestore();
		}
	});

	it("declines without rolling or consuming the tracked turn use", async () => {
		const state = makeState();
		state.startCombat();
		const {spells} = makeSpells(state);
		const boolSpy = jest.spyOn(globalThis.CharacterSheetModal, "pGetUserBoolean")
			.mockResolvedValue(false);

		try {
			const result = await spells._pHandleAlchemicalEruption(makeReceipt());
			expect(result).toEqual({status: "declined"});
			expect(spells._rollDamageDiceDetailed).not.toHaveBeenCalled();
			expect(state.getAlchemicalEruptionEligibility(makeReceipt()).eligible).toBe(true);
		} finally {
			boolSpy.mockRestore();
		}
	});

	it("rejects a second use in the same tracked turn and restores it next turn", async () => {
		const state = makeState();
		state.startCombat();
		const receipt = makeReceipt();
		const input = {
			receipt,
			target: {targetId: "target-1", targetName: "Goblin"},
			fnRollDamage: forceRoll(),
		};

		const firstUse = await state.pUseAlchemicalEruption(input);
		expect(firstUse).toEqual(expect.objectContaining({
			ok: true,
			turnReceipt: expect.objectContaining({
				key: CharacterSheetState.EFA_ALCHEMICAL_ERUPTION_TURN_RECEIPT_KEY,
				ownerUid: CharacterSheetState.EFA_ALCHEMICAL_ERUPTION_UID,
				sourceUid: CharacterSheetState.EFA_ALCHEMIST_OWNER_UID,
				actionUid: CharacterSheetState.EFA_ALCHEMICAL_ERUPTION_ACTION_UID,
			}),
		}));
		expect(state.queryTurnReceipt(CharacterSheetState.EFA_ALCHEMICAL_ERUPTION_TURN_RECEIPT_KEY))
			.toEqual(expect.objectContaining({used: true, receipt: firstUse.turnReceipt}));
		expect(await state.pUseAlchemicalEruption({...input, fnRollDamage: forceRoll()}))
			.toEqual(expect.objectContaining({ok: false, reason: "alreadyUsedThisTurn"}));

		state.advanceRound();
		expect(await state.pUseAlchemicalEruption({...input, fnRollDamage: forceRoll()}))
			.toEqual(expect.objectContaining({ok: true}));
	});

	it("clears tracked use on combat reset", async () => {
		const state = makeState();
		state.startCombat();
		const receipt = makeReceipt();
		await state.pUseAlchemicalEruption({
			receipt,
			target: {targetId: "target-1", targetName: "Goblin"},
			fnRollDamage: forceRoll(),
		});

		state.endCombat();
		state.startCombat();
		expect(state.getAlchemicalEruptionEligibility(receipt).eligible).toBe(true);
	});

	it("requires explicit outside-combat confirmation and marks the result manually resolved", async () => {
		const state = makeState();
		const receipt = makeReceipt({targets: []});
		const target = {targetName: "Ogre"};
		const fnRollDamage = forceRoll(8);

		expect(await state.pUseAlchemicalEruption({receipt, target, fnRollDamage}))
			.toEqual(expect.objectContaining({ok: false, reason: "manualConfirmationRequired"}));
		expect(fnRollDamage).not.toHaveBeenCalled();

		const result = await state.pUseAlchemicalEruption({
			receipt,
			target,
			manualConfirmed: true,
			fnRollDamage,
		});
		expect(result).toEqual(expect.objectContaining({
			ok: true,
			manuallyResolved: true,
			target: {targetId: null, targetName: "Ogre"},
			turnReceipt: null,
		}));
		expect(state.queryTurnReceipt(CharacterSheetState.EFA_ALCHEMICAL_ERUPTION_TURN_RECEIPT_KEY).used).toBe(false);
	});

	it("resolves the outside-combat UI path only after a named target and manual-limit confirmation", async () => {
		const state = makeState();
		const {spells} = makeSpells(state, {rollTotal: 7});
		const stringSpy = jest.spyOn(globalThis.CharacterSheetModal, "pGetUserString")
			.mockResolvedValue("Ogre");
		const boolSpy = jest.spyOn(globalThis.CharacterSheetModal, "pGetUserBoolean")
			.mockResolvedValue(true);

		try {
			const result = await spells._pHandleAlchemicalEruption(makeReceipt({targets: []}));
			expect(result).toEqual(expect.objectContaining({
				ok: true,
				manuallyResolved: true,
				target: {targetId: null, targetName: "Ogre"},
			}));
			expect(stringSpy).toHaveBeenCalledTimes(1);
			expect(boolSpy).toHaveBeenCalledWith(expect.objectContaining({
				title: "Chemical Mastery — Manual Resolution",
			}));
		} finally {
			stringSpy.mockRestore();
			boolSpy.mockRestore();
		}
	});

	it("preserves the current tracked-turn receipt through save/load and releases it on reset", async () => {
		const state = makeState();
		state.startCombat();
		const receipt = makeReceipt();
		await state.pUseAlchemicalEruption({
			receipt,
			target: {targetId: "target-1", targetName: "Goblin"},
			fnRollDamage: forceRoll(),
		});

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expect(loaded.isInCombat()).toBe(true);
		expect(loaded.getAlchemicalEruptionEligibility(receipt))
			.toEqual(expect.objectContaining({eligible: false, reason: "alreadyUsedThisTurn"}));

		loaded.resetTurnEconomy();
		expect(loaded.getAlchemicalEruptionEligibility(receipt).eligible).toBe(true);
	});
});

describe("committed spell damage evidence and failure isolation", () => {
	it("keeps final transformed and mixed damage types with tracked target identities", () => {
		const state = makeState();
		state.upsertCombatTurnOrderParticipant({id: "goblin", name: "Goblin", initiative: 10});
		const {spells} = makeSpells(state);

		const evidence = spells._getCommittedSpellDamageEvidence({
			damageResult: {
				total: 15,
				damageType: "acid",
				damageRolls: [
					{damageType: "cold", total: 8},
					{damageType: "fire", total: 7},
				],
			},
		});

		expect(evidence).toEqual({
			version: 1,
			resolution: "target-confirmation-required",
			damage: [
				{damageType: "acid", amount: 8},
				{damageType: "fire", amount: 7},
			],
			targets: [{targetId: "goblin", targetName: "Goblin", outcome: "unconfirmed"}],
		});
	});

	it("publishes normalized cast-bounded evidence to subscribers", async () => {
		const state = makeState();
		const tool = addArtificerTool(state);
		const hook = jest.fn(receipt => receipt.damageEvidence);
		state.registerCommittedSpellCastHook("Artificer|EFA", hook, {hookId: "evidence-probe"});

		const receipt = await state.pPublishCommittedSpellCast({
			spell: {
				id: "spell-1",
				name: "Acid Arrow",
				source: "XPHB",
				level: 2,
				sourceClass: "Artificer",
				sourceClassSource: "EFA",
				sourceSubclass: "Alchemist",
				sourceSubclassSource: "EFA",
			},
			focusInventoryRow: tool,
			damageEvidence: {
				version: 99,
				resolution: "confirmed",
				damage: [{damageType: "ACID", amount: 9, ignored: true}],
				targets: [{targetId: "goblin", targetName: "Goblin", outcome: "damaged", ignored: true}],
				ignored: true,
			},
			cast: {type: "slot", slotLevel: 2, focusInventoryItemId: tool.id},
		});

		expect(receipt).toEqual(expect.objectContaining({
			committed: true,
			castingSubclassUid: "Alchemist|Artificer|EFA|EFA",
			damageEvidence: {
				version: 1,
				resolution: "confirmed",
				damage: [{damageType: "acid", amount: 9}],
				targets: [{targetId: "goblin", targetName: "Goblin", outcome: "damaged"}],
			},
		}));
		expect(hook).toHaveBeenCalledTimes(1);
		expect(state.getAlchemicalEruptionEligibility(receipt).eligible).toBe(true);
	});

	it("captures post-commit Eruption failure without refunding or retrying the spell", async () => {
		const state = makeState();
		state.startCombat();
		const tool = addArtificerTool(state);
		const {spells} = makeSpells(state);
		spells._rollDamageDiceDetailed.mockImplementation(() => {
			throw new Error("eruption roll failed");
		});
		spells._registerAlchemicalEruptionHook();
		const boolSpy = jest.spyOn(globalThis.CharacterSheetModal, "pGetUserBoolean")
			.mockResolvedValue(true);

		try {
			const receipt = await state.pPublishCommittedSpellCast({
				spell: {
					id: "spell-1",
					name: "Acid Arrow",
					source: "XPHB",
					level: 2,
					sourceClass: "Artificer",
					sourceClassSource: "EFA",
				},
				focusInventoryRow: tool,
				damageEvidence: makeReceipt().damageEvidence,
				cast: {type: "slot", slotLevel: 2, focusInventoryItemId: tool.id},
			});

			expect(receipt).toEqual(expect.objectContaining({
				committed: true,
				followUpFailed: true,
				followUps: [{
					hookId: "efa-alchemical-eruption",
					ok: false,
					error: "eruption roll failed",
				}],
			}));
			expect(state.getAlchemicalEruptionEligibility(makeReceipt()))
				.toEqual(expect.objectContaining({eligible: false, reason: "alreadyUsedThisTurn"}));
		} finally {
			boolSpy.mockRestore();
		}
	});
});
