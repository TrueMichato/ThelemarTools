import {DmScreenPanelAppBase} from "../dmscreen-panelapp-base.js";
import {ItemCompositionCatalogPicker} from "../../itembuilder/itembuilder-catalog-picker.js";
import {ItemBuilderCore} from "../../itembuilder/itembuilder-core.js";
import {ItemBuilderHandoff} from "../../itembuilder/itembuilder-handoff.js";

const _ITEM_TYPE_LABELS = {
	A: "Ammunition",
	AT: "Artisan's Tools",
	G: "Adventuring Gear",
	HA: "Heavy Armor",
	LA: "Light Armor",
	M: "Melee Weapon",
	MA: "Medium Armor",
	P: "Potion",
	R: "Ranged Weapon",
	RD: "Rod",
	RG: "Ring",
	S: "Shield",
	SC: "Scroll",
	SCF: "Spellcasting Focus",
	ST: "Staff",
	T: "Tool",
	WD: "Wand",
	W: "Wondrous Item",
};

function _getTypeLabel (type) {
	const abbreviation = String(type || "").split("|")[0];
	return _ITEM_TYPE_LABELS[abbreviation] || abbreviation || "Unknown type";
}

function _getSourceLabel (source) {
	return source ? Parser.sourceJsonToFull(source) || source : "Unknown source";
}

function _getJsonErrorMessage (error, value) {
	const message = error?.message || "Invalid JSON.";
	const position = Number(message.match(/position\s+(\d+)/i)?.[1]);
	if (!Number.isFinite(position)) return `Invalid JSON: ${message}`;
	const before = value.slice(0, position);
	const line = before.split("\n").length;
	const column = position - before.lastIndexOf("\n");
	return `Invalid JSON at line ${line}, column ${column}: ${message}`;
}

export class ItemBuilderPanel extends DmScreenPanelAppBase {
	constructor ({
		board,
		savedState,
		compositionPickerClass = ItemCompositionCatalogPicker,
		fnNavigateToMakebrew = () => window.location.assign("makebrew.html#itembuilder"),
	}) {
		super({board, savedState});
		this._draft = ItemBuilderCore.normalizeDraft(savedState?.draft || savedState);
		this._CompositionPicker = compositionPickerClass;
		this._fnNavigateToMakebrew = fnNavigateToMakebrew;
		this._catalogs = {items: [], materials: [], upgrades: []};
		this._root = null;
		this._isLoading = true;
		this._loadError = null;
		this._saveStatus = "";
		this._focusedEditorRoot = null;
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
		this._isLoading = true;
		this._loadError = null;
		this._render();
		try {
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
			this._saveStatus = "Catalogs loaded. Item draft ready.";
		} catch (error) {
			this._isLoading = false;
			this._loadError = error;
		}
		this._render();
	}

	_doUpdate ({isRender = true, status = ""} = {}) {
		this._draft = ItemBuilderCore.normalizeDraft(this._draft);
		this._saveStatus = status;
		this._board.doSaveStateDebounced();
		if (isRender) this._render();
	}

	_render () {
		if (!this._root) return;
		this._root.empty();
		if (this._isLoading) {
			ee`<div class="dm-item-builder__loading" role="status" aria-live="polite">
				<span class="dm-item-builder__loading-bar"></span>
				<span class="dm-item-builder__loading-bar dm-item-builder__loading-bar--short"></span>
				<strong>Loading item catalogs...</strong>
				<span>Your saved draft is safe while compatible materials and upgrades load.</span>
			</div>`.appendTo(this._root);
			return;
		}
		if (this._loadError) {
			const btnRetry = ee`<button class="ve-btn ve-btn-primary">Retry loading catalogs</button>`
				.onn("click", () => this._pInit());
			ee`<div class="dm-item-builder__load-error" role="alert">
				<strong>Item catalogs could not be loaded</strong>
				<span>${(this._loadError.message || "Check your connection and try again.").qq()}</span>
				${btnRetry}
			</div>`.appendTo(this._root);
			return;
		}

		const item = ItemBuilderCore.projectForPreview(this._draft, this._catalogs);
		const validation = ItemBuilderCore.validate(this._draft, this._catalogs);
		this._renderEmbedded({item, validation});
		this._renderFocusedEditor();
	}

	_renderEmbedded ({item, validation}) {
		const nameInput = ee`<input class="ve-form-control" aria-label="Item name" value="${this._draft.item.name.qq()}">`
			.onn("change", () => {
				this._draft.item.name = nameInput.val().trim();
				this._doUpdate();
			});
		const sourceSelect = ee`<select class="ve-form-control" aria-label="Saved under homebrew source">
			<option value="">Choose source</option>
			${BrewUtil2.getSources().map(source => `<option value="${source.json.qq()}">${source.full.qq()}</option>`)}
		</select>`.val(this._draft.item.source)
			.onn("change", () => {
				this._draft.item.source = sourceSelect.val();
				this._doUpdate();
			});
		const btnOpen = ee`<button class="ve-btn ve-btn-primary dm-item-builder__open-editor">Open focused editor</button>`
			.onn("click", () => this._pOpenFocusedEditor({trigger: btnOpen}));
		const btnHandoff = this._getBtnContinueInMakebrew();

		ee`<section class="dm-item-builder__summary" aria-label="Quick Forge item draft">
			<div class="dm-item-builder__summary-heading">
				<strong>${(item.name || "Unnamed item").qq()}</strong>
				<span>${_getTypeLabel(item.type).qq()} \u00b7 ${(item.source || "No source").qq()}</span>
			</div>
			<div class="dm-item-builder__identity">
				<label><span>Item name</span>${nameInput}</label>
				<label><span>Saved under</span>${sourceSelect}</label>
			</div>
			<div class="dm-item-builder__summary-composition">
				<strong>Composition</strong>
				<span>${this._getCompositionSummaryText().qq()}</span>
				<span>${(this._draft.preset ? `Base: ${this._draft.preset.name} (${this._draft.preset.source})` : "No catalog base selected").qq()}</span>
			</div>
			${this._getValidationElement(validation, {isCompact: true})}
			<div class="dm-item-builder__summary-actions">${btnOpen}${btnHandoff}</div>
		</section>`.appendTo(this._root);
	}

	_renderFocusedEditor () {
		if (!this._focusedEditorRoot?.isConnected) return;
		this._focusedEditorRoot.empty();
		this._renderEditor({
			wrp: this._focusedEditorRoot,
			item: ItemBuilderCore.projectForPreview(this._draft, this._catalogs),
			validation: ItemBuilderCore.validate(this._draft, this._catalogs),
			isFocused: true,
			doClose: this._focusedEditorDoClose,
		});
	}

	_renderEditor ({wrp, item, validation, isFocused = false, doClose = null}) {
		if (!isFocused) throw new Error("The full Item Builder editor may only be rendered in focused mode.");
		const nameInput = ee`<input class="ve-form-control" aria-label="Item name" value="${this._draft.item.name.qq()}">`
			.onn("change", () => {
				this._draft.item.name = nameInput.val().trim();
				this._doUpdate();
			});
		const sourceSelect = ee`<select class="ve-form-control" aria-label="Saved under homebrew source">
			<option value="">Choose source</option>
			${BrewUtil2.getSources().map(source => `<option value="${source.json.qq()}">${source.full.qq()}</option>`)}
		</select>`.val(this._draft.item.source)
			.onn("change", () => {
				this._draft.item.source = sourceSelect.val();
				this._doUpdate();
			});
		const btnPreset = ee`<button class="ve-btn ve-btn-primary">Choose catalog preset</button>`
			.onn("click", () => this._pChoosePreset());
		const btnAdvanced = ee`<button class="ve-btn ve-btn-default dm-item-builder__advanced-action"><span class="glyphicon glyphicon-cog"></span> Edit advanced fields</button>`
			.onn("click", () => this._pOpenAdvanced({trigger: btnAdvanced}));
		const btnReset = ee`<button class="ve-btn ve-btn-danger"><span class="glyphicon glyphicon-trash"></span> Reset draft</button>`
			.onn("click", () => this._pResetDraft());
		const btnSave = ee`<button class="ve-btn ve-btn-success" ${validation.isValid ? "" : "disabled"} aria-disabled="${!validation.isValid}"><span class="glyphicon glyphicon-floppy-disk"></span> Save item to Homebrew</button>`
			.onn("click", () => this._pSaveToBrew());
		const btnHandoff = this._getBtnContinueInMakebrew();
		const btnClose = isFocused
			? ee`<button class="ve-btn ve-btn-default">Close editor</button>`.onn("click", () => doClose(false))
			: null;
		const wrpPicker = ee`<div></div>`;

		new this._CompositionPicker({
			draft: this._draft,
			catalogs: this._catalogs,
			onSelect: meta => this._handleCompositionSelect(meta),
		}).render({wrp: wrpPicker});
		const wrpStages = ee`<nav class="dm-item-builder__stages" aria-label="Item Forge stages"></nav>`;
		[
			["Base", "base"],
			["Composition", "composition"],
			["Details", "details"],
			["Review & Save", "review"],
		].forEach(([label, id], ix) => {
			ee`<button class="dm-item-builder__stage-link"><span>${ix + 1}</span>${label}</button>`
				.onn("click", () => wrp.querySelector(`#dm-item-builder-${id}`)?.scrollIntoView({behavior: "smooth", block: "start"}))
				.appendTo(wrpStages);
		});

		ee`<div class="dm-item-builder__content ${isFocused ? "dm-item-builder__content--focused" : ""}">
			<div class="dm-item-builder__header">
				<div>
					<div class="dm-item-builder__title">Item workbench</div>
					<div class="dm-item-builder__subtitle">Build from a trusted base, compose its properties, then review the real item.</div>
				</div>
				<div class="dm-item-builder__actions">${btnAdvanced}${btnReset}</div>
			</div>
			${wrpStages}
			<section class="dm-item-builder__stage" id="dm-item-builder-base">
				<header><span>1</span><div><strong>Choose a base</strong><small>Start with trusted core or installed homebrew item data.</small></div></header>
				<div class="dm-item-builder__step">
					<div><span class="dm-item-builder__step-name">Current base</span><span class="dm-item-builder__muted">${(this._draft.preset ? `${this._draft.preset.name} \u00b7 Published in ${_getSourceLabel(this._draft.preset.source)}` : "No catalog base selected").qq()}</span></div>
					${btnPreset}
				</div>
			</section>
			<section class="dm-item-builder__stage" id="dm-item-builder-composition">
				<header><span>2</span><div><strong>Compose the item</strong><small>Compare compatible materials, upgrades, and gemstones by source and effect.</small></div></header>
				${this._getSelectedCompositionElement()}
				${wrpPicker}
			</section>
			<section class="dm-item-builder__stage" id="dm-item-builder-details">
				<header><span>3</span><div><strong>Name and publish</strong><small>Set the item identity. Component sources remain attached to their references.</small></div></header>
				<div class="dm-item-builder__identity">
					<label><span>Item name</span>${nameInput}</label>
					<label><span>Saved under</span>${sourceSelect}</label>
				</div>
			</section>
			<section class="dm-item-builder__stage dm-item-builder__stage--review" id="dm-item-builder-review">
				<header><span>4</span><div><strong>Review and save</strong><small>Confirm the resolved result before writing reference-only item data.</small></div></header>
				${this._getValidationElement(validation)}
				<div class="dm-item-builder__preview"><table class="ve-w-100 ve-stats" aria-label="Item preview">${Renderer.item.getCompactRenderedString(item)}</table></div>
				<div class="dm-item-builder__footer">${btnClose}${btnHandoff}${btnSave}</div>
			</section>
		</div>`.appendTo(wrp);
	}

	_getBtnContinueInMakebrew () {
		const btn = ee`<button class="ve-btn ve-btn-default dm-item-builder__handoff"><span class="glyphicon glyphicon-new-window"></span> Continue in Makebrew</button>`;
		btn.onn("click", () => this._pContinueInMakebrew());
		return btn;
	}

	async _pContinueInMakebrew () {
		try {
			await ItemBuilderHandoff.pStore({draft: this._draft});
			this._fnNavigateToMakebrew();
		} catch (error) {
			this._saveStatus = `Could not continue in Makebrew: ${error.message}`;
			this._render();
		}
	}

	async _pChoosePreset () {
		try {
			const result = await SearchWidget.pGetUserItemSearch();
			if (!result) return;
			const preset = MiscUtil.copy(await DataLoader.pCacheAndGet(result.page, result.source, result.hash));
			this._draft = ItemBuilderCore.applyPreset(this._draft, preset, {source: this._draft.item.source});
			this._doUpdate({status: `Loaded ${preset.name} as the base item.`});
		} catch (error) {
			this._saveStatus = `Could not load that preset: ${error.message}`;
			this._render();
		}
	}

	_handleCompositionSelect ({category, entity, isSelected}) {
		const ref = {name: entity.name, source: entity.source};
		const uid = ItemBuilderCore.packUid(ref);
		if (category === "material") this._draft.material = isSelected ? null : ref;
		if (category === "gemstone") this._draft.gemstone = isSelected ? null : ref;
		if (category === "upgrade") {
			this._draft.upgrades = isSelected
				? this._draft.upgrades.filter(it => ItemBuilderCore.packUid(it) !== uid)
				: [...this._draft.upgrades, ref];
		}
		this._doUpdate({status: `${isSelected ? "Removed" : "Selected"} ${entity.name}.`});
	}

	_getCompositionSummaryText () {
		const selected = [
			this._draft.material?.name,
			...this._draft.upgrades.map(it => it.name),
			this._draft.gemstone?.name,
		].filter(Boolean);
		return selected.length ? selected.join(", ") : "No composition selected";
	}

	_getSelectedCompositionElement () {
		const selected = [
			this._draft.material ? {category: "material", entity: this._draft.material} : null,
			...this._draft.upgrades.map(entity => ({category: "upgrade", entity})),
			this._draft.gemstone ? {category: "gemstone", entity: this._draft.gemstone} : null,
		].filter(Boolean);
		const wrp = ee`<div class="dm-item-builder__selected">
			<div><strong>Current composition</strong><span class="dm-item-builder__muted">${selected.length ? "Remove a choice or compare alternatives below." : "No material, upgrade, or gemstone selected yet."}</span></div>
		</div>`;
		for (const meta of selected) {
			ee`<button class="dm-item-builder__remove" aria-label="Remove ${meta.entity.name.qq()}">Remove ${meta.entity.name.qq()}</button>`
				.onn("click", () => this._handleCompositionSelect({...meta, isSelected: true}))
				.appendTo(wrp);
		}
		return wrp;
	}

	_getValidationElement ({errors, warnings}, {isCompact = false} = {}) {
		const messages = [...errors, ...warnings];
		const stateClass = errors.length
			? "dm-item-builder__status--error"
			: warnings.length
				? "dm-item-builder__status--warning"
				: "dm-item-builder__status--ready";
		const heading = this._saveStatus || (errors.length ? "Cannot save yet." : warnings.length ? "Ready with warnings." : "Ready to save.");
		const wrp = ee`<div class="dm-item-builder__status ${stateClass} ${isCompact ? "dm-item-builder__status--compact" : ""}" role="status" aria-live="polite"></div>`;
		const eleHeading = ee`<strong></strong>`;
		eleHeading.textContent = heading;
		wrp.append(eleHeading);
		(isCompact ? messages.slice(0, 1) : messages).forEach(it => {
			const eleMessage = ee`<span></span>`;
			eleMessage.textContent = it.message;
			wrp.append(eleMessage);
		});
		return wrp;
	}

	async _pOpenFocusedEditor ({trigger}) {
		const {eleModalInner, doClose} = UiUtil.getShowModal({
			title: "Item Workbench",
			isHeight100: true,
			isWidth100: true,
			cbClose: () => {
				this._focusedEditorRoot = null;
				this._focusedEditorDoClose = null;
				this._restoreFocus({trigger, selector: ".dm-item-builder__open-editor"});
			},
		});
		this._focusedEditorRoot = ee`<div class="dm-item-builder dm-item-builder--modal"></div>`.appendTo(eleModalInner);
		this._focusedEditorDoClose = doClose;
		this._renderFocusedEditor();
	}

	async _pResetDraft () {
		if (!await InputUiUtil.pGetUserBoolean({title: "Reset Item Builder", htmlDescription: "Discard this item draft and all composition choices?", textYes: "Reset draft", textNo: "Cancel"})) return;
		this._draft = ItemBuilderCore.createDraft({source: this._draft.item.source});
		this._doUpdate({status: "Draft reset."});
	}

	async _pOpenAdvanced ({trigger}) {
		const original = JSON.stringify(this._draft.item, null, "\t");
		const {eleModalInner, eleModalFooter, doClose} = UiUtil.getShowModal({
			title: "Item Builder - Advanced Fields",
			isHeight100: true,
			isWidth100: true,
			isPermanent: true,
			hasFooter: true,
			cbClose: () => this._restoreFocus({trigger, selector: ".dm-item-builder__advanced-action"}),
		});
		const message = ee`<div class="dm-item-builder__advanced-message" role="status" aria-live="polite"></div>`;
		const textarea = ee`<textarea class="ve-form-control dm-item-builder__advanced" aria-label="Canonical item JSON" spellcheck="false">${original.qq()}</textarea>`;
		const btnCancel = ee`<button class="ve-btn ve-btn-default">Cancel</button>`
			.onn("click", async () => {
				if (!await this._pConfirmAdvancedDiscard({original, current: textarea.val()})) return;
				doClose(false);
			});
		const btnApply = ee`<button class="ve-btn ve-btn-primary">Apply advanced fields</button>`
			.onn("click", () => {
				try {
					this._applyAdvancedJson(textarea.val());
					doClose(true);
				} catch (error) {
					message.attr("class", "dm-item-builder__advanced-message dm-item-builder__advanced-message--error")
						.txt(_getJsonErrorMessage(error, textarea.val()));
				}
			});
		ee`<div class="ve-flex-col ve-h-100">
			<p class="dm-item-builder__muted">Edit uncommon canonical fields. Composition choices stay separate and are projected when the item is saved.</p>
			${textarea}
			${message}
		</div>`.appendTo(eleModalInner);
		ee`<div class="ve-flex-v-center ve-flex-h-right ve-w-100">${btnCancel}${btnApply}</div>`.appendTo(eleModalFooter);
		textarea.focuse();
	}

	async _pConfirmAdvancedDiscard ({original, current}) {
		if (current === original) return true;
		return InputUiUtil.pGetUserBoolean({
			title: "Discard Advanced Changes",
			htmlDescription: "Your advanced JSON changes have not been applied. Discard them?",
			textYes: "Discard changes",
			textNo: "Keep editing",
		});
	}

	_applyAdvancedJson (value) {
		const parsed = JSON.parse(value);
		this._draft = ItemBuilderCore.normalizeDraft({...this._draft, item: parsed});
		this._doUpdate({status: "Advanced fields applied successfully."});
	}

	_restoreFocus ({trigger, selector}) {
		const target = trigger?.isConnected
			? trigger
			: this._focusedEditorRoot?.querySelector(selector) || this._root?.querySelector(selector);
		target?.focus();
	}

	async _pSaveToBrew () {
		const validation = ItemBuilderCore.validate(this._draft, this._catalogs);
		if (!validation.isValid) {
			this._saveStatus = `Cannot save: ${validation.errors[0].message}`;
			this._render();
			return;
		}
		try {
			const item = ItemBuilderCore.serialize(this._draft, this._catalogs);
			item.uniqueId = this._draft.item.uniqueId || CryptUtil.uid();
			await BrewUtil2.pPersistEditableBrewEntity("item", DataUtil.cleanJson(item, {isDeleteUniqueId: false}));
			this._draft.item.uniqueId = item.uniqueId;
			this._doUpdate({status: `Saved "${item.name}" to homebrew.`});
			JqueryUtil.doToast({type: "success", content: `Saved "${item.name}" to homebrew.`});
		} catch (error) {
			this._saveStatus = `Save failed: ${error.message}`;
			this._render();
		}
	}
}
