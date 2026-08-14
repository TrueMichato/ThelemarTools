import {CraftingWorkbenchCore} from "../itembuilder/crafting-workbench-core.js";
import {RenderCrafting} from "../render-crafting.js";
import {BuilderBase} from "./makebrew-builder-base.js";

export class CraftingWorkbenchBuilderBase extends BuilderBase {
	constructor ({prop}) {
		if (!CraftingWorkbenchCore.VOCABULARY.props.includes(prop)) throw new TypeError(`Unsupported Crafting Workbench prop "${prop}".`);
		super({prop});
		this._draft = null;
		this._saveStatus = "";
		this._validation = null;
		this._wrpValidation = null;
		this._wrpReview = null;
		this._renderOutputDebounced = MiscUtil.debounce(() => this._renderOutput(), 50);
	}

	_getInitialState () {
		return {
			...super._getInitialState(),
			...CraftingWorkbenchCore.createDraft(this._prop, {source: this._ui?.source}),
		};
	}

	_getCoreOptions () {
		return {};
	}

	getSaveableState () {
		return {
			...super.getSaveableState(),
			d: this._draft,
			w: {
				saveStatus: this._saveStatus,
				validation: this._validation,
			},
		};
	}

	setStateFromLoaded (state) {
		if (!state?.s || !state?.m) return;
		this._doResetProxies();
		if (!state.s.uniqueId) state.s.uniqueId = CryptUtil.uid();
		this.__state = CraftingWorkbenchCore.normalize(this._prop, state.s);
		this.__meta = state.m;
		this._draft = CraftingWorkbenchCore.normalize(this._prop, state.d || state.s);
		this._saveStatus = state.w?.saveStatus || "";
		this._validation = state.w?.validation || CraftingWorkbenchCore.validate(this._prop, this._draft, this._getCoreOptions());
	}

	_setStateFromLoaded (state) {
		this.setStateFromLoaded(state);
	}

	doHandleSourcesAdd () {
		this._sourcesCache = MiscUtil.copy(this._ui.allSources);
	}

	async pDoHandleSourceUpdate () {
		const source = this._ui.source;
		this._sourcesCache = MiscUtil.copy(this._ui.allSources);
		if (this._draft) this._draft.source = source;
		this.__state.source = source;
		this.renderInput();
		this.renderOutput();
		this.doUiSave();
	}

	async pHandleLoadExistingData (entity, opts = {}) {
		this._draft = CraftingWorkbenchCore.normalize(this._prop, entity);
		this._draft.source = this._ui.source;
		this.__state = CraftingWorkbenchCore.serialize(this._prop, this._draft, this._getCoreOptions());
		this.__state.uniqueId = CryptUtil.uid();
		this.__meta = {
			...(opts.meta || {}),
			...this._getInitialMetaState({nameOriginal: this.__state.name, isModified: true}),
		};
		this.renderInput();
		this.renderOutput();
		this.doUiSave();
	}

	_renderInputImpl () {
		this._doCreateProxies();
		this._doBindHeaderElements();
		this._draft = this._draft || CraftingWorkbenchCore.normalize(this._prop, this.__state);
		this._renderInputMain();
	}

	_renderInputMain () {
		this._sourcesCache = MiscUtil.copy(this._ui.allSources);
		const wrp = this._ui.wrpInput.empty();

		this._resetTabs({tabGroup: "input"});
		const opts = {hasBorder: true, hasBackground: true};
		const definitions = this._getStageDefinitions();
		const cb = this._getCb();
		this._cbCache = cb;
		const tabs = this._renderTabs(
			definitions.map(definition => new TabUiUtil.TabMeta({...opts, name: definition.name})),
			{tabGroup: "input", cbTabChange: this.doUiSave.bind(this)},
		);
		const wrpTabHeads = ee`<div class="ve-flex-v-center ve-w-100 ve-no-shrink ve-ui-tab__wrp-tab-heads--border mkbru_cw__tabs" role="tablist" aria-label="${Parser.getPropDisplayName(this._prop)} authoring steps">${tabs.map(it => it.btnTab)}</div>`.appendTo(wrp);
		this._decorateTabsA11y({tabs, wrpTabHeads});
		this._wrpValidation = ee`<div class="mkbru_cw__validation-slot"></div>`.appendTo(wrp);
		this._refreshValidation();
		tabs.forEach(it => it.wrpTab.appendTo(wrp));

		definitions.forEach((definition, ix) => definition.render({wrp: tabs[ix].wrpTab, cb}));
		this._wrpReview = tabs.at(-1)?.wrpTab || null;
	}

	_getStageDefinitions () {
		throw new TypeError("Crafting Workbench builders must define authoring stages.");
	}

	_decorateTabsA11y ({tabs}) {
		const setActive = activeTab => tabs.forEach((tab, ix) => {
			const idTab = `mkbru-cw-${this._prop}-tab-${ix}`;
			const idPanel = `mkbru-cw-${this._prop}-panel-${ix}`;
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

	_getCb () {
		return MiscUtil.debounce(() => this._doSync(), 33);
	}

	_doSync ({isRenderInput = false} = {}) {
		this._saveStatus = "";
		const uniqueId = this.__state.uniqueId || CryptUtil.uid();
		const canonical = CraftingWorkbenchCore.serialize(this._prop, this._draft, this._getCoreOptions());
		canonical.uniqueId = uniqueId;
		for (const key of Object.keys(this.__state)) delete this.__state[key];
		Object.assign(this.__state, canonical);
		this._meta.isModified = true;
		this._dispHeaderName?.txt(`Editing "${this.__state.name || "?"}"`);
		this._validation = CraftingWorkbenchCore.validate(this._prop, this._draft, this._getCoreOptions());
		this._refreshValidation();
		this.renderOutput();
		this.doUiSave();
		this._refreshReview();
		if (isRenderInput) this.renderInput();
	}

	_refreshReview () {}

	_renderAdvancedJson ({wrp}) {
		const msg = ee`<div class="ve-small ve-mt-2" role="status" aria-live="polite"></div>`;
		const canonical = CraftingWorkbenchCore.serialize(this._prop, this._draft, this._getCoreOptions());
		const textarea = ee`<textarea class="ve-form-control mkbru_cw__advanced" aria-label="Canonical ${Parser.getPropDisplayName(this._prop)} JSON" spellcheck="false">${JSON.stringify(canonical, null, "\t").qq()}</textarea>`
			.onn("change", () => {
				try {
					this._draft = CraftingWorkbenchCore.normalize(this._prop, JSON.parse(textarea.val()));
					msg.attr("class", "ve-small ve-mt-2 text-success").txt("Advanced data applied.");
					this._doSync({isRenderInput: true});
				} catch (e) {
					msg.attr("class", "ve-small ve-mt-2 text-danger").txt(`Invalid JSON: ${e.message}`);
				}
			});
		ee`<details class="mkbru_cw__section mkbru_cw__advanced-shell">
			<summary>Advanced canonical JSON</summary>
			<div class="ve-muted ve-small ve-mb-2">Edit uncommon canonical fields without losing data. Invalid JSON is never applied.</div>
			${textarea}
			${msg}
		</details>`.appendTo(wrp);
	}

	_refreshValidation () {
		if (!this._draft) return;
		this._validation = CraftingWorkbenchCore.validate(this._prop, this._draft, this._getCoreOptions());
		const {errors, warnings} = this._validation;
		this._btnHeaderSave?.prop("disabled", !!errors.length)
			.attr("aria-disabled", `${!!errors.length}`)
			.attr("title", errors.length ? `Cannot save: ${errors[0].message}` : `Save ${Parser.getPropDisplayName(this._prop)} to homebrew`);
		if (!this._wrpValidation) return;
		this._wrpValidation.empty();
		const messages = [...errors, ...warnings];
		const status = this._saveStatus || (errors.length
			? `Cannot save yet. ${errors[0].message}`
			: warnings.length
				? "Ready to save with warnings."
				: "Ready to save.");
		ee`<div class="mkbru_cw__validation ${errors.length ? "mkbru_cw__validation--error" : warnings.length ? "mkbru_cw__validation--warning" : "mkbru_cw__validation--ready"}" role="status" aria-live="polite">
			<strong>${status.qq()}</strong>
			${messages.map(it => `<div>${it.message.qq()}</div>`)}
		</div>`.appendTo(this._wrpValidation);
	}

	async pDoHandleClickSaveBrew () {
		this._doSync();
		const validation = CraftingWorkbenchCore.validate(this._prop, this._draft, this._getCoreOptions());
		if (!validation.isValid) {
			this._saveStatus = `Cannot save: ${validation.errors[0].message}`;
			this._refreshValidation();
			return false;
		}
		if (!await super.pDoHandleClickSaveBrew()) return false;
		this._saveStatus = `Saved "${this._draft.name}" to homebrew.`;
		this._refreshValidation();
		return true;
	}

	_getAsMarkdown (entity) {
		const subtitle = [
			Parser.getPropDisplayName(this._prop),
			entity.source ? Parser.sourceJsonToFull(entity.source) : null,
			entity.page != null ? `p. ${entity.page}` : null,
		].filter(Boolean).join(" · ");
		const entries = entity.entries?.length
			? RendererMarkdown.get().render({type: "entries", entries: entity.entries}).trim()
			: "";
		return [
			`## ${entity.name || "Unnamed"}`,
			subtitle ? `*${subtitle}*` : "",
			entries,
			"```json",
			JSON.stringify(DataUtil.cleanJson(MiscUtil.copy(entity)), null, "\t"),
			"```",
		].filter(Boolean).join("\n\n");
	}

	async pDoHandleClickDownloadMarkdown ({uniqueIds = null} = {}) {
		const entities = (await this._pGetBrewEntitiesCurrentSource())
			.filter(entity => uniqueIds == null || uniqueIds.includes(entity.uniqueId));
		const markdown = entities.map(entity => this._getAsMarkdown(entity)).join("\n\n---\n\n");
		DataUtil.userDownloadText(`${DataUtil.getCleanFilename(BrewUtil2.sourceJsonToFull(this._ui.source))}.md`, markdown);
	}

	async pHandleClick_viewMarkdownUniqueId (evt, uniqueId) {
		const entity = MiscUtil.copy(await BrewUtil2.pGetEditableBrewEntity(this._prop, uniqueId));
		const name = `${entity._displayName || entity.name} — Markdown`;
		Renderer.hover.getShowWindow(
			Renderer.hover.getHoverContent_miscCode(name, this._getAsMarkdown(entity)),
			Renderer.hover.getWindowPositionFromEvent(evt),
			{title: name, isPermanent: true, isBookContent: true},
		);
	}

	static getPreviewEntity (prop, entity) {
		return {
			...CraftingWorkbenchCore.serialize(prop, entity),
			__prop: prop,
		};
	}

	renderOutput () {
		this._renderOutputDebounced();
	}

	_renderOutput () {
		const wrp = this._ui.wrpOutput.empty();
		this._resetTabs({tabGroup: "output"});
		const tabs = this._renderTabs([
			new TabUiUtil.TabMeta({name: "Preview"}),
			new TabUiUtil.TabMeta({name: "Data"}),
		], {tabGroup: "output", cbTabChange: this.doUiSave.bind(this)});
		const [previewTab, dataTab] = tabs;
		ee`<div class="ve-flex-v-center ve-w-100 ve-no-shrink">${tabs.map(it => it.btnTab)}</div>`.appendTo(wrp);
		tabs.forEach(it => it.wrpTab.appendTo(wrp));

		const canonical = CraftingWorkbenchCore.serialize(this._prop, this.__state, this._getCoreOptions());
		const preview = this.constructor.getPreviewEntity(this._prop, canonical);
		const previewTable = ee`<table class="ve-w-100 ve-stats" aria-label="${Parser.getPropDisplayName(this._prop)} preview"></table>`.appendTo(previewTab.wrpTab);
		previewTable.appends(RenderCrafting.getRenderedCrafting(preview, {isSkipExcludesRender: true}));

		const clean = DataUtil.cleanJson(MiscUtil.copy(canonical));
		const dataHtml = Renderer.get().render({type: "entries", entries: [{type: "code", name: "Data", preformatted: JSON.stringify(clean, null, "\t")}]});
		ee`<table class="ve-w-100 ve-stats ve-stats--book mkbru__wrp-output-tab-data">${Renderer.utils.getBorderTr()}<tr><td colspan="6">${dataHtml}</td></tr>${Renderer.utils.getBorderTr()}</table>`.appendTo(dataTab.wrpTab);
	}
}
