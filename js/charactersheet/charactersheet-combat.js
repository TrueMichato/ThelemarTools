/**
 * Character Sheet Combat Manager
 * Handles attacks, weapons, and combat-related actions
 */
import {CharacterSheetModal} from "./charactersheet-modal.js";

const {e_, ee} = /** @type {*} */ (globalThis);

/* ========================================================================
   Combat Section Shell — icon system (Phase 0)
   ------------------------------------------------------------------------
   Semantic icon keys → emoji glyphs. The sheet owner deliberately uses
   emoji as the sheet's iconography (matching the `charsheet__section-icon`
   emoji across the rest of the sheet), so the combat shell renders emoji
   here too rather than Font Awesome marks — a design choice restored per
   the owner's request (see docs/charactersheet/14-design-system-overhaul.md).
   The shell's a11y contract is unchanged: every glyph is decorative
   (`aria-hidden`) and always paired with a visible text label or an
   explicit `aria-label` on its control, so no glyph is ever load-bearing.
   Keys are a shared vocabulary — a semantic name maps to one representative
   emoji everywhere it is used. Unknown names fall through as a raw glyph, so
   a caller can pass an emoji directly. ======================================================================== */
const CS_COMBAT_ICONS = {
	"sneak": "🗡️",
	"bolt": "⚡",
	"off": "⭕",
	"used": "✅",
	"check": "✔️",
	"cross": "✖️",
	"ban": "🚫",
	"warning": "⚠️",
	"ally": "👥",
	"dice": "🎲",
	"dc": "🛡️",
	"none": "➖",
	// Action-economy trio.
	"action": "⚔️",
	"bonus": "⚡",
	"reaction": "🔄",
	// Verb vocabulary shared across the class surfaces (Fighter/Vitality/
	// Barbarian/Method migrations, Phase C).
	"heal": "💗",
	"surge": "🔥",
	"reset": "↩️",
	"refresh": "🔄",
	"rest": "🛏️",
	"stance": "✊",
	"weapon": "⚔️",
	"spark": "✨",
	"info": "ℹ️",
	"lock": "🔒",
	// Druid nature-magic vocabulary.
	"beast": "🐻",
	"familiar": "🧚",
	// Illrigger vocabulary (Interdiction + Conduit panels).
	"fire": "🔥",
	"move": "↪️",
	"charm": "🎭",
	"recycle": "♻️",
	"blood": "🩸",
	// Ranger Primal Focus vocabulary.
	"target": "🎯",
	"shield": "🛡️",
	"edit": "✏️",
	// Channeled cantrip vocabulary (rider row).
	"clear": "✖️",
};

/**
 * Action-economy vocabulary — the shared chip (emoji + word) used across the
 * class panels. One icon + one word per cost so "what does this cost me" reads
 * identically everywhere.
 */
const CS_COMBAT_ACTION_META = {
	"action": {icon: "action", label: "Action"},
	"bonus": {icon: "bonus", label: "Bonus Action"},
	"reaction": {icon: "reaction", label: "Reaction"},
	"free": {icon: "spark", label: "No Action"},
};

/**
 * Render a small full-border action-economy chip (icon + label). Decorative
 * icon + a visible word, so the cost never rides on a glyph alone.
 * @param {"action"|"bonus"|"reaction"|"free"} kind
 * @param {{labelOverride?: string, cls?: string}} [opts]
 * @returns {string}
 */
function csCombatActionChip (kind, {labelOverride, cls = ""} = {}) {
	const meta = CS_COMBAT_ACTION_META[kind];
	if (!meta) return "";
	const label = labelOverride || meta.label;
	return `<span class="cs-combat-chip${cls ? ` ${cls}` : ""}" title="Action economy: ${label}">${csCombatIcon(meta.icon)}<span>${label}</span></span>`;
}

/**
 * Render a Combat Section Shell icon as an HTML string. Decorative by
 * contract (`aria-hidden="true"`); the calling control supplies the
 * accessible text. Renders the mapped emoji glyph (see {@link CS_COMBAT_ICONS});
 * an unmapped value is rendered verbatim so a caller can pass an emoji directly.
 * @param {string} name Semantic key from {@link CS_COMBAT_ICONS}, or a raw glyph.
 * @param {{cls?: string}} [opts]
 * @returns {string}
 */
function csCombatIcon (name, {cls = ""} = {}) {
	const mapped = CS_COMBAT_ICONS[name];
	const glyph = mapped != null ? mapped : (name == null ? "" : String(name));
	return `<span class="cs-combat-icon cs-combat-icon--glyph${cls ? ` ${cls}` : ""}" aria-hidden="true">${glyph}</span>`;
}

/**
 * Render a canonical PoolDisplay caption (`N / M` with an optional recharge
 * note) as an HTML string. One caption grammar across every pool surface —
 * generic pools, synthetics, and bespoke pools (Seals, Conduit dice, Wild
 * Shape, SP) — so "how many do I have left" always reads the same. The
 * count/max split is spanned so screen readers announce "3 of 5". Marks
 * itself `--empty` at 0 so exhausted pools read consistently.
 * @param {number} current
 * @param {number} max
 * @param {{recharge?: string, cls?: string}} [opts] recharge e.g. "short rest".
 * @returns {string}
 */
function csCombatPoolCaption (current, max, {recharge = "", cls = ""} = {}) {
	const cur = Number(current) || 0;
	const mx = Number(max) || 0;
	const empty = cur <= 0 ? " cs-combat-pool--empty" : "";
	const rechargeHtml = recharge ? ` <span class="cs-combat-pool__recharge">(${recharge})</span>` : "";
	return `<span class="cs-combat-pool${empty}${cls ? ` ${cls}` : ""}"><span class="cs-combat-pool__count">${cur}</span><span class="cs-combat-pool__sep" aria-hidden="true"> / </span><span class="cs-combat-pool__max">${mx}</span><span class="ve-hidden"> remaining</span>${rechargeHtml}</span>`;
}

/* ========================================================================
   Combat Section Shell — accessibility spine (Phase B)
   ------------------------------------------------------------------------
   The Rogue vertical slice (Phase 0) hand-built the a11y-bearing chrome
   inline: a labelled `role="region"` section, a colour+icon+text state
   toggle with `aria-pressed`, a `role="group"` status strip, and condition
   pills. Those markup contracts are the single riskiest thing to re-author
   per class in the Phase-C fan-out (one forgotten `aria-pressed` or missing
   `aria-labelledby` and a whole class surface goes silent for assistive
   tech). These functions centralise that contract so every class surface
   inherits it for free; the class keeps authoring its own inner controls
   and wiring its own behaviour. Byte-compatible with the Rogue reference,
   which is migrated onto them below to prove them and prevent divergence.
   All return HTML strings (composing with this file's `e_({outer})`
   templating) except {@link csCombatSection}, which returns the region
   element the caller appends its body to.
   ======================================================================== */

/** Monotonic counter backing auto-generated, collision-free section title ids. */
let _csCombatSectionSeq = 0;

/**
 * Default StateToggle vocabulary — `ON / OFF / USED` (engaged / available /
 * spent), each encoded by colour + icon + text (never colour alone) so the
 * same concept always reads the same. A class may override any entry (label
 * and/or icon) via the `vocab` argument where a different word carries real
 * game meaning (e.g. `ACTIVE` vs `PASSIVE`, a mode name) — the shell still
 * enforces the `aria-pressed` + colour/icon/text encoding.
 */
const CS_COMBAT_TOGGLE_VOCAB = {
	"on": {label: "ON", icon: "bolt", pressed: "true", cls: "cs-combat-toggle--on"},
	"off": {label: "OFF", icon: "off", pressed: "false", cls: "cs-combat-toggle--off"},
	"used": {label: "USED", icon: "used", pressed: "false", cls: "cs-combat-toggle--used"},
};

/**
 * SectionShell — build a labelled region card with the shared header
 * (themed icon + title + right-aligned primary-action slot). The title
 * carries the `id` that the region's `aria-labelledby` points at, so
 * assistive tech can jump to the section and hear its name.
 * @param {object} opts
 * @param {string} opts.title Visible, accessible section name.
 * @param {string} opts.icon Semantic key from {@link CS_COMBAT_ICONS}.
 * @param {string} [opts.domClass] Extra class(es) on the region (e.g. the
 *        test-/CSS-contract class a surface already relies on).
 * @param {string} [opts.titleId] Override the auto-generated title id.
 * @param {string} [opts.actionsHtml] Primary-action slot markup (e.g. a
 *        {@link csCombatStateToggle}); omitted → no actions container.
 * @returns {HTMLElement} The region element (header inserted; body is the
 *          caller's to append).
 */
function csCombatSection ({title, icon, domClass = "", titleId, actionsHtml = ""} = {}) {
	const id = titleId || `cs-combat-section-title-${++_csCombatSectionSeq}`;
	const section = e_({outer: `<div class="${domClass ? `${domClass} ` : ""}cs-combat-section" role="region" aria-labelledby="${id}"></div>`});
	section.insertAdjacentHTML("beforeend", `
			<div class="cs-combat-section__header">
				<span class="cs-combat-section__icon">${csCombatIcon(icon)}</span>
				<span class="cs-combat-section__title" id="${id}">${title}</span>
				${actionsHtml ? `<div class="cs-combat-section__actions">${actionsHtml}</div>` : ""}
			</div>
		`);
	return section;
}

/**
 * StateToggle — a state chip encoded by colour + icon + text with
 * `aria-pressed`, using the default {@link CS_COMBAT_TOGGLE_VOCAB} unless a
 * class overrides it. Returns markup only; the caller wires the click.
 * @param {object} opts
 * @param {"on"|"off"|"used"} opts.state Current state.
 * @param {string} [opts.labelPrefix] Prefixes the `aria-label` (e.g. the
 *        feature name) so the announcement is self-describing.
 * @param {string} [opts.ariaState] Spoken state for the current state,
 *        overriding the vocabulary label in the `aria-label` (e.g. "armed",
 *        "already used this round").
 * @param {string} [opts.title] Native tooltip.
 * @param {boolean} [opts.disabled]
 * @param {string} [opts.domClass] Extra class(es) (e.g. a behaviour hook).
 * @param {Partial<Record<"on"|"off"|"used", {label?: string, icon?: string}>>} [opts.vocab]
 *        Per-state label/icon overrides.
 * @param {Record<string, string|number>} [opts.attrs] Extra HTML attributes
 *        (e.g. a `data-*` hook the caller's click handler reads).
 * @returns {string}
 */
function csCombatStateToggle ({state, labelPrefix = "", ariaState, title = "", disabled = false, domClass = "", vocab, attrs} = {}) {
	const base = CS_COMBAT_TOGGLE_VOCAB[state] || CS_COMBAT_TOGGLE_VOCAB.off;
	const meta = {...base, ...(vocab?.[state] || {})};
	const spoken = ariaState || meta.label;
	const ariaLabel = labelPrefix ? `${labelPrefix}: ${spoken}` : spoken;
	const attrsHtml = attrs
		? Object.entries(attrs).map(([k, v]) => ` ${k}="${String(v).replace(/"/g, "&quot;")}"`).join("")
		: "";
	return `<button type="button" class="cs-combat-toggle ${meta.cls}${domClass ? ` ${domClass}` : ""}" aria-pressed="${meta.pressed}" aria-label="${ariaLabel}"${title ? ` title="${title}"` : ""}${attrsHtml}${disabled ? " disabled" : ""}>${csCombatIcon(meta.icon)}<span>${meta.label}</span></button>`;
}

/**
 * StatusStrip — the canonical full-border at-a-glance bar (DC / pool / range
 * / save), a `role="group"` with an `aria-label` so it reads as one unit.
 * @param {Array<{label: string, value: string|number, valueWas?: string|number}>} items
 *        `valueWas` renders a struck previous value before the current one
 *        (e.g. a base pool superseded by an effective pool).
 * @param {object} opts
 * @param {string} opts.ariaLabel Group name for assistive tech.
 * @param {string} [opts.domClass]
 * @returns {string}
 */
function csCombatStatusStrip (items, {ariaLabel, domClass = ""} = {}) {
	const itemsHtml = (items || []).map(it => {
		const wasHtml = it.valueWas != null && it.valueWas !== ""
			? `<span class="cs-combat-strip__value-was">${it.valueWas}</span>`
			: "";
		return `
				<div class="cs-combat-strip__item">
					<span class="cs-combat-strip__label">${it.label}</span>
					${wasHtml}<span class="cs-combat-strip__value">${it.value}</span>
				</div>`;
	}).join("");
	return `<div class="cs-combat-strip${domClass ? ` ${domClass}` : ""}" role="group"${ariaLabel ? ` aria-label="${ariaLabel}"` : ""}>${itemsHtml}
			</div>`;
}

/**
 * ConditionPill — a small state pill (met / blocked / none). When `isToggle`
 * is set it renders an interactive `<button>` with `aria-pressed` (the
 * caller wires the click); otherwise a static `<span>`. Icon + text always
 * travel together so state never relies on colour alone.
 * @param {object} opts
 * @param {"met"|"blocked"|"none"} opts.variant
 * @param {string} opts.label
 * @param {string} [opts.icon] Semantic key from {@link CS_COMBAT_ICONS}.
 * @param {string} [opts.title]
 * @param {boolean} [opts.isToggle] Render as an interactive pressed toggle.
 * @param {boolean} [opts.pressed] `aria-pressed` value when `isToggle`.
 * @param {string} [opts.domClass]
 * @returns {string}
 */
function csCombatConditionPill ({variant = "none", label, icon, title = "", isToggle = false, pressed = false, domClass = ""} = {}) {
	const cls = `cs-combat-cond cs-combat-cond--${variant}${isToggle ? " cs-combat-cond--toggle" : ""}${domClass ? ` ${domClass}` : ""}`;
	const iconHtml = icon ? csCombatIcon(icon) : "";
	const titleAttr = title ? ` title="${title}"` : "";
	if (isToggle) return `<button type="button" class="${cls}" aria-pressed="${pressed ? "true" : "false"}"${titleAttr}>${iconHtml}${label}</button>`;
	return `<span class="${cls}"${titleAttr}>${iconHtml}${label}</span>`;
}

/**
 * Focus the first actionable control inside a freshly-opened modal. The
 * shared site modal util blurs the trigger on open but does not move focus
 * into the dialog, so without this a keyboard/AT user lands on `<body>` and
 * must tab from the top of the page to reach the choices. Guarded for
 * node/jsdom (no `focus`). Prefer an explicit selector when the desired
 * initial control isn't the first in DOM order.
 * @param {HTMLElement} modalInner
 * @param {{preferSelector?: string}} [opts]
 * @returns {HTMLElement|null} The focused element, if any.
 */
function csFocusModalOnOpen (modalInner, {preferSelector} = {}) {
	if (!modalInner || typeof modalInner.querySelector !== "function") return null;
	const prefer = preferSelector ? modalInner.querySelector(preferSelector) : null;
	const el = prefer || modalInner.querySelector(`button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])`);
	if (el && typeof el.focus === "function") {
		try { el.focus(); } catch (ignored) { /* jsdom */ }
		return el;
	}
	return null;
}

/**
 * Return focus to a modal's triggering control after it closes — but only if
 * that control is still in the document (a resolve that re-renders the
 * surface may have replaced it, in which case refocusing a detached node is
 * a no-op we skip). Pair with capturing `document.activeElement` *before*
 * opening the modal.
 * @param {Element|null} trigger
 */
function csRestoreModalFocus (trigger) {
	if (trigger && trigger.isConnected && typeof (/** @type {*} */ (trigger).focus) === "function") {
		try { /** @type {*} */ (trigger).focus(); } catch (ignored) { /* jsdom */ }
	}
}

class CharacterSheetCombat {
	/**
	 * Fighter action-economy features that are owned by the dedicated `renderCombatFighter`
	 * panel. They are classified "combat" (so the static PDF lists them and they stay out of
	 * the interactive Active-States panel), but every OTHER interactive combat surface
	 * (the generic "Abilities" list, the Overview Actions list) must exclude them so they
	 * have exactly one interactive home with the correct heal / stamina / Action-Surge logic.
	 */
	static FIGHTER_OWNED_COMBAT_FEATURES = ["second wind", "action surge", "tactical mind", "stamina enthusiast"];

	constructor (page) {
		this._page = page;
		this._state = page.getState();
		this._allItems = [];
		this._cachedAttacks = [];
		this._sneakAttackEnabled = false; // Toggle for including Sneak Attack in damage rolls
		this._lastSneakAttackRoundUsed = null;
		this._lastAttackContext = null;
		this._sneakAttackHasAdjacentAlly = false;
		this._selectedCunningStrikes = []; // Active CS option selections for current attack
		this._weaponRiderEnabled = {}; // riderId -> bool: include this weapon damage rider in next damage roll
		this._lastRiderRoundUsed = {}; // riderId -> combat round: per-rider once-per-turn bookkeeping
		this._turnActionUsage = {action: false, bonus: false, reaction: false};
		this._turnAttackUsage = {hasAttackAction: false, attackActionFeatureIds: new Set()};
		this._handOfHarmUsedThisTurn = false;
		this._relentlessUsedThisTurn = false;
		this._pendingBattleMasterDamage = null;
		this._pendingBattleMasterCheck = null;
		this._pendingBattleMasterAttackAdvantage = false;
		this._attackRollSequence = 0;
		this._battleMasterManeuverRollId = null;
		this._flankingEnabled = false; // Toggle: add +2 to-hit on melee attacks while flanking (RAW optional rule)
		// TRANSIENT per-tactic conditional-attack toggles (e.g. High Ground +2 ranged).
		// Map of tactic name -> bool. Combat-local and never persisted, exactly like
		// `_flankingEnabled`: the situational condition (elevation, position) is only
		// known to the player, so each conditional battle-tactic to-hit bonus is opt-in
		// per combat. Consumed in `_getCombatLocalAttackBonus`, scoped melee/ranged.
		this._battleTacticToggles = {};
		// TRANSIENT channeled-spell rider (Booming/Green-Flame Blade). Lives only on the
		// combat instance — never persisted. Armed by the per-weapon ✨ button AFTER its
		// attack roll, consumed by the next matching weapon damage roll, and discarded by
		// any fresh attack roll or re-render.
		this._pendingSpellRider = null;
		this._channelCantripsCache = null; // per-render cache of known weapon-channel cantrips

		this._init();
	}

	_init () {
		this._initEventListeners();
	}

	setItems (items) {
		this._allItems = items.filter(i => i.weapon);
	}

	_initEventListeners () {
		// Add attack button - support both ID variants
		document.getElementById("charsheet-add-attack")?.addEventListener("click", () => this._showAttackCreator());
		document.getElementById("charsheet-btn-add-attack")?.addEventListener("click", () => this._showAttackCreator());

		// Roll attack (Shift=Advantage, Ctrl=Disadvantage)
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__attack-roll");
			if (!target) return;
			const attackId = target.closest(".charsheet__attack-item")?.dataset.attackId;
			this._rollAttack(attackId, e);
		});

		// Roll attack recklessly (Bug #7): activate the recklessAttack state (if needed)
		// then roll via the normal path. Isolated, append-only delegated handler.
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__attack-reckless");
			if (!target) return;
			const attackId = target.closest(".charsheet__attack-item")?.dataset.attackId;
			this._rollRecklessAttack(attackId, e);
		});

		// Roll damage
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__attack-damage");
			if (!target) return;
			const attackId = target.closest(".charsheet__attack-item")?.dataset.attackId;
			this._rollDamage(attackId);
		});

		// Active ammunition selector (Bug #3) — on a ranged ammunition weapon, the
		// per-attack-row <select> chooses which ammo is loaded: "Regular" (no bonus,
		// no special consumption) or a quiver ammo whose bonuses ride the attack AND
		// damage rolls (consumed on the damage roll). Persist + re-render on change.
		document.addEventListener("change", (/** @type {*} */ e) => {
			const target = e.target.closest?.(".charsheet__attack-ammo-select");
			if (!target) return;
			const attackId = target.closest(".charsheet__attack-item")?.dataset.attackId;
			if (!attackId) return;
			const attack = this._findAttackById(attackId);
			const weaponId = attack?.sourceItem?.id;
			if (!weaponId) return;
			this._state.setSelectedAmmoId?.(weaponId, target.value || null);
			this._page?.saveCharacter?.();
			this.renderAttacks();
			this.renderCombatQuiver?.();
		});

		// Channel a weapon-attack spell (Booming/Green-Flame Blade) into a weapon attack.
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__attack-channel-spell");
			if (!target) return;
			e.preventDefault();
			e.stopPropagation();
			const attackId = target.closest(".charsheet__attack-item")?.dataset.attackId;
			this._onChannelSpellButton(attackId, e);
		});

		// Clear a pending channeled-spell rider from its section.
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__channeled-spell-clear");
			if (!target) return;
			this._clearPendingSpellRider();
		});

		// Edit attack
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__attack-edit");
			if (!target) return;
			const attackId = target.closest(".charsheet__attack-item")?.dataset.attackId;
			this._editAttack(attackId);
		});

		// Remove attack
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__attack-remove");
			if (!target) return;
			const attackId = target.closest(".charsheet__attack-item")?.dataset.attackId;
			this._removeAttack(attackId);
		});

		// (R22 #5) Right-click a weapon attack to apply Guided Strike (+10) to a fresh roll of
		// it. Only intercepts when the character actually has an available Guided Strike use;
		// otherwise the normal browser context menu is left untouched.
		document.addEventListener("contextmenu", (/** @type {*} */ e) => {
			const item = e.target.closest(".charsheet__attack-item");
			if (!item) return;
			if (e.target.closest("a")) return; // keep real link context menus working
			const attackId = item.dataset.attackId;
			if (!attackId) return;
			const gs = this._page?._resolveGuidedStrikeAbility?.();
			if (!gs || !gs.available) return;
			e.preventDefault();
			const menu = ContextUtil.getMenu([
				new ContextUtil.Action(
					"⚔️ Guided Strike (+10)",
					() => this._page?._pUseGuidedStrikeOnAttack?.(attackId),
				),
			]);
			void ContextUtil.pOpenMenu(e, menu);
		});

		// Attack note
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__attack-note");
			if (!target) return;
			const attackId = target.closest(".charsheet__attack-item")?.dataset.attackId;
			const attack = this._state.getAttacks().find(a => a.id === attackId);
			if (!attack) return;
			const renderFn = () => this.renderAttacks();
			this._page.getNotes()?.showNoteModal(
				"attack",
				attackId,
				attack.name,
				renderFn,
			);
		});

		// Initiative roll (Shift=Advantage, Ctrl=Disadvantage)
		document.getElementById("charsheet-roll-initiative")?.addEventListener("click", (/** @type {*} */ e) => this._rollInitiative(e));

		// Quick spell-attack roll from the Combat-tab "Spell Attack" badge
		// (Shift=Advantage, Ctrl=Disadvantage). The badge is a static element whose
		// text/title/class are re-rendered in place, so a single direct listener is safe.
		const elSpellAttack = document.getElementById("charsheet-combat-spell-attack");
		elSpellAttack?.addEventListener("click", (/** @type {*} */ e) => this._rollSpellAttack(e));
		elSpellAttack?.addEventListener("keydown", (/** @type {*} */ e) => {
			if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
			if (e.repeat) return;
			e.preventDefault();
			this._rollSpellAttack(e);
		});

		// Death save buttons
		document.getElementById("charsheet-death-save-success")?.addEventListener("click", () => this._rollDeathSave(true));
		document.getElementById("charsheet-death-save-failure")?.addEventListener("click", () => this._rollDeathSave(false));
		document.getElementById("charsheet-death-save-reset")?.addEventListener("click", () => this._resetDeathSaves());

		// Combat spell casting
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__combat-spell-cast");
			if (!target) return;
			const spellId = target.dataset.spellId;
			this._castCombatSpell(spellId);
		});

		// Combat Methods: use method (spend stamina)
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__method-use");
			if (!target) return;
			const methodId = target.dataset.methodId;
			this._useMethod(methodId);
		});

		// Combat Methods: choose weapon for weapon-modifier methods
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__method-choose-weapon");
			if (!target) return;
			const methodId = target.dataset.methodId;
			this._chooseWeaponForMethod(methodId);
		});

		// Stamina controls
		document.getElementById("charsheet-stamina-add")?.addEventListener("click", () => this._modifyStamina(1));
		document.getElementById("charsheet-stamina-remove")?.addEventListener("click", () => this._modifyStamina(-1));

		// Combat Methods: add/manage methods
		document.getElementById("charsheet-btn-add-method")?.addEventListener("click", () => this._showMethodPicker());

		// Add condition button in combat tab
		document.getElementById("charsheet-combat-add-condition")?.addEventListener("click", () => this._onAddCondition());
	}

	/**
	 * Add a condition from the combat tab
	 */
	async _onAddCondition () {
		// Delegate to main page's add condition method
		await this._page._onAddCondition?.();
		// Sync the combat tab
		this.renderCombatConditions();
		this.renderCombatEffects();
		this.renderCombatDefenses();
	}

	async _castCombatSpell (spellId) {
		// Delegate to the spells module if available
		if (this._page._spells) {
			await this._page._spells._castSpell(spellId);
			this.renderCombatSpells(); // Refresh to update slot display
			this.renderCombatStates(); // Refresh to show concentration
			this.renderCombatEffects(); // Refresh effects
		} else {
			JqueryUtil.doToast({type: "warning", content: "Spells module not available."});
		}
	}

	async _showAttackCreator () {
		await this._pShowAttackModal();
	}

	async _pShowAttackModal (existingAttack = null) {
		const isEdit = !!existingAttack;
		const attack = existingAttack || {
			name: "",
			attackBonus: 0,
			damage: "1d6",
			damageType: "slashing",
			damageBonus: 0,
			range: "",
			properties: [],
			isMelee: true,
			abilityMod: "str",
		};

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `${isEdit ? "⚔️ Edit" : "➕ Add"} Attack`,
			isMinHeight0: true,
		});

		// Add custom modal class
		modalInner.classList.add("charsheet__attack-modal");

		// Build enhanced form with sections
		const content = e_({tag: "div", clazz: "charsheet__attack-form"});
		modalInner.append(content);

		// Main Info Section
		const mainSection = e_({outer: `
			<div class="charsheet__attack-section">
				<div class="charsheet__attack-section-header">
					<span class="charsheet__attack-section-icon">📋</span>
					<span class="charsheet__attack-section-title">Basic Information</span>
				</div>
				<div class="charsheet__attack-field">
					<label class="charsheet__attack-label">Attack Name</label>
					<input type="text" class="charsheet__attack-input charsheet__attack-input--name" value="${attack.name}" placeholder="e.g., Longsword, Eldritch Blast">
				</div>
				<div class="charsheet__attack-field-row">
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Type</label>
						<select class="charsheet__attack-select">
							<option value="melee" ${attack.isMelee ? "selected" : ""}>⚔️ Melee</option>
							<option value="ranged" ${!attack.isMelee ? "selected" : ""}>🏹 Ranged</option>
						</select>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Ability</label>
						<select class="charsheet__attack-select charsheet__attack-select--ability">
							<option value="finesse" ${attack.abilityMod === "finesse" ? "selected" : ""}>Finesse (STR/DEX)</option>
							<option value="spellcasting" ${attack.abilityMod === "spellcasting" ? "selected" : ""}>Spellcasting (INT/WIS/CHA)</option>
							${Parser.ABIL_ABVS.map(a => `<option value="${a}" ${attack.abilityMod === a ? "selected" : ""}>${Parser.attAbvToFull(a)} (${a.toUpperCase()})</option>`).join("")}
						</select>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Range</label>
						<input type="text" class="charsheet__attack-input charsheet__attack-input--range" value="${attack.range || ""}" placeholder="5 ft. or 30/120 ft.">
					</div>
				</div>
			</div>
		`});
		content.append(mainSection);

		// Combat Stats Section
		const combatSection = e_({outer: `
			<div class="charsheet__attack-section">
				<div class="charsheet__attack-section-header">
					<span class="charsheet__attack-section-icon">🎯</span>
					<span class="charsheet__attack-section-title">Combat Statistics</span>
				</div>
				<div class="charsheet__attack-field-row">
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Attack Bonus</label>
						<div class="charsheet__attack-number-input">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--minus" data-field="bonus">−</button>
							<input type="number" class="charsheet__attack-input charsheet__attack-input--bonus" value="${attack.attackBonus}">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--plus" data-field="bonus">+</button>
						</div>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Damage Dice</label>
						<input type="text" class="charsheet__attack-input charsheet__attack-input--damage" value="${attack.damage}" placeholder="1d8, 2d6, etc.">
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Damage Type</label>
						<select class="charsheet__attack-select charsheet__attack-select--dmgtype">
							${["bludgeoning", "piercing", "slashing", "fire", "cold", "lightning", "thunder", "poison", "acid", "necrotic", "radiant", "force", "psychic"].map(t =>
		`<option value="${t}" ${attack.damageType === t ? "selected" : ""}>${this._getDamageTypeEmoji(t)} ${(/** @type {*} */ (t)).toTitleCase()}</option>`,
	).join("")}
						</select>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Damage Bonus</label>
						<div class="charsheet__attack-number-input">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--minus" data-field="dmgbonus">−</button>
							<input type="number" class="charsheet__attack-input charsheet__attack-input--dmgbonus" value="${attack.damageBonus}">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--plus" data-field="dmgbonus">+</button>
						</div>
					</div>
				</div>
			</div>
		`});
		content.append(combatSection);

		// Properties Section
		const hasMonkLevels = (this._state.getClassLevel("Monk") || 0) > 0;
		const propsSection = e_({outer: `
			<div class="charsheet__attack-section">
				<div class="charsheet__attack-section-header">
					<span class="charsheet__attack-section-icon">✨</span>
					<span class="charsheet__attack-section-title">Properties</span>
				</div>
				<div class="charsheet__attack-field">
					<label class="charsheet__attack-label">Weapon Properties</label>
					<input type="text" class="charsheet__attack-input charsheet__attack-input--properties" value="${(attack.properties || []).join(", ")}" placeholder="e.g., versatile, finesse, light, two-handed">
					<div class="charsheet__attack-properties-hint">Common: finesse, light, heavy, reach, thrown, two-handed, versatile</div>
				</div>
				${hasMonkLevels ? `
				<div class="charsheet__attack-field">
					<label class="charsheet__attack-label charsheet__attack-label--checkbox">
						<input type="checkbox" class="charsheet__attack-checkbox--monk-weapon" ${attack.isMonkWeapon ? "checked" : ""}>
						\u{1F94B} Monk Weapon
					</label>
				</div>
				` : ""}
			</div>
		`});
		content.append(propsSection);

		// Quick Add Section
		const inventoryItems = this._state.getItems();
		const inventoryWeapons = inventoryItems.filter(i => i.weapon);

		const quickSection = e_({outer: `
			<div class="charsheet__attack-section charsheet__attack-section--quick">
				<div class="charsheet__attack-section-header">
					<span class="charsheet__attack-section-icon">⚡</span>
					<span class="charsheet__attack-section-title">Quick Select</span>
				</div>
				<div class="charsheet__attack-quick-grid">
					${inventoryWeapons.length ? `
						<div class="charsheet__attack-quick-group">
							<label class="charsheet__attack-label">🎒 From Inventory</label>
							<select class="charsheet__attack-select charsheet__attack-select--inventory">
								<option value="">— Select weapon —</option>
								${inventoryWeapons.map(weapon => {
		const eff = this._state.getEffectiveItemBonuses?.(weapon.id);
		const bonus = eff ? ((eff.bonusWeapon || 0) + (eff.bonusWeaponAttack || 0)) : ((weapon.bonusWeapon || 0) + (weapon.bonusWeaponAttack || 0));
		const label = bonus > 0 ? `${weapon.name} (+${bonus})` : weapon.name;
		return `<option value="inv:${weapon.name}">${label}</option>`;
	}).join("")}
							</select>
						</div>
					` : ""}
					<div class="charsheet__attack-quick-group">
						<label class="charsheet__attack-label">📚 From Catalog</label>
						<select class="charsheet__attack-select charsheet__attack-select--catalog">
							<option value="">— Select from all weapons —</option>
							${this._allItems
		.filter(i => i.weapon)
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(weapon => {
			const bonus = this._parseBonus(weapon.bonusWeapon) + this._parseBonus(weapon.bonusWeaponAttack);
			const label = bonus > 0 ? `${weapon.name} (+${bonus})` : weapon.name;
			return `<option value="${weapon.name}|${weapon.source}">${label}</option>`;
		}).join("")}
						</select>
					</div>
				</div>
			</div>
		`});
		content.append(quickSection);

		// Get form elements
		const nameInput = content.querySelector(".charsheet__attack-input--name");
		const typeSelect = content.querySelector(".charsheet__attack-section:first-child .charsheet__attack-select");
		const abilitySelect = content.querySelector(".charsheet__attack-select--ability");
		const rangeInput = content.querySelector(".charsheet__attack-input--range");
		const bonusInput = content.querySelector(".charsheet__attack-input--bonus");
		const damageInput = content.querySelector(".charsheet__attack-input--damage");
		const damageTypeSelect = content.querySelector(".charsheet__attack-select--dmgtype");
		const dmgBonusInput = content.querySelector(".charsheet__attack-input--dmgbonus");
		const propertiesInput = content.querySelector(".charsheet__attack-input--properties");
		const monkWeaponCheckbox = content.querySelector(".charsheet__attack-checkbox--monk-weapon");
		const inventorySelect = content.querySelector(".charsheet__attack-select--inventory");
		const weaponSelect = content.querySelector(".charsheet__attack-select--catalog");

		// Number input +/- buttons
		content.querySelectorAll(".charsheet__attack-number-btn").forEach(btn => btn.addEventListener("click", () => {
			const field = btn.dataset.field;
			const input = field === "bonus" ? bonusInput : dmgBonusInput;
			const delta = btn.classList.contains("charsheet__attack-number-btn--plus") ? 1 : -1;
			input.value = parseInt(input.value || 0) + delta;
		}));

		// Inventory weapon select handler
		if (inventorySelect) {
			inventorySelect.addEventListener("change", () => {
				if (!inventorySelect.value) return;
				const weaponName = inventorySelect.value.replace("inv:", "");
				const weapon = inventoryWeapons.find(i => i.name === weaponName);
				if (weapon) {
					nameInput.value = weapon.name;
					// Use property (5etools format) or properties (normalized format)
					const props = weapon.property || weapon.properties || [];
					const isRanged = props.some(p => p.includes("A") || p.toLowerCase().includes("ammunition")) || weapon.range;
					typeSelect.value = isRanged ? "ranged" : "melee";
					const hasFinesse = props.some(p => p.includes("F") || p.toLowerCase().includes("finesse"));
					abilitySelect.value = isRanged ? "dex" : (hasFinesse ? "finesse" : "str");
					if (weapon.damage) {
						const dmgMatch = weapon.damage.match(/(\d+d\d+)/);
						if (dmgMatch) damageInput.value = dmgMatch[1];
						const typeMatch = weapon.damage.match(/\d+d\d+\s*(\w+)/);
						if (typeMatch) damageTypeSelect.value = typeMatch[1].toLowerCase();
					}
					if (weapon.range) rangeInput.value = weapon.range;
					if (props.length) propertiesInput.value = props.map(p => typeof p === "string" ? p : Parser.itemPropertyToFull(p)).join(", ");
					const eff = this._state.getEffectiveItemBonuses?.(weapon.id);
					let attackBonusVal;
					let damageBonusVal;
					if (eff) {
						attackBonusVal = (eff.bonusWeapon || 0) + (eff.bonusWeaponAttack || 0);
						damageBonusVal = (eff.bonusWeapon || 0) + (eff.bonusWeaponDamage || 0);
					} else {
						attackBonusVal = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponAttack || 0);
						damageBonusVal = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponDamage || 0);
					}
					bonusInput.value = attackBonusVal;
					dmgBonusInput.value = damageBonusVal;
					weaponSelect.value = "";
					if (monkWeaponCheckbox) monkWeaponCheckbox.checked = !!this._state.isMonkWeapon?.(weapon);
				}
			});
		}

		// Catalog weapon select handler
		weaponSelect.addEventListener("change", () => {
			if (!weaponSelect.value) return;
			const [name, source] = weaponSelect.value.split("|");
			const weapon = this._allItems.find(i => i.name === name && i.source === source);
			if (weapon) {
				nameInput.value = weapon.name;
				const isRanged = weapon.property?.includes("A") || weapon.range;
				typeSelect.value = isRanged ? "ranged" : "melee";
				const hasFinesse = weapon.property?.includes("F");
				abilitySelect.value = isRanged ? "dex" : (hasFinesse ? "finesse" : "str");
				if (weapon.dmg1) damageInput.value = this._state.getWeaponDamageDie(weapon);
				if (weapon.dmgType) damageTypeSelect.value = Parser.dmgTypeToFull(weapon.dmgType).toLowerCase();
				if (weapon.range) rangeInput.value = weapon.range;
				if (weapon.property) propertiesInput.value = weapon.property.map(p => Parser.itemPropertyToFull(p)).join(", ");
				const attackBonusVal = this._parseBonus(weapon.bonusWeapon) + this._parseBonus(weapon.bonusWeaponAttack);
				const damageBonusVal = this._parseBonus(weapon.bonusWeapon) + this._parseBonus(weapon.bonusWeaponDamage);
				bonusInput.value = attackBonusVal;
				dmgBonusInput.value = damageBonusVal;
				if (inventorySelect) inventorySelect.value = "";
				if (monkWeaponCheckbox) monkWeaponCheckbox.checked = !!this._state.isMonkWeapon?.(weapon);
			}
		});

		// Footer buttons
		const footer = e_({outer: `
			<div class="charsheet__attack-footer">
				<button class="charsheet__attack-btn charsheet__attack-btn--cancel">Cancel</button>
				<button class="charsheet__attack-btn charsheet__attack-btn--save">${isEdit ? "💾 Save Changes" : "➕ Add Attack"}</button>
			</div>
		`});
		content.append(footer);

		footer.querySelector(".charsheet__attack-btn--cancel").addEventListener("click", () => doClose(false));
		footer.querySelector(".charsheet__attack-btn--save").addEventListener("click", () => {
			const newAttack = {
				id: existingAttack?.id || CryptUtil.uid(),
				name: nameInput.value.trim(),
				isMelee: typeSelect.value === "melee",
				abilityMod: abilitySelect.value,
				attackBonus: parseInt(bonusInput.value) || 0,
				range: rangeInput.value.trim(),
				damage: damageInput.value.trim(),
				damageType: damageTypeSelect.value,
				damageBonus: parseInt(dmgBonusInput.value) || 0,
				properties: propertiesInput.value.split(",").map(p => p.trim()).filter(Boolean),
				isMonkWeapon: monkWeaponCheckbox?.checked || false,
			};

			if (!newAttack.name) {
				JqueryUtil.doToast({type: "warning", content: "Please enter an attack name."});
				return;
			}

			if (isEdit) {
				this._state.updateAttack(newAttack);
			} else {
				this._state.addAttack(newAttack);
			}

			doClose(true);
			this.renderAttacks();
			this._page.saveCharacter();
		});

		// Focus name field
		setTimeout(() => nameInput.focus(), 100);
	}

	_getDamageTypeEmoji (type) {
		const emojis = {
			bludgeoning: "🔨",
			piercing: "🗡️",
			slashing: "⚔️",
			fire: "🔥",
			cold: "❄️",
			lightning: "⚡",
			thunder: "💥",
			poison: "☠️",
			acid: "🧪",
			necrotic: "💀",
			radiant: "✨",
			force: "💫",
			psychic: "🧠",
		};
		return emojis[type] || "⚔️";
	}

	async _editAttack (attackId) {
		// Check if it's an auto-generated attack from equipped weapon
		if (attackId?.startsWith?.("auto_")) {
			// Extract the weapon ID from the attack ID (format: auto_weaponId)
			const weaponId = attackId.substring(5); // Remove "auto_" prefix
			const weapon = this._state.getItems().find(item => item.id === weaponId);

			if (!weapon) {
				JqueryUtil.doToast({type: "warning", content: "Weapon not found in inventory."});
				return;
			}

			// Open the full attack edit modal for the weapon (same as unarmed strike)
			await this._pShowWeaponAttackModal(weapon);
			return;
		}

		const attacks = this._state.getAttacks();
		const attack = attacks.find(a => a.id === attackId);
		if (!attack) {
			// eslint-disable-next-line no-console
			console.warn("[Combat] Attack not found:", attackId);
			return;
		}

		await this._pShowAttackModal(attack);
	}

	/**
	 * Show a full attack edit modal for a weapon - same fields as unarmed strike / manual attacks
	 * Changes are stored as overrides on the weapon item in inventory
	 */
	async _pShowWeaponAttackModal (weapon) {
		// Build the current attack stats from weapon data + any existing overrides
		// Handle both raw 5etools items (property) and normalized inventory items (properties)
		const props = weapon.property || weapon.properties || [];
		const isRanged = props.some(p => p === "A" || p === "T" || p.startsWith("A|") || p.startsWith("T|")) || weapon.range;
		const hasFinesse = props.some(p => p === "F" || p.startsWith("F|"));

		// Get weapon's base stats with overrides
		const overrides = weapon.attackOverrides || {};
		const magicBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponAttack || 0);
		const magicDmgBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponDamage || 0);

		const rawDamageDie = this._state.getWeaponDamageDie(weapon);
		const rawDamageType = weapon.dmgType
			? Parser.dmgTypeToFull(weapon.dmgType).toLowerCase()
			: (weapon.damageType || (weapon.damage ? weapon.damage.split(" ").slice(1).join(" ").toLowerCase() : null) || "slashing");

		const attack = {
			name: overrides.name ?? weapon.name,
			attackBonus: overrides.attackBonus ?? (weapon.customAttackBonus || 0),
			damage: overrides.damage ?? rawDamageDie,
			damageType: overrides.damageType ?? rawDamageType,
			damageBonus: overrides.damageBonus ?? (weapon.customDamageBonus || 0),
			range: overrides.range ?? (weapon.range || ""),
			properties: overrides.properties ?? (props.map(p => this._formatProperty(p)) || []),
			isMelee: overrides.isMelee ?? !isRanged,
			abilityMod: overrides.abilityMod ?? (isRanged ? "dex" : (hasFinesse ? "finesse" : "str")),
		};

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `⚔️ Edit ${weapon.name}`,
			isMinHeight0: true,
		});

		modalInner.classList.add("charsheet__attack-modal");

		const content = e_({tag: "div", clazz: "charsheet__attack-form"});
		modalInner.append(content);

		// Info about magic item bonuses
		if (magicBonus > 0 || magicDmgBonus > 0) {
			content.append(e_({outer: `
				<div class="ve-small ve-muted mb-2 p-2 rounded" style="background: var(--cs-bg-surface, #1e293b);">
					<strong>Magic Item Bonuses (auto-applied):</strong> 
					${magicBonus > 0 ? `+${magicBonus} to hit` : ""}
					${magicBonus > 0 && magicDmgBonus > 0 ? ", " : ""}
					${magicDmgBonus > 0 ? `+${magicDmgBonus} damage` : ""}
				</div>
			`}));
		}

		// Main Info Section
		const mainSection = e_({outer: `
			<div class="charsheet__attack-section">
				<div class="charsheet__attack-section-header">
					<span class="charsheet__attack-section-icon">📋</span>
					<span class="charsheet__attack-section-title">Basic Information</span>
				</div>
				<div class="charsheet__attack-field">
					<label class="charsheet__attack-label">Attack Name</label>
					<input type="text" class="charsheet__attack-input charsheet__attack-input--name" value="${attack.name}" placeholder="e.g., Longsword">
				</div>
				<div class="charsheet__attack-field-row">
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Type</label>
						<select class="charsheet__attack-select charsheet__attack-select--type">
							<option value="melee" ${attack.isMelee ? "selected" : ""}>⚔️ Melee</option>
							<option value="ranged" ${!attack.isMelee ? "selected" : ""}>🏹 Ranged</option>
						</select>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Ability</label>
						<select class="charsheet__attack-select charsheet__attack-select--ability">
							<option value="finesse" ${attack.abilityMod === "finesse" ? "selected" : ""}>Finesse (STR/DEX)</option>
							<option value="spellcasting" ${attack.abilityMod === "spellcasting" ? "selected" : ""}>Spellcasting (INT/WIS/CHA)</option>
							${Parser.ABIL_ABVS.map(a => `<option value="${a}" ${attack.abilityMod === a ? "selected" : ""}>${Parser.attAbvToFull(a)} (${a.toUpperCase()})</option>`).join("")}
						</select>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Range</label>
						<input type="text" class="charsheet__attack-input charsheet__attack-input--range" value="${attack.range || ""}" placeholder="5 ft. or 30/120 ft.">
					</div>
				</div>
			</div>
		`});
		content.append(mainSection);

		// Combat Stats Section
		const combatSection = e_({outer: `
			<div class="charsheet__attack-section">
				<div class="charsheet__attack-section-header">
					<span class="charsheet__attack-section-icon">🎯</span>
					<span class="charsheet__attack-section-title">Combat Statistics</span>
				</div>
				<div class="charsheet__attack-field-row">
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Attack Bonus</label>
						<div class="charsheet__attack-number-input">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--minus" data-field="bonus">−</button>
							<input type="number" class="charsheet__attack-input charsheet__attack-input--bonus" value="${attack.attackBonus}">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--plus" data-field="bonus">+</button>
						</div>
						<div class="ve-small ve-muted">Custom bonus (${magicBonus > 0 ? `+${magicBonus} magic added auto` : "no magic bonus"})</div>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Damage Dice</label>
						<input type="text" class="charsheet__attack-input charsheet__attack-input--damage" value="${attack.damage}" placeholder="1d8, 2d6, etc.">
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Damage Type</label>
						<select class="charsheet__attack-select charsheet__attack-select--dmgtype">
							${["bludgeoning", "piercing", "slashing", "fire", "cold", "lightning", "thunder", "poison", "acid", "necrotic", "radiant", "force", "psychic"].map(t =>
		`<option value="${t}" ${attack.damageType === t ? "selected" : ""}>${this._getDamageTypeEmoji(t)} ${(/** @type {*} */ (t)).toTitleCase()}</option>`,
	).join("")}
						</select>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Damage Bonus</label>
						<div class="charsheet__attack-number-input">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--minus" data-field="dmgbonus">−</button>
							<input type="number" class="charsheet__attack-input charsheet__attack-input--dmgbonus" value="${attack.damageBonus}">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--plus" data-field="dmgbonus">+</button>
						</div>
						<div class="ve-small ve-muted">Custom bonus (${magicDmgBonus > 0 ? `+${magicDmgBonus} magic added auto` : "no magic bonus"})</div>
					</div>
				</div>
			</div>
		`});
		content.append(combatSection);

		// Properties Section
		const hasMonkLevels2 = (this._state.getClassLevel("Monk") || 0) > 0;
		const propsSection = e_({outer: `
			<div class="charsheet__attack-section">
				<div class="charsheet__attack-section-header">
					<span class="charsheet__attack-section-icon">✨</span>
					<span class="charsheet__attack-section-title">Properties</span>
				</div>
				<div class="charsheet__attack-field">
					<label class="charsheet__attack-label">Weapon Properties</label>
					<input type="text" class="charsheet__attack-input charsheet__attack-input--properties" value="${(attack.properties || []).join(", ")}" placeholder="e.g., versatile, finesse, light, two-handed">
					<div class="charsheet__attack-properties-hint">Common: finesse, light, heavy, reach, thrown, two-handed, versatile</div>
				</div>
				${hasMonkLevels2 ? `
				<div class="charsheet__attack-field">
					<label class="charsheet__attack-label charsheet__attack-label--checkbox">
						<input type="checkbox" class="charsheet__attack-checkbox--monk-weapon" ${this._state.isMonkWeapon?.(weapon) ? "checked" : ""}>
						\u{1F94B} Monk Weapon
					</label>
				</div>
				` : ""}
			</div>
		`});
		content.append(propsSection);

		// Get form elements
		const nameInput = content.querySelector(".charsheet__attack-input--name");
		const typeSelect = content.querySelector(".charsheet__attack-select--type");
		const abilitySelect = content.querySelector(".charsheet__attack-select--ability");
		const rangeInput = content.querySelector(".charsheet__attack-input--range");
		const bonusInput = content.querySelector(".charsheet__attack-input--bonus");
		const damageInput = content.querySelector(".charsheet__attack-input--damage");
		const damageTypeSelect = content.querySelector(".charsheet__attack-select--dmgtype");
		const dmgBonusInput = content.querySelector(".charsheet__attack-input--dmgbonus");
		const propertiesInput = content.querySelector(".charsheet__attack-input--properties");

		// Number input +/- buttons
		content.querySelectorAll(".charsheet__attack-number-btn").forEach(btn => btn.addEventListener("click", () => {
			const field = btn.dataset.field;
			const input = field === "bonus" ? bonusInput : dmgBonusInput;
			const delta = btn.classList.contains("charsheet__attack-number-btn--plus") ? 1 : -1;
			input.value = parseInt(input.value || 0) + delta;
		}));

		// Footer buttons
		const footer = e_({outer: `
			<div class="charsheet__attack-footer">
				<button class="charsheet__attack-btn charsheet__attack-btn--reset" title="Reset to weapon defaults">🔄 Reset</button>
				<button class="charsheet__attack-btn charsheet__attack-btn--cancel">Cancel</button>
				<button class="charsheet__attack-btn charsheet__attack-btn--save">💾 Save Changes</button>
			</div>
		`});
		content.append(footer);

		// Reset button - clear all overrides
		footer.querySelector(".charsheet__attack-btn--reset").addEventListener("click", () => {
			delete weapon.attackOverrides;
			delete weapon.customAttackBonus;
			delete weapon.customDamageBonus;
			// Persist the clear onto the backing inventory item — `weapon` is a shallow
			// copy from getItems(), so deleting here alone would not survive save/reload.
			this._state.updateInventoryItemAttackOverrides?.(weapon.id, {
				attackOverrides: null,
				customAttackBonus: null,
				customDamageBonus: null,
			});
			this.renderAttacks();
			this._page._inventory?.render?.();
			this._page._saveCurrentCharacter?.();
			JqueryUtil.doToast({type: "success", content: `Reset ${weapon.name} to default stats.`});
			doClose(true);
		});

		footer.querySelector(".charsheet__attack-btn--cancel").addEventListener("click", () => doClose(false));
		footer.querySelector(".charsheet__attack-btn--save").addEventListener("click", () => {
			// Save overrides to the weapon item
			weapon.attackOverrides = {
				name: nameInput.value.trim(),
				isMelee: typeSelect.value === "melee",
				abilityMod: abilitySelect.value,
				range: rangeInput.value.trim(),
				damage: damageInput.value.trim(),
				damageType: damageTypeSelect.value,
				properties: propertiesInput.value.split(",").map(p => p.trim()).filter(Boolean),
			};
			// Also update legacy custom bonus fields for backward compatibility
			weapon.customAttackBonus = parseInt(bonusInput.value) || 0;
			weapon.customDamageBonus = parseInt(dmgBonusInput.value) || 0;

			// Persist the overrides onto the backing inventory item. `weapon` is a shallow
			// copy from getItems(), so without this the edits never reach _data.inventory
			// and are lost on save/reload (and unseen by the auto-attack read-sites).
			this._state.updateInventoryItemAttackOverrides?.(weapon.id, {
				attackOverrides: weapon.attackOverrides,
				customAttackBonus: weapon.customAttackBonus,
				customDamageBonus: weapon.customDamageBonus,
			});

			this.renderAttacks();
			this._page._inventory?.render?.();
			this._page._saveCurrentCharacter?.();

			JqueryUtil.doToast({type: "success", content: `Updated ${weapon.name}.`});
			doClose(true);
		});

		// Focus name field
		setTimeout(() => nameInput.focus(), 100);
	}

	/**
	 * Show a modal to edit weapon bonuses (attack bonus, damage bonus)
	 * This is for equipped weapons - we store custom bonuses on the inventory item
	 * @deprecated Use _pShowWeaponAttackModal instead for full editing
	 */
	async _pShowWeaponBonusModal (weapon) {
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `⚔️ Edit ${weapon.name} Bonuses`,
			isMinHeight0: true,
		});

		// Get current custom bonuses (these are player-added bonuses, separate from magic item bonuses)
		const customAttackBonus = weapon.customAttackBonus || 0;
		const customDamageBonus = weapon.customDamageBonus || 0;

		// Show the weapon's base stats and allow editing bonuses
		const magicBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponAttack || 0);
		const magicDmgBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponDamage || 0);

		const content = e_({outer: `
			<div class="charsheet__weapon-bonus-modal">
				<div class="ve-small ve-muted mb-3">
					Edit custom bonuses for this weapon. Magic item bonuses (${magicBonus > 0 ? `+${magicBonus}` : "none"}) are applied automatically.
				</div>
				
				<div class="charsheet__attack-section">
					<div class="charsheet__attack-section-header">
						<span class="charsheet__attack-section-icon">📋</span>
						<span class="charsheet__attack-section-title">Weapon Info</span>
					</div>
					<div class="ve-flex gap-3 mb-2">
						<div><strong>Damage:</strong> ${this._state.getWeaponDamageDie(weapon)} ${weapon.dmgType || ""}</div>
						${weapon.property?.length ? `<div><strong>Properties:</strong> ${weapon.property.map(p => this._formatProperty(p)).join(", ")}</div>` : ""}
					</div>
				</div>

				<div class="charsheet__attack-section">
					<div class="charsheet__attack-section-header">
						<span class="charsheet__attack-section-icon">🎯</span>
						<span class="charsheet__attack-section-title">Custom Bonuses</span>
					</div>
					<div class="charsheet__attack-field-row">
						<div class="charsheet__attack-field">
							<label class="charsheet__attack-label">Attack Bonus</label>
							<div class="charsheet__attack-number-input">
								<button class="charsheet__attack-number-btn charsheet__attack-number-btn--minus" data-field="attack">−</button>
								<input type="number" class="charsheet__attack-input charsheet__weapon-bonus-attack" value="${customAttackBonus}">
								<button class="charsheet__attack-number-btn charsheet__attack-number-btn--plus" data-field="attack">+</button>
							</div>
							<div class="ve-small ve-muted">Added to attack rolls</div>
						</div>
						<div class="charsheet__attack-field">
							<label class="charsheet__attack-label">Damage Bonus</label>
							<div class="charsheet__attack-number-input">
								<button class="charsheet__attack-number-btn charsheet__attack-number-btn--minus" data-field="damage">−</button>
								<input type="number" class="charsheet__attack-input charsheet__weapon-bonus-damage" value="${customDamageBonus}">
								<button class="charsheet__attack-number-btn charsheet__attack-number-btn--plus" data-field="damage">+</button>
							</div>
							<div class="ve-small ve-muted">Added to damage rolls</div>
						</div>
					</div>
				</div>
			</div>
		`});
		modalInner.append(content);

		// Number input buttons
		content.querySelectorAll(".charsheet__attack-number-btn").forEach(btn => btn.addEventListener("click", () => {
			const field = btn.dataset.field;
			const isMinus = btn.classList.contains("charsheet__attack-number-btn--minus");
			const input = field === "attack"
				? content.querySelector(".charsheet__weapon-bonus-attack")
				: content.querySelector(".charsheet__weapon-bonus-damage");
			const current = parseInt(input.value) || 0;
			input.value = current + (isMinus ? -1 : 1);
		}));

		// Buttons
		const buttons = e_({outer: `
			<div class="ve-flex-v-center ve-flex-h-right mt-3 gap-2">
				<button class="ve-btn ve-btn-default">Cancel</button>
				<button class="ve-btn ve-btn-primary">Save</button>
			</div>
		`});
		modalInner.append(buttons);

		buttons.querySelector(".ve-btn-default").addEventListener("click", () => doClose(false));
		buttons.querySelector(".ve-btn-primary").addEventListener("click", () => {
			// Save the custom bonuses to the weapon in inventory
			weapon.customAttackBonus = parseInt(content.querySelector(".charsheet__weapon-bonus-attack").value) || 0;
			weapon.customDamageBonus = parseInt(content.querySelector(".charsheet__weapon-bonus-damage").value) || 0;

			// Re-render attacks and save
			this.renderAttacks();
			this._page._inventory?.render?.();
			this._page._saveCurrentCharacter?.();

			JqueryUtil.doToast({type: "success", content: `Updated bonuses for ${weapon.name}.`});
			doClose(true);
		});
	}

	_removeAttack (attackId) {
		// If the weapon being removed/unequipped is the one a channeled-spell rider is armed
		// for, discard the rider so its "if it hits" indicator can't outlive the weapon.
		if (this._pendingSpellRider?.attackId === attackId) this._clearPendingSpellRider();

		// Check if it's a temporary attack
		const tempAttacks = this._state.getTemporaryAttacks?.() || [];
		const tempAttack = tempAttacks.find(a => a.id === attackId);
		if (tempAttack) {
			this._state.removeTemporaryAttack(attackId);
			this.renderAttacks();
			this._page.saveCharacter();
			JqueryUtil.doToast({type: "success", content: `Dismissed temporary attack: ${tempAttack.name}`});
			return;
		}

		// Check if it's an auto-generated attack from equipped weapon
		if (attackId?.startsWith?.("auto_")) {
			// Extract the weapon ID and unequip it
			const weaponId = attackId.substring(5);
			const invItem = this._state.getInventory().find(item => item.id === weaponId);
			if (invItem) {
				const weaponName = invItem.item?.name || invItem.name || "item";
				this._state.unequip(weaponId);
				this._page._inventory?.render?.();
				this.renderAttacks();
				this._page._saveCurrentCharacter?.();
				JqueryUtil.doToast({type: "success", content: `Unequipped ${weaponName}.`});
			}
			return;
		}

		this._state.removeAttack(attackId);
		this.renderAttacks();
		this._page.saveCharacter();
	}

	/**
	 * Resolve the concrete ability key (str/dex/…) used for an attack's to-hit roll,
	 * so the scoped attack type ("attack:melee:str") reflects reality. A "finesse"
	 * weapon resolves to the better of STR/DEX (mirrors `getWeaponAbilityMod`);
	 * "spellcasting" resolves to the best casting ability. Any explicit ability key or
	 * the melee/ranged default is returned as-is.
	 * @param {*} attack
	 * @param {boolean} isMelee
	 * @returns {string}
	 */
	_resolveAttackAbilityKey (attack, isMelee) {
		const key = attack?.abilityMod || (isMelee ? "str" : "dex");
		const abilityMod = (a) => this._state.getAbilityMod?.(a) ?? 0;
		if (key === "finesse") return abilityMod("str") >= abilityMod("dex") ? "str" : "dex";
		if (key === "finesseWis") return ["str", "dex", "wis"].reduce((best, a) => (abilityMod(a) > abilityMod(best) ? a : best), "str");
		if (key === "spellcasting") {
			return ["int", "wis", "cha"].reduce((best, a) => (abilityMod(a) > abilityMod(best) ? a : best), "int");
		}
		return key;
	}

	_rollAttack (attackId, event, opts = {}) {
		const attacks = this._state.getAttacks();
		let attack = attacks.find(a => a.id === attackId);
		if (!attack && this._cachedAttacks?.length) {
			attack = this._cachedAttacks.find(a => a.id === attackId);
		}
		// Check temporary attacks
		if (!attack) {
			const tempAttacks = this._state.getTemporaryAttacks?.() || [];
			attack = tempAttacks.find(a => a.id === attackId);
		}
		// Check active-state-granted attacks (e.g. Bee Zodiac Form)
		if (!attack) {
			const stateAttacks = this._state.getActiveStateAttacks?.() || [];
			attack = stateAttacks.find(a => a.id === attackId);
		}
		if (!attack) return false;
		if (!this._canRollAttackActionAttack(attack)) {
			JqueryUtil.doToast({type: "warning", content: "No attacks remain in this Attack action."});
			return false;
		}

		// A fresh attack roll discards any pending channeled-spell on-hit rider that has
		// not yet been consumed by a damage roll (Booming/Green-Flame Blade timing: the
		// on-hit damage must ride the SAME attack's damage roll). The ✨ button arms the
		// rider AFTER calling this method, so its own roll is never self-cleared.
		if (this._pendingSpellRider) this._clearPendingSpellRider();

		// Active ammunition (Bug #3). The selected quiver ammo's bonuses ride BOTH
		// the attack and the damage roll, but ammo is consumed ONLY on the damage
		// roll — a to-hit roll never spends a round. "Regular" (no selection) adds
		// nothing here. (The old inline attack-time consume was removed so attacking
		// no longer spends ammo.)
		const selectedAmmo = this._getSelectedAmmoForWeapon(attack.sourceItem?.id);
		const ammoAttackBonus = selectedAmmo ? this._getAmmoAttackBonus(selectedAmmo) : 0;

		// Determine attack type for advantage/disadvantage matching.
		// Honor an explicit ranged flag first (active-state / spell attacks set isRanged:true
		// with a plain "60 ft." range that the heuristic below would otherwise read as melee).
		const {isMelee} = this._getAttackRollKind(attack);
		// Resolve the concrete ability used for the roll so the scoped attack type is
		// accurate. A "finesse" weapon uses the better of STR/DEX (mirrors
		// getWeaponAbilityMod); resolving it here lets STR-scoped states (e.g. Reckless
		// Attack → "attack:melee:str") correctly apply to a STR-used finesse weapon.
		const abilityUsed = this._resolveAttackAbilityKey(attack, isMelee);
		const attackType = `attack:${isMelee ? "melee" : "ranged"}:${abilityUsed}`;

		// Check for advantage/disadvantage from active states and conditions. The
		// hierarchical matcher in hasAdvantageFromStates already resolves a generic
		// "attack" effect from this specific query, so we must NOT also query a bare
		// "attack" — doing so would wrongly bubble a SPECIFIC effect (e.g. Reckless's
		// "attack:melee:str") onto every roll, granting advantage to ranged attacks.
		let stateMode;
		const maneuverAdvantage = !!this._pendingBattleMasterAttackAdvantage;
		const shadowTargetAdvantage = !!this._shadowKnightDarkTarget && !!attack.isManifestShadowWeapon;
		const hasAdvantage = this._state.hasAdvantageFromStates?.(attackType) || maneuverAdvantage || shadowTargetAdvantage;
		const resoluteWeaponDisadvantage = this._state.isStateTypeActive?.("resoluteStance") && !attack.isSpell;
		const hasDisadvantage = this._state.hasDisadvantageFromStates?.(attackType) || resoluteWeaponDisadvantage;
		if (hasAdvantage && !hasDisadvantage) stateMode = "advantage";
		else if (hasDisadvantage && !hasAdvantage) stateMode = "disadvantage";

		// Calculate total attack bonus - resolve weapon ability mod (finesse → max
		// STR/DEX; Bladesong → max(weapon mod, INT) while active)
		const abilityMod = this._state.getWeaponAbilityMod(attack);
		const profBonus = this._state.getProficiencyBonus();

		// Get attack modifiers from named modifiers (features like fighting styles,
		// magic items, etc.). SCOPE-AWARE: ranged-only modifiers (e.g. Archery +2)
		// apply to ranged rolls only, melee-only to melee only, and plain `attack`
		// modifiers to both. Itemized so each source breaks out in the result.
		const attackContributions = this._state.getAttackModifierContributions?.({isMelee}) || [];
		const featureAttackBonus = attackContributions.reduce((sum, c) => sum + (c.value || 0), 0);

		// Get bonus from active states (activated abilities like combat stances)
		const stateAttackBonus = this._state.getBonusFromStates?.("attack", {weaponId: attack.riteWeaponId || attack.id}) || 0;

		// Combat-tab-local contributors (e.g. Flanking) feed the SAME total via a
		// generic pre-roll hook so other positional/tactical modifiers can plug in.
		const localContribution = this._getCombatLocalAttackBonus({isMelee, attack});
		const localAttackBonus = localContribution.bonus || 0;

		// One-shot externally-supplied bonus (e.g. Guided Strike's +10). Generic: any caller
		// can add a labelled flat bonus to a single attack roll without it being a persistent
		// modifier/state. Surfaced in the roll title + breakdown so the player sees it.
		const extraBonus = (opts?.extraBonus && Number.isFinite(opts.extraBonus.value)) ? opts.extraBonus : null;
		const extraBonusValue = extraBonus ? extraBonus.value : 0;

		const totalBonus = abilityMod + profBonus + (attack.attackBonus || 0) + featureAttackBonus + stateAttackBonus + localAttackBonus + extraBonusValue + ammoAttackBonus;

		// Roll d20 with advantage/disadvantage support (state mode can be overridden by shift/ctrl keys)
		const rollResult = this._page.rollD20({event, mode: stateMode});
		this._pendingBattleMasterAttackAdvantage = false;
		const total = rollResult.roll + totalBonus;

		// Check for crit/fumble
		const critRange = this._state.getCriticalRange?.() || 20;
		let resultClass = "";
		let resultNote = "";
		if (rollResult.roll >= critRange) {
			resultClass = "charsheet__dice-result-total--crit";
			resultNote = "Critical Hit!";
			if (!attack.isSpell && this._state.restoreBloodMaledictOnRiteCritical?.(attack.riteWeaponId || attack.id)) {
				this._page._renderResources?.();
				void this._page._saveCurrentCharacter?.();
			}
		} else if (rollResult.roll === 1) {
			resultClass = "charsheet__dice-result-total--fumble";
			resultNote = "Critical Miss!";
		}

		// Build state effect label for display
		const stateEffectLabel = this._getStateEffectLabel(hasAdvantage, hasDisadvantage);
		const localLabel = localContribution.parts?.length
			? ` <span class="ve-muted">(${localContribution.parts.map(p => `${p.label} ${p.value >= 0 ? "+" : ""}${p.value}`).join(", ")})</span>`
			: "";
		const extraBonusLabel = extraBonus
			? ` <span class="ve-muted">(${extraBonus.label} ${extraBonusValue >= 0 ? "+" : ""}${extraBonusValue})</span>`
			: "";
		// Itemize each scoped named attack modifier (e.g. "Archery +2") so the player
		// sees exactly which feature contributed — and, crucially, that ranged-only
		// bonuses appear on ranged rolls but not melee.
		const featureModLabel = attackContributions.length
			? ` <span class="ve-muted">(${attackContributions.map(c => `${c.name} ${c.value >= 0 ? "+" : ""}${c.value}`).join(", ")})</span>`
			: "";
		// Itemize the active ammunition's to-hit bonus explicitly (the user asked for
		// attack bonuses to be broken out) — e.g. "(Healing Arrow +1)".
		const ammoLabel = (selectedAmmo && ammoAttackBonus)
			? ` <span class="ve-muted">(${selectedAmmo.name} ${ammoAttackBonus >= 0 ? "+" : ""}${ammoAttackBonus})</span>`
			: "";

		// Show result
		const modeLabel = this._page.getModeLabel(rollResult.mode);
		void this._page.pAnimateD20?.(rollResult);
		const resultEl = this._page.showDiceResult({
			title: `${attack.name} Attack${modeLabel}${stateEffectLabel}${localLabel}${extraBonusLabel}${featureModLabel}${ammoLabel}`,
			roll: rollResult.roll,
			modifier: totalBonus,
			total,
			resultClass,
			resultNote: resultNote,
			subtitle: this._page.formatD20Breakdown(rollResult, totalBonus),
		});

		// (R26 #8) Non-blocking post-roll Guided Strike offer. FLAG (overlap #9 roll
		// pipeline): single insertion point on the shared `_rollAttack` result path —
		// attaches an "Apply Guided Strike (+10)" affordance to the dice toast above so
		// the player adds +10 to THIS roll after seeing it (never a fresh random roll).
		// `isGuidedStrikeApplication` guards against offering on a roll that already
		// baked in the bonus via `extraBonus`.
		this._page._offerGuidedStrikePostAttack?.({
			resultEl,
			total,
			isGuidedStrikeApplication: extraBonus?.label === "Guided Strike",
		});

		const attackRollId = (this._attackRollSequence || 0) + 1;
		this._attackRollSequence = attackRollId;
		if (this._pendingBattleMasterDamage) {
			if (this._pendingBattleMasterDamage.rollId == null) {
				this._pendingBattleMasterDamage.rollId = attackRollId;
				this._battleMasterManeuverRollId = attackRollId;
			} else if (this._pendingBattleMasterDamage.rollId !== attackRollId) this._pendingBattleMasterDamage = null;
		}
		this._lastAttackContext = {
			attackId,
			rollId: attackRollId,
			mode: rollResult.mode || "normal",
			hasAdvantage,
			hasDisadvantage,
			total,
		};
		this._recordAttackForTurn(attack);
		if (this._state.isStateTypeActive?.("awakenedAstralSelf")) this.renderAttacks();

		// Auto-refresh SA section to show updated advantage status
		this._renderSneakAttackToggle?.();

		// Auto-enable SA when conditions are met after attack
		const sneakAttackInfo = this._state.getFeatureCalculations?.()?.sneakAttack;
		if (sneakAttackInfo && !this._sneakAttackEnabled && this._isSneakAttackAvailableThisTurn()) {
			const triggerMet = (hasAdvantage && !hasDisadvantage) || this._sneakAttackHasAdjacentAlly;
			if (triggerMet && this._isSneakAttackWeaponEligible(attack)) {
				this._sneakAttackEnabled = true;
				this._renderSneakAttackToggle?.();
				JqueryUtil.doToast({type: "success", content: `Sneak Attack auto-enabled (${sneakAttackInfo.dice}). Disable before damage roll if unwanted.`});
			}
		}

		// Consume "next attack only" states (e.g. Steady Aim grants advantage on ONE attack)
		this._consumeOnAttackStates();

		// Generic post-attack extension point. Captured context is passed to each
		// registered hook (Arcane Shot picker, etc.). Hooks are async and
		// fire-and-forget so the synchronous roll/display path above is never blocked.
		const postCtx = {
			attack,
			attackId,
			isMelee,
			isRanged: !isMelee,
			hasAdvantage,
			hasDisadvantage,
			rollResult,
			total,
			totalBonus,
			isCrit: rollResult.roll >= critRange,
			isNat20: rollResult.roll === 20,
			isFumble: rollResult.roll === 1,
		};
		void this._runPostAttackHooks(postCtx).catch(e => {
			// eslint-disable-next-line no-console
			console.error("[CharSheet Combat] post-attack hook error", e);
		});
		return true;
	}

	/**
	 * Roll a weapon attack "recklessly": ensure the persistent `recklessAttack` active
	 * state is on, then roll through the normal `_rollAttack` path so the state's
	 * advantage (scoped to melee-STR attacks) resolves via the standard
	 * advantage/disadvantage pipeline and still cancels with any disadvantage — we
	 * never force raw advantage. The state is left ON (Reckless Attack lasts until the
	 * character's next turn), matching the existing quick-toggle behaviour.
	 * @param {string} attackId
	 * @param {*} event
	 * @returns {boolean}
	 */
	_rollRecklessAttack (attackId, event) {
		// Validate the attack first so we never flip the state on without a roll.
		const attack = this._findAttackById?.(attackId);
		if (!attack) return this._rollAttack(attackId, event);

		// Activate once (idempotent): only when not already reckless, so repeated
		// reckless rolls in the same turn don't spam saves/re-renders.
		if (!this._state.isStateTypeActive?.("recklessAttack")) {
			this._state.activateState?.("recklessAttack");
			// Refresh the state-dependent displays + persist, mirroring the dodge/rage
			// quick-toggle path (Reckless also grants enemies advantage against you).
			this.renderCombatStates?.();
			this.renderCombatEffects?.();
			this.renderCombatDefenses?.();
			this._page?._renderActiveStates?.();
			this._page?._saveCurrentCharacter?.();
			this._updateQuickButtonStates?.();
		}

		return this._rollAttack(attackId, event);
	}

	/**
	 * Determine whether the character has a rollable flat spell-attack bonus for a
	 * `d20 + bonus` quick roll, and what numeric bonus to use. Mirrors the badge
	 * display logic in `renderCombatSpells` so the affordance and the roll agree.
	 *
	 * @returns {{bonus: (number|null), varies: boolean, gambler: boolean}}
	 *   - `bonus`: the flat spell-attack bonus to roll (null when not rollable).
	 *   - `varies`: true for multiclass casters whose classes disagree (no single
	 *     value to roll — caller should roll from the specific spell/attack entry).
	 *   - `gambler`: true when spell attacks use a dice formula (Gambler) rather
	 *     than a flat bonus, so a `d20 + bonus` quick roll does not apply.
	 */
	_getSpellAttackRollInfo () {
		const calcs = this._state.getFeatureCalculations?.();
		if (calcs?.hasGamblerSpellcasting) return {bonus: null, varies: false, gambler: true};

		const breakdown = this._state.getSpellcastingClassBreakdown?.() || [];
		if (breakdown.length) {
			// Gambler cards carry a dice formula rather than a flat bonus — exclude them.
			const numeric = breakdown
				.filter(c => !(c.isRolledPrepared && calcs?.gamblerSpellAttackFormula))
				.map(c => c.attackBonus)
				.filter(v => Number.isFinite(v));
			const distinct = [...new Set(numeric)];
			if (distinct.length === 1) return {bonus: distinct[0], varies: false, gambler: false};
			if (distinct.length > 1) return {bonus: null, varies: true, gambler: false};
			return {bonus: null, varies: false, gambler: true};
		}

		const bonus = this._state.getSpellAttackBonus?.();
		return {bonus: Number.isFinite(bonus) ? bonus : null, varies: false, gambler: false};
	}

	/**
	 * Quick spell-attack roll triggered from the Combat-tab "Spell Attack" badge.
	 * Mirrors `_rollAttack`'s roll path (advantage/disadvantage from active states +
	 * shift/ctrl keys, crit/fumble notes, shared dice animation + toast) but uses the
	 * character's spell attack bonus instead of a weapon's.
	 * @param {*} event - The triggering click/keyboard event (for shift/ctrl modifiers).
	 */
	_rollSpellAttack (event) {
		const info = this._getSpellAttackRollInfo();
		if (info.gambler) {
			JqueryUtil?.doToast?.({type: "info", content: "Spell attacks use a dice formula — roll it from the spell entry."});
			return;
		}
		if (info.varies) {
			JqueryUtil?.doToast?.({type: "info", content: "Spell attack bonus varies by class — roll from the specific spell or attack."});
			return;
		}
		if (info.bonus == null) return;

		// Advantage/disadvantage from active states/conditions. Query ONLY the specific
		// "attack:spell" type: the hierarchical matcher already resolves a genuinely
		// generic "attack" effect (e.g. Bless) from this query, so we must NOT also
		// query a bare "attack" — that would wrongly bubble a SPECIFIC effect (e.g.
		// Reckless Attack's "attack:melee:str") onto spell-attack rolls.
		const hasAdvantage = this._state.hasAdvantageFromStates?.("attack:spell");
		const hasDisadvantage = this._state.hasDisadvantageFromStates?.("attack:spell");
		let stateMode;
		if (hasAdvantage && !hasDisadvantage) stateMode = "advantage";
		else if (hasDisadvantage && !hasAdvantage) stateMode = "disadvantage";

		// Numeric "+N to attacks" bonuses from active states (generic + spell-specific).
		const stateAttackBonus = (this._state.getBonusFromStates?.("attack") || 0)
			+ (this._state.getBonusFromStates?.("attack:spell") || 0);
		const totalBonus = info.bonus + stateAttackBonus;

		// Spell attacks ARE attacks: pass isAttack so the Thelemar Nat1/Nat20 ±5
		// check/save rule does not leak into the breakdown.
		const rollResult = this._page.rollD20({event, mode: stateMode, isAttack: true});
		const total = rollResult.roll + totalBonus;

		// "spell" kind: Champion Improved/Superior Critical never expands the crit
		// range for spell attacks (RAW text is weapon/Unarmed Strike only) — see
		// `getCriticalRange(kind)`.
		const critRange = this._state.getCriticalRange?.("spell") || 20;
		let resultClass = "";
		let resultNote = "";
		if (rollResult.roll >= critRange) {
			resultClass = "charsheet__dice-result-total--crit";
			resultNote = "Critical Hit!";
		} else if (rollResult.roll === 1) {
			resultClass = "charsheet__dice-result-total--fumble";
			resultNote = "Critical Miss!";
		}

		const stateEffectLabel = this._getStateEffectLabel(hasAdvantage, hasDisadvantage);
		const modeLabel = this._page.getModeLabel(rollResult.mode);
		void this._page.pAnimateD20?.(rollResult);
		this._page.showDiceResult({
			title: `Spell Attack${modeLabel}${stateEffectLabel}`,
			roll: rollResult.roll,
			modifier: totalBonus,
			total,
			resultClass,
			resultNote,
			subtitle: this._page.formatD20Breakdown(rollResult, totalBonus),
		});
	}

	/**
	 * Toggle the interactive quick-roll affordance on the Combat-tab spell-attack
	 * badge. Adds button semantics + a roll hint when a flat `d20 + bonus` roll is
	 * available; removes them (and restores plain-badge semantics) otherwise.
	 * @param {HTMLElement|null} el - The `#charsheet-combat-spell-attack` element.
	 */
	_applySpellAttackRollAffordance (el) {
		if (!el) return;
		const info = this._getSpellAttackRollInfo();
		const isRollable = info.bonus != null;
		el.classList.toggle("charsheet__spell-attack--clickable", isRollable);
		if (isRollable) {
			el.setAttribute("role", "button");
			el.setAttribute("tabindex", "0");
			el.style.cursor = "pointer";
			// Preserve any multiclass breakdown title while signalling the roll action.
			const baseTitle = el.title && !el.title.includes("Roll spell attack") ? `${el.title} • ` : "";
			el.title = `${baseTitle}Roll spell attack (Shift = Advantage, Ctrl = Disadvantage)`;
		} else {
			el.classList.remove("charsheet__spell-attack--clickable");
			el.removeAttribute("role");
			el.removeAttribute("tabindex");
			el.style.cursor = "";
		}
	}

	// =========================================================================
	// Generic post-attack hook pipeline (#7). Each hook is {id, predicate, handler}.
	// `predicate(ctx)` is a cheap sync gate; `handler(ctx)` is async (may show a
	// modal, roll damage, spend a resource). Kept feature-agnostic — feature logic
	// lives entirely in the hook handlers, not in `_rollAttack`.
	// =========================================================================

	/**
	 * @returns {Array<{id: string, predicate: (ctx: *) => boolean, handler: (ctx: *) => Promise<void>}>}
	 */
	_getPostAttackHooks () {
		return [
			{
				id: "arcaneShot",
				predicate: (ctx) => ctx.isRanged
					&& this._state.hasArcaneShot?.()
					&& (this._state.getArcaneShotRemaining?.() || 0) > 0
					&& (this._state.getKnownArcaneShots?.()?.length || 0) > 0
					&& this._isArcaneArcherWeapon(ctx.attack),
				handler: (ctx) => this._pPickArcaneShot(ctx),
			},
			{
				// Crit / nat-20 weapon riders (e.g. Rapier of Life Stealing → extra
				// necrotic + temp HP on a natural 20). Generic + data-driven via
				// `getCritWeaponRiders`; the offer is non-blocking and never alters the
				// already-resolved attack roll. Reusable for any crit-triggered weapon
				// effect (append-friendly for future combat-method crit riders).
				id: "critWeaponRider",
				predicate: (ctx) => !ctx.attack?.isSpell
					&& (this._state.getCritWeaponRiders?.(ctx.attack) || [])
						.some(r => (r.trigger === "nat20" ? ctx.isNat20 : ctx.isCrit)),
				handler: (ctx) => this._pOfferCritWeaponRiders(ctx),
			},
			{
				// Illrigger Baleful Interdict: on a weapon-attack hit, once per turn, offer
				// to place a seal (no action). Non-blocking and purely additive — it never
				// alters the attack/damage math. Spell attacks are excluded (weapon only).
				id: "balefulInterdict",
				predicate: (ctx) => !ctx.attack?.isSpell
					&& this._state.hasBalefulInterdict?.()
					&& this._state.canPlaceSealThisTurn?.()
					&& (this._state.getSealsAvailable?.() || 0) > 0,
				handler: (ctx) => this._pPlaceBalefulInterdictSeal(ctx),
			},
			{
				// XPHB Champion Fighter L3 — Remarkable Athlete: immediately after scoring a
				// critical hit with a weapon or Unarmed Strike attack, you may move up to
				// half your Speed without provoking Opportunity Attacks. This hook only ever
				// runs from the weapon-attack roller (`_rollAttack`, which also covers Unarmed
				// Strike attacks), so `!ctx.attack?.isSpell` is a defensive, RAW-faithful
				// guard rather than a functional necessity today. Purely a reminder/toast —
				// the sheet does not track battle-map positioning, so it surfaces the
				// computed half-Speed distance rather than mutating movement state.
				id: "championRemarkableAthleteMove",
				predicate: (ctx) => ctx.isCrit
					&& !ctx.attack?.isSpell
					&& !!this._state.getFeatureCalculations?.().hasRemarkableAthlete,
				handler: (ctx) => this._pShowRemarkableAthleteMoveReminder(ctx),
			},
			{
				id: "shadowKnightTriggers",
				predicate: (ctx) => (!!ctx.attack?.isShadowWeapon || !!ctx.attack?.countsAsShadowWeapon)
					&& !!this._state.getFeatureCalculations?.().hasShadowKnight,
				handler: (ctx) => this._pHandleShadowKnightHit(ctx),
			},
		];
	}

	async _pHandleShadowKnightHit (ctx) {
		if (ctx.isFumble) return;
		const didAttackHaveAdvantage = ctx.rollResult?.mode === "advantage";
		if (!ctx.isCrit) {
			const didHit = await InputUiUtil.pGetUserBoolean({
				title: "Shadow Weapon Attack",
				htmlDescription: "Did this shadow weapon attack hit its target?",
				textYes: "Hit",
				textNo: "Miss",
			});
			if (!didHit) return;
		}

		const shadowcasting = this._state.getShadowcastingResource?.();
		if ((shadowcasting?.current || 0) > 0) {
			const useShadowbite = await InputUiUtil.pGetUserBoolean({
				title: "Shadowbite",
				htmlDescription: `Use Shadowbite on this hit? The target makes a DC ${this._state.getFeatureCalculations().shadowcastingSaveDc} Constitution save${didAttackHaveAdvantage ? " with disadvantage" : ""}. On a failure, roll 1d8 psychic damage and its next attack has disadvantage.`,
				textYes: "Use Shadowbite",
				textNo: "Skip",
			});
			if (useShadowbite) {
				const result = this._state.useShadowbite?.({hadAttackAdvantage: didAttackHaveAdvantage});
				if (result) {
					const damage = this._page.rollDice?.(1, 8) ?? 0;
					JqueryUtil.doToast({
						type: "success",
						content: `Shadowbite: DC ${result.saveDc} CON save${result.saveDisadvantage ? " with disadvantage" : ""}. On failure: ${damage} psychic damage; target's next attack has disadvantage before the end of your next turn.`,
					});
				}
			}
		}

		const shadowSneak = this._state.getShadowSneakResource?.();
		if ((shadowSneak?.current || 0) > 0) {
			const useShadowSneak = await InputUiUtil.pGetUserBoolean({
				title: "Shadow Sneak",
				htmlDescription: "Teleport to an unoccupied space within 5 feet of the target and become invisible until the start of your next turn, or until you attack or cast a spell?",
				textYes: "Use Shadow Sneak",
				textNo: "Skip",
			});
			if (useShadowSneak && this._state.useShadowSneak?.()) {
				JqueryUtil.doToast({type: "success", content: "Shadow Sneak: teleport within 5 feet of the target; you are now Invisible."});
			}
		}
		this._page.saveCharacter?.();
		this._page.renderCharacter?.();
	}

	/**
	 * Remarkable Athlete (XPHB Champion Fighter L3) post-crit affordance: surface a
	 * toast reminding the player they may move up to half their Speed without
	 * provoking Opportunity Attacks. Non-blocking; never mutates movement/speed
	 * state (the sheet does not model battle-map position).
	 * @param {*} ctx
	 */
	async _pShowRemarkableAthleteMoveReminder (ctx) {
		const halfSpeed = Math.floor((this._state.getWalkSpeed?.() || 0) / 2);
		JqueryUtil.doToast({
			type: "success",
			content: `Remarkable Athlete: critical hit with ${ctx.attack?.name || "your attack"}! `
				+ `You may move up to ${halfSpeed} ft. without provoking Opportunity Attacks.`,
		});
	}

	/**
	 * Run all post-attack hooks in order. Hooks whose predicate fails are skipped.
	 * Errors in one hook never abort the others (or the roll).
	 * @param {*} ctx
	 * @returns {Promise<void>}
	 */
	async _runPostAttackHooks (ctx) {
		const hooks = this._getPostAttackHooks();
		for (const hook of hooks) {
			let applies = false;
			try { applies = !!hook.predicate(ctx); } catch (e) { applies = false; }
			if (!applies) continue;
			try {
				// eslint-disable-next-line no-await-in-loop
				await hook.handler(ctx);
			} catch (e) {
				// eslint-disable-next-line no-console
				console.error(`[CharSheet Combat] post-attack hook "${hook.id}" failed`, e);
			}
		}
	}

	/**
	 * Is this attack made with a bow eligible for Arcane Shot? RAW: shortbow or
	 * longbow only (crossbows excluded). Generous on name so homebrew bows qualify,
	 * but explicitly excludes crossbows.
	 * @param {*} attack
	 * @returns {boolean}
	 */
	_isArcaneArcherWeapon (attack) {
		if (!attack || attack.isSpell) return false;
		const name = `${attack.name || ""} ${attack.sourceItem?.name || ""} ${attack.sourceItem?.baseItem || ""}`.toLowerCase();
		if (/crossbow/.test(name)) return false;
		return /\bbow\b/.test(name) || /\b(short|long)bow\b/.test(name);
	}

	/**
	 * Post-roll Arcane Shot picker. Sneak-attack-style list of known shot options
	 * (each hoverable). Selecting one spends a use, rolls any `{@damage}` found in
	 * the option's entries, and shows the result with the save DC. Control-only
	 * options (no damage) still apply — their effect text is shown instead.
	 * @param {*} ctx Post-attack context from `_rollAttack`.
	 * @returns {Promise<void>}
	 */
	async _pPickArcaneShot (ctx) {
		// Re-validate at prompt time (state may have changed between roll and modal).
		if (!this._state.hasArcaneShot?.() || (this._state.getArcaneShotRemaining?.() || 0) <= 0) return;
		const shots = this._state.getKnownArcaneShots?.() || [];
		if (!shots.length) return;

		const calcs = this._state.getFeatureCalculations?.() || {};
		const dc = calcs.arcaneShotSaveDc;
		const ability = (calcs.arcaneShotAbility || "int").toUpperCase();

		let resolveOuter = null;
		let isResolved = false;
		const trigger = (typeof document !== "undefined" && document.activeElement) || null;
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Arcane Shot — ${ctx.attack?.name || "Ranged Attack"}`,
			isMinHeight0: true,
			cbClose: () => { if (resolveOuter && !isResolved) { isResolved = true; resolveOuter(); } csRestoreModalFocus(trigger); },
		});

		await new Promise((resolve) => {
			resolveOuter = resolve;
			const finalize = () => { if (isResolved) return false; isResolved = true; resolve(); return true; };

			const remaining = this._state.getArcaneShotRemaining?.() || 0;
			const rowsHtml = shots.map((shot, i) => {
				const dmg = this._extractArcaneShotDamage(shot);
				const dmgBadge = dmg
					? `<span class="badge badge-danger ml-1" title="Arcane Shot damage">${dmg.dice}${dmg.type ? ` ${dmg.type}` : ""}</span>`
					: `<span class="badge badge-default ml-1" title="No direct damage — effect only">effect</span>`;
				const srcAbbr = shot.source ? Parser.sourceJsonToAbv(shot.source) : "";
				// Hover link for the name (full effect text on hover) — kept OUTSIDE
				// any <button> so the <a> isn't nested in interactive content.
				let nameHtml = shot.name;
				if (this._page?.getHoverLink && shot.source) {
					try { nameHtml = this._page.getHoverLink(UrlUtil.PG_OPT_FEATURES, shot.name, shot.source); } catch (e) { nameHtml = shot.name; }
				}
				return `
					<div class="charsheet__arcaneshot-opt-row ve-flex ve-flex-v-center ve-flex-wrap gap-1">
						<span class="bold">${nameHtml}</span>
						${srcAbbr ? `<span class="ve-muted ve-small">(${srcAbbr})</span>` : ""}
						${dmgBadge}
						<button class="cs-combat-btn cs-combat-btn--primary charsheet__arcaneshot-opt ml-auto" data-idx="${i}" title="Apply this Arcane Shot">${csCombatIcon("target")}<span>Apply</span></button>
					</div>`;
			}).join("");

			modalInner.innerHTML = `
				<div class="charsheet__arcaneshot-pick">
					<p class="ve-small ve-muted charsheet__arcaneshot-pick__lede">
						Choose the Arcane Shot you loosed with this attack. Spends one use
						(${remaining} remaining)${dc != null ? `; targets must make a DC ${dc} ${ability} save where noted` : ""}. Hover a name for its effect.
					</p>
					<div class="charsheet__arcaneshot-pick__opts">${rowsHtml}</div>
					<div class="ve-flex-h-right charsheet__arcaneshot-pick__footer">
						<button class="cs-combat-btn" data-act="none">None / cancel</button>
					</div>
				</div>
			`;

			modalInner.querySelectorAll(".charsheet__arcaneshot-opt").forEach((/** @type {*} */ el) => {
				el.addEventListener("click", () => {
					const idx = Number(el.getAttribute("data-idx"));
					const shot = shots[idx];
					if (!finalize()) return; // guard against rapid double-click double-spend
					doClose();
					this._applyArcaneShot(shot, ctx, {dc, ability});
				});
			});
			modalInner.querySelector(`[data-act="none"]`).addEventListener("click", () => { finalize(); doClose(); });

			// Move keyboard focus onto the first Apply so the picker is operable
			// without a mouse (the site util blurs the trigger but doesn't focus in).
			csFocusModalOnOpen(modalInner, {preferSelector: ".charsheet__arcaneshot-opt"});
		});
	}

	/**
	 * Spend a use and resolve the chosen Arcane Shot: roll its damage (if any) and
	 * surface the result + save DC. Data-driven (parses the option's own `{@damage}`),
	 * so homebrew shots work without per-option code.
	 * @param {*} shot
	 * @param {*} ctx
	 * @param {{dc: number, ability: string}} saveInfo
	 */
	_applyArcaneShot (shot, ctx, saveInfo) {
		if (!shot) return;
		if (!this._state.useArcaneShot?.()) {
			JqueryUtil.doToast({type: "warning", content: "No Arcane Shot uses remaining!"});
			return;
		}

		const dmg = this._extractArcaneShotDamage(shot);
		const dcNote = saveInfo?.dc != null ? ` — DC ${saveInfo.dc} ${saveInfo.ability} save` : "";
		if (dmg) {
			// Roll the actual dice so the animation shows the real dice (not a d20).
			const roll = this._parseDamage(dmg.dice);
			const total = roll.total || 0;
			const animGroups = [];
			this._pushDiceGroup(animGroups, roll);
			void this._page.pAnimateDamageDice?.(animGroups);
			this._page.showDiceResult?.({
				title: `${shot.name}${dcNote}`,
				roll: total,
				modifier: 0,
				total,
				resultNote: dmg.type ? `${dmg.type} damage` : "",
				subtitle: roll.rolls?.length ? `${dmg.dice} → [${roll.rolls.join(", ")}] = ${total}` : dmg.dice,
			});
		} else {
			JqueryUtil.doToast({type: "info", content: `${shot.name} applied${dcNote}.`});
		}

		this._page.saveCharacter?.();
		this.renderCombatResources();
	}

	/**
	 * Apply a single crit / nat-20 weapon rider (e.g. Life Stealing): compute its
	 * extra damage and grant any temporary hit points. Temp HP uses D&D
	 * take-higher semantics (never reduces existing temp HP). Pure mechanic +
	 * display; the offer/confirmation UX lives in `_pOfferCritWeaponRiders`.
	 *
	 * Reusable by other crit-triggered weapon effects (and append-friendly for
	 * future combat-method crit riders). Returns what it applied for testing.
	 * @param {*} attack
	 * @param {*} rider
	 * @returns {{damage: number, damageType: string, tempHpGranted: number}|null}
	 */
	_applyCritWeaponRider (attack, rider) {
		if (!rider) return null;

		// Extra damage: rolled dice or a flat amount.
		let damage = 0;
		let diceLabel = "";
		if (rider.damageDice) {
			const roll = this._parseDamage(rider.damageDice, false);
			damage = roll.total || 0;
			diceLabel = roll.rolls?.length ? `${rider.damageDice} → [${roll.rolls.join(", ")}] = ${damage}` : rider.damageDice;
		} else if (typeof rider.damageAmount === "number") {
			damage = rider.damageAmount;
			diceLabel = `${damage}`;
		}

		// Temporary hit points (take-higher: never reduce existing temp HP). A
		// `tempHp` of "damage" mirrors the necrotic dealt; a number is granted flat.
		let tempHpGranted = 0;
		if (rider.tempHp != null) {
			const want = rider.tempHp === "damage" ? damage : (Number(rider.tempHp) || 0);
			tempHpGranted = Math.max(0, want);
			if (tempHpGranted > 0) {
				const cur = this._state.getTempHp?.() || 0;
				this._state.setTempHp?.(Math.max(cur, tempHpGranted));
			}
		}

		const typeWord = rider.damageType ? ` ${rider.damageType}` : "";
		if (damage > 0) {
			this._page.showDiceResult?.({
				title: `${rider.name} (nat 20)`,
				roll: damage,
				modifier: 0,
				total: damage,
				resultClass: "charsheet__dice-result-total--crit",
				resultNote: `Extra${typeWord} damage${rider.note ? ` — ${rider.note}` : ""}`,
				subtitle: diceLabel,
			});
		}
		if (tempHpGranted > 0) {
			JqueryUtil.doToast({type: "success", content: `${rider.name}: gained ${tempHpGranted} temporary hit points.`});
		}

		this._page.saveCharacter?.();
		this._page.renderCharacter?.();
		return {damage, damageType: rider.damageType, tempHpGranted};
	}

	/**
	 * Non-blocking post-attack offer for crit / nat-20 weapon riders. Modeled on
	 * the Arcane Shot picker: lists each applicable rider with an Apply button so
	 * the player can opt in (a target may be immune — e.g. Constructs/Undead take
	 * no necrotic and grant no Life Stealing temp HP), or dismiss. Fire-and-forget.
	 * @param {*} ctx Post-attack context from `_rollAttack`.
	 * @returns {Promise<void>}
	 */
	async _pOfferCritWeaponRiders (ctx) {
		const riders = (this._state.getCritWeaponRiders?.(ctx.attack) || [])
			.filter(r => (r.trigger === "nat20" ? ctx.isNat20 : ctx.isCrit));
		if (!riders.length) return;

		let resolveOuter = null;
		let isResolved = false;
		const trigger = (typeof document !== "undefined" && document.activeElement) || null;
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Critical Hit Effect — ${ctx.attack?.name || "Weapon"}`,
			isMinHeight0: true,
			cbClose: () => { if (resolveOuter && !isResolved) { isResolved = true; resolveOuter(); } csRestoreModalFocus(trigger); },
		});

		await new Promise((resolve) => {
			resolveOuter = resolve;
			const finalize = () => { if (isResolved) return false; isResolved = true; resolve(); return true; };

			const rowsHtml = riders.map((r, i) => {
				const dmgStr = r.damageDice ? r.damageDice : (typeof r.damageAmount === "number" ? `${r.damageAmount}` : "");
				const dmgBadge = dmgStr
					? `<span class="badge badge-danger ml-1" title="Extra critical damage">+${dmgStr} ${r.damageType || ""}</span>`
					: "";
				const tempBadge = r.tempHp != null
					? `<span class="badge badge-success ml-1" title="Temporary hit points">temp HP</span>`
					: "";
				return `
					<div class="charsheet__critrider-opt-row ve-flex ve-flex-v-center ve-flex-wrap gap-1" style="margin-bottom:6px;">
						<span class="bold">${r.name}</span>
						${dmgBadge}
						${tempBadge}
						${r.note ? `<span class="ve-muted ve-small">${r.note}</span>` : ""}
						<button class="ve-btn ve-btn-xs ve-btn-danger charsheet__critrider-opt ml-auto" data-idx="${i}" title="Apply this critical-hit effect">Apply</button>
					</div>`;
			}).join("");

			modalInner.innerHTML = `
				<div class="charsheet__critrider-pick">
					<p class="ve-small ve-muted charsheet__critrider-pick__lede">
						You rolled a natural 20. Apply the weapon's critical-hit effect if the
						target is a valid target (some creatures are immune).
					</p>
					<div class="charsheet__critrider-pick__opts">${rowsHtml}</div>
					<div class="ve-flex-h-right" style="gap: 8px; margin-top: 12px;">
						<button class="ve-btn ve-btn-default" data-act="none">None / skip</button>
					</div>
				</div>
			`;

			modalInner.querySelectorAll(".charsheet__critrider-opt").forEach((/** @type {*} */ el) => {
				el.addEventListener("click", () => {
					const idx = Number(el.getAttribute("data-idx"));
					const rider = riders[idx];
					if (!finalize()) return; // guard against rapid double-click
					doClose();
					this._applyCritWeaponRider(ctx.attack, rider);
				});
			});
			modalInner.querySelector(`[data-act="none"]`).addEventListener("click", () => { finalize(); doClose(); });

			// Move keyboard focus onto the first Apply so the picker is operable
			// without a mouse (the site util blurs the trigger but doesn't focus in).
			csFocusModalOnOpen(modalInner, {preferSelector: ".charsheet__critrider-opt"});
		});
	}

	/**
	 * Human-readable effect blurb for an ammunition item (magic arrows etc.),
	 * shown in the quiver picker so the player knows what each arrow does.
	 * @param {object} ammo - Flattened ammunition item.
	 * @returns {string} Short effect text, or "" when mundane.
	 */
	_getAmmoEffectText (ammo) {
		if (!ammo) return "";
		const parts = [];
		// `bonusWeapon` is +X to BOTH attack AND damage (e.g. "+1 Arrow"), so it
		// must NOT be mislabeled "to attack" only. `bonusWeaponAttack` is attack-only.
		if (ammo.bonusWeapon) {
			parts.push(`${ammo.bonusWeapon} to attack and damage`);
		} else if (ammo.bonusWeaponAttack) {
			parts.push(`${ammo.bonusWeaponAttack} to attack`);
		}
		if (ammo.bonusWeaponDamage) parts.push(`${ammo.bonusWeaponDamage} damage`);
		// The arrow's COMPLETE description (every entry), tags stripped — not just
		// the first sentence (Bug #2). Mundane ammo has no entries, so this stays
		// empty and the helper reports no effect (keeps "no fake effect" honest).
		const desc = this._getAmmoDescriptionText(ammo);
		if (desc) parts.push(desc);
		return parts.join("; ");
	}

	/**
	 * The to-hit bonus an ammunition item contributes (Bug #3). `bonusWeapon` is
	 * "+X to attack AND damage"; `bonusWeaponAttack` is attack-only. Both are
	 * parsed to an integer; mundane ammo (or damage-only ammo) yields 0.
	 * @param {object} ammo - Flattened ammunition item.
	 * @returns {number}
	 */
	_getAmmoAttackBonus (ammo) {
		if (!ammo) return 0;
		const raw = ammo.bonusWeapon ?? ammo.bonusWeaponAttack;
		const n = parseInt(raw, 10);
		return Number.isFinite(n) ? n : 0;
	}

	/**
	 * The FLAT damage bonus an ammunition item contributes to the weapon's own
	 * damage type (Bug #3): `bonusWeapon` (the +X also applies to damage) plus a
	 * `bonusWeaponDamage` that is a flat number (NOT a dice expression — dice are
	 * handled separately via `_extractAmmoBonusDamage` so they crit-double). Mundane
	 * ammo yields 0.
	 * @param {object} ammo - Flattened ammunition item.
	 * @returns {number}
	 */
	_getAmmoFlatDamageBonus (ammo) {
		if (!ammo) return 0;
		let total = 0;
		const wb = parseInt(ammo.bonusWeapon, 10);
		if (Number.isFinite(wb)) total += wb;
		const raw = ammo.bonusWeaponDamage;
		if (raw != null && !/d\d/i.test(String(raw))) {
			const n = parseInt(raw, 10);
			if (Number.isFinite(n)) total += n;
		}
		return total;
	}

	/**
	 * Resolve the ACTIVE ammunition a weapon is set to fire (Bug #3). Reads the
	 * per-weapon selection and returns the matching flattened quiver ammo object,
	 * validating it is still in the equipped quiver with stock remaining. Returns
	 * null for "Regular" (no selection) or a stale/depleted selection.
	 * @param {string} weaponId - The weapon inventory item ID.
	 * @returns {object|null}
	 */
	_getSelectedAmmoForWeapon (weaponId) {
		if (!weaponId) return null;
		const ammoId = this._state.getSelectedAmmoId?.(weaponId);
		if (!ammoId) return null;
		const ammo = (this._state.getQuiverAmmunitionForWeapon?.(weaponId) || [])
			.find(a => a.id === ammoId);
		if (!ammo) return null;
		const count = this._state.getEffectiveAmmoCount?.(ammo) ?? (ammo.quantity || 0);
		return count > 0 ? ammo : null;
	}

	/**
	 * Full plain-text description of an ammunition item: every string entry
	 * (recursively), `{@tag ...}`-stripped and whitespace-collapsed. Returns ""
	 * when the item carries no descriptive entries (mundane ammo).
	 * @param {object} ammo - Flattened ammunition item.
	 * @returns {string}
	 */
	_getAmmoDescriptionText (ammo) {
		const entries = ammo.entries || ammo.item?.entries;
		if (!Array.isArray(entries) || !entries.length) return "";
		const collect = (e) => {
			if (typeof e === "string") return e;
			if (Array.isArray(e)) return e.map(collect).join(" ");
			if (e && typeof e === "object" && Array.isArray(e.entries)) return e.entries.map(collect).join(" ");
			return "";
		};
		let txt = entries.map(collect).join(" ");
		txt = txt.replace(/\{@[^}]+\}/g, (m) => m.replace(/^\{@\w+\s+/, "").replace(/\|[^}]*/, "").replace(/\}$/, ""));
		return txt.replace(/\s+/g, " ").trim();
	}

	/**
	 * Resolve an attack object by id across the four sources `_rollAttack` /
	 * `_rollDamage` consult (configured, cached, temporary, active-state).
	 * @param {string} attackId
	 * @returns {*} the attack, or undefined.
	 */
	_findAttackById (attackId) {
		const attacks = this._state.getAttacks?.() || [];
		let attack = attacks.find(a => a.id === attackId);
		if (!attack && this._cachedAttacks?.length) attack = this._cachedAttacks.find(a => a.id === attackId);
		if (!attack) attack = (this._state.getTemporaryAttacks?.() || []).find(a => a.id === attackId);
		if (!attack) attack = (this._state.getActiveStateAttacks?.() || []).find(a => a.id === attackId);
		return attack;
	}

	/**
	 * Extract an explicit bonus-damage DICE expression carried by an ammunition
	 * item (e.g. a magic arrow that deals extra dice on a hit). Returns null for
	 * mundane ammo or flat numeric bonuses — we never invent dice the data lacks.
	 * @param {object} ammo - Flattened ammunition item.
	 * @returns {{dice: string, type: string}|null}
	 */
	_extractAmmoBonusDamage (ammo) {
		if (!ammo) return null;
		const raw = ammo.bonusWeaponDamage;
		if (typeof raw === "string" && /\dd\d/i.test(raw)) {
			const m = /([+-]?\d*d\d+(?:[+-]\d+)?)\s*([a-z]+)?/i.exec(raw);
			if (m) return {dice: m[1].replace(/^\+/, ""), type: (m[2] || "").toLowerCase()};
		}
		// CRITICAL (Bug #3): real site ammo carries its extra damage in `entries`
		// TEXT, not `bonusWeaponDamage`. Fall back to parsing an explicit
		// "extra/additional NdM <type> damage" phrase so magic-arrow dice are never
		// "wasted". Still returns null for mundane ammo — we never invent dice.
		return this._extractAmmoEntriesDamage(ammo);
	}

	/**
	 * Parse an explicit extra-damage DICE expression from an ammunition item's
	 * `entries` text — e.g. "deals an extra 1d6 fire damage" / "an additional 2d6
	 * poison damage" / "an extra {@damage 1d4} cold damage". Returns null when no
	 * such phrase is present (so save-or-condition arrows and mundane ammo yield
	 * no dice — we never invent damage the data doesn't state).
	 * @param {object} ammo - Flattened ammunition item.
	 * @returns {{dice: string, type: string}|null}
	 */
	_extractAmmoEntriesDamage (ammo) {
		const entries = ammo.entries || ammo.item?.entries;
		if (!Array.isArray(entries) || !entries.length) return null;
		const collect = (e) => {
			if (typeof e === "string") return e;
			if (Array.isArray(e)) return e.map(collect).join(" ");
			if (e && typeof e === "object" && Array.isArray(e.entries)) return e.entries.map(collect).join(" ");
			return "";
		};
		const text = entries.map(collect).join(" ");
		if (!text) return null;
		// "extra"/"additional" + dice (optionally wrapped in {@damage ...}/{@dice ...})
		// + optional damage-type word + "damage".
		const re = /(?:extra|additional)\s+(?:\{@(?:damage|dice)\s+)?(\d+d\d+(?:\s*[+-]\s*\d+)?)(?:\|[^}]*)?\}?\s*([a-z]+)?\s*damage/i;
		const m = re.exec(text);
		if (!m) return null;
		return {dice: m[1].replace(/\s+/g, ""), type: (m[2] || "").toLowerCase()};
	}

	/**
	 * Render the combat-tab quiver section: shows the equipped quiver and the
	 * ammunition it currently holds, with per-stack counts and effect blurbs.
	 * Hidden entirely when no quiver is equipped.
	 */
	/**
	 * Build the full rich quiver markup (head + per-stack rows with counts and
	 * effect blurbs). Shared by the compact-summary fallback and the full-quiver
	 * modal (`_showQuiverModal`).
	 * @param {object} quiver - The equipped quiver wrapper.
	 * @returns {string} HTML for the full quiver.
	 */
	_buildQuiverFullHtml (quiver) {
		const ammo = this._state.getQuiverAmmunition?.(quiver.id) || [];
		const total = ammo.reduce((sum, a) => sum + (this._state.getEffectiveAmmoCount?.(a) ?? (a.quantity || 0)), 0);

		let nameHtml = quiver.name;
		if (this._page?.getHoverLink && quiver.source) {
			try { nameHtml = this._page.getHoverLink(UrlUtil.PG_ITEMS, quiver.name, quiver.source); } catch (e) { nameHtml = quiver.name; }
		}

		const rowsHtml = ammo.length
			? ammo.map(a => {
				let aName = a.name;
				if (this._page?.getHoverLink && a.source) {
					try { aName = this._page.getHoverLink(UrlUtil.PG_ITEMS, a.name, a.source); } catch (e) { aName = a.name; }
				}
				const count = this._state.getEffectiveAmmoCount?.(a) ?? (a.quantity || 0);

				// Full per-arrow info (Bug #2): effective count, +X attack/damage
				// bonuses (from data fields or parseable extra-damage dice), and the
				// COMPLETE description (every entry), not just the first sentence.
				const bonusBits = [];
				if (a.bonusWeapon || a.bonusWeaponAttack) bonusBits.push(`${a.bonusWeapon || a.bonusWeaponAttack} attack`);
				if (a.bonusWeaponDamage) bonusBits.push(`${a.bonusWeaponDamage} damage`);
				const extra = this._extractAmmoBonusDamage(a);
				if (extra && !a.bonusWeaponDamage) bonusBits.push(`+${extra.dice}${extra.type ? ` ${extra.type}` : ""} damage`);
				const bonusHtml = bonusBits.length
					? `<span class="ve-muted ve-small charsheet__quiver-row-bonus">${bonusBits.join(", ")}</span>`
					: "";
				const descHtml = this._getAmmoFullDescriptionHtml(a);

				return `
					<div class="charsheet__quiver-row charsheet__quiver-row--full">
						<div class="ve-flex ve-flex-v-center ve-flex-wrap gap-1">
							<span class="bold">${aName}</span>
							<span class="badge badge-default" title="Remaining">×${count}</span>
							${bonusHtml}
						</div>
						${descHtml ? `<div class="ve-muted ve-small charsheet__quiver-row-desc">${descHtml}</div>` : ""}
					</div>`;
			}).join("")
			: `<div class="ve-muted ve-small">Quiver is empty. Add ammunition from Inventory.</div>`;

		return `
			<div class="charsheet__quiver">
				<div class="charsheet__quiver-head ve-flex ve-flex-v-center ve-flex-wrap gap-1">
					<span class="bold">${nameHtml}</span>
					<span class="ve-muted ve-small">${total} ${total === 1 ? "round" : "rounds"} total</span>
				</div>
				<div class="charsheet__quiver-list">${rowsHtml}</div>
			</div>
		`;
	}

	/**
	 * Rich HTML for an ammunition item's COMPLETE description (every entry),
	 * rendered through the site Renderer when available, with a tag-stripped
	 * plain-text fallback (so it still works in minimal/test environments).
	 * Returns "" for mundane ammo (no entries).
	 * @param {object} ammo - Flattened ammunition item.
	 * @returns {string}
	 */
	_getAmmoFullDescriptionHtml (ammo) {
		const entries = ammo.entries || ammo.item?.entries;
		if (!Array.isArray(entries) || !entries.length) return "";
		try {
			if (typeof Renderer !== "undefined" && Renderer.get) {
				const html = Renderer.get().render({entries});
				if (html) return html;
			}
		} catch (e) { /* fall through to the plain-text fallback */ }
		const txt = this._getAmmoDescriptionText(ammo);
		return txt ? txt.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
	}

	/**
	 * Render the COMPACT quiver summary at the top of "Weapons & Attacks": the
	 * equipped quiver's name plus its ammunition with counts, on one line. The full
	 * quiver (rich rows + effects) is reachable via the 🏹 Quiver header button
	 * (`_showQuiverModal`). The summary container is emptied and the header button
	 * hidden when no quiver is equipped. (R33 — replaces the old standalone section.)
	 */
	renderCombatQuiver () {
		const container = document.getElementById("charsheet-combat-quiver-summary");
		const openBtn = document.getElementById("charsheet-combat-quiver-open");
		if (!container) return;

		const quiver = this._state.getEquippedQuiver?.();
		if (!quiver) {
			if (openBtn) openBtn.style.display = "none";
			container.innerHTML = "";
			return;
		}
		if (openBtn) {
			openBtn.style.display = "";
			if (!openBtn.dataset.bound) {
				openBtn.dataset.bound = "1";
				openBtn.addEventListener("click", () => { void this._showQuiverModal(); });
			}
		}

		const ammo = this._state.getQuiverAmmunition?.(quiver.id) || [];
		const total = ammo.reduce((sum, a) => sum + (this._state.getEffectiveAmmoCount?.(a) ?? (a.quantity || 0)), 0);

		let nameHtml = quiver.name;
		if (this._page?.getHoverLink && quiver.source) {
			try { nameHtml = this._page.getHoverLink(UrlUtil.PG_ITEMS, quiver.name, quiver.source); } catch (e) { nameHtml = quiver.name; }
		}

		const pillsHtml = ammo.length
			? ammo.map(a => {
				const count = this._state.getEffectiveAmmoCount?.(a) ?? (a.quantity || 0);
				return `<span class="charsheet__quiver-summary-pill" title="${a.name}: ${count} remaining">${a.name} <span class="badge badge-default">×${count}</span></span>`;
			}).join("")
			: `<span class="ve-muted ve-small">empty</span>`;

		container.innerHTML = `
			<div class="charsheet__quiver-summary ve-flex ve-flex-v-center ve-flex-wrap gap-1">
				<span class="charsheet__quiver-summary-icon" title="Equipped quiver">🏹</span>
				<span class="bold">${nameHtml}</span>
				<span class="ve-muted ve-small">${total} ${total === 1 ? "round" : "rounds"}</span>
				<span class="charsheet__quiver-summary-sep">·</span>
				${pillsHtml}
			</div>
		`;
	}

	/**
	 * Open the FULL quiver (rich rows with counts + effect blurbs) in a modal,
	 * launched from the 🏹 Quiver header button in "Weapons & Attacks" (R33).
	 */
	async _showQuiverModal () {
		const quiver = this._state.getEquippedQuiver?.();
		if (!quiver) return;
		const {eleModalInner: modalInner} = await CharacterSheetModal.pGetShow({
			title: `🏹 Quiver — ${quiver.name}`,
			isMinHeight0: true,
		});
		modalInner.innerHTML = this._buildQuiverFullHtml(quiver);
	}

	/**
	 * (R37 #9) Combat-tab consumables quick-use panel. Lists every consumable the
	 * character carries (potions, scrolls, poisons, & similarly-named items —
	 * detected by the inventory module's own `_isConsumable` so the two surfaces
	 * never drift) with a one-click "Use" button that routes through the existing
	 * inventory `_useConsumable` pipeline (roll healing / cast scroll / decrement
	 * quantity / persist). Hidden when the character carries no consumables.
	 */
	renderCombatConsumables () {
		const section = document.getElementById("charsheet-combat-consumables-section");
		const container = document.getElementById("charsheet-combat-consumables");
		if (!container) return;

		const inv = this._page?._inventory;
		const items = (this._state.getItems?.() || []).filter(it => inv?._isConsumable?.(it));

		if (!items.length) {
			if (section) section.style.display = "none";
			container.innerHTML = "";
			return;
		}
		if (section) section.style.display = "";

		container.innerHTML = "";
		const settings = this._state.getSettings?.() || {};
		items.forEach((item) => {
			const qty = item.quantity || 1;
			const emoji = inv?._getItemTypeEmoji?.(item) || "🧪";
			let nameHtml = item.name;
			if (this._page?.getHoverLink && item.source) {
				try { nameHtml = this._page.getHoverLink(UrlUtil.PG_ITEMS, item.name, item.source); } catch (e) { nameHtml = item.name; }
			}
			// (Bug 2) Offer the "Use (Action)" MAX button only when the TGTT item-utilization
			// house rule is on AND the item actually rolls a heal on use — that's the only case
			// where taking the maximum (action) differs from a normal (bonus-action) roll.
			const canMaximize = !!settings.thelemar_itemUtilization && !!this._state.getItemHealingEffect?.(item.id);
			const btnsHtml = canMaximize
				? `<span class="ve-flex ve-flex-wrap gap-1 ml-auto">
						<button class="ve-btn ve-btn-xs ve-btn-primary charsheet__combat-consumable-use" data-maximize="0" title="Use ${item.name} as a bonus action (roll normally)">Use (Bonus Action)</button>
						<button class="ve-btn ve-btn-xs ve-btn-default charsheet__combat-consumable-use" data-maximize="1" title="Use ${item.name} as an action — no roll, take the maximum (TGTT item utilization)">Use (Action)</button>
					</span>`
				: `<button class="ve-btn ve-btn-xs ve-btn-primary ml-auto charsheet__combat-consumable-use" data-maximize="0" title="Use ${item.name}">Use</button>`;
			const row = e_({outer: `
				<div class="charsheet__combat-consumable ve-flex ve-flex-v-center ve-flex-wrap gap-1" data-item-id="${item.id}">
					<span class="charsheet__combat-consumable-icon" title="Consumable">${emoji}</span>
					<span class="bold charsheet__combat-consumable-name">${nameHtml}</span>
					<span class="ve-muted ve-small charsheet__combat-consumable-qty">×${qty}</span>
					${btnsHtml}
				</div>
			`});
			row.querySelectorAll(".charsheet__combat-consumable-use").forEach((useBtn) => {
				useBtn.addEventListener("click", (/** @type {*} */ evt) => {
					evt.stopPropagation();
					const maximize = useBtn.getAttribute("data-maximize") === "1";
					Promise.resolve(inv?._useConsumable?.(item.id, {maximize}))
						.then(() => this.renderCombatConsumables())
						.catch((err) => {
							// eslint-disable-next-line no-console
							console.error("[CharSheet Combat] Error using consumable:", err);
						});
				});
			});
			container.append(row);
		});
	}

	/**
	 * Pull the first `{@damage ...}`/`{@dice ...}` expression from an Arcane Shot
	 * option's entries/description, plus a trailing damage-type word if present.
	 * @param {{entries?: *, description?: string}} shot
	 * @returns {{dice: string, type: string}|null}
	 */
	_extractArcaneShotDamage (shot) {
		const text = this._getArcaneShotRawText(shot);
		if (!text) return null;
		const m = /\{@(?:damage|dice)\s+([^}|]+)(?:\|[^}]*)?\}\s*([a-z]+)?\s*(damage)?/i.exec(text);
		if (!m) return null;
		const dice = m[1].trim();
		// Damage type is the word immediately following the dice when it precedes "damage".
		let type = "";
		if (m[3] && m[2]) type = m[2].toLowerCase();
		return {dice, type};
	}

	/** Raw text (tags intact) for an Arcane Shot option. */
	_getArcaneShotRawText (shot) {
		if (Array.isArray(shot.entries)) {
			const collect = (entry) => {
				if (typeof entry === "string") return entry;
				if (Array.isArray(entry)) return entry.map(collect).join(" ");
				if (entry && typeof entry === "object" && Array.isArray(entry.entries)) return entry.entries.map(collect).join(" ");
				return "";
			};
			const joined = shot.entries.map(collect).join(" ");
			if (joined.trim()) return joined;
		}
		return typeof shot.description === "string" ? shot.description : "";
	}

	/**
	 * Deactivate active states flagged with consumeOnAttack (e.g. Steady Aim).
	 * For Steady Aim: removes advantage after the next attack, but keeps speedZero
	 * until end of turn by removing only the advantage effect rather than deactivating entirely.
	 */
	_consumeOnAttackStates () {
		const activeStates = this._state.getActiveStates?.() || [];
		for (const state of activeStates) {
			if (!state.active) continue;
			const typeDef = CharacterSheetState.ACTIVE_STATE_TYPES[state.stateTypeId];
			if (!typeDef?.consumeOnAttack) continue;

			// Most consume-on-attack states only lose their advantage component (Steady Aim).
			// States whose rules end on any attack (Shadow Sneak invisibility, the
			// Improved Shadowcasting attack permission) deactivate completely.
			const endsOnAttack = typeDef.endConditions?.some(condition => /make an attack|until.*attack/i.test(condition));
			const remaining = (typeDef.effects || []).filter(e => e.type !== "advantage");
			if (!endsOnAttack && remaining.length > 0) {
				// Keep the state active but without advantage
				this._state.updateActiveStateEffects?.(state.stateTypeId, remaining);
			} else {
				this._state.deactivateState(state.stateTypeId);
			}

			// Re-render combat UI to reflect the change
			this.renderCombatActions?.();
			this.renderCombatStates?.();
			this.renderCombatEffects?.();
		}
	}

	/**
	 * Get label showing state effects on roll
	 */
	_getStateEffectLabel (hasAdvantage, hasDisadvantage) {
		if (hasAdvantage && hasDisadvantage) return " (adv+disadv cancel)";
		if (hasAdvantage) return " (from states)";
		if (hasDisadvantage) return " (from states)";
		return "";
	}

	/**
	 * Resolve the standing weapon-UPGRADE damage-dice riders for an attack (#14).
	 * Single source of truth for `_rollDamage`. Per the contract LOCKED with S6, this
	 * reads S6's additive fields DIRECTLY off the weapon being rolled —
	 * `getEffectiveItemBonuses(attack.sourceItem.id).bonusDamageDice/bonusDamageType` —
	 * rather than going through any pre-populated `attack.weaponDamageRiders` field
	 * (S6 declined to populate that) and WITHOUT touching the global, feature-based
	 * `getFeatureCalculations().weaponDamageRiders` loop (which applies to ALL weapons).
	 * Each rider keeps the upgrade's specified damage type (falling back to the weapon's
	 * own type) and is crit-doubled by the caller via `_parseDamage(dice, isCrit)`.
	 * Read defensively so this is an inert no-op until S6 ships the surface.
	 * @returns {Array<{source?: string, dice: string, damageType?: string}>}
	 */
	_getWeaponUpgradeDamageRiders (attack) {
		const itemId = attack?.sourceItem?.id;
		if (!itemId) return [];
		const eff = this._state.getEffectiveItemBonuses?.(itemId);
		if (!eff?.bonusDamageDice) return [];
		return [{
			source: "Weapon Upgrade",
			dice: eff.bonusDamageDice,
			damageType: eff.bonusDamageType || attack.damageType,
		}];
	}

	async _rollDamage (attackId, isCrit = false) {
		const attacks = this._state.getAttacks();
		let attack = attacks.find(a => a.id === attackId);
		if (!attack && this._cachedAttacks?.length) {
			attack = this._cachedAttacks.find(a => a.id === attackId);
		}
		// Check temporary attacks
		if (!attack) {
			const tempAttacks = this._state.getTemporaryAttacks?.() || [];
			attack = tempAttacks.find(a => a.id === attackId);
		}
		// Check active-state-granted attacks (e.g. Bee Zodiac Form)
		if (!attack) {
			const stateAttacks = this._state.getActiveStateAttacks?.() || [];
			attack = stateAttacks.find(a => a.id === attackId);
		}
		if (!attack || !attack.damage) return;

		// Per-component roll objects captured for the dice animation (each carries
		// {sides, rolls:[…]}). Populated as each damage component is rolled below.
		let sneakRollForAnim = null;
		const riderRollsForAnim = [];
		const extraRollsForAnim = [];
		let handOfHarmRollForAnim = null;
		let methodRollForAnim = null;

		// Monk: Hand of Harm — prompt BEFORE rolling damage for unarmed strikes
		// Per-turn limit only applies during active combat; outside combat always allow
		let handOfHarmDamage = 0;
		let handOfHarmFormula = null;
		if (attack.isUnarmedStrike) {
			const harmCalc = this._state.getFeatureCalculations?.() || {};
			const inCombat = this._state.isInCombat?.();
			const harmBlocked = inCombat && this._handOfHarmUsedThisTurn;
			if (harmCalc.hasHandOfHarm && !harmBlocked) {
				const accepted = await this._promptHandOfHarm(harmCalc);
				if (accepted) {
					handOfHarmFormula = harmCalc.handOfHarmDamage;
					const harmRoll = this._parseDamage(handOfHarmFormula);
					handOfHarmDamage = harmRoll.total;
					handOfHarmRollForAnim = harmRoll;
				}
			}
		}

		// Combat method effects (e.g. Wounding Strike) — prompt if weapon has active effect
		let methodEffectApplied = null;
		const activeMethodEffect = (this._state.getActiveCombatMethodEffects?.() || []).find(e => e.weaponId === attack.id);
		if (activeMethodEffect) {
			const accepted = await this._promptApplyMethodEffect(activeMethodEffect);
			if (accepted) {
				methodEffectApplied = activeMethodEffect;
			}
		} else {
			// No active effect yet — check for weapon-modifier methods targeting this weapon
			methodEffectApplied = await this._promptUseCombatMethod(attack);
		}
		const juggernautTarget = await this._pChooseJuggernautTargetContext(attack);

		// Resolve auto-generated weapon damage live so a hands-used change cannot leave a
		// stale cached die. Explicit/custom attack damage remains authoritative.
		const isAutoWeapon = !!attack.sourceItem && (attack.isAutoGenerated || attack.id?.startsWith?.("auto_"));
		const damageExpression = isAutoWeapon && attack.sourceItem?.attackOverrides?.damage == null
			? this._getEffectiveWeaponDamageDie(attack.sourceItem)
			: attack.damage;
		const weaponDamageTypes = this._state.getWeaponDamageTypeChoices?.(attack.riteWeaponId || attack.id, attack.damageType) || [attack.damageType];
		let weaponDamageType = weaponDamageTypes[0];
		if (weaponDamageTypes.length > 1) {
			weaponDamageType = await InputUiUtil.pGetUserEnum({
				title: `${attack.name} — Choose Damage Type`,
				values: weaponDamageTypes,
				fnDisplay: it => it.charAt(0).toUpperCase() + it.slice(1),
				isResolveItem: true,
			});
			if (!weaponDamageType) return;
		}
		let destructiveWrathApplied = false;
		const rollTypedDamage = (formula, damageType, crit = isCrit) => {
			const maximize = !destructiveWrathApplied && this._state.canApplyPendingDamageMaximization?.(damageType);
			const roll = this._parseDamage(formula, crit, {maximize});
			if (maximize && this._state.consumePendingDamageMaximization?.(damageType)) destructiveWrathApplied = true;
			return roll;
		};
		const damageRoll = rollTypedDamage(damageExpression, weaponDamageType);
		const abilityMod = this._state.getWeaponAbilityMod(attack);

		// Doubleshot (#20, S4-owned): a pending one-shot rider that grants +1 weapon
		// damage die on the NEXT ranged WEAPON attack. S4 owns the pending flag, the
		// rider lookup, the parse, AND the one-shot consume helper
		// (`_consumePendingWeaponDamageDie`) — which returns a weapon damage-die STRING
		// (e.g. "1d8") or null/undefined. S5 owns only this fold-in on the damage path
		// (S4 must not edit `_rollDamage`'s body), guaranteeing: (a) ranged-weapon
		// gating, (b) crit-doubling via `isCrit`, (c) the die is added to the weapon's
		// OWN damage-type total (not a separate fixed type). One-shot consumption lives
		// in the helper, so on a miss / no call the die is simply never spent. The `?.`
		// keeps this an inert no-op until S4 ships the helper.
		let doubleshotDamage = 0;
		let doubleshotRoll = null;
		let doubleshotDie = null;
		// Ranged gating MUST use the canonical classifier, not the raw `attack.isRanged`
		// flag: auto-generated (renderAttacks) and modal-built weapon attacks only set
		// `isMelee` (ranged → `isMelee:false`) and never carry an explicit `isRanged`, so
		// `attack.isRanged` is `undefined` for the very weapons Doubleshot targets. Using
		// `_getAttackRollKind` keeps this gate in agreement with the rider resolver
		// (`getDoubleshotRiderForAttack` → `_isMeleeWeaponAttack`); the helper still
		// self-gates (melee/spell/damage-format) and owns the one-shot consume.
		if (this._getAttackRollKind(attack).isRanged && !attack.isSpell) {
			doubleshotDie = this._consumePendingWeaponDamageDie?.(attack);
			if (doubleshotDie) {
				doubleshotRoll = this._parseDamage(doubleshotDie, isCrit);
				doubleshotDamage = doubleshotRoll.total;
			}
		}

		// Get damage modifiers from named modifiers (from features, magic items, etc.)
		const damageModifiers = this._state.getNamedModifiersByType("damage");
		const featureDamageBonus = damageModifiers.reduce((sum, mod) => sum + (mod.value || 0), 0);

		// Weapon-type-scoped item damage bonuses (e.g. Bracers of Archery → +2 with any
		// longbow/shortbow). These apply ONLY to matching weapons, so they can't be a flat
		// `damage` named-modifier (which would buff every attack); resolved per-attack here.
		const itemWeaponDamageContribs = this._state.getItemWeaponScopedDamageContributions?.(attack) || [];
		const itemWeaponDamageBonus = itemWeaponDamageContribs.reduce((sum, c) => sum + (c.value || 0), 0);

		// Get bonus from active states (activated abilities)
		const stateDamageBonus = this._state.getBonusFromStates?.("damage", {weaponId: attack.riteWeaponId || attack.id}) || 0;
		const bloodHunterCalc = this._state.getFeatureCalculations?.() || {};
		const hybridDamageBonus = this._state.isStateTypeActive?.("hybridTransformation") && this._getAttackRollKind(attack).isMelee && !attack.isSpell
			? (bloodHunterCalc.hybridDamageBonus || 0)
			: 0;

		// Check if attack uses strength and if rage is active (for rage damage)
		let rageBonus = 0;
		const isMeleeStrengthAttack = (attack.abilityMod === "str" || !attack.abilityMod)
			&& !attack.isRanged && !attack.isSpell;
		if (this._state.isStateTypeActive?.("rage")) {
			rageBonus = this._state.getRageDamageBonus?.(
				!attack.isRanged && !attack.isSpell, // isMelee
				attack.abilityMod || "str",
			) || 0;
		}

		// Check for Sneak Attack
		let sneakAttackDamage = 0;
		let sneakAttackDice = "";
		let cunningStrikeEffects = [];
		const sneakAttackInfo = this._state.getFeatureCalculations?.()?.sneakAttack;
		if (this._canApplySneakAttack(attack, sneakAttackInfo)) {
			// Subtract Cunning Strike dice cost from SA dice
			const baseSneakDice = parseInt(sneakAttackInfo.dice) || 0;
			const csDiceCost = this._selectedCunningStrikes.reduce((sum, cs) => sum + cs.cost, 0);
			const effectiveDice = Math.max(0, baseSneakDice - csDiceCost);

			if (effectiveDice > 0) {
				const effectiveDiceStr = `${effectiveDice}d6`;
				const sneakRoll = this._parseDamage(effectiveDiceStr, isCrit);
				sneakAttackDamage = sneakRoll.total;
				sneakAttackDice = effectiveDiceStr;
				sneakRollForAnim = sneakRoll;
			}

			// Record CS effects for display
			if (this._selectedCunningStrikes.length) {
				const saveDC = 8 + this._state.getProficiencyBonus() + this._state.getAbilityMod("dex");
				cunningStrikeEffects = this._selectedCunningStrikes.map(cs => ({
					name: cs.name,
					cost: cs.cost,
					save: cs.save,
					saveDC,
					desc: cs.desc,
				}));
			}

			this._markSneakAttackUsedThisTurn();
		}

		// Weapon damage riders (Colossus Slayer, Focused Quarry, …) — generic per-rider
		// manual toggles, each once per turn, gated by the active Hunter's Prey option /
		// Primal Focus mode via getFeatureCalculations().weaponDamageRiders. Never
		// auto-applied: the trigger conditions ("target below max HP", "is your Quarry")
		// aren't knowable from attack data, so the player opts in per rider.
		let riderDamageTotal = 0;
		const riderParts = [];
		const usedRiderIds = [];
		// Active ammunition (Bug #3): resolved once so its flat bonus folds into the
		// weapon-typed total and its dice ride the riderParts pipeline. Null = Regular.
		const ammoForDamage = !attack.isSpell ? this._getSelectedAmmoForWeapon(attack.sourceItem?.id) : null;
		const weaponDamageTypeForAmmo = weaponDamageType;
		let ammoFlatDamageBonus = 0;
		if (!attack.isSpell) {
			const weaponRiders = this._state.getFeatureCalculations?.()?.weaponDamageRiders || [];
			for (const rider of weaponRiders) {
				if (!this._weaponRiderEnabled[rider.id]) continue;
				if (!this._isWeaponDamageRiderEligible(rider, attack)) continue;
				// Most riders are once-per-turn; some (e.g. Terrorizing Force) apply on EVERY
				// hit (rider.perTurn === false) and are never marked used.
				const oncePerTurn = rider.perTurn !== false;
				if (oncePerTurn && !this._isRiderAvailableThisTurn(rider.id)) continue;
				const riderRoll = rollTypedDamage(rider.dice, rider.damageType || weaponDamageType);
				riderDamageTotal += riderRoll.total;
				riderParts.push({name: rider.name, dice: rider.dice, total: riderRoll.total, type: rider.damageType});
				riderRollsForAnim.push(riderRoll);
				usedRiderIds.push(rider.id);
				if (oncePerTurn) this._markRiderUsedThisTurn(rider.id);
			}

			if (juggernautTarget === "construct") {
				const constructDice = this._state.getFeatureCalculations?.().demolishingMightConstructDamage;
				if (constructDice) {
					const constructRoll = rollTypedDamage(constructDice, weaponDamageType);
					riderDamageTotal += constructRoll.total;
					riderParts.push({name: "Demolishing Might", dice: constructDice, total: constructRoll.total, type: weaponDamageType});
					riderRollsForAnim.push(constructRoll);
				}
			}

			// Standing weapon-UPGRADE damage-dice riders (#14): e.g. a Saw-toothed weapon
			// deals +1d4 slashing on a hit. Unlike the feature riders above, these are
			// AUTO-applied on EVERY hit — no manual toggle, no once-per-turn gate — because
			// the upgrade is permanent and unconditional, so they are NOT added to
			// `usedRiderIds` (never disabled) and skip `_weaponRiderEnabled`. They ride the
			// SAME riderParts pipeline below, so they are crit-doubled (via `isCrit`) and
			// reported under their OWN damage type. The rider list is resolved through
			// `_getWeaponUpgradeDamageRiders`, which reads S6's `getEffectiveItemBonuses`
			// fields DIRECTLY off this attack's `sourceItem` (the locked #14 path).
			for (const rider of this._getWeaponUpgradeDamageRiders(attack)) {
				if (!rider?.dice) continue;
				const riderRoll = this._parseDamage(rider.dice, isCrit);
				riderDamageTotal += riderRoll.total;
				riderParts.push({name: rider.source || "Weapon Upgrade", dice: rider.dice, total: riderRoll.total, type: rider.damageType});
				riderRollsForAnim.push(riderRoll);
			}

			// Active ammunition damage (Bug #3): the selected quiver ammo's bonuses
			// ride this weapon's damage. Any DICE it carries (bonusWeaponDamage dice
			// or an "extra NdM <type> damage" phrase in its entries text) join the
			// SAME riderParts pipeline so they crit-double (via `isCrit`) and report
			// under their own type; its FLAT bonus (bonusWeapon's +X, or a flat
			// bonusWeaponDamage) folds into the weapon's own damage type below. The
			// round is consumed on this damage roll (after the result), never here.
			if (ammoForDamage) {
				ammoFlatDamageBonus = this._getAmmoFlatDamageBonus(ammoForDamage);
				const ammoDice = this._extractAmmoBonusDamage(ammoForDamage);
				if (ammoDice?.dice) {
					const ammoRoll = this._parseDamage(ammoDice.dice, isCrit);
					riderDamageTotal += ammoRoll.total;
					riderParts.push({name: ammoForDamage.name, dice: ammoDice.dice, total: ammoRoll.total, type: ammoDice.type || weaponDamageTypeForAmmo});
					riderRollsForAnim.push(ammoRoll);
				}
			}
		}

		// Magic item crit damage bonus (e.g., bonusWeaponCritDamage on the weapon)
		let critDamageBonus = 0;
		if (isCrit && attack.sourceItem?.bonusWeaponCritDamage) {
			critDamageBonus = attack.sourceItem.bonusWeaponCritDamage;
		}

		// Spell damage bonus from magic items (e.g., Wand of the War Mage, Rod of the Pact Keeper)
		let spellDamageBonus = 0;
		if (attack.isSpell) {
			spellDamageBonus = this._state.getItemBonus?.("spellDamage") || 0;
		}

		const totalBonus = abilityMod + (attack.damageBonus || 0) + featureDamageBonus + itemWeaponDamageBonus + rageBonus + stateDamageBonus + hybridDamageBonus + critDamageBonus + spellDamageBonus + ammoFlatDamageBonus;

		// Get extra damage dice from active states (e.g., Hex, Flame Tongue)
		const extraDamageEntries = (this._state.getExtraDamageFromStates?.() || [])
			.filter(entry => !entry.weaponId || entry.weaponId === (attack.riteWeaponId || attack.id))
			.filter(entry => !attack.isSpell || !entry.isCrimsonRite);
		let extraDamageTotal = 0;
		const extraDamageParts = [];
		for (const entry of extraDamageEntries) {
			let extraRoll = this._parseDamage(entry.dice, isCrit);
			if (entry.isCrimsonRite && this._state.canUseSanguineMasteryReroll?.()) {
				const reroll = this._parseDamage(entry.dice, isCrit);
				if (reroll.total > extraRoll.total) extraRoll = reroll;
				this._state.markSanguineMasteryRerollUsed?.();
			}
			extraDamageTotal += extraRoll.total;
			extraDamageParts.push({dice: entry.dice, total: extraRoll.total, type: entry.damageType, source: entry.source});
			extraRollsForAnim.push(extraRoll);
		}

		// Roll ongoing damage from combat method effect (e.g. Wounding Strike 1d4)
		let methodEffectDamage = 0;
		let methodEffectFormula = null;
		if (methodEffectApplied?.ongoingDamage) {
			methodEffectFormula = methodEffectApplied.ongoingDamage;
			const methodRoll = this._parseDamage(methodEffectFormula);
			methodEffectDamage = methodRoll.total;
			methodRollForAnim = methodRoll;
		}

		// Channeled-spell on-hit rider (Booming/Green-Flame Blade). Armed by the per-weapon
		// ✨ button AFTER its attack roll; consumed by the FIRST matching weapon damage roll.
		// Added as a SEPARATE damage type (its own crit handling + display), like Hand of Harm.
		const {
			channelSpell,
			channelSpellRoll,
			channelSpellDamage,
			riderMatched,
			maximized: channelSpellMaximized,
			triggeredEffects: channelSpellTriggeredEffects = [],
		} = this._resolveChannelRiderDamage(attack, attackId, isCrit);

		// Weapon damage riders carry their own damage type (e.g. Hellish Avenger → fire,
		// Terrorizing Force → a chosen element). Riders whose type differs from the weapon's
		// must be reported under THEIR type, not folded into the weapon-typed total (bugs
		// #10/#12: Terrorizing Force / Hellish Avenger printed the weapon's type). Riders with
		// no type (Colossus Slayer, Focused Quarry, …) share the weapon's type as before.
		let riderSameTypeTotal = 0;
		const riderTypedParts = [];
		for (const rp of riderParts) {
			if (!rp.type || rp.type === weaponDamageType) riderSameTypeTotal += rp.total;
			else riderTypedParts.push(rp);
		}
		const riderDiffTypeTotal = riderDamageTotal - riderSameTypeTotal;

		const {damage: battleMasterDamage, name: battleMasterName} = this._consumeBattleMasterDamage(attackId, isCrit);
		const baseDamageTotal = damageRoll.total + totalBonus + sneakAttackDamage + extraDamageTotal + riderSameTypeTotal + doubleshotDamage + battleMasterDamage;
		const totalBeforeTargetMultiplier = baseDamageTotal + riderDiffTypeTotal + handOfHarmDamage + methodEffectDamage + channelSpellDamage;
		const targetMultiplier = ["object", "structure"].includes(juggernautTarget)
			? (this._state.getFeatureCalculations?.().demolishingMightObjectMultiplier || 1)
			: 1;
		const total = totalBeforeTargetMultiplier * targetMultiplier;
		const juggernautOutcome = await this._pResolveJuggernautHitEffects(attack);

		// Build subtitle with breakdown
		let subtitle = `${damageExpression}${isCrit ? " (crit)" : ""} + ${abilityMod} (${attack.abilityMod || "STR"})`;
		if (attack.damageBonus) subtitle += ` + ${attack.damageBonus} (weapon)`;
		if (featureDamageBonus) subtitle += ` + ${featureDamageBonus} (features)`;
		for (const c of itemWeaponDamageContribs) subtitle += ` + ${c.value} (${c.name})`;
		if (rageBonus) subtitle += ` + ${rageBonus} (rage)`;
		if (stateDamageBonus) subtitle += ` + ${stateDamageBonus} (states)`;
		if (critDamageBonus) subtitle += ` + ${critDamageBonus} (crit bonus)`;
		if (spellDamageBonus) subtitle += ` + ${spellDamageBonus} (spell item)`;
		if (ammoFlatDamageBonus) subtitle += ` + ${ammoFlatDamageBonus} (${ammoForDamage?.name || "ammunition"})`;
		if (sneakAttackDamage) subtitle += ` + ${sneakAttackDamage} (sneak attack ${sneakAttackDice})`;
		for (const rp of riderParts) {
			subtitle += ` + ${rp.total} (${rp.name} ${rp.dice}${rp.type ? ` ${rp.type}` : ""})`;
		}
		for (const ep of extraDamageParts) {
			subtitle += ` + ${ep.total} (${ep.source}${ep.type ? ` ${ep.type}` : ""})`;
		}
		// Doubleshot rides under the weapon's own damage type, so it is itemized BEFORE
		// the trailing weapon-type word below.
		if (doubleshotDamage) subtitle += ` + ${doubleshotDamage} (Doubleshot 2nd arrow ${doubleshotDie})`;
		if (battleMasterDamage) subtitle += ` + ${battleMasterDamage} (${battleMasterName})`;
		subtitle += ` ${weaponDamageType}`;
		if (handOfHarmDamage) subtitle += ` | <strong style="color:#9b59b6">+${handOfHarmDamage} necrotic</strong> (Hand of Harm ${handOfHarmFormula})`;
		if (methodEffectDamage) subtitle += ` | <strong style="color:#c44">+${methodEffectDamage} ongoing</strong> (${methodEffectApplied.name} ${methodEffectFormula}${methodEffectApplied.ongoingSaveType ? `, ${methodEffectApplied.ongoingSaveType.charAt(0).toUpperCase() + methodEffectApplied.ongoingSaveType.slice(1)} DC ${methodEffectApplied.saveDc} to end` : ""})`;
		if (channelSpellDamage) subtitle += ` | <strong style="color:#e056fd">+${channelSpellDamage} ${channelSpell.damageType}</strong> (${channelSpell.spellName} on hit ${channelSpell.dice})`;
		if (channelSpellMaximized) subtitle += " | <strong>Destructive Wrath: maximized</strong>";
		if (destructiveWrathApplied) subtitle += " | <strong>Destructive Wrath: maximized</strong>";
		if (targetMultiplier > 1) subtitle += ` | <strong>Demolishing Might: ×${targetMultiplier} vs ${juggernautTarget}</strong>`;
		if (juggernautOutcome) subtitle += ` | ${juggernautOutcome}`;
		const triggeredDamageTypes = new Set([weaponDamageType, ...riderParts.map(it => it.type), channelSpell?.damageType].filter(Boolean));
		const triggeredEffects = [...triggeredDamageTypes].flatMap(type => this._state.getTriggeredDamageEffects?.(type) || []);
		triggeredEffects.push(...channelSpellTriggeredEffects);
		const thunderboltStrike = triggeredEffects.find(it => it.type === "forcedMovement");
		if (thunderboltStrike) subtitle += ` | Thunderbolt Strike: may push a ${thunderboltStrike.maxTargetSize} or smaller target up to ${thunderboltStrike.distance} ft ${thunderboltStrike.direction}`;

		// Append Cunning Strike effects to subtitle
		if (cunningStrikeEffects.length) {
			const csDesc = cunningStrikeEffects.map(cs => {
				if (cs.save) return `${cs.name} (DC ${cs.saveDC} ${cs.save.toUpperCase()})`;
				return cs.name;
			}).join(", ");
			subtitle += ` | Cunning Strike: ${csDesc}`;
		}

		// Show result — separate damage types in title when multi-type damage is present
		const typedExtras = [];
		// Differently-typed weapon riders (e.g. Terrorizing Force psychic, Hellish Avenger fire)
		// surface under their own type so the title reflects the real damage breakdown.
		for (const rp of riderTypedParts) typedExtras.push(`${rp.total} ${rp.type}`);
		if (handOfHarmDamage) typedExtras.push(`${handOfHarmDamage} necrotic`);
		if (methodEffectDamage) typedExtras.push(`${methodEffectDamage} ongoing`);
		if (channelSpellDamage) typedExtras.push(`${channelSpellDamage} ${channelSpell.damageType}`);
		let totalTitle;
		if (typedExtras.length) {
			totalTitle = `${baseDamageTotal} ${weaponDamageType} + ${typedExtras.join(" + ")} = ${totalBeforeTargetMultiplier}`;
		}
		if (targetMultiplier > 1) totalTitle = `${totalTitle || totalBeforeTargetMultiplier} × ${targetMultiplier} = ${total}`;
		// Collect the actual dice rolled (count + type + per-die values) so the
		// animation reflects the real roll (e.g. 1d8 + 2d6 sneak) rather than a
		// single hard-coded d20. Each damage component contributes a group.
		const diceGroups = [];
		this._pushDiceGroup(diceGroups, damageRoll);
		this._pushDiceGroup(diceGroups, doubleshotRoll);
		this._pushDiceGroup(diceGroups, sneakRollForAnim);
		for (const rr of riderRollsForAnim) this._pushDiceGroup(diceGroups, rr);
		for (const er of extraRollsForAnim) this._pushDiceGroup(diceGroups, er);
		this._pushDiceGroup(diceGroups, handOfHarmRollForAnim);
		this._pushDiceGroup(diceGroups, methodRollForAnim);
		this._pushDiceGroup(diceGroups, channelSpellRoll);
		await this._page.pAnimateDamageDice?.(diceGroups);

		this._page.showDiceResult({
			title: `${attack.name} Damage`,
			roll: damageRoll.total + sneakAttackDamage + riderDamageTotal + doubleshotDamage,
			modifier: totalBonus,
			total: totalTitle || total,
			subtitle,
		});

		// Auto-disable sneak attack after use (once per turn)
		if (sneakAttackDamage > 0 || cunningStrikeEffects.length) {
			this._sneakAttackEnabled = false;
			this._sneakAttackHasAdjacentAlly = false;
			this._resetCunningStrikeSelections();
			this._renderSneakAttackToggle?.();
		}

		// Auto-disable used weapon damage riders after the roll (once-per-turn riders only;
		// every-hit riders like Terrorizing Force stay enabled so they keep applying).
		if (usedRiderIds.length) {
			const ridersById = Object.fromEntries((this._state.getFeatureCalculations?.()?.weaponDamageRiders || []).map(r => [r.id, r]));
			let changed = false;
			usedRiderIds.forEach(id => {
				if (ridersById[id]?.perTurn === false) return;
				this._weaponRiderEnabled[id] = false;
				changed = true;
			});
			if (changed) this._renderWeaponDamageRiders?.();
		}

		// Consume the channeled-spell on-hit rider — it rides exactly ONE damage roll for its
		// weapon. Clear whenever it matched this attack, even below level 5 (no on-hit dice yet).
		if (riderMatched) this._clearPendingSpellRider();

		// Active ammunition (Bug #3): a selected quiver ammo is consumed EXACTLY ONCE
		// here — on the damage roll, never on the attack roll. If that empties the
		// stack, revert the weapon's selection to "Regular" so a depleted ammo isn't
		// silently re-fired. Persist + refresh the Inventory tab and quiver so counts
		// don't look stale / reset on reload.
		if (ammoForDamage) {
			const weaponId = attack.sourceItem?.id;
			if (this._state.consumeAmmunition?.(ammoForDamage.id, 1)) {
				const remaining = this._state.getEffectiveAmmoCount?.(
					this._state.getItems?.().find(i => i.id === ammoForDamage.id),
				) ?? 0;
				if (remaining <= 0) this._state.setSelectedAmmoId?.(weaponId, null);
				this._page?.saveCharacter?.();
				this._page?._inventory?.render?.();
				this.renderCombatQuiver?.();
				// Re-render the attack rows so the per-weapon ammo selector reflects the
				// decremented count (and drops a now-depleted ammo / reverts to Regular).
				// Without this the <select> keeps a stale count until a full page refresh.
				this.renderAttacks?.();
			}
		}
	}

	async _pChooseJuggernautTargetContext (attack) {
		const calc = this._state.getFeatureCalculations?.() || {};
		if (!calc.hasDemolishingMight || attack.isSpell || !this._getAttackRollKind(attack).isMelee) return "normal";
		const choice = await this._showCombatActionChoiceModal(
			{name: "Demolishing Might — Target"},
			[
				{id: "normal", name: "Creature", description: "Resolve normal weapon damage."},
				{id: "construct", name: "Construct", description: `Add ${calc.demolishingMightConstructDamage} weapon damage (doubled on a critical hit).`},
				{id: "object", name: "Object", description: `Double the final damage total (×${calc.demolishingMightObjectMultiplier}).`},
				{id: "structure", name: "Structure", description: `Double the final damage total (×${calc.demolishingMightObjectMultiplier}).`},
			],
		);
		return choice?.id || "normal";
	}

	async _pResolveJuggernautHitEffects (attack) {
		const calc = this._state.getFeatureCalculations?.() || {};
		if (!calc.hasThunderousBlows
				|| !this._state.isStateTypeActive?.("rage")
				|| attack.isSpell
				|| !this._getAttackRollKind(attack).isMelee) return "";

		const usePush = await this._showCombatActionChoiceModal(
			{name: "Thunderous Blows"},
			[
				{id: "push", name: "Push", description: `Push the target up to ${calc.thunderousBlowsDistance} feet.`},
				{id: "skip", name: "Do Not Push", description: "Resolve the hit without forced movement."},
			],
		);
		if (usePush?.id !== "push") return "";

		const distances = [];
		for (let distance = 5; distance <= calc.thunderousBlowsDistance; distance += 5) {
			distances.push({id: `${distance}`, name: `${distance} ft`, description: `Push the target ${distance} feet.`});
		}
		const distanceChoice = await this._showCombatActionChoiceModal({name: "Thunderous Blows — Distance"}, distances);
		if (!distanceChoice) return "";
		const distance = Number(distanceChoice.id);
		const directionChoice = await this._showCombatActionChoiceModal(
			{name: "Thunderous Blows — Direction"},
			[
				{id: "away", name: "Away", description: "Push directly away from you."},
				{id: "left", name: "Left", description: "Push to your left."},
				{id: "right", name: "Right", description: "Push to your right."},
				{id: "toward", name: "Toward", description: "Push toward you."},
			],
		);
		if (!directionChoice) return "";

		const sizeChoice = await this._showCombatActionChoiceModal(
			{name: "Thunderous Blows — Target Size"},
			[
				{id: "large", name: "Large or Smaller", description: "The push succeeds without a save."},
				{id: "huge", name: "Huge or Larger", description: `The target must fail a DC ${calc.juggernautSaveDc} Strength save.`},
			],
		);
		let pushed = true;
		let saveText = "";
		if (sizeChoice?.id === "huge") {
			const saveChoice = await this._showCombatActionChoiceModal(
				{name: `Thunderous Blows — DC ${calc.juggernautSaveDc} Strength Save`},
				[
					{id: "fail", name: "Failed Save", description: "Apply the push."},
					{id: "success", name: "Successful Save", description: "The target resists the push."},
				],
			);
			pushed = saveChoice?.id === "fail";
			saveText = `; Huge+ target ${pushed ? "failed" : "passed"} DC ${calc.juggernautSaveDc} STR`;
		}
		if (!pushed) return `Thunderous Blows: no push${saveText}`;

		let outcome = `Thunderous Blows: pushed ${distance} ft ${directionChoice.id}${saveText}`;
		if (!calc.hasHurricaneStrike || distance < 5 || !this._isActionTypeAvailable("reaction")) return outcome;

		const hurricaneChoice = await this._showCombatActionChoiceModal(
			{name: "Hurricane Strike"},
			[
				{id: "use", name: "Use Reaction", description: "Leap into the vacated space; the target makes the same Strength save against being knocked Prone."},
				{id: "skip", name: "Keep Reaction", description: "Do not leap or attempt to knock the target Prone."},
			],
		);
		if (hurricaneChoice?.id !== "use") return outcome;
		this._consumeActionType("reaction");
		const hurricaneSave = await this._showCombatActionChoiceModal(
			{name: `Hurricane Strike — DC ${calc.juggernautSaveDc} Strength Save`},
			[
				{id: "fail", name: "Failed Save", description: "The target is knocked Prone."},
				{id: "success", name: "Successful Save", description: "The target remains standing."},
			],
		);
		const prone = hurricaneSave?.id === "fail";
		outcome += `; Hurricane Strike reaction spent, leap resolved, target ${prone ? "Prone" : "standing"} (DC ${calc.juggernautSaveDc} STR); one ally may spend its reaction to make a melee attack`;
		return outcome;
	}

	_isSneakAttackWeaponEligible (attack) {
		if (!attack || attack.isSpell) return false;

		if (attack.isRanged) return true;
		if (attack.abilityMod === "dex" || attack.abilityMod === "finesse") return true;

		const properties = attack.properties || [];
		return properties.includes("F") || properties.includes("T")
			|| properties.some?.(prop => typeof prop === "string" && /^(F|T)(\||$)/.test(prop));
	}

	_isSneakAttackAvailableThisTurn () {
		if (!this._state?.isInCombat?.()) return true;

		const round = this._state.getCombatRound?.() || 0;
		if (!round) return true;
		return this._lastSneakAttackRoundUsed !== round;
	}

	_markSneakAttackUsedThisTurn () {
		if (!this._state?.isInCombat?.()) return;
		const round = this._state.getCombatRound?.() || 0;
		if (!round) return;
		this._lastSneakAttackRoundUsed = round;
	}

	_isRiderAvailableThisTurn (riderId) {
		if (!this._state?.isInCombat?.()) return true;
		const round = this._state.getCombatRound?.() || 0;
		if (!round) return true;
		return this._lastRiderRoundUsed[riderId] !== round;
	}

	_markRiderUsedThisTurn (riderId) {
		if (!this._state?.isInCombat?.()) return;
		const round = this._state.getCombatRound?.() || 0;
		if (!round) return;
		this._lastRiderRoundUsed[riderId] = round;
	}

	_isSneakAttackContextDisadvantaged (attackId) {
		if (!this._lastAttackContext || this._lastAttackContext.attackId !== attackId) return false;
		return this._lastAttackContext.mode === "disadvantage" || this._lastAttackContext.hasDisadvantage;
	}

	_isSneakAttackContextAdvantaged (attackId) {
		if (!this._lastAttackContext || this._lastAttackContext.attackId !== attackId) return false;
		return this._lastAttackContext.mode === "advantage" || this._lastAttackContext.hasAdvantage;
	}

	_isSneakAttackTriggerSatisfied (attackId, {showWarnings = true} = {}) {
		const hasAdvantage = this._isSneakAttackContextAdvantaged(attackId);
		const hasDisadvantage = this._isSneakAttackContextDisadvantaged(attackId);

		if (hasDisadvantage) {
			if (showWarnings) {
				JqueryUtil.doToast({
					type: "warning",
					content: "Sneak Attack can't apply when this attack has disadvantage.",
				});
			}
			return false;
		}

		if (hasAdvantage || this._sneakAttackHasAdjacentAlly) return true;

		if (showWarnings) {
			JqueryUtil.doToast({
				type: "warning",
				content: "Sneak Attack requires advantage or an adjacent ally threatening the target.",
			});
		}
		return false;
	}

	_resetTurnActionUsage () {
		this._turnActionUsage = {action: false, bonus: false, reaction: false};
		this._turnAttackUsage = {hasAttackAction: false, attackActionCount: 0, attackActionFeatureIds: new Set()};
		this._handOfHarmUsedThisTurn = false;
		this._relentlessUsedThisTurn = false;
		this._pendingBattleMasterDamage = null;
		this._pendingBattleMasterAttackAdvantage = false;
	}

	canUseBattleMasterAction (actionType) {
		return this._isActionTypeAvailable(actionType);
	}

	canUseBattleMasterManeuver (definition) {
		if (definition?.damageTiming === "nextAttack") return !this._pendingBattleMasterDamage;
		if (!definition?.attackBound) return true;
		const rollId = this._lastAttackContext?.rollId;
		return rollId != null && this._battleMasterManeuverRollId !== rollId;
	}

	consumeBattleMasterAction (actionType) {
		this._consumeActionType(actionType);
	}

	canUseRelentless () {
		return !!this._state.getFeatureCalculations?.().relentlessDie
			&& (!this._state.isInCombat?.() || !this._relentlessUsedThisTurn);
	}

	consumeBattleMasterCheckBonus (rollType) {
		const pending = this._pendingBattleMasterCheck;
		if (!pending?.targets?.includes(rollType)) return null;
		this._pendingBattleMasterCheck = null;
		return pending;
	}

	_consumeBattleMasterDamage (attackId, isCrit = false) {
		const pending = this._pendingBattleMasterDamage;
		this._pendingBattleMasterDamage = null;
		if (!pending
			|| pending.rollId !== this._lastAttackContext?.rollId
			|| this._lastAttackContext?.attackId !== attackId) return {damage: 0, name: null};
		const criticalDamage = isCrit ? this._parseDamage(pending.die || "d8").total : 0;
		return {damage: pending.roll + criticalDamage, name: pending.name};
	}

	applyBattleMasterManeuver ({feature, definition, roll, die = "d8", dc = null, modifier = 0, modifierAbility = null, target = "self", usedRelentless = false}) {
		if (definition.action && definition.action !== "special") this._consumeActionType(definition.action);
		if (usedRelentless && this._state.isInCombat?.()) this._relentlessUsedThisTurn = true;
		if (definition.attackBound && this._lastAttackContext?.rollId != null) {
			this._battleMasterManeuverRollId = this._lastAttackContext.rollId;
		}

		if (definition.rollKind === "attack" && this._lastAttackContext?.total != null) {
			const adjusted = this._lastAttackContext.total + roll;
			this._page._showDiceResult?.(
				`${feature.name} — Adjusted Attack`,
				adjusted,
				`${this._lastAttackContext.total} + ${roll} Superiority Die`,
			);
		} else if (definition.rollKind === "damage") {
			this._pendingBattleMasterDamage = {
				name: feature.name,
				roll,
				die,
				rollId: definition.damageTiming === "nextAttack" ? null : this._lastAttackContext?.rollId,
			};
			if ((feature.name || "").toLowerCase() === "feinting attack") this._pendingBattleMasterAttackAdvantage = true;
		} else if (definition.rollKind === "allyDamage" || definition.rollKind === "secondaryDamage") {
			this._page._showDiceResult?.(`${feature.name} — Damage`, roll, `${roll} Superiority Die damage`);
		} else if (definition.rollKind === "allyTempHp") {
			const fighterLevel = this._state.getClassLevel("Fighter") || 0;
			const levelBonus = Math.floor(fighterLevel / 2);
			const total = Math.max(0, roll + levelBonus);
			this._page._showDiceResult?.(`${feature.name} — Ally Temporary HP`, total, `${roll} + ${levelBonus} (half Fighter level)`);
		} else if (definition.rollKind === "reduction") {
			const total = Math.max(0, roll + modifier);
			this._page._showDiceResult?.(
				`${feature.name} — Damage Reduction`,
				total,
				`${roll} + ${modifier >= 0 ? `+${modifier}` : modifier} ${modifierAbility?.toUpperCase() || ""}`.trim(),
			);
		} else if (definition.rollKind === "check") {
			this._pendingBattleMasterCheck = {name: feature.name, roll, targets: definition.rollTargets || []};
			this._page._showDiceResult?.(`${feature.name} — Check Bonus`, roll, `+${roll} to ${definition.appliesTo}`);
		} else if (definition.rollKind === "ac") {
			if (target === "self") {
				this._state.addActiveState("custom", {
					name: feature.name,
					icon: "🛡️",
					sourceFeatureId: feature.id,
					description: `+${roll} AC; end this state when the maneuver's duration expires.`,
					customEffects: [{type: "bonus", target: "ac", value: roll}],
					duration: "Until the start of your next turn",
				});
			}
			this._page._showDiceResult?.(
				`${feature.name} — ${target === "self" ? "AC Bonus" : "Ally AC Bonus"}`,
				roll,
				`+${roll} AC`,
			);
		} else {
			this._page._showDiceResult?.(
				`${feature.name} — Superiority Die`,
				roll,
				`+${roll} to ${definition.appliesTo}`,
			);
		}

		const saveText = definition.save && dc != null
			? ` Target makes a DC ${dc} ${definition.save.toUpperCase()} saving throw.`
			: "";
		JqueryUtil.doToast({
			type: "info",
			content: `${feature.name}: ${definition.appliesTo}.${saveText}`,
			autoHideTime: 10000,
		});
	}

	_recordAttackForTurn (attack) {
		if (!this._state?.isInCombat?.()) return;
		if (!this._turnAttackUsage) this._resetTurnActionUsage();
		if (!this._isAttackActionRoll(attack)) return;
		this._turnAttackUsage.hasAttackAction = true;
		this._turnAttackUsage.attackActionCount++;
		const id = attack?.isFeatureAttack
			? (attack.sourceFeature || attack.name || "").trim().toLowerCase()
			: "__other__";
		if (id) this._turnAttackUsage.attackActionFeatureIds.add(id);
	}

	_isAttackActionRoll (attack) {
		if (!attack) return false;
		if (attack.actionType && attack.actionType !== "action") return false;
		const featureId = (attack.sourceFeature || attack.name || "").trim().toLowerCase();
		if (attack.isFeatureAttack && featureId === "radiant sun bolt") return true;
		if (attack.isSpellAttack || attack.isSpell || attack.source === "spell" || attack.sourceSpell || attack.abilityMod === "spellcasting") return false;
		return true;
	}

	_hasQualifyingAttackThisTurn ({sourceFeature = null} = {}) {
		if (!this._state?.isInCombat?.()) return true;
		if (!this._turnAttackUsage?.hasAttackAction) return false;
		if (!sourceFeature) return true;
		return this._turnAttackUsage.attackActionFeatureIds.has(sourceFeature.trim().toLowerCase());
	}

	_getAttackActionAllowance (attack) {
		const calculations = this._state.getFeatureCalculations?.() || {};
		const sourceFeature = (attack?.sourceFeature || "").trim().toLowerCase();
		if (!calculations.hasAwakenedAstralSelf || !this._state.isStateTypeActive?.("awakenedAstralSelf") || sourceFeature !== "astral arms") return 2;
		const used = this._turnAttackUsage?.attackActionFeatureIds || new Set();
		return [...used].every(id => id === "astral arms") ? calculations.astralBarrageAttackCount || 3 : 2;
	}

	_isWeaponDamageRiderEligible (rider, attack) {
		return !rider?.attackSourceFeature
			|| (attack?.sourceFeature || "").toLowerCase() === rider.attackSourceFeature.toLowerCase();
	}

	_canRollAttackActionAttack (attack) {
		if (!this._state?.isInCombat?.() || !this._state.isStateTypeActive?.("awakenedAstralSelf") || !this._isAttackActionRoll(attack)) return true;
		const count = this._turnAttackUsage?.attackActionCount || 0;
		return count < this._getAttackActionAllowance(attack);
	}

	_isActionTypeAvailable (actionType) {
		if (!this._state?.isInCombat?.()) return true;
		if (!actionType || actionType === "free") return true;
		return !this._turnActionUsage?.[actionType];
	}

	_consumeActionType (actionType) {
		if (!this._state?.isInCombat?.()) return;
		if (!actionType || actionType === "free") return;
		if (!this._turnActionUsage) this._resetTurnActionUsage();
		if (Object.hasOwn(this._turnActionUsage, actionType)) this._turnActionUsage[actionType] = true;
	}

	_getFeatureActionType (feature) {
		const desc = feature?.description?.toLowerCase() || "";
		if (/bonus action/i.test(desc)) return "bonus";
		if (/reaction/i.test(desc)) return "reaction";
		if (/no action required|free/i.test(desc)) return "free";
		return "action";
	}

	_canApplySneakAttack (attack, sneakAttackInfo, {showWarnings = true} = {}) {
		if (!sneakAttackInfo || !this._sneakAttackEnabled) return false;

		if (!this._isSneakAttackWeaponEligible(attack)) {
			if (showWarnings) {
				JqueryUtil.doToast({
					type: "warning",
					content: "Sneak Attack requires a finesse or ranged weapon attack.",
				});
			}
			return false;
		}

		if (!this._isSneakAttackAvailableThisTurn()) {
			if (showWarnings) {
				JqueryUtil.doToast({
					type: "warning",
					content: "Sneak Attack has already been used this round.",
				});
			}
			return false;
		}

		if (!this._isSneakAttackTriggerSatisfied(attack.id, {showWarnings})) return false;

		return true;
	}

	_parseDamage (damageStr, isCrit = false, {maximize = false} = {}) {
		// Parse dice notation like "1d8", "2d6+2", etc.
		const match = damageStr.match(/(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?/);
		if (!match) {
			return {total: 0, rolls: []};
		}

		let numDice = parseInt(match[1]);
		const dieSize = parseInt(match[2]);
		const modifier = match[4] ? parseInt(match[4]) * (match[3] === "-" ? -1 : 1) : 0;

		// Double dice on crit
		if (isCrit) numDice *= 2;

		const rolls = [];
		let total = 0;

		for (let i = 0; i < numDice; i++) {
			const roll = maximize ? dieSize : this._page.rollDice(1, dieSize);
			rolls.push(roll);
			total += roll;
		}

		total += modifier;

		return {total, rolls, modifier, sides: dieSize, numDice};
	}

	/**
	 * Push a damage-roll's dice into an animation groups accumulator. Accepts a
	 * `_parseDamage` result (`{sides, rolls:[…]}`); no-op for null/empty rolls or
	 * static-only components (no dice). Merges into an existing same-sides group
	 * so the notation stays compact.
	 * @param {Array<{sides:number, values:number[]}>} groups
	 * @param {{sides?:number, rolls?:number[]}|null} roll
	 */
	_pushDiceGroup (groups, roll) {
		if (!roll || !Array.isArray(roll.rolls) || !roll.rolls.length) return;
		const sides = Number(roll.sides);
		if (!Number.isFinite(sides) || sides < 2) return;
		const values = roll.rolls.map(Number).filter(Number.isFinite);
		if (!values.length) return;
		const existing = groups.find(g => g.sides === sides);
		if (existing) existing.values.push(...values);
		else groups.push({sides, values});
	}

	/**
	 * Resolve an ability modifier key, handling special cases like "finesse" and "spellcasting"
	 * @param {string} abilityKey - The ability key (e.g., "str", "dex", "finesse", "spellcasting")
	 * @returns {number} The resolved ability modifier
	 */
	_resolveAbilityMod (abilityKey) {
		if (abilityKey === "finesse") {
			return Math.max(this._state.getAbilityMod("str"), this._state.getAbilityMod("dex"));
		} else if (abilityKey === "spellcasting") {
			return Math.max(
				this._state.getAbilityMod("int"),
				this._state.getAbilityMod("wis"),
				this._state.getAbilityMod("cha"),
			);
		}
		return this._state.getAbilityMod(abilityKey);
	}

	/**
	 * Parse a bonus string like "+1", "+2", "+3" into a number
	 * @param {string|number} bonus - The bonus value (e.g., "+1", "2", or a number)
	 * @returns {number} The parsed bonus as a number
	 */
	_parseBonus (bonus) {
		if (bonus == null) return 0;
		if (typeof bonus === "number") return bonus;
		// Parse strings like "+1", "+2", "-1"
		const parsed = parseInt(bonus.toString().replace(/\s/g, ""), 10);
		return isNaN(parsed) ? 0 : parsed;
	}

	_parseDieMax (dieStr) {
		// Parse "1d6" → 6, "2d8" → 16, "1d10" → 10
		const match = (dieStr || "").match(/(\d+)d(\d+)/);
		if (!match) return 0;
		return parseInt(match[1]) * parseInt(match[2]);
	}

	_getEffectiveWeaponDamageDie (weapon) {
		let damageDie = this._state.getWeaponDamageDie(weapon);

		if (this._state.isMonkWeapon?.(weapon)) {
			const martialArtsDie = this._state.getFeatureCalculations?.()?.martialArtsDie;
			if (martialArtsDie && this._parseDieMax(martialArtsDie) > this._parseDieMax(damageDie)) {
				damageDie = martialArtsDie;
			}
		}

		const damageDieIncrease = this._state.getEffectiveItemBonuses?.(weapon?.id)?.damageDieIncrease || 0;
		if (damageDieIncrease > 0 && typeof CharacterSheetUpgrades !== "undefined") {
			damageDie = CharacterSheetUpgrades.increaseDamageDie(damageDie, damageDieIncrease);
		}

		return damageDie;
	}

	_rollInitiative (event) {
		const mod = this._state.getInitiative();
		// Consume initiative advantage/disadvantage from the modifier pipeline (Bug #4) — mirrors
		// the primary handler in charactersheet.js. rollD20 combines this with event keys.
		const initMode = this._state.getInitiativeRollMode?.() || {advantage: false, disadvantage: false};
		const rollResult = this._page.rollD20({event, stateAdvantage: initMode.advantage, stateDisadvantage: initMode.disadvantage});

		// Buff dice (e.g. Gift of Alacrity's 1d8) rolled into the total.
		const stateDiceList = this._state.getRollBonusDiceFromStates?.("initiative") || [];
		let diceTotal = 0;
		let diceStr = "";
		for (const d of stateDiceList) {
			const value = Renderer.dice.parseRandomise2(d.dice) * d.sign;
			diceTotal += value;
			diceStr += ` ${d.sign > 0 ? "+" : "-"} ${Math.abs(value)} [${d.dice} ${d.source}]`;
		}

		const maneuverBonus = this.consumeBattleMasterCheckBonus("initiative");
		const total = rollResult.roll + mod + diceTotal + (maneuverBonus?.roll || 0);

		const modeLabel = this._page.getModeLabel(rollResult.mode);
		void this._page.pAnimateD20?.(rollResult);
		this._page.showDiceResult({
			title: `Initiative${modeLabel}`,
			roll: rollResult.roll,
			modifier: mod,
			total,
			subtitle: this._page.formatD20Breakdown(rollResult, mod)
				+ diceStr
				+ (maneuverBonus ? ` + ${maneuverBonus.roll} [${maneuverBonus.name}]` : ""),
		});

		// Update initiative display
		document.getElementById("charsheet-initiative-value").textContent = total;

		// Trigger initiative-based focus/ki recovery features
		this._triggerInitiativeRecovery();
	}

	/**
	 * Trigger recovery features that activate on initiative rolls (Uncanny Metabolism, Perfect Focus/Self).
	 * Uncanny Metabolism (XPHB Monk 2+): Regain all focus points + heal (Martial Arts die + Monk level). 1/long rest.
	 * Perfect Focus (XPHB Monk 15+): If UM not used and focus <= 3, regain up to 4.
	 * Perfect Self (PHB Monk 20): If ki = 0, regain 4.
	 */
	async _triggerInitiativeRecovery () {
		const calc = this._state.getFeatureCalculations?.() || {};
		const kiMax = this._state.getKiPoints?.() || 0;
		const kiCurrent = this._state.getKiPointsCurrent?.() || 0;

		// Uncanny Metabolism (1/long rest, optional — player chooses)
		if (calc.hasUncannyMetabolism && kiCurrent < kiMax) {
			const feature = this._state.getFeature("Uncanny Metabolism");

			// Backfill uses for existing saves that have the feature but no .uses tracking
			if (feature && !feature.uses) {
				feature.uses = {max: 1, current: 1, recharge: "long"};
			}
			// Feature may not be in _data.features for old saves — trust getFeatureCalculations
			const hasUsesLeft = feature ? feature.uses.current > 0 : true;

			if (hasUsesLeft) {
				const pointName = calc.focusPoints ? "Focus" : "Ki";
				const chosen = await this._showCombatActionChoiceModal(
					{name: "Uncanny Metabolism"},
					[
						{
							id: "use",
							name: `Use Uncanny Metabolism`,
							description: `Regain all ${pointName} Points (${kiMax}) and heal ${calc.uncannyMetabolismHealing || "1d6+level"} HP. (1/Long Rest)`,
						},
						{
							id: "skip",
							name: "Skip",
							description: "Don't use Uncanny Metabolism this time.",
						},
					],
					() => {},
				);

				if (!chosen || chosen.id !== "use") return;

				// Restore all focus/ki points
				this._state.setKiPointsCurrent(kiMax);

				// Roll martial arts die for healing
				const martialArtsDice = calc.martialArtsDie || "1d6";
				const dieMatch = martialArtsDice.match(/(\d+)d(\d+)/);
				const dieCount = dieMatch ? parseInt(dieMatch[1]) : 1;
				const dieSize = dieMatch ? parseInt(dieMatch[2]) : 6;
				let healRoll = 0;
				for (let i = 0; i < dieCount; i++) {
					healRoll += this._page.rollDice(1, dieSize);
				}

				const monkLevel = this._state.getClassLevel?.("Monk") || 0;
				const totalHeal = healRoll + monkLevel;

				// Apply healing
				const currentHp = this._state.getCurrentHp();
				const maxHp = this._state.getMaxHp();
				this._state.setCurrentHp(Math.min(maxHp, currentHp + totalHeal));

				// Consume the use via proper state method
				if (feature?.uses && feature.id) {
					this._state.setFeatureUses(feature.id, Math.max(0, feature.uses.current - 1));
				} else if (feature?.uses) {
					feature.uses.current = Math.max(0, feature.uses.current - 1);
				}

				JqueryUtil.doToast({
					type: "success",
					content: `Uncanny Metabolism: Regained all ${pointName} Points (${kiMax}) and healed ${totalHeal} HP (${martialArtsDice}+${monkLevel})`,
				});

				this.renderCombatActions();
				this.renderCombatResources();
				this._page._renderResources?.();
				if (this._page._features) this._page._features.render();
				this._page.saveCharacter?.();
				return;
			}
		}

		// Perfect Focus (XPHB Monk 15+): regain focus up to 4 if at 3 or fewer
		if (calc.hasPerfectFocus && kiCurrent <= 3 && kiMax > 0) {
			const newKi = Math.min(kiMax, calc.perfectFocusRecovery || 4);
			if (newKi > kiCurrent) {
				this._state.setKiPointsCurrent(newKi);
				JqueryUtil.doToast({
					type: "info",
					content: `Perfect Focus: Regained Focus Points (now ${newKi}/${kiMax})`,
				});
				this.renderCombatActions();
				return;
			}
		}

		// Perfect Self (PHB Monk 20): regain 4 ki if at 0
		if (calc.hasPerfectSelf && kiCurrent === 0 && kiMax > 0) {
			const recovery = Math.min(kiMax, calc.perfectSelfRecovery || 4);
			this._state.setKiPointsCurrent(recovery);
			JqueryUtil.doToast({
				type: "info",
				content: `Perfect Self: Regained ${recovery} Ki Points`,
			});
			this.renderCombatActions();
		}
	}

	_rollDeathSave (isManualSuccess = null) {
		const deathSaves = this._state.getDeathSaves();

		if (isManualSuccess !== null) {
			// Manual success/failure marking
			if (isManualSuccess) {
				deathSaves.successes = Math.min(3, deathSaves.successes + 1);
			} else {
				deathSaves.failures = Math.min(3, deathSaves.failures + 1);
			}
		} else {
			// Roll death save. Champion Survivor's Defy Death (XPHB L18) grants advantage
			// via `deathSave:advantage` (see `getDeathSaveRollMode()`); Thelemar's crit-roll
			// homebrew is suppressed (isAttack: true) since death saves already hardcode
			// their own nat-1/nat-20(+Defy Death 18-20) special cases below.
			const deathMode = this._state.getDeathSaveRollMode?.() || {advantage: false, disadvantage: false};
			const rollResult = this._page.rollD20({stateAdvantage: deathMode.advantage, stateDisadvantage: deathMode.disadvantage, isAttack: true});
			const roll = rollResult.roll;
			void this._page.pAnimateD20?.(rollResult);

			const modeLabel = this._page.getModeLabel?.(rollResult.mode) || "";
			// C9: Disciplined Survivor adds proficiency bonus to death saves
			const calc = this._state.getFeatureCalculations?.() || {};
			const profBonus = calc.hasDeathSaveProficiency ? (this._state.getProficiencyBonus?.() || 0) : 0;
			const total = roll + profBonus;
			const profNote = profBonus > 0 ? ` (+${profBonus} prof)` : "";

			// Champion Survivor's Defy Death (XPHB L18): a roll of 18-20 counts as a
			// natural 20 (regain 1 HP, stabilize). PHB/pre-18 characters keep the strict
			// natural-20-only rule.
			const natRange = calc.hasChampionSurvivorDefyDeath ? (calc.championSurvivorDeathSaveNatRange || 18) : 20;

			if (roll >= natRange) {
				// Natural 20 (or Defy Death's 18-20): regain 1 HP
				this._state.heal(1);
				this._resetDeathSaves();
				const defyDeathNote = roll < 20 ? " (Defy Death!)" : "";
				JqueryUtil.doToast({type: "success", content: `Natural 20${defyDeathNote}! You regain 1 HP and are stable!`});
				this._page.renderCharacter();
				return;
			} else if (roll === 1) {
				// Natural 1: 2 failures
				deathSaves.failures = Math.min(3, deathSaves.failures + 2);
				this._page.showDiceResult({
					title: `Death Save${modeLabel}`,
					roll,
					total,
					resultClass: "text-danger",
					resultNote: ` (2 Failures!)${profNote}`,
				});
			} else if (total >= 10) {
				deathSaves.successes = Math.min(3, deathSaves.successes + 1);
				this._page.showDiceResult({
					title: `Death Save${modeLabel}`,
					roll,
					total,
					resultClass: "text-success",
					resultNote: ` (Success)${profNote}`,
				});
			} else {
				deathSaves.failures = Math.min(3, deathSaves.failures + 1);
				this._page.showDiceResult({
					title: `Death Save${modeLabel}`,
					roll,
					total,
					resultClass: "text-danger",
					resultNote: ` (Failure)${profNote}`,
				});
			}
		}

		this._state.setDeathSaves(deathSaves);

		// Check for stabilization or death
		if (deathSaves.successes >= 3) {
			JqueryUtil.doToast({type: "success", content: "You have stabilized!"});
			this._resetDeathSaves();
		} else if (deathSaves.failures >= 3) {
			JqueryUtil.doToast({type: "danger", content: "Your character has died."});
		}

		this.renderDeathSaves();
		this._page.saveCharacter();
	}

	_resetDeathSaves () {
		this._state.setDeathSaves({successes: 0, failures: 0});
		this.renderDeathSaves();
		this._page.saveCharacter();
	}

	// #region Rendering
	/**
	 * Render the armor non-proficiency warning banner into the attacks container.
	 * 5e RAW: wearing armor / wielding a shield you lack proficiency with imposes
	 * disadvantage on STR/DEX ability checks, saving throws, and attack rolls, and
	 * prevents spellcasting. AC is not reduced. Prepended into the attacks list so the
	 * warning sits near the attacks/AC without needing a dedicated HTML anchor.
	 * @param {HTMLElement} container - The attacks list container.
	 * @private
	 */
	_renderArmorProficiencyWarning (container) {
		if (!container) return;
		const badArmor = this._state.isWearingNonProficientArmor?.();
		const badShield = this._state.isWearingNonProficientShield?.();
		if (!badArmor && !badShield) return;

		const gear = badArmor && badShield ? "armor and shield" : (badArmor ? "armor" : "shield");
		const banner = document.createElement("div");
		banner.className = "charsheet__armor-penalty-warning ve-small mb-2 p-2 rounded";
		banner.setAttribute("role", "alert");
		banner.style.cssText = "background: var(--cs-warning-light, rgba(245,158,11,0.12)); border: 1px solid var(--cs-warning, #f59e0b); color: var(--cs-warning, #f59e0b);";
		banner.innerHTML = `
			<div class="bold">⚠️ Non-Proficient ${gear === "shield" ? "Shield" : (gear === "armor" ? "Armor" : "Armor & Shield")}</div>
			<div class="ve-muted mt-1">Disadvantage on Strength- and Dexterity-based attacks, ability checks, and saving throws. You <span class="bold">cannot cast spells</span> while wearing ${gear} you are not proficient with.</div>
		`;
		container.prepend(banner);
	}

	renderAttacks () {
		const container = document.getElementById("charsheet-attacks-list") || document.getElementById("charsheet-combat-attacks");
		if (!container) return;

		this._initAttackHandsListener(container);
		container.innerHTML = "";

		// Armor non-proficiency warning (5e RAW): if the character wears armor / wields a
		// shield they lack proficiency with, surface a prominent banner near the attacks
		// list. Covers both the disadvantage indicator and the "cannot cast spells" warning.
		this._renderArmorProficiencyWarning(container);

		// Get configured attacks
		let attacks = this._state.getAttacks();

		// Also add attacks from equipped weapons if not already configured
		const items = this._state.getItems();
		const equippedWeapons = items.filter(i => i.weapon && i.equipped);

		equippedWeapons.forEach(weapon => {
			// Check if we already have an attack for this weapon
			const existingAttack = attacks.find(a => a.name === weapon.name);
			if (!existingAttack) {
				// Get any user overrides for this weapon's attack
				const overrides = weapon.attackOverrides || {};

				// Auto-generate attack from weapon
				// Use property (5etools format) or properties (normalized format)
				const props = weapon.property || weapon.properties || [];
				const isRanged = props.some(p => p === "A" || p === "T" || p.startsWith("A|") || p.startsWith("T|"));
				const hasFinesse = props.some(p => p === "F" || p.startsWith("F|"));
				const isMonkWeapon = this._state.isMonkWeapon?.(weapon);
				const defaultAbility = isRanged ? "dex" : ((hasFinesse || isMonkWeapon) ? "finesse" : "str");

				// Calculate total bonuses including magic item bonuses, upgrade bonuses, and custom bonuses
				const effectiveBonuses = this._state.getEffectiveItemBonuses?.(weapon.id);
				let magicAttackBonus;
				let magicDamageBonus;
				if (effectiveBonuses) {
					magicAttackBonus = (effectiveBonuses.bonusWeapon || 0) + (effectiveBonuses.bonusWeaponAttack || 0);
					magicDamageBonus = (effectiveBonuses.bonusWeapon || 0) + (effectiveBonuses.bonusWeaponDamage || 0);
				} else {
					magicAttackBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponAttack || 0);
					magicDamageBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponDamage || 0);
				}
				const customAttackBonus = weapon.customAttackBonus || 0;
				const customDamageBonus = weapon.customDamageBonus || 0;

				const baseDamageDie = this._getEffectiveWeaponDamageDie(weapon);
				let baseDamageType = weapon.dmgType
					? Parser.dmgTypeToFull(weapon.dmgType)
					: (weapon.damageType || (weapon.damage ? weapon.damage.split(" ").slice(1).join(" ") : null) || "slashing");

				const autoAttack = {
					id: `auto_${weapon.id}`,
					// Use overrides if present, otherwise use weapon defaults
					name: overrides.name ?? weapon.name,
					isMelee: overrides.isMelee ?? !isRanged,
					abilityMod: overrides.abilityMod ?? defaultAbility,
					attackBonus: magicAttackBonus + customAttackBonus,
					range: overrides.range ?? (weapon.range || (isRanged ? "80/320 ft." : "5 ft.")),
					damage: overrides.damage ?? baseDamageDie,
					damageType: overrides.damageType ?? baseDamageType,
					damageBonus: magicDamageBonus + customDamageBonus,
					properties: overrides.properties ?? props,
					mastery: weapon.mastery || [],
					isAutoGenerated: true,
					isMonkWeapon: !!isMonkWeapon,
					sourceItem: weapon, // #14: kept so `_rollDamage` can read getEffectiveItemBonuses(sourceItem.id) directly (and for hover)
				};
				attacks.push(autoAttack);
			}
		});

		// Append always-available attacks granted by class/subclass mechanics. The state
		// owns the descriptors and scaling; Combat only merges them into the canonical
		// attack roll/damage path.
		const featureAttacks = this._state.getFeatureGrantedAttacks?.() || [];
		for (const attack of featureAttacks) {
			if (!attacks.some(existing => existing.id === attack.id)) attacks.push(attack);
		}

		const coatedWeapon = this._state.getUmbralCoatedWeapon?.();
		if (coatedWeapon?.weaponId) {
			attacks = attacks.map(attack => attack.id === coatedWeapon.weaponId
				? {
					...attack,
					range: "Melee or 20/60 ft.",
					countsAsShadowWeapon: true,
					properties: [...new Set([...(attack.properties || []), "Thrown"])],
					umbralCoated: true,
				}
				: attack);
		}

		this._cachedAttacks = [...attacks];

		// Append temporary attacks (from variant spell components, etc.)
		const tempAttacks = this._state.getTemporaryAttacks?.() || [];
		for (const ta of tempAttacks) {
			attacks.push({...ta, isTemporary: true});
		}

		// Append attacks granted by active states / forms (e.g. Bee Zodiac Form's
		// bonus-action ranged spell attack). These appear/disappear with the form and
		// are not independently removable (see _renderAttackItem badge + button gating).
		const activeStateAttacks = this._state.getActiveStateAttacks?.() || [];
		for (const asa of activeStateAttacks) attacks.push(asa);

		if (!attacks.length) {
			container.innerHTML = `
				<p class="ve-muted text-center">
					No attacks configured. Equip weapons from Inventory or add custom attacks.
					<br>
					<button class="ve-btn ve-btn-primary ve-btn-sm mt-2" id="charsheet-add-attack-empty">
						<span class="glyphicon glyphicon-plus"></span> Add Attack
					</button>
				</p>
			`;

			document.getElementById("charsheet-add-attack-empty")?.addEventListener("click", () => this._showAttackCreator());
			return;
		}

		// Compute reach context once for this render pass (avoids re-walking
		// features/feats/active states per attack).
		const reachCtx = {
			meleeReach: this._state.getMeleeReach?.() ?? 5,
			reachBonus: this._state.getReachBonus?.() ?? 0,
		};

		// Cache known weapon-channel cantrips (Booming/Green-Flame Blade) once per render
		// so the per-weapon ✨ button can be gated without re-scanning per attack.
		this._channelCantripsCache = this._page._spells?.getKnownWeaponChannelCantrips?.() || [];

		// Attacks-per-action banner (Extra Attack and scaling variants). Surfaces how many
		// attacks the character can make with the Attack action, near the weapon list.
		const attackCount = this._state.getFeatureCalculations?.()?.attackCount || 1;
		if (attackCount > 1) {
			const banner = e_({outer: `
				<div class="charsheet__attacks-per-action ve-flex ve-flex-v-center gap-1 mb-2" title="Number of attacks you can make when you take the Attack action (Extra Attack)">
					<span>⚔️</span>
					<span class="bold">${attackCount} attacks</span>
					<span class="ve-muted ve-small">per Attack action</span>
				</div>`});
			container.append(banner);
		}

		attacks.forEach(attack => {
			const item = this._renderAttackItem(attack, reachCtx);
			container.append(item);
		});
	}

	/**
	 * Whether an attack should show the active ammunition SELECTOR (Bug #3): a
	 * RANGED WEAPON attack (not melee, not a spell) sourced from a weapon that
	 * uses ammunition. Shown for ANY such weapon — even when the quiver holds no
	 * special ammo, the selector still offers "Regular" as the sole option (so
	 * blowguns and hand crossbows always get a selector). Pure predicate (no DOM)
	 * so it's unit-testable. Deliberately NOT gated on
	 * `isAmmunitionTrackingEnabled` — the quiver is its own always-on feature.
	 * @param {*} attack
	 * @param {boolean} [isMelee] - Precomputed melee classification (optional).
	 * @returns {boolean}
	 */
	_isAmmoSelectorEligible (attack, isMelee) {
		if (!attack || attack.isSpell) return false;
		const melee = isMelee != null ? isMelee : this._getAttackRollKind(attack).isMelee;
		if (melee) return false;
		const weaponId = attack.sourceItem?.id;
		if (!weaponId || !attack.sourceItem?.ammoType) return false;
		return true;
	}

	/**
	 * Per-weapon active ammunition selector (Bug #3) — a `<select>` listing
	 * "Regular" (default, no bonus/no consume) plus each ammo in the equipped
	 * quiver with its remaining count. The current selection reflects state; the
	 * change handler folds the chosen ammo's bonuses into BOTH the attack and the
	 * damage roll and consumes one round on the damage roll. Returns "" when the
	 * weapon isn't an eligible ranged ammunition user.
	 * @param {*} attack
	 * @param {boolean} [isMelee]
	 * @returns {string}
	 */
	_renderAmmoSelector (attack, isMelee) {
		if (!this._isAmmoSelectorEligible(attack, isMelee)) return "";
		const weaponId = attack.sourceItem?.id;
		const ammo = this._state.getQuiverAmmunitionForWeapon?.(weaponId) || [];
		const selectedId = this._state.getSelectedAmmoId?.(weaponId) || "";
		// Drop a stale/depleted selection back to Regular for display purposes.
		const selectedValid = ammo.some(a => a.id === selectedId
			&& (this._state.getEffectiveAmmoCount?.(a) ?? (a.quantity || 0)) > 0);
		const curVal = selectedValid ? selectedId : "";
		const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
		const opts = [`<option value=""${curVal === "" ? " selected" : ""}>Regular</option>`];
		for (const a of ammo) {
			const count = this._state.getEffectiveAmmoCount?.(a) ?? (a.quantity || 0);
			opts.push(`<option value="${esc(a.id)}"${curVal === a.id ? " selected" : ""}>${esc(a.name)} (×${count})</option>`);
		}
		return `<select class="charsheet__attack-ammo-select" title="Active ammunition — its bonuses ride this weapon's attack and damage rolls; one round is spent on the damage roll">${opts.join("")}</select>`;
	}

	getAvailableWeaponAttacks () {
		this.renderAttacks();
		const activeStateAttacks = this._state.getActiveStateAttacks?.() || [];
		const attacks = [...(this._cachedAttacks || []), ...activeStateAttacks]
			.filter(attack => !attack.isSpell && attack.id)
			.map(attack => attack.riteWeaponId
				? {...attack, id: attack.riteWeaponId, name: "Predatory Strikes"}
				: attack);
		return attacks.filter((attack, ix) => attacks.findIndex(it => it.id === attack.id) === ix);
	}

	_resolveHybridBloodlustAtTurnStart () {
		const check = this._state.getHybridBloodlustCheck?.();
		if (!check) return;
		if (check.automaticFailure) {
			JqueryUtil.doToast({type: "danger", content: "Bloodlust automatically fails: move toward the nearest creature and take the Attack action against it."});
			return;
		}
		const rollResult = this._page.rollD20({mode: check.advantage ? "advantage" : "normal"});
		const total = rollResult.roll + check.bonus;
		const failed = total < check.dc;
		this._page.showDiceResult({
			title: `Bloodlust Wisdom Save${check.advantage ? " (Advantage)" : ""}`,
			roll: rollResult.roll,
			modifier: check.bonus,
			total,
			resultClass: failed ? "charsheet__dice-result-total--fumble" : "",
			resultNote: failed ? "Failure — attack the nearest creature." : "Success — you retain control.",
			subtitle: this._page.formatD20Breakdown(rollResult, check.bonus),
		});
	}

	_renderAttackItem (attack, reachCtx = {}) {
		// Calculate ability modifier — handles finesse (max STR/DEX), spellcasting
		// (max INT/WIS/CHA for natural weapons), and Bladesong (max(weapon mod, INT)
		// while active) so the displayed bonus matches the roll.
		const abilityMod = this._state.getWeaponAbilityMod(attack);

		const profBonus = this._state.getProficiencyBonus();
		// Scope-aware named attack modifiers (e.g. Archery +2 on ranged weapons only)
		// so the displayed badge matches the roll. Transient combat-local toggles
		// (Flanking, High Ground) are intentionally excluded — they're situational
		// and surface in the roll breakdown, not the static badge.
		const {isMelee: attackIsMelee} = this._getAttackRollKind(attack);
		const attackContributions = this._state.getAttackModifierContributions?.({isMelee: attackIsMelee}) || [];
		const featureAttackBonus = attackContributions.reduce((sum, c) => sum + (c.value || 0), 0);
		const stateAttackBonus = this._state.getBonusFromStates?.("attack", {weaponId: attack.riteWeaponId || attack.id}) || 0;
		const totalAttackBonus = abilityMod + profBonus + (attack.attackBonus || 0) + featureAttackBonus + stateAttackBonus;
		const totalDamageBonus = abilityMod + (attack.damageBonus || 0);
		// Itemized tooltip for the to-hit badge so each contributing source is visible.
		const atkBreakdownParts = [
			`${abilityMod >= 0 ? "+" : ""}${abilityMod} ability`,
			`+${profBonus} prof`,
		];
		if (attack.attackBonus) atkBreakdownParts.push(`${attack.attackBonus >= 0 ? "+" : ""}${attack.attackBonus} weapon`);
		attackContributions.forEach(c => atkBreakdownParts.push(`${c.value >= 0 ? "+" : ""}${c.value} ${c.name}`));
		if (stateAttackBonus) atkBreakdownParts.push(`${stateAttackBonus >= 0 ? "+" : ""}${stateAttackBonus} active state`);
		const atkBadgeTitle = atkBreakdownParts.join(", ");
		const isAutoGenerated = attack.isAutoGenerated || attack.id?.startsWith?.("auto_");
		const isNaturalWeapon = attack.isNaturalWeapon;

		// Get critical range
		const critRange = this._state.getCriticalRange?.() || 20;
		const critRangeHtml = critRange < 20
			? `<span class="badge badge-warning" title="Critical Hit Range: ${critRange}-20">Crit ${critRange}+</span>`
			: "";

		// Format properties using the same logic as inventory
		const propertyNames = (attack.properties || [])
			.map(p => this._formatProperty(p))
			.filter(Boolean);
		const propertiesHtml = propertyNames.length
			? `<span class="ve-small ve-muted">(${propertyNames.join(", ")})</span>`
			: "";

		// Reach-aware range display. Melee attacks derive their reach from the
		// character's current melee reach plus the weapon "Reach" property. Only
		// override the stored range string when reach is actually modified
		// (character reach bonus or a Reach-property weapon) and the attack isn't a
		// thrown weapon (range like "20/60 ft."), to avoid regressions for the
		// default 5 ft. case and ranged/thrown ranges.
		const {rangeHtml: rangeDisplayHtml} = this._buildAttackRangeDisplay(attack, reachCtx);

		// Format mastery — each mastery property is a real 5etools hover target on the
		// `itemMastery` faux-page (Sap / Cleave / Vex / …), not a static title.
		const masteryHtml = (attack.mastery || []).length
			? `<span class="ve-small text-info charsheet__attack-mastery">⚔ ${(attack.mastery || []).map(m => this._formatMasteryLink(m)).filter(Boolean).join(", ")}</span>`
			: "";

		// Create hoverable name for auto-generated attacks
		let nameHtml;
		if (isAutoGenerated && attack.sourceItem) {
			const item = attack.sourceItem;
			try {
				nameHtml = Renderer.get().render(`{@item ${item.name}|${item.source || "PHB"}}`);
			} catch (e) {
				nameHtml = attack.name;
			}
		} else {
			nameHtml = attack.name;
		}

		// Determine badge type
		let badgeHtml = "";
		if (attack.isActiveStateAttack) {
			const label = attack.sourceState || "Form";
			const actionLabel = attack.actionType === "bonus" ? " (Bonus Action)"
				: attack.actionType === "reaction" ? " (Reaction)"
					: attack.actionType === "action" ? " (Action)" : "";
			badgeHtml = ` <span class="badge badge-warning" title="Granted by ${label}${actionLabel} — ends when the form does">${attack.sourceStateIcon || "🌟"} ${label}${actionLabel}</span>`;
		} else if (attack.isFeatureAttack) {
			badgeHtml = ` <span class="badge badge-info" title="Granted by ${attack.sourceFeature || attack.name}">✨ Feature</span>`;
		} else if (attack.isTemporary) {
			const srcParts = [attack.sourceComponent, attack.sourceSpell, attack.sourceDuration].filter(Boolean);
			const srcTitle = srcParts.length ? srcParts.join(" — ") : "Temporary Attack";
			badgeHtml = ` <span class="badge badge-info" title="${srcTitle}">🧪 Temp</span>`;
		} else if (attack.isMonkWeapon) {
			const title = attack.isUnarmedStrike ? "Monk Unarmed Strike with Martial Arts" : "Monk Weapon \u2014 uses Martial Arts die and DEX";
			badgeHtml = ` <span class="badge badge-warning" title="${title}">Monk</span>`;
		} else if (isNaturalWeapon) {
			badgeHtml = " <span class=\"badge badge-info\" title=\"Natural Weapon from feature\">Natural</span>";
		} else if (isAutoGenerated) {
			badgeHtml = " <span class=\"badge badge-secondary\">Auto</span>";
		}

		// Show active combat method effect badge
		const methodEffects = this._state.getActiveCombatMethodEffects?.() || [];
		const activeMethod = methodEffects.find(e => e.weaponId === attack.id);
		if (activeMethod) {
			const methodTitle = `${activeMethod.name}${activeMethod.ongoingDamage ? `: ${activeMethod.ongoingDamage} ongoing damage` : ""}`;
			badgeHtml += ` <span class="badge badge-danger" title="${methodTitle}">🩸 ${activeMethod.name}</span>`;
		}

		// Show upgrade/gemstone badges for auto-generated attacks with upgraded items
		let upgradeNotesHtml = "";
		if (attack.sourceItem?.appliedUpgrades?.length) {
			if (typeof CharacterSheetUpgrades !== "undefined") {
				const eff = CharacterSheetUpgrades.getUpgradeEffects(attack.sourceItem);
				const parts = [];
				if (eff.bonusWeaponAttack) parts.push(`+${eff.bonusWeaponAttack} atk`);
				if (eff.bonusWeaponDamage) parts.push(`+${eff.bonusWeaponDamage} dmg`);
				if (eff.critThresholdReduction) parts.push(`crit ${20 - eff.critThresholdReduction}-20`);
				if (eff.damageDieIncrease) parts.push(`die +${eff.damageDieIncrease}`);
				if (eff.bonusDamageDice) parts.push(`+${eff.bonusDamageDice} ${eff.bonusDamageType}`);
				const tagStr = eff.tags.length ? eff.tags.join(", ") : "";
				const bonusStr = parts.length ? parts.join(", ") : "";
				const tooltip = [bonusStr, tagStr].filter(Boolean).join(" | ");
				badgeHtml += ` <span class="badge badge-info" title="${tooltip || "Upgrades"}">⚒ ${attack.sourceItem.appliedUpgrades.length}</span>`;
				for (const tag of eff.tags) {
					badgeHtml += ` <span class="badge badge-secondary" title="${tag}">${tag}</span>`;
				}
				if (eff.notes.length) upgradeNotesHtml = eff.notes.map(n => `<div class="ve-small ve-muted charsheet__attack-upgrade-note">${n}</div>`).join("");
			} else {
				const upgradeNames = attack.sourceItem.appliedUpgrades.map(u => u.name).join(", ");
				badgeHtml += ` <span class="badge badge-info" title="Upgrades: ${upgradeNames}">⚒ ${attack.sourceItem.appliedUpgrades.length}</span>`;
			}
		}
		if (attack.sourceItem?.socketedGemstones?.length) {
			const gem = attack.sourceItem.socketedGemstones[0];
			const summary = typeof CharacterSheetUpgrades !== "undefined" ? CharacterSheetUpgrades.getGemstoneSummary(gem) : "";
			const chargeStr = gem.chargesMax ? ` [${gem.chargesCurrent ?? gem.chargesMax}/${gem.chargesMax}]` : "";
			badgeHtml += ` <span class="badge badge-success" title="${gem.name}${chargeStr}${summary ? `: ${summary}` : ""}">💎 ${gem.gemName || gem.name}${chargeStr}</span>`;
			if (summary && !upgradeNotesHtml) upgradeNotesHtml = `<div class="ve-small ve-muted charsheet__attack-upgrade-note">💎 ${summary}</div>`;
		}

		// Reckless Attack (Barbarian 2+): a one-click "roll recklessly" affordance that
		// activates the persistent recklessAttack state (if not already on) and then
		// rolls through the normal path. Only surfaced on weapon attacks — reckless is a
		// weapon-attack mechanic and only grants advantage on melee Strength attacks
		// (the roll pipeline scopes that correctly). The existing state toggle remains.
		const hasReckless = (this._state.getClassLevel?.("Barbarian") || 0) >= 2;
		const recklessActive = this._state.isStateTypeActive?.("recklessAttack");
		const recklessBtnHtml = (hasReckless && !attack.isSpell)
			? `<button class="ve-btn ve-btn-sm ${recklessActive ? "ve-btn-warning" : "ve-btn-default"} charsheet__attack-reckless" title="Reckless Attack: advantage on melee weapon attack rolls using Strength; attack rolls against you have advantage until your next turn. Rolls this attack and keeps Reckless active.">
						<span>⚡</span> Reckless
					</button>`
			: "";
		const handsUsedHtml = this._renderHandsUsedToggle(attack);
		const astralBarrageCount = (attack.sourceFeature || "").toLowerCase() === "astral arms"
			&& this._state.isStateTypeActive?.("awakenedAstralSelf")
			? this._getAttackActionAllowance(attack)
			: null;

		return e_({outer: `
			<div class="charsheet__attack-item" data-attack-id="${attack.id}">
				<div class="charsheet__attack-info">
					<span class="charsheet__attack-name">${nameHtml}${badgeHtml}</span>
					<span class="charsheet__attack-details">
						${rangeDisplayHtml}
						<span class="badge badge-primary" title="${atkBadgeTitle}">+${totalAttackBonus}</span>
						<span class="badge badge-danger">${attack.damage}${totalDamageBonus >= 0 ? "+" : ""}${totalDamageBonus} ${attack.damageType}</span>
						${critRangeHtml}
						${propertiesHtml}
						${masteryHtml}
					</span>
					${upgradeNotesHtml}
				</div>
				<div class="charsheet__attack-actions">
					<button class="ve-btn ve-btn-sm ve-btn-primary charsheet__attack-roll" title="Roll Attack">
						<span class="glyphicon glyphicon-screenshot"></span> Attack${astralBarrageCount ? ` (${astralBarrageCount}/action)` : ""}
					</button>
					${recklessBtnHtml}
					<button class="ve-btn ve-btn-sm ve-btn-danger charsheet__attack-damage" title="Roll Damage">
						<span class="glyphicon glyphicon-fire"></span> Damage
					</button>
					${handsUsedHtml}
					${this._renderAmmoSelector(attack, attackIsMelee)}
					${this._renderChannelSpellButton(attack)}
					<button class="ve-btn ve-btn-sm ${this._state.getAttackNote?.(attack.id) ? "ve-btn-warning" : "ve-btn-default"} charsheet__attack-note" title="${this._state.getAttackNote?.(attack.id) ? "Edit Note" : "Add Note"}">
						<span class="glyphicon glyphicon-comment"></span>
					</button>
					${attack.isTemporary || attack.isActiveStateAttack || attack.isFeatureAttack ? "" : `<button class="ve-btn ve-btn-sm ve-btn-default charsheet__attack-edit" title="${isAutoGenerated ? "Edit in Inventory" : "Edit"}">
						<span class="glyphicon glyphicon-pencil"></span>
					</button>`}
					${attack.isActiveStateAttack || attack.isFeatureAttack ? "" : `<button class="ve-btn ve-btn-sm ve-btn-default charsheet__attack-remove" title="${attack.isTemporary ? "Dismiss Temporary Attack" : isAutoGenerated ? "Unequip Weapon" : "Remove"}">
						<span class="glyphicon glyphicon-trash"></span>
					</button>`}
				</div>
			</div>
		`});
	}

	_initAttackHandsListener (container) {
		if (!container?.dataset || !container.addEventListener) return;
		if (container.dataset.handsUsedListener === "true") return;
		container.dataset.handsUsedListener = "true";
		container.addEventListener("click", (event) => {
			const button = event.target.closest(".charsheet__attack-hands-btn");
			if (!button || !container.contains(button)) return;

			const group = button.closest(".charsheet__attack-hands");
			const itemId = group?.dataset.itemId;
			const handsUsed = Number(button.dataset.handsUsed);
			if (!itemId || !this._state.setItemHandsUsed?.(itemId, handsUsed)) {
				JqueryUtil.doToast({type: "warning", content: "Could not update that weapon's hand count."});
				return;
			}

			this.renderAttacks();
			this._page._renderAttacks?.();
			if (this._state.getViewMode?.() === "play") this._page.getPlayMode?.()?.render?.();
			this._page.saveCharacter?.();
		});
	}

	_renderHandsUsedToggle (attack) {
		const weapon = attack?.sourceItem;
		if (!weapon?.id || !weapon.dmg2) return "";

		const parsedHands = Math.floor(Number(weapon.handsUsed));
		const handsUsed = Number.isFinite(parsedHands) && parsedHands >= 2 ? 2 : 1;
		const button = (count) => `<button
			type="button"
			class="charsheet__attack-hands-btn${handsUsed === count ? " charsheet__attack-hands-btn--active" : ""}"
			data-hands-used="${count}"
			aria-pressed="${handsUsed === count}"
			title="Use ${count === 1 ? "one hand" : "two hands"} (${count === 1 ? weapon.dmg1 : weapon.dmg2} damage)"
		>${count}H</button>`;

		return `<div class="charsheet__attack-hands" data-item-id="${weapon.id}" role="group" aria-label="${weapon.name || attack.name}: hands used">
			${button(1)}
			${button(2)}
		</div>`;
	}

	/* -------------------------------------------------------------------------- */
	/* Channeled weapon-attack spells (Booming/Green-Flame Blade)                  */
	/* -------------------------------------------------------------------------- */

	/**
	 * Whether an attack is a melee weapon attack eligible to channel a blade cantrip.
	 * (Spell attacks, ranged-only weapons and thrown ranges are excluded.)
	 * @returns {boolean}
	 */
	_isMeleeWeaponAttack (attack) {
		if (!attack || attack.isSpell) return false;
		if (attack.isUnarmedStrike || attack.isNaturalWeapon) return false;
		if (attack.isRanged === true) return false;
		const rangeStr = attack.range != null ? String(attack.range) : "";
		if (rangeStr.includes("/")) return false; // thrown
		return attack.isMelee || attack.type === "melee" || attack.range === "melee" || (rangeStr !== "" && !rangeStr.includes("/")) || rangeStr === "";
	}

	/**
	 * Render the per-weapon "✨ Channel" button shown on melee weapon attacks when the
	 * character knows at least one weapon-channel cantrip. Empty string otherwise.
	 * @returns {string}
	 */
	_renderChannelSpellButton (attack) {
		const cantrips = this._channelCantripsCache || [];
		if (!cantrips.length) return "";
		if (!this._isMeleeWeaponAttack(attack)) return "";
		const label = cantrips.length === 1 ? cantrips[0].spell.name : "Channel Spell";
		return `<button class="ve-btn ve-btn-sm ve-btn-default charsheet__attack-channel-spell" title="Cast ${label} through this weapon: roll the attack, then arm its on-hit spell damage">
			<span aria-hidden="true">✨</span> Channel
		</button>`;
	}

	/**
	 * Handle the per-weapon ✨ button: pick the cantrip (if more than one is known), roll
	 * the weapon attack, then arm the on-hit rider so the next damage roll carries it.
	 */
	async _onChannelSpellButton (attackId, event) {
		const cantrips = (this._channelCantripsCache && this._channelCantripsCache.length)
			? this._channelCantripsCache
			: (this._page._spells?.getKnownWeaponChannelCantrips?.() || []);
		if (!cantrips.length) return;

		let choice = cantrips[0];
		if (cantrips.length > 1) {
			const picked = await InputUiUtil.pGetUserEnum(/** @type {*} */ ({
				title: "Channel Which Spell?",
				values: cantrips.map(c => c.spell.name),
				isResolveItem: false,
			}));
			if (picked == null) return;
			choice = cantrips[picked];
		}

		// Roll the weapon attack first (this clears any stale rider), THEN arm the new one.
		this._rollAttack(attackId, event);
		this._armChannelSpellRider(attackId, choice);
	}

	/**
	 * Bridge a Spells-tab cast into the same weapon attack and transient rider used by
	 * the Combat-tab channel button.
	 *
	 * @param {{spell: object, spellData: object}} choice
	 * @param {object} [event]
	 * @returns {Promise<boolean>}
	 */
	async pChannelSpellFromCast (choice, event = {}) {
		if (!choice?.spell || !choice?.spellData) return false;
		if (!this._cachedAttacks?.length) this.renderAttacks();

		const eligibleAttacks = (this._cachedAttacks || []).filter(attack => this._isMeleeWeaponAttack(attack));
		if (!eligibleAttacks.length) {
			JqueryUtil.doToast({
				type: "warning",
				content: `${choice.spell.name} requires an equipped melee weapon. Equip one in Inventory, then cast again.`,
			});
			return false;
		}

		let attack = eligibleAttacks[0];
		if (eligibleAttacks.length > 1) {
			const picked = await InputUiUtil.pGetUserEnum(/** @type {*} */ ({
				title: `Channel ${choice.spell.name} Through Which Weapon?`,
				values: eligibleAttacks.map(it => `${it.name} (${it.damage} ${it.damageType})`),
				isResolveItem: false,
			}));
			if (picked == null) return false;
			attack = eligibleAttacks[picked];
		}

		const didRoll = this._rollAttack(attack.id, event);
		if (didRoll === false) return false;
		this._armChannelSpellRider(attack.id, choice);
		return true;
	}

	/**
	 * Clear the transient channeled-spell rider and refresh its section. Single source of
	 * truth for discard (fresh attack roll, post-consume, manual Clear button).
	 */
	_clearPendingSpellRider () {
		this._pendingSpellRider = null;
		this.renderCombatChanneledSpell?.();
	}

	/**
	 * Resolve the channeled-spell on-hit rider damage for a weapon damage roll. Returns the
	 * matching rider (+ its rolled damage) only when an armed rider targets THIS weapon attack
	 * and actually has on-hit dice (≥ level 5); otherwise nulls/zero. Pure aside from the
	 * dice roll — does NOT clear the rider (the caller does, after the roll/animation).
	 * @returns {{channelSpell: (object|null), channelSpellRoll: (object|null), channelSpellDamage: number}}
	 */
	_resolveChannelRiderDamage (attack, attackId, isCrit) {
		const rider = this._pendingSpellRider;
		// A rider "matches" this weapon damage roll if it was armed for this weapon attack
		// (regardless of whether it carries on-hit dice — below level 5 there is none yet).
		const riderMatched = !!(attack && !attack.isSpell && rider?.attackId === attackId);
		const channelSpell = (riderMatched && rider?.dice) ? rider : null;
		if (!channelSpell) return {channelSpell: null, channelSpellRoll: null, channelSpellDamage: 0, riderMatched};
		const maximize = this._state.canApplyPendingDamageMaximization?.(channelSpell.damageType);
		const channelSpellRoll = this._parseDamage(channelSpell.dice, isCrit, {maximize});
		const maximized = maximize && this._state.consumePendingDamageMaximization?.(channelSpell.damageType);
		const triggeredEffects = this._state.getTriggeredDamageEffects?.(channelSpell.damageType) || [];
		return {channelSpell, channelSpellRoll, channelSpellDamage: channelSpellRoll.total, riderMatched, maximized, triggeredEffects};
	}

	/**
	 * Arm the transient on-hit rider for a channeled blade cantrip on a specific weapon.
	 * The rider lives only on the combat instance; it is consumed by the next matching
	 * damage roll and discarded by any fresh attack roll / re-render.
	 */
	_armChannelSpellRider (attackId, choice) {
		const channel = this._page._spells?.getWeaponChannelCantripForCharacter?.(choice.spell, choice.spellData);
		if (!channel) return;

		this._pendingSpellRider = {
			attackId,
			spellName: choice.spell.name,
			dice: channel.onHitDice || null, // null below level 5 (no extra on-hit damage yet)
			damageType: channel.onHitDamageType,
			secondaryLabel: channel.secondaryLabel,
			armedRound: this._state.getCombatRound?.() ?? null,
		};
		this.renderCombatChanneledSpell();

		const onHitStr = channel.onHitDice
			? `+${channel.onHitDice} ${channel.onHitDamageType} on hit`
			: "no extra on-hit damage yet (gained at 5th level)";
		if (typeof JqueryUtil !== "undefined" && JqueryUtil.doToast) {
			JqueryUtil.doToast(/** @type {*} */ ({
				type: "info",
				content: `✨ ${choice.spell.name} channeled — if the attack hits, roll Damage to add ${onHitStr}.`,
			}));
		}
	}

	/**
	 * Additive combat section: shows the currently-armed channeled-spell on-hit rider with
	 * an "if the attack hits" indicator and a manual clear button. Hidden when no rider is
	 * armed. Reads/clears a transient combat-instance field only (never persisted).
	 */
	renderCombatChanneledSpell () {
		const section = document.getElementById("charsheet-combat-channeled-spell-section");
		const container = document.getElementById("charsheet-combat-channeled-spell");
		if (!container) return;

		const rider = this._pendingSpellRider;
		if (!rider) {
			if (section) section.style.display = "none";
			container.innerHTML = "";
			return;
		}

		if (section) section.style.display = "";
		const onHitStr = rider.dice
			? `<span class="badge badge-danger">+${rider.dice} ${rider.damageType}</span> on hit`
			: `<span class="ve-muted">no extra on-hit damage yet (gained at 5th level)</span>`;
		container.innerHTML = `
			<div class="charsheet__channeled-spell-row ve-flex-v-center ve-flex-wrap">
				<span class="mr-2">${csCombatIcon("spark")} <strong>${rider.spellName}</strong> is channeled into your next damage roll — ${onHitStr}.</span>
				<span class="ve-muted ve-small mr-2">${csCombatIcon("weapon")} if the attack hits</span>
				<button class="cs-combat-btn charsheet__channeled-spell-clear" type="button" title="Clear channeled spell">${csCombatIcon("clear")}<span>Clear</span></button>
			</div>
		`;
	}

	/**
	 * Illrigger Baleful Interdict — post-hit "place a seal?" prompt. Surfaced by the
	 * generic post-attack hook pipeline AFTER a weapon attack roll (never alters the
	 * attack/damage math). The player names the creature hit and confirms; placement
	 * spends one seal from the pool and is gated to once per turn. Fully skippable.
	 * @param {*} ctx Post-attack context from `_rollAttack`.
	 * @returns {Promise<void>}
	 */
	async _pPlaceBalefulInterdictSeal (ctx) {
		// Re-validate at prompt time (state may have changed between roll and modal).
		if (!this._state.hasBalefulInterdict?.() || (this._state.getSealsAvailable?.() || 0) <= 0) return;
		if (!this._state.canPlaceSealThisTurn?.()) return;

		const calcs = this._state.getFeatureCalculations?.() || {};
		const dc = calcs.interdictDc;
		const avail = this._state.getSealsAvailable?.() || 0;

		let resolveOuter = null;
		let isResolved = false;
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Baleful Interdict — ${ctx.attack?.name || "Weapon Attack"}`,
			isMinHeight0: true,
			cbClose: () => { if (resolveOuter && !isResolved) { isResolved = true; resolveOuter(); } },
		});

		await new Promise((resolve) => {
			resolveOuter = resolve;
			const finalize = () => { if (isResolved) return; isResolved = true; resolve(); };

			const placeholder = ctx.attack?.name ? `creature hit by ${ctx.attack.name}` : "creature";
			modalInner.innerHTML = `
				<div class="charsheet__interdict-place">
					<p class="mb-2">On a hit you may place a <strong>magical seal</strong> on the target (no action, once per turn). The seal lasts 1 minute or until burned.</p>
					<div class="ve-flex ve-flex-v-center mb-2">
						<label class="mr-2 mb-0">Target:</label>
						<input type="text" class="form-control input-sm charsheet__interdict-target-ipt" placeholder="${placeholder}" style="max-width: 16rem;">
					</div>
					<div class="ve-muted ve-small mb-2">Seals available: <strong>${avail}</strong>${dc != null ? ` &middot; Interdict save DC <strong>${dc}</strong>` : ""}</div>
					<div class="ve-flex ve-flex-h-right gap-2">
						<button class="ve-btn ve-btn-default ve-btn-sm charsheet__interdict-skip" type="button">Skip</button>
						<button class="ve-btn ve-btn-primary ve-btn-sm charsheet__interdict-confirm" type="button">Place Seal</button>
					</div>
				</div>`;

			const ipt = /** @type {HTMLInputElement} */ (modalInner.querySelector(".charsheet__interdict-target-ipt"));
			modalInner.querySelector(".charsheet__interdict-skip")?.addEventListener("click", () => { finalize(); doClose(false); });
			modalInner.querySelector(".charsheet__interdict-confirm")?.addEventListener("click", () => {
				const target = (ipt?.value || "").trim() || (ctx.attack?.name ? `Target of ${ctx.attack.name}` : "Target");
				const placed = this._state.placeSeal?.(target);
				if (placed) {
					JqueryUtil.doToast({type: "success", content: `🔥 Baleful Interdict seal placed on ${placed.target}. Seals left: ${this._state.getSealsAvailable?.()}`});
					this.renderCombatInterdiction();
					this._page.saveCharacter?.();
				} else {
					JqueryUtil.doToast({type: "warning", content: "Could not place a seal (none available, or already placed this turn)."});
				}
				finalize();
				doClose(true);
			});
			setTimeout(() => { try { ipt?.focus(); } catch (e) { /* ignore */ } }, 50);
		});
	}

	/**
	 * Best-effort Passive/Active classification for an interdict boon, from its entry
	 * text; drives the display tag in the panel. Each boon's computed effect is surfaced
	 * separately via {@link CharacterSheetState#getFeatureEffectSummary}, and boons with a
	 * discrete on-sheet effect expose an Apply button (see
	 * {@link CharacterSheetState#applyInterdictBoonActivation}).
	 * @param {object} boon
	 * @returns {"Active"|"Passive"}
	 */
	_getInterdictBoonActivation (boon) {
		const text = JSON.stringify(boon?.entries || boon?.description || "").toLowerCase();
		if (/\b(bonus action|reaction|as an action|you can|when you|you may)\b/.test(text)) return "Active";
		return "Passive";
	}

	/**
	 * Additive combat-tab Interdiction panel (Illrigger Baleful Interdict). Shows the
	 * seal pool (available / max), the Interdict save DC, controls to place / burn / move
	 * seals, and the list of KNOWN interdict boons (name + Passive/Active tag + the boon's
	 * computed effect summary + an Apply button for boons with a discrete on-sheet effect,
	 * e.g. Soul Eater temp HP). Hidden entirely unless the character has Baleful Interdict.
	 */
	renderCombatInterdiction () {
		const section = document.getElementById("charsheet-combat-interdiction-section");
		const container = document.getElementById("charsheet-combat-interdiction");
		if (!container) return;

		if (!this._state.hasBalefulInterdict?.()) {
			if (section) section.style.display = "none";
			container.innerHTML = "";
			return;
		}
		if (section) section.style.display = "";

		const calcs = this._state.getFeatureCalculations?.() || {};
		const dc = calcs.interdictDc;
		const sealDamage = calcs.sealDamage || "1d6";
		const max = this._state.getSealsMax?.() || 0;
		const avail = this._state.getSealsAvailable?.() || 0;
		const placements = this._state.getSealPlacements?.() || [];
		const selectedBoons = this._state.getInterdictBoons?.() || [];
		// (R22 #8) Moloch's Interdiction free boons are always-known and budget-free, so they
		// live OUTSIDE getInterdictBoons() (which feeds the known-boon budget). Surface them
		// in the panel alongside selected boons, deduped, flagged via `_molochGranted`.
		const molochBoons = this._state.getMolochInterdictionBoons?.() || [];
		const seenBoonNames = new Set(selectedBoons.map(b => (b.name || "").toLowerCase()));
		const boons = [...selectedBoons, ...molochBoons.filter(b => !seenBoonNames.has((b.name || "").toLowerCase()))];

		const placementsHtml = placements.length
			? placements.map(p => `
				<div class="charsheet__interdict-seal-row ve-flex ve-flex-v-center ve-flex-wrap gap-1 mb-1" data-placement-id="${p.id}">
					<span class="bold mr-1">${p.target}</span>
					<span class="badge badge-danger" title="Seals on this creature">${p.count} seal${p.count === 1 ? "" : "s"}</span>
					<input type="number" class="form-control input-sm charsheet__interdict-burn-count" min="1" max="${p.count}" value="${p.count}" style="width: 4rem;" title="Seals to burn">
					<select class="form-control input-sm charsheet__interdict-burn-type" style="width: 7rem;" title="Damage type">
						<option value="fire">fire</option>
						<option value="necrotic">necrotic</option>
					</select>
					<button class="cs-combat-btn cs-combat-btn--danger charsheet__interdict-burn" type="button" title="Burn seals: ${sealDamage} per seal when the creature takes damage from another source">${csCombatIcon("fire")}<span>Burn</span></button>
					<button class="cs-combat-btn charsheet__interdict-move" type="button" title="On this creature's death, move all its seals to a new creature within 30 ft (bonus action)">${csCombatIcon("move")}<span>Move</span></button>
				</div>`).join("")
			: `<div class="ve-muted ve-small">No creatures are currently interdicted.</div>`;

		const activatableBoonEntries = this._state.getActivatableFeatures?.() || [];
		const boonsHtml = boons.length
			? boons.map(b => {
				const activation = this._getInterdictBoonActivation(b);
				const badgeCls = activation === "Active" ? "badge-primary" : "badge-secondary";
				let nameHtml = b.name;
				if (this._page?.getHoverLink && b.source) {
					try { nameHtml = this._page.getHoverLink(UrlUtil.PG_OPT_FEATURES, b.name, b.source); } catch (e) { nameHtml = b.name; }
				}
				// (R22 #8) Free boons granted by Moloch's Interdiction are always known and
				// don't count against the boon budget — flag them so the player can tell them
				// apart from selected boons.
				const grantedHtml = b._molochGranted
					? `<span class="badge badge-info charsheet__interdict-boon-granted" title="Free boon granted by Moloch's Interdiction — always known, doesn't count against the boons you know">Moloch's Interdiction</span>`
					: "";
				const summary = this._state.getFeatureEffectSummary?.(b, calcs) || "";
				const summaryHtml = summary
					? `<span class="badge badge-success charsheet__interdict-boon-effect" title="Computed effect">${summary}</span>`
					: "";
				const canActivate = this._state.hasInterdictBoonActivation?.(b.name);
				const canApplyNow = canActivate ? (this._state.canApplyInterdictBoonActivation?.(b.name, calcs) ?? true) : false;
				const applyLabel = canActivate ? (this._state.getInterdictBoonActivationLabel?.(b.name) || "Apply") : "Apply";
				const applyTitle = canActivate
					? (canApplyNow ? `${applyLabel} — apply this boon's effect to your sheet` : "No seals available")
					: "";
				const activateBtn = canActivate
					? `<button class="cs-combat-btn cs-combat-btn--primary charsheet__interdict-boon-activate ml-auto" type="button" data-boon-name="${(b.name || "").replace(/"/g, "&quot;")}" ${canApplyNow ? "" : "disabled"} title="${applyTitle}">${applyLabel}</button>`
					: "";
				// (R22 #6) Durational boons (Veil of Lies, Shadow Shroud, Hellish Frenzy,
				// Hellsight) are named toggle states that expend a seal. Surface a one-click
				// Invoke/End button here so they are usable directly from the Interdiction
				// panel (the canonical home), routed through the same seal-spend + state
				// activation path as the abilities area.
				const boonAf = activatableBoonEntries.find(a => a.feature?.name === b.name && CharacterSheetState.isInterdictBoonEntry?.(a));
				let toggleBtn = "";
				if (boonAf) {
					const nm = (b.name || "").replace(/"/g, "&quot;");
					if (boonAf.isActive) {
						toggleBtn = `<button class="cs-combat-btn cs-combat-btn--danger charsheet__interdict-boon-toggle ml-auto" type="button" data-boon-name="${nm}" title="End this boon's effect">End</button>`;
					} else {
						const canAfford = avail > 0;
						toggleBtn = `<button class="cs-combat-btn cs-combat-btn--primary charsheet__interdict-boon-toggle ml-auto" type="button" data-boon-name="${nm}" ${canAfford ? "" : "disabled"} title="${canAfford ? "Expend a seal to activate this boon" : "No seals available"}">Invoke (1 seal)</button>`;
					}
				}
				return `
					<div class="charsheet__interdict-boon-row ve-flex ve-flex-v-center ve-flex-wrap gap-1 mb-1">
						<span class="bold mr-1">${nameHtml}</span>
						${grantedHtml}
						<span class="badge ${badgeCls} charsheet__interdict-boon-status" title="${activation === "Active" ? "Requires an action/trigger to use" : "Always-on benefit"}">${activation}</span>
						${summaryHtml}
						${toggleBtn || activateBtn}
					</div>`;
			}).join("")
			: `<div class="ve-muted ve-small">No interdict boons known yet.</div>`;

		// Charm Enemy (Illrigger L3): when seal-placing on a Humanoid the target makes a
		// Charisma save or is charmed. The charmed condition lands on the TARGET, never the
		// caster, so it is surfaced here as a tracked target-effect (not a self condition).
		const charmEnemyHtml = calcs.hasCharmEnemy
			? (() => {
				const ceDc = calcs.charmEnemyDc != null ? calcs.charmEnemyDc : dc;
				const ce = (this._state.getResources?.() || []).find(r => (r.name || "").toLowerCase() === "charm enemy");
				const ceMax = ce?.max != null ? ce.max : (calcs.charmEnemyUses != null ? calcs.charmEnemyUses : null);
				const ceCur = ce?.current;
				const usesStr = ceMax != null
					? (ceCur != null ? `${ceCur} / ${ceMax}` : `${ceMax}`)
					: "—";
				const canCharm = ceCur == null || ceCur > 0;
				return `
				<div class="charsheet__interdict-charm mb-2">
					<div class="ve-muted ve-small mb-1">Charm Enemy</div>
					<div class="charsheet__interdict-charm-row ve-flex ve-flex-v-center ve-flex-wrap gap-2">
						<span title="When you seal a Humanoid you may attempt to charm it">${csCombatIcon("charm")}Target makes a <strong>DC ${ceDc != null ? ceDc : "—"}</strong> Charisma save or is <strong>charmed</strong> (1 hour)</span>
						<span class="charsheet__interdict-charm-uses ve-muted ve-small" title="Uses = Charisma modifier (min 1); regained on a long rest">Uses <strong>${usesStr}</strong></span>
						<button class="cs-combat-btn cs-combat-btn--primary charsheet__interdict-charm-use ml-auto" type="button" ${canCharm ? "" : "disabled"} title="${canCharm ? "Spend a use to attempt to charm a sealed Humanoid" : "No uses remaining (regained on a long rest)"}">${csCombatIcon("charm")}<span>Charm a target</span></button>
					</div>
				</div>`;
			})()
			: "";

		// Superior Interdict (Illrigger L14): seal damage ignores resistance + a
		// bonus-action seal regain (1/long rest, only when you have none). Surface both in
		// the panel — the passive note plus a usable Regain button — so the feature isn't a
		// dead "does nothing" entry (R22 #11).
		const superiorInterdictHtml = calcs.hasSuperiorInterdict
			? (() => {
				const canRegain = this._state.canRegainSealViaSuperiorInterdict?.();
				const usedUp = avail <= 0 && !canRegain;
				const title = avail > 0
					? "You can only regain a seal with Superior Interdict when you have none remaining"
					: usedUp
						? "Already used since your last long rest"
						: "Bonus action: regain 1 seal (once per long rest)";
				return `
				<div class="charsheet__interdict-superior mb-2">
					<div class="ve-muted ve-small mb-1">Superior Interdict</div>
					<div class="charsheet__interdict-superior-row ve-flex ve-flex-v-center ve-flex-wrap gap-2">
						<span title="Your seal damage ignores the target's resistances">${csCombatIcon("weapon")}Seal damage <strong>ignores resistance</strong></span>
						<button class="cs-combat-btn cs-combat-btn--primary charsheet__interdict-superior-regain ml-auto" type="button" ${canRegain ? "" : "disabled"} title="${title}">${csCombatIcon("recycle")}<span>Regain a seal (bonus action)</span></button>
					</div>
				</div>`;
			})()
			: "";

		container.innerHTML = `
			<div class="charsheet__interdict-panel">
				<div class="charsheet__interdict-summary ve-flex ve-flex-v-center ve-flex-wrap gap-2 mb-2">
					<span class="charsheet__interdict-dc" title="Interdict save DC = 8 + proficiency + CHA">${csCombatIcon("dc")}Save DC <strong>${dc != null ? dc : "—"}</strong></span>
					<span class="charsheet__interdict-pool" title="Seals refresh on a short or long rest">${csCombatIcon("fire")}Seals <strong>${avail}</strong> / ${max}</span>
					<span class="ve-muted ve-small" title="Burn damage per seal">${sealDamage} per seal</span>
					<button class="cs-combat-btn cs-combat-btn--primary charsheet__interdict-place-btn ml-auto" type="button" ${avail > 0 ? "" : "disabled"} title="Place a seal on a creature (bonus action, or no action on a weapon hit)">Place seal</button>
				</div>
				<div class="charsheet__interdict-seals mb-2">
					<div class="ve-muted ve-small mb-1">Interdicted creatures</div>
					${placementsHtml}
				</div>
				${charmEnemyHtml}
				${superiorInterdictHtml}
				<div class="charsheet__interdict-boons">
					<div class="ve-muted ve-small mb-1">Known interdict boons</div>
					${boonsHtml}
				</div>
			</div>`;

		// --- Superior Interdict: regain a seal (bonus action, 1/long rest) ---
		container.querySelector(".charsheet__interdict-superior-regain")?.addEventListener("click", () => {
			const result = this._state.regainSealViaSuperiorInterdict?.();
			if (!result?.ok) { JqueryUtil.doToast({type: "warning", content: result?.label || "Could not regain a seal."}); return; }
			JqueryUtil.doToast({type: "success", content: result.label});
			this.renderCombatInterdiction();
			this._page.saveCharacter?.();
		});

		// --- Place seal ---
		container.querySelector(".charsheet__interdict-place-btn")?.addEventListener("click", () => {
			void this._pPlaceSealFromPanel();
		});

		// --- Burn seals ---
		container.querySelectorAll(".charsheet__interdict-burn").forEach((btn) => {
			btn.addEventListener("click", () => {
				const row = btn.closest(".charsheet__interdict-seal-row");
				const id = row?.dataset.placementId;
				const count = parseInt(/** @type {HTMLInputElement} */ (row?.querySelector(".charsheet__interdict-burn-count"))?.value || "1", 10);
				const type = /** @type {HTMLSelectElement} */ (row?.querySelector(".charsheet__interdict-burn-type"))?.value || "fire";
				const result = this._state.burnSeals?.(id, count, type);
				if (!result) { JqueryUtil.doToast({type: "warning", content: "Could not burn seals."}); return; }
				let rolled = null;
				try { rolled = this._parseDamage(result.dice, false); } catch (e) { rolled = null; }
				if (rolled && typeof rolled.total === "number") {
					// Animate the ACTUAL seal-damage dice (NdN d6) — not a phantom d20 — and
					// pass an explicit `subtitle` so the result popup's breakdown shows the
					// damage roll. Without a subtitle, showDiceResult defaults the breakdown
					// to a hardcoded "1d20 (…)", which is the d20 players were seeing here.
					const diceGroups = [];
					this._pushDiceGroup(diceGroups, rolled);
					if (diceGroups.length) void this._page.pAnimateDamageDice?.(diceGroups);
					this._page.showDiceResult?.({
						title: `Baleful Interdict — Burn ${result.count} Seal${result.count === 1 ? "" : "s"}`,
						subtitle: `${result.dice} ${result.damageType}`,
						roll: rolled.total,
						total: rolled.total,
						resultClass: "text-danger",
						resultNote: `${result.damageType} damage on ${result.target}`,
					});
				}
				JqueryUtil.doToast({type: "info", content: `Burned ${result.count} seal${result.count === 1 ? "" : "s"} on ${result.target}: ${result.dice} ${result.damageType}${rolled && typeof rolled.total === "number" ? ` → ${rolled.total}` : ""} damage.`});
				this.renderCombatInterdiction();
				this._page.saveCharacter?.();
			});
		});

		// --- Move seals (on death) ---
		container.querySelectorAll(".charsheet__interdict-move").forEach((btn) => {
			btn.addEventListener("click", () => {
				const row = btn.closest(".charsheet__interdict-seal-row");
				const id = row?.dataset.placementId;
				void this._pMoveSealFromPanel(id);
			});
		});

		// --- Apply a boon's discrete on-sheet effect (e.g. Soul Eater temp HP) ---
		container.querySelectorAll(".charsheet__interdict-boon-activate").forEach((btn) => {
			btn.addEventListener("click", async () => {
				const boonName = btn.dataset.boonName || "";
				// (S3 #10) Slippery Ploy is a seal PLACEMENT reaction, not a bare seal-spend —
				// route it to the target-prompt flow so a real, tracked placement is created.
				if (/^slippery ploy$/i.test(boonName.trim())) { await this._pSlipperyPloyPlaceSeal(); return; }
				const result = this._state.applyInterdictBoonActivation?.(boonName);
				if (!result) { JqueryUtil.doToast({type: "warning", content: `No on-sheet effect to apply for "${boonName || "this boon"}".`}); return; }
				JqueryUtil.doToast({type: "success", content: result.label});
				this._page._renderHp?.();
				this.renderCombatInterdiction();
				this._page.saveCharacter?.();
			});
		});

		// --- (R22 #6) Invoke / End a durational interdict boon (spend a seal + toggle the
		// named buff state) directly from the panel. Reuses the canonical features-area
		// invoke path so the seal spend + state activation stay identical everywhere. ---
		container.querySelectorAll(".charsheet__interdict-boon-toggle").forEach((btn) => {
			btn.addEventListener("click", async () => {
				const boonName = btn.dataset.boonName || "";
				const feature = (this._state.getFeatures?.() || []).find(f => (f.name || "") === boonName);
				if (!feature) { JqueryUtil.doToast({type: "warning", content: `Could not find "${boonName}".`}); return; }
				const af = (this._state.getActivatableFeatures?.() || []).find(a => a.feature?.id === feature.id && CharacterSheetState.isInterdictBoonEntry?.(a));
				if (af?.isActive) {
					if (af.stateTypeId) this._state.deactivateState?.(af.stateTypeId);
					JqueryUtil.doToast({type: "info", content: `${boonName} ended.`});
				} else {
					const ok = await this._page._pUseFeatureAbility?.(feature);
					if (!ok) { JqueryUtil.doToast({type: "warning", content: `Could not invoke ${boonName}.`}); return; }
				}
				this._page._renderActiveStates?.();
				this.renderCombatStates?.();
				this.renderCombatInterdiction();
				// (S3 #12) A sense-granting boon (Hellsight → truesight) lives on the boon's
				// active state, so ending it must repaint the Overview senses display — the
				// targeted renders above don't touch it, which left a stale "Truesight 60 ft."
				// row after End. The invoke path already refreshes senses via _renderCharacter.
				this._page._renderSenses?.();
				this._page.saveCharacter?.();
			});
		});

		// --- (R22 #5) Charm Enemy: spend a use and prompt for the sealed Humanoid target,
		// surfacing the save it must make. The charmed condition lands on the TARGET, so we
		// report it rather than apply a self condition. ---
		container.querySelector(".charsheet__interdict-charm-use")?.addEventListener("click", async () => {
			const ce = (this._state.getResources?.() || []).find(r => (r.name || "").toLowerCase() === "charm enemy");
			if (ce && ce.current <= 0) { JqueryUtil.doToast({type: "warning", content: "Charm Enemy has no uses remaining (regained on a long rest)."}); return; }
			const target = await InputUiUtil.pGetUserString({title: "Charm Enemy — name the sealed Humanoid"});
			if (target == null) return;
			if (ce) this._state.setResourceCurrent(ce.id, Math.max(0, ce.current - 1));
			const ceDc = calcs.charmEnemyDc != null ? calcs.charmEnemyDc : dc;
			JqueryUtil.doToast({type: "info", content: `${target || "The target"} must make a DC ${ceDc != null ? ceDc : "—"} Charisma save or be charmed by you for 1 hour.`, autoHideTime: 10000});
			this.renderCombatInterdiction();
			this._page.saveCharacter?.();
		});
	}

	/**
	 * Build the selectable destination list for the Place-seal modal: every currently
	 * interdicted creature (so the player can stack another seal) is offered, and the
	 * caller always also exposes a "new creature" free-text entry. Pure (no DOM) so the
	 * option set is unit-testable.
	 * @returns {Array<{id:string, target:string, count:number}>}
	 */
	_getSealPlaceTargets () {
		return (this._state.getSealPlacements?.() || []).map(p => ({id: p.id, target: p.target, count: p.count}));
	}

	/**
	 * Build the selectable destination list for the Move-seal modal: every interdicted
	 * creature EXCEPT the source placement (you cannot move a creature's seals onto
	 * itself). Pure (no DOM) so the option set is unit-testable.
	 * @param {string} sourceId the placement id whose seals are being moved.
	 * @returns {Array<{id:string, target:string, count:number}>}
	 */
	_getSealMoveTargets (sourceId) {
		return (this._state.getSealPlacements?.() || [])
			.filter(p => p.id !== sourceId)
			.map(p => ({id: p.id, target: p.target, count: p.count}));
	}

	/**
	 * Interdiction-panel "Place seal" flow. Replaces the old bare name-prompt with a
	 * clear modal that explains the action, lists already-interdicted creatures as
	 * one-click "add another seal" options, and offers a free-text field for a new
	 * creature. Placement here is out-of-combat housekeeping, so it bypasses the
	 * once-per-turn gate (force: true), matching the previous panel behaviour.
	 * @returns {Promise<void>}
	 */
	async _pPlaceSealFromPanel () {
		if ((this._state.getSealsAvailable?.() || 0) <= 0) {
			JqueryUtil.doToast({type: "warning", content: "No seals available — take a short or long rest to recover them."});
			return;
		}

		const calcs = this._state.getFeatureCalculations?.() || {};
		const dc = calcs.interdictDc;
		const avail = this._state.getSealsAvailable?.() || 0;
		const existing = this._getSealPlaceTargets();

		const place = (target) => {
			const placed = this._state.placeSeal?.((target || "").trim() || "Target", {force: true});
			if (placed) {
				JqueryUtil.doToast({type: "success", content: `Seal placed on ${placed.target}. Seals left: ${this._state.getSealsAvailable?.()}`});
				this.renderCombatInterdiction();
				this._page.saveCharacter?.();
			} else {
				JqueryUtil.doToast({type: "warning", content: "Could not place a seal."});
			}
		};

		const existingHtml = existing.length
			? `<div class="charsheet__interdict-modal-sublabel">Add a seal to an already-interdicted creature:</div>
				<div class="charsheet__interdict-modal-chips ve-flex ve-flex-wrap gap-1 mb-2">
					${existing.map(p => `<button class="ve-btn ve-btn-default ve-btn-xs charsheet__interdict-place-existing" type="button" data-target="${(p.target || "").replace(/"/g, "&quot;")}">${p.target} <span class="ve-muted">(${p.count})</span></button>`).join("")}
				</div>`
			: "";

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "Place Baleful Interdict Seal",
			isMinHeight0: true,
		});

		modalInner.innerHTML = `
			<div class="charsheet__interdict-place charsheet__interdict-modal">
				<p class="charsheet__interdict-modal-lead">Place a <strong>magical seal</strong> on a creature. The seal lasts 1 minute or until burned for ${calcs.sealDamage || "1d6"} fire or necrotic damage.</p>
				${existingHtml}
				<label class="charsheet__interdict-modal-field">
					<span class="charsheet__interdict-modal-label">${existing.length ? "…or seal a new creature" : "Name the creature to seal"}</span>
					<div class="charsheet__interdict-modal-inputrow ve-flex ve-flex-v-center">
						<input type="text" class="form-control input-sm charsheet__interdict-target-ipt" placeholder="creature name">
						<button class="ve-btn ve-btn-primary ve-btn-sm ml-2 charsheet__interdict-confirm" type="button">Place Seal</button>
					</div>
				</label>
				<div class="charsheet__interdict-modal-meta">Seals available: <strong>${avail}</strong>${dc != null ? ` &middot; Interdict save DC <strong>${dc}</strong>` : ""}</div>
			</div>`;

		modalInner.querySelectorAll(".charsheet__interdict-place-existing").forEach((btn) => {
			btn.addEventListener("click", () => { place(btn.dataset.target); doClose(true); });
		});
		const ipt = /** @type {HTMLInputElement} */ (modalInner.querySelector(".charsheet__interdict-target-ipt"));
		const confirm = () => {
			const target = (ipt?.value || "").trim();
			if (!target) { JqueryUtil.doToast({type: "warning", content: "Enter a creature name (or pick an existing one)."}); return; }
			place(target);
			doClose(true);
		};
		modalInner.querySelector(".charsheet__interdict-confirm")?.addEventListener("click", confirm);
		ipt?.addEventListener("keydown", (e) => { if (e.key === "Enter") confirm(); });
		setTimeout(() => { try { ipt?.focus(); } catch (e) { /* ignore */ } }, 50);
	}

	/**
	 * Interdiction-panel "Move seals" flow (on a sealed creature's death, move all its
	 * seals to a new creature within 30 ft). Replaces the old bare name-prompt with a
	 * modal that names the source creature, lists the OTHER interdicted creatures as
	 * one-click destinations, and offers a free-text field for a brand-new creature.
	 * @param {string} sourceId the placement id whose seals are moving.
	 * @returns {Promise<void>}
	 */
	async _pMoveSealFromPanel (sourceId) {
		const source = (this._state.getSealPlacements?.() || []).find(p => p.id === sourceId);
		if (!source) { JqueryUtil.doToast({type: "warning", content: "Could not find the seals to move."}); return; }

		const destinations = this._getSealMoveTargets(sourceId);

		const move = (target) => {
			const moved = this._state.moveSeals?.(sourceId, (target || "").trim());
			if (moved) {
				JqueryUtil.doToast({type: "success", content: `Seals moved to ${moved.target}.`});
				this.renderCombatInterdiction();
				this._page.saveCharacter?.();
			} else {
				JqueryUtil.doToast({type: "warning", content: "Could not move seals."});
			}
		};

		const destHtml = destinations.length
			? `<div class="charsheet__interdict-modal-sublabel">Move to another interdicted creature:</div>
				<div class="charsheet__interdict-modal-chips ve-flex ve-flex-wrap gap-1 mb-2">
					${destinations.map(p => `<button class="ve-btn ve-btn-default ve-btn-xs charsheet__interdict-move-existing" type="button" data-target="${(p.target || "").replace(/"/g, "&quot;")}">${p.target} <span class="ve-muted">(${p.count})</span></button>`).join("")}
				</div>`
			: "";

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "Move Seals (within 30 ft)",
			isMinHeight0: true,
		});

		modalInner.innerHTML = `
			<div class="charsheet__interdict-place charsheet__interdict-modal">
				<p class="charsheet__interdict-modal-lead">Move all <strong>${source.count} seal${source.count === 1 ? "" : "s"}</strong> from <strong>${source.target}</strong> to another creature within 30 ft (a bonus action on that creature's death).</p>
				${destHtml}
				<label class="charsheet__interdict-modal-field">
					<span class="charsheet__interdict-modal-label">${destinations.length ? "…or move to a new creature" : "Name the new creature"}</span>
					<div class="charsheet__interdict-modal-inputrow ve-flex ve-flex-v-center">
						<input type="text" class="form-control input-sm charsheet__interdict-target-ipt" placeholder="creature name">
						<button class="ve-btn ve-btn-primary ve-btn-sm ml-2 charsheet__interdict-confirm" type="button">Move Seals</button>
					</div>
				</label>
			</div>`;

		modalInner.querySelectorAll(".charsheet__interdict-move-existing").forEach((btn) => {
			btn.addEventListener("click", () => { move(btn.dataset.target); doClose(true); });
		});
		const ipt = /** @type {HTMLInputElement} */ (modalInner.querySelector(".charsheet__interdict-target-ipt"));
		const confirm = () => {
			const target = (ipt?.value || "").trim();
			if (!target) { JqueryUtil.doToast({type: "warning", content: "Enter a creature name (or pick an existing one)."}); return; }
			move(target);
			doClose(true);
		};
		modalInner.querySelector(".charsheet__interdict-confirm")?.addEventListener("click", confirm);
		ipt?.addEventListener("keydown", (e) => { if (e.key === "Enter") confirm(); });
		setTimeout(() => { try { ipt?.focus(); } catch (e) { /* ignore */ } }, 50);
	}

	/**
	 * (S3 #10) Slippery Ploy reaction flow: when a creature targets you, place a seal on
	 * that creature (forcing it to make a Charisma save or retarget / lose the effect). The
	 * seal is a REAL, tracked placement — routed through the shared
	 * {@link CharacterSheetState#applyInterdictBoonActivation} → `placeSeal` path so it spends
	 * a seal AND appears in the interdicted-creatures list. Mirrors the Place-seal modal:
	 * the attacker can be an already-interdicted creature (stack a seal) or a new one.
	 * @returns {Promise<void>}
	 */
	async _pSlipperyPloyPlaceSeal () {
		if ((this._state.getSealsAvailable?.() || 0) <= 0) {
			JqueryUtil.doToast({type: "warning", content: "No seals available — take a short or long rest to recover them."});
			return;
		}

		const calcs = this._state.getFeatureCalculations?.() || {};
		const dc = calcs.slipperyPloyDc != null ? calcs.slipperyPloyDc : calcs.interdictDc;
		const avail = this._state.getSealsAvailable?.() || 0;
		const existing = this._getSealPlaceTargets();

		const place = (target) => {
			const result = this._state.applyInterdictBoonActivation?.("Slippery Ploy", calcs, {target: (target || "").trim() || "Attacker"});
			if (result?.placement) {
				JqueryUtil.doToast({type: "success", content: result.label});
				this.renderCombatInterdiction();
				this._page.saveCharacter?.();
			} else {
				JqueryUtil.doToast({type: "warning", content: "Could not place a Slippery Ploy seal."});
			}
		};

		const existingHtml = existing.length
			? `<div class="ve-muted ve-small mb-1">Add a seal to an already-interdicted creature:</div>
				<div class="ve-flex ve-flex-wrap gap-1 mb-2">
					${existing.map(p => `<button class="ve-btn ve-btn-default ve-btn-xs charsheet__interdict-place-existing" type="button" data-target="${(p.target || "").replace(/"/g, "&quot;")}">${p.target} <span class="ve-muted">(${p.count})</span></button>`).join("")}
				</div>`
			: "";

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "Slippery Ploy — Place a Seal (reaction)",
			isMinHeight0: true,
		});

		modalInner.innerHTML = `
			<div class="charsheet__interdict-place">
				<p class="mb-2">A creature targeted you with an attack, spell, or other magical effect. As a <strong>reaction</strong>, place a seal on it and force a <strong>DC ${dc != null ? dc : "—"}</strong> Charisma save. On a failed save it must choose a new target or lose the attack or effect.</p>
				${existingHtml}
				<div class="ve-muted ve-small mb-1">${existing.length ? "…or seal a new creature:" : "Name the creature to seal:"}</div>
				<div class="ve-flex ve-flex-v-center mb-2">
					<input type="text" class="form-control input-sm charsheet__interdict-target-ipt" placeholder="creature name" style="max-width: 16rem;">
					<button class="ve-btn ve-btn-primary ve-btn-sm ml-2 charsheet__interdict-confirm" type="button">Place Seal</button>
				</div>
				<div class="ve-muted ve-small">Seals available: <strong>${avail}</strong></div>
			</div>`;

		modalInner.querySelectorAll(".charsheet__interdict-place-existing").forEach((btn) => {
			btn.addEventListener("click", () => { place(btn.dataset.target); doClose(true); });
		});
		const ipt = /** @type {HTMLInputElement} */ (modalInner.querySelector(".charsheet__interdict-target-ipt"));
		const confirm = () => {
			const target = (ipt?.value || "").trim();
			if (!target) { JqueryUtil.doToast({type: "warning", content: "Enter a creature name (or pick an existing one)."}); return; }
			place(target);
			doClose(true);
		};
		modalInner.querySelector(".charsheet__interdict-confirm")?.addEventListener("click", confirm);
		ipt?.addEventListener("keydown", (e) => { if (e.key === "Enter") confirm(); });
		setTimeout(() => { try { ipt?.focus(); } catch (e) { /* ignore */ } }, 50);
	}

	/**
	 * Additive combat-tab Infernal Conduit panel (Illrigger L6). Shows the d10 dice pool
	 * (available / max), the interdict save DC, the conduit range, and controls to spend
	 * dice on the Invigorate or Devour effect. The self-side HP swing is applied to the
	 * sheet; the target-side numbers are surfaced for the player/DM to apply manually
	 * (no target entity exists on the character sheet). Hidden unless the character has
	 * Infernal Conduit.
	 */
	renderCombatConduit () {
		const section = document.getElementById("charsheet-combat-conduit-section");
		const container = document.getElementById("charsheet-combat-conduit");
		if (!container) return;

		if (!this._state.hasInfernalConduit?.()) {
			if (section) section.style.display = "none";
			container.innerHTML = "";
			return;
		}
		if (section) section.style.display = "";

		const calcs = this._state.getFeatureCalculations?.() || {};
		const dc = calcs.interdictDc;
		const die = this._state.getInfernalConduitDie?.() || 10;
		const max = this._state.getInfernalConduitMax?.() || 0;
		const avail = this._state.getInfernalConduitAvailable?.() || 0;
		const range = this._state.getInfernalConduitRange?.() || "Touch";
		const improved = this._state.hasInfernalConduitImprovement?.();

		container.innerHTML = `
			<div class="charsheet__conduit-panel">
				<div class="charsheet__conduit-summary ve-flex ve-flex-v-center ve-flex-wrap gap-2 mb-2">
					<span title="Conduit dice refresh on a long rest">${csCombatIcon("blood")} Dice <strong>${avail}</strong> / ${max} <span class="ve-muted">d${die}</span></span>
					<span title="Constitution save DC = 8 + proficiency + CHA">${csCombatIcon("dc")} Save DC <strong>${dc != null ? dc : "—"}</strong></span>
					<span class="ve-muted ve-small" title="Range to touch/affect a creature">Range: <strong>${range}</strong></span>
				</div>
				<div class="charsheet__conduit-controls ve-flex ve-flex-v-center ve-flex-wrap gap-1 mb-2">
					<label class="charsheet__conduit-field">
						<span class="charsheet__conduit-field-label">Dice</span>
						<input type="number" class="form-control input-sm charsheet__conduit-count" min="1" max="${Math.max(1, avail)}" value="1" ${avail > 0 ? "" : "disabled"}>
					</label>
					<label class="charsheet__conduit-field">
						<span class="charsheet__conduit-field-label">Effect</span>
						<select class="form-control input-sm charsheet__conduit-effect" title="Choose the conduit effect">
							<option value="invigorate">Invigorate (heal ally)</option>
							<option value="devour">Devour (drain enemy)</option>
						</select>
					</label>
					<label class="charsheet__conduit-field">
						<span class="charsheet__conduit-field-label">Target save</span>
						<select class="form-control input-sm charsheet__conduit-save" title="Target's Constitution save result">
							<option value="fail">Save failed</option>
							<option value="success">Save succeeded</option>
						</select>
					</label>
					<button class="cs-combat-btn cs-combat-btn--spend charsheet__conduit-spend" type="button" ${avail > 0 ? "" : "disabled"} title="Spend conduit dice and resolve the effect">${csCombatIcon("blood")}<span>Spend</span></button>
				</div>
				<div class="charsheet__conduit-notes">
					<div class="charsheet__conduit-note">
						<span class="charsheet__conduit-note-key charsheet__conduit-note-key--heal">Invigorate</span>
						<span>target heals (fail: full, success: half); you take that-roll necrotic (unpreventable; 0 HP &rarr; unconscious &amp; stabilized).</span>
					</div>
					<div class="charsheet__conduit-note">
						<span class="charsheet__conduit-note-key charsheet__conduit-note-key--drain">Devour</span>
						<span>target takes necrotic (fail: full, success: half); you heal the damage dealt${improved ? "; on a failed save the target gains 1 level of exhaustion" : ""}.</span>
					</div>
				</div>
			</div>`;

		container.querySelector(".charsheet__conduit-spend")?.addEventListener("click", () => {
			if ((this._state.getInfernalConduitAvailable?.() || 0) <= 0) {
				JqueryUtil.doToast({type: "warning", content: "No conduit dice left — take a long rest to recover them."});
				return;
			}
			const count = parseInt(/** @type {HTMLInputElement} */ (container.querySelector(".charsheet__conduit-count"))?.value || "1", 10);
			const effect = /** @type {HTMLSelectElement} */ (container.querySelector(".charsheet__conduit-effect"))?.value || "invigorate";
			const saveResult = /** @type {HTMLSelectElement} */ (container.querySelector(".charsheet__conduit-save"))?.value || "fail";

			// Roll the dice for real in the UI; pass the rolled total to the state so its
			// deterministic-average default is only used in headless/test contexts.
			const n = Math.max(1, Math.min(count || 1, this._state.getInfernalConduitAvailable?.() || 1));
			let rolled = null;
			try { rolled = this._parseDamage(`${n}d${die}`, false); } catch (e) { rolled = null; }
			const rollTotal = rolled && typeof rolled.total === "number" ? rolled.total : undefined;

			const res = this._state.spendInfernalConduitDice?.(n, effect, {saveResult, roll: rollTotal});
			if (!res) { JqueryUtil.doToast({type: "warning", content: "Could not spend conduit dice."}); return; }

			const isInvig = res.effect === "invigorate";
			const targetWord = isInvig ? "heals" : "takes";
			const targetAmt = Math.abs(res.targetHpDelta);
			const selfWord = res.selfHpDelta < 0 ? "take" : "regain";
			const selfAmt = Math.abs(res.selfHpDelta);

			// Animate the ACTUAL NdN conduit dice (e.g. 5d10) and pass an explicit `subtitle`
			// so the result popup's breakdown shows the conduit roll. Without a subtitle,
			// showDiceResult defaults the breakdown to a hardcoded "1d20", which is the d20
			// players were seeing here (same class as the R20-S4 seal-burn fix).
			if (rolled) {
				const diceGroups = [];
				this._pushDiceGroup(diceGroups, rolled);
				if (diceGroups.length) void this._page.pAnimateDamageDice?.(diceGroups);
			}

			this._page.showDiceResult?.({
				title: `Infernal Conduit — ${isInvig ? "Invigorate" : "Devour"} (${res.dice})`,
				subtitle: `${res.dice} necrotic`,
				roll: res.total,
				total: res.total,
				resultClass: isInvig ? "text-success" : "text-danger",
				resultNote: ` Target ${targetWord} ${targetAmt} HP · you ${selfWord} ${selfAmt} HP`,
			});

			let toast = `${isInvig ? "Invigorate" : "Devour"} (${res.dice} → ${res.total}, save ${res.saveResult}): target ${targetWord} ${targetAmt} HP, you ${selfWord} ${selfAmt} HP.`;
			if (res.appliesExhaustion) toast += " Target gains 1 level of exhaustion.";
			if (res.selfDroppedToZero) toast += " You drop to 0 HP — unconscious and stabilized.";
			JqueryUtil.doToast({type: isInvig ? "info" : "success", content: toast});

			this._page.renderCharacter?.();
			this._page.saveCharacter?.();
		});
	}

	/**
	 * Additive combat-tab Combat Masteries panel (Illrigger IllMastery). Surfaces the
	 * interactive masteries — the Lies weapon-type choice and the Inexorable adjacent-hostile
	 * count — plus informational notes for the narrative masteries (Brutal, Lissome) and the
	 * Unfettered range changes. Hidden unless the character has at least one mastery.
	 */
	renderCombatMasteries () {
		const section = document.getElementById("charsheet-combat-masteries-section");
		const container = document.getElementById("charsheet-combat-masteries-panel");
		if (!container) return;

		const calcs = this._state.getFeatureCalculations?.() || {};
		const masteries = this._state.getIllriggerMasteries?.() || [];
		if (!masteries.length) {
			if (section) section.style.display = "none";
			container.innerHTML = "";
			return;
		}
		if (section) section.style.display = "";

		const rows = [];

		// Lies — weapon-type choice (CHA for attack/damage)
		if (calcs.hasLiesMastery) {
			// Offer ALL the character's melee weapons: configured non-spell attacks PLUS
			// equipped melee weapons (which may not yet be configured attacks). Ranged-only
			// weapons are excluded since Lies applies to melee weapons. Deduped by name.
			const fromAttacks = (this._state.getAttacks?.() || [])
				.filter(a => !a.isSpell && !a.isSpellAttack)
				.map(a => a.name);
			const fromEquipped = (this._state.getItems?.() || [])
				.filter(i => i.weapon && i.equipped)
				.filter(i => {
					const props = i.property || i.properties || [];
					const isRangedOnly = props.some(p => p === "A" || (typeof p === "string" && p.startsWith("A|")))
						&& !props.some(p => p === "T" || (typeof p === "string" && p.startsWith("T|")));
					return !isRangedOnly;
				})
				.map(i => i.name);
			const seen = new Set();
			const weapons = [...fromAttacks, ...fromEquipped].filter(w => {
				if (!w) return false;
				const key = w.toLowerCase();
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
			const chosen = this._state.getLiesWeaponType?.() || "";
			const opts = [`<option value="">— none —</option>`]
				.concat(weapons.map(w => `<option value="${(w || "").replace(/"/g, "&quot;")}"${w.toLowerCase() === chosen.toLowerCase() ? " selected" : ""}>${w}</option>`))
				.join("");
			rows.push(`
				<div class="charsheet__mastery-row ve-flex ve-flex-v-center ve-flex-wrap gap-1 mb-2">
					<span class="bold mr-1">${csCombatIcon("weapon")} Lies</span>
					<span class="ve-muted ve-small mr-1">use CHA for attack &amp; damage with</span>
					<select class="form-control input-sm charsheet__mastery-lies" title="Choose a melee weapon type (changeable on a long rest)">${opts}</select>
					<span class="charsheet__mastery-or ve-muted ve-small">or</span>
					<input type="text" class="form-control input-sm charsheet__mastery-lies-custom" placeholder="type a weapon" value="" title="Free-text weapon type (overrides the dropdown)">
				</div>`);
		}

		// Inexorable — adjacent-hostile count (+1 save each, max +5)
		if (calcs.hasInexorableMastery) {
			const cur = this._state.getIllriggerAdjacentHostiles?.() || 0;
			const bonus = this._state.getInexorableSaveBonus?.() || 0;
			rows.push(`
				<div class="charsheet__mastery-row ve-flex ve-flex-v-center ve-flex-wrap gap-1 mb-2">
					<span class="bold mr-1">${csCombatIcon("dc")} Inexorable</span>
					<span class="ve-muted ve-small mr-1">hostiles within 5 ft</span>
					<input type="number" class="form-control input-sm charsheet__mastery-inexorable" min="0" max="5" value="${cur}" style="width: 4rem;" title="+1 to all saves per hostile within 5 ft (max +5)">
					<span class="badge badge-info" title="Current bonus to all saving throws">+${bonus} to saves</span>
				</div>`);
		}

		// Informational / narrative masteries
		const notes = [];
		if (calcs.hasBravadoMastery) notes.push(`<strong>Bravado:</strong> while unarmored, AC = 10 + DEX + CHA (shield allowed) — applied automatically to your AC.`);
		if (calcs.hasBrutalMastery) notes.push(`<strong>Brutal:</strong> on a two-handed melee hit vs a creature no more than one size larger, you may shove it 5 ft and follow into its space.`);
		if (calcs.hasLissomeMastery) notes.push(`<strong>Lissome:</strong> on a melee hit, you may spend your movement to move 5 ft without provoking opportunity attacks.`);
		if (calcs.hasUnfetteredMastery) notes.push(`<strong>Unfettered:</strong> Baleful Interdict range is 60 ft (was 30 ft) and Infernal Conduit range is 30 ft (was touch); ranged attacks within 5 ft of a hostile suffer no disadvantage.`);
		const notesHtml = notes.length ? `<div class="ve-muted ve-small">${notes.map(n => `<div class="mb-1">${n}</div>`).join("")}</div>` : "";

		container.innerHTML = `<div class="charsheet__mastery-panel">${rows.join("")}${notesHtml}</div>`;

		// --- Lies dropdown ---
		container.querySelector(".charsheet__mastery-lies")?.addEventListener("change", (e) => {
			const val = /** @type {HTMLSelectElement} */ (e.target).value || "";
			this._state.setLiesWeaponType?.(val);
			this._page.renderCharacter?.();
			this._page.saveCharacter?.();
		});
		// --- Lies free-text override ---
		container.querySelector(".charsheet__mastery-lies-custom")?.addEventListener("change", (e) => {
			const val = /** @type {HTMLInputElement} */ (e.target).value || "";
			if (!val.trim()) return;
			this._state.setLiesWeaponType?.(val.trim());
			this._page.renderCharacter?.();
			this._page.saveCharacter?.();
		});
		// --- Inexorable count ---
		container.querySelector(".charsheet__mastery-inexorable")?.addEventListener("change", (e) => {
			const val = parseInt(/** @type {HTMLInputElement} */ (e.target).value || "0", 10);
			this._state.setIllriggerAdjacentHostiles?.(val);
			this._page.renderCharacter?.();
			this._page.saveCharacter?.();
		});
	}

	/**
	 * Build the range/reach display for an attack row.
	 *
	 * For melee attacks the effective reach is derived from the character's current
	 * melee reach (state.getAttackReach) plus the weapon "Reach" property. The stored
	 * free-text range string is only overridden when reach is actually modified
	 * (character reach bonus ≠ 0 OR the weapon has the Reach property) and the attack
	 * is not a thrown weapon (range containing "/"). Otherwise the original range is
	 * shown unchanged, so there is no regression for the default 5 ft. case, ranged
	 * weapons, or thrown ranges.
	 *
	 * @param {object} attack
	 * @param {{meleeReach?: number, reachBonus?: number}} [reachCtx]
	 * @returns {{rangeHtml: string, reach: (number|null)}}
	 */
	_buildAttackRangeDisplay (attack, reachCtx = {}) {
		const rawRange = attack.range ? `<span class="ve-muted">${attack.range}</span>` : "";

		const rangeStr = attack.range != null ? String(attack.range) : "";
		const isThrown = rangeStr.includes("/");
		const hasReachProp = (attack.properties || []).some(p => String(p).split("|")[0].toUpperCase() === "R");
		const reachBonus = reachCtx.reachBonus ?? (this._state.getReachBonus?.() ?? 0);
		const attackReachBonus = Number(attack.reachBonus) || 0;
		const reach = this._state.getAttackReach?.(attack, {meleeReach: reachCtx.meleeReach});

		// Only override when melee, not thrown, and reach is actually modified.
		if (reach == null || isThrown || (reachBonus === 0 && !hasReachProp && attackReachBonus === 0)) {
			return {rangeHtml: rawRange, reach};
		}

		const breakdown = [`Base ${CharacterSheetState.BASE_MELEE_REACH} ft`];
		if (reachBonus) breakdown.push(`${reachBonus > 0 ? "+" : ""}${reachBonus} ft (reach modifiers)`);
		if (hasReachProp) breakdown.push(`+${CharacterSheetState.REACH_PROPERTY_BONUS} ft (Reach property)`);
		if (attackReachBonus) breakdown.push(`+${attackReachBonus} ft${attack.reachCondition === "onYourTurn" ? " (on your turn)" : ""}`);
		const title = `Melee reach: ${reach} ft\n${breakdown.join("\n")}`;
		const condition = attack.reachCondition === "onYourTurn" ? " on your turn" : "";
		return {rangeHtml: `<span class="ve-muted" title="${title}">${reach} ft.${condition}</span>`, reach};
	}

	/**
	 * Format a weapon property code to display name
	 * @param {string} prop - Property code like "2H|XPHB" or just "2H"
	 * @returns {string} Formatted property name
	 */
	_formatProperty (prop) {
		// Try using Parser if available
		if (typeof Parser !== "undefined" && Parser.itemPropertyToFull) {
			try {
				return Parser.itemPropertyToFull(prop);
			} catch (e) {
				// Fall back to basic formatting
			}
		}

		// Basic property code mapping
		const propMap = {
			"A": "Ammunition",
			"AF": "Ammunition (Firearm)",
			"F": "Finesse",
			"H": "Heavy",
			"L": "Light",
			"LD": "Loading",
			"R": "Reach",
			"RLD": "Reload",
			"S": "Special",
			"T": "Thrown",
			"2H": "Two-Handed",
			"V": "Versatile",
		};

		// Extract property code (before |)
		const code = prop.split("|")[0].toUpperCase();
		return propMap[code] || code;
	}

	/**
	 * Format a weapon mastery code to display name
	 * @param {string} mastery - Mastery code like "Sap|XPHB"
	 * @returns {string} Formatted mastery name
	 */
	_formatMastery (mastery) {
		// Extract mastery name (before |source)
		const name = mastery.split("|")[0];
		return (/** @type {*} */ (name)).toTitleCase();
	}

	/**
	 * 5etools hover attributes targeting a weapon-mastery PROPERTY on the
	 * `itemMastery` faux-page (e.g. Sap, Cleave, Vex). Mirrors the condition/Dodge
	 * hover pattern used elsewhere in the sheet. Falls back to a plain `title` if the
	 * hover subsystem is unavailable so rendering never breaks.
	 * @param {string} masteryName - Display name of the mastery property (e.g. "Sap").
	 * @param {string} [source] - Source of the mastery property (default XPHB).
	 * @returns {string} Attribute string to splice into an element tag.
	 */
	_getMasteryHoverAttrs (masteryName, source = Parser.SRC_XPHB) {
		try {
			const hash = UrlUtil.encodeForHash([masteryName, source].join(HASH_LIST_SEP));
			return Renderer.hover.getHoverElementAttributes({
				page: "itemMastery",
				source,
				hash,
				isFauxPage: true,
			});
		} catch (e) {
			return `title="Weapon Mastery: ${masteryName}"`;
		}
	}

	/**
	 * Render a single weapon-mastery entry ("Name|Source") as a hoverable element
	 * that opens the mastery property's 5etools tooltip. Default source XPHB.
	 * @param {string} mastery - Mastery entry string (e.g. "Sap|XPHB").
	 * @returns {string} HTML for a hoverable mastery span.
	 */
	_formatMasteryLink (mastery) {
		if (!mastery) return "";
		// Masteries may be plain "Name|Source" strings or object entries ({uid, note}).
		const uid = (typeof mastery === "object") ? mastery.uid : mastery;
		if (!uid) return "";
		const [rawName, rawSource] = String(uid).split("|");
		const name = (/** @type {*} */ (rawName)).toTitleCase();
		const source = rawSource || Parser.SRC_XPHB;
		const attrs = this._getMasteryHoverAttrs(name, source);
		return `<span class="help-subtle charsheet__mastery-link" ${attrs}>${name}</span>`;
	}

	renderDeathSaves () {
		const deathSaves = this._state.getDeathSaves();

		// Render success pips
		document.querySelectorAll(".charsheet__death-save-success .charsheet__death-save-pip").forEach((el, i) => {
			el.classList.toggle("filled", i < deathSaves.successes);
		});

		// Render failure pips
		document.querySelectorAll(".charsheet__death-save-failure .charsheet__death-save-pip").forEach((el, i) => {
			el.classList.toggle("filled", i < deathSaves.failures);
		});

		// C9: Render Disciplined Survivor reroll button + proficiency note
		const calc = this._state.getFeatureCalculations?.() || {};
		const rerollContainer = document.querySelector(".charsheet__death-save-reroll");
		if (rerollContainer) {
			rerollContainer.innerHTML = "";
			if (calc.hasDisciplinedSurvivor) {
				const profBonus = this._state.getProficiencyBonus?.() || 0;
				if (profBonus > 0) {
					rerollContainer.append(e_({outer: `<span class="ve-small ve-muted mr-2">+${profBonus} prof</span>`}));
				}
				const rerollCost = calc.disciplinedSurvivorRerollCost || 1;
				const btn = e_({outer: `<button class="ve-btn ve-btn-xs ve-btn-primary" title="Spend ${rerollCost} Focus Point to reroll a failed death save">Reroll (${rerollCost} Focus)</button>`});
				btn.addEventListener("click", () => {
					const focusPoints = this._state.getKiPointsCurrent?.() || 0;
					if (focusPoints < rerollCost) {
						JqueryUtil.doToast({type: "warning", content: "Not enough Focus Points to reroll!"});
						return;
					}
					this._state.useKiPoint(rerollCost);
					this._rollDeathSave();
					JqueryUtil.doToast({type: "info", content: `Spent ${rerollCost} Focus Point to reroll death save`});
				});
				rerollContainer.append(btn);
			}
		}
	}

	renderCombatSpells () {
		const container = document.getElementById("charsheet-combat-spells");
		const section = document.getElementById("charsheet-combat-spells-section");
		if (!container) return;

		container.innerHTML = "";

		// Get spells - cantrips and prepared attack spells
		const spells = this._state.getSpells();

		// Hide the entire section if character has no spells at all
		if (!spells.length) {
			if (section) section.style.display = "none";
			return;
		}
		if (section) section.style.display = "";

		// Spell attack / save DC. Each spellcasting class has its own ability,
		// so for multiclass casters these can differ — show the shared value when
		// all classes agree, otherwise "Varies" with a per-class tooltip. Gambler
		// uses a dice formula rather than a static value.
		const calcs = this._state.getFeatureCalculations?.();
		const breakdown = this._state.getSpellcastingClassBreakdown?.() || [];

		const elSpellAttack = document.getElementById("charsheet-combat-spell-attack");
		const elSpellDc = document.getElementById("charsheet-combat-spell-dc");

		const fmtAttack = (card) => card.isRolledPrepared && calcs?.gamblerSpellAttackFormula
			? calcs.gamblerSpellAttackFormula
			: `+${card.attackBonus}`;
		const fmtDc = (card) => card.isRolledPrepared && calcs?.gamblerSpellDcFormula
			? calcs.gamblerSpellDcFormula
			: `${card.saveDc}`;

		const applyStat = (el, cards, fmt, fallback) => {
			if (!el) return;
			if (!cards.length) {
				el.textContent = fallback;
				el.removeAttribute("title");
				return;
			}
			const labelled = cards.map(c => `${c.displayName || c.className}: ${fmt(c)}`);
			const distinct = [...new Set(cards.map(fmt))];
			if (distinct.length === 1) {
				el.textContent = distinct[0];
				el.title = cards.length > 1 ? labelled.join(" • ") : "";
			} else {
				el.textContent = "Varies";
				el.title = labelled.join(" • ");
			}
		};

		if (breakdown.length) {
			applyStat(elSpellAttack, breakdown, fmtAttack, "+0");
			applyStat(elSpellDc, breakdown, fmtDc, "10");
		} else {
			const isGambler = calcs?.hasGamblerSpellcasting;
			if (isGambler) {
				if (elSpellAttack) elSpellAttack.textContent = calcs.gamblerSpellAttackFormula;
				if (elSpellDc) elSpellDc.textContent = calcs.gamblerSpellDcFormula;
			} else {
				const spellAttack = this._state.getSpellAttackBonus?.() || 0;
				const spellDC = this._state.getSpellSaveDc?.() || 10;
				if (elSpellAttack) elSpellAttack.textContent = `+${spellAttack}`;
				if (elSpellDc) elSpellDc.textContent = spellDC;
			}
		}

		// Make the spell-attack badge a clickable quick-roll when a flat bonus is
		// rollable (single-class / agreeing multiclass; not Gambler/"Varies").
		this._applySpellAttackRollAffordance(elSpellAttack);

		// Filter to combat-relevant spells: cantrips + prepared leveled spells
		const combatSpells = spells.filter(spell => {
			// Always show cantrips
			if (spell.level === 0) return true;
			// Show prepared leveled spells
			return spell.prepared;
		}).sort((a, b) => {
			// Sort by level, then name
			if (a.level !== b.level) return a.level - b.level;
			return a.name.localeCompare(b.name);
		});

		if (!combatSpells.length) {
			container.innerHTML = `<p class="ve-muted text-center">No prepared spells. Prepare spells from the Spells tab to use them in combat.</p>`;
			return;
		}

		// Group by level
		const spellsByLevel = {};
		combatSpells.forEach(spell => {
			const level = spell.level === 0 ? "Cantrips" : `Level ${spell.level}`;
			if (!spellsByLevel[level]) spellsByLevel[level] = [];
			spellsByLevel[level].push(spell);
		});

		// Get spell slots for display
		const slots = this._state.getSpellSlots();
		const pactSlots = this._state.getPactSlots();

		// Render each group
		Object.entries(spellsByLevel).forEach(([level, levelSpells]) => {
			const group = e_({tag: "div", clazz: "charsheet__combat-spell-group mb-2"});

			// Build level header with slot info
			let slotInfo = "";
			if (level !== "Cantrips") {
				const levelNum = parseInt(level.replace("Level ", ""));
				const slotData = slots[levelNum];
				if (slotData && slotData.max > 0) {
					slotInfo = ` <span class="ve-muted">(${slotData.current}/${slotData.max} slots)</span>`;
				}
				// Also show pact slots if character has them and this is the pact slot level
				if (pactSlots && pactSlots.level === levelNum && pactSlots.max > 0) {
					slotInfo += ` <span class="ve-muted" style="color: #9b59b6">(${pactSlots.current}/${pactSlots.max} pact)</span>`;
				}
			}

			group.append(e_({outer: `<div class="charsheet__combat-spell-level ve-small">${level}${slotInfo}</div>`}));

			levelSpells.forEach(spell => {
				const spellEl = this._renderCombatSpellItem(spell);
				group.append(spellEl);
			});

			container.append(group);
		});
	}

	_renderCombatSpellItem (spell) {
		const isCantrip = spell.level === 0;
		const spellId = spell.id || `${spell.name}|${spell.source}`;

		// Look up full spell data for metamagic and hover
		const spellData = this._page._spells?._allSpells?.find(s => s.name === spell.name && s.source === spell.source);
		const modStats = this._state.getModifiedSpellStats?.(spellData);

		// Create hoverable spell name — uses custom predefined hover with metamagic + rarity/legality
		let spellLink;
		try {
			if (this._page?.getSpellHoverLink) {
				spellLink = this._page.getSpellHoverLink(
					spell.name,
					spell.source || Parser.SRC_XPHB,
					spellData,
					spell,
				);
			} else if (this._page?.getHoverLink) {
				spellLink = this._page.getHoverLink(
					UrlUtil.PG_SPELLS,
					spell.name,
					spell.source || Parser.SRC_XPHB,
				);
			} else {
				spellLink = Renderer.get().render(`{@spell ${spell.name}|${spell.source || "PHB"}}`);
			}
		} catch (e) {
			spellLink = spell.name;
		}

		// Get school full name
		const schoolFull = spell.school ? Parser.spSchoolAbvToFull(spell.school) : "";

		// Build details string — apply tuned passive metamagic stat overrides
		const detailParts = [];
		const castingTime = spell.castingTime || "";
		if (castingTime) detailParts.push(castingTime);

		if (modStats?.range?.changed) {
			detailParts.push(modStats.range.modified);
		} else if (spell.range) {
			detailParts.push(spell.range);
		}

		if (modStats?.duration?.changed) {
			detailParts.push(modStats.duration.modified);
		} else if (spell.duration) {
			detailParts.push(spell.duration);
		}

		const components = spell.components || "";
		if (components) detailParts.push(components);
		const details = detailParts.join(" · ");

		const metamagicNotesHtml = modStats?.notes?.length
			? `<div class="charsheet__metamagic-mod ve-small">${modStats.notes.join(" · ")}</div>`
			: "";

		const el = e_({outer: `
			<div class="charsheet__combat-spell-item" data-spell-id="${spellId}">
				<div class="charsheet__combat-spell-info">
					<div class="charsheet__combat-spell-header">
						<span class="charsheet__combat-spell-name">${spellLink}</span>
						${schoolFull ? `<span class="badge badge-secondary ve-small ml-1">${schoolFull}</span>` : ""}
						${spell.concentration ? `<span class="badge badge-info ve-small ml-1" title="Concentration">C</span>` : ""}
					</div>
					${details ? `<div class="charsheet__combat-spell-details ve-muted ve-small">${details}</div>` : ""}
					${metamagicNotesHtml}
				</div>
				<button class="ve-btn ve-btn-xs ve-btn-success charsheet__combat-spell-cast" data-spell-id="${spellId}" title="Cast Spell">
					<span class="glyphicon glyphicon-flash"></span> Cast
				</button>
			</div>
		`});

		// Add click handler on spell name to show metamagic-aware info modal
		const nameEl = el.querySelector(".charsheet__combat-spell-name");
		if (nameEl && spellData && this._page._spells) {
			nameEl.style.cursor = "pointer";
			nameEl.addEventListener("click", (/** @type {*} */ e) => {
				e.preventDefault();
				e.stopPropagation();
				this._page._spells._showSpellInfoFromData(spellData);
			});
		}

		return el;
	}

	render () {
		// Always refresh state reference from page at start of render
		this._state = this._page.getState();

		// A full re-render means we've left the in-the-moment attack→damage flow (tab switch,
		// long rest, condition toggle, etc.). Discard any armed channeled-spell rider so a
		// stale "if it hits" indicator can't linger across unrelated UI. The arm→damage flow
		// itself never triggers a full render(), so a just-armed rider is never lost mid-cast.
		this._clearPendingSpellRider();

		this._runRenderSteps([
			() => this.renderAttacks(),
			() => this.renderCombatQuiver(),
			() => this.renderCombatConsumables(),
			() => this.renderDeathSaves(),
			() => this.renderCombatChanneledSpell(),
			() => this.renderCombatSpells(),
			() => this.renderCombatMethods(),
			() => this.renderCombatRanger(),
			() => this.renderCombatDruidResources(),
			() => this.renderCombatFighter(),
			() => this.renderCombatVitality(),
			() => this.renderCombatDefenses(),
			() => this.renderCombatConditions(),
			() => this.renderCombatEffects(),
			() => this.renderCombatResources(),
			() => this.renderCombatActions(),
			() => this.renderCombatActionEconomy(),
			() => this.renderCombatMetamagic(),
			() => this.renderCombatStates(),
		]);

		// Render combat stats
		const initiative = this._state.getInitiative();
		const elInitiative = document.getElementById("charsheet-initiative");
		if (elInitiative) elInitiative.textContent = `${initiative >= 0 ? "+" : ""}${initiative}`;
	}

	/**
	 * Run a sequence of combat sub-render steps with per-step error isolation.
	 *
	 * The combat tab paints ~16 independent panels in order. Previously a throw
	 * in any earlier panel aborted the whole chain, so a later panel (e.g. the
	 * Arcane Shot section in renderCombatResources) could silently disappear
	 * because of an unrelated upstream failure. Wrapping each step keeps one
	 * broken panel from suppressing its siblings; failures are logged, never
	 * propagated.
	 * @param {Array<Function>} steps - render methods (called with `this`)
	 */
	_runRenderSteps (steps) {
		for (const step of steps) {
			if (typeof step !== "function") continue;
			try {
				step.call(this);
			} catch (e) {
				// eslint-disable-next-line no-console
				console.error("Combat render step failed:", e);
			}
		}
	}

	/**
	 * Render combat actions - race/class/feat abilities that use action economy
	 * (e.g., Aggressive, Charge, Ram, Breath Weapon, Relentless Endurance, etc.)
	 */
	renderCombatActions () {
		const container = document.getElementById("charsheet-combat-actions");
		const section = document.getElementById("charsheet-combat-actions-section");
		if (!container) return;

		const features = this._state.getFeatures();

		// Filter for combat-relevant features that have action economy
		const combatActions = features.filter(f => {
			const nameLower = f.name?.toLowerCase() || "";

			// (R22 #4) Features with a dedicated panel (Interdiction: Baleful Interdict /
			// Charm Enemy / boons) or passive "<X> Improvement" riders must not also appear
			// in the generic "Abilities" list — they have a canonical home elsewhere.
			if (CharacterSheetState.isHiddenFromGenericAbilitySurfaces(f, features)) return false;

			// Fighter action features own their dedicated Combat-tab section
			// (renderCombatFighter); skip them here so they don't double-render in
			// "Abilities". This must run BEFORE the combat/reaction override short-circuit
			// below (Second Wind / Action Surge are classified "combat") and also covers the
			// "passive" riders (Tactical Mind / Stamina Enthusiast) that fall through to the
			// heuristics.
			if (CharacterSheetCombat.FIGHTER_OWNED_COMBAT_FEATURES.includes(nameLower)) return false;

			// (R37 #5) Pure TOGGLE active-states (Bladesong, Rage, Wild Shape, combat stances)
			// belong EXCLUSIVELY to the Active-States panel, where they are flipped on/off and
			// their resource/uses are tracked. They must not ALSO appear in the generic
			// "Abilities" list — Bladesong was double-surfaced because it carries a bonus-action
			// + limited uses, satisfying the action-economy heuristic below. Explicitly
			// classified abilities / combat / reaction overrides are NOT toggles
			// (detectActivatableFeature returns isToggle:false for them via the classification
			// override branch, which runs BEFORE the ACTIVE_STATE_TYPES toggle loop), so the
			// early-return paths below are unaffected.
			if (CharacterSheetState.detectActivatableFeature(f)?.isToggle) return false;

			// Features explicitly classified as combat actions or reactions via overrides
			// are always included regardless of other heuristics
			const classificationOverride = CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES?.[nameLower];
			if (classificationOverride === "combat" || classificationOverride === "reaction") return true;

			// (S1) Features the sheet classifies as activatable ABILITIES (Healing Hands,
			// War God's Blessing, Guided Strike, Forked Tongue, Purge Toxins, …) must ALSO
			// surface in this generic "Abilities" list. The legacy heuristic below keys off a
			// fragile hardcoded `combatKeywords` roster plus action-economy phrasing, so genuine
			// one-shot abilities whose name isn't hardcoded (Purge Toxins, Guided Strike, Forked
			// Tongue) were silently dropped. Key off the REAL classification instead: an
			// "ability" override, or a resolved limited-use / interdict-boon activatable entry
			// (_getActivatableAbilityForFeature). The panel-hidden (Interdiction-managed /
			// redundant-improvement) and Fighter-owned exclusions already ran above, and combat
			// methods / metamagic are re-checked here, so this surfaces abilities by genuine
			// classification without flooding the list with passive features.
			const isClassifiedAbility = classificationOverride === "ability"
				|| !!this._page?._getActivatableAbilityForFeature?.(f);
			if (isClassifiedAbility) {
				if (CharacterSheetClassUtils.isCombatMethod(f)) return false;
				if (f.optionalFeatureTypes?.includes("MM")) return false;
				return true;
			}

			// Get description - render entries as fallback if description missing
			let desc = f.description;
			if (!desc && f.entries) {
				try {
					desc = Renderer.get().render({entries: f.entries});
				} catch (e) {
					desc = "";
				}
			}
			if (!desc) return false;
			// Strip HTML tags so rendered {@variantrule Bonus Action|XPHB} etc. don't break regex matching
			desc = desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

			// Skip combat methods (they have their own section)
			if (CharacterSheetClassUtils.isCombatMethod(f)) return false;

			// Skip metamagic features (managed via metamagic dashboard)
			if (f.optionalFeatureTypes?.includes("MM")) return false;

			// Exclude non-combat features explicitly
			const excludePatterns = [
				"suggested characteristics",
				"personality trait",
				"ideal",
				"bond",
				"flaw",
				"equipment",
				"tool proficiency",
				"skill proficiency",
				"languages",
				"starting equipment",
				"proficiencies",
				"background feature",
				"feature:",
				"you gain proficiency",
				"you are proficient",
				"you have proficiency",
				"you can speak",
				"you can read",
				"darkvision",
				"creature type",
				"size",
				"speed",
				"ability score",
			];
			if (excludePatterns.some(pattern => nameLower.includes(pattern) || (desc.includes(pattern) && !desc.includes("action")))) {
				// Only exclude if there's no action economy
				if (!/\b(bonus action|as an action|use your action|as a reaction)\b/i.test(desc)) {
					return false;
				}
			}

			// Must have actual action economy to be considered a combat action
			// More strict: require specific action phrasing, not just "you can use"
			const hasActionEconomy = /\b(as a bonus action|bonus action to|as an action|use your action|take the \w+ action|take a bonus action|take a reaction|take an action|as a reaction|use your reaction)\b/i.test(desc);

			// Check for combat-specific keywords in NAME (not description, too broad)
			const combatKeywords = [
				"aggressive", "charge", "ram", "breath weapon", "relentless",
				"fury of the small", "savage attacks", "hellish rebuke", "healing hands",
				"celestial revelation", "infernal legacy", "fey step", "misty step",
				"stone's endurance", "lucky",
				"fighting spirit", "cunning action", "uncanny dodge",
				"tantalizing shivers", // Belly Dancer (TGTT Rogue)
				"patient defense", "step of the wind",
				"flurry of blows", "stunning strike", "deflect missiles", "deflect attacks", "slow fall",
				"hand of healing", "hand of harm", "hand of ultimate mercy",
				"wild shape", "channel divinity", "divine smite", "lay on hands",
				"hex", "hexblade's curse",
				"rage", "reckless attack",
				"bardic inspiration",
				"arcane recovery",
				"tireless",
			];

			const hasCombatKeyword = combatKeywords.some(kw => nameLower.includes(kw));

			// Include if:
			// 1. Has explicit action economy AND (has uses OR combat keyword in name), OR
			// 2. Has combat keyword in name AND has uses
			const hasLimitedUses = f.uses && f.uses.max > 0;

			return (hasActionEconomy && (hasLimitedUses || hasCombatKeyword))
				|| (hasCombatKeyword && (hasLimitedUses || hasActionEconomy));
		});

		// Sort: features with uses first, then by feature type, then by name
		combatActions.sort((a, b) => {
			const aHasUses = a.uses && a.uses.max > 0;
			const bHasUses = b.uses && b.uses.max > 0;
			if (aHasUses && !bHasUses) return -1;
			if (!aHasUses && bHasUses) return 1;

			const typeOrder = ["Species", "Subrace", "Class", "Background", "Other"];
			const aType = typeOrder.indexOf(a.featureType) !== -1 ? typeOrder.indexOf(a.featureType) : 999;
			const bType = typeOrder.indexOf(b.featureType) !== -1 ? typeOrder.indexOf(b.featureType) : 999;
			if (aType !== bType) return aType - bType;

			return (a.name || "").localeCompare(b.name || "");
		});

		// Get limited-use custom abilities
		const customAbilities = this._state.getCustomAbilities?.() || [];
		const limitedAbilities = customAbilities.filter(a => a.mode === "limited");

		// Hide section if no combat actions or custom abilities
		if (!combatActions.length && !limitedAbilities.length) {
			section.style.display = "none";
			return;
		}

		section.style.display = "";
		container.innerHTML = "";

		// Render class/race/feat actions first
		for (const feature of combatActions) {
			// Enrich feature with parsed combat action effects if not already present
			if (!feature.combatActionEffects) {
				const desc = feature.description || "";
				const textClean = desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
				feature.combatActionEffects = CharacterSheetState._parseCombatActionEffects?.(textClean, desc) || null;
			}

			// Merge calculation-driven effects for features with pre-computed data
			const calc = this._state.getFeatureCalculations?.() || {};
			const nameLower = feature.name?.toLowerCase() || "";
			if (nameLower === "wall walk" && calc.wallWalkSpiderClimbEffects) {
				feature.combatActionEffects = {...(feature.combatActionEffects || {}), ...calc.wallWalkSpiderClimbEffects};
			}
			if (nameLower === "instant step" && calc.instantStepEffects) {
				feature.combatActionEffects = {...(feature.combatActionEffects || {}), ...calc.instantStepEffects};
			}
			if (nameLower === "tireless" && calc.tirelessEffects) {
				feature.combatActionEffects = {...(feature.combatActionEffects || {}), ...calc.tirelessEffects};
			}

			const actionEl = this._createCombatActionElement(feature);
			container.append(actionEl);
		}

		// Render limited-use custom abilities
		for (const ability of limitedAbilities) {
			const actionEl = this._createCustomAbilityElement(ability);
			container.append(actionEl);
		}
	}

	/* ====================================================================
	   Action Economy overview (B9) — a read-only "what can I do this turn"
	   division that buckets the character's attacks, spells, features, and
	   custom abilities under Action / Bonus Action / Reaction headers.

	   This aggregates DIRECTLY from four independent sources; it deliberately
	   does NOT reuse the "Available to Activate" activatable filter (which
	   excludes combat/reaction-typed items) nor the renderCombatActions
	   suppression filter (which drops toggles like Bladesong that ARE part of
	   the action economy). It mutates no shared classifier — every read is
	   non-destructive.
	   ==================================================================== */

	/**
	 * Normalize an action-economy cost token to one of "action" | "bonus" |
	 * "reaction" | "free", or null when it carries no turn-economy meaning.
	 * @param {*} value e.g. "bonus", "1 bonus action", "reaction", "action".
	 * @returns {("action"|"bonus"|"reaction"|"free"|null)}
	 */
	_normalizeActionType (value) {
		const s = String(value == null ? "" : value).toLowerCase();
		if (!s) return null;
		if (s.includes("bonus")) return "bonus";
		if (s.includes("reaction")) return "reaction";
		if (s.includes("free") || s.includes("no action")) return "free";
		if (s.includes("action")) return "action";
		return null;
	}

	/**
	 * Bucket a spell's stored casting-time string (e.g. "1 action", "1 bonus",
	 * "1 reaction") to an action-economy cost. Longer-than-turn casts
	 * (minute / hour / round / ritual-only) return null — they are not part of
	 * turn action economy and are excluded from the overview.
	 * @param {*} castingTime
	 * @returns {("action"|"bonus"|"reaction"|null)}
	 */
	_bucketSpellCastingTime (castingTime) {
		const t = this._normalizeActionType(castingTime);
		return t === "action" || t === "bonus" || t === "reaction" ? t : null;
	}

	/**
	 * Positive relevance test: does this feature genuinely carry turn action
	 * economy (so it belongs in the overview)? This is the INVERSE intent of
	 * the renderCombatActions suppression filter — here toggles (Bladesong),
	 * reaction/combat overrides, and resolved activatable abilities all count,
	 * while passive traits (Darkvision, ability bumps) do not. Read-only.
	 * @param {*} feature
	 * @returns {boolean}
	 */
	_isActionEconomyFeature (feature) {
		if (!feature) return false;
		const nameLower = feature.name?.toLowerCase() || "";

		// Metamagic modifies spells rather than costing an independent action;
		// it has its own dashboard and is excluded from the economy overview.
		if (feature.optionalFeatureTypes?.includes("MM")) return false;

		// Explicit classification wins.
		const override = CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES?.[nameLower];
		if (override === "combat" || override === "reaction" || override === "ability") return true;

		// Toggles (Bladesong, stances) and other activatable features carry a
		// real activation cost. detectActivatableFeature returns null for pure
		// passives.
		try {
			if (CharacterSheetState.detectActivatableFeature?.(feature)) return true;
		} catch (e) { /* defensive: never let classification abort aggregation */ }

		// Resolved limited-use / boon abilities (Guided Strike, Purge Toxins, …).
		if (this._page?._getActivatableAbilityForFeature?.(feature)) return true;

		// Fall back to explicit action-economy phrasing in the feature text.
		const text = this._resolveFeatureText(feature);
		return /\b(as an? action|as a bonus action|bonus action to|take a bonus action|use your action|take an action|as a reaction|use your reaction|take a reaction)\b/i.test(text);
	}

	/**
	 * Resolve a feature's descriptive text, preferring `description` and falling
	 * back to rendered `entries`, stripped of markup and lower-cased. Shared by
	 * relevance + classification so the two never disagree on entries-only
	 * features.
	 * @param {*} feature
	 * @returns {string}
	 */
	_resolveFeatureText (feature) {
		let text = feature?.description;
		if (!text && feature?.entries) {
			try { text = Renderer.get().render({entries: feature.entries}); } catch (e) { text = ""; }
		}
		return String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
	}

	/**
	 * Classify a feature's action-economy cost. Honors an explicit reaction
	 * override, then reads the resolved text (description OR entries) so a
	 * reaction/bonus feature whose economy lives in `entries` is not silently
	 * defaulted to Action.
	 * @param {*} feature
	 * @returns {("action"|"bonus"|"reaction"|"free")}
	 */
	_classifyFeatureActionType (feature) {
		const nameLower = feature?.name?.toLowerCase() || "";
		if (CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES?.[nameLower] === "reaction") return "reaction";
		const text = this._resolveFeatureText(feature);
		if (/bonus action/.test(text)) return "bonus";
		if (/reaction/.test(text)) return "reaction";
		if (/no action required|\bfree action\b/.test(text)) return "free";
		return "action";
	}

	/**
	 * Aggregate every turn-usable option the character has into action-economy
	 * buckets. Pure and read-only: no state is mutated and no shared classifier
	 * is touched. Returns `{action, bonus, reaction}`, each an array of
	 * normalized entries `{kind, id, name, source, subtitle, actionType}`.
	 * `kind` ∈ "attack" | "spell" | "feature" | "custom".
	 * @returns {{action: Array<object>, bonus: Array<object>, reaction: Array<object>}}
	 */
	getCombatActionEconomy () {
		const buckets = {action: [], bonus: [], reaction: []};
		const push = (type, entry) => { if (buckets[type]) buckets[type].push(entry); };

		// (1) Attacks — configured + equipped weapons + temporary + active-state.
		// Weapon attacks default to Action; honor any explicit `actionType`
		// (active-state form attacks can be bonus actions).
		const seenAttackNames = new Set();
		const addAttack = (atk, fallbackType) => {
			if (!atk) return;
			const type = this._normalizeActionType(atk.actionType) || fallbackType;
			if (type !== "action" && type !== "bonus" && type !== "reaction") return;
			const damage = atk.damage ? `${atk.damage}${atk.damageType ? ` ${atk.damageType}` : ""}` : "";
			push(type, {
				kind: "attack",
				id: atk.id || atk.name,
				name: atk.name || "Attack",
				source: atk.sourceState || "",
				subtitle: damage || (atk.isSpell ? "Spell attack" : "Weapon attack"),
				actionType: type,
			});
		};

		const configured = this._state.getAttacks?.() || [];
		for (const atk of configured) {
			seenAttackNames.add((atk.name || "").toLowerCase());
			addAttack(atk, "action");
		}
		// Equipped weapons not already configured — name-only (no damage-math
		// duplication; the Attacks panel remains the authority on numbers).
		const items = this._state.getItems?.() || [];
		for (const weapon of items.filter(i => i.weapon && i.equipped)) {
			const key = (weapon.name || "").toLowerCase();
			if (seenAttackNames.has(key)) continue;
			seenAttackNames.add(key);
			addAttack({name: weapon.name, damage: this._state.getWeaponDamageDie(weapon), damageType: weapon.dmgType || weapon.damageType}, "action");
		}
		for (const ta of (this._state.getTemporaryAttacks?.() || [])) addAttack(ta, "action");
		for (const asa of (this._state.getActiveStateAttacks?.() || [])) addAttack(asa, "action");

		// (2) Spells — cantrips + prepared leveled, bucketed by casting time.
		// A spell can appear more than once in the list (granted by several
		// sources, or as both its 2014 and 2024 edition); collapse by name so the
		// overview shows one row per affordance — a player casts "Guidance" once
		// regardless of which edition entry backs it.
		const spells = this._state.getSpells?.() || [];
		const seenSpellKeys = new Set();
		for (const spell of spells) {
			if (spell.level !== 0 && !spell.prepared) continue;
			const type = this._bucketSpellCastingTime(spell.castingTime);
			if (!type) continue;
			const spellKey = (spell.name || "").toLowerCase();
			if (seenSpellKeys.has(spellKey)) continue;
			seenSpellKeys.add(spellKey);
			push(type, {
				kind: "spell",
				id: spell.id || `${spell.name}|${spell.source}`,
				name: spell.name,
				source: spell.source || "",
				subtitle: spell.level === 0 ? "Cantrip" : `Level ${spell.level}`,
				actionType: type,
			});
		}

		// (3) Features — positive relevance test, then classify.
		const features = this._state.getFeatures?.() || [];
		for (const feature of features) {
			if (!this._isActionEconomyFeature(feature)) continue;
			const type = this._classifyFeatureActionType(feature);
			if (type === "free") continue;
			push(type, {
				kind: "feature",
				id: feature.id || feature.name,
				name: feature.name,
				source: feature.featureType || feature.source || "",
				subtitle: this._featureEconomySubtitle(feature),
				actionType: type,
			});
		}

		// (4) Custom abilities — bucket by declared activation action.
		const customAbilities = this._state.getCustomAbilities?.() || [];
		for (const ability of customAbilities) {
			const type = this._normalizeActionType(ability.activationAction);
			if (type !== "action" && type !== "bonus" && type !== "reaction") continue;
			push(type, {
				kind: "custom",
				id: ability.id || ability.name,
				name: ability.name,
				source: "",
				subtitle: ability.mode === "limited" ? "Limited use" : "At will",
				actionType: type,
			});
		}

		return buckets;
	}

	/**
	 * Short trailing descriptor for a feature economy entry — its remaining
	 * uses when limited, else its feature category.
	 * @param {*} feature
	 * @returns {string}
	 */
	_featureEconomySubtitle (feature) {
		if (feature?.uses && feature.uses.max > 0) {
			const cur = feature.uses.current ?? feature.uses.max;
			return `${cur}/${feature.uses.max} uses`;
		}
		return feature?.featureType || "";
	}

	/**
	 * Metadata for the Action Economy overview kinds — one dot glyph + label per
	 * source so a reader can tell an attack from a spell at a glance without the
	 * cost chip carrying the whole load.
	 */
	static get ACTION_ECONOMY_KIND_META () {
		return {
			attack: {label: "Attack", glyph: "⚔"},
			spell: {label: "Spell", glyph: "✦"},
			feature: {label: "Feature", glyph: "★"},
			custom: {label: "Custom", glyph: "✨"},
		};
	}

	/**
	 * Render the Action Economy overview (B9): the character's attacks, spells,
	 * features and custom abilities grouped under Action / Bonus Action /
	 * Reaction. Read-only; the existing Attacks / Combat Spells / Abilities
	 * panels stay the interactive roll/cast surfaces.
	 */
	renderCombatActionEconomy () {
		const section = document.getElementById("charsheet-combat-action-economy-section");
		const container = document.getElementById("charsheet-combat-action-economy");
		if (!container) return;

		const buckets = this.getCombatActionEconomy();
		const total = buckets.action.length + buckets.bonus.length + buckets.reaction.length;

		// Hide the whole panel when the character has nothing to show (matches
		// the sibling combat sections' empty behavior).
		if (!total) {
			if (section) section.style.display = "none";
			container.innerHTML = "";
			return;
		}
		if (section) section.style.display = "";
		container.innerHTML = "";

		const kindMeta = CharacterSheetCombat.ACTION_ECONOMY_KIND_META;
		const columns = [
			{key: "action", chip: "action"},
			{key: "bonus", chip: "bonus"},
			{key: "reaction", chip: "reaction"},
		];

		for (const col of columns) {
			const entries = buckets[col.key];
			const group = e_({tag: "div", clazz: "cs-combat-action-economy__group"});

			const header = e_({outer: `<div class="cs-combat-action-economy__head">${csCombatActionChip(col.chip)}<span class="cs-combat-action-economy__count">${entries.length}</span></div>`});
			group.appendChild(header);

			const list = e_({tag: "div", clazz: "cs-combat-action-economy__list"});
			if (!entries.length) {
				const empty = e_({tag: "div", clazz: "cs-combat-action-economy__empty"});
				empty.textContent = "None";
				list.appendChild(empty);
			} else {
				for (const entry of entries) {
					const meta = kindMeta[entry.kind] || {label: "", glyph: "•"};
					const row = e_({tag: "div", clazz: `cs-combat-action-economy__item cs-combat-action-economy__item--${entry.kind}`});

					const badge = e_({tag: "span", clazz: "cs-combat-action-economy__kind"});
					badge.setAttribute("title", meta.label);
					badge.setAttribute("aria-label", meta.label);
					badge.textContent = meta.glyph;
					row.appendChild(badge);

					// User-controlled strings are set as text (never interpolated
					// into markup) to keep the overview injection-safe.
					const name = e_({tag: "span", clazz: "cs-combat-action-economy__name"});
					name.textContent = entry.name || "";
					row.appendChild(name);

					if (entry.subtitle) {
						const sub = e_({tag: "span", clazz: "cs-combat-action-economy__sub"});
						sub.textContent = entry.subtitle;
						row.appendChild(sub);
					}

					list.appendChild(row);
				}
			}

			group.appendChild(list);
			container.appendChild(group);
		}
	}

	/**
	 * Create an element for a limited-use custom ability
	 */
	_createCustomAbilityElement (ability) {
		const uses = this._state.getCustomAbilityUsesDisplay?.(ability.id);
		if (!uses) return document.createDocumentFragment();

		const activationAction = ability.activationAction || "free";
		const hasActionAvailable = this._isActionTypeAvailable(activationAction);
		const canUseResource = this._state.canUseCustomAbility?.(ability.id) ?? uses.current > 0;
		const canUse = canUseResource && hasActionAvailable;

		// Determine action type
		let actionIcon = "✨";
		let actionType = "Free";
		if (activationAction === "action") {
			actionIcon = "⚔️";
			actionType = "Action";
		} else if (activationAction === "bonus") {
			actionIcon = "⚡";
			actionType = "Bonus Action";
		} else if (activationAction === "reaction") {
			actionIcon = "🔄";
			actionType = "Reaction";
		}

		// Recharge icon
		const rechargeIcon = uses.recharge === "short" ? "☀️" : "🌙";

		// Category badge
		const categories = CharacterSheetState.CUSTOM_ABILITY_CATEGORIES || {};
		const category = categories[ability.category];
		const categoryBadge = category
			? `<span class="badge badge-secondary mr-1 ve-small">${category.icon} ${category.name}</span>`
			: "";

		const action = e_({outer: `
			<div class="charsheet__combat-action-item charsheet__combat-action-item--custom charsheet__combat-action-clickable" 
				data-ability-id="${ability.id}">
				<div class="charsheet__combat-action-header">
					<span class="charsheet__combat-action-icon" title="${actionType}">${ability.icon || actionIcon}</span>
					<span class="charsheet__combat-action-name">${ability.name}</span>
					${categoryBadge}
				</div>
				<div class="charsheet__combat-action-info">
					<div class="charsheet__combat-action-uses">
						<span class="charsheet__combat-action-uses-label">${uses.current}/${uses.max}</span>
						<span class="charsheet__combat-action-uses-recharge" title="${uses.recharge} rest">${rechargeIcon}</span>
					</div>
					<button class="ve-btn ve-btn-xs ve-btn-primary charsheet__combat-action-use" 
						${!canUse ? "disabled" : ""} title="Use this ability">Use</button>
				</div>
			</div>
		`});

		// Click on card to show modal with description
		action.addEventListener("click", (/** @type {*} */ e) => {
			// Don't trigger if clicking the Use button
			if (e.target.classList.contains("charsheet__combat-action-use")) return;
			this._showAbilityModal(ability);
		});

		// Use button handler
		action.querySelector(".charsheet__combat-action-use").addEventListener("click", (/** @type {*} */ e) => {
			e.stopPropagation();
			this._useCustomAbility(ability);
		});

		return action;
	}

	/**
	 * Use a limited-use custom ability
	 */
	_useCustomAbility (ability) {
		const actionType = ability.activationAction || "free";
		if (!this._isActionTypeAvailable(actionType)) {
			const actionName = actionType === "bonus" ? "Bonus Action" : actionType === "reaction" ? "Reaction" : "Action";
			JqueryUtil.doToast({type: "warning", content: `${actionName} already used this round.`});
			return;
		}

		if (!this._state.canUseCustomAbility?.(ability.id)) {
			JqueryUtil.doToast({type: "warning", content: `No uses remaining for ${ability.name}!`});
			return;
		}

		if (this._state.useCustomAbility(ability.id)) {
			this._consumeActionType(actionType);
			// Re-render
			this.renderCombatActions();
			this.renderCombatResources();
			this._page?._renderResources?.();
			this._page?._customAbilities?.render?.();
			this._page?._saveCurrentCharacter?.();

			JqueryUtil.doToast({type: "success", content: `Used ${ability.name}!`});
		}
	}

	/**
	 * Show a modal with ability details
	 */
	_showAbilityModal (ability) {
		const uses = this._state.getCustomAbilityUsesDisplay?.(ability.id);
		const categories = CharacterSheetState.CUSTOM_ABILITY_CATEGORIES || {};
		const category = categories[ability.category];

		// Build effects summary
		let effectsSummary = "";
		if (ability.effects?.length) {
			const effectsList = ability.effects.map(e => {
				if (e.type === "sizeIncrease") return `Size +${e.value || 1} category`;
				if (e.type === "sizeDecrease") return `Size -${e.value || 1} category`;
				if (e.type === "reach") return `Reach +${e.value || 5} ft.`;
				if (e.type?.startsWith("extraDamage:")) return `+${e.dice || "1d6"} ${e.type.replace("extraDamage:", "")} damage`;
				if (e.type?.startsWith("reroll:")) return `Reroll ${e.type.replace("reroll:", "")}`;
				return `${e.type}: ${e.value > 0 ? "+" : ""}${e.value}`;
			});
			effectsSummary = `<div class="mt-2"><strong>Effects:</strong> ${effectsList.join(", ")}</div>`;
		}

		// Build defensive traits summary
		let defenseSummary = "";
		if (ability.defensiveTraits) {
			const parts = [];
			if (ability.defensiveTraits.resistances?.length) {
				parts.push(`Resist: ${ability.defensiveTraits.resistances.join(", ")}`);
			}
			if (ability.defensiveTraits.immunities?.length) {
				parts.push(`Immune: ${ability.defensiveTraits.immunities.join(", ")}`);
			}
			if (parts.length) {
				defenseSummary = `<div class="mt-2"><strong>Defenses:</strong> ${parts.join("; ")}</div>`;
			}
		}

		const modalContent = `
			<div class="charsheet__ability-modal-header">
				<span class="charsheet__ability-modal-icon">${ability.icon || "⚡"}</span>
				<h4 class="charsheet__ability-modal-title">${ability.name}</h4>
				${category ? `<span class="badge badge-secondary ml-2">${category.icon} ${category.name}</span>` : ""}
			</div>
			<div class="charsheet__ability-modal-body">
				<div class="charsheet__ability-modal-description">
					${Renderer.get().render(ability.description || "No description.")}
				</div>
				${effectsSummary}
				${defenseSummary}
				${uses ? `<div class="mt-2"><strong>Uses:</strong> ${uses.current}/${uses.max} (${uses.recharge} rest)</div>` : ""}
			</div>
		`;

		// Create and show modal
		const modal = e_({outer: `
			<div class="modal-overlay charsheet__ability-detail-modal">
				<div class="modal-content charsheet__ability-detail-content">
					<div class="modal-header">
						<button class="modal-close" title="Close">&times;</button>
					</div>
					<div class="modal-body">
						${modalContent}
					</div>
					<div class="modal-footer">
						<button class="ve-btn ve-btn-primary charsheet__ability-modal-use" 
							${!this._state.canUseCustomAbility?.(ability.id) ? "disabled" : ""}>Use Ability</button>
						<button class="ve-btn ve-btn-default charsheet__ability-modal-close">Close</button>
					</div>
				</div>
			</div>
		`});

		modal.querySelectorAll(".modal-close, .charsheet__ability-modal-close").forEach(el => {
			el.addEventListener("click", () => {
				modal.remove();
			});
		});

		modal.querySelector(".charsheet__ability-modal-use").addEventListener("click", () => {
			this._useCustomAbility(ability);
			modal.remove();
		});

		// Close on background click
		modal.addEventListener("click", (/** @type {*} */ e) => {
			if (e.target.classList.contains("modal-overlay")) {
				modal.remove();
			}
		});

		document.body.append(modal);
	}

	/**
	 * Create a combat action element for a feature
	 */
	_createCombatActionElement (feature) {
		const featureId = `${feature.name}-${feature.source || ""}`.replace(/\s+/g, "-").toLowerCase();
		// Suppress the per-feature `uses` counter for Fighter pools whose uses are shown
		// authoritatively as a synthetic combat resource in the Resources section (Second Wind /
		// Arcane Shot / Indomitable). Rendering `feature.uses` here would duplicate that counter
		// (and for Second Wind show the same number twice). Defense-in-depth: even if a save's
		// baked `feature.uses` survived the load migration ((c) in _migrateStalePassiveData),
		// the runtime render still never double-counts.
		const isSyntheticTracked = CharacterSheetState.isSyntheticTrackedResourceFeature?.(feature.name);
		const hasUses = !isSyntheticTracked && feature.uses && feature.uses.max > 0;
		const actionTypeKey = this._getFeatureActionType(feature);
		const actionIsAvailable = this._isActionTypeAvailable(actionTypeKey);
		const usesAvailable = !hasUses || feature.uses.current > 0;
		const canUse = usesAvailable && actionIsAvailable;

		// Determine action type icon
		const desc = feature.description?.toLowerCase() || "";
		let actionIcon = "⚔️";
		let actionType = "Action";
		if (/bonus action/i.test(desc)) {
			actionIcon = "⚡";
			actionType = "Bonus Action";
		} else if (/reaction/i.test(desc)) {
			actionIcon = "🔄";
			actionType = "Reaction";
		} else if (/no action required|free/i.test(desc)) {
			actionIcon = "✨";
			actionType = "Free";
		}

		// Get feature type badge
		const typeBadge = feature.featureType
			? `<span class="badge badge-${this._getFeatureTypeBadgeClass(feature.featureType)} mr-1 ve-small">${feature.featureType}</span>` : "";

		// Build uses display if applicable
		let usesHtml = "";
		if (hasUses) {
			const rechargeIcon = feature.uses.recharge === "short" ? "☀️"
				: (feature.uses.recharge === "long" ? "🌙" : "");
			usesHtml = `
				<div class="charsheet__combat-action-uses">
					<span class="charsheet__combat-action-uses-label">${feature.uses.current}/${feature.uses.max}</span>
					<span class="charsheet__combat-action-uses-recharge" title="${feature.uses.recharge} rest">${rechargeIcon}</span>
				</div>
			`;
		}

		// Get hover link if possible. Delegate to the page's canonical resolver
		// (`_getFeatureHoverLink`) so every feature type — Species/Race Channel-Divinity
		// abilities (War God's Blessing, Healing Hands, Guided Strike), class/subclass
		// features, optional features, and any classified ability carrying its own `entries` —
		// resolves to the SAME hover the Features panel uses. The previous bespoke logic only
		// handled optional-feature and Class shapes, so Species abilities silently degraded to
		// plain text (R22 #4).
		let nameHtml = feature.name;
		if (typeof this._page?._getFeatureHoverLink === "function") {
			try {
				const link = this._page._getFeatureHoverLink(feature);
				if (link) nameHtml = link;
			} catch {
				// Fallback to plain name
			}
		}

		// If no hover link, show description in a tooltip on click
		const tooltipDesc = this._cleanDescriptionForTooltip(feature.description);

		// (R25 #8) Label options that draw on a shared named pool (e.g. Invoke Hell options
		// Honey-Sweet Blades / Turncoat carry `consumes: {name: "Invoke Hell"}`, Divine
		// Manifestation options carry `consumes: {name: "Divine Manifestation"}`) with a badge
		// naming the pool, so the card visually communicates which resource the Use button
		// spends. Generic and data-driven — any option using the `consumes` convention is
		// labelled automatically. Stamina is excluded (it has its own resource surface).
		const poolBadge = (feature.consumes?.name && feature.consumes.name !== "Stamina")
			? `<span class="badge badge-outline-info mr-1 ve-small" title="Consumes ${feature.consumes.name}">${feature.consumes.name}</span>`
			: "";

		const action = e_({outer: `
			<div class="charsheet__combat-action-item charsheet__combat-action-clickable" 
				data-action-id="${featureId}">
				<div class="charsheet__combat-action-header">
					<span class="charsheet__combat-action-icon" title="${actionType}">${actionIcon}</span>
					<span class="charsheet__combat-action-name">${nameHtml}</span>
					${typeBadge}
					${poolBadge}
				</div>
				<div class="charsheet__combat-action-info">
					<span class="badge badge-outline-secondary ve-small mr-1">${actionIcon} ${actionType}</span>
					${usesHtml}
					<button class="ve-btn ve-btn-xs ve-btn-primary charsheet__combat-action-use" data-action-id="${featureId}" title="${canUse ? "Use this ability" : `No ${actionType} available`}" ${canUse ? "" : "disabled"}>Use</button>
				</div>
			</div>
		`});

		// Click on card opens the detail modal
		action.addEventListener("click", (/** @type {*} */ e) => {
			if (e.target.classList.contains("charsheet__combat-action-use")) return;
			this._showCombatActionModal(feature);
		});

		// Add click handler for use button
		action.querySelector(".charsheet__combat-action-use").addEventListener("click", (/** @type {*} */ e) => {
			e.stopPropagation();
			this._useCombatAction(feature);
		});

		return action;
	}

	/**
	 * Get badge class for feature type
	 */
	_getFeatureTypeBadgeClass (featureType) {
		switch (featureType) {
			case "Species":
			case "Subrace":
				return "info";
			case "Class":
				return "primary";
			case "Background":
				return "secondary";
			default:
				return "light";
		}
	}

	/**
	 * Use a combat action (spend a use if applicable, deduct ki/focus/stamina)
	 */
	async _useCombatAction (feature) {
		try {
			const actionType = this._getFeatureActionType(feature);
			if (!this._isActionTypeAvailable(actionType)) {
				const actionName = actionType === "bonus" ? "Bonus Action" : actionType === "reaction" ? "Reaction" : "Action";
				JqueryUtil.doToast({type: "warning", content: `${actionName} already used this round.`});
				return;
			}

			// (R25) Route classified activatable ABILITIES through the SAME canonical pipeline
			// the Features tab uses (_pUseFeatureAbility → _pHandleR20FeatureActivation → the
			// generic limited-use / shared-pool / stamina consumption). This is where the
			// specialized effects live — Guided Strike's weapon-attack chooser + roll +10,
			// Forked Tongue's language-swap modal, the shared Divine Manifestation / Invoke Hell
			// pool decrement, manifestation save prompts, and stamina-spending abilities such as
			// Purge Toxins. The legacy Monk-centric fall-through below never reached that
			// pipeline, so those abilities silently no-op'd from the Abilities-tab card. The card
			// only owns action economy; the pipeline owns the ability's use/resource consumption.
			// Keyed off the genuine classification (_getActivatableAbilityForFeature), not names,
			// so every current and future classified ability routes here automatically. Monk
			// abilities (Patient Defense, Flurry of Blows, Hand of Healing/Harm, Step of the Wind,
			// Whirlpool Strike) are NOT classified activatable abilities and fall through unchanged.
			if (this._page?._getActivatableAbilityForFeature?.(feature)) {
				const handled = await this._page._pUseFeatureAbility(feature);
				if (handled) {
					this._consumeActionType(actionType);
					this.renderCombatActions();
					this.renderCombatResources();
					this._page._renderFeatures?.();
					this._page._renderResources?.();
					this._page._saveCurrentCharacter?.();
				}
				return;
			}

			if (feature.uses && feature.uses.current <= 0) {
				JqueryUtil.doToast({type: "warning", content: `No uses remaining for ${feature.name}!`});
				return;
			}

			let combatActionEffects = feature.combatActionEffects;
			const damageTypeChoices = combatActionEffects?.rollDice?.damageTypeChoices;
			if (damageTypeChoices?.length) {
				const chosenDamageType = await InputUiUtil.pGetUserEnum({
					title: `${feature.name} — Choose Damage Type`,
					values: damageTypeChoices,
					fnDisplay: it => it.charAt(0).toUpperCase() + it.slice(1),
					isResolveItem: true,
				});
				if (!chosenDamageType) return;
				combatActionEffects = {
					...combatActionEffects,
					rollDice: {...combatActionEffects.rollDice, damageType: chosenDamageType},
				};
			}

			// Check and deduct ki/focus cost from description
			const calc = this._state.getFeatureCalculations?.() || {};
			const nameLower = feature.name?.toLowerCase() || "";
			const requiredAttack = nameLower === "radiant sun bolt"
				? {sourceFeature: "Radiant Sun Bolt", label: "a Radiant Sun Bolt attack"}
				: nameLower === "searing arc strike"
					? {label: "the Attack action"}
					: null;
			if (requiredAttack && !this._hasQualifyingAttackThisTurn(requiredAttack)) {
				JqueryUtil.doToast({
					type: "warning",
					content: `${feature.name} requires ${requiredAttack.label} earlier this turn.`,
				});
				return;
			}
			const variableSpendConfig = this._getVariablePointSpendConfig(feature, calc);
			const variableSpend = variableSpendConfig
				? await this._pChooseVariablePointSpend(feature, variableSpendConfig)
				: null;
			if (variableSpendConfig && variableSpend == null) return;

			// Hand of Healing/Harm manage their own focus cost inside their handlers
			const selfManagedCost = nameLower === "hand of healing"
				|| nameLower === "hand of harm"
				|| !!variableSpendConfig;

			const kiCost = selfManagedCost ? 0 : this._parseResourceCost(feature, "ki");
			const focusCost = selfManagedCost ? 0 : this._parseResourceCost(feature, "focus");
			const staminaCost = selfManagedCost ? 0 : this._parseResourceCost(feature, "stamina");
			let resourceCost = variableSpendConfig ? variableSpend : (kiCost || focusCost || staminaCost);

			// Unhindered Flurry (TGTT level 8+): Flurry of Blows costs 0 focus
			if (nameLower === "flurry of blows" && calc.hasUnhinderedFlurry) {
				resourceCost = 0;
			}

			if (resourceCost > 0) {
				if (variableSpendConfig || kiCost > 0 || focusCost > 0) {
					const amount = variableSpendConfig ? variableSpend : (kiCost || focusCost);
					if (!this._state.useKiPoint(amount)) {
						const pointName = variableSpendConfig?.resourceName?.toLowerCase() || (focusCost > 0 ? "focus" : "ki");
						JqueryUtil.doToast({type: "warning", content: `Not enough ${pointName} points for ${feature.name}!`});
						return;
					}
				} else if (staminaCost > 0) {
					if (this._state.canUseFocusForStamina?.()) {
						if (!this._state.useFocusForStamina(staminaCost)) {
							JqueryUtil.doToast({type: "warning", content: `Not enough focus/stamina for ${feature.name}!`});
							return;
						}
					} else {
						JqueryUtil.doToast({type: "warning", content: `No stamina resource available for ${feature.name}!`});
						return;
					}
				}
			}

			// Spend a use if this feature has uses
			if (feature.uses) {
				feature.uses.current--;
			}

			this._consumeActionType(actionType);

			// Update state
			const features = this._state.getFeatures();
			const idx = features.findIndex(f => f.name === feature.name && f.source === feature.source);
			if (idx >= 0 && feature.uses) {
				features[idx].uses = feature.uses;
				// Keep any mirrored resource (e.g. Tireless) in sync with feature uses
				const fid = features[idx].id;
				if (fid) this._state.setFeatureUses(fid, feature.uses.current);
			}

			// Apply combat action effects (conditions, temp HP, state activation)
			// Sun Soul features drive their own attack/save/damage execution
			// below, so the generic effect applier must not double-fire them.
			const isManagedSunSoulAction = ["radiant sun bolt", "searing arc strike", "searing sunburst"].includes(nameLower);
			if (combatActionEffects && !isManagedSunSoulAction) {
				this._applyCombatActionEffects(feature, combatActionEffects);
			}

			if (nameLower === "radiant sun bolt") {
				this._executeFeatureAttackVolley(feature, {
					attack: this._state.getFeatureGrantedAttacks?.().find(it => it.sourceFeature === "Radiant Sun Bolt"),
					count: calc.radiantSunBoltBonusActionAttacks || 2,
				});
			}

			if (nameLower === "searing arc strike") {
				const spellLevel = Math.max(1, resourceCost - 1);
				this._executeFeatureSaveDamage(feature, {
					dc: calc.searingArcStrikeDc || calc.kiSaveDc || calc.focusSaveDc,
					saveAbility: "dex",
					damage: `${spellLevel + 2}d6`,
					damageType: "fire",
					label: `Burning Hands (level ${spellLevel})`,
				});
			}

			if (nameLower === "searing sunburst") {
				this._executeFeatureSaveDamage(feature, {
					dc: calc.searingSunburstDc || calc.kiSaveDc || calc.focusSaveDc,
					saveAbility: "con",
					damage: `${2 + (resourceCost * 2)}d6`,
					damageType: "radiant",
					label: "Searing Sunburst",
				});
			}

			// Monk: Patient Defense — activate toggle state (disadvantage on attacks, advantage on DEX saves)
			if (nameLower === "patient defense") {
				this._state.activateState("patientDefense");
				this._page._renderActiveStates?.();
			}

			// Monk: Flurry of Blows — roll unarmed strike attacks
			// Await so Hand of Harm prompt completes before re-render/toast
			if (nameLower === "flurry of blows") {
				const flurryOk = await this._executeFlurryOfBlows(feature, calc);
				if (flurryOk === false) {
					// User cancelled the choice modal — refund resources
					if (resourceCost > 0) this._state.setKiPointsCurrent(this._state.getKiPointsCurrent() + resourceCost);
					if (feature.uses) feature.uses.current++;
					if (this._state.isInCombat?.() && actionType && this._turnActionUsage) {
						this._turnActionUsage[actionType] = false;
					}
					this.renderCombatActions();
					this.renderCombatResources();
					this._page._renderResources?.();
					return;
				}
			}

			// Monk: Step of the Wind — activate speed-doubling state
			if (nameLower === "step of the wind") {
				this._state.activateState("stepOfTheWind");
				this._page._renderActiveStates?.();
				this._page._renderCombatStats?.();
			}

			// Monk: Hand of Healing — handler manages its own focus cost
			if (nameLower === "hand of healing") {
				await this._executeHandOfHealing(calc);
			}

			// Monk: Hand of Harm — handler manages its own focus cost
			if (nameLower === "hand of harm") {
				this._executeHandOfHarm(calc);
			}

			// C11: Whirlpool Strike — show multi-target workflow
			if (nameLower === "whirlpool strike") {
				await this._showWhirlpoolStrikeModal(feature);
			}

			// Re-render
			this.renderCombatActions();
			this.renderCombatResources();
			this._page._renderFeatures?.();
			this._page._renderResources?.();
			this._page._saveCurrentCharacter?.();

			// Toast notification
			const remaining = feature.uses?.current;
			const remainingText = feature.uses ? ` (${remaining}/${feature.uses.max} remaining)` : "";
			const costText = resourceCost > 0
				? ` (${resourceCost} ${variableSpendConfig?.resourceName?.toLowerCase() || (kiCost ? "ki" : focusCost ? "focus" : "stamina")} spent)`
				: "";
			JqueryUtil.doToast({
				type: "success",
				content: `Used ${feature.name}!${remainingText}${costText}`,
			});
		} catch (ex) {
			// eslint-disable-next-line no-console
			console.error(`[CharSheet] Error using combat action "${feature?.name}":`, ex);
			JqueryUtil.doToast({type: "danger", content: `Error using ${feature?.name}: ${ex.message}`});
		}
	}

	// region Combat Action Effects Pipeline

	/**
	 * Apply combat action effects after resource deduction.
	 * Processes conditions, temp HP, state activation, and dice rolls.
	 * @param {object} feature - The feature being used
	 * @param {object} effects - The combatActionEffects object
	 */
	_applyCombatActionEffects (feature, effects) {
		if (!effects) return;

		// Apply condition (e.g., Instant Step → invisible)
		if (effects.applyCondition) {
			const cond = effects.applyCondition;
			// Only conditions the action inflicts on the CASTER are tracked on this
			// sheet. Target-applied conditions (cond.self === false, e.g. Charm Enemy's
			// "the target ... or be charmed") must NOT be added to the character — that
			// would wrongly charm/stun/etc. the Illrigger themselves. Surface them as an
			// informational prompt instead so the player can enforce the target's save.
			if (cond.self === false) {
				const durationText = cond.duration ? ` (${cond.duration})` : "";
				JqueryUtil.doToast({
					type: "info",
					content: `${feature.name}: Target is ${cond.name}${durationText} on a failed save.`,
				});
			} else {
				const added = this._state.addCondition?.({
					name: cond.name,
					source: feature.name,
				}, {resolveThelemarVariant: true});
				if (added) {
					const durationText = cond.duration ? ` (${cond.duration})` : "";
					JqueryUtil.doToast({
						type: "info",
						content: `${feature.name}: Applied ${cond.name}${durationText}`,
					});
				}
			}
		}

		// Activate a toggle state (e.g., a stance)
		if (effects.activateState) {
			this._page._activateState?.(effects.activateState);
		}

		// Grant temporary HP
		if (effects.grantTempHp) {
			const tempHp = this._resolveTempHp(effects.grantTempHp, feature);
			if (tempHp > 0) {
				const currentTemp = this._state.getTempHp?.() || 0;
				// Temp HP doesn't stack — use the higher value
				if (tempHp > currentTemp) {
					this._state.setTempHp?.(tempHp);
					JqueryUtil.doToast({
						type: "info",
						content: `${feature.name}: Gained ${tempHp} temporary HP`,
					});
				}
			}
		}

		// Remove a condition
		if (effects.removeCondition) {
			const removed = this._state.removeCondition?.(effects.removeCondition);
			if (removed) {
				JqueryUtil.doToast({
					type: "info",
					content: `${feature.name}: Removed ${effects.removeCondition}`,
				});
			}
		}

		// Roll dice (damage, healing, etc.)
		if (effects.rollDice) {
			this._rollCombatActionDice(feature, effects.rollDice);
		}
	}

	/**
	 * Resolve a temp HP formula to a concrete number.
	 * Supports static numbers and simple formulas like "1d8+WIS".
	 * @param {object} config - {formula: string} or {value: number}
	 * @param {object} feature - The source feature (for context)
	 * @returns {number} Resolved temp HP value
	 */
	_resolveTempHp (config, feature) {
		if (typeof config.value === "number") return config.value;
		if (!config.formula) return 0;

		// Parse dice formula: NdX+MOD
		const diceMatch = config.formula.match(/(\d+)d(\d+)(?:\s*\+\s*(\w+))?/i);
		if (diceMatch) {
			const numDice = parseInt(diceMatch[1]);
			const dieSize = parseInt(diceMatch[2]);
			const modStr = diceMatch[3];
			let roll = 0;
			for (let i = 0; i < numDice; i++) {
				roll += (typeof RollerUtil !== "undefined" ? RollerUtil.randomise(dieSize) : Math.ceil(Math.random() * dieSize));
			}
			let mod = 0;
			if (modStr) {
				const abilityMod = this._state.getAbilityMod?.(modStr.toLowerCase());
				mod = typeof abilityMod === "number" ? abilityMod : (parseInt(modStr) || 0);
			}
			return roll + mod;
		}

		// Static number
		const num = parseInt(config.formula);
		return isNaN(num) ? 0 : num;
	}

	/**
	 * Roll dice for a combat action and display the result.
	 * Supports attack rolls (d20 with bonus), save prompts (DC display), and damage dice.
	 * @param {object} feature - The feature being used
	 * @param {object} diceConfig - Configuration for the roll
	 * @param {string} [diceConfig.type] - "attack", "save", "damage", "healing"
	 * @param {string} [diceConfig.formula] - Dice formula (e.g., "2d6+3")
	 * @param {string} [diceConfig.label] - Display label for the roll
	 * @param {number} [diceConfig.dc] - DC for save-type rolls
	 * @param {string} [diceConfig.saveAbility] - Ability for save-type rolls
	 * @param {number} [diceConfig.attackBonus] - Bonus for attack-type rolls
	 * @param {"advantage"|"disadvantage"|"normal"} [diceConfig.mode] - Roll mode
	 */
	_rollCombatActionDice (feature, diceConfig) {
		if (!diceConfig) return;

		const type = diceConfig.type || "damage";

		if (type === "attack") {
			const bonus = diceConfig.attackBonus || 0;
			const mode = diceConfig.mode || "normal";
			const result = this._page.rollD20?.({mode}) || {roll: 10, roll1: 10, roll2: 10, mode};
			const total = result.roll + bonus;
			const bonusStr = bonus >= 0 ? `+${bonus}` : `${bonus}`;
			const modeNote = mode !== "normal" ? ` (${mode})` : "";
			void this._page.pAnimateD20?.(result);
			this._page._showDiceResult?.(
				`${feature.name} — Attack Roll`,
				total,
				`d20(${result.roll}) ${bonusStr}${modeNote}`,
				result.roll === 20 ? "charsheet__dice-crit" : result.roll === 1 ? "charsheet__dice-fumble" : "",
			);
			return {type: "attack", total, roll: result.roll, isNat20: result.roll === 20, isNat1: result.roll === 1};
		}

		if (type === "save") {
			const dc = diceConfig.dc || 10;
			const ability = diceConfig.saveAbility || "con";
			const abilityName = ability.charAt(0).toUpperCase() + ability.slice(1).toUpperCase();
			this._page._showDiceResult?.(
				`${feature.name} — Save Required`,
				`DC ${dc}`,
				`${abilityName} saving throw`,
			);
			return {type: "save", dc, saveAbility: ability};
		}

		if (type === "damage" || type === "healing") {
			const formula = diceConfig.formula;
			if (!formula) return null;
			const damageType = diceConfig.damageType || null;
			const shouldMaximize = type === "damage" && this._state.canApplyPendingDamageMaximization?.(damageType);
			const result = this._parseDamage(formula, false, {maximize: shouldMaximize});
			if (shouldMaximize) this._state.consumePendingDamageMaximization?.(damageType);
			const label = diceConfig.label || (type === "healing" ? "Healing" : "Damage");
			const saveDc = diceConfig.saveAbility ? (diceConfig.dc || this._state.getSpellSaveDC?.("Cleric")) : null;
			const triggered = type === "damage" ? (this._state.getTriggeredDamageEffects?.(damageType) || []) : [];
			const push = triggered.find(it => it.type === "forcedMovement");
			const detailParts = [`${formula} = [${result.rolls.join(", ")}]`];
			if (damageType) detailParts.push(damageType);
			if (saveDc) detailParts.push(`DC ${saveDc} ${diceConfig.saveAbility.toUpperCase()} save`);
			if (shouldMaximize) detailParts.push("maximized");
			if (push) detailParts.push(`may push a ${push.maxTargetSize} or smaller target up to ${push.distance} ft ${push.direction}`);
			const animGroups = [];
			this._pushDiceGroup(animGroups, result);
			void this._page.pAnimateDamageDice?.(animGroups);
			this._page._showDiceResult?.(
				`${feature.name} — ${label}`,
				result.total,
				detailParts.join(" • "),
			);
			return {type, total: result.total, rolls: result.rolls, damageType, maximized: shouldMaximize, triggeredEffects: triggered};
		}

		return null;
	}

	/**
	 * Show a choice modal for combat actions with multiple sub-options.
	 * Used for abilities like Flurry of Healing/Harm where the user picks a variant.
	 * @param {object} feature - The parent feature
	 * @param {Array<{name: string, description?: string, effects?: object, id?: string}>} choices - Available sub-actions
	 * @param {Function} [onChoice] - Callback receiving the chosen option
	 * @returns {Promise<object|null>} The chosen option, or null if cancelled
	 */
	async _showCombatActionChoiceModal (feature, choices, onChoice) {
		if (!choices?.length) return null;

		// Capture the trigger BEFORE the modal opens (the site util blurs it),
		// so focus can return there when the choice is made or cancelled.
		const trigger = (typeof document !== "undefined" && document.activeElement) || null;

		const {eleModalInner: modalInner, doClose, pGetResolved} = await CharacterSheetModal.pGetShow({
			title: `${feature.name} — Choose`,
			isMinHeight0: true,
			zIndex: 10003,
			isUncappedHeight: true,
		});

		let resolved = null;

		for (const choice of choices) {
			const btn = e_({outer: `<button class="ve-btn ve-btn-default w-100 mb-2 text-left p-2">
				<div class="bold">${choice.name}</div>
				${choice.description ? `<div class="ve-muted ve-small mt-1">${choice.description}</div>` : ""}
			</button>`});

			btn.addEventListener("click", () => {
				resolved = choice;
				if (onChoice) onChoice(choice);
				doClose(true);
			});

			modalInner.append(btn);
		}

		// Dismiss button — "Close" (not "Cancel"): backing out of a choice modal
		// discards nothing, so it reads like the other use/info modals' Close.
		const cancelBtn = e_({outer: `<button class="ve-btn ve-btn-default w-100 mt-2">Close</button>`});
		cancelBtn.addEventListener("click", () => doClose(false));
		modalInner.append(cancelBtn);

		// Move keyboard focus into the dialog so it's operable without a mouse.
		csFocusModalOnOpen(modalInner);

		await pGetResolved();
		csRestoreModalFocus(trigger);
		return resolved;
	}

	// endregion

	// region Feature-Specific Modal Flows (Phase C)

	/**
	 * Execute Flurry of Blows: roll unarmed strike attacks.
	 * 2 strikes normally, 3 with Heightened Focus (level 10+).
	 * If the monk has Flurry of Healing and Harm, shows a choice modal
	 * to replace one strike with Hand of Healing or Hand of Harm.
	 * If Hand of Harm is available, prompts after hits.
	 */
	async _executeFlurryOfBlows (feature, calc) {
		const unarmedStrike = this._state.getUnarmedStrike?.();
		if (!unarmedStrike) return;

		let strikes = calc.heightenedFlurryAttacks || 2;

		// Mercy Monk: unified choice modal before rolling
		// Level 3+: Hand of Healing replaces 1 strike (free); Hand of Harm adds necrotic (1 focus)
		// Level 11+: Hand of Healing can replace ALL strikes (free); Both option available
		let useHarm = false;
		let healingStrikes = 0; // number of strikes replaced by Hand of Healing
		const inCombat = this._state.isInCombat?.();
		const canHarm = calc.hasHandOfHarm && !(inCombat && this._handOfHarmUsedThisTurn);
		const canHeal = calc.hasHandOfHealing;
		const canHealAll = calc.hasFlurryOfHealingAndHarm; // level 11+

		if (canHeal || canHarm) {
			const harmFormula = calc.handOfHarmDamage || "?";
			const healFormula = calc.handOfHealingAmount || "?";
			const choices = [];
			if (canHealAll && canHarm) {
				choices.push({name: "Both", key: "both", description: `Healing (${healFormula} HP, free) + Harm (${harmFormula} necrotic, 1 Focus)`});
			}
			if (canHarm) {
				choices.push({name: "Hand of Harm", key: "harm", description: `Add ${harmFormula} necrotic to one strike (1 Focus Point)`});
			}
			if (canHealAll) {
				choices.push({name: "All Healing", key: "healall", description: `Replace all ${strikes} strikes with ${healFormula} HP healing each (free)`});
			}
			if (canHeal) {
				choices.push({name: "Hand of Healing", key: "healing", description: `Replace one strike with ${healFormula} HP healing (free)`});
			}
			choices.push({name: "Normal Strikes", key: "skip", description: `${strikes} unarmed strikes only`});

			const chosen = await this._showCombatActionChoiceModal(feature, choices, () => {});
			if (!chosen) return false; // Cancel — abort Flurry entirely
			const key = chosen.key;
			useHarm = key === "harm" || key === "both";
			if (key === "healall") {
				healingStrikes = strikes;
			} else if (key === "healing" || key === "both") {
				healingStrikes = 1;
			}
		}

		// Handle Hand of Harm: deduct focus, calculate bonus damage
		let handOfHarmDamage = 0;
		if (useHarm) {
			if (!this._state.useKiPoint(1)) {
				JqueryUtil.doToast({type: "warning", content: "Not enough focus points for Hand of Harm!"});
				useHarm = false;
			} else {
				const harmRoll = this._parseDamage(calc.handOfHarmDamage);
				handOfHarmDamage = harmRoll.total;
				this._handOfHarmUsedThisTurn = true;
				if (calc.hasPhysiciansTouch) {
					JqueryUtil.doToast({type: "info", content: "Physician's Touch: target is also poisoned until end of your next turn"});
				}
				this.renderCombatResources();
				this._page._renderResources?.();
			}
		}

		// Handle Hand of Healing: replace strikes with healing rolls (suppress individual dice results)
		const healResults = [];
		for (let h = 0; h < healingStrikes; h++) {
			strikes--;
			const result = await this._executeHandOfHealing(calc, {free: true, showResult: false});
			if (result) healResults.push(result);
		}

		// If all strikes were replaced by healing, show consolidated healing display
		if (strikes <= 0) {
			if (healResults.length) {
				const healLines = healResults.map((r, i) => {
					const label = r.isSelf ? "Self" : "Other";
					return `<div style="margin:3px 0"><strong style="color:#28a745">Heal ${i + 1} (${label}):</strong> [${r.rolls.join(", ")}]${r.modifier ? ` + ${r.modifier}` : ""} = <strong style="color:#28a745">${r.total} HP</strong>${r.conditionNote}</div>`;
				});
				const totalHealing = healResults.reduce((sum, r) => sum + r.total, 0);
				this._page._showDiceResult?.(
					"Flurry of Blows — Healing",
					`${totalHealing} total HP`,
					healLines.join(""),
					"", "", {duration: 12000},
				);
			}
			return true;
		}

		// Resolve attack parameters once. Unarmed strikes are melee, so use
		// melee-scoped contributions — a ranged-only modifier (Archery) must never
		// buff Flurry of Blows.
		const abilityMod = this._state.getWeaponAbilityMod(unarmedStrike);
		const profBonus = this._state.getProficiencyBonus();
		const attackContributions = this._state.getAttackModifierContributions?.({isMelee: true}) || [];
		const featureAttackBonus = attackContributions.reduce((sum, c) => sum + (c.value || 0), 0);
		const stateAttackBonus = this._state.getBonusFromStates?.("attack") || 0;
		const totalBonus = abilityMod + profBonus + (unarmedStrike.attackBonus || 0) + featureAttackBonus + stateAttackBonus;

		// Resolve damage parameters once
		const damageModifiers = this._state.getNamedModifiersByType("damage");
		const featureDamageBonus = damageModifiers.reduce((sum, mod) => sum + (mod.value || 0), 0);
		const stateDamageBonus = this._state.getBonusFromStates?.("damage") || 0;
		const totalDamageBonus = abilityMod + (unarmedStrike.damageBonus || 0) + featureDamageBonus + stateDamageBonus;

		// Check advantage/disadvantage
		const hasAdvantage = this._state.hasAdvantageFromStates?.("attack:melee:str")
			|| this._state.hasAdvantageFromStates?.("attack");
		const hasDisadvantage = this._state.hasDisadvantageFromStates?.("attack:melee:str")
			|| this._state.hasDisadvantageFromStates?.("attack");
		let rollMode;
		if (hasAdvantage && !hasDisadvantage) rollMode = "advantage";
		else if (hasDisadvantage && !hasAdvantage) rollMode = "disadvantage";

		// Roll all strikes and collect results
		const results = [];
		const critRange = this._state.getCriticalRange?.() || 20;
		let handOfHarmApplied = false;
		const dmgType = unarmedStrike.damageType || "bludgeoning";
		for (let i = 0; i < strikes; i++) {
			const rollResult = this._page.rollD20?.({mode: rollMode}) || {roll: 10, mode: "normal"};
			const attackTotal = rollResult.roll + totalBonus;
			const isCrit = rollResult.roll >= critRange;
			const isFumble = rollResult.roll === 1;

			// Roll damage
			const damageRoll = this._parseDamage(unarmedStrike.damage || "1d6", isCrit);
			const baseDamage = damageRoll.total + totalDamageBonus;

			// Apply Hand of Harm to the first non-fumble strike
			let harmOnThisStrike = 0;
			if (handOfHarmDamage > 0 && !handOfHarmApplied && !isFumble) {
				harmOnThisStrike = handOfHarmDamage;
				handOfHarmApplied = true;
			}

			results.push({roll: rollResult.roll, attackTotal, isCrit, isFumble, baseDamage, harmDamage: harmOnThisStrike, damageRolls: damageRoll.rolls, damageSides: damageRoll.sides});
		}

		// Build consolidated display with separated damage types
		const stateEffectLabel = this._getStateEffectLabel?.(hasAdvantage, hasDisadvantage) || "";
		const modeLabel = this._page.getModeLabel?.(rollMode || "normal") || "";
		const attackBonusStr = totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`;

		const strikeLines = results.map((r, i) => {
			const num = i + 1;
			if (r.isFumble) {
				return `<div style="margin:3px 0"><strong>Strike ${num}:</strong> <span style="color:#dc3545">💀 Miss! (nat 1)</span></div>`;
			}
			const totalStrikeDmg = r.baseDamage + r.harmDamage;
			const harmNote = r.harmDamage ? ` + <strong style="color:#9b59b6">${r.harmDamage} necrotic</strong> = <strong>${totalStrikeDmg}</strong>` : "";
			if (r.isCrit) {
				const critDice = `[${r.damageRolls.join(", ")}]`;
				return `<div style="margin:3px 0"><strong>Strike ${num}:</strong> <span style="color:#e5c100">⚡ CRIT! ${r.attackTotal} to hit</span> — <strong style="color:#e5c100">${r.baseDamage}</strong> ${dmgType}${harmNote} <span style="opacity:0.7">(${critDice} double dice)</span></div>`;
			}
			return `<div style="margin:3px 0"><strong>Strike ${num}:</strong> ${r.attackTotal} to hit — <strong>${r.baseDamage}</strong> ${dmgType}${harmNote}</div>`;
		});

		const totalBaseDamage = results.reduce((sum, r) => sum + r.baseDamage, 0);
		const totalHarmDamage = results.reduce((sum, r) => sum + r.harmDamage, 0);
		const grandTotal = totalBaseDamage + totalHarmDamage;

		// Add healing lines if any strikes were replaced
		const healLines = healResults.map((r, i) => {
			const label = r.isSelf ? "Self" : "Other";
			return `<div style="margin:3px 0"><strong style="color:#28a745">Heal (${label}):</strong> [${r.rolls.join(", ")}]${r.modifier ? ` + ${r.modifier}` : ""} = <strong style="color:#28a745">${r.total} HP</strong>${r.conditionNote}</div>`;
		});

		const totalLine = totalHarmDamage
			? `${totalBaseDamage} ${dmgType} + ${totalHarmDamage} necrotic = ${grandTotal} total`
			: `${grandTotal} total damage`;
		const formulaLine = `<div style="margin-bottom:4px;opacity:0.7"><em>Attack ${attackBonusStr} to hit, ${unarmedStrike.damage}${totalDamageBonus >= 0 ? "+" : ""}${totalDamageBonus} damage per strike</em></div>`;
		const breakdown = formulaLine + strikeLines.join("") + healLines.join("");

		this._page._showDiceResult?.(
			`Flurry of Blows${modeLabel}${stateEffectLabel}`,
			totalLine,
			breakdown,
			"", "", {duration: 12000},
		);

		// Animate the aggregate damage dice across all strikes.
		const flurryGroups = [];
		for (const r of results) this._pushDiceGroup(flurryGroups, {sides: r.damageSides, rolls: r.damageRolls});
		void this._page.pAnimateDamageDice?.(flurryGroups);

		return true;
	}

	/**
	 * Show an interactive confirmation modal prompting to use Hand of Harm.
	 * Deducts 1 focus point on accept, marks used this turn.
	 * @returns {boolean} True if the user accepted and focus was deducted.
	 */
	/**
	 * Check if any weapon-modifier combat methods are configured for this weapon
	 * and prompt the user to activate one during the damage roll.
	 * Spends stamina on acceptance and creates the effect.
	 * @param {object} attack - The attack being rolled
	 * @returns {Promise<*>} The activated effect, or null
	 */
	async _promptUseCombatMethod (attack) {
		const methods = this._state.getCombatMethods?.() || [];
		const matchingMethods = methods.filter(m => {
			if (m.methodCategory !== "weaponModifier") return false;
			const remembered = this._state.getCombatMethodWeapon(m.name);
			return remembered?.weaponId === attack.id;
		});

		if (!matchingMethods.length) return null;

		for (const method of matchingMethods) {
			const cost = this._getMethodStaminaCost(method);
			const currentStamina = this._state.getStaminaCurrent();
			const dmgDesc = method.ongoingDamage || "effect";
			const saveDesc = method.ongoingSaveType
				? ` (${method.ongoingSaveType.charAt(0).toUpperCase() + method.ongoingSaveType.slice(1)} save to end)`
				: "";

			const canPayWithKi = this._state.canUseFocusForStamina?.() && (this._state.getKiPointsCurrent?.() ?? 0) >= cost;
			if (currentStamina < cost && !canPayWithKi) continue;

			const costLabel = currentStamina >= cost ? `${cost} EP` : `${cost} ki/focus`;
			const choices = [
				{name: "Yes", description: `Use ${method.name}: ${dmgDesc}${saveDesc} (costs ${costLabel})`},
				{name: "No", description: `Attack normally`},
			];

			const chosen = await this._showCombatActionChoiceModal({name: `⚔️ ${method.name}`}, choices);
			if (!chosen || chosen.name !== "Yes") continue;

			// Spend stamina (or ki)
			if (currentStamina >= cost) {
				this._state.setStaminaCurrent(currentStamina - cost);
			} else if (canPayWithKi) {
				if (!this._state.useFocusForStamina(cost)) continue;
			}
			this._updateStaminaDisplay();
			if (this._page?._features) this._page._features._renderResources();

			const calcs = this._state.getFeatureCalculations?.() || {};
			const saveDc = calcs.combatMethodDc || 10;

			const effect = {
				name: method.name,
				weaponId: attack.id,
				weaponName: attack.name,
				ongoingDamage: method.ongoingDamage || null,
				ongoingSaveType: method.ongoingSaveType || method.saveType || null,
				saveDc,
				alternativeEndCheck: method.alternativeEndCheck || null,
				description: method.entries ? JSON.stringify(method.entries) : "",
			};

			this._state.activateCombatMethodEffect(effect);
			this.renderCombatEffects();
			this._page._saveCurrentCharacter?.();

			JqueryUtil.doToast({type: "success", content: `${method.name} applied to ${attack.name}!`});
			return effect;
		}

		return null;
	}

	/**
	 * Prompt player to apply an active combat method effect (e.g. Wounding Strike) during a damage roll.
	 */
	async _promptApplyMethodEffect (effect) {
		const dmgDesc = effect.ongoingDamage ? `${effect.ongoingDamage} ongoing damage` : "effect";
		const saveDesc = effect.ongoingSaveType
			? ` (${effect.ongoingSaveType.charAt(0).toUpperCase() + effect.ongoingSaveType.slice(1)} save DC ${effect.saveDc} to end)`
			: "";

		const choices = [
			{name: "Yes", description: `Apply ${effect.name}: ${dmgDesc}${saveDesc}`},
			{name: "No", description: `Skip ${effect.name} this time`},
		];

		const fakeFeature = {name: effect.name};
		const chosen = await this._showCombatActionChoiceModal(fakeFeature, choices, () => {});
		return chosen?.name === "Yes";
	}

	async _promptHandOfHarm (calc) {
		const formula = calc.handOfHarmDamage;
		if (!formula) return false;

		const choices = [
			{name: "Yes", description: `Spend 1 Focus Point to deal ${formula} necrotic damage`},
			{name: "No", description: "Skip Hand of Harm this time"},
		];

		const fakeFeature = {name: "Hand of Harm"};
		const chosen = await this._showCombatActionChoiceModal(fakeFeature, choices, () => {});
		if (!chosen || chosen.name !== "Yes") return false;

		// Deduct focus point
		if (!this._state.useKiPoint(1)) {
			JqueryUtil.doToast({type: "warning", content: "Not enough focus points for Hand of Harm!"});
			return false;
		}

		this._handOfHarmUsedThisTurn = true;

		// Physician's Touch condition note
		if (calc.hasPhysiciansTouch) {
			JqueryUtil.doToast({type: "info", content: "Physician's Touch: target is also poisoned until end of your next turn"});
		}

		this.renderCombatResources();
		this._page._renderResources?.();
		this._page._saveCurrentCharacter?.();
		return true;
	}

	/**
	 * Execute Hand of Healing: roll healing dice and optionally apply to self.
	 * Shows Self/Other choice. Self applies heal; Other shows roll only.
	 * @param {object} calc - Feature calculations from getFeatureCalculations()
	 * @param {*} [opts] - Options: {free?: boolean, showResult?: boolean}
	 */
	async _executeHandOfHealing (calc, opts = {}) {
		const {free = false, showResult = true} = opts;
		const formula = calc.handOfHealingAmount;
		if (!formula) return null;

		// Show Self/Other choice
		const choices = [
			{name: "Self", description: "Heal yourself"},
			{name: "Another Creature", description: "Heal a creature you touch (roll only)"},
		];

		let chosen = null;
		const fakeFeature = {name: "Hand of Healing"};
		chosen = await this._showCombatActionChoiceModal(fakeFeature, choices, () => {});
		if (!chosen) return null;

		// Deduct focus point if not free
		if (!free) {
			if (!this._state.useKiPoint(1)) {
				JqueryUtil.doToast({type: "warning", content: "Not enough focus points for Hand of Healing!"});
				return null;
			}
			this.renderCombatResources();
			this._page._renderResources?.();
		}

		// Roll healing
		const healRoll = this._parseDamage(formula);
		const total = healRoll.total;
		const healGroups = [];
		this._pushDiceGroup(healGroups, healRoll);
		void this._page.pAnimateDamageDice?.(healGroups);

		// Physician's Touch condition note
		let conditionNote = "";
		if (calc.hasPhysiciansTouch && calc.physiciansTouchConditions?.length) {
			conditionNote = `<div style="margin-top:4px;opacity:0.85">✨ Physician's Touch: also end one of <strong>${calc.physiciansTouchConditions.join(", ")}</strong></div>`;
		}

		const isSelf = chosen.name === "Self";
		if (isSelf) {
			this._state.heal(total);
			this._page._renderHp?.();
			this._page._renderCombatStats?.();
		}

		if (showResult) {
			if (isSelf) {
				this._page._showDiceResult?.(
					"Hand of Healing (Self)",
					`+${total} HP`,
					`[${healRoll.rolls.join(", ")}]${healRoll.modifier ? ` + ${healRoll.modifier}` : ""} = ${total} HP restored${conditionNote}`,
				);
			} else {
				this._page._showDiceResult?.(
					"Hand of Healing",
					`${total} HP`,
					`[${healRoll.rolls.join(", ")}]${healRoll.modifier ? ` + ${healRoll.modifier}` : ""} = heal ${total} HP${conditionNote}`,
				);
			}
		}

		this._page._saveCurrentCharacter?.();
		return {total, rolls: healRoll.rolls, modifier: healRoll.modifier, isSelf, conditionNote};
	}

	/**
	 * Execute Hand of Harm: roll necrotic damage dice.
	 * @param {object} calc - Feature calculations from getFeatureCalculations()
	 * @param {object} [opts]
	 * @param {boolean} [opts.free=false] - If true, skip focus point cost (e.g. from Flurry)
	 */
	_executeHandOfHarm (calc, {free = false} = {}) {
		const formula = calc.handOfHarmDamage;
		if (!formula) return;

		// Deduct focus point if not free
		if (!free) {
			if (!this._state.useKiPoint(1)) {
				JqueryUtil.doToast({type: "warning", content: "Not enough focus points for Hand of Harm!"});
				return;
			}
			this.renderCombatResources();
			this._page._renderResources?.();
		}

		// Roll necrotic damage
		const damageRoll = this._parseDamage(formula);
		const total = damageRoll.total;
		const harmGroups = [];
		this._pushDiceGroup(harmGroups, damageRoll);
		void this._page.pAnimateDamageDice?.(harmGroups);

		// Mark used this turn
		this._handOfHarmUsedThisTurn = true;

		// Physician's Touch condition note
		let conditionNote = "";
		if (calc.hasPhysiciansTouch && calc.physiciansTouchConditions?.length) {
			conditionNote = `<div style="margin-top:4px;opacity:0.85">✨ Physician's Touch: also inflict <strong>poisoned</strong> until end of your next turn</div>`;
		}

		this._page._showDiceResult?.(
			"Hand of Harm",
			`${total} necrotic`,
			`[${damageRoll.rolls.join(", ")}]${damageRoll.modifier ? ` + ${damageRoll.modifier}` : ""} = ${total} necrotic damage${conditionNote}`,
		);

		this._page._saveCurrentCharacter?.();
	}

	/**
	 * C6: Show choice modal for Flurry of Healing and Harm.
	 * When using Flurry of Blows at level 11+, one unarmed strike can be
	 * replaced with Hand of Healing or Hand of Harm.
	 */
	async _showFlurryChoiceModal (feature, calc) {
		const martialArtsDie = calc.martialArtsDie || "1d6";
		const wisMod = this._state.getAbilityMod?.("wis") || 0;

		const choices = [
			{
				name: "Hand of Healing",
				description: `Restore ${martialArtsDie}+${wisMod} HP to a creature you touch`,
			},
			{
				name: "Hand of Harm",
				description: `Deal ${martialArtsDie}+${wisMod} necrotic damage (on unarmed hit)`,
			},
		];

		// Use onChoice as a no-op; handle the async work AFTER the modal resolves
		const chosen = await this._showCombatActionChoiceModal(feature, choices, () => {});

		if (chosen) {
			if (chosen.name === "Hand of Healing") {
				// Flurry healing: show Self/Other choice then roll
				await this._executeHandOfHealing(calc, {free: true});
			} else if (chosen.name === "Hand of Harm") {
				// Flurry harm: rolls directly (sync)
				this._executeHandOfHarm(calc, {free: true});
			}

			JqueryUtil.doToast({
				type: "info",
				content: `${feature.name}: Chose ${chosen.name}`,
			});
		}
	}

	/**
	 * C11: Show multi-target workflow modal for Whirlpool Strike.
	 * Lets user choose number of targets, pick an attack, roll each,
	 * and calculates escalating bonus damage per subsequent hit.
	 */
	async _showWhirlpoolStrikeModal (feature) {
		const {eleModalInner: modalInner, doClose, pGetResolved} = await CharacterSheetModal.pGetShow({
			title: `${feature.name} — Multi-Target Attack`,
			isMinHeight0: true,
			zIndex: 10003,
			isUncappedHeight: true,
		});

		// Get available melee attacks
		const attacks = (this._state.getAttacks?.() || []).filter(a =>
			a.isMelee || a.type === "melee" || (a.range && !a.range.includes("/")),
		);

		if (!attacks.length) {
			modalInner.append(e_({outer: `<div class="ve-muted p-2">No melee attacks available</div>`}));
			const closeBtn = e_({outer: `<button class="ve-btn ve-btn-default w-100 mt-2">Close</button>`});
			closeBtn.addEventListener("click", () => doClose(false));
			modalInner.append(closeBtn);
			await pGetResolved();
			return;
		}

		// Step 1: Choose number of creatures
		modalInner.append(e_({outer: `<div class="mb-2 ve-small"><strong>How many creatures?</strong> (each in reach)</div>`}));
		const numInput = e_({outer: `<input type="number" class="ve-form-control ve-input-sm mb-3" min="1" max="10" value="2" style="width: 80px;">`});
		modalInner.append(numInput);

		// Step 2: Choose weapon
		modalInner.append(e_({outer: `<div class="mb-2 ve-small"><strong>Choose weapon attack:</strong></div>`}));
		const select = e_({tag: "select", clazz: "ve-form-control ve-input-sm mb-3"});
		for (const atk of attacks) {
			select.append(e_({outer: `<option value="${atk.id}">${atk.name} (+${atk.attackBonus || 0})</option>`}));
		}
		modalInner.append(select);

		// Step 3: Roll button and results
		const resultArea = e_({tag: "div", clazz: "charsheet__whirlpool-results"});
		modalInner.append(resultArea);

		const rollBtn = e_({outer: `<button class="ve-btn ve-btn-sm ve-btn-primary mb-2">🎲 Roll Attacks</button>`});
		rollBtn.addEventListener("click", () => {
			const numTargets = Math.max(1, Math.min(10, parseInt(numInput.value) || 2));
			const selectedAtkId = select.value;
			const selectedAtk = attacks.find(a => String(a.id) === String(selectedAtkId)) || attacks[0];
			const bonus = selectedAtk.attackBonus || 0;

			resultArea.innerHTML = "";
			const rows = [];
			for (let i = 0; i < numTargets; i++) {
				const result = this._page.rollD20?.({mode: "normal"}) || {roll: 10};
				const total = result.roll + bonus;
				const bonusDamage = i > 0 ? `+${i}d6` : "—";
				const critClass = result.roll === 20 ? "text-success bold" : result.roll === 1 ? "text-danger bold" : "";
				rows.push(`<tr>
					<td>${i + 1}</td>
					<td class="${critClass}">${result.roll}</td>
					<td>${total}</td>
					<td>${bonusDamage}</td>
				</tr>`);
			}
			resultArea.innerHTML = `
				<table class="w-100 ve-small mb-2" style="border-collapse: collapse;">
					<thead><tr>
						<th class="p-1 border-bottom">Target</th>
						<th class="p-1 border-bottom">Roll</th>
						<th class="p-1 border-bottom">Total</th>
						<th class="p-1 border-bottom">Bonus Dmg</th>
					</tr></thead>
					<tbody>${rows.join("")}</tbody>
				</table>
				<div class="ve-muted ve-small">Bonus damage: 2nd target +1d6, 3rd +2d6, etc.</div>
			`;
		});
		modalInner.append(rollBtn);

		const closeBtn = e_({outer: `<button class="ve-btn ve-btn-default w-100 mt-2">Close</button>`});
		closeBtn.addEventListener("click", () => doClose(false));
		modalInner.append(closeBtn);

		await pGetResolved();
	}

	// endregion

	/**
	 * Parse a resource cost (ki/focus/stamina) from a feature's description.
	 * @param {object} feature - Feature object
	 * @param {"ki"|"focus"|"stamina"} resourceType - Resource type to parse
	 * @returns {number} Cost amount, or 0 if not found
	 */
	_parseResourceCost (feature, resourceType) {
		const desc = (feature?.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
		const patterns = {
			ki: /(\d+)\s*ki\s*point/i,
			focus: /(\d+)\s*focus\s*point/i,
			stamina: /(\d+)\s*stamina\s*point/i,
		};
		const match = desc.match(patterns[resourceType]);
		return match ? parseInt(match[1]) : 0;
	}

	/**
	 * Return variable point-spend metadata for a feature whose effect scales with
	 * the committed points. The chooser/consumer is generic; calculations own caps.
	 */
	_getVariablePointSpendConfig (feature, calc = {}) {
		switch ((feature?.name || "").trim().toLowerCase()) {
			case "searing arc strike":
				return {
					min: calc.searingArcStrikeCost || 2,
					max: calc.searingArcStrikeMaxCost || 2,
					resourceName: calc.focusPoints ? "Focus" : "Ki",
					describe: amount => `Cast Burning Hands at level ${Math.max(1, amount - 1)} (${amount + 1}d6 fire)`,
				};
			case "searing sunburst":
				return {
					min: 0,
					max: calc.searingSunburstMaxCost ?? 3,
					resourceName: calc.focusPoints ? "Focus" : "Ki",
					describe: amount => `${2 + (amount * 2)}d6 radiant damage`,
				};
			default:
				return null;
		}
	}

	async _pChooseVariablePointSpend (feature, config) {
		const available = this._state.getKiPointsCurrent?.() ?? 0;
		const min = Math.max(0, Number(config.min) || 0);
		const max = Math.min(Math.max(min, Number(config.max) || min), available);
		if (available < min) {
			JqueryUtil.doToast({
				type: "warning",
				content: `Not enough ${config.resourceName.toLowerCase()} points for ${feature.name}!`,
			});
			return null;
		}
		const choices = [];
		for (let amount = min; amount <= max; ++amount) {
			choices.push({
				id: `spend-${amount}`,
				amount,
				name: amount ? `Spend ${amount} ${config.resourceName}` : `Spend no ${config.resourceName}`,
				description: config.describe?.(amount) || "",
			});
		}
		const selected = await this._showCombatActionChoiceModal(feature, choices, () => {});
		return selected?.amount ?? null;
	}

	_executeFeatureAttackVolley (feature, {attack, count = 1} = {}) {
		if (!attack) return [];
		const attackBonus = this._state.getWeaponAbilityMod(attack) + this._state.getProficiencyBonus() + (attack.attackBonus || 0);
		const damageBonus = this._state.getWeaponAbilityMod(attack) + (attack.damageBonus || 0);
		const formula = `${attack.damage}${damageBonus >= 0 ? "+" : ""}${damageBonus}`;
		const results = [];
		for (let ix = 0; ix < count; ++ix) {
			results.push({
				attack: this._rollCombatActionDice(feature, {type: "attack", attackBonus}),
				damage: this._rollCombatActionDice(feature, {type: "damage", formula, label: `${attack.damageType} damage`}),
			});
		}
		return results;
	}

	_executeFeatureSaveDamage (feature, {dc, saveAbility, damage, damageType, label}) {
		const save = this._rollCombatActionDice(feature, {type: "save", dc, saveAbility});
		const damageResult = this._rollCombatActionDice(feature, {
			type: "damage",
			formula: damage,
			label: `${label || feature.name} ${damageType || ""} damage`.trim(),
		});
		return {save, damage: damageResult};
	}

	/**
	 * Show a detail modal for a combat action feature.
	 * Shows full description, action type, resource cost, effects preview,
	 * interactive dice rolls, and a Use button.
	 */
	async _showCombatActionModal (feature) {
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: feature.name,
			isMinHeight0: true,
			zIndex: 10002,
			isUncappedHeight: true,
		});

		// Action type
		const actionType = this._getFeatureActionType(feature);
		let actionLabel = "Action";
		let actionIcon = "⚔️";
		if (actionType === "bonus") { actionLabel = "Bonus Action"; actionIcon = "⚡"; } else if (actionType === "reaction") { actionLabel = "Reaction"; actionIcon = "🔄"; } else if (actionType === "free") { actionLabel = "Free"; actionIcon = "✨"; }

		// Feature type badge
		const featureTypeBadge = feature.featureType
			? `<span class="badge badge-${this._getFeatureTypeBadgeClass(feature.featureType)} ml-2">${feature.featureType}</span>`
			: "";

		modalInner.append(e_({outer: `
			<div class="ve-flex-v-center mb-2">
				<span class="mr-1">${actionIcon}</span>
				<span class="badge badge-outline-secondary">${actionLabel}</span>
				${featureTypeBadge}
			</div>
		`}));

		// Resource cost line
		const kiCost = this._parseResourceCost(feature, "ki");
		const focusCost = this._parseResourceCost(feature, "focus");
		const staminaCost = this._parseResourceCost(feature, "stamina");
		const costParts = [];
		if (kiCost) costParts.push(`${kiCost} Ki Point${kiCost > 1 ? "s" : ""}`);
		if (focusCost) costParts.push(`${focusCost} Focus Point${focusCost > 1 ? "s" : ""}`);
		if (staminaCost) costParts.push(`${staminaCost} Stamina`);

		if (costParts.length) {
			const kiCurrent = this._state.getKiPointsCurrent?.() ?? 0;
			const kiMax = this._state.getKiPoints?.() ?? 0;
			modalInner.append(e_({outer: `
				<div class="mb-2 ve-muted ve-small">
					<strong>Cost:</strong> ${costParts.join(", ")}
					${(kiCost || focusCost) && kiMax > 0 ? ` <span class="ml-1">(${kiCurrent}/${kiMax} remaining)</span>` : ""}
				</div>
			`}));
		}

		// Uses line
		if (feature.uses && feature.uses.max > 0) {
			const rechargeIcon = feature.uses.recharge === "short" ? "☀️" : "🌙";
			modalInner.append(e_({outer: `
				<div class="mb-2 ve-muted ve-small">
					<strong>Uses:</strong> ${feature.uses.current}/${feature.uses.max}
					<span title="${feature.uses.recharge} rest">${rechargeIcon}</span>
				</div>
			`}));
		}

		// Description
		if (feature.description) {
			modalInner.append(e_({outer: `<div class="rd__b mb-3">${Renderer.get().render(feature.description)}</div>`}));
		} else if (feature.entries) {
			try {
				modalInner.append(e_({outer: `<div class="rd__b mb-3">${Renderer.get().render({type: "entries", entries: feature.entries})}</div>`}));
			} catch { /* fall through */ }
		}

		// Feature-specific content (strike counts, choice hints, range, etc.)
		const featureContent = this._getFeatureSpecificContent(feature);
		if (featureContent) modalInner.append(featureContent);

		// Effects preview section
		const effects = feature.combatActionEffects;
		if (effects) {
			const effectsSection = this._renderEffectsPreview(effects, feature);
			if (effectsSection) modalInner.append(effectsSection);
		}

		// Roll section (interactive dice)
		if (effects?.rollDice) {
			const rollSection = this._renderModalRollSection(effects.rollDice, feature);
			modalInner.append(rollSection);
		}

		// Use + Close buttons
		const canUse = this._isActionTypeAvailable(actionType)
			&& (!feature.uses || feature.uses.current > 0);

		const btnBar = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-primary mr-2 charsheet__action-modal-use" ${!canUse ? "disabled" : ""}>Use</button>
			<button class="ve-btn ve-btn-default charsheet__action-modal-close">Close</button>
		</div>`;
		modalInner.append(btnBar);
		btnBar.querySelector(".charsheet__action-modal-use")?.addEventListener("click", async () => {
			doClose(false);
			try {
				await this._useCombatAction(feature);
			} catch (ex) {
				// eslint-disable-next-line no-console
				console.error(`[CharSheet] Error using combat action from modal:`, ex);
			}
		});
		btnBar.querySelector(".charsheet__action-modal-close")?.addEventListener("click", () => doClose(false));
	}

	/**
	 * Render an effects preview section for the combat action modal.
	 * Shows what will happen when the action is used: conditions, temp HP, dice, etc.
	 * @param {object} effects - The combatActionEffects object
	 * @param {object} feature - The source feature
	 * @returns {*} The effects preview element, or null if nothing to show
	 */
	_renderEffectsPreview (effects, feature) {
		const lines = [];

		if (effects.applyCondition) {
			const cond = effects.applyCondition;
			const target = cond.self ? "Self" : "Target";
			const duration = cond.duration ? ` (${cond.duration})` : "";
			lines.push(`<span class="mr-1">🎯</span> <strong>Applies:</strong> ${cond.name}${duration} <span class="ve-muted">[${target}]</span>`);
		}

		if (effects.grantTempHp) {
			const hp = effects.grantTempHp;
			const amount = hp.value != null ? `${hp.value}` : hp.formula || "?";
			lines.push(`<span class="mr-1">💛</span> <strong>Grants:</strong> ${amount} Temporary HP`);
		}

		if (effects.removeCondition) {
			lines.push(`<span class="mr-1">✅</span> <strong>Removes:</strong> ${effects.removeCondition}`);
		}

		if (effects.activateState) {
			lines.push(`<span class="mr-1">⚡</span> <strong>Activates:</strong> ${effects.activateState}`);
		}

		if (effects.rollDice) {
			const dice = effects.rollDice;
			if (dice.type === "damage" && dice.formula) {
				lines.push(`<span class="mr-1">🗡️</span> <strong>Damage:</strong> ${dice.formula}${dice.label ? ` ${dice.label}` : ""}`);
			} else if (dice.type === "healing" && dice.formula) {
				lines.push(`<span class="mr-1">💚</span> <strong>Healing:</strong> ${dice.formula}`);
			}
		}

		if (effects.multiTarget) {
			lines.push(`<span class="mr-1">👥</span> <strong>Multi-target</strong>`);
		}

		if (!lines.length) return null;

		return e_({outer: `
			<div class="charsheet__action-modal-effects cs-combat-feature mb-3 ve-small">
				<div class="cs-combat-feature__title ve-muted mb-1">Effects on Use</div>
				${lines.map(l => `<div class="mb-1">${l}</div>`).join("")}
			</div>
		`});
	}

	/**
	 * Render an interactive dice roll section for the combat action modal.
	 * Shows attack roll, save DC, and damage/healing buttons with advantage indicator.
	 * @param {object} diceConfig - The rollDice portion of combatActionEffects
	 * @param {object} feature - The source feature
	 * @returns {*} The roll section element
	 */
	_renderModalRollSection (diceConfig, feature) {
		const section = e_({outer: `<div class="charsheet__action-modal-rolls mb-3 p-2" style="background: var(--bg-faint, #f8f9fa); border-radius: 4px;"></div>`});
		section.append(e_({outer: `<div class="bold mb-2">🎲 Dice</div>`}));

		// Determine advantage/disadvantage from active states
		const hasAdvantage = this._state.hasAdvantageFromStates?.("attack") || false;
		const hasDisadvantage = this._state.hasDisadvantageFromStates?.("attack") || false;
		let rollMode = "normal";
		if (hasAdvantage && !hasDisadvantage) rollMode = "advantage";
		else if (hasDisadvantage && !hasAdvantage) rollMode = "disadvantage";

		// Advantage/disadvantage indicator
		if (rollMode !== "normal") {
			const modeIcon = rollMode === "advantage" ? "🟢" : "🔴";
			const modeLabel = rollMode === "advantage" ? "Advantage" : "Disadvantage";
			section.append(e_({outer: `
				<div class="mb-2 ve-small">
					<span class="mr-1">${modeIcon}</span>
					<strong>${modeLabel}</strong> <span class="ve-muted">(from active states)</span>
				</div>
			`}));
		}

		const type = diceConfig.type || "damage";

		if (type === "attack") {
			const bonus = diceConfig.attackBonus || 0;
			const bonusStr = bonus >= 0 ? `+${bonus}` : `${bonus}`;
			const resultArea = e_({tag: "div", clazz: "charsheet__action-modal-roll-result mt-1"});

			const atkBtn = e_({outer: `<button class="ve-btn ve-btn-sm ve-btn-primary mr-2">🎯 Roll Attack (d20${bonusStr})</button>`});
			atkBtn.addEventListener("click", () => {
				const result = this._rollCombatActionDice(feature, {...diceConfig, mode: rollMode});
				if (result) {
					const critClass = result.isNat20 ? "bold text-success" : result.isNat1 ? "bold text-danger" : "";
					const critLabel = result.isNat20 ? " — Critical Hit!" : result.isNat1 ? " — Critical Miss!" : "";
					resultArea.innerHTML = `<span class="${critClass}">${result.total}${critLabel}</span>`;
				}
			});

			const row = e_({tag: "div", clazz: "ve-flex-v-center"});
			row.append(atkBtn, resultArea);
			section.append(row);
		}

		if (type === "save") {
			const dc = diceConfig.dc || 10;
			const ability = diceConfig.saveAbility || "con";
			const abilityLabel = ability.charAt(0).toUpperCase() + ability.slice(1).toUpperCase();
			section.append(e_({outer: `
				<div class="charsheet__action-modal-save-prompt p-2 mb-1" style="border: 1px solid var(--color-warning, #f0ad4e); border-radius: 4px; background: var(--bg-warning-faint, #fff8e1);">
					<strong>DC ${dc} ${abilityLabel}</strong> saving throw
				</div>
			`}));
		}

		if ((type === "damage" || type === "healing") && diceConfig.formula) {
			const label = diceConfig.label || (type === "healing" ? "Healing" : "Damage");
			const icon = type === "healing" ? "💚" : "🗡️";
			const resultArea = e_({tag: "div", clazz: "charsheet__action-modal-roll-result mt-1"});

			const dmgBtn = e_({outer: `<button class="ve-btn ve-btn-sm ve-btn-default">${icon} Roll ${label} (${diceConfig.formula})</button>`});
			dmgBtn.addEventListener("click", () => {
				const result = this._rollCombatActionDice(feature, diceConfig);
				if (result) {
					resultArea.innerHTML = `<strong>${result.total}</strong> <span class="ve-muted">[${result.rolls.join(", ")}]</span>`;
				}
			});

			const row = e_({tag: "div", clazz: "ve-flex-v-center mt-2"});
			row.append(dmgBtn, resultArea);
			section.append(row);
		}

		// Combined save + damage/healing (common pattern: "DC X save, then Nd6 damage")
		if (type === "save" && diceConfig.formula) {
			const label = diceConfig.label || "Damage";
			const resultArea = e_({tag: "div", clazz: "charsheet__action-modal-roll-result mt-1"});

			const dmgBtn = e_({outer: `<button class="ve-btn ve-btn-sm ve-btn-default mt-1">🗡️ Roll ${label} (${diceConfig.formula})</button>`});
			dmgBtn.addEventListener("click", () => {
				const dmgConfig = {...diceConfig, type: "damage"};
				const result = this._rollCombatActionDice(feature, dmgConfig);
				if (result) {
					resultArea.innerHTML = `<strong>${result.total}</strong> <span class="ve-muted">[${result.rolls.join(", ")}]</span>`;
				}
			});

			const row = e_({tag: "div", clazz: "ve-flex-v-center mt-1"});
			row.append(dmgBtn, resultArea);
			section.append(row);
		}

		return section;
	}

	/**
	 * Get combat-classified features from FEATURE_CLASSIFICATION_OVERRIDES.
	 * Returns features whose classification is "combat" or "reaction".
	 * Used by both the combat tab and overview tab.
	 */
	getCombatClassifiedFeatures () {
		const features = this._state.getFeatures();
		const overrides = CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES || {};
		return features.filter(f => {
			const nameLower = f.name?.toLowerCase() || "";
			// Fighter action features have their own dedicated panel (renderCombatFighter);
			// keep them out of the generic Overview Actions list so there is a single
			// interactive surface with the correct heal / stamina / Action-Surge logic.
			if (CharacterSheetCombat.FIGHTER_OWNED_COMBAT_FEATURES.includes(nameLower)) return false;
			const cls = overrides[nameLower];
			return cls === "combat" || cls === "reaction";
		});
	}

	/**
	 * Generate feature-specific contextual UI for the combat action modal.
	 * Returns element with additional guidance, strike counts, choice hints, etc.
	 * Uses getFeatureCalculations() to pull data-driven values.
	 * @param {object} feature - The combat action feature
	 * @returns {HTMLElement|null} Feature-specific content element, or null
	 */
	_getFeatureSpecificContent (feature) {
		const nameLower = feature.name?.toLowerCase() || "";
		const calc = this._state.getFeatureCalculations?.() || {};
		const lines = [];

		// --- C1: Flurry of Blows ---
		if (nameLower === "flurry of blows") {
			const strikes = calc.heightenedFlurryAttacks || 2;
			lines.push(`<span class="mr-1">👊</span> Make <strong>${strikes} unarmed strike${strikes > 1 ? "s" : ""}</strong> as a bonus action`);
			if (calc.hasHeightenedFocus && strikes === 3) {
				lines.push(`<span class="mr-1">✨</span> <span class="ve-muted">Heightened Focus: 3rd strike added</span>`);
			}
			if (calc.hasFlurryOfHealingAndHarm) {
				lines.push(`<span class="mr-1">🔄</span> You may replace one strike with <strong>Hand of Healing</strong> or <strong>Hand of Harm</strong>`);
			}
		}

		// --- C2: Patient Defense ---
		if (nameLower === "patient defense") {
			lines.push(`<span class="mr-1">🧘</span> Take the <strong>Dodge</strong> action as a <strong>bonus action</strong>`);
			if (calc.hasHeightenedFocus) {
				lines.push(`<span class="mr-1">✨</span> <span class="ve-muted">Heightened Focus: also take the <strong>Disengage</strong> action</span>`);
			}
		}

		// --- C3: Step of the Wind ---
		if (nameLower === "step of the wind") {
			lines.push(`<span class="mr-1">💨</span> <strong>Dash</strong> or <strong>Disengage</strong> as a bonus action`);
			lines.push(`<span class="mr-1">🦘</span> Jump distance <strong>doubled</strong> for this turn`);
			if (calc.hasHeightenedFocus) {
				const dist = calc.heightenedStepOfTheWindDistance || 20;
				lines.push(`<span class="mr-1">✨</span> <span class="ve-muted">Heightened Focus: Move one creature within 5 ft up to ${dist} ft</span>`);
			}
		}

		// --- C7: Instant Step ---
		if (nameLower === "instant step") {
			const range = calc.instantStepRange || 60;
			const cost = calc.instantStepCost || 4;
			lines.push(`<span class="mr-1">⚡</span> Teleport up to <strong>${range} ft</strong> to an unoccupied space you can see`);
			lines.push(`<span class="mr-1">👻</span> <strong>Invisible</strong> until the start of your next turn`);
			lines.push(`<span class="mr-1">💎</span> Cost: <strong>${cost} stamina</strong>`);
		}

		// --- C8: Religious Training ---
		if (nameLower === "religious training") {
			lines.push(`<span class="mr-1">🙏</span> Spend stamina to gain temporary <strong>divine favor</strong>`);
			lines.push(`<span class="mr-1">💎</span> Variable cost: choose stamina amount on use`);
		}

		// --- C10: Wind Strike ---
		if (nameLower === "wind strike") {
			lines.push(`<span class="mr-1">🏹</span> Ranged weapon attack, <strong>20/60 ft</strong>`);
			lines.push(`<span class="mr-1">🟢</span> Roll with <strong>advantage</strong>`);
			lines.push(`<span class="mr-1">🎯</span> If both dice hit: add <strong>extra weapon damage die</strong>`);
		}

		// --- C11: Whirlpool Strike ---
		if (nameLower === "whirlpool strike") {
			lines.push(`<span class="mr-1">🌊</span> Attack <strong>multiple creatures</strong> in reach`);
			lines.push(`<span class="mr-1">🗡️</span> Choose a melee weapon attack to use`);
			lines.push(`<span class="mr-1">📈</span> Each subsequent hit: <strong>+1d6 bonus damage</strong>`);
		}

		// --- C4: Wall Walk (combat action aspect) ---
		if (nameLower === "wall walk") {
			lines.push(`<span class="mr-1">🕷️</span> Cast <strong>Spider Climb</strong> on self as a bonus action`);
			lines.push(`<span class="mr-1">💎</span> Cost: <strong>1 stamina</strong>`);
			lines.push(`<span class="mr-1">🔮</span> Duration: concentration, up to <strong>10 minutes</strong>`);
		}

		// --- Hand of Healing ---
		if (nameLower === "hand of healing") {
			const formula = calc.handOfHealingAmount || "?";
			lines.push(`<span class="mr-1">💚</span> Heal <strong>${formula}</strong> HP to a creature you touch`);
			lines.push(`<span class="mr-1">🎯</span> Choose <strong>Self</strong> (apply) or <strong>Other</strong> (roll only)`);
			if (calc.hasPhysiciansTouch) {
				lines.push(`<span class="mr-1">✨</span> <span class="ve-muted">Physician's Touch: also end one condition (${calc.physiciansTouchConditions?.join(", ")})</span>`);
			}
		}

		// --- Hand of Harm ---
		if (nameLower === "hand of harm") {
			const formula = calc.handOfHarmDamage || "?";
			lines.push(`<span class="mr-1">💀</span> Deal <strong>${formula}</strong> necrotic damage on unarmed strike hit`);
			lines.push(`<span class="mr-1">⚡</span> Once per turn`);
			if (calc.hasPhysiciansTouch) {
				lines.push(`<span class="mr-1">✨</span> <span class="ve-muted">Physician's Touch: also inflict <strong>poisoned</strong> until end of your next turn</span>`);
			}
		}

		if (nameLower === "radiant sun bolt") {
			lines.push(`<span class="mr-1">☀️</span> Make <strong>${calc.radiantSunBoltBonusActionAttacks || 2} Radiant Sun Bolt attacks</strong> as a bonus action`);
			lines.push(`<span class="mr-1">💎</span> Cost: <strong>${calc.radiantSunBoltBonusActionCost || 1} Ki</strong>`);
		}

		if (nameLower === "searing arc strike") {
			lines.push(`<span class="mr-1">🔥</span> Cast <strong>Burning Hands</strong> after the Attack action`);
			lines.push(`<span class="mr-1">📈</span> Spend <strong>${calc.searingArcStrikeCost || 2}–${calc.searingArcStrikeMaxCost || 2} Ki</strong> for spell levels 1–${calc.searingArcStrikeMaxSpellLevel || 1}`);
			lines.push(`<span class="mr-1">🎯</span> <strong>DC ${calc.searingArcStrikeDc}</strong> DEX save`);
		}

		if (nameLower === "searing sunburst") {
			lines.push(`<span class="mr-1">🌞</span> <strong>${calc.searingSunburstRadius || 20}-ft radius</strong> burst at a point within ${calc.searingSunburstRange || 150} ft`);
			lines.push(`<span class="mr-1">📈</span> Spend <strong>0–${calc.searingSunburstMaxCost ?? 3} Ki</strong> for 2d6–8d6 radiant damage`);
			lines.push(`<span class="mr-1">🎯</span> <strong>DC ${calc.searingSunburstDc}</strong> CON save`);
		}

		if (!lines.length) return null;

		return e_({outer: `
			<div class="charsheet__action-modal-specific cs-combat-feature mb-3 ve-small">
				${lines.map(l => `<div class="mb-1">${l}</div>`).join("")}
			</div>
		`});
	}

	_useActiveStateTrigger (stateTypeId, {skipActionCost = false} = {}) {
		const trigger = this._state.getActiveStateTrigger?.(stateTypeId);
		if (!trigger) return false;
		if (!skipActionCost && !this._isActionTypeAvailable(trigger.actionType)) {
			const actionName = trigger.actionType === "reaction" ? "Reaction" : trigger.actionType === "bonus" ? "Bonus Action" : "Action";
			JqueryUtil.doToast({type: "warning", content: `${actionName} already used this round.`});
			return false;
		}

		const effect = trigger.effect;
		if (effect.type === "communicationModes" || effect.type === "damageReduction") {
			return this._pUseChoiceActiveStateTrigger(trigger, {skipActionCost});
		}
		if (effect.type === "retaliationDamage") {
			const damage = effect.resolvedValue || 0;
			this._page._showDiceResult?.(
				`${trigger.stateName} — ${trigger.label}`,
				damage,
				`${damage} ${effect.damageType || ""} damage to the melee attacker`.trim(),
			);
		}
		if (effect.type === "summonBurst") {
			const roll = this._parseDamage(effect.resolvedDamage || "2d4");
			this._page._showDiceResult?.(
				`${trigger.stateName} — ${trigger.label}`,
				roll.total,
				`${effect.resolvedDamage} force damage; DEX save DC ${effect.resolvedDc} negates (chosen creatures within ${effect.range} ft)`,
			);
		}
		// Generic "one creature in my Emanation makes a save or takes damage (and
		// is pushed)" burst. Any state type can opt in by exposing an effect of
		// this shape; nothing here is Circle-of-the-Sea specific.
		if (effect.type === "saveDamageBurst") {
			const roll = this._parseDamage(effect.resolvedDamage || "1d6");
			const saveName = (effect.saveAbility || "con").toUpperCase();
			const detail = [
				`${effect.resolvedDamage} ${effect.damageType || ""} damage`.replace(/\s+/g, " ").trim(),
				`${saveName} save DC ${effect.resolvedDc} negates`,
				`one creature you can see in the ${effect.range}-ft Emanation`,
			];
			if (effect.pushDistance) {
				detail.push(`on a failure, ${effect.maxPushSize ? `${effect.maxPushSize} or smaller ` : ""}targets are pushed up to ${effect.pushDistance} ft away from you`);
			}
			this._page._showDiceResult?.(
				`${trigger.stateName} — ${trigger.label}`,
				roll.total,
				detail.join("; "),
			);
		}
		if (!skipActionCost) this._consumeActionType(trigger.actionType);
		this.renderCombatStates();
		return true;
	}

	async _pUseChoiceActiveStateTrigger (trigger, {skipActionCost = false} = {}) {
		const effect = trigger.effect;
		if (effect.type === "communicationModes") {
			const selected = await this._showCombatActionChoiceModal(
				{name: trigger.label},
				(effect.choices || []).map(choice => ({
					...choice,
					description: `${choice.description} Range: ${choice.range} feet.`,
				})),
				() => {},
			);
			if (!selected) return false;
			this._page._showDiceResult?.(
				`${trigger.stateName} — ${selected.name}`,
				`${selected.range} ft`,
				selected.description,
			);
		}
		if (effect.type === "damageReduction") {
			const selected = await this._showCombatActionChoiceModal(
				{name: trigger.label},
				(effect.damageTypes || []).map(type => ({
					id: type,
					name: `${type.charAt(0).toUpperCase()}${type.slice(1)} damage`,
					damageType: type,
				})),
				() => {},
			);
			if (!selected) return false;
			const roll = this._parseDamage(effect.resolvedDamage || "1d10");
			const reduction = Math.max(1, roll.total + (effect.resolvedValue || 0));
			this._page._showDiceResult?.(
				`${trigger.stateName} — ${trigger.label}`,
				reduction,
				`${effect.resolvedDamage} + WIS ${selected.damageType} damage reduction`,
			);
		}

		if (!skipActionCost) this._consumeActionType(trigger.actionType);
		this.renderCombatStates();
		return true;
	}

	/**
	 * Clean description text for tooltip display
	 */
	_cleanDescriptionForTooltip (description) {
		if (!description) return "";
		// Remove HTML tags and extra whitespace
		return description
			.replace(/<[^>]+>/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.substring(0, 300) + (description.length > 300 ? "..." : "");
	}

	/**
	 * Collapse or expand a derived/utility combat card into a thin single-line
	 * affordance based on whether it has content. Empty Defenses / Conditions /
	 * Active-Combat-Effects cards otherwise stack as chunky "No active X" voids;
	 * when empty the section keeps its header (and any inline add button) while
	 * the body is hidden and a muted hint sits at the trailing edge. Paired with
	 * the .charsheet__section--combat-empty CSS in charactersheet.css.
	 * @param {HTMLElement|null} bodyEl The section's inner body container.
	 * @param {boolean} isEmpty Whether the card has no content to show.
	 * @param {string} [hintText] Trailing hint shown when collapsed (e.g. "None").
	 */
	_setCombatSectionEmpty (bodyEl, isEmpty, hintText = "None") {
		const section = bodyEl?.closest?.(".charsheet__section");
		if (!section) return;

		section.classList.toggle("charsheet__section--combat-empty", !!isEmpty);

		const title = section.querySelector(".charsheet__section-title");
		if (!title) return;

		let hint = title.querySelector(".charsheet__combat-empty-hint");
		if (isEmpty) {
			if (!hint) {
				hint = document.createElement("span");
				hint.className = "charsheet__combat-empty-hint";
				title.append(hint);
			}
			hint.textContent = hintText;
		} else if (hint) {
			hint.remove();
		}
	}

	/**
	 * Render active conditions in combat tab
	 */
	renderCombatConditions () {
		const container = document.getElementById("charsheet-combat-conditions");
		if (!container) return;

		// Now returns {name, source} objects
		const conditions = this._state.getConditions?.() || [];

		if (!conditions.length) {
			container.innerHTML = `<div class="ve-muted ve-text-center py-2">No active conditions</div>`;
			this._setCombatSectionEmpty(container, true);
			return;
		}

		this._setCombatSectionEmpty(container, false);

		container.innerHTML = "";

		for (const condObj of conditions) {
			const conditionName = condObj.name;
			const conditionSource = condObj.source;
			const conditionDef = CharacterSheetState.getConditionEffects(conditionName);

			const icon = conditionDef?.icon || "⚠️";
			const description = conditionDef?.description || conditionName;
			const sourceAbbr = Parser.sourceJsonToAbv(conditionSource);

			// Build tooltip with effects
			let tooltip = `${conditionName} (${sourceAbbr}): ${description}`;
			if (conditionDef?.effects?.length) {
				const effectList = conditionDef.effects.map(e => {
					if (e.type === "advantage") return `• Advantage on ${this._formatEffectTarget(e.target)}`;
					if (e.type === "disadvantage") return `• Disadvantage on ${this._formatEffectTarget(e.target)}`;
					if (e.type === "autoFail") return `• Auto-fail ${this._formatEffectTarget(e.target)}`;
					if (e.type === "setSpeed") return `• Speed set to ${e.value}`;
					if (e.type === "resistance") return `• Resistance to ${e.target}`;
					if (e.type === "bonus") return `• ${e.value >= 0 ? "+" : ""}${e.value} to ${this._formatEffectTarget(e.target)}`;
					if (e.type === "note") return `• ${e.value}`;
					return null;
				}).filter(Boolean);
				if (effectList) {
					tooltip += `\n${effectList.join("\n")}`;
				}
			}

			// Create hoverable condition link
			let conditionLink = conditionName;
			try {
				const hash = UrlUtil.encodeForHash([conditionName, conditionSource].join(HASH_LIST_SEP));
				const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_CONDITIONS_DISEASES, source: conditionSource, hash: hash});
				conditionLink = `<a href="${UrlUtil.PG_CONDITIONS_DISEASES}#${hash}" ${hoverAttrs}>${conditionName}</a>`;
			} catch (e) {
				// Fall back to plain name if hover fails
				conditionLink = conditionName;
			}

			const condition = e_({outer: `
				<div class="charsheet__combat-condition badge badge-warning mr-1 mb-1" 
					title="${tooltip}" data-condition-name="${conditionName}" data-condition-source="${conditionSource}">
					${icon} <span class="charsheet__condition-name-link">${conditionLink}</span>
					<span class="charsheet__condition-source-badge">${sourceAbbr}</span>
					<span class="charsheet__condition-remove ml-1" title="Remove condition">&times;</span>
				</div>
			`});

			condition.querySelector(".charsheet__condition-remove")?.addEventListener("click", (/** @type {*} */ e) => {
				e.stopPropagation();
				// Now passes {name, source} object
				this._state.removeCondition?.({name: conditionName, source: conditionSource});
				this.renderCombatConditions();
				this.renderCombatEffects();
				this.renderCombatDefenses();
				this._page._renderConditions?.();
				this._page._saveCurrentCharacter?.();
				this._page._renderCharacter?.();
			});

			container.append(condition);
		}
	}

	/**
	 * Render defenses (resistances, immunities, vulnerabilities, condition immunities)
	 */
	renderCombatDefenses () {
		// Get base defenses from character state
		const effectiveDefenses = this._state.getEffectiveDefenses?.() || {};
		const resistances = effectiveDefenses.resistances || this._state.getResistances?.() || [];
		const conditionalResistances = effectiveDefenses.conditionalResistances || [];
		const immunities = effectiveDefenses.immunities || this._state.getImmunities?.() || [];
		const vulnerabilities = effectiveDefenses.vulnerabilities || this._state.getVulnerabilities?.() || [];
		const conditionImmunities = effectiveDefenses.conditionImmunities || this._state.getConditionImmunities?.() || [];

		// Also get defenses from active states (like Rage giving resistance to B/P/S)
		// Strip "damage:" prefix to match base resistance format
		const activeStateEffects = this._state.getActiveStateEffects?.() || [];
		const stateResistances = activeStateEffects
			.filter(e => e.type === "resistance" && !e.conditional)
			.map(e => (e.target || "").replace(/^damage:/i, ""));
		const stateImmunities = activeStateEffects
			.filter(e => e.type === "immunity")
			.map(e => (e.target || "").replace(/^damage:/i, ""));
		const stateConditionImmunities = activeStateEffects
			.filter(e => e.type === "conditionImmunity")
			.map(e => e.target);

		// Merge and deduplicate
		const allResistances = [...new Set([...resistances, ...stateResistances])];
		const allImmunities = [...new Set([...immunities, ...stateImmunities])];
		const allVulnerabilities = [...new Set([...vulnerabilities])];
		const allConditionImmunities = [...new Set([...conditionImmunities, ...stateConditionImmunities])];

		// Render resistances
		const resistancesEl = document.getElementById("charsheet-resistances");
		if (resistancesEl) {
			if (allResistances.length || conditionalResistances.length) {
				const unconditionalHtml = allResistances.map(r => {
					const isFromState = stateResistances.includes(r) && !resistances.includes(r);
					return `<span class="badge ${isFromState ? "badge-warning" : "badge-success"} mr-1" title="${isFromState ? "From active state" : "Base resistance"}">${this._formatDamageType(r)}</span>`;
				}).join("");
				const conditionalHtml = conditionalResistances.map(r => {
					const condition = CharacterSheetClassUtils.escapeHtml(r.conditional);
					return `<span class="badge badge-warning mr-1" title="Conditional resistance: ${condition}">${this._formatDamageType(r.type)} (${condition})</span>`;
				}).join("");
				resistancesEl.innerHTML = unconditionalHtml + conditionalHtml;
			} else {
				resistancesEl.innerHTML = `<span class="ve-muted">—</span>`;
			}
		}

		// Render immunities (damage)
		const immunitiesEl = document.getElementById("charsheet-immunities");
		if (immunitiesEl) {
			if (allImmunities.length) {
				immunitiesEl.innerHTML = allImmunities.map(i => {
					const isFromState = stateImmunities.includes(i) && !immunities.includes(i);
					return `<span class="badge ${isFromState ? "badge-warning" : "badge-primary"} mr-1" title="${isFromState ? "From active state" : "Base immunity"}">${this._formatDamageType(i)}</span>`;
				}).join("");
			} else {
				immunitiesEl.innerHTML = `<span class="ve-muted">—</span>`;
			}
		}

		// Render vulnerabilities
		const vulnerabilitiesEl = document.getElementById("charsheet-vulnerabilities");
		if (vulnerabilitiesEl) {
			if (allVulnerabilities.length) {
				vulnerabilitiesEl.innerHTML = allVulnerabilities.map(v =>
					`<span class="badge badge-danger mr-1">${this._formatDamageType(v)}</span>`,
				).join("");
			} else {
				vulnerabilitiesEl.innerHTML = `<span class="ve-muted">—</span>`;
			}
		}

		// Add condition immunities section if not exists
		let condImmunities = document.getElementById("charsheet-condition-immunities");
		if (!condImmunities && allConditionImmunities.length) {
			// Add condition immunities row dynamically
			const defenses = document.getElementById("charsheet-combat-defenses");
			if (defenses) {
				defenses.insertAdjacentHTML("beforeend", `
					<div class="charsheet__defense-row">
						<span class="charsheet__defense-label">Condition Immunities:</span>
						<span class="charsheet__defense-value" id="charsheet-condition-immunities">—</span>
					</div>
				`);
				condImmunities = document.getElementById("charsheet-condition-immunities");
			}
		}

		if (condImmunities) {
			if (allConditionImmunities.length) {
				// Get condition sources for hover support
				const conditionsList = this._page?.getConditionsListUnique?.() || this._page?.getConditionsList?.() || [];
				const conditionSourceMap = new Map();
				conditionsList.forEach(c => {
					if (!conditionSourceMap.has(c.name.toLowerCase())) {
						conditionSourceMap.set(c.name.toLowerCase(), c.source);
					}
				});

				condImmunities.innerHTML = allConditionImmunities.map(c => {
					const isFromState = stateConditionImmunities.includes(c) && !conditionImmunities.includes(c);
					const conditionSource = conditionSourceMap.get(c.toLowerCase()) || Parser.SRC_XPHB;
					const displayName = c.charAt(0).toUpperCase() + c.slice(1);

					// Create hoverable link
					let conditionContent = displayName;
					try {
						const hash = UrlUtil.encodeForHash([c, conditionSource].join(HASH_LIST_SEP));
						const hoverAttrs = Renderer.hover.getHoverElementAttributes({
							page: UrlUtil.PG_CONDITIONS_DISEASES,
							source: conditionSource,
							hash: hash,
						});
						conditionContent = `<a href="${UrlUtil.PG_CONDITIONS_DISEASES}#${hash}" ${hoverAttrs} class="charsheet__condition-immune-link">${displayName}</a>`;
					} catch {
						// Fall back to plain name if hover fails
						conditionContent = displayName;
					}

					return `<span class="badge ${isFromState ? "badge-warning" : "badge-info"} mr-1" title="${isFromState ? "From active state" : "Base immunity"}">${conditionContent}</span>`;
				}).join("");
			} else {
				condImmunities.innerHTML = `<span class="ve-muted">—</span>`;
			}
		}

		// Collapse the whole Defenses card to a thin affordance when the
		// character has no resistances/immunities/vulnerabilities at all.
		const defensesBody = document.getElementById("charsheet-combat-defenses");
		const hasAnyDefenses = allResistances.length || allImmunities.length
			|| allVulnerabilities.length || allConditionImmunities.length;
		this._setCombatSectionEmpty(defensesBody, !hasAnyDefenses);
	}

	/**
	 * Format damage type for display
	 */
	_formatDamageType (type) {
		if (!type) return "Unknown";
		// Strip "damage:" prefix if present, then capitalize first letter
		const clean = type.replace(/^damage:/i, "").trim();
		// Handle compound types like "bludgeoning, piercing, and slashing"
		return clean.split(/,\s*/).map(t => t.trim().charAt(0).toUpperCase() + t.trim().slice(1)).join(", ");
	}

	/**
	 * Render active combat effects from states, conditions, and features
	 */
	renderCombatEffects () {
		const container = document.getElementById("charsheet-combat-effects");
		if (!container) return;

		const effects = [];

		// Get all active state effects
		const stateEffects = this._state.getActiveStateEffects?.() || [];

		// Get conditions
		const conditions = this._state.getConditions?.() || [];

		// Process advantage/disadvantage effects
		const advantageTypes = new Map(); // rollType -> [sources]
		const disadvantageTypes = new Map();
		const bonusEffects = []; // {target, value, source}
		const otherEffects = []; // misc effects like speed changes

		// Separate effects: "attacksAgainst" means attacks AGAINST you (enemies' rolls)
		// Regular advantage/disadvantage applies to YOUR rolls
		const enemyAdvantageAgainst = new Map(); // Enemies have advantage attacking you
		const enemyDisadvantageAgainst = new Map(); // Enemies have disadvantage attacking you

		for (const effect of stateEffects) {
			const source = effect.stateName || "Active State";

			switch (effect.type) {
				case "advantage":
					// Check if this is "attacks against" (enemy's advantage) vs your own advantage
					if (effect.target?.includes("Against")) {
						if (!enemyAdvantageAgainst.has(effect.target)) enemyAdvantageAgainst.set(effect.target, []);
						enemyAdvantageAgainst.get(effect.target).push(source);
					} else {
						if (!advantageTypes.has(effect.target)) advantageTypes.set(effect.target, []);
						advantageTypes.get(effect.target).push(source);
					}
					break;
				case "disadvantage":
					// Check if this is "attacks against" (enemy's disadvantage) vs your own disadvantage
					if (effect.target?.includes("Against")) {
						if (!enemyDisadvantageAgainst.has(effect.target)) enemyDisadvantageAgainst.set(effect.target, []);
						enemyDisadvantageAgainst.get(effect.target).push(source);
					} else {
						if (!disadvantageTypes.has(effect.target)) disadvantageTypes.set(effect.target, []);
						disadvantageTypes.get(effect.target).push(source);
					}
					break;
				case "bonus":
					if (effect.value) {
						bonusEffects.push({
							target: effect.target,
							value: effect.value,
							source: source,
						});
					}
					break;
				case "speed":
					if (effect.value !== undefined) {
						otherEffects.push({
							icon: "🏃",
							text: `Speed ${effect.value >= 0 ? "+" : ""}${effect.value} ft`,
							source: source,
							type: "speed",
						});
					}
					break;
				case "ac":
					if (effect.value) {
						bonusEffects.push({
							target: "AC",
							value: effect.value,
							source: source,
						});
					}
					break;
				case "attackRoll":
					if (effect.value) {
						bonusEffects.push({
							target: "Attack Rolls",
							value: effect.value,
							source: source,
						});
					}
					break;
				case "damageRoll":
					if (effect.value) {
						bonusEffects.push({
							target: "Damage",
							value: effect.value,
							source: source,
						});
					}
					break;
				case "autoFail":
					otherEffects.push({
						icon: "❌",
						text: `Auto-fail ${this._formatEffectTarget(effect.target)}`,
						source: source,
						type: "negative",
					});
					break;
				case "incapacitated":
					otherEffects.push({
						icon: "💫",
						text: "Incapacitated (can't take actions/reactions)",
						source: source,
						type: "negative",
					});
					break;
				case "speedZero":
					otherEffects.push({
						icon: "🚫",
						text: "Speed is 0",
						source: source,
						type: "negative",
					});
					break;
			}
		}

		// Build HTML
		container.innerHTML = "";

		// Advantage section
		if (advantageTypes.size > 0) {
			const advSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			advSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-success mb-1">⬆️ Advantage On:</div>`);
			for (const [target, sources] of advantageTypes) {
				advSection.insertAdjacentHTML("beforeend", `
					<div class="charsheet__effect-item badge badge-success mr-1 mb-1" title="From: ${sources.join(", ")}">
						${this._formatEffectTarget(target)}
					</div>
				`);
			}
			container.append(advSection);
		}

		// Disadvantage section
		if (disadvantageTypes.size > 0) {
			const disadvSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			disadvSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-danger mb-1">⬇️ Disadvantage On:</div>`);
			for (const [target, sources] of disadvantageTypes) {
				disadvSection.insertAdjacentHTML("beforeend", `
					<div class="charsheet__effect-item badge badge-danger mr-1 mb-1" title="From: ${sources.join(", ")}">
						${this._formatEffectTarget(target)}
					</div>
				`);
			}
			container.append(disadvSection);
		}

		// Bonus section
		if (bonusEffects.length > 0) {
			const bonusSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			bonusSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-primary mb-1">📊 Bonuses:</div>`);
			for (const bonus of bonusEffects) {
				const sign = bonus.value >= 0 ? "+" : "";
				bonusSection.insertAdjacentHTML("beforeend", `
					<div class="charsheet__effect-item badge badge-primary mr-1 mb-1" title="From: ${bonus.source}">
						${bonus.target} ${sign}${bonus.value}
					</div>
				`);
			}
			container.append(bonusSection);
		}

		// Other effects (negative effects, speed changes, etc.)
		if (otherEffects.length > 0) {
			const otherSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			otherSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-warning mb-1">⚠️ Other Effects:</div>`);
			for (const effect of otherEffects) {
				const badgeClass = effect.type === "negative" ? "badge-danger" : (effect.type === "speed" ? "badge-info" : "badge-secondary");
				otherSection.insertAdjacentHTML("beforeend", `
					<div class="charsheet__effect-item badge ${badgeClass} mr-1 mb-1" title="From: ${effect.source}">
						${effect.icon} ${effect.text}
					</div>
				`);
			}
			container.append(otherSection);
		}

		// Enemy advantage against you (defensive: they have advantage)
		if (enemyAdvantageAgainst.size > 0) {
			const enemyAdvSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			enemyAdvSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-danger mb-1">⚠️ Enemies Have Advantage On:</div>`);
			for (const [target, sources] of enemyAdvantageAgainst) {
				enemyAdvSection.insertAdjacentHTML("beforeend", `
					<div class="charsheet__effect-item badge badge-danger mr-1 mb-1" title="From: ${sources.join(", ")}">
						${this._formatEffectTarget(target)}
					</div>
				`);
			}
			container.append(enemyAdvSection);
		}

		// Enemy disadvantage against you (defensive: they have disadvantage)
		if (enemyDisadvantageAgainst.size > 0) {
			const enemyDisadvSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			enemyDisadvSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-success mb-1">🛡️ Enemies Have Disadvantage On:</div>`);
			for (const [target, sources] of enemyDisadvantageAgainst) {
				enemyDisadvSection.insertAdjacentHTML("beforeend", `
					<div class="charsheet__effect-item badge badge-success mr-1 mb-1" title="From: ${sources.join(", ")}">
						${this._formatEffectTarget(target)}
					</div>
				`);
			}
			container.append(enemyDisadvSection);
		}

		// Critical hit range display
		const critRange = this._state.getCriticalRange?.() || 20;
		if (critRange < 20) {
			const critSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			critSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-warning mb-1">⚔️ Critical Hit Range:</div>`);
			critSection.insertAdjacentHTML("beforeend", `
				<div class="charsheet__effect-item badge badge-warning mr-1 mb-1" title="You score a critical hit on ${critRange}-20">
					${critRange}-20 (${21 - critRange} numbers)
				</div>
			`);
			container.append(critSection);
		}

		// Temp HP display with source
		const tempHp = this._state.getTempHp?.() || 0;
		const tempHpSource = this._state._data?.tempHpSource;
		if (tempHp > 0 && tempHpSource) {
			const tempHpSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			tempHpSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-info mb-1">💙 Temporary HP:</div>`);
			tempHpSection.insertAdjacentHTML("beforeend", `
				<div class="charsheet__effect-item badge badge-info mr-1 mb-1" title="From: ${tempHpSource}">
					${tempHp} THP (${tempHpSource})
				</div>
			`);
			container.append(tempHpSection);
		}

		// Conditional modifiers section (show available conditional bonuses)
		const conditionalAttack = this._state.getConditionalModifiersByType?.("attack") || [];
		const conditionalDamage = this._state.getConditionalModifiersByType?.("damage") || [];
		const allConditionals = [...conditionalAttack, ...conditionalDamage];
		if (allConditionals.length > 0) {
			const conditionalSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			conditionalSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-secondary mb-1">📝 Conditional Bonuses:</div>`);
			for (const mod of allConditionals) {
				const condText = this._state.formatConditionalText?.(mod) || mod.conditional;
				const sign = mod.value >= 0 ? "+" : "";
				const typeLabel = mod.type === "attack" ? "atk" : "dmg";
				conditionalSection.insertAdjacentHTML("beforeend", `
					<div class="charsheet__effect-item badge badge-secondary mr-1 mb-1" title="From: ${mod.name}">
						${sign}${mod.value} ${typeLabel} (${condText})
					</div>
				`);
			}
			container.append(conditionalSection);
		}

		// Item-granted defenses display (resistances, immunities, etc. from magic items)
		const itemDefenses = this._state.getItemDefenses?.() || {};
		const hasItemDefenses = (itemDefenses.resist?.length > 0) || (itemDefenses.immune?.length > 0) || (itemDefenses.vulnerable?.length > 0) || (itemDefenses.conditionImmune?.length > 0);
		if (hasItemDefenses) {
			const defSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			defSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-info mb-1">🛡️ Magic Item Defenses:</div>`);

			if (itemDefenses.resist?.length) {
				for (const d of itemDefenses.resist) {
					defSection.insertAdjacentHTML("beforeend", `
						<div class="charsheet__effect-item badge badge-info mr-1 mb-1" title="From: ${d.source}">
							Resist ${d.type.toTitleCase()} (${d.source})
						</div>
					`);
				}
			}
			if (itemDefenses.immune?.length) {
				for (const d of itemDefenses.immune) {
					defSection.insertAdjacentHTML("beforeend", `
						<div class="charsheet__effect-item badge badge-success mr-1 mb-1" title="From: ${d.source}">
							Immune ${d.type.toTitleCase()} (${d.source})
						</div>
					`);
				}
			}
			if (itemDefenses.vulnerable?.length) {
				for (const d of itemDefenses.vulnerable) {
					defSection.insertAdjacentHTML("beforeend", `
						<div class="charsheet__effect-item badge badge-danger mr-1 mb-1" title="From: ${d.source}">
							Vulnerable ${d.type.toTitleCase()} (${d.source})
						</div>
					`);
				}
			}
			if (itemDefenses.conditionImmune?.length) {
				for (const d of itemDefenses.conditionImmune) {
					defSection.insertAdjacentHTML("beforeend", `
						<div class="charsheet__effect-item badge badge-warning mr-1 mb-1" title="From: ${d.source}">
							Immune to ${d.type.toTitleCase()} (${d.source})
						</div>
					`);
				}
			}

			container.append(defSection);
		}

		// Active combat method effects (Wounding Strike, etc.)
		const methodEffects = this._state.getActiveCombatMethodEffects?.() || [];
		if (methodEffects.length > 0) {
			const methodSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			methodSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold mb-1" style="color: #c44;">🩸 Active Method Effects:</div>`);

			for (const effect of methodEffects) {
				const card = e_({outer: `
					<div class="charsheet__method-effect-card p-2 mb-1" style="border: 1px solid #c44; border-radius: 6px; background: rgba(204,68,68,0.08);">
						<div class="ve-flex ve-flex-v-center ve-flex-h-space-between mb-1">
							<span style="font-weight: bold;">⚔️ ${effect.name} → ${effect.weaponName || "weapon"}</span>
							<button class="ve-btn ve-btn-xs ve-btn-danger charsheet__method-effect-end" data-effect-id="${effect.id}" title="End this effect">✕</button>
						</div>
						<div class="ve-small ve-muted mb-1">
							${effect.ongoingDamage ? `${effect.ongoingDamage} ongoing damage` : ""}${effect.ongoingSaveType ? ` · ${effect.ongoingSaveType.charAt(0).toUpperCase() + effect.ongoingSaveType.slice(1)} save DC ${effect.saveDc} to end` : ""}${effect.alternativeEndCheck ? ` · or ${effect.alternativeEndCheck.charAt(0).toUpperCase() + effect.alternativeEndCheck.slice(1)} check DC ${effect.saveDc}` : ""}
						</div>
						<div class="ve-flex gap-1">
							${effect.ongoingDamage ? `<button class="ve-btn ve-btn-xs ve-btn-danger charsheet__method-effect-roll-damage" data-dice="${effect.ongoingDamage}" data-name="${effect.name}">🎲 Roll ${effect.ongoingDamage}</button>` : ""}
						</div>
					</div>
				`});

				// End effect button handler
				card.querySelector(".charsheet__method-effect-end")?.addEventListener("click", () => {
					this._state.deactivateCombatMethodEffect(effect.id);
					this.renderCombatEffects();
					this._page._saveCurrentCharacter?.();
					JqueryUtil.doToast({content: `${effect.name} ended.`});
				});

				// Roll ongoing damage button
				card.querySelector(".charsheet__method-effect-roll-damage")?.addEventListener("click", () => {
					const roll = this._parseDamage(effect.ongoingDamage);
					const rollBreakdown = roll.rolls.join(" + ") + (roll.modifier ? ` ${roll.modifier >= 0 ? "+" : ""}${roll.modifier}` : "");
					const ongoingGroups = [];
					this._pushDiceGroup(ongoingGroups, roll);
					void this._page.pAnimateDamageDice?.(ongoingGroups);
					this._page.showDiceResult({
						title: `${effect.name} — Ongoing Damage (${effect.weaponName || "weapon"})`,
						total: roll.total,
						subtitle: `${effect.ongoingDamage} → [${rollBreakdown}] = ${roll.total}`,
					});
				});

				methodSection.append(card);
			}
			container.append(methodSection);
		}

		// If no effects, show placeholder
		const hasTempHpDisplay = tempHp > 0 && tempHpSource;
		const hasConditionals = allConditionals.length > 0;
		const hasMethodEffects = methodEffects.length > 0;
		const hasAnyEffects = advantageTypes.size > 0 || disadvantageTypes.size > 0 || bonusEffects.length > 0 || otherEffects.length > 0 || enemyAdvantageAgainst.size > 0 || enemyDisadvantageAgainst.size > 0 || critRange < 20 || hasTempHpDisplay || hasConditionals || hasItemDefenses || hasMethodEffects;
		if (!hasAnyEffects) {
			container.innerHTML = `<div class="ve-muted ve-text-center py-2">No active effects</div>`;
		}
		this._setCombatSectionEmpty(container, !hasAnyEffects);
	}

	/**
	 * Format effect target for display
	 */
	_formatEffectTarget (target) {
		if (!target) return "Unknown";

		const targetLabels = {
			"attack": "Attack Rolls",
			"attackRoll": "Attack Rolls",
			"attacks": "Attack Rolls",
			"attack:melee": "Melee Attacks",
			"attack:ranged": "Ranged Attacks",
			"save": "Saving Throws",
			"saves": "Saving Throws",
			"savingThrow": "Saving Throws",
			"check": "Ability Checks",
			"checks": "Ability Checks",
			"abilityCheck": "Ability Checks",
			"check:str": "STR Checks",
			"check:dex": "DEX Checks",
			"check:con": "CON Checks",
			"check:int": "INT Checks",
			"check:wis": "WIS Checks",
			"check:cha": "CHA Checks",
			"strCheck": "STR Checks",
			"dexCheck": "DEX Checks",
			"conCheck": "CON Checks",
			"intCheck": "INT Checks",
			"wisCheck": "WIS Checks",
			"chaCheck": "CHA Checks",
			"save:str": "STR Saves",
			"save:dex": "DEX Saves",
			"save:con": "CON Saves",
			"save:int": "INT Saves",
			"save:wis": "WIS Saves",
			"save:cha": "CHA Saves",
			"strSave": "STR Saves",
			"dexSave": "DEX Saves",
			"conSave": "CON Saves",
			"intSave": "INT Saves",
			"wisSave": "WIS Saves",
			"chaSave": "CHA Saves",
			"initiative": "Initiative",
			"concentration": "Concentration",
			"deathSave": "Death Saves",
			// "Attacks against" targets
			"attacksAgainst": "Attacks Against You",
			"meleeAttacksAgainst": "Melee Attacks Against You",
			"rangedAttacksAgainst": "Ranged Attacks Against You",
			// Check-specific targets
			"check:sight": "Checks Requiring Sight",
			"check:hearing": "Checks Requiring Hearing",
		};

		return targetLabels[target] || target.charAt(0).toUpperCase() + target.slice(1);
	}

	/**
	 * Render combat resources (quick access in combat tab)
	 * Shows limited-use features relevant to combat (rage, ki, spell slots, etc.)
	 */
	renderCombatResources () {
		const container = document.getElementById("charsheet-combat-resources");
		if (!container) return;

		container.innerHTML = "";

		// (R23 #6) Use the SAME canonical generic-pool set as the Overview "Resources" panel
		// so the two lists are always identical. Previously this filtered with a name
		// all-list (+ `r.recharge` catch-all) that both dropped legitimate pools the Overview
		// showed (e.g. "Invoke Hell") and admitted ones the Overview hid — the mismatch
		// players reported. getGenericPoolResources() already excludes activatable abilities
		// (Abilities area) and interdiction-managed / redundant-rider pools (their own panel).
		const combatResources = this._state.getGenericPoolResources?.() || [];

		// Names already shown as real pools — used to defensively dedupe synthetic
		// rows so a Fighter feature never renders twice if it ever becomes a real
		// `_data.resources` entry.
		const shownNames = new Set(combatResources.map(r => (r.name || "").toLowerCase()));

		for (const resource of combatResources) {
			// Build pips - filled = available, empty = used. Each pip carries its
			// index so a single delegated listener (see _bindResourcePipClicks) can
			// route clicks for ANY pip, not just the first.
			const pipsHtml = Array.from({length: resource.max}, (_, i) => {
				const isFilled = i < resource.current;
				const title = isFilled ? `Set to ${i} (spend)` : `Set to ${i + 1} (restore)`;
				return `<span class="charsheet__resource-pip ${isFilled ? "" : "used"}" data-pip-index="${i}" title="${title}"></span>`;
			}).join("");
			const resourceEl = e_({outer: `
				<div class="charsheet__combat-resource-item mb-2" data-resource-id="${resource.id}">
					<div class="charsheet__combat-resource-name ve-small font-weight-bold">${resource.name}</div>
					<div class="charsheet__combat-resource-pips">${pipsHtml}</div>
					<div class="ve-small ve-muted">${resource.current}/${resource.max}${resource.recharge ? ` (${resource.recharge})` : ""}</div>
				</div>
			`});

			this._bindResourcePipClicks(resourceEl.querySelector(".charsheet__combat-resource-pips"), resource.id);

			container.append(resourceEl);
		}

		// (S3 #9/#10/#17) Synthetic Fighter resources tracked outside `_data.resources`
		// (Second Wind, Arcane Shot, Indomitable). Rendered as pips just like the real
		// pools, but pip clicks route to the kind-specific setters via
		// `_onSyntheticResourcePipClick` (the generic `setResourceCurrent` path can't
		// resolve their ids).
		const syntheticResources = this._state.getSyntheticCombatResources?.() || [];
		for (const resource of syntheticResources) {
			if (shownNames.has((resource.name || "").toLowerCase())) continue;
			const rechargeLabel = resource.recharge === "long" ? "Long Rest" : "Short/Long Rest";
			const pipsHtml = Array.from({length: resource.max}, (_, i) => {
				const isFilled = i < resource.current;
				const title = isFilled ? `Set to ${i} (spend)` : `Set to ${i + 1} (restore)`;
				return `<span class="charsheet__resource-pip ${isFilled ? "" : "used"}" data-pip-index="${i}" title="${title}"></span>`;
			}).join("");
			const resourceEl = e_({outer: `
				<div class="charsheet__combat-resource-item charsheet__combat-resource-item--synthetic mb-2" data-resource-kind="${resource.kind}">
					<div class="charsheet__combat-resource-name ve-small font-weight-bold">${resource.name}</div>
					<div class="charsheet__combat-resource-pips">${pipsHtml}</div>
					<div class="ve-small ve-muted">${resource.current}/${resource.max} (${rechargeLabel})</div>
				</div>
			`});

			this._bindSyntheticResourcePipClicks(resourceEl.querySelector(".charsheet__combat-resource-pips"), resource.kind);

			container.append(resourceEl);
		}

		// Render Sneak Attack toggle if character is a Rogue
		this._renderSneakAttackToggle(container);

		// Render weapon damage rider toggles (Colossus Slayer, Focused Quarry, …)
		this._renderWeaponDamageRiders(container);

		// Render Arcane Shot controls (Arcane Archer Fighter) — folded in here so
		// every limited-use combat surface lives under Combat Resources.
		this._renderArcaneShotToggle(container);

		// Only show the empty-state placeholder when nothing at all rendered
		// (no resource pips and no supplemental toggle sections).
		if (!container.children.length) {
			container.innerHTML = `<div class="ve-muted ve-text-center py-2">No combat resources</div>`;
		}
	}

	/**
	 * Compute the new `current` value for a resource after clicking the pip at
	 * `pipIndex`. Health-bar semantics: clicking a filled pip spends down to (and
	 * including) it; clicking an empty pip restores up to (and including) it.
	 * Pure + clamped — returns the resource's existing current for out-of-range or
	 * non-integer indices so callers can no-op safely.
	 * @param {{current: number, max: number}} resource
	 * @param {number} pipIndex
	 * @returns {number}
	 */
	_computeResourcePipClickCurrent (resource, pipIndex) {
		const max = Math.max(0, Number(resource?.max) || 0);
		const current = Math.max(0, Math.min(Number(resource?.current) || 0, max));
		const i = Number(pipIndex);
		if (!Number.isInteger(i) || i < 0 || i >= max) return current;
		// Filled pip (i < current): spend down to it. Empty pip: restore up to it.
		const next = i < current ? i : i + 1;
		return Math.max(0, Math.min(next, max));
	}

	/**
	 * Handle a pip click for a resource: resolve the resource, compute the new
	 * current via _computeResourcePipClickCurrent, persist it, and refresh the
	 * combat-resources panel plus the main resource displays.
	 * @param {string} resourceId
	 * @param {number} pipIndex
	 */
	_onResourcePipClick (resourceId, pipIndex) {
		const resource = (this._state.getResources() || []).find(r => r.id === resourceId);
		if (!resource) return;
		const next = this._computeResourcePipClickCurrent(resource, pipIndex);
		if (next === resource.current) return;
		this._state.setResourceCurrent(resourceId, next);
		this.renderCombatResources();
		// Also update the main resources display
		this._page._renderResources?.();
		this._page._features?._renderResources?.();
	}

	/**
	 * Bind pip clicks for a SYNTHETIC combat resource (Second Wind / Arcane Shot /
	 * Indomitable). Mirrors {@link _bindResourcePipClicks} but routes by `kind`
	 * instead of resource id.
	 * @param {*} pipsEl
	 * @param {string} kind
	 */
	_bindSyntheticResourcePipClicks (pipsEl, kind) {
		if (!pipsEl) return;
		pipsEl.addEventListener("click", (/** @type {*} */ e) => {
			const pip = e.target?.closest?.(".charsheet__resource-pip");
			if (!pip || (pipsEl.contains && !pipsEl.contains(pip))) return;
			this._onSyntheticResourcePipClick(kind, Number(pip.dataset?.pipIndex));
		});
	}

	/**
	 * Handle a pip click for a synthetic resource: resolve the current descriptor,
	 * compute the new remaining via the shared health-bar math, persist it through
	 * the kind-specific state setter, then refresh every dependent surface (combat
	 * resources, the Fighter panel whose badges share the same uses, and the Overview
	 * resource lists) so nothing goes stale.
	 * @param {string} kind
	 * @param {number} pipIndex
	 */
	_onSyntheticResourcePipClick (kind, pipIndex) {
		const resource = (this._state.getSyntheticCombatResources?.() || []).find(r => r.kind === kind);
		if (!resource) return;
		const next = this._computeResourcePipClickCurrent(resource, pipIndex);
		if (next === resource.current) return;
		if (!this._state.setSyntheticCombatResourceRemaining?.(kind, next)) return;
		this._page.saveCharacter?.();
		this.renderCombatResources();
		this.renderCombatFighter?.();
		this._page._renderResources?.();
		this._page._features?._renderResources?.();
	}

	/**
	 * Wire pip clicks for a resource using event delegation: a SINGLE listener on
	 * the pips container handles every pip (the prior per-first-pip wiring left all
	 * but the first pip dead). Reads the clicked pip's data-pip-index and routes to
	 * _onResourcePipClick.
	 * @param {*} pipsEl The `.charsheet__combat-resource-pips` container element.
	 * @param {string} resourceId
	 */
	_bindResourcePipClicks (pipsEl, resourceId) {
		if (!pipsEl) return;
		pipsEl.addEventListener("click", (/** @type {*} */ e) => {
			const pip = e.target?.closest?.(".charsheet__resource-pip");
			if (!pip || (pipsEl.contains && !pipsEl.contains(pip))) return;
			this._onResourcePipClick(resourceId, Number(pip.dataset?.pipIndex));
		});
	}

	/**
	 * Render Sneak Attack toggle and Cunning Strike options in combat resources
	 */
	_renderSneakAttackToggle (container) {
		if (!container) container = document.getElementById("charsheet-combat-resources");
		if (!container) return;

		// Remove existing sneak attack UI
		container.querySelector(".charsheet__sneak-attack-section")?.remove();

		const calcs = this._state.getFeatureCalculations?.();
		if (!calcs?.sneakAttack) return;

		const sa = calcs.sneakAttack;
		const isSpentThisRound = !this._isSneakAttackAvailableThisTurn();
		if (isSpentThisRound && this._sneakAttackEnabled) this._sneakAttackEnabled = false;

		// Calculate total CS dice cost for display
		const totalCSDiceCost = this._selectedCunningStrikes.reduce((sum, cs) => sum + cs.cost, 0);
		const baseSneakDice = parseInt(sa.dice) || Math.ceil((this._state.getClassLevel?.("Rogue") || 1) / 2);
		const effectiveSneakDice = Math.max(0, baseSneakDice - totalCSDiceCost);
		const avgDisplay = Math.floor(effectiveSneakDice * 3.5);

		const titleId = "cs-combat-sneak-title";

		// SectionShell — a labelled region so assistive tech can jump to it,
		// with the StateToggle in its primary-action slot.
		// StateToggle vocabulary — default ON / OFF / USED (colour + icon + text).
		const toggleState = isSpentThisRound ? "used" : this._sneakAttackEnabled ? "on" : "off";
		const toggleAria = {on: "armed", off: "off", used: "already used this round"}[toggleState];
		const toggleTitle = isSpentThisRound
			? "Sneak Attack already used this round"
			: this._sneakAttackEnabled
				? "Sneak Attack armed — click to turn off for the next damage roll"
				: "Click to arm Sneak Attack for the next damage roll";

		const section = csCombatSection({
			domClass: "charsheet__sneak-attack-section",
			titleId,
			icon: "sneak",
			title: "Sneak Attack",
			actionsHtml: csCombatStateToggle({
				state: toggleState,
				labelPrefix: "Sneak Attack",
				ariaState: toggleAria,
				title: toggleTitle,
				disabled: isSpentThisRound,
				domClass: "charsheet__sneak-attack-toggle",
			}),
		});

		// ===== StatusStrip: at-a-glance dice pool + average =====
		section.insertAdjacentHTML("beforeend", csCombatStatusStrip([
			{label: "Dice", value: `${effectiveSneakDice}d6`, valueWas: totalCSDiceCost > 0 ? `${baseSneakDice}d6` : ""},
			{label: "Avg", value: avgDisplay},
		], {ariaLabel: "Sneak Attack dice"}));

		section.querySelector(".charsheet__sneak-attack-toggle")?.addEventListener("click", () => {
			if (!this._isSneakAttackAvailableThisTurn()) {
				JqueryUtil.doToast({type: "warning", content: "Sneak Attack has already been used this round."});
				return;
			}
			this._sneakAttackEnabled = !this._sneakAttackEnabled;
			// Clear CS selections when disabling SA
			if (!this._sneakAttackEnabled) this._selectedCunningStrikes = [];
			this._announceCombat(this._sneakAttackEnabled ? "Sneak Attack armed" : "Sneak Attack off");
			this._renderSneakAttackToggle();
		});

		// ===== Condition indicators: real-time SA eligibility =====
		const ctx = this._lastAttackContext;
		const hasAdv = ctx?.hasAdvantage && !ctx?.hasDisadvantage;
		const hasDisadv = ctx?.hasDisadvantage && !ctx?.hasAdvantage;
		const allyAdj = this._sneakAttackHasAdjacentAlly;

		const conditions = e_({outer: `<div class="cs-combat-conditions"></div>`});

		if (hasAdv) {
			conditions.insertAdjacentHTML("beforeend", csCombatConditionPill({variant: "met", icon: "check", label: "Advantage", title: "Last attack had advantage"}));
		} else if (hasDisadv) {
			conditions.insertAdjacentHTML("beforeend", csCombatConditionPill({variant: "blocked", icon: "ban", label: "Disadvantage", title: "Last attack had disadvantage — Sneak Attack blocked"}));
		} else {
			conditions.insertAdjacentHTML("beforeend", csCombatConditionPill({variant: "none", icon: "none", label: "No advantage", title: "No advantage from the last attack"}));
		}

		// Ally-adjacent state toggle (clickable condition pill)
		const allyPill = e_({outer: csCombatConditionPill({
			variant: allyAdj ? "met" : "none",
			isToggle: true,
			pressed: allyAdj,
			icon: allyAdj ? "check" : "ally",
			label: "Ally within 5 ft",
			title: "Toggle: an ally is within 5 ft of the target",
		})});
		allyPill.addEventListener("click", () => {
			this._sneakAttackHasAdjacentAlly = !this._sneakAttackHasAdjacentAlly;
			this._announceCombat(this._sneakAttackHasAdjacentAlly ? "Ally within 5 feet: on" : "Ally within 5 feet: off");
			this._renderSneakAttackToggle();
		});
		conditions.append(allyPill);

		section.append(conditions);

		// ===== Notice: armed but trigger not met =====
		if (this._sneakAttackEnabled && !isSpentThisRound) {
			const triggerMet = hasAdv || allyAdj;
			if (!triggerMet && !hasDisadv) {
				section.insertAdjacentHTML("beforeend", `<div class="cs-combat-notice cs-combat-notice--warning">${csCombatIcon("warning")}<span>No advantage and no adjacent ally — Sneak Attack won't apply.</span></div>`);
			} else if (hasDisadv) {
				section.insertAdjacentHTML("beforeend", `<div class="cs-combat-notice cs-combat-notice--danger">${csCombatIcon("ban")}<span>Disadvantage blocks Sneak Attack.</span></div>`);
			}
		}

		// ===== Cunning Strike: FeatureBlock with spend options =====
		if (calcs.hasCunningStrike) {
			const csOptions = this._getCunningStrikeOptions(calcs);
			const saveDC = 8 + this._state.getProficiencyBonus() + this._state.getAbilityMod("dex");

			const cs = e_({outer: `<div class="cs-combat-feature"></div>`});
			cs.insertAdjacentHTML("beforeend", `
				<div class="cs-combat-feature__title">
					${csCombatIcon("dc")}<span>Cunning Strike</span>
					<span class="cs-combat-feature__meta">Save DC ${saveDC}</span>
				</div>
			`);

			const optList = e_({outer: `<div class="cs-combat-feature__options" role="group" aria-label="Cunning Strike options"></div>`});
			csOptions.forEach(opt => {
				const isSelected = this._selectedCunningStrikes.some(s => s.name === opt.name);
				const canAfford = opt.cost <= effectiveSneakDice + (isSelected ? opt.cost : 0);
				const disabled = !canAfford && !isSelected;
				const btn = e_({outer: `<button type="button" class="cs-combat-btn ${isSelected ? "cs-combat-btn--selected" : ""}" aria-pressed="${isSelected ? "true" : "false"}" title="${opt.desc} (costs ${opt.cost}d6)" ${disabled ? "disabled" : ""}><span>${opt.name}</span> <span class="cs-combat-btn__cost">${opt.cost}d6</span></button>`});

				btn.addEventListener("click", () => {
					if (isSelected) {
						this._selectedCunningStrikes = this._selectedCunningStrikes.filter(s => s.name !== opt.name);
					} else {
						if (opt.cost > effectiveSneakDice) {
							JqueryUtil.doToast({type: "warning", content: `Not enough Sneak Attack dice (need ${opt.cost}d6, have ${effectiveSneakDice}d6)`});
							return;
						}
						this._selectedCunningStrikes.push(opt);
					}
					this._announceCombat(isSelected ? `${opt.name} deselected` : `${opt.name} selected`);
					this._renderSneakAttackToggle();
				});
				optList.append(btn);
			});
			cs.append(optList);

			// Show selected CS effects summary
			if (this._selectedCunningStrikes.length) {
				const summary = this._selectedCunningStrikes.map(s => `${s.name} (${s.cost}d6)`).join(", ");
				cs.insertAdjacentHTML("beforeend", `<div class="cs-combat-feature__summary">Selected: ${summary} — ${totalCSDiceCost}d6 deducted from Sneak Attack.</div>`);
			}

			section.append(cs);
		}

		container.append(section);

		// Keep the Action Economy overview (B9) in step with active-state
		// toggles: activating a form can grant/remove a bonus-action attack, and
		// state toggles refresh here rather than through a full combat render.
		this.renderCombatActionEconomy?.();
	}

	/**
	 * Announce a combat state/roll change on a shared, persistent, visually
	 * hidden `aria-live="polite"` region (the RollResult primitive, minimal
	 * form). The region lives outside the re-rendered combat sections so
	 * screen readers reliably pick up the change; sighted users read the same
	 * state from the visible colour + icon + text on the control itself.
	 * @param {string} message
	 */
	_announceCombat (message) {
		if (!message || typeof document === "undefined" || !document.createElement) return;
		let region = document.getElementById("cs-combat-live-region");
		if (!region) {
			const host = document.body || document.documentElement;
			if (!host) return;
			region = document.createElement("div");
			region.id = "cs-combat-live-region";
			region.className = "cs-combat-sr-live";
			region.setAttribute("role", "status");
			region.setAttribute("aria-live", "polite");
			region.setAttribute("aria-atomic", "true");
			host.appendChild(region);
		}
		// Clear then set so an identical consecutive message still re-announces.
		region.textContent = "";
		const set = () => { region.textContent = message; };
		if (typeof requestAnimationFrame === "function") requestAnimationFrame(set);
		else set();
	}

	/**
	 * Render Weapon Damage Rider toggles (Colossus Slayer, Focused Quarry, …).
	 * Generic, data-driven from getFeatureCalculations().weaponDamageRiders. Each rider
	 * is a manual once-per-turn toggle whose dice are added to the next weapon damage
	 * roll. Riders are gated upstream by the active Hunter's Prey option / Primal Focus
	 * mode, so this method simply renders whatever riders are currently available.
	 */
	_renderWeaponDamageRiders (container) {
		if (!container) container = document.getElementById("charsheet-combat-resources");
		if (!container) return;

		// Remove existing rider UI before re-rendering
		container.querySelector(".charsheet__weapon-riders-section")?.remove();

		const calcs = this._state.getFeatureCalculations?.();
		const riders = calcs?.weaponDamageRiders || [];

		// Prune enabled flags for riders no longer available (e.g. after a Primal
		// Focus / Hunter's Prey change) so they can't reappear pre-enabled.
		const riderIds = new Set(riders.map(r => r.id));
		for (const id of Object.keys(this._weaponRiderEnabled)) {
			if (!riderIds.has(id)) delete this._weaponRiderEnabled[id];
		}

		if (!riders.length) return;

		// SectionShell — same disclosure chrome as the Sneak Attack fold-in, so the
		// three Combat Resources subclass surfaces read as one system. Each rider is
		// its own StateToggle row (no single section-level primary action).
		const section = csCombatSection({
			domClass: "charsheet__weapon-riders-section",
			titleId: "cs-combat-riders-title",
			icon: "weapon",
			title: "Weapon Damage Riders",
		});

		const list = e_({outer: `<div class="cs-combat-toggle-rows"></div>`});

		for (const rider of riders) {
			const oncePerTurn = rider.perTurn !== false;
			const isSpent = oncePerTurn && !this._isRiderAvailableThisTurn(rider.id);
			if (isSpent && this._weaponRiderEnabled[rider.id]) this._weaponRiderEnabled[rider.id] = false;
			// StateToggle vocabulary — default ON / OFF / USED (colour + icon + text).
			const toggleState = isSpent ? "used" : this._weaponRiderEnabled[rider.id] ? "on" : "off";
			const ariaState = isSpent ? "already used this round" : this._weaponRiderEnabled[rider.id] ? "armed" : "off";
			const title = isSpent
				? `${rider.name} already used this round`
				: this._weaponRiderEnabled[rider.id]
					? `Click to disable ${rider.name} for next damage roll`
					: `Click to enable ${rider.name} for next damage roll`;

			// Optional per-rider damage-type chooser (e.g. Terrorizing Force — changeable on
			// a long rest). Rendered only when the rider exposes `damageTypeChoices`.
			let typeSelectHtml = "";
			if (Array.isArray(rider.damageTypeChoices) && rider.damageTypeChoices.length) {
				const cur = (rider.damageType || "").toLowerCase();
				const opts = rider.damageTypeChoices
					.map(t => `<option value="${t}"${t === cur ? " selected" : ""}>${t}</option>`)
					.join("");
				typeSelectHtml = `<select class="form-control input-sm charsheet__weapon-rider-dmgtype" data-rider-id="${rider.id}" title="Damage type (changeable on a long rest)">${opts}</select>`;
			}

			const toggleHtml = csCombatStateToggle({
				state: toggleState,
				labelPrefix: rider.name,
				ariaState,
				title,
				disabled: isSpent,
				domClass: "charsheet__weapon-rider-toggle",
				attrs: {"data-rider-id": rider.id},
			});

			const row = e_({outer: `
				<div class="cs-combat-toggle-row">
					${toggleHtml}
					<span class="cs-combat-toggle-row__label"><strong>${rider.name}</strong> ${rider.dice}${rider.note ? ` <span class="ve-muted">(${rider.note})</span>` : ""}</span>
					${typeSelectHtml}
				</div>
			`});

			row.querySelector(".charsheet__weapon-rider-toggle")?.addEventListener("click", () => {
				if (rider.perTurn !== false && !this._isRiderAvailableThisTurn(rider.id)) {
					JqueryUtil.doToast({type: "warning", content: `${rider.name} has already been used this round.`});
					return;
				}
				this._weaponRiderEnabled[rider.id] = !this._weaponRiderEnabled[rider.id];
				this._announceCombat(this._weaponRiderEnabled[rider.id] ? `${rider.name} armed` : `${rider.name} off`);
				this._renderWeaponDamageRiders();
			});
			row.querySelector(".charsheet__weapon-rider-dmgtype")?.addEventListener("change", (e) => {
				const val = /** @type {HTMLSelectElement} */ (e.target).value || "";
				this._state.setWeaponRiderDamageType?.(rider.id, val);
				this._page.renderCharacter?.();
				this._page.saveCharacter?.();
			});
			list.append(row);

			if (rider.condition) {
				list.insertAdjacentHTML("beforeend", `<div class="cs-combat-toggle-row__note ve-small ve-muted">${rider.condition}</div>`);
			}
		}

		section.append(list);
		container.append(section);
	}

	/**
	 * Render Arcane Shot controls inside the Combat Resources panel (Arcane Archer
	 * Fighter). Folded in alongside the Sneak Attack / weapon-rider toggles so all
	 * limited-use combat surfaces live in one place. Shot names are hover links
	 * (full effect text lives on hover, not inline). Gated on hasArcaneShot();
	 * appends nothing when the subclass isn't present.
	 * @param {*} container The combat-resources container (defaults to the DOM node).
	 */
	_renderArcaneShotToggle (container) {
		if (!container) container = document.getElementById("charsheet-combat-resources");
		if (!container) return;

		// Remove existing Arcane Shot UI before re-rendering
		container.querySelector(".charsheet__arcane-shot-section")?.remove();

		if (!this._state.hasArcaneShot?.()) return;

		const calcs = this._state.getFeatureCalculations?.() || {};
		const max = this._state.getArcaneShotMax?.() ?? 0;
		const remaining = this._state.getArcaneShotRemaining?.() ?? 0;
		const dc = calcs.arcaneShotSaveDc;
		const ability = (calcs.arcaneShotAbility || "int").toUpperCase();
		const knownShots = this._state.getKnownArcaneShots?.() || [];
		const hasEverReady = !!calcs.hasEverReadyShot;
		const hasMagicArrow = !!calcs.hasMagicArrow;
		const hasCurvingShot = !!calcs.hasCurvingShot;

		// SectionShell + StatusStrip — same disclosure chrome as the Sneak Attack and
		// Weapon Damage Riders fold-ins. The at-a-glance DC + uses live in the strip;
		// the passives and known-shot list read as feature rows below it.
		const section = csCombatSection({
			domClass: "charsheet__arcane-shot-section",
			titleId: "cs-combat-arcaneshot-title",
			icon: "target",
			title: "Arcane Shot",
		});

		const stripItems = [];
		if (dc != null) stripItems.push({label: `Save DC (${ability})`, value: dc});
		stripItems.push({label: "Uses", value: `${remaining}/${max}`});
		section.insertAdjacentHTML("beforeend", csCombatStatusStrip(stripItems, {ariaLabel: "Arcane Shot"}));
		section.insertAdjacentHTML("beforeend", `<div class="cs-combat-toggle-row__note ve-small ve-muted">${csCombatIcon("info")} Track uses with the pips above.</div>`);

		if (hasEverReady) {
			section.insertAdjacentHTML("beforeend", `<div class="ve-small ve-muted">${csCombatIcon("spark")} <span class="bold">Ever-Ready Shot:</span> when you roll initiative with no uses left, regain one.${remaining === 0 ? ` <button class="cs-combat-btn cs-combat-btn--heal charsheet__combat-as-everready ml-1">${csCombatIcon("refresh")}<span>Regain (initiative)</span></button>` : ""}</div>`);
		}

		if (hasMagicArrow) {
			section.insertAdjacentHTML("beforeend", `<div class="ve-small ve-muted">${csCombatIcon("spark")} <span class="bold">Magic Arrow:</span> ranged weapon attacks count as magical.</div>`);
		}
		if (hasCurvingShot) {
			section.insertAdjacentHTML("beforeend", `<div class="ve-small ve-muted">${csCombatIcon("refresh")} <span class="bold">Curving Shot:</span> on a miss with a magic arrow, use a bonus action to reroll against a target in range.</div>`);
		}

		if (!knownShots.length) {
			section.insertAdjacentHTML("beforeend", `<div class="ve-muted ve-small">No Arcane Shot options known yet. Choose them when you gain or level up the Arcane Archer subclass.</div>`);
		} else {
			section.insertAdjacentHTML("beforeend", `<div class="ve-small ve-muted">${csCombatIcon("info")} Roll a ranged attack with a bow to choose and apply an Arcane Shot. Hover a name for its effect.</div>`);
			const shotsHtml = knownShots.map(shot => {
				let nameHtml = shot.name;
				if (this._page?.getHoverLink && shot.source) {
					try { nameHtml = this._page.getHoverLink(UrlUtil.PG_OPT_FEATURES, shot.name, shot.source); } catch (e) { nameHtml = shot.name; }
				}
				const srcAbbr = shot.source ? Parser.sourceJsonToAbv(shot.source) : "";
				return `<span class="charsheet__arcane-shot-pill ve-small"><span class="bold">${nameHtml}</span>${srcAbbr ? ` <span class="ve-muted">(${srcAbbr})</span>` : ""}</span>`;
			}).join("");
			section.insertAdjacentHTML("beforeend", `<div class="charsheet__arcane-shot-known ve-flex ve-flex-wrap">${shotsHtml}</div>`);
		}

		const refresh = () => {
			this._page.saveCharacter?.();
			this.renderCombatResources();
		};

		section.querySelector(".charsheet__combat-as-everready")?.addEventListener("click", () => {
			if (this._state.regainOneArcaneShot?.()) {
				refresh();
				JqueryUtil.doToast({type: "success", content: "Ever-Ready Shot: regained one use"});
			}
		});

		container.append(section);
	}

	/**
	 * Get available Cunning Strike options based on Rogue level
	 */
	_getCunningStrikeOptions (calcs) {
		const options = [];
		// Base options (level 5)
		options.push({name: "Poison", cost: 1, save: "con", desc: "Target must succeed CON save or be poisoned"});
		options.push({name: "Trip", cost: 1, save: "dex", desc: "Target must succeed DEX save or fall prone"});
		options.push({name: "Withdraw", cost: 1, save: null, desc: "Disengage as part of this attack"});

		// Improved options (level 11)
		if (calcs.hasImprovedCunningStrike) {
			options.push({name: "Daze", cost: 2, save: "con", desc: "Target must succeed CON save or be dazed"});
		}

		// Devious Strikes (level 14)
		if (calcs.hasDeviousStrikes) {
			options.push({name: "Knock Out", cost: 6, save: "con", desc: "Target must succeed CON save or fall unconscious"});
			options.push({name: "Obscure", cost: 3, save: "dex", desc: "Target must succeed DEX save or be blinded"});
		}

		return options;
	}

	/**
	 * Reset cunning strike selections (on SA use, round advance, combat end)
	 */
	_resetCunningStrikeSelections () {
		this._selectedCunningStrikes = [];
	}

	/**
	 * Render active states in combat tab - includes both active states and available activatable features
	 */
	renderCombatStates () {
		const container = document.getElementById("charsheet-combat-states");
		if (!container) return;

		// Refresh state reference in case called independently (not via render())
		this._state = this._page.getState();

		// Update combat tracker controls
		this._updateCombatTrackerUI();

		container.innerHTML = "";

		const allStates = this._state?.getActiveStates?.() || [];
		// Filter for only currently active, non-condition states
		const activeStates = allStates.filter(s => s.active && !s.isCondition);

		// Also check for concentration
		const concentration = this._state.getConcentration?.();

		// Get activatable features (same as Overview tab)
		const activatableFeatures = this._state.getActivatableFeatures?.() || [];
		// Filter out limited-use custom abilities - they're shown in Resources section
		const availableFeatures = activatableFeatures.filter(af => {
			if (af.isActive) return false;
			// (R21/R22) Classified limited-use ABILITIES (Healing Hands, Guided Strike,
			// Baleful Interdict, Forked Tongue, Charm Enemy, …) surface ONLY in the
			// features/abilities area with a canonical Use button — NEVER as activatable
			// "states". This MUST mirror the Overview _renderActiveStates() filter; the
			// Combat-tab States list previously omitted it, leaking abilities here (#4).
			if (CharacterSheetState.isActivatableAbilityEntry(af)) return false;
			// (R21 #14) Interdict boons are invoked from the abilities area / interdict
			// panel (expend a seal to turn on a durational buff) — not as un-flipped toggles.
			if (CharacterSheetState.isInterdictBoonEntry(af)) return false;
			// (R22 #4) Interdiction-managed (Baleful Interdict / Charm Enemy) and passive
			// "<X> Improvement" riders never belong in the activatable-states list either.
			if (CharacterSheetState.isHiddenFromGenericAbilitySurfaces(af.feature, this._state.getFeatures?.() || [])) return false;
			// Druid Wild Shape / Wild Companion / Zodiac Form are handled by the
			// dedicated Druid Resources modal — drop them from the generic list
			// (only once that module is available, so a failure never strands them).
			if (this._page?._druidResourcesEnabled && CharacterSheetState.isDruidResourceActivatable(af)) return false;
			// Exclude limited-use custom abilities (shown in Resources)
			if (af.feature?.isCustomAbility) {
				const customAbility = this._state.getCustomAbility?.(af.feature.id);
				if (customAbility?.mode === "limited") return false;
			}
			return true;
		});

		// === Section 1: Currently Active States ===
		const hasActiveStates = activeStates.length > 0 || concentration;

		if (hasActiveStates) {
			const activeSection = e_({outer: `<div class="charsheet__combat-active-section mb-2">
				<div class="ve-small ve-bold text-success mb-1">● Currently Active</div>
			</div>`});

			// Render concentration first if active
			if (concentration) {
				const conc = e_({outer: `
					<div class="charsheet__combat-state-item badge badge-info mr-1 mb-1">
						🔮 ${concentration.spellName || "Concentrating"}
						<span class="charsheet__state-remove ml-1" title="Break Concentration">&times;</span>
					</div>
				`});
				conc.querySelector(".charsheet__state-remove")?.addEventListener("click", (/** @type {*} */ e) => {
					e.stopPropagation();
					this._state.breakConcentration?.();
					this.renderCombatStates();
					this._page._renderActiveStates?.();
					this._page._saveCurrentCharacter?.();
					this._page._renderCharacter?.();
				});
				activeSection.append(conc);
			}

			for (const state of activeStates) {
				const stateType = CharacterSheetState.ACTIVE_STATE_TYPES?.[state.stateTypeId];
				const tooltipParts = [];
				// Zodiac Form: prefer the CHOSEN constellation's summary over the
				// generic "Zodiac Form" description so the tooltip reflects the
				// active form.
				const zodiacDef = state.stateTypeId === "zodiacForm" && state.zodiacForm?.formId
					? CharacterSheetState.getZodiacFormDef?.(state.zodiacForm.formId)
					: null;
				if (zodiacDef?.summary) tooltipParts.push(zodiacDef.summary);
				else if (stateType?.description) tooltipParts.push(stateType.description);
				if (stateType?.effects?.length) {
					const effectsStr = stateType.effects.map(e => e.type && e.target ? `${e.type} → ${e.target}` : e.type || "").filter(Boolean).join("; ");
					if (effectsStr) tooltipParts.push(`Effects: ${effectsStr}`);
				}
				// Surface human-readable info/note effect lines (e.g. Zodiac Form
				// triggered abilities that carry a precomputed value to display).
				if (Array.isArray(state.customEffects)) {
					const infoLines = state.customEffects
						.filter(e => e && (e.type === "info" || e.type === "note") && (e.label || e.text || e.value))
						.map(e => e.label || e.text || e.value);
					if (infoLines.length) tooltipParts.push(...infoLines);
				}
				const tooltip = tooltipParts.join("\n");

				// Check if this is a spell effect
				const isSpellEffect = state.isSpellEffect || state.sourceFeatureId?.startsWith("spell_");

				// Try to create hoverable name from source feature or spell
				let stateNameHtml = state.name || stateType?.name || state.stateTypeId;
				if (isSpellEffect) {
					// Create spell hover link with charsheet modifications (metamagic, rarity)
					try {
						const source = state.spellSource || Parser.SRC_XPHB;
						const spellData = this._page._spells?._allSpells?.find(s => s.name === state.name && s.source === source);
						const characterSpell = this._state.getSpells?.().find(s => s.name === state.name && s.source === source);
						stateNameHtml = this._page.getSpellHoverLink(state.name, source, spellData || null, characterSpell || null);
					} catch (e) {
						// Fall back to plain name
						stateNameHtml = state.name;
					}
				} else if (state.stateTypeId === "zodiacForm" && state.zodiacForm?.formId) {
					// Zodiac Form keeps the chosen constellation in state.name
					// (e.g. "Zodiac Form: Octopus"); resolve the hover to that
					// specific form's own entry rather than the generic feature.
					const formEntity = CharacterSheetClassUtils.getZodiacFormHoverEntity(state);
					if (formEntity) {
						stateNameHtml = CharacterSheetClassUtils.buildInlineEntriesHoverLink(state.name, formEntity.name, formEntity.entries) || stateNameHtml;
					}
				} else if (state.sourceFeatureId) {
					const feature = this._state.getFeatures?.().find(f => f.id === state.sourceFeatureId);
					if (feature) {
						stateNameHtml = this._page._getFeatureHoverLink?.(feature) || stateNameHtml;
					}
				}

				// Check if this state can be manually ended
				const isEndable = this._isStateEndable(state, stateType);
				const stateTrigger = this._state.getActiveStateTrigger?.(state.stateTypeId);
				const triggerAvailable = stateTrigger
					? this._isActionTypeAvailable(stateTrigger.actionType)
					: false;
				const triggerHtml = stateTrigger
					? `<button class="ve-btn ve-btn-xs ve-btn-warning charsheet__state-trigger ml-1" title="${stateTrigger.label}${stateTrigger.actionType ? ` (${this._getActionTypeShortLabel(stateTrigger.actionType)})` : ""}" ${triggerAvailable ? "" : "disabled"}>${stateTrigger.label}</button>`
					: "";

				// Round-remaining indicator
				let roundsLabel = "";
				if (this._state.isInCombat?.() && state.roundsRemaining != null) {
					if (state.roundsRemaining <= 1) {
						roundsLabel = ` <span class="ve-small text-warning" title="${state.roundsRemaining} round(s) left">(${state.roundsRemaining}r!)</span>`;
					} else {
						roundsLabel = ` <span class="ve-small ve-muted" title="${state.roundsRemaining} rounds left">(${state.roundsRemaining}r)</span>`;
					}
				}

				const stateEl = e_({outer: `
					<div class="charsheet__combat-state-item badge ${this._getStateBadgeClass(state.stateTypeId)} mr-1 mb-1" data-state-id="${state.id}" title="${tooltip}">
						${state.icon || stateType?.icon || "⚡"} <span class="charsheet__state-name-link">${stateNameHtml}</span>${roundsLabel}
						${stateType?.activationAction ? `<span class="ve-small" style="opacity: 0.7"> (${this._getActionTypeShortLabel(stateType.activationAction)})</span>` : ""}
						${triggerHtml}
						${isEndable ? `<span class="charsheet__state-remove ml-1" title="End">&times;</span>` : ""}
					</div>
				`});

				stateEl.querySelector(".charsheet__state-trigger")?.addEventListener("click", (/** @type {*} */ e) => {
					e.stopPropagation();
					this._useActiveStateTrigger(state.stateTypeId);
				});

				if (isEndable) {
					stateEl.querySelector(".charsheet__state-remove")?.addEventListener("click", (/** @type {*} */ e) => {
						e.stopPropagation();
						if (state.stateTypeId === "sunShield" && !this._tryConsumeStateToggleAction(stateType)) return;
						// (R47-a) Divine Favor narrative-boon toggles end via the OWNED path so
						// exactly this boon's state is removed (not deactivateState("custom"),
						// which would target every custom state by shared stateTypeId).
						if (state._dfNarrativeBoon && this._state.toggleDivineFavorBoonState) {
							this._state.toggleDivineFavorBoonState(state.sourceFeatureId);
							this.renderCombatStates();
							this.renderCombatDefenses();
							this.renderCombatEffects();
							this._page._renderActiveStates?.();
							this._page._saveCurrentCharacter?.();
							this._page._renderCharacter?.();
							return;
						}
						// Check if this is a custom ability state
						const customAbility = state.sourceFeatureId && this._state.getCustomAbilities?.()?.find(a => a.id === state.sourceFeatureId);
						if (customAbility) {
							this._state.toggleCustomAbility(customAbility.id);
							// Sync custom abilities panel
							this._page._customAbilitiesPanel?.render?.();
						} else {
							this._state.deactivateState(state.stateTypeId);
							// Bridge combat stance deactivation to the stance-specific system
							if (state.stateTypeId === "combatStance") {
								this._state.deactivateStance();
							}
						}
						this.renderCombatStates();
						this.renderCombatDefenses();
						this.renderCombatEffects();
						this._page._renderActiveStates?.();
						this._page._saveCurrentCharacter?.();
						this._page._renderCharacter?.();
					});
				}

				activeSection.append(stateEl);
			}

			container.append(activeSection);
		}

		// === Section 2: Available to Activate ===
		if (availableFeatures.length > 0) {
			const availableSection = e_({outer: `<div class="charsheet__combat-available-section">
				<div class="ve-small ve-muted mb-1">Available to Activate</div>
			</div>`});

			availableFeatures.forEach(({feature, activationInfo, resource, stateTypeId, customAbilityId}) => {
				const stateType = activationInfo.stateType || CharacterSheetState.ACTIVE_STATE_TYPES[stateTypeId];
				// For custom abilities, get the actual ability's icon; otherwise use state type icon
				let icon = stateType?.icon || "⚡";
				const customAbility = feature.isCustomAbility ? this._state.getCustomAbility?.(feature.id) : null;
				if (feature.isCustomAbility) {
					icon = customAbility?.icon || this._getCustomAbilityIcon(feature.category);
				}
				const resourceCost = resource?.cost || activationInfo.staminaCost || stateType?.resourceCost || 1;
				const hasResourceAvailable = !resource || resource.current >= resourceCost;

				const buttonText = this._getActivationButtonText({activationInfo, customAbility});

				// Get activation action type
				const activationAction = activationInfo.activationAction || stateType?.activationAction;
				const actionLabel = this._getActionLabel(activationAction);

				// Create hoverable feature name link
				const featureNameHtml = this._page._getFeatureHoverLink?.(feature) || feature.name;

				// Build resource info string
				let resourceInfo = "";
				let resourceTooltip = "";
				if (resource) {
					const shortName = this._getShortResourceName(resource.name);
					resourceInfo = `${resource.current}/${resource.max} ${shortName}`;
					resourceTooltip = `Uses ${resourceCost} ${resource.name} (${resource.current}/${resource.max} remaining)`;
				} else if (activationInfo.staminaCost) {
					resourceInfo = `${resourceCost} Stamina`;
					resourceTooltip = `Costs ${resourceCost} Stamina`;
				}

				const row = e_({outer: `
					<div class="charsheet__activatable-row ve-flex-v-center py-1 px-2 mb-1 rounded" 
						style="background: var(--cs-bg-surface, var(--rgb-bg-alt, #1e293b)); font-size: 0.85em;">
						<span class="mr-1">${icon}</span>
						<span class="flex-grow-1 text-truncate charsheet__state-name-link">${featureNameHtml}</span>
						<div class="ve-flex-v-center ml-auto">
							${actionLabel ? `<span class="ve-small ve-muted mr-1">${actionLabel}</span>` : ""}
							${resourceInfo ? `<span class="ve-small ve-muted mr-1" title="${resourceTooltip}">${resourceInfo}</span>` : ""}
							<button class="ve-btn ve-btn-xs ve-btn-success charsheet__activate-btn" 
								${!hasResourceAvailable ? `disabled title="Not enough ${resource?.name || "uses"} remaining"` : ""}>
								${buttonText}
							</button>
						</div>
					</div>
				`});

				row.querySelector(".charsheet__activate-btn")?.addEventListener("click", () => {
					this._activateCombatFeature(feature, stateTypeId, stateType, resource, resourceCost, activationInfo);
				});

				availableSection.append(row);
			});

			container.append(availableSection);
		}

		// Show message if nothing to display
		if (!hasActiveStates && availableFeatures.length === 0) {
			container.innerHTML = `<div class="ve-muted ve-text-center py-2">No activatable features</div>`;
		}

		// Set up quick activation buttons
		this._initQuickStateButtons();

		// Set up combat tracker buttons (idempotent)
		this._initCombatTracker();
	}

	_activateCombatFeature (feature, stateTypeId, stateType, resource, resourceCost, activationInfo = null) {
		// (R47-a) Divine Favor narrative boons are activatable, duration-tracked TOGGLES routed
		// through the OWNED toggleDivineFavorBoonState() so the created active state carries the
		// boon's parsed duration/round countdown — the generic _activateFeatureState pipeline
		// does not forward a parsed duration for toggle states.
		if (feature?._dfNarrativeBoon && this._state.toggleDivineFavorBoonState) {
			this._state.toggleDivineFavorBoonState(feature.id);
			this._page._saveCurrentCharacter?.();
			this.renderCombatStates();
			this._page._renderActiveStates?.();
			// (R42/B4) Activation consumes the boon's 1/day use — refresh the Resources tracker
			// (Overview + Features tab) so the spent use is reflected everywhere immediately.
			this._page._renderResources?.();
			this._page._features?._renderResources?.();
			this._page._renderCharacter?.();
			return;
		}
		this._page._activateFeatureState?.(feature, stateTypeId, stateType, resource, resourceCost, activationInfo);
		this.renderCombatStates();
		this._page._renderActiveStates?.();
		if (feature.isCustomAbility) {
			this._page._customAbilitiesPanel?.render?.();
		}
	}

	_tryConsumeStateToggleAction (stateType, activationInfo = null) {
		const actionType = activationInfo?.activationAction || stateType?.activationAction;
		if (!this._isActionTypeAvailable(actionType)) {
			const actionName = actionType === "bonus" ? "Bonus Action" : actionType === "reaction" ? "Reaction" : "Action";
			JqueryUtil.doToast({type: "warning", content: `${actionName} already used this round.`});
			return false;
		}
		this._consumeActionType(actionType);
		return true;
	}

	_getActivationButtonText ({activationInfo = null, customAbility = null} = {}) {
		const interactionMode = activationInfo?.interactionMode || (activationInfo?.isToggle ? "toggle" : "limited");
		const isLimitedUse = customAbility?.mode === "limited"
			|| interactionMode === "limited"
			|| interactionMode === "trigger"
			|| interactionMode === "instant";

		return isLimitedUse ? "Use" : "Activate";
	}

	/**
	 * Get action label for activation type
	 */
	_getActionLabel (actionType) {
		switch (actionType) {
			case "bonus": return "⚡ Bonus";
			case "action": return "⚔️ Action";
			case "reaction": return "🔄 Reaction";
			case "free": return "✨ Free";
			case "special": return "🔶 Special";
			case "varies": return "🔷 Varies";
			default: return "";
		}
	}

	_getActionTypeShortLabel (actionType) {
		switch (actionType) {
			case "bonus": return "Bonus";
			case "action": return "Action";
			case "reaction": return "Reaction";
			case "free": return "Free";
			case "special": return "Special";
			case "varies": return "Varies";
			default: return "";
		}
	}

	/**
	 * Get icon for custom ability category
	 */
	_getCustomAbilityIcon (category) {
		const icons = {
			"buff": "⬆️",
			"defensive": "🛡️",
			"offensive": "⚔️",
			"utility": "🔧",
			"homebrew": "🧪",
			"houserule": "📜",
			"boon": "✨",
			"curse": "💀",
			"temporary": "⏳",
			"item": "💎",
			"other": "⚡",
		};
		return icons[category] || "⚡";
	}

	/**
	 * Get a shortened version of a resource name for compact display
	 */
	_getShortResourceName (name) {
		if (!name) return "";
		// Common shortenings
		const shortenings = {
			"Bardic Inspiration": "Insp",
			"Channel Divinity": "CD",
			"Wild Shape": "WS",
			"Ki Points": "Ki",
			"Sorcery Points": "SP",
			"Superiority Dice": "SD",
			"Lay on Hands": "LoH",
			"Rage": "Rage",
			"Bladesong": "BS",
		};

		// Check for exact or partial match
		for (const [full, short] of Object.entries(shortenings)) {
			if (name.toLowerCase().includes(full.toLowerCase())) return short;
		}

		// Default: take first word or abbreviate
		const words = name.split(/\s+/);
		if (words.length === 1) return name.length > 8 ? `${name.slice(0, 6)}…` : name;
		// Take initials for multi-word names
		return words.map(w => w[0]).join("").toUpperCase();
	}

	_getStateBadgeClass (typeId) {
		const classes = {
			"rage": "badge-danger",
			"concentration": "badge-info",
			"wildshape": "badge-success",
			"dodge": "badge-primary",
			"defensivestance": "badge-warning",
			"combatStance": "badge-warning",
			"prone": "badge-secondary",
		};
		return classes[typeId] || "badge-secondary";
	}

	/**
	 * Check if a state can be manually ended
	 * Some passive features (like Tough, Unarmored Defense) shouldn't be endable
	 */
	_isStateEndable (state, stateType) {
		// If stateType explicitly says not endable
		if (stateType?.isPassive || stateType?.notEndable) return false;

		// If it has a resource cost, it's definitely endable (activated abilities)
		if (stateType?.resourceCost || stateType?.resourceName) return true;

		// Check source feature to see if it's a passive ability
		if (state.sourceFeatureId) {
			const feature = this._state.getFeatures?.().find(f => f.id === state.sourceFeatureId);
			if (feature) {
				const name = feature.name?.toLowerCase() || "";

				// Passive abilities that shouldn't be endable (truly passive, always-on effects)
				const passivePatterns = [
					/^unarmored defense$/i,
					/^tough$/i,
					/^durable$/i,
					/^observant$/i,
					/^alert$/i,
				];

				if (passivePatterns.some(p => p.test(name))) return false;
			}
		}

		return true;
	}

	_initQuickStateButtons () {
		// Only show Rage button if rage resource exists in parsed data
		const hasRageResource = this._state.getResources?.()?.some(r => r.name.toLowerCase().includes("rage"));
		document.getElementById("charsheet-combat-rage").style.display = hasRageResource ? "" : "none";

		// Show Concentration button if character has spellcasting
		// getSpellSlots returns an object keyed by level, not an array
		const spellSlots = this._state.getSpellSlots?.() || {};
		const hasSpellSlots = Object.values(spellSlots).some(slot => slot?.max > 0);
		const hasSpellcasting = hasSpellSlots || this._state.getSpells?.()?.length > 0;
		document.getElementById("charsheet-combat-concentrate").style.display = hasSpellcasting ? "" : "none";

		// Add hover attributes to Dodge button for action hover tooltip
		try {
			const dodgeHash = UrlUtil.encodeForHash(["Dodge", Parser.SRC_XPHB].join(HASH_LIST_SEP));
			const hoverAttrs = Renderer.hover.getHoverElementAttributes({
				page: UrlUtil.PG_ACTIONS,
				source: Parser.SRC_XPHB,
				hash: dodgeHash,
			});
			// Parse the attributes string and apply them to the button
			const dodgeBtn = document.getElementById("charsheet-combat-dodge");
			const tempEl = document.createElement("div");
			tempEl.innerHTML = `<span ${hoverAttrs}></span>`;
			const span = /** @type {*} */ (tempEl.firstChild);
			for (const attr of span.attributes) {
				dodgeBtn.setAttribute(attr.name, attr.value);
			}
		} catch (e) {
			// eslint-disable-next-line no-console
			console.warn("[Combat] Error adding Dodge hover attrs:", e);
		}

		// Rage button
		document.getElementById("charsheet-combat-rage").onclick = () => {
			if (this._state.isStateTypeActive?.("rage")) {
				this._state.deactivateState("rage");
			} else {
				// Check if character has rage resource
				const rageResource = this._state.getResources?.()?.find(r => r.name.toLowerCase().includes("rage"));
				if (rageResource && rageResource.current <= 0) {
					JqueryUtil.doToast({type: "warning", content: "No rage uses remaining!"});
					return;
				}
				this._state.activateState("rage");
				// Spend rage use
				if (rageResource) {
					this._state.setResourceCurrent(rageResource.id, rageResource.current - 1);
					this.renderCombatResources();
				}
			}
			this.renderCombatStates();
			this.renderCombatDefenses(); // Rage gives resistances
			this.renderCombatEffects(); // Rage gives advantage on STR checks/saves
			this.renderCombatVitality?.(); // World Tree: Vitality Surge temp HP + Life-Giving Force reminder
			this._page._renderActiveStates?.();
			this._page._saveCurrentCharacter?.();
			this._page._renderCharacter?.(); // Re-render to apply/remove effects
			this._updateQuickButtonStates();
		};

		// Dodge button
		document.getElementById("charsheet-combat-dodge").onclick = () => {
			if (this._state.isStateTypeActive?.("dodge")) {
				this._state.deactivateState("dodge");
			} else {
				this._state.activateState("dodge");
			}
			this.renderCombatStates();
			this.renderCombatEffects(); // Dodge gives advantage on DEX saves
			this._page._renderActiveStates?.();
			this._page._saveCurrentCharacter?.();
			this._page._renderCharacter?.(); // Re-render to apply/remove effects
			this._updateQuickButtonStates();
		};

		// Flanking button (optional rule). Deliberately a transient combat-tab toggle
		// (`_flankingEnabled`), NOT routed through the active-state system — this keeps
		// it separate from the TGTT Fighter Battle Tactic NAMED "Flanking". It is the
		// ONLY source of the situational +2 melee to-hit (via `_getCombatLocalAttackBonus`,
		// applied at roll time in `_rollAttack`). Not serialized, like the sneak-attack toggle.
		document.getElementById("charsheet-combat-flanking").onclick = () => {
			this._flankingEnabled = !this._flankingEnabled;
			this._updateQuickButtonStates();
		};

		// Apply Buff button — opens the same picker modal that the Overview tab
		// uses, so non-casters can track buffs cast on them by party members
		// (Aid, Bless, Haste, …) directly from the Combat tab without having to
		// hop back to Overview mid-fight.
		const applyBuffBtn = document.getElementById("charsheet-combat-apply-buff");
		if (applyBuffBtn) {
			applyBuffBtn.onclick = () => {
				if (typeof this._page._showApplyBuffModal === "function") this._page._showApplyBuffModal();
			};
		}

		// Concentration button (show modal to enter spell name)
		document.getElementById("charsheet-combat-concentrate").onclick = async () => {
			if (this._state.isConcentrating?.()) {
				const confirmed = await InputUiUtil.pGetUserBoolean(/** @type {*} */ ({
					title: "Break Concentration?",
					textYes: "Yes, break",
					textNo: "Cancel",
					htmlDescription: `Currently concentrating on: <strong>${this._state.getConcentration?.()?.spellName || "Unknown"}</strong>`,
				}));
				if (confirmed) {
					this._state.breakConcentration();
					this.renderCombatStates();
					this._page._renderActiveStates?.();
					this._page._saveCurrentCharacter?.();
					this._page._renderCharacter?.(); // Re-render to remove effects
				}
			} else {
				// Get character's known spells with concentration
				const allSpells = this._state.getSpells() || [];
				const concentrationSpells = allSpells.filter(spell => {
					// Check the stored concentration boolean property
					// (duration array format won't work for stored spells as duration is stored as string)
					return spell.concentration === true;
				});

				let spellName;
				if (concentrationSpells.length > 0) {
					// Build choice values - spell names plus a custom option
					const values = concentrationSpells.map(s => s.name);
					values.push("__OTHER__");

					const result = await InputUiUtil.pGetUserEnum({
						title: "Select Concentration Spell",
						values: values,
						fnDisplay: (val) => {
							if (val === "__OTHER__") return "-- Enter other spell --";
							const spell = concentrationSpells.find(s => s.name === val);
							return spell ? `${spell.name} (Level ${spell.level || 0})` : val;
						},
						isResolveItem: true,
						isAllowNull: true,
					});

					if (result === "__OTHER__") {
						spellName = await InputUiUtil.pGetUserString({title: "Enter spell name"});
					} else {
						spellName = result;
					}
				} else {
					// No concentration spells found, fallback to text input
					spellName = await InputUiUtil.pGetUserString({title: "Concentrating on which spell?"});
				}

				if (spellName) {
					this._state.setConcentration(spellName);
					this.renderCombatStates();
					this._page._renderActiveStates?.();
					this._page._saveCurrentCharacter?.();
					this._page._renderCharacter?.(); // Re-render to apply effects
				}
			}
			this._updateQuickButtonStates();
		};

		// Concentration Save button - roll CON save to maintain concentration
		document.getElementById("charsheet-combat-conc-save").onclick = async () => {
			if (!this._state.isConcentrating?.()) {
				JqueryUtil.doToast({type: "warning", content: "You are not currently concentrating on a spell."});
				return;
			}

			// Ask for damage amount to calculate DC
			const damageStr = await InputUiUtil.pGetUserString({
				title: "Concentration Save",
				default: "0",
				htmlDescription: `
					<p>Enter the damage you took to calculate the DC.</p>
					<p class="ve-muted ve-small">DC = max(10, damage ÷ 2)</p>
				`,
			});

			if (damageStr === null) return;

			const damage = parseInt(damageStr) || 0;
			const concentrationCheck = this._state.makeConcentrationCheck?.(damage) || {
				dc: Math.max(10, Math.floor(damage / 2)),
				bonus: 0,
				advantage: false,
				sources: [],
			};
			const dc = concentrationCheck.dc;
			const totalBonus = concentrationCheck.bonus;
			const hasAdvantage = concentrationCheck.advantage;

			// Roll the d20
			const roll1 = this._page.rollDice(1, 20);
			const roll2 = hasAdvantage ? this._page.rollDice(1, 20) : null;
			let finalRoll1 = roll1;
			let finalRoll2 = roll2;
			let roll = hasAdvantage ? Math.max(finalRoll1, finalRoll2) : finalRoll1;
			const total = roll + totalBonus;
			let success = total >= dc;
			let rerollMessage = "";

			if (!success && this._state.canUseFocusedConcentrationReroll?.()) {
				this._state.useFocusedConcentrationReroll?.();
				const rerolledDieLabel = hasAdvantage && finalRoll2 != null
					? (finalRoll1 <= finalRoll2 ? "lower concentration die" : "higher concentration die")
					: "concentration die";
				const rerolledValue = this._page.rollDice(1, 20);

				if (hasAdvantage && finalRoll2 != null) {
					if (finalRoll1 <= finalRoll2) finalRoll1 = rerolledValue;
					else finalRoll2 = rerolledValue;
					roll = Math.max(finalRoll1, finalRoll2);
				} else {
					finalRoll1 = rerolledValue;
					roll = finalRoll1;
				}

				success = (roll + totalBonus) >= dc;
				rerollMessage = ` Focused Spell rerolled the ${rerolledDieLabel}.`;
			}

			// Build result message
			let rollStr = `d20(${roll})`;
			if (hasAdvantage) {
				const sourceText = concentrationCheck.sources?.length
					? ` (${concentrationCheck.sources.join(", ")})`
					: "";
				rollStr = `d20(${finalRoll1}, ${finalRoll2}) = ${roll}${sourceText}`;
			}

			const bonusStr = totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`;
			const resultEmoji = success ? "✅" : "❌";
			const resultText = success ? `SUCCESS - Concentration maintained!${rerollMessage}` : `FAILED - Concentration broken!${rerollMessage}`;

			JqueryUtil.doToast({
				type: success ? "success" : "danger",
				content: `${resultEmoji} Concentration Save vs DC ${dc}: ${rollStr} ${bonusStr} = ${roll + totalBonus}. ${resultText}`,
			});

			// If failed, break concentration
			if (!success) {
				this._state.breakConcentration?.();
				this.renderCombatStates();
				this._page._renderActiveStates?.();
				this._page._saveCurrentCharacter?.();
				this._page._renderCharacter?.();
				this._updateQuickButtonStates();
			}
		};

		this._updateQuickButtonStates();
	}

	_updateQuickButtonStates () {
		// Update button active states - toggle both active class and button color
		const rageActive = this._state.isStateTypeActive?.("rage") || false;
		const rageBtn = document.getElementById("charsheet-combat-rage");
		rageBtn.classList.toggle("active", rageActive);
		rageBtn.classList.toggle("ve-btn-warning", rageActive); rageBtn.classList.toggle("ve-btn-danger", !rageActive);
		rageBtn.textContent = rageActive ? "End Rage" : "Rage";

		const dodgeActive = this._state.isStateTypeActive?.("dodge") || false;
		const dodgeBtn = document.getElementById("charsheet-combat-dodge");
		dodgeBtn.classList.toggle("active", dodgeActive);
		dodgeBtn.classList.toggle("ve-btn-warning", dodgeActive); dodgeBtn.classList.toggle("ve-btn-primary", !dodgeActive);
		dodgeBtn.textContent = dodgeActive ? "End Dodge" : "Dodge";

		// Flanking (transient optional-rule toggle, not an active state)
		const flankingActive = !!this._flankingEnabled;
		const flankingBtn = document.getElementById("charsheet-combat-flanking");
		if (flankingBtn) {
			flankingBtn.classList.toggle("active", flankingActive);
			flankingBtn.classList.toggle("ve-btn-warning", flankingActive); flankingBtn.classList.toggle("ve-btn-default", !flankingActive);
			flankingBtn.textContent = flankingActive ? "Flanking: ON" : "Flanking";
		}

		const concentrating = this._state.isConcentrating?.() || false;
		const concBtn = document.getElementById("charsheet-combat-concentrate");
		concBtn.classList.toggle("active", concentrating);
		concBtn.classList.toggle("ve-btn-info", concentrating); concBtn.classList.toggle("ve-btn-warning", !concentrating);
		if (concentrating) {
			const spellName = this._state.getConcentration?.()?.spellName;
			concBtn.textContent = spellName ? `🔮 ${spellName}` : "Concentrating";
		} else {
			concBtn.textContent = "Concentrate";
		}

		// Show/hide concentration save button based on whether concentrating
		const concSaveBtn = document.getElementById("charsheet-combat-conc-save");
		concSaveBtn.style.display = (concentrating) ? "" : "none";
	}

	/**
	 * Update combat tracker UI (Start/End button, round display, Next Round button)
	 */
	_updateCombatTrackerUI () {
		const inCombat = this._state?.isInCombat?.() || false;
		const round = this._state?.getCombatRound?.() || 0;

		const startBtn = document.getElementById("charsheet-combat-start");
		const roundDisplay = document.getElementById("charsheet-combat-round-display");
		const roundNum = document.getElementById("charsheet-combat-round-num");
		const nextBtn = document.getElementById("charsheet-combat-next-round");

		if (inCombat) {
			startBtn.textContent = "🏁 End Combat"; startBtn.classList.remove("ve-btn-success"); startBtn.classList.add("ve-btn-danger");
			roundDisplay.style.display = "";
			roundNum.textContent = round;
			nextBtn.style.display = "";
		} else {
			startBtn.textContent = "⚔️ Start Combat"; startBtn.classList.remove("ve-btn-danger"); startBtn.classList.add("ve-btn-success");
			roundDisplay.style.display = "none";
			nextBtn.style.display = "none";
		}
	}

	/**
	 * Surface a toast for any turn-start effects applied by the most recent
	 * `startCombat()`/`advanceRound()` call (Heroic Warrior's Heroic Inspiration
	 * grant, Champion Survivor's Heroic Rally heal, etc. — see
	 * `CharacterSheetState#getTurnStartEffects`/`applyTurnStartEffects`). Generic:
	 * any future turn-start effect source is surfaced automatically.
	 */
	_toastTurnStartEffects () {
		const effects = this._state.getLastTurnStartEffects?.() || [];
		for (const effect of effects) {
			if (effect.type === "grantInspiration") {
				JqueryUtil.doToast({type: "success", content: `${effect.source}: gained Heroic Inspiration!`});
			} else if (effect.type === "heal" && effect.amount) {
				JqueryUtil.doToast({type: "success", content: `${effect.source}: healed ${effect.amount} HP.`});
			}
		}
	}

	/**
	 * Initialise combat tracker button handlers (called once on first render)
	 */
	_initCombatTracker () {
		if (this._combatTrackerInitialised) return;
		this._combatTrackerInitialised = true;

		document.getElementById("charsheet-combat-start").onclick = () => {
			if (this._state.isInCombat?.()) {
				this._state.endCombat();
				this._lastSneakAttackRoundUsed = null;
				this._sneakAttackEnabled = false;
				this._sneakAttackHasAdjacentAlly = false;
				this._lastAttackContext = null;
				this._handOfHarmUsedThisTurn = false;
				this._flankingEnabled = false;
				this._resetTurnActionUsage();
				this._resetCunningStrikeSelections();
				JqueryUtil.doToast({type: "info", content: "Combat ended."});
			} else {
				this._state.startCombat();
				this._resolveHybridBloodlustAtTurnStart();
				this._lastSneakAttackRoundUsed = null;
				this._sneakAttackEnabled = false;
				this._sneakAttackHasAdjacentAlly = false;
				this._lastAttackContext = null;
				this._handOfHarmUsedThisTurn = false;
				this._flankingEnabled = false;
				this._resetTurnActionUsage();
				this._resetCunningStrikeSelections();
				JqueryUtil.doToast({type: "success", content: "Combat started — Round 1!"});
				this._toastTurnStartEffects();
			}
			this.renderCombatStates();
			this.renderCombatActions();
			this.renderCombatEffects();
			this._renderSneakAttackToggle?.();
			this._page._saveCurrentCharacter?.();
		};

		document.getElementById("charsheet-combat-next-round").onclick = () => {
			const expired = this._state.advanceRound?.() || [];
			this._resolveHybridBloodlustAtTurnStart();
			const round = this._state.getCombatRound?.() || 0;
			this._resetTurnActionUsage();
			this._sneakAttackHasAdjacentAlly = false;
			this._lastAttackContext = null;
			this._resetCunningStrikeSelections();

			if (expired) {
				JqueryUtil.doToast({type: "warning", content: `Round ${round} — expired: ${expired.join(", ")}`});
			} else {
				JqueryUtil.doToast({type: "info", content: `Round ${round}`});
			}
			this._toastTurnStartEffects();

			this.renderCombatStates();
			this.renderCombatActions();
			this._renderSneakAttackToggle?.();
			this.renderCombatDefenses();
			this.renderCombatEffects();
			this.renderCombatVitality?.(); // World Tree: refresh Life-Giving Force round-start reminder/roller
			this._page._renderActiveStates?.();
			this._page._saveCurrentCharacter?.();
			this._page._renderCharacter?.();
			this._updateQuickButtonStates();
		};
	}

	/**
	 * Render Combat Methods section (Thelemar homebrew)
	 */
	renderCombatMethods () {
		// Get combat method features from character
		const features = this._state.getFeatures();
		const combatMethods = features.filter(f => CharacterSheetClassUtils.isCombatMethod(f));

		// Main page section
		const section = document.getElementById("charsheet-combat-methods-section");
		const container = document.getElementById("charsheet-combat-methods");
		const dcDisplay = document.getElementById("charsheet-method-dc");
		const staminaDisplay = document.getElementById("charsheet-stamina-pool");

		// Combat Tab section
		const tabSection = document.getElementById("charsheet-combat-methods-tab-section");
		const tabContainer = document.getElementById("charsheet-combat-methods-tab");
		const tabDcDisplay = document.getElementById("charsheet-method-dc-tab");

		// Methods count mini-stats (current known / max learnable)
		const methodsCountDisplay = document.getElementById("charsheet-methods-count");
		const tabMethodsCountDisplay = document.getElementById("charsheet-methods-count-tab");
		const maxMethods = this._getCharacterMaxMethods();
		const fmtMethodsCount = (current) => `${current} / ${maxMethods > 0 ? maxMethods : "∞"}`;

		if (!section || !container) return;

		// Hide sections if no combat methods
		if (combatMethods.length === 0) {
			// The main read-only summary stays hidden until something is learned.
			section.style.display = "none";

			// But if the character has combat-method ACCESS (a class with a CTM
			// progression), keep the combat-tab section visible so the "Manage"
			// button is reachable to learn the first method.
			if (tabSection) {
				if (this._hasCombatMethodAccess()) {
					tabSection.style.display = "";

					const calcs = this._state.getFeatureCalculations();
					const profBonus = this._state.getProficiencyBonus();
					const methodDC = calcs.combatMethodDc ??
						(8 + profBonus + Math.max(this._state.getAbilityMod("str"), this._state.getAbilityMod("dex")));
					if (tabDcDisplay) tabDcDisplay.textContent = methodDC;

					if (methodsCountDisplay) methodsCountDisplay.textContent = fmtMethodsCount(0);
					if (tabMethodsCountDisplay) tabMethodsCountDisplay.textContent = fmtMethodsCount(0);

					this._state.ensureStaminaInitialized?.();
					const staminaMax = this._state.getStaminaMax?.() ?? 0;
					if (staminaDisplay) staminaDisplay.textContent = staminaMax;
					this._updateStaminaDisplay();

					if (tabContainer) {
						tabContainer.innerHTML = `<div class="ve-muted ve-text-center py-2">No combat methods known yet. Click <strong>Manage</strong> to learn your first one.</div>`;
					}
				} else {
					tabSection.style.display = "none";
				}
			}
			return;
		}

		section.style.display = "";
		if (tabSection) tabSection.style.display = "";
		container.innerHTML = "";
		if (tabContainer) tabContainer.innerHTML = "";

		// Use state-calculated Method DC (handles Monk +1 base, WIS mod, Hexblade/Bladesinger override)
		const calcs = this._state.getFeatureCalculations();
		const profBonus = this._state.getProficiencyBonus();
		const methodDC = calcs.combatMethodDc ??
			(8 + profBonus + Math.max(this._state.getAbilityMod("str"), this._state.getAbilityMod("dex")));
		if (dcDisplay) dcDisplay.textContent = methodDC;
		if (tabDcDisplay) tabDcDisplay.textContent = methodDC;

		// Methods count (known / max)
		const methodsCountText = fmtMethodsCount(combatMethods.length);
		if (methodsCountDisplay) methodsCountDisplay.textContent = methodsCountText;
		if (tabMethodsCountDisplay) tabMethodsCountDisplay.textContent = methodsCountText;

		// Ensure stamina is initialized, then read from state (single source of truth)
		this._state.ensureStaminaInitialized();
		const staminaMax = this._state.getStaminaMax();
		if (staminaDisplay) staminaDisplay.textContent = staminaMax;
		if (this._state.getStaminaCurrent() === null || this._state.getStaminaCurrent() === undefined) {
			this._state.setStaminaCurrent(staminaMax);
		}

		// Update stamina display
		this._updateStaminaDisplay();

		// Group methods by tradition
		const methodsByTradition = new Map();
		for (const method of combatMethods) {
			const tradCode = this._getMethodTradition(method);
			if (!methodsByTradition.has(tradCode)) {
				methodsByTradition.set(tradCode, []);
			}
			methodsByTradition.get(tradCode).push(method);
		}

		// Render methods grouped by tradition to both containers
		this._renderMethodsToContainer(container, methodsByTradition, {showUseButton: false});
		this._renderMethodsToContainer(tabContainer, methodsByTradition, {showUseButton: true});
	}

	/**
	 * Render the Primal Focus control block on the Combat tab (TGTT Ranger).
	 * Surfaces the active focus mode, a Predator/Prey switch (consuming a Focus Switch),
	 * the stateful in-play actions (Hunter's Dodge uses, Focused Quarry toggle), and the
	 * full mode-ability catalog as focus-gated reminder rows. The granted combat methods
	 * themselves remain in (and are usable from) the Combat Methods section above.
	 */
	renderCombatRanger () {
		const section = document.getElementById("charsheet-combat-ranger-section");
		const container = document.getElementById("charsheet-combat-ranger");
		if (!section || !container) return;

		if (!this._state.hasPrimalFocus?.()) {
			section.style.display = "none";
			container.innerHTML = "";
			return;
		}
		section.style.display = "";
		container.innerHTML = "";

		const calcs = this._state.getFeatureCalculations?.() || {};
		const mode = this._state.getPrimalFocusMode?.() || "predator";
		const isPredator = mode === "predator";
		const switchesRemaining = this._state.getFocusSwitchesRemaining?.() ?? 0;
		const isUnlimited = switchesRemaining === "Unlimited" || calcs.focusSwitchesMax === "Unlimited";
		const switchesMax = calcs.focusSwitchesMaxNum ?? calcs.focusSwitchesMax ?? 1;
		const switchesText = isUnlimited ? "∞" : `${switchesRemaining}/${switchesMax}`;

		const block = e_({tag: "div", clazz: "charsheet__combat-ranger"});

		let html = `
			<div class="ve-flex-v-center gap-2 mb-2 ve-flex-wrap">
				<span class="badge ${isPredator ? "badge-danger" : "badge-info"}" style="font-size: 1em; padding: 5px 10px;">${csCombatIcon(isPredator ? "target" : "shield")} ${isPredator ? "Predator" : "Prey"}</span>
				<span class="badge badge-secondary" title="Focus Switches remaining (per long rest)">${csCombatIcon("refresh")} ${switchesText}</span>
				${isUnlimited ? "" : `<button class="cs-combat-btn charsheet__combat-pf-switches-edit" title="Manually set remaining Focus Switches" aria-label="Set remaining Focus Switches">${csCombatIcon("edit")}</button>`}
			</div>
			<div class="ve-flex gap-2 mb-2">
				<button class="cs-combat-btn ${isPredator ? "cs-combat-btn--selected" : ""} charsheet__combat-pf-btn" data-mode="predator" ${isPredator ? "disabled" : ""}>${csCombatIcon("target")}<span>Predator</span></button>
				<button class="cs-combat-btn ${!isPredator ? "cs-combat-btn--selected" : ""} charsheet__combat-pf-btn" data-mode="prey" ${!isPredator ? "disabled" : ""}>${csCombatIcon("shield")}<span>Prey</span></button>
			</div>`;

		// Stateful in-play actions for the active mode
		if (isPredator) {
			const quarrySet = !!this._state.getFocusedQuarry?.();
			html += `
				<div class="ve-flex-v-center gap-2 mb-2">
					<span class="badge ${quarrySet ? "badge-danger" : "badge-secondary"}" title="Focused Quarry (Predator focus)">${csCombatIcon("target")} Focused Quarry: ${quarrySet ? "Set" : "None"}</span>
					<button class="cs-combat-btn ${quarrySet ? "" : "cs-combat-btn--primary"} charsheet__combat-quarry-toggle">${csCombatIcon(quarrySet ? "cross" : "target")}<span>${quarrySet ? "Clear" : "Designate"}</span></button>
				</div>`;
		} else {
			const dodgeRemaining = this._state.getHuntersDodgeRemaining?.() ?? 0;
			const dodgeMax = calcs.huntersDodgeUses ?? 0;
			if (dodgeMax > 0) {
				// Dedicated use-button row. The name is hoverable (renders the
				// reminder note via the renderer's inline-hover), matching the
				// Combat-method rows; falls back to plain text if unavailable.
				const dodgeName = CharacterSheetClassUtils.buildInlineEntriesHoverLink?.("Hunter's Dodge", "Hunter's Dodge", [CharacterSheetClassUtils.getHuntersDodgeNote?.()]) || "Hunter's Dodge";
				const dodgeNote = CharacterSheetClassUtils.getHuntersDodgeNote?.() || "";
				// Standard ranger-ability grid (name / badge column / note) so the row
				// matches its sibling focus-mode reminder rows, while the badge column
				// keeps the interactive uses badge + Use button + edit manual-edit (Combat).
				html += `
				<div class="charsheet__ranger-ability-row">
					<span class="charsheet__ranger-ability-name">${csCombatIcon("shield")} ${dodgeName}</span>
					<span class="charsheet__ranger-ability-badge">
						<span class="badge ${dodgeRemaining > 0 ? "badge-info" : "badge-danger"}">${dodgeRemaining}/${dodgeMax}</span>
						<button class="cs-combat-btn cs-combat-btn--primary charsheet__combat-dodge-use" ${dodgeRemaining > 0 ? "" : "disabled"}>${csCombatIcon("shield")}<span>Use</span></button>
						<button class="cs-combat-btn charsheet__combat-dodge-edit" title="Manually set remaining Hunter's Dodge uses" aria-label="Set remaining Hunter's Dodge uses">${csCombatIcon("edit")}</button>
					</span>
					<span class="charsheet__ranger-ability-note">${dodgeNote}</span>
				</div>`;
			}
		}

		// Full mode-ability catalog as focus-gated reminder rows (no fabricated numbers).
		// Methods (granted combat methods) and applied-elsewhere passives are filtered
		// out generically — methods are usable from the Combat Methods section above and
		// applied-elsewhere effects are already baked into other panels.
		const abilities = (CharacterSheetClassUtils.getPrimalFocusModeAbilities?.(mode, {
			upgrade1: !!calcs.primalFocusUpgrade1,
			upgrade2: !!calcs.primalFocusUpgrade2,
			upgrade3: !!calcs.primalFocusUpgrade3,
		}) || []).filter(ab => CharacterSheetClassUtils.isPrimalFocusAbilityRowEligible?.(ab));
		if (abilities.length) {
			html += `<div class="charsheet__combat-ranger-abilities mt-1">`;
			abilities.forEach(ab => {
				let badge;
				if (ab.kind === "usable") {
					const at = ab.actionType;
					const actKind = at === "bonus" ? "bonus" : at === "reaction" ? "reaction" : "action";
					badge = csCombatActionChip(actKind);
				} else {
					badge = `<span class="cs-combat-chip" title="Passive / situational">${csCombatIcon("spark")}<span>Passive</span></span>`;
				}
				// Hoverable name (renders the note as an inline-hover entry, like the
				// Combat-method rows above); falls back to plain text.
				const nameHtml = CharacterSheetClassUtils.buildInlineEntriesHoverLink?.(ab.name, ab.name, [ab.note]) || ab.name;
				html += `
					<div class="charsheet__ranger-ability-row">
						<span class="charsheet__ranger-ability-name">${nameHtml}</span>
						<span class="charsheet__ranger-ability-badge">${badge}</span>
						<span class="charsheet__ranger-ability-note">${ab.note}</span>
					</div>`;
			});
			html += `</div>`;
		}

		block.innerHTML = html;
		container.appendChild(block);

		// Attach listeners to the freshly-created elements (avoids handler pileup across renders)
		block.querySelectorAll(".charsheet__combat-pf-btn").forEach(btn => {
			btn.addEventListener("click", () => {
				const targetMode = btn.dataset.mode;
				if (targetMode === (this._state.getPrimalFocusMode?.() || "predator")) return;
				const success = this._state.switchPrimalFocus?.();
				if (success) {
					this._page.saveCharacter();
					this._page.renderCharacter();
					JqueryUtil.doToast({type: "success", content: `Switched to ${targetMode.toTitleCase()} Focus`});
				} else {
					JqueryUtil.doToast({type: "warning", content: "No focus switches remaining! Rest to regain switches."});
				}
			});
		});
		block.querySelector(".charsheet__combat-dodge-use")?.addEventListener("click", () => {
			const success = this._state.useHuntersDodge?.();
			if (success) {
				this._page.saveCharacter();
				this._page.renderCharacter();
				JqueryUtil.doToast({type: "success", content: "Used Hunter's Dodge"});
			} else {
				JqueryUtil.doToast({type: "warning", content: "No Hunter's Dodge uses remaining! Rest to regain uses."});
			}
		});
		block.querySelector(".charsheet__combat-pf-switches-edit")?.addEventListener("click", async () => {
			const max = calcs.focusSwitchesMaxNum ?? calcs.focusSwitchesMax ?? 1;
			const cur = this._state.getFocusSwitchesRemaining?.();
			const next = await InputUiUtil.pGetUserNumber({
				title: "Set remaining Focus Switches",
				min: 0,
				max,
				int: true,
				default: typeof cur === "number" ? cur : max,
			});
			if (next == null || typeof next === "symbol") return;
			if (this._state.setFocusSwitchesRemaining?.(next)) {
				this._page.saveCharacter();
				this._page.renderCharacter();
			}
		});
		block.querySelector(".charsheet__combat-dodge-edit")?.addEventListener("click", async () => {
			const max = calcs.huntersDodgeUses ?? 0;
			const cur = this._state.getHuntersDodgeRemaining?.() ?? 0;
			const next = await InputUiUtil.pGetUserNumber({
				title: "Set remaining Hunter's Dodge uses",
				min: 0,
				max,
				int: true,
				default: cur,
			});
			if (next == null || typeof next === "symbol") return;
			if (this._state.setHuntersDodgeRemaining?.(next)) {
				this._page.saveCharacter();
				this._page.renderCharacter();
			}
		});
		block.querySelector(".charsheet__combat-quarry-toggle")?.addEventListener("click", () => {
			const quarrySet = !!this._state.getFocusedQuarry?.();
			this._state.setFocusedQuarry?.(quarrySet ? null : "manual");
			this._page.saveCharacter();
			this._page.renderCharacter();
			JqueryUtil.doToast({type: "success", content: quarrySet ? "Cleared Focused Quarry" : "Designated Focused Quarry"});
		});
	}

	/**
	 * Druid Resources combat-tab panel (Wild Shape / Wild Companion / Zodiac Form).
	 *
	 * Self-contained (own `#charsheet-combat-druid-section` + inner container) so it does
	 * not collide with the generic Resources panel or any other combat-tab panel. The
	 * panel is a thin VIEW: its data model comes from the dedicated Druid Resources
	 * module (`page._druidResources.getCombatSummary()`, single source of truth) and every
	 * action delegates to that module's public methods — so picker/spend logic is never
	 * duplicated and the modal + combat tab stay in sync. Gated on the module being
	 * available AND applicable (parallels `renderCombatRanger`'s `hasPrimalFocus` gate);
	 * if the module failed to load, the panel hides and the generic Active-States list
	 * still surfaces the rows (no stranding).
	 */
	renderCombatDruidResources () {
		const section = document.getElementById("charsheet-combat-druid-section");
		const container = document.getElementById("charsheet-combat-druid");
		if (!section || !container) return;

		const druid = this._page?._druidResources;
		const summary = (this._page?._druidResourcesEnabled && druid?.getCombatSummary)
			? druid.getCombatSummary()
			: null;

		if (!summary || !summary.applicable) {
			section.style.display = "none";
			container.innerHTML = "";
			return;
		}
		section.style.display = "";
		container.innerHTML = "";

		const block = e_({tag: "div", clazz: "charsheet__combat-druid"});
		let html = "";

		// --- Wild Shape ---
		const ws = summary.wildShape;
		const beastNameHtml = ws.inForm ? CharacterSheetClassUtils.buildCreatureHoverNameHtml(ws.beast, "ve-bold charsheet__combat-druid-beast") : "";
		const beastStatsHtml = ws.inForm ? CharacterSheetClassUtils.buildCreatureStatLineHtml(ws.beast) : "";
		if (ws.has) {
			html += `
				<div class="charsheet__combat-druid-block cs-combat-feature">
					<div class="cs-combat-feature__title">
						${csCombatIcon("beast")}<span class="charsheet__combat-druid-label">Wild Shape</span>
						${csCombatPoolCaption(ws.current, ws.max)}
					</div>
					${ws.rechargeLabel ? `<div class="ve-small ve-muted charsheet__combat-druid-note mt-1">${ws.rechargeLabel}</div>` : ""}
					${ws.inForm ? `<div class="ve-small charsheet__combat-druid-active mt-1">Currently: ${beastNameHtml}</div>${beastStatsHtml ? `<div class="ve-small ve-muted charsheet__combat-druid-beaststats">${beastStatsHtml}</div>` : ""}` : ""}
					${ws.usesKnownForms ? `<div class="ve-small ve-muted charsheet__combat-druid-knownforms mt-1">Known Forms: ${ws.knownForms.length}/${ws.knownFormsMax}</div>` : ""}
					<div class="charsheet__combat-druid-actions cs-combat-feature__options">
						${ws.inForm
		? `<button class="cs-combat-btn cs-combat-btn--danger charsheet__combat-druid-end" title="Revert to your normal form (no use refunded)">${csCombatIcon("reset")}<span>End Wild Shape</span></button>`
		: `<button class="cs-combat-btn cs-combat-btn--primary charsheet__combat-druid-transform" ${ws.canTransform ? "title=\"Pick a beast to assume; spends 1 use after you choose\"" : "disabled title=\"No Wild Shape uses remaining\""}>${csCombatIcon("beast")}<span>Transform…</span></button>`}
						${ws.usesKnownForms ? `<button class="cs-combat-btn charsheet__combat-druid-addform" ${ws.canAddForm ? "title=\"Learn a new Beast form\"" : "disabled title=\"You already know the maximum number of forms\""}>Add Form…</button>` : ""}
						<button class="cs-combat-btn charsheet__combat-druid-minus" ${ws.current > 0 ? "title=\"Spend 1 Wild Shape use\"" : "disabled title=\"No uses to spend\""} aria-label="Spend one Wild Shape use">−</button>
						<button class="cs-combat-btn charsheet__combat-druid-plus" ${ws.current < ws.max ? "title=\"Restore 1 Wild Shape use\"" : "disabled title=\"Already at maximum\""} aria-label="Restore one Wild Shape use">+</button>
					</div>
				</div>`;
		}

		// --- Wild Companion ---
		const wc = summary.wildCompanion;
		if (wc.has) {
			html += `
				<div class="charsheet__combat-druid-block cs-combat-feature">
					<div class="cs-combat-feature__title">
						${csCombatIcon("familiar")}<span class="charsheet__combat-druid-label">Wild Companion</span>
					</div>
					<div class="ve-small ve-muted charsheet__combat-druid-note mt-1">Spends 1 Wild Shape use to summon a Fey familiar${wc.duration ? ` (${wc.duration})` : ""}.</div>
					<div class="charsheet__combat-druid-actions cs-combat-feature__options">
						<button class="cs-combat-btn cs-combat-btn--primary charsheet__combat-druid-summon" ${wc.canSummon ? "title=\"Open the familiar picker; spends 1 Wild Shape use\"" : "disabled title=\"No Wild Shape uses remaining\""}>${csCombatIcon("familiar")}<span>Summon Familiar</span></button>
					</div>
				</div>`;
		}

		// --- Zodiac Form ---
		const zo = summary.zodiac;
		if (zo.has) {
			html += `
				<div class="charsheet__combat-druid-block cs-combat-feature">
					<div class="cs-combat-feature__title">
						${csCombatIcon("spark")}<span class="charsheet__combat-druid-label">Zodiac Form</span>
					</div>
					${zo.activeFormName
		? `<div class="ve-small charsheet__combat-druid-active mt-1">Active: <span class="ve-bold charsheet__combat-druid-zodiac-name"></span></div>`
		: `<div class="ve-small ve-muted charsheet__combat-druid-note mt-1">No constellation assumed.</div>`}
					<div class="charsheet__combat-druid-actions cs-combat-feature__options">
						<button class="cs-combat-btn cs-combat-btn--primary charsheet__combat-druid-zodiac-choose" ${zo.canChoose ? "title=\"Open the constellation picker; spends 1 Wild Shape use\"" : "disabled title=\"No Wild Shape uses remaining\""}>${csCombatIcon("spark")}<span>Choose Zodiac Form…</span></button>
						${zo.activeFormName ? `<button class="cs-combat-btn charsheet__combat-druid-zodiac-dismiss" title="Dismiss the active Zodiac Form (no use refunded)">Dismiss</button>` : ""}
					</div>
				</div>`;
		}

		block.innerHTML = html;
		// Form/creature NAMES are HTML-escaped inside the class-utils helpers (beast
		// name) or set via textContent (zodiac) — never raw-interpolated — to avoid
		// injection from imported/user-supplied companion or form names.
		if (zo.activeFormName) { const el = block.querySelector(".charsheet__combat-druid-zodiac-name"); if (el) el.textContent = zo.activeFormName; }
		container.appendChild(block);

		// Listeners attach to the freshly-created elements each render (no pileup).
		block.querySelector(".charsheet__combat-druid-transform")?.addEventListener("click", () => druid.pTransform());
		block.querySelector(".charsheet__combat-druid-addform")?.addEventListener("click", () => druid.pAddKnownForm());
		block.querySelector(".charsheet__combat-druid-end")?.addEventListener("click", () => druid.endWildShape());
		block.querySelector(".charsheet__combat-druid-minus")?.addEventListener("click", () => {
			if (!druid.spendUse()) JqueryUtil.doToast({type: "warning", content: "No Wild Shape uses to spend."});
		});
		block.querySelector(".charsheet__combat-druid-plus")?.addEventListener("click", () => {
			druid.restoreUse();
		});
		block.querySelector(".charsheet__combat-druid-summon")?.addEventListener("click", () => druid.pSummonWildCompanion());
		block.querySelector(".charsheet__combat-druid-zodiac-choose")?.addEventListener("click", () => druid.openZodiacPicker());
		block.querySelector(".charsheet__combat-druid-zodiac-dismiss")?.addEventListener("click", () => druid.dismissZodiac());
	}

	/**
	 * Back-compat shim. The Arcane Archer "Arcane Shot" panel was folded into the
	 * Combat Resources panel (see _renderArcaneShotToggle), so this now just routes
	 * to renderCombatResources(). Kept as a no-op-style shim so any lingering caller
	 * (e.g. during multi-session integration) stays safe instead of crashing.
	 */
	renderCombatArcaneArcher () {
		this.renderCombatResources();
	}

	// =========================================================================
	// Flanking (#12) — an optional +2-to-hit melee toggle that feeds the SAME
	// combat `_rollAttack` total via `_getCombatLocalAttackBonus`. Surfaced as a
	// quick-states button (see `_initQuickStateButtons` / `_updateQuickButtonStates`)
	// backed by the transient `_flankingEnabled` field. This is the ONLY path that
	// grants the situational +2 — kept deliberately separate from the TGTT Fighter
	// Battle Tactic NAMED "Flanking", which is reminder/reaction only.
	// =========================================================================

	/**
	 * Combat-tab-local pre-roll attack contributors (currently just Flanking).
	 * Returns the summed bonus plus labelled parts for the result breakdown.
	 * Generic so future positional modifiers can be added in one place.
	 * @param {{isMelee: boolean, attack: *}} ctx
	 * @returns {{bonus: number, parts: Array<{label: string, value: number}>}}
	 */
	_getCombatLocalAttackBonus (ctx) {
		const parts = [];
		// Flanking (RAW optional rule): +2 to hit, melee attacks only.
		if (this._flankingEnabled && this._isStrictMelee(ctx?.attack)) {
			parts.push({label: "Flanking", value: 2});
		}
		// Conditional Battle-Tactic attack bonuses (TGTT), each an opt-in combat-local
		// toggle. Scope-correct: a ranged tactic (High Ground) only applies to a strictly
		// ranged attack; a melee tactic (Sweeping Blows / Hammer and Anvil) only to a
		// strictly melee attack. Locked tactics (unmet Fighter-level prereq) never apply.
		const tacticMods = this._state.getConditionalAttackModifiers?.() || [];
		for (const tm of tacticMods) {
			if (!this._battleTacticToggles[tm.source]) continue;
			if (tm.attackType === "ranged" && !this._isStrictRanged(ctx?.attack)) continue;
			if (tm.attackType === "melee" && !this._isStrictMelee(ctx?.attack)) continue;
			parts.push({label: tm.source, value: tm.value});
		}
		const bonus = parts.reduce((sum, p) => sum + p.value, 0);
		return {bonus, parts};
	}

	/**
	 * Classify an attack as melee or ranged for roll math, scoped modifier
	 * retrieval, and display. Single source of truth so the roll, the static
	 * attack badge, scoped named modifiers (Archery), battle-tactic scoping
	 * (High Ground), and the Flurry path all agree. Mirrors the long-standing
	 * `_rollAttack` heuristic: an explicit `isRanged` wins, otherwise explicit
	 * melee signals or a non-thrown range string read as melee.
	 * @param {*} attack
	 * @returns {{isMelee: boolean, isRanged: boolean}}
	 */
	_getAttackRollKind (attack) {
		const isMelee = attack?.isRanged === true
			? false
			: !!(attack?.isMelee || attack?.type === "melee" || attack?.range === "melee"
				|| (attack?.range && !String(attack.range).includes("/")));
		return {isMelee, isRanged: !isMelee};
	}

	/**
	 * Strict melee test for positional modifiers (Flanking). Only EXPLICIT melee
	 * signals qualify — never the loose "range has no slash" heuristic — so ranged
	 * attacks with a numeric range (e.g. "60 ft.") can never receive flanking.
	 * @param {*} attack
	 * @returns {boolean}
	 */
	_isStrictMelee (attack) {
		if (!attack || attack.isSpell) return false;
		if (attack.isRanged === true) return false;
		if (attack.isMelee === true) return true;
		if (attack.type === "melee") return true;
		const range = typeof attack.range === "string" ? attack.range.toLowerCase() : "";
		if (range === "melee" || range.includes("reach") || range.includes("touch")) return true;
		return false;
	}

	/**
	 * Strict ranged test for positional modifiers (High Ground). Only EXPLICIT
	 * ranged signals qualify — an `isRanged` flag, a non-melee `type`, or a
	 * thrown/ranged "x/y ft." range string — so an ambiguous or melee attack can
	 * never receive a ranged-only battle-tactic bonus.
	 * @param {*} attack
	 * @returns {boolean}
	 */
	_isStrictRanged (attack) {
		if (!attack || attack.isSpell) return false;
		if (attack.isRanged === true) return true;
		if (attack.isMelee === true || attack.type === "melee") return false;
		if (attack.type === "ranged") return true;
		const range = typeof attack.range === "string" ? attack.range.toLowerCase() : "";
		if (range === "melee" || range.includes("reach") || range.includes("touch")) return false;
		// A thrown/ranged weapon carries a "20/60 ft." style range, or a plain numeric
		// range that the roll heuristic reads as ranged.
		if (/\d/.test(range)) return true;
		return false;
	}

	/**
	 * Fighter combat-tab panel: Second Wind / Action Surge usage controls (action-typed,
	 * NOT toggle states), Tactical Mind + Stamina Enthusiast reminders, and Battle Tactics
	 * (TGTT) with their conditional attack / crit / reaction summaries. Self-contained (own
	 * section + container) so it does not collide with other combat-tab panels. Gated on
	 * the character actually being a Fighter (or having learned Battle Tactics).
	 */
	renderCombatFighter () {
		const section = document.getElementById("charsheet-combat-fighter-section");
		const container = document.getElementById("charsheet-combat-fighter");
		if (!section || !container) return;

		if (!this._state.hasFighterFeatures?.()) {
			section.style.display = "none";
			container.innerHTML = "";
			return;
		}
		section.style.display = "";
		container.innerHTML = "";

		const calcs = this._state.getFeatureCalculations?.() || {};
		const fighterLevel = this._state.getClassLevel?.("Fighter") ?? 0;
		const block = e_({tag: "div", clazz: "charsheet__combat-fighter"});
		let html = "";

		// ===== Second Wind =====
		const hasSecondWind = this._state.hasFeature?.("Second Wind");
		if (hasSecondWind) {
			const swMax = this._state.getSecondWindUsesMax?.() ?? 0;
			const swRemaining = this._state.getSecondWindUsesRemaining?.() ?? 0;
			const healing = calcs.secondWindHealing || `1d10+${fighterLevel}`;
			const hasStaminaEnthusiast = !!calcs.hasStaminaEnthusiast;
			const staminaGain = calcs.staminaEnthusiastStaminaGain ?? 0;
			html += `
				<div class="charsheet__combat-fighter-feature cs-combat-feature mb-3">
					<div class="cs-combat-feature__title">
						${csCombatIcon("heal")}<span>Second Wind</span>
						${csCombatActionChip("bonus")}
						${csCombatPoolCaption(swRemaining, swMax, {recharge: "short/long rest"})}
					</div>
					<div class="ve-small ve-muted mt-1">Regain <span class="bold">${healing}</span> hit points. <span class="ve-muted">(Uses are pip-tracked under Combat Resources.)</span></div>
					<div class="cs-combat-feature__options" role="group" aria-label="Second Wind actions">
						<button class="cs-combat-btn cs-combat-btn--heal charsheet__combat-fighter-sw-heal" ${swRemaining > 0 ? "" : "disabled"} title="Spend a use and regain ${healing} HP">${csCombatIcon("heal")}<span>Use (heal ${healing})</span></button>
						${hasStaminaEnthusiast ? `<button class="cs-combat-btn cs-combat-btn--spend charsheet__combat-fighter-sw-stamina" ${swRemaining > 0 ? "" : "disabled"} title="Stamina Enthusiast: regain ${staminaGain} stamina instead of hit points">${csCombatIcon("stance")}<span>Use (regain ${staminaGain} stamina)</span></button>` : ""}
						<button class="cs-combat-btn charsheet__combat-fighter-sw-reset" ${swRemaining < swMax ? "" : "disabled"} title="Restore all Second Wind uses">${csCombatIcon("reset")}<span>Reset</span></button>
					</div>`;
			if (calcs.hasTacticalMind) {
				html += `<div class="cs-combat-feature__summary">${csCombatIcon("spark")} <span class="bold">Tactical Mind:</span> when you fail an ability check, you can expend a use of Second Wind to add <span class="bold">1d10</span> to the check (the use isn't spent if it still fails).</div>`;
			}
			if (calcs.hasTacticalShift) {
				html += `<div class="cs-combat-feature__summary">${csCombatIcon("spark")} <span class="bold">Tactical Shift:</span> when you activate Second Wind, you can move up to half your speed without provoking opportunity attacks.</div>`;
			}
			if (hasStaminaEnthusiast) {
				html += `<div class="cs-combat-feature__summary">${csCombatIcon("spark")} <span class="bold">Stamina Enthusiast:</span> +2 stamina maximum, and Second Wind can regain ${staminaGain} stamina (proficiency bonus) instead of hit points.</div>`;
			}
			html += `</div>`;
		}

		// ===== Action Surge =====
		const hasActionSurge = this._state.hasFeature?.("Action Surge");
		if (hasActionSurge && fighterLevel >= 2) {
			const asMax = this._state.getActionSurgeUsesMax?.() ?? 0;
			const asRemaining = this._state.getActionSurgeUsesRemaining?.() ?? 0;
			html += `
				<div class="charsheet__combat-fighter-feature cs-combat-feature mb-3">
					<div class="cs-combat-feature__title">
						${csCombatIcon("surge")}<span>Action Surge</span>
						${csCombatActionChip("free", {labelOverride: "Special · no action"})}
						${csCombatPoolCaption(asRemaining, asMax, {recharge: "short/long rest"})}
					</div>
					<div class="ve-small ve-muted mt-1">On your turn, take one additional action.</div>
					<div class="cs-combat-feature__options" role="group" aria-label="Action Surge actions">
						<button class="cs-combat-btn cs-combat-btn--spend charsheet__combat-fighter-as-use" ${asRemaining > 0 ? "" : "disabled"} title="Spend one Action Surge use">${csCombatIcon("surge")}<span>Use</span></button>
						<button class="cs-combat-btn charsheet__combat-fighter-as-reset" ${asRemaining < asMax ? "" : "disabled"} title="Restore all Action Surge uses">${csCombatIcon("reset")}<span>Reset</span></button>
					</div>
				</div>`;
		}

		// ===== Shadow Knight (TGS4) =====
		if (calcs.hasShadowKnight) {
			const shadowcasting = this._state.getShadowcastingResource?.();
			const shadowSneak = this._state.getShadowSneakResource?.();
			const coated = this._state.getUmbralCoatedWeapon?.();
			const dimTargetOn = !!this._shadowKnightDarkTarget;
			const shadowState = (id) => !!this._state.isStateTypeActive?.(id);
			const selfInDarkness = shadowState("shadowKnightDimLight");
			html += `
				<div class="charsheet__combat-shadow-knight cs-combat-feature mb-3">
					<div class="cs-combat-feature__title">
						${csCombatIcon("spark")}<span>Shadow Knight</span>
						${csCombatPoolCaption(shadowcasting?.current || 0, shadowcasting?.max || 0, {recharge: "short/long rest"})}
					</div>
					<div class="ve-small ve-muted mt-1">Shadowcasting save DC <span class="bold">${calcs.shadowcastingSaveDc}</span>. Shadow weapons use the better of Strength or Dexterity and deal psychic damage.</div>
					<div class="cs-combat-feature__options mt-2" role="group" aria-label="Shadow Knight controls">
						<button class="cs-combat-btn charsheet__combat-shadow-light" title="Toggle when the target is in dim light or darkness">${csCombatIcon(dimTargetOn ? "check" : "spark")}<span>Dark target: ${dimTargetOn ? "ON (advantage)" : "OFF"}</span></button>
						<button class="cs-combat-btn charsheet__combat-shadow-coat" title="Coat a held physical weapon for 1 hour">${csCombatIcon("stance")}<span>${coated ? `Coated: ${coated.weaponName || "weapon"}` : "Umbral Coating"}</span></button>
						${calcs.hasUmbralWarrior ? `<button class="cs-combat-btn charsheet__combat-shadow-self-light" title="Toggle Shadow Knight defenses while you are in dim light or darkness">${csCombatIcon(selfInDarkness ? "check" : "shield")}<span>Self in darkness: ${selfInDarkness ? "ON" : "OFF"}</span></button>` : ""}
					</div>
					<div class="cs-combat-feature__summary"><span class="bold">Shadowbite:</span> offered after every shadow-weapon attack; failed DC ${calcs.shadowcastingSaveDc} CON save takes <span class="bold">1d8 psychic</span> and has disadvantage on its next attack. The save has disadvantage when your attack had advantage.</div>`;
			if (calcs.hasImprovedShadowcasting) {
				html += `
					<div class="cs-combat-feature__options mt-2" role="group" aria-label="Improved Shadowcasting options">
						<button class="cs-combat-btn charsheet__combat-shadow-option" data-option="Cloak of Shadow" ${(shadowcasting?.current || 0) ? "" : "disabled"}>${csCombatActionChip("action")}<span>Cloak of Shadow</span></button>
						<button class="cs-combat-btn charsheet__combat-shadow-option" data-option="Darkness" ${(shadowcasting?.current || 0) ? "" : "disabled"}>${csCombatActionChip("action")}<span>Darkness</span></button>
						<button class="cs-combat-btn charsheet__combat-shadow-option" data-option="Eyes of the Dark" ${(shadowcasting?.current || 0) ? "" : "disabled"}>${csCombatActionChip("bonus")}<span>Eyes of the Dark</span></button>
					</div>
					<div class="cs-combat-feature__summary"><span class="bold">Improved Shadowcasting:</span> Cloak of Shadow or Darkness arms one shadow-weapon attack as a bonus action.</div>
					${shadowState("shadowCloak") ? `<div class="cs-combat-notice cs-combat-notice--success mt-1">Cloak of Shadow active: up to four chosen creatures have advantage on Stealth checks.</div>` : ""}
					${shadowState("shadowKnightDarkness") ? `<div class="cs-combat-notice cs-combat-notice--success mt-1">Darkness active: concentrating on a 15-foot-radius sphere for up to 10 minutes.</div>` : ""}
					${shadowState("eyesOfTheDark") ? `<div class="cs-combat-notice cs-combat-notice--success mt-1">Eyes of the Dark active: up to four chosen creatures gain 60-foot Dark Gaze for 1 hour.</div>` : ""}
					${shadowState("improvedShadowcastingAttack") ? `<div class="cs-combat-notice cs-combat-notice--success mt-1">Bonus-action shadow-weapon attack available.</div>` : ""}`;
			}
			if (calcs.hasShadowSneak) {
				html += `<div class="cs-combat-feature__summary"><span class="bold">Shadow Sneak (${shadowSneak?.current || 0}/${shadowSneak?.max || 1}):</span> offered after a shadow-weapon attack; teleport within 5 feet of the target and become Invisible until your next turn, attack, or spell.</div>`;
			}
			if (calcs.hasUmbralWarrior) {
				html += `<div class="cs-combat-feature__summary"><span class="bold">Umbral Warrior:</span> armor never imposes Stealth disadvantage; dim light/darkness grants conditional advantage on Dexterity saves.</div>`;
			}
			if (calcs.hasCoverOfDarkness) {
				html += `<div class="cs-combat-feature__summary"><span class="bold">Cover of Darkness:</span> conditional half cover in dim light/darkness (+2 AC and +2 Dexterity saves).</div>`;
			}
			html += `</div>`;
		}

		// ===== Battle Tactics (TGTT) =====
		const battleTactics = this._state.getBattleTactics?.() || [];
		if (battleTactics.length) {
			html += `<div class="charsheet__combat-fighter-tactics mt-1">
				<div class="ve-flex-v-center gap-2 mb-1"><span class="bold">Battle Tactics</span><span class="ve-muted ve-small">(${battleTactics.length})</span></div>`;
			battleTactics.forEach(tactic => {
				let nameHtml = tactic.name;
				if (this._page?.getHoverLink && tactic.source) {
					try {
						nameHtml = this._page.getHoverLink(UrlUtil.PG_OPT_FEATURES, tactic.name, tactic.source);
					} catch (e) {
						nameHtml = tactic.name;
					}
				}

				const locked = !!tactic.fighterLevel && !this._state.meetsBattleTacticPrerequisite?.(tactic.fighterLevel);

				const badges = [];
				let toggleBtnHtml = "";
				if (tactic.attackBonus) {
					const typeLabel = tactic.attackType ? `${tactic.attackType} ` : "";
					badges.push(`<span class="badge badge-success" title="Conditional ${typeLabel}attack bonus${tactic.condition ? `: ${tactic.condition}` : ""}">+${tactic.attackBonus} ${typeLabel}atk</span>`);
					// Opt-in combat-local toggle for the situational +N to-hit. Only the
					// player knows the positional condition is met, so it's off by default
					// and applies ONLY to the tactic's attack type (ranged/melee). Locked
					// tactics (unmet prereq) get no toggle.
					if (!locked) {
						const on = !!this._battleTacticToggles[tactic.name];
						const scopeWord = tactic.attackType ? `${tactic.attackType} ` : "";
						toggleBtnHtml = csCombatStateToggle({
							state: on ? "on" : "off",
							labelPrefix: `${tactic.name} to-hit bonus`,
							ariaState: on ? `+${tactic.attackBonus} active` : "off",
							title: `Toggle the +${tactic.attackBonus} ${scopeWord}to-hit bonus for ${tactic.condition || "this tactic"} — applies to ${tactic.attackType || "all"} attacks only`,
							domClass: "charsheet__combat-fighter-tactic-toggle ml-1",
							vocab: {
								on: {label: `+${tactic.attackBonus} ON`, icon: "check"},
								off: {label: `+${tactic.attackBonus} OFF`},
							},
							attrs: {"data-tactic": tactic.name},
						});
					}
				}
				// Crit-range / advantage riders come WITH the (level-gated) reaction, so only
				// advertise them as active once the Fighter-level prerequisite is met.
				if (tactic.critRange && !locked) {
					badges.push(`<span class="badge badge-danger" title="Expanded critical range">crit ${tactic.critRange}-20</span>`);
				}
				if (tactic.advantage && !locked) {
					badges.push(`<span class="badge badge-info" title="Grants advantage">Adv</span>`);
				}

				let reactionHtml = "";
				if (tactic.reaction) {
					const lockBadge = locked
						? `<span class="cs-combat-chip cs-combat-chip--locked ml-1" title="Requires Fighter level ${tactic.fighterLevel}">${csCombatIcon("lock")}<span>Lvl ${tactic.fighterLevel}</span></span>`
						: `${csCombatActionChip("reaction", {cls: "ml-1"})}`;
					reactionHtml = `<div class="ve-small ${locked ? "ve-muted" : ""} mt-1">${lockBadge} <span class="bold">${tactic.reaction.name}:</span> ${tactic.reaction.trigger} — ${tactic.reaction.effect}</div>`;
					// Last Ditch Evasion is the one Battle Tactic with an in-play side effect
					// (it applies the Slowed condition), so it gets a real "use" button. When
					// hit by an attack you take NO damage and become Slowed — this button is the
					// reaction trigger (LDE is NOT a Dex-save-for-half effect).
					if (!locked && this._state.getFeatureCalculations?.().hasLastDitchEvasion && /^last ditch evasion$/i.test(tactic.name)) {
						reactionHtml += `<div class="cs-combat-feature__options mt-1"><button class="cs-combat-btn cs-combat-btn--primary charsheet__combat-lde-use" title="When you're hit by an attack: take no damage and become Slowed until the end of your next turn">${csCombatIcon("reaction")}<span>Use Last Ditch Evasion (avoid all damage + Slowed)</span></button></div>`;
					}
				}

				html += `
					<div class="charsheet__combat-fighter-tactic cs-combat-feature mb-2">
						<div class="cs-combat-feature__title ve-flex-wrap">
							${csCombatIcon("stance")}<span>${nameHtml}</span>
							${badges.join(" ")}
							${toggleBtnHtml}
						</div>
						${tactic.condition && !tactic.reaction ? `<div class="cs-combat-feature__summary">Condition: ${tactic.condition}</div>` : ""}
						${reactionHtml}
					</div>`;
			});
			html += `</div>`;
		}

		block.innerHTML = html;
		container.appendChild(block);

		const refresh = () => {
			this._page.saveCharacter();
			this._page.renderCharacter();
		};

		block.querySelector(".charsheet__combat-fighter-sw-heal")?.addEventListener("click", () => {
			if (this._state.useSecondWind?.("hp")) {
				const roll = this._page.rollDice(1, 10);
				const amount = roll + fighterLevel;
				this._state.heal?.(amount);
				refresh();
				JqueryUtil.doToast({type: "success", content: `Second Wind: healed ${amount} HP (1d10 [${roll}] + ${fighterLevel})`});
			} else {
				JqueryUtil.doToast({type: "warning", content: "No Second Wind uses remaining! Rest to regain uses."});
			}
		});
		block.querySelector(".charsheet__combat-fighter-sw-stamina")?.addEventListener("click", () => {
			if (this._state.useSecondWind?.("stamina")) {
				const gain = this._state.getFeatureCalculations?.().staminaEnthusiastStaminaGain ?? 0;
				refresh();
				JqueryUtil.doToast({type: "success", content: `Second Wind: regained ${gain} stamina`});
			} else {
				JqueryUtil.doToast({type: "warning", content: "No Second Wind uses remaining! Rest to regain uses."});
			}
		});
		block.querySelector(".charsheet__combat-fighter-sw-reset")?.addEventListener("click", () => {
			this._state.restoreSecondWind?.();
			refresh();
		});
		block.querySelector(".charsheet__combat-fighter-as-use")?.addEventListener("click", () => {
			if (this._state.useActionSurge?.()) {
				refresh();
				JqueryUtil.doToast({type: "success", content: "Used Action Surge"});
			} else {
				JqueryUtil.doToast({type: "warning", content: "No Action Surge uses remaining! Rest to regain uses."});
			}
		});
		block.querySelector(".charsheet__combat-fighter-as-reset")?.addEventListener("click", () => {
			this._state.restoreActionSurge?.();
			refresh();
		});
		block.querySelector(".charsheet__combat-shadow-light")?.addEventListener("click", () => {
			this._shadowKnightDarkTarget = !this._shadowKnightDarkTarget;
			this.renderCombatFighter();
			this.renderAttacks();
		});
		block.querySelector(".charsheet__combat-shadow-self-light")?.addEventListener("click", () => {
			const next = !this._state.isStateTypeActive?.("shadowKnightDimLight");
			this._state.setShadowKnightDimLightActive?.(next);
			refresh();
		});
		block.querySelector(".charsheet__combat-shadow-coat")?.addEventListener("click", async () => {
			const weapons = (this.getAvailableWeaponAttacks?.() || []).filter(attack => attack.sourceItem && !attack.isSpell && !attack.isShadowWeapon);
			if (!weapons.length) {
				JqueryUtil.doToast({type: "warning", content: "Equip a physical weapon before using Umbral Coating."});
				return;
			}
			let weapon = weapons[0];
			if (weapons.length > 1) {
				const weaponId = await InputUiUtil.pGetUserEnum({
					title: "Umbral Coating",
					htmlDescription: "Choose a physical weapon to coat in shadowstuff for 1 hour.",
					values: weapons.map(attack => attack.id),
					fnDisplay: id => weapons.find(attack => attack.id === id)?.name || id,
					isResolveItem: true,
				});
				if (weaponId == null) return;
				weapon = weapons.find(attack => attack.id === weaponId);
			}
			if (this._state.coatShadowWeapon?.({weaponId: weapon.id, weaponName: weapon.name})) refresh();
		});
		block.querySelectorAll(".charsheet__combat-shadow-option").forEach((/** @type {*} */ btn) => {
			btn.addEventListener("click", () => {
				const result = this._state.useShadowcastingOption?.(btn.dataset.option);
				if (!result) {
					JqueryUtil.doToast({type: "warning", content: "No Shadowcasting uses remaining."});
					return;
				}
				JqueryUtil.doToast({
					type: "success",
					content: `${result.option} used.${result.grantsBonusActionAttack ? " Improved Shadowcasting grants one bonus-action shadow-weapon attack." : ""}`,
				});
				refresh();
			});
		});
		// Conditional battle-tactic to-hit toggles (e.g. High Ground +2 ranged). These are
		// combat-local and transient (not saved): flip the in-memory flag and re-render the
		// Fighter panel + attacks so the badge state and the next roll agree.
		block.querySelectorAll(".charsheet__combat-fighter-tactic-toggle").forEach((/** @type {*} */ btn) => {
			btn.addEventListener("click", () => {
				const name = btn.getAttribute("data-tactic");
				if (!name) return;
				this._battleTacticToggles[name] = !this._battleTacticToggles[name];
				this.renderCombatFighter();
				this.renderAttacks();
			});
		});

		block.querySelector(".charsheet__combat-lde-use")?.addEventListener("click", () => {
			const res = this._state.applyLastDitchEvasion?.({});
			if (!res || !res.applied) return;
			const slowedStr = res.slowedApplied
				? " You become Slowed until the end of your next turn."
				: " (Already Slowed.)";
			JqueryUtil.doToast({type: "success", content: `Last Ditch Evasion: you take no damage.${slowedStr}`});
			refresh();
		});
	}

	/**
	 * (R40 #8) Render the World Tree Barbarian "Vitality of the Tree" combat panel.
	 *
	 * Two sub-features:
	 *  - Vitality Surge — when you activate Rage you gain Temp HP = your Barbarian level.
	 *    This is applied automatically in state.js `activateState("rage")`; here we only
	 *    surface an informational summary so the player understands where the temp HP came from.
	 *  - Life-Giving Force — at the START of each of your turns while Rage is active you may grant
	 *    ONE creature within 10 ft Temp HP equal to the sum of X d6, where X is your Rage Damage
	 *    bonus. Those temp HP vanish when your Rage ends. Ally HP isn't tracked on this
	 *    single-character sheet, so the "Roll" button rolls + sums the dice and reports the total
	 *    to hand to the ally. The reminder is only shown while Rage is active (its trigger).
	 *
	 * Visible only for a character that actually has Vitality of the Tree (World Tree, L3+).
	 */
	renderCombatVitality () {
		const section = document.getElementById("charsheet-combat-vitality-section");
		const container = document.getElementById("charsheet-combat-vitality");
		if (!section || !container) return;

		const calcs = this._state.getFeatureCalculations?.() || {};
		if (!calcs.hasVitalityOfTheTree) {
			section.style.display = "none";
			container.innerHTML = "";
			return;
		}

		section.style.display = "";
		container.innerHTML = "";

		const barbLevel = this._state.getClassLevel?.("Barbarian") ?? (calcs.vitalityTempHp || 0);
		const surge = calcs.vitalityTempHp || barbLevel;
		const rageDamage = calcs.rageDamage || 2;
		const rageActive = !!this._state.isStateTypeActive?.("rage");

		const block = e_({tag: "div", clazz: "charsheet__combat-vitality"});
		let html = "";

		// ===== Vitality Surge (self temp HP on Rage activation) =====
		html += `
			<div class="charsheet__combat-vitality-feature cs-combat-feature mb-3">
				<div class="cs-combat-feature__title">
					${csCombatIcon("heal")}<span>Vitality Surge</span>
					${csCombatConditionPill({variant: rageActive ? "met" : "none", icon: rageActive ? "check" : "none", label: `Temp HP +${surge}`, title: rageActive ? `Granted this Rage — Temp HP = Barbarian level (${surge})` : `Applied automatically when you activate your Rage — Temp HP = Barbarian level (${surge})`})}
				</div>
				<div class="ve-small ve-muted mt-1">When you activate your Rage you gain <span class="bold">${surge}</span> Temporary Hit Points${rageActive ? " (granted this Rage)." : "."}</div>
			</div>`;

		// ===== Life-Giving Force (grant an ally temp HP at start of your turns while raging) =====
		html += `
			<div class="charsheet__combat-vitality-feature cs-combat-feature">
				<div class="cs-combat-feature__title">
					${csCombatIcon("heal")}<span>Life-Giving Force</span>
					<span class="cs-combat-chip" title="Roll this many d6 and sum them">${csCombatIcon("dice")}<span>${rageDamage}d6</span></span>
				</div>
				<div class="ve-small ve-muted mt-1">At the <span class="bold">start of each of your turns</span> while raging, you can give one creature within 10 ft Temp HP equal to <span class="bold">${rageDamage}d6</span> (summed). These temp HP vanish when your Rage ends.</div>`;

		if (rageActive) {
			html += `
				<div class="cs-combat-notice cs-combat-notice--success mt-2 mb-1">
					${csCombatIcon("spark")}<span title="Life-Giving Force triggers at the start of each of your turns while raging"><span class="bold">Round-start reminder:</span> grant an ally within 10 ft <span class="bold">${rageDamage}d6</span> Temp HP.</span>
				</div>
				<div class="cs-combat-feature__options mt-1">
					<button class="cs-combat-btn cs-combat-btn--heal charsheet__combat-vitality-roll" title="Roll ${rageDamage}d6 and total the Temp HP to grant an ally">${csCombatIcon("dice")}<span>Roll Life-Giving Force (${rageDamage}d6)</span></button>
				</div>`;
		} else {
			html += `<div class="ve-small ve-muted mt-1"><em>Activate Rage to use Life-Giving Force each round.</em></div>`;
		}
		html += `</div>`;

		block.innerHTML = html;
		container.appendChild(block);

		block.querySelector(".charsheet__combat-vitality-roll")?.addEventListener("click", () => {
			const {total, rolls} = this._rollLifeGivingForce(rageDamage);
			JqueryUtil.doToast({
				type: "success",
				content: `Life-Giving Force: grant an ally within 10 ft <strong>${total}</strong> Temp HP (${rageDamage}d6 [${rolls.join(", ")}]). These vanish when your Rage ends.`,
			});
		});
	}

	/**
	 * (R40 #8) Roll Life-Giving Force: sum `rageDamage` d6 (X = the Rage Damage bonus).
	 * Returned so the caller can surface the total for the player to hand to an ally.
	 * Kept as a small pure helper so the Xd6 math is unit-testable without a live DOM.
	 * @param {number} rageDamage Number of d6 to roll (the character's Rage Damage bonus).
	 * @returns {{total: number, rolls: number[]}}
	 */
	_rollLifeGivingForce (rageDamage) {
		const count = Math.max(0, rageDamage | 0);
		const rolls = [];
		let total = 0;
		for (let i = 0; i < count; i++) {
			const r = this._page.rollDice?.(1, 6) ?? 0;
			rolls.push(r);
			total += r;
		}
		return {total, rolls};
	}

	_renderMethodsToContainer (container, methodsByTradition, {showUseButton = false} = {}) {
		for (const [tradCode, methods] of methodsByTradition) {
			const tradName = this._getTraditionName(tradCode);
			const tradGroup = e_({outer: `
				<div class="charsheet__methods-group mb-2">
					<div class="charsheet__methods-tradition-header ve-small ve-muted mb-1 ve-flex ve-flex-v-center">
						<span class="bold">${tradName}</span>
					</div>
				</div>
			`});

			methods.sort((a, b) => {
				const degreeA = this._getMethodDegree(a);
				const degreeB = this._getMethodDegree(b);
				return degreeA - degreeB || a.name.localeCompare(b.name);
			}).forEach(method => {
				const degree = this._getMethodDegree(method);
				const staminaCost = this._getMethodStaminaCost(method);
				const methodId = `${method.name}-${method.source || ""}`.replace(/\s+/g, "-").toLowerCase();

				// Parse enhanced effects from state
				const parsed = this._state._parseCombatMethodEffects?.(method) || {};

				// Create hoverable link for method name (like spells/weapons)
				let methodNameHtml = method.name;
				if (this._page?.getHoverLink && method.source) {
					try {
						methodNameHtml = this._page.getHoverLink(
							UrlUtil.PG_COMBAT_METHODS,
							method.name,
							method.source,
						);
					} catch (e) {
						methodNameHtml = method.name;
					}
				}

				// Build extra badges for method properties
				const extraBadges = [];
				if (parsed.isMultiTarget) {
					const targetLabel = parsed.maxTargets === "proficiency" ? "Multi (Prof)" : "Multi-target";
					extraBadges.push(`<span class="badge badge-info ml-1" title="Multi-target attack">${targetLabel}</span>`);
				}
				if (parsed.range) {
					extraBadges.push(`<span class="badge badge-warning ml-1" title="Ranged: ${parsed.range.normal}/${parsed.range.long} ft">${parsed.range.normal}/${parsed.range.long} ft</span>`);
				}
				if (parsed.grantsAdvantage) {
					extraBadges.push(`<span class="badge badge-success ml-1" title="Grants advantage on attack rolls">Adv</span>`);
				}
				if (parsed.actionType) {
					let actKind = "action";
					if (parsed.actionType === "Bonus Action") actKind = "bonus";
					else if (parsed.actionType === "Reaction") actKind = "reaction";
					extraBadges.push(csCombatActionChip(actKind, {labelOverride: parsed.actionType, cls: "ml-1"}));
				}

				const isWeaponModifier = parsed.methodCategory === "weaponModifier";
				const rememberedWeapon = isWeaponModifier ? this._state.getCombatMethodWeapon(method.name) : null;
				const weaponLabel = rememberedWeapon ? `<span class="ve-muted ve-small ml-1" title="Remembered weapon: ${rememberedWeapon.weaponName}">${csCombatIcon("weapon")} ${rememberedWeapon.weaponName}</span>` : "";

				// Focus gating: some granted methods are only usable in a matching Primal Focus mode
				// (e.g. Singular Focus → Predator, Groundshatter → Prey).
				const requiresFocus = method.requiresFocus || null;
				let focusMismatch = false;
				if (requiresFocus) {
					const currentFocus = this._state.getPrimalFocusMode?.();
					focusMismatch = currentFocus !== requiresFocus;
					const focusLabel = requiresFocus.charAt(0).toUpperCase() + requiresFocus.slice(1);
					extraBadges.push(`<span class="badge ${focusMismatch ? "badge-danger" : "badge-success"} ml-1" title="Usable only while in ${focusLabel} focus">${focusLabel} only</span>`);
				}

				// Stances are on/off TOGGLES, not one-shot uses: render an Enter ⇄ End button
				// reflecting whether THIS stance is the active one. Ending a stance never costs
				// stamina and must never be focus-blocked, so the active-state button is always
				// enabled. A single `combatStance` slot enforces mutual exclusion, so entering
				// another stance auto-replaces the active one (button reverts on re-render).
				const isStanceMethod = !!parsed.isStance;
				const stanceActive = isStanceMethod && !!this._state.isStanceActive?.(method.name);
				let actionBtnHtml;
				if (isStanceMethod && stanceActive) {
					actionBtnHtml = `<button class="cs-combat-btn cs-combat-btn--danger charsheet__method-use" data-method-id="${methodId}" data-cost="${staminaCost}" data-method-stance="1" data-stance-active="1" title="End ${method.name} (bonus action, no stamina cost)">${csCombatIcon("stance")}<span>End Stance</span></button>`;
				} else if (isStanceMethod) {
					actionBtnHtml = `<button class="cs-combat-btn cs-combat-btn--primary charsheet__method-use" data-method-id="${methodId}" data-cost="${staminaCost}" data-method-stance="1" ${focusMismatch ? `disabled title="Switch to ${requiresFocus} focus to use this method"` : `title="Enter ${method.name} (costs ${staminaCost} stamina)"`}>${csCombatIcon("stance")}<span>Enter Stance</span></button>`;
				} else {
					actionBtnHtml = `<button class="cs-combat-btn cs-combat-btn--primary charsheet__method-use" data-method-id="${methodId}" data-cost="${staminaCost}" ${focusMismatch ? `disabled title="Switch to ${requiresFocus} focus to use this method"` : `title="Use this method (costs ${staminaCost} stamina)"`}>${csCombatIcon("surge")}<span>Use</span></button>`;
				}

				const methodEl = e_({outer: `
					<div class="charsheet__method-item cs-combat-feature mb-1 ve-flex ve-flex-v-center ve-flex-h-space-between">
						<div class="ve-flex ve-flex-v-center ve-flex-wrap">
							<span class="charsheet__method-name" style="font-weight: bold;">${methodNameHtml}</span>
							<span class="ve-muted ve-small ml-2">(${degree}${this._getOrdinalSuffix(degree)})</span>
							${staminaCost > 0 ? `<span class="badge badge-secondary ml-2" title="Stamina cost">${staminaCost} EP</span>` : ""}
							${stanceActive ? `<span class="badge badge-success ml-1" title="Stance is active">Active</span>` : ""}
							${extraBadges.join("")}
							${weaponLabel}
						</div>
						${showUseButton ? `<div class="ve-flex ve-flex-v-center ml-2">
							${actionBtnHtml}
							${isWeaponModifier ? `<button class="cs-combat-btn charsheet__method-choose-weapon ml-1" data-method-id="${methodId}" title="Choose which weapon to use" aria-label="Choose weapon for ${method.name}">${csCombatIcon("weapon")}</button>` : ""}
						</div>` : ""}
					</div>
				`});

				// Store method data for later use
				methodEl._methodData = method;

				tradGroup.append(methodEl);
			});

			container.append(tradGroup);
		}
	}

	_getMethodStaminaCost (method) {
		// Try to extract stamina cost from method entries
		// Usually formatted like "Cost: X stamina" or mentions stamina in the text
		if (!method.entries) return 1; // Default cost

		const entriesStr = JSON.stringify(method.entries).toLowerCase();

		// Look for patterns like "costs X stamina" or "X stamina points"
		const costMatch = entriesStr.match(/costs?\s+(\d+)\s+stamina/i);
		if (costMatch) return parseInt(costMatch[1]);

		// Also check for degree-based default costs (1st=1, 2nd=2, etc.)
		const degree = this._getMethodDegree(method);
		return degree || 1;
	}

	_useMethod (methodId) {
		const btn = /** @type {*} */ (document.querySelector(`.charsheet__method-use[data-method-id="${methodId}"]`));

		// Stances are on/off toggles: if THIS stance is already active, END it here — BEFORE
		// any stamina/focus checks. Exiting a stance is free (a bonus action) and must work
		// even at 0 stamina or while in a mismatched Primal Focus mode.
		const clickedMethod = /** @type {*} */ (btn.closest(".charsheet__method-item"))?._methodData;
		if (clickedMethod && this._state.isStanceActive?.(clickedMethod.name)) {
			this._exitStance(clickedMethod);
			btn.classList.add("ve-btn-success");
			setTimeout(() => btn.classList.remove("ve-btn-success"), 200);
			return;
		}

		const cost = parseInt(btn.dataset.cost) || 1;
		const currentStamina = this._state.getStaminaCurrent();

		if (currentStamina < cost) {
			// Try ki/focus-to-stamina conversion for Monks with the combat system
			if (this._state.canUseFocusForStamina?.()) {
				const kiCurrent = this._state.getKiPointsCurrent?.() ?? 0;
				if (kiCurrent >= cost) {
					if (!this._state.useFocusForStamina(cost)) {
						JqueryUtil.doToast({type: "warning", content: `Not enough ki/focus points to fuel this method!`});
						return;
					}
					// Ki was spent — continue to activation (skip stamina deduction below)
					this._activateMethodAfterPayment(btn, methodId, cost, "ki/focus");
					return;
				}
			}
			JqueryUtil.doToast({type: "warning", content: `Not enough stamina! You have ${currentStamina}, but this method costs ${cost}.`});
			return;
		}

		// Get the method data from the parent element (validate before spending stamina)
		const method = /** @type {*} */ (btn.closest(".charsheet__method-item"))?._methodData;
		if (!method) {
			JqueryUtil.doToast({type: "warning", content: `Could not resolve method data. Please try again.`});
			return;
		}

		// Enforce Primal Focus gating at use time (not just via the disabled button) so a
		// focus-locked method (Singular Focus → Predator, Groundshatter → Prey) can never be
		// triggered while in the wrong focus, even if the disabled state is bypassed.
		if (this._state.isCombatMethodFocusBlocked?.(method)) {
			const focusLabel = method.requiresFocus.charAt(0).toUpperCase() + method.requiresFocus.slice(1);
			JqueryUtil.doToast({type: "warning", content: `${method.name} can only be used while in ${focusLabel} focus.`});
			return;
		}

		this._state.setStaminaCurrent(currentStamina - cost);
		this._updateStaminaDisplay();

		// Also update resources section
		if (this._page?._features) {
			this._page._features._renderResources();
		}

		this._activateMethodEffect(btn, methodId, method, cost, "stamina");
	}

	/**
	 * Activate a combat method after paying with ki/focus points
	 */
	_activateMethodAfterPayment (btn, methodId, cost, resourceName) {
		const method = btn.closest(".charsheet__method-item")?._methodData;

		// Also update resources section (ki display)
		if (this._page?._features) {
			this._page._features._renderResources();
		}

		this._activateMethodEffect(btn, methodId, method, cost, resourceName);
	}

	/**
	 * Apply the method's effect after payment has been deducted
	 */
	_activateMethodEffect (btn, methodId, method, cost, resourceName) {
		if (method) {
			// Check if this is a stance (typically has duration) vs instant effect
			const isStance = this._isMethodStance(method);

			if (isStance) {
				// Parse effects from description
				const description = method.entries ? JSON.stringify(method.entries) : "";
				const parsedEffects = CharacterSheetState.parseEffectsFromDescription?.(description) || [];

				// Activate as a combat stance state
				this._state.activateState("combatStance", {
					name: method.name,
					icon: "⚔️",
					sourceFeatureId: method.id || methodId,
					description: description,
					customEffects: parsedEffects.length > 0 ? parsedEffects : null,
				});

				// Bridge to the stance-specific system so mechanical effects
				// (passive/skill/save/speed bonuses) actually apply. Without this
				// the badge shows active but _data.activeStance stays null and
				// _getActiveStanceEffects() returns null. Mirrors the Features-tab
				// path in charactersheet.js::_activateFeatureState.
				const stanceActivated = this._state.activateStance(method.name);
				if (!stanceActivated) {
					// Stance couldn't be resolved/activated — don't leave a stale badge
					// or claim success.
					this._state.deactivateState("combatStance");
					this.renderCombatStates();
					this.renderCombatEffects();
					this._page._renderActiveStates?.();
					this._page._saveCurrentCharacter?.();
					this._page._renderCharacter?.();
					JqueryUtil.doToast({type: "warning", content: `Could not activate ${method.name}.`});
					btn.classList.add("ve-btn-success");
					setTimeout(() => btn.classList.remove("ve-btn-success"), 200);
					return;
				}

				this.renderCombatStates();
				this.renderCombatEffects();
				this._page._renderActiveStates?.();
				this._page._saveCurrentCharacter?.();
				this._page._renderCharacter?.();
				// Re-render the methods list so this stance's button flips to "End Stance"
				// and any previously-active stance's button reverts to "Enter Stance"
				// (single combatStance slot → mutual exclusion).
				this.renderCombatMethods();

				JqueryUtil.doToast({type: "success", content: `Activated ${method.name}! (−${cost} ${resourceName})`});
			} else {
				// Non-stance method — handle by category
				// Use pre-parsed fields from getCombatMethods() if available, otherwise re-parse
				const parsedEffects = method.methodCategory
					? method
					: (this._state._parseCombatMethodEffects?.(method) || {});
				const category = parsedEffects.methodCategory || "instant";

				if (category === "weaponModifier") {
					this._activateWeaponModifierMethod(method, parsedEffects, cost, resourceName);
				} else if (category === "selfHeal") {
					this._activateSelfHealMethod(method, parsedEffects, cost, resourceName);
				} else if (category === "rangedExtraDie") {
					this._activateRangedExtraDieMethod(method, cost, resourceName);
				} else {
					// acBuff, reaction, instant — toast for now
					JqueryUtil.doToast({type: "success", content: `Used ${method.name}! (−${cost} ${resourceName})`});
				}
			}
		} else {
			// Fallback: find method name for feedback
			const methodName = methodId.split("-").slice(0, -1).join(" ").replace(/\b\w/g, c => c.toUpperCase());
			JqueryUtil.doToast({type: "success", content: `Used ${methodName}! (−${cost} ${resourceName})`});
		}

		// Flash the button to indicate use
		btn.classList.add("ve-btn-success");
		setTimeout(() => btn.classList.remove("ve-btn-success"), 200);
	}

	/**
	 * Self-heal combat method (e.g. Catch Your Breath). Rolls the method's healing dice and
	 * applies `dice + proficiency + ability modifier` (clamped to its minimum) via the state.
	 */
	_activateSelfHealMethod (method, parsedEffects, cost, resourceName) {
		const heal = parsedEffects.selfHeal;
		if (!heal) {
			JqueryUtil.doToast({type: "success", content: `Used ${method.name}! (−${cost} ${resourceName})`});
			return;
		}

		const dieRoll = this._parseDamage(heal.dice).total;
		const result = this._state.applyCombatMethodSelfHeal(method.name, {dieRoll});

		// Refresh HP UI everywhere it is shown.
		this._page._renderHp?.();
		this.renderCombatResources?.();
		this._page._renderCharacter?.();
		this._page._saveCurrentCharacter?.();

		if (result) {
			JqueryUtil.doToast({type: "success", content: `${method.name}: regained ${result.amount} HP (${result.formulaText}; rolled ${dieRoll}). (−${cost} ${resourceName})`});
		} else {
			JqueryUtil.doToast({type: "success", content: `Used ${method.name}! (−${cost} ${resourceName})`});
		}
	}

	/**
	 * Ranged extra-die combat method (Doubleshot). Arms a one-shot pending rider that the
	 * NEXT qualifying ranged weapon attack consumes via `_consumePendingWeaponDamageDie`.
	 */
	_activateRangedExtraDieMethod (method, cost, resourceName) {
		this._pendingDoubleshot = {name: method.name};
		JqueryUtil.doToast({type: "success", content: `${method.name} armed: your next ranged weapon attack deals an extra weapon damage die. (−${cost} ${resourceName})`});
	}

	/**
	 * Pure resolver for a pending Doubleshot rider. Does NOT mutate state, so it is safe to
	 * call from rendering/decision code and from tests.
	 * @param {object} attack - The attack about to roll damage.
	 * @returns {string|null} A single weapon die string (e.g. "1d8") to add to this ranged
	 *   weapon attack, or null when no Doubleshot is pending / the attack doesn't qualify.
	 */
	getDoubleshotRiderForAttack (attack) {
		if (!this._pendingDoubleshot) return null;
		if (!attack || attack.isSpell) return null;
		// A ranged weapon attack = a weapon attack that is not melee. Stored weapon attacks
		// carry `isMelee` (ranged ones set it false) rather than an explicit `isRanged`, so
		// reuse the canonical melee predicate; thrown weapons (range "X/Y") count as ranged,
		// matching Doubleshot's "palm two blades or nock two arrows" text.
		if (this._isMeleeWeaponAttack(attack)) return null;
		// Reduce the weapon's damage dice to a SINGLE die of the same size: "2d6+3" → "1d6".
		const m = (attack.damage || "").match(/\d+d(\d+)/);
		if (!m) return null;
		return `1d${m[1]}`;
	}

	/**
	 * Consume a pending Doubleshot rider for this attack. Single seam consumed by the
	 * damage pipeline (S5 hook): returns the extra weapon die string ONCE (clearing the
	 * pending flag) for a qualifying ranged weapon attack, else null.
	 * @param {object} attack
	 * @returns {string|null}
	 */
	_consumePendingWeaponDamageDie (attack) {
		const die = this.getDoubleshotRiderForAttack(attack);
		if (!die) return null;
		this._pendingDoubleshot = null;
		return die;
	}

	/**
	 * Choose (or re-choose) a weapon for a weapon-modifier method without spending stamina.
	 */
	async _chooseWeaponForMethod (methodId) {
		const methodEl = /** @type {*} */ (document.querySelector(`.charsheet__method-choose-weapon[data-method-id="${methodId}"]`)?.closest(".charsheet__method-item"));
		const method = methodEl?._methodData;
		if (!method) return;

		const attacks = this._cachedAttacks?.length ? this._cachedAttacks : (this._state.getAttacks?.() || []);
		const weaponAttacks = attacks.filter(a => !a.isSpell && !a.isUnarmedStrike);

		if (weaponAttacks.length === 0) {
			JqueryUtil.doToast({type: "warning", content: `No weapon attacks available!`});
			return;
		}

		const choices = weaponAttacks.map(atk => ({
			name: `${atk.name} (${atk.damage} ${atk.damageType || ""})`,
			attack: atk,
		}));

		const chosen = await this._showCombatActionChoiceModal(
			{name: `🗡️ ${method.name} — Choose Weapon`},
			choices,
		);

		if (!chosen) return;

		this._state.setCombatMethodWeapon(method.name, chosen.attack.id, chosen.attack.name);
		this._page._saveCurrentCharacter?.();
		this.renderCombatMethods();
		JqueryUtil.doToast({type: "info", content: `${method.name} will now target ${chosen.attack.name}`});
	}

	/**
	 * Handle a weapon-modifier combat method (e.g. Wounding Strike).
	 * Shows weapon picker, then activates ongoing effect card.
	 */
	_activateWeaponModifierMethod (method, parsedEffects, cost, resourceName) {
		// Use cachedAttacks (includes auto-generated from equipped weapons), fall back to state attacks
		const attacks = this._cachedAttacks?.length ? this._cachedAttacks : (this._state.getAttacks?.() || []);
		// Filter to real weapons only — exclude unarmed strikes and spell attacks
		const weaponAttacks = attacks.filter(a => !a.isSpell && !a.isUnarmedStrike);

		if (weaponAttacks.length === 0) {
			JqueryUtil.doToast({type: "warning", content: `No weapon attacks available for ${method.name}!`});
			return;
		}

		// Check for a remembered weapon choice
		const remembered = this._state.getCombatMethodWeapon(method.name);
		if (remembered) {
			const rememberedAttack = weaponAttacks.find(a => a.id === remembered.weaponId);
			if (rememberedAttack) {
				this._applyWeaponModifierEffect(method, parsedEffects, rememberedAttack, cost, resourceName);
				return;
			}
		}

		// No remembered weapon (or it's no longer available) — show picker
		this._showWeaponPicker(method, parsedEffects, weaponAttacks, cost, resourceName);
	}

	/**
	 * Show a weapon picker modal for weapon-modifier combat methods.
	 */
	async _showWeaponPicker (method, parsedEffects, weaponAttacks, cost, resourceName) {
		const choices = weaponAttacks.map(atk => ({
			name: `${atk.name} (${atk.damage} ${atk.damageType || ""})`,
			attack: atk,
		}));

		const chosen = await this._showCombatActionChoiceModal(
			{name: `⚔️ ${method.name} — Choose Weapon`},
			choices,
		);

		if (!chosen) return;

		// Remember this weapon choice
		this._state.setCombatMethodWeapon(method.name, chosen.attack.id, chosen.attack.name);

		this._applyWeaponModifierEffect(method, parsedEffects, chosen.attack, cost, resourceName);

		// Re-render methods to show remembered weapon label
		this.renderCombatMethods();
	}

	/**
	 * Apply a weapon modifier effect to a chosen weapon attack.
	 */
	_applyWeaponModifierEffect (method, parsedEffects, attack, cost, resourceName) {
		const calcs = this._state.getFeatureCalculations?.() || {};
		const saveDc = calcs.combatMethodDc || 10;

		this._state.activateCombatMethodEffect({
			name: method.name,
			weaponId: attack.id,
			weaponName: attack.name,
			ongoingDamage: parsedEffects.ongoingDamage || null,
			ongoingSaveType: parsedEffects.ongoingSaveType || parsedEffects.saveType || null,
			saveDc,
			alternativeEndCheck: parsedEffects.alternativeEndCheck || null,
			description: method.entries ? JSON.stringify(method.entries) : "",
		});

		this.renderCombatEffects();
		this._page._saveCurrentCharacter?.();

		const dmgText = parsedEffects.ongoingDamage ? ` (${parsedEffects.ongoingDamage} ongoing damage)` : "";
		JqueryUtil.doToast({type: "success", content: `${method.name} applied to ${attack.name}${dmgText}! (−${cost} ${resourceName})`});
	}

	/**
	 * Check if a combat method is a stance (has duration) vs instant effect
	 */
	_isMethodStance (method) {
		// Quick check: if "Stance" is in the name
		if (method.name?.toLowerCase().includes("stance")) return true;

		if (!method.entries) return false;
		const entriesStr = JSON.stringify(method.entries).toLowerCase();

		// Check for duration indicators
		const stanceIndicators = [
			"until the start of your next turn",
			"until the end of your next turn",
			"for 1 minute",
			"for the duration",
			"while this stance",
			"while in this stance",
			"this stance lasts",
			"you enter",
			"you maintain",
			"concentration",
		];

		return stanceIndicators.some(indicator => entriesStr.includes(indicator));
	}

	/**
	 * Exit the currently active combat stance. Reverses the full activation done in
	 * `_activateMethodEffect` (both the `combatStance` active-state badge AND the
	 * `_data.activeStance` mechanical bridge) and mirrors the same refresh path so every
	 * dependent surface (states, effects, methods buttons, sheet) updates. No stamina is
	 * spent or refunded — ending a stance is a free bonus action.
	 */
	_exitStance (method) {
		this._state.deactivateStance?.();
		this._state.deactivateState?.("combatStance");

		this.renderCombatStates();
		this.renderCombatEffects();
		this._page._renderActiveStates?.();
		this._page._saveCurrentCharacter?.();
		this._page._renderCharacter?.();
		this.renderCombatMethods();

		JqueryUtil.doToast({type: "info", content: `Ended ${method.name}.`});
	}

	_modifyStamina (delta) {
		const current = this._state.getStaminaCurrent() || 0;
		const max = this._state.getStaminaMax() || 0;
		const newValue = Math.max(0, Math.min(max, current + delta));
		this._state.setStaminaCurrent(newValue);
		this._updateStaminaDisplay();
		// Also update resources section
		if (this._page?._features) {
			this._page._features._renderResources();
		}
	}

	_updateStaminaDisplay () {
		const current = this._state.getStaminaCurrent() || 0;
		const max = this._state.getStaminaMax() || 0;

		const elCurrent = document.getElementById("charsheet-stamina-current");
		if (elCurrent) elCurrent.textContent = current;
		const elMax = document.getElementById("charsheet-stamina-max");
		if (elMax) elMax.textContent = max;

		// Color-code based on remaining stamina
		const display = document.getElementById("charsheet-stamina-display-tab");
		if (display) {
			display.classList.remove("text-success", "text-warning", "text-danger");
			if (current === 0) {
				display.classList.add("text-danger");
			} else if (current <= max / 2) {
				display.classList.add("text-warning");
			} else {
				display.classList.add("text-success");
			}
		}

		// Update resource pips in the resources section
		// Filled = available, empty = used
		const resourcePips = document.querySelectorAll("[data-resource-id=\"stamina\"] .charsheet__resource-pip--stamina");
		if (resourcePips.length) {
			resourcePips.forEach((pip, i) => {
				pip.classList.toggle("used", i >= current); // Empty (used) if index >= current available
			});
		}
	}

	/**
	 * Show the Combat Methods picker modal
	 * Allows adding/removing combat methods from selected traditions
	 */
	async _showMethodPicker () {
		const allOptFeatures = this._page.getOptionalFeatures() || [];
		const combatMethodEntities = this._page.getCombatMethodEntities?.() || [];

		// Get all combat method features (both legacy optionalfeatures and new combatMethod entities)
		const allMethods = CharacterSheetClassUtils.dedupeCombatMethodCatalog(
			[...allOptFeatures, ...combatMethodEntities].filter(opt =>
				CharacterSheetClassUtils.isCombatMethod(opt),
			),
		);

		if (allMethods.length === 0) {
			JqueryUtil.doToast({type: "warning", content: "No combat methods available. Load the Thelemar homebrew source."});
			return;
		}

		// Get character's selected traditions
		let selectedTraditions = this._getCharacterTraditions();

		// Get currently known methods
		const knownMethods = this._state.getFeatures().filter(f => CharacterSheetClassUtils.isCombatMethod(f));
		const knownMethodNames = new Set(knownMethods.map(m => `${m.name}|${m.source || ""}`));

		// Get max degree and max methods based on character level
		const maxDegree = this._getCharacterMaxDegree();
		const maxMethods = this._getCharacterMaxMethods();

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "Combat Methods",
			isMinHeight0: true,
			isWidth100: true,
			isMaxWidth640p: true,
			zIndex: 1500, // Higher z-index to ensure hover popups work
			cbClose: () => document.body.classList.remove("has-method-picker"),
		});

		// Add class for styling and make sure hovers appear above
		modalInner.classList.add("charsheet__method-picker");
		document.body.classList.add("has-method-picker");
		modalInner.closest(".ve-ui-modal__inner").style.zIndex = "1500";

		// Create content container
		const content = e_({outer: `<div class="ve-flex-col h-100"></div>`}); modalInner.append(content);

		// === HEADER: Stats summary ===
		const header = e_({outer: `
			<div class="charsheet__method-picker-header">
				<div class="charsheet__method-picker-header-left">
					<span class="charsheet__method-picker-header-icon">⚔️</span>
					<div>
						<div class="charsheet__method-picker-header-title">Combat Methods</div>
						<div class="charsheet__method-picker-header-stat" style="display: flex; align-items: center; gap: 0.6rem; margin-top: 0.15rem;">
							<span>Max Degree: <span class="charsheet__method-picker-header-stat-value">${maxDegree > 0 ? maxDegree + this._getOrdinalSuffix(maxDegree) : "—"}</span></span>
							<span style="opacity: 0.4;">•</span>
							<span>Traditions: <span class="charsheet__method-picker-header-stat-value" id="method-picker-trad-count">${selectedTraditions.length}</span></span>
						</div>
					</div>
				</div>
				<div class="charsheet__method-picker-header-right">
					<div class="charsheet__method-picker-header-known-row">
						<span class="charsheet__method-picker-header-stat">Known:</span>
						<span class="charsheet__method-picker-header-known" id="method-picker-known-count">${knownMethodNames.size}</span>
						<span class="charsheet__method-picker-header-stat">/ ${maxMethods > 0 ? maxMethods : "∞"}</span>
					</div>
				</div>
			</div>
		`}); content.append(header);

		// === TRADITIONS SECTION ===
		const tradSection = e_({outer: `
			<div class="charsheet__method-picker-trads-section">
				<div class="charsheet__method-picker-trads-header">
					<span class="charsheet__method-picker-trads-title">Your Traditions</span>
					<button class="ve-btn ve-btn-xs ve-btn-default" id="method-picker-toggle-trads" title="Edit traditions">
						<span class="glyphicon glyphicon-pencil"></span> Edit
					</button>
				</div>
				<div id="method-picker-trads-display" class="charsheet__method-picker-trads-display"></div>
				<div id="method-picker-trads-edit" style="display: none;"></div>
			</div>
		`}); content.append(tradSection);

		// Render tradition display (compact pills)
		const tradsDisplay = tradSection.querySelector("#method-picker-trads-display");
		const tradsEdit = tradSection.querySelector("#method-picker-trads-edit");
		const toggleBtn = tradSection.querySelector("#method-picker-toggle-trads");
		let editMode = false;

		const tradIcons = this._getTraditionIcons();

		const renderTradsDisplay = () => {
			tradsDisplay.innerHTML = "";
			if (selectedTraditions.length === 0) {
				tradsDisplay.insertAdjacentHTML("beforeend", `<span class="charsheet__method-picker-header-stat" style="font-style: italic;">No traditions selected. Click Edit to choose.</span>`);
			} else {
				for (const code of selectedTraditions) {
					tradsDisplay.insertAdjacentHTML("beforeend", `
						<span class="charsheet__method-picker-trad-pill">
							<span class="charsheet__method-picker-trad-icon">${tradIcons[code] || "⚔️"}</span>
							${this._getTraditionName(code)}
						</span>
					`);
				}
			}
		};
		renderTradsDisplay();

		// Toggle edit mode
		toggleBtn.addEventListener("click", () => {
			editMode = !editMode;
			tradsDisplay.style.display = (!editMode) ? "" : "none";
			tradsEdit.style.display = (editMode) ? "" : "none";
			toggleBtn.innerHTML = editMode
				? "<span class=\"glyphicon glyphicon-ok\"></span> Done"
				: "<span class=\"glyphicon glyphicon-pencil\"></span> Edit";
			if (!editMode) {
				renderTradsDisplay();
				document.getElementById("method-picker-trad-count").textContent = selectedTraditions.length;
				this._renderMethodList(methodList, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);
			}
		});

		// Render tradition editor
		this._renderTraditionSelection(tradsEdit, selectedTraditions, () => {
			selectedTraditions = this._getSelectedTraditionsFromUI(tradsEdit);
		});

		// === FILTERS SECTION ===
		let filterTrad = "all";
		let filterDegree = "all";
		let filterStatus = "all";
		let searchQuery = "";

		const filterSection = e_({outer: `
			<div class="charsheet__method-picker-filters">
				<div class="charsheet__method-picker-search">
					<input type="text" class="ve-form-control ve-input-sm" id="method-picker-search" placeholder="🔍 Search methods...">
				</div>
				<select class="ve-form-control ve-input-sm charsheet__method-picker-filter-select" id="method-picker-trad-filter" style="min-width: 130px;">
					<option value="all">All Traditions</option>
				</select>
				<select class="ve-form-control ve-input-sm charsheet__method-picker-filter-select" id="method-picker-degree" style="min-width: 100px;">
					<option value="all">All Degrees</option>
					${[1, 2, 3, 4, 5].filter(d => d <= maxDegree).map(d =>
		`<option value="${d}">${d}${this._getOrdinalSuffix(d)} Degree</option>`,
	).join("")}
				</select>
				<select class="ve-form-control ve-input-sm charsheet__method-picker-filter-select" id="method-picker-filter" style="min-width: 90px;">
					<option value="all">All</option>
					<option value="known">Known</option>
					<option value="available">Available</option>
				</select>
			</div>
		`}); content.append(filterSection);

		// Populate tradition filter dropdown
		const tradFilter = filterSection.querySelector("#method-picker-trad-filter");
		const updateTradFilterOptions = () => {
			tradFilter.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
			for (const code of selectedTraditions) {
				tradFilter.insertAdjacentHTML("beforeend", `<option value="${code}">${tradIcons[code] || "⚔️"} ${this._getTraditionName(code)}</option>`);
			}
		};
		updateTradFilterOptions();

		// === METHOD LIST ===
		const methodList = e_({outer: `
			<div class="charsheet__method-picker-list"></div>
		`}); content.append(methodList);

		// Initial render
		this._renderMethodList(methodList, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);

		// Filter event listeners
		filterSection.querySelector("#method-picker-search")?.addEventListener("input", MiscUtil.debounce((e) => {
			searchQuery = e.target.value.toLowerCase();
			this._renderMethodList(methodList, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);
		}, 150));

		filterSection.querySelector("#method-picker-trad-filter")?.addEventListener("change", (/** @type {*} */ e) => {
			filterTrad = e.target.value;
			this._renderMethodList(methodList, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);
		});

		filterSection.querySelector("#method-picker-degree")?.addEventListener("change", (/** @type {*} */ e) => {
			filterDegree = e.target.value;
			this._renderMethodList(methodList, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);
		});

		filterSection.querySelector("#method-picker-filter")?.addEventListener("change", (/** @type {*} */ e) => {
			filterStatus = e.target.value;
			this._renderMethodList(methodList, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);
		});

		// === FOOTER ===
		const footer = e_({outer: `
			<div class="charsheet__method-picker-footer">
				<span class="charsheet__method-picker-footer-hint">💡 Hover method names for details</span>
				<button class="charsheet__method-picker-footer-btn">Done</button>
			</div>
		`}); content.append(footer);

		footer.querySelector("button")?.addEventListener("click", async () => {
			this._saveSelectedTraditions(selectedTraditions);
			await this._page.saveCharacter();
			this._page.renderCharacter();
			doClose(true);
		});
	}

	/**
	 * Get tradition icons mapping
	 */
	_getTraditionIcons () {
		return {
			"AM": "🏔️",
			"AK": "✨",
			"BU": "🐺",
			"BZ": "💨",
			"CJ": "🎭",
			"EB": "🌑",
			"GH": "💖",
			"MG": "🪞",
			"MS": "🌫️",
			"RC": "🌊",
			"RE": "🗡️",
			"SK": "🩸",
			"SS": "🐎",
			"TI": "⚔️",
			"TC": "🦷",
			"UW": "☯️",
			"UH": "🦅",
		};
	}

	/**
	 * Calculate max methods character can know
	 */
	_getCharacterMaxMethods () {
		// Look for a class with Combat Methods progression
		const classes = this._state.getClasses();
		let maxMethods = 0;

		for (const cls of classes) {
			const classData = this._page.getClasses?.().find(c => c.name === cls.name && c.source === cls.source);
			if (!classData?.optionalfeatureProgression) continue;

			const cmProg = classData.optionalfeatureProgression.find(prog =>
				prog.featureType?.some(ft => ft.startsWith("CTM:")) || prog.name?.toLowerCase().includes("combat method"),
			);
			if (!cmProg?.progression) continue;

			// Get methods at current level
			const level = cls.level || 1;
			const levelKey = String(level);
			if (cmProg.progression[levelKey]) {
				maxMethods += cmProg.progression[levelKey];
			} else {
				// Find the highest level <= current level
				const levels = Object.keys(cmProg.progression).map(Number).filter(l => l <= level).sort((a, b) => b - a);
				if (levels.length > 0) {
					maxMethods += cmProg.progression[String(levels[0])];
				}
			}

			// Add bonus methods granted by the (effective) subclass. The subclass
			// reference may be stale `null` on un-migrated saves, so resolve it via
			// the central resolver (embedded subclass features) rather than reading
			// cls.subclass directly — otherwise the cap is short by the +1 (or more)
			// the subclass grants (e.g. Arcane Archer → +1 method).
			const effectiveSubclass = this._state.getEffectiveSubclassForClass?.(cls) ?? cls.subclass;
			maxMethods += CharacterSheetClassUtils.getSubclassBonusMethodCount(effectiveSubclass, cls.source);
		}

		return maxMethods;
	}

	/**
	 * Does the character have access to combat methods at all? True when any
	 * class has an optionalfeatureProgression that grants combat methods (a
	 * `CTM:` featureType or a "combat method" progression name). Used so the
	 * combat-tab Combat Methods section — and its "Manage" button — stays
	 * reachable even before the first method is learned.
	 * @returns {boolean}
	 */
	_hasCombatMethodAccess () {
		const classes = this._state.getClasses?.() || [];
		for (const cls of classes) {
			const classData = this._page.getClasses?.().find(c => c.name === cls.name && c.source === cls.source);
			if (!classData?.optionalfeatureProgression) continue;
			const hasCtm = classData.optionalfeatureProgression.some(prog =>
				prog.featureType?.some(ft => ft.startsWith("CTM:")) || prog.name?.toLowerCase().includes("combat method"),
			);
			if (hasCtm) return true;
		}
		return false;
	}

	/**
	 * Build the grouped tradition-selection model for the current character.
	 * Gathers the per-class available pool (restricted subclass choice pools take
	 * precedence over the base class list when they replace it) and the locked
	 * traditions granted by each (effective) subclass, then delegates the grouping
	 * to the pure {@link CharacterSheetClassUtils.buildTraditionSelectionModel}.
	 * @param {string[]} selectedTraditions - Flat array of selected codes.
	 * @returns {*} The grouped selection model.
	 */
	_getTraditionSelectionModel (selectedTraditions) {
		const state = this._state;
		const classes = state.getClasses?.() || [];
		const allOptFeatures = this._page?.getOptionalFeatures?.() || [];
		const classFeatures = this._page?.getClassFeatures?.() || [];
		const pageClasses = this._page?.getClasses?.() || [];

		const availableSet = new Set();
		const grantedSet = new Set();
		let sawRestriction = false;
		const allCount = CharacterSheetClassUtils.getAllTraditions().length;

		for (const cls of classes) {
			const classData = pageClasses.find(c => c.name === cls.name && c.source === cls.source);
			const effectiveSubclass = state.getEffectiveSubclassForClass?.(cls) ?? cls.subclass;

			// Locked (fixed, non-choice) traditions the subclass always grants.
			const grants = CharacterSheetClassUtils.getSubclassGrantedTraditions(effectiveSubclass, cls.source) || [];
			for (const g of grants) if (g.code && !g.choice) grantedSet.add(g.code);

			// Restricted subclass choice pool (e.g. Arcane Archer → BZ/RE/UW/UH).
			const pool = CharacterSheetClassUtils.getSubclassTraditionChoicePool(effectiveSubclass, cls.source);
			if (pool && pool.kind === "restricted" && Array.isArray(pool.codes)) {
				pool.codes.forEach(c => availableSet.add(c));
				sawRestriction = true;
			}
			// NOTE: the subclass choice pool is ADDITIVE in the post-hoc combat-tab
			// tradition editor. Even a `replacesBase` Fighter subclass (Arcane Archer /
			// Champion / Banneret / Battle Master) keeps the base Fighter free tradition
			// choice available here, so methods learned in another tradition before
			// subclassing (e.g. the dikaios Arcane Archer's Adamant Mountain / Sanguine
			// Knot picks) can still be kept and more traditions can still be added. The
			// `replacesBase` flag only suppresses the DUPLICATE base picker at the moment
			// the subclass is first chosen in QuickBuild/LevelUp — it must NOT narrow this
			// management UI. So we always fall through and add the base available list.

			// Base class available traditions.
			const cmProg = classData?.optionalfeatureProgression?.find(p =>
				p.featureType?.some(ft => ft.startsWith("CTM:")) || p.name?.toLowerCase().includes("combat method"),
			);
			const classAllowedTypes = cmProg?.featureType || [];
			const avail = CharacterSheetClassUtils.getAvailableTraditionsForClass(allOptFeatures, classAllowedTypes, classData?.name, classFeatures) || [];
			if (avail.length && avail.length < allCount) sawRestriction = true;
			avail.forEach(t => availableSet.add(t.code));
		}

		const availableCodes = sawRestriction ? Array.from(availableSet) : [];
		return CharacterSheetClassUtils.buildTraditionSelectionModel(selectedTraditions, {
			grantedCodes: Array.from(grantedSet),
			availableCodes,
		});
	}

	/**
	 * Render tradition selection: grouped (locked granted / available / other),
	 * with a live name filter. The underlying selection stays a flat code array
	 * (`selectedTraditions`) — locked traditions are kept checked + disabled so
	 * `_getSelectedTraditionsFromUI` still includes them, and filtered-out chips
	 * remain in the DOM (hidden) so a hidden selection is never dropped.
	 */
	_renderTraditionSelection (container, selectedTraditions, onChange) {
		container.innerHTML = "";
		Object.assign(container.style, {"display": "flex", "flex-direction": "column", "gap": "0.4rem", "padding": "0.5rem", "background": "var(--rgb-bg-alt)", "border-radius": "4px"});

		const model = this._getTraditionSelectionModel(selectedTraditions);
		// Ensure locked/granted traditions are reflected in the live selection array.
		for (const code of model.grantedCodes) {
			if (!selectedTraditions.includes(code)) selectedTraditions.push(code);
		}

		const tradIcons = this._getTraditionIcons();

		// --- Filter input ---
		const filterWrap = e_({outer: `<div class="charsheet__method-picker-trad-filter mb-1"></div>`});
		const filterInput = e_({outer: `<input type="text" class="ve-form-control ve-input-sm" placeholder="🔍 Filter traditions...">`});
		filterWrap.append(filterInput);
		container.append(filterWrap);

		const allChips = [];

		const makeChip = (trad) => {
			const isSelected = trad.locked || selectedTraditions.includes(trad.code);
			const lockIcon = trad.locked ? ` <span title="Granted by your subclass" style="opacity:0.7;">🔒</span>` : "";
			const chip = e_({outer: `
				<label class="ve-flex ve-flex-v-center" style="
					cursor: ${trad.locked ? "default" : "pointer"};
					padding: 0.25rem 0.5rem;
					border: 1px solid ${isSelected ? "var(--rgb-link)" : "var(--rgb-border-grey)"};
					border-radius: 4px;
					background: ${isSelected ? "rgba(51,122,183,0.15)" : "transparent"};
					opacity: ${trad.locked ? "0.85" : "1"};
					font-size: 0.85rem;
					transition: all 0.15s;
				" data-trad="${trad.code}">
					<input type="checkbox" class="mr-1" style="margin: 0;" ${isSelected ? "checked" : ""} ${trad.locked ? "disabled" : ""}>
					<span>${tradIcons[trad.code] || "⚔️"}</span>
					<span class="ml-1">${trad.name}</span>${lockIcon}
				</label>
			`});

			if (!trad.locked) {
				chip.querySelector("input")?.addEventListener("change", function () {
					const code = chip.dataset.trad;
					const checked = this.checked;
					if (checked && !selectedTraditions.includes(code)) {
						selectedTraditions.push(code);
					} else if (!checked) {
						const idx = selectedTraditions.indexOf(code);
						if (idx >= 0) selectedTraditions.splice(idx, 1);
					}
					Object.assign(chip.style, {
						"border-color": checked ? "var(--rgb-link)" : "var(--rgb-border-grey)",
						"background": checked ? "rgba(51,122,183,0.15)" : "transparent",
					});
					onChange();
				});
			}

			allChips.push({chip, name: trad.name.toLowerCase()});
			return chip;
		};

		for (const group of model.groups) {
			const section = e_({outer: `<div class="charsheet__method-picker-trad-group"></div>`});
			section.append(e_({outer: `<div class="ve-small ve-muted mb-1" style="font-weight:600;">${group.label}</div>`}));
			const chipRow = e_({outer: `<div style="display:flex; flex-wrap:wrap; gap:0.4rem;"></div>`});
			for (const trad of group.traditions) chipRow.append(makeChip(trad));
			section.append(chipRow);
			container.append(section);
		}

		// --- Live filter ---
		filterInput.addEventListener("input", function () {
			const q = (this.value || "").trim().toLowerCase();
			for (const {chip, name} of allChips) {
				chip.style.display = (!q || name.includes(q)) ? "" : "none";
			}
		});
	}

	/**
	 * Get selected traditions from the UI checkboxes
	 */
	_getSelectedTraditionsFromUI (container) {
		const selected = [];
		container.querySelectorAll("input:checked").forEach((el) => {
			selected.push(el.closest("label")?.dataset.trad);
		});
		return selected;
	}

	/**
	 * Render the method list with filtering and hoverable names
	 */
	_renderMethodList (container, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad = "all", filterDegree = "all", filterStatus = "all", searchQuery = "") {
		container.innerHTML = "";

		// Filter methods
		let filteredMethods = allMethods.filter(method => {
			const tradCode = this._getMethodTraditionFromOptFeature(method);
			const key = `${method.name}|${method.source || ""}`;
			const isKnown = knownMethodNames.has(key);

			// Known methods should always appear (so they can be removed),
			// even if their tradition is no longer selected
			if (!isKnown && !selectedTraditions.includes(tradCode)) return false;

			// Tradition filter (if specific tradition selected in dropdown)
			if (filterTrad !== "all" && tradCode !== filterTrad) return false;

			// Must be within max degree (but known methods are exempt)
			const degree = this._getMethodDegreeFromOptFeature(method);
			if (!isKnown && degree > maxDegree) return false;

			// Search filter
			if (searchQuery && !method.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;

			// Degree filter
			if (filterDegree !== "all" && degree !== parseInt(filterDegree)) return false;

			// Status filter
			if (filterStatus === "known" && !isKnown) return false;
			if (filterStatus === "available" && isKnown) return false;

			return true;
		});

		if (selectedTraditions.length === 0) {
			container.insertAdjacentHTML("beforeend", `
				<div class="charsheet__method-picker-empty">
					<div class="charsheet__method-picker-empty-icon">📜</div>
					<p class="charsheet__method-picker-empty-text">Select at least one tradition to see available methods.</p>
				</div>
			`);
			return;
		}

		if (filteredMethods.length === 0) {
			container.insertAdjacentHTML("beforeend", `
				<div class="charsheet__method-picker-empty">
					<div class="charsheet__method-picker-empty-icon">🔍</div>
					<p class="charsheet__method-picker-empty-text">No methods match the current filters.</p>
				</div>
			`);
			return;
		}

		// Group by tradition and degree
		const methodsByTrad = new Map();
		for (const method of filteredMethods) {
			const tradCode = this._getMethodTraditionFromOptFeature(method);
			if (!methodsByTrad.has(tradCode)) {
				methodsByTrad.set(tradCode, []);
			}
			methodsByTrad.get(tradCode).push(method);
		}

		// Tradition icons mapping
		const tradIcons = {
			"AM": "🏔️",
			"AK": "✨",
			"BU": "🐺",
			"BZ": "💨",
			"CJ": "🎭",
			"EB": "🌑",
			"GH": "💖",
			"MG": "🪞",
			"MS": "🌫️",
			"RC": "🌊",
			"RE": "🗡️",
			"SK": "🩸",
			"SS": "🐎",
			"TI": "⚔️",
			"TC": "🦷",
			"UW": "☯️",
			"UH": "🦅",
		};

		// Get all tradition codes that have methods to show (selected + those with known methods)
		const traditionsToRender = new Set(selectedTraditions);
		for (const [tradCode] of methodsByTrad) {
			traditionsToRender.add(tradCode);
		}

		// Render grouped methods - selected traditions first, then others
		const sortedTraditions = [...traditionsToRender].sort((a, b) => {
			const aSelected = selectedTraditions.includes(a);
			const bSelected = selectedTraditions.includes(b);
			if (aSelected !== bSelected) return aSelected ? -1 : 1;
			return this._getTraditionName(a).localeCompare(this._getTraditionName(b));
		});

		for (const tradCode of sortedTraditions) {
			const methods = methodsByTrad.get(tradCode) || [];
			if (methods.length === 0) continue;

			const isSelectedTradition = selectedTraditions.includes(tradCode);
			const tradGroup = e_({outer: `
				<div class="charsheet__method-picker-trad-group ${!isSelectedTradition ? "charsheet__method-picker-trad-group--unselected" : ""}">
					<div class="charsheet__method-picker-trad-group-header">
						<span class="charsheet__method-picker-trad-group-icon">${tradIcons[tradCode] || "⚔️"}</span>
						<span class="charsheet__method-picker-trad-group-name">${this._getTraditionName(tradCode)}${!isSelectedTradition ? " (not selected)" : ""}</span>
						<span class="charsheet__method-picker-trad-group-count">${methods.length}</span>
					</div>
				</div>
			`});

			// Sort by degree then name
			methods.sort((a, b) => {
				const degA = this._getMethodDegreeFromOptFeature(a);
				const degB = this._getMethodDegreeFromOptFeature(b);
				return degA - degB || a.name.localeCompare(b.name);
			});

			for (const method of methods) {
				const key = `${method.name}|${method.source || ""}`;
				const isKnown = knownMethodNames.has(key);
				const degree = this._getMethodDegreeFromOptFeature(method);
				const cost = this._getMethodStaminaCostFromOptFeature(method);
				const activation = this._getMethodActivationTime(method);
				const isStance = this._isMethodStance(method);

				// Create hoverable method name link
				let methodNameHtml = `<span class="bold">${method.name}</span>`;
				try {
					if (this._page?.getHoverLink && method.source) {
						methodNameHtml = this._page.getHoverLink(UrlUtil.PG_COMBAT_METHODS, method.name, method.source);
					}
				} catch (e) {
					// Fall back to plain text
				}

				// Activation badge class
				const activationBadgeClass = {
					"A": "charsheet__method-badge--action",
					"BA": "charsheet__method-badge--bonus",
					"R": "charsheet__method-badge--reaction",
				};
				const actClass = activation ? activationBadgeClass[activation] : null;
				const activationLabels = {"A": "Action", "BA": "Bonus", "R": "React"};

				const methodEl = e_({outer: `
					<div class="charsheet__method-picker-item ${isKnown ? "charsheet__method-picker-item--known" : ""}">
						<div class="charsheet__method-picker-item-content">
							${isKnown ? "<span class=\"glyphicon glyphicon-ok charsheet__method-picker-item-known-icon\"></span>" : ""}
							<span class="charsheet__method-picker-item-name">${methodNameHtml}</span>
							<span class="charsheet__method-badge charsheet__method-badge--degree">${degree}${this._getOrdinalSuffix(degree)}</span>
							${actClass ? `<span class="charsheet__method-badge ${actClass}">${activationLabels[activation]}</span>` : ""}
							${cost > 0 ? `<span class="charsheet__method-badge charsheet__method-badge--ep">${cost} EP</span>` : ""}
							${isStance ? `<span class="charsheet__method-badge charsheet__method-badge--stance">Stance</span>` : ""}
						</div>
						<div class="charsheet__method-picker-item-actions">
							${isKnown
		? `<button class="charsheet__method-picker-btn charsheet__method-picker-btn--remove charsheet__method-remove" data-method-key="${key}">
									<span class="glyphicon glyphicon-minus"></span>
								</button>`
		: `<button class="charsheet__method-picker-btn charsheet__method-picker-btn--add charsheet__method-add" data-method-key="${key}">
									<span class="glyphicon glyphicon-plus"></span>
								</button>`
}
						</div>
					</div>
				`});

				// Store method data
				methodEl._methodData = method;

				// Event handlers
				methodEl.querySelector(".charsheet__method-add")?.addEventListener("click", (/** @type {*} */ e) => {
					e.stopPropagation();
					this._addCombatMethod(method);
					knownMethodNames.add(key);
					this._renderMethodList(container, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);
					// Update known count badge
					document.getElementById("method-picker-known-count").textContent = knownMethodNames.size;
				});

				methodEl.querySelector(".charsheet__method-remove")?.addEventListener("click", (/** @type {*} */ e) => {
					e.stopPropagation();
					this._removeCombatMethod(method);
					knownMethodNames.delete(key);
					this._renderMethodList(container, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);
					// Update known count badge
					document.getElementById("method-picker-known-count").textContent = knownMethodNames.size;
				});

				tradGroup.append(methodEl);
			}

			container.append(tradGroup);
		}
	}

	/**
	 * Get character's selected combat traditions
	 */
	_getCharacterTraditions () {
		const traditions = new Set();

		// Subclass-granted FIXED traditions always apply (e.g. Arcane Archer,
		// Warder) — surface them even before any method is learned so the picker
		// isn't blocked by an empty tradition list.
		const classes = this._state.getClasses?.() || [];
		for (const cls of classes) {
			const granted = CharacterSheetClassUtils.getSubclassGrantedTraditions(cls.subclass, cls.source) || [];
			for (const t of granted) {
				if (t.code && !t.choice) traditions.add(t.code);
			}
		}

		// Canonical persisted traditions.
		const stateTraditions = this._state.getCombatTraditions?.() || [];
		for (const code of stateTraditions) traditions.add(code);

		// Explicit (persisted) or granted traditions win — don't also infer from
		// known methods (preserves prior "explicit wins" behaviour).
		if (traditions.size) return Array.from(traditions);

		// Otherwise infer from known combat methods.
		const knownMethods = this._state.getFeatures().filter(f => CharacterSheetClassUtils.isCombatMethod(f));
		for (const method of knownMethods) {
			const tradCode = CharacterSheetClassUtils.getMethodTraditionCode(method);
			if (tradCode) traditions.add(tradCode);
		}

		return Array.from(traditions);
	}

	/**
	 * Save selected traditions to character settings
	 */
	_saveSelectedTraditions (traditions) {
		this._state.setCombatTraditions?.(traditions);
	}

	/**
	 * Get max method degree based on character class level
	 */
	_getCharacterMaxDegree () {
		// Look for a class with Combat Methods progression
		const classes = this._state.getClasses();
		let maxDegree = 0;

		for (const cls of classes) {
			const classData = this._page.getClasses?.().find(c => c.name === cls.name && c.source === cls.source);
			if (!classData?.optionalfeatureProgression) continue;

			const cmProg = classData.optionalfeatureProgression.find(prog =>
				prog.featureType?.some(ft => ft.startsWith("CTM:")) || prog.name?.toLowerCase().includes("combat method"),
			);
			if (!cmProg) continue;

			// Get max degree at current level
			// Degrees are typically: 1st at 1-4, 2nd at 5-8, 3rd at 9-12, 4th at 13-16, 5th at 17+
			const level = cls.level || 1;
			let degree = 1;
			if (level >= 17) degree = 5;
			else if (level >= 13) degree = 4;
			else if (level >= 9) degree = 3;
			else if (level >= 5) degree = 2;

			maxDegree = Math.max(maxDegree, degree);
		}

		return maxDegree || 1; // Default to at least 1st degree
	}

	/**
	 * Add a combat method to the character
	 */
	_addCombatMethod (method) {
		const featureData = {
			name: method.name,
			source: method.source,
			featureType: "Optional Feature",
			optionalFeatureTypes: method.featureType,
			description: method.entries ? Renderer.get().render({entries: method.entries}) : "",
			entries: method.entries,
		};
		// Persist the structured combat-method markers from the catalog entity so the
		// learned method stays ATTRIBUTED (tradition/degree/stamina/action) through a
		// save -> reload. Without these the generic CTM optionalFeatureTypes carry no
		// tradition letter, so getMethodTraditionCode returns null and the method is
		// un-attributed forever. The `method` arg IS the catalog combatMethod entity, so
		// it carries these fields; copy each only when present (never write undefined).
		featureData._entityType = "combatMethod";
		if (method.tradition !== undefined) featureData.tradition = method.tradition;
		if (method.degree !== undefined) featureData.degree = method.degree;
		if (method.staminaCost !== undefined) featureData.staminaCost = method.staminaCost;
		if (method.actionType !== undefined) featureData.actionType = method.actionType;
		this._state.addFeature(featureData);
		// Persist immediately so the change survives regardless of how the picker
		// modal is closed (X / click-outside / ESC don't trigger the Done save).
		this._page?.saveCharacter?.();
		JqueryUtil.doToast({type: "success", content: `Learned ${method.name}!`});
	}

	/**
	 * Remove a combat method from the character
	 */
	_removeCombatMethod (method) {
		this._state.removeFeature(method.name, method.source);
		// Also strip the method from the level-history optional-feature snapshots so the
		// load-time replay (_reapplyHistoryOptionalFeatures) does not resurrect it on the
		// next refresh. Without this, removing a method that was LEARNED at a level (its
		// snapshot lives in levelHistory) survives in-memory but reappears after reload.
		this._state.removeOptionalFeatureFromHistory?.(method.name, method.source);
		// Persist immediately so the removal survives regardless of how the picker
		// modal is closed (X / click-outside / ESC don't trigger the Done save).
		this._page?.saveCharacter?.();
		JqueryUtil.doToast({type: "info", content: `Removed ${method.name}.`});
	}

	/**
	 * Get method tradition code from optional feature
	 */
	_getMethodTraditionFromOptFeature (method) {
		return CharacterSheetClassUtils.getMethodTraditionCode(method) || "Unknown";
	}

	_getMethodDegreeFromOptFeature (method) {
		return CharacterSheetClassUtils.getMethodDegree(method);
	}

	_getMethodStaminaCostFromOptFeature (method) {
		return CharacterSheetClassUtils.getMethodStaminaCost(method);
	}

	_getMethodActivationTime (method) {
		const actionType = CharacterSheetClassUtils.getMethodActionType(method);
		if (!actionType) return null;
		const lower = actionType.toLowerCase();
		if (lower.includes("reaction")) return "R";
		if (lower.includes("bonus")) return "BA";
		if (lower.includes("action")) return "A";
		return null;
	}

	_getMethodDegree (feature) {
		return CharacterSheetClassUtils.getMethodDegree(feature);
	}

	_getMethodTradition (feature) {
		return CharacterSheetClassUtils.getMethodTraditionCode(feature) || "Unknown";
	}

	_getTraditionName (tradCode) {
		return CharacterSheetClassUtils.getTraditionName(tradCode);
	}

	_getOrdinalSuffix (n) {
		const s = ["th", "st", "nd", "rd"];
		const v = n % 100;
		return s[(v - 20) % 10] || s[v] || s[0];
	}
	// #endregion

	// #region Metamagic Dashboard

	renderCombatMetamagic () {
		CharacterSheetCombat.renderMetamagicDashboard(this._state, this._page, "#charsheet-combat-metamagic", "#charsheet-combat-metamagic-section", "#charsheet-combat-metamagic-sp", {isSorceryPointEditable: true});
	}

	static _getMetamagicDashboardTargets () {
		// All three hosts are editable: the dashboard's Tune/Detune actions spend
		// sorcery points wherever they render, so the SP badge must be editable
		// everywhere too. (Overview previously omitted this on the refresh path,
		// so the badge silently changed behaviour after any re-render.)
		return [
			{containerSel: "#charsheet-overview-metamagic", sectionSel: "#charsheet-overview-metamagic-section", spBadgeSel: "#charsheet-overview-metamagic-sp", opts: {isSorceryPointEditable: true}},
			{containerSel: "#charsheet-combat-metamagic", sectionSel: "#charsheet-combat-metamagic-section", spBadgeSel: "#charsheet-combat-metamagic-sp", opts: {isSorceryPointEditable: true}},
			{containerSel: "#charsheet-spells-metamagic", sectionSel: "#charsheet-spells-metamagic-section", spBadgeSel: "#charsheet-spells-metamagic-sp", opts: {isSorceryPointEditable: true}},
		];
	}

	static _refreshMetamagicDashboards (state, page) {
		for (const target of CharacterSheetCombat._getMetamagicDashboardTargets()) {
			CharacterSheetCombat.renderMetamagicDashboard(state, page, target.containerSel, target.sectionSel, target.spBadgeSel, target.opts);
		}
	}

	static _refreshMetamagicRelatedUi (state, page) {
		CharacterSheetCombat._refreshMetamagicDashboards(state, page);
		if (typeof page._renderResources === "function") page._renderResources();
		if (page._spells && typeof page._spells._renderSpellList === "function") page._spells._renderSpellList();
		if (page._combat && typeof page._combat.renderCombatSpells === "function") page._combat.renderCombatSpells();
	}

	static _getMetamagicHoverLink (page, meta) {
		if (!meta?.name || typeof page?.getHoverLink !== "function") return meta?.name || "";

		try {
			const optFeature = CharacterSheetCombat._getMetamagicOptionalFeature(page, meta);
			return page.getHoverLink(globalThis.UrlUtil?.PG_OPT_FEATURES || "optionalfeatures.html", optFeature.name, optFeature.source, null, meta.name);
		} catch (e) {
			return meta.name;
		}
	}

	static _getMetamagicOptionalFeature (page, meta) {
		const fallbackSource = meta.source || "TGTT";
		const typeSuffix = meta.type === "passive" ? "Passive" : meta.type === "active" ? "Active" : null;
		const tgttName = typeSuffix ? `${meta.name} (${typeSuffix})` : meta.name;
		const allOptFeatures = page?.getOptionalFeatures?.() || page?._optionalFeaturesData || [];

		const exactTgtt = allOptFeatures.find(it => it.name === tgttName && (it.source || "").toUpperCase() === "TGTT");
		if (exactTgtt) return {name: exactTgtt.name, source: exactTgtt.source};

		const exactSource = allOptFeatures.find(it => it.name === tgttName && (!fallbackSource || (it.source || "").toUpperCase() === fallbackSource.toUpperCase()));
		if (exactSource) return {name: exactSource.name, source: exactSource.source};

		if (typeSuffix) return {name: tgttName, source: "TGTT"};

		const source = typeof page?.resolveOptionalFeatureSource === "function"
			? page.resolveOptionalFeatureSource(meta.name, [meta.source, "TGTT", globalThis.Parser?.SRC_XPHB, globalThis.Parser?.SRC_PHB])
			: fallbackSource;
		return {name: meta.name, source};
	}

	static renderMetamagicDashboard (state, page, containerSel, sectionSel, spBadgeSel, opts = {}) {
		const container = document.querySelector(containerSel);
		const section = document.querySelector(sectionSel);
		const spBadge = document.querySelector(spBadgeSel);
		if (!container || !section) return;

		const calc = state.getFeatureCalculations();
		if (!calc.hasMetamagic) {
			section.style.display = "none";
			return;
		}

		const knownKeys = new Set(state.getKnownMetamagicKeys?.() || []);
		if (!knownKeys.size) {
			section.style.display = "none";
			return;
		}

		section.style.display = "";
		container.innerHTML = "";
		// The Container-Adaptive Rule: this one code path renders on Overview
		// (~265px), Combat (~510px) and Spells, so the row layout must key off the
		// container's width rather than the host tab. See css `@container cs-panel`.
		container.classList?.add("cs-adaptive-panel");

		const sp = state.getSorceryPoints();

		// Update SP badge
		if (spBadge) {
			spBadge.textContent = `${sp.current}/${sp.max}`;
		}

		const passiveMetamagics = (state.getPassiveMetamagics?.() || [])
			.filter(meta => knownKeys.has(meta.key));
		const activeMetamagics = (state.getActiveMetamagics?.() || [])
			.filter(meta => knownKeys.has(meta.key));

		// Returns the compact cost caption plus a plain-language gloss (tooltip)
		// so first-time sorcerers can decode "SP" / "½ level SP" without leaving
		// the sheet. "SP" = Sorcery Points.
		const renderCost = (cost) => {
			if (cost === "level") return {text: "spell level SP", title: "Costs Sorcery Points equal to the spell's level"};
			if (cost === "halfLevel") return {text: "½ level SP", title: "Costs half your sorcerer level (rounded down) in Sorcery Points"};
			return {text: `${cost} SP`, title: `Costs ${cost} Sorcery Point${cost === 1 ? "" : "s"}`};
		};

		// SP summary row
		const spRow = e_({outer: `
			<div class="charsheet__mm-sp-summary">
				<div class="charsheet__mm-sp-current">
					<span class="charsheet__mm-sp-label">Sorcery Points Available</span>
					${opts.isSorceryPointEditable ? `<button class="cs-combat-btn charsheet__mm-sp-adjust-btn" data-sp-delta="-1" title="Decrease sorcery points" aria-label="Decrease sorcery points" ${sp.current <= 0 ? "disabled" : ""}>−</button>` : ""}
					<span class="charsheet__mm-sp-value">${sp.current}</span>
					<span class="charsheet__mm-sp-max">/ ${sp.max}</span>
					${opts.isSorceryPointEditable ? `<button class="cs-combat-btn charsheet__mm-sp-adjust-btn" data-sp-delta="1" title="Increase sorcery points" aria-label="Increase sorcery points" ${sp.current >= sp.max ? "disabled" : ""}>+</button>` : ""}
				</div>
			</div>
		`});
		container.append(spRow);

		// First-run gloss: the Tune/Detune system is TGTT-specific, so teach it once
		// in plain language rather than assuming the vocabulary. Passive-only.
		if (passiveMetamagics.length) {
			container.append(e_({outer: `<p class="charsheet__mm-intro">Tune a passive metamagic to keep it active for the shown Sorcery Point cost; Detune it to free those points.</p>`}));
		}

		container.querySelectorAll(".charsheet__mm-sp-adjust-btn").forEach((btn) => {
			btn.addEventListener("click", () => {
				const currentSp = state.getSorceryPoints();
				const delta = Number(btn.dataset.spDelta) || 0;
				const nextCurrent = Math.max(0, Math.min(currentSp.max, currentSp.current + delta));
				if (nextCurrent === currentSp.current) return;

				state.setSorceryPoints({current: nextCurrent, max: currentSp.max});
				page.saveCharacter?.();
				CharacterSheetCombat._refreshMetamagicRelatedUi(state, page);
			});
		});

		// Tuned passives section
		const tunedPassives = passiveMetamagics.filter(m => m.tuned);
		const untunedPassives = passiveMetamagics.filter(m => !m.tuned);

		if (tunedPassives.length) {
			const tunedHeader = e_({outer: `<div class="charsheet__mm-group-label">Tuned Passives</div>`});
			container.append(tunedHeader);

			for (const meta of tunedPassives) {
				const cost = renderCost(meta.cost);
				const nameHtml = CharacterSheetCombat._getMetamagicHoverLink(page, {...meta, type: meta.type || "passive"});
				const row = e_({outer: `
					<div class="charsheet__mm-row charsheet__mm-row--tuned">
						<span class="charsheet__mm-indicator charsheet__mm-indicator--active">●</span>
						<div class="charsheet__mm-info">
							<span class="charsheet__mm-name">${nameHtml}</span>
							<span class="charsheet__mm-cost" title="${cost.title}">${cost.text}</span>
						</div>
						<span class="charsheet__mm-desc">${meta.description}</span>
						<button class="cs-combat-btn cs-combat-btn--danger charsheet__mm-tune-btn" data-metamagic-key="${meta.key}" aria-label="Detune ${meta.name}" title="Stop maintaining this passive metamagic and free its Sorcery Points">${csCombatIcon("reset")}<span>Detune</span></button>
					</div>
				`});
				container.append(row);
			}
		}

		// Available passives section
		if (untunedPassives.length) {
			const untunedHeader = e_({outer: `<div class="charsheet__mm-group-label">Available Passives</div>`});
			container.append(untunedHeader);

			for (const meta of untunedPassives) {
				const cost = renderCost(meta.cost);
				const canAfford = typeof meta.cost === "number" && sp.max >= meta.cost && sp.current >= meta.cost;
				const nameHtml = CharacterSheetCombat._getMetamagicHoverLink(page, {...meta, type: meta.type || "passive"});
				const row = e_({outer: `
					<div class="charsheet__mm-row charsheet__mm-row--available">
						<span class="charsheet__mm-indicator">○</span>
						<div class="charsheet__mm-info">
							<span class="charsheet__mm-name">${nameHtml}</span>
							<span class="charsheet__mm-cost" title="${cost.title}">${cost.text}</span>
						</div>
						<span class="charsheet__mm-desc">${meta.description}</span>
						<button class="cs-combat-btn cs-combat-btn--spend charsheet__mm-tune-btn" data-metamagic-key="${meta.key}" aria-label="Tune ${meta.name}" ${!canAfford ? `disabled title="Not enough Sorcery Points to tune this metamagic"` : `title="Spend Sorcery Points to keep this passive metamagic active"`}>${csCombatIcon("check")}<span>Tune</span></button>
					</div>
				`});
				container.append(row);
			}
		}

		// Active metamagics section (info-only)
		if (activeMetamagics.length) {
			const activeHeader = e_({outer: `<div class="charsheet__mm-group-label">Active <span class="charsheet__mm-group-note">(at cast time)</span></div>`});
			container.append(activeHeader);

			for (const meta of activeMetamagics) {
				const cost = renderCost(meta.cost);
				const nameHtml = CharacterSheetCombat._getMetamagicHoverLink(page, {...meta, type: meta.type || "active"});
				const row = e_({outer: `
					<div class="charsheet__mm-row charsheet__mm-row--active-info">
						<span class="charsheet__mm-indicator charsheet__mm-indicator--cast">◆</span>
						<div class="charsheet__mm-info">
							<span class="charsheet__mm-name">${nameHtml}</span>
							<span class="charsheet__mm-cost" title="${cost.title}">${cost.text}</span>
						</div>
						<span class="charsheet__mm-desc">${meta.description}</span>
					</div>
				`});
				container.append(row);
			}
		}

		// Bind tune/detune buttons
		container.querySelectorAll(".charsheet__mm-tune-btn").forEach((btn) => {
			btn.addEventListener("click", () => {
				const key = btn.dataset.metamagicKey;
				if (state.isMetamagicTuned?.(key)) {
					state.detuneMetamagic(key);
				} else {
					if (!state.tuneMetamagic(key)) {
						JqueryUtil.doToast({type: "warning", content: "Not enough sorcery points to tune this metamagic."});
						return;
					}
				}
				page.saveCharacter?.();
				CharacterSheetCombat._refreshMetamagicRelatedUi(state, page);
			});
		});
	}

	// #endregion
}

globalThis.CharacterSheetCombat = CharacterSheetCombat;

export {CharacterSheetCombat};
