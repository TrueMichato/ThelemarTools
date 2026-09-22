import "./setup.js";
import fs from "node:fs";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetRespec = globalThis.CharacterSheetRespec;

describe("CharacterSheetRespec workspace", () => {
	const fighter = {
		name: "Fighter",
		source: "XPHB",
		hd: {number: 1, faces: 10},
		startingProficiencies: {
			skills: [{choose: {from: ["athletics", "perception"], count: 1}}],
		},
		classFeatures: [],
	};

	let state;
	let respec;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Fighter", source: "XPHB", level: 1});
		state.recordLevelChoice({
			level: 1,
			class: {name: "Fighter", source: "XPHB"},
			choices: {},
		});
		const page = {
			getClasses: () => [fighter],
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			getSkillsList: () => ["athletics", "perception"],
			saveCharacter: async () => {},
			renderCharacter: () => {},
		};
		respec = new CharacterSheetRespec({page, state});
		respec._engine.begin();
		respec._state = respec._engine.state;
	});

	it("surfaces skipped required choices that never existed in sparse history", () => {
		const choices = respec._getEditableChoices(1, respec._state.getLevelHistoryEntry(1));
		expect(choices).toEqual(expect.arrayContaining([
			expect.objectContaining({
				type: "skills",
				label: "Starting Skill Proficiencies",
				current: "Not selected",
				decision: expect.objectContaining({status: "missing"}),
			}),
		]));
		expect(respec._engine.getValidation().isValid).toBe(false);
	});

	it("keeps a staged repair isolated and makes the draft ready to apply", () => {
		const skillDecision = respec._engine.manifest.decisions.find(decision => decision.type === "skills");
		respec._state.addSkillProficiency("athletics");
		respec._engine.updateDecisionSelection(skillDecision.id, ["athletics"]);

		expect(state.getSkillProficiency("athletics")).toBe(0);
		expect(respec._state.getSkillProficiency("athletics")).toBe(1);
		expect(respec._engine.getValidation().isValid).toBe(true);
	});

	it("ships persistent draft controls and non-hover-only level actions", () => {
		const html = fs.readFileSync("charactersheet.html", "utf8");
		const css = fs.readFileSync("css/charactersheet.css", "utf8");
		expect(html).toContain("id=\"charsheet-respec-draft-status\" role=\"status\" aria-live=\"polite\"");
		expect(html).toContain("id=\"charsheet-respec-cancel\"");
		expect(html).toContain("id=\"charsheet-respec-review\"");
		expect(html).toContain("id=\"charsheet-respec-apply\"");
		expect(css).toMatch(/\.charsheet__level-entry-edit\s*\{[\s\S]*?opacity:\s*1;/);
		expect(css).toMatch(/\.charsheet__level-entry-remove\s*\{[\s\S]*?opacity:\s*1;/);
	});

	it("reassigns a historical level and rebuilds the multiclass structure in the draft", () => {
		const wizard = {
			name: "Wizard",
			source: "XPHB",
			hd: {number: 1, faces: 6},
			startingProficiencies: {skills: []},
			classFeatures: [],
			spellsKnownProgressionFixed: [6],
			cantripProgression: [3],
			casterProgression: "full",
			spellcastingAbility: "int",
		};
		state.addClass({name: "Fighter", source: "XPHB", level: 2, hd: fighter.hd});
		state.recordLevelChoice({
			level: 2,
			class: {name: "Fighter", source: "XPHB"},
			choices: {},
		});
		respec._page.getClasses = () => [fighter, wizard];
		respec._engine.cancel();
		respec._engine.begin();
		respec._state = respec._engine.state;

		const classDecision = respec._engine.manifest.decisions.find(decision =>
			decision.type === "class" && decision.characterLevel === 2,
		);
		respec._applyClassAllocationChange(classDecision, wizard);

		expect(respec._state.getClasses()).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Fighter", level: 1}),
			expect.objectContaining({name: "Wizard", level: 1}),
		]));
		expect(respec._state.getLevelHistoryEntry(2).class).toEqual({name: "Wizard", source: "XPHB"});
		expect(state.getClasses()).toEqual([expect.objectContaining({name: "Fighter", level: 2})]);
		expect(respec._engine.getValidation().errors).toEqual(expect.arrayContaining([
			expect.objectContaining({message: expect.stringContaining("Starting Spellbook")}),
		]));
	});

	it("preserves progression-owned choices when class reassignment changes their semantic keys", () => {
		const rogue = {
			name: "Rogue",
			source: "XPHB",
			hd: {number: 1, faces: 8},
			startingProficiencies: {
				skills: [{choose: {from: ["athletics", "perception"], count: 1}}],
			},
			classFeatures: [],
		};
		state.addClass({name: "Fighter", source: "XPHB", level: 2, hd: fighter.hd});
		state.updateLevelChoice(1, {skills: ["athletics"]});
		state.addSkillProficiency("athletics");
		state.recordLevelChoice({
			level: 2,
			class: {name: "Fighter", source: "XPHB"},
			choices: {},
		});
		respec._page.getClasses = () => [fighter, rogue];
		respec._engine.cancel();
		respec._engine.begin();
		respec._state = respec._engine.state;

		const oldSkillDecision = respec._engine.manifest.decisions.find(decision =>
			decision.type === "skills" && decision.characterLevel === 1,
		);
		const classDecision = respec._engine.manifest.decisions.find(decision =>
			decision.type === "class" && decision.characterLevel === 1,
		);
		respec._applyClassAllocationChange(classDecision, rogue);
		const newSkillDecision = respec._engine.manifest.decisions.find(decision =>
			decision.type === "skills" && decision.characterLevel === 1,
		);

		expect(newSkillDecision.semanticKey).not.toBe(oldSkillDecision.semanticKey);
		expect(newSkillDecision.selection).toEqual(["athletics"]);
		expect(respec._state.getSkillProficiency("athletics")).toBe(1);
	});

	it("preserves an overlapping proficiency owned by another progression decision", () => {
		const decision = respec._engine.manifest.decisions.find(it => it.type === "skills");
		decision.selection = ["athletics"];
		respec._state.addSkillProficiency("athletics");
		respec._state.claimProgressionOwnership("skills", "athletics", decision.semanticKey);
		respec._state.claimProgressionOwnership("skills", "athletics", "fighter|xphb|2|skills|bonus|0");

		respec._applyManifestSelectionMechanics(decision, ["perception"], decision.options);

		expect(respec._state.getSkillProficiency("athletics")).toBe(1);
		expect(respec._state.getSkillProficiency("perception")).toBe(1);
	});

	it("reverses Protector grants while preserving an independent martial/armor source", () => {
		const protector = {
			name: "Protector",
			source: "XPHB",
			className: "Cleric",
			classSource: "XPHB",
			level: 1,
			entries: ["You gain proficiency with {@filter Martial weapons|items|type=martial weapon} and training with {@filter Heavy armor|items|type=Heavy Armor}."],
		};
		const decision = {
			type: "nestedEntity",
			semanticKey: "nested:divine-order:protector:occ0:slot0",
			selection: {name: "Protector", source: "XPHB"},
			provenance: {ownerUid: "Divine Order|XPHB", grantKey: "options.0"},
			className: "Cleric",
			classSource: "XPHB",
			classLevel: 1,
			characterLevel: 1,
		};
		respec._state.addFeature({...protector, sourceDecisionKey: decision.semanticKey});
		respec._state.addWeaponProficiency("Martial weapons");
		respec._state.addArmorProficiency("Heavy armor");
		respec._state.claimProgressionOwnership("weapons", "Martial weapons", decision.semanticKey);
		respec._state.claimProgressionOwnership("armor", "Heavy armor", decision.semanticKey);
		respec._state.addWeaponProficiency("Martial weapons");
		respec._state.claimProgressionOwnership("weapons", "Martial weapons", "manual:training");
		respec._state.addArmorProficiency("Heavy armor");
		respec._state.claimProgressionOwnership("armor", "Heavy armor", "manual:training");

		respec._state.reverseProgressionFeatureReceipt(decision);

		expect(respec._state.getWeaponProficiencies()).toContain("Martial weapons");
		expect(respec._state.getArmorProficiencies()).toContain("Heavy armor");
		expect(respec._state.getFeatures().some(feature => feature.name === "Protector")).toBe(false);
	});

	it("preserves Cruel resource uses only for the surviving source decision", () => {
		const cruel = {
			name: "Cruel",
			source: "TGTT",
			className: "Fighter",
			classSource: "XPHB",
			level: 1,
			uses: {max: 2, current: 2, recharge: "long"},
			sourceDecisionKey: "nested:feat:cruel:occ0:slot0",
			entries: [],
		};
		respec._state.addFeature(cruel, {sourceDecisionKey: cruel.sourceDecisionKey});
		const resource = respec._state.getResources().find(item => item.name === "Cruel");
		expect(resource).toBeTruthy();
		respec._state.setResourceCurrent(resource.id, 1);

		const decision = {
			semanticKey: cruel.sourceDecisionKey,
			receipt: {effects: []},
		};
		respec._state.reverseProgressionFeatureReceipt(decision);
		expect(respec._state.getResources().some(item => item.name === "Cruel")).toBe(false);

		respec._state.addFeature({...cruel, sourceDecisionKey: "nested:feat:other:occ0:slot0"}, {
			sourceDecisionKey: "nested:feat:other:occ0:slot0",
		});
		const unrelated = respec._state.getResources().find(item => item.name === "Cruel");
		expect(unrelated.current).toBe(unrelated.max);
	});

	it("tracks and reverses Cruel triggered dice by source and turn", () => {
		const sourceDecisionKey = "nested:feat:cruel:triggered";
		respec._state.addFeat({
			name: "Cruel",
			source: "TalDoreiCampaignSettingReborn",
		}, {sourceDecisionKey});
		const resource = respec._state.getResources().find(item => item.name === "Cruelty Dice");
		expect(resource).toMatchObject({
			sourceDecisionKey,
			triggeredDiePool: expect.objectContaining({die: "d6", oncePerTurn: true}),
		});
		respec._state.startCombat();
		const options = respec._state.getTriggeredFeatDieOptions("damage", {});
		expect(options).toEqual(expect.arrayContaining([
			expect.objectContaining({resourceId: resource.id, die: "d6"}),
		]));
		expect(respec._state.spendTriggeredFeatDie(resource.id, "damage", {}).ok).toBe(true);
		expect(respec._state.spendTriggeredFeatDie(resource.id, "damage", {}).ok).toBe(false);
		expect(respec._state.queryTurnReceipt(resource.triggeredDiePool.turnReceipt.key)).toMatchObject({
			ok: true,
			used: true,
			turnId: expect.any(Number),
		});

		respec._state.reverseProgressionFeatureReceipt({
			semanticKey: sourceDecisionKey,
			receipt: {sourceDecisionKey, effects: []},
		});
		expect(respec._state.getResources().some(item => item.sourceDecisionKey === sourceDecisionKey)).toBe(false);
		expect(respec._state.queryTurnReceipt(resource.triggeredDiePool.turnReceipt.key).used).toBe(false);
		expect(respec._state.getFeats().some(feat => feat.sourceDecisionKey === sourceDecisionKey)).toBe(false);
	});

	it("applies subclass-specific choices to the canonical class entry", () => {
		const decision = {
			type: "subclassChoice",
			className: "Fighter",
			selection: null,
		};

		respec._applyManifestSelectionMechanics(decision, {key: "vanguard", label: "Vanguard"}, []);

		expect(respec._state.getSubclassChoice("Fighter")).toEqual({key: "vanguard", name: "vanguard"});
	});

	it("creates a skipped class feat-progression choice through the canonical feat transaction", () => {
		const fighterWithStyle = {
			...fighter,
			featProgression: [{name: "Fighting Style", category: ["FS"], progression: {"1": 1}}],
		};
		const defense = {name: "Defense", source: "XPHB", category: "FS", entries: []};
		respec._page.getClasses = () => [fighterWithStyle];
		respec._page.getFeats = () => [defense];
		respec._page.getSpells = () => [];
		respec._page.filterByAllowedSources = values => values;
		respec._engine.cancel();
		respec._engine.begin();
		respec._state = respec._engine.state;
		const decision = respec._engine.manifest.decisions.find(it => it.type === "classFeatProgressionFeat");

		expect(decision).toMatchObject({status: "missing", label: "Fighting Style"});
		expect(respec._applyClassFeatProgressionDecisionChange(decision, defense, {})).toBe(true);
		expect(respec._state.getFeats()).toEqual(expect.arrayContaining([
			expect.objectContaining({
				name: "Defense",
				classFeatProgression: expect.objectContaining({
					className: "Fighter",
					level: 1,
					progressionName: "Fighting Style",
				}),
			}),
		]));
		expect(respec._engine.getDecision(decision.id)).toMatchObject({
			status: "resolved",
			selection: expect.objectContaining({name: "Defense", progressionName: "Fighting Style"}),
		});
	});

	it("preserves a class-selected skill which the species also grants", () => {
		state.setRace({
			name: "Athletic Species",
			source: "TGTT",
			skillProficiencies: [{athletics: true}],
		});
		state.addSkillProficiency("athletics");
		state.updateLevelChoice(1, {skills: ["athletics"]});
		respec._engine.cancel();
		respec._engine.begin();
		respec._state = respec._engine.state;

		const decision = respec._engine.manifest.decisions.find(it => it.type === "skills");
		respec._applyManifestSelectionMechanics(decision, ["perception"], decision.options);

		expect(respec._state.getSkillProficiency("athletics")).toBe(1);
		expect(respec._state.getSkillProficiency("perception")).toBe(1);
	});

	it("removes values owned only by decisions which disappear in a cascade", () => {
		respec._state.addSkillProficiency("athletics");
		respec._state.claimProgressionOwnership("skills", "athletics", "removed-decision");
		respec._state._data.progressionOwnership.initialized = true;

		respec._state.reconcileProgressionOwnership({decisions: []});

		expect(respec._state.getSkillProficiency("athletics")).toBe(0);
	});

	it("keeps legacy martial rows editable beside manifest decisions", () => {
		const history = respec._state.getLevelHistoryEntry(1);
		history.choices.combatTraditions = ["BON"];
		history.choices.weaponMasteries = ["Longsword|XPHB"];

		const choices = respec._getEditableChoices(1, history);

		expect(choices).toEqual(expect.arrayContaining([
			expect.objectContaining({type: "combatTraditions"}),
			expect.objectContaining({type: "weaponMasteries"}),
		]));
	});

	it("changes or defers a historical spell replacement without leaving the old replacement behind", () => {
		const spellA = {name: "Charm Person", source: "XPHB", level: 1, sourceClass: "Fighter"};
		const spellB = {name: "Sleep", source: "XPHB", level: 1, sourceClass: "Fighter"};
		const spellC = {name: "Thunderwave", source: "XPHB", level: 1, sourceClass: "Fighter"};
		respec._state.addSpell(spellB);
		const decision = {
			type: "spellSwap",
			semanticKey: "fighter|xphb|2|spell-swap|spell-swap|0",
			className: "Fighter",
			selection: {removed: spellA, added: spellB},
		};
		respec._state.claimProgressionOwnership("spells", spellB, decision.semanticKey);

		expect(respec._applySpellSwapMechanics(decision, {removed: spellA, added: spellC}, [spellA, spellB, spellC])).toBe(true);
		expect(respec._state.getSpellsKnown().map(spell => spell.name)).toEqual(["Thunderwave"]);

		decision.selection = {removed: spellA, added: spellC};
		expect(respec._applySpellSwapMechanics(decision, null, [spellA, spellB, spellC])).toBe(true);
		expect(respec._state.getSpellsKnown().map(spell => spell.name)).toEqual(["Charm Person"]);
	});

	it("removes fixed feat spells unless another progression decision owns them", () => {
		const mageHand = {name: "Mage Hand", source: "PHB", level: 0};
		const telekinetic = {
			name: "Telekinetic",
			source: "TCE",
			additionalSpells: [{known: {"_": ["mage hand|PHB#c"]}}],
		};
		respec._state.addFeat(telekinetic, {allSpells: [mageHand]});
		expect(respec._state.getCantripsKnown().map(it => it.name)).toEqual(["Mage Hand"]);

		respec._state.removeFeat("Telekinetic", "TCE");
		expect(respec._state.getCantripsKnown()).toEqual([]);

		respec._state.addFeat(telekinetic, {allSpells: [mageHand]});
		const stored = respec._state.getCantripsKnown()[0];
		respec._state.claimProgressionOwnership("cantrips", stored, "later-cantrip-choice");
		respec._state.removeFeat("Telekinetic", "TCE");

		expect(respec._state.getCantripsKnown().map(it => it.name)).toEqual(["Mage Hand"]);
	});

	it("keeps a feat-granted language when a later progression decision also owns it", () => {
		const feat = {
			name: "Draconic Student",
			source: "TGTT",
			languageProficiencies: [{draconic: true}],
		};
		respec._state.addFeat(feat);
		CharacterSheetClassUtils.applyFeatBonuses(respec._state, feat);
		respec._state.claimProgressionOwnership("languages", "draconic", "later-language-choice");

		respec._state.removeFeat("Draconic Student", "TGTT");

		expect(respec._state.getLanguages().map(it => it.toLowerCase())).toContain("draconic");
	});

	it("rejects replacing a spell with itself", () => {
		const spell = {name: "Sleep", source: "XPHB", level: 1, sourceClass: "Fighter"};
		respec._state.addSpell(spell);
		const decision = {
			type: "spellSwap",
			semanticKey: "fighter|xphb|2|spell-swap|spell-swap|0",
			className: "Fighter",
			selection: null,
		};

		expect(respec._applySpellSwapMechanics(decision, {removed: spell, added: spell}, [spell])).toBe(false);
		expect(respec._state.getSpellsKnown().map(it => it.name)).toEqual(["Sleep"]);
	});

	it("repairs a legacy level-19 ASI with a feat and reverses exact feat effects on replacement", () => {
		const bard = {
			name: "Bard",
			source: "TGTT",
			hd: {number: 1, faces: 8},
			spellcastingAbility: "cha",
			classFeatures: ["Epic Boon|Bard|TGTT|19"],
			featProgression: [{name: "Epic Boon", category: ["EB"], progression: {"19": 1}}],
		};
		const boon = {
			name: "Boon of Presence",
			source: "TGTT",
			category: "EB",
			ability: [{choose: {from: ["cha"], amount: 1}, max: 30}],
			entries: [],
		};
		const alternative = {
			name: "Resilient Constitution",
			source: "TGTT",
			category: "G",
			ability: [{con: 1, max: 20}],
			entries: [],
		};
		state = new CharacterSheetState();
		state.setAbilityBase("con", 14);
		state.setAbilityBase("cha", 18);
		state.addClass({...bard, level: 19});
		for (let level = 1; level <= 19; ++level) {
			state.recordLevelChoice({
				level,
				class: {name: "Bard", source: "TGTT"},
				choices: level === 19 ? {asi: {con: 2}} : {},
			});
		}
		const page = {
			getClasses: () => [bard],
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			getFeats: () => [boon, alternative],
			getSpells: () => [],
			getFilteredSpellData: () => [],
			getSkillsList: () => [],
			filterByAllowedSources: values => values,
			saveCharacter: async () => {},
			renderCharacter: () => {},
		};
		respec = new CharacterSheetRespec({page, state});
		respec._engine.begin();
		respec._state = respec._engine.state;

		let decision = respec._engine.manifest.decisions.find(it => it.type === "feat" && it.characterLevel === 19);
		expect(decision).toMatchObject({status: "invalid", selection: {legacyAsi: {con: 2}}});

		expect(respec._applyImprovementChange(decision, {
			mode: "feat",
			feat: boon,
			featChoices: {ability: "cha"},
		})).toBe(true);
		expect(respec._state.getAbilityBase("con")).toBe(12);
		expect(respec._state.getAbilityBase("cha")).toBe(19);
		expect(respec._state.getFeats()).toEqual(expect.arrayContaining([
			expect.objectContaining({name: "Boon of Presence", choices: expect.objectContaining({ability: "cha"})}),
		]));
		expect(respec._state.getLevelHistoryEntry(19).choices).toMatchObject({
			feat: {name: "Boon of Presence", source: "TGTT"},
		});
		expect(respec._state.getLevelHistoryEntry(19).choices.asi).toBeUndefined();

		decision = respec._engine.manifest.decisions.find(it => it.type === "feat" && it.characterLevel === 19);
		expect(respec._applyImprovementChange(decision, {
			mode: "feat",
			feat: alternative,
			featChoices: {},
		})).toBe(true);
		expect(respec._state.getAbilityBase("cha")).toBe(18);
		expect(respec._state.getAbilityBase("con")).toBe(13);
		expect(respec._state.getFeats().map(it => it.name)).toEqual(["Resilient Constitution"]);
	});

	it("commits a legacy level-19 Epic Boon from an untracked-spell save through Apply, reload, refresh, and reopen", async () => {
		const jester = {
			name: "College of Jesters",
			shortName: "Jesters",
			source: "TGTT",
		};
		const bard = {
			name: "Bard",
			source: "TGTT",
			hd: {number: 1, faces: 8},
			spellcastingAbility: "cha",
			casterProgression: "full",
			cantripProgression: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
			preparedSpellsProgression: [4, 5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22],
			classFeatures: [
				{classFeature: "Bard Subclass|Bard|XPHB|3", gainSubclassFeature: true},
				"Epic Boon|Bard|XPHB|19",
			],
			featProgression: [{name: "Epic Boon", category: ["EB"], progression: {"19": 1}}],
			subclasses: [jester],
		};
		const alert = {name: "Alert", source: "XPHB", category: "O", entries: []};
		const boon = {
			name: "Boon of Spell Recall",
			source: "XPHB",
			category: "EB",
			ability: [{choose: {from: ["int", "wis", "cha"], amount: 1}, max: 30}],
			entries: [],
		};
		state = new CharacterSheetState();
		state.setAbilityBase("con", 15);
		state.setAbilityBase("int", 10);
		state.addClass({...bard, level: 20, subclass: jester});
		state.addFeat(alert);
		for (let level = 1; level <= 20; ++level) {
			state.recordLevelChoice({
				level,
				class: {name: "Bard", source: "TGTT"},
				choices: {
					...(level === 3 ? {subclass: jester} : {}),
					...(level === 19 ? {asi: {con: 2}} : {}),
				},
			});
		}
		const page = {
			getClasses: () => [bard],
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			getFeats: () => [alert, boon],
			getSpells: () => [],
			getFilteredSpellData: () => [],
			getSkillsList: () => [],
			filterByAllowedSources: values => values,
			saveCharacter: jest.fn().mockResolvedValue(undefined),
			renderCharacter: jest.fn(),
		};
		respec = new CharacterSheetRespec({page, state});
		respec._engine.begin();
		respec._state = respec._engine.state;

		const decision = respec._engine.manifest.decisions.find(it => it.type === "feat" && it.characterLevel === 19);
		expect(decision).toMatchObject({status: "invalid", selection: {legacyAsi: {con: 2}}});
		expect(respec._engine.manifest.decisions.filter(it => ["knownSpells", "cantrips"].includes(it.type)))
			.toEqual(expect.arrayContaining([
				expect.objectContaining({required: false, status: "deferred", meta: expect.objectContaining({legacyUntracked: true})}),
			]));
		expect(respec._applyImprovementChange(decision, {
			mode: "feat",
			feat: boon,
			featChoices: {ability: "int"},
		})).toBe(true);
		expect(respec._engine.getValidation().errors).toEqual([]);

		await respec._engine.apply();

		expect(state.getAbilityBase("con")).toBe(13);
		expect(state.getAbilityBase("int")).toBe(11);
		expect(state.getFeats()).toEqual(expect.arrayContaining([
			expect.objectContaining({
				name: "Boon of Spell Recall",
				choices: expect.objectContaining({ability: "int"}),
				appliedEffects: expect.objectContaining({abilityDeltas: {int: 1}}),
			}),
		]));
		expect(state.getLevelHistoryEntry(19)).toMatchObject({
			choices: {feat: {name: "Boon of Spell Recall", source: "XPHB"}},
			manifestComplete: true,
			decisions: expect.arrayContaining([
				expect.objectContaining({
					type: "feat",
					status: "resolved",
					selection: {name: "Boon of Spell Recall", source: "XPHB"},
				}),
			]),
		});
		expect(state.getLevelHistoryEntry(19).choices.asi).toBeUndefined();

		let roundTripped = state;
		for (let i = 0; i < 3; ++i) {
			const loaded = new CharacterSheetState();
			expect(loaded.loadFromJson(roundTripped.toJson())).not.toBe(false);
			const reopened = new CharacterSheetRespec({page, state: loaded});
			reopened._engine.begin();
			reopened._state = reopened._engine.state;
			reopened._engine.refreshManifest();
			reopened._engine.refreshManifest();

			expect(reopened._state.getAbilityBase("con")).toBe(13);
			expect(reopened._state.getAbilityBase("int")).toBe(11);
			expect(reopened._state.getFeats()).toEqual(expect.arrayContaining([
				expect.objectContaining({
					name: "Boon of Spell Recall",
					choices: expect.objectContaining({ability: "int"}),
					appliedEffects: expect.objectContaining({abilityDeltas: {int: 1}}),
				}),
			]));
			expect(reopened._engine.manifest.decisions.find(it => it.type === "feat" && it.characterLevel === 19))
				.toMatchObject({
					status: "resolved",
					selection: {name: "Boon of Spell Recall", source: "XPHB"},
				});
			expect(reopened._engine.getValidation().errors).toEqual([]);
			roundTripped = reopened._state;
		}
	});

	it("renders feat sub-choices against the isolated Respec candidate and persists their receipt", async () => {
		const jester = {
			name: "College of Jesters",
			shortName: "Jesters",
			source: "TGTT",
		};
		const boon = {
			name: "Boon of Spell Recall",
			source: "XPHB",
			category: "EB",
			ability: [{choose: {from: ["cha"], amount: 1}, max: 30}],
			entries: [],
		};
		const bard = {
			name: "Bard",
			source: "TGTT",
			hd: {number: 1, faces: 8},
			cantripProgression: Array(19).fill(0),
			spellsKnownProgression: Array(19).fill(0),
			classFeatures: ["Epic Boon|Bard|XPHB|19"],
			featProgression: [{name: "Epic Boon", category: ["EB"], progression: {"19": 1}}],
			subclasses: [jester],
		};
		state = new CharacterSheetState();
		state.setAbilityBase("con", 14);
		state.setAbilityBase("cha", 18);
		state.addClass({...bard, level: 19, subclass: jester});
		for (let level = 1; level <= 19; ++level) {
			state.recordLevelChoice({
				level,
				class: {name: "Bard", source: "TGTT"},
				choices: {
					...(level === 3 ? {subclass: jester} : {}),
					...(level === 19 ? {asi: {con: 2}} : {}),
				},
			});
		}
		const renderStates = [];
		const levelUp = {
			_state: state,
			_renderFeatChoicesUI (feat) {
				renderStates.push(this._state);
				feat._featChoices.ability = "cha";
			},
		};
		const page = {
			_levelUp: levelUp,
			getClasses: () => [bard],
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			getFeats: () => [boon],
			getSpells: () => [],
			getFilteredSpellData: () => [],
			getSkillsList: () => [],
			filterByAllowedSources: values => values,
			saveCharacter: async () => {},
			renderCharacter: () => {},
		};
		respec = new CharacterSheetRespec({page, state});
		respec._engine.begin();
		respec._state = respec._engine.state;
		const feat = MiscUtil.copyFast(boon);
		feat._featChoices = {ability: null};
		const choices = CharacterSheetClassUtils.buildFeatChoicesSpec(feat, {
			state: respec._state,
			page,
		});

		expect(respec._renderFeatChoicesForCandidate(feat, choices, {})).toBe(true);
		expect(renderStates).toHaveLength(1);
		expect(renderStates[0]).toBe(respec._state);
		expect(feat._featChoices.ability).toBe("cha");

		const decision = respec._engine.manifest.decisions.find(it => it.type === "feat" && it.characterLevel === 19);
		expect(respec._applyImprovementChange(decision, {
			mode: "feat",
			feat,
			featChoices: feat._featChoices,
		})).toBe(true);
		expect(respec._engine.getValidation().errors).toEqual([]);
		await respec._engine.apply();

		expect(state.getAbilityBase("cha")).toBe(19);
		expect(state.getFeats()).toEqual(expect.arrayContaining([
			expect.objectContaining({
				name: "Boon of Spell Recall",
				choices: expect.objectContaining({ability: "cha"}),
				appliedEffects: expect.objectContaining({abilityDeltas: {cha: 1}}),
			}),
		]));

		const loaded = new CharacterSheetState();
		expect(loaded.loadFromJson(state.toJson())).not.toBe(false);
		expect(loaded.getAbilityBase("cha")).toBe(19);
		expect(loaded.getFeats()).toEqual(expect.arrayContaining([
			expect.objectContaining({
				name: "Boon of Spell Recall",
				choices: expect.objectContaining({ability: "cha"}),
				appliedEffects: expect.objectContaining({abilityDeltas: {cha: 1}}),
			}),
		]));
	});

	it("binds feat spell pickers to candidate-known spells instead of live-known spells", () => {
		const liveSpell = {name: "Live Spell", source: "XPHB", level: 1};
		const candidateSpell = {name: "Candidate Spell", source: "XPHB", level: 1};
		state.addSpell(liveSpell);
		let pickerKnownSpellIds = null;
		let pickerPoolSpellIds = null;
		let pickerUsesCandidateSpells = false;
		const spells = {
			_state: state,
			showFilteredSpellPicker (choice, onSelect) {
				pickerKnownSpellIds = this._state.getSpells().map(spell => `${spell.name}|${spell.source}`);
				pickerPoolSpellIds = this._page.getFilteredSpellData().map(spell => `${spell.name}|${spell.source}`);
				pickerUsesCandidateSpells = this._page._spells === this;
				onSelect(candidateSpell);
			},
		};
		const levelUp = {
			_state: state,
			_page: null,
			_renderFeatChoicesUI (feat) {
				this._page._spells.showFilteredSpellPicker(
					{filter: "level=1"},
					spell => feat._featChoices.spells.push(spell),
				);
			},
		};
		const page = {
			_state: state,
			_levelUp: levelUp,
			_spells: spells,
			getFilteredSpellData () {
				return this._state.getSpells();
			},
		};
		levelUp._page = page;
		respec = new CharacterSheetRespec({page, state});
		respec._engine.begin();
		respec._state = respec._engine.state;
		respec._state.removeSpell(liveSpell.name, liveSpell.source);
		respec._state.addSpell(candidateSpell);

		const feat = {_featChoices: {spells: []}};
		expect(respec._renderFeatChoicesForCandidate(
			feat,
			{spells: {spells: {count: 1, filter: "level=1"}}},
			{},
		)).toBe(true);
		expect(pickerKnownSpellIds).toEqual(["Candidate Spell|XPHB"]);
		expect(pickerPoolSpellIds).toEqual(["Candidate Spell|XPHB"]);
		expect(pickerUsesCandidateSpells).toBe(true);
		expect(feat._featChoices.spells).toEqual([candidateSpell]);
		expect(spells._state).toBe(state);
		expect(page._spells).toBe(spells);
		expect(levelUp._state).toBe(state);
	});

	it("rejects a feat selection when the shared choice renderer fails", () => {
		const error = new Error("renderer unavailable");
		const page = {
			_levelUp: {
				_renderFeatChoicesUI: () => { throw error; },
			},
		};
		const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});
		try {
			respec = new CharacterSheetRespec({page, state});
			respec._state = state;
			expect(respec._renderFeatChoicesForCandidate(
				{_featChoices: {ability: null}},
				{ability: {from: ["cha"], amount: 1, max: 30}},
				{},
			)).toBe(false);
			expect(consoleSpy).toHaveBeenCalledWith("[Respec] Failed to render feat choices:", error);
		} finally {
			consoleSpy.mockRestore();
		}
	});

	it("recomputes a retained paired feat when its ASI changes below the ability cap", () => {
		const fighterBoth = {
			name: "Fighter",
			source: "TGTT",
			hd: {number: 1, faces: 10},
			classFeatures: [
				[],
				[],
				[],
				["Ability Score Improvement|Fighter|TGTT|4"],
			],
		};
		const strengthFeat = {
			name: "Strength Training",
			source: "TGTT",
			category: "G",
			ability: [{str: 1, max: 20}],
		};
		state = new CharacterSheetState();
		state.setAbilityBase("str", 18);
		state.setAbilityBase("con", 10);
		state.addClass({...fighterBoth, level: 4});
		for (let level = 1; level <= 4; ++level) {
			state.recordLevelChoice({
				level,
				class: {name: "Fighter", source: "TGTT"},
				choices: level === 4
					? {asi: {str: 2}, feat: {name: strengthFeat.name, source: strengthFeat.source}}
					: {},
			});
		}
		state.setAbilityBase("str", 20);
		state.addFeat(strengthFeat);
		CharacterSheetClassUtils.applyFeatBonuses(state, strengthFeat);
		const page = {
			getClasses: () => [fighterBoth],
			getClassFeatures: () => [],
			getSubclassFeatures: () => [],
			getOptionalFeatures: () => [],
			getFeats: () => [strengthFeat],
			getSpells: () => [],
			getFilteredSpellData: () => [],
			getSkillsList: () => [],
			filterByAllowedSources: values => values,
			saveCharacter: async () => {},
			renderCharacter: () => {},
		};
		respec = new CharacterSheetRespec({page, state});
		respec._engine.begin();
		respec._state = respec._engine.state;
		const asiDecision = respec._engine.manifest.decisions.find(it => it.type === "asi" && it.characterLevel === 4);

		expect(respec._applyImprovementChange(asiDecision, {mode: "asi", asi: {con: 2}})).toBe(true);
		expect(respec._state.getAbilityBase("str")).toBe(19);
		expect(respec._state.getAbilityBase("con")).toBe(12);
		expect(respec._state.getFeats().map(it => it.name)).toEqual(["Strength Training"]);
	});
});
