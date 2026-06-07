/**
 * Combat-method group naming on the Features tab.
 *
 * Regression coverage for the "CTM 1, CTM 2, CTM 3, CTM 4, CTM 5" bug: stored
 * (legacy) combat-method features carry degree-only type codes
 * `["CTM:1", … , "CTM:5"]` with the tradition in a separate `tradition` field
 * (e.g. "Razor's Edge"). The Features-tab grouping must label each group by its
 * tradition (`Combat Methods: <Tradition>`), not fall through
 * `_getOptionalFeatureGroupName`, which mapped the degree-only codes to the raw
 * "CTM 1, CTM 2, …" string.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";
import "../../../js/charactersheet/charactersheet-features.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const CharacterSheetFeatures = globalThis.CharacterSheetFeatures;

// Lunaria's stored Ranger combat methods (degree-only codes + tradition field).
const mkLegacyMethod = (name, tradition, degree) => ({
	name,
	source: "TGTT",
	className: "Ranger",
	classSource: "TGTT",
	level: 2,
	featureType: "Optional Feature",
	optionalFeatureTypes: ["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"],
	tradition,
	degree,
	staminaCost: 1,
	_entityType: "combatMethod",
});

const perceptiveStance = mkLegacyMethod("Perceptive Stance", "Razor's Edge", 1);
const deflectStrike = mkLegacyMethod("Deflect Strike", "Unending Wheel", 2);

describe("combat-method tradition resolution (legacy degree-only codes)", () => {
	test("getMethodTraditionName reads the `tradition` field", () => {
		expect(CharacterSheetClassUtils.getMethodTraditionName(perceptiveStance)).toBe("Razor's Edge");
		expect(CharacterSheetClassUtils.getMethodTraditionName(deflectStrike)).toBe("Unending Wheel");
	});

	test("getMethodTraditionCode maps tradition name to its short code", () => {
		expect(CharacterSheetClassUtils.getMethodTraditionCode(perceptiveStance)).toBe("RE");
		expect(CharacterSheetClassUtils.getMethodTraditionCode(deflectStrike)).toBe("UW");
	});

	test("isCombatMethod recognises the legacy shape", () => {
		expect(CharacterSheetClassUtils.isCombatMethod(perceptiveStance)).toBe(true);
	});

	test("group header string is the tradition, never the raw CTM codes", () => {
		const headerFor = (f) => {
			const tradName = CharacterSheetClassUtils.getMethodTraditionName(f);
			return tradName ? `Combat Methods: ${tradName}` : "Combat Methods";
		};
		expect(headerFor(perceptiveStance)).toBe("Combat Methods: Razor's Edge");
		expect(headerFor(deflectStrike)).toBe("Combat Methods: Unending Wheel");
		expect(headerFor(perceptiveStance)).not.toMatch(/CTM/);
	});

	test("group key separates the two traditions (no collision)", () => {
		const keyFor = (f) => {
			const tradCode = CharacterSheetClassUtils.getMethodTraditionCode(f);
			const tradName = CharacterSheetClassUtils.getMethodTraditionName(f);
			return `CTM:${tradCode || tradName || "unknown"}`;
		};
		expect(keyFor(perceptiveStance)).toBe("CTM:RE");
		expect(keyFor(deflectStrike)).toBe("CTM:UW");
		expect(keyFor(perceptiveStance)).not.toBe(keyFor(deflectStrike));
	});
});

describe("_getOptionalFeatureGroupName defensive fallback", () => {
	const groupName = (types) =>
		CharacterSheetFeatures.prototype._getOptionalFeatureGroupName.call({}, types);

	test("degree-only CTM codes no longer leak the raw 'CTM 1, …' string", () => {
		const out = groupName(["CTM:1", "CTM:2", "CTM:3", "CTM:4", "CTM:5"]);
		expect(out).toBe("Combat Methods");
		expect(out).not.toMatch(/CTM\s*\d/);
	});

	test("tradition-coded CTM still resolves to the named tradition", () => {
		expect(groupName(["CTM:1RE"]))
			.toBe(`Combat Methods: ${CharacterSheetClassUtils.getTraditionName("RE")}`);
	});

	test("non-combat optional feature types are unaffected", () => {
		expect(groupName(["EI"])).toBe("Eldritch Invocations");
		expect(groupName(["MM"])).toBe("Metamagic Options");
	});
});
