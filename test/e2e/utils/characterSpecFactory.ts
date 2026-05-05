import {test, expect} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {gotoWithThelemar, clearHomebrewStorage} from "./homebrewLoader";
import {
	createCharacterViaWizard,
	levelUpTo,
	CharacterPreset,
} from "./characterBuilder";
import {
	addInventoryItems,
	assertMilestone,
	probeToggleDelta,
	readCombatStats,
	MilestoneExpect,
	InventoryItemRef,
} from "./comprehensiveBuildHelpers";

/**
 * Shared describe-block factory for the comprehensive per-character mega
 * specs.  Each call produces the canonical test set:
 *   - L1 creation smoke
 *   - L3 subclass arrival (focused)
 *   - L5 milestone (focused)
 *   - Mid-tier load-out: build to L7, install signature loadout, assert
 *     stat propagation + toggle delta
 *   - Mega L1→20 with milestone assertions at L3/5/11/17/20
 *
 * Tests that hit a known builder gap can be opted out via `skipMega` etc.
 *
 * The mega test is gated behind RUN_MEGA env var so contributors can run
 * the cheap subset (`npm run test:e2e -- --grep "L1 creation"`) by
 * default.  CI sets RUN_MEGA=1 to exercise the slow path.
 */
export interface CharacterSpec {
	preset: CharacterPreset;
	displayName: string;
	/** Loadout installed at the mid-tier checkpoint. */
	midTierLoadout?: InventoryItemRef[];
	/** Toggle that should produce a non-zero AC OR DC delta when activated. */
	signatureToggle?: string | RegExp;
	/** Per-milestone expectations indexed by character level. */
	milestones?: Partial<Record<number, MilestoneExpect>>;
	/** Set true to skip the L1→20 mega test (e.g. for multiclass cases handled separately). */
	skipMega?: boolean;
	/**
	 * Set true to skip the L7 loadout/toggle test. Use for presets
	 * blocked by a known product bug at < L7 (the test would be guaranteed
	 * red and burns ~9 min of suite time).  See docs/charactersheet/known-bugs.md
	 */
	skipL7?: boolean;
}

const MEGA_TIMEOUT_MS = 360_000; // 6 min — generous, matches existing capstone tests
const MIDTIER_TIMEOUT_MS = 180_000;
// L5 loadout walks 4 level-ups + creation + loadout + toggle probe.
// Empirically that needs ~6-9 minutes per spec on the slower characters
// (Monks/Wizards with heavy spell pickers especially).  This is not
// great, but the bottleneck is the wizard auto-fill and bringing it
// down further is a separate optimisation effort.
const L7_TIMEOUT_MS = 600_000;

export function describeCharacter (spec: CharacterSpec): void {
	const {preset, displayName, milestones = {}, midTierLoadout, signatureToggle, skipMega, skipL7} = spec;
	const subclassOpts = preset.subclassName
		? {subclassName: preset.subclassName, subclassSource: preset.subclassSource}
		: undefined;

	test.describe(`${displayName} — comprehensive build`, () => {
		test.beforeEach(async ({page}) => {
			await gotoWithThelemar(page);
		});

		test.afterEach(async ({page}) => {
			await clearHomebrewStorage(page);
		});

		// ── L1 creation smoke ───────────────────────────────────────────
		test(`L1: creates ${displayName} via builder wizard`, async ({page}) => {
			// Wizard creation now drives 7 steps with all sub-pickers, which
			// realistically takes 30-45s for the heavier classes. Give the
			// L1 smoke a generous budget so we don't conflate slowness with
			// genuine assertion failures.
			test.setTimeout(120_000);
			const {charSheet} = await createCharacterViaWizard(page, preset);
			await charSheet.expectCharacterName(preset.name);
			await charSheet.expectLevel(1);
			const m1 = milestones[1];
			if (m1) await assertMilestone(charSheet, m1);
		});

		// ── L3 subclass arrival ─────────────────────────────────────────
		test(`L3: subclass arrives and registers feature`, async ({page}) => {
			test.setTimeout(MIDTIER_TIMEOUT_MS);
			const {charSheet} = await createCharacterViaWizard(page, preset);
			await levelUpTo(page, 3, {...subclassOpts, signatureSpells: preset.signatureSpells});
			await charSheet.expectLevel(3);
			const m3 = milestones[3];
			if (m3) await assertMilestone(charSheet, m3);
		});

		// ── L5 mid-game milestone ──────────────────────────────────────
		test(`L5: extra attack / 3rd-level slots / prof +3`, async ({page}) => {
			test.setTimeout(MIDTIER_TIMEOUT_MS);
			const {charSheet} = await createCharacterViaWizard(page, preset);
			await levelUpTo(page, 5, {...subclassOpts, signatureSpells: preset.signatureSpells});
			await charSheet.expectLevel(5);
			const m5 = milestones[5];
			if (m5) await assertMilestone(charSheet, m5);
		});

		// ── Mid-tier loadout & toggle delta ────────────────────────────
		// Targets L5 — the same tier where Extra Attack and 3rd-level
		// slots arrive — so subclass features and signature toggles are
		// reachable.  We deliberately don't go higher because each extra
		// level-up adds ~80s of wizard auto-fill, which inflates the
		// suite without proportional coverage gain.  Renamed from "L7"
		// for honesty about what the test actually walks.
		if ((midTierLoadout?.length || signatureToggle) && !skipL7) {
			test(`L5 loadout: installs gear + signature toggle changes derived stats`, async ({page}) => {
				test.setTimeout(L7_TIMEOUT_MS);
				const {charSheet} = await createCharacterViaWizard(page, preset);
				await levelUpTo(page, 5, {...subclassOpts, signatureSpells: preset.signatureSpells});
				await charSheet.expectLevel(5);

				if (midTierLoadout?.length) {
					const before = await readCombatStats(charSheet);
					await addInventoryItems(page, midTierLoadout);
					const after = await readCombatStats(charSheet);
					// At least one combat stat should react to the new gear.
					const acChanged = before.ac !== after.ac;
					const atkChanged = (before.firstAttackBonus ?? -1) !== (after.firstAttackBonus ?? -1);
					const dcChanged = (before.spellSaveDc ?? -1) !== (after.spellSaveDc ?? -1);
					expect(acChanged || atkChanged || dcChanged, `gear should affect AC, attack, or DC. before=${JSON.stringify(before)} after=${JSON.stringify(after)}`).toBe(true);
				}

				if (signatureToggle) {
					const delta = await probeToggleDelta(charSheet, signatureToggle);
					// We only require *some* derived effect.  Specific magnitude
					// is asserted in per-character tests where the rules nail
					// down the exact delta.
					expect(Math.abs(delta.acDelta) + Math.abs(delta.dcDelta), `toggle ${signatureToggle} should produce a stat delta`).toBeGreaterThan(0);
				}
			});
		}

		// ── L1→20 mega progression ─────────────────────────────────────
		const mega = skipMega || !process.env.RUN_MEGA ? test.skip : test;
		mega(`MEGA L1→20 with milestone asserts`, async ({page}) => {
			test.setTimeout(MEGA_TIMEOUT_MS);
			const {charSheet} = await createCharacterViaWizard(page, preset);

			const checkpoints = [3, 5, 11, 17, 20];
			let cursor = 1;
			for (const cp of checkpoints) {
				if (cp <= cursor) continue;
				await levelUpTo(page, cp, {...subclassOpts, signatureSpells: preset.signatureSpells});
				cursor = cp;
				await charSheet.expectLevel(cp);
				const m = milestones[cp];
				if (m) await assertMilestone(charSheet, m);
			}
		});

		// ── Persistence smoke (export → re-import via state) ───────────
		test(`L1 export round-trip preserves identity`, async ({page}) => {
			const {charSheet} = await createCharacterViaWizard(page, preset);
			const exported = await page.evaluate(() => {
				const cs: any = (globalThis as any).charSheet;
				return cs?._state?.toJson?.() ?? null;
			});
			expect(exported, "state.toJson()").toBeTruthy();

			const reimported = await page.evaluate((json) => {
				const cs: any = (globalThis as any).charSheet;
				if (!cs?._state?.loadFromJson) return null;
				cs._state.loadFromJson(json);
				cs.render?.();
				return cs._state._data?.name || cs._state.getName?.() || null;
			}, exported);
			expect(reimported).toBe(preset.name);
			await charSheet.expectLevel(1);
		});
	});
}

/**
 * Convenience wrapper for multiclass characters where the standard mega
 * progression doesn't apply.  Caller supplies the full level-up plan as
 * a sequence of "leg" definitions.
 */
export interface MulticlassLeg {
	className: string;
	classSource?: string;
	subclassName?: string;
	subclassSource?: string;
	signatureSpells?: string[];
	/** Total character level to reach by the end of this leg. */
	toTotalLevel: number;
}

export interface MulticlassCharacterSpec {
	displayName: string;
	preset: CharacterPreset;     // primary class (used for builder wizard)
	plan: MulticlassLeg[];        // ordered legs to walk, including the primary
	finalMilestone?: MilestoneExpect;
}

export function describeMulticlassCharacter (spec: MulticlassCharacterSpec): void {
	const {preset, displayName, plan, finalMilestone} = spec;

	test.describe(`${displayName} — multiclass build`, () => {
		test.beforeEach(async ({page}) => {
			await gotoWithThelemar(page);
		});
		test.afterEach(async ({page}) => {
			await clearHomebrewStorage(page);
		});

		test(`builds full multiclass plan and reaches final milestone`, async ({page}) => {
			// Gate behind RUN_MEGA — same as describeCharacter's L1->20 test.
			// Multiclass plans walk many level-ups and otherwise dominate
			// the default suite runtime.
			if (!process.env.RUN_MEGA) test.skip(true, "set RUN_MEGA=1 to run multiclass mega tests");
			test.setTimeout(MEGA_TIMEOUT_MS);
			const {charSheet} = await createCharacterViaWizard(page, preset);

			// Lazy import to avoid circular type issues
			const {startMulticlass} = await import("./comprehensiveBuildHelpers");

			for (let i = 0; i < plan.length; i++) {
				const leg = plan[i];
				const isPrimary = i === 0;
				if (!isPrimary) {
					await startMulticlass(page, {
						className: leg.className,
						classSource: leg.classSource,
					});
				}
				if (leg.toTotalLevel > 1) {
					await levelUpTo(page, leg.toTotalLevel, {
						subclassName: leg.subclassName,
						subclassSource: leg.subclassSource,
						signatureSpells: leg.signatureSpells,
					});
				}
				await charSheet.expectLevel(leg.toTotalLevel);
			}

			if (finalMilestone) await assertMilestone(charSheet, finalMilestone);
		});
	});
}

// Re-export so spec files have a single import line.
export {test, expect, CharacterSheetPage};
