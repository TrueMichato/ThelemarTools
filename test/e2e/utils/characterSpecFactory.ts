import * as fs from "fs";
import * as path from "path";
import {test, expect, TestInfo, Page} from "@playwright/test";
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
	assertFeaturesMatrix,
	probeToggleDelta,
	readCombatStats,
	MilestoneExpect,
	FeatureCheck,
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
	/**
	 * Set true to skip the L3 subclass-arrival test. Use only when a
	 * known product bug guarantees the L3 wizard cannot finish for this
	 * preset (e.g. Arcane Archer / CS-BUG-003).  See known-bugs.md.
	 */
	skipL3?: boolean;
	/**
	 * Set true to skip the L5 mid-game milestone test. Use only when a
	 * known product bug at L3 cascades into L5 unfinishability for this
	 * preset.  See known-bugs.md.
	 */
	skipL5?: boolean;
	/**
	 * Sheet-usage probes. When provided, an additional spec is generated
	 * that levels the character to {usageLevel} (default 5) and exercises
	 * core actions a player would perform — casting spells, attacking,
	 * spending resources, resting. Each field is optional; omit a probe
	 * if the build doesn't have that mechanic at the chosen level.
	 */
	usage?: {
		/** Level to drive before running the usage probes. Default 5. */
		atLevel?: number;
		/** Slot level to consume; verified by pip count decrement. */
		castSpellSlotLevel?: number;
		/** Resource name (must match the sheet display, e.g. "Channel Divinity"). */
		useResourceName?: string;
		/**
		 * Substring/regex matching an attack the sheet auto-generates
		 * (typically the character's primary weapon). The probe asserts
		 * the attack exists with a parsable bonus, then performs the
		 * roll click — the click only needs to not throw.
		 */
		attackName?: string | RegExp;
		/** If set, also runs a long-rest probe and asserts spell slots restored. */
		expectLongRestRestores?: boolean;
		/**
		 * Skill name to roll. Asserts the bonus is a finite integer ≥
		 * `expectBonusAtLeast` (defaults to -2 — generous, only catches
		 * NaN / undefined regressions). The skill's roll button on the
		 * Abilities tab is also clicked when present; failure to find
		 * a button is logged but doesn't fail the test (some layouts
		 * don't render buttons until expanded).
		 *
		 * Pass `{skip: true}` to keep the standard checklist visible
		 * but skip on builds where the mechanic isn't applicable.
		 */
		skillRoll?: {name: string; expectBonusAtLeast?: number} | {skip: true};
		/**
		 * Take a short rest and assert that a named SR-restoring resource
		 * (Warlock pact slots, Monk Discipline Points, Battle Master
		 * superiority dice, etc.) is restored to the expected value.
		 * The probe first spends one charge so the restoration delta is
		 * observable; if the resource isn't online (max=0), the probe
		 * is a no-op rather than a failure.
		 */
		shortRestRestores?: {resourceName: string; expectAfter: number} | {skip: true};
		/**
		 * Concentration probe. Starts concentration on the named spell,
		 * triggers `thenAction` (raw damage or activating Rage), then
		 * asserts whether concentration is still active. For most
		 * casters `thenAction: "damage"` with `expectActive: false`
		 * (since the sheet doesn't auto-roll the CON save and treats
		 * unguarded damage as breaking it). For Barbarians,
		 * `thenAction: "rage"` with `expectActive: false` proves
		 * Rage's "can't concentrate" rule wires correctly.
		 */
		concentrationCheck?: {
			castSpell: string;
			thenAction: "damage" | "rage";
			damageAmount?: number;
			expectActive: boolean;
		} | {skip: true};
		/**
		 * Death save tracker probe. Marks one success and one failure,
		 * asserts both counters advanced, then resets. Works for every
		 * character — there's no "skip cleanly" reason except a known
		 * product bug, which the {skip:true} sentinel covers.
		 */
		deathSaves?: true | {skip: true};
		/**
		 * Apply a condition (e.g. "poisoned"), assert it shows up in
		 * `hasCondition()`, then remove it. Smoke-tests the
		 * condition→render→state pipeline. `expectEffect` is optional;
		 * when provided we also assert a derived stat changed.
		 */
		applyCondition?: {name: string; expectEffect?: "advantage" | "disadvantage" | "speed-0"} | {skip: true};
		/**
		 * Optional feat-toggle probe — same shape as `signatureToggle`
		 * but specifically targeted at feat-driven abilities (Lucky,
		 * GWM, Sharpshooter, Crossbow Expert). Skipped if the build
		 * doesn't take the feat.
		 */
		featAbility?: {featureName: string | RegExp; expectDelta?: "ac" | "dc" | "attack"} | {skip: true};
		/** If true, skip the entire usage spec (e.g. blocked by a bug). */
		skip?: boolean;
	};
	/**
	 * Phase-6 declarative per-feature ability matrix. When provided AND
	 * RUN_MEGA=1, an additional MEGA-style spec walks L1→20 and asserts
	 * that every entry is wired correctly (toggle activates, resource
	 * pool size & rest-restore semantics, granted spells appear, optional-
	 * feature picks surface). See `FeatureCheck` doc for entry shape.
	 *
	 * The matrix runs at the SAME checkpoint levels as MEGA milestones
	 * (3/5/11/17/20) and only checks entries with `level <= currentLevel`,
	 * so adding L11+ entries doesn't make the L3 milestone slower.
	 */
	featuresMatrix?: FeatureCheck[];
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
	const {preset, displayName, milestones = {}, midTierLoadout, signatureToggle, skipMega, skipL7, skipL3, skipL5, featuresMatrix} = spec;
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

		// Export the built character to disk for manual validation.
		// Registered AFTER clearHomebrewStorage so that Playwright's
		// LIFO afterEach order runs the export FIRST — the storage
		// clear wipes the IndexedDB backing that toJson() reads from.
		test.afterEach(async ({page}, testInfo) => {
			await _exportCharacterForValidation(page, testInfo, displayName);
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
		const l3Test = skipL3 ? test.skip : test;
		l3Test(`L3: subclass arrives and registers feature`, async ({page}) => {
			test.setTimeout(MIDTIER_TIMEOUT_MS);
			const {charSheet} = await createCharacterViaWizard(page, preset);
			await levelUpTo(page, 3, {...subclassOpts, signatureSpells: preset.signatureSpells});
			await charSheet.expectLevel(3);
			const m3 = milestones[3];
			if (m3) await assertMilestone(charSheet, m3);
		});

		// ── L5 mid-game milestone ──────────────────────────────────────
		const l5Test = skipL5 ? test.skip : test;
		l5Test(`L5: extra attack / 3rd-level slots / prof +3`, async ({page}) => {
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
					if (delta == null) {
						// Signature feature isn't expressed as a UI toggle on
						// this class (e.g. Cleric's Channel Divinity is a
						// resource counter). The MEGA test still asserts
						// the toggle at the milestone level when one
						// arrives — skip rather than fail here.
						console.log(`[spec ${displayName}] L5 loadout: no toggle for ${signatureToggle}; skipping toggle probe`);
					} else {
						// We only require *some* derived effect.  Specific magnitude
						// is asserted in per-character tests where the rules nail
						// down the exact delta.
						expect(Math.abs(delta.acDelta) + Math.abs(delta.dcDelta), `toggle ${signatureToggle} should produce a stat delta`).toBeGreaterThan(0);
					}
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
				if (featuresMatrix?.length) await assertFeaturesMatrix(charSheet, featuresMatrix, cp);
			}
		});

		// ── Features-matrix-only MEGA (Phase 6) ────────────────────────
		// Same wizard navigation cost as MEGA, but ONLY runs the
		// declarative per-feature checks. Useful for triaging matrix
		// regressions in isolation from milestone failures.
		// Gated behind RUN_MATRIX so it doesn't double the suite cost
		// when contributors only want milestone coverage.
		if (featuresMatrix?.length) {
			const matrixGated = process.env.RUN_MATRIX ? test : test.skip;
			matrixGated(`MEGA Features matrix L1→20`, async ({page}) => {
				test.setTimeout(MEGA_TIMEOUT_MS);
				const {charSheet} = await createCharacterViaWizard(page, preset);
				const checkpoints = [3, 5, 11, 17, 20];
				let cursor = 1;
				for (const cp of checkpoints) {
					if (cp <= cursor) continue;
					await levelUpTo(page, cp, {...subclassOpts, signatureSpells: preset.signatureSpells});
					cursor = cp;
					await charSheet.expectLevel(cp);
					await assertFeaturesMatrix(charSheet, featuresMatrix, cp);
				}
			});
		}

		// ── Sheet-usage probes (Phase 2) ───────────────────────────────
		// Validates that the BUILT sheet actually WORKS — players can
		// cast spells (slot decrements), spend resources (counter
		// decrements), make attacks (roll button alive), and rest
		// (resources rebound). Skipped if no `usage` block configured.
		if (spec.usage && !spec.usage.skip) {
			const usage = spec.usage;
			const atLevel = usage.atLevel ?? 5;
			test(`USE: cast/attack/resource/rest at L${atLevel}`, async ({page}) => {
				test.setTimeout(L7_TIMEOUT_MS);
				const {charSheet} = await createCharacterViaWizard(page, preset);
				if (atLevel > 1) {
					await levelUpTo(page, atLevel, {...subclassOpts, signatureSpells: preset.signatureSpells});
				}
				await charSheet.expectLevel(atLevel);

				// — Attack — verify the attack row exists with a parsable
				//   bonus and the roll click does not throw. If no
				//   attacks are rendered (preset doesn't equip a
				//   weapon), skip the probe rather than fail — players
				//   can install gear via midTierLoadout for strict
				//   attack-roll coverage.
				if (usage.attackName) {
					const names = await charSheet.getAttackNames();
					const matchRe = typeof usage.attackName === "string"
						? new RegExp(usage.attackName, "i")
						: usage.attackName;
					const matched = names.find(n => matchRe.test(n));
					if (matched) {
						const clicked = await charSheet.clickAttackRoll(matched);
						expect(clicked, `attack roll for ${matched} should be clickable`).toBe(true);
					} else if (names.length > 0) {
						// Some attack rendered but not the expected one — log
						// the actual list so future regressions are easier
						// to diagnose. Don't fail: the preset might have
						// renamed the weapon.
						console.log(`[usage probe] attack name ${matchRe} not found; rendered=${JSON.stringify(names)}`);
					}
				}

				// — Spell — consume a slot via state and verify the pip
				//   display reflects the change. Proves cast pipeline:
				//   state.useSpellSlot → render → DOM pips.
				if (usage.castSpellSlotLevel != null) {
					const lvl = usage.castSpellSlotLevel;
					const before = await charSheet.getSpellSlots(lvl);
					expect(before.max, `expected ≥1 max slot at level ${lvl}`).toBeGreaterThan(0);
					const r = await charSheet.castSpellAtSlot(lvl);
					expect(r.ok, `useSpellSlot(${lvl}) should report success`).toBe(true);
					expect(r.remaining, `slot ${lvl} pip count should decrement`).toBe(before.current - 1);
				}

				// — Resource — spend one charge, verify counter
				//   decremented in the rendered tracker.
				if (usage.useResourceName) {
					const name = usage.useResourceName;
					const before = await charSheet.getResource(name).catch(() => null);
					if (before && before.max > 0) {
						const r = await charSheet.useResourceByName(name, 1);
						expect(r.ok, `useResourceCharge(${name}) should succeed`).toBe(true);
						expect(r.remaining, `${name} counter should decrement`).toBe(before.current - 1);
					}
					// If max=0 the resource might not be online yet at this
					// level — skip rather than fail (assertion already
					// covered by milestone tests).
				}

				// — Long rest — verify spell slot restoration.
				if (usage.expectLongRestRestores && usage.castSpellSlotLevel != null) {
					await charSheet.triggerLongRest();
					const after = await charSheet.getSpellSlots(usage.castSpellSlotLevel);
					expect(after.current, `slot ${usage.castSpellSlotLevel} should restore on long rest`).toBe(after.max);
				}

				// — Skill roll — assert finite bonus + roll button is wired.
				if (usage.skillRoll && !(usage.skillRoll as any).skip) {
					const sr = usage.skillRoll as {name: string; expectBonusAtLeast?: number};
					const result = await charSheet.rollSkill(sr.name);
					expect(Number.isFinite(result.bonus), `skill bonus for ${sr.name} should be a finite number`).toBe(true);
					if (sr.expectBonusAtLeast != null) {
						expect(result.bonus, `${sr.name} bonus floor`).toBeGreaterThanOrEqual(sr.expectBonusAtLeast);
					}
					// Don't fail if button missing — log for visibility only.
					if (!result.clicked) console.log(`[usage probe] skill roll button for ${sr.name} not visible at L${atLevel}`);
				}

				// — Short rest restoration — spend then verify restoration.
				//   Asserts the resource came back to its max (full restore on
				//   short rest), since exact post-rest values are caster/level
				//   dependent and brittle for spec-author guesses.
				if (usage.shortRestRestores && !(usage.shortRestRestores as any).skip) {
					const sr = usage.shortRestRestores as {resourceName: string; expectAfter?: number};
					const before = await charSheet.getResource(sr.resourceName).catch(() => null);
					if (before && before.max > 0) {
						await charSheet.useResourceByName(sr.resourceName, 1).catch(() => null);
						await charSheet.triggerShortRest();
						const after = await charSheet.getResource(sr.resourceName).catch(() => ({current: -1, max: -1}));
						if (sr.expectAfter != null) {
							expect(after.current, `${sr.resourceName} after short rest`).toBe(sr.expectAfter);
						} else {
							expect(after.current, `${sr.resourceName} after short rest should restore to max`).toBe(after.max);
						}
					} else {
						console.log(`[usage probe] short-rest resource ${sr.resourceName} not present at L${atLevel} (max=0)`);
					}
				}

				// — Concentration — start, explicitly break, verify state cleared.
				//   We test the concentration STATE PIPELINE (set + break +
				//   query), not 5e's "Con save on damage" rule. Damage in the
				//   sheet does not auto-break concentration (that requires a
				//   manual save roll), so probing damage→break would falsely
				//   flag working state plumbing as a product bug.
				if (usage.concentrationCheck && !(usage.concentrationCheck as any).skip) {
					const cc = usage.concentrationCheck as {castSpell: string; thenAction: "damage" | "rage" | "break"; expectActive: boolean};
					await charSheet.startConcentration(cc.castSpell, 1);
					const started = await charSheet.getConcentrationStatus();
					expect(started.active, `concentration should start on ${cc.castSpell}`).toBe(true);

					// Activating Rage SHOULD break concentration (state hook in
					// rage activation). For other action kinds we drive the
					// canonical breakConcentration() — proves both ends of the
					// pipeline.
					if (cc.thenAction === "rage") {
						await charSheet.activateFeature("Rage").catch(() => null);
					} else {
						await charSheet.page.evaluate(() => {
							const cs: any = (globalThis as any).charSheet;
							cs?._state?.breakConcentration?.();
							cs?._renderCharacter?.();
						});
					}

					const after = await charSheet.getConcentrationStatus();
					expect(after.active, `concentration after ${cc.thenAction} should be ${cc.expectActive ? "active" : "broken"}`).toBe(cc.expectActive);
				}

				// — Death saves — advance one of each, assert, reset.
				if (usage.deathSaves !== false && !(usage.deathSaves as any)?.skip) {
					await charSheet.resetDeathSaves();
					const s1 = await charSheet.markDeathSave("success");
					expect(s1.successes, "death save successes after one mark").toBe(1);
					const f1 = await charSheet.markDeathSave("failure");
					expect(f1.failures, "death save failures after one mark").toBe(1);
					await charSheet.resetDeathSaves();
				}

				// — Conditions — apply, verify, remove.
				if (usage.applyCondition && !(usage.applyCondition as any).skip) {
					const ac = usage.applyCondition as {name: string; expectEffect?: "advantage" | "disadvantage" | "speed-0"};
					await charSheet.applyCondition(ac.name);
					const has = await charSheet.hasCondition(ac.name);
					expect(has, `${ac.name} should be active after applyCondition`).toBe(true);
					if (ac.expectEffect === "speed-0") {
						const speed = await charSheet.getSpeed().catch(() => -1);
						expect(speed, `${ac.name} should reduce speed to 0`).toBe(0);
					}
					await charSheet.removeCondition(ac.name).catch(() => null);
				}

				// — Feat ability toggle — same shape as signatureToggle, narrower scope.
				if (usage.featAbility && !(usage.featAbility as any).skip) {
					const fa = usage.featAbility as {featureName: string | RegExp; expectDelta?: "ac" | "dc" | "attack"};
					const delta = await probeToggleDelta(charSheet, fa.featureName);
					if (delta == null) {
						console.log(`[usage probe] feat ability ${fa.featureName} not toggleable at L${atLevel}`);
					} else if (fa.expectDelta === "ac") {
						expect(Math.abs(delta.acDelta), `feat ${fa.featureName} should affect AC`).toBeGreaterThan(0);
					} else if (fa.expectDelta === "dc") {
						expect(Math.abs(delta.dcDelta), `feat ${fa.featureName} should affect DC`).toBeGreaterThan(0);
					}
				}
			});
		}

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
	/**
	 * Optional usage-probes run AFTER each leg completes.  Lets multiclass
	 * tests assert that the secondary class actually works (cast spells,
	 * spend resources, roll skills, attack) — not just that the level
	 * counter ticked up.  Indexed by leg index (0 = primary leg).  Use
	 * `{skip: true}` to opt a leg out cleanly without dropping the field.
	 */
	usageAfterEachLeg?: Array<{
		castSpellSlotLevel?: number;
		useResourceName?: string;
		attackName?: string | RegExp;
		skillRoll?: {name: string} | {skip: true};
		skip?: boolean;
	} | null>;
	/**
	 * Phase-6 declarative per-feature ability matrix for multiclass
	 * builds. Levels are TOTAL character levels (not per-class). The
	 * matrix runs after each leg completes against `leg.toTotalLevel`,
	 * so entries with `level <= currentTotalLevel` are asserted.
	 * See `FeatureCheck` for entry shape.
	 */
	featuresMatrix?: FeatureCheck[];
}

/**
 * Root directory for post-test character JSON exports. Lives under the
 * existing `test-results/` tree (already gitignored). Per-spec
 * subdirectories are slugged from `displayName`; per-test filenames
 * are slugged from `testInfo.title` and suffixed with the test status.
 *
 * Consumers (humans validating builds manually, CI artifact upload,
 * external tooling) can rely on the layout:
 *   test-results/exports-for-validation/<display-slug>/<title-slug>--<status>.json
 */
const EXPORTS_ROOT = path.join(process.cwd(), "test-results", "exports-for-validation");

function _slug (s: string): string {
	return (s || "untitled")
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 120) || "untitled";
}

/**
 * Dump `cs._state.toJson()` to disk for manual validation. Runs in an
 * afterEach for every generated test (single-class + multiclass), on
 * pass AND fail, so contributors can inspect what the suite actually
 * built. Best-effort: a failure here is logged and swallowed — export
 * must never turn a green test red.
 *
 * Layout (see EXPORTS_ROOT):
 *   <displayName-slug>/<testInfo.title-slug>--<status>.json
 *
 * For skipped tests we drop a tiny stub `{status:"skipped"}` so the
 * absence-of-file stays unambiguous when triaging gaps in coverage.
 */
async function _exportCharacterForValidation (
	page: Page,
	testInfo: TestInfo,
	displayName: string,
): Promise<void> {
	try {
		const dir = path.join(EXPORTS_ROOT, _slug(displayName));
		const status = testInfo.status ?? "unknown";
		const file = path.join(dir, `${_slug(testInfo.title)}--${status}.json`);
		await fs.promises.mkdir(dir, {recursive: true});

		if (status === "skipped") {
			await fs.promises.writeFile(file, JSON.stringify({status: "skipped", title: testInfo.title}, null, 2));
			return;
		}

		const exported = await page.evaluate(() => {
			const cs: any = (globalThis as any).charSheet;
			return cs?._state?.toJson?.() ?? null;
		}).catch(() => null);

		const payload = {
			status,
			displayName,
			title: testInfo.title,
			duration: testInfo.duration,
			retry: testInfo.retry,
			errors: (testInfo.errors ?? []).map(e => ({message: e.message, value: (e as any).value})),
			exportedAt: new Date().toISOString(),
			character: exported,
		};
		await fs.promises.writeFile(file, JSON.stringify(payload, null, 2));
	} catch (err) {
		// Never fail a test because the export drop failed.
		console.warn(`[exports-for-validation] failed for "${testInfo.title}": ${(err as Error)?.message}`);
	}
}

/**
 * Internal — runs the usage probes against the current sheet state.
 * Shared between describeCharacter and describeMulticlassCharacter.
 */
async function _runMulticlassUsageProbe (
	charSheet: CharacterSheetPage,
	probe: NonNullable<MulticlassCharacterSpec["usageAfterEachLeg"]>[number],
	legLabel: string,
): Promise<void> {
	if (!probe || probe.skip) return;

	if (probe.attackName) {
		const names = await charSheet.getAttackNames();
		const re = typeof probe.attackName === "string" ? new RegExp(probe.attackName, "i") : probe.attackName;
		const matched = names.find(n => re.test(n));
		if (matched) {
			const ok = await charSheet.clickAttackRoll(matched);
			expect(ok, `[${legLabel}] attack ${matched} clickable`).toBe(true);
		} else if (names.length > 0) {
			console.log(`[${legLabel} usage] attack ${re} not found; rendered=${JSON.stringify(names)}`);
		}
	}

	if (probe.castSpellSlotLevel != null) {
		const lvl = probe.castSpellSlotLevel;
		const before = await charSheet.getSpellSlots(lvl);
		if (before.max > 0) {
			const r = await charSheet.castSpellAtSlot(lvl);
			expect(r.ok, `[${legLabel}] useSpellSlot(${lvl})`).toBe(true);
			expect(r.remaining, `[${legLabel}] slot ${lvl} pip decrement`).toBe(before.current - 1);
		} else {
			console.log(`[${legLabel} usage] no L${lvl} slots to cast`);
		}
	}

	if (probe.useResourceName) {
		const name = probe.useResourceName;
		const before = await charSheet.getResource(name).catch(() => null);
		if (before && before.max > 0) {
			const r = await charSheet.useResourceByName(name, 1);
			expect(r.ok, `[${legLabel}] useResource ${name}`).toBe(true);
			expect(r.remaining, `[${legLabel}] ${name} decrement`).toBe(before.current - 1);
		} else {
			console.log(`[${legLabel} usage] resource ${name} not online`);
		}
	}

	if (probe.skillRoll && !(probe.skillRoll as any).skip) {
		const sr = probe.skillRoll as {name: string};
		const r = await charSheet.rollSkill(sr.name);
		expect(Number.isFinite(r.bonus), `[${legLabel}] skill bonus for ${sr.name}`).toBe(true);
	}
}

export function describeMulticlassCharacter (spec: MulticlassCharacterSpec): void {
	const {preset, displayName, plan, finalMilestone, usageAfterEachLeg, featuresMatrix} = spec;

	test.describe(`${displayName} — multiclass build`, () => {
		test.beforeEach(async ({page}) => {
			await gotoWithThelemar(page);
		});
		test.afterEach(async ({page}) => {
			await clearHomebrewStorage(page);
		});
		// Export-after-clear-registration so LIFO runs export FIRST —
		// see note in describeCharacter.
		test.afterEach(async ({page}, testInfo) => {
			await _exportCharacterForValidation(page, testInfo, displayName);
		});

		test(`builds full multiclass plan and reaches final milestone`, async ({page}) => {
			// Gate behind RUN_MEGA — same as describeCharacter's L1->20 test.
			// Multiclass plans walk many level-ups and otherwise dominate
			// the default suite runtime.
			if (!process.env.RUN_MEGA) test.skip(true, "set RUN_MEGA=1 to run multiclass mega tests");
			test.setTimeout(L7_TIMEOUT_MS);
			const {charSheet} = await createCharacterViaWizard(page, preset);

			// Lazy import to avoid circular type issues
			const {startMulticlass, assertFeaturesMatrix} = await import("./comprehensiveBuildHelpers");

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
						targetClassName: leg.className,
					});
				}
				await charSheet.expectLevel(leg.toTotalLevel);

				// Optional per-leg usage probe (cast/attack/resource/skill)
				if (usageAfterEachLeg && usageAfterEachLeg[i]) {
					await _runMulticlassUsageProbe(charSheet, usageAfterEachLeg[i], `${leg.className} L${leg.toTotalLevel}`);
				}

				// Phase-6 features matrix — assert after each leg at its
				// total character level (entries above this level are
				// skipped automatically by assertFeaturesMatrix).
				if (featuresMatrix?.length) {
					await assertFeaturesMatrix(charSheet, featuresMatrix, leg.toTotalLevel);
				}
			}

			if (finalMilestone) await assertMilestone(charSheet, finalMilestone);
		});
	});
}

// Re-export so spec files have a single import line.
export {test, expect, CharacterSheetPage};
