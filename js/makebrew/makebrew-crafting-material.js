import {
	CRAFTING_WORKBENCH_VOCABULARY,
	CraftingWorkbenchCore,
} from "../itembuilder/crafting-workbench-core.js";
import {RenderCrafting} from "../render-crafting.js";
import {BuilderUi} from "./makebrew-builderui.js";
import {CraftingWorkbenchBuilderBase} from "./makebrew-crafting-workbench.js";

const _DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "healing", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const _ABILITIES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
const _EFFECT_FIELDS = {
	text: ["text"],
	dieSizeIncrease: ["steps", "maxDie"],
	bonusDice: ["count"],
	additionalTargets: ["count"],
	acOverride: ["formula"],
	bonusDamage: ["dice", "damageType"],
	condition: ["condition", "duration"],
	noSlot: [],
	rangeChange: ["value", "unit"],
	areaChange: ["description"],
	resistance: ["types"],
	saveDcMod: ["mod"],
	saveDisadvantage: ["ability"],
	speedFallRate: ["rate"],
	speedOverride: ["speedType", "value"],
	lowerSlot: ["reduction"],
	removeConcentration: [],
	immunity: ["types"],
};

const _copy = value => value == null ? value : JSON.parse(JSON.stringify(value));
const _key = value => String(value ?? "").trim().toLowerCase();

export class CraftingMaterialBuilder extends CraftingWorkbenchBuilderBase {
	constructor () {
		super({prop: "craftingMaterial"});
		this._arcadiaCatalog = [];
	}

	async _pInit () {
		const data = await DataUtil.loadRawJSON("data/items-variant-components-ar8.json");
		this._arcadiaCatalog = CraftingWorkbenchCore.dedupe(data.item || []);
	}

	static getPreviewEntity (prop, entity) {
		return {
			...super.getPreviewEntity(prop, entity),
			name: entity.name || "Unnamed Crafting Material",
		};
	}

	static getDraftFromArcadiaPreset (preset, {source}) {
		const item = _copy(preset || {});
		const component = item.variantComponent || {};
		const matchQuantity = typeof component.harvestQuantity === "string"
			? /^\s*(\d+)\s*(.*)$/.exec(component.harvestQuantity)
			: null;
		const quantity = matchQuantity
			? Number(matchQuantity[1])
			: Number.isFinite(Number(component.harvestQuantity))
				? Number(component.harvestQuantity)
				: null;
		const quantityUnit = matchQuantity?.[2]?.trim() || null;
		const harvest = {
			...(component.harvestDC != null ? {dc: component.harvestDC} : {}),
			...(quantity != null ? {quantity} : {}),
			...(quantityUnit ? {quantityUnit} : {}),
			...(component.harvestTime ? {time: component.harvestTime} : {}),
			...(component.harvestSource ? {creature: {name: component.harvestSource}} : {}),
		};
		const spells = CraftingWorkbenchCore.dedupe(
			(item.variantComponent?.spellEffects || [])
				.map(spellEffect => spellEffect.match?.spell)
				.filter(Boolean)
				.map(uid => {
					const [name, spellSource] = uid.split("|");
					return {name, source: spellSource || "PHB"};
				}),
		);
		return CraftingWorkbenchCore.createDraft("craftingMaterial", {
			source,
			entity: {
				name: item.name || "New Crafting Material",
				source,
				...(item.page != null ? {page: item.page} : {}),
				materialCategory: "spell component",
				...(Object.keys(harvest).length ? {harvest} : {}),
				...(item.value != null ? {value: item.value} : {}),
				...(item.weight != null ? {weight: item.weight} : {}),
				...(item.rarity != null ? {rarity: item.rarity} : {}),
				entries: _copy(item.entries || []),
				spells,
				...(item.variantComponent ? {variantComponent: _copy(item.variantComponent)} : {}),
			},
		});
	}

	async _pChooseArcadiaPreset () {
		if (!this._arcadiaCatalog.length) return JqueryUtil.doToast({type: "warning", content: "No Arcadia 8 variant components are available."});
		const selected = await InputUiUtil.pGetUserEnum({
			title: "Start from Arcadia 8 Component",
			values: this._arcadiaCatalog,
			fnDisplay: it => `${it.name} (${Parser.sourceJsonToAbv(it.source)})`,
			isResolveItem: true,
		});
		if (!selected) return;
		return this.pHandleLoadExistingData(this.constructor.getDraftFromArcadiaPreset(selected, {source: this._ui.source}));
	}

	async pHandleClickLoadExisting () {
		return this._pChooseArcadiaPreset();
	}

	_getStageDefinitions () {
		return [
			{name: "Base", render: this._renderBaseStage.bind(this)},
			{name: "Harvest & Value", render: this._renderHarvestStage.bind(this)},
			{name: "Variant Component", render: this._renderVariantStage.bind(this)},
			{name: "Description", render: this._renderDescriptionStage.bind(this)},
			{name: "Review & Save", render: this._renderReviewStage.bind(this)},
		];
	}

	_getField ({label, control, hint = null}) {
		return ee`<label class="mkbru_cw__field">
			<span class="mkbru_cw__field-label">${label}</span>
			<span class="mkbru_cw__field-control">${control}${hint ? `<span class="ve-muted ve-small">${hint}</span>` : ""}</span>
		</label>`;
	}

	_renderText ({wrp, label, object, prop, cb, hint = null, placeholder = "", type = "text", fnParse = null}) {
		const input = ee`<input class="ve-form-control ve-input-xs form-control--minimal" type="${type}" placeholder="${placeholder.qq()}">`
			.val(object[prop] ?? "")
			.onn("change", () => {
				const raw = input.val();
				const value = fnParse ? fnParse(raw) : raw.trim();
				if (value == null || value === "") delete object[prop];
				else object[prop] = value;
				cb();
			});
		this._getField({label, control: input, hint}).appendTo(wrp);
		return input;
	}

	_renderNumber (opts) {
		return this._renderText({
			...opts,
			type: "number",
			fnParse: raw => raw.trim() === "" || !Number.isFinite(Number(raw)) ? null : Number(raw),
		});
	}

	_renderSelect ({wrp, label, object, prop, values, cb, fnDisplay = it => it, nullable = true, hint = null}) {
		const select = ee`<select class="ve-form-control ve-input-xs form-control--minimal">
			${nullable ? `<option value="">(None)</option>` : ""}
			${values.map(value => `<option value="${`${value}`.qq()}">${fnDisplay(value).qq()}</option>`)}
		</select>`
			.val(object[prop] == null ? "" : `${object[prop]}`)
			.onn("change", () => {
				const value = select.val();
				if (nullable && value === "") delete object[prop];
				else object[prop] = value;
				cb();
			});
		this._getField({label, control: select, hint}).appendTo(wrp);
		return select;
	}

	_renderBoolean ({wrp, label, object, prop, cb, hint = null, nullable = false}) {
		const input = ee`<input class="mkbru__ipt-cb" type="checkbox">`
			.prop("checked", !!object[prop])
			.onn("change", () => {
				const value = !!input.prop("checked");
				if (!value && nullable) delete object[prop];
				else object[prop] = value;
				cb();
			});
		this._getField({label, control: ee`<span class="mkbru_cw__check">${input}<span>${hint || label}</span></span>`}).appendTo(wrp);
		return input;
	}

	_renderNullableBoolean ({wrp, label, object, prop, cb}) {
		const state = {value: object[prop] == null ? "" : `${object[prop]}`};
		this._renderSelect({
			wrp,
			label,
			object: state,
			prop: "value",
			values: ["true", "false"],
			cb: () => {
				if (state.value === "") delete object[prop];
				else object[prop] = state.value === "true";
				cb();
			},
			fnDisplay: value => value === "true" ? "Yes" : "No",
		});
	}

	_renderStringArray ({wrp, label, object, prop, cb, shortName}) {
		BuilderUi.getStateIptStringArray(label, cb, object, {nullable: true, shortName}, prop).appendTo(wrp);
	}

	_renderBaseStage ({wrp, cb}) {
		const preset = ee`<section class="mkbru_cw__section mkbru_cw__preset">
			<div>
				<h3>Arcadia 8 preset</h3>
				<p class="ve-muted">Copy an official component as a starting point. The reference file remains read-only, and your selected homebrew source is retained.</p>
			</div>
			<button class="ve-btn ve-btn-default ve-btn-sm" type="button">Start from Arcadia 8 component</button>
		</section>`.appendTo(wrp);
		preset.querySelector("button").addEventListener("click", () => this._pChooseArcadiaPreset());

		const section = ee`<section class="mkbru_cw__section">
			<h3>Identity</h3>
			<p class="ve-muted">Name the material and record its homebrew publication details.</p>
		</section>`.appendTo(wrp);
		this._renderText({wrp: section, label: "Name", object: this._draft, prop: "name", cb});
		this._selSource = BuilderUi.getStateIptEnum(
			"Source",
			cb,
			this._draft,
			{vals: this._sourcesCache, fnDisplay: Parser.sourceJsonToFull, nullable: false},
			"source",
		).appendTo(section);
		this._renderNumber({wrp: section, label: "Page", object: this._draft, prop: "page", cb});
		this._renderSelect({
			wrp: section,
			label: "Material category",
			object: this._draft,
			prop: "materialCategory",
			values: CRAFTING_WORKBENCH_VOCABULARY.craftingMaterial.categories,
			cb,
			nullable: false,
			fnDisplay: it => it.toTitleCase(),
		});
		this._renderText({wrp: section, label: "Material kind", object: this._draft, prop: "materialKind", cb, hint: "Optional material family this counts as."});
	}

	_renderHarvestStage ({wrp, cb}) {
		this._draft.harvest ||= {};
		const harvest = this._draft.harvest;
		const section = ee`<section class="mkbru_cw__section">
			<h3>Harvest</h3>
			<p class="ve-muted">Record only authored harvesting facts. Creature type, CR, labels, and graph metadata are generated elsewhere.</p>
		</section>`.appendTo(wrp);
		this._renderNumber({wrp: section, label: "Harvest DC", object: harvest, prop: "dc", cb});

		const quantityMode = {value: harvest.quantityRoll ? "roll" : harvest.quantity != null ? "fixed" : "none"};
		this._renderSelect({
			wrp: section,
			label: "Quantity",
			object: quantityMode,
			prop: "value",
			values: ["none", "fixed", "roll"],
			nullable: false,
			fnDisplay: it => it.toTitleCase(),
			cb: () => {
				if (quantityMode.value === "fixed") {
					harvest.quantity = harvest.quantity ?? 1;
					delete harvest.quantityRoll;
				} else if (quantityMode.value === "roll") {
					harvest.quantityRoll ||= "1d4";
					delete harvest.quantity;
				} else {
					delete harvest.quantity;
					delete harvest.quantityRoll;
				}
				this._doSync({isRenderInput: true});
			},
		});
		if (quantityMode.value === "fixed") this._renderNumber({wrp: section, label: "Fixed quantity", object: harvest, prop: "quantity", cb});
		if (quantityMode.value === "roll") this._renderText({wrp: section, label: "Quantity roll", object: harvest, prop: "quantityRoll", cb, placeholder: "1d4"});
		this._renderText({wrp: section, label: "Harvest time", object: harvest, prop: "time", cb, placeholder: "15 minutes"});

		harvest.creature ||= {};
		this._renderText({wrp: section, label: "Creature name", object: harvest.creature, prop: "name", cb});
		this._renderText({wrp: section, label: "Creature source", object: harvest.creature, prop: "source", cb, placeholder: "MM"});
		this._renderText({wrp: section, label: "Biome", object: harvest, prop: "biome", cb});
		this._renderNullableBoolean({wrp: section, label: "Requires preparation", object: harvest, prop: "requiresPreparation", cb});
		this._renderSelect({wrp: section, label: "Shelf life", object: harvest, prop: "shelfLife", values: ["short", "medium", "long"], cb, fnDisplay: it => it.toTitleCase()});
		this._renderBoolean({wrp: section, label: "Value varies by creature CR", object: harvest, prop: "valueByCr", cb, nullable: true});

		const value = ee`<section class="mkbru_cw__section">
			<h3>Value & physical details</h3>
			<p class="ve-muted">Value is authored in copper pieces; weight is in pounds.</p>
		</section>`.appendTo(wrp);
		this._renderNumber({wrp: value, label: "Value (cp)", object: this._draft, prop: "value", cb});
		this._renderNumber({wrp: value, label: "Weight (lb.)", object: this._draft, prop: "weight", cb});
		this._renderSelect({
			wrp: value,
			label: "Rarity",
			object: this._draft,
			prop: "rarity",
			values: CRAFTING_WORKBENCH_VOCABULARY.rarities,
			cb,
			fnDisplay: it => it.toTitleCase(),
		});
	}

	_renderVariantStage ({wrp, cb}) {
		const section = ee`<section class="mkbru_cw__section">
			<h3>Variant spell component</h3>
			<p class="ve-muted">This nested block is consumed by the character sheet. It is never saved as a top-level entity.</p>
		</section>`.appendTo(wrp);
		const toggle = {enabled: !!this._draft.variantComponent};
		this._renderBoolean({
			wrp: section,
			label: "Enable variant component",
			object: toggle,
			prop: "enabled",
			cb: () => {
				if (toggle.enabled) this._draft.variantComponent = {spellEffects: []};
				else delete this._draft.variantComponent;
				this._doSync({isRenderInput: true});
			},
		});
		if (!this._draft.variantComponent) return;

		const component = this._draft.variantComponent;
		component.spellEffects ||= [];
		const metadata = ee`<div class="mkbru_cw__row-grid"></div>`.appendTo(section);
		this._renderNumber({wrp: metadata, label: "Harvest DC", object: component, prop: "harvestDC", cb});
		this._renderNumber({wrp: metadata, label: "Harvest quantity", object: component, prop: "harvestQuantity", cb});
		this._renderText({wrp: metadata, label: "Harvest source", object: component, prop: "harvestSource", cb});
		this._renderText({wrp: metadata, label: "Harvest time", object: component, prop: "harvestTime", cb});
		this._renderNumber({wrp: metadata, label: "Uses per casting", object: component, prop: "usesPerCasting", cb});
		this._renderUsesEditor({wrp, component, cb});
		this._renderSpellEffectsEditor({wrp, component, cb});
	}

	_renderUsesEditor ({wrp, component, cb}) {
		component.uses ||= [];
		const section = ee`<section class="mkbru_cw__section">
			<div class="mkbru_cw__section-heading">
				<div><h3>Optional component uses</h3><p class="ve-muted">Use for components which offer a repeatable menu of named effects.</p></div>
				<button class="ve-btn ve-btn-default ve-btn-sm" type="button">Add use</button>
			</div>
			<div class="mkbru_cw__rows"></div>
		</section>`.appendTo(wrp);
		section.querySelector("button").addEventListener("click", () => {
			component.uses = CraftingWorkbenchCore.addRow(component.uses, {name: "", key: "", entry: ""});
			this._doSync({isRenderInput: true});
		});
		const rows = section.querySelector(".mkbru_cw__rows");
		component.uses.forEach((use, ix) => {
			const row = this._getRow({wrp: rows, title: `Use ${ix + 1}`, rows: component.uses, ix, fnSetRows: nxt => component.uses = nxt});
			const grid = row.querySelector(".mkbru_cw__row-grid");
			this._renderText({wrp: grid, label: "Name", object: use, prop: "name", cb});
			this._renderText({wrp: grid, label: "Key", object: use, prop: "key", cb});
			this._renderText({wrp: grid, label: "Rules entry", object: use, prop: "entry", cb});
			this._renderContextJson({wrp: row, label: "Use details JSON", object: use, commonProps: ["name", "key", "entry"], cb});
		});
	}

	_renderSpellEffectsEditor ({wrp, component, cb}) {
		const section = ee`<section class="mkbru_cw__section">
			<div class="mkbru_cw__section-heading">
				<div><h3>Spell effects</h3><p class="ve-muted">Each row has exactly one runtime-supported match predicate and one or more typed effects.</p></div>
				<button class="ve-btn ve-btn-primary ve-btn-sm" type="button">Add spell effect</button>
			</div>
			<div class="mkbru_cw__rows"></div>
		</section>`.appendTo(wrp);
		section.querySelector("button").addEventListener("click", () => {
			component.spellEffects = CraftingWorkbenchCore.addRow(component.spellEffects, {match: {any: true}, description: "", effects: []});
			this._doSync({isRenderInput: true});
		});
		const rows = section.querySelector(".mkbru_cw__rows");
		component.spellEffects.forEach((spellEffect, ix) => this._renderSpellEffectRow({wrp: rows, component, spellEffect, ix, cb}));
	}

	_renderSpellEffectRow ({wrp, component, spellEffect, ix, cb}) {
		spellEffect.match ||= {};
		spellEffect.effects ||= [];
		const row = this._getRow({wrp, title: `Spell effect ${ix + 1}`, rows: component.spellEffects, ix, fnSetRows: nxt => component.spellEffects = nxt});
		const grid = row.querySelector(".mkbru_cw__row-grid");
		const predicate = CRAFTING_WORKBENCH_VOCABULARY.craftingMaterial.matchPredicates.find(prop => Object.hasOwn(spellEffect.match, prop)) || "";
		const selected = {predicate};
		this._renderSelect({
			wrp: grid,
			label: "Match predicate",
			object: selected,
			prop: "predicate",
			values: CRAFTING_WORKBENCH_VOCABULARY.craftingMaterial.matchPredicates,
			cb: () => {
				for (const prop of CRAFTING_WORKBENCH_VOCABULARY.craftingMaterial.matchPredicates) delete spellEffect.match[prop];
				if (selected.predicate) spellEffect.match[selected.predicate] = selected.predicate === "any" ? true : "";
				this._doSync({isRenderInput: true});
			},
			fnDisplay: it => it.replace(/([A-Z])/g, " $1").toTitleCase(),
		});
		if (predicate && predicate !== "any") {
			this._renderText({
				wrp: grid,
				label: "Match value",
				object: spellEffect.match,
				prop: predicate,
				cb,
				placeholder: predicate === "spell" ? "fireball|PHB" : "",
			});
		}
		this._renderText({wrp: grid, label: "Description", object: spellEffect, prop: "description", cb});

		const effects = ee`<div class="mkbru_cw__nested">
			<div class="mkbru_cw__section-heading">
				<strong>Effects</strong>
				<button class="ve-btn ve-btn-default ve-btn-xs" type="button">Add effect</button>
			</div>
			<div class="mkbru_cw__rows"></div>
		</div>`.appendTo(row);
		effects.querySelector("button").addEventListener("click", () => {
			spellEffect.effects = CraftingWorkbenchCore.addRow(spellEffect.effects, {type: "text", text: ""});
			this._doSync({isRenderInput: true});
		});
		const effectRows = effects.querySelector(".mkbru_cw__rows");
		spellEffect.effects.forEach((effect, effectIx) => this._renderEffectRow({wrp: effectRows, spellEffect, effect, effectIx, cb}));
	}

	_renderEffectRow ({wrp, spellEffect, effect, effectIx, cb}) {
		const row = this._getRow({wrp, title: `Effect ${effectIx + 1}`, rows: spellEffect.effects, ix: effectIx, fnSetRows: nxt => spellEffect.effects = nxt});
		const grid = row.querySelector(".mkbru_cw__row-grid");
		const values = [
			...CRAFTING_WORKBENCH_VOCABULARY.craftingMaterial.effectTypes,
			...(!CRAFTING_WORKBENCH_VOCABULARY.craftingMaterial.effectTypes.includes(effect.type) && effect.type ? [effect.type] : []),
		];
		this._renderSelect({wrp: grid, label: "Type", object: effect, prop: "type", values, cb: () => this._doSync({isRenderInput: true}), nullable: false});
		this._renderEffectFields({wrp: grid, effect, cb});
		this._renderContextJson({
			wrp: row,
			label: "Effect details JSON",
			object: effect,
			commonProps: ["type", ...(_EFFECT_FIELDS[effect.type] || [])],
			cb,
		});
	}

	_renderEffectFields ({wrp, effect, cb}) {
		switch (effect.type) {
			case "text": this._renderText({wrp, label: "Text", object: effect, prop: "text", cb}); break;
			case "dieSizeIncrease":
				this._renderNumber({wrp, label: "Steps", object: effect, prop: "steps", cb});
				this._renderText({wrp, label: "Maximum die", object: effect, prop: "maxDie", cb, placeholder: "d12"});
				break;
			case "bonusDice":
			case "additionalTargets": this._renderNumber({wrp, label: "Count", object: effect, prop: "count", cb}); break;
			case "acOverride": this._renderText({wrp, label: "AC formula", object: effect, prop: "formula", cb, placeholder: "15 + DEX"}); break;
			case "bonusDamage":
				this._renderText({wrp, label: "Damage dice", object: effect, prop: "dice", cb, placeholder: "1d6"});
				this._renderSelect({wrp, label: "Damage type", object: effect, prop: "damageType", values: _DAMAGE_TYPES, cb});
				break;
			case "condition":
				this._renderText({wrp, label: "Condition", object: effect, prop: "condition", cb});
				this._renderText({wrp, label: "Duration", object: effect, prop: "duration", cb});
				break;
			case "rangeChange":
				this._renderNumber({wrp, label: "Range", object: effect, prop: "value", cb});
				this._renderText({wrp, label: "Unit", object: effect, prop: "unit", cb, placeholder: "feet"});
				break;
			case "areaChange": this._renderText({wrp, label: "Area", object: effect, prop: "description", cb}); break;
			case "resistance":
			case "immunity": this._renderStringArray({wrp, label: "Types", object: effect, prop: "types", cb, shortName: "Type"}); break;
			case "saveDcMod": this._renderNumber({wrp, label: "DC modifier", object: effect, prop: "mod", cb}); break;
			case "saveDisadvantage": this._renderSelect({wrp, label: "Save ability", object: effect, prop: "ability", values: _ABILITIES, cb}); break;
			case "speedFallRate": this._renderNumber({wrp, label: "Fall rate", object: effect, prop: "rate", cb}); break;
			case "speedOverride":
				this._renderText({wrp, label: "Speed type", object: effect, prop: "speedType", cb});
				this._renderNumber({wrp, label: "Speed", object: effect, prop: "value", cb});
				break;
			case "lowerSlot": this._renderNumber({wrp, label: "Slot reduction", object: effect, prop: "reduction", cb}); break;
			default: break;
		}
	}

	_getRow ({wrp, title, rows, ix, fnSetRows}) {
		const row = ee`<article class="mkbru_cw__row">
			<header><strong>${title}</strong><div class="mkbru_cw__row-actions"></div></header>
			<div class="mkbru_cw__row-grid"></div>
		</article>`.appendTo(wrp);
		const actions = row.querySelector(".mkbru_cw__row-actions");
		const move = delta => {
			fnSetRows(CraftingWorkbenchCore.moveRow(rows, ix, ix + delta));
			this._doSync({isRenderInput: true});
		};
		ee`<div class="ve-btn-group">
			<button class="ve-btn ve-btn-xs ve-btn-default" type="button" title="Move up" aria-label="Move ${title} up"><span class="glyphicon glyphicon-arrow-up"></span></button>
			<button class="ve-btn ve-btn-xs ve-btn-default" type="button" title="Move down" aria-label="Move ${title} down"><span class="glyphicon glyphicon-arrow-down"></span></button>
			<button class="ve-btn ve-btn-xs ve-btn-danger" type="button" title="Remove" aria-label="Remove ${title}"><span class="glyphicon glyphicon-trash"></span></button>
		</div>`.appendTo(actions);
		const [up, down, remove] = actions.querySelectorAll("button");
		up.disabled = ix === 0;
		down.disabled = ix === rows.length - 1;
		up.addEventListener("click", () => move(-1));
		down.addEventListener("click", () => move(1));
		remove.addEventListener("click", () => {
			fnSetRows(CraftingWorkbenchCore.removeRow(rows, ix));
			this._doSync({isRenderInput: true});
		});
		return row;
	}

	_renderContextJson ({wrp, label, object, commonProps, cb}) {
		const details = Object.fromEntries(Object.entries(object).filter(([key]) => !commonProps.includes(key)));
		const status = ee`<span class="ve-small" role="status" aria-live="polite"></span>`;
		const textarea = ee`<textarea class="ve-form-control mkbru_cw__context-json" spellcheck="false" aria-label="${label.qq()}">${JSON.stringify(details, null, "\t").qq()}</textarea>`
			.onn("change", () => {
				try {
					const parsed = JSON.parse(textarea.val() || "{}");
					if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("Enter a JSON object.");
					for (const key of Object.keys(object)) if (!commonProps.includes(key)) delete object[key];
					Object.assign(object, parsed);
					status.attr("class", "ve-small text-success").txt("Details applied.");
					cb();
				} catch (e) {
					status.attr("class", "ve-small text-danger").txt(`Invalid details: ${e.message}`);
				}
			});
		ee`<details class="mkbru_cw__context">
			<summary>${label}</summary>
			<p class="ve-muted ve-small">Specialized or future fields are preserved here.</p>
			${textarea}${status}
		</details>`.appendTo(wrp);
	}

	_renderDescriptionStage ({wrp, cb}) {
		const section = ee`<section class="mkbru_cw__section">
			<h3>Spell references</h3>
			<p class="ve-muted">Use spell UIDs in <code>name|source</code> form.</p>
		</section>`.appendTo(wrp);
		const spellState = {uids: (this._draft.spells || []).map(spell => `${spell.name}|${spell.source || ""}`)};
		BuilderUi.getStateIptStringArray(
			"Spells",
			() => {
				this._draft.spells = CraftingWorkbenchCore.dedupe((spellState.uids || []).map(uid => {
					const [name, source] = uid.split("|");
					return {name: name.trim(), source: (source || "").trim()};
				}));
				cb();
			},
			spellState,
			{nullable: true, shortName: "Spell"},
			"uids",
		).appendTo(section);
		BuilderUi.getStateIptEntries(
			"Description",
			cb,
			this._draft,
			{nullable: true, fnPostProcess: BuilderUi.fnPostProcessDice},
			"entries",
		).appendTo(wrp);
	}

	_renderReviewStage ({wrp}) {
		this._wrpReview = wrp;
		this._renderReviewContent();
	}

	_refreshReview () {
		if (this._wrpReview) this._renderReviewContent();
	}

	_renderReviewContent () {
		const wrp = this._wrpReview.empty();
		const preview = this.constructor.getPreviewEntity("craftingMaterial", this._draft);
		const previewTable = ee`<table class="ve-w-100 ve-stats" aria-label="Crafting material review preview"></table>`;
		const spellEffectCount = this._draft.variantComponent?.spellEffects?.length || 0;
		ee`<section class="mkbru_cw__review">
			<div class="mkbru_cw__review-summary">
				<h3>Review ${this._draft.name || "unnamed material"}</h3>
				<p>${(this._draft.materialCategory || "No category").toTitleCase()} · ${this._draft.source || "No source"}</p>
				<p>${this._draft.spells?.length || 0} spell reference${this._draft.spells?.length === 1 ? "" : "s"} · ${spellEffectCount} variant spell effect${spellEffectCount === 1 ? "" : "s"}</p>
				<p class="ve-muted">Resolve any validation message above, then use Save in the builder toolbar.</p>
			</div>
			<div class="mkbru_cw__review-preview">${previewTable}</div>
		</section>`.appendTo(wrp);
		previewTable.appends(RenderCrafting.getRenderedCrafting(preview, {isSkipExcludesRender: true}));
		this._renderAdvancedJson({wrp});
	}
}
