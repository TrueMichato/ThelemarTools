import {expect, test} from "@playwright/test";
import {MobileRollResultPage} from "../pages/MobileRollResultPage";

test.use({hasTouch: true});

test("real roll results clear mobile chrome across posture changes and preserve desktop placement", async ({page}) => {
	test.setTimeout(180000);
	const roll = new MobileRollResultPage(page);
	await roll.goto();
	await roll.resize(554, 740);
	await roll.show();
	await roll.expectClearance("portrait 554");

	for (const [width, height] of [[320, 640], [390, 844], [844, 320], [1280, 900]]) {
		await roll.resize(width, height);
		const geometry = await roll.expectClearance(`${width}x${height} resize while visible`);
		if (width === 1280) {
			expect(geometry.bottom).toBe(880);
			expect(geometry.right).toBe(1260);
		} else {
			expect(geometry.closeSize.width).toBeGreaterThanOrEqual(44);
			expect(geometry.closeSize.height).toBeGreaterThanOrEqual(44);
		}
	}
	await roll.dismiss();
});

test("long scaled breakdown stays scrollable with reachable Guided Strike, dismissal, and modal controls", async ({page}) => {
	test.setTimeout(180000);
	const roll = new MobileRollResultPage(page);
	await roll.goto();
	await roll.resize(390, 844);
	await roll.show({tall: true, guidedStrike: true});
	const geometry = await roll.expectClearance("tall breakdown");
	expect(geometry.body!.scrollHeight).toBeGreaterThan(geometry.body!.height);
	await roll.expectLastBreakdownLineReachable();
	const uses = await roll.guidedStrikeUses();
	await roll.dismissReaction();
	expect(await roll.guidedStrikeUses()).toBe(uses);
	await roll.show({tall: true, guidedStrike: true});
	await roll.scaleText(150);
	await roll.safeArea(32);
	const scaled = await roll.expectClearance("150% text + safe area");
	expect(scaled.body!.height).toBeGreaterThan(30);
	expect(scaled.body!.scrollHeight).toBeGreaterThan(scaled.body!.height);
	expect(Math.min(...scaled.chrome.map(el => el.top)) - scaled.bottom).toBe(12);
	expect(scaled.chrome.find(el => el.selector === "charsheet-tabs")!.height).toBeGreaterThan(80);
	await roll.expectLastBreakdownLineReachable();
	const screenshot = test.info().outputPath("scaled-mobile-roll.png");
	await page.screenshot({path: screenshot});
	await test.info().attach("scaled-mobile-roll", {path: screenshot, contentType: "image/png"});
	await roll.applyReaction();
	expect(await roll.guidedStrikeUses()).toBe(uses - 1);
	await roll.expectModalOwnsControls();
	await roll.expectClearance("modal closed");
	await roll.scaleText(100);
	await roll.safeArea(0);
	await roll.resize(844, 320);
	await roll.show({tall: true, guidedStrike: true});
	const landscape = await roll.expectClearance("tall landscape + reaction");
	expect(landscape.body!.height).toBeGreaterThan(20);
	await roll.expectLastBreakdownLineReachable();
	await roll.dismiss();
});

test("Play Mode uses its actual visible chrome, not hidden Manager tabs", async ({page}) => {
	test.setTimeout(180000);
	const roll = new MobileRollResultPage(page);
	await roll.goto();
	await roll.resize(390, 844);
	await roll.play(true);
	await expect(page.locator("#charsheet-tabs")).toBeHidden();
	await roll.show();
	await roll.expectClearance("Play Mode portrait");
	await roll.openPlayDrawer();
	await roll.expectClearance("Play Mode spells drawer");
	await roll.closePlayDrawer();
	await roll.resize(844, 320);
	await roll.expectClearance("Play Mode landscape");
	await roll.play(false);
	await expect(page.locator("#charsheet-tabs")).toBeVisible();
	await roll.expectClearance("Manager restored while visible");
	await roll.dismiss();
});
