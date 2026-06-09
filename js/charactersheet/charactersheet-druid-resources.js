/**
 * Character Sheet — Druid Resources
 *
 * A purpose-built modal for the three Druid abilities that previously
 * piggy-backed on the GENERIC "Available to Activate" active-states list
 * (a poor fit): Wild Shape, Wild Companion, and Circle-of-the-Zodiac
 * Zodiac Form.
 *
 * The modal centralises:
 *  - Wild Shape uses (current/max + recharge) with +/- controls and a
 *    "Transform" action (beast picker); spends a use only after a beast is
 *    chosen.
 *  - Wild Companion, which consumes 1 Wild Shape use to summon a Fey familiar.
 *  - Zodiac Form: the 12 monthly constellation forms, each hover-linked to its
 *    own specific entry, activated atomically via a Wild Shape use.
 *
 * All usage tracking lives in the existing state/save mechanism (the
 * "Wild Shape" resource in `_data.resources`; the active Zodiac Form in
 * `_data.activeStates`), so saves round-trip with no new required fields.
 * This module never mutates the generic active-state mechanics that the
 * Ranger work, combat display, and existing tests rely on.
 */

// Project globals — typed via globalThis cast for TypeScript checkJs
const {e_} = /** @type {*} */ (globalThis);

class CharacterSheetDruidResources {
	constructor (page) {
		this._page = page;
		this._state = page.getState();
		/** @type {HTMLElement|null} */
		this._modalBody = null;
		/** @type {(() => void)|null} */
		this._doClose = null;
		// Which modal view is open: "full" (all Druid resources) or "zodiac"
		// (a focused constellation picker). Drives _renderModalBody so the
		// in-place re-render after a selection stays scoped to the open view.
		this._modalMode = "full";
		// In-flight guards: the Transform / Summon workflows spend a use only AFTER
		// an async picker resolves, so a double-click (or modal + combat-tab racing)
		// could create a second companion/familiar without a second use being paid.
		// These flags make both workflows single-shot until the picker settles.
		this._isTransforming = false;
		this._isSummoning = false;
	}

	/** Refresh the live state reference (state object can be swapped on load). */
	_refreshState () { this._state = this._page.getState(); }

	// #region capability checks
	/** @returns {boolean} The character has a Wild Shape uses resource or computed uses. */
	hasWildShape () {
		const calc = this._state.getFeatureCalculations?.() || {};
		return !!this._state.getWildShapeResource?.() || (calc.wildShapeUses || 0) > 0;
	}

	/** @returns {boolean} The character has the Wild Companion feature. */
	hasWildCompanion () {
		const calc = this._state.getFeatureCalculations?.() || {};
		return !!calc.hasWildCompanion;
	}

	/** @returns {boolean} The character has a Zodiac Form (Circle of the Zodiac) feature. */
	hasZodiacForm () {
		const calc = this._state.getFeatureCalculations?.() || {};
		if (calc.hasZodiacForm) return true;
		return (this._state.getFeatures?.() || []).some(f => /^zodiac form\b/i.test((f.name || "").trim()));
	}

	/** @returns {boolean} Any Druid resource section would render — used to gate the entry-point button. */
	isApplicable () {
		this._refreshState();
		return this.hasWildShape() || this.hasWildCompanion() || this.hasZodiacForm();
	}
	// #endregion

	// #region companion helpers
	_getWildShapeCompanions () {
		const T = CharacterSheetState.COMPANION_TYPES?.WILD_SHAPE;
		return this._state.getCompanionsByType?.(T) || [];
	}

	_getFamiliarCompanions () {
		const T = CharacterSheetState.COMPANION_TYPES?.FAMILIAR;
		return this._state.getCompanionsByType?.(T) || [];
	}

	/**
	 * Build a DOM-free display model for the creature a druid is currently shaped
	 * into, sourced ENTIRELY from the stored WILD_SHAPE companion record (so it
	 * survives save/load for free). Used by the Combat-tab panel and the modal to
	 * render a hoverable name + an inline key-stats line (#5).
	 *
	 * @param {*} c The WILD_SHAPE companion record.
	 * @returns {(null|{
	 *   id: string, name: string, customName: (string|null), source: (string|null),
	 *   ac: (number|null), hpCurrent: (number|null), hpMax: (number|null),
	 *   speedLabel: string, senses: string[], size: (string|null),
	 *   creatureType: (string|null), abilityMods: object, hoverEntries: Array
	 * })}
	 * @private
	 */
	_buildBeastModel (c) {
		if (!c) return null;
		const fmtMod = (score) => {
			const m = Math.floor((((score ?? 10)) - 10) / 2);
			return m >= 0 ? `+${m}` : `${m}`;
		};
		const ab = c.abilities || {};
		const speed = c.speed || {};
		// Bestiary speed values are usually plain numbers, but can be objects
		// (e.g. {number: 60, condition: "(hover)"}); coerce to a finite number so
		// the label never renders "[object Object] ft.".
		const speedNum = (v) => {
			if (typeof v === "number") return v;
			if (v && typeof v === "object" && typeof v.number === "number") return v.number;
			const n = parseInt(v, 10);
			return Number.isFinite(n) ? n : 0;
		};
		const speedParts = [];
		if (speedNum(speed.walk)) speedParts.push(`${speedNum(speed.walk)} ft.`);
		for (const k of ["fly", "swim", "climb", "burrow"]) {
			if (speedNum(speed[k])) speedParts.push(`${k} ${speedNum(speed[k])} ft.`);
		}
		const senses = (Array.isArray(c.senses) ? c.senses : []).filter(Boolean).map(s => String(s));

		// Combined named entries for an inline-hover fallback when no bestiary source.
		const hoverEntries = [];
		const pushEntries = (arr) => {
			(Array.isArray(arr) ? arr : []).forEach(t => {
				if (t && t.name && Array.isArray(t.entries)) hoverEntries.push({type: "entries", name: t.name, entries: t.entries});
			});
		};
		pushEntries(c.traits);
		pushEntries(c.actions);
		pushEntries(c.bonusActions);
		pushEntries(c.reactions);

		return {
			id: c.id,
			name: c.name || "Beast",
			customName: c.customName || null,
			source: c.source || null,
			ac: (typeof c.ac === "number") ? c.ac : null,
			hpCurrent: (c.hp && typeof c.hp.current === "number") ? c.hp.current : null,
			hpMax: (c.hp && typeof c.hp.max === "number") ? c.hp.max : null,
			speedLabel: speedParts.join(", "),
			senses,
			size: c.size || null,
			creatureType: c.creatureType || null,
			abilityMods: {
				str: fmtMod(ab.str),
				dex: fmtMod(ab.dex),
				con: fmtMod(ab.con),
				int: fmtMod(ab.int),
				wis: fmtMod(ab.wis),
				cha: fmtMod(ab.cha),
			},
			hoverEntries,
		};
	}
	// #endregion

	// #region combat-tab summary (single source of truth for the Combat-tab panel)
	/**
	 * Build the DOM-free display model the Combat-tab Druid Resources panel renders.
	 * Computes `getFeatureCalculations()` ONCE and derives every flag from it (the
	 * combat render gates on `.applicable`, so this is the only summary call per render).
	 *
	 * @returns {{
	 *   applicable: boolean,
	 *   wildShape: {has: boolean, current: number, max: number, rechargeLabel: string, inForm: boolean, beastName: string, beast: (object|null), canTransform: boolean},
	 *   wildCompanion: {has: boolean, canSummon: boolean, duration: string},
	 *   zodiac: {has: boolean, activeFormId: (string|null), activeFormName: (string|null), canChoose: boolean},
	 * }}
	 */
	getCombatSummary () {
		this._refreshState();
		const calc = this._state.getFeatureCalculations?.() || {};
		const res = this._state.getWildShapeResource?.() || null;

		const hasWildShape = !!res || (calc.wildShapeUses || 0) > 0;
		const current = res ? res.current : 0;
		const max = res ? res.max : 0;
		const inFormCompanions = this._getWildShapeCompanions();
		const inForm = inFormCompanions.length > 0;
		const canSpend = !!res && res.current >= 1;

		const hasWildCompanion = !!calc.hasWildCompanion;

		const activeZodiac = this._state.getActiveZodiacForm?.() || null;
		const hasZodiac = !!calc.hasZodiacForm
			|| !!activeZodiac
			|| (this._state.getFeatures?.() || []).some(f => /^zodiac form\b/i.test((f.name || "").trim()));

		return {
			applicable: hasWildShape || hasWildCompanion || hasZodiac,
			wildShape: {
				has: hasWildShape,
				current,
				max,
				rechargeLabel: res ? this._rechargeLabel(res.recharge) : "",
				inForm,
				beastName: inForm ? (inFormCompanions[0].name || "Beast") : "",
				beast: inForm ? this._buildBeastModel(inFormCompanions[0]) : null,
				canTransform: canSpend,
			},
			wildCompanion: {
				has: hasWildCompanion,
				canSummon: canSpend,
				duration: calc.wildCompanionDuration || "",
			},
			zodiac: {
				has: hasZodiac,
				activeFormId: activeZodiac ? activeZodiac.formId : null,
				activeFormName: activeZodiac ? (activeZodiac.formName || activeZodiac.formId || null) : null,
				canChoose: canSpend,
			},
		};
	}
	// #endregion

	// #region public actions (combat-tab entry points; modal-safe)
	// These let the Combat-tab panel drive the SAME mutation/refresh paths as the
	// modal without duplicating picker logic. Each routes through the centralised
	// `_refreshSheet()` (re-renders the combat panel) and `_renderModalBody()`
	// (a no-op when the modal is closed), so the surfaces never drift or go stale.

	/** Spend one Wild Shape use (manual −). @returns {boolean} */
	spendUse () {
		this._refreshState();
		const ok = !!this._state.spendWildShapeUse?.(1);
		if (ok) { this._refreshSheet(); this._renderModalBody(); }
		return ok;
	}

	/** Restore one Wild Shape use (manual +). @returns {boolean} */
	restoreUse () {
		this._refreshState();
		const ok = !!this._state.restoreWildShapeUse?.(1);
		if (ok) { this._refreshSheet(); this._renderModalBody(); }
		return ok;
	}

	/** Public Transform entry point (re-entrancy guarded). */
	async pTransform () { await this._pTransformWildShape(); }

	/** Public End-Wild-Shape entry point. */
	endWildShape () { this._endWildShape(); }

	/** Public Summon-Familiar entry point (re-entrancy guarded). */
	async pSummonWildCompanion () { await this._pSummonWildCompanion(); }

	/** Dismiss the active Zodiac Form (no Wild Shape use refunded, per the modal). */
	dismissZodiac () {
		this._refreshState();
		this._state.deactivateState?.("zodiacForm");
		JqueryUtil.doToast({type: "info", content: "Zodiac Form dismissed."});
		this._refreshSheet();
		this._renderModalBody();
	}
	// #endregion

	/**
	 * Re-render everything affected by a Druid resource action and persist.
	 * Centralised so no surface goes stale after a spend/activate/dismiss.
	 */
	_refreshSheet () {
		const page = this._page;
		page._saveCurrentCharacter?.();
		page._renderResources?.();
		page._renderActiveStates?.();
		page._combat?.renderCombatStates?.();
		page._combatModule?.renderCombatStates?.();
		page._combat?.renderAttacks?.();
		page._renderCompanions?.();
		page._renderCompanionButtons?.();
		page._renderCharacter?.();
	}

	// #region modal
	/** Open (or focus) the Druid Resources modal. */
	openModal () {
		this._refreshState();
		this._modalMode = "full";
		const {eleModalInner, doClose} = UiUtil.getShowModal({
			title: "🐾 Druid Resources",
			isMinHeight0: true,
			isWidth100: true,
			cbClose: () => { this._modalBody = null; this._doClose = null; },
		});
		this._doClose = doClose;
		this._modalBody = e_({tag: "div", clazz: "ve-flex-col w-100 charsheet__druid-resources"});
		eleModalInner.appendChild(this._modalBody);
		this._renderModalBody();
	}

	/**
	 * Open a focused Zodiac Form picker — only the constellation selection, NOT
	 * the full Druid Resources panel. Drives the SAME zodiac render/selection
	 * path as the full modal (so picking a form spends a Wild Shape use and
	 * re-renders both surfaces), but presents just the forms grid so the
	 * combat-tab "Choose Zodiac Form…" button isn't a backdoor into the whole
	 * panel (bug #8).
	 */
	openZodiacPicker () {
		this._refreshState();
		this._modalMode = "zodiac";
		const {eleModalInner, doClose} = UiUtil.getShowModal({
			title: "🌟 Zodiac Form",
			isMinHeight0: true,
			isWidth100: true,
			cbClose: () => { this._modalBody = null; this._doClose = null; },
		});
		this._doClose = doClose;
		this._modalBody = e_({tag: "div", clazz: "ve-flex-col w-100 charsheet__druid-resources charsheet__druid-resources--zodiac"});
		eleModalInner.appendChild(this._modalBody);
		this._renderModalBody();
	}

	/** (Re)render the modal body in place after a mutation. */
	_renderModalBody () {
		const body = this._modalBody;
		if (!body) return;
		this._refreshState();
		body.innerHTML = "";

		// Focused Zodiac-only view: render just the constellation picker.
		if (this._modalMode === "zodiac") {
			if (this.hasZodiacForm()) {
				body.appendChild(this._renderZodiacSection());
			} else {
				body.appendChild(e_({outer: `<div class="ve-muted ve-small ve-text-center py-3">No Zodiac Form available.</div>`}));
			}
			return;
		}

		let any = false;
		if (this.hasWildShape()) { body.appendChild(this._renderWildShapeSection()); any = true; }
		if (this.hasWildCompanion()) { body.appendChild(this._renderWildCompanionSection()); any = true; }
		if (this.hasZodiacForm()) { body.appendChild(this._renderZodiacSection()); any = true; }

		if (!any) {
			body.appendChild(e_({outer: `<div class="ve-muted ve-small ve-text-center py-3">No Druid resources to track.</div>`}));
		}
	}

	_rechargeLabel (recharge) {
		switch (recharge) {
			case "short": return "Recharges on a Short or Long Rest";
			case "long": return "Recharges on a Long Rest";
			case "dawn": return "Recharges at dawn";
			default: return recharge ? `Recharges on ${recharge}` : "";
		}
	}

	_renderWildShapeSection () {
		const res = this._state.getWildShapeResource?.();
		const current = res ? res.current : 0;
		const max = res ? res.max : 0;
		const recharge = res ? this._rechargeLabel(res.recharge) : "";
		const inForm = this._getWildShapeCompanions();

		const beast = inForm.length ? this._buildBeastModel(inForm[0]) : null;
		const beastNameHtml = beast ? CharacterSheetClassUtils.buildCreatureHoverNameHtml(beast, "ve-bold") : "";
		const beastStatsHtml = beast ? CharacterSheetClassUtils.buildCreatureStatLineHtml(beast) : "";

		const section = e_({outer: `
			<div class="charsheet__druid-section mb-3 p-2 rounded" style="background: var(--cs-bg-surface, var(--rgb-bg-alt, #1e293b));">
				<div class="ve-flex-v-center ve-flex-h-between mb-1">
					<span class="ve-bold">🐻 Wild Shape</span>
					<span class="charsheet__druid-ws-uses ve-bold">${current} / ${max}</span>
				</div>
				${recharge ? `<div class="ve-small ve-muted mb-2">${recharge}</div>` : ""}
				<div class="ve-flex-v-center" style="gap: 6px; flex-wrap: wrap;">
					<button class="ve-btn ve-btn-xs ve-btn-default charsheet__druid-ws-minus" title="Spend 1 Wild Shape use">−</button>
					<button class="ve-btn ve-btn-xs ve-btn-default charsheet__druid-ws-plus" title="Restore 1 Wild Shape use">+</button>
					${inForm.length
		? `<button class="ve-btn ve-btn-xs ve-btn-danger charsheet__druid-ws-end ml-2" title="Revert to your normal form (no use refunded)">End Wild Shape</button>`
		: `<button class="ve-btn ve-btn-xs ve-btn-warning charsheet__druid-ws-transform ml-2" ${current < 1 ? "disabled title=\"No Wild Shape uses remaining\"" : "title=\"Pick a beast to assume; a use is spent only after you choose\""}>Transform…</button>`}
				</div>
				${beast
		? `<div class="ve-small mt-2 charsheet__druid-ws-current">Currently: ${beastNameHtml}</div>${beastStatsHtml ? `<div class="ve-small ve-muted charsheet__druid-ws-currentstats">${beastStatsHtml}</div>` : ""}`
		: `<div class="ve-small ve-muted mt-2">Transform… opens the beast picker. A use is spent only after you choose a form.</div>`}
			</div>
		`});

		section.querySelector(".charsheet__druid-ws-minus")?.addEventListener("click", () => {
			if (this._state.spendWildShapeUse?.(1)) { this._refreshSheet(); this._renderModalBody(); }
		});
		section.querySelector(".charsheet__druid-ws-plus")?.addEventListener("click", () => {
			if (this._state.restoreWildShapeUse?.(1)) { this._refreshSheet(); this._renderModalBody(); }
		});
		section.querySelector(".charsheet__druid-ws-transform")?.addEventListener("click", () => this._pTransformWildShape());
		section.querySelector(".charsheet__druid-ws-end")?.addEventListener("click", () => this._endWildShape());

		return section;
	}

	async _pTransformWildShape () {
		if (this._isTransforming) return;
		this._refreshState();
		if (!this._state.canSpendWildShapeUse?.(1)) {
			JqueryUtil.doToast({type: "warning", content: "No Wild Shape uses remaining."});
			return;
		}
		this._isTransforming = true;
		const calc = this._state.getFeatureCalculations?.() || {};
		const druidLevel = this._state.getClassLevel?.("druid") || 0;
		const before = new Set(this._getWildShapeCompanions().map(c => c.id));

		try {
			await this._page._pShowBeastPicker?.({
				maxCr: calc.wildShapeCr || (druidLevel >= 8 ? 1 : druidLevel >= 4 ? 0.5 : 0.25),
				canSwim: calc.wildShapeCanSwim ?? (druidLevel >= 4),
				canFly: calc.wildShapeCanFly ?? (druidLevel >= 8),
				type: CharacterSheetState.COMPANION_TYPES.WILD_SHAPE,
				origin: "Wild Shape",
			});
		} finally {
			this._isTransforming = false;
		}

		// Spend a use ONLY if a new Wild Shape companion was actually created AND a
		// use is still available (re-checked post-await to survive a racing spend).
		const added = this._getWildShapeCompanions().some(c => !before.has(c.id));
		if (added && this._state.canSpendWildShapeUse?.(1)) this._state.spendWildShapeUse?.(1);
		this._refreshSheet();
		this._renderModalBody();
	}

	_endWildShape () {
		for (const ws of this._getWildShapeCompanions()) this._state.removeCompanion?.(ws.id);
		// Also clear any active wild-shape state if present (no use refunded per RAW).
		if (this._state.isInWildShape?.()) this._state.deactivateWildShape?.();
		JqueryUtil.doToast({type: "info", content: "Wild Shape ended."});
		this._refreshSheet();
		this._renderModalBody();
	}

	_renderWildCompanionSection () {
		const calc = this._state.getFeatureCalculations?.() || {};
		const canSpend = this._state.canSpendWildShapeUse?.(1);
		const duration = calc.wildCompanionDuration || "";

		const section = e_({outer: `
			<div class="charsheet__druid-section mb-3 p-2 rounded" style="background: var(--cs-bg-surface, var(--rgb-bg-alt, #1e293b));">
				<div class="ve-flex-v-center ve-flex-h-between mb-1">
					<span class="ve-bold">🧚 Wild Companion</span>
				</div>
				<div class="ve-small ve-muted mb-2">Spends 1 Wild Shape use to summon a Fey familiar${duration ? ` (${duration})` : ""}.</div>
				<button class="ve-btn ve-btn-xs ve-btn-info charsheet__druid-wc-summon" ${!canSpend ? "disabled title=\"No Wild Shape uses remaining\"" : ""}>Summon Familiar</button>
			</div>
		`});

		section.querySelector(".charsheet__druid-wc-summon")?.addEventListener("click", () => this._pSummonWildCompanion());
		return section;
	}

	async _pSummonWildCompanion () {
		if (this._isSummoning) return;
		this._refreshState();
		if (!this._state.canSpendWildShapeUse?.(1)) {
			JqueryUtil.doToast({type: "warning", content: "No Wild Shape uses remaining."});
			return;
		}
		const before = new Set(this._getFamiliarCompanions().map(c => c.id));

		if (!this._page._spells?._pShowFamiliarPicker) {
			JqueryUtil.doToast({type: "warning", content: "Familiar picker not available."});
			return;
		}
		this._isSummoning = true;
		try {
			await this._page._spells._pShowFamiliarPicker({isWildCompanion: true});
		} finally {
			this._isSummoning = false;
		}

		// Spend a use ONLY if a new familiar was actually summoned AND a use is still
		// available (re-checked post-await to survive a racing spend).
		const added = this._getFamiliarCompanions().some(c => !before.has(c.id));
		if (added && this._state.canSpendWildShapeUse?.(1)) this._state.spendWildShapeUse?.(1);
		this._refreshSheet();
		this._renderModalBody();
	}

	_renderZodiacSection () {
		const active = this._state.getActiveZodiacForm?.();
		const canSpend = this._state.canSpendWildShapeUse?.(1);
		const defs = (CharacterSheetState.ZODIAC_FORM_DEFS || []).filter(d => d.tier === "month");

		const section = e_({outer: `
			<div class="charsheet__druid-section mb-2 p-2 rounded" style="background: var(--cs-bg-surface, var(--rgb-bg-alt, #1e293b));">
				<div class="ve-flex-v-center ve-flex-h-between mb-1">
					<span class="ve-bold">🌟 Zodiac Form</span>
					${active ? `<button class="ve-btn ve-btn-xs ve-btn-default charsheet__druid-zodiac-dismiss">Dismiss</button>` : ""}
				</div>
				${active ? `<div class="ve-small mb-2">Active: <span class="ve-bold charsheet__druid-zodiac-active"></span></div>` : ""}
				<div class="ve-small ve-muted mb-2">${active ? "Choosing another form spends another Wild Shape use." : "Choose a constellation. Spends 1 Wild Shape use."}</div>
				<div class="charsheet__druid-zodiac-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px;"></div>
			</div>
		`});

		// Active-form name with the specific-form hover preserved.
		if (active) {
			const activeEl = section.querySelector(".charsheet__druid-zodiac-active");
			if (activeEl) {
				const def = CharacterSheetState.getZodiacFormDef?.(active.formId);
				const html = def && CharacterSheetClassUtils?.buildInlineEntriesHoverLink
					? CharacterSheetClassUtils.buildInlineEntriesHoverLink(def.name, def.name, def.entries)
					: null;
				if (html) activeEl.innerHTML = html;
				else activeEl.textContent = active.formName || active.formId || "";
			}
			section.querySelector(".charsheet__druid-zodiac-dismiss")?.addEventListener("click", () => {
				this._state.deactivateState?.("zodiacForm");
				JqueryUtil.doToast({type: "info", content: "Zodiac Form dismissed."});
				this._refreshSheet();
				this._renderModalBody();
			});
		}

		const grid = section.querySelector(".charsheet__druid-zodiac-grid");
		for (const def of defs) {
			const isActive = active?.formId === def.id;
			const hoverHtml = CharacterSheetClassUtils?.buildInlineEntriesHoverLink
				? CharacterSheetClassUtils.buildInlineEntriesHoverLink(def.name, def.name, def.entries)
				: null;
			const card = e_({outer: `
				<button class="ve-btn ve-btn-xs ${isActive ? "ve-btn-primary" : "ve-btn-default"} charsheet__druid-zodiac-card ve-text-left"
					style="display: flex; flex-direction: column; align-items: flex-start; white-space: normal; height: auto; padding: 6px 8px;"
					${(!canSpend && !isActive) ? "disabled title=\"No Wild Shape uses remaining\"" : ""}>
					<span class="ve-bold">${def.icon ? `${def.icon} ` : ""}${hoverHtml || def.name}</span>
					${def.summary ? `<span class="ve-small ve-muted">${def.summary}</span>` : ""}
				</button>
			`});
			card.addEventListener("click", (evt) => {
				// Don't trigger selection when clicking the hover link itself.
				if (/** @type {*} */ (evt.target)?.closest?.(".ve-help-subtle")) return;
				this._pSelectZodiacForm(def.id);
			});
			grid?.appendChild(card);
		}

		return section;
	}

	_pSelectZodiacForm (formId) {
		this._refreshState();
		const def = this._state.activateZodiacFormUsingWildShape?.(formId);
		if (!def) {
			JqueryUtil.doToast({type: "warning", content: "No Wild Shape uses remaining."});
			return;
		}
		JqueryUtil.doToast({type: "success", content: `Zodiac Form: ${def.name} assumed.`});
		this._refreshSheet();
		this._renderModalBody();
	}
	// #endregion
}

globalThis.CharacterSheetDruidResources = CharacterSheetDruidResources;

export {CharacterSheetDruidResources};
