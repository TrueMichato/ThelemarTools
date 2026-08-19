/**
 * Character Sheet Export/Import Handler
 * Handles saving, loading, exporting, and importing character data
 */
import {CharacterSheetModal} from "./charactersheet-modal.js";
import {CharacterSheetNpcExporter} from "./charactersheet-npc-exporter.js";
import {CharacterSheetPdf} from "./charactersheet-pdf.js";

// Project globals — typed via globalThis cast for TypeScript checkJs
const {e_, ee, DataUtil, JqueryUtil, StorageUtil, InputUiUtil} = /** @type {*} */ (globalThis);

class CharacterSheetExport {
	static _STORAGE_KEY_NPC_SOURCE_CONFIG = "charsheet-npc-export-source-config";
	static _STORAGE_KEY_NPC_EXPORT_OPTIONS = "charsheet-npc-export-options";

	constructor (page) {
		this._page = page;
		this._state = page.getState();

		this._init();
	}

	_init () {
		this._initEventListeners();
	}

	_initEventListeners () {
		document.getElementById("charsheet-btn-export")?.addEventListener("click", () => this._showExportDialog());
		document.getElementById("charsheet-btn-import")?.addEventListener("click", () => this._showImportDialog());
		document.getElementById("charsheet-btn-print")?.addEventListener("click", () => this._openPdfPrintView());
		document.getElementById("charsheet-btn-export-npc")?.addEventListener("click", () => this._showNpcExportDialog());
		document.getElementById("charsheet-btn-save")?.addEventListener("click", () => this._saveCharacter());
	}

	async _showExportDialog () {
		const characterData = this._state.toJSON();
		const jsonStr = JSON.stringify(characterData, null, 2);
		const characterName = this._state.getName() || "character";

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "📤 Export Character",
			isMinHeight0: true,
			isWidth100: true,
		});

		let isPdfFormat = false;
		let syncFooterForFormat = () => {};

		const btnJson = e_({tag: "button",
			clazz: "ve-btn ve-btn-default ve-active",
			txt: "JSON File",
			click: () => {
				isPdfFormat = false;
				btnJson.classList.add("ve-active");
				btnPdf.classList.remove("ve-active");
				jsonSection.style.display = "";
				pdfSection.style.display = "none";
				syncFooterForFormat();
			}});

		const btnPdf = e_({tag: "button",
			clazz: "ve-btn ve-btn-default",
			txt: "Print / PDF",
			click: () => {
				isPdfFormat = true;
				btnPdf.classList.add("ve-active");
				btnJson.classList.remove("ve-active");
				pdfSection.style.display = "";
				jsonSection.style.display = "none";
				syncFooterForFormat();
			}});

		const jsonSection = ee`<div>
			<div class="charsheet__export-info mb-3">
				<p class="ve-muted mb-1"><strong>💾 JSON Export</strong> - Create a backup file to:</p>
				<ul class="ve-muted" style="margin: 0; padding-left: 1.5rem;">
					<li>Transfer your character to another device</li>
					<li>Share your character with another player</li>
					<li>Keep a backup of your character</li>
				</ul>
			</div>
			<details class="charsheet__export-preview">
				<summary class="charsheet__export-preview-summary">Preview raw data</summary>
				<textarea class="ve-form-control mt-2" rows="12" readonly style="font-family: monospace; font-size: 0.8rem;">${jsonStr}</textarea>
			</details>
		</div>`;

		const btnOpenPrintView = e_({tag: "button",
			clazz: "ve-btn ve-btn-primary mt-2",
			click: () => {
				this._openPdfPrintView();
			}});
		btnOpenPrintView.innerHTML = `📄 Open Print View`;

		const btnQuickPrint = e_({tag: "button",
			clazz: "ve-btn ve-btn-default mt-2 ml-2",
			click: () => {
				this._printCharacter();
			}});
		btnQuickPrint.innerHTML = `🖨️ Quick Print (Live UI)`;

		const pdfSection = ee`<div style="display: none;">
			<div class="charsheet__export-info">
				<p class="ve-muted mb-1"><strong>📄 Print-Ready Character Sheet</strong></p>
				<p class="ve-muted" style="font-size: 0.85rem;">Opens a clean, print-optimized character sheet in a new window. Use your browser's print dialog to save as PDF or print a physical copy.</p>
				<ul class="ve-muted" style="margin: 0.5rem 0 0; padding-left: 1.5rem; font-size: 0.85rem;">
					<li>Classic D&amp;D-inspired parchment layout</li>
					<li>Stats, features, spells, equipment, notes, and resources</li>
					<li>Thelemar homebrew sections (if applicable)</li>
					<li>Companion statblocks on a dedicated page</li>
				</ul>
				<p class="ve-muted mt-2" style="font-size: 0.8rem;"><strong>Quick Print</strong> uses the live sheet layout (tabs/chrome stripped) and is not the parchment print view.</p>
			</div>
			<div>
				${btnOpenPrintView}
				${btnQuickPrint}
			</div>
		</div>`;

		ee`<div>
			<div class="mb-3">
				<div class="charsheet__export-format-label mb-2">Export Format:</div>
				<div class="ve-btn-group">
					${btnJson}
					${btnPdf}
				</div>
			</div>
			${jsonSection}
			${pdfSection}
		</div>`.appendTo(modalInner);

		// Footer buttons — labels/visibility track the selected export format.
		const btnClose = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Close", click: () => doClose(false)});
		const btnCopy = e_({tag: "button",
			clazz: "ve-btn ve-btn-default",
			click: async () => {
				await MiscUtil.pCopyTextToClipboard(jsonStr);
				JqueryUtil.doToast({type: "success", content: "Character data copied to clipboard!"});
			}});
		btnCopy.innerHTML = `<span class="glyphicon glyphicon-copy"></span> Copy to Clipboard`;

		const btnDownload = e_({tag: "button",
			clazz: "ve-btn ve-btn-primary",
			click: () => {
				// Note: DataUtil.userDownload appends ".json" itself — pass bare basename.
				const basename = characterName.replace(/[^a-zA-Z0-9]/g, "_");
				DataUtil.userDownload(basename, characterData, {fileType: "character"});
				JqueryUtil.doToast({type: "success", content: `Downloaded ${basename}.json`});
			}});
		btnDownload.innerHTML = `<span class="glyphicon glyphicon-download"></span> Download`;

		const btnFooterPrint = e_({tag: "button",
			clazz: "ve-btn ve-btn-primary",
			style: "display: none;",
			click: () => this._openPdfPrintView()});
		btnFooterPrint.innerHTML = `📄 Open Print View`;

		syncFooterForFormat = () => {
			btnCopy.style.display = isPdfFormat ? "none" : "";
			btnDownload.style.display = isPdfFormat ? "none" : "";
			btnFooterPrint.style.display = isPdfFormat ? "" : "none";
		};
		syncFooterForFormat();

		ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			${btnClose}
			${btnCopy}
			${btnDownload}
			${btnFooterPrint}
		</div>`.appendTo(modalInner);
	}

	async _showImportDialog () {
		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title: "📥 Import Character",
			isMinHeight0: true,
		});

		const fileInput = e_({tag: "input", clazz: "ve-form-control"});
		fileInput.type = "file";
		fileInput.accept = ".json";

		const jsonTextarea = e_({tag: "textarea", clazz: "ve-form-control"});
		jsonTextarea.rows = 8;
		jsonTextarea.placeholder = "Paste character JSON data here...";
		jsonTextarea.style.fontFamily = "monospace";
		jsonTextarea.style.fontSize = "0.85rem";

		const cbReplace = e_({tag: "input", clazz: "mr-2"});
		cbReplace.type = "checkbox";

		// File input handler
		fileInput.addEventListener("change", (e) => {
			const file = e.target.files[0];
			if (!file) return;

			const reader = new FileReader();
			reader.onload = (evt) => {
				jsonTextarea.value = evt.target.result;
				JqueryUtil.doToast({type: "info", content: `Loaded: ${file.name}`});
			};
			reader.readAsText(file);
		});

		ee`<div>
			<div class="charsheet__import-info mb-3">
				<p class="ve-muted mb-1"><strong>📂 Import a character</strong> from a previously exported JSON file.</p>
				<p class="ve-muted" style="font-size: 0.85rem;">Characters are saved locally in your browser. Use this to restore a backup or import a character from another device.</p>
			</div>
			
			<div class="mb-3">
				<label class="ve-muted mb-1"><strong>Option 1:</strong> Select a file</label>
				${fileInput}
			</div>
			
			<div class="text-center ve-muted mb-3" style="font-size: 0.85rem;">— or —</div>
			
			<div class="mb-3">
				<label class="ve-muted mb-1"><strong>Option 2:</strong> Paste JSON data</label>
				${jsonTextarea}
			</div>
			
			<div class="charsheet__import-option mt-3">
				<label class="ve-flex-v-center">
					${cbReplace}
					<span>
						<strong>Replace current character</strong>
						<span class="ve-muted" style="font-size: 0.85rem;"> — Overwrites the character you're currently editing (cannot be undone)</span>
					</span>
				</label>
			</div>
		</div>`.appendTo(modalInner);

		// Footer buttons
		const btnCancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Cancel", click: () => doClose(false)});
		const btnImport = e_({tag: "button",
			clazz: "ve-btn ve-btn-primary",
			txt: "Import",
			click: async () => {
				const jsonStr = jsonTextarea.value.trim();
				const replaceExisting = cbReplace.checked;

				if (!jsonStr) {
					JqueryUtil.doToast({type: "warning", content: "Please provide character data to import."});
					return;
				}

				try {
					let data = JSON.parse(jsonStr);

					// Accept the E2E test-export wrapper shape
					// ({status, displayName, character: <state>, ...}) by
					// unwrapping to the inner `character`. Spec authors
					// load these JSONs by hand to validate open bugs.
					if (data && typeof data === "object" && data.character && typeof data.character === "object" && (data.character.name || data.character.classes || data.character.race)) {
						data = data.character;
					}

					// Validate basic structure
					if (!data.name && !data.classes && !data.race) {
						throw new Error("Invalid character data structure");
					}

					if (replaceExisting) {
						this._state.fromJSON(data);
					} else {
						const newState = new CharacterSheetState();
						newState.fromJSON(data);
						await this._page.addCharacter(newState);
					}

					this._page.renderCharacter();
					await this._page.saveCharacter();

					doClose(true);
					JqueryUtil.doToast({type: "success", content: `Imported ${data.name || "character"} successfully!`});
				} catch (err) {
					// eslint-disable-next-line no-console
					console.error("Import error:", err);
					JqueryUtil.doToast({type: "danger", content: "Failed to import: Invalid JSON data."});
				}
			}});

		ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			${btnCancel}
			${btnImport}
		</div>`.appendTo(modalInner);
	}

	/**
	 * Slot level alone cannot separate a blaster from a diplomat, so the CR estimate needs
	 * to know what each spell actually does. Loading happens here, once, because the
	 * converter itself is deliberately pure and synchronous.
	 */
	async _pGetNpcExportSpellIndex () {
		if (this._npcExportSpellIndex !== undefined) return this._npcExportSpellIndex;
		try {
			const data = await DataUtil.spell.pLoadAll();
			this._npcExportSpellIndex = CharacterSheetNpcExporter.buildSpellThreatIndex(data?.spell || []);
		} catch (e) {
			// A missing index only costs precision — the school-weighted fallback still runs.
			this._npcExportSpellIndex = null;
		}
		return this._npcExportSpellIndex;
	}

	async _showNpcExportDialog () {
		try {
			let sourceConfig = await this._pGetNpcExportSourceConfig();
			let exportOptions = await this._pGetNpcExportOptions();
			const spellIndex = await this._pGetNpcExportSpellIndex();
			let monster = null;
			let companionItems = [];
			let sourceMeta = CharacterSheetNpcExporter.getDefaultSourceMeta(sourceConfig);

			const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
				title: "👹 Export Character as NPC",
				isMinHeight0: true,
				isWidth100: true,
			});

			const iptSourceJson = e_({tag: "input", clazz: "ve-form-control ve-input-sm"});
			iptSourceJson.placeholder = "CSHEET";
			iptSourceJson.value = sourceConfig.sourceJson;

			const iptSourceAbv = e_({tag: "input", clazz: "ve-form-control ve-input-sm"});
			iptSourceAbv.placeholder = "CSHEET";
			iptSourceAbv.value = sourceConfig.abbreviation;

			const iptSourceFull = e_({tag: "input", clazz: "ve-form-control ve-input-sm"});
			iptSourceFull.placeholder = "Character Sheet NPC Exports";
			iptSourceFull.value = sourceConfig.full;

			const iptSourceVersion = e_({tag: "input", clazz: "ve-form-control ve-input-sm"});
			iptSourceVersion.placeholder = "1.0.0";
			iptSourceVersion.value = sourceConfig.version;

			const selDefenseMode = e_({outer: `<select class="ve-form-control ve-input-sm">
				<option value="persistent">Persistent Defenses (default)</option>
				<option value="active">Include Active-State Defenses</option>
			</select>`});
			selDefenseMode.value = exportOptions.defenseMode;

			const selUnarmed = e_({outer: `<select class="ve-form-control ve-input-sm">
				<option value="auto">Unarmed: Auto</option>
				<option value="always">Unarmed: Always</option>
				<option value="never">Unarmed: Never</option>
			</select>`});
			selUnarmed.value = exportOptions.includeUnarmed;

			const selFeatures = e_({outer: `<select class="ve-form-control ve-input-sm">
				<option value="auto">Features: Auto (important)</option>
				<option value="allImportant">Features: All important</option>
				<option value="manual">Features: Manual pick</option>
			</select>`});
			selFeatures.value = exportOptions.includeFeatures;

			const selCrMode = e_({outer: `<select class="ve-form-control ve-input-sm">
				<option value="auto">CR: Auto estimate</option>
				<option value="manual">CR: Manual</option>
			</select>`});
			selCrMode.value = exportOptions.crMode;

			const iptCrManual = e_({tag: "input", clazz: "ve-form-control ve-input-sm"});
			iptCrManual.placeholder = "5";
			iptCrManual.value = exportOptions.crManual || "1";
			iptCrManual.style.maxWidth = "80px";

			const cbCustomMods = e_({tag: "input", type: "checkbox"});
			cbCustomMods.checked = !!exportOptions.includeCustomModifiers;
			const cbCustomAbs = e_({tag: "input", type: "checkbox"});
			cbCustomAbs.checked = exportOptions.includeCustomAbilities !== false;
			const cbMethods = e_({tag: "input", type: "checkbox"});
			cbMethods.checked = exportOptions.includeCombatMethods !== false;
			const cbCrBreakdown = e_({tag: "input", type: "checkbox"});
			cbCrBreakdown.checked = !!exportOptions.includeCrBreakdown;
			const cbLevelSignal = e_({tag: "input", type: "checkbox"});
			cbLevelSignal.checked = !!exportOptions.includeLevelSignal;
			const cbLegendary = e_({tag: "input", type: "checkbox"});
			cbLegendary.checked = !!exportOptions.legendaryEnabled;

			const iptLegendaryActions = e_({tag: "input", clazz: "ve-form-control ve-input-sm", type: "number"});
			iptLegendaryActions.min = "0";
			iptLegendaryActions.max = "5";
			iptLegendaryActions.value = String(exportOptions.legendaryActions ?? 3);
			iptLegendaryActions.style.maxWidth = "70px";

			const iptLegendaryRes = e_({tag: "input", clazz: "ve-form-control ve-input-sm", type: "number"});
			iptLegendaryRes.min = "0";
			iptLegendaryRes.max = "5";
			iptLegendaryRes.value = String(exportOptions.legendaryResistances ?? 0);
			iptLegendaryRes.style.maxWidth = "70px";

			const wrpFeaturePicker = e_({tag: "div", clazz: "mb-2"});
			const wrpPreviewMeta = e_({tag: "p", clazz: "ve-muted mb-0"});
			const wrpValidation = e_({tag: "div", clazz: "mb-2"});
			const wrpPreviewStatblock = e_({tag: "div", clazz: "ve-overflow-x-auto", style: "max-height: 50vh; overflow-y: auto;"});

			const featureChecks = new Map();
			const exportableFeatures = CharacterSheetNpcExporter.listExportableFeatures(this._state);
			const recommendedIds = new Set(
				exportableFeatures
					.filter(f => f.classification === "important")
					.map(f => f.id),
			);
			const initialSelected = new Set(
				(exportOptions.selectedFeatureIds || []).length
					? exportOptions.selectedFeatureIds
					: [...recommendedIds],
			);

			const renderFeaturePicker = () => {
				wrpFeaturePicker.innerHTML = "";
				featureChecks.clear();
				if (selFeatures.value !== "manual") {
					wrpFeaturePicker.style.display = "none";
					return;
				}
				wrpFeaturePicker.style.display = "";
				const list = e_({tag: "div", clazz: "ve-flex-col", style: "max-height: 160px; overflow-y: auto; gap: 4px;"});
				exportableFeatures.forEach(f => {
					const cb = e_({tag: "input", type: "checkbox"});
					cb.checked = initialSelected.has(f.id) || initialSelected.has(f.name);
					featureChecks.set(f.id, cb);
					const badge = f.classification === "important" ? "important" : f.classification;
					ee`<label class="ve-flex-v-center" style="gap: 6px; font-size: 0.85rem;">
						${cb}
						<span>${f.name}</span>
						<span class="ve-muted">(${f.section} · ${badge})</span>
					</label>`.appendTo(list);
				});
				const btnRec = e_({tag: "button",
					clazz: "ve-btn ve-btn-default ve-btn-xs",
					txt: "Select recommended",
					click: () => {
						featureChecks.forEach((cb, id) => { cb.checked = recommendedIds.has(id); });
					}});
				const btnNone = e_({tag: "button",
					clazz: "ve-btn ve-btn-default ve-btn-xs",
					txt: "Select none",
					click: () => {
						featureChecks.forEach(cb => { cb.checked = false; });
					}});
				ee`<div>
					<div class="ve-flex-v-center mb-1" style="gap: 6px;">
						<strong style="font-size: 0.9rem;">Feature picks</strong>
						${btnRec}
						${btnNone}
					</div>
					${list}
				</div>`.appendTo(wrpFeaturePicker);
			};

			const readOptionsFromForm = () => {
				const selectedFeatureIds = [];
				featureChecks.forEach((cb, id) => {
					if (cb.checked) selectedFeatureIds.push(id);
				});
				return this._getSanitizedNpcExportOptions({
					defenseMode: String(selDefenseMode.value || "persistent"),
					includeUnarmed: String(selUnarmed.value || "auto"),
					includeFeatures: String(selFeatures.value || "auto"),
					selectedFeatureIds,
					includeCustomModifiers: !!cbCustomMods.checked,
					includeCustomAbilities: !!cbCustomAbs.checked,
					includeCombatMethods: !!cbMethods.checked,
					crMode: String(selCrMode.value || "auto"),
					crManual: String(iptCrManual.value || "1"),
					legendaryEnabled: !!cbLegendary.checked,
					legendaryActions: Number(iptLegendaryActions.value) || 0,
					legendaryResistances: Number(iptLegendaryRes.value) || 0,
					includeCrBreakdown: !!cbCrBreakdown.checked,
					includeLevelSignal: !!cbLevelSignal.checked,
				});
			};

			// A sheet-authored item resolves nowhere on its own, so it ships with the
			// statblock. Homebrew documents already carry `item`; we simply never populated it.
			// Rebuilt whenever the monster is, since the export source is part of an item's
			// identity and the user can change it from this very dialog.
			const rebuildCompanionItems = () => {
				try {
					companionItems = CharacterSheetNpcExporter.buildCompanionItems(monster, this._state, {sourceJson: monster?.source});
				} catch (e) {
					// eslint-disable-next-line no-console
					console.error("Failed to build companion items for NPC export:", e);
					companionItems = [];
				}
				this._registerCompanionItemHovers(companionItems);
			};
			const getCompanionItems = () => companionItems;

			const renderValidation = (validation) => {
				const notes = [...(validation.notes || [])];
				const nBundled = companionItems.length;
				if (nBundled) notes.unshift(`Bundling ${nBundled} custom item${nBundled === 1 ? "" : "s"} so their links resolve.`);
				const noteHtml = notes.slice(0, 4).map(n => `<div class="ve-muted">• ${this._escapeHtml(n)}</div>`).join("");

				if (!validation.errors.length && !validation.warnings.length) {
					wrpValidation.innerHTML = `
						<div style="font-size: 0.85rem;">
							<div class="ve-muted">Validation: no issues.</div>
							${noteHtml}
						</div>`;
					return;
				}
				const errHtml = validation.errors.slice(0, 4).map(e => `<div class="text-danger">• ${this._escapeHtml(e)}</div>`).join("");
				const warnHtml = validation.warnings.slice(0, 4).map(w => `<div class="text-warning">• ${this._escapeHtml(w)}</div>`).join("");
				const extraE = Math.max(0, validation.errors.length - 4);
				const extraW = Math.max(0, validation.warnings.length - 4);
				wrpValidation.innerHTML = `
					<div style="font-size: 0.85rem;">
						${errHtml}${extraE ? `<div class="text-danger">(+${extraE} more errors)</div>` : ""}
						${warnHtml}${extraW ? `<div class="text-warning">(+${extraW} more warnings)</div>` : ""}
						${noteHtml}
					</div>`;
			};

			const pApplySourceConfig = async () => {
				const inputConfig = {
					sourceJson: String(iptSourceJson.value || ""),
					abbreviation: String(iptSourceAbv.value || ""),
					full: String(iptSourceFull.value || ""),
					version: String(iptSourceVersion.value || ""),
				};
				const nextOptions = readOptionsFromForm();

				sourceConfig = CharacterSheetNpcExporter.getSanitizedSourceConfig(inputConfig);
				exportOptions = nextOptions;
				iptSourceJson.value = sourceConfig.sourceJson;
				iptSourceAbv.value = sourceConfig.abbreviation;
				iptSourceFull.value = sourceConfig.full;
				iptSourceVersion.value = sourceConfig.version;
				selDefenseMode.value = exportOptions.defenseMode;
				selUnarmed.value = exportOptions.includeUnarmed;
				selFeatures.value = exportOptions.includeFeatures;
				selCrMode.value = exportOptions.crMode;
				iptCrManual.value = exportOptions.crManual;
				cbCustomMods.checked = exportOptions.includeCustomModifiers;
				cbCustomAbs.checked = exportOptions.includeCustomAbilities;
				cbMethods.checked = exportOptions.includeCombatMethods;
				cbCrBreakdown.checked = exportOptions.includeCrBreakdown;
				cbLevelSignal.checked = exportOptions.includeLevelSignal;
				cbLegendary.checked = exportOptions.legendaryEnabled;
				iptLegendaryActions.value = String(exportOptions.legendaryActions);
				iptLegendaryRes.value = String(exportOptions.legendaryResistances);
				iptCrManual.disabled = exportOptions.crMode !== "manual";
				iptLegendaryActions.disabled = !exportOptions.legendaryEnabled;
				iptLegendaryRes.disabled = !exportOptions.legendaryEnabled;

				await this._pSetNpcExportSourceConfig(sourceConfig);
				await this._pSetNpcExportOptions(exportOptions);

				monster = CharacterSheetNpcExporter.convertStateToMonster(this._state, {
					sourceJson: sourceConfig.sourceJson,
					...exportOptions,
					spellIndex,
				});
				sourceMeta = CharacterSheetNpcExporter.getDefaultSourceMeta(sourceConfig);

				// Must precede the render: the preview's `{@item}` links are resolved on
				// hover against the DataLoader cache, and a bundled item is in no other store.
				rebuildCompanionItems();

				const rendered = Renderer.monster.getCompactRenderedString(monster, {isShowScalers: false});
				const safeName = this._escapeHtml(monster.name);
				const safeSource = this._escapeHtml(monster.source);
				const safeCr = this._escapeHtml(monster.cr);
				const actionCount = (monster.action || []).length;
				const spellBlocks = (monster.spellcasting || []).length;

				wrpPreviewMeta.innerHTML = `CR: <strong>${safeCr}</strong> • Source: <strong>${safeSource}</strong> • Name: <strong>${safeName}</strong> • Actions: ${actionCount} • Spellcasting blocks: ${spellBlocks}`;
				wrpPreviewStatblock.innerHTML = `<table class="ve-w-100 ve-stats"><tbody>${rendered}</tbody></table>`;
				Renderer.statblockCollapse.apply(wrpPreviewStatblock);
				renderValidation(CharacterSheetNpcExporter.getValidationIssues(monster));
			};

			selFeatures.addEventListener("change", () => {
				renderFeaturePicker();
			});

			ee`<div>
				<div class="charsheet__export-info mb-3">
					<p class="ve-muted mb-1"><strong>Statblock Preview</strong> — Uses the standard bestiary compact format.</p>
					${wrpPreviewMeta}
					${wrpValidation}
				</div>
				<div class="mb-3 p-2" style="border: 1px solid var(--bs-border-color); border-radius: 4px;">
					<div class="mb-2"><strong>Source Metadata</strong></div>
					<div class="ve-flex-v-center mb-2" style="gap: 8px;">
						<label class="ve-muted no-shrink" style="min-width: 110px;">JSON Identifier</label>
						${iptSourceJson}
					</div>
					<div class="ve-flex-v-center mb-2" style="gap: 8px;">
						<label class="ve-muted no-shrink" style="min-width: 110px;">Abbreviation</label>
						${iptSourceAbv}
					</div>
					<div class="ve-flex-v-center mb-2" style="gap: 8px;">
						<label class="ve-muted no-shrink" style="min-width: 110px;">Full Name</label>
						${iptSourceFull}
					</div>
					<div class="ve-flex-v-center" style="gap: 8px;">
						<label class="ve-muted no-shrink" style="min-width: 110px;">Version</label>
						${iptSourceVersion}
					</div>
				</div>
				<div class="mb-3 p-2" style="border: 1px solid var(--bs-border-color); border-radius: 4px;">
					<div class="mb-2"><strong>Export Options</strong></div>
					<div class="ve-flex-v-center mb-2" style="gap: 8px;">
						<label class="ve-muted no-shrink" style="min-width: 110px;">Defenses</label>
						${selDefenseMode}
					</div>
					<div class="ve-flex-v-center mb-2" style="gap: 8px;">
						<label class="ve-muted no-shrink" style="min-width: 110px;">Unarmed</label>
						${selUnarmed}
					</div>
					<div class="ve-flex-v-center mb-2" style="gap: 8px;">
						<label class="ve-muted no-shrink" style="min-width: 110px;">Features</label>
						${selFeatures}
					</div>
					${wrpFeaturePicker}
					<div class="ve-flex-v-center mb-2" style="gap: 8px; flex-wrap: wrap;">
						<label class="ve-muted no-shrink" style="min-width: 110px;">CR</label>
						${selCrMode}
						${iptCrManual}
						<label class="ve-flex-v-center ve-muted" style="gap: 4px; font-size: 0.85rem;">${cbCrBreakdown} Show CR breakdown</label>
						<label class="ve-flex-v-center ve-muted" style="gap: 4px; font-size: 0.85rem;" title="Adds an out-of-fiction &quot;Level Signal&quot; trait naming the source character's level and classes">${cbLevelSignal} Level signal</label>
					</div>
					<div class="ve-flex-v-center mb-2" style="gap: 12px; flex-wrap: wrap; font-size: 0.85rem;">
						<label class="ve-flex-v-center" style="gap: 4px;" title="Leftover effects not already promoted to abilities, defenses, or skills (smart filter)">${cbCustomMods} Leftover modifiers</label>
						<label class="ve-flex-v-center" style="gap: 4px;">${cbCustomAbs} Custom abilities</label>
						<label class="ve-flex-v-center" style="gap: 4px;">${cbMethods} Combat methods</label>
					</div>
					<div class="ve-flex-v-center" style="gap: 8px; flex-wrap: wrap;">
						<label class="ve-flex-v-center" style="gap: 4px; font-size: 0.85rem;">${cbLegendary} Legendary framing</label>
						<label class="ve-muted" style="font-size: 0.85rem;">Actions</label>
						${iptLegendaryActions}
						<label class="ve-muted" style="font-size: 0.85rem;">Resistances/day</label>
						${iptLegendaryRes}
					</div>
					<p class="ve-muted mb-0 mt-2" style="font-size: 0.8rem;">
						Persistent defenses = stable baseline. Active-State includes currently toggled effects. Legendary options are off by default.
					</p>
				</div>
				${wrpPreviewStatblock}
			</div>`.appendTo(modalInner);

			renderFeaturePicker();
			await pApplySourceConfig();

			const btnCancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Close", click: () => doClose(false)});

			const btnRefresh = e_({tag: "button",
				clazz: "ve-btn ve-btn-default",
				click: async () => {
					await pApplySourceConfig();
				}});
			btnRefresh.innerHTML = `<span class="glyphicon glyphicon-refresh"></span> Refresh Preview`;

			const getBrewPayload = () => {
				const payload = {_meta: {sources: [sourceMeta]}, monster: [monster]};
				const items = getCompanionItems();
				if (items.length) payload.item = items;
				return payload;
			};

			const btnCopy = e_({tag: "button",
				clazz: "ve-btn ve-btn-default",
				click: async () => {
					await pApplySourceConfig();
					const payload = getBrewPayload();
					await MiscUtil.pCopyTextToClipboard(JSON.stringify(payload, null, 2));
					const nItems = payload.item?.length || 0;
					JqueryUtil.doToast({
						type: "success",
						content: nItems
							? `NPC homebrew JSON copied to clipboard, with ${nItems} custom item${nItems === 1 ? "" : "s"}.`
							: "NPC homebrew JSON copied to clipboard!",
					});
				}});
			btnCopy.innerHTML = `<span class="glyphicon glyphicon-copy"></span> Copy JSON`;

			const btnDownload = e_({tag: "button",
				clazz: "ve-btn ve-btn-default",
				click: async () => {
					await pApplySourceConfig();

					const validation = CharacterSheetNpcExporter.getValidationIssues(monster);
					if (validation.errors.length || validation.warnings.length) {
						const details = this._getValidationIssueSummary(validation, {maxErrors: 2, maxWarnings: 2});
						JqueryUtil.doToast({
							type: "warning",
							content: `Downloaded with validation issues (${validation.errors.length} error(s), ${validation.warnings.length} warning(s)). ${details}`.trim(),
						});
					}

					// Note: DataUtil.userDownload appends ".json" itself — pass bare basename.
					const basename = (monster.name || "npc").replace(/[^a-zA-Z0-9]/g, "_");
					const payload = getBrewPayload();
					DataUtil.userDownload(
						basename,
						payload,
						{fileType: "homebrew"},
					);
					const nItems = payload.item?.length || 0;
					JqueryUtil.doToast({
						type: "success",
						content: nItems
							? `Downloaded ${basename}.json with ${nItems} custom item${nItems === 1 ? "" : "s"}.`
							: `Downloaded ${basename}.json`,
					});
				}});
			btnDownload.innerHTML = `<span class="glyphicon glyphicon-download"></span> Download JSON`;

			const btnSave = e_({tag: "button",
				clazz: "ve-btn ve-btn-primary",
				click: async () => {
					await pApplySourceConfig();
					await this._pSaveNpcToEditableBrew(monster, {sourceMeta, companionItems: getCompanionItems()});
				}});
			btnSave.innerHTML = `<span class="glyphicon glyphicon-floppy-disk"></span> Save to Homebrew`;

			ee`<div class="ve-flex-v-center ve-flex-h-right mt-3" style="gap: 6px; flex-wrap: wrap;">
				${btnCancel}
				${btnRefresh}
				${btnCopy}
				${btnDownload}
				${btnSave}
			</div>`.appendTo(modalInner);
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("NPC export failed:", e);
			JqueryUtil.doToast({type: "danger", content: "Failed to build NPC statblock from character."});
		}
	}

	_escapeHtml (text) {
		return String(text ?? "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}

	async _pGetNpcExportSourceConfig () {
		const stored = await StorageUtil.pGetForPage(CharacterSheetExport._STORAGE_KEY_NPC_SOURCE_CONFIG);
		return CharacterSheetNpcExporter.getSanitizedSourceConfig(stored || {});
	}

	async _pSetNpcExportSourceConfig (sourceConfig) {
		await StorageUtil.pSetForPage(CharacterSheetExport._STORAGE_KEY_NPC_SOURCE_CONFIG, sourceConfig);
	}

	_getSanitizedNpcExportOptions (opts = {}) {
		return CharacterSheetNpcExporter.getSanitizedExportOptions(opts);
	}

	async _pGetNpcExportOptions () {
		const stored = await StorageUtil.pGetForPage(CharacterSheetExport._STORAGE_KEY_NPC_EXPORT_OPTIONS);
		return this._getSanitizedNpcExportOptions(stored || {});
	}

	async _pSetNpcExportOptions (options) {
		await StorageUtil.pSetForPage(
			CharacterSheetExport._STORAGE_KEY_NPC_EXPORT_OPTIONS,
			this._getSanitizedNpcExportOptions(options),
		);
	}

	_getValidationErrorMessage (validation) {
		const messages = validation.errors.slice(0, 3).join(" ");
		const extraCount = Math.max(0, validation.errors.length - 3);
		if (!messages) return "Exported NPC is missing required fields and cannot be saved.";
		if (!extraCount) return `Cannot save NPC: ${messages}`;
		return `Cannot save NPC: ${messages} (+${extraCount} more issue${extraCount === 1 ? "" : "s"}).`;
	}

	_getValidationIssueSummary (validation, {maxErrors = 2, maxWarnings = 2} = {}) {
		const errorPreview = validation.errors.slice(0, maxErrors);
		const warningPreview = validation.warnings.slice(0, maxWarnings);

		const parts = [];
		if (errorPreview.length) {
			const extraErrors = Math.max(0, validation.errors.length - errorPreview.length);
			parts.push(`Errors: ${errorPreview.join(" ")}${extraErrors ? ` (+${extraErrors} more)` : ""}`);
		}
		if (warningPreview.length) {
			const extraWarnings = Math.max(0, validation.warnings.length - warningPreview.length);
			parts.push(`Warnings: ${warningPreview.join(" ")}${extraWarnings ? ` (+${extraWarnings} more)` : ""}`);
		}

		return parts.join(" ");
	}

	/**
	 * Make bundled items hoverable in the export preview.
	 *
	 * The preview renders the monster before any of it has been saved anywhere, so a
	 * bundled item exists only as a JS object we are holding. `{@item Name|CSHEET}`
	 * therefore renders a link whose hover resolves against an empty cache and silently
	 * shows nothing — the payload was right, but the preview could not prove it.
	 *
	 * Seeding the DataLoader cache directly is the same mechanism the sheet already uses
	 * for Ar8 variant-component items and for its loaded class/subclass/optfeature
	 * entities (see `_pPreCacheEntityData` / `_registerLoadedHoverEntities` in
	 * `charactersheet.js`). It is synchronous, so there is no first-hover race, and it
	 * keys on `source` + the item hash builder — exactly what the rendered link queries.
	 *
	 * Registering under the *current* export source is why this reruns whenever the
	 * monster is rebuilt: changing the source in this dialog changes the item's hash.
	 */
	_registerCompanionItemHovers (items) {
		if (!items?.length) return;
		if (typeof DataLoader === "undefined" || typeof DataLoader._pCache_addToCache !== "function") return;
		try {
			// Cached entities are shared and long-lived; the payload copy must not gain a
			// `__prop` the schema would reject on download.
			const forCache = items.map(item => ({...item, __prop: "item"}));
			DataLoader._pCache_addToCache({allDataMerged: {item: forCache}, propAllowlist: new Set(["item"])});
		} catch (e) {
			// Non-critical: the export payload is unaffected, only the preview hover.
			// eslint-disable-next-line no-console
			console.warn("[CharSheet] Failed to register companion items for hovers:", e);
		}
	}

	_getNpcCopyName ({name, existingMonsters}) {
		const usedNames = new Set((existingMonsters || []).map(it => it?.name).filter(Boolean));
		if (!usedNames.has(name)) return name;
		const base = `${name} (Copy)`;
		if (!usedNames.has(base)) return base;

		for (let i = 2; i < 1000; i++) {
			const candidate = `${name} (Copy ${i})`;
			if (!usedNames.has(candidate)) return candidate;
		}

		return `${name} (Copy ${CryptUtil.uid().slice(0, 6)})`;
	}

	async _pSaveNpcToEditableBrew (monster, {sourceMeta = null, companionItems = []} = {}) {
		if (typeof BrewUtil2 === "undefined") {
			JqueryUtil.doToast({type: "danger", content: "Homebrew utilities are not available."});
			return;
		}

		const validation = CharacterSheetNpcExporter.getValidationIssues(monster);
		if (validation.errors.length) {
			const details = this._getValidationIssueSummary(validation, {maxErrors: 3, maxWarnings: 0});
			JqueryUtil.doToast({type: "danger", content: `${this._getValidationErrorMessage(validation)} ${details}`.trim()});
			return;
		}
		if (validation.warnings.length) {
			const details = this._getValidationIssueSummary(validation, {maxErrors: 0, maxWarnings: 3});
			JqueryUtil.doToast({
				type: "warning",
				content: `Saving with ${validation.warnings.length} validation warning${validation.warnings.length === 1 ? "" : "s"}. ${details}`.trim(),
			});
		}

		try {
			const brew = await BrewUtil2.pGetOrCreateEditableBrewDoc();
			const sourceJson = monster.source || CharacterSheetNpcExporter.SOURCE_JSON_DEFAULT;
			sourceMeta ||= CharacterSheetNpcExporter.getDefaultSourceMeta({sourceJson});

			const sources = MiscUtil.getOrSet(brew, "body", "_meta", "sources", []);
			if (!sources.some(src => src.json === sourceJson)) {
				sources.push(sourceMeta);
				await BrewUtil2.pSetEditableBrewDoc(brew);
			}

			const brewMonsters = brew.body?.monster || [];
			const existing = brewMonsters.find(it => it.name === monster.name && it.source === monster.source);

			let isOverwrite = true;
			let finalName = monster.name;
			if (existing) {
				const choice = await InputUiUtil.pGetUserEnum({
					title: "NPC Already Exists",
					values: ["Overwrite existing", "Save as copy", "Cancel"],
					default: 0,
					isResolveItem: true,
					elePost: ee`<p class="ve-muted mt-2 mb-0">A monster named <strong>${this._escapeHtml(existing.name)}</strong> with source <strong>${this._escapeHtml(existing.source)}</strong> already exists in editable homebrew.</p>`,
				});

				if (!choice || choice === "Cancel") return;
				if (choice === "Save as copy") {
					isOverwrite = false;
					finalName = this._getNpcCopyName({name: monster.name, existingMonsters: brewMonsters});
				}
			}

			const toSave = {
				...monster,
				name: finalName,
				uniqueId: isOverwrite ? (existing?.uniqueId || monster.uniqueId || CryptUtil.uid()) : (monster.uniqueId || CryptUtil.uid()),
			};

			await BrewUtil2.pPersistEditableBrewEntity("monster", toSave);

			// The statblock's `{@item}` tags point at these, so saving the monster without
			// them would persist the dead hover we are trying to fix.
			let nItemsSaved = 0;
			for (const item of companionItems) {
				const existingItem = (brew.body?.item || []).find(it => it.name === item.name && it.source === item.source);
				await BrewUtil2.pPersistEditableBrewEntity("item", {
					...item,
					uniqueId: existingItem?.uniqueId || CryptUtil.uid(),
				});
				nItemsSaved++;
			}

			JqueryUtil.doToast({
				type: "success",
				content: nItemsSaved
					? `Saved ${toSave.name} to editable homebrew, with ${nItemsSaved} custom item${nItemsSaved === 1 ? "" : "s"}.`
					: `Saved ${toSave.name} to editable homebrew.`,
			});
		} catch (e) {
			// eslint-disable-next-line no-console
			console.error("Failed to save NPC to homebrew:", e);
			JqueryUtil.doToast({type: "danger", content: "Failed to save NPC to editable homebrew."});
		}
	}

	_openPdfPrintView () {
		const pdf = new CharacterSheetPdf(this._state, {skillsList: this._page.getSkillsList?.() || []});
		const html = pdf.generate();
		const printWindow = window.open("", "_blank");
		if (!printWindow) {
			JqueryUtil.doToast({type: "warning", content: "Pop-up blocked! Please allow pop-ups for this site to open the print view."});
			return;
		}
		printWindow.document.open();
		printWindow.document.write(html);
		printWindow.document.close();
		try {
			printWindow.document.title = `${this._state.getName() || "Character"} — Character Sheet`;
		} catch (e) {
			// Cross-origin or closed window — ignore
		}
	}

	_printCharacter () {
		document.body.classList.add("charsheet-printing");
		window.print();
		setTimeout(() => {
			document.body.classList.remove("charsheet-printing");
		}, 1000);
	}

	async _saveCharacter () {
		try {
			await this._page.saveCharacter();
			JqueryUtil.doToast({type: "success", content: "Character saved!"});
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error("Save error:", err);
			JqueryUtil.doToast({type: "danger", content: "Failed to save character."});
		}
	}

	// Export to various formats
	toFoundryVTT () {
		// Convert character data to Foundry VTT format
		const data = this._state.toJSON();

		return {
			name: data.name,
			type: "character",
			system: {
				abilities: {
					str: {value: data.abilities.str.base + (data.abilities.str.bonus || 0)},
					dex: {value: data.abilities.dex.base + (data.abilities.dex.bonus || 0)},
					con: {value: data.abilities.con.base + (data.abilities.con.bonus || 0)},
					int: {value: data.abilities.int.base + (data.abilities.int.bonus || 0)},
					wis: {value: data.abilities.wis.base + (data.abilities.wis.bonus || 0)},
					cha: {value: data.abilities.cha.base + (data.abilities.cha.bonus || 0)},
				},
				attributes: {
					hp: {value: data.hp.current, max: data.hp.max, temp: data.hp.temp},
					ac: {value: this._state.getArmorClass()},
					speed: data.speed,
				},
				details: {
					level: this._state.getTotalLevel(),
					race: data.race?.name,
					background: data.background?.name,
				},
			},
			items: [
				...data.classes.map(cls => ({
					name: cls.name,
					type: "class",
					system: {levels: cls.level},
				})),
				...data.inventory.items.map(item => ({
					name: item.name,
					type: item.type === "weapon" ? "weapon" : item.type === "armor" ? "equipment" : "loot",
					system: {quantity: item.quantity},
				})),
			],
		};
	}

	toRoll20 () {
		// Convert to Roll20 character JSON format
		const data = this._state.toJSON();

		return {
			schema_version: 2,
			name: data.name,
			attribs: [
				{name: "strength", current: this._state.getAbilityTotal("str")},
				{name: "dexterity", current: this._state.getAbilityTotal("dex")},
				{name: "constitution", current: this._state.getAbilityTotal("con")},
				{name: "intelligence", current: this._state.getAbilityTotal("int")},
				{name: "wisdom", current: this._state.getAbilityTotal("wis")},
				{name: "charisma", current: this._state.getAbilityTotal("cha")},
				{name: "hp", current: data.hp.current, max: data.hp.max},
				{name: "ac", current: this._state.getArmorClass()},
				{name: "speed", current: data.speed.walk},
				{name: "level", current: this._state.getTotalLevel()},
				{name: "race", current: data.race?.name || ""},
				{name: "class", current: data.classes.map(c => c.name).join("/") || ""},
			],
		};
	}
}

globalThis.CharacterSheetExport = CharacterSheetExport;

export {CharacterSheetExport};
