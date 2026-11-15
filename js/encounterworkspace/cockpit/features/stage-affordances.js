/**
 * Stage affordances (A6): the statblock reads as a control surface. Dice links become roll chips (boxed to-hit and
 * saves, red-tinted damage, dotted checks) that show effect-modified numbers; "DC N" becomes a chip that calls for a
 * save in the Roll tab; an active-effects delta line, statblock tags, and a tools box (held by, concentration mark,
 * edit, assess CR, reminders) sit with the stat block; a dismissible how-to card sits above the stage.
 *
 * Chips only restyle the site's own roller spans — clicks still go to the native roller and the cockpit roll handler,
 * and nothing is inserted next to a dice link (the roll feed reads the text after a damage link for its type).
 */
import {h, replaceKeepingFocus} from "../dom.js";
import {
	COCKPIT_HINT_STORAGE_KEY,
	getCockpitDcAbility,
	getCockpitHeldBy,
	getCockpitIsSpellDc,
	getCockpitReminders,
	getCockpitRollChange,
	getCockpitRollChipKind,
	getCockpitSigned,
	getCockpitStageDeltas,
	getCockpitStageDeltaText,
	getCockpitStatblockTags,
} from "../stage-model.js";
import {getCockpitStatblockDamage} from "./act-feed-model.js";
import {PREP_EDITOR_SECTIONS, pOpenPrepStatblockEditor} from "./prep-editor.js";

const BLOCK_SELECTOR = "p, li, td, .ve-rd__b";
const ROLL_FORM_DAMAGE_RE = /^(?:\d+|\d*d\d+(?:[+-]\d+)?)$/i;
const ABILITY_NAMES = {str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma"};
const D20_BONUS_RE = /^\s*1d20\s*([+-]\s*\d+)?\s*$/i;

/** Concentration-mark drafts per creature, so a re-render never wipes what the DM is typing. */
const concDrafts = new Map();

export function installCockpitStageAffordances (api) {
	api.addStatblockDecorator((table, instance, ctx, tile) => {
		if (!tile) return;
		const derived = ctx.getDerived(instance)?.derived || null;
		if (table) {
			decorateRolls(table, derived);
			decorateDcs(api, table, derived);
			renderDeltas(table, derived);
			renderTags(table, instance);
		}
		renderToolsBox(api, tile, instance, ctx);
	});
	installHint(api);
}

/* -------------------------------------------- D30 / D32: roll chips -------------------------------------------- */

const parsePacked = el => {
	try {
		return JSON.parse(el.dataset.packedDice);
	} catch (e) {
		return null;
	}
};

const getSummaryFor = (kind, entry, derived) => {
	if (!derived) return null;
	if (kind === "hit") return derived.attack;
	if (kind === "save") return derived.saves?.[entry.context?.ability];
	if (kind === "skill") return derived.check;
	return null;
};

function decorateRolls (table, derived) {
	table.querySelectorAll("[data-packed-dice]").forEach(el => {
		const entry = parsePacked(el);
		if (!entry) return;
		const kind = getCockpitRollChipKind(entry);
		if (el.dataset.ewcBase == null) {
			el.dataset.ewcBase = el.textContent;
			el.dataset.ewcTitle = el.getAttribute("title") || "";
			el.classList.add("ewc-roll", `ewc-roll--${kind}`);
		}
		el.classList.remove("is-changed");
		if (el.textContent !== el.dataset.ewcBase || el.children.length) el.textContent = el.dataset.ewcBase;
		if (el.dataset.ewcTitle) el.setAttribute("title", el.dataset.ewcTitle);
		else el.removeAttribute("title");

		const summary = getSummaryFor(kind, entry, derived);
		const match = summary && typeof entry.toRoll === "string" ? D20_BONUS_RE.exec(entry.toRoll) : null;
		if (!match) return;
		const base = Number((match[1] || "0").replace(/\s/g, ""));
		const label = kind === "hit" ? "to hit" : kind === "save" ? `${ABILITY_NAMES[entry.context.ability] || ""} save`.trim() : "check";
		const change = getCockpitRollChange({base, summary, label});
		if (!change.isChanged) return;
		el.classList.add("is-changed");
		el.setAttribute("title", change.title);
		// Keep the native "+6 (16)" style: only the leading signed bonus changes.
		el.textContent = el.dataset.ewcBase.replace(/^[+-−]?\d+/, change.text);
		change.marks.forEach(mark => el.append(h(`span.ewc-roll__mk.${mark.cls}`, {title: mark.title, "aria-label": mark.title}, mark.text)));
	});
}

/* -------------------------------------------- D31: DC chips -------------------------------------------- */

const getTextAround = (el, block) => {
	const before = document.createRange();
	before.setStart(block, 0);
	before.setEndBefore(el);
	const after = document.createRange();
	after.setStartAfter(el);
	after.setEnd(block, block.childNodes.length);
	return {leading: before.toString(), trailing: after.toString()};
};

function decorateDcs (api, table, derived) {
	table.querySelectorAll("span.ve-rd__dc").forEach(span => {
		let chip = span.parentElement?.classList.contains("ewc-roll--dc") ? span.parentElement : null;
		if (!chip) {
			const block = span.closest(BLOCK_SELECTOR) || span.parentElement;
			const {leading} = getTextAround(span, block);
			const prev = span.previousSibling;
			if (prev?.nodeType === Node.TEXT_NODE && /DC\s*$/.test(prev.textContent)) prev.textContent = prev.textContent.replace(/DC\s*$/, "");
			chip = h("button.ewc-roll.ewc-roll--dc", {type: "button", dataset: {ewcBase: span.textContent.trim(), ewcSpell: getCockpitIsSpellDc(leading) ? "1" : ""}});
			span.replaceWith(chip);
			chip.append("DC ", span);
			chip.addEventListener("click", evt => onDcClick(api, chip, evt));
		}
		const base = Number(chip.dataset.ewcBase);
		const delta = chip.dataset.ewcSpell && Number.isFinite(base) ? Number(derived?.spellDcDelta) || 0 : 0;
		span.textContent = delta ? `${base + delta}` : chip.dataset.ewcBase;
		chip.classList.toggle("is-changed", !!delta);
		chip.title = delta
			? `Call for this save — spell save DC ${base} → ${base + delta} (${getCockpitSigned(delta)} from effects)`
			: "Call for this save: opens the Roll tab with the DC filled in";
	});
}

/** The save this DC asks for, read from the sentence it is in: ability, damage and its type, half on a pass, condition. */
export function getCockpitDcCall (chip, {conditions = []} = {}) {
	const block = chip.closest(BLOCK_SELECTOR) || chip.parentElement;
	const {leading, trailing} = getTextAround(chip, block);
	const ability = getCockpitDcAbility(trailing, leading);
	const dc = chip.querySelector(".ve-rd__dc")?.textContent.trim() || chip.dataset.ewcBase;
	const patch = {kind: "save", dc};
	if (ability) patch.ability = ability;

	const isInSegment = el => {
		if (!(chip.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
		const nextDc = [...block.querySelectorAll(".ewc-roll--dc")].find(it => it !== chip && (chip.compareDocumentPosition(it) & Node.DOCUMENT_POSITION_FOLLOWING));
		return !nextDc || !!(el.compareDocumentPosition(nextDc) & Node.DOCUMENT_POSITION_FOLLOWING);
	};
	const nextDcIx = (() => {
		const m = /\bDC\s*\d/.exec(trailing);
		return m ? m.index : trailing.length;
	})();
	const segment = trailing.slice(0, nextDcIx);

	const damageLink = [...block.querySelectorAll("[data-packed-dice]")].find(it => isInSegment(it) && parsePacked(it)?.subType === "damage");
	if (damageLink) {
		const {trailing: after} = getTextAround(damageLink, block);
		const damage = getCockpitStatblockDamage(parsePacked(damageLink), after.slice(0, 48));
		if (damage && ROLL_FORM_DAMAGE_RE.test(damage.expr)) {
			patch.damage = damage.expr;
			patch.damageType = damage.damageType;
			patch.isHalf = /half\s+as\s+much\s+damage|half\s+(?:the\s+)?damage|half\s+damage/i.test(segment);
		}
	}
	const condition = conditions.map(it => it.name).find(name => name && new RegExp(`(?:\\bbe(?:come)?\\s+(?:knocked\\s+)?|\\bhas\\s+the\\s+|\\bis\\s+)${name}\\b`, "i").test(segment));
	if (condition) patch.condition = condition;
	return patch;
}

function onDcClick (api, chip, evt) {
	evt.preventDefault();
	evt.stopPropagation();
	const patch = getCockpitDcCall(chip, {conditions: api.getCtx?.()?.conditions || []});
	if (!api.presetDockTab("roll", patch)) return api.toast("The Roll tab is not available.", {kind: "error"});
	const what = `DC ${patch.dc}${patch.ability ? ` ${ABILITY_NAMES[patch.ability]}` : ""} save`;
	if (!api.getUi().selectedIds.length) api.toast(`${what} is in the Roll tab — select who saves, then roll.`);
}

/* -------------------------------------------- D33: active-effects delta line -------------------------------------------- */

const getDeltaNodes = deltas => deltas.map((it, ix) => [
	ix ? h("span.ewc-sb__sep", {"aria-hidden": "true"}, " · ") : null,
	it.from != null ? h("span.ewc-sb__delta", null, `${it.text} `, h("s", null, it.from), " → ", h("b", null, it.to)) : h("span.ewc-sb__delta", null, it.text),
]);

function renderDeltas (table, derived) {
	table.querySelectorAll("tr.ewc-sbdeltas").forEach(it => it.remove());
	const deltas = getCockpitStageDeltas(derived);
	if (!deltas.length) return;
	const tbody = table.querySelector("tbody");
	if (!tbody) return;
	const row = h("tr.ewc-sbdeltas", null, h("td", {colspan: "6"},
		h("div.ewc-sbdeltas__in", {title: `Active effects: ${getCockpitStageDeltaText(deltas)}`},
			h("span.ewc-sbdeltas__lbl", null, "Active effects"),
			h("span.ewc-sb__deltas", null, getDeltaNodes(deltas)))));
	const after = tbody.querySelector(":scope > tr.ewc-prep-sbfx") || tbody.querySelector(":scope > tr");
	if (after?.nextSibling) tbody.insertBefore(row, after.nextSibling);
	else tbody.append(row);
}

/* -------------------------------------------- D38: statblock tags -------------------------------------------- */

function renderTags (table, instance) {
	table.querySelectorAll(".ewc-sbtags").forEach(it => it.remove());
	const tags = getCockpitStatblockTags(instance);
	const name = table.querySelector(".ve-stats__h-name");
	if (!tags.length || !name?.parentElement) return;
	name.after(h("span.ewc-sbtags", null, tags.map(it => h(`span.ewc-sbtag.ewc-sbtag--${it.kind}`, {title: it.title}, it.text))));
}

/* -------------------------------------------- D34 / D35 / D38: the tools box -------------------------------------------- */

function renderToolsBox (api, tile, instance, ctx) {
	let box = tile.querySelector(":scope > .ewc-sbx");
	if (!box) {
		box = h("div.ewc-sbx", {"aria-label": "Statblock tools"});
		tile.prepend(box);
	}
	const isMonster = instance.kind !== "party";
	const heldBy = getCockpitHeldBy(instance).filter(it => ctx.state.instances.some(cre => cre.id === it.casterId));
	const reminders = getCockpitReminders(ctx.state, instance);
	const id = instance.id;
	const label = ctx.labels.get(id);

	const input = h("input.ewc-input.ewc-input--sm.ewc-sbx__conc", {
		type: "text",
		placeholder: "spell…",
		maxlength: "120",
		"aria-label": `Concentration spell for ${label}`,
		"data-ewc-fk": `sbx-concmark:${id}`,
		value: concDrafts.get(id) || "",
		oninput: () => concDrafts.set(id, input.value),
		onkeydown: evt => {
			if (evt.key !== "Enter") return;
			evt.preventDefault();
			mark();
		},
	});
	const mark = async () => {
		const spell = input.value.trim();
		if (!spell) {
			input.focus();
			return api.toast("Type the spell being concentrated on.");
		}
		await api.actions.pResourceAction(id, {kind: "concentration", active: true, label: spell});
		concDrafts.delete(id);
	};

	const lines = [];
	if (heldBy.length) {
		lines.push(h("div.ewc-sbx__row.ewc-sbx__held", null, h("span.ewc-sbx__k", null, "Held by"),
			heldBy.map(it => h("button.ewc-btn.ewc-btn--sm.ewc-btn--link", {
				type: "button",
				"data-ewc-fk": `sbx-held:${it.effectId}`,
				title: `${it.label} is held up by ${ctx.labels.get(it.casterId)}'s concentration — view them`,
				onclick: () => api.view(it.casterId),
			}, `${ctx.labels.get(it.casterId)} · ${it.label}`))));
	}
	lines.push(h("div.ewc-sbx__row.ewc-sbx__tools", null,
		h("span.ewc-sbx__k", null, "Tools"),
		h("label.ewc-sbx__lbl", null, "Conc mark", input),
		h("button.ewc-btn.ewc-btn--sm", {type: "button", "data-ewc-fk": `sbx-concmark-go:${id}`, onclick: () => mark()}, "Mark"),
		isMonster ? h("span.ewc-sbx__sep", {"aria-hidden": "true"}, "·") : null,
		isMonster ? h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {
			type: "button",
			"data-ewc-fk": `sbx-edit:${id}`,
			title: "Edit this statblock (I)",
			onclick: () => pOpenPrepStatblockEditor(api, id, {section: PREP_EDITOR_SECTIONS.edit}).catch(e => api.toast(`Could not open the editor: ${e.message || e}.`, {kind: "error"})),
		}, "✎ Edit ", h("kbd.ewc-kbd", null, "I")) : null,
		isMonster ? h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {
			type: "button",
			"data-ewc-fk": `sbx-cr:${id}`,
			title: "Estimate this creature's challenge rating from its current numbers",
			onclick: () => {
				if (api.getUi().viewedId !== id) api.view(id);
				api.openPrep({tab: "creature", creSub: "cr"});
			},
		}, "Assess CR") : null,
	));
	if (reminders.length) {
		lines.push(h("div.ewc-sbx__row.ewc-sbx__rem", null, h("span.ewc-sbx__k", null, "Reminders"),
			h("ul.ewc-sbx__list", null, reminders.map(it => h("li", null, h("b", null, it.name), it.note ? ` — ${it.note}` : null,
				it.rounds != null ? h("small.ewc-muted", null, ` (${it.rounds} round${it.rounds === 1 ? "" : "s"})`) : null)))));
	}
	replaceKeepingFocus(box, lines);
}

/* -------------------------------------------- D39: the how-to hint -------------------------------------------- */

const isHintOff = () => {
	try {
		return globalThis.localStorage?.getItem(COCKPIT_HINT_STORAGE_KEY) === "1";
	} catch (e) {
		return false;
	}
};
const setHintOff = isOff => {
	try {
		if (isOff) globalThis.localStorage?.setItem(COCKPIT_HINT_STORAGE_KEY, "1");
		else globalThis.localStorage?.removeItem(COCKPIT_HINT_STORAGE_KEY);
	} catch (e) { /* private mode: the card just comes back next load */ }
};

function installHint (api) {
	const region = api.getRegion("stageTop");
	if (!region) return;
	const mod = api.isMac ? "⌘" : "Ctrl";
	const card = h("aside.ewc-hint", {"aria-label": "How this works", hidden: isHintOff()},
		h("span.ewc-hint__i", {"aria-hidden": "true"}, "?"),
		h("p.ewc-hint__t", null,
			h("b", null, "How this works. "),
			"Click a name to view it here; tick boxes (", h("kbd.ewc-kbd", null, mod), " or ", h("kbd.ewc-kbd", null, "Shift"), "-click) to select. ",
			"The dock acts on the selection, else the viewed creature. ",
			"Click dice in the statblock — results land in the Rolls tray with Apply buttons; click a ", h("span.ewc-roll.ewc-roll--dc", null, "DC"), " to call for that save. ",
			"Press ", h("kbd.ewc-kbd", null, "/"), " to type commands, ", h("kbd.ewc-kbd", null, "⇧?"), " for all keys."),
		h("button.ewc-btn.ewc-btn--sm.ewc-hint__x", {
			type: "button",
			"data-ewc-act": "hint-dismiss",
			onclick: () => {
				setHintOff(true);
				card.hidden = true;
			},
		}, "Got it"));
	region.prepend(card);
	api.onShowHint(() => {
		setHintOff(false);
		card.hidden = false;
		card.querySelector(".ewc-hint__x")?.focus({preventScroll: true});
		card.scrollIntoView?.({block: "nearest"});
	});
}
