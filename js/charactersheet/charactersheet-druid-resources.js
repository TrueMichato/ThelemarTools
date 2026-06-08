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
		page._renderCompanions?.();
		page._renderCompanionButtons?.();
		page._renderCharacter?.();
	}

	// #region modal
	/** Open (or focus) the Druid Resources modal. */
	openModal () {
		this._refreshState();
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

	/** (Re)render the modal body in place after a mutation. */
	_renderModalBody () {
		const body = this._modalBody;
		if (!body) return;
		this._refreshState();
		body.innerHTML = "";

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

		const section = e_({outer: `
			<div class="charsheet__druid-section mb-3 p-2 rounded" style="background: var(--cs-bg-surface, var(--rgb-bg-alt, #1e293b));">
				<div class="ve-flex-v-center ve-flex-h-between mb-1">
					<span class="ve-bold">🐻 Wild Shape</span>
					<span class="charsheet__druid-ws-uses ve-bold">${current} / ${max}</span>
				</div>
				${recharge ? `<div class="ve-small ve-muted mb-2">${recharge}</div>` : ""}
				<div class="ve-flex-v-center" style="gap: 6px; flex-wrap: wrap;">
					<button class="ve-btn ve-btn-xs ve-btn-default charsheet__druid-ws-minus" title="Spend one use">−</button>
					<button class="ve-btn ve-btn-xs ve-btn-default charsheet__druid-ws-plus" title="Restore one use">+</button>
					${inForm.length
		? `<button class="ve-btn ve-btn-xs ve-btn-danger charsheet__druid-ws-end ml-2">End Wild Shape</button>`
		: `<button class="ve-btn ve-btn-xs ve-btn-warning charsheet__druid-ws-transform ml-2" ${current < 1 ? "disabled title=\"No Wild Shape uses remaining\"" : ""}>Transform…</button>`}
				</div>
				${inForm.length ? `<div class="ve-small mt-2">Currently: <span class="ve-bold">${(inForm[0].name || "Beast")}</span></div>` : ""}
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
		this._refreshState();
		if (!this._state.canSpendWildShapeUse?.(1)) {
			JqueryUtil.doToast({type: "warning", content: "No Wild Shape uses remaining."});
			return;
		}
		const calc = this._state.getFeatureCalculations?.() || {};
		const druidLevel = this._state.getClassLevel?.("druid") || 0;
		const before = new Set(this._getWildShapeCompanions().map(c => c.id));

		await this._page._pShowBeastPicker?.({
			maxCr: calc.wildShapeCr || (druidLevel >= 8 ? 1 : druidLevel >= 4 ? 0.5 : 0.25),
			canSwim: calc.wildShapeCanSwim ?? (druidLevel >= 4),
			canFly: calc.wildShapeCanFly ?? (druidLevel >= 8),
			type: CharacterSheetState.COMPANION_TYPES.WILD_SHAPE,
			origin: "Wild Shape",
		});

		// Spend a use ONLY if a new Wild Shape companion was actually created.
		const added = this._getWildShapeCompanions().some(c => !before.has(c.id));
		if (added) this._state.spendWildShapeUse?.(1);
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
		this._refreshState();
		if (!this._state.canSpendWildShapeUse?.(1)) {
			JqueryUtil.doToast({type: "warning", content: "No Wild Shape uses remaining."});
			return;
		}
		const before = new Set(this._getFamiliarCompanions().map(c => c.id));

		if (this._page._spells?._pShowFamiliarPicker) {
			await this._page._spells._pShowFamiliarPicker({isWildCompanion: true});
		} else {
			JqueryUtil.doToast({type: "warning", content: "Familiar picker not available."});
			return;
		}

		// Spend a use ONLY if a new familiar was actually summoned.
		const added = this._getFamiliarCompanions().some(c => !before.has(c.id));
		if (added) this._state.spendWildShapeUse?.(1);
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
