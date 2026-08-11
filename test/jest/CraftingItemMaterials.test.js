import fs from "fs";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/utils-config.js";
import "../../js/utils-ui.js";
import "../../js/filter.js";
import "../../js/filter-crafting.js";

/**
 * `itemMaterial` is the fourth entity type on `crafting.html`, and registering a prop there means
 * touching six unrelated files (parser, utils, crafting page, renderer, filters, generator). Miss
 * one and the failure is silent: the row renders but has no hash, or no category, or no filter.
 *
 * These tests pin the registration itself rather than any material's stats.
 */
describe("itemMaterial crafting-page registration", () => {
	describe("parser vocabulary", () => {
		it("has the MTL abbreviation and a display name", () => {
			expect(Parser.CRAFTING_PROP_TO_ABV["itemMaterial"]).toBe("MTL");
			expect(Parser.getPropDisplayName("itemMaterial")).toBe("Item Material");
		});

		it("round-trips its category id back to the prop", () => {
			// A missing CAT_ID_TO_PROP entry breaks omnisearch results silently — the hit resolves
			// to `undefined` and the click goes nowhere.
			expect(Parser.CAT_ID_ITEM_MATERIAL).toBeDefined();
			expect(Parser.CAT_ID_TO_PROP[Parser.CAT_ID_ITEM_MATERIAL]).toBe("itemMaterial");
			expect(Parser.CAT_ID_TO_FULL[Parser.CAT_ID_ITEM_MATERIAL]).toBe("Item Material");
		});

		it("declares the eight material categories", () => {
			expect(Parser.ITEM_MATERIAL_CATEGORIES).toEqual(
				expect.arrayContaining(["metal", "wood", "stone", "crystal", "cloth", "organic", "constructed", "condensate"]),
			);
		});

		it("names the five axes, and marks the signed ones", () => {
			const byKey = Object.fromEntries(Parser.ITEM_MATERIAL_AXES.map(it => [it.key, it]));
			expect(Object.keys(byKey).sort()).toEqual(["critical", "damage", "magicCapacity", "penetration", "protection"]);
			// Damage is a signed step count; Protection is an absolute AC, so it must not gain a "+".
			expect(byKey.damage.isSigned).toBe(true);
			expect(byKey.protection.isSigned).toBe(false);
		});
	});

	describe("axis formatting", () => {
		// The doc's tri-state (plus two infinities) is the whole reason a formatter exists — a plain
		// `String(value)` would print "na" and "-infinity" straight into the stat block.
		it("renders the sentinels", () => {
			expect(Parser.itemMaterialAxisToFull("na")).toBe("N/A");
			expect(Parser.itemMaterialAxisToFull("infinity")).toBe("\u221E");
			expect(Parser.itemMaterialAxisToFull("-infinity")).toBe("\u2212\u221E");
			expect(Parser.itemMaterialAxisToFull(null)).toBe("Varies");
			expect(Parser.itemMaterialAxisToFull(undefined)).toBe("Varies");
		});

		it("signs a signed axis but never an unsigned one", () => {
			expect(Parser.itemMaterialAxisToFull(1, {isSigned: true})).toBe("+1");
			expect(Parser.itemMaterialAxisToFull(-2, {isSigned: true})).toBe("\u22122");
			expect(Parser.itemMaterialAxisToFull(0, {isSigned: true})).toBe("0");
			expect(Parser.itemMaterialAxisToFull(19, {isSigned: false})).toBe("19");
		});

		it("expands roles and applies-to codes", () => {
			expect(Parser.itemMaterialRoleToFull("strikingSurface")).toBe("Striking Surface");
			expect(Parser.itemMaterialAppliesToFull("shield")).toBe("Shields");
		});
	});

	describe("UrlUtil registration", () => {
		it("hashes by name and source", () => {
			const hash = UrlUtil.URL_TO_HASH_BUILDER["itemMaterial"]({name: "Darkmetal", source: "TGTT"});
			expect(hash).toBe(UrlUtil.encodeForHash(["darkmetal", "tgtt"]));
		});

		it("lives on the crafting page, both directions", () => {
			expect(Parser.CAT_ID_TO_PAGE?.[Parser.CAT_ID_ITEM_MATERIAL] ?? UrlUtil.CAT_TO_PAGE[Parser.CAT_ID_ITEM_MATERIAL])
				.toBe(UrlUtil.PG_CRAFTING);
			expect(UrlUtil.PAGE_TO_PROPS[UrlUtil.PG_CRAFTING]).toContain("itemMaterial");
			expect(UrlUtil.PROP_TO_PAGE["itemMaterial"]).toBe(UrlUtil.PG_CRAFTING);
		});
	});

	describe("filters", () => {
		const _mutate = (ent) => {
			PageFilterCrafting.mutateForFilters(ent);
			return ent;
		};

		it("maps the infinities onto the range filter's bounds", () => {
			// A RangeFilter cannot hold Infinity, so the sentinels are clamped to the filter's own
			// min/max. Leaving them unmapped drops Jadoo and Lead out of every Magic Capacity search.
			const jadoo = _mutate({name: "Jadoo", source: "TGTT", __prop: "itemMaterial", magicCapacity: "infinity"});
			const lead = _mutate({name: "Lead", source: "TGTT", __prop: "itemMaterial", magicCapacity: "-infinity"});
			expect(jadoo._fMaterialAxes.magicCapacity).toBe(25);
			expect(lead._fMaterialAxes.magicCapacity).toBe(-5);
		});

		it("gives 'na' and 'Varies' no filterable value", () => {
			const ent = _mutate({name: "X", source: "TGTT", __prop: "itemMaterial", damage: "na", protection: null});
			expect(ent._fMaterialAxes.damage).toBeNull();
			expect(ent._fMaterialAxes.protection).toBeNull();
		});

		it("flags degrading, priceless, and mechanically-effective materials", () => {
			const glass = _mutate({
				name: "Ordinary Glass",
				source: "TGTT",
				__prop: "itemMaterial",
				degradation: {trigger: {on: "attackRoll", natural: [1]}, destroys: true},
			});
			expect(glass._fMisc).toContain("Degrades In Use");

			const heart = _mutate({
				name: "Heart Stone",
				source: "TGTT",
				__prop: "itemMaterial",
				price: {isPriceless: true},
			});
			expect(heart._fMisc).toContain("Priceless");

			const dark = _mutate({
				name: "Darkmetal",
				source: "TGTT",
				__prop: "itemMaterial",
				effects: [{type: "bonusAc", value: 1, appliesTo: ["shield"]}],
			});
			expect(dark._fMisc).toContain("Has Mechanical Effect");
		});

		it("groups a material's category under Item Material, not Rule", () => {
			// "materials" is simultaneously a craftingRule category and loosely what these are, so
			// groupFn has to check the itemMaterial categories first or every metal lands in the
			// rules bucket.
			const ent = _mutate({name: "Steel", source: "TGTT", __prop: "itemMaterial", materialCategory: "metal"});
			expect(ent._fCategory).toBe("metal");

			const box = new PageFilterCrafting();
			const groupFn = box._categoryFilter.__meta?.groupFn ?? box._categoryFilter._groupFn;
			expect(groupFn("metal")).toBe("Item Material");
			expect(groupFn("materials")).toBe("Rule");
		});
	});

	describe("generated data", () => {
		const data = JSON.parse(fs.readFileSync("data/crafting.json", "utf-8"));

		it("emits the item materials alongside the other three props", () => {
			expect(Array.isArray(data.itemMaterial)).toBe(true);
			expect(data.itemMaterial.length).toBeGreaterThan(0);
		});

		it("has no duplicate name|source", () => {
			// The prop is delivered by both the generated file and an installed TGTT brew; the page
			// dedupes at load, but the generated file itself must already be clean.
			const seen = new Set();
			const dupes = [];
			for (const ent of data.itemMaterial) {
				const uid = `${ent.name.toLowerCase()}|${ent.source.toLowerCase()}`;
				if (seen.has(uid)) dupes.push(uid);
				seen.add(uid);
			}
			expect(dupes).toEqual([]);
		});

		it("keeps every axis within the tri-state contract", () => {
			const SENTINELS = new Set(["na", "infinity", "-infinity"]);
			const bad = [];
			for (const ent of data.itemMaterial) {
				for (const {key} of Parser.ITEM_MATERIAL_AXES) {
					const v = ent[key];
					if (v == null) continue;
					if (typeof v === "number") continue;
					if (SENTINELS.has(v)) continue;
					bad.push(`${ent.name}.${key} = ${JSON.stringify(v)}`);
				}
			}
			expect(bad).toEqual([]);
		});

		it("only uses the known categories, roles, and applies-to codes", () => {
			const ROLES = new Set(["strikingSurface", "protectiveLayer", "focus"]);
			const APPLIES = new Set(["weapon", "armor", "shield", "other"]);
			const cats = new Set(Parser.ITEM_MATERIAL_CATEGORIES);
			const bad = [];
			for (const ent of data.itemMaterial) {
				if (ent.materialCategory && !cats.has(ent.materialCategory)) bad.push(`${ent.name}: category ${ent.materialCategory}`);
				for (const r of ent.roles || []) if (!ROLES.has(r)) bad.push(`${ent.name}: role ${r}`);
				for (const a of ent.appliesTo || []) if (!APPLIES.has(a)) bad.push(`${ent.name}: appliesTo ${a}`);
			}
			expect(bad).toEqual([]);
		});

		it("gives every material a name and a source", () => {
			const bad = data.itemMaterial.filter(it => !it.name || !it.source).map(it => JSON.stringify(it).slice(0, 80));
			expect(bad).toEqual([]);
		});
	});

	describe("Thelemar reference rules", () => {
		const data = JSON.parse(fs.readFileSync("data/crafting.json", "utf-8"));
		const getRule = name => data.craftingRule.find(r => r.name === name && r.source === "TGTT");

		it("carries Object Durability with both reference tables", () => {
			const rule = getRule("Object Durability");
			expect(rule).toBeTruthy();
			expect(rule.ruleCategory).toBe("materials");
			const captions = [];
			const walk = ent => {
				if (Array.isArray(ent)) return ent.forEach(walk);
				if (!ent || typeof ent !== "object") return;
				if (ent.type === "table" && ent.caption) captions.push(ent.caption);
				walk(ent.entries);
			};
			walk(rule.entries);
			expect(captions).toEqual(["Object Armor Class", "Object Hit Points"]);
		});

		it("keeps the Magical Interference table in step with the sheet's automation", () => {
			const rule = getRule("Magical Interference");
			expect(rule).toBeTruthy();

			// The sheet rolls on `CharacterSheetMaterials.MAGICAL_INTERFERENCE_TABLE`; the brew
			// rule is the reader-facing copy. Two copies of a table drift, so pin them together.
			const src = fs.readFileSync("js/charactersheet/charactersheet-materials.js", "utf-8");
			const block = src.split("static MAGICAL_INTERFERENCE_TABLE = [")[1].split("\n\t];")[0];
			const jsNames = [...block.matchAll(/name: "([^"]+)"/g)].map(m => m[1]);

			const table = rule.entries.find(e => e?.type === "table");
			expect(table.rows).toHaveLength(8);
			const ruleNames = table.rows.map(r => /\{@b ([^.]+)\./.exec(r[1])[1]);
			expect(ruleNames).toEqual(jsNames);
			expect(table.rows.map(r => r[0])).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
		});
	});
});
