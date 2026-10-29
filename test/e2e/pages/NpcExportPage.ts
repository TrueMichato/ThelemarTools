import fs from "node:fs/promises";
import {expect, Page} from "@playwright/test";

interface SpellRow { name: string; source: string }
interface NpcExportRuntime {
	spawn(options: {classes: Array<{name: string; source: string; level: number}>; name: string; seed: string}): Promise<{isClean: boolean; unresolved: unknown}>;
	_spellsData: SpellRow[];
	_itemsData: unknown[];
	_state: {_data: unknown; addSpell(spell: SpellRow & {sourceClass: string}, prepared: boolean): void};
	_export: {_showNpcExportDialog(): Promise<void>; _npcExportSpellIndex: object | null};
}
interface NpcDocument {
	monster: Array<{name: string; cr: string; [key: string]: unknown}>;
	fileType?: string;
	siteVersion?: string;
}
interface CrReport {
	crEstimate: {
		estimator: string;
		rounds: Array<{action: string}>;
		resources: Array<{maximum: number; spent: number; remaining: number}>;
		limitations: string[];
		breakdown: string;
	};
	fileType?: string;
	siteVersion?: string;
}

/** Focused export workflow, not another comprehensive character-build factory. */
export class NpcExportPage {
	constructor (readonly page: Page) {}

	get modal () { return this.page.getByRole("dialog", {name: /Export Character as NPC/}); }

	async open () {
		await this.page.evaluate(async () => {
			const cs: NpcExportRuntime = Reflect.get(globalThis, "charSheet");
			await cs._export._showNpcExportDialog();
		});
		await expect(this.modal.getByRole("button", {name: /Copy JSON$/})).toBeEnabled();
	}

	async close () {
		await this.modal.getByRole("button", {name: "Close", exact: true}).last().click();
		await expect(this.modal).toBeHidden();
	}

	async copyText (report = false) {
		await this.page.evaluate(() => navigator.clipboard.writeText(""));
		if (report) {
			const summary = this.modal.locator("summary").filter({hasText: /CR report/}).first();
			if (!await summary.evaluate(element => element.parentElement instanceof HTMLDetailsElement && element.parentElement.open)) await summary.click();
		}
		await this.modal.getByRole("button", {name: report ? "Copy report" : /Copy JSON$/}).click();
		await this.page.waitForFunction(isReport => navigator.clipboard.readText().then(text => text.includes(isReport ? '"crEstimate"' : '"monster"')), report);
		return this.page.evaluate(() => navigator.clipboard.readText());
	}

	async payload (): Promise<NpcDocument> { return JSON.parse(await this.copyText()); }
	async report (): Promise<CrReport> { return JSON.parse(await this.copyText(true)); }

	async verifyWorkflow () {
		const errors: string[] = [];
		this.page.on("pageerror", error => errors.push(error.message));
		await this.page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
		await this.page.goto("/charactersheet.html", {waitUntil: "domcontentloaded"});
		await this.page.waitForFunction(() => {
			const cs: NpcExportRuntime | undefined = Reflect.get(globalThis, "charSheet");
			return cs?._itemsData?.length && cs?._spellsData?.length;
		}, null, {timeout: 120_000});
		await this.page.evaluate(async () => {
			const cs: NpcExportRuntime = Reflect.get(globalThis, "charSheet");
			const result = await cs.spawn({classes: [{name: "Wizard", source: "PHB", level: 5}], name: "NPC Export Workflow", seed: "npc-export-dialog"});
			if (!result.isClean) throw new Error(JSON.stringify(result.unresolved));
			const fireball = cs._spellsData.find(row => row.name === "Fireball" && row.source === "PHB");
			if (!fireball) throw new Error("The control requires the real PHB Fireball source.");
			cs._state.addSpell({...fireball, sourceClass: "Wizard"}, true);
			const storage: {pSetForPage(key: string, value: object): Promise<void>} = Reflect.get(globalThis, "StorageUtil");
			await storage.pSetForPage("charsheet-npc-export-options", {crMode: "auto", crManual: "17"});
		});
		const before = await this.rawState();
		await this.open();
		await expect(this.modal.getByRole("combobox", {name: "CR estimator"})).toHaveValue("dmg");
		const initial = await this.payload();
		const report = await this.report();
		expect(report.crEstimate.estimator).toBe("dmg");
		expect(report.crEstimate.rounds).toHaveLength(3);
		expect(report.crEstimate.rounds.some(round => /Fireball/.test(round.action))).toBe(true);
		expect(report.crEstimate.resources.every(pool => pool.remaining >= 0 && pool.spent <= pool.maximum)).toBe(true);
		await this.modal.getByRole("combobox", {name: "CR mode"}).selectOption("manual");
		expect((await this.payload()).monster[0].cr).toBe("17");
		await this.modal.getByRole("combobox", {name: "CR estimator"}).selectOption("legacy");
		expect((await this.payload()).monster[0].cr).toBe("17");
		await expect(this.modal.getByRole("textbox", {name: "Manual CR", exact: true})).toHaveValue("17");
		await this.modal.getByRole("combobox", {name: "CR mode"}).selectOption("auto");
		const legacy = await this.payload();
		expect((await this.report()).crEstimate.estimator).toBe("legacy");
		const withoutCr = (document: NpcDocument) => document.monster.map(({cr: _cr, ...rest}) => rest);
		expect(withoutCr(legacy)).toEqual(withoutCr(initial));
		await this.close();
		await this.open();
		await expect(this.modal.getByRole("combobox", {name: "CR estimator"})).toHaveValue("legacy");
		await expect(this.modal.getByRole("textbox", {name: "Manual CR", exact: true})).toHaveValue("17");
		await this.modal.getByRole("combobox", {name: "CR estimator"}).selectOption("dmg");
		await this.modal.getByRole("combobox", {name: "Export presentation"}).selectOption("compact");
		const compact = await this.payload();
		expect(compact.monster[0].cr).toBe(initial.monster[0].cr);
		const compactReport = await this.report();
		const numericEstimate = ({limitations: _limitations, breakdown: _breakdown, ...numeric}: CrReport["crEstimate"]) => numeric;
		expect(numericEstimate(compactReport.crEstimate)).toEqual(numericEstimate(report.crEstimate));
		const payloadPromise = this.page.waitForEvent("download", {predicate: download => !download.suggestedFilename().includes("_export_report")});
		const reportPromise = this.page.waitForEvent("download", {predicate: download => download.suggestedFilename().includes("_export_report")});
		await this.modal.getByRole("button", {name: /Download JSON$/}).click();
		const payloadPath = await (await payloadPromise).path();
		const reportPath = await (await reportPromise).path();
		if (!payloadPath || !reportPath) throw new Error("Both actual downloads must be available.");
		const downloaded: NpcDocument = JSON.parse(await fs.readFile(payloadPath, "utf8"));
		const downloadedReport: CrReport = JSON.parse(await fs.readFile(reportPath, "utf8"));
		for (const document of [downloaded, downloadedReport]) {
			delete document.fileType;
			delete document.siteVersion;
		}
		expect(downloaded).toEqual(compact);
		expect(downloadedReport).toEqual(compactReport);
		await this.modal.getByRole("button", {name: /Save to Homebrew$/}).click();
		await expect.poll(() => this.page.evaluate(async () => {
			const brew: {pGetOrCreateEditableBrewDoc(): Promise<{body: NpcDocument}>} = Reflect.get(globalThis, "BrewUtil2");
			return (await brew.pGetOrCreateEditableBrewDoc()).body.monster?.[0]?.cr;
		})).toBe(compact.monster[0].cr);
		await this.page.setViewportSize({width: 390, height: 844});
		expect(await this.modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
		await this.close();
		await this.page.evaluate(() => {
			const cs: NpcExportRuntime = Reflect.get(globalThis, "charSheet");
			cs._export._npcExportSpellIndex = null;
		});
		await this.open();
		expect((await this.report()).crEstimate.limitations.join(" ")).toMatch(/Spell-threat data unavailable/);
		await expect(this.modal).toContainText("limitations");
		expect(await this.rawState()).toBe(before);
		expect(errors).toEqual([]);
		await this.close();
	}

	private rawState () {
		return this.page.evaluate(() => {
			const cs: NpcExportRuntime = Reflect.get(globalThis, "charSheet");
			return JSON.stringify(cs._state._data);
		});
	}
}
