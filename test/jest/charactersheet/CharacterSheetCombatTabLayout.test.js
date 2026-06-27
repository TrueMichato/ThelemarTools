/**
 * Combat-tab layout folds (bugs #6/#7/#8).
 *
 * Presentation/structure fixes that jsdom can't measure, so — like the existing
 * CharacterSheetResourceSpeedOverflowCss test — these pin the rules at the source
 * level:
 *  - #8 Weapon Masteries is folded INTO the Weapons & Attacks section (its
 *    #charsheet-masteries-group sits before #charsheet-combat-attacks) and is no
 *    longer a standalone .charsheet__section card. IDs are preserved so JS bindings
 *    keep working. Badges shrink to compact inline pills.
 *  - #6/#7 The standalone Arcane Shot section is removed from the HTML, and
 *    renderCombatArcaneArcher() is removed from the combat render() call-list
 *    (replaced by an in-resources fold-in).
 */

import fs from "fs";
import path from "path";

const REPO_ROOT = process.cwd();
const html = fs.readFileSync(path.resolve(REPO_ROOT, "charactersheet.html"), "utf8");
const css = fs.readFileSync(path.resolve(REPO_ROOT, "css/charactersheet.css"), "utf8");
const combatSrc = fs.readFileSync(path.resolve(REPO_ROOT, "js/charactersheet/charactersheet-combat.js"), "utf8");

/** Inner body of the first CSS rule whose selector exactly matches `selector`. */
function ruleBody (selector) {
	const re = new RegExp(`(^|[\\n}])\\s*${selector.replace(/[.*+?^${}()|[\]\\#-]/g, "\\$&")}\\s*\\{`, "m");
	const m = re.exec(css);
	if (!m) return null;
	const open = css.indexOf("{", m.index);
	const close = css.indexOf("}", open);
	return css.slice(open + 1, close);
}

describe("#8 Weapon Masteries folded into Weapons & Attacks", () => {
	it("nests #charsheet-masteries-group before #charsheet-combat-attacks (same section)", () => {
		const idxGroup = html.indexOf(`id="charsheet-masteries-group"`);
		const idxAttacks = html.indexOf(`id="charsheet-combat-attacks"`);
		const idxAttacksHeader = html.indexOf("Weapons & Attacks");
		expect(idxGroup).toBeGreaterThan(-1);
		expect(idxAttacksHeader).toBeGreaterThan(-1);
		// masteries group comes AFTER the Weapons & Attacks heading and BEFORE the attack list
		expect(idxGroup).toBeGreaterThan(idxAttacksHeader);
		expect(idxGroup).toBeLessThan(idxAttacks);
	});

	it("masteries group is a lightweight wrapper, not a standalone section card", () => {
		const m = html.match(/id="charsheet-masteries-group"[^>]*class="([^"]*)"/);
		expect(m).not.toBeNull();
		expect(m[1]).toContain("charsheet__masteries-group");
		expect(m[1]).not.toContain("charsheet__section");
	});

	it("preserves the edit pencil + container IDs so JS bindings are unchanged", () => {
		expect(html).toContain(`id="charsheet-edit-masteries"`);
		expect(html).toContain(`id="charsheet-combat-masteries"`);
	});

	it("badge CSS is a compact inline pill (row, smaller font than the old 0.85rem card)", () => {
		const badge = ruleBody(".charsheet__mastery-badge");
		expect(badge).not.toBeNull();
		expect(badge).toContain("flex-direction: row");
		// font-size shrank from 0.85rem → 0.72rem
		expect(badge).toContain("font-size: 0.72rem");
		expect(badge).not.toContain("font-size: 0.85rem");
	});
});

describe("#6/#7 standalone Arcane Shot section removed + folded in", () => {
	it("removes the standalone Arcane Shot section + container from the HTML", () => {
		expect(html).not.toContain(`id="charsheet-combat-arcanearcher-section"`);
		expect(html).not.toContain(`id="charsheet-combat-arcanearcher"`);
	});

	it("drops renderCombatArcaneArcher() from the combat render() call-list", () => {
		const m = combatSrc.match(/\trender\s*\(\)\s*\{[\s\S]*?\n\t\}/);
		expect(m).not.toBeNull();
		expect(m[0]).not.toContain("this.renderCombatArcaneArcher()");
		// the fold-in target is still rendered
		expect(m[0]).toContain("this.renderCombatResources()");
	});

	it("renderCombatResources folds in the Arcane Shot toggle", () => {
		const m = combatSrc.match(/renderCombatResources\s*\(\)\s*\{[\s\S]*?\n\t\}/);
		expect(m).not.toBeNull();
		expect(m[0]).toContain("this._renderArcaneShotToggle(container)");
	});

	it("Arcane Shot toggle defers use-tracking to the combat-resource pips", () => {
		const m = combatSrc.match(/_renderArcaneShotToggle\s*\(container\)\s*\{[\s\S]*?\n\t\}/);
		expect(m).not.toBeNull();
		const body = m[0];
		// gated on the subclass
		expect(body).toContain("this._state.hasArcaneShot?.()");
		// #10: uses are pip-tracked now — the toggle no longer renders its own
		// Use / +1 / Reset controls (those would double-render the resource).
		expect(body).not.toContain("charsheet__combat-as-use");
		expect(body).not.toContain("this._state.useArcaneShot?.()");
		// it points players at the pips instead
		expect(body).toContain("track uses with the pips above");
		// Ever-Ready Shot regain stays wired, and refresh persists + re-renders
		expect(body).toContain("this._state.regainOneArcaneShot?.()");
		expect(body).toContain("this._page.saveCharacter?.()");
		expect(body).toContain("this.renderCombatResources()");
		// hover link, not inline effect text
		expect(body).toContain("getHoverLink");
		expect(body).not.toContain("Renderer.get().render");
	});

	it("renderCombatResources surfaces Second Wind / Arcane Shot / Indomitable as pips", () => {
		const m = combatSrc.match(/renderCombatResources\s*\(\)\s*\{[\s\S]*?\n\t\}/);
		expect(m).not.toBeNull();
		// #9/#10/#17: Fighter limited-use abilities are pulled from the state's
		// synthetic-resource descriptors and rendered with the same pip markup.
		expect(m[0]).toContain("this._state.getSyntheticCombatResources?.()");
		expect(m[0]).toContain("_bindSyntheticResourcePipClicks");
	});
});
