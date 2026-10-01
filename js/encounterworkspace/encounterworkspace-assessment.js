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
		suggestedHp: Number.isSafeInteger(effective.hp?.average) && effective.hp.average >= 1 && effective.hp.average <= 850
			? effective.hp.average : null,
		suggestedAc: effective.ac?.length === 1 && Number.isSafeInteger(effective.ac[0]?.ac)
			&& !effective.ac[0]?.condition
			&& effective.ac[0].ac >= 0 && effective.ac[0].ac <= 40 ? effective.ac[0].ac : null,
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
