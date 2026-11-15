/**
 * Stage: the view header (HP, AC, conditions, effects, concentration) above the site's native statblock for the viewed
 * creature, with limited-use trackers drawn inside it by the shared resource view. d20 dice in the statblock are routed
 * to `onRoll` so encounter modifiers and conditions apply.
 */

import {getEncounterRollFromPackedDice} from "../encounterworkspace-roll.js";
import {getEncounterResourcePanel, renderEncounterInlineResources} from "../encounterworkspace-resource-view.js";
import {getEncounterConcentration, getEncounterConcentrationTargets} from "../encounterworkspace-fx.js";
import {h, kbd, replaceKeepingFocus} from "./dom.js";
import {COCKPIT_TALLY_BUCKETS, getCockpitAcValue, getCockpitCrText, getCockpitHpState} from "./model.js";
import {getCockpitSigned, getCockpitStageDeltas} from "./stage-model.js";

export class EncounterCockpitStatblock {
	/**
	 * @param head Header container. @param body Statblock container (the scrolling pane is its parent).
	 * callbacks: {onRoll({instance, roll, rollMode, evt}), onResourceAction(id, action), onError(message),
	 *   onViewActive(), onToggleSelect(id), onRevive(id), onDropConcentration(id)}
	 * decorators: [(table, instance, ctx, tile) => void] — run after every statblock render (P3 save/AC overlays).
	 *   `table` is the native statblock (null for party members, who get a PC card); `tile` the `.ewc-sb` article.
	 */
	constructor ({head, body, hover, callbacks, decorators = []}) {
		this._head = head;
		this._body = body;
		this._hover = hover;
		this._cb = callbacks;
		this._decorators = decorators;
		this._sig = null;
		this._viewedId = null;
		this._ctx = null;

		this._body.addEventListener("click", evt => this._onDiceClick(evt), true);
	}

	addDecorator (fn) {
		this._decorators.push(fn);
		this._sig = null;
		if (this._ctx) this.render(this._ctx);
	}

	/** ctx: {state, ui, labels, isTurn(id), activeId, conditionCatalog, effectItems, getDerived, getEffective,
	 *   getConditionColor, initiativeOf} */
	render (ctx) {
		this._ctx = ctx;
		const instance = ctx.state.instances.find(it => it.id === ctx.ui.viewedId);
		if (!instance) {
			replaceKeepingFocus(this._head, [h("p.ewc-muted.ewc-stage__none", null, ctx.state.instances.length ? "Pick a creature from the initiative rail." : "No creatures in this encounter yet.")]);
			this._body.replaceChildren();
			this._sig = null;
			this._viewedId = null;
			return;
		}
		replaceKeepingFocus(this._head, this._getHead(instance, ctx));
		this._renderBody(instance, ctx);
	}

	_getHead (instance, ctx) {
		const label = ctx.labels.get(instance.id);
		const hp = instance.hp || {};
		const hpState = getCockpitHpState(hp);
		const effective = ctx.getEffective(instance);
		const derived = ctx.getDerived(instance) || {};
		const acBase = getCockpitAcValue(effective?.ac);
		const ac = derived.ac ?? acBase;
		const out = [];

		const activeId = ctx.activeInstanceId;
		if (activeId && activeId !== instance.id && ctx.labels.has(activeId)) {
			out.push(h("button.ewc-away", {
				type: "button",
				"data-ewc-fk": "vh-back",
				title: "Back to the active creature (Space)",
				onclick: () => this._cb.onViewActive(),
			}, h("span.ewc-away__dot", {"aria-hidden": "true"}), "Viewing ", h("b", null, label), h("span.ewc-away__sep", {"aria-hidden": "true"}, "·"), "back to ",
			h("span.ewc-away__who", null, ctx.labels.get(activeId)), kbd(["Space"])));
		}

		const isSel = ctx.ui.selectedIds.includes(instance.id);
		const name = h("h2.ewc-vh__name", null, label);
		this._hover.bindCreature(name, instance);
		out.push(h("div.ewc-vh__top", null,
			name,
			ctx.isTurn(instance.id) ? h("span.ewc-vh__tag", null, "Their turn") : null,
			hpState.cls === "is-down" || instance.defeated ? h("span.ewc-vh__tag.ewc-vh__tag--bad", null, instance.defeated ? "Defeated" : "Down")
				: hpState.word === "Bloodied" ? h("span.ewc-vh__tag.ewc-vh__tag--warn", null, "Bloodied") : null,
			instance.defeated || hpState.cls === "is-down" ? h("button.ewc-btn.ewc-btn--sm.ewc-vh__revive", {
				type: "button",
				"data-ewc-fk": "vh-revive",
				title: "Bring it back into the fight at 1 HP (clears death saves and the 0 HP Unconscious)",
				onclick: () => this._cb.onRevive?.(instance.id),
			}, "Revive") : null,
			h("button.ewc-btn.ewc-btn--sm.ewc-vh__sel", {
				type: "button",
				"data-ewc-fk": "vh-sel",
				"aria-pressed": `${isSel}`,
				title: `${isSel ? "Unselect" : "Select"} this creature (X)`,
				onclick: () => this._cb.onToggleSelect(instance.id),
			}, isSel ? "Selected" : "Select", kbd(["X"])),
		));

		const pct = hpState.fraction == null ? 0 : Math.round(100 * hpState.fraction);
		let speed = null;
		try { speed = derived.speedText ?? (effective?.speed ? Parser.getSpeedString(effective) : null); } catch (e) { /* unusual speed data */ }
		const isPc = instance.kind === "party";
		const cr = isPc ? null : getCockpitCrText(effective?.cr);
		let xp = null;
		try { xp = cr ? Parser.crToXp(cr) : null; } catch (e) { /* non-standard CR */ }
		out.push(h("div.ewc-vh__stats", null,
			h("span.ewc-vh__stat", null, "HP ", h("b", null, `${hp.current ?? "—"}`), `/${hp.max ?? "—"}`,
				hp.temp ? h("span.ewc-vh__tmp", null, ` +${hp.temp} temp`) : null,
				h(`span.ewc-vh__hpbar.${hpState.cls}`, {"aria-hidden": "true"}, h("i", {style: {"--p": (pct / 100).toFixed(3)}}))),
			h("span.ewc-vh__stat", {title: derived.acReasons?.length ? derived.acReasons.join(", ") : null}, "AC ",
				ac !== acBase && acBase != null ? [h("s", null, `${acBase}`), " ", h("b.is-changed", null, `${ac}`)] : h("b", null, `${ac ?? "—"}`)),
			h("span.ewc-vh__stat", null, "Init ", h("b", null, `${ctx.initiativeOf(instance) ?? "—"}`)),
			speed ? h("span.ewc-vh__stat", null, "Speed ", h("b", null, speed)) : null,
			cr ? h("span.ewc-vh__stat", null, "CR ", h("b", null, cr), xp ? h("span.ewc-muted", null, ` ${xp} XP`) : null) : null,
			isPc && instance.party?.passive != null ? h("span.ewc-vh__stat", {title: "Passive Perception"}, "Passive ", h("b", null, `${instance.party.passive}`)) : null,
		));

		const spell = getEncounterConcentration(instance);
		if (spell) {
			const n = getEncounterConcentrationTargets(ctx.state, instance.id).length;
			const dis = derived.derived?.concentration?.disadvantage || [];
			out.push(h("div.ewc-vh__line.ewc-vh__conc", null,
				h("span.ewc-vh__lbl", null, "◉ Concentrating"),
				h("b", null, spell),
				n ? h("span", null, ` · on ${n} creature${n === 1 ? "" : "s"}`) : null,
				h("span.ewc-muted", {title: "Damage calls for a Constitution save: DC 10 or half the damage, whichever is higher"},
					" · CON save when damaged", dis.length ? h("span.ewc-vh__dis", {title: dis.map(it => it.label).join(", ")}, ` (disadv · ${dis.map(it => it.label).join(", ")})`) : null),
				h("button.ewc-btn.ewc-btn--sm.ewc-btn--link.ewc-vh__drop", {
					type: "button",
					"data-ewc-fk": "vh-conc-drop",
					title: `End concentration on ${spell}${n ? " and the effects it holds up" : ""}`,
					onclick: () => this._cb.onDropConcentration?.(instance.id),
				}, "Drop"),
			));
		}

		const conditions = instance.conditions || [];
		const items = (ctx.effectItems(instance) || []);
		if (conditions.length || items.length) {
			out.push(h("div.ewc-vh__line", null,
				h("span.ewc-vh__lbl", null, "On it"),
				conditions.map(cond => {
					const details = instance.conditionDetails?.[cond];
					const level = cond.toLowerCase() === "exhaustion" ? Number(details?.level) || 1 : null;
					const pill = h("span.ewc-pill.ewc-pill--cond", {tabindex: "0", style: ctx.getConditionColor ? {"--ewc-cond": ctx.getConditionColor(cond)} : null},
						cond.toTitleCase(), level ? ` ${level}` : null, details?.rounds != null ? h("small", null, ` ${details.rounds}r`) : null);
					return this._hover.bindCondition(pill, cond, {conditionCatalog: ctx.conditionCatalog});
				}),
				items.map(item => {
					const glyph = COCKPIT_TALLY_BUCKETS.find(([k]) => k === item.k)?.[1] || "•";
					const pill = h(`span.ewc-pill.ewc-pill--fx.ewc-pill--${item.k}`, {tabindex: "0"}, h("span", {"aria-hidden": "true"}, `${glyph} `), item.label,
						item.rounds != null ? h("small", null, ` ${item.rounds}r`) : null);
					const effect = item.source === "effect" ? (instance.effects || []).find(it => it.id === item.id) : null;
					if (effect) this._hover.bindEffect(pill, instance, effect);
					else if (item.hoverEntry) this._hover.bindEntry(pill, `item:${instance.id}:${item.k}:${item.id}`, item.hoverEntry);
					return pill;
				}),
			));
		}
		if (derived.notes?.length) out.push(h("div.ewc-vh__line", null, h("span.ewc-vh__lbl", null, "Rolls"), derived.notes.join(" · ")));
		return out;
	}

	_renderBody (instance, ctx) {
		if (instance.kind === "party") return this._renderPcCard(instance, ctx);
		const effective = ctx.getEffective(instance);
		const sig = JSON.stringify([instance.id, instance.statblockOperations, instance.resources, instance.monster?.name, instance.monster?.source, ctx.labels.get(instance.id), this._decorators.length]);
		if (sig === this._sig) {
			this._runDecorators(this._body.querySelector("table.ve-stats"), instance, ctx, this._body.querySelector(".ewc-sb"));
			return;
		}
		const pane = this._body.parentElement;
		const scrollTop = this._viewedId === instance.id ? pane?.scrollTop ?? 0 : 0;
		const focusKey = this._body.contains(document.activeElement) ? document.activeElement.dataset?.resourceControl : null;
		const openKeys = new Set([...this._body.querySelectorAll("details[data-resource-key]")].filter(it => it.open).map(it => it.dataset.resourceKey));
		const wasManagerOpen = this._body.querySelector(".ew__resource-manager")?.open;

		const label = ctx.labels.get(instance.id);
		const onAction = action => this._cb.onResourceAction(instance.id, action);
		const tile = h("article.ewc-sb.ew__statblock", {
			"data-instance-id": instance.id,
			"data-resource-type": Parser.monTypeToFullObj(effective?.type || "")?.types?.[0] || "",
		});
		const table = h("table.ve-w-100.ve-stats");
		let matched = new Set();
		try {
			table.append(h("tbody", {html: Renderer.monster.getCompactRenderedString(MiscUtil.copyFast(effective), {isShowScalers: false})}));
			// The site's `!important` fixed layout overlaps the AC/Init/HP cells in a narrow stage; the cockpit class
			//   keeps it fixed on wide screens only.
			table.querySelectorAll(".ve-table-layout-fixed").forEach(it => it.classList.replace("ve-table-layout-fixed", "ewc-sb__fixed"));
			// The site's page-level two-column toggle has no meaning in the stage and collides with the name.
			table.querySelectorAll(".ve-stats__btn-two-col").forEach(it => it.remove());
			matched = renderEncounterInlineResources({instance, effective, table, onAction});
		} catch (e) {
			setTimeout(() => { throw e; });
			table.replaceChildren(h("tbody", null, h("tr", null, h("td", null, h("p.ewc-error", null, `This statblock could not be rendered: ${e.message}`)))));
		}
		const panel = getEncounterResourcePanel({instance, label, onAction, matched});
		panel.querySelectorAll("details[data-resource-key]").forEach(details => { details.open = openKeys.has(details.dataset.resourceKey); });
		const manager = panel.querySelector(".ew__resource-manager");
		if (manager && wasManagerOpen != null) manager.open = wasManagerOpen;
		tile.append(table, panel);

		this._body.replaceChildren(tile);
		this._runDecorators(table, instance, ctx, tile);
		this._sig = sig;
		this._viewedId = instance.id;
		if (pane) pane.scrollTop = scrollTop;
		if (focusKey) {
			const controls = [...this._body.querySelectorAll("[data-resource-control]")];
			const opposite = focusKey.endsWith(":spend") ? focusKey.replace(/:spend$/, ":restore")
				: focusKey.endsWith(":restore") ? focusKey.replace(/:restore$/, ":spend") : null;
			const control = controls.find(it => it.dataset.resourceControl === focusKey && !it.disabled)
				|| controls.find(it => it.dataset.resourceControl === opposite && !it.disabled);
			control?.focus({preventScroll: true});
		}
	}

	_runDecorators (table, instance, ctx, tile) {
		this._decorators.forEach(fn => {
			try {
				fn(table, instance, ctx, tile);
			} catch (e) {
				setTimeout(() => { throw e; });
			}
		});
	}

	/** Party members have no monster statblock: a card with what the DM tracks; the player rolls at the table. */
	_renderPcCard (instance, ctx) {
		let tile = this._body.querySelector(".ewc-sb--pc");
		if (!tile || tile.dataset.instanceId !== instance.id) {
			tile = h("article.ewc-sb.ewc-sb--pc.ew__statblock", {"data-instance-id": instance.id}, h("div.ewc-pccard"));
			this._body.replaceChildren(tile);
			if (this._body.parentElement) this._body.parentElement.scrollTop = 0;
		}
		this._sig = null;
		this._viewedId = instance.id;
		const shell = ctx.getDerived(instance) || {};
		const derived = shell.derived;
		const party = instance.party || {};
		const hp = instance.hp || {};
		const acBase = party.ac ?? null;
		const ac = shell.ac ?? derived?.ac?.value ?? acBase;
		const deltas = getCockpitStageDeltas(derived).filter(it => it.text !== "AC");
		const init = party.initBonus;
		replaceKeepingFocus(tile.querySelector(".ewc-pccard"), [
			h("h3.ewc-pccard__name", null, ctx.labels.get(instance.id)),
			h("p.ewc-pccard__sub", null, "player character — the player rolls; you track."),
			deltas.length ? h("div.ewc-pccard__active", null, h("span.ewc-pccard__k", null, "Active effects"),
				h("span.ewc-sb__deltas", null, deltas.map((it, ix) => [ix ? " · " : null, it.from != null ? [it.text, " ", h("s", null, it.from), " ", h("b", null, it.to)] : it.text]))) : null,
			h("dl.ewc-pccard__stats", null,
				h("div", null, h("dt", null, "AC"), h("dd", null, ac !== acBase && acBase != null ? [h("s", null, `${acBase}`), " ", h("b.is-changed", null, `${ac}`)] : `${ac ?? "—"}`)),
				h("div", null, h("dt", null, "HP"), h("dd", null, `${hp.current ?? "—"}`, h("small", null, ` / ${hp.max ?? "—"}`), hp.temp ? h("small", null, ` +${hp.temp} temp`) : null)),
				h("div", null, h("dt", null, "Init bonus"), h("dd", null, init != null ? getCockpitSigned(init) : "—")),
				h("div", null, h("dt", null, "Passive Perception"), h("dd", null, `${party.passive ?? "—"}`)),
			),
			h("p.ewc-pccard__note", null, "Saves and attacks are rolled at the table. Effects and conditions above still apply — the Save tool shows their modifiers for the player to add."),
		].filter(Boolean));
		this._runDecorators(null, instance, ctx, tile);
	}

	_onDiceClick (evt) {
		const link = evt.target.closest?.("[data-packed-dice]");
		if (!link || !this._body.contains(link)) return;
		const tile = link.closest(".ewc-sb");
		const instance = this._ctx?.state.instances.find(it => it.id === tile?.dataset.instanceId);
		if (!instance) return;
		let entry;
		try {
			entry = JSON.parse(link.dataset.packedDice);
		} catch (e) {
			return this._cb.onError(`The statblock dice link cannot be read: ${e.message}`);
		}
		const roll = getEncounterRollFromPackedDice(entry);
		if (!roll) return;
		if (roll.unsupported) return this._cb.onError(roll.unsupported);
		evt.preventDefault();
		evt.stopImmediatePropagation();
		const rollMode = (evt.ctrlKey || evt.metaKey) ? "disadvantage" : evt.shiftKey ? "advantage" : "normal";
		this._cb.onRoll({instance, roll, rollMode, evt});
	}
}
