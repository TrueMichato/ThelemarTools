/**
 * @typedef {{type: "base"} | {type: "cr" | "summonSpellLevel" | "summonClassLevel", value: string | number}} BestiaryQuickActionsScaleContext
 * @typedef {{set?: Record<string, *>, remove?: string[]}} BestiaryQuickActionsPatch
 * @typedef {{id?: string, type: string, data: object}} BestiaryQuickActionsOperation
 */

const _OPERATION_TYPES = Object.freeze({
	MINION: "minion",
	APPLY_AREA_TRAIT: "applyAreaTrait",
	ADD_ENTRY: "addEntry",
	REMOVE_ENTRY: "removeEntry",
	SET_LEGENDARY_GROUP: "setLegendaryGroup",
	APPLY_ITEM: "applyItem",
	PATCH: "patch",
});

const _SCALE_TYPES = Object.freeze({
	BASE: "base",
	CR: "cr",
	SUMMON_SPELL_LEVEL: "summonSpellLevel",
	SUMMON_CLASS_LEVEL: "summonClassLevel",
});

const _ENTRY_SECTIONS = new Set([
	"trait",
	"action",
	"bonus",
	"reaction",
	"legendary",
	"mythic",
	"spellcasting",
]);

const _UNSAFE_PATH_PARTS = new Set(["__proto__", "prototype", "constructor"]);
const _SYM_PB_TEMPLATE = Symbol("bestiaryQuickActionsPbTemplate");
const _SYM_DEFERRED_EFFECTS = Symbol("bestiaryQuickActionsDeferredEffects");

const _MINION_STATS = Object.freeze({
	"0": {hp: 4, damage: 1, proficiencyBonus: 2, xp: 2},
	"1/8": {hp: 5, damage: 1, proficiencyBonus: 2, xp: 5},
	"1/4": {hp: 6, damage: 1, proficiencyBonus: 2, xp: 10},
	"1/2": {hp: 7, damage: 1, proficiencyBonus: 2, xp: 20},
	"1": {hp: 8, damage: 1, proficiencyBonus: 2, xp: 40},
	"2": {hp: 9, damage: 2, proficiencyBonus: 2, xp: 90},
	"3": {hp: 10, damage: 3, proficiencyBonus: 2, xp: 140},
	"4": {hp: 11, damage: 4, proficiencyBonus: 2, xp: 220},
	"5": {hp: 12, damage: 4, proficiencyBonus: 3, xp: 225},
	"6": {hp: 13, damage: 4, proficiencyBonus: 3, xp: 285},
	"7": {hp: 14, damage: 4, proficiencyBonus: 3, xp: 360},
	"8": {hp: 15, damage: 5, proficiencyBonus: 3, xp: 485},
	"9": {hp: 16, damage: 5, proficiencyBonus: 4, xp: 500},
	"10": {hp: 17, damage: 5, proficiencyBonus: 4, xp: 590},
	"11": {hp: 18, damage: 6, proficiencyBonus: 4, xp: 720},
	"12": {hp: 19, damage: 6, proficiencyBonus: 4, xp: 840},
	"13": {hp: 20, damage: 7, proficiencyBonus: 4, xp: 1000},
	"14": {hp: 21, damage: 7, proficiencyBonus: 4, xp: 1150},
	"15": {hp: 22, damage: 8, proficiencyBonus: 5, xp: 1300},
	"16": {hp: 23, damage: 8, proficiencyBonus: 5, xp: 1500},
	"17": {hp: 24, damage: 9, proficiencyBonus: 6, xp: 1800},
	"18": {hp: 25, damage: 9, proficiencyBonus: 6, xp: 2000},
	"19": {hp: 26, damage: 10, proficiencyBonus: 6, xp: 2200},
	"20": {hp: 27, damage: 10, proficiencyBonus: 6, xp: 2500},
	"21": {hp: 28, damage: 11, proficiencyBonus: 7, xp: 3300},
	"22": {hp: 29, damage: 11, proficiencyBonus: 7, xp: 4100},
	"23": {hp: 30, damage: 12, proficiencyBonus: 7, xp: 5000},
	"24": {hp: 31, damage: 12, proficiencyBonus: 7, xp: 6200},
	"25": {hp: 32, damage: 13, proficiencyBonus: 8, xp: 7500},
	"26": {hp: 33, damage: 13, proficiencyBonus: 8, xp: 9000},
	"27": {hp: 34, damage: 14, proficiencyBonus: 8, xp: 10500},
	"28": {hp: 35, damage: 14, proficiencyBonus: 8, xp: 12000},
	"29": {hp: 36, damage: 15, proficiencyBonus: 9, xp: 13500},
	"30": {hp: 37, damage: 15, proficiencyBonus: 9, xp: 15500},
});

const _MINION_TRAIT = Object.freeze({
	name: "Minion",
	entries: [
		"If the minion takes damage from an attack or as the result of a failed saving throw, their hit points are reduced to 0. If the minion takes damage from another effect, they die if the damage equals or exceeds their hit point maximum; otherwise they take no damage.",
	],
});

const _RE_DAMAGE = /(?:(\d+)\s*\(\s*)?\{@damage\s+([^}|]+)(?:\|[^}]*)?}(?:\s*\))?/gi;
const _RE_CONDITIONAL_DAMAGE = /(?:^|[.;]\s+|\b)(?:if|when|while|provided|on a (?:hit|miss|failed|successful))\b/i;

function _clone (value, seen = new WeakMap()) {
	if (value == null || typeof value !== "object") return value;
	if (seen.has(value)) return seen.get(value);
	if (value instanceof Date) return new Date(value.getTime());

	const out = Array.isArray(value)
		? []
		: {};
	seen.set(value, out);
	Reflect.ownKeys(value).forEach(key => out[key] = _clone(value[key], seen));
	return out;
}

function _getCr (creature) {
	const cr = typeof creature?.cr === "object"
		? creature.cr?.cr
		: creature?.cr;
	return cr == null
		? null
		: `${cr}`.trim();
}

function _getPathParts (path) {
	if (typeof path !== "string" || !path.trim()) throw new BestiaryQuickActionsValidationError("Patch paths must be non-empty strings.");
	const parts = path.split(".");
	if (parts.some(part => !part || _UNSAFE_PATH_PARTS.has(part))) {
		throw new BestiaryQuickActionsValidationError(`Unsafe or invalid patch path "${path}".`);
	}
	return parts;
}

function _setPath (target, path, value) {
	const parts = _getPathParts(path);
	let parent = target;
	parts.slice(0, -1).forEach(part => {
		if (parent[part] == null || typeof parent[part] !== "object") parent[part] = {};
		parent = parent[part];
	});
	parent[parts.at(-1)] = _clone(value);
}

function _removePath (target, path) {
	const parts = _getPathParts(path);
	let parent = target;
	for (const part of parts.slice(0, -1)) {
		if (parent?.[part] == null || typeof parent[part] !== "object") return;
		parent = parent[part];
	}
	delete parent[parts.at(-1)];
}

function _applyPatch (creature, patch = {}) {
	if (patch == null || typeof patch !== "object" || Array.isArray(patch)) {
		throw new BestiaryQuickActionsValidationError("A structured patch must be an object.");
	}
	if (!Object.hasOwn(patch, "set") && !Object.hasOwn(patch, "remove")) patch = {set: patch};
	if (patch.set != null && (typeof patch.set !== "object" || Array.isArray(patch.set))) {
		throw new BestiaryQuickActionsValidationError("Patch 'set' must be an object keyed by field path.");
	}
	if (patch.remove != null && !Array.isArray(patch.remove)) {
		throw new BestiaryQuickActionsValidationError("Patch 'remove' must be an array of field paths.");
	}

	Object.entries(patch.set || {}).forEach(([path, value]) => _setPath(creature, path, value));
	(patch.remove || []).forEach(path => _removePath(creature, path));
}

function _walkStrings (value, fnString) {
	if (typeof value === "string") return fnString(value);
	if (Array.isArray(value)) return value.map(it => _walkStrings(it, fnString));
	if (value == null || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, _walkStrings(child, fnString)]));
}

function _getDiceAverage (expression) {
	const clean = `${expression}`.replace(/\s+/g, "");
	if (!/^[+\-]?(?:\d*d\d+|\d+)(?:[+\-](?:\d*d\d+|\d+))*$/i.test(clean)) return null;

	let total = 0;
	const terms = clean.match(/[+\-]?(?:\d*d\d+|\d+)/gi) || [];
	for (const term of terms) {
		const sign = term.startsWith("-") ? -1 : 1;
		const unsigned = term.replace(/^[+\-]/, "");
		const matchDice = /^(?<count>\d*)d(?<faces>\d+)$/i.exec(unsigned);
		total += sign * (matchDice
			? Number(matchDice.groups.count || 1) * (Number(matchDice.groups.faces) + 1) / 2
			: Number(unsigned));
	}
	return total > 0 && Number.isFinite(total)
		? total
		: null;
}

function _isConditionalDamagePacket ({string, start, end}) {
	const boundaries = [",", ";", "."];
	const previous = Math.max(...boundaries.map(char => string.lastIndexOf(char, start - 1)));
	const nextCandidates = boundaries.map(char => string.indexOf(char, end)).filter(ix => ~ix);
	const next = nextCandidates.length ? Math.min(...nextCandidates) : string.length;
	const clause = string.slice(previous + 1, next);
	if (_RE_CONDITIONAL_DAMAGE.test(clause)) return true;

	const previousPrevious = Math.max(...boundaries.map(char => string.lastIndexOf(char, previous - 1)));
	const previousClause = string.slice(previousPrevious + 1, previous);
	const packetPrefix = string.slice(previous + 1, start);
	return _RE_CONDITIONAL_DAMAGE.test(previousClause)
		&& /\b(?:it|they|the target|the creature)\b.*\btakes?\b/i.test(packetPrefix);
}

function _convertAttackAction ({action}) {
	const out = _clone(action);
	if (!/\(Group Attack\)\s*$/i.test(out.name || "")) out.name = `${out.name || "Attack"} (Group Attack)`;

	out.entries = _walkStrings(out.entries || [], string => {
		const hitIndex = string.search(/\{@h}/i);
		return string.replace(new RegExp(_RE_DAMAGE.source, _RE_DAMAGE.flags), (fullMatch, printedAverage, expression, offset) => {
			const average = printedAverage == null ? _getDiceAverage(expression) : Number(printedAverage);
			if (
				hitIndex < 0
				|| offset < hitIndex
				|| average == null
				|| _isConditionalDamagePacket({string, start: offset, end: offset + fullMatch.length})
			) return fullMatch;
			return `${Math.floor(average)}`;
		});
	});
	return out;
}

function _getSimpleArrayValue (value) {
	return typeof value === "string"
		? value.toLowerCase()
		: null;
}

function _addSimpleArrayValues (creature, prop, values) {
	const out = Array.isArray(creature[prop]) ? creature[prop] : [];
	const existing = new Set(out.map(_getSimpleArrayValue).filter(Boolean));
	values.forEach(value => {
		const normalized = `${value}`.toLowerCase();
		if (existing.has(normalized)) return;
		existing.add(normalized);
		out.push(value);
	});
	creature[prop] = out;
}

function _removeSimpleArrayValue (creature, prop, value) {
	if (!Array.isArray(creature[prop])) return false;
	const normalized = `${value}`.toLowerCase();
	let isRemoved = false;
	const recurse = current => {
		if (typeof current === "string") {
			if (current.toLowerCase() !== normalized) return current;
			isRemoved = true;
			return null;
		}
		if (Array.isArray(current)) return current.map(recurse).filter(it => it != null);
		if (current == null || typeof current !== "object") return current;
		const out = _clone(current);
		for (const key of ["resist", "immune", "vulnerable"]) {
			if (!Array.isArray(out[key])) continue;
			out[key] = recurse(out[key]);
			if (!out[key].length) return null;
		}
		return out;
	};
	creature[prop] = recurse(creature[prop]);
	return isRemoved;
}

function _applyDefenseEffect (creature, effect) {
	const values = effect.values || [];
	if (effect.upgradeToImmunity) {
		values.forEach(value => {
			if (_removeSimpleArrayValue(creature, "resist", value)) _addSimpleArrayValues(creature, "immune", [value]);
			else if (!(creature.immune || []).some(it => _getSimpleArrayValue(it) === `${value}`.toLowerCase())) {
				_addSimpleArrayValues(creature, effect.prop || "resist", [value]);
			}
		});
		return;
	}
	_addSimpleArrayValues(creature, effect.prop, values);
}

function _applySizeHitDiceEffect (creature, effect) {
	const sizes = Array.isArray(creature.size) ? creature.size : [];
	if (!sizes.some(size => (effect.from || []).includes(size))) return;
	creature.size = [effect.to];

	const formula = creature.hp?.formula;
	const match = formula && /(?<count>\d+)d(?<faces>\d+)/i.exec(formula);
	if (!match) return;
	const count = Number(match.groups.count);
	const faces = Number(match.groups.faces);
	if (!Number.isFinite(count) || !Number.isFinite(faces) || faces >= effect.dieFaces) return;
	creature.hp = {
		...creature.hp,
		average: Number.isFinite(Number(creature.hp.average))
			? Number(creature.hp.average) + count * (effect.dieFaces - faces) / 2
			: creature.hp.average,
		formula: formula.replace(match[0], `${count}d${effect.dieFaces}`),
	};
}

function _applyAreaEffect (creature, effect) {
	switch (effect.type) {
		case "defense": return _applyDefenseEffect(creature, effect);
		case "conditionImmune": return _addSimpleArrayValues(creature, "conditionImmune", effect.values || []);
		case "speed": {
			const speed = typeof creature.speed === "number"
				? {walk: creature.speed}
				: _clone(creature.speed || {});
			speed[effect.mode] = effect.equalTo
				? _clone(speed[effect.equalTo])
				: _clone(effect.value);
			creature.speed = speed;
			return;
		}
		case "sense": return _addSimpleArrayValues(creature, "senses", [effect.value]);
		case "sizeHitDice": return _applySizeHitDiceEffect(creature, effect);
		case "addEntry": return _applyOperation(creature, BestiaryQuickActionsOperations.addEntry(effect));
		case "augmentMeleeDamage":
			creature[_SYM_DEFERRED_EFFECTS] ||= [];
			creature[_SYM_DEFERRED_EFFECTS].push(_clone(effect));
			return;
		default: throw new BestiaryQuickActionsValidationError(`Unknown area-trait effect type "${effect.type}".`);
	}
}

function _mergeSpecialEquipment (creature, item) {
	if (!item?.name || !item?.source) return;
	const itemTag = `{@item ${item.name}|${item.source}}`;
	const traits = Array.isArray(creature.trait) ? creature.trait : [];
	let specialEquipment = traits.find(entry => `${entry?.name || ""}`.toLowerCase() === "special equipment");
	if (!specialEquipment) {
		specialEquipment = {name: "Special Equipment", entries: []};
		traits.unshift(specialEquipment);
	}
	specialEquipment.entries = Array.isArray(specialEquipment.entries) ? specialEquipment.entries : [];
	if (!JSON.stringify(specialEquipment.entries).includes(itemTag)) {
		specialEquipment.entries.push(`The creature carries and can use ${itemTag}.`);
	}
	creature.trait = traits;
}

function _getSpeedNumber (speed) {
	if (typeof speed === "number") return speed;
	if (speed && typeof speed === "object") return Number(speed.number) || 0;
	return Number(speed) || 0;
}

function _getSpecialAcWithBonus ({special, bonus, item = null}) {
	const suffix = `${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`;
	return `${special} ${suffix}${item ? ` ({@item ${item.name}|${item.source}})` : ""}`;
}

function _applyItemEffects (creature, item, effects) {
	if (!effects) return;
	const {isConditional = false, conditionLabel = item?.name} = effects;
	const condition = `while using {@item ${item.name}|${item.source}|${conditionLabel}}`;
	const itemType = `${effects.itemType || ""}`.split("|")[0];
	const acBonus = effects.bonusAc != null
		? Number(effects.bonusAc) || 0
		: itemType === "S"
			? Number(effects.ac) || 0
			: 0;
	if (acBonus) {
		const ac = _clone(creature.ac || []);
		const acFirst = ac[0];
		const baseAc = typeof acFirst === "number" ? acFirst : Number(acFirst?.ac);
		if (Number.isFinite(baseAc)) {
			if (isConditional) ac.push({ac: baseAc + acBonus, condition});
			else if (typeof acFirst === "number") ac[0] += acBonus;
			else ac[0] = {...acFirst, ac: baseAc + acBonus};
		} else if (acFirst?.special) {
			if (isConditional) ac.push({
				special: `${_getSpecialAcWithBonus({special: acFirst.special, bonus: acBonus})} (${condition})`,
			});
			else ac[0] = {
				...acFirst,
				special: _getSpecialAcWithBonus({special: acFirst.special, bonus: acBonus, item}),
			};
		} else {
			throw new BestiaryQuickActionsValidationError(`${item.name} has an AC bonus, but this creature has no numeric or formula-based AC to modify.`);
		}
		creature.ac = ac;
	} else if (!isConditional && effects.ac != null && ["LA", "MA", "HA"].includes(itemType)) {
		const ac = _clone(creature.ac || []);
		if (typeof ac[0] === "number") ac[0] = Number(effects.ac);
		else ac[0] = {...ac[0], ac: Number(effects.ac)};
		creature.ac = ac;
	}

	if (!isConditional) {
		Object.assign(creature, _clone(effects.abilityStatic || {}));
		Object.entries(effects.abilityBonus || {}).forEach(([ability, bonus]) => {
			creature[ability] = (Number(creature[ability]) || 0) + (Number(bonus) || 0);
		});
	}

	if (!effects.modifySpeed) return;
	const speed = typeof creature.speed === "number" ? {walk: creature.speed} : _clone(creature.speed || {});
	const modified = _clone(speed);
	const getModes = () => Object.keys(modified).filter(key => !["alternate", "canHover"].includes(key));
	const expandModes = mode => mode === "*" ? getModes() : [mode];
	const setSpeedNumber = (mode, value) => {
		modified[mode] = modified[mode] && typeof modified[mode] === "object"
			? {...modified[mode], number: value}
			: value;
	};
	Object.entries(effects.modifySpeed.static || {}).forEach(([mode, value]) => expandModes(mode).forEach(it => setSpeedNumber(it, Number(value))));
	Object.entries(effects.modifySpeed.equal || {}).forEach(([mode, sourceMode]) => expandModes(mode).forEach(it => setSpeedNumber(it, _getSpeedNumber(modified[sourceMode]))));
	Object.entries(effects.modifySpeed.bonus || {}).forEach(([mode, value]) => expandModes(mode).forEach(it => setSpeedNumber(it, _getSpeedNumber(modified[it]) + Number(value))));
	Object.entries(effects.modifySpeed.multiply || {}).forEach(([mode, value]) => expandModes(mode).forEach(it => setSpeedNumber(it, _getSpeedNumber(modified[it]) * Number(value))));
	if (!isConditional) {
		creature.speed = modified;
		return;
	}
	getModes().forEach(mode => {
		const value = _getSpeedNumber(modified[mode]);
		if (value === _getSpeedNumber(speed[mode])) return;
		speed.alternate ||= {};
		speed.alternate[mode] ||= [];
		speed.alternate[mode].push({number: value, condition});
	});
	creature.speed = speed;
}

function _getProficiencyBonus (creature) {
	const explicit = Number(creature?.profBonus);
	if (Number.isFinite(explicit)) return explicit;
	const cr = _getCr(creature);
	return _MINION_STATS[cr]?.proficiencyBonus ?? null;
}

function _resolveProficiencyString (string, proficiencyBonus) {
	if (!Number.isFinite(proficiencyBonus)) return string;
	return string
		.replace(/\{@dc\s+(\d+)\s+plus\s+PB(?:\|[^}]*)?}/gi, (...match) => `{@dc ${Number(match[1]) + proficiencyBonus}}`)
		.replace(/\bDC\s+(\d+)\s+plus\s+PB\b/gi, (...match) => `{@dc ${Number(match[1]) + proficiencyBonus}}`)
		.replace(/\{@damage\s+PBd(\d+)(\|[^}]*)?}/gi, (...match) => `{@damage ${proficiencyBonus}d${match[1]}${match[2] || ""}}`)
		.replace(/\{@damage\s+PB(\|[^}]*)?}/gi, (...match) => `{@damage ${proficiencyBonus}${match[1] || ""}}`)
		.replace(/\b(\d+)\s*[×x*]\s*PB\b/gi, (...match) => `${Number(match[1]) * proficiencyBonus}`)
		.replace(/\+PB\b/gi, `+${proficiencyBonus}`)
		.replace(/\bPBd(\d+)\b/gi, `${proficiencyBonus}d$1`)
		.replace(/\bPB\b/gi, `${proficiencyBonus}`);
}

function _resolveMarkedProficiencyTemplates (value, proficiencyBonus) {
	if (Array.isArray(value)) return value.map(it => _resolveMarkedProficiencyTemplates(it, proficiencyBonus));
	if (value == null || typeof value !== "object") return value;
	if (value[_SYM_PB_TEMPLATE]) return _walkStrings(value, string => _resolveProficiencyString(string, proficiencyBonus));
	return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, _resolveMarkedProficiencyTemplates(child, proficiencyBonus)]));
}

function _applyDeferredEffects (creature, proficiencyBonus) {
	(creature[_SYM_DEFERRED_EFFECTS] || []).forEach(effect => {
		if (effect.type !== "augmentMeleeDamage") return;
		(creature.action || []).forEach(action => {
			const text = JSON.stringify(action.entries || []);
			if (!/\{@atk\s+(?:m[ws]|mw,rw)\b/i.test(text)) return;
			const suffix = _resolveProficiencyString(effect.text, proficiencyBonus);
			action.entries = _walkStrings(action.entries || [], string => {
				if (!/\{@atk\s+(?:m[ws]|mw,rw)\b/i.test(string)) return string;
				return `${string} ${suffix}`;
			});
		});
	});
	delete creature[_SYM_DEFERRED_EFFECTS];
}

function _addMinionTypeTag (creature) {
	const type = typeof creature.type === "string"
		? {type: creature.type}
		: _clone(creature.type || {});
	const tags = Array.isArray(type.tags) ? type.tags : [];
	const hasMinion = tags.some(tag => `${typeof tag === "object" ? tag.tag : tag}`.toLowerCase() === "minion");
	type.tags = hasMinion
		? tags
		: [...tags, "Minion"];
	creature.type = type;
}

function _getScaleContext ({creature, scaleContext}) {
	if (scaleContext == null) {
		if (creature?._isScaledCr && creature?._scaledCr != null) return {type: _SCALE_TYPES.CR, value: creature._scaledCr};
		if (creature?._summonedBySpell_level != null) return {type: _SCALE_TYPES.SUMMON_SPELL_LEVEL, value: creature._summonedBySpell_level};
		if (creature?._summonedByClass_level != null) return {type: _SCALE_TYPES.SUMMON_CLASS_LEVEL, value: creature._summonedByClass_level};
		return {type: _SCALE_TYPES.BASE};
	}
	if (scaleContext === _SCALE_TYPES.BASE || scaleContext?.type === _SCALE_TYPES.BASE) return {type: _SCALE_TYPES.BASE};
	if (typeof scaleContext !== "object") throw new BestiaryQuickActionsValidationError("Scale context must be an object or 'base'.");

	const typeAliases = {
		scaledCr: _SCALE_TYPES.CR,
		spell: _SCALE_TYPES.SUMMON_SPELL_LEVEL,
		class: _SCALE_TYPES.SUMMON_CLASS_LEVEL,
	};
	const type = typeAliases[scaleContext.type] || scaleContext.type;
	if (!Object.values(_SCALE_TYPES).includes(type) || type === _SCALE_TYPES.BASE) {
		throw new BestiaryQuickActionsValidationError(`Unknown scale context type "${scaleContext.type}".`);
	}
	const value = scaleContext.value
		?? scaleContext.cr
		?? scaleContext.level;
	if (value == null || `${value}`.trim() === "") throw new BestiaryQuickActionsValidationError(`Scale context "${type}" requires a value.`);
	return {type, value};
}

function _validateEntrySection (section) {
	if (!_ENTRY_SECTIONS.has(section)) throw new BestiaryQuickActionsValidationError(`Unsupported statblock entry section "${section}".`);
}

function _applyOperation (creature, operation) {
	switch (operation.type) {
		case _OPERATION_TYPES.MINION: return BestiaryQuickActionsMinion.convert(creature);
		case _OPERATION_TYPES.APPLY_AREA_TRAIT: {
			const {entry, effects = []} = operation.data || {};
			if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
				throw new BestiaryQuickActionsValidationError("Area-trait operations require a statblock entry.");
			}
			effects.forEach(effect => _applyAreaEffect(creature, effect));
			const entryResolved = _clone(entry);
			entryResolved[_SYM_PB_TEMPLATE] = true;
			return _applyOperation(creature, BestiaryQuickActionsOperations.addEntry({section: "trait", entry: entryResolved}));
		}
		case _OPERATION_TYPES.ADD_ENTRY: {
			const {section, entry, index} = operation.data || {
				section: operation.section || operation.prop,
				entry: operation.entry,
				index: operation.index,
			};
			_validateEntrySection(section);
			if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
				throw new BestiaryQuickActionsValidationError("Added statblock entries must be objects.");
			}
			const entries = Array.isArray(creature[section]) ? creature[section] : [];
			const insertAt = index == null
				? entries.length
				: Math.max(0, Math.min(Number(index), entries.length));
			entries.splice(insertAt, 0, _clone(entry));
			creature[section] = entries;
			return creature;
		}
		case _OPERATION_TYPES.REMOVE_ENTRY: {
			const {section, index, name, source} = operation.data || operation;
			_validateEntrySection(section);
			const entries = Array.isArray(creature[section]) ? creature[section] : [];
			if (index != null) entries.splice(Number(index), 1);
			else {
				if (!name) throw new BestiaryQuickActionsValidationError("Remove-entry operations require an index or name.");
				const lowerName = `${name}`.toLowerCase();
				const lowerSource = source == null ? null : `${source}`.toLowerCase();
				const foundIndex = entries.findIndex(entry =>
					`${entry?.name || ""}`.toLowerCase() === lowerName
					&& (lowerSource == null || `${entry?.source || ""}`.toLowerCase() === lowerSource));
				if (~foundIndex) entries.splice(foundIndex, 1);
			}
			creature[section] = entries;
			return creature;
		}
		case _OPERATION_TYPES.SET_LEGENDARY_GROUP:
			if ((operation.data?.legendaryGroup ?? operation.legendaryGroup) == null) delete creature.legendaryGroup;
			else {
				creature.legendaryGroup = _clone(operation.data?.legendaryGroup ?? operation.legendaryGroup);
				if (creature.legendaryGroup.lairActions) creature.legendaryGroup[_SYM_PB_TEMPLATE] = true;
			}
			return creature;
		case _OPERATION_TYPES.APPLY_ITEM:
			_applyPatch(creature, operation.data.patch);
			_applyItemEffects(creature, operation.data.item, operation.data.effects);
			_mergeSpecialEquipment(creature, operation.data.item);
			(operation.data.entries || []).forEach(({section, entry, index}) => {
				_applyOperation(creature, BestiaryQuickActionsOperations.addEntry({section, entry, index}));
			});
			return creature;
		case _OPERATION_TYPES.PATCH:
			_applyPatch(creature, operation.data?.patch ?? operation.patch);
			return creature;
		default: throw new BestiaryQuickActionsValidationError(`Unknown Bestiary Quick Actions operation type "${operation.type}".`);
	}
}

export class BestiaryQuickActionsValidationError extends Error {
	constructor (message, {code = "BESTIARY_QUICK_ACTIONS_INVALID"} = {}) {
		super(message);
		this.name = "BestiaryQuickActionsValidationError";
		this.code = code;
	}
}

export const BestiaryQuickActionsOperationTypes = _OPERATION_TYPES;
export const BestiaryQuickActionsScaleTypes = _SCALE_TYPES;

export class BestiaryQuickActionsOperations {
	static minion () {
		return {type: _OPERATION_TYPES.MINION, data: {}};
	}

	static applyAreaTrait ({trait, area, entry, effects = [], choices = {}}) {
		return {
			type: _OPERATION_TYPES.APPLY_AREA_TRAIT,
			data: {
				trait: trait && {name: trait.name, source: trait.source},
				area,
				entry: _clone(entry),
				effects: _clone(effects),
				choices: _clone(choices),
			},
		};
	}

	static addEntry ({section, entry, index = null}) {
		return {type: _OPERATION_TYPES.ADD_ENTRY, data: {section, entry: _clone(entry), index}};
	}

	static removeEntry ({section, index = null, name = null, source = null}) {
		return {type: _OPERATION_TYPES.REMOVE_ENTRY, data: {section, index, name, source}};
	}

	static setLegendaryGroup (legendaryGroup) {
		return {type: _OPERATION_TYPES.SET_LEGENDARY_GROUP, data: {legendaryGroup: _clone(legendaryGroup)}};
	}

	static applyItem ({item = null, patch = {}, fieldChanges = null, entries = [], effects = null}) {
		const normalizedPatch = fieldChanges == null
			? patch
			: {...patch, set: {...patch.set, ...fieldChanges}};
		return {
			type: _OPERATION_TYPES.APPLY_ITEM,
			data: {
				item: item && {name: item.name, source: item.source},
				patch: _clone(normalizedPatch),
				entries: _clone(entries),
				effects: _clone(effects),
			},
		};
	}

	static patch (patch) {
		return {type: _OPERATION_TYPES.PATCH, data: {patch: _clone(patch)}};
	}
}

export class BestiaryQuickActionsMinion {
	static getStats (cr) {
		const normalizedCr = cr == null
			? null
			: `${cr}`.trim();
		return _MINION_STATS[normalizedCr]
			? _clone(_MINION_STATS[normalizedCr])
			: null;
	}

	static validate (creature) {
		const cr = _getCr(creature);
		if (!cr) return {isValid: false, error: "The creature has no challenge rating.", code: "MINION_CR_MISSING"};
		if (!_MINION_STATS[cr]) {
			return {
				isValid: false,
				error: `Challenge rating "${cr}" is not supported by the Flee, Mortals! minion tables (supported: CR 0–30, including standard fractional CRs).`,
				code: "MINION_CR_UNSUPPORTED",
			};
		}
		return {isValid: true, error: null, code: null, stats: this.getStats(cr)};
	}

	static convert (creature) {
		const validation = this.validate(creature);
		if (!validation.isValid) throw new BestiaryQuickActionsValidationError(validation.error, {code: validation.code});

		const out = _clone(creature);
		const cr = _getCr(out);
		const {hp, proficiencyBonus, xp} = validation.stats;
		const currentHp = Number(out.hp?.average ?? out.hp?.special);
		out.hp = {special: `${cr === "0" && Number.isFinite(currentHp) ? Math.min(Math.max(currentHp, 1), hp) : hp}`};
		out.cr = typeof out.cr === "object"
			? {...out.cr, cr, xp}
			: {cr, xp};
		out.profBonus = proficiencyBonus;
		_addMinionTypeTag(out);

		out.trait = [
			...(Array.isArray(out.trait) ? out.trait : []).filter(entry => `${entry?.name || ""}`.toLowerCase() !== "minion"),
			_clone(_MINION_TRAIT),
		];
		out.action = (Array.isArray(out.action) ? out.action : [])
			.filter(entry => !/^multiattack\b/i.test(entry?.name || ""))
			.map(entry => /\{@atk\s/i.test(JSON.stringify(entry.entries || []))
				? _convertAttackAction({action: entry})
				: _clone(entry));
		delete out.bonus;
		delete out.bonusHeader;
		delete out.reaction;
		delete out.reactionHeader;
		return out;
	}
}

export class BestiaryQuickActionsUtil {
	static getCanonicalUid (creature) {
		if (!creature?.name || !creature?.source) throw new BestiaryQuickActionsValidationError("Creatures require name and source to create an override key.");
		return `${creature.name}`.trim().toLowerCase() + "|" + `${creature.source}`.trim().toLowerCase();
	}

	static getRegistryKey ({creature, scaleContext = null}) {
		const uid = this.getCanonicalUid(creature);
		const normalizedScale = _getScaleContext({creature, scaleContext});
		return normalizedScale.type === _SCALE_TYPES.BASE
			? `${uid}::base`
			: `${uid}::${normalizedScale.type}=${encodeURIComponent(`${normalizedScale.value}`.trim().toLowerCase())}`;
	}

	static applyOperations ({baseCreature, operations = []}) {
		if (baseCreature == null || typeof baseCreature !== "object") throw new BestiaryQuickActionsValidationError("A base creature is required.");
		let out = operations.reduce((creature, operation) => _applyOperation(creature, _clone(operation)), _clone(baseCreature));
		const proficiencyBonus = _getProficiencyBonus(out);
		_applyDeferredEffects(out, proficiencyBonus);
		out = _resolveMarkedProficiencyTemplates(out, proficiencyBonus);
		return out;
	}
}

export class BestiaryQuickActionsProficiency {
	static getBonus (creature) {
		return _getProficiencyBonus(creature);
	}

	static resolve (value, creature) {
		const proficiencyBonus = _getProficiencyBonus(creature);
		return _walkStrings(_clone(value), string => _resolveProficiencyString(string, proficiencyBonus));
	}
}

export class BestiaryQuickActionsEngine {
	static getKey ({monster, scaleContext = null}) {
		return BestiaryQuickActionsUtil.getRegistryKey({creature: monster, scaleContext});
	}

	static applyOperations ({monster, operations = []}) {
		return BestiaryQuickActionsUtil.applyOperations({baseCreature: monster, operations});
	}

	static applyOperation ({monster, operation}) {
		return this.applyOperations({monster, operations: [operation]});
	}

	static getOverride (options) {
		return this.applyOperations(options);
	}

	static validateMinion (monster) {
		return BestiaryQuickActionsMinion.validate(monster);
	}
}

export class BestiaryQuickActionsRegistry {
	#records = new Map();
	#subscribers = new Set();
	#nextOperationId = 1;

	subscribe (fn) {
		if (typeof fn !== "function") throw new TypeError("Expected a Bestiary Quick Actions subscriber function.");
		this.#subscribers.add(fn);
		return () => this.#subscribers.delete(fn);
	}

	getKey ({creature = null, monster = null, scaleContext = null}) {
		creature ||= monster;
		return BestiaryQuickActionsUtil.getRegistryKey({creature, scaleContext});
	}

	setBase ({creature = null, monster = null, scaleContext = null}) {
		creature ||= monster;
		const key = this.getKey({creature, scaleContext});
		const existing = this.#records.get(key);
		const record = {
			baseCreature: _clone(creature),
			operations: existing?.operations || [],
		};
		BestiaryQuickActionsUtil.applyOperations(record);
		this.#records.set(key, record);
		this.#notify({type: "setBase", key});
		return key;
	}

	addOperation ({creature = null, monster = null, scaleContext = null, operation}) {
		creature ||= monster;
		const key = this.getKey({creature, scaleContext});
		const record = this.#records.get(key) || {baseCreature: _clone(creature), operations: []};
		const normalizedOperation = _clone(operation);
		normalizedOperation.id ||= `bqa-${this.#nextOperationId++}`;
		const operations = [...record.operations, normalizedOperation];
		BestiaryQuickActionsUtil.applyOperations({baseCreature: record.baseCreature, operations});
		this.#records.set(key, {baseCreature: record.baseCreature, operations});
		this.#notify({type: "addOperation", key, operationId: normalizedOperation.id});
		return normalizedOperation.id;
	}

	removeOperation ({creature = null, monster = null, scaleContext = null, operationId}) {
		creature ||= monster;
		const key = this.getKey({creature, scaleContext});
		const record = this.#records.get(key);
		if (!record) return false;
		const operations = record.operations.filter(operation => operation.id !== operationId);
		if (operations.length === record.operations.length) return false;
		BestiaryQuickActionsUtil.applyOperations({baseCreature: record.baseCreature, operations});
		this.#records.set(key, {...record, operations});
		this.#notify({type: "removeOperation", key, operationId});
		return true;
	}

	getCreature ({creature = null, monster = null, scaleContext = null}) {
		creature ||= monster;
		const key = this.getKey({creature, scaleContext});
		const record = this.#records.get(key);
		if (!record) return _clone(creature);
		return BestiaryQuickActionsUtil.applyOperations({baseCreature: record.baseCreature, operations: record.operations});
	}

	getOverride (options) {
		return this.getCreature(options);
	}

	getOperations ({creature = null, monster = null, scaleContext = null}) {
		creature ||= monster;
		const key = this.getKey({creature, scaleContext});
		return _clone(this.#records.get(key)?.operations || []);
	}

	clear ({creature = null, monster = null, scaleContext = null}) {
		creature ||= monster;
		const key = this.getKey({creature, scaleContext});
		if (!this.#records.delete(key)) return false;
		this.#notify({type: "clear", key});
		return true;
	}

	#notify ({type, key, operationId = null}) {
		const record = this.#records.get(key);
		const event = {
			type,
			key,
			operationId,
			operations: _clone(record?.operations || []),
			creature: record
				? BestiaryQuickActionsUtil.applyOperations({baseCreature: record.baseCreature, operations: record.operations})
				: null,
		};
		this.#subscribers.forEach(fn => fn(_clone(event)));
	}
}

export const BESTIARY_QUICK_ACTIONS_REGISTRY = new BestiaryQuickActionsRegistry();
