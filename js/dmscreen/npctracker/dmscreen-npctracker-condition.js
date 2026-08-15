export function getNpcTrackerCanonicalConditionName (value) {
	const normalized = `${value ?? ""}`.trim().toLowerCase();
	return Parser.CONDITIONS.includes(normalized) ? normalized : null;
}

export function getNpcTrackerConditionColor (condition) {
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

export function getNpcTrackerConditionControls ({npc, fnUpdate, isCompact = false}) {
	const conditions = getNpcTrackerConditionsAfterUpdate({
		conditions: npc.conditions,
		condition: null,
		isAdd: true,
	});
	const wrp = ee`<div class="dm-npc__conditions ${isCompact ? "dm-npc__conditions--compact" : ""}" aria-label="Conditions"></div>`;

	conditions.forEach(condition => {
		const button = ee`<button class="dm-npc__condition" type="button"></button>`;
		button.style.setProperty("--dm-npc-condition-color", getNpcTrackerConditionColor(condition));
		button.attr("aria-label", `Remove ${condition.toTitleCase()} from ${npc.alias || npc.monster.name}`);
		const name = ee`<span></span>`;
		name.textContent = condition.toTitleCase();
		const remove = ee`<span class="dm-npc__condition-remove" aria-hidden="true">\u00d7</span>`;
		button.append(name, remove);
		button.onn("click", () => fnUpdate({npc, condition, isAdd: false}));
		button.appendTo(wrp);
	});

	const available = Parser.CONDITIONS.filter(condition => !conditions.includes(condition));
	const select = ee`<select class="ve-form-control ve-select ve-select-xs dm-npc__condition-add" aria-label="Add condition to ${npc.alias || npc.monster.name}">
		<option value="">${conditions.length ? "Add condition..." : "Add a condition..."}</option>
	</select>`;
	available.forEach(condition => {
		const option = ee`<option value="${condition}"></option>`;
		option.textContent = condition.toTitleCase();
		option.appendTo(select);
	});
	select.disabled = !available.length;
	select.onn("change", evt => {
		const condition = evt.currentTarget.value;
		if (!condition) return;
		fnUpdate({npc, condition, isAdd: true});
	});
	select.appendTo(wrp);

	return wrp;
}
