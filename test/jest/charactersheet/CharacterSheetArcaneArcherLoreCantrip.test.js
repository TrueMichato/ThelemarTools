import "./setup.js";

let CharacterSheetState;

beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

/**
 * Bug #5 — Arcane Archer "Arcane Archer Lore" must grant ONLY the chosen cantrip.
 *
 * Root cause: the official Arcane Archer SUBCLASS (class-fighter.json) carries
 * `additionalSpells` with TWO `known` cantrip blocks (prestidigitation, druidcraft).
 * `getSubclassAlwaysPreparedSpells` / `populateSubclassSpells` granted BOTH, while
 * the Lore feature prose ALSO queues a "presti OR druidcraft" choice — so both were
 * granted regardless of the player's pick. Fix: a subclass-scoped, order-independent
 * dedupe that suppresses the always-prepared copies of any cantrip a feature CHOICE
 * of the same subclass owns, leaving only the chosen cantrip (added separately by
 * fulfillFeatureChoice).
 */
describe("Arcane Archer Lore cantrip dedupe (Bug #5)", () => {
	const LORE_TEXT = "At 3rd level, you choose to gain proficiency in either the {@skill Arcana} or the {@skill Nature} skill, and you choose to learn either the {@spell prestidigitation} or the {@spell druidcraft} cantrip.";

	const makeLoreFeature = () => ({
		name: "Arcane Archer Lore",
		source: "XGE",
		subclassShortName: "Arcane Archer",
		isSubclassFeature: true,
		entries: [LORE_TEXT],
	});

	const makeArcaneArcherCls = () => ({
		name: "Fighter",
		source: "PHB",
		level: 3,
		subclass: {
			name: "Arcane Archer",
			shortName: "Arcane Archer",
			source: "XGE",
			additionalSpells: [
				{known: {3: ["prestidigitation#c"]}},
				{known: {3: ["druidcraft#c"]}},
			],
		},
	});

	function cantripNames (spells) {
		return spells.filter(s => s.isCantrip).map(s => String(s.name).toLowerCase()).sort();
	}

	it("helper collects BOTH option cantrips claimed by the Lore choice", () => {
		const state = new CharacterSheetState();
		state._data.features = [makeLoreFeature()];
		const claimed = state._getCantripNamesClaimedBySubclassFeatureChoices(makeArcaneArcherCls().subclass);
		expect([...claimed].sort()).toEqual(["druidcraft", "prestidigitation"]);
	});

	it("helper is scoped to THIS subclass — unrelated subclass features don't claim", () => {
		const state = new CharacterSheetState();
		state._data.features = [{...makeLoreFeature(), subclassShortName: "Gloom Stalker"}];
		const claimed = state._getCantripNamesClaimedBySubclassFeatureChoices(makeArcaneArcherCls().subclass);
		expect(claimed.size).toBe(0);
	});

	it("control: WITHOUT the Lore feature, the subclass auto-grants BOTH cantrips", () => {
		const state = new CharacterSheetState();
		state._data.features = [];
		const spells = state.getSubclassAlwaysPreparedSpells(makeArcaneArcherCls());
		expect(cantripNames(spells)).toEqual(["druidcraft", "prestidigitation"]);
	});

	it("with the Lore feature present, the subclass auto-grants NEITHER cantrip", () => {
		const state = new CharacterSheetState();
		state._data.features = [makeLoreFeature()];
		const spells = state.getSubclassAlwaysPreparedSpells(makeArcaneArcherCls());
		expect(cantripNames(spells)).toEqual([]);
	});

	it("populateSubclassSpells removes a stale auto-granted cantrip but keeps the chosen one", () => {
		const state = new CharacterSheetState();
		state._data.classes = [makeArcaneArcherCls()];
		state._data.features = [makeLoreFeature()];
		// Simulate the stale ordering: the subclass already auto-granted BOTH cantrips
		// (sourceFeature "Arcane Archer Spells"), and the player later chose prestidigitation
		// (added by fulfillFeatureChoice with sourceFeature = the feature name).
		state._data.spellcasting.cantripsKnown = [
			{name: "Prestidigitation", source: "PHB", isCantrip: true, sourceFeature: "Arcane Archer Spells"},
			{name: "Druidcraft", source: "PHB", isCantrip: true, sourceFeature: "Arcane Archer Spells"},
			{name: "Prestidigitation", source: "PHB", isCantrip: true, sourceFeature: "Arcane Archer Lore"},
		];

		state.populateSubclassSpells();

		const names = state._data.spellcasting.cantripsKnown.map(c => `${c.name}|${c.sourceFeature}`);
		// Both auto-granted copies are gone; only the player's chosen cantrip remains.
		expect(names).toContain("Prestidigitation|Arcane Archer Lore");
		expect(names).not.toContain("Prestidigitation|Arcane Archer Spells");
		expect(names).not.toContain("Druidcraft|Arcane Archer Spells");
		// Net: exactly one cantrip from this subclass, and it's the chosen one.
		const aaCantrips = state._data.spellcasting.cantripsKnown.filter(c => /Arcane Archer/.test(c.sourceFeature || ""));
		expect(aaCantrips.map(c => c.name)).toEqual(["Prestidigitation"]);
	});

	it("choosing druidcraft instead keeps druidcraft and drops the prestidigitation auto-grant", () => {
		const state = new CharacterSheetState();
		state._data.classes = [makeArcaneArcherCls()];
		state._data.features = [makeLoreFeature()];
		state._data.spellcasting.cantripsKnown = [
			{name: "Prestidigitation", source: "PHB", isCantrip: true, sourceFeature: "Arcane Archer Spells"},
			{name: "Druidcraft", source: "PHB", isCantrip: true, sourceFeature: "Arcane Archer Spells"},
			{name: "Druidcraft", source: "PHB", isCantrip: true, sourceFeature: "Arcane Archer Lore"},
		];

		state.populateSubclassSpells();

		const aaCantrips = state._data.spellcasting.cantripsKnown.filter(c => /Arcane Archer/.test(c.sourceFeature || ""));
		expect(aaCantrips.map(c => c.name)).toEqual(["Druidcraft"]);
	});
});
