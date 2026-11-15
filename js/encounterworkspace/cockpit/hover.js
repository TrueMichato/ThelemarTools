/**
 * Hover adapter: attaches the site's native `Renderer.hover` windows to cockpit elements.
 * Real entities (creatures, conditions, spells, items) hover by page/source/hash; local entities (custom effects,
 * battlefield rules) hover through predefined entries so they look identical to every other hover on the site.
 */

import {getNpcTrackerConditionHoverMeta} from "../../dmscreen/npctracker/dmscreen-npctracker-condition.js";

export class EncounterCockpitHover {
	constructor () {
		this._predefinedIds = new Map();
	}

	/** Bind a native link hover. meta: {page, source, hash, customHashId?}. */
	bindLink (ele, meta) {
		if (!ele || !meta?.page || !meta?.hash) return ele;
		ele.dataset.ewcHover = meta.page;
		const opts = {isSpecifiedLinkData: true, ...meta};
		ele.addEventListener("mouseover", evt => Renderer.hover.pHandleLinkMouseOver(evt, ele, opts));
		ele.addEventListener("mousemove", evt => Renderer.hover.handleLinkMouseMove(evt, ele));
		ele.addEventListener("mouseleave", evt => Renderer.hover.handleLinkMouseLeave(evt, ele));
		return ele;
	}

	/**
	 * Bind a hover for a local entity (no page of its own). `key` keeps the cache bounded across re-renders.
	 * entry: any renderable entry, e.g. {type: "entries", name, entries: [...]}.
	 */
	bindEntry (ele, key, entry) {
		if (!ele || !entry) return ele;
		let id = this._predefinedIds.get(key);
		if (id == null) {
			const meta = Renderer.hover.getMakePredefinedHover(entry);
			id = meta.id;
			this._predefinedIds.set(key, id);
		} else {
			Renderer.hover.updatePredefinedHover(id, entry);
		}
		ele.dataset.ewcHover = "local";
		ele.addEventListener("mouseover", evt => Renderer.hover.handlePredefinedMouseOver(evt, ele, id, {}));
		ele.addEventListener("mousemove", evt => Renderer.hover.handlePredefinedMouseMove(evt, ele));
		ele.addEventListener("mouseleave", evt => Renderer.hover.handlePredefinedMouseLeave(evt, ele));
		return ele;
	}

	bindCondition (ele, condition, {conditionCatalog}) {
		const meta = getNpcTrackerConditionHoverMeta(condition, {conditionCatalog});
		if (meta) return this.bindLink(ele, meta);
		return this.bindEntry(ele, `condition:${condition}`, {type: "entries", name: `${condition}`.toTitleCase(), entries: ["No rules text is available for this condition."]});
	}

	bindCreature (ele, instance) {
		const meta = getCockpitCreatureHoverMeta(instance);
		return meta ? this.bindLink(ele, meta) : ele;
	}

	/** A custom (instance-level) effect: rendered from its own fields. */
	bindEffect (ele, instance, effect) {
		return this.bindEntry(ele, `effect:${instance.id}:${effect.id}`, getCockpitEffectHoverEntry(effect));
	}

	dispose () {
		this._predefinedIds.forEach(id => Renderer.hover.deletePredefinedHover(id));
		this._predefinedIds.clear();
	}
}

export function getCockpitCreatureHoverMeta (instance) {
	const monster = instance?.monster;
	if (!monster?.name || !monster?.source || instance.kind === "party") return null;
	const meta = {
		page: UrlUtil.PG_BESTIARY,
		source: monster.source,
		hash: UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BESTIARY](monster),
	};
	if (instance.customHashId) meta.customHashId = instance.customHashId;
	return meta;
}

export function getCockpitSpellHoverMeta ({name, source = Parser.SRC_PHB}) {
	if (!name) return null;
	return {page: UrlUtil.PG_SPELLS, source, hash: UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_SPELLS]({name, source})};
}

const _MOD_TARGET_LABELS = {ac: "AC", attack: "Attack rolls", save: "Saving throws", check: "Ability checks", damage: "Damage", speed: "Speed", initiative: "Initiative"};

/** Renderable entry for a custom effect. Keeps to fields every effect has; unknown mod targets are shown verbatim. */
export function getCockpitEffectHoverEntry (effect) {
	const entries = [];
	if (effect.description) entries.push(effect.description);
	const mods = (effect.mods || []).map(mod => {
		const target = _MOD_TARGET_LABELS[mod.target] || mod.target;
		const value = mod.value == null ? "" : typeof mod.value === "number" ? (mod.value >= 0 ? `+${mod.value}` : `${mod.value}`) : `${mod.value}`;
		return [target, mod.skill ? `(${mod.skill})` : "", mod.kind && mod.kind !== "bonus" ? mod.kind : "", value].filter(Boolean).join(" ");
	});
	if (mods.length) entries.push({type: "list", items: mods});
	const meta = [effect.kind ? `${effect.kind}`.toTitleCase() : null, effect.source || null, effect.rounds != null ? `${effect.rounds} rounds left` : "Until removed"].filter(Boolean);
	entries.push(`{@note ${meta.join(" · ").replace(/[{}|]/g, "")}}`);
	return {type: "entries", name: effect.name, entries, data: {hoverTitle: effect.name}};
}
