import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";

const Exporter = globalThis.CharacterSheetNpcExporter;
const State = globalThis.CharacterSheetState;
const entries = monster => ["trait", "action", "bonus", "reaction"].flatMap(section => monster[section] || []);

describe("NPC export presentation and source-rule retention", () => {
	it("defaults missing and legacy preferences to playable, separately from the runtime companion profile", () => {
		expect(Exporter.getSanitizedExportOptions({defenseMode: "persistent"}).presentationMode).toBe("playable");
		expect(Exporter.getSanitizedExportOptions({presentationMode: "COMPACT"}).presentationMode).toBe("compact");
		expect(Exporter.getSanitizedExportOptions().profile).toBe("npc");
	});

	it("F05/F06: retains more than 64 manually selected mechanics without hidden caps", () => {
		const state = new State({isDetached: true});
		for (let i = 0; i < 80; ++i) state.addFeature({name: `Technique ${i}`, source: "PHB", description: `As an action, mark target ${i} and deal 1 fire damage.`});
		const names = state.getFeatures().map(feature => feature.name);
		for (const options of [{}, {includeFeatures: "manual", selectedFeatureIds: names}]) {
			const monster = Exporter.convertStateToMonster(state, options);
			expect(entries(monster).filter(entry => /^Technique \d+$/.test(entry.name))).toHaveLength(80);
		}
		expect(Exporter.getSanitizedExportOptions({selectedFeatureIds: names}).selectedFeatureIds).toHaveLength(80);
	});

	it("F05/F07/F08: preserves nonnumeric riders, partial numeric grants, and Potent Spellcasting", () => {
		const state = new State({isDetached: true});
		state.setAbilityBase("wis", 14);
		const descriptions = {
			"Elusive": "No attack roll has advantage against you while you aren't incapacitated.",
			"Death Strike": "When you attack and hit a surprised creature, it must make a Constitution saving throw. On a failure, double the damage of the attack against the creature.",
			"Underwater Aptitude": "You gain a swimming speed equal to your walking speed. You can also breathe air and water.",
			"Potent Spellcasting": "Add your Wisdom modifier to the damage you deal with any cleric cantrip.",
			"Soul of Artifice": "You gain a bonus to all saving throws. When reduced to 0 hit points, end one infusion to drop to 1 hit point instead.",
		};
		Object.entries(descriptions).forEach(([name, description]) => state.addFeature({name, description, source: name === "Soul of Artifice" ? "TCE" : "PHB"}));
		const monster = Exporter.convertStateToMonster(state);
		const requiredRules = {
			"Elusive": [/No attack roll has advantage against/, /while[^.]*isn't incapacitated/],
			"Death Strike": [/surprised creature/, /Constitution saving throw/, /failure[^.]*double[^.]*damage/i],
			"Underwater Aptitude": [/swimming speed equal to/, /breathe air and water/],
			"Potent Spellcasting": [/Wisdom modifier/, /damage[^.]*cleric cantrip/],
			"Soul of Artifice": [/bonus to all saving throws/, /0 hit points/, /end one infusion to drop to 1 hit point/],
		};
		for (const [name, rules] of Object.entries(requiredRules)) {
			const body = (entries(monster).find(entry => entry.name.startsWith(name))?.entries || []).join(" ");
			rules.forEach(rule => expect(body).toMatch(rule));
		}
		expect(entries(monster).find(entry => entry.name === "Potent Spellcasting").entries[0]).toContain("Wisdom modifier (+2)");
	});

	it("F06: retains nested rules, tables, and long rule tails without changing the saved source", () => {
		const state = new State({isDetached: true});
		const nested = [{type: "entries",
			name: "Full Rules",
			entries: [
				`${"The target remains bound. ".repeat(100)}The effect ends only after the stated escape procedure.`,
				{type: "table", colLabels: ["Roll", "Effect"], rows: [["1", "Retain the complete outcome."]]},
			]}];
		state.addFeature({name: "Nested Control", source: "TGTT", entries: nested, description: "See the full source rules."});
		const before = JSON.stringify(state.getFeatures());
		const monster = Exporter.convertStateToMonster(state);
		expect(entries(monster).find(entry => entry.name === "Nested Control").entries).toEqual(nested);
		expect(JSON.stringify(state.getFeatures())).toBe(before);
	});

	it("F04: preserves a magic-equipment list through compact cleanup without requiring numeric item names", () => {
		const state = new State({isDetached: true});
		state.addItem({name: "Ring of Feather Falling", source: "DMG", rarity: "rare", type: "RG", equipped: false});
		for (const presentationMode of ["complete", "compact"]) {
			const monster = Exporter.convertStateToMonster(state, {presentationMode});
			const equipment = monster.trait.find(entry => entry.name === "Special Equipment");
			expect(equipment).toBeDefined();
			expect(JSON.stringify(equipment.entries)).toContain("Ring of Feather Falling");
		}
		const nested = {trait: [{name: "Stored Rules", entries: [{type: "list", items: ["Retain the complete outcome."]}]}]};
		Exporter._dropInertItemEntries(nested);
		expect(nested.trait[0].entries[0].items).toEqual(["Retain the complete outcome."]);
	});

	it("offers entries-only features in the manual picker", () => {
		const state = new State({isDetached: true});
		state.addFeature({name: "Structured Rule", source: "PHB", entries: ["You can breathe underwater."]});
		expect(Exporter.listExportableFeatures(state).map(feature => feature.name)).toContain("Structured Rule");
	});

	it("compact output exposes recoverable source details outside the schema objects", () => {
		const state = new State({isDetached: true});
		state.addFeature({name: "Quiet Talent", source: "PHB", description: "You can always recognize your own handwriting."});
		const monster = Exporter.convertStateToMonster(state, {presentationMode: "compact"});
		const report = Exporter.getExportReport(monster);
		expect(report.name).toBe(monster.name);
		expect(report.source).toBe(monster.source);
		expect(report.omissions.find(row => row.entity === "Quiet Talent")?.entries).toEqual(["You can always recognize your own handwriting."]);
		expect(Exporter.getValidationIssues(monster).warnings.some(warning => warning.includes("Quiet Talent"))).toBe(true);
		expect(monster.omissions).toBeUndefined();
		expect(monster.exportReport).toBeUndefined();
		report.omissions[0].entries.length = 0;
		expect(Exporter.getExportReport(monster).omissions[0].entries).toHaveLength(1);
	});
});
