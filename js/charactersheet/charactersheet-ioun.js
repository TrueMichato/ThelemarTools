"use strict";

/**
 * Character Sheet — Ioun Stone manager.
 *
 * ## Why this exists
 *
 * The sheet already stores the exact two-stage state the Ioun Stone rules describe — it just
 * never named it:
 *
 * | Rules            | Sheet field | Meaning                                          |
 * |------------------|-------------|--------------------------------------------------|
 * | Ioun bond        | `attuned`   | The stone is yours. Slot-free (`isAttunementExempt`). |
 * | Orbiting         | `equipped`  | **The only state that confers the benefit.**      |
 *
 * `_calculateItemBonuses` gates on `equipped && (requiresAttunement -> attuned)`, which is
 * already rules-correct: *"A stone confers no benefit while it isn't orbiting."*
 *
 * **So this module adds no mechanics.** It is a control surface and a vocabulary over state the
 * engine already honours. It writes through `setItemEquipped` / `attune` / `unattune` — the same
 * setters the inventory uses — so the two views can never disagree.
 *
 * ## The one thing to not "tidy up" later
 *
 * The actions are deliberately **asymmetric**, because the rules are:
 *
 *   - Seize and stow -> a Utilize action, for **any number** of stones at once.
 *   - Toss into orbit -> a Magic action, **per stone**.
 *
 * Hence `Stow all` is a batch button and there is deliberately **no "Orbit all"**. Adding one
 * would quietly misrepresent the action economy: putting six stones up costs six Magic actions,
 * i.e. six turns. The per-stone cost caption exists for the same reason.
 *
 * ## Detection is rules-text driven, not source-locked
 *
 * Keyed on the item's own text, so the ~35 official Ioun Stones (DMG/XDMG/IMR/LLK) are managed
 * too. Intrinsic Ioun Bond text always grants the homebrew bond rules. The TGTT master flag
 * additively extends those same rules to official stones; disabling it restores RAW official
 * attunement without removing text-defined bonds.
 */

import {CharacterSheetModal} from "./charactersheet-modal.js";
import {
	csCombatIcon,
	csCombatStateToggle,
	csCombatStatusStrip,
	csCombatPoolCaption,
} from "./charactersheet-combat.js";

// Project globals — typed via globalThis cast for TypeScript checkJs
const {e_} = /** @type {*} */ (globalThis);

class CharacterSheetIoun {
	// ==========================================================================================
	// #region Static rules data
	// ==========================================================================================

	/** The full bond time, before the collection accelerator. */
	static BOND_DAYS_BASE = 7;
	/** The floor the accelerator can never take it below. */
	static BOND_DAYS_MIN = 3;
	/** Bonded stones needed before the gifting Bonus Action unlocks. */
	static GIFTING_THRESHOLD = 12;
	/**
	 * Orbit count at which we start warning about conspicuousness. The book gives no number —
	 * it says large collections "normally prevent their bonded creature from hiding in
	 * darkness" — so this is a judgement call, set to the same 12 the book uses elsewhere as
	 * its "large collection" marker rather than inventing a second threshold.
	 */
	static CONSPICUOUS_THRESHOLD = 12;

	/** Source Types whose charges do NOT come back, so an empty stone is spent for good. */
	static _TERMINAL_TYPE_CODES = new Set(["S", "C", "T"]);

	/**
	 * Colour words -> swatch colour. Players name stones by colour and shape ("my pale blue
	 * rhomboid"), so at 30 rows the swatch does real scanning work; that is what earns it a
	 * place in a UI that otherwise bans ornament. Measured against the 600 book stones: this
	 * list resolves 599/600 — the lone miss is "Fused Ioun Stones", a composite with no colour
	 * of its own, which correctly falls back to a neutral swatch.
	 *
	 * Order matters only for the modifier words (pale/deep/dark/…), which are applied on top.
	 */
	static _COLOR_WORDS = {
		amber: "#f59e0b",
		apricot: "#fbbf24",
		aquamarine: "#7fffd4",
		azure: "#007fff",
		beige: "#e8d9b0",
		black: "#1a1a1a",
		blood: "#8a0303",
		blue: "#3b82f6",
		brass: "#b5a642",
		bronze: "#cd7f32",
		brown: "#8b5a2b",
		burgundy: "#800020",
		charcoal: "#36454f",
		chartreuse: "#7fff00",
		cherry: "#de3163",
		clear: "#e8f4f8",
		cobalt: "#0047ab",
		colorless: "#e8f4f8",
		colourless: "#e8f4f8",
		copper: "#b87333",
		coral: "#ff7f50",
		crimson: "#dc143c",
		cyan: "#22d3ee",
		ecru: "#c2b280",
		emerald: "#10b981",
		flesh: "#ffcfb5",
		flickering: "#ffd9a0",
		forest: "#228b22",
		fuchsia: "#ff00ff",
		gold: "#d4af37",
		golden: "#d4af37",
		gray: "#8b95a5",
		green: "#22c55e",
		grey: "#8b95a5",
		honey: "#eba937",
		incandescent: "#fff4c2",
		indigo: "#6366f1",
		iridescent: "#c9b6e4",
		ivory: "#fffff0",
		jade: "#00a86b",
		lavender: "#c4a3e8",
		lemon: "#fff44f",
		lime: "#84cc16",
		magenta: "#d946ef",
		maroon: "#800000",
		mauve: "#e0b0ff",
		milky: "#f5f2ec",
		mint: "#98ff98",
		navy: "#001f5b",
		ochre: "#cc7722",
		olive: "#808000",
		opalescent: "#dfe8ec",
		opaque: "#9aa3ad",
		orange: "#f97316",
		pearl: "#f0ead6",
		pearly: "#f0ead6",
		peach: "#ffcba4",
		pink: "#ec4899",
		plum: "#8e4585",
		prismatic: "#c9b6e4",
		puce: "#a95c68",
		purple: "#a855f7",
		rainbow: "#c9b6e4",
		red: "#ef4444",
		rose: "#ff007f",
		ruby: "#e0115f",
		russet: "#80461b",
		rust: "#b7410e",
		sable: "#0c0c0c",
		salmon: "#fa8072",
		sapphire: "#0f52ba",
		scarlet: "#ff2400",
		sea: "#2e8b8b",
		sepia: "#704214",
		silver: "#c0c0c0",
		silvery: "#c0c0c0",
		sky: "#87ceeb",
		slate: "#708090",
		smoky: "#7a7168",
		snow: "#fffafa",
		steel: "#71797e",
		straw: "#e4d96f",
		tan: "#d2b48c",
		teal: "#14b8a6",
		topaz: "#ffc87c",
		translucent: "#dfe8ec",
		turquoise: "#40e0d0",
		umber: "#635147",
		vermilion: "#e34234",
		violet: "#8b5cf6",
		white: "#f8fafc",
		wine: "#722f37",
		yellow: "#eab308",
	};

	/** Words that shade the colour that follows them, rather than being colours themselves. */
	static _COLOR_MODIFIERS = {
		pale: 0.45,
		light: 0.35,
		pastel: 0.4,
		deep: -0.35,
		dark: -0.4,
		bright: 0.15,
		mirrored: 0.2,
		faded: 0.3,
		dusty: 0.15,
	};

	// #endregion

	constructor (page) {
		this._page = page;
		this._state = page.getState();
		/** @type {HTMLElement|null} */
		this._modalBody = null;
		/** @type {HTMLElement|null} Persists outside the re-rendered body so it stays announced. */
		this._liveRegion = null;
		/** @type {(() => void)|null} */
		this._doClose = null;
		/** Free-text filter, persisted only for the life of the open modal. */
		this._filterText = "";
		/** Source Type code filter, or "" for all. */
		this._filterType = "";
		/** Show only stones that can be spent right now. */
		this._filterActionable = false;
	}

	/** Refresh the live state reference (the state object is swapped on load). */
	_refreshState () { this._state = this._page.getState(); }

	// ==========================================================================================
	// #region Detection — pure, static, and the part most worth testing
	// ==========================================================================================

	/**
	 * Every text fragment an item carries, flattened, with `{#itemEntry Name|Source}`
	 * references resolved. Depth-tolerant: the rules block sits two sub-blocks deep
	 * (`entries -> "General Ioun Stone Rules" -> "Ioun Bond" -> string`).
	 *
	 * Resolution is essential rather than cosmetic. The brew keeps the shared rules — the
	 * "Ioun bond" definition this module keys the whole bonding pipeline on — behind such a
	 * reference, and references are only dereferenced at RENDER time. A walk that reads
	 * literal strings alone therefore finds no bond text on any real stone, and
	 * `usesIounBond` would quietly return `false` for all 682 of them.
	 *
	 * Delegates to `CharacterSheetState`'s resolver so the two walks cannot diverge.
	 */
	static _getItemText (item, depth = 0, seenRefs = new Set()) {
		if (!item || depth > 10) return "";
		if (typeof item === "string") {
			const State = globalThis.CharacterSheetState;
			if (!item.includes("{#itemEntry") || !State?._walkItemEntryRefs) return item;
			const parts = [item];
			State._walkItemEntryRefs(item, seenRefs, ref => parts.push(CharacterSheetIoun._getItemText(ref, depth + 1, seenRefs)));
			return parts.join(" ");
		}
		if (Array.isArray(item)) return item.map(it => CharacterSheetIoun._getItemText(it, depth + 1, seenRefs)).join(" ");
		if (typeof item !== "object") return "";
		const parts = [];
		if (item.name) parts.push(String(item.name));
		for (const key of ["entries", "entry", "items"]) {
			if (item[key]) parts.push(CharacterSheetIoun._getItemText(item[key], depth + 1, seenRefs));
		}
		return parts.join(" ");
	}

	/**
	 * Is this an Ioun Stone at all? Name first (cheap and reliable across every book), falling
	 * back to the bond text so a differently-named future stone still registers.
	 *
	 * Deliberately excludes "Ioun Geode" and "Ioun Sand" — they are raw materials, not stones,
	 * and neither orbits.
	 */
	static isIounStone (item) {
		const State = globalThis.CharacterSheetState;
		if (State?.isIounStone) return State.isIounStone(item);
		if (!item) return false;
		if (/\bioun stone\b/i.test(item.name || "")) return true;
		return /\bioun bond\b/i.test(CharacterSheetIoun._getItemText(item));
	}

	/**
	 * Does this stone use the homebrew bond ruleset (7 consecutive days, slot-free, accelerated
	 * by orbiting stones)? With state, this delegates to the centralized effective policy.
	 * Without state, it reports only the item's intrinsic text rule for pure detection callers.
	 */
	static usesIounBond (item, {state = null} = {}) {
		if (!item) return false;
		if (state?.getIounBondPolicy) return state.getIounBondPolicy(item).usesBond;
		return /\bioun bond\b/i.test(CharacterSheetIoun._getItemText(item));
	}

	/** `"Ioun Stone #001, Pale Blue Rhomboid"` -> `"#001"`. `null` when unnumbered. */
	static getStoneNumber (item) {
		const m = /ioun stone\s+(#\d+)/i.exec(item?.name || "");
		return m ? m[1] : null;
	}

	/**
	 * The colour-and-shape descriptor players actually say out loud.
	 * `"Ioun Stone #001, Pale Blue Rhomboid"` -> `"Pale Blue Rhomboid"`.
	 * `"Ioun Stone, Absorption"` -> `"Absorption"`.
	 */
	static getStoneDescriptor (item) {
		const name = item?.name || "";
		const idx = name.indexOf(",");
		const tail = idx >= 0 ? name.slice(idx + 1) : name.replace(/\bioun stone\b/i, "");
		return tail.replace(/\(super-charged\)/i, "").trim() || name;
	}

	/** Is this the super-charged variant? Shares a descriptor with its base stone. */
	static isSuperCharged (item) { return /\(super-charged\)/i.test(item?.name || ""); }

	/** Blend a hex colour toward white (amount > 0) or black (amount < 0). */
	static _shade (hex, amount) {
		const n = parseInt(hex.slice(1), 16);
		const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => {
			const target = amount > 0 ? 255 : 0;
			return Math.round(c + (target - c) * Math.abs(amount));
		});
		return `#${ch.map(c => c.toString(16).padStart(2, "0")).join("")}`;
	}

	/**
	 * A swatch colour parsed from the stone's own descriptor. Returns `null` when nothing
	 * resolves, so the caller can render a neutral swatch rather than a wrong one.
	 */
	static getSwatchColor (item) {
		const words = CharacterSheetIoun.getStoneDescriptor(item).toLowerCase().split(/[\s-]+/);
		let color = null;
		let modifier = 0;
		for (const raw of words) {
			const w = raw.replace(/[^a-z]/g, "");
			if (!w) continue;
			if (CharacterSheetIoun._COLOR_WORDS[w] && !color) {
				color = CharacterSheetIoun._COLOR_WORDS[w];
			} else if (CharacterSheetIoun._COLOR_MODIFIERS[w] != null && !color) {
				// Modifiers precede their colour ("Pale Blue"); keep the strongest seen.
				if (Math.abs(CharacterSheetIoun._COLOR_MODIFIERS[w]) > Math.abs(modifier)) {
					modifier = CharacterSheetIoun._COLOR_MODIFIERS[w];
				}
			}
		}
		if (!color) return null;
		return modifier ? CharacterSheetIoun._shade(color, modifier) : color;
	}

	/**
	 * Source Type codes declared by the stone, e.g. `[{code: "P", …}]` or two entries for a
	 * Voluntary + Limited stone. Read off the `{@variantrule Ioun Source Type: Permanent (P)|…}`
	 * line that phase 1 wrote, so the badges and the rules text can never drift apart.
	 *
	 * `full` is kept verbatim so the badge can rebuild the exact variantrule tag (and therefore
	 * hover-link to the definition) rather than guessing at the naming — the code-less types
	 * (Micro, Drusy, Varies) don't follow the `Label (X)` shape.
	 *
	 * Official Ioun Stones declare no Source Type and correctly yield `[]`.
	 */
	static getSourceTypes (item) {
		const text = CharacterSheetIoun._getItemText(item);
		const out = [];
		const re = /Ioun Source Type:\s*([A-Za-z-]+)(?:\s*\(([A-Z])\))?/g;
		let m;
		while ((m = re.exec(text)) !== null) {
			const label = m[1];
			const code = m[2] || label;
			const short = m[2] ? `${label} (${m[2]})` : label;
			if (!out.some(t => t.code === code)) out.push({code, label, short, full: m[0]});
		}
		return out;
	}

	/** Does spending this stone's last charge end it for good? */
	static isTerminalType (item) {
		return CharacterSheetIoun.getSourceTypes(item)
			.some(t => CharacterSheetIoun._TERMINAL_TYPE_CODES.has(t.code));
	}

	/**
	 * `"orbiting"` | `"set"` | `"stowed"` | `"spent"`.
	 *
	 * These are four PLACES a stone can be, not four modes it can run in. `set` means it is
	 * mounted in a host item's setting (an Ioun Blade's blade or crossguard) — which is still
	 * functioning, exactly like orbiting, just somewhere else. That is why `set` is grouped
	 * with `orbiting` and not with `stowed`.
	 *
	 * Spent is only reachable for the Source Types whose charges never come back (Single-Use,
	 * Charge-Holding, Temporary) — an ordinary stone at 0 charges is merely empty until dawn,
	 * and calling that "spent" would be a lie the player acts on. A spent stone that is
	 * physically sitting in a setting reports `spent`, because that is what the player needs
	 * to know; it keeps its seat (and the host keeps its bonus) until it is pried out.
	 *
	 * @param item
	 * @param [opts]
	 * @param [opts.isSet] Whether this stone currently occupies a host item's setting.
	 */
	static getStoneState (item, {isSet = false} = {}) {
		const max = Number(item?.charges) || 0;
		if (max > 0 && CharacterSheetIoun.getChargesRemaining(item) <= 0 && CharacterSheetIoun.isTerminalType(item)) return "spent";
		if (isSet) return "set";
		return item?.equipped ? "orbiting" : "stowed";
	}

	/**
	 * Charges left, following the sheet-wide convention that an absent `chargesCurrent` means
	 * FULL, not empty (see `charactersheet-inventory.js:3801` / `:3934`). Reading it as 0 would
	 * mark every freshly acquired multi-charge stone as spent the moment it entered the bag.
	 */
	static getChargesRemaining (item) {
		return Number(item?.chargesCurrent ?? item?.charges) || 0;
	}

	/** Can this stone be deliberately spent right now? Drives the "can act now" filter. */
	static isActionableNow (item) {
		if (CharacterSheetIoun.getStoneState(item) !== "orbiting") return false;
		const types = CharacterSheetIoun.getSourceTypes(item).map(t => t.code);
		if (!types.some(c => ["V", "L", "S", "C"].includes(c))) return false;
		const max = Number(item?.charges) || 0;
		if (max > 0) return CharacterSheetIoun.getChargesRemaining(item) > 0;
		return true;
	}

	// #endregion

	// ==========================================================================================
	// #region Collection maths — pure
	// ==========================================================================================

	/**
	 * *"Each functioning stone in orbit reduces the time required to form another Ioun bond by
	 * 1 day, to a minimum of 3 days."*
	 */
	static getBondDaysRequired (orbitingCount) {
		return Math.max(
			CharacterSheetIoun.BOND_DAYS_MIN,
			CharacterSheetIoun.BOND_DAYS_BASE - Math.max(0, Number(orbitingCount) || 0),
		);
	}

	// #endregion

	// ==========================================================================================
	// #region Reading the character
	// ==========================================================================================

	/** Every Ioun Stone in the inventory, bonded or not. */
	getAllStones () {
		this._refreshState();
		return (this._state.getItems() || []).filter(i => CharacterSheetIoun.isIounStone(i));
	}

	/** Bonded stones — the ones this surface governs. */
	getBondedStones () { return this.getAllStones().filter(i => i.attuned); }

	getOrbitingStones () {
		const setIds = this.getSetStoneIds();
		return this.getBondedStones()
			.filter(i => !setIds.has(i.id) && CharacterSheetIoun.getStoneState(i) === "orbiting");
	}

	/** The ids of every stone currently occupying a host item's setting. */
	getSetStoneIds () {
		const out = new Set();
		for (const {row} of this._state.getIounHosts?.() || []) {
			for (const id of row.item?.iounSet || []) out.add(id);
		}
		return out;
	}

	/**
	 * Every host item the character owns, with its policy and its seated stones resolved.
	 *
	 * A seat that points at a stone which is no longer a stone (or no longer held) is dropped
	 * here rather than rendered as a hole — `reconcileIounHosts` normally prevents that, but
	 * the UI must not depend on a repair pass having already run.
	 */
	getHostItems () {
		this._refreshState();
		const stonesById = new Map(this.getAllStones().map(s => [s.id, s]));
		return (this._state.getIounHosts?.() || []).map(({row, policy}) => {
			const seated = (row.item?.iounSet || []).map(id => stonesById.get(id)).filter(Boolean);
			return {
				id: row.id,
				name: row.item?.name || "Item",
				equipped: !!row.equipped,
				policy,
				seated,
				isAttunementWaived: !!this._state.isIounAttunementWaived?.(row.item),
				// The bonus the readout announces. `bonusWeapon` is the Ioun Blade's headline
				// number; a DM-declared host falls back to whatever its policy grants first.
				bonusKey: policy.grants[0],
				bonusBase: Number(row.item?.iounBaseBonuses?.[policy.grants[0]] ?? row.item?.[policy.grants[0]]) || 0,
				bonusNow: Number(row.item?.[policy.grants[0]]) || 0,
			};
		});
	}

	/** Stones that could be seated right now: bonded, not spent, not already in a setting. */
	getSeatableStones () {
		const setIds = this.getSetStoneIds();
		return this.getBondedStones()
			.filter(s => !setIds.has(s.id) && CharacterSheetIoun.getStoneState(s) !== "spent");
	}

	/** Stones part-way through a 7-day bond. */
	getBondingStones () {
		const bonds = this._state.getIounBonds?.() || {};
		return this.getAllStones()
			.filter(i => !i.attuned && bonds[i.id] != null && CharacterSheetIoun.usesIounBond(i, {state: this._state}))
			.map(i => ({...i, bondDaysElapsed: bonds[i.id]}));
	}

	/** Stones eligible to START a bond: held, unbonded, effective bond ruleset, not already bonding. */
	getBondableStones () {
		const bonds = this._state.getIounBonds?.() || {};
		return this.getAllStones()
			.filter(i => !i.attuned && bonds[i.id] == null && CharacterSheetIoun.usesIounBond(i, {state: this._state}));
	}

	/**
	 * Descriptors held by more than one ORBITING stone. *"It gains no benefit from two stones
	 * with the same color and shape."* Rare by measurement (6 collisions in 600, plus every
	 * base/super-charged pair), so this is a quiet inline warning, never a headline.
	 */
	getDuplicateDescriptors () {
		const seen = new Map();
		const setIds = this.getSetStoneIds();
		const functioning = [
			...this.getOrbitingStones(),
			...this.getBondedStones().filter(s => setIds.has(s.id)),
		];
		for (const stone of functioning) {
			const key = CharacterSheetIoun.getStoneDescriptor(stone).toLowerCase();
			seen.set(key, (seen.get(key) || 0) + 1);
		}
		return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
	}

	/** The module shows itself only once there is something to manage. */
	isApplicable () {
		return this.getBondedStones().length > 0
			|| this.getBondingStones().length > 0
			|| this.getBondableStones().length > 0;
	}

	// #endregion

	// ==========================================================================================
	// #region Actions — all write through the same setters the inventory uses
	// ==========================================================================================

	/** Toss into orbit / seize and stow a single stone. */
	toggleOrbit (itemId) {
		this._refreshState();
		const stone = this.getAllStones().find(i => i.id === itemId);
		if (!stone) return false;
		if (CharacterSheetIoun.getStoneState(stone) === "spent") return false;
		this._state.setItemEquipped(itemId, !stone.equipped);
		this._afterChange();
		return true;
	}

	/**
	 * Seat a bonded stone in a host item's setting.
	 *
	 * Deliberately NO batch equivalent: seating is per-stone and per-setting, so a "Set all"
	 * would misrepresent it exactly as an "Orbit all" would misrepresent tossing.
	 */
	setStone (hostId, stoneId) {
		this._refreshState();
		const res = this._state.setIounStone?.(hostId, stoneId) || {success: false};
		if (res.success) this._afterChange();
		return res;
	}

	/** Pry a stone back out. It returns to your hand — stowed, not orbiting. */
	unsetStone (hostId, stoneId) {
		this._refreshState();
		const res = this._state.unsetIounStone?.(hostId, stoneId) || {success: false};
		if (res.success) this._afterChange();
		return res;
	}

	/** One Utilize action, any number of stones — the book's own batch. */
	stowAll () {
		this._refreshState();
		const orbiting = this.getOrbitingStones();
		orbiting.forEach(stone => this._state.setItemEquipped(stone.id, false));
		this._afterChange();
		return orbiting.length;
	}

	/** Begin the 7-day bond. */
	startBond (itemId) {
		this._refreshState();
		if (!this._state.setIounBondDays) return false;
		const stone = this.getAllStones().find(i => i.id === itemId);
		if (!stone || stone.attuned || !CharacterSheetIoun.usesIounBond(stone, {state: this._state})) return false;
		this._state.setIounBondDays(itemId, 0);
		this._afterChange();
		return true;
	}

	cancelBond (itemId) {
		this._refreshState();
		this._state.clearIounBond?.(itemId);
		this._afterChange();
		return true;
	}

	/**
	 * Advance every in-progress bond by a day.
	 *
	 * Bonding is 7 *consecutive days*; a long rest is 8 hours, so this deliberately does NOT
	 * ride the rest flow — it is an explicit downtime control.
	 *
	 * The requirement is recomputed live from the current orbit count (floored at 3). A stone
	 * therefore completes the moment its elapsed days meet the *current* requirement, which is
	 * what makes the collection accelerator feel like a live reward rather than a number fixed
	 * at bond start.
	 *
	 * @returns {{advanced: number, completed: Array<object>}}
	 */
	advanceBondDay () {
		this._refreshState();
		const required = CharacterSheetIoun.getBondDaysRequired(this.getOrbitingStones().length);
		const completed = [];
		const bonding = this.getBondingStones();
		for (const stone of bonding) {
			const days = stone.bondDaysElapsed + 1;
			if (days >= required) {
				// `attune` bypasses the slot cap for bond-exempt stones (phase 2).
				if (this._state.attune(stone.id)) {
					this._state.clearIounBond?.(stone.id);
					completed.push(stone);
				} else {
					this._state.setIounBondDays?.(stone.id, days);
				}
			} else {
				this._state.setIounBondDays?.(stone.id, days);
			}
		}
		this._afterChange();
		return {advanced: bonding.length, completed};
	}

	/**
	 * Persist + repaint everything that reads item state.
	 *
	 * The sheet-wide repaint is `_renderCharacter()`, NOT `render()` — the page class has no
	 * `render` method. Because every call site here is optional-chained (to survive a partially
	 * initialised page), getting the name wrong fails *silently*: the modal would still repaint
	 * itself via `_renderModalBody()` and therefore look correct, while the inventory, the combat
	 * panel, AC and item bonuses all stayed stale until an unrelated tab switch. Keep this in
	 * sync with the convention used throughout `charactersheet-combat.js`.
	 */
	_afterChange () {
		try {
			this._page.saveCharacter?.();
			this._page._renderCharacter?.();
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("[Ioun] Failed to refresh after change:", e);
		}
		if (this._modalBody) this._renderModalBody();
	}

	// #endregion

	// ==========================================================================================
	// #region Summary — the single source of truth shared by the modal and the combat panel
	// ==========================================================================================

	getCombatSummary () {
		if (!this.isApplicable()) return {applicable: false};
		const bonded = this.getBondedStones();
		const orbiting = this.getOrbitingStones();
		const bonding = this.getBondingStones();
		// A SET stone is functioning too, so "nothing is working" has to count both places or
		// the sheet would warn a player about a problem they do not have.
		const setCount = this.getSetStoneIds().size;
		return {
			applicable: true,
			bondedCount: bonded.length,
			orbitingCount: orbiting.length,
			setCount,
			functioningCount: orbiting.length + setCount,
			bondingCount: bonding.length,
			// Set stones count for the collection rules — they are still yours and still working.
			// Conspicuousness deliberately does NOT count them: a gem in a sword hilt is not a
			// stone circling your head.
			nextBondDays: CharacterSheetIoun.getBondDaysRequired(orbiting.length + setCount),
			canGift: bonded.length >= CharacterSheetIoun.GIFTING_THRESHOLD,
			isConspicuous: orbiting.length >= CharacterSheetIoun.CONSPICUOUS_THRESHOLD,
			duplicates: this.getDuplicateDescriptors(),
			actionableCount: orbiting.filter(s => CharacterSheetIoun.isActionableNow(s)).length,
		};
	}

	// #endregion

	// ==========================================================================================
	// #region UI
	// ==========================================================================================

	/** The three-state toggle, re-worded in the book's own vocabulary. */
	static _TOGGLE_VOCAB = {
		on: {label: "ORBITING", icon: "bolt"},
		off: {label: "STOWED", icon: "off"},
		// `used`'s shared glyph is a green check ("done this round"), which misreads as success
		// for a stone that is gone for good; `none` states depletion plainly.
		used: {label: "SPENT", icon: "none"},
	};

	/** Render a `{@variantrule}` tag, falling back to plain text outside the browser. */
	static _renderTag (tag, fallback) {
		try {
			return globalThis.Renderer?.get?.().render(tag) ?? fallback;
		} catch (e) {
			return fallback;
		}
	}

	static _escapeAttr (str) { return String(str).replace(/"/g, "&quot;"); }

	/** The Source Type badges, each hover-linked to the rule phase 1 authored. */
	static _getTypeBadgesHtml (stone) {
		return CharacterSheetIoun.getSourceTypes(stone).map(t => {
			const inner = CharacterSheetIoun._renderTag(
				`{@variantrule ${t.full}|MECIounStones|${t.short}}`,
				CharacterSheetIoun._escapeAttr(t.short),
			);
			return `<span class="cs-ioun-badge" data-type-code="${CharacterSheetIoun._escapeAttr(t.code)}">${inner}</span>`;
		}).join("");
	}

	/**
	 * A set stone's toggle. `SET` is an ON state — the stone is functioning, just gripped in
	 * metal rather than free-floating — so it wears the ON skin, and pressing it pries the
	 * stone out exactly as pressing `ORBITING` seizes and stows one.
	 */
	static _SET_TOGGLE_VOCAB = {
		on: {label: "SET", icon: "bolt"},
		used: {label: "SPENT", icon: "none"},
	};

	/** How a host's headline bonus is spoken, so "+2" is never a naked number. */
	static _GRANT_LABELS = {
		bonusWeapon: "attack & damage",
		bonusWeaponAttack: "attack",
		bonusWeaponDamage: "damage",
		bonusAc: "AC",
		bonusSavingThrow: "saving throws",
		bonusSpellAttack: "spell attack",
		bonusSpellSaveDc: "spell save DC",
	};

	static _fmtBonus (n) { return `${n >= 0 ? "+" : ""}${n}`; }

	/**
	 * One host item: identity, the superseded-value readout, and a tray of its EMPTY settings.
	 *
	 * Filled settings are not repeated as bezels — the stones themselves are rendered as rows
	 * beneath, in the same grammar they use in every other zone, so a set stone keeps its
	 * badges and its charge caption instead of shrinking to an anonymous dot. The tray is
	 * therefore purely the "there is room here" affordance.
	 */
	_getHostRowHtml (host) {
		const filled = host.seated.length;
		const total = host.policy.settings;
		const label = CharacterSheetIoun._GRANT_LABELS[host.bonusKey] || "bonus";
		const isRaised = host.bonusNow !== host.bonusBase;

		const metaBits = [];
		metaBits.push(host.equipped ? "equipped" : "not equipped — its bonus is dormant");
		if (host.isAttunementWaived) metaBits.push("bond-borne — no attunement needed");

		const bezels = [];
		for (let i = filled; i < total; ++i) {
			bezels.push(`<button type="button" class="cs-ioun-bezel cs-ioun-bezel--empty" data-ioun-seat="${CharacterSheetIoun._escapeAttr(host.id)}" title="Set one of your bonded stones into this ${CharacterSheetIoun._escapeAttr(host.policy.settingLabel)}" aria-label="Empty ${CharacterSheetIoun._escapeAttr(host.policy.settingLabel)} on ${CharacterSheetIoun._escapeAttr(host.name)} — set a stone">◇</button>`);
		}

		return `
			<div class="cs-ioun-host${host.equipped ? "" : " cs-ioun-host--dormant"}">
				<span class="cs-ioun-host__glyph" aria-hidden="true">◈</span>
				<span class="cs-ioun-row__identity">
					<span class="cs-ioun-row__name">${CharacterSheetIoun._escapeAttr(host.name)}</span>
					<span class="cs-ioun-host__meta ve-muted ve-small">${metaBits.join(" · ")}</span>
				</span>
				<span class="cs-ioun-host__readout" role="img" aria-label="${label} bonus ${isRaised ? `raised from ${CharacterSheetIoun._fmtBonus(host.bonusBase)} to ` : "is "}${CharacterSheetIoun._fmtBonus(host.bonusNow)}">
					${isRaised ? `<span class="cs-combat-strip__value-was">${CharacterSheetIoun._fmtBonus(host.bonusBase)}</span>` : ""}<span class="cs-combat-strip__value">${CharacterSheetIoun._fmtBonus(host.bonusNow)}</span>
					<span class="cs-ioun-host__readout-label ve-muted ve-small">${label}</span>
				</span>
				<span class="cs-ioun-host__tray">
					<span class="cs-ioun-host__count ve-muted ve-small">${filled} / ${total} set</span>
					${bezels.join("")}
				</span>
			</div>`;
	}

	/** One stone row: swatch, identity, type badges, charges, state toggle. */
	_getStoneRowHtml (stone, {isSet = false, hostId = null} = {}) {
		const state = CharacterSheetIoun.getStoneState(stone, {isSet});
		const swatch = CharacterSheetIoun.getSwatchColor(stone);
		const num = CharacterSheetIoun.getStoneNumber(stone);
		const desc = CharacterSheetIoun.getStoneDescriptor(stone);
		const isSpent = state === "spent";

		// `color` is set alongside `background` so the CSS halo can use `currentColor`
		// and glow in the stone's own hue; without it every halo would be text-coloured.
		const swatchStyle = swatch ? ` style="background:${CharacterSheetIoun._escapeAttr(swatch)};color:${CharacterSheetIoun._escapeAttr(swatch)}"` : "";
		// A set stone keeps its halo — it is still working — but gains a hard collar where an
		// orbiting stone has only soft light: gripped in metal, not free-floating.
		const swatchHtml = `<span class="cs-ioun-swatch${swatch ? "" : " cs-ioun-swatch--unknown"}${isSet ? " cs-ioun-swatch--set" : ""}"${swatchStyle} aria-hidden="true"></span>`;

		const max = Number(stone.charges) || 0;
		const chargesHtml = max > 0
			? csCombatPoolCaption(CharacterSheetIoun.getChargesRemaining(stone), max, {recharge: stone.recharge || ""})
			: "";

		// A set stone's control PRIES IT OUT; an orbiting/stowed stone's control moves it
		// between orbit and the pack. Same affordance, different verb, so the seat is
		// reversible from exactly where the player is already looking.
		const toggleHtml = isSet
			? csCombatStateToggle({
				state: isSpent ? "used" : "on",
				labelPrefix: desc,
				ariaState: isSpent
					? "spent, but still filling a setting"
					: "set in an item, conferring its benefit and raising the item's bonus",
				// The book states no action for replacing a gemstone, so none is claimed here.
				title: "Pry this stone out — it returns to your pack, stowed",
				vocab: CharacterSheetIoun._SET_TOGGLE_VOCAB,
				domClass: "cs-ioun-row__toggle cs-ioun-row__toggle--set",
				attrs: {"data-ioun-unset": stone.id, "data-ioun-host": hostId || ""},
			})
			: csCombatStateToggle({
				state: isSpent ? "used" : (state === "orbiting" ? "on" : "off"),
				labelPrefix: desc,
				ariaState: isSpent ? "spent — bond ended" : (state === "orbiting" ? "in orbit, conferring its benefit" : "stowed, conferring nothing"),
				title: isSpent
					? "This stone is spent; its bond has ended"
					: (state === "orbiting" ? "Seize and stow (Utilize action)" : "Toss into orbit (Magic action)"),
				disabled: isSpent,
				vocab: CharacterSheetIoun._TOGGLE_VOCAB,
				domClass: "cs-ioun-row__toggle",
				attrs: {"data-ioun-toggle": stone.id},
			});

		return `
			<div class="cs-ioun-row${isSpent ? " cs-ioun-row--spent" : ""}${isSet ? " cs-ioun-row--set" : ""}">
				${swatchHtml}
				<span class="cs-ioun-row__identity">
					${num ? `<span class="cs-ioun-row__num">${num}</span>` : ""}
					<span class="cs-ioun-row__name">${CharacterSheetIoun._escapeAttr(desc)}</span>
					${CharacterSheetIoun.isSuperCharged(stone) ? `<span class="cs-ioun-badge cs-ioun-badge--super" title="Super-charged variant">Super-charged</span>` : ""}
					${CharacterSheetIoun._getTypeBadgesHtml(stone)}
				</span>
				${chargesHtml ? `<span class="cs-ioun-row__charges">${chargesHtml}</span>` : ""}
				${toggleHtml}
			</div>`;
	}

	/** A recessed zone. Per the Recessed-Inset Rule these sit on the base tone — not cards. */
	static _getZoneHtml ({title, count, actionsHtml = "", bodyHtml, emptyText}) {
		return `
			<section class="cs-ioun-zone">
				<div class="cs-ioun-zone__header">
					<h5 class="cs-ioun-zone__title">${title} <span class="cs-ioun-zone__count">${count}</span></h5>
					${actionsHtml ? `<div class="cs-ioun-zone__actions">${actionsHtml}</div>` : ""}
				</div>
				${bodyHtml || `<div class="cs-ioun-empty ve-muted ve-small">${emptyText}</div>`}
			</section>`;
	}

	/** Apply the modal's filters. */
	/**
	 * @param stones
	 * @param [opts]
	 * @param [opts.isApplyActionable] Whether the "can act now" filter participates. It is
	 *        meaningless for a stone that is not yet in orbit, so the bonding pipeline opts out.
	 */
	_applyFilters (stones, {isApplyActionable = true} = {}) {
		const q = this._filterText.trim().toLowerCase();
		return stones.filter(stone => {
			if (this._filterType && !CharacterSheetIoun.getSourceTypes(stone).some(t => t.code === this._filterType)) return false;
			if (isApplyActionable && this._filterActionable && !CharacterSheetIoun.isActionableNow(stone)) return false;
			if (q && !`${stone.name}`.toLowerCase().includes(q)) return false;
			return true;
		});
	}

	_renderModalBody () {
		if (!this._modalBody) return;
		this._refreshState();

		const summary = this.getCombatSummary();
		if (!summary.applicable) {
			this._modalBody.innerHTML = `<div class="ve-muted ve-text-center py-4">No bonded Ioun Stones.</div>`;
			return;
		}

		const orbiting = this._applyFilters(this.getOrbitingStones());
		const setIds = this.getSetStoneIds();
		const stowed = this._applyFilters(this.getBondedStones()
			.filter(s => !setIds.has(s.id) && CharacterSheetIoun.getStoneState(s) !== "orbiting"));
		// The filter bar sits above every zone, so it must govern every zone. Exempting the
		// pipeline would make the control silently lie about one third of the dialog.
		const bonding = this._applyFilters(this.getBondingStones(), {isApplyActionable: false});
		const bondable = this._applyFilters(this.getBondableStones(), {isApplyActionable: false});

		const stripHtml = csCombatStatusStrip([
			{label: "In orbit", value: summary.orbitingCount},
			...(summary.setCount ? [{label: "Set", value: summary.setCount}] : []),
			{label: "Bonded", value: summary.bondedCount},
			{label: "Next bond", value: `${summary.nextBondDays} ${summary.nextBondDays === 1 ? "day" : "days"}`},
		], {ariaLabel: "Ioun Stone collection"});

		// Every notice below is a real mechanical consequence a player would otherwise be
		// blindsided by, not decoration.
		const notices = [];
		if (!summary.functioningCount && summary.bondedCount > 0) {
			notices.push({icon: "warning", text: `Nothing is in orbit or set, so none of your ${summary.bondedCount} bonded stones ${summary.bondedCount === 1 ? "is" : "are"} conferring anything.`});
		}
		if (summary.canGift) {
			// An UNLOCKED ability, not a hazard — it must not wear the warning skin the two
			// genuine warnings use, or every notice reads as a problem.
			notices.push({tone: "good", icon: "ally", text: `${CharacterSheetIoun.GIFTING_THRESHOLD}+ bonded: as a Bonus Action you can send one orbiting stone to a creature within 30 feet (50% it bonds immediately).`});
		}
		if (summary.isConspicuous) {
			notices.push({icon: "warning", text: "A large collection is conspicuous — its light and movement normally prevent you from hiding in darkness."});
		}
		for (const dup of summary.duplicates) {
			notices.push({icon: "ban", text: `Two orbiting stones share the same colour and shape (${dup}) — you gain no benefit from the second.`});
		}
		const noticesHtml = notices.map(n => `<div class="cs-ioun-notice cs-ioun-notice--${n.tone || "warn"}">${csCombatIcon(n.icon)}<span>${n.text}</span></div>`).join("");

		const typeOptions = [...new Map(this.getBondedStones()
			.flatMap(s => CharacterSheetIoun.getSourceTypes(s))
			.map(t => [t.code, t])).values()]
			.sort((a, b) => a.short.localeCompare(b.short));

		const controlsHtml = `
			<div class="cs-ioun-controls">
				<input type="search" class="ve-form-control cs-ioun-search" id="cs-ioun-search" placeholder="Search stones…" aria-label="Search stones" value="${CharacterSheetIoun._escapeAttr(this._filterText)}">
				<label class="cs-ioun-control-label" for="cs-ioun-type">Type</label>
				<select class="ve-form-control cs-ioun-type" id="cs-ioun-type">
					<option value=""${this._filterType ? "" : " selected"}>All types</option>
					${typeOptions.map(t => `<option value="${CharacterSheetIoun._escapeAttr(t.code)}"${this._filterType === t.code ? " selected" : ""}>${CharacterSheetIoun._escapeAttr(t.short)}</option>`).join("")}
				</select>
				<label class="cs-ioun-control-check">
					<input type="checkbox" id="cs-ioun-actionable"${this._filterActionable ? " checked" : ""}>
					<span>Can act now${summary.actionableCount ? ` (${summary.actionableCount})` : ""}</span>
				</label>
			</div>`;

		// Deliberately asymmetric, mirroring the rules: stowing any number is ONE Utilize
		// action, so it gets a batch button; tossing is a Magic action PER stone, so there is
		// no "Orbit all" — offering one would misrepresent the action economy.
		const stowAllHtml = summary.orbitingCount
			? `<button type="button" class="cs-combat-btn" id="cs-ioun-stow-all" title="Seize and stow every orbiting stone — a single Utilize action, any number of stones">${csCombatIcon("reset")}<span>Stow all</span> <span class="ve-muted">(1 Utilize action)</span></button>`
			: "";

		const orbitBodyHtml = orbiting.length
			? `<div class="cs-ioun-list">${orbiting.map(s => this._getStoneRowHtml(s)).join("")}</div>`
			: null;

		// "Set in items" sits immediately beneath "In orbit": both zones hold FUNCTIONING
		// stones, so they belong adjacent, with the two not-functioning zones below them.
		//
		// The zone is ABSENT, not empty, for the overwhelming majority of characters who own
		// no host item — a dialog must not teach a mechanic to someone who cannot use it.
		const hosts = this.getHostItems();
		const settingHtml = hosts.length
			? CharacterSheetIoun._getZoneHtml({
				title: "Set in items",
				count: hosts.reduce((n, h) => n + h.seated.length, 0),
				// Prompt to bond only when there is genuinely nothing to seat. With every bonded
				// stone already seated the settings are simply full, which the per-host
				// "n / m set" count already says — a second, contradictory line would not.
				actionsHtml: (this.getSeatableStones().length || this.getBondedStones().length)
					? ""
					: `<span class="cs-ioun-zone__hint ve-muted ve-small">Bond a stone before you can set one</span>`,
				bodyHtml: `<div class="cs-ioun-list cs-ioun-list--hosts">${hosts.map(h => {
					const seated = this._applyFilters(h.seated, {isApplyActionable: false});
					return `<div class="cs-ioun-hostgroup" data-ioun-hostgroup="${CharacterSheetIoun._escapeAttr(h.id)}">
								${this._getHostRowHtml(h)}
								${seated.map(st => this._getStoneRowHtml(st, {isSet: true, hostId: h.id})).join("")}
							</div>`;
				}).join("")}</div>`,
			})
			: "";
		const stowedBodyHtml = stowed.length
			? `<div class="cs-ioun-list">${stowed.map(s => this._getStoneRowHtml(s)).join("")}</div>`
			: null;

		const bondingHtml = (bonding.length || bondable.length)
			? CharacterSheetIoun._getZoneHtml({
				title: "Bonding",
				count: bonding.length,
				actionsHtml: bonding.length
					? `<button type="button" class="cs-combat-btn cs-combat-btn--primary" id="cs-ioun-advance-day" title="Advance every bond in progress by one day. A bond needs ${summary.nextBondDays} consecutive days at your current orbit count.">Advance a day</button>`
					: "",
				bodyHtml: `
					${bonding.length ? `<div class="cs-ioun-list">${bonding.map(s => {
		const req = summary.nextBondDays;
		const pct = Math.min(100, Math.round((s.bondDaysElapsed / Math.max(1, req)) * 100));
		return `
							<div class="cs-ioun-row cs-ioun-row--bonding">
								<span class="cs-ioun-swatch" style="background:${CharacterSheetIoun._escapeAttr(CharacterSheetIoun.getSwatchColor(s) || "#64748b")};color:${CharacterSheetIoun._escapeAttr(CharacterSheetIoun.getSwatchColor(s) || "#64748b")}" aria-hidden="true"></span>
								<span class="cs-ioun-row__identity">
									${CharacterSheetIoun.getStoneNumber(s) ? `<span class="cs-ioun-row__num">${CharacterSheetIoun.getStoneNumber(s)}</span>` : ""}
									<span class="cs-ioun-row__name">${CharacterSheetIoun._escapeAttr(CharacterSheetIoun.getStoneDescriptor(s))}</span>
								</span>
								<span class="cs-ioun-bond-progress" role="img" aria-label="${s.bondDaysElapsed} of ${req} days">
									<span class="cs-ioun-bond-progress__bar" style="--cs-ioun-bond-pct:${pct / 100}"></span>
								</span>
								<span class="cs-ioun-row__charges ve-small">${s.bondDaysElapsed} / ${req} days</span>
								<button type="button" class="cs-combat-btn" data-ioun-cancel-bond="${s.id}" title="Stop forming this bond">Cancel</button>
							</div>`;
	}).join("")}</div>` : ""}
					${bondable.length ? `<div class="cs-ioun-bondable"><span class="ve-muted ve-small">Not yet bonded:</span>${bondable.map(s => `<button type="button" class="cs-combat-btn" data-ioun-start-bond="${s.id}" title="Begin a ${summary.nextBondDays}-day Ioun bond">${CharacterSheetIoun._escapeAttr(CharacterSheetIoun.getStoneDescriptor(s))}</button>`).join("")}</div>` : ""}`,
			})
			: "";

		this._modalBody.innerHTML = `
			<div class="cs-ioun">
				${stripHtml}
				${noticesHtml}
				${controlsHtml}
				${CharacterSheetIoun._getZoneHtml({
		title: "In orbit",
		count: orbiting.length,
		actionsHtml: stowAllHtml,
		bodyHtml: orbitBodyHtml,
		emptyText: this._filterText || this._filterType || this._filterActionable ? "No orbiting stones match the filter." : "No stones in orbit — toss one up to gain its benefit.",
	})}
				${settingHtml}
				${CharacterSheetIoun._getZoneHtml({
		title: "Stowed",
		count: stowed.length,
		// Uniform for every row in this zone, so it is stated once here rather than
		// repeated verbatim beside each stone.
		actionsHtml: stowed.length ? `<span class="cs-ioun-zone__hint ve-muted ve-small">Orbit one: 1 Magic action</span>` : "",
		bodyHtml: stowedBodyHtml,
		emptyText: this._filterText || this._filterType || this._filterActionable
			? "No stowed stones match the filter."
			: (setIds.size ? "Every bonded stone is in orbit or set into an item." : "Every bonded stone is in orbit."),
	})}
				${bondingHtml}
			</div>`;

		this._bindModalEvents();
	}

	_bindModalEvents () {
		const body = this._modalBody;
		if (!body) return;

		body.querySelector("#cs-ioun-stow-all")?.addEventListener("click", () => {
			const n = this.stowAll();
			this._announce(`Stowed ${n} ${n === 1 ? "stone" : "stones"}.`);
		});

		body.querySelector("#cs-ioun-advance-day")?.addEventListener("click", () => {
			const {completed} = this.advanceBondDay();
			this._announce(completed.length
				? `A day passes. ${completed.map(s => CharacterSheetIoun.getStoneDescriptor(s)).join(", ")} finished bonding.`
				: "A day passes.");
		});

		body.querySelectorAll("[data-ioun-toggle]").forEach(btn => {
			btn.addEventListener("click", () => {
				const id = btn.getAttribute("data-ioun-toggle");
				const stone = this.getAllStones().find(s => s.id === id);
				const wasOrbiting = !!stone?.equipped;
				this.toggleOrbit(id);
				this._announce(`${CharacterSheetIoun.getStoneDescriptor(stone)} ${wasOrbiting ? "stowed" : "in orbit"}.`);
			});
		});

		body.querySelectorAll("[data-ioun-seat]").forEach(btn => {
			btn.addEventListener("click", () => this._pSeatStone(btn.getAttribute("data-ioun-seat")));
		});
		body.querySelectorAll("[data-ioun-unset]").forEach(btn => {
			btn.addEventListener("click", () => this._pPryStone(
				btn.getAttribute("data-ioun-host"),
				btn.getAttribute("data-ioun-unset"),
			));
		});

		body.querySelectorAll("[data-ioun-start-bond]").forEach(btn => {
			btn.addEventListener("click", () => this.startBond(btn.getAttribute("data-ioun-start-bond")));
		});
		body.querySelectorAll("[data-ioun-cancel-bond]").forEach(btn => {
			btn.addEventListener("click", () => this.cancelBond(btn.getAttribute("data-ioun-cancel-bond")));
		});

		// Filters re-render in place; the search field keeps focus and caret so typing is not
		// interrupted by the repaint.
		const search = body.querySelector("#cs-ioun-search");
		search?.addEventListener("input", () => {
			this._filterText = /** @type {HTMLInputElement} */ (search).value;
			const caret = /** @type {HTMLInputElement} */ (search).selectionStart;
			this._renderModalBody();
			const next = /** @type {HTMLInputElement} */ (this._modalBody?.querySelector("#cs-ioun-search"));
			if (next) { next.focus(); next.setSelectionRange(caret, caret); }
		});
		body.querySelector("#cs-ioun-type")?.addEventListener("change", evt => {
			this._filterType = /** @type {HTMLSelectElement} */ (evt.target).value;
			this._renderModalBody();
		});
		body.querySelector("#cs-ioun-actionable")?.addEventListener("change", evt => {
			this._filterActionable = /** @type {HTMLInputElement} */ (evt.target).checked;
			this._renderModalBody();
		});
	}

	/**
	 * Choose a stone to seat in `hostId`.
	 *
	 * The picker reuses the manager's own stone-row markup rather than a bare `<select>`, so
	 * the list a player chooses from looks exactly like the list they were just reading —
	 * same swatch, same number, same Source Type badges.
	 */
	async _pSeatStone (hostId) {
		this._refreshState();
		const host = this.getHostItems().find(h => h.id === hostId);
		if (!host) return;

		const candidates = this.getSeatableStones();
		if (!candidates.length) {
			this._announce("You have no bonded stone free to set.");
			JqueryUtil.doToast({type: "warning", content: "No bonded stone is free to set. Bond one first, or pry one out of another item."});
			return;
		}

		// The title stays short so it can never collide with the close button on a narrow
		// screen; the host is named far more usefully by its own row, reproduced below.
		const {eleModalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "Set a stone",
			isWidth100: true,
			isMinHeight0: true,
		});

		const listHtml = candidates.map(st => {
			const swatch = CharacterSheetIoun.getSwatchColor(st);
			const num = CharacterSheetIoun.getStoneNumber(st);
			const style = swatch ? ` style="background:${CharacterSheetIoun._escapeAttr(swatch)};color:${CharacterSheetIoun._escapeAttr(swatch)}"` : "";
			return `
				<button type="button" class="cs-ioun-row cs-ioun-pick" data-ioun-pick="${CharacterSheetIoun._escapeAttr(st.id)}">
					<span class="cs-ioun-swatch${swatch ? "" : " cs-ioun-swatch--unknown"}"${style} aria-hidden="true"></span>
					<span class="cs-ioun-row__identity">
						${num ? `<span class="cs-ioun-row__num">${num}</span>` : ""}
						<span class="cs-ioun-row__name">${CharacterSheetIoun._escapeAttr(CharacterSheetIoun.getStoneDescriptor(st))}</span>
						${CharacterSheetIoun._getTypeBadgesHtml(st)}
					</span>
					<span class="cs-ioun-pick__where ve-muted ve-small">${st.equipped ? "in orbit" : "stowed"}</span>
				</button>`;
		}).join("");

		// Reproducing the host's own row is the honest way to answer "what am I upgrading?" —
		// it carries the same superseded readout the player was just looking at.
		eleModalInner.append(e_({
			outer: `
				<div class="cs-ioun cs-adaptive-panel ve-flex-col w-100">
					<div class="cs-ioun-hostgroup mb-2">${this._getHostRowHtml(host)}</div>
					<p class="ve-small ve-muted mb-2">The stone keeps conferring its own effect — setting it only changes where it sits. Each stone set raises this item's ${CharacterSheetIoun._GRANT_LABELS[host.bonusKey] || "bonus"} by ${host.policy.perStone}.</p>
					<div class="cs-ioun-list">${listHtml}</div>
				</div>`,
		}));

		eleModalInner.querySelectorAll("[data-ioun-pick]").forEach(btn => {
			btn.addEventListener("click", () => {
				const stone = candidates.find(c => c.id === btn.getAttribute("data-ioun-pick"));
				if (!stone) return;
				doClose(true);
				const res = this.setStone(hostId, stone.id);
				if (!res.success) {
					JqueryUtil.doToast({type: "danger", content: res.error || "Could not set that stone."});
					return;
				}
				const after = this.getHostItems().find(h => h.id === hostId);
				this._announce(`${CharacterSheetIoun.getStoneDescriptor(stone)} set into ${host.name}; ${CharacterSheetIoun._GRANT_LABELS[host.bonusKey] || "bonus"} now ${CharacterSheetIoun._fmtBonus(after?.bonusNow ?? host.bonusNow)}. The stone keeps conferring its own effect.`);
			});
		});
	}

	/** Pry a stone out, with a confirm — the stone comes back STOWED, not into orbit. */
	async _pPryStone (hostId, stoneId) {
		this._refreshState();
		const host = this.getHostItems().find(h => h.id === hostId);
		const stone = this.getAllStones().find(s => s.id === stoneId);
		if (!host || !stone) return;

		const desc = CharacterSheetIoun.getStoneDescriptor(stone);
		const confirmed = await InputUiUtil.pGetUserBoolean(/** @type {*} */ ({
			title: `Pry ${desc} out?`,
			htmlDescription: `<p>${desc} returns to your pack <b>stowed</b> — it will not fly back into orbit on its own.</p><p class="ve-muted ve-small">${host.name}'s ${CharacterSheetIoun._GRANT_LABELS[host.bonusKey] || "bonus"} drops to ${CharacterSheetIoun._fmtBonus(host.bonusNow - host.policy.perStone)}. Your bond is unaffected.</p>`,
			textYes: "Pry out",
			textNo: "Cancel",
		}));
		if (!confirmed) return;

		const res = this.unsetStone(hostId, stoneId);
		if (!res.success) {
			JqueryUtil.doToast({type: "danger", content: res.error || "Could not pry that stone out."});
			return;
		}
		const after = this.getHostItems().find(h => h.id === hostId);
		this._announce(`${desc} pried out of ${host.name} and stowed; ${CharacterSheetIoun._GRANT_LABELS[host.bonusKey] || "bonus"} now ${CharacterSheetIoun._fmtBonus(after?.bonusNow ?? host.bonusNow)}.`);
	}

	/**
	 * Polite live-region announcement.
	 *
	 * The region is created once in {@link openModal} as a SIBLING of the body, never inside
	 * it: `_renderModalBody` replaces `innerHTML` wholesale, and a live region that is
	 * destroyed and re-created on every state change is not reliably announced — assistive
	 * tech only narrates mutations to a region that was already in the accessibility tree.
	 * Reuses the shell's own `.cs-combat-sr-live` visually-hidden primitive.
	 */
	_announce (msg) {
		if (this._liveRegion) this._liveRegion.textContent = msg;
	}

	async openModal ({focusHostId = null} = {}) {
		// Re-entrancy guard. `pGetShow` happily stacks a second dialog, so a double-click on
		// "Manage…" (or a second entry point firing while one is open) would leave a stale,
		// unbound copy sitting on top of the live one. Refresh and focus the existing modal
		// instead of opening a rival.
		if (this._modalBody?.isConnected) {
			this._renderModalBody();
			if (focusHostId) { this._focusHost(focusHostId); return; }
			/** @type {HTMLElement} */ (this._modalBody.querySelector("#cs-ioun-search"))?.focus();
			return;
		}

		this._refreshState();
		const {eleModalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "Ioun Stones",
			isWidth100: true,
			cbClose: () => { this._modalBody = null; this._liveRegion = null; this._doClose = null; },
		});
		this._doClose = doClose;

		this._liveRegion = e_({tag: "div", clazz: "cs-combat-sr-live"});
		this._liveRegion.setAttribute("role", "status");
		this._liveRegion.setAttribute("aria-live", "polite");
		eleModalInner.appendChild(this._liveRegion);

		// `cs-adaptive-panel` names the container, so the layout below responds to the modal's
		// own width rather than the viewport — the same markup also renders in the Combat tab.
		this._modalBody = e_({tag: "div", clazz: "cs-ioun-modal cs-adaptive-panel"});
		eleModalInner.appendChild(this._modalBody);
		this._renderModalBody();
		if (focusHostId) this._focusHost(focusHostId);
	}

	/**
	 * Arriving from an item row, the player already knows which item they meant. Land them on
	 * it — scrolled into view and marked — rather than at the top of a list they must re-scan.
	 */
	_focusHost (hostId) {
		const group = /** @type {HTMLElement} */ (this._modalBody?.querySelector(`[data-ioun-hostgroup="${CSS.escape(String(hostId))}"]`));
		if (!group) return;
		group.scrollIntoView({block: "nearest", behavior: "smooth"});
		group.classList.add("cs-ioun-hostgroup--focused");
		/** @type {HTMLElement} */ (group.querySelector("[data-ioun-seat], [data-ioun-unset]"))?.focus();
	}

	// #endregion
}

globalThis.CharacterSheetIoun = CharacterSheetIoun;

export {CharacterSheetIoun};
