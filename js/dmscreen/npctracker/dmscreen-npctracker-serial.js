export class NpcTrackerSerializer {
	static VERSION = 1;

	static getDefaultState () {
		return {
			version: this.VERSION,
			settings: {
				selectedId: null,
				isIncludeAllCreatures: false,
			},
			npcs: [],
		};
	}

	static createNpc ({monster, fluff = null, alias = ""}) {
		if (!monster?.name || !monster?.source) throw new Error("NPCs require a name and source.");

		const hpMax = this._getHpMax(monster);
		return {
			id: CryptUtil.uid(),
			alias: alias.trim(),
			hp: {
				current: hpMax,
				max: hpMax,
				temp: 0,
			},
			monster: MiscUtil.copyFast(monster),
			fluff: fluff ? MiscUtil.copyFast(fluff) : null,
		};
	}

	static serialize (state) {
		const clean = this.deserialize(state);
		return {
			v: this.VERSION,
			s: {
				sel: clean.settings.selectedId,
				all: clean.settings.isIncludeAllCreatures,
			},
			n: clean.npcs.map(npc => ({
				id: npc.id,
				a: npc.alias,
				hp: {
					c: npc.hp.current,
					m: npc.hp.max,
					t: npc.hp.temp,
				},
				mon: MiscUtil.copyFast(npc.monster),
				fluff: npc.fluff ? MiscUtil.copyFast(npc.fluff) : null,
			})),
		};
	}

	static deserialize (raw) {
		const out = this.getDefaultState();
		if (!raw || typeof raw !== "object") return out;

		const rawNpcs = Array.isArray(raw.n) ? raw.n : Array.isArray(raw.npcs) ? raw.npcs : [];
		out.npcs = rawNpcs
			.map(rawNpc => this._deserializeNpc(rawNpc))
			.filter(Boolean);

		const rawSettings = raw.s || raw.settings || {};
		out.settings.isIncludeAllCreatures = !!(rawSettings.all ?? rawSettings.isIncludeAllCreatures);

		const selectedId = rawSettings.sel ?? rawSettings.selectedId ?? null;
		out.settings.selectedId = out.npcs.some(npc => npc.id === selectedId)
			? selectedId
			: out.npcs[0]?.id || null;

		return out;
	}

	static _deserializeNpc (rawNpc) {
		if (!rawNpc || typeof rawNpc !== "object") return null;

		const monster = rawNpc.mon || rawNpc.monster;
		if (!monster?.name || !monster?.source) return null;

		const hpMaxDefault = this._getHpMax(monster);
		const rawHp = rawNpc.hp || {};
		const hpMax = this._getNonNegativeNumber(rawHp.m ?? rawHp.max, hpMaxDefault);

		return {
			id: rawNpc.id || CryptUtil.uid(),
			alias: `${rawNpc.a ?? rawNpc.alias ?? ""}`.trim(),
			hp: {
				current: this._getNonNegativeNumber(rawHp.c ?? rawHp.current, hpMax),
				max: hpMax,
				temp: this._getNonNegativeNumber(rawHp.t ?? rawHp.temp, 0),
			},
			monster: MiscUtil.copyFast(monster),
			fluff: rawNpc.fluff ? MiscUtil.copyFast(rawNpc.fluff) : null,
		};
	}

	static _getHpMax (monster) {
		return this._getNonNegativeNumber(monster?.hp?.average, 0);
	}

	static _getNonNegativeNumber (value, fallback) {
		const num = Number(value);
		return Number.isFinite(num) ? Math.max(0, num) : fallback;
	}
}
