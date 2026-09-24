import {readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {jest} from "@jest/globals";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import "../../../js/charactersheet/charactersheet-respec.js";
import {CharacterSheetExport} from "../../../js/charactersheet/charactersheet-export.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFICER_DATA = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/class/class-artificer.json"),
	"utf8",
));
const XPHB_SPELLS = JSON.parse(readFileSync(
	resolve(__dirname, "../../../data/spells/spells-xphb.json"),
	"utf8",
)).spell;

const EFA_ARTIFICER = ARTIFICER_DATA.class.find(cls => cls.name === "Artificer" && cls.source === "EFA");
const EFA_ALCHEMIST = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Alchemist"
	&& sc.source === "EFA"
	&& sc.className === "Artificer"
	&& sc.classSource === "EFA",
);
const EFA_ARTILLERIST = ARTIFICER_DATA.subclass.find(sc =>
	sc.name === "Artillerist"
	&& sc.source === "EFA"
	&& sc.className === "Artificer"
	&& sc.classSource === "EFA",
);

const copy = value => JSON.parse(JSON.stringify(value));

const subclassSnapshot = subclass => ({
	name: subclass.name,
	shortName: subclass.shortName,
	source: subclass.source,
	casterProgression: subclass.casterProgression,
	spellcastingAbility: subclass.spellcastingAbility,
	additionalSpells: copy(subclass.additionalSpells),
});

const classEntry = (level, subclass = EFA_ALCHEMIST) => ({
	name: EFA_ARTIFICER.name,
	source: EFA_ARTIFICER.source,
	level,
	spellcastingAbility: EFA_ARTIFICER.spellcastingAbility,
	casterProgression: EFA_ARTIFICER.casterProgression,
	preparedSpellsProgression: copy(EFA_ARTIFICER.preparedSpellsProgression),
	cantripProgression: copy(EFA_ARTIFICER.cantripProgression),
	subclass: subclass ? subclassSnapshot(subclass) : null,
});

const recordArtificerHistory = (state, level) => {
	for (let ix = 1; ix <= level; ++ix) {
		state.recordLevelChoice({
			level: ix,
			class: {name: "Artificer", source: "EFA"},
			classLevel: ix,
			choices: ix === 3
				? {subclass: subclassSnapshot(EFA_ALCHEMIST)}
				: {},
			complete: true,
		});
	}
};

const makeState = (level = 3) => {
	const state = new CharacterSheetState();
	state.setName("Exact EFA Alchemist");
	state.setSpellData(XPHB_SPELLS);
	state.addClass(classEntry(level));
	recordArtificerHistory(state, level);
	return state;
};

const createTceCompatibilityItem = state => state.createGeneratedFeatureItem({
	item: {
		name: "Experimental Elixir (Healing)",
		source: "TCE",
		type: "P",
		entries: ["A compatibility item owned by a different source."],
	},
	owner: {
		featureUid: "Experimental Elixir|Artificer|TCE|Alchemist|TCE|3|TCE",
		featureSource: "TCE",
		classUid: "Artificer|TCE",
		subclassUid: "Alchemist|Artificer|TCE|TCE",
	},
});

const addLifecycleArtifacts = state => {
	const valid = state.createEfaExperimentalElixirSpellSlotVial({
		effectKey: "healing",
		batchId: "lifecycle-valid",
		spentSlotLevel: 1,
	});
	const activeSource = state.createEfaExperimentalElixirSpellSlotVial({
		effectKey: "flight",
		batchId: "lifecycle-active",
		spentSlotLevel: 1,
	});
	const stale = state.createEfaExperimentalElixirSpellSlotVial({
		effectKey: "resilience",
		batchId: "lifecycle-stale",
		spentSlotLevel: 1,
	});
	expect(valid.ok).toBe(true);
	expect(activeSource.ok).toBe(true);
	expect(stale.ok).toBe(true);
	const consumed = state.consumeEfaExperimentalElixir({itemId: activeSource.itemId, target: "self"});
	expect(consumed).toMatchObject({ok: true, committed: true});
	state.getInventory().find(it => it.id === stale.itemId).item._generatedItemProvenance.metadata.metadataSchemaVersion = 999;

	state.addItem({
		name: "Experimental Elixir (Healing)",
		source: "EFA",
		type: "P",
		_isCustom: true,
		entries: ["An independent same-name custom potion."],
	});
	const customItemId = state.getItems().find(it =>
		it.name === "Experimental Elixir (Healing)"
		&& !it._generatedItemProvenance,
	).id;
	const tce = createTceCompatibilityItem(state);
	expect(tce.ok).toBe(true);
	const unrelatedActiveStateId = state.addActiveState("custom", {
		name: "Independent Flight",
		sourceFeatureId: "independent-flight",
		customEffects: [{type: "flySpeed", value: 40, source: "Independent Boon"}],
	});

	return {
		validItemId: valid.itemId,
		staleItemId: stale.itemId,
		customItemId,
		tceItemId: tce.itemId,
		unrelatedActiveStateId,
	};
};

const expectExactCleanup = (state, artifacts) => {
	expect(state.getInventory().some(row => row.id === artifacts.validItemId)).toBe(false);
	expect(state.getInventory().some(row => row.id === artifacts.staleItemId)).toBe(true);
	expect(state.getInventory().some(row => row.id === artifacts.customItemId)).toBe(true);
	expect(state.getInventory().some(row => row.id === artifacts.tceItemId)).toBe(true);
	expect(state.getEfaExperimentalElixirActiveEffects()).toEqual([]);
	expect(state.getActiveStates().some(active => active.id === artifacts.unrelatedActiveStateId)).toBe(true);
	expect(state.getSpellsKnown().some(spell => spell.sourceFeature === "Alchemist Spells")).toBe(false);
};

describe("EFA Alchemist public teardown hardening", () => {
	test("removeClassLastLevel below subclass level cleans only supported exact-owner state", () => {
		const state = makeState(3);
		const artifacts = addLifecycleArtifacts(state);

		expect(state.removeClassLastLevel("Artificer", "EFA")).toMatchObject({success: true});

		expect(state.getClasses()[0]).toMatchObject({name: "Artificer", source: "EFA", level: 2, subclass: null});
		expectExactCleanup(state, artifacts);
	});

	test("removeLastLevel removes the final exact-source Artificer level without adopting ambiguous data", () => {
		const state = makeState(3);
		const artifacts = addLifecycleArtifacts(state);
		state._data.classes = [
			{name: "Fighter", source: "XPHB", level: 1},
			classEntry(1),
		];
		state._data.levelHistory = [
			{
				level: 1,
				class: {name: "Fighter", source: "XPHB"},
				classLevel: 1,
				choices: {},
				complete: true,
			},
			{
				level: 2,
				class: {name: "Artificer", source: "EFA"},
				classLevel: 1,
				choices: {},
				complete: true,
			},
		];

		expect(state.removeLastLevel()).toMatchObject({success: true});

		expect(state.getClasses()).toEqual([expect.objectContaining({name: "Fighter", source: "XPHB", level: 1})]);
		expectExactCleanup(state, artifacts);
	});
});

describe("EFA Alchemist Respec candidate isolation", () => {
	test("previews exact cleanup only in the candidate and commits it to live state once", async () => {
		const state = makeState(3);
		const artifacts = addLifecycleArtifacts(state);
		const page = {
			getClasses: () => [EFA_ARTIFICER],
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			getSpells: () => XPHB_SPELLS,
			getFilteredSpellData: () => XPHB_SPELLS,
			filterByAllowedSources: values => values,
			saveCharacter: jest.fn().mockResolvedValue(undefined),
			renderCharacter: jest.fn(),
		};
		const respec = new CharacterSheetRespec({page, state});
		respec._engine.begin();
		respec._state = respec._engine.state;
		const candidateHistory = respec._state.getLevelHistoryEntry(3);

		await respec._engine.stageCandidateMutation(() => respec._applySubclassChange(
			3,
			candidateHistory,
			EFA_ALCHEMIST,
			EFA_ARTILLERIST,
		));

		expectExactCleanup(respec._state, artifacts);
		expect(state.getInventory().some(row => row.id === artifacts.validItemId)).toBe(true);
		expect(state.getEfaExperimentalElixirActiveEffects()).toHaveLength(1);
		const liveLoadSpy = jest.spyOn(state, "loadFromJson");
		jest.spyOn(respec._engine, "getValidation").mockReturnValue({isValid: true, errors: []});

		await respec._engine.apply();

		expect(liveLoadSpy).toHaveBeenCalledTimes(1);
		expect(state.getClasses()[0].subclass).toMatchObject({name: "Artillerist", source: "EFA"});
		expectExactCleanup(state, artifacts);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
	});
});

describe("EFA Alchemist persistence and user-facing JSON round trips", () => {
	const getOwnedInnate = state => state.getInnateSpells()
		.find(spell => spell.ownerUid === CharacterSheetState.EFA_ALCHEMIST_SUBCLASS_UID);

	const getPersistenceSnapshot = state => {
		const valid = state.getEfaExperimentalElixirRows()[0];
		const stale = state.getInventory()
			.find(row => state.classifyEfaExperimentalElixir(row).status === "stale");
		const active = state.getEfaExperimentalElixirActiveEffects()[0];
		const innate = getOwnedInnate(state);
		const resource = state.getResources().find(it => it.ownerUid === CharacterSheetState.EFA_ALCHEMIST_SUBCLASS_UID);
		const fixedSpell = state.getSpellsKnown().find(it => it.sourceFeature === "Alchemist Spells");
		return {
			valid: {
				itemId: valid?.id,
				generatedItemId: valid?.item?._generatedItemId,
				metadata: copy(valid?.item?._generatedItemProvenance?.metadata),
			},
			stale: {
				itemId: stale?.id,
				reason: state.classifyEfaExperimentalElixir(stale).reason,
			},
			active: {
				stateId: active?.stateId,
				effectKey: active?.metadata?.effectKey,
			},
			innate: innate ? {
				id: innate.id,
				ownerUid: innate.ownerUid,
				grantId: innate.grantId,
				linkedResourceId: innate.linkedResourceId,
				current: innate.uses?.current,
				max: innate.uses?.max,
			} : null,
			resource: resource ? {
				id: resource.id,
				ownerUid: resource.ownerUid,
				grantId: resource.grantId,
				linkedInnateSpellId: resource.linkedInnateSpellId,
				current: resource.current,
				max: resource.max,
			} : null,
			fixedSpellOwners: copy(fixedSpell?.subclassSpellGrantOwners),
		};
	};

	const makePersistentState = () => {
		const state = makeState(15);
		addLifecycleArtifacts(state);
		const innate = getOwnedInnate(state);
		expect(innate).toBeDefined();
		expect(state.useInnateSpell(innate.id)).toBe(true);
		return state;
	};

	test("toJson/loadFromJson and repeated reconcile preserve valid, stale, effect, and owner identities idempotently", () => {
		const state = makePersistentState();
		const expected = getPersistenceSnapshot(state);
		const saved = state.toJson();
		const loaded = new CharacterSheetState();
		loaded.setSpellData(XPHB_SPELLS);

		expect(loaded.loadFromJson(saved)).not.toBe(false);
		expect(getPersistenceSnapshot(loaded)).toEqual(expected);

		const once = loaded.toJson();
		expect(loaded.loadFromJson(once)).not.toBe(false);
		loaded.reconcileEfaExperimentalElixirs({cause: "persistence-hardening-test"});
		expect(getPersistenceSnapshot(loaded)).toEqual(expected);
		expect(loaded.toJson()).toEqual(once);
	});

	test("the export/import handler round-trips the combined exact-owner payload without duplicating resources", async () => {
		const source = makePersistentState();
		const expected = getPersistenceSnapshot(source);
		const page = {
			addCharacter: jest.fn().mockResolvedValue(undefined),
			renderCharacter: jest.fn(),
			saveCharacter: jest.fn().mockResolvedValue(undefined),
		};
		const exporter = Object.create(CharacterSheetExport.prototype);
		exporter._state = source;
		exporter._page = page;
		const exported = exporter._getCharacterExportData();

		const imported = await exporter._importCharacterData({
			status: "passed",
			displayName: "Exact EFA Alchemist",
			character: exported,
		});

		expect(page.addCharacter).toHaveBeenCalledWith(imported);
		expect(page.renderCharacter).toHaveBeenCalledTimes(1);
		expect(page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(getPersistenceSnapshot(imported)).toEqual(expected);
		expect(imported.getInnateSpells().filter(it => it.ownerUid === CharacterSheetState.EFA_ALCHEMIST_SUBCLASS_UID)).toHaveLength(2);
		expect(imported.getResources().filter(it => it.ownerUid === CharacterSheetState.EFA_ALCHEMIST_SUBCLASS_UID)).toHaveLength(2);
	});

	test("source loss cleans supported exact data but preserves repair-required and independent rows", () => {
		const state = makePersistentState();
		const saved = state.toJson();
		saved.classes[0].source = "TCE";
		const staleId = saved.inventory
			.find(row => row.item?._generatedItemProvenance?.metadata?.metadataSchemaVersion === 999).id;
		const customId = saved.inventory
			.find(row => row.item?._isCustom && !row.item?._generatedItemProvenance).id;
		const tceId = saved.inventory
			.find(row => row.item?._generatedItemProvenance?.owner?.classUid === "Artificer|TCE").id;
		const independentStateId = saved.activeStates.find(it => it.name === "Independent Flight").id;

		const loaded = new CharacterSheetState();
		loaded.setSpellData(XPHB_SPELLS);
		expect(loaded.loadFromJson(saved)).not.toBe(false);

		expect(loaded.getEfaExperimentalElixirRows()).toEqual([]);
		expect(loaded.getEfaExperimentalElixirActiveEffects()).toEqual([]);
		expect(loaded.getInventory().some(row => row.id === staleId)).toBe(true);
		expect(loaded.getInventory().some(row => row.id === customId)).toBe(true);
		expect(loaded.getInventory().some(row => row.id === tceId)).toBe(true);
		expect(loaded.getActiveStates().some(it => it.id === independentStateId)).toBe(true);
		expect(loaded.getInnateSpells().some(it => it.ownerUid === CharacterSheetState.EFA_ALCHEMIST_SUBCLASS_UID)).toBe(false);
		expect(loaded.getResources().some(it => it.ownerUid === CharacterSheetState.EFA_ALCHEMIST_SUBCLASS_UID)).toBe(false);
	});
});
