const _ABILITIES = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const _DAMAGE_TYPES = new Set(["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"]);
const _ENTRY_SECTIONS = new Set(["trait", "action", "bonus", "reaction", "legendary"]);
const _SPEED_MODES = new Set(["walk", "burrow", "climb", "fly", "swim"]);
const _SENSES = new Set(["blindsight", "darkvision", "tremorsense", "truesight"]);
const _UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const _CONDITIONS = {
	nonmagical: "from nonmagical attacks",
	nonmagicalUnsilvered: "from nonmagical attacks that aren't silvered",
	dimLightOrDarkness: "while in dim light or darkness",
};
const _ENTRY_ROLES = {
	breathWeapon: /\bbreath\b/i,
	bite: /^bite\b/i,
	healingTouch: /^healing touch\b/i,
	angelicWeapons: /^angelic weapons\b/i,
};
const _MAX_OPERATION_BYTES = 180_000;

export class CreatureTransformationError extends Error {
	constructor (message, code = "CREATURE_TRANSFORMATION_INVALID") {
		super(message);
		this.name = "CreatureTransformationError";
		this.code = code;
	}
}

function _fail (message, code) {
	throw new CreatureTransformationError(message, code);
}

function _isObject (value) {
	if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function _assertJson (value, seen = new WeakSet(), {allowUndefined = false, strict = true} = {}) {
	if (value === undefined) {
		if (allowUndefined) return;
		_fail("Undefined is not valid transformation JSON.");
	}
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number" && Number.isFinite(value)) return;
	if (typeof value !== "object" || (!Array.isArray(value) && !_isObject(value)) || seen.has(value)) _fail("Transformation data must be finite, plain, acyclic JSON.");
	seen.add(value);
	if (Array.isArray(value)) {
		if (value.length > 100_000) _fail("Transformation array is too large.");
		for (let i = 0; i < value.length; ++i) {
			if (!Object.hasOwn(value, i)) _fail("Sparse transformation arrays are not supported.");
		}
	}
	const keys = strict ? Reflect.ownKeys(value).filter(key => !(Array.isArray(value) && key === "length")) : Object.keys(value);
	for (const key of keys) {
		if (strict && (typeof key !== "string" || (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key)))) _fail("Transformation JSON cannot contain symbol or non-index array properties.");
		if (_UNSAFE_KEYS.has(key)) _fail(`Unsafe transformation property "${key}".`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (strict && (!descriptor.enumerable || !Object.hasOwn(descriptor, "value"))) _fail("Transformation JSON cannot contain hidden or accessor properties.");
		_assertJson(value[key], seen, {allowUndefined, strict});
	}
	seen.delete(value);
}

function _copy (value) {
	if (value == null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map(_copy);
	const out = {};
	Reflect.ownKeys(value).forEach(key => Object.defineProperty(out, key, {
		value: _copy(value[key]),
		enumerable: true,
		writable: true,
		configurable: true,
	}));
	return out;
}

function _canonical (value) {
	if (Array.isArray(value)) return `[${value.map(_canonical).join(",")}]`;
	if (_isObject(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${_canonical(value[key])}`).join(",")}}`;
	return JSON.stringify(value);
}

function _equal (a, b) {
	return _canonical(a) === _canonical(b);
}

function _digest (value) {
	const string = _canonical(value);
	let hash = 2166136261;
	for (let i = 0; i < string.length; ++i) hash = Math.imul(hash ^ string.charCodeAt(i), 16777619);
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function _expectString (value, label) {
	if (typeof value !== "string" || !value.trim()) _fail(`${label} must be a non-empty string.`);
	return value;
}

function _expectNumber (value, label, {min = 0} = {}) {
	if (typeof value !== "number" || !Number.isFinite(value) || value < min) _fail(`${label} must be a finite number >= ${min}.`);
	return value;
}

function _expectInteger (value, label, options) {
	_expectNumber(value, label, options);
	if (!Number.isSafeInteger(value)) _fail(`${label} must be a safe integer.`);
}

function _expectKeys (value, allowed, label) {
	if (!_isObject(value)) _fail(`${label} must be an object.`);
	const unknown = Object.keys(value).filter(key => !allowed.includes(key));
	if (unknown.length) _fail(`${label} has unsupported fields: ${unknown.join(", ")}.`);
}

function _expectArray (value, label) {
	if (!Array.isArray(value)) _fail(`${label} must be an array.`);
}

function _validateMatch (match) {
	_expectKeys(match, ["name", "role", "source"], "Entry selector");
	if (match.name != null === (match.role != null)) _fail("Entry selector needs exactly one name or role.");
	if (match.name != null) _expectString(match.name, "Entry name");
	if (match.role != null && !Object.hasOwn(_ENTRY_ROLES, match.role)) _fail(`Unsupported entry role "${match.role}".`);
	_expectString(match.source, "Entry selector source");
}

function _validateEntry (entry) {
	_expectKeys(entry, ["name", "source", "entries"], "Statblock entry");
	_expectString(entry.name, "Entry name");
	_expectString(entry.source, "Entry source");
	_expectArray(entry.entries, "Entry entries");
	entry.entries.forEach(it => _expectString(it, "Entry text"));
}

function _validateChange (change) {
	if (!_isObject(change)) _fail("Transformation changes must be objects.");
	switch (change.type) {
		case "setType":
			_expectKeys(change, ["type", "value"], change.type);
			if (typeof change.value !== "string" && !_isObject(change.value)) _fail("setType needs a creature type.");
			if (_isObject(change.value)) {
				_expectKeys(change.value, ["type", "tags"], "Creature type");
				_expectString(change.value.type, "Creature type");
				if (change.value.tags != null) _expectArray(change.value.tags, "Creature type tags");
			} else _expectString(change.value, "Creature type");
			break;
		case "setAbility":
		case "minimumAbility":
		case "maximumAbility":
			_expectKeys(change, ["type", "ability", "value"], change.type);
			if (!_ABILITIES.has(change.ability)) _fail(`Unsupported ability "${change.ability}".`);
			_expectInteger(change.value, "Ability score", {min: 1});
			break;
		case "adjustAbility":
			_expectKeys(change, ["type", "ability", "amount", "floor"], change.type);
			if (!_ABILITIES.has(change.ability)) _fail(`Unsupported ability "${change.ability}".`);
			_expectInteger(change.amount, "Ability adjustment", {min: -Infinity});
			_expectInteger(change.floor, "Ability floor", {min: 1});
			break;
		case "scaleAbility":
			_expectKeys(change, ["type", "ability", "factor", "round", "floor"], change.type);
			if (!_ABILITIES.has(change.ability)) _fail(`Unsupported ability "${change.ability}".`);
			_expectNumber(change.factor, "Ability factor", {min: Number.EPSILON});
			if (change.round !== "down") _fail("Only downward ability rounding is supported.");
			_expectInteger(change.floor, "Ability floor", {min: 1});
			break;
		case "grantResistance":
		case "grantImmunity":
		case "grantVulnerability":
			_expectKeys(change, ["type", "value"], change.type);
			if (!_DAMAGE_TYPES.has(change.value)) _fail(`Unsupported damage type "${change.value}".`);
			break;
		case "grantConditionImmunity":
		case "grantLanguage":
			_expectKeys(change, ["type", "value"], change.type);
			_expectString(change.value, change.type);
			break;
		case "grantSense":
			_expectKeys(change, ["type", "sense", "range"], change.type);
			if (!_SENSES.has(change.sense)) _fail(`Unsupported sense "${change.sense}".`);
			_expectInteger(change.range, "Sense range", {min: 1});
			break;
		case "grantSpeed":
			_expectKeys(change, ["type", "mode", "feet"], change.type);
			if (!_SPEED_MODES.has(change.mode)) _fail(`Unsupported speed mode "${change.mode}".`);
			_expectInteger(change.feet, "Speed");
			break;
		case "grantConditionalDefense":
			_expectKeys(change, ["type", "kind", "value", "when"], change.type);
			if (!["resistance", "immunity"].includes(change.kind) || !_DAMAGE_TYPES.has(change.value) || !Object.hasOwn(_CONDITIONS, change.when)) _fail("Unsupported conditional defense.");
			break;
		case "addEntry":
			_expectKeys(change, ["type", "section", "entry"], change.type);
			_validateSection(change.section);
			_validateEntry(change.entry);
			break;
		case "removeEntry":
			_expectKeys(change, ["type", "section", "match"], change.type);
			_validateSection(change.section);
			_validateMatch(change.match);
			break;
		case "replaceEntry":
			_expectKeys(change, ["type", "section", "match", "entry", "onMissing"], change.type);
			_validateSection(change.section);
			_validateMatch(change.match);
			_validateEntry(change.entry);
			if (!["error", "skip"].includes(change.onMissing)) _fail("Entry replacement needs an explicit onMissing policy.");
			break;
		case "replaceDamageType":
			_expectKeys(change, ["type", "section", "match", "from", "to", "onMissing"], change.type);
			_validateSection(change.section);
			_validateMatch(change.match);
			_expectArray(change.from, "Damage types to replace");
			if (!change.from.length || change.from.some(it => !_DAMAGE_TYPES.has(it)) || !_DAMAGE_TYPES.has(change.to)) _fail("Invalid damage type replacement.");
			if (!["error", "skip"].includes(change.onMissing)) _fail("Damage replacement needs an explicit onMissing policy.");
			break;
		default: _fail(`Unsupported transformation change "${change.type}".`);
	}
}

function _validateSection (section) {
	if (!_ENTRY_SECTIONS.has(section)) _fail(`Unsupported entry section "${section}".`);
}

function _validateRecipe (resolved) {
	_assertJson(resolved);
	_expectKeys(resolved, ["id", "kind", "identity", "provenance", "eligibility", "prerequisites", "selectedOptions", "changes", "manualReview"], "Resolved transformation");
	_expectString(resolved.id, "Transformation ID");
	if (!["catalog", "race"].includes(resolved.kind)) _fail("Transformation kind must be catalog or race.");
	if (!resolved.id.startsWith(`${resolved.kind}:`) || !resolved.id.includes("|")) _fail("Transformation ID must be a source-qualified catalog or race identity.");
	if (!_isObject(resolved.identity)) _fail("Transformation identity is required.");
	_expectString(resolved.identity.name, "Transformation name");
	_expectString(resolved.identity.source, "Transformation source");
	if (!_isObject(resolved.provenance)) _fail("Transformation provenance is required.");
	if (!["classic", "one", "unverified"].includes(resolved.provenance.edition)) _fail("Transformation edition is invalid.");
	_expectArray(resolved.eligibility, "Eligibility clauses");
	resolved.eligibility.forEach(rule => {
		_expectKeys(rule, ["types", "sizes", "minCr", "maxCr", "minInt", "maxInt", "requiresTrait", "dmApproval"], "Eligibility clause");
		["types", "sizes"].forEach(key => {
			if (rule[key] == null) return;
			_expectArray(rule[key], key);
			rule[key].forEach(it => _expectString(it, key));
		});
		if (rule.requiresTrait != null) _expectString(rule.requiresTrait, "Required trait");
		if (rule.dmApproval != null && typeof rule.dmApproval !== "boolean") _fail("DM approval must be a boolean.");
		for (const key of ["minCr", "maxCr", "minInt", "maxInt"]) {
			if (rule[key] != null && (typeof rule[key] !== "number" || !Number.isFinite(rule[key]) || rule[key] < 0)) _fail(`${key} must be a nonnegative finite number.`);
		}
	});
	_expectArray(resolved.prerequisites, "Prerequisites");
	resolved.prerequisites.forEach(it => _expectString(it, "Prerequisite"));
	if (!_isObject(resolved.selectedOptions)) _fail("Selected options must be an object.");
	for (const choices of Object.values(resolved.selectedOptions)) {
		_expectArray(choices, "Selected option group");
		choices.forEach(it => _expectString(it, "Selected option"));
	}
	_expectArray(resolved.changes, "Changes");
	resolved.changes.forEach(_validateChange);
	_expectArray(resolved.manualReview, "Manual review");
	resolved.manualReview.forEach(it => {
		_expectKeys(it, ["field", "reason"], "Manual review item");
		if (!["ac", "hp", "attacks", "cr", "characterLevel", "eligibility", "abilities", "traits", "spellcasting", "other"].includes(it.field)) _fail(`Unknown manual-review field "${it.field}".`);
		_expectString(it.reason, "Manual-review reason");
	});
}

function _getUid (creature) {
	return `${_expectString(creature?.name, "Creature name").trim().toLowerCase()}|${_expectString(creature?.source, "Creature source").trim().toLowerCase()}`;
}

function _getCr (creature) {
	const raw = typeof creature.cr === "object" ? creature.cr?.cr : creature.cr;
	if (raw == null) return null;
	const value = `${raw}`;
	if (/^\d+\/\d+$/.test(value)) {
		const [numerator, denominator] = value.split("/").map(Number);
		return denominator ? numerator / denominator : null;
	}
	return /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
}

function _checkEligibility ({creature, resolved, acknowledgedPrerequisites, dmApproved}) {
	_expectArray(acknowledgedPrerequisites, "Acknowledged prerequisites");
	if (acknowledgedPrerequisites.some(it => !resolved.prerequisites.includes(it)) || resolved.prerequisites.some(it => !acknowledgedPrerequisites.includes(it))) {
		_fail("All narrative prerequisites must be explicitly acknowledged.", "CREATURE_TRANSFORMATION_PREREQUISITE");
	}
	if (typeof dmApproved !== "boolean") _fail("DM approval must be explicitly true or false.");
	const type = typeof creature.type === "string" ? creature.type : creature.type?.type;
	const cr = _getCr(creature);
	const eligible = rule =>
		(!rule.types || rule.types.some(it => it.toLowerCase() === `${type || ""}`.toLowerCase()))
		&& (!rule.sizes || rule.sizes.some(it => (creature.size || []).includes(it)))
		&& (rule.minCr == null || (cr != null && cr >= rule.minCr))
		&& (rule.maxCr == null || (cr != null && cr <= rule.maxCr))
		&& (rule.minInt == null || (Number.isFinite(creature.int) && creature.int >= rule.minInt))
		&& (rule.maxInt == null || (Number.isFinite(creature.int) && creature.int <= rule.maxInt))
		&& (!rule.requiresTrait || (creature.trait || []).some(it => it.name?.toLowerCase() === rule.requiresTrait.toLowerCase()))
		&& (!rule.dmApproval || dmApproved);
	if (!resolved.eligibility.every(eligible)) _fail("Creature does not satisfy transformation eligibility (or required DM approval).", "CREATURE_TRANSFORMATION_INELIGIBLE");
}

function _getEntrySource (entry, chassis) {
	return (entry.source === "$chassis" || !entry.source ? chassis.source : entry.source).trim().toLowerCase();
}

function _getEntryKey (section, entry, chassis) {
	return `${section}:${_expectString(entry?.name, "Existing entry name").trim().toLowerCase()}|${_getEntrySource(entry, chassis)}`;
}

function _getEntryIndex (creature, section, match, chassis, {allowMissing = false} = {}) {
	const entries = creature[section] || [];
	if (!Array.isArray(entries)) _fail(`${section} is not a statblock entry array.`);
	const source = match.source === "$chassis" ? chassis.source : match.source;
	const found = entries.map((entry, index) => ({entry, index}))
		.filter(({entry}) =>
			_getEntrySource(entry, chassis) === source.trim().toLowerCase()
			&& (match.name != null ? entry.name?.trim().toLowerCase() === match.name.trim().toLowerCase() : _ENTRY_ROLES[match.role].test(entry.name || "")));
	if (allowMissing && !found.length) { return -1; }
	if (found.length !== 1) _fail(`${section} selector ${JSON.stringify(match)} matched ${found.length} entries (expected exactly one).`, "CREATURE_TRANSFORMATION_ENTRY_MATCH");
	return found[0].index;
}

function _replaceDamageText (value, from, to, count) {
	if (typeof value === "string") {
		return value.replace(/\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)(?=\s+damage\b)/gi, full => {
			if (!from.includes(full.toLowerCase())) {
				return full;
			}
			count.value++;
			return to;
		});
	}
	if (Array.isArray(value)) return value.map(it => _replaceDamageText(it, from, to, count));
	if (_isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, _replaceDamageText(child, from, to, count)]));
	return value;
}

function _applyChange (creature, change, chassis) {
	const out = _copy(creature);
	let path;
	let before;
	let after;
	switch (change.type) {
		case "setType":
			path = "type";
			before = out.type;
			out.type = _copy(change.value);
			after = out.type;
			break;
		case "setAbility":
		case "minimumAbility":
		case "maximumAbility":
		case "adjustAbility":
		case "scaleAbility": {
			path = change.ability;
			before = out[path];
			if (!Number.isSafeInteger(before)) _fail(`${path} must be an integer before applying ${change.type}.`);
			switch (change.type) {
				case "setAbility": after = change.value; break;
				case "minimumAbility": after = Math.max(before, change.value); break;
				case "maximumAbility": after = Math.min(before, change.value); break;
				case "adjustAbility": after = Math.max(change.floor, before + change.amount); break;
				case "scaleAbility": after = Math.max(change.floor, Math.floor(before * change.factor)); break;
			}
			if (!Number.isSafeInteger(after)) _fail(`${change.type} produced an invalid ${path} score.`);
			out[path] = after;
			break;
		}
		case "grantResistance":
		case "grantImmunity":
		case "grantVulnerability":
		case "grantConditionImmunity":
		case "grantLanguage":
		case "grantConditionalDefense": {
			const field = {
				grantResistance: "resist",
				grantImmunity: "immune",
				grantVulnerability: "vulnerable",
				grantConditionImmunity: "conditionImmune",
				grantLanguage: "languages",
				grantConditionalDefense: change.kind === "immunity" ? "immune" : "resist",
			}[change.type];
			const note = change.type === "grantConditionalDefense" ? _CONDITIONS[change.when] : null;
			path = `${field}:${change.value.toLowerCase()}${note ? `|${change.when}` : ""}`;
			if (out[field] != null && !Array.isArray(out[field])) _fail(`${field} must be an array.`);
			const entries = out[field] || [];
			before = entries.find(it => note ? it?.note === note && it[field]?.includes(change.value) : typeof it === "string" && it.toLowerCase() === change.value.toLowerCase());
			if (!before) entries.push(note ? {[field]: [change.value], note} : change.value);
			out[field] = entries;
			after = entries.find(it => note ? it?.note === note && it[field]?.includes(change.value) : typeof it === "string" && it.toLowerCase() === change.value.toLowerCase());
			break;
		}
		case "grantSense": {
			path = `senses:${change.sense}`;
			if (out.senses != null && !Array.isArray(out.senses)) _fail("Senses must be an array.");
			out.senses ||= [];
			const found = out.senses.map((value, index) => ({value, index})).filter(it => typeof it.value === "string" && it.value.toLowerCase().startsWith(`${change.sense} `));
			if (found.length > 1) _fail(`Ambiguous existing ${change.sense} sense.`);
			before = found[0]?.value;
			if (before && !new RegExp(`^${change.sense} (\\d+) ft\\.$`, "i").test(before)) _fail(`Cannot safely replace conditional ${change.sense} sense.`);
			const existingRange = before ? Number(before.match(/\d+/)[0]) : 0;
			after = before && existingRange >= change.range ? before : `${change.sense} ${change.range} ft.`;
			if (found.length) out.senses[found[0].index] = after;
			else out.senses.push(after);
			break;
		}
		case "grantSpeed":
			path = `speed.${change.mode}`;
			if (out.speed != null && typeof out.speed !== "number" && !_isObject(out.speed)) _fail("Creature speed must be a number or object.");
			before = typeof out.speed === "number" ? (change.mode === "walk" ? out.speed : undefined) : out.speed?.[change.mode];
			if (before != null && typeof before !== "number") _fail(`Cannot safely replace structured ${change.mode} speed.`);
			after = Math.max(before || 0, change.feet);
			if (after !== before) {
				if (typeof out.speed === "number" && change.mode === "walk") out.speed = after;
				else {
					out.speed = typeof out.speed === "number" ? {walk: out.speed} : out.speed || {};
					out.speed[change.mode] = after;
				}
			}
			break;
		case "addEntry":
		case "removeEntry":
		case "replaceEntry":
		case "replaceDamageType": {
			const section = change.section;
			if (out[section] != null && !Array.isArray(out[section])) _fail(`${section} must be an array.`);
			if (change.type === "addEntry") {
				out[section] ||= [];
				const entry = _copy(change.entry);
				if (entry.source === "$chassis") entry.source = chassis.source;
				path = _getEntryKey(section, entry, chassis);
				if (out[section].some(it => _getEntryKey(section, it, chassis) === path)) _fail(`Duplicate entry "${path}".`, "CREATURE_TRANSFORMATION_ENTRY_MATCH");
				out[section].push(entry);
				after = entry;
				break;
			}
			const index = _getEntryIndex(out, section, change.match, chassis, {
				allowMissing: ["replaceEntry", "replaceDamageType"].includes(change.type) && change.onMissing === "skip",
			});
			if (index === -1) return {out, write: null};
			before = out[section][index];
			path = _getEntryKey(section, before, chassis);
			if (change.type === "removeEntry") out[section].splice(index, 1);
			else if (change.type === "replaceEntry") {
				after = _copy(change.entry);
				if (after.source === "$chassis") after.source = chassis.source;
				if (_getEntryKey(section, after, chassis) !== path && out[section].some((it, ix) => ix !== index && _getEntryKey(section, it, chassis) === _getEntryKey(section, after, chassis))) _fail("Replacement creates a duplicate named entry.");
				out[section][index] = after;
			} else {
				const count = {value: 0};
				const entries = _replaceDamageText(before.entries, change.from, change.to, count);
				if (!count.value && change.onMissing === "error") _fail(`No listed damage type found in "${before.name}".`, "CREATURE_TRANSFORMATION_DAMAGE_MISSING");
				after = count.value ? {...before, entries} : before;
				out[section][index] = after;
			}
			break;
		}
	}
	return {out, path, write: _equal(before, after) ? null : {path, before, after, section: _ENTRY_SECTIONS.has(change.section) ? change.section : null}};
}

function _getDiff (before, after, prefix = "") {
	const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
	const fields = [];
	const entries = [];
	for (const key of [...paths].sort()) {
		const path = prefix ? `${prefix}.${key}` : key;
		if (_ENTRY_SECTIONS.has(key) && !prefix && Array.isArray(before[key] || []) && Array.isArray(after[key] || [])) {
			const oldEntries = before[key] || [];
			const newEntries = after[key] || [];
			const getIdentity = it => `${it.name || ""}|${it.source || ""}`.toLowerCase();
			for (const identity of new Set([...oldEntries, ...newEntries].map(getIdentity))) {
				const old = oldEntries.find(it => getIdentity(it) === identity);
				const next = newEntries.find(it => getIdentity(it) === identity);
				if (!_equal(old, next)) entries.push({section: key, name: (next || old).name, source: (next || old).source || null, before: _copy(old ?? null), after: _copy(next ?? null)});
			}
		} else if (_isObject(before[key]) && _isObject(after[key])) fields.push(..._getDiff(before[key], after[key], path).fields);
		else if (!_equal(before[key], after[key])) fields.push({path, before: _copy(before[key] ?? null), after: _copy(after[key] ?? null), hadBefore: Object.hasOwn(before, key), hasAfter: Object.hasOwn(after, key)});
	}
	return {fields, entries};
}

export class BestiaryCreatureTransformation {
	static get MAX_OPERATION_BYTES () { return _MAX_OPERATION_BYTES; }

	static preview ({original, current, resolved, priorWrites = [], acknowledgedPrerequisites = [], dmApproved = false, conflictDecisions = {}, historyFingerprint = ""}) {
		_validateRecipe(resolved);
		_assertJson(original, new WeakSet(), {strict: false});
		_assertJson(current, new WeakSet(), {strict: false});
		_assertJson(priorWrites, new WeakSet(), {allowUndefined: true, strict: false});
		_assertJson(conflictDecisions);
		const sourceUid = _getUid(original);
		_checkEligibility({creature: current, resolved, acknowledgedPrerequisites, dmApproved});
		if (!_isObject(conflictDecisions)) _fail("Conflict decisions must be keyed by field path.");
		let candidate = _copy(current);
		const candidateWrites = new Map();
		const steps = resolved.changes.map(change => {
			const {out, path, write} = _applyChange(candidate, change, original);
			candidate = out;
			if (write) {
				const prior = candidateWrites.get(path);
				candidateWrites.set(path, {...write, before: prior ? prior.before : write.before});
			}
			return {change, path};
		});
		const conflicts = [];
		for (const [path, write] of candidateWrites) {
			if (_equal(write.before, write.after)) continue;
			const previous = [...priorWrites].reverse().find(it => it.path === path);
			if (previous && _equal(previous.after, write.before)) {
				conflicts.push({
					path,
					existing: _copy(write.before ?? null),
					incoming: _copy(write.after ?? null),
					previousOperationId: previous.operationId,
					previousOperationKey: previous.operationKey,
				});
			}
		}
		const unexpected = Object.keys(conflictDecisions).filter(path => !conflicts.some(it => it.path === path));
		if (unexpected.length) _fail(`Decision for a non-conflicting field: ${unexpected.join(", ")}.`);
		for (const [path, decision] of Object.entries(conflictDecisions)) {
			if (!["existing", "incoming"].includes(decision)) _fail(`Invalid winner for "${path}".`);
		}
		let proposed = _copy(current);
		const appliedWrites = new Map();
		for (const {change, path} of steps) {
			if (conflicts.some(it => it.path === path) && conflictDecisions[path] !== "incoming") continue;
			const {out, write} = _applyChange(proposed, change, original);
			proposed = out;
			if (!write) continue;
			const prior = appliedWrites.get(write.path);
			appliedWrites.set(write.path, {...write, before: prior ? prior.before : write.before});
		}
		const writes = [...appliedWrites.values()].filter(it => !_equal(it.before, it.after));
		const unresolvedConflicts = conflicts.filter(it => !Object.hasOwn(conflictDecisions, it.path));
		return {
			original: _copy(original),
			current: _copy(current),
			proposed,
			diff: _getDiff(current, proposed),
			conflicts,
			unresolvedConflicts,
			canApply: !unresolvedConflicts.length,
			manualReview: _copy(resolved.manualReview),
			resolved: _copy(resolved),
			acknowledgedPrerequisites: _copy(acknowledgedPrerequisites),
			dmApproved,
			sourceUid,
			writes,
			token: _digest({original, current, priorWrites, resolved, acknowledgedPrerequisites, dmApproved, historyFingerprint}),
		};
	}

	static createOperation ({preview, currentPreview, conflictDecisions = {}}) {
		if (preview?.token !== currentPreview?.token || !_equal(preview?.original, currentPreview.original) || !_equal(preview?.current, currentPreview.current) || !_equal(preview?.resolved, currentPreview.resolved) || !_equal(preview?.conflicts, currentPreview.conflicts) || !_equal(preview?.manualReview, currentPreview.manualReview)) _fail("Transformation preview is stale or has been changed.", "CREATURE_TRANSFORMATION_STALE");
		if (!currentPreview.canApply) _fail("Preview has unresolved conflicts; choose each existing or incoming winner.");
		if (!_isObject(conflictDecisions)) _fail("Conflict decisions must be keyed by field path.");
		if (currentPreview.conflicts.some(it => !["existing", "incoming"].includes(conflictDecisions[it.path])) || Object.keys(conflictDecisions).some(path => !currentPreview.conflicts.some(it => it.path === path))) _fail("Missing or tampered conflict decisions.");
		const data = {
			resolved: _copy(currentPreview.resolved),
			sourceUid: currentPreview.sourceUid,
			acknowledgedPrerequisites: _copy(currentPreview.acknowledgedPrerequisites),
			dmApproved: currentPreview.dmApproved,
			conflictDecisions: _copy(conflictDecisions),
			approvedConflicts: currentPreview.conflicts.map(({previousOperationId, ...conflict}) => _copy(conflict)),
			manualReview: _copy(currentPreview.resolved.manualReview),
		};
		data.integrity = _digest(data);
		const operation = {type: "applyCreatureTransformation", data};
		if (new TextEncoder().encode(JSON.stringify(operation)).length > _MAX_OPERATION_BYTES) _fail("Resolved transformation exceeds the Encounter operation size budget.", "CREATURE_TRANSFORMATION_TOO_LARGE");
		return operation;
	}

	static replay ({creature, baseCreature, operation, priorWrites = [], operationId = null}) {
		const data = operation?.data;
		if (!_isObject(data) || !_equal(Object.keys(data).sort(), ["resolved", "sourceUid", "acknowledgedPrerequisites", "dmApproved", "conflictDecisions", "approvedConflicts", "manualReview", "integrity"].sort())) _fail("Malformed transformation operation.");
		_assertJson(data);
		const {integrity, ...payload} = data;
		if (integrity !== _digest(payload) || !_equal(data.manualReview, data.resolved?.manualReview) || data.sourceUid !== _getUid(baseCreature)) _fail("Transformation operation has been changed or belongs to another creature.", "CREATURE_TRANSFORMATION_TAMPERED");
		const decisions = data.conflictDecisions;
		const savedConflicts = data.approvedConflicts;
		_expectArray(savedConflicts, "Approved conflicts");
		if (Object.keys(decisions).some(path => !savedConflicts.some(it => it.path === path)) || savedConflicts.some(it => !["existing", "incoming"].includes(decisions[it.path]))) _fail("Transformation conflict decisions are malformed.");
		const options = {
			original: baseCreature,
			current: creature,
			resolved: data.resolved,
			priorWrites,
			acknowledgedPrerequisites: data.acknowledgedPrerequisites,
			dmApproved: data.dmApproved,
		};
		const preliminary = this.preview(options);
		const preview = this.preview({
			...options,
			conflictDecisions: Object.fromEntries(Object.entries(decisions).filter(([path]) => preliminary.conflicts.some(it => it.path === path))),
		});
		for (const conflict of preview.conflicts) {
			const approved = savedConflicts.find(it => it.path === conflict.path);
			if (!approved || !_equal(approved.existing, conflict.existing) || !_equal(approved.incoming, conflict.incoming) || approved.previousOperationKey !== conflict.previousOperationKey) _fail(`Conflict "${conflict.path}" changed; re-preview the history.`, "CREATURE_TRANSFORMATION_STALE");
		}
		if (!preview.canApply) _fail("Unresolved transformation conflict after history replay.", "CREATURE_TRANSFORMATION_STALE");
		return {creature: preview.proposed, writes: preview.writes.map(it => ({...it, operationId: operationId || data.resolved.id, operationKey: data.integrity}))};
	}

	static getDiff (before, after) {
		return _getDiff(before, after);
	}
}
