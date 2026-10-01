const _UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const _MAX_DEPTH = 12;
const _MAX_ITEMS = 100;
const _MAX_BYTES = 24_000;

const _isRecord = value => value != null && typeof value === "object" && !Array.isArray(value)
	&& (Object.getPrototypeOf(value) === null || Object.getPrototypeOf(Object.getPrototypeOf(value)) === null)
	&& Reflect.ownKeys(value).every(key => typeof key === "string" && !_UNSAFE_KEYS.has(key)
		&& Object.getOwnPropertyDescriptor(value, key)?.enumerable && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"));
const _keysAre = (value, required, optional = []) => _isRecord(value)
	&& required.every(key => Object.hasOwn(value, key))
	&& Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const _isText = value => typeof value === "string" && !!value.trim() && value.length <= 10_000;
const _array = (value, project, depth) => Array.isArray(value) && value.length > 0 && value.length <= _MAX_ITEMS
	? value.map(it => project(it, depth + 1)) : null;
const _validArray = value => value && value.every(it => it !== null);

function _project (value, depth) {
	if (depth > _MAX_DEPTH) return null;
	if (_isText(value) || Number.isSafeInteger(value)) return value;
	if (!_isRecord(value) || !_isText(value.type)) return null;
	const {type} = value;
	if (["entries", "inset"].includes(type)) {
		if (!_keysAre(value, ["type", "entries"], ["name", "data"]) || (value.name != null && !_isText(value.name))
			|| (value.data != null && (!_keysAre(value.data, ["overwrite"]) || !_isText(value.data.overwrite)))) return null;
		const entries = _array(value.entries, _project, depth);
		return _validArray(entries) ? {type, ...value.name ? {name: value.name} : {}, entries} : null;
	}
	if (type === "list") {
		if (!_keysAre(value, ["type", "items"], ["style"]) || (value.style != null && !_isText(value.style))) return null;
		const items = _array(value.items, _project, depth);
		return _validArray(items) ? {type, ...value.style ? {style: value.style} : {}, items} : null;
	}
	if (["item", "itemSpell"].includes(type)) {
		if (!_keysAre(value, ["type", "name"], ["entry", "entries"]) || !_isText(value.name)
			|| (value.entry == null) === (value.entries == null)) return null;
		if (value.entry != null) {
			const entry = _project(value.entry, depth + 1);
			return entry === null ? null : {type, name: value.name, entry};
		}
		const entries = _array(value.entries, _project, depth);
		return _validArray(entries) ? {type, name: value.name, entries} : null;
	}
	if (type === "table") {
		if (!_keysAre(value, ["type", "colLabels", "rows"], ["caption", "colStyles"])
			|| (value.caption != null && !_isText(value.caption))
			|| !_validArray(_array(value.colLabels, _project, depth))
			|| (value.colStyles != null && !_validArray(_array(value.colStyles, _project, depth)))) return null;
		const rows = _array(value.rows, (row, rowDepth) => _array(row, _project, rowDepth), depth);
		if (!_validArray(rows) || rows.some(row => !_validArray(row))) return null;
		return {
			type,
			...value.caption ? {caption: value.caption} : {},
			colLabels: [...value.colLabels],
			...value.colStyles ? {colStyles: [...value.colStyles]} : {},
			rows,
		};
	}
	return null;
}

export function getRenderableSpeciesTrait (entry, source) {
	if (!_isRecord(entry) || !_isText(entry.name) || !_isText(source)
		|| !_keysAre(entry, ["name", "entries"], ["type", "data", "source"])
		|| (entry.source != null && !_isText(entry.source))
		|| (entry.type != null && entry.type !== "entries")
		|| (entry.data != null && (!_keysAre(entry.data, ["overwrite"]) || !_isText(entry.data.overwrite)))) return null;
	const entries = _array(entry.entries, _project, 0);
	if (!_validArray(entries)) return null;
	const result = {name: entry.name, source: entry.source || source, entries};
	return new TextEncoder().encode(JSON.stringify(result)).length <= _MAX_BYTES ? result : null;
}

export function isTransformationEntry (entry) {
	return _isRecord(entry) && _keysAre(entry, ["name", "source", "entries"])
		&& getRenderableSpeciesTrait({name: entry.name, entries: entry.entries}, entry.source) != null;
}

export function isTransformationSpell (step, discriminator = "op") {
	if (!_isRecord(step) || !_keysAre(step, [discriminator, "spell", "source", "usage"], ["ability", "uses"])) return false;
	return step[discriminator] === "grantSpell"
		&& typeof step.spell === "string" && step.spell.length <= 256 && /^[^{}<>|#\r\n&]+?\|[a-zA-Z0-9-]{2,40}$/.test(step.spell)
		&& typeof step.source === "string" && /^[a-zA-Z0-9-]{2,40}$/.test(step.source)
		&& ["will", "daily", "rest", "known", "prepared"].includes(step.usage)
		&& (step.ability == null || ["str", "dex", "con", "int", "wis", "cha"].includes(step.ability))
		&& (["daily", "rest"].includes(step.usage)
			? Number.isInteger(step.uses) && step.uses >= 1 && step.uses <= 9
			: step.uses == null);
}
