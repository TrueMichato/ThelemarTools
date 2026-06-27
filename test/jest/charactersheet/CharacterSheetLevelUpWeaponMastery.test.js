import "./setup.js";
import {jest} from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import {fileURLToPath} from "url";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bug #4 (level-up side) — Weapon Mastery picker must pre-seed existing masteries
 * as checked and must NOT enforce a minimum (the user may pick fewer / skip).
 *
 * The level-up render (`_renderWeaponMasteryLevelUp`) marks `selected.includes(key)`
 * as checked; the caller pre-seeds `selected` from the character's current masteries.
 * The blocking validation that previously rejected fewer-than-count was removed and
 * the section status is always "complete".
 *
 * `charactersheet-levelup.js` destructures `e_` from globalThis at module-eval time,
 * so this suite installs a class/tag-aware element factory BEFORE importing the
 * module (the default node-env stub returns null from querySelector).
 */

function makeEl (outer = "<div></div>") {
	const classMatch = /class="([^"]*)"/.exec(outer);
	const classes = new Set((classMatch?.[1] || "").split(/\s+/).filter(Boolean));
	return {
		_outer: outer,
		_classes: classes,
		_children: [],
		textContent: "",
		append (...kids) { for (const k of kids) this._children.push(k); },
		appendChild (k) { this._children.push(k); return k; },
		addEventListener () {},
		setAttribute () {},
		getAttribute () { return null; },
		_descendants () {
			const out = [];
			for (const c of this._children) {
				if (c && typeof c === "object" && c._classes) { out.push(c, ...c._descendants()); }
			}
			return out;
		},
		_synth: {},
		querySelector (sel) {
			if (sel.startsWith(".")) {
				const cls = sel.slice(1);
				const found = this._descendants().find(d => d._classes.has(cls));
				if (found) return found;
				// The element this references may live inside this element's own template
				// string (e.g. the mastery container / count span). Synthesize a real,
				// appendable child once and cache it so children appended through it are
				// reachable via `_descendants()`.
				if (new RegExp(`class="[^"]*\\b${cls}\\b`).test(this._outer)) {
					if (!this._synth[cls]) {
						const child = makeEl(`<div class="${cls}"></div>`);
						this._synth[cls] = child;
						this._children.push(child);
					}
					return this._synth[cls];
				}
				return null;
			}
			if (new RegExp(`<${sel}\\b`, "i").test(this._outer)) {
				return {checked: /\bchecked\b/.test(this._outer), addEventListener () {}, setAttribute () {}};
			}
			return null;
		},
		querySelectorAll () { return []; },
		get outerHTML () { return this._outer; },
	};
}

let CharacterSheetLevelUp;

beforeAll(async () => {
	globalThis.e_ = (opts = {}) => makeEl(opts.outer || opts.html || "<div></div>");
	await import("../../../js/charactersheet/charactersheet-levelup.js");
	CharacterSheetLevelUp = globalThis.CharacterSheetLevelUp;
});

describe("LevelUp Weapon Mastery picker — optional + pre-seed (Bug #4)", () => {
	beforeEach(() => { globalThis.JqueryUtil = {doToast: jest.fn()}; });

	const LONGSWORD = {name: "Longsword", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Sap|XPHB"]};
	const SHORTSWORD = {name: "Shortsword", source: "XPHB", _isBaseItem: true, type: "M", weaponCategory: "martial", mastery: ["Vex|XPHB"]};

	function makeLevelUp () {
		const lu = Object.create(CharacterSheetLevelUp.prototype);
		lu._page = {getItems: () => [LONGSWORD, SHORTSWORD]};
		return lu;
	}

	it("renders a pre-seeded mastery as a checked checkbox", () => {
		const lu = makeLevelUp();
		const selected = ["Longsword|XPHB"]; // pre-seeded from existing masteries
		const section = lu._renderWeaponMasteryLevelUp({count: 3}, selected);

		const labels = section._descendants().filter(d => /<input/.test(d._outer));
		const longsword = labels.find(d => /Longsword\|XPHB/.test(d._outer));
		const shortsword = labels.find(d => /Shortsword\|XPHB/.test(d._outer));
		expect(longsword._outer).toContain("checked");
		expect(shortsword._outer).not.toContain("checked");
	});

	it("does not block / toast when fewer than `count` masteries are selected", () => {
		const lu = makeLevelUp();
		const selected = []; // user skipped
		expect(() => lu._renderWeaponMasteryLevelUp({count: 3}, selected)).not.toThrow();
		expect(globalThis.JqueryUtil.doToast).not.toHaveBeenCalled();
	});

	// Regression guard: the render-only tests above can't exercise the submit/continue
	// closure (a large DOM-coupled handler that can't be unit-isolated under the node
	// env). This pins the exact removed behaviour at the source level so a future edit
	// can't silently reintroduce the blocking "must choose N masteries" validation.
	it("submit handler no longer contains the blocking weapon-mastery validation", () => {
		const src = fs.readFileSync(
			path.resolve(__dirname, "../../../js/charactersheet/charactersheet-levelup.js"),
			"utf8",
		);
		// Old blocking branch compared selection length to the gain count and returned.
		expect(src).not.toMatch(/selectedWeaponMasteries\.length\s*<\s*weaponMasteryGain\.count/);
	});
});
