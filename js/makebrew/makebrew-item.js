import {ItemBuilderCore} from "../itembuilder/itembuilder-core.js";
import {ItemCompositionCatalogPicker} from "../itembuilder/itembuilder-catalog-picker.js";
import {ItemBuilderHandoff} from "../itembuilder/itembuilder-handoff.js";
import {BuilderBase} from "./makebrew-builder-base.js";
import {BuilderUi} from "./makebrew-builderui.js";

const _RARITIES = ["none", "common", "uncommon", "rare", "very rare", "legendary", "artifact", "unknown", "unknown (magic)"];
const _ITEM_TYPES = ["A", "AF", "AT", "EM", "EXP", "FD", "G", "GS", "HA", "INS", "LA", "M", "MA", "MNT", "OTH", "P", "R", "RD", "RG", "S", "SC", "SCF", "ST", "T", "TAH", "TG", "WD", "W"];
const _ITEM_TYPE_LABELS = {
	A: "Ammunition",
	AF: "Futuristic Ammunition",
	AT: "Artisan's Tools",
	EM: "Eldritch Machine",
	EXP: "Explosive",
	FD: "Food and Drink",
	G: "Adventuring Gear",
	GS: "Gaming Set",
	HA: "Heavy Armor",
	INS: "Instrument",
	LA: "Light Armor",
	M: "Melee Weapon",
	MA: "Medium Armor",
	MNT: "Mount",
	OTH: "Other",
	P: "Potion",
	R: "Ranged Weapon",
	RD: "Rod",
	RG: "Ring",
	S: "Shield",
	SC: "Scroll",
	SCF: "Spellcasting Focus",
	ST: "Staff",
	T: "Tool",
	TAH: "Tack and Harness",
	TG: "Trade Good",
	WD: "Wand",
	W: "Wondrous Item",
};

export async function pConsumeItemBuilderHandoff ({ui, builder, storage = StorageUtil}) {
	const result = await ItemBuilderHandoff.pConsume({storage});
	if (result.status === "empty") return result;
	await ui.pSetActiveBuilderById("itemBuilder");
	builder.setStateFromHandoffResult(result);
	return result;
}

export class ItemBuilder extends BuilderBase {
	constructor () {
		super({
			prop: "item",
			pFnGetFluff: Renderer.item.pGetFluff.bind(Renderer.item),
		});
		this._catalogs = {items: [], materials: [], upgrades: []};
		this._draft = null;
		this._saveStatus = "";
		this._wrpValidation = null;
		this._renderOutputDebounced = MiscUtil.debounce(() => this._renderOutput(), 50);
	}

	async _pInit () {
		const [itemData, materialData, upgradeData, brew] = await Promise.all([
			DataUtil.item.loadJSON(),
			DataUtil.itemMaterial.loadJSON(),
			DataUtil.itemUpgrade.loadJSON(),
			BrewUtil2.pGetBrewProcessed(),
		]);
		this._catalogs = {
			items: ItemBuilderCore.dedupeCatalog([...(itemData.baseitem || []), ...(itemData.item || []), ...(brew.item || [])]),
			materials: ItemBuilderCore.dedupeCatalog([...(materialData.itemMaterial || []), ...(brew.itemMaterial || [])]),
			upgrades: ItemBuilderCore.dedupeCatalog([...(upgradeData.itemUpgrade || []), ...(brew.itemUpgrade || [])]),
		};
	}

	_getInitialState () {
		return {
			...super._getInitialState(),
			...ItemBuilderCore.createDraft({source: this._ui?.source}).item,
		};
	}

	getSaveableState () {
		return {
			...super.getSaveableState(),
			d: this._draft,
		};
	}

	setStateFromLoaded (state) {
		if (!state?.s || !state?.m) return;
		this._doResetProxies();
		if (!state.s.uniqueId) state.s.uniqueId = CryptUtil.uid();
		this.__state = state.s;
		this.__meta = state.m;
		this._draft = ItemBuilderCore.normalizeDraft(state.d || ItemBuilderCore.fromItem(state.s), {source: this._ui?.source});
	}

	setStateFromHandoffResult (result) {
		if (result.status === "success") {
			const draft = ItemBuilderCore.normalizeDraft(result.draft, {source: this._ui?.source});
			draft.item.uniqueId = CryptUtil.uid();
			const item = ItemBuilderCore.serialize(draft, this._catalogs);
			item.uniqueId = draft.item.uniqueId;
			this.setStateFromLoaded({
				s: item,
				d: draft,
				m: this._getInitialMetaState({
					nameOriginal: item.name,
					isModified: true,
					isPersisted: false,
				}),
			});
			this._saveStatus = "Quick Forge draft restored. Review it, then save when ready.";
		} else {
			this._draft = this._draft || ItemBuilderCore.fromItem(this.__state);
			this._saveStatus = result.message;
		}

		this.renderInput();
		this.renderOutput();
		this.doUiSave();
	}

	_getAsMarkdown (item) {
		const projected = ItemBuilderCore.projectForPreview(ItemBuilderCore.fromItem(item), this._catalogs);
		return RendererMarkdown.item.getCompactRenderedString(projected);
	}

	async pDoHandleClickDownloadMarkdown ({uniqueIds = null} = {}) {
		const entities = (await this._pGetBrewEntitiesCurrentSource())
			.filter(ent => uniqueIds == null || uniqueIds.includes(ent.uniqueId))
			.map(ent => ItemBuilderCore.projectForPreview(ItemBuilderCore.fromItem(ent), this._catalogs));
		const mdOut = await RendererMarkdown.exporting.pGetMarkdownDoc({
			ents: entities,
			prop: this._prop,
			pFnGetFluff: this._pFnGetFluff,
		});
		DataUtil.userDownloadText(`${DataUtil.getCleanFilename(BrewUtil2.sourceJsonToFull(this._ui.source))}.md`, mdOut);
	}

	async pHandleClick_viewMarkdownUniqueId (evt, uniqueId) {
		const entry = MiscUtil.copy(await BrewUtil2.pGetEditableBrewEntity(this._prop, uniqueId));
		const name = `${entry._displayName || entry.name} \u2014 Markdown`;
		const mdText = this._getAsMarkdown(entry);
		Renderer.hover.getShowWindow(
			Renderer.hover.getHoverContent_miscCode(name, mdText),
			Renderer.hover.getWindowPositionFromEvent(evt),
			{
				title: name,
				isPermanent: true,
				isBookContent: true,
			},
		);
	}

	async pHandleClickLoadExisting () {
		const result = await SearchWidget.pGetUserItemSearch();
		if (!result) return;
		const item = MiscUtil.copy(await DataLoader.pCacheAndGet(result.page, result.source, result.hash));
		return this.pHandleLoadExistingData(item);
	}

	async pHandleLoadExistingData (item, opts = {}) {
		this._draft = ItemBuilderCore.applyPreset(
			ItemBuilderCore.createDraft({source: this._ui.source}),
			item,
			{source: this._ui.source},
		);
		this.__state = ItemBuilderCore.serialize(this._draft, this._catalogs);
		this.__state.uniqueId = CryptUtil.uid();
		this.__meta = {
			...(opts.meta || {}),
			...this._getInitialMetaState({nameOriginal: this.__state.name, isModified: true}),
		};
		this.renderInput();
		this.renderOutput();
		this.doUiSave();
	}

	_setStateFromLoaded (state) {
		this.setStateFromLoaded(state);
	}

	doHandleSourcesAdd () {
		this._sourcesCache = MiscUtil.copy(this._ui.allSources);
	}

	_renderInputImpl () {
		this._doCreateProxies();
		this._doBindHeaderElements();
		this._draft = this._draft || ItemBuilderCore.fromItem(this.__state);
		if (!this._draft.item.source && this._ui?.source) this._draft.item.source = this._ui.source;
		this._renderInputMain();
	}

	_doSync ({isRenderInput = false} = {}) {
		this._saveStatus = "";
		const uniqueId = this.__state.uniqueId || CryptUtil.uid();
		const canonical = ItemBuilderCore.serialize(this._draft, this._catalogs);
		canonical.uniqueId = uniqueId;
		for (const key of Object.keys(this.__state)) delete this.__state[key];
		Object.assign(this.__state, canonical);
		this._meta.isModified = true;
		this._dispHeaderName?.txt(`Editing "${this.__state.name || "?"}"`);
		this.renderOutput();
		this.doUiSave();
		this._refreshValidation();
		if (this._wrpReview) this._renderReviewTab({wrp: this._wrpReview});
		if (isRenderInput) this.renderInput();
	}

	_getCb () {
		return MiscUtil.debounce(() => this._doSync(), 33);
	}

	_renderInputMain () {
		this._sourcesCache = MiscUtil.copy(this._ui.allSources);
		const wrp = this._ui.wrpInput.empty();
		const cb = this._getCb();
		this._cbCache = cb;

		this._resetTabs({tabGroup: "input"});
		const opts = {hasBorder: true, hasBackground: true};
		const tabs = this._renderTabs([
			new TabUiUtil.TabMeta({...opts, name: "1 Base"}),
			new TabUiUtil.TabMeta({...opts, name: "2 Composition"}),
			new TabUiUtil.TabMeta({...opts, name: "3 Details"}),
			new TabUiUtil.TabMeta({...opts, name: "4 Review & Save"}),
		], {tabGroup: "input", cbTabChange: this.doUiSave.bind(this)});
		const [baseTab, compositionTab, detailsTab, reviewTab] = tabs;
		baseTab.wrpTab.addClass("mkbru_item__stage").addClass("mkbru_item__stage--base");
		compositionTab.wrpTab.addClass("mkbru_item__stage").addClass("mkbru_item__stage--composition");
		detailsTab.wrpTab.addClass("mkbru_item__stage").addClass("mkbru_item__stage--details");
		reviewTab.wrpTab.addClass("mkbru_item__stage").addClass("mkbru_item__stage--review");
		const wrpTabHeads = ee`<div class="ve-w-100 ve-no-shrink ve-ui-tab__wrp-tab-heads--border mkbru_item__tabs" role="tablist" aria-label="Item creation steps">${tabs.map(it => it.btnTab)}</div>`.appendTo(wrp);
		this._decorateTabsA11y({tabs, wrpTabHeads});
		this._wrpValidation = ee`<div class="mkbru_item__validation-slot"></div>`.appendTo(wrp);
		this._refreshValidation();
		tabs.forEach(it => it.wrpTab.appendTo(wrp));

		this._renderPresetTab({wrp: baseTab.wrpTab, cb});
		this._renderCompositionTab({wrp: compositionTab.wrpTab});
		this._renderDetailsTab({wrp: detailsTab.wrpTab, cb});
		this._wrpReview = reviewTab.wrpTab;
		this._renderReviewTab({wrp: this._wrpReview});
	}

	_decorateTabsA11y ({tabs}) {
		const setActive = activeTab => tabs.forEach((tab, ix) => {
			const idTab = `mkbru-item-tab-${ix}`;
			const idPanel = `mkbru-item-panel-${ix}`;
			tab.btnTab.attr("id", idTab).attr("role", "tab").attr("aria-controls", idPanel);
			tab.wrpTab.attr("id", idPanel).attr("role", "tabpanel").attr("aria-labelledby", idTab);
			const isActive = tab === activeTab;
			tab.btnTab.attr("aria-selected", `${isActive}`).attr("tabindex", isActive ? "0" : "-1");
		});
		tabs.forEach((tab, ix) => {
			tab.btnTab
				.onn("click", () => setActive(tab))
				.onn("keydown", evt => {
					const keyToIx = {
						ArrowLeft: (ix - 1 + tabs.length) % tabs.length,
						ArrowRight: (ix + 1) % tabs.length,
						Home: 0,
						End: tabs.length - 1,
					};
					const ixNext = keyToIx[evt.key];
					if (ixNext == null) return;
					evt.preventDefault();
					tabs[ixNext].btnTab.click();
					tabs[ixNext].btnTab.focuse();
				});
		});
		setActive(tabs[this._getIxActiveTab({tabGroup: "input"})] || tabs[0]);
	}

	_renderPresetTab ({wrp, cb}) {
		ee`<header class="mkbru_item__stage-intro">
			<div>
				<h2>Define the item</h2>
				<p>Start from an existing item or establish the identity of a new one.</p>
			</div>
			<span>Base</span>
		</header>`.appendTo(wrp);
		const btnChoose = ee`<button class="ve-btn ve-btn-primary ve-btn-sm">Choose catalog preset</button>`
			.onn("click", () => this.pHandleClickLoadExisting());
		const presetName = this._draft.preset ? `${this._draft.preset.name} (${this._draft.preset.source})` : "No preset selected";
		ee`<div class="mkbru_item__preset">
			<div>
				<div class="ve-bold">Start from trusted item data</div>
				<div class="ve-muted ve-small">A preset supplies the base weapon, armor, or item fields. Your homebrew source and later edits remain yours.</div>
			</div>
			<div class="ve-flex-v-center ve-flex-wrap">
				<span class="mkbru_item__selection ve-mr-2">${presetName.qq()}</span>
				${btnChoose}
			</div>
		</div>`.appendTo(wrp);

		BuilderUi.getStateIptString("Name", cb, this._draft.item, {nullable: false}, "name").appendTo(wrp);
		this._selSource = BuilderUi.getStateIptEnum(
			"Saved under",
			cb,
			this._draft.item,
			{vals: this._sourcesCache, fnDisplay: Parser.sourceJsonToFull, nullable: false},
			"source",
		).appendTo(wrp);
		BuilderUi.getStateIptString("Page", cb, this._draft.item, {}, "page").appendTo(wrp);
		BuilderUi.getStateIptEnum("Type", () => this._doSync({isRenderInput: true}), this._draft.item, {vals: _ITEM_TYPES, nullable: false, fnDisplay: it => _ITEM_TYPE_LABELS[it] || it}, "type").appendTo(wrp);
		BuilderUi.getStateIptEnum("Rarity", cb, this._draft.item, {vals: _RARITIES, nullable: false, fnDisplay: it => it.toTitleCase()}, "rarity").appendTo(wrp);
		BuilderUi.getStateIptString("Attunement", cb, this._draft.item, {nullable: true}, "reqAttune").appendTo(wrp);
	}

	_renderCompositionTab ({wrp}) {
		ee`<header class="mkbru_item__stage-intro">
			<div>
				<h2>Shape the composition</h2>
				<p>Compare compatible materials, upgrades, and gemstones without losing their source provenance.</p>
			</div>
			<span>Composition</span>
		</header>`.appendTo(wrp);
		const selected = [
			this._draft.material ? `Material: ${this._draft.material.name} (${this._draft.material.source})` : null,
			...this._draft.upgrades.map(it => `Upgrade: ${it.name} (${it.source})`),
			this._draft.gemstone ? `Gemstone: ${this._draft.gemstone.name} (${this._draft.gemstone.source})` : null,
		].filter(Boolean);
		ee`<section class="mkbru_item__composition-summary">
			<div>
				<strong>Current composition</strong>
				<span>${selected.length ? "Selected components appear first in each catalog view." : "Choose a material, upgrades, or a gemstone to shape this item."}</span>
			</div>
			<span>${(selected.length ? selected.join(" \u00b7 ") : "No components selected").qq()}</span>
		</section>`.appendTo(wrp);
		new ItemCompositionCatalogPicker({
			draft: this._draft,
			catalogs: this._catalogs,
			onSelect: ({category, entity, isSelected}) => {
				const ref = {name: entity.name, source: entity.source};
				const uid = ItemBuilderCore.packUid(ref);
				if (category === "material") this._draft.material = isSelected ? null : ref;
				if (category === "gemstone") this._draft.gemstone = isSelected ? null : ref;
				if (category === "upgrade") {
					this._draft.upgrades = isSelected
						? this._draft.upgrades.filter(it => ItemBuilderCore.packUid(it) !== uid)
						: [...this._draft.upgrades, ref];
				}
				this._doSync({isRenderInput: true});
			},
		}).render({wrp});
	}

	_renderDetailsTab ({wrp, cb}) {
		ee`<header class="mkbru_item__stage-intro">
			<div>
				<h2>Describe the result</h2>
				<p>Add the mechanics and rules text that belong to this specific item.</p>
			</div>
			<span>Details</span>
		</header>`.appendTo(wrp);
		const wrpMechanics = ee`<section class="mkbru_item__section"><h3>Mechanics</h3></section>`.appendTo(wrp);
		this._renderMechanicsTab({wrp: wrpMechanics, cb});
		const wrpDescription = ee`<section class="mkbru_item__section"><h3>Description</h3></section>`.appendTo(wrp);
		this._renderDescriptionTab({wrp: wrpDescription, cb});
		const wrpAdvanced = ee`<details class="mkbru_item__section mkbru_item__details-advanced"><summary>Advanced canonical fields</summary></details>`.appendTo(wrp);
		this._renderAdvancedTab({wrp: wrpAdvanced});
	}

	_renderMechanicsTab ({wrp, cb}) {
		const type = String(this._draft.item.type || "").split("|")[0];
		const isWeapon = ["A", "M", "R"].includes(type);
		const isArmor = ["HA", "LA", "MA", "S"].includes(type);
		const fields = [
			["Weight (lb.)", "weight"],
			["Value (cp)", "value"],
			...isArmor ? [
				["Armor Class", "ac"],
				["Dexterity Maximum", "dexterityMax"],
				["Strength Requirement", "strength"],
				["AC Bonus", "bonusAc"],
			] : [],
			...isWeapon ? [
				["Damage", "dmg1"],
				["Versatile Damage", "dmg2"],
				["Damage Type", "dmgType"],
				["Range", "range"],
				["Weapon Bonus", "bonusWeapon"],
				["Weapon Attack Bonus", "bonusWeaponAttack"],
				["Weapon Damage Bonus", "bonusWeaponDamage"],
			] : [],
			["Charges", "charges"],
			["Recharge", "recharge"],
			["Recharge Amount", "rechargeAmount"],
			["Spell Attack Bonus", "bonusSpellAttack"],
			["Spell Save DC Bonus", "bonusSpellSaveDc"],
			["Saving Throw Bonus", "bonusSavingThrow"],
			["Ability Check Bonus", "bonusAbilityCheck"],
		];
		for (const [label, prop] of fields) BuilderUi.getStateIptString(label, cb, this._draft.item, {nullable: true}, prop).appendTo(wrp);
		if (isWeapon) BuilderUi.getStateIptStringArray("Properties", cb, this._draft.item, {shortName: "Property"}, "property").appendTo(wrp);
		BuilderUi.getStateIptStringArray("Attached Spells", cb, this._draft.item, {shortName: "Spell UID"}, "attachedSpells").appendTo(wrp);
		this._renderSpellcastingFocus({wrp, cb});
	}

	_renderSpellcastingFocus ({wrp, cb}) {
		const focusMode = {isUniversal: this._draft.item.focus === true};
		BuilderUi.getStateIptBoolean(
			"Universal Spellcasting Focus",
			() => {
				this._draft.item.focus = focusMode.isUniversal ? true : [];
				this._doSync({isRenderInput: true});
			},
			focusMode,
			{nullable: false},
			"isUniversal",
		).appendTo(wrp);
		if (focusMode.isUniversal) {
			ee`<div class="ve-muted ve-small ve-mb-2" role="status">This item can be used as a spellcasting focus by any spellcaster.</div>`.appendTo(wrp);
			return;
		}
		BuilderUi.getStateIptStringArray("Spellcasting Focus Classes", cb, this._draft.item, {shortName: "Class", nullable: false}, "focus").appendTo(wrp);
	}

	_renderDescriptionTab ({wrp, cb}) {
		BuilderUi.getStateIptEntries("Description", cb, this._draft.item, {fnPostProcess: BuilderUi.fnPostProcessDice}, "entries").appendTo(wrp);
		BuilderUi.getStateIptEntries("Additional Entries", cb, this._draft.item, {nullable: true, fnPostProcess: BuilderUi.fnPostProcessDice}, "additionalEntries").appendTo(wrp);
		this.getFluffInput(cb).appendTo(wrp);
	}

	_renderAdvancedTab ({wrp}) {
		const msg = ee`<div class="ve-small ve-mt-2" role="status"></div>`;
		const textarea = ee`<textarea class="ve-form-control mkbru_item__advanced" aria-label="Canonical item JSON" spellcheck="false">${JSON.stringify(this._draft.item, null, "\t").qq()}</textarea>`
			.onn("change", () => {
				try {
					const parsed = JSON.parse(textarea.val());
					this._draft = ItemBuilderCore.normalizeDraft({...this._draft, item: parsed});
					msg.attr("class", "ve-small ve-mt-2 text-success").txt("Advanced data applied.");
					this._doSync();
				} catch (e) {
					msg.attr("class", "ve-small ve-mt-2 text-danger").txt(`Invalid JSON: ${e.message}`);
				}
			});
		ee`<div class="mkbru_item__section">
			<div class="ve-bold">Canonical item data</div>
			<div class="ve-muted ve-small ve-mb-2">Use this for uncommon canonical fields not represented above. Invalid JSON is never applied.</div>
			${textarea}
			${msg}
		</div>`.appendTo(wrp);
	}

	_renderReviewTab ({wrp}) {
		wrp.empty();
		const item = ItemBuilderCore.projectForPreview(this._draft, this._catalogs);
		const type = _ITEM_TYPE_LABELS[String(this._draft.item.type || "").split("|")[0]] || "Unknown item type";
		const composition = [
			this._draft.material?.name ? `Material: ${this._draft.material.name} (${this._draft.material.source})` : null,
			this._draft.upgrades.length ? `Upgrades: ${this._draft.upgrades.map(it => `${it.name} (${it.source})`).join(", ")}` : null,
			this._draft.gemstone?.name ? `Gemstone: ${this._draft.gemstone.name} (${this._draft.gemstone.source})` : null,
		].filter(Boolean);
		const validation = ItemBuilderCore.validate(this._draft, this._catalogs);
		const btnSave = ee`<button class="ve-btn ve-btn-success mkbru_item__review-save" ${validation.isValid ? "" : "disabled"} aria-disabled="${!validation.isValid}">
			<span class="glyphicon glyphicon-floppy-disk"></span> Save item
		</button>`.onn("click", () => this.pDoHandleClickSaveBrew());
		ee`<header class="mkbru_item__stage-intro">
			<div>
				<h2>Confirm the finished item</h2>
				<p>Review the resolved mechanics and publication details before saving.</p>
			</div>
			<span>Review &amp; Save</span>
		</header>`.appendTo(wrp);
		ee`<section class="mkbru_item__review">
			<div class="mkbru_item__review-summary">
				<h3>Review your item</h3>
				<div class="mkbru_item__review-identity">
					<strong>${(this._draft.item.name || "Unnamed item").qq()}</strong>
					<span>${type.qq()}</span>
				</div>
				<dl class="mkbru_item__review-facts">
					<div><dt>Saved under</dt><dd>${(Parser.sourceJsonToFull(this._draft.item.source) || "No source").qq()}</dd></div>
					<div><dt>Composition</dt><dd>${(composition.length ? composition.join(" \u00b7 ") : "No composition options selected.").qq()}</dd></div>
				</dl>
				<p class="ve-muted ve-small">The saved JSON keeps composition references lean; this preview resolves their mechanics.</p>
				${btnSave}
			</div>
			<div class="mkbru_item__review-preview">
				<div class="mkbru_item__review-preview-label">Resolved preview</div>
				<table class="ve-w-100 ve-stats" aria-label="Item preview">${Renderer.item.getCompactRenderedString(item)}</table>
			</div>
		</section>`.appendTo(wrp);
	}

	_refreshValidation () {
		if (!this._draft) return;
		const {errors, warnings} = ItemBuilderCore.validate(this._draft, this._catalogs);
		this._btnHeaderSave?.prop("disabled", !!errors.length)
			.attr("aria-disabled", `${!!errors.length}`)
			.attr("title", errors.length ? `Cannot save: ${errors[0].message}` : "Save item to homebrew");
		if (!this._wrpValidation) return;
		this._wrpValidation.empty();
		const messages = [...errors, ...warnings];
		const status = this._saveStatus || (errors.length
			? `Cannot save yet. ${errors[0].message}`
			: warnings.length
				? "Ready to save with warnings."
				: "Ready to save.");
		ee`<div class="mkbru_item__validation ${errors.length ? "mkbru_item__validation--error" : warnings.length ? "mkbru_item__validation--warning" : "mkbru_item__validation--ready"}" role="status" aria-live="polite">
			<strong>${status.qq()}</strong>
			${messages.map(it => `<div>${it.message.qq()}</div>`)}
		</div>`.appendTo(this._wrpValidation);
	}

	async pDoHandleClickSaveBrew () {
		this._cbCache?.cancel?.();
		this._doSync();
		const validation = ItemBuilderCore.validate(this._draft, this._catalogs);
		if (!validation.isValid) {
			this._saveStatus = `Cannot save: ${validation.errors[0].message}`;
			this._refreshValidation();
			return;
		}
		if (!await super.pDoHandleClickSaveBrew()) return;
		this._saveStatus = `Saved "${this._draft.item.name}" to homebrew.`;
		this._refreshValidation();
	}

	renderOutput () {
		this._renderOutputDebounced();
	}

	_renderOutput () {
		const wrp = this._ui.wrpOutput.empty();
		this._resetTabs({tabGroup: "output"});
		const tabs = this._renderTabs([
			new TabUiUtil.TabMeta({name: "Item"}),
			new TabUiUtil.TabMeta({name: "Data"}),
			new TabUiUtil.TabMeta({name: "Markdown"}),
		], {tabGroup: "output", cbTabChange: this.doUiSave.bind(this)});
		const [itemTab, dataTab, markdownTab] = tabs;
		ee`<div class="ve-flex-v-center ve-w-100 ve-no-shrink">${tabs.map(it => it.btnTab)}</div>`.appendTo(wrp);
		tabs.forEach(it => it.wrpTab.appendTo(wrp));

		const item = MiscUtil.copy(this.__state);
		const previewItem = ItemBuilderCore.projectForPreview(this._draft, this._catalogs);
		ee`<table class="ve-w-100 ve-stats">${Renderer.item.getCompactRenderedString(previewItem)}</table>`.appendTo(itemTab.wrpTab);

		const clean = DataUtil.cleanJson(MiscUtil.copy(item));
		const dataHtml = Renderer.get().render({type: "entries", entries: [{type: "code", name: "Data", preformatted: JSON.stringify(clean, null, "\t")}]});
		ee`<table class="ve-w-100 ve-stats ve-stats--book mkbru__wrp-output-tab-data">${Renderer.utils.getBorderTr()}<tr><td colspan="6">${dataHtml}</td></tr>${Renderer.utils.getBorderTr()}</table>`.appendTo(dataTab.wrpTab);
		ee`<table class="ve-w-100 ve-stats ve-stats--book mkbru__wrp-output-tab-data">${Renderer.utils.getBorderTr()}<tr><td colspan="6">${this._getRenderedMarkdownCode()}</td></tr>${Renderer.utils.getBorderTr()}</table>`.appendTo(markdownTab.wrpTab);
	}
}
