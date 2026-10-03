import "./setup.js";
import {jest} from "@jest/globals";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-respec-engine.js";
import "../../../js/charactersheet/charactersheet-respec.js";

const {CharacterSheetState: State, CharacterSheetRespec: Respec} = globalThis;
const cls = {name: "Test", source: "TST", hd: {faces: 8}, classFeatures: []};
const oldBackground = {name: "Old", source: "TST"};
const background = {name: "Training", source: "TGTT", feats: [{anyFromCategory: {category: ["O"], count: 1}}]};
const originFeat = {name: "Studious", source: "TGTT", category: "O", ability: [{choose: {from: ["str", "con"], count: 1, amount: 1}}]};

function fixture () {
	const state = new State();
	state.addClass({...cls, level: 1});
	state.recordLevelChoice({level: 1, class: {name: cls.name, source: cls.source}, choices: {}});
	state.setRace({name: "Elf", source: "PHB", ability: [{dex: 2}]});
	state.setBackground(oldBackground);
	state.setAbilityBase("str", 20);
	state.setAbilityBonus("con", 3);
	state._data.directAbilityBonuses = {con: 2};
	const page = {
		getState: () => state,
		getClasses: () => [cls],
		getClassFeatures: () => [],
		getSubclassFeatures: () => [],
		getOptionalFeatures: () => [],
		getSkillsList: () => [],
		getSpells: () => [],
		getFeats: () => [originFeat],
		getBackgrounds: () => [oldBackground, background],
		filterByAllowedSources: values => values,
		saveCharacter: jest.fn().mockResolvedValue(),
		renderCharacter: jest.fn(),
	};
	state.loadFromJson(state.toJson());
	const respec = new Respec({page, state});
	respec._engine.begin();
	respec._state = respec._engine.state;
	return {state, page, respec};
}

async function choose (draft, type, value) {
	const decision = draft._engine.manifest.base.decisions.find(candidate => candidate.type === type);
	expect(decision).toBeDefined();
	return draft._engine.stageGraphMutation(decision.id, value, {
		reverseParent: true,
		apply: ({state}) => draft._applyManifestSelectionMechanics(decision, value, draft._getDecisionOptions(decision), state),
	});
}

describe("Canonical origin feat lifecycle", () => {
	it("fulfills both cantrips and the innate slot with a chosen caster, preserving pending evidence, independent known spells and retarget/reload/Undo", async () => {
		const {state, page, respec} = fixture();
		const feat = {
			name: "Magic Initiate; Wizard",
			source: "XPHB",
			category: "O",
			additionalSpells: [{
				ability: {choose: ["int", "wis", "cha"]},
				innate: {"_": {daily: {"1": [{choose: "level=1|class=Wizard"}]}}},
				known: {"_": [{choose: "level=0|class=Wizard", count: 2}]},
			}],
		};
		const next = {name: "Wizard Origin", source: "XPHB", feats: [{"magic initiate; wizard|xphb": true}]};
		const spells = [
			{name: "Light", source: "XPHB", level: 0},
			{name: "Mage Hand", source: "XPHB", level: 0},
			{name: "Shield", source: "XPHB", level: 1},
			{name: "Alarm", source: "XPHB", level: 1},
		].map(spell => ({...spell, classes: {fromClassList: [{name: "Wizard", source: "XPHB"}]}}));
		page.getFeats = () => [feat];
		page.getBackgrounds = () => [oldBackground, next];
		page.getSpells = () => spells;
		page.getFilteredSpellData = () => spells;
		state.addSpell({...spells[2], sourceFeature: "Independent Spell"});
		state.addInnateSpell({...spells[2], sourceFeature: "Independent Innate", spellcastingAbility: "cha", uses: {current: 3, max: 7}});
		const independentInnate = JSON.parse(JSON.stringify(state.getInnateSpells()[0]));
		respec._engine.begin();
		respec._state = respec._engine.state;
		const original = state.toJson();
		const draft = await respec._createBackgroundDraft(next, {choices: {}});
		const beforeAbilities = {...draft._state._data.abilities};
		expect(draft._state.getPendingSpellChoices()).toHaveLength(3);
		const caster = draft._engine.manifest.base.decisions.find(decision => decision.meta.descriptorRules?.spellcastingAbilityChoice);
		expect(caster).toMatchObject({type: "nestedConfiguration", required: true, status: "missing"});
		await choose(draft, "nestedConfiguration", "int");
		await choose(draft, "nestedCantrip", spells.slice(0, 2));
		await choose(draft, "nestedSpell", spells[2]);
		expect(draft._state._data.abilities).toEqual(beforeAbilities);
		expect(draft._state.getPendingSpellChoices()).toEqual([]);
		expect(draft._state.getCantripsKnown()).toHaveLength(2);
		expect(draft._state.getInnateSpells()).toHaveLength(2);
		expect(draft._state.getInnateSpells()).toContainEqual(expect.objectContaining({
			name: "Shield", source: "XPHB", spellcastingAbility: "int", uses: {current: 1, max: 1},
		}));
		expect(JSON.parse(JSON.stringify(draft._state.getInnateSpells().find(spell => spell.sourceFeature === "Independent Innate")))).toEqual(independentInnate);
		expect(draft._state.getFeats()[0].choices).toMatchObject({spellcastingAbility: "int", cantrips: [{name: "Light", source: "XPHB"}, {name: "Mage Hand", source: "XPHB"}], spells: [{name: "Shield", source: "XPHB", innate: true}]});
		expect(state.toJson()).toEqual(original);
		await respec._stageBackgroundDraft(draft);
		await respec._engine.apply();
		state.loadFromJson(state.toJson());
		expect(state.getPendingSpellChoices()).toEqual([]);
		const reopened = new Respec({page, state});
		reopened._engine.begin();
		reopened._state = reopened._engine.state;
		for (const damage of ["missing", "foreign", "ambiguous"]) {
			const unsafe = await reopened._createBackgroundDraft(next, {choices: {}});
			const owned = unsafe._state.getInnateSpells().find(spell => spell.sourceFeature === feat.name);
			if (damage === "missing") unsafe._state.removeInnateSpell(owned.id);
			else if (damage === "foreign") owned.sourceFeature = "Foreign Owner";
			else unsafe._state._data.spellcasting.innateSpells.push({...owned, id: `${owned.id}-duplicate`});
			const before = unsafe._state.toJson();
			await expect(choose(unsafe, "nestedSpell", spells[3])).rejects.toThrow("exact innate spell grant no longer matches");
			expect(unsafe._engine.state.toJson()).toEqual(before);
		}
		const repair = await reopened._createBackgroundDraft(next, {choices: {}});
		await choose(repair, "nestedSpell", spells[3]);
		await choose(repair, "nestedConfiguration", "wis");
		expect(repair._state.getInnateSpells()).toHaveLength(2);
		expect(repair._state.getInnateSpells()).toContainEqual(expect.objectContaining({name: "Alarm", spellcastingAbility: "wis"}));
		expect(repair._state.getInnateSpells().some(spell => spell.name === "Shield" && spell.sourceFeature === feat.name)).toBe(false);
		expect(JSON.parse(JSON.stringify(repair._state.getInnateSpells().find(spell => spell.sourceFeature === "Independent Innate")))).toEqual(independentInnate);
		expect(repair._state.getSpellsKnown()).toContainEqual(expect.objectContaining({name: "Shield", sourceFeature: "Independent Spell"}));
		await reopened._stageBackgroundDraft(repair);
		await reopened._engine.apply();
		const final = new Respec({page, state});
		final._engine.begin();
		final._state = final._engine.state;
		const removal = await final._createBackgroundDraft(oldBackground, {choices: {}});
		expect(JSON.parse(JSON.stringify(removal._state.getInnateSpells()))).toEqual([independentInnate]);
		expect(removal._state.getCantripsKnown()).toEqual([]);
		expect(removal._state.getSpellsKnown()).toContainEqual(expect.objectContaining({name: "Shield", sourceFeature: "Independent Spell"}));
		await respec._engine.undo();
		expect(state.toJson()).toEqual(original);
	});

	it("keeps default pending fulfillment coalescing unchanged and only creates a separate innate copy for an explicit grant ID", () => {
		const {state} = fixture();
		const spell = {name: "Shield", source: "XPHB", level: 1};
		const fulfill = grantId => {
			state.addPendingSpellChoice({featureName: "Default", innate: true, ability: "wis", uses: 1});
			state.fulfillSpellChoice(state._data.pendingSpellChoices.at(-1).id, spell, grantId ? {grantId} : undefined);
		};
		fulfill();
		const original = JSON.parse(JSON.stringify(state.getInnateSpells()[0]));
		fulfill();
		expect(JSON.parse(JSON.stringify(state.getInnateSpells()))).toEqual([original]);
		fulfill("owned-choice");
		expect(state.getInnateSpells()).toHaveLength(2);
		expect(state.getInnateSpells()).toContainEqual(expect.objectContaining({grantId: "owned-choice", name: "Shield", spellcastingAbility: "wis"}));
		expect(JSON.parse(JSON.stringify(state.getInnateSpells()[0]))).toEqual(original);
		expect(state.getPendingSpellChoices()).toEqual([]);
	});

	it("also removes an exact source-owned innate cantrip without removing an independent same-UID copy", async () => {
		const {state, page, respec} = fixture();
		const spell = {name: "Mage Hand", source: "XPHB", level: 0, classes: {fromClassList: [{name: "Wizard", source: "XPHB"}]}};
		const feat = {name: "Spark", source: "TGTT", additionalSpells: [{ability: "wis", innate: {"_": {daily: {"1": [{choose: "level=0|class=Wizard"}]}}}}]};
		const next = {name: "Spark Origin", source: "TGTT", feats: [{"spark|tgtt": true}]};
		page.getFeats = () => [feat];
		page.getBackgrounds = () => [oldBackground, next];
		page.getSpells = () => [spell];
		state.addInnateSpell({...spell, sourceFeature: "Independent", spellcastingAbility: "cha", uses: {current: 2, max: 3}});
		const original = JSON.parse(JSON.stringify(state.getInnateSpells()[0]));
		respec._engine.begin();
		respec._state = respec._engine.state;
		const draft = await respec._createBackgroundDraft(next, {choices: {}});
		await choose(draft, "nestedCantrip", spell);
		expect(draft._state.getInnateSpells()).toHaveLength(2);
		expect(draft._state.getInnateSpells()).toContainEqual(expect.objectContaining({sourceFeature: "Spark", spellcastingAbility: "wis", uses: {current: 1, max: 1}}));
		await respec._stageBackgroundDraft(draft);
		await respec._engine.apply();
		state.loadFromJson(state.toJson());
		const reopened = new Respec({page, state});
		reopened._engine.begin();
		reopened._state = reopened._engine.state;
		const removal = await reopened._createBackgroundDraft(oldBackground, {choices: {}});
		expect(JSON.parse(JSON.stringify(removal._state.getInnateSpells()))).toEqual([original]);
	});

	it("does not require evidence for unused fixed background alternatives when the PHB race owns abilities", async () => {
		const {state, page, respec} = fixture();
		const old = {name: "Unused Fixed Old", source: "TGTT", ability: [{str: 2}, {con: 2}]};
		const next = {name: "Unused Fixed New", source: "TGTT", ability: [{wis: 2}, {cha: 2}]};
		state.setBackground(old);
		state.setAbilityBonus("dex", 2);
		state.addNamedModifier({name: "Independent Strength", type: "ability:str", value: 1});
		page.getBackgrounds = () => [old, next];
		respec._engine.begin();
		respec._state = respec._engine.state;
		const before = state.toJson();
		const scores = Object.fromEntries(Parser.ABIL_ABVS.map(ability => [ability, state.getAbilityScore(ability)]));
		const draft = await respec._createBackgroundDraft(next, {choices: {}});
		expect(draft._engine.manifest.base.decisions.some(decision => decision.meta.originAbilityDistribution)).toBe(false);
		expect(Object.fromEntries(Parser.ABIL_ABVS.map(ability => [ability, draft._state.getAbilityScore(ability)]))).toEqual(scores);
		expect(state.toJson()).toEqual(before);
		await respec._stageBackgroundDraft(draft);
		await respec._engine.apply();
		state.loadFromJson(state.toJson());
		expect(state.getBackground()).toMatchObject({name: next.name, source: next.source});
		expect(Object.fromEntries(Parser.ABIL_ABVS.map(ability => [ability, state.getAbilityScore(ability)]))).toEqual(scores);
		const reopened = new Respec({page, state});
		reopened._engine.begin();
		reopened._state = reopened._engine.state;
		const replacement = await reopened._createBackgroundDraft(old, {choices: {}});
		expect(replacement._engine.manifest.base.decisions.some(decision => decision.meta.originAbilityDistribution)).toBe(false);
		expect(Object.fromEntries(Parser.ABIL_ABVS.map(ability => [ability, replacement._state.getAbilityScore(ability)]))).toEqual(scores);
		await respec._engine.undo();
		expect(state.toJson()).toEqual(before);
	});

	it("requires a fresh fixed distribution and reverses only its chosen branch once through retarget, reload, replacement and Undo", async () => {
		const {state, page, respec} = fixture();
		const old = {name: "Fixed Old", source: "TST", ability: [{con: 1}]};
		const next = {name: "Fixed Alternatives", source: "TGTT", ability: [{str: 2}, {dex: 2}]};
		state.setRace({name: "Dwarf", source: "XPHB"});
		state.setBackground(old);
		state.setAbilityBase("str", 10);
		state.setAbilityBonus("con", 1);
		page.getBackgrounds = () => [old, next];
		respec._engine.begin();
		respec._state = respec._engine.state;
		expect(respec._engine.manifest.base.decisions.some(decision => decision.meta.originAbilityDistribution)).toBe(false);
		const original = state.toJson();
		const draft = await respec._createBackgroundDraft(next, {choices: {}});
		const mode = draft._engine.manifest.base.decisions.find(decision => decision.meta.originAbilityDistribution);
		expect(mode).toMatchObject({type: "nestedConfiguration", required: true, status: "missing", selection: null});
		expect(draft._state.getAbilityScore("str")).toBe(10);
		expect(draft._state.getAbilityScore("dex")).toBe(10);
		expect(draft._engine.getValidation().canApply).toBe(false);
		await expect(respec._stageBackgroundDraft(draft)).rejects.toThrow();
		await expect(draft._engine.apply()).rejects.toThrow();
		expect(state.toJson()).toEqual(original);
		await choose(draft, "nestedConfiguration", mode.options[0]);
		expect(draft._state.getAbilityScore("str")).toBe(12);
		expect(draft._engine.manifest.base.decisions.find(decision => decision.semanticKey === mode.semanticKey).receipt.effects)
			.toContainEqual(expect.objectContaining({type: "abilityBonusDelta", ability: "str", amount: 2, sourceDecisionKey: mode.semanticKey}));
		await respec._stageBackgroundDraft(draft);
		await respec._engine.apply();
		state.loadFromJson(state.toJson());
		state.setAbilityBase("str", 11);
		state.setAbilityBonus("str", 3);
		state.addNamedModifier({name: "Independent Strength", type: "ability:str", value: 1});
		state.addAbilityBonus("str", 1);
		expect(state.getAbilityScore("str")).toBe(16);
		const reopened = new Respec({page, state});
		reopened._engine.begin();
		reopened._state = reopened._engine.state;
		const retarget = await reopened._createBackgroundDraft(next, {choices: {}});
		const current = retarget._engine.manifest.base.decisions.find(decision => decision.semanticKey === mode.semanticKey);
		await choose(retarget, "nestedConfiguration", current.options[1]);
		expect(retarget._state.getAbilityScore("str")).toBe(14);
		expect(retarget._state.getAbilityScore("dex")).toBe(12);
		await reopened._stageBackgroundDraft(retarget);
		await reopened._engine.apply();
		state.loadFromJson(state.toJson());
		state.setAbilityBase("dex", 12);
		state.setAbilityBonus("dex", 3);
		const final = new Respec({page, state});
		final._engine.begin();
		final._state = final._engine.state;
		expect(final._engine.manifest.base.decisions.find(decision => decision.semanticKey === mode.semanticKey).selection.key).toBe("mode-1");
		const beforeReplacement = state.toJson();
		const replacement = await final._createBackgroundDraft(old, {choices: {}});
		expect(replacement._state.getAbilityScore("str")).toBe(14);
		expect(replacement._state.getAbilityScore("dex")).toBe(13);
		await final._stageBackgroundDraft(replacement);
		await final._engine.apply();
		state.loadFromJson(state.toJson());
		expect(state.getAbilityScore("dex")).toBe(13);
		await final._engine.undo();
		expect(state.toJson()).toEqual(beforeReplacement);
		expect(state.getAbilityScore("dex")).toBe(15);
	});

	it("owns the fixed part of a single mixed distribution once rather than applying or reversing it twice", async () => {
		const {state, page, respec} = fixture();
		const old = {name: "Fixed Original", source: "TST", ability: [{con: 1}]};
		const next = {name: "Mixed Fixed and Choice", source: "TGTT", ability: [{str: 1, choose: {from: ["dex", "wis"], count: 1, amount: 1}}]};
		state.setRace({name: "Dwarf", source: "XPHB"});
		state.setBackground(old);
		state.setAbilityBase("str", 10);
		state.setAbilityBonus("con", 1);
		page.getBackgrounds = () => [old, next];
		respec._engine.begin();
		respec._state = respec._engine.state;
		const draft = await respec._createBackgroundDraft(next, {choices: {}});
		expect(draft._state.getAbilityScore("str")).toBe(11);
		expect(draft._engine.manifest.base.decisions.some(decision => decision.meta.originAbilityDistribution)).toBe(false);
		await choose(draft, "nestedAbility", "dex");
		expect(draft._state.getAbilityScore("str")).toBe(11);
		expect(draft._state.getAbilityScore("dex")).toBe(11);
		await respec._stageBackgroundDraft(draft);
		await respec._engine.apply();
		state.loadFromJson(state.toJson());
		state.setAbilityBonus("str", 3);
		const reopened = new Respec({page, state});
		reopened._engine.begin();
		reopened._state = reopened._engine.state;
		const before = state.toJson();
		const replacement = await reopened._createBackgroundDraft(old, {choices: {}});
		expect(replacement._state.getAbilityScore("str")).toBe(12);
		expect(replacement._state.getAbilityScore("dex")).toBe(10);
		expect(replacement._state.getAbilityScore("con")).toBe(13);
		await reopened._stageBackgroundDraft(replacement);
		await reopened._engine.apply();
		await reopened._engine.undo();
		expect(state.toJson()).toEqual(before);
	});

	it("acquires the exact second mixed mode despite equal weights, then clears its child and fixed grant on replacement/reload/Undo", async () => {
		const {state, page, respec} = fixture();
		const old = {...oldBackground, ability: [{con: 1}]};
		const next = {
			name: "Mixed Alternatives",
			source: "TGTT",
			ability: [
				{dex: 2, choose: {from: ["str", "wis"], count: 1, amount: 1}},
				{con: 2, choose: {from: ["int", "cha"], count: 1, amount: 1}},
			],
		};
		state.setRace({name: "Dwarf", source: "XPHB"});
		state.setBackground(old);
		page.getBackgrounds = () => [old, next];
		respec._engine.begin();
		respec._state = respec._engine.state;
		const original = state.toJson();
		const draft = await respec._createBackgroundDraft(next, {choices: {}});
		const mode = draft._engine.manifest.base.decisions.find(decision => decision.meta.originAbilityDistribution);
		expect(mode.options.map(option => option.weights)).toEqual([[1], [1]]);
		await choose(draft, "nestedConfiguration", mode.options[1]);
		const child = draft._engine.manifest.base.decisions.find(decision => decision.type === "nestedAbility");
		expect(child.options).toEqual(["int", "cha"]);
		expect(child.sourceKey).toContain("mode-1");
		await choose(draft, "nestedAbility", "int");
		expect(draft._state._data.abilityBonuses).toMatchObject({dex: 0, con: 4, int: 1});
		expect(state.toJson()).toEqual(original);
		await respec._stageBackgroundDraft(draft);
		await respec._engine.apply();
		state.loadFromJson(state.toJson());
		const firstApplied = state.toJson();
		const reopened = new Respec({page, state});
		reopened._engine.begin();
		reopened._state = reopened._engine.state;
		expect(reopened._engine.manifest.base.decisions.find(decision => decision.type === "nestedAbility").options).toEqual(["int", "cha"]);
		for (const key of [undefined, "unknown-mode"]) {
			const unsafe = await reopened._createBackgroundDraft(next, {choices: {}});
			const stored = unsafe._state._data.characterBase.decisions.find(decision => decision.semanticKey === mode.semanticKey);
			if (key === undefined) delete stored.selection.key;
			else stored.selection.key = key;
			unsafe._engine.refreshManifest();
			expect(unsafe._engine.manifest.base.decisions.find(decision => decision.semanticKey === mode.semanticKey).status).toBe("invalid");
			expect(unsafe._engine.manifest.base.decisions.some(decision => decision.type === "nestedAbility")).toBe(false);
			expect(unsafe._engine.getValidation().canApply).toBe(false);
			await expect(unsafe._engine.apply()).rejects.toThrow();
			expect(state.toJson()).toEqual(firstApplied);
		}
		const retarget = await reopened._createBackgroundDraft(next, {choices: {}});
		const current = retarget._engine.manifest.base.decisions.find(decision => decision.semanticKey === mode.semanticKey);
		await choose(retarget, "nestedConfiguration", current.options[0]);
		const newChild = retarget._engine.manifest.base.decisions.find(decision => decision.type === "nestedAbility");
		expect(newChild).toMatchObject({selection: null, status: "missing", options: ["str", "wis"]});
		expect(newChild.semanticKey).not.toBe(child.semanticKey);
		expect(retarget._state._data.abilityBonuses).toMatchObject({dex: 2, con: 2, int: 0});
		await expect(reopened._stageBackgroundDraft(retarget)).rejects.toThrow();
		await choose(retarget, "nestedAbility", "wis");
		await reopened._stageBackgroundDraft(retarget);
		await reopened._engine.apply();
		state.loadFromJson(state.toJson());
		expect(state._data.abilityBonuses).toMatchObject({dex: 2, con: 2, int: 0, wis: 1});
		await reopened._engine.undo();
		expect(state.toJson()).toEqual(firstApplied);
		const final = new Respec({page, state});
		final._engine.begin();
		final._state = final._engine.state;
		const removal = await final._createBackgroundDraft(old, {choices: {}});
		expect(removal._state._data.abilityBonuses).toMatchObject({dex: 0, con: 3, int: 0, wis: 0});
		expect(removal._state._data.directAbilityBonuses).toEqual({con: 2});
	});

	it.each([["con", 1], ["str", 0]])("requires actual own numeric %s delta proof (including %i) for a real acquired origin feat before reversal", async (ability, amount) => {
		const {state, page, respec} = fixture();
		const draft = await respec._createBackgroundDraft(background, {choices: {}});
		await choose(draft, "nestedFeat", {name: originFeat.name, source: originFeat.source});
		await choose(draft, "nestedAbility", ability);
		const owned = draft._state._data.feats[0];
		expect(Object.hasOwn(owned.appliedEffects.abilityDeltas, ability)).toBe(true);
		expect(owned.appliedEffects.abilityDeltas[ability]).toBe(amount);
		const child = draft._engine.manifest.base.decisions.find(decision => decision.type === "nestedAbility");
		expect(child.receipt.effects).toContainEqual(expect.objectContaining({type: "abilityDelta", ability, amount, sourceDecisionKey: child.semanticKey}));
		await respec._stageBackgroundDraft(draft);
		await respec._engine.apply();
		state.loadFromJson(state.toJson());
		const reopened = new Respec({page, state});
		reopened._engine.begin();
		reopened._state = reopened._engine.state;
		const liveBefore = state.toJson();
		for (const damage of ["inherited", "missing", "non-numeric"]) {
			const unsafe = await reopened._createBackgroundDraft(background, {choices: {}});
			const feat = unsafe._state._data.feats[0];
			const existing = {...feat.appliedEffects.abilityDeltas};
			delete existing[ability];
			feat.appliedEffects.abilityDeltas = damage === "inherited"
				? Object.assign(Object.create({[ability]: amount}), existing)
				: {...existing, ...(damage === "non-numeric" ? {[ability]: String(amount)} : {})};
			expect(Object.hasOwn(feat.appliedEffects.abilityDeltas, ability)).toBe(damage === "non-numeric");
			if (damage === "inherited") expect(feat.appliedEffects.abilityDeltas[ability]).toBe(amount);
			const before = unsafe._state.toJson();
			const manifest = unsafe._engine.manifest;
			await expect(choose(unsafe, "nestedAbility", ability === "con" ? "str" : "con")).rejects.toThrow("ability receipt no longer agrees");
			expect(unsafe._engine.state.toJson()).toEqual(before);
			expect(unsafe._engine.manifest).toEqual(manifest);
			expect(state.toJson()).toEqual(liveBefore);
			expect(Object.hasOwn(unsafe._engine.state._data.feats[0].appliedEffects.abilityDeltas, ability)).toBe(damage === "non-numeric");
		}
		const valid = await reopened._createBackgroundDraft(background, {choices: {}});
		await choose(valid, "nestedAbility", ability === "con" ? "str" : "con");
		expect(valid._engine.getValidation().canApply).toBe(true);
		expect(valid._state.getAbilityBase(ability)).toBe(ability === "str" ? 20 : 10);
	});

	it("retains a keyless legacy distribution only when its weights select one canonical mode", async () => {
		const {state, page, respec} = fixture();
		const old = {...oldBackground, ability: [{con: 1}]};
		const next = {
			name: "Weighted Legacy",
			source: "XPHB",
			ability: [
				{choose: {weighted: {from: ["con", "int", "wis"], weights: [2, 1]}}},
				{choose: {weighted: {from: ["con", "int", "wis"], weights: [1, 1, 1]}}},
			],
		};
		state.setRace({name: "Dwarf", source: "XPHB"});
		state.setBackground(old);
		page.getBackgrounds = () => [old, next];
		respec._engine.begin();
		respec._state = respec._engine.state;
		const draft = await respec._createBackgroundDraft(next, {choices: {}});
		const mode = draft._engine.manifest.base.decisions.find(decision => decision.meta.originAbilityDistribution);
		await choose(draft, "nestedConfiguration", mode.options[1]);
		const stored = draft._state._data.characterBase.decisions.find(decision => decision.semanticKey === mode.semanticKey);
		delete stored.selection.key;
		draft._engine.refreshManifest();
		expect(draft._engine.manifest.base.decisions.find(decision => decision.semanticKey === mode.semanticKey).status).toBe("resolved");
		expect(draft._engine.manifest.base.decisions.filter(decision => decision.type === "nestedAbility")).toHaveLength(3);
		expect(draft._engine.manifest.base.decisions.filter(decision => decision.type === "nestedAbility")
			.every(decision => decision.sourceKey.includes("mode-1") && decision.status === "missing")).toBe(true);
	});

	it("keeps an independent repeatable instance of the same feat when its background-owned instance is removed", async () => {
		const {state, page, respec} = fixture();
		const feat = {...originFeat, repeatable: true};
		page.getFeats = () => [feat];
		state.addFeat({...feat, choices: {ability: "str"}}, {sourceDecisionKey: "independent:feat"});
		const independentId = state.getFeats()[0].id;
		respec._engine.begin();
		respec._state = respec._engine.state;
		const draft = await respec._createBackgroundDraft(background, {choices: {}});
		await choose(draft, "nestedFeat", {name: feat.name, source: feat.source});
		await choose(draft, "nestedAbility", "con");
		expect(draft._state.getFeats()).toHaveLength(2);
		await respec._stageBackgroundDraft(draft);
		await respec._engine.apply();
		const reopened = new Respec({page, state});
		reopened._engine.begin();
		reopened._state = reopened._engine.state;
		const replacement = await reopened._createBackgroundDraft(oldBackground, {choices: {}});
		expect(replacement._state.getFeats()).toEqual([
			expect.objectContaining({id: independentId, sourceDecisionKey: "independent:feat", choices: {ability: "str"}}),
		]);
		expect(replacement._state.getAbilityBase("con")).toBe(10);
		expect(replacement._state.getAbilityBase("str")).toBe(20);
	});

	it("uses one canonical exclusive feat ability alternative with its actual count and cap, then clears the replaced branch", async () => {
		const {respec, page} = fixture();
		const feat = {
			...originFeat,
			ability: [
				{choose: {from: ["str", "con", "dex"], count: 2, amount: 1}},
				{choose: {from: ["wis", "cha"], count: 1, amount: 2}},
			],
		};
		const other = {...originFeat, name: "Other Training", ability: [{choose: {from: ["wis", "cha"], count: 1, amount: 2}}]};
		page.getFeats = () => [feat, other];
		const draft = await respec._createBackgroundDraft(background, {choices: {}});
		await choose(draft, "nestedFeat", {name: feat.name, source: feat.source});
		const children = draft._engine.manifest.base.decisions.filter(decision => decision.type === "nestedAbility");
		expect(children).toHaveLength(1);
		expect(children[0]).toMatchObject({count: 2, meta: {descriptorRules: {featAbilityChoice: true, abilityOption: 0}}});
		await choose(draft, "nestedAbility", ["str", "con"]);
		expect(draft._state.getFeats()[0]).toMatchObject({
			choices: {ability: {str: 1, con: 1}, abilityOption: 0},
			appliedEffects: {abilityDeltas: {str: 0, con: 1}},
		});
		expect(draft._state.getAbilityBase("wis")).toBe(10);
		await choose(draft, "nestedFeat", {name: other.name, source: other.source});
		expect(draft._state.getAbilityBase("con")).toBe(10);
		expect(draft._state.getAbilityBase("str")).toBe(20);
		expect(draft._engine.manifest.base.decisions.some(decision => decision.semanticKey === children[0].semanticKey)).toBe(false);
		expect(respec._getBackgroundDraftIssues(draft)).toHaveLength(1);
		await choose(draft, "nestedAbility", "wis");
		expect(draft._state.getAbilityBase("wis")).toBe(12);
		expect(draft._state.getFeats()[0]).toMatchObject({name: other.name, choices: {ability: "wis"}, appliedEffects: {abilityDeltas: {wis: 2}}});
		expect(respec._getBackgroundDraftIssues(draft)).toEqual([]);
	});

	it("synchronizes capped choices and preserves independent adjustments through reload, background replacement and Undo", async () => {
		const {respec, state, page} = fixture();
		const draft = await respec._createBackgroundDraft(background, {choices: {}});
		await choose(draft, "nestedFeat", {name: originFeat.name, source: originFeat.source});
		const ability = draft._engine.manifest.base.decisions.find(decision => decision.type === "nestedAbility");
		expect(ability.meta.descriptorRules.featAbilityChoice).toBe(true);
		await choose(draft, "nestedAbility", "str");
		expect(draft._state.getFeats()[0]).toMatchObject({
			choices: {ability: "str"}, appliedEffects: {abilityDeltas: {str: 0}},
		});
		expect(draft._engine.manifest.base.decisions.find(decision => decision.type === "nestedAbility").receipt.effects)
			.toContainEqual(expect.objectContaining({type: "abilityDelta", ability: "str", amount: 0}));
		await choose(draft, "nestedAbility", "con");
		expect(draft._state.getFeats()[0]).toMatchObject({
			choices: {ability: "con"}, _featChoices: {ability: "con"}, appliedEffects: {abilityDeltas: {con: 1}},
		});
		expect(draft._state.getFeats()[0].appliedEffects.abilityDeltas).not.toHaveProperty("str");
		expect(draft._state.getAbilityBase("str")).toBe(20);
		expect(draft._state.getAbilityScore("con")).toBe(16);
		await respec._stageBackgroundDraft(draft);
		await respec._engine.apply();
		state.loadFromJson(state.toJson());
		state.setAbilityBase("con", state.getAbilityBase("con") + 2);
		const reopened = new Respec({page, state});
		reopened._engine.begin();
		reopened._state = reopened._engine.state;
		expect(reopened._engine.manifest.base.decisions.find(decision => decision.type === "nestedAbility").selection).toBe("con");
		const beforeReplacement = state.toJson();
		const replacement = await reopened._createBackgroundDraft(oldBackground, {choices: {}});
		expect(replacement._state.getFeats()).toEqual([]);
		expect(replacement._state.getAbilityBase("con")).toBe(12);
		expect(replacement._state.getAbilityScore("con")).toBe(17);
		expect(replacement._state.getAbilityScore("str")).toBe(20);
		await reopened._stageBackgroundDraft(replacement);
		await reopened._engine.apply();
		state.loadFromJson(state.toJson());
		expect(state.getAbilityScore("con")).toBe(17);
		await reopened._engine.undo();
		expect(state.toJson()).toEqual(beforeReplacement);
		expect(state.getFeats()[0]).toMatchObject({choices: {ability: "con"}, appliedEffects: {abilityDeltas: {con: 1}}});
		expect(state.getAbilityScore("con")).toBe(18);
	});
});
