import {expect, test, Page} from "@playwright/test";
import {CharacterSheetPage} from "../pages/CharacterSheetPage";
import {clearCharacterStorage} from "../utils/characterStorage";

/**
 * Regression coverage for the Add Item picker's Type/Rarity/Source filter dropdowns,
 * which used to render in effectively random screen locations.
 *
 * Three independent root causes, all fixed via targeted CSS (no JS coordinate emulation):
 *   1. `body.is-charsheet-page .ve-ui-modal__scroller { will-change: transform; }` gave every
 *      modal scroller a CSS containing block for `position:fixed` descendants — a spec'd side
 *      effect of `will-change: transform` (and of `transform`/`filter`/`perspective` themselves),
 *      not a browser bug. `FilterPickerHelpers.placeAnchoredPopover` already computed correct
 *      *viewport* coordinates via `getBoundingClientRect`, but the browser then resolved those
 *      `top`/`left` values against the scroller's own box instead. Fixed in `css/charactersheet.css`
 *      by scoping `will-change: scroll-position` (same compositor hint, no containing-block side
 *      effect) onto scrollers that contain `.charsheet__modal-list`.
 *   2. `.charsheet__source-multiselect-dropdown { transition: all ...; }` included discrete
 *      (non-interpolable) properties like `position`/`top`/`left`, so the menu briefly rendered at
 *      its old/default position for ~200ms after every open. Fixed by narrowing the transition to
 *      `opacity, transform, max-height`.
 *   3. Mobile only: `.ve-ui-modal__inner`'s *resting* `transform: translateY(0)` is a numeric no-op
 *      but still establishes a containing block per the CSS Transforms spec. Fixed in
 *      `css/charactersheet-mobile.css` by resting at `transform: none` instead (the slide-up
 *      entrance animation is unaffected).
 *
 * The Item and Spell pickers both place their filter menus via the shared
 * `FilterPickerHelpers.placeAnchoredPopover` (`position:fixed` + computed viewport coordinates), so
 * this file also spot-checks the Spell picker's Class filter to guard the shared fix (see the second
 * `describe` below). The Feat picker also shares `.charsheet__modal-list` and its scroller keeps the
 * same `will-change: transform`/`scroll-position` rule, but its filter dropdowns use a *different*,
 * CSS-only `position:absolute` mechanism anchored to their own container (see `_pShowFeatPickerModal`'s
 * local `positionDropdown` in `charactersheet-features.js`) — confirmed by reading the source, not
 * guessed — so they were never subject to root cause #1's containing-block bug itself. The third
 * `describe` below still smoke-tests it, since its modal shares the touched scroller rule and could
 * regress from an unrelated future change to that shared selector.
 *
 * Jest cannot see this bug at all: its DOM stub has no notion of CSS containing blocks (see
 * the scope note atop `test/jest/charactersheet/CharacterSheetFilterPickerHelpers.test.js`),
 * so this browser-level coverage is the only thing that would have caught it.
 */

/** Spawn a character in-memory (fast path — see `spawn.spec.ts`) and return its page object. */
async function spawnAndGoto (page: Page, spec: string): Promise<CharacterSheetPage> {
	await page.goto("/charactersheet.html", {waitUntil: "domcontentloaded"});
	await page.waitForFunction(() => !!(globalThis as any).charSheet?.spawn, null, {timeout: 120_000});
	const charSheet = new CharacterSheetPage(page);
	await charSheet.spawnCharacter(spec);
	return charSheet;
}

/**
 * Fully within the viewport. `placeAnchoredPopover` clamps so the menu stays a target `margin`
 * (8px) *inside* each edge, never past it — so this asserts near-zero overflow (a small
 * `subpixelTolerance` only, for rounding), not permission to spill past the viewport bound.
 */
function expectWithinViewport (rect: {x: number; y: number; width: number; height: number}, viewport: {width: number; height: number}, subpixelTolerance = 1): void {
	expect(rect.x).toBeGreaterThanOrEqual(0 - subpixelTolerance);
	expect(rect.y).toBeGreaterThanOrEqual(0 - subpixelTolerance);
	expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width + subpixelTolerance);
	expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height + subpixelTolerance);
}

/**
 * `computeAnchoredPopoverPlacement`'s default gap below the anchor button is 4px
 * (`charactersheet-filter-picker-helpers.js`). Assertions that a menu is placed "directly under"
 * its button use this tight tolerance (not a loose ~20px bound) so a smaller containing-block
 * regression — e.g. an extra scroller offset of only a few pixels — still fails the test.
 */
const DIRECTLY_UNDER_TOLERANCE_PX = 6;

/** Collect console errors/pageerrors raised after this is attached. */
function trackConsoleErrors (page: Page): string[] {
	const errors: string[] = [];
	page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
	page.on("pageerror", err => errors.push(err.message));
	return errors;
}

const FILTER_KINDS = ["type", "rarity", "source"] as const;

test.describe("Add Item picker — filter dropdown positioning", () => {
	test.beforeEach(async ({page}) => {
		await clearCharacterStorage(page);
	});

	test("Type/Rarity/Source dropdowns anchor directly under their buttons (desktop, unscrolled)", async ({page}) => {
		const consoleErrors = trackConsoleErrors(page);
		const charSheet = await spawnAndGoto(page, "fighter//1");
		await charSheet.openAddItemModal();
		await charSheet.openItemPickerFilters();

		for (const kind of FILTER_KINDS) {
			const {button, menu} = charSheet.itemPickerFilterDropdown(kind);
			await button.click();
			await expect(menu).toHaveClass(/\bopen\b/);
			await charSheet.waitForFilterMenuSettled(menu); // let the open transition settle before measuring

			const buttonBox = await button.boundingBox();
			const menuBox = await menu.boundingBox();
			expect(buttonBox, `${kind} button not visible`).toBeTruthy();
			expect(menuBox, `${kind} menu not visible/positioned`).toBeTruthy();
			// A real, non-degenerate box directly below its button — exactly what the
			// containing-block bug broke (menus rendered far off-position, sometimes
			// collapsed to near-zero height/width once genuinely mispositioned).
			expect(menuBox!.width).toBeGreaterThan(100);
			expect(menuBox!.height).toBeGreaterThan(50);
			expect(menuBox!.y).toBeGreaterThanOrEqual(buttonBox!.y);
			expect(menuBox!.y).toBeLessThan(buttonBox!.y + buttonBox!.height + DIRECTLY_UNDER_TOLERANCE_PX);
			// Narrows this test to the specific fixed-position/containing-block regression: the
			// menu must actually be using the viewport-coordinate mechanism the fix targets, not
			// merely happen to look correctly placed via some other (e.g. absolute) fallback.
			await expect(menu).toHaveClass(/charsheet__source-multiselect-dropdown--fixed/);
			expect(await menu.evaluate(el => getComputedStyle(el).position)).toBe("fixed");

			await button.click(); // close before the next iteration (exclusive popover)
		}

		expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("; ")}`).toEqual([]);
	});

	test("dropdown position stays viewport-relative when the modal is scrolled", async ({page}) => {
		const charSheet = await spawnAndGoto(page, "fighter//1");
		await charSheet.openAddItemModal();
		await charSheet.openItemPickerFilters();

		const scroller = charSheet.itemPickerScroller();
		const {scrollHeight, clientHeight} = await charSheet.getItemPickerScrollMetrics();
		expect(scrollHeight - clientHeight, "test precondition: the modal scroller must actually be scrollable").toBeGreaterThan(0);

		const scrollTopBefore = await charSheet.scrollItemPickerToBottom();
		expect(scrollTopBefore, "test precondition: scroll actually applied").toBeGreaterThan(0);
		// Setting scrollTop dispatches an async "scroll" event (the browser queues it for a later
		// task, not synchronously) which the modal scroller listens for to auto-close open menus.
		// If that event arrives *after* we open the menu below, it would close the menu we're
		// trying to measure. Let it fire and settle first.
		await page.waitForTimeout(200);

		const {button, menu} = charSheet.itemPickerFilterDropdown("type");
		const anchorBox = await button.boundingBox();
		// A normal Playwright `.click()` auto-scrolls its target into view as part of its
		// actionability checks, which could silently undo the manual scroll above and degrade
		// this test to the unscrolled case. Dispatch the click directly instead, so the scroller's
		// scrollTop is guaranteed untouched by the click itself.
		await charSheet.clickWithoutAutoScroll(button);
		await expect(menu).toHaveClass(/\bopen\b/);
		await charSheet.waitForFilterMenuSettled(menu);

		const scrollTopAfter = (await charSheet.getItemPickerScrollMetrics()).scrollTop;
		expect(scrollTopAfter, "the modal must still be scrolled when the menu is measured").toBe(scrollTopBefore);

		const menuBox = await menu.boundingBox();
		// This is the exact regression: pre-fix, the menu rendered offset by the scroller's
		// own on-screen position minus its scrollTop, instead of anchored under the button —
		// e.g. hundreds of pixels away, or clipped to a sliver by the scroller's own bounds.
		expect(menuBox!.y).toBeGreaterThanOrEqual(anchorBox!.y);
		expect(menuBox!.y).toBeLessThan(anchorBox!.y + anchorBox!.height + DIRECTLY_UNDER_TOLERANCE_PX);
		expect(Math.abs(menuBox!.x - anchorBox!.x)).toBeLessThan(4);
	});

	test("stays fully within a narrow/mobile viewport", async ({page}) => {
		const consoleErrors = trackConsoleErrors(page);
		const viewport = {width: 380, height: 700};
		await page.setViewportSize(viewport);
		const charSheet = await spawnAndGoto(page, "fighter//1");
		await charSheet.openAddItemModal();
		await charSheet.openItemPickerFilters();

		for (const kind of FILTER_KINDS) {
			const {button, menu} = charSheet.itemPickerFilterDropdown(kind);
			await button.click();
			await expect(menu, `${kind} menu did not open`).toHaveClass(/\bopen\b/);
			await charSheet.waitForFilterMenuSettled(menu);

			const buttonBox = await button.boundingBox();
			const menuBox = await menu.boundingBox();
			expect(buttonBox, `${kind} button not visible`).toBeTruthy();
			expect(menuBox, `${kind} menu not visible`).toBeTruthy();
			// Guard against a collapsed/closed box trivially satisfying the checks below: the
			// menu must actually be open with real, non-degenerate dimensions.
			expect(menuBox!.width).toBeGreaterThan(100);
			expect(menuBox!.height).toBeGreaterThan(50);
			// Vertical anchoring to the triggering button is independent of the horizontal-width
			// containment caveat below (a mispositioned/scroller-relative menu would fail this
			// regardless of how wide its content is), so assert it for every filter kind.
			expect(menuBox!.y).toBeGreaterThanOrEqual(buttonBox!.y);
			expect(menuBox!.y).toBeLessThan(buttonBox!.y + buttonBox!.height + DIRECTLY_UNDER_TOLERANCE_PX);
			expect(menuBox!.x).toBeGreaterThanOrEqual(-1);
			expect(menuBox!.y).toBeGreaterThanOrEqual(-1);
			expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(viewport.height + 1);
			// Source's content-driven width (`min-width:320px; max-width:400px`, wider than Type/
			// Rarity because source-book labels are longer) can legitimately exceed what fits
			// inside this narrow viewport with margins — that's a pre-existing content/design
			// property, not the positioning bug, and shrinking it would be a redesign outside this
			// fix's scope. Assert full right-edge containment only where the content actually fits;
			// otherwise assert the clamp still pins the menu to the left margin instead of some
			// other, wrong (e.g. off-screen or scroller-relative) location.
			if (menuBox!.width <= viewport.width - 16) {
				expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(viewport.width + 1);
			} else {
				expect(menuBox!.x).toBeLessThanOrEqual(9);
			}

			await button.click();
		}

		expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("; ")}`).toEqual([]);
	});

	test("Source dropdown (rightmost filter) flips alignment near the right edge without going offscreen", async ({page}) => {
		// Empirically confirmed live: at 480x700 the filter row does NOT wrap (all three
		// buttons stay on one row, unlike at e.g. 320px where flex-wrap can drop Source to its
		// own line), and a start-aligned Source menu would overflow the right edge here.
		const viewport = {width: 480, height: 700};
		await page.setViewportSize(viewport);
		const charSheet = await spawnAndGoto(page, "fighter//1");
		await charSheet.openAddItemModal();
		await charSheet.openItemPickerFilters();

		// Confirm the row precondition explicitly rather than just assuming it: Type and Source
		// must share a row (equal Y) for "rightmost filter" / the overflow math below to mean
		// what the test claims, instead of Source having wrapped onto its own line.
		const typeButtonBox = await charSheet.itemPickerFilterDropdown("type").button.boundingBox();
		const {button, menu} = charSheet.itemPickerFilterDropdown("source");
		const buttonBox = await button.boundingBox();
		expect(Math.abs(buttonBox!.y - typeButtonBox!.y), "test precondition: Type and Source must be on the same row").toBeLessThan(2);

		await button.click();
		await expect(menu).toHaveClass(/\bopen\b/);
		await charSheet.waitForFilterMenuSettled(menu);

		const menuBox = await menu.boundingBox();
		expect(menuBox).toBeTruthy();
		expect(menuBox!.width).toBeGreaterThan(100);
		expect(menuBox!.height).toBeGreaterThan(50);

		// Prove the flip was actually necessary: a naive start-aligned menu (left = button's own
		// left edge) would have overflowed the right edge of this viewport.
		expect(buttonBox!.x + menuBox!.width, "test precondition: start-alignment must overflow here").toBeGreaterThan(viewport.width);

		// The controller must have actually flipped to end-alignment, not just happened to fit.
		await expect(menu).toHaveClass(/\bopen-left\b/);
		expectWithinViewport(menuBox!, viewport);
	});

	test("resizing the viewport closes any open filter menu", async ({page}) => {
		const charSheet = await spawnAndGoto(page, "fighter//1");
		await charSheet.openAddItemModal();
		await charSheet.openItemPickerFilters();

		const {button, menu} = charSheet.itemPickerFilterDropdown("type");
		await button.click();
		await expect(menu).toHaveClass(/\bopen\b/);

		await page.setViewportSize({width: 900, height: 700});
		await page.waitForTimeout(150);

		await expect(menu).not.toHaveClass(/\bopen\b/);
	});

	test("only one filter menu is open at a time, and closed menus clear their inline positioning styles", async ({page}) => {
		const charSheet = await spawnAndGoto(page, "fighter//1");
		await charSheet.openAddItemModal();
		await charSheet.openItemPickerFilters();

		const typeDd = charSheet.itemPickerFilterDropdown("type");
		const rarityDd = charSheet.itemPickerFilterDropdown("rarity");

		await typeDd.button.click();
		await expect(typeDd.menu).toHaveClass(/\bopen\b/);

		await rarityDd.button.click();
		await expect(rarityDd.menu).toHaveClass(/\bopen\b/);
		await expect(typeDd.menu).not.toHaveClass(/\bopen\b/);

		// A closed menu must not retain the inline positioning styles from when it was
		// open — stale `top`/`left` would be silently wrong the next time anything reads
		// them (e.g. a future computed-style probe) before the popover repositions itself.
		const typeInlineStyle = await typeDd.menu.evaluate(el => ({
			position: (el as HTMLElement).style.position,
			top: (el as HTMLElement).style.top,
			left: (el as HTMLElement).style.left,
		}));
		expect(typeInlineStyle).toEqual({position: "", top: "", left: ""});

		// Close/reopen: re-opening Type after Rarity was open must still place it correctly.
		await typeDd.button.click();
		await charSheet.waitForFilterMenuSettled(typeDd.menu);
		await expect(typeDd.menu).toHaveClass(/\bopen\b/);
		await expect(rarityDd.menu).not.toHaveClass(/\bopen\b/);

		const typeButtonBox = await typeDd.button.boundingBox();
		const typeMenuBox = await typeDd.menu.boundingBox();
		expect(typeMenuBox!.y).toBeGreaterThanOrEqual(typeButtonBox!.y);
		expect(typeMenuBox!.y).toBeLessThan(typeButtonBox!.y + typeButtonBox!.height + DIRECTLY_UNDER_TOLERANCE_PX);
	});

	test("positions correctly in night mode, with no new console errors", async ({page}) => {
		const consoleErrors = trackConsoleErrors(page);
		const charSheet = await spawnAndGoto(page, "fighter//1");
		await charSheet.enableNightMode();

		await charSheet.openAddItemModal();
		await charSheet.openItemPickerFilters();
		const {button, menu} = charSheet.itemPickerFilterDropdown("type");
		await button.click();
		await charSheet.waitForFilterMenuSettled(menu);

		const buttonBox = await button.boundingBox();
		const menuBox = await menu.boundingBox();
		expect(menuBox!.y).toBeGreaterThanOrEqual(buttonBox!.y);
		expect(menuBox!.y).toBeLessThan(buttonBox!.y + buttonBox!.height + DIRECTLY_UNDER_TOLERANCE_PX);
		expect(menuBox!.width).toBeGreaterThan(100);

		expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("; ")}`).toEqual([]);
	});

	test("filter button opens its menu via keyboard, and its checkbox items are clickable", async ({page}) => {
		const charSheet = await spawnAndGoto(page, "fighter//1");
		await charSheet.openAddItemModal();
		await charSheet.openItemPickerFilters();

		const {button, menu} = charSheet.itemPickerFilterDropdown("type");
		await button.focus();
		await expect(button).toBeFocused();
		await page.keyboard.press("Enter");
		await expect(menu).toHaveClass(/\bopen\b/);
		await charSheet.waitForFilterMenuSettled(menu);

		// Keyboard-opened menus go through the same click handler as a mouse open, but this
		// guards against a future regression that only affects the keyboard path.
		const buttonBox = await button.boundingBox();
		const menuBox = await menu.boundingBox();
		expect(menuBox!.y).toBeGreaterThanOrEqual(buttonBox!.y);
		expect(menuBox!.y).toBeLessThan(buttonBox!.y + buttonBox!.height + DIRECTLY_UNDER_TOLERANCE_PX);

		// Each item's real `<input type=checkbox>` is intentionally `display:none` — a custom
		// checkbox styled via the sibling `.charsheet__source-multiselect-check` span, checked
		// through `:checked + …` — so the input itself is never focusable/visible by design (see
		// `.charsheet__source-multiselect-item input[type="checkbox"]` in charactersheet.css).
		// The supported interaction is clicking the item's `<label>`; verify that still toggles
		// the checkbox state now that the menu positions correctly.
		const firstItem = menu.locator(".charsheet__source-multiselect-item").first();
		const firstCheckbox = firstItem.locator("input[type=checkbox]");
		await expect(firstItem).toBeVisible();
		const checkedBefore = await firstCheckbox.isChecked();
		await firstItem.click();
		expect(await firstCheckbox.isChecked()).toBe(!checkedBefore);
	});
});

/**
 * The Spell picker reuses the exact same `.charsheet__modal-list` + `.charsheet__source-multiselect`
 * markup, CSS, and `FilterPickerHelpers.placeAnchoredPopover`-based positioning as the Item picker, so
 * the fix (and the bug it replaces) applies to its filter dropdowns too. This is a focused guard on
 * the Spell picker's always-visible Class filter, not a full re-run of the Item picker matrix.
 */
test.describe("Spell picker — Class filter (shared fix regression guard)", () => {
	test.beforeEach(async ({page}) => {
		await clearCharacterStorage(page);
	});

	test("Class filter dropdown anchors correctly under its button", async ({page}) => {
		const consoleErrors = trackConsoleErrors(page);
		const charSheet = await spawnAndGoto(page, "cleric//1");
		await charSheet.openAddSpellModal();

		const {button, menu} = charSheet.spellPickerClassDropdown();
		await button.click();
		await expect(menu).toHaveClass(/\bopen\b/);
		await charSheet.waitForFilterMenuSettled(menu);

		const buttonBox = await button.boundingBox();
		const menuBox = await menu.boundingBox();
		expect(buttonBox, "Class filter button not visible").toBeTruthy();
		expect(menuBox, "Class filter menu not visible/positioned").toBeTruthy();
		expect(menuBox!.width).toBeGreaterThan(100);
		expect(menuBox!.height).toBeGreaterThan(50);
		expect(menuBox!.y).toBeGreaterThanOrEqual(buttonBox!.y);
		expect(menuBox!.y).toBeLessThan(buttonBox!.y + buttonBox!.height + DIRECTLY_UNDER_TOLERANCE_PX);

		expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("; ")}`).toEqual([]);
	});
});

/**
 * The Feat picker's Category/Source filters position via a separate, local CSS-only
 * `position:absolute` mechanism (`positionDropdown` in `_pShowFeatPickerModal`,
 * charactersheet-features.js), not `FilterPickerHelpers.placeAnchoredPopover` — so they were never
 * affected by the containing-block bug itself. Its modal *does* share the touched
 * `.ve-ui-modal__scroller:has(.charsheet__modal-list)` CSS rule (the `will-change` fix), so this is
 * a smoke test confirming that change didn't regress its own, differently-implemented dropdown.
 */
test.describe("Feat picker — Category filter (shared scroller CSS smoke test)", () => {
	test.beforeEach(async ({page}) => {
		await clearCharacterStorage(page);
	});

	test("Category filter dropdown opens with a real, visible, on-screen box", async ({page}) => {
		const consoleErrors = trackConsoleErrors(page);
		const charSheet = await spawnAndGoto(page, "fighter//1");
		await charSheet.openAddFeatModal();

		const {button, menu} = charSheet.featPickerCategoryDropdown();
		await button.click();
		await expect(menu).toHaveClass(/\bopen\b/);
		await charSheet.waitForFilterMenuSettled(menu);

		const buttonBox = await button.boundingBox();
		const menuBox = await menu.boundingBox();
		expect(buttonBox, "Category filter button not visible").toBeTruthy();
		expect(menuBox, "Category filter menu not visible").toBeTruthy();
		expect(menuBox!.width).toBeGreaterThan(50);
		expect(menuBox!.height).toBeGreaterThan(50);
		// This dropdown is `position:absolute`, not `--fixed` — it never adopted viewport
		// coordinates, so it should still land directly under its own button post-fix.
		expect(menuBox!.y).toBeGreaterThanOrEqual(buttonBox!.y);
		expect(menuBox!.y).toBeLessThan(buttonBox!.y + buttonBox!.height + DIRECTLY_UNDER_TOLERANCE_PX);
		expect(await menu.evaluate(el => getComputedStyle(el).position)).toBe("absolute");

		expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("; ")}`).toEqual([]);
	});
});
