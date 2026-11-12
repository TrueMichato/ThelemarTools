import {createCreatureTransformationChanges, createCreatureTransformationFormChanges, previewCreatureTransformationForm, previewCreatureTransformationTargets, proposeCreatureTransformationTargetResidual} from "./bestiary-transformation-workflow.js";
import {inspectCreatureTransformationInputs, pLoadCreatureTransformationInputTable} from "./bestiary-transformation-inputs.js";
import {observeCreatureTransformationBindings} from "../creature-transformation-bindings.js";

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
		case "setHitPoints": return `Set HP to ${step.value.average} (${step.value.formula})`;
		case "setArmorClass": return `Set AC to ${JSON.stringify(step.value)}`;
		case "setSaveBonus": return `Set ${Parser.attAbvToFull(step.ability)} save to ${step.value >= 0 ? "+" : ""}${step.value}`;
		case "setSkillBonus": return `Set ${step.skill} to ${step.value >= 0 ? "+" : ""}${step.value}`;
		case "setPassivePerception": return `Set passive Perception to ${step.value}`;
		case "setProficiencyBonus": return `Set proficiency bonus to +${step.value}`;
		case "setChallengeRating": return `Set CR to ${step.value.cr}, ${step.value.xp} XP (DMG 2014 estimate; any override remains in its receipt)`;
		case "setEntryNumbers": return `Reconcile ${step.section} ${step.match.name} (${step.match.source})`;
		case "addInnateSpellcasting": return `Add innate spellcasting ${step.name} (${step.source}), DC ${step.saveDc}, attack ${step.attackBonus >= 0 ? "+" : ""}${step.attackBonus}`;
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
		case "grantRelativeSpeed":
			if (step.relativeTo !== "walk" || (step.condition && step.condition !== "noMediumOrHeavyArmor")) throw new Error("Unsupported relative speed description.");
			return `${step.mode} speed equal to effective walking speed${step.condition ? " only while not wearing medium or heavy armor" : ""}`;
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

function renderEntryDelta (parent, entry) {
	const details = element("details", {className: "bqa__transformation-diff"});
	details.append(element("summary", {text: `${entry.section}: ${entry.name} (${entry.source || "chassis"}) - ${entry.before && entry.after ? "changed" : entry.after ? "added" : "removed"}`}));
	for (const [label, value] of [["Before", entry.before], ["After", entry.after]]) {
		details.append(element("h6", {text: label}));
		if (!value) { paragraph(details, "Not present"); continue; }
		const content = element("div");
		content.innerHTML = Renderer.get().render({...MiscUtil.copyFast(value), type: entry.section === "spellcasting" ? "spellcasting" : "entries"});
		content.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); }, true);
		content.querySelectorAll("button, a, [data-packed-dice]").forEach(node => { node.tabIndex = -1; });
		details.append(content);
	}
	parent.append(details);
}

function renderDiff (parent, diff) {
	const changes = [...diff.fields.map(({path, before, after}) => `${path}: ${JSON.stringify(before)} → ${JSON.stringify(after)}`),
		...diff.entries.map(({section, name, source, before, after}) =>
			`${section}: ${name} (${source || "chassis"}): ${before ? JSON.stringify(before) : "not present"} → ${after ? JSON.stringify(after) : "removed"}`)];
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
	hp: "Hit points",
	"hp.average": "HP average",
	"hp.formula": "Hit Dice formula",
	ac: "Armor Class (ordered alternatives)",
	save: "Saving throws",
	skill: "Skills",
	passive: "Passive Perception",
	profBonus: "Proficiency bonus",
	pbNote: "Proficiency display",
	cr: "Challenge rating",
	"cr.cr": "Challenge rating",
	"cr.xp": "XP",
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
		: path.startsWith("speed.alternate.") ? `${path.slice("speed.alternate.".length).replace(/^\w/, char => char.toUpperCase())} speed (alternate)`
			: path.startsWith("speed.") ? `${path.slice("speed.".length).replace(/^\w/, char => char.toUpperCase())} speed`
				: path.startsWith("save.") ? `${Parser.attAbvToFull(path.slice(5))} save`
					: path.startsWith("skill.") ? `${path.slice(6)} skill`
						: DELTA_FIELD_NAMES[path] || `Other field (${path})`;
	const formatSpeed = value => {
		if (typeof value === "number") return `${value} ft.`;
		if (Array.isArray(value)) return value.map(formatSpeed).join(", ") || "none";
		if (value && typeof value === "object") {
			if (Number.isSafeInteger(value.number) && typeof value.condition === "string" && Object.keys(value).length === 2) {
				return `${value.number} ft. ${value.condition}`;
			}
			if (!Object.hasOwn(value, "number")) {
				return Object.entries(value).map(([mode, speed]) => `${mode} ${formatSpeed(speed)}`).join(", ") || "none";
			}
		}
		return JSON.stringify(value);
	};
	const format = value => {
		if (value == null) return "none";
		if (path === "size" && Array.isArray(value)) return value.map(it => Parser.sizeAbvToFull(it)).join(", ") || "none";
		if (path === "type" && (typeof value === "string" || typeof value?.type === "string")) return Parser.monTypeToFullObj(value).asText;
		if (isSpeed) return formatSpeed(value);
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
		if (path === "hp" && typeof value?.average === "number" && typeof value.formula === "string") return `${value.average} (${value.formula})`;
		if (path === "cr" && typeof value?.cr === "string") return `${value.cr}${value.xp == null ? "" : ` (${value.xp} XP)`}`;
		if (["profBonus", "save", "skill"].includes(path.split(".")[0]) && typeof value === "number") return `${value >= 0 ? "+" : ""}${value}`;
		if ((DELTA_FIELD_NAMES[path] || isAbility || path.startsWith("save.") || path.startsWith("skill.")) && (typeof value === "string" || typeof value === "number")) return String(value);
		return JSON.stringify(value);
	};
	return `${label}: ${format(before)} → ${format(after)}`;
}

export function formatCreatureTransformationDeltaEntry ({section, name, source, chassisSource, before, after}) {
	const content = entry => entry ? JSON.stringify(entry) : "not present";
	return `${DELTA_ENTRY_NAMES[section] || section}: ${before && after ? "Changed" : after ? "Added" : "Removed"} ${name} (${source || chassisSource || "source unverified"}): ${content(before)} → ${content(after)}`;
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
		for (const entry of preview.diff.entries) {
			entryChanges.add(formatCreatureTransformationDeltaEntry({...entry, chassisSource: preview.original.source}));
		}
	}
	parent.append(element("h5", {text: "Mechanical delta · live preview"}));
	const changes = [...fieldChanges].map(([text, count]) => batch.previews.length > 1 ? `${text} (${count} of ${batch.previews.length})` : text);
	list(parent, [...changes, ...entryChanges].length ? [...changes, ...entryChanges] : ["No automatically representable change."]);
}

function renderPreviewTarget (parent, {id, label, preview, isConflictsOnly = false}, decisions, onDecision) {
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
	if (isConflictsOnly) { parent.append(section); return; }
	const sourcedEntries = preview.diff.entries.map(entry => ({...entry, source: entry.source || preview.original.source}));
	renderDiff(section, {...preview.diff, entries: sourcedEntries});
	sourcedEntries.forEach(entry => renderEntryDelta(section, entry));
	const pair = element("div", {className: "bqa__transformation-pair"});
	renderStatblock(pair, preview.current, "Before · current statblock");
	renderStatblock(pair, preview.proposed, "After · proposed statblock");
	section.append(pair);
	parent.append(section);
}

function renderGuidedTarget ({parent, target, resolved, onChange}) {
	const model = inspectCreatureTransformationInputs({target, resolved});
	const root = element("fieldset", {className: "bqa__transformation-resolution"});
	root.append(element("legend", {text: target.label}));
	const status = paragraph(root, "Needs answers");
	status.setAttribute("role", "status");
	const error = element("p", {className: "bqa__transformation-resolution-error"});
	error.id = `bqa-resolution-error-${++nextOptionGroupId}`;
	const output = element("div", {className: "bqa__transformation-cr-estimate"});
	output.setAttribute("aria-live", "polite");
	const fields = [];
	const answers = new Map();
	const proposals = [];
	const tokenPolicies = [];
	let readOwnership = () => null;
	let readSourcePb = () => undefined;
	const group = (parent, title) => {
		const node = element("details");
		node.open = true;
		node.append(element("summary", {text: title}));
		parent.append(node);
		return node;
	};
	const field = (parent, label, {options, type = "text", min, max, required = true, onEdit = null} = {}) => {
		const wrapper = element("label", {className: "bqa__field"});
		const input = element(options ? "select" : type === "textarea" ? "textarea" : "input", {className: "ve-form-control"});
		if (!options && type !== "textarea") input.type = type;
		if (options) {
			input.add(new Option("Choose…", ""));
			options.forEach(([value, name]) => input.add(new Option(name, String(value))));
		}
		if (type === "number") Object.assign(input, {min: String(min), max: String(max), step: "1"});
		else input.maxLength = 1000;
		input.required = required;
		input.setAttribute("aria-describedby", error.id);
		wrapper.append(element("span", {className: "bqa__field-label", text: label}), input);
		parent.append(wrapper);
		const item = {node: input, read: () => input.value === "" ? undefined : type === "number" ? Number(input.value) : input.value};
		fields.push(item);
		input.addEventListener(options ? "change" : "input", () => { onEdit?.(); onChange(); });
		return item;
	};
	const yesNo = [["yes", "Yes"], ["no", "No"]];
	const reason = (parent, label = "Reason / source policy") => field(parent, label, {type: "textarea"});
	const setEnabled = (node, enabled) => {
		node.hidden = !enabled;
		node.querySelectorAll("input, select, textarea, button").forEach(input => { input.disabled = !enabled; });
	};
	const crChoices = ["0", "1/8", "1/4", "1/2", ...Array.from({length: 30}, (_, i) => String(i + 1))].map(it => [it, it]);
	const control = (kind, selector) => model.controls.find(it => it.kind === kind && (selector === undefined || it.selector === selector));
	const read = () => ({targetKey: model.targetKey, controls: Object.fromEntries([...answers].map(([id, get]) => [id, get()]).filter(([, value]) => value !== undefined))});
	parent.append(root);
	if (model.status === "unsupported" || model.requirements.length) {
		status.textContent = model.status;
		error.textContent = model.requirements.map(it => it.reason).join("; ");
		root.append(error);
		return {root, model, read, update: () => {}, focus: () => { root.tabIndex = -1; root.focus(); }};
	}
	if (resolved.id === "catalog:dracolich|mm") {
		paragraph(root, `Observed type/traits/lair (not confirmations): ${JSON.stringify(model.facts)}`);
		const options = {
			age: [["adult", "Adult"], ["ancient", "Ancient"], ["young", "Young (ineligible)"], ["wyrmling", "Wyrmling (ineligible)"]],
			trueDragon: yesNo,
			shadowDragon: yesNo,
			physiology: [["amphibious-only", "Reviewed: only Amphibious removal; other traits retained"]],
			lairActions: [["retain", "Retain existing lair actions"]],
		};
		const labels = {age: "Age", trueDragon: "Is this a true dragon?", shadowDragon: "Is this a shadow dragon?", physiology: "Living physiology review", lairActions: "Lair policy"};
		for (const item of model.controls) {
			const input = field(root, labels[item.selector], {options: options[item.selector]});
			answers.set(item.id, () => ({value: ["trueDragon", "shadowDragon"].includes(item.selector)
				? input.read() === undefined ? undefined : input.read() === "yes" : input.read()}));
		}
	} else {
		paragraph(root, `Observed scores: ${JSON.stringify(model.facts.abilities)}. HP: ${JSON.stringify(model.facts.hp)}. Constitution HP policy; non-CON residual ${model.facts.hitPoints.residual}.`);
		const armor = group(root, "HP and armor policy");
		paragraph(armor, `Retain ordered AC/equipment/conditions: ${JSON.stringify(model.facts.ac)}. This staged producer does not change Dexterity or equipment.`);
		const retainArmor = field(armor, "Reviewed unchanged armor", {options: [["retain", "Retain this AC policy"]]});
		const armorReason = reason(armor);
		answers.set(control("armor").id, () => ({mode: retainArmor.read(), reason: armorReason.read()}));

		const pb = group(root, "Proficiency evidence and save / skill interpretation");
		paragraph(pb, `Observed explicit source PB: ${model.facts.explicitPb ?? "none"}. Ordinary CR-derived PB is not a source PB declaration. Values do not establish proficiency or expertise.`);
		const declare = field(pb, "Declare a current source PB?", {required: false, options: [["declare", "Declare with source reason"]]});
		const sourceFields = element("div");
		pb.append(sourceFields);
		const sourcePb = field(sourceFields, "Current source PB", {type: "number", min: 1, max: 30});
		const sourceReason = reason(sourceFields);
		readSourcePb = () => declare.read() ? sourcePb.read() : undefined;
		answers.set(control("proficiencyBonus").id, () => declare.read() ? {value: sourcePb.read(), reason: sourceReason.read()} : undefined);
		setEnabled(sourceFields, false);
		const invalidateProposals = () => proposals.forEach(it => it.invalidate());
		declare.node.addEventListener("change", () => { setEnabled(sourceFields, !!declare.read()); invalidateProposals(); onChange(); });
		sourcePb.node.addEventListener("input", invalidateProposals);
		const ownership = field(pb, "PB ownership (only for ambiguity or deliberate source-fixed policy)", {required: false, options: [["derived", "Derived from CR"], ["source-fixed", "Source-fixed"]]});
		const ownershipFields = element("div");
		pb.append(ownershipFields);
		const ownershipValue = field(ownershipFields, "Exact current PB for ownership answer", {type: "number", min: 1, max: 30});
		const ownershipReason = reason(ownershipFields);
		setEnabled(ownershipFields, false);
		ownership.node.addEventListener("change", () => { setEnabled(ownershipFields, !!ownership.read()); invalidateProposals(); onChange(); });
		ownershipValue.node.addEventListener("input", invalidateProposals);
		readOwnership = () => ownership.read() ? {mode: ownership.read(), value: ownershipValue.read(), reason: ownershipReason.read()} : null;
		for (const item of model.controls.filter(it => it.kind === "proficiency")) {
			const multiplier = field(pb, `${item.selector.section}: ${item.selector.name}, observed ${item.facts.total}, ability ${item.facts.ability} - PB multiplier`, {options: [[0, "0 - no PB"], [1, "1 - proficient"], [2, "2 - expertise"]]});
			const explanation = reason(pb, `${item.selector.name} interpretation reason`);
			answers.set(item.id, () => ({multiplier: multiplier.read() === undefined ? undefined : Number(multiplier.read()), reason: explanation.read()}));
		}
		const bindings = group(root, "Source-qualified entry bindings");
		for (const entry of model.entries.filter(it => it.needsBinding)) {
			const panel = group(bindings, `${entry.section}: ${entry.match.name} (${entry.match.source})`);
			paragraph(panel, JSON.stringify(entry.entry));
			const policy = field(panel, "Entry policy", {options: [["bind", "Bind every numeric token"], ["retain", "Retain entire entry explicitly"]]});
			const retention = reason(panel, "Entry retention reason");
			retention.node.disabled = true;
			answers.set(entry.id, () => policy.read() === "retain" ? {mode: "retain", reason: retention.read()} : undefined);
			const tokens = element("div");
			panel.append(tokens);
			setEnabled(tokens, false);
			policy.node.addEventListener("change", () => {
				retention.node.disabled = policy.read() !== "retain";
				setEnabled(tokens, policy.read() === "bind");
				tokenPolicies.filter(it => it.entryId === entry.id).forEach(it => it.sync());
				proposals.filter(it => it.entryId === entry.id).forEach(it => it.invalidate());
				onChange();
			});
			if (!entry.supported) paragraph(panel, `Unsupported binding: ${entry.reason}. Retention does not prove complete CR coverage.`);
			for (const token of entry.tokens) {
				const row = element("div", {className: "bqa__transformation-resolution-row"});
				tokens.append(row);
				paragraph(row, `Paragraph ${token.paragraph + 1}, ${token.kind} token ${token.token + 1}: ${token.value}${token.dice ? `; ${token.dice.number}d${token.dice.faces}, printed average ${token.average ?? "unsupported"}` : ""}. ${token.text}`);
				const interpretation = field(row, "Token interpretation", {options: [["ability", "Ability plus PB and reviewed residual"], ["fixed", "Source-fixed observed value"]]});
				const ability = field(row, "Governing ability", {options: ["str", "dex", "con", "int", "wis", "cha"].map(it => [it, Parser.attAbvToFull(it)])});
				const multiplier = field(row, "Token PB multiplier", {options: [[0, "0 - fixed / no PB"], [1, "1 - proficient"], [2, "2 - expertise"]]});
				const explanation = reason(row, "Token interpretation reason");
				const proposalText = paragraph(row, "No interpretation adopted.");
				let proposal = null;
				let adopted = false;
				const invalidate = () => { proposal = null; adopted = false; proposalText.textContent = "No interpretation adopted."; };
				proposals.push({entryId: entry.id, invalidate});
				const propose = button("Propose residual", () => {
					try {
						proposal = proposeCreatureTransformationTargetResidual({target,
							resolved,
							tokenId: token.id,
							ability: ability.read(),
							proficiency: multiplier.read() === undefined ? undefined : Number(multiplier.read()),
							proficiencyBonus: readSourcePb(),
							proficiencyAnswer: readOwnership()});
						adopted = false;
						proposalText.textContent = `Unaccepted proposal: observed ${proposal.observed}; ability modifier ${proposal.abilityModifier}; PB ${JSON.stringify(proposal.pb)}; residual ${proposal.fixed}.`;
						onChange();
					} catch (e) { error.textContent = e.message; }
				});
				const adopt = button("Adopt this interpretation", () => {
					if (!proposal || !explanation.read()?.trim()) { error.textContent = "Request a residual and supply an interpretation reason before adopting."; explanation.node.focus(); return; }
					adopted = true;
					proposalText.textContent = `Adopted residual ${proposal.fixed} for this exact ability/PB/token/history.`;
					onChange();
				});
				row.append(propose, adopt);
				interpretation.node.addEventListener("change", () => {
					ability.node.disabled = multiplier.node.disabled = propose.disabled = adopt.disabled = interpretation.read() !== "ability";
					invalidate();
					onChange();
				});
				tokenPolicies.push({entryId: entry.id,
					sync: () => {
						ability.node.disabled = multiplier.node.disabled = propose.disabled = adopt.disabled = policy.read() !== "bind" || interpretation.read() !== "ability";
					}});
				ability.node.addEventListener("change", () => { invalidate(); onChange(); });
				multiplier.node.addEventListener("change", () => { invalidate(); onChange(); });
				answers.set(token.id, () => policy.read() !== "bind" ? undefined : interpretation.read() === "fixed"
					? {mode: "fixed", value: token.value, reason: explanation.read()}
					: {mode: "ability", ability: ability.read(), proficiency: multiplier.read() === undefined ? undefined : Number(multiplier.read()), proposal, adopted, reason: explanation.read()});
			}
			setEnabled(tokens, false);
		}
		const cr = group(root, "DMG 2014 CR estimate - assumptions and three-round routines");
		const defense = group(cr, "Defense assumptions");
		paragraph(defense, `Expected CR suggestion (not accepted): ${JSON.stringify(model.current.cr)}. Poison immunity alone does not establish a defense multiplier.`);
		const expectedCr = field(defense, "Expected CR band (deliberately adopt or edit)", {options: crChoices});
		const acIndex = field(defense, "AC alternative to evaluate", {options: model.facts.ac.map((it, i) => [i, JSON.stringify(it)])});
		const resistance = field(defense, "Effective resistance policy", {options: [["none", "None"], ["resistance", "Resistance"], ["immunity", "Immunity"]]});
		const vulnerability = field(defense, "Prevalent multiple vulnerabilities?", {options: yesNo});
		const regeneration = field(defense, "Applicable regeneration per round", {type: "number", min: 0, max: 1000});
		const hpAdjustment = field(defense, "Estimate-only effective HP adjustment", {type: "number", min: -100_000, max: 100_000});
		const acAdjustment = field(defense, "Estimate-only effective AC adjustment", {type: "number", min: -100, max: 100});
		const hpBoundary = field(defense, "Exact 760 / 805 effective HP overlap policy (only if required)", {required: false, options: [["lower", "Lower row"], ["higher", "Higher row"]]});
		const defenseNote = reason(defense, "Defense policy and reviewed feature adjustments");
		const coverage = group(cr, "Review every entry's routine coverage");
		const coverageRows = model.entries.map(entry => {
			const decision = field(coverage, `${entry.section}: ${entry.match.name} (${entry.match.source})`, {options: [["represented", "Represented"], ["excluded", "Excluded with reviewed reason"]]});
			const explanation = reason(coverage, `${entry.match.name} coverage reason`);
			return () => ({entryId: entry.id, decision: decision.read(), reason: explanation.read()});
		});
		const routines = [];
		let nextRoutine = 0;
		const routineList = element("div");
		cr.append(routineList);
		const damageTokens = model.entries.filter(it => it.supported).flatMap(entry => entry.tokens.filter(it => it.kind === "damage")
			.map(token => [token.id, `${entry.match.name} (${entry.match.source}) - paragraph ${token.paragraph + 1}, damage ${token.token + 1}`]));
		const accuracyTokens = model.entries.filter(it => it.supported).flatMap(entry => entry.tokens.filter(it => ["hit", "dc"].includes(it.kind))
			.map(token => [token.id, `${entry.match.name} (${entry.match.source}) - ${token.kind} ${token.paragraph + 1}:${token.token + 1}`]));
		const routinePolicy = field(cr, "Routine selection policy", {options: [["highest-damage", "Evaluate highest three-round damage"]]});
		const refreshRoutinePolicy = () => {
			const previous = routinePolicy.node.value;
			routinePolicy.node.replaceChildren(new Option("Choose…", ""), new Option("Evaluate highest three-round damage", "highest-damage"));
			routines.forEach(it => routinePolicy.node.add(new Option(it.id, it.id)));
			routinePolicy.node.value = [...routinePolicy.node.options].some(it => it.value === previous) ? previous : "";
		};
		const addRoutine = button("Add alternative routine", () => {
			const id = `routine-${++nextRoutine}`;
			const panel = group(routineList, id);
			const rows = [];
			const rowList = element("div");
			panel.append(rowList);
			const accuracy = field(panel, "Predominant attack / save accuracy", {options: accuracyTokens});
			const mixedReason = reason(panel, "Predominant / mixed-accuracy explanation");
			const note = reason(panel, "Routine source and schedule explanation");
			const addRow = button("Add contribution", () => {
				const row = element("fieldset", {className: "bqa__transformation-resolution-row"});
				row.append(element("legend", {text: `Contribution ${rows.length + 1}`}));
				rowList.append(row);
				const source = field(row, "Damage contribution", {options: [...damageTokens, ["fixed", "Fixed numeric adjudication (not inferred spell / aura prose)"]]});
				const fixedFields = element("div");
				row.append(fixedFields);
				const fixedValue = field(fixedFields, "Fixed per-use value", {type: "number", min: 0, max: 100_000});
				fixedValue.node.step = "any";
				const fixedName = field(fixedFields, "Adjudication source name");
				const fixedSource = field(fixedFields, "Adjudication source code");
				const fixedReason = reason(fixedFields, "Fixed contribution reason");
				setEnabled(fixedFields, false);
				source.node.addEventListener("change", () => { setEnabled(fixedFields, source.read() === "fixed"); onChange(); });
				const timing = field(row, "Timing / use restriction", {options: ["normal", "conditional", "off-turn", "ongoing", "recharge", "limited-use"].map(it => [it, it])});
				const explanation = reason(row, "Contribution schedule reason");
				const counts = [];
				const targets = [];
				for (let i = 0; i < 3; ++i) {
					const round = element("div", {className: "bqa__transformation-resolution-row"});
					row.append(round);
					counts.push(field(round, `Round ${i + 1} uses`, {type: "number", min: 0, max: 20}));
					targets.push(field(round, `Round ${i + 1} targets`, {type: "number", min: 1, max: 100}));
				}
				const get = () => ({counts: counts.map(it => it.read()),
					targets: targets.map(it => it.read()),
					timing: timing.read(),
					reason: explanation.read(),
					...source.read() === "fixed" ? {fixed: {value: fixedValue.read(), source: {name: fixedName.read(), source: fixedSource.read()}, reason: fixedReason.read()}} : {tokenId: source.read()}});
				rows.push(get);
				row.append(button("Remove contribution", () => { rows.splice(rows.indexOf(get), 1); row.remove(); addRow.disabled = false; onChange(); addRow.focus({preventScroll: true}); }));
				addRow.disabled = rows.length >= 24;
				onChange();
			});
			panel.append(addRow);
			const item = {id, read: () => ({id, rows: rows.map(get => get()), accuracy: accuracy.read(), mixedReason: mixedReason.read(), note: note.read()})};
			routines.push(item);
			panel.append(button("Remove routine", () => {
				routines.splice(routines.indexOf(item), 1);
				panel.remove();
				addRoutine.disabled = false;
				refreshRoutinePolicy();
				onChange();
				addRoutine.focus({preventScroll: true});
			}));
			addRoutine.disabled = routines.length >= 12;
			refreshRoutinePolicy();
			onChange();
		});
		cr.append(addRoutine);
		const override = field(cr, "Override estimated CR?", {required: false, options: [["override", "Use an explicit override (estimate retained)"]]});
		const overrideFields = element("div");
		cr.append(overrideFields);
		const overrideCr = field(overrideFields, "Final CR override", {options: crChoices});
		const overrideReason = reason(overrideFields, "CR override reason");
		setEnabled(overrideFields, false);
		override.node.addEventListener("change", () => { setEnabled(overrideFields, !!override.read()); onChange(); });
		const zeroXp = field(cr, "Final CR0 no-threat 0 XP policy?", {options: [["no", "No - canonical XP (CR0 normally 10)"], ["yes", "Yes - final CR0 only"]]});
		const review = field(cr, "All relevant effects and complete alternatives reviewed?", {options: [["yes", "I confirm complete review"]]});
		const reviewReason = reason(cr, "Completeness explanation (never auto-authored)");
		answers.set(control("cr").id, () => ({
			defense: {expectedCr: expectedCr.read(),
				hpBoundary: hpBoundary.read() ?? null,
				acIndex: acIndex.read() === undefined ? undefined : Number(acIndex.read()),
				resistance: resistance.read(),
				vulnerability: vulnerability.read() === undefined ? undefined : vulnerability.read() === "yes",
				regeneration: regeneration.read(),
				hpAdjustment: hpAdjustment.read(),
				acAdjustment: acAdjustment.read(),
				note: defenseNote.read()},
			routines: routines.map(it => it.read()),
			routine: routinePolicy.read(),
			review: {confirmed: review.read() === "yes", reason: reviewReason.read()},
			override: override.read() ? {cr: overrideCr.read(), reason: overrideReason.read()} : null,
			zeroXp: zeroXp.read() === undefined ? undefined : zeroXp.read() === "yes",
			proficiencyAnswer: readOwnership(),
			coverage: coverageRows.map(get => get()),
		}));
	}
	root.append(error, output);
	return {root,
		model,
		read,
		focus: () => {
			const missing = fields.find(it => it.node.isConnected && !it.node.disabled && it.node.required && (it.read() === undefined || it.node.validity?.valid === false));
			const node = missing?.node || root;
			for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
			if (!missing) root.tabIndex = -1;
			node.focus();
		},
		update: compiled => {
			const missing = fields.filter(it => it.node.isConnected && !it.node.disabled && it.node.required && (it.read() === undefined || it.node.validity?.valid === false));
			fields.forEach(it => it.node.setAttribute("aria-invalid", String(missing.includes(it))));
			status.textContent = compiled?.status === "ready" ? "Ready" : compiled?.status === "needs-answers" ? "Needs answers" : compiled?.status || "Needs answers";
			error.textContent = compiled?.requirements.map(it => it.reason).join("; ") || "";
			output.replaceChildren();
			if (!compiled?.estimate) return;
			const {receipt, value} = compiled.estimate;
			paragraph(output, `DMG 2014 estimate, not playtested. Estimated CR ${receipt.estimatedCr}; defensive ${receipt.defensiveCr}; offensive ${receipt.offensiveCr}. Final CR ${value.cr}, ${value.xp} XP.`);
			paragraph(output, `Effective HP ${receipt.effectiveHp}; AC ${receipt.effectiveAc}; routine ${receipt.routineId}, DPR ${receipt.damagePerRound}, accuracy ${receipt.accuracy}. PB: ${JSON.stringify(receipt.proficiency)}.`);
			if (receipt.assumptions.override) paragraph(output, `Override (independent estimate retained): ${JSON.stringify(receipt.assumptions.override)}`);
			for (const routine of compiled.automationInputs.cr.assumptions.routines) paragraph(output, `${routine.id}: rounds ${JSON.stringify(routine.rounds)}; accuracy ${JSON.stringify(routine.accuracy)}.`);
			for (const entry of observeCreatureTransformationBindings({current: compiled.projection, chassisSource: target.baseCreature.source})) {
				for (const token of entry.tokens.filter(it => it.kind === "damage")) paragraph(output, `${entry.match.name} (${entry.match.source}), damage ${token.paragraph + 1}:${token.token + 1}: per-use printed average ${token.average ?? "unsupported"}.`);
			}
		}};
}

function renderSavedFormEditor ({mount, getTargets, getStamp, getConsequences, validateChange, pApply, isCurrent, savedOperationId, onCancel}) {
	const container = element("section", {className: "bqa__transformation"});
	mount.replaceChildren(container);
	const isActive = () => isCurrent() && mount.contains(container);
	const controls = element("fieldset", {className: "bqa__transformation-resolution bqa__transformation-form-controls"});
	controls.append(element("legend", {text: "Switch saved form"}));
	const identity = paragraph(controls, "");
	paragraph(controls, "Only permitted saved profiles are available. Rules, assumptions, CR overrides and original consent are frozen; nothing is loaded or recompiled. Kernel-only fixtures are not source-defined family forms.");
	const label = element("label", {className: "bqa__field"});
	const picker = element("select", {className: "ve-form-control"});
	picker.dataset.savedForm = savedOperationId;
	label.append(element("span", {className: "bqa__field-label", text: "Permitted saved form"}), picker);
	const frozen = element("details");
	frozen.append(element("summary", {text: "Saved profiles and receipts (read-only)"}));
	controls.append(label, frozen);
	const error = element("p", {className: "bqa__transformation-error"});
	error.id = `bqa-form-error-${++nextOptionGroupId}`;
	error.setAttribute("role", "alert");
	picker.setAttribute("aria-describedby", error.id);
	const status = element("p");
	status.setAttribute("role", "status");
	status.setAttribute("aria-live", "polite");
	const result = element("div");
	const review = element("div", {className: "bqa__transformation-summary"});
	review.setAttribute("aria-label", "Encounter consequences to review");
	review.setAttribute("role", "region");
	review.tabIndex = -1;
	review.hidden = true;
	const actions = element("div", {className: "bqa__transformation-actions"});
	const apply = button("Switch form", doApply, "ve-btn ve-btn-primary ve-btn-sm");
	actions.append(apply);
	if (onCancel) actions.append(button("Cancel", () => { if (!saving) return onCancel(); }));
	container.append(controls, error, status, result, review, actions);
	let batch = null;
	let stamp;
	let decisions = {};
	let reviewedKey = null;
	let confirmation = null;
	let saving = false;
	const readTarget = () => {
		const targets = getTargets();
		if (targets.length !== 1) throw new Error("Saved form editing requires exactly one existing owner target.");
		return targets[0];
	};
	const clearReview = () => { reviewedKey = null; confirmation = null; review.hidden = true; review.replaceChildren(); };
	const preview = () => {
		batch = null;
		apply.disabled = true;
		clearReview();
		result.replaceChildren();
		error.textContent = status.textContent = "";
		try {
			const target = readTarget();
			const owner = target.operations.find(it => it.id === savedOperationId);
			const forms = owner?.data?.resolved?.frozenForms;
			if (!forms) throw new Error("This saved frozen form owner no longer exists. Reopen its current history action.");
			const selected = picker.value || forms.activeForm;
			picker.replaceChildren(...forms.profiles.map(it => new Option(it.label, it.id)));
			picker.value = selected;
			const active = forms.profiles.find(it => it.id === forms.activeForm);
			identity.textContent = `${target.label}: ${owner.data.resolved.identity.name} (${owner.data.resolved.identity.source}) · owner ${owner.id} · position ${target.operations.indexOf(owner) + 1} of ${target.operations.length} · current saved form: ${active.label}`;
			frozen.replaceChildren(element("summary", {text: "Saved profiles and receipts (read-only)"}));
			list(frozen, forms.profiles.map(it => `${it.label}: ${JSON.stringify(it.resolved)}`));
			batch = previewCreatureTransformationForm({target, operationId: savedOperationId, formId: picker.value, conflictDecisions: decisions, validateChange});
			stamp = getStamp();
			picker.setAttribute("aria-invalid", "false");
			if (batch.noChange) { status.textContent = "This saved form is already active. No changes to save."; return; }
			const display = {id: target.id,
				label: target.label,
				isConflictsOnly: !batch.canApply,
				preview: {...batch.preview,
					original: target.baseCreature,
					current: batch.current,
					proposed: batch.proposed || batch.preview.proposed,
					diff: batch.diff || batch.preview.diff}};
			if (batch.canApply) renderCompactDelta(result, {previews: [display]});
			renderPreviewTarget(result, display, {[target.id]: decisions}, (id, path, winner) => {
				if (saving) return;
				if (winner) decisions[path] = winner;
				else delete decisions[path];
				preview();
				[...result.querySelectorAll("select[data-conflict-path]")].find(it => it.dataset.conflictPath === path)?.focus({preventScroll: true});
			});
			apply.disabled = !batch.canApply;
			status.textContent = batch.canApply ? "Whole-history preview only - nothing saved." : "Choose each owner conflict winner to preview the complete resulting history.";
		} catch (e) {
			batch = null;
			picker.setAttribute("aria-invalid", "true");
			error.textContent = `Cannot switch this saved form: ${e.message}`;
		}
	};
	picker.addEventListener("change", () => { if (!saving) { decisions = {}; preview(); } });
	async function doApply () {
		if (saving || !isActive() || !batch?.canApply) return;
		saving = true;
		error.textContent = "";
		try {
			const target = readTarget();
			if (stamp !== getStamp() || JSON.stringify(target) !== JSON.stringify(batch.target)) {
				decisions = {};
				preview();
				throw new Error("The owner or whole history changed. Review the refreshed preview and apply again.");
			}
			const verified = previewCreatureTransformationForm({target, operationId: savedOperationId, formId: picker.value, conflictDecisions: decisions, validateChange});
			if (JSON.stringify(verified) !== JSON.stringify(batch)) {
				preview();
				throw new Error("The form or storage preview changed. Review and apply again.");
			}
			const changes = createCreatureTransformationFormChanges({batch: verified, target, operationId: savedOperationId, formId: picker.value, conflictDecisions: decisions});
			if (!changes.length) return;
			const effects = getConsequences(changes);
			if (effects?.resetHpIds?.length || effects?.splitIds?.length || reviewedKey) {
				const key = JSON.stringify({batch: verified, stamp, effects});
				if (key !== reviewedKey) {
					clearReview();
					reviewedKey = key;
					review.append(element("h5", {text: "Review encounter consequences - not saved"}));
					const names = ids => ids.map(id => id === target.id ? target.label : id).join(", ");
					if (effects?.resetHpIds?.length) paragraph(review, `HP will reset for ${names(effects.resetHpIds)}. Current and maximum HP reset to the new average (or Unset); temporary HP is preserved.`);
					if (effects?.splitIds?.length) paragraph(review, `${names(effects.splitIds)} will leave incompatible encounter groups.`);
					if (!effects?.resetHpIds?.length && !effects?.splitIds?.length) paragraph(review, "No HP resets or encounter group changes are now expected.");
					const label = element("label", {className: "bqa__transformation-check"});
					confirmation = element("input");
					confirmation.type = "checkbox";
					confirmation.checked = false;
					label.append(confirmation, document.createTextNode(" I confirm these encounter consequences for this saved form switch."));
					review.append(label);
					review.hidden = false;
					status.textContent = "No changes saved. Review, confirm, then Switch form again.";
					review.focus();
					return;
				}
				if (!confirmation.checked) { confirmation.focus(); throw new Error("Confirm the reviewed encounter consequences before switching."); }
			}
			if (!isActive() || stamp !== getStamp() || JSON.stringify(readTarget()) !== JSON.stringify(target)) throw new Error("The editor changed before saving. Review again.");
			const locked = [...container.querySelectorAll("button, input, select, textarea")].map(node => ({node, disabled: node.disabled}));
			locked.forEach(({node}) => { node.disabled = true; });
			status.textContent = "Saving the selected frozen form...";
			try { await pApply(changes); } finally { locked.forEach(({node, disabled}) => { if (node.isConnected) node.disabled = disabled; }); }
			if (!isActive()) return;
			preview();
			status.textContent = "Saved form switched. The same owner and history position were retained.";
			picker.focus();
			picker.scrollIntoView({block: "nearest", inline: "nearest"});
		} catch (e) {
			if (!isActive()) return;
			if (e.isEncounterStatblockSaved) {
				batch = null;
				apply.disabled = true;
				clearReview();
				status.textContent = e.message;
				error.textContent = "";
			} else {
				status.textContent = "";
				error.textContent = `Saved form was not switched: ${e.message}. Review and retry explicitly.`;
			}
		} finally { saving = false; }
	}
	preview();
}

export async function pRenderCreatureTransformationEditor ({mount, getTargets, getStamp = () => "", getConsequences = () => null, validateOperation = null, validateChange = null, pApply, isBulk = false, pLoadCandidates = null, isCurrent = () => true, automationVersion = 1, savedOperationId = null, onCancel = null}) {
	if (savedOperationId != null) return renderSavedFormEditor({mount, getTargets, getStamp, getConsequences, validateChange, pApply, isCurrent, savedOperationId, onCancel});
	if (![1, 2].includes(automationVersion)) throw new Error("Unsupported internal transformation editor version.");
	const container = element("section", {className: "bqa__transformation"});
	mount.replaceChildren(container);
	const isActive = () => isCurrent() && mount.contains(container);
	paragraph(container, "Choose a recipe to see its effect. Previewing never edits the source creature or saved encounter.");
	const error = element("p", {className: "bqa__transformation-error"});
	error.setAttribute("role", "alert");
	const status = element("p", {className: "bqa__transformation-status"});
	status.setAttribute("role", "status");
	status.setAttribute("aria-live", "polite");
	const input = element("div", {className: "bqa__transformation-input"});
	const details = element("div");
	const consequenceReview = element("div", {className: "bqa__transformation-summary"});
	consequenceReview.setAttribute("role", "region");
	consequenceReview.setAttribute("aria-label", "Encounter consequences to review");
	consequenceReview.tabIndex = -1;
	consequenceReview.hidden = true;
	const result = element("div");
	const warnings = element("div", {className: "bqa__transformation-summary"});
	warnings.setAttribute("role", "status");
	warnings.hidden = true;
	container.append(warnings, input, details, error, status, result);
	status.textContent = "Loading site, prerelease, and homebrew transformation candidates…";
	const showError = message => { error.textContent = message; };
	let candidates;
	let load;
	const loadWithWarnings = async () => {
		const skipped = [];
		const loaded = await load({onWarning: warning => skipped.push(warning)});
		if (!Array.isArray(loaded)) throw new Error("The transformation catalog did not return a candidate list.");
		if (!isActive()) return loaded;
		warnings.replaceChildren();
		warnings.hidden = !skipped.length;
		if (skipped.length) {
			warnings.append(element("h5", {text: `Skipped unavailable recipes: ${skipped.length}`}));
			list(warnings, skipped.map(it => `${it.name || `${it.kind} entry ${it.index + 1}`} (${it.source || "unknown source"}): ${it.reason}`));
			if (!loaded.length) paragraph(warnings, "No usable recipes remain. Correct the listed entries and reopen this editor.");
		}
		return loaded;
	};
	try {
		load = pLoadCandidates || (await import("../creature-transformations.js")).pLoadCreatureTransformationCandidates;
		candidates = await loadWithWarnings();
		if (!Array.isArray(candidates)) throw new Error("The transformation catalog did not return a candidate list.");
	} catch (e) {
		if (!isActive()) return;
		status.textContent = "";
		showError(`Could not load creature transformations: ${e.message}`);
		container.append(button("Retry catalog load", () => pRenderCreatureTransformationEditor({
			mount, getTargets, getStamp, getConsequences, validateOperation, pApply, isBulk, pLoadCandidates, isCurrent, automationVersion,
		})));
		return;
	}
	if (!isActive()) return;
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
	let isCommitting = false;
	let generation = 0;
	let crTable;
	let tableRequest = 0;
	let tableLoading = false;
	let tableError = "";
	let resolution = null;
	let consequenceKey = null;
	const guidedPanels = new Map();
	const isGuided = () => automationVersion === 2 && candidate?.kind === "catalog";
	const readGuidedAnswers = targets => Object.fromEntries(targets.map(target => {
		const panel = guidedPanels.get(`${candidate.id}:${target.id}`);
		return [target.id, panel?.stale ? undefined : panel?.read()];
	}).filter(([, answer]) => answer));
	const clearConsequenceReview = () => {
		consequenceKey = null;
		consequenceReview.hidden = true;
		consequenceReview.replaceChildren();
	};
	const clearConsent = () => {
		if (confirmation) confirmation.hidden = true;
		confirmationInputs.forEach(it => { it.checked = false; });
		clearConsequenceReview();
	};
	const invalidate = targetId => {
		generation++;
		if (targetId) delete decisions[targetId];
		else decisions = {};
		clearConsent();
	};
	container.addEventListener("input", () => { generation++; }, true);
	container.addEventListener("change", () => { generation++; }, true);

	const clearPreview = () => {
		batch = null;
		stamp = null;
		resolved = null;
		clearConsequenceReview();
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
		if (isCommitting) return;
		invalidate();
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
		if (isCommitting) return;
		invalidate();
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
		if (isGuided()) {
			paragraph(details, candidate.id === "catalog:zombie|dmg"
				? "Staged numerical preview - incomplete template"
				: candidate.id === "catalog:dracolich|mm" ? "Staged rules preview - incomplete template"
					: "Unsupported staged identity - no guided automation producer.");
		}
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
			invalidate();
			syncConditional();
			clearPreview();
			confirmation.hidden = true;
			renderReview();
			doPreview();
		};
		syncConditional();
		const config = element("div", {className: "bqa__transformation-config"});
		resolution = element("div");
		details.append(resolution);
		delta = element("div", {className: "bqa__transformation-delta"});
		if (candidate.optionGroups.length) config.append(options);
		else config.classList.add("bqa__transformation-config--no-options");
		config.append(delta);
		details.append(config);
		if (isGuided()) details.append(consequenceReview);
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
		if (isGuided() || candidate.eligibility.dmApproval || candidate.optionGroups.some(group => group.options.some(option => option.eligibility?.dmApproval))) {
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
		if (isGuided() && tableError) action.append(button("Retry CR table load", loadTable));
		if (isGuided()) {
			for (const target of batch.targets) {
				const panel = guidedPanels.get(`${candidate.id}:${target.id}`);
				if (!panel?.stale) panel?.update(batch.guidedModels.find(it => it.targetId === target.id));
			}
		}
		const summary = element("div", {className: "bqa__transformation-summary"});
		paragraph(summary, `${batch.previews.length} eligible · ${batch.skipped.length} skipped. Statblocks show only automatic changes; DM review remains separate.`);
		if (batch.skipped.length) {
			summary.append(element("h5", {text: "Skipped · unchanged"}));
			list(summary, batch.skipped.map(it => `${it.label}: ${it.reason}`));
			if (isGuided()) {
				for (const target of batch.skipped) {
					const panel = guidedPanels.get(`${candidate.id}:${target.id}`);
					if (panel && !panel.stale) summary.append(button(`Review answers for ${target.label}`, panel.focus));
				}
			}
		}
		result.append(summary);
		renderCompactDelta(delta, batch);
		for (const target of batch.previews) {
			renderPreviewTarget(result, target, decisions, (id, path, winner) => {
				if (isCommitting) return;
				generation++;
				clearConsent();
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
						...isGuided() ? {guidedAnswers: readGuidedAnswers(getTargets()), crTable, generation} : {},
					});
					renderBatch();
					result.querySelectorAll("select[data-conflict-id]").forEach(select => {
						if (select.dataset.conflictId === id && select.dataset.conflictPath === path) select.focus({preventScroll: true});
					});
				} catch (e) { showError(e.message); }
			});
			const model = batch.guidedModels?.find(it => it.targetId === target.id);
			if (model?.estimate && target.preview.conflicts.some(it => decisions[target.id]?.[it.path] === "existing"
				&& /^(?:str|dex|con|int|wis|cha|hp|ac|passive|profBonus|pbNote|cr|save\.|skill\.|trait:|action:|bonus:|reaction:|legendary:|spellcasting:)/.test(it.path))) {
				paragraph(result, "Incoming estimate not applied - existing numerical group retained");
			}
		}
		if (approvalInput) approvalInput.parentElement.hidden = !batch.previews.some(it => it.preview.resolved.eligibility.some(rule => rule.dmApproval));
		if (!batch.previews.length) return;
		if (batch.previews.some(it => !it.preview.canApply)) {
			paragraph(action, "Choose an existing or incoming winner for each overlapping change to complete the preview.");
			return;
		}
		const apply = button(isBulk ? `Apply to ${batch.previews.length} · one save` : "Apply transformation", doApply, "bqa__transformation-apply ve-btn ve-btn-primary ve-btn-sm");
		action.append(apply, element("span", {text: "Preview only · no changes saved yet."}));
	};
	const loadTable = async () => {
		const request = ++tableRequest;
		tableLoading = true;
		tableError = "";
		try {
			const loaded = await pLoadCreatureTransformationInputTable({requested: true});
			if (!isActive() || request !== tableRequest) return;
			if (!Array.isArray(loaded)) throw new Error("CR table did not return its version-matched rows.");
			crTable = loaded;
		} catch (e) {
			if (!isActive() || request !== tableRequest) return;
			tableError = `Could not load CR table: ${e.message}`;
		} finally {
			if (isActive() && request === tableRequest) { tableLoading = false; doPreview(); }
		}
	};
	const syncGuidedPanels = targets => {
		for (const target of targets) {
			const key = `${candidate.id}:${target.id}`;
			let panel = guidedPanels.get(key);
			const model = inspectCreatureTransformationInputs({target, resolved});
			if (!panel) {
				panel = renderGuidedTarget({parent: resolution, target, resolved, onChange: () => { if (!isCommitting) { invalidate(target.id); doPreview(); } }});
				panel.recipeKey = JSON.stringify(resolved);
				guidedPanels.set(key, panel);
			} else if ((panel.model.targetKey !== model.targetKey || panel.recipeKey !== JSON.stringify(resolved) || panel.stale) && !panel.staleNotice) {
				panel.stale = true;
				panel.root.disabled = true;
				const stale = element("div", {className: "bqa__transformation-resolution-error"});
				paragraph(stale, `Stale draft for ${target.label} (${panel.model.sourceUid}). Source, entry identity or history changed. Old answers were not retargeted.`);
				stale.append(button("Discard stale draft and start new answers", () => {
					panel.root.remove();
					stale.remove();
					guidedPanels.delete(key);
					invalidate();
					doPreview();
					guidedPanels.get(key)?.focus();
				}));
				panel.staleNotice = stale;
			}
			if (panel.root.parentElement !== resolution) resolution.append(panel.root);
			if (panel.staleNotice?.parentElement !== resolution && panel.staleNotice) resolution.append(panel.staleNotice);
		}
		for (const [key, panel] of guidedPanels) {
			if (!key.startsWith(`${candidate.id}:`) || targets.some(it => key === `${candidate.id}:${it.id}`)) continue;
			panel.root.disabled = true;
			panel.stale = true;
			if (panel.root.parentElement !== resolution) resolution.append(panel.root);
			panel.update({status: "Stale draft - target no longer selected", requirements: []});
		}
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
			if (isGuided() && !["catalog:zombie|dmg", "catalog:dracolich|mm"].includes(candidate.id)) {
				paragraph(delta, "Unsupported staged identity - no guided automation producer. No legacy fallback was applied.");
				return;
			}
			resolved = resolveCreatureTransformation({candidates, id: candidate.id, selections, automationVersion: isGuided() ? 2 : 1});
			const targets = getTargets();
			if (isGuided()) {
				syncGuidedPanels(targets);
				if (candidate.id === "catalog:zombie|dmg" && crTable === undefined) {
					status.textContent = tableError || "Loading version-matched CR table…";
					if (!tableError && !tableLoading) loadTable();
				}
			}
			stamp = getStamp();
			batch = previewCreatureTransformationTargets({
				targets,
				resolved,
				acknowledgedPrerequisites: resolved.prerequisites,
				dmApproved: true,
				conflictDecisions: decisions,
				...isGuided() ? {guidedAnswers: readGuidedAnswers(targets), crTable, generation} : {},
			});
			renderBatch();
			if (!batch.previews.length) showError("No eligible monster can use this recipe; review the skipped targets below.");
		} catch (e) { showError(e.message); }
	};
	const doApply = async () => {
		if (isSaving || !batch) return;
		if (!isActive()) return;
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
		const selectedGeneration = generation;
		const selectedAnswers = isGuided() ? structuredClone(readGuidedAnswers(getTargets())) : undefined;
		const selectedConsent = confirmationInputs.map(it => it.checked);
		const selectedTable = structuredClone(crTable);
		const selectedResolved = resolved;
		const guided = isGuided();
		const apply = action.querySelector(".bqa__transformation-apply");
		apply.disabled = true;
		status.textContent = "Checking the live catalog, targets, and storage before saving…";
		try {
			const currentCandidates = await loadWithWarnings();
			const currentTable = guided && selectedCandidate.id === "catalog:zombie|dmg"
				? await pLoadCreatureTransformationInputTable({requested: true}) : crTable;
			if (!isActive()) return;
			if (guided && JSON.stringify(currentTable) !== JSON.stringify(selectedTable)) {
				crTable = currentTable;
				invalidate();
				doPreview();
				throw new Error("The CR table changed. Review the current estimate and confirm again.");
			}
			if (batch !== selectedBatch || candidate !== selectedCandidate || picker.value !== selectedCandidate.id || !visibleIds.has(selectedCandidate.id)
				|| generation !== selectedGeneration || JSON.stringify(confirmationInputs.map(it => it.checked)) !== JSON.stringify(selectedConsent)
				|| JSON.stringify(selections) !== JSON.stringify(selectedSelections) || JSON.stringify(decisions) !== JSON.stringify(selectedDecisions)
				|| (guided && JSON.stringify(readGuidedAnswers(getTargets())) !== JSON.stringify(selectedAnswers))) {
				clearConsent();
				throw new Error("The filters, choices, or conflict winners changed. Review the new preview before applying.");
			}
			const currentCandidate = currentCandidates.find(it => it.id === selectedCandidate.id);
			if (JSON.stringify(currentCandidate) !== JSON.stringify(selectedCandidate)) {
				candidates = currentCandidates;
				refreshSources();
				refreshOptions();
				renderCandidate();
				throw new Error("The transformation catalog changed. Review the source and retained stale draft before answering again.");
			}
			const currentResolved = resolveCreatureTransformation({candidates: currentCandidates, id: selectedCandidate.id, selections: selectedSelections, automationVersion: guided ? 2 : 1});
			if (JSON.stringify(currentResolved) !== JSON.stringify(selectedResolved) || getStamp() !== stamp) {
				invalidate();
				doPreview();
				throw new Error("The selection or encounter changed. Review the current targets and preview again.");
			}
			const targets = getTargets();
			if (JSON.stringify(targets) !== JSON.stringify(selectedBatch.targets)) {
				invalidate();
				doPreview();
				throw new Error("A target or its statblock history changed. Review the current targets and preview again.");
			}
			const verified = previewCreatureTransformationTargets({
				targets,
				resolved: currentResolved,
				acknowledgedPrerequisites: confirmationInputs.slice(0, currentResolved.prerequisites.length)
					.map((it, index) => it.checked ? currentResolved.prerequisites[index] : null).filter(Boolean),
				dmApproved: !selectedBatch.previews.some(it => it.preview.resolved.eligibility.some(rule => rule.dmApproval)) || !!approvalInput?.checked,
				conflictDecisions: selectedDecisions,
				validateOperation,
				...guided ? {guidedAnswers: readGuidedAnswers(targets), crTable: currentTable, generation} : {},
			});
			const previewShape = snapshot => JSON.stringify({
				skipped: snapshot.skipped,
				previews: snapshot.previews.map(({id, preview}) => ({id, proposed: preview.proposed, conflicts: preview.conflicts, diff: preview.diff})),
			});
			if (previewShape(verified) !== previewShape(selectedBatch)) {
				batch = verified;
				clearConsent();
				renderBatch();
				throw new Error("Storage or eligibility changed the preview. Review its skipped targets and apply again.");
			}
			const changes = createCreatureTransformationChanges({batch: verified,
				targets,
				resolved: currentResolved,
				conflictDecisions: decisions,
				...guided ? {guidedAnswers: readGuidedAnswers(getTargets()), crTable: currentTable, generation} : {}});
			if (!changes.length) throw new Error("No eligible monster remains to transform.");
			const effects = getConsequences(changes);
			const hasEffects = effects?.resetHpIds?.length || effects?.splitIds?.length;
			if (hasEffects || (guided && consequenceKey)) {
				const names = ids => ids.map(id => targets.find(it => it.id === id).label).join(", ");
				const effectsText = [
					effects?.resetHpIds?.length ? `HP will reset for ${names(effects.resetHpIds)}.` : "",
					effects?.splitIds?.length ? `${names(effects.splitIds)} will leave ${guided ? "incompatible encounter groups" : "shared-turn groups"}.` : "",
				].filter(Boolean).join(" ");
				if (guided) {
					// Consent events advance live async generation, not the frozen draft revision.
					const currentKey = JSON.stringify({generation: selectedBatch.generation,
						targets,
						resolved: currentResolved,
						selections: selectedSelections,
						guidedAnswers: selectedAnswers,
						conflictDecisions: selectedDecisions,
						crTable: currentTable,
						readyIds: verified.previews.map(it => it.id),
						skipped: verified.skipped,
						effects});
					if (currentKey !== consequenceKey) {
						clearConsent();
						consequenceKey = currentKey;
						consequenceReview.append(element("h5", {text: "Review encounter consequences - not saved"}));
						paragraph(consequenceReview, effectsText || "No HP resets or encounter group changes are now expected.");
						if (effects?.resetHpIds?.length) paragraph(consequenceReview, "Current and maximum HP will reset to the new statblock average (or Unset); temporary HP is preserved.");
						paragraph(consequenceReview, "Review these consequences, then confirm the prerequisites and DM approval again to save.");
						consequenceReview.hidden = false;
						confirmation.hidden = false;
						status.textContent = "No changes saved. Encounter consequences need fresh review and confirmation.";
						showError("");
						consequenceReview.focus();
						return;
					}
				}
				status.textContent = effectsText;
			}
			if (!isActive() || generation !== selectedGeneration || JSON.stringify(getTargets()) !== JSON.stringify(targets)) throw new Error("The editor changed before saving. Review again.");
			isCommitting = true;
			const locked = [...container.querySelectorAll("input, select, textarea, button")].map(node => ({node, disabled: node.disabled}));
			locked.forEach(({node}) => { node.disabled = true; });
			try { await pApply(changes); } finally {
				isCommitting = false;
				locked.forEach(({node, disabled}) => { if (node.isConnected) node.disabled = disabled; });
			}
			if (!isActive()) return;
			clearPreview();
			status.textContent = `Applied ${selectedCandidate.identity.name} to ${changes.length} ${changes.length === 1 ? "monster" : "monsters"}. Manual-review items still need DM adjudication.`;
		} catch (e) {
			if (!isActive()) return;
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
