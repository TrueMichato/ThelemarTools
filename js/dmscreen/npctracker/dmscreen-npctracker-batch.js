import {
	NPC_TRACKER_ROLL_TYPES,
	getNpcTrackerSignedNumber,
	sortNpcTrackerBatchResults,
} from "./dmscreen-npctracker-roll.js";

export class NpcTrackerBatch {
	constructor ({fnGetContext, fnUpdateConfig, fnRoll, fnSort}) {
		this._fnGetContext = fnGetContext;
		this._fnUpdateConfig = fnUpdateConfig;
		this._fnRoll = fnRoll;
		this._fnSort = fnSort;
	}

	render ({wrp, isNarrow = false, fnShowRoster = null}) {
		wrp.empty();
		const {batch, npcs} = this._fnGetContext();
		if (!batch) return;

		const btnBack = isNarrow
			? ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-npc__back" type="button"><span class="glyphicon glyphicon-chevron-left"></span> Roster</button>`
				.onn("click", fnShowRoster)
			: null;
		const eleTitle = ee`<h2 class="dm-npc__batch-title"></h2>`;
		eleTitle.textContent = `Batch Roll: ${batch.scopeName}`;
		const eleCount = ee`<span class="dm-npc__batch-count"></span>`;
		eleCount.textContent = `${npcs.length} ${npcs.length === 1 ? "NPC" : "NPCs"}`;

		const selType = ee`<select class="ve-form-control ve-select ve-select-xs" aria-label="Batch roll type"></select>`;
		NPC_TRACKER_ROLL_TYPES.forEach(({id, name}) => {
			const option = ee`<option value="${id}"></option>`;
			option.textContent = name;
			option.appendTo(selType);
		});
		selType.value = batch.rollType;
		selType.disabled = batch.isRolling;
		selType.onn("change", evt => this._fnUpdateConfig({
			rollType: evt.currentTarget.value,
			key: this._getDefaultKey(evt.currentTarget.value),
		}));

		const selKey = this._getKeySelect(batch);
		if (selKey) {
			selKey.disabled = batch.isRolling;
			selKey.onn("change", evt => this._fnUpdateConfig({key: evt.currentTarget.value}));
		}

		const btnRoll = ee`<button class="ve-btn ve-btn-primary ve-btn-xs" type="button"></button>`;
		btnRoll.textContent = batch.isRolling ? "Rolling..." : batch.results.length ? "Roll Again" : "Roll";
		btnRoll.disabled = batch.isRolling || !npcs.length;
		btnRoll.onn("click", () => this._fnRoll());

		const wrpControls = ee`<div class="dm-npc__batch-controls">
			<label><span>Roll</span>${selType}</label>
			${selKey ? ee`<label><span>Using</span>${selKey}</label>` : null}
			${btnRoll}
		</div>`;

		const wrpBatch = ee`<div class="dm-npc__batch">
			<div class="dm-npc__batch-header">${btnBack}<div>${eleTitle}${eleCount}</div>${wrpControls}</div>
			<div class="dm-npc__batch-body"></div>
		</div>`;
		const wrpBody = wrpBatch.querySelector(".dm-npc__batch-body");

		if (batch.error) {
			const eleError = ee`<div class="dm-npc__batch-error" role="alert"></div>`;
			eleError.textContent = batch.error;
			eleError.appendTo(wrpBody);
		}

		if (batch.results.length) this._renderResults({batch, wrp: wrpBody});
		else {
			const eleEmpty = ee`<div class="dm-npc__batch-empty"></div>`;
			eleEmpty.textContent = npcs.length
				? "Choose a roll and roll every NPC in this scope."
				: "This scope has no NPCs to roll.";
			eleEmpty.appendTo(wrpBody);
		}

		wrpBatch.appendTo(wrp);
	}

	_getKeySelect (batch) {
		if (batch.rollType === "initiative") return null;
		const values = batch.rollType === "skill"
			? Object.keys(Parser.SKILL_TO_ATB_ABV)
			: Parser.ABIL_ABVS;
		const select = ee`<select class="ve-form-control ve-select ve-select-xs" aria-label="Batch roll ability or skill"></select>`;
		values.forEach(value => {
			const option = ee`<option value="${value}"></option>`;
			option.textContent = batch.rollType === "skill" ? value.toTitleCase() : Parser.attAbvToFull(value);
			option.appendTo(select);
		});
		select.value = batch.key;
		return select;
	}

	_getDefaultKey (rollType) {
		if (rollType === "initiative") return null;
		if (rollType === "skill") return "perception";
		return "dex";
	}

	_renderResults ({batch, wrp}) {
		const results = sortNpcTrackerBatchResults({
			results: batch.results,
			sortKey: batch.sortKey,
			sortDirection: batch.sortDirection,
		});
		const table = ee`<div class="dm-npc__batch-results" role="table" aria-label="Batch roll results"></div>`;
		const getSortButton = ({key, label}) => {
			const button = ee`<button class="dm-npc__batch-sort" type="button"></button>`;
			button.textContent = `${label}${batch.sortKey === key ? batch.sortDirection === "asc" ? " ▲" : " ▼" : ""}`;
			button.onn("click", () => this._fnSort(key));
			return button;
		};
		ee`<div class="dm-npc__batch-result-row dm-npc__batch-result-row--header" role="row">
			<div role="columnheader">${getSortButton({key: "name", label: "NPC"})}</div>
			<div role="columnheader">Roll</div>
			<div role="columnheader">${getSortButton({key: "total", label: "Total"})}</div>
		</div>`.appendTo(table);

		results.forEach(result => {
			const eleName = ee`<div class="dm-npc__batch-result-name" role="cell"></div>`;
			eleName.textContent = result.name;
			const eleFormula = ee`<div class="dm-npc__batch-result-formula" role="cell"></div>`;
			eleFormula.textContent = `${result.die} ${getNpcTrackerSignedNumber(result.bonus)}`;
			const eleTotal = ee`<strong class="dm-npc__batch-result-total" role="cell"></strong>`;
			eleTotal.textContent = result.total;
			ee`<div class="dm-npc__batch-result-row" role="row">${eleName}${eleFormula}${eleTotal}</div>`.appendTo(table);
		});
		table.appendTo(wrp);
	}
}
