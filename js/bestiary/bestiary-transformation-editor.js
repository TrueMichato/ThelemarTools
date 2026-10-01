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
		case "grantConditionalDefense": return `${step.kind} to ${step.value} (${{
			nonmagical: "nonmagical damage",
			nonmagicalUnsilvered: "nonmagical, unsilvered damage",
			dimLightOrDarkness: "in dim light or darkness",
		}[step.when]})`;
		case "addEntry": return `Add ${step.section} ${step.entry.name} (${step.entry.source}): ${step.entry.entries.join(" ")}`;
		case "removeEntry": return `Remove ${step.section} ${step.match.name || step.match.role} (${step.match.source})`;
		case "replaceEntry": return `Replace ${step.section} ${step.match.name || step.match.role} with ${step.entry.name} (${step.entry.source})`;
		case "replaceDamageType": return `Change ${step.section} ${step.match.name || step.match.role} damage to ${step.to}`;
		default: throw new Error(`Unknown transformation change: ${step.op}`);
	}
}

function describeOption (option, candidate, group) {
	return [
		`${candidate.identity.name} (${candidate.identity.source}) · ${group.name} · ${option.name}.`,
		`Eligibility: ${describeEligibility(option.eligibility || {})}.`,
		option.changes.length ? `Mechanical changes: ${option.changes.map(describeChange).join("; ")}.` : "No automatic mechanical change.",
		option.manualReview.length ? `DM review: ${option.manualReview.map(it => it.reason).join(" ")}` : "No additional DM review for this choice.",
	].join(" ");
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
	details.open = true;
	details.append(element("summary", {text: `Mechanical diff · ${changes.length} changed field${changes.length === 1 ? "" : "s"}`}));
	if (changes.length) list(details, changes);
	else paragraph(details, "No mechanically representable fields change. Manual review may still be required.");
	parent.append(details);
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
	paragraph(container, "Apply only the mechanical changes shown in the preview. Source text and manual-review items still need DM attention.");
	const error = element("p", {className: "bqa__transformation-error"});
	error.setAttribute("role", "alert");
	const status = element("p", {className: "bqa__transformation-status"});
	status.setAttribute("role", "status");
	status.setAttribute("aria-live", "polite");
	const input = element("div", {className: "bqa__transformation-input"});
	const details = element("div");
	const result = element("div");
	container.append(input, details, error, result, status);
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
	const recipeInfo = element("section", {className: "bqa__transformation-recipe-info"});
	recipeInfo.setAttribute("aria-label", "Recipe details");
	input.append(category, sourceField, searchLabel, count, empty, choices, recipeInfo, pickerLabel);
	const previewButton = button(isBulk ? "Preview selected monsters" : "Preview transformation", () => doPreview(), "ve-btn ve-btn-primary ve-btn-sm");
	input.append(previewButton);
	let activeCategory = "catalog";
	let visibleIds = new Set();
	let selections = {};
	let acknowledgementInputs = [];
	let approvalInput = null;
	let reviewInput = null;
	let batch = null;
	let stamp = null;
	let candidate = null;
	let resolved = null;
	let decisions = {};
	let isSaving = false;

	const showRecipeInfo = it => {
		recipeInfo.replaceChildren();
		recipeInfo.hidden = activeCategory !== "catalog" || !it;
		if (recipeInfo.hidden) return;
		const {edition, page} = it.provenance;
		const heading = `${it.identity.name} (${it.identity.source})${it.duplicateVariant ? ` · Variant ${it.duplicateVariant}` : ""}`;
		recipeInfo.append(element("h5", {text: heading}));
		paragraph(recipeInfo, `${sourceLabel(it.identity.source)} · ${edition === "unverified" ? "Edition unverified" : edition === "one" ? "2024 edition" : "2014 edition"} · ${page == null ? "Page unverified" : `p. ${page}`}.`);
		paragraph(recipeInfo, `Eligibility: ${describeEligibility(it.eligibility)}.`);
		const required = it.optionGroups.filter(group => group.required);
		if (required.length) paragraph(recipeInfo, `Required choices: ${required.map(group => group.name).join(", ")}.`);
		if (it.prerequisites.length) list(recipeInfo, it.prerequisites.map(text => `Before preview: ${text}`));
	};
	const clearPreview = () => {
		batch = null;
		stamp = null;
		resolved = null;
		result.replaceChildren();
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
				const info = `Eligibility: ${describeEligibility(it.eligibility)}. ${required ? `${required} required choice${required === 1 ? "" : "s"}. ` : ""}${it.prerequisites.length ? "Review prerequisites before preview." : ""}`;
				const choice = button("", () => {
					picker.value = it.id;
					renderCandidate();
				}, "bqa__transformation-choice");
				choice.dataset.recipeId = it.id;
				choice.setAttribute("aria-label", `${title}, ${sourceLabel(it.identity.source)}, ${edition}, ${page}. ${info} ${it.prerequisites.join(" ")}`);
				choice.addEventListener("pointerenter", () => showRecipeInfo(it));
				choice.addEventListener("pointerleave", () => showRecipeInfo(document.activeElement === choice ? it : candidate));
				choice.addEventListener("focus", () => showRecipeInfo(it));
				choice.addEventListener("blur", () => showRecipeInfo(candidate));
				choice.append(
					element("span", {className: "bqa__transformation-choice-name", text: title}),
					element("span", {className: "bqa__transformation-choice-meta", text: `${it.identity.source} · ${page}`}),
					element("span", {className: "bqa__transformation-choice-detail", text: info}),
				);
				choices.append(choice);
			});
		}
		syncChoices();
		count.textContent = `Showing ${matching.length} of ${inCategory.length} ${activeCategory === "catalog" ? "templates" : "species"}.`;
		empty.textContent = matching.length ? "" : "No recipes match these filters. Try another source or clear the search.";
		empty.hidden = !!matching.length;
		previewButton.disabled = !picker.value;
		showRecipeInfo(visibleIds.has(candidate?.id) ? candidate : null);
	};
	const onFilterChange = () => {
		clearPreview();
		refreshOptions();
		if (candidate?.id !== picker.value) renderCandidate();
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
		acknowledgementInputs = [];
		approvalInput = null;
		reviewInput = null;
		details.replaceChildren();
		previewButton.disabled = !candidate;
		syncChoices();
		showRecipeInfo(candidate);
		if (!candidate) {
			paragraph(details, activeCategory === "catalog"
				? "Select a template to review its prerequisites and preview the mechanical changes."
				: "Choose a species to review its prerequisites and preview the mechanical changes.");
			return;
		}
		const provenance = candidate.provenance;
		const heading = element("div", {className: "bqa__transformation-selected"});
		heading.append(element("h5", {text: candidate.identity.name}));
		paragraph(heading, `Source: ${candidate.identity.name} · ${sourceLabel(candidate.identity.source)} · ${provenance.edition === "unverified" ? "Edition unverified" : provenance.edition === "one" ? "2024 edition" : "2014 edition"}${provenance.page == null ? " · Page unverified" : ` · p. ${provenance.page}`}.`);
		details.append(heading);
		if (candidate.duplicateVariant) paragraph(details, `Variant ${candidate.duplicateVariant}: multiple different race definitions share this name and source. Compare their changes before applying one.`);
		const eligibility = element("div", {className: "bqa__transformation-eligibility"});
		details.append(eligibility);
		const renderEligibility = () => {
			eligibility.replaceChildren();
			paragraph(eligibility, `Base eligibility: ${describeEligibility(candidate.eligibility)}.`);
			for (const group of candidate.optionGroups) {
				for (const option of group.options) {
					if (selections[group.id]?.includes(option.id)) paragraph(eligibility, `${group.name} · ${option.name}: ${describeEligibility(option.eligibility || {})}.`);
				}
			}
		};
		const options = element("div", {className: "bqa__transformation-options"});
		const groupControls = new Map();
		for (const group of candidate.optionGroups) {
			const fieldset = element("fieldset", {className: "bqa__transformation-group"});
			fieldset.append(element("legend", {text: `${group.name}${group.required ? " (required)" : ""}`}));
			const controls = [];
			const groupName = `bqa-transformation-group-${++nextOptionGroupId}`;
			const addOption = (option, {isNone = false} = {}) => {
				const label = element("label", {className: "bqa__transformation-check bqa__transformation-option"});
				const control = element("input");
				control.type = group.selection === "one" ? "radio" : "checkbox";
				if (control.type === "radio") control.name = groupName;
				control.value = option?.id || "";
				if (isNone) control.checked = true;
				const detail = element("span", {
					className: "bqa__transformation-option-detail",
					text: isNone
						? `No ${group.name.toLowerCase()} selected for ${candidate.identity.name} (${candidate.identity.source}).`
						: describeOption(option, candidate, group),
				});
				detail.id = `bqa-transformation-detail-${++nextOptionGroupId}`;
				control.setAttribute("aria-describedby", detail.id);
				control.addEventListener("change", () => updateSelection(group, control.type === "radio"
					? (control.value ? [control.value] : [])
					: controls.filter(it => it.checked).map(it => it.value)));
				controls.push(control);
				label.append(control, element("span", {className: "bqa__transformation-option-name", text: isNone ? "None" : option.name}), detail);
				fieldset.append(label);
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
			syncConditional();
			clearPreview();
			reviewInput.checked = false;
			renderEligibility();
			renderReview();
		};
		syncConditional();
		renderEligibility();
		details.append(options);
		const confirmations = element("fieldset", {className: "bqa__transformation-group"});
		confirmations.append(element("legend", {text: "Confirm before preview"}));
		acknowledgementInputs = candidate.prerequisites.map(prerequisite => {
			const label = element("label", {className: "bqa__transformation-check"});
			const control = element("input");
			control.type = "checkbox";
			control.addEventListener("change", clearPreview);
			label.append(control, document.createTextNode(` ${prerequisite}`));
			confirmations.append(label);
			return {control, prerequisite};
		});
		approvalInput = element("input");
		approvalInput.type = "checkbox";
		approvalInput.addEventListener("change", clearPreview);
		const approvalLabel = element("label", {className: "bqa__transformation-check"});
		approvalLabel.append(approvalInput, document.createTextNode(" I approve this transformation and any selected option restrictions as DM."));
		confirmations.append(approvalLabel);
		details.append(confirmations);
		details.append(element("h5", {text: "Manual review · not applied automatically"}));
		details.append(element("div", {className: "bqa__transformation-review"}));
		const reviewLabel = element("label", {className: "bqa__transformation-check"});
		reviewInput = element("input");
		reviewInput.type = "checkbox";
		reviewInput.addEventListener("change", () => {
			const apply = result.querySelector(".bqa__transformation-apply");
			if (apply) apply.disabled = !reviewInput.checked;
		});
		reviewLabel.append(reviewInput, document.createTextNode(" I understand these items still require manual DM review after applying the mechanical changes."));
		details.append(reviewLabel);
		renderReview();
	};
	const renderReview = () => {
		const review = details.querySelector(".bqa__transformation-review");
		if (!review) return;
		const items = [...candidate.manualReview];
		for (const group of candidate.optionGroups) {
			for (const option of group.options) if (selections[group.id]?.includes(option.id)) items.push(...option.manualReview);
		}
		review.replaceChildren();
		list(review, items.map(it => `${it.field}: ${it.reason}`));
	};
	search.addEventListener("input", onFilterChange);
	source.addEventListener("change", onFilterChange);
	picker.addEventListener("change", renderCandidate);
	refreshSources();
	refreshOptions();
	renderCandidate();

	const renderBatch = () => {
		result.replaceChildren();
		if (!batch) return;
		const summary = element("div", {className: "bqa__transformation-summary"});
		paragraph(summary, `${batch.previews.length} eligible · ${batch.skipped.length} skipped. Each statblock below reflects only representable changes.`);
		if (batch.skipped.length) {
			summary.append(element("h5", {text: "Skipped · unchanged"}));
			list(summary, batch.skipped.map(it => `${it.label}: ${it.reason}`));
		}
		result.append(summary);
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
						dmApproved: approvalInput.checked,
						conflictDecisions: decisions,
						validateOperation,
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
			paragraph(result, "Choose an existing or incoming winner for every overlapping write before applying.");
			return;
		}
		try {
			const changes = createCreatureTransformationChanges({batch, targets: batch.targets, conflictDecisions: decisions});
			const effects = getConsequences(changes);
			if (effects?.resetHpIds?.length) paragraph(result, `HP reset: ${effects.resetHpIds.map(id => batch.targets.find(it => it.id === id).label).join(", ")} will reset current and maximum HP to the effective average (or Unset); temporary HP stays.`);
			if (effects?.splitIds?.length) paragraph(result, `Group split: ${effects.splitIds.map(id => batch.targets.find(it => it.id === id).label).join(", ")} will leave incompatible groups and use individual initiative.`);
		} catch (e) {
			showError(`Cannot apply this preview: ${e.message}`);
			return;
		}
		const apply = button(isBulk ? `Apply to ${batch.previews.length} · one save` : "Apply transformation", doApply, "bqa__transformation-apply ve-btn ve-btn-primary ve-btn-sm");
		apply.disabled = !reviewInput.checked;
		result.append(apply);
	};
	const doPreview = () => {
		clearPreview();
		try {
			if (!candidate || picker.value !== candidate.id || !visibleIds.has(candidate.id)) throw new Error("Choose a visible source-qualified recipe.");
			if (acknowledgementInputs.some(it => !it.control.checked)) throw new Error("Acknowledge every narrative prerequisite before previewing.");
			const missing = candidate.optionGroups.find(group =>
				group.required && (!group.appliesTo || selections[group.appliesTo.group]?.includes(group.appliesTo.option)) && !selections[group.id]?.length);
			if (missing) throw new Error(`Choose ${missing.name} before previewing.`);
			resolved = resolveCreatureTransformation({candidates, id: candidate.id, selections});
			if (resolved.eligibility.some(it => it.dmApproval) && !approvalInput.checked) throw new Error("Confirm DM approval before previewing this recipe.");
			decisions = {};
			const targets = getTargets();
			stamp = getStamp();
			batch = previewCreatureTransformationTargets({
				targets, resolved, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: approvalInput.checked, validateOperation,
			});
			renderBatch();
			if (!batch.previews.length) showError("No eligible monster can use this recipe; review the exact skips below.");
		} catch (e) { showError(e.message); }
	};
	const doApply = async () => {
		if (isSaving || !batch) return;
		isSaving = true;
		const selectedCandidate = candidate;
		const selectedBatch = batch;
		try {
			if (!reviewInput?.checked) throw new Error("Confirm that the manual-review items still need DM adjudication.");
			const currentCandidates = await load();
			if (!isCurrent()) throw new Error("The editor changed while the catalog was loading. Preview again.");
			if (batch !== selectedBatch || candidate !== selectedCandidate || picker.value !== selectedCandidate.id || !visibleIds.has(selectedCandidate.id)) throw new Error("The filters or selection changed. Preview again.");
			const currentCandidate = currentCandidates.find(it => it.id === selectedCandidate.id);
			if (JSON.stringify(currentCandidate) !== JSON.stringify(selectedCandidate)) throw new Error("The transformation catalog changed. Preview again.");
			const currentResolved = resolveCreatureTransformation({candidates: currentCandidates, id: selectedCandidate.id, selections});
			if (JSON.stringify(currentResolved) !== JSON.stringify(resolved) || getStamp() !== stamp) throw new Error("The selection, encounter, or catalog changed. Preview again.");
			const changes = createCreatureTransformationChanges({batch, targets: getTargets(), conflictDecisions: decisions});
			if (!changes.length) throw new Error("No eligible monster remains to transform.");
			await pApply(changes);
			clearPreview();
			status.textContent = `Applied ${selectedCandidate.identity.name} to ${changes.length} ${changes.length === 1 ? "monster" : "monsters"}. Manual-review items still need DM adjudication.`;
		} catch (e) {
			if (e.isEncounterStatblockSaved) {
				clearPreview();
				previewButton.disabled = true;
				status.textContent = e.message;
			} else showError(`Transformation was not applied: ${e.message}`);
		} finally { isSaving = false; }
	};
}
