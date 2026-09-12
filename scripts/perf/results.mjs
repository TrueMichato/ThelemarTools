import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";

export const SCHEMA_VERSION = 2;
export const READINESS_VERSION = "toolsLoaded-logical-paint-v2";

export function digest (value) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function compactLogicalLists (snapshot) {
	return {
		...snapshot,
		lists: snapshot.lists.map(({loaded, matching, ...list}) => ({
			...list,
			loadedDigest: digest(loaded),
			matchingDigest: digest(matching),
		})),
		loadedDigest: digest(snapshot.lists.map(list => [list.id, list.loaded])),
		matchingDigest: digest(snapshot.lists.map(list => [list.id, list.matching])),
	};
}

export function compatibilityErrors (before, after) {
	const errors = [];
	for (const key of ["schemaVersion", "readinessVersion", "viewport", "cpuThrottle", "browserVersion", "interactionsEnabled", "storagePolicy"]) {
		if (!isDeepStrictEqual(before[key], after[key])) errors.push(`Incompatible ${key}; rebaseline with the same harness/configuration`);
	}
	if (before.schemaVersion !== SCHEMA_VERSION || before.readinessVersion !== READINESS_VERSION) errors.push("Legacy readiness data cannot be compared with v2");
	// Two fresh, harness-owned loopback servers differ only in port; other origin changes are unsafe.
	if (before.origin !== after.origin && !(before.localServer && after.localServer)) errors.push("Origins differ (not two harness-owned local servers)");
	return errors;
}

export function correctnessErrors (before, after) {
	const errors = [];
	for (const key of ["loadedDigest", "matchingDigest", "sourceConfiguration"]) {
		if (!isDeepStrictEqual(before.logical?.[key], after.logical?.[key])) errors.push(`Logical ${key} changed`);
	}
	if (!isDeepStrictEqual(before.brewProps, after.brewProps)) errors.push("Homebrew property counts changed");
	const beforeScenarios = before.interactions?.scenarios || [];
	const afterScenarios = after.interactions?.scenarios || [];
	if (!isDeepStrictEqual(beforeScenarios.map(it => [it.name, it.skipped]), afterScenarios.map(it => [it.name, it.skipped]))) errors.push("Interaction coverage changed");
	for (const scenario of beforeScenarios) {
		const other = afterScenarios.find(it => it.name === scenario.name);
		if (scenario.skipped || !other) continue;
		for (const key of ["loadedDigest", "matchingDigest", "sourceConfiguration"]) {
			if (!isDeepStrictEqual(scenario.logical?.[key], other.logical?.[key])) errors.push(`Interaction ${scenario.name}: ${key} changed`);
		}
	}
	return errors;
}
