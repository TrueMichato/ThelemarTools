import {observeCreatureTransformationBindings} from "./creature-transformation-bindings.js";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const keysAre = (value, required, optional = []) => record(value) && required.every(key => Object.hasOwn(value, key))
	&& Object.keys(value).every(key => [...required, ...optional].includes(key));
const text = value => typeof value === "string" && !!value.trim() && value.length <= 1000;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function requireAnswer (condition, reason, control, selector = null) {
	if (condition) return;
	const error = new Error(reason);
	Object.assign(error, {code: "CREATURE_TRANSFORMATION_INPUT_REQUIRED", control, selector});
	throw error;
}

export function observeCreatureTransformationRoutineEntries ({current, chassisSource, scope}) {
	const observed = observeCreatureTransformationBindings({current, chassisSource});
	for (const entry of observed) {
		entry.id = JSON.stringify([scope, entry.section, entry.match]);
		for (const token of entry.tokens) token.id = JSON.stringify([entry.id, token.paragraph, token.kind, token.token]);
	}
	requireAnswer(new Set(observed.map(item => item.id)).size === observed.length, "Resolve duplicate source-qualified entry identities before declaring numbers.", "entries");
	return observed;
}

export function composeCreatureTransformationRoutines ({model, projection, bindings, answer, proficiency, compactReview = false}) {
	requireAnswer(keysAre(answer, ["defense", "routines", "routine", "review", "override", "zeroXp", "proficiencyAnswer", "coverage"])
		&& keysAre(answer.review, ["confirmed", "reason"]) && answer.review.confirmed === true && text(answer.review.reason),
	"Explicitly confirm completeness with an explanation; unsupported effects cannot be silently omitted.", "cr", "review");
	requireAnswer(Array.isArray(answer.coverage) && answer.coverage.length === model.entries.length
		&& model.entries.every(entry => answer.coverage.filter(it => keysAre(it, ["entryId", "decision", "reason", ...compactReview ? ["tokens"] : []]) && it.entryId === entry.id
			&& ["represented", "excluded"].includes(it.decision) && text(it.reason)).length === 1),
	"Review inclusion/exclusion of every observed entry, including baked dice, riders, spells and alternatives.", "cr", "coverage");
	if (compactReview) {
		requireAnswer(model.entries.every(entry => {
			const coverage = answer.coverage.find(item => item.entryId === entry.id);
			return Array.isArray(coverage.tokens) && coverage.tokens.length === entry.tokens.length
			&& entry.tokens.every(token => coverage.tokens.filter(item => keysAre(item, ["tokenId", "decision", "reason"]) && item.tokenId === token.id
				&& ["represented", "excluded"].includes(item.decision) && text(item.reason)).length === 1);
		}), "Explicitly review every numeric token, including unselected damage riders and generated DCs; entry-level confirmation alone is incomplete.", "cr", "coverage");
	}
	const represented = (entry, token) => {
		const coverage = answer.coverage.find(item => item.entryId === entry.id);
		return coverage?.decision === "represented"
			&& (!compactReview || coverage.tokens.find(item => item.tokenId === token.id)?.decision === "represented");
	};
	requireAnswer(Array.isArray(answer.routines) && answer.routines.length >= 1 && answer.routines.length <= 12, "Choose 1 to 12 complete alternative routines.", "cr", "routines");
	requireAnswer(keysAre(bindings, ["armor", "entries"], ["proficiencyBonus"]) && Array.isArray(bindings.entries), "Declare exact M2 numeric bindings before composing routines.", "bindings");
	const observed = observeCreatureTransformationBindings({current: projection, chassisSource: model.chassisSource});
	const tokens = new Map();
	for (const entry of model.entries) {
		const after = observed.find(it => it.section === entry.section && same(it.match, entry.match));
		for (const token of entry.tokens) {
			const projected = after?.tokens.find(it => it.paragraph === token.paragraph && it.kind === token.kind && it.token === token.token);
			const binding = bindings.entries.find(it => it.section === entry.section && same(it.match, entry.match));
			const number = binding?.numbers?.find(it => it.paragraph === token.paragraph && it.kind === token.kind && it.token === token.token);
			tokens.set(token.id, {entry,
				token: projected,
				supported: entry.supported && after?.supported,
				proficiency: number?.mode === "ability" ? number.proficiency : 0});
		}
	}
	const includedDamage = new Set();
	const routines = answer.routines.map(routine => {
		requireAnswer(keysAre(routine, ["id", "rows", "accuracy", "mixedReason", "note"]) && text(routine.note)
			&& Array.isArray(routine.rows) && routine.rows.length >= 1 && routine.rows.length <= 24, "Each routine needs 1..24 reviewed contribution rows.", "cr", routine?.id);
		const rounds = Array.from({length: 3}, () => ({value: 0, proficiency: 0}));
		const notes = [];
		for (const row of routine.rows) {
			requireAnswer(keysAre(row, ["counts", "targets", "timing", "reason"], ["tokenId", "fixed", ...compactReview ? ["accountsFor"] : []]) && text(row.reason)
				&& ["normal", "conditional", "off-turn", "ongoing", "recharge", "limited-use"].includes(row.timing)
				&& ["counts", "targets"].every(key => Array.isArray(row[key]) && row[key].length === 3
					&& [...row[key]].every(value => integer(value, key === "counts" ? 0 : 1, key === "counts" ? 20 : 100)))
				&& (Object.hasOwn(row, "tokenId") !== Object.hasOwn(row, "fixed")), "Review exactly three rounds of counts, targets, timing and source.", "cr", routine.id);
			let value;
			let coefficient = 0;
			if (Object.hasOwn(row, "tokenId")) {
				requireAnswer(!Object.hasOwn(row, "accountsFor"), "Only a bounded fixed adjudication can explicitly account for other damage tokens.", "cr", routine.id);
				const selected = tokens.get(row.tokenId);
				requireAnswer(selected?.supported && selected.token?.kind === "damage", "Select an exact supported observed damage token; unsupported contributions remain unresolved.", "cr", row.tokenId);
				requireAnswer(represented(selected.entry, {id: row.tokenId}), "A selected contribution cannot be marked excluded.", "cr", row.tokenId);
				value = selected.token.average;
				requireAnswer(selected.proficiency === 0 || proficiency.source !== "derived-cr"
					|| selected.token.mean + selected.proficiency * (2 - proficiency.before) >= 0,
				"A per-token zero-floor crossing cannot be represented by linear M3 PB coefficients; supply a bounded fixed adjudication.", "cr", row.tokenId);
				coefficient = selected.proficiency;
				if (row.counts.some(count => count > 0)) includedDamage.add(row.tokenId);
				notes.push(`${selected.entry.match.name}|${selected.entry.match.source} ${selected.token.kind}:${selected.token.paragraph}:${selected.token.token}`);
			} else {
				requireAnswer(keysAre(row.fixed, ["value", "source", "reason"]) && Number.isFinite(row.fixed.value) && row.fixed.value >= 0
					&& row.fixed.value <= 100_000 && keysAre(row.fixed.source, ["name", "source"])
					&& text(row.fixed.source.name) && text(row.fixed.source.source) && text(row.fixed.reason),
				"Fixed contributions need a bounded per-use value, source-qualified adjudication and reason.", "cr", routine.id);
				value = row.fixed.value;
				if (Object.hasOwn(row, "accountsFor")) {
					requireAnswer(Array.isArray(row.accountsFor) && row.accountsFor.length >= 1 && row.accountsFor.length <= 100
						&& new Set(row.accountsFor).size === row.accountsFor.length
						&& row.accountsFor.every(id => {
							const selected = tokens.get(id);
							return selected?.token?.kind === "damage" && represented(selected.entry, {id});
						}),
					"Fixed accountsFor must name distinct exact represented damage tokens; unknown, excluded or non-damage tokens cannot be accounted for.", "cr", routine.id);
					if (row.counts.some(count => count > 0)) row.accountsFor.forEach(id => includedDamage.add(id));
				}
				notes.push(`${row.fixed.source.name}|${row.fixed.source.source} fixed ${value}: ${row.fixed.reason}`);
			}
			notes.push(`${row.counts.join("/")} uses x ${row.targets.join("/")} targets; ${row.timing}: ${row.reason}`);
			for (let i = 0; i < 3; ++i) {
				rounds[i].value += value * row.counts[i] * row.targets[i];
				rounds[i].proficiency += coefficient * row.counts[i] * row.targets[i];
			}
		}
		const accuracy = tokens.get(routine.accuracy);
		const fixedAccuracy = compactReview && keysAre(routine.accuracy, ["kind", "value", "source", "reason"])
			&& ["attack", "save"].includes(routine.accuracy.kind) && integer(routine.accuracy.value, routine.accuracy.kind === "save" ? 0 : -100, 100)
			&& keysAre(routine.accuracy.source, ["name", "source"]) && text(routine.accuracy.source.name) && text(routine.accuracy.source.source) && text(routine.accuracy.reason);
		requireAnswer((fixedAccuracy || (accuracy?.supported && ["hit", "dc"].includes(accuracy.token?.kind))) && text(routine.mixedReason),
			"Deliberately choose supported attack/save accuracy and explain predominant/mixed measures.", "cr", routine.id);
		requireAnswer(fixedAccuracy || represented(accuracy.entry, {id: routine.accuracy}),
			"The selected accuracy source must be represented in the review.", "cr", routine.accuracy);
		return {id: routine.id,
			rounds,
			accuracy: fixedAccuracy ? {kind: routine.accuracy.kind, value: routine.accuracy.value, proficiency: 0}
				: {kind: accuracy.token.kind === "hit" ? "attack" : "save", value: accuracy.token.value, proficiency: accuracy.proficiency},
			note: [routine.note, routine.mixedReason, ...fixedAccuracy ? [`${routine.accuracy.source.name}|${routine.accuracy.source.source}: ${routine.accuracy.reason}`] : [], ...notes].join("; ")};
	});
	if (compactReview) {
		for (const [id, selected] of tokens) {
			const coverage = answer.coverage.find(item => item.entryId === selected.entry.id).tokens.find(item => item.tokenId === id);
			requireAnswer(!selected.supported || selected.token?.kind !== "damage" || coverage.decision !== "represented" || includedDamage.has(id),
				"Each represented damage token needs a positive use in at least one declared routine or an exact bounded fixed adjudication with accountsFor; otherwise explicitly exclude it with a reason.", "cr", id);
		}
	}
	return {defense: structuredClone(answer.defense),
		routines,
		routine: answer.routine,
		review: compactReview ? answer.review.reason : [answer.review.reason, ...answer.coverage.map(it => `${model.entries.find(entry => entry.id === it.entryId).match.name}: ${it.decision}: ${it.reason}`)].join("; "),
		override: structuredClone(answer.override),
		zeroXp: answer.zeroXp,
		proficiencyAnswer: structuredClone(answer.proficiencyAnswer)};
}
