/**
 * Prep statblock surfacing: the conditions and effects a creature is under, as hoverable pills inside the native statblock
 *   (directly under its name), so they read with the stat block rather than only in the view header.
 */
import {h} from "../dom.js";
import {COCKPIT_TALLY_BUCKETS} from "../model.js";

const ROW_CLASS = "ewc-prep-sbfx";

export function installPrepStatblockEffects (api) {
	api.addStatblockDecorator((table, instance, ctx) => {
		if (!table) return;
		table.querySelectorAll(`tr.${ROW_CLASS}`).forEach(it => it.remove());
		const conditions = instance.conditions || [];
		const items = ctx.effectItems?.(instance) || [];
		if (!conditions.length && !items.length) return;

		const pills = [
			...conditions.map(cond => {
				const rounds = instance.conditionDetails?.[cond]?.rounds;
				const pill = h("span.ewc-pill.ewc-pill--cond", {tabindex: "0", style: ctx.getConditionColor ? {"--ewc-cond": ctx.getConditionColor(cond)} : null},
					cond.toTitleCase(), rounds != null ? h("small", null, ` ${rounds}r`) : null);
				return api.hover.bindCondition(pill, cond, {conditionCatalog: ctx.conditionCatalog});
			}),
			...items.map(item => {
				const glyph = COCKPIT_TALLY_BUCKETS.find(([k]) => k === item.k)?.[1] || "•";
				const pill = h(`span.ewc-pill.ewc-pill--fx.ewc-pill--${item.k}`, {tabindex: "0"}, h("span", {"aria-hidden": "true"}, `${glyph} `), item.label,
					item.rounds != null ? h("small", null, ` ${item.rounds}r`) : null);
				const effect = item.source === "effect" ? (instance.effects || []).find(it => it.id === item.id) : null;
				if (effect) api.hover.bindEffect(pill, instance, effect);
				else if (item.hoverEntry) api.hover.bindEntry(pill, `sbfx:${instance.id}:${item.k}:${item.id}`, item.hoverEntry);
				return pill;
			}),
		];
		const row = h(`tr.${ROW_CLASS}`, null, h("td", {colspan: "6"},
			h("div.ewc-prep-sbfx__in", {"aria-label": "Effects on this creature"}, h("span.ewc-prep-sbfx__lbl", null, "Under"), pills)));
		const tbody = table.querySelector("tbody");
		if (!tbody) return;
		const nameRow = tbody.querySelector("tr");
		if (nameRow?.nextSibling) tbody.insertBefore(row, nameRow.nextSibling);
		else tbody.append(row);
	});
}
