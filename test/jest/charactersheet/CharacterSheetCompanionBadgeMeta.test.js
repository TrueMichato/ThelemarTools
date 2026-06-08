/**
 * Bug #14 — dedicated Familiar indicator.
 *
 * `CharacterSheetClassUtils.getCompanionBadgeMeta(companion)` is a PURE helper
 * resolving a companion's TYPE to display metadata the Overview companions
 * indicator uses to render a clear, type-specific badge — and, critically, an
 * unmistakable badge when a FAMILIAR is summoned so the player can't forget it.
 *
 * The helper deliberately uses literal companion-type strings (the canonical
 * COMPANION_TYPES values) so it has no module-load dependency on the State class
 * — these tests import ONLY class-utils to prove that.
 */

import "./setup.js";

let CharacterSheetClassUtils;

beforeAll(async () => {
	CharacterSheetClassUtils = (await import("../../../js/charactersheet/charactersheet-class-utils.js")).CharacterSheetClassUtils;
});

describe("Bug #14 — getCompanionBadgeMeta", () => {
	it("flags a familiar distinctly (isFamiliar + dedicated label/icon/class)", () => {
		const meta = CharacterSheetClassUtils.getCompanionBadgeMeta({type: "familiar"});
		expect(meta.isFamiliar).toBe(true);
		expect(meta.type).toBe("familiar");
		expect(meta.label).toBe("Familiar");
		expect(meta.icon).toBe("🧚");
		expect(meta.cssClass).toBe("charsheet__companion-badge--familiar");
		expect(meta.colorRgb).toMatch(/^\d+,\s*\d+,\s*\d+$/);
	});

	it("gives a Wild Shape form its own (non-familiar) badge", () => {
		const meta = CharacterSheetClassUtils.getCompanionBadgeMeta({type: "wild_shape"});
		expect(meta.isFamiliar).toBe(false);
		expect(meta.type).toBe("wild_shape");
		expect(meta.label).toBe("Wild Shape");
		expect(meta.cssClass).toBe("charsheet__companion-badge--wild_shape");
	});

	it("uses a VISUALLY distinct colour for familiars vs other types", () => {
		const fam = CharacterSheetClassUtils.getCompanionBadgeMeta({type: "familiar"});
		const ws = CharacterSheetClassUtils.getCompanionBadgeMeta({type: "wild_shape"});
		const beast = CharacterSheetClassUtils.getCompanionBadgeMeta({type: "beast_companion"});
		expect(fam.colorRgb).not.toBe(ws.colorRgb);
		expect(fam.colorRgb).not.toBe(beast.colorRgb);
	});

	it("tolerates a malformed object `type` (historic arg-order bug) by reading .type", () => {
		const meta = CharacterSheetClassUtils.getCompanionBadgeMeta({type: {type: "familiar", origin: "Wild Companion"}});
		expect(meta.isFamiliar).toBe(true);
		expect(meta.label).toBe("Familiar");
	});

	it("defaults an unknown/missing type to a generic (non-familiar) companion badge", () => {
		for (const input of [{}, {type: "nonsense"}, {type: null}, null, undefined]) {
			const meta = CharacterSheetClassUtils.getCompanionBadgeMeta(input);
			expect(meta.isFamiliar).toBe(false);
			expect(meta.type).toBe("custom");
			expect(meta.label).toBe("Companion");
		}
	});

	it("resolves a label/icon for every canonical companion type", () => {
		for (const type of ["familiar", "wild_shape", "beast_companion", "drake", "steel_defender", "summon", "mount", "infernal", "custom"]) {
			const meta = CharacterSheetClassUtils.getCompanionBadgeMeta({type});
			expect(typeof meta.label).toBe("string");
			expect(meta.label.length).toBeGreaterThan(0);
			expect(typeof meta.icon).toBe("string");
			expect(meta.icon.length).toBeGreaterThan(0);
			expect(meta.cssClass).toBe(`charsheet__companion-badge--${type}`);
		}
	});
});
