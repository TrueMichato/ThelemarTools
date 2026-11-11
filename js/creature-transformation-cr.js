import {getCreatureTransformationProficiencyBonus} from "./creature-transformation-stats.js";

const CRS = ["0", "1/8", "1/4", "1/2", ...Array.from({length: 30}, (_, i) => `${i + 1}`)];
const PB_SOURCES = ["derived-cr", "source-profBonus", "source-pbNote", "source-input"];
const isRecord = value => value != null && typeof value === "object" && !Array.isArray(value);
const keysAre = (value, required, optional = []) => isRecord(value) && required.every(key => Object.hasOwn(value, key))
	&& Object.keys(value).every(key => [...required, ...optional].includes(key));
const isNumber = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const isInteger = (value, min, max) => Number.isSafeInteger(value) && isNumber(value, min, max);
const isText = value => typeof value === "string" && !!value.trim() && value.length <= 1000;
const isCr = value => CRS.includes(value);
const crNumber = cr => cr.includes("/") ? Number(cr.split("/")[0]) / Number(cr.split("/")[1]) : Number(cr);
const isAmount = value => keysAre(value, ["value", "proficiency"]) && isNumber(value.value, 0, 100_000) && isInteger(value.proficiency, 0, 100);
const isOverride = value => value === null || (keysAre(value, ["cr", "reason"]) && isCr(value.cr) && isText(value.reason));
const isProficiencyAnswer = value => value === null || (keysAre(value, ["mode", "value", "reason"])
	&& ["derived", "source-fixed"].includes(value.mode) && isInteger(value.value, 1, 30) && isText(value.reason));
const isProficiencyContext = value => value === null || (keysAre(value, ["ownership", "index", "integrity", "value"])
	&& ["derived", "explicit", "ambiguous"].includes(value.ownership) && isInteger(value.index, 0, 99)
	&& (value.integrity === null || (typeof value.integrity === "string" && /^[a-f0-9]{8}$/.test(value.integrity)))
	&& isInteger(value.value, 1, 30));

function fail (message) {
	const error = new Error(`CR estimate: ${message}`);
	error.code = "CREATURE_TRANSFORMATION_INPUT_REQUIRED";
	throw error;
}

function isAssumptions (value) {
	if (!keysAre(value, ["defense", "routines", "routine", "review", "override", "zeroXp", "proficiencyAnswer"]) || !isText(value.review)
		|| !isOverride(value.override) || typeof value.zeroXp !== "boolean" || !isProficiencyAnswer(value.proficiencyAnswer)) return false;
	const defense = value.defense;
	if (!keysAre(defense, ["expectedCr", "hpBoundary", "acIndex", "acAdjustment", "hpAdjustment", "resistance", "vulnerability", "regeneration", "note"])
		|| !isCr(defense.expectedCr) || !isInteger(defense.acIndex, 0, 19) || !isInteger(defense.acAdjustment, -100, 100)
		|| ![null, "lower", "higher"].includes(defense.hpBoundary)
		|| !isInteger(defense.hpAdjustment, -100_000, 100_000) || !["none", "resistance", "immunity"].includes(defense.resistance)
		|| typeof defense.vulnerability !== "boolean" || !isInteger(defense.regeneration, 0, 1000) || !isText(defense.note)) return false;
	if (!Array.isArray(value.routines) || !value.routines.length || value.routines.length > 12
		|| [...value.routines].some(routine => !keysAre(routine, ["id", "rounds", "accuracy", "note"])
			|| typeof routine.id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(routine.id) || !isText(routine.note)
			|| !Array.isArray(routine.rounds) || routine.rounds.length !== 3 || ![...routine.rounds].every(isAmount)
			|| !keysAre(routine.accuracy, ["kind", "value", "proficiency"]) || !["attack", "save"].includes(routine.accuracy.kind)
			|| !isInteger(routine.accuracy.value, routine.accuracy.kind === "save" ? 0 : -100, 100) || !isInteger(routine.accuracy.proficiency, 0, 2))
		|| new Set(value.routines.map(it => it.id)).size !== value.routines.length) return false;
	return value.routine === "highest-damage" || value.routines.some(it => it.id === value.routine);
}

function getTable (table) {
	if (!Array.isArray(table) || table.length !== CRS.length) fail("Supply all 34 ordered rows from data/msbcr.json (CR 0 through 30).");
	for (const [i, row] of table.entries()) {
		if (!keysAre(row, ["_cr", "pb", "ac", "hpMin", "hpMax", "attackBonus", "dprMin", "dprMax", "saveDc"]) || row._cr !== CRS[i]
			|| row.pb !== Parser.crToPb(row._cr) || !["ac", "hpMin", "hpMax", "attackBonus", "dprMin", "dprMax", "saveDc"].every(key => isInteger(row[key], 0, 1000))
			|| row.hpMin > row.hpMax || row.dprMin > row.dprMax
			|| row.hpMin !== (i ? table[i - 1].hpMax + (i >= 32 ? 0 : 1) : 1) || row.dprMin !== (i ? table[i - 1].dprMax + 1 : 0)) fail("The CR table has an invalid, missing, reordered or noncanonical row.");
	}
	if (table.at(-1).hpMax !== 850 || table.at(-1).dprMax !== 320) fail("The CR table must retain the version-matched 850 HP / 320 DPR domain.");
	return table;
}

export function getCreatureTransformationCrProficiency ({current, proficiencyBonus, proficiencyContext = null, answer = null}) {
	if (!isRecord(current)) fail("A concrete target is required.");
	const raw = current.cr;
	if (isRecord(raw) && (!keysAre(raw, ["cr"], ["xp"]) || (raw.xp !== undefined && !isInteger(raw.xp, 0, 1_000_000)))) {
		fail("Lair/coven/conditional or custom CR fields need a source-specific policy; this contract replaces only plain CR and XP.");
	}
	const cr = isRecord(raw) ? raw.cr : raw;
	const explicit = getCreatureTransformationProficiencyBonus(current, proficiencyBonus, {checkNote: true});
	if (!isProficiencyContext(proficiencyContext) || !isProficiencyAnswer(answer)) fail("Proficiency ownership needs exact validated history evidence or a bounded explicit answer.");
	if (proficiencyContext && proficiencyContext.value !== explicit) fail("Proficiency ownership evidence no longer matches the current engine/display PB; preview the current history again.");
	if (answer && answer.value !== explicit) fail("The proficiency ownership answer must match the current numeric PB.");
	if (proficiencyContext?.ownership === "ambiguous" && !answer) fail("Intervening operations make PB ownership ambiguous; explicitly choose derived or source-fixed PB with its current value and a reason.");
	const sourceFixed = explicit !== undefined && proficiencyContext?.ownership !== "derived"
		&& !(proficiencyContext?.ownership === "ambiguous" && answer?.mode === "derived");
	if (sourceFixed && answer?.mode === "derived") fail("Known authored PB cannot be discarded by a derived-PB answer.");
	if (explicit !== undefined) {
		return {
			before: explicit,
			source: answer?.mode === "source-fixed" ? "source-input" : sourceFixed
				? current.profBonus !== undefined ? "source-profBonus" : current.pbNote !== undefined ? "source-pbNote" : "source-input"
				: "derived-cr",
			history: structuredClone(proficiencyContext),
		};
	}
	if (!isCr(cr)) fail("A canonical current CR or explicit source PB is required; unknown CR cannot supply an ordinary PB.");
	return {before: Parser.crToPb(cr), source: "derived-cr", history: null};
}

function getNearestCr (value) {
	return CRS.reduce((best, cr) => Math.abs(crNumber(cr) - value) <= Math.abs(crNumber(best) - value) ? cr : best, "0");
}

function getShiftedCr (table, index, difference) {
	// Each complete two-point difference moves one table row, with CR 0 as the floor.
	const next = Math.max(0, index + Math.trunc(difference / 2));
	if (next >= table.length) fail("Adjusted CR exceeds the CR 30 table domain; supply supported assumptions rather than accepting a capped estimate.");
	return table[next]._cr;
}

function evaluate ({table, current, assumptions, proficiency, pb}) {
	const defense = assumptions.defense;
	if (!isInteger(current.hp?.average, 1, 1_000_000) || !Array.isArray(current.ac)) fail("Concrete post-transformation HP and an explicitly selected AC alternative are required.");
	const armor = current.ac[defense.acIndex];
	const armorClass = typeof armor === "number" ? armor : armor?.ac;
	if (!isInteger(armorClass, 0, 100)) fail("The chosen AC alternative is missing or special; resolve its numeric value first.");
	const expectedCr = crNumber(defense.expectedCr);
	const multiplier = defense.resistance === "none" ? 1
		: defense.resistance === "resistance" ? expectedCr <= 4 ? 2 : expectedCr <= 10 ? 1.5 : expectedCr <= 16 ? 1.25 : 1
			: expectedCr <= 10 ? 2 : expectedCr <= 16 ? 1.5 : 1.25;
	// DMG effective defenses multiply actual HP; regeneration/other feature HP is added afterwards.
	const effectiveHp = Math.floor(current.hp.average * multiplier * (defense.vulnerability ? 0.5 : 1) + 3 * defense.regeneration + defense.hpAdjustment);
	const effectiveAc = armorClass + defense.acAdjustment;
	const hpIndices = table.flatMap((row, i) => effectiveHp >= row.hpMin && effectiveHp <= row.hpMax ? [i] : []);
	// This version of msbcr overlaps at 760 and 805 HP. The caller must declare the boundary policy.
	if (hpIndices.length > 1 && defense.hpBoundary === null) fail("Overlapping HP table rows require an explicit lower or higher boundary policy.");
	const hpIndex = (defense.hpBoundary === "higher" ? hpIndices.at(-1) : hpIndices[0]) ?? -1;
	if (hpIndex < 0 || !isInteger(effectiveAc, 0, 200)) fail("Effective HP/AC falls outside the supported CR table; no boundary cap or zero-CR fallback is applied.");
	const defensiveCr = getShiftedCr(table, hpIndex, effectiveAc - table[hpIndex].ac);
	const routines = assumptions.routines.map(routine => {
		const rounds = routine.rounds.map(it => it.value + it.proficiency * (pb - proficiency.before));
		if (rounds.some(value => !isNumber(value, 0, 100_000))) fail(`Routine ${routine.id} has unsupported damage after its declared PB contribution.`);
		const damagePerRound = Math.floor(rounds.reduce((sum, value) => sum + value, 0) / 3);
		const index = table.findIndex(row => damagePerRound >= row.dprMin && damagePerRound <= row.dprMax);
		if (index < 0) fail(`Routine ${routine.id} exceeds the CR table damage domain; no capped estimate is returned.`);
		const accuracy = routine.accuracy.value + routine.accuracy.proficiency * (pb - proficiency.before);
		if (!isInteger(accuracy, routine.accuracy.kind === "save" ? 0 : -100, 100)) fail(`Routine ${routine.id} has unsupported accuracy.`);
		const baseline = routine.accuracy.kind === "attack" ? table[index].attackBonus : table[index].saveDc;
		return {id: routine.id, damagePerRound, accuracy, offensiveCr: getShiftedCr(table, index, accuracy - baseline)};
	});
	const choices = assumptions.routine === "highest-damage"
		? routines.filter(it => it.damagePerRound === Math.max(...routines.map(routine => routine.damagePerRound)))
		: routines.filter(it => it.id === assumptions.routine);
	if (choices.length !== 1) fail("Highest-damage routines tie; explicitly choose a routine rather than guessing which accuracy or save DC applies.");
	const routine = choices[0];
	return {
		estimatedCr: getNearestCr((crNumber(defensiveCr) + crNumber(routine.offensiveCr)) / 2),
		defensiveCr,
		offensiveCr: routine.offensiveCr,
		effectiveHp,
		effectiveAc,
		routineId: routine.id,
		damagePerRound: routine.damagePerRound,
		accuracy: routine.accuracy,
	};
}

/**
 * Numeric DMG estimate only. Callers explicitly adjudicate coverage, defenses and first-three-round
 * routines at post-ability/pre-PB values; this never interprets feature prose or scales a creature.
 */
export function estimateCreatureTransformationCr (options) {
	if (!keysAre(options, ["current", "table", "assumptions"], ["proficiencyBonus", "proficiencyContext"])) fail("Provide current, table and exact numeric assumptions, with optional source PB and validated ownership context only.");
	const {current, assumptions} = options;
	if (!isAssumptions(assumptions)) fail("Declare defense/expected CR, three-round routines with explicit PB contributions, routine selection, full effect review, override (or null) and zeroXp policy; unsupported effects require guided resolution.");
	const table = getTable(options.table);
	const proficiency = getCreatureTransformationCrProficiency({...options, answer: assumptions.proficiencyAnswer});
	const explicit = proficiency.source !== "derived-cr";
	const overrideCr = assumptions.override?.cr;
	const domain = explicit ? [proficiency.before] : overrideCr ? [table[CRS.indexOf(overrideCr)].pb] : [2, 3, 4, 5, 6, 7, 8, 9];
	const outcomes = domain.map(pb => {
		const result = evaluate({table, current, assumptions, proficiency, pb});
		const cr = overrideCr ?? result.estimatedCr;
		const canonical = table[CRS.indexOf(cr)].pb;
		return {result, cr, pb, canonical};
	});
	const matches = outcomes.filter(it => explicit || it.pb === it.canonical);
	if (matches.length !== 1) fail(`CR/PB dependency is unresolved (${matches.length} fixed points in the complete eight-value PB domain); choose an explicit CR override or resolve the source inputs. No last-iteration fallback is saved.`);
	const {result, cr, pb, canonical} = matches[0];
	if (assumptions.zeroXp && cr !== "0") fail("The no-threat 0 XP policy is valid only for a final CR of 0.");
	const step = {
		op: "setChallengeRating",
		value: {cr, xp: assumptions.zeroXp ? 0 : Parser.crToXpNumber(cr)},
		receipt: {
			method: "dmg-2014-v1",
			table: "data/msbcr.json",
			...result,
			assumptions: structuredClone(assumptions),
			proficiency: {...proficiency, after: pb, canonical},
		},
	};
	if (!isCreatureTransformationCrChange(step)) fail("The calculated estimate cannot be represented by the frozen CR contract.");
	return step;
}

export function isCreatureTransformationCrOp (op) { return op === "setChallengeRating"; }

export function isCreatureTransformationCrChange (step, key = "op") {
	if (!keysAre(step, [key, "value", "receipt"]) || !isCreatureTransformationCrOp(step[key])
		|| !keysAre(step.value, ["cr", "xp"]) || !isCr(step.value.cr) || !isInteger(step.value.xp, 0, 1_000_000)) return false;
	const receipt = step.receipt;
	if (!keysAre(receipt, ["method", "table", "estimatedCr", "defensiveCr", "offensiveCr", "effectiveHp", "effectiveAc", "routineId", "damagePerRound", "accuracy", "assumptions", "proficiency"])
		|| receipt.method !== "dmg-2014-v1" || receipt.table !== "data/msbcr.json"
		|| ![receipt.estimatedCr, receipt.defensiveCr, receipt.offensiveCr].every(isCr)
		|| !isInteger(receipt.effectiveHp, 1, 850) || !isInteger(receipt.effectiveAc, 0, 200)
		|| !isInteger(receipt.damagePerRound, 0, 320) || !isInteger(receipt.accuracy, -100, 100)
		|| !isAssumptions(receipt.assumptions) || !receipt.assumptions.routines.some(it => it.id === receipt.routineId)) return false;
	const pb = receipt.proficiency;
	const answer = receipt.assumptions.proficiencyAnswer;
	return keysAre(pb, ["before", "after", "source", "canonical", "history"]) && PB_SOURCES.includes(pb.source) && isProficiencyContext(pb.history)
		&& isInteger(pb.before, 1, 30) && isInteger(pb.after, 1, 30) && isInteger(pb.canonical, 2, 9)
		&& (pb.history === null || pb.history.value === pb.before)
		&& (pb.history?.ownership !== "ambiguous" || answer !== null)
		&& (answer === null || (answer.value === pb.before && pb.source === (answer.mode === "derived" ? "derived-cr" : "source-input")))
		&& (pb.history?.ownership !== "explicit" || pb.source !== "derived-cr")
		&& (pb.history?.ownership !== "derived" || answer !== null || pb.source === "derived-cr")
		&& (pb.source === "derived-cr" ? pb.after === pb.canonical : pb.before === pb.after)
		&& pb.canonical === Parser.crToPb(step.value.cr)
		&& step.value.cr === (receipt.assumptions.override?.cr ?? receipt.estimatedCr)
		&& step.value.xp === (receipt.assumptions.zeroXp ? 0 : Parser.crToXpNumber(step.value.cr))
		&& (!receipt.assumptions.zeroXp || (step.value.cr === "0" && step.value.xp === 0));
}
