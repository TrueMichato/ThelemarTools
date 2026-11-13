import {isCompiledCreatureTransformation} from "./creature-transformations.js";
import {isCreatureTransformationStatChange} from "./creature-transformation-stats.js";
import {isCreatureTransformationBindingChange} from "./creature-transformation-bindings.js";
import {isCreatureTransformationCrChange} from "./creature-transformation-cr.js";
import {getVampireForm, isVampireChange} from "./creature-transformation-vampire.js";
import {getLycanthropeForm, getLycanthropeProfile, isLycanthropeChange} from "./creature-transformation-lycanthrope.js";

const LEAF_KEYS = ["id", "kind", "identity", "provenance", "eligibility", "prerequisites", "selectedOptions", "changes", "manualReview", "version"];
const ROOT_KEYS = ["id", "kind", "identity", "provenance", "eligibility", "prerequisites", "selectedOptions"];

function fail (message) {
	const error = new Error(`Invalid frozen transformation forms: ${message}.`);
	error.code = "CREATURE_TRANSFORMATION_INVALID";
	throw error;
}

function isRecord (value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function assertJson (value, seen = new WeakSet(), depth = 0) {
	if (value === null || ["string", "boolean"].includes(typeof value) || (typeof value === "number" && Number.isFinite(value))) return;
	if (typeof value !== "object" || (!Array.isArray(value) && !isRecord(value)) || seen.has(value) || depth > 64) fail("expected bounded plain finite acyclic JSON");
	seen.add(value);
	if (Array.isArray(value)) {
		if (value.length > 100_000) fail("array is too large");
		for (let i = 0; i < value.length; ++i) if (!Object.hasOwn(value, i)) fail("sparse arrays are not permitted");
	}
	for (const key of Reflect.ownKeys(value)) {
		if (Array.isArray(value) && key === "length") continue;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)
			|| (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key))
			|| !descriptor.enumerable || !Object.hasOwn(descriptor, "value")) fail("unsafe, hidden or accessor property");
		assertJson(descriptor.value, seen, depth + 1);
	}
	seen.delete(value);
}

function keys (value, expected) {
	if (!isRecord(value) || Object.keys(value).sort().join(",") !== [...expected].sort().join(",")) fail(`expected exactly ${expected.join(", ")}`);
}

function canonical (value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
	return JSON.stringify(value);
}

function leaf (resolved) {
	keys(resolved, LEAF_KEYS);
	if (!isCompiledCreatureTransformation(resolved) || resolved.changes.length > 256) fail("each profile must be an independently compiled concrete v2 leaf");
	for (const change of resolved.changes) {
		const key = Object.hasOwn(change, "op") ? "op" : "type";
		if (resolved.id === "catalog:vampire|mm" && (isVampireChange(change, key) || change[key] === "grantConditionalDefense")) continue;
		if (getLycanthropeProfile(resolved.id) && (isLycanthropeChange(change, key) || change[key] === "grantConditionalDefense")) continue;
		if (isCreatureTransformationStatChange(change, key) || isCreatureTransformationBindingChange(change, key) || isCreatureTransformationCrChange(change, key)) continue;
		const fields = {
			setType: ["value"],
			setAbility: ["ability", "value"],
			grantSense: ["sense", "range"],
			grantResistance: ["value"],
			grantImmunity: ["value"],
			grantConditionImmunity: ["value"],
			addEntry: ["section", "entry"],
			removeEntry: ["section", "match"],
		}[change[key]];
		if (!fields) fail("unsupported leaf step");
		keys(change, [key, ...fields]);
	}
	keys(resolved.identity, ["name", "source"]);
	if (!isRecord(resolved.provenance) || Object.keys(resolved.provenance).some(key => !["edition", "evidence", "page"].includes(key))) fail("unknown provenance fields");
}

export function assertFrozenCreatureTransformation (resolved) {
	assertJson(resolved);
	keys(resolved, [...LEAF_KEYS, "frozenForms"]);
	const {frozenForms, ...projection} = resolved;
	leaf(projection);
	keys(frozenForms, ["version", "baseline", "activeForm", "profiles"]);
	keys(frozenForms.baseline, ["sourceUid", "key"]);
	if (frozenForms.version !== 1 || typeof frozenForms.baseline.sourceUid !== "string"
		|| !/^[^|\r\n]+\|[^|\r\n]+$/.test(frozenForms.baseline.sourceUid)
		|| typeof frozenForms.baseline.key !== "string" || !/^[a-f0-9]{8}$/.test(frozenForms.baseline.key)
		|| !Array.isArray(frozenForms.profiles) || frozenForms.profiles.length < 2 || frozenForms.profiles.length > 8) fail("unsupported version, baseline or profile count");
	const ids = new Set();
	for (const profile of frozenForms.profiles) {
		keys(profile, ["id", "label", "resolved"]);
		if (typeof profile.id !== "string" || !/^[a-z][a-z0-9-]{0,39}$/.test(profile.id) || ids.has(profile.id)
			|| typeof profile.label !== "string" || !profile.label.trim() || profile.label.length > 80) fail("invalid or duplicate profile ID/label");
		ids.add(profile.id);
		leaf(profile.resolved);
		if (ROOT_KEYS.some(key => canonical(profile.resolved[key]) !== canonical(projection[key]))) fail("profile root, choices, consent requirements or provenance differ");
	}
	const active = frozenForms.profiles.find(profile => profile.id === frozenForms.activeForm);
	if (!active || canonical(active.resolved) !== canonical(projection)) fail("active projection does not match its permitted profile");
	if (resolved.id === "catalog:vampire|mm" && (canonical(resolved.selectedOptions.outcome) !== canonical(["vampire"])
		|| canonical(frozenForms.profiles.map(profile => profile.id)) !== canonical(["true", "bat", "mist"])
		|| frozenForms.profiles.some(profile => getVampireForm(profile.resolved) !== profile.id))) fail("a full vampire permits only its source-defined true/bat/mist profiles, never spawn");
	if (getLycanthropeProfile(resolved.id) && (canonical(frozenForms.profiles.map(profile => profile.id)) !== canonical(["humanoid", "hybrid", "animal"])
		|| frozenForms.profiles.some(profile => getLycanthropeForm(profile.resolved) !== profile.id))) fail("M9 permits only humanoid/hybrid/animal profiles for its selected kind");
}

export function createFrozenCreatureTransformation ({profiles, activeForm, baseline}) {
	assertJson({profiles, activeForm, baseline});
	const active = Array.isArray(profiles) && profiles.find(profile => profile.id === activeForm);
	if (!active) fail("choose a permitted initial form");
	const resolved = {...active.resolved, frozenForms: {version: 1, baseline, activeForm, profiles}};
	assertFrozenCreatureTransformation(resolved);
	return structuredClone(resolved);
}

export function selectFrozenCreatureTransformation ({resolved, formId}) {
	assertFrozenCreatureTransformation(resolved);
	return createFrozenCreatureTransformation({...resolved.frozenForms, activeForm: formId});
}

export function assertFrozenCreatureTransformationReplacement (previous, next) {
	assertFrozenCreatureTransformation(previous);
	assertFrozenCreatureTransformation(next);
	const {activeForm: oldActive, ...oldSet} = previous.frozenForms;
	const {activeForm: newActive, ...newSet} = next.frozenForms;
	if (canonical(oldSet) !== canonical(newSet)) fail("the permitted profiles and baseline are immutable");
	return oldActive !== newActive;
}
