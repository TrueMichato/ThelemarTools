import {expect, test} from "@playwright/test";
import {clearCharacterStorage} from "../utils/characterStorage";

/**
 * The spawner is the fast path for reproducing a bug: one spec string builds a
 * complete character through the real Builder and Quick Build engines.
 *
 * This spec is the guard on that promise. It does not re-test the wizards
 * (the `tgtt-*` specs do that by clicking through them); it asserts that the
 * spawner reaches the requested build and that no choice was left unanswered —
 * an unresolved choice or an unhandled prompt means a half-built character,
 * which is worse than a slow one.
 */

interface SpawnResult {
	ok: boolean;
	error?: string;
	level: number;
	classes: string[];
	race: string | null;
	background: string | null;
	unresolved: string[];
	unhandledPrompts: string[];
	pinnedSpec: unknown;
	seed: string;
}

const spawn = async (page: import("@playwright/test").Page, spec: string, opts: {seed?: string} = {}): Promise<SpawnResult> => {
	await page.goto("/charactersheet.html", {waitUntil: "domcontentloaded"});
	await page.waitForFunction(() => (globalThis as any).charSheet?.spawn, null, {timeout: 120_000});

	return page.evaluate(async ({spec, opts}) => {
		const cs = (globalThis as any).charSheet;
		try {
			const report = await cs.spawn(spec, {...opts, save: false});
			const state = cs._state;
			return {
				ok: true,
				level: state.getTotalLevel(),
				classes: state.getClasses().map((c: any) => `${c.name} ${c.level}${c.subclass ? ` (${c.subclass.name})` : ""}`),
				race: state.getRace()?.name ?? null,
				background: state.getBackground()?.name ?? null,
				unresolved: report.unresolved,
				unhandledPrompts: report.unhandledPrompts,
				pinnedSpec: report.toPinnedSpec(),
				seed: report.seed,
			};
		} catch (e) {
			return {ok: false, error: (e as Error).message, level: 0, classes: [], race: null, background: null, unresolved: [], unhandledPrompts: [], pinnedSpec: null, seed: ""};
		}
	}, {spec, opts});
};

const expectClean = (result: SpawnResult, spec: string) => {
	expect(result.ok, `${spec} threw: ${result.error}`).toBe(true);
	expect(result.unresolved, `${spec} left choices unresolved`).toEqual([]);
	expect(result.unhandledPrompts, `${spec} opened a prompt the spawner could not answer`).toEqual([]);
};

test.describe("Character spawner", () => {
	test.beforeEach(async ({page}) => {
		await clearCharacterStorage(page);
	});

	const MATRIX: Array<{spec: string, level: number, cls: string, subclass?: string, race?: string}> = [
		{spec: "cleric/tempest/9/dwarf", level: 9, cls: "Cleric", subclass: "Tempest Domain", race: "Dwarf"},
		{spec: "fighter/champion/5", level: 5, cls: "Fighter", subclass: "Champion"},
		{spec: "wizard/evocation/5/gnome", level: 5, cls: "Wizard", subclass: "School of Evocation", race: "Gnome"},
		{spec: "rogue//1/halfling", level: 1, cls: "Rogue", race: "Halfling"},
		// Regression guard: three ASI levels drive the character's best ability to its cap,
		// after which the `+` button is live but inert. The wizard used to loop on the ASI
		// step forever, leaving a "level 12" spec stuck at level 1.
		{spec: "bard/lore/12/half-elf", level: 12, cls: "Bard", subclass: "College of Lore"},
	];

	for (const entry of MATRIX) {
		test(`spawns ${entry.spec} with every choice resolved`, async ({page}) => {
			const result = await spawn(page, entry.spec);

			expectClean(result, entry.spec);
			expect(result.level).toBe(entry.level);
			expect(result.classes.join(" / ")).toContain(`${entry.cls} ${entry.level}`);
			if (entry.subclass) expect(result.classes.join(" / ")).toContain(entry.subclass);
			if (entry.race) expect(result.race).toContain(entry.race);
			// A background is always needed — an unset one means the Builder's
			// background step silently no-opped.
			expect(result.background).toBeTruthy();
		});
	}

	test("spawns a multiclass build and gives every leg its subclass", async ({page}) => {
		const spec = "fighter/champion/5+warlock/fiend/3";
		const result = await spawn(page, spec);

		expectClean(result, spec);
		expect(result.level).toBe(8);
		expect(result.classes).toHaveLength(2);
		expect(result.classes[0]).toContain("Champion");
		// Regression guard: the second class used to be added with `subclass: null`,
		// so a multiclass leg silently lost its subclass and every feature it grants.
		expect(result.classes[1]).toContain("Fiend");
	});

	test("is deterministic — the same spec spawns the same character twice", async ({page}) => {
		const spec = "bard/lore/6/halfling";
		const first = await spawn(page, spec);
		const second = await spawn(page, spec);

		expectClean(first, spec);
		expect(second.seed).toBe(first.seed);
		expect(second.classes).toEqual(first.classes);
		expect(second.race).toEqual(first.race);
		expect(second.background).toEqual(first.background);
	});

	test("a seed changes the character without changing the build", async ({page}) => {
		const spec = "sorcerer//6";
		const a = await spawn(page, spec, {seed: "aaa"});
		const b = await spawn(page, spec, {seed: "bbb"});

		expectClean(a, spec);
		expectClean(b, spec);
		expect(a.level).toBe(6);
		expect(b.level).toBe(6);
		expect(a.seed).not.toBe(b.seed);
	});

	test("the pinned spec reproduces a randomly-spawned character exactly", async ({page}) => {
		const spec = "ranger//5";
		const random = await spawn(page, spec, {seed: "random"});
		expectClean(random, spec);

		const replayed = await page.evaluate(async (pinned) => {
			const cs = (globalThis as any).charSheet;
			const report = await cs.spawn(pinned, {save: false});
			const state = cs._state;
			return {
				classes: state.getClasses().map((c: any) => `${c.name} ${c.level}${c.subclass ? ` (${c.subclass.name})` : ""}`),
				race: state.getRace()?.name ?? null,
				background: state.getBackground()?.name ?? null,
				unresolved: report.unresolved,
			};
		}, random.pinnedSpec);

		expect(replayed.unresolved).toEqual([]);
		expect(replayed.classes).toEqual(random.classes);
		expect(replayed.race).toEqual(random.race);
		expect(replayed.background).toEqual(random.background);
	});

	test("the ?spawn= URL builds the character on load", async ({page}) => {
		await page.goto("/charactersheet.html?spawn=paladin/devotion/6/human&save=0", {waitUntil: "domcontentloaded"});
		await page.waitForFunction(() => (globalThis as any).charSheet?._state?.getTotalLevel() === 6, null, {timeout: 120_000});

		const result = await page.evaluate(() => {
			const cs = (globalThis as any).charSheet;
			return {
				classes: cs._state.getClasses().map((c: any) => `${c.name} ${c.level}${c.subclass ? ` (${c.subclass.name})` : ""}`),
				race: cs._state.getRace()?.name ?? null,
				clean: cs.lastSpawnReport()?.isClean,
			};
		});

		expect(result.clean).toBe(true);
		expect(result.classes.join()).toContain("Paladin 6");
		expect(result.classes.join()).toContain("Devotion");
		expect(result.race).toContain("Human");
	});

	test("stores its spec so the character can be respawned against newer code", async ({page}) => {
		const spec = "cleric/tempest/5/dwarf";
		await spawn(page, spec);

		const result = await page.evaluate(async () => {
			const cs = (globalThis as any).charSheet;
			const before = cs._state.getSpawnMeta();
			const json = cs._state.toJson();
			const report = await cs.respawn();
			return {
				hasMeta: !!before?.spec,
				survivesSerialisation: !!json.spawn,
				respawnClean: report?.isClean ?? null,
				respawnLevel: cs._state.getTotalLevel(),
			};
		});

		expect(result.hasMeta).toBe(true);
		expect(result.survivesSerialisation).toBe(true);
		expect(result.respawnClean).toBe(true);
		expect(result.respawnLevel).toBe(5);
	});

	test("reports a bad class name instead of building a broken character", async ({page}) => {
		const result = await spawn(page, "notaclass/3");

		expect(result.ok).toBe(false);
		expect(result.error).toMatch(/notaclass/i);
	});
});
