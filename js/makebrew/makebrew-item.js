import {ItemBuilderCore} from "../itembuilder/itembuilder-core.js";
import {BuilderBase} from "./makebrew-builder-base.js";
import {BuilderUi} from "./makebrew-builderui.js";

const _RARITIES = ["none", "common", "uncommon", "rare", "very rare", "legendary", "artifact", "unknown", "unknown (magic)"];
const _ITEM_TYPES = ["A", "AF", "AT", "EM", "EXP", "FD", "G", "GS", "HA", "INS", "LA", "M", "MA", "MNT", "OTH", "P", "R", "RD", "RG", "S", "SC", "SCF", "ST", "T", "TAH", "TG", "WD", "W"];

export class ItemBuilder extends BuilderBase {
	constructor () {
		super({
			prop: "item",
			pFnGetFluff: Renderer.item.pGetFluff.bind(Renderer.item),
		});
		this._catalogs = {items: [], materials: [], upgrades: []};
		this._draft = null;
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

	_getAsMarkdown (item) {
		return RendererMarkdown.item.getCompactRenderedString(item);
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
		this._renderInputMain();
	}

	_doSync ({isRenderInput = false} = {}) {
		const uniqueId = this.__state.uniqueId || CryptUtil.uid();
		const canonical = ItemBuilderCore.serialize(this._draft, this._catalogs);
		canonical.uniqueId = uniqueId;
		for (const key of Object.keys(this.__state)) delete this.__state[key];
		Object.assign(this.__state, canonical);
		this._meta.isModified = true;
		this._dispHeaderName?.txt(`Editing "${this.__state.name || "?"}"`);
		this.renderOutput();
		this.doUiSave();
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
			new TabUiUtil.TabMeta({...opts, name: "Preset"}),
			new TabUiUtil.TabMeta({...opts, name: "Construction"}),
			new TabUiUtil.TabMeta({...opts, name: "Enchantments"}),
			new TabUiUtil.TabMeta({...opts, name: "Mechanics"}),
			new TabUiUtil.TabMeta({...opts, name: "Description"}),
			new TabUiUtil.TabMeta({...opts, name: "Advanced"}),
		], {tabGroup: "input", cbTabChange: this.doUiSave.bind(this)});
		const [presetTab, constructionTab, enchantmentsTab, mechanicsTab, descriptionTab, advancedTab] = tabs;
		ee`<div class="ve-flex-v-center ve-w-100 ve-no-shrink ve-ui-tab__wrp-tab-heads--border mkbru_item__tabs">${tabs.map(it => it.btnTab)}</div>`.appendTo(wrp);
		tabs.forEach(it => it.wrpTab.appendTo(wrp));

		this._renderPresetTab({wrp: presetTab.wrpTab, cb});
		this._renderConstructionTab({wrp: constructionTab.wrpTab});
		this._renderEnchantmentsTab({wrp: enchantmentsTab.wrpTab});
		this._renderMechanicsTab({wrp: mechanicsTab.wrpTab, cb});
		this._renderDescriptionTab({wrp: descriptionTab.wrpTab, cb});
		this._renderAdvancedTab({wrp: advancedTab.wrpTab});
	}

	_renderPresetTab ({wrp, cb}) {
		const btnChoose = ee`<button class="ve-btn ve-btn-primary ve-btn-sm">Choose catalog preset</button>`
			.onn("click", () => this.pHandleClickLoadExisting());
		const presetName = this._draft.preset ? `${this._draft.preset.name} (${this._draft.preset.source})` : "No preset selected";
		ee`<div class="mkbru_item__preset">
			<div>
				<div class="ve-bold">Start from trusted item data</div>
				<div class="ve-muted ve-small">A preset supplies the base weapon, armor, or item fields. Your homebrew source and later edits remain yours.</div>
			</div>
			<div class="ve-flex-v-center ve-flex-wrap">
				<span class="mkbru_item__selection ve-mr-2">${presetName}</span>
				${btnChoose}
			</div>
		</div>`.appendTo(wrp);

		BuilderUi.getStateIptString("Name", cb, this._draft.item, {nullable: false}, "name").appendTo(wrp);
		this._selSource = BuilderUi.getStateIptEnum(
			"Source",
			cb,
			this._draft.item,
			{vals: this._sourcesCache, fnDisplay: Parser.sourceJsonToFull, nullable: false},
			"source",
		).appendTo(wrp);
		BuilderUi.getStateIptString("Page", cb, this._draft.item, {}, "page").appendTo(wrp);
		BuilderUi.getStateIptEnum("Type", cb, this._draft.item, {vals: _ITEM_TYPES, nullable: false}, "type").appendTo(wrp);
		BuilderUi.getStateIptEnum("Rarity", cb, this._draft.item, {vals: _RARITIES, nullable: false, fnDisplay: it => it.toTitleCase()}, "rarity").appendTo(wrp);
		BuilderUi.getStateIptString("Attunement", cb, this._draft.item, {nullable: true}, "reqAttune").appendTo(wrp);
	}

	_renderConstructionTab ({wrp}) {
		const eligible = ItemBuilderCore.getEligibleMaterials({draft: this._draft, materials: this._catalogs.materials});
		const materialOptions = eligible
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name))
			.map(it => `<option value="${ItemBuilderCore.packUid(it).qq()}">${it.name.qq()} (${it.source.qq()})</option>`);
		const select = ee`<select class="ve-form-control ve-input-sm">
			<option value="">No special material</option>
			${materialOptions}
		</select>`.val(ItemBuilderCore.packUid(this._draft.material) || "")
			.onn("change", () => {
				this._draft.material = ItemBuilderCore.unpackUid(select.val());
				this._doSync({isRenderInput: true});
			});
		ee`<div class="mkbru_item__section">
			<div class="ve-bold">Material</div>
			<div class="ve-muted ve-small ve-mb-2">Only materials compatible with the current item are shown. Their weight, value, damage, protection, and other axes are projected into the saved item.</div>
			${select}
		</div>`.appendTo(wrp);
		this._renderValidation({wrp});
	}

	_renderEnchantmentsTab ({wrp}) {
		const eligible = ItemBuilderCore.getEligibleUpgrades({draft: this._draft, upgrades: this._catalogs.upgrades});
		const selected = new Set(this._draft.upgrades.map(ItemBuilderCore.packUid));
		const wrpRows = ee`<div class="mkbru_item__choice-list"></div>`;
		for (const upgrade of eligible) {
			const uid = ItemBuilderCore.packUid(upgrade);
			const cb = ee`<input type="checkbox">`.prop("checked", selected.has(uid))
				.onn("change", () => {
					if (cb.prop("checked")) this._draft.upgrades.push({name: upgrade.name, source: upgrade.source});
					else this._draft.upgrades = this._draft.upgrades.filter(it => ItemBuilderCore.packUid(it) !== uid);
					this._doSync({isRenderInput: true});
				});
			ee`<label class="mkbru_item__choice">${cb}<span><span class="ve-bold">${upgrade.name}</span><span class="ve-muted ve-small">${upgrade.upgradeType?.join(", ") || "Upgrade"}</span></span></label>`.appendTo(wrpRows);
		}

		const gemstones = ItemBuilderCore.getEligibleGemstones({draft: this._draft, upgrades: this._catalogs.upgrades});
		const selGem = ee`<select class="ve-form-control ve-input-sm">
			<option value="">No gemstone empowerment</option>
			${gemstones.sort((a, b) => SortUtil.ascSortLower(a.name, b.name)).map(it => `<option value="${ItemBuilderCore.packUid(it).qq()}">${it.name.qq()} (${it.source.qq()})</option>`)}
		</select>`.val(ItemBuilderCore.packUid(this._draft.gemstone) || "")
			.onn("change", () => {
				this._draft.gemstone = ItemBuilderCore.unpackUid(selGem.val());
				this._doSync({isRenderInput: true});
			});

		ee`<div class="mkbru_item__section">
			<div class="ve-bold">Weapon and armor upgrades</div>
			<div class="ve-muted ve-small ve-mb-2">Selections are filtered by item kind and remain recorded for character-sheet editing.</div>
			${wrpRows}
			<hr class="ve-hr-2">
			<div class="ve-bold ve-mb-2">Gem empowerment</div>
			${selGem}
		</div>`.appendTo(wrp);
		this._renderValidation({wrp});
	}

	_renderMechanicsTab ({wrp, cb}) {
		for (const [label, prop] of [
			["Weight (lb.)", "weight"],
			["Value (cp)", "value"],
			["Armor Class", "ac"],
			["Dexterity Maximum", "dexterityMax"],
			["Strength Requirement", "strength"],
			["Damage", "dmg1"],
			["Versatile Damage", "dmg2"],
			["Damage Type", "dmgType"],
			["Range", "range"],
			["Charges", "charges"],
			["Recharge", "recharge"],
			["Recharge Amount", "rechargeAmount"],
			["Weapon Bonus", "bonusWeapon"],
			["Weapon Attack Bonus", "bonusWeaponAttack"],
			["Weapon Damage Bonus", "bonusWeaponDamage"],
			["AC Bonus", "bonusAc"],
			["Spell Attack Bonus", "bonusSpellAttack"],
			["Spell Save DC Bonus", "bonusSpellSaveDc"],
			["Saving Throw Bonus", "bonusSavingThrow"],
			["Ability Check Bonus", "bonusAbilityCheck"],
		]) BuilderUi.getStateIptString(label, cb, this._draft.item, {nullable: true}, prop).appendTo(wrp);
		BuilderUi.getStateIptStringArray("Properties", cb, this._draft.item, {shortName: "Property"}, "property").appendTo(wrp);
		BuilderUi.getStateIptStringArray("Attached Spells", cb, this._draft.item, {shortName: "Spell UID"}, "attachedSpells").appendTo(wrp);
		BuilderUi.getStateIptStringArray("Spellcasting Focus", cb, this._draft.item, {shortName: "Class"}, "focus").appendTo(wrp);
	}

	_renderDescriptionTab ({wrp, cb}) {
		BuilderUi.getStateIptEntries("Description", cb, this._draft.item, {fnPostProcess: BuilderUi.fnPostProcessDice}, "entries").appendTo(wrp);
		BuilderUi.getStateIptEntries("Additional Entries", cb, this._draft.item, {nullable: true, fnPostProcess: BuilderUi.fnPostProcessDice}, "additionalEntries").appendTo(wrp);
		this.getFluffInput(cb).appendTo(wrp);
	}

	_renderAdvancedTab ({wrp}) {
		const msg = ee`<div class="ve-small ve-mt-2" role="status"></div>`;
		const textarea = ee`<textarea class="ve-form-control mkbru_item__advanced" spellcheck="false">${JSON.stringify(this._draft.item, null, "\t")}</textarea>`
			.onn("change", () => {
				try {
					const parsed = JSON.parse(textarea.val());
					this._draft.item = parsed;
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

	_renderValidation ({wrp}) {
		const {errors, warnings} = ItemBuilderCore.validate(this._draft, this._catalogs);
		if (!errors.length && !warnings.length) return;
		ee`<div class="mkbru_item__validation ${errors.length ? "mkbru_item__validation--error" : ""}" role="status">
			${[...errors, ...warnings].map(it => `<div>${it.message.qq()}</div>`)}
		</div>`.appendTo(wrp);
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
		ee`<table class="ve-w-100 ve-stats">${Renderer.item.getCompactRenderedString(item)}</table>`.appendTo(itemTab.wrpTab);

		const clean = DataUtil.cleanJson(MiscUtil.copy(item));
		const dataHtml = Renderer.get().render({type: "entries", entries: [{type: "code", name: "Data", preformatted: JSON.stringify(clean, null, "\t")}]});
		ee`<table class="ve-w-100 ve-stats ve-stats--book mkbru__wrp-output-tab-data">${Renderer.utils.getBorderTr()}<tr><td colspan="6">${dataHtml}</td></tr>${Renderer.utils.getBorderTr()}</table>`.appendTo(dataTab.wrpTab);
		ee`<table class="ve-w-100 ve-stats ve-stats--book mkbru__wrp-output-tab-data">${Renderer.utils.getBorderTr()}<tr><td colspan="6">${this._getRenderedMarkdownCode()}</td></tr>${Renderer.utils.getBorderTr()}</table>`.appendTo(markdownTab.wrpTab);
	}
}
