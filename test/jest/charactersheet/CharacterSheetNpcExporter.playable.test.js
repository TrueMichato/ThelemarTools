import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";
import {getNpcExportSchemaErrors} from "../../util-npc-export-schema.js";

const State = globalThis.CharacterSheetState;
const Exporter = globalThis.CharacterSheetNpcExporter;
const bard = JSON.parse(fs.readFileSync("data/class/class-bard.json", "utf8"));
const feats = JSON.parse(fs.readFileSync("data/feats.json", "utf8")).feat;
const spells = JSON.parse(fs.readFileSync("data/spells/spells-phb.json", "utf8")).spell;
const all = m => ["trait", "action", "bonus", "reaction"].flatMap(section => m[section] || []);
const plain = value => Exporter._getPlainMatchTextCased(JSON.stringify(value));
const html = value => typeof value === "string" ? `<p>${value}</p>` : Array.isArray(value) ? value.map(html).join("") : html(value.entries || value.items || []);
const add = (state, feature, overrides = {}) => state.addFeature({...feature, description: html(feature.entries), ...overrides});
const feature = (name, source = "PHB") => bard.classFeature.find(row => row.name === name && row.source === source);
const makeBard = (level = 20) => {
	const state = new State({isDetached: true});
	state.setName("Test Musician");
	state.addClass({name: "Bard", source: "PHB", level});
	state.setSpellData([...spells]);
	state.setAbilityBase("cha", 18);
	state.setSpellSlots(1, 4, 4);
	state.addSpell({name: "Healing Word", source: "PHB", level: 1, sourceClass: "Bard"}, false);
	for (const name of ["Bardic Inspiration", "Bardic Inspiration (d8)", "Bardic Inspiration (d10)", "Bardic Inspiration (d12)"]) {
		if (feature(name).level <= level) add(state, feature(name));
	}
	const inspiration = state.getFeatures().find(row => row.name === "Bardic Inspiration");
	const pool = state.getResources().find(row => row.featureId === inspiration.id);
	state.addResource({...pool, featureId: inspiration.id, max: 6, current: 2, recharge: "short"});
	add(state, feature("Font of Inspiration", "XPHB"));
	add(state, feature("Spellcasting", "XPHB"));
	return state;
};
const build = (state, options = {}) => {
	const bundle = Exporter.buildExportDocument(state, {crMode: "manual", ...options});
	expect(bundle.validation.errors).toEqual([]);
	return bundle.document.monster[0];
};

describe("Playable NPC projection", () => {
	it("defaults NPCs to playable without overriding explicit modes or companion defaults", () => {
		for (const opts of [{}, {defenseMode: "persistent"}, {presentationMode: "invalid"}]) expect(Exporter.getSanitizedExportOptions(opts).presentationMode).toBe("playable");
		for (const mode of ["complete", "compact", "playable"]) expect(Exporter.getSanitizedExportOptions({presentationMode: mode}).presentationMode).toBe(mode);
		expect(Exporter.getSanitizedExportOptions({profile: "companion"}).presentationMode).toBe("complete");
	});

	it.each(["playable", "complete", "compact"])("%s updates the inspiration die, never the nearby d20 check", presentationMode => {
		const state = makeBard();
		const m = build(state, {presentationMode});
		const inspiration = m.bonus.find(entry => entry.name.startsWith("Bardic Inspiration"));
		expect(plain(inspiration.entries[0])).toMatch(/die[^.]*1?d12/);
		expect(plain(inspiration)).toMatch(/rolls the d20/);
		expect(plain(inspiration)).toMatch(/other than itself within 60 feet/);
		expect(plain(inspiration)).toMatch(/who can hear/);
		expect(plain(inspiration)).toMatch(/next 10 minutes/);
		expect(plain(inspiration)).toMatch(/before[^.]*whether the roll succeeds or fails/);
		expect(plain(inspiration)).toMatch(/only one Bardic Inspiration die/);
	});

	it("folds only current upgrades and retains conversion, focus, recovery and known-spell access", () => {
		const state = makeBard();
		const before = JSON.stringify(state._data);
		const m = build(state);
		expect(all(m).filter(entry => /^Bardic Inspiration/.test(entry.name))).toHaveLength(1);
		expect(m.bonus.find(entry => entry.name.startsWith("Bardic Inspiration")).name).toBe("Bardic Inspiration (6/SR)");
		expect(plain(m.bonus)).not.toMatch(/Charisma modifier \(4\)|finishes a long rest|changes when/);
		expect(all(m).some(entry => entry.name === "Spellcasting")).toBe(false);
		const body = plain(m);
		expect(body).toMatch(/spell slot \(no action required\) to regain one expended use/);
		expect(body).toMatch(/Musical Instrument/);
		expect(body).toMatch(/expended slots[^.]*[Ll]ong [Rr]est/);
		expect(body).not.toMatch(/start, choose four|Changing Your Prepared Spells|Prepared Spells column/);
		const casting = m.spellcasting.find(block => block.spells?.[1]?.spells.length);
		expect(plain(casting)).toMatch(/known[^.]*without[^.]*prepar/i);
		expect(casting.spells[1].spells.join(" ")).toContain("Healing Word");
		expect(JSON.stringify(state._data)).toBe(before);
		expect(getNpcExportSchemaErrors({data: {monster: [m]}, kind: "bestiary", filePath: "playable"})).toEqual([]);
		expect(Exporter.getExportReport(m).reductions.length).toBeGreaterThan(0);
		expect(m.reductions).toBeUndefined();
	});

	it("preserves beast communication while removing a duplicated language list", () => {
		const state = makeBard();
		state.addLanguage("Common");
		state.addLanguage("Sylvan");
		add(state, {name: "Forest Speech", source: "TEST", entries: ["You can speak, read, and write Common and Sylvan.", "Through sounds and gestures you can communicate simple ideas with Small or smaller beasts."]});
		const rule = all(build(state)).find(entry => entry.name === "Forest Speech");
		expect(plain(rule)).toMatch(/Small or smaller beasts/);
		expect(plain(rule)).not.toMatch(/speak, read, and write Common/);
	});

	it("uses actual selected skill coverage and keeps missing grants readable", () => {
		const state = makeBard();
		state.setSkillProficiency("persuasion", 2);
		state._data.customSkills = [{name: "Engineering", ability: "int", source: "TGTT"}];
		state.addFeat({name: "Training", source: "TEST", choices: {skills: ["engineering"], expertise: ["persuasion"]}, description: "<p>You gain proficiency in one skill of your choice.</p><p>Choose one skill in which you have proficiency but lack Expertise. You gain Expertise with that skill.</p>"});
		const m = build(state);
		expect(plain(all(m).find(entry => entry.name === "Training"))).toMatch(/engineering/i);
		expect(plain(all(m).find(entry => entry.name === "Training"))).not.toMatch(/lack Expertise/);
		expect(Exporter.getValidationIssues(m).warnings.join(" ")).toMatch(/engineering.*not represented/i);
		state.setSkillProficiency("engineering", 1);
		const resolved = build(state);
		expect(all(resolved).some(entry => entry.name === "Training")).toBe(false);
		expect(resolved.skill["engineering|TGTT"]).toBeDefined();
	});

	it("keeps actionable feat options and unknown nested rules", () => {
		const state = makeBard();
		state.addFeat({...feats.find(row => row.name === "Alert" && row.source === "XPHB"), choices: {}, description: html(feats.find(row => row.name === "Alert" && row.source === "XPHB").entries)});
		const nested = [{type: "table", colLabels: ["Roll", "Effect"], rows: [["1", "A unique outcome."]]}];
		add(state, {name: "Unknown Procedure", source: "TEST", entries: nested});
		const m = build(state);
		expect(plain(m)).toMatch(/swap[^.]*willing ally/i);
		expect(all(m).find(entry => entry.name === "Unknown Procedure").entries).toEqual(nested);
	});

	it("does not mistake a mixed skill grant or independent die rider for a represented-only benefit", () => {
		const state = makeBard();
		state.setSkillProficiency("persuasion", 1);
		state.addFeat({name: "Versatile Training", source: "TEST", choices: {skills: ["persuasion"]}, description: "<p>You gain proficiency in one skill of your choice and can breathe underwater.</p>"});
		add(state, {name: "Battle Growth", className: "Bard", classSource: "PHB", source: "PHB", level: 4, isAsiChoice: true, entries: ["Ability Score Increases: Strength +2. As a reaction, reduce incoming damage by 2."]});
		add(state, {name: "Bardic Inspiration (special)", className: "Bard", classSource: "PHB", source: "PHB", level: 10, entries: ["Your Bardic Inspiration die changes to a d10. You can also communicate with any beast."]});
		const m = build(state);
		expect(plain(all(m).find(row => row.name === "Versatile Training"))).toMatch(/breathe underwater/);
		expect(plain(all(m).find(row => row.name === "Battle Growth"))).toMatch(/As a reaction/);
		expect(plain(all(m).find(row => row.name === "Bardic Inspiration (special)"))).toMatch(/communicate with any beast/);
	});

	it("does not fold a unique recovery trigger just because the pool maximum is already printed", () => {
		const state = makeBard();
		state.addFeature({name: "Borrowed Voice", source: "TEST", uses: {max: 4, recharge: "short"}, description: "<p>You can use this feature a number of times equal to your Charisma modifier. You regain one expended use when a creature dies within 60 feet of you.</p>"});
		const row = all(build(state)).find(entry => entry.name.startsWith("Borrowed Voice"));
		expect(plain(row)).toMatch(/regains? one expended use when a creature dies within 60 feet/);
	});

	it("preserves unresolved/foreign owners and uses the owning class level, including TGTT acquisition ownership", () => {
		const state = makeBard(5);
		state.addClass({name: "Wizard", source: "PHB", level: 15});
		expect(plain(build(state).bonus)).toMatch(/die, a d8/);
		const advanced = makeBard();
		advanced._data.classes[0].source = "TGTT";
		advanced.getFeatures().forEach(row => { row.classSource = "TGTT"; });
		expect(all(build(advanced)).filter(row => /^Bardic Inspiration/.test(row.name))).toHaveLength(1);
		add(advanced, {name: "Bardic Inspiration (foreign)", source: "PHB", className: "Unknown", classSource: "PHB", level: 10, entries: ["Your Bardic Inspiration die changes to a d10."]});
		expect(all(build(advanced)).some(row => row.name === "Bardic Inspiration (foreign)")).toBe(true);
	});

	it("retains explicit manual source selections, including build rules", () => {
		const state = makeBard();
		const selectedFeatureIds = state.getFeatures().map(row => row.id);
		const m = build(state, {includeFeatures: "manual", selectedFeatureIds});
		expect(all(m).some(entry => entry.name === "Spellcasting")).toBe(true);
		expect(all(m).some(entry => entry.name === "Bardic Inspiration (d8)")).toBe(true);
		expect(all(build(state, {includeFeatures: "manual", selectedFeatureIds: []}))).not.toEqual(expect.arrayContaining([expect.objectContaining({name: "Spellcasting"})]));
	});

	it("moves pure build instructions to diagnostics without calling an unrelated feat proof of application", () => {
		const state = makeBard();
		add(state, {name: "Advancement", source: "PHB", className: "Bard", classSource: "PHB", level: 4, entries: ["You gain the {@feat Ability Score Improvement|XPHB} feat or another feat of your choice for which you qualify."]});
		state.addFeat({name: "Unrelated Choice", source: "TEST", description: "You can breathe underwater."});
		const unresolved = build(state);
		expect(all(unresolved).some(entry => entry.name === "Advancement")).toBe(false);
		expect(Exporter.getExportReport(unresolved).omissions.find(row => row.entity === "Advancement").reason).toMatch(/no score or feat gain was inferred/);
		state._data.levelHistory = [{level: 4, classLevel: 4, decisions: [{type: "asi", className: "Bard", classSource: "PHB", classLevel: 4, status: "resolved", selection: {cha: 2}}]}];
		expect(Exporter.getExportReport(build(state)).omissions.find(row => row.entity === "Advancement")).toBeDefined();
		const decision = CharacterSheetClassUtils.applyClassAsi(state, {className: "Bard", classSource: "PHB", classLevel: 4, characterLevel: 4, asi: {cha: 2}});
		state._data.levelHistory[0].decisions = [{...decision, status: "resolved"}];
		expect(all(build(state)).some(entry => entry.name === "Advancement")).toBe(false);
		expect(Exporter.getExportReport(build(state)).omissions.find(row => row.entity === "Advancement")).toBeUndefined();
	});

	it("folds a real capped ASI receipt but moves an invalid build-only acquisition to a precise report warning", () => {
		const state = makeBard();
		state.setAbilityBase("cha", 19);
		const decision = CharacterSheetClassUtils.applyClassAsi(state, {className: "Bard", classSource: "PHB", classLevel: 4, characterLevel: 4, asi: {cha: 2}});
		state._data.levelHistory = [{level: 4, classLevel: 4, decisions: [{...decision, status: "resolved"}]}];
		const m = build(state);
		expect(m.cha).toBe(20);
		expect(all(m).some(row => row.name === "Ability Score Improvement")).toBe(false);
		state._data.levelHistory[0].decisions[0].status = "invalid";
		const unresolved = build(state);
		expect(all(unresolved).some(row => row.name === "Ability Score Improvement")).toBe(false);
		expect(Exporter.getValidationIssues(unresolved).warnings.join(" ")).toMatch(/lacks a resolved source-qualified acquisition/);
		expect(plain(Exporter.getExportReport(unresolved).omissions.find(row => row.entity === "Ability Score Improvement").entries)).toMatch(/Charisma \+2/);
	});

	it("does not trust a resolved-but-unapplied ASI even if a stale receipt claims it was applied", () => {
		const state = makeBard();
		state.setAbilityBase("cha", 10);
		const decision = CharacterSheetClassUtils.applyClassAsi(state, {className: "Bard", classSource: "PHB", classLevel: 4, characterLevel: 4, asi: {cha: 2}});
		state._data.levelHistory = [{level: 4, classLevel: 4, decisions: [{...decision, status: "resolved"}]}];
		state.setAbilityBase("cha", 10);
		const m = build(state);
		expect(m.cha).toBe(10);
		expect(all(m).some(row => row.name === "Ability Score Improvement")).toBe(false);
		expect(Exporter.getValidationIssues(m).warnings.join(" ")).toMatch(/represented effects/);
		expect(Exporter.getExportReport(m).reductions.some(row => row.entity === "Ability Score Improvement")).toBe(false);
	});

	it("keeps companion legacy quantity policy and outputs independent of NPC presentation", () => {
		const state = makeBard();
		const options = {profile: "companion"};
		const before = JSON.stringify(state._data);
		const complete = build(state, {...options, presentationMode: "complete"});
		for (const presentationMode of ["compact", "playable"]) expect(build(state, {...options, presentationMode})).toEqual(complete);
		// This pre-existing actor text bug is outside the NPC-only repair's scope.
		expect(plain(complete.bonus.find(entry => entry.name.startsWith("Bardic Inspiration")))).toMatch(/rolls the d12/);
		expect(JSON.stringify(state._data)).toBe(before);
	});
});
