/**
 * Bug #6 — The Builder wizard omitted racial/subclass FIXED feature-choices that
 * QuickBuild offered.
 *
 * Concretely: the Theocracian subrace (raceName "Child of the Empire", TGTT) carries a
 * prose "Pillars of Society" trait ("You gain proficiency in one of the following
 * skills: …") that the generic `FeatureChoiceParser` turns into a pending skill choice
 * when the subrace entries are added via `state.addFeature`. QuickBuild DRAINS that
 * pending queue (`processPendingFeatureChoices`) and also SEEDS off-list choices
 * (`seedSubclassFeatureChoices`); the Builder did NEITHER, so the racial skill pick
 * silently never appeared during a pure-Builder creation.
 *
 * Fix under test (two halves):
 *  A. STATE precondition — a Theocracian-style subrace + "Pillars of Society" prose (and
 *     a generic race/subrace fixed choice) queues exactly one pending skill choice, and
 *     the queue de-dupes (no double-offer).
 *  B. BUILDER — `_finishCharacter` invokes the SAME seed+drain pipeline QuickBuild uses
 *     (`seedSubclassFeatureChoices` + `processPendingFeatureChoices`) after features are
 *     added and before the character is saved. Asserted by scanning the real source so
 *     the wiring can't silently regress (the Builder controller isn't node-importable —
 *     `window is not defined` at module top level).
 */

import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

let CharacterSheetState;
beforeAll(async () => {
	CharacterSheetState = (await import("../../../js/charactersheet/charactersheet-state.js")).CharacterSheetState;
});

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** The Theocracian subrace (raceName "Child of the Empire", TGTT). */
function theocracianSubrace () {
	return {
		name: "Theocracian",
		source: "TGTT",
		raceName: "Child of the Empire",
	};
}

/** The prose "Pillars of Society" racial trait restating the structured skill pick. */
function pillarsOfSocietyFeature () {
	return {
		name: "Pillars of Society",
		source: "TGTT",
		featureType: "Species",
		entries: [
			"You gain proficiency in one of the following skills of your choice: {@skill Religion}, {@skill Athletics}, or {@skill Might|TGTT}.",
		],
	};
}

describe("#6 (state) racial prose fixed-choice queues a pending skill choice", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	test("Theocracian 'Pillars of Society' prose queues exactly one pending skill choice", () => {
		state.setRace({name: "Child of the Empire", source: "TGTT"}, theocracianSubrace());
		state.addFeature(pillarsOfSocietyFeature());

		const pending = state.getPendingFeatureChoices().filter(c => c.kind === "skill");
		expect(pending).toHaveLength(1);
		// The three restated options survive as a single-pick choice.
		expect(pending[0].options.length).toBe(3);
		expect(pending[0].count).toBe(1);
	});

	test("a GENERIC (non-TGTT) race+subrace prose fixed choice also queues (architecture-first, not Pillars-specific)", () => {
		state.setRace({name: "Homebrew Folk", source: "HB"}, {name: "Wandering Sept", source: "HB"});
		state.addFeature({
			name: "Chosen Calling",
			source: "HB",
			featureType: "Species",
			entries: ["You gain proficiency in one of the following skills of your choice: {@skill Insight}, {@skill Persuasion}, or {@skill Deception}."],
		});

		const pending = state.getPendingFeatureChoices().filter(c => c.kind === "skill");
		expect(pending).toHaveLength(1);
		expect(pending[0].options.length).toBe(3);
	});

	test("re-adding the SAME racial feature does not double-offer the pending choice", () => {
		state.setRace({name: "Child of the Empire", source: "TGTT"}, theocracianSubrace());
		state.addFeature(pillarsOfSocietyFeature());
		// addFeature de-dupes by name|source, so a second add is a no-op — the pending
		// queue must NOT grow to two identical skill prompts.
		state.addFeature(pillarsOfSocietyFeature());

		const pending = state.getPendingFeatureChoices().filter(c => c.kind === "skill");
		expect(pending).toHaveLength(1);
	});
});

describe("#6 (builder) `_finishCharacterCore` seeds + drains pending feature choices", () => {
	const builderSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-builder.js"), "utf8");

	/**
	 * Extract the `_finishCharacterCore` method body for tightly-scoped assertions.
	 * The build work lives in `_finishCharacterCore`; `_finishCharacter` is a thin
	 * wrapper that adds the tab-switch + Quick Build handoff, so that the spawner can
	 * reuse the build half headlessly.
	 */
	const finishBody = (() => {
		const m = builderSrc.match(/async _finishCharacterCore \([\s\S]*?\n\t\}/);
		return m ? m[0] : "";
	})();

	test("the method body exists and was located", () => {
		expect(finishBody.length).toBeGreaterThan(0);
	});

	test("`_finishCharacter` still delegates to it (the UI path must not fork)", () => {
		const m = builderSrc.match(/async _finishCharacter \([\s\S]*?\n\t\}/);
		expect(m?.[0] || "").toMatch(/this\._finishCharacterCore\s*\(/);
	});

	test("it seeds off-list choices via CharacterSheetClassUtils.seedSubclassFeatureChoices", () => {
		expect(finishBody).toMatch(/CharacterSheetClassUtils\.seedSubclassFeatureChoices\s*\(/);
	});

	test("it drains the pending feature-choice queue via processPendingFeatureChoices", () => {
		expect(finishBody).toMatch(/processPendingFeatureChoices\s*\(/);
	});

	test("the seed + drain happen BEFORE the character is saved (so choices are captured)", () => {
		// Match the CALL sites (with `(`) — the explanatory comment above the block also
		// names these methods, so a bare identifier search would find the prose first.
		const idxSeed = finishBody.indexOf("seedSubclassFeatureChoices(");
		const idxDrain = finishBody.indexOf("processPendingFeatureChoices(");
		const idxSave = finishBody.indexOf("saveCharacter(");
		expect(idxSeed).toBeGreaterThan(-1);
		expect(idxDrain).toBeGreaterThan(idxSeed);
		expect(idxSave).toBeGreaterThan(idxDrain);
	});
});
