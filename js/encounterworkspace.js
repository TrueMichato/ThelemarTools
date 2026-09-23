import {EncounterWorkspaceState, EncounterWorkspaceStore} from "./encounterworkspace/encounterworkspace-state.js";

class EncounterWorkspacePage {
	constructor () {
		this._store = new EncounterWorkspaceStore();
		this._state = EncounterWorkspaceState.getEmpty();
		this._hasUnreadableSave = false;
		this._isBusy = true;
		this._isCatalogReady = false;
		this._tiles = new Map();
		this._checks = new Map();

		this._eleMain = document.getElementById("encounter-workspace");
		this._eleStatus = document.getElementById("ew-status");
		this._eleName = document.getElementById("ew-name");
		this._eleSummary = document.getElementById("ew-summary");
		this._eleNotices = document.getElementById("ew-notices");
		this._eleRoster = document.getElementById("ew-roster");
		this._eleStatblocks = document.getElementById("ew-statblocks");
		this._eleWorkspace = document.getElementById("ew-workspace");
		this._btnChoose = document.getElementById("ew-choose");
		this._btnSelectAll = document.getElementById("ew-all");
		this._btnSelectNone = document.getElementById("ew-none");
	}

	async pInit () {
		this._btnChoose.addEventListener("click", () => this._pChoose());
		this._btnSelectAll.addEventListener("click", () => this._pSetTargets(this._state.instances.map(it => it.id)));
		this._btnSelectNone.addEventListener("click", () => this._pSetTargets([]));

		let catalogError = null;
		try {
			await Promise.all([PrereleaseUtil.pInit(), BrewUtil2.pInit()]);
			await ExcludeUtil.pInitialise();
			this._isCatalogReady = true;
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
			htmlDescription: "Replace the current working encounter with a new copy of this saved Bestiary list? Its roster and target selection will be lost. The saved Bestiary list will not change.",
			textYes: "Replace Encounter",
			textNo: "Keep Current",
		});
	}

	async _pSetTargets (ids) {
		if (this._isBusy) return;
		this._setBusy(true);
		try {
			const next = EncounterWorkspaceState.validate({...this._state, selectedIds: ids});
			this._state = await this._store.pSave(next);
			this._updateTargets();
			this._setStatus(`${this._state.selectedIds.length} of ${this._state.instances.length} monsters selected as targets.`);
		} catch (e) {
			this._updateTargets();
			this._setError(`Target selection was not saved: ${this._getErrorMessage(e)}. Try again.`);
		} finally {
			this._setBusy(false);
		}
	}

	_render () {
		this._tiles.clear();
		this._checks.clear();
		this._eleRoster.replaceChildren();
		this._eleStatblocks.replaceChildren();
		this._eleNotices.replaceChildren();

		const {sourceList, instances, omissions} = this._state;
		this._eleWorkspace.hidden = !sourceList;
		if (!sourceList) return;

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

		const numbers = new Map();
		for (const instance of instances) {
			const name = instance.monster._displayName || instance.monster.name;
			const key = `${name}|${instance.monster.source}|${instance.customHashId || ""}`;
			const ordinal = (numbers.get(key) || 0) + 1;
			numbers.set(key, ordinal);
			const label = `${name} #${ordinal}`;

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

			const tile = document.createElement("article");
			tile.className = "ew__statblock";
			const title = document.createElement("h3");
			title.className = "ew__statblock-title";
			title.textContent = label;
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
				tile.append(title, failure);
				this._tiles.set(instance.id, tile);
				this._eleStatblocks.append(tile);
				continue;
			}
			table.append(body);
			tile.append(title, table);
			this._tiles.set(instance.id, tile);
			this._eleStatblocks.append(tile);
		}
		this._updateTargets();
	}

	_updateTargets () {
		const selected = new Set(this._state.selectedIds);
		this._eleSummary.textContent = `${selected.size} of ${this._state.instances.length} selected as targets`;
		this._checks.forEach((check, id) => check.checked = selected.has(id));
		this._tiles.forEach((tile, id) => tile.classList.toggle("ew__statblock--selected", selected.has(id)));
	}
}

window.addEventListener("load", () => new EncounterWorkspacePage().pInit());
