import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import "../../../js/charactersheet/charactersheet-modal.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetProgression = globalThis.CharacterSheetProgression;
const CharacterSheetModal = globalThis.CharacterSheetModal;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;
const CharacterSheetState = globalThis.CharacterSheetState;

const copy = value => JSON.parse(JSON.stringify(value));

const spell = (name, level, className = "Bard") => ({
	name,
	source: "TGTT",
	level,
	classes: {fromClassList: [{name: className, source: className === "Bard" ? "TGTT" : "XPHB"}]},
});

const BARD_SPELLS = [
	spell("Low A", 1),
	spell("Low B", 1),
	spell("High A", 2),
	spell("High B", 2),
	spell("High C", 2),
	spell("Borrowed Secret", 5, "Wizard"),
	spell("Bard Secret", 5),
	spell("Mocking Note", 0),
];

function getBard ({level = 3, knownProgression = [3, 3, 4], cantripProgression = [1, 1, 1]} = {}) {
	return {
		name: "Bard",
		source: "TGTT",
		edition: "one",
		hd: {faces: 8},
		casterProgression: "full",
		spellcastingAbility: "cha",
		preparedSpellsProgression: knownProgression,
		cantripProgression,
		classFeatures: [],
		subclass: {name: "Jester", shortName: "Jester", source: "TGTT"},
		level,
	};
}

function getState ({
	level = 3,
	bard = getBard({level}),
	known = BARD_SPELLS.slice(0, 4),
	cantrips = [BARD_SPELLS.at(-1)],
} = {}) {
	const state = new CharacterSheetState();
	state.setSpellData(BARD_SPELLS);
	state.addClass(copy(bard));
	state.setSubclass("Bard", copy(bard.subclass));
	for (let ix = 1; ix <= level; ++ix) {
		state.recordLevelChoice({
			level: ix,
			class: {name: "Bard", source: "TGTT"},
			choices: ix === 3 ? {subclass: copy(bard.subclass)} : {},
		});
	}
	for (const entry of known) {
		state.addSpell({
			...entry,
			sourceClass: "Bard",
			sourceFeature: "Spells Known",
		});
	}
	for (const entry of cantrips) {
		state.addCantrip({
			...entry,
			sourceClass: "Bard",
			sourceFeature: "Cantrips Known",
		});
	}
	return state;
}

function addStaleReconstructedLedger (state) {
	const entry = state.getLevelHistoryEntry(1);
	const semanticKey = CharacterSheetProgression.getSemanticKey({
		className: "Bard",
		classSource: "TGTT",
		classLevel: 1,
		type: "knownSpells",
		sourceKey: "known-spells",
		slot: 0,
	});
	entry.decisions = [{
		id: CharacterSheetProgression.getDecisionId({semanticKey, characterLevel: 1}),
		semanticKey,
		characterLevel: 1,
		className: "Bard",
		classSource: "TGTT",
		classLevel: 1,
		type: "knownSpells",
		label: "Spells Known",
		sourceKey: "known-spells",
		slot: 0,
		required: true,
		count: 3,
		options: [],
		selection: copy(BARD_SPELLS.slice(0, 2).concat(BARD_SPELLS[2])),
		status: "invalid",
		meta: {maxSpellLevel: 1},
		scope: "level",
		parentSemanticKey: null,
		rootSemanticKey: semanticKey,
		depth: 0,
		provenance: null,
		receipt: null,
	}];
	entry.manifestComplete = true;
}

function getPage (state, bard = state.getClasses()[0]) {
	return {
		getState: () => state,
		getClasses: () => [copy(bard)],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [],
		getSpells: () => copy(BARD_SPELLS),
		getFilteredSpellData: () => copy(BARD_SPELLS),
		getSkillsList: () => [],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
	};
}

function getSpellNames (state) {
	return state.getSpellsKnown().map(it => it.name).sort();
}

function getDescendants (root) {
	return [root, ...(root?._children || []).flatMap(getDescendants)];
}

describe("Character Sheet Respec cumulative Bard spell choices", () => {
	it("replaces Juli-style false per-level reconstruction with stable cumulative repertoire decisions", () => {
		const state = getState();
		addStaleReconstructedLedger(state);

		const manifest = CharacterSheetProgression.buildManifest({page: getPage(state), state});
		const known = manifest.decisions.filter(it => it.type === "knownSpells");
		const cantrips = manifest.decisions.filter(it => it.type === "cantrips");

		expect(known).toEqual([
			expect.objectContaining({
				characterLevel: 3,
				classLevel: 3,
				count: 4,
				status: "resolved",
				sourceKey: "legacy-known-spell-repertoire",
				selection: expect.arrayContaining(BARD_SPELLS.slice(0, 4).map(it => expect.objectContaining({name: it.name}))),
				meta: expect.objectContaining({legacyCumulative: true}),
			}),
		]);
		expect(cantrips).toEqual([
			expect.objectContaining({
				characterLevel: 3,
				count: 1,
				status: "resolved",
				sourceKey: "legacy-cantrip-repertoire",
				meta: expect.objectContaining({legacyCumulative: true}),
			}),
		]);
		expect(manifest.unresolved.filter(it => ["knownSpells", "cantrips"].includes(it.type))).toEqual([]);
	});

	it("uses the level-10 TGTT Bard Magical Secrets lists for the cumulative leveled-spell opportunity", () => {
		const bard = getBard({
			level: 10,
			knownProgression: [1, 1, 1, 1, 1, 1, 1, 1, 1, 2],
			cantripProgression: Array(10).fill(0),
		});
		const state = getState({
			level: 10,
			bard,
			known: [BARD_SPELLS[6], BARD_SPELLS[5]],
			cantrips: [],
		});

		const manifest = CharacterSheetProgression.buildManifest({page: getPage(state, bard), state});
		const decision = manifest.decisions.find(it => it.type === "knownSpells");

		expect(decision).toMatchObject({
			characterLevel: 10,
			count: 2,
			status: "resolved",
			meta: {
				legacyCumulative: true,
				additionalClassNames: ["Cleric", "Druid", "Wizard"],
			},
		});
		expect(decision.options.map(it => it.name)).toEqual(expect.arrayContaining(["Borrowed Secret", "Bard Secret"]));
	});

	it("keeps an invalid historical spell visible so the repair editor can remove it", () => {
		const legal = [BARD_SPELLS.at(-1)];
		const invalid = spell("Borrowed Cantrip", 0, "Cleric");
		const {options, invalidOptionKeys} = CharacterSheetRespec._getDecisionEditorOptions(legal, [legal[0], invalid]);

		expect(options).toEqual([
			legal[0],
			expect.objectContaining({
				name: "Borrowed Cantrip",
				source: "TGTT",
			}),
		]);
		expect(invalidOptionKeys).toEqual(new Set(["borrowed cantrip|tgtt"]));

		expect(CharacterSheetRespec._getDecisionEditorOptions(["arcana"], ["arcana", "legacy lore"])).toEqual({
			options: ["arcana", "legacy lore"],
			invalidOptionKeys: new Set(["legacy lore"]),
		});
	});

	it("lets the repair flow replace an illegal historical cantrip instead of silently restaging it", async () => {
		const legal = BARD_SPELLS.at(-1);
		const replacement = spell("Bright Note", 0);
		const invalid = spell("Borrowed Cantrip", 0, "Cleric");
		const bard = getBard({cantripProgression: [2, 2, 2]});
		const state = getState({bard, cantrips: [legal, invalid]});
		const spells = [...BARD_SPELLS, replacement, invalid];
		state.setSpellData(spells);
		const page = getPage(state, bard);
		page.getSpells = () => copy(spells);
		page.getFilteredSpellData = () => copy(spells);
		const respec = new CharacterSheetRespec({page, state});
		respec._engine.begin();
		respec._state = respec._engine.state;
		respec.render = jest.fn();
		const decision = respec._engine.manifest.decisions.find(it => it.type === "cantrips");
		expect(decision).toMatchObject({count: 2, status: "invalid"});

		const modalInner = e_({tag: "div"});
		const originalPGetShow = CharacterSheetModal.pGetShow;
		CharacterSheetModal.pGetShow = async () => ({
			eleModalInner: modalInner,
			doClose: jest.fn(),
		});

		try {
			await respec._showSpellRepairFlow([decision.id], jest.fn());
			const rows = getDescendants(modalInner).filter(it => it._clazz?.includes("charsheet__respec-option"));
			const invalidRow = rows.find(row => row._children?.[1]?.textContent?.includes("Borrowed Cantrip"));
			const replacementRow = rows.find(row => row._children?.[1]?.textContent?.includes("Bright Note"));

			expect(invalidRow?._children?.[1]?.textContent).toContain("currently selected, no longer legal");
			expect(invalidRow?._children?.[0]?.checked).toBe(true);
			invalidRow._children[0].checked = false;
			invalidRow._children[0]._handlers.change();
			replacementRow._children[0].checked = true;
			replacementRow._children[0]._handlers.change();

			const finish = getDescendants(modalInner).find(it => it.textContent === "Stage & Finish");
			finish.click();
			expect(respec._state.getCantrips().map(it => it.name).sort()).toEqual([legal.name, replacement.name].sort());
			expect(respec._engine.getDecision(decision.id)).toMatchObject({
				status: "resolved",
				selection: expect.arrayContaining([
					expect.objectContaining({name: legal.name}),
					expect.objectContaining({name: replacement.name}),
				]),
			});
			await respec._engine.apply();
			expect(state.getCantrips().map(it => it.name).sort()).toEqual([legal.name, replacement.name].sort());

			const loaded = new CharacterSheetState();
			loaded.setSpellData(spells);
			expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
			expect(loaded.getCantrips().map(it => it.name).sort()).toEqual([legal.name, replacement.name].sort());
		} finally {
			CharacterSheetModal.pGetShow = originalPGetShow;
		}
	});

	it("reconfigures the cumulative repertoire with Cancel, Apply/reload, and one-step Undo", async () => {
		const state = getState();
		expect(state.loadFromJson(state.toJson())).not.toBe(false);
		state.setSpellData(BARD_SPELLS);
		const page = getPage(state);
		const respec = new CharacterSheetRespec({page, state});
		const original = state.toJson();

		respec._engine.begin();
		respec._state = respec._engine.state;
		let decision = respec._engine.manifest.decisions.find(it => it.type === "knownSpells");
		const replacement = [BARD_SPELLS[0], BARD_SPELLS[1], BARD_SPELLS[2], BARD_SPELLS[4]];
		respec._engine.stageGraphMutation(decision.id, replacement, {
			apply: ({state: candidate}) => respec._applyManifestSelectionMechanics(decision, replacement, decision.options, candidate),
		});

		expect(getSpellNames(respec._state)).toEqual(replacement.map(it => it.name).sort());
		respec._engine.cancel();
		expect(state.toJson()).toEqual(original);

		respec._engine.begin();
		respec._state = respec._engine.state;
		decision = respec._engine.manifest.decisions.find(it => it.type === "knownSpells");
		await respec._engine.stageGraphMutation(decision.id, replacement, {
			apply: ({state: candidate}) => respec._applyManifestSelectionMechanics(decision, replacement, decision.options, candidate),
		});
		expect(respec._engine.getValidation().errors).toEqual([]);
		await respec._engine.apply();
		expect(getSpellNames(state)).toEqual(replacement.map(it => it.name).sort());

		const loaded = new CharacterSheetState();
		loaded.setSpellData(BARD_SPELLS);
		expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: getPage(loaded), state: loaded});
		reopened._engine.begin();
		const persisted = reopened._engine.manifest.decisions.find(it => it.type === "knownSpells");
		expect(persisted).toMatchObject({
			status: "resolved",
			meta: expect.objectContaining({legacyCumulative: true}),
		});
		expect(persisted.selection.map(it => it.name).sort()).toEqual(replacement.map(it => it.name).sort());

		expect(await respec._engine.undo()).toBe(true);
		expect(state.toJson()).toEqual(original);
		expect(await respec._engine.undo()).toBe(false);
	});
});
