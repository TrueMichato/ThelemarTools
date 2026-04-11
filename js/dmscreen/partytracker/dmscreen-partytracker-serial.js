export class PartyTrackerCharacterSerializer {
	static serialize (char) {
		return {
			id: char.id,
			n: char.name,
			r: char.race,
			cl: char.classes?.map(c => ({n: c.name, l: c.level, s: c.source})),
			ab: char.abilities,
			sv: char.saveProficiencies,
			sp: char.skillProficiencies,
			tp: char.toolProficiencies,
			lng: char.languages,
			ac: char.ac,
			spd: char.speed,
			sns: char.senses,
			ct: char.combatTraditions,
			exh: char.exhaustionLevel,
			ov: char.overrides,
			bon: char.bonuses,
			ja: char.journeyActions,
			nt: char.notes,
			cnd: char.conditions?.map(c => ({n: c.name, s: c.source})),
			dis: char.diseases?.map(d => ({n: d.name, s: d.source})),
			ctr: char.counters,
		};
	}

	static deserialize (raw) {
		return {
			id: raw.id || CryptUtil.uid(),
			name: raw.n || "",
			race: raw.r || "",
			classes: raw.cl?.map(c => ({name: c.n || "", level: c.l || 1, source: c.s || null})) || [{name: "", level: 1, source: null}],
			abilities: {
				str: 10,
				dex: 10,
				con: 10,
				int: 10,
				wis: 10,
				cha: 10,
				...(raw.ab || {}),
			},
			saveProficiencies: {
				str: false,
				dex: false,
				con: false,
				int: false,
				wis: false,
				cha: false,
				...(raw.sv || {}),
			},
			skillProficiencies: {
				...PartyTrackerCharacterSerializer._getDefaultSkillProficiencies(),
				...(raw.sp || {}),
			},
			toolProficiencies: raw.tp || [],
			languages: raw.lng || [],
			ac: raw.ac ?? 10,
			speed: {walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0, ...(raw.spd || {})},
			senses: {darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0, ...(raw.sns || {})},
			combatTraditions: raw.ct || [],
			exhaustionLevel: raw.exh ?? 0,
			journeyActions: raw.ja ?? 1,
			overrides: {
				proficiencyBonus: null,
				skillBonuses: {},
				saveBonuses: {},
				carryCapacity: null,
				combatMethodDc: null,
				...(raw.ov || {}),
			},
			bonuses: {
				skills: {},
				saves: {},
				passives: {},
				...(raw.bon || {}),
			},
			notes: raw.nt || "",
			conditions: (raw.cnd || []).map(c => typeof c === "string" ? {name: c, source: null} : {name: c.n || c.name || "", source: c.s || c.source || null}),
			diseases: (raw.dis || []).map(d => typeof d === "string" ? {name: d, source: null} : {name: d.n || d.name || "", source: d.s || d.source || null}),
			counters: raw.ctr?.map(c => ({name: c.name || "", current: c.current ?? 0, max: c.max ?? 0})) || [],
		};
	}

	static getDefaultCharacter () {
		return this.deserialize({});
	}

	static _getDefaultSkillProficiencies () {
		const out = {};
		for (const skill of PartyTrackerCharacterSerializer.STANDARD_SKILLS) out[skill] = 0;
		for (const skill of PartyTrackerCharacterSerializer.TGTT_SKILLS) out[skill] = 0;
		return out;
	}

	static STANDARD_SKILLS = [
		"athletics",
		"acrobatics",
		"sleightOfHand",
		"stealth",
		"arcana",
		"history",
		"investigation",
		"nature",
		"religion",
		"animalHandling",
		"insight",
		"medicine",
		"perception",
		"survival",
		"deception",
		"intimidation",
		"performance",
		"persuasion",
	];

	static TGTT_SKILLS = [
		"cooking",
		"culture",
		"endurance",
		"engineering",
		"harvesting",
		"linguistics",
		"might",
	];

	static SKILL_TO_ABILITY = {
		// Standard 18
		athletics: "str",
		acrobatics: "dex",
		sleightOfHand: "dex",
		stealth: "dex",
		arcana: "int",
		history: "int",
		investigation: "int",
		nature: "int",
		religion: "int",
		animalHandling: "wis",
		insight: "wis",
		medicine: "wis",
		perception: "wis",
		survival: "wis",
		deception: "cha",
		intimidation: "cha",
		performance: "cha",
		persuasion: "cha",
		// TGTT 7
		cooking: "wis",
		culture: "int",
		endurance: "con",
		engineering: "int",
		harvesting: "wis",
		linguistics: "int",
		might: "str",
	};

	static SKILL_DISPLAY_NAMES = {
		athletics: "Athletics",
		acrobatics: "Acrobatics",
		sleightOfHand: "Sleight of Hand",
		stealth: "Stealth",
		arcana: "Arcana",
		history: "History",
		investigation: "Investigation",
		nature: "Nature",
		religion: "Religion",
		animalHandling: "Animal Handling",
		insight: "Insight",
		medicine: "Medicine",
		perception: "Perception",
		survival: "Survival",
		deception: "Deception",
		intimidation: "Intimidation",
		performance: "Performance",
		persuasion: "Persuasion",
		// TGTT
		cooking: "Cooking",
		culture: "Culture",
		endurance: "Endurance",
		engineering: "Engineering",
		harvesting: "Harvesting",
		linguistics: "Linguistics",
		might: "Might",
	};

	static ABILITY_DISPLAY = {
		str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA",
	};

	static COMBAT_TRADITIONS = {
		AM: "Adamant Mountain",
		AK: "Arcane Knight",
		BU: "Beast Unity",
		BZ: "Biting Zephyr",
		CJ: "Comedic Jabs",
		EB: "Eldritch Blackguard",
		GH: "Gallant Heart",
		MG: "Mirror's Glint",
		MS: "Mist and Shade",
		RC: "Rapid Current",
		RE: "Razor's Edge",
		SK: "Sanguine Knot",
		SS: "Spirited Steed",
		TI: "Tempered Iron",
		TC: "Tooth and Claw",
		UW: "Unending Wheel",
		UH: "Unerring Hawk",
	};

	static serializeSettings (settings) {
		return {
			et: settings.enableTgtt,
			tcw: settings.thelemar_carryWeight,
			tj: settings.thelemar_jumping,
			tlb: settings.thelemar_linguisticsBonus,
			tcr: settings.thelemar_criticalRolls,
			exr: settings.exhaustionRules,
		};
	}

	static deserializeSettings (raw) {
		return {
			enableTgtt: raw?.et ?? false,
			thelemar_carryWeight: raw?.tcw ?? true,
			thelemar_jumping: raw?.tj ?? true,
			thelemar_linguisticsBonus: raw?.tlb ?? true,
			thelemar_criticalRolls: raw?.tcr ?? true,
			exhaustionRules: raw?.exr ?? "thelemar",
		};
	}
}
