import {expect, type Page} from "@playwright/test";

export class CreatureTransformationPage {
	constructor (readonly page: Page) {}

	get root () { return this.page.locator(".bqa__transformation:visible"); }

	templateChoice (id: string) {
		return this.root.locator(`.bqa__transformation-choice[data-recipe-id="${id}"]`);
	}

	recipeInfo (id: string) {
		return this.templateChoice(id).locator("..").locator(".bqa__transformation-info");
	}

	optionInfo (group: string, value: string) {
		return this.optionControl(group, value).locator("..").locator("..").locator(".bqa__transformation-info");
	}

	selectedRecipeInfo () {
		return this.root.locator(".bqa__transformation-selected .bqa__transformation-info");
	}

	optionByName (group: string, name: string) {
		return this.root.getByRole("group", {name: new RegExp(`^${group}(?: \\(required\\))?$`)})
			.locator(".bqa__transformation-option", {hasText: name}).locator("input");
	}

	get beforeStatblock () { return this.root.locator(".bqa__transformation-statblock").first(); }
	get afterStatblock () { return this.root.locator(".bqa__transformation-statblock").nth(1); }

	async deltaLayout () {
		return this.root.locator(".bqa__transformation-config").evaluate(node => {
			const delta = node.querySelector(".bqa__transformation-delta");
			if (!delta) throw new Error("Selected recipe has no mechanical delta.");
			return {
				isFullWidth: node.classList.contains("bqa__transformation-config--no-options"),
				widthRatio: delta.getBoundingClientRect().width / node.getBoundingClientRect().width,
				fontSize: parseFloat(getComputedStyle(delta.querySelector("li") || delta).fontSize),
			};
		});
	}

	get nativeHover () {
		return this.page.locator(".ve-hwin:visible").last();
	}

	async dismissNativeHover () {
		await this.page.mouse.move(0, 0);
		for (let ix = 0; ix < 5 && await this.page.locator(".ve-hwin:visible").count(); ix++) {
			await this.nativeHover.locator('[title="Close (CTRL to Close All)"]').click();
			await this.page.mouse.move(0, 0);
		}
		await expect(this.page.locator(".ve-hwin:visible")).toHaveCount(0);
	}

	optionControl (group: string, value: string) {
		return this.root.getByRole("group", {name: new RegExp(`^${group}(?: \\(required\\))?$`)})
			.locator(`.bqa__transformation-option input[value="${value}"]`);
	}

	async textContrast (foregroundSelector: string, backgroundSelector: string) {
		return this.root.locator(foregroundSelector).first().evaluate((node, selector) => {
			const foreground = getComputedStyle(node).color;
			const surface = node.closest(selector);
			if (!surface) throw new Error(`No background surface for ${selector}`);
			const background = getComputedStyle(surface).backgroundColor;
			const luminance = (color: string) => {
				const channels = color.match(/\d+/g)!.slice(0, 3).map(value => {
					const channel = Number(value) / 255;
					return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
				});
				return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
			};
			const a = luminance(foreground);
			const b = luminance(background);
			return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
		}, backgroundSelector);
	}

	async templateContrast (id: string) {
		return this.templateChoice(id).evaluate(node => {
			const background = getComputedStyle(node).backgroundColor;
			const luminance = (value: string) => {
				const channels = value.match(/\d+/g)!.slice(0, 3).map(channel => {
					const normalized = Number(channel) / 255;
					return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
				});
				return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
			};
			const base = luminance(background);
			return ["name", "meta"].map(part => {
				const foreground = luminance(getComputedStyle(node.querySelector(`.bqa__transformation-choice-${part}`)!).color);
				return (Math.max(base, foreground) + 0.05) / (Math.min(base, foreground) + 0.05);
			});
		});
	}

	async expectLongTemplateTitleFits (id: string) {
		const choice = this.templateChoice(id);
		const fits = await choice.evaluate(node => {
			const name = node.querySelector(".bqa__transformation-choice-name");
			if (!name) return false;
			name.textContent = "The Ancient Shadow Dragon of the SupercalifragilisticexpialidociousMountainPass";
			return node.scrollWidth <= node.clientWidth + 1 && name.scrollWidth <= name.clientWidth + 1;
		});
		expect(fits).toBe(true);
	}

	async choose (id: string) {
		await this.chooseCategory(id.startsWith("race:") ? "Species" : "Templates");
		await this.root.getByRole("combobox", {name: "Creature transformation"}).selectOption(id);
	}

	async chooseCategory (category: "Species" | "Templates") {
		await this.categoryButton(category).press("Enter");
	}

	async selectSource (source: string) {
		await this.root.getByRole("combobox", {name: "Source book"}).selectOption(source);
	}

	async search (term: string) {
		await this.root.getByRole("searchbox", {name: "Find a template or species"}).fill(term);
	}

	async installHomebrew (brew: object) {
		await this.page.route("**/__transformation-test-brew.json", route => route.fulfill({
			contentType: "application/json",
			body: JSON.stringify(brew),
		}));
		await this.page.evaluate(async () => {
			const {BrewUtil2} = globalThis as typeof globalThis & {BrewUtil2: {pAddBrewFromUrl: (url: string) => Promise<unknown>}};
			await BrewUtil2.pAddBrewFromUrl("/__transformation-test-brew.json");
		});
	}

	async useNightMode () {
		await this.page.evaluate(() => {
			document.documentElement.classList.add("ve-night-mode", "ve-night-mode--standard");
		});
	}

	async injectRepeatedRaceDefinitions () {
		await this.page.evaluate(() => {
			const raceUtil = (globalThis as typeof globalThis & {DataUtil: {race: {loadBrew: (...args: unknown[]) => Promise<{race?: object[]}>}}}).DataUtil.race;
			const loadBrew = raceUtil.loadBrew.bind(raceUtil);
			raceUtil.loadBrew = async (...args) => {
				const loaded = await loadBrew(...args);
				const gnoll = {name: "Gnoll", source: "FoEQuickstone", page: 23, resist: ["fire"]};
				return {...loaded, race: [...(loaded.race || []), gnoll, {...gnoll}, {...gnoll, resist: ["cold"]}]};
			};
		});
	}

	async pauseCatalogReload () {
		await this.page.evaluate(() => {
			const raceUtil = (globalThis as typeof globalThis & {DataUtil: {race: {loadBrew: (...args: unknown[]) => Promise<unknown>}}}).DataUtil.race;
			const loadBrew = raceUtil.loadBrew.bind(raceUtil);
			let release: () => void = () => {};
			const gate = new Promise<void>(resolve => { release = resolve; });
			raceUtil.loadBrew = async (...args) => {
				await gate;
				return loadBrew(...args);
			};
			(globalThis as typeof globalThis & {releaseTransformationCatalogReload?: () => void}).releaseTransformationCatalogReload = () => {
				raceUtil.loadBrew = loadBrew;
				release();
			};
		});
	}

	async resumeCatalogReload () {
		await this.page.evaluate(() => {
			const globals = globalThis as typeof globalThis & {releaseTransformationCatalogReload?: () => void};
			globals.releaseTransformationCatalogReload?.();
			delete globals.releaseTransformationCatalogReload;
		});
	}

	categoryButton (category: "Species" | "Templates") {
		return this.root.getByRole("group", {name: "Browse recipes"}).getByRole("button", {name: new RegExp(`^${category} \\(`)});
	}

	async categoryColors (category: "Species" | "Templates") {
		return this.categoryButton(category).evaluate(node => {
			const style = getComputedStyle(node);
			return {background: style.backgroundColor, foreground: style.color};
		});
	}

	async expectReadableDiscoveryLabels () {
		for (const selector of [
			".bqa__transformation-category legend",
			".bqa__transformation-input .bqa__field-label",
			".bqa__transformation-count",
		]) await expect(this.root.locator(selector).first()).toHaveCSS("font-size", "12px");
	}

	async chooseOption (group: string, value: string) {
		await this.optionControl(group, value).check();
	}

	async expectLivePreview ({targets = 1}: {targets?: number} = {}) {
		await expect(this.root.locator(".bqa__transformation-target")).toHaveCount(targets);
		await expect(this.root.locator(".bqa__transformation-statblock")).toHaveCount(targets * 2);
		await expect(this.root.locator(".bqa__transformation-delta")).toBeVisible();
		await expect(this.root.getByRole("button", {name: /Preview (transformation|selected monsters)/})).toHaveCount(0);
	}

	async pickIncomingWinners () {
		const selectors = this.root.locator(".bqa__transformation-target select[data-conflict-id]");
		const count = await selectors.count();
		expect(count).toBeGreaterThan(0);
		for (let ix = 0; ix < count; ix++) await selectors.nth(ix).selectOption("incoming");
	}

	async apply ({bulk = false, count = 1}: {bulk?: boolean, count?: number} = {}) {
		const apply = this.root.getByRole("button", {name: bulk ? `Apply to ${count} · one save` : "Apply transformation"});
		const confirmation = this.root.getByRole("group", {name: "Confirm before applying"});
		if (await confirmation.isHidden()) await apply.click();
		if (await confirmation.isVisible()) {
			const checks = confirmation.getByRole("checkbox", {includeHidden: false});
			for (let ix = 0; ix < await checks.count(); ix++) await checks.nth(ix).check();
			await apply.click();
		}
		if (bulk) await expect(this.page.locator("#ew-status")).toContainText("Saved statblock edits");
	}

	async requestConfirmation () {
		await this.root.getByRole("button", {name: "Apply transformation"}).click();
		await expect(this.root.getByRole("group", {name: "Confirm before applying"})).toBeVisible();
	}

	async confirmPrerequisites () {
		const checks = this.root.getByRole("group", {name: "Confirm before applying"}).getByRole("checkbox", {includeHidden: false});
		for (let ix = 0; ix < await checks.count(); ix++) await checks.nth(ix).check();
	}

	async savedEncounter () {
		return this.page.evaluate(async () => {
			const {StorageUtil} = globalThis as typeof globalThis & {
				StorageUtil: {pGetForPage: (key: string, options: {page: string}) => Promise<unknown>},
			};
			return StorageUtil.pGetForPage("encounterWorkspaceState", {page: "encounterworkspace.html"});
		});
	}

	async failEncounterWrites () {
		await this.page.evaluate(() => {
			const {StorageUtil} = globalThis as typeof globalThis & {
				StorageUtil: {pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>},
			};
			const save = StorageUtil.pSetForPage.bind(StorageUtil);
			StorageUtil.pSetForPage = async (key, value, options) => {
				if (key === "encounterWorkspaceState") throw new Error("Simulated storage failure");
				return save(key, value, options);
			};
		});
	}

	async monitorOperationCreation () {
		await this.page.evaluate(async () => {
			const moduleUrl = "/js/bestiary/bestiary-quick-actions-engine.js";
			const {BestiaryQuickActionsUtil} = await import(moduleUrl);
			const original = BestiaryQuickActionsUtil.createCreatureTransformationOperation;
			const globals = globalThis as typeof globalThis & {transformationOperationsCreated?: number};
			globals.transformationOperationsCreated = 0;
			BestiaryQuickActionsUtil.createCreatureTransformationOperation = function (...args) {
				globals.transformationOperationsCreated!++;
				return original.apply(this, args);
			};
		});
	}

	async createdOperations () {
		return this.page.evaluate(() => (globalThis as typeof globalThis & {transformationOperationsCreated?: number}).transformationOperationsCreated);
	}
}

import type {CDPSession, Locator, TestInfo} from "@playwright/test";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

type Round72Creature = {
	name: string; source: string; str: number; con: number; wis: number;
	hp: {average: number; formula?: string}; cr: string | {cr: string; xp: number};
	profBonus?: number; type: unknown; action?: {name: string; entries: string[]}[];
};
type Round72Operation = {
	id: string; type: string;
	data: {integrity?: string; resolved?: {
		identity: {name: string; source: string};
		frozenForms?: {activeForm: string; profiles: {id: string; label: string}[]};
		changes: {type: string; receipt?: {estimatedCr: string; damagePerRound: number; proficiency: {before: number; after: number}}}[];
	}};
};
type Round72State = {
	instances: {id: string; monster: Round72Creature; statblockOperations: Round72Operation[]; hp: {current: number; max: number; temp: number}}[];
	groups: {id: string; memberIds: string[]; sharedTurn: boolean; initiative: number | null}[];
	turn: {round: number; activeId: string | null};
};
type Round72Consumer = {
	getCreature: (args: {monster: Round72Creature}) => Round72Creature;
	getOperations: (args: {monster: Round72Creature}) => Round72Operation[];
	applyChanges: (args: object) => unknown;
	subscribe: (callback: () => void) => () => void;
};
type Round72Controller = {
	_state: Round72State; _hpUndo: unknown[];
	_pOpenStatblockEditor: (id: string, options?: {automationVersion?: number}) => Promise<void>;
	_pRenderBulkChoices: (options?: {automationVersion?: number}) => Promise<void>;
};
type Round72Probe = {
	staged: boolean; controller?: Round72Controller; consumer?: Round72Consumer; monster?: Round72Creature;
	calls: number; notifications: number; saves: number; writes: number; failNext: boolean;
	proposals: object[]; savedStates: Round72State[]; forbidden: string[];
	gateEntered: boolean; release?: () => void;
};
type Round72Globals = typeof globalThis & {
	__round72: Round72Probe;
	DataUtil: {
		loadJSON: (url: string) => Promise<{monster: Round72Creature[]; cr: object[]}>;
		race: {loadJSON: (...args: unknown[]) => Promise<unknown>; loadPrerelease: (...args: unknown[]) => Promise<unknown>; loadBrew: (...args: unknown[]) => Promise<unknown>};
	};
	StorageUtil: {pSetForPage: (key: string, value: unknown, options: {page: string}) => Promise<void>};
};
type Round72CoverageReport = {
	timestamp: number;
	result: {scriptId: string; url: string; functions: {
		functionName: string; isBlockCoverage: boolean; ranges: {startOffset: number; endOffset: number; count: number}[];
	}[]}[];
};
type Round72DiagnosticGlobals = typeof globalThis & {
	__round72CoverageDiagnostic?: {snapshot: () => object};
	__round72KeyboardDiagnostic?: {snapshot: (label: string) => object; stop: () => object};
	__round72EntryObserver?: {
		epoch: number; timeOrigin: number; phase: "calibration" | "protected"; counts: Record<string, number>;
		functions: unknown[]; referencesCurrent: () => boolean;
	};
};

/** Internal-v2 mounting and observation only; all edits still use the real native consumers. */
export class Round72CreatureTransformationPage extends CreatureTransformationPage {
	private readonly served = new Map<string, string>();
	private readonly bomRemoved = new Map<string, string>();
	private readonly loaded = new Map<string, {rawSha256: string; loadedSha256: string; representation: "raw" | "utf8-bom-removed" | "mismatch"}>();
	private readonly responses: Promise<void>[] = [];
	private readonly provenanceErrors: string[] = [];
	private readonly errors: string[] = [];
	private readonly compilation: {epoch: number; url: string; functionName: string; count: number}[] = [];
	private responsesSettled = false;
	private evidenceComplete = false;
	private coverage?: CDPSession;
	private diagnosticInfo?: TestInfo;
	private coveragePending = false;
	private readonly coverageIntervals: {epoch: number; events: object[]}[] = [];
	private readonly diagnosticErrors: string[] = [];
	private keyboardEpoch = 0;
	private keyboardActive = false;
	private focusChecks = 0;
	private entriesCalibrated = false;
	private readonly entryBreakpoints: string[] = [];
	private readonly entryTargets = [
		{url: "/js/creature-transformations.js", name: "pLoadCreatureTransformationCandidates"},
		{url: "/js/creature-transformations.js", name: "compileCreatureTransformation"},
		{url: "/js/creature-transformation-stats.js", name: "compileCreatureTransformationStats"},
		{url: "/js/bestiary/bestiary-transformation-inputs.js", name: "compileCreatureTransformationInputs"},
		{url: "/js/creature-transformation-cr.js", name: "estimateCreatureTransformationCr"},
	];
	private readonly assets = [
		"bestiary.html", "encounterworkspace.html",
		"js/bestiary/bestiary-transformation-editor.js", "js/bestiary/bestiary-quick-actions-ui.js",
		"js/bestiary/bestiary-transformation-workflow.js", "js/bestiary/bestiary-transformation-inputs.js",
		"js/bestiary/bestiary-transformation-catalog-adapter.js", "js/bestiary/bestiary-quick-actions-engine.js",
		"js/creature-transformations.js", "js/creature-transformation-forms.js", "js/creature-transformation-stats.js", "js/creature-transformation-cr.js",
		"js/encounterworkspace.js", "js/encounterworkspace/encounterworkspace-quick-actions.js", "js/encounterworkspace/encounterworkspace-state.js",
		"js/render.js", "data/creature-transformations.json", "data/msbcr.json", "css/bestiary.css", "css/encounterworkspace.css",
	];

	async beginRound72Evidence (info: TestInfo) {
		this.diagnosticInfo = info;
		expect(info.project.name).toBe("chromium");
		expect(info.config.workers).toBeLessThanOrEqual(2);
		expect(info.project.retries).toBe(0);
		expect(process.env.PW_PORT, "Release must supply a freshly checked-free port").toMatch(/^\d+$/);
		expect(new URL(String(info.project.use.baseURL)).port).toBe(process.env.PW_PORT);
		for (const path of this.assets) {
			const local = await readFile(resolve(process.cwd(), path));
			const response = await this.page.request.get(`/${path}`);
			expect(response.ok(), path).toBe(true);
			const hash = createHash("sha256").update(local).digest("hex");
			expect(createHash("sha256").update(await response.body()).digest("hex"), `Served worktree bytes: ${path}`).toBe(hash);
			this.served.set(path, hash);
			if (local[0] === 0xef && local[1] === 0xbb && local[2] === 0xbf) {
				this.bomRemoved.set(path, createHash("sha256").update(local.subarray(3)).digest("hex"));
			}
		}
		this.page.on("pageerror", error => this.errors.push(error.message));
		this.page.on("response", response => {
			const path = new URL(response.url()).pathname.slice(1);
			if (!this.served.has(path)) return;
			this.responsesSettled = false;
			this.responses.push(response.body().then(body => {
				const hash = createHash("sha256").update(body).digest("hex");
				const rawSha256 = this.served.get(path)!;
				const representation = hash === rawSha256 ? "raw" : hash === this.bomRemoved.get(path) ? "utf8-bom-removed" : "mismatch";
				this.loaded.set(response.url(), {rawSha256, loadedSha256: hash, representation});
				if (representation === "mismatch") this.provenanceErrors.push(`Unexpected loaded bytes: ${response.url()} (${hash})`);
			}).catch(error => { this.provenanceErrors.push(`Cannot read loaded response ${response.url()}: ${String(error)}`); }));
		});
	}

	private async settleRound72Responses () {
		if (this.responsesSettled) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const settled = await Promise.race([
				(async () => {
					let count: number;
					do { count = this.responses.length; await Promise.all(this.responses.slice(0, count)); } while (count !== this.responses.length);
					return true;
				})(),
				new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 5000); }),
			]);
			this.responsesSettled = settled;
			if (!settled) this.provenanceErrors.push("Loaded response bodies did not settle within 5000ms.");
		} finally { clearTimeout(timer); }
	}

	async finishRound72Evidence (info: TestInfo, label: string) {
		await this.settleRound72Responses();
		for (const path of [
			"js/bestiary/bestiary-transformation-editor.js", "js/bestiary/bestiary-quick-actions-ui.js",
			"js/bestiary/bestiary-transformation-workflow.js", "js/bestiary/bestiary-transformation-inputs.js", "js/render.js",
			new URL(this.page.url()).pathname.slice(1),
			this.page.url().includes("/encounterworkspace.html") ? "css/encounterworkspace.css" : "css/bestiary.css",
			"data/creature-transformations.json", "data/msbcr.json",
		]) expect([...this.loaded.keys()].some(url => new URL(url).pathname === `/${path}`), `Loaded real ${path}`).toBe(true);
		expect(this.provenanceErrors, "Loaded bytes allow only raw bytes or removal of the local leading UTF-8 BOM").toEqual([]);
		expect(this.errors).toEqual([]);
		this.evidenceComplete = true;
		await this.page.screenshot({path: info.outputPath(`${label}.png`), fullPage: true});
	}

	async captureRound72Evidence (info: TestInfo) {
		try {
			await this.settleRound72Responses();
			await info.attach("round72-provenance", {body: JSON.stringify({
				completion: this.evidenceComplete ? "complete" : "partial-not-accepted",
				testStatus: info.status, primaryErrors: info.errors.map(error => error.message),
				internalMount: "Explicit internal automationVersion 2 only; default remains 1",
				servedRaw: Object.fromEntries(this.served), localBomRemoved: Object.fromEntries(this.bomRemoved),
				loaded: Object.fromEntries(this.loaded), responseCount: this.responses.length, responsesSettled: this.responsesSettled,
				provenanceErrors: this.provenanceErrors, pageErrors: this.errors,
				compilation: {status: this.compilation.length ? "calibrated-entry-observations" : "not-collected-not-zero", observations: this.compilation},
			}, null, 2), contentType: "application/json"});
			let consumer: object;
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				consumer = await Promise.race([
					(async () => {
						if (this.page.isClosed()) return {status: "page-closed-not-observed"};
						if (!await this.page.evaluate(() => "__round72" in globalThis)) return {status: "probe-not-installed-not-observed"};
						return {status: "observed", documentUrl: this.page.url(), snapshot: await this.round72Snapshot()};
					})(),
					new Promise<object>(resolve => { timer = setTimeout(() => resolve({status: "capture-timeout-not-observed"}), 5000); }),
				]);
			} catch (error) { consumer = {status: "capture-failed-not-observed", error: String(error)}; }
			finally { clearTimeout(timer); }
			await info.attach("round72-actual-consumer", {body: JSON.stringify(consumer, null, 2), contentType: "application/json"});
			if (info.status === "passed") {
				expect(this.evidenceComplete).toBe(true);
				expect(this.provenanceErrors).toEqual([]);
				expect(this.errors).toEqual([]);
				expect(consumer).toHaveProperty("status", "observed");
			}
		} catch (error) {
			if (info.status === "passed") throw error;
			console.error(`Round72 evidence capture failed; preserving primary ${info.status}: ${String(error)}`);
		} finally {
			await this.captureRound72Diagnostics(info);
		}
	}

	private async boundedRound72Diagnostic<T> (label: string, run: () => Promise<T>) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([run(), new Promise<T>((_, reject) => {
				timer = setTimeout(() => reject(new Error(`${label}: diagnostic capture exceeded 2000ms`)), 2000);
			})]);
		} finally { clearTimeout(timer); }
	}

	private async round72CoverageContext (install = false) {
		return this.page.evaluate(async install => {
			const globals = globalThis as Round72DiagnosticGlobals;
			if (install) {
				const urls = ["/js/creature-transformations.js", "/js/creature-transformation-stats.js",
					"/js/bestiary/bestiary-transformation-inputs.js", "/js/creature-transformation-cr.js"];
				const namespaces = await Promise.all(urls.map(url => import(url)));
				const identities = new WeakMap<object, number>();
				let next = 0;
				const identity = (value: object) => {
					if (!identities.has(value)) identities.set(value, ++next);
					return identities.get(value);
				};
				globals.__round72CoverageDiagnostic = {snapshot: () => ({
					document: {url: location.href, timeOrigin: performance.timeOrigin, now: performance.now(), readyState: document.readyState},
					modules: namespaces.map((namespace, index) => ({
						url: new URL(urls[index], location.href).href, namespaceIdentity: identity(namespace),
						exports: Object.entries(namespace).map(([name, value]) => ({
							name, type: typeof value, identity: typeof value === "function" ? identity(value) : null,
							functionName: typeof value === "function" ? value.name : null,
							arity: typeof value === "function" ? value.length : null,
						})),
					})),
				})};
			}
			return globals.__round72CoverageDiagnostic?.snapshot() || {
				status: "document-changed-or-uninstalled-not-observed", url: location.href, timeOrigin: performance.timeOrigin,
			};
		}, install);
	}

	private async collectRound72Coverage (label: string) {
		const interval = this.coverageIntervals.at(-1)!;
		const requestedAt = new Date().toISOString();
		this.coveragePending = false;
		interval.events.push({label: `${label}-collection-request`, requestedAt});
		const report: Round72CoverageReport = await this.boundedRound72Diagnostic("takePreciseCoverage", () => this.coverage!.send("Profiler.takePreciseCoverage"));
		interval.events.push({label, requestedAt, receivedAt: new Date().toISOString(), raw: report});
		await this.diagnosticInfo!.attach(`round72-v8-${interval.epoch}-${label}-raw`, {
			body: JSON.stringify(report), contentType: "application/json",
		});
		try {
			interval.events.push({label: `${label}-document-and-export-identities`, context: await this.boundedRound72Diagnostic("coverage context", () => this.round72CoverageContext())});
		} catch (error) { this.diagnosticErrors.push(`Coverage context after ${label}: ${String(error)}`); }
		return report;
	}

	private async installRound72EntryObserver () {
		const epoch = this.coverageIntervals.at(-1)!.epoch;
		this.entriesCalibrated = false;
		await this.coverage!.send("Debugger.enable");
		await this.page.evaluate(async ({targets, epoch}) => {
			const namespaces = await Promise.all(targets.map(target => import(target.url)));
			const functions = targets.map((target, index) => namespaces[index][target.name]);
			if (functions.some(fn => typeof fn !== "function")) throw new Error("Actual production entry unavailable; call counts UNKNOWN.");
			(globalThis as Round72DiagnosticGlobals).__round72EntryObserver = {
				epoch, timeOrigin: performance.timeOrigin, phase: "calibration",
				counts: Object.fromEntries(targets.map(target => [target.name, 0])), functions,
				referencesCurrent: () => targets.every((target, index) => namespaces[index][target.name] === functions[index]),
			};
		}, {targets: this.entryTargets, epoch});
		for (const [index, target] of this.entryTargets.entries()) {
			const remote = await this.coverage!.send("Runtime.evaluate", {
				expression: `globalThis.__round72EntryObserver.functions[${index}]`, objectGroup: "round72-entries",
			});
			if (remote.exceptionDetails || remote.result.type !== "function" || !remote.result.objectId) throw new Error(`Cannot observe actual ${target.name}; call counts UNKNOWN.`);
			// A false conditional breakpoint records the actual entry without pausing or wrapping it.
			const installed = await this.coverage!.send("Debugger.setBreakpointOnFunctionCall", {
				objectId: remote.result.objectId,
				condition: `(globalThis.__round72EntryObserver.counts[${JSON.stringify(target.name)}] += 1, false)`,
			});
			this.entryBreakpoints.push(installed.breakpointId);
			this.coverageIntervals.at(-1)!.events.push({label: "actual-entry-breakpoint", ...target, objectId: remote.result.objectId, ...installed});
		}
		const before = await this.round72Snapshot();
		const calibration = await this.page.evaluate(async () => {
			const probe = (globalThis as Round72DiagnosticGlobals).__round72EntryObserver!;
			const [compiler, stats, inputs, cr] = await Promise.all([
				import("/js/creature-transformations.js"), import("/js/creature-transformation-stats.js"),
				import("/js/bestiary/bestiary-transformation-inputs.js"), import("/js/creature-transformation-cr.js"),
			]);
			const checks: {name: string; before: number; after: number}[] = [];
			let count = probe.counts.pLoadCreatureTransformationCandidates;
			const candidates = await compiler.pLoadCreatureTransformationCandidates();
			checks.push({name: "pLoadCreatureTransformationCandidates", before: count, after: probe.counts.pLoadCreatureTransformationCandidates});
			const current = {name: "Disposable kernel-only entry calibration", source: "MM", type: "humanoid", size: ["M"],
				str: 15, dex: 12, con: 12, int: 10, wis: 10, cha: 8, profBonus: 2, cr: "1", ac: [13], hp: {average: 33, formula: "6d8 + 6"}};
			const resolved = compiler.resolveCreatureTransformation({candidates, id: "catalog:zombie|dmg", automationVersion: 2});
			count = probe.counts.compileCreatureTransformation;
			compiler.compileCreatureTransformation({resolved, current});
			checks.push({name: "compileCreatureTransformation", before: count, after: probe.counts.compileCreatureTransformation});
			count = probe.counts.compileCreatureTransformationStats;
			stats.compileCreatureTransformationStats({current, abilities: {con: 14}});
			checks.push({name: "compileCreatureTransformationStats", before: count, after: probe.counts.compileCreatureTransformationStats});
			const target = {id: "calibration-only", label: current.name, baseCreature: current, operations: []};
			const model = inputs.inspectCreatureTransformationInputs({target, resolved});
			const answers = {targetKey: model.targetKey, controls: Object.fromEntries(model.controls.filter((control: {kind: string}) => control.kind === "armor")
				.map((control: {id: string}) => [control.id, {mode: "retain", reason: "Disposable entry calibration only."}]))};
			count = probe.counts.compileCreatureTransformationInputs;
			const composed = inputs.compileCreatureTransformationInputs({target, resolved, answers});
			checks.push({name: "compileCreatureTransformationInputs", before: count, after: probe.counts.compileCreatureTransformationInputs});
			const table = await inputs.pLoadCreatureTransformationInputTable({requested: true});
			count = probe.counts.estimateCreatureTransformationCr;
			cr.estimateCreatureTransformationCr({current, table, assumptions: {
				defense: {expectedCr: "1", hpBoundary: null, acIndex: 0, acAdjustment: 0, hpAdjustment: 0,
					resistance: "none", vulnerability: false, regeneration: 0, note: "Disposable entry calibration."},
				routines: [{id: "calibration", rounds: [8, 8, 8].map(value => ({value, proficiency: 0})),
					accuracy: {kind: "attack", value: 4, proficiency: 1}, note: "Disposable entry calibration."}],
				routine: "calibration", review: "Disposable entry calibration only.", override: {cr: "2", reason: "Calibration only."},
				zeroXp: false, proficiencyAnswer: null,
			}});
			checks.push({name: "estimateCreatureTransformationCr", before: count, after: probe.counts.estimateCreatureTransformationCr});
			return {epoch: probe.epoch, timeOrigin: probe.timeOrigin, checks, counts: {...probe.counts}, inputStatus: composed.status};
		});
		this.coverageIntervals.at(-1)!.events.push({label: "disposable-positive-calibration", calibration});
		await this.diagnosticInfo!.attach(`round72-entry-calibration-${epoch}`, {body: JSON.stringify(calibration), contentType: "application/json"});
		await this.collectRound72Coverage("positive-calibration-before-protected-reset");
		expect(calibration.inputStatus).toBe("ready");
		for (const target of this.entryTargets) {
			const check = calibration.checks.find(check => check.name === target.name);
			if (!check) throw new Error(`Positive control missing for ${target.name}; compilation UNKNOWN.`);
			expect(check.after, `The actual ${target.name} entry must detect its own deliberate call`).toBeGreaterThan(check.before);
		}
		expect(await this.round72Snapshot(), "Calibration must not change the saved owner, consumers or Store").toEqual(before);
		this.entriesCalibrated = true;
	}

	private async captureRound72EntryCounts (label: string) {
		const snapshot = await this.boundedRound72Diagnostic("actual entry counters", () => this.page.evaluate(() => {
			const probe = (globalThis as Round72DiagnosticGlobals).__round72EntryObserver;
			if (!probe) return {status: "not-observed" as const, documentUrl: location.href};
			return {status: "observed" as const, epoch: probe.epoch, phase: probe.phase, timeOrigin: performance.timeOrigin,
				sameDocument: probe.timeOrigin === performance.timeOrigin, referencesCurrent: probe.referencesCurrent(),
				counts: {...probe.counts}, documentUrl: location.href};
		}));
		this.coverageIntervals.at(-1)!.events.push({label, snapshot});
		await this.diagnosticInfo!.attach(`round72-entry-${this.coverageIntervals.at(-1)!.epoch}-${label}`, {body: JSON.stringify(snapshot), contentType: "application/json"});
		return snapshot;
	}

	private async closeRound72Coverage () {
		const session = this.coverage;
		if (!session) return;
		this.coverage = undefined;
		const steps: [string, () => Promise<unknown>][] = [
			...this.entryBreakpoints.splice(0).map<[string, () => Promise<unknown>]>(id => [`removeBreakpoint ${id}`, () => session.send("Debugger.removeBreakpoint", {breakpointId: id})]),
			["release entry objects", () => session.send("Runtime.releaseObjectGroup", {objectGroup: "round72-entries"})],
			["disable entry debugger", () => session.send("Debugger.disable")],
			["stopPreciseCoverage", () => session.send("Profiler.stopPreciseCoverage")],
			["detach", () => session.detach()],
		];
		for (const [label, run] of steps) {
			try {
				await this.boundedRound72Diagnostic(label, run);
				this.coverageIntervals.at(-1)!.events.push({label, completedAt: new Date().toISOString()});
			} catch (error) { this.diagnosticErrors.push(`Coverage cleanup ${label}: ${String(error)}`); }
		}
	}

	private async captureRound72Diagnostics (info: TestInfo) {
		try {
			if (this.keyboardActive) await this.captureRound72Keyboard("failure-or-completion-teardown", true);
			if (this.entryBreakpoints.length) {
				try { await this.captureRound72EntryCounts("failure-or-completion-teardown"); }
				catch (error) { this.diagnosticErrors.push(`Actual entry counters unavailable: ${String(error)}`); }
			}
			if (this.coverage && this.coveragePending) {
				try { await this.collectRound72Coverage("teardown-partial-interval"); }
				catch (error) { this.diagnosticErrors.push(`Teardown raw coverage unavailable: ${String(error)}`); }
			}
		} finally {
			await this.closeRound72Coverage();
			try {
				await info.attach("round72-diagnostic-status", {body: JSON.stringify({
					status: "diagnostics-only-not-feature-acceptance", testStatus: info.status,
					primaryErrors: info.errors.map(error => error.message),
					coverageIntervals: this.coverageIntervals, keyboardIntervals: this.keyboardEpoch, errors: this.diagnosticErrors,
					limits: "Raw V8 record absence is not zero. Actual-entry counts require each positive calibration, current references and the protected epoch; otherwise UNKNOWN.",
				}, null, 2), contentType: "application/json"});
			} catch (error) {
				if (info.status === "passed") throw error;
				console.error(`Round72 diagnostic attachment failed; preserving primary ${info.status}: ${String(error)}`);
			}
			if (this.diagnosticErrors.length) {
				console.error(`Round72 diagnostic limitations: ${this.diagnosticErrors.join("; ")}`);
				if (info.status === "passed") throw new Error(this.diagnosticErrors.join("; "));
			}
		}
	}

	private async beginRound72Keyboard (picker: Locator, width: number) {
		if (this.keyboardActive) await this.captureRound72Keyboard("before-next-keyboard-interval", true);
		const epoch = ++this.keyboardEpoch;
		this.keyboardActive = true;
		await picker.evaluate((node, {epoch, width}) => {
			if (!(node instanceof HTMLSelectElement)) throw new Error("Keyboard diagnostic requires the actual native select.");
			const globals = globalThis as Round72DiagnosticGlobals;
			const identities = new WeakMap<object, number>();
			let next = 0;
			const describe = (target: EventTarget | null): object | null => {
				if (!target) return null;
				if (!identities.has(target)) identities.set(target, ++next);
				return {identity: identities.get(target), name: target instanceof Node ? target.nodeName : "window",
					...target instanceof Element ? {id: target.id, class: target.className, connected: target.isConnected} : {},
					...target instanceof HTMLOptionElement ? {value: target.value, text: target.text, selected: target.selected, disabled: target.disabled} : {}};
			};
			const selectState = (select: HTMLSelectElement | null) => select && ({
				element: describe(select), value: select.value, selectedIndex: select.selectedIndex, disabled: select.disabled,
				popupOpen: CSS.supports("selector(:open)") ? select.matches(":open") : null,
				bounds: select.getBoundingClientRect().toJSON(),
				options: [...select.options].map(option => ({element: describe(option), value: option.value, text: option.text,
					selected: option.selected, defaultSelected: option.defaultSelected, disabled: option.disabled})),
			});
			const snapshot = () => ({
				now: performance.now(), original: selectState(node),
				current: selectState(document.querySelector<HTMLSelectElement>(".bqa__transformation-form-controls select")),
				activeElement: describe(document.activeElement), focusedOriginal: document.activeElement === node,
				viewport: {width: innerWidth, height: innerHeight, scrollX, scrollY, visual: window.visualViewport && {
					width: visualViewport!.width, height: visualViewport!.height, offsetLeft: visualViewport!.offsetLeft, offsetTop: visualViewport!.offsetTop,
				}},
				ancestors: ancestors.filter((target): target is Element => target instanceof Element).map(element => ({
					element: describe(element), scrollTop: element.scrollTop, scrollLeft: element.scrollLeft,
					scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, scrollWidth: element.scrollWidth,
					clientWidth: element.clientWidth, bounds: element.getBoundingClientRect().toJSON(),
				})),
			});
			const ancestors: EventTarget[] = [node];
			for (let parent = node.parentElement; parent; parent = parent.parentElement) ancestors.push(parent);
			ancestors.push(document, window);
			const events: object[] = [], mutations: object[] = [], checkpoints: object[] = [];
			let droppedEvents = 0, droppedMutations = 0;
			const listeners: {target: EventTarget; type: string; listener: EventListener; capture: boolean}[] = [];
			for (const target of ancestors) for (const capture of [true, false]) {
				for (const type of ["keydown", "keypress", "keyup", "beforeinput", "input", "change", "focus", "blur", "focusin", "focusout"]) {
					const listener: EventListener = event => {
						if (events.length >= 2000) { droppedEvents++; return; }
						events.push({type: event.type, phase: event.eventPhase, capture, target: describe(event.target), targetIsOriginal: event.target === node,
							currentTarget: describe(event.currentTarget), trusted: event.isTrusted, defaultPrevented: event.defaultPrevented,
							cancelable: event.cancelable, timeStamp: event.timeStamp,
							...event instanceof KeyboardEvent ? {key: event.key, code: event.code, repeat: event.repeat,
								altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey} : {},
							...event instanceof InputEvent ? {inputType: event.inputType, data: event.data, isComposing: event.isComposing} : {},
							state: snapshot()});
					};
					target.addEventListener(type, listener, {capture, passive: true});
					listeners.push({target, type, listener, capture});
				}
			}
			const recordMutations = (records: MutationRecord[]) => {
				for (const record of records) {
					const current = document.querySelector(".bqa__transformation-form-controls select");
					if (record.target !== node && !node.contains(record.target)
						&& !current?.contains(record.target)
						&& ![...record.addedNodes, ...record.removedNodes].some(added => added === node || added.contains(node) || added === current)) continue;
					if (mutations.length >= 1000) { droppedMutations++; continue; }
					mutations.push({type: record.type, target: describe(record.target), attribute: record.attributeName,
						oldValue: record.oldValue, added: [...record.addedNodes].map(describe), removed: [...record.removedNodes].map(describe), state: snapshot()});
				}
			};
			const observer = new MutationObserver(recordMutations);
			observer.observe(node.closest(".bqa__transformation") || node.parentElement!, {
				subtree: true, childList: true, attributes: true, attributeOldValue: true,
				characterData: true, characterDataOldValue: true, attributeFilter: ["value", "selected", "label", "disabled"],
			});
			const capture = (label: string) => {
				recordMutations(observer.takeRecords());
				checkpoints.push({label, state: snapshot()});
				return {epoch, requestedWidth: width, documentUrl: location.href, timeOrigin: performance.timeOrigin,
					events, mutations, checkpoints, limits: {events: 2000, mutations: 1000, droppedEvents, droppedMutations}};
			};
			globals.__round72KeyboardDiagnostic = {snapshot: capture, stop: () => {
				const result = capture("listener-and-observer-cleanup");
				observer.disconnect();
				for (const {target, type, listener, capture} of listeners) target.removeEventListener(type, listener, {capture});
				delete globals.__round72KeyboardDiagnostic;
				return result;
			}};
			capture("before-original-focus");
		}, {epoch, width});
	}

	private async captureRound72Keyboard (label: string, stop = false) {
		try {
			const json = await this.boundedRound72Diagnostic("keyboard trace", () => this.page.evaluate(({label, stop}) => {
				const diagnostic = (globalThis as Round72DiagnosticGlobals).__round72KeyboardDiagnostic;
				if (!diagnostic) return JSON.stringify({status: "document-changed-or-uninstalled-not-observed", url: location.href, timeOrigin: performance.timeOrigin});
				const trace = diagnostic.snapshot(label);
				return JSON.stringify(stop ? diagnostic.stop() : trace);
			}, {label, stop}));
			const trace: unknown = JSON.parse(json);
			if (trace === null || typeof trace !== "object" || Array.isArray(trace)) throw new Error("Keyboard diagnostic trace must be a non-null object.");
			await this.diagnosticInfo!.attach(`round72-keyboard-${this.keyboardEpoch}-${label}`, {
				body: json, contentType: "application/json",
			});
			return trace;
		} catch (error) { this.diagnosticErrors.push(`Keyboard trace ${label}: ${String(error)}`); }
		finally { if (stop) this.keyboardActive = false; }
	}

	private async expectRound72FocusVisible (control: Locator) {
		const geometry = await control.evaluate(node => {
			const bounds = node.getBoundingClientRect().toJSON();
			const clips = [];
			for (let parent = node.parentElement; parent; parent = parent.parentElement) {
				const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
				clips.push({tag: parent.tagName, class: parent.className, x: /^(auto|scroll|hidden|clip)$/.test(style.overflowX),
					y: /^(auto|scroll|hidden|clip)$/.test(style.overflowY), left: rect.left + parent.clientLeft, top: rect.top + parent.clientTop,
					right: rect.left + parent.clientLeft + parent.clientWidth, bottom: rect.top + parent.clientTop + parent.clientHeight});
			}
			const visual = window.visualViewport;
			return {bounds, clips, viewport: {x: true, y: true, left: 0, top: 0, right: innerWidth, bottom: innerHeight},
				visual: visual && {x: true, y: true, left: visual.offsetLeft, top: visual.offsetTop,
					right: visual.offsetLeft + visual.width, bottom: visual.offsetTop + visual.height}};
		});
		await this.diagnosticInfo!.attach(`round72-focus-visibility-${++this.focusChecks}`, {body: JSON.stringify(geometry), contentType: "application/json"});
		expect(geometry.bounds.width).toBeGreaterThan(0);
		expect(geometry.bounds.height).toBeGreaterThan(0);
		for (const clip of [geometry.viewport, ...geometry.visual ? [geometry.visual] : [], ...geometry.clips]) {
			if (clip.x) { expect(geometry.bounds.left).toBeGreaterThanOrEqual(clip.left - 1); expect(geometry.bounds.right).toBeLessThanOrEqual(clip.right + 1); }
			if (clip.y) { expect(geometry.bounds.top).toBeGreaterThanOrEqual(clip.top - 1); expect(geometry.bounds.bottom).toBeLessThanOrEqual(clip.bottom + 1); }
		}
	}

	private async gotoRound72 (path: string) {
		await this.page.goto(path);
		if (await this.page.evaluate(() => "__round72" in globalThis)) await this.page.reload();
	}

	async openRound72Bestiary (staged = true) {
		await this.gotoRound72("/bestiary.html#bugbear_mm");
		await expect(this.page.locator(".bqa__btn-open:visible").first()).toBeVisible({timeout: 30_000});
		await this.observeRound72(staged);
		await this.page.locator(".bqa__btn-open:visible").first().click();
		await this.page.getByRole("tab", {name: "Templates", exact: true}).click();
	}

	private async observeRound72 (staged: boolean) {
		await this.page.evaluate(async staged => {
			const uiUrl = "/js/bestiary/bestiary-quick-actions-ui.js";
			const pageUrl = "/js/encounterworkspace.js";
			const storeUrl = "/js/encounterworkspace/encounterworkspace-state.js";
			const [{BestiaryQuickActionsUi}, {EncounterWorkspacePage}, {EncounterWorkspaceStore}] = await Promise.all([import(uiUrl), import(pageUrl), import(storeUrl)]);
			const globals = globalThis as Round72Globals;
			if (globals.__round72) throw new Error("Observation must be installed once per real document.");
			const probe: Round72Probe = globals.__round72 = {staged, calls: 0, notifications: 0, saves: 0, writes: 0, failNext: false,
				proposals: [], savedStates: [], forbidden: [], gateEntered: false};
			const observed = new WeakSet<Round72Consumer>();
			const open = BestiaryQuickActionsUi.pOpen;
			BestiaryQuickActionsUi.pOpen = function (options: {monster: Round72Creature; registry?: Round72Consumer}) {
				const consumer = options.registry || this._registry;
				probe.consumer = consumer;
				probe.monster = {...options.monster};
				delete (probe.monster as Round72Creature & {_fSources?: unknown})._fSources;
				if (!observed.has(consumer)) {
					observed.add(consumer);
					const apply = consumer.applyChanges;
					consumer.applyChanges = function (proposal: object) {
						probe.calls++;
						probe.proposals.push(structuredClone(proposal));
						return apply.call(this, proposal);
					};
					consumer.subscribe(() => { probe.notifications++; });
				}
				return open.call(this, {...options, ...probe.staged ? {automationVersion: 2} : {}});
			};
			const openEditor = EncounterWorkspacePage.prototype._pOpenStatblockEditor;
			EncounterWorkspacePage.prototype._pOpenStatblockEditor = function (this: Round72Controller, id: string, options: {automationVersion?: number} = {}) {
				probe.controller = this;
				return openEditor.call(this, id, {...options, ...probe.staged ? {automationVersion: 2} : {}});
			};
			const save = EncounterWorkspaceStore.prototype.pSave;
			EncounterWorkspaceStore.prototype.pSave = async function (state: Round72State) {
				probe.saves++;
				const result = await save.call(this, state);
				probe.savedStates.push(structuredClone(result));
				return result;
			};
			const write = globals.StorageUtil.pSetForPage;
			globals.StorageUtil.pSetForPage = async function (key, value, options) {
				if (key === "encounterWorkspaceState") {
					probe.writes++;
					if (probe.failNext) { probe.failNext = false; throw new Error("Round72 explicit rejected real Store write"); }
				}
				return write.call(this, key, value, options);
			};
		}, staged);
	}

	private async round72Snapshot () {
		return this.page.evaluate(async () => {
			const {__round72: probe} = globalThis as Round72Globals;
			const moduleUrl = "/js/encounterworkspace/encounterworkspace-state.js";
			const {EncounterWorkspaceStore, getEncounterEffectiveMonster} = await import(moduleUrl);
			const state: Round72State = probe.controller?._state || await new EncounterWorkspaceStore().pLoad();
			const monster = probe.monster;
			const operations = monster && probe.consumer ? probe.consumer.getOperations({monster}) : [];
			const owner = operations.find(it => it.data.resolved?.frozenForms);
			return {
				calls: probe.calls, notifications: probe.notifications, saves: probe.saves, writes: probe.writes,
				proposals: structuredClone(probe.proposals), savedStates: structuredClone(probe.savedStates),
				state: structuredClone(state), persisted: await new EncounterWorkspaceStore().pLoad() as Round72State,
				hpUndo: structuredClone(probe.controller?._hpUndo || []),
				operations: structuredClone(operations),
				effective: monster && probe.consumer ? structuredClone(probe.consumer.getCreature({monster})) : null,
				encounterEffective: state.instances.map(instance => getEncounterEffectiveMonster(instance) as Round72Creature),
				ownerId: owner?.id, form: owner?.data.resolved?.frozenForms?.activeForm,
				index: owner ? operations.indexOf(owner) : -1,
				prefix: JSON.stringify(operations.slice(0, 1)), suffix: JSON.stringify(operations.slice(2)),
			};
		});
	}

	private async setRound72Field (root: Locator, label: string | RegExp, value: string) {
		const options = {name: label, exact: typeof label === "string"};
		const control = root.getByRole("combobox", options).or(root.getByRole("spinbutton", options)).or(root.getByRole("textbox", options));
		if (await control.evaluate(node => node.tagName === "SELECT")) await control.selectOption(value);
		else await control.fill(value);
	}

	private async fillRound72Bugbear () {
		const root = this.root.locator(".bqa__transformation-resolution").first();
		const field = (label: string | RegExp, value: string) => this.setRound72Field(root, label, value);
		await field("Reviewed unchanged armor", "retain");
		await field("Reason / source policy", "Zombie retains source equipment; independently reviewed.");
		const entries = root.locator("details").filter({has: this.page.locator(":scope > summary")});
		for (const name of ["Surprise Attack", "Morningstar", "Javelin"]) {
			const panel = entries.filter({has: this.page.locator("summary", {hasText: new RegExp(`^(trait|action): ${name} \\(MM\\)$`)})}).last();
			await this.setRound72Field(panel, "Entry policy", "bind");
			const rows = panel.locator(".bqa__transformation-resolution-row");
			for (let ix = 0; ix < await rows.count(); ix++) {
				const row = rows.nth(ix);
				await this.setRound72Field(row, "Token interpretation", name === "Surprise Attack" ? "fixed" : "ability");
				await this.setRound72Field(row, "Token interpretation reason", "Source-qualified MM token deliberately reviewed.");
				if (name === "Surprise Attack") continue;
				await this.setRound72Field(row, "Governing ability", "str");
				await this.setRound72Field(row, "Token PB multiplier", (await row.textContent())?.includes(", hit token") ? "1" : "0");
				await row.getByRole("button", {name: "Propose residual", exact: true}).click();
				await expect(row).toContainText("Unaccepted proposal");
				await row.getByRole("button", {name: "Adopt this interpretation", exact: true}).click();
				await expect(row).toContainText("Adopted residual");
			}
		}
		await field(/^skill: stealth, observed .* - PB multiplier$/, "2");
		await field("stealth interpretation reason", "MM Stealth expertise reviewed.");
		await field(/^skill: survival, observed .* - PB multiplier$/, "1");
		await field("survival interpretation reason", "MM Survival proficiency reviewed.");
		for (const [label, value] of [
			["Expected CR band (deliberately adopt or edit)", "1"], ["AC alternative to evaluate", "0"], ["Effective resistance policy", "none"],
			["Prevalent multiple vulnerabilities?", "no"], ["Applicable regeneration per round", "0"], ["Estimate-only effective HP adjustment", "0"],
			["Estimate-only effective AC adjustment", "0"], ["Defense policy and reviewed feature adjustments", "No relevant multipliers or regeneration; all features reviewed."],
			["trait: Brute (MM)", "excluded"], ["Brute coverage reason", "Already baked into weapon dice."],
			["trait: Surprise Attack (MM)", "excluded"], ["Surprise Attack coverage reason", "No surprise in this reviewed routine."],
			["action: Morningstar (MM)", "represented"], ["Morningstar coverage reason", "One melee attack each round."],
			["action: Javelin (MM)", "excluded"], ["Javelin coverage reason", "Ranged alternative reviewed, not chosen."],
		]) await field(label, value);
		await root.getByRole("button", {name: "Add alternative routine", exact: true}).click();
		await root.getByRole("combobox", {name: "Predominant attack / save accuracy", exact: true}).selectOption({label: "Morningstar (MM) - hit 1:1"});
		await field("Predominant / mixed-accuracy explanation", "Morningstar accuracy across all three rounds.");
		await field("Routine source and schedule explanation", "One Morningstar attack per round, no surprise.");
		await root.getByRole("button", {name: "Add contribution", exact: true}).click();
		await root.getByRole("combobox", {name: "Damage contribution", exact: true}).selectOption({label: "Morningstar (MM) - paragraph 1, damage 1"});
		await field("Timing / use restriction", "normal");
		await field("Contribution schedule reason", "One attack against one target each round.");
		for (let round = 1; round <= 3; round++) {
			await field(`Round ${round} uses`, "1");
			await field(`Round ${round} targets`, "1");
		}
		await field("Routine selection policy", "highest-damage");
		await field("Final CR0 no-threat 0 XP policy?", "no");
		await field("All relevant effects and complete alternatives reviewed?", "yes");
		await field("Completeness explanation (never auto-authored)", "All source effects and complete alternatives deliberately reviewed.");
		await expect(root.locator(".bqa__transformation-cr-estimate")).toContainText("Estimated CR 1");
		await expect(root.locator(".bqa__transformation-cr-estimate")).toContainText("DPR 12");
		await expect(root.locator(".bqa__transformation-cr-estimate")).toContainText("per-use printed average 12");
		await expect(this.afterStatblock).toContainText("32");
		await expect(this.afterStatblock).toContainText("12 (2d8 + 3)");
	}

	private round72ApplyButton () { return this.root.getByRole("button", {name: /^(Apply transformation|Apply to \d+ · one save)$/}); }
	private round72Consequences () { return this.root.getByRole("region", {name: "Encounter consequences to review"}); }

	private async confirmRound72Compiled () {
		if (await this.root.getByRole("group", {name: "Confirm before applying"}).isHidden()) await this.round72ApplyButton().click();
		await this.confirmPrerequisites();
	}

	private async closeRound72Modal () {
		await this.page.locator(".bqa__modal").getByRole("button", {name: "Done", exact: true}).click();
		await expect(this.page.locator(".bqa__modal")).toHaveCount(0);
	}

	async round72Bugbear () {
		await this.openRound72Bestiary();
		const source = await this.round72Snapshot();
		expect(source.effective!.name).toBe("Bugbear");
		await this.choose("catalog:zombie|dmg");
		await expect(this.root.getByRole("button", {name: "Apply transformation"})).toHaveCount(0);
		await this.fillRound72Bugbear();
		const field = (label: string, value: string) => this.setRound72Field(this.root, label, value);
		await field("Override estimated CR?", "override");
		await field("Final CR override", "2");
		await field("CR override reason", "Explicit encounter adjudication; independent estimate remains CR 1.");
		await expect(this.root.locator(".bqa__transformation-cr-estimate")).toContainText("Estimated CR 1");
		await expect(this.root.locator(".bqa__transformation-cr-estimate")).toContainText("Final CR 2, 450 XP");
		await expect(this.root.locator(".bqa__transformation-cr-estimate")).toContainText("independent estimate retained");
		await field("Override estimated CR?", "");
		await this.confirmRound72Compiled();
		await this.page.evaluate(() => {
			const globals = globalThis as Round72Globals;
			const original = globals.DataUtil.race.loadBrew;
			let release: () => void = () => {};
			const gate = new Promise<void>(resolve => { release = resolve; });
			globals.DataUtil.race.loadBrew = async function (...args) {
				globals.__round72.gateEntered = true;
				await gate;
				return original.apply(this, args);
			};
			globals.__round72.release = () => { globals.DataUtil.race.loadBrew = original; release(); };
		});
		await this.round72ApplyButton().click();
		await expect.poll(() => this.page.evaluate(() => (globalThis as Round72Globals).__round72.gateEntered)).toBe(true);
		await field("Completeness explanation (never auto-authored)", "Same numerical result; a fresh raw explanation must invalidate pending approval.");
		await field("Round 1 uses", "2");
		await field("Round 2 uses", "0");
		await expect(this.root.locator(".bqa__transformation-cr-estimate")).toContainText("DPR 12");
		await this.page.evaluate(() => (globalThis as Round72Globals).__round72.release!());
		await expect(this.root.locator(".bqa__transformation-error")).toContainText(/changed|stale/i);
		expect((await this.round72Snapshot()).calls).toBe(0);
		expect((await this.round72Snapshot()).effective).toEqual(source.effective);
		await this.confirmRound72Compiled();
		await this.round72ApplyButton().click();
		await expect.poll(async () => (await this.round72Snapshot()).operations.length).toBe(1);
		const result = await this.round72Snapshot();
		expect(result.calls).toBe(1);
		expect(result.notifications).toBe(1);
		expect(result.effective).toMatchObject({str: 16, hp: {average: 32, formula: "5d8 + 10"}, profBonus: 2, cr: {cr: "1", xp: 200}});
		expect(result.effective!.action![0].entries[0]).toContain("{@hit 5}");
		expect(result.effective!.action![0].entries[0]).toContain("12 ({@damage 2d8 + 3})");
		expect(result.operations[0].data.resolved!.changes.find(it => it.type === "setChallengeRating")?.receipt).toMatchObject({
			estimatedCr: "1", damagePerRound: 12, proficiency: {before: 2, after: 2},
		});
		await this.page.locator(".bqa__changes .bqa__row").getByRole("button", {name: "Remove", exact: true}).click();
		expect((await this.round72Snapshot()).effective).toEqual(source.effective);
		expect((await this.round72Snapshot()).operations).toEqual([]);
	}

	private async seedRound72Encounter () {
		await this.gotoRound72("/encounterworkspace.html");
		await expect(this.page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "false", {timeout: 30_000});
		await this.page.evaluate(async () => {
			const url = "/js/encounterworkspace/encounterworkspace-state.js";
			const engineUrl = "/js/bestiary/bestiary-quick-actions-engine.js";
			const [{EncounterWorkspaceState: State, EncounterWorkspaceStore}, {BestiaryQuickActionsOperations: Ops}] = await Promise.all([import(url), import(engineUrl)]);
			const {monster} = await (globalThis as Round72Globals).DataUtil.loadJSON("data/bestiary/bestiary-mm.json");
			let ix = 0;
			let state = await State.pFromSavedList({
				exportedSublist: {name: "Round72 source-defined MM consumers", items: [{h: "bugbear_mm", c: 3}, {h: "adult black dragon_mm", c: 4}]},
				pResolveItem: async (item: {h: string}) => ({entity: monster.find(it => it.name === (item.h === "bugbear_mm" ? "Bugbear" : "Adult Black Dragon"))}),
				fnUid: () => `r72-${++ix}`,
			});
			state = State.withHp(state, {id: "r72-1", prop: "current", value: 4});
			state = State.withHp(state, {id: "r72-1", prop: "temp", value: 6});
			state = State.withGroup({state, memberIds: ["r72-1", "r72-2", "r72-3"], id: "r72-shared"});
			state = State.withSharedTurn(state, {groupId: "r72-shared", isShared: true, total: 16});
			state = State.withTurn(state, "start");
			state = State.withStatblockChanges(state, [{id: "r72-6",
				addOperations: Array.from({length: 100}, (_, i) => ({id: `cap-${i}`, ...Ops.patch({set: {str: 23}})})),
				removeIds: []}]).state;
			await new EncounterWorkspaceStore().pSave(state);
		});
		await this.page.reload();
		await expect(this.page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "false", {timeout: 30_000});
		await this.observeRound72(true);
		await this.page.locator("#ew-focus-edit").click();
		await this.page.getByRole("tab", {name: "Templates", exact: true}).click();
	}

	async round72Encounter () {
		await this.seedRound72Encounter();
		const before = await this.round72Snapshot();
		await this.choose("catalog:zombie|dmg");
		await this.fillRound72Bugbear();
		await this.confirmRound72Compiled();
		await this.round72ApplyButton().click();
		await expect(this.round72Consequences()).toBeVisible();
		await expect(this.round72Consequences()).toBeFocused();
		await expect(this.round72Consequences()).toContainText("HP will reset");
		await expect(this.round72Consequences()).toContainText("incompatible encounter groups");
		const paused = await this.round72Snapshot();
		expect(paused.writes).toBe(0);
		expect(paused.saves).toBe(0);
		expect(paused.notifications).toBe(0);
		expect(paused.state).toEqual(before.state);
		expect(paused.persisted).toEqual(before.persisted);
		const consent = this.root.getByRole("group", {name: "Confirm before applying"}).getByRole("checkbox");
		for (let ix = 0; ix < await consent.count(); ix++) await expect(consent.nth(ix)).not.toBeChecked();
		await this.page.evaluate(() => { (globalThis as Round72Globals).__round72.failNext = true; });
		await this.confirmPrerequisites();
		await this.round72ApplyButton().click();
		await expect(this.root.locator(".bqa__transformation-error")).toContainText("rejected real Store write");
		const failed = await this.round72Snapshot();
		expect(failed.state).toEqual(before.state);
		expect(failed.persisted).toEqual(before.persisted);
		expect(failed.hpUndo).toEqual(before.hpUndo);
		expect(failed.notifications).toBe(0);
		expect(failed.savedStates).toEqual([]);
		expect(failed.writes).toBe(1);
		await this.round72ApplyButton().click();
		await expect.poll(async () => (await this.round72Snapshot()).notifications).toBe(1);
		const saved = await this.round72Snapshot();
		expect(saved.writes).toBe(2);
		expect(saved.savedStates).toHaveLength(1);
		expect(saved.state).toEqual(saved.persisted);
		expect(saved.state.instances[0].hp).toEqual({current: 32, max: 32, temp: 6});
		expect(saved.state.instances.map(it => it.id)).toEqual(before.state.instances.map(it => it.id));
		expect(saved.state.groups).toEqual([{id: "r72-shared", memberIds: ["r72-2", "r72-3"], sharedTurn: true, initiative: 16}]);
		expect(saved.state.turn).toEqual({round: 1, activeId: "r72-shared"});
		await this.closeRound72Modal();
		await this.page.reload();
		await expect(this.page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "false");
		await this.observeRound72(true);
		await this.page.locator("#ew-focus-edit").click();
		expect((await this.round72Snapshot()).state).toEqual(saved.persisted);
		await this.closeRound72Modal();
		await this.page.locator("#ew-focus-more > summary").click();
		await this.page.locator("#ew-browse-roster").click();
		await this.page.locator("#ew-none").click();
		for (const id of ["r72-4", "r72-5", "r72-6", "r72-7", "r72-2"]) {
			const checkbox = this.page.locator(`.ew__roster-row[data-instance-id="${id}"]`).getByRole("checkbox");
			await checkbox.check();
			await expect(checkbox).toBeChecked();
		}
		await this.page.locator("#ew-open-bulk").click();
		await this.page.locator("#ew-bulk-type").selectOption("transformation");
		await this.page.evaluate(async () => {
			const probe = (globalThis as Round72Globals).__round72;
			await probe.controller!._pRenderBulkChoices({automationVersion: 2});
			probe.saves = probe.writes = 0; probe.savedStates = [];
		});
		await this.choose("catalog:dracolich|mm");
		const allPanels = this.root.locator(".bqa__transformation-resolution");
		await expect(allPanels).toHaveCount(5);
		const panels = allPanels.filter({has: this.page.locator("legend", {hasText: /^Adult Black Dragon/})});
		await expect(panels).toHaveCount(4);
		for (let ix = 0; ix < 3; ix++) {
			for (const [label, value] of [
				["Age", "adult"], ["Is this a true dragon?", "yes"], ["Is this a shadow dragon?", "no"],
				["Living physiology review", "amphibious-only"], ["Lair policy", "retain"],
			]) await this.setRound72Field(panels.nth(ix), label, value);
		}
		await expect(panels.nth(3).getByRole("combobox", {name: "Age", exact: true})).toHaveValue("");
		await expect(this.root).toContainText("3 eligible");
		await this.confirmRound72Compiled();
		await this.round72ApplyButton().click();
		await expect(this.root).toContainText("100-operation");
		await expect(this.root).toContainText("2 eligible");
		expect((await this.round72Snapshot()).writes).toBe(0);
		await expect(this.root.getByRole("group", {name: "Confirm before applying"})).toBeHidden();
		await this.confirmRound72Compiled();
		await this.round72ApplyButton().click();
		await expect.poll(async () => (await this.round72Snapshot()).savedStates.length).toBe(1);
		const bulk = await this.round72Snapshot();
		expect(bulk.writes).toBe(1);
		expect(bulk.saves).toBe(1);
		expect(bulk.persisted.instances.map(it => it.statblockOperations.length)).toEqual([1, 0, 0, 1, 1, 100, 0]);
		expect(bulk.encounterEffective.slice(3, 5).map(it => it.type)).toEqual(["undead", "undead"]);
		expect(bulk.persisted.instances[0].hp).toEqual({current: 32, max: 32, temp: 6});
		expect(bulk.persisted.groups).toEqual(saved.persisted.groups);
		expect(bulk.persisted.turn).toEqual(saved.persisted.turn);
		expect(bulk.persisted.instances.map(it => it.id)).toEqual(before.state.instances.map(it => it.id));
	}

	private async seedRound72Kernel (where: "registry" | "encounter", conflict = false) {
		await this.gotoRound72(where === "registry" ? "/bestiary.html#bugbear_mm" : "/encounterworkspace.html");
		if (where === "registry") await expect(this.page.locator(".bqa__btn-open:visible").first()).toBeVisible({timeout: 30_000});
		else await expect(this.page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "false", {timeout: 30_000});
		// This is storage seeding, not a family producer or a simulated form-switch interaction.
		await this.page.evaluate(async ({where, conflict}) => {
			const urls = [
				"/js/bestiary/bestiary-quick-actions-engine.js", "/js/creature-transformations.js",
				"/js/creature-transformation-stats.js", "/js/creature-transformation-cr.js",
				"/js/creature-transformation-forms.js", "/js/bestiary/bestiary-transformation-catalog-adapter.js",
				"/js/encounterworkspace/encounterworkspace-state.js", "/js/bestiary/bestiary-transformation-inputs.js",
			];
			const [engine, compiler, stats, cr, forms, adapter, encounter, inputs] = await Promise.all(urls.map(url => import(url)));
			const {BestiaryQuickActionsOperations: Ops, BestiaryQuickActionsUtil: Util} = engine;
			const base = {name: "Kernel-only frozen owner with an exceptionally long source-qualified fixture label",
				source: "MM", type: "humanoid", size: ["M"], cr: "1", str: 15, dex: 12, con: 12, int: 10, wis: 10, cha: 8,
				profBonus: 2, hp: {average: 33, formula: "6d8 + 6"}, ac: [13],
				action: [{name: "Claw", entries: ["{@hit +4} to hit. 5 ({@damage 1d6 + 2}) slashing damage."]}]};
			const prefix = {id: "kernel-prefix", ...Ops.patch({set: {languages: ["Common"]}})};
			const current = Util.applyOperations({baseCreature: base, operations: [prefix]});
			const candidates = await compiler.pLoadCreatureTransformationCandidates();
			const pending = compiler.resolveCreatureTransformation({candidates, id: "catalog:zombie|dmg", automationVersion: 2});
			const table = await inputs.pLoadCreatureTransformationInputTable({requested: true});
			const profiles = [0, 1].map(index => {
				const rating = cr.estimateCreatureTransformationCr({current: {...current, hp: {average: index ? 45 : 39}, ac: [index ? 17 : 14]}, table,
					assumptions: {
						defense: {expectedCr: "1", hpBoundary: null, acIndex: 0, acAdjustment: 0, hpAdjustment: 0, resistance: "none", vulnerability: false, regeneration: 0, note: "Kernel-only fixture."},
						routines: [{id: "kernel", rounds: [8, 8, 8].map(value => ({value, proficiency: 0})), accuracy: {kind: "attack", value: 4, proficiency: 1}, note: "Kernel-only fixture."}],
						routine: "kernel", review: "Synthetic kernel fixture.", override: {cr: index ? "5" : "2", reason: "Kernel-only override."}, zeroXp: false, proficiencyAnswer: null,
					}});
				const root = compiler.compileCreatureTransformation({resolved: pending, current});
				return {id: index ? "kernel-b" : "kernel-a", label: `Kernel-only ${index ? "B" : "A"}: SupercalifragilisticexpialidociousMountainPass frozen`,
					resolved: {...root,
						selectedOptions: {...root.selectedOptions, "automation-bindings": ["zombie-dmg-m2b"], "automation-cr": ["zombie-dmg-m3"]},
						changes: [
							...root.changes.filter((it: {op: string}) => !["setAbility", "setHitPoints", "setSaveBonus", "setSkillBonus", "setPassivePerception"].includes(it.op)),
							...stats.compileCreatureTransformationStats({current, abilities: {str: index ? 18 : 16, con: index ? 16 : 14}, hp: {mode: "constitution"}}),
							{op: "setProficiencyBonus", value: rating.receipt.proficiency.after}, {op: "setArmorClass", value: [index ? 17 : 14]},
							{op: "setEntryNumbers", section: "action", match: {name: "Claw", source: "MM"},
								entries: [`{@hit +${index ? 6 : 5}} to hit. ${index ? 7 : 6} ({@damage 1d6 + ${index ? 4 : 3}}) slashing damage. Kernel-only rider.`]}, rating,
						]}};
			});
			const resolved = adapter.normalizeCreatureTransformation(forms.createFrozenCreatureTransformation({profiles, activeForm: "kernel-a",
				baseline: Util.getCreatureTransformationBaseline({baseCreature: base, operations: [prefix]})}));
			const preview = Util.previewCreatureTransformation({baseCreature: base, operations: [prefix], resolved, acknowledgedPrerequisites: resolved.prerequisites, dmApproved: true});
			const owner = {id: "kernel-owner", ...Util.createCreatureTransformationOperation({baseCreature: base, operations: [prefix], preview})};
			let suffix = {id: "kernel-suffix", ...Ops.patch({set: {wis: 19}})};
			if (conflict) {
				const later = {id: "catalog:later|tst", kind: "catalog", identity: {name: "Later kernel-only conflict", source: "TST"},
					provenance: {edition: "classic"}, eligibility: [], prerequisites: [], selectedOptions: {}, changes: [{type: "setAbility", ability: "str", value: 20}], manualReview: []};
				const laterPreview = Util.previewCreatureTransformation({baseCreature: base, operations: [prefix, owner], resolved: later, conflictDecisions: {str: "existing"}});
				suffix = {id: "kernel-suffix", ...Util.createCreatureTransformationOperation({baseCreature: base, operations: [prefix, owner], preview: laterPreview, conflictDecisions: {str: "existing"}})};
			}
			if (where === "encounter") {
				let ix = 0;
				let state = await encounter.EncounterWorkspaceState.pFromSavedList({
					exportedSublist: {name: "Kernel-only saved frozen-form fixtures", items: [{h: "kernel-only_mm", c: 1}]},
					pResolveItem: async () => ({entity: base}), fnUid: () => `kernel-${++ix}`,
				});
				state = encounter.EncounterWorkspaceState.withStatblockChanges(state, [{id: "kernel-1", addOperations: [prefix, owner, suffix], removeIds: []}]).state;
				state = encounter.EncounterWorkspaceState.withHp(state, {id: "kernel-1", prop: "current", value: 4});
				state = encounter.EncounterWorkspaceState.withHp(state, {id: "kernel-1", prop: "temp", value: 6});
				await new encounter.EncounterWorkspaceStore().pSave(state);
			} else {
				const registry = engine.BESTIARY_QUICK_ACTIONS_REGISTRY;
				registry.applyChanges({monster: base, addOperations: [prefix, owner, suffix], removeIds: []});
				(globalThis as typeof globalThis & {__round72Kernel?: {base: Round72Creature}}).__round72Kernel = {base};
			}
		}, {where, conflict});
		if (where === "encounter") {
			await this.page.reload();
			await expect(this.page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "false", {timeout: 30_000});
		}
		await this.observeRound72(false);
		if (where === "encounter") await this.page.locator("#ew-focus-edit").click();
		else await this.page.evaluate(async () => {
			const url = "/js/bestiary/bestiary-quick-actions-ui.js";
			const {BestiaryQuickActionsUi} = await import(url);
			const {__round72Kernel} = globalThis as typeof globalThis & {__round72Kernel: {base: Round72Creature}};
			await BestiaryQuickActionsUi.pOpen({monster: __round72Kernel.base});
		});
	}

	private async openRound72Saved () {
		const action = this.page.locator('.bqa__changes button[data-saved-operation-id="kernel-owner"]');
		await action.press("Enter");
		const picker = this.root.getByRole("combobox", {name: "Permitted saved form", exact: true});
		await this.expectRound72FocusVisible(picker);
		await expect(picker).toBeFocused();
		expect(await picker.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(["kernel-a", "kernel-b"]);
		await expect(this.root.locator("textarea, input:not([type=checkbox])")).toHaveCount(0);
		await expect(this.root).toContainText("Kernel-only");
		await expect(this.root).toContainText("position 2 of 3");
	}

	private async forbidRound72SourcePaths () {
		this.coverage = await this.page.context().newCDPSession(this.page);
		this.coverageIntervals.push({epoch: this.coverageIntervals.length + 1, events: [
			{label: "session-created", at: new Date().toISOString(), documentUrl: this.page.url()},
		]});
		this.coverageIntervals.at(-1)!.events.push({label: "before-profiler-start", at: new Date().toISOString(), context: await this.round72CoverageContext(true)});
		await this.coverage.send("Profiler.enable");
		this.coverageIntervals.at(-1)!.events.push({label: "startPreciseCoverage-request", at: new Date().toISOString()});
		await this.coverage.send("Profiler.startPreciseCoverage", {callCount: true, detailed: true});
		this.coveragePending = true;
		this.coverageIntervals.at(-1)!.events.push({label: "startPreciseCoverage-acknowledged", at: new Date().toISOString(),
			options: {callCount: true, detailed: true}, context: await this.round72CoverageContext()});
		await this.installRound72EntryObserver();
		await this.page.evaluate(() => {
			const globals = globalThis as Round72Globals;
			const load = globals.DataUtil.loadJSON;
			globals.DataUtil.loadJSON = async function (url) {
				if (/creature-transformations\.json|msbcr\.json|races(?:\/|\.)/.test(url)) {
					globals.__round72.forbidden.push(url);
					throw new Error(`Saved mode attempted forbidden source/table load: ${url}`);
				}
				return load.call(this, url);
			};
			for (const key of ["loadJSON", "loadPrerelease", "loadBrew"] as const) {
				globals.DataUtil.race[key] = async () => {
					globals.__round72.forbidden.push(`race.${key}`);
					throw new Error(`Saved mode attempted forbidden race.${key}`);
				};
			}
		});
		await this.page.evaluate(() => {
			const probe = (globalThis as Round72DiagnosticGlobals).__round72EntryObserver!;
			probe.counts = Object.fromEntries(Object.keys(probe.counts).map(name => [name, 0]));
			probe.phase = "protected";
		});
		this.coveragePending = true;
		await this.captureRound72EntryCounts("protected-start");
	}

	private async expectRound72NoCompilation () {
		await this.collectRound72Coverage("before-calibrated-entry-assertions");
		const observed = await this.captureRound72EntryCounts("protected-end");
		expect(this.entriesCalibrated, "Every exact production entry must pass its positive control before the protected interval").toBe(true);
		if (observed.status !== "observed") throw new Error("Actual entry observations missing; compilation UNKNOWN, not zero.");
		expect(observed).toMatchObject({epoch: this.coverageIntervals.at(-1)!.epoch, phase: "protected", sameDocument: true, referencesCurrent: true});
		expect(Object.keys(observed.counts).sort()).toEqual(this.entryTargets.map(target => target.name).sort());
		for (const target of this.entryTargets) {
			const count = observed.counts[target.name];
			expect(Number.isSafeInteger(count) && count >= 0, `Known actual-entry count required for ${target.name}`).toBe(true);
			expect(count, `${target.name} must not run while switching saved forms`).toBe(0);
			this.compilation.push({epoch: observed.epoch, url: target.url, functionName: target.name, count});
		}
		expect(await this.page.evaluate(() => (globalThis as Round72Globals).__round72.forbidden)).toEqual([]);
		await this.closeRound72Coverage();
	}

	private async switchRound72Saved (form: "kernel-a" | "kernel-b", persistent: boolean) {
		const before = await this.round72Snapshot();
		await this.root.getByRole("combobox", {name: "Permitted saved form", exact: true}).selectOption(form);
		await expect(this.root.locator(".bqa__transformation-statblock")).toHaveCount(2);
		const button = this.root.getByRole("button", {name: "Switch form", exact: true});
		await button.click();
		if (persistent) {
			await expect(this.round72Consequences()).toBeVisible();
			expect((await this.round72Snapshot()).writes).toBe(before.writes);
			await this.round72Consequences().getByRole("checkbox").check();
			await button.click();
		}
		await expect.poll(async () => (await this.round72Snapshot()).form).toBe(form);
		const after = await this.round72Snapshot();
		expect(after.ownerId).toBe("kernel-owner");
		expect(after.index).toBe(1);
		expect(after.operations.map(it => it.id)).toEqual(["kernel-prefix", "kernel-owner", "kernel-suffix"]);
		expect(after.prefix).toBe(before.prefix);
		expect(after.suffix).toBe(before.suffix);
		expect(after.effective).toMatchObject({
			str: form === "kernel-b" ? 18 : 16, con: form === "kernel-b" ? 16 : 14, wis: 19,
			hp: {average: form === "kernel-b" ? 45 : 39, formula: form === "kernel-b" ? "6d8 + 18" : "6d8 + 12"},
			cr: {cr: form === "kernel-b" ? "5" : "2", xp: form === "kernel-b" ? 1800 : 450}, profBonus: 2,
		});
		expect(after.effective!.action![0].entries[0]).toBe(form === "kernel-b"
			? "{@hit +6} to hit. 7 ({@damage 1d6 + 4}) slashing damage. Kernel-only rider."
			: "{@hit +5} to hit. 6 ({@damage 1d6 + 3}) slashing damage. Kernel-only rider.");
		expect(after.proposals.at(-1)).toMatchObject({
			id: "current", addOperations: [], removeIds: [],
			replaceOperation: {operationId: "kernel-owner", expectedIntegrity: before.operations[1].data.integrity, operation: after.operations[1]},
		});
		expect(Object.keys(after.proposals.at(-1)!).sort()).toEqual(["addOperations", "id", "monster", "removeIds", "replaceOperation"]);
		expect(after.operations[1].data.resolved!.frozenForms!.profiles).toEqual(before.operations[1].data.resolved!.frozenForms!.profiles);
		if (persistent) {
			expect(after.persisted.instances[0].hp).toEqual({current: form === "kernel-b" ? 45 : 39, max: form === "kernel-b" ? 45 : 39, temp: 6});
			expect(after.persisted.instances[0].statblockOperations[1].data.resolved!.frozenForms!.activeForm).toBe(form);
			expect(after.persisted.instances[0].monster).toEqual(before.persisted.instances[0].monster);
		}
		await this.expectRound72FocusVisible(this.root.getByRole("combobox", {name: "Permitted saved form", exact: true}));
		await expect(this.root.getByRole("combobox", {name: "Permitted saved form", exact: true})).toBeFocused();
		await this.root.getByRole("combobox", {name: "Permitted saved form", exact: true}).selectOption(form);
		await expect(this.root.getByRole("button", {name: "Switch form", exact: true})).toBeDisabled();
		expect((await this.round72Snapshot()).writes).toBe(after.writes);
		expect((await this.round72Snapshot()).calls).toBe(after.calls);
	}

	async round72SavedForms () {
		await this.seedRound72Kernel("registry");
		await this.forbidRound72SourcePaths();
		await this.openRound72Saved();
		expect((await this.round72Snapshot()).calls).toBe(0);
		await expect(this.root.getByRole("button", {name: "Switch form", exact: true})).toBeDisabled();
		await this.switchRound72Saved("kernel-b", false);
		await this.switchRound72Saved("kernel-a", false);
		expect((await this.round72Snapshot()).calls).toBe(2);
		await this.expectRound72NoCompilation();
		await this.closeRound72Modal();
		await this.seedRound72Kernel("encounter");
		await this.forbidRound72SourcePaths();
		await this.openRound72Saved();
		expect((await this.round72Snapshot()).writes).toBe(0);
		await this.switchRound72Saved("kernel-b", true);
		await this.switchRound72Saved("kernel-a", true);
		const saved = await this.round72Snapshot();
		expect(saved.writes).toBe(2);
		expect(saved.notifications).toBe(2);
		await this.expectRound72NoCompilation();
		await this.closeRound72Modal();
		await this.page.reload();
		await expect(this.page.locator("#encounter-workspace")).toHaveAttribute("aria-busy", "false");
		await this.observeRound72(false);
		await this.page.locator("#ew-focus-edit").click();
		expect((await this.round72Snapshot()).state).toEqual(saved.persisted);
		await this.forbidRound72SourcePaths();
		await this.openRound72Saved();
		await this.page.locator(".bqa__changes .bqa__row").filter({has: this.page.locator('[data-saved-operation-id="kernel-owner"]')})
			.getByRole("button", {name: "Remove", exact: true}).click();
		await expect.poll(async () => (await this.round72Snapshot()).operations.length).toBe(2);
		const removed = await this.round72Snapshot();
		expect(removed.operations.map(it => it.id)).toEqual(["kernel-prefix", "kernel-suffix"]);
		expect(removed.effective).toMatchObject({str: 15, wis: 19, hp: {average: 33}});
		expect(removed.persisted.instances[0].hp).toEqual({current: 33, max: 33, temp: 6});
		await this.expectRound72NoCompilation();
		await this.closeRound72Modal();
		await this.seedRound72Kernel("encounter", true);
		await this.forbidRound72SourcePaths();
		await this.openRound72Saved();
		const conflict = await this.round72Snapshot();
		await this.root.getByRole("combobox", {name: "Permitted saved form", exact: true}).selectOption("kernel-b");
		await expect(this.root.getByRole("alert")).toContainText(/conflict.*changed/i);
		await expect(this.root.getByRole("button", {name: "Switch form", exact: true})).toBeDisabled();
		expect((await this.round72Snapshot()).operations).toEqual(conflict.operations);
		expect((await this.round72Snapshot()).persisted).toEqual(conflict.persisted);
		expect((await this.round72Snapshot()).writes).toBe(0);
		await this.expectRound72NoCompilation();
	}

	private expectRound72NativeKeyboardChange (trace: object | undefined) {
		expect(trace).toMatchObject({
			events: expect.arrayContaining([expect.objectContaining({
				type: "change", trusted: true, targetIsOriginal: true, state: expect.objectContaining({
					original: expect.objectContaining({value: "kernel-b", popupOpen: false}),
				}),
			})]),
			limits: {droppedEvents: 0, droppedMutations: 0},
		});
	}

	private async calibrateRound72Keyboard (picker: Locator, width: number) {
		const environment = await this.page.evaluate(() => ({
			platform: navigator.platform, userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints,
		}));
		const isMac = /^Mac/.test(environment.platform);
		const route = isMac ? "closed-select printable typeahead: Kernel-only B" : "original ArrowDown / Enter";
		const caveat = "Mac native Cocoa popup/menu keyboard control is UNTESTED; CDP does not drive its AppKit loop. Calibration is not product acceptance.";
		console.log(`[Round72 keyboard ${width}] ${environment.platform}: ${route}. LIMIT: ${caveat}`);
		await this.diagnosticInfo!.attach(`round72-keyboard-route-${width}`, {body: JSON.stringify({
			environment, route, caveat, phase: "before-plain-calibration-and-actual-saved-selection",
			upstream: [
				"https://github.com/microsoft/playwright/issues/28860#issuecomment-1877574225",
				"https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/3033#issuecomment-6060576728",
			],
		}), contentType: "application/json"});
		await expect(picker).toHaveValue("kernel-a");
		expect(await picker.evaluate(node => node.matches(":open")), "Actual saved popup must start closed").toBe(false);
		const before = await this.round72Snapshot();
		const options = await picker.locator("option").evaluateAll(nodes => nodes.map(node => ({
			text: (node as HTMLOptionElement).text, value: (node as HTMLOptionElement).value,
		})));
		await picker.evaluate(node => {
			if (!(node instanceof HTMLSelectElement)) throw new Error("Keyboard calibration requires the actual saved native select.");
			const label = document.createElement("label");
			label.dataset.round72KeyboardCalibration = "plain-native-only";
			label.textContent = "Disposable plain native keyboard calibration";
			const select = document.createElement("select");
			select.style.cssText = "width:100%;height:44px";
			for (const option of node.options) select.append(new Option(option.text, option.value));
			label.append(select);
			node.closest(".bqa__transformation-form-controls")!.append(label);
		});
		const plain = this.root.locator("[data-round72-keyboard-calibration] select");
		let failure: {error: unknown} | undefined;
		try {
			expect(await plain.locator("option").evaluateAll(nodes => nodes.map(node => ({
				text: (node as HTMLOptionElement).text, value: (node as HTMLOptionElement).value,
			})))).toEqual(options);
			await expect(plain).toHaveValue("kernel-a");
			await this.beginRound72Keyboard(plain, width);
			await plain.focus();
			expect(await plain.evaluate(node => node.matches(":open")), "Plain calibration popup must start closed").toBe(false);
			await this.captureRound72Keyboard("plain-calibration-before-native-keys");
			if (isMac) await plain.pressSequentially("Kernel-only B");
			else {
				await plain.press("ArrowDown");
				await this.captureRound72Keyboard("plain-calibration-after-ArrowDown");
				await plain.press("Enter");
			}
			await expect(plain).toHaveValue("kernel-b");
			await expect(plain).toBeFocused();
			expect(await plain.evaluate(node => node.matches(":open"))).toBe(false);
			this.expectRound72NativeKeyboardChange(await this.captureRound72Keyboard("plain-calibration-positive-B", true));
			expect(await this.round72Snapshot(), "Plain keyboard calibration must not change the owner, consumers or Store").toEqual(before);
		} catch (error) { failure = {error}; }
		finally {
			try {
				if (this.keyboardActive) await this.captureRound72Keyboard("plain-calibration-failure", true);
				await plain.evaluate(node => node.parentElement!.remove());
			} catch (error) {
				this.diagnosticErrors.push(`Plain keyboard calibration cleanup failed: ${String(error)}`);
				if (!failure) failure = {error};
			}
		}
		if (failure) throw failure.error;
		expect(await this.round72Snapshot(), "Removing the disposable keyboard control must not change saved state").toEqual(before);
		return {isMac, before};
	}

	async round72DefaultAndResponsive (info: TestInfo) {
		await this.openRound72Bestiary(false);
		await this.choose("catalog:zombie|dmg");
		await this.expectLivePreview();
		await expect(this.root.locator(".bqa__transformation-resolution")).toHaveCount(0);
		await this.apply();
		await expect.poll(async () => (await this.round72Snapshot()).operations.length).toBe(1);
		const legacy = await this.round72Snapshot();
		expect(legacy.effective).toMatchObject({str: 16, hp: {average: 27}});
		expect(legacy.effective!.action![0].entries[0]).toContain("{@hit 4}");
		await this.page.locator(".bqa__changes .bqa__row").getByRole("button", {name: "Remove", exact: true}).click();
		await this.choose("race:fairy|mpmm");
		await this.chooseOption("Species spell grant and ability", "choice-1");
		await this.expectLivePreview();
		await expect(this.afterStatblock).toContainText(/fly 30 ft\. while not wearing medium or heavy armor/i);
		await expect(this.root.locator(".bqa__transformation-resolution")).toHaveCount(0);
		await this.apply();
		await expect.poll(async () => (await this.round72Snapshot()).operations.length).toBe(1);
		expect((await this.round72Snapshot()).effective).toMatchObject({type: "fey", hp: {average: 27}});
		await this.closeRound72Modal();
		await this.openRound72Bestiary();
		await this.useNightMode();
		await this.choose("catalog:zombie|dmg");
		await this.root.getByRole("button", {name: /^Review answers for /}).click();
		await expect(this.root.getByRole("combobox", {name: "Reviewed unchanged armor", exact: true})).toBeFocused();
		await this.fillRound72Bugbear();
		for (const width of [320, 390]) {
			await this.page.setViewportSize({width, height: 844});
			expect(await this.root.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
			expect(await this.textContrast(".bqa__transformation-delta li", ".bqa__transformation-delta")).toBeGreaterThanOrEqual(4.5);
			expect(await this.textContrast(".bqa__transformation-resolution legend", ".bqa__workspace")).toBeGreaterThanOrEqual(4.5);
			const infoBounds = await this.selectedRecipeInfo().boundingBox();
			expect(infoBounds).not.toBeNull();
			expect(infoBounds!.height).toBeGreaterThanOrEqual(44);
			expect(infoBounds!.width).toBeGreaterThanOrEqual(44);
			await this.selectedRecipeInfo().tap();
			await expect(this.nativeHover).toContainText("Zombie");
			const bounds = await this.nativeHover.boundingBox();
			expect(bounds).not.toBeNull();
			expect(bounds!.x).toBeGreaterThanOrEqual(0);
			expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
			await this.dismissNativeHover();
			await this.page.screenshot({path: info.outputPath(`round72-guided-night-${width}.png`), fullPage: true});
		}
		await this.closeRound72Modal();
		await this.seedRound72Kernel("registry");
		await this.useNightMode();
		for (const width of [320, 390]) {
			await this.page.setViewportSize({width, height: 844});
			await this.openRound72Saved();
			const picker = this.root.getByRole("combobox", {name: "Permitted saved form", exact: true});
			expect(await picker.locator("option").allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining("SupercalifragilisticexpialidociousMountainPass")]));
			const keyboard = await this.calibrateRound72Keyboard(picker, width);
			await this.beginRound72Keyboard(picker, width);
			await this.expectRound72FocusVisible(picker);
			await picker.focus();
			expect(await picker.evaluate(node => node.matches(":open")), "Actual popup must remain closed before the calibrated route").toBe(false);
			await this.captureRound72Keyboard("after-focus-before-native-keyboard-route");
			if (keyboard.isMac) await picker.pressSequentially("Kernel-only B");
			else {
				await picker.press("ArrowDown");
				await this.captureRound72Keyboard("after-ArrowDown-before-Enter");
				await picker.press("Enter");
			}
			const trace = await this.captureRound72Keyboard("after-native-keyboard-route-before-original-assertion", true);
			await expect(picker).toHaveValue("kernel-b");
			expect(await picker.evaluate(node => node.matches(":open"))).toBe(false);
			this.expectRound72NativeKeyboardChange(trace);
			expect(await this.round72Snapshot(), "Native saved selection previews B without changing the owner, consumers or Store").toEqual(keyboard.before);
			await this.expectRound72FocusVisible(picker);
			await expect(picker).toBeFocused();
			for (const control of [picker, this.root.getByRole("button", {name: "Switch form", exact: true})]) {
				const bounds = await control.boundingBox();
				expect(bounds).not.toBeNull();
				expect(bounds!.height).toBeGreaterThanOrEqual(44);
				expect(bounds!.x).toBeGreaterThanOrEqual(0);
				expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
			}
			await this.root.getByText("Saved profiles and receipts (read-only)", {exact: true}).press("Enter");
			expect(await this.root.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
			await this.page.screenshot({path: info.outputPath(`round72-saved-night-${width}.png`), fullPage: true});
			await this.root.getByRole("button", {name: "Cancel", exact: true}).press("Enter");
			await this.expectRound72FocusVisible(this.page.locator('[data-saved-operation-id="kernel-owner"]'));
			await expect(this.page.locator('[data-saved-operation-id="kernel-owner"]')).toBeFocused();
			expect((await this.round72Snapshot()).calls).toBe(0);
		}
	}
}
