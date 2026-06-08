/**
 * Specialty hover resolution → canonical Beast-Friend-style link (TGTT Ranger round 2, Bug 2)
 *
 * TGTT Ranger Specialties are stored as feature-options (`isFeatureOption`/`parentFeature`)
 * at the LEVEL THEY WERE PICKED (e.g. Build Shelter picked at L4) while the canonical
 * classFeature entry is defined at L1. The hover must resolve to that canonical L1 entry and
 * build the same `classfeatures.html` hash the working "Beast Friend" link uses
 * (`build%20shelter_ranger_tgtt_1_tgtt`) — NOT a 404-ing `..._4_tgtt` hash, and NOT a local
 * inline `ve-help-subtle` span. Source-gating must prevent crossing same-named features.
 */

import "./setup.js";
import "../../../js/parser.js";
import "../../../js/utils.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;
const UrlUtil = globalThis.UrlUtil;

// Canonical L1 classFeature entries (as loaded from homebrew data).
const pool = {
	classFeatures: [
		{name: "Beast Friend", className: "Ranger", classSource: "TGTT", source: "TGTT", level: 1},
		{name: "Build Shelter", className: "Ranger", classSource: "TGTT", source: "TGTT", level: 1},
		{name: "Read the Room", className: "Ranger", classSource: "TGTT", source: "TGTT", level: 1},
		// A same-named feature from a DIFFERENT source must never be crossed.
		{name: "Build Shelter", className: "Ranger", classSource: "PHB", source: "PHB", level: 1},
		{name: "Extra Attack", className: "Ranger", classSource: "PHB", source: "PHB", level: 5},
	],
	subclassFeatures: [],
};

const buildHash = (entity) => UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASS_SUBCLASS_FEATURES]({
	name: entity.name,
	className: entity.className,
	classSource: entity.classSource,
	level: Number(entity.level) || 1,
	source: entity.source,
});

describe("Specialty hover → canonical link (Bug 2)", () => {
	test("a specialty picked above its canonical level resolves to the L1 entry", () => {
		const stored = {
			name: "Build Shelter",
			className: "Ranger",
			source: "TGTT",
			classSource: "TGTT",
			level: 4,
			featureType: "Class",
			isFeatureOption: true,
			parentFeature: "Specialties",
		};
		const resolved = CharacterSheetClassUtils.findLoadedFeatureEntity(stored, pool);
		expect(resolved).toBeTruthy();
		expect(resolved.level).toBe(1);
		expect(resolved.source).toBe("TGTT");
	});

	test("the hash built from the resolved entity matches the Beast-Friend style (canonical L1)", () => {
		const stored = {
			name: "Build Shelter",
			className: "Ranger",
			source: "TGTT",
			classSource: "TGTT",
			level: 4,
			featureType: "Class",
			isFeatureOption: true,
			parentFeature: "Specialties",
		};
		const resolved = CharacterSheetClassUtils.findLoadedFeatureEntity(stored, pool);
		const hash = buildHash(resolved);
		// Beast Friend's working hash form: name_class_classSource_level_source.
		expect(hash).toBe("build%20shelter_ranger_tgtt_1_tgtt");

		// And it equals the hash of the natively-L1 Beast Friend entry's pattern.
		const beast = CharacterSheetClassUtils.findLoadedFeatureEntity(
			{name: "Beast Friend", className: "Ranger", source: "TGTT", level: 1, isFeatureOption: true, parentFeature: "Specialties"},
			pool,
		);
		expect(buildHash(beast)).toBe("beast%20friend_ranger_tgtt_1_tgtt");
	});

	test("specialty hash built from the stored pick-level would 404 (proves the fix matters)", () => {
		// The pre-fix code built the hash from feature.level (4) → unresolvable.
		const badHash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASS_SUBCLASS_FEATURES]({
			name: "Build Shelter", className: "Ranger", classSource: "TGTT", level: 4, source: "TGTT",
		});
		expect(badHash).toBe("build%20shelter_ranger_tgtt_4_tgtt");
		expect(badHash).not.toBe("build%20shelter_ranger_tgtt_1_tgtt");
	});

	test("source-gating: a TGTT specialty is not cross-resolved to a same-named PHB feature", () => {
		// Pool has BOTH a TGTT and a PHB "Build Shelter"; the TGTT pick must pick the TGTT one.
		const stored = {
			name: "Build Shelter",
			className: "Ranger",
			source: "TGTT",
			level: 4,
			isFeatureOption: true,
			parentFeature: "Specialties",
		};
		const resolved = CharacterSheetClassUtils.findLoadedFeatureEntity(stored, pool);
		expect(resolved.source).toBe("TGTT");
	});

	test("a non-feature-option feature keeps strict level matching (no silent cross-level resolve)", () => {
		const stored = {name: "Extra Attack", className: "Ranger", source: "PHB", level: 11};
		expect(CharacterSheetClassUtils.findLoadedFeatureEntity(stored, pool)).toBeUndefined();
	});

	test("a feature-option absent from the pool returns undefined (→ local hover)", () => {
		const stored = {
			name: "Nonexistent Specialty",
			className: "Ranger",
			source: "TGTT",
			level: 4,
			isFeatureOption: true,
			parentFeature: "Specialties",
		};
		expect(CharacterSheetClassUtils.findLoadedFeatureEntity(stored, pool)).toBeUndefined();
	});

	test("multiclass: a Druid feature-option does not resolve against the Ranger pool", () => {
		const druidStored = {
			name: "Magician",
			className: "Druid",
			source: "XPHB",
			level: 1,
			isFeatureOption: true,
			parentFeature: "Primal Order",
		};
		expect(CharacterSheetClassUtils.findLoadedFeatureEntity(druidStored, pool)).toBeUndefined();
	});
});
