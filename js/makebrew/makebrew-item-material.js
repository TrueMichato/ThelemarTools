import {
	CRAFTING_WORKBENCH_VOCABULARY,
	CraftingWorkbenchCore,
} from "../itembuilder/crafting-workbench-core.js";
import {RenderCrafting} from "../render-crafting.js";
import {BuilderUi} from "./makebrew-builderui.js";
import {CraftingWorkbenchBuilderBase} from "./makebrew-crafting-workbench.js";

const _DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const _NOTE_MODES = ["qualifier"];

export class ItemMaterialBuilder extends CraftingWorkbenchBuilderBase {
	constructor () {
		super({prop: "itemMaterial"});
		this._catalog = [];
	}

	async _pInit () {
		const [data, brew] = await Promise.all([
			DataUtil.itemMaterial.loadJSON(),
			BrewUtil2.pGetBrewProcessed(),
		]);
		this._catalog = CraftingWorkbenchCore.dedupe([...(data.itemMaterial || []), ...(brew.itemMaterial || [])]);
	}

	async pHandleClickLoadExisting () {
		if (!this._catalog.length) return JqueryUtil.doToast({type: "warning", content: "No item materials are available to use as a starting point."});
		const selected = await InputUiUtil.pGetUserEnum({
			title: "Choose Item Material",
			values: this._catalog,
			fnDisplay: it => `${it.name} (${Parser.sourceJsonToAbv(it.source)})`,
			isResolveItem: true,
		});
		if (!selected) return;
		return this.pHandleLoadExistingData(selected);
	}

	_getStageDefinitions () {
		return [
			{name: "Base", render: this._renderBaseStage.bind(this)},
			{name: "Application & Axes", render: this._renderApplicationStage.bind(this)},
			{name: "Effects & Durability", render: this._renderEffectsStage.bind(this)},
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

	_renderMultiSelect ({wrp, label, object, prop, values, cb, fnDisplay = it => it}) {
		const selected = new Set(Array.isArray(object[prop]) ? object[prop] : []);
		const controls = values.map(value => {
			const input = ee`<input type="checkbox">`
				.prop("checked", selected.has(value))
				.onn("change", () => {
					if (input.prop("checked")) selected.add(value);
					else selected.delete(value);
					object[prop] = values.filter(it => selected.has(it));
					cb();
				});
			return ee`<label class="mkbru_cw__check">${input}<span>${fnDisplay(value)}</span></label>`;
		});
		ee`<fieldset class="mkbru_cw__field mkbru_cw__field--stack">
			<legend class="mkbru_cw__field-label">${label}</legend>
			<div class="mkbru_cw__checks">${controls}</div>
		</fieldset>`.appendTo(wrp);
	}

	_renderBaseStage ({wrp, cb}) {
		const section = ee`<section class="mkbru_cw__section">
			<h3>Identity</h3>
			<p class="ve-muted">Name the material and record where its rules are published.</p>
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
			values: CRAFTING_WORKBENCH_VOCABULARY.itemMaterial.categories,
			cb,
			nullable: false,
			fnDisplay: it => it.toTitleCase(),
		});
		this._renderSelect({
			wrp: section,
			label: "Rarity",
			object: this._draft,
			prop: "rarity",
			values: CRAFTING_WORKBENCH_VOCABULARY.rarities,
			cb,
			nullable: false,
			fnDisplay: it => it.toTitleCase(),
		});

		const physical = ee`<section class="mkbru_cw__section">
			<h3>Physical reference</h3>
			<p class="ve-muted">Density is measured in g/cm³. Object AC is the material's durability reference.</p>
		</section>`.appendTo(wrp);
		this._renderBoolean({
			wrp: physical,
			label: "Density varies",
			object: this._draft,
			prop: "densityVaries",
			cb: () => {
				if (this._draft.densityVaries) this._draft.density = null;
				cb();
				this.renderInput();
			},
			hint: "Use when the source gives no single density.",
		});
		const densityInput = this._renderNumber({wrp: physical, label: "Density", object: this._draft, prop: "density", cb});
		densityInput.prop("disabled", !!this._draft.densityVaries).attr("aria-disabled", `${!!this._draft.densityVaries}`);
		this._renderNumber({wrp: physical, label: "Weight multiplier", object: this._draft, prop: "weightMultiplier", cb, hint: "Optional override for density-derived item weight."});
		this._renderNumber({wrp: physical, label: "Object AC", object: this._draft, prop: "objectAc", cb});
		this._renderBoolean({wrp: physical, label: "Object AC inferred", object: this._draft, prop: "objectAcInferred", cb, nullable: true});
		this._draft.color ||= {};
		this._renderText({wrp: physical, label: "Color (CSS)", object: this._draft.color, prop: "css", cb, placeholder: "#4c6f8c"});
	}

	_renderApplicationStage ({wrp, cb}) {
		const axes = ee`<section class="mkbru_cw__section">
			<h3>Material axes</h3>
			<p class="ve-muted">Choose a number, Varies, or Not applicable. Magic Capacity also supports positive and negative infinity.</p>
			<div class="mkbru_cw__axis-grid"></div>
		</section>`.appendTo(wrp);
		const axisGrid = axes.querySelector(".mkbru_cw__axis-grid");
		for (const axis of CRAFTING_WORKBENCH_VOCABULARY.itemMaterial.axes) this._renderAxis({wrp: axisGrid, axis, cb});

		const application = ee`<section class="mkbru_cw__section">
			<h3>Application</h3>
			<p class="ve-muted">Scope the material to the item kinds and construction roles it can support.</p>
		</section>`.appendTo(wrp);
		this._renderMultiSelect({
			wrp: application,
			label: "Applies to",
			object: this._draft,
			prop: "appliesTo",
			values: CRAFTING_WORKBENCH_VOCABULARY.itemMaterial.appliesTo,
			cb,
			fnDisplay: Parser.itemMaterialAppliesToFull,
		});
		this._renderMultiSelect({
			wrp: application,
			label: "Roles",
			object: this._draft,
			prop: "roles",
			values: CRAFTING_WORKBENCH_VOCABULARY.itemMaterial.roles,
			cb: () => {
				if (this._draft.primaryRole && !this._draft.roles.includes(this._draft.primaryRole)) delete this._draft.primaryRole;
				cb();
				this.renderInput();
			},
			fnDisplay: Parser.itemMaterialRoleToFull,
		});
		this._renderSelect({
			wrp: application,
			label: "Primary role",
			object: this._draft,
			prop: "primaryRole",
			values: this._draft.roles,
			cb,
			fnDisplay: Parser.itemMaterialRoleToFull,
		});

		this._draft.price ||= {gp: 0, unit: "lb", display: "", isPriceless: false};
		const price = ee`<section class="mkbru_cw__section">
			<h3>Price</h3>
			<p class="ve-muted">Item-material prices are authored in gp because their trade units vary. The display text is rendered verbatim.</p>
		</section>`.appendTo(wrp);
		this._renderNumber({wrp: price, label: "Price (gp)", object: this._draft.price, prop: "gp", cb});
		this._renderSelect({
			wrp: price,
			label: "Unit",
			object: this._draft.price,
			prop: "unit",
			values: CRAFTING_WORKBENCH_VOCABULARY.itemMaterial.priceUnits,
			cb,
			nullable: false,
		});
		this._renderText({wrp: price, label: "Display", object: this._draft.price, prop: "display", cb, placeholder: "550 gp per lb."});
		this._renderBoolean({wrp: price, label: "Priceless", object: this._draft.price, prop: "isPriceless", cb});
		const range = this._draft.price.range && typeof this._draft.price.range === "object" && !Array.isArray(this._draft.price.range)
			? this._draft.price.range
			: {};
		const cbRange = () => {
			if (Object.keys(range).length) this._draft.price.range = range;
			else delete this._draft.price.range;
			cb();
		};
		this._renderNumber({wrp: price, label: "Range minimum (gp)", object: range, prop: "min", cb: cbRange});
		this._renderNumber({wrp: price, label: "Range maximum (gp)", object: range, prop: "max", cb: cbRange});
	}

	_renderAxis ({wrp, axis, cb}) {
		const value = this._draft[axis];
		const mode = value === "na"
			? "na"
			: value === "infinity" || value === "-infinity"
				? value
				: value == null
					? "varies"
					: "number";
		const modes = [
			["number", "Number"],
			["varies", "Varies"],
			["na", "Not applicable"],
			...(axis === "magicCapacity" ? [["infinity", "Positive infinity"], ["-infinity", "Negative infinity"]] : []),
		];
		const select = ee`<select class="ve-form-control ve-input-xs">
			${modes.map(([key, label]) => `<option value="${key}">${label}</option>`)}
		</select>`.val(mode);
		const number = ee`<input class="ve-form-control ve-input-xs" type="number" aria-label="${axis.toTitleCase()} numeric value">`
			.val(mode === "number" ? value : "")
			.prop("disabled", mode !== "number");
		select.onn("change", () => {
			const modeNext = select.val();
			this._draft[axis] = modeNext === "number" ? 0 : modeNext === "varies" ? null : modeNext;
			cb();
			this.renderInput();
		});
		number.onn("change", () => {
			this._draft[axis] = Number.isFinite(Number(number.val())) ? Number(number.val()) : 0;
			cb();
		});
		ee`<label class="mkbru_cw__axis-card">
			<span>${axis.replace(/([A-Z])/g, " $1").toTitleCase()}</span>
			${select}
			${number}
		</label>`.appendTo(wrp);
	}

	_renderEffectsStage ({wrp, cb}) {
		const effects = ee`<section class="mkbru_cw__section">
			<div class="mkbru_cw__section-heading">
				<div><h3>Material effects</h3><p class="ve-muted">Use the shared fields for every effect and Details JSON for its specialized payload.</p></div>
				<button class="ve-btn ve-btn-primary ve-btn-sm" type="button">Add effect</button>
			</div>
			<div class="mkbru_cw__rows"></div>
		</section>`.appendTo(wrp);
		effects.querySelector("button").addEventListener("click", () => {
			this._draft.effects = CraftingWorkbenchCore.addRow(this._draft.effects, {type: "note", text: ""});
			this._doSync({isRenderInput: true});
		});
		const effectRows = effects.querySelector(".mkbru_cw__rows");
		this._draft.effects.forEach((effect, ix) => this._renderEffectRow({wrp: effectRows, effect, ix, cb}));

		const magicRules = ee`<section class="mkbru_cw__section">
			<div class="mkbru_cw__section-heading">
				<div><h3>Magic Capacity rules</h3><p class="ve-muted">Record capacity exceptions without hiding their authored note.</p></div>
				<button class="ve-btn ve-btn-default ve-btn-sm" type="button">Add rule</button>
			</div>
			<div class="mkbru_cw__rows"></div>
		</section>`.appendTo(wrp);
		magicRules.querySelector("button").addEventListener("click", () => {
			this._draft.magicCapacityRules = CraftingWorkbenchCore.addRow(this._draft.magicCapacityRules, {type: "freeEffect", note: ""});
			this._doSync({isRenderInput: true});
		});
		const ruleRows = magicRules.querySelector(".mkbru_cw__rows");
		this._draft.magicCapacityRules.forEach((rule, ix) => this._renderMagicRuleRow({wrp: ruleRows, rule, ix, cb}));

		this._renderDegradationEditor({wrp, cb});
	}

	_renderRowActions ({wrp, rows, ix}) {
		const move = delta => {
			this._draft[rows] = CraftingWorkbenchCore.moveRow(this._draft[rows], ix, ix + delta);
			this._doSync({isRenderInput: true});
		};
		const remove = () => {
			this._draft[rows] = CraftingWorkbenchCore.removeRow(this._draft[rows], ix);
			this._doSync({isRenderInput: true});
		};
		const up = ee`<button class="ve-btn ve-btn-xs ve-btn-default" type="button" title="Move up" aria-label="Move row up"><span class="glyphicon glyphicon-arrow-up"></span></button>`
			.prop("disabled", ix === 0)
			.onn("click", () => move(-1));
		const down = ee`<button class="ve-btn ve-btn-xs ve-btn-default" type="button" title="Move down" aria-label="Move row down"><span class="glyphicon glyphicon-arrow-down"></span></button>`
			.prop("disabled", ix === this._draft[rows].length - 1)
			.onn("click", () => move(1));
		const del = ee`<button class="ve-btn ve-btn-xs ve-btn-danger" type="button" title="Remove" aria-label="Remove row"><span class="glyphicon glyphicon-trash"></span></button>`
			.onn("click", remove);
		ee`<div class="ve-btn-group">${up}${down}${del}</div>`.appendTo(wrp);
	}

	_renderEffectRow ({wrp, effect, ix, cb}) {
		const row = ee`<article class="mkbru_cw__row">
			<header><strong>Effect ${ix + 1}</strong><div class="mkbru_cw__row-actions"></div></header>
			<div class="mkbru_cw__row-grid"></div>
		</article>`.appendTo(wrp);
		this._renderRowActions({wrp: row.querySelector(".mkbru_cw__row-actions"), rows: "effects", ix});
		const grid = row.querySelector(".mkbru_cw__row-grid");
		this._renderSelect({
			wrp: grid,
			label: "Type",
			object: effect,
			prop: "type",
			values: CRAFTING_WORKBENCH_VOCABULARY.itemMaterial.effectTypes,
			cb,
			nullable: false,
		});
		this._renderMultiSelect({
			wrp: grid,
			label: "Applies to",
			object: effect,
			prop: "appliesTo",
			values: CRAFTING_WORKBENCH_VOCABULARY.itemMaterial.appliesTo,
			cb,
			fnDisplay: Parser.itemMaterialAppliesToFull,
		});
		this._renderText({
			wrp: grid,
			label: "Value",
			object: effect,
			prop: "value",
			cb,
			fnParse: raw => raw.trim() === "" ? null : Number.isFinite(Number(raw)) ? Number(raw) : raw.trim(),
		});
		this._renderText({wrp: grid, label: "Text", object: effect, prop: "text", cb});
		this._renderText({wrp: grid, label: "Note", object: effect, prop: "note", cb});
		this._renderSelect({wrp: grid, label: "Note mode", object: effect, prop: "noteMode", values: _NOTE_MODES, cb});
		this._renderContextJson({
			wrp: row,
			label: "Effect details JSON",
			object: effect,
			commonProps: ["type", "appliesTo", "value", "text", "note", "noteMode"],
			cb,
		});
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
			<p class="ve-muted ve-small">Examples include dice, properties, schools, damage types, action metadata, ladders, and conditional gates.</p>
			${textarea}${status}
		</details>`.appendTo(wrp);
	}

	_renderMagicRuleRow ({wrp, rule, ix, cb}) {
		const row = ee`<article class="mkbru_cw__row">
			<header><strong>Capacity rule ${ix + 1}</strong><div class="mkbru_cw__row-actions"></div></header>
			<div class="mkbru_cw__row-grid"></div>
		</article>`.appendTo(wrp);
		this._renderRowActions({wrp: row.querySelector(".mkbru_cw__row-actions"), rows: "magicCapacityRules", ix});
		const grid = row.querySelector(".mkbru_cw__row-grid");
		this._renderSelect({
			wrp: grid,
			label: "Type",
			object: rule,
			prop: "type",
			values: CRAFTING_WORKBENCH_VOCABULARY.itemMaterial.magicCapacityRuleTypes,
			cb,
			nullable: false,
		});
		this._renderNumber({wrp: grid, label: "Value", object: rule, prop: "value", cb});
		this._renderText({wrp: grid, label: "Theme", object: rule, prop: "theme", cb});
		this._renderText({wrp: grid, label: "Applies to", object: rule, prop: "appliesTo", cb});
		this._renderText({wrp: grid, label: "When", object: rule, prop: "when", cb});
		this._renderText({wrp: grid, label: "Authored note", object: rule, prop: "note", cb});
	}

	_renderDegradationEditor ({wrp, cb}) {
		const section = ee`<section class="mkbru_cw__section">
			<h3>Degradation</h3>
			<p class="ve-muted">Describe when the material degrades, what changes, whether wear stacks, and how it can be repaired.</p>
		</section>`.appendTo(wrp);
		const toggleState = {enabled: !!this._draft.degradation};
		this._renderBoolean({
			wrp: section,
			label: "Material can degrade",
			object: toggleState,
			prop: "enabled",
			cb: () => {
				if (toggleState.enabled) {
					this._draft.degradation = {
						trigger: {on: "attackRoll", natural: [1]},
						effect: {type: "damageStepDelta", value: -1},
						stacking: false,
						destroys: false,
						repair: {method: "manual", tool: null},
						note: "",
					};
				} else delete this._draft.degradation;
				this._doSync({isRenderInput: true});
			},
		});
		if (!this._draft.degradation) return;

		const degradation = this._draft.degradation;
		degradation.trigger ||= {};
		degradation.effect ||= {};
		const grid = ee`<div class="mkbru_cw__row-grid"></div>`.appendTo(section);
		this._renderSelect({
			wrp: grid,
			label: "Trigger",
			object: degradation.trigger,
			prop: "on",
			values: CRAFTING_WORKBENCH_VOCABULARY.itemMaterial.degradationTriggerTypes,
			cb,
			nullable: false,
		});
		this._renderText({
			wrp: grid,
			label: "Natural rolls",
			object: degradation.trigger,
			prop: "natural",
			cb,
			placeholder: "1, 20",
			fnParse: raw => raw.split(",").map(it => Number(it.trim())).filter(Number.isFinite),
		});
		this._renderSelect({wrp: grid, label: "Damage type", object: degradation.trigger, prop: "damageType", values: _DAMAGE_TYPES, cb});
		this._renderBoolean({wrp: grid, label: "Also on critical hit", object: degradation.trigger, prop: "alsoOnCriticalHit", cb, nullable: true});
		this._renderSelect({
			wrp: grid,
			label: "Effect",
			object: degradation.effect,
			prop: "type",
			values: CRAFTING_WORKBENCH_VOCABULARY.itemMaterial.degradationEffectTypes,
			cb,
			nullable: false,
		});
		this._renderNumber({wrp: grid, label: "Effect value", object: degradation.effect, prop: "value", cb});
		this._renderMultiSelect({
			wrp: grid,
			label: "Axes reduced to zero",
			object: degradation.effect,
			prop: "axes",
			values: CRAFTING_WORKBENCH_VOCABULARY.itemMaterial.axes,
			cb,
			fnDisplay: it => it.replace(/([A-Z])/g, " $1").toTitleCase(),
		});
		this._renderBoolean({wrp: grid, label: "Stacks", object: degradation, prop: "stacking", cb});
		this._renderBoolean({wrp: grid, label: "Destroys item", object: degradation, prop: "destroys", cb});
		const repairState = {enabled: degradation.repair != null};
		this._renderBoolean({
			wrp: grid,
			label: "Repair available",
			object: repairState,
			prop: "enabled",
			cb: () => {
				degradation.repair = repairState.enabled ? {method: "manual", tool: null} : null;
				this._doSync({isRenderInput: true});
			},
		});
		if (degradation.repair) {
			this._renderSelect({
				wrp: grid,
				label: "Repair method",
				object: degradation.repair,
				prop: "method",
				values: CRAFTING_WORKBENCH_VOCABULARY.itemMaterial.degradationRepairMethods,
				cb,
				nullable: false,
			});
			this._renderText({wrp: grid, label: "Repair tools", object: degradation.repair, prop: "tool", cb});
		}
		this._renderText({wrp: section, label: "Degradation note", object: degradation, prop: "note", cb});
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
		const preview = this.constructor.getPreviewEntity("itemMaterial", this._draft);
		const previewTable = ee`<table class="ve-w-100 ve-stats" aria-label="Item material review preview"></table>`;
		ee`<section class="mkbru_cw__review">
			<div class="mkbru_cw__review-summary">
				<h3>Review ${this._draft.name || "unnamed material"}</h3>
				<p>${(this._draft.materialCategory || "No category").toTitleCase()} · ${this._draft.source || "No source"}</p>
				<p>${this._draft.effects.length} effect${this._draft.effects.length === 1 ? "" : "s"} · ${this._draft.magicCapacityRules.length} Magic Capacity rule${this._draft.magicCapacityRules.length === 1 ? "" : "s"}${this._draft.degradation ? " · Degrades in use" : ""}</p>
				<p class="ve-muted">Resolve any validation message above, then use Save in the builder toolbar.</p>
			</div>
			<div class="mkbru_cw__review-preview">${previewTable}</div>
		</section>`.appendTo(wrp);
		previewTable.appends(RenderCrafting.getRenderedCrafting(preview, {isSkipExcludesRender: true}));
		BuilderUi.getStateIptEntries(
			"Description",
			() => this._doSync(),
			this._draft,
			{nullable: true, fnPostProcess: BuilderUi.fnPostProcessDice},
			"entries",
		).appendTo(wrp);
		this._renderAdvancedJson({wrp});
	}
}
