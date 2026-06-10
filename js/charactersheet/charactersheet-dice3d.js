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
	static GLOBAL_KEY = "dice-box-threejs";
	static SUPPORTED_DICE = new Set([4, 6, 8, 10, 12, 20]);

	static _ROLL_TIMEOUT_MS = 4500;
	static _SETTLE_MS = 600;
	static _CRIT_SETTLE_MS = 1000;
	static _FADE_MS = 220;

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

	_buildColorset (theme) {
		const t = this._resolveTheme(theme);
		return {
			name: `charsheet-${theme || "standard"}`,
			foreground: t.foreground,
			background: t.background,
			outline: t.outline,
			edge: t.outline,
			texture: t.texture,
			material: t.material,
		};
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

			const colorset = this._buildColorset(this._lastThemeKey || "standard");
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
				onRollComplete: () => {},
			});
			await box.initialize();

			this._box = box;
			this._lastThemeKey = this._lastThemeKey || "standard";
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

	async _applyTheme (theme) {
		const key = CharacterSheetDice3d.THEMES[theme] ? theme : "standard";
		if (key === this._lastThemeKey) return;
		const colorset = this._buildColorset(key);
		await this._box.updateConfig({
			theme_customColorset: colorset,
			theme_material: colorset.material,
		});
		this._lastThemeKey = key;
	}

	_setBadge (diceType, finalValue) {
		if (!this._badge) return false;
		this._badge.className = "charsheet__dice3d-badge";
		this._badge.textContent = "";
		if (Number(diceType) !== 20) return false;
		if (Number(finalValue) === 20) {
			this._badge.textContent = "Critical!";
			this._badge.classList.add("charsheet__dice3d-badge--crit", "charsheet__dice3d-badge--show");
			return true;
		}
		if (Number(finalValue) === 1) {
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
	 * Roll a single die in 3D, landing on `finalValue`. Resolves only once the
	 * overlay has been faded out and made inert. Rejects if 3D cannot be used
	 * (so callers can fall back); never rejects mid-animation.
	 *
	 * @param {object} opts
	 * @param {number} opts.diceType
	 * @param {number} opts.finalValue
	 * @param {string} [opts.theme]
	 * @returns {Promise<void>}
	 */
	async pRoll ({diceType, finalValue, theme} = {}) {
		if (!this.isSupportedDie(diceType)) throw new Error(`Unsupported die: d${diceType}`);

		// Force-settle any roll still in flight so overlays never stack.
		if (this._activeSettle) {
			const prev = this._activeSettle;
			this._activeSettle = null;
			prev();
		}

		await this._pInit(); // may throw -> caller falls back
		await this._applyTheme(theme);

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
			this._setBadge(diceType, finalValue);
			this._showOverlay();
			if (this._overlay) this._overlay.addEventListener("click", onClick);

			const isCrit = Number(diceType) === 20 && (Number(finalValue) === 20 || Number(finalValue) === 1);
			const settleDelay = isCrit ? CharacterSheetDice3d._CRIT_SETTLE_MS : CharacterSheetDice3d._SETTLE_MS;

			// Hard timeout: guarantees the Promise resolves even if the physics
			// never settle or an asset stalls.
			timeoutId = setTimeout(settle, CharacterSheetDice3d._ROLL_TIMEOUT_MS);
			if (timeoutId && typeof timeoutId === "object" && typeof timeoutId.unref === "function") timeoutId.unref();

			const notation = `1d${Number(diceType)}@${Number(finalValue)}`;
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
