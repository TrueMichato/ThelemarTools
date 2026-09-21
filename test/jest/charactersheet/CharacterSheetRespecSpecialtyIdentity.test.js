import "./setup.js";
import fs from "node:fs";
import path from "node:path";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetProgression = globalThis.CharacterSheetProgression;
const CharacterSheetState = globalThis.CharacterSheetState;

const FIXTURE = JSON.parse(fs.readFileSync(
	path.resolve(process.cwd(), "test/jest/charactersheet/fixtures/respec-juli-minimized.json"),
	"utf8",
));

const copy = value => JSON.parse(JSON.stringify(value));

function getState (specialtyName = "Showoff") {
	const state = new CharacterSheetState();
	expect(state.loadFromJson(copy(FIXTURE.state))).not.toBe(false);
	const history = state.getLevelHistoryEntry(13);
	history.decisions = [];
	history.choices.featureChoices[0] = {
		...history.choices.featureChoices[0],
		choice: specialtyName,
		ref: `${specialtyName}|Bard|TGTT|2`,
	};
	history.choices.replayData.featureChoices[0] = {
		...history.choices.replayData.featureChoices[0],
		name: specialtyName,
		ref: `${specialtyName}|Bard|TGTT|2`,
	};
	state._data.features = [{
		...copy(FIXTURE.catalogs[specialtyName.toLowerCase()]),
		parentFeature: "Specialties",
		acquisitionLevel: 13,
	}];
	return state;
}

function getPage (state) {
	return {
		getState: () => state,
		getClasses: () => [copy(FIXTURE.catalogs.bard)],
		getClassFeatures: () => [
			copy(FIXTURE.catalogs.specialties),
			copy(FIXTURE.catalogs.showoff),
			copy(FIXTURE.catalogs.townie),
		],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getFeats: () => [
			copy(FIXTURE.catalogs.boon),
			copy(FIXTURE.catalogs.replacementFeat),
			copy(FIXTURE.catalogs.spellRecallBoon),
		],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => ["stealth", "intimidation", "acrobatics", "persuasion"],
		filterByAllowedSources: values => values,
	};
}

function getSpecialtyGraph (specialtyName) {
	const state = getState(specialtyName);
	const manifest = CharacterSheetProgression.buildManifest({page: getPage(state), state});
	const parent = manifest.decisions.find(decision =>
		decision.type === "featureChoice"
		&& decision.label === "Specialties"
		&& Number(decision.characterLevel) === 13,
	);
	const children = manifest.decisions.filter(decision =>
		decision.type === "nestedSkillBonus"
		&& decision.parentSemanticKey === parent?.semanticKey,
	);
	return {state, manifest, parent, children};
}

describe("Character Sheet Respec Specialty opportunity identity", () => {
	it("discovers the generic proficient-skill bonus rule from real feature prose", () => {
		const descriptors = CharacterSheetClassUtils.getChoiceDescriptors(FIXTURE.catalogs.showoff);

		expect(descriptors).toEqual([
			expect.objectContaining({
				kind: "skillBonus",
				count: 1,
				grantKey: "Showoff.prose.skillBonus",
				rules: expect.objectContaining({
					identityMode: "opportunity",
					bonusFormula: "proficiencyBonus",
					requiresCurrentProficiency: true,
					optionSource: {kind: "proficientSkillsAtDecision"},
				}),
			}),
		]);
	});

	it("emits one exact Showoff child from the real producer context", () => {
		const {parent, children} = getSpecialtyGraph("Showoff");

		expect(parent).toMatchObject({
			status: "resolved",
			selection: [expect.objectContaining({choice: "Showoff"})],
		});
		expect(children).toEqual([
			expect.objectContaining({
				status: "resolved",
				selection: "stealth",
				options: ["intimidation", "stealth"],
				parentSemanticKey: parent.semanticKey,
				rootSemanticKey: parent.semanticKey,
				depth: 1,
				provenance: expect.objectContaining({
					ownerUid: "showoff|tgtt",
					grantKind: "skillBonus",
					grantKey: "Showoff.prose.skillBonus",
				}),
			}),
		]);
		expect(children[0].semanticKey).toBe(CharacterSheetProgression.getNestedSemanticKey({
			parentSemanticKey: parent.semanticKey,
			acquisitionKey: children[0].provenance.acquisitionKey,
			grantKey: children[0].provenance.grantKey,
			occurrence: children[0].provenance.occurrence,
			slot: children[0].provenance.pickSlot,
			identityMode: children[0].meta.descriptorRules.identityMode,
		}));
	});

	it("keeps one opportunity key stable when its selected skill changes", () => {
		const shared = {
			parentSemanticKey: "bard|tgtt:cl13:featurechoice:specialties:slot0",
			acquisitionKey: "featurechoice:showoff-tgtt:cl13:specialties:occ0",
			grantKey: "Showoff.prose.skillBonus",
			occurrence: 0,
			slot: 0,
			identityMode: "opportunity",
		};

		expect(CharacterSheetProgression.getNestedSemanticKey({...shared, selectedGrantKey: "stealth"}))
			.toBe(CharacterSheetProgression.getNestedSemanticKey({...shared, selectedGrantKey: "intimidation"}));
	});

	it("keeps Showoff and Townie branch opportunities distinct", () => {
		const showoff = getSpecialtyGraph("Showoff");
		const townie = getSpecialtyGraph("Townie");

		expect(showoff.parent.semanticKey).toBe(townie.parent.semanticKey);
		expect(showoff.children).toHaveLength(1);
		expect(townie.children).toHaveLength(1);
		expect(showoff.children[0].semanticKey).not.toBe(townie.children[0].semanticKey);
		expect(CharacterSheetProgression.getNestedSemanticKey({
			parentSemanticKey: showoff.parent.semanticKey,
			acquisitionKey: "featurechoice:showoff-tgtt:cl13:specialties:occ0",
			grantKey: "prose.skillBonus",
			identityMode: "opportunity",
		})).not.toBe(CharacterSheetProgression.getNestedSemanticKey({
			parentSemanticKey: townie.parent.semanticKey,
			acquisitionKey: "featurechoice:townie-tgtt:cl13:specialties:occ0",
			grantKey: "prose.skillBonus",
			identityMode: "opportunity",
		}));
	});

	it("does not collide distinct sibling opportunities under one branch", () => {
		const shared = {
			parentSemanticKey: "parent",
			acquisitionKey: "branch",
			occurrence: 0,
			identityMode: "opportunity",
		};
		const first = CharacterSheetProgression.getNestedSemanticKey({...shared, grantKey: "first", slot: 0});
		const second = CharacterSheetProgression.getNestedSemanticKey({...shared, grantKey: "second", slot: 0});

		expect(first).not.toBe(second);
	});
});
