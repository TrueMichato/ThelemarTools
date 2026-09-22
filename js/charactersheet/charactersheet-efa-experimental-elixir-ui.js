import "./charactersheet-modal.js";

class CharacterSheetEfaExperimentalElixirUi {
	static getEffectEntries () {
		return Object.values(CharacterSheetState.EFA_EXPERIMENTAL_ELIXIR_EFFECTS);
	}

	static getEffectLabel (effectKey) {
		return this.getEffectEntries().find(it => it.key === effectKey)?.label || effectKey || "Unknown";
	}

	static formatDuration (duration) {
		if (!duration) return "Instantaneous";
		const amount = Number(duration.amount) || 0;
		const unit = `${duration.unit || "round"}${amount === 1 ? "" : "s"}`;
		return `${amount} ${unit}`;
	}

	static formatEffectSnapshot (effectKey, snapshot, {intelligenceModifier = null} = {}) {
		if (!snapshot) return "Effect details unavailable.";
		switch (effectKey) {
			case "healing": {
				const suffix = intelligenceModifier == null
					? " + Intelligence modifier at consumption"
					: ` ${intelligenceModifier >= 0 ? "+" : "-"} ${Math.abs(intelligenceModifier)}`;
				return `Regain ${snapshot.healing.dice}${suffix} Hit Points.`;
			}
			case "swiftness":
				return `Walking speed increases by ${snapshot.value.amount} feet for ${this.formatDuration(snapshot.duration)}.`;
			case "resilience":
				return `AC increases by ${snapshot.value.amount} for ${this.formatDuration(snapshot.duration)}.`;
			case "boldness":
				return `Add ${snapshot.value.dice} to attack rolls and saving throws for ${this.formatDuration(snapshot.duration)}.`;
			case "flight":
				return `Gain a ${snapshot.value.amount}-foot fly speed for ${this.formatDuration(snapshot.duration)}.`;
			default:
				return "Effect details unavailable.";
		}
	}

	static formatMetadataEffect (metadata, state) {
		return this.formatEffectSnapshot(metadata?.effectKey, metadata, {
			intelligenceModifier: metadata?.effectKey === "healing" ? state?.getAbilityMod?.("int") : null,
		});
	}

	static formatOrigin (metadata) {
		if (metadata?.origin === "spellSlot") return `Spell slot (level ${metadata.spentSlotLevel})`;
		if (metadata?.origin === "longRest") return "Long Rest batch";
		return "Unknown origin";
	}

	static formatRestExpiry (metadata) {
		if (!metadata?.duration) return "Applies immediately.";
		const endings = [];
		if (metadata.duration.endsOnShortRest) endings.push("Short Rest");
		if (metadata.duration.endsOnLongRest) endings.push("Long Rest");
		return endings.length
			? `Expires when its duration ends or on ${endings.join(" or ")}.`
			: `Expires when its ${this.formatDuration(metadata.duration)} duration ends.`;
	}

	static getAvailableSlotLevels (state) {
		return Array.from({length: 9}, (_, ix) => ix + 1)
			.filter(level => state.getSpellSlotsCurrent?.(level) > 0)
			.map(level => ({
				level,
				current: state.getSpellSlotsCurrent(level),
				max: state.getSpellSlotsMax?.(level) ?? state.getSpellSlotsCurrent(level),
			}));
	}

	static getFeatureStatus (state) {
		const batchSize = state.getEfaExperimentalElixirBatchSize?.() || 0;
		const suppliesRows = state.getEfaExperimentalElixirSuppliesRows?.() || [];
		const slots = this.getAvailableSlotLevels(state);
		const actionTracked = !!state.isInCombat?.();
		const actionAvailable = !actionTracked || !!state.isActionTypeAvailable?.("action");
		const candidates = (state.getItems?.() || []).map(row => ({
			row,
			classification: state.classifyEfaExperimentalElixir?.(row),
		}));
		const validRows = candidates.filter(it => it.classification?.status === "valid");
		const staleRows = candidates.filter(it => it.classification?.status === "stale");

		let disabledCode = null;
		if (!batchSize) disabledCode = "efa-experimental-elixir-unavailable";
		else if (!suppliesRows.length) disabledCode = "efa-experimental-elixir-focus-unavailable";
		else if (!slots.length) disabledCode = "efa-experimental-elixir-spell-slot-unavailable";
		else if (!actionAvailable) disabledCode = "efa-experimental-elixir-action-unavailable";

		return {
			available: !!batchSize,
			batchSize,
			suppliesRows,
			slots,
			actionTracked,
			actionAvailable,
			validRows,
			staleRows,
			disabledCode,
			disabledReason: disabledCode ? this.getErrorMessage(disabledCode) : null,
		};
	}

	static getErrorMessage (code, reason = null) {
		const messages = {
			"efa-experimental-elixir-unavailable": "Exact EFA Alchemist source is unavailable.",
			"efa-experimental-elixir-focus-unavailable": "Equip Alchemist's Supplies from XPHB and be proficient with them.",
			"efa-experimental-elixir-spell-slot-unavailable": "No standard spell slot from levels 1-9 is available.",
			"efa-experimental-elixir-action-unavailable": "Your Magic action has already been spent this turn.",
			"efa-experimental-elixir-bonus-action-unavailable": "Your Bonus Action has already been spent this turn.",
			"invalid-efa-experimental-elixir-effect": "Choose an Experimental Elixir effect.",
			"invalid-efa-experimental-elixir-slot-level": "Choose an available standard spell slot.",
			"efa-experimental-elixir-spell-slot-commit-failed": "The character changed before the vial could be created. Nothing was spent.",
			"efa-experimental-elixir-item-unavailable": "This vial is no longer available.",
			"stale-efa-experimental-elixir": "This generated vial needs repair before it can be consumed.",
			"invalid-efa-experimental-elixir-item": "This item is not a supported EFA Experimental Elixir.",
			"invalid-efa-experimental-elixir-item-quantity": "Generated Experimental Elixir vials must have a quantity of exactly 1.",
			"invalid-efa-experimental-elixir-external-target": "Enter the other creature's name.",
			"efa-experimental-elixir-other-range-unconfirmed": "Confirm that the other creature is within 5 feet.",
			"efa-experimental-elixir-other-confirmation-required": "Preview the handoff, then explicitly confirm administration.",
			"efa-experimental-elixir-consumption-failed": "The character changed before the vial could be consumed. Nothing was spent.",
			"invalid-efa-experimental-elixir-rest-draft": "The staged Experimental Elixir rest choice is no longer valid.",
			"invalid-efa-experimental-elixir-plan": "Resolve every rolled 6 before finishing the rest.",
		};
		const base = messages[code] || "Experimental Elixir could not be completed.";
		return reason ? `${base} (${this.formatRepairReason(reason)})` : base;
	}

	static formatRepairReason (reason) {
		return `${reason || "unsupported generated item"}`
			.replace(/^invalid-/, "")
			.replace(/^unsupported-/, "")
			.replaceAll("-", " ");
	}

	static renderFeatureStatusHtml (state) {
		const status = this.getFeatureStatus(state);
		const createDisabled = status.disabledCode ? " disabled" : "";
		const describedBy = status.disabledCode ? ` aria-describedby="efa-elixir-create-reason"` : "";
		const staleText = status.staleRows.length
			? `<span class="charsheet__efa-elixir-repair">${status.staleRows.length} repair required</span>`
			: "";
		const reason = status.disabledReason
			? `<p class="charsheet__efa-elixir-reason" id="efa-elixir-create-reason">${status.disabledReason}</p>`
			: `<p class="charsheet__efa-elixir-reason">Creating a vial spends one standard spell slot and, during combat, your Magic action.</p>`;
		return {
			status,
			headerHtml: `<span class="charsheet__efa-elixir-badge">${status.validRows.length} valid vial${status.validRows.length === 1 ? "" : "s"}</span>
				<span class="charsheet__efa-elixir-badge">Long Rest: ${status.batchSize || "-"}</span>
				<span class="charsheet__efa-elixir-badge">${status.suppliesRows.length ? "Supplies ready" : "Supplies missing"}</span>
				${staleText}`,
			actionHtml: `<button type="button" class="btn btn-xs btn-primary charsheet__efa-elixir-create"${createDisabled}${describedBy}>Create with Spell Slot</button>`,
			reasonHtml: reason,
		};
	}

	static renderCreateModalHtml (state) {
		const status = this.getFeatureStatus(state);
		const classLevel = state._getEfaAlchemistClassEntry?.()?.level || 0;
		const effects = this.getEffectEntries().map((effect, ix) => {
			const snapshot = CharacterSheetState.getEfaExperimentalElixirEffectSnapshot(effect.key, classLevel);
			return `<label class="charsheet__efa-elixir-choice">
				<input type="radio" name="efa-elixir-effect" value="${effect.key}"${ix === 0 ? " checked" : ""}>
				<span><strong>${effect.label}</strong><span>${this.formatEffectSnapshot(effect.key, snapshot, {
	intelligenceModifier: effect.key === "healing" ? state.getAbilityMod?.("int") : null,
})}</span></span>
			</label>`;
		}).join("");
		const slots = status.slots.map(slot =>
			`<option value="${slot.level}">Level ${slot.level} - ${slot.current} of ${slot.max} available</option>`,
		).join("");
		return `<div class="charsheet__efa-elixir-modal" data-efa-elixir-create-modal>
			<p id="efa-elixir-create-help">Requires equipped, proficient <strong>Alchemist's Supplies (XPHB)</strong>. Creating a vial spends one standard spell slot and${status.actionTracked ? "" : " only while in combat"} a <strong>Magic action</strong>.</p>
			${status.disabledReason ? `<p class="charsheet__efa-elixir-alert" data-efa-elixir-static-error>${status.disabledReason}</p>` : ""}
			<fieldset class="charsheet__efa-elixir-fieldset"${status.disabledCode ? " disabled" : ""} aria-describedby="efa-elixir-create-help">
				<legend>Effect</legend>
				<div class="charsheet__efa-elixir-choice-list">${effects}</div>
			</fieldset>
			<div class="charsheet__efa-elixir-field">
				<label for="efa-elixir-slot-level">Standard spell slot</label>
				<select id="efa-elixir-slot-level" class="form-control input-sm" data-efa-elixir-slot${status.disabledCode ? " disabled" : ""}>${slots}</select>
			</div>
			<div class="charsheet__efa-elixir-modal-actions">
				<button type="button" class="btn btn-default" data-efa-elixir-cancel>Cancel</button>
				<button type="button" class="btn btn-primary" data-efa-elixir-confirm${status.disabledCode ? " disabled" : ""}>Create vial</button>
			</div>
			<div class="charsheet__efa-elixir-live" role="status" aria-live="polite" aria-atomic="true" data-efa-elixir-live></div>
		</div>`;
	}

	static async commitCreate ({state, page, effectKey, slotLevel}) {
		const snapshot = state.toJson();
		const result = state.commitEfaExperimentalElixirSpellSlotVial({effectKey, slotLevel});
		if (!result?.ok || !result?.committed) return result;
		try {
			await page?.saveCharacter?.();
			page?.renderCharacter?.();
			return result;
		} catch (error) {
			state.loadFromJson(snapshot);
			page?.renderCharacter?.();
			return {
				ok: false,
				committed: false,
				code: "efa-experimental-elixir-spell-slot-commit-failed",
				error: error?.message,
				rolledBack: true,
			};
		}
	}

	static _createModalPersistenceLock ({wrp, eleModal, btnCancel}) {
		let isPending = false;
		const getHeaderClose = () => eleModal?.querySelector?.(".cs-modal__btn-close") || null;
		return {
			canClose: () => !isPending,
			setPending: nextIsPending => {
				isPending = !!nextIsPending;
				if (btnCancel) btnCancel.disabled = isPending;
				const btnHeaderClose = getHeaderClose();
				if (btnHeaderClose) btnHeaderClose.disabled = isPending;
				if (isPending) wrp?.setAttribute?.("aria-busy", "true");
				else wrp?.removeAttribute?.("aria-busy");
			},
		};
	}

	static async _pRunPersistenceLocked ({lock, operation}) {
		lock.setPending(true);
		try {
			const result = await operation();
			if (!result?.ok || !result?.committed) lock.setPending(false);
			return result;
		} catch (error) {
			lock.setPending(false);
			throw error;
		}
	}

	static async pShowCreateModal ({state, page}) {
		let persistenceLock = null;
		const {eleModal, eleModalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "Create Experimental Elixir",
			isMinHeight0: true,
			getFocusRestoreTarget: () => document.querySelector?.(".charsheet__efa-elixir-create"),
			fnCanClose: () => persistenceLock?.canClose() ?? true,
		});
		const wrp = e_({outer: this.renderCreateModalHtml(state)});
		eleModalInner.append(wrp);
		const live = wrp.querySelector("[data-efa-elixir-live]");
		const btnConfirm = wrp.querySelector("[data-efa-elixir-confirm]");
		const btnCancel = wrp.querySelector("[data-efa-elixir-cancel]");
		const selectSlot = wrp.querySelector("[data-efa-elixir-slot]");
		let isCommitted = false;
		persistenceLock = this._createModalPersistenceLock({wrp, eleModal, btnCancel});

		btnCancel?.addEventListener("click", () => doClose(false));
		btnConfirm?.addEventListener("click", async () => {
			if (isCommitted) {
				doClose(true);
				return;
			}
			const effectKey = wrp.querySelector("input[name=\"efa-elixir-effect\"]:checked")?.value;
			const slotLevel = Number(selectSlot?.value);
			btnConfirm.disabled = true;
			if (live) live.textContent = "Creating vial...";
			const result = await this._pRunPersistenceLocked({
				lock: persistenceLock,
				operation: () => this.commitCreate({state, page, effectKey, slotLevel}),
			});
			if (!result?.ok || !result?.committed) {
				btnConfirm.disabled = false;
				if (live) {
					live.classList.add("charsheet__efa-elixir-live--error");
					live.textContent = this.getErrorMessage(result?.code, result?.error || result?.reason);
				}
				return;
			}
			isCommitted = true;
			persistenceLock.setPending(false);
			wrp.querySelectorAll("input, select").forEach(ele => { ele.disabled = true; });
			btnCancel.hidden = true;
			btnConfirm.disabled = false;
			btnConfirm.textContent = "Done";
			if (live) {
				live.classList.remove("charsheet__efa-elixir-live--error");
				live.textContent = `${this.getEffectLabel(result.metadata.effectKey)} vial created with a level ${result.spentSlotLevel} spell slot${result.actionTracked ? "; Magic action spent" : ""}.`;
			}
		});
		CharacterSheetModal.focusFirst(eleModalInner, {preferSelector: "input[name=\"efa-elixir-effect\"]"});
	}

	static getConsumeStatus (state, itemId) {
		const row = state.getItems?.().find(it => it.id === itemId) || null;
		const classification = state.classifyEfaExperimentalElixir?.(row);
		const actionTracked = !!state.isInCombat?.();
		const actionAvailable = !actionTracked || !!state.isActionTypeAvailable?.("bonus");
		let disabledCode = null;
		if (!row) disabledCode = "efa-experimental-elixir-item-unavailable";
		else if (classification?.status === "stale") disabledCode = "stale-efa-experimental-elixir";
		else if (classification?.status !== "valid") disabledCode = "invalid-efa-experimental-elixir-item";
		else if (!actionAvailable) disabledCode = "efa-experimental-elixir-bonus-action-unavailable";
		return {
			row,
			classification,
			actionTracked,
			actionAvailable,
			disabledCode,
			disabledReason: disabledCode
				? this.getErrorMessage(disabledCode, classification?.reason)
				: null,
		};
	}

	static renderConsumeModalHtml (state, itemId) {
		const status = this.getConsumeStatus(state, itemId);
		const metadata = status.classification?.metadata;
		const effectLabel = this.getEffectLabel(metadata?.effectKey);
		const effectText = metadata ? this.formatMetadataEffect(metadata, state) : "Effect unavailable.";
		const disabled = status.disabledCode ? " disabled" : "";
		return `<div class="charsheet__efa-elixir-modal" data-efa-elixir-consume-modal>
			<div class="charsheet__efa-elixir-summary" id="efa-elixir-consume-help">
				<strong>${effectLabel}</strong>
				<span>${effectText}</span>
				<span>${metadata ? this.formatRestExpiry(metadata) : ""}</span>
				<span>Cost: Bonus Action${status.actionTracked ? "" : " when tracked in combat"}.</span>
			</div>
			${status.disabledReason ? `<p class="charsheet__efa-elixir-alert" data-efa-elixir-static-error>${status.disabledReason}</p>` : ""}
			<fieldset class="charsheet__efa-elixir-fieldset"${disabled} aria-describedby="efa-elixir-consume-help">
				<legend>Recipient</legend>
				<label class="charsheet__efa-elixir-inline-choice"><input type="radio" name="efa-elixir-target" value="self" checked> Self</label>
				<label class="charsheet__efa-elixir-inline-choice"><input type="radio" name="efa-elixir-target" value="other"> Other</label>
			</fieldset>
			<div class="charsheet__efa-elixir-other" data-efa-elixir-other hidden>
				<div class="charsheet__efa-elixir-field">
					<label for="efa-elixir-target-name">Other creature's name</label>
					<input id="efa-elixir-target-name" class="form-control input-sm" type="text" autocomplete="off" data-efa-elixir-target-name aria-describedby="efa-elixir-other-help">
				</div>
				<label class="charsheet__efa-elixir-check">
					<input type="checkbox" data-efa-elixir-within-five>
					<span>I confirm this creature is within 5 feet.</span>
				</label>
				<p class="ve-muted ve-small" id="efa-elixir-other-help">This creates a handoff for the other creature. It does not change external HP or state.</p>
			</div>
			<div class="charsheet__efa-elixir-modal-actions">
				<button type="button" class="btn btn-default" data-efa-elixir-cancel>Cancel</button>
				<button type="button" class="btn btn-primary" data-efa-elixir-confirm${disabled}>Drink elixir</button>
			</div>
			<div class="charsheet__efa-elixir-live" role="status" aria-live="polite" aria-atomic="true" data-efa-elixir-live></div>
		</div>`;
	}

	static async commitConsume ({state, page, itemId, target, targetName = null, within5Feet = false}) {
		const snapshot = state.toJson();
		const result = state.consumeEfaExperimentalElixir({
			itemId,
			target,
			targetName,
			within5Feet,
			confirmed: target === "other",
		});
		if (!result?.ok || !result?.committed) return result;
		try {
			await page?.saveCharacter?.();
			page?.renderCharacter?.();
			return result;
		} catch (error) {
			state.loadFromJson(snapshot);
			page?.renderCharacter?.();
			return {
				ok: false,
				committed: false,
				code: "efa-experimental-elixir-consumption-failed",
				error: error?.message,
				rolledBack: true,
			};
		}
	}

	static async copyText (text) {
		try {
			if (globalThis.navigator?.clipboard?.writeText) {
				await globalThis.navigator.clipboard.writeText(text);
				return {ok: true, method: "clipboard"};
			}
			const textarea = document.createElement("textarea");
			textarea.value = text;
			textarea.setAttribute("readonly", "");
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			document.body.append(textarea);
			textarea.select();
			const copied = document.execCommand?.("copy");
			textarea.remove();
			return copied
				? {ok: true, method: "fallback"}
				: {ok: false, method: "fallback"};
		} catch (error) {
			return {ok: false, error: error?.message};
		}
	}

	static _renderHandoffResult (live, handoff) {
		live.replaceChildren();
		const summary = document.createElement("p");
		summary.textContent = handoff.summary;
		const label = document.createElement("label");
		label.setAttribute("for", "efa-elixir-handoff-output");
		label.textContent = "Structured handoff";
		const output = document.createElement("textarea");
		output.id = "efa-elixir-handoff-output";
		output.className = "form-control charsheet__efa-elixir-handoff";
		output.readOnly = true;
		output.rows = 10;
		output.value = JSON.stringify(handoff, null, 2);
		const btnCopy = document.createElement("button");
		btnCopy.type = "button";
		btnCopy.className = "btn btn-default btn-sm";
		btnCopy.textContent = "Copy handoff";
		const copyStatus = document.createElement("span");
		copyStatus.className = "ve-small ve-muted";
		btnCopy.addEventListener("click", async () => {
			const copied = await this.copyText(output.value);
			copyStatus.textContent = copied.ok
				? `Copied${copied.method === "fallback" ? " using fallback" : ""}.`
				: "Copy failed. Select the handoff text and copy it manually.";
			if (!copied.ok) output.focus();
		});
		live.append(summary, label, output, btnCopy, copyStatus);
	}

	static getConsumeFocusRestoreTarget (itemId) {
		const consumeActions = [...(document.querySelectorAll?.("[data-efa-elixir-consume]") || [])];
		return consumeActions.find(ele => ele.dataset?.efaElixirConsume === itemId)
			|| consumeActions[0]
			|| document.querySelector?.("#charsheet-ipt-inventory-search")
			|| document.querySelector?.("#charsheet-btn-add-item")
			|| document.querySelector?.("#charsheet-btn-starred-filter")
			|| null;
	}

	static async pShowConsumeModal ({state, page, itemId}) {
		let persistenceLock = null;
		const {eleModal, eleModalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "Drink or Administer Experimental Elixir",
			isMinHeight0: true,
			getFocusRestoreTarget: () => this.getConsumeFocusRestoreTarget(itemId),
			fnCanClose: () => persistenceLock?.canClose() ?? true,
		});
		const wrp = e_({outer: this.renderConsumeModalHtml(state, itemId)});
		eleModalInner.append(wrp);
		const live = wrp.querySelector("[data-efa-elixir-live]");
		const btnConfirm = wrp.querySelector("[data-efa-elixir-confirm]");
		const btnCancel = wrp.querySelector("[data-efa-elixir-cancel]");
		const wrpOther = wrp.querySelector("[data-efa-elixir-other]");
		const inputTargetName = wrp.querySelector("[data-efa-elixir-target-name]");
		const inputWithinFive = wrp.querySelector("[data-efa-elixir-within-five]");
		let previewFingerprint = null;
		let isCommitted = false;
		persistenceLock = this._createModalPersistenceLock({wrp, eleModal, btnCancel});

		const getValues = () => {
			const target = wrp.querySelector("input[name=\"efa-elixir-target\"]:checked")?.value || "self";
			return {
				target,
				targetName: inputTargetName?.value?.trim() || "",
				within5Feet: !!inputWithinFive?.checked,
			};
		};
		const clearPreview = () => {
			previewFingerprint = null;
			if (live) {
				live.replaceChildren();
				live.classList.remove("charsheet__efa-elixir-live--error");
			}
			const {target} = getValues();
			if (btnConfirm && !isCommitted) btnConfirm.textContent = target === "other" ? "Preview handoff" : "Drink elixir";
		};
		const syncTarget = () => {
			const {target} = getValues();
			if (wrpOther) wrpOther.hidden = target !== "other";
			clearPreview();
			if (target === "other") inputTargetName?.focus();
		};

		wrp.querySelectorAll("input[name=\"efa-elixir-target\"]").forEach(ele => ele.addEventListener("change", syncTarget));
		inputTargetName?.addEventListener("input", clearPreview);
		inputWithinFive?.addEventListener("change", clearPreview);
		btnCancel?.addEventListener("click", () => doClose(false));
		btnConfirm?.addEventListener("click", async () => {
			if (isCommitted) {
				doClose(true);
				return;
			}
			const values = getValues();
			const fingerprint = JSON.stringify(values);
			if (values.target === "other" && previewFingerprint !== fingerprint) {
				const preview = state.previewEfaExperimentalElixirOtherHandoff({
					itemId,
					targetName: values.targetName,
					within5Feet: values.within5Feet,
				});
				if (!preview?.ok) {
					if (live) {
						live.classList.add("charsheet__efa-elixir-live--error");
						live.textContent = this.getErrorMessage(preview?.code, preview?.error || preview?.reason);
					}
					if (preview?.code === "invalid-efa-experimental-elixir-external-target") inputTargetName?.focus();
					else if (preview?.code === "efa-experimental-elixir-other-range-unconfirmed") inputWithinFive?.focus();
					return;
				}
				if (live) {
					live.classList.remove("charsheet__efa-elixir-live--error");
					live.textContent = `${preview.handoff.summary} Confirm to spend the vial and create the external handoff.`;
				}
				previewFingerprint = fingerprint;
				btnConfirm.textContent = "Administer and create handoff";
				return;
			}

			btnConfirm.disabled = true;
			if (live) live.textContent = values.target === "other" ? "Creating handoff..." : "Drinking elixir...";
			const result = await this._pRunPersistenceLocked({
				lock: persistenceLock,
				operation: () => this.commitConsume({state, page, itemId, ...values}),
			});
			if (!result?.ok || !result?.committed) {
				btnConfirm.disabled = false;
				previewFingerprint = null;
				if (live) {
					live.classList.add("charsheet__efa-elixir-live--error");
					live.textContent = this.getErrorMessage(result?.code, result?.error || result?.reason);
				}
				return;
			}
			isCommitted = true;
			persistenceLock.setPending(false);
			wrp.querySelectorAll("input").forEach(ele => { ele.disabled = true; });
			btnCancel.hidden = true;
			btnConfirm.disabled = false;
			btnConfirm.textContent = "Done";
			if (live) {
				live.classList.remove("charsheet__efa-elixir-live--error");
				if (result.target === "other") this._renderHandoffResult(live, result.result.handoff);
				else if (result.result.type === "healing") {
					live.textContent = `Elixir consumed. Restored ${result.result.healed} Hit Points (${result.result.formula}).`;
				} else {
					live.textContent = `${this.getEffectLabel(result.effectKey)} is active. The vial was consumed${result.actionConsumed ? " and your Bonus Action was spent" : ""}.`;
				}
			}
		});
		CharacterSheetModal.focusFirst(eleModalInner, {preferSelector: "input[name=\"efa-elixir-target\"]"});
	}
}

globalThis.CharacterSheetEfaExperimentalElixirUi = CharacterSheetEfaExperimentalElixirUi;

export {CharacterSheetEfaExperimentalElixirUi};
