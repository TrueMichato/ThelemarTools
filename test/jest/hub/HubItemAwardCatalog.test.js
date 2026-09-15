import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

import {pBuildItemAwardSiteCatalog} from "../../../server/scripts/item-award-catalog-builder.mjs";
import {
	createItemAwardAuthorityResolver,
	createItemAwardResolver,
	resolveItemAward,
} from "../../../server/src/item-award-catalog.js";

describe("Campaign Hub authoritative item-award catalog", () => {
	it("matches the complete generated artifact shipped in the BFF image", async () => {
		const path = fileURLToPath(new URL("../../../server/data/item-award-site-catalog.json", import.meta.url));
		const committed = JSON.parse(await readFile(path, "utf8"));
		expect(committed).toEqual(await pBuildItemAwardSiteCatalog());
	});

	it("resolves a site item by identity and ignores client-supplied metadata", async () => {
		const item = await resolveItemAward({
			sourceKind: "catalog",
			item: {
				name: "Longsword",
				source: "PHB",
				weight: 0,
				value: 0,
				typeCode: "G",
			},
		});

		expect(item).toEqual(expect.objectContaining({
			name: "Longsword",
			source: "PHB",
			type: "M",
			weight: 3,
			value: 1500,
			weaponCategory: "martial",
			property: ["V"],
			dmg1: "1d8",
			dmg2: "1d10",
			dmgType: "S",
			weapon: true,
		}));
		expect(item).not.toHaveProperty("typeCode");
	});

	it("resolves campaign items only from the active trusted bundle", async () => {
		const campaignItem = {
			name: "Moonsteel Longsword",
			source: "TST",
			type: "M",
			weight: 3,
			value: 25000,
			entries: ["Synthetic trusted content."],
			_baseSource: "TST",
		};
		const resolve = createItemAwardResolver({
			fnLoadSiteItems: async () => new Map([
				["site blade|tst", {name: "Site Blade", source: "TST", type: "M"}],
			]),
		});
		const brewBundle = {content: [{body: {item: [campaignItem]}}]};

		await expect(resolve({
			sourceKind: "campaign_item",
			item: {name: campaignItem.name, source: campaignItem.source},
			brewBundle,
		})).resolves.toEqual(campaignItem);
		await expect(resolve({
			sourceKind: "campaign_item",
			item: {name: "Site Blade", source: "TST"},
			brewBundle,
		})).rejects.toMatchObject({code: "ITEM_AWARD_SOURCE_NOT_FOUND", status: 404});
		await expect(resolve({
			sourceKind: "recent",
			item: {name: campaignItem.name, source: campaignItem.source},
			brewBundle,
		})).resolves.toEqual(campaignItem);
	});

	it("preserves resolved authority and fails closed on site/campaign identity collisions", async () => {
		const siteItem = {
			name: "Longsword",
			source: "PHB",
			type: "M",
			weight: 3,
			entries: ["Official site metadata."],
		};
		const campaignCollision = {
			name: "Longsword",
			source: "PHB",
			type: "G",
			weight: 99,
			entries: ["Colliding campaign metadata."],
		};
		const resolve = createItemAwardAuthorityResolver({
			fnLoadSiteItems: async () => new Map([["longsword|phb", siteItem]]),
		});
		const brewBundle = {content: [{body: {item: [campaignCollision]}}]};

		await expect(resolve({
			sourceKind: "catalog",
			item: {name: siteItem.name, source: siteItem.source},
			brewBundle,
		})).resolves.toEqual({
			sourceKind: "catalog",
			authoritativeItem: siteItem,
		});
		for (const sourceKind of ["recent", "campaign_item"]) {
			await expect(resolve({
				sourceKind,
				item: {name: siteItem.name, source: siteItem.source},
				brewBundle,
			})).rejects.toMatchObject({
				code: "ITEM_AWARD_SOURCE_INVALID",
				status: 409,
			});
		}
	});

	it("resolves campaign item copy inheritance without trusting client metadata", async () => {
		const copiedItem = {
			name: "Moonsteel Longsword",
			source: "TST",
			_copy: {
				name: "Longsword",
				source: "PHB",
			},
			rarity: "rare",
			entries: ["Trusted campaign effect."],
		};
		const resolve = createItemAwardResolver();

		const resolved = await resolve({
			sourceKind: "campaign_item",
			item: {name: copiedItem.name, source: copiedItem.source, typeCode: "G", weight: 0},
			brewBundle: {content: [{body: {item: [copiedItem]}}]},
		});

		expect(resolved).toEqual(expect.objectContaining({
			name: copiedItem.name,
			source: copiedItem.source,
			type: "M",
			weight: 3,
			value: 1500,
			weaponCategory: "martial",
			dmg1: "1d8",
			dmg2: "1d10",
			dmgType: "S",
			entries: ["Trusted campaign effect."],
		}));
		expect(resolved).not.toHaveProperty("typeCode");
		expect(resolved).not.toHaveProperty("_copy");
	});

	it("rejects campaign copy inheritance through a site-UID-shadowing campaign parent", async () => {
		const siteParent = {
			name: "Longsword",
			source: "PHB",
			type: "M",
			weight: 3,
		};
		const collidingParent = {
			name: "LONGSWORD",
			source: "phb",
			type: "G",
			weight: 99,
		};
		const child = {
			name: "Shadow Child",
			source: "TST",
			_copy: {name: "Longsword", source: "PHB"},
		};
		const resolve = createItemAwardResolver({
			fnLoadSiteItems: async () => new Map([["longsword|phb", siteParent]]),
		});

		await expect(resolve({
			sourceKind: "campaign_item",
			item: {name: child.name, source: child.source},
			brewBundle: {content: [{body: {item: [collidingParent, child]}}]},
		})).rejects.toMatchObject({
			code: "ITEM_AWARD_SOURCE_INVALID",
			status: 409,
		});
	});

	it("does not inherit parent-only publication fields through a campaign item copy", async () => {
		const parent = {
			name: "Longsword",
			source: "PHB",
			type: "M",
			weight: 3,
			value: 1500,
			weaponCategory: "martial",
			property: ["V"],
			dmg1: "1d8",
			dmgType: "S",
			page: 149,
			otherSources: [{source: "XPHB", page: 213}],
			referenceSources: [{source: "SRD"}],
			srd: true,
			srd52: true,
			basicRules: true,
			basicRules2024: true,
			reprintedAs: ["Longsword|XPHB"],
			hasFluff: true,
			hasFluffImages: true,
			hasToken: true,
			tokenCredit: "Synthetic",
			tokenCustom: true,
			foundryTokenScale: 2,
			altArt: [{name: "Synthetic"}],
			_versions: [{name: "Legacy"}],
			lootTables: ["Synthetic Table"],
			tier: "minor",
		};
		const copiedItem = {
			name: "Moonsteel Longsword",
			source: "TST",
			_copy: {name: parent.name, source: parent.source},
			rarity: "rare",
			entries: ["Trusted campaign effect."],
		};
		const resolve = createItemAwardResolver({
			fnLoadSiteItems: async () => new Map([["longsword|phb", parent]]),
		});

		const resolved = await resolve({
			sourceKind: "campaign_item",
			item: {name: copiedItem.name, source: copiedItem.source},
			brewBundle: {content: [{body: {item: [copiedItem]}}]},
		});

		expect(resolved).toEqual(expect.objectContaining({
			name: copiedItem.name,
			source: copiedItem.source,
			type: parent.type,
			weight: parent.weight,
			value: parent.value,
			weaponCategory: parent.weaponCategory,
			property: parent.property,
			dmg1: parent.dmg1,
			dmgType: parent.dmgType,
			rarity: copiedItem.rarity,
			entries: copiedItem.entries,
			_isCopy: true,
		}));
		for (const key of [
			"page",
			"otherSources",
			"referenceSources",
			"srd",
			"srd52",
			"basicRules",
			"basicRules2024",
			"reprintedAs",
			"hasFluff",
			"hasFluffImages",
			"hasToken",
			"tokenCredit",
			"tokenCustom",
			"foundryTokenScale",
			"altArt",
			"_versions",
			"lootTables",
			"tier",
		]) expect(resolved).not.toHaveProperty(key);
	});

	it("rejects campaign copy metadata when its trusted parent cannot be resolved", async () => {
		const resolve = createItemAwardResolver({
			fnLoadSiteItems: async () => new Map(),
		});
		await expect(resolve({
			sourceKind: "campaign_item",
			item: {name: "Broken Blade", source: "TST"},
			brewBundle: {
				content: [{
					body: {
						item: [{
							name: "Broken Blade",
							source: "TST",
							_copy: {name: "Missing Blade", source: "PHB"},
						}],
					},
				}],
			},
		})).rejects.toMatchObject({
			code: "ITEM_AWARD_SOURCE_INVALID",
			status: 409,
		});
	});

	it("isolates copy-resolution caches between campaigns", async () => {
		const resolve = createItemAwardResolver({
			fnLoadSiteItems: async () => new Map(),
		});
		const getBundle = value => ({
			content: [{
				body: {
					item: [
						{name: "Campaign Base Blade", source: "TST", type: "M", value},
						{
							name: "Campaign Child Blade",
							source: "TST",
							_copy: {name: "Campaign Base Blade", source: "TST"},
						},
					],
				},
			}],
		});
		const input = {
			sourceKind: "campaign_item",
			item: {name: "Campaign Child Blade", source: "TST"},
		};

		await expect(resolve({...input, brewBundle: getBundle(100)}))
			.resolves.toEqual(expect.objectContaining({value: 100}));
		await expect(resolve({...input, brewBundle: getBundle(200)}))
			.resolves.toEqual(expect.objectContaining({value: 200}));
	});

	it("rejects executable or transforming campaign copy metadata", async () => {
		const resolve = createItemAwardResolver();
		await expect(resolve({
			sourceKind: "campaign_item",
			item: {name: "Modified Blade", source: "TST"},
			brewBundle: {
				content: [{
					body: {
						item: [{
							name: "Modified Blade",
							source: "TST",
							_copy: {
								name: "Longsword",
								source: "PHB",
								_mod: {name: {mode: "appendStr", str: " modified"}},
							},
						}],
					},
				}],
			},
		})).rejects.toMatchObject({
			code: "ITEM_AWARD_SOURCE_INVALID",
			status: 409,
		});
	});

	it("rejects ambiguous campaign item identities", async () => {
		const resolve = createItemAwardResolver();
		await expect(resolve({
			sourceKind: "campaign_item",
			item: {name: "Duplicate Blade", source: "TST"},
			brewBundle: {
				content: [
					{body: {item: [{name: "Duplicate Blade", source: "TST", type: "M"}]}},
					{body: {item: [{name: "Duplicate Blade", source: "TST", type: "R"}]}},
				],
			},
		})).rejects.toMatchObject({
			code: "ITEM_AWARD_SOURCE_INVALID",
			status: 409,
		});
	});
});
