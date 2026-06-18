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

	/**
	 * @returns {boolean} Whether this druid uses the 2024 "Known Forms" Wild Shape
	 *   model (XPHB or any TGTT-family source). Drives the edition-aware modal and
	 *   combat-tab UI, and `pTransform` routing. Genuine 2014 PHB druids → false
	 *   (legacy free-pick path, zero regression).
	 */
	_usesKnownForms () {
		return !!this._state.usesKnownFormsWildShape?.();
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

	/**
	 * Build display models for every Known Form in the roster, reusing
	 * `_buildBeastModel` (templates have `hp.max` only → statline shows max HP).
	 * Each model gains `knownFormId` (the persistent roster id, distinct from any
	 * active companion id) and `isLegalNow` (false when a level-down put the form
	 * over the current CR / Fly limits — it persists but can't be transformed into).
	 * @returns {Array} Display models for the Known Forms sub-list.
	 * @private
	 */
	_buildKnownFormModels () {
		const forms = this._state.getKnownWildShapeForms?.() || [];
		return forms.map(f => {
			const model = this._buildBeastModel(f) || {};
			model.knownFormId = f.id;
			model.isLegalNow = !!this._state.isKnownWildShapeFormLegalNow?.(f);
			return model;
		});
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

		const usesKnownForms = this._usesKnownForms();
		const knownForms = usesKnownForms ? this._buildKnownFormModels() : [];
		const knownFormsMax = usesKnownForms ? (this._state.getKnownWildShapeFormsMax?.() || 0) : 0;
		const canAddForm = usesKnownForms && !!this._state.canAddKnownWildShapeForm?.();

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
				usesKnownForms,
				knownForms,
				knownFormsMax,
				canAddForm,
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

	/** Public Transform entry point (re-entrancy guarded; edition-aware). */
	async pTransform () {
		this._refreshState();
		if (this._usesKnownForms()) { await this._openTransformPicker(); return; }
		await this._pTransformWildShapeFree();
	}

	/** Public End-Wild-Shape entry point. */
	endWildShape () { this._endWildShape(); }

	/** Public Summon-Familiar entry point (re-entrancy guarded). */
	async pSummonWildCompanion () { await this._pSummonWildCompanion(); }

	/** Public Add-Known-Form entry point (2024 model; combat-tab + modal). */
	async pAddKnownForm () { await this._pAddKnownForm(); }

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

		// Focused 2024 transform view: render just the Known Forms roster so the
		// player can pick a learned form to transform into.
		if (this._modalMode === "wsTransform") {
			if (this.hasWildShape() && this._usesKnownForms()) {
				body.appendChild(this._renderKnownFormsRoster());
			} else {
				body.appendChild(e_({outer: `<div class="ve-muted ve-small ve-text-center py-3">No Wild Shape forms available.</div>`}));
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
		const usesKnownForms = this._usesKnownForms();

		const beast = inForm.length ? this._buildBeastModel(inForm[0]) : null;
		const beastNameHtml = beast ? CharacterSheetClassUtils.buildCreatureHoverNameHtml(beast, "ve-bold") : "";
		const beastStatsHtml = beast ? CharacterSheetClassUtils.buildCreatureStatLineHtml(beast) : "";

		// 2024 "Known Forms": the player curates a persistent roster and transforms
		// FROM it (no fresh bestiary search each time). The legacy 2014 path keeps
		// the free-pick "Transform…" button.
		const transformBtnHtml = usesKnownForms
			? ""
			: (inForm.length
				? ""
				: `<button class="ve-btn ve-btn-xs ve-btn-warning charsheet__druid-ws-transform ml-2" ${current < 1 ? "disabled title=\"No Wild Shape uses remaining\"" : "title=\"Pick a beast to assume; a use is spent only after you choose\""}>Transform…</button>`);
		const endBtnHtml = inForm.length
			? `<button class="ve-btn ve-btn-xs ve-btn-danger charsheet__druid-ws-end ml-2" title="Revert to your normal form (no use refunded)">End Wild Shape</button>`
			: "";

		const hintHtml = beast
			? `<div class="ve-small mt-2 charsheet__druid-ws-current">Currently: ${beastNameHtml}</div>${beastStatsHtml ? `<div class="ve-small ve-muted charsheet__druid-ws-currentstats">${beastStatsHtml}</div>` : ""}`
			: (usesKnownForms
				? `<div class="ve-small ve-muted mt-2">Learn Beast forms below, then Transform into one. A use is spent only when you transform.</div>`
				: `<div class="ve-small ve-muted mt-2">Transform… opens the beast picker. A use is spent only after you choose a form.</div>`);

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
					${transformBtnHtml}${endBtnHtml}
				</div>
				${hintHtml}
				<div class="charsheet__druid-ws-knownforms"></div>
			</div>
		`});

		section.querySelector(".charsheet__druid-ws-minus")?.addEventListener("click", () => {
			if (this._state.spendWildShapeUse?.(1)) { this._refreshSheet(); this._renderModalBody(); }
		});
		section.querySelector(".charsheet__druid-ws-plus")?.addEventListener("click", () => {
			if (this._state.restoreWildShapeUse?.(1)) { this._refreshSheet(); this._renderModalBody(); }
		});
		section.querySelector(".charsheet__druid-ws-transform")?.addEventListener("click", () => this._pTransformWildShapeFree());
		section.querySelector(".charsheet__druid-ws-end")?.addEventListener("click", () => this._endWildShape());

		if (usesKnownForms) {
			const host = section.querySelector(".charsheet__druid-ws-knownforms");
			if (host) host.appendChild(this._renderKnownFormsRoster());
		}

		return section;
	}

	/**
	 * Render the persistent "Known Forms" roster sub-list (2024 model). Each card
	 * shows a hover-linked creature name + key-stats line (built via the shared
	 * class-utils helpers), a Transform button (→ `transformIntoKnownForm`, which
	 * spends a use atomically), and a remove ×. An "Add Form…" button (→ the beast
	 * picker in select-mode) is disabled at the level-gated cap with an "n/max"
	 * badge.
	 * @returns {HTMLElement}
	 * @private
	 */
	_renderKnownFormsRoster () {
		const models = this._buildKnownFormModels();
		const maxForms = this._state.getKnownWildShapeFormsMax?.() || 0;
		const canAdd = !!this._state.canAddKnownWildShapeForm?.();
		const canSpend = !!this._state.canSpendWildShapeUse?.(1);

		const wrap = e_({outer: `
			<div class="charsheet__druid-ws-roster mt-3">
				<div class="ve-flex-v-center ve-flex-h-between mb-1">
					<span class="ve-small ve-bold">Known Forms</span>
					<span class="ve-small ve-muted charsheet__druid-ws-roster-count">${models.length} / ${maxForms}</span>
				</div>
				<div class="charsheet__druid-ws-roster-list ve-flex-col" style="gap: 6px;"></div>
				<button class="ve-btn ve-btn-xs ve-btn-primary charsheet__druid-ws-add mt-2" ${canAdd ? "title=\"Learn a new Beast form\"" : "disabled title=\"You already know the maximum number of forms\""}>+ Add Form…</button>
			</div>
		`});

		const list = wrap.querySelector(".charsheet__druid-ws-roster-list");
		if (!models.length) {
			list?.appendChild(e_({outer: `<div class="ve-small ve-muted ve-italic">No forms learned yet. Add a Beast form to transform into it later.</div>`}));
		}
		for (const model of models) {
			const nameHtml = CharacterSheetClassUtils.buildCreatureHoverNameHtml(model, "ve-bold");
			const statsHtml = CharacterSheetClassUtils.buildCreatureStatLineHtml(model);
			const legal = model.isLegalNow;
			const card = e_({outer: `
				<div class="charsheet__druid-ws-roster-card p-2 rounded ve-flex-v-center ve-flex-h-between" style="gap: 8px; background: var(--cs-bg-surface-2, var(--rgb-bg, #0f172a));">
					<div class="ve-flex-col" style="min-width: 0;">
						<div class="ve-small charsheet__druid-ws-roster-name">${nameHtml}</div>
						${statsHtml ? `<div class="ve-small ve-muted charsheet__druid-ws-roster-stats">${statsHtml}</div>` : ""}
						${legal ? "" : `<div class="ve-small ve-destructive charsheet__druid-ws-roster-illegal">Exceeds your current Wild Shape limits</div>`}
					</div>
					<div class="ve-flex-v-center" style="gap: 4px;">
						<button class="ve-btn ve-btn-xs ve-btn-warning charsheet__druid-ws-roster-transform" ${(legal && canSpend) ? "title=\"Transform into this form (spends 1 use)\"" : `disabled title="${legal ? "No Wild Shape uses remaining" : "This form exceeds your current limits"}"`}>Transform</button>
						<button class="ve-btn ve-btn-xs ve-btn-danger charsheet__druid-ws-roster-remove" title="Forget this form">×</button>
					</div>
				</div>
			`});
			card.querySelector(".charsheet__druid-ws-roster-transform")?.addEventListener("click", (evt) => {
				if (/** @type {*} */ (evt.target)?.closest?.(".ve-help-subtle")) return;
				this._transformIntoKnownForm(model.knownFormId);
			});
			card.querySelector(".charsheet__druid-ws-roster-remove")?.addEventListener("click", () => this._removeKnownForm(model.knownFormId));
			list?.appendChild(card);
		}

		wrap.querySelector(".charsheet__druid-ws-add")?.addEventListener("click", () => this._pAddKnownForm());
		return wrap;
	}

	/**
	 * Open a rich, spell-picker-style modal to learn a new Known Form. Mirrors the
	 * spell picker UX: each eligible Beast is shown as a card with a hoverable
	 * name (full bestiary statblock on hover), its source, and an inline info line
	 * (CR • type • size • AC • HP • speeds • senses • key traits), with a live
	 * search box and a per-row Learn button. Candidates come from the shared
	 * `_pGetWildShapeBeastCandidates` loader (same CR / Fly / swim gates the legacy
	 * picker used); the chosen raw creature is routed to `addKnownWildShapeForm`
	 * (which re-validates legality and de-dupes state-side).
	 * @private
	 */
	async _pAddKnownForm () {
		if (this._isTransforming) return;
		this._refreshState();
		if (!this._state.canAddKnownWildShapeForm?.()) {
			JqueryUtil.doToast({type: "warning", content: "You already know the maximum number of forms."});
			return;
		}
		const calc = this._state.getFeatureCalculations?.() || {};
		const druidLevel = this._state.getClassLevel?.("druid") || 0;
		const options = {
			maxCr: calc.wildShapeCr || (druidLevel >= 8 ? 1 : druidLevel >= 4 ? 0.5 : 0.25),
			canSwim: calc.wildShapeCanSwim ?? true,
			canFly: calc.wildShapeCanFly ?? (druidLevel >= 8),
			creatureTypes: ["beast"],
			origin: "Known Form",
		};

		this._isTransforming = true;
		let candidates;
		try {
			candidates = await this._page._pGetWildShapeBeastCandidates?.(options);
		} finally {
			this._isTransforming = false;
		}
		if (candidates == null) return; // load failed (toast already shown)
		if (!candidates.length) {
			JqueryUtil.doToast({type: "warning", content: "No eligible Beast forms found for your current Wild Shape limits."});
			return;
		}

		const maxCr = options.maxCr;
		const {eleModalInner, doClose} = await UiUtil.pGetShowModal({
			title: "Learn a Wild Shape Form",
			isWidth100: true,
			isMinHeight0: true,
			cbClose: () => this._renderModalBody?.(),
		});

		const limitBits = [`CR \u2264 ${(typeof maxCr === "object" ? maxCr.cr : maxCr)}`];
		if (!options.canFly) limitBits.push("no fly");
		if (!options.canSwim) limitBits.push("no swim-only");

		// Precompute a normalized entry per candidate ONCE (rec/model + the
		// structured fields the filter predicate reads), so live filtering /
		// searching never re-parses 100+ stat blocks on every keystroke.
		const entries = [];
		for (const creature of candidates) {
			const rec = this._state._parseBestiaryCreatureToBeastRecord?.(creature);
			const model = this._buildBeastModel(rec);
			if (!model) continue;
			entries.push({
				creature,
				rec,
				model,
				name: creature.name || "",
				source: creature.source || "",
				crNumber: Number.isFinite(rec?.crNumber) ? rec.crNumber : 0,
				size: rec?.size || "",
				creatureType: rec?.creatureType || "",
			});
		}

		const filterOptions = CharacterSheetDruidResources.buildKnownFormFilterOptions(entries);
		const SIZE_NAMES = {T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan"};
		const esc = CharacterSheetClassUtils.escapeHtml;
		const optTag = (val, label, sel) => `<option value="${esc(String(val))}"${sel ? " selected" : ""}>${esc(label)}</option>`;
		const crLabel = (n) => `CR ${(typeof Parser !== "undefined" && Parser.numberToCr) ? Parser.numberToCr(n) : n}`;

		const sourceOpts = [optTag("__all__", "All sources", true), ...filterOptions.sources.map(s => optTag(s, (typeof Parser !== "undefined" && Parser.sourceJsonToAbv) ? Parser.sourceJsonToAbv(s) : s))].join("");
		const typeOpts = [optTag("__all__", "All types", true), ...filterOptions.types.map(t => optTag(t, t.charAt(0).toUpperCase() + t.slice(1)))].join("");
		const sizeOpts = [optTag("__all__", "All sizes", true), ...filterOptions.sizes.map(s => optTag(s, SIZE_NAMES[s] || s))].join("");
		const crMinOpts = [optTag("", "CR min", true), ...filterOptions.crNumbers.map(n => optTag(n, crLabel(n)))].join("");
		const crMaxOpts = [optTag("", "CR max", true), ...filterOptions.crNumbers.map(n => optTag(n, crLabel(n)))].join("");

		const selStyle = "background: var(--cs-bg-elevated, #334155); color: var(--cs-text-primary, #f1f5f9); border: 1px solid var(--cs-border, rgba(255,255,255,.1)); width: auto; min-width: 0;";

		eleModalInner.appendChild(e_({outer: `
			<div class="ve-flex-col" style="gap: 10px; min-height: 0;">
				<div class="ve-flex-v-center ve-flex-h-between" style="gap: 8px;">
					<div class="ve-small ve-muted charsheet__ws-picker-limits">Eligible Beasts \u2014 ${limitBits.join(", ")}</div>
					<div class="ve-small ve-muted charsheet__ws-picker-count"></div>
				</div>
				<input type="text" class="form-control input-sm charsheet__ws-picker-search" placeholder="Search forms by name\u2026" style="background: var(--cs-bg-elevated, #334155); color: var(--cs-text-primary, #f1f5f9); border: 1px solid var(--cs-border, rgba(255,255,255,.1));">
				<div class="charsheet__ws-picker-filters ve-flex-v-center ve-flex-wrap" style="gap: 6px;">
					<select class="form-control input-sm charsheet__ws-picker-filter-source" style="${selStyle}" title="Filter by source">${sourceOpts}</select>
					<select class="form-control input-sm charsheet__ws-picker-filter-type" style="${selStyle}" title="Filter by creature type">${typeOpts}</select>
					<select class="form-control input-sm charsheet__ws-picker-filter-size" style="${selStyle}" title="Filter by size">${sizeOpts}</select>
					<select class="form-control input-sm charsheet__ws-picker-filter-crmin" style="${selStyle}" title="Minimum Challenge Rating">${crMinOpts}</select>
					<select class="form-control input-sm charsheet__ws-picker-filter-crmax" style="${selStyle}" title="Maximum Challenge Rating">${crMaxOpts}</select>
					<button class="ve-btn ve-btn-xs ve-btn-default charsheet__ws-picker-filter-reset" title="Clear all filters">Reset</button>
				</div>
				<div class="charsheet__ws-picker-list ve-flex-col ve-overflow-y-auto" style="gap: 6px; max-height: 60vh;"></div>
			</div>
		`}));

		const list = eleModalInner.querySelector(".charsheet__ws-picker-list");
		const countEl = eleModalInner.querySelector(".charsheet__ws-picker-count");
		const searchEl = eleModalInner.querySelector(".charsheet__ws-picker-search");
		const sourceEl = eleModalInner.querySelector(".charsheet__ws-picker-filter-source");
		const typeEl = eleModalInner.querySelector(".charsheet__ws-picker-filter-type");
		const sizeEl = eleModalInner.querySelector(".charsheet__ws-picker-filter-size");
		const crMinEl = eleModalInner.querySelector(".charsheet__ws-picker-filter-crmin");
		const crMaxEl = eleModalInner.querySelector(".charsheet__ws-picker-filter-crmax");
		const resetEl = eleModalInner.querySelector(".charsheet__ws-picker-filter-reset");

		const getFilters = () => ({
			needle: (searchEl?.value || "").trim().toLowerCase(),
			source: sourceEl?.value || "__all__",
			type: typeEl?.value || "__all__",
			size: sizeEl?.value || "__all__",
			crMin: (crMinEl?.value ?? "") === "" ? null : Number(crMinEl.value),
			crMax: (crMaxEl?.value ?? "") === "" ? null : Number(crMaxEl.value),
		});

		const renderList = () => {
			const filters = getFilters();
			const knownNames = new Set((this._state.getKnownWildShapeForms?.() || []).map(f => `${(f.name || "").toLowerCase()}|${(f.source || "").toLowerCase()}`));
			const shown = entries.filter(entry => CharacterSheetDruidResources.matchesKnownFormFilters(entry, filters));
			list.innerHTML = "";
			if (countEl) countEl.textContent = `${shown.length} form${shown.length === 1 ? "" : "s"}`;
			if (!shown.length) {
				list.appendChild(e_({outer: `<div class="ve-small ve-muted ve-italic p-2">No forms match your filters.</div>`}));
				return;
			}
			const canAddMore = !!this._state.canAddKnownWildShapeForm?.();
			for (const entry of shown) {
				const {creature, rec, model} = entry;
				const nameHtml = CharacterSheetClassUtils.buildCreatureHoverNameHtml(model, "ve-bold");
				const sourceAbv = creature.source ? Parser.sourceJsonToAbv(creature.source) : null;
				const sourceFull = creature.source ? Parser.sourceJsonToFull(creature.source) : null;
				const sourceHtml = sourceAbv
					? `<span class="ve-muted ve-small charsheet__ws-picker-source" title="${CharacterSheetClassUtils.escapeHtml(sourceFull || sourceAbv)}">${CharacterSheetClassUtils.escapeHtml(sourceAbv)}</span>`
					: "";
				const metaHtml = this._buildKnownFormPickerMeta(creature, rec, model);
				const isKnown = knownNames.has(`${(creature.name || "").toLowerCase()}|${(creature.source || "").toLowerCase()}`);
				const card = e_({outer: `
					<div class="charsheet__ws-picker-card p-2 rounded ve-flex-v-center ve-flex-h-between" style="gap: 8px; background: var(--cs-bg-surface, #1e293b); border: 1px solid var(--cs-border, rgba(255,255,255,.1));">
						<div class="ve-flex-col" style="min-width: 0; gap: 2px;">
							<div class="ve-small charsheet__ws-picker-name ve-flex-v-baseline" style="gap: 6px;">${nameHtml}${sourceHtml}</div>
							${metaHtml}
						</div>
						<button class="ve-btn ve-btn-xs ve-btn-primary charsheet__ws-picker-learn" ${(isKnown || !canAddMore) ? `disabled title="${isKnown ? "Already learned" : "You already know the maximum number of forms"}"` : "title=\"Learn this form\""}>${isKnown ? "Known" : "Learn"}</button>
					</div>
				`});
				card.querySelector(".charsheet__ws-picker-learn")?.addEventListener("click", (evt) => {
					if (/** @type {*} */ (evt.target)?.closest?.(".ve-help-subtle")) return;
					const id = this._state.addKnownWildShapeForm?.(creature);
					if (id) {
						JqueryUtil.doToast({type: "success", content: `Learned ${creature.name} as a Wild Shape form.`});
						this._refreshSheet();
						if (!this._state.canAddKnownWildShapeForm?.()) {
							doClose();
							return;
						}
						renderList();
					} else {
						JqueryUtil.doToast({type: "warning", content: `Could not learn ${creature.name} (already known or exceeds your limits).`});
						renderList();
					}
				});
				list.appendChild(card);
			}
		};

		searchEl?.addEventListener("input", () => renderList());
		[sourceEl, typeEl, sizeEl, crMinEl, crMaxEl].forEach(el => el?.addEventListener("change", () => renderList()));
		resetEl?.addEventListener("click", () => {
			if (searchEl) searchEl.value = "";
			[sourceEl, typeEl, sizeEl].forEach(el => { if (el) el.value = "__all__"; });
			[crMinEl, crMaxEl].forEach(el => { if (el) el.value = ""; });
			renderList();
		});
		renderList();
	}

	/**
	 * Build the structured option lists for the Known-Form picker filters from the
	 * precomputed candidate entries: unique sources, creature types, sizes (ordered
	 * T→G), and the sorted set of distinct numeric CRs present. Pure function — no
	 * DOM, no `this` — so it is unit-testable in isolation.
	 * @param {Array<{source?: string, creatureType?: string, size?: string, crNumber?: number}>} entries
	 * @returns {{sources: string[], types: string[], sizes: string[], crNumbers: number[]}}
	 */
	static buildKnownFormFilterOptions (entries) {
		const SIZE_ORDER = {T: 0, S: 1, M: 2, L: 3, H: 4, G: 5};
		const sources = new Set();
		const types = new Set();
		const sizes = new Set();
		const crNumbers = new Set();
		for (const entry of (entries || [])) {
			if (entry?.source) sources.add(entry.source);
			if (entry?.creatureType) types.add(entry.creatureType);
			if (entry?.size) sizes.add(entry.size);
			if (Number.isFinite(entry?.crNumber)) crNumbers.add(entry.crNumber);
		}
		return {
			sources: [...sources].sort((a, b) => a.localeCompare(b)),
			types: [...types].sort((a, b) => a.localeCompare(b)),
			sizes: [...sizes].sort((a, b) => (SIZE_ORDER[a] ?? 99) - (SIZE_ORDER[b] ?? 99)),
			crNumbers: [...crNumbers].sort((a, b) => a - b),
		};
	}

	/**
	 * Pure predicate deciding whether a single Known-Form picker entry survives the
	 * active filters. Combines free-text name search with structured source / type /
	 * size / CR-range filters (all AND-ed). Sentinel `"__all__"` (and empty CR
	 * bounds) mean "no constraint". No DOM / `this` — unit-testable in isolation.
	 * @param {{name?: string, source?: string, creatureType?: string, size?: string, crNumber?: number}} entry
	 * @param {{needle?: string, source?: string, type?: string, size?: string, crMin?: number|null, crMax?: number|null}} filters
	 * @returns {boolean}
	 */
	static matchesKnownFormFilters (entry, filters) {
		if (!entry) return false;
		const f = filters || {};
		if (f.needle && !(entry.name || "").toLowerCase().includes(String(f.needle).toLowerCase())) return false;
		if (f.source && f.source !== "__all__" && (entry.source || "") !== f.source) return false;
		if (f.type && f.type !== "__all__" && (entry.creatureType || "") !== f.type) return false;
		if (f.size && f.size !== "__all__" && (entry.size || "") !== f.size) return false;
		const cr = Number.isFinite(entry.crNumber) ? entry.crNumber : 0;
		if (f.crMin != null && Number.isFinite(f.crMin) && cr < f.crMin) return false;
		if (f.crMax != null && Number.isFinite(f.crMax) && cr > f.crMax) return false;
		return true;
	}

	/**
	 * Build the inline meta line(s) for a Known-Form picker card: a primary line of
	 * CR • type • size and the shared creature stat line (AC • HP • speed • senses •
	 * ability mods), plus a secondary line listing the form's key trait names. All
	 * dynamic text is HTML-escaped, so the result is safe to inject via innerHTML.
	 * @param {*} creature - The raw bestiary creature.
	 * @param {*} rec - The normalized beast record (`_parseBestiaryCreatureToBeastRecord`).
	 * @param {*} model - The display model (`_buildBeastModel`).
	 * @returns {string} Safe HTML.
	 * @private
	 */
	_buildKnownFormPickerMeta (creature, rec, model) {
		const esc = CharacterSheetClassUtils.escapeHtml;
		const sizeNames = {T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan"};
		const crDisplay = (rec?.cr != null) ? `CR ${rec.cr}` : null;
		const typeDisplay = rec?.creatureType ? esc(rec.creatureType.charAt(0).toUpperCase() + rec.creatureType.slice(1)) : null;
		const sizeDisplay = rec?.size ? esc(sizeNames[rec.size] || rec.size) : null;

		const primaryBits = [crDisplay && `<span class="ve-bold">${esc(crDisplay)}</span>`, typeDisplay, sizeDisplay].filter(Boolean);
		const statLine = CharacterSheetClassUtils.buildCreatureStatLineHtml(model);
		const headBits = [primaryBits.join(`<span class="charsheet__beast-sep"> \u2022 </span>`), statLine].filter(Boolean);

		const traitNames = (Array.isArray(rec?.traits) ? rec.traits : [])
			.map(t => t?.name).filter(Boolean).slice(0, 4).map(esc);
		const traitLine = traitNames.length
			? `<div class="ve-small ve-muted charsheet__ws-picker-traits"><span class="ve-bold">Traits</span> ${traitNames.join(", ")}</div>`
			: "";

		return `
			<div class="ve-small ve-muted charsheet__ws-picker-stats">${headBits.join(`<span class="charsheet__beast-sep"> \u2022 </span>`)}</div>
			${traitLine}
		`;
	}

	/**
	 * Transform into a Known Form by id. State spends the use atomically, so the
	 * module never diff-spends here (no double-spend).
	 * @param {string} knownFormId
	 * @private
	 */
	_transformIntoKnownForm (knownFormId) {
		this._refreshState();
		const companionId = this._state.transformIntoKnownForm?.(knownFormId);
		if (!companionId) {
			JqueryUtil.doToast({type: "warning", content: "Couldn't transform (no uses left or the form exceeds your limits)."});
			return;
		}
		const form = this._state.getKnownWildShapeForm?.(knownFormId);
		JqueryUtil.doToast({type: "success", content: `Wild Shape: ${form?.name || "Beast"} assumed.`});
		this._refreshSheet();
		this._renderModalBody();
	}

	/**
	 * Remove a Known Form from the roster (does not affect an active transform).
	 * @param {string} knownFormId
	 * @private
	 */
	_removeKnownForm (knownFormId) {
		this._refreshState();
		if (this._state.removeKnownWildShapeForm?.(knownFormId)) {
			this._refreshSheet();
			this._renderModalBody();
		}
	}

	/**
	 * Focused transform picker (2024) — a roster modal mirroring `openZodiacPicker`,
	 * so the combat-tab "Transform…" button isn't a backdoor into the full Druid
	 * panel. Empty roster → offer to add a form instead.
	 * @private
	 */
	async _openTransformPicker () {
		this._refreshState();
		if (!(this._state.getKnownWildShapeForms?.() || []).length) {
			JqueryUtil.doToast({type: "info", content: "No Wild Shape forms learned yet — add one first."});
			await this._pAddKnownForm();
			return;
		}
		this._modalMode = "wsTransform";
		const {eleModalInner, doClose} = UiUtil.getShowModal({
			title: "🐻 Transform — Wild Shape",
			isMinHeight0: true,
			isWidth100: true,
			cbClose: () => { this._modalBody = null; this._doClose = null; },
		});
		this._doClose = doClose;
		this._modalBody = e_({tag: "div", clazz: "ve-flex-col w-100 charsheet__druid-resources charsheet__druid-resources--wstransform"});
		eleModalInner.appendChild(this._modalBody);
		this._renderModalBody();
	}

	/**
	 * Legacy 2014 free-pick transform: opens the bestiary picker filtered by the
	 * level-gated limits and diff-spends a use only if a new companion was created.
	 * Used only for genuine 2014 PHB druids (2024 druids use the Known Forms path).
	 * @private
	 */
	async _pTransformWildShapeFree () {
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
