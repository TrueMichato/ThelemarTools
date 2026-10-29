import {CharacterSheetModal} from "./charactersheet-modal.js";

const {e_, JqueryUtil, Renderer, MiscUtil, InputUiUtil} = /** @type {*} */ (globalThis);
const escape = value => CharacterSheetModal._escapeHtml(value ?? "");

class CharacterSheetSimulacrum {
	static isSimulacrum (companion) {
		return companion?.actorSnapshot?.kind === "simulacrum";
	}

	static _captureOwner (page) {
		const state = page.getState();
		return {state, data: state._data, generation: page._characterLoadGeneration, characterId: page._currentCharacterId};
	}

	static _isOwnerCurrent (page, context) {
		return page.getState() === context.state
			&& context.state._data === context.data
			&& page._characterLoadGeneration === context.generation;
	}

	static _notifyError (message) {
		JqueryUtil.doToast({type: "danger", content: escape(message)});
	}

	static async _pSave (page, context = this._captureOwner(page)) {
		if (!this._isOwnerCurrent(page, context)) throw new Error("The selected character changed before the operation could be saved.");
		const result = page._saveCurrentCharacter
			? await page._saveCurrentCharacter({
				isReturnStatus: true,
				expectedCharacterId: context.characterId,
				expectedLoadGeneration: context.generation,
			})
			: await page.saveCharacter();
		if (result === false || result?.ok === false) throw new Error("The character could not be saved.");
	}

	static _refreshOwner (page) {
		page._renderCompanions?.();
		page._renderCurrency?.();
		if (page.getState().getViewMode?.() === "play") page._playMode?.render();
	}

	static _getStatblockHtml (companion) {
		if (!companion.statblock) throw new Error("The saved statblock is missing. Import a valid character backup or create a new Simulacrum.");
		if (!Renderer.monster?.getCompactRenderedString) throw new Error("The creature renderer is unavailable. Reload the page before trying again.");
		return `<table class="stats stats--book">${Renderer.monster.getCompactRenderedString(companion.statblock, {isShowScalers: false})}</table>`;
	}

	static async pPrepareCreation ({ownerPage, spellSource}) {
		const context = this._captureOwner(ownerPage);
		const prepared = context.state.prepareSimulacrumSnapshot({spellSource});
		if (!prepared.ok) {
			this._notifyError(prepared.message);
			return null;
		}
		const companion = prepared.companionData;
		const snapshot = companion.actorSnapshot;
		const existing = context.state.getCompanions().filter(it => this.isSimulacrum(it)
			&& it.actorSnapshot.creatorActorId === snapshot.creatorActorId
			&& it.actorSnapshot.lifecycle === "active");
		const fingerprint = JSON.stringify(context.data);
		let resolve;
		let settled = false;
		const outcome = new Promise(fn => { resolve = fn; });
		const finish = value => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		const {eleModalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "Create Simulacrum",
			isMinHeight0: true,
			isWidth100: true,
			cbClose: () => finish(null),
		});
		const body = e_({tag: "div", clazz: "cs-simulacrum cs-simulacrum--creation"});
		body.append(e_({outer: `<fieldset class="cs-simulacrum__targets">
			<legend>Creature to duplicate</legend>
			<label><input type="radio" name="simulacrum-target" value="self" checked> Own character</label>
			<label class="cs-simulacrum__unavailable"><input type="radio" name="simulacrum-target" value="creature" disabled aria-describedby="simulacrum-creature-unavailable"> Specific creature</label>
			<p id="simulacrum-creature-unavailable" class="cs-simulacrum__hint">Duplicating a bestiary creature is not implemented.</p>
		</fieldset>`}));
		body.append(e_({outer: `<section class="cs-simulacrum__preview" aria-label="Simulacrum preview">
			<h4>${escape(companion.name)}</h4>
			<p>Construct &middot; ${escape(spellSource)} Simulacrum &middot; <strong>${companion.hp.max} HP</strong></p>
			<p>The copy starts in your normal, unbuffed form without equipment or item bonuses. Its own spell slots and limited-use pools start full, even if you have already spent yours.</p>
			<p>The build is frozen at creation. Its HP, spells, resources and concentration are independent of yours, and it acts on your turn.</p>
			${existing.length ? `<p class="cs-simulacrum__warning" role="note">Completing this cast destroys ${existing.length === 1 ? "your existing Simulacrum" : `your ${existing.length} existing Simulacrums`}. Cancelling does not replace anything.</p>` : ""}
			${companion.hp.max === 0 ? `<p class="cs-simulacrum__warning" role="note">Half your normal maximum is 0 HP. The duplicate will melt immediately.</p>` : ""}
		</section>`}));
		const statblock = e_({tag: "section", clazz: "cs-simulacrum__statblock"});
		try {
			statblock.innerHTML = this._getStatblockHtml(companion);
		} catch (error) {
			doClose();
			this._notifyError(error.message);
			return null;
		}
		body.append(statblock);
		const status = e_({tag: "p", clazz: "cs-simulacrum__status", attrs: {role: "status"}});
		const footer = e_({tag: "div", clazz: "cs-simulacrum__footer"});
		const cancel = e_({tag: "button", type: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		const confirm = e_({tag: "button", type: "button", clazz: "ve-btn ve-btn-primary cs-simulacrum__create", txt: existing.length ? "Continue and replace existing copy" : "Continue casting"});
		cancel.addEventListener("click", () => doClose());
		confirm.addEventListener("click", () => {
			if (!this._isOwnerCurrent(ownerPage, context) || JSON.stringify(context.data) !== fingerprint) {
				status.textContent = "The original character changed while this preview was open. Cancel and cast again to prepare an up-to-date copy.";
				confirm.disabled = true;
				return;
			}
			finish({companionData: companion, context, replacedActorIds: existing.map(it => it.actorSnapshot.actorId)});
			doClose();
		});
		footer.append(cancel, confirm);
		body.append(status, footer);
		eleModalInner.append(body);
		CharacterSheetModal.focusFirst(eleModalInner, {preferSelector: ".cs-simulacrum__create"});
		return outcome;
	}

	static _captureRepairFields (state, companionId) {
		return {
			companion: MiscUtil.copyFast(state.getCompanion(companionId)),
			currency: MiscUtil.copyFast(state.getCurrency()),
		};
	}

	static _restoreRepairFields (context, before, after, receipt) {
		const {data, state} = context;
		const index = data.companions.findIndex(it => it.id === before.companion.id);
		if (index < 0) throw new Error("The repaired companion was removed before the repair could be rolled back.");
		const current = data.companions[index];
		if (JSON.stringify(current) === JSON.stringify(after.companion)) {
			data.companions[index] = before.companion;
		} else if (current.actorSnapshot?.lifecycle === "active") {
			if (state._data !== data) throw new Error("The repaired companion changed after its owner was switched. Its newer state was not overwritten.");
			const hydrated = state.hydrateCompanionActor(current.id);
			if (!hydrated.ok) throw new Error(hydrated.message);
			hydrated.actor.setHp(Math.max(0, hydrated.actor.getHp().current - receipt.actualHp));
			const result = state.commitCompanionActor(current.id, hydrated);
			if (!result.ok) throw new Error(result.message);
		}
		if (JSON.stringify(data.currency) === JSON.stringify(after.currency)) data.currency = before.currency;
		else data.currency.gp = (data.currency.gp || 0) + receipt.costGp;
	}

	static async pRepair ({ownerPage, companionId}) {
		const context = this._captureOwner(ownerPage);
		const companion = context.state.getCompanion(companionId);
		if (!this.isSimulacrum(companion)) return false;
		const validation = context.state.constructor.validateCompanionActorSnapshot(companion.actorSnapshot);
		if (!validation.ok) {
			this._notifyError(validation.message);
			return false;
		}
		if (companion.actorSnapshot.lifecycle !== "active") {
			this._notifyError("This Simulacrum has melted or been destroyed and cannot be repaired. Cast Simulacrum again to create a new copy.");
			return false;
		}
		if (companion.actorSnapshot.spell.source === "XPHB") {
			await ownerPage._rest._showLongRestDialog({focusSimulacrum: companionId});
			return false;
		}
		const missing = companion.hp.max - companion.hp.current;
		if (missing <= 0) {
			JqueryUtil.doToast({type: "info", content: "This Simulacrum is already at full HP."});
			return false;
		}
		let resolve;
		let settled = false;
		const outcome = new Promise(fn => { resolve = fn; });
		const finish = value => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		let busy = false;
		let closed = false;
		const {eleModalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: `Repair ${companion.customName || companion.name}`,
			isMinHeight0: true,
			cbClose: () => {
				closed = true;
				if (!busy) finish(false);
			},
		});
		const body = e_({tag: "form", clazz: "cs-simulacrum cs-simulacrum--repair"});
		body.append(e_({tag: "p", txt: "Repair restores HP in an alchemical laboratory. The sheet deducts 100 gp per HP actually restored as payment for repair components."}));
		const amount = e_({tag: "input", type: "number", attrs: {min: 1, max: missing, step: 1}, value: missing, clazz: "ve-form-control cs-simulacrum__repair-amount"});
		const amountLabel = e_({tag: "label", clazz: "cs-simulacrum__field", txt: "Hit points to restore"});
		amountLabel.append(amount);
		const laboratory = e_({tag: "input", type: "checkbox", clazz: "cs-simulacrum__laboratory"});
		const laboratoryLabel = e_({tag: "label", clazz: "cs-simulacrum__confirmation"});
		laboratoryLabel.append(laboratory, e_({tag: "span", txt: "The Simulacrum is in an alchemical laboratory."}));
		const status = e_({tag: "p", clazz: "cs-simulacrum__status", attrs: {role: "status"}});
		const footer = e_({tag: "div", clazz: "cs-simulacrum__footer"});
		const cancel = e_({tag: "button", type: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel"});
		const confirm = e_({tag: "button", type: "submit", clazz: "ve-btn ve-btn-primary cs-simulacrum__repair-confirm", txt: "Pay and repair"});
		const getOptions = () => ({amount: Number(amount.value), laboratoryConfirmed: laboratory.checked});
		const update = () => {
			const quote = context.state.getSimulacrumRepairQuote(companionId, getOptions());
			status.textContent = quote.ok ? `Restore ${quote.actualHp} HP for ${quote.costGp.toLocaleString()} gp.` : quote.message;
			confirm.disabled = busy || !quote.ok;
		};
		amount.addEventListener("input", update);
		laboratory.addEventListener("change", update);
		cancel.addEventListener("click", () => { if (!busy) doClose(); });
		body.addEventListener("submit", async event => {
			event.preventDefault();
			if (busy) return;
			if (!this._isOwnerCurrent(ownerPage, context)) {
				status.textContent = "The selected character changed. Close this dialog and try again.";
				confirm.disabled = true;
				return;
			}
			const before = this._captureRepairFields(context.state, companionId);
			const receipt = context.state.repairSimulacrum(companionId, getOptions());
			if (!receipt.ok) {
				status.textContent = receipt.message;
				return;
			}
			const after = this._captureRepairFields(context.state, companionId);
			busy = true;
			confirm.disabled = true;
			cancel.disabled = true;
			amount.disabled = true;
			laboratory.disabled = true;
			try {
				await this._pSave(ownerPage, context);
				if (this._isOwnerCurrent(ownerPage, context)) this._refreshOwner(ownerPage);
				finish(true);
				doClose();
			} catch (error) {
				try {
					this._restoreRepairFields(context, before, after, receipt);
				} catch (rollbackError) {
					status.textContent = `${error.message} Repair rollback could not finish: ${rollbackError.message} Export a backup before leaving this character.`;
					this._notifyError(status.textContent);
					return;
				}
				let rollbackSaved = false;
				if (this._isOwnerCurrent(ownerPage, context)) {
					try {
						await this._pSave(ownerPage, context);
						rollbackSaved = true;
					} catch (rollbackError) {
						this._notifyError(`Repair was undone, but the undo could not be saved: ${rollbackError.message} Save this character before reloading.`);
					}
					this._refreshOwner(ownerPage);
				}
				status.textContent = `${error.message} No HP or currency changes were kept.${rollbackSaved ? "" : " Save the character before reloading."}`;
				this._notifyError(status.textContent);
			} finally {
				busy = false;
				cancel.disabled = false;
				amount.disabled = false;
				laboratory.disabled = false;
				confirm.disabled = !context.state.getSimulacrumRepairQuote(companionId, getOptions()).ok;
				if (closed) finish(false);
			}
		});
		footer.append(cancel, confirm);
		body.append(amountLabel, laboratoryLabel, status, footer);
		eleModalInner.append(body);
		update();
		CharacterSheetModal.focusFirst(eleModalInner, {preferSelector: ".cs-simulacrum__repair-amount"});
		return outcome;
	}

	static _getSlotOptions (actor, spell) {
		const options = [];
		for (let level = spell.level; level <= 9; ++level) {
			const max = actor.getSpellSlotsMax(level);
			if (max > 0) options.push({level, isPact: false, current: actor.getSpellSlotsCurrent(level), max});
		}
		const pact = actor.getPactSlots();
		if (pact.max > 0 && pact.level >= spell.level) options.push({...pact, isPact: true});
		return options;
	}

	static _getRuntime (ownerPage, companionId) {
		const hydration = ownerPage.getState().hydrateCompanionActor(companionId);
		if (!hydration.ok) throw new Error(hydration.message);
		const Runtime = globalThis.CharacterSheetCompanionActor;
		if (!Runtime) throw new Error("The companion casting module is unavailable. Reload the page before trying again.");
		return new Runtime({ownerPage, companionId, ...hydration});
	}

	static async _pEnsureRuntime () {
		if (!globalThis.CharacterSheetCompanionActor) await import("./charactersheet-companion-actor.js");
	}

	static async pDamage ({ownerPage, companionId}) {
		const context = this._captureOwner(ownerPage);
		const amount = await InputUiUtil.pGetUserNumber({title: "Damage Simulacrum", min: 1, int: true});
		if (amount == null) return;
		await this._pEnsureRuntime();
		if (!this._isOwnerCurrent(ownerPage, context)) throw new Error("The selected character changed. Apply damage to the current companion instead.");
		const runtime = this._getRuntime(ownerPage, companionId);
		try {
			const result = await runtime.takeDamage(amount);
			if (result?.ok === false) throw new Error(result.message);
			this._refreshOwner(ownerPage);
			return result;
		} finally {
			runtime.dispose();
		}
	}

	static async _pDismiss ({ownerPage, companionId}) {
		const context = this._captureOwner(ownerPage);
		const companion = context.state.getCompanion(companionId);
		const confirmed = await InputUiUtil.pGetUserBoolean({
			title: "Dismiss Simulacrum?",
			htmlDescription: `Destroy and remove <strong>${escape(companion.customName || companion.name)}</strong>? This ends its actor-owned effects and cannot be undone.`,
			textYes: "Dismiss",
			textNo: "Cancel",
		});
		if (!confirmed) return;
		if (!this._isOwnerCurrent(ownerPage, context)) throw new Error("The selected character changed. No companion was dismissed.");
		if (companion.actorSnapshot.lifecycle === "active"
			&& context.state.constructor.validateCompanionActorSnapshot(companion.actorSnapshot).ok) {
			await this._pEnsureRuntime();
			if (!this._isOwnerCurrent(ownerPage, context)) throw new Error("The selected character changed. No companion was dismissed.");
			const runtime = this._getRuntime(ownerPage, companionId);
			try {
				const result = await runtime.run(actor => actor.setHp(0));
				if (result?.ok === false) throw new Error(result.message);
			} finally {
				runtime.dispose();
			}
		}
		if (!this._isOwnerCurrent(ownerPage, context)) throw new Error("The selected character changed before the destroyed companion could be dismissed.");
		const terminal = MiscUtil.copyFast(context.state.getCompanion(companionId));
		const index = context.data.companions.findIndex(it => it.id === companionId);
		context.state.removeCompanion(companionId);
		try {
			await this._pSave(ownerPage, context);
		} catch (error) {
			if (!context.data.companions.some(it => it.id === companionId)) context.data.companions.splice(index, 0, terminal);
			if (this._isOwnerCurrent(ownerPage, context)) {
				try {
					await this._pSave(ownerPage, context);
				} catch (rollbackError) {
					this._notifyError(`The destroyed companion record was restored, but could not be saved: ${rollbackError.message}`);
				}
				this._refreshOwner(ownerPage);
			}
			throw error;
		}
		this._refreshOwner(ownerPage);
	}

	static renderCard ({ownerPage, companion, parent, mode = "sheet"}) {
		const validation = ownerPage.getState().constructor.validateCompanionActorSnapshot(companion.actorSnapshot);
		const active = validation.ok && companion.actorSnapshot.lifecycle === "active";
		const card = e_({
			tag: "article",
			clazz: `charsheet__companion-card cs-simulacrum__card${mode === "play" ? " pm-card pm-companion" : ""}`,
			attrs: {"data-companion-id": companion.id, "data-companion-kind": "simulacrum"},
		});
		const conditionText = (Array.isArray(companion.conditions) ? companion.conditions : []).map(it => typeof it === "string" ? it : it?.name).filter(Boolean).join(", ");
		card.append(e_({outer: `<header>
			<h4>${escape(companion.customName || companion.name)}</h4>
			<p>${escape(companion.actorSnapshot.spell?.source || "Unknown edition")} &middot; Construct &middot; ${active ? "Acts on your turn" : `<strong>${validation.ok ? "Destroyed / melted" : "Unavailable"}</strong>`}</p>
		</header>
		<p><output aria-label="Simulacrum current HP">${escape(companion.hp?.current ?? "?")}</output> / ${escape(companion.hp?.max ?? "?")} HP${companion.hp?.temp ? ` &middot; ${escape(companion.hp.temp)} temporary HP` : ""} &middot; AC ${escape(companion.ac)}</p>
		${conditionText ? `<p>${escape(conditionText)}</p>` : ""}
		<p class="cs-simulacrum__hint">${escape(!validation.ok ? validation.message : active ? "Its spellcasting, conditions and resources are independent. HP restoration requires paid repairs." : "This copy cannot act or be repaired. Its record remains available until dismissed.")}</p>`}));
		const toolbar = e_({tag: "div", clazz: "cs-simulacrum__toolbar"});
		const addButton = (text, action, {disabled = false, className = ""} = {}) => {
			const button = e_({tag: "button", type: "button", clazz: `ve-btn ve-btn-default ${className}`, txt: text});
			button.disabled = disabled;
			button.addEventListener("click", async () => {
				if (button.disabled) return;
				button.disabled = true;
				try {
					await action();
				} catch (error) {
					this._notifyError(error.message);
				} finally {
					button.disabled = disabled;
				}
			});
			toolbar.append(button);
		};
		addButton(active ? "Manage / cast" : "View statblock", () => this.pShow({ownerPage, companionId: companion.id}), {className: "btn-companion-view"});
		addButton("Repair", () => this.pRepair({ownerPage, companionId: companion.id}), {disabled: !active, className: "btn-companion-heal"});
		addButton("Damage", () => this.pDamage({ownerPage, companionId: companion.id}), {disabled: !active, className: "btn-companion-damage"});
		addButton("Dismiss", () => this._pDismiss({ownerPage, companionId: companion.id}), {className: "btn-companion-dismiss"});
		card.append(toolbar);
		parent.append(card);
		return card;
	}

	static async pShow ({ownerPage, companionId}) {
		const context = this._captureOwner(ownerPage);
		const companion = context.state.getCompanion(companionId);
		if (companion?.actorSnapshot?.lifecycle === "active"
			&& context.state.constructor.validateCompanionActorSnapshot(companion.actorSnapshot).ok) {
			await this._pEnsureRuntime();
		}
		let runtime = null;
		let closed = false;
		let busy = false;
		const {eleModalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "Simulacrum",
			isMinHeight0: true,
			isWidth100: true,
			cbClose: () => {
				closed = true;
				runtime?.dispose();
			},
		});
		const body = e_({tag: "div", clazz: "cs-simulacrum cs-simulacrum--manager"});
		const status = e_({tag: "p", clazz: "cs-simulacrum__status", attrs: {role: "status"}});
		const content = e_({tag: "div", clazz: "cs-simulacrum__content"});
		body.append(status, content);
		eleModalInner.append(body);
		const operate = async operation => {
			if (busy || closed) return;
			if (!this._isOwnerCurrent(ownerPage, context)) {
				status.textContent = "The selected character changed. Close this panel and open the current character's companion.";
				return;
			}
			busy = true;
			content.querySelectorAll("button, select").forEach(element => { element.disabled = true; });
			try {
				const result = await operation();
				if (result?.ok === false) throw new Error(result.message || "The action could not be completed.");
				if (!closed && this._isOwnerCurrent(ownerPage, context)) {
					this._refreshOwner(ownerPage);
					render();
				}
			} catch (error) {
				status.textContent = error.message;
				this._notifyError(error.message);
			} finally {
				busy = false;
				if (!closed) render({preserveStatus: true});
			}
		};
		const button = (parent, label, action, {disabled = false, reason = ""} = {}) => {
			const element = e_({tag: "button", type: "button", clazz: "ve-btn ve-btn-default", txt: label});
			element.disabled = disabled;
			if (reason) element.title = reason;
			element.addEventListener("click", () => void operate(action));
			parent.append(element);
			return element;
		};
		const section = (title, parent = content) => {
			const element = e_({tag: "section", clazz: "cs-simulacrum__section"});
			element.append(e_({tag: "h4", txt: title}));
			parent.append(element);
			return element;
		};
		const render = ({preserveStatus = false} = {}) => {
			if (closed) return;
			content.innerHTML = "";
			if (!preserveStatus) status.textContent = "";
			if (!this._isOwnerCurrent(ownerPage, context)) {
				status.textContent = "The selected character changed. Close this panel and reopen it for the current character.";
				return;
			}
			const companion = context.state.getCompanion(companionId);
			if (!this.isSimulacrum(companion)) {
				status.textContent = "This companion was removed. Close this panel.";
				return;
			}
			const snapshot = companion.actorSnapshot;
			const validation = context.state.constructor.validateCompanionActorSnapshot(snapshot);
			if (!validation.ok) {
				status.textContent = validation.message;
				return;
			}
			const terminal = snapshot.lifecycle !== "active";
			content.append(e_({outer: `<header class="cs-simulacrum__summary">
				<h3>${escape(companion.customName || companion.name)}</h3>
				<p>Construct &middot; ${escape(snapshot.spell.source)} &middot; ${terminal ? "Destroyed / melted" : "Acts on your turn"}</p>
				<p><strong>${escape(companion.hp.current)} / ${escape(companion.hp.max)} HP</strong>${companion.hp.temp ? ` &middot; ${escape(companion.hp.temp)} temporary HP` : ""} &middot; AC ${escape(companion.ac)}</p>
			</header>`}));
			content.append(e_({
				tag: "p",
				clazz: "cs-simulacrum__hint",
				txt: terminal
					? "This duplicate has melted or been destroyed. It cannot act, recover, or be repaired. Dismiss its record or cast Simulacrum again."
					: snapshot.policy.recovery === "no-slot-recovery"
						? "PHB: expended spell slots, including Pact slots, cannot be recovered. HP can only be restored by paid repairs in a laboratory."
						: "XPHB: this duplicate cannot take Short or Long Rests or cast Simulacrum. Repair it within 5 feet during your Long Rest.",
			}));
			if (!terminal) {
				runtime ||= this._getRuntime(ownerPage, companionId);
				const actor = runtime.getState();
				const toolbar = e_({tag: "div", clazz: "cs-simulacrum__toolbar"});
				button(toolbar, "Damage", async () => {
					const amount = await InputUiUtil.pGetUserNumber({title: "Damage Simulacrum", min: 1, int: true});
					if (amount != null) return runtime.takeDamage(amount);
				});
				button(toolbar, "Repair", async () => {
					if (snapshot.spell.source === "XPHB") doClose();
					const repaired = await this.pRepair({ownerPage, companionId});
					if (repaired) {
						runtime.dispose();
						runtime = this._getRuntime(ownerPage, companionId);
					}
				});
				button(toolbar, "Start next turn", () => runtime.run(state => state.resetTurnEconomy()));
				content.append(toolbar);
				const concentration = actor.getConcentration();
				if (concentration) {
					const concentrationRow = section("Concentration");
					concentrationRow.append(e_({tag: "p", txt: concentration.spellName || concentration.name || "Active concentration"}));
					button(concentrationRow, "End concentration", () => runtime.run(state => state.breakConcentration()));
				}
				const conditions = section("Conditions");
				const currentConditions = actor.getConditionNames();
				conditions.append(e_({tag: "p", txt: currentConditions.length ? currentConditions.join(", ") : "No conditions"}));
				button(conditions, "Add condition", async () => {
					const choices = ownerPage.getConditionsList().filter(condition => !actor.hasConditionExact(condition.name, condition.source));
					const condition = await InputUiUtil.pGetUserEnum({title: "Add condition to Simulacrum", values: choices, fnDisplay: choice => `${choice.name} (${choice.source})`, isResolveItem: true});
					if (condition) return runtime.run(state => state.addCondition(condition));
				});
				for (const condition of actor.getConditions()) {
					button(conditions, `Remove ${condition.name}`, () => runtime.run(state => state.removeCondition(condition.name, condition.source)));
				}
				const slots = section("Spell slots");
				const slotText = [];
				for (let level = 1; level <= 9; ++level) {
					const max = actor.getSpellSlotsMax(level);
					if (max) slotText.push(`Level ${level}: ${actor.getSpellSlotsCurrent(level)}/${max}`);
				}
				const pact = actor.getPactSlots();
				if (pact.max) slotText.push(`Pact (level ${pact.level}): ${pact.current}/${pact.max}`);
				slots.append(e_({tag: "p", clazz: "cs-simulacrum__slots", txt: slotText.join(" · ") || "No spell slots"}));
				if (actor.hasFontOfMagic()) {
					const font = section("Font of Magic");
					const points = actor.getSorceryPoints();
					font.append(e_({tag: "p", txt: `Sorcery Points: ${points.current}/${points.max}`}));
					const slotToPoints = e_({tag: "select", clazz: "ve-form-control", attrs: {"aria-label": "Spell slot to convert into Sorcery Points"}});
					for (let level = 1; level <= 9; ++level) {
						if (actor.getSpellSlotsCurrent(level) > 0) slotToPoints.append(e_({tag: "option", value: level, txt: `Level ${level} slot → ${actor.getSlotToSpReturn(level)} Sorcery Points`}));
					}
					font.append(slotToPoints);
					button(font, "Convert slot to points", () => runtime.run(state => {
						const usesBonusAction = !state.getClasses().some(cls => cls.name?.toLowerCase() === "sorcerer" && cls.source === "XPHB");
						if (usesBonusAction && !state.isBonusActionAvailable()) throw new Error("The duplicate's Bonus Action has already been used this turn.");
						if (!state.convertSlotToSorceryPoints(Number(slotToPoints.value))) throw new Error("No eligible slot is available for this conversion.");
						if (usesBonusAction) state.spendBonusAction();
						return {ok: true};
					}), {disabled: !slotToPoints.children.length});
					const pointsToSlot = e_({tag: "select", clazz: "ve-form-control", attrs: {"aria-label": "Spell slot to create with Sorcery Points"}});
					for (let level = 1; level <= actor.getMaxConvertibleSlotLevel(); ++level) {
						pointsToSlot.append(e_({tag: "option", value: level, txt: `Level ${level} slot (${actor.getSpToSlotCost(level)} Sorcery Points)`}));
					}
					font.append(pointsToSlot);
					button(font, "Create slot with points", () => runtime.run(state => {
						if (!state.isBonusActionAvailable()) throw new Error("The duplicate's Bonus Action has already been used this turn.");
						if (!state.convertSorceryPointsToSlot(Number(pointsToSlot.value))) throw new Error("The duplicate cannot create that slot with its available Sorcery Points.");
						state.spendBonusAction();
						return {ok: true};
					}), {
						disabled: snapshot.policy.recovery === "no-slot-recovery",
						reason: snapshot.policy.recovery === "no-slot-recovery" ? "PHB Simulacrums cannot regain or create spent spell slots." : "",
					});
				}
				const targets = e_({tag: "select", clazz: "ve-form-control cs-simulacrum__target"});
				targets.append(e_({tag: "option", value: "", txt: "Simulacrum (self)"}));
				targets.append(e_({tag: "option", value: snapshot.creatorActorId, txt: `${context.state.getName()} (original)`}));
				for (const other of context.state.getCompanions().filter(it => it.id !== companionId && it.actorSnapshot?.lifecycle === "active")) {
					targets.append(e_({tag: "option", value: other.actorSnapshot.actorId, txt: other.customName || other.name}));
				}
				const targetLabel = e_({tag: "label", clazz: "cs-simulacrum__field", txt: "Apply supported ally effects to"});
				targetLabel.append(targets);
				content.append(targetLabel, e_({tag: "p", clazz: "cs-simulacrum__hint", txt: "Self-only spells always affect this duplicate. Other targets use the sheet's supported effects; any manual resolution is shown in the cast result."}));
				const spellSection = section("Spells");
				const spells = [...new Map([...actor.getCantrips(), ...actor.getSpells()].map(spell => [spell.id, spell])).values()]
					.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
				if (!spells.length) spellSection.append(e_({tag: "p", txt: "No learned spells."}));
				for (const spell of spells) {
					const row = e_({tag: "div", clazz: "cs-simulacrum__spell", attrs: {"data-spell-id": spell.id}});
					row.append(e_({outer: `<div class="cs-simulacrum__spell-name"><strong>${escape(spell.name)}</strong><span>${spell.level === 0 ? "Cantrip" : `Level ${spell.level}`} &middot; ${escape(spell.source)}</span></div>`}));
					const slot = spell.level > 0 ? e_({tag: "select", clazz: "ve-form-control cs-simulacrum__slot", attrs: {"aria-label": `Slot for ${spell.name}`}}) : null;
					if (slot) {
						slot.append(e_({tag: "option", value: "", txt: "Automatic slot / feature"}));
						for (const option of this._getSlotOptions(actor, spell)) {
							slot.append(e_({
								tag: "option",
								value: `${option.isPact ? "pact" : "slot"}:${option.level}`,
								txt: `${option.isPact ? "Pact" : "Level"} ${option.level} (${option.current}/${option.max})`,
								attrs: {disabled: option.current <= 0},
							}));
						}
						row.append(slot);
					}
					const cast = withMetamagic => {
						const [kind, level] = slot?.value?.split(":") || [];
						return runtime.castSpell(spell.id, {
							withMetamagic,
							targetActorId: targets.value || undefined,
							decision: {castAsRitual: false, ...(level ? {slotLevel: Number(level), isPact: kind === "pact"} : {autoSlot: true})},
						});
					};
					const isPrepared = spell.level === 0 || spell.prepared || spell.alwaysPrepared;
					button(row, isPrepared ? "Cast" : "Not prepared", () => cast(false), {disabled: !isPrepared, reason: !isPrepared ? "The frozen copy did not have this spell prepared." : ""});
					if (actor.getSorceryPoints?.()?.max > 0) button(row, "Cast with Metamagic", () => cast(true), {disabled: !isPrepared});
					if (actor.canCastAsRitual?.(spell)) button(row, "Cast as ritual", () => runtime.castRitual(spell.id, {targetActorId: targets.value || undefined}));
					spellSection.append(row);
				}
				const innate = actor.getInnateSpells();
				if (innate.length) {
					const innateSection = section("Innate and feature spells");
					for (const spell of innate) {
						const row = e_({tag: "div", clazz: "cs-simulacrum__spell"});
						row.append(e_({tag: "span", txt: `${spell.name} (${spell.source}) · ${spell.uses ? `${spell.uses.current}/${spell.uses.max}` : "At will"}`}));
						button(row, "Cast", () => runtime.castInnateSpell(spell.id, {targetActorId: targets.value || undefined}), {disabled: !!spell.uses && spell.uses.current <= 0});
						innateSection.append(row);
					}
				}
				const resources = actor.getResources();
				if (resources.length) {
					const resourceSection = section("Feature resources");
					for (const resource of resources) {
						const row = e_({tag: "div", clazz: "cs-simulacrum__resource"});
						row.append(e_({tag: "span", txt: `${resource.name}: ${resource.current}/${resource.max}`}));
						button(row, "Spend use", () => runtime.run(state => state.setResourceCurrent(resource.id, resource.current - 1)), {disabled: resource.current <= 0});
						const isRestOnly = snapshot.policy.recovery === "no-rests" && /short|long|rest/i.test(String(resource.recharge || resource.resetOn || ""));
						button(row, "Restore use", () => runtime.run(state => state.setResourceCurrent(resource.id, resource.current + 1)), {
							disabled: resource.current >= resource.max || isRestOnly,
							reason: isRestOnly ? "This duplicate cannot regain rest-recharged uses by taking a rest." : "Only restore a use when a rule allows it.",
						});
						resourceSection.append(row);
					}
					resourceSection.append(e_({tag: "p", clazz: "cs-simulacrum__hint", txt: "Use these trackers only when a feature's rules allow spending or recovery. Casting spends its own applicable costs automatically."}));
				}
			}
			const statblock = section("Full statblock");
			statblock.insertAdjacentHTML("beforeend", this._getStatblockHtml(companion));
			if (busy) content.querySelectorAll("button, select").forEach(element => { element.disabled = true; });
		};
		try {
			render();
		} catch (error) {
			status.textContent = error.message;
			this._notifyError(error.message);
		}
	}
}

globalThis.CharacterSheetSimulacrum = CharacterSheetSimulacrum;
export {CharacterSheetSimulacrum};
