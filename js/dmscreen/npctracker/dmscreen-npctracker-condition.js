export function getNpcTrackerCanonicalConditionName (value) {
	const normalized = `${value ?? ""}`.trim().toLowerCase();
	return Parser.CONDITIONS.includes(normalized) ? normalized : null;
}

export function getNpcTrackerConditionColor (condition) {
	const key = condition === "exhaustion" ? "Exhausted" : condition.toTitleCase();
	return Parser.CONDITION_TO_COLOR?.[key] || "#777777";
}

export function getNpcTrackerConditionsAfterUpdate ({conditions, condition, isAdd}) {
	const canonical = getNpcTrackerCanonicalConditionName(condition);
	const current = [...new Set((conditions || []).map(getNpcTrackerCanonicalConditionName).filter(Boolean))];
	if (!canonical) return current;
	if (isAdd) return current.includes(canonical) ? current : [...current, canonical];
	return current.filter(it => it !== canonical);
}
