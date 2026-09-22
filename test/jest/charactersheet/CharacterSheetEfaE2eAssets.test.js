import fs from "node:fs";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {build} from "esbuild";
import {jest} from "@jest/globals";

const OUT_DIR = path.resolve("test-results/m7-efa-contract");

async function bundle (entryPoint, outfile) {
	await build({
		entryPoints: [path.resolve(entryPoint)],
		outfile: path.join(OUT_DIR, outfile),
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node24",
		plugins: [{
			name: "playwright-contract-stub",
			setup (build) {
				build.onResolve({filter: /^@playwright\/test$/}, () => ({path: "playwright-contract-stub", namespace: "m7-contract"}));
				build.onLoad({filter: /.*/, namespace: "m7-contract"}, () => ({
					contents: "export const expect = () => { throw new Error('Playwright expect is unavailable in the M7 contract bundle.'); };",
					loader: "js",
				}));
			},
		}],
		logLevel: "silent",
	});
}

async function importBundle (outfile) {
	return import(`${pathToFileURL(path.join(OUT_DIR, outfile)).href}?contract=${Date.now()}`);
}

let presetApi;
let matrixApi;
let dispatcherApi;
let pageApi;
let levelUpApi;

beforeAll(async () => {
	fs.rmSync(OUT_DIR, {recursive: true, force: true});
	fs.mkdirSync(OUT_DIR, {recursive: true});
	await Promise.all([
		bundle("test/e2e/utils/characterBuilder.ts", "characterBuilder.mjs"),
		bundle("test/e2e/utils/efaArtificerBase.ts", "efaArtificerBase.mjs"),
		bundle("test/e2e/utils/comprehensiveBuildHelpers.ts", "comprehensiveBuildHelpers.mjs"),
		bundle("test/e2e/pages/CharacterSheetPage.ts", "CharacterSheetPage.mjs"),
		bundle("test/e2e/pages/LevelUpPage.ts", "LevelUpPage.mjs"),
	]);
	[presetApi, matrixApi, dispatcherApi, pageApi, levelUpApi] = await Promise.all([
		importBundle("characterBuilder.mjs"),
		importBundle("efaArtificerBase.mjs"),
		importBundle("comprehensiveBuildHelpers.mjs"),
		importBundle("CharacterSheetPage.mjs"),
		importBundle("LevelUpPage.mjs"),
	]);
});

afterAll(() => fs.rmSync(OUT_DIR, {recursive: true, force: true}));

describe("EFA Artificer reusable E2E preset", () => {
	it("pins the source-safe base choices while retaining the accepted subclass source", () => {
		const preset = presetApi.buildEfaArtificerPreset({
			race: "Human",
			raceSource: "XPHB",
			background: "Sage",
			bgSource: "XPHB",
			name: "M7 Probe",
			subclassName: "Future Accepted Subclass",
			subclassSource: "RHW",
			prioritySources: ["XPHB"],
			skillCount: 9,
			preferredSkills: ["Stealth"],
			equipmentOption: "gold",
			abilityPriority: ["str"],
			signatureSpells: ["Fireball"],
		});

		expect(preset).toMatchObject({
			className: "Artificer",
			classSource: "EFA",
			subclassName: "Future Accepted Subclass",
			subclassSource: "RHW",
			skillCount: 2,
			preferredSkills: ["Arcana", "Investigation"],
			equipmentOption: "equipment",
			abilityPriority: ["int", "con", "dex", "wis", "str", "cha"],
			signatureSpells: ["Acid Splash", "Cure Wounds"],
		});
		expect(preset.prioritySources).toEqual(["EFA", "XPHB", "RHW"]);
	});

	it("refuses to manufacture a subclass-free comprehensive preset", () => {
		expect(() => presetApi.buildEfaArtificerPreset({
			race: "Human",
			raceSource: "XPHB",
			background: "Sage",
			bgSource: "XPHB",
			name: "Invalid",
		})).toThrow(/requires an accepted EFA subclass/i);
	});
});

describe("EFA Artificer base feature matrix contract", () => {
	const expectedProgression = [
		["Spellcasting|Artificer|EFA|1|EFA", 1],
		["Tinker's Magic|Artificer|EFA|1|EFA", 1],
		["Replicate Magic Item|Artificer|EFA|2|EFA", 2],
		["Ability Score Improvement|Artificer|EFA|4|EFA", 4],
		["Magic Item Tinker|Artificer|EFA|6|EFA", 6],
		["Flash of Genius|Artificer|EFA|7|EFA", 7],
		["Ability Score Improvement|Artificer|EFA|8|EFA", 8],
		["Magic Item Adept|Artificer|EFA|10|EFA", 10],
		["Spell-Storing Item|Artificer|EFA|11|EFA", 11],
		["Ability Score Improvement|Artificer|EFA|12|EFA", 12],
		["Advanced Artifice|Artificer|EFA|14|EFA", 14],
		["Ability Score Improvement|Artificer|EFA|16|EFA", 16],
		["Magic Item Master|Artificer|EFA|18|EFA", 18],
		["Epic Boon|Artificer|EFA|19|EFA", 19],
		["Soul of Artifice|Artificer|EFA|20|EFA", 20],
	];

	it("uses exact source-qualified UIDs at every base milestone", () => {
		const matrix = matrixApi.buildEfaArtificerBaseChecks();
		for (const [uid, level] of expectedProgression) {
			expect(matrix.some(row => row.featureUid === uid && row.level === level)).toBe(true);
		}
		expect(matrix.every(row => {
			const parts = row.featureUid?.split("|") || [];
			return parts.length === 5 && parts[2] === "EFA" && parts[4] === "EFA";
		})).toBe(true);
		expect(matrix.some(row => /subclass/i.test(String(row.featureUid)))).toBe(false);
	});

	it("covers every generic EFA Ability Score Improvement choice with a persisted decision probe", () => {
		const matrix = matrixApi.buildEfaArtificerBaseChecks();
		const rows = matrix.filter(row => String(row.featureUid).startsWith("Ability Score Improvement|"));
		expect(rows.map(row => row.level)).toEqual([4, 8, 12, 16]);
		for (const row of rows) {
			expect(row.effects).toEqual(expect.arrayContaining([
				expect.objectContaining({
					kind: "stateTransaction",
					steps: [expect.objectContaining({
						method: "getLevelHistoryEntry",
						args: [row.level],
						expect: expect.arrayContaining([
							{path: "choices.asi", truthy: true},
						]),
					})],
				}),
			]));
		}
	});

	it("uses the exact XPHB Tinker's Tools identity in every tool-dependent transaction", () => {
		const matrix = matrixApi.buildEfaArtificerBaseChecks();
		const tools = matrix
			.flatMap(row => row.effects || [])
			.filter(effect => effect.kind === "stateTransaction")
			.flatMap(effect => effect.steps)
			.filter(step =>
				step.method === "addItem"
				&& step.args?.[0]?.name === "Tinker's Tools",
			)
			.map(step => step.args[0]);

		expect(tools.length).toBeGreaterThanOrEqual(4);
		expect(tools.every(item => item.source === "XPHB")).toBe(true);
		expect(tools.every(item => item._isCustom === true)).toBe(true);
	});

	it("publishes the exact Replicate and attunement scaling tiers", () => {
		const matrix = matrixApi.buildEfaArtificerBaseChecks();
		const calc = (row, property) => row.effects?.find(effect => effect.kind === "featureCalculation" && effect.property === property)?.exact;
		const replicate = matrix.filter(row => String(row.featureUid).startsWith("Replicate Magic Item|"));
		expect(replicate.map(row => [row.level, row.untilLevel, calc(row, "artificerPlansKnown"), calc(row, "artificerCreatedMagicItemsMax")]))
			.toEqual([
				[2, 5, 4, 2],
				[6, 9, 5, 3],
				[10, 13, 6, 4],
				[14, 17, 7, 5],
				[18, undefined, 8, 6],
			]);

		const attunement = matrix.flatMap(row => (row.effects || [])
			.filter(effect => effect.kind === "attunementCap")
			.map(effect => [row.level, row.untilLevel, effect.exact]));
		expect(attunement).toEqual([
			[10, 13, 4],
			[14, 17, 5],
			[18, undefined, 6],
		]);
	});

	it("gives every measurable row a real effect and documents the lone narrative row", () => {
		const matrix = matrixApi.buildEfaArtificerBaseChecks();
		const narrative = matrix.filter(row => row.effectReason);
		expect(narrative).toHaveLength(1);
		expect(narrative[0].featureUid).toBe("Epic Boon|Artificer|EFA|19|EFA");
		expect(narrative[0].effects).toBeUndefined();
		for (const row of matrix.filter(row => !row.effectReason)) {
			expect(row.effects?.length).toBeGreaterThan(0);
		}
	});

	it("covers every M1-M6 transaction family without a class-named dispatcher kind", () => {
		const matrix = matrixApi.buildEfaArtificerBaseChecks();
		const effects = matrix.flatMap(row => row.effects || []);
		const transactions = effects.filter(effect => effect.kind === "stateTransaction");
		const methods = [
			...transactions.flatMap(effect => effect.steps.map(step => step.method)),
			...effects.filter(effect => effect.kind === "stateCall").map(effect => effect.method),
		];

		expect(methods).toEqual(expect.arrayContaining([
			"commitEfaArtificerTinkerTransaction",
			"commitEfaReplicateMagicItemsAtLongRest",
			"pUseFlashOfGenius",
			"getCraftingTimeCalculation",
			"commitEfaSpellStoringItemAtLongRest",
			"reserveEfaSpellStoringItemUse",
			"commitEfaSpellStoringItemUse",
			"applyZeroHpIntervention",
		]));
		expect(effects.map(effect => effect.kind)).not.toContain("efaArtificer");
	});
});

describe("generic EffectCheck dispatcher causal controls", () => {
	it("attunementCap passes for the live cap and fails for a mismatched cap", async () => {
		const charSheet = {getMaxAttunement: jest.fn(async () => 5)};
		await expect(dispatcherApi.runEffectCheck(charSheet, {kind: "attunementCap", exact: 5})).resolves.toBeUndefined();
		await expect(dispatcherApi.runEffectCheck(charSheet, {kind: "attunementCap", exact: 4}))
			.rejects.toThrow(/attunement cap=5, expected 4/i);
	});

	it("stateTransaction forwards generic method descriptors and surfaces transaction failure", async () => {
		const steps = [
			{method: "setCurrentHp", args: [0]},
			{method: "getCurrentHp", expect: [{exact: 0}]},
		];
		const passing = {runStateTransaction: jest.fn(async () => undefined)};
		await expect(dispatcherApi.runEffectCheck(passing, {kind: "stateTransaction", steps})).resolves.toBeUndefined();
		expect(passing.runStateTransaction).toHaveBeenCalledWith(steps, {restore: true});

		const failing = {runStateTransaction: jest.fn(async () => {
			throw new Error("step 2 getCurrentHp=1, expected 0");
		})};
		await expect(dispatcherApi.runEffectCheck(failing, {kind: "stateTransaction", steps}))
			.rejects.toThrow(/getCurrentHp=1, expected 0/);
	});

	it("stateTransaction executes causal steps and restores both success and failure probes", async () => {
		const steps = [
			{method: "setCurrentHp", args: [0]},
			{method: "getCurrentHp", expect: [{exact: 0}]},
		];
		const data = {hp: 5};
		const state = {
			toJson: () => structuredClone(data),
			loadFromJson: snapshot => Object.assign(data, snapshot),
			setCurrentHp: hp => { data.hp = hp; },
			getCurrentHp: () => data.hp,
		};
		const charSheet = {_state: state, render: jest.fn()};
		const fakePage = {
			evaluate: async (fn, arg) => {
				const previous = globalThis.charSheet;
				globalThis.charSheet = charSheet;
				try { return await fn(arg); } finally { globalThis.charSheet = previous; }
			},
		};
		const sheet = Object.create(pageApi.CharacterSheetPage.prototype);
		sheet.page = fakePage;

		await expect(sheet.runStateTransaction(steps)).resolves.toBeUndefined();
		expect(data.hp).toBe(5);

		const wrongControl = [
			{method: "setCurrentHp", args: [0]},
			{method: "getCurrentHp", expect: [{exact: 1}]},
		];
		await expect(sheet.runStateTransaction(wrongControl)).rejects.toThrow(/getCurrentHp=0, expected 1/);
		expect(data.hp).toBe(5);
	});

	it("featureCalculationDerivedFrom applies the generic multiplier causally", async () => {
		const data = {actual: 8, abilityMod: 4};
		const charSheet = {
			page: {
				evaluate: async (fn, arg) => {
					const previous = globalThis.charSheet;
					globalThis.charSheet = {
						_state: {
							getFeatureCalculations: () => ({spellStoringItemUses: data.actual}),
							getAbilityMod: () => data.abilityMod,
						},
					};
					try { return await fn(arg); } finally { globalThis.charSheet = previous; }
				},
			},
		};
		const effect = {
			kind: "featureCalculationDerivedFrom",
			property: "spellStoringItemUses",
			equals: "abilityMod",
			ability: "int",
			multiplier: 2,
		};

		await expect(dispatcherApi.runEffectCheck(charSheet, effect)).resolves.toBeUndefined();
		data.actual = 7;
		await expect(dispatcherApi.runEffectCheck(charSheet, effect))
			.rejects.toThrow(/expected abilityMod\(int\) × 2 = 8/);
	});

	it("spellInList includes innate spell grants and fails when the grant is absent", async () => {
		const charSheet = {
			getKnownSpellNames: jest.fn(async () => []),
			getCantripNames: jest.fn(async () => []),
			getInnateSpellNames: jest.fn(async () => ["Produce Flame"]),
		};
		await expect(dispatcherApi.runEffectCheck(charSheet, {kind: "spellInList", spell: "Produce Flame"}))
			.resolves.toBeUndefined();

		charSheet.getInnateSpellNames.mockResolvedValue([]);
		await expect(dispatcherApi.runEffectCheck(charSheet, {kind: "spellInList", spell: "Produce Flame"}))
			.rejects.toThrow(/Produce Flame.*not in spellbook/i);
	});

	it("counts innate cantrip grants in the page-object spell-level projection", async () => {
		const state = {
			getSpells: () => [{name: "Acid Splash", level: 0}],
			getInnateSpells: () => [{name: "Produce Flame", level: 0}],
		};
		const fakePage = {
			evaluate: async fn => {
				const previous = globalThis.charSheet;
				globalThis.charSheet = {_state: state};
				try { return await fn(); } finally { globalThis.charSheet = previous; }
			},
		};
		const sheet = Object.create(pageApi.CharacterSheetPage.prototype);
		sheet.page = fakePage;

		await expect(sheet.getKnownSpellsByLevel()).resolves.toEqual({
			0: ["Acid Splash", "Produce Flame"],
		});
	});
});

describe("source-qualified feature page-object boundary", () => {
	it("accepts the exact EFA feature and rejects the same name from another source", async () => {
		const state = {
			getFeatures: () => [{
				name: "Spellcasting",
				className: "Artificer",
				classSource: "EFA",
				level: 1,
				source: "EFA",
			}],
		};
		const fakePage = {
			evaluate: async (fn, arg) => {
				const previous = globalThis.charSheet;
				globalThis.charSheet = {_state: state};
				try { return await fn(arg); } finally { globalThis.charSheet = previous; }
			},
		};
		const sheet = Object.create(pageApi.CharacterSheetPage.prototype);
		sheet.page = fakePage;

		await expect(sheet.hasClassFeatureUid("Spellcasting|Artificer|EFA|1|EFA")).resolves.toBe(true);
		await expect(sheet.hasClassFeatureUid("Spellcasting|Artificer|TCE|1|TCE")).resolves.toBe(false);
	});
});

describe("EFA Artificer level-up page-object boundary", () => {
	it("publishes and auto-runs the required-plan picker driver", () => {
		expect(typeof levelUpApi.LevelUpPage.prototype.selectRequiredEfaArtificerPlans).toBe("function");
		expect(levelUpApi.LevelUpPage.prototype.autoFillAllSelections.toString())
			.toContain("selectRequiredEfaArtificerPlans");
	});
});
