import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";

const State = globalThis.CharacterSheetState;
const Exporter = globalThis.CharacterSheetNpcExporter;
const entries = monster => ["trait", "action", "bonus", "reaction"].flatMap(section => monster[section] || []);
const text = monster => JSON.stringify(entries(monster));
const MODES = ["complete", "compact"];

describe("NPC export resources and owner-qualified formulas", () => {
	it.each(MODES)("F11: %s reads the current canonical pool before stale feature uses", presentationMode => {
		const state = new State({isDetached: true});
		state.addFeature({name: "Flash of Reason", source: "PHB", description: "As a reaction, add your Intelligence modifier to a saving throw.", uses: {max: 5, recharge: "long"}});
		const feature = state.getFeatures().find(row => row.name === "Flash of Reason");
		const pool = state.getResources().find(row => row.featureId === feature.id);
		state.addResource({id: pool.id, featureId: feature.id, name: "Reason Pool", current: 1, max: 8, recharge: "short"});
		const monster = Exporter.convertStateToMonster(state, {presentationMode, includeFeatures: "manual", selectedFeatureIds: [feature.id]});
		expect(entries(monster).some(row => /Flash of Reason.*8\/SR/.test(row.name))).toBe(true);
		expect(text(monster)).not.toContain("Flash of Reason (5/LR)");
		expect(entries(monster).some(row => row.name.startsWith("Reason Pool"))).toBe(false);
	});

	it.each(MODES)("F11: %s preserves both unrepresented pools when their names collide", presentationMode => {
		const state = new State({isDetached: true});
		state.addResource({id: "wizard-ward", name: "Ward Pool", max: 2, recharge: "long"});
		state.addResource({id: "cleric-ward", name: "Ward Pool", max: 7, recharge: "short"});
		const monster = Exporter.convertStateToMonster(state, {presentationMode});
		expect(text(monster)).toContain("Ward Pool 2/long rest");
		expect(text(monster)).toContain("Ward Pool 7/short rest");
	});

	it.each(MODES)("F11: %s retains the canonical Font of Inspiration recharge", presentationMode => {
		const state = new State({isDetached: true});
		state.addClass({name: "Bard", source: "PHB", level: 14});
		state.setAbilityBase("cha", 22);
		state.addFeature({name: "Bardic Inspiration", source: "PHB", className: "Bard", description: "As a bonus action, give another creature a Bardic Inspiration die.", uses: {max: 6, recharge: "long"}});
		const feature = state.getFeatures().find(row => row.name === "Bardic Inspiration");
		const pool = state.getResources().find(row => row.featureId === feature.id);
		state.addResource({...pool, max: 6, current: 2, recharge: "short"});
		const monster = Exporter.convertStateToMonster(state, {presentationMode});
		expect(entries(monster).some(row => /Bardic Inspiration \(6\/SR\)/.test(row.name))).toBe(true);
		expect(text(monster)).not.toContain("Bardic Inspiration (6/LR)");
	});

	it.each(MODES)("F11: %s prefers a synthetic combat pool without duplicating stale linked uses", presentationMode => {
		const state = new State({isDetached: true});
		state.addClass({name: "Fighter", source: "PHB", level: 17});
		state.addFeature({name: "Action Surge", source: "PHB", className: "Fighter", description: "On your turn, you can take one additional action.", uses: {max: 1, recharge: "short"}});
		expect(state.getActionSurgeUsesMax()).toBe(2);
		const monster = Exporter.convertStateToMonster(state, {presentationMode});
		expect(entries(monster).filter(row => row.name.startsWith("Action Surge")).map(row => row.name)).toEqual(["Action Surge (2/SR)"]);
		expect(text(monster)).not.toContain("Action Surge 1/");
	});

	it("F11: keeps independently owned pools distinct even when their display names collide", () => {
		const state = new State({isDetached: true});
		state.addFeature({name: "Shared Training", source: "PHB", className: "Wizard", classSource: "PHB", description: "As an action, create a ward."});
		state.addFeature({name: "Shared Training", source: "XPHB", className: "Cleric", classSource: "XPHB", description: "As a reaction, protect an ally."});
		const [wizard, cleric] = state.getFeatures().filter(feature => feature.name === "Shared Training");
		state.addResource({id: "wizard-ward", featureId: wizard.id, name: "Ward Pool", max: 2, recharge: "long"});
		state.addResource({id: "cleric-ward", featureId: cleric.id, name: "Ward Pool", max: 7, recharge: "short"});
		const monster = Exporter.convertStateToMonster(state);
		expect(entries(monster).map(row => row.name)).toContain("Shared Training (2/LR)");
		expect(entries(monster).map(row => row.name)).toContain("Shared Training (7/SR)");
	});

	it.each(MODES)("F12: %s does not assign Rage uses to passive or activation-rider names", presentationMode => {
		const state = new State({isDetached: true});
		state.addResource({name: "Rage", max: 6, recharge: "long"});
		for (const name of ["Persistent Rage", "Rage of the Wilds"]) {
			state.addFeature({name, source: "PHB", description: "While raging, you retain this benefit until your rage ends."});
		}
		const monster = Exporter.convertStateToMonster(state, {presentationMode, includeFeatures: "manual", selectedFeatureIds: ["Persistent Rage", "Rage of the Wilds"]});
		expect(text(monster)).not.toMatch(/(?:Persistent Rage|Rage of the Wilds) \(6\/LR\)/);
		expect(text(monster)).toMatch(/Rage \(6\/LR\)/);
		if (presentationMode === "complete") expect(entries(monster).map(row => row.name)).toContain("Persistent Rage");
	});

	it.each(MODES)("F16: %s resolves a full owner DC formula instead of labeling its partial sum as an ability modifier", presentationMode => {
		const state = new State({isDetached: true});
		state.setName("Testius");
		state.addClass({name: "Fighter", source: "PHB", level: 20});
		state.setAbilityBase("con", 28);
		state.addFeature({name: "Binding Test", source: "PHB", className: "Fighter", description: "As an action, a target must make a Constitution saving throw. DC = 8 + your proficiency bonus + your Constitution modifier."});
		const monster = Exporter.convertStateToMonster(state, {presentationMode, includeFeatures: "manual", selectedFeatureIds: ["Binding Test"]});
		expect(text(monster)).toContain("{@dc 23}");
		expect(text(monster)).not.toContain("Constitution modifier (+15)");
	});

	it.each(MODES)("F15: %s honors an explicit noncasting ability over a class-wide spell DC", presentationMode => {
		const state = new State({isDetached: true});
		state.addClass({name: "Wizard", source: "XPHB", level: 20});
		state.setSpellcastingAbility("int");
		state.setAbilityBase("int", 26);
		state.setAbilityBase("wis", 10);
		state.addFeature({name: "Avenger Test", source: "XPHB", className: "Wizard", description: "As an action, a target must make a Wisdom saving throw (DC equals 8 plus your proficiency bonus plus your Wisdom modifier)."});
		const monster = Exporter.convertStateToMonster(state, {presentationMode, includeFeatures: "manual", selectedFeatureIds: ["Avenger Test"]});
		expect(text(monster)).toContain("{@dc 14}");
		expect(text(monster)).not.toContain("{@dc 22}");
	});

	it.each(MODES)("F15/F25: %s resolves a feat-owned DC from its recorded ASI ability, not its class", presentationMode => {
		const state = new State({isDetached: true});
		state.setName("Keeper");
		state.addClass({name: "Bard", source: "PHB", level: 9, spellcastingAbility: "cha"});
		state.setAbilityBase("int", 20);
		state.setAbilityBase("cha", 24);
		state.addFeat({
			name: "Telekinetic Test",
			source: "FTD",
			choices: {ability: "int"},
			description: "When you take damage from a creature within 10 feet of you, you can use your reaction. The creature must make a Strength saving throw (DC equals 8 + your proficiency bonus + the ability modifier of the score increased by this feat).",
		});
		const monster = Exporter.convertStateToMonster(state, {presentationMode, includeFeatures: "manual", selectedFeatureIds: ["Telekinetic Test"]});
		expect(text(monster)).toContain("{@dc 17}");
		expect(text(monster)).not.toContain("{@dc 19}");
		expect(text(monster)).not.toMatch(/score increased by this feat/);
	});

	it.each(MODES)("F15: %s discloses a missing feat ability instead of borrowing the only class's casting ability", presentationMode => {
		const state = new State({isDetached: true});
		state.addClass({name: "Wizard", source: "PHB", level: 9, spellcastingAbility: "int"});
		state.setAbilityBase("int", 20);
		state.addFeat({
			name: "Unknown Choice",
			source: "FTD",
			description: "A creature must make a Strength saving throw (DC equals 8 + your proficiency bonus + the ability modifier of the score increased by this feat).",
		});
		const monster = Exporter.convertStateToMonster(state, {presentationMode, includeFeatures: "manual", selectedFeatureIds: ["Unknown Choice"]});
		expect(text(monster)).toMatch(/score increased by this feat/);
		expect(text(monster)).not.toContain("{@dc 17}");
		expect(Exporter.getValidationIssues(monster).warnings.join(" ")).toMatch(/chosen feat ability.*missing or ambiguous/i);
	});

	it.each(MODES)("F15: %s uses the actual Performance bonus for Jester acts while retaining rolled DCs as dynamic", presentationMode => {
		const state = new State({isDetached: true});
		state.addClass({name: "Bard", source: "TGTT", level: 20, subclass: {name: "College of Jesters", shortName: "Jesters", source: "TGTT"}});
		state.setAbilityBase("cha", 24);
		state.setSpellcastingAbility("cha");
		state.setSkillProficiency("performance", 2);
		state.addNamedModifier({name: "Performance Training", type: "skill:performance", value: 6, enabled: true});
		state.addFeature({name: "Stage Distraction", source: "TGTT", className: "Bard", classSource: "TGTT", featureType: "Optional Feature", optionalFeatureTypes: ["JA"], description: "As an action, the target must make a Wisdom saving throw or become distracted."});
		state.addFeature({name: "Jester's Privilege", source: "TGTT", className: "Bard", classSource: "TGTT", description: "Creatures must make a Wisdom saving throw (DC equal to your Performance check result)."});
		expect(state.getSkillMod("performance")).toBe(25);
		const monster = Exporter.convertStateToMonster(state, {presentationMode, includeFeatures: "manual", selectedFeatureIds: ["Stage Distraction", "Jester's Privilege"]});
		const distraction = entries(monster).find(row => row.name.startsWith("Stage Distraction"));
		const privilege = entries(monster).find(row => row.name.startsWith("Jester's Privilege"));
		expect(JSON.stringify(distraction)).toContain("{@dc 33}");
		expect(Exporter._getPlainMatchTextCased(JSON.stringify(privilege))).toContain("Performance check result");
		expect(JSON.stringify(privilege)).not.toContain("{@dc ");
		expect(state.getJesterPerformanceBonus()).toBe(25);
		expect(state.getFeatureCalculations().jesterActDcBase).toBe(33);
	});

	it("F24: leaves target-owned ability formulas dynamic while still resolving bearer-owned formulas", () => {
		const state = new State({isDetached: true});
		state.setAbilityBase("dex", 18);
		const target = "The target's AC becomes 10 plus its Dexterity modifier plus any magical bonus to AC.";
		expect(Exporter._resolveAbilityFormulas(target, state)).toBe(target);
		expect(Exporter._resolveAbilityFormulas("Its AC becomes 10 plus its Dexterity modifier.", state)).toContain("14");
	});

	it.each(MODES)("F24: %s does not freeze the real Blue Tetragonal target AC using the bearer's Dexterity", presentationMode => {
		const book = JSON.parse(fs.readFileSync("homebrew/Moorchlyne Ioun Stones.json", "utf8"));
		const definition = book.item.find(item => item.name === "Ioun Stone #121, Blue Tetragonal");
		expect(definition).toBeDefined();
		const state = new State({isDetached: true});
		state.setAbilityBase("dex", 18);
		state.addItem({...definition, equipped: true, attuned: true});
		const monster = Exporter.convertStateToMonster(state, {presentationMode});
		expect(text(monster)).toContain("AC equals 10 + its Dexterity modifier");
		expect(text(monster)).not.toContain("14 (10");
	});

	it("keeps the canonical Jester DC aligned with active stance and derived-skill bonuses without recursive feature calculation", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Bard", source: "TGTT", level: 17, subclass: {name: "College of Jesters", shortName: "Jesters", source: "TGTT"}});
		state.addClass({name: "Beastheart", source: "BAM", level: 3, subclass: {name: "Ferocious Bond", shortName: "Ferocious", source: "BAM"}});
		state.setAbilityBase("cha", 24);
		state.setAbilityBase("wis", 16);
		state.setSkillProficiency("intimidation", 1);
		state.addNamedModifier({name: "Adapted Performance", type: "skill:performance", value: 2, enabled: true, derivedSkill: {source: "intimidation", mode: "modifier", delta: 2}});
		expect(state.getSkillMod("performance")).toBe(18);
		expect(state.getFeatureCalculations().jesterActDcBase).toBe(26);
		state.updateNamedModifier(state.getNamedModifiers().find(modifier => modifier.name === "Adapted Performance").id, {derivedSkill: null, value: 6});
		state.setSkillProficiency("performance", 2);
		state.addFeature({
			name: "Jovial Stance",
			source: "TGTT",
			_entityType: "combatMethod",
			tradition: "Razor's Edge",
			degree: 1,
			staminaCost: 1,
			entries: ["As a bonus action, you enter this stance. While in this stance, you gain a bonus to Dexterity (Acrobatics) and Charisma (Performance) checks equal to your proficiency bonus."],
		});
		expect(state.activateStance("Jovial Stance")).toBe(true);
		expect(state.getSkillMod("performance")).toBe(31);
		expect(state.getFeatureCalculations().jesterActDcBase).toBe(39);
		state.deactivateStance();
		expect(state.getFeatureCalculations().jesterActDcBase).toBe(33);
	});

	it.each(MODES)("F49: %s preserves real Ioun absorption capacity and distinguishes remaining spell levels", presentationMode => {
		const book = JSON.parse(fs.readFileSync("homebrew/Moorchlyne Ioun Stones.json", "utf8"));
		const definition = book.item.find(item => item.name === "Ioun Stone #012, Lavender and Green Ellipsoid");
		expect(definition.charges).toBe(50);
		for (const current of [undefined, 37, 0]) {
			const state = new State({isDetached: true});
			state.addItem({...definition, equipped: true, attuned: true, ...(current == null ? {} : {chargesCurrent: current})});
			const monster = Exporter.convertStateToMonster(state, {presentationMode});
			const stone = entries(monster).find(row => /Ioun Stone.*Lavender and Green Ellipsoid/.test(row.name));
			expect(stone?.name).toContain(`${current ?? 50}/50 spell levels remaining`);
			expect(stone?.name).not.toMatch(/\(0\)$/);
		}
	});
});
