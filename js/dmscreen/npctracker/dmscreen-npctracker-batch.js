import {
	NPC_TRACKER_ROLL_TYPES,
	getNpcTrackerSignedNumber,
	sortNpcTrackerBatchResults,
} from "./dmscreen-npctracker-roll.js";
import {getNpcTrackerSkillDescriptors} from "./dmscreen-npctracker-data.js";

export class NpcTrackerBatch {
	constructor ({fnGetContext, fnUpdateConfig, fnRoll, fnSort, fnToggleNpc, fnToggleAll, fnApplyHp, fnUndoHp, fnUpdateCondition, fnSendInitiative}) {
		this._fnGetContext = fnGetContext;
		this._fnUpdateConfig = fnUpdateConfig;
		this._fnRoll = fnRoll;
		this._fnSort = fnSort;
		this._fnToggleNpc = fnToggleNpc;
		this._fnToggleAll = fnToggleAll;
		this._fnApplyHp = fnApplyHp;
		this._fnUndoHp = fnUndoHp;
		this._fnUpdateCondition = fnUpdateCondition;
		this._fnSendInitiative = fnSendInitiative;
	}

	render ({wrp, isNarrow = false, fnShowRoster = null}) {
		wrp.empty();
		const {batch, npcs, hasHpUndo, referenceData} = this._fnGetContext();
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

		const wrpBatch = ee`<div class="dm-npc__batch">
			<div class="dm-npc__batch-header">${btnBack}<div>${eleTitle}${eleCount}</div></div>
			<div class="dm-npc__batch-body"></div>
		</div>`;
		const wrpBody = wrpBatch.querySelector(".dm-npc__batch-body");

		const skills = getNpcTrackerSkillDescriptors({
			skillCatalog: referenceData.skills,
			monsters: npcs.map(npc => npc.monster),
		});
		this._renderRollControls({batch, selectedCount, skills, wrp: wrpBody});
		this._renderMembers({batch, npcs, wrp: wrpBody});

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

		if (batch.results.length) {
			this._renderResults({batch, wrp: wrpBody});
			this._renderInitiativeHandoff({batch, npcs, wrp: wrpBody});
		} else {
			const eleEmpty = ee`<div class="dm-npc__batch-empty"></div>`;
			eleEmpty.textContent = npcs.length
				? "Choose a roll above. All selected NPCs will roll into one results table."
				: "This scope has no NPCs to roll.";
			eleEmpty.appendTo(wrpBody);
		}

		this._renderEncounterOperations({batch, selectedCount, hasHpUndo, conditionCatalog: referenceData.conditions, wrp: wrpBody});
		wrpBatch.appendTo(wrp);
	}

	_renderRollControls ({batch, selectedCount, skills, wrp}) {
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
			key: this._getDefaultKey(evt.currentTarget.value, skills),
		}));

		const selKey = this._getKeySelect(batch, skills);
		if (selKey) {
			selKey.disabled = batch.isRolling;
			selKey.onn("change", evt => this._fnUpdateConfig({key: evt.currentTarget.value}));
		}

		const btnRoll = ee`<button class="ve-btn ve-btn-primary ve-btn-xs" type="button"></button>`;
		btnRoll.textContent = batch.isRolling ? "Rolling..." : batch.results.length ? "Roll Again" : "Roll";
		btnRoll.disabled = batch.isRolling || !selectedCount;
		btnRoll.onn("click", () => this._fnRoll());

		ee`<section class="dm-npc__batch-rollbar" aria-label="Batch roll setup">
			<div class="dm-npc__batch-controls">
				<label><span>Roll</span>${selType}</label>
				${selKey ? ee`<label><span>Using</span>${selKey}</label>` : null}
				${btnRoll}
			</div>
			<span class="dm-npc__batch-roll-help">${selectedCount} ${selectedCount === 1 ? "NPC" : "NPCs"} will roll</span>
		</section>`.appendTo(wrp);
	}

	_renderMembers ({batch, npcs, wrp}) {
		const selectedCount = npcs.filter(npc => batch.selectedNpcIds.has(npc.id)).length;
		const cbAll = ee`<input type="checkbox" aria-label="Select all NPCs in scope">`;
		cbAll.checked = !!npcs.length && selectedCount === npcs.length;
		cbAll.indeterminate = selectedCount > 0 && selectedCount < npcs.length;
		cbAll.disabled = batch.isRolling || !npcs.length;
		cbAll.onn("change", evt => this._fnToggleAll(evt.currentTarget.checked));

		const wrpMembers = ee`<details class="dm-npc__batch-members" ${batch.isMembersExpanded ? "open" : ""}>
			<summary class="dm-npc__batch-members-header"><strong>Targets</strong><span>${selectedCount} of ${npcs.length} selected</span></summary>
			<div class="dm-npc__batch-select-all"><label>${cbAll}<span>Select all in scope</span></label></div>
			<div class="dm-npc__batch-member-list" role="list"></div>
		</details>`;
		wrpMembers.onn("toggle", () => batch.isMembersExpanded = wrpMembers.open);
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

	_renderEncounterOperations ({batch, selectedCount, hasHpUndo, conditionCatalog, wrp}) {
		const wrpOperations = ee`<details class="dm-npc__batch-operations" ${batch.isOperationsExpanded ? "open" : ""}>
			<summary><strong>Encounter actions</strong><span>HP and conditions for selected NPCs</span></summary>
			<div class="dm-npc__batch-operations-body"></div>
		</details>`;
		wrpOperations.onn("toggle", () => batch.isOperationsExpanded = wrpOperations.open);
		const body = wrpOperations.querySelector(".dm-npc__batch-operations-body");
		this._renderHpControls({batch, selectedCount, hasHpUndo, wrp: body});
		this._renderConditionControls({batch, selectedCount, conditionCatalog, wrp: body});
		wrpOperations.appendTo(wrp);
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

		ee`<section class="dm-npc__batch-operation dm-npc__batch-operation--hp">
			<div><strong>Hit points</strong><span class="dm-npc__batch-operation-help">Unsigned values deal damage; damage consumes temporary HP first.</span></div>
			<div class="dm-npc__batch-operation-controls">${input}<label class="dm-npc__batch-half">${cbHalf}<span>Half</span></label>${btnApply}${btnUndo}</div>
		</section>`.appendTo(wrp);
	}

	_renderConditionControls ({batch, selectedCount, conditionCatalog, wrp}) {
		const select = ee`<select class="ve-form-control ve-select ve-select-xs dm-npc__batch-condition-select" aria-label="Condition"></select>`;
		conditionCatalog.forEach(condition => {
			const option = ee`<option value="${condition.name}"></option>`;
			option.textContent = condition.label;
			option.appendTo(select);
		});
		const btnAdd = ee`<button class="ve-btn ve-btn-primary ve-btn-xs" type="button">Add</button>`
			.onn("click", () => this._fnUpdateCondition({condition: select.value, isAdd: true}));
		const btnRemove = ee`<button class="ve-btn ve-btn-default ve-btn-xs" type="button">Remove</button>`
			.onn("click", () => this._fnUpdateCondition({condition: select.value, isAdd: false}));
		btnAdd.disabled = btnRemove.disabled = batch.isRolling || !selectedCount;

		ee`<section class="dm-npc__batch-operation dm-npc__batch-operation--conditions">
			<div><strong>Conditions</strong><span class="dm-npc__batch-operation-help">Apply or remove a condition for every selected NPC.</span></div>
			<div class="dm-npc__batch-operation-controls">${select}${btnAdd}${btnRemove}</div>
		</section>`.appendTo(wrp);
	}

	_renderInitiativeHandoff ({batch, npcs, wrp}) {
		if (batch.rollType !== "initiative") return;
		const selectedIds = new Set(npcs.filter(npc => batch.selectedNpcIds.has(npc.id)).map(npc => npc.id));
		const resultIds = new Set(batch.results.filter(result => Number.isFinite(result.total)).map(result => result.npcId));
		const isComplete = !!selectedIds.size && [...selectedIds].every(id => resultIds.has(id));
		const button = ee`<button class="ve-btn ve-btn-success ve-btn-xs" type="button"></button>`;
		button.textContent = batch.isInitiativeSent ? "Sent to Initiative Tracker" : "Send to Initiative Tracker";
		button.disabled = batch.isRolling || batch.isInitiativeSent || !isComplete;
		button.title = isComplete ? "Append these rolled initiatives to an Initiative Tracker" : "Roll initiative for every selected NPC first";
		button.onn("click", () => this._fnSendInitiative());
		ee`<div class="dm-npc__batch-handoff">${button}</div>`.appendTo(wrp);
	}

	_getKeySelect (batch, skills) {
		if (batch.rollType === "initiative") return null;
		const values = batch.rollType === "skill"
			? skills
			: Parser.ABIL_ABVS.map(value => ({id: value, label: Parser.attAbvToFull(value)}));
		const select = ee`<select class="ve-form-control ve-select ve-select-xs" aria-label="Batch roll ability or skill"></select>`;
		values.forEach(value => {
			const option = ee`<option value="${value.id}"></option>`;
			option.textContent = value.label;
			option.appendTo(select);
		});
		select.value = batch.key;
		return select;
	}

	_getDefaultKey (rollType, skills) {
		if (rollType === "initiative") return null;
		if (rollType === "skill") return skills.find(it => it.name === "perception")?.id || skills[0]?.id || null;
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
