import {expect, Page} from "@playwright/test";

interface Decision {
	type: string;
	semanticKey: string;
	status: string;
	selection: unknown;
	provenance: {ownerUid: string};
}

interface Issue {
	semanticKey: string;
	message: string;
	carriedForward: boolean;
}

interface LegacySnapshot {
	background: {name: string; source: string};
	skillProficiencies: Record<string, number>;
	toolProficiencies: string[];
	levelHistory: Array<{
		level: number;
		class: {name: string; source: string};
		choices: {skills?: string[]};
		decisions?: Decision[];
		complete: boolean;
		manifestComplete: boolean;
	}>;
	progressionOwnership?: object;
}

interface Runtime {
	_state: {toJson(): LegacySnapshot};
	_respec: {
		_state: {toJson(): LegacySnapshot};
		_engine: {
			isDirty: boolean;
			manifest: {decisions: Decision[]};
			getValidation(): {isValid: boolean; canApply: boolean; errors: Issue[]; carriedForwardIssues: Issue[]; blockingErrors: Issue[]};
		};
	};
}

export class RespecPartialRepairPage {
	constructor (readonly page: Page) {}

	async importLegacyMissingSkillRecord () {
		const legacy = await this.page.evaluate(() => {
			const cs: Runtime = Reflect.get(globalThis, "charSheet");
			return cs._state.toJson();
		});
		expect(legacy.background).toMatchObject({name: "Outlander", source: "PHB"});
		const first = legacy.levelHistory.find(entry => entry.level === 1);
		if (!first?.choices.skills?.length) throw new Error("The exported fixture has no recorded starting skills to remove.");
		for (const skill of first.choices.skills) {
			const key = skill.toLowerCase().replace(/\s+/g, "").replace(/'s?/g, "");
			if (!["athletics", "survival"].includes(key)) legacy.skillProficiencies[key] = 0;
		}
		delete first.choices.skills;
		first.decisions = (first.decisions || []).filter(decision => decision.type !== "skills");
		first.complete = false;
		first.manifestComplete = false;
		delete legacy.progressionOwnership;
		const secondary = this.page.locator("#charsheet-header-secondary");
		if ((await secondary.getAttribute("class"))?.includes("charsheet__header-row--collapsed")) {
			await this.page.locator("#charsheet-btn-more").click();
			await expect(secondary).not.toHaveClass(/charsheet__header-row--collapsed/);
		}
		await this.page.locator("#charsheet-btn-import").click();
		const modal = this.page.locator(".ve-ui-modal__overlay:visible").last();
		await modal.getByPlaceholder("Paste character JSON data here...").fill(JSON.stringify(legacy));
		await modal.locator("label").filter({hasText: "Replace current character"}).locator('input[type="checkbox"]').check();
		await modal.getByRole("button", {name: "Import", exact: true}).click();
		await expect(modal).toBeHidden();
	}

	async showMobileRepairLayout () {
		await this.page.setViewportSize({width: 390, height: 844});
		await expect(this.page.locator("body")).toHaveClass(/\bis-charsheet-mobile\b/);
		await expect(this.page.locator('a[href="#charsheet-tab-respec"]')).toBeHidden();
		await expect(this.page.locator(".charsheet-mobile__tab-more > a")).toBeVisible();
	}

	async evidence () {
		return this.page.evaluate(() => {
			const cs: Runtime = Reflect.get(globalThis, "charSheet");
			return {
				live: cs._state.toJson(),
				draft: cs._respec._state.toJson(),
				decisions: cs._respec._engine.manifest.decisions,
				validation: cs._respec._engine.getValidation(),
				isDirty: cs._respec._engine.isDirty,
			};
		});
	}

	async review () {
		await this.page.locator("#charsheet-respec-review").click();
		const review = this.page.locator(".charsheet__respec-review:visible");
		await expect(review).toBeVisible();
		const text = await review.innerText();
		await review.getByRole("button", {name: "Close", exact: true}).click();
		return text;
	}

	async apply (accept: boolean, remaining: Issue[]) {
		await expect(this.page.locator("#charsheet-respec-apply")).toBeEnabled();
		await this.page.locator("#charsheet-respec-apply").click();
		const heading = this.page.getByRole("heading", {name: "Apply Respec With Remaining Issues", exact: true});
		await expect(heading).toBeVisible();
		const modal = this.page.locator(".ve-ui-modal__overlay:visible").filter({has: heading});
		await expect(modal).toContainText(`${remaining.length} unchanged issues will remain`);
		for (const issue of remaining) await expect(modal).toContainText(issue.message);
		await modal.getByRole("button", {name: accept ? /Apply Changes and Keep Issues$/ : /Keep Reviewing$/}).click({timeout: 10_000});
		await expect(modal).toBeHidden();
		if (accept) await expect(this.page.locator("#charsheet-respec-draft-status")).toContainText("2 unchanged issues will remain");
	}

	async expectRemainingStatus () {
		await expect(this.page.locator("#charsheet-respec-draft-status")).toContainText("2 unchanged issues will remain");
		await expect(this.page.locator("#charsheet-respec-apply")).toBeDisabled();
	}
}
