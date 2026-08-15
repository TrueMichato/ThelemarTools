import {ItemBuilderCore} from "./itembuilder-core.js";

const _CATEGORY_LABELS = {
	material: "Materials",
	upgrade: "Upgrades",
	gemstone: "Gemstones",
};
let _nextPickerId = 1;

const _DELTA_FIELDS = [
	["dmg1", "Damage"],
	["dmg2", "Versatile damage"],
	["ac", "Armor Class"],
	["weight", "Weight"],
	["value", "Value"],
	["bonusWeaponAttack", "Weapon attack"],
	["bonusWeaponDamage", "Weapon damage"],
	["bonusSpellAttack", "Spell attack"],
	["bonusSpellSaveDc", "Spell save DC"],
	["bonusAc", "AC bonus"],
	["charges", "Charges"],
	["critThreshold", "Critical threshold"],
];

const _key = value => String(value || "").trim().toLowerCase();
const _uid = entity => `${_key(entity?.name)}|${_key(entity?.source)}`;

function _getEntryText (value) {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(_getEntryText).find(Boolean) || "";
	if (!value || typeof value !== "object") return "";
	return _getEntryText(value.entries || value.entry || value.items);
}

function _stripTags (value) {
	return String(value || "")
		.replace(/\{@\w+\s+([^}|]+)(?:\|[^}]*)?}/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

function _getSourceLabel (source) {
	if (!source) return "Unknown source";
	return globalThis.Parser?.sourceJsonToFull?.(source) || source;
}

function _getCompatibility ({category, entity, item}) {
	if (category === "material") {
		const appliesTo = Array.isArray(entity.appliesTo) ? entity.appliesTo : [];
		return appliesTo.length
			? `Compatible with ${appliesTo.join(", ")} items`
			: "Compatible with this item";
	}
	if (category === "gemstone") return "Compatible with socketable weapons, armor, and shields";
	const types = Array.isArray(entity.upgradeType) ? entity.upgradeType : [];
	if (types.length) {
		const labels = types.map(type => {
			if (type.startsWith("WU")) return type.includes(":") ? `weapon (tier ${type.split(":")[1]})` : "weapon";
			if (type.startsWith("AU")) return "armor";
			if (type.startsWith("GS")) return "socketable item";
			return type;
		});
		return `Compatible with ${[...new Set(labels)].join(", ")}`;
	}
	return item?.type ? `Compatible with item type ${String(item.type).split("|")[0]}` : "Compatible with this item";
}

function _getEffectSummary (entity) {
	const entry = _stripTags(_getEntryText(entity?.entries));
	if (entry) return entry.length > 180 ? `${entry.slice(0, 177).trim()}...` : entry;
	if (entity?.cost != null) return `Catalog cost: ${entity.cost}`;
	return "No catalog effect summary is available.";
}

function _getEffectKind (row) {
	const beforeAfter = row.delta !== "No numeric stat change; see the effect summary.";
	if (beforeAfter) return "mechanical";
	if (_getEntryText(row.entity?.entries)) return "rules";
	return "unresolved";
}

function _findByRef (pool, ref) {
	const uid = _uid(ref);
	return (pool || []).find(it => _uid(it) === uid) || ref;
}

function _getNextDraft ({draft, category, entity, isSelected}) {
	const next = ItemBuilderCore.normalizeDraft(draft);
	const ref = {name: entity.name, source: entity.source};
	if (category === "material") next.material = isSelected ? null : ref;
	if (category === "gemstone") next.gemstone = isSelected ? null : ref;
	if (category === "upgrade") {
		const uid = _uid(ref);
		next.upgrades = isSelected
			? next.upgrades.filter(it => _uid(it) !== uid)
			: [...next.upgrades, ref];
	}
	return next;
}

function _formatDeltaValue ({prop, value}) {
	if (value == null || value === "") return "\u2014";
	if (prop === "weight") return `${value} lb.`;
	if (prop === "value") return `${value} cp`;
	if (prop.startsWith("bonus")) return Number(value) > 0 ? `+${value}` : String(value);
	return String(value);
}

function _getProjectedDelta ({draft, catalogs, category, entity, isSelected}) {
	try {
		const before = ItemBuilderCore.projectForPreview(draft, catalogs);
		const after = ItemBuilderCore.projectForPreview(_getNextDraft({draft, category, entity, isSelected}), catalogs);
		const changes = _DELTA_FIELDS
			.filter(([prop]) => JSON.stringify(before[prop]) !== JSON.stringify(after[prop]))
			.map(([prop, label]) => `${label}: ${_formatDeltaValue({prop, value: before[prop]})} \u2192 ${_formatDeltaValue({prop, value: after[prop]})}`);
		return changes.length ? changes.join("; ") : "No numeric stat change; see the effect summary.";
	} catch {
		return "Preview unavailable for this restored catalog entry.";
	}
}

function _dedupe (entities) {
	const seen = new Set();
	return (entities || []).filter(entity => {
		const uid = _uid(entity);
		if (!entity?.name || seen.has(uid)) return false;
		seen.add(uid);
		return true;
	});
}

export function getItemCompositionCatalogRows ({draft, catalogs}) {
	draft = ItemBuilderCore.normalizeDraft(draft);
	catalogs = catalogs || {};
	const selectedUpgrades = new Set(draft.upgrades.map(_uid));
	const selectedMaterial = _uid(draft.material);
	const selectedGemstone = _uid(draft.gemstone);
	const materialEntities = _dedupe([
		...ItemBuilderCore.getEligibleMaterials({draft, materials: catalogs.materials || []}),
		...draft.material ? [_findByRef(catalogs.materials, draft.material)] : [],
	]);
	const upgradeEntities = _dedupe([
		...ItemBuilderCore.getEligibleUpgrades({draft, upgrades: catalogs.upgrades || []}),
		...draft.upgrades.map(ref => _findByRef(catalogs.upgrades, ref)),
	]);
	const gemstoneEntities = _dedupe([
		...ItemBuilderCore.getEligibleGemstones({draft, upgrades: catalogs.upgrades || []}),
		...draft.gemstone ? [_findByRef(catalogs.upgrades, draft.gemstone)] : [],
	]);

	return [
		...materialEntities.map(entity => ({category: "material", entity, isSelected: _uid(entity) === selectedMaterial})),
		...upgradeEntities.map(entity => ({category: "upgrade", entity, isSelected: selectedUpgrades.has(_uid(entity))})),
		...gemstoneEntities.map(entity => ({category: "gemstone", entity, isSelected: _uid(entity) === selectedGemstone})),
	].map(row => ({
		...row,
		categoryLabel: _CATEGORY_LABELS[row.category],
		sourceLabel: _getSourceLabel(row.entity.source),
		effectSummary: _getEffectSummary(row.entity),
		compatibility: _getCompatibility({category: row.category, entity: row.entity, item: draft.item}),
		delta: _getProjectedDelta({draft, catalogs, ...row}),
	})).map(row => ({
		...row,
		effectKind: _getEffectKind(row),
		isUnresolved: Object.keys(row.entity || {}).every(prop => ["name", "source"].includes(prop)),
	}));
}

export function filterItemCompositionCatalogRows (rows, {search = "", category = "", source = "", effect = ""} = {}) {
	const searchKey = _key(search);
	return (rows || []).filter(row => {
		if (category && row.category !== category) return false;
		if (source && row.entity.source !== source) return false;
		if (effect && row.effectKind !== effect) return false;
		if (!searchKey) return true;
		return [
			row.entity.name,
			row.entity.source,
			row.sourceLabel,
			row.categoryLabel,
			row.effectSummary,
			row.compatibility,
			row.delta,
		].some(value => _key(value).includes(searchKey));
	});
}

export class ItemCompositionCatalogPicker {
	constructor ({draft, catalogs, onSelect}) {
		this._draft = draft;
		this._catalogs = catalogs;
		this._onSelect = onSelect;
		this._filters = {search: "", category: "material", source: "", effect: ""};
	}

	render ({wrp}) {
		const idTitle = `itembuilder-picker-title-${_nextPickerId++}`;
		const rows = getItemCompositionCatalogRows({draft: this._draft, catalogs: this._catalogs});
		const sources = [...new Set(rows.map(row => row.entity.source).filter(Boolean))]
			.sort((a, b) => _getSourceLabel(a).localeCompare(_getSourceLabel(b)));
		const iptSearch = ee`<input type="search" class="ve-form-control" aria-label="Search composition catalog" placeholder="Search materials, upgrades, and effects...">`
			.val(this._filters.search);
		const selSource = ee`<select class="ve-form-control" aria-label="Filter composition source">
			<option value="">All sources</option>
			${sources.map(source => `<option value="${source.qq()}">${_getSourceLabel(source).qq()}</option>`)}
		</select>`.val(this._filters.source);
		const selEffect = ee`<select class="ve-form-control" aria-label="Filter composition effect">
			<option value="">All effects</option>
			<option value="mechanical">Mechanical changes</option>
			<option value="rules">Rules text</option>
			<option value="unresolved">Unavailable references</option>
		</select>`.val(this._filters.effect);
		const wrpCategories = ee`<div class="itembuilder-picker__categories" role="tablist" aria-label="Composition category"></div>`;
		const wrpRows = ee`<div class="itembuilder-picker__results"></div>`;
		const status = ee`<div class="itembuilder-picker__count" role="status" aria-live="polite"></div>`;
		const categoryButtons = Object.entries(_CATEGORY_LABELS).map(([value, label]) => {
			const count = rows.filter(row => row.category === value).length;
			return ee`<button class="itembuilder-picker__category" role="tab" aria-selected="false" data-category="${value}">
				<span>${label}</span><strong>${count}</strong>
			</button>`
				.onn("click", () => {
					this._filters.category = value;
					renderRows();
				})
				.appendTo(wrpCategories);
		});

		const renderRows = () => {
			const visible = filterItemCompositionCatalogRows(rows, this._filters)
				.sort((a, b) => Number(b.isSelected) - Number(a.isSelected) || a.entity.name.localeCompare(b.entity.name));
			wrpRows.empty();
			status.txt(`${visible.length} of ${rows.length} compatible choices`);
			categoryButtons.forEach(btn => {
				const isActive = btn.attr("data-category") === this._filters.category;
				btn.attr("aria-selected", `${isActive}`).attr("tabindex", isActive ? "0" : "-1");
			});
			if (!visible.length) {
				const btnClear = ee`<button class="ve-btn ve-btn-default">Clear filters</button>`
					.onn("click", () => {
						this._filters = {search: "", category: "material", source: "", effect: ""};
						iptSearch.val("");
						selSource.val("");
						selEffect.val("");
						renderRows();
						iptSearch.focuse();
					});
				ee`<div class="itembuilder-picker__empty">
					<strong>No matching composition choices</strong>
					<span>Try a broader search or clear the category and source filters.</span>
					${btnClear}
				</div>`.appendTo(wrpRows);
				return;
			}

			for (const row of visible) {
				const action = row.isSelected ? "Remove" : row.category === "upgrade" ? "Add" : "Choose";
				const btnAction = ee`<button class="itembuilder-picker__action" aria-pressed="${row.isSelected}" aria-label="${action} ${row.entity.name.qq()}">${action}</button>`
					.onn("click", () => this._onSelect({category: row.category, entity: row.entity, isSelected: row.isSelected}));
				ee`<article class="itembuilder-picker__choice ${row.isSelected ? "itembuilder-picker__choice--selected" : ""}">
					<span class="itembuilder-picker__choice-head">
						<strong>${row.entity.name.qq()}</strong>
						<span>Published in ${row.sourceLabel.qq()}</span>
					</span>
					<span class="itembuilder-picker__effect">${row.isUnresolved ? "This reference is unavailable. Reinstall its source to restore mechanics." : row.effectSummary.qq()}</span>
					<span class="itembuilder-picker__delta">${row.isSelected ? "Without selection" : "Projected change"}: ${row.delta.qq()}</span>
					${btnAction}
					<details class="itembuilder-picker__details">
						<summary>Compatibility and source details</summary>
						<span>${row.compatibility.qq()}</span>
						<span>Reference: ${row.entity.name.qq()}|${(row.entity.source || "unknown").qq()}</span>
					</details>
				</article>`.appendTo(wrpRows);
			}
		};

		iptSearch.onn("input", () => {
			this._filters.search = iptSearch.val();
			renderRows();
		});
		selSource.onn("change", () => {
			this._filters.source = selSource.val();
			renderRows();
		});
		selEffect.onn("change", () => {
			this._filters.effect = selEffect.val();
			renderRows();
		});

		ee`<section class="itembuilder-picker" aria-labelledby="${idTitle}">
			<div class="itembuilder-picker__heading">
				<div>
					<h3 id="${idTitle}">Composition catalog</h3>
					<p>Compare compatible components from core data and installed homebrew. Your saved item keeps source-qualified references.</p>
				</div>
				${status}
			</div>
			${wrpCategories}
			<div class="itembuilder-picker__filters">
				<label><span>Search</span>${iptSearch}</label>
				<label><span>Published in</span>${selSource}</label>
				<label><span>Effect</span>${selEffect}</label>
			</div>
			${wrpRows}
		</section>`.appendTo(wrp);
		renderRows();
	}
}
