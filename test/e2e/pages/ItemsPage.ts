import {expect, Locator, Page} from "@playwright/test";

export interface MagicItemRowText {
	name: string;
	type: string;
	weight: string;
	value: string;
	attunement: string;
	rarity: string;
	source: string;
}

export class ItemsPage {
	readonly page: Page;

	constructor (page: Page) {
		this.page = page;
	}

	async goto (): Promise<void> {
		await this.page.goto("/items.html", {waitUntil: "domcontentloaded"});
		await this.page.waitForFunction(
			() => (globalThis as any).dbg_page?._magicList?.items?.length > 0,
			null,
			{timeout: 120_000},
		);

		const tgttToggle = this.page.locator("#tgtt-toggle-btn");
		await expect(tgttToggle).toBeVisible();
		if (await this.page.locator("body.tgtt-filter-active").count()) await tgttToggle.click();
	}

	async getMagicItemRowText (name: string, source: string): Promise<MagicItemRowText> {
		const row = await this._getMagicItemRow(name, source);
		const cells = (await row.locator(":scope > span").allTextContents()).map(it => it.trim());

		expect(cells, `${name}|${source} should render all seven magic-item row cells`).toHaveLength(7);

		return {
			name: cells[0],
			type: cells[1],
			weight: cells[2],
			value: cells[3],
			attunement: cells[4],
			rarity: cells[5],
			source: cells[6],
		};
	}

	async selectMagicItem (name: string, source: string): Promise<void> {
		await (await this._getMagicItemRow(name, source)).click();
		await expect(this.page.locator("#pagecontent .ve-stats__h-name")).toHaveText(name);
	}

	getSelectedItemDetails (): Locator {
		return this.page.locator("#pagecontent");
	}

	private async _getMagicItemRow (name: string, source: string): Promise<Locator> {
		const hash = await this.page.evaluate(
			({name, source}) => {
				const page = (globalThis as any).dbg_page;
				const item = page?._dataList?.find((it: any) => it.name === name && it.source === source);
				if (!item) throw new Error(`Could not find loaded item "${name}|${source}"`);
				return (globalThis as any).UrlUtil.autoEncodeHash(item);
			},
			{name, source},
		);

		const row = this.page.locator(`#list-magic a[href=${JSON.stringify(`#${hash}`)}]`);
		await expect(row, `${name}|${source} should have a rendered magic-item row`).toHaveCount(1);
		await expect(row, `${name}|${source} magic-item row should be visible`).toBeVisible();
		return row;
	}
}
