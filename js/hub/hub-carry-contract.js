/**
 * The single definition of carrying capacity and encumbrance for every surface.
 *
 * Before this module the same arithmetic existed five times and the copies disagreed on
 * screen: the Character Sheet's inventory bar judged encumbrance on `STR × 5`, its own
 * `getEncumbranceLevel()` judged it on 50% of capacity (so play mode and the PDF could call
 * a character "normal" while the bar beside them said "Encumbered"), the DM Screen Party
 * Tracker recomputed capacity without size, flat bonuses or extradimensional containers,
 * and the server projection recomputed it again as `STR × 15` with no knowledge of the
 * Thelemar rules at all.
 *
 * This module owns the arithmetic and the vocabulary. Each surface owns only an adapter
 * that maps its own data shape onto {@link normalizeCarryInput}. That split is what stops
 * the formulas re-diverging: there is nowhere else for a formula to live.
 *
 * Browser-safe and dependency-free, in the same spirit as `hub-json-patch.js` and
 * `hub-semantic-hp.js`, so the server imports it directly rather than reimplementing it
 * (ADR 0011: derived statistics "must read these values from the authoritative sheet
 * calculation rather than reimplementing it"). It performs no fetches, DOM work, storage
 * writes or mutation of its inputs.
 */

/**
 * RAW 5e size scaling for carrying capacity (PHB, "Size and Strength"): each size category
 * above Medium doubles capacity and push/drag/lift; Tiny halves them.
 *
 * The Thelemar "Carrying Capacity (Passive Might)" table resolves to exactly the same
 * ladder — Tiny ×5, Small/Medium ×10, Large ×20, Huge ×40, Gargantuan ×80 against a
 * per-point value of 10 — so one table serves both rules rather than two near-copies.
 */
export const SIZE_CARRY_MULTIPLIERS = Object.freeze({
	tiny: 0.5,
	small: 1,
	medium: 1,
	large: 2,
	huge: 4,
	gargantuan: 8,
});

const SIZE_ORDER = Object.freeze(["tiny", "small", "medium", "large", "huge", "gargantuan"]);

/** Per-point capacity multiplier for each capacity rule. */
const RULE_PER_POINT = Object.freeze({standard: 15, thelemar: 10});

/**
 * Encumbrance tiers, deliberately modelled **separately from maximum capacity** and keyed
 * by a named policy so a rules change is a data edit rather than a code hunt.
 *
 * `phb-variant` is quoted from the PHB "Encumbrance" variant rule: "If you carry weight in
 * excess of 5 times your Strength score, you are encumbered… in excess of 10 times your
 * Strength score, up to your maximum carrying capacity, you are instead heavily
 * encumbered." The tiers key off the **Strength score**, not off carrying capacity. PHB
 * "Size and Strength" scales *carrying capacity and push/drag/lift* and says nothing about
 * these tiers, so size, Powerful Build and flat bonuses must NOT move them. Expressing the
 * tiers as a fraction of capacity would look equivalent only for an unmodified Small/Medium
 * character and would silently change the rule for every Large or Powerful Build one.
 *
 * `thelemar-proportional` is a **house extension, not a TGTT rule**. The Thelemar carrying
 * capacity rule defines a maximum and a drag/lift/push limit and no intermediate tiers at
 * all; its only stated consequence is that exceeding your maximum caps Speed at 5 feet.
 * These ratios mirror the RAW proportions (`STR×5 : STR×15` = 1/3, `STR×10 : STR×15` = 2/3)
 * so Thelemar characters keep a usable warning, and `thelemar_encumbranceTiers` turns them
 * off in favour of the rules-faithful `capacity-only` policy.
 */
export const ENCUMBRANCE_THRESHOLD_RULES = Object.freeze({
	"phb-variant": Object.freeze({kind: "abilityScoreMultiple", encumbered: 5, heavilyEncumbered: 10}),
	"thelemar-proportional": Object.freeze({kind: "capacityFraction", encumbered: 1 / 3, heavilyEncumbered: 2 / 3}),
	"capacity-only": Object.freeze({kind: "capacityOnly"}),
	"none": Object.freeze({kind: "none"}),
});

/** Encumbrance levels. String values match the historical `getEncumbranceLevel()` contract. */
export const CARRY_STATUS = Object.freeze({
	normal: "normal",
	encumbered: "encumbered",
	heavilyEncumbered: "heavily_encumbered",
	overCapacity: "over_capacity",
	unknown: "unknown",
});

/** PHB "Coins": 50 coins weigh a pound. */
const COINS_PER_POUND = 50;
const COIN_KEYS = Object.freeze(["pp", "gp", "ep", "sp", "cp"]);

/**
 * A weight or capacity that arithmetic may safely use. Rejects `NaN`, `Infinity`, negative
 * values and non-numeric input rather than letting them propagate into a total that would
 * render as `NaN` or as a silently wrong number.
 * @param {*} value
 * @param {number} fallback
 * @returns {number}
 */
function toFiniteNonNegative (value, fallback = 0) {
	if (value === null || value === undefined || value === "" || typeof value === "boolean") return fallback;
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER) return fallback;
	return number;
}

/**
 * A multiplier. Zero is rejected as well as negatives: a zero multiplier would silently
 * collapse capacity to nothing and make every character permanently over capacity.
 * @param {*} value
 * @returns {number}
 */
function toPositiveMultiplier (value) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0 || number > Number.MAX_SAFE_INTEGER) return 1;
	return number;
}

function toSize (value) {
	const size = typeof value === "string" ? value.toLowerCase().trim() : "";
	return Object.hasOwn(SIZE_CARRY_MULTIPLIERS, size) ? size : "medium";
}

function toIntegerSteps (value) {
	const number = Number(value);
	if (!Number.isFinite(number)) return 0;
	return Math.trunc(number);
}

/**
 * Size multiplier after any carry-only size steps (e.g. the Aurochs Zodiac Form's "count as
 * one size larger for carrying capacity", which must not alter combat size). Clamped to the
 * ends of the ladder so an extreme step cannot fall off the table and yield `undefined`.
 * @param {string} size
 * @param {number} carrySizeSteps
 * @returns {number}
 */
export function getSizeCarryMultiplier (size, carrySizeSteps = 0) {
	const normalizedSize = toSize(size);
	const steps = toIntegerSteps(carrySizeSteps);
	const index = SIZE_ORDER.indexOf(normalizedSize);
	if (index < 0) return SIZE_CARRY_MULTIPLIERS[normalizedSize] ?? 1;
	const shifted = Math.max(0, Math.min(index + steps, SIZE_ORDER.length - 1));
	return SIZE_CARRY_MULTIPLIERS[SIZE_ORDER[shifted]] ?? 1;
}

/**
 * Weight of a coin pile in pounds.
 *
 * Always computed so a surface can show it, whether or not the active rules count it
 * against the load — see `isCoinWeightCounted`. Counting coins by default would silently
 * add weight to every existing character (a 1,000 gp purse is 20 lb), so the decision is
 * left to the caller and defaults to off.
 * @param {object} coinCounts A `{pp, gp, ep, sp, cp}` map; unknown keys are ignored.
 * @returns {number} Weight in pounds.
 */
export function getCoinWeight (coinCounts) {
	if (!coinCounts || typeof coinCounts !== "object" || Array.isArray(coinCounts)) return 0;
	const total = COIN_KEYS.reduce((sum, key) => sum + toFiniteNonNegative(coinCounts[key]), 0);
	return total / COINS_PER_POUND;
}

/**
 * Clamp and default a raw adapter payload into the shape the rest of this module trusts.
 *
 * This is the single place unsafe input is made safe. Every other function assumes a
 * normalized input, so a malformed weight cannot reach the arithmetic from any surface.
 * @param {object} raw
 * @returns {object} A frozen normalized input.
 */
export function normalizeCarryInput (raw = {}) {
	const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
	const rule = source.rule === "thelemar" ? "thelemar" : "standard";
	const size = toSize(source.size);
	const carrySizeSteps = toIntegerSteps(source.carrySizeSteps);

	const thresholdRuleId = Object.hasOwn(ENCUMBRANCE_THRESHOLD_RULES, source.thresholdRuleId)
		? source.thresholdRuleId
		: (rule === "thelemar" ? "thelemar-proportional" : "phb-variant");

	const capacityOverrideRaw = source.capacityOverride;
	const capacityOverride = capacityOverrideRaw === null || capacityOverrideRaw === undefined
		? null
		: (Number.isFinite(Number(capacityOverrideRaw)) && Number(capacityOverrideRaw) >= 0
			? toFiniteNonNegative(capacityOverrideRaw)
			: null);

	const coinCounts = source.coinCounts && typeof source.coinCounts === "object" && !Array.isArray(source.coinCounts)
		? Object.freeze(Object.fromEntries(COIN_KEYS.map(key => [key, toFiniteNonNegative(source.coinCounts[key])])))
		: Object.freeze(Object.fromEntries(COIN_KEYS.map(key => [key, 0])));

	return Object.freeze({
		rule,
		thresholdRuleId,
		// The value the capacity formula multiplies: STR score (standard) or passive Might
		// (Thelemar). Defaults to 10 — an unmodified score — rather than 0, so a missing
		// ability never renders a character as having no capacity at all.
		sourceValue: toFiniteNonNegative(source.sourceValue, 10),
		// The value the PHB variant tiers key off. Always the STRENGTH SCORE, even under the
		// Thelemar capacity rule, because the tiers are defined on the score and not on
		// whatever value happens to drive capacity.
		thresholdSourceValue: toFiniteNonNegative(source.thresholdSourceValue, 10),
		size,
		carrySizeSteps,
		flatBonus: toFiniteNonNegative(source.flatBonus),
		carryMultiplier: toPositiveMultiplier(source.carryMultiplier),
		externalCapacity: toFiniteNonNegative(source.externalCapacity),
		capacityOverride,
		grossWeight: toFiniteNonNegative(source.grossWeight),
		fillableWeight: toFiniteNonNegative(source.fillableWeight),
		coinCounts,
		isCoinWeightCounted: source.isCoinWeightCounted === true,
		unknownStackCount: Math.max(0, Math.trunc(toFiniteNonNegative(source.unknownStackCount))),
	});
}

/**
 * Encumbrance tiers in pounds for a given policy, or `null` when the policy defines none.
 *
 * Kept separate from capacity so that changing capacity (size, Powerful Build, a flat
 * bonus, a DM override) provably cannot move a `phb-variant` threshold.
 * @param {object} input A normalized input.
 * @param {number} bodyCapacity
 * @returns {{encumbered: number, heavilyEncumbered: number}|null}
 */
export function getEncumbranceThresholds (input, bodyCapacity) {
	const policy = ENCUMBRANCE_THRESHOLD_RULES[input.thresholdRuleId] ?? ENCUMBRANCE_THRESHOLD_RULES["phb-variant"];
	switch (policy.kind) {
		case "abilityScoreMultiple":
			return {
				encumbered: input.thresholdSourceValue * policy.encumbered,
				heavilyEncumbered: input.thresholdSourceValue * policy.heavilyEncumbered,
			};
		case "capacityFraction":
			return {
				encumbered: bodyCapacity * policy.encumbered,
				heavilyEncumbered: bodyCapacity * policy.heavilyEncumbered,
			};
		case "capacityOnly":
		case "none":
		default:
			return null;
	}
}

/**
 * The full carrying-capacity breakdown.
 *
 * The returned shape is a strict superset of the Character Sheet's historical
 * `getCarryingCapacityBreakdown()` result, so existing consumers and their tests keep
 * working while gaining the freshness and coin fields.
 * @param {object} rawInput
 * @returns {object} A frozen profile.
 */
export function getCarryProfile (rawInput = {}) {
	const input = Object.isFrozen(rawInput) && rawInput.thresholdRuleId ? rawInput : normalizeCarryInput(rawInput);

	const perPoint = RULE_PER_POINT[input.rule];
	const base = input.sourceValue * perPoint;
	const sizeMultiplier = getSizeCarryMultiplier(input.size, input.carrySizeSteps);

	// A DM override replaces the derived body capacity outright, but must still produce a
	// status: an overridden character is not an unmeasured one.
	const derivedBodyCapacity = (base + input.flatBonus) * input.carryMultiplier * sizeMultiplier;
	const bodyCapacity = input.capacityOverride === null ? derivedBodyCapacity : input.capacityOverride;

	// Extradimensional storage (Bag of Holding, Heward's Handy Haversack) holds a fixed
	// weight regardless of the bearer, so it is added AFTER the body multipliers and is
	// never scaled by size or Powerful Build.
	const externalCapacity = input.externalCapacity;
	const bagCapacity = externalCapacity;
	const hasExtradimensional = bagCapacity > 0;

	// Implicit fill-bag-first split: stowable gear notionally fills the container before any
	// overflow lands back on the body. With no container equipped this is a no-op, so
	// behaviour is identical to a character without one.
	const coinWeight = getCoinWeight(input.coinCounts);
	const countedCoinWeight = input.isCoinWeightCounted ? coinWeight : 0;
	const grossWeight = input.grossWeight + countedCoinWeight;
	const fillableWeight = hasExtradimensional ? input.fillableWeight : 0;
	const bagLoad = Math.min(fillableWeight, bagCapacity);
	const bodyLoad = Math.max(0, grossWeight - bagLoad);

	const thresholds = getEncumbranceThresholds(input, bodyCapacity);
	const isIndeterminate = input.unknownStackCount > 0;

	const profile = {
		rule: input.rule,
		thresholdRuleId: input.thresholdRuleId,
		sourceValue: input.sourceValue,
		thresholdSourceValue: input.thresholdSourceValue,
		perPoint,
		base,
		flatBonus: input.flatBonus,
		carryMultiplier: input.carryMultiplier,
		sizeMultiplier,
		bodyCapacity,
		externalCapacity,
		bagCapacity,
		grossWeight,
		fillableWeight,
		bagLoad,
		bodyLoad,
		hasExtradimensional,
		total: bodyCapacity + externalCapacity,
		// Push/drag/lift is the bearer's physical Strength limit (2 × body capacity).
		// Extradimensional storage is not a lifting aid, so it never contributes.
		pushDragLift: bodyCapacity * 2,
		coinWeight,
		isCoinWeightCounted: input.isCoinWeightCounted,
		unknownStackCount: input.unknownStackCount,
		isIndeterminate,
		thresholds,
		spareCapacity: bodyCapacity - bodyLoad,
		isCapacityOverridden: input.capacityOverride !== null,
	};
	profile.status = getCarryStatus(profile).level;
	return Object.freeze(profile);
}

/**
 * The encumbrance level implied by a profile.
 *
 * Judged on the load actually ON THE BODY against the BODY capacity: encumbrance measures
 * physical strain, so a Bag of Holding must not mask the strain of heavy worn armour, and
 * its fixed capacity must not inflate the denominator.
 *
 * An indeterminate load (a stack whose weight the data does not give) is reported as such
 * rather than being rounded down into a confident "normal": the known weight is a lower
 * bound, so only an over-capacity verdict is safe to state, and only when the known part
 * already exceeds capacity.
 * @param {object} profile
 * @returns {{level: string, ratio: number|null, isOverCapacity: boolean, isIndeterminate: boolean}}
 */
export function getCarryStatus (profile) {
	const bodyCapacity = toFiniteNonNegative(profile?.bodyCapacity);
	const bodyLoad = toFiniteNonNegative(profile?.bodyLoad);
	const thresholds = profile?.thresholds ?? null;
	const isIndeterminate = profile?.isIndeterminate === true;
	const ratio = bodyCapacity > 0 ? bodyLoad / bodyCapacity : null;

	if (bodyLoad > bodyCapacity) {
		return {level: CARRY_STATUS.overCapacity, ratio, isOverCapacity: true, isIndeterminate};
	}
	// Below capacity with unknown stacks outstanding, no tier can be asserted: the true load
	// could sit in any band above the known one.
	if (isIndeterminate) {
		return {level: CARRY_STATUS.unknown, ratio, isOverCapacity: false, isIndeterminate: true};
	}
	if (thresholds) {
		if (bodyLoad > thresholds.heavilyEncumbered) {
			return {level: CARRY_STATUS.heavilyEncumbered, ratio, isOverCapacity: false, isIndeterminate: false};
		}
		if (bodyLoad > thresholds.encumbered) {
			return {level: CARRY_STATUS.encumbered, ratio, isOverCapacity: false, isIndeterminate: false};
		}
	}
	return {level: CARRY_STATUS.normal, ratio, isOverCapacity: false, isIndeterminate: false};
}

/**
 * The consequence of a proposed change, for a transfer preview.
 *
 * Purely a projection of two profiles the caller already owns; it never reaches for a third
 * party's data, so it cannot become a channel for inferring a peer's hidden inventory.
 * @param {{before: object, after: object}} params
 * @returns {object} A frozen delta.
 */
export function getCarryDelta ({before, after} = {}) {
	const beforeStatus = before ? getCarryStatus(before) : null;
	const afterStatus = after ? getCarryStatus(after) : null;
	const loadDelta = toFiniteNonNegative(after?.bodyLoad) - toFiniteNonNegative(before?.bodyLoad);
	const capacityDelta = toFiniteNonNegative(after?.bodyCapacity) - toFiniteNonNegative(before?.bodyCapacity);
	return Object.freeze({
		before: beforeStatus,
		after: afterStatus,
		loadDelta,
		capacityDelta,
		crossesThreshold: !!beforeStatus && !!afterStatus && beforeStatus.level !== afterStatus.level,
		becomesOverCapacity: !!afterStatus?.isOverCapacity && !beforeStatus?.isOverCapacity,
		relievesOverCapacity: !!beforeStatus?.isOverCapacity && !afterStatus?.isOverCapacity,
	});
}

/**
 * Party-wide totals.
 *
 * Members are bucketed rather than blended. A member whose carry authority is missing or
 * stale is `unavailable` and is COUNTED, never estimated: rendering it as zero would read
 * as "carrying nothing", and substituting a guess would be exactly the stale number the
 * authority boundary exists to prevent. Nothing here is reversible into a hidden peer's
 * load, because an excluded member contributes nothing to any total.
 * @param {{members?: Array, stashWeight?: number|null, stashUnknownStackCount?: number}} params
 * @returns {object} A frozen aggregate.
 */
export function getPartyCarryAggregate ({members = [], stashWeight = null, stashUnknownStackCount = 0} = {}) {
	const rows = Array.isArray(members) ? members : [];
	const out = {
		memberCount: rows.length,
		knownCount: 0,
		indeterminateCount: 0,
		unavailableCount: 0,
		overCapacityCount: 0,
		totalBodyLoad: 0,
		totalBodyCapacity: 0,
		totalSpareCapacity: 0,
		unknownStackCount: 0,
		stashWeight: stashWeight === null ? null : toFiniteNonNegative(stashWeight),
		stashUnknownStackCount: Math.max(0, Math.trunc(toFiniteNonNegative(stashUnknownStackCount))),
	};

	for (const member of rows) {
		const profile = member?.profile ?? null;
		if (!profile || member?.state === "unavailable") {
			out.unavailableCount++;
			continue;
		}
		const status = getCarryStatus(profile);
		if (status.isOverCapacity) out.overCapacityCount++;
		// A caller may know a member is indeterminate without that being reconstructible from
		// the profile alone (a projected summary carries the fact as its own field), so trust
		// an explicit member state as well.
		if (profile.isIndeterminate || member?.state === "indeterminate") {
			out.indeterminateCount++;
			out.unknownStackCount += profile.unknownStackCount;
		} else out.knownCount++;
		out.totalBodyLoad += toFiniteNonNegative(profile.bodyLoad);
		out.totalBodyCapacity += toFiniteNonNegative(profile.bodyCapacity);
		out.totalSpareCapacity += toFiniteNonNegative(profile.bodyCapacity) - toFiniteNonNegative(profile.bodyLoad);
	}

	// Partiality is reported PER QUANTITY, because the body total and the stash total are
	// independent sums that can each be complete or partial on their own. A single combined
	// flag was wrong in both directions at once: an exact party body was marked `≥` merely
	// because the shared stash held an unweighed stack, while that stash's own total — the
	// one actually in doubt — was rendered as exact.
	out.isBodyTotalPartial = out.indeterminateCount > 0 || out.unavailableCount > 0;
	out.isStashTotalPartial = out.stashUnknownStackCount > 0;
	// Retained for callers that legitimately want "is anything on this line uncertain?".
	out.isTotalPartial = out.isBodyTotalPartial || out.isStashTotalPartial;
	return Object.freeze(out);
}

/**
 * Whether the active policy may block on carry, and why.
 *
 * Always advisory today, by two independent constraints. ADR 0015 lists `tgtt.carry-weight`
 * as `planned` with no rules evaluator, and a rule may only be labelled *Enforced* once all
 * of its required surfaces are `implemented` — so no campaign can legitimately demand
 * enforcement yet. Independently, ADR 0011 forbids letting hidden item truth be inferred
 * from "transfer previews… encumbrance warnings, capacity formulas, or resource-specific
 * failures", so a blocking carry check would itself be a disclosure channel.
 *
 * The seam exists so the future evaluator has somewhere to plug in; it adds no blocking
 * behaviour now.
 * @param {{profile?: object, policy?: object}} params
 * @returns {{disposition: string, isBlocking: boolean, reasons: string[]}}
 */
export function getCarryEnforcement ({profile, policy = null} = {}) {
	const reasons = [];
	const status = profile ? getCarryStatus(profile) : null;
	if (status?.isOverCapacity) reasons.push("over_capacity");
	else if (status?.level === CARRY_STATUS.heavilyEncumbered) reasons.push("heavily_encumbered");
	else if (status?.level === CARRY_STATUS.encumbered) reasons.push("encumbered");

	// An unsupported or unknown rule is never given an Enforced label (ADR 0015): existing
	// play stays available rather than being blocked by a rule nothing can evaluate.
	if (policy && policy.mode === "enforced") {
		return Object.freeze({disposition: "unavailable", isBlocking: false, reasons: Object.freeze(reasons)});
	}
	return Object.freeze({disposition: "advisory", isBlocking: false, reasons: Object.freeze(reasons)});
}
