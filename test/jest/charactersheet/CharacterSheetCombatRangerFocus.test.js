/**
 * TGTT Ranger round 3 — Bug 3 (granted combat-method attribution / hover) and
 * Bug 4 (Primal Focus on the Combat tab) mechanics.
 *
 * These verify the data-level guarantees the UI relies on, NOT level counts:
 *   - Auto-granted combat methods are identified by isCombatMethod (so the Features
 *     renderer buckets them into the tradition group and the page hover branch routes
 *     them to the Combat Methods page).
 *   - The combat-method hover hash is built through UrlUtil.URL_TO_HASH_BUILDER for the
 *     Combat Methods page (troubleshooting J8 — never an inline hash), so the tooltip
 *     resolves instead of 404-ing.
 *   - getMethodTraditionName surfaces the tradition for attribution.
 *   - The Combat-tab focus switch consumes a Focus Switch and flips the mode, and the
 *     focus-gating predicate reflects the active mode.
 *   - getPrimalFocusModeAbilities is gated by the level upgrades the combat block reads.
 */

import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-features.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetFeatures = globalThis.CharacterSheetFeatures;
const UrlUtil = globalThis.UrlUtil;

const SINGULAR_FOCUS = {
	name: "Singular Focus",
	source: "TGTT",
	tradition: "Unerring Hawk",
	degree: 3,
	staminaCost: 2,
	actionType: "bonus action",
	_entityType: "combatMethod",
	requiresFocus: "predator",
	_autoGranted: true,
	entries: ["Choose a creature you can see; your attacks against it ignore disadvantage."],
};

const GROUNDSHATTER = {
	name: "Groundshatter",
	source: "TGTT",
	tradition: "Arcane Knight",
	degree: 3,
	staminaCost: 3,
	actionType: "action",
	_entityType: "combatMethod",
	requiresFocus: "prey",
	_autoGranted: true,
	entries: ["Strike a surface; a 50-foot line becomes difficult terrain."],
};

describe("Bug 3 — granted combat-method attribution & hover", () => {
	it("identifies an auto-granted combat method via isCombatMethod (drives bucketing + hover routing)", () => {
		expect(CharacterSheetClassUtils.isCombatMethod(SINGULAR_FOCUS)).toBe(true);
		expect(CharacterSheetClassUtils.isCombatMethod(GROUNDSHATTER)).toBe(true);
	});

	it("does NOT misclassify an ordinary class feature as a combat method", () => {
		const ordinary = {name: "Extra Attack", className: "Ranger", classSource: "TGTT", featureType: "Class"};
		expect(CharacterSheetClassUtils.isCombatMethod(ordinary)).toBe(false);
	});

	it("builds the combat-method hover hash through URL_TO_HASH_BUILDER for the Combat Methods page (J8)", () => {
		const builder = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_COMBAT_METHODS];
		expect(typeof builder).toBe("function");

		const hash = builder({name: SINGULAR_FOCUS.name, source: SINGULAR_FOCUS.source});
		// Generic name_source hash, lower-cased + URL-encoded
		expect(hash).toBe(`${UrlUtil.encodeForHash(SINGULAR_FOCUS.name)}_${SINGULAR_FOCUS.source}`.toLowerCase());
		expect(hash).toContain("singular");
		expect(hash).toContain("tgtt");
	});

	it("surfaces the combat tradition for attribution", () => {
		expect(CharacterSheetClassUtils.getMethodTraditionName(SINGULAR_FOCUS)).toBe("Unerring Hawk");
		expect(CharacterSheetClassUtils.getMethodTraditionName(GROUNDSHATTER)).toBe("Arcane Knight");
	});

	describe("partitionClassFeaturesForDisplay (Features-tab bucketing)", () => {
		const standalone = {name: "Colossus Slayer", featureType: "Class", className: "Ranger"};
		const specialty = {name: "Some Specialty", parentFeature: "Specialties", className: "Fighter"};
		const optionalMethod = {name: "Perceptive Stance", featureType: "Optional Feature", optionalFeatureTypes: ["CTM:1"], tradition: "Razor's Edge", _entityType: "combatMethod"};

		it("diverts auto-granted combat methods out of standalone & options, into their own bucket (no double-count)", () => {
			const {autoGrantedCombatMethods, standaloneFeatures, featureOptions} =
				CharacterSheetClassUtils.partitionClassFeaturesForDisplay([standalone, specialty, SINGULAR_FOCUS, GROUNDSHATTER]);

			const autoNames = autoGrantedCombatMethods.map(f => f.name).sort();
			expect(autoNames).toEqual(["Groundshatter", "Singular Focus"]);

			// Auto-granted CMs must NOT also appear as standalone or feature-option rows
			expect(standaloneFeatures.map(f => f.name)).toEqual(["Colossus Slayer"]);
			expect(featureOptions.map(f => f.name)).toEqual(["Some Specialty"]);
		});

		it("keeps the optionalFeatures list pure (player-picked optional CMs stay there, not in auto-granted)", () => {
			const {optionalFeatures, autoGrantedCombatMethods} =
				CharacterSheetClassUtils.partitionClassFeaturesForDisplay([standalone, optionalMethod]);

			expect(optionalFeatures.map(f => f.name)).toEqual(["Perceptive Stance"]);
			// Optional CMs are NOT auto-granted (they group via the optionalFeatures path)
			expect(autoGrantedCombatMethods).toEqual([]);
		});

		it("each feature lands in exactly one display bucket", () => {
			const input = [standalone, specialty, SINGULAR_FOCUS, optionalMethod];
			const {optionalFeatures, autoGrantedCombatMethods, standaloneFeatures, featureOptions} =
				CharacterSheetClassUtils.partitionClassFeaturesForDisplay(input);
			const total = optionalFeatures.length + autoGrantedCombatMethods.length + standaloneFeatures.length + featureOptions.length;
			expect(total).toBe(input.length);
		});
	});

	describe("_getFeatureHoverLink routing guard (source-pinned replica)", () => {
		// Mirror of the production `isDefiniteCombatMethod` guard in charactersheet.js
		// `_getFeatureHoverLink`. The source-pin test below fails first if the production
		// guard changes, forcing this replica to be updated in lockstep.
		const isDefiniteCombatMethod = (feature) => feature
			&& (feature._entityType === "combatMethod"
				|| (Array.isArray(feature.optionalFeatureTypes) && feature.optionalFeatureTypes.some(t => t?.startsWith?.("CTM:"))));

		it("routes auto-granted (entity-typed) combat methods to the Combat Methods page", () => {
			expect(isDefiniteCombatMethod(SINGULAR_FOCUS)).toBe(true);
		});

		it("routes CTM-coded optional-feature combat methods", () => {
			expect(isDefiniteCombatMethod({name: "Perceptive Stance", optionalFeatureTypes: ["CTM:1RE"]})).toBe(true);
		});

		it("does NOT route an ordinary class feature", () => {
			expect(isDefiniteCombatMethod({name: "Extra Attack", featureType: "Class", className: "Ranger"})).toBe(false);
		});

		it("does NOT route an auto-granted NON-combat feature (tight guard, no _autoGranted shortcut)", () => {
			expect(isDefiniteCombatMethod({name: "Auto Feature", _autoGranted: true, featureType: "Class"})).toBe(false);
		});

		it("source-pin: production guard still keys on _entityType and CTM: (never _autoGranted alone)", () => {
			const source = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
			const m = source.match(/const isDefiniteCombatMethod = feature[\s\S]*?CTM:[\s\S]*?;/);
			expect(m).not.toBeNull();
			expect(m[0]).toContain(`feature._entityType === "combatMethod"`);
			expect(m[0]).not.toMatch(/_autoGranted/);
		});
	});

	describe("_getFeatureDescription renders combat-method entries", () => {
		const callDesc = (feature) =>
			CharacterSheetFeatures.prototype._getFeatureDescription.call({}, feature);

		it("derives a description from `entries` when no stored description exists", () => {
			const desc = callDesc(SINGULAR_FOCUS);
			expect(desc).toBeTruthy();
			expect(typeof desc).toBe("string");
		});

		it("prefers a stored description over rendering entries", () => {
			const withDesc = {...SINGULAR_FOCUS, description: "STORED"};
			expect(callDesc(withDesc)).toBe("STORED");
		});

		it("returns null for a non-combat feature with no description", () => {
			expect(callDesc({name: "Mystery", featureType: "Optional Feature"})).toBeNull();
		});
	});
});

describe("Bug 4 — Primal Focus on the Combat tab", () => {
	let state;

	beforeEach(() => {
		state = new CharacterSheetState();
		state.addClass({name: "Ranger", source: "TGTT", level: 6, subclass: {name: "Hunter"}});
	});

	it("hasPrimalFocus gates the section on a TGTT Ranger", () => {
		expect(state.hasPrimalFocus()).toBe(true);
		const nonRanger = new CharacterSheetState();
		nonRanger.addClass({name: "Fighter", source: "XPHB", level: 6});
		expect(nonRanger.hasPrimalFocus()).toBe(false);
	});

	it("switching focus from the combat surface consumes a Focus Switch and flips the mode", () => {
		expect(state.getPrimalFocusMode()).toBe("predator");
		const before = state.getFocusSwitchesRemaining();

		const ok = state.switchPrimalFocus();
		expect(ok).toBe(true);
		expect(state.getPrimalFocusMode()).toBe("prey");

		const after = state.getFocusSwitchesRemaining();
		if (before !== "Unlimited") expect(after).toBe(before - 1);
	});

	it("focus-gating predicate reflects the active mode for granted methods", () => {
		state.setPrimalFocusMode("predator");
		// Predator method usable in predator, blocked in prey
		expect(state.isCombatMethodFocusBlocked(SINGULAR_FOCUS)).toBe(false);
		expect(state.isCombatMethodFocusBlocked(GROUNDSHATTER)).toBe(true);

		state.setPrimalFocusMode("prey");
		expect(state.isCombatMethodFocusBlocked(SINGULAR_FOCUS)).toBe(true);
		expect(state.isCombatMethodFocusBlocked(GROUNDSHATTER)).toBe(false);
	});

	it("mode ability catalog is gated by the level upgrades the combat block reads", () => {
		const baseline = CharacterSheetClassUtils.getPrimalFocusModeAbilities("predator", {});
		const upgraded = CharacterSheetClassUtils.getPrimalFocusModeAbilities("predator", {upgrade1: true});

		// Upgrade-gated entries (e.g. Pursuit, Singular Focus) only appear at L6+
		expect(baseline.some(a => a.name === "Pursuit")).toBe(false);
		expect(upgraded.some(a => a.name === "Pursuit")).toBe(true);
		expect(upgraded.some(a => a.name === "Singular Focus" && a.kind === "method")).toBe(true);

		// Every entry carries a kind the renderer can badge
		upgraded.forEach(a => expect(["usable", "passive", "method"]).toContain(a.kind));
	});

	it("prey mode surfaces Hunter's Dodge as a usable reaction", () => {
		const prey = CharacterSheetClassUtils.getPrimalFocusModeAbilities("prey", {});
		const dodge = prey.find(a => a.name === "Hunter's Dodge");
		expect(dodge).toBeDefined();
		expect(dodge.kind).toBe("usable");
		expect(dodge.actionType).toBe("reaction");
	});
});

describe("Bug — Overview/Combat Primal Focus ability parity", () => {
	// The main controller (charactersheet.js) is not importable in the node test env
	// (`window is not defined`), so — like the J8 source-pin above — we pin the wiring
	// of `_renderOverviewRanger` to the canonical catalog. This guards the parity fix:
	// the Overview must render the same getPrimalFocusModeAbilities catalog the Combat
	// tab does (single source of truth), and must NOT regress to the removed ad-hoc
	// `effectLines` summary, while still preserving the Focused Quarry damage number.
	const source = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
	const overviewBody = (() => {
		const m = source.match(/_renderOverviewRanger\s*\(\)\s*\{[\s\S]*?\n\t_renderOverviewAbilities\s*\(\)/);
		return m ? m[0] : "";
	})();
	const combatBody = (() => {
		const combatSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-combat.js"), "utf8");
		const m = combatSrc.match(/renderCombatRanger\s*\(\)\s*\{[\s\S]*?\n\trenderCombatArcaneArcher\s*\(\)/);
		return m ? m[0] : "";
	})();

	it("locates the _renderOverviewRanger and renderCombatRanger bodies", () => {
		expect(overviewBody.length).toBeGreaterThan(0);
		expect(combatBody.length).toBeGreaterThan(0);
	});

	it("Overview renders the canonical getPrimalFocusModeAbilities catalog (parity with Combat)", () => {
		expect(combatBody).toContain("getPrimalFocusModeAbilities");
		expect(overviewBody).toContain("getPrimalFocusModeAbilities");
		// Passes the same upgrade gating the combat tab reads.
		expect(overviewBody).toContain("primalFocusUpgrade1");
		expect(overviewBody).toContain("primalFocusUpgrade2");
		expect(overviewBody).toContain("primalFocusUpgrade3");
	});

	it("Overview preserves the Focused Quarry damage number (no info regression)", () => {
		expect(overviewBody).toContain("focusedQuarryDamage");
		expect(overviewBody).toMatch(/Focused Quarry/);
	});

	it("Overview no longer uses the removed ad-hoc effectLines summary", () => {
		expect(overviewBody).not.toContain("effectLines");
	});
});
