import {MAX_ENCOUNTER_RESOURCE_COUNT} from "./encounterworkspace-resources.js";

const create = (tag, className, text) => {
	const element = document.createElement(tag);
	if (className) element.className = className;
	if (text != null) element.textContent = text;
	return element;
};

function getButton (text, label, onClick, disabled = false, controlKey = null) {
	const button = create("button", "ew__resource-button ve-btn ve-btn-default", text);
	button.type = "button";
	button.setAttribute("aria-label", label);
	button.disabled = disabled;
	button.dataset.resourceDisabled = String(disabled);
	if (controlKey) button.dataset.resourceControl = controlKey;
	button.addEventListener("click", onClick);
	return button;
}

function getField (text, {type = "number", value = "", min = 0, max = MAX_ENCOUNTER_RESOURCE_COUNT, controlKey = null} = {}) {
	const label = create("label", "ew__resource-field", text);
	const input = create("input", "ve-form-control");
	input.type = type;
	input.value = value;
	if (controlKey) input.dataset.resourceControl = controlKey;
	input.required = type === "number";
	if (type === "number") {
		input.min = min;
		input.max = max;
		input.step = 1;
	}
	if (type === "text") input.maxLength = 120;
	label.append(input);
	return {label, input};
}

function getNumber (input) {
	return /^\d+$/.test(input.value) ? Number(input.value) : NaN;
}

function getEditForm ({name, current, max, resourceKey, isNameEditable, onSave, onRemove}) {
	const details = create("details", "ew__resource-edit");
	details.dataset.resourceKey = resourceKey;
	const summary = create("summary", null, `Edit ${name}`);
	summary.dataset.resourceControl = `${resourceKey}:edit`;
	details.append(summary);
	const form = create("form", "ew__resource-form");
	let nameField;
	if (isNameEditable) {
		nameField = getField("Ability name", {type: "text", value: name, controlKey: `${resourceKey}:name`});
		nameField.input.required = true;
		form.append(nameField.label);
	}
	const currentField = getField("Remaining", {value: current, controlKey: `${resourceKey}:current`});
	const maxField = getField("Maximum", {value: max, min: 1, controlKey: `${resourceKey}:max`});
	const save = create("button", "ew__resource-button ve-btn ve-btn-primary", "Save");
	save.type = "submit";
	save.dataset.resourceControl = `${resourceKey}:save`;
	form.append(currentField.label, maxField.label, save);
	if (onRemove) form.append(getButton("Remove", `Stop tracking ${name}`, onRemove, false, `${resourceKey}:remove`));
	form.addEventListener("submit", event => {
		event.preventDefault();
		onSave({name: nameField ? nameField.input.value.trim() : name, current: getNumber(currentField.input), max: getNumber(maxField.input)});
	});
	details.append(form);
	return details;
}

function getCounterRow ({name, current, max, resourceKey, onSpend, onRestore, edit}) {
	const row = create("div", "ew__resource-row");
	const heading = create("strong", "ew__resource-name", name);
	const count = create("span", "ew__resource-count", `${current}/${max}`);
	count.setAttribute("aria-label", `${name}: ${current} of ${max} remaining`);
	const actions = create("div", "ew__resource-actions");
	actions.append(
		getButton("−", `Spend one ${name} use`, onSpend, !current, `${resourceKey}:spend`),
		getButton("+", `Restore one ${name} use`, onRestore, current >= max, `${resourceKey}:restore`),
	);
	row.append(heading, count, actions, edit);
	return row;
}

export function getEncounterResourcePanel ({instance, label, onAction}) {
	const {resources} = instance;
	const section = create("section", "ew__resources");
	section.setAttribute("aria-label", `Combat resources for ${label}`);
	const title = create("h4", "ew__resource-title", "Combat resources");
	title.tabIndex = -1;
	section.append(title);
	const fieldset = create("fieldset", "ew__resource-fields");
	fieldset.append(create("legend", "ve-hidden", `Combat resources for ${label}`));

	const slots = create("div", "ew__resource-group");
	slots.append(create("h5", null, "Spell slots"));
	for (const [rawLevel, {current, max}] of Object.entries(resources.spellSlots)) {
		const level = Number(rawLevel);
		const name = `Level ${level} spell slot`;
		slots.append(getCounterRow({
			name,
			current,
			max,
			resourceKey: `slots:${level}`,
			onSpend: () => onAction({kind: "slots", level, current: current - 1, max}),
			onRestore: () => onAction({kind: "slots", level, current: current + 1, max}),
			edit: getEditForm({
				name,
				current,
				max,
				resourceKey: `slots:${level}`,
				onSave: values => onAction({kind: "slots", level, ...values}),
				onRemove: () => onAction({kind: "removeSlots", level}),
			}),
		}));
	}
	if (!Object.keys(resources.spellSlots).length) slots.append(create("p", "ew__resource-empty", "No spell slots tracked."));
	const untracked = Array.from({length: 9}, (_, index) => index + 1).filter(level => !resources.spellSlots[level]);
	if (untracked.length) {
		const add = create("details", "ew__resource-edit");
		add.dataset.resourceKey = "slots:add";
		const summary = create("summary", null, "Add spell level");
		summary.dataset.resourceControl = "slots:add:edit";
		add.append(summary);
		const form = create("form", "ew__resource-form");
		const levelLabel = create("label", "ew__resource-field", "Spell level");
		const levelSelect = create("select", "ve-form-control");
		levelSelect.dataset.resourceControl = "slots:add:level";
		untracked.forEach(level => levelSelect.add(new Option(`Level ${level}`, String(level))));
		levelLabel.append(levelSelect);
		const current = getField("Remaining", {value: 1, controlKey: "slots:add:current"});
		const max = getField("Maximum", {value: 1, min: 1, controlKey: "slots:add:max"});
		const submit = create("button", "ew__resource-button ve-btn ve-btn-primary", "Add level");
		submit.type = "submit";
		submit.dataset.resourceControl = "slots:add:save";
		form.append(levelLabel, current.label, max.label, submit);
		form.addEventListener("submit", event => {
			event.preventDefault();
			onAction({kind: "slots", level: Number(levelSelect.value), current: getNumber(current.input), max: getNumber(max.input)});
		});
		add.append(form);
		slots.append(add);
	}

	const abilities = create("div", "ew__resource-group");
	abilities.append(create("h5", null, "Limited-use abilities"));
	for (const ability of resources.abilities) {
		abilities.append(getCounterRow({
			...ability,
			resourceKey: `ability:${ability.id}`,
			onSpend: () => onAction({kind: "abilityUse", abilityId: ability.id, change: -1}),
			onRestore: () => onAction({kind: "abilityUse", abilityId: ability.id, change: 1}),
			edit: getEditForm({
				...ability,
				resourceKey: `ability:${ability.id}`,
				isNameEditable: true,
				onSave: values => onAction({kind: "ability", ability: {id: ability.id, ...values}}),
				onRemove: () => onAction({kind: "removeAbility", abilityId: ability.id}),
			}),
		}));
	}
	if (!resources.abilities.length) abilities.append(create("p", "ew__resource-empty", "No uses listed; add one for an ability described only in prose."));
	const addAbility = create("details", "ew__resource-edit");
	addAbility.dataset.resourceKey = "ability:add";
	const addSummary = create("summary", null, "Add limited-use ability");
	addSummary.dataset.resourceControl = "ability:add:edit";
	addAbility.append(addSummary);
	const addForm = create("form", "ew__resource-form");
	const name = getField("Ability name", {type: "text", controlKey: "ability:add:name"});
	name.input.required = true;
	const current = getField("Remaining", {value: 1, controlKey: "ability:add:current"});
	const max = getField("Maximum", {value: 1, min: 1, controlKey: "ability:add:max"});
	const addButton = create("button", "ew__resource-button ve-btn ve-btn-primary", "Add ability");
	addButton.type = "submit";
	addButton.dataset.resourceControl = "ability:add:save";
	addForm.append(name.label, current.label, max.label, addButton);
	addForm.addEventListener("submit", event => {
		event.preventDefault();
		onAction({
			kind: "ability",
			ability: {id: `manual:${CryptUtil.uid()}`, name: name.input.value.trim(), current: getNumber(current.input), max: getNumber(max.input)},
		});
	});
	addAbility.append(addForm);
	abilities.append(addAbility);

	const recharges = create("div", "ew__resource-group");
	recharges.append(create("h5", null, "Recharge abilities"));
	for (const recharge of resources.recharges) {
		const row = create("div", "ew__resource-row");
		row.append(
			create("strong", "ew__resource-name", `${recharge.name} (recharge ${recharge.min}–6)`),
			create("span", "ew__resource-count", recharge.ready ? "Ready" : "Spent"),
			getButton(recharge.ready ? "Mark spent" : "Mark ready", `${recharge.name}: mark ${recharge.ready ? "spent" : "ready"}`,
				() => onAction({kind: "recharge", rechargeId: recharge.id, ready: !recharge.ready}), false, `recharge:${recharge.id}:toggle`),
		);
		recharges.append(row);
	}
	if (!resources.recharges.length) recharges.append(create("p", "ew__resource-empty", "No tagged recharge abilities."));

	const concentration = create("div", "ew__resource-group ew__resource-concentration");
	concentration.append(create("h5", null, "Concentration"));
	const toggle = getButton(resources.concentration.active ? "End concentration" : "Mark concentrating",
		`${label}: ${resources.concentration.active ? "end" : "start"} concentration`,
		() => onAction({kind: "concentration", active: !resources.concentration.active, label: ""}), false, "concentration:toggle");
	toggle.setAttribute("aria-pressed", String(resources.concentration.active));
	concentration.append(toggle);
	if (resources.concentration.active) {
		const form = create("form", "ew__resource-form");
		const field = getField("Spell or effect (optional)", {type: "text", value: resources.concentration.label, controlKey: "concentration:label"});
		const button = create("button", "ew__resource-button ve-btn ve-btn-default", "Save label");
		button.type = "submit";
		button.dataset.resourceControl = "concentration:save";
		form.append(field.label, button);
		form.addEventListener("submit", event => {
			event.preventDefault();
			onAction({kind: "concentration", active: true, label: field.input.value.trim()});
		});
		concentration.append(form);
	}
	fieldset.append(slots, abilities, recharges, concentration);
	section.append(fieldset);
	return section;
}
