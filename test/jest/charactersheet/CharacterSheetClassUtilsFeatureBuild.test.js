import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

describe("CharacterSheetClassUtils feature payload normalization", () => {
	test("buildFeatureStateObject preserves metadata-first fields", () => {
		const raw = {
			name: "Homebrew Aura",
			source: "HB",
			featureType: ["CTM:1AM", "CTM:2AM"],
			activatable: {
				interactionMode: "trigger",
				activationAction: "reaction",
				effects: [{type: "bonus", target: "ac", value: 1}],
			},
			effects: [{type: "resistance", target: "fire"}],
			uses: {current: 1, max: 1, recharge: "long"},
			entries: [{type: "entries", entries: ["Test"]}],
		};

		const out = CharacterSheetClassUtils.buildFeatureStateObject(raw, {
			className: "Fighter",
			classSource: "PHB",
			level: 3,
			featureType: "Optional Feature",
		});

		expect(out.name).toBe("Homebrew Aura");
		expect(out.className).toBe("Fighter");
		expect(out.featureType).toBe("Optional Feature");
		expect(out.optionalFeatureTypes).toEqual(["CTM:1AM", "CTM:2AM"]);
		expect(out.activatable).toEqual(raw.activatable);
		expect(out.effects).toEqual(raw.effects);
		expect(out.uses).toEqual(raw.uses);
		expect(out.entries).toEqual(raw.entries);
		expect(out.description).toBeTruthy();
	});

	test("dedupAndBuildFeatures keeps activatable metadata on class features", () => {
		const features = [
			{
				name: "Blade Warding Stance",
				source: "TGTT",
				entries: [{type: "entries", entries: ["You can activate this stance."]}],
				activatable: {
					interactionMode: "toggle",
					activationAction: "bonus",
					effects: [{type: "bonus", target: "ac", value: 2}],
				},
			},
		];

		const out = CharacterSheetClassUtils.dedupAndBuildFeatures(features, [], {
			className: "Fighter",
			classSource: "PHB",
			level: 5,
		});

		expect(out).toHaveLength(1);
		expect(out[0].name).toBe("Blade Warding Stance");
		expect(out[0].featureType).toBe("Class");
		expect(out[0].activatable).toEqual(features[0].activatable);
		expect(out[0].description).toBeTruthy();
	});
});

describe("CharacterSheetClassUtils optional feature parsing", () => {
	const observerFeature = {
		name: "Observer",
		source: "TGTT",
		entries: [
			"You gain a bonus to Wisdom ({@skill Perception}) checks equal to your proficiency bonus. In addition, your passive Wisdom ({@skill Perception}) score increases by 3.",
		],
	};

	const extraSkillFeature = {
		name: "Extra Skill Training",
		source: "TGTT",
		entries: [
			"You gain proficiency in one of the following: {@skill Acrobatics}, {@skill Athletics}, {@skill Investigation}, {@skill Perception}, {@skill Stealth}, or any tool.",
		],
	};

	const expertiseTrainingFeature = {
		name: "Expertise Training",
		source: "TGTT",
		entries: [
			"You gain a bonus equal to your proficiency bonus on checks made with one of the following skills or tools: {@skill Acrobatics}, {@skill Athletics}, {@skill Investigation}, {@skill Perception}, {@skill Stealth}, or any tool.",
		],
	};

	const allOptFeatures = [observerFeature, extraSkillFeature, expertiseTrainingFeature];

	test("parseFeatureAutoEffects should parse passive bonus from optionalfeature", () => {
		const opt = {type: "optionalfeature", ref: "Observer|TGTT", name: "Observer", source: "TGTT"};
		const effects = CharacterSheetClassUtils.parseFeatureAutoEffects(opt, [], {optionalFeatures: allOptFeatures});
		const passiveEffect = effects.find(e => e.type === "passive:perception");
		expect(passiveEffect).toBeDefined();
		expect(passiveEffect.value).toBe(3);
	});

	test("parseFeatureAutoEffects should NOT parse skill PB bonus (handled by FeatureModifierParser)", () => {
		const opt = {type: "optionalfeature", ref: "Observer|TGTT", name: "Observer", source: "TGTT"};
		const effects = CharacterSheetClassUtils.parseFeatureAutoEffects(opt, [], {optionalFeatures: allOptFeatures});
		// PB-based skill bonus is created by FeatureModifierParser via addFeature()._processFeatureModifiers()
		// parseFeatureAutoEffects should NOT duplicate it — that caused double-counting in passive scores
		const skillPbEffect = effects.find(e => e.type === "skill:perception" && e.value === "proficiency");
		expect(skillPbEffect).toBeUndefined();
	});

	test("parseFeatureSkillChoice should parse proficiency choice from optionalfeature", () => {
		const opt = {type: "optionalfeature", ref: "Extra Skill Training|TGTT", name: "Extra Skill Training", source: "TGTT"};
		const choice = CharacterSheetClassUtils.parseFeatureSkillChoice(opt, [], {optionalFeatures: allOptFeatures});
		expect(choice).not.toBeNull();
		expect(choice.type).toBe("proficiency");
		expect(choice.count).toBe(1);
		expect(choice.from).toContain("Perception");
	});

	test("parseFeatureSkillChoice should parse PB bonus choice from optionalfeature", () => {
		const opt = {type: "optionalfeature", ref: "Expertise Training|TGTT", name: "Expertise Training", source: "TGTT"};
		const choice = CharacterSheetClassUtils.parseFeatureSkillChoice(opt, [], {optionalFeatures: allOptFeatures});
		expect(choice).not.toBeNull();
		expect(choice.type).toBe("bonus");
		expect(choice.count).toBe(1);
		expect(choice.from).toContain("Athletics");
	});

	test("parseFeatureAutoEffects should still reject unknown types", () => {
		const opt = {type: "unknown", ref: "Observer|TGTT", name: "Observer", source: "TGTT"};
		const effects = CharacterSheetClassUtils.parseFeatureAutoEffects(opt, [], {optionalFeatures: allOptFeatures});
		expect(effects).toEqual([]);
	});

	test("parseFeatureAutoEffects should accept resolvedData directly", () => {
		const opt = {type: "optionalfeature", ref: "Observer|TGTT", name: "Observer", source: "TGTT"};
		const effects = CharacterSheetClassUtils.parseFeatureAutoEffects(opt, [], {resolvedData: observerFeature});
		expect(effects.find(e => e.type === "passive:perception")).toBeDefined();
	});
});

describe("getFeatureOptionsForLevel deduplication", () => {
	test("should return pure-optionalfeature groups from raw output", () => {
		// Simulate a "Metamagic Options" class feature with refOptionalfeature entries
		const features = [{
			name: "Metamagic Options",
			source: "XPHB",
			className: "Sorcerer",
			classSource: "XPHB",
			level: 2,
			entries: [{
				type: "options",
				count: 2,
				entries: [
					{type: "refOptionalfeature", optionalfeature: "Careful Spell|XPHB"},
					{type: "refOptionalfeature", optionalfeature: "Distant Spell|XPHB"},
					{type: "refOptionalfeature", optionalfeature: "Quickened Spell|XPHB"},
				],
			}],
		}];

		const raw = CharacterSheetClassUtils.getFeatureOptionsForLevel(features, 2, []);
		expect(raw.length).toBe(1);
		expect(raw[0].options.every(o => o.type === "optionalfeature")).toBe(true);
	});

	test("quickbuild-style filter removes pure-optionalfeature groups", () => {
		const features = [{
			name: "Metamagic Options",
			source: "XPHB",
			className: "Sorcerer",
			classSource: "XPHB",
			level: 2,
			entries: [{
				type: "options",
				count: 2,
				entries: [
					{type: "refOptionalfeature", optionalfeature: "Careful Spell|XPHB"},
					{type: "refOptionalfeature", optionalfeature: "Distant Spell|XPHB"},
				],
			}],
		}];

		const filtered = CharacterSheetClassUtils.getFeatureOptionsForLevel(features, 2, [])
			.filter(optGroup => !optGroup.options.every(opt => opt.type === "optionalfeature"));
		expect(filtered.length).toBe(0);
	});

	test("filter preserves groups with non-optionalfeature options (e.g. classFeature specialties)", () => {
		const features = [{
			name: "Specialty",
			source: "TGTT",
			className: "Fighter",
			classSource: "TGTT",
			level: 1,
			entries: [{
				type: "options",
				count: 1,
				entries: [
					{type: "refClassFeature", classFeature: "Brawler|Fighter|TGTT|1"},
					{type: "refClassFeature", classFeature: "Tactician|Fighter|TGTT|1"},
				],
			}],
		}];

		const filtered = CharacterSheetClassUtils.getFeatureOptionsForLevel(features, 1, [])
			.filter(optGroup => !optGroup.options.every(opt => opt.type === "optionalfeature"));
		expect(filtered.length).toBe(1);
		expect(filtered[0].options.every(o => o.type === "classFeature")).toBe(true);
	});
});

describe("getLevelFeatures refClassFeature extraction", () => {
	// Simulates the XPHB Monk pattern:
	// "Monk's Focus" is the top-level classFeature that contains refClassFeature
	// entries for FoB, PD, SotW — which exist as separate classFeature data objects.
	const mockClassData = {
		name: "Monk",
		source: "XPHB",
		classFeatures: [
			"Martial Arts|Monk|XPHB|1",
			"Monk's Focus|Monk|XPHB|2",
			"Unarmored Movement|Monk|XPHB|2",
		],
	};

	const mockClassFeatures = [
		{name: "Martial Arts", className: "Monk", source: "XPHB", level: 1, entries: ["You gain martial arts features."]},
		{
			name: "Monk's Focus",
			className: "Monk",
			source: "XPHB",
			level: 2,
			entries: [
				"Your focus allows you to harness extraordinary energy.",
				{
					type: "entries",
					entries: [
						{type: "refClassFeature", classFeature: "Flurry of Blows|Monk|XPHB|2"},
						{type: "refClassFeature", classFeature: "Patient Defense|Monk|XPHB|2"},
						{type: "refClassFeature", classFeature: "Step of the Wind|Monk|XPHB|2"},
					],
				},
			],
		},
		{name: "Unarmored Movement", className: "Monk", source: "XPHB", level: 2, entries: ["Speed bonus."]},
		{name: "Flurry of Blows", className: "Monk", source: "XPHB", level: 2, entries: ["Make two unarmed strikes as a bonus action."]},
		{name: "Patient Defense", className: "Monk", source: "XPHB", level: 2, entries: ["Take the Dodge action as a bonus action."]},
		{name: "Step of the Wind", className: "Monk", source: "XPHB", level: 2, entries: ["Dash or Disengage as a bonus action."]},
	];

	test("should extract refClassFeature sub-entries as separate features", () => {
		const features = CharacterSheetClassUtils.getLevelFeatures(mockClassData, 2, null, mockClassFeatures);
		const names = features.map(f => f.name);
		expect(names).toContain("Monk's Focus");
		expect(names).toContain("Flurry of Blows");
		expect(names).toContain("Patient Defense");
		expect(names).toContain("Step of the Wind");
	});

	test("extracted features should have correct metadata", () => {
		const features = CharacterSheetClassUtils.getLevelFeatures(mockClassData, 2, null, mockClassFeatures);
		const fob = features.find(f => f.name === "Flurry of Blows");
		expect(fob).toBeDefined();
		expect(fob.className).toBe("Monk");
		expect(fob.classSource).toBe("XPHB");
		expect(fob.level).toBe(2);
		expect(fob.parentFeature).toBe("Monk's Focus");
		expect(fob.entries).toEqual(["Make two unarmed strikes as a bonus action."]);
	});

	test("should not duplicate features already in the top-level classFeatures list", () => {
		const features = CharacterSheetClassUtils.getLevelFeatures(mockClassData, 2, null, mockClassFeatures);
		const focusCounts = features.filter(f => f.name === "Monk's Focus");
		const movementCounts = features.filter(f => f.name === "Unarmored Movement");
		expect(focusCounts).toHaveLength(1);
		expect(movementCounts).toHaveLength(1);
	});

	test("should not extract refClassFeature if no matching data exists", () => {
		const sparseClassFeatures = [
			mockClassFeatures[1], // Monk's Focus with refs
			// But no FoB/PD/SotW data objects
		];
		const features = CharacterSheetClassUtils.getLevelFeatures(mockClassData, 2, null, sparseClassFeatures);
		// Only Monk's Focus and Unarmored Movement (no entries for movement either)
		const names = features.map(f => f.name);
		expect(names).toContain("Monk's Focus");
		expect(names).not.toContain("Flurry of Blows");
	});

	test("should work for level 1 features without refs", () => {
		const features = CharacterSheetClassUtils.getLevelFeatures(mockClassData, 1, null, mockClassFeatures);
		expect(features).toHaveLength(1);
		expect(features[0].name).toBe("Martial Arts");
	});

	test("should handle PHB Ki pattern identically", () => {
		const phbClassData = {
			name: "Monk",
			source: "PHB",
			classFeatures: ["Ki|Monk||2"],
		};
		const phbClassFeatures = [
			{
				name: "Ki",
				className: "Monk",
				source: "PHB",
				level: 2,
				entries: [
					"Ki point description.",
					{type: "entries",
						entries: [
							{type: "refClassFeature", classFeature: "Flurry of Blows|Monk||2"},
							{type: "refClassFeature", classFeature: "Patient Defense|Monk||2"},
						]},
				],
			},
			{name: "Flurry of Blows", className: "Monk", source: "PHB", level: 2, entries: ["FoB text."]},
			{name: "Patient Defense", className: "Monk", source: "PHB", level: 2, entries: ["PD text."]},
		];
		const features = CharacterSheetClassUtils.getLevelFeatures(phbClassData, 2, null, phbClassFeatures);
		const names = features.map(f => f.name);
		expect(names).toContain("Ki");
		expect(names).toContain("Flurry of Blows");
		expect(names).toContain("Patient Defense");
	});
});

describe("getLevelFeatures → dedupAndBuildFeatures end-to-end pipeline", () => {
	const mockClassData = {
		name: "Monk",
		source: "XPHB",
		classFeatures: [
			"Martial Arts|Monk|XPHB|1",
			"Monk's Focus|Monk|XPHB|2",
			"Unarmored Movement|Monk|XPHB|2",
		],
	};

	const mockClassFeatures = [
		{name: "Martial Arts", className: "Monk", source: "XPHB", level: 1, entries: ["You gain martial arts features."]},
		{
			name: "Monk's Focus",
			className: "Monk",
			source: "XPHB",
			level: 2,
			entries: [
				"Your focus allows you to harness extraordinary energy.",
				{
					type: "entries",
					entries: [
						{type: "refClassFeature", classFeature: "Flurry of Blows|Monk|XPHB|2"},
						{type: "refClassFeature", classFeature: "Patient Defense|Monk|XPHB|2"},
						{type: "refClassFeature", classFeature: "Step of the Wind|Monk|XPHB|2"},
					],
				},
			],
		},
		{name: "Unarmored Movement", className: "Monk", source: "XPHB", level: 2, entries: ["Speed bonus."]},
		{name: "Flurry of Blows", className: "Monk", source: "XPHB", level: 2, entries: ["You can expend 1 Focus Point to make two Unarmed Strikes as a Bonus Action."]},
		{name: "Patient Defense", className: "Monk", source: "XPHB", level: 2, entries: ["You can take the Disengage action as a Bonus Action. Alternatively, you can expend 1 Focus Point to take both the Disengage and the Dodge actions as a Bonus Action."]},
		{name: "Step of the Wind", className: "Monk", source: "XPHB", level: 2, entries: ["You can take the Dash action as a Bonus Action. Alternatively, you can expend 1 Focus Point to take both the Disengage and Dash actions as a Bonus Action, and your jump distance is doubled for the turn."]},
	];

	test("dedupAndBuildFeatures produces features with descriptions from extracted entries", () => {
		const rawFeatures = CharacterSheetClassUtils.getLevelFeatures(mockClassData, 2, null, mockClassFeatures);
		const existingNames = ["martial arts"]; // level 1 already added
		const built = CharacterSheetClassUtils.dedupAndBuildFeatures(rawFeatures, existingNames, {
			className: "Monk",
			classSource: "XPHB",
			level: 2,
		});

		const names = built.map(f => f.name);
		expect(names).toContain("Monk's Focus");
		expect(names).toContain("Flurry of Blows");
		expect(names).toContain("Patient Defense");
		expect(names).toContain("Step of the Wind");
		expect(names).toContain("Unarmored Movement");

		// Each extracted feature should have a non-empty description
		const fob = built.find(f => f.name === "Flurry of Blows");
		const pd = built.find(f => f.name === "Patient Defense");
		const sotw = built.find(f => f.name === "Step of the Wind");
		expect(fob.description).toBeTruthy();
		expect(pd.description).toBeTruthy();
		expect(sotw.description).toBeTruthy();

		// Verify entries are preserved
		expect(fob.entries).toBeDefined();
		expect(pd.entries).toBeDefined();
		expect(sotw.entries).toBeDefined();
	});

	test("extracted features have parentFeature set to the container", () => {
		const rawFeatures = CharacterSheetClassUtils.getLevelFeatures(mockClassData, 2, null, mockClassFeatures);
		const built = CharacterSheetClassUtils.dedupAndBuildFeatures(rawFeatures, [], {
			className: "Monk",
			classSource: "XPHB",
			level: 2,
		});

		const fob = built.find(f => f.name === "Flurry of Blows");
		const pd = built.find(f => f.name === "Patient Defense");
		const sotw = built.find(f => f.name === "Step of the Wind");
		expect(fob.parentFeature).toBe("Monk's Focus");
		expect(pd.parentFeature).toBe("Monk's Focus");
		expect(sotw.parentFeature).toBe("Monk's Focus");
	});

	test("extracted features have correct featureType and class metadata", () => {
		const rawFeatures = CharacterSheetClassUtils.getLevelFeatures(mockClassData, 2, null, mockClassFeatures);
		const built = CharacterSheetClassUtils.dedupAndBuildFeatures(rawFeatures, [], {
			className: "Monk",
			classSource: "XPHB",
			level: 2,
		});

		for (const name of ["Flurry of Blows", "Patient Defense", "Step of the Wind"]) {
			const f = built.find(b => b.name === name);
			expect(f.featureType).toBe("Class");
			expect(f.className).toBe("Monk");
			expect(f.classSource).toBe("XPHB");
			expect(f.level).toBe(2);
		}
	});
});

// ==========================================================================
// findFeatureOptions — Specialty Option Groups
// ==========================================================================

describe("findFeatureOptions — Specialty Option Groups", () => {
	// Mock TGTT Monk "Specialties" feature at level 2 (has type: "options" block)
	const specialtiesFeature = {
		name: "Specialties",
		source: "TGTT",
		className: "Monk",
		classSource: "TGTT",
		level: 2,
		entries: [
			"You gain a specialty of your choice at 2nd level. You gain another specialty at 4th, 6th, 8th, 10th, 12th, 14th, 16th, 18th, and 20th level.",
			{
				type: "options",
				count: 1,
				entries: [
					{type: "refClassFeature", classFeature: "Adept Speed|Monk|TGTT|2"},
					{type: "refClassFeature", classFeature: "Marathon Runner|Monk|TGTT|2"},
					{type: "refClassFeature", classFeature: "Nimble Athlete|Monk|TGTT|2"},
					{type: "refClassFeature", classFeature: "Wall Walk|Monk|TGTT|4"},
					{type: "refClassFeature", classFeature: "Instant Step|Monk|TGTT|11"},
				],
			},
		],
	};

	// Mock level 4 "Specialties" feature (references level 2 feature)
	const specialtiesLevel4 = {
		name: "Specialties",
		source: "TGTT",
		className: "Monk",
		classSource: "TGTT",
		level: 4,
		entries: [
			"You gain another specialty of your choice from the {@classFeature Specialties|Monk|TGTT|2}.",
		],
	};

	// Mock full classFeatures array
	const allClassFeatures = [
		specialtiesFeature,
		specialtiesLevel4,
		{name: "Adept Speed", className: "Monk", source: "TGTT", level: 2, entries: ["Your speed increases by 10 feet."]},
		{name: "Marathon Runner", className: "Monk", source: "TGTT", level: 2, entries: ["Fast pace no penalty."]},
		{name: "Nimble Athlete", className: "Monk", source: "TGTT", level: 2, entries: ["Use DEX for Athletics."]},
		{name: "Wall Walk", className: "Monk", source: "TGTT", level: 4, entries: ["Walk on walls."]},
		{name: "Instant Step", className: "Monk", source: "TGTT", level: 11, entries: ["Teleport."]},
	];

	test("should generate option group with count: 1 for TGTT Specialties at level 2", () => {
		const results = CharacterSheetClassUtils.findFeatureOptions(specialtiesFeature, 2, allClassFeatures);
		expect(results).toHaveLength(1);
		expect(results[0].count).toBe(1);
		// Only level-2-eligible options at character level 2
		const optNames = results[0].options.map(o => o.name);
		expect(optNames).toContain("Adept Speed");
		expect(optNames).toContain("Marathon Runner");
		expect(optNames).toContain("Nimble Athlete");
		expect(optNames).not.toContain("Wall Walk"); // level 4
		expect(optNames).not.toContain("Instant Step"); // level 11
	});

	test("should include higher-level options when character level is high enough", () => {
		const results = CharacterSheetClassUtils.findFeatureOptions(specialtiesFeature, 4, allClassFeatures);
		expect(results).toHaveLength(1);
		const optNames = results[0].options.map(o => o.name);
		expect(optNames).toContain("Wall Walk");
		expect(optNames).not.toContain("Instant Step"); // still too high
	});

	test("level 4 Specialties feature resolves via classFeature reference", () => {
		const results = CharacterSheetClassUtils.findFeatureOptions(specialtiesLevel4, 4, allClassFeatures);
		expect(results).toHaveLength(1);
		expect(results[0].count).toBe(1);
		expect(results[0].referencedFrom).toBe("Specialties|Monk|TGTT|2");
		const optNames = results[0].options.map(o => o.name);
		expect(optNames).toContain("Adept Speed");
		expect(optNames).toContain("Wall Walk");
	});

	test("getLevelFeatures does NOT extract individual specialties from options block", () => {
		const classData = {
			name: "Monk",
			source: "TGTT",
			classFeatures: ["Specialties|Monk|TGTT|2"],
		};
		const features = CharacterSheetClassUtils.getLevelFeatures(classData, 2, null, allClassFeatures);
		// Only the parent "Specialties" feature, not individual specialties
		expect(features).toHaveLength(1);
		expect(features[0].name).toBe("Specialties");
	});

	test("dedupAndBuildFeatures strips options from Specialties description", () => {
		const classData = {
			name: "Monk",
			source: "TGTT",
			classFeatures: ["Specialties|Monk|TGTT|2"],
		};
		const features = CharacterSheetClassUtils.getLevelFeatures(classData, 2, null, allClassFeatures);
		const built = CharacterSheetClassUtils.dedupAndBuildFeatures(features, [], {
			className: "Monk",
			classSource: "TGTT",
			level: 2,
		});
		expect(built).toHaveLength(1);
		expect(built[0].name).toBe("Specialties");
		// Description should NOT contain individual specialty names from the options block
		expect(built[0].description).not.toContain("Adept Speed");
		expect(built[0].description).not.toContain("Marathon Runner");
	});

	test("getFeatureOptionsForLevel returns option groups for Specialties features", () => {
		const features = [specialtiesFeature]; // level 2 features
		const optGroups = CharacterSheetClassUtils.getFeatureOptionsForLevel(features, 2, allClassFeatures);
		expect(optGroups).toHaveLength(1);
		expect(optGroups[0].featureName).toBe("Specialties");
		expect(optGroups[0].count).toBe(1);
		expect(optGroups[0].options.length).toBeGreaterThan(0);
	});
});

describe("getSubclassGrantedTraditions — Subclass Combat Methods Integration", () => {
	test("returns Sanguine Knot for Mercy monk", () => {
		const granted = CharacterSheetClassUtils.getSubclassGrantedTraditions(
			{shortName: "Mercy", source: "TGTT"},
			"TGTT",
		);
		expect(granted).toHaveLength(1);
		expect(granted[0].code).toBe("SK");
		expect(granted[0].tradition).toBe("Sanguine Knot");
		expect(granted[0].bonusMethods).toBe(1);
	});

	test("returns Biting Zephyr for Elements monk", () => {
		const granted = CharacterSheetClassUtils.getSubclassGrantedTraditions(
			{shortName: "Elements", source: "TGTT"},
			"TGTT",
		);
		expect(granted).toHaveLength(1);
		expect(granted[0].code).toBe("BZ");
		expect(granted[0].bonusMethods).toBe(1);
	});

	test("returns two traditions for Eldritch Knight fighter", () => {
		const granted = CharacterSheetClassUtils.getSubclassGrantedTraditions(
			{shortName: "Eldritch Knight", source: "TGTT"},
			"TGTT",
		);
		expect(granted).toHaveLength(2);
		expect(granted.map(g => g.code)).toEqual(["AK", "EB"]);
		expect(granted[0].bonusMethods).toBe(1);
		expect(granted[1].bonusMethods).toBe(1);
	});

	test("returns choice-based traditions for Open Hand monk", () => {
		const granted = CharacterSheetClassUtils.getSubclassGrantedTraditions(
			{shortName: "Open Hand", source: "TGTT"},
			"TGTT",
		);
		expect(granted).toHaveLength(2);
		expect(granted.every(g => g.choice)).toBe(true);
		expect(granted.map(g => g.code)).toEqual(["AM", "TI"]);
	});

	test("returns empty for non-TGTT sources", () => {
		const granted = CharacterSheetClassUtils.getSubclassGrantedTraditions(
			{shortName: "Mercy", source: "XPHB"},
			"XPHB",
		);
		expect(granted).toHaveLength(0);
	});

	test("returns empty for unknown subclass", () => {
		const granted = CharacterSheetClassUtils.getSubclassGrantedTraditions(
			{shortName: "Nonexistent", source: "TGTT"},
			"TGTT",
		);
		expect(granted).toHaveLength(0);
	});

	test("getSubclassBonusMethodCount returns 1 for Mercy", () => {
		const count = CharacterSheetClassUtils.getSubclassBonusMethodCount(
			{shortName: "Mercy", source: "TGTT"},
			"TGTT",
		);
		expect(count).toBe(1);
	});

	test("getSubclassBonusMethodCount returns 2 for Eldritch Knight", () => {
		const count = CharacterSheetClassUtils.getSubclassBonusMethodCount(
			{shortName: "Eldritch Knight", source: "TGTT"},
			"TGTT",
		);
		expect(count).toBe(2);
	});

	test("getSubclassBonusMethodCount returns 0 for non-TGTT", () => {
		const count = CharacterSheetClassUtils.getSubclassBonusMethodCount(
			{shortName: "Mercy", source: "XPHB"},
			"XPHB",
		);
		expect(count).toBe(0);
	});
});
