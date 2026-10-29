import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";
import {CharacterSheetPdf} from "../../../js/charactersheet/charactersheet-pdf.js";

const State = globalThis.CharacterSheetState;
const copy = value => JSON.parse(JSON.stringify(value));

function makeCompanion (source = "XPHB") {
	const owner = new State();
	owner.setId("pdf-original");
	owner.setName("Original Caster");
	owner.addClass({name: "Wizard", source: "PHB", level: 5, spellcastingAbility: "int"});
	owner.addClass({name: "Warlock", source: "PHB", level: 3, spellcastingAbility: "cha"});
	owner.setAbilityBase("int", 18);
	owner.setAbilityBase("cha", 16);
	owner.setSkillProficiency("arcana", 2);
	owner.addSaveProficiency("wis");
	owner.recalculateHp({syncCurrent: true});
	owner.setSpellcastingAbility("int");
	owner.addSpell({name: "Shield", source: "PHB", level: 1, sourceClass: "Wizard", sourceClassSource: "PHB"}, true);
	owner.addSpell({name: "Shield", source: "XPHB", level: 1, sourceClass: "Warlock", sourceClassSource: "PHB"}, true);
	owner.addCantrip({name: "Fire Bolt", source: "PHB", level: 0, sourceClass: "Wizard", sourceClassSource: "PHB"});
	owner.addResource({id: "ice-pool", name: "Ice Pool", current: 1, max: 3, recharge: "long"});
	owner.addInnateSpell({name: "Misty Step", source: "PHB", level: 2, sourceFeature: "Winter Gift", uses: {current: 1, max: 1}, recharge: "long", spellcastingAbility: "cha"});
	owner.addFeature({name: "Ice Step", source: "PHB", featureType: "Class", description: "As a bonus action, teleport up to 15 feet to an unoccupied space you can see."});
	owner.addCustomAbility({name: "Ice Ward", mode: "limited", activationAction: "reaction", description: "As a reaction, reduce incoming damage by 3.", uses: {current: 1, max: 2}});
	const prepared = owner.prepareSimulacrumSnapshot({spellSource: source});
	expect(prepared.ok).toBe(true);
	const id = owner.addCompanion(prepared.companionData);
	const hydrated = owner.hydrateCompanionActor(id);
	const actor = hydrated.actor;
	actor.setSpellSlots(1, actor.getSpellSlotsMax(1), 0);
	actor.setPactSlotsCurrent(0);
	actor.setResourceCurrent("ice-pool", 0);
	actor._data.spellcasting.innateSpells[0].uses.current = 0;
	actor._data.customAbilities.find(entry => entry.name === "Ice Ward").uses.current = 0;
	actor.addCondition("poisoned");
	actor.addConcentration({kind: "spell", name: "Haste", spellName: "Haste"});
	actor.setHp(7, actor.getMaxHp(), 2);
	expect(owner.commitCompanionActor(id, hydrated).ok).toBe(true);
	return {owner, id};
}

describe("persisted Simulacrum PDF", () => {
	test("prints saved HP, ordinary/Pact/innate/limited pools, conditions and concentration without hydration or refill", () => {
		const {owner, id} = makeCompanion();
		const before = copy(owner._data);
		const hydrate = jest.spyOn(owner, "hydrateCompanionActor").mockImplementation(() => { throw new Error("PDF must not hydrate/refill an actor"); });
		const pdf = new CharacterSheetPdf(owner);
		const presentation = pdf._getCompanionPdfPresentation(owner.getCompanion(id));
		const html = pdf._renderCompanionBlock(presentation);

		expect(presentation).toMatchObject({kind: "simulacrum", hpCurrent: 7, hpMax: before.companions[0].actorSnapshot.state.hp.max});
		expect(presentation.resourceRows).toEqual(expect.arrayContaining([
			["Level 1 slots", "0/4"],
			["Pact Magic (level 2)", "0/2"],
			["Ice Pool", "0/3"],
			["Misty Step (PHB)", "0/1"],
			["Ice Ward", "0/2"],
		]));
		expect(presentation.metaRows).toEqual(expect.arrayContaining([
			["Conditions", expect.stringContaining("poisoned")], ["Concentration", "Haste"], ["Temporary HP", "2"],
		]));
		expect(html).toContain("0/4");
		expect(html).toContain("0 slots remaining");
		expect(hydrate).not.toHaveBeenCalled();
		expect(owner._data).toEqual(before);
		hydrate.mockRestore();
	});

	test("uses frozen level/PB and saved statblock saves, skills, actions, reactions and edition-qualified casting", () => {
		const {owner, id} = makeCompanion();
		const companion = owner.getCompanion(id);
		const savedBlock = copy(companion.statblock);
		owner._data.classes[0].level = 20;
		owner.setAbilityBase("int", 24);
		owner.setSkillProficiency("arcana", 0);
		const presentation = new CharacterSheetPdf(owner)._getCompanionPdfPresentation(companion);
		expect(presentation.metaRows).toEqual(expect.arrayContaining([
			["Frozen level", "8"], ["Frozen proficiency bonus", "+3"],
		]));
		expect(presentation.abilities.int).toBe(18);
		expect(presentation.metaRows.find(([label]) => label === "Saving Throws")[1]).toContain(`WIS ${savedBlock.save.wis}`);
		expect(presentation.metaRows.find(([label]) => label === "Skills")[1]).toContain(`Arcana ${savedBlock.skill.arcana}`);
		expect(presentation.actions.some(entry => /unarmed/i.test(entry.name))).toBe(true);
		expect(presentation.bonusActions.some(entry => entry.name === "Ice Step")).toBe(true);
		expect(presentation.reactions.some(entry => entry.name === "Ice Ward")).toBe(true);
		const text = presentation.spellcasting.map(entry => entry.description).join(" ");
		expect(text).toContain("Shield (PHB)");
		expect(text).toContain("Shield (XPHB)");
		expect(text).toContain("shared across class lists");
	});

	test.each(["PHB", "XPHB"])("prints exact %s restrictions and lifecycle after save/reload", source => {
		const {owner, id} = makeCompanion(source);
		const loaded = new State();
		loaded.loadFromJson(owner.toJson());
		const pdf = new CharacterSheetPdf(loaded);
		const html = pdf._renderCompanions();
		expect(html).toContain(`Simulacrum • ${source}`);
		expect(html).toContain("Simulacrum Restrictions");
		expect(html).toContain("100 gp per HP actually restored");
		if (source === "XPHB") {
			expect(html).toContain("cannot take Short or Long Rests or cast Simulacrum");
			expect(html).toContain("within 5 feet");
		} else {
			expect(html).toContain("never regains expended spell slots");
			expect(html).toContain("alchemical laboratory");
		}
		expect(loaded.getCompanion(id).actorSnapshot.state.spellcasting.spellSlots[1].current).toBe(0);
	});

	test("preserves complete nested list/table feature text with safe escaping", () => {
		const {owner, id} = makeCompanion();
		const companion = owner.getCompanion(id);
		companion.statblock.trait.push({name: "Winter <Gift>",
			entries: [
				{type: "list", items: ["First effect.", {type: "item", name: "Second effect", entry: "Do not omit me."}]},
				{type: "table", rows: [["Ice", "3 damage"]]},
			]});
		const html = new CharacterSheetPdf(owner)._renderCompanions();
		expect(html).toContain("Winter &lt;Gift&gt;");
		expect(html).toContain("First effect.");
		expect(html).toContain("Second effect: Do not omit me.");
		expect(html).toContain("Ice; 3 damage");
	});

	test.each([null, {version: 999}])("shows actionable unavailable output for corrupt snapshots without original or stale summary fallback", invalid => {
		const {owner, id} = makeCompanion();
		const companion = owner.getCompanion(id);
		companion.actorSnapshot = invalid;
		companion.hp = {current: 9999, max: 9999};
		companion.ac = 9999;
		const html = new CharacterSheetPdf(owner)._renderCompanions();
		expect(html).toContain("Simulacrum actor unavailable");
		expect(html).toContain("backup");
		expect(html).toContain("not substituted");
		expect(html).not.toContain("9999");
		expect(html).not.toContain("pdf-companion__stats");
	});

	test("shows unavailable output rather than fabricated statistics when the saved statblock is missing", () => {
		const {owner, id} = makeCompanion();
		delete owner.getCompanion(id).statblock;
		expect(new CharacterSheetPdf(owner)._renderCompanions()).toContain("Simulacrum actor unavailable");
	});

	test.each(["armor", "languages", "concentration"])("prints recovery guidance for malformed saved %s presentation without changing the saved record", malformed => {
		const {owner, id} = makeCompanion();
		const companion = owner.getCompanion(id);
		if (malformed === "armor") companion.statblock.ac = [null];
		else if (malformed === "languages") companion.statblock.languages = "Common";
		else companion.actorSnapshot.state.concentrations = [null];
		const before = copy(companion);
		expect(new CharacterSheetPdf(owner)._renderCompanions()).toContain("Simulacrum actor unavailable");
		expect(owner.getCompanion(id)).toEqual(before);
	});

	test("retains a corrupt saved pool verbatim and prints recovery guidance after reload", () => {
		const {owner, id} = makeCompanion();
		owner.getCompanion(id).actorSnapshot.state.spellcasting.spellSlots[1].current = "invalid";
		const saved = copy(owner._data);
		const loaded = new State();
		loaded.loadFromJson(saved);
		expect(new CharacterSheetPdf(loaded)._renderCompanions()).toContain("Simulacrum actor unavailable");
		expect(loaded.getCompanion(id).actorSnapshot).toEqual(saved.companions[0].actorSnapshot);
	});

	test("prints a destroyed generation at zero HP with spent pools retained", () => {
		const {owner, id} = makeCompanion();
		const companion = owner.getCompanion(id);
		companion.actorSnapshot.lifecycle = "destroyed";
		companion.actorSnapshot.state.hp.current = 0;
		companion.active = false;
		const presentation = new CharacterSheetPdf(owner)._getCompanionPdfPresentation(companion);
		expect(presentation.hpCurrent).toBe(0);
		expect(presentation.metaRows).toContainEqual(["Lifecycle", "Destroyed"]);
		expect(presentation.resourceRows).toContainEqual(["Level 1 slots", "0/4"]);
	});
});
