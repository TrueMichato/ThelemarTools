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
	}));
}

export function filterItemCompositionCatalogRows (rows, {search = "", category = "", source = ""} = {}) {
	const searchKey = _key(search);
	return (rows || []).filter(row => {
		if (category && row.category !== category) return false;
		if (source && row.entity.source !== source) return false;
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
		this._filters = {search: "", category: "", source: ""};
	}

	render ({wrp}) {
		const idTitle = `itembuilder-picker-title-${_nextPickerId++}`;
		const rows = getItemCompositionCatalogRows({draft: this._draft, catalogs: this._catalogs});
		const sources = [...new Set(rows.map(row => row.entity.source).filter(Boolean))]
			.sort((a, b) => _getSourceLabel(a).localeCompare(_getSourceLabel(b)));
		const iptSearch = ee`<input type="search" class="ve-form-control" aria-label="Search composition catalog" placeholder="Search materials, upgrades, and effects...">`
			.val(this._filters.search);
		const selCategory = ee`<select class="ve-form-control" aria-label="Filter composition category">
			<option value="">All categories</option>
			${Object.entries(_CATEGORY_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`)}
		</select>`.val(this._filters.category);
		const selSource = ee`<select class="ve-form-control" aria-label="Filter composition source">
			<option value="">All sources</option>
			${sources.map(source => `<option value="${source.qq()}">${_getSourceLabel(source).qq()}</option>`)}
		</select>`.val(this._filters.source);
		const wrpRows = ee`<div class="itembuilder-picker__results"></div>`;
		const status = ee`<div class="itembuilder-picker__count" role="status" aria-live="polite"></div>`;

		const renderRows = () => {
			const visible = filterItemCompositionCatalogRows(rows, this._filters);
			wrpRows.empty();
			status.txt(`${visible.length} of ${rows.length} compatible choices`);
			if (!visible.length) {
				const btnClear = ee`<button class="ve-btn ve-btn-default">Clear filters</button>`
					.onn("click", () => {
						this._filters = {search: "", category: "", source: ""};
						iptSearch.val("");
						selCategory.val("");
						selSource.val("");
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
				ee`<button class="itembuilder-picker__choice ${row.isSelected ? "itembuilder-picker__choice--selected" : ""}" aria-pressed="${row.isSelected}" aria-label="${action} ${row.entity.name.qq()}">
					<span class="itembuilder-picker__choice-head">
						<strong>${row.entity.name.qq()}</strong>
						<span>${row.categoryLabel.slice(0, -1).qq()} \u00b7 ${row.sourceLabel.qq()}</span>
					</span>
					<span class="itembuilder-picker__effect">${row.effectSummary.qq()}</span>
					<span class="itembuilder-picker__context">${row.compatibility.qq()}</span>
					<span class="itembuilder-picker__delta">${row.isSelected ? "Without selection" : "Projected change"}: ${row.delta.qq()}</span>
					<span class="itembuilder-picker__action">${action}</span>
				</button>`
					.onn("click", () => this._onSelect({category: row.category, entity: row.entity, isSelected: row.isSelected}))
					.appendTo(wrpRows);
			}
		};

		iptSearch.onn("input", () => {
			this._filters.search = iptSearch.val();
			renderRows();
		});
		selCategory.onn("change", () => {
			this._filters.category = selCategory.val();
			renderRows();
		});
		selSource.onn("change", () => {
			this._filters.source = selSource.val();
			renderRows();
		});

		ee`<section class="itembuilder-picker" aria-labelledby="${idTitle}">
			<div class="itembuilder-picker__heading">
				<div>
					<h3 id="${idTitle}">Composition catalog</h3>
					<p>Search compatible materials, upgrades, and gemstone empowerments. Every choice shows its projected result.</p>
				</div>
				${status}
			</div>
			<div class="itembuilder-picker__filters">
				<label><span>Search</span>${iptSearch}</label>
				<label><span>Category</span>${selCategory}</label>
				<label><span>Source</span>${selSource}</label>
			</div>
			${wrpRows}
		</section>`.appendTo(wrp);
		renderRows();
	}
}
