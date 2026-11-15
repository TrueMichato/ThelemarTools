/**
 * Bottom dock: a target line and tabbed panels that act on the selection, or on the viewed creature when nothing is
 * selected. HP and Cond are built here; Roll and Fx are registered slots that later phases fill in with
 * `dock.registerTab({id, label, keys, render(ctx, panel)})`.
 */

import {ENCOUNTER_DAMAGE_SOURCES, ENCOUNTER_DAMAGE_TYPES} from "../encounterworkspace-damage.js";
import {h, kbd, replaceKeepingFocus} from "./dom.js";
import {
	COCKPIT_COMMON_DAMAGE_TYPES,
	getCockpitConditionPressed,
	getCockpitExhaustionLevel,
	getCockpitPlural,
	parseCockpitAmount,
	parseCockpitRounds,
} from "./model.js";

const SOURCE_LABELS = {
	unspecified: "Source not specified",
	nonmagicalAttack: "Nonmagical attack",
	magicalAttack: "Magical attack",
	other: "Other (spell, trap, …)",
};

/** A tab that exists in the layout but whose panel a later phase provides. */
const getSlotTab = (id, label, keys, what) => ({
	id,
	label,
	keys,
	isSlot: true,
	render: (ctx, panel) => panel.append(h("p.ewc-dock__slot", {"data-ewc-slot": id}, `${what} will appear here.`)),
});

export class EncounterCockpitDock {
	/**
	 * callbacks: {
	 *   pDamage({amount, amountText, damageType, source, isCrit, decisions, targetIds}) → {ok} | {unresolved: [...]}
	 *   pHp({mode: "heal"|"temp"|"set", amount, amountText, targetIds}),
	 *   pCondition({condition, isAdd, rounds, targetIds}),
	 *   pExhaustion({delta, targetIds}),
	 *   onClearSelection(), onError(message), onTabChange(id)
	 * }
	 */
	constructor ({root, hover, callbacks}) {
		this._root = root;
		this._hover = hover;
		this._cb = callbacks;
		this._tabs = [
			{id: "hp", label: "HP", keys: ["H"], render: (ctx, panel) => this._renderHp(ctx, panel)},
			getSlotTab("roll", "Roll", ["R"], "Saving throws, ability checks and skills for the targets"),
			{id: "cond", label: "Cond", keys: ["C"], render: (ctx, panel) => this._renderCond(ctx, panel)},
			getSlotTab("fx", "Fx", ["E"], "Spell and custom effects"),
		];
		this._tab = "hp";
		this._hpForm = {amount: "", damageType: null, isAllTypes: false, source: "unspecified", isCrit: false};
		this._condForm = {rounds: ""};
		this._review = null;
		this._isBusy = false;
		this._ctx = null;
	}

	get tab () { return this._tab; }
	get tabs () { return this._tabs.map(({id, label, keys, isSlot}) => ({id, label, keys, isSlot: !!isSlot})); }

	/** Add or replace a tab. Replacing a slot keeps its position. */
	registerTab (tab) {
		const ix = this._tabs.findIndex(it => it.id === tab.id);
		if (ix >= 0) this._tabs[ix] = {...tab, isSlot: false};
		else this._tabs.push({...tab, isSlot: false});
		if (this._ctx) this.render(this._ctx);
	}

	/** Open a tab with its form prefilled — only tabs that expose `preset(patch)` support it. */
	presetTab (id, patch) {
		const tab = this._tabs.find(it => it.id === id);
		if (!tab?.preset) return false;
		tab.preset(patch || {});
		return this.setTab(id);
	}

	setTab (id, {isFocus = true} = {}) {
		if (!this._tabs.some(it => it.id === id)) return false;
		this._tab = id;
		this._cb.onTabChange?.(id);
		if (this._ctx) this.render(this._ctx);
		if (isFocus) this._focusPrimary();
		return true;
	}

	/** Focus the first useful field of the open panel (used by H / C shortcuts and row quick actions). */
	_focusPrimary () {
		const target = this._root.querySelector("[data-ewc-primary]") || this._root.querySelector(".ewc-dock__panel button, .ewc-dock__panel input");
		target?.focus({preventScroll: true});
		if (target?.select) target.select();
	}

	/** True if a pending damage review was cancelled (Esc does one thing at a time). */
	cancelReview () {
		if (!this._review) return false;
		this._review = null;
		if (this._ctx) this.render(this._ctx);
		return true;
	}

	/** ctx: {state, labels, targetIds, isSelection, conditions, conditionCatalog, ruleset, getConditionColor, isMac} */
	render (ctx) {
		this._ctx = ctx;
		if (this._review && (this._review.state !== ctx.state || this._review.targetIds.join() !== ctx.targetIds.join())) this._review = null;
		const tab = this._tabs.find(it => it.id === this._tab) || this._tabs[0];
		const panel = h("div.ewc-dock__panel", {role: "tabpanel", id: "ewc-dock-panel", "aria-labelledby": `ewc-tab-${tab.id}`, "data-ewc-panel": tab.id});
		try {
			tab.render(this._getTabCtx(ctx), panel);
		} catch (e) {
			setTimeout(() => { throw e; });
			panel.replaceChildren(h("p.ewc-error", null, `This panel could not be drawn: ${e.message}`));
		}
		replaceKeepingFocus(this._root, [this._getTargetLine(ctx), this._getTabList(tab, ctx), panel]);
	}

	/** The context handed to registered tab renderers. */
	_getTabCtx (ctx) {
		return {...ctx, targets: ctx.state.instances.filter(it => ctx.targetIds.includes(it.id)), hover: this._hover};
	}

	_getTargetLine (ctx) {
		const names = ctx.targetIds.map(id => ctx.labels.get(id));
		if (!names.length) return h("p.ewc-dock__target.is-none", {"aria-live": "polite"}, "No target — view or select a creature on the rail.");
		const list = names.length > 3 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(", ");
		if (ctx.isSelection) {
			return h("p.ewc-dock__target.is-sel", {"aria-live": "polite", title: names.join(", ")},
				h("span.ewc-dock__k", null, `Selected ${names.length}`), h("b", null, list),
				h("button.ewc-btn.ewc-btn--link", {type: "button", "data-ewc-fk": "dock-clear", onclick: () => this._cb.onClearSelection()}, "Clear", kbd(["Esc"])));
		}
		return h("p.ewc-dock__target", {"aria-live": "polite"},
			h("span.ewc-dock__k", null, "Target"), h("b", null, list), h("span.ewc-muted", null, " · the creature you're viewing"));
	}

	_getTabList (active, ctx) {
		const onKeyDown = evt => {
			if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(evt.key)) return;
			evt.preventDefault();
			const ix = this._tabs.findIndex(it => it.id === this._tab);
			const next = evt.key === "Home" ? 0 : evt.key === "End" ? this._tabs.length - 1
				: (ix + (evt.key === "ArrowRight" ? 1 : -1) + this._tabs.length) % this._tabs.length;
			this.setTab(this._tabs[next].id, {isFocus: false});
			this._root.querySelector(`#ewc-tab-${this._tabs[next].id}`)?.focus();
		};
		return h("div.ewc-dock__tabs", {role: "tablist", "aria-label": "Act on the target", onkeydown: onKeyDown},
			this._tabs.map(tab => h(`button.ewc-dock__tab${tab.isSlot ? ".is-slot" : ""}`, {
				type: "button",
				role: "tab",
				id: `ewc-tab-${tab.id}`,
				"data-ewc-fk": `tab-${tab.id}`,
				"data-ewc-tab": tab.id,
				"aria-selected": `${tab.id === active.id}`,
				"aria-controls": "ewc-dock-panel",
				tabindex: tab.id === active.id ? "0" : "-1",
				title: tab.isSlot ? `${tab.label} — not built yet` : `${tab.label}${tab.keys?.length ? ` (${tab.keys.join("+")})` : ""}`,
				onclick: () => this.setTab(tab.id, {isFocus: false}),
			}, tab.label, tab.keys?.length ? kbd(tab.keys) : null)),
		);
	}

	/* -------------------------------------------- HP -------------------------------------------- */

	_renderHp (ctx, panel) {
		const form = this._hpForm;
		const isNone = !ctx.targetIds.length;
		const amount = h("input.ewc-input.ewc-hp__amt", {
			id: "ewc-hp-amt",
			type: "text",
			inputmode: "text",
			autocomplete: "off",
			spellcheck: "false",
			value: form.amount,
			placeholder: "7 or 2d6+3",
			"data-ewc-fk": "hp-amt",
			"data-ewc-primary": "",
			"aria-describedby": "ewc-hp-amt-hint",
			oninput: () => { form.amount = amount.value; },
			onkeydown: evt => {
				if (evt.key !== "Enter") return;
				evt.preventDefault();
				this._pApplyHp(evt.shiftKey ? "heal" : "damage");
			},
		});
		panel.append(h("div.ewc-field", null,
			h("label.ewc-field__l", {for: "ewc-hp-amt"}, "Amount"),
			amount,
			h("small.ewc-field__hint", {id: "ewc-hp-amt-hint"}, "A number or dice — 7, 2d6+3. Enter = Damage, Shift+Enter = Heal."),
		));

		const types = form.isAllTypes ? ENCOUNTER_DAMAGE_TYPES : COCKPIT_COMMON_DAMAGE_TYPES;
		const chip = type => h("button.ewc-dt", {
			type: "button",
			"data-ewc-fk": `dt-${type}`,
			"data-ewc-dt": type,
			"aria-pressed": `${form.damageType === type}`,
			title: form.damageType === type ? `Clear ${type} (deal untyped damage)` : `${type.toTitleCase()} damage — checks resistances and immunities`,
			onclick: () => { form.damageType = form.damageType === type ? null : type; this.render(this._ctx); },
		}, type.toTitleCase());
		const typeChips = types.map(chip);
		if (form.damageType && !types.includes(form.damageType)) typeChips.push(chip(form.damageType));
		if (form.isAllTypes) {
			typeChips.push(h("button.ewc-dt.ewc-dt--untyped", {
				type: "button",
				"data-ewc-fk": "dt-untyped",
				"aria-pressed": `${form.damageType == null}`,
				title: "No damage type: resistances and immunities are not checked",
				onclick: () => { form.damageType = null; this.render(this._ctx); },
			}, "Untyped"));
		}
		typeChips.push(h("button.ewc-btn.ewc-btn--link.ewc-dt__more", {
			type: "button",
			"data-ewc-fk": "dt-more",
			"aria-expanded": `${form.isAllTypes}`,
			onclick: () => { form.isAllTypes = !form.isAllTypes; this.render(this._ctx); },
		}, form.isAllTypes ? "Fewer types" : "More types…"));
		panel.append(h("fieldset.ewc-field.ewc-dt__set", null,
			h("legend.ewc-field__l", null, "Damage type ", h("span.ewc-muted", null, form.damageType ? `· ${form.damageType}` : "· untyped")),
			h("div.ewc-dt__chips", null, typeChips),
		));

		const source = h("select.ewc-input.ewc-input--sm", {
			"data-ewc-fk": "hp-src",
			"aria-label": "Damage source (for resistances that only apply to some attacks)",
			disabled: !form.damageType,
			onchange: () => { form.source = source.value; },
		}, ENCOUNTER_DAMAGE_SOURCES.map(it => h("option", {value: it, selected: form.source === it}, SOURCE_LABELS[it] || it)));
		const crit = h("input", {
			type: "checkbox",
			"data-ewc-fk": "hp-crit",
			checked: form.isCrit,
			onchange: () => { form.isCrit = crit.checked; },
		});
		panel.append(h("div.ewc-hp__opts", null, source, h("label.ewc-check", {title: "Recorded with the damage (a critical hit on a creature at 0 HP counts as two failed death saves)"}, crit, " Critical hit")));

		const btn = (mode, text, cls, title) => h(`button.ewc-btn${cls}`, {
			type: "button",
			"data-ewc-fk": `hp-${mode}`,
			"data-ewc-hp": mode,
			disabled: isNone || this._isBusy,
			title,
			onclick: () => this._pApplyHp(mode),
		}, text);
		panel.append(h("div.ewc-hp__btns", null,
			btn("damage", "Damage", ".ewc-btn--bad", "Subtract from temporary HP first, then HP"),
			btn("heal", "Heal", "", "Add HP, up to the maximum"),
			btn("temp", "Temp HP", "", "Temporary HP don't stack: the higher value is kept"),
			btn("set", "Set", "", "Set current HP to the amount"),
		));

		if (this._review) panel.append(this._getReview(ctx));
	}

	_resolveAmount () {
		const parsed = parseCockpitAmount(this._hpForm.amount);
		if (!parsed.ok) {
			this._cb.onError(parsed.message);
			this._root.querySelector("#ewc-hp-amt")?.focus();
			return null;
		}
		if (parsed.kind === "fixed") return {amount: parsed.value, amountText: `${parsed.value}`};
		const amount = Renderer.dice.parseRandomise2(parsed.expr);
		if (!Number.isSafeInteger(amount)) {
			this._cb.onError("Those dice could not be rolled.");
			return null;
		}
		return {amount: Math.max(0, amount), amountText: `${parsed.expr} = ${Math.max(0, amount)}`};
	}

	async _pApplyHp (mode) {
		if (this._isBusy || !this._ctx) return;
		const targetIds = [...this._ctx.targetIds];
		if (!targetIds.length) return this._cb.onError("View or select a creature first.");
		const resolved = this._resolveAmount();
		if (!resolved) return;
		this._isBusy = true;
		try {
			if (mode === "damage") {
				const form = this._hpForm;
				const result = await this._cb.pDamage({
					...resolved,
					damageType: form.damageType,
					source: form.damageType ? form.source : "unspecified",
					isCrit: form.isCrit,
					decisions: {},
					targetIds,
				});
				if (result?.unresolved) {
					this._review = {...resolved, damageType: form.damageType, source: form.source, isCrit: form.isCrit, targetIds, unresolved: result.unresolved, state: this._ctx.state};
				} else if (result?.ok) {
					this._hpForm.amount = "";
					this._hpForm.isCrit = false;
				}
			} else {
				const result = await this._cb.pHp({mode, ...resolved, targetIds});
				if (result?.ok) this._hpForm.amount = "";
			}
		} finally {
			this._isBusy = false;
			if (this._ctx) this.render(this._ctx);
			if (this._review) this._root.querySelector(".ewc-review select")?.focus();
		}
	}

	_getReview (ctx) {
		const review = this._review;
		const selects = review.unresolved.map(({id, key, defense, note}) => {
			const text = `${ctx.labels.get(id) || id} · ${defense} · ${note}`;
			return h("label.ewc-review__row", null, h("span", null, text), h("select.ewc-input.ewc-input--sm", {
				"data-instance-id": id,
				"data-defense-key": key,
				"data-ewc-fk": `rv-${id}-${key}`,
				"aria-label": text,
			}, h("option", {value: ""}, "Choose…"), h("option", {value: "yes"}, "Applies"), h("option", {value: "no"}, "Does not apply")));
		});
		const apply = async () => {
			const decisions = {};
			const missing = selects.map(it => it.querySelector("select")).find(select => !select.value);
			if (missing) {
				missing.focus();
				return this._cb.onError("Choose Applies or Does not apply for every conditional defense; no damage has been applied yet.");
			}
			selects.forEach(it => {
				const select = it.querySelector("select");
				(decisions[select.dataset.instanceId] ??= {})[select.dataset.defenseKey] = select.value === "yes";
			});
			if (this._isBusy) return;
			this._isBusy = true;
			try {
				const result = await this._cb.pDamage({
					amount: review.amount,
					amountText: review.amountText,
					damageType: review.damageType,
					source: review.source,
					isCrit: review.isCrit,
					decisions,
					targetIds: review.targetIds,
				});
				if (result?.ok) {
					this._review = null;
					this._hpForm.amount = "";
					this._hpForm.isCrit = false;
				}
			} finally {
				this._isBusy = false;
				if (this._ctx) this.render(this._ctx);
			}
		};
		return h("div.ewc-review", {role: "group", "aria-label": "Conditional defenses"},
			h("p.ewc-review__head", null, h("b", null, `Rolled ${review.amountText} ${review.damageType} once.`), ` Does each ${review.unresolved.length === 1 ? "defense" : "of these defenses"} apply?`),
			selects,
			h("div.ewc-hp__btns", null,
				h("button.ewc-btn.ewc-btn--bad", {type: "button", "data-ewc-fk": "rv-apply", onclick: apply}, "Apply damage"),
				h("button.ewc-btn", {type: "button", "data-ewc-fk": "rv-cancel", onclick: () => this.cancelReview()}, "Cancel", kbd(["Esc"])),
			),
		);
	}

	/* -------------------------------------------- Conditions -------------------------------------------- */

	_renderCond (ctx, panel) {
		const targets = ctx.state.instances.filter(it => ctx.targetIds.includes(it.id));
		const isNone = !targets.length;
		const lists = targets.map(it => it.conditions || []);
		const rounds = h("input.ewc-input.ewc-input--num", {
			id: "ewc-cond-rounds",
			type: "text",
			inputmode: "numeric",
			autocomplete: "off",
			value: this._condForm.rounds,
			placeholder: "∞",
			"data-ewc-fk": "cond-rounds",
			"aria-describedby": "ewc-cond-rounds-hint",
			oninput: () => { this._condForm.rounds = rounds.value; },
		});
		panel.append(h("div.ewc-field.ewc-field--row", null,
			h("label.ewc-field__l", {for: "ewc-cond-rounds"}, "Lasts"), rounds, h("span", null, "rounds"),
			h("small.ewc-field__hint", {id: "ewc-cond-rounds-hint"}, "Blank = until removed"),
		));

		const conditions = (ctx.conditions || []).filter(it => it.name !== "exhaustion");
		const grid = h("div.ewc-cond__grid", {role: "group", "aria-label": "Conditions — toggle on the target"}, conditions.map((cond, ix) => {
			const pressed = isNone ? "false" : getCockpitConditionPressed(lists, cond.name);
			const isTg = ctx.ruleset === "tgtt" && /tgtt|thelemar/i.test(cond.source || "");
			const btn = h("button.ewc-cond", {
				type: "button",
				"data-ewc-fk": `cond-${cond.name}`,
				"data-ewc-cond": cond.name,
				"data-ewc-primary": ix === 0 ? "" : null,
				"aria-pressed": pressed,
				disabled: isNone,
				style: {"--ewc-cond": ctx.getConditionColor(cond.name)},
				onclick: () => this._pToggleCondition(cond.name, pressed !== "true"),
			}, h("span.ewc-cond__sw", {"aria-hidden": "true"}), cond.label, isTg ? h("span.ewc-cond__tg", {title: "Thelemar rules"}, "TG") : null);
			this._hover.bindCondition(btn, cond.name, {conditionCatalog: ctx.conditionCatalog});
			return btn;
		}));
		panel.append(grid);

		const levels = targets.map(getCockpitExhaustionLevel);
		const isMixed = new Set(levels).size > 1;
		const level = levels[0] ?? 0;
		const exhaustion = h("span.ewc-cond__exh-name", {tabindex: "0"}, "Exhaustion");
		this._hover.bindCondition(exhaustion, "exhaustion", {conditionCatalog: ctx.conditionCatalog});
		panel.append(h("div.ewc-cond__exh", {role: "group", "aria-label": "Exhaustion level"},
			exhaustion,
			h("button.ewc-btn.ewc-btn--sm", {type: "button", "data-ewc-fk": "exh-dec", disabled: isNone || (!isMixed && level <= 0), "aria-label": "Lower exhaustion by one level", onclick: () => this._pExhaustion(-1)}, "−"),
			h("output.ewc-cond__exh-v", {"aria-live": "polite"}, isMixed ? "mixed" : `${level}`),
			h("button.ewc-btn.ewc-btn--sm", {type: "button", "data-ewc-fk": "exh-inc", disabled: isNone, "aria-label": "Raise exhaustion by one level", onclick: () => this._pExhaustion(1)}, "+"),
		));
		if (!isNone) panel.append(h("p.ewc-field__hint", null, `Toggles on ${getCockpitPlural(targets.length, "target")}. Half-filled = only some have it; click to give it to all.`));
	}

	async _pToggleCondition (condition, isAdd) {
		if (this._isBusy || !this._ctx) return;
		const parsed = parseCockpitRounds(this._condForm.rounds);
		if (!parsed.ok) return this._cb.onError(parsed.message);
		this._isBusy = true;
		try {
			await this._cb.pCondition({condition, isAdd, rounds: isAdd ? parsed.rounds : null, targetIds: [...this._ctx.targetIds]});
		} finally {
			this._isBusy = false;
		}
	}

	async _pExhaustion (delta) {
		if (this._isBusy || !this._ctx) return;
		this._isBusy = true;
		try {
			await this._cb.pExhaustion({delta, targetIds: [...this._ctx.targetIds]});
		} finally {
			this._isBusy = false;
		}
	}
}
