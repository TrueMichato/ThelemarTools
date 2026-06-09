/**
 * Bug #10 — Orphaned "Survivor — Choose a Skill Proficiency" modal after a
 * Centaur(TGTT) build is sent through QuickBuild.
 *
 * The GGR/TGTT Centaur encodes the SAME racial skill choice twice:
 *  - a structured top-level `skillProficiencies: [{choose: {from: [...]}}]` (applied
 *    authoritatively by the Builder / respec skill picker), and
 *  - a prose "Survivor" trait whose text the feature-choice parser also turns into a
 *    pending "choose a skill" prompt.
 *
 * The redundant prose pending choice was orphaned (a second, concurrent processor —
 * the Features-tab render auto-prompt — raced the wizard's awaited processor), so the
 * modal "won't close" and Finish appears to do nothing.
 *
 * Fixes under test:
 *  A. state suppresses the prose skill choice when a structured racial
 *     `skillProficiencies.choose` already covers the same options (identity-based).
 *  B. `processPendingFeatureChoices` holds a single-owner re-entrancy lock so a second
 *     concurrent processor cannot pop a duplicate modal.
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

/** The Centaur racial skill-choice options (normalized keys). */
const CENTAUR_SKILL_FROM = ["animal handling", "medicine", "nature", "survival"];

/** A race object with the structured racial skill choice (as on GGR/TGTT Centaur). */
function centaurRace () {
	return {
		name: "Centaur",
		source: "TGTT",
		skillProficiencies: [{choose: {from: [...CENTAUR_SKILL_FROM]}}],
	};
}

/** The prose "Survivor" trait that restates the same choice. */
function survivorFeature () {
	return {
		name: "Survivor",
		source: "TGTT",
		featureType: "Species",
		entries: ["You have proficiency in either the {@skill Animal Handling}, {@skill Medicine}, {@skill Nature}, or {@skill Survival} skill of your choice."],
	};
}

describe("#10 racial structured skill choice suppresses the prose duplicate", () => {
	let state;
	beforeEach(() => { state = new CharacterSheetState(); });

	test("a racial prose skill choice covered by structured skillProficiencies.choose is NOT queued", () => {
		state.setRace(centaurRace(), null);
		state.addFeature(survivorFeature());

		const pending = state.getPendingFeatureChoices().filter(c => c.kind === "skill");
		expect(pending).toHaveLength(0);
	});

	test("the structured options are still claimed so the greedy parser doesn't grant all four", () => {
		state.setRace(centaurRace(), null);
		const {claimedSkills} = state._processFeatureChoices(survivorFeature(), "feat-id");
		// All four restated options are claimed (suppressed-but-claimed).
		["animalhandling", "medicine", "nature", "survival"].forEach(k => {
			const has = [...claimedSkills].some(s => String(s).toLowerCase().replace(/\s+/g, "") === k);
			expect(has).toBe(true);
		});
	});

	test("a prose skill choice with NO structured racial counterpart is still queued (no over-suppression)", () => {
		// Race without a structured skill choice — the prose choice must survive.
		state.setRace({name: "Plainsfolk", source: "HB"}, null);
		state.addFeature(survivorFeature());
		const pending = state.getPendingFeatureChoices().filter(c => c.kind === "skill");
		expect(pending).toHaveLength(1);
	});

	test("a non-racial feature with the same option set is NOT suppressed (gated on racial featureType)", () => {
		state.setRace(centaurRace(), null);
		const classFeature = {
			name: "Skilled Explorer",
			source: "PHB",
			featureType: "Class",
			className: "Ranger",
			level: 1,
			entries: ["You gain proficiency in either the {@skill Nature} or {@skill Survival} skill."],
		};
		state.addFeature(classFeature);
		const pending = state.getPendingFeatureChoices().filter(c => c.kind === "skill");
		expect(pending).toHaveLength(1);
	});

	test("the structured covering set may be on the subrace", () => {
		state.setRace({name: "Centaur", source: "TGTT"}, {
			name: "Plains Centaur",
			source: "TGTT",
			skillProficiencies: [{choose: {from: [...CENTAUR_SKILL_FROM]}}],
		});
		state.addFeature(survivorFeature());
		const pending = state.getPendingFeatureChoices().filter(c => c.kind === "skill");
		expect(pending).toHaveLength(0);
	});

	test("a NARROWER prose choice is NOT suppressed by a broader structured set (exact-set match only)", () => {
		// Structured racial choose offers 4 options; a separate prose trait offers an
		// independent 2-option choice that is a strict SUBSET. Exact-set matching must keep
		// the narrower prose choice (subset matching would have wrongly dropped it).
		state.setRace(centaurRace(), null);
		const narrowProse = {
			name: "Wary Traveller",
			source: "TGTT",
			featureType: "Species",
			entries: ["You gain proficiency in either {@skill Nature} or {@skill Survival}."],
		};
		state.addFeature(narrowProse);
		const pending = state.getPendingFeatureChoices().filter(c => c.kind === "skill");
		expect(pending).toHaveLength(1);
		expect(pending[0].options.length).toBe(2);
	});
});

describe("#10 single-owner feature-choice processing lock", () => {
	// The CharacterSheet controller isn't node-importable (`window is not defined` at
	// module top level), so extract the real `processPendingFeatureChoices` body and run
	// it bound to a stub. This pins the ACTUAL lock behavior, not a reimplementation.
	const charsheetSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
	const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

	const methodBody = (() => {
		const m = charsheetSrc.match(/async processPendingFeatureChoices \(\) \{([\s\S]*?)\n\t\}/);
		return m ? m[1] : "";
	})();

	test("the extracted method guards re-entry with a lock cleared in finally", () => {
		expect(methodBody.length).toBeGreaterThan(0);
		expect(methodBody).toMatch(/if \(this\._isProcessingFeatureChoices\) return false;/);
		expect(methodBody).toMatch(/this\._isProcessingFeatureChoices = true;/);
		expect(methodBody).toMatch(/finally \{[\s\S]*this\._isProcessingFeatureChoices = false;[\s\S]*\}/);
	});

	test("a second concurrent processor no-ops while the first holds the lock", async () => {
		const fn = new AsyncFunction(methodBody);

		let activePicks = 0;
		let maxConcurrent = 0;
		let remaining = 2;

		const stub = {
			_state: {
				hasPendingFeatureChoices: () => remaining > 0,
				getPendingFeatureChoices: () => (remaining > 0 ? [{id: "c1", kind: "skill", options: ["a", "b"]}] : []),
				fulfillFeatureChoice: () => { remaining -= 1; return true; },
			},
			getSpells: () => [],
			saveCharacter: async () => {},
			renderCharacter: () => {},
			// Slow modal so the two callers overlap if the lock fails.
			_pPickFeatureChoice: async () => {
				activePicks += 1;
				maxConcurrent = Math.max(maxConcurrent, activePicks);
				await new Promise(r => setTimeout(r, 20));
				activePicks -= 1;
				return "a";
			},
		};

		const first = fn.call(stub);
		const second = fn.call(stub);
		const [r1, r2] = await Promise.all([first, second]);

		// Only ONE processor ever ran a pick at a time — no orphaned second modal.
		expect(maxConcurrent).toBe(1);
		// Exactly one of the two calls did the work; the other was locked out.
		expect([r1, r2].filter(Boolean)).toHaveLength(1);
	});

	test("the feature-choice modal stacks above the QuickBuild overlay so Finish never hides it", () => {
		// `_pPickFeatureChoice` must lift its z-index above the 9999 quickbuild overlay
		// when present, else the pick renders behind it ("Finish does nothing").
		const m = charsheetSrc.match(/async _pPickFeatureChoice \(choice\) \{([\s\S]*?)\n\t\}/);
		const body = m ? m[1] : "";
		expect(body.length).toBeGreaterThan(0);
		expect(body).toMatch(/has-quickbuild-overlay/);
		expect(body).toMatch(/zIndex: 10001/);
	});
});
