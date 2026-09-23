import {EncounterWorkspaceState, EncounterWorkspaceStore} from "./encounterworkspace/encounterworkspace-state.js";
import {ENCOUNTER_ROLL_TYPES, getEncounterInstanceLabels, pRollEncounterSelection} from "./encounterworkspace/encounterworkspace-roll.js";
import {getNpcTrackerFallbackReferenceData, getNpcTrackerSkillDescriptors, pGetNpcTrackerReferenceData} from "./dmscreen/npctracker/dmscreen-npctracker-data.js";
import {getNpcTrackerConditionColor, getNpcTrackerConditionHoverMeta, getNpcTrackerConditionPickerModel} from "./dmscreen/npctracker/dmscreen-npctracker-condition.js";
import {getNpcTrackerSignedNumber} from "./dmscreen/npctracker/dmscreen-npctracker-roll.js";

class EncounterWorkspacePage {
	constructor () {
		this._store = new EncounterWorkspaceStore();
		this._state = EncounterWorkspaceState.getEmpty();
		this._hasUnreadableSave = false;
		this._isBusy = true;
		this._isCatalogReady = false;
		this._tiles = new Map();
		this._checks = new Map();
		this._conditionContainers = new Map();
		this._rosterMeta = new Map();
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

		let catalogError = null;
		try {
			await Promise.all([PrereleaseUtil.pInit(), BrewUtil2.pInit()]);
			await ExcludeUtil.pInitialise();
			this._isCatalogReady = true;
			this._referenceData = await pGetNpcTrackerReferenceData();
		} catch (e) {
			catalogError = e;
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
			htmlDescription: "Replace the current working encounter with a new copy of this saved Bestiary list? Its roster, target selection, and conditions will be lost. The saved Bestiary list will not change.",
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
			monsters: this._state.instances.map(it => it.monster),
		});
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

	_clearRollResults () {
		this._eleResults.hidden = true;
		this._eleRollSummary.textContent = "";
		this._eleResultTable.replaceChildren();
	}

	_renderRollResults ({results, failures}) {
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
				? [entry.name, `${this._selRollType.selectedOptions[0].textContent} · ${this._selRollKey.selectedOptions[0].textContent}`, "—", "—", "—", entry.reason]
				: [entry.name, entry.label, entry.die == null ? "—" : entry.die, getNpcTrackerSignedNumber(entry.bonus), entry.total == null ? "—" : entry.total, entry.statusText || "Normal"];
			values.forEach((value, index) => {
				const cell = row.insertCell();
				cell.dataset.label = columns[index];
				cell.textContent = value;
			});
		});
		this._eleResultTable.replaceChildren(table);
	}

	_render () {
		this._tiles.clear();
		this._checks.clear();
		this._conditionContainers.clear();
		this._rosterMeta.clear();
		this._eleRoster.replaceChildren();
		this._eleStatblocks.replaceChildren();
		this._eleNotices.replaceChildren();

		const {sourceList, instances, omissions} = this._state;
		this._eleWorkspace.hidden = !sourceList;
		if (!sourceList) return;
		this._selRollType.replaceChildren();
		ENCOUNTER_ROLL_TYPES.forEach(({id, name}) => this._selRollType.add(new Option(name, id)));
		this._selRollType.value = "ability";
		this._renderRollKeys();
		this._renderConditionPicker();

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
			rowMeta.textContent = `${instance.monster.source} · CR ${instance.monster.cr?.cr || instance.monster.cr || "—"}`;
			row.append(check, rowText, rowMeta);
			this._eleRoster.append(row);
			this._checks.set(instance.id, check);
			this._rosterMeta.set(instance.id, rowMeta);

			const tile = document.createElement("article");
			tile.className = "ew__statblock";
			const title = document.createElement("h3");
			title.className = "ew__statblock-title";
			title.textContent = label;
			const conditions = document.createElement("div");
			conditions.className = "ew__conditions";
			conditions.setAttribute("aria-label", `Conditions for ${label}`);
			this._conditionContainers.set(instance.id, conditions);
			const table = document.createElement("table");
			table.className = "ve-w-100 ve-stats";
			const body = document.createElement("tbody");
			try {
				body.innerHTML = Renderer.monster.getCompactRenderedString(
					MiscUtil.copyFast(instance.monster),
					{isShowScalers: false},
				);
			} catch (e) {
				const failure = document.createElement("p");
				failure.className = "ew__render-error";
				failure.textContent = `Could not render this statblock: ${this._getErrorMessage(e)}`;
				tile.append(title, conditions, failure);
				this._tiles.set(instance.id, tile);
				this._eleStatblocks.append(tile);
				continue;
			}
			table.append(body);
			tile.append(title, conditions, table);
			this._tiles.set(instance.id, tile);
			this._eleStatblocks.append(tile);
		}
		this._renderConditions();
		this._updateTargets();
	}

	_renderConditions () {
		const labels = getEncounterInstanceLabels(this._state.instances);
		this._state.instances.forEach(instance => {
			const container = this._conditionContainers.get(instance.id);
			const meta = this._rosterMeta.get(instance.id);
			if (!container || !meta) return;
			container.replaceChildren();
			const picker = getNpcTrackerConditionPickerModel({conditions: instance.conditions, conditionCatalog: this._referenceData.conditions});
			meta.textContent = `${instance.monster.source} · CR ${instance.monster.cr?.cr || instance.monster.cr || "—"}${picker.active.length ? ` · ${picker.active.map(it => it.label).join(", ")}` : ""}`;
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
		this._updateControls();
	}
}

window.addEventListener("load", () => new EncounterWorkspacePage().pInit());
