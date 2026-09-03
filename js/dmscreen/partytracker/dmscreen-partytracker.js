import {DmScreenPanelAppBase} from "../dmscreen-panelapp-base.js";
import {PartyTrackerCharacterSerializer} from "./dmscreen-partytracker-serial.js";
import {PartyTrackerCharacter} from "./dmscreen-partytracker-character.js";
import {getPartyCarryAggregate} from "../../hub/hub-carry-contract.js";
import {PartyTrackerDcCalc} from "./dmscreen-partytracker-dccalc.js";
import {PartyTrackerImporter} from "./dmscreen-partytracker-import.js";

export class PartyTracker extends DmScreenPanelAppBase {
	constructor (...args) {
		super(...args);
		this._comp = null;
	}

	_getPanelElement (board, state) {
		const wrpPanel = ee`<div class="ve-w-100 ve-h-100 dm-party__root dm__panel-bg dm__data-anchor"></div>`;
		this._comp = new PartyTrackerRoot(board, wrpPanel);
		this._comp.setStateFrom(state || {});
		this._comp.setHubCampaignStatus(board.getHubCampaignStatus?.(), {isSkipRender: true});
		this._comp.render(wrpPanel);
		if (board._hubCharacterProjections?.length) {
			this._comp.setHubCharacterProjections(board._hubCharacterProjections);
		}
		return wrpPanel;
	}

	getState () {
		return this._comp?.getSaveableState();
	}

	getCharacters () {
		return this._comp?.getCharacters() || [];
	}

	getSettings () {
		return this._comp?.getSettings() || {};
	}

	onBoardEvent ({type, payload}) {
		switch (type) {
			case "hubCharacterProjections":
				this._comp?.setHubCharacterProjections(payload?.characters || []);
				return;
			case "hubCampaignStatus":
				this._comp?.setHubCampaignStatus(payload);
				return;
			case "hubPartyInventory":
				this._comp?.setHubPartyInventory(payload);
		}
	}
}

/* ======================================== */

class PartyTrackerRoot {
	constructor (board, wrpPanel) {
		this._board = board;
		this._wrpPanel = wrpPanel;

		this._characters = [];
		this._settings = PartyTrackerCharacterSerializer.deserializeSettings({});
		this._dcCalc = null;
		this._wrpChars = null;
		this._wrpLinkedRows = null;
		this._wrpManualRows = null;
		this._eleSyncState = null;
		this._eleManualCount = null;
		this._wrpDcCalc = null;
		this._showDcCalc = false;
		this._hubCharacterIds = new Set();
		// Weight summary only, never the stash contents, and held in memory rather than in
		// Board state so linked stash truth is not persisted to localStorage.
		this._hubPartyInventory = null;
		this._hubCampaignStatus = board.getHubCampaignStatus?.() || null;
	}

	render (eleParent) {
		eleParent.empty();

		const settings = this._settings;
		const enableTgtt = () => settings.enableTgtt;

		/* ----- Header ----- */
		const isHubCampaign = !!this._hubCampaignStatus;
		const addLabel = isHubCampaign ? "Add Manual" : "Add Character";
		const importLabel = isHubCampaign ? "Import Manual" : "Import";
		const btnAdd = ee`<button class="ve-btn ve-btn-primary ve-btn-xs" title="${isHubCampaign ? "Add a manual workspace character" : "Add a new character"}" aria-label="${addLabel}"><span class="glyphicon glyphicon-plus" aria-hidden="true"></span> ${addLabel}</button>`
			.onn("click", () => {
				const charData = PartyTrackerCharacterSerializer.getDefaultCharacter();
				const charComp = new PartyTrackerCharacter(charData, this._settings);
				this._characters.push(charComp);
				if (this._hubCampaignStatus) this._renderManualCharacters();
				else this._renderCharacterLists();
				this._doSave();
				this._updateSummary();
				this._dcCalc?.refresh();
				this._board.fireBoardEvent({type: "partyTrackerUpdate"});
			});

		const btnDcCalc = ee`<button class="ve-btn ${this._showDcCalc ? "ve-btn-primary" : "ve-btn-default"} ve-btn-xs" title="Toggle DC Success Calculator" aria-label="Toggle DC Calculator"><span class="glyphicon glyphicon-signal" aria-hidden="true"></span> DC Calc</button>`
			.attr("aria-pressed", this._showDcCalc)
			.onn("click", () => {
				this._showDcCalc = !this._showDcCalc;
				btnDcCalc.toggleClass("ve-btn-primary", this._showDcCalc).toggleClass("ve-btn-default", !this._showDcCalc);
				btnDcCalc.attr("aria-pressed", this._showDcCalc);
				this._renderDcCalcSection();
			});

		/* Hidden file input for character sheet import */
		const iptFileImport = ee`<input type="file" accept=".json" style="display: none;" aria-hidden="true">`;
		iptFileImport.onn("change", (e) => {
			const file = e.target.files?.[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = (evt) => {
				this._handleImportJson(evt.target.result);
				iptFileImport.val("");
			};
			reader.readAsText(file);
		});

		const btnImport = ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="${isHubCampaign ? "Import a manual workspace character from Character Sheet JSON" : "Import character from Character Sheet JSON export"}" aria-label="${importLabel}"><span class="glyphicon glyphicon-import" aria-hidden="true"></span> ${importLabel}</button>`
			.onn("click", () => iptFileImport.click());

		const btnSettings = ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Party Tracker Settings" aria-label="Settings"><span class="glyphicon glyphicon-cog" aria-hidden="true"></span></button>`
			.onn("click", (evt) => this._openSettingsMenu(evt));

		/* ----- Summary ----- */
		this._eleSummary = ee`<span class="dm-party__summary" aria-live="polite"></span>`;
		this._updateSummary();

		/* ----- Characters ----- */
		this._wrpChars = ee`<div class="dm-party__body"></div>`;
		this._renderCharacterLists();

		/* ----- DC Calc ----- */
		this._wrpDcCalc = ee`<div class="ve-flex-col ve-w-100 ve-no-shrink"></div>`;

		ee`<div class="ve-w-100 ve-h-100 ve-flex-col">
			<div class="dm-party__toolbar">
				<div class="ve-btn-group">${btnAdd}${btnImport}${btnDcCalc}</div>
				${this._eleSummary}
				<div class="ve-ml-auto">${btnSettings}</div>
			</div>
			${iptFileImport}
			${this._wrpChars}
			${this._wrpDcCalc}
		</div>`.appendTo(eleParent);
		this._renderDcCalcSection();
	}

	_renderCharacterLists () {
		if (!this._wrpChars) return;
		this._wrpChars.empty();
		this._wrpLinkedRows = null;
		this._wrpManualRows = null;
		this._eleSyncState = null;
		this._eleManualCount = null;
		if (!this._hubCampaignStatus) {
			const wrpCharacters = ee`<div class="dm-party__character-list" role="list" aria-label="Party characters"></div>`.appendTo(this._wrpChars);
			this._characters.forEach(charComp => this._renderCharacter(charComp, wrpCharacters));
			return;
		}

		const wrpLinked = ee`<section class="dm-party__group dm-party__group--linked" aria-label="Live campaign characters"></section>`.appendTo(this._wrpChars);
		ee`<div class="dm-party__group-header">
			<div><span class="dm-party__group-title">Live campaign characters</span><span class="dm-party__group-help">Read-only; edit from each Character Sheet</span></div>
			${this._eleSyncState = ee`<span class="dm-party__sync-state"></span>`}
		</div>`.appendTo(wrpLinked);
		this._wrpLinkedRows = ee`<div class="dm-party__character-list" role="list" aria-label="Linked campaign characters"></div>`.appendTo(wrpLinked);
		this._renderLinkedCharacters();

		const wrpManual = ee`<section class="dm-party__group dm-party__group--manual" aria-label="Manual workspace characters"></section>`.appendTo(this._wrpChars);
		ee`<div class="dm-party__group-header">
			<div><span class="dm-party__group-title">Manual workspace characters</span><span class="dm-party__group-help">Private to this DM workspace</span></div>
			${this._eleManualCount = ee`<span class="dm-party__manual-count"></span>`}
		</div>`.appendTo(wrpManual);
		this._wrpManualRows = ee`<div class="dm-party__character-list" role="list" aria-label="Manual workspace characters"></div>`.appendTo(wrpManual);
		this._renderManualCharacters();
	}

	_renderLinkedCharacters () {
		if (!this._wrpLinkedRows) return;
		const linked = this._characters.filter(character => this._hubCharacterIds.has(character.data?.id));
		this._wrpLinkedRows.empty();
		if (linked.length) linked.forEach(charComp => this._renderCharacter(charComp, this._wrpLinkedRows));
		else {
			const sync = this._hubCampaignStatus?.sync || "connecting";
			const emptyText = ["connecting", "syncing"].includes(sync)
				? "Waiting for campaign character data..."
				: "No campaign characters are linked yet. They will appear here when players add them to this campaign.";
			ee`<div class="dm-party__empty-state"></div>`.txt(emptyText).appendTo(this._wrpLinkedRows);
		}
		this._updateHubSyncState();
	}

	_renderManualCharacters () {
		if (!this._wrpManualRows) return;
		const manual = this._characters.filter(character => !this._hubCharacterIds.has(character.data?.id));
		this._wrpManualRows.empty();
		if (manual.length) manual.forEach(charComp => this._renderCharacter(charComp, this._wrpManualRows));
		else ee`<div class="dm-party__empty-state">No manual characters. Use Add Manual or Import Manual if you need a private reference row.</div>`.appendTo(this._wrpManualRows);
		if (this._eleManualCount) this._eleManualCount.textContent = `${manual.length} manual`;
	}

	_updateHubSyncState () {
		if (!this._eleSyncState || !this._hubCampaignStatus) return;
		const sync = this._hubCampaignStatus.sync || "connecting";
		const linkedCount = this._hubCharacterIds.size;
		const lastSynced = this._hubCampaignStatus.lastSyncedAt
			? new Date(this._hubCampaignStatus.lastSyncedAt).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"})
			: null;
		const syncText = {
			connecting: "Connecting...",
			syncing: "Syncing...",
			live: `${linkedCount} linked${lastSynced ? ` \u00b7 ${lastSynced}` : ""}`,
			reconnecting: `Reconnecting${lastSynced ? ` \u00b7 last sync ${lastSynced}` : ""}`,
			stale: `Data may be stale${lastSynced ? ` \u00b7 last sync ${lastSynced}` : ""}`,
			stopped: "Sync stopped",
		}[sync] || "Unavailable";
		this._eleSyncState.className = `dm-party__sync-state dm-party__sync-state--${sync}`;
		this._eleSyncState.textContent = syncText;
	}

	_renderCharacter (charComp, container) {
		const isReadOnly = this._hubCharacterIds.has(charComp.data?.id);
		charComp.settings = this._settings;
		charComp.render(container, {
			onUpdate: () => {
				if (isReadOnly) return;
				this._doSave();
				this._updateSummary();
				this._dcCalc?.refresh();
				this._board.fireBoardEvent({type: "partyTrackerUpdate"});
			},
			onRemove: null,
			enableTgtt: () => this._settings.enableTgtt,
			isReadOnly,
		});
		if (isReadOnly) {
			charComp.onRemove = null;
			return;
		}
		charComp.onRemove = () => {
			const ix = this._characters.indexOf(charComp);
			if (~ix) {
				this._characters.splice(ix, 1);
				if (this._hubCampaignStatus) this._renderManualCharacters();
				else this._renderCharacterLists();
				this._doSave();
				this._updateSummary();
				this._dcCalc?.refresh();
				this._board.fireBoardEvent({type: "partyTrackerUpdate"});
			}
		};
	}

	_renderDcCalcSection () {
		this._wrpDcCalc.empty();
		if (!this._showDcCalc) return;

		const wrpCalc = ee`<div class="dm-party__dc-calc"></div>`;
		ee`<div class="dm-party__dc-title">DC Success Calculator</div>`.appendTo(wrpCalc);

		this._dcCalc = new PartyTrackerDcCalc({
			getCharacters: () => this.getCharacters(),
			getSettings: () => this._settings,
		});
		this._dcCalc.render(wrpCalc);
		wrpCalc.appendTo(this._wrpDcCalc);
	}

	/* -------------------------------------------- */
	//  Character Sheet Import
	/* -------------------------------------------- */

	setHubCharacterProjections (characters) {
		this._characters = this._characters.filter(character => !this._hubCharacterIds.has(character.data?.id));
		this._hubCharacterIds.clear();
		for (const character of characters) {
			// ADR 0011: a linked row renders whatever the requester is authorized to see.
			// A DM/owner envelope carries the canonical document; a peer profile carries
			// the already-projected catalog and must never be read as a document.
			const mapped = this._getLinkedCharacterData(character);
			if (!mapped) continue;
			this._hubCharacterIds.add(mapped.id);
			this._characters.push(new PartyTrackerCharacter(mapped, this._settings));
		}
		if (this._wrpPanel) {
			if (this._hubCampaignStatus && this._wrpLinkedRows) this._renderLinkedCharacters();
			else this._renderCharacterLists();
		}
		this._updateSummary();
		this._dcCalc?.refresh();
		this._board.fireBoardEvent({type: "partyTrackerUpdate"});
	}

	_getLinkedCharacterData (character) {
		try {
			if (character?.kind === "peer_profile") {
				const mapped = PartyTrackerImporter.mapPeerProfile(character.data || {});
				mapped.id = character.id;
				return mapped.name || mapped.classes?.some(c => c.name) ? mapped : null;
			}
			const raw = character?.character?.data || character?.data || character;
			if (!PartyTrackerImporter.validate(raw).valid) return null;
			const mapped = PartyTrackerImporter.mapCharacterSheetData(raw);
			mapped.id = character?.character?.id || character?.id || raw.id;
			// A DM envelope carries its own server-validated, policy-independent carry summary.
			// `mapCharacterSheetData` cannot supply one: it sees the canonical document, whose
			// authority block only the server can vouch for, and would otherwise leave the row
			// recomputing capacity locally from raw inventory weights — the divergent formula
			// this contract exists to remove. Absent means "not synced", never zero.
			mapped.carrySummary = character?.kind === "dm_truth"
				? (PartyTrackerImporter.mapCarrySummary(character.carrySummary) ?? {state: "unavailable"})
				: null;
			return mapped;
		} catch {
			return null;
		}
	}

	/**
	 * Receive the shared party stash weight summary.
	 *
	 * Deliberately not persisted into Board state: the stash belongs to the campaign, and a
	 * DM workspace saved to localStorage should not carry a snapshot of it.
	 * @param {?object} summary
	 */
	setHubPartyInventory (summary) {
		this._hubPartyInventory = summary || null;
		this._updateSummary();
	}

	setHubCampaignStatus (status, {isSkipRender = false} = {}) {
		const wasHubCampaign = !!this._hubCampaignStatus;
		this._hubCampaignStatus = status || null;
		if (isSkipRender || !this._wrpPanel) return;
		if (wasHubCampaign !== !!this._hubCampaignStatus) {
			this.render(this._wrpPanel);
			return;
		}
		if (!this._hubCharacterIds.size) this._renderLinkedCharacters();
		else this._updateHubSyncState();
	}

	_handleImportJson (jsonStr) {
		let parsed;
		try {
			parsed = JSON.parse(jsonStr);
		} catch (e) {
			JqueryUtil.doToast({content: "Import failed: invalid JSON", type: "danger"});
			return;
		}

		const validation = PartyTrackerImporter.validate(parsed);
		if (!validation.valid) {
			JqueryUtil.doToast({content: `Import failed: ${validation.reason}`, type: "danger"});
			return;
		}

		let charData;
		try {
			charData = PartyTrackerImporter.mapCharacterSheetData(parsed);
		} catch (e) {
			JqueryUtil.doToast({content: `Import failed: ${e.message}`, type: "danger"});
			return;
		}

		// Check for existing character with same name
		const existingIx = charData.name
			? this._characters.findIndex(c =>
				!this._hubCharacterIds.has(c.data?.id)
				&& (c.data?.name || "").toLowerCase() === charData.name.toLowerCase(),
			)
			: -1;

		if (~existingIx) {
			const doUpdate = confirm(`"${charData.name}" already exists in the party. Update existing? (Cancel to add as new)`);
			if (doUpdate) {
				const existing = this._characters[existingIx];
				// Preserve PT-only fields
				charData.counters = existing.data.counters || [];
				charData.notes = existing.data.notes || "";
				charData.bonuses = existing.data.bonuses || {skills: {}, saves: {}, passives: {}};
				charData.id = existing.data.id;
				existing.data = charData;
				if (this._hubCampaignStatus) this._renderManualCharacters();
				else this._renderCharacterLists();
				JqueryUtil.doToast({content: `Updated "${charData.name}"`, type: "success"});
			} else {
				this._addImportedCharacter(charData);
			}
		} else {
			this._addImportedCharacter(charData);
		}

		this._doSave();
		this._updateSummary();
		this._dcCalc?.refresh();
		this._board.fireBoardEvent({type: "partyTrackerUpdate"});
	}

	_addImportedCharacter (charData) {
		const charComp = new PartyTrackerCharacter(charData, this._settings);
		this._characters.push(charComp);
		if (this._hubCampaignStatus) this._renderManualCharacters();
		else this._renderCharacterLists();
		JqueryUtil.doToast({content: `Imported "${charData.name}"`, type: "success"});
	}

	_updateSummary () {
		if (!this._eleSummary) return;
		const n = this._characters.length;
		if (n === 0) {
			this._eleSummary.textContent = "No characters";
			return;
		}

		let totalLevel = 0;
		let totalHpCurrent = 0;
		let totalHpMax = 0;
		let anyHpSet = false;
		const members = [];
		for (const c of this._characters) {
			const data = c.data || c.getSaveableData();
			const calc = new PartyTrackerCharacter(data, this._settings);
			totalLevel += calc.getTotalLevel();
			members.push(calc.getCarryState());
			if (data.hp?.max > 0) {
				totalHpCurrent += data.hp.current || 0;
				totalHpMax += data.hp.max || 0;
				anyHpSet = true;
			}
		}

		// Members whose carry is unavailable are counted and excluded, never estimated: a
		// guessed load would be indistinguishable from a real one, and nothing about a
		// withheld character can be recovered by subtracting from the total.
		const carry = getPartyCarryAggregate({
			members,
			stashWeight: this._hubPartyInventory?.state === "known" ? this._hubPartyInventory.knownWeight : null,
			stashUnknownStackCount: this._hubPartyInventory?.unknownStackCount || 0,
		});

		const avgLevel = Math.round((totalLevel / n) * 10) / 10;
		const carryPct = carry.totalBodyCapacity > 0 ? Math.round((carry.totalBodyLoad / carry.totalBodyCapacity) * 100) : 0;
		const carryPrefix = carry.isTotalPartial ? "\u2265" : "";
		const carryNotes = [
			carry.overCapacityCount ? `${carry.overCapacityCount} over capacity` : null,
			carry.unavailableCount ? `${carry.unavailableCount} not synced` : null,
		].filter(Boolean);

		const hpStr = anyHpSet ? ` \u00b7 HP: ${totalHpCurrent}/${totalHpMax}` : "";
		const sourceStr = this._hubCampaignStatus
			? ` \u00b7 ${this._hubCharacterIds.size} live \u00b7 ${n - this._hubCharacterIds.size} manual`
			: "";
		const stashStr = this._hubPartyInventory
			? ` \u00b7 Stash: ${this._hubPartyInventory.state === "known" ? `${Math.round(this._hubPartyInventory.knownWeight * 10) / 10} lb` : "\u2014"}`
			: "";
		const notesStr = carryNotes.length ? ` (${carryNotes.join(", ")})` : "";
		this._eleSummary.textContent = `${n} char${n !== 1 ? "s" : ""}${sourceStr} \u00b7 Lv ${avgLevel}${hpStr} \u00b7 Carry: ${carryPrefix}${Math.round(carry.totalBodyLoad * 10) / 10}/${carry.totalBodyCapacity} lb (${carryPct}%)${notesStr}${stashStr}`;
	}

	_openSettingsMenu (evt) {
		const trigger = evt.currentTarget || evt.target;
		const {menu, doClose: doRemove} = this._buildSettingsModal();
		menu.appendTo(document.body);

		const rect = trigger.getBoundingClientRect();
		menu.css({
			position: "fixed",
			top: `${rect.bottom + 2}px`,
			right: `${window.innerWidth - rect.right}px`,
		});

		const prevFocus = document.activeElement;
		let isClosed = false;
		const doClose = () => {
			if (isClosed) return;
			isClosed = true;
			document.removeEventListener("click", onClickOutside, true);
			document.removeEventListener("keydown", onKeyDown, true);
			doRemove();
			/* Restore focus to the trigger if it's still in the document. */
			if (prevFocus?.isConnected && typeof prevFocus.focus === "function") prevFocus.focus();
		};

		const onClickOutside = (e) => {
			if (!menu.contains(e.target) && !trigger.contains(e.target)) doClose();
		};
		const onKeyDown = (e) => {
			if (e.key === "Escape") { e.stopPropagation(); doClose(); }
		};

		setTimeout(() => {
			document.addEventListener("click", onClickOutside, true);
			document.addEventListener("keydown", onKeyDown, true);
			/* Move focus into the dialog for keyboard + screen-reader users. */
			const firstCtrl = menu.querySelector("input, select, button, [tabindex]");
			if (firstCtrl) firstCtrl.focus();
		}, 0);
	}

	_buildSettingsModal () {
		const wrp = ee`<div class="dm-party__settings dm-party__settings--floating" role="dialog" aria-modal="false" aria-label="Party Tracker Settings"></div>`;

		ee`<div class="dm-party__settings-title">Party Tracker Settings</div>`.appendTo(wrp);

		/* Sub-toggles container — rebuilt when TGTT toggled */
		const wrpTgtt = ee`<div class="dm-party__settings-group"></div>`;

		const renderTgttSubToggles = () => {
			wrpTgtt.empty();
			if (!this._settings.enableTgtt) return;

			for (const [key, label] of [
				["thelemar_carryWeight", "Carry Weight (Might-based)"],
				["thelemar_encumbranceTiers", "Encumbrance Tiers (house rule)"],
				["thelemar_jumping", "Jump Distances (Athletics-based)"],
				["thelemar_linguisticsBonus", "Linguistics Bonus (+1/language)"],
				["thelemar_criticalRolls", "Critical Rolls (Nat 1: \u22125, Nat 20: +5)"],
			]) {
				const cbx = ee`<input type="checkbox" ${this._settings[key] ? "checked" : ""} aria-label="${label}">`
					.onn("change", () => {
						this._settings[key] = cbx.prop("checked");
						this._refreshAll();
					});
				ee`<label class="dm-party__settings-row">${cbx}<span>${label}</span></label>`.appendTo(wrpTgtt);
			}

			/* Exhaustion rules */
			const selExh = ee`<select class="ve-form-control ve-input-xs" style="width: 110px;" aria-label="Exhaustion rule set">
				<option value="thelemar" ${this._settings.exhaustionRules === "thelemar" ? "selected" : ""}>Thelemar</option>
				<option value="2024" ${this._settings.exhaustionRules === "2024" ? "selected" : ""}>2024</option>
				<option value="standard" ${this._settings.exhaustionRules === "standard" ? "selected" : ""}>Standard (2014)</option>
			</select>`.onn("change", () => { this._settings.exhaustionRules = selExh.val(); this._refreshAll(); });

			ee`<div class="dm-party__settings-row"><span>Exhaustion Rules</span>${selExh}</div>`.appendTo(wrpTgtt);
		};

		/* TGTT Master Toggle */
		const cbxTgtt = ee`<input type="checkbox" ${this._settings.enableTgtt ? "checked" : ""} aria-label="Enable Thelemar homebrew rules">`
			.onn("change", () => {
				this._settings.enableTgtt = cbxTgtt.prop("checked");
				renderTgttSubToggles();
				this._refreshAll();
			});
		ee`<label class="dm-party__settings-row"><span class="ve-bold">Enable Thelemar (TGTT)</span>${cbxTgtt}</label>`.appendTo(wrp);

		renderTgttSubToggles();
		wrpTgtt.appendTo(wrp);

		const doClose = () => wrp.remove();
		return {menu: wrp, doClose};
	}

	_refreshAll () {
		this._doSave();
		if (this._wrpPanel) {
			this.render(this._wrpPanel);
		}
	}

	_doSave () {
		this._board.doSaveStateDebounced();
	}

	/* -------------------------------------------- */
	//  Persistence
	/* -------------------------------------------- */

	setStateFrom (toLoad) {
		this._settings = PartyTrackerCharacterSerializer.deserializeSettings(toLoad?.settings || {});
		this._characters = [];
		if (toLoad?.characters?.length) {
			for (const raw of toLoad.characters) {
				const charData = PartyTrackerCharacterSerializer.deserialize(raw);
				this._characters.push(new PartyTrackerCharacter(charData, this._settings));
			}
		}
	}

	getSaveableState () {
		return {
			settings: PartyTrackerCharacterSerializer.serializeSettings(this._settings),
			characters: this._characters
				.filter(c => !this._hubCharacterIds.has(c.data?.id))
				.map(c => PartyTrackerCharacterSerializer.serialize(c.getSaveableData())),
		};
	}

	getCharacters () {
		return this._characters.map(c => ({
			...c.getSaveableData(),
			isHubProjection: this._hubCharacterIds.has(c.data?.id),
		}));
	}

	getSettings () {
		return {...this._settings};
	}
}

export {PartyTrackerRoot};
