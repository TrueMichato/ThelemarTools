import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";

import fixture from "./fixtures/psionic-powers-talpsi.json";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

const POWERS = Object.fromEntries(fixture.psionic.map(p => [p.name, p]));
const K = CharacterSheetClassUtils.PSIONIC_MODE_KINDS;

describe("parsePsionicPower — header lifting", () => {
	it("lifts manifestation time, range and duration out of the entries prose", () => {
		const parsed = CharacterSheetClassUtils.parsePsionicPower(POWERS["Adapt"]);
		expect(parsed.meta.manifestationTime).toBe("1 action");
		expect(parsed.meta.range).toBe("15 feet");
		expect(parsed.meta.duration).toBe("24 hours");
	});

	it("removes the header entries from the body so they are not rendered twice", () => {
		const parsed = CharacterSheetClassUtils.parsePsionicPower(POWERS["Adapt"]);
		expect(parsed.body).toHaveLength(0);
		// Aura Projection opens with a paragraph of its own before its modes, which must
		// survive the header split without a header sneaking through with it.
		const auraBody = CharacterSheetClassUtils.parsePsionicPower(POWERS["Aura Projection"]).body;
		expect(auraBody).toHaveLength(1);
		expect(auraBody[0]).not.toMatch(/^\{@b /);
	});

	it("tolerates a power with no duration header", () => {
		const parsed = CharacterSheetClassUtils.parsePsionicPower(POWERS["Aura Projection"]);
		expect(parsed.meta.duration).toBeNull();
		expect(parsed.meta.range).toBe("Self (30-foot radius)");
	});

	it("records order and discipline", () => {
		const parsed = CharacterSheetClassUtils.parsePsionicPower(POWERS["Aura Projection"]);
		expect(parsed.order).toBe(4);
		expect(parsed.discipline).toBe("TP");
	});
});

describe("parsePsionicPower — action economy", () => {
	it.each([
		["Adapt", "action"],
		["Psionic Bolt", "action"],
		["Again", "reaction"],
	])("buckets %s as %s", (name, actionType) => {
		expect(CharacterSheetClassUtils.parsePsionicPower(POWERS[name]).meta.actionType).toBe(actionType);
	});

	it("extracts the trigger from a reaction power", () => {
		const parsed = CharacterSheetClassUtils.parsePsionicPower(POWERS["Again"]);
		expect(parsed.meta.reactionTrigger).toBeTruthy();
		expect(parsed.meta.reactionTrigger).not.toMatch(/^which you take/i);
	});

	it("buckets a manifestation time longer than a turn as long", () => {
		const slow = {name: "Slow", source: "X", order: "2nd-Order", entries: ["{@b Manifestation Time:} 10 minutes", "{@b Range:} Self"], modes: []};
		expect(CharacterSheetClassUtils.parsePsionicPower(slow).meta.actionType).toBe("long");
	});

	it("buckets a bonus-action manifestation time", () => {
		const fast = {name: "Fast", source: "X", order: "2nd-Order", entries: ["{@b Manifestation Time:} 1 bonus action", "{@b Range:} Self"], modes: []};
		expect(CharacterSheetClassUtils.parsePsionicPower(fast).meta.actionType).toBe("bonus");
	});
});

describe("parsePsionicPower — mode classification", () => {
	it("classifies an order band and the increased-order rule", () => {
		const parsed = CharacterSheetClassUtils.parsePsionicPower(POWERS["Adapt"]);
		expect(parsed.orderModes.map(m => m.order)).toEqual([2]);
		expect(parsed.increasedOrder).toBeTruthy();
		expect(parsed.increasedOrder.kind).toBe(K.INCREASED_ORDER);
		expect(parsed.variantModes).toHaveLength(0);
	});

	it("classifies character-level scaling bands on a 1st-order power", () => {
		const parsed = CharacterSheetClassUtils.parsePsionicPower(POWERS["Psionic Bolt"]);
		expect(parsed.levelModes.map(m => m.levelBand)).toEqual([
			{min: 1, max: 4},
			{min: 5, max: 10},
			{min: 11, max: 16},
			{min: 17, max: Number.POSITIVE_INFINITY},
		]);
		expect(parsed.orderModes).toHaveLength(0);
	});

	it("classifies named variant modes as player choices", () => {
		const parsed = CharacterSheetClassUtils.parsePsionicPower(POWERS["Aura Projection"]);
		expect(parsed.variantModes.map(m => m.name)).toEqual(["Inspired", "Sorrow", "Terror"]);
		expect(parsed.increasedOrder).toBeTruthy();
	});

	it("caches on the power object rather than re-parsing", () => {
		const a = CharacterSheetClassUtils.parsePsionicPower(POWERS["Adapt"]);
		const b = CharacterSheetClassUtils.parsePsionicPower(POWERS["Adapt"]);
		expect(a).toBe(b);
	});

	it("returns null for a missing power", () => {
		expect(CharacterSheetClassUtils.parsePsionicPower(null)).toBeNull();
	});
});

describe("getPsionicPowerModes — resolving one manifestation", () => {
	it("picks the level band matching the character's level", () => {
		const at3 = CharacterSheetClassUtils.getPsionicPowerModes(POWERS["Psionic Bolt"], {characterLevel: 3});
		expect(at3.map(m => m.name)).toEqual(["1st-4th Level"]);
		const at20 = CharacterSheetClassUtils.getPsionicPowerModes(POWERS["Psionic Bolt"], {characterLevel: 20});
		expect(at20.map(m => m.name)).toEqual(["17th+ Level"]);
	});

	it("keeps using the highest authored order band when increased past it", () => {
		const modes = CharacterSheetClassUtils.getPsionicPowerModes(POWERS["Adapt"], {order: 5});
		expect(modes.map(m => m.name)).toEqual(["2nd-Order"]);
	});

	it("puts the chosen variant ahead of the order band", () => {
		const modes = CharacterSheetClassUtils.getPsionicPowerModes(POWERS["Aura Projection"], {order: 4, modeName: "Terror"});
		expect(modes[0].name).toBe("Terror");
	});

	it("ignores an unknown variant name rather than throwing", () => {
		const modes = CharacterSheetClassUtils.getPsionicPowerModes(POWERS["Aura Projection"], {order: 4, modeName: "Nope"});
		expect(modes.every(m => m.name !== "Nope")).toBe(true);
	});
});

describe("getPsionicPowerConcentration", () => {
	it("reports concentration carried by a variant mode", () => {
		const conc = CharacterSheetClassUtils.getPsionicPowerConcentration(POWERS["Aura Projection"], {order: 4, modeName: "Inspired"});
		expect(conc).toEqual({duration: 1, unit: "min"});
	});

	it("reports concentration carried by an order band", () => {
		expect(CharacterSheetClassUtils.getPsionicPowerConcentration(POWERS["Apparition"], {order: 2})).toBeTruthy();
	});

	it("returns null for a power that ties up no concentration", () => {
		expect(CharacterSheetClassUtils.getPsionicPowerConcentration(POWERS["Psionic Bolt"], {characterLevel: 5})).toBeNull();
		expect(CharacterSheetClassUtils.parsePsionicPower(POWERS["Psionic Bolt"]).concentrates).toBe(false);
	});

	it("flags a power as concentrating when any mode requires it", () => {
		expect(CharacterSheetClassUtils.parsePsionicPower(POWERS["Aura Projection"]).concentrates).toBe(true);
	});

	it("falls back to a Duration header that states concentration", () => {
		const p = {
			name: "Header Conc",
			source: "X",
			order: "2nd-Order",
			entries: ["{@b Manifestation Time:} 1 action", "{@b Range:} Self", "{@b Duration:} Concentration, up to 10 minutes"],
			modes: [],
		};
		expect(CharacterSheetClassUtils.getPsionicPowerConcentration(p, {order: 2})).toEqual({duration: 10, unit: "minute"});
		expect(CharacterSheetClassUtils.parsePsionicPower(p).concentrates).toBe(true);
	});
});

// ==========================================
// Projection: known powers
// ==========================================

const CharacterSheetState = globalThis.CharacterSheetState;

function makeTalent ({level = 5, subclass = null, int = 16} = {}) {
	const state = new CharacterSheetState();
	state.addClass({name: "Talent", source: "TalPsi", level});
	if (subclass) state.setSubclass("Talent", {name: subclass, shortName: subclass, source: "TalPsi"});
	state.setAbilityBase("int", int);
	state.setAbilityBase("con", 14);
	state.setMaxHp(40);
	state.setCurrentHp(40);
	state.setPsionicCatalog(fixture.psionic);
	return state;
}

/** Add a power exactly as the shared optional-feature picker records one. */
function learnPower (state, name, {order = null} = {}) {
	const power = POWERS[name];
	const parsedOrder = order ?? CharacterSheetClassUtils.getPsionicPowerOrder(power);
	state.addFeature({
		name: power.name,
		source: power.source,
		level: 1,
		className: "Talent",
		optionalFeatureTypes: [parsedOrder === 1 ? "PsiP1" : "PsiPH"],
		_psionicOrder: parsedOrder,
		_psionicPowerType: power.type,
		description: `${power.name} power`,
	});
}

describe("getKnownPowers — projection from features", () => {
	it("returns nothing for a character who knows no powers", () => {
		expect(makeTalent().getKnownPowers()).toEqual([]);
	});

	it("projects a picked power with parsed metadata joined from the catalog", () => {
		const state = makeTalent();
		learnPower(state, "Adapt");
		const [power] = state.getKnownPowers();
		expect(power.name).toBe("Adapt");
		expect(power.order).toBe(2);
		expect(power.isFirstOrder).toBe(false);
		expect(power.meta.manifestationTime).toBe("1 action");
		expect(power.meta.range).toBe("15 feet");
		expect(power.increasedOrder).toBeTruthy();
	});

	it("labels the discipline from the manifester config", () => {
		const state = makeTalent();
		learnPower(state, "Aura Projection");
		const [power] = state.getKnownPowers();
		expect(power.discipline).toBe("TP");
		expect(power.disciplineLabel).toBe("Telepathy");
	});

	it("ignores non-power features", () => {
		const state = makeTalent();
		state.addFeature({name: "Psionic Bastion", level: 11, className: "Talent", source: "TalPsi", description: "x"});
		learnPower(state, "Adapt");
		expect(state.getKnownPowers().map(p => p.name)).toEqual(["Adapt"]);
	});

	it("sorts by order then name", () => {
		const state = makeTalent();
		learnPower(state, "Aura Projection");
		learnPower(state, "Adapt");
		learnPower(state, "Psionic Bolt");
		expect(state.getKnownPowers().map(p => p.name)).toEqual(["Psionic Bolt", "Adapt", "Aura Projection"]);
	});

	it("filters by order, discipline and pool", () => {
		const state = makeTalent();
		learnPower(state, "Adapt");
		learnPower(state, "Psionic Bolt");
		expect(state.getKnownPowers({order: 1}).map(p => p.name)).toEqual(["Psionic Bolt"]);
		expect(state.getKnownPowers({discipline: "MM"}).map(p => p.name)).toEqual(["Adapt"]);
		expect(state.getKnownPowers({firstOrderOnly: true}).map(p => p.name)).toEqual(["Psionic Bolt"]);
		expect(state.getKnownPowers({higherOrderOnly: true}).map(p => p.name)).toEqual(["Adapt"]);
	});

	it("still projects when no catalog is loaded, using the stored feature", () => {
		const state = makeTalent();
		state.setPsionicCatalog([]);
		learnPower(state, "Adapt");
		const [power] = state.getKnownPowers();
		expect(power.name).toBe("Adapt");
		expect(power.order).toBe(2);
	});

	it("resolves one power by id", () => {
		const state = makeTalent();
		learnPower(state, "Adapt");
		expect(state.getKnownPower("Adapt|TalPsi").name).toBe("Adapt");
		expect(state.getKnownPower("Adapt").name).toBe("Adapt");
		expect(state.getKnownPower("Nope|TalPsi")).toBeNull();
	});
});

describe("powers-known budget and concentration capacity", () => {
	it("reports both pools against the class table", () => {
		const state = makeTalent({level: 5});
		learnPower(state, "Psionic Bolt");
		learnPower(state, "Adapt");
		const budget = state.getPowersKnownBudget();
		expect(budget.firstOrder).toEqual({used: 1, max: 5});
		expect(budget.higherOrder).toEqual({used: 1, max: 6});
	});

	it("caps power concentration at the proficiency bonus, not at one", () => {
		expect(makeTalent({level: 1}).getPowerConcentrationMax()).toBe(2);
		expect(makeTalent({level: 5}).getPowerConcentrationMax()).toBe(3);
		expect(makeTalent({level: 17}).getPowerConcentrationMax()).toBe(6);
	});

	it("reports no concentration capacity for a non-manifester", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		expect(state.isPsionicManifester()).toBe(false);
		expect(state.getPowerConcentrationMax()).toBe(0);
		expect(state.getKnownPowers()).toEqual([]);
	});

	it("resolves the manifester generically from the config table", () => {
		const entry = makeTalent({level: 7}).getPsionicManifesterEntry();
		expect(entry.config.className).toBe("Talent");
		expect(entry.level).toBe(7);
	});
});

// ==========================================
// Manifesting
// ==========================================

/** Level 9 Telekinetic: PB 4, max order 4, manifestation die d6. */
function makeManifester ({level = 9, subclass = null} = {}) {
	const state = makeTalent({level, subclass});
	learnPower(state, "Adapt"); // 2nd, MM
	learnPower(state, "Apparition"); // 2nd, concentration on its order band
	learnPower(state, "Aura Projection"); // 4th, concentration on variant modes
	learnPower(state, "Psionic Bolt"); // 1st, at-will
	return state;
}

function grantExertion (state, name) {
	state.addFeature({name, level: 3, className: "Talent", source: "TalPsi", description: `${name} exertion`});
}

describe("manifestPower — order validation", () => {
	it("rejects an unknown power", () => {
		expect(makeManifester().manifestPower("Nope|TalPsi").ok).toBe(false);
	});

	it("manifests at the power's own order by default", () => {
		const res = makeManifester().manifestPower("Adapt|TalPsi", {roll: 6});
		expect(res.ok).toBe(true);
		expect(res.order).toBe(2);
		expect(res.increased).toBe(false);
	});

	it("manifests at an increased order", () => {
		const res = makeManifester().manifestPower("Adapt|TalPsi", {order: 4, roll: 6});
		expect(res.ok).toBe(true);
		expect(res.order).toBe(4);
		expect(res.increased).toBe(true);
		expect(res.test.score).toBe(4);
	});

	it("refuses an order the class table does not allow yet", () => {
		const res = makeManifester({level: 9}).manifestPower("Adapt|TalPsi", {order: 5, roll: 6});
		expect(res.ok).toBe(false);
		expect(res.reason).toBe("order-too-high");
		expect(res.maxOrder).toBe(4);
	});

	it("never manifests below the power's own order", () => {
		const res = makeManifester().manifestPower("Aura Projection|TalPsi", {order: 2, roll: 6});
		expect(res.order).toBe(4);
	});

	it("manifests a 1st-order power with no test and no strain", () => {
		const state = makeManifester();
		const res = state.manifestPower("Psionic Bolt|TalPsi");
		expect(res.ok).toBe(true);
		expect(res.test.outcome).toBe("automatic");
		expect(state.getTotalStrain()).toBe(0);
	});
});

describe("manifestPower — the score comes from real concentration", () => {
	it("counts other concentrated powers instead of asking the player", () => {
		const state = makeManifester();
		state.manifestPower("Apparition|TalPsi", {roll: 6}); // concentrates
		expect(state.getPowerConcentrations()).toHaveLength(1);

		const res = state.manifestPower("Aura Projection|TalPsi", {modeName: "Inspired", roll: 6});
		// 4th order + 1 other concentration
		expect(res.test.score).toBe(5);
	});

	it("does not count a power against its own re-manifestation", () => {
		const state = makeManifester();
		state.manifestPower("Aura Projection|TalPsi", {modeName: "Terror", roll: 6});
		const res = state.manifestPower("Aura Projection|TalPsi", {modeName: "Terror", roll: 6});
		expect(res.test.score).toBe(4);
	});
});

describe("manifestPower — strain outcomes", () => {
	it("charges nothing when the roll beats the score", () => {
		const state = makeManifester();
		state.manifestPower("Adapt|TalPsi", {roll: 6});
		expect(state.getTotalStrain()).toBe(0);
	});

	it("charges 1 strain when the roll ties the score", () => {
		const state = makeManifester();
		state.manifestPower("Adapt|TalPsi", {roll: 2, track: "mind"});
		expect(state.getStrain().mind).toBe(1);
	});

	it("charges the power's order when the roll is under the score", () => {
		const state = makeManifester();
		state.manifestPower("Adapt|TalPsi", {order: 4, roll: 1, track: "soul"});
		expect(state.getStrain().soul).toBe(4);
	});

	it("commits nothing beyond the roll on overflow", () => {
		const state = makeManifester({level: 9});
		state.addStrain(12, "body"); // max is 13
		const res = state.manifestPower("Adapt|TalPsi", {order: 4, roll: 1});
		expect(res.ok).toBe(false);
		expect(res.reason).toBe("overflow");
		expect(state.getActiveManifestations()).toHaveLength(0);
		expect(state.getTotalStrain()).toBe(12);
	});
});

describe("manifestPower — concentration and active manifestations", () => {
	it("starts concentrating when the chosen mode requires it", () => {
		const state = makeManifester();
		state.manifestPower("Aura Projection|TalPsi", {modeName: "Terror", roll: 6});
		expect(state.getPowerConcentrations().map(c => c.name)).toEqual(["Aura Projection"]);
		expect(state.getConcentration().modeName).toBe("Terror");
	});

	it("does not concentrate on a power that needs none", () => {
		const state = makeManifester();
		state.manifestPower("Adapt|TalPsi", {roll: 6});
		expect(state.getPowerConcentrations()).toHaveLength(0);
		expect(state.getActiveManifestations()).toHaveLength(1);
	});

	it("records the running manifestation with its order and mode", () => {
		const state = makeManifester();
		state.manifestPower("Aura Projection|TalPsi", {modeName: "Sorrow", roll: 6});
		const [m] = state.getActiveManifestations();
		expect(m).toMatchObject({name: "Aura Projection", order: 4, baseOrder: 4, modeName: "Sorrow"});
	});

	it("never runs two manifestations of the same power", () => {
		const state = makeManifester();
		state.manifestPower("Adapt|TalPsi", {roll: 6});
		state.manifestPower("Adapt|TalPsi", {order: 3, roll: 6});
		expect(state.getActiveManifestations()).toHaveLength(1);
		expect(state.getActiveManifestations()[0].order).toBe(3);
	});

	it("ends a running manifestation and its concentration", () => {
		const state = makeManifester();
		state.manifestPower("Apparition|TalPsi", {roll: 6});
		expect(state.endManifestation("Apparition|TalPsi")).toBe(true);
		expect(state.getActiveManifestations()).toHaveLength(0);
		expect(state.getPowerConcentrations()).toHaveLength(0);
	});

	it("drops a running power when concentration is pushed past the cap", () => {
		const state = makeTalent({level: 1}); // PB 2
		["Apparition", "Aura Projection"].forEach(n => learnPower(state, n));
		state.manifestPower("Apparition|TalPsi", {roll: 6});
		state.addConcentration({id: "power:X|TalPsi", kind: "power", name: "X", order: 2});
		state.addConcentration({id: "power:Y|TalPsi", kind: "power", name: "Y", order: 2});
		expect(state.getActiveManifestations().map(m => m.name)).not.toContain("Apparition");
	});

	it("ends every running power on a long rest", () => {
		const state = makeManifester();
		state.manifestPower("Apparition|TalPsi", {roll: 6});
		state.manifestPower("Adapt|TalPsi", {roll: 6});
		state.onLongRest();
		expect(state.getActiveManifestations()).toHaveLength(0);
		expect(state.getTotalStrain()).toBe(0);
	});
});

describe("Psionic Exertion", () => {
	it("lists only the options the character picked, split by timing", () => {
		const state = makeManifester();
		grantExertion(state, "Shared Power");
		grantExertion(state, "Halting Power");
		expect(state.getKnownExertions().map(e => e.name).sort()).toEqual(["Halting Power", "Shared Power"]);
		expect(state.getKnownExertions({timing: "manifestation"}).map(e => e.name)).toEqual(["Shared Power"]);
		expect(state.getKnownExertions({timing: "outcome"}).map(e => e.name)).toEqual(["Halting Power"]);
	});

	it("prices an order-scaled option off the order actually manifested at", () => {
		const state = makeManifester();
		expect(state.getExertionStrainCost("Shared Power", {powerOrder: 2})).toBe(2);
		expect(state.getExertionStrainCost("Shared Power", {powerOrder: 4})).toBe(4);
		expect(state.getExertionStrainCost("Destructive Power", {powerOrder: 5})).toBe(2);
	});

	it("honours a size-based alternative price", () => {
		const state = makeManifester();
		expect(state.getExertionStrainCost("Halting Power", {powerOrder: 2})).toBe(2);
		expect(state.getExertionStrainCost("Halting Power", {powerOrder: 2, costOverride: 4})).toBe(4);
		// A price the option does not offer is ignored, not trusted.
		expect(state.getExertionStrainCost("Halting Power", {powerOrder: 2, costOverride: 99})).toBe(2);
	});

	it("charges an at-manifestation exertion on top of the test", () => {
		const state = makeManifester();
		grantExertion(state, "Shared Power");
		const res = state.manifestPower("Adapt|TalPsi", {roll: 6, exertion: "Shared Power", track: "mind"});
		expect(res.exertion).toMatchObject({name: "Shared Power", cost: 2, applied: 2});
		expect(state.getStrain().mind).toBe(2);
	});

	it("ignores an outcome-timed exertion passed to the manifest call", () => {
		const state = makeManifester();
		grantExertion(state, "Halting Power");
		const res = state.manifestPower("Adapt|TalPsi", {roll: 6, exertion: "Halting Power"});
		expect(res.exertion).toBeNull();
		expect(state.getTotalStrain()).toBe(0);
	});

	it("applies an outcome exertion to a running manifestation", () => {
		const state = makeManifester();
		const res = state.manifestPower("Adapt|TalPsi", {roll: 6});
		const out = state.applyExertionToManifestation(res.manifestation.id, "Overwhelming Power", {track: "soul"});
		expect(out).toMatchObject({ok: true, name: "Overwhelming Power", cost: 2});
		expect(state.getStrain().soul).toBe(2);
	});

	it("allows only one exertion per manifestation", () => {
		const state = makeManifester();
		const res = state.manifestPower("Adapt|TalPsi", {roll: 6});
		state.applyExertionToManifestation(res.manifestation.id, "Halting Power");
		const second = state.applyExertionToManifestation(res.manifestation.id, "Terrifying Power");
		expect(second).toMatchObject({ok: false, reason: "already-exerted"});
	});

	it("refuses an exertion that would break the strain maximum", () => {
		const state = makeManifester({level: 9});
		const res = state.manifestPower("Adapt|TalPsi", {roll: 6});
		state.addStrain(12, "body"); // max 13
		const out = state.applyExertionToManifestation(res.manifestation.id, "Terrifying Power");
		expect(out).toMatchObject({ok: false, reason: "overflow"});
		expect(state.getTotalStrain()).toBe(12);
	});
});

describe("Strain to Maintain", () => {
	it("quotes the summed order of everything concentrated on", () => {
		const state = makeManifester();
		state.manifestPower("Apparition|TalPsi", {roll: 6}); // 2nd
		state.manifestPower("Aura Projection|TalPsi", {modeName: "Inspired", roll: 6}); // 4th
		const quote = state.payStrainToMaintain({apply: false});
		// Apparition is 1st order but still concentrates, so it costs 1, not nothing.
		expect(quote).toMatchObject({ok: true, cost: 5, applied: 0});
		expect(state.getTotalStrain()).toBe(0);
	});

	it("charges the cost and keeps the powers running", () => {
		const state = makeManifester();
		state.manifestPower("Apparition|TalPsi", {roll: 6});
		const paid = state.payStrainToMaintain({track: "mind"});
		expect(paid).toMatchObject({ok: true, cost: 1, applied: 1});
		expect(state.getStrain().mind).toBe(1);
		expect(state.getPowerConcentrations()).toHaveLength(1);
	});

	it("reports when there is nothing to maintain", () => {
		expect(makeManifester().payStrainToMaintain()).toMatchObject({ok: false, reason: "no-powers"});
	});

	it("refuses to kill the character to maintain a power", () => {
		const state = makeManifester({level: 9});
		state.manifestPower("Aura Projection|TalPsi", {modeName: "Terror", roll: 6});
		state.addStrain(12, "body"); // max 13
		expect(state.payStrainToMaintain()).toMatchObject({ok: false, reason: "overflow", cost: 4});
		expect(state.getTotalStrain()).toBe(12);
	});
});

describe("Strain to Maintain — the original numeric signature still works", () => {
	it("accepts an explicitly supplied summed order", () => {
		const state = makeManifester();
		const res = state.payStrainToMaintain(3, "soul");
		expect(res.applied).toBe(3);
		expect(state.getStrain().soul).toBe(3);
	});

	it("prefers the explicit number over the derived one", () => {
		const state = makeManifester();
		state.manifestPower("Apparition|TalPsi", {roll: 6}); // derives 1
		expect(state.payStrainToMaintain(4, "mind").cost).toBe(4);
	});

	it("returns null for a character with no manifester class", () => {
		const state = new CharacterSheetState();
		state.addClass({name: "Wizard", source: "PHB", level: 5});
		expect(state.payStrainToMaintain()).toBeNull();
	});
});

describe("1st-order powers that still tie up concentration", () => {
	it("manifests with no test but occupies a concentration slot", () => {
		const state = makeManifester();
		const res = state.manifestPower("Apparition|TalPsi");
		expect(res.test.outcome).toBe("automatic");
		expect(state.getTotalStrain()).toBe(0);
		expect(state.getPowerConcentrations().map(c => c.name)).toEqual(["Apparition"]);
	});

	it("raises the manifestation score of the next power all the same", () => {
		const state = makeManifester();
		state.manifestPower("Apparition|TalPsi");
		expect(state.manifestPower("Adapt|TalPsi", {roll: 6}).test.score).toBe(3);
	});
});

// ==========================================
// Acquisition
// ==========================================

describe("per-level power replacement", () => {
	it("is available once per class level", () => {
		const state = makeManifester();
		expect(state.canReplacePower()).toBe(true);
		state.replacePsionicPower("Adapt|TalPsi", POWERS["Again"]);
		expect(state.canReplacePower()).toBe(false);
	});

	it("swaps the power out and the new one in", () => {
		const state = makeManifester();
		const res = state.replacePsionicPower("Adapt|TalPsi", POWERS["Again"]);
		expect(res).toMatchObject({ok: true, outgoing: "Adapt", incoming: "Again"});
		const names = state.getKnownPowers().map(p => p.name);
		expect(names).not.toContain("Adapt");
		expect(names).toContain("Again");
	});

	it("refuses a second swap at the same level but allows one after levelling", () => {
		const state = makeManifester();
		state.replacePsionicPower("Adapt|TalPsi", POWERS["Again"]);
		expect(state.replacePsionicPower("Again|TalPsi", POWERS["Adapt"])).toMatchObject({ok: false, reason: "already-replaced"});
		state.levelUp("Talent");
		expect(state.canReplacePower()).toBe(true);
	});

	it("refuses to swap a 1st-order power, which is a separate fixed pool", () => {
		const state = makeManifester();
		expect(state.replacePsionicPower("Psionic Bolt|TalPsi", POWERS["Again"])).toMatchObject({ok: false, reason: "first-order"});
	});

	it("refuses to trade up to a higher order", () => {
		const state = makeManifester();
		expect(state.replacePsionicPower("Adapt|TalPsi", POWERS["Aura Projection"]))
			.toMatchObject({ok: false, reason: "order-mismatch", maxOrder: 2});
	});

	it("refuses a power already known", () => {
		const state = makeManifester();
		expect(state.replacePsionicPower("Aura Projection|TalPsi", POWERS["Adapt"])).toMatchObject({ok: false, reason: "already-known"});
	});

	it("offers only unknown powers of equal or lower order, minimum 2nd", () => {
		const state = makeManifester();
		const names = state.getPowerReplacementCandidates("Aura Projection|TalPsi").map(p => p.name);
		expect(names).toContain("Again"); // 2nd, unknown
		expect(names).not.toContain("Adapt"); // already known
		expect(names).not.toContain("Apparition"); // 1st order
	});

	it("ends a running manifestation of the power being swapped away", () => {
		const state = makeManifester();
		state.manifestPower("Adapt|TalPsi", {roll: 6});
		state.replacePsionicPower("Adapt|TalPsi", POWERS["Again"]);
		expect(state.getActiveManifestations()).toHaveLength(0);
	});
});

describe("learning from others", () => {
	function learner () {
		const state = makeTalent({level: 9}); // d6 die, max order 4
		learnPower(state, "Adapt");
		return state;
	}

	it("starts a study period when the roll beats the power's baseline order", () => {
		const state = learner();
		const res = state.rollLearnFromOthers(POWERS["Again"], {roll: 6}); // 2nd order
		expect(res).toMatchObject({ok: true, started: true, days: 1});
		expect(state.getPowerLearningProgress()).toMatchObject({name: "Again", daysRequired: 1, daysDone: 0});
	});

	it("uses the RAW study period for the power's order", () => {
		const state = learner();
		state.rollLearnFromOthers(POWERS["Aura Projection"], {roll: 6}); // 4th order → 8 days
		expect(state.getPowerLearningProgress().daysRequired).toBe(8);
	});

	it("locks out further attempts until a long rest when the roll fails", () => {
		const state = learner();
		const res = state.rollLearnFromOthers(POWERS["Again"], {roll: 1});
		expect(res).toMatchObject({ok: true, learned: false});
		expect(res.started).toBeFalsy();
		expect(state.isPowerLearningLockedOut()).toBe(true);
		expect(state.rollLearnFromOthers(POWERS["Aura Projection"], {roll: 6})).toMatchObject({ok: false, reason: "locked-out"});

		state.onLongRest();
		expect(state.isPowerLearningLockedOut()).toBe(false);
	});

	it("treats a roll equal to the baseline order as a failure", () => {
		const state = learner();
		state.rollLearnFromOthers(POWERS["Again"], {roll: 2}); // 2nd order, rolled 2
		expect(state.getPowerLearningProgress()).toBeNull();
		expect(state.isPowerLearningLockedOut()).toBe(true);
	});

	it("refuses a power the character cannot yet manifest, a 1st-order power, or a known one", () => {
		const state = makeTalent({level: 1}); // max order 2
		expect(state.rollLearnFromOthers(POWERS["Aura Projection"], {roll: 6})).toMatchObject({ok: false, reason: "order-too-high"});
		expect(state.rollLearnFromOthers(POWERS["Apparition"], {roll: 6})).toMatchObject({ok: false, reason: "first-order"});
		learnPower(state, "Adapt");
		expect(state.rollLearnFromOthers(POWERS["Adapt"], {roll: 6})).toMatchObject({ok: false, reason: "already-known"});
	});

	it("refuses to study two powers at once", () => {
		const state = learner();
		state.rollLearnFromOthers(POWERS["Again"], {roll: 6});
		expect(state.rollLearnFromOthers(POWERS["Aura Projection"], {roll: 6})).toMatchObject({ok: false, reason: "already-learning"});
	});

	it("teaches the power when the study period completes", () => {
		const state = learner();
		state.rollLearnFromOthers(POWERS["Again"], {roll: 6}); // 1 day
		const res = state.advancePowerLearning();
		expect(res).toMatchObject({ok: true, complete: true, name: "Again"});
		expect(state.getKnownPowers().map(p => p.name)).toContain("Again");
		expect(state.getPowerLearningProgress()).toBeNull();
	});

	it("counts the days without teaching the power early", () => {
		const state = learner();
		state.setPsionicCatalog(fixture.psionic);
		state.rollLearnFromOthers(POWERS["Aura Projection"], {roll: 6}); // 8 days
		for (let i = 0; i < 7; ++i) {
			expect(state.advancePowerLearning().complete).toBe(false);
		}
		expect(state.getKnownPowers().map(p => p.name)).not.toContain("Aura Projection");
		expect(state.advancePowerLearning().complete).toBe(true);
		expect(state.getKnownPowers().map(p => p.name)).toContain("Aura Projection");
	});

	it("abandons a study period, forfeiting the progress", () => {
		const state = learner();
		state.rollLearnFromOthers(POWERS["Aura Projection"], {roll: 6});
		state.advancePowerLearning();
		expect(state.abandonPowerLearning()).toBe(true);
		expect(state.getPowerLearningProgress()).toBeNull();
		expect(state.abandonPowerLearning()).toBe(false);
	});

	it("reports nothing to advance when no study is running", () => {
		expect(learner().advancePowerLearning()).toMatchObject({ok: false, reason: "not-learning"});
	});
});

// ==========================================
// Review follow-ups
// ==========================================

describe("an Exertion that overflowed was never spent", () => {
	it("does not lock out the outcome Exertion when the up-front one could not be paid", () => {
		const state = makeManifester({level: 9}); // strain max 13
		grantExertion(state, "Shared Power");
		state.addStrain(12, "body");

		// Shared Power costs the power's order (2) — 12 + 2 > 13, so it cannot be paid.
		const res = state.manifestPower("Adapt|TalPsi", {roll: 99, exertion: "Shared Power", track: "mind"});
		expect(res.exertion).toMatchObject({name: "Shared Power", applied: 0, overflow: true});
		expect(state.getTotalStrain()).toBe(12);
		// The manifestation must NOT be marked as having spent an Exertion.
		expect(res.manifestation.exertionUsed).toBeNull();
	});

	it("still records an Exertion that was actually paid", () => {
		const state = makeManifester();
		grantExertion(state, "Shared Power");
		const res = state.manifestPower("Adapt|TalPsi", {roll: 99, exertion: "Shared Power", track: "mind"});
		expect(res.manifestation.exertionUsed).toBe("Shared Power");
	});
});

describe("re-manifesting into a mode that does not concentrate", () => {
	it("releases the concentration slot the previous manifestation held", () => {
		// Deep-copy the catalog: this test mutates a power's modes, and the fixture is
		// shared across the whole file.
		const catalog = JSON.parse(JSON.stringify(fixture.psionic));
		const state = makeTalent({level: 9});
		state.setPsionicCatalog(catalog);
		learnPower(state, "Adapt");
		learnPower(state, "Aura Projection");

		// Aura Projection concentrates in every variant mode…
		state.manifestPower("Aura Projection|TalPsi", {modeName: "Terror", roll: 99});
		expect(state.getPowerConcentrations()).toHaveLength(1);

		// …but a homebrew-shaped re-manifest resolving to no concentration must not
		// leave the slot occupied, or it inflates every later manifestation score.
		const entity = catalog.find(p => p.name === "Aura Projection");
		entity.modes = entity.modes.map(m => ({...m, concentration: null}));
		CharacterSheetClassUtils._psionicParseCache.delete(entity);

		state.manifestPower("Aura Projection|TalPsi", {modeName: "Terror", roll: 99});
		expect(state.getPowerConcentrations()).toHaveLength(0);
		expect(state.manifestPower("Adapt|TalPsi", {roll: 99}).test.score).toBe(2);
	});
});

describe("getConcentrationLabel — the single-slot surfaces name everything they end", () => {
	it("names one power", () => {
		const state = makeManifester();
		state.manifestPower("Apparition|TalPsi");
		expect(state.getConcentrationLabel()).toBe("Apparition");
	});

	it("names all of them, because breaking concentration ends all of them", () => {
		const state = makeManifester();
		state.manifestPower("Apparition|TalPsi");
		state.manifestPower("Aura Projection|TalPsi", {modeName: "Terror", roll: 99});
		expect(state.getConcentrationLabel()).toBe("Apparition and Aura Projection");
	});

	it("is empty when nothing is being concentrated on", () => {
		expect(makeManifester().getConcentrationLabel()).toBe("");
	});
});
