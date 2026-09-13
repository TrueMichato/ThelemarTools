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

// This is a lossless copy of the Gambling Table in
// homebrew/TravelersGuidetoThelemar.json. Keep renderer tags intact: the
// persisted receipt and manual-resolution note are user-facing rules text.
const GAMBLER_GAMBLING_TABLE = Object.freeze([
	"Wall of force appears 10 ft in front of the gambler",
	"Gambler smells like a skunk for spell duration, gaining a disadvantage on Charisma (Persuasion) checks",
	"Gambler shoots forth eight nonpoisonous snakes from fingertips. Snakes do not attack and disappear after an hour.",
	"Gambler's clothes itch for the next hour (-2 to initiative, move down the initiative order if in the middle of combat)",
	"Gambler glows as per a {@spell light} cantrip",
	"Spell effect has 60 ft radius centered on gambler",
	"Next sentence spoken by gambler thunders, and can be heard up to 600 feet away",
	"Gambler's hair grows one foot in length",
	"Gambler falls {@condition prone}",
	"Gambler's face is blackened by small explosion, making him {@condition blinded} for 1 round",
	"Gambler develops allergy to his magical items. Character cannot control sneezing until all magical items are removed. Allergy lasts {@dice 1d6} minutes, and sneezing prevents speaking or casting spells, and gives disadvantage on attack rolls.",
	"Gambler's head enlarges for {@dice 1d4} rounds, as per {@spell Enlarge/Reduce} spell. Only the head is affected, and while this is not harmful to the gambler, it is up to the DM to decide if there are any other effects.",
	"Gambler reduces (as per {@spell Enlarge/Reduce} spell) for 10 minutes",
	"Gambler rolls a Wisdom Saving Throw. On failure, the Gambler falls madly in love with target until a {@spell remove curse} is cast on them",
	"Spell cannot be dismissed at will by gambler for the next hour.",
	"Gambler is subjected to the {@spell Polymorph} spell, with a randomly chosen animal as target",
	"Colorful bubbles come out of gambler's mouth instead of words. Words are released when bubbles pop.",
	"{@spell Tongues} spell targets all within 60 feet of gambler, including the gambler, but with a reversed effect (making affected targets unable to understand any language for the duration)",
	"{@spell Wall of fire} encircles gambler",
	"Gambler's feet enlarge for {@dice 1d3} minutes, reducing movement speed by half and giving them -4 to initiative rolls. If this happens in the middle of combat, the gambler moves down in the initiative order",
	"Gambler suffers same spell effect as target",
	"Gambler levitates 20ft for {@dice 1d4} minutes",
	"{@spell Cause fear} with 60ft radius centered on gambler. All within radius except the gambler must make a saving throw.",
	"Gambler speaks in a squeaky voice for {@dice 1d6} days",
	"Gambler gains X-ray vision of 60ft for {@dice 1d6} rounds",
	"Gambler rolls a Constitution Saving Throw. On failure, the gambler ages 10 years",
	"{@spell Silence}, 15' radius centers on gambler",
	"10ft X 10ft pit appears immediately in front of gambler, 5ft deep per level of the gambler",
	"{@spell Reverse Gravity} spell affecting only the gambler for 1 round",
	"Colored streamers pour from gambler's fingertips",
	"Spell effect rebounds on gambler",
	"Gambler becomes {@condition invisible|tgtt} for 1 hour (as {@spell invisibility} spell)",
	"Gambler casts {@spell Color Spray} without using a spell slot",
	"Stream of butterflies pours from gambler's mouth",
	"Gambler leaves monster-shaped footprints instead of his own until a {@spell dispel magic} is cast",
	"{@dice 3d10} gems shoot from gambler's fingertips. Each gem is worth {@dice 1d6} × 10 gp.",
	"Music fills the air for 10 minutes",
	"{@spell Create food and water} is cast",
	"All normal fires within 60ft of gambler are extinguished",
	"One magical item within 30ft of gambler (randomly chosen) is permanently drained of magic",
	"One normal item within 30ft of gambler (randomly chosen) becomes permanently magical (roll randomly on magic item tables, item can gain any magic item's properties between uncommon and very rare)",
	"All magical weapons bonuses within 30ft of gambler are increased by +2 for 1 turn",
	"Smoke trickles from the ears of all creatures within 60' of gambler for 1 turn",
	"{@spell Dancing lights} is cast on the target",
	"All creatures within 30ft of gambler begin to hiccup (cannot cast spells requiring verbal component, -1 to hit) for 5 rounds",
	"All doors, secret doors, portcullises, etc. (including those locked or barred) within 60ft of gambler swing open",
	"Gambler and target exchange places (only after spell is cast)",
	"Spell affects random target within 60ft of the gambler",
	"Spell fails but spell slot is not consumed",
	"{@spell Conjure Woodland Beings}",
	"Sudden change in weather (temperature rise, snow, rain, etc.) lasting {@dice 1d6} hours",
	"Deafening bang affects everyone within 60 ft. All those who can hear must roll a Constitution Saving Throw or be {@condition stunned|tgtt} for {@dice 1d3} rounds.",
	"Gambler and target exchange voices until a {@spell remove curse} is cast",
	"Gate opens to randomly chosen outer plane; 50% chance for extra-planar creature to appear.",
	"Spell functions but shrieks like a shrieker for the duration (minimum 1 round)",
	"Spell effectiveness (range, duration, area of effect, damage, etc.) decreases by half",
	"Spell switches with another spell from the same level",
	"Spell becomes a Living Spell, uncontrolled by the gambler.",
	"All weapons within 60 ft of gambler glow for 10 minutes",
	"Spell functions; any applicable saving throw is not allowed",
	"Spell appears to fail when cast, but occurs {@dice 1d4} rounds later",
	"All magical items within 60 ft of gambler glow for {@dice 2d8} days",
	"Gambler and target both make a Wisdom Saving Throw. If they both fail, they switch bodies for {@dice 2d10} rounds",
	"Target's feet enlarge for {@dice 1d3} minutes, reducing movement speed by half and giving them -4 to initiative rolls. If this happens in the middle of combat, the target moves down in the initiative order",
	"Target becomes {@condition invisible|tgtt} as per the {@spell invisibility} spell",
	"{@spell Lightning Bolt} spell shoots toward target",
	"Target enlarged as per the {@spell Enlarge/Reduce} spell",
	"{@spell Darkness} centered on target",
	"{@spell Plant Growth} centered on target",
	"1,000 lbs. of non-living matter within 10 feet of target vanishes",
	"{@spell Fireball} centered on target",
	"{@spell Flesh to Stone} is cast on the target",
	"{@spell Heal} spell on everyone in 10ft radius centered on gambler",
	"Target becomes {@condition dazed|TGTT} for {@dice 2d4} rounds",
	"{@spell Wall of Fire} encircles target",
	"Target levitates 20' for {@dice 1d3} Minutes",
	"Target is {@condition blinded} for 5 rounds",
	"Target is {@condition charmed} as per {@spell Charm Monster}",
	"{@spell Calm Emotions} is cast on the target",
	"{@spell Slow} spell centered on target",
	"Disenchanter summoned for 1 minute in front of target",
	"Spell cast becomes {@spell polymorph}",
	"Small, black raincloud forms over target and starts raining for 10 rounds.",
	"Gambler changes sex",
	"Heavy object (boulder, anvil, etc.) appears over target and falls for {@damage 2d20} points of damage",
	"Target begins sneezing for {@dice 1d6} rounds. sneezing prevents speaking or casting spells, and gives disadvantage on attack rolls.",
	"{@spell Stinking cloud} centered on target",
	"Spell effect has 60' radius centered on target (all within radius suffer the effect)",
	"Target's clothes itch for {@dice 1d10} rounds (-2 to initiative, move down the initiative order if in the middle of combat)",
	"Target rolls Wisdom Saving Throw, on failure falls madly in love with gambler until a {@spell dispel magic} is cast.",
	"Target rolls Constitution Saving Throw, on failure race randomly changes until canceled by {@spell dispel magic}",
	"Target turns ethereal for {@dice 2d4} rounds",
	"Target hastened for 5 rounds",
	"All cloth on target crumble to dust",
	"Target sprouts leaves (no damage caused, can be pruned without harm)",
	"Target sprouts new useless appendage (wings, arm, ear, etc.) which remains until {@spell dispel magic} is cast",
	"Target changes color (canceled by {@spell dispel magic})",
	"Spell has a minimum duration of 1 minute (i.e., a {@spell fireball} creates a ball of flame that remains for 1 turn, a lightning bounces and continues, possibly rebounding, for 1 turn, etc.)",
	"Nothing happens",
	"Spell effectiveness (range, duration, area of effect, damage, etc.) is doubled",
]);

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
		2: {
			scope: "self",
			effectType: "modifier",
			modifier: {type: "skill:persuasion", value: 0, disadvantage: true},
			duration: "spell duration",
		},
		4: {
			scope: "self",
			effectType: "modifier",
			modifier: {type: "initiative", value: -2},
			duration: "1 hour",
		},
		5: {
			scope: "self",
			effectType: "activeState",
			stateId: "gamblerLight",
			stateName: "Gambler's Folly: Light",
			effects: [{type: "light", brightRange: 20, dimRange: 40}],
			duration: "spell duration",
		},
		9: {scope: "self", effectType: "condition", condition: "Prone"},
		10: {scope: "self", effectType: "condition", condition: "Blinded", duration: "1 round"},
		11: {
			scope: "self",
			effectType: "activeState",
			stateId: "gamblerSneezing",
			stateName: "Gambler's Folly: Sneezing",
			effects: [
				{type: "disadvantage", target: "attack"},
				{type: "note", value: "Cannot speak or cast spells while sneezing"},
			],
			duration: "1d6 minutes",
		},
		13: {
			scope: "self",
			effectType: "activeState",
			stateId: "gamblerReduce",
			stateName: "Gambler's Folly: Reduce",
			effects: [{type: "sizeDecrease", value: 1}],
			duration: "10 minutes",
		},
		20: {
			scope: "self",
			effectType: "activeState",
			stateId: "gamblerEnlargedFeet",
			stateName: "Gambler's Folly: Reduce (Enlarged Feet)",
			effects: [
				{type: "speedMultiplier", value: 0.5},
				{type: "bonus", target: "initiative", value: -4},
			],
			duration: "1d3 minutes",
		},
		18: {
			scope: "area",
			effectType: "manual",
			manualResolution: true,
			instructions: "Apply the spell's 60-foot radius centered on the Gambler, then acknowledge the result.",
		},
		27: {
			scope: "area",
			effectType: "manual",
			manualResolution: true,
			instructions: "Apply Silence in a 15-foot radius centered on the Gambler, then acknowledge the result.",
		},
		22: {
			scope: "self",
			effectType: "activeState",
			stateId: "gamblerLevitation",
			stateName: "Gambler's Folly: Levitation",
			effects: [{type: "levitation", height: 20}],
			duration: "1d4 minutes",
		},
		23: {
			scope: "area",
			effectType: "manual",
			manualResolution: true,
			instructions: "Resolve Cause Fear for every creature within 60 feet except the Gambler, then acknowledge the result.",
		},
		42: {
			scope: "area",
			effectType: "manual",
			manualResolution: true,
			instructions: "Increase magical weapon bonuses within 30 feet by +2 for 1 turn, then acknowledge the result.",
		},
		45: {
			scope: "area",
			effectType: "manual",
			manualResolution: true,
			instructions: "Apply the five-round hiccup effect to all creatures within 30 feet, then acknowledge the result.",
		},
		25: {
			scope: "self",
			effectType: "activeState",
			stateId: "gamblerXrayVision",
			stateName: "Gambler's Folly: X-ray Vision",
			effects: [{type: "sense", target: "xray", value: 60}],
			duration: "1d6 rounds",
		},
		32: {scope: "self", effectType: "condition", condition: "Invisible", duration: "1 hour"},
		49: {scope: "self", effectType: "spellTransaction", transaction: "preserveSlot"},
		99: {scope: "self", effectType: "none"},
	};
	const confirm = {
		33: {scope: "self", effectType: "spellTransaction", transaction: "freeSpell", requiresConfirmation: true},
		61: {scope: "self", effectType: "spellTransaction", transaction: "delayedCast", requiresConfirmation: true},
	};
	const targetRows = new Set([
		14, 44, 47, 48, 63, 64, 65, 66, 67, 70, 72, 74, 76, 77, 78, 79, 81, 83, 85, 86,
		89, 90, 91, 92, 93, 94, 95, 96, 97,
	]);
	const worldRows = new Set([1, 3, 7, 8, 15, 16, 17, 21, 24, 26, 28, 30, 31, 34, 35, 37, 38, 50, 51, 54, 55, 56, 57, 58, 60, 61, 82, 84, 98, 100]);
	const areaRows = new Set([6, 18, 19, 23, 27, 39, 40, 41, 42, 43, 45, 46, 52, 59, 62, 68, 69, 71, 73, 75, 80, 87, 88]);

	return Object.fromEntries(Array.from({length: 100}, (_, ix) => {
		const roll = ix + 1;
		const text = entries[ix] || `Unspecified Gambling Table result ${roll}`;
		const explicit = automatic[roll] || confirm[roll];
		const scope = explicit?.scope || (areaRows.has(roll) ? "area" : targetRows.has(roll) ? "target" : worldRows.has(roll) ? "world" : "self");
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

export {CharacterSheetGamblerRules, GAMBLER_GAMBLING_TABLE};
