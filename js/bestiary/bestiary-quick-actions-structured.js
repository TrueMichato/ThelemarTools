const _SPELL_PROPS_DIRECT = ["constant", "will", "ritual"];
const _SPELL_PROPS_FREQUENCY = ["recharge", "legendary", "daily", "rest", "restLong", "weekly", "monthly", "yearly", "charges"];
const _SPELL_PROPS = [..._SPELL_PROPS_DIRECT, ..._SPELL_PROPS_FREQUENCY, "spells"];

function _copy (value) {
	if (value == null) return value;
	if (globalThis.structuredClone) return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function _toTitleCase (value) {
	return `${value || ""}`
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/^./, char => char.toUpperCase());
}

export class BestiaryQuickActionsStructuredEditor {
	static SPELL_ROW_TYPES = Object.freeze([
		{value: "will", label: "At will"},
		{value: "constant", label: "Constant"},
		{value: "ritual", label: "Ritual"},
		{value: "daily", label: "Per day"},
		{value: "rest", label: "Per short rest"},
		{value: "restLong", label: "Per long rest"},
		{value: "weekly", label: "Per week"},
		{value: "monthly", label: "Per month"},
		{value: "yearly", label: "Per year"},
		{value: "recharge", label: "Recharge"},
		{value: "legendary", label: "Legendary actions"},
		{value: "charges", label: "Charges"},
		{value: "spells", label: "Spell level"},
	]);

	static getSpellRows (trait) {
		const rows = [];
		_SPELL_PROPS_DIRECT.forEach(type => {
			if (!Object.hasOwn(trait || {}, type)) return;
			rows.push({type, spells: _copy(trait[type])});
		});
		_SPELL_PROPS_FREQUENCY.forEach(type => {
			Object.entries(trait?.[type] || {}).forEach(([key, spells]) => rows.push({type, key, spells: _copy(spells)}));
		});
		Object.entries(trait?.spells || {}).forEach(([level, meta]) => rows.push({
			type: "spells",
			level,
			spells: _copy(meta.spells || []),
			...(meta.slots != null ? {slots: meta.slots} : {}),
			...(meta.lower != null ? {lower: meta.lower} : {}),
		}));
		return rows;
	}

	static applySpellRows ({trait, rows}) {
		const out = _copy(trait || {});
		_SPELL_PROPS.forEach(prop => delete out[prop]);
		rows.forEach(row => {
			if (_SPELL_PROPS_DIRECT.includes(row.type)) {
				out[row.type] = [...(out[row.type] || []), ..._copy(row.spells)];
				return;
			}
			if (_SPELL_PROPS_FREQUENCY.includes(row.type)) {
				out[row.type] ||= {};
				out[row.type][row.key || "1"] = _copy(row.spells);
				return;
			}
			if (row.type !== "spells") return;
			const level = `${row.level ?? ""}`.trim() === "" ? 0 : Number(row.level);
			out.spells ||= {};
			out.spells[`${level}`] = {
				...(row.slots != null && `${row.slots}` !== "" ? {slots: Number(row.slots)} : {}),
				...(row.lower != null && `${row.lower}` !== "" ? {lower: Number(row.lower)} : {}),
				spells: _copy(row.spells),
			};
		});
		return out;
	}

	static validateSpellRows ({traitName, rows}) {
		if (!`${traitName || ""}`.trim()) throw new Error("Each spellcasting trait needs a name.");
		const directTypes = new Set();
		const frequencyKeys = new Set();
		const levels = new Set();
		rows.forEach(row => {
			if (!row.spells?.some(spell => typeof spell === "object" || `${spell || ""}`.trim())) throw new Error(`${this.getSpellRowLabel(row)} needs at least one spell.`);
			if (_SPELL_PROPS_DIRECT.includes(row.type)) {
				if (directTypes.has(row.type)) throw new Error(`Only one ${this.getSpellRowLabel(row).toLowerCase()} row is allowed per spellcasting trait.`);
				directTypes.add(row.type);
				return;
			}
			if (_SPELL_PROPS_FREQUENCY.includes(row.type)) {
				if (!/^\d+e?$/.test(`${row.key || ""}`)) throw new Error(`${this.getSpellRowLabel(row)} uses a count such as “1” or “1e”.`);
				const key = `${row.type}:${row.key}`;
				if (frequencyKeys.has(key)) throw new Error(`${this.getSpellRowLabel(row)} has a duplicate count.`);
				frequencyKeys.add(key);
				return;
			}
			if (`${row.level ?? ""}`.trim() === "") throw new Error("Spell level is required.");
			const level = Number(row.level);
			if (!Number.isInteger(level) || level < 0 || level > 9) throw new Error("Spell levels must be whole numbers from 0 to 9.");
			if (levels.has(level)) throw new Error(`Spell level ${level} is listed more than once.`);
			levels.add(level);
			if (row.slots != null && `${row.slots}` !== "" && (!Number.isInteger(Number(row.slots)) || Number(row.slots) < 0)) throw new Error("Spell slots must be a non-negative whole number.");
			if (row.lower != null && `${row.lower}` !== "" && (!Number.isInteger(Number(row.lower)) || Number(row.lower) < 0 || Number(row.lower) > level)) throw new Error("The lower spell level must be between 0 and the row's spell level.");
		});
	}

	static getSpellRowLabel (row) {
		return this.SPELL_ROW_TYPES.find(it => it.value === row.type)?.label || _toTitleCase(row.type);
	}

	static getLegendaryActionCost (name) {
		const match = /\s*\(Costs?\s+(\d+)\s+Actions?\)\s*$/i.exec(`${name || ""}`);
		return match ? Number(match[1]) : 1;
	}

	static getLegendaryActionBaseName (name) {
		return `${name || ""}`.replace(/\s*\(Costs?\s+\d+\s+Actions?\)\s*$/i, "").trim();
	}

	static getLegendaryActionName ({name, cost}) {
		const clean = this.getLegendaryActionBaseName(name);
		const numCost = Number(cost);
		if (!Number.isInteger(numCost) || numCost < 1) throw new Error("Legendary action costs must be positive whole numbers.");
		return numCost === 1 ? clean : `${clean} (Costs ${numCost} Actions)`;
	}

	static parseEntryArrays (rawByProp) {
		return Object.fromEntries(Object.entries(rawByProp).map(([prop, raw]) => {
			let parsed;
			try {
				parsed = JSON.parse(raw || "[]");
			} catch (e) {
				throw new Error(`${_toTitleCase(prop)} entries contain invalid JSON: ${e.message}`);
			}
			if (!Array.isArray(parsed)) throw new Error(`${_toTitleCase(prop)} entries must be a JSON array.`);
			return [prop, parsed];
		}));
	}
}
