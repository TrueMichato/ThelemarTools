"use strict";

/**
 * 3D dice roller for the character sheet, backed by the vendored, MIT-licensed
 * `@3d-dice/dice-box-threejs` library (three.js + cannon-es physics).
 *
 * Design goals / guarantees:
 *  - DETERMINISTIC: we already computed the roll; the physics die is told to
 *    land on our exact `finalValue` via the library's `1dN@value` notation.
 *  - OFFLINE / self-hosted: the bundle and all textures are vendored under
 *    `lib/` and loaded by relative path (no CDN / network).
 *  - NON-BLOCKING: a single warm DiceBox instance is reused across rolls and
 *    uses the library's own requestAnimationFrame loop. The fullscreen overlay
 *    is fully inert (hidden + pointer-events:none, no listeners) while idle so
 *    it can never block the sheet.
 *  - ALWAYS RESOLVES: every roll is wrapped in a single-flight `settleOnce`
 *    guard with a hard timeout, click-to-dismiss, and `.catch()` on the
 *    library promise, so the returned Promise resolves even if WebGL stalls,
 *    the physics never settle, or the library throws.
 *  - GRACEFUL DEGRADATION: a hard init/context-loss failure marks 3D dice
 *    unavailable for the session; callers then fall back to the legacy
 *    CSS animation.
 *
 * The library constructor is injectable (`diceBoxFactory`) so the wiring can be
 * unit-tested in jsdom without a real WebGL context.
 */
class CharacterSheetDice3d {
	static ASSET_PATH = "lib/dice-box-threejs-assets/";
	static SCRIPT_PATH = "lib/dice-box-threejs.umd.js";
	static GLOBAL_KEY = "dice-box-threejs";
	static SUPPORTED_DICE = new Set([4, 6, 8, 10, 12, 20]);

	static _ROLL_TIMEOUT_MS = 4500;
	static _SETTLE_MS = 600;
	static _CRIT_SETTLE_MS = 1000;
	static _FADE_MS = 220;

	/** Lazily-created shared AudioContext for the synthesized roll sound. */
	static _audioCtx = null;
	/** Cached synthesized noise buffer (reused across every clack/roll). */
	static _noiseBuffer = null;
	/** The AudioContext the cached buffer was built for (cache-invalidation key). */
	static _noiseBufferCtx = null;
	/** Duration (s) of a single "clack" noise burst. */
	static _NOISE_DUR = 0.05;

	/**
	 * Per-theme dice appearance. Keys match the persisted `diceTheme` setting
	 * values. Colors are plain hex (never CSS gradients — WebGL can't parse
	 * those); textures/materials are validated library keys whose asset files
	 * are vendored under {@link CharacterSheetDice3d.ASSET_PATH}.
	 */
	static THEMES = {
		standard: {background: "#c0392b", foreground: "#ffffff", outline: "#7a1a12", texture: "marble", material: "plastic"},
		blue: {background: "#1f6fe0", foreground: "#ffffff", outline: "#103e80", texture: "marble", material: "plastic"},
		gold: {background: "#f1c40f", foreground: "#3a2e00", outline: "#a07c00", texture: "glitter", material: "metal"},
		purple: {background: "#7c4dca", foreground: "#ffffff", outline: "#3f2370", texture: "marble", material: "plastic"},
		green: {background: "#1e9e5e", foreground: "#ffffff", outline: "#0e5733", texture: "marble", material: "plastic"},
		dark: {background: "#2b2f33", foreground: "#e8e8e8", outline: "#000000", texture: "metal", material: "metal"},
		cosmic: {background: "#3a1a6e", foreground: "#e0d4ff", outline: "#150733", texture: "stars", material: "metal"},
		inferno: {background: "#c0240a", foreground: "#ffe9c0", outline: "#4a0d00", texture: "fire", material: "metal"},
		frost: {background: "#7fc7e8", foreground: "#062033", outline: "#27617d", texture: "ice", material: "glass"},
		nature: {background: "#2e8b57", foreground: "#f0fff0", outline: "#123d24", texture: "leopard", material: "wood"},
		arcane: {background: "#6a1f9e", foreground: "#ece6ff", outline: "#2c0a48", texture: "stainedglass", material: "glass"},
		blood: {background: "#7a0d0d", foreground: "#ffd6d6", outline: "#2c0000", texture: "skulls", material: "metal"},
		ocean: {background: "#0b6e94", foreground: "#dffafd", outline: "#04394e", texture: "water", material: "glass"},
		storm: {background: "#23234a", foreground: "#fdf36b", outline: "#0c0c1f", texture: "cloudy", material: "metal"},
		void: {background: "#0d0d14", foreground: "#9b6cff", outline: "#000000", texture: "stars", material: "metal"},
		radiant: {background: "#e8c24a", foreground: "#4a3000", outline: "#9a7400", texture: "glitter", material: "metal"},
		// R14 additions — new looks built on vendored textures.
		dragon: {background: "#1b5e20", foreground: "#dcffd6", outline: "#082f0c", texture: "dragon", material: "metal"},
		astral: {background: "#2a3d66", foreground: "#eaf2ff", outline: "#101b33", texture: "astral", material: "glass"},
		tiger: {background: "#e07b00", foreground: "#1a0d00", outline: "#7a3d00", texture: "tiger", material: "wood"},
		toxic: {background: "#76c000", foreground: "#0c1a00", outline: "#2f4d00", texture: "lizard", material: "metal"},
		// R15 additions — Thelemar Dice (teal + gold metal) + cohesive companions.
		thelemar: {background: "#005e66", foreground: "#d9b257", outline: "#00343a", texture: "marble", material: "metal"},
		bone: {background: "#d8cdb0", foreground: "#3a2a18", outline: "#5a4a30", texture: "skulls", material: "wood"},
		obsidian: {background: "#15151c", foreground: "#c7c9d6", outline: "#000000", texture: "speckles", material: "glass"},
		jade: {background: "#0f7d62", foreground: "#f4f3d4", outline: "#063d30", texture: "marble", material: "glass"},
		copper: {background: "#9a5b2e", foreground: "#ffe6c2", outline: "#4a2a12", texture: "metal", material: "metal"},
	};

	constructor ({diceBoxFactory = null} = {}) {
		this._diceBoxFactory = diceBoxFactory;
		this._box = null;
		this._stage = null;
		this._overlay = null;
		this._badge = null;
		this._initPromise = null;
		// Hard, session-scoped "give up on 3D" flag. Set on init failure or
		// WebGL context loss; never auto-cleared (avoids re-init thrash).
		this._unavailable = false;
		this._lastThemeKey = null;
		// Signature of the currently-applied appearance (theme + overrides) so we
		// only call updateConfig when the look actually changes.
		this._appearanceSig = null;
		// Theme/appearance to use for the next (re)initialisation, set by pRollMany.
		this._pendingTheme = null;
		this._pendingAppearance = null;
		this._rollToken = 0;
		// Settle fn for the in-flight roll, used to force-resolve a previous
		// roll if a new one starts while it is still animating.
		this._activeSettle = null;
		this._onContextLost = null;
	}

	static _getFactory (instanceFactory) {
		if (typeof instanceFactory === "function") return instanceFactory;
		const g = (typeof globalThis !== "undefined") ? globalThis : (typeof window !== "undefined" ? window : {});
		const fromGlobal = g[CharacterSheetDice3d.GLOBAL_KEY];
		return (typeof fromGlobal === "function") ? fromGlobal : null;
	}

	/** Memoised in-flight/settled result of {@link pLoadLibrary}. */
	static _pLibrary = null;

	/**
	 * Fetch the vendored `dice-box-threejs` bundle on demand.
	 *
	 * The bundle is ~550 KB of three.js + physics — a sixth of the sheet's total
	 * script payload — and is needed only once a die is actually rolled. Loading
	 * it here instead of from a blocking `<script>` keeps it off the critical
	 * path without changing what a roll does: every animated-roll path awaits
	 * this before its `canRender` precheck, so the 3D roller is still chosen
	 * whenever it would previously have been.
	 *
	 * Resolves `true` once the factory is on `globalThis`, `false` if it could
	 * not be loaded (callers then fall back to the legacy CSS animation, exactly
	 * as they already do when the library is missing). Never rejects.
	 *
	 * @returns {Promise<boolean>}
	 */
	static pLoadLibrary () {
		if (CharacterSheetDice3d._getFactory(null)) return Promise.resolve(true);
		if (CharacterSheetDice3d._pLibrary) return CharacterSheetDice3d._pLibrary;
		if (typeof document === "undefined") return Promise.resolve(false);

		CharacterSheetDice3d._pLibrary = new Promise(resolve => {
			try {
				const script = document.createElement("script");
				script.src = CharacterSheetDice3d.SCRIPT_PATH;
				script.async = true;
				script.addEventListener("load", () => resolve(!!CharacterSheetDice3d._getFactory(null)), {once: true});
				script.addEventListener("error", () => resolve(false), {once: true});
				document.head.appendChild(script);
			} catch (e) {
				resolve(false);
			}
		});

		return CharacterSheetDice3d._pLibrary;
	}

	static isReducedMotion () {
		try {
			const g = (typeof globalThis !== "undefined") ? globalThis : window;
			return !!(g.matchMedia && g.matchMedia("(prefers-reduced-motion: reduce)").matches);
		} catch (e) {
			return false;
		}
	}

	static isWebglAvailable () {
		try {
			if (typeof document === "undefined") return false;
			const canvas = document.createElement("canvas");
			const gl = canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
			return !!gl;
		} catch (e) {
			return false;
		}
	}

	isSupportedDie (diceType) {
		return CharacterSheetDice3d.SUPPORTED_DICE.has(Number(diceType));
	}

	/** Fast precheck: can we even attempt a 3D render for this die right now? */
	canRender (diceType) {
		if (this._unavailable) return false;
		if (!this.isSupportedDie(diceType)) return false; // e.g. d100 -> legacy
		if (!CharacterSheetDice3d._getFactory(this._diceBoxFactory)) return false;
		if (!CharacterSheetDice3d.isWebglAvailable()) return false;
		return true;
	}

	_resolveTheme (theme) {
		return CharacterSheetDice3d.THEMES[theme] || CharacterSheetDice3d.THEMES.standard;
	}

	/**
	 * Build the library colorset for a theme, optionally overridden by a
	 * player-customised `appearance` (`{background, foreground, outline, texture,
	 * material}` — any subset). Missing keys fall back to the theme's values, so
	 * a partial override (e.g. just a custom material) keeps the rest of the look.
	 * @param {string} theme
	 * @param {{background?:string, foreground?:string, outline?:string, texture?:string, material?:string}|null} [appearance]
	 */
	_buildColorset (theme, appearance = null) {
		const t = this._resolveTheme(theme);
		const a = appearance || {};
		const background = a.background || t.background;
		const foreground = a.foreground || t.foreground;
		const outline = a.outline || t.outline;
		const texture = a.texture || t.texture;
		const material = a.material || t.material;
		// The library's `makeColorSet` caches colorsets BY NAME, returning the
		// cached entry verbatim on a name hit. A name that's constant per theme
		// (e.g. `charsheet-standard-custom`) therefore makes a changed custom
		// colour silently no-op (the stale colorset is reused). Fold a short hash
		// of the actual appearance into the name so every distinct look gets its
		// own cache entry and always applies.
		const sig = `${background}|${foreground}|${outline}|${texture}|${material}`;
		const hash = CharacterSheetDice3d._hashString(sig);
		return {
			name: `charsheet-${theme || "standard"}${appearance ? "-custom" : ""}-${hash}`,
			foreground,
			background,
			outline,
			edge: outline,
			texture,
			material,
		};
	}

	/** Tiny stable non-cryptographic string hash (FNV-1a), as a base36 string. */
	static _hashString (str) {
		let h = 0x811c9dc5;
		for (let i = 0; i < str.length; ++i) {
			h ^= str.charCodeAt(i);
			h = Math.imul(h, 0x01000193);
		}
		return (h >>> 0).toString(36);
	}

	/** Stable signature of a colorset, used to skip redundant updateConfig calls. */
	static _colorsetSig (cs) {
		return `${cs.name}|${cs.background}|${cs.foreground}|${cs.outline}|${cs.texture}|${cs.material}`;
	}

	_ensureOverlay () {
		if (this._overlay) return;

		const overlay = document.createElement("div");
		overlay.className = "charsheet__dice3d-overlay";

		const stage = document.createElement("div");
		stage.className = "charsheet__dice3d-stage";
		stage.id = "charsheet-dice3d-stage";

		const badge = document.createElement("div");
		badge.className = "charsheet__dice3d-badge";

		overlay.appendChild(stage);
		overlay.appendChild(badge);
		document.body.appendChild(overlay);

		this._overlay = overlay;
		this._stage = stage;
		this._badge = badge;
	}

	async _pInit () {
		if (this._unavailable) throw new Error("3D dice unavailable");
		if (this._initPromise) return this._initPromise;

		this._initPromise = (async () => {
			const Factory = CharacterSheetDice3d._getFactory(this._diceBoxFactory);
			if (!Factory) throw new Error("dice-box-threejs not loaded");

			this._ensureOverlay();

			const themeKey = this._pendingTheme || this._lastThemeKey || "standard";
			const colorset = this._buildColorset(themeKey, this._pendingAppearance);
			const box = new Factory(`#${this._stage.id}`, {
				assetPath: CharacterSheetDice3d.ASSET_PATH,
				sounds: false,
				shadows: true,
				theme_surface: "green-felt",
				theme_material: colorset.material,
				theme_customColorset: colorset,
				gravity_multiplier: 400,
				baseScale: 110,
				strength: 1.4,
				// Brighter than the library default (0.7) so saturated/custom
				// colours read true rather than muddy; still gentle enough not to
				// blow out textured themes.
				light_intensity: 0.9,
				onRollComplete: () => {},
			});
			await box.initialize();

			this._box = box;
			this._lastThemeKey = themeKey;
			// Intentionally do NOT seed `_appearanceSig` here: the first
			// `_applyTheme` after init should always run `updateConfig` so the
			// requested look is guaranteed applied (and the contract test that
			// pins this stays honest). The redundant re-apply is cheap.
			this._attachContextLossGuard();
			return box;
		})();

		try {
			return await this._initPromise;
		} catch (e) {
			// Poisoned init: tear down and disable 3D for the session.
			this._teardownToUnavailable();
			throw e;
		}
	}

	_attachContextLossGuard () {
		try {
			const canvas = this._stage && this._stage.querySelector("canvas");
			if (!canvas) return;
			this._onContextLost = (evt) => {
				try { evt.preventDefault(); } catch (e) { /* ignore */ }
				this._teardownToUnavailable();
			};
			canvas.addEventListener("webglcontextlost", this._onContextLost, false);
		} catch (e) {
			/* non-fatal */
		}
	}

	_teardownToUnavailable () {
		this._unavailable = true;
		this._initPromise = null;
		try {
			if (this._box && typeof this._box.clearDice === "function") this._box.clearDice();
		} catch (e) { /* ignore */ }
		try {
			if (this._box && typeof this._box.destroy === "function") this._box.destroy();
		} catch (e) { /* ignore */ }
		this._box = null;
		try {
			if (this._overlay && this._overlay.parentNode) this._overlay.parentNode.removeChild(this._overlay);
		} catch (e) { /* ignore */ }
		this._overlay = null;
		this._stage = null;
		this._badge = null;
	}

	async _applyTheme (theme, appearance = null) {
		const key = CharacterSheetDice3d.THEMES[theme] ? theme : "standard";
		const colorset = this._buildColorset(key, appearance);
		const sig = CharacterSheetDice3d._colorsetSig(colorset);
		if (sig === this._appearanceSig) return;
		await this._box.updateConfig({
			theme_customColorset: colorset,
			theme_material: colorset.material,
		});
		this._lastThemeKey = key;
		this._appearanceSig = sig;
	}

	/**
	 * Update the crit/fumble badge. Only a lone d20 (a single group of one
	 * d20) can be a crit or fumble — multi-die or non-d20 rolls clear the badge.
	 * @param {Array<{sides:number, values:number[]}>} groups
	 * @returns {boolean} whether a badge was shown
	 */
	_setBadge (groups) {
		if (!this._badge) return false;
		this._badge.className = "charsheet__dice3d-badge";
		this._badge.textContent = "";
		if (!Array.isArray(groups) || groups.length !== 1) return false;
		const g = groups[0];
		if (Number(g.sides) !== 20 || !Array.isArray(g.values) || g.values.length !== 1) return false;
		const finalValue = Number(g.values[0]);
		if (finalValue === 20) {
			this._badge.textContent = "Critical!";
			this._badge.classList.add("charsheet__dice3d-badge--crit", "charsheet__dice3d-badge--show");
			return true;
		}
		if (finalValue === 1) {
			this._badge.textContent = "Fumble!";
			this._badge.classList.add("charsheet__dice3d-badge--fumble", "charsheet__dice3d-badge--show");
			return true;
		}
		return false;
	}

	_showOverlay () {
		if (!this._overlay) return;
		this._overlay.classList.add("charsheet__dice3d-overlay--active");
		this._overlay.classList.remove("charsheet__dice3d-overlay--fade");
	}

	_hideOverlayImmediate () {
		if (!this._overlay) return;
		this._overlay.classList.remove("charsheet__dice3d-overlay--active", "charsheet__dice3d-overlay--fade");
		if (this._badge) {
			this._badge.className = "charsheet__dice3d-badge";
			this._badge.textContent = "";
		}
	}

	/**
	 * Normalise a dice spec into an array of `{sides, values:number[]}` groups,
	 * keeping only groups this engine can render (drops d100 etc.). Accepts
	 * either an array of groups or a single `{diceType, finalValue}` legacy spec.
	 * @returns {Array<{sides:number, values:number[]}>}
	 */
	static normalizeGroups (groups) {
		if (!Array.isArray(groups)) return [];
		const out = [];
		for (const g of groups) {
			if (!g) continue;
			const sides = Number(g.sides ?? g.diceType);
			if (!CharacterSheetDice3d.SUPPORTED_DICE.has(sides)) continue;
			let values = Array.isArray(g.values) ? g.values : (g.finalValue != null ? [g.finalValue] : []);
			values = values.map(v => Number(v)).filter(v => Number.isFinite(v) && v >= 1 && v <= sides);
			if (!values.length) continue;
			out.push({sides, values});
		}
		return out;
	}

	/**
	 * Build the library notation for a set of groups, e.g.
	 * `[{sides:4,values:[2,3,1]},{sides:20,values:[15]}]` -> `3d4+1d20@2,3,1,15`.
	 *
	 * IMPORTANT: the vendored `dice-box-threejs` parser splits the WHOLE notation
	 * string on the FIRST `@` only, parsing dice terms from the segment before it
	 * and the forced-value list from the segment after it. A per-group form like
	 * `3d4@2,3,1+1d20@15` therefore loses every dice term after the first `@` (the
	 * `+1d20` is swallowed into the value segment) and reads garbage forced values.
	 * The canonical, correctly-parsed form is ALL dice terms first, then a SINGLE
	 * trailing `@` listing every value in dice order. (This was the root cause of
	 * multi-component damage — e.g. weapon die + sneak dice — landing on the wrong
	 * faces / dropping dice.)
	 * @returns {string}
	 */
	static buildNotation (groups) {
		const dicePart = groups
			.map(g => `${g.values.length}d${g.sides}`)
			.join("+");
		const values = groups.flatMap(g => g.values);
		return `${dicePart}@${values.join(",")}`;
	}

	/**
	 * Resolve (creating once) the shared AudioContext, or null when Web Audio is
	 * unavailable. Never throws.
	 */
	static _getAudioContext () {
		try {
			const g = (typeof globalThis !== "undefined") ? globalThis : window;
			const Ctx = g.AudioContext || g.webkitAudioContext;
			if (!Ctx) return null;
			if (!CharacterSheetDice3d._audioCtx) CharacterSheetDice3d._audioCtx = new Ctx();
			return CharacterSheetDice3d._audioCtx;
		} catch (e) {
			return null;
		}
	}

	/**
	 * Build (once per AudioContext) and cache the short noise buffer used for the
	 * clack. AudioBuffers are immutable and reusable across many BufferSource
	 * nodes, so we synthesise the noise ONCE rather than on every roll — this is
	 * the fix for the first-roll jank (per-die buffer regeneration on the roll
	 * critical path).
	 */
	static _getNoiseBuffer (ctx) {
		if (CharacterSheetDice3d._noiseBuffer && CharacterSheetDice3d._noiseBufferCtx === ctx) {
			return CharacterSheetDice3d._noiseBuffer;
		}
		const dur = CharacterSheetDice3d._NOISE_DUR;
		const frames = Math.floor(ctx.sampleRate * dur);
		const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let s = 0; s < frames; ++s) {
			const env = Math.pow(1 - s / frames, 3);
			data[s] = (Math.random() * 2 - 1) * env;
		}
		CharacterSheetDice3d._noiseBuffer = buffer;
		CharacterSheetDice3d._noiseBufferCtx = ctx;
		return buffer;
	}

	/**
	 * Warm the audio path OFF the roll critical path: create the AudioContext and
	 * pre-synthesise + cache the noise buffer so the first actual roll doesn't pay
	 * for it. Best-effort; safe to call repeatedly (e.g. on the dice dropdown
	 * opening or the first user gesture). Never throws.
	 */
	static warmAudio () {
		try {
			const ctx = CharacterSheetDice3d._getAudioContext();
			if (!ctx) return;
			if (ctx.state === "suspended" && typeof ctx.resume === "function") { try { ctx.resume(); } catch (e) { /* ignore */ } }
			CharacterSheetDice3d._getNoiseBuffer(ctx);
		} catch (e) {
			/* audio warming is best-effort */
		}
	}

	/**
	 * Play a lightweight, synthesized "dice clack" via the Web Audio API. No
	 * audio assets are needed (none are vendored) and it is a no-op when audio
	 * is unavailable (no AudioContext, autoplay-blocked, etc.). Never throws.
	 *
	 * Reuses the cached noise buffer (see {@link warmAudio}) so it stays cheap on
	 * the roll critical path.
	 * @param {number} [volume] 0..1 master gain (default 0.35)
	 * @param {number} [dieCount] number of dice — drives a few staggered clacks
	 */
	static playRollSound (volume = 0.35, dieCount = 1) {
		try {
			const ctx = CharacterSheetDice3d._getAudioContext();
			if (!ctx) return;
			if (ctx.state === "suspended" && typeof ctx.resume === "function") { try { ctx.resume(); } catch (e) { /* ignore */ } }
			const buffer = CharacterSheetDice3d._getNoiseBuffer(ctx);
			const now = ctx.currentTime;
			const dur = CharacterSheetDice3d._NOISE_DUR;
			const vol = Math.max(0, Math.min(1, Number.isFinite(Number(volume)) ? Number(volume) : 0.35));
			const clacks = Math.min(6, Math.max(1, Number(dieCount) || 1));
			for (let i = 0; i < clacks; ++i) {
				const t = now + i * 0.055 + Math.random() * 0.02;
				const src = ctx.createBufferSource();
				src.buffer = buffer;
				const bp = ctx.createBiquadFilter();
				bp.type = "bandpass";
				bp.frequency.value = 1800 + Math.random() * 1200;
				bp.Q.value = 0.8;
				const gain = ctx.createGain();
				gain.gain.value = vol * (0.7 + Math.random() * 0.3);
				src.connect(bp); bp.connect(gain); gain.connect(ctx.destination);
				src.start(t);
				src.stop(t + dur);
			}
		} catch (e) {
			/* audio is best-effort; never break a roll */
		}
	}

	/**
	 * Roll a single die in 3D, landing on `finalValue`. Thin back-compat wrapper
	 * over {@link CharacterSheetDice3d#pRollMany}.
	 *
	 * @param {object} opts
	 * @param {number} opts.diceType
	 * @param {number} opts.finalValue
	 * @param {string} [opts.theme]
	 * @returns {Promise<void>}
	 */
	async pRoll ({diceType, finalValue, theme, appearance} = {}) {
		return this.pRollMany({groups: [{sides: diceType, values: [finalValue]}], theme, appearance});
	}

	/**
	 * Roll one or more groups of dice in 3D, each landing on its precomputed
	 * values. Resolves only once the overlay has been faded out and made inert.
	 * Rejects if 3D cannot be used for ANY requested group (so callers can fall
	 * back); never rejects mid-animation.
	 *
	 * @param {object} opts
	 * @param {Array<{sides:number, values:number[]}>} opts.groups
	 * @param {string} [opts.theme]
	 * @param {{background?:string, foreground?:string, outline?:string, texture?:string, material?:string}} [opts.appearance]
	 * @returns {Promise<void>}
	 */
	async pRollMany ({groups, theme, appearance} = {}) {
		const normalized = CharacterSheetDice3d.normalizeGroups(groups);
		if (!normalized.length) throw new Error("No renderable dice groups");
		for (const g of normalized) {
			if (!this.isSupportedDie(g.sides)) throw new Error(`Unsupported die: d${g.sides}`);
		}

		// Force-settle any roll still in flight so overlays never stack.
		if (this._activeSettle) {
			const prev = this._activeSettle;
			this._activeSettle = null;
			prev();
		}

		// Remember the requested look so a fresh init (if needed) builds with it.
		this._pendingTheme = CharacterSheetDice3d.THEMES[theme] ? theme : "standard";
		this._pendingAppearance = appearance || null;

		await this._pInit(); // may throw -> caller falls back
		await this._applyTheme(theme, appearance);

		const token = ++this._rollToken;

		return new Promise((resolve) => {
			let settled = false;
			let timeoutId = null;
			let fadeId = null;

			const cleanup = () => {
				if (timeoutId != null) { clearTimeout(timeoutId); timeoutId = null; }
				if (this._overlay) this._overlay.removeEventListener("click", onClick);
			};

			const finalize = () => {
				// Only the roll that is still current may hide the shared overlay;
				// a superseded roll's late fade must not blank a newer roll.
				if (token === this._rollToken) this._hideOverlayImmediate();
				if (this._activeSettle === settle) this._activeSettle = null;
				resolve();
			};

			const settle = () => {
				if (settled) return;
				settled = true;
				cleanup();
				// Fade out, then resolve once the overlay is fully inert so the
				// result toast never appears behind an interactive layer.
				if (this._overlay) this._overlay.classList.add("charsheet__dice3d-overlay--fade");
				fadeId = setTimeout(finalize, CharacterSheetDice3d._FADE_MS);
				// Defensive: ensure resolution even if the timer is throttled.
				if (fadeId && typeof fadeId === "object" && typeof fadeId.unref === "function") fadeId.unref();
			};

			const onClick = () => settle();

			this._activeSettle = settle;
			this._setBadge(normalized);
			this._showOverlay();
			if (this._overlay) this._overlay.addEventListener("click", onClick);

			const isCrit = normalized.length === 1
				&& Number(normalized[0].sides) === 20
				&& normalized[0].values.length === 1
				&& (Number(normalized[0].values[0]) === 20 || Number(normalized[0].values[0]) === 1);
			const settleDelay = isCrit ? CharacterSheetDice3d._CRIT_SETTLE_MS : CharacterSheetDice3d._SETTLE_MS;

			// Hard timeout: guarantees the Promise resolves even if the physics
			// never settle or an asset stalls.
			timeoutId = setTimeout(settle, CharacterSheetDice3d._ROLL_TIMEOUT_MS);
			if (timeoutId && typeof timeoutId === "object" && typeof timeoutId.unref === "function") timeoutId.unref();

			const notation = CharacterSheetDice3d.buildNotation(normalized);
			let rollPromise;
			try {
				rollPromise = this._box.roll(notation);
			} catch (e) {
				// Synchronous throw from the library — settle and bail out.
				settle();
				return;
			}

			Promise.resolve(rollPromise)
				.then(() => {
					if (token !== this._rollToken) return; // superseded
					// Let the settled dice linger briefly, then fade.
					const lingerId = setTimeout(settle, settleDelay);
					if (lingerId && typeof lingerId === "object" && typeof lingerId.unref === "function") lingerId.unref();
				})
				.catch(() => settle());
		});
	}

	/** Tear down all resources (e.g. on sheet teardown). Safe to call twice. */
	destroy () {
		if (this._activeSettle) {
			const prev = this._activeSettle;
			this._activeSettle = null;
			try { prev(); } catch (e) { /* ignore */ }
		}
		try {
			if (this._box && typeof this._box.destroy === "function") this._box.destroy();
		} catch (e) { /* ignore */ }
		this._box = null;
		this._initPromise = null;
		try {
			if (this._overlay && this._overlay.parentNode) this._overlay.parentNode.removeChild(this._overlay);
		} catch (e) { /* ignore */ }
		this._overlay = null;
		this._stage = null;
		this._badge = null;
	}
}

if (typeof globalThis !== "undefined") globalThis.CharacterSheetDice3d = CharacterSheetDice3d;
if (typeof module !== "undefined" && module.exports) module.exports = {CharacterSheetDice3d};
