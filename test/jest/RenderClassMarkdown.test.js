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

		expect(markdown).not.toContain("*(continued)*");
		expect(markdown).toContain("Paragraph 80.");
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

		expect(markdown).toContain("{{\n##### Warped Reality Table");
		expect(markdown).not.toContain("{{wide\n##### Warped Reality Table");
		expect(markdown).toContain("|:---:|:---|");
		expect(markdown).toContain("| 1 | **Warped Sight.** The creature is blinded. |");
		expect(markdown).toContain("see conditions.");
		expect(markdown).not.toContain("conditionsdiseases.html");
		expect(Math.max(...tableLines.map(line => line.length))).toBeLessThan(100);
	});

	it("Uses remaining column space before advancing to a new page", () => {
		const getBlock = name => `#### ${name}\n\n${"A compact paragraph of feature text. ".repeat(18)}\n\n${"A second paragraph of feature text. ".repeat(18)}`;
		const pages = RenderClassesMarkdown._getFlowPages([
			getBlock("First Feature"),
			getBlock("Second Feature"),
			getBlock("Third Feature"),
		]);

		expect(pages).toHaveLength(1);
		expect(pages[0]).not.toContain("*(continued)*");
		expect(pages[0]).toContain("\\column");
	});

	it("Starts subclass titles and wide tables on safe page boundaries", () => {
		const cls = getClass();
		cls.classFeatures[0][0].entries.push({
			type: "table",
			caption: "Bold Strike Outcomes",
			colLabels: ["D6", "Outcome"],
			rows: [["1", "Push the target."]],
		});

		const markdown = RenderClassesMarkdown.getMarkdown({
			cls,
			subclasses: [getSubclass()],
			subclassFluffs: [null],
			baseUrl: "https://tools.example/classes.html",
		});
		const pages = markdown
			.split("\n\n\\page\n\n")
			.map(page => page.replace(/\n\n\{\{pageNumber,auto}}$/, "").trim());
		const subclassPage = pages.find(page => page.includes("# Storm Path"));
		const featureTablePage = pages.find(page => page.includes("##### Bold Strike Outcomes"));
		const subclassTablePage = pages.find(page => page.includes("##### Storm Dice"));

		expect(subclassPage).toMatch(/^# Storm Path/);
		expect(featureTablePage).toContain("{{\n##### Bold Strike Outcomes");
		expect(featureTablePage).not.toContain("{{wide\n##### Bold Strike Outcomes");
		expect(subclassTablePage).toMatch(/^\{\{classTable,wide\n/);
		expect(subclassTablePage).not.toContain("\\column");
	});

	it("Accounts for tall Markdown lists when packing columns", () => {
		const pages = RenderClassesMarkdown._getFlowPages([
			`#### Spellcasting\n\n${"A paragraph of spellcasting rules. ".repeat(50)}`,
			`#### Tinker's Magic\n\nChoose an item from the following list:\n\n${[...new Array(31)].map((_, ix) => `- Item ${ix + 1}`).join("\n")}`,
		]);
		const columns = pages.flatMap(page => page.split("\n\n\\column\n\n"));

		expect(Math.max(...columns.map(column => RenderClassesMarkdown._getFlowLines(column))))
			.toBeLessThanOrEqual(RenderClassesMarkdown._FLOW_LINES_PER_COLUMN);
		expect(pages.join("\n")).not.toContain("*(continued)*");
	});

	it("Accounts for spacing between densely packed feature blocks", () => {
		const pages = RenderClassesMarkdown._getFlowPages(
			[...new Array(30)].map((_, ix) => `#### Feature ${ix + 1}\n\nA short feature description.`),
		);
		const columns = pages.flatMap(page => page.split("\n\n\\column\n\n"));

		expect(Math.max(...columns.map(column => RenderClassesMarkdown._getFlowLines(column))))
			.toBeLessThanOrEqual(RenderClassesMarkdown._FLOW_LINES_PER_COLUMN);
	});

	it("Keeps nested feature headings with their first paragraph", () => {
		const cls = getClass();
		cls.classFeatures = [
			[
				{
					name: "Canvas of the Mind",
					level: 6,
					entries: [
						...new Array(7).fill("A substantial opening paragraph fills the current column with feature rules. ".repeat(5)),
						{
							type: "entries",
							name: "Whispers of Fleetness",
							entries: [
								"{@bold Boon}: Your target moves faster.",
								"{@bold Bane}: Your target moves slower.",
							],
						},
					],
				},
			],
		];

		const markdown = RenderClassesMarkdown.getMarkdown({
			cls,
			baseUrl: "https://tools.example/classes.html",
		});
		const pagesAndColumns = markdown
			.split("\n\n\\page\n\n")
			.flatMap(page => page.split("\n\n\\column\n\n"));
		const whispersColumn = pagesAndColumns.find(column => column.includes("#### Whispers of Fleetness"));

		expect(whispersColumn).toContain("**Boon**: Your target moves faster.");
		expect(markdown).not.toContain("*(continued)*");
	});

	it("Lists mixed feature sources by default and supports opting out", () => {
		const cls = getClass();
		cls.classFeatures[0][0].source = "XPHB";
		cls.classFeatures[0][0].page = 18;
		cls.classFeatures[1][0].source = "TCE";
		cls.classFeatures[1][0].page = 7;
		const sc = getSubclass();
		sc.source = "TGTT-2014";
		sc.subclassFeatures = [
			[
				{
					level: 2,
					entries: [
						{
							type: "entries",
							name: "Borrowed Storm",
							source: "XGE",
							page: 15,
							entries: ["Move with a borrowed storm."],
						},
					],
				},
			],
		];

		const markdown = RenderClassesMarkdown.getMarkdown({
			cls,
			subclasses: [sc],
			baseUrl: "https://tools.example/classes.html",
		});
		const markdownWithoutSources = RenderClassesMarkdown.getMarkdown({
			cls,
			subclasses: [sc],
			isIncludeFeatureSources: false,
			baseUrl: "https://tools.example/classes.html",
		});

		expect(markdown).toMatch(/\*Source: Player.s Handbook \(2024\), p\. 18\*/);
		expect(markdown).toMatch(/\*Source: Tasha.s Cauldron of Everything, p\. 7\*/);
		expect(markdown).toMatch(/\*Source: Xanathar.s Guide to Everything, p\. 15\*/);
		expect(markdownWithoutSources).not.toContain("*Source:");
	});
});
