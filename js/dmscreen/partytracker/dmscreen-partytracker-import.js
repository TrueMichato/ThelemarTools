import {PartyTrackerCharacterSerializer} from "./dmscreen-partytracker-serial.js";

export class PartyTrackerImporter {
	/**
	 * Map a Character Sheet export JSON to Party Tracker character data.
	 * @param {object} csData — raw Character Sheet `toJson()` output
	 * @returns {object} — deserialized Party Tracker character data
	 */
	static mapCharacterSheetData (csData) {
		if (!csData || typeof csData !== "object") throw new Error("Invalid character sheet data");

		const abilities = this._computeAbilities(csData);
		const classes = this._mapClasses(csData);
		const name = csData.name || "";

		if (!name && !classes.some(c => c.name)) throw new Error("Character has no name or class");

		return PartyTrackerCharacterSerializer.deserialize({
			n: name,
			r: this._mapRace(csData),
			cl: classes.map(c => ({n: c.name, l: c.level, s: c.source})),
			ab: abilities,
			sv: this._mapSaveProficiencies(csData),
			sp: this._mapSkillProficiencies(csData),
			tp: this._mapToolProficiencies(csData),
			lng: this._mapLanguages(csData),
			ac: this._computeAc(csData),
			hp: {c: csData.hp?.current ?? 0, m: csData.hp?.max ?? 0, t: csData.hp?.temp ?? 0},
			spd: this._mapSpeed(csData),
			sns: this._mapSenses(csData),
			ct: csData.combatTraditions || [],
			exh: csData.exhaustion ?? 0,
			cw: this._computeWeight(csData),
			cnd: (csData.conditions || []).map(c => typeof c === "string" ? {n: c, s: null} : {n: c.name || c, s: c.source || null}),
			dis: [],
			nt: "",
			ctr: [],
		});
	}

	/**
	 * Validate that an object looks like a Character Sheet export.
	 * @param {object} data
	 * @returns {{valid: boolean, reason?: string}}
	 */
	static validate (data) {
		if (!data || typeof data !== "object") return {valid: false, reason: "Not an object"};
		if (!data.abilities) return {valid: false, reason: "Missing 'abilities' — not a character sheet export"};
		if (!data.classes && !Array.isArray(data.classes)) return {valid: false, reason: "Missing 'classes' array"};
		return {valid: true};
	}

	/* -------------------------------------------- */
	//  Mapping helpers
	/* -------------------------------------------- */

	static _computeAbilities (csData) {
		const out = {};
		for (const ability of ["str", "dex", "con", "int", "wis", "cha"]) {
			const base = csData.abilities?.[ability] || 10;
			const racial = csData.abilityBonuses?.[ability] || 0;
			const feature = csData.customModifiers?.abilityScores?.[ability] || 0;
			const direct = csData.directAbilityBonuses?.[ability] || 0;
			let computed = base + racial + feature + direct;

			const itemBonus = csData.itemAbilityOverrides?.bonus?.[ability] || 0;
			computed += itemBonus;

			const itemStatic = csData.itemAbilityOverrides?.static?.[ability];
			if (itemStatic && itemStatic > computed) computed = itemStatic;

			const customStatic = csData.customModifiers?.abilityScoreStatic?.[ability];
			if (customStatic && customStatic > computed) computed = customStatic;

			out[ability] = Math.max(1, Math.min(30, computed));
		}
		return out;
	}

	static _mapClasses (csData) {
		if (!Array.isArray(csData.classes) || !csData.classes.length) return [{name: "", level: 1, source: null}];
		return csData.classes.map(c => ({
			name: c.name || "",
			level: c.level || 1,
			source: c.source || null,
		}));
	}

	static _mapRace (csData) {
		if (typeof csData.race === "string") return csData.race;
		if (csData.race?.name) {
			const sub = csData.subrace?.name;
			return sub ? `${csData.race.name} (${sub})` : csData.race.name;
		}
		return "";
	}

	static _mapSaveProficiencies (csData) {
		const out = {str: false, dex: false, con: false, int: false, wis: false, cha: false};
		if (Array.isArray(csData.saveProficiencies)) {
			for (const s of csData.saveProficiencies) out[s] = true;
		} else if (csData.saveProficiencies && typeof csData.saveProficiencies === "object") {
			Object.assign(out, csData.saveProficiencies);
		}
		return out;
	}

	static _mapSkillProficiencies (csData) {
		if (!csData.skillProficiencies || typeof csData.skillProficiencies !== "object") return {};
		return {...csData.skillProficiencies};
	}

	static _mapToolProficiencies (csData) {
		if (Array.isArray(csData.toolProficiencies)) return [...csData.toolProficiencies];
		if (typeof csData.toolProficiencies === "string") return csData.toolProficiencies.split(",").map(s => s.trim()).filter(Boolean);
		return [];
	}

	static _mapLanguages (csData) {
		if (Array.isArray(csData.languages)) return [...csData.languages];
		return [];
	}

	static _computeAc (csData) {
		if (typeof csData.ac === "number") return csData.ac;
		if (csData.ac && typeof csData.ac === "object") {
			let total = csData.ac.base ?? 10;
			total += csData.ac.itemBonus || 0;
			if (Array.isArray(csData.ac.bonuses)) {
				for (const b of csData.ac.bonuses) total += b.value || 0;
			}
			return total;
		}
		return 10;
	}

	static _mapSpeed (csData) {
		if (!csData.speed || typeof csData.speed !== "object") return {walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0};
		return {
			walk: csData.speed.walk ?? 30,
			fly: csData.speed.fly ?? 0,
			swim: csData.speed.swim ?? 0,
			climb: csData.speed.climb ?? 0,
			burrow: csData.speed.burrow ?? 0,
		};
	}

	static _mapSenses (csData) {
		if (!csData.senses || typeof csData.senses !== "object") return {darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0};
		return {
			darkvision: csData.senses.darkvision ?? 0,
			blindsight: csData.senses.blindsight ?? 0,
			tremorsense: csData.senses.tremorsense ?? 0,
			truesight: csData.senses.truesight ?? 0,
		};
	}

	static _computeWeight (csData) {
		if (typeof csData.currentWeight === "number") return csData.currentWeight;
		if (!Array.isArray(csData.inventory)) return 0;
		let total = 0;
		for (const item of csData.inventory) {
			total += (item.weight || 0) * (item.quantity || 1);
		}
		return Math.round(total * 100) / 100;
	}
}
