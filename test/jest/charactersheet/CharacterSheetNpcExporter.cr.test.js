import {jest} from "@jest/globals";
import fs from "node:fs";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {CharacterSheetNpcExporter as Exporter} from "../../../js/charactersheet/charactersheet-npc-exporter.js";
import {getNpcExportSchemaErrors} from "../../util-npc-export-schema.js";

globalThis.DataUtil ||= {};
const {CharacterSheetExport} = await import("../../../js/charactersheet/charactersheet-export.js");
const State = globalThis.CharacterSheetState;
const spells = JSON.parse(fs.readFileSync("data/spells/spells-phb.json", "utf8")).spell;
const index = Exporter.buildSpellThreatIndex([...spells]);
const weapon = (damage, hit = 6, name = "Blade") => ({name, entries: [`{@atk mw} {@hit ${hit}} to hit, reach 5 ft., one target. {@h}{@damage ${damage}} slashing damage.`]});
const estimate = (options = {}) => Exporter._estimateDmgCr({hp: 170, ac: 15, weaponActions: [weapon("48")], ...options});
const block = (options = {}) => ({
	name: "Spellcasting",
	ability: "int",
	headerEntries: ["Spell save {@dc 16}, {@hit 8} to hit with spell attacks."],
	...options,
});
const casting = (blocks, options = {}) => estimate({weaponActions: [], spellcastingBlocks: blocks, exportOpts: {spellIndex: index}, ...options});
const spell = name => `{@spell ${name}|PHB}`;
const caster = () => {
	const state = new State({isDetached: true});
	state.setSpellData([...spells]);
	state.addClass({name: "Wizard", source: "PHB", level: 5});
	state.setAbilityBase("int", 18);
	state.setSpellSlots(3, 1, 1);
	state.addCantrip({name: "Fire Bolt", source: "PHB", sourceClass: "Wizard"});
	state.addSpell({name: "Fireball", source: "PHB", level: 3, sourceClass: "Wizard"}, true);
	return state;
};
const convert = (state, options = {}) => {
	const monster = Exporter.buildExportDocument(state, {spellIndex: index, ...options}).document.monster[0];
	expect(getNpcExportSchemaErrors({data: {monster: [monster]}, kind: "bestiary", filePath: "cr-regression"})).toEqual([]);
	return {monster, report: Exporter.getExportReport(monster).crEstimate};
};

describe("R01 published tables and independent CR arithmetic", () => {
	it("matches every published upper threshold and expected AC/attack/save benchmark", () => {
		const published = JSON.parse(fs.readFileSync("data/msbcr.json", "utf8")).cr;
		expect(Exporter._getDmgCrTable()).toEqual(published.map(row => ({
			cr: row._cr, hp: row.hpMax, dpr: row.dprMax, ac: row.ac, attackBonus: row.attackBonus, saveDc: row.saveDc,
		})));
	});

	it.each([
		[170, 15, 48, 6, "7", "7", "7"],
		[170, 19, 48, 10, "9", "9", "9"],
		[170, 16, 48, 7, "7", "7", "7"],
		[500, 19, 200, 11, "23", "24", "24"],
		[2000, 19, 500, 14, "30", "30", "30"],
	])("uses CR-specific benchmarks: HP %s, AC %s, DPR %s, hit %s", (hp, ac, damage, hit, defensiveCr, offensiveCr, cr) => {
		const result = estimate({hp, ac, weaponActions: [weapon(String(damage), hit)]});
		expect(result).toMatchObject({defensiveCr, offensiveCr, cr, dpr: damage});
		expect(result.rounds.map(round => round.damage)).toEqual([damage, damage, damage]);
		expect(result).not.toHaveProperty("levelAnchor");
	});

	it("uses spell save DC rather than borrowing a weapon or best class attack bonus", () => {
		const result = casting([block({headerEntries: ["Spell save {@dc 19}, {@hit 3} to hit."], will: [spell("Fireball")]})]);
		expect(result.dpr).toBe(56);
		expect(result.offense).toMatchObject({baseCr: "8", expected: 16, statistic: 19, statisticKey: "saveDc", adjustment: 1, cr: "9"});
	});

	it("does not give automatic hits an invented attack bonus", () => {
		const result = casting([block({will: [spell("Magic Missile")]})]);
		expect(result.dpr).toBe(10.5);
		expect(result.offense).toMatchObject({delivery: "automatic", statistic: null, adjustment: 0});
	});

	it("uses signed composite averages, not an unsigned/partial parse", () => {
		expect(Exporter._estimateAverageDice("2d6 + 1d4 - 3")).toBe(6.5);
		for (const text of ["2d6 + PB", "2d6junk", "1d61d6", "1d0", ""]) expect(Exporter._estimateAverageDice(text)).toBeNull();
	});

	it("does not award free Mage Armor, Shield, evasion, or a level anchor", () => {
		const state = caster();
		state.addSpell({name: "Shield", source: "PHB", level: 1, sourceClass: "Wizard"}, false);
		state.addSpell({name: "Mage Armor", source: "PHB", level: 1, sourceClass: "Wizard"}, false);
		state.addFeature({name: "Evasion", source: "PHB", description: "When you succeed on a Dexterity saving throw, take no damage."});
		const {monster, report} = convert(state);
		expect(report.effectiveAc).toBe(monster.ac[0].ac);
		expect(report.effectiveHp).toBe(monster.hp.average);
		expect(report).not.toHaveProperty("levelAnchor");
	});

	it("uses the documented expected-CR band for broad resistance, not a level-based multiplier", () => {
		const result = estimate({hp: 80, ac: 13, weaponActions: [weapon("10", 3)], defenses: {resist: ["bludgeoning", "piercing", "slashing"]}});
		expect(result.defense).toMatchObject({multiplier: 2, effectiveHp: 160});
		expect(estimate({defenses: {resist: ["fire"]}}).effectiveHp).toBe(170);
		expect(estimate({defenses: {resist: [{resist: ["bludgeoning", "piercing", "slashing"], note: "while raging"}]}}).effectiveHp).toBe(170);
		expect(estimate({hp: 80, ac: 13, weaponActions: [weapon("10", 3)], defenses: {resist: [{resist: ["bludgeoning", "piercing", "slashing"], note: "({@feat Elemental Ward|TEST})"}]}}).effectiveHp).toBe(160);
	});

	it("accounts for configured Legendary Resistance without inventing legendary attack damage", () => {
		const result = estimate({exportOpts: {legendaryEnabled: true, legendaryResistances: 2}});
		expect(result.defense.legendaryHp).toBe(40);
		expect(result.effectiveHp).toBe(210);
		expect(result.dpr).toBe(48);
		expect(result.limitations.join(" ")).toMatch(/Legendary actions are not scheduled/);
	});
});

describe("R01 three-round resources and bounded procedures", () => {
	it("spends one high slot once and falls back to actual cantrips", () => {
		const result = casting([block({spells: {9: {slots: 1, spells: [spell("Meteor Swarm")]}}, will: [spell("Fire Bolt")]})]);
		expect(result.rounds.map(round => round.damage)).toEqual([280, 5.5, 5.5]);
		expect(result.dpr).toBe(97);
		expect(result.resources).toEqual([{id: "slots:9", maximum: 1, spent: 1, remaining: 0}]);
	});

	it("does not invent slots or free cantrips when no pool is printed", () => {
		const result = casting([block({spells: {3: {slots: 0, spells: [spell("Fireball")]}}})]);
		expect(result.dpr).toBe(0);
		expect(result.rounds.map(round => round.action)).toEqual(["Dodge", "Dodge", "Dodge"]);
		expect(result.resources).toEqual([]);
	});

	it("does not invent a consumed material supply for a damaging spell", () => {
		const paid = {...spells.find(row => row.name === "Fireball"), components: {m: {text: "a consumed gem", consume: true}}};
		const result = casting([block({will: [spell("Fireball")]})], {exportOpts: {spellIndex: Exporter.buildSpellThreatIndex([paid])}});
		expect(result.dpr).toBe(0);
		expect(result.limitations.join(" ")).toMatch(/consumed material supply is not verified/);
	});

	it("does not promote a source-gated saved attack into an unlimited ordinary attack", () => {
		const result = estimate({weaponActions: [weapon("8d6")], attacks: [{name: "Blade", requiresState: "otherForm"}]});
		expect(result.dpr).toBe(0);
		expect(result.limitations.join(" ")).toMatch(/source-gated attack/);
	});

	it.each([["1", 56], ["1e", 112]])("keeps innate %s grouped/each semantics", (key, damage) => {
		const result = casting([block({daily: {[key]: [spell("Fireball"), spell("Lightning Bolt")]}})]);
		expect(result.rounds.reduce((sum, round) => sum + round.damage, 0)).toBe(damage);
		expect(result.resources.reduce((sum, pool) => sum + pool.spent, 0)).toBe(key === "1" ? 1 : 2);
	});

	it("upcasts with a real higher slot while preserving native-level access", () => {
		const result = casting([block({spells: {3: {slots: 0, spells: [spell("Fireball")]}, 5: {slots: 1, spells: []}}})]);
		expect(result.rounds.map(round => round.damage)).toEqual([70, 0, 0]);
		expect(result.resources[0]).toMatchObject({id: "slots:5", spent: 1});
	});

	it("scales source cantrips by total level, not proficiency bonus", () => {
		const state = new State({isDetached: true});
		state.addClass({name: "Wizard", source: "PHB", level: 11});
		const result = casting([block({will: [spell("Fire Bolt")]})], {state});
		expect(result.dpr).toBe(16.5);
		expect(casting([block({will: [spell("Eldritch Blast")]})], {state}).dpr).toBe(16.5);
	});

	it("does not multiply a once-per-turn rider by Extra Attack", () => {
		const attack = weapon("1d8+4");
		attack.entries[0] = attack.entries[0].replace("slashing damage.", "slashing damage plus {@damage 8d6} damage (Sneak Attack, 1/turn).");
		const result = estimate({weaponActions: [attack], attacks: [{name: "Blade"}], attacksPerAction: 3});
		expect(result.dpr).toBe(53.5);
	});

	it("does not make paid/target-conditional damage an unconditional rider", () => {
		const attack = weapon("1d8+4");
		attack.entries[0] = attack.entries[0].replace("slashing damage.", "slashing damage plus {@damage 10d10} radiant damage (spend 1 slot) plus {@damage 2d8} damage against Undead.");
		const result = estimate({weaponActions: [attack], attacks: [{name: "Blade"}], attacksPerAction: 2});
		expect(result.dpr).toBe(17);
		expect(result.limitations.join(" ")).toMatch(/paid rider excluded/);
	});

	it("shares a finite pool across actions and bonus actions and honors bonus-spell restrictions", () => {
		const candidates = [
			{name: "Cantrip", economy: "action", perHit: 5, riders: {}, costs: {}, spellLevel: 0},
			{name: "Leveled action", economy: "action", perHit: 50, riders: {}, costs: {shared: 1}, spellLevel: 1},
			{name: "Leveled bonus", economy: "bonus", perHit: 40, riders: {}, costs: {shared: 1}, spellLevel: 1},
		];
		const result = Exporter._planDmgRounds(candidates, new Map([["shared", 2]]), new Set());
		expect(result.rounds.reduce((sum, round) => sum + round.damage, 0)).toBe(105);
		expect(result.resources).toEqual([{id: "shared", maximum: 2, spent: 2, remaining: 0}]);
		expect(result.rounds.every(round => !round.bonus || round.action === "Cantrip")).toBe(true);
	});

	it("never stacks two concentration effects or counts later attack/tick damage", () => {
		const result = casting([block({spells: {2: {slots: 2, spells: [spell("Spiritual Weapon")]}}})], {state: caster()});
		expect(result.rounds.reduce((sum, round) => sum + round.damage, 0)).toBe(17);
		expect(result.limitations.join(" ")).toMatch(/only initial damage/);
		expect(index["cloudkill|phb"].dmg).toMatchObject({damage: 0});
	});

	it("exposes a reached search ceiling rather than claiming an optimum", () => {
		const candidates = Array.from({length: 34}, (_, i) => ({name: `Technique ${i}`, economy: "action", perHit: i + 1, riders: {}, costs: {[`pool:${i}`]: 1}}));
		const limits = new Set();
		const result = Exporter._planDmgRounds(candidates, new Map(candidates.map((_, i) => [`pool:${i}`, 1])), limits);
		expect(result.search.limitHit).toBe(true);
		expect([...limits].join(" ")).toMatch(/512-state ceiling.*not a certified optimum/);
		expect(result.resources.every(resource => resource.remaining >= 0)).toBe(true);
	});
});

describe.each(["complete", "compact"])("R01 real State export (%s)", presentationMode => {
	it("uses only prepared routes and separates ordinary/Pact slots without resting or mutation", () => {
		const state = caster();
		state.addClass({name: "Warlock", source: "PHB", level: 5});
		state.setPactSlots({current: 0, max: 2, level: 3});
		state.addSpell({name: "Meteor Swarm", source: "PHB", level: 9, sourceClass: "Wizard", inSpellbook: true}, false);
		const before = JSON.stringify(state._data);
		const {report} = convert(state, {presentationMode});
		expect(report.dpr).toBe(56);
		expect(report.resources).toEqual(expect.arrayContaining([
			{id: "slots:3", maximum: 2, spent: 2, remaining: 0},
			{id: "pact:3", maximum: 2, spent: 1, remaining: 1},
		]));
		expect(JSON.stringify(report.rounds)).not.toContain("Meteor Swarm");
		expect(JSON.stringify(state._data)).toBe(before);
	});

	it.each(["3", "three"])("pays source-owned charge costs (%s) for a real emitted bonus attack, without a second bonus action", amount => {
		const state = new State({isDetached: true});
		state.setAbilityBase("str", 14);
		state.addResource({id: "shared-charge", name: "Stored Charge", current: 0, max: 5, recharge: "longRest"});
		state.addFeature({
			name: "Charged Ray",
			source: "PHB",
			resourceId: "shared-charge",
			entries: [`As a bonus action, you expend ${amount} charges to use this attack.`, "{@atk rs} {@hit +8} to hit, range 30 ft., one target. {@h}{@damage 8d6} force damage."],
		});
		const {monster, report} = convert(state, {presentationMode, includeFeatures: "manual", selectedFeatureIds: state.getFeatures().map(feature => feature.id)});
		expect(JSON.stringify(monster.bonus)).toContain("Charged Ray");
		expect(report.rounds.filter(round => round.bonus)).toHaveLength(1);
		expect(report.resources).toContainEqual({id: "resource:shared-charge", maximum: 5, spent: 3, remaining: 2});
		expect(report.rounds.reduce((sum, round) => sum + round.damage, 0)).toBe(37);
		expect(state.getResource("shared-charge").current).toBe(0);
		const currentMonster = Exporter.buildExportDocument(state, {presentationMode, profile: "companion", spellIndex: index}).document.monster[0];
		const current = Exporter.getExportReport(currentMonster).crEstimate;
		expect(current.rounds.every(round => !round.bonus)).toBe(true);
		expect(current.resources).toContainEqual({id: "resource:shared-charge", maximum: 0, spent: 0, remaining: 0});
	});

	it("discloses a compound charge/slot cost rather than silently paying only the first", () => {
		const state = new State({isDetached: true});
		state.addResource({id: "charge", name: "Charge", current: 5, max: 5, recharge: "longRest"});
		state.addFeature({
			name: "Compound Ray",
			source: "PHB",
			resourceId: "charge",
			entries: ["As a bonus action, you expend 3 charges and expend 1 spell slot.", "{@atk rs} {@hit +8} to hit, range 30 ft., one target. {@h}{@damage 8d6} force damage."],
		});
		const {monster, report} = convert(state, {presentationMode});
		expect(JSON.stringify(monster.bonus)).toContain("Compound Ray");
		expect(report.rounds.every(round => !round.bonus)).toBe(true);
		expect(report.limitations.join(" ")).toMatch(/variable\/compound costs/);
	});

	it("defaults to DMG-style, retains legacy blend, and preserves manual CR under either estimator", () => {
		const state = caster();
		const {monster: dmg, report} = convert(state, {presentationMode});
		expect(report.estimator).toBe("dmg");
		const {monster: legacy, report: old} = convert(state, {presentationMode, crEstimator: "legacy"});
		expect(old.estimator).toBe("legacy");
		expect(old.cr).toBe(String(Math.round((Number(old.defensiveCr) + Number(old.offensiveCr)) / 2 * 0.75 + old.levelAnchor * 0.25)));
		const withoutCr = monster => { const {cr, ...rest} = monster; return rest; };
		expect(withoutCr(dmg)).toEqual(withoutCr(legacy));
		for (const crEstimator of ["dmg", "legacy"]) {
			const {monster, report: manual} = convert(state, {presentationMode, crMode: "manual", crManual: "17", crEstimator});
			expect(monster.cr).toBe("17");
			expect(manual).toMatchObject({estimator: "manual", cr: "17", limitations: []});
		}
	});

	it("surfaces missing/old threat data, never a successful school-based DMG estimate", () => {
		const state = caster();
		for (const spellIndex of [null, {"fireball|phb": {level: 3, avgDamage: 100}}]) {
			const {report} = convert(state, {presentationMode, spellIndex});
			expect(report.limitations.join(" ")).toMatch(/(?:unavailable|not inferred)/);
			expect(JSON.stringify(report.rounds)).not.toContain("Fireball");
		}
	});

	it("carries a defensive-copy report outside bestiary schema objects", () => {
		const {monster, report} = convert(caster(), {presentationMode, includeCrBreakdown: true});
		expect(JSON.stringify(monster.trait)).toContain("DMG-style CR");
		report.rounds.length = 0;
		expect(Exporter.getExportReport(monster).crEstimate.rounds).toHaveLength(3);
		expect(monster.crEstimate).toBeUndefined();
	});
});

describe("R01 preference and missing-index boundaries", () => {
	it.each(["array", "envelope"])("indexes the real %s loader shape and installed source-qualified spells", async shape => {
		const service = Object.create(CharacterSheetExport.prototype);
		const oldSpell = globalThis.DataUtil.spell;
		const loaded = [...spells];
		const brewSpell = {...spells.find(spell => spell.name === "Fireball"), name: "Brew Fire", source: "TEST"};
		service._state = {_allSpells: [brewSpell]};
		globalThis.DataUtil.spell = {pLoadAll: jest.fn().mockResolvedValue(shape === "array" ? loaded : {spell: loaded})};
		try {
			const result = await service._pGetNpcExportSpellIndex();
			expect(result["fireball|phb"].dmg.damage).toBe(28);
			expect(result["brew fire|test"].dmg.damage).toBe(28);
			expect(await service._pGetNpcExportSpellIndex()).toBe(result);
			expect(globalThis.DataUtil.spell.pLoadAll).toHaveBeenCalledTimes(1);
		} finally { globalThis.DataUtil.spell = oldSpell; }
	});

	it("defaults legacy preferences to dmg and preserves the manual value when changing method", async () => {
		const service = Object.create(CharacterSheetExport.prototype);
		const oldGet = globalThis.StorageUtil.pGetForPage;
		const oldSet = globalThis.StorageUtil.pSetForPage;
		let saved = {crMode: "manual", crManual: "17"};
		globalThis.StorageUtil.pGetForPage = jest.fn(async () => saved);
		globalThis.StorageUtil.pSetForPage = jest.fn(async (key, value) => { saved = value; });
		try {
			expect(await service._pGetNpcExportOptions()).toMatchObject({crEstimator: "dmg", crManual: "17"});
			await service._pSetNpcExportOptions({...saved, crEstimator: "legacy"});
			expect(await service._pGetNpcExportOptions()).toMatchObject({crEstimator: "legacy", crManual: "17", crMode: "manual"});
		} finally {
			globalThis.StorageUtil.pGetForPage = oldGet;
			globalThis.StorageUtil.pSetForPage = oldSet;
		}
	});

	it("reports the failed spell-load boundary explicitly", async () => {
		const service = Object.create(CharacterSheetExport.prototype);
		const oldSpell = globalThis.DataUtil.spell;
		const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
		const toast = jest.spyOn(globalThis.JqueryUtil, "doToast");
		globalThis.DataUtil.spell = {pLoadAll: jest.fn().mockRejectedValue(new Error("offline test"))};
		try {
			expect(await service._pGetNpcExportSpellIndex()).toBeNull();
			expect(warn).toHaveBeenCalledWith("NPC export spell-threat data unavailable:", expect.objectContaining({message: "offline test"}));
			expect(toast).toHaveBeenCalledWith(expect.objectContaining({type: "warning", content: expect.stringContaining("unmodeled spell damage")}));
		} finally {
			globalThis.DataUtil.spell = oldSpell;
			warn.mockRestore();
			toast.mockRestore();
		}
	});
});
