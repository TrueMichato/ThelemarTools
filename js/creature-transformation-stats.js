const ABILITIES = new Set(["str", "dex", "con", "int", "wis", "cha"]);
const DICE = new Set([4, 6, 8, 10, 12, 20]);
const STAT_OPS = new Set(["setHitPoints", "setSaveBonus", "setSkillBonus", "setPassivePerception", "setProficiencyBonus"]);
const isRecord = value => value != null && typeof value === "object" && !Array.isArray(value);
const keysAre = (value, keys) => isRecord(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const isInteger = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const isSkill = skill => Object.hasOwn(Parser.SKILL_TO_ATB_ABV, skill);
const bonusString = value => `${value >= 0 ? "+" : ""}${value}`;

function fail (message) {
	const error = new Error(`Numeric reconciliation: ${message}`);
	error.code = "CREATURE_TRANSFORMATION_INPUT_REQUIRED";
	throw error;
}

function expectKeys (value, allowed, label) {
	if (!isRecord(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(`${label} has unsupported fields or is not an object.`);
}

function integer (value, min, max, label) {
	if (!isInteger(value, min, max)) fail(`${label} must be an integer from ${min} to ${max}.`);
	return value;
}

export function getCreatureTransformationProficiencyBonus (current, proficiencyBonus, {checkNote = false} = {}) {
	let value = current.profBonus;
	if (value !== undefined) integer(value, 1, 30, "Current explicit proficiency bonus");
	if (checkNote && current.pbNote != null) {
		if (typeof current.pbNote !== "string" || !/^\+?[1-9]\d*$/.test(current.pbNote)) fail("Existing pbNote is not a plain numeric proficiency bonus; resolve its authored rule before changing PB.");
		const note = integer(Number(current.pbNote), 1, 30, "Existing numeric pbNote");
		if (value !== undefined && value !== note) fail("Current profBonus disagrees with the existing numeric pbNote; resolve the source PB before changing it.");
		value = note;
	}
	if (proficiencyBonus !== undefined) {
		integer(proficiencyBonus, 1, 30, "Input proficiency bonus");
		if (value !== undefined && value !== proficiencyBonus) fail("Input proficiency bonus disagrees with the current target.");
		value = proficiencyBonus;
	}
	return value;
}

function getDice (formula) {
	if (typeof formula !== "string" || formula.length > 80) return null;
	const match = /^([1-9]\d*)d(4|6|8|10|12|20)(?:\s*([+-])\s*(\d+))?$/i.exec(formula);
	if (!match) return null;
	const number = Number(match[1]);
	const faces = Number(match[2]);
	const bonus = match[3] ? Number(`${match[3]}${match[4]}`) : 0;
	return isInteger(number, 1, 10_000) && isInteger(bonus, -1_000_000, 1_000_000) ? {number, faces, bonus} : null;
}

function isHp (value) {
	return keysAre(value, ["average", "formula"]) && isInteger(value.average, 1, 1_000_000) && !!getDice(value.formula);
}

export function isCreatureTransformationStatOp (op) {
	return STAT_OPS.has(op);
}

export function isCreatureTransformationStatChange (step, key = "op") {
	const op = step?.[key];
	switch (op) {
		case "setHitPoints": return keysAre(step, [key, "value"]) && isHp(step.value);
		case "setSaveBonus": return keysAre(step, [key, "ability", "value"]) && ABILITIES.has(step.ability) && isInteger(step.value, -10_000, 10_000);
		case "setSkillBonus": return keysAre(step, [key, "skill", "value"]) && isSkill(step.skill) && isInteger(step.value, -10_000, 10_000);
		case "setPassivePerception": return keysAre(step, [key, "value"]) && isInteger(step.value, 0, 10_000);
		case "setProficiencyBonus": return keysAre(step, [key, "value"]) && isInteger(step.value, 1, 30);
		default: return false;
	}
}

function getHp ({current, abilities, hp, getMod}) {
	expectKeys(hp, ["mode", "hitDice", "residual", "bonusPerHitDie", "bonusFixed", "value"], "HP policy");
	if (hp.mode === "retain") {
		if (!keysAre(hp, ["mode"])) fail("Retained HP cannot also request numerical changes.");
		return null;
	}
	if (hp.mode === "override") {
		if (!keysAre(hp, ["mode", "value"]) || !isHp(hp.value)) fail("HP override needs concrete average and supported Hit Dice formula only.");
		return structuredClone(hp.value);
	}
	if (hp.mode !== "constitution" || Object.hasOwn(hp, "value")) fail("Choose an explicit retain, constitution, or override HP policy.");
	if (!isHp(current.hp)) fail("HP needs a concrete average and a single Nd4/6/8/10/12/20 formula with an optional integer bonus; special or mixed formulas require an override.");
	const old = getDice(current.hp.formula);
	const getMean = (number, faces, bonus) => Math.max(1, Math.floor(number * (faces + 1) / 2 + bonus));
	if (current.hp.average !== getMean(old.number, old.faces, old.bonus)) fail("HP average disagrees with its formula; choose retain or an explicit authored override.");
	const oldCon = getMod("con", current);
	const newCon = getMod("con", {...current, ...abilities});
	const dice = hp.hitDice === undefined ? {number: old.number, faces: old.faces} : hp.hitDice;
	if (!keysAre(dice, ["number", "faces"]) || !isInteger(dice.number, 1, 10_000) || !DICE.has(dice.faces)) fail("Hit Dice need a positive bounded count and supported die size.");
	const residual = old.bonus - old.number * oldCon;
	let extra = residual;
	if (hp.residual !== undefined) {
		if (!keysAre(hp.residual, ["perHitDie", "fixed"])) fail("HP residual needs explicit perHitDie and fixed components.");
		const perHitDie = integer(hp.residual.perHitDie, -1_000_000, 1_000_000, "HP per-Hit-Die residual");
		const fixed = integer(hp.residual.fixed, -1_000_000, 1_000_000, "HP fixed residual");
		if (old.number * perHitDie + fixed !== residual) fail("HP residual components do not explain the current formula's non-Constitution bonus.");
		extra = dice.number * perHitDie + fixed;
	} else if (dice.number !== old.number && residual !== 0) fail("Changing Hit Dice with a non-Constitution bonus requires its per-Hit-Die/fixed binding.");
	const addedPerDie = hp.bonusPerHitDie === undefined ? 0 : integer(hp.bonusPerHitDie, -1_000_000, 1_000_000, "Added HP per Hit Die");
	const addedFixed = hp.bonusFixed === undefined ? 0 : integer(hp.bonusFixed, -1_000_000, 1_000_000, "Added fixed HP");
	const bonus = integer(dice.number * (newCon + addedPerDie) + extra + addedFixed, -1_000_000, 1_000_000, "HP formula bonus");
	const value = {
		average: getMean(dice.number, dice.faces, bonus),
		formula: `${dice.number}d${dice.faces}${bonus ? ` ${bonus < 0 ? "-" : "+"} ${Math.abs(bonus)}` : ""}`,
	};
	if (!isHp(value)) fail("Calculated HP is outside the supported bounds.");
	if (dice.number === old.number && dice.faces === old.faces && bonus === old.bonus) return structuredClone(current.hp);
	return value;
}

/**
 * Compile only concrete numeric setters. PB is never inferred from CR or from a bonus's magnitude.
 * With unchanged PB, ability deltas preserve every existing proficiency and authored residual.
 */
export function compileCreatureTransformationStats (options) {
	expectKeys(options, ["current", "abilities", "hp", "proficiencyBonus", "nextProficiencyBonus", "bindings"], "Numeric inputs");
	const {current, abilities = {}, hp = {mode: "constitution"}, proficiencyBonus, nextProficiencyBonus, bindings = {}} = options;
	if (!isRecord(current)) fail("A current target is required.");
	expectKeys(abilities, [...ABILITIES], "Ability changes");
	const getMod = (ability, creature) => Parser.getAbilityModNumber(integer(creature[ability], 1, 30, `${ability} score`));
	const changes = [];
	for (const [ability, score] of Object.entries(abilities)) {
		getMod(ability, current);
		integer(score, 1, 30, `${ability} output score`);
		if (score !== current[ability]) changes.push({op: "setAbility", ability, value: score});
	}
	const points = getHp({current, abilities, hp, getMod});
	if (points && (points.average !== current.hp?.average || points.formula !== current.hp?.formula)) changes.push({op: "setHitPoints", value: points});
	expectKeys(bindings, ["save", "skill"], "Proficiency bindings");
	const pbIn = getCreatureTransformationProficiencyBonus(current, proficiencyBonus, {checkNote: nextProficiencyBonus !== undefined});
	let pbDelta = 0;
	if (nextProficiencyBonus !== undefined) {
		integer(nextProficiencyBonus, 1, 30, "Output proficiency bonus");
		if (pbIn === undefined) fail("A PB change requires the existing or explicitly supplied current proficiency bonus, not a CR estimate.");
		pbDelta = nextProficiencyBonus - pbIn;
		if (current.profBonus !== nextProficiencyBonus || current.pbNote !== bonusString(nextProficiencyBonus)) changes.push({op: "setProficiencyBonus", value: nextProficiencyBonus});
	}
	const out = {...current, ...abilities};
	const bonuses = {};
	for (const section of ["save", "skill"]) {
		const listed = current[section] === undefined ? {} : current[section];
		const supplied = bindings[section] === undefined ? {} : bindings[section];
		expectKeys(listed, section === "save" ? [...ABILITIES] : Object.keys(Parser.SKILL_TO_ATB_ABV), `${section} bonuses (conditional/alternative bindings are not supported)`);
		expectKeys(supplied, Object.keys(listed), `${section} proficiency bindings`);
		bonuses[section] = {};
		for (const [name, raw] of Object.entries(listed)) {
			if (typeof raw !== "string" || !/^[+-]?\d+$/.test(raw)) fail(`${section}.${name} must be a concrete integer bonus, not a formula or conditional value.`);
			const old = integer(Number(raw), -10_000, 10_000, `${section}.${name}`);
			const ability = section === "save" ? name : Parser.skillToAbilityAbv(name);
			const multiplier = supplied[name];
			if (multiplier !== undefined && ![0, 1, 2].includes(multiplier)) fail(`${section}.${name} needs a proficiency multiplier of 0, 1 or 2.`);
			if (pbDelta && multiplier === undefined) fail(`PB change requires an explicit proficiency/expertise multiplier for ${section}.${name}; a total alone is ambiguous.`);
			const value = integer(old + getMod(ability, out) - getMod(ability, current) + (pbDelta ? multiplier * pbDelta : 0), -10_000, 10_000, `${section}.${name} output`);
			bonuses[section][name] = value;
			if (value !== old) changes.push(section === "save" ? {op: "setSaveBonus", ability: name, value} : {op: "setSkillBonus", skill: name, value});
		}
	}
	const oldPerception = current.skill?.perception === undefined ? getMod("wis", current) : Number(current.skill.perception);
	const newPerception = bonuses.skill.perception ?? getMod("wis", out);
	if (current.passive !== undefined) integer(current.passive, 0, 10_000, "Passive Perception");
	const passive = integer(current.passive === undefined ? 10 + newPerception : current.passive + newPerception - oldPerception, 0, 10_000, "Output passive Perception");
	if (passive !== current.passive) changes.push({op: "setPassivePerception", value: passive});
	return changes;
}

export {bonusString as formatCreatureTransformationBonus};
