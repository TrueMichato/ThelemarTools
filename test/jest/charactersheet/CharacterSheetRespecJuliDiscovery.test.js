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

function getState () {
	const state = new CharacterSheetState();
	expect(state.loadFromJson(copy(FIXTURE.state))).not.toBe(false);
	state._data.race = copy(FIXTURE.catalogs.dendulra);
	return state;
}

function getPage (state) {
	return {
		getState: () => state,
		getClasses: () => [{
			...copy(FIXTURE.catalogs.bard),
			subclasses: [copy(FIXTURE.catalogs.jester)],
		}],
		getClassFeatures: () => [
			copy(FIXTURE.catalogs.specialties),
			copy(FIXTURE.catalogs.showoff),
			copy(FIXTURE.catalogs.townie),
		],
		getSubclassFeatures: () => [
			copy(FIXTURE.catalogs.jesterBonusProficiencies),
			copy(FIXTURE.catalogs.jesterActs),
			copy(FIXTURE.catalogs.jesterActsOptions),
		],
		getOptionalFeatures: () => copy(FIXTURE.catalogs.jesterActOptions),
		getFeats: () => [
			copy(FIXTURE.catalogs.boon),
			copy(FIXTURE.catalogs.replacementFeat),
			copy(FIXTURE.catalogs.spellRecallBoon),
		],
		getSpells: () => [],
		getFilteredSpellData: () => [],
		getSkillsList: () => ["stealth", "intimidation", "performance", "acrobatics", "persuasion"],
		filterByAllowedSources: values => values,
	};
}

describe("Character Sheet Respec minimized Juli choice discovery", () => {
	it("does not infer choices from Dendulra's structured fixed spell grants", () => {
		const descriptors = CharacterSheetClassUtils.getChoiceDescriptors(FIXTURE.catalogs.dendulra);

		expect(descriptors.filter(descriptor => ["cantrip", "spell"].includes(descriptor.kind))).toEqual([]);
	});

	it("leaves Jester's Acts pool ownership to optionalfeatureProgression", () => {
		const state = getState();
		const manifest = CharacterSheetProgression.buildManifest({page: getPage(state), state});

		expect(manifest.decisions.filter(decision =>
			decision.type === "nestedEntity"
			&& decision.label === "Jester's Acts Options",
		)).toEqual([]);
		expect(manifest.decisions.filter(decision =>
			decision.type === "optionalFeatures"
			&& decision.label === "Jester's Acts",
		)).not.toHaveLength(0);
	});

	it("surfaces only the selectable part of Jester Bonus Proficiencies", () => {
		const state = getState();
		const manifest = CharacterSheetProgression.buildManifest({page: getPage(state), state});
		const decisions = manifest.decisions.filter(decision =>
			decision.type === "nestedSkill"
			&& decision.provenance?.ownerUid === "bonus proficiencies|tgtt",
		);

		expect(decisions).toHaveLength(1);
		expect(decisions[0]).toMatchObject({
			label: "Bonus Proficiencies",
			required: true,
			status: "missing",
			options: ["acrobatics", "persuasion"],
		});
	});

	it("removes only Juli's false discovery blockers", () => {
		const state = getState();
		const manifest = CharacterSheetProgression.buildManifest({page: getPage(state), state});
		const falseRows = manifest.decisions.filter(decision =>
			(
				decision.type === "nestedCantrip"
				&& decision.provenance?.ownerUid === "dendulra|tgtt"
			)
			|| (
				decision.type === "nestedEntity"
				&& decision.label === "Jester's Acts Options"
			),
		);
		const legitimateRows = manifest.decisions.filter(decision =>
			decision.type === "nestedSkill"
			&& decision.provenance?.ownerUid === "bonus proficiencies|tgtt",
		);

		expect(falseRows).toEqual([]);
		expect(legitimateRows).toEqual([
			expect.objectContaining({
				type: "nestedSkill",
				label: "Bonus Proficiencies",
				status: "missing",
			}),
		]);
	});
});
