import {getEncounterEffectiveMonster} from "./encounterworkspace-state.js";

export function getEncounterMonsterXp (monster) {
	const cr = monster?.cr;
	if (cr && typeof cr === "object" && Object.hasOwn(cr, "xp")) {
		return Number.isSafeInteger(cr.xp) && cr.xp >= 0 ? cr.xp : null;
	}
	const rating = typeof cr === "object" ? cr?.cr : cr;
	return Parser.isValidCr(rating) ? Parser.crToXpNumber(rating) : null;
}

export function getEncounterXpSummary (instances) {
	let totalXp = 0n;
	let ratedCount = 0;
	for (const instance of instances) {
		const xp = getEncounterMonsterXp(getEncounterEffectiveMonster(instance));
		if (xp == null) continue;
		totalXp += BigInt(xp);
		ratedCount++;
	}
	return {totalXp, ratedCount, unknownCount: instances.length - ratedCount};
}

const CR_REVIEW_FIELDS = [
	["CR / XP", mon => mon.cr],
	["HP", mon => mon.hp],
	["AC", mon => mon.ac],
	["Ability scores", mon => [mon.str, mon.dex, mon.con, mon.int, mon.wis, mon.cha]],
	["Defenses", mon => [mon.resist, mon.immune, mon.vulnerable, mon.conditionImmune]],
	["Saving throws", mon => mon.save],
	["Traits", mon => mon.trait],
	["Actions", mon => mon.action],
	["Bonus actions", mon => mon.bonus],
	["Reactions", mon => mon.reaction],
	["Legendary actions", mon => mon.legendary],
	["Legendary uses", mon => [mon.legendaryActions, mon.legendaryActionsLair]],
	["Mythic actions", mon => mon.mythic],
	["Lair-action group", mon => mon.legendaryGroup],
	["Area tags", mon => mon.areaTags],
	["Spellcasting", mon => mon.spellcasting],
	["Speed / senses", mon => [mon.speed, mon.senses]],
];

export function getEncounterCrReview (instance) {
	const effective = getEncounterEffectiveMonster(instance);
	const changedFields = CR_REVIEW_FIELDS.filter(([, getValue]) =>
		JSON.stringify(getValue(instance.monster)) !== JSON.stringify(getValue(effective)));
	return {
		baselineCr: instance.monster.cr?.cr ?? instance.monster.cr ?? "Unknown",
		effectiveCr: effective.cr?.cr ?? effective.cr ?? "Unknown",
		baselineHp: instance.monster.hp?.average ?? "—",
		effectiveHp: effective.hp?.average ?? "—",
		baselineAc: instance.monster.ac?.length === 1 ? instance.monster.ac[0]?.ac ?? "—" : "varies",
		effectiveAc: effective.ac?.length === 1 ? effective.ac[0]?.ac ?? "—" : "varies",
		changes: changedFields.map(([name]) => name),
		changeDetails: changedFields.map(([name, getValue]) => {
			const current = getValue(effective);
			const names = Array.isArray(current) && ["Traits", "Actions", "Bonus actions", "Reactions", "Legendary actions", "Mythic actions", "Spellcasting"].includes(name)
				? current.map(it => it?.name).filter(Boolean)
				: name === "Lair-action group" && current?.name ? [current.name] : [];
			return `${name}${names.length ? ` (${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""})` : ""}`;
		}),
		operationCount: instance.statblockOperations?.length || 0,
		areaNotes: (instance.areaNotes || []).map(it => `${it.kind === "lair" ? "Lair note" : "Area note"}: ${it.name}`),
		manualReview: (instance.statblockOperations || []).flatMap(it =>
			(it.type === "applyCreatureTransformation" ? it.data?.manualReview || [] : [])
				.map(item => `${item.field}: ${item.reason}`)),
	};
}

const ATTACK_COUNTS = {one: 1, two: 2, three: 3, four: 4, five: 5, six: 6};
const DAMAGE_TYPES = "acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder";

function getDamageAverage (expression) {
	const raw = expression.replace(/\s+/g, "").toLowerCase();
	if (!/^[+-]?(?:\d+d\d+|\d+)(?:[+-](?:\d+d\d+|\d+))*$/.test(raw)) return null;
	let total = 0;
	for (const [term] of raw.matchAll(/[+-]?(?:\d+d\d+|\d+)/g)) {
		const sign = term.startsWith("-") ? -1 : 1;
		const [count, faces] = term.replace(/^[+-]/, "").split("d").map(Number);
		if (faces != null && (!Number.isSafeInteger(count) || count < 1 || count > 100 || !Number.isSafeInteger(faces) || faces < 2 || faces > 1000)) return null;
		total += sign * (faces == null ? count : count * (faces + 1) / 2);
	}
	return Number.isSafeInteger(Math.floor(total)) && total >= 0 && total <= 320 ? Math.floor(total) : null;
}

function getDamageFromHit (text) {
	if (/\b(?:if|unless|must (?:make|succeed)|each turn|start of)\b/i.test(text.split(/\.(?=\s+[A-Z])/)[0])) return null;
	const hit = text.split(/\.(?=\s+[A-Z])|\s+(?:if|or|on a (?:failed|successful))\s+/i)[0];
	const tags = [...hit.matchAll(/\{@damage\s+([^|}]+)(?:\|[^}]*)?\}/g)];
	if (hit.includes("{@damage") && !tags.length) return null;
	if (tags.length) {
		const amounts = tags.map(([, dice]) => getDamageAverage(dice));
		if (amounts.some(it => it == null)) return null;
		const remaining = hit.replace(/\b\d+\s*\(\s*\{@damage\s+[^}]+\}\s*\)/g, "")
			.replace(/\{@damage\s+[^}]+\}/g, "");
		const extras = [...remaining.matchAll(new RegExp(`\\b(\\d+)\\s+(?:${DAMAGE_TYPES})\\s+damage\\b`, "gi"))];
		return amounts.reduce((sum, it) => sum + it, 0) + extras.reduce((sum, [, value]) => sum + Number(value), 0);
	}
	const fixed = [...hit.matchAll(new RegExp(`\\b(\\d+)\\s+(?:${DAMAGE_TYPES})\\s+damage\\b`, "gi"))];
	return fixed.length ? fixed.reduce((sum, [, value]) => sum + Number(value), 0) : null;
}

function getActionDamage (entry) {
	if (!Array.isArray(entry?.entries) || !entry.entries.length) return null;
	const text = entry.entries.filter(it => typeof it === "string").join(" ");
	if (/\{@recharge\b|recharge \d|\/day\b/i.test(`${entry.name} ${text}`)) return null;
	if ([...text.matchAll(/\{@atk\s+[^}]+\}/g)].length > 1) return null;
	const attack = text.match(/\{@atk\s+[^}]+\}[\s\S]*?\{@hit\s+([+-]?\d+)(?:\|[^}]*)?\}[\s\S]*?\{@h\}/i);
	if (attack) {
		const hitText = text.slice(attack.index + attack[0].length);
		if (/on a failed save/i.test(hitText.split(/\.(?=\s+[A-Z])/)[0])) return null;
		const damage = getDamageFromHit(hitText);
		return damage == null ? null : {damage, attackType: "attack", attackValue: Number(attack[1])};
	}
	const save = text.match(/\bone (?:creature|target)\b[\s\S]*?\{@dc\s+(\d+)\}[\s\S]*?saving throw[\s\S]*?tak(?:es|ing)\s+/i);
	if (save && /(?:failed save|failure)/i.test(text)) {
		const damage = getDamageFromHit(text.slice(save.index + save[0].length));
		return damage == null ? null : {damage, attackType: "save", attackValue: Number(save[1])};
	}
	return null;
}

function getNamedAttack (actions, name) {
	const normalized = name.toLowerCase().trim().replace(/s$/, "");
	return actions.find(it => it.name?.toLowerCase().replace(/s$/, "") === normalized);
}

function getMultiattackPlan (entry, actions) {
	const text = entry.entries?.length === 1 && typeof entry.entries[0] === "string" ? entry.entries[0] : "";
	if (/\b(?:or|instead|replace|alternatively)\b/i.test(text) || text.split(/[.!?]/).filter(it => it.trim()).length > 1) return null;
	const countMatch = text.match(/\bmakes? (one|two|three|four|five|six|\d+) (?:[\w-]+ )?attacks?\b/i);
	if (!countMatch) return null;
	const count = ATTACK_COUNTS[countMatch[1].toLowerCase()] ?? Number(countMatch[1]);
	if (!Number.isSafeInteger(count) || count < 1 || count > 6) return null;
	const after = text.slice(countMatch.index + countMatch[0].length).split(".")[0];
	const parts = [...after.matchAll(/\b(one|two|three|four|five|six|\d+) with (?:its|the) ([a-z][\w -]*?)(?=\s+(?:and|,)|[.;]|$)/gi)];
	if (parts.length) {
		if (after.slice(0, parts[0].index).trim() !== ":"
			|| parts.some((part, ix) => ix && !/^\s*(?:,?\s*and\s+|,\s*)$/.test(after.slice(parts[ix - 1].index + parts[ix - 1][0].length, part.index)))
			|| after.slice(parts.at(-1).index + parts.at(-1)[0].length).trim()) return null;
		const plan = parts.map(([, number, name]) => ({
			count: ATTACK_COUNTS[number.toLowerCase()] ?? Number(number),
			action: getNamedAttack(actions, name),
		}));
		return plan.every(it => it.action) && plan.reduce((sum, it) => sum + it.count, 0) === count ? plan : null;
	}
	const named = after.match(/^\s+with (?:its|the) ([\w -]+)$/i)?.[1]
		|| countMatch[0].match(/\bmakes? (?:one|two|three|four|five|six|\d+) ([\w-]+) attacks?\b/i)?.[1];
	const otherActions = actions.filter(it => it.name !== "Multiattack");
	const action = named ? getNamedAttack(actions, named) : otherActions.length === 1 && getActionDamage(otherActions[0])?.attackType === "attack"
		? otherActions[0] : null;
	return action ? [{count, action}] : null;
}

export function getEncounterCrInferences (instance) {
	const monster = getEncounterEffectiveMonster(instance);
	const values = {
		hp: !monster.hp?.special && Number.isSafeInteger(monster.hp?.average) && monster.hp.average >= 1 && monster.hp.average <= 850 ? monster.hp.average : null,
		ac: monster.ac?.length === 1 && Number.isSafeInteger(monster.ac[0]?.ac)
			&& !monster.ac[0]?.condition && monster.ac[0].ac >= 0 && monster.ac[0].ac <= 40 ? monster.ac[0].ac : null,
		damageOverThreeRounds: null,
		attackType: "attack",
		attackValue: null,
	};
	const evidence = [];
	const exclusions = [];
	if (values.hp != null) evidence.push(`HP ${values.hp}: effective statblock average (unadjusted for defenses)`);
	if (values.ac != null) evidence.push(`AC ${values.ac}: sole unconditional effective AC`);
	const actions = Array.isArray(monster.action) ? monster.action : [];
	const multiattack = actions.find(it => it.name === "Multiattack");
	const plan = multiattack ? getMultiattackPlan(multiattack, actions) : null;
	if (multiattack && !plan) exclusions.push("Multiattack sequence needs DM choice");
	const candidates = plan || (!multiattack
		? actions.map(action => ({count: 1, action})).filter(it => getActionDamage(it.action))
		: []);
	const chosen = plan || candidates.sort((a, b) =>
		getActionDamage(b.action).damage - getActionDamage(a.action).damage).slice(0, 1);
	if (chosen.length) {
		const attacks = chosen.map(({count, action}) => ({count, action, parsed: getActionDamage(action)}));
		if (attacks.every(it => it.parsed)) {
			const damage = attacks.reduce((sum, it) => sum + it.count * it.parsed.damage, 0);
			if (damage <= 320) {
				values.damageOverThreeRounds = damage * 3;
				evidence.push(`3-round damage ${damage * 3}: ${attacks.map(it => `${it.count} × ${it.action.name} (${it.parsed.damage})`).join(" + ")} each round, single target${attacks[0].parsed.attackType === "save" ? ", assuming failed save" : ""}`);
			}
			const measures = [...new Set(attacks.map(it => `${it.parsed.attackType}:${it.parsed.attackValue}`))];
			if (measures.length === 1 && attacks[0].parsed.attackValue <= 40) {
				values.attackType = attacks[0].parsed.attackType;
				values.attackValue = attacks[0].parsed.attackValue;
				evidence.push(`${values.attackType === "save" ? "Save DC" : "Attack bonus"} ${values.attackValue}: ${attacks[0].action.name}`);
			} else exclusions.push("Mixed or out-of-range attack bonuses/save DCs need DM choice");
			if (attacks.some(it => it.action.entries.length > 1 || it.action.entries.some(entry => typeof entry !== "string"))) {
				exclusions.push("Additional attack entries/options excluded");
			}
			if (attacks.some(it => JSON.stringify(it.action.entries).match(/\b(?:if|saving throw|on a failed save)\b/i))) {
				exclusions.push("Conditional effects after an attack hit are excluded");
			}
		} else exclusions.push("Multiattack includes damage that cannot be determined");
	}
	if (actions.some(it => it.name !== "Multiattack" && !chosen.some(choice => choice.action === it))) {
		exclusions.push("Other actions and choices (including recharge or area effects) excluded");
	}
	if (monster.bonus?.length || monster.reaction?.length || monster.legendary?.length || monster.legendaryActions
		|| monster.mythic?.length || monster.legendaryGroup) {
		exclusions.push("Bonus/reaction/legendary/mythic/lair effects excluded; frequency and targets need DM review");
	}
	if (monster.spellcasting?.length) exclusions.push("Spellcasting excluded; spell and slot choices need DM review");
	if (monster.trait?.length || monster.resist?.length || monster.immune?.length || monster.vulnerable?.length || monster.conditionImmune?.length) {
		exclusions.push("Traits and defenses excluded from effective HP/damage; review conditions and resistances");
	}
	const missing = [
		values.hp == null ? "effective HP" : null,
		values.ac == null ? "unconditional AC" : null,
		values.damageOverThreeRounds == null ? "three-round damage" : null,
		values.attackValue == null ? "attack bonus or save DC" : null,
	].filter(Boolean);
	return {values, evidence, exclusions, missing};
}

function getCrNumber (cr) {
	if (cr.includes("/")) {
		const [numerator, denominator] = cr.split("/").map(Number);
		return numerator / denominator;
	}
	return Number(cr);
}

function getCrFromAverage (average) {
	if (average >= 1) return String(Math.min(30, Math.round(average)));
	if (average > 0.5625) return "1";
	if (average > 0.375) return "1/2";
	if (average > 0.1875) return "1/4";
	if (average > 0) return "1/8";
	return "0";
}

export function getEncounterCrEstimate ({hp, ac, damageOverThreeRounds, attackValue, attackType}, rows) {
	if (!Array.isArray(rows) || rows.length !== Parser.CRS.length
		|| rows.some((row, ix) => row._cr !== Parser.CRS[ix])) {
		throw new Error("The 2014 CR reference table could not be read.");
	}
	for (const [value, min, max, label] of [
		[hp, 1, 850, "effective HP"],
		[ac, 0, 40, "effective AC"],
		[damageOverThreeRounds, 0, 960, "three-round damage"],
		[attackValue, attackType === "save" ? 0 : -10, 40, attackType === "save" ? "save DC" : "attack bonus"],
	]) {
		if (!Number.isSafeInteger(value) || value < min || value > max) {
			throw new Error(`Enter ${label} as a whole number from ${min} to ${max}.`);
		}
	}
	if (!["attack", "save"].includes(attackType)) throw new Error("Choose attack bonus or save DC.");
	const dpr = Math.floor(damageOverThreeRounds / 3);
	const defensiveIndex = rows.findLastIndex(row => hp >= row.hpMin && hp <= row.hpMax);
	const offensiveIndex = rows.findLastIndex(row => dpr >= row.dprMin && dpr <= row.dprMax);
	if (defensiveIndex < 0 || offensiveIndex < 0) throw new Error("These assumptions fall outside the 2014 CR table.");
	const adjust = (ix, measured, expected) => Math.max(0, Math.min(rows.length - 1,
		ix + Math.trunc((measured - expected) / 2)));
	const defensiveCr = rows[adjust(defensiveIndex, ac, rows[defensiveIndex].ac)]._cr;
	const offensiveCr = rows[adjust(offensiveIndex, attackValue,
		rows[offensiveIndex][attackType === "save" ? "saveDc" : "attackBonus"])]._cr;
	return {
		cr: getCrFromAverage((getCrNumber(defensiveCr) + getCrNumber(offensiveCr)) / 2),
		defensiveCr,
		offensiveCr,
		dpr,
	};
}
