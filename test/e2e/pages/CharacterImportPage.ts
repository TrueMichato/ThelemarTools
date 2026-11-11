import {expect, type Locator, type Page} from "@playwright/test";
import {CharacterSheetPage} from "./CharacterSheetPage";

interface CharacterRecord {
	id: string;
	name: string;
	classes: {name: string; source: string; level: number}[];
	notes: {backstory: string};
}

interface ImportApp {
	_currentCharacterId: string;
	_export: unknown;
	_state: {
		getName: () => string;
		getNote: (field: string) => string;
		setName: (name: string) => void;
		setNote: (field: string, value: string) => void;
		toJSON: () => CharacterRecord;
	};
	saveCharacter: () => Promise<boolean>;
}

interface ImportStorage {
	pGet: (key: string) => Promise<CharacterRecord[]>;
	pSet: (key: string, value: unknown) => Promise<unknown>;
}

export interface ImportFixture {
	text: string;
	name: string;
	note: string;
	original: CharacterRecord;
	roster: CharacterRecord[];
}

export class CharacterImportPage {
	readonly dialog: Locator;
	readonly textarea: Locator;
	readonly confirm: Locator;
	readonly cancel: Locator;
	readonly trigger: Locator;

	constructor (readonly page: Page) {
		this.dialog = page.getByRole("dialog", {name: /Import Character/});
		this.textarea = this.dialog.locator("textarea");
		this.confirm = this.dialog.getByRole("button", {name: "Import", exact: true});
		this.cancel = this.dialog.getByRole("button", {name: "Cancel", exact: true});
		this.trigger = page.locator("#charsheet-btn-import");
	}

	async goto () {
		await this.page.goto("/charactersheet.html");
		await this.waitForReady();
	}

	async waitForReady () {
		await this.page.waitForFunction(() => {
			const app = Reflect.get(globalThis, "charSheet") as ImportApp | undefined;
			return !!app?._export && !!app._currentCharacterId;
		});
		await expect(this.page.locator("#charsheet-loading-overlay")).toHaveCount(0);
	}

	async fixture (): Promise<ImportFixture> {
		await new CharacterSheetPage(this.page).spawnSavedCharacter("fighter/champion/3/human", "Import survivor");
		const fixture = await this.page.evaluate(async () => {
			const app = Reflect.get(globalThis, "charSheet") as ImportApp;
			const storage = Reflect.get(globalThis, "StorageUtil") as ImportStorage;
			app._state.setNote("backstory", "Keep this original character and note.");
			if (!await app.saveCharacter()) throw new Error("Unable to persist import fixture");
			const original = app._state.toJSON();
			const name = "Real mobile import";
			const note = "Synthetic real-upload note. ".repeat(12000);
			app._state.setName(name);
			app._state.setNote("backstory", note);
			const text = JSON.stringify(app._state.toJSON(), null, 2);
			app._state.setName(original.name);
			app._state.setNote("backstory", original.notes.backstory);
			return {text, name, note, original, roster: await storage.pGet("charsheet-characters")};
		});
		expect(fixture.original.classes.map(({name, source, level}) => ({name, source, level}))).toEqual([{name: "Fighter", source: "TGTT", level: 3}]);
		return fixture;
	}

	async theme (night: boolean) {
		await this.page.evaluate(night => {
			document.documentElement.classList.toggle("ve-night-mode", night);
			document.documentElement.classList.toggle("ve-night-mode--standard", night);
		}, night);
	}

	async open () {
		const secondary = this.page.locator("#charsheet-header-secondary");
		if (await secondary.evaluate(el => el.classList.contains("charsheet__header-row--collapsed"))) {
			await this.page.locator("#charsheet-btn-more").click();
		}
		await expect.poll(() => secondary.evaluate(el => ({
			collapsed: el.classList.contains("charsheet__header-row--collapsed"),
			opacity: getComputedStyle(el).opacity,
			height: el.getBoundingClientRect().height > 0,
		}))).toEqual({collapsed: false, opacity: "1", height: true});
		await this.trigger.click();
		await expect(this.dialog).toBeVisible();
		await this.settle();
	}

	async settle (dialog = this.dialog) {
		await dialog.evaluate(async el => {
			await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
			await Promise.all(el.getAnimations({subtree: true}).map(animation => animation.finished));
			await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
		});
	}

	async upload (text: string) {
		await this.dialog.locator('input[type="file"]').setInputFiles({
			name: `mobile-${"long-valid-character-name-".repeat(7)}backup.json`,
			mimeType: "application/json",
			buffer: Buffer.from(text),
		});
		await expect(this.textarea).toHaveValue(text);
		await this.settle();
	}

	async measureAction (action: Locator) {
		return action.evaluate(el => {
			const rect = el.getBoundingClientRect();
			const centre = {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2};
			const vv = window.visualViewport;
			const viewport = {
				left: vv?.offsetLeft ?? 0, top: vv?.offsetTop ?? 0,
				width: vv?.width ?? innerWidth, height: vv?.height ?? innerHeight,
			};
			const ancestors = [];
			for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
				const style = getComputedStyle(ancestor);
				const box = ancestor.getBoundingClientRect();
				const left = box.left + ancestor.clientLeft;
				const top = box.top + ancestor.clientTop;
				const clipsPaint = /paint|strict|content/.test(style.contain);
				const clipsX = clipsPaint || /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
				const clipsY = clipsPaint || /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
				ancestors.push({
					class: ancestor.className, left, top,
					right: left + ancestor.clientWidth, bottom: top + ancestor.clientHeight,
					scrollTop: ancestor.scrollTop, clientHeight: ancestor.clientHeight, scrollHeight: ancestor.scrollHeight,
					clipped: (clipsX && (centre.x < left || centre.x > left + ancestor.clientWidth))
						|| (clipsY && (centre.y < top || centre.y > top + ancestor.clientHeight)),
				});
			}
			const hit = document.elementFromPoint(centre.x, centre.y);
			return {
				centre, viewport, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height,
				inViewport: centre.x >= viewport.left && centre.x <= viewport.left + viewport.width
					&& centre.y >= viewport.top && centre.y <= viewport.top + viewport.height,
				hit: el === hit || el.contains(hit),
				ancestors,
			};
		});
	}

	async expectActionsReachable (label: string) {
		await this.settle();
		for (const [name, action] of [["Import", this.confirm], ["Cancel", this.cancel]] as const) {
			const geometry = await this.measureAction(action);
			console.log(`${label} ${name}: ${JSON.stringify(geometry)}`);
			expect(geometry.inViewport, `${label}: ${name} centre must be inside visualViewport BEFORE click`).toBe(true);
			expect(geometry.ancestors.filter(ancestor => ancestor.clipped), `${label}: no clipping ancestor may exclude ${name}`).toEqual([]);
			expect(geometry.hit, `${label}: ${name} centre must hit its real control`).toBe(true);
			expect(geometry.top).toBeGreaterThanOrEqual(geometry.viewport.top);
			expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport.top + geometry.viewport.height);
		}
	}

	async scrollForm () {
		const box = await this.dialog.locator(".ve-ui-modal__scroller").boundingBox();
		if (!box) throw new Error("Missing import scrollport");
		const x = box.x + box.width / 2;
		const y = box.y + box.height * 0.6;
		if (this.page.context().browser()?.browserType().name() === "chromium" && await this.page.evaluate(() => matchMedia("(pointer: coarse)").matches)) {
			const session = await this.page.context().newCDPSession(this.page);
			await session.send("Input.synthesizeScrollGesture", {x, y, yDistance: -700, speed: 1100, gestureSourceType: "touch"});
			await session.detach();
		} else {
			await this.page.mouse.move(x, y);
			await this.page.mouse.wheel(0, 700);
		}
		await this.settle();
	}

	async focusTextarea ({scrollJson = true} = {}) {
		const visiblePoint = () => this.textarea.evaluate(el => {
			const rect = el.getBoundingClientRect();
			const scroller = el.closest(".ve-ui-modal__scroller")!.getBoundingClientRect();
			const vv = window.visualViewport;
			const top = Math.max(rect.top + 4, scroller.top + 4, vv?.offsetTop ?? 0);
			const bottom = Math.min(rect.bottom - 4, scroller.bottom - 4, (vv?.offsetTop ?? 0) + (vv?.height ?? innerHeight));
			return bottom > top ? {x: rect.left + rect.width / 2, y: (top + bottom) / 2} : null;
		});
		let point = await visiblePoint();
		if (!point) {
			await this.scrollForm();
			point = await visiblePoint();
		}
		if (!point) throw new Error("A real form scroll did not expose the textarea");
		await this.page.mouse.click(point.x, point.y);
		await expect(this.textarea).toBeFocused();
		if (scrollJson) {
			await this.textarea.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
			await expect.poll(() => this.textarea.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
		}
		await this.settle();
	}

	async paste (text: string) {
		await this.focusTextarea({scrollJson: false});
		await this.textarea.fill(text);
		await expect(this.textarea).toHaveValue(text);
	}

	async replaceCurrent () {
		await this.scrollForm();
		await this.dialog.getByRole("checkbox", {name: /Replace current character/}).check();
	}

	async confirmImport () {
		await this.expectActionsReachable("before unforced confirmation");
		await this.confirm.click();
	}

	async roster (): Promise<CharacterRecord[]> {
		return this.page.evaluate(async () => {
			const storage = Reflect.get(globalThis, "StorageUtil") as ImportStorage;
			return storage.pGet("charsheet-characters");
		});
	}

	async expectPersisted (fixture: ImportFixture, {replace = false} = {}) {
		await expect(this.dialog).toHaveCount(0);
		const read = () => this.page.evaluate(() => {
			const app = Reflect.get(globalThis, "charSheet") as ImportApp;
			return {id: app._currentCharacterId, data: app._state.toJSON()};
		});
		const selected = await read();
		expect(selected.data.name).toBe(fixture.name);
		expect(selected.data.notes.backstory).toBe(fixture.note);
		expect(selected.data.classes).toEqual(fixture.original.classes);
		expect(selected.id === fixture.original.id).toBe(replace);
		const roster = await this.roster();
		expect(roster).toHaveLength(fixture.roster.length + (replace ? 0 : 1));
		expect(roster.find(record => record.id === selected.id)?.name).toBe(fixture.name);
		expect(roster.find(record => record.id === selected.id)?.notes.backstory).toBe(fixture.note);
		if (!replace) {
			const survivor = roster.find(record => record.id === fixture.original.id)!;
			expect(survivor.name).toBe(fixture.original.name);
			expect(survivor.notes.backstory).toBe(fixture.original.notes.backstory);
		}
		await this.page.reload();
		await this.waitForReady();
		const reloaded = await read();
		expect(reloaded.id).toBe(selected.id);
		expect(reloaded.data.name).toBe(fixture.name);
		expect(reloaded.data.classes).toEqual(selected.data.classes);
		expect(reloaded.data.notes.backstory).toBe(fixture.note);
		const reloadedRoster = await this.roster();
		// Loading may reconcile generated features and stamp a new save revision.
		const content = (records: CharacterRecord[]) => records.map(({id, name, classes, notes}) => ({id, name, classes, notes}));
		expect(content(reloadedRoster)).toEqual(content(roster));
		if (!replace) {
			expect(reloadedRoster.find(record => record.id === fixture.original.id)).toEqual(roster.find(record => record.id === fixture.original.id));
		}
	}

	async expectOriginal (fixture: ImportFixture) {
		const current = await this.page.evaluate(() => {
			const app = Reflect.get(globalThis, "charSheet") as ImportApp;
			return app._state.toJSON();
		});
		expect(current.id).toBe(fixture.original.id);
		expect(current.name).toBe(fixture.original.name);
		expect(current.notes.backstory).toBe(fixture.original.notes.backstory);
		expect(await this.roster()).toEqual(fixture.roster);
	}

	async failFinalSaveOnce (importedName: string) {
		await this.page.evaluate(importedName => {
			const storage = Reflect.get(globalThis, "StorageUtil") as ImportStorage;
			const original = storage.pSet;
			let writes = 0;
			storage.pSet = async (key, value) => {
				const containsImport = key === "charsheet-characters" && Array.isArray(value)
					&& value.some(record => record.name === importedName);
				if (containsImport && ++writes === 2) throw new Error("S2 controlled final-save failure");
				return original.call(storage, key, value);
			};
		}, importedName);
	}

	async expectFailureDraft (text: string) {
		await expect(this.page.getByText("Could not save this character. Your sheet has been kept; retry or export a backup before leaving.", {exact: true})).toBeVisible();
		await expect(this.dialog).toBeVisible();
		await expect(this.textarea).toHaveValue(text);
		await expect(this.page.getByText("Failed to import: Invalid JSON data.", {exact: true})).toHaveCount(0);
		await expect(this.page.getByText(/^Imported .* successfully!$/)).toHaveCount(0);
	}

	async expectFocusAndCancel (fixture: ImportFixture) {
		await this.focusTextarea();
		await this.confirm.focus();
		await this.page.keyboard.press("Tab");
		await expect(this.dialog.getByRole("button", {name: "Close", exact: true})).toBeFocused();
		await this.page.keyboard.press("Shift+Tab");
		await expect(this.confirm).toBeFocused();
		await this.textarea.focus();
		await this.page.keyboard.press("Escape");
		await expect(this.dialog).toHaveCount(0);
		await expect(this.trigger).toBeFocused();
		await this.expectOriginal(fixture);
		await this.open();
		await expect(this.textarea).toHaveValue("");
		await expect(this.dialog.locator('input[type="file"]')).toHaveValue("");
		await this.upload(fixture.text);
		await this.expectActionsReachable("before unforced Cancel");
		await this.cancel.click();
		await expect(this.dialog).toHaveCount(0);
		await expect(this.trigger).toBeFocused();
		await this.expectOriginal(fixture);
	}

	async expectExportUnaffected () {
		await this.page.locator("#charsheet-btn-export").click();
		const dialog = this.page.getByRole("dialog", {name: /Export Character/});
		await expect(dialog).toBeVisible();
		await this.settle(dialog);
		await expect(dialog.locator('[class*="charsheet__import-"]')).toHaveCount(0);
		await expect(dialog.locator(".ve-ui-modal__footer")).toHaveCount(0);
		const download = dialog.getByRole("button", {name: /Download/});
		const geometry = await this.measureAction(download);
		expect(geometry.inViewport && geometry.hit).toBe(true);
		expect(geometry.ancestors.filter(ancestor => ancestor.clipped)).toEqual([]);
		await dialog.getByRole("button", {name: "Close", exact: true}).filter({hasNot: this.page.locator(".glyphicon")}).click();
		await expect(dialog).toHaveCount(0);
	}
}
