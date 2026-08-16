export class NpcTrackerSerializer {
	static VERSION = 3;

	static getDefaultState () {
		return {
			version: this.VERSION,
			settings: {
				selectedId: null,
				isIncludeAllCreatures: false,
				isUnsortedCollapsed: false,
			},
			groups: [],
			npcs: [],
		};
	}

	static createNpc ({monster, fluff = null, alias = ""}) {
		if (!monster?.name || !monster?.source) throw new Error("NPCs require a name and source.");

		const hpMax = this._getHpMax(monster);
		return {
			id: CryptUtil.uid(),
			alias: alias.trim(),
			groupId: null,
			hp: {
				current: hpMax,
				max: hpMax,
				temp: 0,
			},
			conditions: [],
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
				uc: clean.settings.isUnsortedCollapsed,
			},
			g: clean.groups.map(group => ({
				id: group.id,
				n: group.name,
				c: group.isCollapsed,
			})),
			n: clean.npcs.map(npc => ({
				id: npc.id,
				a: npc.alias,
				g: npc.groupId,
				hp: {
					c: npc.hp.current,
					m: npc.hp.max,
					t: npc.hp.temp,
				},
				c: [...npc.conditions],
				mon: MiscUtil.copyFast(npc.monster),
				fluff: npc.fluff ? MiscUtil.copyFast(npc.fluff) : null,
			})),
		};
	}

	static deserialize (raw) {
		const out = this.getDefaultState();
		if (!raw || typeof raw !== "object") return out;

		const rawGroups = Array.isArray(raw.g) ? raw.g : Array.isArray(raw.groups) ? raw.groups : [];
		const seenGroupIds = new Set();
		out.groups = rawGroups
			.map(rawGroup => this._deserializeGroup(rawGroup))
			.filter(group => {
				if (!group || seenGroupIds.has(group.id)) return false;
				seenGroupIds.add(group.id);
				return true;
			});

		const rawNpcs = Array.isArray(raw.n) ? raw.n : Array.isArray(raw.npcs) ? raw.npcs : [];
		out.npcs = rawNpcs
			.map(rawNpc => this._deserializeNpc(rawNpc))
			.filter(Boolean);
		const validGroupIds = new Set(out.groups.map(group => group.id));
		out.npcs.forEach(npc => {
			if (!validGroupIds.has(npc.groupId)) npc.groupId = null;
		});

		const rawSettings = raw.s || raw.settings || {};
		out.settings.isIncludeAllCreatures = !!(rawSettings.all ?? rawSettings.isIncludeAllCreatures);
		out.settings.isUnsortedCollapsed = !!(rawSettings.uc ?? rawSettings.isUnsortedCollapsed);

		const selectedId = rawSettings.sel ?? rawSettings.selectedId ?? null;
		out.settings.selectedId = out.npcs.some(npc => npc.id === selectedId)
			? selectedId
			: out.npcs[0]?.id || null;

		return out;
	}

	static _deserializeGroup (rawGroup) {
		if (!rawGroup || typeof rawGroup !== "object") return null;
		const name = `${rawGroup.n ?? rawGroup.name ?? ""}`.trim();
		if (!name) return null;
		return {
			id: rawGroup.id || CryptUtil.uid(),
			name,
			isCollapsed: !!(rawGroup.c ?? rawGroup.isCollapsed),
		};
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
			groupId: rawNpc.g ?? rawNpc.groupId ?? null,
			hp: {
				current: this._getNonNegativeNumber(rawHp.c ?? rawHp.current, hpMax),
				max: hpMax,
				temp: this._getNonNegativeNumber(rawHp.t ?? rawHp.temp, 0),
			},
			conditions: this._getConditions(rawNpc.c ?? rawNpc.conditions),
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

	static _getConditions (conditions) {
		if (!Array.isArray(conditions)) return [];
		return [...new Set(conditions
			.map(condition => `${condition ?? ""}`.trim().toLowerCase())
			.filter(Boolean))];
	}
}

export function removeNpcTrackerGroup ({state, groupId}) {
	const ix = state.groups.findIndex(group => group.id === groupId);
	if (!~ix) return false;
	state.groups.splice(ix, 1);
	state.npcs.forEach(npc => {
		if (npc.groupId === groupId) npc.groupId = null;
	});
	return true;
}
