const _FORBIDDEN_POINTER_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

function copyJson (value) {
	if (value === undefined) return undefined;
	if (typeof structuredClone !== "undefined") return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function assertJsonValue (value, {seen = new Set()} = {}) {
	if (value == null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new TypeError(`JSON patch values must contain only finite numbers.`);
		return;
	}
	if (typeof value !== "object") throw new TypeError(`JSON patch values must be JSON-serializable.`);
	if (seen.has(value)) throw new TypeError(`JSON patch values must not contain cycles.`);
	seen.add(value);
	try {
		if (Array.isArray(value)) {
			const keys = Reflect.ownKeys(value).filter(key => key !== "length");
			if (keys.length !== value.length || keys.some((key, ix) => typeof key !== "string" || key !== `${ix}`)) {
				throw new TypeError(`JSON patch arrays must be dense and cannot contain custom properties.`);
			}
			value.forEach(it => assertJsonValue(it, {seen}));
			return;
		}
		if (!isPlainObject(value)) throw new TypeError(`JSON patch values must contain only plain objects and arrays.`);
		const keys = Reflect.ownKeys(value);
		if (keys.some(key => typeof key !== "string") || keys.length !== Object.keys(value).length) {
			throw new TypeError(`JSON patch objects cannot contain symbol or non-enumerable properties.`);
		}
		Object.entries(value).forEach(([key, child]) => {
			if (_FORBIDDEN_POINTER_SEGMENTS.has(key)) throw new TypeError(`Unsafe JSON object key "${key}".`);
			assertJsonValue(child, {seen});
		});
	} finally {
		seen.delete(value);
	}
}

function isPlainObject (value) {
	if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === null || Object.getPrototypeOf(proto) === null;
}

function isDeepEqual (a, b) {
	if (Object.is(a, b)) return true;
	if (typeof a !== typeof b) return false;
	if (a == null || b == null || typeof a !== "object") return false;
	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
		return a.every((it, ix) => isDeepEqual(it, b[ix]));
	}
	const keysA = Object.keys(a).sort();
	const keysB = Object.keys(b).sort();
	if (!isDeepEqual(keysA, keysB)) return false;
	return keysA.every(key => isDeepEqual(a[key], b[key]));
}

function escapePointerSegment (segment) {
	return `${segment}`.replaceAll("~", "~0").replaceAll("/", "~1");
}

function parsePointer (path) {
	if (path === "") return [];
	if (typeof path !== "string" || !path.startsWith("/")) throw new TypeError(`Invalid JSON pointer "${path}".`);
	return path
		.slice(1)
		.split("/")
		.map(segment => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
		.map(segment => {
			if (_FORBIDDEN_POINTER_SEGMENTS.has(segment)) throw new TypeError(`Unsafe JSON pointer segment "${segment}".`);
			return segment;
		});
}

function getArrayIndex (segment, {length, isAdd = false}) {
	if (isAdd && segment === "-") return length;
	if (!/^(?:0|[1-9]\d*)$/.test(segment)) throw new TypeError(`Invalid array index "${segment}".`);
	const ix = Number(segment);
	const max = isAdd ? length : length - 1;
	if (ix < 0 || ix > max) throw new RangeError(`Array index "${segment}" is out of bounds.`);
	return ix;
}

function getParent (document, segments) {
	let parent = document;
	for (const segment of segments.slice(0, -1)) {
		if (Array.isArray(parent)) parent = parent[getArrayIndex(segment, {length: parent.length})];
		else {
			if (!isPlainObject(parent) || !Object.hasOwn(parent, segment)) throw new TypeError(`JSON pointer path does not exist.`);
			parent = parent[segment];
		}
	}
	return {parent, key: segments.at(-1)};
}

function applyPatchOperation (document, patch) {
	if (!patch || typeof patch !== "object") throw new TypeError(`Patch must be an object.`);
	if (!["add", "remove", "replace"].includes(patch.op)) throw new TypeError(`Unsupported patch operation "${patch.op}".`);
	if (patch.op !== "remove") {
		if (!Object.hasOwn(patch, "value")) throw new TypeError(`Patch operation "${patch.op}" requires a value.`);
		assertJsonValue(patch.value);
	}

	const segments = parsePointer(patch.path);
	if (!segments.length) {
		if (patch.op === "remove") throw new TypeError(`Cannot remove the document root.`);
		return copyJson(patch.value);
	}

	const {parent, key} = getParent(document, segments);
	if (Array.isArray(parent)) {
		if (patch.op === "add") parent.splice(getArrayIndex(key, {length: parent.length, isAdd: true}), 0, copyJson(patch.value));
		else {
			const ix = getArrayIndex(key, {length: parent.length});
			if (patch.op === "remove") parent.splice(ix, 1);
			else parent[ix] = copyJson(patch.value);
		}
		return document;
	}

	if (!isPlainObject(parent)) throw new TypeError(`JSON pointer parent is not an object or array.`);
	if (patch.op !== "add" && !Object.hasOwn(parent, key)) throw new TypeError(`JSON pointer path does not exist.`);
	if (patch.op === "remove") delete parent[key];
	else parent[key] = copyJson(patch.value);
	return document;
}

export function applyJsonPatch (document, patches) {
	if (!Array.isArray(patches)) throw new TypeError(`Patches must be an array.`);
	return patches.reduce((out, patch) => applyPatchOperation(out, patch), copyJson(document));
}

export function diffJson (before, after, {path = ""} = {}) {
	if (isDeepEqual(before, after)) return [];

	if (Array.isArray(before) || Array.isArray(after)) {
		return [{op: path === "" && before === undefined ? "add" : "replace", path, value: copyJson(after)}];
	}

	if (isPlainObject(before) && isPlainObject(after)) {
		const out = [];
		const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
		[...keys].sort().forEach(key => {
			const childPath = `${path}/${escapePointerSegment(key)}`;
			if (!Object.hasOwn(after, key)) out.push({op: "remove", path: childPath});
			else if (!Object.hasOwn(before, key)) out.push({op: "add", path: childPath, value: copyJson(after[key])});
			else out.push(...diffJson(before[key], after[key], {path: childPath}));
		});
		return out;
	}

	return [{op: before === undefined ? "add" : "replace", path, value: copyJson(after)}];
}

function pathsOverlap (a, b) {
	if (a === b) return true;
	if (a === "" || b === "") return true;
	return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function rebaseJsonChanges ({base, local, remote}) {
	const localPatches = diffJson(base, local);
	const remotePatches = diffJson(base, remote);
	const conflicts = localPatches
		.flatMap(localPatch => remotePatches
			.filter(remotePatch => pathsOverlap(localPatch.path, remotePatch.path))
			.map(remotePatch => ({localPath: localPatch.path, remotePath: remotePatch.path})));

	if (conflicts.length) return {isConflict: true, conflicts, patches: localPatches, document: null};
	return {
		isConflict: false,
		conflicts: [],
		patches: localPatches,
		document: applyJsonPatch(remote, localPatches),
	};
}

export {copyJson};
