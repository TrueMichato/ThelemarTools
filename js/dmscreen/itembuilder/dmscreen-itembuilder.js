import {DmScreenPanelAppBase} from "../dmscreen-panelapp-base.js";
import {ItemBuilderCore} from "../../itembuilder/itembuilder-core.js";

export class ItemBuilderPanel extends DmScreenPanelAppBase {
	constructor ({board, savedState}) {
		super({board, savedState});
		this._draft = ItemBuilderCore.normalizeDraft(savedState?.draft || savedState);
		this._catalogs = {items: [], materials: [], upgrades: []};
		this._root = null;
		this._isLoading = true;
	}

	getState () {
		return {
			version: ItemBuilderCore.VERSION,
			draft: MiscUtil.copy(this._draft),
		};
	}

	_getPanelElement () {
		this._root = ee`<div class="dm-item-builder"></div>`;
		this._render();
		this._pInit().then(null);
		return this._root;
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
		this._isLoading = false;
		this._render();
	}

	_doUpdate ({isRender = true} = {}) {
		this._board.doSaveStateDebounced();
		if (isRender) this._render();
	}

	_render () {
		if (!this._root) return;
		this._root.empty();
		if (this._isLoading) {
			ee`<div class="dm-item-builder__loading"><span class="glyphicon glyphicon-refresh ve-spin"></span> Loading item catalogs...</div>`.appendTo(this._root);
			return;
		}

		const item = ItemBuilderCore.serialize(this._draft, this._catalogs);
		const validation = ItemBuilderCore.validate(this._draft, this._catalogs);
		const nameInput = ee`<input class="ve-form-control ve-input-sm" aria-label="Item name" value="${this._draft.item.name.qq()}">`
			.onn("change", () => {
				this._draft.item.name = nameInput.val().trim();
				this._doUpdate();
			});
		const sourceSelect = ee`<select class="ve-form-control ve-input-sm" aria-label="Homebrew source">
			<option value="">Choose source</option>
			${BrewUtil2.getSources().map(source => `<option value="${source.json.qq()}">${source.full.qq()}</option>`)}
		</select>`.val(this._draft.item.source)
			.onn("change", () => {
				this._draft.item.source = sourceSelect.val();
				this._doUpdate();
			});

		const btnPreset = ee`<button class="ve-btn ve-btn-primary ve-btn-sm">Choose preset</button>`
			.onn("click", async () => {
				const result = await SearchWidget.pGetUserItemSearch();
				if (!result) return;
				const preset = MiscUtil.copy(await DataLoader.pCacheAndGet(result.page, result.source, result.hash));
				this._draft = ItemBuilderCore.applyPreset(this._draft, preset, {source: this._draft.item.source});
				this._doUpdate();
			});

		const materialSelect = this._getMaterialSelect();
		const upgradeSelect = this._getUpgradeSelect();
		const gemstoneSelect = this._getGemstoneSelect();
		const btnAdvanced = ee`<button class="ve-btn ve-btn-default ve-btn-sm"><span class="glyphicon glyphicon-cog"></span> Advanced fields</button>`
			.onn("click", () => this._pOpenAdvanced());
		const btnSave = ee`<button class="ve-btn ve-btn-success ve-btn-sm" ${validation.isValid ? "" : "disabled"}><span class="glyphicon glyphicon-floppy-disk"></span> Save to Homebrew</button>`
			.onn("click", () => this._pSaveToBrew());
		const btnReset = ee`<button class="ve-btn ve-btn-danger ve-btn-sm" title="Reset item"><span class="glyphicon glyphicon-trash"></span></button>`
			.onn("click", async () => {
				if (!await InputUiUtil.pGetUserBoolean({title: "Reset Item Builder", htmlDescription: "Discard this item draft?", textYes: "Reset", textNo: "Cancel"})) return;
				this._draft = ItemBuilderCore.createDraft({source: this._draft.item.source});
				this._doUpdate();
			});

		ee`<div class="dm-item-builder__content">
		<div class="dm-item-builder__header">
			<div class="dm-item-builder__title">Item workbench</div>
			<div class="dm-item-builder__actions">${btnAdvanced}${btnReset}</div>
		</div>
		<div class="dm-item-builder__identity">${nameInput}${sourceSelect}</div>
		<div class="dm-item-builder__step">
			<div><span class="dm-item-builder__step-name">Preset</span><span class="ve-muted ve-small">${this._draft.preset ? `${this._draft.preset.name} (${this._draft.preset.source})` : "Start from any catalog item"}</span></div>
			${btnPreset}
		</div>
		<div class="dm-item-builder__step">
			<div><span class="dm-item-builder__step-name">Material</span><span class="ve-muted ve-small">Projects physical properties</span></div>
			${materialSelect}
		</div>
		<div class="dm-item-builder__step dm-item-builder__step--stack">
			<div><span class="dm-item-builder__step-name">Upgrades</span><span class="ve-muted ve-small">Weapon and armor improvements</span></div>
			${this._getUpgradeChips()}
			${upgradeSelect}
		</div>
		<div class="dm-item-builder__step">
			<div><span class="dm-item-builder__step-name">Gem empowerment</span><span class="ve-muted ve-small">One compatible gemstone power</span></div>
			${gemstoneSelect}
		</div>
		${this._getValidationElement(validation)}
		<div class="dm-item-builder__preview"><table class="ve-w-100 ve-stats">${Renderer.item.getCompactRenderedString(item)}</table></div>
		<div class="dm-item-builder__footer">${btnSave}</div>
		</div>`.appendTo(this._root);
	}

	_getMaterialSelect () {
		const eligible = ItemBuilderCore.getEligibleMaterials({draft: this._draft, materials: this._catalogs.materials})
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
		const select = ee`<select class="ve-form-control ve-input-sm" aria-label="Material">
			<option value="">No special material</option>
			${eligible.map(it => `<option value="${ItemBuilderCore.packUid(it).qq()}">${it.name.qq()}</option>`)}
		</select>`.val(ItemBuilderCore.packUid(this._draft.material) || "")
			.onn("change", () => {
				this._draft.material = ItemBuilderCore.unpackUid(select.val());
				this._doUpdate();
			});
		return select;
	}

	_getUpgradeSelect () {
		const eligible = ItemBuilderCore.getEligibleUpgrades({draft: this._draft, upgrades: this._catalogs.upgrades})
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
		const select = ee`<select class="ve-form-control ve-input-sm" aria-label="Add upgrade">
			<option value="">Add an upgrade...</option>
			${eligible.map(it => `<option value="${ItemBuilderCore.packUid(it).qq()}">${it.name.qq()}</option>`)}
		</select>`
			.onn("change", () => {
				const ref = ItemBuilderCore.unpackUid(select.val());
				if (!ref) return;
				this._draft.upgrades.push(ref);
				this._doUpdate();
			});
		return select;
	}

	_getUpgradeChips () {
		const wrp = ee`<div class="dm-item-builder__chips"></div>`;
		for (const upgrade of this._draft.upgrades) {
			ee`<button class="dm-item-builder__chip" title="Remove ${upgrade.name.qq()}">${upgrade.name}<span aria-hidden="true">&times;</span></button>`
				.onn("click", () => {
					const uid = ItemBuilderCore.packUid(upgrade);
					this._draft.upgrades = this._draft.upgrades.filter(it => ItemBuilderCore.packUid(it) !== uid);
					this._doUpdate();
				})
				.appendTo(wrp);
		}
		return wrp;
	}

	_getGemstoneSelect () {
		const gemstones = ItemBuilderCore.getEligibleGemstones({draft: this._draft, upgrades: this._catalogs.upgrades})
			.sort((a, b) => SortUtil.ascSortLower(a.name, b.name));
		const select = ee`<select class="ve-form-control ve-input-sm" aria-label="Gem empowerment">
			<option value="">No gemstone empowerment</option>
			${gemstones.map(it => `<option value="${ItemBuilderCore.packUid(it).qq()}">${it.name.qq()}</option>`)}
		</select>`.val(ItemBuilderCore.packUid(this._draft.gemstone) || "")
			.onn("change", () => {
				this._draft.gemstone = ItemBuilderCore.unpackUid(select.val());
				this._doUpdate();
			});
		return select;
	}

	_getValidationElement ({errors, warnings}) {
		if (!errors.length && !warnings.length) return ee`<div class="dm-item-builder__status dm-item-builder__status--ready"><span class="glyphicon glyphicon-ok"></span> Ready to save</div>`;
		return ee`<div class="dm-item-builder__status ${errors.length ? "dm-item-builder__status--error" : "dm-item-builder__status--warning"}" role="status">
			${[...errors, ...warnings].map(it => `<div>${it.message.qq()}</div>`)}
		</div>`;
	}

	async _pOpenAdvanced () {
		const {eleModalInner, doClose} = UiUtil.getShowModal({
			title: "Item Builder - Advanced Fields",
			isHeight100: true,
			isWidth100: true,
		});
		const message = ee`<div class="ve-small ve-mt-2" role="status"></div>`;
		const textarea = ee`<textarea class="ve-form-control dm-item-builder__advanced" spellcheck="false">${JSON.stringify(this._draft.item, null, "\t")}</textarea>`;
		const btnApply = ee`<button class="ve-btn ve-btn-primary">Apply fields</button>`
			.onn("click", () => {
				try {
					this._draft.item = JSON.parse(textarea.val());
					this._doUpdate();
					doClose();
				} catch (e) {
					message.attr("class", "ve-small ve-mt-2 text-danger").txt(`Invalid JSON: ${e.message}`);
				}
			});
		ee`<div class="ve-flex-col ve-h-100">
			<p class="ve-muted">Edit any canonical item field. Composition choices remain separate and are materialized when the item is saved.</p>
			${textarea}
			<div class="ve-flex-v-center ve-mt-2">${btnApply}${message}</div>
		</div>`.appendTo(eleModalInner);
	}

	async _pSaveToBrew () {
		const validation = ItemBuilderCore.validate(this._draft, this._catalogs);
		if (!validation.isValid) {
			JqueryUtil.doToast({type: "danger", content: validation.errors[0].message});
			return;
		}
		const item = ItemBuilderCore.serialize(this._draft, this._catalogs);
		item.uniqueId = this._draft.item.uniqueId || CryptUtil.uid();
		await BrewUtil2.pPersistEditableBrewEntity("item", DataUtil.cleanJson(item, {isDeleteUniqueId: false}));
		this._draft.item.uniqueId = item.uniqueId;
		this._doUpdate({isRender: false});
		JqueryUtil.doToast({type: "success", content: `Saved "${item.name}" to homebrew.`});
	}
}
