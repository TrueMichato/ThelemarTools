/**
 * Pure rules helpers for the TGTT Gambler Rogue.
 *
 * This module deliberately has no Character Sheet or DOM dependencies.  The
 * state layer owns persistence and effects; this file owns the published
 * tables and the deterministic rules decisions which are shared by state,
 * tests, and future cast-result UIs.
 */

const SLOT_PROGRESSION = [
	[0, 0, 0, 0], [0, 0, 0, 0], [2, 0, 0, 0], [3, 0, 0, 0], [3, 0, 0, 0],
	[3, 0, 0, 0], [4, 2, 0, 0], [4, 2, 0, 0], [4, 2, 0, 0], [4, 2, 0, 0],
	[4, 2, 0, 0], [4, 2, 0, 0], [4, 3, 2, 0], [4, 3, 2, 0], [4, 3, 2, 0],
	[4, 3, 3, 0], [4, 3, 3, 0], [4, 3, 3, 0], [4, 3, 3, 1], [4, 3, 3, 1],
];

const BET_RULES = {
	low: {die: 4, losingFaces: [4], odds: "3/4", winChance: 0.75},
	mid: {die: 6, losingFaces: [5, 6], odds: "2/3", winChance: 2 / 3},
	high: {die: 2, losingFaces: [2], odds: "1/2", winChance: 0.5},
};

/**
 * Build a complete descriptor registry for a canonical 1–100 table.
 *
 * Every row receives a descriptor, even when the sheet cannot safely model
 * its target/world/narrative outcome.  The fallback is intentionally an
 * explicit durable manual resolution, never a silent no-op.
 *
 * @param {string[]} entries
 * @returns {Record<number, object>}
 */
function createTableEffects (entries = []) {
	const automatic = {
		9: {scope: "self", effectType: "condition", condition: "Prone"},
		10: {scope: "self", effectType: "condition", condition: "Blinded", duration: "1 round"},
		32: {scope: "self", effectType: "condition", condition: "Invisible", duration: "1 hour"},
		49: {scope: "self", effectType: "spellTransaction", transaction: "preserveSlot"},
		99: {scope: "self", effectType: "none"},
	};
	const confirm = {
		33: {scope: "self", effectType: "spellTransaction", transaction: "freeSpell", requiresConfirmation: true},
		61: {scope: "self", effectType: "spellTransaction", transaction: "delayedCast", requiresConfirmation: true},
	};
	const targetRows = new Set([
		44, 47, 48, 52, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 74, 75, 76, 77, 78, 79,
		80, 81, 82, 83, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97,
	]);
	const worldRows = new Set([1, 6, 19, 28, 29, 38, 39, 46, 50, 51, 54, 57, 58, 59, 62, 73, 98, 100]);

	return Object.fromEntries(Array.from({length: 100}, (_, ix) => {
		const roll = ix + 1;
		const text = entries[ix] || `Unspecified Gambling Table result ${roll}`;
		const explicit = automatic[roll] || confirm[roll];
		const scope = explicit?.scope || (targetRows.has(roll) ? "target" : worldRows.has(roll) ? "world" : "self");
		const automation = automatic[roll] ? "automatic" : confirm[roll] ? "confirm" : "manual";
		return [roll, {
			id: `gambler-table-${roll}`,
			roll,
			text,
			scope,
			automation,
			...(explicit || {}),
			...(automation === "manual" ? {
				manualResolution: true,
				instructions: "Resolve this result with the target, world, or DM, then acknowledge it on the sheet.",
			} : {}),
		}];
	}));
}

class CharacterSheetGamblerRules {
	static SLOT_PROGRESSION = SLOT_PROGRESSION.map(row => [...row]);
	static BET_RULES = BET_RULES;

	static getSpellcastingProgression ({level = 1} = {}) {
		const row = this.SLOT_PROGRESSION[Math.max(1, Math.min(20, level)) - 1] || [0, 0, 0, 0];
		return {
			cantripsKnown: level >= 10 ? 4 : level >= 3 ? 3 : 0,
			slots: {1: row[0], 2: row[1], 3: row[2], 4: row[3]},
		};
	}

	static getPreparedDice (level = 3) { return level >= 13 ? "3d6" : "2d4"; }
	static getModifierDice (level = 3) { return level >= 13 ? "2d4" : "1d6"; }

	static getBetRule (spellLevel = 1) {
		const rule = spellLevel <= 2 ? BET_RULES.low : spellLevel === 3 ? BET_RULES.mid : BET_RULES.high;
		return {...rule, spellLevel, diceType: `d${rule.die}`};
	}

	static parseDice (dice) {
		const match = String(dice || "").match(/^(\d+)d(\d+)$/i);
		return match ? {count: Number(match[1]), faces: Number(match[2])} : null;
	}

	static rollDice (dice, nextInt) {
		const parsed = this.parseDice(dice);
		if (!parsed || typeof nextInt !== "function") return null;
		const rolls = Array.from({length: parsed.count}, () => nextInt(parsed.faces));
		return {dice, rolls, total: rolls.reduce((sum, roll) => sum + roll, 0)};
	}

	static rollPreparedCount ({level = 3, nextInt} = {}) {
		return this.rollDice(this.getPreparedDice(level), nextInt);
	}

	static rollModifier ({level = 3, nextInt} = {}) {
		return this.rollDice(this.getModifierDice(level), nextInt);
	}

	static rollBet ({spellLevel = 1, nextInt} = {}) {
		const rule = this.getBetRule(spellLevel);
		const roll = nextInt(rule.die);
		return {
			...rule,
			roll,
			won: !rule.losingFaces.includes(roll),
		};
	}

	static getTableEntry (effects, roll) {
		return effects?.[Math.max(1, Math.min(100, Number(roll) || 1))] || null;
	}

	static buildTableResolution ({rolls = [], chosenRoll = null, effects, castContext = null} = {}) {
		const normalizedRolls = rolls.filter(roll => Number.isInteger(roll) && roll >= 1 && roll <= 100);
		const first = normalizedRolls[0] || null;
		const second = normalizedRolls[1] || null;
		const chosen = chosenRoll || first;
		const descriptor = this.getTableEntry(effects, chosen);
		return {
			rolls: normalizedRolls,
			roll: first,
			secondRoll: second,
			chosenRoll: chosen,
			descriptor,
			needsChoice: normalizedRolls.length > 1 && chosenRoll == null,
			castContext: castContext ? {...castContext} : null,
		};
	}

	static createTableEffects (entries) { return createTableEffects(entries); }
}

globalThis.CharacterSheetGamblerRules = CharacterSheetGamblerRules;

export {CharacterSheetGamblerRules};
