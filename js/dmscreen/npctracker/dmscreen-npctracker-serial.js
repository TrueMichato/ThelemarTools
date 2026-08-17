import {
	getNpcTrackerChargeDefaults,
	getNpcTrackerLegendaryActionDefault,
	getNpcTrackerLegendaryResistanceDefault,
	getNpcTrackerRechargeDefaults,
	getNpcTrackerSpellSlotDefaults,
} from "./dmscreen-npctracker-resource.js";

export function getNpcTrackerVitalsDefaults (monster) {
	return {
		deathSaves: {successes: 0, failures: 0},
		legendaryResistances: getNpcTrackerLegendaryResistanceDefault(monster),
		legendaryActions: getNpcTrackerLegendaryActionDefault(monster),
		recharges: getNpcTrackerRechargeDefaults(monster),
		concentration: "",
	};
}

export class NpcTrackerSerializer {
	static VERSION = 5;

	static getDefaultState () {
		return {
			version: this.VERSION,
			settings: {
				selectedId: null,
				isIncludeAllCreatures: false,
				isUnsortedCollapsed: false,
				textSize: "normal",
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
			spellSlots: getNpcTrackerSpellSlotDefaults(monster),
			charges: getNpcTrackerChargeDefaults(monster),
			vitals: getNpcTrackerVitalsDefaults(monster),
			reactionUsed: false,
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
				ts: clean.settings.textSize,
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
				ss: Object.fromEntries(Object.entries(npc.spellSlots).map(([level, slots]) => [level, {
					c: slots.current,
					m: slots.max,
				}])),
				ch: npc.charges.map(charge => ({
					id: charge.id,
					n: charge.name,
					c: charge.current,
					m: charge.max,
					a: charge.isAuto,
				})),
				vi: this._serializeVitals(npc.vitals),
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
		out.settings.textSize = this._getTextSize(rawSettings.ts ?? rawSettings.textSize);

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
			spellSlots: this._getSpellSlots(rawNpc.ss ?? rawNpc.spellSlots, monster),
			charges: this._getCharges(rawNpc.ch ?? rawNpc.charges, monster),
			vitals: this._getVitals(rawNpc.vi ?? rawNpc.vitals, monster),
			reactionUsed: false,
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

	static _getTextSize (value) {
		return ["normal", "large", "x-large", "xx-large"].includes(value) ? value : "normal";
	}

	static _getSpellSlots (spellSlots, monster) {
		const defaults = getNpcTrackerSpellSlotDefaults(monster);
		if (!spellSlots || typeof spellSlots !== "object" || Array.isArray(spellSlots)) return defaults;

		const out = {};
		const levels = new Set([...Object.keys(defaults), ...Object.keys(spellSlots)]);
		levels.forEach(level => {
			const levelNumber = Number(level);
			if (!Number.isInteger(levelNumber) || levelNumber < 1) return;
			const rawSlots = spellSlots[level] || {};
			const defaultMax = defaults[level]?.max || 0;
			const max = Math.floor(this._getNonNegativeNumber(rawSlots.m ?? rawSlots.max, defaultMax));
			if (!max) return;
			const current = Math.floor(this._getNonNegativeNumber(rawSlots.c ?? rawSlots.current, max));
			out[level] = {current: Math.min(current, max), max};
		});
		return out;
	}

	static _getCharges (charges, monster) {
		const defaults = getNpcTrackerChargeDefaults(monster);
		if (!Array.isArray(charges)) return defaults;
		const seenIds = new Set();
		return charges.map(rawCharge => {
			if (!rawCharge || typeof rawCharge !== "object") return null;
			const name = `${rawCharge.n ?? rawCharge.name ?? ""}`.trim();
			const max = Math.floor(this._getNonNegativeNumber(rawCharge.m ?? rawCharge.max, 0));
			if (!name || max < 1) return null;
			const id = `${rawCharge.id || CryptUtil.uid()}`;
			if (seenIds.has(id)) return null;
			seenIds.add(id);
			return {
				id,
				name,
				current: Math.min(Math.floor(this._getNonNegativeNumber(rawCharge.c ?? rawCharge.current, max)), max),
				max,
				isAuto: !!(rawCharge.a ?? rawCharge.isAuto),
			};
		}).filter(Boolean);
	}

	static _serializeVitals (vitals) {
		const out = {
			ds: {
				s: vitals.deathSaves.successes,
				f: vitals.deathSaves.failures,
			},
			co: vitals.concentration || "",
		};
		if (vitals.legendaryResistances) out.lr = {c: vitals.legendaryResistances.current, m: vitals.legendaryResistances.max};
		if (vitals.legendaryActions) out.la = {c: vitals.legendaryActions.current, m: vitals.legendaryActions.max};
		if (vitals.recharges.length) {
			out.rc = vitals.recharges.map(recharge => ({
				id: recharge.id,
				n: recharge.name,
				mn: recharge.min,
				r: recharge.isReady,
			}));
		}
		return out;
	}

	static _getVitals (rawVitals, monster) {
		const defaults = getNpcTrackerVitalsDefaults(monster);
		if (!rawVitals || typeof rawVitals !== "object" || Array.isArray(rawVitals)) return defaults;

		const rawDs = rawVitals.ds ?? rawVitals.deathSaves ?? {};
		const clampSave = value => Math.max(0, Math.min(3, Math.floor(this._getNonNegativeNumber(value, 0))));

		return {
			deathSaves: {
				successes: clampSave(rawDs.s ?? rawDs.successes),
				failures: clampSave(rawDs.f ?? rawDs.failures),
			},
			legendaryResistances: this._getCounter(rawVitals.lr ?? rawVitals.legendaryResistances, defaults.legendaryResistances),
			legendaryActions: this._getCounter(rawVitals.la ?? rawVitals.legendaryActions, defaults.legendaryActions),
			recharges: this._getRecharges(rawVitals.rc ?? rawVitals.recharges, defaults.recharges),
			concentration: `${rawVitals.co ?? rawVitals.concentration ?? ""}`.trim(),
		};
	}

	static _getCounter (rawCounter, fallback) {
		if (!rawCounter || typeof rawCounter !== "object") return fallback;
		const max = Math.floor(this._getNonNegativeNumber(rawCounter.m ?? rawCounter.max, fallback?.max ?? 0));
		if (max < 1) return fallback;
		const current = Math.floor(this._getNonNegativeNumber(rawCounter.c ?? rawCounter.current, max));
		return {current: Math.min(current, max), max};
	}

	static _getRecharges (rawRecharges, defaults) {
		if (!Array.isArray(rawRecharges)) return defaults;
		const byId = new Map(defaults.map(recharge => [recharge.id, recharge]));
		const byName = new Map(defaults.map(recharge => [recharge.name.toLowerCase(), recharge]));
		const seenIds = new Set();
		return rawRecharges.map(rawRecharge => {
			if (!rawRecharge || typeof rawRecharge !== "object") return null;
			const id = `${rawRecharge.id ?? ""}`;
			const name = `${rawRecharge.n ?? rawRecharge.name ?? ""}`.replace(/\s+/g, " ").trim();
			const match = byId.get(id) || byName.get(name.toLowerCase());
			const cleanName = name || match?.name;
			if (!cleanName) return null;
			const resolvedId = id || match?.id || `manual:recharge:${CryptUtil.uid()}`;
			if (seenIds.has(resolvedId)) return null;
			seenIds.add(resolvedId);
			const min = Math.floor(this._getNonNegativeNumber(rawRecharge.mn ?? rawRecharge.min, match?.min ?? 6)) || 6;
			return {
				id: resolvedId,
				name: cleanName,
				min: Math.max(1, Math.min(6, min)),
				isReady: (rawRecharge.r ?? rawRecharge.isReady) !== false,
			};
		}).filter(Boolean);
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
