import {InitiativeTrackerRowUtil} from "../panels/initiativetracker/dmscreen-initiativetracker-consts.js";

export function getNpcTrackerHpInputValue (value) {
	if (`${value ?? ""}`.trim() === "") return null;
	const numberValue = Number(value);
	return Number.isFinite(numberValue) ? Math.max(0, numberValue) : null;
}

export function getNpcTrackerHpOperation ({raw, isHalf = false}) {
	const trimmed = `${raw ?? ""}`.trim();
	if (!trimmed) return {ok: false, message: "Enter an HP expression."};

	const processed = /^[=+\-*/^]/.test(trimmed) ? trimmed : `-${trimmed}`;
	const parsed = UiUtil.getStrNumericModified(processed, 0, {isInt: true, fallbackOnNaN: null});
	if (parsed?.next == null || !Number.isFinite(parsed.next)) return {ok: false, message: "Could not parse the HP expression."};

	if (parsed.mode === "set") return {ok: true, operation: {mode: "set", value: Math.max(0, parsed.next)}};

	let delta = parsed.delta ?? parsed.next;
	if (isHalf) delta = InitiativeTrackerRowUtil.getHalvedDelta(delta);
	return {ok: true, operation: {mode: "delta", value: delta}};
}

export function getNpcTrackerHpAfterOperation ({hp, operation}) {
	const out = {
		current: Math.max(0, Number(hp?.current) || 0),
		max: Math.max(0, Number(hp?.max) || 0),
		temp: Math.max(0, Number(hp?.temp) || 0),
	};

	if (operation.mode === "set") {
		out.current = Math.max(0, operation.value);
		return out;
	}

	if (operation.value >= 0) {
		out.current = Math.min(out.max, out.current + operation.value);
		return out;
	}

	let damage = Math.abs(operation.value);
	const tempUsed = Math.min(out.temp, damage);
	out.temp -= tempUsed;
	damage -= tempUsed;
	out.current = Math.max(0, out.current - damage);
	return out;
}
