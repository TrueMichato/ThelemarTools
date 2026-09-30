import {expect, type Page} from "@playwright/test";

export class CreatureTransformationPage {
	constructor (readonly page: Page) {}

	get root () { return this.page.locator(".bqa__transformation:visible"); }

	async choose (id: string) {
		await this.root.getByRole("combobox", {name: "Creature transformation"}).selectOption(id);
	}

	async chooseOption (group: string, value: string) {
		await this.root.getByRole("combobox", {name: group}).selectOption(value);
	}

	async acknowledge () {
		const group = this.root.getByRole("group", {name: "Confirm before preview"});
		const checks = group.getByRole("checkbox");
		for (let ix = 0; ix < await checks.count(); ix++) await checks.nth(ix).check();
	}

	async preview ({bulk = false}: {bulk?: boolean} = {}) {
		await this.root.getByRole("button", {name: bulk ? "Preview selected monsters" : "Preview transformation"}).click();
		await expect(this.root.locator(".bqa__transformation-target").first()).toBeVisible();
		await expect(this.root.locator(".bqa__transformation-statblock")).toHaveCount(bulk ? 4 : 2);
	}

	async acknowledgeReview () {
		await this.root.getByRole("checkbox", {name: /I understand these items still require manual DM review/}).check();
	}

	async pickIncomingWinners () {
		const selectors = this.root.locator(".bqa__transformation-target select[data-conflict-id]");
		const count = await selectors.count();
		expect(count).toBeGreaterThan(0);
		for (let ix = 0; ix < count; ix++) await selectors.nth(ix).selectOption("incoming");
	}

	async apply ({bulk = false, count = 1}: {bulk?: boolean, count?: number} = {}) {
		await this.acknowledgeReview();
		await this.root.getByRole("button", {name: bulk ? `Apply to ${count} · one save` : "Apply transformation"}).click();
		if (bulk) await expect(this.page.locator("#ew-status")).toContainText("Saved statblock edits");
	}
}
