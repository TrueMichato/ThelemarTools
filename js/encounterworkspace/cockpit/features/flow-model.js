/**
 * P3c — pure view models for the flow features (no DOM): the timeline, the log drawer, turn-order moves, the end-of-combat
 * summary and group-name suggestions. The UI modules in this folder only turn these into elements.
 */

/* -------------------------------------------- Timeline -------------------------------------------- */

/** Rounds visible at once; the window starts one round before the current one so the last round stays in view. */
export const FLOW_TIMELINE_ROUNDS = 4;
const SPAN_STEP_PX = 17;
const LANE_MIN_PX = 38;

const clampPct = n => Math.max(0, Math.min(100, n));
const round3 = n => Math.round(n * 1000) / 1000;

/**
 * lanes: [{id, label, name?, hp, hpMax, ac, conc, isSel, isViewed, spans: [{key, label, k: "up"|"down"|"bf"|"cond", rounds, start?}]}]
 * in turn order. Spans without `start` began this round. Returns positions in % of the track width:
 * {round, r0, roundsShown, axis: [{round, left, isNow}], nowLeft, lanes: [{...lane, isTurn, dots, spans, minHeight}]}.
 */
export function getFlowTimelineModel ({round = 0, activeId = null, lanes = [], roundsShown = FLOW_TIMELINE_ROUNDS}) {
	const R = Math.max(1, roundsShown);
	const r0 = Math.max(1, round - 1);
	const n = Math.max(1, lanes.length);
	const curIdx = round > 0 ? Math.max(0, lanes.findIndex(it => it.id === activeId)) : 0;
	const x = (r, idx) => clampPct(((r - r0) + idx / n) / R * 100);
	const nowLeft = round > 0 ? round3(x(round, curIdx)) : 0;
	const axis = Array.from({length: R}, (_, i) => ({round: r0 + i, left: round3(i / R * 100), isNow: r0 + i === round}));
	return {
		round,
		r0,
		roundsShown: R,
		axis,
		nowLeft,
		lanes: lanes.map((lane, idx) => {
			const dots = Array.from({length: R}, (_, i) => {
				const r = r0 + i;
				return {
					round: r,
					left: round3(x(r, idx)),
					isDone: round > 0 && (r < round || (r === round && idx < curIdx)),
					isNow: round > 0 && r === round && idx === curIdx,
				};
			});
			const spans = (lane.spans || []).map((span, k) => {
				const start = span.start ?? Math.max(1, round);
				const left = x(start, idx);
				const isOpen = span.rounds == null;
				const endRound = Math.max(1, round) + (span.rounds ?? 0);
				const end = isOpen ? 100 : x(endRound, curIdx);
				return {
					...span,
					left: round3(left),
					width: round3(Math.max(3, Math.min(100, end) - left)),
					isClip: isOpen || ((endRound - r0) / R * 100) > 100,
					bottom: 6 + k * SPAN_STEP_PX,
				};
			});
			return {
				...lane,
				isTurn: round > 0 && idx === curIdx,
				dots,
				spans,
				minHeight: LANE_MIN_PX + Math.max(0, spans.length - 1) * SPAN_STEP_PX + (spans.length ? 6 : 0),
			};
		}),
	};
}

/**
 * Timeline spans for one creature: its effects and battlefield entries (not templates, which never end) and its
 * conditions (not "concentrating", which the lane label already shows). `effectItems` are the cockpit's effect pills.
 */
export function getFlowTimelineSpans (instance, {effectItems = [], round = 0} = {}) {
	const startOf = new Map((instance?.effects || []).map(it => [it.id, it.startRound || null]));
	const fx = effectItems
		.filter(it => it.k !== "tpl")
		.map(it => ({key: `${it.k}:${it.id}`, id: it.id, label: it.label, k: it.k, rounds: it.rounds ?? null, start: startOf.get(it.id) || (round || null), source: it.source}));
	const conds = (instance?.conditions || [])
		.filter(name => `${name}`.toLowerCase() !== "concentrating")
		.map(name => ({key: `cond:${name}`, id: name, label: `${name}`.replace(/\b\w/g, c => c.toUpperCase()), k: "cond", rounds: instance.conditionDetails?.[name]?.rounds ?? null, start: round || null}));
	return [...fx, ...conds];
}

/* -------------------------------------------- Log -------------------------------------------- */

export const FLOW_LOG_FILTERS = [
	{id: "all", label: "All", kinds: null},
	{id: "turns", label: "Turns", kinds: ["turn", "note", "combat", "undo"]},
	{id: "rolls", label: "Rolls", kinds: ["roll", "save", "resource"]},
	{id: "damage", label: "Damage", kinds: ["damage", "heal", "hp"]},
	{id: "effects", label: "Effects", kinds: ["effect"]},
];

const LOG_WORDS = {turn: "turn", note: "note", combat: "combat", undo: "undo", roll: "roll", save: "save", resource: "use", damage: "damage", heal: "heal", hp: "hp", effect: "effect"};

/** Plain text for a log line: 5etools tags like {@spell bless|phb} become "bless". */
export function getFlowPlainText (text) {
	return `${text ?? ""}`.replace(/\{@\w+\s+([^|}]*)[^}]*\}/g, "$1").replace(/\{@\w+\}/g, "");
}

/**
 * Log drawer rows: entries matching the filter, oldest first, with a round separator whenever the round changes.
 * Returns {rows: [{type: "round", round, key} | {type: "entry", id, round, kind, word, text}], count, total, latest}.
 */
export function getFlowLogModel (log = [], {filter = "all"} = {}) {
	const kinds = FLOW_LOG_FILTERS.find(it => it.id === filter)?.kinds ?? null;
	const entries = log.filter(it => !kinds || kinds.includes(it.kind));
	const rows = [];
	let lastRound = null;
	entries.forEach(entry => {
		const round = entry.round ?? 0;
		if (round !== lastRound) {
			rows.push({type: "round", round, key: `round-${round}-${entry.id}`, label: round ? `Round ${round}` : "Before combat"});
			lastRound = round;
		}
		rows.push({type: "entry", id: entry.id, round, kind: entry.kind, word: LOG_WORDS[entry.kind] || entry.kind, text: getFlowPlainText(entry.text)});
	});
	const last = log.at(-1);
	return {
		rows,
		count: entries.length,
		total: log.length,
		latest: last ? {round: last.round ?? 0, kind: last.kind, text: getFlowPlainText(last.text)} : null,
	};
}

/** Clamp a log drawer height (px) to the drawer's limits for a viewport height. */
export function getFlowLogHeight (px, viewportHeight) {
	const max = Math.max(120, Math.round(viewportHeight * 0.6));
	return Math.round(Math.max(120, Math.min(max, Number(px) || 0)));
}

/* -------------------------------------------- Turn order -------------------------------------------- */

/**
 * One step earlier (dir -1) or later (dir +1) in turn order, as a `withInitiativeReorder` move {id, beforeId}.
 * `orderIds` are initiative-order entry ids (a shared turn is one entry). Null when it can't move that way.
 */
export function getFlowReorderStep (orderIds, entryId, dir) {
	const index = orderIds.indexOf(entryId);
	if (index < 0 || !dir) return null;
	const remaining = orderIds.filter(id => id !== entryId);
	const target = index + Math.sign(dir);
	if (target < 0 || target > remaining.length) return null;
	return {id: entryId, beforeId: remaining[target] ?? null};
}

/** A drag-and-drop move: drop `entryId` before (or after, `isAfter`) `targetId`. Null for a no-op. */
export function getFlowReorderDrop (orderIds, entryId, targetId, {isAfter = false} = {}) {
	if (!entryId || entryId === targetId) return null;
	const remaining = orderIds.filter(id => id !== entryId);
	const targetIndex = remaining.indexOf(targetId);
	if (targetIndex < 0) return null;
	const position = targetIndex + (isAfter ? 1 : 0);
	if (orderIds.includes(entryId) && orderIds.indexOf(entryId) === position) return null;
	return {id: entryId, beforeId: remaining[position] ?? null};
}

/**
 * Toast text for a reorder, stating the initiative numbers that changed so position and number never get confused:
 * "Goblin 2 moved earlier — initiative 12 → 15 (Orc 15 → 14)".
 */
export function getFlowReorderText ({label, entryId, changes = [], labels = new Map(), dir = 0}) {
	const own = changes.find(it => it.id === entryId);
	const fmt = n => n == null ? "—" : `${n}`;
	const where = dir < 0 ? "moved earlier" : dir > 0 ? "moved later" : "moved";
	if (!own && !changes.length) return `${label} is already there.`;
	const head = own ? `${label} ${where} — initiative ${fmt(own.before)} → ${fmt(own.after)}` : `${label} ${where}`;
	const others = changes.filter(it => it.id !== entryId).map(it => `${labels.get(it.id) || it.id} ${fmt(it.before)} → ${fmt(it.after)}`);
	return others.length ? `${head} (also ${others.join(", ")})` : head;
}

/** The direction a move went, from initiative-order indices before and after. */
export function getFlowReorderDir (orderBefore, orderAfter, entryId) {
	const a = orderBefore.indexOf(entryId);
	const b = orderAfter.indexOf(entryId);
	if (a < 0 || b < 0 || a === b) return 0;
	return b < a ? -1 : 1;
}

/* -------------------------------------------- Groups -------------------------------------------- */

/**
 * A name for a new group from the selection: the plural of a shared creature name ("Goblins"), else "Group n".
 * `getName(instance)` gives the base creature name; `getPlural(name)` pluralises; `existing` names are avoided.
 */
export function getFlowGroupNameSuggestion (instances, {getName, getPlural = name => `${name}s`, existing = []} = {}) {
	const taken = new Set(existing.map(it => `${it}`.toLowerCase()));
	const unique = base => {
		if (!taken.has(base.toLowerCase())) return base;
		for (let n = 2; ; ++n) if (!taken.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
	};
	const names = [...new Set(instances.map(it => getName(it)).filter(Boolean))];
	if (names.length === 1) return unique(instances.length > 1 ? getPlural(names[0]) : names[0]);
	for (let n = 1; ; ++n) if (!taken.has(`group ${n}`)) return `Group ${n}`;
}

/** Ids present now that were not before (creatures added to the encounter). */
export function getFlowNewIds (prevIds, ids) {
	const prev = new Set(prevIds);
	return ids.filter(id => !prev.has(id));
}

/* -------------------------------------------- End of combat -------------------------------------------- */

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The end-combat dialog's view of `getEncounterCombatSummary`. */
export function getFlowEndModel (summary) {
	const foes = summary.defeated.length + summary.remaining.length;
	const split = summary.party.length;
	return {
		title: `${summary.name} — summary`,
		tiles: [
			{key: "rounds", label: "Rounds", value: `${summary.rounds}`},
			{key: "foes", label: "Foes defeated", value: `${summary.defeated.length}/${foes}`},
			{key: "xp", label: split ? "XP per player" : "XP total", value: `${split ? summary.perMember : summary.xp}`},
		],
		defeated: summary.defeated.map(it => ({...it, text: `${it.label} · ${it.xp} XP`})),
		remaining: [...summary.remaining],
		party: summary.party.map(it => ({...it, text: `${it.label} · ${it.down ? "down" : `${it.hp}/${it.hpMax} HP`}`})),
		foot: split ? `${summary.xp} XP split ${split} way${split === 1 ? "" : "s"}` : `${summary.xp} XP · no party members to split it`,
		note: summary.unratedCount ? `${plural(summary.unratedCount, "defeated creature")} had no XP value.` : null,
		canAward: summary.xp > 0,
	};
}
