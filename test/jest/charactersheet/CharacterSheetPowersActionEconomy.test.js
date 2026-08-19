/**
 * Psionic powers in the Combat tab's Action Economy.
 *
 * Powers live in `_data.features`, so `_isActionEconomyFeature` has always admitted them —
 * the panel showed them long before the Powers tab existed. What it could not do was cost
 * them correctly: `_classifyFeatureActionType` regexed the whole body, so a power whose
 * *effect* mentions a reaction was filed as one, and a ten-minute ritual was offered as
 * something you could do this turn. See CS-BUG-165.
 */
import fs from "fs";
import path from "path";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

import fixture from "./fixtures/psionic-powers-talpsi.json";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

/** A power shaped like the real data, so the parser does the real work. */
function makePower ({name, order, type = "TK", manifestationTime, range = "60 feet", duration = null, modes = []}) {
	return {
		name,
		source: "TalPsi",
		type,
		order,
		entries: [
			`{@b Manifestation Time:} ${manifestationTime}`,
			`{@b Range:} ${range}`,
			...(duration ? [`{@b Duration:} ${duration}`] : []),
			// The body is where the old regex went wrong: it mentions a reaction and a
			// bonus action without the power costing either.
			"You may take a reaction to gloat, or spend a bonus action admiring the result.",
		],
		modes,
	};
}

function makeTalent (powers) {
	const state = new CharacterSheetState();
	state.addClass({name: "Talent", source: "TalPsi", level: 9});
	state.setAbilityBase("int", 18);
	state.setMaxHp(40);
	state.setCurrentHp(40);
	state.setPsionicCatalog(powers);
	for (const p of powers) state.learnPsionicPower(p);

	const combat = Object.create(CharacterSheetCombat.prototype);
	combat._state = state;
	return {state, combat};
}

describe("CS-BUG-165 — powers are costed from their manifestation time, not their prose", () => {
	it("files a 1-action power under Action even when its body mentions a reaction", () => {
		const power = makePower({name: "Beam Gaze", order: "3rd-Order", manifestationTime: "1 action"});
		const {state, combat} = makeTalent([power]);
		const feature = state.getFeatures().find(f => f.name === "Beam Gaze");
		expect(combat._classifyFeatureActionType(feature)).toBe("action");
	});

	it("files a real reaction power under Reaction", () => {
		const power = makePower({
			name: "Again",
			order: "2nd-Order",
			manifestationTime: "1 reaction, which you take when you or a creature within 30 feet of you misses with an attack",
		});
		const {state, combat} = makeTalent([power]);
		const feature = state.getFeatures().find(f => f.name === "Again");
		expect(combat._classifyFeatureActionType(feature)).toBe("reaction");
	});

	it("files a real bonus-action power under Bonus", () => {
		const power = makePower({name: "Quickstep", order: "2nd-Order", manifestationTime: "1 bonus action"});
		const {state, combat} = makeTalent([power]);
		const feature = state.getFeatures().find(f => f.name === "Quickstep");
		expect(combat._classifyFeatureActionType(feature)).toBe("bonus");
	});

	it("marks a power that takes minutes as long, not as an action", () => {
		const power = makePower({name: "Fold Space", order: "5th-Order", manifestationTime: "10 minutes"});
		const {state, combat} = makeTalent([power]);
		const feature = state.getFeatures().find(f => f.name === "Fold Space");
		expect(combat._classifyFeatureActionType(feature)).toBe("long");
	});

	it("leaves a non-power feature to the text heuristic", () => {
		const {state, combat} = makeTalent([]);
		state.addFeature({name: "Second Wind", level: 1, className: "Fighter", source: "PHB", description: "As a bonus action, you regain hit points."});
		const feature = state.getFeatures().find(f => f.name === "Second Wind");
		expect(combat._classifyPsionicPowerActionType(feature)).toBeNull();
		expect(combat._classifyFeatureActionType(feature)).toBe("bonus");
	});
});

describe("powers in the action-economy buckets", () => {
	function buildEconomy (powers) {
		const {state, combat} = makeTalent(powers);
		// The other five sources are irrelevant here and each needs its own fixtures.
		state.getAttacks = () => [];
		state.getItems = () => [];
		state.getSpells = () => [];
		state.getCustomAbilities = () => [];
		state.getItemPowers = () => [];
		return combat.getCombatActionEconomy();
	}

	it("puts each power in the bucket its manifestation time names", () => {
		const buckets = buildEconomy([
			makePower({name: "Beam Gaze", order: "3rd-Order", manifestationTime: "1 action"}),
			makePower({name: "Again", order: "2nd-Order", manifestationTime: "1 reaction, which you take when attacked"}),
			makePower({name: "Quickstep", order: "2nd-Order", manifestationTime: "1 bonus action"}),
		]);
		expect(buckets.action.map(e => e.name)).toContain("Beam Gaze");
		expect(buckets.reaction.map(e => e.name)).toContain("Again");
		expect(buckets.bonus.map(e => e.name)).toContain("Quickstep");
	});

	it("keeps a ten-minute power out of the turn entirely", () => {
		const buckets = buildEconomy([makePower({name: "Fold Space", order: "5th-Order", manifestationTime: "10 minutes"})]);
		const all = [...buckets.action, ...buckets.bonus, ...buckets.reaction].map(e => e.name);
		expect(all).not.toContain("Fold Space");
	});

	it("labels a power as a power, not as a generic feature", () => {
		const buckets = buildEconomy([makePower({name: "Beam Gaze", order: "3rd-Order", manifestationTime: "1 action"})]);
		const row = buckets.action.find(e => e.name === "Beam Gaze");
		expect(row.kind).toBe("power");
		expect(row.source).toBe("Power");
	});

	it("states the strain a failed manifestation costs instead of leaking an internal code", () => {
		const buckets = buildEconomy([makePower({name: "Beam Gaze", order: "3rd-Order", manifestationTime: "1 action"})]);
		const row = buckets.action.find(e => e.name === "Beam Gaze");
		expect(row.subtitle).toContain("3 strain");
		expect(row.subtitle).not.toMatch(/PsiP/);
		// The discipline moved to the title in CS-BUG-169: it is taxonomy, and it was
		// crowding the name out of a 250px column.
		expect(row.subtitleTitle).toContain("Telekinesis");
	});

	it("says at will for a 1st-order power rather than quoting a strain cost", () => {
		const buckets = buildEconomy([makePower({name: "Psionic Bolt", order: "1st-Order", type: "RP", manifestationTime: "1 action"})]);
		const row = buckets.action.find(e => e.name === "Psionic Bolt");
		expect(row.subtitle).toContain("at will");
		expect(row.subtitle).not.toContain("strain");
	});

	it("flags a power that will tie up concentration", () => {
		const buckets = buildEconomy([
			makePower({
				name: "Apparition",
				order: "2nd-Order",
				manifestationTime: "1 action",
				modes: [{name: "2nd-Order", concentration: {duration: 1, unit: "min"}, entries: ["…"]}],
			}),
		]);
		// Carried as a bounded flag rather than prose, so a long name can never truncate it
		// away (CS-BUG-169).
		const row = buckets.action.find(e => e.name === "Apparition");
		expect(row.flag).toEqual({glyph: "⏳", label: "Concentration"});
		expect(row.subtitleTitle).toContain("Concentration");
	});
});

describe("CS-BUG-166 — an entries-only power still reaches the activation pipeline", () => {
	it("detects a learned power as activatable even though it has no rendered description", () => {
		// Powers carry their mechanics in `entries`. `detectActivatableFeature` bails early
		// on a feature with no `description` unless it recognises a marker, and psionic
		// powers were not in that list — so the psionic detector was unreachable for every
		// power learned through the normal path.
		const power = makePower({name: "Adapt", order: "2nd-Order", type: "MM", manifestationTime: "1 action"});
		const {state} = makeTalent([power]);
		const feature = state.getFeatures().find(f => f.name === "Adapt");

		expect(feature.description).toBeFalsy();
		expect(feature.entries?.length).toBeGreaterThan(0);
		const info = CharacterSheetState.detectActivatableFeature(feature);
		expect(info).toBeTruthy();
		expect(info.isPsionicPower).toBe(true);
		expect(info.psionicOrder).toBe(2);
		expect(info.requiresManifestationTest).toBe(true);
	});

	it("puts that power into the action-economy buckets, which is what the gate blocked", () => {
		const power = makePower({name: "Adapt", order: "2nd-Order", type: "MM", manifestationTime: "1 action"});
		const {state, combat} = makeTalent([power]);
		state.getAttacks = () => [];
		state.getItems = () => [];
		state.getSpells = () => [];
		state.getCustomAbilities = () => [];
		state.getItemPowers = () => [];
		expect(combat.getCombatActionEconomy().action.map(e => e.name)).toContain("Adapt");
	});

	it("does not promote an unrelated entries-only feature", () => {
		const {state} = makeTalent([]);
		state.addFeature({name: "Some Lore", level: 1, className: "Talent", source: "TalPsi", entries: ["Purely descriptive text."]});
		const feature = state.getFeatures().find(f => f.name === "Some Lore");
		expect(CharacterSheetState.detectActivatableFeature(feature)).toBeNull();
	});
});

describe("the real TalPsi catalog", () => {
	it("costs every fixture power from its header", () => {
		const {state, combat} = makeTalent(fixture.psionic);
		for (const power of state.getKnownPowers()) {
			const feature = state.getFeatures().find(f => f.name === power.name);
			expect(combat._classifyFeatureActionType(feature)).toBe(power.meta.actionType);
		}
	});
});

/**
 * CS-BUG-169. The Action Economy column is ~250px wide and the row put a floorless,
 * shrinkable name beside an unshrinkable subtitle, so flexbox resolved every overflow by
 * deleting the name. A power rendered as a bare "3rd-order · 3 strain on a failure ·
 * Metamorphosis" with no name at all.
 */
describe("CS-BUG-169 — the row keeps its name", () => {
	const conc = name => makePower({
		name, order: "4th-Order", manifestationTime: "1 action", duration: "Concentration, up to 1 minute",
	});

	it("says the order and the strain in a form that fits beside a name", () => {
		const {state, combat} = makeTalent([makePower({name: "Adapt", order: "2nd-Order", manifestationTime: "1 action"})]);
		const sub = combat._psionicEconomySubtitle(state.getKnownPowers()[0]);
		expect(sub).toBe("2nd · 2 strain");
	});

	it("drops the discipline, which was the longest segment and is on the hover card", () => {
		const power = makePower({name: "Adapt", order: "2nd-Order", manifestationTime: "1 action", type: "MM"});
		const {state, combat} = makeTalent([power]);
		const known = state.getKnownPowers()[0];
		expect(known.disciplineLabel).toBeTruthy();
		expect(combat._psionicEconomySubtitle(known)).not.toContain(known.disciplineLabel);
	});

	it("keeps concentration out of the prose so it cannot be truncated away", () => {
		const {state, combat} = makeTalent([conc("Aura Projection")]);
		const known = state.getKnownPowers()[0];
		expect(known.concentrates).toBe(true);
		expect(combat._psionicEconomySubtitle(known)).not.toMatch(/concentrat/i);
	});

	it("still says 'at will' for a 1st-order power", () => {
		const {state, combat} = makeTalent([makePower({name: "Mind Bar", order: "1st-Order", manifestationTime: "1 action"})]);
		expect(combat._psionicEconomySubtitle(state.getKnownPowers()[0])).toBe("at will");
	});

	it("carries the unabbreviated wording in the title, so truncation loses nothing", () => {
		const {state, combat} = makeTalent([conc("Aura Projection")]);
		const known = state.getKnownPowers()[0];
		const title = combat._psionicEconomyTitle(known);
		expect(title).toContain("manifestation test fails");
		expect(title).toContain(known.disciplineLabel);
		expect(title).toContain("Concentration");
	});

	it("emits concentration as a bounded flag rather than more prose", () => {
		const {state, combat} = makeTalent([conc("Aura Projection")]);
		const entry = combat.getCombatActionEconomy().action.find(e => e.kind === "power");
		expect(entry.flag).toEqual({glyph: "⏳", label: "Concentration"});
	});

	it("gives a non-concentration power no flag at all", () => {
		const {state, combat} = makeTalent([makePower({name: "Adapt", order: "2nd-Order", manifestationTime: "1 action"})]);
		const entry = combat.getCombatActionEconomy().action.find(e => e.kind === "power");
		expect(entry.flag).toBeNull();
	});
});

/**
 * The layout rule itself. These assert the shape of the fix rather than a rendered pixel,
 * because the defect was a CSS declaration and jsdom does not do flexbox.
 */
describe("CS-BUG-169 — the layout rule that caused it", () => {
	const css = fs.readFileSync(path.resolve(process.cwd(), "css/charactersheet.css"), "utf8");
	const rule = sel => {
		const at = css.indexOf(`${sel} {`);
		return at === -1 ? "" : css.slice(at, css.indexOf("}", at));
	};

	it("gives the name a floor so it can never be crushed to nothing", () => {
		const name = rule(".cs-combat-action-economy__name");
		expect(name).toMatch(/min-width:\s*[\d.]+rem/);
		expect(name).not.toMatch(/min-width:\s*0/);
	});

	it("lets the subtitle shrink and ellipsize instead of holding the row hostage", () => {
		const sub = rule(".cs-combat-action-economy__sub");
		expect(sub).toContain("flex: 0 1 auto");
		expect(sub).toContain("text-overflow: ellipsis");
		expect(sub).not.toContain("flex: 0 0 auto");
	});

	it("keeps the flag unshrinkable — it is one glyph and cannot grow with content", () => {
		expect(rule(".cs-combat-action-economy__flag")).toContain("flex: 0 0 auto");
	});
});
