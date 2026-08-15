const _copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const _key = value => String(value || "").trim().toLowerCase();
const _uid = value => value?.name ? `${_key(value.name)}|${_key(value.source)}` : "";
const _toTitleCase = value => value?.toTitleCase ? value.toTitleCase() : `${value[0].toUpperCase()}${value.slice(1)}`;

const _GEMSTONE_EFFECTS_TGTT = Object.freeze({
	alchemist: {summary: "+2 HP when drinking a potion of healing", effects: [{type: "healingPotionBonus", value: 2}]},
	mariner: {summary: "Host weapon ignores underwater attack disadvantage", effects: [{type: "removeDisadvantage", target: "attack", conditional: "underwater"}]},
	thief: {summary: "1/day: Reroll a failed Dexterity check", resource: {key: "uses", name: "Thief Gemstone", max: 1, recharge: "dawn"}},
	warrior: {summary: "Host weapon can't be disarmed while conscious", notes: ["Can't be disarmed of the host weapon while conscious."]},
	"arrow-catcher": {summary: "Reaction: Impose disadvantage on a ranged attack (3 charges; regain 1d3 at dawn)", resource: {key: "charges", name: "Arrow-Catcher Charges", max: 3, recharge: "dawn", recovery: "1d3"}},
	"bound armor": {summary: "Bonus action: Instantly don/doff or dismiss the host armor", powers: [{id: "bound-armor", name: "Bound Armor", actionType: "bonus", kind: "toggle"}]},
	"bound weapon": {summary: "Bonus action: Make the host weapon disappear or appear", powers: [{id: "bound-weapon", name: "Bound Weapon", actionType: "bonus", kind: "toggle"}]},
	cat: {summary: "1/dawn: Gain darkvision 120 ft. for 1 hour", resource: {key: "uses", name: "Cat Gemstone", max: 1, recharge: "dawn"}, effects: [{type: "sense", sense: "darkvision", value: 120, requiresRuntimeActive: true}]},
	chaos: {summary: "Critical hits with the host weapon trigger Wild Magic", trigger: {type: "criticalHit", outcome: "wildMagicSurge"}},
	daywalker: {summary: "Unaffected by sunlight while the hood is drawn", notes: ["Unaffected by sunlight while the host armor's hood is drawn."]},
	"elemental shield": {summary: "Reaction: Reduce chosen elemental damage by 2x level + CON; gain 1 exhaustion", choices: {damageType: ["acid", "cold", "fire", "lightning", "thunder"]}},
	featherfoot: {summary: "Standing jump distance equals walking speed", effects: [{type: "standingJumpEqualsWalk"}]},
	knock: {summary: "1/dawn: Cast Knock from the host armor", resource: {key: "uses", name: "Knock Gemstone", max: 1, recharge: "dawn"}, powers: [{id: "knock", name: "Knock", actionType: "action", kind: "spell", spellName: "Knock", spellSource: "PHB"}]},
	nondetection: {summary: "Hidden from divination magic and magical scrying", effects: [{type: "protection", protection: "divination"}]},
	serpent: {summary: "1/dawn on hit: CON save or poisoned for 1 minute", resource: {key: "uses", name: "Serpent Gemstone", max: 1, recharge: "dawn"}, trigger: {type: "onHit", outcome: "poisoned"}},
	bastion: {summary: "1/dawn: Bonus action creates a 10-ft force dome for 1 minute", resource: {key: "uses", name: "Bastion Charges", max: 1, recharge: "dawn"}, powers: [{id: "bastion", name: "Bastion Dome", actionType: "bonus", kind: "ability"}]},
	berserker: {summary: "1/dawn on hit: Spend Hit Dice for damage and equal self-damage", resource: {key: "uses", name: "Berserker Gemstone", max: 1, recharge: "dawn"}, trigger: {type: "onHit", outcome: "berserker"}},
	chalice: {summary: "Store and cast up to 2 spell levels", requiresAttunement: true, spellStorage: {capacity: 2}},
	death: {summary: "Humanoids killed by the host weapon rise as 1-HP zombies for 1 minute", trigger: {type: "kill", outcome: "zombie"}},
	hunt: {summary: "1/dawn: Mark a target, then teleport after a ranged host hit", resource: {key: "uses", name: "Hunt Gemstone", max: 1, recharge: "dawn"}},
	journey: {summary: "+10 speed; improved travel pace and halved food/water", effects: [{type: "speedBonus", speed: "walk", value: 10}]},
	magebane: {summary: "On hit: End spells using one of 3 charges", resource: {key: "charges", name: "Magebane Charges", max: 3, recharge: "dawn", recovery: "1d3"}, trigger: {type: "onHit", outcome: "dispel"}},
	phoenix: {summary: "1/dawn at 0 HP: Fireball, then regain 1d6 HP next turn", resource: {key: "uses", name: "Phoenix Gemstone", max: 1, recharge: "dawn"}, trigger: {type: "zeroHp", outcome: "phoenix"}},
	soultrap: {summary: "1/dawn after a qualifying kill: Regain a spell slot up to PB", resource: {key: "uses", name: "Soultrap Gemstone", max: 1, recharge: "dawn"}},
	superconductor: {summary: "Store charges up to PB spell levels; spend for +1d6 force each", resource: {key: "charges", name: "Superconductor Charges", max: "proficiency", recharge: "none", resetOnRest: true}, rider: {dicePerCharge: "1d6", damageType: "force"}},
	warmage: {summary: "Reroll failed concentration saves using one of 3 charges", resource: {key: "charges", name: "Warmage Charges", max: 3, recharge: "special"}},
	"blood weapon": {summary: "Critical hit: Regain HP equal to damage dealt (not constructs/undead)", trigger: {type: "criticalHit", outcome: "heal"}},
	displacement: {summary: "After weapon damage: Teleport 30 ft. once per turn", trigger: {type: "damaged", outcome: "teleport"}},
	dragonbane: {summary: "+2d6 host-weapon damage against dragons; STR save or flight 0", rider: {dice: "2d6", targetTypes: ["dragon"], damageType: "weapon"}},
	earthshaker: {summary: "1/dawn: Create a 1-round Earthquake effect", resource: {key: "uses", name: "Earthshaker Gemstone", max: 1, recharge: "dawn"}, powers: [{id: "earthshaker", name: "Earthshaker", actionType: "action", kind: "spell", spellName: "Earthquake", spellSource: "PHB"}]},
	"giant slayer": {summary: "+2d6 host-weapon damage against giants (Large or larger); STR save or prone", rider: {dice: "2d6", targetTypes: ["giant"], damageType: "weapon"}},
	"mark/recall": {summary: "1/dawn: Mark a location, then teleport there with up to five creatures", resource: {key: "uses", name: "Mark/Recall Gemstone", max: 1, recharge: "dawn"}},
	overshield: {summary: "Gain 8 temp HP at the start of each turn", effects: [{type: "turnStartTempHp", value: 8}]},
	retribution: {summary: "After taking damage, gain advantage on the next attack against that creature type", trigger: {type: "damaged", outcome: "retribution"}},
	wolfsbane: {summary: "Moonlight; +2d6 radiant against shapechangers and force true form", effects: [{type: "light", bright: 15, dim: 15}], rider: {dice: "2d6", targetTypes: ["shapechanger"], damageType: "radiant"}},
	"force of will": {summary: "Immune to enchantment magic unless you choose otherwise", effects: [{type: "protection", protection: "enchantment"}]},
	mime: {summary: "Copy a same-type magic item's non-fixed properties during a short rest", notes: ["Copied magic item properties require DM adjudication; artifacts and fixed bonuses can't be copied."]},
	tempest: {summary: "1/turn on hit: +1d10 lightning and arcs to up to 3 creatures", rider: {dice: "1d10", damageType: "lightning", perTurn: true, chainedTargetsMax: 3}},
	volant: {summary: "Hover flight speed equals twice walking speed", effects: [{type: "flightSpeedMultiplier", speed: "walk", value: 2, hover: true}]},
});

// Kept for compatibility with consumers which enumerate the original TGTT names.
export const GEMSTONE_EFFECT_REGISTRY = _GEMSTONE_EFFECTS_TGTT;

const _UPGRADE_EFFECT_DEFAULTS = Object.freeze({
	bonusWeaponAttack: 0,
	bonusWeaponDamage: 0,
	critThresholdReduction: 0,
	bonusSpellAttack: 0,
	bonusSpellSaveDc: 0,
	damageDieIncrease: 0,
	tags: [],
	notes: [],
	bonusDamageDice: null,
	bonusDamageType: null,
	effects: [],
	itemPowers: [],
	attachedSpells: [],
});

const _ARMOR_EFFECT_DEFAULTS = Object.freeze({
	muffled: false,
	reinforced: false,
	critDamageReduction: 0,
	armorProofingTier: 0,
	spiked: false,
	breathable: false,
	insulated: false,
	climbingHarness: false,
	lockingJoints: false,
	quickRelease: false,
	decorated: false,
	runic: false,
	burnished: false,
	camouflaged: false,
	formFitted: false,
});

let _itemUpgradeCatalog = [];

function _getEntryText (value) {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(_getEntryText).filter(Boolean).join(" ");
	if (!value || typeof value !== "object") return "";
	return _getEntryText(value.entries || value.entry || value.items);
}

function _getNumeric (value) {
	if (value == null || value === "") return 0;
	const out = Number(value);
	return Number.isFinite(out) ? out : 0;
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

function _findByRef (ref, catalog = _itemUpgradeCatalog) {
	if (!ref?.name) return null;
	const name = _key(ref.name);
	const source = _key(ref.source);
	const matches = (catalog || []).filter(it => _key(it?.name) === name);
	if (source) return matches.find(it => _key(it.source) === source) || null;
	return matches.length === 1 ? matches[0] : null;
}

function _getResolvedEntity (value, catalog) {
	if (!value?.name) return null;
	const resolved = _findByRef(value, catalog);
	if (resolved) return resolved;
	const hasEntityData = value.upgradeType?.length
		|| value.entries?.length
		|| value.effects?.length
		|| value.itemPowers?.length;
	return hasEntityData ? value : null;
}

function _isLegacySource (value, source) {
	const actual = _key(value?.source);
	return actual ? actual === _key(source) : true;
}

function _getBuiltInUpgradeDescriptor (upgrade) {
	if (!upgrade?.name || !_isLegacySource(upgrade, "TCAH")) return null;
	const name = _key(upgrade.name);
	const out = {};
	if (name === "balanced") out.bonusWeaponAttack = 1;
	if (name.startsWith("wounding:")) out.bonusWeaponDamage = 1;
	if (name.startsWith("critical:")) out.critThresholdReduction = 1;
	if (name === "superior") out.damageDieIncrease = 1;
	if (name === "masterwork") {
		out.bonusWeaponAttack = 1;
		out.bonusWeaponDamage = 1;
	}
	if (name === "enchanted") out.bonusSpellAttack = 1;
	if (name === "arcane") out.bonusSpellSaveDc = 1;
	if (["silvered", "magical", "runic"].includes(name)) out.tags = [_toTitleCase(name)];
	if (name === "saw-toothed") {
		out.bonusDamageDice = "1d4";
		out.bonusDamageType = "slashing";
		out.notes = ["Saw-toothed: +1d4 slashing damage (no effect vs constructs/undead)"];
	}
	if (name === "brutal") out.notes = ["Brutal: Reroll max damage dice and add to total (repeats if max rolled again)"];
	if (name === "flanged") out.notes = ["Flanged: On hit, target\u2019s medium/heavy armor takes cumulative \u22121 AC"];

	const armor = {};
	if (name === "muffled") armor.muffled = true;
	if (name === "reinforced") {
		armor.reinforced = true;
		armor.critDamageReduction = 3;
	}
	if (name === "spiked") armor.spiked = true;
	if (name === "breathable") armor.breathable = true;
	if (name === "insulated") armor.insulated = true;
	if (name === "climbing harness") armor.climbingHarness = true;
	if (name === "locking joints") armor.lockingJoints = true;
	if (name === "quick-release clasps") armor.quickRelease = true;
	if (name === "decorated") armor.decorated = true;
	if (name === "runic") armor.runic = true;
	if (name === "burnished") armor.burnished = true;
	if (name === "camouflaged") armor.camouflaged = true;
	if (name === "form fitted") armor.formFitted = true;
	if (name.startsWith("armor proofing")) {
		const tier = Number(name.match(/(\d)(?:st|nd|rd)/)?.[1]);
		if (tier) armor.armorProofingTier = tier;
	}
	if (Object.keys(armor).length) out.armor = armor;
	return Object.keys(out).length ? out : null;
}

function _getStructuredUpgradeDescriptor (entity) {
	if (!entity) return null;
	const out = {};
	for (const prop of [
		"bonusWeaponAttack",
		"bonusWeaponDamage",
		"bonusSpellAttack",
		"bonusSpellSaveDc",
		"critThresholdReduction",
		"damageDieIncrease",
	]) {
		if (entity[prop] != null) out[prop] = _getNumeric(entity[prop]);
	}
	if (entity.bonusWeapon != null) {
		out.bonusWeaponAttack = (out.bonusWeaponAttack || 0) + _getNumeric(entity.bonusWeapon);
		out.bonusWeaponDamage = (out.bonusWeaponDamage || 0) + _getNumeric(entity.bonusWeapon);
	}
	for (const prop of [
		"bonusAc",
		"bonusSavingThrow",
		"bonusAbilityCheck",
		"bonusProficiencyBonus",
		"bonusSavingThrowConcentration",
		"bonusSpellDamage",
	]) {
		if (entity[prop] != null) out[prop] = _getNumeric(entity[prop]);
	}
	if (entity.bonusDamageDice) out.bonusDamageDice = entity.bonusDamageDice;
	if (entity.bonusDamageType) out.bonusDamageType = entity.bonusDamageType;
	if (entity.tags?.length) out.tags = _copy(entity.tags);
	if (entity.notes?.length) out.notes = _copy(entity.notes);
	if (entity.effects?.length) out.effects = _copy(entity.effects);
	if (entity.itemPowers?.length) out.itemPowers = _copy(entity.itemPowers);
	if (entity.attachedSpells?.length) out.attachedSpells = _copy(entity.attachedSpells);
	for (const prop of ["charges", "recharge", "rechargeAmount", "reqAttune", "focus", "ability", "modifySpeed"]) {
		if (entity[prop] != null) out[prop] = _copy(entity[prop]);
	}
	return Object.keys(out).length ? out : null;
}

function _mergeUpgradeDescriptor (base, addition, {isNumericOverride = false} = {}) {
	const out = _copy(base || {});
	for (const prop of [
		"bonusWeaponAttack",
		"bonusWeaponDamage",
		"bonusSpellAttack",
		"bonusSpellSaveDc",
		"critThresholdReduction",
		"damageDieIncrease",
		"bonusAc",
		"bonusSavingThrow",
		"bonusAbilityCheck",
		"bonusProficiencyBonus",
		"bonusSavingThrowConcentration",
		"bonusSpellDamage",
	]) {
		if (!Object.hasOwn(addition || {}, prop)) continue;
		out[prop] = isNumericOverride
			? addition[prop]
			: (out[prop] || 0) + addition[prop];
	}
	for (const prop of ["tags", "notes", "effects", "itemPowers", "attachedSpells"]) {
		if (addition?.[prop]?.length) out[prop] = _mergeUnique(out[prop], addition[prop], it => prop === "itemPowers" ? (it.id || it.name) : JSON.stringify(it));
	}
	for (const prop of ["bonusDamageDice", "bonusDamageType", "charges", "recharge", "rechargeAmount", "reqAttune", "focus", "ability", "modifySpeed"]) {
		if (addition?.[prop] != null) out[prop] = _copy(addition[prop]);
	}
	if (addition?.armor) out.armor = {...(out.armor || {}), ..._copy(addition.armor)};
	return out;
}

function _getStructuredGemstoneDescriptor (entity) {
	if (!entity) return null;
	const structured = _getStructuredUpgradeDescriptor(entity) || {};
	const descriptor = {
		...structured,
		...(entity.gemstoneDescriptor || {}),
	};
	if (!descriptor.summary) {
		const text = _getEntryText(entity.entries).replace(/\{@\w+\s+([^}|]+)(?:\|[^}]*)?}/g, "$1").replace(/\s+/g, " ").trim();
		if (text) descriptor.summary = text.length > 180 ? `${text.slice(0, 177).trim()}...` : text;
	}
	if (entity.resource) descriptor.resource = _copy(entity.resource);
	if (entity.trigger) descriptor.trigger = _copy(entity.trigger);
	if (entity.rider) descriptor.rider = _copy(entity.rider);
	if (entity.choices) descriptor.choices = _copy(entity.choices);
	if (entity.spellStorage) descriptor.spellStorage = _copy(entity.spellStorage);
	if (entity.requiresAttunement != null) descriptor.requiresAttunement = !!entity.requiresAttunement;
	if (descriptor.itemPowers?.length && !descriptor.powers?.length) descriptor.powers = descriptor.itemPowers;
	delete descriptor.itemPowers;
	return Object.keys(descriptor).length ? descriptor : null;
}

export function setItemUpgradeCatalog (upgrades = []) {
	_itemUpgradeCatalog = _copy(upgrades || []);
}

export function resetItemUpgradeCatalog () {
	_itemUpgradeCatalog = [];
}

export function getItemUpgradeCatalog () {
	return _copy(_itemUpgradeCatalog);
}

export function isWeapon (item) {
	return !!(item?.weapon || ["M", "R"].includes(String(item?.type || "").split("|")[0]));
}

export function isArmor (item) {
	return !!(item?.armor || ["LA", "MA", "HA"].includes(String(item?.type || "").split("|")[0]));
}

export function isShield (item) {
	return !!(item?.shield || String(item?.type || "").split("|")[0] === "S");
}

export function isSocketable (item) {
	return isWeapon(item) || isArmor(item) || isShield(item);
}

function _isUpgradeTypeCompatible ({type, item}) {
	if (type.startsWith("GS:")) return false;
	if (type.startsWith("WU")) return isWeapon(item);
	if (type === "AU" || type.startsWith("AU:")) return isArmor(item) || isShield(item);
	return true;
}

export function getEligibleUpgrades ({item, upgrades = []}) {
	const applied = new Set((item?.appliedUpgrades || []).map(_uid));
	const appliedLegacyNames = new Set(
		(item?.appliedUpgrades || [])
			.filter(it => !it?.source)
			.map(it => _key(it?.name)),
	);
	return upgrades.filter(upgrade => {
		if (applied.has(_uid(upgrade)) || appliedLegacyNames.has(_key(upgrade?.name))) return false;
		const types = upgrade?.upgradeType || [];
		if (types.some(type => String(type).startsWith("GS:"))) return false;
		return !types.length || types.some(type => _isUpgradeTypeCompatible({type: String(type), item}));
	});
}

export function getUpgradeDescriptor (upgrade, {catalog = _itemUpgradeCatalog} = {}) {
	if (!upgrade?.name) return null;
	const entity = _getResolvedEntity(upgrade, catalog);
	const identity = entity || upgrade;
	const builtIn = _getBuiltInUpgradeDescriptor(identity);
	const structured = _getStructuredUpgradeDescriptor(entity);
	const descriptor = _mergeUpgradeDescriptor(builtIn, structured, {isNumericOverride: true});
	return Object.keys(descriptor).length ? descriptor : null;
}

export function getAggregatedUpgradeEffects (item, {catalog = _itemUpgradeCatalog} = {}) {
	let out = _copy(_UPGRADE_EFFECT_DEFAULTS);
	for (const upgrade of item?.appliedUpgrades || []) {
		out = _mergeUpgradeDescriptor(out, getUpgradeDescriptor(upgrade, {catalog}));
	}
	return out;
}

export function getAggregatedArmorUpgradeEffects (item, {catalog = _itemUpgradeCatalog} = {}) {
	const out = _copy(_ARMOR_EFFECT_DEFAULTS);
	for (const upgrade of item?.appliedUpgrades || []) {
		const descriptor = getUpgradeDescriptor(upgrade, {catalog});
		if (!descriptor?.armor) continue;
		for (const [prop, value] of Object.entries(descriptor.armor)) {
			if (prop === "armorProofingTier") out[prop] = Math.max(out[prop], Number(value) || 0);
			else if (prop === "critDamageReduction") out[prop] = Math.max(out[prop], Number(value) || 0);
			else out[prop] ||= !!value;
		}
	}
	return out;
}

export function getGemstoneDescriptor (gem, {catalog = _itemUpgradeCatalog} = {}) {
	if (!gem?.name && typeof gem !== "string") return null;
	const ref = typeof gem === "string" ? {name: gem} : gem;
	const entity = _getResolvedEntity(ref, catalog);
	const identity = entity || ref;
	const source = _key(identity.source);
	const builtIn = (!source || source === "tgtt") ? _GEMSTONE_EFFECTS_TGTT[_key(identity.name)] : null;
	const structured = _getStructuredGemstoneDescriptor(entity);
	if (!builtIn && !structured) return null;
	const out = {..._copy(builtIn || {}), ..._copy(structured || {})};
	for (const prop of ["effects", "powers", "notes"]) {
		if (builtIn?.[prop]?.length || structured?.[prop]?.length) out[prop] = _mergeUnique(builtIn?.[prop], structured?.[prop], it => prop === "powers" ? (it.id || it.name) : JSON.stringify(it));
	}
	return out;
}

export function getGemstoneRegistryNames () {
	return Object.keys(_GEMSTONE_EFFECTS_TGTT);
}
