/**
 * Character Sheet Spawner — core
 *
 * Fast, reproducible character creation for manual testing and bug repro.
 *
 * A *spawn spec* is a tiny, durable description of a character
 * ("cleric/tempest/9/dwarf"). The spawner turns that spec into a fully built
 * character by driving the REAL Builder and Quick Build apply engines — it does
 * not reimplement build logic. Consequence: a spawned character always reflects
 * the current behaviour of those engines, so a fix landed today is exercised by
 * a character spawned today.
 *
 * This file holds the DOM-free core:
 *   - {@link CharacterSheetSpawnRng}      seeded, deterministic RNG
 *   - {@link CharacterSheetSpawnSpec}     spec parsing / normalisation / printing
 *   - {@link CharacterSheetSpawnResolve}  name → entity resolution against catalogs
 *   - {@link CharacterSheetSpawnReport}   structured record of every choice made
 *
 * The engine that drives Builder / Quick Build lives in
 * `charactersheet-spawn-engine.js`.
 */

// ═══════════════════════════════════════════════════════════════════════════
//  Seeded RNG
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Small deterministic RNG (mulberry32 over an FNV-1a string hash).
 *
 * Determinism is the whole point: the same spec must always produce the same
 * character, so a spec in a bug report is a reproduction, not a suggestion.
 * Passing `seed: "random"` opts into variety for fuzz-style testing; the
 * resulting concrete seed is recorded in the spawn report so any interesting
 * result can be pinned.
 */
class CharacterSheetSpawnRng {
	/** @param {string} seed */
	constructor (seed) {
		this._seed = String(seed ?? "");
		this._state = CharacterSheetSpawnRng.hashString(this._seed);
	}

	get seed () { return this._seed; }

	/**
	 * FNV-1a, returned as an unsigned 32-bit integer.
	 * @param {string} str
	 * @returns {number}
	 */
	static hashString (str) {
		let h = 0x811c9dc5;
		for (let i = 0; i < str.length; ++i) {
			h ^= str.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		return h >>> 0;
	}

	/** @returns {number} float in [0, 1) */
	next () {
		this._state = (this._state + 0x6D2B79F5) >>> 0;
		let t = this._state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	/**
	 * @param {number} maxExclusive
	 * @returns {number} integer in [0, maxExclusive)
	 */
	nextInt (maxExclusive) {
		if (!(maxExclusive > 0)) return 0;
		return Math.floor(this.next() * maxExclusive);
	}

	/**
	 * Pick one element.
	 * @template T
	 * @param {T[]} arr
	 * @returns {T|null}
	 */
	pick (arr) {
		if (!Array.isArray(arr) || !arr.length) return null;
		return arr[this.nextInt(arr.length)];
	}

	/**
	 * Pick `n` distinct elements, preserving input order (stable output).
	 * @template T
	 * @param {T[]} arr
	 * @param {number} n
	 * @returns {T[]}
	 */
	pickN (arr, n) {
		if (!Array.isArray(arr) || !arr.length || n <= 0) return [];
		if (n >= arr.length) return [...arr];
		const idxs = arr.map((_, i) => i);
		// Partial Fisher-Yates over indices, then re-sort so output order is stable.
		for (let i = 0; i < n; ++i) {
			const j = i + this.nextInt(idxs.length - i);
			const tmp = idxs[i]; idxs[i] = idxs[j]; idxs[j] = tmp;
		}
		return idxs.slice(0, n).sort((a, b) => a - b).map(i => arr[i]);
	}
}

// ═══════════════════════════════════════════════════════════════════════════
//  Spec parsing
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parsing / normalisation for spawn specs.
 *
 * Two input forms are accepted:
 *   - short DSL string:  `"cleric/tempest/9/dwarf"`, `"fighter/champion/5+warlock/fiend/3"`
 *   - object:            `{classes: [...], race: "Dwarf", feats: [...], choices: {...}}`
 *
 * Both normalise to the same shape (see {@link CharacterSheetSpawnSpec.normalize}).
 */
class CharacterSheetSpawnSpec {
	/**
	 * Choice-override buckets recognised in `spec.choices`. Anything else is
	 * preserved as-is (forward compatible) but reported as unknown.
	 */
	static CHOICE_KEYS = [
		"optionalFeatures", // {featureType|progressionName: [names]}   e.g. {"EI": ["Agonizing Blast"]}
		"featureOptions", // {featureName: [names]}                   e.g. {"Fighting Style": ["Defense"]}
		"skills",
		"expertise",
		"languages",
		"tools",
		"weaponMasteries",
		"combatTraditions",
		"spells",
		"cantrips",
		"spellbook",
		"subclassChoice", // e.g. Divine Soul affinity
		"scholarSkill",
		"options", // {controlLabel: [names]} — generic auto-fill escape hatch
		"racialSkills",
		"racialTools",
		"racialLanguages",
	];

	/**
	 * @returns {*} An empty normalised spec.
	 */
	static empty () {
		return {
			name: null,
			race: null,
			subrace: null,
			background: null,
			classes: [],
			abilities: null,
			feats: [],
			choices: {},
			seed: null,
			hp: "average",
		};
	}

	/**
	 * Parse a spec from a short DSL string, a JSON string, or an object.
	 *
	 * @param {string|Object} input
	 * @returns {*} normalised spec
	 */
	static parse (input) {
		if (input == null) throw new Error("Spawn spec is required");
		if (typeof input === "object") return CharacterSheetSpawnSpec.normalize(input);

		const str = String(input).trim();
		if (!str) throw new Error("Spawn spec is empty");

		// JSON form — `{"classes": …}` or a URL-encoded/base64 blob handled by the caller.
		if (str.startsWith("{")) {
			let parsed;
			try {
				parsed = JSON.parse(str);
			} catch (e) {
				throw new Error(`Spawn spec is not valid JSON: ${(/** @type {*} */ (e)).message}`, {cause: e});
			}
			return CharacterSheetSpawnSpec.normalize(parsed);
		}

		return CharacterSheetSpawnSpec.normalize(CharacterSheetSpawnSpec._parseDsl(str));
	}

	/**
	 * Short DSL:
	 *   `class`                         → level 1
	 *   `class/level`                   → numeric second segment
	 *   `class/subclass`                → non-numeric second segment
	 *   `class/subclass/level`
	 *   `class/subclass/level/race`     → single-class only
	 *   `legA+legB`                     → multiclass (race must come from `&race=`)
	 *
	 * A class or subclass may carry an explicit source in brackets:
	 *   `cleric[TGTT]/tempest[TGTT-2014]/9`
	 *
	 * @param {string} str
	 * @returns {*}
	 */
	static _parseDsl (str) {
		const spec = CharacterSheetSpawnSpec.empty();
		const legs = str.split("+").map(s => s.trim()).filter(Boolean);
		if (!legs.length) throw new Error(`Spawn spec has no class: "${str}"`);

		legs.forEach((leg, legIdx) => {
			const segs = leg.split("/").map(s => s.trim()).filter(Boolean);
			if (!segs.length) throw new Error(`Spawn spec leg is empty: "${leg}"`);

			const cls = CharacterSheetSpawnSpec._splitSource(segs[0]);
			/** @type {*} */
			const entry = {name: cls.name, source: cls.source, subclass: null, subclassSource: null, level: 1};

			if (segs.length >= 2) {
				if (CharacterSheetSpawnSpec._isNumeric(segs[1])) {
					entry.level = parseInt(segs[1], 10);
					if (segs.length >= 3) {
						// `class/level/race` — only meaningful on a single-leg spec.
						if (legs.length === 1) spec.race = segs[2];
						else throw new Error(`Unexpected segment "${segs[2]}" in multiclass leg "${leg}" — use &race= for the species`);
					}
				} else {
					const sub = CharacterSheetSpawnSpec._splitSource(segs[1]);
					entry.subclass = sub.name;
					entry.subclassSource = sub.source;
					if (segs.length >= 3) {
						if (!CharacterSheetSpawnSpec._isNumeric(segs[2])) throw new Error(`Expected a level in "${leg}", got "${segs[2]}"`);
						entry.level = parseInt(segs[2], 10);
					}
					if (segs.length >= 4) {
						if (legs.length === 1) spec.race = segs[3];
						else throw new Error(`Unexpected segment "${segs[3]}" in multiclass leg "${leg}" — use &race= for the species`);
					}
					if (segs.length > 4) throw new Error(`Too many segments in "${leg}"`);
				}
			}

			if (!(entry.level >= 1)) throw new Error(`Invalid level in "${leg}"`);
			void legIdx;
			spec.classes.push(entry);
		});

		return spec;
	}

	/** @param {string} s */
	static _isNumeric (s) { return /^\d+$/.test(s); }

	/**
	 * Split a `name[SOURCE]` token.
	 * @param {string} token
	 * @returns {{name: string, source: ?string}}
	 */
	static _splitSource (token) {
		const m = /^(.*?)\s*\[([^\]]+)\]$/.exec(token);
		if (m) return {name: m[1].trim(), source: m[2].trim()};
		return {name: token.trim(), source: null};
	}

	/**
	 * Normalise an arbitrary spec object into the canonical shape.
	 *
	 * Accepts a few conveniences: `class`/`subclass`/`level` at the top level
	 * (single-class shorthand), `classes` as an array of strings, `feat` as a
	 * string, and unknown keys are dropped with a warning list.
	 *
	 * @param {*} raw
	 * @returns {*}
	 */
	static normalize (raw) {
		if (raw == null || typeof raw !== "object") throw new Error("Spawn spec must be an object or string");

		const out = CharacterSheetSpawnSpec.empty();

		out.name = CharacterSheetSpawnSpec._str(raw.name);
		out.race = CharacterSheetSpawnSpec._str(raw.race ?? raw.species);
		out.subrace = CharacterSheetSpawnSpec._str(raw.subrace);
		out.background = CharacterSheetSpawnSpec._str(raw.background);
		out.seed = CharacterSheetSpawnSpec._str(raw.seed);
		out.hp = raw.hp === "roll" ? "roll" : "average";

		// Classes — array form, or single-class shorthand.
		/** @type {*[]} */
		let classes = [];
		if (Array.isArray(raw.classes) && raw.classes.length) {
			classes = raw.classes;
		} else if (raw.class || raw.className) {
			classes = [{
				name: raw.class || raw.className,
				source: raw.classSource,
				subclass: raw.subclass,
				subclassSource: raw.subclassSource,
				level: raw.level,
			}];
		}

		out.classes = classes.map(entry => {
			if (typeof entry === "string") {
				const parsed = CharacterSheetSpawnSpec._parseDsl(entry);
				return parsed.classes[0];
			}
			const cls = CharacterSheetSpawnSpec._splitSource(String(entry.name || entry.class || entry.className || "").trim());
			const subRaw = entry.subclass ?? entry.subclassName ?? null;
			const sub = subRaw ? CharacterSheetSpawnSpec._splitSource(String(subRaw).trim()) : {name: null, source: null};
			const level = Number(entry.level ?? entry.classLevel ?? 1);
			return {
				name: cls.name,
				source: CharacterSheetSpawnSpec._str(entry.source ?? entry.classSource) || cls.source,
				subclass: sub.name,
				subclassSource: CharacterSheetSpawnSpec._str(entry.subclassSource) || sub.source,
				level: Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1,
			};
		}).filter(c => !!c.name);

		if (!out.classes.length) throw new Error("Spawn spec must name at least one class");

		const total = out.classes.reduce((sum, c) => sum + c.level, 0);
		if (total > 20) throw new Error(`Spawn spec total level ${total} exceeds 20`);

		// Abilities — explicit base scores.
		if (raw.abilities && typeof raw.abilities === "object") {
			/** @type {*} */ const abilities = {};
			for (const [k, v] of Object.entries(raw.abilities)) {
				const num = Number(v);
				if (Number.isFinite(num)) abilities[String(k).toLowerCase()] = Math.floor(num);
			}
			if (Object.keys(abilities).length) out.abilities = abilities;
		}

		// Feats — consumed in order at ASI levels.
		const feats = raw.feats ?? raw.feat;
		if (typeof feats === "string") out.feats = [feats];
		else if (Array.isArray(feats)) out.feats = feats.map(f => (typeof f === "string" ? f : f?.name)).filter(Boolean);

		// Choice overrides.
		const choices = raw.choices && typeof raw.choices === "object" ? raw.choices : {};
		for (const [k, v] of Object.entries(choices)) {
			if (v == null) continue;
			out.choices[k] = v;
		}
		// Allow top-level shorthands for the most-used buckets.
		for (const key of CharacterSheetSpawnSpec.CHOICE_KEYS) {
			if (out.choices[key] == null && raw[key] != null) out.choices[key] = raw[key];
		}

		return out;
	}

	/** @param {*} v @returns {?string} */
	static _str (v) {
		if (v == null) return null;
		const s = String(v).trim();
		return s || null;
	}

	/**
	 * Render a spec back to the short DSL (lossy — drops overrides).
	 * Used for badges, toasts and the "copy spawn URL" action.
	 * @param {*} spec
	 * @returns {string}
	 */
	static toShortString (spec) {
		const legs = (spec.classes || []).map((/** @type {*} */ c) => {
			const parts = [c.name];
			if (c.subclass) parts.push(c.subclass);
			parts.push(String(c.level));
			return parts.join("/");
		});
		let out = legs.join("+");
		if (spec.race && (spec.classes || []).length === 1) out += `/${spec.race}`;
		return out;
	}

	/**
	 * Build the query-string portion of a spawn URL for this spec.
	 * @param {*} spec
	 * @returns {string} e.g. `spawn=cleric/tempest/9/dwarf&seed=abc`
	 */
	static toQueryString (spec) {
		const params = new URLSearchParams();
		const isComplex = !!(spec.abilities || spec.background || spec.subrace
			|| (spec.feats || []).length || Object.keys(spec.choices || {}).length
			|| (spec.classes || []).some((/** @type {*} */ c) => c.source || c.subclassSource));

		if (isComplex) {
			params.set("spawnJson", JSON.stringify(CharacterSheetSpawnSpec.toJson(spec)));
		} else {
			params.set("spawn", CharacterSheetSpawnSpec.toShortString(spec));
			if (spec.race && (spec.classes || []).length > 1) params.set("race", spec.race);
		}
		if (spec.name) params.set("name", spec.name);
		if (spec.seed) params.set("seed", spec.seed);
		return params.toString();
	}

	/**
	 * Strip nulls/empties so a stored spec stays small and readable.
	 * @param {*} spec
	 * @returns {*}
	 */
	static toJson (spec) {
		/** @type {*} */ const out = {classes: (spec.classes || []).map((/** @type {*} */ c) => {
			/** @type {*} */ const entry = {name: c.name, level: c.level};
			if (c.source) entry.source = c.source;
			if (c.subclass) entry.subclass = c.subclass;
			if (c.subclassSource) entry.subclassSource = c.subclassSource;
			return entry;
		})};
		for (const key of ["name", "race", "subrace", "background", "seed"]) {
			if (spec[key]) out[key] = spec[key];
		}
		if (spec.hp && spec.hp !== "average") out.hp = spec.hp;
		if (spec.abilities) out.abilities = {...spec.abilities};
		if ((spec.feats || []).length) out.feats = [...spec.feats];
		if (Object.keys(spec.choices || {}).length) out.choices = MiscUtilSafeCopy(spec.choices);
		return out;
	}

	/**
	 * Canonical string used to derive a deterministic seed when none is given.
	 * Deliberately excludes `name` and `seed` so renaming doesn't reshuffle picks.
	 * @param {*} spec
	 * @returns {string}
	 */
	static toSeedKey (spec) {
		const json = CharacterSheetSpawnSpec.toJson(spec);
		delete json.name;
		delete json.seed;
		return CharacterSheetSpawnSpec._stableStringify(json);
	}

	/**
	 * `JSON.stringify` with keys sorted at every depth, so two specs that differ
	 * only in key order seed identically. (The `replacer`-array form of
	 * `JSON.stringify` cannot be used for this: it filters keys at *every* level,
	 * silently emptying nested objects.)
	 *
	 * @param {*} value
	 * @returns {string}
	 */
	static _stableStringify (value) {
		if (Array.isArray(value)) return `[${value.map(v => CharacterSheetSpawnSpec._stableStringify(v)).join(",")}]`;
		if (value && typeof value === "object") {
			const body = Object.keys(value)
				.sort()
				.filter(k => value[k] !== undefined)
				.map(k => `${JSON.stringify(k)}:${CharacterSheetSpawnSpec._stableStringify(value[k])}`)
				.join(",");
			return `{${body}}`;
		}
		return JSON.stringify(value ?? null);
	}
}

/**
 * Structured-clone-ish deep copy that works with or without `MiscUtil`.
 * @param {*} obj
 * @returns {*}
 */
function MiscUtilSafeCopy (obj) {
	const MiscUtil = (/** @type {*} */ (globalThis)).MiscUtil;
	if (MiscUtil?.copyFast) return MiscUtil.copyFast(obj);
	return JSON.parse(JSON.stringify(obj));
}

// ═══════════════════════════════════════════════════════════════════════════
//  Choice picking
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The single decision point for "which option does the spawner take?".
 *
 * Order of precedence, always:
 *   1. an explicit override from the spec (consumed once, so repeated prompts
 *      for the same bucket walk down the list rather than repeating a pick)
 *   2. a seeded pick from the eligible options
 *
 * Every decision is written to the report with its provenance, which is what
 * makes a spawned character reproducible and auditable.
 */
class CharacterSheetSpawnPicker {
	/**
	 * @param {{spec: *, rng: CharacterSheetSpawnRng, report: CharacterSheetSpawnReport}} opts
	 */
	constructor ({spec, rng, report, abilityPriority = null}) {
		this._spec = spec;
		this._rng = rng;
		this._report = report;
		/** @type {Set<string>} */ this._consumed = new Set();
		/** @type {?string[]} */ this._abilityPriority = abilityPriority;
		/** @type {?Set<string>} */ this._sourcePreference = null;
	}

	/** @param {?string[]} order Ability abbreviations, best first. */
	setAbilityPriority (order) { this._abilityPriority = order; }

	/**
	 * Sources this character is actually built from (its class/race/background sources plus
	 * the core books). Option pools that carry an explicit source — weapon masteries are the
	 * worst offender, since the item pool includes XDMG firearms — are restricted to these
	 * before the seeded pick runs, so a Rogue masters a Dagger rather than a Laser Rifle.
	 *
	 * @param {?string[]} sources
	 */
	setSourcePreference (sources) {
		this._sourcePreference = sources?.length ? new Set(sources.map(src => String(src).toUpperCase())) : null;
	}

	get rng () { return this._rng; }
	get report () { return this._report; }
	get spec () { return this._spec; }

	/**
	 * Read an override bucket as a flat list of wanted names.
	 * Supports both `choices.skills = [...]` and `choices.optionalFeatures.EI = [...]`.
	 *
	 * @param {string} bucket
	 * @param {?string} key
	 * @returns {{name: string, token: string}[]}
	 */
	_getOverrides (bucket, key) {
		const raw = (this._spec?.choices || {})[bucket];
		if (raw == null) return [];

		/** @type {*} */ let values = raw;
		if (!Array.isArray(raw) && typeof raw === "object") {
			if (key == null) return [];
			// Loose key match so "Fighting Style" finds "fighting style".
			const matchKey = Object.keys(raw).find(k => CharacterSheetSpawnResolve.namesMatch(k, key));
			if (matchKey == null) return [];
			values = raw[matchKey];
		}
		if (!Array.isArray(values)) values = [values];

		return values
			.map((/** @type {*} */ v, /** @type {number} */ i) => {
				const name = typeof v === "string" ? v : v?.name;
				return name ? {name: String(name), token: `${bucket}::${key ?? ""}::${i}::${name}`} : null;
			})
			.filter(Boolean);
	}

	/**
	 * Choose ONE option.
	 *
	 * @param {{
	 *   bucket: string,
	 *   kind: string,
	 *   key?: ?string,
	 *   level?: ?number,
	 *   options: *[],
	 *   nameOf?: (opt: *) => string,
	 *   label?: string,
	 * }} opts
	 * @returns {*} the chosen option, or null when there was nothing to pick
	 */
	pickOne (opts) {
		const picked = this.pickMany({...opts, count: 1});
		return picked.length ? picked[0] : null;
	}

	/**
	 * Choose `count` distinct options, preferring spec overrides.
	 *
	 * @param {{
	 *   bucket: string,
	 *   kind: string,
	 *   key?: ?string,
	 *   level?: ?number,
	 *   count: number,
	 *   options: *[],
	 *   nameOf?: (opt: *) => string,
	 *   label?: string,
	 *   attempt?: (opt: *) => boolean,
	 * }} opts `attempt` performs the selection and returns whether it took effect. Use it
	 *   for controls that can silently refuse — an ability already at its cap still has a
	 *   live `+` button. Refused candidates are skipped and never reach the report.
	 * @returns {*[]}
	 */
	pickMany ({bucket, kind, key = null, level = null, count, options, nameOf, label, attempt = null}) {
		const nameFn = nameOf || ((/** @type {*} */ o) => (typeof o === "string" ? o : o?.name));
		const what = label || `${kind}${key ? ` (${key})` : ""}`;

		if (!Array.isArray(options) || !options.length) {
			if (count > 0) this._report.markUnresolved(`${what}${level ? ` at level ${level}` : ""}: no eligible options`);
			return [];
		}
		if (!(count > 0)) return [];

		/** @type {*[]} */ const chosen = [];
		/** @type {Set<*>} */ const used = new Set();

		// 1. Spec overrides.
		for (const override of this._getOverrides(bucket, key)) {
			if (chosen.length >= count) break;
			if (this._consumed.has(override.token)) continue;
			const hit = options.find(o => !used.has(o) && CharacterSheetSpawnResolve.namesMatch(nameFn(o), override.name));
			if (!hit) continue;
			used.add(hit);
			if (attempt && !attempt(hit)) continue;
			this._consumed.add(override.token);
			chosen.push(hit);
			this._report.record({level, kind, key, chosen: nameFn(hit), from: "spec", options});
		}

		// 2. Seeded auto-pick for the remainder.
		const remaining = count - chosen.length;
		if (remaining > 0) {
			let pool = options.filter(o => !used.has(o));
			// An all-ability option list is a stat allocation (racial +2/+1, ASI, …).
			// Random there produces nonsense like a Warlock raising Wisdom, so honour
			// the class's ability priority instead of the seed.
			const byPriority = this._orderByAbilityPriority(pool, nameFn);
			if (byPriority) pool = byPriority;
			else pool = this._restrictToPreferredSources(pool, nameFn, remaining);
			if (pool.length < remaining) {
				this._report.markUnresolved(`${what}${level ? ` at level ${level}` : ""}: needed ${count}, only ${pool.length + chosen.length} available`);
			}
			// With `attempt`, walk the whole ordered pool: a refused candidate costs a slot
			// otherwise, which is how a capped ability used to stall the wizard forever.
			const picks = attempt
				? (byPriority || this._rng.pickN(pool, pool.length))
				: (byPriority ? pool.slice(0, remaining) : this._rng.pickN(pool, remaining));
			for (const opt of picks) {
				if (chosen.length >= count) break;
				used.add(opt);
				if (attempt && !attempt(opt)) continue;
				chosen.push(opt);
				this._report.record({level, kind, key, chosen: nameFn(opt), from: "auto", options});
			}
		}

		return chosen;
	}

	static _ABILITY_ALIASES = {
		str: "str",
		strength: "str",
		dex: "dex",
		dexterity: "dex",
		con: "con",
		constitution: "con",
		int: "int",
		intelligence: "int",
		wis: "wis",
		wisdom: "wis",
		cha: "cha",
		charisma: "cha",
	};

	/**
	 * Drop options whose source is foreign to this character, but only when doing so still
	 * leaves enough of them to fill the slots. Returns the pool unchanged when there is no
	 * source information, no preference set, or filtering would starve the pick.
	 *
	 * @param {*[]} pool
	 * @param {function(*): string} nameFn
	 * @param {number} needed
	 * @returns {*[]}
	 */
	_restrictToPreferredSources (pool, nameFn, needed) {
		if (!this._sourcePreference?.size) return pool;

		const sourceOf = (/** @type {*} */ opt) => {
			if (opt && typeof opt === "object" && opt.source) return String(opt.source).toUpperCase();
			const name = nameFn(opt);
			const ix = typeof name === "string" ? name.indexOf("|") : -1;
			return ix === -1 ? null : name.slice(ix + 1).trim().toUpperCase();
		};

		if (!pool.some(opt => sourceOf(opt) != null)) return pool;

		const preferred = pool.filter(opt => {
			const src = sourceOf(opt);
			// Unsourced entries in a partly-sourced pool are assumed local, so keep them.
			return src == null || this._sourcePreference.has(src);
		});
		return preferred.length >= needed ? preferred : pool;
	}

	/**
	 * @param {*[]} pool
	 * @param {function(*): string} nameFn
	 * @returns {?*[]} The pool sorted best-first, or `null` if this is not an
	 *   ability list (or no priority is known).
	 */
	_orderByAbilityPriority (pool, nameFn) {
		if (!this._abilityPriority?.length || pool.length < 2) return null;

		/** @type {Map<*, string>} */ const abbrs = new Map();
		for (const opt of pool) {
			// Labels arrive as "Wisdom", "WIS", or "Wisdom (+2)" depending on the
			// control, so match the ability word rather than the whole string.
			const text = String(nameFn(opt) ?? "").toLowerCase();
			if (text.length > 32) return null;
			const hits = Object.entries(CharacterSheetSpawnPicker._ABILITY_ALIASES)
				.filter(([word]) => new RegExp(`\\b${word}\\b`).test(text))
				.map(([, abbr]) => abbr);
			const uniq = [...new Set(hits)];
			if (uniq.length !== 1) return null;
			abbrs.set(opt, uniq[0]);
		}

		const rank = (/** @type {*} */ o) => {
			const ix = this._abilityPriority.indexOf(abbrs.get(o));
			return ix === -1 ? Number.MAX_SAFE_INTEGER : ix;
		};
		return [...pool].sort((a, b) => rank(a) - rank(b));
	}

	/**
	 * Read (and consume) a raw scalar override for a non-enumerable prompt —
	 * boolean / string / number questions, where there is no option list to match
	 * against and the spec value is used verbatim.
	 *
	 * @param {string} bucket
	 * @param {?string} key
	 * @returns {?string} the override value, or null
	 */
	peekOverride (bucket, key) {
		for (const {name, token} of this._getOverrides(bucket, key)) {
			if (this._consumed.has(token)) continue;
			this._consumed.add(token);
			return name;
		}
		return null;
	}

	/**
	 * Report any spec overrides that never matched a real option — almost always
	 * a typo, and silently ignoring them makes a spec lie about what it built.
	 */
	reportUnusedOverrides () {
		for (const [bucket, raw] of Object.entries(this._spec?.choices || {})) {
			if (raw == null) continue;
			/** @type {[?string, *][]} */
			const pairs = Array.isArray(raw) || typeof raw !== "object"
				? [[null, raw]]
				: Object.entries(raw);

			for (const [key, values] of pairs) {
				for (const {name, token} of this._getOverrides(bucket, key)) {
					if (this._consumed.has(token)) continue;
					this._report.warn(`Spec override "${name}" (${bucket}${key ? `.${key}` : ""}) never matched an available option`);
				}
				void values;
			}
		}
	}
}

// ═══════════════════════════════════════════════════════════════════════════
//  Name → entity resolution
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fuzzy, source-aware lookup of catalog entities by the loose names people type
 * into a spec ("tempest", "Circle of the Stars", "eldritch-knight").
 *
 * Matching is deliberately forgiving but *ordered*, so a spec is stable:
 *   exact name → normalised exact → startsWith → substring → word-subset.
 * Ties are broken by an explicit source, then by catalog order (which already
 * reflects the sheet's source-priority filtering).
 */
class CharacterSheetSpawnResolve {
	/**
	 * Normalise a name for comparison: lowercase, strip punctuation/articles.
	 * @param {*} name
	 * @returns {string}
	 */
	static norm (name) {
		return String(name ?? "")
			.toLowerCase()
			.replace(/[’']/g, "")
			.replace(/[^a-z0-9]+/g, " ")
			.replace(/\b(the|of|circle|oath|domain|path|college|school|way|order)\b/g, " ")
			.trim()
			.replace(/\s+/g, " ");
	}

	/**
	 * Loose name comparison used for choice overrides ("defense" ↔ "Defense").
	 * @param {*} a
	 * @param {*} b
	 * @returns {boolean}
	 */
	static namesMatch (a, b) {
		if (a == null || b == null) return false;
		const na = String(a).trim().toLowerCase();
		const nb = String(b).trim().toLowerCase();
		if (na === nb) return true;
		const ra = CharacterSheetSpawnResolve.norm(a);
		const rb = CharacterSheetSpawnResolve.norm(b);
		if (ra === rb) return true;
		// Skill/tool/feature keys are stored space-free and un-filtered
		// ("sleightofhand"), so compare a punctuation-only-stripped form too — the
		// filler-word stripping in `norm` would otherwise lose the "of".
		const tight = (/** @type {*} */ v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, "");
		if (tight(a) === tight(b)) return true;
		return ra.replace(/ /g, "") === rb.replace(/ /g, "");
	}

	/**
	 * Find the best match for `name` in `entities`.
	 *
	 * @param {*[]} entities
	 * @param {?string} name
	 * @param {{source?: ?string, nameKeys?: string[], label?: string}} [opts]
	 * @returns {*} the matched entity, or null
	 */
	static findByName (entities, name, opts = {}) {
		if (!Array.isArray(entities) || !entities.length || !name) return null;
		const {source = null, nameKeys = ["name"]} = opts;

		const wanted = String(name).trim().toLowerCase();
		const wantedNorm = CharacterSheetSpawnResolve.norm(name);
		const wantedWords = wantedNorm.split(" ").filter(Boolean);

		const sourceOk = (/** @type {*} */ e) => !source || String(e.source || "").toLowerCase() === String(source).toLowerCase();
		const namesOf = (/** @type {*} */ e) => nameKeys.map(k => e?.[k]).filter(Boolean).map(String);

		/** @type {((e: *) => boolean)[]} */
		const tiers = [
			(e) => namesOf(e).some(n => n.toLowerCase() === wanted),
			(e) => namesOf(e).some(n => CharacterSheetSpawnResolve.norm(n) === wantedNorm),
			(e) => namesOf(e).some(n => CharacterSheetSpawnResolve.norm(n).startsWith(wantedNorm)),
			(e) => namesOf(e).some(n => CharacterSheetSpawnResolve.norm(n).includes(wantedNorm)),
			(e) => wantedWords.length > 0 && namesOf(e).some(n => {
				const words = new Set(CharacterSheetSpawnResolve.norm(n).split(" ").filter(Boolean));
				return wantedWords.every(w => words.has(w));
			}),
		];

		for (const tier of tiers) {
			// Prefer entries matching the requested source, then catalog order.
			const hits = entities.filter(e => tier(e));
			if (!hits.length) continue;
			const sourced = hits.filter(sourceOk);
			return (sourced.length ? sourced : hits)[0];
		}
		return null;
	}

	/**
	 * Suggest close names for an error message.
	 * @param {*[]} entities
	 * @param {?string} name
	 * @param {number} [limit]
	 * @returns {string[]}
	 */
	static suggest (entities, name, limit = 6) {
		if (!Array.isArray(entities)) return [];
		const wantedNorm = CharacterSheetSpawnResolve.norm(name);
		const first = wantedNorm.slice(0, 3);
		const names = entities.map(e => e?.name).filter(Boolean);
		const near = names.filter(n => CharacterSheetSpawnResolve.norm(n).startsWith(first));
		return [...new Set(near.length ? near : names)].slice(0, limit);
	}

	/**
	 * Resolve a race by name, handling the sheet's flattened race catalog where
	 * subraces appear as their own entries ("Elf (High)") carrying `_baseName`.
	 *
	 * @param {*[]} races - already source-filtered
	 * @param {?string} name
	 * @param {?string} subraceName
	 * @param {CharacterSheetSpawnRng} rng
	 * @returns {{race: *, matchedSubrace: boolean}}
	 */
	static findRace (races, name, subraceName, rng) {
		if (!Array.isArray(races) || !races.length || !name) return {race: null, matchedSubrace: false};

		// When a subrace is named, try the combined "Base (Sub)" form first.
		if (subraceName) {
			const combined = CharacterSheetSpawnResolve.findByName(races, `${name} (${subraceName})`);
			if (combined) return {race: combined, matchedSubrace: true};
			const familyForSub = races.filter(r => CharacterSheetSpawnResolve.namesMatch(r._baseName, name)
				|| CharacterSheetSpawnResolve.norm(r.name).startsWith(CharacterSheetSpawnResolve.norm(name)));
			const bySub = CharacterSheetSpawnResolve.findByName(familyForSub, subraceName, {nameKeys: ["_subraceName", "name"]});
			if (bySub) return {race: bySub, matchedSubrace: true};
		}

		const exact = CharacterSheetSpawnResolve.findByName(races, name);
		if (exact && !subraceName) {
			// An exact hit on a base race that also has subrace variants: if the hit
			// IS a subrace entry we're done; otherwise prefer it as-is.
			return {race: exact, matchedSubrace: !!exact._baseName};
		}

		// Fall back to the family of subrace entries sharing this base name.
		const family = races.filter(r => CharacterSheetSpawnResolve.namesMatch(r._baseName, name));
		if (family.length) return {race: rng.pick(family), matchedSubrace: false};

		return {race: exact || null, matchedSubrace: !!exact?._baseName};
	}
}

// ═══════════════════════════════════════════════════════════════════════════
//  Spawn report
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Records every decision the spawner made, where it came from (`spec` vs
 * `auto`), and anything it could not resolve.
 *
 * The report is the reproducibility contract: a randomly-seeded spawn that
 * surfaces a bug can be replayed exactly (same seed), and `toPinnedSpec()`
 * freezes the picks into an explicit spec that survives future auto-pick
 * changes.
 */
class CharacterSheetSpawnReport {
	/** @param {*} spec */
	constructor (spec) {
		this.spec = spec;
		this.seed = spec?.seed || null;
		/** @type {*[]} */ this.choices = [];
		/** @type {string[]} */ this.warnings = [];
		/** @type {string[]} */ this.unresolved = [];
		/** @type {string[]} */ this.unhandledPrompts = [];
		this.startedAt = Date.now();
		this.finishedAt = null;
	}

	/**
	 * @param {{level?: ?number, kind: string, key?: ?string, chosen: *, from: "spec"|"auto"|"random", options?: *[]}} entry
	 */
	record (entry) {
		this.choices.push({
			level: entry.level ?? null,
			kind: entry.kind,
			key: entry.key ?? null,
			chosen: entry.chosen,
			from: entry.from,
			optionCount: Array.isArray(entry.options) ? entry.options.length : null,
		});
	}

	/** @param {string} msg */
	warn (msg) { if (msg && !this.warnings.includes(msg)) this.warnings.push(msg); }

	/** @param {string} msg */
	markUnresolved (msg) { if (msg && !this.unresolved.includes(msg)) this.unresolved.push(msg); }

	/** @param {string} title */
	markUnhandledPrompt (title) { this.unhandledPrompts.push(title || "(untitled modal)"); }

	get isClean () { return !this.unresolved.length && !this.unhandledPrompts.length; }

	finish () { this.finishedAt = Date.now(); return this; }

	get durationMs () { return (this.finishedAt || Date.now()) - this.startedAt; }

	/**
	 * A spec with every auto-picked choice written out explicitly, so the exact
	 * character can be rebuilt even if auto-pick logic changes later.
	 * @returns {*}
	 */
	toPinnedSpec () {
		const pinned = MiscUtilSafeCopy(CharacterSheetSpawnSpec.toJson(this.spec));
		pinned.seed = this.seed;
		/** @type {*} */ const choices = pinned.choices || (pinned.choices = {});

		/** @param {string} bucket @param {*} value */
		const push = (bucket, value) => {
			if (value == null) return;
			if (!Array.isArray(choices[bucket])) choices[bucket] = [];
			const name = typeof value === "string" ? value : value.name;
			if (name && !choices[bucket].includes(name)) choices[bucket].push(name);
		};
		/** @param {string} bucket @param {?string} key @param {*} value */
		const put = (bucket, key, value) => {
			if (!key || value == null) return;
			if (typeof choices[bucket] !== "object" || Array.isArray(choices[bucket])) choices[bucket] = {};
			const name = typeof value === "string" ? value : value.name;
			if (!name) return;
			if (!Array.isArray(choices[bucket][key])) choices[bucket][key] = [];
			if (!choices[bucket][key].includes(name)) choices[bucket][key].push(name);
		};

		for (const c of this.choices) {
			switch (c.kind) {
				case "subclass": {
					const leg = (pinned.classes || []).find((/** @type {*} */ cl) => CharacterSheetSpawnResolve.namesMatch(cl.name, c.key));
					if (leg && c.chosen) leg.subclass = typeof c.chosen === "string" ? c.chosen : c.chosen.name;
					break;
				}
				case "feat": push("_feats", c.chosen); break;
				case "optionalFeature": put("optionalFeatures", c.key, c.chosen); break;
				case "featureOption": put("featureOptions", c.key, c.chosen); break;
				case "classFeatProgression": put("featureOptions", c.key, c.chosen); break;
				case "skill": push("skills", c.chosen); break;
				case "expertise": push("expertise", c.chosen); break;
				case "language": push("languages", c.chosen); break;
				case "weaponMastery": push("weaponMasteries", c.chosen); break;
				case "combatTradition": push("combatTraditions", c.chosen); break;
				case "spell": push("spells", c.chosen); break;
				case "cantrip": push("cantrips", c.chosen); break;
				case "spellbook": push("spellbook", c.chosen); break;
				case "scholarSkill": choices.scholarSkill = c.chosen; break;
				// Auto-fill kinds, keyed by the on-screen label of the control.
				case "option": put("options", c.key, c.chosen); break;
				case "abilityIncrease": push("abilityIncreases", c.chosen); break;
				case "subclassChoice": choices.subclassChoice = c.chosen; break;
				// Prompt-layer kinds (see charactersheet-spawn-prompts.js).
				case "featureChoice:skill": push("skills", c.chosen); break;
				case "featureChoice:cantrip": push("cantrips", c.chosen); break;
				case "featureChoice:subfeature": put("featureOptions", c.key, c.chosen); break;
				case "featureSpell": push("spells", c.chosen); break;
				case "scribingSpell": push("spellbook", c.chosen); break;
				case "prompt:enum":
				case "prompt:multi":
				case "prompt:boolean":
				case "prompt:string":
				case "prompt:number": put("prompts", c.key, c.chosen); break;
				default: break;
			}
		}

		if (Array.isArray(choices._feats)) {
			pinned.feats = choices._feats;
			delete choices._feats;
		}
		if (!Object.keys(choices).length) delete pinned.choices;
		return pinned;
	}

	/**
	 * Human-readable summary for the console / CLI.
	 * @returns {string}
	 */
	toText () {
		const lines = [];
		lines.push(`Spawn: ${CharacterSheetSpawnSpec.toShortString(this.spec)}  (seed: ${this.seed || "—"}, ${this.durationMs}ms)`);
		const byLevel = new Map();
		for (const c of this.choices) {
			const key = c.level == null ? "base" : `L${c.level}`;
			if (!byLevel.has(key)) byLevel.set(key, []);
			const name = typeof c.chosen === "string" ? c.chosen : (c.chosen?.name ?? JSON.stringify(c.chosen));
			byLevel.get(key).push(`${c.kind}${c.key ? `[${c.key}]` : ""}: ${name} (${c.from})`);
		}
		for (const [level, entries] of byLevel) {
			lines.push(`  ${level}`);
			for (const e of entries) lines.push(`    - ${e}`);
		}
		if (this.warnings.length) {
			lines.push(`  warnings (${this.warnings.length}):`);
			for (const w of this.warnings) lines.push(`    ! ${w}`);
		}
		if (this.unresolved.length) {
			lines.push(`  UNRESOLVED (${this.unresolved.length}):`);
			for (const u of this.unresolved) lines.push(`    ✗ ${u}`);
		}
		if (this.unhandledPrompts.length) {
			lines.push(`  UNHANDLED PROMPTS (${this.unhandledPrompts.length}):`);
			for (const p of this.unhandledPrompts) lines.push(`    ✗ ${p}`);
		}
		return lines.join("\n");
	}

	/** @returns {*} */
	toJson () {
		return {
			spec: CharacterSheetSpawnSpec.toJson(this.spec),
			pinnedSpec: this.toPinnedSpec(),
			seed: this.seed,
			durationMs: this.durationMs,
			isClean: this.isClean,
			choices: this.choices,
			warnings: this.warnings,
			unresolved: this.unresolved,
			unhandledPrompts: this.unhandledPrompts,
			// Carried along so consumers on the far side of a `page.evaluate()` boundary
			// (CLI, e2e) can print the human-readable report without re-hydrating the class.
			text: this.toText(),
		};
	}
}

export {CharacterSheetSpawnRng, CharacterSheetSpawnSpec, CharacterSheetSpawnResolve, CharacterSheetSpawnReport, CharacterSheetSpawnPicker};
globalThis.CharacterSheetSpawnRng = CharacterSheetSpawnRng;
globalThis.CharacterSheetSpawnSpec = CharacterSheetSpawnSpec;
globalThis.CharacterSheetSpawnResolve = CharacterSheetSpawnResolve;
globalThis.CharacterSheetSpawnReport = CharacterSheetSpawnReport;
globalThis.CharacterSheetSpawnPicker = CharacterSheetSpawnPicker;
