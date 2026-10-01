import {MAX_ENCOUNTER_RESOURCE_COUNT} from "./encounterworkspace-resources.js";

const MAX_VISIBLE_PIPS = 12;
const MAX_INLINE_RESOURCES = 3;
const RESOURCE_SECTIONS = [
	["trait", "Traits"],
	["action", "Actions"],
	["bonus", "Bonus actions"],
	["reaction", "Reactions"],
	["legendary", "Legendary actions"],
	["mythic", "Mythic actions"],
	["equipment", "Equipment"],
	["other", "Other abilities"],
];

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

function getResourceSection (resource) {
	if (resource.id === "auto:legendary-actions") return "legendary";
	if (resource.id.startsWith("auto:equipment")) return "equipment";
	const section = resource.id.match(/^auto:(?:ability|recharge):(trait|action|bonus|reaction|legendary|mythic):/);
	return section?.[1] || "other";
}

function getPipRow ({name, current, max, resourceKey, onChange}) {
	const row = create("div", "ew__resource-row");
	const heading = create("strong", "ew__resource-name", name);
	const count = create("span", "ew__resource-count", `${current}/${max}`);
	count.setAttribute("aria-label", `${name}: ${current} of ${max} remaining`);
	const actions = create("div", "ew__resource-actions");
	if (max <= MAX_VISIBLE_PIPS) {
		for (let index = 0; index < max; index++) {
			const isAvailable = index < current;
			const pip = getButton("", `${name}, use ${index + 1} of ${max}: ${isAvailable ? "available; spend one" : "spent; restore one"}`,
				() => onChange(isAvailable ? -1 : 1), false, `${resourceKey}:pip:${index}`);
			pip.classList.add("ew__resource-pip");
			pip.classList.toggle("ew__resource-pip--available", isAvailable);
			actions.append(pip);
		}
	} else {
		actions.append(
			getButton("−", `Spend one ${name} use`, () => onChange(-1), !current, `${resourceKey}:spend`),
			getButton("+", `Restore one ${name} use`, () => onChange(1), current >= max, `${resourceKey}:restore`),
		);
	}
	row.append(heading, count, actions);
	return row;
}

export function getEncounterResourcePanel ({instance, label, onAction}) {
	const {resources} = instance;
	const section = create("section", "ew__resources");
	section.setAttribute("aria-label", `Combat resources for ${label}`);
	const header = create("div", "ew__resource-header");
	header.append(create("h4", "ew__resource-title", "Combat resources"));
	const concentration = getButton(
		resources.concentration.active ? `Concentrating${resources.concentration.label ? `: ${resources.concentration.label}` : ""}` : "Start concentration",
		`${label}: ${resources.concentration.active ? "end" : "start"} concentration${resources.concentration.label ? ` on ${resources.concentration.label}` : ""}`,
		() => onAction({kind: "concentration", active: !resources.concentration.active, label: ""}), false, "concentration:toggle",
	);
	concentration.classList.add("ew__concentration");
	concentration.classList.toggle("ew__concentration--active", resources.concentration.active);
	concentration.setAttribute("aria-pressed", String(resources.concentration.active));
	header.append(concentration);
	section.append(header);

	const tracker = create("div", "ew__resource-tracker");
	const slotEntries = Object.entries(resources.spellSlots).sort(([a], [b]) => Number(a) - Number(b));
	if (slotEntries.length) {
		const slots = create("div", "ew__resource-group");
		slots.append(create("h5", null, "Spell slots"));
		for (const [rawLevel, {current, max}] of slotEntries) {
			const level = Number(rawLevel);
			slots.append(getPipRow({
				name: `Level ${level}`,
				current,
				max,
				resourceKey: `slots:${level}`,
				onChange: change => onAction({kind: "slots", level, current: current + change, max}),
			}));
		}
		tracker.append(slots);
	}
	const grouped = new Map();
	for (const resource of [...resources.abilities, ...resources.recharges]) {
		const key = getResourceSection(resource);
		if (!grouped.has(key)) grouped.set(key, []);
		grouped.get(key).push(resource);
	}
	for (const [key, title] of RESOURCE_SECTIONS) {
		if (!grouped.has(key)) continue;
		const group = create("div", "ew__resource-group");
		group.append(create("h5", null, title));
		const entries = grouped.get(key);
		let more;
		if (entries.length > MAX_INLINE_RESOURCES) {
			more = create("details", "ew__resource-more");
			more.dataset.resourceKey = `more:${key}`;
			more.append(create("summary", null, `Show ${entries.length - MAX_INLINE_RESOURCES} more ${title.toLowerCase()} resources`));
		}
		for (const [index, resource] of entries.entries()) {
			let row;
			if (Object.hasOwn(resource, "ready")) {
				row = create("div", "ew__resource-row ew__resource-row--recharge");
				row.append(
					create("strong", "ew__resource-name", `${resource.name} (recharge ${resource.min}–6)`),
					create("span", "ew__resource-count", resource.ready ? "Ready" : "Spent"),
					getButton(resource.ready ? "Mark spent" : "Mark ready", `${resource.name}: mark ${resource.ready ? "spent" : "ready"}`,
						() => onAction({kind: "recharge", rechargeId: resource.id, ready: !resource.ready}), false, `recharge:${resource.id}:toggle`),
				);
			} else {
				row = getPipRow({
					...resource,
					resourceKey: `ability:${resource.id}`,
					onChange: change => onAction({kind: "abilityUse", abilityId: resource.id, change}),
				});
			}
			(index < MAX_INLINE_RESOURCES ? group : more).append(row);
		}
		if (more) group.append(more);
		tracker.append(group);
	}
	if (!tracker.children.length) tracker.append(create("p", "ew__resource-empty", "No counted uses yet. Add a spell level or ability below."));
	section.append(tracker);

	const manager = create("details", "ew__resource-manager");
	const overview = create("summary", "ew__resource-overview", "Manage counts and names");
	overview.dataset.resourceControl = "resources:toggle";
	manager.append(overview);
	const fieldset = create("fieldset", "ew__resource-fields");
	fieldset.append(create("legend", "ve-hidden", `Combat resources for ${label}`));

	const slots = create("div", "ew__resource-group");
	slots.append(create("h5", null, "Spell slots"));
	for (const [rawLevel, {current, max}] of slotEntries) {
		const level = Number(rawLevel);
		const name = `Level ${level} spell slot`;
		slots.append(getEditForm({
			name,
			current,
			max,
			resourceKey: `slots:${level}`,
			onSave: values => onAction({kind: "slots", level, ...values}),
			onRemove: () => onAction({kind: "removeSlots", level}),
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
		abilities.append(getEditForm({
			...ability,
			resourceKey: `ability:${ability.id}`,
			isNameEditable: true,
			onSave: values => onAction({kind: "ability", ability: {id: ability.id, ...values}}),
			onRemove: () => onAction({kind: "removeAbility", abilityId: ability.id}),
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

	const concentrationEdit = create("div", "ew__resource-group ew__resource-concentration");
	if (resources.concentration.active) {
		concentrationEdit.append(create("h5", null, "Concentration label"));
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
		concentrationEdit.append(form);
	}
	fieldset.append(slots, abilities);
	if (resources.concentration.active) fieldset.append(concentrationEdit);
	manager.append(fieldset);
	section.append(manager);
	return section;
}
