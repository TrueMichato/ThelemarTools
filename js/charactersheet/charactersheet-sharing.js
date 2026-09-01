import {HubApiClient} from "../hub/hub-api-client.js";

/**
 * Owner-facing sharing controls for ADR 0011 projection policy.
 *
 * This module renders *controls* and sends the resulting policy to the server. It
 * deliberately implements no projection logic: it never resolves a preset, derives a
 * catalog value, or applies an override. Everything the owner is shown as "what players
 * see" is the server-computed preview returned beside the policy.
 */

export const PRESET_CHOICES = Object.freeze([
	{
		value: "table",
		label: "Table view",
		description: "Share the usual at-the-table details: name, species, classes, abilities, saves, skills, AC, HP, speed, senses and conditions. Inventory and carried weight stay private.",
	},
	{
		value: "minimal",
		label: "Name and class only",
		description: "Share only who this character is: name, species and classes. Everything else stays private.",
	},
	{
		value: "open",
		label: "Open book",
		description: "Share every field the Hub supports, including an inventory summary and carried weight.",
	},
	{
		value: "private",
		label: "Private",
		description: "Share nothing. Other players see this character on the roster only if you also share their name; hiding your name keeps you off shared target lists.",
	},
]);

export const MODE_CHOICES = Object.freeze([
	{value: "share", label: "Share"},
	{value: "hide", label: "Hide"},
	{value: "replace", label: "Show instead"},
]);

const ABILITY_KEYS = Object.freeze(["str", "dex", "con", "int", "wis", "cha"]);
const MOVEMENT_KEYS = Object.freeze(["walk", "fly", "swim", "climb", "burrow"]);
const SKILL_RANKS = Object.freeze(["none", "half", "proficient", "expertise"]);
const SKILL_KEYS = Object.freeze([
	"athletics", "acrobatics", "sleightOfHand", "stealth", "arcana", "history",
	"investigation", "nature", "religion", "animalHandling", "insight", "medicine",
	"perception", "survival", "deception", "intimidation", "performance", "persuasion",
	"cooking", "culture", "endurance", "engineering", "harvesting", "linguistics", "might",
]);

const num = (key, label, {min = 0, max = 999, step = 1, isRequired = false} = {}) => ({
	key,
	label,
	kind: "number",
	min,
	max,
	step,
	isRequired,
});
const text = (key, label, {isRequired = false, maxLength = 120} = {}) => ({key, label, kind: "text", isRequired, maxLength});

/**
 * Presentation metadata only: which labelled controls make up a replacement value for
 * each catalog field. Validation remains entirely server-side.
 */
export const FIELD_DESCRIPTORS = Object.freeze({
	identity: {
		label: "Name and portrait",
		shape: "object",
		parts: [text("name", "Shown name", {isRequired: true}), text("pronouns", "Pronouns", {maxLength: 40}), text("avatar.url", "Portrait image address", {maxLength: 2000})],
	},
	species: {
		label: "Species",
		shape: "object",
		parts: [text("name", "Shown species", {isRequired: true}), text("source", "Source", {maxLength: 30})],
	},
	classes: {
		label: "Classes",
		shape: "rows",
		parts: [text("name", "Class", {isRequired: true}), text("source", "Source", {maxLength: 30}), num("level", "Level", {min: 0, max: 20, isRequired: true})],
	},
	abilities: {
		label: "Ability scores",
		shape: "object",
		parts: ABILITY_KEYS.map(key => num(key, key.toUpperCase(), {min: 1, max: 30, isRequired: true})),
	},
	saves: {
		label: "Saving throws",
		shape: "object",
		parts: ABILITY_KEYS.flatMap(key => [
			num(`${key}.modifier`, `${key.toUpperCase()} modifier`, {min: -99, max: 99, isRequired: true}),
			{key: `${key}.proficient`, label: `${key.toUpperCase()} proficient`, kind: "checkbox", isRequired: true},
		]),
	},
	skills: {
		label: "Skills",
		shape: "object",
		parts: SKILL_KEYS.flatMap(key => [
			num(`${key}.modifier`, `${key} modifier`, {min: -99, max: 99}),
			{key: `${key}.rank`, label: `${key} training`, kind: "select", options: SKILL_RANKS},
		]),
	},
	ac: {label: "Armour class", shape: "object", parts: [num("value", "Shown AC", {min: 0, max: 99, isRequired: true})]},
	hp: {
		label: "Hit points",
		shape: "object",
		parts: [
			num("current", "Current"),
			num("max", "Maximum"),
			num("temp", "Temporary"),
			text("state", "Or a word instead of numbers", {maxLength: 40}),
		],
	},
	speed: {label: "Speed", shape: "object", parts: MOVEMENT_KEYS.map(key => num(key, key))},
	senses: {label: "Senses", shape: "rows", parts: [text("name", "Sense", {isRequired: true, maxLength: 40}), num("range", "Range")]},
	conditions: {label: "Conditions", shape: "list", itemLabel: "Condition"},
	diseases: {label: "Diseases", shape: "list", itemLabel: "Disease"},
	exhaustion: {
		label: "Exhaustion",
		shape: "object",
		isScalar: true,
		parts: [num("value", "Level", {min: 0, max: 10}), text("label", "Or a word instead of a level", {maxLength: 40})],
	},
	inventorySummary: {
		label: "Inventory summary",
		shape: "object",
		parts: [num("entryCount", "Number of entries", {min: 0, max: 9999, isRequired: true})],
		rows: {key: "publicItems", label: "Listed items", parts: [text("name", "Item", {isRequired: true}), num("quantity", "Quantity", {min: 0, max: 9999})]},
	},
	carrySummary: {
		label: "Carried weight",
		shape: "object",
		parts: [num("carried", "Carried", {min: 0, max: 99999}), num("capacity", "Capacity", {min: 0, max: 99999}), text("state", "Or a word instead of numbers", {maxLength: 40})],
	},
});

export const FIELD_KEYS = Object.freeze(Object.keys(FIELD_DESCRIPTORS));

function el (tagName, {className = "", text: content = "", attrs = {}} = {}) {
	const element = document.createElement(tagName);
	if (className) element.className = className;
	if (content) element.textContent = content;
	Object.entries(attrs).forEach(([name, value]) => element.setAttribute(name, value));
	return element;
}

function setDeep (target, path, value) {
	const keys = path.split(".");
	let cursor = target;
	for (const key of keys.slice(0, -1)) {
		cursor[key] ||= {};
		cursor = cursor[key];
	}
	cursor[keys.at(-1)] = value;
}

function getDeep (source, path) {
	return path.split(".").reduce((cursor, key) => (cursor == null ? cursor : cursor[key]), source);
}

/** Build a replacement value from the owner's inputs. No projection logic. */
export function buildReplacementValue ({field, draft}) {
	const descriptor = FIELD_DESCRIPTORS[field];
	if (descriptor.shape === "list") {
		return (draft.items || []).map(item => `${item ?? ""}`.trim()).filter(Boolean);
	}
	if (descriptor.shape === "rows") {
		return (draft.rows || []).map(row => {
			const out = {};
			for (const part of descriptor.parts) {
				const value = row?.[part.key];
				if (value === "" || value == null) continue;
				out[part.key] = part.kind === "number" ? Number(value) : `${value}`.trim();
			}
			return out;
		}).filter(row => Object.keys(row).length);
	}
	if (field === "exhaustion") {
		const label = `${draft.label ?? ""}`.trim();
		if (label) return label;
		return Number(draft.value) || 0;
	}
	const out = {};
	for (const part of descriptor.parts) {
		const value = getDeep(draft, part.key);
		if (value === "" || value == null) continue;
		if (part.kind === "checkbox") setDeep(out, part.key, !!value);
		else if (part.kind === "number") setDeep(out, part.key, Number(value));
		else setDeep(out, part.key, `${value}`.trim());
	}
	if (descriptor.rows) {
		out[descriptor.rows.key] = (draft[descriptor.rows.key] || []).map(row => {
			const item = {};
			for (const part of descriptor.rows.parts) {
				const value = row?.[part.key];
				if (value === "" || value == null) continue;
				item[part.key] = part.kind === "number" ? Number(value) : `${value}`.trim();
			}
			return item;
		}).filter(row => Object.keys(row).length);
	}
	return out;
}

export class CharacterSheetSharing {
	constructor ({
		api = new HubApiClient(),
		fnGetCharacterId = () => null,
		fnRandomId = () => crypto.randomUUID(),
		// Injected rather than imported, so this module does not depend on the campaign
		// panel that hosts it.
		fnGetErrorMessage = () => "Sharing settings could not be reached. Your character data is safe; check your connection and try again.",
	} = {}) {
		this._api = api;
		this._fnGetCharacterId = fnGetCharacterId;
		this._fnRandomId = fnRandomId;
		this._fnGetErrorMessage = fnGetErrorMessage;
		this._state = "idle";
		this._policy = null;
		this._preview = null;
		this._projectionRevision = null;
		this._policyError = null;
		this._feedback = null;
		this._draft = null;
		this._replacementDrafts = {};
		this._isSaving = false;
		this._expandedField = null;
	}

	getState () {
		return {
			state: this._state,
			policy: this._policy,
			preview: this._preview,
			projectionRevision: this._projectionRevision,
			policyError: this._policyError,
			feedback: this._feedback,
			draft: this._draft,
		};
	}

	async pLoad () {
		const characterId = this._fnGetCharacterId();
		if (!characterId) {
			this._state = "unavailable";
			return;
		}
		this._state = "loading";
		try {
			const result = await this._api.pGetProjectionPolicy({characterId});
			this._policyError = result.error || null;
			this._projectionRevision = result.projectionRevision;
			this._preview = result.preview || null;
			// A policy the server could not validate fails closed. Offer a recovery
			// default rather than stranding the owner with an unreadable form.
			this._policy = result.policy || {version: 1, preset: "table", overrides: {}};
			this._draft = structuredClone(this._policy);
			this._replacementDrafts = {};
			this._state = this._policyError ? "invalid" : "ready";
		} catch (error) {
			this._state = "error";
			this._feedback = {type: "error", text: this._fnGetErrorMessage(error)};
		}
	}

	setPreset (preset) {
		if (!this._draft) return;
		this._draft.preset = preset;
		this._feedback = null;
	}

	setFieldMode ({field, mode}) {
		if (!this._draft) return;
		this._draft.overrides ||= {};
		if (mode === "default") delete this._draft.overrides[field];
		else if (mode === "replace") {
			this._replacementDrafts[field] ||= this._getInitialReplacementDraft(field);
			this._draft.overrides[field] = {mode: "replace"};
		} else this._draft.overrides[field] = {mode};
		this._feedback = null;
	}

	getFieldMode (field) {
		return this._draft?.overrides?.[field]?.mode || "default";
	}

	_getInitialReplacementDraft (field) {
		const descriptor = FIELD_DESCRIPTORS[field];
		if (descriptor.shape === "list") return {items: [""]};
		if (descriptor.shape === "rows") return {rows: [{}]};
		return descriptor.rows ? {[descriptor.rows.key]: []} : {};
	}

	/** Assemble the policy to submit. Replacement values are built from owner input only. */
	getSubmittablePolicy () {
		const draft = structuredClone(this._draft || {});
		draft.version = 1;
		for (const [field, override] of Object.entries(draft.overrides || {})) {
			if (override.mode !== "replace") continue;
			override.value = buildReplacementValue({field, draft: this._replacementDrafts[field] || {}});
		}
		return draft;
	}

	async pSave () {
		const characterId = this._fnGetCharacterId();
		if (!characterId || this._isSaving) return;
		this._isSaving = true;
		this._feedback = null;
		try {
			const result = await this._api.pSetProjectionPolicy({
				characterId,
				policy: this.getSubmittablePolicy(),
				expectedProjectionRevision: this._projectionRevision,
				idempotencyKey: this._fnRandomId(),
			});
			this._policy = result.policy;
			this._draft = structuredClone(result.policy);
			this._preview = result.preview || null;
			this._projectionRevision = result.projectionRevision;
			this._policyError = result.error || null;
			this._state = this._policyError ? "invalid" : "ready";
			this._feedback = {type: "success", text: "Sharing settings saved."};
		} catch (error) {
			this._applySaveError(error);
		} finally {
			this._isSaving = false;
		}
	}

	/**
	 * A conflicting write never discards the owner's edits: the server's current policy
	 * becomes the new base, the local draft is kept, and saving again is re-enabled.
	 */
	_applySaveError (error) {
		if (error?.code === "PROJECTION_POLICY_CONFLICT" && error.details) {
			this._projectionRevision = error.details.projectionRevision;
			this._policy = error.details.policy;
			this._preview = error.details.preview || null;
			this._feedback = {
				type: "warning",
				text: "Sharing settings were changed on another device. Your choices below are unsaved — review them and save again to apply them.",
			};
			return;
		}
		if (error?.code === "PROJECTION_POLICY_INVALID") {
			this._feedback = {type: "error", text: "Those sharing settings could not be saved. Check the values you entered and try again."};
			return;
		}
		this._feedback = {type: "error", text: this._fnGetErrorMessage(error)};
	}

	/** Reset to the safe default after a corrupt persisted policy. */
	resetToDefault () {
		this._draft = {version: 1, preset: "table", overrides: {}};
		this._replacementDrafts = {};
		this._feedback = null;
	}

	render ({fnRerender}) {
		const root = el("section", {className: "charsheet__sharing", attrs: {"aria-labelledby": "charsheet-sharing-heading"}});
		root.append(el("h3", {className: "charsheet__sharing-heading", text: "What other players can see", attrs: {id: "charsheet-sharing-heading"}}));

		if (this._state === "loading") {
			root.append(el("p", {className: "charsheet__sharing-loading", text: "Loading sharing settings…", attrs: {role: "status", "aria-live": "polite"}}));
			return root;
		}
		if (this._state === "unavailable") return root;
		if (this._state === "error") {
			root.append(el("p", {className: "charsheet__sharing-feedback charsheet__sharing-feedback--error", text: this._feedback?.text || "Sharing settings are unavailable.", attrs: {role: "alert"}}));
			return root;
		}
		if (this._state === "invalid") root.append(this._renderInvalidBanner({fnRerender}));

		root.append(
			el("p", {className: "charsheet__sharing-intro", text: "You choose what the rest of the table sees. Your DM always sees your full sheet.", attrs: {id: "charsheet-sharing-intro"}}),
			this._renderPresets({fnRerender}),
			this._renderFields({fnRerender}),
			this._renderPreview(),
			this._renderSaveRow({fnRerender}),
		);
		if (this._feedback) {
			root.append(el("p", {
				className: `charsheet__sharing-feedback charsheet__sharing-feedback--${this._feedback.type}`,
				text: this._feedback.text,
				attrs: {role: this._feedback.type === "error" ? "alert" : "status", "aria-live": "polite"},
			}));
		}
		return root;
	}

	_renderInvalidBanner ({fnRerender}) {
		const banner = el("div", {className: "charsheet__sharing-banner", attrs: {role: "alert"}});
		banner.append(el("p", {text: "Your saved sharing settings could not be read, so nothing is being shared with other players right now. Choose settings below and save to fix this."}));
		const reset = el("button", {className: "charsheet__sharing-reset", text: "Reset to table view", attrs: {type: "button"}});
		reset.addEventListener("click", () => {
			this.resetToDefault();
			fnRerender();
		});
		banner.append(reset);
		return banner;
	}

	_renderPresets ({fnRerender}) {
		const group = el("fieldset", {className: "charsheet__sharing-presets"});
		group.append(el("legend", {text: "Sharing level"}));
		for (const choice of PRESET_CHOICES) {
			const id = `charsheet-sharing-preset-${choice.value}`;
			const descriptionId = `${id}-description`;
			const wrp = el("div", {className: "charsheet__sharing-preset"});
			const input = el("input", {attrs: {type: "radio", name: "charsheet-sharing-preset", id, value: choice.value, "aria-describedby": descriptionId}});
			input.checked = this._draft?.preset === choice.value;
			input.addEventListener("change", () => {
				this.setPreset(choice.value);
				fnRerender();
			});
			const label = el("label", {text: choice.label, attrs: {for: id}});
			wrp.append(input, label, el("p", {className: "charsheet__sharing-preset-description", text: choice.description, attrs: {id: descriptionId}}));
			group.append(wrp);
		}
		return group;
	}

	_renderFields ({fnRerender}) {
		const wrp = el("div", {className: "charsheet__sharing-fields"});
		wrp.append(el("p", {className: "charsheet__sharing-fields-intro", text: "Adjust individual details if you want something different from the level above."}));
		for (const field of FIELD_KEYS) {
			const descriptor = FIELD_DESCRIPTORS[field];
			const group = el("fieldset", {className: "charsheet__sharing-field"});
			group.append(el("legend", {text: descriptor.label}));
			const mode = this.getFieldMode(field);
			for (const choice of [{value: "default", label: "Use sharing level"}, ...MODE_CHOICES]) {
				const id = `charsheet-sharing-${field}-${choice.value}`;
				const input = el("input", {attrs: {type: "radio", name: `charsheet-sharing-${field}`, id, value: choice.value}});
				input.checked = mode === choice.value;
				input.addEventListener("change", () => {
					this.setFieldMode({field, mode: choice.value});
					this._expandedField = choice.value === "replace" ? field : null;
					fnRerender();
				});
				group.append(input, el("label", {text: choice.label, attrs: {for: id}}));
			}
			if (mode === "replace") group.append(this._renderReplacementControls({field, fnRerender}));
			wrp.append(group);
		}
		return wrp;
	}

	_renderReplacementControls ({field, fnRerender}) {
		const descriptor = FIELD_DESCRIPTORS[field];
		this._replacementDrafts[field] ||= this._getInitialReplacementDraft(field);
		const draft = this._replacementDrafts[field];
		const wrp = el("div", {className: "charsheet__sharing-replacement"});
		wrp.append(el("p", {className: "charsheet__sharing-replacement-hint", text: "Other players see exactly what you enter here instead of your real values."}));

		if (descriptor.shape === "list") {
			wrp.append(this._renderStringList({field, draft, itemLabel: descriptor.itemLabel, fnRerender}));
			return wrp;
		}
		if (descriptor.shape === "rows") {
			wrp.append(this._renderRows({field, draft, key: "rows", parts: descriptor.parts, label: descriptor.label, fnRerender}));
			return wrp;
		}
		for (const part of descriptor.parts) wrp.append(this._renderPart({field, draft, part}));
		if (descriptor.rows) {
			wrp.append(this._renderRows({field, draft, key: descriptor.rows.key, parts: descriptor.rows.parts, label: descriptor.rows.label, fnRerender}));
		}
		return wrp;
	}

	_renderPart ({field, draft, part, target = null, onChange = null}) {
		const id = `charsheet-sharing-${field}-${part.key.replace(/\W/g, "-")}${target ? `-${target._id}` : ""}`;
		const wrp = el("label", {className: "charsheet__sharing-input"});
		wrp.append(el("span", {text: part.label}));
		const store = target || draft;
		let input;
		if (part.kind === "select") {
			input = el("select", {attrs: {id}});
			for (const option of part.options) input.append(el("option", {text: option, attrs: {value: option}}));
			input.value = getDeep(store, part.key) ?? part.options[0];
		} else if (part.kind === "checkbox") {
			input = el("input", {attrs: {type: "checkbox", id}});
			input.checked = !!getDeep(store, part.key);
		} else {
			input = el("input", {attrs: {
				type: part.kind === "number" ? "number" : "text",
				id,
				...(part.kind === "number" ? {min: `${part.min}`, max: `${part.max}`, step: `${part.step}`} : {maxlength: `${part.maxLength}`}),
			}});
			input.value = getDeep(store, part.key) ?? "";
		}
		wrp.setAttribute("for", id);
		input.addEventListener("input", () => {
			const value = part.kind === "checkbox" ? input.checked : input.value;
			if (target) target[part.key] = value;
			else setDeep(draft, part.key, value);
			onChange?.();
		});
		wrp.append(input);
		return wrp;
	}

	_renderStringList ({field, draft, itemLabel, fnRerender}) {
		draft.items ||= [""];
		const wrp = el("div", {className: "charsheet__sharing-list"});
		draft.items.forEach((value, index) => {
			const id = `charsheet-sharing-${field}-item-${index}`;
			const label = el("label", {className: "charsheet__sharing-input", attrs: {for: id}});
			label.append(el("span", {text: `${itemLabel} ${index + 1}`}));
			const input = el("input", {attrs: {type: "text", id, maxlength: "40"}});
			input.value = value ?? "";
			input.addEventListener("input", () => { draft.items[index] = input.value; });
			label.append(input);
			const remove = el("button", {className: "charsheet__sharing-row-remove", text: "Remove", attrs: {type: "button", "aria-label": `Remove ${itemLabel} ${index + 1}`}});
			remove.addEventListener("click", () => {
				draft.items.splice(index, 1);
				fnRerender();
			});
			wrp.append(label, remove);
		});
		const add = el("button", {className: "charsheet__sharing-row-add", text: `Add ${itemLabel.toLowerCase()}`, attrs: {type: "button"}});
		add.addEventListener("click", () => {
			draft.items.push("");
			fnRerender();
		});
		wrp.append(add);
		return wrp;
	}

	_renderRows ({field, draft, key, parts, label, fnRerender}) {
		draft[key] ||= [];
		const wrp = el("div", {className: "charsheet__sharing-rows"});
		wrp.append(el("p", {className: "charsheet__sharing-rows-label", text: label}));
		draft[key].forEach((row, index) => {
			row._id ??= `${index}`;
			const rowWrp = el("div", {className: "charsheet__sharing-row"});
			for (const part of parts) rowWrp.append(this._renderPart({field, draft, part, target: row}));
			const remove = el("button", {className: "charsheet__sharing-row-remove", text: "Remove", attrs: {type: "button", "aria-label": `Remove ${label} ${index + 1}`}});
			remove.addEventListener("click", () => {
				draft[key].splice(index, 1);
				fnRerender();
			});
			rowWrp.append(remove);
			wrp.append(rowWrp);
		});
		const add = el("button", {className: "charsheet__sharing-row-add", text: `Add to ${label.toLowerCase()}`, attrs: {type: "button"}});
		add.addEventListener("click", () => {
			draft[key].push({_id: `${draft[key].length}`});
			fnRerender();
		});
		wrp.append(add);
		return wrp;
	}

	/**
	 * The preview is the server's own peer profile for this character — the same value a
	 * real player receives — so what the owner reads here cannot drift from what is shared.
	 */
	_renderPreview () {
		const wrp = el("div", {className: "charsheet__sharing-preview", attrs: {"aria-live": "polite"}});
		wrp.append(el("h4", {className: "charsheet__sharing-preview-heading", text: "What other players see now"}));
		const shared = Object.entries(this._preview?.data || {});
		if (!shared.length) {
			wrp.append(el("p", {className: "charsheet__sharing-preview-empty", text: "Nothing is shared with other players."}));
			return wrp;
		}
		const list = el("dl", {className: "charsheet__sharing-preview-list"});
		for (const [field, value] of shared) {
			list.append(
				el("dt", {text: FIELD_DESCRIPTORS[field]?.label || field}),
				el("dd", {text: describePreviewValue(value)}),
			);
		}
		wrp.append(list);
		wrp.append(el("p", {className: "charsheet__sharing-preview-note", text: "This is the saved result, not your unsaved changes."}));
		return wrp;
	}

	_renderSaveRow ({fnRerender}) {
		const wrp = el("div", {className: "charsheet__sharing-actions"});
		const save = el("button", {
			className: "charsheet__sharing-save",
			text: this._isSaving ? "Saving…" : "Save sharing settings",
			attrs: {type: "button"},
		});
		if (this._isSaving) save.setAttribute("disabled", "disabled");
		save.addEventListener("click", async () => {
			await this.pSave();
			fnRerender();
		});
		wrp.append(save);
		return wrp;
	}
}

/** Render a preview value as plain reading text. Presentation only. */
export function describePreviewValue (value) {
	if (value == null) return "—";
	if (Array.isArray(value)) {
		if (!value.length) return "None";
		return value.map(entry => (typeof entry === "object" ? Object.values(entry).join(" ") : `${entry}`)).join(", ");
	}
	if (typeof value === "object") {
		return Object.entries(value)
			.map(([key, entry]) => `${key}: ${typeof entry === "object" && entry !== null ? Object.values(entry).join("/") : entry}`)
			.join(" · ");
	}
	return `${value}`;
}
