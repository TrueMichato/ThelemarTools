import {expect, Page} from "@playwright/test";

interface OriginSnapshot {
	background: {name: string; source: string};
	abilityBonuses: Record<string, number>;
	skillProficiencies: Record<string, number>;
	languages: string[];
	toolProficiencies: string[];
	feats: Array<{name: string; source: string; sourceDecisionKey: string}>;
	characterBase: {decisions: Array<{type: string; status: string; selection: unknown; semanticKey: string}>};
}

interface RespecRuntime {
	_state: {toJson(): OriginSnapshot};
	_respec: {_state: {toJson(): OriginSnapshot}; _engine: {getValidation(): {errors: unknown[]}}};
}

export class RespecBackgroundPage {
	private needsConfirmation = false;

	constructor (readonly page: Page) {}

	get modal () { return this.page.locator(".ve-ui-modal__overlay:visible").last(); }

	async select (name: string, source: string) {
		await this.modal.locator(".charsheet__respec-search-row input").fill(name);
		const row = this.modal.locator(".charsheet__respec-feat-item")
			.filter({has: this.page.locator("strong").filter({hasText: new RegExp(`^${name}$`)})})
			.filter({has: this.page.locator("span.text-muted").filter({hasText: new RegExp(`^${source === "XPHB" ? "PHB'24" : source === "PHB" ? "PHB'14" : source}$`)})});
		await expect(row).toHaveCount(1);
		this.needsConfirmation = !await row.evaluate(element => element.classList.contains("charsheet__respec-feat-current"));
		await row.click();
		await expect(this.modal.locator(".charsheet__respec-choices-panel")).toContainText("Complete every new or changed background choice");
	}

	async choose (type: string, labels: string[], index = 0) {
		const row = this.modal.locator(`[data-background-decision="${type}"]`).nth(index);
		await row.getByRole("button", {name: /Choose|Change/}).click();
		const editor = this.modal.locator(".charsheet__respec-decision-editor").last();
		for (const label of labels) await editor.locator("label").filter({hasText: label}).locator("input").check();
		await editor.getByRole("button", {name: "Stage Choice", exact: true}).click();
		await expect(editor).toBeHidden();
	}

	async completeMissing () {
		for (let attempt = 0; attempt < 15; attempt++) {
			const row = this.modal.locator("[data-background-decision]").filter({hasText: "(missing)"}).first();
			if (!await row.count()) return;
			await row.getByRole("button", {name: "Choose", exact: true}).click();
			const editor = this.modal.locator(".charsheet__respec-decision-editor").last();
			const countText = await editor.locator(".charsheet__respec-selection-count").textContent();
			const count = Number(countText?.split("/")[1]?.split(" ")[0]);
			expect(count).toBeGreaterThan(0);
			for (let pick = 0; pick < count; pick++) await editor.locator("label input").nth(pick).check();
			await editor.getByRole("button", {name: "Stage Choice", exact: true}).click();
			await expect(editor).toBeHidden();
		}
		throw new Error("Background choices did not complete within the bounded picker pass.");
	}

	async commit () {
		const modal = this.modal;
		const button = modal.getByRole("button", {name: "Change Background", exact: true});
		await expect(button).toBeEnabled();
		await button.click();
		if (this.needsConfirmation) {
			const heading = this.page.getByRole("heading", {name: "Confirm Background Change", exact: true});
			await expect(heading).toBeVisible();
			const confirmation = this.page.locator(".ve-ui-modal__overlay:visible").filter({has: heading});
			await confirmation.getByRole("button", {name: /Change Background/}).click();
		}
		await expect(this.page.locator(".charsheet__respec-search-row input").filter({visible: true})).toHaveCount(0);
	}

	async cancel () {
		await this.modal.locator(".charsheet__respec-btn-row").last().getByRole("button", {name: "Cancel", exact: true}).click();
	}

	async evidence () {
		return this.page.evaluate(() => {
			const cs: RespecRuntime = Reflect.get(globalThis, "charSheet");
			return {live: cs._state.toJson(), draft: cs._respec._state.toJson(), validation: cs._respec._engine.getValidation()};
		});
	}

	async undo () {
		await this.page.locator("#charsheet-respec-undo").click();
	}
}
