/**
 * R26 #8 — Guided Strike post-roll redesign.
 *
 * Canonical Guided Strike: AFTER you see an attack roll, you may add +10 to THAT
 * roll (before the DM declares hit/miss). The old implementation rolled a FRESH
 * (random) attack with the +10 baked in and gated multi-weapon use behind a
 * BLOCKING "Which Attack?" modal — so "Use" felt like a random re-roll that
 * nagged. The redesign:
 *
 *  - `CharacterSheetState.shouldOfferGuidedStrikePostAttack` is the pure decision
 *    for the NON-BLOCKING post-roll offer attached to the dice-result toast.
 *  - `buildGuidedStrikeApplication` stays the pure +10 math.
 *  - The controller (`_pUseGuidedStrike`) NO LONGER rolls a fresh attack: the
 *    explicit "Use" applies +10 to the most recent attack roll; the right-click
 *    path rolls normally and the post-roll offer applies it; `_rollAttack` surfaces
 *    the offer. These controller invariants are source-pinned (the controller is
 *    too global-heavy to import in jest — see CharacterSheetDicePresets.test.js).
 *
 * Live (real rendered controls, vaa = Hochling Illrigger 15) confirmed alongside:
 *  - attack d20=7 → 14; post-roll "Apply Guided Strike (+10)" → SAME toast 24, use 1→0.
 *  - "Not now" dismisses the offer, toast stays, no use spent.
 *  - explicit Use after d20=9 → 16 becomes 26 (NOT a fresh d20 roll), use 1→0.
 *  - explicit Use with no prior attack → info toast, no use spent.
 *  - right-click Guided Strike rolls d20=8 → 15 with the offer; apply → 25, use 1→0.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../..");

const CharacterSheetState = globalThis.CharacterSheetState;

describe("R26 #8 — buildGuidedStrikeApplication (+10 math)", () => {
	it("adds +10 to an attack roll's total", () => {
		const app = CharacterSheetState.buildGuidedStrikeApplication(13);
		expect(app.bonus).toBe(10);
		expect(app.previousTotal).toBe(13);
		expect(app.newTotal).toBe(23);
		expect(app.used).toBe(true);
	});

	it("tolerates a missing / NaN prior total (floors to 0)", () => {
		expect(CharacterSheetState.buildGuidedStrikeApplication(undefined).newTotal).toBe(10);
		expect(CharacterSheetState.buildGuidedStrikeApplication(NaN).previousTotal).toBe(0);
	});
});

describe("R26 #8 — shouldOfferGuidedStrikePostAttack (post-roll offer decision)", () => {
	it("offers when the character has Guided Strike with a use available", () => {
		expect(CharacterSheetState.shouldOfferGuidedStrikePostAttack({
			hasGuidedStrike: true, hasUsesAvailable: true,
		})).toBe(true);
	});

	it("does NOT offer without the feature", () => {
		expect(CharacterSheetState.shouldOfferGuidedStrikePostAttack({
			hasGuidedStrike: false, hasUsesAvailable: true,
		})).toBe(false);
	});

	it("does NOT offer when no uses remain", () => {
		expect(CharacterSheetState.shouldOfferGuidedStrikePostAttack({
			hasGuidedStrike: true, hasUsesAvailable: false,
		})).toBe(false);
	});

	it("does NOT offer on a roll that already baked in the Guided Strike bonus (no recursion)", () => {
		expect(CharacterSheetState.shouldOfferGuidedStrikePostAttack({
			hasGuidedStrike: true, hasUsesAvailable: true, isGuidedStrikeApplication: true,
		})).toBe(false);
	});

	it("does NOT re-offer on a toast already offered / already applied", () => {
		expect(CharacterSheetState.shouldOfferGuidedStrikePostAttack({
			hasGuidedStrike: true, hasUsesAvailable: true, alreadyOffered: true,
		})).toBe(false);
	});

	it("defaults to no offer on an empty/garbage argument", () => {
		expect(CharacterSheetState.shouldOfferGuidedStrikePostAttack()).toBe(false);
		expect(CharacterSheetState.shouldOfferGuidedStrikePostAttack({})).toBe(false);
	});
});

// ============================================================================
// Source-pin the controller invariants (charactersheet.js / charactersheet-combat.js
// are too global-heavy to import in jest, so we assert the production behavior at
// the source level — matching the project's established source-pin convention).
// ============================================================================
describe("R26 #8 — controller post-roll invariants (source-pinned)", () => {
	const SRC_PAGE = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
	const SRC_COMBAT = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-combat.js"), "utf8");

	function pUseGuidedStrikeBody () {
		const start = SRC_PAGE.indexOf("async _pUseGuidedStrike (");
		expect(start).toBeGreaterThan(-1);
		const next = SRC_PAGE.indexOf("\n\t_isGuidedStrikeUseAvailable", start);
		return SRC_PAGE.slice(start, next > -1 ? next : start + 4000);
	}

	it("_pUseGuidedStrike no longer rolls a FRESH attack with the +10 baked in (the bug)", () => {
		const body = pUseGuidedStrikeBody();
		// The old code did: _rollAttack(attackId, null, {extraBonus: {label: "Guided Strike", value: bonus}})
		expect(body).not.toMatch(/extraBonus:\s*\{\s*label:\s*"Guided Strike"/);
	});

	it("_pUseGuidedStrike no longer opens the blocking 'Which Attack?' picker", () => {
		const body = pUseGuidedStrikeBody();
		expect(body).not.toContain("Guided Strike — Which Attack?");
		expect(body).not.toContain("pGetUserEnum");
	});

	it("explicit Use applies +10 to the MOST RECENT attack roll (post-roll), not a re-roll", () => {
		const body = pUseGuidedStrikeBody();
		expect(body).toMatch(/getRolls/);
		expect(body).toMatch(/rollType === "ATTACK" \|\| r\.rollType === "SPELL_ATTACK"/);
		expect(body).toContain("_applyGuidedStrikeAdjustment");
		// No prior attack → instruct to roll first (do not consume).
		expect(body).toContain("Make an attack roll first");
	});

	it("right-click path (opts.attackId) rolls the attack normally with NO baked bonus", () => {
		const body = pUseGuidedStrikeBody();
		expect(body).toMatch(/_rollAttack\?\.\(opts\.attackId,\s*null\)/);
	});

	it("_rollAttack surfaces the non-blocking post-roll Guided Strike offer", () => {
		expect(SRC_COMBAT).toContain("_offerGuidedStrikePostAttack");
		// The offer is attached to the dice-result element returned by showDiceResult.
		expect(SRC_COMBAT).toMatch(/const resultEl = this\._page\.showDiceResult\(/);
	});

	it("the post-roll offer + apply helpers exist on the page", () => {
		expect(SRC_PAGE).toContain("_offerGuidedStrikePostAttack");
		expect(SRC_PAGE).toContain("_applyGuidedStrikeAdjustment");
		expect(SRC_PAGE).toContain("_consumeGuidedStrikeUse");
		// Apply updates the SAME toast's displayed total in place.
		expect(SRC_PAGE).toContain("charsheet__dice-result-total");
	});
});
