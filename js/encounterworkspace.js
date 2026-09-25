import {EncounterWorkspaceState, EncounterWorkspaceStore, getEncounterEffectiveMonster} from "./encounterworkspace/encounterworkspace-state.js";
import {EncounterWorkspaceQuickActionsAdapter} from "./encounterworkspace/encounterworkspace-quick-actions.js";
import {BestiaryQuickActionsUi} from "./bestiary/bestiary-quick-actions-ui.js";
import {BestiaryQuickActionsOperations} from "./bestiary/bestiary-quick-actions-engine.js";
import {BestiaryQuickActionsStructuredEditor} from "./bestiary/bestiary-quick-actions-structured.js";
import {
	ENCOUNTER_ROLL_TYPES,
	getEncounterInstanceLabels,
	getEncounterRollFromPackedDice,
	pRollEncounterInstance,
	pRollEncounterSelection,
} from "./encounterworkspace/encounterworkspace-roll.js";
import {getNpcTrackerFallbackReferenceData, getNpcTrackerSkillDescriptors, pGetNpcTrackerReferenceData} from "./dmscreen/npctracker/dmscreen-npctracker-data.js";
import {getNpcTrackerConditionColor, getNpcTrackerConditionHoverMeta, getNpcTrackerConditionPickerModel} from "./dmscreen/npctracker/dmscreen-npctracker-condition.js";
import {getNpcTrackerSignedNumber} from "./dmscreen/npctracker/dmscreen-npctracker-roll.js";
import {getNpcTrackerHpInputValue, getNpcTrackerHpOperation} from "./dmscreen/npctracker/dmscreen-npctracker-hp.js";
import {InitiativeTrackerRowUtil} from "./dmscreen/panels/initiativetracker/dmscreen-initiativetracker-consts.js";
import {
	ENCOUNTER_ROLL_PRESETS,
	getEncounterModifierForPreset,
	getEncounterPresetCitation,
} from "./encounterworkspace/encounterworkspace-effects.js";
import {EncounterWorkspaceHandoffStore, getEncounterHandoffSnapshot} from "./encounterworkspace/encounterworkspace-handoff.js";

export class EncounterWorkspacePage {
	constructor ({store = new EncounterWorkspaceStore(), handoffStore = new EncounterWorkspaceHandoffStore(), pGetReferenceData = pGetNpcTrackerReferenceData} = {}) {
		this._store = store;
		this._handoffStore = handoffStore;
		this._pendingHandoff = null;
		this._handoffReadError = false;
		this._corruptHandoffToken = null;
		this._handoffRefreshIx = 0;
		this._pGetReferenceData = pGetReferenceData;
		this._state = EncounterWorkspaceState.getEmpty();
		this._hasUnreadableSave = false;
		this._isBusy = true;
		this._isCatalogReady = false;
		this._tiles = new Map();
		this._checks = new Map();
		this._conditionContainers = new Map();
		this._effectContainers = new Map();
		this._vitalContainers = new Map();
		this._rosterMeta = new Map();
		this._hpUndo = [];
		this._referenceData = getNpcTrackerFallbackReferenceData();

		this._eleMain = document.getElementById("encounter-workspace");
		this._eleStatus = document.getElementById("ew-status");
		this._eleName = document.getElementById("ew-name");
		this._eleSummary = document.getElementById("ew-summary");
		this._eleNotices = document.getElementById("ew-notices");
		this._eleRoster = document.getElementById("ew-roster");
		this._eleStatblocks = document.getElementById("ew-statblocks");
		this._eleWorkspace = document.getElementById("ew-workspace");
		this._eleResults = document.getElementById("ew-results");
		this._eleRollSummary = document.getElementById("ew-roll-summary");
		this._eleResultTable = document.getElementById("ew-result-table");
		this._eleRollHint = document.getElementById("ew-roll-hint");
		this._btnChoose = document.getElementById("ew-choose");
		this._btnSelectAll = document.getElementById("ew-all");
		this._btnSelectNone = document.getElementById("ew-none");
		this._selRollType = document.getElementById("ew-roll-type");
		this._selRollKey = document.getElementById("ew-roll-key");
		this._selRollMode = document.getElementById("ew-roll-mode");
		this._btnRoll = document.getElementById("ew-roll");
		this._selCondition = document.getElementById("ew-condition");
		this._btnConditionAdd = document.getElementById("ew-condition-add");
		this._btnConditionRemove = document.getElementById("ew-condition-remove");
		this._eleEffectSummary = document.getElementById("ew-effects-summary");
		this._selNoteKind = document.getElementById("ew-note-kind");
		this._inpNoteName = document.getElementById("ew-note-name");
		this._inpNoteDescription = document.getElementById("ew-note-description");
		this._btnNoteAdd = document.getElementById("ew-note-add");
		this._selNoteRemove = document.getElementById("ew-note-remove");
		this._btnNoteRemove = document.getElementById("ew-note-remove-selected");
		this._selPreset = document.getElementById("ew-preset");
		this._inpPresetSearch = document.getElementById("ew-preset-search");
		this._elePresetDetail = document.getElementById("ew-preset-detail");
		this._btnPresetAdd = document.getElementById("ew-preset-add");
		this._inpModName = document.getElementById("ew-mod-name");
		this._checkModCheck = document.getElementById("ew-mod-check");
		this._checkModSkill = document.getElementById("ew-mod-skill");
		this._checkModSave = document.getElementById("ew-mod-save");
		this._checkModInitiative = document.getElementById("ew-mod-initiative");
		this._checkModAttack = document.getElementById("ew-mod-attack");
		this._selModMode = document.getElementById("ew-mod-mode");
		this._inpModBonus = document.getElementById("ew-mod-bonus");
		this._btnModAdd = document.getElementById("ew-mod-add");
		this._selModRemove = document.getElementById("ew-mod-remove");
		this._btnModRemove = document.getElementById("ew-mod-remove-selected");
		this._inpHpExpression = document.getElementById("ew-hp-expression");
		this._checkHpHalf = document.getElementById("ew-hp-half");
		this._btnHpApply = document.getElementById("ew-hp-apply");
		this._btnHpUndo = document.getElementById("ew-hp-undo");
		this._selInitMode = document.getElementById("ew-init-mode");
		this._btnInitRoll = document.getElementById("ew-init-roll");
		this._btnTurnStart = document.getElementById("ew-turn-start");
		this._btnTurnNext = document.getElementById("ew-turn-next");
		this._btnTurnReset = document.getElementById("ew-turn-reset");
		this._selBulkType = document.getElementById("ew-bulk-type");
		this._selBulkChoice = document.getElementById("ew-bulk-choice");
		this._inpBulkName = document.getElementById("ew-bulk-name");
		this._inpBulkDescription = document.getElementById("ew-bulk-description");
		this._inpBulkCost = document.getElementById("ew-bulk-cost");
		this._btnBulkPreview = document.getElementById("ew-bulk-preview");
		this._btnHandoffQueue = document.getElementById("ew-handoff-queue");
		this._btnHandoffClear = document.getElementById("ew-handoff-clear");
		this._eleHandoffPending = document.getElementById("ew-handoff-pending");
		this._eleHandoffStatus = document.getElementById("ew-handoff-status");
		this._eleRoundStatus = document.getElementById("ew-round-status");
		this._eleTurnOrder = document.getElementById("ew-turn-order");
		this._eleInitUnrolled = document.getElementById("ew-init-unrolled");
	}

	async pInit () {
		this._btnChoose.addEventListener("click", () => this._pChoose());
		this._btnSelectAll.addEventListener("click", () => this._pSetTargets(this._state.instances.map(it => it.id)));
		this._btnSelectNone.addEventListener("click", () => this._pSetTargets([]));
		this._selRollType.addEventListener("change", () => this._renderRollKeys());
		this._selRollKey.addEventListener("change", () => this._clearRollResults());
		this._selRollMode.addEventListener("change", () => this._clearRollResults());
		this._btnRoll.addEventListener("click", () => this._pRollSelected());
		this._selCondition.addEventListener("change", () => this._updateControls());
		this._btnConditionAdd.addEventListener("click", () => this._pUpdateConditions(true));
		this._btnConditionRemove.addEventListener("click", () => this._pUpdateConditions(false));
		this._btnNoteAdd.addEventListener("click", () => this._pUpdateAreaNote({isAdd: true}));
		this._btnNoteRemove.addEventListener("click", () => this._pUpdateAreaNote({isAdd: false}));
		this._selNoteRemove.addEventListener("change", () => this._updateControls());
		this._selPreset.addEventListener("change", () => this._renderPresetDetail());
		this._inpPresetSearch.addEventListener("input", () => this._renderPresetSearch());
		this._eleStatblocks.addEventListener("click", event => this._onStatblockDiceClick(event), true);
		this._btnPresetAdd.addEventListener("click", () => this._pUpdateModifier({isAdd: true, isPreset: true}));
		this._btnModAdd.addEventListener("click", () => this._pUpdateModifier({isAdd: true, isPreset: false}));
		this._btnModRemove.addEventListener("click", () => this._pUpdateModifier({isAdd: false}));
		this._selModRemove.addEventListener("change", () => this._updateControls());
		this._btnHpApply.addEventListener("click", () => this._pApplyHp());
		this._btnHpUndo.addEventListener("click", () => this._pUndoHp());
		this._btnInitRoll.addEventListener("click", () => this._pRollInitiative());
		this._btnTurnStart.addEventListener("click", () => this._pUpdateTurn("start"));
		this._btnTurnNext.addEventListener("click", () => this._pUpdateTurn("next"));
		this._btnTurnReset.addEventListener("click", () => this._pUpdateTurn("reset"));
		this._selBulkType.addEventListener("change", () => this._pRenderBulkChoices());
		this._btnBulkPreview.addEventListener("click", () => this._pPreviewBulkStatblock());
		this._btnHandoffQueue.addEventListener("click", () => this._pQueueHandoff());
		this._btnHandoffClear.addEventListener("click", () => this._pClearHandoff());
		window.addEventListener("focus", () => this._pRefreshHandoff());

		let catalogError = null;
		try {
			await Promise.all([PrereleaseUtil.pInit(), BrewUtil2.pInit()]);
			await ExcludeUtil.pInitialise();
			this._isCatalogReady = true;
		} catch (e) {
			catalogError = e;
		}

		let referenceError = null;
		if (this._isCatalogReady) {
			try {
				this._referenceData = await this._pGetReferenceData();
			} catch (e) {
				referenceError = e;
			}
		}

		try {
			this._state = await this._store.pLoad();
			this._render();
			this._setStatus(this._state.sourceList ? "Working encounter restored from this browser." : "Choose a saved Bestiary pinned list to begin.");
		} catch (e) {
			this._hasUnreadableSave = true;
			this._render();
			this._setError(`Could not open the working encounter: ${this._getErrorMessage(e)}. Your saved data has not been changed. Choose a saved list to replace it.`);
		} finally {
			this._setBusy(false);
		}
		if (catalogError) this._setError(`Bestiary sources could not be initialized: ${this._getErrorMessage(catalogError)}. ${this._hasUnreadableSave ? "The saved encounter also could not be opened." : "The saved encounter is still available."} Importing another list is disabled until the page can load those sources.`);
		else if (referenceError) this._setError(`Condition and skill reference data could not be loaded: ${this._getErrorMessage(referenceError)}. Standard conditions and skills remain available. You can still choose a saved Bestiary list.${this._hasUnreadableSave ? " The saved encounter also could not be opened; choose a saved list to replace it." : ""}`);
		await this._pRefreshHandoff();
	}

	_getErrorMessage (error) { return String(error?.message || error).replace(/[.!?]+$/, ""); }

	_setBusy (isBusy) {
		this._isBusy = isBusy;
		this._eleMain.setAttribute("aria-busy", String(isBusy));
		this._btnChoose.disabled = isBusy || !this._isCatalogReady;
		this._btnSelectAll.disabled = isBusy || !this._state.instances.length;
		this._btnSelectNone.disabled = isBusy || !this._state.instances.length;
		this._checks.forEach(check => check.disabled = isBusy);
		this._conditionContainers.forEach(container => container.querySelectorAll("button").forEach(button => button.disabled = isBusy));
		this._effectContainers.forEach(container => container.querySelectorAll("button").forEach(button => button.disabled = isBusy));
		this._vitalContainers.forEach(container => container.querySelectorAll("input").forEach(input => input.disabled = isBusy));
		this._updateControls();
	}

	_updateControls () {
		const count = this._state.selectedIds.length;
		const hasTargets = !!count;
		this._eleRollHint.textContent = `${count} ${count === 1 ? "monster" : "monsters"} will roll. Results also appear in the dice roller.`;
		this._selRollType.disabled = this._selRollKey.disabled = this._selRollMode.disabled = this._isBusy || !this._state.instances.length;
		this._btnRoll.disabled = this._isBusy || !hasTargets;
		this._selCondition.disabled = this._isBusy || !hasTargets || !this._selCondition.options.length;
		const condition = this._selCondition.value;
		this._btnConditionAdd.disabled = this._isBusy || !hasTargets || !this._referenceData.conditions.some(it => it.name === condition);
		this._btnConditionRemove.disabled = this._isBusy || !hasTargets || !this._state.instances.some(it =>
			this._state.selectedIds.includes(it.id) && it.conditions.includes(condition));
		[
			this._selNoteKind, this._inpNoteName, this._inpNoteDescription,
			this._selPreset, this._inpPresetSearch, this._inpModName, this._checkModCheck, this._checkModSkill,
			this._checkModSave, this._checkModInitiative, this._checkModAttack,
			this._selModMode, this._inpModBonus,
		].forEach(field => field.disabled = this._isBusy || !hasTargets);
		this._btnNoteAdd.disabled = this._btnModAdd.disabled = this._isBusy || !hasTargets;
		this._btnPresetAdd.disabled = this._isBusy || !hasTargets || !this._selPreset.value;
		this._selNoteRemove.disabled = this._isBusy || !hasTargets || this._selNoteRemove.options.length <= 1;
		this._btnNoteRemove.disabled = this._selNoteRemove.disabled || !this._selNoteRemove.value;
		this._selModRemove.disabled = this._isBusy || !hasTargets || this._selModRemove.options.length <= 1;
		this._btnModRemove.disabled = this._selModRemove.disabled || !this._selModRemove.value;
		this._inpHpExpression.disabled = this._checkHpHalf.disabled = this._isBusy || !hasTargets;
		this._btnHpApply.disabled = this._isBusy || !hasTargets;
		this._btnHpUndo.disabled = this._isBusy || !this._hpUndo.length;
		this._selInitMode.disabled = this._isBusy || !hasTargets;
		this._btnInitRoll.disabled = this._isBusy || !hasTargets;
		const isStarted = !!this._state.turn?.round;
		const hasInitiative = this._state.instances.some(it => it.initiative != null);
		this._btnTurnStart.disabled = this._isBusy || isStarted || !hasInitiative;
		this._btnTurnNext.disabled = this._isBusy || !isStarted;
		this._btnTurnReset.disabled = this._isBusy || !isStarted;
		this._btnHandoffQueue.disabled = this._isBusy || this._handoffReadError || !hasTargets || !this._state.sourceList;
		this._btnHandoffClear.disabled = this._isBusy || !(this._pendingHandoff || this._corruptHandoffToken);
		this._btnHandoffClear.textContent = this._corruptHandoffToken ? "Clear damaged queue" : "Clear queued snapshot";
		this._selBulkType.disabled = this._isBusy || !hasTargets;
		this._selBulkChoice.disabled = this._isBusy || !hasTargets;
		[this._inpBulkName, this._inpBulkDescription, this._inpBulkCost].forEach(input => input.disabled = this._isBusy || !hasTargets);
		this._btnBulkPreview.disabled = this._isBusy || !hasTargets;
		this._tiles.forEach(tile => {
			const button = tile.querySelector(".ew__statblock-edit");
			if (button) button.disabled = this._isBusy;
		});
	}

	_setHandoffStatus (text, {isError = false} = {}) {
		this._eleHandoffStatus.textContent = text;
		this._eleHandoffStatus.setAttribute("role", isError ? "alert" : "status");
		this._eleHandoffStatus.classList[isError ? "add" : "remove"]("ew__handoff-status--error");
	}

	async _pRefreshHandoff () {
		const ix = ++this._handoffRefreshIx;
		try {
			const pending = await this._handoffStore.pRead();
			if (ix !== this._handoffRefreshIx) return;
			if (this._handoffReadError) this._setHandoffStatus("");
			this._handoffReadError = false;
			this._corruptHandoffToken = null;
			this._pendingHandoff = pending;
			this._eleHandoffPending.textContent = pending
				? `Queued: ${pending.source.name} · ${pending.entries.length} ${pending.entries.length === 1 ? "monster" : "monsters"} · ${new Date(pending.createdAt).toLocaleString()}. Awaiting confirmation in DM Screen.`
				: "Nothing queued. A snapshot stays here until you import or clear it.";
			this._updateControls();
		} catch (e) {
			if (ix !== this._handoffRefreshIx) return;
			this._handoffReadError = true;
			this._pendingHandoff = null;
			try {
				this._corruptHandoffToken = await this._handoffStore.pGetCorruptRecoveryToken();
			} catch (recoveryError) {
				this._corruptHandoffToken = null;
				this._setHandoffStatus(`Cannot inspect damaged queue: ${this._getErrorMessage(recoveryError)}`, {isError: true});
			}
			this._eleHandoffPending.textContent = "The queued snapshot could not be read. It has not been discarded.";
			if (this._corruptHandoffToken) this._setHandoffStatus(`Cannot read queued snapshot: ${this._getErrorMessage(e)}. You may explicitly clear the damaged queue.`, {isError: true});
			this._updateControls();
		}
	}

	async _pQueueHandoff () {
		if (this._isBusy) return;
		this._setBusy(true);
		try {
			const snapshot = getEncounterHandoffSnapshot({state: this._state});
			const result = await this._handoffStore.pQueue({
				snapshot,
				pConfirmReplace: () => InputUiUtil.pGetUserBoolean({
					title: "Replace Queued Encounter",
					htmlDescription: "Another encounter is still waiting in this browser. Replace it? The previous queue will no longer be available in DM Screen; neither working encounter changes.",
					textYes: "Replace Queue",
					textNo: "Keep Queue",
				}),
			});
			if (!result.ok) this._setHandoffStatus("Kept the existing queued encounter; nothing was replaced.");
			else this._setHandoffStatus(`Queued ${snapshot.entries.length} monsters. Open DM Screen and confirm Import on the intended Initiative Tracker panel.`);
		} catch (e) {
			this._setHandoffStatus(`Could not queue monsters: ${this._getErrorMessage(e)}`, {isError: true});
		} finally {
			this._setBusy(false);
			await this._pRefreshHandoff();
		}
	}

	async _pClearHandoff () {
		if (this._isBusy) return;
		this._setBusy(true);
		try {
			const isCorrupt = !!this._corruptHandoffToken;
			const pending = isCorrupt ? null : await this._handoffStore.pRead();
			if (!isCorrupt && (!pending || pending.id !== this._pendingHandoff?.id)) throw new Error("The queued encounter changed. Refresh before clearing.");
			if (!await InputUiUtil.pGetUserBoolean({
				title: isCorrupt ? "Clear Damaged Queue" : "Clear Queued Encounter",
				htmlDescription: isCorrupt
					? "The pending snapshot is unreadable. Discard it so you can queue a new one? Working encounters and tracker rows are unchanged."
					: "Discard the pending DM Screen import? This does not change either working encounter or an already-imported tracker.",
				textYes: "Clear Queue",
				textNo: "Keep Queue",
			})) return this._setHandoffStatus("Queued encounter kept.");
			if (isCorrupt) await this._handoffStore.pClearCorrupt({expectedToken: this._corruptHandoffToken});
			else await this._handoffStore.pClear({expectedId: pending.id});
			this._setHandoffStatus("Queued encounter cleared. The working encounter is unchanged.");
		} catch (e) {
			this._setHandoffStatus(`Could not clear queued encounter: ${this._getErrorMessage(e)}`, {isError: true});
		} finally {
			this._setBusy(false);
			await this._pRefreshHandoff();
		}
	}

	_setStatus (text) {
		this._eleStatus.classList.remove("ew__status--error");
		this._eleStatus.setAttribute("role", "status");
		this._eleStatus.textContent = text;
	}

	_setError (text) {
		this._eleStatus.classList.add("ew__status--error");
		this._eleStatus.setAttribute("role", "alert");
		this._eleStatus.textContent = text;
	}

	async _pChoose () {
		if (this._isBusy) return;
		this._setBusy(true);
		this._setStatus("Opening saved Bestiary lists...");
		try {
			const manager = new SaveManager({isReadOnlyUi: true, isStorageReadOnly: true, page: UrlUtil.PG_BESTIARY});
			await manager.pMutStateFromStorage();
			if (!await manager.pHasSaves()) {
				this._setStatus("No saved Bestiary lists found. Save a pinned list in Bestiary first.");
				return;
			}
			const exportedSublist = await manager.pDoLoad({isIncludeManagerClientState: true});
			if (!exportedSublist) {
				this._setStatus("No list chosen; the working encounter is unchanged.");
				return;
			}

			if (this._hasUnreadableSave && !await this._pConfirmReplace()) {
				this._setStatus("The unreadable encounter was not replaced.");
				return;
			}

			if (!this._state.sourceList) this._setStatus("Loading monsters into a separate working copy...");
			const next = await this._store.pReplace({
				currentState: this._state,
				exportedSublist,
				pConfirm: async () => {
					this._setStatus("Confirm whether to replace the working encounter.");
					const isConfirmed = await this._pConfirmReplace();
					if (isConfirmed) this._setStatus("Loading monsters into a separate working copy...");
					return isConfirmed;
				},
			});
			if (next === this._state) {
				this._setStatus("The working encounter was not replaced.");
				return;
			}
			this._state = next;
			this._hpUndo = [];
			this._hasUnreadableSave = false;
			this._render();
			const loaded = next.instances.length
				? `Loaded ${next.instances.length} independent ${next.instances.length === 1 ? "monster" : "monsters"}`
				: "Loaded an empty working encounter";
			this._setStatus(`${loaded} from "${next.sourceList.name}".${next.omissions.length ? ` ${next.omissions.length} ${next.omissions.length === 1 ? "entry was" : "entries were"} omitted; see details below.` : ""}`);
		} catch (e) {
			this._setError(`The saved list could not be loaded: ${this._getErrorMessage(e)}. The working encounter is unchanged.`);
		} finally {
			this._setBusy(false);
		}
	}

	_pConfirmReplace () {
		return InputUiUtil.pGetUserBoolean({
			title: "Replace Working Encounter",
			htmlDescription: "Replace the current working encounter with a new copy of this saved Bestiary list? Its roster, targets, statblock edits, conditions, notes, roll effects, HP, initiative, and turns will be lost. The saved Bestiary list will not change.",
			textYes: "Replace Encounter",
			textNo: "Keep Current",
		});
	}

	async _pSetTargets (ids) {
		if (this._isBusy) return;
		const focused = document.activeElement;
		this._setBusy(true);
		try {
			const next = EncounterWorkspaceState.validate({...this._state, selectedIds: ids});
			this._state = await this._store.pSave(next);
			this._updateTargets();
			this._clearRollResults();
			this._setStatus(`${this._state.selectedIds.length} of ${this._state.instances.length} monsters selected as targets.`);
		} catch (e) {
			this._updateTargets();
			this._setError(`Target selection was not saved: ${this._getErrorMessage(e)}. Try again.`);
		} finally {
			this._setBusy(false);
			if (focused !== document.body && focused?.isConnected && !focused.disabled) focused.focus({preventScroll: true});
		}
	}

	async _pUpdateConditions (isAdd) {
		if (this._isBusy) return;
		const focused = document.activeElement;
		const condition = this._selCondition.value;
		if (isAdd && !this._referenceData.conditions.some(it => it.name === condition)) {
			this._setError("Choose an available condition to apply.");
			return;
		}
		this._setBusy(true);
		try {
			const next = EncounterWorkspaceState.withConditions(this._state, {condition, isAdd});
			this._state = await this._store.pSave(next);
			this._renderConditions();
			this._renderConditionPicker();
			this._clearRollResults();
			this._setStatus(`${isAdd ? "Applied" : "Removed"} ${condition} ${isAdd ? "to" : "from"} ${this._state.selectedIds.length} selected ${this._state.selectedIds.length === 1 ? "monster" : "monsters"}.`);
		} catch (e) {
			this._setError(`Conditions were not saved: ${this._getErrorMessage(e)}. The working encounter is unchanged.`);
		} finally {
			this._setBusy(false);
			if (focused !== document.body && focused?.isConnected && !focused.disabled) focused.focus({preventScroll: true});
		}
	}

	async _pUpdateAreaNote ({isAdd, id = null, noteId = null}) {
		if (this._isBusy) return;
		const focused = document.activeElement;
		const targetIds = id ? [id] : this._state.selectedIds;
		const removedId = noteId || this._selNoteRemove.value;
		this._setBusy(true);
		try {
			const note = isAdd
				? {
					id: `note:${CryptUtil.uid()}`,
					kind: this._selNoteKind.value,
					name: this._inpNoteName.value.trim(),
					description: this._inpNoteDescription.value.trim(),
				}
				: null;
			const name = note?.name || this._getEffectName(removedId, "areaNotes") || "area note";
			const {state, changedIds} = EncounterWorkspaceState.withAreaNote(this._state, {
				note, noteId: removedId, isAdd, targetIds,
			});
			if (changedIds.length) {
				this._state = await this._store.pSave(state);
				this._renderEffects();
				if (isAdd) {
					this._inpNoteName.value = "";
					this._inpNoteDescription.value = "";
				}
			}
			this._setStatus(changedIds.length
				? `${isAdd ? "Added" : "Removed"} "${name}" ${isAdd ? "to" : "from"} ${changedIds.length} ${changedIds.length === 1 ? "monster" : "monsters"}.`
				: "No selected monster had that area note to remove.");
		} catch (e) {
			this._setError(`Area notes were not saved: ${this._getErrorMessage(e)}. The working encounter is unchanged.`);
		} finally {
			this._setBusy(false);
			this._focusAfterEffectUpdate(focused, id, this._selNoteRemove);
		}
	}

	async _pUpdateModifier ({isAdd, isPreset = false, id = null, modifierId = null}) {
		if (this._isBusy) return;
		const focused = document.activeElement;
		const targetIds = id ? [id] : this._state.selectedIds;
		const removedId = modifierId || this._selModRemove.value;
		this._setBusy(true);
		try {
			const enteredBonus = this._inpModBonus.value.trim();
			const modifier = !isAdd ? null : isPreset
				? getEncounterModifierForPreset(this._selPreset.value)
				: {
					id: `modifier:${CryptUtil.uid()}`,
					name: this._inpModName.value.trim(),
					scopes: [
						...(this._checkModCheck.checked ? ["check"] : []),
						...(this._checkModSkill.checked ? ["skill"] : []),
						...(this._checkModSave.checked ? ["save"] : []),
						...(this._checkModInitiative.checked ? ["initiative"] : []),
						...(this._checkModAttack.checked ? ["attack"] : []),
					],
					mode: this._selModMode.value,
					bonus: /^[+-]?\d+$/.test(enteredBonus) ? Number(enteredBonus) : NaN,
				};
			const name = modifier?.name || this._getEffectName(removedId, "modifiers") || "roll effect";
			const {state, changedIds, skippedIds} = EncounterWorkspaceState.withModifier(this._state, {
				modifier, modifierId: removedId, isAdd, targetIds,
			});
			if (changedIds.length) {
				this._state = await this._store.pSave(state);
				this._renderEffects();
				this._clearRollResults();
				if (isAdd && !isPreset) this._inpModName.value = "";
			}
			const outcome = changedIds.length
				? `${isAdd ? "Applied" : "Removed"} "${name}" ${isAdd ? "to" : "from"} ${changedIds.length} ${changedIds.length === 1 ? "monster" : "monsters"}.`
				: `No selected monster ${isAdd ? "gained" : "had"} "${name}".`;
			const skipped = skippedIds.length
				? ` Skipped ${skippedIds.length} selected non-undead: ${this._getTargetNames(skippedIds)}.`
				: "";
			this._setStatus(`${outcome}${skipped}`);
		} catch (e) {
			this._setError(`Roll effects were not saved: ${this._getErrorMessage(e)}. The working encounter is unchanged.`);
		} finally {
			this._setBusy(false);
			this._focusAfterEffectUpdate(focused, id, this._selModRemove);
		}
	}

	_getEffectName (effectId, property) {
		return this._state.instances.flatMap(instance => instance[property])
			.find(effect => effect.id === effectId)?.name;
	}

	_getTargetNames (ids) {
		const labels = getEncounterInstanceLabels(this._state.instances);
		const first = ids.slice(0, 8).map(id => labels.get(id)).join(", ");
		return ids.length > 8 ? `${first}, and ${ids.length - 8} more` : first;
	}

	_focusAfterEffectUpdate (focused, id, fallback) {
		if (focused !== document.body && focused?.isConnected && !focused.disabled) {
			focused.focus({preventScroll: true});
			return;
		}
		const title = id ? this._tiles.get(id)?.querySelector(".ew__statblock-title") : null;
		if (title) {
			title.tabIndex = -1;
			title.focus({preventScroll: true});
		} else if (!fallback.disabled) fallback.focus({preventScroll: true});
		else this._eleEffectSummary.focus({preventScroll: true});
	}

	async _pRollSelected () {
		if (this._isBusy) return;
		if (!this._state.selectedIds.length) {
			this._setError("Select at least one monster before rolling.");
			return;
		}
		this._setBusy(true);
		this._clearRollResults();
		this._eleResults.hidden = false;
		this._eleRollSummary.textContent = `Rolling for ${this._state.selectedIds.length} selected monsters...`;
		try {
			const {results, failures} = await pRollEncounterSelection({
				state: this._state,
				rollType: this._selRollType.value,
				key: this._selRollKey.value,
				rollMode: this._selRollMode.value,
				skills: this._getSkills(),
			});
			this._renderRollResults({results, failures});
			const outcome = `${results.length} completed, ${failures.length} failed.`;
			if (failures.length) this._setError(`${outcome} See the results for each monster; cancelled or invalid rolls are not counted.`);
			else this._setStatus(`${outcome} Each genuine roll is also in the dice roller.`);
		} catch (e) {
			this._eleRollSummary.textContent = "No rolls completed.";
			this._setError(`Could not roll for the selected monsters: ${this._getErrorMessage(e)}`);
		} finally {
			this._setBusy(false);
		}
	}

	_getSkills () {
		return getNpcTrackerSkillDescriptors({
			skillCatalog: this._referenceData.skills,
			monsters: this._state.instances.map(getEncounterEffectiveMonster),
		});
	}

	async _pCommitStatblockEdit ({state, changedIds, resetHpIds}) {
		this._setBusy(true);
		let isSaved = false;
		try {
			this._state = await this._store.pSave(state);
			isSaved = true;
			if (resetHpIds.length) this._hpUndo = this._hpUndo.filter(snapshots => !snapshots.some(it => resetHpIds.includes(it.id)));
			this._render();
			this._clearRollResults();
			const names = this._getTargetNames(changedIds);
			this._setStatus(`Saved statblock edits for ${names}.${resetHpIds.length
				? ` Reset current and maximum HP for ${this._getTargetNames(resetHpIds)} to the new average (or Unset); temporary HP was preserved.`
				: " Tracked HP was unchanged."}`);
		} catch (e) {
			this._setError(isSaved
				? `Statblock edits were saved, but the page could not refresh: ${this._getErrorMessage(e)}. Reload this page to see the changes.`
				: `Statblock edits were not saved: ${this._getErrorMessage(e)}. The working encounter is unchanged.`);
			throw e;
		} finally {
			this._setBusy(false);
		}
	}

	async _pOpenStatblockEditor (id) {
		if (this._isBusy) return;
		const instance = this._state.instances.find(it => it.id === id);
		if (!instance) return this._setError("This encounter monster no longer exists.");
		const adapter = new EncounterWorkspaceQuickActionsAdapter({
			id,
			getState: () => this._state,
			pCommit: result => this._pCommitStatblockEdit(result),
		});
		try {
			await BestiaryQuickActionsUi.pOpen({monster: instance.monster, registry: adapter});
		} catch (e) {
			this._setError(`Could not open statblock editor: ${this._getErrorMessage(e)}`);
		}
	}

	async _pRenderBulkChoices () {
		const type = this._selBulkType.value;
		const isLegendary = type === "legendary";
		const hasChoices = type === "lair" || type === "area";
		const previousChoice = this._bulkChoiceType === type ? this._selBulkChoice.value : "";
		this._bulkChoiceType = type;
		const request = this._bulkChoiceRequest = (this._bulkChoiceRequest || 0) + 1;
		for (const id of ["name", "description", "cost"]) {
			document.getElementById(`ew-bulk-${id}`).hidden = !isLegendary;
			document.getElementById(`ew-bulk-${id}-label`).hidden = !isLegendary;
		}
		this._selBulkChoice.hidden = document.getElementById("ew-bulk-choice-label").hidden = !hasChoices;
		this._selBulkChoice.replaceChildren();
		if (!hasChoices) return;
		this._selBulkChoice.add(new Option("Loading available rules...", ""));
		try {
			const entries = type === "area"
				? await BestiaryQuickActionsUi._pLoadAreaTraits()
				: await BestiaryQuickActionsUi._pLoadLegendaryGroups();
			if (request !== this._bulkChoiceRequest) return;
			this._selBulkChoice.replaceChildren();
			this._selBulkChoice.add(new Option(entries.length ? "Choose a loaded rule..." : "No matching rules loaded", ""));
			entries.forEach((entry, ix) => this._selBulkChoice.add(new Option(
				type === "area" ? `${entry._areaName}: ${entry.name} (${entry.source})` : `${entry.name} (${entry.source})`,
				String(ix),
			)));
			if ([...this._selBulkChoice.options].some(it => it.value === previousChoice)) this._selBulkChoice.value = previousChoice;
		} catch (e) {
			if (request !== this._bulkChoiceRequest) return;
			this._selBulkChoice.replaceChildren(new Option("Could not load rules; change type to retry", ""));
			this._setError(`Bulk statblock rules could not be loaded: ${this._getErrorMessage(e)}`);
		}
	}

	async _pPreviewBulkStatblock () {
		if (this._isBusy) return;
		this._setBusy(true);
		try {
			const type = this._selBulkType.value;
			let operation;
			if (type === "minion") operation = BestiaryQuickActionsOperations.minion();
			else if (type === "legendary") {
				const name = this._inpBulkName.value.trim();
				const description = this._inpBulkDescription.value.trim();
				const cost = Number(this._inpBulkCost.value);
				if (!name || !description || !Number.isSafeInteger(cost) || cost < 1 || cost > 9) {
					throw new Error("Enter a legendary action name, action text, and a cost from 1 to 9.");
				}
				operation = BestiaryQuickActionsOperations.addEntry({
					section: "legendary",
					entry: {name: BestiaryQuickActionsStructuredEditor.getLegendaryActionName({name, cost}), entries: [description]},
				});
			} else if (type === "area" || type === "lair") {
				if (!/^\d+$/.test(this._selBulkChoice.value)) throw new Error("Choose a loaded rule before previewing.");
				const entries = type === "area"
					? await BestiaryQuickActionsUi._pLoadAreaTraits()
					: await BestiaryQuickActionsUi._pLoadLegendaryGroups();
				const entry = entries[Number(this._selBulkChoice.value)];
				if (!entry) throw new Error("That rule is no longer available. Choose a loaded rule again.");
				if (type === "lair") operation = BestiaryQuickActionsOperations.setLegendaryGroup(entry);
				else {
					const choices = await BestiaryQuickActionsUi._pGetAreaTraitChoices({traits: [entry]});
					if (choices == null) return this._setStatus("Bulk area trait cancelled; no statblocks changed.");
					operation = BestiaryQuickActionsUi.getAreaTraitOperation({
						trait: entry,
						choices: choices.get(`${entry.name}|${entry.source}`.toLowerCase()) || {},
					});
				}
			} else throw new Error("Choose a supported bulk statblock edit.");
			operation.id = CryptUtil.uid();
			const preview = EncounterWorkspaceState.previewBulkStatblockOperation(this._state, {operation});
			const labels = getEncounterInstanceLabels(this._state.instances);
			const skips = preview.skipped.map(({id, reason}) => `${labels.get(id)}: ${reason}`);
			const reset = preview.resetHpIds.map(id => labels.get(id));
			const description = [
				`<p><b>${preview.changedIds.length} eligible:</b> ${preview.changedIds.map(id => labels.get(id).qq()).join(", ") || "none"}</p>`,
				skips.length ? `<p><b>${skips.length} skipped:</b> ${skips.map(it => it.qq()).join("; ")}</p>` : "",
				reset.length ? `<p><b>HP reset:</b> ${reset.map(it => it.qq()).join(", ")} will use the edited average (or Unset), retaining temporary HP.</p>` : "",
				"<p>Only eligible monsters will be edited. All edits are saved together or none are saved.</p>",
			].join("");
			if (!preview.changedIds.length) {
				this._setError(`No eligible monsters for this edit. ${skips.join("; ")}`);
				return;
			}
			if (!await InputUiUtil.pGetUserBoolean({
				title: "Apply Bulk Statblock Edit",
				htmlDescription: description,
				textYes: `Apply to ${preview.changedIds.length}`,
				textNo: "Cancel",
			})) return this._setStatus("Bulk statblock edit cancelled; no statblocks changed.");
			await this._pCommitStatblockEdit(preview);
			if (skips.length) this._setStatus(`${this._eleStatus.textContent} Skipped ${skips.length}: ${skips.join("; ")}.`);
		} catch (e) {
			this._setError(`Bulk statblock edit was not applied: ${this._getErrorMessage(e)}. The working encounter is unchanged.`);
		} finally {
			this._setBusy(false);
		}
	}

	_renderRollKeys () {
		const previous = this._selRollKey.value;
		this._selRollKey.replaceChildren();
		const isSkill = this._selRollType.value === "skill";
		const entries = isSkill
			? this._getSkills().map(({id, label}) => ({id, label}))
			: Parser.ABIL_ABVS.map(id => ({id, label: Parser.attAbvToFull(id)}));
		entries.forEach(({id, label}) => this._selRollKey.add(new Option(label, id)));
		this._selRollKey.value = entries.some(it => it.id === previous) ? previous : isSkill
			? entries.find(it => it.id === "perception")?.id || entries[0]?.id || ""
			: "dex";
		this._clearRollResults();
	}

	_renderConditionPicker () {
		const previous = this._selCondition.value;
		const saved = new Set(this._state.instances.flatMap(it => it.conditions));
		this._selCondition.replaceChildren();
		this._referenceData.conditions.forEach(it => this._selCondition.add(new Option(it.label, it.name)));
		saved.forEach(name => {
			if (!this._referenceData.conditions.some(it => it.name === name)) {
				this._selCondition.add(new Option(`${name} (saved; source unavailable)`, name));
			}
		});
		if ([...this._selCondition.options].some(it => it.value === previous)) this._selCondition.value = previous;
		this._updateControls();
	}

	_renderPresetDetail () {
		const preset = ENCOUNTER_ROLL_PRESETS.find(it => it.presetId === this._selPreset.value);
		this._elePresetDetail.textContent = preset
			? `${getEncounterPresetCitation(preset)} · ${preset.description}${preset.contextQuestion ? " You will be asked to confirm context at roll time." : ""}`
			: "No matching preset. Search by rule, source, or effect.";
		this._updateControls();
	}

	_renderPresetSearch () {
		const previous = this._selPreset.value;
		const query = this._inpPresetSearch.value.trim().toLowerCase();
		const matches = ENCOUNTER_ROLL_PRESETS.filter(preset =>
			[preset.name, preset.source, preset.page, preset.description, preset.edition].join(" ").toLowerCase().includes(query));
		this._selPreset.replaceChildren();
		matches.forEach(preset => this._selPreset.add(new Option(`${preset.name} — ${getEncounterPresetCitation(preset)}`, preset.presetId)));
		if (matches.some(it => it.presetId === previous)) this._selPreset.value = previous;
		this._renderPresetDetail();
	}

	_onStatblockDiceClick (event) {
		const link = event.target.closest?.("[data-packed-dice]");
		const tile = link?.closest(".ew__statblock");
		if (!tile || !this._eleStatblocks.contains(tile)) return;
		const instance = this._state.instances.find(it => it.id === tile.dataset.instanceId);
		if (!instance) return;
		let entry;
		try {
			entry = JSON.parse(link.dataset.packedDice);
		} catch (e) {
			this._setError(`The statblock dice link cannot be read: ${this._getErrorMessage(e)}`);
			return;
		}
		const roll = getEncounterRollFromPackedDice(entry);
		if (!roll) return;
		if (roll.unsupported) {
			this._setError(roll.unsupported);
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		this._pRollStatblockDice({instance, roll, event});
	}

	async _pRollStatblockDice ({instance, roll, event}) {
		if (this._isBusy) return this._setError("Wait for the current encounter operation before rolling.");
		const name = getEncounterInstanceLabels(this._state.instances).get(instance.id);
		const rollMode = (event.ctrlKey || event.metaKey) ? "disadvantage" : event.shiftKey ? "advantage" : "normal";
		try {
			const result = await pRollEncounterInstance({instance, name, ...roll, rollMode});
			const outcome = `${name}: ${result.label} — ${result.mode === "autoFail" ? "automatic failure" : result.mode === "unavailable" ? "unavailable" : result.total}. ${result.sourcesText || "Normal roll"}.`;
			if (result.mode === "autoFail" || result.mode === "unavailable") this._setError(outcome);
			else this._setStatus(outcome);
		} catch (e) {
			this._setError(`Could not roll ${roll.label} for ${name}: ${this._getErrorMessage(e)}`);
		}
	}

	_renderEffectPickers () {
		const selected = new Set(this._state.selectedIds);
		for (const [property, select] of [
			["areaNotes", this._selNoteRemove],
			["modifiers", this._selModRemove],
		]) {
			const previous = select.value;
			const byId = new Map();
			this._state.instances.forEach(instance => {
				if (!selected.has(instance.id)) return;
				instance[property].forEach(effect => {
					const item = byId.get(effect.id) || {effect, count: 0};
					item.count++;
					byId.set(effect.id, item);
				});
			});
			select.replaceChildren();
			select.add(new Option(property === "areaNotes" ? "Choose an applied note..." : "Choose an applied roll effect...", ""));
			byId.forEach(({effect, count}, id) => {
				const type = property === "areaNotes" ? effect.kind === "lair" ? "Lair note" : "Area trait" : "Roll effect";
				select.add(new Option(`${type}: ${effect.name} (${count} selected)`, id));
			});
			select.value = byId.has(previous) ? previous : "";
		}
		this._updateControls();
	}

	_clearRollResults () {
		this._eleResults.hidden = true;
		this._eleRollSummary.textContent = "";
		this._eleResultTable.replaceChildren();
	}

	_renderRollResults ({results, failures, failureLabel = null}) {
		this._eleResults.hidden = false;
		this._eleRollSummary.textContent = `${results.length} completed · ${failures.length} failed`;
		const table = document.createElement("table");
		table.className = "ew__results-table";
		const header = table.createTHead().insertRow();
		const columns = ["Monster", "Roll", "Die", "Bonus", "Total", "Roll effect / status"];
		columns.forEach(text => {
			const cell = document.createElement("th");
			cell.scope = "col";
			cell.textContent = text;
			header.append(cell);
		});
		const body = table.createTBody();
		const byId = new Map([...results, ...failures].map(it => [it.id, it]));
		this._state.instances.forEach(instance => {
			const entry = byId.get(instance.id);
			if (!entry) return;
			const row = body.insertRow();
			const isFailure = "reason" in entry;
			if (isFailure) row.className = "ew__result--failed";
			const values = isFailure
				? [entry.name, failureLabel || `${this._selRollType.selectedOptions[0].textContent} · ${this._selRollKey.selectedOptions[0].textContent}`, "—", "—", "—", entry.reason]
				: [entry.name, entry.label, entry.die == null ? "—" : entry.die, getNpcTrackerSignedNumber(entry.bonus), entry.total == null ? "—" : entry.total, entry.sourcesText || "Normal"];
			values.forEach((value, index) => {
				const cell = row.insertCell();
				cell.dataset.label = columns[index];
				cell.textContent = value;
			});
		});
		this._eleResultTable.replaceChildren(table);
	}

	async _pSetHp ({id, prop, raw}) {
		if (this._isBusy) return;
		const focused = document.activeElement;
		this._setBusy(true);
		try {
			if (`${raw}`.trim() && Number(raw) < 0) throw new Error("Hit points cannot be negative.");
			const value = getNpcTrackerHpInputValue(raw);
			if (value == null && (prop === "temp" || `${raw}`.trim())) {
				throw new Error("Enter a non-negative number, or leave current/maximum blank when unavailable.");
			}
			const next = EncounterWorkspaceState.withHp(this._state, {id, prop, value});
			this._state = await this._store.pSave(next);
			this._hpUndo = [];
			this._renderVitals([id]);
			this._setStatus(`Updated ${prop} HP for ${getEncounterInstanceLabels(this._state.instances).get(id)}.`);
		} catch (e) {
			this._renderVitals([id]);
			this._setError(`Hit points were not saved: ${this._getErrorMessage(e)}. The working encounter is unchanged.`);
		} finally {
			this._setBusy(false);
			this._restoreVitalFocus(focused, id, prop);
		}
	}

	async _pApplyHp () {
		if (this._isBusy) return;
		const targets = this._state.instances.filter(it => this._state.selectedIds.includes(it.id));
		if (!targets.length) return this._setError("Select at least one monster before applying HP.");
		const isSet = this._inpHpExpression.value.trim().startsWith("=");
		if (!targets.some(it => it.hp.max != null && (isSet || it.hp.current != null))) {
			return this._setError("No selected monsters have usable HP. Set a maximum (and current HP for damage or healing) first.");
		}
		this._setBusy(true);
		try {
			const parsed = getNpcTrackerHpOperation({raw: this._inpHpExpression.value});
			if (!parsed.ok) throw new Error(parsed.message);
			const operation = this._checkHpHalf.checked && parsed.operation.mode === "delta" && parsed.operation.value < 0
				? {...parsed.operation, value: InitiativeTrackerRowUtil.getHalvedDelta(parsed.operation.value)}
				: parsed.operation;
			const {state, changedIds, skippedIds, snapshots} = EncounterWorkspaceState.withHpOperation(this._state, {operation});
			if (changedIds.length) {
				this._state = await this._store.pSave(state);
				this._hpUndo.push(snapshots);
				if (this._hpUndo.length > 5) this._hpUndo.shift();
				this._renderVitals(changedIds);
			}
			this._setStatus(`Updated HP for ${changedIds.length} ${changedIds.length === 1 ? "monster" : "monsters"}.${skippedIds.length ? ` Skipped ${skippedIds.length} with unset HP: ${this._getTargetNames(skippedIds)}.` : ""}`);
		} catch (e) {
			this._setError(`HP was not applied: ${this._getErrorMessage(e)}. The working encounter is unchanged.`);
		} finally {
			this._setBusy(false);
		}
	}

	async _pUndoHp () {
		if (this._isBusy || !this._hpUndo.length) return;
		this._setBusy(true);
		try {
			const snapshots = this._hpUndo.at(-1);
			const next = EncounterWorkspaceState.withHpUndo(this._state, snapshots);
			this._state = await this._store.pSave(next);
			this._hpUndo.pop();
			this._renderVitals(snapshots.map(it => it.id));
			this._setStatus(`Undid the last HP operation for ${snapshots.length} ${snapshots.length === 1 ? "monster" : "monsters"}.`);
		} catch (e) {
			this._setError(`HP undo was not saved: ${this._getErrorMessage(e)}. The working encounter is unchanged.`);
		} finally {
			this._setBusy(false);
		}
	}

	async _pSetInitiative ({id, raw}) {
		if (this._isBusy) return;
		const focused = document.activeElement;
		this._setBusy(true);
		try {
			const trimmed = `${raw}`.trim();
			const total = !trimmed ? null : /^[+-]?\d+$/.test(trimmed) ? Number(trimmed) : NaN;
			const next = EncounterWorkspaceState.withInitiative(this._state, {id, total});
			this._state = await this._store.pSave(next);
			this._renderVitals([id]);
			this._renderTurnOrder();
			this._clearRollResults();
			this._setStatus(`${total == null ? "Cleared" : "Set"} initiative for ${getEncounterInstanceLabels(this._state.instances).get(id)}${total == null ? "." : ` to ${total}.`}`);
		} catch (e) {
			this._renderVitals([id]);
			this._setError(`Initiative was not saved: ${this._getErrorMessage(e)}. The working encounter is unchanged.`);
		} finally {
			this._setBusy(false);
			this._restoreVitalFocus(focused, id, "initiative");
		}
	}

	async _pRollInitiative () {
		if (this._isBusy) return;
		if (!this._state.selectedIds.length) return this._setError("Select at least one monster before rolling initiative.");
		this._setBusy(true);
		this._clearRollResults();
		try {
			const {results, failures} = await pRollEncounterSelection({
				state: this._state,
				rollType: "initiative",
				rollMode: this._selInitMode.value,
			});
			if (results.length) {
				const next = EncounterWorkspaceState.withInitiativeResults(this._state, results.map(({id, total}) => ({id, total})));
				this._state = await this._store.pSave(next);
				this._renderVitals(results.map(it => it.id));
				this._renderTurnOrder();
			}
			this._renderRollResults({results, failures, failureLabel: "Initiative (Dexterity check)"});
			const outcome = `${results.length} initiatives saved, ${failures.length} failed.`;
			if (failures.length) this._setError(`${outcome} See the results; cancelled or invalid rolls have not replaced existing totals.`);
			else this._setStatus(`${outcome} Each genuine roll is in the dice roller.`);
		} catch (e) {
			this._clearRollResults();
			this._setError(`Initiative was not saved: ${this._getErrorMessage(e)}. The working encounter is unchanged.`);
		} finally {
			this._setBusy(false);
		}
	}

	async _pUpdateTurn (action) {
		if (this._isBusy) return;
		this._setBusy(true);
		try {
			const next = EncounterWorkspaceState.withTurn(this._state, action);
			this._state = await this._store.pSave(next);
			this._renderTurnOrder();
			this._setStatus(action === "reset" ? "Turns reset; initiative totals are unchanged." : `Round ${next.turn.round}: ${getEncounterInstanceLabels(next.instances).get(next.turn.activeId)} is active.`);
		} catch (e) {
			this._setError(`Turns were not saved: ${this._getErrorMessage(e)}. The working encounter is unchanged.`);
		} finally {
			this._setBusy(false);
		}
	}

	_restoreVitalFocus (focused, id, prop) {
		if (focused?.dataset?.field !== prop || focused?.dataset?.instanceId !== id) return;
		const next = [...(this._vitalContainers.get(id)?.querySelectorAll("input") || [])]
			.find(input => input.dataset.field === prop);
		if (next && !next.disabled) next.focus({preventScroll: true});
	}

	_render () {
		const previousRollType = this._selRollType.value;
		const previousRollKey = this._selRollKey.value;
		this._tiles.clear();
		this._checks.clear();
		this._conditionContainers.clear();
		this._effectContainers.clear();
		this._vitalContainers.clear();
		this._rosterMeta.clear();
		this._eleRoster.replaceChildren();
		this._eleStatblocks.replaceChildren();
		this._eleNotices.replaceChildren();

		const {sourceList, instances, omissions} = this._state;
		this._eleWorkspace.hidden = !sourceList;
		if (!sourceList) return;
		this._selRollType.replaceChildren();
		ENCOUNTER_ROLL_TYPES.filter(it => it.id !== "initiative").forEach(({id, name}) => this._selRollType.add(new Option(name, id)));
		this._selRollType.value = ENCOUNTER_ROLL_TYPES.some(it => it.id === previousRollType && it.id !== "initiative") ? previousRollType : "ability";
		this._renderRollKeys();
		if ([...this._selRollKey.options].some(it => it.value === previousRollKey)) this._selRollKey.value = previousRollKey;
		this._renderConditionPicker();
		this._renderPresetSearch();

		this._eleName.textContent = sourceList.name;
		if (!instances.length) {
			const empty = document.createElement("p");
			empty.className = "ew__empty";
			empty.textContent = "This saved list has no available monsters. Choose another saved list to populate the encounter.";
			this._eleStatblocks.append(empty);
		}

		if (omissions.length) {
			const heading = document.createElement("h3");
			heading.textContent = `${omissions.length} list ${omissions.length === 1 ? "entry" : "entries"} not loaded`;
			const list = document.createElement("ul");
			omissions.forEach(({hash, reason}) => {
				const item = document.createElement("li");
				item.textContent = `${hash}: ${reason}`;
				list.append(item);
			});
			this._eleNotices.append(heading, list);
			this._eleNotices.hidden = false;
		} else this._eleNotices.hidden = true;

		const labels = getEncounterInstanceLabels(instances);
		for (const instance of instances) {
			const label = labels.get(instance.id);

			const row = document.createElement("label");
			row.className = "ew__roster-row";
			const check = document.createElement("input");
			check.type = "checkbox";
			check.addEventListener("change", () => this._pSetTargets(
				check.checked
					? [...this._state.selectedIds, instance.id]
					: this._state.selectedIds.filter(id => id !== instance.id),
			));
			const rowText = document.createElement("span");
			rowText.className = "ew__roster-name";
			rowText.textContent = label;
			const rowMeta = document.createElement("span");
			rowMeta.className = "ew__roster-meta";
			const effective = getEncounterEffectiveMonster(instance);
			rowMeta.textContent = `${effective.source} · CR ${effective.cr?.cr || effective.cr || "—"}`;
			row.append(check, rowText, rowMeta);
			this._eleRoster.append(row);
			this._checks.set(instance.id, check);
			this._rosterMeta.set(instance.id, rowMeta);

			const tile = document.createElement("article");
			tile.className = "ew__statblock";
			tile.dataset.instanceId = instance.id;
			const title = document.createElement("h3");
			title.className = "ew__statblock-title";
			title.textContent = label;
			const heading = document.createElement("div");
			heading.className = "ew__statblock-heading";
			const edit = document.createElement("button");
			edit.type = "button";
			edit.className = "ew__statblock-edit ve-btn ve-btn-default ve-btn-xs";
			edit.textContent = `Edit statblock${instance.statblockOperations?.length ? ` (${instance.statblockOperations.length})` : ""}`;
			edit.setAttribute("aria-label", `Edit statblock for ${label}`);
			edit.disabled = this._isBusy;
			edit.addEventListener("click", () => this._pOpenStatblockEditor(instance.id));
			heading.append(title, edit);
			const conditions = document.createElement("div");
			conditions.className = "ew__conditions";
			conditions.setAttribute("aria-label", `Conditions for ${label}`);
			this._conditionContainers.set(instance.id, conditions);
			const effects = document.createElement("div");
			effects.className = "ew__effects";
			effects.setAttribute("aria-label", `Notes and roll effects for ${label}`);
			this._effectContainers.set(instance.id, effects);
			const vitals = document.createElement("div");
			vitals.className = "ew__vitals";
			vitals.setAttribute("aria-label", `HP and initiative for ${label}`);
			this._vitalContainers.set(instance.id, vitals);
			const table = document.createElement("table");
			table.className = "ve-w-100 ve-stats";
			const body = document.createElement("tbody");
			try {
				body.innerHTML = Renderer.monster.getCompactRenderedString(
					MiscUtil.copyFast(effective),
					{isShowScalers: false},
				);
			} catch (e) {
				const failure = document.createElement("p");
				failure.className = "ew__render-error";
				failure.textContent = `Could not render this statblock: ${this._getErrorMessage(e)}`;
				tile.append(heading, vitals, conditions, effects, failure);
				this._tiles.set(instance.id, tile);
				this._eleStatblocks.append(tile);
				continue;
			}
			table.append(body);
			tile.append(heading, vitals, conditions, effects, table);
			this._tiles.set(instance.id, tile);
			this._eleStatblocks.append(tile);
		}
		this._renderVitals();
		this._renderConditions();
		this._renderEffects();
		this._renderTurnOrder();
		this._updateTargets();
		this._pRenderBulkChoices();
	}

	_renderVitals (ids = this._state.instances.map(it => it.id)) {
		const labels = getEncounterInstanceLabels(this._state.instances);
		const selected = new Set(ids);
		this._state.instances.forEach(instance => {
			if (!selected.has(instance.id)) return;
			const container = this._vitalContainers.get(instance.id);
			if (!container) return;
			const fields = [
				{prop: "current", label: "Current HP", value: instance.hp.current},
				{prop: "max", label: "Maximum HP", value: instance.hp.max},
				{prop: "temp", label: "Temp HP", value: instance.hp.temp},
				{prop: "initiative", label: "Initiative", value: instance.initiative},
			];
			const controls = fields.map(({prop, label, value}) => {
				const field = document.createElement("label");
				field.className = "ew__vital-field";
				const caption = document.createElement("span");
				caption.textContent = label;
				const input = document.createElement("input");
				input.className = "ve-form-control";
				input.type = "number";
				input.step = prop === "initiative" ? "1" : "any";
				if (prop !== "initiative") input.min = "0";
				input.value = value == null ? "" : String(value);
				input.placeholder = value == null ? "Unset" : "";
				input.dataset.instanceId = instance.id;
				input.dataset.field = prop;
				input.setAttribute("aria-label", `${labels.get(instance.id)}: ${label}`);
				input.disabled = this._isBusy;
				input.addEventListener("change", () => {
					if (this._isBusy) {
						const persisted = this._state.instances.find(it => it.id === instance.id);
						input.value = (prop === "initiative" ? persisted.initiative : persisted.hp[prop]) ?? "";
						this._setError("Wait for the current encounter save before editing another value.");
						return;
					}
					if (prop === "initiative") this._pSetInitiative({id: instance.id, raw: input.value});
					else this._pSetHp({id: instance.id, prop, raw: input.value});
				});
				field.append(caption, input);
				return field;
			});
			container.replaceChildren(...controls);
			this._renderRosterMeta(instance);
		});
	}

	_renderTurnOrder () {
		const order = EncounterWorkspaceState.getInitiativeOrder(this._state);
		const labels = getEncounterInstanceLabels(this._state.instances);
		const {round, activeId} = this._state.turn;
		this._eleRoundStatus.textContent = round ? `Round ${round} · ${labels.get(activeId)}'s turn` : "Not started";
		const items = order.map((instance, index) => {
			const item = document.createElement("li");
			item.className = "ew__turn";
			if (instance.id === activeId) {
				item.classList.add("ew__turn--active");
				item.setAttribute("aria-current", "step");
			}
			const rank = document.createElement("span");
			rank.className = "ew__turn-rank";
			rank.textContent = `${index + 1}.`;
			const name = document.createElement("span");
			name.className = "ew__turn-name";
			name.textContent = labels.get(instance.id);
			const total = document.createElement("strong");
			total.textContent = String(instance.initiative);
			item.append(rank, name, total);
			return item;
		});
		this._eleTurnOrder.replaceChildren(...items);
		const unrolled = this._state.instances.filter(it => it.initiative == null);
		this._eleInitUnrolled.textContent = unrolled.length
			? `${unrolled.length} unrolled (not in turn order): ${this._getTargetNames(unrolled.map(it => it.id))}.`
			: order.length ? "All monsters have initiative." : "Enter or roll initiative to create a turn order.";
		this._updateControls();
	}

	_renderConditions () {
		const labels = getEncounterInstanceLabels(this._state.instances);
		this._state.instances.forEach(instance => {
			const container = this._conditionContainers.get(instance.id);
			const meta = this._rosterMeta.get(instance.id);
			if (!container || !meta) return;
			container.replaceChildren();
			const picker = getNpcTrackerConditionPickerModel({conditions: instance.conditions, conditionCatalog: this._referenceData.conditions});
			this._renderRosterMeta(instance, picker.active.map(it => it.label));
			if (!picker.active.length) {
				const empty = document.createElement("span");
				empty.className = "ew__condition-empty";
				empty.textContent = "No conditions";
				container.append(empty);
			}
			picker.active.forEach(({name, label}) => {
				const button = document.createElement("button");
				button.type = "button";
				button.className = "ew__condition";
				button.style.setProperty("--ew-condition-color", getNpcTrackerConditionColor(name, {conditionCatalog: this._referenceData.conditions}));
				button.setAttribute("aria-label", `Remove ${label} from ${labels.get(instance.id)}`);
				button.textContent = `${label} ×`;
				button.disabled = this._isBusy;
				const hoverMeta = getNpcTrackerConditionHoverMeta(name, {conditionCatalog: this._referenceData.conditions});
				if (hoverMeta) {
					button.addEventListener("mouseover", event => Renderer.hover.pHandleLinkMouseOver(event, button, {isSpecifiedLinkData: true, ...hoverMeta})
						.catch(e => this._setError(`Could not show ${label}: ${this._getErrorMessage(e)}`)));
					button.addEventListener("mousemove", event => Renderer.hover.handleLinkMouseMove(event, button));
					button.addEventListener("mouseleave", event => Renderer.hover.handleLinkMouseLeave(event, button));
				}
				button.addEventListener("click", event => {
					if (hoverMeta) Renderer.hover.handleLinkMouseLeave(event, button);
					this._pRemoveInstanceCondition(instance.id, name);
				});
				container.append(button);
			});
		});
	}

	_renderRosterMeta (instance, conditionLabels = null) {
		const meta = this._rosterMeta.get(instance.id);
		if (!meta) return;
		const activeConditions = conditionLabels ?? getNpcTrackerConditionPickerModel({
			conditions: instance.conditions,
			conditionCatalog: this._referenceData.conditions,
		}).active.map(it => it.label);
		const effectNames = [
			...instance.areaNotes.map(it => it.name),
			...instance.modifiers.map(it => it.name),
		];
		meta.textContent = [
			`${getEncounterEffectiveMonster(instance).source} · CR ${getEncounterEffectiveMonster(instance).cr?.cr || getEncounterEffectiveMonster(instance).cr || "—"}`,
			`HP ${instance.hp.current == null ? "unset" : instance.hp.current}/${instance.hp.max == null ? "unset" : instance.hp.max}${instance.hp.temp ? ` +${instance.hp.temp} temp` : ""}`,
			`Init ${instance.initiative == null ? "unrolled" : instance.initiative}`,
			...activeConditions,
			...effectNames,
		].join(" · ");
	}

	_renderEffects () {
		const labels = getEncounterInstanceLabels(this._state.instances);
		this._state.instances.forEach(instance => {
			const container = this._effectContainers.get(instance.id);
			if (!container) return;
			container.replaceChildren();
			this._renderRosterMeta(instance);
			const entries = [
				...instance.areaNotes.map(note => ({
					title: `${note.kind === "lair" ? "Lair reminder (text only)" : "Area reminder (text only)"}: ${note.name}`,
					description: note.description,
					onRemove: () => this._pUpdateAreaNote({isAdd: false, id: instance.id, noteId: note.id}),
				})),
				...instance.modifiers.map(modifier => ({
					title: modifier.name,
					description: [
						modifier.scopes.includes("check") ? "Checks (including skills and initiative)" : "",
						modifier.scopes.includes("skill") ? "Skill checks" : "",
						modifier.scopes.includes("save") ? "Saving throws" : "",
						modifier.scopes.includes("initiative") ? "Initiative" : "",
						modifier.scopes.includes("attack") ? "Attack rolls" : "",
						modifier.mode === "normal" ? "" : modifier.mode,
						modifier.bonus ? getNpcTrackerSignedNumber(modifier.bonus) : "",
						modifier.presetId ? getEncounterPresetCitation(ENCOUNTER_ROLL_PRESETS.find(it => it.presetId === modifier.presetId)) : "",
					].filter(Boolean).join(" · "),
					onRemove: () => this._pUpdateModifier({isAdd: false, id: instance.id, modifierId: modifier.id}),
				})),
			];
			if (!entries.length) {
				const empty = document.createElement("span");
				empty.className = "ew__condition-empty";
				empty.textContent = "No notes or roll effects";
				container.append(empty);
			}
			entries.forEach(({title, description, onRemove}) => {
				const item = document.createElement("div");
				item.className = "ew__effect";
				const body = document.createElement("div");
				const heading = document.createElement("strong");
				heading.textContent = title;
				const detail = document.createElement("p");
				detail.textContent = description;
				body.append(heading, detail);
				const remove = document.createElement("button");
				remove.type = "button";
				remove.className = "ve-btn ve-btn-default ve-btn-xs";
				remove.textContent = "Remove";
				remove.setAttribute("aria-label", `Remove ${title} from ${labels.get(instance.id)}`);
				remove.disabled = this._isBusy;
				remove.addEventListener("click", onRemove);
				item.append(body, remove);
				container.append(item);
			});
		});
		this._renderEffectPickers();
	}

	async _pRemoveInstanceCondition (id, condition) {
		if (this._isBusy) return;
		this._setBusy(true);
		try {
			const next = EncounterWorkspaceState.withConditions(this._state, {condition, isAdd: false, targetIds: [id]});
			this._state = await this._store.pSave(next);
			this._renderConditions();
			this._renderConditionPicker();
			this._clearRollResults();
			this._setStatus(`Removed ${condition} from ${getEncounterInstanceLabels(this._state.instances).get(id)}.`);
		} catch (e) {
			this._setError(`Condition was not removed: ${this._getErrorMessage(e)}. The working encounter is unchanged.`);
		} finally {
			this._setBusy(false);
			this._selCondition.focus();
		}
	}

	_updateTargets () {
		const selected = new Set(this._state.selectedIds);
		this._eleSummary.textContent = `${selected.size} of ${this._state.instances.length} selected as targets`;
		this._checks.forEach((check, id) => check.checked = selected.has(id));
		this._tiles.forEach((tile, id) => tile.classList.toggle("ew__statblock--selected", selected.has(id)));
		this._renderEffectPickers();
	}
}

window.addEventListener("load", () => new EncounterWorkspacePage().pInit());
