import fs from "fs";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/utils-config.js";
import "../../js/utils-ui.js";
import "../../js/filter.js";
import "../../js/filter-crafting.js";

const ListSyntaxCrafting = globalThis.ListSyntaxCrafting;

const _getSyntax = (dataList) => new ListSyntaxCrafting({fnGetDataList: () => dataList});

/** The base class only exposes the cache through the syntax fns, so drive it the way the list does. */
const _getStatsText = (entity) => _getSyntax([entity]).getSearchCacheStats(entity);

const _getIngredientMatch = (entity, term) => {
	const syntax = _getSyntax([entity]);
	const listItem = {ix: 0, name: entity.name, data: {}};
	return syntax.build().ingredient.fn(listItem, term);
};

describe("Crafting list syntax", () => {
	describe("indexable props", () => {
		it("indexes a dish's outcomes, where the benefit actually lives", () => {
			// Arcadia 11 dishes keep flavour in `entries` and the mechanical benefit in `outcomes`,
			// so indexing `entries` alone makes every dish unsearchable by what it does.
			const dish = {
				name: "A Perfect Roast",
				entries: ["Any bonehead can throw a deer on a spit."],
				outcomes: [
					{tier: "delicious", entries: ["You gain 5 temporary hit points."]},
				],
			};

			expect(_getStatsText(dish)).toContain("temporary hit points");
		});

		it("indexes a recipe's ingredients", () => {
			const recipe = {
				name: "A Perfect Roast",
				entries: ["Flavour only."],
				ingredients: [{name: "meat", quantity: 1, unit: "portion"}],
			};

			expect(_getStatsText(recipe)).toContain("meat");
		});

		it("indexes what a material is used to make, and the creature it comes from", () => {
			const material = {
				name: "Aboleth Eye",
				entries: ["A staring, lidless eye."],
				harvest: {creature: {name: "Aboleth", source: "MM"}, creatureType: "aberration"},
				usedInRecipes: [{name: "Lens of Forgotten History", source: "HHHVI"}],
			};

			const text = _getStatsText(material);
			expect(text).toContain("aboleth");
			expect(text).toContain("aberration");
			expect(text).toContain("lens of forgotten history");
		});

		it("indexes an Arcadia 8 component's spell effect", () => {
			const component = {
				name: "Aboleth Eye",
				entries: ["A staring, lidless eye."],
				variantComponent: {
					spellEffects: [{description: "Learn about an additional person of legendary importance."}],
				},
			};

			expect(_getStatsText(component)).toContain("legendary importance");
		});
	});

	describe("tag targets", () => {
		it("indexes a tag's target as well as its display text", () => {
			// `stripTags` keeps only the display text, so this would index as "exhausted" alone and a
			// search for the condition's own name would miss it.
			const entity = {
				name: "Potion of Adaptation",
				entries: ["You automatically succeed against becoming {@condition exhaustion|PHB|exhausted}."],
			};

			const text = _getStatsText(entity);
			expect(text).toContain("exhausted");
			expect(text).toContain("exhaustion");
		});

		it("keeps display text for tags that have no separate target", () => {
			const entity = {name: "Thing", entries: ["Deals {@damage 2d6} fire damage."]};

			expect(_getStatsText(entity)).toContain("2d6");
		});

		it("does not fabricate matches from tag syntax itself", () => {
			const entity = {name: "Thing", entries: ["A {@condition poisoned} creature."]};

			expect(_getStatsText(entity)).not.toContain("@condition");
		});
	});

	describe("the ingredient command", () => {
		it("is registered so the parser will recognise it", () => {
			const syntax = _getSyntax([]);
			const built = syntax.build();

			expect(built.ingredient).toBeDefined();
			expect(built.reCommand.exec("ingredient")?.groups?.command).toBe("ingredient");
		});

		it("still recognises the inherited commands", () => {
			const {reCommand} = _getSyntax([]).build();

			["name", "stats", "info", "text"].forEach(cmd => {
				expect(reCommand.exec(cmd)?.groups?.command).toBe(cmd);
			});
		});

		it("matches on ingredients", () => {
			const recipe = {
				name: "A Perfect Roast",
				entries: ["Flavour only."],
				ingredients: [{name: "meat", quantity: 1, unit: "portion"}],
			};

			expect(_getIngredientMatch(recipe, "meat")).toBe(true);
		});

		it("does not match text that merely mentions the ingredient elsewhere", () => {
			// The whole point of the command is to separate "uses meat" from "talks about meat".
			const material = {
				name: "Owlbear Meat",
				entries: ["Prized meat, best served rare."],
			};

			expect(_getIngredientMatch(material, "meat")).toBe(false);
		});
	});

	describe("against the generated corpus", () => {
		const data = JSON.parse(fs.readFileSync("./data/crafting.json", "utf-8"));
		const all = [...data.craftingMaterial, ...data.craftingRecipe, ...data.craftingRule];

		const _getMatchCount = (term) => {
			const syntax = _getSyntax(all);
			return all.filter(ent => syntax.getSearchCacheStats(ent).includes(term)).length;
		};

		it("finds every entry that mentions exhaustion, including tagged ones", () => {
			// Regression: `{@condition exhaustion|PHB|exhausted}` used to be findable only as
			// "exhausted", so this count was one short of the corpus.
			const expected = all
				.filter(ent => JSON.stringify([ent.name, ent.entries]).toLowerCase().includes("exhaustion"))
				.length;

			expect(expected).toBeGreaterThan(0);
			expect(_getMatchCount("exhaustion")).toBe(expected);
		});

		/** Text that appears in `prop` and nowhere else on the entity, so a match can only come from it. */
		const _getExclusivePhrases = (prop, minLength) => all
			.flatMap(ent => {
				if (!(ent[prop] || []).length) return [];
				const others = JSON.stringify(Object.fromEntries(Object.entries(ent).filter(([k]) => k !== prop))).toLowerCase();
				return JSON.stringify(ent[prop])
					.toLowerCase()
					.match(/[a-z][a-z0-9 ,'-]{20,}/g)
					?.map(it => it.trim())
					.filter(it => it.length >= minLength && !others.includes(it))
					.slice(0, 1)
					.map(phrase => ({ent, phrase})) ?? [];
			});

		it("finds dishes by text that exists only in their outcomes", () => {
			// Guards against the index quietly reverting to `entries`-only: these phrases appear in
			// no other property, so nothing else can satisfy the match.
			const cases = _getExclusivePhrases("outcomes", 30);
			expect(cases.length).toBeGreaterThan(0);

			const syntax = _getSyntax(all);
			cases.forEach(({ent, phrase}) => {
				expect(syntax.getSearchCacheStats(ent)).toContain(phrase);
			});
		});

		it("finds recipes by text that exists only in their ingredient list", () => {
			const cases = _getExclusivePhrases("ingredients", 20);
			expect(cases.length).toBeGreaterThan(0);

			const syntax = _getSyntax(all);
			cases.forEach(({ent, phrase}) => {
				expect(syntax.getSearchCacheStats(ent)).toContain(phrase);
			});
		});
	});
});
