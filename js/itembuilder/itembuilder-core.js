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
	materialized.isLegacyProjected = materialized.isLegacyProjected ?? (materialized.item.entries || [])
		.some(entry => (entry?.name || "").startsWith(_GENERATED_ENTRY_PREFIX));
	return materialized;
}

function _findByRef (pool, ref) {
	if (!ref?.name) return null;
	const name = _key(ref.name);
	const source = _key(ref.source);
	if (source) return (pool || []).find(it => _key(it.name) === name && _key(it.source) === source) || null;
	return (pool || []).find(it => _key(it.name) === name) || null;
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

function _parseDamageDie (damageDie) {
	const match = String(damageDie || "").match(/^(\s*)(\d+)d(\d+)(\s*[+-]\s*\d+)?(\s*)$/i);
	if (!match) return null;
	return {
		prefix: match[1],
		count: Number(match[2]),
		sides: Number(match[3]),
		modifier: match[4] || "",
		suffix: match[5],
	};
}

function _formatDamageDie ({prefix = "", count, sides, modifier = "", suffix = ""}) {
	return `${prefix}${count}d${sides}${modifier}${suffix}`;
}

function _increaseDamageDie (damageDie, steps = 1) {
	if (!damageDie || !steps) return damageDie;
	const parsed = _parseDamageDie(damageDie);
	if (!parsed) return damageDie;
	const ix = _DIE_ORDER.indexOf(parsed.sides);
	if (!~ix) return damageDie;
	return _formatDamageDie({
		...parsed,
		sides: _DIE_ORDER[Math.max(0, Math.min(_DIE_ORDER.length - 1, ix + steps))],
	});
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
				isLegacyProjected: (item?.entries || []).some(entry => (entry?.name || "").startsWith(_GENERATED_ENTRY_PREFIX)),
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
		const legacyResolution = this._getLegacyCompositionResolution(normalized, catalogs);

		if (!String(item.name || "").trim()) errors.push({field: "name", message: "Enter an item name."});
		if (!String(item.source || "").trim()) errors.push({field: "source", message: "Choose a homebrew source."});
		if (!String(item.type || "").trim()) errors.push({field: "type", message: "Choose an item type."});
		for (const prop of ["weight", "value", "ac", "charges"]) {
			if (item[prop] != null && (!Number.isFinite(Number(item[prop])) || Number(item[prop]) < 0)) {
				errors.push({field: prop, message: `${prop.toTitleCase ? prop.toTitleCase() : prop} must be zero or greater.`});
			}
		}
		for (const missing of legacyResolution.missing) {
			errors.push({
				field: missing.field,
				message: `Cannot safely save this legacy projected item because ${missing.label} "${missing.ref.name}" is unavailable. Restore the referenced catalog entry before saving.`,
			});
		}
		for (const ambiguity of legacyResolution.ambiguities) {
			errors.push({
				field: ambiguity.field,
				message: `Cannot safely save this legacy projected item because its baked ${ambiguity.label} cannot be uniquely reversed (${ambiguity.reason}). Rebuild the item from its authored base values before saving.`,
			});
		}

		if (normalized.preset && !_findByRef(catalogs.items, normalized.preset) && !normalized.materialized?.isLegacyProjected) warnings.push({field: "preset", message: `Preset "${normalized.preset.name}" is unavailable; authored fields are preserved.`});
		if (normalized.material && !_findByRef(catalogs.materials, normalized.material) && !normalized.materialized?.isLegacyProjected) warnings.push({field: "material", message: `Material "${normalized.material.name}" is unavailable; its reference is preserved.`});
		for (const upgrade of normalized.upgrades) {
			if (!_findByRef(catalogs.upgrades, upgrade) && !normalized.materialized?.isLegacyProjected) warnings.push({field: "upgrades", message: `Upgrade "${upgrade.name}" is unavailable; its reference is preserved.`});
		}
		if (normalized.gemstone && !_findByRef(catalogs.upgrades, normalized.gemstone) && !normalized.materialized?.isLegacyProjected) warnings.push({field: "gemstone", message: `Gem empowerment "${normalized.gemstone.name}" is unavailable; its reference is preserved.`});
		if (normalized.gemstone && !isSocketable(item)) errors.push({field: "gemstone", message: "Only weapons, armor, and shields can hold an empowered gemstone."});

		return {isValid: !errors.length, errors, warnings};
	}

	static serialize (draft, catalogs = {}) {
		const normalized = this.normalizeDraft(draft);
		const legacyResolution = this._getLegacyCompositionResolution(normalized, catalogs);
		if (
			normalized.materialized?.isLegacyProjected
			&& (legacyResolution.missing.length || legacyResolution.ambiguities.length)
		) {
			return this._serializeUnresolvedLegacyItem(normalized);
		}

		const preset = legacyResolution.preset || _findByRef(catalogs.items, normalized.preset);
		const authoredItem = normalized.materialized?.isLegacyProjected
			? this._getAuthoredItemFromMaterialized({normalized, preset, legacyResolution, catalogs})
			: normalized.item;
		let out = {..._copy(preset || {}), ..._copy(authoredItem)};

		if (preset) {
			out.baseItem = this.packUid(preset);
			if (out.type && preset.source && !String(out.type).includes("|")) out.type = `${out.type}|${preset.source}`;
		}

		if (normalized.material) out.material = _ref(normalized.material);
		else delete out.material;

		out.appliedUpgrades = normalized.upgrades.map(_ref).filter(Boolean);
		if (!out.appliedUpgrades.length) delete out.appliedUpgrades;

		if (normalized.gemstone) out.socketedGemstones = [_ref(normalized.gemstone)];
		else delete out.socketedGemstones;

		out.entries = (out.entries || []).filter(entry => !(entry?.name || "").startsWith(_GENERATED_ENTRY_PREFIX));
		if (!out.entries.length) delete out.entries;
		return out;
	}

	static projectForPreview (draft, catalogs = {}) {
		const normalized = this.normalizeDraft(draft);
		let out = this.serialize(normalized, catalogs);
		const legacyResolution = this._getLegacyCompositionResolution(normalized, catalogs);
		if (
			normalized.materialized?.isLegacyProjected
			&& (legacyResolution.missing.length || legacyResolution.ambiguities.length)
		) return out;
		const material = _findByRef(catalogs.materials, normalized.material);
		const upgrades = normalized.upgrades.map(ref => _findByRef(catalogs.upgrades, ref) || ref).filter(Boolean);
		const gemstone = normalized.gemstone ? (_findByRef(catalogs.upgrades, normalized.gemstone) || normalized.gemstone) : null;

		if (material) {
			out = CharacterSheetMaterials.applyToItem(out, material, {isSkipDegradation: true});
			delete out._materialEffects;
			delete out._materialEntity;
			delete out._materialDegradation;
		}

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
			if (descriptor?.effects?.length) out.effects = _mergeUnique(out.effects, descriptor.effects);
			if (descriptor?.powers?.length) out.itemPowers = _mergeUnique(out.itemPowers, descriptor.powers, it => it.id || it.name);
			if (descriptor?.resource?.key === "charges" && Number.isFinite(Number(descriptor.resource.max))) {
				out.charges = Math.max(Number(out.charges) || 0, Number(descriptor.resource.max));
				out.recharge = descriptor.resource.recharge || out.recharge;
				if (descriptor.resource.recovery) out.rechargeAmount = `{@dice ${descriptor.resource.recovery}}`;
			}
			if (descriptor?.requiresAttunement) out.reqAttune = out.reqAttune || true;
		}

		const authoredEntries = (out.entries || []).filter(entry => !(entry?.name || "").startsWith(_GENERATED_ENTRY_PREFIX));
		out.entries = [...authoredEntries, ..._getGeneratedEntries({material, upgrades, gemstone})];
		if (!out.entries.length) delete out.entries;
		return out;
	}

	static _getLegacyCompositionResolution (normalized, catalogs) {
		const out = {
			preset: _findByRef(catalogs.items, normalized.preset),
			material: _findByRef(catalogs.materials, normalized.materialized?.material),
			upgrades: (normalized.materialized?.upgrades || []).map(ref => _findByRef(catalogs.upgrades, ref)),
			gemstone: _findByRef(catalogs.upgrades, normalized.materialized?.gemstone),
			missing: [],
			ambiguities: [],
		};
		if (!normalized.materialized?.isLegacyProjected) return out;

		const addMissing = (field, label, ref, resolved) => {
			if (!ref?.name || resolved) return;
			const uid = `${field}|${_key(ref.name)}|${_key(ref.source)}`;
			if (out.missing.some(it => it.uid === uid)) return;
			out.missing.push({field, label, ref, uid});
		};
		addMissing("preset", "preset", normalized.preset, out.preset);
		addMissing("material", "material", normalized.materialized.material, out.material);
		(normalized.materialized.upgrades || []).forEach((ref, ix) => addMissing("upgrades", "upgrade", ref, out.upgrades[ix]));
		addMissing("gemstone", "gem empowerment", normalized.materialized.gemstone, out.gemstone);

		addMissing("material", "material", normalized.material, _findByRef(catalogs.materials, normalized.material));
		normalized.upgrades.forEach(ref => addMissing("upgrades", "upgrade", ref, _findByRef(catalogs.upgrades, ref)));
		addMissing("gemstone", "gem empowerment", normalized.gemstone, _findByRef(catalogs.upgrades, normalized.gemstone));
		if (!out.missing.length) out.ambiguities = this._getLegacyDeprojectionAmbiguities(normalized, out);
		return out;
	}

	static _serializeUnresolvedLegacyItem (normalized) {
		const out = _copy(normalized.item);
		delete out.baseItem;
		delete out.material;
		delete out.appliedUpgrades;
		delete out.socketedGemstones;
		return out;
	}

	static _getLegacyDeprojectionAmbiguities (normalized, legacyResolution) {
		const original = normalized.materialized?.item || {};
		const material = legacyResolution.material;
		const upgrades = legacyResolution.upgrades.filter(Boolean);
		const upgradeEffects = _getUpgradeEffects(upgrades);
		const materialEffects = material
			? CharacterSheetMaterials.getMaterialEffects(
				{...legacyResolution.preset, ...original, material: normalized.materialized.material},
				material,
			)
			: null;
		const itemKind = CharacterSheetMaterials.getItemKind({...legacyResolution.preset, ...original});
		const out = [];
		const add = (field, label, reason) => {
			if (out.some(it => it.field === field && it.reason === reason)) return;
			out.push({field, label, reason});
		};

		const materialDamageSteps = itemKind === "weapon"
			? (CharacterSheetMaterials.axisValue(material?.damage) || 0)
			: 0;
		for (const prop of ["dmg1", "dmg2"]) {
			if (!original[prop] || (!materialDamageSteps && !upgradeEffects.damageDieIncrease)) continue;
			const preimages = this._getDamageProjectionPreimages({
				observed: original[prop],
				materialDamageSteps,
				upgradeDamageSteps: upgradeEffects.damageDieIncrease,
			});
			if (preimages.length !== 1) {
				add(
					prop,
					`${prop === "dmg1" ? "primary" : "versatile"} damage die`,
					preimages.length
						? `the projected value ${original[prop]} has multiple possible bases: ${preimages.join(", ")}`
						: `the projected value ${original[prop]} has no possible base in the supported damage-die form`,
				);
			}
		}

		const materialCritical = CharacterSheetMaterials.axisValue(material?.critical) || 0;
		if (materialCritical || upgradeEffects.critThresholdReduction) {
			const observed = Number(original.critThreshold);
			if (Number.isFinite(observed)) {
				const preimages = this._getProjectionPreimages({
					observed,
					candidates: [undefined, ...Array.from({length: 19}, (_, ix) => ix + 2)],
					project: candidate => {
						const base = Number(candidate) || 20;
						const materialized = materialCritical
							? Math.max(2, Math.min(20, base - materialCritical))
							: base;
						return upgradeEffects.critThresholdReduction
							? Math.max(2, materialized - upgradeEffects.critThresholdReduction)
							: materialized;
					},
				});
				if (preimages.length > 1) {
					add(
						"critThreshold",
						"critical-hit threshold",
						`the projected value ${observed} has multiple possible bases: ${preimages.map(it => it == null ? "unset (defaults to 20)" : it).join(", ")}`,
					);
				}
			}
		}

		if (materialEffects?.armorDexCapDelta && Number(original.dexterityMax) === 0) {
			const preimages = this._getProjectionPreimages({
				observed: 0,
				candidates: Array.from({length: 31}, (_, ix) => ix),
				project: candidate => Math.max(0, candidate + materialEffects.armorDexCapDelta),
			});
			if (preimages.length > 1) {
				add(
					"dexterityMax",
					"armor Dexterity cap",
					"the projected zero cap is the result of a clamped material adjustment",
				);
			}
		}

		const materialProtection = itemKind === "armor"
			? (CharacterSheetMaterials.axisValue(material?.protection) || 0)
			: 0;
		if (materialProtection && Number(original.ac) === materialProtection) {
			add("ac", "base Armor Class", `the material overwrites every authored base AC with ${materialProtection}`);
		}

		const materialPenetration = itemKind === "weapon"
			? CharacterSheetMaterials.getPenetration(original, material)
			: 0;
		if (materialPenetration && Number(original.penetration) === materialPenetration) {
			add("penetration", "penetration rating", `the material overwrites every authored penetration rating with ${materialPenetration}`);
		}

		if (
			itemKind === "weapon"
			&& (
				materialEffects?.addProperties?.length
				|| materialEffects?.removeProperties?.length
				|| materialEffects?.propertyLadder
			)
		) {
			const operations = [
				materialEffects.addProperties.length ? `adds ${materialEffects.addProperties.join(", ")}` : null,
				materialEffects.removeProperties.length ? `removes ${materialEffects.removeProperties.join(", ")}` : null,
				materialEffects.propertyLadder ? "applies a property ladder" : null,
			].filter(Boolean).join(", ");
			add("property", "weapon properties", `the material ${operations}, which can collapse distinct authored property sets`);
		}

		if (itemKind === "armor") {
			if (materialEffects?.armorNoStealthDisadvantage && original.stealth === false) {
				add("stealth", "Stealth-disadvantage flag", "the material overwrites both an authored false value and an absent value with false");
			} else if (materialEffects?.armorStealthDisadvantage && original.stealth === true) {
				add("stealth", "Stealth-disadvantage flag", "the material overwrites both an authored true value and an absent value with true");
			}
			if (materialEffects?.armorNoStrengthRequirement && original.strength == null) {
				add("strength", "Strength requirement", "the material replaces every authored Strength requirement with no requirement");
			}
			if (materialEffects?.armorForceHeavy && original.armorType === "heavy") {
				add("armorType", "armor category", "the material replaces every authored armor category with heavy armor");
			}
		}

		if (itemKind === "weapon" && materialEffects?.rangeMultiplier && original.range != null) {
			add("range", "weapon range", `floor rounding after the material's ×${materialEffects.rangeMultiplier} multiplier can collapse distinct authored ranges`);
		}

		const weightMultiplier = CharacterSheetMaterials.getWeightMultiplier(material);
		if (weightMultiplier != null && Number(original.weight) > 0) {
			add("weight", "weight", `rounding the material's ×${weightMultiplier} density projection to two decimals can collapse distinct authored weights`);
		}
		if (
			material?.price?.unit === "lb"
			&& Number.isFinite(Number(material.price.gp))
			&& Number(original.weight) > 0
			&& Number.isFinite(Number(original.value))
		) {
			add("value", "value", "the material price calculation rounds to whole copper pieces and can collapse distinct authored values");
		}

		const gemstoneDescriptor = getGemstoneDescriptor(legacyResolution.gemstone);
		const isGemChargeProjection = (
			gemstoneDescriptor?.resource?.key === "charges"
			&& Number.isFinite(Number(gemstoneDescriptor.resource.max))
		);
		if (isGemChargeProjection) {
			const observed = Number(original.charges);
			const maximum = Number(gemstoneDescriptor.resource.max);
			if (Number.isFinite(observed)) {
				const preimages = this._getProjectionPreimages({
					observed,
					candidates: Array.from({length: Math.max(maximum, observed, 0) + 1}, (_, ix) => ix),
					project: candidate => Math.max(candidate, maximum),
				});
				if (preimages.length > 1) {
					add(
						"charges",
						"charge maximum",
						`the projected value ${observed} may contain any authored maximum from 0 through ${maximum}`,
					);
				}
			}
		}
		if (isGemChargeProjection) {
			if (gemstoneDescriptor.resource.recharge && original.recharge === gemstoneDescriptor.resource.recharge) {
				add("recharge", "recharge schedule", "the gemstone overwrites the authored recharge schedule");
			}
			if (
				gemstoneDescriptor.resource.recovery
				&& original.rechargeAmount === `{@dice ${gemstoneDescriptor.resource.recovery}}`
			) {
				add("rechargeAmount", "recharge amount", "the gemstone overwrites the authored recharge amount");
			}
		}
		if (gemstoneDescriptor?.requiresAttunement && original.reqAttune === true) {
			add("reqAttune", "attunement requirement", "the gemstone maps both an authored requirement and no authored requirement to true");
		}

		const generatedEffects = [
			...upgradeEffects.tags.map(tag => ({type: "itemTag", tag})),
			...upgradeEffects.notes.map(note => ({type: "note", note})),
			...(gemstoneDescriptor?.effects || []),
		];
		if (generatedEffects.length) {
			add("effects", "effects", "composition effects are deduplicated against identical authored effects");
		}
		if (gemstoneDescriptor?.powers?.length) {
			add("itemPowers", "item powers", "gemstone powers are deduplicated against identical authored powers");
		}

		return out;
	}

	static _getDamageProjectionCandidates ({observed, materialDamageSteps}) {
		const parsed = _parseDamageDie(observed);
		if (!parsed) return [];

		const out = _DIE_ORDER.map(sides => _formatDamageDie({...parsed, sides}));
		if (!materialDamageSteps || parsed.modifier) return out;
		out.push(
			...CharacterSheetMaterials.DIE_LADDER,
			...Object.keys(CharacterSheetMaterials.DIE_EQUIVALENTS),
		);
		return [...new Set(out)];
	}

	static _getDamageProjectionPreimages ({observed, materialDamageSteps, upgradeDamageSteps}) {
		return this._getProjectionPreimages({
			observed,
			candidates: this._getDamageProjectionCandidates({observed, materialDamageSteps}),
			project: candidate => _increaseDamageDie(
				CharacterSheetMaterials.stepDamageDie(candidate, materialDamageSteps),
				upgradeDamageSteps,
			),
		});
	}

	static _getProjectionPreimages ({observed, candidates, project}) {
		return [...new Set(candidates)]
			.filter(candidate => _isEqual(project(candidate), observed));
	}

	static _getAuthoredItemFromMaterialized ({normalized, preset, legacyResolution, catalogs}) {
		const materialized = this.normalizeDraft({
			item: preset || {
				type: normalized.materialized.item?.type,
				weapon: normalized.materialized.item?.weapon,
				armor: normalized.materialized.item?.armor,
				shield: normalized.materialized.item?.shield,
			},
			preset: normalized.preset,
			material: normalized.materialized.material,
			upgrades: normalized.materialized.upgrades,
			gemstone: normalized.materialized.gemstone,
		});
		const projectedPreset = this.projectForPreview(materialized, catalogs);
		const original = normalized.materialized.item || {};
		const authored = _copy(normalized.item);
		const resetProps = new Set();

		for (const prop of new Set([...Object.keys(preset || {}), ...Object.keys(projectedPreset)])) {
			if (_isEqual(projectedPreset[prop], preset?.[prop])) continue;
			if (!_isEqual(original[prop], projectedPreset[prop])) continue;
			if (!_isEqual(authored[prop], original[prop])) continue;
			if (preset?.[prop] === undefined) delete authored[prop];
			else authored[prop] = _copy(preset[prop]);
			resetProps.add(prop);
		}

		authored.entries = (authored.entries || []).filter(entry => !(entry?.name || "").startsWith(_GENERATED_ENTRY_PREFIX));
		const oldMaterial = legacyResolution.material;
		const oldUpgrades = legacyResolution.upgrades.filter(Boolean);
		const oldUpgradeEffects = _getUpgradeEffects(oldUpgrades);
		const materialContext = {...original, material: normalized.materialized.material};
		const oldMaterialEffects = oldMaterial
			? CharacterSheetMaterials.getMaterialEffects(materialContext, oldMaterial)
			: null;
		const itemKind = CharacterSheetMaterials.getItemKind({...preset, ...original});

		const subtractNumeric = (prop, delta) => {
			if (!delta || resetProps.has(prop) || !Object.hasOwn(authored, prop)) return;
			const value = Number(authored[prop]);
			if (!Number.isFinite(value)) return;
			authored[prop] = value - delta;
		};
		subtractNumeric("bonusWeaponAttack", (oldMaterialEffects?.bonusWeaponAttack || 0) + oldUpgradeEffects.bonusWeaponAttack);
		subtractNumeric("bonusWeaponDamage", (oldMaterialEffects?.bonusWeaponDamage || 0) + oldUpgradeEffects.bonusWeaponDamage);
		subtractNumeric("bonusSpellAttack", oldUpgradeEffects.bonusSpellAttack);
		subtractNumeric("bonusSpellSaveDc", oldUpgradeEffects.bonusSpellSaveDc);
		subtractNumeric("acBonus", oldMaterialEffects?.bonusAc || 0);
		subtractNumeric("dexterityMax", oldMaterialEffects?.armorDexCapDelta || 0);
		if (
			oldMaterialEffects?.armorStrengthRequirementDelta
			&& !oldMaterialEffects.armorNoStrengthRequirement
		) subtractNumeric("strength", oldMaterialEffects.armorStrengthRequirementDelta);

		if (!resetProps.has("critThreshold") && Object.hasOwn(authored, "critThreshold")) {
			const value = Number(authored.critThreshold);
			const materialCritical = CharacterSheetMaterials.axisValue(oldMaterial?.critical) || 0;
			if (Number.isFinite(value)) authored.critThreshold = value + materialCritical + oldUpgradeEffects.critThresholdReduction;
		}

		for (const prop of ["dmg1", "dmg2"]) {
			if (resetProps.has(prop) || !authored[prop]) continue;
			const materialDamageSteps = itemKind === "weapon"
				? (CharacterSheetMaterials.axisValue(oldMaterial?.damage) || 0)
				: 0;
			const preimages = this._getDamageProjectionPreimages({
				observed: authored[prop],
				materialDamageSteps,
				upgradeDamageSteps: oldUpgradeEffects.damageDieIncrease,
			});
			if (preimages.length === 1) authored[prop] = preimages[0];
		}

		if (oldMaterial && oldMaterialEffects && !resetProps.has("property") && Array.isArray(authored.property)) {
			authored.property = this._deprojectMaterialProperties({
				current: authored.property,
				original: original.property,
				preset: preset?.property,
				projectedPreset: projectedPreset.property,
				effects: oldMaterialEffects,
			});
		}
		if (oldMaterialEffects?.rangeMultiplier && !resetProps.has("range") && authored.range != null) {
			authored.range = this._deprojectRange(authored.range, oldMaterialEffects.rangeMultiplier);
		}
		if (oldMaterial && !resetProps.has("weight") && authored.weight != null) {
			authored.weight = this._deprojectWeight(authored.weight, oldMaterial);
		}
		if (oldMaterial && !resetProps.has("value") && authored.value != null) {
			authored.value = this._deprojectValue(authored, oldMaterial);
		}

		authored.effects = _removeMatching(authored.effects, [
			...oldUpgradeEffects.tags.map(tag => ({type: "itemTag", tag})),
			...oldUpgradeEffects.notes.map(note => ({type: "note", note})),
		]);

		const oldGemstone = legacyResolution.gemstone;
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

	static _deprojectMaterialProperties ({current, original, preset, projectedPreset, effects}) {
		const getAbv = value => String(value).split("|")[0];
		const getWithout = (values, removals) => {
			const removalAbvs = new Set(removals.map(getAbv));
			return values.filter(it => !removalAbvs.has(getAbv(it)));
		};
		const add = (values, value) => {
			if (!values.some(it => getAbv(it) === getAbv(value))) values.push(_copy(value));
		};
		const candidates = [];
		const addCandidate = values => {
			if (!candidates.some(it => _isEqual(it, values))) candidates.push(values);
		};
		const base = getWithout([...(current || [])], effects.addProperties);
		for (const removed of effects.removeProperties) {
			const presetValue = (preset || []).find(it => getAbv(it) === removed);
			if (presetValue) add(base, presetValue);
		}

		for (const [source, target] of Object.entries(effects.propertyLadder || {})) {
			if (!base.some(it => getAbv(it) === target)) continue;
			const candidate = getWithout(base, [target]);
			if (source !== "_") add(candidate, (preset || []).find(it => getAbv(it) === source) || source);
			addCandidate(candidate);
		}
		addCandidate(base);

		const presetDiff = [...(preset || [])];
		for (const value of original || []) {
			if (!(projectedPreset || []).some(it => getAbv(it) === getAbv(value))) add(presetDiff, value);
		}
		for (const value of projectedPreset || []) {
			if ((original || []).some(it => getAbv(it) === getAbv(value))) continue;
			const ix = presetDiff.findIndex(it => getAbv(it) === getAbv(value));
			if (~ix) presetDiff.splice(ix, 1);
		}
		for (const value of current || []) {
			if (!(original || []).some(it => getAbv(it) === getAbv(value))) add(presetDiff, value);
		}
		for (const value of original || []) {
			if ((current || []).some(it => getAbv(it) === getAbv(value))) continue;
			const ix = presetDiff.findIndex(it => getAbv(it) === getAbv(value));
			if (~ix) presetDiff.splice(ix, 1);
		}
		addCandidate(presetDiff);

		return candidates.find(it => _isEqual(CharacterSheetMaterials._projectProperties(it, effects), current))
			|| _copy(current);
	}

	static _deprojectRange (range, multiplier) {
		const parts = String(range).split("/").map(it => Number(it.trim()));
		if (!multiplier || parts.some(it => !Number.isFinite(it))) return range;
		const candidate = parts.map(it => Math.ceil(it / multiplier)).join("/");
		return CharacterSheetMaterials._scaleRange(candidate, multiplier) === String(range) ? candidate : range;
	}

	static _deprojectWeight (weight, material) {
		const value = Number(weight);
		const multiplier = CharacterSheetMaterials.getWeightMultiplier(material);
		if (!Number.isFinite(value) || !multiplier) return weight;
		const candidate = Math.round((value / multiplier) * 100) / 100;
		return CharacterSheetMaterials.getEffectiveWeight({weight: candidate}, material) === value ? candidate : weight;
	}

	static _deprojectValue (authored, material) {
		const value = Number(authored.value);
		if (!Number.isFinite(value) || material?.price?.unit !== "lb" || !Number.isFinite(Number(material.price.gp))) return authored.value;
		const effectiveWeight = CharacterSheetMaterials.getEffectiveWeight({weight: authored.weight}, material);
		if (!Number.isFinite(effectiveWeight) || effectiveWeight <= 0) return authored.value;
		const candidate = value - Math.round(effectiveWeight * Number(material.price.gp) * 100);
		return CharacterSheetMaterials.getEffectiveValue({...authored, value: candidate}, material) === value ? candidate : authored.value;
	}
}
