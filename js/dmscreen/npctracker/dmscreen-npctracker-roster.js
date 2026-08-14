const _SEARCH_INDEX_NAME = "entity_NpcTrackerCreatures";

export function getNpcTrackerImportedMonsters (json) {
	const parsed = typeof json === "string" ? JSON.parse(json) : json;
	const candidates = Array.isArray(parsed)
		? parsed
		: Array.isArray(parsed?.monster)
			? parsed.monster
			: parsed?.name && parsed?.source
				? [parsed]
				: [];

	if (!candidates.length) throw new Error("The file does not contain a creature or a monster array.");

	const invalid = candidates.find(monster => !monster?.name || !monster?.source);
	if (invalid) throw new Error("Every imported creature requires a name and source.");

	return candidates;
}

export class NpcTrackerRoster {
	constructor (
		{
			fnGetState,
			fnSelect,
			fnAdd,
			fnImport,
			fnUpdateNpc,
			fnRemove,
			fnToggleIncludeAll,
			fnAddGroup,
			fnRenameGroup,
			fnRemoveGroup,
			fnToggleGroup,
			fnToggleUnsorted,
			fnAssignGroup,
			fnOpenBatch,
		},
	) {
		this._fnGetState = fnGetState;
		this._fnSelect = fnSelect;
		this._fnAdd = fnAdd;
		this._fnImport = fnImport;
		this._fnUpdateNpc = fnUpdateNpc;
		this._fnRemove = fnRemove;
		this._fnToggleIncludeAll = fnToggleIncludeAll;
		this._fnAddGroup = fnAddGroup;
		this._fnRenameGroup = fnRenameGroup;
		this._fnRemoveGroup = fnRemoveGroup;
		this._fnToggleGroup = fnToggleGroup;
		this._fnToggleUnsorted = fnToggleUnsorted;
		this._fnAssignGroup = fnAssignGroup;
		this._fnOpenBatch = fnOpenBatch;
	}

	render (wrp) {
		wrp.empty();
		const state = this._fnGetState();

		const btnAdd = ee`<button class="ve-btn ve-btn-primary ve-btn-xs" type="button">
			<span class="glyphicon glyphicon-plus" aria-hidden="true"></span> Add NPC
		</button>`.onn("click", () => this._fnAdd());

		const iptImport = ee`<input class="ve-hidden" type="file" accept=".json,application/json" aria-hidden="true">`
			.onn("change", async evt => {
				const file = evt.currentTarget.files?.[0];
				evt.currentTarget.value = "";
				if (file) await this._fnImport(file);
			});
		const btnImport = ee`<button class="ve-btn ve-btn-default ve-btn-xs" type="button" title="Import bestiary-compatible NPC JSON">
			<span class="glyphicon glyphicon-import" aria-hidden="true"></span> Import
		</button>`.onn("click", () => iptImport.click());
		const btnAddGroup = ee`<button class="ve-btn ve-btn-default ve-btn-xs" type="button">
			<span class="glyphicon glyphicon-folder-open" aria-hidden="true"></span> New Group
		</button>`.onn("click", () => this._fnAddGroup());
		const btnRollAll = ee`<button class="ve-btn ve-btn-default ve-btn-xs" type="button" title="Batch roll for all NPCs">
			<span class="glyphicon glyphicon-random" aria-hidden="true"></span> Roll All
		</button>`.onn("click", () => this._fnOpenBatch({type: "all"}));
		btnRollAll.disabled = !state.npcs.length;

		const cbAll = ee`<input type="checkbox" ${state.settings.isIncludeAllCreatures ? "checked" : ""} aria-label="Include non-NPC creatures">`
			.onn("change", evt => this._fnToggleIncludeAll(evt.currentTarget.checked));

		const eleCount = ee`<span class="dm-npc__count"></span>`;
		eleCount.textContent = `${state.npcs.length} ${state.npcs.length === 1 ? "NPC" : "NPCs"}`;

		ee`<div class="dm-npc__roster-toolbar">
			<div class="ve-btn-group">${btnAdd}${btnImport}${btnAddGroup}${btnRollAll}</div>
			${iptImport}
			${eleCount}
			<label class="dm-npc__all-toggle">${cbAll}<span>All creatures</span></label>
		</div>`.appendTo(wrp);

		const wrpRows = ee`<div class="dm-npc__roster-rows" role="listbox" aria-label="NPC roster"></div>`.appendTo(wrp);
		if (!state.npcs.length && !state.groups.length) {
			ee`<div class="dm-npc__roster-empty">
				<strong>Your cast is empty</strong>
				<span>Add an NPC from the bestiary or import NPC JSON.</span>
			</div>`.appendTo(wrpRows);
			return;
		}

		state.groups.forEach(group => this._renderGroup({
			group,
			npcs: state.npcs.filter(npc => npc.groupId === group.id),
			state,
			wrp: wrpRows,
		}));
		const unsorted = state.npcs.filter(npc => !npc.groupId);
		if (unsorted.length || !state.groups.length) {
			this._renderGroup({
				group: null,
				npcs: unsorted,
				state,
				wrp: wrpRows,
			});
		}
	}

	async pChooseCreature ({isIncludeAllCreatures}) {
		await this._pLoadSearchIndex();
		return SearchWidget.pGetUserEntitySearch(
			isIncludeAllCreatures ? "Select Creature" : "Select NPC",
			_SEARCH_INDEX_NAME,
			{
				fnFilterResults: doc => isIncludeAllCreatures || !!doc.isNpc,
				fnTransform: doc => ({
					...MiscUtil.copyFast(doc),
					...SearchWidget.docToPageSourceHash(doc),
				}),
			},
		);
	}

	_renderGroup ({group, npcs, state, wrp}) {
		const isCollapsed = group ? group.isCollapsed : state.settings.isUnsortedCollapsed;
		const btnToggle = ee`<button class="dm-npc__group-toggle" type="button" aria-expanded="${!isCollapsed}"></button>`;
		btnToggle.innerHTML = `<span class="glyphicon glyphicon-chevron-${isCollapsed ? "right" : "down"}" aria-hidden="true"></span>`;
		btnToggle.onn("click", () => group ? this._fnToggleGroup(group.id) : this._fnToggleUnsorted());
		const eleName = ee`<strong class="dm-npc__group-name"></strong>`;
		eleName.textContent = group?.name || "Unsorted";
		const eleCount = ee`<span class="dm-npc__group-count"></span>`;
		eleCount.textContent = npcs.length;
		const btnRoll = ee`<button class="ve-btn ve-btn-default ve-btn-xxs" type="button" title="Batch roll this group">
			<span class="glyphicon glyphicon-random" aria-hidden="true"></span>
		</button>`.onn("click", () => this._fnOpenBatch(group ? {type: "group", groupId: group.id} : {type: "unsorted"}));
		btnRoll.attr("aria-label", `Batch roll ${group?.name || "Unsorted"}`);
		btnRoll.disabled = !npcs.length;
		const btnRename = group
			? ee`<button class="ve-btn ve-btn-default ve-btn-xxs" type="button" title="Rename group">
				<span class="glyphicon glyphicon-pencil" aria-hidden="true"></span>
			</button>`
				.attr("aria-label", `Rename ${group.name}`)
				.onn("click", () => this._fnRenameGroup(group.id))
			: null;
		const btnRemove = group
			? ee`<button class="ve-btn ve-btn-danger ve-btn-xxs" type="button" title="Delete group">
				<span class="glyphicon glyphicon-trash" aria-hidden="true"></span>
			</button>`
				.attr("aria-label", `Delete ${group.name}`)
				.onn("click", () => this._fnRemoveGroup(group.id))
			: null;
		const wrpGroup = ee`<section class="dm-npc__group">
			<div class="dm-npc__group-header">${btnToggle}${eleName}${eleCount}<div class="dm-npc__group-actions">${btnRoll}${btnRename}${btnRemove}</div></div>
			<div class="dm-npc__group-rows"></div>
		</section>`;
		const wrpGroupRows = wrpGroup.querySelector(".dm-npc__group-rows");
		if (isCollapsed) wrpGroupRows.classList.add("ve-hidden");
		else if (!npcs.length) ee`<div class="dm-npc__group-empty">Assign an NPC to this group.</div>`.appendTo(wrpGroupRows);
		else {
			npcs.forEach(npc => this._renderRow({
				npc,
				state,
				wrp: wrpGroupRows,
				isSelected: npc.id === state.settings.selectedId,
			}));
		}
		wrpGroup.appendTo(wrp);
	}

	_renderRow ({npc, state, wrp, isSelected}) {
		const mon = npc.monster;
		const btnSelect = ee`<button class="dm-npc__roster-select" type="button" role="option" aria-selected="${isSelected}"></button>`
			.onn("click", () => this._fnSelect(npc.id));
		const eleName = ee`<span class="dm-npc__roster-name"></span>`;
		eleName.textContent = npc.alias || mon.name;
		const eleMeta = ee`<span class="dm-npc__roster-meta"></span>`;
		eleMeta.textContent = [
			npc.alias ? mon.name : null,
			mon.source ? Parser.sourceJsonToAbv(mon.source) : null,
			mon.cr != null ? `CR ${mon.cr.cr || mon.cr}` : null,
		].filter(Boolean).join(" · ");
		eleName.appendTo(btnSelect);
		eleMeta.appendTo(btnSelect);

		const iptAlias = ee`<input class="ve-form-control ve-input-xs dm-npc__alias" type="text" placeholder="Alias" aria-label="NPC alias">`;
		iptAlias.value = npc.alias;
		iptAlias.onn("change", evt => this._fnUpdateNpc({npc, prop: "alias", value: evt.currentTarget.value}));
		const selGroup = ee`<select class="ve-form-control ve-select ve-select-xs dm-npc__group-select" aria-label="NPC group"></select>`;
		const optUnsorted = ee`<option value="">Unsorted</option>`.appendTo(selGroup);
		state.groups.forEach(group => {
			const option = ee`<option value="${group.id}"></option>`;
			option.textContent = group.name;
			option.appendTo(selGroup);
		});
		selGroup.value = npc.groupId || optUnsorted.value;
		selGroup.onn("change", evt => this._fnAssignGroup({npc, groupId: evt.currentTarget.value || null}));

		const getHpInput = ({prop, value, label}) => ee`<input class="ve-form-control ve-input-xs dm-npc__roster-hp-input" type="number" min="0" value="${value}" aria-label="${label}">`
			.onn("change", evt => this._fnUpdateNpc({npc, prop: `hp.${prop}`, value: evt.currentTarget.value}));

		const btnRemove = ee`<button class="ve-btn ve-btn-danger ve-btn-xxs" type="button" title="Remove NPC" aria-label="Remove NPC">
			<span class="glyphicon glyphicon-trash" aria-hidden="true"></span>
		</button>`.onn("click", evt => {
				evt.stopPropagation();
				if (confirm(`Remove "${npc.alias || mon.name}" from the roster?`)) this._fnRemove(npc.id);
			});

		const row = ee`<div class="dm-npc__roster-row ${isSelected ? "dm-npc__roster-row--selected" : ""}" role="presentation">
			${btnSelect}
			${btnRemove}
			<div class="dm-npc__roster-edit">
				${iptAlias}
				${selGroup}
				<div class="dm-npc__roster-hp">
					<span>HP</span>
					${getHpInput({prop: "current", value: npc.hp.current, label: "Current hit points"})}
					<span>/</span>
					${getHpInput({prop: "max", value: npc.hp.max, label: "Maximum hit points"})}
					<span>+T</span>
					${getHpInput({prop: "temp", value: npc.hp.temp, label: "Temporary hit points"})}
				</div>
			</div>
		</div>`;
		row.appendTo(wrp);
	}

	async _pLoadSearchIndex () {
		return SearchWidget.pLoadCustomIndex({
			contentIndexName: _SEARCH_INDEX_NAME,
			errorName: "NPCs",
			customIndexSubSpecs: [
				new SearchWidget.CustomIndexSubSpec({
					dataSource: async () => ({monster: await DataLoader.pCacheAndGetAllSite(UrlUtil.PG_BESTIARY)}),
					prop: "monster",
					catId: Parser.CAT_ID_CREATURE,
					page: UrlUtil.PG_BESTIARY,
					pFnGetDocExtras: ({ent}) => ({isNpc: !!ent.isNpc}),
				}),
			],
		});
	}
}
