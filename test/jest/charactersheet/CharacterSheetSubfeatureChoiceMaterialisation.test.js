/**
 * CS-BUG-104 — a bare-sibling `refClassFeature` block that the parser classifies as a
 * level-up CHOICE was still materialised as an automatic GRANT.
 *
 * The load-bearing difficulty is that ONE encoding carries TWO opposite meanings:
 *
 *   Blessed Strikes (Cleric XPHB 7)  "You GAIN one of the following options"      -> pick one
 *   Cunning Strike  (Rogue XPHB 5)   "you can ADD one of the following effects"   -> learn all
 *
 * so a shape test at the materialisation site cannot separate them. These tests pin
 * BOTH directions: the Cleric must stop granting and start offering, and the Rogue must
 * keep every option. Widening or narrowing the prose discriminator breaks one of them.
 */

import fs from "fs";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const ClassUtils = globalThis.CharacterSheetClassUtils;
const Parser = globalThis.FeatureChoiceParser;
const CharacterSheetState = globalThis.CharacterSheetState;

const loadClassFile = (file) => JSON.parse(fs.readFileSync(`data/class/${file}`, "utf8"));

const findFeature = (json, name, className, source, level) =>
	(json.classFeature || []).find((f) =>
		f.name === name && f.className === className && f.source === source && f.level === level);

const materialise = (file, className, source, level) => {
	const json = loadClassFile(file);
	const classData = json.class.find((c) => c.name === className && c.source === source);
	expect(classData).toBeTruthy(); // PREMISE: the class exists in shipped data
	return ClassUtils.getLevelFeatures(classData, level, null, json.classFeature || [], []);
};

const childrenOf = (features, parentName) => features
	.filter((f) => String(f.parentFeature || "").toLowerCase() === parentName.toLowerCase())
	.map((f) => f.name);

describe("CS-BUG-104 — bare-sibling refs: choose-one vs learn-all", () => {
	describe("the prose discriminator", () => {
		it("classifies Blessed Strikes as a single choice between two options", () => {
			const feature = findFeature(loadClassFile("class-cleric.json"), "Blessed Strikes", "Cleric", "XPHB", 7);
			expect(feature).toBeTruthy(); // PREMISE
			const groups = Parser.extractChoices(feature).subfeatureChoices;
			expect(groups).toHaveLength(1);
			expect(groups[0].count).toBe(1);
			expect(groups[0].options.map((o) => o.name).sort())
				.toEqual(["Divine Strike", "Potent Spellcasting"]);
		});

		it("does NOT classify Cunning Strike as a choice — its options are an at-use menu", () => {
			const feature = findFeature(loadClassFile("class-rogue.json"), "Cunning Strike", "Rogue", "XPHB", 5);
			expect(feature).toBeTruthy(); // PREMISE
			// PREMISE: it really does carry the same bare-sibling shape, so this is a
			// semantic exclusion and not an accident of the data.
			const bareSiblingRefs = feature.entries
				.filter((e) => e && typeof e === "object" && Array.isArray(e.entries) && e.type !== "options")
				.flatMap((e) => e.entries.filter((s) => s?.type === "refClassFeature"));
			expect(bareSiblingRefs.length).toBeGreaterThanOrEqual(2);

			expect(Parser.extractChoices(feature).subfeatureChoices).toHaveLength(0);
		});
	});

	describe("materialisation — what the sheet actually grants", () => {
		it("a Cleric 7 is granted NEITHER Blessed Strikes option", () => {
			const features = materialise("class-cleric.json", "Cleric", "XPHB", 7);
			expect(childrenOf(features, "Blessed Strikes")).toEqual([]);

			const names = features.map((f) => f.name);
			expect(names).toContain("Blessed Strikes"); // the parent itself is still granted
			expect(names).not.toContain("Divine Strike");
			expect(names).not.toContain("Potent Spellcasting");
		});

		it("a Rogue 5 is still granted EVERY Cunning Strike effect", () => {
			const features = materialise("class-rogue.json", "Rogue", "XPHB", 5);
			const children = childrenOf(features, "Cunning Strike");
			expect(children.length).toBe(3);
			expect(children.join(" | ")).toMatch(/poison/i);
			expect(children.join(" | ")).toMatch(/trip/i);
			expect(children.join(" | ")).toMatch(/withdraw/i);
		});

		it("a Monk 2 is still granted every Monk's Focus feature", () => {
			const features = materialise("class-monk.json", "Monk", "XPHB", 2);
			expect(childrenOf(features, "Monk's Focus").sort())
				.toEqual(["Flurry of Blows", "Patient Defense", "Step of the Wind"]);
		});
	});

	describe("the choice reaches the player", () => {
		it("offers Blessed Strikes as a pending choice with both options", () => {
			const features = materialise("class-cleric.json", "Cleric", "XPHB", 7);
			const state = new CharacterSheetState();
			state._data.features = features.map((f) => ({...f}));

			const offered = [];
			state.addPendingFeatureChoice = (choice) => { offered.push(choice); return true; };
			ClassUtils.seedSubclassFeatureChoices(state, features, {});

			const blessed = offered.find((c) => c.featureName === "Blessed Strikes");
			expect(blessed).toBeTruthy();
			expect((blessed.options || []).map((o) => o.name).sort())
				.toEqual(["Divine Strike", "Potent Spellcasting"]);
		});
	});
});
