import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetCombat = globalThis.CharacterSheetCombat;

/**
 * (S1) renderCombatActions must surface features the sheet classifies as activatable
 * ABILITIES — keyed on the genuine classification (`FEATURE_CLASSIFICATION_OVERRIDES`
 * === "ability" OR a resolved `_getActivatableAbilityForFeature` entry) — not just on the
 * fragile hardcoded `combatKeywords` roster. Previously Purge Toxins / Guided Strike /
 * Forked Tongue (no hardcoded keyword) were dropped while Healing Hands surfaced only by
 * accident of being hardcoded.
 *
 * Live (browser) before/after for the real Illrigger build is recorded in the session
 * report; the jest string-DOM mock can't fire mouseover, so the hover assertions are
 * covered there. This test drives the actual renderCombatActions filter and asserts the
 * exact set of features that get rendered.
 */
describe("S1 — renderCombatActions surfaces classified activatable abilities", () => {
	let combat;
	let rendered;
	let activatableNames;

	const makeContainer = () => ({
		style: {},
		innerHTML: "",
		_children: [],
		append (...kids) { this._children.push(...kids); },
	});

	const runFilter = (features) => {
		rendered = [];
		const container = makeContainer();
		const section = makeContainer();
		const prevDoc = globalThis.document;
		globalThis.document = {
			getElementById: (id) => {
				if (id === "charsheet-combat-actions") return container;
				if (id === "charsheet-combat-actions-section") return section;
				return null;
			},
		};
		try {
			combat._state = {
				getFeatures: () => features,
				getCustomAbilities: () => [],
				getFeatureCalculations: () => ({}),
			};
			combat.renderCombatActions();
		} finally {
			globalThis.document = prevDoc;
		}
		return rendered;
	};

	beforeEach(() => {
		combat = Object.create(CharacterSheetCombat.prototype);
		activatableNames = new Set();
		combat._page = {
			// Mirror charactersheet.js: returns a truthy entry only for classified
			// limited-use abilities / interdict boons.
			_getActivatableAbilityForFeature: (f) => (activatableNames.has((f.name || "").toLowerCase()) ? {feature: f} : null),
		};
		// Capture which features survive the filter without needing real DOM elements.
		combat._createCombatActionElement = (f) => { rendered.push(f.name); return makeContainer(); };
		combat._createCustomAbilityElement = () => makeContainer();
	});

	it("includes a feature classified 'ability' via FEATURE_CLASSIFICATION_OVERRIDES (Purge Toxins) even without a hardcoded keyword", () => {
		// "purge toxins" is a real override === "ability"
		const feats = [
			{name: "Purge Toxins", featureType: "Class", description: "You gain resistance to poison damage. As an action you can spend 2 stamina to end one poison affecting you."},
		];
		const out = runFilter(feats);
		expect(out).toContain("Purge Toxins");
	});

	it("includes a feature resolved by _getActivatableAbilityForFeature even with no action-economy keyword in its text (Guided Strike)", () => {
		activatableNames.add("guided strike");
		const feats = [
			{name: "Guided Strike", featureType: "Species", description: "You gain a +10 bonus to the roll."},
		];
		const out = runFilter(feats);
		expect(out).toContain("Guided Strike");
	});

	it("does NOT surface a passive feature that merely has descriptive text but no ability classification", () => {
		const feats = [
			{name: "Sixth Sense", featureType: "Class", description: "You have advantage on Wisdom (Perception) checks that rely on hearing."},
		];
		const out = runFilter(feats);
		expect(out).not.toContain("Sixth Sense");
	});

	it("still excludes metamagic-typed features even when classified as an activatable ability", () => {
		activatableNames.add("twinned spell");
		const feats = [
			{name: "Twinned Spell", featureType: "Optional Feature", optionalFeatureTypes: ["MM"], description: "As an action, spend sorcery points to target a second creature."},
		];
		const out = runFilter(feats);
		expect(out).not.toContain("Twinned Spell");
	});

	it("still excludes panel-managed features (Baleful Interdict) even though they carry an 'ability' override", () => {
		// "baleful interdict" override === "ability" but isInterdictionManagedFeature → hidden.
		const feats = [
			{name: "Baleful Interdict", featureType: "Class", description: "Place a seal on a creature you can see."},
		];
		const out = runFilter(feats);
		expect(out).not.toContain("Baleful Interdict");
	});

	it("surfaces the full Illrigger/Hochling ability set together (Purge Toxins, Guided Strike, Forked Tongue) and keeps an existing keyword ability (Healing Hands)", () => {
		activatableNames.add("guided strike");
		activatableNames.add("healing hands");
		// purge toxins + forked tongue resolve via the override; guided strike + healing
		// hands via the activatable-entry resolver.
		const feats = [
			{name: "Purge Toxins", featureType: "Class", description: "Resistance to poison; spend 2 stamina to end one poison."},
			{name: "Forked Tongue", featureType: "Class", description: "You can instinctively speak, read, and write Infernal."},
			{name: "Guided Strike", featureType: "Species", description: "You gain a +10 bonus to the roll."},
			{name: "Healing Hands", featureType: "Species", description: "As an action you touch a creature and restore hit points."},
		];
		const out = runFilter(feats);
		expect(out).toEqual(expect.arrayContaining(["Purge Toxins", "Forked Tongue", "Guided Strike", "Healing Hands"]));
	});
});
