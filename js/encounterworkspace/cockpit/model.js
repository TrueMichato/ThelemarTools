/**
 * Pure helpers for the Lantern cockpit shell. No DOM access and no site globals, so every rule here is jest-testable.
 */

export const COCKPIT_COMMON_DAMAGE_TYPES = Object.freeze(["slashing", "piercing", "bludgeoning", "fire", "cold", "poison"]);

/** Row tally buckets, in display order: [key, glyph, singular word]. */
export const COCKPIT_TALLY_BUCKETS = Object.freeze([
	Object.freeze(["up", "▲", "buff"]),
	Object.freeze(["down", "▼", "debuff"]),
	Object.freeze(["bf", "⬡", "battlefield effect"]),
	Object.freeze(["tpl", "✦", "template"]),
]);

export const getCockpitPlural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Selection after a row interaction.
 * mode "toggle" (checkbox / Ctrl / Cmd): flip one id. mode "range" (Shift): select the span from the anchor in
 * display order, added to the current selection. mode "only": replace the selection.
 */
export function getCockpitSelectionAfterClick ({selectedIds = [], orderIds = [], clickedId, anchorId = null, mode = "toggle"}) {
	if (clickedId == null) return {selectedIds: [...selectedIds], anchorId};
	if (mode === "only") return {selectedIds: [clickedId], anchorId: clickedId};
	if (mode === "range") {
		const from = orderIds.indexOf(anchorId ?? clickedId);
		const to = orderIds.indexOf(clickedId);
		if (from < 0 || to < 0) return getCockpitSelectionAfterClick({selectedIds, orderIds, clickedId, anchorId, mode: "toggle"});
		const span = orderIds.slice(Math.min(from, to), Math.max(from, to) + 1);
		const out = [...selectedIds];
		span.forEach(id => { if (!out.includes(id)) out.push(id); });
		return {selectedIds: out, anchorId: anchorId ?? clickedId};
	}
	const isSelected = selectedIds.includes(clickedId);
	return {
		selectedIds: isSelected ? selectedIds.filter(id => id !== clickedId) : [...selectedIds, clickedId],
		anchorId: clickedId,
	};
}

/** Group chip click: select the group, or clear those members when the whole group is already selected. */
export function getCockpitSelectionAfterGroupToggle ({selectedIds = [], memberIds = []}) {
	const isAll = memberIds.length && memberIds.every(id => selectedIds.includes(id));
	if (isAll) return selectedIds.filter(id => !memberIds.includes(id));
	return [...selectedIds, ...memberIds.filter(id => !selectedIds.includes(id))];
}

/** The dock acts on the selection, otherwise on the creature being viewed. */
export function getCockpitDockTargetIds ({selectedIds = [], viewedId = null, instanceIds = []}) {
	const live = new Set(instanceIds);
	const selected = selectedIds.filter(id => live.has(id));
	if (selected.length) return {ids: selected, isSelection: true};
	return {ids: viewedId != null && live.has(viewedId) ? [viewedId] : [], isSelection: false};
}

export function getCockpitHpState (hp) {
	const current = Number(hp?.current);
	const max = Number(hp?.max);
	if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) return {cls: "is-unknown", word: "", fraction: null};
	const fraction = Math.max(0, Math.min(1, current / max));
	if (current <= 0) return {cls: "is-down", word: "Down", fraction: 0};
	if (fraction <= 0.5) return {cls: "is-bloodied", word: "Bloodied", fraction};
	if (current < max) return {cls: "is-hurt", word: "Hurt", fraction};
	return {cls: "is-ok", word: "Unhurt", fraction};
}

/**
 * Previous turn, given the initiative order (as returned by `EncounterWorkspaceState.getInitiativeOrder`).
 * Steps back one entry; on wrapping from the top it goes to the last entry of the previous round. Never below round 1.
 */
export function getCockpitPrevTurn ({turn, orderIds}) {
	if (!turn?.round || !orderIds?.length) return null;
	const index = orderIds.indexOf(turn.activeId);
	if (index < 0) return {round: turn.round, activeId: orderIds[0]};
	if (index > 0) return {round: turn.round, activeId: orderIds[index - 1]};
	if (turn.round <= 1) return null;
	return {round: turn.round - 1, activeId: orderIds[orderIds.length - 1]};
}

/**
 * Which turn-order entries the cockpit steps over: a defeated creature, or a shared group turn whose members are all
 * defeated. Returns `id => boolean` for ids from `EncounterWorkspaceState.getInitiativeOrder`.
 */
export function getCockpitTurnSkip (state) {
	const byId = new Map((state?.instances || []).map(it => [it.id, it]));
	const groups = new Map((state?.groups || []).map(it => [it.id, it]));
	return id => {
		if (byId.has(id)) return !!byId.get(id).defeated;
		const members = (groups.get(id)?.memberIds || []).map(memberId => byId.get(memberId)).filter(Boolean);
		return members.length > 0 && members.every(it => it.defeated);
	};
}

/**
 * The turn after `mode` ("start" | "next" | "prev") with skipped entries stepped over, as `{round, activeId, steps}`;
 * `steps` is how many single `withTurn` moves reach it. Same rules as `EncounterWorkspaceState.withTurn` otherwise.
 * When every entry is skipped nobody is stepped over (the marker still moves). Null when there is no such turn.
 */
export function getCockpitLiveTurn ({turn, orderIds, mode, isSkipped = () => false}) {
	if (!orderIds?.length) return null;
	const skip = orderIds.every(id => isSkipped(id)) ? () => false : isSkipped;
	const stepNext = current => {
		const index = orderIds.indexOf(current.activeId);
		if (index < 0) return null;
		const isWrap = index === orderIds.length - 1;
		return {round: current.round + Number(isWrap), activeId: orderIds[isWrap ? 0 : index + 1]};
	};
	const step = mode === "prev" ? current => getCockpitPrevTurn({turn: current, orderIds}) : stepNext;
	let current;
	if (mode === "start") current = turn?.round ? null : {round: 1, activeId: orderIds[0]};
	else current = turn?.round ? step(turn) : null;
	let steps = 1;
	while (current && skip(current.activeId) && steps <= orderIds.length) {
		current = step(current);
		steps++;
	}
	return current ? {...current, steps} : null;
}

/** Display labels: a v8 `label` wins; otherwise the name, numbered only when the name repeats. */
export function getCockpitInstanceLabels (instances, {getName = it => it.monster?._displayName || it.monster?.name || "Creature"} = {}) {
	const counts = new Map();
	instances.forEach(it => { if (!it.label) counts.set(getName(it), (counts.get(getName(it)) || 0) + 1); });
	const ordinals = new Map();
	return new Map(instances.map(it => {
		if (it.label) return [it.id, it.label];
		const name = getName(it);
		if (counts.get(name) === 1) return [it.id, name];
		const n = (ordinals.get(name) || 0) + 1;
		ordinals.set(name, n);
		return [it.id, `${name} ${n}`];
	}));
}

/**
 * Summarise a creature's non-condition effects into the compact row tally.
 * items: [{k: "up"|"down"|"bf"|"tpl", label, rounds?, wide?}]. Effects covering everyone (`wide`) belong on the
 * battlefield strip, not each row, so they are left out of the tally.
 */
export function getCockpitTally (items = []) {
	const mine = items.filter(it => !it.wide);
	if (!mine.length) return null;
	const parts = [];
	const words = [];
	COCKPIT_TALLY_BUCKETS.forEach(([k, glyph, word]) => {
		const n = mine.filter(it => it.k === k).length;
		if (!n) return;
		parts.push({k, glyph, n, text: k === "tpl" && n === 1 ? glyph : `${glyph}${n}`});
		words.push(getCockpitPlural(n, word));
	});
	const rounds = mine.map(it => it.rounds).filter(it => Number.isFinite(it));
	const soon = rounds.length ? Math.min(...rounds) : null;
	if (soon != null) {
		parts.push({k: "exp", glyph: "⏱", n: soon, text: `⏱${soon}r`, isSoon: soon <= 1});
		words.push(`soonest ends in ${getCockpitPlural(soon, "round")}`);
	}
	return {parts, words, count: mine.length, soon};
}

/** Default effect bucketing from the instance itself (P3 may replace it with a provider that adds battlefield rules). */
export function getCockpitInstanceEffectItems (instance) {
	const effects = (instance?.effects || []).map(effect => ({
		k: effect.kind === "debuff" ? "down" : "up",
		label: effect.name,
		rounds: effect.rounds ?? null,
		id: effect.id,
		source: "effect",
	}));
	const templates = (instance?.templates || []).map(template => ({
		k: "tpl",
		label: template.name || template.key,
		rounds: null,
		id: template.key,
		source: "template",
	}));
	return [...effects, ...templates];
}

/** Condition pills on a row: show at most `max`, collapsing the rest into a "+N" chip. */
export function getCockpitConditionPills (conditions = [], {max = 3} = {}) {
	if (conditions.length <= max) return {shown: [...conditions], more: 0};
	return {shown: conditions.slice(0, Math.max(0, max - 1)), more: conditions.length - Math.max(0, max - 1)};
}

/** aria-pressed for a condition toggle across several targets. */
export function getCockpitConditionPressed (conditionLists, condition) {
	const name = `${condition}`.trim().toLowerCase();
	const n = conditionLists.filter(list => (list || []).some(it => `${it}`.trim().toLowerCase() === name)).length;
	if (!n) return "false";
	return n === conditionLists.length ? "true" : "mixed";
}

/**
 * Parse the dock's Amount field: a whole number or a dice expression (2d6+3, d8 - 1).
 * Returns {ok: true, kind: "fixed", value} | {ok: true, kind: "dice", expr} | {ok: false, message}.
 */
export function parseCockpitAmount (raw) {
	const text = `${raw ?? ""}`.replace(/\s+/g, "");
	if (!text) return {ok: false, message: "Type an amount first."};
	if (/^\d+$/.test(text)) {
		const value = Number(text);
		return Number.isSafeInteger(value) ? {ok: true, kind: "fixed", value} : {ok: false, message: "That number is too large."};
	}
	if (/^(\d*d\d+)([+-](\d*d\d+|\d+))*$/i.test(text)) return {ok: true, kind: "dice", expr: text.toLowerCase()};
	return {ok: false, message: "That isn't a number or dice expression."};
}

/** Rounds input for a condition: blank = until removed. */
export function parseCockpitRounds (raw) {
	const text = `${raw ?? ""}`.trim();
	if (!text) return {ok: true, rounds: null};
	if (!/^\d+$/.test(text)) return {ok: false, message: "Rounds must be a whole number, or blank for until removed."};
	const rounds = Number(text);
	if (!Number.isSafeInteger(rounds) || rounds < 1) return {ok: false, message: "Rounds must be at least 1."};
	return {ok: true, rounds};
}

/** Exhaustion is stored as the condition plus a level in conditionDetails.exhaustion.level (0 = none). */
export function getCockpitExhaustionLevel (instance) {
	if (!(instance?.conditions || []).some(it => `${it}`.toLowerCase() === "exhaustion")) return 0;
	const level = Number(instance?.conditionDetails?.exhaustion?.level);
	return Number.isSafeInteger(level) && level > 0 ? Math.min(level, 10) : 1;
}

/** Ordered ids for the rail, highest initiative first, then creatures without initiative in roster order. */
export function getCockpitRailOrder ({instances, initiativeOf}) {
	// Ties break like the turn order (EncounterWorkspaceState.getInitiativeOrder): tieOrder, then roster order.
	return instances
		.map((it, index) => ({id: it.id, init: initiativeOf(it), tie: it.tieOrder ?? 0, index}))
		.sort((a, b) => {
			const ai = a.init == null ? -Infinity : a.init;
			const bi = b.init == null ? -Infinity : b.init;
			return bi - ai || a.tie - b.tie || a.index - b.index;
		})
		.map(it => it.id);
}

/** The next/previous id for J/K view stepping. */
export function getCockpitStepId (orderIds, currentId, delta) {
	if (!orderIds.length) return null;
	const index = orderIds.indexOf(currentId);
	if (index < 0) return orderIds[delta > 0 ? 0 : orderIds.length - 1];
	return orderIds[(index + delta + orderIds.length) % orderIds.length];
}

/** Toast text for a typed-damage result. */
export function getCockpitDamageSummary ({amount, damageType, results = [], labels = new Map(), skippedIds = []}) {
	const typeText = damageType ? ` ${damageType}` : "";
	const bits = results.map(({id, damage, defenses = {}, concentrationDc}) => {
		const def = Object.entries(defenses).filter(([, on]) => on).map(([k]) => ({immune: "immune", resist: "resists", vulnerable: "vulnerable"})[k]).filter(Boolean);
		return `${labels.get(id) || id} ${damage}${def.length ? ` (${def.join(", ")})` : ""}${concentrationDc ? ` · Con save DC ${concentrationDc}` : ""}`;
	});
	return `${amount}${typeText} damage → ${bits.join(" · ") || "no targets"}${skippedIds.length ? ` · ${skippedIds.length} skipped (HP unset)` : ""}`;
}

/**
 * Rail group chips. A creature's v8 `customGroup` name wins; otherwise creatures sharing a statblock (the state's view
 * groups) form a group named after the monster. Only groups of two or more get a chip. Two or more party members also
 * get a leading "Party" chip (reusing a group chip that holds exactly the party, e.g. prep's auto "Party" group).
 * viewGroups: [{id, memberIds}] (from getEncounterViewGroups). Returns [{key, name, memberIds}] in roster order.
 */
export function getCockpitGroupChips ({instances = [], viewGroups = [], getName = it => it.monster?._displayName || it.monster?.name || "Creature"}) {
	const byId = new Map(instances.map(it => [it.id, it]));
	const chips = new Map();
	const add = (key, name, id) => {
		if (!chips.has(key)) chips.set(key, {key, name, memberIds: []});
		chips.get(key).memberIds.push(id);
	};
	viewGroups.forEach(group => {
		group.memberIds.forEach(id => {
			const instance = byId.get(id);
			if (!instance) return;
			if (instance.customGroup) add(`custom:${instance.customGroup}`, instance.customGroup, id);
			else add(group.id, getName(byId.get(group.memberIds[0])), id);
		});
	});
	const out = [...chips.values()].filter(it => it.memberIds.length >= 2);
	// The party always gets a chip (first, so its number key stays put), unless a group already holds exactly them.
	const partyIds = viewGroups.flatMap(group => group.memberIds).filter(id => byId.get(id)?.kind === "party");
	if (partyIds.length < 2) return out;
	const isSameParty = chip => chip.memberIds.length === partyIds.length && partyIds.every(id => chip.memberIds.includes(id));
	const existing = out.find(isSameParty);
	if (existing) return [existing, ...out.filter(it => it !== existing)];
	return [{key: "party", name: out.some(it => it.name === "Party") ? "Whole party" : "Party", memberIds: partyIds}, ...out];
}

/** First listed AC as a number (statblock AC is an array of numbers or {ac, from, condition}). */
export function getCockpitAcValue (ac) {
	const first = Array.isArray(ac) ? ac[0] : ac;
	const value = typeof first === "object" && first ? first.ac : first;
	return Number.isFinite(value) ? value : null;
}

export function getCockpitCrText (cr) {
	const value = cr && typeof cr === "object" ? cr.cr : cr;
	return value == null || value === "" ? null : `${value}`;
}
