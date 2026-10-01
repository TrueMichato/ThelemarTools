import {createCreatureTransformationChanges, previewCreatureTransformationTargets} from "./bestiary-transformation-workflow.js";

let nextOptionGroupId = 0;

function element (tag, {className, text} = {}) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text != null) node.textContent = text;
	return node;
}

function button (text, onClick, className = "ve-btn ve-btn-default ve-btn-sm") {
	const node = element("button", {className, text});
	node.type = "button";
	node.addEventListener("click", onClick);
	return node;
}

function paragraph (parent, text) {
	const node = element("p", {text});
	parent.append(node);
	return node;
}

function list (parent, items) {
	const ul = element("ul");
	items.forEach(text => ul.append(element("li", {text})));
	parent.append(ul);
	return ul;
}

function describeEligibility (rule) {
	const parts = [];
	if (rule.types) parts.push(`Type: ${rule.types.join(" or ")}`);
	if (rule.sizes) parts.push(`Size: ${rule.sizes.map(it => Parser.sizeAbvToFull(it)).join(" or ")}`);
	if (rule.minCr != null) parts.push(`CR at least ${rule.minCr}`);
	if (rule.maxCr != null) parts.push(`CR at most ${rule.maxCr}`);
	if (rule.minInt != null) parts.push(`Intelligence at least ${rule.minInt}`);
	if (rule.maxInt != null) parts.push(`Intelligence at most ${rule.maxInt}`);
	if (rule.requiresTrait) parts.push(`Requires trait: ${rule.requiresTrait}`);
	if (rule.dmApproval) parts.push("DM approval required");
	return parts.join("; ") || "No mechanical restriction";
}

function describeChange (step) {
	switch (step.op) {
		case "setType": return `Set type to ${step.value}`;
		case "setSize": return `Set size to ${Parser.sizeAbvToFull(step.value)}`;
		case "setAbility": return `Set ${Parser.attAbvToFull(step.ability)} to ${step.value}`;
		case "minimumAbility": return `${Parser.attAbvToFull(step.ability)} at least ${step.value}`;
		case "maximumAbility": return `${Parser.attAbvToFull(step.ability)} at most ${step.value}`;
		case "adjustAbility": return `Adjust ${Parser.attAbvToFull(step.ability)} by ${step.amount}`;
		case "scaleAbility": return `Halve ${Parser.attAbvToFull(step.ability)}, rounding down (minimum 1)`;
		case "grantResistance": return `Resistance to ${step.value}`;
		case "grantImmunity": return `Immunity to ${step.value}`;
		case "grantVulnerability": return `Vulnerability to ${step.value}`;
		case "grantConditionImmunity": return `Immunity to ${step.value}`;
		case "grantSense": return `${step.sense} ${step.range} ft.`;
		case "grantSpeed": return `${step.mode} speed ${step.feet} ft.`;
		case "grantLanguage": return `Speak ${step.value}`;
		case "grantSpell": {
			const [name, source] = step.spell.split("|");
			return `Grant ${name} (${source}) from ${step.source}, ${step.usage}${step.uses == null ? "" : ` · ${step.uses} use${step.uses === 1 ? "" : "s"}`}${step.ability ? ` · ${Parser.attAbvToFull(step.ability)}` : ""}`;
		}
		case "grantConditionalDefense": return `${step.kind} to ${step.value} (${{
			nonmagical: "nonmagical damage",
			nonmagicalUnsilvered: "nonmagical, unsilvered damage",
			dimLightOrDarkness: "in dim light or darkness",
		}[step.when]})`;
		case "addEntry": return `Add ${step.section} ${step.entry.name} (${step.entry.source})`;
		case "removeEntry": return `Remove ${step.section} ${step.match.name || step.match.role} (${step.match.source})`;
		case "replaceEntry": return `Replace ${step.section} ${step.match.name || step.match.role} with ${step.entry.name} (${step.entry.source})`;
		case "replaceDamageType": return `Change ${step.section} ${step.match.name || step.match.role} damage to ${step.to}`;
		default: throw new Error(`Unknown transformation change: ${step.op}`);
	}
}

function getChangeHoverEntries (changes) {
	return changes.flatMap(step => step.entry?.entries?.length
		? [describeChange(step), {type: "entries", name: `${step.entry.name} (${step.entry.source})`, entries: step.entry.entries}]
		: [describeChange(step)]);
}

function bindInfoHover ({name, entries, targets}) {
	const hover = Renderer.hover.getMakePredefinedHover({type: "entries", name, entries: MiscUtil.copyFast(entries)}, {isBookContent: false});
	for (const node of targets) {
		node.addEventListener("mouseover", evt => hover.mouseOver(evt, node));
		node.addEventListener("mousemove", evt => hover.mouseMove(evt, node));
		node.addEventListener("mouseleave", evt => hover.mouseLeave(evt, node));
		node.addEventListener("focus", () => {
			if (!node.matches(":focus-visible")) return;
			const bounds = node.getBoundingClientRect();
			node.dispatchEvent(new MouseEvent("mouseover", {clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2, view: window}));
		});
		node.addEventListener("blur", () => node.dispatchEvent(new MouseEvent("mouseleave")));
		node.addEventListener("touchstart", evt => hover.touchStart(evt, node), {passive: true});
	}
	return hover;
}

function makeInfoButton ({name, entries, targets = []}) {
	const info = button("ⓘ", () => hover.show(), "bqa__transformation-info bqa__entity-link ve-help ve-help--hover");
	info.setAttribute("aria-label", `Details for ${name}`);
	info.title = `View ${name} details`;
	const hover = bindInfoHover({name, entries, targets: [info, ...targets]});
	return info;
}

function describeProvenance (candidate, sourceLabel) {
	const {edition, page, evidence} = candidate.provenance;
	return `${sourceLabel(candidate.identity.source)} · ${edition === "unverified" ? "Edition unverified" : edition === "one" ? "2024 edition" : "2014 edition"} · ${page == null ? "Page unverified" : `p. ${page}`}${evidence === "user-screenshot" ? " · Source attribution unverified (user-supplied screenshot)" : ""}.`;
}

function getOptionDetailsEntries (option) {
	return [
		`Eligibility: ${describeEligibility(option.eligibility || {})}.`,
		option.changes.length
			? {type: "entries", name: "Automatic mechanical effects", entries: getChangeHoverEntries(option.changes)}
			: "No automatic mechanical change.",
		option.manualReview.length
			? {type: "entries", name: "DM review (not applied automatically)", entries: option.manualReview.map(it => `${it.field}: ${it.reason}`)}
			: "No additional DM review for this choice.",
	];
}

export function getCreatureTransformationOptionHoverEntries ({candidate, group, option, sourceLabel}) {
	return [
		`${candidate.identity.name} (${candidate.identity.source}) · ${group.name} · ${option.name}.`,
		describeProvenance(candidate, sourceLabel),
		`Recipe eligibility: ${describeEligibility(candidate.eligibility)}.`,
		...getOptionDetailsEntries(option),
	];
}

export function getCreatureTransformationGroupHoverEntries ({candidate, group, sourceLabel}) {
	const appliesTo = group.appliesTo && candidate.optionGroups
		.find(it => it.id === group.appliesTo.group)?.options.find(it => it.id === group.appliesTo.option)?.name;
	return [
		describeProvenance(candidate, sourceLabel),
		`Selection: ${group.selection === "one" ? "Choose one" : "Choose any number"}; ${group.required ? "required before preview" : "optional"}.`,
		`Available choices: ${group.options.map(it => it.name).join(", ")}. Hover an option name or use its info button for individual rules.`,
		`Recipe eligibility: ${describeEligibility(candidate.eligibility)}.`,
		...(appliesTo ? [`Available when ${appliesTo} is selected.`] : []),
		...(candidate.prerequisites.length ? [{type: "entries", name: "DM prerequisites", entries: candidate.prerequisites}] : []),
		{
			type: "entries",
			name: "Options",
			entries: group.options.map(option => ({
				type: "entries",
				name: option.name,
				entries: getOptionDetailsEntries(option),
			})),
		},
	];
}

function getRecipeHoverEntries (candidate, sourceLabel) {
	return [
		describeProvenance(candidate, sourceLabel),
		`Eligibility: ${describeEligibility(candidate.eligibility)}.`,
		...(candidate.prerequisites.length ? [{type: "entries", name: "DM prerequisites", entries: candidate.prerequisites}] : []),
		...(candidate.changes.length ? [{type: "entries", name: "Mechanical effects", entries: getChangeHoverEntries(candidate.changes)}] : []),
		...(candidate.manualReview.length ? [{type: "entries", name: "Manual review", entries: candidate.manualReview.map(it => `${it.field}: ${it.reason}`)}] : []),
	];
}

function renderStatblock (parent, creature, heading) {
	const details = element("details", {className: "bqa__transformation-statblock"});
	details.open = true;
	const summary = element("summary", {text: heading});
	const table = element("table", {className: "ve-w-100 ve-stats"});
	const tbody = element("tbody");
	tbody.innerHTML = Renderer.monster.getCompactRenderedString(MiscUtil.copyFast(creature), {isShowScalers: false});
	table.addEventListener("click", event => {
		event.preventDefault();
		event.stopPropagation();
	}, true);
	tbody.querySelectorAll("button, a, [data-packed-dice]").forEach(node => { node.tabIndex = -1; });
	table.append(tbody);
	details.append(summary, table);
	parent.append(details);
}

function renderDiff (parent, diff) {
	const changes = [...diff.fields.map(({path, before, after}) => `${path}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`),
		...diff.entries.map(({section, name, source, before, after}) =>
			`${section}: ${name} (${source || "chassis"}): ${before ? JSON.stringify(before.entries) : "not present"} → ${after ? JSON.stringify(after.entries) : "removed"}`)];
	const details = element("details", {className: "bqa__transformation-diff"});
	details.append(element("summary", {text: `Mechanical diff · ${changes.length} changed field${changes.length === 1 ? "" : "s"}`}));
	if (changes.length) list(details, changes);
	else paragraph(details, "No mechanically representable fields change. Manual review may still be required.");
	parent.append(details);
}

const DELTA_FIELD_NAMES = {
	type: "Creature type",
	size: "Size",
	resist: "Damage resistances",
	immune: "Damage immunities",
	vulnerable: "Damage vulnerabilities",
	conditionImmune: "Condition immunities",
	senses: "Senses",
	languages: "Languages",
	speed: "Speed",
};

const DELTA_ENTRY_NAMES = {
	trait: "Traits",
	action: "Actions",
	bonus: "Bonus actions",
	reaction: "Reactions",
	legendary: "Legendary actions",
	mythic: "Mythic actions",
	spellcasting: "Spellcasting",
};

export function formatCreatureTransformationDeltaField ({path, before, after}) {
	const abilities = ["str", "dex", "con", "int", "wis", "cha"];
	const isAbility = abilities.includes(path);
	const isSpeed = path === "speed" || path.startsWith("speed.");
	const label = isAbility ? Parser.attAbvToFull(path)
		: path.startsWith("speed.") ? `${path.slice("speed.".length).replace(/^\w/, char => char.toUpperCase())} speed`
			: DELTA_FIELD_NAMES[path] || `Other field (${path})`;
	const format = value => {
		if (value == null) return "none";
		if (path === "size" && Array.isArray(value)) return value.map(it => Parser.sizeAbvToFull(it)).join(", ") || "none";
		if (path === "type" && (typeof value === "string" || typeof value?.type === "string")) return Parser.monTypeToFullObj(value).asText;
		if (isSpeed && typeof value === "number") return `${value} ft.`;
		if (path === "speed" && value && typeof value === "object" && !Array.isArray(value)
			&& Object.values(value).every(it => typeof it === "number")) {
			return Object.entries(value).map(([mode, feet]) => `${mode} ${feet} ft.`).join(", ") || "none";
		}
		if (["resist", "immune", "vulnerable", "conditionImmune", "senses", "languages"].includes(path) && Array.isArray(value)) {
			return value.map(it => {
				if (typeof it === "string") return it;
				if (it && typeof it === "object" && Array.isArray(it[path]) && typeof it.note === "string") {
					return `${it[path].join(", ")} (${it.note})`;
				}
				return JSON.stringify(it);
			}).join(", ") || "none";
		}
		if (isAbility && typeof value === "number") return String(value);
		return JSON.stringify(value);
	};
	return `${label}: ${format(before)} → ${format(after)}`;
}

function renderCompactDelta (parent, batch) {
	parent.replaceChildren();
	if (!batch?.previews.length) return;
	const fieldChanges = new Map();
	const entryChanges = new Set();
	for (const {preview} of batch.previews) {
		for (const field of preview.diff.fields) {
			const label = formatCreatureTransformationDeltaField(field);
			fieldChanges.set(label, (fieldChanges.get(label) || 0) + 1);
		}
		for (const {section, name, before, after} of preview.diff.entries) {
			entryChanges.add(`${DELTA_ENTRY_NAMES[section] || `Other section (${section})`}: ${before && after ? "Changed" : after ? "Added" : "Removed"} ${name}`);
		}
	}
	parent.append(element("h5", {text: "Mechanical delta · live preview"}));
	const changes = [...fieldChanges].map(([text, count]) => batch.previews.length > 1 ? `${text} (${count} of ${batch.previews.length})` : text);
	list(parent, [...changes, ...entryChanges].length ? [...changes, ...entryChanges] : ["No automatically representable change."]);
}

function renderPreviewTarget (parent, {id, label, preview}, decisions, onDecision) {
	const section = element("section", {className: "bqa__transformation-target"});
	section.append(element("h5", {text: label}));
	preview.conflicts.forEach(({path, existing, incoming}) => {
		const wrapper = element("label", {className: "bqa__field"});
		wrapper.append(element("span", {className: "bqa__field-label", text: `Winner for ${path} on ${label}`}));
		const select = element("select", {className: "ve-form-control"});
		select.dataset.conflictId = id;
		select.dataset.conflictPath = path;
		for (const [value, text] of [
			["", "Choose a winner…"],
			["existing", `Keep existing: ${JSON.stringify(existing)}`],
			["incoming", `Use incoming: ${JSON.stringify(incoming)}`],
		]) select.add(new Option(text, value));
		select.value = decisions[id]?.[path] || "";
		select.addEventListener("change", () => onDecision(id, path, select.value));
		wrapper.append(select);
		section.append(wrapper);
	});
	renderDiff(section, preview.diff);
	const pair = element("div", {className: "bqa__transformation-pair"});
	renderStatblock(pair, preview.current, "Before · current statblock");
	renderStatblock(pair, preview.proposed, "After · proposed statblock");
	section.append(pair);
	parent.append(section);
}

export async function pRenderCreatureTransformationEditor ({mount, getTargets, getStamp = () => "", getConsequences = () => null, validateOperation = null, pApply, isBulk = false, pLoadCandidates = null, isCurrent = () => true}) {
	const container = element("section", {className: "bqa__transformation"});
	mount.replaceChildren(container);
	paragraph(container, "Choose a recipe to see its effect. Previewing never edits the source creature or saved encounter.");
	const error = element("p", {className: "bqa__transformation-error"});
	error.setAttribute("role", "alert");
	const status = element("p", {className: "bqa__transformation-status"});
	status.setAttribute("role", "status");
	status.setAttribute("aria-live", "polite");
	const input = element("div", {className: "bqa__transformation-input"});
	const details = element("div");
	const result = element("div");
	container.append(input, details, error, status, result);
	status.textContent = "Loading site, prerelease, and homebrew transformation candidates…";
	const showError = message => { error.textContent = message; };
	let candidates;
	let load;
	try {
		load = pLoadCandidates || (await import("../creature-transformations.js")).pLoadCreatureTransformationCandidates;
		candidates = await load();
		if (!Array.isArray(candidates)) throw new Error("The transformation catalog did not return a candidate list.");
	} catch (e) {
		if (!isCurrent()) return;
		status.textContent = "";
		showError(`Could not load creature transformations: ${e.message}`);
		container.append(button("Retry catalog load", () => pRenderCreatureTransformationEditor({
			mount, getTargets, getStamp, getConsequences, validateOperation, pApply, isBulk, pLoadCandidates, isCurrent,
		})));
		return;
	}
	if (!isCurrent()) return;
	status.textContent = "";
	const {resolveCreatureTransformation} = await import("../creature-transformations.js");
	const sourceNames = new Map(candidates.map(({identity: {source}}) => [source, Parser.sourceJsonToFull(source)]));
	const sourceLabel = source => {
		const full = sourceNames.get(source);
		const abv = Parser.sourceJsonToAbv(source);
		return full.toLowerCase() === source.toLowerCase()
			? source
			: `${full} (${abv}${abv.toLowerCase() === source.toLowerCase() ? "" : ` · ${source}`})`;
	};
	const category = element("fieldset", {className: "bqa__transformation-category"});
	category.append(element("legend", {text: "Browse recipes"}));
	const categoryButtons = new Map([
		["catalog", button("", () => setCategory("catalog"), "bqa__transformation-category-btn")],
		["race", button("", () => setCategory("race"), "bqa__transformation-category-btn")],
	]);
	categoryButtons.forEach(node => category.append(node));
	const source = element("select", {className: "ve-form-control"});
	const sourceField = element("label", {className: "bqa__field"});
	sourceField.append(element("span", {className: "bqa__field-label", text: "Source book"}), source);
	const picker = element("select", {className: "ve-form-control"});
	picker.setAttribute("aria-label", "Creature transformation");
	const search = element("input", {className: "ve-form-control"});
	search.type = "search";
	search.placeholder = "Name, book, or source code";
	const searchLabel = element("label", {className: "bqa__field"});
	searchLabel.append(element("span", {className: "bqa__field-label", text: "Find a template or species"}), search);
	const pickerLabel = element("label", {className: "bqa__field"});
	pickerLabel.append(element("span", {className: "bqa__field-label", text: "Creature transformation"}), picker);
	const count = element("p", {className: "bqa__transformation-count"});
	count.setAttribute("role", "status");
	count.setAttribute("aria-live", "polite");
	const empty = element("p", {className: "bqa__transformation-empty"});
	const choices = element("div", {className: "bqa__transformation-choices"});
	choices.setAttribute("role", "group");
	choices.setAttribute("aria-label", "Available templates");
	input.append(category, sourceField, searchLabel, count, empty, choices, pickerLabel);
	let activeCategory = "catalog";
	let visibleIds = new Set();
	let selections = {};
	let confirmationInputs = [];
	let approvalInput = null;
	let confirmation = null;
	let delta = null;
	let action = null;
	let batch = null;
	let stamp = null;
	let candidate = null;
	let resolved = null;
	let decisions = {};
	let isSaving = false;

	const clearPreview = () => {
		batch = null;
		stamp = null;
		resolved = null;
		result.replaceChildren();
		delta?.replaceChildren();
		action?.replaceChildren();
		status.textContent = "";
		showError("");
	};
	const syncChoices = () => {
		choices.querySelectorAll("button[data-recipe-id]").forEach(node =>
			node.setAttribute("aria-pressed", String(node.dataset.recipeId === picker.value)));
	};
	const refreshSources = () => {
		const previous = source.value;
		const available = candidates.filter(it => it.kind === activeCategory);
		const counts = new Map();
		available.forEach(it => counts.set(it.identity.source, (counts.get(it.identity.source) || 0) + 1));
		source.replaceChildren(new Option(`All sources (${available.length})`, ""));
		[...counts].sort(([a], [b]) => sourceLabel(a).localeCompare(sourceLabel(b))).forEach(([code, total]) =>
			source.add(new Option(`${sourceLabel(code)} · ${total}`, code)));
		source.value = counts.has(previous) ? previous : "";
		categoryButtons.forEach((node, kind) => {
			node.textContent = `${kind === "catalog" ? "Templates" : "Species"} (${candidates.filter(it => it.kind === kind).length})`;
			node.setAttribute("aria-pressed", String(activeCategory === kind));
		});
	};
	const refreshOptions = () => {
		const previous = picker.value;
		const term = search.value.trim().toLowerCase();
		const inCategory = candidates.filter(it => it.kind === activeCategory);
		const matching = inCategory.filter(it =>
			(!source.value || it.identity.source === source.value)
			&& `${it.identity.name} ${it.identity.source} ${sourceNames.get(it.identity.source)} ${Parser.sourceJsonToAbv(it.identity.source)}`.toLowerCase().includes(term));
		visibleIds = new Set(matching.map(it => it.id));
		picker.replaceChildren(new Option("Choose a source-qualified recipe…", ""));
		matching.forEach(it => picker.add(new Option(`${it.identity.name} (${it.identity.source})${it.duplicateVariant ? ` · Variant ${it.duplicateVariant}${it.provenance.page ? ` (p. ${it.provenance.page})` : ""}` : ""}`, it.id)));
		picker.value = visibleIds.has(previous) ? previous : "";
		choices.replaceChildren();
		choices.hidden = activeCategory !== "catalog" || !matching.length;
		if (!choices.hidden) {
			matching.forEach(it => {
				const title = `${it.identity.name}${it.duplicateVariant ? ` · Variant ${it.duplicateVariant}` : ""}`;
				const edition = it.provenance.edition === "unverified" ? "Edition unverified" : it.provenance.edition === "one" ? "2024 edition" : "2014 edition";
				const page = it.provenance.page == null ? "Page unverified" : `p. ${it.provenance.page}`;
				const required = it.optionGroups.filter(group => group.required).length;
				const info = `Eligibility: ${describeEligibility(it.eligibility)}. ${required ? `${required} required choice${required === 1 ? "" : "s"}.` : ""}`;
				const choice = button("", () => {
					picker.value = it.id;
					renderCandidate();
				}, "bqa__transformation-choice");
				choice.dataset.recipeId = it.id;
				choice.setAttribute("aria-label", `${title}, ${sourceLabel(it.identity.source)}, ${edition}, ${page}. ${info}`);
				choice.append(
					element("span", {className: "bqa__transformation-choice-name", text: title}),
					element("span", {className: "bqa__transformation-choice-meta", text: `${it.identity.source} · ${page}`}),
				);
				const row = element("div", {className: "bqa__transformation-choice-row"});
				row.append(choice, makeInfoButton({
					name: `${title} (${it.identity.source})`,
					entries: getRecipeHoverEntries(it, sourceLabel),
					targets: [choice],
				}));
				choices.append(row);
			});
		}
		syncChoices();
		count.textContent = `Showing ${matching.length} of ${inCategory.length} ${activeCategory === "catalog" ? "templates" : "species"}.`;
		empty.textContent = matching.length ? "" : "No recipes match these filters. Try another source or clear the search.";
		empty.hidden = !!matching.length;
	};
	const onFilterChange = () => {
		clearPreview();
		refreshOptions();
		if (candidate?.id !== picker.value) renderCandidate();
		else if (candidate) doPreview();
	};
	const setCategory = kind => {
		if (activeCategory === kind) return;
		activeCategory = kind;
		refreshSources();
		onFilterChange();
	};
	const renderCandidate = () => {
		clearPreview();
		candidate = visibleIds.has(picker.value) ? candidates.find(it => it.id === picker.value) : null;
		selections = {};
		confirmationInputs = [];
		approvalInput = null;
		confirmation = null;
		delta = null;
		action = null;
		decisions = {};
		details.replaceChildren();
		syncChoices();
		if (!candidate) {
			paragraph(details, activeCategory === "catalog"
				? "Select a template to see the live before/after statblocks."
				: "Choose a species to see the live before/after statblocks.");
			return;
		}
		const provenance = candidate.provenance;
		const heading = element("div", {className: "bqa__transformation-selected"});
		const title = element("h5", {text: candidate.identity.name});
		heading.append(title);
		paragraph(heading, `Source: ${candidate.identity.name} · ${sourceLabel(candidate.identity.source)} · ${provenance.edition === "unverified" ? "Edition unverified" : provenance.edition === "one" ? "2024 edition" : "2014 edition"}${provenance.page == null ? " · Page unverified" : ` · p. ${provenance.page}`}.`);
		heading.append(makeInfoButton({
			name: `${candidate.identity.name} (${candidate.identity.source})`,
			entries: getRecipeHoverEntries(candidate, sourceLabel),
			targets: [title],
		}));
		details.append(heading);
		if (candidate.duplicateVariant) paragraph(details, `Variant ${candidate.duplicateVariant}: multiple different race definitions share this name and source. Compare their changes before applying one.`);
		paragraph(details, `Eligibility: ${describeEligibility(candidate.eligibility)}. Details and source rules are available from each info button.`);
		const options = element("div", {className: "bqa__transformation-options"});
		const groupControls = new Map();
		for (const group of candidate.optionGroups) {
			const fieldset = element("fieldset", {className: "bqa__transformation-group"});
			const legend = element("legend", {className: "ve-help ve-help--hover", text: `${group.name}${group.required ? " (required)" : ""}`});
			legend.tabIndex = 0;
			legend.title = `View ${group.name} options`;
			const groupHover = bindInfoHover({
				name: `${candidate.identity.name} (${candidate.identity.source}) · ${group.name}`,
				entries: getCreatureTransformationGroupHoverEntries({candidate, group, sourceLabel}),
				targets: [legend],
			});
			legend.addEventListener("click", () => groupHover.show());
			legend.addEventListener("keydown", evt => {
				if (evt.key !== "Enter" && evt.key !== " ") return;
				evt.preventDefault();
				groupHover.show();
			});
			fieldset.append(legend);
			const controls = [];
			const groupName = `bqa-transformation-group-${++nextOptionGroupId}`;
			const addOption = (option, {isNone = false} = {}) => {
				const row = element("div", {className: "bqa__transformation-option"});
				const label = element("label", {className: "bqa__transformation-check"});
				const control = element("input");
				control.type = group.selection === "one" ? "radio" : "checkbox";
				if (control.type === "radio") control.name = groupName;
				control.value = option?.id || "";
				if (isNone) control.checked = true;
				control.addEventListener("change", () => updateSelection(group, control.type === "radio"
					? (control.value ? [control.value] : [])
					: controls.filter(it => it.checked).map(it => it.value)));
				controls.push(control);
				const optionName = element("span", {className: "bqa__transformation-option-name", text: isNone ? "None" : option.name});
				label.append(control, optionName);
				row.append(label);
				if (option) {
					const info = makeInfoButton({
						name: `${candidate.identity.name} (${candidate.identity.source}) · ${group.name} · ${option.name}`,
						entries: getCreatureTransformationOptionHoverEntries({candidate, group, option, sourceLabel}),
						targets: [control, optionName],
					});
					row.append(info);
					control.setAttribute("aria-describedby", info.id = `bqa-transformation-detail-${++nextOptionGroupId}`);
					optionName.addEventListener("click", evt => {
						if (evt.pointerType === "touch" || evt.sourceCapabilities?.firesTouchEvents) info.click();
					});
				}
				fieldset.append(row);
			};
			if (group.selection === "one") {
				if (!group.required) addOption(null, {isNone: true});
				group.options.forEach(option => addOption(option));
			} else {
				group.options.forEach(option => addOption(option));
			}
			options.append(fieldset);
			groupControls.set(group.id, {group, fieldset, controls});
		}
		const syncConditional = () => {
			for (const {group, fieldset, controls} of groupControls.values()) {
				const active = !group.appliesTo || selections[group.appliesTo.group]?.includes(group.appliesTo.option);
				fieldset.hidden = !active;
				controls.forEach(control => { control.disabled = !active; });
				if (!active) {
					delete selections[group.id];
					controls.forEach(control => {
						control.checked = control.type === "radio" && !group.required && !control.value;
					});
				}
			}
		};
		const updateSelection = (group, values) => {
			selections[group.id] = values;
			decisions = {};
			syncConditional();
			clearPreview();
			confirmation.hidden = true;
			confirmationInputs.forEach(it => { it.checked = false; });
			renderReview();
			doPreview();
		};
		syncConditional();
		const config = element("div", {className: "bqa__transformation-config"});
		delta = element("div", {className: "bqa__transformation-delta"});
		if (candidate.optionGroups.length) config.append(options);
		else config.classList.add("bqa__transformation-config--no-options");
		config.append(delta);
		details.append(config);
		confirmation = element("fieldset", {className: "bqa__transformation-group bqa__transformation-confirm"});
		confirmation.hidden = true;
		confirmation.append(element("legend", {text: "Confirm before applying"}));
		confirmationInputs = candidate.prerequisites.map(prerequisite => {
			const label = element("label", {className: "bqa__transformation-check"});
			const control = element("input");
			control.type = "checkbox";
			label.append(control, document.createTextNode(` ${prerequisite}`));
			confirmation.append(label);
			return control;
		});
		if (candidate.eligibility.dmApproval || candidate.optionGroups.some(group => group.options.some(option => option.eligibility?.dmApproval))) {
			approvalInput = element("input");
			approvalInput.type = "checkbox";
			const approvalLabel = element("label", {className: "bqa__transformation-check"});
			approvalLabel.append(approvalInput, document.createTextNode(" I approve this transformation and its selected options as DM."));
			confirmation.append(approvalLabel);
			confirmationInputs.push(approvalInput);
		}
		if (confirmationInputs.length) details.append(confirmation);
		const review = element("details", {className: "bqa__transformation-review"});
		review.append(element("summary"));
		details.append(review);
		action = element("div", {className: "bqa__transformation-actions"});
		details.append(action);
		renderReview();
		doPreview();
	};
	const renderReview = () => {
		const review = details.querySelector(".bqa__transformation-review");
		if (!review) return;
		const items = [...candidate.manualReview];
		for (const group of candidate.optionGroups) {
			for (const option of group.options) if (selections[group.id]?.includes(option.id)) items.push(...option.manualReview);
		}
		review.replaceChildren(element("summary", {text: `DM review · ${items.length} item${items.length === 1 ? "" : "s"} not applied automatically`}));
		if (items.length) list(review, items.map(it => `${it.field}: ${it.reason}`));
	};
	search.addEventListener("input", onFilterChange);
	source.addEventListener("change", onFilterChange);
	picker.addEventListener("change", renderCandidate);

	const renderBatch = () => {
		result.replaceChildren();
		action?.replaceChildren();
		if (!batch) return;
		const summary = element("div", {className: "bqa__transformation-summary"});
		paragraph(summary, `${batch.previews.length} eligible · ${batch.skipped.length} skipped. Statblocks show only automatic changes; DM review remains separate.`);
		if (batch.skipped.length) {
			summary.append(element("h5", {text: "Skipped · unchanged"}));
			list(summary, batch.skipped.map(it => `${it.label}: ${it.reason}`));
		}
		result.append(summary);
		renderCompactDelta(delta, batch);
		for (const target of batch.previews) {
			renderPreviewTarget(result, target, decisions, (id, path, winner) => {
				if (!decisions[id]) decisions[id] = {};
				if (winner) decisions[id][path] = winner;
				else delete decisions[id][path];
				try {
					batch = previewCreatureTransformationTargets({
						targets: batch.targets,
						resolved,
						acknowledgedPrerequisites: resolved.prerequisites,
						dmApproved: true,
						conflictDecisions: decisions,
					});
					renderBatch();
					result.querySelectorAll("select[data-conflict-id]").forEach(select => {
						if (select.dataset.conflictId === id && select.dataset.conflictPath === path) select.focus({preventScroll: true});
					});
				} catch (e) { showError(e.message); }
			});
		}
		if (!batch.previews.length) return;
		if (batch.previews.some(it => !it.preview.canApply)) {
			paragraph(action, "Choose an existing or incoming winner for each overlapping change to complete the preview.");
			return;
		}
		const apply = button(isBulk ? `Apply to ${batch.previews.length} · one save` : "Apply transformation", doApply, "bqa__transformation-apply ve-btn ve-btn-primary ve-btn-sm");
		action.append(apply, element("span", {text: "Preview only · no changes saved yet."}));
	};
	const doPreview = () => {
		clearPreview();
		try {
			if (!candidate || picker.value !== candidate.id || !visibleIds.has(candidate.id)) throw new Error("Choose a visible source-qualified recipe.");
			const missing = candidate.optionGroups.find(group =>
				group.required && (!group.appliesTo || selections[group.appliesTo.group]?.includes(group.appliesTo.option)) && !selections[group.id]?.length);
			if (missing) {
				paragraph(delta, `Choose ${missing.name} to see the before/after statblocks.`);
				return;
			}
			resolved = resolveCreatureTransformation({candidates, id: candidate.id, selections});
			if (approvalInput) approvalInput.parentElement.hidden = !resolved.eligibility.some(it => it.dmApproval);
			const targets = getTargets();
			stamp = getStamp();
			batch = previewCreatureTransformationTargets({
				targets, resolved, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true, conflictDecisions: decisions,
			});
			renderBatch();
			if (!batch.previews.length) showError("No eligible monster can use this recipe; review the skipped targets below.");
		} catch (e) { showError(e.message); }
	};
	const doApply = async () => {
		if (isSaving || !batch) return;
		if (batch.previews.some(it => !it.preview.canApply)) {
			showError("Choose a winner for every conflicting statblock field before applying.");
			return;
		}
		if (confirmationInputs.some(it => !it.parentElement.hidden) && confirmation.hidden) {
			confirmation.hidden = false;
			status.textContent = "Confirm the prerequisites and DM approval before applying; the preview has not been saved.";
			confirmationInputs.find(it => !it.parentElement.hidden)?.focus();
			return;
		}
		const missingConfirmation = confirmationInputs.find(it => !it.parentElement.hidden && !it.checked);
		if (missingConfirmation) {
			showError("Confirm every listed prerequisite and required DM approval before applying.");
			missingConfirmation.focus();
			return;
		}
		isSaving = true;
		const selectedCandidate = candidate;
		const selectedBatch = batch;
		const selectedSelections = structuredClone(selections);
		const selectedDecisions = structuredClone(decisions);
		const apply = action.querySelector(".bqa__transformation-apply");
		apply.disabled = true;
		status.textContent = "Checking the live catalog, targets, and storage before saving…";
		try {
			const currentCandidates = await load();
			if (!isCurrent()) throw new Error("The editor changed while the catalog was loading. Select the recipe again.");
			if (batch !== selectedBatch || candidate !== selectedCandidate || picker.value !== selectedCandidate.id || !visibleIds.has(selectedCandidate.id)
				|| JSON.stringify(selections) !== JSON.stringify(selectedSelections) || JSON.stringify(decisions) !== JSON.stringify(selectedDecisions)) {
				throw new Error("The filters, choices, or conflict winners changed. Review the new preview before applying.");
			}
			const currentCandidate = currentCandidates.find(it => it.id === selectedCandidate.id);
			if (JSON.stringify(currentCandidate) !== JSON.stringify(selectedCandidate)) throw new Error("The transformation catalog changed. Select the recipe again.");
			const currentResolved = resolveCreatureTransformation({candidates: currentCandidates, id: selectedCandidate.id, selections: selectedSelections});
			if (JSON.stringify(currentResolved) !== JSON.stringify(resolved) || getStamp() !== stamp) throw new Error("The selection or encounter changed. Select the recipe again.");
			const targets = getTargets();
			if (JSON.stringify(targets) !== JSON.stringify(selectedBatch.targets)) throw new Error("A target or its statblock history changed. Select the recipe again.");
			const verified = previewCreatureTransformationTargets({
				targets,
				resolved: currentResolved,
				acknowledgedPrerequisites: confirmationInputs.slice(0, currentResolved.prerequisites.length)
					.map((it, index) => it.checked ? currentResolved.prerequisites[index] : null).filter(Boolean),
				dmApproved: !currentResolved.eligibility.some(it => it.dmApproval) || !!approvalInput?.checked,
				conflictDecisions: selectedDecisions,
				validateOperation,
			});
			const previewShape = snapshot => JSON.stringify({
				skipped: snapshot.skipped,
				previews: snapshot.previews.map(({id, preview}) => ({id, proposed: preview.proposed, conflicts: preview.conflicts, diff: preview.diff})),
			});
			if (previewShape(verified) !== previewShape(selectedBatch)) {
				batch = verified;
				renderBatch();
				throw new Error("Storage or eligibility changed the preview. Review its skipped targets and apply again.");
			}
			const changes = createCreatureTransformationChanges({batch: verified, targets, conflictDecisions: selectedDecisions});
			if (!changes.length) throw new Error("No eligible monster remains to transform.");
			const effects = getConsequences(changes);
			if (effects?.resetHpIds?.length || effects?.splitIds?.length) {
				const names = ids => ids.map(id => targets.find(it => it.id === id).label).join(", ");
				const effectsText = [
					effects.resetHpIds?.length ? `HP will reset for ${names(effects.resetHpIds)}.` : "",
					effects.splitIds?.length ? `${names(effects.splitIds)} will leave shared-turn groups.` : "",
				].filter(Boolean).join(" ");
				status.textContent = effectsText;
			}
			await pApply(changes);
			clearPreview();
			status.textContent = `Applied ${selectedCandidate.identity.name} to ${changes.length} ${changes.length === 1 ? "monster" : "monsters"}. Manual-review items still need DM adjudication.`;
		} catch (e) {
			if (e.isEncounterStatblockSaved) {
				clearPreview();
				status.textContent = e.message;
			} else {
				status.textContent = "";
				showError(`Transformation was not applied: ${e.message}`);
			}
		} finally {
			isSaving = false;
			if (apply.isConnected) apply.disabled = false;
		}
	};
	refreshSources();
	refreshOptions();
	renderCandidate();
}
