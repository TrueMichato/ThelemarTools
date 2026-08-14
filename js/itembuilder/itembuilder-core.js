import {CharacterSheetMaterials} from "../charactersheet/charactersheet-materials.js";
import {
	getEligibleUpgrades,
	getGemstoneDescriptor,
	isSocketable,
} from "./itembuilder-upgrade-rules.js";

const _VERSION = 1;
const _GENERATED_ENTRY_PREFIX = "Item Builder:";
const _DIE_ORDER = [4, 6, 8, 10, 12];
const _ITEM_COLLECTION_PROPS = [
	"entries",
	"additionalEntries",
	"properties",
	"property",
	"attachedSpells",
	"effects",
	"itemPowers",
	"appliedUpgrades",
	"socketedGemstones",
];
const _COMPOSITION_COLLECTION_PROPS = [
	"entries",
	"upgradeType",
	"prerequisite",
	"properties",
	"property",
	"attachedSpells",
	"effects",
	"itemPowers",
	"appliesTo",
];

const _copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const _key = value => String(value || "").trim().toLowerCase();
const _ref = ent => ent?.name ? {name: ent.name, source: ent.source || ""} : null;
const _isEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function _isObject (value) {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function _normalizeCollectionProps (entity, props) {
	if (!_isObject(entity)) return entity;
	for (const prop of props) {
		if (!Object.hasOwn(entity, prop)) continue;
		entity[prop] = Array.isArray(entity[prop]) ? entity[prop] : [];
	}
	return entity;
}

function _normalizeCompositionEntity (entity) {
	if (!_isObject(entity)) return null;
	return _normalizeCollectionProps(entity, _COMPOSITION_COLLECTION_PROPS);
}

function _normalizeCompositionCollection (value) {
	if (!Array.isArray(value)) return [];
	return value
		.map(it => _normalizeCompositionEntity(it))
		.filter(Boolean);
}

function _normalizeItem (item) {
	item = _isObject(item) ? item : {};
	_normalizeCollectionProps(item, _ITEM_COLLECTION_PROPS);
	if (Object.hasOwn(item, "focus") && item.focus !== true) item.focus = Array.isArray(item.focus) ? item.focus : [];
	item.appliedUpgrades = _normalizeCompositionCollection(item.appliedUpgrades);
	item.socketedGemstones = _normalizeCompositionCollection(item.socketedGemstones);
	return item;
}

function _normalizeMaterialized (materialized) {
	if (!_isObject(materialized)) return null;
	materialized.item = _normalizeItem(materialized.item);
	materialized.material = _normalizeCompositionEntity(materialized.material);
	materialized.upgrades = _normalizeCompositionCollection(materialized.upgrades);
	materialized.gemstone = _normalizeCompositionEntity(materialized.gemstone);
	return materialized;
}

function _findByRef (pool, ref) {
	if (!ref?.name) return null;
	const name = _key(ref.name);
	const source = _key(ref.source);
	return (pool || []).find(it => _key(it.name) === name && (!source || _key(it.source) === source))
		|| (pool || []).find(it => _key(it.name) === name)
		|| null;
}

function _mergeUnique (base, additions, getKey = it => JSON.stringify(it)) {
	const out = _copy(base || []);
	const seen = new Set(out.map(getKey));
	for (const addition of additions || []) {
		const key = getKey(addition);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(_copy(addition));
	}

	return out;
}

function _removeMatching (base, removals, getKey = it => JSON.stringify(it)) {
	const removalKeys = new Set((removals || []).map(getKey));
	return _copy(base || []).filter(it => !removalKeys.has(getKey(it)));
}

function _increaseDamageDie (damageDie, steps = 1) {
	if (!damageDie || !steps) return damageDie;
	const match = String(damageDie).match(/^(\d+)d(\d+)$/i);
	if (!match) return damageDie;
	const count = Number(match[1]);
	const ix = _DIE_ORDER.indexOf(Number(match[2]));
	if (!~ix) return damageDie;
	return `${count}d${_DIE_ORDER[Math.min(_DIE_ORDER.length - 1, ix + steps)]}`;
}

function _getUpgradeEffects (upgrades) {
	const out = {
		bonusWeaponAttack: 0,
		bonusWeaponDamage: 0,
		bonusSpellAttack: 0,
		bonusSpellSaveDc: 0,
		critThresholdReduction: 0,
		damageDieIncrease: 0,
		tags: [],
		notes: [],
	};

	for (const upgrade of upgrades || []) {
		const name = _key(upgrade.name);
		if (name === "balanced") out.bonusWeaponAttack++;
		if (name.startsWith("wounding:")) out.bonusWeaponDamage++;
		if (name.startsWith("critical:")) out.critThresholdReduction++;
		if (name === "superior") out.damageDieIncrease++;
		if (name === "masterwork") {
			out.bonusWeaponAttack++;
			out.bonusWeaponDamage++;
		}
		if (name === "enchanted") out.bonusSpellAttack++;
		if (name === "arcane") out.bonusSpellSaveDc++;
		if (["silvered", "magical", "runic"].includes(name)) out.tags.push(name.toTitleCase ? name.toTitleCase() : `${name[0].toUpperCase()}${name.slice(1)}`);
		if (name === "saw-toothed") out.notes.push("Saw-toothed: +1d4 slashing damage (no effect against constructs or undead).");
		if (name === "brutal") out.notes.push("Brutal: reroll maximum weapon damage dice and add them to the total.");
		if (name === "flanged") out.notes.push("Flanged: hits can cumulatively reduce medium or heavy armor AC.");
	}
	return out;
}

function _getGeneratedEntries ({material, upgrades, gemstone}) {
	const out = [];
	if (material) {
		out.push({
			type: "entries",
			name: `${_GENERATED_ENTRY_PREFIX} Material - ${material.name}`,
			entries: _copy(material.entries || [`This item is made from ${material.name}.`]),
		});
	}
	for (const upgrade of upgrades || []) {
		out.push({
			type: "entries",
			name: `${_GENERATED_ENTRY_PREFIX} Upgrade - ${upgrade.name}`,
			entries: _copy(upgrade.entries || []),
		});
	}
	if (gemstone) {
		const descriptor = getGemstoneDescriptor(gemstone);
		out.push({
			type: "entries",
			name: `${_GENERATED_ENTRY_PREFIX} Gem - ${gemstone.name}`,
			entries: _copy(gemstone.entries?.length ? gemstone.entries : [descriptor?.summary || "This item is empowered by a gemstone."]),
		});
	}
	return out;
}

export class ItemBuilderCore {
	static VERSION = _VERSION;

	static dedupeCatalog (entities) {
		return _mergeUnique([], entities || [], it => `${_key(it?.name)}|${_key(it?.source)}`);
	}

	static createDraft ({source = "", item = null} = {}) {
		return this.normalizeDraft({
			version: _VERSION,
			item: item || {
				name: "New Item",
				source,
				type: "W",
				rarity: "none",
				entries: [],
			},
		});
	}

	static normalizeDraft (saved, {source = ""} = {}) {
		if (saved?.name && saved?.source && !saved.item) saved = {version: _VERSION, item: saved};
		const draft = {
			version: _VERSION,
			item: _normalizeItem(_copy(saved?.item || {})),
			preset: _copy(saved?.preset || null),
			material: _normalizeCompositionEntity(_copy(Object.hasOwn(saved || {}, "material") ? saved.material : (saved?.item?.material || null))),
			upgrades: _normalizeCompositionCollection(_copy(Object.hasOwn(saved || {}, "upgrades") ? saved.upgrades : (saved?.item?.appliedUpgrades || []))),
			gemstone: _normalizeCompositionEntity(_copy(Object.hasOwn(saved || {}, "gemstone") ? saved.gemstone : (saved?.item?.socketedGemstones?.[0] || null))),
			materialized: _normalizeMaterialized(_copy(saved?.materialized || null)),
		};
		if (draft.item.name == null) draft.item.name = "New Item";
		if (draft.item.source == null) draft.item.source = source;
		if (draft.item.type == null) draft.item.type = "W";
		if (draft.item.rarity == null) draft.item.rarity = "none";
		return draft;
	}

	static fromItem (item) {
		return this.normalizeDraft({
			item,
			preset: item?.baseItem ? this.unpackUid(item.baseItem) : null,
			material: item?.material,
			upgrades: item?.appliedUpgrades,
			gemstone: item?.socketedGemstones?.[0],
			materialized: {
				item,
				material: item?.material,
				upgrades: item?.appliedUpgrades,
				gemstone: item?.socketedGemstones?.[0],
			},
		});
	}

	static unpackUid (uid) {
		if (!uid) return null;
		const [name, source = ""] = String(uid).split("|");
		return name ? {name, source} : null;
	}

	static packUid (ent) {
		return ent?.name ? `${ent.name}|${ent.source || ""}` : null;
	}

	static applyPreset (draft, preset, {source = null} = {}) {
		const current = this.normalizeDraft(draft);
		const item = _copy(preset || {});
		delete item.uniqueId;
		delete item.srd;
		delete item.srd52;
		delete item.basicRules;
		delete item.basicRules2024;
		delete item.reprintedAs;
		item.name = `${preset.name} (Custom)`;
		item.source = source ?? current.item.source;
		item.baseItem = this.packUid(preset);
		return this.normalizeDraft({item, preset: _ref(preset)});
	}

	static getEligibleMaterials ({draft, materials = []}) {
		return materials.filter(material => CharacterSheetMaterials.isEligible(draft?.item, material));
	}

	static getEligibleUpgrades ({draft, upgrades = []}) {
		return getEligibleUpgrades({item: {...draft?.item, appliedUpgrades: draft?.upgrades || []}, upgrades});
	}

	static getEligibleGemstones ({draft, upgrades = []}) {
		if (!isSocketable(draft?.item)) return [];
		return upgrades.filter(it => String(it?.upgradeType?.[0] || "").startsWith("GS:"));
	}

	static validate (draft, catalogs = {}) {
		const normalized = this.normalizeDraft(draft);
		const errors = [];
		const warnings = [];
		const {item} = normalized;

		if (!String(item.name || "").trim()) errors.push({field: "name", message: "Enter an item name."});
		if (!String(item.source || "").trim()) errors.push({field: "source", message: "Choose a homebrew source."});
		if (!String(item.type || "").trim()) errors.push({field: "type", message: "Choose an item type."});
		for (const prop of ["weight", "value", "ac", "charges"]) {
			if (item[prop] != null && (!Number.isFinite(Number(item[prop])) || Number(item[prop]) < 0)) {
				errors.push({field: prop, message: `${prop.toTitleCase ? prop.toTitleCase() : prop} must be zero or greater.`});
			}
		}
		if (normalized.preset && !_findByRef(catalogs.items, normalized.preset)) warnings.push({field: "preset", message: `Preset "${normalized.preset.name}" is unavailable; authored fields are preserved.`});
		if (normalized.material && !_findByRef(catalogs.materials, normalized.material)) warnings.push({field: "material", message: `Material "${normalized.material.name}" is unavailable; its reference is preserved.`});
		for (const upgrade of normalized.upgrades) {
			if (!_findByRef(catalogs.upgrades, upgrade)) warnings.push({field: "upgrades", message: `Upgrade "${upgrade.name}" is unavailable; its reference is preserved.`});
		}
		if (normalized.gemstone && !_findByRef(catalogs.upgrades, normalized.gemstone)) warnings.push({field: "gemstone", message: `Gem empowerment "${normalized.gemstone.name}" is unavailable; its reference is preserved.`});
		if (normalized.gemstone && !isSocketable(item)) errors.push({field: "gemstone", message: "Only weapons, armor, and shields can hold an empowered gemstone."});

		return {isValid: !errors.length, errors, warnings};
	}

	static serialize (draft, catalogs = {}) {
		const normalized = this.normalizeDraft(draft);
		const preset = _findByRef(catalogs.items, normalized.preset);
		const authoredItem = normalized.materialized && preset
			? this._getAuthoredItemFromMaterialized({normalized, preset, catalogs})
			: normalized.item;
		let out = {..._copy(preset || {}), ..._copy(authoredItem)};
		const material = _findByRef(catalogs.materials, normalized.material);
		const upgrades = normalized.upgrades.map(ref => _findByRef(catalogs.upgrades, ref) || ref).filter(Boolean);
		const gemstone = normalized.gemstone ? (_findByRef(catalogs.upgrades, normalized.gemstone) || normalized.gemstone) : null;

		if (preset) {
			out.baseItem = this.packUid(preset);
			if (out.type && preset.source && !String(out.type).includes("|")) out.type = `${out.type}|${preset.source}`;
		}

		if (normalized.material) {
			out.material = _ref(material || normalized.material);
			out = CharacterSheetMaterials.applyToItem(out, material, {isSkipDegradation: true});
			delete out._materialEffects;
			delete out._materialEntity;
			delete out._materialDegradation;
		} else delete out.material;

		out.appliedUpgrades = upgrades.map(upgrade => ({
			name: upgrade.name,
			source: upgrade.source,
			...upgrade.upgradeType ? {upgradeType: _copy(upgrade.upgradeType)} : {},
			...upgrade.cost != null ? {cost: _copy(upgrade.cost)} : {},
			...upgrade.entries ? {entries: _copy(upgrade.entries)} : {},
		}));
		if (!out.appliedUpgrades.length) delete out.appliedUpgrades;

		const upgradeEffects = _getUpgradeEffects(upgrades);
		for (const prop of ["bonusWeaponAttack", "bonusWeaponDamage", "bonusSpellAttack", "bonusSpellSaveDc"]) {
			if (upgradeEffects[prop]) out[prop] = (Number(out[prop]) || 0) + upgradeEffects[prop];
		}
		if (upgradeEffects.critThresholdReduction) out.critThreshold = Math.max(2, (Number(out.critThreshold) || 20) - upgradeEffects.critThresholdReduction);
		if (upgradeEffects.damageDieIncrease) {
			out.dmg1 = _increaseDamageDie(out.dmg1, upgradeEffects.damageDieIncrease);
			out.dmg2 = _increaseDamageDie(out.dmg2, upgradeEffects.damageDieIncrease);
		}
		if (upgradeEffects.tags.length || upgradeEffects.notes.length) {
			out.effects = _mergeUnique(
				out.effects,
				[
					...upgradeEffects.tags.map(tag => ({type: "itemTag", tag})),
					...upgradeEffects.notes.map(note => ({type: "note", note})),
				],
			);
		}

		if (gemstone) {
			const descriptor = getGemstoneDescriptor(gemstone);
			out.socketedGemstones = [{
				name: gemstone.name,
				source: gemstone.source,
				...gemstone.gemName ? {gemName: gemstone.gemName} : {},
				...gemstone.rarity ? {rarity: gemstone.rarity} : {},
				...gemstone.upgradeType ? {upgradeType: _copy(gemstone.upgradeType)} : {},
				...gemstone.entries ? {entries: _copy(gemstone.entries)} : {},
			}];
			if (descriptor?.effects?.length) out.effects = _mergeUnique(out.effects, descriptor.effects);
			if (descriptor?.powers?.length) out.itemPowers = _mergeUnique(out.itemPowers, descriptor.powers, it => it.id || it.name);
			if (descriptor?.resource?.key === "charges" && Number.isFinite(Number(descriptor.resource.max))) {
				out.charges = Math.max(Number(out.charges) || 0, Number(descriptor.resource.max));
				out.recharge = descriptor.resource.recharge || out.recharge;
				if (descriptor.resource.recovery) out.rechargeAmount = `{@dice ${descriptor.resource.recovery}}`;
			}
			if (descriptor?.requiresAttunement) out.reqAttune = out.reqAttune || true;
		} else delete out.socketedGemstones;

		const authoredEntries = (out.entries || []).filter(entry => !(entry?.name || "").startsWith(_GENERATED_ENTRY_PREFIX));
		out.entries = [...authoredEntries, ..._getGeneratedEntries({material, upgrades, gemstone})];
		if (!out.entries.length) delete out.entries;
		return out;
	}

	static _getAuthoredItemFromMaterialized ({normalized, preset, catalogs}) {
		const materialized = this.normalizeDraft({
			item: preset,
			preset: normalized.preset,
			material: normalized.materialized.material,
			upgrades: normalized.materialized.upgrades,
			gemstone: normalized.materialized.gemstone,
		});
		const projectedPreset = this.serialize(materialized, catalogs);
		const original = normalized.materialized.item || {};
		const authored = _copy(normalized.item);

		for (const prop of new Set([...Object.keys(preset), ...Object.keys(projectedPreset)])) {
			if (_isEqual(projectedPreset[prop], preset[prop])) continue;
			if (!_isEqual(original[prop], projectedPreset[prop])) continue;
			if (!_isEqual(authored[prop], original[prop])) continue;
			if (preset[prop] === undefined) delete authored[prop];
			else authored[prop] = _copy(preset[prop]);
		}

		authored.entries = (authored.entries || []).filter(entry => !(entry?.name || "").startsWith(_GENERATED_ENTRY_PREFIX));
		const oldUpgrades = (normalized.materialized.upgrades || []).map(ref => _findByRef(catalogs.upgrades, ref) || ref).filter(Boolean);
		const oldUpgradeEffects = _getUpgradeEffects(oldUpgrades);
		authored.effects = _removeMatching(authored.effects, [
			...oldUpgradeEffects.tags.map(tag => ({type: "itemTag", tag})),
			...oldUpgradeEffects.notes.map(note => ({type: "note", note})),
		]);

		const oldGemstone = normalized.materialized.gemstone
			? (_findByRef(catalogs.upgrades, normalized.materialized.gemstone) || normalized.materialized.gemstone)
			: null;
		const oldGemDescriptor = getGemstoneDescriptor(oldGemstone);
		authored.effects = _removeMatching(authored.effects, oldGemDescriptor?.effects);
		authored.itemPowers = _removeMatching(authored.itemPowers, oldGemDescriptor?.powers, it => it.id || it.name);
		if (!authored.effects?.length) delete authored.effects;
		if (!authored.itemPowers?.length) delete authored.itemPowers;

		delete authored.material;
		delete authored.appliedUpgrades;
		delete authored.socketedGemstones;
		return authored;
	}
}
