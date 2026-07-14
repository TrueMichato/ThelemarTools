import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/utils-config.js";
import "../../js/render.js";
import "../../js/render-markdown.js";
import {RenderClassesMarkdown} from "../../js/render-class-markdown.js";

const getClass = () => ({
	name: "Vanguard",
	source: "XPHB",
	edition: "one",
	hd: {number: 1, faces: 10},
	proficiency: ["str", "con"],
	primaryAbility: [{str: true}],
	startingProficiencies: {
		armor: ["light", "medium", "shield"],
		weapons: ["simple", "martial"],
		tools: ["smith's tools"],
		skills: [{choose: {from: ["athletics", "perception"], count: 1}}],
	},
	startingEquipment: {
		entries: ["Choose {@item longsword|XPHB} or {@item warhammer|XPHB}."],
	},
	multiclassing: {
		requirements: {str: 13},
	},
	subclassTitle: "Vanguard Path",
	classTableGroups: [
		{
			colLabels: ["Techniques"],
			rows: [["2"], ["2"], ["3"]],
		},
	],
	classFeatures: [
		[
			{
				name: "Bold Strike",
				level: 1,
				entries: ["Deal {@damage 1d6} extra damage and become {@b fearless}."],
			},
		],
		[
			{
				name: "Vanguard Path",
				level: 2,
				gainSubclassFeature: true,
				entries: ["Choose a Vanguard Path."],
			},
		],
		[
			{
				name: "Battle Focus",
				level: 3,
				entries: ["Your focus sharpens."],
			},
		],
	],
});

const getSubclass = () => ({
	name: "Storm Path",
	shortName: "Storm",
	source: "XPHB",
	className: "Vanguard",
	classSource: "XPHB",
	subclassTableGroups: [
		{
			title: "Storm Dice",
			colLabels: ["Die"],
			rows: [["—"], ["d6"], ["d6"]],
		},
	],
	subclassFeatures: [
		[
			{
				name: "Storm Step",
				level: 2,
				entries: ["Move with the storm."],
			},
		],
		[
			{
				name: "Thunderous Return",
				level: 3,
				entries: ["Return with thunder."],
			},
		],
	],
});

describe("Homebrewery class Markdown export", () => {
	it("Renders a complete class and selected subclass as Homebrewery V3 Markdown", () => {
		const markdown = RenderClassesMarkdown.getMarkdown({
			cls: getClass(),
			subclasses: [getSubclass()],
			classFluff: {
				entries: [
					{
						type: "entries",
						name: "Vanguard",
						entries: ["Vanguards hold the line."],
					},
				],
				images: [
					{href: {type: "internal", path: "classes/vanguard.webp"}},
				],
			},
			subclassFluffs: [
				{
					entries: ["Storm Vanguards ride the tempest."],
					images: [
						{href: {type: "external", url: "https://images.example/storm.webp"}},
					],
				},
			],
			baseUrl: "https://tools.example/classes.html",
		});

		expect(markdown).toContain("renderer: V3");
		expect(markdown).toContain("{{classTraits");
		expect(markdown).toContain("##### Core Vanguard Traits");
		expect(markdown).toContain("{{classTable,wide");
		expect(markdown).toContain("##### Vanguard Features");
		expect(markdown).toContain("#### Level 1: Bold Strike");
		expect(markdown).toContain("#### Level 2: Storm Step");
		expect(markdown).toContain("# Storm Path");
		expect(markdown).toContain("##### Storm Dice");
		expect(markdown).toContain("\\page");
		expect(markdown).toContain("{{pageNumber,auto}}");
		expect(markdown).toMatch(/!\[Vanguard]\(https:\/\/[^)]+\/classes\/vanguard\.webp\)/);
		expect(markdown).toContain("https://images.example/storm.webp");
		expect(markdown).toContain("**fearless**");
		expect(markdown).not.toContain("onmouseover=");
		expect(markdown).not.toContain("{@damage");
		expect(markdown).not.toContain("{@b");
	});

	it("Includes only subclasses supplied by the selected-tab scope", () => {
		const markdown = RenderClassesMarkdown.getMarkdown({
			cls: getClass(),
			subclasses: [getSubclass()],
			subclassFluffs: [null],
			baseUrl: "https://tools.example/classes.html",
		});

		expect(markdown).toContain("Storm Path");
		expect(markdown).not.toContain("Unselected Path");
	});

	it("Produces class-only output when no subclass is selected", () => {
		const cls = getClass();
		const markdown = RenderClassesMarkdown.getMarkdown({
			cls,
			baseUrl: "https://tools.example/classes.html",
		});

		expect(markdown).toContain("description: \"Vanguard class\"");
		expect(markdown).not.toContain("# Storm Path");
		expect(markdown).not.toContain("Subclass Feature");
	});

	it("Falls back to multiclass requirements for 2014 primary abilities", () => {
		const cls = getClass();
		cls.source = "PHB";
		cls.edition = "classic";
		delete cls.primaryAbility;
		cls.multiclassing.requirements = {or: [{str: 13, dex: 13}]};
		delete cls.startingProficiencies.tools;
		delete cls.startingEquipment;

		const markdown = RenderClassesMarkdown.getMarkdown({
			cls,
			baseUrl: "https://tools.example/classes.html",
		});

		expect(markdown).toContain("| **Primary Ability** | Strength or Dexterity |");
		expect(markdown).toContain("2014 Edition");
		expect(markdown).not.toContain("Tool Proficiencies");
		expect(markdown).not.toContain("Starting Equipment");
	});

	it("Replaces embedded statblocks with portable textual references", () => {
		const cls = getClass();
		cls.classFeatures[0][0].entries.push({
			type: "statblock",
			tag: "item",
			name: "Psychic Blade",
			source: "XPHB",
		});

		const markdown = RenderClassesMarkdown.getMarkdown({
			cls,
			baseUrl: "https://tools.example/classes.html",
		});

		expect(markdown).toMatch(/\*\*Psychic Blade\.\*\* See the item entry \([^)]+\)\./);
		expect(markdown).not.toContain("onload=");
		expect(markdown).not.toContain("Loading Psychic Blade");
	});

	it("Splits oversized features across Homebrewery columns and pages", () => {
		const cls = getClass();
		cls.classFeatures = [
			[
				{
					name: "Endless Feature",
					level: 1,
					entries: [...new Array(80)].map((_, ix) => `Paragraph ${ix + 1}. ${"Long feature text ".repeat(18)}`),
				},
			],
		];

		const markdown = RenderClassesMarkdown.getMarkdown({
			cls,
			baseUrl: "https://tools.example/classes.html",
		});
		const pageLengths = markdown
			.split("\n\n\\page\n\n")
			.slice(1)
			.map(page => page.length);

		expect(markdown).toContain("#### Level 1: Endless Feature *(continued)*");
		expect(pageLengths.length).toBeGreaterThan(2);
		expect(Math.max(...pageLengths)).toBeLessThan(5000);
	});

	it("Renders internal navigation tags as text instead of Markdown links", () => {
		const cls = getClass();
		cls.classFeatures[0][0].entries = [
			"Choose the {@feat Ability Score Improvement|XPHB} feat or another {@5etools feat|feats.html}.",
			"Read {@link the optional rules|https://example.com/rules}.",
		];

		const markdown = RenderClassesMarkdown.getMarkdown({
			cls,
			baseUrl: "https://tools.example/classes.html",
		});

		expect(markdown).toContain("another feat.");
		expect(markdown).toContain("Read the optional rules.");
		expect(markdown).not.toMatch(/\[[^\]]+]\([^)]+\)/);
	});

	it("Renders feature tables as compact valid Homebrewery tables", () => {
		const cls = getClass();
		cls.classFeatures[0][0].entries = [
			{
				type: "table",
				caption: "Warped Reality Table",
				colLabels: ["D6 Outcome", "Effect"],
				rows: [
					["1", "{@bold Warped Sight.} The creature is {@condition blinded}."],
					["2", "{@bold Warped Mind.} The creature is {@condition frightened}; see {@5etools conditions|conditionsdiseases.html}."],
				],
			},
		];

		const markdown = RenderClassesMarkdown.getMarkdown({
			cls,
			baseUrl: "https://tools.example/classes.html",
		});
		const tableLines = markdown
			.split("\n")
			.filter(line => line.startsWith("|"));

		expect(markdown).toContain("{{wide");
		expect(markdown).toContain("|:---:|:---|");
		expect(markdown).toContain("| 1 | **Warped Sight.** The creature is blinded. |");
		expect(markdown).toContain("see conditions.");
		expect(markdown).not.toContain("conditionsdiseases.html");
		expect(Math.max(...tableLines.map(line => line.length))).toBeLessThan(100);
	});

	it("Uses remaining column space before advancing to a new page", () => {
		const getBlock = name => `#### ${name}\n\n${"A compact paragraph of feature text. ".repeat(17)}\n\n${"A second paragraph of feature text. ".repeat(17)}`;
		const pages = RenderClassesMarkdown._getFlowPages([
			getBlock("First Feature"),
			getBlock("Second Feature"),
			getBlock("Third Feature"),
		]);

		expect(pages).toHaveLength(1);
		expect(pages[0]).toContain("Second Feature *(continued)*");
		expect(pages[0]).toContain("\\column");
	});
});
