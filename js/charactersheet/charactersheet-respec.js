/**
 * CharacterSheetRespec - Handles level history display and choice editing
 * Allows players to view and modify choices made during level-up
 */
const {e_, ee} = /** @type {*} */ (globalThis);

class CharacterSheetRespec {
	constructor ({page, state}) {
		this._page = page;
		this._liveState = state;
		this._state = state;
		this._engine = globalThis.CharacterSheetRespecEngine
			? new globalThis.CharacterSheetRespecEngine({page, state})
			: null;

		this._timeline = null;
		this._legacyBadge = null;
		this._container = null;
		this._draftStatus = null;
		this._btnUndo = null;
		this._btnCancel = null;
		this._btnReview = null;
		this._btnApply = null;
	}

	/**
	 * Initialize the respec module and bind to DOM elements
	 */
	init () {
		this._container = document.getElementById("charsheet-level-history");
		this._timeline = document.getElementById("charsheet-level-timeline");
		this._legacyBadge = document.getElementById("charsheet-legacy-badge");
		this._draftStatus = document.getElementById("charsheet-respec-draft-status");
		this._btnUndo = document.getElementById("charsheet-respec-undo");
		this._btnCancel = document.getElementById("charsheet-respec-cancel");
		this._btnReview = document.getElementById("charsheet-respec-review");
		this._btnApply = document.getElementById("charsheet-respec-apply");

		if (!this._container) {
			// eslint-disable-next-line no-console
			console.warn("[Respec] Level history container not found");
			return;
		}

		this._btnUndo?.addEventListener("click", () => this._onUndo());
		this._btnCancel?.addEventListener("click", () => this._onCancelDraft());
		this._btnReview?.addEventListener("click", () => this._showDraftReview());
		this._btnApply?.addEventListener("click", () => this._onApplyDraft());

		// Initial render
		this.render();
	}

	/**
	 * Render the level history timeline
	 */
	render () {
		if (!this._timeline) return;
		if (this._engine) {
			this._engine.syncCleanDraft();
			this._state = this._engine.state;
			this._renderDraftStatus();
		}

		const totalLevel = this._state.getTotalLevel();

		// No levels yet - tab visibility handles showing/hiding
		if (totalLevel === 0) {
			this._timeline.innerHTML = "";
			this._timeline.append(e_({outer: `<p class="charsheet__respec-empty">No levels yet. Complete character creation in the Builder tab.</p>`}));
			return;
		}

		// Show legacy badge if applicable
		const isLegacy = this._state.isLegacyCharacter();
		this._legacyBadge.classList.toggle("ve-hidden", !isLegacy);

		this._timeline.innerHTML = "";

		// The character base (species, background, origin ability choices) lives OUTSIDE the per-class
		// level history, so it survives removing any class — including a class's first level. Render it as
		// a dedicated, non-removable card at the root of the tree. Origin editing flows through here.
		this._timeline.append(this._renderBaseCard());

		// Multiclass characters render one branch per class so the player can change/remove the last
		// level of EITHER class independently. Single-class keeps the original linear timeline.
		const classes = this._state.getClasses();
		if (classes.length > 1) {
			this._timeline.classList.add("charsheet__level-history-timeline--branched");
			this._timeline.append(this._renderBranches(classes));
			return;
		}
		this._timeline.classList.remove("charsheet__level-history-timeline--branched");

		// Build timeline entries
		const levelHistory = this._state.getLevelHistory();
		const historyByLevel = new Map(levelHistory.map(h => [h.level, h]));

		// Cache one HP breakdown call for the whole render — indexed by level so each row
		// can show its per-level HP contribution without recomputing.
		const hpBreakdown = this._state.getHpBreakdown();
		const hpByLevel = new Map((hpBreakdown.perLevel || []).map(p => [p.level, p]));

		for (let level = 1; level <= totalLevel; level++) {
			const history = historyByLevel.get(level);
			const entry = this._renderLevelEntry(level, history, level === totalLevel, hpByLevel.get(level));
			this._timeline.append(entry);
		}
	}

	_renderDraftStatus () {
		if (!this._engine || !this._draftStatus) return;
		const validation = this._engine.getValidation();
		const changeCount = this._engine.getChangeSummary().length;
		const spellAttention = this._getSpellRepairDecisions(validation.errors).length;
		const attention = validation.errors.length - spellAttention + (spellAttention ? 1 : 0);
		const spellDetail = spellAttention > 1 ? ` (${spellAttention} spell choices grouped)` : "";
		this._draftStatus.textContent = attention
			? `${attention} repair item${attention === 1 ? "" : "s"} need attention${spellDetail}${changeCount ? ` · ${changeCount} staged change${changeCount === 1 ? "" : "s"}` : ""}`
			: `${changeCount} staged change${changeCount === 1 ? "" : "s"} · Ready to apply`;
		this._draftStatus.classList.toggle("charsheet__respec-draft-status--invalid", attention > 0);
		if (this._btnApply) this._btnApply.disabled = !this._engine.isDirty || !validation.isValid;
		if (this._btnCancel) this._btnCancel.disabled = !this._engine.isDirty;
		if (this._btnReview) this._btnReview.disabled = !this._engine.isDirty && !attention;
		if (this._btnUndo) this._btnUndo.disabled = !this._engine.canUndo;
	}

	_onCancelDraft () {
		if (!this._engine?.isDraftActive) return;
		this._engine.cancel();
		this._state = this._liveState;
		this.render();
		JqueryUtil.doToast({type: "info", content: "Respec draft discarded."});
	}

	async _onApplyDraft () {
		if (!this._engine) return;
		try {
			await this._engine.apply();
			this._state = this._liveState;
			this.render();
			JqueryUtil.doToast({type: "success", content: "Respec applied. You can undo it until you start another draft."});
		} catch (error) {
			JqueryUtil.doToast({type: "danger", content: error.message || "Could not apply the Respec draft."});
		}
	}

	async _onUndo () {
		if (!this._engine?.canUndo) return;
		try {
			await this._engine.undo();
			this._state = this._liveState;
			this.render();
			JqueryUtil.doToast({type: "success", content: "The previous character state was restored."});
		} catch (error) {
			JqueryUtil.doToast({type: "danger", content: error.message || "Could not undo the Respec."});
		}
	}

	async _showDraftReview () {
		if (!this._engine) return;
		const validation = this._engine.getValidation();
		const changes = this._engine.getChangeSummary();
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "Review Respec Draft",
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});
		const content = e_({tag: "div", clazz: "charsheet__respec-review"});
		if (validation.errors.length) {
			const spellRepairs = this._getSpellRepairDecisions(validation.errors);
			const nonSpellErrors = validation.errors.filter(issue => !spellRepairs.some(decision => decision.id === issue.decisionId));
			const repairCount = nonSpellErrors.length + (spellRepairs.length ? 1 : 0);
			content.append(e_({outer: `<div class="ve-alert ve-alert--warning mb-2"><b>${repairCount} repair item${repairCount === 1 ? "" : "s"} need attention before Apply.</b></div>`}));
			const issueList = e_({tag: "ul", clazz: "charsheet__respec-review-list"});
			nonSpellErrors.forEach(issue => issueList.append(e_({tag: "li", txt: `${issue.level ? `Level ${issue.level}: ` : ""}${issue.message}`})));
			if (spellRepairs.length) {
				const levels = spellRepairs.map(decision => decision.characterLevel).sort((a, b) => a - b);
				issueList.append(e_({
					tag: "li",
					txt: `Spell progression has ${spellRepairs.length} unresolved choice${spellRepairs.length === 1 ? "" : "s"} across levels ${levels[0]}${levels.length > 1 ? `–${levels.at(-1)}` : ""}.`,
				}));
				const repairSpells = e_({
					tag: "button",
					clazz: "ve-btn ve-btn-primary ve-btn-sm mb-2",
					txt: spellRepairs.length === 1 ? "Repair spell choice" : `Repair ${spellRepairs.length} spell choices`,
				});
				repairSpells.addEventListener("click", () => this._showSpellRepairFlow(spellRepairs.map(decision => decision.id), doClose));
				content.append(repairSpells);
			}
			content.append(issueList);
		}
		if (validation.warnings.length) {
			const warningList = e_({tag: "ul", clazz: "charsheet__respec-review-list"});
			validation.warnings.forEach(issue => warningList.append(e_({tag: "li", txt: `${issue.level ? `Level ${issue.level}: ` : ""}${issue.message}`})));
			content.append(e_({tag: "h4", txt: "Warnings"}), warningList);
		}
		if (changes.length) {
			const changeList = e_({tag: "ul", clazz: "charsheet__respec-review-list"});
			changes.forEach(change => {
				const before = change.before == null ? "Not selected" : globalThis.CharacterSheetProgression.getDecisionDisplayValue({selection: change.before});
				const after = change.after == null ? "Not selected" : globalThis.CharacterSheetProgression.getDecisionDisplayValue({selection: change.after});
				const location = change.level ? `Level ${change.level}` : "Character Base";
				changeList.append(e_({tag: "li", txt: `${location}: ${change.label} — ${before} → ${after}`}));
			});
			content.append(e_({tag: "h4", txt: "Staged changes"}), changeList);
		} else {
			content.append(e_({tag: "p", clazz: "ve-muted", txt: "No changes are staged."}));
		}
		const close = e_({tag: "button", clazz: "ve-btn ve-btn-default mt-2", txt: "Close"});
		close.addEventListener("click", () => doClose());
		content.append(close);
		modalInner.append(content);
	}

	_getSpellRepairDecisions (errors = null) {
		const spellTypes = new Set(["knownSpells", "preparedSpells", "spellbookSpells", "cantrips", "preparedCantrips"]);
		const errorIds = errors ? new Set(errors.map(issue => issue.decisionId).filter(Boolean)) : null;
		return (this._engine?.manifest?.decisions || [])
			.filter(decision =>
				spellTypes.has(decision.type)
				&& decision.required
				&& decision.status !== "resolved"
				&& (!errorIds || errorIds.has(decision.id)),
			)
			.sort((a, b) => a.characterLevel - b.characterLevel || a.classLevel - b.classLevel);
	}

	async _showSpellRepairFlow (decisionIds, closeParentModal) {
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "Repair Spell Progression",
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});
		let ix = 0;

		const renderStep = () => {
			modalInner.innerHTML = "";
			const decision = this._engine.getDecision(decisionIds[ix]);
			if (!decision) {
				ix++;
				if (ix < decisionIds.length) return renderStep();
				doClose();
				closeParentModal?.();
				this.render();
				return;
			}
			const legalOptions = this._getDecisionOptions(decision);
			const current = Array.isArray(decision.selection) ? decision.selection : [];
			const {options, invalidOptionKeys} = CharacterSheetRespec._getDecisionEditorOptions(legalOptions, current);
			const legalOptionKeys = new Set(legalOptions.map(CharacterSheetRespec._getDecisionOptionKey));
			const selected = new Map(current.map(value => [CharacterSheetRespec._getDecisionOptionKey(value), value]));
			const usedByOtherDecisions = new Set((this._engine.manifest?.decisions || [])
				.filter(other =>
					other.id !== decision.id
					&& other.className === decision.className
					&& other.type === decision.type
					&& other.status === "resolved",
				)
				.flatMap(other => Array.isArray(other.selection) ? other.selection : [])
				.map(CharacterSheetRespec._getDecisionOptionKey));

			const content = e_({tag: "div", clazz: "charsheet__respec-decision-editor"});
			content.append(
				e_({tag: "div", clazz: "charsheet__respec-selection-count", txt: `Step ${ix + 1} of ${decisionIds.length}`}),
				e_({tag: "h4", txt: `Level ${decision.characterLevel}: ${decision.label}`}),
				e_({tag: "p", clazz: "ve-muted", txt: `Choose exactly ${decision.count}. Choices already assigned to another ${decision.className} level are unavailable.`}),
			);
			const search = e_({tag: "input", clazz: "ve-form-control mb-2"});
			search.type = "search";
			search.placeholder = "Search legal spells...";
			search.setAttribute("aria-label", "Search legal spells");
			const count = e_({tag: "div", clazz: "charsheet__respec-selection-count"});
			const list = e_({tag: "div", clazz: "charsheet__respec-option-list"});
			content.append(search, count, list);
			let next;
			const updateSelectionState = () => {
				const invalidSelectedCount = [...selected.keys()].filter(key => !legalOptionKeys.has(key)).length;
				count.textContent = `${selected.size}/${decision.count} selected${invalidSelectedCount ? ` · ${invalidSelectedCount} no longer legal` : ""}`;
				if (next) next.disabled = selected.size !== decision.count || invalidSelectedCount > 0;
			};

			const renderOptions = () => {
				list.innerHTML = "";
				const query = search.value.trim().toLowerCase();
				const filtered = options.filter(option => CharacterSheetRespec._getDecisionOptionLabel(option).toLowerCase().includes(query));
				filtered.slice(0, 150).forEach(option => {
					const key = CharacterSheetRespec._getDecisionOptionKey(option);
					const isInvalid = invalidOptionKeys.has(key);
					const isUnavailable = !isInvalid && usedByOtherDecisions.has(key) && !selected.has(key);
					const row = e_({tag: "label", clazz: `charsheet__respec-option${isUnavailable ? " charsheet__respec-option--disabled" : ""}`});
					const input = e_({tag: "input"});
					input.type = decision.count === 1 ? "radio" : "checkbox";
					input.name = `respec-spell-repair-${decision.id}`;
					input.checked = selected.has(key);
					input.disabled = isUnavailable;
					input.addEventListener("change", () => {
						if (decision.count === 1) selected.clear();
						if (input.checked) {
							if (selected.size >= decision.count) {
								input.checked = false;
								return;
							}
							selected.set(key, CharacterSheetRespec._toDecisionSelectionValue(option));
						} else selected.delete(key);
						updateSelectionState();
						if (decision.count === 1) renderOptions();
					});
					row.append(input, e_({
						tag: "span",
						txt: `${CharacterSheetRespec._getDecisionOptionLabel(option)}${isInvalid ? " — currently selected, no longer legal" : (isUnavailable ? " · chosen at another level" : "")}`,
					}));
					list.append(row);
				});
				if (!filtered.length) list.append(e_({tag: "p", clazz: "ve-muted", txt: "No legal spells match this search."}));
			};
			search.addEventListener("input", renderOptions);
			renderOptions();

			const actions = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
			const cancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Finish later"});
			cancel.addEventListener("click", () => {
				doClose();
				closeParentModal?.();
				this.render();
			});
			next = e_({
				tag: "button",
				clazz: "ve-btn ve-btn-primary",
				txt: ix === decisionIds.length - 1 ? "Stage & Finish" : "Stage & Next",
			});
			next.addEventListener("click", () => {
				if (selected.size !== decision.count) {
					JqueryUtil.doToast({type: "warning", content: `Choose exactly ${decision.count} spell${decision.count === 1 ? "" : "s"}.`});
					return;
				}
				const selection = [...selected.values()];
				this._engine.stageGraphMutation(decision.id, selection, {
					apply: ({state}) => this._applyManifestSelectionMechanics(decision, selection, options, state),
				});
				ix++;
				if (ix < decisionIds.length) return renderStep();
				doClose();
				closeParentModal?.();
				this.render();
				JqueryUtil.doToast({type: "success", content: "Spell progression repairs staged."});
			});
			updateSelectionState();
			actions.append(cancel, next);
			content.append(actions);
			modalInner.append(content);
			search.focus();
		};

		renderStep();
	}

	/**
	 * Render the non-removable "character base" card at the root of the respec tree: species, background,
	 * and the origin grants/ability choices that are NOT owned by any class. This is the structural
	 * counterpart to the data-model split — the base survives removing any class (including a class's
	 * first level). Origin editing (species/background) flows through this card's Edit buttons.
	 * @returns {HTMLElement}
	 */
	_renderBaseCard () {
		const race = this._state.getRace();
		const background = this._state.getBackground();
		// Use the level-1 history entry only as a legacy fallback for grant rendering; the authoritative
		// origin user-choices now come from the character base node.
		const level1History = this._state.getLevelHistoryEntry?.(1) || null;

		const card = e_({tag: "div", clazz: "charsheet__level-entry charsheet__respec-base-card"});

		const header = e_({tag: "div", clazz: "charsheet__level-entry-header"});
		header.append(e_({outer: `
			<div class="charsheet__level-entry-class">
				<span class="charsheet__level-entry-class-name">Character Base</span>
				<span class="charsheet__level-entry-class-level">Species, background &amp; origin</span>
			</div>
		`}));
		card.append(header);

		// Species + background rows with Edit buttons
		const rows = e_({tag: "div", clazz: "charsheet__respec-base-rows"});

		const mkRow = (icon, label, value, onEdit) => {
			const row = e_({tag: "div", clazz: "charsheet__respec-base-row ve-flex-v-center"});
			row.append(e_({outer: `<span class="charsheet__respec-base-row-label">${icon} ${label}:</span>`}));
			row.append(e_({outer: `<span class="charsheet__respec-base-row-value ml-1">${value ? Renderer.stripTags(value) : "—"}</span>`}));
			if (onEdit) {
				const editBtn = e_({tag: "button", clazz: "charsheet__level-entry-edit ml-auto", title: `Edit ${label.toLowerCase()}`});
				editBtn.append(e_({outer: `<span class="glyphicon glyphicon-pencil"></span>`}));
				editBtn.addEventListener("click", () => onEdit());
				row.append(editBtn);
			}
			return row;
		};

		const raceName = this._state.getRaceName?.() || race?.name || "";
		rows.append(mkRow("🧬", "Species", raceName, race ? () => this._editRace(1, level1History || {level: 1, choices: {}}, null) : null));
		rows.append(mkRow("🎒", "Background", background?.name || "", background ? () => this._editBackground(1, level1History || {level: 1, choices: {}}, null) : null));
		const backgroundAbilityDecisions = (this._engine?.manifest?.base?.decisions || []).filter(decision =>
			decision.meta?.originAbilityDistribution
				&& decision.provenance?.ownerType === "background",
		);
		if (background && backgroundAbilityDecisions.some(decision => decision.required && decision.status !== "resolved")) {
			const repair = e_({
				tag: "button",
				clazz: "ve-btn ve-btn-xs ve-btn-warning mt-1",
				txt: "Background ability choices are incomplete — complete choices",
			});
			repair.dataset.respecBackgroundAbilityRepair = "true";
			repair.addEventListener("click", () => this._editBackground(1, level1History || {level: 1, choices: {}}, null));
			rows.append(repair);
		}
		card.append(rows);

		// Origin grants summary (speed/darkvision/skills/languages/ASI), reused from the level-1 renderer
		const grants = this._renderRaceBackgroundGrants(level1History);
		if (grants) card.append(grants);
		const unplacedFeats = this._renderUnplacedFeatHistory();
		if (unplacedFeats) card.append(unplacedFeats);

		return card;
	}

	_renderUnplacedFeatHistory () {
		const decisions = (this._engine?.manifest?.base?.decisions || [])
			.filter(decision => decision.meta?.unplacedFeat)
			.sort((a, b) => String(a.selection?.name || "").localeCompare(String(b.selection?.name || "")));
		if (!decisions.length) return null;

		const section = e_({tag: "div", clazz: "charsheet__level-grants-section mt-2"});
		section.dataset.respecUnplacedFeats = "true";
		section.append(
			e_({tag: "div", clazz: "ve-small ve-bold", txt: "🧭 Unplaced feat history"}),
			e_({
				tag: "div",
				clazz: "ve-small ve-muted ml-2 mb-1",
				txt: "These feats are mechanically active, but their acquisition level is unknown. Respec preserves them without assigning them to an ASI.",
			}),
		);

		const labels = {
			ability: "Ability",
			skills: "Skill",
			expertise: "Expertise",
			tools: "Tool",
			languages: "Language",
			spellList: "Spell list",
			cantrips: "Cantrip",
			spells: "Spell",
			optionalFeatures: "Feature",
		};
		const formatValue = (key, value) => {
			const values = Array.isArray(value) ? value : [value];
			return values.map(item => {
				const raw = item?.name || item?.choice || item?.value || item;
				if (key === "ability") return Parser.attAbvToFull(String(raw || "").toLowerCase());
				return String(raw || "").toTitleCase();
			}).join(", ");
		};

		for (const decision of decisions) {
			const row = e_({tag: "div", clazz: "ve-small ml-2 mt-1"});
			const name = decision.selection?.name || decision.label;
			const source = decision.selection?.source ? ` (${Parser.sourceJsonToAbv(decision.selection.source)})` : "";
			row.append(e_({tag: "span", clazz: "ve-bold", txt: `${name}${source}`}));

			const evidence = decision.meta?.choiceEvidence || {};
			const parts = Object.entries(evidence.recorded || {})
				.map(([key, value]) => `${labels[key] || key}: ${formatValue(key, value)}`);
			for (const key of evidence.missing || []) parts.push(`${labels[key] || key}: Unknown`);
			if (!evidence.hasExpectedChoices && !parts.length) parts.push("No recorded build-time subchoices");
			else if (!parts.length) parts.push("Subchoice history is unavailable");
			row.append(e_({tag: "span", clazz: "ve-muted", txt: ` — ${parts.join(" · ")}`}));
			const childLabels = {ability: "ability", skills: "skill", expertise: "expertise"};
			const children = (this._engine?.manifest?.base?.decisions || [])
				.filter(candidate =>
					candidate.meta?.unplacedFeatChoice
						&& candidate.rootSemanticKey === decision.semanticKey,
				)
				.sort((a, b) => Number(a.slot) - Number(b.slot));
			for (const child of children) {
				const childLabel = childLabels[child.meta?.featChoiceKey] || "choice";
				const editBtn = e_({
					tag: "button",
					clazz: `ve-btn ve-btn-xs ${child.status === "resolved" ? "ve-btn-default" : "ve-btn-warning"} ml-2`,
					txt: `${child.status === "resolved" ? "Change" : "Choose"} ${childLabel}`,
				});
				editBtn.dataset.decisionId = child.id;
				editBtn.addEventListener("click", () => this._editManifestOptions(
					0,
					{choices: {}},
					{decision: child},
					null,
				));
				row.append(editBtn);
			}
			section.append(row);
		}
		return section;
	}

	/**
	 * Render the multiclass branch view: one column per class, each listing that class's levels
	 * 1..K with a Remove button on its last level (when safely removable).
	 * @param {Array} classes - The character's classes (from getClasses())
	 * @returns {HTMLElement}
	 */
	_renderBranches (classes) {
		const wrap = e_({tag: "div", clazz: "charsheet__level-branches"});

		const levelHistory = this._state.getLevelHistory();
		const hpBreakdown = this._state.getHpBreakdown();
		const hpByLevel = new Map((hpBreakdown.perLevel || []).map(p => [p.level, p]));

		for (const cls of classes) {
			wrap.append(this._renderClassBranch(cls, levelHistory, hpByLevel));
		}

		return wrap;
	}

	/**
	 * Render a single class branch.
	 *
	 * Recorded history entries are assigned to the class's TOP class levels (a suffix mapping that is
	 * exact when the class history is complete, and best-effort for partial/legacy histories — earlier
	 * unrecorded class levels render as "no history recorded" cards). Only the class's last level gets
	 * a Remove button, gated by getRemoveClassLastLevelPreview().
	 * @param {object} cls - A class entry {name, source, level, subclass}
	 * @param {Array} levelHistory - Full level history
	 * @param {Map} hpByLevel - Per-total-level HP breakdown
	 * @returns {HTMLElement}
	 */
	_renderClassBranch (cls, levelHistory, hpByLevel) {
		const classLevels = cls.level || 1;
		const entries = levelHistory
			.filter(h => h.class?.name === cls.name && h.class?.source === cls.source)
			.sort((a, b) => a.level - b.level);
		const offset = classLevels - entries.length; // class levels 1..offset have no recorded history

		const preview = this._state.getRemoveClassLastLevelPreview(cls.name, cls.source);
		const removableLast = !!preview;

		const branch = e_({tag: "div", clazz: "charsheet__level-branch"});
		branch.dataset.className = cls.name;

		const subName = cls.subclass?.name ? ` · ${cls.subclass.name}` : "";
		branch.append(e_({outer: `
			<div class="charsheet__level-branch-header">
				<span class="charsheet__level-branch-name">${cls.name}</span>
				<span class="charsheet__level-branch-sub">Levels 1–${classLevels}${subName}</span>
			</div>
		`}));

		const list = e_({tag: "div", clazz: "charsheet__level-branch-entries"});
		for (let classLevel = 1; classLevel <= classLevels; classLevel++) {
			const history = classLevel > offset ? entries[classLevel - offset - 1] : null;
			const hpInfo = history ? hpByLevel.get(history.level) : null;
			const isLast = classLevel === classLevels;
			list.append(this._renderLevelEntry(classLevel, history, isLast, hpInfo, {
				levelLabel: `${cls.name} ${classLevel}`,
				showGrants: false,
				removable: isLast && removableLast,
				onRemove: () => this._onRemoveClassLevel(cls.name, cls.source),
			}));
		}
		branch.append(list);

		return branch;
	}

	/**
	 * Render a single level entry in the timeline
	 * @param {number} displayLevel - Level number to display (character level for single-class, class level for branches)
	 * @param {object|null} history - History entry or null for legacy
	 * @param {boolean} isCurrent - Whether this is the current (last) level of its track
	 * @param {object|null} [hpInfo] - Per-level HP breakdown entry from getHpBreakdown()
	 * @param {object} [opts] - Branch-mode overrides
	 * @param {string} [opts.levelLabel] - Custom label (e.g. "Druid 3"); defaults to "Level {displayLevel}"
	 * @param {boolean} [opts.showGrants] - Whether to show race/background grants; defaults to displayLevel === 1
	 * @param {boolean} [opts.removable] - Force-enable/disable the remove button (branch mode)
	 * @param {Function} [opts.onRemove] - Remove handler (branch mode); falls back to last-level removal
	 * @returns {HTMLElement} The entry element
	 */
	_renderLevelEntry (displayLevel, history, isCurrent, hpInfo, opts = {}) {
		const isLegacy = !history;
		const classes = this._state.getClasses();

		// Real character (total) level for edit/remove keys — history.level is authoritative when present.
		const totalLevel = history?.level ?? displayLevel;
		const levelLabel = opts.levelLabel || `Level ${displayLevel}`;
		// Origin grants now live on the dedicated Base card; per-level grant rendering is opt-in only.
		const showGrants = opts.showGrants != null ? opts.showGrants : false;

		// Determine which class this level was in
		let levelClass = null;
		if (history?.class) {
			levelClass = history.class;
		} else {
			// For legacy, infer from current class levels
			// This is approximate - we just show the first class
			levelClass = classes[0] ? {name: classes[0].name, source: classes[0].source} : null;
		}

		const entryClasses = [
			"charsheet__level-entry",
			isLegacy ? "charsheet__level-entry--legacy" : "",
			isCurrent ? "charsheet__level-entry--current" : "",
		].filter(Boolean).join(" ");

		const entry = e_({tag: "div", clazz: entryClasses});
		entry.dataset.level = totalLevel;

		const card = e_({tag: "div", clazz: "charsheet__level-entry-card"});

		// Header with class name and edit button
		const header = e_({tag: "div", clazz: "charsheet__level-entry-header"});

		const className = levelClass?.name || "Unknown";
		const classInfo = e_({outer: `
			<div class="charsheet__level-entry-class">
				<span class="charsheet__level-entry-class-name">${className}</span>
				<span class="charsheet__level-entry-class-level">${levelLabel}</span>
			</div>
		`});
		const levelDecisions = this._engine?.manifest?.decisions?.filter(decision => decision.characterLevel === totalLevel) || [];
		const decisionsNeedingAttention = levelDecisions.filter(decision =>
			decision.status === "invalid"
				|| decision.status === "ambiguous"
				|| (decision.required && decision.status !== "resolved"),
		);
		const status = e_({
			tag: "span",
			clazz: `charsheet__respec-level-status ${decisionsNeedingAttention.length ? "charsheet__respec-level-status--attention" : "charsheet__respec-level-status--complete"}`,
			txt: decisionsNeedingAttention.length
				? `${decisionsNeedingAttention.length} need attention`
				: `${levelDecisions.length} decision${levelDecisions.length === 1 ? "" : "s"} reviewed`,
		});
		classInfo.append(status);

		// Edit button - disabled for legacy entries
		const editBtn = e_({outer: `
			<button class="charsheet__level-entry-edit" type="button" aria-label="Edit ${levelLabel} choices" title="Edit choices for this level">
				<span class="glyphicon glyphicon-pencil"></span>
			</button>
		`});

		editBtn.addEventListener("click", () => this._onEditLevel(totalLevel, history));

		const headerActions = e_({tag: "div", clazz: "charsheet__level-entry-actions"});
		headerActions.append(editBtn);

		// Remove button. In branch mode the caller decides removability + handler; in single-class
		// mode it shows on the current (last) non-legacy level above 1, as before.
		const showRemove = opts.removable != null
			? opts.removable
			: (isCurrent && !isLegacy && displayLevel > 1);
		if (showRemove) {
			const removeBtn = e_({outer: `
				<button class="charsheet__level-entry-remove" title="Remove this level">
					<span class="glyphicon glyphicon-minus"></span>
				</button>
			`});
			removeBtn.addEventListener("click", () => (opts.onRemove ? opts.onRemove() : this._onRemoveLevel(totalLevel, history)));
			headerActions.append(removeBtn);
		}

		header.append(classInfo, headerActions);
		card.append(header);

		// Show race/background grants at the character's first level
		if (showGrants) {
			const grants = this._renderRaceBackgroundGrants(history);
			if (grants) card.append(grants);
		}

		// Choices summary
		const choices = e_({tag: "div", clazz: "charsheet__level-entry-choices"});

		if (history?.choices && Object.keys(history.choices).length > 0) {
			// ASI choice
			if (history.choices.asi) {
				const asiText = Object.entries(history.choices.asi)
					.map(([abl, val]) => `${Parser.attAbvToFull(abl)} +${val}`)
					.join(", ");
				choices.append(e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--asi">
						<span class="charsheet__level-choice-icon">📈</span>
						${asiText}
					</span>
				`}));
			}

			// Feat choice
			if (history.choices.feat) {
				const featPill = e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--feat">
						<span class="charsheet__level-choice-icon">⭐</span>
						<span class="respec-hover-slot"></span>
					</span>
				`});
				CharacterSheetRespec._setHoverLink(featPill.querySelector(".respec-hover-slot"), UrlUtil.PG_FEATS, history.choices.feat.name, history.choices.feat.source);
				choices.append(featPill);
			}

			// Subclass choice
			if (history.choices.subclass) {
				const subPill = e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--subclass">
						<span class="charsheet__level-choice-icon">🎭</span>
						<span class="respec-hover-slot"></span>
					</span>
				`});
				CharacterSheetRespec._setSubclassHoverLink(subPill.querySelector(".respec-hover-slot"), this._page, history.choices.subclass, levelClass);
				choices.append(subPill);
			}

			// Skills chosen
			if (history.choices.skills?.length > 0) {
				const skillText = history.choices.skills.slice(0, 3).join(", ");
				const more = history.choices.skills.length > 3 ? ` +${history.choices.skills.length - 3} more` : "";
				choices.append(e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--skill">
						<span class="charsheet__level-choice-icon">🎯</span>
						${skillText}${more}
					</span>
				`}));
			}

			// Feature choices (specialties, fighting styles, etc.)
			if (history.choices.featureChoices?.length > 0) {
				history.choices.featureChoices.forEach(fc => {
					const fcPill = e_({outer: `
						<span class="charsheet__level-choice charsheet__level-choice--feature">
							<span class="charsheet__level-choice-icon">✦</span>
							<span class="respec-hover-slot"></span>
						</span>
					`});
					CharacterSheetRespec._setHoverLink(fcPill.querySelector(".respec-hover-slot"), UrlUtil.PG_OPT_FEATURES, fc.choice, fc.source);
					choices.append(fcPill);
				});
			}

			// Optional features (invocations, metamagic, combat methods, etc.)
			if (history.choices.optionalFeatures?.length > 0) {
				history.choices.optionalFeatures.forEach(of => {
					const ofPill = e_({outer: `
						<span class="charsheet__level-choice charsheet__level-choice--feature">
							<span class="charsheet__level-choice-icon">✧</span>
							<span class="respec-hover-slot"></span>
						</span>
					`});
					const page = of.type?.startsWith("CTM:") ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES;
					CharacterSheetRespec._setHoverLink(ofPill.querySelector(".respec-hover-slot"), page, of.name, of.source);
					choices.append(ofPill);
				});
			}

			// Expertise choices
			if (history.choices.expertise?.length > 0) {
				const expertiseText = history.choices.expertise.map(e => (/** @type {*} */ (e)).toTitleCase()).slice(0, 3).join(", ");
				const more = history.choices.expertise.length > 3 ? ` +${history.choices.expertise.length - 3} more` : "";
				choices.append(e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--expertise">
						<span class="charsheet__level-choice-icon">🔥</span>
						Expertise: ${expertiseText}${more}
					</span>
				`}));
			}

			// Combat traditions
			if (history.choices.combatTraditions?.length > 0) {
				const tradPill = e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--feature">
						<span class="charsheet__level-choice-icon">⚔️</span>
						Traditions: <span class="respec-hover-slots"></span>
					</span>
				`});
				const slotsEl = tradPill.querySelector(".respec-hover-slots");
				history.choices.combatTraditions.forEach((code, i) => {
					if (i > 0) slotsEl.append(document.createTextNode(", "));
					const tradName = CharacterSheetClassUtils.getTraditionName?.(code) || code;
					const slot = e_({tag: "span", clazz: "respec-hover-slot"});
					CharacterSheetRespec._setHoverLink(slot, UrlUtil.PG_VARIANTRULES, "Combat Traditions", Parser.SRC_TGTT || "TGTT", null, tradName);
					slotsEl.append(slot);
				});
				choices.append(tradPill);
			}

			// Weapon masteries
			if (history.choices.weaponMasteries?.length > 0) {
				const masteryPill = e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--feature">
						<span class="charsheet__level-choice-icon">🗡️</span>
						Masteries: <span class="respec-hover-slots"></span>
					</span>
				`});
				const slotsEl = masteryPill.querySelector(".respec-hover-slots");
				history.choices.weaponMasteries.forEach((m, i) => {
					if (i > 0) slotsEl.append(document.createTextNode(", "));
					const [name, source] = m.split("|");
					const slot = e_({tag: "span", clazz: "respec-hover-slot"});
					CharacterSheetRespec._setHoverLink(slot, UrlUtil.PG_ITEMS, name, source);
					slotsEl.append(slot);
				});
				choices.append(masteryPill);
			}

			// Language choices
			if (history.choices.languages?.length > 0) {
				const langText = history.choices.languages.map(l => l.language).join(", ");
				choices.append(e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--language">
						<span class="charsheet__level-choice-icon">🗣️</span>
						${langText}
					</span>
				`}));
			}

			// Scholar skill (knowledge domain, sage, etc.)
			if (history.choices.scholarSkill) {
				choices.append(e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--scholar">
						<span class="charsheet__level-choice-icon">📚</span>
						Scholar: ${(/** @type {*} */ (history.choices.scholarSkill)).toTitleCase()}
					</span>
				`}));
			}

			// Spellbook spells (wizard)
			if (history.choices.spellbookSpells?.length > 0) {
				const spellText = history.choices.spellbookSpells.map(s => s.name).slice(0, 2).join(", ");
				const more = history.choices.spellbookSpells.length > 2 ? ` +${history.choices.spellbookSpells.length - 2} more` : "";
				choices.append(e_({outer: `
					<span class="charsheet__level-choice charsheet__level-choice--spells">
						<span class="charsheet__level-choice-icon">📜</span>
						Spellbook: ${spellText}${more}
					</span>
				`}));
			}
		} else if (isLegacy) {
			choices.append(e_({outer: `<span class="charsheet__level-entry-empty">No choices could be reconstructed. Open this level to review its decision opportunities.</span>`}));
		} else {
			choices.append(e_({outer: `<span class="charsheet__level-entry-empty">No choices at this level</span>`}));
		}
		for (const decision of decisionsNeedingAttention) {
			choices.append(e_({
				tag: "span",
				clazz: "charsheet__level-choice charsheet__level-choice--attention",
				txt: `${decision.label}: ${decision.status}`,
			}));
		}

		// HP gain pill — always shown when we have breakdown data, so players can see
		// rolled vs average HP at a glance per level.
		if (hpInfo) {
			const sourceLabels = {max: "Max", rolled: "Rolled", average: "Average", fallback: "Average"};
			const sourceLabel = sourceLabels[hpInfo.source] || hpInfo.source;
			const conSign = hpInfo.conContribution >= 0 ? "+" : "";
			const rolledNote = hpInfo.source === "rolled" && hpInfo.rolled !== hpInfo.base
				? ` (rolled ${hpInfo.rolled}, capped at d${hpInfo.hitDie})`
				: "";
			const label = `${sourceLabel} ${hpInfo.base} (d${hpInfo.hitDie})${rolledNote} ${conSign}${hpInfo.conContribution} CON = +${hpInfo.levelTotal} HP`;
			const tooltip = `Hit die: d${hpInfo.hitDie} · CON mod: ${conSign}${hpInfo.conContribution} · Total at this level: +${hpInfo.levelTotal} HP`;
			choices.append(e_({outer: `
				<span class="charsheet__level-choice charsheet__level-choice--hp" title="${tooltip}">
					<span class="charsheet__level-choice-icon">❤️</span>
					${label}
				</span>
			`}));
		}

		card.append(choices);
		entry.append(card);

		return entry;
	}

	/**
	 * Handle remove button click for the last level
	 * @param {number} level - The level to remove
	 * @param {object} history - The history entry
	 */
	async _onRemoveLevel (level, history) {
		const preview = this._state.getRemoveLastLevelPreview();
		if (!preview) {
			JqueryUtil.doToast({type: "warning", content: "Cannot remove this level."});
			return;
		}
		await this._showRemoveLevelModal(preview, () => this._state.removeLastLevel());
	}

	/**
	 * Handle remove button click for a class branch's last level
	 * @param {string} name - Class name
	 * @param {string} source - Class source
	 */
	async _onRemoveClassLevel (name, source) {
		const preview = this._state.getRemoveClassLastLevelPreview(name, source);
		if (!preview) {
			JqueryUtil.doToast({type: "warning", content: "Cannot remove this level."});
			return;
		}

		// Capture the chronological-first ("primary") class BEFORE removal. If peeling this level vacates
		// the first slot (i.e. removes the total-level-1 entry), a different class becomes primary and must
		// be granted its starting saving-throw + armor/weapon proficiencies (reversing the old primary's).
		const firstBefore = this._state.getChronologicalFirstClass();

		await this._showRemoveLevelModal(preview, () => {
			const result = this._state.removeClassLastLevel(name, source);
			if (result.success) {
				const firstAfter = this._state.getChronologicalFirstClass();
				const changed = firstAfter && (!firstBefore || firstAfter.name !== firstBefore.name || firstAfter.source !== firstBefore.source);
				if (changed) {
					const newClassData = this._page.getClasses()?.find(c => c.name === firstAfter.name && c.source === firstAfter.source)
						|| this._page.getClasses()?.find(c => c.name === firstAfter.name);
					if (newClassData) {
						this._state.applyFirstClassStartingProficiencies(newClassData);
						JqueryUtil.doToast({type: "info", content: `${firstAfter.name} is now your primary class; saving throws and starting proficiencies updated.`});
					}
				}
			}
			return result;
		});
	}

	/**
	 * Show a confirmation modal for removing a level
	 * @param {object} preview - The preview object (from getRemoveLastLevelPreview / getRemoveClassLastLevelPreview)
	 * @param {Function} doRemove - Callback that performs the removal and returns {success, reason?}
	 */
	async _showRemoveLevelModal (preview, doRemove) {
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Remove ${preview.className} Level ${preview.classLevel}?`,
			isMinHeight0: true,
			cbClose: () => {},
		});

		const content = e_({tag: "div", clazz: "charsheet__respec-modal"});

		content.append(e_({outer: `<p>This will remove <b>${preview.className}</b> level ${preview.classLevel} and the following:</p>`}));

		// Build removal summary
		const items = [];

		if (preview.features.length) {
			items.push(`Features: ${preview.features.map(f => f.name).join(", ")}`);
		}
		if (preview.feat) {
			items.push(`Feat: ${preview.feat.name}`);
		}
		if (preview.classFeatProgressionFeats?.length) {
			items.push(`Class Feats: ${preview.classFeatProgressionFeats.map(f => f.name).join(", ")}`);
		}
		if (preview.asi) {
			const asiParts = Object.entries(preview.asi)
				.filter(([, v]) => v)
				.map(([abl, val]) => `${Parser.attAbvToFull(abl)} +${val}`);
			if (asiParts.length) items.push(`ASI: ${asiParts.join(", ")}`);
		}
		if (preview.optionalFeatures.length) {
			items.push(`Optional Features: ${preview.optionalFeatures.map(f => f.name).join(", ")}`);
		}
		if (preview.featureChoices?.length) {
			items.push(`Feature Choices: ${preview.featureChoices.map(f => f.name).join(", ")}`);
		}
		if (preview.spells.length) {
			items.push(`Spells: ${preview.spells.map(s => s.name).join(", ")}`);
		}
		if (preview.spellSwap) {
			items.push(`Spell Swap: undo ${preview.spellSwap.added?.name} → ${preview.spellSwap.removed?.name}`);
		}
		if (preview.expertise.length) {
			items.push(`Expertise: ${preview.expertise.map(s => (/** @type {*} */ (s)).toTitleCase()).join(", ")}`);
		}
		if (preview.languages.length) {
			items.push(`Languages: ${preview.languages.join(", ")}`);
		}
		if (preview.combatTraditions.length) {
			items.push(`Combat Traditions: ${preview.combatTraditions.join(", ")}`);
		}
		if (preview.weaponMasteries.length) {
			items.push(`Weapon Masteries: ${preview.weaponMasteries.map(m => m.split("|")[0]).join(", ")}`);
		}

		if (items.length) {
			const list = e_({tag: "ul", clazz: "mb-2"});
			items.forEach(item => list.append(e_({tag: "li", html: item})));
			content.append(list);
		} else {
			content.append(e_({outer: `<p class="ve-muted ve-small">No tracked choices to remove.</p>`}));
		}

		if (preview.willRemoveSubclass) {
			content.append(e_({outer: `<div class="ve-alert ve-alert--warning mb-2"><b>\u26a0 Warning:</b> Your <b>${preview.subclassName}</b> subclass will be removed along with all its features.</div>`}));
		}

		if (preview.willRemoveClass) {
			content.append(e_({outer: `<div class="ve-alert ve-alert--warning mb-2"><b>\u26a0 Warning:</b> Your <b>${preview.className}</b> class will be removed entirely.</div>`}));
		}

		// Buttons
		const btnRow = e_({tag: "div", clazz: "ve-flex-v-center ve-flex-h-right mt-3"});

		const btnRemove = e_({tag: "button", clazz: "ve-btn ve-btn-danger mr-2", txt: "Remove Level"});
		btnRemove.addEventListener("click", () => {
			const result = doRemove();
			if (result.success) {
				doClose();
				this.render();
				JqueryUtil.doToast({type: "success", content: `Removed ${preview.className} level ${preview.classLevel}.`});
			} else {
				JqueryUtil.doToast({type: "danger", content: result.reason});
			}
		});

		const btnCancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		btnCancel.addEventListener("click", () => doClose());

		btnRow.append(btnRemove, btnCancel);
		content.append(btnRow);

		modalInner.append(content);
	}

	/**
	 * Handle edit button click for a level
	 * @param {number} level - The level to edit
	 * @param {object} history - The history entry
	 */
	async _onEditLevel (level, history) {
		if (!history) return;

		// Determine what can be edited at this level
		const editableChoices = this._getEditableChoices(level, history);

		if (editableChoices.length === 0) {
			JqueryUtil.doToast({type: "info", content: "No editable choices at this level."});
			return;
		}

		// Show edit modal
		await this._showEditModal(level, history, editableChoices);
	}

	/**
	 * Render a read-only summary of race and background grants for the level 1 card.
	 * @returns {HTMLElement|null} The grants element, or null if no race/background set
	 */
	_renderRaceBackgroundGrants (history) {
		const race = this._state.getRace();
		const background = this._state.getBackground();

		if (!race && !background) return null;

		const grants = e_({tag: "div", clazz: "charsheet__level-entry-grants mt-1 mb-1"});
		const raceUserChoices = (this._state.getBaseRaceUserChoices ? this._state.getBaseRaceUserChoices() : null) || history?.choices?.raceUserChoices || {};
		const bgUserChoices = (this._state.getBaseBackgroundUserChoices ? this._state.getBaseBackgroundUserChoices() : null) || history?.choices?.backgroundUserChoices || {};

		// Race grants
		if (race) {
			const raceName = this._state.getRaceName() || race.name;
			const raceGrants = e_({tag: "div", clazz: "charsheet__level-grants-section"});
			raceGrants.append(e_({outer: `<div class="ve-small ve-bold">🧬 Species traits</div>`}));

			const items = [];

			// Speed
			if (race.speed) {
				const speed = typeof race.speed === "number" ? race.speed : race.speed.walk;
				if (speed) items.push(`Speed ${speed} ft.`);
				if (typeof race.speed === "object") {
					["fly", "swim", "climb", "burrow"].forEach(t => {
						if (race.speed[t] === true) items.push(`${(/** @type {*} */ (t)).toTitleCase()} equal to walking speed`);
						else if (race.speed[t]) items.push(`${(/** @type {*} */ (t)).toTitleCase()} ${race.speed[t]} ft.`);
					});
				}
			}

			// Senses (darkvision + blindsight + tremorsense + truesight)
			CharacterSheetClassUtils.SENSE_DISPLAY_ORDER.forEach(senseKey => {
				if (race[senseKey]) items.push(`${CharacterSheetClassUtils.SENSE_DISPLAY_META[senseKey]?.label || senseKey.toTitleCase()} ${race[senseKey]} ft.`);
			});

			// Size
			if (race.size?.length) {
				const sizeMap = {T: "Tiny", S: "Small", M: "Medium", L: "Large", H: "Huge", G: "Gargantuan"};
				items.push(race.size.map(s => sizeMap[s] || s).join("/"));
			}

			// Resistances
			if (race.resist?.length) {
				const resists = race.resist.filter(r => typeof r === "string");
				if (resists.length) items.push(`Resist: ${resists.join(", ")}`);
			}

			// Skill proficiencies — fixed + user-chosen
			const raceSkills = [];
			if (race.skillProficiencies?.length) {
				race.skillProficiencies.forEach(sp => {
					Object.keys(sp).forEach(s => {
						if (s !== "any" && s !== "choose") raceSkills.push((/** @type {*} */ (s)).toTitleCase());
					});
				});
			}
			if (raceUserChoices.selectedSkills?.length) {
				raceUserChoices.selectedSkills.forEach(s => raceSkills.push(s));
			}
			if (raceSkills.length) items.push(`Skills: ${raceSkills.join(", ")}`);

			// Language proficiencies — fixed + user-chosen
			const raceLangs = [];
			if (race.languageProficiencies?.length) {
				race.languageProficiencies.forEach(lp => {
					Object.keys(lp).forEach(l => {
						if (l !== "anyStandard" && l !== "any" && l !== "choose") raceLangs.push(CharacterSheetClassUtils.resolveLanguageProficiencyName(l));
					});
				});
			}
			if (raceUserChoices.selectedLanguages) {
				Object.values(raceUserChoices.selectedLanguages).forEach(arr => {
					if (Array.isArray(arr)) arr.forEach(l => raceLangs.push(l));
				});
			}
			if (raceLangs.length) items.push(`Languages: ${raceLangs.join(", ")}`);

			// Tool proficiencies — user-chosen
			if (raceUserChoices.selectedTools?.length) {
				items.push(`Tools: ${raceUserChoices.selectedTools.join(", ")}`);
			}

			// Ability bonuses — fixed + user-chosen
			// If Tasha's optional rules are in effect, the player reassigns ALL racial ASI,
			// so the race-default `ability` block must be hidden and replaced with the
			// Tasha's-chosen distribution. Otherwise we show race defaults plus any
			// race-defined ability choice picks (Variant Human +1/+1, etc.).
			const raceBonusParts = [];
			const totalsByAbi = {};
			const addBonus = (abi, amount) => {
				if (!abi || !Parser.ABIL_ABVS.includes(abi)) return;
				const n = Number(amount) || 0;
				if (!n) return;
				totalsByAbi[abi] = (totalsByAbi[abi] || 0) + n;
			};
			if (raceUserChoices.useTashasRules && raceUserChoices.tashasAbilityBonuses) {
				Object.entries(raceUserChoices.tashasAbilityBonuses).forEach(([key, value]) => {
					if (key.endsWith("_amount")) return;
					const amount = raceUserChoices.tashasAbilityBonuses[`${key}_amount`] || 0;
					addBonus(/** @type {*} */ (value), amount);
				});
			} else {
				if (race.ability) {
					race.ability.forEach(abiSet => {
						Object.entries(abiSet).forEach(([abi, bonus]) => {
							addBonus(abi, bonus);
						});
					});
				}
				if (raceUserChoices.selectedAbilityChoices) {
					Object.entries(raceUserChoices.selectedAbilityChoices).forEach(([key, value]) => {
						if (key.includes("_weight")) return;
						const bonus = raceUserChoices.selectedAbilityChoices[`${key}_weight`] || 0;
						addBonus(/** @type {*} */ (value), bonus);
					});
				}
			}
			Object.entries(totalsByAbi).forEach(([abi, total]) => {
				if (total) raceBonusParts.push(`${Parser.attAbvToFull(abi)} +${total}`);
			});
			if (raceBonusParts.length) {
				const label = raceUserChoices.useTashasRules ? "ASI (Tasha's)" : "ASI";
				items.push(`${label}: ${raceBonusParts.join(", ")}`);
			}

			if (items.length) {
				raceGrants.append(e_({outer: `<div class="ve-small ve-muted ml-2">${items.join(" · ")}</div>`}));
			}

			grants.append(raceGrants);
		}

		// Background grants
		if (background) {
			const bgGrants = e_({tag: "div", clazz: "charsheet__level-grants-section mt-1"});
			bgGrants.append(e_({outer: `<div class="ve-small ve-bold">📜 Background benefits</div>`}));

			const items = [];

			// Skill proficiencies
			if (background.skillProficiencies?.length) {
				const skills = [];
				background.skillProficiencies.forEach(sp => {
					Object.keys(sp).forEach(s => {
						if (s !== "any" && s !== "choose") skills.push((/** @type {*} */ (s)).toTitleCase());
					});
				});
				if (skills.length) items.push(`Skills: ${skills.join(", ")}`);
			}

			// Tool proficiencies — fixed + user-chosen
			const bgTools = [];
			if (background.toolProficiencies?.length) {
				background.toolProficiencies.forEach(tp => {
					Object.keys(tp).forEach(t => {
						if (t !== "any" && t !== "choose" && t !== "anyArtisansTool" && t !== "anyMusicalInstrument") bgTools.push((/** @type {*} */ (t)).toTitleCase());
					});
				});
			}
			if (bgUserChoices.selectedTools?.length) {
				bgUserChoices.selectedTools.forEach(c => {
					if (typeof c === "string") bgTools.push(c);
					else if (c.tool) bgTools.push(c.tool);
				});
			}
			if (bgTools.length) items.push(`Tools: ${bgTools.join(", ")}`);

			// Language proficiencies — fixed + user-chosen
			const bgLangs = [];
			if (background.languageProficiencies?.length) {
				background.languageProficiencies.forEach(lp => {
					Object.keys(lp).forEach(l => {
						if (l !== "anyStandard" && l !== "any" && l !== "choose") bgLangs.push((/** @type {*} */ (l)).toTitleCase());
					});
				});
			}
			if (bgUserChoices.selectedLanguages?.length) {
				bgUserChoices.selectedLanguages.forEach(c => {
					if (typeof c === "string") bgLangs.push(c);
					else if (c.language) bgLangs.push(c.language);
				});
			}
			if (bgLangs.length) items.push(`Languages: ${bgLangs.join(", ")}`);

			// Ability bonuses — fixed + user-chosen
			const bgBonusParts = [];
			if (background.ability) {
				background.ability.forEach(abiSet => {
					Object.entries(abiSet).forEach(([abi, bonus]) => {
						if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi)) {
							bgBonusParts.push(`${Parser.attAbvToFull(abi)} +${bonus}`);
						}
					});
				});
			}
			if (bgUserChoices.selectedAbilityBonuses) {
				Object.entries(bgUserChoices.selectedAbilityBonuses).forEach(([key, value]) => {
					if (!key.includes("_weight") && value && Parser.ABIL_ABVS.includes(value)) {
						const bonus = bgUserChoices.selectedAbilityBonuses[`${key}_weight`] || 0;
						if (bonus) bgBonusParts.push(`${Parser.attAbvToFull(value)} +${bonus}`);
					}
				});
			}
			if (bgBonusParts.length) items.push(`ASI: ${bgBonusParts.join(", ")}`);

			// Starting equipment
			if (background.startingEquipment?.length) {
				items.push("Starting Equipment");
			}

			if (items.length) {
				bgGrants.append(e_({outer: `<div class="ve-small ve-muted ml-2">${items.join(" · ")}</div>`}));
			}

			grants.append(bgGrants);
		}

		return grants;
	}

	/**
	 * Get list of editable choices for a level
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @returns {Array} Array of {type, label, current} objects
	 */
	_getEditableChoices (level, history) {
		const manifestDecisions = this._engine?.manifest?.decisions?.filter(decision =>
			Number(decision.characterLevel) === Number(level),
		) || [];
		if (manifestDecisions.length) {
			const editable = manifestDecisions.map(decision => {
				const out = {
					type: decision.type,
					label: decision.label,
					current: globalThis.CharacterSheetProgression.getDecisionDisplayValue(decision),
					decision,
					hasCascade: ["class", "subclass"].includes(decision.type),
					depth: decision.depth || 0,
				};
				if (decision.type === "featureChoice") {
					out.index = (history.choices?.featureChoices || []).findIndex(choice =>
						choice.featureName === decision.sourceKey,
					);
				}
				if (decision.type === "classFeatProgressionFeat") {
					out.index = (history.choices?.classFeatProgressionFeats || []).findIndex(choice =>
						choice.progressionName === decision.sourceKey,
					);
				}
				if (decision.type === "optionalFeatures") {
					out.featureTypeKey = decision.sourceKey.split("|")[0];
					out.count = decision.count;
					if (out.featureTypeKey.startsWith("CTM:")) out.editorType = "combat-methods";
				}
				return out;
			});
			const representedTypes = new Set(manifestDecisions.map(decision => decision.type));
			if (history.choices?.combatTraditions?.length && !representedTypes.has("combatTraditions")) {
				editable.push({
					type: "combatTraditions",
					label: "Combat Traditions",
					current: history.choices.combatTraditions.join(", "),
				});
			}
			if (history.choices?.weaponMasteries?.length && !representedTypes.has("weaponMasteries")) {
				editable.push({
					type: "weaponMasteries",
					label: "Weapon Masteries",
					current: history.choices.weaponMasteries.map(mastery => mastery.split("|")[0]).join(", "),
				});
			}
			const representedOptionalTypes = new Set(manifestDecisions
				.filter(decision => decision.type === "optionalFeatures")
				.map(decision => decision.sourceKey.split("|")[0]));
			const legacyOptionalByType = {};
			for (const feature of history.choices?.optionalFeatures || []) {
				const type = feature.type || "other";
				if (representedOptionalTypes.has(type)) continue;
				(legacyOptionalByType[type] ||= []).push(feature);
			}
			for (const [type, features] of Object.entries(legacyOptionalByType)) {
				editable.push({
					type: type.startsWith("CTM:") ? "combatMethods" : "optionalFeatures",
					label: CharacterSheetRespec._getOptionalFeatureTypeLabel(type),
					current: features.map(feature => feature.name).join(", "),
					featureTypeKey: type,
					count: features.length,
				});
			}
			return editable;
		}
		const editable = [];

		// NOTE: Species and Background are NOT edited here. They belong to the character base (rendered as
		// the non-removable Base card), so origin editing flows through that card's Edit buttons instead of
		// the level-1 entry. This keeps the base a single source of truth even after the origin class is
		// removed and a different class is promoted into the level-1 slot.

		// ASI is editable (separate from feat for Thelemar rule support)
		if (history.choices?.asi) {
			const asiDesc = Parser.ABIL_ABVS
				.filter(abl => history.choices.asi[abl])
				.map(abl => `${Parser.attAbvToFull(abl)} +${history.choices.asi[abl]}`)
				.join(", ") || "None";
			editable.push({
				type: "asi",
				label: "Ability Score Improvement",
				current: asiDesc,
			});
		}

		// Feat is editable (separate from ASI)
		if (history.choices?.feat) {
			editable.push({
				type: "feat",
				label: "Feat",
				current: history.choices.feat,
			});
		}

		// Feature choices are editable (fight styles, specialties, Warden, etc.)
		if (history.choices?.featureChoices && history.choices.featureChoices.length > 0) {
			history.choices.featureChoices.forEach((fc, idx) => {
				editable.push({
					type: "featureChoice",
					label: fc.featureName,
					current: fc.choice,
					index: idx,
				});
			});
		}

		// Subclass is editable (with cascade warning)
		if (history.choices?.subclass) {
			editable.push({
				type: "subclass",
				label: "Subclass",
				current: history.choices.subclass,
				hasCascade: true,
			});
		}

		if (history.choices?.combatTraditions?.length > 0) {
			editable.push({
				type: "combatTraditions",
				label: "Combat Traditions",
				current: history.choices.combatTraditions.join(", "),
			});
		}

		if (history.choices?.weaponMasteries?.length > 0) {
			editable.push({
				type: "weaponMasteries",
				label: "Weapon Masteries",
				current: history.choices.weaponMasteries.map(m => m.split("|")[0]).join(", "),
			});
		}

		// Optional features (metamagic, invocations, etc.) are editable
		if (history.choices?.optionalFeatures?.length > 0) {
			// Group by feature type for a cleaner edit UI
			const byType = {};
			for (const of of history.choices.optionalFeatures) {
				const key = of.type || "other";
				(byType[key] = byType[key] || []).push(of);
			}
			for (const [typeKey, features] of Object.entries(byType)) {
				const isCTM = typeKey.startsWith("CTM:");
				const label = CharacterSheetRespec._getOptionalFeatureTypeLabel(typeKey);
				editable.push({
					type: isCTM ? "combatMethods" : "optionalFeatures",
					label,
					current: features.map(f => f.name).join(", "),
					featureTypeKey: typeKey,
					count: features.length,
				});
			}
		}

		// Class-level featProgression feats (Fighting Style, etc.) are editable
		if (history.choices?.classFeatProgressionFeats?.length > 0) {
			history.choices.classFeatProgressionFeats.forEach((cf, idx) => {
				editable.push({
					type: "classFeatProgressionFeat",
					label: cf.progressionName || "Class Feat",
					current: cf.name,
					index: idx,
				});
			});
		}

		// Note: Skills and other level 1 choices are typically not editable
		// as they would require extensive recalculation

		return editable;
	}

	/**
	 * Show the edit modal for a level's choices
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {Array} editableChoices - Editable choices
	 */
	async _showEditModal (level, history, editableChoices) {
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Edit Level ${level} Choices`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const content = e_({tag: "div", clazz: "charsheet__respec-modal"});

		// Show current choices
		content.append(e_({outer: `<h4>Progression Decisions</h4>`}));

		const choicesList = e_({tag: "div", clazz: "charsheet__respec-choices-list"});
		const nestedEditorHost = e_({tag: "div", clazz: "charsheet__respec-nested-editor-host"});
		editableChoices.forEach(choice => {
			const currentText = typeof choice.current === "object"
				? (choice.current.name || JSON.stringify(choice.current))
				: String(choice.current);

			const status = choice.decision?.status || "resolved";
			const choiceRow = e_({outer: `
				<div class="charsheet__respec-choice-row charsheet__respec-choice-row--${status}" style="--respec-choice-depth:${Number(choice.depth) || 0}">
					<span class="charsheet__respec-choice-label">${choice.label}:</span>
					<span class="charsheet__respec-choice-current">${currentText}</span>
					<span class="charsheet__respec-choice-status">${status}</span>
					${choice.hasCascade ? `<span class="charsheet__respec-choice-warning" title="Changing this will remove dependent features">\u26a0\ufe0f</span>` : ""}
				</div>
			`});
			if (choice.decision?.id) choiceRow.dataset.decisionId = choice.decision.id;

			const editBtn = e_({tag: "button", clazz: "ve-btn ve-btn-xs ve-btn-default", txt: "Change"});
			editBtn.addEventListener("click", () => this._editChoice(level, history, choice, doClose, {
				inlineHost: nestedEditorHost,
			}));
			choiceRow.append(editBtn);

			choicesList.append(choiceRow);
		});
		content.append(choicesList);
		content.append(nestedEditorHost);

		// Close button
		const closeBtn = e_({tag: "button", clazz: "ve-btn ve-btn-primary mt-3", txt: "Close"});
		closeBtn.addEventListener("click", () => doClose());
		content.append(closeBtn);

		modalInner.append(content);
	}

	/**
	 * Edit a specific choice
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {object} choice - The choice to edit
	 * @param {Function} closeParentModal - Function to close parent modal
	 */
	async _editChoice (level, history, choice, closeParentModal, opts = {}) {
		const adapter = choice.decision
			? globalThis.CharacterSheetProgression?.getDecisionAdapter?.(choice.decision.type)
			: null;
		const editor = choice.editorType || adapter?.editor || choice.type;
		const editors = {
			race: () => this._editRace(level, history, closeParentModal),
			background: () => this._editBackground(level, history, closeParentModal),
			improvement: () => this._editImprovement(level, history, choice, closeParentModal),
			"feature-choice": () => this._editFeatureChoice(level, history, choice, closeParentModal, opts),
			subclass: () => this._editSubclass(level, history, closeParentModal),
			"combat-traditions": () => this._editCombatTraditions(level, history, choice, closeParentModal),
			"weapon-masteries": () => this._editWeaponMasteries(level, history, choice, closeParentModal),
			"combat-methods": () => this._editCombatMethods(level, history, choice, closeParentModal),
			"optional-features": () => this._editOptionalFeatures(level, history, choice, closeParentModal),
			"class-feat": () => choice.decision
				? this._editFeat(level, history, closeParentModal, choice)
				: this._editClassFeatProgressionFeat(level, history, choice, closeParentModal),
			class: () => this._editClassAllocation(level, history, choice, closeParentModal),
			"manifest-options": () => this._editManifestOptions(level, history, choice, closeParentModal),
			"nested-choice": () => this._editManifestOptions(level, history, choice, closeParentModal, opts),
			languages: () => this._editManifestOptions(level, history, choice, closeParentModal),
			spells: () => this._editManifestOptions(level, history, choice, closeParentModal),
			"spell-swap": () => this._editSpellSwapDecision(level, history, choice, closeParentModal),
			scholar: () => this._editManifestOptions(level, history, choice, closeParentModal),
			"spell-mastery": () => this._editManifestOptions(level, history, choice, closeParentModal),
			"signature-spells": () => this._editManifestOptions(level, history, choice, closeParentModal),
			"class-plan": () => this._editArtificerPlanDecision(level, history, choice, closeParentModal),
			"hit-points": () => this._editHpDecision(level, history, choice, closeParentModal),
			asi: () => this._editAsi(level, history, closeParentModal, choice),
			feat: () => this._editFeat(level, history, closeParentModal, choice),
			featureChoice: () => this._editFeatureChoice(level, history, choice, closeParentModal, opts),
			combatTraditions: () => this._editCombatTraditions(level, history, choice, closeParentModal),
			weaponMasteries: () => this._editWeaponMasteries(level, history, choice, closeParentModal),
			combatMethods: () => this._editCombatMethods(level, history, choice, closeParentModal),
			optionalFeatures: () => this._editOptionalFeatures(level, history, choice, closeParentModal),
			classFeatProgressionFeat: () => this._editClassFeatProgressionFeat(level, history, choice, closeParentModal),
		};
		const edit = editors[editor];
		if (!edit) {
			JqueryUtil.doToast({type: "warning", content: "Editing this choice type is not yet implemented."});
			return;
		}
		await edit();
	}

	async _editArtificerPlanDecision (level, history, choice, closeParentModal) {
		const decision = choice.decision;
		const picker = globalThis.CharacterSheetArtificerPlanPicker;
		const plans = globalThis.CharacterSheetArtificerPlans;
		if (!decision || !picker || !plans) {
			JqueryUtil.doToast({type: "danger", content: "The Replicate Magic Item plan editor is unavailable."});
			return;
		}
		const ordered = (this._engine?.manifest?.decisions || [])
			.filter(candidate => [
				plans.DECISION_TYPE_ACQUIRE,
				plans.DECISION_TYPE_REPLACE,
			].includes(candidate.type))
			.sort((a, b) =>
				Number(a.classLevel) - Number(b.classLevel)
				|| Number(a.type === plans.DECISION_TYPE_REPLACE) - Number(b.type === plans.DECISION_TYPE_REPLACE)
				|| Number(a.slot) - Number(b.slot),
			);
		const activeIndex = ordered.findIndex(candidate => candidate.semanticKey === decision.semanticKey);
		const toPlanDraft = candidate => ({
			...candidate,
			kind: candidate.meta?.kind,
			opportunityId: candidate.meta?.opportunityId,
			slotId: candidate.meta?.slotId,
		});
		const projectedBefore = plans.projectDecisions({
			decisions: ordered.slice(0, Math.max(0, activeIndex)).map(toPlanDraft),
		}).slots;
		const projectedCurrent = plans.projectDecisions({
			decisions: ordered.map(toPlanDraft),
		}).slots;
		const initialSlots = decision.type === plans.DECISION_TYPE_ACQUIRE
			? projectedCurrent.filter(slot => slot.slotId !== decision.meta?.slotId)
			: projectedBefore;
		const opportunity = {
			version: 1,
			kind: decision.meta?.kind,
			required: decision.required,
			className: decision.className,
			classSource: decision.classSource,
			classLevel: decision.classLevel,
			characterLevel: decision.characterLevel,
			slot: decision.slot,
			slotId: decision.meta?.slotId,
			opportunityId: decision.meta?.opportunityId,
			owner: decision.meta?.owner,
			constraints: decision.meta?.constraints || {},
		};
		const result = await picker.pGetUserDecisions({
			page: this._page,
			state: this._state,
			opportunities: [opportunity],
			initialSlots,
			initialSelections: decision.selection
				? {[opportunity.opportunityId]: decision.selection}
				: {},
			title: `${decision.label} · Level ${level}`,
		});
		if (result == null) return;
		const selection = result[0]?.selection || null;
		await this._engine.stageGraphMutation(decision.id, selection, {
			status: selection == null && !decision.required ? "deferred" : null,
			reverseParent: true,
			apply: () => ({selection}),
		});
		closeParentModal?.();
		this.render();
		JqueryUtil.doToast({type: "success", content: `${decision.label} staged in the Respec draft.`});
	}

	_getDecisionOptions (decision) {
		let options = [...(decision.options || [])];
		const isNestedSpell = ["nestedSpell", "nestedCantrip"].includes(decision.type);
		if (isNestedSpell) {
			const source = decision.meta?.descriptorRules?.optionSource;
			const allSpells = this._page.getFilteredSpellData?.() || this._page.getSpells?.() || [];
			const exactSource = source?.spellSource || null;
			if (source?.kind === "filter" && source.filter) {
				const clauses = CharacterSheetClassUtils._parseFilterQuery?.(source.filter) || [];
				options = allSpells.filter(spell =>
					(!exactSource || spell.source === exactSource)
					&& CharacterSheetClassUtils._spellMatchesFilterQuery?.(spell, clauses),
				);
			} else if (source?.kind === "additionalSpells" && allSpells.length) {
				options = exactSource ? allSpells.filter(spell => spell.source === exactSource) : allSpells;
			} else if (source?.kind === "explicitList" && Array.isArray(source.values)) {
				const fullSpellData = this._page.getSpells?.() || allSpells;
				options = source.values
					.map(value => {
						const name = typeof value === "string" ? value : value?.name;
						const sourceId = typeof value === "object" ? value?.source : null;
						return fullSpellData.find(spell =>
							spell?.name === name
								&& (sourceId ? spell.source === sourceId : (!exactSource || spell.source === exactSource)),
						) || value;
					})
					.filter(Boolean);
			}
			if (decision.type === "nestedCantrip") options = options.filter(spell => Number(spell.level) === 0);
			else options = options.filter(spell => Number(spell.level) > 0);
		} else if (["knownSpells", "preparedSpells", "spellbookSpells", "cantrips", "preparedCantrips", "spellMastery", "signatureSpells", "spellSwap"].includes(decision.type)) {
			const classData = this._page.getClasses?.().find(cls =>
				cls.name === decision.className && cls.source === decision.classSource,
			) || this._page.getClasses?.().find(cls => cls.name === decision.className);
			const classEntry = this._state.getClasses().find(cls => cls.name === decision.className && cls.source === decision.classSource)
				|| this._state.getClasses().find(cls => cls.name === decision.className);
			const maxSpellLevel = decision.meta?.maxSpellLevel;
			options = options.filter(spell => {
				if (decision.type === "cantrips" || decision.type === "preparedCantrips") {
					if (spell.level !== 0) return false;
				} else if (!Number.isFinite(Number(spell.level)) || spell.level < 1) return false;
				if (maxSpellLevel != null && spell.level > maxSpellLevel) return false;
				return CharacterSheetClassUtils.spellIsAvailableForClass(spell, {
					className: decision.className,
					classSource: decision.classSource,
					subclass: classEntry?.subclass,
					subclassChoice: classEntry?.subclassChoice,
					additionalClassNames: decision.meta?.additionalClassNames || [],
					includeCoreSpellsForHomebrew: !["PHB", "XPHB"].includes(classData?.source),
				});
			});
		}
		return options;
	}

	static _getDecisionOptionKey (option) {
		if (typeof option === "string") return option.toLowerCase();
		return `${option?.name || option?.choice || option?.label || JSON.stringify(option)}|${option?.source || ""}`.toLowerCase();
	}

	static _getDecisionOptionLabel (option) {
		if (typeof option === "string") return (/** @type {*} */ (option)).toTitleCase();
		const source = option?.source ? ` (${Parser.sourceJsonToAbv(option.source)})` : "";
		return `${option?.name || option?.choice || option?.label || "Option"}${source}`;
	}

	static _toDecisionSelectionValue (option) {
		if (typeof option === "string") {
			return option;
		}
		if (option?.name) {
			return {
				name: option.name,
				source: option.source,
				...(option.level != null ? {level: option.level} : {}),
				...(option.shortName ? {shortName: option.shortName} : {}),
			};
		}
		return MiscUtil.copyFast(option);
	}

	static _getDecisionEditorOptions (legalOptions, currentValues) {
		const out = [...legalOptions];
		const seen = new Set(out.map(option => CharacterSheetRespec._getDecisionOptionKey(option)));
		const invalidOptionKeys = new Set();
		for (const value of currentValues) {
			const key = CharacterSheetRespec._getDecisionOptionKey(value);
			if (seen.has(key)) continue;
			seen.add(key);
			invalidOptionKeys.add(key);
			out.push(MiscUtil.copyFast(value));
		}
		return {options: out, invalidOptionKeys};
	}

	async _editManifestOptions (level, history, choice, closeParentModal, {inlineHost = null} = {}) {
		const decision = choice.decision;
		if (!decision) return;
		const legalOptions = this._getDecisionOptions(decision);
		const selected = new Map();
		const currentValues = Array.isArray(decision.selection)
			? decision.selection
			: (decision.selection == null ? [] : [decision.selection]);
		currentValues.forEach(value => selected.set(CharacterSheetRespec._getDecisionOptionKey(value), value));
		const {options, invalidOptionKeys} = CharacterSheetRespec._getDecisionEditorOptions(legalOptions, currentValues);
		const getOptionLabel = option => decision.type === "nestedAbility" && typeof option === "string"
			? Parser.attAbvToFull(option)
			: CharacterSheetRespec._getDecisionOptionLabel(option);

		let modalInner;
		let doClose;
		if (inlineHost) {
			inlineHost.innerHTML = "";
			modalInner = inlineHost;
			doClose = () => inlineHost.replaceChildren();
		} else {
			const modal = await CharacterSheetModal.pGetShow({
				title: decision.scope === "unplaced"
					? `${decision.label} · Character Base`
					: `${decision.label} · Level ${level}`,
				isMinHeight0: true,
				isWidth100: true,
				isUncappedWidth: true,
				cbClose: () => {},
			});
			modalInner = modal.eleModalInner;
			doClose = modal.doClose;
		}
		const content = e_({tag: "div", clazz: "charsheet__respec-decision-editor"});
		content.append(e_({
			tag: "p",
			clazz: "ve-muted",
			txt: `Choose ${decision.count} option${decision.count === 1 ? "" : "s"}. ${decision.required ? "This decision is required." : "You may leave it deferred."}`,
		}));
		const search = e_({tag: "input", clazz: "ve-form-control mb-2"});
		search.type = "search";
		search.placeholder = `Search ${decision.label.toLowerCase()}...`;
		search.setAttribute("aria-label", `Search ${decision.label}`);
		content.append(search);

		const count = e_({tag: "div", clazz: "charsheet__respec-selection-count", txt: `${selected.size}/${decision.count} selected`});
		const list = e_({tag: "div", clazz: "charsheet__respec-option-list"});
		content.append(count, list);

		const renderOptions = () => {
			list.innerHTML = "";
			const query = search.value.trim().toLowerCase();
			const filtered = options.filter(option => getOptionLabel(option).toLowerCase().includes(query));
			filtered.slice(0, 150).forEach(option => {
				const key = CharacterSheetRespec._getDecisionOptionKey(option);
				const row = e_({tag: "label", clazz: "charsheet__respec-option"});
				const input = e_({tag: "input"});
				input.type = decision.count === 1 ? "radio" : "checkbox";
				input.name = `respec-${decision.id}`;
				if (option?.source) input.dataset.source = option.source;
				input.checked = selected.has(key);
				const label = e_({
					tag: "span",
					txt: `${getOptionLabel(option)}${invalidOptionKeys.has(key) ? " — currently selected, no longer legal" : ""}`,
				});
				input.addEventListener("change", () => {
					if (decision.count === 1) selected.clear();
					if (input.checked) {
						if (selected.size >= decision.count) {
							input.checked = false;
							return;
						}
						selected.set(key, CharacterSheetRespec._toDecisionSelectionValue(option));
					} else selected.delete(key);
					count.textContent = `${selected.size}/${decision.count} selected`;
					if (decision.count === 1) renderOptions();
				});
				row.append(input, label);
				list.append(row);
			});
			if (filtered.length > 150) {
				list.append(e_({tag: "p", clazz: "ve-muted ve-small", txt: `${filtered.length - 150} more results. Refine the search to narrow the list.`}));
			}
			if (!filtered.length) list.append(e_({tag: "p", clazz: "ve-muted", txt: "No legal options match this search."}));
		};
		search.addEventListener("input", renderOptions);
		renderOptions();

		const actions = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancel.addEventListener("click", () => doClose());
		if (!decision.required) {
			const defer = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Defer"});
			defer.addEventListener("click", () => {
				this._engine.updateDecisionSelection(decision.id, null, {status: "deferred"});
				doClose();
				if (!inlineHost) closeParentModal?.();
				this.render();
			});
			actions.append(defer);
		}
		const apply = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "Stage Choice"});
		apply.addEventListener("click", async () => {
			if (selected.size !== decision.count) {
				JqueryUtil.doToast({type: "warning", content: `Choose exactly ${decision.count} option${decision.count === 1 ? "" : "s"}.`});
				return;
			}
			const values = [...selected.values()];
			const selection = ["scholar", "subclassChoice"].includes(decision.type) && decision.count === 1
				? values[0]
				: values;
			const setOwnedSpellTypes = new Set([
				"knownSpells", "preparedSpells", "spellbookSpells", "cantrips",
				"preparedCantrips", "nestedSpell", "nestedCantrip",
			]);
			await this._engine.stageGraphMutation(decision.id, selection, {
				reverseParent: !setOwnedSpellTypes.has(decision.type),
				apply: ({state}) => this._applyManifestSelectionMechanics(decision, selection, legalOptions, state),
			});
			doClose();
			if (!inlineHost) closeParentModal?.();
			this.render();
			JqueryUtil.doToast({type: "success", content: `${decision.label} staged in the Respec draft.`});
		});
		actions.append(cancel, apply);
		content.append(actions);
		modalInner.append(content);
		search.focus();
	}

	_applyManifestSelectionMechanics (decision, selection, options, targetState = this._state) {
		const family = this._getDecisionMechanicsFamily(decision);
		const method = {
			class: "_applyDecisionMechanicsClass",
			proficiencies: "_applyDecisionMechanicsProficiencies",
			spells: "_applyDecisionMechanicsSpells",
			improvement: "_applyDecisionMechanicsImprovement",
			features: "_applyDecisionMechanicsFeatures",
			origin: "_applyDecisionMechanicsOrigin",
			configuration: "_applyDecisionMechanicsConfiguration",
		}[family] || "_applyDecisionMechanicsConfiguration";
		if (method !== "_applyManifestSelectionMechanics") {
			return this[method](decision, selection, options, targetState);
		}
		return this._runDecisionMechanics(decision, selection, options, targetState);
	}

	_getDecisionMechanicsFamily (decision) {
		const type = decision?.type;
		if (["class", "subclass", "subclassChoice"].includes(type)) return "class";
		if ([
			"skills", "tools", "expertise", "languages", "nestedSkill",
			"nestedSkillTool", "nestedExpertise", "nestedTool", "nestedLanguage",
			"nestedSave", "nestedWeapon", "nestedArmor", "nestedResistance",
			"nestedDamageType",
		].includes(type)) return "proficiencies";
		if ([
			"spellbookSpells", "knownSpells", "cantrips", "preparedSpells",
			"preparedCantrips", "spellSwap", "spellMastery", "signatureSpells",
			"nestedSpell", "nestedCantrip",
		].includes(type)) return "spells";
		if (["asi", "feat", "asiOrFeat", "classFeatProgressionFeat"].includes(type)) return "improvement";
		if (["optionalFeatures", "featureChoice", "nestedEntity", "nestedFeat", "nestedOptionalFeature"].includes(type)) return "features";
		if (["originRace", "originBackground"].includes(type)) return "origin";
		return "configuration";
	}

	_runDecisionMechanics (decision, selection, options, targetState = this._state, expectedFamily = null) {
		if (expectedFamily && this._getDecisionMechanicsFamily(decision) !== expectedFamily) {
			throw new Error(`Progression decision "${decision?.type || "unknown"}" was routed to the wrong mechanics family.`);
		}
		const previousState = this._state;
		this._state = targetState;
		try {
			return this._applyManifestSelectionMechanicsInner(decision, selection, options, expectedFamily);
		} finally {
			this._state = previousState;
		}
	}

	// Concrete adapter entry points. Each family is a real dispatch target used
	// by the generic editor above; these are intentionally not aliases of the
	// generic method so adapter closure verifies the executable paths.
	_applyDecisionMechanicsClass (decision, selection, options, targetState = this._state) {
		return this._runDecisionMechanics(decision, selection, options, targetState, "class");
	}

	_applyDecisionMechanicsProficiencies (decision, selection, options, targetState = this._state) {
		return this._runDecisionMechanics(decision, selection, options, targetState, "proficiencies");
	}

	_applyDecisionMechanicsSpells (decision, selection, options, targetState = this._state) {
		return this._runDecisionMechanics(decision, selection, options, targetState, "spells");
	}

	_applyDecisionMechanicsImprovement (decision, selection, options, targetState = this._state) {
		return this._runDecisionMechanics(decision, selection, options, targetState, "improvement");
	}

	_applyDecisionMechanicsFeatures (decision, selection, options, targetState = this._state) {
		return this._runDecisionMechanics(decision, selection, options, targetState, "features");
	}

	_applyDecisionMechanicsOrigin (decision, selection, options, targetState = this._state) {
		return this._runDecisionMechanics(decision, selection, options, targetState, "origin");
	}

	_applyDecisionMechanicsConfiguration (decision, selection, options, targetState = this._state) {
		return this._runDecisionMechanics(decision, selection, options, targetState, "configuration");
	}

	_applyManifestSelectionMechanicsInner (decision, selection, options, family = null) {
		if (family && this._getDecisionMechanicsFamily(decision) !== family) {
			throw new Error(`Progression decision "${decision?.type || "unknown"}" has no ${family} mechanics.`);
		}
		const next = Array.isArray(selection) ? selection : (selection == null ? [] : [selection]);
		const previous = Array.isArray(decision.selection)
			? decision.selection
			: (decision.selection == null ? [] : [decision.selection]);
		const nextKeys = new Set(next.map(CharacterSheetRespec._getDecisionOptionKey));
		const findFull = selected => options.find(option =>
			CharacterSheetRespec._getDecisionOptionKey(option) === CharacterSheetRespec._getDecisionOptionKey(selected),
		) || selected;
		const release = (type, value, fnRemove) => {
			if (this._state.releaseProgressionOwnership(type, value, decision.semanticKey)) fnRemove();
		};
		const claim = (type, value) => this._state.claimProgressionOwnership(type, value, decision.semanticKey);

		const valueName = value => typeof value === "string"
			? value
			: (value?.name || value?.choice || value?.value || "");
		const normalizeSkill = value => this._state.normalizeSkillProficiencyKey?.(valueName(value))
			|| String(valueName(value) || "").toLowerCase().replace(/\s+/g, "");
		const normalizeValue = value => String(valueName(value) || "").trim().toLowerCase();
		if ([
			globalThis.CharacterSheetArtificerPlans?.DECISION_TYPE_ACQUIRE,
			globalThis.CharacterSheetArtificerPlans?.DECISION_TYPE_REPLACE,
		].includes(decision.type)) return;
		const removeSetValue = (type, value, remove) => {
			release(type, value, remove);
		};
		const applySetChoice = (type, add, remove) => {
			previous
				.filter(value => !nextKeys.has(CharacterSheetRespec._getDecisionOptionKey(value)))
				.forEach(value => removeSetValue(type, value, () => remove(value)));
			next.forEach(value => {
				claim(type, value);
				add(value);
			});
		};

		const nestedSetHandlers = {
			nestedSkill: {
				type: "skills",
				add: value => {
					const skill = normalizeSkill(value);
					if (skill && this._state.getSkillProficiency(skill) < 1) this._state.addSkillProficiency(skill);
				},
				remove: value => {
					const skill = normalizeSkill(value);
					if (skill) this._state.setSkillProficiency(skill, 0);
				},
			},
			nestedSkillTool: {
				type: "skills",
				add: value => {
					const skill = normalizeSkill(value);
					if (skill && this._state.getSkillProficiency(skill) < 1) this._state.addSkillProficiency(skill);
				},
				remove: value => {
					const skill = normalizeSkill(value);
					if (skill) this._state.setSkillProficiency(skill, 0);
				},
			},
			nestedExpertise: {
				type: "expertise",
				add: value => this._state.addExpertise(normalizeSkill(value)),
				remove: value => {
					const skill = normalizeSkill(value);
					if (!skill) return;
					if (!decision.meta?.unplacedFeatExpertise) {
						this._state.setSkillProficiency(skill, 1);
						return;
					}
					const skillOwnership = this._state._getProgressionOwnershipEntry?.("skills", skill);
					this._state.setSkillProficiency(
						skill,
						skillOwnership?.preserved || skillOwnership?.sources?.length ? 1 : 0,
					);
				},
			},
			nestedTool: {
				type: "tools",
				add: value => this._state.addToolProficiency(valueName(value)),
				remove: value => this._state.removeToolProficiency(valueName(value)),
			},
			nestedLanguage: {
				type: "languages",
				add: value => this._state.addLanguage(valueName(value)),
				remove: value => this._state.removeLanguage(valueName(value)),
			},
			nestedSave: {
				type: "saves",
				add: value => this._state.addSaveProficiency(normalizeValue(value)),
				remove: value => this._state.removeSaveProficiency(normalizeValue(value)),
			},
			nestedWeapon: {
				type: "weapons",
				add: value => this._state.addWeaponProficiency(valueName(value)),
				remove: value => this._state.removeWeaponProficiency(valueName(value)),
			},
			nestedArmor: {
				type: "armor",
				add: value => this._state.addArmorProficiency(valueName(value)),
				remove: value => this._state.removeArmorProficiency(valueName(value)),
			},
			nestedResistance: {
				type: "resistances",
				add: value => this._state.addResistance(valueName(value)),
				remove: value => this._state.removeResistance(valueName(value)),
			},
			nestedDamageType: {
				type: "resistances",
				add: value => this._state.addResistance(valueName(value)),
				remove: value => this._state.removeResistance(valueName(value)),
			},
		};
		if (decision.type === "nestedSkillBonus") {
			const rules = decision.meta?.descriptorRules || {};
			const sourceDecisionKey = decision.semanticKey;
			const remove = () => this._state.removeModifiersBySourceDecision?.(sourceDecisionKey);
			const ownerName = String(decision.label || "Skill Bonus").replace(/\s+Skill Bonus$/i, "");
			const toTitleCase = value => String(value || "")
				.split(/\s+/)
				.map(part => part ? `${part[0].toUpperCase()}${part.slice(1)}` : "")
				.join(" ");
			remove();
			next.forEach(value => {
				const skill = normalizeSkill(value);
				if (!skill) return;
				this._state.addNamedModifier({
					name: `${ownerName} (${toTitleCase(valueName(value))})`,
					type: `skill:${skill}`,
					value: 0,
					...(rules.bonusFormula === "proficiencyBonus"
						? {proficiencyBonus: true}
						: {
							abilityMod: rules.bonusAbility || "wis",
							minValue: Number(rules.minValue) || 0,
						}),
					sourceDecisionKey,
					sourceType: "progression",
					note: `From ${ownerName}`,
					enabled: true,
				});
			});
			return;
		}
		const nestedSet = nestedSetHandlers[decision.type];
		if (decision.type === "nestedSkillTool") {
			const getKind = value => String(value?.kind || "skill").toLowerCase();
			const getValue = value => value?.value ?? value?.name ?? value;
			const getType = value => {
				const kind = getKind(value);
				return kind === "tool" ? "tools" : kind === "language" ? "languages" : "skills";
			};
			previous
				.filter(value => !nextKeys.has(CharacterSheetRespec._getDecisionOptionKey(value)))
				.forEach(value => release(getType(value), getValue(value), () => {
					if (getType(value) === "skills") this._state.setSkillProficiency(normalizeSkill(getValue(value)), 0);
					else if (getType(value) === "tools") this._state.removeToolProficiency(getValue(value));
					else this._state.removeLanguage(getValue(value));
				}));
			next.forEach(value => {
				const type = getType(value);
				const selected = getValue(value);
				claim(type, selected);
				if (type === "skills") this._state.addSkillProficiency(normalizeSkill(selected));
				else if (type === "tools") this._state.addToolProficiency(selected);
				else this._state.addLanguage(selected);
			});
			return;
		}
		if (nestedSet) {
			const fixedProficiencyFallback = decision.type === "nestedTool"
				? this._state.getFixedProficiencyFallbackTransaction?.(decision.provenance?.ownerUid)
				: null;
			if (fixedProficiencyFallback?.mode === "fallback") {
				const selected = next.length === 1 ? valueName(next[0]) : null;
				if (selected) {
					this._state.setFixedProficiencyFallbackSelection(
						decision.provenance.ownerUid,
						selected,
						{decisionSemanticKey: decision.semanticKey},
					);
				}
				return;
			}
			const pendingFeatureChoice = decision.type === "nestedTool" && decision.parentSemanticKey
				? this._state._data?.pendingFeatureChoices?.find(choice =>
					choice.kind === "tool"
						&& choice.sourceDecisionKey === decision.parentSemanticKey
						&& (!decision.provenance?.ownerUid || choice.featureUid === decision.provenance.ownerUid),
				)
				: null;
			const featureChoiceOwner = decision.type === "nestedTool" && decision.provenance?.ownerUid
				? this._state._data.features.find(feature =>
					CharacterSheetProgression.getFeatureOwnerUid(feature) ===
						CharacterSheetProgression._normalize(decision.provenance.ownerUid),
				)
				: null;
			const nextToolsOwnedBefore = decision.type === "nestedTool"
				? new Set(next
					.filter(value => this._state.hasToolProficiency(valueName(value)))
					.map(value => CharacterSheetState.normalizeToolKey(valueName(value))))
				: new Set();
			const beforeLevels = Object.fromEntries(
				[...previous, ...next].map(value => {
					const skill = ["nestedSkill", "nestedExpertise"].includes(decision.type)
						? normalizeSkill(value)
						: normalizeValue(value);
					return [skill, skill ? this._state.getSkillProficiency(skill) : 0];
				}),
			);
			applySetChoice(nestedSet.type, nestedSet.add, nestedSet.remove);
			if (pendingFeatureChoice) {
				this._state._recordFulfilledFeatureToolChoice?.(pendingFeatureChoice);
				this._state.removePendingFeatureChoice?.(pendingFeatureChoice.id);
			}
			if (decision.type === "nestedTool") this._state.syncConditionalToolGrantSelection?.(decision, next);
			if (featureChoiceOwner) {
				const sourceId = `feature-choice:${featureChoiceOwner.id}`;
				const previousKeys = new Set(previous.map(value => CharacterSheetState.normalizeToolKey(valueName(value))));
				for (const value of previous) this._state._untrackGrantedProficiency("tools", valueName(value), sourceId);
				for (const value of next) {
					const tool = valueName(value);
					const key = CharacterSheetState.normalizeToolKey(tool);
					if (nextToolsOwnedBefore.has(key)
						&& !this._state._data.grantedProficiencies?.tools?.[key]?.length) {
						this._state._trackGrantedProficiency("tools", tool, "base");
					}
					this._state._trackGrantedProficiency("tools", tool, sourceId);
				}
				featureChoiceOwner._choices = [
					...(featureChoiceOwner._choices || []).filter(choice =>
						choice?.type !== "tool"
							|| !previousKeys.has(CharacterSheetState.normalizeToolKey(choice.value)),
					),
					...next.map(value => ({type: "tool", value: valueName(value)})),
				];
			}
			if (decision.meta?.unplacedFeatChoice && ["nestedSkill", "nestedExpertise"].includes(decision.type)) {
				const parent = this._engine?.manifest?.decisions?.find(candidate =>
					candidate.semanticKey === decision.rootSemanticKey,
				);
				const feat = this._state._data.feats.find(candidate =>
					candidate.id === parent?.meta?.featId
						|| candidate.sourceDecisionKey === parent?.semanticKey,
				);
				const choiceKey = decision.meta.featChoiceKey;
				if (feat && choiceKey) {
					const selectedValues = choiceKey === "expertise"
						? next.map(normalizeSkill)
						: next.map(valueName);
					feat.choices = {...(feat.choices || {}), [choiceKey]: selectedValues};
					feat._featChoices = {...(feat._featChoices || feat.choices), [choiceKey]: selectedValues};
					feat.appliedEffects ||= {};
					feat.appliedEffects.skillProficiencies ||= {};
					const otherChoiceKey = choiceKey === "skills" ? "expertise" : "skills";
					const stillSelected = new Set([
						...selectedValues,
						...(feat.choices?.[otherChoiceKey] || []),
					].map(normalizeSkill));
					for (const value of previous) {
						const skill = normalizeSkill(value);
						if (skill && !stillSelected.has(skill)) delete feat.appliedEffects.skillProficiencies[skill];
					}
					for (const skill of stillSelected) {
						const existing = feat.appliedEffects.skillProficiencies[skill];
						feat.appliedEffects.skillProficiencies[skill] = {
							before: existing?.before ?? beforeLevels[skill] ?? 0,
							after: this._state.getSkillProficiency(skill),
						};
					}
				}
			}
			return;
		}

		if (["nestedSpell", "nestedCantrip"].includes(decision.type)) {
			const isCantrip = decision.type === "nestedCantrip";
			const type = isCantrip ? "cantrips" : "spells";
			const previousKeys = new Set(previous.map(CharacterSheetRespec._getDecisionOptionKey));
			previous.filter(value => !nextKeys.has(CharacterSheetRespec._getDecisionOptionKey(value)))
				.forEach(value => release(type, value, () => this._state.removeSpell(value?.name || value, value?.source)));
			next.filter(value => !previousKeys.has(CharacterSheetRespec._getDecisionOptionKey(value))).forEach(value => {
				const spell = findFull(value);
				if (!spell?.name) return;
				claim(type, spell);
				const built = isCantrip
					? CharacterSheetClassUtils.buildCantripStateObject(spell, {
						sourceFeature: decision.provenance?.ownerUid || decision.label,
						sourceClass: decision.className,
						sourceClassSource: decision.classSource,
					})
					: CharacterSheetClassUtils.buildSpellStateObject(spell, {
						sourceFeature: decision.provenance?.ownerUid || decision.label,
						sourceClass: decision.className,
						sourceClassSource: decision.classSource,
						prepared: decision.meta?.spellMode === "prepared",
					});
				if (isCantrip) this._state.addCantrip(built);
				else this._state.addSpell(built);
			});
			return;
		}

		if (decision.type === "nestedAbility" || decision.type === "nestedConfiguration") {
			if (decision.type === "nestedAbility") {
				const amount = Number(decision.meta?.descriptorRules?.amount) || 1;
				const isOriginAbility = decision.scope === "origin"
					&& ["race", "background"].includes(decision.provenance?.ownerType);
				next.forEach(value => {
					const ability = String(value || "").toLowerCase();
					if (!ability) return;
					if (isOriginAbility) {
						const before = Number(this._state._data.abilityBonuses?.[ability]) || 0;
						decision.meta ||= {};
						decision.meta.receiptPreviousAbilityBonus ||= {};
						if (decision.meta.receiptPreviousAbilityBonus[ability] == null) {
							decision.meta.receiptPreviousAbilityBonus[ability] = before;
						}
						this._state.setAbilityBonus(ability, before + amount);
						if (decision.provenance?.ownerType === "race") {
							const race = this._state.getRace?.();
							const choices = MiscUtil.copyFast(this._state.getBaseRaceUserChoices?.() || {});
							choices.selectedAbilityChoices ||= {};
							const ownerUid = CharacterSheetProgression.getEntityUid(race);
							const ownerKey = Object.keys(choices.selectedAbilityChoices)
								.find(key => CharacterSheetProgression._normalize(key) === ownerUid)
								|| `${race?.name || ""}|${race?.source || ""}`;
							const ownerChoices = choices.selectedAbilityChoices[ownerKey] = {
								...(choices.selectedAbilityChoices[ownerKey] || {}),
							};
							const choiceIndex = Number(String(decision.provenance?.sourcePath || "")
								.match(/ability\[(\d+)\]/)?.[1] || 0);
							ownerChoices[`choose_${choiceIndex}_0`] = ability;
							ownerChoices[`choose_${choiceIndex}_0_amount`] = amount;
							this._state.setBaseRaceUserChoices(choices);
						} else if (decision.provenance?.ownerType === "background") {
							const choices = MiscUtil.copyFast(this._state.getBaseBackgroundUserChoices?.() || {});
							const selectionKey = decision.meta?.originAbilitySelectionKey;
							if (selectionKey) {
								choices.selectedAbilityBonuses ||= {};
								choices.selectedAbilityBonuses[selectionKey] = ability;
								choices.selectedAbilityBonuses[`${selectionKey}_weight`] = amount;
								this._state.setBaseBackgroundUserChoices(choices);
							}
						}
						return;
					}
					const before = this._state.getAbilityBase(ability) || 0;
					decision.meta ||= {};
					decision.meta.receiptPreviousAbility ||= {};
					if (decision.meta.receiptPreviousAbility[ability] == null) {
						decision.meta.receiptPreviousAbility[ability] = before;
					}
					const cap = Number(decision.meta?.descriptorRules?.max) || 20;
					const after = CharacterSheetClassUtils.capAbilityIncrease(before, amount, cap);
					this._state.setAbilityBase(ability, after);
					const parent = this._engine?.manifest?.decisions?.find(candidate =>
						candidate.semanticKey === decision.parentSemanticKey,
					);
					const isUnplacedFeat = parent?.type === "nestedFeat" && parent.meta?.unplacedFeat;
					if (!["feat", "asiOrFeat"].includes(parent?.type) && !isUnplacedFeat) return;
					const feat = this._state._data.feats.find(candidate =>
						candidate.sourceDecisionKey === parent.semanticKey
							|| (isUnplacedFeat && candidate.id === parent.meta?.featId),
					);
					if (!feat) return;
					for (const previousValue of previous) {
						delete feat.appliedEffects?.abilityDeltas?.[String(previousValue || "").toLowerCase()];
					}
					feat.choices = {...(feat.choices || {}), ability};
					feat._featChoices = {...(feat._featChoices || feat.choices), ability};
					feat.appliedEffects ||= {};
					feat.appliedEffects.abilityDeltas = {
						...(feat.appliedEffects.abilityDeltas || {}),
						[ability]: after - before,
					};
				});
			}
			return;
		}

		if (decision.type === "nestedEntity" || decision.type === "nestedOptionalFeature" || decision.type === "nestedFeat") {
			const ownerUid = decision.provenance?.ownerUid || "";
			const [parentName, parentSource] = ownerUid.split("|");
			if (parentName) {
				this._state.removeChosenSubfeature?.(parentName, {
					parentSource,
					level: decision.classLevel || decision.characterLevel,
					sourceDecisionKey: decision.semanticKey,
					parentSourceDecisionKey: decision.parentSemanticKey || null,
				});
			}
			const selected = next[0];
			if (selected?.name) {
				const option = options.find(it => CharacterSheetRespec._getDecisionOptionKey(it) === CharacterSheetRespec._getDecisionOptionKey(selected)) || selected;
				this._state._applyChosenSubfeatureOption?.({
					parent: parentName || decision.label,
					parentSource,
					level: decision.classLevel || decision.characterLevel,
					sourceDecisionKey: decision.semanticKey,
				}, option);
			}
			return;
		}

		if (decision.type === "skills") {
			previous.filter(value => !nextKeys.has(CharacterSheetRespec._getDecisionOptionKey(value)))
				.forEach(value => release("skills", value, () => this._state.setSkillProficiency(normalizeSkill(value), 0)));
			next.forEach(value => {
				claim("skills", value);
				const skill = normalizeSkill(value);
				if (this._state.getSkillProficiency(skill) < 1) this._state.addSkillProficiency(skill);
			});
		}
		if (decision.type === "expertise") {
			const toolName = decision.meta?.allowTools ? decision.meta?.toolName : null;
			const isTool = value => toolName
				&& CharacterSheetRespec._getDecisionOptionKey(value) === CharacterSheetRespec._getDecisionOptionKey(toolName);
			previous.filter(value => !nextKeys.has(CharacterSheetRespec._getDecisionOptionKey(value)))
				.forEach(value => release("expertise", value, () => {
					if (!isTool(value)) this._state.setSkillProficiency(normalizeSkill(value), 1);
				}));
			next.forEach(value => {
				claim("expertise", value);
				if (!isTool(value)) this._state.addExpertise(normalizeSkill(value));
			});
		}
		if (decision.type === "tools") {
			previous.filter(value => !nextKeys.has(CharacterSheetRespec._getDecisionOptionKey(value)))
				.forEach(value => release("tools", value, () => this._state.removeToolProficiency(value)));
			next.forEach(value => {
				claim("tools", value);
				this._state.addToolProficiency(value);
			});
		}
		if (decision.type === "languages") {
			previous.filter(value => !nextKeys.has(CharacterSheetRespec._getDecisionOptionKey(value)))
				.forEach(value => release("languages", value, () => this._state.removeLanguage(value)));
			next.forEach(value => {
				claim("languages", value);
				this._state.addLanguage(value);
			});
		}
		if (decision.type === "subclassChoice") {
			this._state.setSubclassChoice(decision.className, next[0] || null);
			this._state.reconcileSubclassFeatureEntries?.();
			this._state.populateSubclassSpells?.();
			this._state.applyClassFeatureEffects?.();
			this._state.calculateSpellSlots?.();
			return;
		}
		if (decision.type === "scholar") this._state.setScholarExpertise(next[0] || null);
		if (decision.type === "spellMastery") {
			this._state.setSpellMasterySpells(next);
			return;
		}
		if (decision.type === "signatureSpells") {
			this._state.setSignatureSpells(next);
			return;
		}

		const spellTypes = new Set(["knownSpells", "preparedSpells", "spellbookSpells", "cantrips", "preparedCantrips"]);
		if (!spellTypes.has(decision.type)) {
			return;
		}
		previous.filter(value => !nextKeys.has(CharacterSheetRespec._getDecisionOptionKey(value)))
			.forEach(value => {
				const type = ["cantrips", "preparedCantrips"].includes(decision.type) ? "cantrips" : "spells";
				release(type, value, () => this._state.removeSpell(value.name, value.source));
			});
		const added = next.filter(value => !new Set(previous.map(CharacterSheetRespec._getDecisionOptionKey)).has(CharacterSheetRespec._getDecisionOptionKey(value)));
		added.forEach(value => {
			const spell = findFull(value);
			if (["cantrips", "preparedCantrips"].includes(decision.type)) {
				claim("cantrips", value);
				this._state.addCantrip(CharacterSheetClassUtils.buildCantripStateObject(spell, {
					sourceFeature: "Cantrips Known",
					sourceClass: decision.className,
					sourceClassSource: decision.classSource,
				}));
				return;
			}
			claim("spells", value);
			this._state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(spell, {
				sourceFeature: decision.type === "spellbookSpells" ? "Wizard Spellbook" : (decision.type === "preparedSpells" ? "Prepared Spells" : "Spells Known"),
				sourceClass: decision.className,
				sourceClassSource: decision.classSource,
				prepared: decision.type === "preparedSpells",
				inSpellbook: decision.type === "spellbookSpells",
			}));
		});
	}

	async _editImprovement (level, history, choice, closeParentModal) {
		const decision = choice?.decision;
		if (!decision || decision.type === "asi") {
			await this._editAsi(level, history, closeParentModal, choice);
			return;
		}
		if (decision.type === "feat") {
			await this._editFeat(level, history, closeParentModal, choice);
			return;
		}

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Level ${level} Improvement`,
			isMinHeight0: true,
			cbClose: () => {},
		});
		const content = e_({tag: "div", clazz: "charsheet__respec-decision-mode"});
		content.append(e_({tag: "p", txt: "Choose which kind of improvement this level grants."}));
		const asi = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "Ability Score Improvement"});
		asi.addEventListener("click", () => {
			doClose();
			this._editAsi(level, history, closeParentModal, choice);
		});
		const feat = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Feat"});
		feat.addEventListener("click", () => {
			doClose();
			this._editFeat(level, history, closeParentModal, choice);
		});
		content.append(asi, feat);
		modalInner.append(content);
	}

	async _editAsiOrFeat (level, history, choice, closeParentModal) {
		return this._editImprovement(level, history, choice, closeParentModal);
	}

	async _editClassAllocation (level, history, choice, closeParentModal) {
		const decision = choice.decision;
		const classes = this._page.filterByAllowedSources
			? this._page.filterByAllowedSources(this._page.getClasses?.() || [])
			: (this._page.getClasses?.() || []);
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Change Class at Character Level ${level}`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});
		const content = e_({tag: "div", clazz: "charsheet__respec-decision-editor"});
		content.append(e_({
			tag: "div",
			clazz: "ve-alert ve-alert--warning mb-2",
			html: "Changing a historical class recomputes class levels, subclasses, features, starting grants, multiclass grants, hit dice, spell slots, and every later decision opportunity.",
		}));
		const search = e_({tag: "input", clazz: "ve-form-control mb-2"});
		search.type = "search";
		search.placeholder = "Search classes...";
		const list = e_({tag: "div", clazz: "charsheet__respec-option-list"});
		let selectedClass = null;
		const render = () => {
			list.innerHTML = "";
			const query = search.value.trim().toLowerCase();
			classes.filter(cls => cls.name.toLowerCase().includes(query)).slice(0, 100).forEach(cls => {
				const row = e_({tag: "button", clazz: "charsheet__respec-option charsheet__respec-option--button"});
				row.type = "button";
				row.append(e_({tag: "span", txt: `${cls.name} (${Parser.sourceJsonToAbv(cls.source)})`}));
				if (selectedClass?.name === cls.name && selectedClass?.source === cls.source) row.classList.add("is-selected");
				row.addEventListener("click", () => {
					selectedClass = cls;
					render();
				});
				list.append(row);
			});
		};
		search.addEventListener("input", render);
		render();
		content.append(search, list);
		const actions = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancel.addEventListener("click", () => doClose());
		const apply = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "Stage Class Change"});
		apply.addEventListener("click", () => {
			if (!selectedClass) {
				JqueryUtil.doToast({type: "warning", content: "Select a class first."});
				return;
			}
			if (selectedClass.name === decision.className && selectedClass.source === decision.classSource) {
				doClose();
				return;
			}
			this._applyClassAllocationChange(decision, selectedClass);
			doClose();
			closeParentModal?.();
			this.render();
			JqueryUtil.doToast({type: "success", content: `Character level ${level} is now assigned to ${selectedClass.name}. Review the affected decisions before applying.`});
		});
		actions.append(cancel, apply);
		content.append(actions);
		modalInner.append(content);
		search.focus();
	}

	_applyClassAllocationChange (decision, selectedClass) {
		this._engine.stageGraphMutation(decision.id, {name: selectedClass.name, source: selectedClass.source}, {
			apply: ({state}) => {
				const previousState = this._state;
				this._state = state;
				try {
					const oldHistory = state.getLevelHistory().map(entry => MiscUtil.copyFast(entry));
					const oldAsi = Object.fromEntries(Parser.ABIL_ABVS.map(ability => [ability, oldHistory.reduce(
						(sum, entry) => sum + (Number(entry.choices?.asi?.[ability]) || 0),
						0,
					)]));
					const oldFeatUids = new Set(oldHistory.map(entry => entry.choices?.feat).filter(Boolean).map(feat => `${feat.name}|${feat.source}`.toLowerCase()));
					const historyEntry = state.getLevelHistoryEntry(decision.characterLevel);
					if (historyEntry) historyEntry.class = {name: selectedClass.name, source: selectedClass.source};
					this._rebuildClassProgression();

					const newHistory = state.getLevelHistory();
					Parser.ABIL_ABVS.forEach(ability => {
						const nextAsi = newHistory.reduce((sum, entry) => sum + (Number(entry.choices?.asi?.[ability]) || 0), 0);
						const baseWithoutOldProgression = state.getAbilityBase(ability) - oldAsi[ability];
						state.setAbilityBase(ability, baseWithoutOldProgression + nextAsi);
					});
					const newFeatUids = new Set(newHistory.map(entry => entry.choices?.feat).filter(Boolean).map(feat => `${feat.name}|${feat.source}`.toLowerCase()));
					for (const uid of oldFeatUids) {
						if (newFeatUids.has(uid)) continue;
						const [name, source] = uid.split("|");
						state.removeFeat(name, source);
					}
					state.recalculateHp({syncCurrent: false});
				} finally {
					this._state = previousState;
				}
			},
		});
	}

	_rebuildClassProgression () {
		const state = this._state;
		const history = state.getLevelHistory().sort((a, b) => a.level - b.level);
		const existingClasses = state.getClasses();
		const oldResources = (state.getResources?.() || []).map(resource => ({
			identity: resource.sourceDecisionKey
				? `decision:${resource.sourceDecisionKey}`
				: resource.featureId
					? `feature:${resource.featureId}`
					: `unowned:${String(resource.name || "").toLowerCase()}`,
			name: resource.name,
			current: resource.current,
			turnReceipt: resource.triggeredDiePool?.turnReceipt?.key
				? state.queryTurnReceipt(resource.triggeredDiePool.turnReceipt.key).receipt
				: null,
		}));
		const oldFeatureDecisionKeys = new Map((state.getFeatures?.() || [])
			.filter(feature => feature.sourceDecisionKey)
			.map(feature => [
				[
					String(feature.name || "").toLowerCase(),
					String(feature.className || "").toLowerCase(),
					String(feature.classSource || "").toLowerCase(),
					Number(feature.level) || 0,
				].join("|"),
				feature.sourceDecisionKey,
			]));
		const oldCurrentHp = state.getCurrentHp();

		for (const entry of history) {
			const grants = entry.choices?.multiclassProficiencies;
			(grants?.armor || []).forEach(value => state.removeArmorProficiency(value));
			(grants?.weapons || []).forEach(value => state.removeWeaponProficiency(value));
			(grants?.tools || []).forEach(value => state.removeToolProficiency(value));
			delete entry.choices?.multiclassProficiencies;
		}

		state.getFeatures()
			.filter(feature => feature.className)
			.forEach(feature => state.removeFeature(feature.id));

		const classCounts = new Map();
		const firstEntryByClass = new Map();
		for (const entry of history) {
			const uid = `${entry.class.name}|${entry.class.source}`.toLowerCase();
			classCounts.set(uid, (classCounts.get(uid) || 0) + 1);
			if (!firstEntryByClass.has(uid)) firstEntryByClass.set(uid, entry);
		}

		state.withClassSummonReconciliationDeferred(() => {
			state._data.classes = [];
			for (const [uid, level] of classCounts) {
				const [name, source] = uid.split("|");
				const classData = this._page.getClasses?.().find(cls =>
					cls.name.toLowerCase() === name && cls.source.toLowerCase() === source,
				);
				if (!classData) continue;
				const prior = existingClasses.find(cls => cls.name === classData.name && cls.source === classData.source);
				const subclassChoiceEntry = history.find(entry =>
					entry.class.name === classData.name
						&& entry.class.source === classData.source
						&& entry.choices?.subclass,
				);
				state.addClass({
					...(prior || {}),
					name: classData.name,
					source: classData.source,
					level,
					hd: classData.hd,
					proficiency: classData.proficiency,
					startingProficiencies: classData.startingProficiencies,
					multiclassing: classData.multiclassing,
					subclass: subclassChoiceEntry?.choices?.subclass || prior?.subclass || null,
					subclassChoice: subclassChoiceEntry?.choices?.subclassChoice || prior?.subclassChoice || null,
					casterProgression: classData.casterProgression,
					spellcastingAbility: classData.spellcastingAbility,
					preparedSpellsProgression: classData.preparedSpellsProgression,
					spellsKnownProgression: classData.spellsKnownProgression,
					cantripProgression: classData.cantripProgression,
				});
			}
		});

		const firstClassData = this._page.getClasses?.().find(cls =>
			cls.name === history[0]?.class?.name && cls.source === history[0]?.class?.source,
		);
		if (firstClassData) state.applyFirstClassStartingProficiencies(firstClassData);

		const seenClasses = new Set();
		for (const entry of history) {
			const uid = `${entry.class.name}|${entry.class.source}`.toLowerCase();
			if (seenClasses.has(uid)) continue;
			seenClasses.add(uid);
			if (entry.level === 1) continue;
			const classData = this._page.getClasses?.().find(cls => cls.name === entry.class.name && cls.source === entry.class.source);
			const gained = classData?.multiclassing?.proficienciesGained || {};
			const toNames = values => (Array.isArray(values) ? values : (values ? [values] : []))
				.map(value => typeof value === "string" ? value : value?.full)
				.filter(Boolean);
			const grants = {
				armor: toNames(gained.armor),
				weapons: toNames(gained.weapons),
				tools: [],
			};
			grants.armor.forEach(value => state.addArmorProficiency(value));
			grants.weapons.forEach(value => state.addWeaponProficiency(value));
			entry.choices.multiclassProficiencies = grants;
		}

		const seenFeatures = new Set();
		for (const [uid, classLevel] of classCounts) {
			const [name, source] = uid.split("|");
			const classData = this._page.getClasses?.().find(cls =>
				cls.name.toLowerCase() === name && cls.source.toLowerCase() === source,
			);
			const classEntry = state.getClasses().find(cls => cls.name === classData?.name && cls.source === classData?.source);
			if (!classData || !classEntry) continue;
			for (let level = 1; level <= classLevel; ++level) {
				const features = CharacterSheetClassUtils.getLevelFeatures(
					classData,
					level,
					classEntry.subclass,
					this._page.getClassFeatures?.() || [],
					this._page.getSubclassFeatures?.() || [],
				);
				CharacterSheetClassUtils.dedupAndBuildFeatures(features, [], {
					className: classData.name,
					classSource: classData.source,
					level,
				}).forEach(feature => {
					const key = `${feature.name}|${feature.className}|${feature.subclassShortName || ""}|${feature.level}`.toLowerCase();
					if (seenFeatures.has(key)) return;
					seenFeatures.add(key);
					const featureKey = [
						String(feature.name || "").toLowerCase(),
						String(feature.className || "").toLowerCase(),
						String(feature.classSource || "").toLowerCase(),
						Number(feature.level) || 0,
					].join("|");
					state.addFeature(feature, {
						sourceDecisionKey: oldFeatureDecisionKeys.get(featureKey) || feature.sourceDecisionKey || null,
					});
				});
			}
			CharacterSheetClassUtils.updateClassResources(state, classEntry, classLevel, classData);
		}

		state.recalculateHitDice();
		state.calculateSpellSlots();
		state.applyClassFeatureEffects();
		state.recalculateHp({syncCurrent: false});
		state.setCurrentHp(Math.min(oldCurrentHp, state.getMaxHp()));
		for (const resource of state.getResources?.() || []) {
			const identity = resource.sourceDecisionKey
				? `decision:${resource.sourceDecisionKey}`
				: resource.featureId
					? `feature:${resource.featureId}`
					: `unowned:${String(resource.name || "").toLowerCase()}`;
			const prior = oldResources.find(item => item.identity === identity
				|| (!resource.sourceDecisionKey && !resource.featureId && item.name === resource.name && item.identity.startsWith("unowned:")));
			if (!prior) continue;
			state.setResourceCurrent?.(resource.id, Math.min(prior.current, resource.max));
			if (prior.turnReceipt && resource.triggeredDiePool?.turnReceipt) {
				const restoredReceipt = state.commitTurnReceipt({
					...resource.triggeredDiePool.turnReceipt,
					metadata: {
						...(prior.turnReceipt.metadata || {}),
						restoredBy: "respecClassRebuild",
					},
				});
				if (!restoredReceipt.ok && !restoredReceipt.duplicate) {
					throw new Error(`Could not restore per-turn resource receipt: ${restoredReceipt.reason}`);
				}
			}
		}
	}

	async _editHpDecision (level, history, choice, closeParentModal) {
		const decision = choice.decision;
		const classData = this._page.getClasses?.().find(cls => cls.name === history.class.name && cls.source === history.class.source)
			|| this._page.getClasses?.().find(cls => cls.name === history.class.name);
		const hitDie = CharacterSheetClassUtils.getClassHitDie(classData);
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Level ${level} Hit Points`,
			isMinHeight0: true,
			cbClose: () => {},
		});
		const content = e_({tag: "div", clazz: "charsheet__respec-hp-editor"});
		const average = e_({tag: "input"});
		average.type = "radio";
		average.name = `hp-${level}`;
		average.checked = decision.selection?.method !== "roll";
		const rolled = e_({tag: "input"});
		rolled.type = "radio";
		rolled.name = `hp-${level}`;
		rolled.checked = decision.selection?.method === "roll";
		const rollValue = e_({tag: "input", clazz: "ve-form-control"});
		rollValue.type = "number";
		rollValue.min = "1";
		rollValue.max = String(hitDie);
		rollValue.value = String(decision.selection?.value || Math.ceil((hitDie + 1) / 2));
		content.append(
			e_({tag: "label", clazz: "charsheet__respec-option", children: [average, e_({tag: "span", txt: "Use the class average"})]}),
			e_({tag: "label", clazz: "charsheet__respec-option", children: [rolled, e_({tag: "span", txt: `Use a recorded d${hitDie} roll`})]}),
			rollValue,
		);
		const actions = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancel.addEventListener("click", () => doClose());
		const apply = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "Stage HP Choice"});
		apply.addEventListener("click", () => {
			const value = Number(rollValue.value);
			if (rolled.checked && (!Number.isInteger(value) || value < 1 || value > hitDie)) {
				JqueryUtil.doToast({type: "warning", content: `Enter a roll from 1 to ${hitDie}.`});
				return;
			}
			const selection = rolled.checked ? {method: "roll", value} : {method: "average"};
			this._engine.stageGraphMutation(decision.id, selection, {
				apply: ({state}) => state.recalculateHp({syncCurrent: false}),
			});
			doClose();
			closeParentModal?.();
			this.render();
		});
		actions.append(cancel, apply);
		content.append(actions);
		modalInner.append(content);
	}

	async _editSpellSwapDecision (level, history, choice, closeParentModal) {
		const decision = choice.decision;
		const legalSpells = this._getDecisionOptions(decision);
		const existing = decision.selection;
		const currentClassSpells = this._state.getSpellsKnown().filter(spell =>
			spell.sourceClass?.toLowerCase() === decision.className.toLowerCase()
			&& !spell.alwaysPrepared
			&& !spell.grantedByClass
			&& CharacterSheetRespec._getDecisionOptionKey(spell) !== CharacterSheetRespec._getDecisionOptionKey(existing?.added),
		);
		if (existing?.removed?.name && !currentClassSpells.some(spell =>
			CharacterSheetRespec._getDecisionOptionKey(spell) === CharacterSheetRespec._getDecisionOptionKey(existing.removed),
		)) {
			currentClassSpells.push(existing.removed);
		}
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Spell Replacement · Level ${level}`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});
		const content = e_({tag: "div", clazz: "charsheet__respec-decision-editor"});
		content.append(e_({
			tag: "p",
			clazz: "ve-muted",
			txt: "Choose one spell this character knew at this point and the legal spell that replaced it. This optional replacement can also be deferred.",
		}));
		const removed = e_({tag: "select", clazz: "ve-form-control mb-2"});
		removed.setAttribute("aria-label", "Spell to replace");
		removed.append(e_({tag: "option", value: "", txt: "Choose the spell to replace"}));
		currentClassSpells.forEach(spell => removed.append(e_({
			tag: "option",
			value: `${spell.name}|${spell.source}`,
			txt: CharacterSheetRespec._getDecisionOptionLabel(spell),
		})));
		const added = e_({tag: "select", clazz: "ve-form-control"});
		added.setAttribute("aria-label", "Replacement spell");
		added.append(e_({tag: "option", value: "", txt: "Choose the replacement spell"}));
		legalSpells.forEach(spell => added.append(e_({
			tag: "option",
			value: `${spell.name}|${spell.source}`,
			txt: CharacterSheetRespec._getDecisionOptionLabel(spell),
		})));
		content.append(removed, added);

		const actions = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancel.addEventListener("click", () => doClose());
		const defer = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Defer Replacement"});
		defer.addEventListener("click", () => {
			this._engine.stageGraphMutation(decision.id, null, {
				status: "deferred",
				apply: ({state}) => {
					const previousState = this._state;
					this._state = state;
					try {
						this._applySpellSwapMechanics(decision, null, legalSpells);
					} finally {
						this._state = previousState;
					}
				},
			});
			doClose();
			closeParentModal?.();
			this.render();
		});
		const apply = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "Stage Replacement"});
		apply.addEventListener("click", () => {
			const [removedName, removedSource] = removed.value.split("|");
			const [addedName, addedSource] = added.value.split("|");
			const removedSpell = currentClassSpells.find(spell => spell.name === removedName && spell.source === removedSource);
			const addedSpell = legalSpells.find(spell => spell.name === addedName && spell.source === addedSource);
			if (!removedSpell || !addedSpell) {
				JqueryUtil.doToast({type: "warning", content: "Choose both the spell to replace and its replacement."});
				return;
			}
			if (removedName === addedName && removedSource === addedSource) {
				JqueryUtil.doToast({type: "warning", content: "Choose a different replacement spell."});
				return;
			}
			const nextSelection = {
				removed: CharacterSheetRespec._toDecisionSelectionValue(removedSpell),
				added: CharacterSheetRespec._toDecisionSelectionValue(addedSpell),
			};
			this._engine.stageGraphMutation(decision.id, nextSelection, {
				apply: ({state}) => {
					const previousState = this._state;
					this._state = state;
					try {
						if (!this._applySpellSwapMechanics(decision, nextSelection, legalSpells)) throw new Error("Choose a different replacement spell.");
					} finally {
						this._state = previousState;
					}
				},
			});
			doClose();
			closeParentModal?.();
			this.render();
		});
		actions.append(cancel, defer, apply);
		content.append(actions);
		modalInner.append(content);
	}

	_applySpellSwapMechanics (decision, nextSelection, legalSpells = []) {
		if (nextSelection?.removed?.name && nextSelection?.added?.name
			&& CharacterSheetRespec._getDecisionOptionKey(nextSelection.removed) === CharacterSheetRespec._getDecisionOptionKey(nextSelection.added)) {
			return false;
		}

		const getOwnershipType = spellRef => Number(spellRef?.level) === 0 ? "cantrips" : "spells";
		const restoreSpell = spellRef => {
			if (!spellRef?.name) return;
			const spell = legalSpells.find(it =>
				CharacterSheetRespec._getDecisionOptionKey(it) === CharacterSheetRespec._getDecisionOptionKey(spellRef),
			) || spellRef;
			if (Number(spell.level) === 0) {
				this._state.addCantrip(CharacterSheetClassUtils.buildCantripStateObject(spell, {
					sourceFeature: "Cantrips Known",
					sourceClass: decision.className,
					sourceClassSource: decision.classSource,
				}));
				return;
			}
			this._state.addSpell(CharacterSheetClassUtils.buildSpellStateObject(spell, {
				sourceFeature: "Spells Known",
				sourceClass: decision.className,
				sourceClassSource: decision.classSource,
			}));
		};

		const existing = decision.selection;
		if (existing?.added?.name && existing?.removed?.name) {
			if (this._state.releaseProgressionOwnership(getOwnershipType(existing.added), existing.added, decision.semanticKey)) {
				this._state.removeSpell(existing.added.name, existing.added.source);
			}
			restoreSpell(existing.removed);
		}
		if (!nextSelection) return true;

		this._state.removeSpell(nextSelection.removed.name, nextSelection.removed.source);
		this._state.claimProgressionOwnership(getOwnershipType(nextSelection.added), nextSelection.added, decision.semanticKey);
		restoreSpell(nextSelection.added);
		return true;
	}

	async _editCombatTraditions (level, history, choice = null, closeParentModal) {
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Change Level ${level} Combat Traditions`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const classData = this._page.getClasses()?.find(c => c.name === history.class?.name && c.source === history.class?.source);

		// Extract CTM feature types from class optional feature progression
		const classAllowedTypes = [];
		if (classData?.optionalfeatureProgression) {
			for (const prog of classData.optionalfeatureProgression) {
				if (prog.featureType?.some(ft => ft.startsWith("CTM:"))) {
					classAllowedTypes.push(...prog.featureType.filter(ft => ft.startsWith("CTM:")));
				}
			}
		}
		let allTraditions = CharacterSheetClassUtils.getAvailableTraditionsForClass(
			this._page.getOptionalFeatures() || [],
			classAllowedTypes,
			classData?.name || history.class?.name,
			this._page.getClassFeatures() || [],
		);
		// If no traditions found from class data, show all traditions as fallback
		if (!allTraditions.length) {
			allTraditions = CharacterSheetClassUtils.getAllTraditions();
		}

		const classFeatures = this._page.getClassFeatures() || [];
		const maxTraditions = CharacterSheetClassUtils.getCombatTraditionSelectionCount({
			classData,
			classFeatures,
			defaultCount: Math.max(1, history.choices?.combatTraditions?.length || 2),
		});
		const requiredTraditions = Math.min(maxTraditions, allTraditions.length || maxTraditions);

		const decision = choice?.decision || null;
		let selectedTraditions = [...(decision?.selection || history.choices?.combatTraditions || [])];

		modalInner.append(e_({outer: `<div>
			<p class="ve-muted mb-2">Choose up to ${requiredTraditions} traditions for this level history entry.</p>
			<div class="ve-small ve-muted mb-2">Selected: <span id="respec-tradition-count">${selectedTraditions.length}</span>/${requiredTraditions}</div>
		</div>`}));

		const list = e_({tag: "div"});
		Object.assign(list.style, {display: "flex", flexWrap: "wrap", gap: "8px"});
		modalInner.append(list);
		allTraditions.forEach(trad => {
			const isSelected = selectedTraditions.includes(trad.code);
			const desc = CharacterSheetClassUtils.getTraditionDescription?.(trad.code) || "";
			const label = e_({outer: `
				<label style="display:flex; align-items:center; cursor:pointer; padding:4px 8px; border:1px solid var(--rgb-border-grey); border-radius:4px; ${isSelected ? "background: var(--rgb-bg-highlight);" : ""}" title="${desc}">
					<input type="checkbox" value="${trad.code}" ${isSelected ? "checked" : ""} style="margin-right:6px;">
					<span class="respec-trad-name"></span>
					<span class="ve-small text-muted ml-1">(${trad.code})</span>
				</label>
			`});

			// Add hover link for the tradition name
			const tradNameEl = label.querySelector(".respec-trad-name");
			try {
				const tradLink = CharacterSheetPage.getHoverLink(
					UrlUtil.PG_VARIANTRULES,
					"Combat Traditions",
					Parser.SRC_TGTT || "TGTT",
					null,
					trad.name,
				);
				if (typeof tradLink === "string") tradNameEl.innerHTML = tradLink;
				else tradNameEl.append(tradLink);
			} catch (e) {
				tradNameEl.textContent = trad.name;
			}

			label.querySelector("input").addEventListener("change", (evt) => {
				if (evt.target.checked) {
					if (selectedTraditions.length < requiredTraditions) {
						selectedTraditions.push(trad.code);
						label.style.background = "var(--rgb-bg-highlight)";
					} else {
						evt.target.checked = false;
						JqueryUtil.doToast({type: "warning", content: `You can only choose ${requiredTraditions} combat traditions.`});
					}
				} else {
					selectedTraditions = selectedTraditions.filter(t => t !== trad.code);
					label.style.background = "";
				}
				(/** @type {*} */ (document.getElementById("respec-tradition-count"))).textContent = selectedTraditions.length;
			});

			list.append(label);
		});

		const btnRow = ee`<div class="ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default mr-2">Cancel</button>
			<button class="ve-btn ve-btn-primary">Apply Changes</button>
		</div>`;
		modalInner.append(btnRow);
		btnRow.querySelector(".ve-btn-default").addEventListener("click", () => doClose());

		btnRow.querySelector(".ve-btn-primary").addEventListener("click", async () => {
			if (selectedTraditions.length !== requiredTraditions) {
				JqueryUtil.doToast({type: "warning", content: `Please select exactly ${requiredTraditions} traditions.`});
				return;
			}

			const decision = choice?.decision;
			if (decision) {
				this._engine.stageGraphMutation(decision.id, [...selectedTraditions], {
					apply: ({state}) => {
						if (!state.updateLevelChoice(level, {combatTraditions: [...selectedTraditions]})) throw new Error("Failed to update level history entry.");
						this._page.replayHistoryMartialChoices(state);
					},
				});
			} else {
				try {
					await this._engine.stageCandidateMutation(({state}) => {
						if (!state.updateLevelChoice(level, {combatTraditions: [...selectedTraditions]})) throw new Error("Failed to update level history entry.");
						this._page.replayHistoryMartialChoices(state);
					});
				} catch (e) {
					JqueryUtil.doToast({type: "danger", content: e.message});
					return;
				}
			}

			doClose();
			closeParentModal();
			this.render();
			JqueryUtil.doToast({type: "success", content: `Updated level ${level} combat traditions.`});
		});
	}

	/**
	 * Edit combat methods — dedicated flow with tradition grouping and degree filtering.
	 * Modeled on LevelUp's _renderMethodsForLevelUp.
	 */
	async _editCombatMethods (level, history, choice, closeParentModal) {
		const decision = choice?.decision || null;
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Change Combat Methods (Level ${level})`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const featureTypeKey = choice.featureTypeKey;
		const featureTypes = featureTypeKey.split("_");
		const requiredCount = choice.count;

		// Get class data and compute filtering params
		const classData = this._page.getClasses()?.find(c => c.name === history.class?.name && c.source === history.class?.source);

		// Get existing optional features from state
		const existingOptFeatures = this._state.getFeatures().filter(f => f.featureType === "Optional Feature");

		// Get known traditions
		const knownTraditions = CharacterSheetClassUtils.getKnownCombatTraditions(existingOptFeatures, this._state);
		const maxDegree = CharacterSheetClassUtils.getMaxMethodDegree(classData, level);

		// Merge combat method entities into the pool
		const allOptFeaturesRaw = this._page.filterByAllowedSources?.(this._page.getOptionalFeatures() || []) || [];
		const combatMethodEntities = this._page.getCombatMethodEntities?.() || [];
		const allMethods = [...allOptFeaturesRaw, ...combatMethodEntities];

		// Filter to methods in known traditions at valid degree
		const availableMethods = allMethods.filter(opt => {
			if (!CharacterSheetClassUtils.isCombatMethod(opt)) return false;
			const degree = CharacterSheetClassUtils.getMethodDegree(opt);
			const tradCode = CharacterSheetClassUtils.getMethodTraditionCode(opt);
			return degree > 0 && degree <= maxDegree && tradCode && knownTraditions.includes(tradCode);
		});

		// Deduplicate by edition priority
		const showAll = this._state.getSettings()?.showAllOptFeatureVersions || false;
		const filteredMethods = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition?.(availableMethods, {showAll}) || availableMethods;

		// Current selections for this type at this level
		const currentSelections = decision
			? (Array.isArray(decision.selection) ? decision.selection : [])
			: (history.choices.optionalFeatures || []).filter(of => of.type === featureTypeKey);
		const currentNames = new Set(currentSelections.map(s => typeof s === "string" ? s.split("|")[0] : s.name));

		// Already-known methods from OTHER levels
		const existingFromOtherLevels = new Set();
		for (const entry of this._state.getLevelHistory()) {
			if (entry.level === level) continue;
			for (const of of (entry.choices?.optionalFeatures || [])) {
				if (of.type === featureTypeKey) existingFromOtherLevels.add(of.name);
			}
		}

		// Mark methods
		const processedMethods = filteredMethods.map(opt => ({
			...opt,
			_alreadyKnown: existingFromOtherLevels.has(opt.name) && !currentNames.has(opt.name),
			_degree: CharacterSheetClassUtils.getMethodDegree(opt),
			_tradition: CharacterSheetClassUtils.getMethodTraditionCode(opt),
		}));

		let selectedNames = new Set(currentNames);

		modalInner.append(e_({outer: `<div>
			<p class="ve-muted mb-2">Choose ${requiredCount} combat method${requiredCount > 1 ? "s" : ""} for this level.</p>
			<p class="ve-small ve-muted mb-2">Max degree: ${maxDegree}${CharacterSheetClassUtils.getOrdinalSuffix?.(maxDegree) || ""} | Traditions: ${knownTraditions.map(t => CharacterSheetClassUtils.getTraditionName(t)).join(", ")}</p>
			<div class="ve-small ve-muted mb-2">Selected: <span id="respec-cm-count">${selectedNames.size}</span>/${requiredCount}</div>
		</div>`}));

		const list = e_({tag: "div"});
		Object.assign(list.style, {maxHeight: "60vh", overflowY: "auto", border: "1px solid var(--rgb-border-grey)", borderRadius: "4px", padding: "0.5rem"});

		// Group by tradition
		const methodsByTradition = new Map();
		for (const method of processedMethods) {
			const trad = method._tradition;
			if (!methodsByTradition.has(trad)) methodsByTradition.set(trad, []);
			methodsByTradition.get(trad).push(method);
		}

		for (const tradCode of knownTraditions) {
			const methods = methodsByTradition.get(tradCode) || [];
			if (methods.length === 0) continue;

			const tradGroup = e_({outer: `<div class="mb-2"><p class="ve-small mb-1"><strong>${CharacterSheetClassUtils.getTraditionName(tradCode)}</strong></p></div>`});

			methods.sort((a, b) => a._degree - b._degree || a.name.localeCompare(b.name)).forEach(method => {
				const isDisabled = method._alreadyKnown;
				const isSelected = selectedNames.has(method.name);
				const knownBadge = isDisabled ? `<span class="badge badge-secondary ml-1">Known</span>` : "";

				const item = e_({outer: `
					<label style="display:flex; align-items:center; cursor:${isDisabled ? "not-allowed" : "pointer"}; padding:6px 8px; border-bottom:1px solid var(--rgb-border-grey); ${isSelected ? "background: var(--rgb-bg-highlight);" : ""} ${isDisabled ? "opacity:0.5;" : ""}">
						<input type="checkbox" ${isSelected ? "checked" : ""} ${isDisabled ? "disabled" : ""} style="margin-right:8px;">
						<span>
							<span class="respec-hover-slot"></span>
							${knownBadge}
							<span class="ve-muted ve-small ml-1">(${method._degree}${CharacterSheetClassUtils.getOrdinalSuffix?.(method._degree) || ""} degree)</span>
						</span>
					</label>
				`});

				CharacterSheetRespec._setHoverLink(item.querySelector(".respec-hover-slot"), UrlUtil.PG_COMBAT_METHODS, method.name, method.source);

				if (!isDisabled) {
					item.querySelector("input").addEventListener("change", (evt) => {
						if (evt.target.checked) {
							if (selectedNames.size < requiredCount) {
								selectedNames.add(method.name);
								item.style.background = "var(--rgb-bg-highlight)";
							} else {
								evt.target.checked = false;
								JqueryUtil.doToast({type: "warning", content: `You can only choose ${requiredCount} combat methods.`});
							}
						} else {
							selectedNames.delete(method.name);
							item.style.background = "";
						}
						(/** @type {*} */ (document.getElementById("respec-cm-count"))).textContent = selectedNames.size;
					});
				}

				tradGroup.append(item);
			});

			list.append(tradGroup);
		}

		if ([...list.children].length === 0) {
			list.insertAdjacentHTML("beforeend", `<div class="ve-muted">No combat methods available. Check that traditions are set.</div>`);
		}

		modalInner.append(list);

		const btnRow = ee`<div class="ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default mr-2">Cancel</button>
			<button class="ve-btn ve-btn-primary">Apply Changes</button>
		</div>`;
		modalInner.append(btnRow);
		btnRow.querySelector(".ve-btn-default").addEventListener("click", () => doClose());

		btnRow.querySelector(".ve-btn-primary").addEventListener("click", async () => {
			if (selectedNames.size !== requiredCount) {
				JqueryUtil.doToast({type: "warning", content: `Please select exactly ${requiredCount} combat methods.`});
				return;
			}

			// Build new selections from the full method objects
			const matchingOptions = filteredMethods.filter(opt => CharacterSheetClassUtils.isCombatMethod(opt));
			const newSelections = matchingOptions
				.filter(opt => selectedNames.has(opt.name))
				.map(opt => ({name: opt.name, source: opt.source, type: featureTypeKey}));

			const applyChanges = ({state}) => {
				const previousState = this._state;
				this._state = state;
				try {
					const stateFeatures = state.getFeatures().filter(f => f.featureType === "Optional Feature");
					for (const old of currentSelections) {
						const stateFeature = stateFeatures.find(f =>
							f.name === old.name && (f.optionalFeatureTypes || []).some(ft => featureTypes.includes(ft)),
						);
						if (stateFeature) state.removeFeature(stateFeature.id);
					}

					for (const sel of newSelections) {
						const fullOpt = matchingOptions.find(opt => opt.name === sel.name && opt.source === sel.source);
						if (fullOpt) {
							state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(fullOpt, {
								className: history.class?.name,
								classSource: history.class?.source,
								level,
								featureType: "Optional Feature",
								optionalFeatureTypes: featureTypes,
							}));
						}
					}

					const otherTypeFeatures = (history.choices.optionalFeatures || []).filter(of => of.type !== featureTypeKey);
					const updatedOptionalFeatures = [...otherTypeFeatures, ...newSelections];
					const newReplaySnapshots = newSelections.map(sel => {
						const fullOpt = matchingOptions.find(opt => opt.name === sel.name && opt.source === sel.source);
						return fullOpt
							? CharacterSheetClassUtils.buildHistoryFeatureSnapshot(fullOpt, {type: featureTypeKey})
							: sel;
					});
					const otherTypeReplay = (history.choices.replayData?.optionalFeatures || [])
						.filter(snap => {
							const snapType = snap.type || snap.optionalFeatureTypes?.join("_");
							return snapType !== featureTypeKey || !currentNames.has(snap.name);
						});

					state.updateLevelChoice(level, {
						optionalFeatures: updatedOptionalFeatures,
						replayData: {
							...(history.choices.replayData || {}),
							optionalFeatures: [...otherTypeReplay, ...newReplaySnapshots],
						},
					});
					this._page.replayHistoryMartialChoices(state);
				} finally {
					this._state = previousState;
				}
			};
			if (decision) this._engine.stageGraphMutation(decision.id, newSelections, {apply: applyChanges});
			else await this._engine.stageCandidateMutation(applyChanges);

			doClose();
			closeParentModal();
			this.render();
			JqueryUtil.doToast({type: "success", content: "Updated combat methods."});
		});
	}

	async _editWeaponMasteries (level, history, choice = null, closeParentModal) {
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Change Level ${level} Weapon Masteries`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const globalMaxMasteries = Math.max(1, this._page.getMaxWeaponMasteries?.() || 1);
		const requiredMasteries = Math.max(
			1,
			history.choices?.weaponMasteries?.length || Math.min(globalMaxMasteries, this._state.getWeaponMasteries().length || 1),
		);
		const selectedMasteryValues = choice?.decision?.selection || history.choices?.weaponMasteries || [];
		let selectedMasteries = selectedMasteryValues.map(value => typeof value === "string" ? value : `${value.name}|${value.source}`);

		modalInner.append(e_({outer: `<div>
			<p class="ve-muted mb-2">Choose up to ${requiredMasteries} weapon masteries for this level history entry.</p>
			<div class="ve-small ve-muted mb-2">Selected: <span id="respec-mastery-count">${selectedMasteries.length}</span>/${requiredMasteries}</div>
		</div>`}));

		const weaponsWithMastery = (this._page.getItems() || []).filter(item => {
			if (!item._isBaseItem) return false;
			if (!item.weaponCategory && !["M", "R", "S"].includes(item.type)) return false;
			return item.mastery?.length > 0;
		});

		const simpleWeapons = weaponsWithMastery
			.filter(w => w.weaponCategory === "simple" || w.type === "S")
			.sort((a, b) => a.name.localeCompare(b.name));

		const martialWeapons = weaponsWithMastery
			.filter(w => w.weaponCategory === "martial" || w.type === "M")
			.sort((a, b) => a.name.localeCompare(b.name));

		const renderWeaponGroup = (weapons, groupName) => {
			if (!weapons.length) return;

			const group = e_({outer: `<div class="mb-3"><strong>${groupName}:</strong></div>`});
			const checkboxes = e_({tag: "div"});
			Object.assign(checkboxes.style, {display: "flex", flexWrap: "wrap", gap: "8px"});

			weapons.forEach(weapon => {
				const weaponKey = `${weapon.name}|${weapon.source}`;
				const isSelected = selectedMasteries.includes(weaponKey);
				const label = e_({outer: `
					<label style="display:flex; align-items:center; cursor:pointer; padding:4px 8px; border:1px solid var(--rgb-border-grey); border-radius:4px; ${isSelected ? "background: var(--rgb-bg-highlight);" : ""}">
						<input type="checkbox" value="${weaponKey}" ${isSelected ? "checked" : ""} style="margin-right:6px;">
						<span class="respec-weapon-name"></span>
					</label>
				`});

				// Add hover link for the weapon name
				const weaponNameEl = label.querySelector(".respec-weapon-name");
				weaponNameEl.innerHTML = CharacterSheetClassUtils.buildItemHoverNameHtml(weapon);

				label.querySelector("input").addEventListener("change", (evt) => {
					if (evt.target.checked) {
						if (selectedMasteries.length < requiredMasteries) {
							selectedMasteries.push(weaponKey);
							label.style.background = "var(--rgb-bg-highlight)";
						} else {
							evt.target.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${requiredMasteries} weapon masteries.`});
						}
					} else {
						selectedMasteries = selectedMasteries.filter(m => m !== weaponKey);
						label.style.background = "";
					}
					(/** @type {*} */ (document.getElementById("respec-mastery-count"))).textContent = selectedMasteries.length;
				});

				checkboxes.append(label);
			});

			group.append(checkboxes);
			modalInner.append(group);
		};

		renderWeaponGroup(simpleWeapons, "Simple Weapons");
		renderWeaponGroup(martialWeapons, "Martial Weapons");

		const btnRow = ee`<div class="ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default mr-2">Cancel</button>
			<button class="ve-btn ve-btn-primary">Apply Changes</button>
		</div>`;
		modalInner.append(btnRow);
		btnRow.querySelector(".ve-btn-default").addEventListener("click", () => doClose());

		btnRow.querySelector(".ve-btn-primary").addEventListener("click", async () => {
			if (selectedMasteries.length !== requiredMasteries) {
				JqueryUtil.doToast({type: "warning", content: `Please select exactly ${requiredMasteries} weapon masteries.`});
				return;
			}

			const applyChanges = ({state}) => {
				if (!state.updateLevelChoice(level, {weaponMasteries: [...selectedMasteries]})) {
					throw new Error("Failed to update level history entry.");
				}
				this._page.replayHistoryMartialChoices(state);
			};
			if (choice.decision) this._engine.stageGraphMutation(choice.decision.id, [...selectedMasteries], {apply: applyChanges});
			else await this._engine.stageCandidateMutation(applyChanges);

			doClose();
			closeParentModal();
			this.render();
			JqueryUtil.doToast({type: "success", content: `Updated level ${level} weapon masteries.`});
		});
	}

	/**
	 * Edit optional feature choices (metamagic, invocations, etc.)
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {object} choice - The editable choice descriptor with featureTypeKey and count
	 * @param {Function} closeParentModal - Function to close parent modal
	 */
	async _editOptionalFeatures (level, history, choice, closeParentModal) {
		const decision = choice.decision || null;
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Change ${choice.label}`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const featureTypeKey = choice.featureTypeKey;
		const requiredCount = choice.count;

		// Get all available optional features of this type
		const allOptFeaturesRaw = this._page.filterByAllowedSources(this._page.getOptionalFeatures() || []);

		// Merge combat method entities for CTM types
		if (featureTypeKey.startsWith("CTM:")) {
			const combatMethodEntities = this._page.getCombatMethodEntities?.() || [];
			allOptFeaturesRaw.push(...combatMethodEntities);
		}

		const classData = this._page.getClasses()?.find(c =>
			c.name === history.class?.name && c.source === history.class?.source,
		);
		const showAll = this._state.getSettings()?.showAllOptFeatureVersions || false;
		const allOptFeatures = CharacterSheetClassUtils.deduplicateOptFeaturesByEdition(allOptFeaturesRaw, {showAll});

		// Filter to matching feature type
		const featureTypes = featureTypeKey.split("_");
		const matchingOptions = decision?.options?.length
			? decision.options
			: allOptFeatures.filter(opt => {
				return opt.featureType?.some(ft => featureTypes.some(progType => ft === progType || ft.startsWith(progType)));
			});

		// Current selections for this type
		const currentSelections = decision
			? (Array.isArray(decision.selection) ? decision.selection : [])
			: (history.choices.optionalFeatures || []).filter(of => of.type === featureTypeKey);
		const getOptionKey = option => `${option?.name || ""}|${option?.source || ""}`.toLowerCase();
		const currentNames = new Set(currentSelections.map(getOptionKey));

		// Get all existing optional features from ALL levels (to filter already-known from other levels)
		const existingFeatures = this._state.getFeatures().filter(f => f.featureType === "Optional Feature");
		const existingFromOtherLevels = new Set();
		const allHistory = this._state.getLevelHistory();
		for (const entry of allHistory) {
			if (entry.level === level) continue;
			for (const of of (entry.choices?.optionalFeatures || [])) {
				if (of.type === featureTypeKey) existingFromOtherLevels.add(getOptionKey(of));
			}
		}

		let selectedNames = new Set(currentNames);

		modalInner.append(e_({outer: `<div>
			<p class="ve-muted mb-2">Choose ${requiredCount} ${choice.label.toLowerCase()} for this level.</p>
			<div class="ve-small ve-muted mb-2">Selected: <span id="respec-optfeat-count">${selectedNames.size}</span>/${requiredCount}</div>
		</div>`}));

		const list = e_({tag: "div"});
		Object.assign(list.style, {maxHeight: "60vh", overflowY: "auto", border: "1px solid var(--rgb-border-grey)", borderRadius: "4px", padding: "0.5rem"});

		matchingOptions
			.sort((a, b) => a.name.localeCompare(b.name))
			.forEach(opt => {
				const optionKey = getOptionKey(opt);
				const isCurrentLevel = currentNames.has(optionKey);
				const isOtherLevel = existingFromOtherLevels.has(optionKey);
				const isPrereqBlocked = opt._selectable === false && !isCurrentLevel;
				const isDisabled = (isOtherLevel && !isCurrentLevel) || isPrereqBlocked;
				const isSelected = selectedNames.has(optionKey);
				const prereqText = !opt._meetsPrereqs && opt._prereqReasons?.length
					? `Requires: ${opt._prereqReasons.join(", ")}`
					: "";

				const item = e_({outer: `
					<label style="display:flex; align-items:center; cursor:${isDisabled ? "not-allowed" : "pointer"}; padding:6px 8px; border-bottom:1px solid var(--rgb-border-grey); ${isSelected ? "background: var(--rgb-bg-highlight);" : ""} ${isDisabled ? "opacity:0.5;" : ""}">
						<input type="checkbox" ${isSelected ? "checked" : ""} ${isDisabled ? "disabled" : ""} style="margin-right:8px;">
						<span>
							<strong class="respec-opt-name"></strong>
							${opt.source ? `<span class="text-muted ve-small ml-1">[${Parser.sourceJsonToAbv(opt.source)}]</span>` : ""}
							${isOtherLevel && !isCurrentLevel ? `<span class="text-muted ve-small ml-1">(known from another level)</span>` : ""}
							${prereqText ? `<span class="badge badge-warning ml-1">${prereqText}</span>` : ""}
						</span>
					</label>
				`});

				// Add hover link for the feature name
				const nameEl = item.querySelector(".respec-opt-name");
				try {
					const isCM = CharacterSheetClassUtils.isCombatMethod(opt);
					const page = isCM ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES;
					const link = CharacterSheetPage.getHoverLink(page, opt.name, opt.source);
					if (typeof link === "string") nameEl.innerHTML = link;
					else nameEl.append(link);
				} catch (e) {
					nameEl.textContent = opt.name;
				}

				item.querySelector("input").addEventListener("change", (evt) => {
					if (evt.target.checked) {
						if (selectedNames.size < requiredCount) {
							selectedNames.add(optionKey);
							item.style.background = "var(--rgb-bg-highlight)";
						} else {
							evt.target.checked = false;
							JqueryUtil.doToast({type: "warning", content: `You can only choose ${requiredCount} ${choice.label.toLowerCase()}.`});
						}
					} else {
						selectedNames.delete(optionKey);
						item.style.background = "";
					}
					(/** @type {*} */ (document.getElementById("respec-optfeat-count"))).textContent = selectedNames.size;
				});

				list.append(item);
			});

		modalInner.append(list);

		const btnRow = ee`<div class="ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default mr-2">Cancel</button>
			<button class="ve-btn ve-btn-primary">Apply Changes</button>
		</div>`;
		modalInner.append(btnRow);
		btnRow.querySelector(".ve-btn-default").addEventListener("click", () => doClose());

		btnRow.querySelector(".ve-btn-primary").addEventListener("click", async () => {
			if (selectedNames.size !== requiredCount) {
				JqueryUtil.doToast({type: "warning", content: `Please select exactly ${requiredCount} ${choice.label.toLowerCase()}.`});
				return;
			}

			// Build new optional feature entries
			const newSelections = matchingOptions
				.filter(opt => selectedNames.has(getOptionKey(opt)))
				.map(opt => ({name: opt.name, source: opt.source, type: featureTypeKey}));

			const applyChanges = ({state}) => {
				const previousState = this._state;
				this._state = state;
				try {
					// Remove old features from state for this type at this level
					for (const old of currentSelections) {
						const stateFeature = existingFeatures.find(f =>
							f.name === old.name && f.featureType === "Optional Feature"
							&& (f.level == null || Number(f.level) === Number(level))
							&& (f.optionalFeatureTypes || []).some(ft => featureTypes.includes(ft)),
						);
						if (stateFeature) this._state.removeFeature(stateFeature.id);
					}

					// Add new features to state
					for (const sel of newSelections) {
						const fullOpt = matchingOptions.find(opt => opt.name === sel.name && opt.source === sel.source);
						if (fullOpt) {
							this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(fullOpt, {
								className: history.class?.name,
								classSource: history.class?.source,
								level,
								featureType: "Optional Feature",
								optionalFeatureTypes: featureTypes,
							}));
						}
					}

					// Also update replayData snapshots for this type
					const newReplaySnapshots = newSelections.map(sel => {
						const fullOpt = matchingOptions.find(opt => opt.name === sel.name && opt.source === sel.source);
						return fullOpt
							? CharacterSheetClassUtils.buildHistoryFeatureSnapshot(fullOpt, {type: featureTypeKey})
							: sel;
					});
					const otherTypeReplay = (history.choices.replayData?.optionalFeatures || [])
						.filter(snap => {
							const snapType = snap.type || snap.optionalFeatureTypes?.join("_");
							return snapType !== featureTypeKey;
						});

					this._state.updateLevelChoice(level, {
						replayData: {
							...(history.choices.replayData || {}),
							optionalFeatures: [...otherTypeReplay, ...newReplaySnapshots],
						},
					});
					if (!decision) {
						const otherTypeFeatures = (history.choices.optionalFeatures || []).filter(of => of.type !== featureTypeKey);
						this._state.updateLevelChoice(level, {optionalFeatures: [...otherTypeFeatures, ...newSelections]});
					}
				} finally {
					this._state = previousState;
				}
			};
			if (decision) this._engine.stageGraphMutation(decision.id, newSelections, {apply: applyChanges});
			else await this._engine.stageCandidateMutation(applyChanges);

			doClose();
			closeParentModal?.();
			this.render();
			JqueryUtil.doToast({type: "success", content: `Updated ${choice.label}.`});
		});
	}

	/**
	 * Set an element's content to a hoverable link, falling back to plain text on error.
	 * @param {HTMLElement} el - The element to populate
	 * @param {string} page - The hover page (e.g. UrlUtil.PG_FEATS)
	 * @param {string} name - The entity name
	 * @param {string} source - The entity source
	 * @param {string|null} [hash] - Optional custom hash
	 * @param {string|null} [displayName] - Optional display name override
	 */
	static _setHoverLink (el, page, name, source, hash = null, displayName = null) {
		if (!name) { el.textContent = "Unknown"; return; }
		try {
			if (page === UrlUtil.PG_ITEMS) {
				el.innerHTML = CharacterSheetClassUtils.buildItemHoverNameHtml({name, source}, {displayLabel: displayName || name});
				return;
			}
			const link = CharacterSheetPage.getHoverLink(page, name, source, hash, displayName);
			if (typeof link === "string") el.innerHTML = link;
			else el.append(link);
		} catch (e) {
			el.textContent = displayName || name;
		}
	}

	/**
	 * Render a hoverable subclass link into the given slot.
	 * Builds a PG_CLASSES hash from the class + subclass state so the hover
	 * routes to the canonical class entry — using the bare subclass name
	 * (as a top-level class) produces an unresolvable hash like
	 * `chronurgy%20magic_tgtt-2014`.
	 *
	 * @param {Element} el - The element to populate with the link
	 * @param {object} page - The CharacterSheetPage (for loaded subclass data)
	 * @param {object} subclass - {name, source, className?, classSource?, shortName?}
	 * @param {object} [storedClass] - Optional class entry to resolve className/classSource
	 */
	static _setSubclassHoverLink (el, page, subclass, storedClass = null) {
		if (!subclass?.name) { el.textContent = "Unknown"; return; }
		try {
			const allSubclasses = page?.getSubclasses?.() || null;
			const link = CharacterSheetPage.getSubclassHoverLink(subclass, allSubclasses, storedClass);
			if (typeof link === "string") el.innerHTML = link;
			else el.append(link);
		} catch (e) {
			el.textContent = subclass.name;
		}
	}

	/**
	 * Get a human-readable label for an optional feature type code.
	 * @param {string} typeKey - e.g. "MM", "EI", "PB"
	 * @returns {string} Human-readable label
	 */
	static _getOptionalFeatureTypeLabel (typeKey) {
		const typeNames = {
			"EI": "Eldritch Invocations",
			"MM": "Metamagic Options",
			"MV:B": "Battle Master Maneuvers",
			"AS": "Arcane Shot Options",
			"ED": "Elemental Disciplines",
			"PB": "Pact Boons",
			"AI": "Artificer Infusions",
			"RN": "Rune Knight Runes",
		};
		if (typeNames[typeKey]) return typeNames[typeKey];
		if (typeKey.startsWith("CTM:")) return "Combat Methods";
		return `Optional Features (${typeKey})`;
	}

	/**
	 * Edit ASI choice
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {Function} closeParentModal - Function to close parent modal
	 */
	async _editAsi (level, history, closeParentModal, choice = null) {
		const decision = choice?.decision || null;
		const selectedAsi = decision?.type === "asiOrFeat"
			? (decision.selection?.mode === "asi" ? decision.selection.asi : {})
			: decision?.type === "asi"
				? decision.selection || {}
				: history.choices?.asi || {};
		const previousFeatRef = decision?.selection?.mode === "feat"
			? decision.selection.feat
			: (decision?.type === "feat" && decision.selection?.name ? decision.selection : null);
		const previousFeat = previousFeatRef
			? this._state.getFeats?.().find(feat => feat.name === previousFeatRef.name && feat.source === previousFeatRef.source)
			: null;
		const baseScores = Object.fromEntries(Parser.ABIL_ABVS.map(ability => [
			ability,
			this._state.getAbilityBase(ability)
				- (Number(selectedAsi[ability]) || 0)
				- (Number(previousFeat?.appliedEffects?.abilityDeltas?.[ability]) || 0),
		]));
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Change Level ${level} Ability Score Improvement`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const content = e_({tag: "div", clazz: "charsheet__respec-asi-modal"});
		content.append(e_({outer: `<h4>Allocate Points (2 points total)</h4>`}));

		const asiState = {...selectedAsi};
		let pointsRemaining = 2 - Object.values(asiState).reduce((sum, v) => sum + v, 0);

		const pointsDisplay = e_({outer: `<div class="charsheet__respec-points-remaining">Points Remaining: <strong>${pointsRemaining}</strong></div>`});
		content.append(pointsDisplay);

		const asiGrid = e_({tag: "div", clazz: "charsheet__respec-asi-grid"});
		Parser.ABIL_ABVS.forEach(abl => {
			const currentBonus = asiState[abl] || 0;
			const baseScore = baseScores[abl];
			const row = e_({outer: `
				<div class="charsheet__respec-asi-row">
					<span class="charsheet__respec-asi-name">${Parser.attAbvToFull(abl)}</span>
					<span class="charsheet__respec-asi-base">${baseScore}</span>
					<div class="charsheet__respec-asi-controls">
						<button class="ve-btn ve-btn-xs ve-btn-default charsheet__respec-asi-minus" data-abl="${abl}">-</button>
						<span class="charsheet__respec-asi-bonus" data-abl="${abl}">${currentBonus > 0 ? `+${currentBonus}` : "0"}</span>
						<button class="ve-btn ve-btn-xs ve-btn-default charsheet__respec-asi-plus" data-abl="${abl}">+</button>
					</div>
					<span class="charsheet__respec-asi-total">${baseScore + currentBonus}</span>
				</div>
			`});
			asiGrid.append(row);
		});
		content.append(asiGrid);

		// Wire up ASI controls
		content.addEventListener("click", (/** @type {*} */ e) => {
			const plusBtn = e.target.closest(".charsheet__respec-asi-plus");
			if (plusBtn) {
				const abl = plusBtn.dataset.abl;
				const current = asiState[abl] || 0;
				const baseScore = baseScores[abl];
				if (pointsRemaining > 0 && current < 2 && baseScore + current < 20) {
					asiState[abl] = current + 1;
					pointsRemaining--;
					this._updateAsiDisplay(content, asiState, pointsRemaining, pointsDisplay, history, baseScores);
				}
				return;
			}

			const minusBtn = e.target.closest(".charsheet__respec-asi-minus");
			if (minusBtn) {
				const abl = minusBtn.dataset.abl;
				const current = asiState[abl] || 0;
				if (current > 0) {
					asiState[abl] = current - 1;
					if (asiState[abl] === 0) delete asiState[abl];
					pointsRemaining++;
					this._updateAsiDisplay(content, asiState, pointsRemaining, pointsDisplay, history, baseScores);
				}
			}
		});

		// Buttons
		const btnRow = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancelBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancelBtn.addEventListener("click", () => doClose());

		const applyBtn = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "Apply Changes"});
		applyBtn.addEventListener("click", async () => {
			if (pointsRemaining !== 0) {
				JqueryUtil.doToast({type: "warning", content: "Please allocate all 2 points."});
				return;
			}
			if (decision) {
				this._applyImprovementChange(decision, {mode: "asi", asi: asiState});
			} else {
				await this._engine.stageCandidateMutation(async ({state}) => {
					const previousState = this._state;
					this._state = state;
					try {
						await this._applyAsiChange(level, history, asiState);
					} finally {
						this._state = previousState;
					}
				});
			}

			doClose();
			closeParentModal?.();
			this.render();
			JqueryUtil.doToast({type: "success", content: `Updated level ${level} ASI.`});
		});

		btnRow.append(cancelBtn, applyBtn);
		content.append(btnRow);

		modalInner.append(content);
	}

	/**
	 * Edit feat choice
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {Function} closeParentModal - Function to close parent modal
	 */
	_renderFeatChoicesForCandidate (feat, choices, container) {
		container.innerHTML = "";
		const hasChoices = !!(
			choices?.skills
			|| choices?.languages
			|| choices?.ability
			|| choices?.tools
			|| choices?.expertise
			|| choices?.spells
			|| choices?.optionalFeatures?.length
		);
		if (!hasChoices) return true;

		const levelUp = this._page?._levelUp;
		if (typeof levelUp?._renderFeatChoicesUI !== "function") return false;
		const candidateContext = Object.create(levelUp);
		const candidatePage = Object.create(this._page);
		Object.defineProperty(candidatePage, "_state", {get: () => this._state});
		if (this._page?._spells) {
			const candidateSpells = Object.create(this._page._spells);
			Object.defineProperty(candidateSpells, "_state", {get: () => this._state});
			Object.defineProperty(candidateSpells, "_page", {get: () => candidatePage});
			Object.defineProperty(candidatePage, "_spells", {value: candidateSpells});
		}
		Object.defineProperty(candidateContext, "_state", {get: () => this._state});
		Object.defineProperty(candidateContext, "_page", {get: () => candidatePage});
		try {
			levelUp._renderFeatChoicesUI.call(candidateContext, feat, choices, container);
			return true;
		} catch (error) {
			// eslint-disable-next-line no-console
			console.error("[Respec] Failed to render feat choices:", error);
			return false;
		}
	}

	async _editFeat (level, history, closeParentModal, choice = null) {
		const decision = choice?.decision || null;
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Change Level ${level} Feat`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const currentFeat = decision?.type === "asiOrFeat"
			? (decision.selection?.mode === "feat" ? decision.selection.feat : null)
			: decision?.selection?.name
				? decision.selection
				: history.choices?.feat;
		const content = e_({tag: "div", clazz: "charsheet__respec-feat-modal"});

		content.append(e_({outer: `<h4>Select New Feat</h4>`}));
		content.append(e_({outer: `<p class="text-muted mb-2">Current: <strong>${currentFeat?.name || "None"}</strong></p>`}));

		// Feat filter
		const searchRow = e_({tag: "div", clazz: "charsheet__respec-search-row mb-2"});
		const searchInput = e_({tag: "input", clazz: "ve-form-control"});
		searchInput.type = "text";
		searchInput.placeholder = "Search feats...";
		searchRow.append(searchInput);
		content.append(searchRow);

		// Feat list container
		const featList = e_({tag: "div", clazz: "charsheet__respec-feat-list"});
		const featChoicesContainer = e_({tag: "div", clazz: "charsheet__levelup-feat-choices mt-2"});
		content.append(featList, featChoicesContainer);

		// Load feats
		const allFeats = this._page.filterByAllowedSources?.(this._page.getFeats?.() || [])
			|| this._page.getFeats?.()
			|| this._page._levelUp?._feats
			|| [];
		const feats = decision
			? this._getDecisionOptions(decision)
			: CharacterSheetClassUtils.getEligibleFeats(allFeats, this._state, {
				totalLevel: level,
				excludeFeatUid: currentFeat ? `${currentFeat.name}|${currentFeat.source}` : "",
			});
		let selectedFeat = null;
		let selectedFeatChoiceSpec = null;
		const emptyFeatChoices = () => ({
			skills: [],
			languages: [],
			ability: null,
			tools: [],
			expertise: [],
			spellList: null,
			cantrips: [],
			spells: [],
			scribingClass: null,
			optionalFeatures: [],
		});
		const selectFeat = feat => {
			selectedFeat = MiscUtil.copyFast(feat);
			const stored = currentFeat
				&& feat.name === currentFeat.name
				&& feat.source === currentFeat.source
				? this._state.getFeats?.().find(it => it.name === feat.name && it.source === feat.source)
				: null;
			selectedFeat._featChoices = {
				...emptyFeatChoices(),
				...(stored?.choices ? MiscUtil.copyFast(stored.choices) : {}),
			};
			selectedFeatChoiceSpec = CharacterSheetClassUtils.buildFeatChoicesSpec(selectedFeat, {
				state: this._state,
				page: this._page,
			});
			if (!this._renderFeatChoicesForCandidate(selectedFeat, selectedFeatChoiceSpec, featChoicesContainer)) {
				selectedFeat = null;
				selectedFeatChoiceSpec = null;
				JqueryUtil.doToast({type: "danger", content: "Feat choices are unavailable. Reload the character sheet before selecting this feat."});
				return false;
			}
			return true;
		};

		const renderFeats = (filter = "") => {
			featList.innerHTML = "";
			const filterLower = filter.toLowerCase();
			const filtered = feats.filter(f => {
				if (!f.name.toLowerCase().includes(filterLower)) return false;
				return true;
			}).slice(0, 50); // Limit for performance

			if (filtered.length === 0) {
				featList.append(e_({outer: `<p class="text-muted">No feats found.</p>`}));
				return;
			}

			filtered.forEach(feat => {
				const isCurrent = currentFeat && feat.name === currentFeat.name && feat.source === currentFeat.source;
				const isSelected = selectedFeat && feat.name === selectedFeat.name && feat.source === selectedFeat.source;
				const item = e_({outer: `
					<div class="charsheet__respec-feat-item ${isCurrent ? "charsheet__respec-feat-current" : ""} ${isSelected ? "charsheet__respec-feat-selected" : ""}">
						<span class="respec-hover-slot"></span>
						<span class="text-muted">${Parser.sourceJsonToAbv(feat.source)}</span>
					</div>
				`});
				CharacterSheetRespec._setHoverLink(item.querySelector(".respec-hover-slot"), UrlUtil.PG_FEATS, feat.name, feat.source);
				item.addEventListener("click", () => {
					if (!selectFeat(feat)) return;
					featList.querySelectorAll(".charsheet__respec-feat-selected").forEach(el => el.classList.remove("charsheet__respec-feat-selected"));
					item.classList.add("charsheet__respec-feat-selected");
				});
				featList.append(item);
			});
		};

		renderFeats();

		searchInput.addEventListener("input", () => {
			renderFeats(searchInput.value);
		});

		// Buttons
		const btnRow = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancelBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancelBtn.addEventListener("click", () => doClose());

		const applyBtn = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "Apply Changes"});
		applyBtn.addEventListener("click", async () => {
			if (!selectedFeat) {
				JqueryUtil.doToast({type: "warning", content: "Please select a feat."});
				return;
			}
			if (!CharacterSheetClassUtils.isFeatChoiceSpecComplete(selectedFeat, selectedFeatChoiceSpec, {
				state: this._state,
				page: this._page,
			})) {
				JqueryUtil.doToast({type: "warning", content: "Complete every required choice for this feat before staging it."});
				return;
			}
			if (selectedFeat._featChoices?.optionalFeatures?.length) {
				selectedFeat.choices = {
					...selectedFeat._featChoices,
					optionalFeaturePicks: selectedFeat._featChoices.optionalFeatures.flatMap(group => group.picks || []),
				};
			} else {
				selectedFeat.choices = {...selectedFeat._featChoices};
			}

			let didApply = true;
			if (decision?.type === "classFeatProgressionFeat") {
				didApply = this._applyClassFeatProgressionDecisionChange(decision, selectedFeat, selectedFeat.choices);
			} else if (decision) {
				didApply = this._applyImprovementChange(decision, {
					mode: "feat",
					feat: selectedFeat,
					featChoices: selectedFeat.choices,
				});
			} else {
				didApply = true;
				try {
					await this._engine.stageCandidateMutation(async ({state}) => {
						const previousState = this._state;
						this._state = state;
						try {
							if (!await this._applyFeatChange(level, history, selectedFeat)) throw new Error("The feat could not be staged.");
						} finally {
							this._state = previousState;
						}
					});
				} catch (error) {
					didApply = false;
					JqueryUtil.doToast({type: "danger", content: error.message || "The feat could not be staged."});
				}
			}
			if (!didApply) return;

			doClose();
			closeParentModal?.();
			this.render();
			JqueryUtil.doToast({type: "success", content: `Changed feat to ${selectedFeat.name}.`});
		});

		btnRow.append(cancelBtn, applyBtn);
		content.append(btnRow);

		modalInner.append(content);
	}

	_applyClassFeatProgressionDecisionChange (decision, nextFeat, featChoices = {}) {
		try {
			this._engine.stageGraphMutation(decision.id, null, {
				// removeFeat below owns the historical feat teardown, so the
				// engine must not consume the legacy receipt a second time.
				reverseParent: false,
				apply: ({state}) => {
					const previousState = this._state;
					this._state = state;
					try {
						const previous = decision.selection;
						if (previous?.name) state.removeFeat(previous.name, previous.source);
						const feat = MiscUtil.copyFast(nextFeat);
						feat.choices = MiscUtil.copyFast(featChoices);
						feat._featChoices = MiscUtil.copyFast(featChoices);
						const eligibility = CharacterSheetClassUtils.evaluateFeatPrerequisites(feat, state, {
							totalLevel: decision.characterLevel,
							excludeFeatUid: previous?.name ? `${previous.name}|${previous.source}` : "",
						});
						if (!eligibility.eligible) throw new Error(eligibility.reasons[0] || "That feat's prerequisites are not met.");
						const added = state.addFeat(feat, {
							allSpells: this._page.getSpells?.() || [],
							skipAdditionalSpellChoices: CharacterSheetClassUtils.hasCollectedInlineSpellChoices(feat),
							classFeatProgression: {
								className: decision.className,
								classSource: decision.classSource,
								level: decision.classLevel,
								progressionName: decision.meta?.progressionName || decision.label,
							},
						});
						if (!added) throw new Error(`${feat.name} is already selected.`);
						CharacterSheetClassUtils.applyFeatBonuses(state, feat, featChoices);
						this._recalcHpPreservingHealing();
						return {
							selection: {
								progressionName: decision.meta?.progressionName || decision.label,
								name: feat.name,
								source: feat.source,
								category: decision.meta?.category,
							},
						};
					} finally {
						this._state = previousState;
					}
				},
			});
			return true;
		} catch (error) {
			JqueryUtil.doToast({type: "danger", content: error.message || "The class feat could not be staged."});
			return false;
		}
	}

	/**
	 * Edit a class-level featProgression feat (e.g. Fighting Style). Re-picks
	 * from the same feat category, removes the previously chosen feat, and adds
	 * the replacement through the real feat system so passive bonuses follow.
	 * @param {number} level - The level where the feat was chosen
	 * @param {object} history - The history entry
	 * @param {object} choice - The choice info (includes label, current, index)
	 * @param {Function} closeParentModal - Function to close parent modal
	 */
	async _editClassFeatProgressionFeat (level, history, choice, closeParentModal) {
		const entry = history.choices?.classFeatProgressionFeats?.[choice.index];
		if (!entry) {
			JqueryUtil.doToast({type: "warning", content: "No class feat found at this level."});
			return;
		}

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Change ${entry.progressionName || "Class Feat"}`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const content = e_({tag: "div", clazz: "charsheet__respec-feat-modal"});
		content.append(e_({outer: `<h4>Select New ${entry.progressionName || "Class Feat"}</h4>`}));
		content.append(e_({outer: `<p class="text-muted mb-2">Current: <strong>${entry.name || "None"}</strong></p>`}));

		// Build category-filtered feat pool, excluding feats already taken (except the current one).
		const allFeats = this._page.filterByAllowedSources?.(this._page.getFeats() || []) || (this._page.getFeats() || []);
		const knownFeatNames = new Set((this._state.getFeats() || [])
			.filter(f => !(f.name === entry.name && f.source === entry.source))
			.map(f => `${f.name}|${f.source}`.toLowerCase()));
		const pool = CharacterSheetClassUtils.filterFeatsByCategory(allFeats, entry.category || ["FS"])
			.filter(f => !knownFeatNames.has(`${f.name}|${f.source}`.toLowerCase()))
			.sort((a, b) => a.name.localeCompare(b.name));

		const featList = e_({tag: "div", clazz: "charsheet__respec-feat-list"});
		content.append(featList);

		let selectedFeat = null;
		if (!pool.length) {
			featList.append(e_({outer: `<p class="text-muted">No alternative feats available in this category.</p>`}));
		} else {
			pool.forEach(feat => {
				const isCurrent = feat.name === entry.name && feat.source === entry.source;
				const item = e_({outer: `
					<div class="charsheet__respec-feat-item ${isCurrent ? "charsheet__respec-feat-current" : ""}">
						<span class="respec-hover-slot"></span>
						<span class="text-muted">${Parser.sourceJsonToAbv(feat.source)}</span>
					</div>
				`});
				CharacterSheetRespec._setHoverLink(item.querySelector(".respec-hover-slot"), UrlUtil.PG_FEATS, feat.name, feat.source);
				item.addEventListener("click", () => {
					selectedFeat = feat;
					featList.querySelectorAll(".charsheet__respec-feat-selected").forEach(el => el.classList.remove("charsheet__respec-feat-selected"));
					item.classList.add("charsheet__respec-feat-selected");
				});
				featList.append(item);
			});
		}

		const btnRow = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancelBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancelBtn.addEventListener("click", () => doClose());

		const applyBtn = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "Apply Changes"});
		applyBtn.addEventListener("click", async () => {
			if (!selectedFeat) {
				JqueryUtil.doToast({type: "warning", content: "Please select a feat."});
				return;
			}
			if (selectedFeat.name === entry.name && selectedFeat.source === entry.source) {
				doClose();
				return;
			}

			await this._engine.stageCandidateMutation(async ({state}) => {
				const previousState = this._state;
				this._state = state;
				try {
					await this._applyClassFeatProgressionFeatChange(level, history, choice.index, entry, selectedFeat);
				} finally {
					this._state = previousState;
				}
			});

			doClose();
			closeParentModal();
			this.render();
			JqueryUtil.doToast({type: "success", content: `Changed ${entry.progressionName || "feat"} to ${selectedFeat.name}.`});
		});

		btnRow.append(cancelBtn, applyBtn);
		content.append(btnRow);

		modalInner.append(content);
	}

	/**
	 * Swap a class-level featProgression feat: remove the old feat, add the new
	 * one with the same provenance tag, and update level history.
	 * @param {number} level
	 * @param {object} history
	 * @param {number} index - Index into `history.choices.classFeatProgressionFeats`
	 * @param {object} oldEntry - The previously chosen feat record
	 * @param {object} newFeat - The replacement feat data
	 */
	async _applyClassFeatProgressionFeatChange (level, history, index, oldEntry, newFeat) {
		// Remove the previously granted feat (cleans up its bonuses/spells/modifiers).
		const existing = (this._state.getFeats() || []).find(f => f.name === oldEntry.name && f.source === oldEntry.source);
		if (existing) this._state.removeFeat?.(existing.id || existing.name, existing.source);

		// Add the replacement through the real feat system so passive bonuses follow.
		const featToAdd = {...newFeat};
		const added = this._state.addFeat(featToAdd, {
			allSpells: this._page.getSpells?.(),
			classFeatProgression: {
				className: history.class?.name,
				classSource: history.class?.source,
				level,
				progressionName: oldEntry.progressionName,
			},
		});
		if (added) CharacterSheetClassUtils.applyFeatBonuses(this._state, featToAdd);

		// Update history record for this slot.
		const updatedList = [...(history.choices.classFeatProgressionFeats || [])];
		updatedList[index] = {
			progressionName: oldEntry.progressionName,
			name: newFeat.name,
			source: newFeat.source,
			category: oldEntry.category,
		};
		this._state.updateLevelChoice(level, {classFeatProgressionFeats: updatedList});

		// Feats may grant ability bonuses or hpPerLevel modifiers — recalc max HP.
		this._recalcHpPreservingHealing();
	}

	/**
	 * Edit feature choice (fighting style, specialty, warden, etc.)
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {object} choice - The choice info (includes label, current, index)
	 * @param {Function} closeParentModal - Function to close parent modal
	 */
	async _editFeatureChoice (level, history, choice, closeParentModal, {inlineHost = null} = {}) {
		let modalInner;
		let doClose;
		if (inlineHost) {
			inlineHost.replaceChildren();
			modalInner = inlineHost;
			doClose = () => inlineHost.replaceChildren();
		} else {
			const modal = await CharacterSheetModal.pGetShow({
				title: `Change ${choice.label}`,
				isMinHeight0: true,
				isWidth100: true,
				isUncappedWidth: true,
				cbClose: () => {},
			});
			modalInner = modal.eleModalInner;
			doClose = modal.doClose;
		}

		const currentChoice = history.choices.featureChoices[choice.index];
		const content = e_({tag: "div", clazz: "charsheet__respec-feature-modal"});

		content.append(e_({outer: `<p class="text-muted mb-2">Current: <strong>${currentChoice.choice}</strong></p>`}));

		// Get available options for this feature
		const parentFeatureName = currentChoice.featureName;
		const classFeatures = this._page.getClassFeatures();
		const replayChoice = history.choices.replayData?.featureChoices?.[choice.index];
		const acquisitionLevel = Number(
			currentChoice.acquisitionLevel
				|| replayChoice?.acquisitionLevel
				|| this._state.getLevelHistory()
					.filter(entry =>
						entry.level <= level
							&& entry.class?.name === history.class.name
							&& entry.class?.source === history.class.source)
					.length,
		) || 1;

		// Find the parent feature that defines the options
		const parentFeature = classFeatures.find(f =>
			f.name === parentFeatureName
				&& f.className === history.class.name
				&& f.level === acquisitionLevel,
		) || classFeatures.find(f =>
			f.name === parentFeatureName
				&& f.className === history.class.name,
		);

		if (!parentFeature) {
			content.append(e_({outer: `<p class="text-danger">Could not find parent feature "${parentFeatureName}" to load options.</p>`}));
			const closeBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default mt-3", txt: "Close"});
			closeBtn.addEventListener("click", () => doClose());
			content.append(closeBtn);
			modalInner.append(content);
			return;
		}

		// Get options from the parent feature (static ClassUtils method — extracted from LevelUp)
		const optionGroups = CharacterSheetClassUtils.findFeatureOptions(parentFeature, level, classFeatures);

		if (!optionGroups.length || !optionGroups[0].options?.length) {
			content.append(e_({outer: `<p class="text-danger">No alternative options found for this feature.</p>`}));
			const closeBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default mt-3", txt: "Close"});
			closeBtn.addEventListener("click", () => doClose());
			content.append(closeBtn);
			modalInner.append(content);
			return;
		}

		// Get existing features to filter already-chosen options
		const existingFeatures = this._state.getFeatures();
		const poolOptionNames = new Set(optionGroups[0].options.map(opt => opt.name));
		const existingFeatureNames = new Set(existingFeatures
			.filter(feature =>
				feature.isFeatureOption
					&& feature.className === history.class.name
					&& poolOptionNames.has(feature.name))
			.map(feature => feature.name));

		// Filter to options not already chosen (except current)
		const availableOptions = optionGroups[0].options.filter(opt => {
			if (opt.name === currentChoice.choice) return true; // Always show current
			return !existingFeatureNames.has(opt.name);
		});

		content.append(e_({outer: `<h5>Select New ${choice.label}</h5>`}));

		// Option list
		const optionList = e_({tag: "div", clazz: "charsheet__respec-feat-list"});
		let selectedOption = null;

		availableOptions.forEach(opt => {
			const isCurrent = opt.name === currentChoice.choice;
			const item = e_({outer: `
				<div class="charsheet__respec-feat-item ${isCurrent ? "charsheet__respec-feat-current" : ""}">
					<span class="respec-hover-slot"></span>
					${opt.source ? `<span class="text-muted">${Parser.sourceJsonToAbv(opt.source)}</span>` : ""}
				</div>
			`});

			// Add hover link — determine page from option type
			const nameEl = item.querySelector(".respec-hover-slot");
			if (opt.type === "classFeature" && opt.ref) {
				const parts = opt.ref.split("|");
				const featureSource = parts[2] || opt.source || history.class?.source;
				try {
					const hash = UrlUtil.encodeArrayForHash(parts[0], parts[1], parts[2], parts[3], featureSource);
					const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_CLASS_SUBCLASS_FEATURES, source: featureSource, hash});
					nameEl.innerHTML = `<a href="${UrlUtil.PG_CLASS_SUBCLASS_FEATURES}#${hash}" ${hoverAttrs} target="_blank" rel="noopener noreferrer">${opt.name}</a>`;
				} catch (e) {
					nameEl.textContent = opt.name;
				}
			} else if (opt.source) {
				const page = CharacterSheetClassUtils.isCombatMethod?.(opt) ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES;
				CharacterSheetRespec._setHoverLink(nameEl, page, opt.name, opt.source);
			} else {
				nameEl.textContent = opt.name;
			}

			item.addEventListener("click", () => {
				selectedOption = opt;
				optionList.querySelectorAll(".charsheet__respec-feat-selected").forEach(el => el.classList.remove("charsheet__respec-feat-selected"));
				item.classList.add("charsheet__respec-feat-selected");
			});

			optionList.append(item);
		});

		content.append(optionList);

		// Buttons
		const btnRow = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancelBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancelBtn.addEventListener("click", () => doClose());

		const applyBtn = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "Apply Changes"});
		applyBtn.addEventListener("click", async () => {
			if (!selectedOption) {
				JqueryUtil.doToast({type: "warning", content: "Please select an option."});
				return;
			}

			if (selectedOption.name === currentChoice.choice) {
				JqueryUtil.doToast({type: "info", content: "No changes made."});
				doClose();
				return;
			}

			await this._applyFeatureChoiceChange(level, history, choice.index, currentChoice, selectedOption);

			doClose();
			if (!inlineHost) closeParentModal?.();
			this.render();
			JqueryUtil.doToast({type: "success", content: `Changed ${choice.label} to ${selectedOption.name}.`});
		});

		btnRow.append(cancelBtn, applyBtn);
		content.append(btnRow);

		modalInner.append(content);
	}

	/**
	 * Apply feature choice change
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {number} choiceIndex - Index in featureChoices array
	 * @param {object} oldChoice - The old choice {featureName, choice, source}
	 * @param {object} newOption - The new option to apply
	 */
	async _applyFeatureChoiceChange (level, history, choiceIndex, oldChoice, newOption) {
		const decision = this._engine?.manifest?.decisions?.find(it =>
			it.type === "featureChoice"
			&& Number(it.characterLevel) === Number(level)
			&& (Number(it.slot) === Number(choiceIndex) || it.sourceKey === oldChoice?.featureName),
		);
		if (!decision && !this._engine?.stageCandidateMutation) {
			return this._applyFeatureChoiceChangeInner(level, history, choiceIndex, oldChoice, newOption);
		}
		if (!decision) {
			return this._engine.stageCandidateMutation(async ({state}) => {
				const previousState = this._state;
				this._state = state;
				try {
					return await this._applyFeatureChoiceChangeInner(level, history, choiceIndex, oldChoice, newOption);
				} finally {
					this._state = previousState;
				}
			});
		}
		return this._engine.stageGraphMutation(decision.id, newOption, {
			apply: async ({state}) => {
				const previousState = this._state;
				this._state = state;
				try {
					return await this._applyFeatureChoiceChangeInner(level, history, choiceIndex, oldChoice, newOption);
				} finally {
					this._state = previousState;
				}
			},
		});
	}

	async _applyFeatureChoiceChangeInner (level, history, choiceIndex, oldChoice, newOption) {
		const replayChoice = history.choices.replayData?.featureChoices?.[choiceIndex];
		const acquisitionLevel = Number(
			oldChoice.acquisitionLevel
				|| replayChoice?.acquisitionLevel
				|| this._state.getLevelHistory()
					.filter(entry =>
						entry.level <= level
							&& entry.class?.name === history.class.name
							&& entry.class?.source === history.class.source)
					.length,
		) || 1;
		const decision = this._engine?.manifest?.decisions?.find(it =>
			it.type === "featureChoice"
			&& Number(it.characterLevel) === Number(level)
			&& (Number(it.slot) === Number(choiceIndex) || it.sourceKey === oldChoice?.featureName),
		);
		const catalogs = {
			classFeatures: this._page.getClassFeatures(),
			subclassFeatures: this._page.getSubclassFeatures() || [],
			optionalFeatures: this._page.getOptionalFeatures(),
		};
		const currentClass = this._state.getClasses().find(cls =>
			cls.name === history.class.name && cls.source === history.class.source);
		const result = CharacterSheetClassUtils.replaceStructuredFeatureChoice({
			state: this._state,
			page: this._page,
			characterLevel: level,
			classLevel: acquisitionLevel,
			className: history.class.name,
			classSource: history.class.source,
			subclassName: currentClass?.subclass?.name,
			subclassShortName: currentClass?.subclass?.shortName,
			subclassSource: currentClass?.subclass?.source,
			parentFeature: oldChoice.featureName,
			parentSource: replayChoice?.parentSource || null,
			choiceIndex,
			oldChoice,
			newOption,
			catalogs,
			decision,
			sourceDecisionKey: decision?.semanticKey,
			persistHistory: true,
			recalculate: true,
		});

		// Recalculate derived values after the swap
		this._recalcHpPreservingHealing();
		return result;
	}

	/**
	 * Update ASI display after change
	 */
	_updateAsiDisplay (section, asiState, pointsRemaining, pointsDisplay, history, baseScores = null) {
		pointsDisplay.innerHTML = `Points Remaining: <strong>${pointsRemaining}</strong>`;
		pointsDisplay.classList.toggle("text-danger", pointsRemaining < 0);
		pointsDisplay.classList.toggle("text-success", pointsRemaining === 0);

		Parser.ABIL_ABVS.forEach(abl => {
			const bonus = asiState[abl] || 0;
			const baseScore = baseScores?.[abl] ?? (this._state.getAbilityBase(abl) - (history.choices?.asi?.[abl] || 0));
			const bonusEl = section.querySelector(`.charsheet__respec-asi-bonus[data-abl="${abl}"]`);
			if (bonusEl) bonusEl.textContent = bonus > 0 ? `+${bonus}` : "0";
			const totalEl = section.querySelector(`.charsheet__respec-asi-row:has([data-abl="${abl}"]) .charsheet__respec-asi-total`);
			if (totalEl) totalEl.textContent = baseScore + bonus;
		});
	}

	/**
	 * Apply ASI change
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {object} newAsi - New ASI allocation
	 */
	async _applyAsiChange (level, history, newAsi) {
		const decision = this._engine?.manifest?.decisions?.find(it =>
			it.type === "asi" && Number(it.characterLevel) === Number(level),
		);
		if (decision) {
			this._applyImprovementChange(decision, {mode: "asi", asi: newAsi});
			return;
		}
		const oldAsi = history.choices?.asi || {};

		// Revert old ASI bonuses
		Object.entries(oldAsi).forEach(([abl, bonus]) => {
			const current = this._state.getAbilityBase(abl);
			this._state.setAbilityBase(abl, current - bonus);
		});

		// Apply new ASI bonuses
		Object.entries(newAsi).forEach(([abl, bonus]) => {
			const current = this._state.getAbilityBase(abl);
			this._state.setAbilityBase(abl, CharacterSheetClassUtils.capAbilityIncrease(current, bonus, 20));
		});

		// Update history - only update ASI, preserve feat (Thelemar rule support)
		this._state.updateLevelChoice(level, {
			asi: newAsi,
		});

		// Update the ASI tracking feature
		const features = this._state.getFeatures();
		const asiFeature = features.find(f => f.isAsiChoice && f.level === level);
		if (asiFeature) {
			const increases = Object.entries(newAsi)
				.map(([abl, val]) => `${Parser.attAbvToFull(abl)} +${val}`)
				.join(", ");
			asiFeature.description = `<p><strong>Ability Score Increases:</strong> ${increases}</p>`;
		}

		// CON ASI changes ripple to max HP via _calculateMaxHp.
		this._recalcHpPreservingHealing();
	}

	_applyImprovementChange (decision, next) {
		if (!decision || !["asi", "feat", "asiOrFeat"].includes(decision.type)) return false;
		const previousFeat = decision.type === "feat"
			? decision.selection
			: decision.selection?.mode === "feat" ? decision.selection.feat : null;
		if (next?.mode === "feat"
				&& previousFeat?.name === next.feat?.name
				&& previousFeat?.source === next.feat?.source) {
			const stored = this._state.getFeats().find(feat =>
				feat.name === previousFeat.name && feat.source === previousFeat.source,
			);
			const isOwnedByDecision = !stored?.sourceDecisionKey || stored.sourceDecisionKey === decision.semanticKey;
			if (isOwnedByDecision
				&& JSON.stringify(stored?.choices || {}) === JSON.stringify(next.featChoices || {})) return true;
		}
		const hasAbilityChildReceipt = this._engine.manifest.decisions.some(candidate =>
			candidate.type === "nestedAbility"
				&& candidate.parentSemanticKey === decision.semanticKey
				&& candidate.receipt?.effects?.some(effect => effect.type === "abilityDelta"),
		);
		try {
			this._engine.stageGraphMutation(decision.id, null, {
				apply: ({state}) => {
					const previousState = this._state;
					this._state = state;
					try {
						const result = this._applyImprovementChangeInner(decision, next, {
							throwOnError: true,
							skipLedgerUpdate: true,
							skipPreviousFeatAbilityDeltas: hasAbilityChildReceipt,
						});
						return {selection: result?.selection};
					} finally {
						this._state = previousState;
					}
				},
			});
			return true;
		} catch (error) {
			JqueryUtil.doToast({type: "danger", content: error.message || "The improvement could not be staged."});
			return false;
		}
	}

	_applyImprovementChangeInner (
		decision,
		next,
		{throwOnError = false, skipLedgerUpdate = false, skipPreviousFeatAbilityDeltas = false} = {},
	) {
		if (!decision || !["asi", "feat", "asiOrFeat"].includes(decision.type)) return false;
		const snapshot = this._state.toJson();
		try {
			const previous = decision.selection || null;
			const previousAsi = decision.type === "asi"
				? previous
				: previous?.mode === "asi"
					? previous.asi || previous.legacyAsi
					: previous?.legacyAsi;
			const previousFeat = decision.type === "feat"
				? (previous?.name ? previous : null)
				: previous?.mode === "feat"
					? previous.feat
					: null;
			const storedPreviousFeat = previousFeat?.name
				? this._state.getFeats().find(feat =>
					feat.name === previousFeat.name && feat.source === previousFeat.source,
				)
				: null;
			const ownsPreviousFeat = !!storedPreviousFeat
				&& (!storedPreviousFeat.sourceDecisionKey || storedPreviousFeat.sourceDecisionKey === decision.semanticKey);
			let pairedFeat = null;
			if (decision.type === "asi") {
				const pairedDecision = this._engine.manifest.decisions.find(it =>
					it.type === "feat"
						&& Number(it.characterLevel) === Number(decision.characterLevel)
						&& it.className === decision.className
						&& it.classSource === decision.classSource
						&& it.selection?.name,
				);
				if (pairedDecision) {
					const stored = this._state.getFeats().find(feat =>
						feat.name === pairedDecision.selection.name && feat.source === pairedDecision.selection.source,
					);
					const canonical = (this._page.getFeats?.() || []).find(feat =>
						feat.name === pairedDecision.selection.name && feat.source === pairedDecision.selection.source,
					);
					if (stored || canonical) {
						const choices = MiscUtil.copyFast(stored?.choices || {});
						pairedFeat = {
							decision: pairedDecision,
							feat: {
								...MiscUtil.copyFast(canonical || {}),
								...MiscUtil.copyFast(stored || {}),
								choices,
								_featChoices: choices,
							},
						};
						this._state.removeFeat(pairedDecision.selection.name, pairedDecision.selection.source);
					}
				}
			}

			Object.entries(previousAsi || {}).forEach(([ability, bonus]) => {
				this._state.setAbilityBase(ability, Math.max(1, this._state.getAbilityBase(ability) - (Number(bonus) || 0)));
			});
			this._state.getFeatures()
				.filter(feature => feature.isAsiChoice && Number(feature.level) === Number(decision.characterLevel))
				.forEach(feature => {
					if (feature.id) this._state.removeFeature(feature.id);
					else this._state._data.features = this._state._data.features.filter(it => it !== feature);
				});
			if (previousFeat?.name && ownsPreviousFeat) {
				this._state.removeFeat(storedPreviousFeat.id || previousFeat.name, previousFeat.source, {
					skipAbilityDeltas: skipPreviousFeatAbilityDeltas,
				});
			}

			let selection;
			if (next.mode === "asi") {
				if (decision.type === "feat") throw new Error("This level grants a feat and cannot be changed to an ASI.");
				const asi = MiscUtil.copyFast(next.asi || {});
				const total = Object.values(asi).reduce((sum, value) => sum + (Number(value) || 0), 0);
				if (total !== 2) throw new Error("An Ability Score Improvement must allocate exactly 2 points.");
				Object.entries(asi).forEach(([ability, bonus]) => {
					const current = this._state.getAbilityBase(ability);
					this._state.setAbilityBase(ability, CharacterSheetClassUtils.capAbilityIncrease(current, Number(bonus) || 0, 20));
				});
				this._state.addFeature({
					name: "Ability Score Improvement",
					source: decision.classSource,
					className: decision.className,
					classSource: decision.classSource,
					level: decision.characterLevel,
					featureType: "Class",
					description: `<p><strong>Ability Score Increases:</strong> ${Object.entries(asi).map(([ability, value]) => `${Parser.attAbvToFull(ability)} +${value}`).join(", ")}</p>`,
					isAsiChoice: true,
				});
				selection = decision.type === "asi" ? asi : {mode: "asi", asi};
			} else if (next.mode === "feat") {
				const feat = MiscUtil.copyFast(next.feat);
				if (!feat?.name || !feat?.source) throw new Error("Select a valid feat.");
				const eligibility = CharacterSheetClassUtils.evaluateFeatPrerequisites(feat, this._state, {
					totalLevel: decision.characterLevel,
					excludeFeatUid: ownsPreviousFeat ? `${previousFeat.name}|${previousFeat.source}` : "",
					featCatalog: this._page.getFeats?.() || [],
				});
				if (!eligibility.eligible) throw new Error(eligibility.reasons[0] || "That feat's prerequisites are not met.");
				const featChoices = MiscUtil.copyFast(next.featChoices || feat.choices || feat._featChoices || {});
				feat.choices = featChoices;
				feat._featChoices = featChoices;
				feat.sourceDecisionKey = decision.semanticKey;
				const added = this._state.addFeat(feat, {
					allSpells: this._page.getSpells?.() || [],
					skipAdditionalSpellChoices: CharacterSheetClassUtils.hasCollectedInlineSpellChoices(feat),
					sourceDecisionKey: decision.semanticKey,
				});
				if (!added) throw new Error(`${feat.name} is already selected.`);
				CharacterSheetClassUtils.applyFeatBonuses(this._state, feat, featChoices);
				selection = decision.type === "asiOrFeat"
					? {mode: "feat", feat: {name: feat.name, source: feat.source}}
					: {name: feat.name, source: feat.source};
			} else {
				throw new Error("Choose either an ASI or a feat.");
			}

			if (pairedFeat) {
				const eligibility = CharacterSheetClassUtils.evaluateFeatPrerequisites(pairedFeat.feat, this._state, {
					totalLevel: pairedFeat.decision.characterLevel,
					featCatalog: this._page.getFeats?.() || [],
				});
				if (!eligibility.eligible) {
					throw new Error(`${pairedFeat.feat.name} is no longer legal after this ASI change: ${eligibility.reasons[0] || "prerequisite not met"}.`);
				}
				const added = this._state.addFeat(pairedFeat.feat, {
					allSpells: this._page.getSpells?.() || [],
					skipAdditionalSpellChoices: CharacterSheetClassUtils.hasCollectedInlineSpellChoices(pairedFeat.feat),
					sourceDecisionKey: pairedFeat.decision.semanticKey,
				});
				if (!added) throw new Error(`${pairedFeat.feat.name} could not be reapplied.`);
				CharacterSheetClassUtils.applyFeatBonuses(this._state, pairedFeat.feat, pairedFeat.feat.choices);
			}

			// Ledger persistence is deliberately owned by the outer
			// stageGraphMutation call. Keeping this inner helper mechanics-only
			// prevents a caller from mutating first and snapshotting afterward.
			if (!skipLedgerUpdate) throw new Error("Improvement mechanics must be staged through the Respec engine.");
			this._recalcHpPreservingHealing();
			return {selection};
		} catch (error) {
			if (throwOnError) throw error;
			this._state.loadFromJson(snapshot);
			this._engine.refreshManifest();
			JqueryUtil.doToast({type: "danger", content: error.message || "The improvement could not be staged."});
			return false;
		}
	}

	/**
	 * Apply feat change
	 * @param {number} level - The level
	 * @param {object} history - The history entry
	 * @param {object} newFeat - The new feat
	 */
	async _applyFeatChange (level, history, newFeat) {
		const decision = this._engine?.manifest?.decisions?.find(it =>
			it.characterLevel === level && ["feat", "asiOrFeat"].includes(it.type),
		);
		if (decision) {
			return this._applyImprovementChange(decision, {
				mode: "feat",
				feat: newFeat,
				featChoices: newFeat.choices || newFeat._featChoices || {},
			});
		}

		const oldFeat = history.choices?.feat;
		if (oldFeat?.name) this._state.removeFeat(oldFeat.name, oldFeat.source);
		const feat = MiscUtil.copyFast(newFeat);
		feat.choices = feat.choices || feat._featChoices || {};
		if (!this._state.addFeat(feat, {allSpells: this._page.getSpells?.() || []})) return false;
		CharacterSheetClassUtils.applyFeatBonuses(this._state, feat, feat.choices);
		this._state.updateLevelChoice(level, {feat: {name: feat.name, source: feat.source}});
		this._recalcHpPreservingHealing();
		return true;
	}

	/**
	 * Edit subclass choice - shows cascade warning and handles feature removal
	 * @param {number} level - The level where subclass was chosen
	 * @param {object} history - The history entry
	 * @param {Function} closeParentModal - Function to close parent modal
	 */
	async _editSubclass (level, history, closeParentModal) {
		const classEntry = this._state.getClasses().find(cls => cls.name === history.class.name && cls.source === history.class.source);
		const currentSubclass = history.choices?.subclass || classEntry?.subclass || null;

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Change ${history.class.name} Subclass`,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const content = e_({tag: "div", clazz: "charsheet__respec-subclass-modal"});

		// Show current subclass
		content.append(e_({outer: `<p class="text-muted mb-2">Current Subclass: <strong>${currentSubclass?.name || "Not selected"}</strong></p>`}));

		// Get available subclasses for this class
		const classes = this._page.getClasses();
		const classData = classes.find(c => c.name === history.class.name && c.source === history.class.source);

		if (!classData?.subclasses?.length) {
			content.append(e_({outer: `<p class="text-danger">Could not find subclass options for ${history.class.name}.</p>`}));
			const closeBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default mt-3", txt: "Close"});
			closeBtn.addEventListener("click", () => doClose());
			content.append(closeBtn);
			modalInner.append(content);
			return;
		}

		// Filter subclasses by allowed sources
		let availableSubclasses = classData.subclasses;
		if (this._page.filterByAllowedSources) {
			availableSubclasses = this._page.filterByAllowedSources(availableSubclasses);
		}

		// Calculate what will be removed
		const featuresToRemove = this._getSubclassFeatures(currentSubclass, history.class);
		const willRemoveCount = featuresToRemove.length;

		// Show cascade warning
		if (willRemoveCount > 0) {
			const warning = e_({outer: `
				<div class="charsheet__respec-cascade-warning">
					<h5><span class="text-warning">\u26a0\ufe0f</span> Features to be removed (${willRemoveCount}):</h5>
					<ul class="charsheet__respec-cascade-list"></ul>
				</div>
			`});
			const warningList = warning.querySelector(".charsheet__respec-cascade-list");
			featuresToRemove.slice(0, 10).forEach(f => {
				warningList.append(e_({outer: `<li>${f.name} <span class="text-muted">(Level ${f.level})</span></li>`}));
			});
			if (willRemoveCount > 10) {
				warningList.append(e_({outer: `<li class="text-muted">...and ${willRemoveCount - 10} more</li>`}));
			}
			content.append(warning);
		}

		// Subclass selection
		content.append(e_({outer: `<h5>Select New Subclass</h5>`}));

		const searchRow = e_({tag: "div", clazz: "charsheet__respec-search-row mb-2"});
		const searchInput = e_({tag: "input", clazz: "ve-form-control"});
		searchInput.type = "text";
		searchInput.placeholder = "Search subclasses...";
		searchRow.append(searchInput);
		content.append(searchRow);

		const subclassList = e_({tag: "div", clazz: "charsheet__respec-feat-list"});
		let selectedSubclass = null;

		const renderSubclasses = (filter = "") => {
			subclassList.innerHTML = "";
			const filterLower = filter.toLowerCase();
			const filtered = availableSubclasses.filter(sc => {
				if (!sc.name.toLowerCase().includes(filterLower)) return false;
				return true;
			}).slice(0, 30);

			if (filtered.length === 0) {
				subclassList.append(e_({outer: `<p class="text-muted">No subclasses found.</p>`}));
				return;
			}

			filtered.forEach(subclass => {
				const isCurrent = subclass.name === currentSubclass?.name && subclass.source === currentSubclass?.source;
				const isSelected = selectedSubclass && subclass.name === selectedSubclass.name && subclass.source === selectedSubclass.source;
				const item = e_({outer: `
					<div class="charsheet__respec-feat-item ${isCurrent ? "charsheet__respec-feat-current" : ""} ${isSelected ? "charsheet__respec-feat-selected" : ""}">
						<span class="respec-hover-slot"></span>
						<span class="text-muted">${Parser.sourceJsonToAbv(subclass.source)}</span>
					</div>
				`});
				CharacterSheetRespec._setSubclassHoverLink(item.querySelector(".respec-hover-slot"), this._page, subclass);
				item.addEventListener("click", () => {
					selectedSubclass = subclass;
					subclassList.querySelectorAll(".charsheet__respec-feat-selected").forEach(el => el.classList.remove("charsheet__respec-feat-selected"));
					item.classList.add("charsheet__respec-feat-selected");
				});
				subclassList.append(item);
			});
		};

		renderSubclasses();

		searchInput.addEventListener("input", () => {
			renderSubclasses(searchInput.value);
		});

		content.append(subclassList);

		// Buttons
		const btnRow = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancelBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancelBtn.addEventListener("click", () => doClose());

		const applyBtn = e_({tag: "button", clazz: "ve-btn ve-btn-danger", txt: "Change Subclass"});
		applyBtn.addEventListener("click", async () => {
			if (!selectedSubclass) {
				JqueryUtil.doToast({type: "warning", content: "Please select a subclass."});
				return;
			}

			if (selectedSubclass.name === currentSubclass?.name && selectedSubclass.source === currentSubclass?.source) {
				JqueryUtil.doToast({type: "info", content: "No changes made."});
				doClose();
				return;
			}

			// Confirm cascade removal
			const confirmed = await InputUiUtil.pGetUserBoolean(/** @type {*} */ ({
				title: "Confirm Subclass Change",
				htmlDescription: `<p>This will remove <strong>${willRemoveCount}</strong> features from your character and add all features from <strong>${selectedSubclass.name}</strong> up to your current level.</p><p>Are you sure?</p>`,
				textYes: "Change Subclass",
				textNo: "Cancel",
			}));

			if (!confirmed) return;

			await this._engine.stageCandidateMutation(async ({state}) => {
				const previousState = this._state;
				this._state = state;
				try {
					await this._applySubclassChange(level, history, currentSubclass, selectedSubclass);
				} finally {
					this._state = previousState;
				}
			});

			doClose();
			closeParentModal();
			this.render();
			JqueryUtil.doToast({type: "success", content: `Changed subclass to ${selectedSubclass.name}.`});
		});

		btnRow.append(cancelBtn, applyBtn);
		content.append(btnRow);

		modalInner.append(content);
	}

	/**
	 * Get all features that belong to a specific subclass
	 * @param {object} subclass - The subclass {name, shortName, source}
	 * @returns {Array} Array of features to remove
	 */
	_getSubclassFeatures (subclass, classContext = null) {
		if (!subclass) return [];
		const features = this._state.getFeatures();
		return features.filter(f => {
			// When a class context is supplied, only consider features belonging to that
			// class so a subclass swap on one class of a multiclass character never
			// removes another class's features (subclass shortNames can collide).
			// Scope by className only — a feature's classSource (e.g. "PHB") legitimately
			// differs from the class entry's source (e.g. "XPHB"), so it is not a safe
			// discriminator.
			if (classContext?.name && f.className && f.className !== classContext.name) return false;

			// Check if feature is explicitly a subclass feature
			if (f.isSubclassFeature) {
				// Match by subclass name or short name
				if (f.subclassName === subclass.name || f.subclassShortName === subclass.shortName) {
					return true;
				}
			}
			// Check if feature has subclass source matching
			if (f.subclassSource === subclass.source && f.subclassShortName === subclass.shortName) {
				return true;
			}
			return false;
		});
	}

	/**
	 * Apply subclass change - removes old features and adds new ones
	 * @param {number} level - The level where subclass was chosen
	 * @param {object} history - The history entry
	 * @param {object} oldSubclass - The old subclass
	 * @param {object} newSubclass - The new subclass
	 */
	async _applySubclassChange (level, history, oldSubclass, newSubclass) {
		// Get current total level for this class
		const classes = this._state.getClasses();
		const classEntry = classes.find(c =>
			c.name === history.class.name
			&& (!history.class.source || c.source === history.class.source));
		const classLevel = classEntry?.level || 1;
		const subclassSourceDecisionKey = this._engine?.manifest?.decisions?.find(decision =>
			decision.type === "subclass"
				&& decision.characterLevel === Number(history.level ?? level)
				&& decision.className === history.class.name
				&& decision.classSource === history.class.source,
		)?.semanticKey
			|| history.decisions?.find(decision => decision.type === "subclass")?.semanticKey
			|| null;

		// Remove old subclass features using proper API (scoped to the changed class)
		const featuresToRemove = this._getSubclassFeatures(oldSubclass, history.class);
		featuresToRemove.forEach(f => {
			this._state.removeFeature(f.id);
		});

		// Remove only this exact class+subclass grant owner. Same-named subclasses can
		// coexist across sources, so the display label alone is not safe provenance.
		if (oldSubclass?.name) {
			const sourceFeature = `${oldSubclass.name} Spells`;
			const owner = this._state.getSubclassSpellGrantOwner({
				name: classEntry?.name || history.class.name,
				source: classEntry?.source || history.class.source,
				subclass: {
					name: oldSubclass.name,
					source: oldSubclass.source || classEntry?.subclass?.source,
				},
			}, {sourceFeature});
			this._state.removeSubclassSpells(owner);
		}

		// Update class entry with new subclass
		if (classEntry) {
			classEntry.subclass = {
				name: newSubclass.name,
				shortName: newSubclass.shortName,
				source: newSubclass.source,
				casterProgression: newSubclass.casterProgression,
				spellcastingAbility: newSubclass.spellcastingAbility,
				additionalSpells: newSubclass.additionalSpells,
			};
		}

		// Acquire the NEW subclass's features the SAME way Level-Up does, so that
		// (a) features whose level is encoded in a ref string resolve via
		// getSubclassFeatureRefLevel, and (b) addFeature runs the full effect/choice
		// pipeline (prose "either A/B" + "one of the following …" picks reach
		// pendingFeatureChoices; proficiency/modifier grants are applied). Iterate every
		// level up to the current class level and collect this subclass's features.
		const allClassFeatures = this._page.getClassFeatures?.() || [];
		const allSubclassFeatures = this._page.getSubclassFeatures?.() || [];
		const classDataLike = {name: history.class.name, source: history.class.source};
		const matchesNew = (f) => {
			if (!f.isSubclassFeature) return false;
			if (f.subclassShortName && newSubclass.shortName && f.subclassShortName !== newSubclass.shortName) return false;
			if (f.subclassSource && newSubclass.source && f.subclassSource !== newSubclass.source) return false;
			return true;
		};
		const seen = new Set();
		for (let lvl = 1; lvl <= classLevel; lvl++) {
			const levelFeatures = CharacterSheetClassUtils.getLevelFeatures(
				classDataLike,
				lvl,
				newSubclass,
				allClassFeatures,
				allSubclassFeatures,
			);
			levelFeatures.filter(matchesNew).forEach(f => {
				const key = `${(f.name || "").toLowerCase()}|${f.level}`;
				if (seen.has(key)) return;
				seen.add(key);
				this._state.addFeature({
					name: f.name,
					source: f.source,
					level: f.level,
					className: f.className,
					classSource: f.classSource,
					subclassName: newSubclass.name,
					subclassShortName: newSubclass.shortName,
					subclassSource: newSubclass.source,
					featureType: "Subclass",
					entries: f.entries,
					description: f.entries ? Renderer.get().render({entries: f.entries}) : "",
					isSubclassFeature: true,
				}, {sourceDecisionKey: subclassSourceDecisionKey});
			});
		}

		// Update all level history entries that had the old subclass
		const levelHistory = this._state.getLevelHistory();
		levelHistory.forEach(entry => {
			if ((!oldSubclass && entry.level === level)
				|| entry.choices?.subclass?.name === oldSubclass?.name) {
				this._state.updateLevelChoice(entry.level, {
					subclass: {
						name: newSubclass.name,
						shortName: newSubclass.shortName,
						source: newSubclass.source,
					},
				});
			}
		});

		// Re-apply class feature effects so the NEW subclass's always-prepared
		// spells / innate cantrips are populated (populateSubclassSpells) and its
		// passive effects (resistances, speed, etc.) take hold. The new subclass
		// may also change caster progression (e.g. Eldritch Knight), so refresh
		// spell slots too.
		this._state.applyClassFeatureEffects();
		this._state.calculateSpellSlots();
		this._state._syncAdventurersAtlasEligibility?.();

		// Subclass features may grant hpPerLevel — recalc max HP.
		this._recalcHpPreservingHealing();
	}

	/**
	 * Recalculate max HP after a respec change, preserving any healing the player
	 * had banked (i.e. don't reset current HP to max). When max increases, bump
	 * current by the same delta so the player feels the gain; when it drops,
	 * _recalculateMaxHp will cap current automatically.
	 * @private
	 */
	_recalcHpPreservingHealing () {
		const oldMax = this._state.getMaxHp();
		const oldCurrent = this._state.getCurrentHp();
		this._state.recalculateHp({syncCurrent: false});
		const newMax = this._state.getMaxHp();
		if (newMax > oldMax) {
			this._state.setCurrentHp(oldCurrent + (newMax - oldMax));
		}
	}

	// region Race/Background Respec

	async _stageSameRaceAbilityChoices (userChoices) {
		const selections = Object.entries(userChoices?.selectedAbilityChoices || {})
			.filter(([key, value]) => !key.endsWith("_weight") && value)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, value]) => value);
		const parent = this._engine?.manifest?.base?.decisions?.find(decision => decision.type === "originRace");
		const decisions = (this._engine?.manifest?.base?.decisions || [])
			.filter(decision =>
				decision.type === "nestedAbility"
				&& decision.parentSemanticKey === parent?.semanticKey
				&& decision.provenance?.ownerType === "race",
			)
			.sort((a, b) => Number(a.slot) - Number(b.slot));
		if (!selections.length || selections.length !== decisions.length) return false;

		for (let ix = 0; ix < decisions.length; ++ix) {
			const current = this._engine.manifest.base.decisions.find(decision =>
				decision.semanticKey === decisions[ix].semanticKey,
			);
			if (!current) return false;
			await this._engine.stageGraphMutation(current.id, selections[ix], {
				reverseParent: true,
				apply: ({state}) => this._applyManifestSelectionMechanics(
					current,
					selections[ix],
					current.options,
					state,
				),
			});
		}
		return true;
	}

	async _stageSameBackgroundAbilityChoices (userChoices) {
		const selectedAbilityBonuses = userChoices?.selectedAbilityBonuses || {};
		const weights = Object.keys(selectedAbilityBonuses)
			.filter(key => /^bg_\d+_weight$/.test(key))
			.sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]))
			.map(key => Number(selectedAbilityBonuses[key]));
		const parent = (this._engine?.manifest?.base?.decisions || []).find(decision =>
			decision.type === "nestedConfiguration"
				&& decision.meta?.originAbilityDistribution
				&& decision.provenance?.ownerType === "background",
		);
		const mode = parent?.options?.find(option =>
			option.weights?.length === weights.length
				&& option.weights.every((weight, ix) => Number(weight) === weights[ix]),
		);
		if (!parent || !mode) return false;

		await this._engine.stageGraphMutation(parent.id, mode, {
			reverseParent: true,
			apply: ({state}) => {
				const choices = MiscUtil.copyFast(state.getBaseBackgroundUserChoices?.() || {});
				choices.selectedAbilityBonuses = {};
				mode.weights.forEach((weight, ix) => {
					choices.selectedAbilityBonuses[`bg_${ix}`] = null;
					choices.selectedAbilityBonuses[`bg_${ix}_weight`] = weight;
				});
				state.setBaseBackgroundUserChoices?.(choices);
			},
		});

		const children = (this._engine.manifest?.base?.decisions || [])
			.filter(decision =>
				decision.type === "nestedAbility"
					&& decision.parentSemanticKey === parent.semanticKey
					&& decision.meta?.originAbilityDistribution,
			)
			.sort((a, b) => Number(a.slot) - Number(b.slot));
		if (children.length !== weights.length) {
			throw new Error("The selected background ability distribution could not be expanded.");
		}
		for (const child of children) {
			const ability = selectedAbilityBonuses[child.meta.originAbilitySelectionKey];
			if (!ability) throw new Error("Complete every background ability choice before staging it.");
			const current = this._engine.manifest.base.decisions.find(decision =>
				decision.semanticKey === child.semanticKey,
			);
			await this._engine.stageGraphMutation(current.id, ability, {
				reverseParent: true,
				apply: ({state}) => this._applyManifestSelectionMechanics(
					current,
					ability,
					current.options,
					state,
				),
			});
		}
		return true;
	}

	async _editRace (level, history, closeParentModal) {
		const races = this._page.filterByAllowedSources(this._page.getRaces());

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "Change Species",
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const content = e_({tag: "div", clazz: "charsheet__respec-subclass-modal"});

		const currentRaceName = this._state.getRaceName();
		content.append(e_({outer: `<p class="text-muted mb-2">Current Species: <strong>${Renderer.stripTags(currentRaceName || "Unknown")}</strong></p>`}));

		content.append(e_({outer: `
			<div class="charsheet__respec-cascade-warning">
				<h5><span class="text-warning">\u26a0\ufe0f</span> Species Change Impact</h5>
				<p class="ve-small">Changing species will replace all racial traits (speed, darkvision, resistances, languages, skills, proficiencies) and recalculate ability score bonuses.</p>
			</div>
		`}));

		content.append(e_({outer: `<h5>Select New Species</h5>`}));

		const searchRow = e_({tag: "div", clazz: "charsheet__respec-search-row mb-2"});
		const searchInput = e_({tag: "input", clazz: "ve-form-control"});
		searchInput.type = "text";
		searchInput.placeholder = "Search species...";
		searchRow.append(searchInput);
		content.append(searchRow);

		const raceList = e_({tag: "div", clazz: "charsheet__respec-feat-list"});
		let selectedRace = null;
		let currentPickers = [];
		let choicesPanel;
		let fnUpdateApplyState;

		const renderRaces = (filter = "") => {
			raceList.innerHTML = "";
			const filterLower = filter.toLowerCase();
			const filtered = races
				.filter(r => !r._isBaseRace)
				.filter(r => !filter || r.name.toLowerCase().includes(filterLower))
				.sort((a, b) => a.name.localeCompare(b.name))
				.slice(0, 50);

			if (filtered.length === 0) {
				raceList.append(e_({outer: `<p class="text-muted">No species found.</p>`}));
				return;
			}

			const currentRace = this._state.getRace();
			filtered.forEach(race => {
				const isCurrent = race.name === currentRace?.name && race.source === currentRace?.source;
				const isSelected = selectedRace?.name === race.name && selectedRace?.source === race.source;
				const displayName = Renderer.stripTags(race.name);
				const item = e_({outer: `
					<div class="charsheet__respec-feat-item ${isCurrent ? "charsheet__respec-feat-current" : ""} ${isSelected ? "charsheet__respec-feat-selected" : ""}">
						<strong>${displayName}</strong>
						<span class="text-muted">${Parser.sourceJsonToAbv(race.source)}</span>
					</div>
				`});
				item.addEventListener("click", () => {
					selectedRace = race;
					raceList.querySelectorAll(".charsheet__respec-feat-selected").forEach(el => el.classList.remove("charsheet__respec-feat-selected"));
					item.classList.add("charsheet__respec-feat-selected");

					// Render choice pickers for the selected race
					if (choicesPanel) {
						choicesPanel.innerHTML = "";
						currentPickers = [];
						const langPicker = this._renderLanguageChoicePickers(choicesPanel, race, () => fnUpdateApplyState?.());
						if (langPicker) currentPickers.push(langPicker);
						const skillPicker = this._renderSkillChoicePickers(choicesPanel, race, () => fnUpdateApplyState?.());
						if (skillPicker) currentPickers.push(skillPicker);
						const toolPicker = this._renderToolChoicePickers(choicesPanel, race, () => fnUpdateApplyState?.());
						if (toolPicker) currentPickers.push(toolPicker);
						const abiPicker = this._renderAbilityChoicePickers(choicesPanel, race, "rc", () => fnUpdateApplyState?.());
						if (abiPicker) currentPickers.push(abiPicker);
					}
					fnUpdateApplyState?.();
				});
				raceList.append(item);
			});
		};

		renderRaces();
		searchInput.addEventListener("input", () => renderRaces(searchInput.value));
		content.append(raceList);

		choicesPanel = e_({tag: "div", clazz: "charsheet__respec-choices-panel mt-2"});
		content.append(choicesPanel);

		const btnRow = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancelBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancelBtn.addEventListener("click", () => doClose());

		const applyBtn = e_({tag: "button", clazz: "ve-btn ve-btn-danger", txt: "Change Species"});

		fnUpdateApplyState = () => {
			applyBtn.disabled = !selectedRace || currentPickers.some(p => !p.isComplete());
		};

		applyBtn.addEventListener("click", async () => {
			if (!selectedRace) {
				JqueryUtil.doToast({type: "warning", content: "Please select a species."});
				return;
			}

			if (currentPickers.some(p => !p.isComplete())) {
				JqueryUtil.doToast({type: "warning", content: "Please complete all choices."});
				return;
			}

			const currentRace = this._state.getRace();
			const isSameEntity = selectedRace.name === currentRace?.name && selectedRace.source === currentRace?.source;
			const confirmed = isSameEntity || await InputUiUtil.pGetUserBoolean(/** @type {*} */ ({
				title: "Confirm Species Change",
				htmlDescription: `<p>This will replace all racial traits from <strong>${Renderer.stripTags(currentRaceName)}</strong> with traits from <strong>${Renderer.stripTags(selectedRace.name)}</strong>.</p><p>Are you sure?</p>`,
				textYes: "Change Species",
				textNo: "Cancel",
			}));

			if (!confirmed) return;

			const userChoices = {};
			currentPickers.forEach(p => {
				if (p.type === "language") userChoices.selectedLanguages = p.getSelections();
				else if (p.type === "skill") userChoices.selectedSkills = p.getSelections();
				else if (p.type === "tool") userChoices.selectedTools = p.getSelections();
				else if (p.type === "ability") userChoices.selectedAbilityChoices = p.getSelections();
			});

			const originDecision = this._engine?.manifest?.base?.decisions?.find(decision => decision.type === "originRace");
			const isSameRaceAbilityOnly = isSameEntity
				&& currentPickers.length
				&& currentPickers.every(picker => picker.type === "ability");
			const didStageOwnedAbilityChoices = isSameRaceAbilityOnly
				? await this._stageSameRaceAbilityChoices(userChoices)
				: false;
			if (!didStageOwnedAbilityChoices) {
				if (originDecision) {
					await this._engine.stageGraphMutation(originDecision.id, {
						name: selectedRace.name,
						source: selectedRace.source,
					}, {
						apply: ({state}) => {
							const previousState = this._state;
							this._state = state;
							try {
								this._applyRaceChange(history, selectedRace, userChoices);
							} finally {
								this._state = previousState;
							}
						},
					});
				} else {
					await this._engine.stageCandidateMutation(({state}) => {
						const previousState = this._state;
						this._state = state;
						try {
							this._applyRaceChange(history, selectedRace, userChoices);
						} finally {
							this._state = previousState;
						}
					});
				}
			}

			doClose();
			closeParentModal?.();
			this.render();
			JqueryUtil.doToast({
				type: "success",
				content: isSameEntity
					? `Updated ${Renderer.stripTags(selectedRace.name)} choices.`
					: `Changed species to ${Renderer.stripTags(selectedRace.name)}.`,
			});
		});

		btnRow.append(cancelBtn, applyBtn);
		content.append(btnRow);
		modalInner.append(content);
	}

	async _editBackground (level, history, closeParentModal) {
		const backgrounds = this._page.filterByAllowedSources(this._page.getBackgrounds());

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "Change Background",
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			cbClose: () => {},
		});

		const content = e_({tag: "div", clazz: "charsheet__respec-subclass-modal"});

		const currentBgName = this._state.getBackgroundName() || "Unknown";
		content.append(e_({outer: `<p class="text-muted mb-2">Current Background: <strong>${Renderer.stripTags(currentBgName)}</strong></p>`}));

		content.append(e_({outer: `
			<div class="charsheet__respec-cascade-warning">
				<h5><span class="text-warning">\u26a0\ufe0f</span> Background Change Impact</h5>
				<p class="ve-small">Changing background will replace background skills, tools, languages, features, and may recalculate ability score bonuses.</p>
			</div>
		`}));

		content.append(e_({outer: `<h5>Select New Background</h5>`}));

		const searchRow = e_({tag: "div", clazz: "charsheet__respec-search-row mb-2"});
		const searchInput = e_({tag: "input", clazz: "ve-form-control"});
		searchInput.type = "text";
		searchInput.placeholder = "Search backgrounds...";
		searchRow.append(searchInput);
		content.append(searchRow);

		const bgList = e_({tag: "div", clazz: "charsheet__respec-feat-list"});
		let selectedBg = null;
		let currentPickers = [];
		let choicesPanel;
		let fnUpdateApplyState;

		const renderBgs = (filter = "") => {
			bgList.innerHTML = "";
			const filterLower = filter.toLowerCase();
			const filtered = backgrounds
				.filter(bg => !filter || bg.name.toLowerCase().includes(filterLower))
				.sort((a, b) => a.name.localeCompare(b.name))
				.slice(0, 50);

			if (filtered.length === 0) {
				bgList.append(e_({outer: `<p class="text-muted">No backgrounds found.</p>`}));
				return;
			}

			const currentBg = this._state.getBackground();
			filtered.forEach(bg => {
				const isCurrent = bg.name === currentBg?.name && bg.source === currentBg?.source;
				const isSelected = selectedBg?.name === bg.name && selectedBg?.source === bg.source;
				const displayName = Renderer.stripTags(bg.name);
				const item = e_({outer: `
					<div class="charsheet__respec-feat-item ${isCurrent ? "charsheet__respec-feat-current" : ""} ${isSelected ? "charsheet__respec-feat-selected" : ""}">
						<strong>${displayName}</strong>
						<span class="text-muted">${Parser.sourceJsonToAbv(bg.source)}</span>
					</div>
				`});
				item.addEventListener("click", () => {
					selectedBg = bg;
					bgList.querySelectorAll(".charsheet__respec-feat-selected").forEach(el => el.classList.remove("charsheet__respec-feat-selected"));
					item.classList.add("charsheet__respec-feat-selected");

					// Render choice pickers for the selected background
					if (choicesPanel) {
						choicesPanel.innerHTML = "";
						currentPickers = [];
						const langPicker = this._renderLanguageChoicePickers(choicesPanel, bg, () => fnUpdateApplyState?.());
						if (langPicker) currentPickers.push(langPicker);
						const toolPicker = this._renderToolChoicePickers(choicesPanel, bg, () => fnUpdateApplyState?.());
						if (toolPicker) currentPickers.push(toolPicker);
						const abiPicker = this._renderAbilityChoicePickers(choicesPanel, bg, "bg", () => fnUpdateApplyState?.());
						if (abiPicker) currentPickers.push(abiPicker);
					}
					fnUpdateApplyState?.();
				});
				bgList.append(item);
			});
		};

		renderBgs();
		searchInput.addEventListener("input", () => renderBgs(searchInput.value));
		content.append(bgList);

		choicesPanel = e_({tag: "div", clazz: "charsheet__respec-choices-panel mt-2"});
		content.append(choicesPanel);

		const btnRow = e_({tag: "div", clazz: "charsheet__respec-btn-row mt-3"});
		const cancelBtn = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancelBtn.addEventListener("click", () => doClose());

		const applyBtn = e_({tag: "button", clazz: "ve-btn ve-btn-danger", txt: "Change Background"});

		fnUpdateApplyState = () => {
			applyBtn.disabled = !selectedBg || currentPickers.some(p => !p.isComplete());
		};

		applyBtn.addEventListener("click", async () => {
			if (!selectedBg) {
				JqueryUtil.doToast({type: "warning", content: "Please select a background."});
				return;
			}

			if (currentPickers.some(p => !p.isComplete())) {
				JqueryUtil.doToast({type: "warning", content: "Please complete all choices."});
				return;
			}

			const currentBg = this._state.getBackground();
			const isSameEntity = selectedBg.name === currentBg?.name && selectedBg.source === currentBg?.source;
			const confirmed = isSameEntity || await InputUiUtil.pGetUserBoolean(/** @type {*} */ ({
				title: "Confirm Background Change",
				htmlDescription: `<p>This will replace all background traits from <strong>${Renderer.stripTags(currentBgName)}</strong> with traits from <strong>${Renderer.stripTags(selectedBg.name)}</strong>.</p><p>Are you sure?</p>`,
				textYes: "Change Background",
				textNo: "Cancel",
			}));

			if (!confirmed) return;

			const userChoices = {};
			currentPickers.forEach(p => {
				if (p.type === "language") userChoices.selectedLanguages = p.getSelections();
				else if (p.type === "tool") userChoices.selectedTools = p.getSelections();
				else if (p.type === "ability") userChoices.selectedAbilityBonuses = p.getSelections();
			});

			const originDecision = this._engine?.manifest?.base?.decisions?.find(decision => decision.type === "originBackground");
			const isSameBackgroundAbilityOnly = isSameEntity
				&& currentPickers.length
				&& currentPickers.every(picker => picker.type === "ability");
			const didStageOwnedAbilityChoices = isSameBackgroundAbilityOnly
				? await this._stageSameBackgroundAbilityChoices(userChoices)
				: false;
			if (!didStageOwnedAbilityChoices && originDecision) {
				await this._engine.stageGraphMutation(originDecision.id, {
					name: selectedBg.name,
					source: selectedBg.source,
				}, {
					apply: ({state}) => {
						const previousState = this._state;
						this._state = state;
						try {
							this._applyBackgroundChange(history, selectedBg, userChoices);
						} finally {
							this._state = previousState;
						}
					},
				});
			} else if (!didStageOwnedAbilityChoices) {
				await this._engine.stageCandidateMutation(({state}) => {
					const previousState = this._state;
					this._state = state;
					try {
						this._applyBackgroundChange(history, selectedBg, userChoices);
					} finally {
						this._state = previousState;
					}
				});
			}

			doClose();
			closeParentModal?.();
			this.render();
			JqueryUtil.doToast({
				type: "success",
				content: isSameEntity
					? `Updated ${Renderer.stripTags(selectedBg.name)} choices.`
					: `Changed background to ${Renderer.stripTags(selectedBg.name)}.`,
			});
		});

		btnRow.append(cancelBtn, applyBtn);
		content.append(btnRow);
		modalInner.append(content);
	}

	/**
	 * Clear old race grants and apply new race traits.
	 * Mirrors the builder's _applyRacialTraits pattern.
	 */
	_applyRaceChange (history, newRace, userChoices = {}) {
		const oldRace = this._state.getRace();
		const oldSubrace = this._state.getSubrace();
		const raceSourceId = "base:origin-race";
		const oldUserChoices = (this._state.getBaseRaceUserChoices ? this._state.getBaseRaceUserChoices() : null) || history.choices?.raceUserChoices || {};

		// --- CLEAR OLD RACE GRANTS ---

		// Remove race/subrace features
		const features = this._state.getFeatures();
		features
			.filter(f => f.featureType === "Species" || f.featureType === "Subrace" || f.featureType === "Race")
			.forEach(f => this._state.removeFeature(f.id));

		// Reset speed
		this._state.setSpeed("walk", 30);
		["fly", "swim", "climb", "burrow"].forEach(t => this._state.setSpeed(t, 0));

		// Remove race-sourced named modifiers (e.g., equalToWalk speeds)
		const namedMods = this._state.getNamedModifiers();
		namedMods.filter(m => m.sourceType === "race").forEach(m => this._state.removeNamedModifier(m.id));

		// Reset senses
		CharacterSheetClassUtils.SENSE_DISPLAY_ORDER.forEach(senseKey => this._state.setSense(senseKey, 0));

		// Clear ability bonuses (will be reapplied for both race and background)
		Parser.ABIL_ABVS.forEach(abl => this._state.setAbilityBonus(abl, 0));

		// Clear old racial languages
		this._clearLanguagesFromData(oldRace, raceSourceId);
		this._clearLanguagesFromData(oldSubrace, raceSourceId);
		this._clearUserChosenLanguages(oldUserChoices, raceSourceId);

		// Clear old racial skills
		this._clearSkillsFromData(oldRace, raceSourceId);
		this._clearSkillsFromData(oldSubrace, raceSourceId);
		this._clearUserChosenSkills(oldUserChoices, raceSourceId);

		// Clear old racial resistances
		this._clearResistancesFromData(oldRace, raceSourceId);
		this._clearResistancesFromData(oldSubrace, raceSourceId);

		// Clear old racial proficiencies
		this._clearProficienciesFromData(oldRace, oldSubrace, raceSourceId);
		if (oldUserChoices.selectedTools?.length) {
			oldUserChoices.selectedTools.forEach(tool => this._releaseOriginProficiency("tools", (/** @type {*} */ (tool)).toTitleCase(), raceSourceId));
		}

		// --- APPLY NEW RACE GRANTS ---

		// Determine subrace from merged race data
		const newSubrace = newRace._baseName ? null : null;
		this._state.setRace(newRace, newSubrace);

		// Speed
		this._applySpeedFromRaceData(newRace);

		// Senses
		CharacterSheetClassUtils.SENSE_DISPLAY_ORDER.forEach(senseKey => {
			if (newRace[senseKey]) this._state.setSense(senseKey, newRace[senseKey]);
		});

		// Fixed languages
		this._applyFixedLanguages(newRace, raceSourceId);

		// Fixed skills
		this._applyFixedSkills(newRace, raceSourceId);

		// Resistances
		if (newRace.resist) {
			newRace.resist.forEach(r => {
				if (typeof r === "string") this._claimOriginProficiency("resistances", r, raceSourceId);
			});
		}

		// Fixed ability bonuses
		if (newRace.ability) {
			newRace.ability.forEach(abiSet => {
				Object.entries(abiSet).forEach(([abi, bonus]) => {
					if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi)) {
						const current = this._state.getAbilityBonus(abi) || 0;
						this._state.setAbilityBonus(abi, current + bonus);
					}
				});
			});
		}

		// Armor, weapon, tool proficiencies
		this._applyProficienciesFromData(newRace, raceSourceId);

		// Race features (entries)
		if (newRace.entries) {
			newRace.entries.forEach(entry => {
				if (typeof entry === "object" && entry.name) {
					this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
						{...entry, source: entry.source || newRace.source},
						{featureType: "Species"},
					));
				}
			});
		}

		// Reapply background ability bonuses (since we reset all to 0)
		this._reapplyBackgroundAbilityBonuses(history);

		// Apply user-chosen languages
		if (userChoices.selectedLanguages) {
			Object.values(userChoices.selectedLanguages).forEach(langs => {
				if (Array.isArray(langs)) langs.forEach(lang => this._claimOriginProficiency("languages", lang, raceSourceId));
			});
		}

		// Apply user-chosen skills
		if (userChoices.selectedSkills?.length) {
			userChoices.selectedSkills.forEach(skill => {
				this._claimOriginProficiency("skills", skill.toLowerCase().replace(/\s+/g, ""), raceSourceId);
			});
		}

		// Apply user-chosen tools
		if (userChoices.selectedTools?.length) {
			userChoices.selectedTools.forEach(tool => {
				this._claimOriginProficiency("tools", tool, raceSourceId);
			});
		}

		// Apply user-chosen ability bonuses
		if (userChoices.selectedAbilityChoices) {
			Object.entries(userChoices.selectedAbilityChoices).forEach(([key, value]) => {
				if (!key.includes("_weight") && value) {
					const weightKey = `${key}_weight`;
					const bonus = userChoices.selectedAbilityChoices[weightKey] || 0;
					if (bonus && Parser.ABIL_ABVS.includes(value)) {
						const current = this._state.getAbilityBonus(value) || 0;
						this._state.setAbilityBonus(value, current + bonus);
					}
				}
			});
		}

		// Persist the origin choices to the character base node (single source of truth used by Respec).
		// The race entity object itself was already set via setRace() above. For older mock states without
		// the base API, fall back to the legacy level-1 history write.
		if (this._state.setBaseRaceUserChoices) {
			this._state.setBaseRaceUserChoices(userChoices);
		} else {
			this._state.updateLevelChoice(1, {
				race: {
					name: newRace.name,
					source: newRace.source,
				},
				raceUserChoices: userChoices,
			});
		}
	}

	/**
	 * Clear old background grants and apply new background traits.
	 * Mirrors the builder's _applyBackgroundFeatures pattern.
	 */
	_applyBackgroundChange (history, newBg, userChoices = {}) {
		const oldBg = this._state.getBackground();
		const backgroundSourceId = "base:origin-background";
		const oldUserChoices = (this._state.getBaseBackgroundUserChoices ? this._state.getBaseBackgroundUserChoices() : null) || history.choices?.backgroundUserChoices || {};

		// --- CLEAR OLD BACKGROUND GRANTS ---

		// Remove background features
		const features = this._state.getFeatures();
		features
			.filter(f => f.featureType === "Background")
			.forEach(f => this._state.removeFeature(f.id));

		// Clear old background ability bonuses (reset all, will reapply race + new bg)
		Parser.ABIL_ABVS.forEach(abl => this._state.setAbilityBonus(abl, 0));

		// Clear old background skills
		this._clearSkillsFromData(oldBg, backgroundSourceId);

		// Clear old background tools
		this._clearToolsFromData(oldBg, backgroundSourceId);
		if (oldUserChoices.selectedTools?.length) {
			oldUserChoices.selectedTools.forEach(c => {
				if (c.tool) this._releaseOriginProficiency("tools", (/** @type {*} */ (c.tool)).toTitleCase(), backgroundSourceId);
			});
		}

		// Clear old background languages
		this._clearLanguagesFromData(oldBg, backgroundSourceId);
		if (oldUserChoices.selectedLanguages?.length) {
			oldUserChoices.selectedLanguages.forEach(c => {
				if (c.language) this._releaseOriginProficiency("languages", c.language, backgroundSourceId);
			});
		}

		// --- APPLY NEW BACKGROUND GRANTS ---

		this._state.setBackground(newBg);

		// Skills
		this._applyFixedSkills(newBg, backgroundSourceId);

		// Tools
		this._applyFixedTools(newBg, backgroundSourceId);

		// Languages
		this._applyFixedLanguages(newBg, backgroundSourceId);

		// Features
		if (newBg.entries) {
			newBg.entries.forEach(entry => {
				if (typeof entry === "object" && entry.name) {
					this._state.addFeature(CharacterSheetClassUtils.buildFeatureStateObject(
						{...entry, source: entry.source || newBg.source},
						{featureType: "Background"},
					));
				}
			});
		}

		// Reapply racial ability bonuses (since we reset all to 0)
		this._reapplyRacialAbilityBonuses(history);

		// Reapply newly-selected background ability bonuses
		// For 2024 backgrounds with ability choices, apply fixed bonuses only
		if (newBg.ability) {
			newBg.ability.forEach(abiSet => {
				Object.entries(abiSet).forEach(([abi, bonus]) => {
					if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi)) {
						const current = this._state.getAbilityBonus(abi) || 0;
						this._state.setAbilityBonus(abi, current + bonus);
					}
				});
			});
		}

		// Apply user-chosen languages
		if (userChoices.selectedLanguages?.length) {
			userChoices.selectedLanguages.forEach(lang => {
				this._claimOriginProficiency("languages", lang, backgroundSourceId);
			});
		}

		// Apply user-chosen tools
		if (userChoices.selectedTools?.length) {
			userChoices.selectedTools.forEach(tool => {
				this._claimOriginProficiency("tools", tool, backgroundSourceId);
			});
		}

		// Apply user-chosen ability bonuses
		if (userChoices.selectedAbilityBonuses) {
			Object.entries(userChoices.selectedAbilityBonuses).forEach(([key, value]) => {
				if (!key.includes("_weight") && value) {
					const weightKey = `${key}_weight`;
					const bonus = userChoices.selectedAbilityBonuses[weightKey] || 0;
					if (bonus && Parser.ABIL_ABVS.includes(value)) {
						const current = this._state.getAbilityBonus(value) || 0;
						this._state.setAbilityBonus(value, current + bonus);
					}
				}
			});
		}

		// Update level history — convert to storage format
		const storedUserChoices = {};
		if (userChoices.selectedLanguages?.length) {
			storedUserChoices.selectedLanguages = userChoices.selectedLanguages.map(l => ({language: l}));
		}
		if (userChoices.selectedTools?.length) {
			storedUserChoices.selectedTools = userChoices.selectedTools.map(t => ({tool: t}));
		}
		if (userChoices.selectedAbilityBonuses) {
			storedUserChoices.selectedAbilityBonuses = userChoices.selectedAbilityBonuses;
		}

		// Persist origin choices to the character base node (single source of truth). Fall back to the
		// legacy level-1 history write for older mock states without the base API.
		if (this._state.setBaseBackgroundUserChoices) {
			this._state.setBaseBackgroundUserChoices(storedUserChoices);
		} else {
			this._state.updateLevelChoice(1, {
				background: {
					name: newBg.name,
					source: newBg.source,
				},
				backgroundUserChoices: storedUserChoices,
			});
		}
	}

	// region Choice Picker Helpers

	/**
	 * Render language choice pickers for "anyStandard", "any", or "choose" entries.
	 * @returns {{type: string, getSelections: Function, isComplete: Function}|null}
	 */
	_renderLanguageChoicePickers (container, data, onUpdate) {
		if (!data?.languageProficiencies) return null;

		const langGroups = this._page.getLanguageOptionsGrouped();
		const standardLangs = langGroups.standard || [];
		const allLangs = [
			...(langGroups.standard || []),
			...(langGroups.exotic || []),
			...(langGroups.secret || []),
			...(langGroups.homebrew || []),
		];

		const selections = {}; // {profIdx: [lang|null, ...]}
		let totalRequired = 0;
		let hasAny = false;

		data.languageProficiencies.forEach((langProf, profIdx) => {
			if (!selections[profIdx]) selections[profIdx] = [];

			const addDropdowns = (count, options, noun) => {
				hasAny = true;
				totalRequired += count;
				container.append(e_({outer: `<p class="ve-small mb-1"><strong>Language:</strong> Choose ${count} ${noun}${count > 1 ? "s" : ""}:</p>`}));
				for (let i = 0; i < count; i++) {
					const idx = selections[profIdx].length;
					selections[profIdx].push(null);
					const selectEl = e_({outer: `<select class="ve-form-control form-control--minimal mb-1"><option value="">-- Select Language --</option></select>`});
					options.forEach(lang => selectEl.append(e_({outer: `<option value="${lang}">${lang}</option>`})));
					selectEl.addEventListener("change", () => {
						selections[profIdx][idx] = selectEl.value || null;
						onUpdate();
					});
					container.append(selectEl);
				}
			};

			if (langProf.anyStandard) {
				addDropdowns(typeof langProf.anyStandard === "number" ? langProf.anyStandard : 1, standardLangs, "standard language");
			}
			if (langProf.any) {
				addDropdowns(typeof langProf.any === "number" ? langProf.any : 1, allLangs, "language");
			}
			if (langProf.choose) {
				const from = (langProf.choose.from || []).map(l => l.split("|")[0].toTitleCase());
				addDropdowns(langProf.choose.count || 1, from, "language");
			}
		});

		if (!hasAny) return null;

		return {
			type: "language",
			getSelections: () => {
				const result = {};
				Object.entries(selections).forEach(([profIdx, langs]) => {
					result[profIdx] = langs.filter(l => l);
				});
				return result;
			},
			isComplete: () => {
				let filled = 0;
				Object.values(selections).forEach(arr => arr.forEach(v => { if (v) filled++; }));
				return filled >= totalRequired;
			},
		};
	}

	/**
	 * Render skill choice pickers for "any" or "choose" entries.
	 * @returns {{type: string, getSelections: Function, isComplete: Function}|null}
	 */
	_renderSkillChoicePickers (container, data, onUpdate) {
		if (!data?.skillProficiencies) return null;

		const allSkillNames = Parser.SKILL_TO_ATB_ABV
			? Object.keys(Parser.SKILL_TO_ATB_ABV).map(s => (/** @type {*} */ (s)).toTitleCase())
			: [];

		const selected = [];
		let totalRequired = 0;
		let hasAny = false;

		data.skillProficiencies.forEach(skillProf => {
			const addCheckboxes = (count, options, label) => {
				hasAny = true;
				totalRequired += count;
				container.append(e_({outer: `<p class="ve-small mb-1"><strong>Skills:</strong> ${label}</p>`}));
				const checkboxContainer = e_({tag: "div", clazz: "charsheet__respec-skill-checkboxes mb-1"});
				options.forEach(skill => {
					const lbl = e_({outer: `<label class="mr-3 mb-1"><input type="checkbox" value="${skill}"> ${skill}</label>`});
					lbl.querySelector("input").addEventListener("change", (evt) => {
						if (evt.target.checked) {
							if (selected.length < totalRequired) {
								selected.push(skill);
							} else {
								evt.target.checked = false;
								JqueryUtil.doToast({type: "warning", content: `You can only choose ${totalRequired} skill${totalRequired > 1 ? "s" : ""}.`});
							}
						} else {
							const idx = selected.indexOf(skill);
							if (idx >= 0) selected.splice(idx, 1);
						}
						onUpdate();
					});
					checkboxContainer.append(lbl);
				});
				container.append(checkboxContainer);
			};

			if (skillProf.any) {
				const count = typeof skillProf.any === "number" ? skillProf.any : 1;
				addCheckboxes(count, allSkillNames, `Choose any ${count} skill${count > 1 ? "s" : ""}:`);
			}
			if (skillProf.choose) {
				const count = skillProf.choose.count || 1;
				const from = (skillProf.choose.from || []).map(s => s.split("|")[0].toTitleCase());
				addCheckboxes(count, from, `Choose ${count} skill${count > 1 ? "s" : ""}:`);
			}
		});

		if (!hasAny) return null;

		return {
			type: "skill",
			getSelections: () => [...selected],
			isComplete: () => selected.length >= totalRequired,
		};
	}

	/**
	 * Render tool choice pickers for "any", "choose", "anyArtisansTool", "anyMusicalInstrument" entries.
	 * @returns {{type: string, getSelections: Function, isComplete: Function}|null}
	 */
	_renderToolChoicePickers (container, data, onUpdate) {
		if (!data?.toolProficiencies) return null;

		const artisanTools = [
			"Alchemist's Supplies", "Brewer's Supplies", "Calligrapher's Supplies",
			"Carpenter's Tools", "Cartographer's Tools", "Cobbler's Tools",
			"Cook's Utensils", "Glassblower's Tools", "Jeweler's Tools",
			"Leatherworker's Tools", "Mason's Tools", "Painter's Supplies",
			"Potter's Tools", "Smith's Tools", "Tinker's Tools",
			"Weaver's Tools", "Woodcarver's Tools",
		];
		const musicalInstruments = [
			"Bagpipes", "Drum", "Dulcimer", "Flute", "Horn",
			"Lute", "Lyre", "Pan Flute", "Shawm", "Viol",
		];
		const allTools = [
			...artisanTools, "Disguise Kit", "Forgery Kit", "Herbalism Kit",
			...musicalInstruments, "Navigator's Tools", "Poisoner's Kit", "Thieves' Tools",
		].sort();

		const selected = [];
		let totalRequired = 0;
		let hasAny = false;

		data.toolProficiencies.forEach(toolProf => {
			const addDropdowns = (count, options, label) => {
				hasAny = true;
				totalRequired += count;
				container.append(e_({outer: `<p class="ve-small mb-1"><strong>Tools:</strong> ${label}</p>`}));
				for (let i = 0; i < count; i++) {
					const idx = selected.length;
					selected.push(null);
					const selectEl = e_({outer: `<select class="ve-form-control form-control--minimal mb-1"><option value="">-- Select Tool --</option></select>`});
					options.forEach(tool => selectEl.append(e_({outer: `<option value="${tool}">${tool}</option>`})));
					selectEl.addEventListener("change", () => {
						selected[idx] = selectEl.value || null;
						onUpdate();
					});
					container.append(selectEl);
				}
			};

			if (toolProf.any) {
				const count = typeof toolProf.any === "number" ? toolProf.any : 1;
				addDropdowns(count, allTools, `Choose ${count} tool${count > 1 ? "s" : ""}:`);
			}
			if (toolProf.anyArtisansTool) {
				const count = typeof toolProf.anyArtisansTool === "number" ? toolProf.anyArtisansTool : 1;
				addDropdowns(count, artisanTools, `Choose ${count} artisan's tool${count > 1 ? "s" : ""}:`);
			}
			if (toolProf.anyMusicalInstrument) {
				const count = typeof toolProf.anyMusicalInstrument === "number" ? toolProf.anyMusicalInstrument : 1;
				addDropdowns(count, musicalInstruments, `Choose ${count} musical instrument${count > 1 ? "s" : ""}:`);
			}
			if (toolProf.choose) {
				const from = (toolProf.choose.from || []).map(t => (/** @type {*} */ (t)).toTitleCase());
				addDropdowns(toolProf.choose.count || 1, from, `Choose ${toolProf.choose.count || 1} tool${(toolProf.choose.count || 1) > 1 ? "s" : ""}:`);
			}
		});

		if (!hasAny) return null;

		return {
			type: "tool",
			getSelections: () => selected.filter(t => t),
			isComplete: () => selected.filter(t => t).length >= totalRequired,
		};
	}

	/**
	 * Render ability score choice pickers for "choose" entries in ability data.
	 * @param {string} prefix - "rc" for race choices, "bg" for background choices
	 * @returns {{type: string, getSelections: Function, isComplete: Function}|null}
	 */
	_renderAbilityChoicePickers (container, data, prefix, onUpdate) {
		if (!data?.ability) return null;

		// Collect ability sets that require choices
		const chooseSets = data.ability.filter(abiSet => abiSet.choose);
		if (!chooseSets.length) return null;

		const selections = {};
		let activeSetIdx = 0;

		// Helper: render pickers for a single ability set
		const renderAbiSet = (choose, pickersContainer) => {
			pickersContainer.innerHTML = "";
			// Clear previous selections
			Object.keys(selections).forEach(k => delete selections[k]);

			const abilities = choose.from || choose.weighted?.from || Parser.ABIL_ABVS;

			if (choose.weighted) {
				const weights = choose.weighted.weights || [2, 1];
				const asiContainer = e_({tag: "div", clazz: "charsheet__respec-asi-choices mb-1"});

				weights.forEach((weight, idx) => {
					const key = `${prefix}_${idx}`;
					selections[key] = null;
					selections[`${key}_weight`] = weight;

					const row = e_({tag: "div", clazz: "ve-flex-v-center mb-1"});
					row.append(e_({outer: `<span class="mr-2">+${weight}:</span>`}));

					const selectEl = e_({outer: `<select class="ve-form-control form-control--minimal ve-inline-block w-auto" data-asi-idx="${idx}"><option value="">-- Select --</option></select>`});
					abilities.forEach(ab => {
						selectEl.append(e_({outer: `<option value="${ab}">${Parser.attAbvToFull(ab)}</option>`}));
					});

					selectEl.addEventListener("change", () => {
						selections[key] = selectEl.value || null;
						// Cross-disable: prevent same ability in multiple dropdowns
						[...asiContainer.querySelectorAll("select")].forEach(sel => {
							const selIdx = parseInt(sel.dataset.asiIdx);
							if (selIdx !== idx) {
								[...sel.querySelectorAll("option")].forEach(opt => {
									if (!opt.value) return;
									const isUsedElsewhere = Object.entries(selections)
										.some(([k, v]) => !k.includes("_weight") && k !== `${prefix}_${selIdx}` && v === opt.value);
									opt.disabled = isUsedElsewhere;
								});
							}
						});
						onUpdate();
					});

					row.append(selectEl);
					asiContainer.append(row);
				});

				pickersContainer.append(asiContainer);
			} else if (choose.count) {
				const amount = choose.amount || 1;
				const count = choose.count;
				const asiContainer = e_({tag: "div", clazz: "charsheet__respec-asi-choices mb-1"});

				for (let i = 0; i < count; i++) {
					const key = `${prefix}_${i}`;
					selections[key] = null;
					selections[`${key}_weight`] = amount;

					const row = e_({tag: "div", clazz: "ve-flex-v-center mb-1"});
					row.append(e_({outer: `<span class="mr-2">+${amount}:</span>`}));

					const selectEl = e_({outer: `<select class="ve-form-control form-control--minimal ve-inline-block w-auto" data-asi-idx="${i}"><option value="">-- Select --</option></select>`});
					abilities.forEach(ab => {
						selectEl.append(e_({outer: `<option value="${ab}">${Parser.attAbvToFull(ab)}</option>`}));
					});

					selectEl.addEventListener("change", () => {
						selections[key] = selectEl.value || null;
						// Cross-disable
						[...asiContainer.querySelectorAll("select")].forEach(sel => {
							const selIdx = parseInt(sel.dataset.asiIdx);
							if (selIdx !== i) {
								[...sel.querySelectorAll("option")].forEach(opt => {
									if (!opt.value) return;
									const isUsedElsewhere = Object.entries(selections)
										.some(([k, v]) => !k.includes("_weight") && k !== `${prefix}_${selIdx}` && v === opt.value);
									opt.disabled = isUsedElsewhere;
								});
							}
						});
						onUpdate();
					});

					row.append(selectEl);
					asiContainer.append(row);
				}

				pickersContainer.append(asiContainer);
			}
		};

		// Build the label describing what the set gives
		const describeSet = (choose) => {
			if (choose.weighted) {
				const weights = choose.weighted.weights || [2, 1];
				return weights.map(w => `+${w}`).join("/");
			}
			if (choose.count) {
				const amount = choose.amount || 1;
				return Array(choose.count).fill(`+${amount}`).join("/");
			}
			return "Choose";
		};

		container.append(e_({outer: `<p class="ve-small mb-1"><strong>Ability Scores:</strong></p>`}));

		const pickersContainer = e_({tag: "div"});

		// Single set: render directly
		if (chooseSets.length === 1) {
			renderAbiSet(chooseSets[0].choose, pickersContainer);
		} else {
			// Multiple sets are alternatives — let user pick which option
			const optionRow = e_({tag: "div", clazz: "mb-1"});
			chooseSets.forEach((abiSet, setIdx) => {
				const label = describeSet(abiSet.choose);
				const radioLbl = e_({outer: `<label class="mr-3"><input type="radio" name="${prefix}-asi-option" value="${setIdx}" ${setIdx === 0 ? "checked" : ""}> Option ${setIdx + 1}: ${label}</label>`});
				radioLbl.querySelector("input").addEventListener("change", () => {
					activeSetIdx = setIdx;
					renderAbiSet(chooseSets[setIdx].choose, pickersContainer);
					onUpdate();
				});
				optionRow.append(radioLbl);
			});
			container.append(optionRow);

			// Render the first option by default
			renderAbiSet(chooseSets[0].choose, pickersContainer);
		}

		container.append(pickersContainer);

		return {
			type: "ability",
			getSelections: () => ({...selections}),
			isComplete: () => {
				const totalRequired = Object.keys(selections).filter(k => !k.includes("_weight")).length;
				let filled = 0;
				Object.entries(selections).forEach(([key, val]) => {
					if (!key.includes("_weight") && val) filled++;
				});
				return totalRequired > 0 && filled >= totalRequired;
			},
		};
	}

	// endregion

	// region Clear/Apply Helpers

	_claimOriginProficiency (type, value, sourceId) {
		if (!value || !sourceId) return;
		this._state.claimProgressionOwnership?.(type, value, sourceId);
		if (type === "skills") {
			const key = String(value).toLowerCase().replace(/\s+/g, "");
			if ((this._state.getSkillProficiency?.(key) || 0) < 1) {
				if (this._state.addSkillProficiency) this._state.addSkillProficiency(key);
				else this._state.setSkillProficiency?.(key, 1);
			}
		} else if (type === "tools") {
			if (!this._state.hasToolProficiency?.(value)) this._state.addToolProficiency(value);
		} else if (type === "languages") {
			if (!this._state.hasLanguage?.(value)) this._state.addLanguage(value);
		} else if (type === "resistances") {
			if (!this._state.hasResistance?.(value)) this._state.addResistance(value);
		} else if (type === "weapons") {
			if (!this._state.hasWeaponProficiency?.(value)) this._state.addWeaponProficiency(value);
		} else if (type === "armor") {
			if (!this._state.hasArmorProficiency?.(value)) this._state.addArmorProficiency(value);
		} else if (type === "saves") {
			if (!(this._state.getSaveProficiencies?.() || []).some(save => String(save).toLowerCase() === String(value).toLowerCase())) {
				this._state.addSaveProficiency(value);
			}
		}
	}

	_releaseOriginProficiency (type, value, sourceId) {
		if (!value || !sourceId) return;
		const releaseOwnership = this._state.releaseProgressionOwnership;
		if (typeof releaseOwnership === "function" && !releaseOwnership.call(this._state, type, value, sourceId)) return;
		if (type === "skills") this._state.setSkillProficiency(String(value).toLowerCase().replace(/\s+/g, ""), 0);
		else if (type === "tools") this._state.removeToolProficiency(value);
		else if (type === "languages") this._state.removeLanguage(value);
		else if (type === "resistances") this._state.removeResistance(value);
		else if (type === "weapons") this._state.removeWeaponProficiency(value);
		else if (type === "armor") this._state.removeArmorProficiency(value);
		else if (type === "saves") this._state.removeSaveProficiency(value);
	}

	_clearLanguagesFromData (data, sourceId = null) {
		if (!data?.languageProficiencies) return;
		data.languageProficiencies.forEach(lp => {
			Object.keys(lp).forEach(lang => {
				if (lang === "anyStandard" || lang === "any" || lang === "choose") return;
				const value = CharacterSheetClassUtils.resolveLanguageProficiencyName(lang);
				if (sourceId) this._releaseOriginProficiency("languages", value, sourceId);
				else this._state.removeLanguage(value);
			});
		});
	}

	_clearUserChosenLanguages (userChoices, sourceId = null) {
		if (userChoices.selectedLanguages) {
			Object.values(userChoices.selectedLanguages).forEach(langArray => {
				if (Array.isArray(langArray)) {
					langArray.forEach(l => {
						if (sourceId) this._releaseOriginProficiency("languages", (/** @type {*} */ (l)).toTitleCase(), sourceId);
						else this._state.removeLanguage((/** @type {*} */ (l)).toTitleCase());
					});
				}
			});
		}
		if (userChoices.selectedSubraceLanguages?.length) {
			userChoices.selectedSubraceLanguages.forEach(l => {
				if (sourceId) this._releaseOriginProficiency("languages", (/** @type {*} */ (l)).toTitleCase(), sourceId);
				else this._state.removeLanguage((/** @type {*} */ (l)).toTitleCase());
			});
		}
		if (userChoices.tashasLanguageReplacements?.length) {
			userChoices.tashasLanguageReplacements.forEach(l => {
				if (l) {
					if (sourceId) this._releaseOriginProficiency("languages", (/** @type {*} */ (l)).toTitleCase(), sourceId);
					else this._state.removeLanguage((/** @type {*} */ (l)).toTitleCase());
				}
			});
		}
	}

	_clearSkillsFromData (data, sourceId = null) {
		if (!data?.skillProficiencies) return;
		data.skillProficiencies.forEach(sp => {
			Object.keys(sp).forEach(skill => {
				if (skill !== "any" && skill !== "choose") {
					const value = skill.toLowerCase().replace(/\s+/g, "");
					if (sourceId) this._releaseOriginProficiency("skills", value, sourceId);
					else this._state.setSkillProficiency(value, 0);
				}
			});
		});
	}

	_clearUserChosenSkills (userChoices, sourceId = null) {
		if (userChoices.selectedSkills?.length) {
			userChoices.selectedSkills.forEach(skill => {
				const value = skill.toLowerCase().replace(/\s+/g, "");
				if (sourceId) this._releaseOriginProficiency("skills", value, sourceId);
				else this._state.setSkillProficiency(value, 0);
			});
		}
		if (userChoices.tashasSkillReplacements?.length) {
			userChoices.tashasSkillReplacements.forEach(skill => {
				if (skill) {
					const value = skill.toLowerCase().replace(/\s+/g, "");
					if (sourceId) this._releaseOriginProficiency("skills", value, sourceId);
					else this._state.setSkillProficiency(value, 0);
				}
			});
		}
	}

	_clearResistancesFromData (data, sourceId = null) {
		if (!data?.resist) return;
		data.resist.forEach(r => {
			if (typeof r === "string") {
				if (sourceId) this._releaseOriginProficiency("resistances", r, sourceId);
				else this._state.removeResistance(r);
			}
		});
	}

	_clearProficienciesFromData (race, subrace, sourceId = null) {
		for (const data of [race, subrace]) {
			if (!data) continue;
			if (data.savingThrowProficiencies) {
				data.savingThrowProficiencies.forEach(save => {
					const values = typeof save === "string" ? [save] : Object.keys(save || {});
					values.forEach(value => {
						if (sourceId) this._releaseOriginProficiency("saves", value, sourceId);
						else this._state.removeSaveProficiency(value);
					});
				});
			}
			if (data.armorProficiencies) {
				data.armorProficiencies.forEach(ap => {
					Object.keys(ap).forEach(a => sourceId
						? this._releaseOriginProficiency("armor", (/** @type {*} */ (a)).toTitleCase(), sourceId)
						: this._state.removeArmorProficiency((/** @type {*} */ (a)).toTitleCase()));
				});
			}
			if (data.weaponProficiencies) {
				data.weaponProficiencies.forEach(wp => {
					Object.keys(wp).forEach(w => sourceId
						? this._releaseOriginProficiency("weapons", (/** @type {*} */ (w)).toTitleCase(), sourceId)
						: this._state.removeWeaponProficiency((/** @type {*} */ (w)).toTitleCase()));
				});
			}
			if (data.toolProficiencies) {
				data.toolProficiencies.forEach(tp => {
					Object.keys(tp).forEach(t => {
						if (t !== "any" && t !== "choose") {
							const value = (/** @type {*} */ (t)).toTitleCase();
							if (sourceId) this._releaseOriginProficiency("tools", value, sourceId);
							else this._state.removeToolProficiency(value);
						}
					});
				});
			}
		}
	}

	_clearToolsFromData (data, sourceId = null) {
		if (!data?.toolProficiencies) return;
		data.toolProficiencies.forEach(tp => {
			Object.entries(tp).forEach(([key, value]) => {
				if (key !== "choose" && key !== "any" && key !== "anyArtisansTool" && key !== "anyMusicalInstrument" && value === true) {
					const value = (/** @type {*} */ (key)).toTitleCase();
					if (sourceId) this._releaseOriginProficiency("tools", value, sourceId);
					else this._state.removeToolProficiency(value);
				}
			});
		});
	}

	_applySpeedFromRaceData (race) {
		if (!race.speed) return;
		if (typeof race.speed === "number") {
			this._state.setSpeed("walk", race.speed);
		} else {
			if (race.speed.walk) this._state.setSpeed("walk", race.speed.walk);
			["fly", "swim", "climb", "burrow"].forEach(speedType => {
				const speedValue = race.speed[speedType];
				if (speedValue === true) {
					this._state.addNamedModifier({
						name: `${race.name} ${speedType.charAt(0).toUpperCase() + speedType.slice(1)} Speed`,
						type: `speed:${speedType}`,
						value: 0,
						equalToWalk: true,
						sourceType: "race",
						enabled: true,
					});
				} else if (typeof speedValue === "number" && speedValue > 0) {
					this._state.setSpeed(speedType, speedValue);
				}
			});
		}
	}

	_applyFixedLanguages (data, sourceId = null) {
		if (!data?.languageProficiencies) return;
		data.languageProficiencies.forEach(langProf => {
			Object.keys(langProf).forEach(lang => {
				if (lang === "anyStandard" || lang === "any" || lang === "choose") return;
				const value = CharacterSheetClassUtils.resolveLanguageProficiencyName(/** @type {*} */ (lang));
				if (sourceId) this._claimOriginProficiency("languages", value, sourceId);
				else this._state.addLanguage(value);
			});
		});
	}

	_applyFixedSkills (data, sourceId = null) {
		if (!data?.skillProficiencies) return;
		data.skillProficiencies.forEach(skillProf => {
			Object.keys(skillProf).forEach(skill => {
				if (skill !== "any" && skill !== "choose") {
					const value = skill.toLowerCase().replace(/\s+/g, "");
					if (sourceId) this._claimOriginProficiency("skills", value, sourceId);
					else this._state.setSkillProficiency(value, 1);
				}
			});
		});
	}

	_applyFixedTools (data, sourceId = null) {
		if (!data?.toolProficiencies) return;
		data.toolProficiencies.forEach(toolSet => {
			Object.entries(toolSet).forEach(([key, value]) => {
				if (key !== "choose" && key !== "any" && key !== "anyArtisansTool" && key !== "anyMusicalInstrument" && value === true) {
					const value = (/** @type {*} */ (key)).toTitleCase();
					if (sourceId) this._claimOriginProficiency("tools", value, sourceId);
					else this._state.addToolProficiency(value);
				}
			});
		});
	}

	_applyProficienciesFromData (data, sourceId = null) {
		if (data.savingThrowProficiencies) {
			data.savingThrowProficiencies.forEach(save => {
				const values = typeof save === "string" ? [save] : Object.keys(save || {});
				values.forEach(value => {
					if (sourceId) this._claimOriginProficiency("saves", value, sourceId);
					else this._state.addSaveProficiency(value);
				});
			});
		}
		if (data.armorProficiencies) {
			data.armorProficiencies.forEach(ap => {
				Object.keys(ap).forEach(a => {
					const value = (/** @type {*} */ (a)).toTitleCase();
					if (sourceId) this._claimOriginProficiency("armor", value, sourceId);
					else this._state.addArmorProficiency(value);
				});
			});
		}
		if (data.weaponProficiencies) {
			data.weaponProficiencies.forEach(wp => {
				Object.keys(wp).forEach(w => {
					const value = (/** @type {*} */ (w)).toTitleCase();
					if (sourceId) this._claimOriginProficiency("weapons", value, sourceId);
					else this._state.addWeaponProficiency(value);
				});
			});
		}
		if (data.toolProficiencies) {
			data.toolProficiencies.forEach(tp => {
				Object.keys(tp).forEach(t => {
					if (t !== "any" && t !== "choose") {
						const value = (/** @type {*} */ (t)).toTitleCase();
						if (sourceId) this._claimOriginProficiency("tools", value, sourceId);
						else this._state.addToolProficiency(value);
					}
				});
			});
		}
	}

	/**
	 * Reapply racial ability bonuses after they were cleared (e.g., when background changes).
	 * Uses the race data stored on state to derive fixed bonuses.
	 */
	_reapplyRacialAbilityBonuses (history) {
		const race = this._state.getRace();
		if (race?.ability) {
			race.ability.forEach(abiSet => {
				Object.entries(abiSet).forEach(([abi, bonus]) => {
					if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi)) {
						const current = this._state.getAbilityBonus(abi) || 0;
						this._state.setAbilityBonus(abi, current + bonus);
					}
				});
			});
		}

		// Also reapply user-chosen racial ability bonuses from the character base node (fallback: history)
		const raceUserChoices = (this._state.getBaseRaceUserChoices ? this._state.getBaseRaceUserChoices() : null) || history?.choices?.raceUserChoices;
		if (raceUserChoices?.selectedAbilityChoices) {
			Object.entries(raceUserChoices.selectedAbilityChoices).forEach(([key, value]) => {
				if (!key.includes("_weight") && value) {
					const weightKey = `${key}_weight`;
					const bonus = raceUserChoices.selectedAbilityChoices[weightKey] || 0;
					if (bonus && Parser.ABIL_ABVS.includes(value)) {
						const current = this._state.getAbilityBonus(value) || 0;
						this._state.setAbilityBonus(value, current + bonus);
					}
				}
			});
		}
	}

	/**
	 * Reapply background ability bonuses after they were cleared (e.g., when race changes).
	 * Uses stored user choices from level history.
	 */
	_reapplyBackgroundAbilityBonuses (history) {
		const bgUserChoices = (this._state.getBaseBackgroundUserChoices ? this._state.getBaseBackgroundUserChoices() : null) || history.choices?.backgroundUserChoices;
		if (!bgUserChoices?.selectedAbilityBonuses) return;
		Object.entries(bgUserChoices.selectedAbilityBonuses).forEach(([key, value]) => {
			if (key.startsWith("bg_") && !key.includes("weight") && value) {
				const weightKey = `${key}_weight`;
				const bonus = bgUserChoices.selectedAbilityBonuses[weightKey] || 0;
				if (bonus && Parser.ABIL_ABVS.includes(value)) {
					const current = this._state.getAbilityBonus(value) || 0;
					this._state.setAbilityBonus(value, current + bonus);
				}
			}
		});
		// Also apply fixed background ability bonuses from the background data itself
		const bg = this._state.getBackground();
		if (bg?.ability) {
			bg.ability.forEach(abiSet => {
				Object.entries(abiSet).forEach(([abi, bonus]) => {
					if (abi !== "choose" && Parser.ABIL_ABVS.includes(abi)) {
						const current = this._state.getAbilityBonus(abi) || 0;
						this._state.setAbilityBonus(abi, current + bonus);
					}
				});
			});
		}
	}

	// endregion
}

// Export for use in charactersheet.js
(/** @type {*} */ (globalThis)).CharacterSheetRespec = CharacterSheetRespec;
