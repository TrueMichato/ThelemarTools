import {expect, type Page} from "@playwright/test";
import {CharacterSheetPage} from "./CharacterSheetPage";

interface RollPage {
	_showDiceResult: (title: string, total: number, breakdown: string, resultClass: string, note: string, opts: {duration: number}) => HTMLElement;
	_offerGuidedStrikePostAttack: (opts: {resultEl: HTMLElement; total: number}) => boolean;
	_resolveGuidedStrikeAbility: () => {resource: {current: number}; available: boolean};
	_playMode: {activate: () => void; deactivate: () => void; _openDrawerByType: (type: string) => void};
	_showAcBreakdownModal: () => Promise<void>;
}

declare global {
	interface Window {
		mobileRollFixture: RollPage;
	}
}

export class MobileRollResultPage {
	constructor (readonly page: Page) {}

	async goto () {
		const sheet = new CharacterSheetPage(this.page);
		await sheet.goto();
		await sheet.spawnCharacter("cleric/war/3/human");
		await this.dismissSiteToasts();
		await this.page.evaluate(() => {
			window.mobileRollFixture = Reflect.get(globalThis, "charSheet");
		});
	}

	async show ({tall = false, guidedStrike = false} = {}) {
		const offered = await this.page.evaluate(({tall, guidedStrike}) => {
			const breakdown = tall
				? Array.from({length: 35}, (_, i) => `Modifier ${i + 1}: 1d4 (3) + proficiency + ability`).join("<br>")
				: "1d20 (12) + 5";
			const el = window.mobileRollFixture._showDiceResult("War Cleric Attack", 17, breakdown, "", "Attack roll", {duration: 60000});
			return guidedStrike ? window.mobileRollFixture._offerGuidedStrikePostAttack({resultEl: el, total: 17}) : true;
		}, {tall, guidedStrike});
		expect(offered, "the spawned War Cleric must expose the real Guided Strike offer").toBe(true);
		await expect(this.page.locator(".charsheet__dice-result")).toBeVisible();
		// Wait for the incumbent slide-in animation, not a different/proxy toast.
		await this.page.locator(".charsheet__dice-result").evaluate(async el => {
			await Promise.all(el.getAnimations().map(animation => animation.finished));
		});
	}

	async geometry () {
		return this.page.evaluate(() => {
			const result = document.querySelector<HTMLElement>(".charsheet__dice-result")!;
			const rect = result.getBoundingClientRect();
			const chrome = [...document.querySelectorAll<HTMLElement>("#charsheet-tabs, .charsheet-mobile__status")].flatMap(el => {
				const r = el.getBoundingClientRect();
				const style = getComputedStyle(el);
				return style.position === "fixed" && style.visibility !== "hidden" && r.height > 0
					? [{selector: el.id || el.className, top: r.top, bottom: r.bottom, height: r.height}]
					: [];
			});
			const hit = (selector: string) => {
				const el = result.querySelector<HTMLElement>(selector)!;
				const r = el.getBoundingClientRect();
				return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
			};
			const body = result.querySelector<HTMLElement>(".charsheet__dice-result-body");
			const close = result.querySelector<HTMLElement>(".charsheet__dice-result-close")!.getBoundingClientRect();
			return {
				left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, height: rect.height,
				viewport: {width: innerWidth, height: innerHeight},
				chrome,
				closeHit: hit(".charsheet__dice-result-close"),
				totalHit: hit(".charsheet__dice-result-total"),
				breakdownHit: hit(".charsheet__dice-result-breakdown"),
				applyHit: result.querySelector(".charsheet__dice-result-gs-btn") ? hit(".charsheet__dice-result-gs-btn") : null,
				notNowHit: result.querySelector(".charsheet__dice-result-gs-dismiss") ? hit(".charsheet__dice-result-gs-dismiss") : null,
				closeSize: {width: close.width, height: close.height},
				body: body ? {height: body.clientHeight, scrollHeight: body.scrollHeight} : null,
				zIndex: Number(getComputedStyle(result).zIndex),
			};
		});
	}

	async expectClearance (label: string) {
		console.log(`${label} initial: ${JSON.stringify(await this.geometry())}`);
		await expect.poll(async () => {
			const g = await this.geometry();
			return g.bottom <= Math.min(g.viewport.height, ...g.chrome.map(el => el.top)) - 11;
		}, {message: `${label}: real roll result must clear actual visible fixed navigation`}).toBe(true);
		const geometry = await this.geometry();
		expect(geometry.top, `${label}: top is inside the viewport`).toBeGreaterThanOrEqual(11);
		expect(geometry.left).toBeGreaterThanOrEqual(0);
		expect(geometry.right).toBeLessThanOrEqual(geometry.viewport.width);
		expect(geometry.closeHit, `${label}: close is topmost`).toBe(true);
		expect(geometry.totalHit, `${label}: total is topmost`).toBe(true);
		if (geometry.applyHit !== null) expect(geometry.applyHit, `${label}: reaction is topmost`).toBe(true);
		if (geometry.notNowHit !== null) expect(geometry.notNowHit, `${label}: Not now is topmost`).toBe(true);
		console.log(`${label}: ${JSON.stringify(geometry)}`);
		return geometry;
	}

	async dismiss () {
		await this.page.getByRole("button", {name: "Dismiss roll result", exact: true}).click();
		await expect(this.page.locator(".charsheet__dice-result")).toHaveCount(0);
	}

	async dismissSiteToasts () {
		const close = this.page.locator(".toast__btn-close:visible");
		await close.evaluateAll(buttons => buttons.forEach(button => {
			if (!(button instanceof HTMLElement)) throw new Error("Invalid toast close control");
			button.click();
		}));
		await expect(close).toHaveCount(0);
	}

	async scaleText (percent: number) {
		await this.page.locator("#charsheet-textsize-input").evaluate((el, percent) => {
			if (!(el instanceof HTMLInputElement)) throw new Error("Missing text-size input");
			el.value = String(percent);
			el.dispatchEvent(new Event("change", {bubbles: true}));
		}, percent);
	}

	async safeArea (bottom: number) {
		const session = await this.page.context().newCDPSession(this.page);
		await session.send("Emulation.setSafeAreaInsetsOverride", {insets: {top: 24, bottom, left: 0, right: 0}});
		await session.detach();
	}

	async expectLastBreakdownLineReachable () {
		const body = this.page.getByRole("region", {name: "Roll breakdown", exact: true});
		await body.focus();
		await body.press("End");
		await expect.poll(() => body.evaluate(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(true);
		await body.evaluate(el => {
			const breakdown = el.querySelector(".charsheet__dice-result-breakdown")!;
			const range = document.createRange();
			range.selectNodeContents(breakdown.lastChild!);
			const last = range.getBoundingClientRect();
			const visible = el.getBoundingClientRect();
			// End exposes the trailing note; scroll back to read the final modifier.
			el.scrollTo({top: el.scrollTop + last.top - visible.top - (visible.height - last.height) / 2, behavior: "instant"});
		});
		console.log(`last breakdown line: ${JSON.stringify(await body.evaluate(el => {
			const range = document.createRange();
			range.selectNodeContents(el.querySelector(".charsheet__dice-result-breakdown")!.lastChild!);
			const rect = range.getBoundingClientRect();
			const body = el.getBoundingClientRect();
			return {lineTop: rect.top, lineBottom: rect.bottom, lineHeight: rect.height, bodyTop: body.top, bodyBottom: body.bottom, scrollTop: el.scrollTop};
		}))}`);
		await expect.poll(() => body.evaluate(el => {
			const breakdown = el.querySelector(".charsheet__dice-result-breakdown")!;
			const range = document.createRange();
			range.selectNodeContents(breakdown.lastChild!);
			const last = range.getBoundingClientRect();
			const visible = el.getBoundingClientRect();
			return last.top >= visible.top && last.bottom <= visible.bottom;
		})).toBe(true);
	}

	async guidedStrikeUses () {
		return this.page.evaluate(() => window.mobileRollFixture._resolveGuidedStrikeAbility().resource.current);
	}

	async dismissReaction () {
		await this.page.locator(".charsheet__dice-result-gs-dismiss").click();
		await expect(this.page.locator(".charsheet__dice-result-gs")).toHaveCount(0);
		await expect(this.page.locator(".charsheet__dice-result-total")).toHaveText("17");
	}

	async applyReaction () {
		await this.page.locator(".charsheet__dice-result-gs-btn").click();
		await expect(this.page.locator(".charsheet__dice-result-total")).toHaveText("27");
		await expect(this.page.locator(".charsheet__dice-result-gs")).toHaveCount(0);
		await this.dismissSiteToasts();
	}

	async expectModalOwnsControls () {
		await this.page.evaluate(() => window.mobileRollFixture._showAcBreakdownModal());
		const modal = this.page.locator(".ve-ui-modal__inner");
		await expect(modal).toBeVisible();
		await expect.poll(() => this.page.locator(".charsheet__dice-result").evaluate(el => ({
			z: getComputedStyle(el).zIndex,
			pointer: getComputedStyle(el).pointerEvents,
		}))).toEqual({z: "100", pointer: "none"});
		await modal.locator("button.ve-btn-primary").filter({hasText: /^Close$/}).click();
		await expect(modal).toHaveCount(0);
	}

	async openPlayDrawer () {
		await this.page.evaluate(() => window.mobileRollFixture._playMode._openDrawerByType("spells"));
		await expect(this.page.locator(".pm-drawer--open")).toBeVisible();
	}

	async closePlayDrawer () {
		await this.page.locator(".pm-drawer__close").click();
		await expect(this.page.locator(".pm-drawer--open")).toHaveCount(0);
	}

	async play (active: boolean) {
		await this.page.evaluate(active => {
			window.mobileRollFixture._playMode[active ? "activate" : "deactivate"]();
		}, active);
	}

	async resize (width: number, height: number) {
		await this.page.setViewportSize({width, height});
	}
}
