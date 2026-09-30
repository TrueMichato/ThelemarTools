import {createCreatureTransformationChanges, previewCreatureTransformationTargets} from "./bestiary-transformation-workflow.js";

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
	if (rule.sizes) parts.push(`Size: ${rule.sizes.join(" or ")}`);
	if (rule.minCr != null) parts.push(`CR at least ${rule.minCr}`);
	if (rule.maxCr != null) parts.push(`CR at most ${rule.maxCr}`);
	if (rule.minInt != null) parts.push(`Intelligence at least ${rule.minInt}`);
	if (rule.maxInt != null) parts.push(`Intelligence at most ${rule.maxInt}`);
	if (rule.requiresTrait) parts.push(`Requires trait: ${rule.requiresTrait}`);
	if (rule.dmApproval) parts.push("DM approval required");
	return parts.join("; ") || "No mechanical restriction";
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

export async function pRenderCreatureTransformationEditor ({mount, getTargets, getStamp = () => "", getConsequences = () => null, pApply, isBulk = false, pLoadCandidates = null, isCurrent = () => true}) {
	const container = element("section", {className: "bqa__transformation"});
	mount.replaceChildren(container);
	paragraph(container, "Combine source-qualified recipes on the current statblock. Only the changes listed in the mechanical diff are applied; source text and manual-review items are not automatically converted.");
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
			mount, getTargets, getStamp, getConsequences, pApply, isBulk, pLoadCandidates, isCurrent,
		})));
		return;
	}
	if (!isCurrent()) return;
	status.textContent = "";
	const {resolveCreatureTransformation} = await import("../creature-transformations.js");
	const picker = element("select", {className: "ve-form-control"});
	picker.setAttribute("aria-label", "Creature transformation");
	const search = element("input", {className: "ve-form-control"});
	search.type = "search";
	search.placeholder = "Filter by name or source";
	const searchLabel = element("label", {className: "bqa__field"});
	searchLabel.append(element("span", {className: "bqa__field-label", text: "Find a template or species"}), search);
	const pickerLabel = element("label", {className: "bqa__field"});
	pickerLabel.append(element("span", {className: "bqa__field-label", text: "Creature transformation"}), picker);
	input.append(searchLabel, pickerLabel);
	const previewButton = button(isBulk ? "Preview selected monsters" : "Preview transformation", () => doPreview(), "ve-btn ve-btn-primary ve-btn-sm");
	input.append(previewButton);
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

	const clearPreview = () => {
		batch = null;
		stamp = null;
		result.replaceChildren();
		status.textContent = "";
		showError("");
	};
	const refreshOptions = () => {
		const previous = picker.value;
		const term = search.value.trim().toLowerCase();
		picker.replaceChildren(new Option("Choose a source-qualified recipe…", ""));
		candidates.filter(it => `${it.identity.name} ${it.identity.source} ${it.kind}`.toLowerCase().includes(term))
			.forEach(it => picker.add(new Option(`${it.identity.name} (${it.identity.source}) · ${it.kind === "race" ? "Species" : "Template"}`, it.id)));
		picker.value = [...picker.options].some(it => it.value === previous) ? previous : "";
	};
	const renderCandidate = () => {
		clearPreview();
		candidate = candidates.find(it => it.id === picker.value) || null;
		selections = {};
		details.replaceChildren();
		if (!candidate) return;
		const provenance = candidate.provenance;
		paragraph(details, `Source: ${candidate.identity.name} (${candidate.identity.source}) · ${provenance.edition === "unverified" ? "Edition unverified" : provenance.edition === "one" ? "2024 edition" : "2014 edition"}${provenance.page == null ? " · Page unverified" : ` · p. ${provenance.page}`}.`);
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
			if (group.selection === "one") {
				const control = element("select", {className: "ve-form-control"});
				control.setAttribute("aria-label", group.name);
				control.add(new Option(group.required ? "Choose an option…" : "None", ""));
				group.options.forEach(option => control.add(new Option(option.name, option.id)));
				control.addEventListener("change", () => updateSelection(group, control.value ? [control.value] : []));
				fieldset.append(control);
				controls.push(control);
			} else {
				for (const option of group.options) {
					const label = element("label", {className: "bqa__transformation-check"});
					const control = element("input");
					control.type = "checkbox";
					control.addEventListener("change", () => updateSelection(group, controls.filter(it => it.checked).map(it => it.value)));
					control.value = option.id;
					controls.push(control);
					label.append(control, document.createTextNode(` ${option.name}`));
					fieldset.append(label);
				}
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
						if (control.type === "checkbox") control.checked = false;
						else control.value = "";
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
	search.addEventListener("input", () => {
		refreshOptions();
		renderCandidate();
	});
	picker.addEventListener("change", renderCandidate);
	refreshOptions();

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
			if (!candidate) throw new Error("Choose a source-qualified recipe.");
			if (acknowledgementInputs.some(it => !it.control.checked)) throw new Error("Acknowledge every narrative prerequisite before previewing.");
			resolved = resolveCreatureTransformation({candidates, id: candidate.id, selections});
			if (resolved.eligibility.some(it => it.dmApproval) && !approvalInput.checked) throw new Error("Confirm DM approval before previewing this recipe.");
			decisions = {};
			const targets = getTargets();
			stamp = getStamp();
			batch = previewCreatureTransformationTargets({
				targets, resolved, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: approvalInput.checked,
			});
			renderBatch();
			if (!batch.previews.length) showError("No eligible monster can use this recipe; review the exact skips below.");
		} catch (e) { showError(e.message); }
	};
	const doApply = async () => {
		if (isSaving || !batch) return;
		isSaving = true;
		try {
			if (!reviewInput?.checked) throw new Error("Confirm that the manual-review items still need DM adjudication.");
			const currentCandidates = await load();
			if (!isCurrent()) throw new Error("The editor changed while the catalog was loading. Preview again.");
			const currentCandidate = currentCandidates.find(it => it.id === candidate.id);
			if (JSON.stringify(currentCandidate) !== JSON.stringify(candidate)) throw new Error("The transformation catalog changed. Preview again.");
			const currentResolved = resolveCreatureTransformation({candidates: currentCandidates, id: candidate.id, selections});
			if (JSON.stringify(currentResolved) !== JSON.stringify(resolved) || getStamp() !== stamp) throw new Error("The selection, encounter, or catalog changed. Preview again.");
			const changes = createCreatureTransformationChanges({batch, targets: getTargets(), conflictDecisions: decisions});
			if (!changes.length) throw new Error("No eligible monster remains to transform.");
			await pApply(changes);
			clearPreview();
			status.textContent = `Applied ${candidate.identity.name} to ${changes.length} ${changes.length === 1 ? "monster" : "monsters"}. Manual-review items still need DM adjudication.`;
		} catch (e) {
			if (e.isEncounterStatblockSaved) {
				clearPreview();
				previewButton.disabled = true;
				status.textContent = e.message;
			} else showError(`Transformation was not applied: ${e.message}`);
		} finally { isSaving = false; }
	};
}
