import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import {CharacterSheetRest} from "../../../js/charactersheet/charactersheet-rest.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetArtificerPlans = globalThis.CharacterSheetArtificerPlans;
const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRespecEngine = globalThis.CharacterSheetRespecEngine;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFICER_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/class/class-artificer.json"),
	"utf8",
));
const XPHB_SPELLS = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/spells/spells-xphb.json"),
	"utf8",
)).spell;
const ITEM_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/items.json"),
	"utf8",
));
const MAGIC_VARIANT_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/magicvariants.json"),
	"utf8",
));
const PLAN_ITEMS = [
	...ITEM_DATA.item,
	...MAGIC_VARIANT_DATA.magicvariant.map(variant => ({
		...variant,
		source: variant.source || variant.inherits?.source,
	})),
	{name: "+1 Shield", source: "XDMG"},
	{name: "Armor of Resistance", source: "XDMG"},
	{name: "+2 Shield", source: "XDMG"},
];

const EFA_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const REANIMATOR = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Reanimator"
	&& sc.source === "RHW"
	&& sc.className === "Artificer"
	&& sc.classSource === "EFA",
);
const SPELLS_OWNER_UID = "Reanimator Spells|Artificer|EFA|Reanimator|RHW|3";
const SKILL_SET_UID = "Reanimator's Skill Set|Artificer|EFA|Reanimator|RHW|3";
const SKILL_SET_TOOL_OWNER_UID = `${SKILL_SET_UID}|RHW`;
const COMPANION_UID = "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3";
const STRANGE_MODIFICATIONS_UID = "Strange Modifications|Artificer|EFA|Reanimator|RHW|5";
const IMPROVED_REANIMATION_UID = "Improved Reanimation|Artificer|EFA|Reanimator|RHW|9";
const MACABRE_MODIFICATIONS_UID = "Macabre Modifications|Artificer|EFA|Reanimator|RHW|9";
const REFINED_REANIMATION_UID = "Refined Reanimation|Artificer|EFA|Reanimator|RHW|15";
const CLASS_UID = "Artificer|EFA";
const SUBCLASS_UID = "Reanimator|Artificer|EFA|RHW";

const FIXED_SPELLS = Object.freeze([
	{level: 3, uid: "False Life|XPHB"},
	{level: 3, uid: "Spare the Dying|XPHB"},
	{level: 3, uid: "Witch Bolt|XPHB"},
	{level: 5, uid: "Blindness/Deafness|XPHB"},
	{level: 5, uid: "Enhance Ability|XPHB"},
	{level: 9, uid: "Animate Dead|XPHB"},
	{level: 9, uid: "Lightning Bolt|XPHB"},
	{level: 13, uid: "Blight|XPHB"},
	{level: 13, uid: "Death Ward|XPHB"},
	{level: 17, uid: "Antilife Shell|XPHB"},
	{level: 17, uid: "Raise Dead|XPHB"},
]);

const copy = value => JSON.parse(JSON.stringify(value));
const uid = spell => `${spell.name}|${spell.source}`;
const sorted = values => [...values].sort((a, b) => a.localeCompare(b));

function subclassSnapshot (subclass = REANIMATOR, overrides = {}) {
	return {
		name: subclass.name,
		shortName: subclass.shortName,
		source: subclass.source,
		casterProgression: subclass.casterProgression,
		spellcastingAbility: subclass.spellcastingAbility,
		additionalSpells: copy(subclass.additionalSpells || []),
		...overrides,
	};
}

function classEntry (level, {
	classSource = "EFA",
	subclass = REANIMATOR,
	subclassOverrides = {},
} = {}) {
	return {
		name: "Artificer",
		source: classSource,
		level,
		spellcastingAbility: "int",
		casterProgression: classSource === "EFA" ? EFA_ARTIFICER.casterProgression : "artificer",
		preparedSpellsProgression: classSource === "EFA" ? copy(EFA_ARTIFICER.preparedSpellsProgression) : undefined,
		cantripProgression: classSource === "EFA" ? copy(EFA_ARTIFICER.cantripProgression) : undefined,
		subclass: subclass ? subclassSnapshot(subclass, subclassOverrides) : null,
	};
}

function findXphbSpell (name) {
	const spell = XPHB_SPELLS.find(it => it.name === name && it.source === "XPHB");
	if (!spell) throw new Error(`Missing XPHB spell fixture: ${name}`);
	return spell;
}

function addPlayerSpell (state, name, {source = "XPHB"} = {}) {
	const spell = source === "XPHB" ? findXphbSpell(name) : null;
	state.addSpell({
		name,
		source,
		level: spell?.level ?? 1,
		school: spell?.school ?? "N",
		sourceFeature: "Prepared Spells",
		sourceClass: "Artificer",
		prepared: true,
		alwaysPrepared: false,
	}, true);
}

function makeState (level, {
	intelligence = 18,
	classSource = "EFA",
	subclass = REANIMATOR,
	subclassOverrides = {},
	playerSpells = [],
} = {}) {
	const state = new CharacterSheetState();
	state.setSpellData(XPHB_SPELLS);
	state.setAbilityBase("int", intelligence);
	for (const spell of playerSpells) addPlayerSpell(state, spell.name, spell);
	state.addClass(classEntry(level, {classSource, subclass, subclassOverrides}));
	return state;
}

function allSpellEntries (state) {
	return [...state.getSpellsKnown(), ...state.getCantripsKnown()];
}

function ownersFor (spell, ownerUid) {
	return (spell?.subclassSpellGrantOwners || []).filter(owner => owner.grantOwnerUid === ownerUid);
}

function fixedGrantEntries (state) {
	return allSpellEntries(state).filter(spell => ownersFor(spell, SPELLS_OWNER_UID).length);
}

function expectedFixedUids (level) {
	return sorted(FIXED_SPELLS.filter(spell => level >= spell.level).map(spell => spell.uid));
}

function expectExactFixedGrants (state, level) {
	const entries = fixedGrantEntries(state);
	expect(sorted(entries.map(uid))).toEqual(expectedFixedUids(level));
	expect(new Set(entries.map(uid)).size).toBe(entries.length);
	for (const spell of entries) {
		expect(spell.source).toBe("XPHB");
		expect(spell.sourceClass).toBe("Artificer");
		expect(spell.sourceFeature).toBe("Reanimator Spells");
		expect(ownersFor(spell, SPELLS_OWNER_UID)).toHaveLength(1);
		if (spell.level > 0) {
			expect(spell.alwaysPrepared).toBe(true);
			expect(spell.prepared).toBe(true);
			expect(CharacterSheetClassUtils.isPlayerChosenSpell(spell)).toBe(false);
		}
	}
}

function getOwnedResource (state, featureUid) {
	return state.getResources().find(resource =>
		resource.featureUid === featureUid
		&& resource.classUid === CLASS_UID
		&& resource.subclassUid === SUBCLASS_UID);
}

function getSpellEntry (state, spellUid) {
	return allSpellEntries(state).find(spell => uid(spell) === spellUid);
}

function makeRespecPage (state) {
	return {
		getState: () => state,
		getClasses: () => [EFA_ARTIFICER],
		getClassFeatures: () => ARTIFICER_DATA.classFeature,
		getSubclassFeatures: () => ARTIFICER_DATA.subclassFeature,
		getOptionalFeatures: () => [],
		getItems: () => PLAN_ITEMS,
		filterByAllowedSources: values => values,
		getSpells: () => XPHB_SPELLS,
		getFilteredSpellData: () => XPHB_SPELLS,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
	};
}

function resolveFixtureOnlyRespecDecisions (engine) {
	const used = new Set();
	while (true) {
		const decision = engine.manifest.decisions.find(it =>
			it.type === CharacterSheetArtificerPlans.DECISION_TYPE_ACQUIRE
			&& it.required
			&& it.selection == null);
		if (!decision) break;
		const selection = decision.options.find(option => {
			const identity = CharacterSheetArtificerPlans.getSelectionIdentity(option);
			return identity && !used.has(identity);
		});
		if (!selection) throw new Error("No legal unique Artificer plan remained for the Reanimator Respec fixture.");
		used.add(CharacterSheetArtificerPlans.getSelectionIdentity(selection));
		engine.stageGraphMutation(decision.id, selection);
	}
	for (const decision of engine.manifest.decisions) decision.status = "resolved";
	expect(engine.getValidation().errors).toEqual([]);
}

function makeSpentRhwRespecState () {
	const state = makeState(15, {
		playerSpells: [
			{name: "False Life"},
			{name: "False Life", source: "PHB"},
		],
	});
	const jolt = getOwnedResource(state, SKILL_SET_UID);
	const facilitated = getOwnedResource(state, REFINED_REANIMATION_UID);
	state.setResourceCurrent(jolt.id, 2);
	state.setResourceCurrent(facilitated.id, 0);

	const wrongOwnerClass = {
		name: "Artificer",
		source: "EFA",
		subclass: {name: "Reanimator", source: "TST"},
	};
	const wrongOwner = state.getSubclassSpellGrantOwner(wrongOwnerClass, {
		sourceFeature: "Reanimator Spells",
		sourceClass: "Artificer",
		isCantrip: false,
	});
	const witchBolt = getSpellEntry(state, "Witch Bolt|XPHB");
	witchBolt.subclassSpellGrantOwners.push(wrongOwner);
	state._reapplySubclassSpellGrantOwners(witchBolt);
	state._data.resources.push({
		id: "foreign-reanimator-resource",
		name: "Jolt to Life",
		current: 7,
		max: 7,
		recharge: "long",
		featureUid: "Reanimator's Skill Set|Artificer|EFA|Reanimator|TST|3",
		classUid: CLASS_UID,
		subclassUid: "Reanimator|Artificer|EFA|TST",
	});
	expect(state.loadFromJson(copy(state.toJson()))).not.toBe(false);
	return {state, wrongOwner};
}

function expectRhwRemovedAndCollisionsPreserved (state, wrongOwner) {
	expect(allSpellEntries(state).flatMap(spell => ownersFor(spell, SPELLS_OWNER_UID))).toEqual([]);
	expect(allSpellEntries(state).flatMap(spell => ownersFor(spell, REFINED_REANIMATION_UID))).toEqual([]);
	expect(getOwnedResource(state, SKILL_SET_UID)).toBeUndefined();
	expect(getOwnedResource(state, REFINED_REANIMATION_UID)).toBeUndefined();
	expect(getSpellEntry(state, "False Life|XPHB")).toMatchObject({
		sourceFeature: "Prepared Spells",
		sourceClass: "Artificer",
		prepared: true,
		alwaysPrepared: false,
	});
	expect(getSpellEntry(state, "False Life|PHB")).toMatchObject({
		sourceFeature: "Prepared Spells",
		sourceClass: "Artificer",
		prepared: true,
	});
	expect(getSpellEntry(state, "Witch Bolt|XPHB").subclassSpellGrantOwners).toEqual([wrongOwner]);
	expect(state.getResources()).toEqual(expect.arrayContaining([
		expect.objectContaining({
			id: "foreign-reanimator-resource",
			current: 7,
			max: 7,
		}),
	]));
}

describe("RHW Reanimator R2a progression descriptors", () => {
	test.each([2, 3, 4, 5, 6, 8, 9, 10, 14, 15, 16])(
		"projects only the unlocked level %i surfaces",
		level => {
			const calculations = makeState(level).getFeatureCalculations();

			expect(!!calculations.hasReanimatorSpells).toBe(level >= 3);
			expect(!!calculations.hasJoltToLife).toBe(level >= 3);
			expect(!!calculations.hasReanimatorsToolsRequirement).toBe(level >= 3);
			expect(!!calculations.hasReanimatedCompanionOwnership).toBe(level >= 3);
			expect(!!calculations.hasStrangeModifications).toBe(level >= 5);
			expect(!!calculations.hasImprovedReanimation).toBe(level >= 9);
			expect(!!calculations.hasMacabreModifications).toBe(level >= 9);
			expect(!!calculations.hasRefinedReanimation).toBe(level >= 15);
			expect(!!calculations.hasFacilitatedRevival).toBe(level >= 15);
			expect(!!calculations.hasLifeTransfer).toBe(level >= 15);

			const expectedModificationCount = level >= 15 ? 3 : level >= 9 ? 2 : level >= 5 ? 1 : undefined;
			const expectedModificationUid = level >= 15
				? REFINED_REANIMATION_UID
				: level >= 9
					? MACABRE_MODIFICATIONS_UID
					: level >= 5
						? STRANGE_MODIFICATIONS_UID
						: undefined;
			expect(calculations.reanimatorModificationCount).toBe(expectedModificationCount);
			expect(calculations.reanimatorModificationFeatureUid).toBe(expectedModificationUid);
		},
	);

	it("publishes source-aware measurable descriptors with the bounded R4b runtime projection", () => {
		const state = makeState(15);
		const calculations = state.getFeatureCalculations();

		expect(calculations.reanimatorSpells).toEqual({
			featureUid: SPELLS_OWNER_UID,
			ownerUid: SPELLS_OWNER_UID,
			spellUids: FIXED_SPELLS.filter(spell => spell.level <= 15).map(spell => spell.uid),
			alwaysPrepared: true,
			countsAgainstPreparedCapacity: false,
		});
		expect(calculations.joltToLife).toMatchObject({
			featureUid: SKILL_SET_UID,
			spellUid: "Spare the Dying|XPHB",
			spellOwnerUid: SPELLS_OWNER_UID,
			uses: 4,
			recharge: "long",
			healing: 15,
			save: {ability: "dex", onSuccess: "halfDamage"},
			emanationFeet: 10,
			damage: "3d4",
			damageType: "lightning",
		});
		expect(calculations.reanimatorsTools).toEqual({
			featureUid: SKILL_SET_UID,
			ownerUid: SKILL_SET_TOOL_OWNER_UID,
			requiredProficiency: "Alchemist's Supplies|XPHB",
			mode: null,
			status: null,
			fixedProficiency: "Alchemist's Supplies",
			selection: null,
			pending: false,
			resolved: false,
		});
		expect(calculations.reanimatedCompanion).toEqual({
			featureUid: COMPANION_UID,
			ownerUid: "Reanimated Companion|Artificer|EFA|Reanimator|RHW|3|RHW",
			companionUid: "Reanimated Companion|RHW",
			ownershipOnly: false,
			creationImplemented: true,
			setupChoiceTransactionImplemented: true,
			runtimeImplemented: true,
			activeCompanion: null,
			operations: null,
		});
		expect(calculations.reanimatorModificationFeatureUid).toBe(REFINED_REANIMATION_UID);
		expect(calculations.improvedReanimationFeatureUid).toBe(IMPROVED_REANIMATION_UID);
		expect(calculations.facilitatedRevival).toMatchObject({
			featureUid: REFINED_REANIMATION_UID,
			spellUid: "Raise Dead|XPHB",
			spellOwnerUid: REFINED_REANIMATION_UID,
			uses: 1,
			recharge: "long",
			executable: false,
			executionAvailable: false,
			status: "focusUnavailable",
			focusStatus: "unavailable",
			eligibleFocusReferences: [],
		});
		expect(calculations.lifeTransferFeatureUid).toBe(REFINED_REANIMATION_UID);
		expect(calculations.lifeTransfer).toEqual({
			featureUid: REFINED_REANIMATION_UID,
			executable: false,
			status: "companionUnavailable",
			actionType: "reaction",
			healing: "companionCurrentHpAfterTriggeringDamage",
			companionDeath: true,
			triggersDeathBurst: true,
		});
		expect(calculations).not.toHaveProperty("reanimatedCompanionCreated");
		expect(calculations).not.toHaveProperty("lifeTransferResolution");
		expect(calculations).not.toHaveProperty("reanimatorToolProficiencyGranted");
		expect(state.getToolProficiencies()).toEqual([]);
	});

	it("uses exact EFA class levels while TCE multiclass levels affect only shared character math", async () => {
		const state = makeState(3);
		state.addClass(classEntry(8, {classSource: "TCE", subclass: null}));

		const calculations = state.getFeatureCalculations();
		expect(calculations.reanimatorSpells.spellUids).toEqual(expectedFixedUids(3));
		expect(calculations.joltToLife.healing).toBe(3);
		expect(calculations.joltToLife.damage).toBe("2d4");
		expect(calculations.joltToLife.save.dc).toBe(16);

		const result = await state.pUseRhwReanimatorJoltToLife({
			spellName: "Spare the Dying",
			spellSource: "XPHB",
			spellOwnerUid: SPELLS_OWNER_UID,
		});
		expect(result.result).toMatchObject({
			healing: {amount: 3},
			damage: {dice: "2d4", type: "lightning"},
			save: {ability: "dex", dc: 16, onSuccess: "halfDamage"},
		});
	});

	test.each([
		["wrong subclass source", {classSource: "EFA", subclassOverrides: {source: "TST"}}],
		["wrong class source", {classSource: "TCE"}],
		["missing subclass source", {classSource: "EFA", subclassOverrides: {source: undefined}}],
	])("does not activate for %s", (_label, options) => {
		const state = makeState(17, options);
		const calculations = state.getFeatureCalculations();

		expect(calculations.hasReanimatorSpells).toBeUndefined();
		expect(calculations.hasJoltToLife).toBeUndefined();
		expect(fixedGrantEntries(state)).toEqual([]);
		expect(getOwnedResource(state, SKILL_SET_UID)).toBeUndefined();
		expect(getOwnedResource(state, REFINED_REANIMATION_UID)).toBeUndefined();
	});
});

describe("RHW Reanimator R2a fixed-spell owner ledger", () => {
	test.each([2, 3, 4, 5, 8, 9, 12, 13, 16, 17])(
		"reconciles the exact cumulative XPHB grants at level %i",
		level => {
			expectExactFixedGrants(makeState(level), level);
		},
	);

	it("excludes fixed spells from prepared capacity and keeps the cantrip in its canonical collection", () => {
		const state = makeState(5, {playerSpells: [{name: "Cure Wounds"}]});
		const card = state.getSpellcastingClassBreakdown().find(it => it.className === "Artificer");

		expect(card).toMatchObject({
			spellsCount: 1,
			spellsGranted: 4,
			spellsMax: EFA_ARTIFICER.preparedSpellsProgression[4],
		});
		expect(state.getCantripsKnown().filter(spell => uid(spell) === "Spare the Dying|XPHB")).toHaveLength(1);
		expect(state.getSpellsKnown().some(spell => uid(spell) === "Spare the Dying|XPHB")).toBe(false);
	});

	it("is idempotent across repeated reconcile, load, and an actual level-up", () => {
		const state = makeState(16);
		for (let i = 0; i < 3; i++) state.applyClassFeatureEffects();
		expectExactFixedGrants(state, 16);

		const loaded = new CharacterSheetState();
		loaded.setSpellData(XPHB_SPELLS);
		expect(loaded.loadFromJson(copy(state.toJson()))).not.toBe(false);
		expectExactFixedGrants(loaded, 16);

		loaded.levelUp("Artificer");
		expectExactFixedGrants(loaded, 17);
		const raiseDead = getSpellEntry(loaded, "Raise Dead|XPHB");
		expect(ownersFor(raiseDead, SPELLS_OWNER_UID)).toHaveLength(1);
		expect(ownersFor(raiseDead, REFINED_REANIMATION_UID)).toHaveLength(1);
		expect(allSpellEntries(loaded).filter(spell => uid(spell) === "Raise Dead|XPHB")).toHaveLength(1);
	});

	it("preserves player metadata, wrong spell sources, and a wrong-source same-label owner", () => {
		const state = makeState(5, {
			playerSpells: [
				{name: "False Life"},
				{name: "False Life", source: "PHB"},
			],
		});
		const falseLifeXphb = getSpellEntry(state, "False Life|XPHB");
		const wrongOwnerClass = {
			name: "Artificer",
			source: "EFA",
			subclass: {name: "Reanimator", source: "TST"},
		};
		const wrongOwner = state.getSubclassSpellGrantOwner(wrongOwnerClass, {
			sourceFeature: "Reanimator Spells",
			sourceClass: "Artificer",
			isCantrip: false,
		});
		falseLifeXphb.subclassSpellGrantOwners.push(wrongOwner);
		state._reapplySubclassSpellGrantOwners(falseLifeXphb);
		state._data.resources.push({
			id: "foreign-jolt",
			name: "Jolt to Life",
			current: 7,
			max: 7,
			recharge: "long",
			featureUid: "Reanimator's Skill Set|Artificer|EFA|Reanimator|TST|3",
			classUid: CLASS_UID,
			subclassUid: "Reanimator|Artificer|EFA|TST",
		});

		state.getClasses()[0].subclass = null;
		state.applyClassFeatureEffects();

		expect(ownersFor(getSpellEntry(state, "False Life|XPHB"), SPELLS_OWNER_UID)).toEqual([]);
		expect(getSpellEntry(state, "False Life|XPHB").subclassSpellGrantOwners).toEqual([wrongOwner]);
		expect(getSpellEntry(state, "False Life|PHB")).toMatchObject({
			sourceFeature: "Prepared Spells",
			sourceClass: "Artificer",
			prepared: true,
		});
		expect(getOwnedResource(state, SKILL_SET_UID)).toBeUndefined();
		expect(state.getResources()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: "foreign-jolt", current: 7, max: 7}),
		]));

		state.removeSubclassSpells(wrongOwner);
		expect(getSpellEntry(state, "False Life|XPHB")).toMatchObject({
			sourceFeature: "Prepared Spells",
			sourceClass: "Artificer",
			prepared: true,
			alwaysPrepared: false,
		});
		expect(getSpellEntry(state, "False Life|XPHB").subclassSpellGrantOwners).toBeUndefined();
	});
});

describe("RHW Reanimator R2a Jolt to Life transaction", () => {
	test.each([
		[10, "2d4"],
		[11, "3d4"],
		[16, "3d4"],
		[17, "4d4"],
	])("commits the exact level %i resolution", async (level, damage) => {
		const state = makeState(level);
		const resource = getOwnedResource(state, SKILL_SET_UID);

		const result = await state.pUseRhwReanimatorJoltToLife({
			spellName: "Spare the Dying",
			spellSource: "XPHB",
			spellOwnerUid: SPELLS_OWNER_UID,
			context: {castId: `jolt-${level}`},
		});

		expect(result).toMatchObject({
			ok: true,
			committed: true,
			featureUid: SKILL_SET_UID,
			classUid: CLASS_UID,
			actionType: "free",
			resourceId: resource.id,
			resourceCost: 1,
			remainingUses: 3,
			context: {
				castId: `jolt-${level}`,
				spell: {name: "Spare the Dying", source: "XPHB", ownerUid: SPELLS_OWNER_UID},
			},
			result: {
				spell: {name: "Spare the Dying", source: "XPHB"},
				healing: {amount: level},
				emanationFeet: 10,
				save: {
					ability: "dex",
					dc: state.getSpellSaveDcForAbility("int"),
					onSuccess: "halfDamage",
				},
				damage: {dice: damage, type: "lightning"},
			},
		});
		expect(() => JSON.parse(JSON.stringify(result))).not.toThrow();
		expect(result.result).not.toHaveProperty("target");
	});

	test.each([
		["wrong spell", {spellName: "False Life", spellSource: "XPHB", spellOwnerUid: SPELLS_OWNER_UID}, "invalidSpell"],
		["wrong source", {spellName: "Spare the Dying", spellSource: "PHB", spellOwnerUid: SPELLS_OWNER_UID}, "invalidSpellSource"],
		["wrong owner", {spellName: "Spare the Dying", spellSource: "XPHB", spellOwnerUid: REFINED_REANIMATION_UID}, "invalidSpellOwner"],
		["cancelled", {spellName: "Spare the Dying", spellSource: "XPHB", spellOwnerUid: SPELLS_OWNER_UID, cancelled: true}, "cancelled"],
	])("rejects %s byte-for-byte without spending", async (_label, input, reason) => {
		const state = makeState(3);
		const before = JSON.stringify(state.toJson());

		await expect(state.pUseRhwReanimatorJoltToLife(input)).resolves.toEqual({
			ok: false,
			committed: false,
			reason,
		});
		expect(JSON.stringify(state.toJson())).toBe(before);
	});

	it("uses max(0, current Intelligence modifier), permits zero uses, and preserves exhausted rollback", async () => {
		for (const [intelligence, expected] of [[6, 0], [10, 0], [18, 4]]) {
			const state = makeState(3, {intelligence});
			expect(getOwnedResource(state, SKILL_SET_UID)).toMatchObject({current: expected, max: expected});
			expect(state.getFeatureCalculations().joltToLife.uses).toBe(expected);
		}

		const state = makeState(3);
		const resource = getOwnedResource(state, SKILL_SET_UID);
		state.setResourceCurrent(resource.id, 0);
		const before = JSON.stringify(state.toJson());
		await expect(state.pUseRhwReanimatorJoltToLife({
			spellName: "Spare the Dying",
			spellSource: "XPHB",
			spellOwnerUid: SPELLS_OWNER_UID,
		})).resolves.toMatchObject({
			ok: false,
			committed: false,
			reason: "insufficientResource",
		});
		expect(JSON.stringify(state.toJson())).toBe(before);
	});

	it("recharges only on a long rest", async () => {
		const state = makeState(3);
		await state.pUseRhwReanimatorJoltToLife({
			spellName: "Spare the Dying",
			spellSource: "XPHB",
			spellOwnerUid: SPELLS_OWNER_UID,
		});
		const rest = Object.create(CharacterSheetRest.prototype);
		rest._state = state;

		rest._restoreResources("short");
		expect(getOwnedResource(state, SKILL_SET_UID).current).toBe(3);
		rest._restoreResources("long");
		expect(getOwnedResource(state, SKILL_SET_UID).current).toBe(4);
	});
});

describe("RHW Reanimator R2a Facilitated Revival boundary", () => {
	it("is unavailable below EFA 15 without an alternate-cast owner or resource", () => {
		const state = makeState(14);

		expect(state.getRhwFacilitatedRevivalBoundary()).toEqual({
			available: false,
			executable: false,
			reason: "featureUnavailable",
			featureUid: REFINED_REANIMATION_UID,
		});
		expect(getSpellEntry(state, "Raise Dead|XPHB")).toBeUndefined();
		expect(getOwnedResource(state, REFINED_REANIMATION_UID)).toBeUndefined();
	});

	it("owns one canonical Raise Dead alternate cast at EFA 15 and exposes the live focus boundary", () => {
		const state = makeState(15);
		const raiseDead = getSpellEntry(state, "Raise Dead|XPHB");
		const resource = getOwnedResource(state, REFINED_REANIMATION_UID);
		const before = JSON.stringify(state.toJson());

		expect(allSpellEntries(state).filter(spell => uid(spell) === "Raise Dead|XPHB")).toHaveLength(1);
		expect(raiseDead).toMatchObject({
			level: 5,
			alwaysPrepared: false,
			prepared: false,
			sourceFeature: "Facilitated Revival",
			sourceClass: "Artificer",
		});
		expect(ownersFor(raiseDead, REFINED_REANIMATION_UID)).toEqual([
			expect.objectContaining({
				grantOwnerUid: REFINED_REANIMATION_UID,
				alternateCast: {
					slotCost: 0,
					ignoresMaterialComponents: true,
					spellcastingFocusRequirement: expect.objectContaining({
						required: true,
						ruleId: "rhw-facilitated-revival-focus",
						filter: {
							itemTypes: ["AT"],
							itemSources: ["XPHB"],
							requiresProficiency: true,
						},
					}),
				},
			}),
		]);
		expect(resource).toMatchObject({
			current: 1,
			max: 1,
			recharge: "long",
		});
		expect(resource).not.toHaveProperty("pendingSharedToolContract");
		expect(state.getRhwFacilitatedRevivalBoundary()).toMatchObject({
			available: true,
			executable: false,
			reason: "focusUnavailable",
			featureUid: REFINED_REANIMATION_UID,
			classUid: CLASS_UID,
			subclassUid: SUBCLASS_UID,
			spell: {
				name: "Raise Dead",
				source: "XPHB",
				ownerUid: REFINED_REANIMATION_UID,
				slotCost: 0,
				ignoresMaterialComponents: true,
			},
			resource: {
				id: resource.id,
				current: 1,
				max: 1,
				recharge: "long",
			},
			focus: {
				status: "unavailable",
				eligibleReferences: [],
			},
		});
		expect(JSON.stringify(state.toJson())).toBe(before);
		expect(state.pUseRhwFacilitatedRevival).toEqual(expect.any(Function));
	});

	it("coexists with the fixed level-17 owner as one prepared spell identity", () => {
		const state = makeState(17);
		const raiseDead = getSpellEntry(state, "Raise Dead|XPHB");

		expect(allSpellEntries(state).filter(spell => uid(spell) === "Raise Dead|XPHB")).toHaveLength(1);
		expect(ownersFor(raiseDead, SPELLS_OWNER_UID)).toHaveLength(1);
		expect(ownersFor(raiseDead, REFINED_REANIMATION_UID)).toHaveLength(1);
		expect(raiseDead).toMatchObject({alwaysPrepared: true, prepared: true});

		state.getClasses()[0].level = 16;
		state.applyClassFeatureEffects();
		const level16RaiseDead = getSpellEntry(state, "Raise Dead|XPHB");
		expect(ownersFor(level16RaiseDead, SPELLS_OWNER_UID)).toEqual([]);
		expect(ownersFor(level16RaiseDead, REFINED_REANIMATION_UID)).toHaveLength(1);
		expect(level16RaiseDead).toMatchObject({alwaysPrepared: false, prepared: false});
	});

	it("preserves a player-owned Raise Dead attribution while the alternate-cast owner coexists", () => {
		const state = makeState(15, {playerSpells: [{name: "Raise Dead"}]});
		const raiseDead = getSpellEntry(state, "Raise Dead|XPHB");
		const card = state.getSpellcastingClassBreakdown().find(it => it.className === "Artificer");

		expect(allSpellEntries(state).filter(spell => uid(spell) === "Raise Dead|XPHB")).toHaveLength(1);
		expect(ownersFor(raiseDead, REFINED_REANIMATION_UID)).toHaveLength(1);
		expect(raiseDead).toMatchObject({
			sourceFeature: "Prepared Spells",
			sourceClass: "Artificer",
			prepared: true,
			alwaysPrepared: false,
		});
		expect(card.spellsCount).toBe(1);

		state.getClasses()[0].subclass = null;
		state.applyClassFeatureEffects();
		expect(getSpellEntry(state, "Raise Dead|XPHB")).toMatchObject({
			sourceFeature: "Prepared Spells",
			sourceClass: "Artificer",
			prepared: true,
			alwaysPrepared: false,
		});
		expect(getSpellEntry(state, "Raise Dead|XPHB").subclassSpellGrantOwners).toBeUndefined();
	});

	it("restores its independent resource on a long rest while focus remains the execution gate", () => {
		const state = makeState(15);
		const resource = getOwnedResource(state, REFINED_REANIMATION_UID);
		state.setResourceCurrent(resource.id, 0);
		const rest = Object.create(CharacterSheetRest.prototype);
		rest._state = state;

		rest._restoreResources("short");
		expect(getOwnedResource(state, REFINED_REANIMATION_UID).current).toBe(0);
		rest._restoreResources("long");
		expect(getOwnedResource(state, REFINED_REANIMATION_UID).current).toBe(1);
		expect(state.getRhwFacilitatedRevivalBoundary().executable).toBe(false);
	});
});

describe("RHW Reanimator R2a migration, export, and Respec isolation", () => {
	it("round-trips source-owned spells and spent resources without adopting name-only state", () => {
		const state = makeState(15);
		const jolt = getOwnedResource(state, SKILL_SET_UID);
		state.setResourceCurrent(jolt.id, 2);
		const exported = copy(state.toJson());
		exported.resources.push({
			id: "legacy-name-only-jolt",
			name: "Jolt to Life",
			current: 9,
			max: 9,
			recharge: "long",
		});

		const loaded = new CharacterSheetState();
		loaded.setSpellData(XPHB_SPELLS);
		expect(loaded.loadFromJson(exported)).not.toBe(false);

		expectExactFixedGrants(loaded, 15);
		expect(getOwnedResource(loaded, SKILL_SET_UID)).toMatchObject({current: 2, max: 4});
		expect(loaded.getResources().find(resource => resource.id === "legacy-name-only-jolt")).toMatchObject({
			current: 9,
			max: 9,
		});
		expect(loaded.getPendingFeatureChoices()).toEqual([]);
		expect(loaded.getPendingSpellChoices()).toEqual([]);
	});

	it("removes below-threshold RHW resources while preserving unrelated resources", () => {
		const state = makeState(15);
		state._data.resources.push({
			id: "unrelated-long-rest",
			name: "Unrelated",
			current: 1,
			max: 1,
			recharge: "long",
			featureUid: "Other|Feature",
		});
		state.getClasses()[0].level = 2;
		state.applyClassFeatureEffects();

		expect(getOwnedResource(state, SKILL_SET_UID)).toBeUndefined();
		expect(getOwnedResource(state, REFINED_REANIMATION_UID)).toBeUndefined();
		expect(state.getResources()).toEqual(expect.arrayContaining([
			expect.objectContaining({id: "unrelated-long-rest"}),
		]));
		expectExactFixedGrants(state, 2);
	});

	it("keeps draft changes isolated, applies with the spell catalog, reloads, and undoes atomically", async () => {
		const liveState = makeState(14);
		const page = makeRespecPage(liveState);
		const engine = new CharacterSheetRespecEngine({page, state: liveState});

		engine.begin();
		engine.state.getClasses()[0].level = 15;
		engine.state.applyClassFeatureEffects();
		expect(getSpellEntry(engine.state, "Raise Dead|XPHB")).toMatchObject({level: 5});
		expect(getSpellEntry(liveState, "Raise Dead|XPHB")).toBeUndefined();
		engine.cancel();
		expect(liveState.getClasses()[0].level).toBe(14);
		expect(getSpellEntry(liveState, "Raise Dead|XPHB")).toBeUndefined();

		engine.begin();
		engine.state.getClasses()[0].level = 15;
		engine.state.applyClassFeatureEffects();
		engine.markDirty();
		resolveFixtureOnlyRespecDecisions(engine);
		await expect(engine.apply()).resolves.toBe(true);
		expect(liveState.getClasses()[0].level).toBe(15);
		expect(getSpellEntry(liveState, "Raise Dead|XPHB")).toMatchObject({level: 5});
		expect(getOwnedResource(liveState, REFINED_REANIMATION_UID)).toMatchObject({current: 1, max: 1});

		const reloaded = new CharacterSheetState();
		reloaded.setSpellData(XPHB_SPELLS);
		expect(reloaded.loadFromJson(copy(liveState.toJson()))).not.toBe(false);
		expect(getSpellEntry(reloaded, "Raise Dead|XPHB")).toMatchObject({level: 5});
		expect(ownersFor(getSpellEntry(reloaded, "Raise Dead|XPHB"), REFINED_REANIMATION_UID)).toHaveLength(1);

		await expect(engine.undo()).resolves.toBe(true);
		expect(liveState.getClasses()[0].level).toBe(14);
		expect(getSpellEntry(liveState, "Raise Dead|XPHB")).toBeUndefined();
		expect(getOwnedResource(liveState, REFINED_REANIMATION_UID)).toBeUndefined();
	});

	it("applies exact RHW subclass teardown and Undo restores the full spent pre-Apply state", async () => {
		const {state: liveState, wrongOwner} = makeSpentRhwRespecState();
		const beforeApply = JSON.stringify(liveState.toJson());
		const page = makeRespecPage(liveState);
		const engine = new CharacterSheetRespecEngine({page, state: liveState});

		expect(getOwnedResource(liveState, SKILL_SET_UID)).toMatchObject({current: 2, max: 4});
		expect(getOwnedResource(liveState, REFINED_REANIMATION_UID)).toMatchObject({current: 0, max: 1});
		expect(ownersFor(getSpellEntry(liveState, "False Life|XPHB"), SPELLS_OWNER_UID)).toHaveLength(1);
		expect(ownersFor(getSpellEntry(liveState, "Raise Dead|XPHB"), REFINED_REANIMATION_UID)).toHaveLength(1);

		engine.begin();
		engine.state.getClasses()[0].subclass = null;
		engine.state.applyClassFeatureEffects();
		expectRhwRemovedAndCollisionsPreserved(engine.state, wrongOwner);
		engine.markDirty();
		resolveFixtureOnlyRespecDecisions(engine);

		await expect(engine.apply()).resolves.toBe(true);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
		expectRhwRemovedAndCollisionsPreserved(liveState, wrongOwner);

		await expect(engine.undo()).resolves.toBe(true);
		expect(page.saveCharacter).toHaveBeenCalledTimes(2);
		expect(page.renderCharacter).toHaveBeenCalledTimes(2);
		expect(JSON.stringify(liveState.toJson())).toBe(beforeApply);
		expect(getOwnedResource(liveState, SKILL_SET_UID)).toMatchObject({current: 2, max: 4});
		expect(getOwnedResource(liveState, REFINED_REANIMATION_UID)).toMatchObject({current: 0, max: 1});
	});

	it("rolls the live RHW state back byte-for-byte when persistence fails after reconciliation", async () => {
		const {state: liveState, wrongOwner} = makeSpentRhwRespecState();
		const beforeApply = JSON.stringify(liveState.toJson());
		const page = makeRespecPage(liveState);
		page.saveCharacter.mockRejectedValueOnce(new Error("save failed"));
		const engine = new CharacterSheetRespecEngine({page, state: liveState});

		engine.begin();
		const candidateClass = engine.state.getClasses()[0];
		candidateClass.level = 17;
		candidateClass.subclass = subclassSnapshot(REANIMATOR, {source: "ALT"});
		engine.state.applyClassFeatureEffects();
		expectRhwRemovedAndCollisionsPreserved(engine.state, wrongOwner);
		engine.markDirty();
		resolveFixtureOnlyRespecDecisions(engine);

		await expect(engine.apply()).rejects.toThrow("save failed");
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).not.toHaveBeenCalled();
		expect(JSON.stringify(liveState.toJson())).toBe(beforeApply);
		expect(getOwnedResource(liveState, SKILL_SET_UID)).toMatchObject({current: 2, max: 4});
		expect(getOwnedResource(liveState, REFINED_REANIMATION_UID)).toMatchObject({current: 0, max: 1});
		expect(ownersFor(getSpellEntry(liveState, "False Life|XPHB"), SPELLS_OWNER_UID)).toHaveLength(1);
		expect(ownersFor(getSpellEntry(liveState, "Raise Dead|XPHB"), REFINED_REANIMATION_UID)).toHaveLength(1);
	});
});
