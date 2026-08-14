export function getNpcTrackerHpInputValue (value) {
	if (`${value ?? ""}`.trim() === "") return null;
	const numberValue = Number(value);
	return Number.isFinite(numberValue) ? Math.max(0, numberValue) : null;
}
