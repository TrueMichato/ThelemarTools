/**
 * Character Sheet Export/Import Handler
 * Handles saving, loading, exporting, and importing character data
 */
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

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "📤 Export Character",
			isMinHeight0: true,
			isWidth100: true,
		});

		let isPdfFormat = false;

		const btnJson = e_({tag: "button",
			clazz: "ve-btn ve-btn-default ve-active",
			txt: "JSON File",
			click: () => {
				isPdfFormat = false;
				btnJson.classList.add("ve-active");
				btnPdf.classList.remove("ve-active");
				jsonSection.style.display = "";
				pdfSection.style.display = "none";
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
			<div class="charsheet__export-preview">
				<label class="ve-muted mb-1">Character Data Preview:</label>
				<textarea class="ve-form-control" rows="12" readonly style="font-family: monospace; font-size: 0.8rem;">${jsonStr}</textarea>
			</div>
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
		btnQuickPrint.innerHTML = `🖨️ Quick Print (Current View)`;

		const pdfSection = ee`<div style="display: none;">
			<div class="charsheet__export-info">
				<p class="ve-muted mb-1"><strong>📄 Print-Ready Character Sheet</strong></p>
				<p class="ve-muted" style="font-size: 0.85rem;">Opens a clean, print-optimized character sheet in a new window. Use your browser's print dialog to save as PDF or print a physical copy.</p>
				<ul class="ve-muted" style="margin: 0.5rem 0 0; padding-left: 1.5rem; font-size: 0.85rem;">
					<li>Classic D&amp;D-inspired parchment layout</li>
					<li>All stats, features, spells, and equipment</li>
					<li>Thelemar homebrew sections (if applicable)</li>
					<li>Companion statblocks on a dedicated page</li>
				</ul>
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

		// Footer buttons
		const btnClose = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Close", click: () => doClose(false)});
		const btnCopy = e_({tag: "button",
			clazz: "ve-btn ve-btn-default",
			click: async () => {
				if (isPdfFormat) {
					this._openPdfPrintView();
				} else {
					await MiscUtil.pCopyTextToClipboard(jsonStr);
					JqueryUtil.doToast({type: "success", content: "Character data copied to clipboard!"});
				}
			}});
		btnCopy.innerHTML = `<span class="glyphicon glyphicon-copy"></span> Copy to Clipboard`;

		const btnDownload = e_({tag: "button",
			clazz: "ve-btn ve-btn-primary",
			click: () => {
				if (isPdfFormat) {
					this._openPdfPrintView();
				} else {
					const filename = `${characterName.replace(/[^a-zA-Z0-9]/g, "_")}.json`;
					DataUtil.userDownload(filename, characterData, {fileType: "character"});
					JqueryUtil.doToast({type: "success", content: `Downloaded ${filename}`});
				}
			}});
		btnDownload.innerHTML = `<span class="glyphicon glyphicon-download"></span> Download`;

		ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			${btnClose}
			${btnCopy}
			${btnDownload}
		</div>`.appendTo(modalInner);
	}

	async _showImportDialog () {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
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
					const data = JSON.parse(jsonStr);

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

	async _showNpcExportDialog () {
		try {
			let sourceConfig = await this._pGetNpcExportSourceConfig();
			let exportOptions = await this._pGetNpcExportOptions();
			let monster = CharacterSheetNpcExporter.convertStateToMonster(this._state, {
				sourceJson: sourceConfig.sourceJson,
				defenseMode: exportOptions.defenseMode,
			});
			let sourceMeta = CharacterSheetNpcExporter.getDefaultSourceMeta(sourceConfig);

			const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
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

			const wrpPreviewMeta = e_({tag: "p", clazz: "ve-muted mb-0"});
			const wrpPreviewStatblock = e_({tag: "div", clazz: "ve-overflow-x-auto", style: "max-height: 60vh; overflow-y: auto;"});

			const pApplySourceConfig = async () => {
				const inputConfig = {
					sourceJson: String(iptSourceJson.value || ""),
					abbreviation: String(iptSourceAbv.value || ""),
					full: String(iptSourceFull.value || ""),
					version: String(iptSourceVersion.value || ""),
				};
				const nextOptions = this._getSanitizedNpcExportOptions({
					defenseMode: String(selDefenseMode.value || "persistent"),
				});

				sourceConfig = CharacterSheetNpcExporter.getSanitizedSourceConfig(inputConfig);
				exportOptions = nextOptions;
				iptSourceJson.value = sourceConfig.sourceJson;
				iptSourceAbv.value = sourceConfig.abbreviation;
				iptSourceFull.value = sourceConfig.full;
				iptSourceVersion.value = sourceConfig.version;
				selDefenseMode.value = exportOptions.defenseMode;

				await this._pSetNpcExportSourceConfig(sourceConfig);
				await this._pSetNpcExportOptions(exportOptions);

				monster = CharacterSheetNpcExporter.convertStateToMonster(this._state, {
					sourceJson: sourceConfig.sourceJson,
					defenseMode: exportOptions.defenseMode,
				});
				sourceMeta = CharacterSheetNpcExporter.getDefaultSourceMeta(sourceConfig);

				const rendered = Renderer.monster.getCompactRenderedString(monster, {isShowScalers: false});
				const safeName = this._escapeHtml(monster.name);
				const safeSource = this._escapeHtml(monster.source);
				const safeCr = this._escapeHtml(monster.cr);

				wrpPreviewMeta.innerHTML = `CR: <strong>${safeCr}</strong> • Source: <strong>${safeSource}</strong> • Name: <strong>${safeName}</strong>`;
				wrpPreviewStatblock.innerHTML = `<table class="w-100 stats"><tbody>${rendered}</tbody></table>`;
			};

			ee`<div>
				<div class="charsheet__export-info mb-3">
					<p class="ve-muted mb-1"><strong>Statblock Preview</strong> — Uses the standard bestiary compact format.</p>
					${wrpPreviewMeta}
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
					<div class="ve-flex-v-center mt-2" style="gap: 8px;">
						<label class="ve-muted no-shrink" style="min-width: 110px;">Defenses</label>
						${selDefenseMode}
					</div>
					<p class="ve-muted mb-0 mt-1" style="margin-left: 118px;">
						Persistent = stable baseline; Active-State = include currently toggled effects.
					</p>
				</div>
				${wrpPreviewStatblock}
			</div>`.appendTo(modalInner);

			await pApplySourceConfig();

			const btnCancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", txt: "Close", click: () => doClose(false)});

			const btnRefresh = e_({tag: "button",
				clazz: "ve-btn ve-btn-default",
				click: async () => {
					await pApplySourceConfig();
				}});
			btnRefresh.innerHTML = `<span class="glyphicon glyphicon-refresh"></span> Refresh Preview`;

			const btnDownload = e_({tag: "button",
				clazz: "ve-btn ve-btn-default",
				click: async () => {
					await pApplySourceConfig();

					const validation = CharacterSheetNpcExporter.getValidationIssues(monster);
					if (validation.errors.length || validation.warnings.length) {
						const details = this._getValidationIssueSummary(validation, {maxErrors: 2, maxWarnings: 2});
						JqueryUtil.doToast({
							type: "warning",
							content: `Downloaded with validation warnings (${validation.errors.length} error(s), ${validation.warnings.length} warning(s)). ${details}`.trim(),
						});
					}

					const filename = `${(monster.name || "npc").replace(/[^a-zA-Z0-9]/g, "_")}.json`;
					DataUtil.userDownload(
						filename,
						{_meta: {sources: [sourceMeta]}, monster: [monster]},
						{fileType: "homebrew"},
					);
					JqueryUtil.doToast({type: "success", content: `Downloaded ${filename}`});
				}});
			btnDownload.innerHTML = `<span class="glyphicon glyphicon-download"></span> Download JSON`;

			const btnSave = e_({tag: "button",
				clazz: "ve-btn ve-btn-primary",
				click: async () => {
					await pApplySourceConfig();
					await this._pSaveNpcToEditableBrew(monster, {sourceMeta});
				}});
			btnSave.innerHTML = `<span class="glyphicon glyphicon-floppy-disk"></span> Save to Homebrew`;

			ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
				${btnCancel}
				${btnRefresh}
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
		const mode = String(opts.defenseMode || "persistent").toLowerCase();
		return {
			defenseMode: mode === "active" ? "active" : "persistent",
		};
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

	async _pSaveNpcToEditableBrew (monster, {sourceMeta = null} = {}) {
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
			JqueryUtil.doToast({type: "success", content: `Saved ${toSave.name} to editable homebrew.`});
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
		printWindow.document.write(html);
		printWindow.document.close();
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
