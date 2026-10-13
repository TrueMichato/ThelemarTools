import {jest} from "@jest/globals";
import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-progression.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-spells.js";
import "../../../js/charactersheet/charactersheet-combat.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";

const State = globalThis.CharacterSheetState;
const ClassUtils = globalThis.CharacterSheetClassUtils;
const Spells = globalThis.CharacterSheetSpells;
const Combat = globalThis.CharacterSheetCombat;
const clericData = JSON.parse(fs.readFileSync(new URL("../../../data/class/class-cleric.json", import.meta.url), "utf8"));
const druidData = JSON.parse(fs.readFileSync(new URL("../../../data/class/class-druid.json", import.meta.url), "utf8"));
const phbSpells = JSON.parse(fs.readFileSync(new URL("../../../data/spells/spells-phb.json", import.meta.url), "utf8")).spell;
const brew = JSON.parse(fs.readFileSync(new URL("../../../homebrew/TravelersGuidetoThelemar.json", import.meta.url), "utf8"));
const boomingBlade = JSON.parse(fs.readFileSync(new URL("../../../data/spells/spells-tce.json", import.meta.url), "utf8")).spell.find(spell => spell.name === "Booming Blade");
const parent = clericData.classFeature.find(feature => feature.name === "Blessed Strikes" && feature.source === "XPHB");
const improved = clericData.classFeature.find(feature => feature.name === "Improved Blessed Strikes" && feature.source === "XPHB");
const potent = clericData.classFeature.find(feature => feature.name === "Potent Spellcasting" && feature.source === "XPHB");
const divine = clericData.classFeature.find(feature => feature.name === "Divine Strike" && feature.source === "XPHB");
const timePotent = brew.subclassFeature.find(feature => feature.name === "Potent Spellcasting" && feature.subclassShortName === "Time");
const owner = {id: "existing-field", kind: "classFeature", name: "Existing field", source: "TST", uid: "Existing field|Tester|TST|3"};

function makeState ({source = "XPHB", level = 14, choice = "Potent Spellcasting", domain = "Life", wisdom = 16, upgrade = true} = {}) {
	const state = new State();
	state.setClassCatalog([...clericData.class, ...brew.class]);
	state.setClassFeatureCatalog([...clericData.classFeature, ...brew.classFeature], [...clericData.subclassFeature, ...brew.subclassFeature]);
	state.addClass({
		name: "Cleric",
		source,
		level,
		subclass: {name: `${domain} Domain`, shortName: domain, source: domain === "Time" ? "TGTT" : domain === "Arcana" ? "SCAG" : "PHB"},
	});
	state.setAbilityBase("wis", wisdom);
	state.setHp(30, 30);
	if (source !== "PHB") {
		state.addFeature({...parent});
		if (choice) {
			state.addFeature({...choice === "Divine Strike" ? divine : potent, parentFeature: "Blessed Strikes", isFeatureOption: true});
			state._recordChosenSubfeature({
				parent: "Blessed Strikes",
				parentSource: "XPHB",
				parentClass: "Cleric",
				parentClassSource: source,
				level: 7,
				name: choice,
				source: "XPHB",
			});
		}
		if (upgrade) state.addFeature({...improved});
	}
	if (domain === "Time") state.addFeature({...timePotent, isSubclassFeature: true});
	return state;
}

async function cast (state, {damage = 8, outcome = "damaged", evidence = true, level = 0, className = "Cleric", type = "cantrip", spellData = null} = {}) {
	const sourceClassSource = state.getClasses().find(cls => cls.name === className)?.source;
	const spell = spellData || {name: "Sacred Flame", source: "XPHB", level};
	const receipt = await state.pPublishCommittedSpellCast({
		spell: {name: spell.name, source: spell.source, sourceClass: className, sourceClassSource, level},
		spellData: spell,
		cast: {type},
		damageEvidence: evidence ? {
			resolution: outcome === "damaged" ? "confirmed" : "target-confirmation-required",
			damage: [{damageType: "radiant", amount: damage}],
			targets: [{targetId: "enemy", targetName: "Enemy", outcome}],
		} : null,
	});
	expect(receipt).toMatchObject({committed: true, castingClassUid: `${className}|${sourceClassSource}`});
	return receipt;
}

const grant = (state, receipt, overrides = {}) => state.grantImprovedPotentSpellcasting({
	receipt, damagedTarget: {targetId: "enemy", targetName: "Enemy"}, target: {type: "self"}, ...overrides,
});

describe("Source-owned Cleric Potent calculations", () => {
	it.each(["XPHB", "TGTT"])("applies the %s selected Potent option without a domain Potent grant", source => {
		const state = makeState({source, level: 7});
		expect(state.getCantripDamageBonus({level: 0, sourceClass: "Cleric"})).toEqual({
			bonus: 3, sources: [{name: "Potent Spellcasting", value: 3}],
		});
		expect(state.getFeatureCalculations().weaponDamageRiders || []).not.toEqual(expect.arrayContaining([expect.objectContaining({id: "clericDivineStrike"})]));
	});

	it.each(["XPHB", "TGTT"])("the %s Divine alternative suppresses a classic Time-domain Potent bonus", source => {
		const state = makeState({source, domain: "Time", choice: "Divine Strike"});
		expect(state.getCantripDamageBonus({level: 0, sourceClass: "Cleric"}).bonus).toBe(0);
		expect(state.getFeatureCalculations().weaponDamageRiders.filter(rider => rider.id === "clericDivineStrike")).toEqual([
			expect.objectContaining({dice: "2d8", damageTypeChoices: ["necrotic", "radiant"]}),
		]);
		expect(state.getFeatureCalculations().hasImprovedPotentSpellcasting).toBeUndefined();
	});

	it.each([6, 7, 8, 13, 14])("gates each actual benefit at Cleric level %i", level => {
		const state = makeState({level, domain: "Time"});
		expect(state.getCantripDamageBonus({level: 0, sourceClass: "Cleric"}).bonus).toBe(level >= 7 ? 3 : 0);
		expect(!!state.getFeatureCalculations().hasImprovedPotentSpellcasting).toBe(level >= 14);
	});

	it("does not infer a missing modern choice from the domain", () => {
		const state = makeState({source: "TGTT", domain: "Time", choice: null});
		expect(state.getCantripDamageBonus({level: 0, sourceClass: "Cleric"}).bonus).toBe(0);
		expect(state.getFeatureCalculations().hasImprovedPotentSpellcasting).toBeUndefined();
	});

	it("keeps classic Arcana's real cantrip bonus and no modern follow-up", () => {
		const state = makeState({source: "PHB", domain: "Arcana"});
		expect(state.getCantripDamageBonus({level: 0, sourceClass: "Cleric"}).bonus).toBe(3);
		expect(state.getFeatureCalculations().hasImprovedPotentSpellcasting).toBeUndefined();
	});

	it("requires the actual source-authored level-14 feature, not only level or a foreign same-name row", () => {
		const state = makeState({upgrade: false});
		state.addFeature({...improved, source: "TST"});
		expect(state.getFeatureCalculations().hasImprovedPotentSpellcasting).toBeUndefined();
	});

	it.each([["Cleric", "Druid"], ["Druid", "Cleric"]])("does not clobber the other caster's channel in %s/%s order", (first) => {
		const state = makeState({choice: "Divine Strike", domain: "Time"});
		state.addClass({name: "Druid", source: "XPHB", level: 7});
		if (first === "Druid") state._data.classes.reverse();
		expect(state.getCantripDamageBonus({level: 0, sourceClass: "Cleric"}).bonus).toBe(0);
		expect(state.getCantripDamageBonus({level: 0, sourceClass: "Druid"}).bonus).toBe(3);
		expect(state.getCantripDamageBonus({level: 0, sourceClass: "Wizard"}).bonus).toBe(0);
		expect(state.getCantripDamageBonus({level: 1, sourceClass: "Druid"}).bonus).toBe(0);
	});

	it.each([["Cleric", "Life"], ["Druid", "Life"], ["Cleric", "Light"], ["Druid", "Light"]])("uses each real class's own Potent grant with %s first and PHB %s domain", (first, domain) => {
		const state = makeState({source: "PHB", level: 8, domain});
		state.setClassCatalog([...clericData.class, ...druidData.class, ...brew.class]);
		state.setClassFeatureCatalog([...clericData.classFeature, ...druidData.classFeature, ...brew.classFeature], [...clericData.subclassFeature, ...druidData.subclassFeature, ...brew.subclassFeature]);
		state.addClass({name: "Druid", source: "XPHB", level: 8});
		const druidGrant = druidData.classFeature.find(feature => feature.name === "Potent Spellcasting" && feature.source === "XPHB");
		state.addFeature(ClassUtils.buildFeatureStateObject(druidGrant));
		if (domain === "Light") {
			const domainGrant = clericData.subclassFeature.find(feature => feature.name === "Potent Spellcasting" && feature.subclassShortName === "Light" && feature.source === "PHB");
			state.addFeature(ClassUtils.buildFeatureStateObject(domainGrant, {isSubclassFeature: true}));
		}
		if (first === "Druid") state._data.classes.reverse();
		state.addCantrip({...phbSpells.find(spell => spell.name === "Sacred Flame"), sourceClass: "Cleric", sourceClassSource: "PHB"});
		state.addCantrip({...phbSpells.find(spell => spell.name === "Thorn Whip"), sourceClass: "Druid", sourceClassSource: "XPHB"});
		const clericSpell = state.getCantrips().find(spell => spell.name === "Sacred Flame");
		const druidSpell = state.getCantrips().find(spell => spell.name === "Thorn Whip");
		expect(clericSpell).toMatchObject({sourceClass: "Cleric", sourceClassSource: "PHB"});
		expect(druidSpell).toMatchObject({sourceClass: "Druid", sourceClassSource: "XPHB"});
		expect(state.getCantripDamageBonus(clericSpell).bonus).toBe(domain === "Light" ? 3 : 0);
		expect(state.getCantripDamageBonus(druidSpell).bonus).toBe(3);
		expect(state.getFeatureCalculations().cantripDamageBonuses.filter(channel => channel.className === "Cleric")).toHaveLength(domain === "Light" ? 1 : 0);
	});

	it("a contradictory choice is unresolved for both mechanic channels", () => {
		const state = makeState({domain: "Time"});
		state._recordChosenSubfeature({
			parent: "Blessed Strikes",
			parentSource: "XPHB",
			parentClass: "Cleric",
			parentClassSource: "XPHB",
			level: 7,
			name: "Divine Strike",
			source: "XPHB",
		});
		expect(state.getCantripDamageBonus({level: 0, sourceClass: "Cleric"}).bonus).toBe(0);
		expect(state.getFeatureCalculations().weaponDamageRiders || []).not.toEqual(expect.arrayContaining([expect.objectContaining({id: "clericDivineStrike"})]));
	});

	it("does not borrow a different acquisition owner's pick", () => {
		const state = makeState({source: "TGTT", choice: null});
		state._recordChosenSubfeature({
			parent: "Blessed Strikes",
			parentSource: "XPHB",
			parentClass: "Cleric",
			parentClassSource: "TST",
			level: 7,
			name: "Potent Spellcasting",
			source: "XPHB",
		});
		expect(state.getCantripDamageBonus({level: 0, sourceClass: "Cleric"}).bonus).toBe(0);
	});

	it("does not borrow a foreign stored option through the reader's no-record fallback", () => {
		const state = makeState({source: "TGTT", choice: null});
		state.addFeature({...potent, classSource: "TST", parentFeature: "Blessed Strikes", isFeatureOption: true});
		expect(state.getCantripDamageBonus({level: 0, sourceClass: "Cleric"}).bonus).toBe(0);
	});
});

describe("Exact equivalent-feature projection", () => {
	function reselectPotent (state) {
		return ClassUtils.replaceStructuredFeatureChoice({
			state,
			page: {getClasses: () => brew.class},
			catalogs: {classFeatures: [...clericData.classFeature, ...brew.classFeature], subclassFeatures: [...clericData.subclassFeature, ...brew.subclassFeature]},
			characterLevel: 7,
			classLevel: 7,
			className: "Cleric",
			classSource: "TGTT",
			parentFeature: "Blessed Strikes",
			oldChoice: {choice: "Potent Spellcasting", source: "XPHB", acquisitionLevel: 7},
			newOption: potent,
		});
	}

	it("projects the actual acquisition-owned reselect producer through partition and reload", () => {
		const state = makeState({source: "TGTT", domain: "Time"});
		const {feature} = reselectPotent(state);
		expect(feature).toMatchObject({source: "XPHB", classSource: "TGTT", acquisitionLevel: 7, isFeatureOption: true, sourceDecisionKey: "cleric|tgtt:cl7:featurechoice:blessed-strikes:slot0"});
		const check = candidate => {
			expect(candidate.getChosenBlessedStrikesOption({classSource: "TGTT"})).toBe("Potent Spellcasting");
			const rows = ClassUtils.mergeEquivalentFeaturesForDisplay(candidate.getFeatures(), candidate.getClericFeatureDisplayContext());
			expect(rows.filter(row => row.name === "Potent Spellcasting")).toHaveLength(1);
			expect(rows.find(row => row.name === "Potent Spellcasting").provenanceSources).toHaveLength(2);
			const partition = ClassUtils.partitionClassFeaturesForDisplay(candidate.getFeatures(), candidate.getClericFeatureDisplayContext());
			expect(partition.featureOptions.filter(row => row.name === "Potent Spellcasting")).toHaveLength(1);
		};
		check(state);
		const loaded = makeState({source: "TGTT", domain: "Time"});
		loaded.loadFromJson(state.toJson());
		check(loaded);
	});

	it("does not absorb foreign, manual, or wrong-decision copies beside a real owned reselect", () => {
		const state = makeState({source: "TGTT", domain: "Time"});
		const {feature} = reselectPotent(state);
		const foreignKey = globalThis.CharacterSheetProgression.getSemanticKey({className: "Cleric", classSource: "TST", classLevel: 7, type: "featureChoice", sourceKey: "Blessed Strikes"});
		const distinct = [
			{...feature, id: "foreign", classSource: "TST", sourceDecisionKey: foreignKey},
			{...feature, id: "manual", isCustom: true},
			{...feature, id: "wrong-decision", sourceDecisionKey: foreignKey},
		];
		state._data.features.push(...distinct);
		const rows = ClassUtils.mergeEquivalentFeaturesForDisplay(state.getFeatures(), state.getClericFeatureDisplayContext());
		expect(rows.find(row => row.id === feature.id).provenanceSources).toHaveLength(2);
		for (const row of distinct) expect(rows.find(projected => projected.id === row.id)).toEqual(row);
	});

	it("merges the selected and inherited Time grants without mutating or swallowing other rows", () => {
		const state = makeState({source: "TGTT", domain: "Time"});
		state.addFeature({name: "Potent Spellcasting", source: "TST", className: "Cleric", description: "Manual distinct feature."});
		const raw = state.getFeatures();
		const saved = JSON.stringify(raw);
		const rows = ClassUtils.mergeEquivalentFeaturesForDisplay(raw, state.getClericFeatureDisplayContext());
		const potentRows = rows.filter(row => row.name === "Potent Spellcasting");
		expect(potentRows).toHaveLength(2);
		expect(potentRows.find(row => row.source === "XPHB").provenanceSources).toHaveLength(2);
		expect(potentRows.some(row => row.source === "TST")).toBe(true);
		expect(JSON.stringify(raw)).toBe(saved);
		expect(ClassUtils.mergeEquivalentFeaturesForDisplay(rows, state.getClericFeatureDisplayContext())).toEqual(rows);
	});

	it("keeps an older alternative accessible but explicitly inactive", () => {
		const state = makeState({source: "TGTT", domain: "Time", choice: "Divine Strike"});
		const rows = ClassUtils.mergeEquivalentFeaturesForDisplay(state.getFeatures(), state.getClericFeatureDisplayContext());
		expect(rows.find(row => row.name === "Potent Spellcasting").inactiveReason).toContain("Divine Strike");
	});

	it("does not guess ownership or merge a different subclass acquisition", () => {
		const state = makeState({source: "TGTT", domain: "Time"});
		const raw = state.getFeatures();
		expect(ClassUtils.mergeEquivalentFeaturesForDisplay(raw)).toEqual(raw);
		const context = {...state.getClericFeatureDisplayContext(), clericSubclass: {name: "Knowledge Domain", shortName: "Knowledge", source: "PHB"}};
		expect(ClassUtils.mergeEquivalentFeaturesForDisplay(raw, context).filter(row => row.name === "Potent Spellcasting")).toHaveLength(2);
	});
});

describe("Improved Potent: real committed damage and non-stacking delivery", () => {
	it.each(["isCustom", "_isCustom"])("does not promote a manual %s copy into the level-14 upgrade", field => {
		const state = makeState({upgrade: false});
		state.addFeature({...improved, [field]: true});
		expect(state.getFeatureCalculations().hasImprovedPotentSpellcasting).toBeUndefined();
	});

	it.each([4, 6, 10])("self retains max(current,%i), with ownership only transferring for a higher grant", async previous => {
		const state = makeState();
		state.grantOwnedTempHp(previous, owner);
		const receipt = await cast(state);
		expect(grant(state, receipt)).toMatchObject({ok: true, amount: 6, applied: previous < 6, currentTempHp: Math.max(previous, 6)});
		expect(state.getTempHpOwner()).toEqual(previous < 6 ? null : owner);
	});

	it("uses twice the effective Wisdom modifier, including 30 Wisdom, not a clamped standard stat", async () => {
		const state = makeState();
		state._data.abilities.wis = 30;
		expect(grant(state, await cast(state))).toMatchObject({ok: true, amount: 20, currentTempHp: 20});
	});

	it.each(["miss", "noDamage"])("does not offer or grant for a %s result", async outcome => {
		const state = makeState();
		expect(grant(state, await cast(state, {outcome})).ok).toBe(false);
		expect(state.getTempHp()).toBe(0);
	});

	it.each([{damage: 0}, {evidence: false}, {level: 1, type: "spell"}, {type: "item"}])("rejects ineligible cast/evidence %j", async options => {
		const state = makeState();
		expect(grant(state, await cast(state, options)).ok).toBe(false);
		expect(state.getTempHp()).toBe(0);
	});

	it("requires actual creature-damage confirmation, not merely a positive roll", async () => {
		const state = makeState();
		const receipt = await cast(state, {outcome: "unconfirmed"});
		expect(grant(state, receipt)).toMatchObject({ok: false, reason: "creatureDamageNotConfirmed"});
		expect(state.getTempHp()).toBe(0);
		expect(grant(state, receipt, {confirmTargetDamaged: true})).toMatchObject({ok: true, currentTempHp: 6});
	});

	it("supports explicitly confirmed manual creature damage without requiring tracked combat", async () => {
		const state = makeState();
		const receipt = await cast(state);
		const deferred = await cast(state, {evidence: false});
		expect(state.recordImprovedPotentSpellcastingDamage(deferred, {resolution: "manual", damage: [{damageType: "thunder", amount: 8}], targets: []})).toBe(true);
		expect(grant(state, deferred)).toMatchObject({ok: false, reason: "creatureDamageNotConfirmed"});
		expect(grant(state, deferred, {confirmTargetDamaged: true})).toMatchObject({ok: true});
		expect(state.getImprovedPotentSpellcastingEligibility(receipt).eligible).toBe(true);
	});

	it("rejects a different casting class and an uncommitted or fabricated receipt", async () => {
		const state = makeState();
		state.addClass({name: "Druid", source: "XPHB", level: 3});
		expect(grant(state, await cast(state, {className: "Druid"})).ok).toBe(false);
		const receipt = await cast(state);
		expect(grant(state, {...receipt, committed: false}).ok).toBe(false);
		expect(grant(state, {...receipt, receiptId: "fabricated"}).ok).toBe(false);
		expect(state.getTempHp()).toBe(0);
	});

	it("delivers once per receipt, not once per turn, and does not resurrect dismissed offers", async () => {
		const state = makeState();
		const one = await cast(state);
		expect(grant(state, one).ok).toBe(true);
		expect(grant(state, one)).toMatchObject({ok: false, reason: "alreadyResolved"});
		const two = await cast(state);
		expect(grant(state, two)).toMatchObject({ok: true, applied: false});
		const three = await cast(state);
		expect(state.dismissImprovedPotentSpellcasting(three)).toBe(true);
		expect(grant(state, three).ok).toBe(false);
	});

	it.each(["level", "choice", "reload"])("invalidates a stale offer after changing %s", async change => {
		const state = makeState();
		const receipt = await cast(state);
		if (change === "level") state._data.classes[0].level = 13;
		if (change === "choice") state._data.chosenSubfeatures[0].name = "Divine Strike";
		if (change === "reload") state.loadFromJson(state.toJson());
		expect(grant(state, receipt).ok).toBe(false);
		expect(state.getTempHp()).toBe(0);
	});

	it.each([4, 6, 10])("updates a real companion's max(%i,6) pool without changing self", async previous => {
		const state = makeState();
		const id = state.addCompanion({name: "Hound", hp: {max: 20, current: 10, temp: previous}});
		expect(grant(state, await cast(state), {target: {type: "companion", companionId: id, distanceFeet: 60}}))
			.toMatchObject({ok: true, manual: false, applied: previous < 6, currentTempHp: Math.max(previous, 6)});
		expect(state.getCompanion(id).hp.temp).toBe(Math.max(previous, 6));
		expect(state.getTempHp()).toBe(0);
	});

	it.each([null, -1, 61, Infinity])("rejects an external receiver at invalid caster-relative distance %s", async distanceFeet => {
		const state = makeState();
		expect(grant(state, await cast(state), {target: {type: "external", name: "Ally", distanceFeet}}).ok).toBe(false);
	});

	it("external delivery is explicitly manual and never mutates self or claims another pool", async () => {
		const state = makeState();
		state.grantOwnedTempHp(10, owner);
		expect(grant(state, await cast(state), {target: {type: "external", name: "Ally", distanceFeet: 60}}))
			.toMatchObject({ok: true, manual: true, applied: false, targetName: "Ally", amount: 6, currentTempHp: null});
		expect(state.getTempHp()).toBe(10);
		expect(state.getTempHpOwner()).toEqual(owner);
		state.takeDamage(4);
		const restored = new State();
		restored.loadFromJson(state.toJson());
		expect(restored.getTempHp()).toBe(6);
		expect(restored.getTempHpOwner()).toEqual(owner);
	});

	it("defers a weapon-channel receipt until the actual rider damage resolves", async () => {
		const state = makeState();
		const receipt = await cast(state, {evidence: false});
		const combat = Object.create(Combat.prototype);
		combat._state = state;
		combat._pendingSpellRider = {attackId: "sword", dice: "2d8", damageType: "thunder", committedSpellCastReceipt: receipt};
		combat._parseDamage = () => ({total: 8, dice: "2d8"});
		expect(state.getImprovedPotentSpellcastingEligibility(receipt).eligible).toBe(false);
		const damage = combat._resolveChannelRiderDamage({isSpell: false}, "sword", false);
		const spells = Object.create(Spells.prototype);
		spells._state = state;
		const evidence = spells._getCommittedSpellDamageEvidence({damageResult: {total: damage.channelSpellDamage, damageType: "thunder"}});
		expect(state.recordImprovedPotentSpellcastingDamage(damage.channelSpell.committedSpellCastReceipt, evidence)).toBe(true);
		expect(grant(state, receipt, {confirmTargetDamaged: true})).toMatchObject({ok: true, currentTempHp: 6});
		expect(state.recordImprovedPotentSpellcastingDamage(receipt, evidence)).toBe(false);
	});

	it("the real weapon damage callsite records the committed cantrip rider and stages its offer once", async () => {
		const state = makeState({domain: "Arcana"});
		state.addAttack({id: "sword", name: "Longsword", damage: "1d8", damageType: "slashing", abilityMod: "str", isMelee: true});
		const receipt = await cast(state, {evidence: false, spellData: boomingBlade});
		const spells = Object.create(Spells.prototype);
		spells._state = state;
		spells.stageImprovedPotentSpellcasting = jest.fn();
		const combat = Object.create(Combat.prototype);
		combat._state = state;
		combat._weaponRiderEnabled = {};
		combat._selectedCunningStrikes = [];
		combat._parseDamage = () => ({total: 8, sides: 8, rolls: [4, 4]});
		combat.renderCombatChanneledSpell = jest.fn();
		combat._page = {_spells: spells, showDiceResult: jest.fn(), pAnimateDamageDice: jest.fn(), saveCharacter: jest.fn()};
		combat._armChannelSpellRider("sword", {spell: {...boomingBlade, sourceClass: "Cleric", sourceClassSource: "XPHB"}, spellData: boomingBlade});
		expect(combat._pendingSpellRider).toMatchObject({spellName: "Booming Blade", dice: "2d8", damageType: "thunder"});
		expect(combat.attachCommittedSpellCastToPendingChannelRider(receipt)).toBe(true);
		expect(state.getImprovedPotentSpellcastingEligibility(receipt).eligible).toBe(false);
		await combat._rollDamage("sword");
		expect(state.getImprovedPotentSpellcastingEligibility(receipt)).toMatchObject({
			eligible: true, damageEvidence: {damage: [{damageType: "thunder", amount: 8}]},
		});
		expect(spells.stageImprovedPotentSpellcasting).toHaveBeenCalledTimes(1);
		expect(spells.stageImprovedPotentSpellcasting).toHaveBeenCalledWith(receipt);
		expect(grant(state, receipt)).toMatchObject({ok: false, reason: "creatureDamageNotConfirmed"});
		expect(grant(state, receipt, {confirmTargetDamaged: true})).toMatchObject({ok: true, currentTempHp: 6});
		await combat._rollDamage("sword");
		expect(spells.stageImprovedPotentSpellcasting).toHaveBeenCalledTimes(1);
	});
});

describe("Common temp HP spell-grant callsite", () => {
	it.each([4, 6, 10])("the real self-effect path offers 6 against an owned pool of %i without stacking or false gain text", async previous => {
		const state = makeState();
		state.grantOwnedTempHp(previous, owner);
		const spells = Object.create(Spells.prototype);
		spells._state = state;
		spells._page = {saveCharacter: jest.fn()};
		const result = await spells._applySpellEffectsToSelf(
			{name: "False Life", source: "XPHB", level: 1},
			{name: "False Life", source: "XPHB", level: 1},
			{tempHp: {amount: 6}}, 1,
		);
		expect(state.getTempHp()).toBe(Math.max(previous, 6));
		expect(state.getTempHpOwner()).toEqual(previous < 6 ? null : owner);
		expect(result).toEqual([previous < 6 ? "6 temp HP" : `retained ${previous} temp HP (offered 6)`]);
	});
});

describe("Existing roll-followup picker lifecycle", () => {
	afterEach(() => jest.restoreAllMocks());

	async function pendingOffer ({outcome = "unconfirmed"} = {}) {
		const state = makeState();
		const receipt = await cast(state, {outcome});
		const controller = Object.create(Spells.prototype);
		controller._state = state;
		controller._page = {saveCharacter: jest.fn(async () => true), _renderHp: jest.fn()};
		const button = {disabled: false};
		const element = {querySelectorAll: () => [button], remove: jest.fn()};
		const pending = {state, receipt, element, inFlight: false, rollFollowup: CharacterSheetModal.buildRollFollowup({label: "Sacred Flame", total: 8})};
		controller._clericPotentOffers = new Map([[receipt.receiptId, pending]]);
		return {state, controller, pending, button};
	}

	it("cancel leaves the receipt pending, costs/HP untouched, and controls enabled", async () => {
		const {state, controller, pending, button} = await pendingOffer();
		jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockResolvedValue(false);
		expect(await controller._pResolveImprovedPotentOffer(pending, true)).toBe(false);
		expect(state.getTempHp()).toBe(0);
		expect(state.getImprovedPotentSpellcastingEligibility(pending.receipt).eligible).toBe(true);
		expect(button.disabled).toBe(false);
		expect(controller._page.saveCharacter).not.toHaveBeenCalled();
	});

	it("gates concurrent clicks while preserving the real roll context and delivering self once", async () => {
		const {state, controller, pending} = await pendingOffer();
		let confirm;
		const prompt = jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockReturnValue(new Promise(resolve => { confirm = resolve; }));
		const delivery = controller._pResolveImprovedPotentOffer(pending, true);
		expect(await controller._pResolveImprovedPotentOffer(pending, true)).toBe(false);
		confirm(true);
		expect(await delivery).toBe(true);
		expect(prompt).toHaveBeenCalledTimes(1);
		expect(prompt.mock.calls[0][0].rollFollowup).toEqual(pending.rollFollowup);
		expect(state.getTempHp()).toBe(6);
		expect(controller._page.saveCharacter).toHaveBeenCalledTimes(1);
		expect(state.getImprovedPotentSpellcastingEligibility(pending.receipt).eligible).toBe(false);
	});

	it("a character switch during confirmation cannot deliver to the new character", async () => {
		const {state, controller, pending} = await pendingOffer();
		jest.spyOn(CharacterSheetModal, "pGetUserBoolean").mockImplementation(async () => {
			controller._state = makeState();
			return true;
		});
		expect(await controller._pResolveImprovedPotentOffer(pending, true)).toBe(false);
		expect(state.getTempHp()).toBe(0);
		expect(controller._state.getTempHp()).toBe(0);
		expect(controller._page.saveCharacter).not.toHaveBeenCalled();
	});

	it("pruning a level-lost offer prevents resurrection after regaining level 14", async () => {
		const {state, controller, pending} = await pendingOffer();
		state._data.classes[0].level = 13;
		controller._pruneImprovedPotentOffers();
		expect(controller._clericPotentOffers.size).toBe(0);
		state._data.classes[0].level = 14;
		expect(state.getImprovedPotentSpellcastingEligibility(pending.receipt).eligible).toBe(false);
		expect(grant(state, pending.receipt, {confirmTargetDamaged: true}).ok).toBe(false);
	});

	it("a real recipient-range rejection keeps the offer pending and never asks the numeric picker to clamp it to 60", async () => {
		const {state, controller, pending} = await pendingOffer({outcome: "damaged"});
		jest.spyOn(CharacterSheetModal, "pGetUserEnum").mockResolvedValue({type: "external", name: "External creature (manual handoff)"});
		jest.spyOn(CharacterSheetModal, "pGetUserString").mockResolvedValue("Outside Ally");
		const distance = jest.spyOn(CharacterSheetModal, "pGetUserNumber").mockResolvedValue(61);
		expect(await controller._pResolveImprovedPotentOffer(pending, false)).toBe(false);
		expect(distance.mock.calls[0][0]).not.toHaveProperty("max");
		expect(state.getTempHp()).toBe(0);
		expect(state.getImprovedPotentSpellcastingEligibility(pending.receipt).eligible).toBe(true);
		expect(controller._page.saveCharacter).not.toHaveBeenCalled();
	});
});
