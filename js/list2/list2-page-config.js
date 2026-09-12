/** Only these reference-page main lists opt in; independent List consumers stay on the legacy renderer. */
export class ListPageConfig {
	static PAGES = Object.freeze([
		"actions",
		"backgrounds",
		"bastions",
		"bestiary",
		"charcreationoptions",
		"combatmethods",
		"conditionsdiseases",
		"crafting",
		"cultsboons",
		"decks",
		"deities",
		"feats",
		"homecrafts",
		"items",
		"itemupgrades",
		"languages",
		"objects",
		"optionalfeatures",
		"psionics",
		"races",
		"recipes",
		"rewards",
		"spells",
		"tables",
		"trapshazards",
		"variantrules",
		"vehicles",
	]);

	static isVirtualPage (page) {
		return this.PAGES.includes((page || "").replace(/\.html$/i, "").toLowerCase());
	}
}
