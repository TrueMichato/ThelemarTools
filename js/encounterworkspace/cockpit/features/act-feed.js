/**
 * P4 — the statblock roll feed. Clicking a dice link in a statblock rolls it through the cockpit's breakdown (so
 * Elite +2, Bless, conditions… show up with their source) and stacks a card in the floating tray slot: attack cards
 * show hit / miss against the current targets, damage cards apply to the selection (else the viewed creature) in
 * one click, with ½ / ×2, → Viewed and "Stage in console". Shares its slot with the mass-roll tray; showing one
 * hides the other.
 */

import {
	getEncounterAcBreakdown,
	getEncounterDamageRollBreakdown,
	getEncounterRollBreakdown,
} from "../../encounterworkspace-rollbreakdown.js";
import {getEncounterRollFromPackedDice} from "../../encounterworkspace-roll.js";
import {h, replaceKeepingFocus} from "../dom.js";
import {getCockpitContributorGetter} from "../rules.js";
import {getCockpitConsoleHandle} from "./act-console-model.js";
import {
	COCKPIT_FEED_MAX,
	COCKPIT_FEED_MULTIPLIERS,
	COCKPIT_FEED_VISIBLE,
	getCockpitAttackVerdicts,
	getCockpitFeedAmount,
	getCockpitFeedD20Parts,
	getCockpitFeedLogText,
	getCockpitFeedStageText,
	getCockpitStatblockDamage,
	getCockpitStatblockRollQuery,
} from "./act-feed-model.js";
import {bindCockpitSource, getWhoText, plural, trackCockpitTrayRoom} from "./act-shared.js";

const KIND_LABELS = {attack: "Attack", save: "Save", check: "Check", initiative: "Initiative", damage: "Damage"};

/** "Bite" from the statblock entry that holds a dice link; null when the link is not inside a named entry. */
function getEntryName (link) {
	const block = link.closest("p, li, td, .rd__b");
	const title = block?.querySelector(".rd__list-item-name, .rd__entry-title-inner, .entry-title-inner, b, i");
	if (!title || title.contains(link)) return null;
	const text = title.textContent.trim().replace(/[.:]\s*$/, "");
	return text && text.length <= 60 ? text : null;
}

/** The text right after a dice link, up to a short window — enough for `) piercing damage`. */
function getTrailingText (link) {
	let out = "";
	for (let node = link.nextSibling; node && out.length < 48; node = node.nextSibling) out += node.textContent || "";
	return out;
}

export function createCockpitRollFeed (api, {tray, console: commandConsole}) {
	const root = h("section.ewc-tray.ewc-feed", {"aria-label": "Statblock rolls", hidden: true, "data-ewc-feed": ""});
	api.getRegion("layer").append(root);
	const setRoom = trackCockpitTrayRoom(root);

	let cards = [];
	let isAll = false;
	let seq = 0;

	const hide = () => {
		root.hidden = true;
		root.replaceChildren();
		setRoom();
	};
	const clear = () => {
		cards = [];
		isAll = false;
		hide();
	};

	const push = card => {
		card.id = `f${++seq}`;
		cards.unshift(card);
		if (cards.length > COCKPIT_FEED_MAX) cards.length = COCKPIT_FEED_MAX;
		tray.hide();
		root.hidden = false;
		api.engine.pLog("roll", getCockpitFeedLogText(card)).catch(() => {});
		render();
		setRoom();
	};

	/* ---------------- statblock → card ---------------- */

	api.setRollHandler(async ({instance, name, roll, rollMode, evt}) => {
		const attackName = roll.rollType === "attack" && evt?.target?.closest ? getEntryName(evt.target.closest("[data-packed-dice]") || evt.target) : null;
		const query = getCockpitStatblockRollQuery(roll, {attackName});
		if (!query) return api.toast(`Cannot roll ${roll?.label || "that"} for ${name}.`, {kind: "error"});
		try {
			const result = getEncounterRollBreakdown({
				instance,
				query,
				forcedMode: rollMode && rollMode !== "normal" ? rollMode : null,
				forcedLabel: "Shift/Ctrl",
				getContributors: getCockpitContributorGetter(api.getState(), api.getSettings()),
			});
			push({kind: query.kind, srcId: instance.id, who: name, label: attackName || roll.label, roll: result});
		} catch (e) {
			api.toast(`Could not roll ${roll.label} for ${name}: ${e.message}`, {kind: "error"});
		}
	});

	// Damage links are not d20 rolls, so the statblock leaves them to the native roller: catch them first.
	document.addEventListener("click", evt => {
		const link = evt.target.closest?.("[data-packed-dice]");
		const tile = link?.closest(".ewc-sb[data-instance-id]");
		if (!tile) return;
		let entry;
		try {
			entry = JSON.parse(link.dataset.packedDice);
		} catch (e) {
			return;
		}
		if (getEncounterRollFromPackedDice(entry)) return; // d20: the statblock's own handler
		const damage = getCockpitStatblockDamage(entry, getTrailingText(link));
		if (!damage) return;
		const state = api.getState();
		const instance = state.instances.find(it => it.id === tile.dataset.instanceId);
		if (!instance) return;
		evt.preventDefault();
		evt.stopImmediatePropagation();
		const name = api.getCtx().labels.get(instance.id) || instance.id;
		try {
			const rolled = getEncounterDamageRollBreakdown({
				expr: damage.expr,
				damageType: damage.damageType,
				instance,
				getContributors: getCockpitContributorGetter(state, api.getSettings()),
			});
			push({
				kind: "damage",
				srcId: instance.id,
				who: name,
				label: getEntryName(link) || "Damage",
				expr: damage.expr,
				damageType: damage.damageType,
				total: rolled.total,
				rolls: rolled.parts[0].rolls || [],
				parts: rolled.parts.slice(1),
				mult: 1,
				applied: null,
				review: null,
			});
		} catch (e) {
			api.toast(`Could not roll ${damage.expr} for ${name}: ${e.message}`, {kind: "error"});
		}
	}, true);

	/* ---------------- damage card actions ---------------- */

	const pApply = async (card, ids, decisions = {}) => {
		if (!ids.length) return api.toast("No target — select creatures or view one.", {kind: "error"});
		const amount = getCockpitFeedAmount(card);
		const amountText = `${card.expr} → ${card.total}${card.mult !== 1 ? ` ${card.mult === 2 ? "×2" : "½"}` : ""}`;
		const res = await api.actions.pDamage({amount, amountText, damageType: card.damageType, source: "unspecified", isCrit: false, decisions, targetIds: ids});
		if (res?.unresolved) card.review = {ids, unresolved: res.unresolved, decisions: {...decisions}};
		else if (res?.ok) {
			card.review = null;
			card.applied = `${amount}${card.damageType ? ` ${card.damageType}` : ""} → ${getWhoText(ids, api.getCtx().labels)}`;
		}
		render();
	};

	const getReview = (card, ctx) => {
		const {unresolved, decisions, ids} = card.review;
		return h("div.ewc-review.ewc-tray__review", {role: "group", "aria-label": "Conditional defenses"},
			h("p.ewc-review__head", null, h("b", null, `${getCockpitFeedAmount(card)} ${card.damageType || ""} damage.`), " Does each defense apply?"),
			unresolved.map(({id, key, defense, note}) => {
				const text = `${ctx.labels.get(id) || id} · ${defense} · ${note}`;
				return h("label.ewc-review__row", null, h("span", null, text), h("select.ewc-input.ewc-input--sm", {
					"data-ewc-fk": `feed-rv-${card.id}-${id}-${key}`,
					"aria-label": text,
					onchange: evt => {
						decisions[id] = {...decisions[id]};
						if (evt.target.value === "") delete decisions[id][key]; else decisions[id][key] = evt.target.value === "yes";
					},
				}, h("option", {value: ""}, "Choose…"), h("option", {value: "yes", selected: decisions[id]?.[key] === true}, "Applies"), h("option", {value: "no", selected: decisions[id]?.[key] === false}, "Does not apply")));
			}),
			h("div.ewc-act__row", null,
				h("button.ewc-btn.ewc-btn--sm.ewc-btn--bad", {
					type: "button",
					"data-ewc-fk": `feed-rv-go-${card.id}`,
					onclick: () => {
						if (unresolved.some(({id, key}) => decisions[id]?.[key] == null)) return api.toast("Choose Applies or Does not apply for every conditional defense.", {kind: "error"});
						pApply(card, ids, decisions);
					},
				}, "Continue"),
				h("button.ewc-btn.ewc-btn--sm", {type: "button", "data-ewc-fk": `feed-rv-x-${card.id}`, onclick: () => { card.review = null; render(); }}, "Cancel")));
	};

	/* ---------------- render ---------------- */

	const getSourceSpan = (part, card, ctx) => {
		const instance = ctx.state.instances.find(it => it.id === card.srcId);
		const ele = h(`span.ewc-feed__p${part.source && part.source !== "statblock" ? ".is-src" : ""}`, null, part.text, part.source && part.source !== "statblock" ? h("small", null, ` ${part.label}`) : null);
		if (part.source && part.source !== "statblock") bindCockpitSource(ele, part.source, {hover: api.hover, instance, state: ctx.state, conditionCatalog: ctx.conditionCatalog, label: part.label});
		else ele.title = part.label;
		return ele;
	};

	const getD20 = (card, ctx) => {
		const {roll} = card;
		const rolls = roll.rolls?.length ? roll.rolls : [roll.natural];
		const die = h(`span.ewc-feed__die${roll.crit ? ".is-crit" : ""}${roll.fumble ? ".is-fumble" : ""}`, {title: rolls.length > 1 ? `Rolled ${rolls.join(" and ")} (${roll.mode}) — kept ${roll.natural}` : "The d20"},
			`${roll.natural}`, rolls.length > 1 ? h("small", null, rolls.join("/")) : null);
		return h("span.ewc-feed__bd", {"aria-label": `d20 ${roll.natural} ${getCockpitFeedD20Parts(roll).map(it => `${it.text} ${it.label}`).join(" ")}`},
			"(", die, ...getCockpitFeedD20Parts(roll).flatMap(part => [" ", getSourceSpan(part, card, ctx)]), ")");
	};

	const getTargetInfo = (ids, ctx, excludeId) => {
		const getContributors = getCockpitContributorGetter(ctx.state, ctx.settings);
		return ids.filter(id => id !== excludeId).map(id => ctx.state.instances.find(it => it.id === id)).filter(Boolean).map(instance => {
			let ac = null;
			try {
				ac = getEncounterAcBreakdown({instance, getContributors}).total;
			} catch (e) { /* no AC: no verdict */ }
			return {id: instance.id, label: ctx.labels.get(instance.id) || instance.id, ac};
		});
	};

	function getCard (card, ctx) {
		const head = (n, extra = null) => h("div.ewc-feed__top", null,
			h("span.ewc-feed__k", null, KIND_LABELS[card.kind] || card.kind),
			h("span.ewc-feed__who", null, `${card.who} · ${card.label}`),
			h("b.ewc-feed__n", null, n, extra));
		if (card.kind === "damage") {
			const amount = getCockpitFeedAmount(card);
			const ids = ctx.targetIds;
			const viewedId = ctx.ui.viewedId;
			const isViewedOnly = ids.length === 1 && ids[0] === viewedId;
			const extraParts = card.parts.map(it => `${it.label} ${it.value >= 0 ? "+" : ""}${it.value}`).join(", ");
			return h(`li.ewc-feed__card.ewc-feed__card--dmg${card.applied ? ".is-applied" : ""}`, {"data-ewc-feed-card": card.id},
				head(`${amount}`, card.mult !== 1 ? [" ", h("s", null, `${card.total}`)] : null),
				h("div.ewc-feed__meta", null, `${card.expr}${card.damageType ? ` · ${card.damageType}` : " · untyped"}${card.rolls.length ? ` · [${card.rolls.join(", ")}]` : ""}${extraParts ? ` · ${extraParts}` : ""}`),
				h("div.ewc-feed__acts", null,
					h("button.ewc-btn.ewc-btn--sm.ewc-btn--primary", {
						type: "button",
						disabled: !ids.length || !!card.review,
						title: "Apply to the selection, else the viewed creature",
						"data-ewc-fk": `feed-apply-${card.id}`,
						"data-ewc-feed-apply": "",
						onclick: () => pApply(card, ids),
					}, `Apply ${amount} → ${getWhoText(ids, ctx.labels)}`),
					viewedId && !isViewedOnly ? h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {
						type: "button",
						disabled: !!card.review,
						title: `Apply to ${ctx.labels.get(viewedId) || "the viewed creature"} only`,
						"data-ewc-fk": `feed-viewed-${card.id}`,
						"data-ewc-feed-viewed": "",
						onclick: () => pApply(card, [viewedId]),
					}, "→ Viewed") : null,
					COCKPIT_FEED_MULTIPLIERS.map(it => h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {
						type: "button",
						"aria-pressed": `${card.mult === it.value}`,
						"aria-label": it.title,
						title: it.title,
						"data-ewc-fk": `feed-mult-${card.id}-${it.value}`,
						"data-ewc-feed-mult": `${it.value}`,
						onclick: () => { card.mult = card.mult === it.value ? 1 : it.value; render(); },
					}, it.label)),
					commandConsole ? h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {
						type: "button",
						title: "Put this amount in the console to edit before applying",
						"data-ewc-fk": `feed-stage-${card.id}`,
						"data-ewc-feed-stage": "",
						onclick: () => {
							const handles = ctx.isSelection ? ids.map(id => getCockpitConsoleHandle(ctx.labels.get(id) || id)) : [];
							commandConsole.open({text: getCockpitFeedStageText(card, handles)});
						},
					}, "Stage in console") : null),
				card.review ? getReview(card, ctx) : null,
				card.applied ? h("p.ewc-feed__done", {role: "status"}, `✓ ${card.applied}`) : null);
		}
		const {roll} = card;
		const verdictExtra = roll.crit ? h("span.ewc-feed__flag.is-ok", null, " crit") : roll.fumble ? h("span.ewc-feed__flag.is-bad", null, " nat 1") : null;
		let meta = null;
		if (card.kind === "attack") {
			const verdicts = getCockpitAttackVerdicts(roll, getTargetInfo(ctx.targetIds, ctx, card.srcId)).slice(0, 3);
			meta = [
				roll.mode && roll.mode !== "normal" ? `${roll.mode} · ` : null,
				...verdicts.flatMap((it, ix) => [ix ? " · " : null, h(`span.${it.isHit ? "is-ok" : "is-bad"}`, null, `${it.isHit ? "hit" : "miss"} ${it.label} (AC ${it.ac})`)]),
			].filter(Boolean);
		} else if (roll.mode && roll.mode !== "normal") meta = [roll.mode];
		const notes = (roll.notes || []).map(it => typeof it === "string" ? it : it.label ?? it.text ?? "").filter(Boolean);
		return h(`li.ewc-feed__card.ewc-feed__card--${card.kind === "attack" ? "atk" : card.kind}`, {"data-ewc-feed-card": card.id},
			head(`${roll.total}`, [" ", getD20(card, ctx), verdictExtra]),
			meta?.length ? h("div.ewc-feed__meta", null, meta) : null,
			notes.length ? h("div.ewc-feed__meta.ewc-muted", null, notes.join(" · ")) : null);
	}

	function render (ctx = api.getCtx()) {
		if (root.hidden) return;
		if (!cards.length) return hide();
		const shown = isAll ? cards : cards.slice(0, COCKPIT_FEED_VISIBLE);
		replaceKeepingFocus(root, [
			h("header.ewc-tray__head", null,
				h("h3.ewc-tray__title", null, "Rolls"),
				h("span.ewc-tray__counts.ewc-muted", null, plural(cards.length, "roll")),
				h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost.ewc-feed__clear", {type: "button", "data-ewc-fk": "feed-clear", "data-ewc-feed-clear": "", onclick: clear}, "Clear"),
				h("button.ewc-btn.ewc-btn--icon.ewc-btn--ghost.ewc-tray__close", {type: "button", title: "Dismiss (Esc)", "aria-label": "Dismiss statblock rolls", "data-ewc-feed-close": "", onclick: hide}, "×")),
			h("ol.ewc-feed__list", {"aria-live": "polite"}, shown.map(card => getCard(card, ctx))),
			cards.length > COCKPIT_FEED_VISIBLE ? h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost.ewc-feed__more", {
				type: "button",
				"aria-expanded": `${isAll}`,
				"data-ewc-fk": "feed-more",
				"data-ewc-feed-more": "",
				onclick: () => { isAll = !isAll; render(); },
			}, isAll ? "Show fewer" : `${cards.length - COCKPIT_FEED_VISIBLE} more`) : null,
		].filter(Boolean));
	}

	root.addEventListener("keydown", evt => {
		if (evt.key !== "Escape" || evt.defaultPrevented) return;
		evt.preventDefault();
		evt.stopPropagation();
		hide();
	});

	api.onRender(ctx => render(ctx));

	return {hide, clear, getIsOpen: () => !root.hidden, getCards: () => cards};
}
