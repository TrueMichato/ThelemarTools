export function getNpcTrackerCanonicalConditionName (value) {
	const normalized = `${value ?? ""}`.trim().toLowerCase();
	return normalized || null;
}

export function getNpcTrackerConditionColor (condition, {conditionCatalog = []} = {}) {
	const catalogColor = conditionCatalog.find(it => it.name === condition)?.color;
	if (catalogColor) return catalogColor.startsWith("#") ? catalogColor : `#${catalogColor}`;
	const key = condition === "exhaustion" ? "Exhausted" : condition.toTitleCase();
	return Parser.CONDITION_TO_COLOR?.[key] || "#777777";
}

export function getNpcTrackerConditionsAfterUpdate ({conditions, condition, isAdd}) {
	const canonical = getNpcTrackerCanonicalConditionName(condition);
	const current = [...new Set((conditions || []).map(getNpcTrackerCanonicalConditionName).filter(Boolean))];
	if (!canonical) return current;
	if (isAdd) return current.includes(canonical) ? current : [...current, canonical];
	return current.filter(it => it !== canonical);
}

export function getNpcTrackerConditionPickerModel ({conditions, conditionCatalog = []}) {
	const active = getNpcTrackerConditionsAfterUpdate({
		conditions,
		condition: null,
		isAdd: true,
	});
	const labelByName = new Map(conditionCatalog.map(it => [it.name, it.label]));
	return {
		active: active.map(name => ({name, label: labelByName.get(name) || name.toTitleCase()})),
		available: conditionCatalog.filter(it => !active.includes(it.name)),
	};
}

export function getNpcTrackerConditionHoverMeta (condition, {conditionCatalog = []} = {}) {
	const canonical = getNpcTrackerCanonicalConditionName(condition);
	const catalogEntry = conditionCatalog.find(it => getNpcTrackerCanonicalConditionName(it.name) === canonical);
	if (!catalogEntry?.source) return null;
	return {
		page: UrlUtil.PG_CONDITIONS_DISEASES,
		source: catalogEntry.source,
		hash: UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CONDITIONS_DISEASES]({
			name: catalogEntry.label || catalogEntry.name,
			source: catalogEntry.source,
		}),
	};
}

export function getNpcTrackerConditionControls ({npc, fnUpdate, conditionCatalog = [], isCompact = false}) {
	const conditions = getNpcTrackerConditionsAfterUpdate({
		conditions: npc.conditions,
		condition: null,
		isAdd: true,
	});
	const picker = getNpcTrackerConditionPickerModel({conditions, conditionCatalog});
	const wrp = ee`<div class="dm-npc__conditions ${isCompact ? "dm-npc__conditions--compact" : ""}" aria-label="Conditions"></div>`;

	picker.active.forEach(({name: condition, label}) => {
		const button = ee`<button class="dm-npc__condition" type="button"></button>`;
		button.style.setProperty("--dm-npc-condition-color", getNpcTrackerConditionColor(condition, {conditionCatalog}));
		button.attr("aria-label", `Remove ${label} from ${npc.alias || npc.monster.name}`);
		const hoverMeta = getNpcTrackerConditionHoverMeta(condition, {conditionCatalog});
		if (hoverMeta) {
			button.classList.add("dm-npc__condition--hoverable");
			button.onn("mouseover", evt => Renderer.hover.pHandleLinkMouseOver(evt, button, {
				isSpecifiedLinkData: true,
				...hoverMeta,
			}).then(null));
			button.onn("mousemove", evt => Renderer.hover.handleLinkMouseMove(evt, button));
			button.onn("mouseleave", evt => Renderer.hover.handleLinkMouseLeave(evt, button));
		}
		const name = ee`<span></span>`;
		name.textContent = label;
		const remove = ee`<span class="dm-npc__condition-remove" aria-hidden="true">\u00d7</span>`;
		button.append(name, remove);
		button.onn("click", () => fnUpdate({npc, condition, isAdd: false}));
		button.appendTo(wrp);
	});

	const select = ee`<select class="ve-form-control ve-select ve-select-xs dm-npc__condition-add" aria-label="Add condition to ${npc.alias || npc.monster.name}">
		<option value="">${conditions.length ? "Add condition..." : "Add a condition..."}</option>
	</select>`;
	picker.available.forEach(condition => {
		const option = ee`<option value="${condition.name}"></option>`;
		option.textContent = condition.label;
		option.appendTo(select);
	});
	select.disabled = !picker.available.length;
	select.onn("change", evt => {
		const condition = evt.currentTarget.value;
		if (!condition) return;
		fnUpdate({npc, condition, isAdd: true});
	});
	select.appendTo(wrp);

	return wrp;
}
