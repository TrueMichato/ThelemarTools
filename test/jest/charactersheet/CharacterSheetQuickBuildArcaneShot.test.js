import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-quickbuild.js";

const CharacterSheetQuickBuild = globalThis.CharacterSheetQuickBuild;

/**
 * Bug #6 — Arcane Shot options not choosable during QuickBuild.
 *
 * Root cause: the wizard analysed all levels ONCE upfront (before the subclass
 * step), so `_getSubclassForClass` returned null and the subclass's
 * `optionalfeatureProgression` (Arcane Shot, featureType "AS") never merged into
 * the analysis — the "Class Options" step was never created for an official
 * Fighter. Fix: resolve the freshly-selected subclass during analysis and rebuild
 * the wizard after the subclass step, navigating by canonical step ID (the
 * subclass step is removed once chosen, so raw index +1 would skip a step).
 */
describe("QuickBuild Arcane Shot surfacing (Bug #6)", () => {
	const arcaneArcher = {
		name: "Arcane Archer",
		source: "XGE",
		// Marks it as "already full" so resolveFullSubclass returns it unchanged.
		subclassFeatures: [],
		optionalfeatureProgression: [
			{name: "Arcane Shots", featureType: ["AS"], progression: {3: 2, 7: 3, 10: 4, 15: 5, 18: 6}},
		],
	};

	const fighter = {
		name: "Fighter",
		source: "PHB",
		// Official Fighter has NO class-level optionalfeatureProgression.
		subclasses: [arcaneArcher],
	};

	function makeQuickBuild ({subclasses = {}} = {}) {
		const qb = Object.create(CharacterSheetQuickBuild.prototype);
		qb._state = {getFeatures: () => [], getClasses: () => []};
		qb._page = {getClasses: () => [fighter]};
		qb._selections = {subclasses, optionalFeatures: {}};
		return qb;
	}

	it("no AS gain at L3 before a subclass is selected", () => {
		const qb = makeQuickBuild();
		const subclass = qb._getSubclassForClass("Fighter", "PHB", 3); // null
		const gains = qb._getOptionalFeatureGains(fighter, 3, {}, subclass);
		expect(gains.find(g => g.featureTypes.includes("AS"))).toBeUndefined();
	});

	it("AS gain (2 shots) appears at L3 once Arcane Archer is selected", () => {
		const qb = makeQuickBuild({subclasses: {Fighter_PHB: arcaneArcher}});
		const subclass = qb._resolveSubclassFull(
			qb._getSubclassForClass("Fighter", "PHB", 3), "Fighter", "PHB",
		);
		const gains = qb._getOptionalFeatureGains(fighter, 3, {}, subclass);
		const as = gains.find(g => g.featureTypes.includes("AS"));
		expect(as).toBeTruthy();
		expect(as.totalCount).toBe(2);
		expect(as.newCount).toBe(2);
	});

	it("_resolveSubclassFull resolves a shallow {name,source} ref to the full subclass", () => {
		const qb = makeQuickBuild();
		const shallow = {name: "Arcane Archer", source: "XGE"};
		const full = qb._resolveSubclassFull(shallow, "Fighter", "PHB");
		expect(full.optionalfeatureProgression).toBeTruthy();
		expect(full.optionalfeatureProgression[0].featureType).toContain("AS");
	});

	// ---- Step navigation after rebuild (canonical-order advance) ----

	it("_advanceAfterRebuild skips no step when the subclass step is removed", () => {
		const qb = makeQuickBuild();
		const visited = [];
		qb._goToStep = (i) => visited.push(qb._steps[i].id);
		// Subclass chosen -> subclass step gone; asi + new optfeatures appear.
		qb._steps = [
			{id: "target"}, {id: "asi"}, {id: "optfeatures"}, {id: "hp"}, {id: "review"},
		];
		qb._advanceAfterRebuild("subclass");
		// Must land on asi (the first canonical step after subclass), not skip to optfeatures.
		expect(visited).toEqual(["asi"]);
	});

	it("_advanceAfterRebuild returns to the subclass step if more subclasses remain (multiclass)", () => {
		const qb = makeQuickBuild();
		const visited = [];
		qb._goToStep = (i) => visited.push(qb._steps[i].id);
		qb._steps = [
			{id: "target"}, {id: "subclass"}, {id: "asi"}, {id: "hp"}, {id: "review"},
		];
		qb._advanceAfterRebuild("subclass");
		expect(visited).toEqual(["subclass"]);
	});

	it("_pruneStaleOptionalFeatureSelections drops keys not offered by the current analysis", () => {
		const qb = makeQuickBuild();
		qb._selections.optionalFeatures = {AS: [{name: "Grasping Arrow"}], "MV:B": [{name: "Riposte"}]};
		qb._levelAnalysis = [
			{optionalFeatureGains: [{featureTypes: ["AS"], newCount: 2}]},
		];
		qb._pruneStaleOptionalFeatureSelections();
		expect(qb._selections.optionalFeatures.AS).toBeTruthy();
		expect(qb._selections.optionalFeatures["MV:B"]).toBeUndefined();
	});

	// ---- Integration: _nextStep wires the rebuild after the subclass step ----

	it("_nextStep rebuilds after the subclass step and lands on the freshly-added optfeatures step", async () => {
		const qb = makeQuickBuild({subclasses: {Fighter_PHB: arcaneArcher}});
		// Pre-subclass step layout: an Arcane Archer has no Class Options step yet.
		qb._steps = [
			{id: "target"}, {id: "subclass"}, {id: "hp"}, {id: "review"},
		];
		qb._currentStep = 1; // on the subclass step
		qb._isApplying = false;
		qb._renderStepIndicators = () => {};
		qb._renderCurrentStep = () => {};
		// Simulate the real rebuild: selecting the subclass removes the subclass step
		// and surfaces the Class Options ("optfeatures") step its AS progression grants.
		let rebuilt = 0;
		qb._buildWizardSteps = () => {
			rebuilt++;
			qb._steps = [
				{id: "target"}, {id: "optfeatures"}, {id: "hp"}, {id: "review"},
			];
		};
		qb._levelAnalysis = [{optionalFeatureGains: [{featureTypes: ["AS"], newCount: 2}]}];

		await qb._nextStep();

		expect(rebuilt).toBe(1);
		// Landed on the optfeatures step (canonical order after "subclass"), NOT skipped.
		expect(qb._steps[qb._currentStep].id).toBe("optfeatures");
	});
});
