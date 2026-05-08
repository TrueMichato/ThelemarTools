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

/** Belly Dancer Rogue / Pugilist Painful Strikes — picks at L3+. */
export function buildPainfulStrikeChecks (
	progression: Array<{level: number; cum: number}> = [
		{level: 3, cum: 2}, {level: 9, cum: 3}, {level: 13, cum: 4}, {level: 17, cum: 5},
	],
	levelMap?: Record<number, number>,
): FeatureCheck[] {
	return buildOptionalFeatureChecks(
		/Painful Strikes|Strikes/i, TGTT_PAINFUL_STRIKES, TGTT_PAINFUL_STRIKE_EFFECTS, progression, levelMap,
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
