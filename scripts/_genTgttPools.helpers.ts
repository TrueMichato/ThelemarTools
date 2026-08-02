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

/**
 * TGTT Combat Methods — the pick-list shared by Barbarian / Fighter / Monk /
 * Paladin / Ranger / Rogue.
 *
 * This helper is shaped differently from every other `build*Checks` above, for
 * two measured reasons.
 *
 * **1. WHICH methods a character holds is not deterministic.** Tradition access
 * is a build-time choice, so two characters of the same class, subclass and
 * level routinely hold disjoint method sets — spawning the same build
 * repeatedly yields a different tradition mix each time. Anchoring on specific
 * method names would be flaky. What IS deterministic is HOW MANY they hold:
 * the class table's "Methods Known" column, plus any outright grants.
 *
 * **2. `kind: "pick"` over `TGTT_COMBAT_METHODS_BY_TRADITION` is UNSOUND, and
 * this was measured, not assumed.** That constant unions to 321 name patterns,
 * many of them generic single words, and they collide with features that are
 * not combat methods at all. A wizard-built Centaur Ranger 3 scored 4 matches
 * against a true count of 3: the extra was `Charge`, a *Centaur racial trait*
 * sharing a name with a combat method. A collision count varies by race and
 * class, so such an assertion is neither tight nor stable — it can be satisfied
 * by features that are not combat methods.
 *
 * So the count is asserted through the product's own structural API instead.
 * `getCombatMethods()` filters `_data.features` with
 * `CharacterSheetClassUtils.isCombatMethod()`, which is immune to name
 * collisions, and `stateCall` compares it with `exact` rather than a lower
 * bound — so this catches a LOST pick and a SPURIOUS extra alike.
 *
 * ⚠️ `exact` is NOT monotone-safe. The features matrix re-evaluates every
 * earlier entry at each later checkpoint, so a fixed exact count would fail by
 * construction as the pool grows. Each tier therefore carries `untilLevel`,
 * closing at the level below the next milestone.
 *
 * Auto-granted methods (Ranger's Primal Focus Upgrade at L6 is the only one in
 * the dataset today) are counted into the expected total AND asserted by name
 * — via `contains` on the same structural API, so a same-named racial cannot
 * satisfy them. Counting them is what stops a lost pick hiding behind a grant.
 *
 * 🔴 **PASS `subclassName` OR THE COUNT WILL BE TOO LOW.** 27 subclasses grant
 * an extra method outright — "you learn one additional method from this
 * tradition" — across Fighter (11), Monk (14), Paladin (Oathbreaker) and Rogue
 * (Swashbuckler); Eldritch Knight grants TWO. These carry no method name, so
 * they can only feed the count. A TGTT Monk 3 picks 2 from the class table and
 * is granted 1 by its subclass, for a true total of 3 — measured, after an
 * Astral Self run failed with `length=3, expected 2`. Omitting the grant
 * under-counts by exactly the grant, which is indistinguishable from a lost
 * pick, so this is a false red rather than a missed one. Barbarian and Ranger
 * have NO subclass grants, which is why a Ranger-only validation missed this.
 *
 * 🔴 **ONLY VALID ON A `classSource: "TGTT"` PRESET.** Combat Methods are a
 * TGTT class feature; a PHB / XPHB build of the same class has none, and this
 * helper would then assert a whole ladder against a constant zero. Not every
 * spec for an eligible class qualifies — e.g. `PRESET_FULL_METEOR_KNIGHT_FIGHTER`
 * and `PRESET_FULL_SHADOW_KNIGHT_FIGHTER` are both `classSource: "PHB"`, so the
 * Fighter ladder must NOT be spread into those specs even though Fighter is an
 * eligible class. Check the preset's `classSource` before adding a spread.
 *
 * @param className   Class whose "Methods Known" ladder to assert.
 * @param opts.subclassName   Subclass short name, e.g. "Astral Self". Required
 *                         whenever the subclass appears in
 *                         `TGTT_COMBAT_METHOD_SUBCLASS_GRANTS`.
 * @param opts.maxClassLevel  Highest level actually reached IN THIS CLASS.
 *                         Required for multiclass legs: a Ranger 6 / Druid 14
 *                         never gains Ranger 7+, so emitting the full ladder
 *                         would assert Ranger-13 counts at character level 13.
 * @param opts.levelMap    class-level \u2192 character-level, for multiclass specs.
 */
export function buildCombatMethodChecks (
	className: string,
	opts?: {subclassName?: string; maxClassLevel?: number; levelMap?: Record<number, number>},
): FeatureCheck[] {
	const ladder = TGTT_COMBAT_METHODS_KNOWN[className];
	if (!ladder?.length) return [];

	const cap = opts?.maxClassLevel ?? ladder.length;
	const grants = (TGTT_COMBAT_METHOD_AUTO_GRANTS[className] ?? []).filter(g => g.level <= cap);
	const subGrants = (opts?.subclassName
		? TGTT_COMBAT_METHOD_SUBCLASS_GRANTS[className]?.[opts.subclassName] ?? []
		: []).filter(g => g.level <= cap);
	const grantedBy = (level: number): number => grants
		.filter(g => g.level <= level)
		.reduce((n, g) => n + g.names.length, 0)
		+ subGrants
			.filter(g => g.level <= level)
			.reduce((n, g) => n + g.count, 0);

	// One milestone per level where the total actually moves.
	const milestones: {level: number; total: number}[] = [];
	let prevTotal = 0;
	ladder.forEach((picked, idx) => {
		const level = idx + 1;
		if (level > cap) return;
		const total = picked + grantedBy(level);
		if (total <= prevTotal) return;
		prevTotal = total;
		milestones.push({level, total});
	});

	const checks: FeatureCheck[] = milestones.map((m, idx) => {
		const next = milestones[idx + 1];
		return {
			level: applyLevelMap(m.level, opts?.levelMap),
			// `untilLevel` is mandatory here — see the `exact` note above.
			...(next ? {untilLevel: applyLevelMap(next.level - 1, opts?.levelMap)} : {}),
			name: /combat methods/i,
			kind: "passive" as const,
			effects: [{kind: "stateCall" as const, method: "getCombatMethods", path: "length", exact: m.total}],
		};
	});

	// Outright grants are deterministic, so assert them by name — through the
	// same structural API, so a same-named racial trait cannot satisfy them.
	for (const g of grants) {
		checks.push({
			level: applyLevelMap(g.level, opts?.levelMap),
			name: /combat methods/i,
			kind: "passive" as const,
			effects: g.names.map(name => ({kind: "stateCall" as const, method: "getCombatMethods", contains: name})),
		});
	}

	return checks.sort((a, b) => a.level - b.level);
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
