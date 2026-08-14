import {
	NPC_TRACKER_ROLL_TYPES,
	getNpcTrackerSignedNumber,
	sortNpcTrackerBatchResults,
} from "./dmscreen-npctracker-roll.js";

export class NpcTrackerBatch {
	constructor ({fnGetContext, fnUpdateConfig, fnRoll, fnSort, fnToggleNpc, fnToggleAll, fnApplyHp, fnUndoHp}) {
		this._fnGetContext = fnGetContext;
		this._fnUpdateConfig = fnUpdateConfig;
		this._fnRoll = fnRoll;
		this._fnSort = fnSort;
		this._fnToggleNpc = fnToggleNpc;
		this._fnToggleAll = fnToggleAll;
		this._fnApplyHp = fnApplyHp;
		this._fnUndoHp = fnUndoHp;
	}

	render ({wrp, isNarrow = false, fnShowRoster = null}) {
		wrp.empty();
		const {batch, npcs, hasHpUndo} = this._fnGetContext();
		if (!batch) return;

		const btnBack = isNarrow
			? ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-npc__back" type="button"><span class="glyphicon glyphicon-chevron-left"></span> Roster</button>`
				.onn("click", fnShowRoster)
			: null;
		const eleTitle = ee`<h2 class="dm-npc__batch-title"></h2>`;
		eleTitle.textContent = `Encounter Control: ${batch.scopeName}`;
		const eleCount = ee`<span class="dm-npc__batch-count"></span>`;
		const selectedCount = npcs.filter(npc => batch.selectedNpcIds.has(npc.id)).length;
		eleCount.textContent = `${selectedCount} of ${npcs.length} selected`;

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
		btnRoll.disabled = batch.isRolling || !selectedCount;
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

		this._renderMembers({batch, npcs, wrp: wrpBody});
		this._renderHpControls({batch, selectedCount, hasHpUndo, wrp: wrpBody});

		if (batch.error) {
			const eleError = ee`<div class="dm-npc__batch-error" role="alert"></div>`;
			eleError.textContent = batch.error;
			eleError.appendTo(wrpBody);
		}
		if (batch.operationMessage) {
			const eleStatus = ee`<div class="dm-npc__batch-status" role="status"></div>`;
			eleStatus.textContent = batch.operationMessage;
			eleStatus.appendTo(wrpBody);
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

	_renderMembers ({batch, npcs, wrp}) {
		const selectedCount = npcs.filter(npc => batch.selectedNpcIds.has(npc.id)).length;
		const cbAll = ee`<input type="checkbox" aria-label="Select all NPCs in scope">`;
		cbAll.checked = !!npcs.length && selectedCount === npcs.length;
		cbAll.indeterminate = selectedCount > 0 && selectedCount < npcs.length;
		cbAll.disabled = batch.isRolling || !npcs.length;
		cbAll.onn("change", evt => this._fnToggleAll(evt.currentTarget.checked));

		const wrpMembers = ee`<section class="dm-npc__batch-members">
			<div class="dm-npc__batch-members-header"><label>${cbAll}<strong>Scope members</strong></label></div>
			<div class="dm-npc__batch-member-list" role="list"></div>
		</section>`;
		const list = wrpMembers.querySelector(".dm-npc__batch-member-list");
		npcs.forEach(npc => {
			const cb = ee`<input type="checkbox">`;
			cb.checked = batch.selectedNpcIds.has(npc.id);
			cb.disabled = batch.isRolling;
			cb.attr("aria-label", `Select ${npc.alias || npc.monster.name}`);
			cb.onn("change", () => this._fnToggleNpc(npc.id));
			const name = ee`<span class="dm-npc__batch-member-name"></span>`;
			name.textContent = npc.alias || npc.monster.name;
			const hp = ee`<span class="dm-npc__batch-member-hp"></span>`;
			hp.textContent = `HP ${npc.hp.current}/${npc.hp.max}${npc.hp.temp ? ` +${npc.hp.temp}` : ""}`;
			ee`<label class="dm-npc__batch-member" role="listitem">${cb}${name}${hp}</label>`.appendTo(list);
		});
		wrpMembers.appendTo(wrp);
	}

	_renderHpControls ({batch, selectedCount, hasHpUndo, wrp}) {
		const input = ee`<input class="ve-form-control ve-input-xs dm-npc__batch-hp-input" type="text" placeholder="-30, +12, =15, or 8d6" aria-label="Batch HP expression">`;
		const cbHalf = ee`<input type="checkbox" aria-label="Apply half value">`;
		const btnApply = ee`<button class="ve-btn ve-btn-danger ve-btn-xs" type="button">Apply HP</button>`
			.onn("click", () => this._fnApplyHp({raw: input.value, isHalf: cbHalf.checked}));
		btnApply.disabled = batch.isRolling || !selectedCount;
		const btnUndo = ee`<button class="ve-btn ve-btn-default ve-btn-xs" type="button">Undo HP</button>`
			.onn("click", () => this._fnUndoHp());
		btnUndo.disabled = batch.isRolling || !hasHpUndo;

		ee`<section class="dm-npc__batch-operation">
			<div><strong>Hit points</strong><span class="dm-npc__batch-operation-help">Unsigned values deal damage; damage consumes temporary HP first.</span></div>
			<div class="dm-npc__batch-operation-controls">${input}<label class="dm-npc__batch-half">${cbHalf}<span>Half</span></label>${btnApply}${btnUndo}</div>
		</section>`.appendTo(wrp);
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
