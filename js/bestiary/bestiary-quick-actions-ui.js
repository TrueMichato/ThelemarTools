import {SourceUiUtil} from "../utils-ui/utils-ui-sourcebuilder.js";
import {BESTIARY_QUICK_ACTIONS_REGISTRY} from "./bestiary-quick-actions-engine.js";
import {BestiaryQuickActionsStructuredEditor} from "./bestiary-quick-actions-structured.js";

const _PROPS_ENTRY = ["trait", "action", "bonus", "reaction", "legendary", "mythic", "spellcasting"];
const _PROPS_ABILITY = ["str", "dex", "con", "int", "wis", "cha"];
const _DAMAGE_TYPE_TO_FULL = {
	A: "acid",
	B: "bludgeoning",
	C: "cold",
	F: "fire",
	O: "force",
	L: "lightning",
	N: "necrotic",
	P: "piercing",
	I: "poison",
	Y: "psychic",
	R: "radiant",
	S: "slashing",
	T: "thunder",
};
const _AREA_TRAIT_META = Object.freeze({
	"acidic nature": {effects: [{type: "defense", prop: "resist", values: ["acid"], upgradeToImmunity: true}]},
	"armor of decay": {effects: [
		{type: "defense", prop: "resist", values: ["necrotic"]},
		{type: "defense", prop: "immune", values: ["poison"]},
		{type: "conditionImmune", values: ["poisoned"]},
	]},
	"fungal infestation": {effects: [{type: "defense", prop: "immune", values: ["poison"]}]},
	"low-light senses": {
		choice: {
			label: "Sense",
			options: ["blindsight 60 ft.", "darkvision 60 ft."],
		},
		fnEffects: choice => [{type: "sense", value: choice}],
	},
	"of unusual size": {effects: [{type: "sizeHitDice", from: ["T", "S"], to: "M", dieFaces: 8}]},
	"rockbreaker": {effects: [{type: "speed", mode: "burrow", value: 30}]},
	"ruin climber": {effects: [{type: "speed", mode: "climb", equalTo: "walk"}]},
	"shadow blend": {effects: [{
		type: "addEntry",
		section: "bonus",
		entry: {
			name: "Shadow Blend",
			entries: ["While in dim light or darkness, the creature takes the Hide action."],
		},
	}]},
	"touch of rot": {effects: [{
		type: "augmentMeleeDamage",
		text: "The attack deals {@damage PB} extra necrotic damage.",
	}]},
	"underground senses": {
		choice: {
			label: "Sense",
			options: ["darkvision 300 ft.", "tremorsense 120 ft.", "blindsight 60 ft."],
		},
		fnEffects: choice => [{type: "sense", value: choice}],
	},
	"undying hunger": {effects: [{type: "sense", value: "blindsight 30 ft. (living creatures only)"}]},
	"used to filth": {effects: [
		{type: "defense", prop: "resist", values: ["poison"], upgradeToImmunity: true},
		{type: "conditionImmune", values: ["poisoned"]},
	]},
	"living forest": {
		exclusions: [
			"Mist lightly obscures the area",
			"The area is difficult terrain",
			"Disadvantage on saves to maintain concentration",
			"Extinguishes magical darkness from spells of 3rd level or lower",
		],
	},
});

function _copy (value) {
	if (value == null) return value;
	if (globalThis.structuredClone) return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function _getElement (tag, {clazz = "", text = null, attrs = null} = {}) {
	const ele = document.createElement(tag);
	if (clazz) ele.className = clazz;
	if (text != null) ele.textContent = text;
	Object.entries(attrs || {}).forEach(([key, value]) => {
		if (value == null) return;
		ele.setAttribute(key, value);
	});
	return ele;
}

function _getButton ({text, clazz = "ve-btn ve-btn-default ve-btn-sm", title = null, onClick}) {
	const btn = _getElement("button", {clazz, text, attrs: {type: "button", title}});
	btn.addEventListener("click", onClick);
	return btn;
}

function _getUid (ent) {
	return `${ent.name || ""}|${ent.source || ""}`.toLowerCase();
}

function _getOperationId () {
	return globalThis.CryptUtil?.uid?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function _getNumber (value) {
	if (typeof value === "number") return value;
	const num = Number(`${value || ""}`.replace(/^\+/, ""));
	return Number.isFinite(num) ? num : 0;
}

function _getAbilityMod (score) {
	return Math.floor((_getNumber(score) - 10) / 2);
}

function _getDamageAverage ({dice, bonus}) {
	const match = /^(?<count>\d+)d(?<faces>\d+)$/.exec(`${dice}`.trim());
	if (!match) return null;
	return Math.floor(Number(match.groups.count) * (Number(match.groups.faces) + 1) / 2 + bonus);
}

function _isEqual (a, b) {
	return JSON.stringify(a) === JSON.stringify(b);
}

function _isMinion (monster) {
	const tags = typeof monster.type === "object" && Array.isArray(monster.type.tags)
		? monster.type.tags
		: [];
	return tags.some(tag => `${typeof tag === "object" ? tag.tag : tag}`.toLowerCase() === "minion")
		|| (monster.trait || []).some(entry => `${entry.name || ""}`.toLowerCase() === "minion");
}

function _getAreaTraitMeta (trait, choices = {}) {
	const meta = _AREA_TRAIT_META[`${trait.name || ""}`.toLowerCase()] || {};
	return {
		effects: _copy(meta.fnEffects ? meta.fnEffects(choices.choice) : meta.effects || []),
		exclusions: meta.exclusions || null,
		choice: meta.choice || null,
	};
}

function _getAreaTraitEntries (trait, choices) {
	const entries = _copy(trait.entries);
	if (`${trait.name}`.toLowerCase() !== "living forest" || !choices.exclusions?.length) return entries;
	const excluded = new Set(choices.exclusions);
	entries[0] = entries[0]
		.replace(
			excluded.has("Mist lightly obscures the area") ? "Mist lightly obscures that area, and " : /$^/,
			"",
		)
		.replace(
			excluded.has("The area is difficult terrain") ? "colorful vines and shifting foliage make its ground difficult terrain. " : /$^/,
			"",
		)
		.replace(
			excluded.has("Disadvantage on saves to maintain concentration") ? "Teasing voices laugh and whisper, giving other creatures in that area disadvantage on saving throws made to maintain concentration on spells and similar effects. " : /$^/,
			"",
		)
		.replace(
			excluded.has("Extinguishes magical darkness from spells of 3rd level or lower") ? "Flickering lights extinguish magical darkness in that area created by spells of 3rd level or lower. " : /$^/,
			"",
		)
		.replace(/\s*\(When adding this trait to a creature,[^)]+\)\s*$/, "")
		.replace(/(^|[.!?]\s+)([a-z])/g, (...match) => `${match[1]}${match[2].toUpperCase()}`);
	return entries;
}

function _getItemEntryText (entries) {
	return JSON.stringify(entries || []);
}

function _getItemAbilityDestination (entries) {
	const text = _getItemEntryText(entries);
	if (/\bbonus action\b/i.test(text)) return "bonus";
	if (/\breaction\b/i.test(text)) return "reaction";
	if (/\b(?:(?:magic|utilize)\s+)?action\b/i.test(text)) return "action";
	return "trait";
}

export class BestiaryQuickActionsItemAnalyzer {
	static analyze (item) {
		const blocks = [];
		const addBlock = ({name, entries}) => {
			if (!entries?.length) return;
			blocks.push({
				name: name || item.name,
				entries: _copy(entries),
				destination: _getItemAbilityDestination(entries),
				isEnabled: true,
			});
		};
		(item.entries || []).forEach(entry => {
			if (entry && typeof entry === "object" && entry.name && Array.isArray(entry.entries)) {
				addBlock({name: entry.name, entries: entry.entries});
				return;
			}
			addBlock({name: item.name, entries: [entry]});
		});
		return blocks;
	}

	static isConditional (item) {
		if (!item?.entries?.length) return false;
		const text = _getItemEntryText(item.entries);
		return /\b(?:activate|animate|command word|bonus action|until|for (?:1|one) minute|while (?:active|animated))\b/i.test(text);
	}
}

export class BestiaryQuickActionsUi {
	static _registry = BESTIARY_QUICK_ACTIONS_REGISTRY;
	static _modalOpenCount = 0;
	static _cache = {
		areaTraits: null,
		legendaryGroups: null,
		items: null,
	};

	static getButtonHtml ({monster, registry = this._registry} = {}) {
		const count = registry.getOperations({monster}).length;
		const title = count
			? `Quick Actions (${count} temporary change${count === 1 ? "" : "s"})`
			: "Quick Actions";

		return `<button type="button" class="bqa__btn-open ve-btn ve-btn-xs ve-btn-default ve-lst-is-exporting-image__hidden no-print" data-bqa-open="true" data-has-override="${count ? "true" : "false"}" aria-label="${title.qq()}" title="${title.qq()}"><span class="glyphicon glyphicon-pencil" aria-hidden="true"></span></button>`;
	}

	static async pOpen ({monster, registry = this._registry, pFnOnSave = null} = {}) {
		if (!monster) throw new Error("A creature is required to open Bestiary Quick Actions.");

		let unsubscribe = null;
		const onClose = () => {
			unsubscribe?.();
			this._modalOpenCount = Math.max(0, this._modalOpenCount - 1);
			if (!this._modalOpenCount) document.body.classList.remove("bqa__modal-active");
		};
		const {eleModalInner, eleModalFooter, doClose} = UiUtil.getShowModal({
			title: `Quick Actions — ${monster._displayName || monster.name}`,
			isUncappedWidth: true,
			isUncappedHeight: true,
			isHeaderBorder: true,
			hasFooter: true,
			cbClose: onClose,
		});
		this._modalOpenCount++;
		document.body.classList.add("bqa__modal-active");

		eleModalInner.classList.add("ve-p-0");
		eleModalInner.parentElement.classList.add("bqa__modal");

		const workspace = _getElement("div", {clazz: "bqa__workspace"});
		const rail = _getElement("aside", {clazz: "bqa__rail"});
		const body = _getElement("div", {clazz: "bqa__body"});
		const status = _getElement("div", {clazz: "bqa__status"});
		const nav = _getElement("div", {clazz: "bqa__nav", attrs: {role: "tablist", "aria-label": "Quick action categories"}});
		const changes = _getElement("div", {clazz: "bqa__changes"});
		const toolbar = _getElement("div", {clazz: "bqa__toolbar"});
		const title = _getElement("h3", {clazz: "bqa__title"});
		const content = _getElement("div", {clazz: "bqa__content"});

		rail.append(status, nav, changes);
		toolbar.append(title);
		body.append(toolbar, content);
		workspace.append(rail, body);
		eleModalInner.append(workspace);

		const sections = [
			{id: "minion", label: "Minion", icon: "glyphicon-user"},
			{id: "area", label: "Area Traits", icon: "glyphicon-tree-conifer"},
			{id: "lair", label: "Lair Actions", icon: "glyphicon-home"},
			{id: "item", label: "Magic Item", icon: "glyphicon-certificate"},
			{id: "edit", label: "Quick Edit", icon: "glyphicon-edit"},
		];
		let activeSection = "minion";

		const navButtons = new Map();
		const pRenderActive = async () => {
			navButtons.forEach((btn, id) => btn.setAttribute("aria-selected", id === activeSection ? "true" : "false"));
			title.textContent = sections.find(it => it.id === activeSection)?.label || "Quick Actions";
			content.replaceChildren(_getElement("div", {clazz: "ve-flex-vh-center ve-h-100", text: "Loading…"}));

			try {
				switch (activeSection) {
					case "minion": return this._pRenderMinion({content, monster, registry});
					case "area": return this._pRenderAreaTraits({content, monster, registry});
					case "lair": return this._pRenderLairActions({content, monster, registry});
					case "item": return this._pRenderMagicItem({content, monster, registry});
					case "edit": return this._pRenderQuickEdit({content, monster, registry});
					default: throw new Error(`Unknown Bestiary Quick Actions section "${activeSection}".`);
				}
			} catch (e) {
				content.replaceChildren(this._getErrorState({
					message: e.message || "This quick action could not be loaded.",
					onRetry: () => pRenderActive(),
				}));
				setTimeout(() => { throw e; });
			}
		};

		sections.forEach(section => {
			const btn = _getElement("button", {
				clazz: "bqa__nav-btn",
				attrs: {
					type: "button",
					role: "tab",
					"aria-selected": section.id === activeSection ? "true" : "false",
				},
			});
			const icon = _getElement("span", {clazz: `glyphicon ${section.icon}`, attrs: {"aria-hidden": "true"}});
			btn.append(icon, document.createTextNode(section.label));
			btn.addEventListener("click", () => {
				activeSection = section.id;
				pRenderActive().then(null);
			});
			navButtons.set(section.id, btn);
			nav.append(btn);
		});

		const renderStatus = () => {
			const operations = registry.getOperations({monster});
			const current = registry.getOverride({monster});
			const statusTitle = _getElement("div", {clazz: "bqa__status-title"});
			statusTitle.append(
				_getElement("span", {clazz: `glyphicon ${operations.length ? "glyphicon-pencil" : "glyphicon-ok"}`, attrs: {"aria-hidden": "true"}}),
				document.createTextNode(operations.length ? "Local override" : "Source creature"),
			);
			const copy = _getElement("div", {
				clazz: "bqa__status-copy",
				text: operations.length
					? `${operations.length} temporary change${operations.length === 1 ? "" : "s"}. Lost on refresh unless saved.`
					: "No temporary changes. The source statblock is untouched.",
			});
			status.replaceChildren(statusTitle, copy);

			const btnSave = _getButton({
				text: "Save to Homebrew",
				clazz: "ve-btn ve-btn-primary ve-btn-sm",
				onClick: () => this._pSaveToHomebrew({monster: current, pFnOnSave}).then(null),
			});
			btnSave.disabled = !operations.length;
			const btnClear = _getButton({
				text: "Clear All",
				clazz: "ve-btn ve-btn-default ve-btn-sm",
				onClick: async () => {
					if (!operations.length) return;
					const isSure = await InputUiUtil.pGetUserBoolean({
						title: "Clear Temporary Changes",
						htmlDescription: "Remove every local override for this statblock? The source creature will remain unchanged.",
						textYes: "Clear Changes",
						textNo: "Cancel",
					});
					if (!isSure) return;
					registry.clear({monster});
				},
			});
			btnClear.disabled = !operations.length;
			toolbar.querySelectorAll("button").forEach(ele => ele.remove());
			toolbar.append(btnClear, btnSave);

			const changeTitle = _getElement("div", {
				clazz: "bqa__changes-summary",
				text: operations.length ? `Changes (${operations.length})` : "No changes yet",
			});
			const changeList = _getElement("div", {clazz: "bqa__list"});
			operations.forEach(operation => {
				const row = _getElement("div", {clazz: "bqa__row"});
				const main = _getElement("div", {clazz: "bqa__row-main"});
				main.append(
					_getElement("div", {clazz: "bqa__row-title", text: operation.label || this._getOperationLabel(operation)}),
					_getElement("div", {clazz: "bqa__row-meta", text: this._getOperationMeta(operation)}),
				);
				row.append(main, _getButton({
					text: "Remove",
					clazz: "ve-btn ve-btn-default ve-btn-xs",
					onClick: () => registry.removeOperation({monster, operationId: operation.id}),
				}));
				changeList.append(row);
			});
			changes.replaceChildren(changeTitle, changeList);
		};

		unsubscribe = registry.subscribe(() => {
			renderStatus();
			pRenderActive().then(null);
		});

		const btnClose = _getButton({text: "Done", onClick: () => doClose()});
		eleModalFooter.append(btnClose);

		renderStatus();
		await pRenderActive();
	}

	static _getOperationLabel (operation) {
		switch (operation.type) {
			case "minion": return "Minion conversion";
			case "applyAreaTrait": return `Area trait: ${operation.data?.trait?.name || "Trait"}`;
			case "addEntry": return `Added ${operation.prop || "entry"}`;
			case "setLegendaryGroup": return "Lair actions";
			case "applyItem": return "Magic item";
			case "patch": return "Quick edit";
			default: return "Temporary change";
		}
	}

	static _getOperationMeta (operation) {
		if (operation.sourceName) return operation.sourceName;
		if (operation.data?.item?.name) return operation.data.item.name;
		if (operation.data?.area) return operation.data.area;
		if (operation.legendaryGroup?.name) return operation.legendaryGroup.name;
		if (operation.entry?.name) return operation.entry.name;
		return "Local only";
	}

	static _getSection ({heading, copy}) {
		const section = _getElement("section", {clazz: "bqa__section"});
		section.append(
			_getElement("h4", {clazz: "bqa__section-heading", text: heading}),
			_getElement("p", {clazz: "bqa__section-copy", text: copy}),
		);
		return section;
	}

	static _getErrorState ({message, onRetry}) {
		const wrp = _getElement("div", {clazz: "bqa__empty"});
		wrp.append(_getElement("p", {text: message}));
		if (onRetry) wrp.append(_getButton({text: "Try Again", onClick: onRetry}));
		return wrp;
	}

	static _getHoverLabel ({name, entries, title = null}) {
		const btn = _getElement("button", {
			clazz: "bqa__entity-link ve-help ve-help--hover",
			text: name,
			attrs: {type: "button", title: title || `View ${name}`},
		});
		if (!entries?.length) return btn;
		const hoverMeta = Renderer.hover.getMakePredefinedHover({type: "entries", name, entries: _copy(entries)}, {isBookContent: false});
		btn.addEventListener("mouseover", evt => hoverMeta.mouseOver(evt, btn));
		btn.addEventListener("mousemove", evt => hoverMeta.mouseMove(evt, btn));
		btn.addEventListener("mouseleave", evt => hoverMeta.mouseLeave(evt, btn));
		btn.addEventListener("touchstart", evt => hoverMeta.touchStart(evt, btn), {passive: true});
		btn.addEventListener("click", () => hoverMeta.show());
		return btn;
	}

	static async _pRenderMinion ({content, monster, registry}) {
		const section = this._getSection({
			heading: "Flee, Mortals! Minion",
			copy: "Turn this creature into a fast, threatening member of a horde without changing its source statblock.",
		});
		const operation = registry.getOperations({monster}).find(it => it.type === "minion");
		const current = registry.getOverride({monster});
		const cr = current.cr?.cr || current.cr;
		const isSourceMinion = !operation && _isMinion(monster);

		const explainer = _getElement("div", {clazz: "bqa__minion-explainer"});
		const summary = _getElement("div", {clazz: "bqa__minion-summary"});
		summary.append(
			_getElement("strong", {text: "What conversion changes"}),
			_getElement("p", {text: "Sets Minion hit points and XP for the creature's CR, replaces unconditional attack damage rolls with static damage, adds the Minion trait and Group Attack label, and removes incompatible Multiattack, bonus actions, and reactions."}),
		);
		const rules = _getElement("details", {clazz: "bqa__minion-rules"});
		rules.append(_getElement("summary", {text: "How minions work at the table"}));
		const rulesBody = _getElement("div", {clazz: "bqa__minion-rules-body"});
		const rulesList = _getElement("ul");
		[
			["No Hit Dice or damage rolls.", "Minions use fixed hit points and deal static damage, keeping large groups quick to run."],
			["Shared turns.", "Minions of the same statblock act together, with the GM dividing movement and actions among them."],
			["Minion trait.", "Damage from an attack or failed save defeats a minion; other damage defeats it only when it meets or exceeds the minion's hit point maximum."],
			["Overkill attacks.", "A sufficiently damaging weapon attack can carry through nearby minions, subject to the attack's reach or range."],
			["Group attacks.", "Several minions can combine one attack, increasing its accuracy while using the attack's static damage once."],
			["Optional rules.", "Group saving throws and tough minions are encounter options; this conversion does not automate them."],
		].forEach(([name, text]) => {
			const item = _getElement("li");
			item.append(_getElement("strong", {text: `${name} `}), document.createTextNode(text));
			rulesList.append(item);
		});
		rulesBody.append(
			_getElement("p", {text: "The conversion prepares the statblock. Initiative grouping, overkill resolution, group attacks, and optional rules are still run by the GM."}),
			rulesList,
		);
		rules.append(rulesBody);
		explainer.append(summary, rules);

		const row = _getElement("div", {clazz: "bqa__row"});
		const main = _getElement("div", {clazz: "bqa__row-main"});
		main.append(
			_getElement("div", {
				clazz: "bqa__row-title",
				text: operation
					? "Minion conversion active"
					: isSourceMinion
						? "Source creature is already a minion"
						: `Convert CR ${cr || "—"} creature`,
			}),
			_getElement("div", {
				clazz: "bqa__row-meta",
				text: operation
					? "Removing this operation restores the original fields while preserving later edits."
					: isSourceMinion
						? "Its standard-creature statistics cannot be reconstructed automatically; use Quick Edit for targeted changes."
						: "Complex attack riders are preserved; attack damage becomes static group-attack damage.",
			}),
		);
		const btn = _getButton({
			text: operation ? "Make Standard" : isSourceMinion ? "Source Minion" : "Make Minion",
			clazz: operation ? "ve-btn ve-btn-warning ve-btn-sm" : "ve-btn ve-btn-primary ve-btn-sm",
			onClick: () => {
				if (operation) return registry.removeOperation({monster, operationId: operation.id});
				try {
					registry.addOperation({
						monster,
						operation: {id: _getOperationId(), type: "minion", label: "Flee, Mortals! minion"},
					});
				} catch (e) {
					JqueryUtil.doToast({type: "danger", content: e.message});
				}
			},
		});
		btn.disabled = isSourceMinion;
		row.append(main, btn);
		section.append(explainer, row);
		content.replaceChildren(section);
	}

	static async _pLoadAreaTraits () {
		if (this._cache.areaTraits) return this._cache.areaTraits;
		const [site, prerelease, brew] = await Promise.all([
			DataLoader.pCacheAndGetAllSite(UrlUtil.PG_OPT_FEATURES),
			PrereleaseUtil.pGetBrewProcessed(),
			BrewUtil2.pGetBrewProcessed(),
		]);
		const all = [...site, ...(prerelease.optionalfeature || []), ...(brew.optionalfeature || [])];
		return this._cache.areaTraits = all
			.filter(it => it.source === "FleeMortals" && it.prerequisite?.some(pr => /Creature$/i.test(pr.other || "")))
			.map(it => ({
				...it,
				_areaName: (it.prerequisite.find(pr => /Creature$/i.test(pr.other || ""))?.other || "Environment")
					.replace(/-Dwelling Creature$/i, "")
					.replace(/-/g, " "),
			}))
			.sort((a, b) => SortUtil.ascSortLower(a._areaName, b._areaName) || SortUtil.ascSortLower(a.name, b.name));
	}

	static async _pRenderAreaTraits ({content, monster, registry}) {
		const section = this._getSection({
			heading: "Area Traits",
			copy: "Add environmental creature traits from loaded Flee, Mortals! content. Each trait remains independently removable.",
		});
		const traits = await this._pLoadAreaTraits();
		if (!traits.length) {
			section.append(this._getErrorState({message: "No Flee, Mortals! area traits are loaded. Install or enable that homebrew source to use this action."}));
			return content.replaceChildren(section);
		}

		const operations = registry.getOperations({monster});
		const groups = new Map();
		traits.forEach(trait => {
			if (!groups.has(trait._areaName)) groups.set(trait._areaName, []);
			groups.get(trait._areaName).push(trait);
		});
		const list = _getElement("div", {clazz: "bqa__area-list"});
		groups.forEach((areaTraits, areaName) => {
			const area = _getElement("section", {clazz: "bqa__area"});
			const active = areaTraits.filter(trait => operations.some(it => it.type === "applyAreaTrait" && it.sourceUid === _getUid(trait)));
			const header = _getElement("div", {clazz: "bqa__area-header"});
			const heading = _getElement("div", {clazz: "bqa__area-heading"});
			heading.append(
				_getElement("h5", {clazz: "bqa__area-name", text: areaName}),
				_getElement("span", {clazz: "bqa__area-count", text: `${active.length} / ${areaTraits.length} applied`}),
			);
			const btnBatch = _getButton({
				text: active.length === areaTraits.length ? "Remove All" : "Add All",
				clazz: active.length === areaTraits.length ? "ve-btn ve-btn-warning ve-btn-xs" : "ve-btn ve-btn-default ve-btn-xs",
				onClick: async () => {
					if (active.length === areaTraits.length) {
						active.forEach(trait => {
							const operation = operations.find(it => it.type === "applyAreaTrait" && it.sourceUid === _getUid(trait));
							if (operation) registry.removeOperation({monster, operationId: operation.id});
						});
						return;
					}
					const missing = areaTraits.filter(trait => !active.includes(trait));
					const choices = await this._pGetAreaTraitChoices({traits: missing});
					if (choices == null) return;
					missing.forEach(trait => this._addAreaTraitOperation({
						monster,
						registry,
						trait,
						choices: choices.get(_getUid(trait)) || {},
					}));
				},
			});
			header.append(heading, btnBatch);
			area.append(header);

			const rows = _getElement("div", {clazz: "bqa__list"});
			areaTraits.forEach(trait => {
				const uid = _getUid(trait);
				const existing = operations.find(it => it.type === "applyAreaTrait" && it.sourceUid === uid);
				const row = _getElement("div", {clazz: "bqa__row"});
				const main = _getElement("div", {clazz: "bqa__row-main"});
				main.append(
					this._getHoverLabel({name: trait.name, entries: trait.entries}),
					_getElement("div", {
						clazz: "bqa__row-meta",
						text: `${Parser.sourceJsonToAbv(trait.source)} p${trait.page} · ${_getAreaTraitMeta(trait).effects.length ? "Changes statblock fields" : "Rendered rule"}`,
					}),
				);
				row.append(main, _getButton({
					text: existing ? "Remove" : "Add",
					clazz: existing ? "ve-btn ve-btn-warning ve-btn-xs" : "ve-btn ve-btn-default ve-btn-xs",
					onClick: async () => {
						if (existing) return registry.removeOperation({monster, operationId: existing.id});
						const choices = await this._pGetAreaTraitChoices({traits: [trait]});
						if (choices == null) return;
						this._addAreaTraitOperation({monster, registry, trait, choices: choices.get(uid) || {}});
					},
				}));
				rows.append(row);
			});
			area.append(rows);
			list.append(area);
		});
		section.append(list);
		content.replaceChildren(section);
	}

	static _addAreaTraitOperation ({monster, registry, trait, choices}) {
		const meta = _getAreaTraitMeta(trait, choices);
		const entries = _getAreaTraitEntries(trait, choices);
		registry.addOperation({
			monster,
			operation: {
				id: _getOperationId(),
				type: "applyAreaTrait",
				data: {
					trait: {name: trait.name, source: trait.source},
					area: trait._areaName,
					entry: {name: trait.name, entries},
					effects: meta.effects,
					choices,
				},
				sourceUid: _getUid(trait),
				sourceName: trait._areaName,
				label: `Area trait: ${trait.name}`,
			},
		});
	}

	static async _pGetAreaTraitChoices ({traits}) {
		const configurable = traits
			.map(trait => ({trait, meta: _getAreaTraitMeta(trait)}))
			.filter(({meta}) => meta.choice || meta.exclusions);
		if (!configurable.length) return new Map();

		return new Promise(resolve => {
			let isResolved = false;
			const finish = value => {
				if (isResolved) return;
				isResolved = true;
				resolve(value);
				doClose();
			};
			const {eleModalInner, eleModalFooter, doClose} = UiUtil.getShowModal({
				title: configurable.length === 1 ? `Configure ${configurable[0].trait.name}` : "Configure Area Traits",
				isHeaderBorder: true,
				hasFooter: true,
				cbClose: () => {
					if (isResolved) return;
					isResolved = true;
					resolve(null);
				},
			});
			const controls = new Map();
			const intro = _getElement("p", {
				clazz: "bqa__section-copy",
				text: "Choose all required options before applying these traits. Nothing is added until you confirm.",
			});
			eleModalInner.append(intro);
			configurable.forEach(({trait, meta}) => {
				const block = _getElement("fieldset", {clazz: "bqa__config-block"});
				block.append(_getElement("legend", {clazz: "bqa__config-title", text: trait.name}));
				if (meta.choice) {
					const select = _getElement("select", {clazz: "ve-form-control"});
					meta.choice.options.forEach(option => select.append(_getElement("option", {text: option, attrs: {value: option}})));
					block.append(_getElement("label", {clazz: "bqa__field-label", text: meta.choice.label}), select);
					controls.set(_getUid(trait), {select});
				}
				if (meta.exclusions) {
					const checkboxes = meta.exclusions.map(option => {
						const label = _getElement("label", {clazz: "bqa__check"});
						const input = _getElement("input", {attrs: {type: "checkbox"}});
						label.append(input, document.createTextNode(` Exclude: ${option}`));
						block.append(label);
						return {input, option};
					});
					controls.set(_getUid(trait), {checkboxes});
				}
				eleModalInner.append(block);
			});
			eleModalFooter.append(
				_getButton({text: "Cancel", onClick: () => finish(null)}),
				_getButton({
					text: "Apply Traits",
					clazz: "ve-btn ve-btn-primary ve-btn-sm",
					onClick: () => finish(new Map([...controls].map(([uid, control]) => [
						uid,
						{
							choice: control.select?.value,
							exclusions: control.checkboxes?.filter(({input}) => input.checked).map(({option}) => option) || [],
						},
					]))),
				}),
			);
		});
	}

	static async _pLoadLegendaryGroups () {
		if (this._cache.legendaryGroups) return this._cache.legendaryGroups;
		const [site, prerelease, brew] = await Promise.all([
			DataUtil.legendaryGroup.pLoadAll(),
			PrereleaseUtil.pGetBrewProcessed(),
			BrewUtil2.pGetBrewProcessed(),
		]);
		const seen = new Set();
		return this._cache.legendaryGroups = [...site, ...(prerelease.legendaryGroup || []), ...(brew.legendaryGroup || [])]
			.filter(it => it.lairActions?.length)
			.filter(it => {
				const uid = _getUid(it);
				if (seen.has(uid)) return false;
				seen.add(uid);
				return true;
			})
			.sort((a, b) => {
				const aFeatured = a.source === "FleeMortals" ? 0 : 1;
				const bFeatured = b.source === "FleeMortals" ? 0 : 1;
				return aFeatured - bFeatured || SortUtil.ascSortLower(a.name, b.name);
			});
	}

	static async _pRenderLairActions ({content, monster, registry}) {
		const section = this._getSection({
			heading: "Lair Actions",
			copy: "Choose one loaded legendary group. Flee, Mortals! environmental groups are shown first.",
		});
		const groups = await this._pLoadLegendaryGroups();
		if (!groups.length) {
			section.append(this._getErrorState({message: "No loaded legendary groups contain lair actions."}));
			return content.replaceChildren(section);
		}

		const search = _getElement("input", {
			clazz: "ve-form-control ve-mb-2",
			attrs: {type: "search", placeholder: "Search lair actions…", "aria-label": "Search lair actions"},
		});
		const list = _getElement("div", {clazz: "bqa__list"});
		const renderRows = () => {
			const query = search.value.trim().toLowerCase();
			const current = registry.getOverride({monster}).legendaryGroup;
			const filtered = groups.filter(it => !query || `${it.name} ${Parser.sourceJsonToFull(it.source)}`.toLowerCase().includes(query)).slice(0, 100);
			list.replaceChildren();
			filtered.forEach(group => {
				const isActive = current?.name === group.name && current?.source === group.source;
				const row = _getElement("div", {clazz: "bqa__row"});
				const main = _getElement("div", {clazz: "bqa__row-main"});
				main.append(
					this._getHoverLabel({name: group.name, entries: group.lairActions, title: `Preview ${group.name} lair actions`}),
					_getElement("div", {
						clazz: "bqa__row-meta",
						text: `${group.source === "FleeMortals" ? "Featured · " : ""}${Parser.sourceJsonToFull(group.source)} · ${group.lairActions.length} entries`,
					}),
				);
				row.append(main, _getButton({
					text: isActive ? "Remove" : "Use",
					clazz: isActive ? "ve-btn ve-btn-warning ve-btn-xs" : "ve-btn ve-btn-default ve-btn-xs",
					onClick: async () => {
						if (isActive) {
							registry.getOperations({monster})
								.filter(it => it.type === "setLegendaryGroup")
								.forEach(it => registry.removeOperation({monster, operationId: it.id}));
							return;
						}
						if (current && (current.name !== group.name || current.source !== group.source)) {
							const isSure = await InputUiUtil.pGetUserBoolean({
								title: "Replace Lair Actions",
								htmlDescription: `Replace <b>${current.name}</b> with <b>${group.name}</b>?`,
								textYes: "Replace",
								textNo: "Cancel",
							});
							if (!isSure) return;
						}
						registry.getOperations({monster})
							.filter(it => it.type === "setLegendaryGroup")
							.forEach(it => registry.removeOperation({monster, operationId: it.id}));
						registry.addOperation({
							monster,
							operation: {
								id: _getOperationId(),
								type: "setLegendaryGroup",
								legendaryGroup: _copy(group),
								sourceName: Parser.sourceJsonToFull(group.source),
								label: `Lair actions: ${group.name}`,
							},
						});
					},
				}));
				list.append(row);
			});
			if (!filtered.length) list.append(this._getErrorState({message: "No lair-action groups match this search."}));
		};
		search.addEventListener("input", renderRows);
		section.append(search, list);
		content.replaceChildren(section);
		renderRows();
	}

	static async _pLoadItems () {
		if (this._cache.items) return this._cache.items;
		const [site, prerelease, brew] = await Promise.all([
			Renderer.item.pBuildList(),
			Renderer.item.pGetItemsFromPrerelease(),
			Renderer.item.pGetItemsFromBrew(),
		]);
		const seen = new Set();
		return this._cache.items = [...site, ...prerelease, ...brew]
			.filter(it => it.rarity && it.rarity !== "none")
			.filter(it => {
				const uid = _getUid(it);
				if (seen.has(uid)) return false;
				seen.add(uid);
				return true;
			})
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
	}

	static async _pRenderMagicItem ({content, monster, registry}) {
		const section = this._getSection({
			heading: "Magic Item",
			copy: "Pick an item, review the mechanics 5etools can detect, and edit the generated statblock entries before applying.",
		});
		const items = await this._pLoadItems();
		const search = _getElement("input", {
			clazz: "ve-form-control ve-mb-2",
			attrs: {type: "search", placeholder: "Search magic items…", "aria-label": "Search magic items"},
		});
		const list = _getElement("div", {clazz: "bqa__list"});
		const renderRows = () => {
			const query = search.value.trim().toLowerCase();
			const filtered = items
				.filter(it => !query || `${it.name} ${it.rarity} ${Parser.sourceJsonToFull(it.source)}`.toLowerCase().includes(query))
				.slice(0, 100);
			list.replaceChildren();
			filtered.forEach(item => {
				const row = _getElement("div", {clazz: "bqa__row"});
				const main = _getElement("div", {clazz: "bqa__row-main"});
				main.append(
					this._getHoverLabel({name: item.name, entries: item.entries}),
					_getElement("div", {clazz: "bqa__row-meta", text: `${item.rarity.toTitleCase()} · ${Parser.sourceJsonToAbv(item.source)}`}),
				);
				row.append(main, _getButton({
					text: "Review",
					clazz: "ve-btn ve-btn-default ve-btn-xs",
					onClick: () => this._renderMagicItemPreview({content, section, monster, registry, item}),
				}));
				list.append(row);
			});
			if (!filtered.length) list.append(this._getErrorState({message: "No magic items match this search."}));
		};
		search.addEventListener("input", renderRows);
		section.append(search, list);
		content.replaceChildren(section);
		renderRows();
	}

	static _renderMagicItemPreview ({content, section, monster, registry, item}) {
		const current = registry.getOverride({monster});
		const wrp = _getElement("div", {clazz: "bqa__section"});
		const btnBack = _getButton({
			text: "← Back to items",
			clazz: "ve-btn ve-btn-default ve-btn-xs ve-mb-2",
			onClick: () => content.replaceChildren(section),
		});
		const heading = this._getHoverLabel({name: item.name, entries: item.entries});
		heading.classList.add("bqa__preview-heading");
		const detected = [];
		[
			["bonusAc", "Armor Class bonus"],
			["bonusWeapon", "Weapon attack and damage bonus"],
			["bonusWeaponAttack", "Weapon attack bonus"],
			["bonusWeaponDamage", "Weapon damage bonus"],
			["bonusSpellAttack", "Spell attack bonus"],
			["bonusSpellSaveDc", "Spell save DC bonus"],
		].forEach(([prop, label]) => {
			if (item[prop] != null) detected.push(`${label}: ${item[prop]}`);
		});
		if (item.ac != null) detected.push(`${`${item.type || ""}`.split("|")[0] === "S" ? "Shield" : "Armor"} AC: ${item.ac}`);
		if (item.ability) detected.push("Ability score change");
		if (item.modifySpeed) detected.push("Speed change");
		if (item.attachedSpells?.length) detected.push(`${item.attachedSpells.length} attached spell${item.attachedSpells.length === 1 ? "" : "s"}`);

		const detectedList = _getElement("div", {clazz: "bqa__list ve-mb-3"});
		(detected.length ? detected : ["No structured bonuses detected; descriptive abilities will still be added."])
			.forEach(text => detectedList.append(_getElement("div", {clazz: "bqa__row-meta ve-py-1", text})));

		const isConditionalDefault = BestiaryQuickActionsItemAnalyzer.isConditional(item);
		const statOptions = _getElement("div", {clazz: "bqa__item-stat-options"});
		const lblConditional = _getElement("label", {clazz: "bqa__check"});
		const iptConditional = _getElement("input", {attrs: {type: "checkbox"}});
		iptConditional.checked = isConditionalDefault;
		lblConditional.append(iptConditional, document.createTextNode(" Apply structured stat changes only while the item is active"));
		const iptConditionLabel = _getElement("input", {
			clazz: "ve-form-control",
			attrs: {type: "text", "aria-label": "Conditional statistic label"},
		});
		iptConditionLabel.value = item.name;
		statOptions.append(lblConditional, iptConditionLabel);

		const blockControls = BestiaryQuickActionsItemAnalyzer.analyze(item).map((block, ix) => {
			const card = _getElement("fieldset", {clazz: "bqa__item-card"});
			const legend = _getElement("legend", {clazz: "bqa__item-card-title"});
			const enabled = _getElement("input", {attrs: {type: "checkbox", "aria-label": `Include ${block.name}`}});
			enabled.checked = true;
			legend.append(enabled, document.createTextNode(` Ability ${ix + 1}`));
			card.append(legend);
			const cardGrid = _getElement("div", {clazz: "bqa__grid"});
			const name = this._getLabeledInput({grid: cardGrid, label: "Entry name", value: block.name});
			const destination = this._getLabeledSelect({
				grid: cardGrid,
				label: "Destination",
				values: [
					{value: "trait", label: "Trait"},
					{value: "action", label: "Action"},
					{value: "bonus", label: "Bonus Action"},
					{value: "reaction", label: "Reaction"},
				],
				value: block.destination,
			});
			const entries = this._getLabeledTextarea({
				grid: cardGrid,
				label: "Entries JSON",
				value: JSON.stringify(block.entries, null, 2),
			});
			card.append(cardGrid);
			return {card, enabled, name, destination, entries};
		});

		const grid = _getElement("div", {clazz: "bqa__grid"});
		const isWeapon = !!item.dmg1;
		let selAbility = null;
		let iptAttackName = null;
		if (isWeapon) {
			selAbility = this._getLabeledSelect({
				grid,
				label: "Attack ability",
				values: _PROPS_ABILITY.map(ab => ({value: ab, label: `${Parser.attAbvToFull(ab)} (${current[ab] || 10})`})),
				value: item.property?.includes("F") && _getAbilityMod(current.dex) > _getAbilityMod(current.str) ? "dex" : "str",
			});
			iptAttackName = this._getLabeledInput({grid, label: "Generated attack name", value: item.name});
		}

		const btnApply = _getButton({
			text: "Apply Item",
			clazz: "ve-btn ve-btn-primary ve-btn-sm",
			onClick: () => {
				let entries;
				try {
					entries = blockControls
						.filter(({enabled}) => enabled.checked)
						.map(({name, destination, entries}) => ({
							section: destination.value,
							entry: {
								name: name.value.trim() || item.name,
								entries: JSON.parse(entries.value),
							},
						}));
				} catch (e) {
					JqueryUtil.doToast({type: "danger", content: `Item ability entries must be valid JSON: ${e.message}`});
					return;
				}
				if (isWeapon) {
					entries.push({
						section: "action",
						entry: this._getItemAttack({monster: current, item, ability: selAbility.value, name: iptAttackName.value.trim() || item.name}),
					});
				}
				registry.addOperation({
					monster,
					operation: {
						id: _getOperationId(),
						type: "applyItem",
						data: {
							item: {name: item.name, source: item.source},
							patch: {},
							effects: this._getItemEffects({
								item,
								isConditional: iptConditional.checked,
								conditionLabel: iptConditionLabel.value.trim() || item.name,
							}),
							entries,
						},
						sourceUid: _getUid(item),
						sourceName: `${item.name} (${Parser.sourceJsonToAbv(item.source)})`,
						label: `Magic item: ${item.name}`,
					},
				});
				JqueryUtil.doToast({type: "success", content: `${item.name} applied as a temporary override.`});
			},
		});

		wrp.append(btnBack, heading, _getElement("p", {
			clazz: "bqa__section-copy",
			text: "Only structured fields listed below are changed mechanically. Other rules remain visible as editable statblock text.",
		}), detectedList, statOptions, ...blockControls.map(it => it.card), grid, _getElement("div", {clazz: "ve-flex-h-right ve-mt-3"}));
		wrp.lastElementChild.append(btnApply);
		content.replaceChildren(wrp);
	}

	static _getItemPatch ({monster, item, isConditional = false, conditionLabel = null}) {
		const patch = {};
		const acBonus = item.bonusAc != null
			? _getNumber(item.bonusAc)
			: `${item.type || ""}`.split("|")[0] === "S"
				? _getNumber(item.ac)
				: 0;
		if (acBonus) {
			const ac = _copy(monster.ac || []);
			const baseAc = typeof ac[0] === "number" ? ac[0] : _getNumber(ac[0]?.ac);
			if (isConditional) {
				ac.push({
					ac: baseAc + acBonus,
					condition: `while using {@item ${item.name}|${item.source}|${conditionLabel || item.name}}`,
				});
			} else if (typeof ac[0] === "number") ac[0] += acBonus;
			else ac[0] = {...ac[0], ac: baseAc + acBonus};
			patch.ac = ac;
		} else if (!isConditional && item.ac != null && ["LA", "MA", "HA"].includes(`${item.type || ""}`.split("|")[0])) {
			const ac = _copy(monster.ac || []);
			if (typeof ac[0] === "number") ac[0] = _getNumber(item.ac);
			else ac[0] = {...ac[0], ac: _getNumber(item.ac)};
			patch.ac = ac;
		}
		if (!isConditional) {
			if (item.ability?.static) Object.assign(patch, item.ability.static);
			_PROPS_ABILITY.forEach(ab => {
				if (item.ability?.[ab] != null) patch[ab] = _getNumber(monster[ab]) + _getNumber(item.ability[ab]);
			});
		}
		if (item.modifySpeed) {
			const speed = _copy(monster.speed || {});
			const getSpeedNumber = value => typeof value === "number" ? value : _getNumber(value?.number ?? value);
			const modes = Object.keys(speed).filter(key => !["alternate", "canHover"].includes(key));
			const expandModes = mode => mode === "*" ? modes : [mode];
			const applySpeed = (mode, value) => {
				if (!isConditional) {
					speed[mode] = value;
					return;
				}
				speed.alternate ||= {};
				speed.alternate[mode] ||= [];
				speed.alternate[mode].push({number: value, condition: `while using {@item ${item.name}|${item.source}|${conditionLabel || item.name}}`});
			};
			Object.entries(item.modifySpeed.static || {}).forEach(([mode, value]) => expandModes(mode).forEach(it => applySpeed(it, value)));
			Object.entries(item.modifySpeed.bonus || {}).forEach(([mode, value]) => expandModes(mode).forEach(it => applySpeed(it, getSpeedNumber(speed[it]) + _getNumber(value))));
			Object.entries(item.modifySpeed.multiply || {}).forEach(([mode, value]) => expandModes(mode).forEach(it => applySpeed(it, getSpeedNumber(speed[it]) * _getNumber(value))));
			Object.entries(item.modifySpeed.equal || {}).forEach(([mode, sourceMode]) => expandModes(mode).forEach(it => applySpeed(it, getSpeedNumber(speed[sourceMode]))));
			patch.speed = speed;
		}
		return patch;
	}

	static _getItemEffects ({item, isConditional, conditionLabel}) {
		return {
			isConditional,
			conditionLabel,
			itemType: item.type,
			ac: item.ac,
			bonusAc: item.bonusAc,
			abilityStatic: _copy(item.ability?.static),
			abilityBonus: Object.fromEntries(_PROPS_ABILITY
				.filter(ability => item.ability?.[ability] != null)
				.map(ability => [ability, item.ability[ability]])),
			modifySpeed: _copy(item.modifySpeed),
		};
	}

	static _getItemAttack ({monster, item, ability, name}) {
		const abilityMod = _getAbilityMod(monster[ability]);
		const weaponBonus = _getNumber(item.bonusWeapon);
		const attackBonus = Parser.crToPb(monster.cr) + abilityMod + weaponBonus + _getNumber(item.bonusWeaponAttack);
		const damageBonus = abilityMod + weaponBonus + _getNumber(item.bonusWeaponDamage);
		const damageExpression = `${item.dmg1}${damageBonus ? `${damageBonus > 0 ? " + " : " - "}${Math.abs(damageBonus)}` : ""}`;
		const damageAverage = _getDamageAverage({dice: item.dmg1, bonus: damageBonus});
		const isRanged = item.type === "R";
		const isThrown = !isRanged && (item.property || []).includes("T");
		const rangeShort = `${item.range || (isRanged ? 80 : 20)}`;
		const rangeFull = rangeShort.includes("/")
			? rangeShort
			: `${rangeShort}/${item.longRange || (isRanged ? 320 : 60)}`;
		const attackType = isRanged ? "rw" : isThrown ? "mw,rw" : "mw";
		const range = isRanged
			? `range ${rangeFull} ft.`
			: isThrown
				? `reach 5 ft. or range ${rangeFull} ft.`
				: "reach 5 ft.";
		const damageType = _DAMAGE_TYPE_TO_FULL[item.dmgType] || `${item.dmgType || "weapon"}`.toLowerCase();
		return {
			name,
			entries: [`{@atk ${attackType}} {@hit ${attackBonus}} to hit, ${range}, one target. {@h} ${damageAverage == null ? "" : `${damageAverage} (`}{@damage ${damageExpression}}${damageAverage == null ? "" : ")"} ${damageType} damage.`],
		};
	}

	static async _pRenderQuickEdit ({content, monster, registry}) {
		const current = registry.getOverride({monster});
		const section = this._getSection({
			heading: "Quick Edit",
			copy: "Change core combat values, then use guided cards for complex sections or switch to Advanced JSON for full control.",
		});
		const grid = _getElement("div", {clazz: "bqa__grid"});
		const fields = {};

		const acFirst = current.ac?.[0];
		fields.ac = this._getLabeledInput({grid, label: "Armor Class", value: typeof acFirst === "number" ? acFirst : acFirst?.ac ?? ""});
		fields.hpAverage = this._getLabeledInput({grid, label: "Hit Points", value: current.hp?.average ?? current.hp?.special ?? ""});
		fields.hpFormula = this._getLabeledInput({grid, label: "Hit Dice formula", value: current.hp?.formula || ""});
		fields.walk = this._getLabeledInput({grid, label: "Walk speed", value: typeof current.speed?.walk === "number" ? current.speed.walk : current.speed?.walk?.number ?? "", type: "number"});
		fields.fly = this._getLabeledInput({grid, label: "Fly speed", value: typeof current.speed?.fly === "number" ? current.speed.fly : current.speed?.fly?.number ?? "", type: "number"});
		fields.cr = this._getLabeledInput({grid, label: "Challenge Rating", value: current.cr?.cr || current.cr || ""});
		_PROPS_ABILITY.forEach(ab => fields[ab] = this._getLabeledInput({grid, label: Parser.attAbvToFull(ab), value: current[ab] ?? 10, type: "number"}));
		fields.save = this._getLabeledInput({grid, label: "Saving throws", value: this._getKeyValueText(current.save), placeholder: "dex:+5, wis:+3"});
		fields.skill = this._getLabeledInput({grid, label: "Skills", value: this._getKeyValueText(current.skill), placeholder: "perception:+5, stealth:+6"});
		fields.vulnerable = this._getLabeledInput({grid, label: "Damage vulnerabilities", value: this._getArrayText(current.vulnerable)});
		fields.resist = this._getLabeledInput({grid, label: "Damage resistances", value: this._getArrayText(current.resist)});
		fields.immune = this._getLabeledInput({grid, label: "Damage immunities", value: this._getArrayText(current.immune)});
		fields.conditionImmune = this._getLabeledInput({grid, label: "Condition immunities", value: this._getArrayText(current.conditionImmune)});
		fields.senses = this._getLabeledInput({grid, label: "Senses", value: this._getArrayText(current.senses)});
		fields.passive = this._getLabeledInput({grid, label: "Passive Perception", value: current.passive ?? "", type: "number"});
		fields.languages = this._getLabeledInput({grid, label: "Languages", value: this._getArrayText(current.languages)});

		const error = _getElement("div", {clazz: "bqa__error", attrs: {role: "alert"}});
		const complex = this._getComplexEditor({current});
		const btnApply = _getButton({
			text: "Apply Quick Edit",
			clazz: "ve-btn ve-btn-primary ve-btn-sm",
			onClick: () => {
				error.textContent = "";
				try {
					const patch = this._getQuickEditPatch({current, fields, complexValues: complex.getValues()});
					if (!Object.keys(patch.set).length && !patch.remove.length) throw new Error("Change at least one field before applying.");
					registry.addOperation({
						monster,
						operation: {
							id: _getOperationId(),
							type: "patch",
							patch,
							sourceName: "Core stats and entries",
							label: "Quick edit",
						},
					});
					JqueryUtil.doToast({type: "success", content: "Quick Edit applied as a temporary override."});
				} catch (e) {
					error.textContent = e.message;
				}
			},
		});
		const footer = _getElement("div", {clazz: "ve-flex-col ve-flex-ai-end ve-mt-3"});
		footer.append(error, btnApply);
		section.append(grid, complex.ele, footer);
		content.replaceChildren(section);
	}

	static _getComplexEditor ({current}) {
		const state = {
			entries: Object.fromEntries(_PROPS_ENTRY.map(prop => [prop, _copy(current[prop] || [])])),
			meta: {
				legendaryActions: current.legendaryActions,
				legendaryActionsLair: current.legendaryActionsLair,
				isNamedCreature: !!current.isNamedCreature,
				legendaryHeader: _copy(current.legendaryHeader || []),
				mythicHeader: _copy(current.mythicHeader || []),
			},
		};
		const ele = _getElement("section", {clazz: "bqa__complex"});
		const heading = _getElement("div", {clazz: "bqa__complex-heading"});
		const headingText = _getElement("div");
		headingText.append(
			_getElement("h5", {text: "Statblock sections"}),
			_getElement("p", {text: "Guided mode covers common structures. Advanced JSON preserves every supported 5etools entry shape."}),
		);
		const modeSwitch = _getElement("div", {clazz: "bqa__mode-switch", attrs: {role: "tablist", "aria-label": "Complex editor mode"}});
		const btnGuided = _getButton({text: "Guided", clazz: "bqa__mode-btn", onClick: () => setMode("guided")});
		const btnAdvanced = _getButton({text: "Advanced JSON", clazz: "bqa__mode-btn", onClick: () => setMode("advanced")});
		btnGuided.setAttribute("role", "tab");
		btnAdvanced.setAttribute("role", "tab");
		modeSwitch.append(btnGuided, btnAdvanced);
		heading.append(headingText, modeSwitch);

		const wrpGuided = _getElement("div", {clazz: "bqa__guided"});
		const wrpAdvanced = _getElement("div", {clazz: "bqa__advanced"});
		const advancedGrid = _getElement("div", {clazz: "bqa__grid"});
		const advancedFields = Object.fromEntries(_PROPS_ENTRY.map(prop => [
			prop,
			this._getLabeledTextarea({
				grid: advancedGrid,
				label: `${prop.toTitleCase()} entries`,
				value: JSON.stringify(state.entries[prop], null, 2),
			}),
		]));
		const advancedError = _getElement("div", {clazz: "bqa__error", attrs: {role: "alert"}});
		wrpAdvanced.append(
			_getElement("p", {clazz: "bqa__advanced-note", text: "Use valid JSON arrays. Switching back to Guided mode is blocked until every array parses successfully."}),
			advancedGrid,
			advancedError,
		);
		ele.append(heading, wrpGuided, wrpAdvanced);

		let mode = "guided";
		const syncAdvanced = () => _PROPS_ENTRY.forEach(prop => advancedFields[prop].value = JSON.stringify(state.entries[prop], null, 2));
		const parseAdvanced = () => {
			const parsed = BestiaryQuickActionsStructuredEditor.parseEntryArrays(Object.fromEntries(_PROPS_ENTRY.map(prop => [prop, advancedFields[prop].value])));
			_PROPS_ENTRY.forEach(prop => state.entries[prop] = parsed[prop]);
		};
		const renderGuided = () => {
			wrpGuided.replaceChildren();
			this._renderSpellcastingEditor({parent: wrpGuided, state, rerender: renderGuided});
			this._renderActionEditor({parent: wrpGuided, state, prop: "legendary", title: "Legendary Actions", rerender: renderGuided});
			this._renderActionEditor({parent: wrpGuided, state, prop: "mythic", title: "Mythic Actions", rerender: renderGuided});
		};
		const setMode = nxtMode => {
			advancedError.textContent = "";
			if (mode === "advanced" && nxtMode === "guided") {
				try {
					parseAdvanced();
				} catch (e) {
					advancedError.textContent = e.message;
					return;
				}
				renderGuided();
			}
			if (nxtMode === "advanced") syncAdvanced();
			mode = nxtMode;
			btnGuided.setAttribute("aria-selected", mode === "guided" ? "true" : "false");
			btnAdvanced.setAttribute("aria-selected", mode === "advanced" ? "true" : "false");
			wrpGuided.hidden = mode !== "guided";
			wrpAdvanced.hidden = mode !== "advanced";
		};

		renderGuided();
		setMode("guided");
		return {
			ele,
			getValues: () => {
				if (mode === "advanced") parseAdvanced();
				const invalidControl = ele.querySelector(":invalid");
				if (invalidControl) throw new Error(invalidControl.validationMessage || "Correct the invalid complex-section field before applying.");
				state.entries.spellcasting.forEach(trait => BestiaryQuickActionsStructuredEditor.validateSpellRows({
					traitName: trait.name,
					rows: BestiaryQuickActionsStructuredEditor.getSpellRows(trait),
				}));
				["legendary", "mythic"].forEach(prop => state.entries[prop].forEach(entry => {
					if (!`${entry.name || ""}`.trim()) throw new Error(`Each ${prop} action needs a name.`);
					if (!Array.isArray(entry.entries)) throw new Error(`${entry.name} entries must be an array.`);
				}));
				return {..._copy(state.entries), ..._copy(state.meta)};
			},
		};
	}

	static _renderSpellcastingEditor ({parent, state, rerender}) {
		const section = _getElement("section", {clazz: "bqa__guided-section"});
		const header = _getElement("div", {clazz: "bqa__guided-header"});
		const heading = _getElement("div");
		heading.append(
			_getElement("h6", {text: "Spellcasting"}),
			_getElement("p", {text: "Build casting traits from headers, frequencies, spell levels, and rendered spell tags."}),
		);
		header.append(heading, _getButton({
			text: "Add Spellcasting Trait",
			onClick: () => {
				state.entries.spellcasting.push({name: "Spellcasting", will: []});
				rerender();
			},
		}));
		section.append(header);
		if (!state.entries.spellcasting.length) section.append(_getElement("div", {clazz: "bqa__empty bqa__empty--compact", text: "No spellcasting traits. Add one or use Advanced JSON."}));
		state.entries.spellcasting.forEach((trait, ix) => section.append(this._getSpellcastingCard({state, trait, ix, rerender})));
		parent.append(section);
	}

	static _getSpellcastingCard ({state, trait, ix, rerender}) {
		const card = _getElement("details", {clazz: "bqa__guided-card", attrs: {open: ""}});
		const summary = _getElement("summary", {text: trait.name || `Spellcasting Trait ${ix + 1}`});
		const body = _getElement("div", {clazz: "bqa__guided-card-body"});
		const controls = _getElement("div", {clazz: "bqa__card-controls"});
		const move = delta => {
			const [moved] = state.entries.spellcasting.splice(ix, 1);
			state.entries.spellcasting.splice(ix + delta, 0, moved);
			rerender();
		};
		const btnUp = _getButton({text: "Move Up", clazz: "ve-btn ve-btn-default ve-btn-xs", onClick: () => move(-1)});
		const btnDown = _getButton({text: "Move Down", clazz: "ve-btn ve-btn-default ve-btn-xs", onClick: () => move(1)});
		btnUp.disabled = ix === 0;
		btnDown.disabled = ix === state.entries.spellcasting.length - 1;
		controls.append(btnUp, btnDown, _getButton({
			text: "Remove",
			clazz: "ve-btn ve-btn-danger ve-btn-xs",
			onClick: () => {
				state.entries.spellcasting.splice(ix, 1);
				rerender();
			},
		}));

		const metaGrid = _getElement("div", {clazz: "bqa__guided-meta"});
		const name = this._getLabeledInput({grid: metaGrid, label: "Trait name", value: trait.name || ""});
		const displayAs = this._getLabeledSelect({
			grid: metaGrid,
			label: "Display under",
			values: (Renderer.monster.CHILD_PROPS__SPELLCASTING_DISPLAY_AS || ["trait", "action", "bonus", "reaction"]).map(value => ({value, label: value.toTitleCase()})),
			value: trait.displayAs || "trait",
		});
		const ability = this._getLabeledSelect({
			grid: metaGrid,
			label: "Casting ability",
			values: [{value: "", label: "Infer from text"}, ..._PROPS_ABILITY.map(value => ({value, label: Parser.attAbvToFull(value)}))],
			value: trait.ability || "",
		});
		const headerEntries = this._getLabeledTextarea({grid: metaGrid, label: "Header entries", value: UiUtil.getEntriesAsText(trait.headerEntries)});
		const footerEntries = this._getLabeledTextarea({grid: metaGrid, label: "Footer entries", value: UiUtil.getEntriesAsText(trait.footerEntries)});

		const rows = BestiaryQuickActionsStructuredEditor.getSpellRows(trait);
		const rowsWrp = _getElement("div", {clazz: "bqa__spell-rows"});
		const rowError = _getElement("div", {clazz: "bqa__error", attrs: {role: "alert"}});
		const rowControls = [];
		const readRows = () => {
			rowControls.forEach(({row, type, key, level, slots, lower, spells}) => {
				row.type = type.value;
				row.key = key?.value.trim();
				row.level = level?.value;
				row.slots = slots?.value;
				row.lower = lower?.value;
				row.spells = UiUtil.getTextAsEntries(spells.value);
			});
		};
		const applyRows = () => {
			state.entries.spellcasting[ix] = BestiaryQuickActionsStructuredEditor.applySpellRows({trait: state.entries.spellcasting[ix], rows});
		};
		const commitRows = () => {
			readRows();
			try {
				BestiaryQuickActionsStructuredEditor.validateSpellRows({traitName: name.value, rows});
				rowError.textContent = "";
				applyRows();
				return true;
			} catch (e) {
				rowError.textContent = e.message;
				return false;
			}
		};
		rows.forEach((row, rowIx) => {
			const wrp = _getElement("div", {clazz: "bqa__spell-row"});
			const type = _getElement("select", {clazz: "ve-form-control"});
			BestiaryQuickActionsStructuredEditor.SPELL_ROW_TYPES.forEach(meta => {
				const option = _getElement("option", {text: meta.label, attrs: {value: meta.value}});
				if (meta.value === row.type) option.selected = true;
				type.append(option);
			});
			let key = null;
			let level = null;
			let slots = null;
			let lower = null;
			if (!["will", "constant", "ritual", "spells"].includes(row.type)) key = _getElement("input", {clazz: "ve-form-control", attrs: {value: row.key || "1", "aria-label": "Use count", placeholder: "1 or 1e"}});
			if (row.type === "spells") {
				level = _getElement("input", {clazz: "ve-form-control", attrs: {type: "number", min: "0", max: "9", value: row.level ?? 0, "aria-label": "Spell level"}});
				slots = _getElement("input", {clazz: "ve-form-control", attrs: {type: "number", min: "0", value: row.slots ?? "", placeholder: "Slots", "aria-label": "Spell slots"}});
				lower = _getElement("input", {clazz: "ve-form-control", attrs: {type: "number", min: "0", max: "9", value: row.lower ?? "", placeholder: "Lower", "aria-label": "Lower spell level"}});
			}
			const spells = _getElement("textarea", {clazz: "ve-form-control bqa__spell-list", attrs: {placeholder: "{@spell fire bolt}\\n{@spell shield}"}});
			spells.value = UiUtil.getEntriesAsText(row.spells);
			const btns = _getElement("div", {clazz: "bqa__spell-row-actions"});
			const move = delta => {
				if (!commitRows()) return;
				const [moved] = rows.splice(rowIx, 1);
				rows.splice(rowIx + delta, 0, moved);
				applyRows();
				rerender();
			};
			const btnUp = _getButton({text: "↑", clazz: "ve-btn ve-btn-default ve-btn-xs", title: "Move spell row up", onClick: () => move(-1)});
			const btnDown = _getButton({text: "↓", clazz: "ve-btn ve-btn-default ve-btn-xs", title: "Move spell row down", onClick: () => move(1)});
			btnUp.disabled = rowIx === 0;
			btnDown.disabled = rowIx === rows.length - 1;
			btns.append(btnUp, btnDown, _getButton({
				text: "Remove",
				clazz: "ve-btn ve-btn-danger ve-btn-xs",
				onClick: () => {
					readRows();
					rows.splice(rowIx, 1);
					applyRows();
					rerender();
				},
			}));
			const top = _getElement("div", {clazz: "bqa__spell-row-meta"});
			top.append(type);
			if (key) top.append(key);
			if (level) top.append(level, slots, lower);
			wrp.append(top, spells, btns);
			rowsWrp.append(wrp);
			rowControls.push({row, type, key, level, slots, lower, spells});
			[type, key, level, slots, lower, spells].filter(Boolean).forEach(ele => ele.addEventListener("change", () => {
				if (!commitRows()) return;
				if (ele === type) return rerender();
				updatePreview();
			}));
		});

		const preview = _getElement("div", {clazz: "bqa__render-preview"});
		const updatePreview = () => this._renderSpellcastingPreview({preview, trait: state.entries.spellcasting[ix]});
		const commitMeta = () => {
			const nxt = state.entries.spellcasting[ix];
			nxt.name = name.value.trim();
			if (displayAs.value === "trait") delete nxt.displayAs;
			else nxt.displayAs = displayAs.value;
			if (ability.value) nxt.ability = ability.value;
			else delete nxt.ability;
			const nxtHeader = UiUtil.getTextAsEntries(headerEntries.value);
			const nxtFooter = UiUtil.getTextAsEntries(footerEntries.value);
			if (nxtHeader.length) nxt.headerEntries = nxtHeader;
			else delete nxt.headerEntries;
			if (nxtFooter.length) nxt.footerEntries = nxtFooter;
			else delete nxt.footerEntries;
			summary.textContent = nxt.name || `Spellcasting Trait ${ix + 1}`;
			updatePreview();
		};
		name.addEventListener("input", () => {
			state.entries.spellcasting[ix].name = name.value;
			summary.textContent = name.value || `Spellcasting Trait ${ix + 1}`;
		});
		[displayAs, ability, headerEntries, footerEntries].forEach(ele => ele.addEventListener("change", commitMeta));
		body.append(
			controls,
			metaGrid,
			_getElement("div", {clazz: "bqa__subheading", text: "Spell groups"}),
			rowsWrp,
			rowError,
			_getButton({
				text: "Add Spell Group",
				onClick: () => {
					if (rows.length && !commitRows()) return;
					const directType = ["will", "constant", "ritual"].find(type => !rows.some(row => row.type === type));
					if (directType) rows.push({type: directType, spells: []});
					else {
						const usedKeys = new Set(rows.filter(row => row.type === "daily").map(row => `${row.key}`));
						let count = 1;
						while (usedKeys.has(`${count}`)) count++;
						rows.push({type: "daily", key: `${count}`, spells: []});
					}
					applyRows();
					rerender();
				},
			}),
			_getElement("div", {clazz: "bqa__subheading", text: "Rendered preview"}),
			preview,
		);
		card.append(summary, body);
		updatePreview();
		return card;
	}

	static _renderSpellcastingPreview ({preview, trait}) {
		try {
			const displayAsProp = trait.displayAs || "trait";
			const rendered = Renderer.monster.getSpellcastingRenderedTraits(Renderer.get(), {spellcasting: [_copy(trait)]}, {displayAsProp})[0]?.rendered;
			preview.innerHTML = rendered || `<span class="ve-muted">Add a header or spell group to preview this trait.</span>`;
		} catch (e) {
			preview.textContent = `Preview unavailable: ${e.message}`;
		}
	}

	static _renderActionEditor ({parent, state, prop, title, rerender}) {
		const isLegendary = prop === "legendary";
		const section = _getElement("section", {clazz: "bqa__guided-section"});
		const header = _getElement("div", {clazz: "bqa__guided-header"});
		const heading = _getElement("div");
		heading.append(
			_getElement("h6", {text: title}),
			_getElement("p", {text: isLegendary ? "Set action economy, introduction text, costs, and ordered actions." : "Set mythic introduction text and ordered actions."}),
		);
		header.append(heading, _getButton({
			text: `Add ${isLegendary ? "Legendary" : "Mythic"} Action`,
			onClick: () => {
				state.entries[prop].push({name: "New Action", entries: ["Describe the action."]});
				rerender();
			},
		}));
		section.append(header);

		const metaGrid = _getElement("div", {clazz: "bqa__guided-meta"});
		if (isLegendary) {
			const count = this._getLabeledInput({grid: metaGrid, label: "Actions per round", value: state.meta.legendaryActions ?? "", type: "number", placeholder: "Default: 3"});
			const lairCount = this._getLabeledInput({grid: metaGrid, label: "Actions in lair", value: state.meta.legendaryActionsLair ?? "", type: "number", placeholder: "Default: 3"});
			const namedWrp = _getElement("label", {clazz: "bqa__check bqa__field--wide"});
			const named = _getElement("input", {attrs: {type: "checkbox"}});
			named.checked = state.meta.isNamedCreature;
			namedWrp.append(named, document.createTextNode(" Treat the creature's name as a proper noun in generated introduction text"));
			metaGrid.append(namedWrp);
			count.addEventListener("input", () => state.meta.legendaryActions = count.value.trim() ? Number(count.value) : undefined);
			lairCount.addEventListener("input", () => state.meta.legendaryActionsLair = lairCount.value.trim() ? Number(lairCount.value) : undefined);
			named.addEventListener("change", () => state.meta.isNamedCreature = named.checked);
		}
		const headerProp = isLegendary ? "legendaryHeader" : "mythicHeader";
		const intro = this._getLabeledTextarea({grid: metaGrid, label: `${title} introduction`, value: UiUtil.getEntriesAsText(state.meta[headerProp])});
		intro.addEventListener("change", () => {
			state.meta[headerProp] = UiUtil.getTextAsEntries(intro.value);
			updateSectionPreview();
		});
		section.append(metaGrid);

		const list = _getElement("div", {clazz: "bqa__action-cards"});
		state.entries[prop].forEach((entry, ix) => list.append(this._getActionCard({state, prop, entry, ix, rerender, onChange: () => updateSectionPreview()})));
		if (!state.entries[prop].length) list.append(_getElement("div", {clazz: "bqa__empty bqa__empty--compact", text: `No ${title.toLowerCase()}. Add one or use Advanced JSON.`}));
		const preview = _getElement("div", {clazz: "bqa__render-preview"});
		const updateSectionPreview = () => {
			try {
				const entries = [
					...(state.meta[headerProp] || []),
					...state.entries[prop].map(entry => ({type: "entries", name: entry.name, entries: entry.entries || []})),
				];
				preview.innerHTML = entries.length ? Renderer.get().render({type: "entries", entries}) : `<span class="ve-muted">Nothing to preview yet.</span>`;
			} catch (e) {
				preview.textContent = `Preview unavailable: ${e.message}`;
			}
		};
		section.append(list, _getElement("div", {clazz: "bqa__subheading", text: "Rendered preview"}), preview);
		parent.append(section);
		updateSectionPreview();
	}

	static _getActionCard ({state, prop, entry, ix, rerender, onChange}) {
		const isLegendary = prop === "legendary";
		const card = _getElement("details", {clazz: "bqa__guided-card", attrs: {open: ""}});
		const summary = _getElement("summary", {text: entry.name || `Action ${ix + 1}`});
		const body = _getElement("div", {clazz: "bqa__guided-card-body"});
		const controls = _getElement("div", {clazz: "bqa__card-controls"});
		const move = delta => {
			const [moved] = state.entries[prop].splice(ix, 1);
			state.entries[prop].splice(ix + delta, 0, moved);
			rerender();
		};
		const btnUp = _getButton({text: "Move Up", clazz: "ve-btn ve-btn-default ve-btn-xs", onClick: () => move(-1)});
		const btnDown = _getButton({text: "Move Down", clazz: "ve-btn ve-btn-default ve-btn-xs", onClick: () => move(1)});
		btnUp.disabled = ix === 0;
		btnDown.disabled = ix === state.entries[prop].length - 1;
		controls.append(btnUp, btnDown, _getButton({
			text: "Remove",
			clazz: "ve-btn ve-btn-danger ve-btn-xs",
			onClick: () => {
				state.entries[prop].splice(ix, 1);
				rerender();
			},
		}));

		const grid = _getElement("div", {clazz: "bqa__guided-meta"});
		const name = this._getLabeledInput({
			grid,
			label: "Action name",
			value: isLegendary ? BestiaryQuickActionsStructuredEditor.getLegendaryActionBaseName(entry.name) : entry.name || "",
		});
		const cost = isLegendary
			? this._getLabeledInput({grid, label: "Action cost", value: BestiaryQuickActionsStructuredEditor.getLegendaryActionCost(entry.name), type: "number"})
			: null;
		if (cost) {
			cost.min = "1";
			cost.step = "1";
			cost.required = true;
		}
		const entries = this._getLabeledTextarea({grid, label: "Action entries", value: UiUtil.getEntriesAsText(entry.entries)});
		const commit = () => {
			if (cost && !cost.checkValidity()) return;
			const nxt = state.entries[prop][ix];
			nxt.name = isLegendary
				? BestiaryQuickActionsStructuredEditor.getLegendaryActionName({name: name.value, cost: cost.value})
				: name.value.trim();
			nxt.entries = UiUtil.getTextAsEntries(entries.value);
			summary.textContent = nxt.name || `Action ${ix + 1}`;
			onChange();
		};
		name.addEventListener("input", () => {
			if (cost && !cost.checkValidity()) {
				summary.textContent = name.value || `Action ${ix + 1}`;
				return;
			}
			const nxtName = isLegendary
				? BestiaryQuickActionsStructuredEditor.getLegendaryActionName({name: name.value, cost: cost.value})
				: name.value;
			state.entries[prop][ix].name = nxtName;
			summary.textContent = nxtName || `Action ${ix + 1}`;
		});
		if (cost) cost.addEventListener("change", commit);
		entries.addEventListener("change", commit);
		body.append(controls, grid);
		card.append(summary, body);
		return card;
	}

	static _getQuickEditPatch ({current, fields, complexValues}) {
		const patch = {set: {}, remove: []};
		const numberFields = ["ac", "walk", "fly", "str", "dex", "con", "int", "wis", "cha", "passive"];
		numberFields.forEach(key => {
			const raw = fields[key].value.trim();
			if (!raw) return;
			const value = Number(raw);
			if (!Number.isFinite(value)) throw new Error(`${fields[key].dataset.label} must be a number.`);
		});
		["hpAverage", ..._PROPS_ABILITY].forEach(key => {
			if (!fields[key].value.trim()) throw new Error(`${fields[key].dataset.label} is required.`);
		});

		const first = current.ac?.[0];
		const currentAc = typeof first === "number" ? first : first?.ac;
		const acRaw = fields.ac.value.trim();
		if (!acRaw && currentAc != null) throw new Error("Armor Class is required.");
		if (acRaw) {
			const acValue = Number(acRaw);
			const ac = [
				typeof first === "object" && first.ac != null ? {..._copy(first), ac: acValue} : acValue,
				..._copy(current.ac?.slice(1) || []),
			];
			if (!_isEqual(ac, current.ac)) patch.set.ac = ac;
		}

		const hpRaw = fields.hpAverage.value.trim();
		const hpAverage = Number(hpRaw);
		const hpFormula = fields.hpFormula.value.trim();
		if (hpFormula && !Number.isFinite(hpAverage)) throw new Error("Hit Points must be a number when a Hit Dice formula is present.");
		const isHpChanged = hpRaw !== `${current.hp?.average ?? current.hp?.special ?? ""}` || hpFormula !== `${current.hp?.formula || ""}`;
		if (isHpChanged) {
			const hp = hpFormula
				? {average: hpAverage, formula: hpFormula}
				: Number.isFinite(hpAverage)
					? {special: `${hpAverage}`}
					: {special: hpRaw};
			if (!_isEqual(hp, current.hp)) patch.set.hp = hp;
		}

		const speed = _copy(current.speed || {});
		["walk", "fly"].forEach(prop => {
			const raw = fields[prop].value.trim();
			const currentValue = current.speed?.[prop];
			const currentNumber = typeof currentValue === "number" ? currentValue : currentValue?.number;
			if (`${currentNumber ?? ""}` === raw) return;
			if (!raw) return delete speed[prop];
			speed[prop] = typeof currentValue === "object"
				? {..._copy(currentValue), number: Number(raw)}
				: Number(raw);
		});
		if (!_isEqual(speed, current.speed || {})) patch.set.speed = speed;

		_PROPS_ABILITY.forEach(ab => {
			const value = Number(fields[ab].value);
			if (value !== current[ab]) patch.set[ab] = value;
		});

		const save = this._getKeyValueObject(fields.save.value, "saving throws");
		if (!_isEqual(save, current.save || {})) patch.set.save = save;
		const skill = this._getKeyValueObject(fields.skill.value, "skills");
		if (!_isEqual(skill, current.skill || {})) patch.set.skill = skill;
		["vulnerable", "resist", "immune", "conditionImmune", "senses", "languages"].forEach(prop => {
			const value = this._getArrayValue(fields[prop].value, fields[prop].dataset.label);
			if (!_isEqual(value, current[prop] || [])) patch.set[prop] = value;
		});
		if (fields.passive.value.trim()) {
			const passive = Number(fields.passive.value);
			if (passive !== current.passive) patch.set.passive = passive;
		} else if (current.passive != null) patch.remove.push("passive");

		const cr = fields.cr.value.trim();
		if (!cr && current.cr != null) throw new Error("Challenge Rating is required.");
		if (cr) {
			const nxtCr = typeof current.cr === "object" ? {..._copy(current.cr), cr} : cr;
			if (!_isEqual(nxtCr, current.cr)) patch.set.cr = nxtCr;
		}

		_PROPS_ENTRY.forEach(prop => {
			if (!_isEqual(complexValues[prop], current[prop] || [])) patch.set[prop] = complexValues[prop];
		});
		["legendaryActions", "legendaryActionsLair"].forEach(prop => {
			const value = complexValues[prop];
			if (value != null && value !== "") {
				if (!Number.isInteger(value) || value < 1) throw new Error(`${prop === "legendaryActions" ? "Legendary actions" : "Lair legendary actions"} must be a positive whole number.`);
				if (value !== current[prop]) patch.set[prop] = value;
			} else if (current[prop] != null) patch.remove.push(prop);
		});
		if (complexValues.isNamedCreature) {
			if (!current.isNamedCreature) patch.set.isNamedCreature = true;
		} else if (current.isNamedCreature != null) patch.remove.push("isNamedCreature");
		["legendaryHeader", "mythicHeader"].forEach(prop => {
			const value = complexValues[prop] || [];
			if (value.length) {
				if (!_isEqual(value, current[prop] || [])) patch.set[prop] = value;
			} else if (current[prop]?.length) patch.remove.push(prop);
		});
		return patch;
	}

	static _getArrayText (value) {
		if (!value?.length) return "";
		return value.every(it => typeof it === "string")
			? value.join(", ")
			: JSON.stringify(value);
	}

	static _getArrayValue (text, label) {
		const clean = text.trim();
		if (!clean) return [];
		if (!clean.startsWith("[")) return clean.split(",").map(it => it.trim()).filter(Boolean);
		let parsed;
		try {
			parsed = JSON.parse(clean);
		} catch (e) {
			throw new Error(`${label} contains invalid JSON: ${e.message}`);
		}
		if (!Array.isArray(parsed)) throw new Error(`${label} must be a comma-separated list or JSON array.`);
		return parsed;
	}

	static _getKeyValueText (obj) {
		const entries = Object.entries(obj || {});
		if (entries.some(([, value]) => typeof value === "object")) return JSON.stringify(obj);
		return entries.map(([key, value]) => `${key}:${value}`).join(", ");
	}

	static _getKeyValueObject (text, label) {
		const clean = text.trim();
		if (!clean) return {};
		if (clean.startsWith("{")) {
			let parsed;
			try {
				parsed = JSON.parse(clean);
			} catch (e) {
				throw new Error(`${label.toTitleCase()} contain invalid JSON: ${e.message}`);
			}
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label.toTitleCase()} must be a “name:value” list or JSON object.`);
			return parsed;
		}
		return Object.fromEntries(clean.split(",").map(part => {
			const [key, ...valueParts] = part.split(":");
			const value = valueParts.join(":").trim();
			if (!key.trim() || !value) throw new Error(`Each ${label} entry must use “name:value”.`);
			return [key.trim(), value];
		}));
	}

	static _getLabeledInput ({grid, label, value = "", type = "text", placeholder = ""}) {
		const wrp = _getElement("label", {clazz: "bqa__field"});
		wrp.append(_getElement("span", {clazz: "bqa__field-label", text: label}));
		const input = _getElement("input", {
			clazz: "ve-form-control",
			attrs: {type, value, placeholder},
		});
		input.dataset.label = label;
		wrp.append(input);
		grid.append(wrp);
		return input;
	}

	static _getLabeledSelect ({grid, label, values, value = null}) {
		const wrp = _getElement("label", {clazz: "bqa__field"});
		wrp.append(_getElement("span", {clazz: "bqa__field-label", text: label}));
		const select = _getElement("select", {clazz: "ve-form-control"});
		values.forEach(meta => {
			const option = _getElement("option", {text: meta.label, attrs: {value: meta.value}});
			if (meta.value === value) option.selected = true;
			select.append(option);
		});
		wrp.append(select);
		grid.append(wrp);
		return select;
	}

	static _getLabeledTextarea ({grid, label, value = ""}) {
		const wrp = _getElement("label", {clazz: "bqa__field bqa__field--wide"});
		wrp.append(_getElement("span", {clazz: "bqa__field-label", text: label}));
		const textarea = _getElement("textarea", {clazz: "ve-form-control bqa__entry-editor"});
		textarea.value = value;
		wrp.append(textarea);
		grid.append(wrp);
		return textarea;
	}

	static async _pSaveToHomebrew ({monster, pFnOnSave = null}) {
		try {
			const source = await this._pGetHomebrewSource();
			if (!source) return;
			const name = await InputUiUtil.pGetUserString({
				title: "Save Creature to Homebrew",
				default: `${monster._displayName || monster.name} (Quick Edit)`,
				htmlDescription: `Choose a name for the saved copy in <b>${source.full}</b>. The original creature will not be changed.`,
			});
			if (!name?.trim()) return;

			const brew = await BrewUtil2.pGetOrCreateEditableBrewDoc();
			const existing = (brew.body?.monster || []).find(it => it.name === name.trim() && it.source === source.json);
			let uniqueId = globalThis.CryptUtil.uid();
			let isOverwrite = false;
			if (existing) {
				const choice = await InputUiUtil.pGetUserEnum({
					title: "Creature Already Exists",
					values: ["Overwrite existing", "Save as copy", "Cancel"],
					isResolveItem: true,
				});
				if (!choice || choice === "Cancel") return;
				if (choice === "Overwrite existing") {
					uniqueId = existing.uniqueId;
					isOverwrite = true;
				}
			}

			const clean = this._getCleanMonster({
				monster,
				name: existing && uniqueId !== existing.uniqueId ? this._getCopyName({name: name.trim(), monsters: brew.body?.monster || [], source: source.json}) : name.trim(),
				source: source.json,
				uniqueId,
			});
			let hotLegendaryGroup = null;
			if (clean.legendaryGroup?.lairActions?.length) {
				const legendaryGroups = brew.body?.legendaryGroup || [];
				const baseGroupName = `${clean.name} Lair`;
				const isExistingGroupShared = isOverwrite && existing?.legendaryGroup && (brew.body?.monster || []).some(it => it.uniqueId !== existing.uniqueId
					&& it.legendaryGroup?.name === existing.legendaryGroup.name
					&& it.legendaryGroup?.source === existing.legendaryGroup.source);
				const previousGroup = isOverwrite && !isExistingGroupShared && existing?.legendaryGroup
					? legendaryGroups.find(it => it.name === existing.legendaryGroup.name && it.source === existing.legendaryGroup.source)
					: null;
				const groupName = previousGroup?.name || (legendaryGroups.some(it => it.name === baseGroupName && it.source === source.json)
					? this._getCopyName({name: baseGroupName, monsters: legendaryGroups, source: source.json})
					: baseGroupName);
				const legendaryGroup = DataUtil.cleanJson({
					..._copy(clean.legendaryGroup),
					name: groupName,
					source: source.json,
					uniqueId: previousGroup?.uniqueId || globalThis.CryptUtil.uid(),
				}, {isDeleteUniqueId: false});
				await BrewUtil2.pPersistEditableBrewEntity("legendaryGroup", legendaryGroup);
				hotLegendaryGroup = _copy(legendaryGroup);
				clean.legendaryGroup = {name: groupName, source: source.json};
			}
			await BrewUtil2.pPersistEditableBrewEntity("monster", DataUtil.cleanJson(clean, {isDeleteUniqueId: false}));
			if (pFnOnSave) await pFnOnSave({
				..._copy(clean),
				...(hotLegendaryGroup ? {legendaryGroup: hotLegendaryGroup} : {}),
			});
			JqueryUtil.doToast({
				type: "success",
				content: pFnOnSave
					? `${clean.name} saved to ${source.full} and added to the Bestiary.`
					: `${clean.name} saved to ${source.full}. Refresh loaded creature lists to see the saved copy.`,
			});
			return {monster: clean, source};
		} catch (e) {
			JqueryUtil.doToast({type: "danger", content: `Could not save the creature: ${e.message}`});
			setTimeout(() => { throw e; });
		}
	}

	static async _pGetHomebrewSource () {
		const brew = await BrewUtil2.pGetOrCreateEditableBrewDoc();
		const sources = brew.body?._meta?.sources || [];
		const valueCreate = Symbol("create");
		const values = [...sources, valueCreate];
		const selected = await InputUiUtil.pGetUserEnum({
			title: "Choose Homebrew Source",
			values,
			fnDisplay: value => value === valueCreate ? "Create a new source…" : `${value.full} (${value.json})`,
			isResolveItem: true,
		});
		if (!selected) return null;
		if (selected !== valueCreate) return selected;
		return this._pCreateHomebrewSource();
	}

	static _pCreateHomebrewSource () {
		return new Promise(resolve => {
			let isResolved = false;
			const resolveOnce = value => {
				if (isResolved) return;
				isResolved = true;
				resolve(value);
			};
			const {eleModalInner, doClose} = UiUtil.getShowModal({
				title: "Create Homebrew Source",
				isUncappedWidth: true,
				isHeaderBorder: true,
				cbClose: () => resolveOnce(null),
			});
			const finish = value => {
				resolveOnce(value);
				doClose();
			};
			SourceUiUtil.render({
				mode: "add",
				isRequired: true,
				eleParent: eleModalInner,
				cbConfirm: async source => {
					await BrewUtil2.pAddSource(source);
					finish(source);
				},
				cbConfirmExisting: finish,
				cbCancel: () => finish(null),
			});
		});
	}

	static _getCleanMonster ({monster, name, source, uniqueId}) {
		const clean = _copy(monster);
		Object.keys(clean).forEach(key => {
			if (key.startsWith("_")) delete clean[key];
		});
		delete clean.uniqueId;
		delete clean.srd;
		delete clean.srd52;
		delete clean.basicRules;
		delete clean.basicRules2024;
		delete clean.reprintedAs;
		clean.name = name;
		clean.source = source;
		clean.uniqueId = uniqueId;
		return clean;
	}

	static _getCopyName ({name, monsters, source}) {
		const names = new Set(monsters.filter(it => it.source === source).map(it => it.name));
		for (let ix = 1; ix < 1000; ++ix) {
			const suffix = ix === 1 ? "Copy" : `Copy ${ix}`;
			const candidate = `${name} (${suffix})`;
			if (!names.has(candidate)) return candidate;
		}
		return `${name} (${globalThis.CryptUtil.uid().slice(0, 6)})`;
	}
}
