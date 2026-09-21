import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetProgression = globalThis.CharacterSheetProgression;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;
const CharacterSheetState = globalThis.CharacterSheetState;

const copy = value => JSON.parse(JSON.stringify(value));

const CLASS = {
	name: "Test Class",
	source: "TST",
	level: 4,
	hd: {faces: 8},
	classFeatures: [],
	subclasses: [{name: "Test Subclass", shortName: "Test", source: "TST"}],
};

const PLACED_FEAT = {id: "feat-placed", name: "Placed Feat", source: "TST"};

const FEATS = [
	{
		id: "feat-war-caster",
		name: "War Caster",
		source: "XPHB",
		category: "G",
		ability: [{choose: {from: ["int", "wis", "cha"], count: 1, amount: 1}}],
		choices: {ability: "wis"},
	},
	{
		id: "feat-lucky",
		name: "Lucky",
		source: "PHB",
		reprintedAs: ["Lucky|XPHB"],
	},
	{
		id: "feat-skill-expert",
		name: "Skill Expert",
		source: "XPHB",
		category: "G",
		ability: [{choose: {from: ["str", "dex", "con", "int", "wis", "cha"], count: 1, amount: 1}}],
		skillProficiencies: [{any: 1}],
		expertise: [{anyProficientSkill: 1}],
		choices: {
			ability: "con",
			skills: ["Engineering"],
			expertise: ["persuasion"],
		},
	},
];

function getState ({missingSkillExpertEvidence = false} = {}) {
	const state = new CharacterSheetState();
	state.addClass(copy(CLASS));
	for (let level = 1; level <= 4; level++) {
		state.recordLevelChoice({
			level,
			class: {name: CLASS.name, source: CLASS.source},
			choices: level === 3
				? {subclass: {name: "Test Subclass", shortName: "Test", source: "TST"}}
				: level === 4
					? {asi: {cha: 2}, feat: {name: PLACED_FEAT.name, source: PLACED_FEAT.source}}
					: {},
		});
	}
	state.addFeat(copy(PLACED_FEAT));
	for (const feat of FEATS) {
		const stored = copy(feat);
		if (missingSkillExpertEvidence && stored.name === "Skill Expert") {
			stored.choices = {ability: "con", skills: ["Engineering"]};
		}
		state.addFeat(stored);
	}
	return state;
}

function getPage (state) {
	return {
		getState: () => state,
		getClasses: () => [copy(CLASS)],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [copy(PLACED_FEAT), ...FEATS.map(copy)],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => ["Engineering", "Persuasion"],
		getRaces: () => [],
		getBackgrounds: () => [],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(undefined),
		renderCharacter: jest.fn(),
	};
}

function getUnplacedDecisions (manifest) {
	return manifest.base.decisions.filter(decision => decision.meta?.unplacedFeat);
}

function getFeatSnapshot (state) {
	return state.getFeats()
		.filter(feat => FEATS.some(expected => expected.name === feat.name && expected.source === feat.source))
		.map(feat => ({
			id: feat.id,
			name: feat.name,
			source: feat.source,
			level: feat.level ?? null,
			sourceDecisionKey: feat.sourceDecisionKey ?? null,
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

function getStubText (element) {
	return [
		element?.textContent || "",
		...(element?.children || []).map(getStubText),
	].filter(Boolean).join(" ");
}

describe("Character Sheet Respec unplaced feat provenance", () => {
	it("discovers stable unplaced decisions without attaching feats to ASI levels", () => {
		const state = getState();
		const manifest = CharacterSheetProgression.buildManifest({page: getPage(state), state});
		const decisions = getUnplacedDecisions(manifest);

		expect(decisions).toHaveLength(3);
		expect(decisions.map(decision => decision.selection.name).sort()).toEqual(["Lucky", "Skill Expert", "War Caster"]);
		for (const decision of decisions) {
			expect(decision).toMatchObject({
				characterLevel: null,
				classLevel: null,
				scope: "unplaced",
				required: false,
				status: "resolved",
				parentSemanticKey: null,
				meta: {
					unplacedFeat: true,
					featId: expect.any(String),
				},
			});
			expect(decision.semanticKey).toBe(CharacterSheetProgression.getUnplacedFeatSemanticKey(decision.selection));
		}
		const improvementDecisions = manifest.levels.flatMap(level => level.decisions)
			.filter(decision => ["asi", "feat", "asiOrFeat", "classFeatProgressionFeat"].includes(decision.type));
		expect(improvementDecisions.some(decision =>
			["Lucky", "Skill Expert", "War Caster"].includes(decision.selection?.name || decision.selection?.feat?.name),
		)).toBe(false);
	});

	it("shows recorded and unknown subchoice evidence on the Character Base card", () => {
		const state = getState({missingSkillExpertEvidence: true});
		const respec = new CharacterSheetRespec({page: getPage(state), state});

		respec._engine.begin();
		const text = getStubText(respec._renderBaseCard());
		const skillExpert = getUnplacedDecisions(respec._engine.manifest)
			.find(decision => decision.selection.name === "Skill Expert");

		expect(text).toContain("Unplaced feat history");
		expect(text).toContain("War Caster");
		expect(text).toContain("Ability: Wisdom");
		expect(text).toContain("Lucky");
		expect(text).toContain("No recorded build-time subchoices");
		expect(text).toContain("Skill Expert");
		expect(text).toContain("Skill: Engineering");
		expect(text).toContain("Expertise: Unknown");
		expect(skillExpert.meta.choiceEvidence).toMatchObject({
			recorded: {
				ability: "con",
				skills: ["Engineering"],
			},
			missing: ["expertise"],
		});
	});

	it("adopts exact feat IDs and receipts idempotently across Cancel, Apply/reload, and Undo", async () => {
		const state = getState();
		expect(state.loadFromJson(state.toJson())).not.toBe(false);
		const original = state.toJson();
		const originalSnapshot = getFeatSnapshot(state);
		const page = getPage(state);
		const respec = new CharacterSheetRespec({page, state});

		respec._engine.begin();
		const firstKeys = getUnplacedDecisions(respec._engine.manifest)
			.map(decision => decision.semanticKey)
			.sort();
		const adopted = getFeatSnapshot(respec._engine.state);
		expect(adopted.map(feat => feat.id)).toEqual(originalSnapshot.map(feat => feat.id));
		expect(adopted.every(feat => feat.sourceDecisionKey)).toBe(true);
		for (const decision of getUnplacedDecisions(respec._engine.manifest)) {
			expect(decision.receipt).toEqual(expect.objectContaining({
				sourceDecisionKey: decision.semanticKey,
				effects: expect.arrayContaining([
					expect.objectContaining({
						type: "materialized",
						feats: [expect.objectContaining({id: decision.meta.featId})],
					}),
				]),
			}));
		}

		await respec._engine.stageCandidateMutation(({state: candidate}) => candidate.setAlignment("CG"));
		respec._engine.cancel();
		expect(state.toJson()).toEqual(original);
		expect(getFeatSnapshot(state)).toEqual(originalSnapshot);

		respec._engine.begin();
		await respec._engine.stageCandidateMutation(({state: candidate}) => candidate.setAlignment("CG"));
		await respec._engine.apply();
		const appliedSnapshot = getFeatSnapshot(state);
		expect(appliedSnapshot).toHaveLength(3);
		expect(appliedSnapshot.map(feat => feat.id)).toEqual(originalSnapshot.map(feat => feat.id));
		expect(appliedSnapshot.every(feat => feat.sourceDecisionKey)).toBe(true);

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
		const reopened = new CharacterSheetRespec({page: getPage(loaded), state: loaded});
		reopened._engine.begin();
		const reopenedDecisions = getUnplacedDecisions(reopened._engine.manifest);
		expect(reopenedDecisions.map(decision => decision.semanticKey).sort()).toEqual(firstKeys);
		expect(reopenedDecisions.every(decision => decision.characterLevel == null && decision.classLevel == null)).toBe(true);
		expect(getFeatSnapshot(reopened._engine.state)).toEqual(appliedSnapshot);

		expect(await respec._engine.undo()).toBe(true);
		expect(state.toJson()).toEqual(original);
		expect(getFeatSnapshot(state)).toEqual(originalSnapshot);
		expect(await respec._engine.undo()).toBe(false);
	});
});
