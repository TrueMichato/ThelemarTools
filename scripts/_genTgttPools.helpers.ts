// ────────────────────────────────────────────────────────────────────────
// build*Checks helpers — emit FeatureCheck arrays that specs spread
// into their featuresMatrix. Each helper attaches a "pickedFeatureGrants"
// effect for the auto-picker's deterministic first choice (when an
// effect map entry exists), so the test verifies not just that a pick
// surfaced but that the picked option's documented effect lands on the
// sheet.
//
// All progression arrays are defaults — pass an explicit progression
// to override (e.g. for multiclass specs).
// ────────────────────────────────────────────────────────────────────────

function applyLevelMap (level: number, levelMap?: Record<number, number>): number {
	return levelMap?.[level] ?? level;
}

function pickedGrants (pickName: string, subEffects?: EffectCheck[]): EffectCheck[] {
	if (!subEffects || subEffects.length === 0) return [];
	return [{kind: "pickedFeatureGrants", pickName, subEffects}];
}

/**
 * Mark every FeatureCheck in `checks` as `{skip: true, skipReason}`.
 *
 * Use this to keep coverage visible when a helper's picks are blocked
 * by a known product bug — see `docs/charactersheet/known-bugs.md`.
 * Doctrine (per `.agents/skills/e2e-character-tests/references/standard.md`):
 * the helper invocation MUST stay in the matrix even when the picks
 * can't be asserted; `withSkipReason` carries the CS-BUG-NNN pointer
 * so the audit tool and human reviewers can see the gap.
 *
 * Example:
 *   ...withSkipReason(buildJesterActChecks(), "CS-BUG-017"),
 */
export function withSkipReason (checks: FeatureCheck[], skipReason: string): FeatureCheck[] {
	return checks.map(c => ({...c, skip: true, skipReason}));
}

/**
 * Generate FeatureCheck entries for the TGTT "Specialties" pick at each
 * level the class gains a new specialty. Each entry asserts that
 * cumulative `pickedCount` distinct specialty names from the class's
 * pool surface in the feature list, and (if the class has an entry in
 * TGTT_SPECIALTY_EFFECTS) attaches a `pickedFeatureGrants` effect for
 * the auto-picker's deterministic first pick.
 *
 * Multiclass usage: pass the class-level you expect at the milestone
 * (not character-level) — `levelMap` maps class-level → character-level.
 */
export function buildSpecialtyChecks (className: string, levelMap?: Record<number, number>): FeatureCheck[] {
	const pool = TGTT_SPECIALTIES[className];
	const levels = TGTT_SPECIALTY_LEVELS[className];
	if (!pool || !levels) return [];
	const firstPick = TGTT_SPECIALTY_FIRST_PICK[className];
	const subEffects = firstPick ? TGTT_SPECIALTY_EFFECTS?.[className]?.[firstPick] : undefined;
	const grants = firstPick ? pickedGrants(firstPick, subEffects) : [];
	return levels.map((classLevel, idx) => ({
		level: applyLevelMap(classLevel, levelMap),
		name: /specialties/i,
		kind: "pick" as const,
		pickedCount: idx + 1,
		pickedFrom: pool,
		// Per-pick effect attached only at the first milestone — re-checking
		// the same effect at every milestone would be redundant.
		effects: idx === 0 && grants.length ? grants : undefined,
	}));
}

/**
 * Recover the auto-picker's deterministic first choice (lexicographic)
 * from a regex pool. Pools emitted by the generator are
 * `/^Name$/i` literals, so we strip the anchors and case flag.
 */
function readableFirstPick (pool: RegExp[]): string | undefined {
	const names: string[] = [];
	for (const r of pool) {
		const m = /^\/\^(.+?)\$\/i?$/.exec(r.toString());
		if (m) names.push(m[1].replace(/\\(.)/g, "$1"));
	}
	if (!names.length) return undefined;
	return names.sort((a, b) => a.localeCompare(b))[0];
}

function buildOptionalFeatureChecks (
	featureName: RegExp,
	pool: RegExp[],
	effectMap: Record<string, EffectCheck[] | undefined> | undefined,
	progression: Array<{level: number; cum: number}>,
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	const firstPickName = readableFirstPick(pool);
	const subEffects = firstPickName ? effectMap?.[firstPickName] : undefined;
	const grants = firstPickName ? pickedGrants(firstPickName, subEffects) : [];
	return progression.map(({level, cum}, idx) => ({
		level: applyLevelMap(level, levelMap),
		name: featureName,
		kind: "pick" as const,
		pickedCount: cum,
		pickedFrom: pool,
		effects: idx === 0 && grants.length ? grants : undefined,
	}));
}

/**
 * Fighter Battle Tactics — emits one FeatureCheck per cumulative
 * milestone (L3/7/10/15) and attaches a `pickedFeatureGrants` effect
 * for the auto-picker's first choice at L3.
 */
export function buildBattleTacticChecks (levelMap?: Record<number, number>): FeatureCheck[] {
	const milestones = Object.entries(TGTT_BATTLE_TACTICS_CUM)
		.map(([lvl, cum]) => ({level: Number(lvl), cum}))
		.sort((a, b) => a.level - b.level);
	return buildOptionalFeatureChecks(
		/Battle Tactics/i, TGTT_BATTLE_TACTICS, TGTT_BATTLE_TACTIC_EFFECTS, milestones, levelMap,
	);
}

/**
 * Sorcerer Metamagic — TGTT homebrew lets sorcerers pick MM options at
 * L3/10/17 (matches XPHB). Pass a progression override if needed.
 */
export function buildMetamagicChecks (
	progression: Array<{level: number; cum: number}> = [
		{level: 3, cum: 2}, {level: 10, cum: 3}, {level: 17, cum: 4},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Metamagic/i, TGTT_METAMAGIC, TGTT_METAMAGIC_EFFECTS, progression, levelMap,
	);
}

/**
 * Warlock Eldritch Invocations — XPHB Warlock learns invocations at
 * L2/5/7/9/12/15/18.
 */
export function buildInvocationChecks (
	progression: Array<{level: number; cum: number}> = [
		{level: 2, cum: 2}, {level: 5, cum: 3}, {level: 7, cum: 4},
		{level: 9, cum: 5}, {level: 12, cum: 6}, {level: 15, cum: 7}, {level: 18, cum: 8},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Eldritch Invocations|Invocations/i,
		TGTT_ELDRITCH_INVOCATIONS,
		TGTT_ELDRITCH_INVOCATION_EFFECTS,
		progression,
		levelMap,
	);
}

/** Jester Bard Acts — picks at L3 (subclass arrival) and grow on level-up. */
export function buildJesterActChecks (
	progression: Array<{level: number; cum: number}> = [
		{level: 3, cum: 2}, {level: 6, cum: 3}, {level: 14, cum: 4},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Jester Acts|Acts/i, TGTT_JESTER_ACTS, TGTT_JESTER_ACT_EFFECTS, progression, levelMap,
	);
}

/** Trickster Rogue Tricks — picks at L3+. */
export function buildTricksterTrickChecks (
	progression: Array<{level: number; cum: number}> = [
		{level: 3, cum: 2}, {level: 9, cum: 3}, {level: 13, cum: 4}, {level: 17, cum: 5},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Trickster Tricks|Tricks/i, TGTT_TRICKSTER_TRICKS, TGTT_TRICKSTER_TRICK_EFFECTS, progression, levelMap,
	);
}

/** Monk Debilitation Precise Strike Methods (TGTT) — Monk-subclass-only
 *  feature. 3 picks at L3, +1 each at L6/11/17 (cumulative 3/4/5/6).
 *  No other class or subclass grants this feature. */
export function buildPreciseStrikeChecks (
	progression: Array<{level: number; cum: number}> = [
		{level: 3, cum: 3}, {level: 6, cum: 4}, {level: 11, cum: 5}, {level: 17, cum: 6},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Precise Strike Methods|Precise Strike/i, TGTT_PRECISE_STRIKES, TGTT_PRECISE_STRIKE_EFFECTS, progression, levelMap,
	);
}

/** TGTT Warlock Pact Boons — Pact of Transformation single pick at L3. */
export function buildPactBoonChecks (
	progression: Array<{level: number; cum: number}> = [{level: 3, cum: 1}],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Pact Boon/i, TGTT_PACT_BOONS, TGTT_PACT_BOON_EFFECTS, progression, levelMap,
	);
}

/** Dreamwalker subclass calls/customs and studies/specials. */
export function buildDreamwalkerChecks (
	customsProgression: Array<{level: number; cum: number}> = [{level: 3, cum: 1}, {level: 10, cum: 2}],
	specialsProgression: Array<{level: number; cum: number}> = [{level: 6, cum: 2}, {level: 14, cum: 4}],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return [
		...buildOptionalFeatureChecks(
			/Dreamwalker Calls|Customs/i,
			TGTT_DREAMWALKER_CUSTOMS,
			TGTT_DREAMWALKER_CUSTOM_EFFECTS,
			customsProgression,
			levelMap,
		),
		...buildOptionalFeatureChecks(
			/Dreamwalker Studies|Specials/i,
			TGTT_DREAMWALKER_SPECIALS,
			TGTT_DREAMWALKER_SPECIAL_EFFECTS,
			specialsProgression,
			levelMap,
		),
	];
}

/**
 * XPHB Weapon Mastery — emits one pick check at the given level with
 * `pickedFeatureGrants` sub-effects per provided weapon name.
 */
export function buildWeaponMasteryChecks (
	weaponNames: string[],
	level: number = 1,
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	const effects: EffectCheck[] = weaponNames.flatMap(w => {
		const sub = XPHB_WEAPON_MASTERY_EFFECTS?.[w] ?? [];
		return sub.length ? [{kind: "pickedFeatureGrants" as const, pickName: w, subEffects: sub}] : [];
	});
	const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return [{
		level: applyLevelMap(level, levelMap),
		name: /Weapon Mastery/i,
		kind: "pick" as const,
		pickedCount: weaponNames.length,
		pickedFrom: weaponNames.map(w => new RegExp("^" + escape(w) + "$", "i")),
		effects: effects.length ? effects : undefined,
	}];
}


// ────────────────────────────────────────────────────────────────────────
// Cross-source helpers — union per-source pools and call the common
// optional-feature-check builder. Effect maps are merged per-pick.
// ────────────────────────────────────────────────────────────────────────

const _CROSS_SOURCE_POOLS = {
	EI: {XPHB: EI_XPHB, XGE: EI_XGE, PHB: EI_PHB, TCE: EI_TCE, TGTT: TGTT_ELDRITCH_INVOCATIONS},
	MM: {XPHB: MM_XPHB, PHB: MM_PHB, TCE: MM_TCE, TGTT: TGTT_METAMAGIC},
	AS: {XGE: AS_XGE},
	"MV:B": {XPHB: MVB_XPHB, PHB: MVB_PHB, TCE: MVB_TCE},
	PB: {XPHB: PB_XPHB, PHB: PB_PHB, TCE: PB_TCE, TGTT: TGTT_PACT_BOONS},
} as const;

const _CROSS_SOURCE_EFFECTS = {
	EI: {XPHB: XPHB_INVOCATION_EFFECTS, TGTT: TGTT_ELDRITCH_INVOCATION_EFFECTS},
	MM: {XPHB: XPHB_METAMAGIC_EFFECTS, TGTT: TGTT_METAMAGIC_EFFECTS},
	AS: {XGE: XGE_ARCANE_SHOT_EFFECTS},
	"MV:B": {XPHB: XPHB_MANEUVER_EFFECTS},
	PB: {XPHB: XPHB_PACT_BOON_EFFECTS, TGTT: TGTT_PACT_BOON_EFFECTS},
} as const;

function _mergedEffectMap (
	featureType: keyof typeof _CROSS_SOURCE_EFFECTS,
	sources: string[],
): Record<string, EffectCheck[] | undefined> {
	const merged: Record<string, EffectCheck[] | undefined> = {};
	const bucket = _CROSS_SOURCE_EFFECTS[featureType] as Record<string, Record<string, EffectCheck[] | undefined> | undefined>;
	for (const src of sources) {
		const m = bucket?.[src];
		if (!m) continue;
		for (const [k, v] of Object.entries(m)) {
			if (merged[k] === undefined) merged[k] = v;
		}
	}
	return merged;
}

function _unionPool (
	featureType: keyof typeof _CROSS_SOURCE_POOLS,
	sources: string[],
): RegExp[] {
	const seen = new Set<string>();
	const out: RegExp[] = [];
	const bucket = _CROSS_SOURCE_POOLS[featureType] as Record<string, RegExp[] | undefined>;
	for (const src of sources) {
		for (const re of (bucket?.[src] ?? [])) {
			const key = re.toString();
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(re);
		}
	}
	return out.sort((a, b) => a.toString().localeCompare(b.toString()));
}

/** Eldritch Invocations across an arbitrary mix of sources. */
export function buildAnyInvocationChecks (
	sources: string[] = ["XPHB", "XGE", "TGTT"],
	progression: Array<{level: number; cum: number}> = [
		{level: 2, cum: 2}, {level: 5, cum: 3}, {level: 7, cum: 4},
		{level: 9, cum: 5}, {level: 12, cum: 6}, {level: 15, cum: 7}, {level: 18, cum: 8},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Eldritch Invocations|Invocations/i,
		_unionPool("EI", sources),
		_mergedEffectMap("EI", sources),
		progression,
		levelMap,
	);
}

/** Metamagic — TGTT-focused by default. XPHB metamagic is intentionally
 *  excluded from the default sources because the TGTT spec suite focuses
 *  on TGTT homebrew variants; pass `["XPHB","TGTT"]` explicitly if a spec
 *  genuinely needs both. */
export function buildAnyMetamagicChecks (
	sources: string[] = ["TGTT"],
	progression: Array<{level: number; cum: number}> = [
		{level: 3, cum: 2}, {level: 10, cum: 3}, {level: 17, cum: 4},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Metamagic/i,
		_unionPool("MM", sources),
		_mergedEffectMap("MM", sources),
		progression,
		levelMap,
	);
}

/** Battle Master Maneuvers across an arbitrary mix of sources. */
export function buildAnyManeuverChecks (
	sources: string[] = ["XPHB"],
	progression: Array<{level: number; cum: number}> = [
		{level: 3, cum: 3}, {level: 7, cum: 5}, {level: 10, cum: 7}, {level: 15, cum: 9},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Maneuvers|Combat Superiority/i,
		_unionPool("MV:B", sources),
		_mergedEffectMap("MV:B", sources),
		progression,
		levelMap,
	);
}

/** Arcane Shot options (XGE — Arcane Archer Fighter). */
export function buildAnyArcaneShotChecks (
	progression: Array<{level: number; cum: number}> = [
		{level: 3, cum: 2}, {level: 7, cum: 3}, {level: 10, cum: 4},
		{level: 15, cum: 5}, {level: 18, cum: 6},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Arcane Shot/i,
		_unionPool("AS", ["XGE"]),
		_mergedEffectMap("AS", ["XGE"]),
		progression,
		levelMap,
	);
}

/** Pact Boons across an arbitrary mix of sources. */
export function buildAnyPactBoonChecks (
	sources: string[] = ["XPHB", "TGTT"],
	progression: Array<{level: number; cum: number}> = [{level: 3, cum: 1}],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Pact Boon/i,
		_unionPool("PB", sources),
		_mergedEffectMap("PB", sources),
		progression,
		levelMap,
	);
}

// ────────────────────────────────────────────────────────────────────────
// Subclass-feature catalog helper (Zodiac forms, Precise Strike Methods).
// Catalogs differ from pickers: every entry surfaces on the sheet for any
// character of that subclass; the spec asserts existence of every entry
// AND verifies the documented effect of one representative entry.
// ────────────────────────────────────────────────────────────────────────

export function buildCatalogChecks (args: {
	pool: RegExp[];
	level: number;
	featureNameRe?: RegExp;
	repName?: string;
	effectMap?: Record<string, EffectCheck[] | undefined>;
	levelMap?: Record<number, number>;
}): FeatureCheck[] {
	const {pool, level, featureNameRe, repName, effectMap, levelMap} = args;
	const charLevel = applyLevelMap(level, levelMap);
	const out: FeatureCheck[] = [];
	for (const re of pool) {
		out.push({
			level: charLevel,
			name: re,
			kind: "passive" as const,
		});
	}
	if (repName && featureNameRe) {
		const sub = effectMap?.[repName];
		if (sub && sub.length) {
			out.push({
				level: charLevel,
				name: featureNameRe,
				kind: "passive" as const,
				effects: [{kind: "pickedFeatureGrants" as const, pickName: repName, subEffects: sub}],
			});
		}
	}
	return out;
}

/** Convenience wrapper for Zodiac Druid forms — emits L3 + L10 catalogs. */
export function buildZodiacFormChecks (levelMap?: Record<number, number>): FeatureCheck[] {
	return [
		...buildCatalogChecks({
			pool: ZODIAC_FORMS_L3, level: ZODIAC_FORMS_L3_LEVEL,
			featureNameRe: /Zodiac Form: Month/i,
			repName: "Roc",
			effectMap: ZODIAC_FORM_EFFECTS,
			levelMap,
		}),
		...buildCatalogChecks({
			pool: ZODIAC_FORMS_L10, level: ZODIAC_FORMS_L10_LEVEL,
			featureNameRe: /Zodiac Form: Star Week/i,
			repName: "Unicorn",
			effectMap: ZODIAC_FORM_EFFECTS,
			levelMap,
		}),
	];
}
