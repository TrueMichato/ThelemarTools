import {CharacterSheetModal} from "./charactersheet-modal.js";
import {CharacterSheetArtificerPlans} from "./charactersheet-artificer-plans.js";

const {e_, ee, Parser} = /** @type {*} */ (globalThis);

/**
 * Shared Operate-mode picker for Builder, Level Up, Quick Build, and Respec.
 * All edits stay local until the caller commits returned decisions.
 */
class CharacterSheetArtificerPlanPicker {
	static getCatalog (page) {
		return CharacterSheetArtificerPlans.parseCatalog({
			feature: CharacterSheetArtificerPlans.findFeature({
				classFeatures: page?.getClassFeatures?.() || [],
			}),
			items: page?.getItems?.() || [],
		});
	}

	static getOpportunitiesForLevels ({levels = [], extensions = []} = {}) {
		return levels.flatMap(level => CharacterSheetArtificerPlans.getProgressionOpportunities({
			className: level.className,
			classSource: level.classSource,
			classLevel: level.classLevel,
			extensions,
		}).map(opportunity => ({
			...opportunity,
			characterLevel: level.characterLevel,
		})));
	}

	static _getInitialSelectionMap (initialSelections) {
		if (initialSelections instanceof Map) return new Map([...initialSelections.entries()].map(([key, value]) => [key, CharacterSheetArtificerPlans._copy(value)]));
		return new Map(Object.entries(initialSelections || {}).map(([key, value]) => [key, CharacterSheetArtificerPlans._copy(value)]));
	}

	static _getDecisionDrafts ({opportunities, selections}) {
		return opportunities.map(opportunity => ({
			...opportunity,
			selection: CharacterSheetArtificerPlans._copy(selections.get(opportunity.opportunityId) || null),
		}));
	}

	static _getSlotsBefore ({opportunities, selections, activeIndex, initialSlots}) {
		const decisions = CharacterSheetArtificerPlanPicker._getDecisionDrafts({
			opportunities: opportunities.slice(0, Math.max(0, activeIndex)),
			selections,
		});
		return CharacterSheetArtificerPlans.projectDecisions({decisions, initialSlots}).slots;
	}

	static _getSourceLabel (source) {
		return globalThis.Parser?.sourceJsonToAbv?.(source) || source;
	}

	static async pGetUserDecisions ({
		page,
		state,
		levels = [],
		opportunities = null,
		initialSelections = {},
		initialSlots = null,
		title = "Replicate Magic Item Plans",
		extensions = [],
	} = {}) {
		const catalog = this.getCatalog(page);
		const resolvedOpportunities = opportunities || this.getOpportunitiesForLevels({levels, extensions});
		if (!resolvedOpportunities.length) return [];
		const selections = this._getInitialSelectionMap(initialSelections);
		const baseSlots = initialSlots || state?.getEfaArtificerPlanProjection?.().slots || [];
		let activeIndex = Math.max(0, resolvedOpportunities.findIndex(opportunity => opportunity.required && !selections.get(opportunity.opportunityId)));
		if (activeIndex < 0) activeIndex = 0;
		let isResolved = false;
		let resolveResult;
		const resultPromise = new Promise(resolve => { resolveResult = resolve; });
		const {eleModalInner, eleModalFooter, doClose} = await CharacterSheetModal.pGetShow({
			title,
			isMinHeight0: true,
			isWidth100: true,
			isUncappedWidth: true,
			isUncappedHeight: true,
			hasFooter: true,
			cbClose: () => {
				if (isResolved) return;
				isResolved = true;
				resolveResult(null);
			},
		});

		const root = e_({tag: "div", clazz: "charsheet__artificer-plan-picker cs-adaptive-panel"});
		const opportunityList = e_({tag: "div", clazz: "charsheet__artificer-plan-opportunities"});
		const editor = e_({tag: "div", clazz: "charsheet__artificer-plan-editor"});
		const feedback = e_({
			tag: "div",
			clazz: "charsheet__artificer-plan-feedback ve-small",
		});
		feedback.setAttribute("role", "status");
		feedback.setAttribute("aria-live", "polite");
		root.append(opportunityList, editor);
		eleModalInner.append(root);

		const renderOpportunities = () => {
			opportunityList.innerHTML = "";
			const selectedRequired = resolvedOpportunities.filter(opportunity =>
				opportunity.required && selections.has(opportunity.opportunityId),
			).length;
			const requiredCount = resolvedOpportunities.filter(opportunity => opportunity.required).length;
			opportunityList.append(e_({
				tag: "div",
				clazz: "charsheet__artificer-plan-count",
				txt: `${selectedRequired}/${requiredCount} required plans selected`,
			}));
			resolvedOpportunities.forEach((opportunity, ix) => {
				const selection = selections.get(opportunity.opportunityId);
				const button = e_({
					tag: "button",
					clazz: `ve-btn charsheet__artificer-plan-opportunity ${ix === activeIndex ? "active" : ""} ${selection ? "complete" : ""}`,
				});
				button.type = "button";
				button.setAttribute("aria-current", ix === activeIndex ? "step" : "false");
				const value = opportunity.kind === "replacement"
					? selection
						? `${selection.previousPlan?.name || "Unknown"} → ${selection.nextPlan?.name || "Unknown"}`
						: "No replacement"
					: selection
						? `${selection.name} (${this._getSourceLabel(selection.source)})`
						: "Choose a plan";
				button.append(
					e_({tag: "span", clazz: "ve-bold", txt: opportunity.kind === "replacement" ? `Level ${opportunity.classLevel} replacement` : `Level ${opportunity.classLevel} plan`}),
					e_({tag: "span", clazz: "ve-small", txt: value}),
				);
				button.addEventListener("click", () => {
					activeIndex = ix;
					render();
				});
				opportunityList.append(button);
			});
		};

		const renderEditor = () => {
			editor.innerHTML = "";
			const opportunity = resolvedOpportunities[activeIndex];
			const slotsBefore = this._getSlotsBefore({
				opportunities: resolvedOpportunities,
				selections,
				activeIndex,
				initialSlots: baseSlots,
			});
			const current = selections.get(opportunity.opportunityId) || null;
			editor.append(e_({
				tag: "h4",
				txt: opportunity.kind === "replacement"
					? `Level ${opportunity.classLevel}: Replace One Plan`
					: `Level ${opportunity.classLevel}: Choose Plan`,
			}));
			editor.append(e_({
				tag: "p",
				clazz: "ve-muted",
				txt: opportunity.kind === "replacement"
					? "Replacement is optional. Select one known plan and review its replacement before committing."
					: "Choose one exact plan. Fixed plans and wildcard-category items share the same source-qualified identity.",
			}));

			let targetSlotId = opportunity.kind === "replacement" ? current?.targetSlotId || "" : null;
			if (opportunity.kind === "replacement") {
				if (!slotsBefore.length) {
					editor.append(e_({tag: "div", clazz: "ve-alert ve-alert-warning", txt: "No resolved plan is available to replace. Repair earlier plan decisions first."}));
					return;
				}
				const targetLabel = e_({tag: "label", clazz: "ve-flex-col mb-2"});
				targetLabel.append(e_({tag: "span", clazz: "ve-bold mb-1", txt: "Plan to replace"}));
				const target = e_({tag: "select", clazz: "ve-form-control"});
				target.setAttribute("aria-label", "Plan to replace");
				target.append(e_({tag: "option", txt: "Select a known plan…"}));
				slotsBefore.forEach(slot => {
					const option = e_({tag: "option", txt: `${slot.selection.name} (${this._getSourceLabel(slot.selection.source)})`});
					option.value = slot.slotId;
					option.selected = slot.slotId === targetSlotId;
					target.append(option);
				});
				target.addEventListener("change", () => {
					targetSlotId = target.value;
					selections.delete(opportunity.opportunityId);
					render();
				});
				targetLabel.append(target);
				editor.append(targetLabel);
				if (!targetSlotId) {
					editor.append(e_({tag: "p", clazz: "ve-muted", txt: "Choose the known plan you want to replace to unlock eligible replacements."}));
					return;
				}
			}

			const searchRow = e_({tag: "div", clazz: "charsheet__artificer-plan-filters"});
			const search = e_({tag: "input", clazz: "ve-form-control"});
			search.type = "search";
			search.placeholder = "Search plan name or source…";
			search.setAttribute("aria-label", "Search magic item plans");
			const kindFilter = e_({tag: "select", clazz: "ve-form-control"});
			kindFilter.setAttribute("aria-label", "Filter fixed or wildcard plans");
			[
				["all", "All plans"],
				["fixed", "Fixed plans"],
				["wildcard", "Wildcard items"],
			].forEach(([value, label]) => {
				const option = e_({tag: "option", txt: label});
				option.value = value;
				kindFilter.append(option);
			});
			searchRow.append(search, kindFilter);
			editor.append(searchRow);

			const selectedSummary = e_({tag: "div", clazz: "charsheet__artificer-plan-review"});
			const list = e_({tag: "div", clazz: "charsheet__artificer-plan-results"});
			editor.append(selectedSummary, list, feedback);

			const renderResults = () => {
				list.innerHTML = "";
				selectedSummary.innerHTML = "";
				const targetSlot = slotsBefore.find(slot => slot.slotId === targetSlotId);
				const currentPlan = opportunity.kind === "replacement" ? current?.nextPlan : current;
				if (currentPlan) {
					selectedSummary.append(e_({
						tag: "div",
						clazz: "ve-alert ve-alert-success",
						txt: opportunity.kind === "replacement"
							? `Review: ${targetSlot?.selection?.name || current.previousPlan?.name || "Unknown"} → ${currentPlan.name} (${this._getSourceLabel(currentPlan.source)})`
							: `Selected: ${currentPlan.name} (${this._getSourceLabel(currentPlan.source)})`,
					}));
				}
				const usedSlots = slotsBefore.filter(slot => slot.slotId !== targetSlotId);
				const used = new Set(usedSlots.map(slot => CharacterSheetArtificerPlans.getSelectionIdentity(slot.selection)));
				const query = search.value.trim().toLowerCase();
				const kind = kindFilter.value;
				const candidates = CharacterSheetArtificerPlans.getEligibleCandidates({
					catalog,
					classLevel: opportunity.classLevel,
					constraints: opportunity.constraints,
				}).filter(candidate =>
					(kind === "all" || candidate.planKind === kind)
					&& (!query || [
						candidate.name,
						candidate.displayName,
						candidate.source,
						candidate.categoryLabel,
					].some(value => String(value || "").toLowerCase().includes(query))),
				);
				for (const candidate of candidates.slice(0, 250)) {
					const identity = CharacterSheetArtificerPlans.getSelectionIdentity(candidate);
					const isDuplicate = used.has(identity);
					const row = e_({
						tag: "button",
						clazz: `ve-btn charsheet__artificer-plan-result ${CharacterSheetArtificerPlans.getSelectionIdentity(currentPlan) === identity ? "selected" : ""}`,
					});
					row.type = "button";
					row.disabled = isDuplicate;
					row.setAttribute("aria-pressed", CharacterSheetArtificerPlans.getSelectionIdentity(currentPlan) === identity ? "true" : "false");
					row.setAttribute("aria-label", `${candidate.displayName || candidate.name}, ${this._getSourceLabel(candidate.source)}, ${candidate.planKind}, available at level ${candidate.tableLevel}${isDuplicate ? ", already known in another plan slot" : ""}`);
					row.append(
						ee`<span class="charsheet__artificer-plan-result-main">
							<span class="ve-bold">${candidate.displayName || candidate.name}</span>
							<span class="ve-small ve-muted">${candidate.name !== candidate.displayName ? candidate.name : ""}</span>
						</span>`,
						ee`<span class="charsheet__artificer-plan-badges">
							<span class="badge">${this._getSourceLabel(candidate.source)}</span>
							<span class="badge">${candidate.planKind === "fixed" ? "Fixed" : "Wildcard"}</span>
							<span class="badge">Level ${candidate.tableLevel}+</span>
							${isDuplicate ? ee`<span class="badge">Already known</span>` : ""}
						</span>`,
					);
					if (isDuplicate) row.title = "Already known in another plan slot.";
					row.addEventListener("click", () => {
						if (opportunity.kind === "replacement") {
							selections.set(opportunity.opportunityId, {
								targetSlotId,
								previousPlan: CharacterSheetArtificerPlans._copy(targetSlot.selection),
								nextPlan: CharacterSheetArtificerPlans._copy(candidate),
								priorReplacementSemanticKey: targetSlot.lineage?.at(-1)?.semanticKey || null,
							});
						} else {
							selections.set(opportunity.opportunityId, CharacterSheetArtificerPlans._copy(candidate));
						}
						feedback.textContent = `${candidate.name} selected.`;
						render();
					});
					list.append(row);
				}
				if (!candidates.length) {
					const empty = e_({tag: "div", clazz: "ve-alert ve-alert-warning"});
					empty.append(e_({tag: "p", txt: "No eligible plans match these filters."}));
					const reset = e_({tag: "button", clazz: "ve-btn ve-btn-default ve-btn-sm", txt: "Reset filters"});
					reset.type = "button";
					reset.addEventListener("click", () => {
						search.value = "";
						kindFilter.value = "all";
						renderResults();
						search.focus();
					});
					empty.append(reset);
					list.append(empty);
				}
			};
			search.addEventListener("input", renderResults);
			kindFilter.addEventListener("change", renderResults);
			renderResults();

			if (opportunity.kind === "replacement" && current) {
				const clear = e_({tag: "button", clazz: "ve-btn ve-btn-default ve-btn-sm mt-2", txt: "Keep Current Plans"});
				clear.type = "button";
				clear.addEventListener("click", () => {
					selections.delete(opportunity.opportunityId);
					render();
				});
				editor.append(clear);
			}
			globalThis.requestAnimationFrame?.(() => search.focus());
		};

		const render = () => {
			renderOpportunities();
			renderEditor();
		};

		const cancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		cancel.type = "button";
		cancel.addEventListener("click", () => doClose(false));
		const commit = e_({tag: "button", clazz: "ve-btn ve-btn-primary", txt: "Review & Commit Plans"});
		commit.type = "button";
		commit.addEventListener("click", () => {
			const decisions = this._getDecisionDrafts({opportunities: resolvedOpportunities, selections});
			const validation = CharacterSheetArtificerPlans.validateDraft({
				catalog,
				decisions,
				initialSlots: baseSlots,
			});
			if (!validation.isValid) {
				const first = validation.issues[0];
				feedback.textContent = first.message;
				const failedIndex = resolvedOpportunities.findIndex(opportunity => opportunity.opportunityId === first.opportunityId);
				if (failedIndex >= 0) activeIndex = failedIndex;
				render();
				return;
			}
			isResolved = true;
			resolveResult(decisions);
			doClose(true);
		});
		eleModalFooter.append(ee`<div class="charsheet__artificer-plan-actions">${cancel}${commit}</div>`);
		render();
		return resultPromise;
	}
}

export {CharacterSheetArtificerPlanPicker};
globalThis.CharacterSheetArtificerPlanPicker = CharacterSheetArtificerPlanPicker;
