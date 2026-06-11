/**
 * Round 12 — Bug #13: the always-empty Overview "Abilities" section was removed.
 *
 * Custom abilities are managed in the Features tab (charactersheet-customabilities.js),
 * so the redundant Overview section + its render cluster were deleted to reclaim space.
 * These source-pins guard against the markup/method/CSS creeping back in.
 */

import "./setup.js";
import {readFileSync} from "fs";
import {resolve, dirname} from "path";
import {fileURLToPath} from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..", "..");

describe("Bug #13 — Overview Abilities section removed", () => {
	const html = readFileSync(resolve(REPO_ROOT, "charactersheet.html"), "utf8");
	const charsheetSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet.js"), "utf8");
	const combatSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-combat.js"), "utf8");
	const customSrc = readFileSync(resolve(REPO_ROOT, "js/charactersheet/charactersheet-customabilities.js"), "utf8");
	const css = readFileSync(resolve(REPO_ROOT, "css/charactersheet.css"), "utf8");

	it("removes the Overview Abilities markup", () => {
		expect(html).not.toContain("charsheet__section--abilities");
		expect(html).not.toContain("charsheet-overview-abilities");
	});

	it("removes the _renderOverviewAbilities method and all of its call-sites", () => {
		expect(charsheetSrc).not.toContain("_renderOverviewAbilities");
		expect(combatSrc).not.toContain("_renderOverviewAbilities");
		expect(customSrc).not.toContain("_renderOverviewAbilities");
	});

	it("removes the now-dead overview ability helpers", () => {
		expect(charsheetSrc).not.toContain("_useOverviewAbility");
		expect(charsheetSrc).not.toContain("_showAbilityDetailModal");
	});

	it("removes the orphaned Overview Abilities CSS rules", () => {
		expect(css).not.toContain(".charsheet__section--abilities");
		expect(css).not.toContain(".charsheet__abilities-list");
		expect(css).not.toContain(".charsheet__ability-row");
	});

	it("keeps the still-shared classes used elsewhere", () => {
		// Ability-score cards + Resources caption + combat ability-detail modal.
		expect(css).toContain(".charsheet__ability-name");
		expect(css).toContain(".charsheet__section-caption");
		expect(css).toContain(".charsheet__ability-detail-modal");
		// Custom abilities remain managed in the Features tab.
		expect(customSrc).toContain("_showAbilityModal");
	});
});
