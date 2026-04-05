import {DmScreenPanelAppBase} from "../dmscreen-panelapp-base.js";
import {PartyTrackerCharacterSerializer} from "./dmscreen-partytracker-serial.js";
import {PartyTrackerCharacter} from "./dmscreen-partytracker-character.js";
import {PartyTrackerDcCalc} from "./dmscreen-partytracker-dccalc.js";

export class PartyTracker extends DmScreenPanelAppBase {
	constructor (...args) {
		super(...args);
		this._comp = null;
	}

	_getPanelElement (board, state) {
		const wrpPanel = ee`<div class="ve-w-100 ve-h-100 dm-party__root dm__panel-bg dm__data-anchor"></div>`;
		this._comp = new PartyTrackerRoot(board, wrpPanel);
		this._comp.setStateFrom(state || {});
		this._comp.render(wrpPanel);
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
		this._wrpDcCalc = null;
		this._showDcCalc = false;
	}

	render (eleParent) {
		eleParent.empty();

		const settings = this._settings;
		const enableTgtt = () => settings.enableTgtt;

		/* ----- Header ----- */
		const btnAdd = ee`<button class="ve-btn ve-btn-primary ve-btn-xs" title="Add a new character" aria-label="Add Character"><span class="glyphicon glyphicon-plus" aria-hidden="true"></span> Add Character</button>`
			.onn("click", () => {
				const charData = PartyTrackerCharacterSerializer.getDefaultCharacter();
				const charComp = new PartyTrackerCharacter(charData, this._settings);
				this._characters.push(charComp);
				this._renderCharacter(charComp, this._wrpChars);
				this._doSave();
				this._board.fireBoardEvent({type: "partyTrackerUpdate"});
			});

		const btnDcCalc = ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Toggle DC Success Calculator" aria-label="Toggle DC Calculator"><span class="glyphicon glyphicon-signal" aria-hidden="true"></span> DC Calc</button>`
			.onn("click", () => {
				this._showDcCalc = !this._showDcCalc;
				btnDcCalc.toggleClass("ve-btn-primary", this._showDcCalc).toggleClass("ve-btn-default", !this._showDcCalc);
				btnDcCalc.attr("aria-pressed", this._showDcCalc);
				this._renderDcCalcSection();
			});

		const btnSettings = ee`<button class="ve-btn ve-btn-default ve-btn-xs" title="Party Tracker Settings" aria-label="Settings"><span class="glyphicon glyphicon-cog" aria-hidden="true"></span></button>`
			.onn("click", (evt) => this._openSettingsMenu(evt));

		/* ----- Summary ----- */
		this._eleSummary = ee`<span class="dm-party__summary" aria-live="polite"></span>`;
		this._updateSummary();

		/* ----- Characters ----- */
		this._wrpChars = ee`<div class="dm-party__body" role="list" aria-label="Party characters"></div>`;
		this._characters.forEach(charComp => this._renderCharacter(charComp, this._wrpChars));

		/* ----- DC Calc ----- */
		this._wrpDcCalc = ee`<div class="ve-flex-col ve-w-100 ve-no-shrink"></div>`;

		ee`<div class="ve-w-100 ve-h-100 ve-flex-col">
			<div class="dm-party__toolbar">
				<div class="ve-btn-group">${btnAdd}${btnDcCalc}</div>
				${this._eleSummary}
				<div class="ve-ml-auto">${btnSettings}</div>
			</div>
			${this._wrpChars}
			${this._wrpDcCalc}
		</div>`.appendTo(eleParent);
	}

	_renderCharacter (charComp, container) {
		charComp.settings = this._settings;
		charComp.render(container, {
			onUpdate: () => {
				this._doSave();
				this._updateSummary();
				this._dcCalc?.refresh();
				this._board.fireBoardEvent({type: "partyTrackerUpdate"});
			},
			onRemove: null,
			enableTgtt: () => this._settings.enableTgtt,
		});
		charComp.onRemove = () => {
			const ix = this._characters.indexOf(charComp);
			if (~ix) {
				this._characters.splice(ix, 1);
				charComp.eleRow?.remove();
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

	_updateSummary () {
		if (!this._eleSummary) return;
		const n = this._characters.length;
		if (n === 0) {
			this._eleSummary.textContent = "No characters";
			return;
		}
		const avgLevel = Math.round(this._characters.reduce((sum, c) => sum + new PartyTrackerCharacter(c.data, this._settings).getTotalLevel(), 0) / n * 10) / 10;
		this._eleSummary.textContent = `${n} character${n !== 1 ? "s" : ""} · Avg Lv ${avgLevel}`;
	}

	_openSettingsMenu (evt) {
		const {menu, doClose} = this._buildSettingsModal();
		menu.appendTo(document.body);

		const rect = evt.target.getBoundingClientRect();
		menu.css({
			position: "fixed",
			top: `${rect.bottom + 2}px`,
			right: `${window.innerWidth - rect.right}px`,
			zIndex: 9999,
		});

		const onClickOutside = (e) => {
			if (!menu.contains(e.target) && !evt.target.contains(e.target)) {
				doClose();
				document.removeEventListener("click", onClickOutside, true);
			}
		};
		setTimeout(() => document.addEventListener("click", onClickOutside, true), 0);
	}

	_buildSettingsModal () {
		const wrp = ee`<div class="dm-party__settings" role="dialog" aria-label="Party Tracker Settings"></div>`;

		ee`<div class="dm-party__settings-title">Party Tracker Settings</div>`.appendTo(wrp);

		/* Sub-toggles container — rebuilt when TGTT toggled */
		const wrpTgtt = ee`<div class="dm-party__settings-group"></div>`;

		const renderTgttSubToggles = () => {
			wrpTgtt.empty();
			if (!this._settings.enableTgtt) return;

			for (const [key, label] of [
				["thelemar_carryWeight", "Carry Weight (Might-based)"],
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
			characters: this._characters.map(c => PartyTrackerCharacterSerializer.serialize(c.getSaveableData())),
		};
	}

	getCharacters () {
		return this._characters.map(c => c.getSaveableData());
	}

	getSettings () {
		return {...this._settings};
	}
}
