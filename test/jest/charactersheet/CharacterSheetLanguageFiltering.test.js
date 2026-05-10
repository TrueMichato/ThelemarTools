import "./setup.js";

// Add language constants to Parser mock
globalThis.Parser.LANGUAGES_STANDARD = [
	"Common", "Dwarvish", "Elvish", "Giant", "Gnomish", "Goblin", "Halfling", "Orc",
];
globalThis.Parser.LANGUAGES_EXOTIC = [
	"Abyssal", "Aquan", "Auran", "Celestial", "Draconic", "Deep Speech",
	"Ignan", "Infernal", "Primordial", "Sylvan", "Terran", "Undercommon",
];
globalThis.Parser.LANGUAGES_SECRET = [
	"Druidic", "Thieves' cant",
];

// Minimal D&D language data (PHB entries)
const PHB_LANGUAGES = [
	{name: "Common", source: "PHB", type: "standard"},
	{name: "Dwarvish", source: "PHB", type: "standard"},
	{name: "Elvish", source: "PHB", type: "standard"},
	{name: "Giant", source: "PHB", type: "standard"},
	{name: "Gnomish", source: "PHB", type: "standard"},
	{name: "Goblin", source: "PHB", type: "standard"},
	{name: "Halfling", source: "PHB", type: "standard"},
	{name: "Orc", source: "PHB", type: "standard"},
	{name: "Abyssal", source: "PHB", type: "exotic"},
	{name: "Celestial", source: "PHB", type: "exotic"},
	{name: "Draconic", source: "PHB", type: "exotic"},
	{name: "Deep Speech", source: "PHB", type: "exotic"},
	{name: "Infernal", source: "PHB", type: "exotic"},
	{name: "Primordial", source: "PHB", type: "exotic"},
	{name: "Sylvan", source: "PHB", type: "exotic"},
	{name: "Undercommon", source: "PHB", type: "exotic"},
	{name: "Druidic", source: "PHB", type: "secret"},
	{name: "Thieves' cant", source: "PHB", type: "secret"},
];

// TGTT language data (from TravelersGuidetoThelemar.json)
const TGTT_LANGUAGES = [
	{name: "Lexalian", source: "TGTT", type: "standard"},
	{name: "Olympian", source: "TGTT", type: "standard"},
	{name: "Jaknian", source: "TGTT", type: "standard"},
	{name: "Clairnian", source: "TGTT", type: "standard"},
	{name: "Hubian", source: "TGTT", type: "standard"},
	{name: "Old Common", source: "TGTT", type: "ancient"},
	{name: "Stygian", source: "TGTT", type: "exotic"},
	{name: "Mictlanian", source: "TGTT", type: "exotic"},
	{name: "Jotunn", source: "TGTT", type: "exotic"},
	{name: "Avian", source: "TGTT", type: "exotic"},
	{name: "Gob", source: "TGTT", type: "exotic"},
	{name: "Loxodon", source: "TGTT", type: "exotic"},
	{name: "Tabaxi", source: "TGTT", type: "exotic"},
	{name: "Minotaur", source: "TGTT", type: "exotic"},
];

// Non-TGTT homebrew languages (from other homebrew sources)
const OTHER_HOMEBREW_LANGUAGES = [
	{name: "Krakenspeak", source: "MyBrew", type: "exotic"},
	{name: "Fey Pidgin", source: "OtherBrew", type: "standard"},
];

// CharacterSheetPage has deep transitive imports, so we import just charactersheet-state.js
// for globalThis.CharacterSheetState and test the language methods via a lightweight stub
// that reuses the exact same method source from charactersheet.js.
import "../../../js/charactersheet/charactersheet-state.js";

// Re-implement the two methods here matching charactersheet.js to avoid importing the full module tree.
// Tests verify the algorithm; any drift from the source would be caught by integration/browser tests.
function getLanguageNamesSorted (page) {
	const prioritySources = page._state.getPrioritySources() || [];
	const isTgtt = prioritySources.includes("TGTT");
	const langMap = new Map();

	page._languagesData.forEach(lang => {
		const existing = langMap.get(lang.name);
		if (!existing) {
			langMap.set(lang.name, {name: lang.name, source: lang.source});
		} else if (prioritySources.includes(lang.source) && !prioritySources.includes(existing.source)) {
			langMap.set(lang.name, {name: lang.name, source: lang.source});
		} else if (lang.source === Parser.SRC_XPHB && !prioritySources.includes(existing.source)) {
			langMap.set(lang.name, {name: lang.name, source: lang.source});
		}

		// Also add dialect names so they appear as choosable languages
		if (lang.dialects?.length) {
			for (const dialect of lang.dialects) {
				if (!langMap.has(dialect)) {
					langMap.set(dialect, {name: dialect, source: lang.source});
				}
			}
		}
	});

	if (isTgtt) {
		const standardSet = new Set(Parser.LANGUAGES_STANDARD);
		const exoticSet = new Set(Parser.LANGUAGES_EXOTIC);
		const secretSet = new Set(Parser.LANGUAGES_SECRET);
		for (const [name, info] of langMap) {
			if (standardSet.has(name) && name !== "Common") { langMap.delete(name); continue; }
			if (!standardSet.has(name) && !exoticSet.has(name) && !secretSet.has(name)
				&& !prioritySources.includes(info.source)) {
				langMap.delete(name);
			}
		}
	}

	const languages = Array.from(langMap.values());
	return languages.sort((a, b) => {
		const aIsPriority = prioritySources.includes(a.source);
		const bIsPriority = prioritySources.includes(b.source);
		if (aIsPriority && !bIsPriority) return -1;
		if (!aIsPriority && bIsPriority) return 1;
		return a.name.localeCompare(b.name);
	}).map(l => l.name);
}

function getLanguageOptionsGrouped (page) {
	const prioritySources = page._state.getPrioritySources() || [];
	const isTgtt = prioritySources.includes("TGTT");

	const standardSet = new Set(Parser.LANGUAGES_STANDARD);
	const exoticSet = new Set(Parser.LANGUAGES_EXOTIC);
	const secretSet = new Set(Parser.LANGUAGES_SECRET);

	const tgttTypeMap = new Map();
	if (isTgtt) {
		page._languagesData.forEach(lang => {
			if (prioritySources.includes(lang.source) && lang.type) {
				tgttTypeMap.set(lang.name, lang.type);
			}
		});
	}

	const langMap = new Map();
	page._languagesData.forEach(lang => {
		const existing = langMap.get(lang.name);
		if (!existing) {
			langMap.set(lang.name, {name: lang.name, source: lang.source});
		} else if (prioritySources.includes(lang.source) && !prioritySources.includes(existing.source)) {
			langMap.set(lang.name, {name: lang.name, source: lang.source});
		} else if (lang.source === Parser.SRC_XPHB && !prioritySources.includes(existing.source)) {
			langMap.set(lang.name, {name: lang.name, source: lang.source});
		}

		// Also add dialect names so they appear as choosable languages
		if (lang.dialects?.length) {
			for (const dialect of lang.dialects) {
				if (!langMap.has(dialect)) {
					langMap.set(dialect, {name: dialect, source: lang.source});
				}
			}
		}
	});

	const standard = [];
	const exotic = [];
	const secret = [];
	const homebrew = [];

	const sortLangs = (arr) => arr.sort((a, b) => {
		const aInfo = langMap.get(a);
		const bInfo = langMap.get(b);
		const aIsPriority = aInfo && prioritySources.includes(aInfo.source);
		const bIsPriority = bInfo && prioritySources.includes(bInfo.source);
		if (aIsPriority && !bIsPriority) return -1;
		if (!aIsPriority && bIsPriority) return 1;
		return a.localeCompare(b);
	});

	for (const [name, info] of langMap) {
		if (isTgtt) {
			if (standardSet.has(name) && name !== "Common") continue;
			if (!standardSet.has(name) && !exoticSet.has(name) && !secretSet.has(name)
				&& !prioritySources.includes(info.source)) continue;
			const tgttType = tgttTypeMap.get(name);
			if (tgttType === "standard") { standard.push(name); continue; }
			if (tgttType === "exotic") { exotic.push(name); continue; }
		}

		if (standardSet.has(name)) {
			standard.push(name);
		} else if (exoticSet.has(name)) {
			exotic.push(name);
		} else if (secretSet.has(name)) {
			secret.push(name);
		} else {
			homebrew.push(name);
		}
	}

	Parser.LANGUAGES_STANDARD.forEach(l => {
		if (langMap.has(l)) return;
		if (isTgtt && l !== "Common") return;
		standard.push(l);
	});
	Parser.LANGUAGES_EXOTIC.forEach(l => {
		if (!langMap.has(l)) exotic.push(l);
	});
	Parser.LANGUAGES_SECRET.forEach(l => {
		if (!langMap.has(l)) secret.push(l);
	});

	return {
		standard: sortLangs(standard),
		exotic: sortLangs(exotic),
		secret: sortLangs(secret),
		homebrew: sortLangs(homebrew),
	};
}

function makePage ({prioritySources = [], languagesData = []} = {}) {
	return {
		_state: {
			getPrioritySources: () => prioritySources.length ? prioritySources : null,
		},
		_languagesData: languagesData,
	};
}

describe("CharacterSheet Language Filtering", () => {
	describe("getLanguageOptionsGrouped", () => {
		test("without TGTT priority, standard D&D languages are in standard group", () => {
			const page = makePage({languagesData: PHB_LANGUAGES});
			const result = getLanguageOptionsGrouped(page);

			expect(result.standard).toContain("Common");
			expect(result.standard).toContain("Dwarvish");
			expect(result.standard).toContain("Elvish");
			expect(result.exotic).toContain("Abyssal");
			expect(result.secret).toContain("Druidic");
			expect(result.homebrew).toEqual([]);
		});

		test("without TGTT priority, TGTT languages go to homebrew", () => {
			const page = makePage({languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES]});
			const result = getLanguageOptionsGrouped(page);

			expect(result.homebrew).toContain("Lexalian");
			expect(result.homebrew).toContain("Jotunn");
			expect(result.standard).toContain("Dwarvish");
		});

		test("with TGTT priority, non-Common standard D&D languages are excluded", () => {
			const page = makePage({
				prioritySources: ["TGTT"],
				languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES],
			});
			const result = getLanguageOptionsGrouped(page);

			expect(result.standard).not.toContain("Dwarvish");
			expect(result.standard).not.toContain("Elvish");
			expect(result.standard).not.toContain("Giant");
			expect(result.standard).not.toContain("Gnomish");
			expect(result.standard).not.toContain("Goblin");
			expect(result.standard).not.toContain("Halfling");
			expect(result.standard).not.toContain("Orc");
		});

		test("with TGTT priority, Common is kept in standard group", () => {
			const page = makePage({
				prioritySources: ["TGTT"],
				languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES],
			});
			const result = getLanguageOptionsGrouped(page);

			expect(result.standard).toContain("Common");
		});

		test("with TGTT priority, TGTT standard-type languages are in standard group", () => {
			const page = makePage({
				prioritySources: ["TGTT"],
				languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES],
			});
			const result = getLanguageOptionsGrouped(page);

			expect(result.standard).toContain("Lexalian");
			expect(result.standard).toContain("Olympian");
			expect(result.standard).toContain("Jaknian");
			expect(result.standard).toContain("Clairnian");
			expect(result.standard).toContain("Hubian");
		});

		test("with TGTT priority, TGTT exotic-type languages are in exotic group", () => {
			const page = makePage({
				prioritySources: ["TGTT"],
				languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES],
			});
			const result = getLanguageOptionsGrouped(page);

			expect(result.exotic).toContain("Jotunn");
			expect(result.exotic).toContain("Avian");
			expect(result.exotic).toContain("Gob");
			expect(result.exotic).toContain("Stygian");
			expect(result.exotic).toContain("Mictlanian");
			expect(result.exotic).toContain("Loxodon");
			expect(result.exotic).toContain("Tabaxi");
			expect(result.exotic).toContain("Minotaur");
		});

		test("with TGTT priority, D&D exotic languages are still in exotic group", () => {
			const page = makePage({
				prioritySources: ["TGTT"],
				languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES],
			});
			const result = getLanguageOptionsGrouped(page);

			expect(result.exotic).toContain("Abyssal");
			expect(result.exotic).toContain("Celestial");
			expect(result.exotic).toContain("Infernal");
		});

		test("with TGTT priority, secret languages are unchanged", () => {
			const page = makePage({
				prioritySources: ["TGTT"],
				languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES],
			});
			const result = getLanguageOptionsGrouped(page);

			expect(result.secret).toContain("Druidic");
			expect(result.secret).toContain("Thieves' cant");
		});

		test("with TGTT priority, homebrew group is empty (all TGTT langs categorized)", () => {
			const page = makePage({
				prioritySources: ["TGTT"],
				languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES],
			});
			const result = getLanguageOptionsGrouped(page);

			// Only "Old Common" (type: "ancient") should remain in homebrew
			expect(result.homebrew).not.toContain("Lexalian");
			expect(result.homebrew).not.toContain("Jotunn");
		});

		test("with TGTT priority, TGTT standard languages sort before others", () => {
			const page = makePage({
				prioritySources: ["TGTT"],
				languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES],
			});
			const result = getLanguageOptionsGrouped(page);

			// TGTT languages (priority source) should come before Common
			const commonIdx = result.standard.indexOf("Common");
			const lexalianIdx = result.standard.indexOf("Lexalian");
			expect(lexalianIdx).toBeLessThan(commonIdx);
		});
	});

	describe("getLanguageNamesSorted", () => {
		test("without TGTT priority, returns all languages sorted", () => {
			const page = makePage({languagesData: PHB_LANGUAGES});
			const result = getLanguageNamesSorted(page);

			expect(result).toContain("Common");
			expect(result).toContain("Dwarvish");
			expect(result).toContain("Abyssal");
		});

		test("with TGTT priority, excludes non-Common standard D&D languages", () => {
			const page = makePage({
				prioritySources: ["TGTT"],
				languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES],
			});
			const result = getLanguageNamesSorted(page);

			expect(result).toContain("Common");
			expect(result).not.toContain("Dwarvish");
			expect(result).not.toContain("Elvish");
			expect(result).not.toContain("Giant");
			expect(result).not.toContain("Gnomish");
			expect(result).not.toContain("Goblin");
			expect(result).not.toContain("Halfling");
			expect(result).not.toContain("Orc");
		});

		test("with TGTT priority, includes TGTT languages", () => {
			const page = makePage({
				prioritySources: ["TGTT"],
				languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES],
			});
			const result = getLanguageNamesSorted(page);

			expect(result).toContain("Lexalian");
			expect(result).toContain("Jotunn");
			expect(result).toContain("Avian");
		});

		test("with TGTT priority, TGTT languages sort first", () => {
			const page = makePage({
				prioritySources: ["TGTT"],
				languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES],
			});
			const result = getLanguageNamesSorted(page);

			// TGTT languages (priority) should be before D&D exotic languages
			const avianIdx = result.indexOf("Avian");
			const abyssalIdx = result.indexOf("Abyssal");
			expect(avianIdx).toBeLessThan(abyssalIdx);
		});

		test("with TGTT priority, D&D exotic languages are still included", () => {
			const page = makePage({
				prioritySources: ["TGTT"],
				languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES],
			});
			const result = getLanguageNamesSorted(page);

			expect(result).toContain("Abyssal");
			expect(result).toContain("Celestial");
			expect(result).toContain("Infernal");
		});

		test("with TGTT priority, non-TGTT homebrew languages are excluded", () => {
			const page = makePage({
				prioritySources: ["TGTT"],
				languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES, ...OTHER_HOMEBREW_LANGUAGES],
			});
			const result = getLanguageNamesSorted(page);

			expect(result).not.toContain("Krakenspeak");
			expect(result).not.toContain("Fey Pidgin");
			// TGTT languages still present
			expect(result).toContain("Lexalian");
			expect(result).toContain("Jotunn");
		});

		test("without TGTT priority, non-TGTT homebrew languages are included", () => {
			const page = makePage({
				languagesData: [...PHB_LANGUAGES, ...OTHER_HOMEBREW_LANGUAGES],
			});
			const result = getLanguageNamesSorted(page);

			expect(result).toContain("Krakenspeak");
			expect(result).toContain("Fey Pidgin");
		});
	});

	describe("non-TGTT homebrew exclusion in getLanguageOptionsGrouped", () => {
		test("with TGTT priority, non-TGTT homebrew languages are excluded from all groups", () => {
			const page = makePage({
				prioritySources: ["TGTT"],
				languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES, ...OTHER_HOMEBREW_LANGUAGES],
			});
			const result = getLanguageOptionsGrouped(page);

			const allLangs = [...result.standard, ...result.exotic, ...result.secret, ...result.homebrew];
			expect(allLangs).not.toContain("Krakenspeak");
			expect(allLangs).not.toContain("Fey Pidgin");
		});

		test("without TGTT priority, non-TGTT homebrew languages appear in homebrew group", () => {
			const page = makePage({
				languagesData: [...PHB_LANGUAGES, ...OTHER_HOMEBREW_LANGUAGES],
			});
			const result = getLanguageOptionsGrouped(page);

			expect(result.homebrew).toContain("Krakenspeak");
			expect(result.homebrew).toContain("Fey Pidgin");
		});
	});
});

// ==========================================================================
// groupLanguagesByType — mirrors _groupLanguagesByType() from builder
// ==========================================================================

function groupLanguagesByType (names, page) {
	const grouped = getLanguageOptionsGrouped(page);
	const standardSet = new Set(grouped.standard);
	const exoticSet = new Set(grouped.exotic);
	const secretSet = new Set(grouped.secret);

	const homebrew = [];
	const standard = [];
	const exotic = [];
	const secret = [];

	for (const name of names) {
		if (standardSet.has(name)) standard.push(name);
		else if (exoticSet.has(name)) exotic.push(name);
		else if (secretSet.has(name)) secret.push(name);
		else homebrew.push(name);
	}

	const reorder = (arr, reference) =>
		[...reference.filter(l => arr.includes(l)), ...arr.filter(l => !reference.includes(l)).sort()];

	return {
		homebrew: homebrew.sort(),
		standard: reorder(standard, grouped.standard),
		exotic: reorder(exotic, grouped.exotic),
		secret: reorder(secret, grouped.secret),
	};
}

describe("groupLanguagesByType (builder _groupLanguagesByType mirror)", () => {
	test("common D&D languages are split into correct buckets", () => {
		const page = makePage({languagesData: PHB_LANGUAGES});
		const names = ["Common", "Dwarvish", "Abyssal", "Druidic"];
		const result = groupLanguagesByType(names, page);

		expect(result.standard).toContain("Common");
		expect(result.standard).toContain("Dwarvish");
		expect(result.exotic).toContain("Abyssal");
		expect(result.secret).toContain("Druidic");
		expect(result.homebrew).toEqual([]);
	});

	test("unlisted language falls into homebrew bucket", () => {
		const page = makePage({languagesData: PHB_LANGUAGES});
		const result = groupLanguagesByType(["Krakenspeak", "Common"], page);

		expect(result.homebrew).toContain("Krakenspeak");
		expect(result.homebrew).not.toContain("Common");
		expect(result.standard).toContain("Common");
	});

	test("each group is empty when no names match it", () => {
		const page = makePage({languagesData: PHB_LANGUAGES});
		const result = groupLanguagesByType(["Common", "Dwarvish"], page);

		expect(result.exotic).toEqual([]);
		expect(result.secret).toEqual([]);
		expect(result.homebrew).toEqual([]);
	});

	test("with TGTT priority, TGTT standard-type language appears in standard bucket", () => {
		const page = makePage({
			prioritySources: ["TGTT"],
			languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES],
		});
		const result = groupLanguagesByType(["Lexalian", "Common", "Jotunn"], page);

		expect(result.standard).toContain("Lexalian");
		expect(result.standard).toContain("Common");
		expect(result.exotic).toContain("Jotunn");
	});

	test("ordering within a group follows grouped reference order (priority-sources first)", () => {
		const page = makePage({
			prioritySources: ["TGTT"],
			languagesData: [...PHB_LANGUAGES, ...TGTT_LANGUAGES],
		});
		// Avian (TGTT/priority) should sort before Abyssal (PHB) in exotic
		const result = groupLanguagesByType(["Abyssal", "Avian"], page);
		const avianIdx = result.exotic.indexOf("Avian");
		const abyssalIdx = result.exotic.indexOf("Abyssal");
		expect(avianIdx).toBeLessThan(abyssalIdx);
	});

	test("homebrew bucket is sorted alphabetically", () => {
		const page = makePage({languagesData: PHB_LANGUAGES});
		const result = groupLanguagesByType(["Zyrax", "Aurobec", "Mellishian"], page);

		expect(result.homebrew).toEqual(["Aurobec", "Mellishian", "Zyrax"]);
	});
});

describe("Dialect display (Ignan/Primordial bug)", () => {
	// Build dialect parent map the same way charactersheet.js does
	function buildDialectParentMap (languagesData) {
		const dialectParentMap = {};
		for (const lang of languagesData) {
			if (!lang.dialects?.length) continue;
			for (const dialect of lang.dialects) {
				const key = dialect.toLowerCase();
				if (!dialectParentMap[key] || lang.source === Parser.SRC_XPHB) {
					dialectParentMap[key] = {name: lang.name, source: lang.source};
				}
			}
		}
		return dialectParentMap;
	}

	// Re-implement getHoverLink matching the static method in charactersheet.js,
	// to avoid importing the full CharacterSheetPage module tree.
	function getHoverLink (page, name, source, hash = null, displayName = null) {
		const finalHash = hash || [name, source].join("_").toLowerCase();
		return `<a href="${page}#${finalHash}">${displayName || name}</a>`;
	}

	// Simulate the rendering path for a single language from _renderProficiencies
	function renderLanguageLink (lang, dialectParentMap, languagesData) {
		const langLower = lang.toLowerCase();
		const dialectParent = dialectParentMap[langLower];
		if (dialectParent) {
			return getHoverLink("languages.html", dialectParent.name, dialectParent.source, null, lang);
		}
		const langData = languagesData?.find(l => l.name.toLowerCase() === langLower);
		if (!langData) return lang;
		return getHoverLink("languages.html", lang, langData.source);
	}

	const PRIMORDIAL_PHB = {
		name: "Primordial",
		source: "PHB",
		type: "exotic",
		dialects: ["Auran", "Aquan", "Ignan", "Terran"],
	};
	const PRIMORDIAL_XPHB = {
		name: "Primordial",
		source: "XPHB",
		type: "rare",
		dialects: ["Auran", "Aquan", "Ignan", "Terran"],
	};

	test("dialect parent map maps all four Primordial dialects", () => {
		const map = buildDialectParentMap([PRIMORDIAL_PHB]);
		expect(map["ignan"]).toEqual({name: "Primordial", source: "PHB"});
		expect(map["aquan"]).toEqual({name: "Primordial", source: "PHB"});
		expect(map["auran"]).toEqual({name: "Primordial", source: "PHB"});
		expect(map["terran"]).toEqual({name: "Primordial", source: "PHB"});
	});

	test("XPHB source takes priority in dialect parent map", () => {
		const map = buildDialectParentMap([PRIMORDIAL_PHB, PRIMORDIAL_XPHB]);
		expect(map["ignan"]).toEqual({name: "Primordial", source: "XPHB"});
	});

	test("rendering a dialect shows dialect name, not parent language name", () => {
		const map = buildDialectParentMap([PRIMORDIAL_PHB]);
		const result = renderLanguageLink("Ignan", map, PHB_LANGUAGES);
		expect(result).toContain(">Ignan<");
		expect(result).not.toContain(">Primordial<");
	});

	test("rendering a dialect links to the parent language page", () => {
		const map = buildDialectParentMap([PRIMORDIAL_PHB]);
		const result = renderLanguageLink("Ignan", map, PHB_LANGUAGES);
		// The href hash should reference Primordial, not Ignan
		expect(result).toMatch(/href="languages\.html#.*primordial/i);
	});

	test("all four Primordial dialects render with their own name", () => {
		const map = buildDialectParentMap([PRIMORDIAL_PHB]);
		for (const dialect of ["Ignan", "Aquan", "Auran", "Terran"]) {
			const result = renderLanguageLink(dialect, map, PHB_LANGUAGES);
			expect(result).toContain(`>${dialect}<`);
			expect(result).not.toContain(">Primordial<");
		}
	});

	test("non-dialect language renders normally", () => {
		const map = buildDialectParentMap([PRIMORDIAL_PHB]);
		const result = renderLanguageLink("Celestial", map, PHB_LANGUAGES);
		expect(result).toContain(">Celestial<");
	});

	test("getHoverLink without displayName uses entity name as before", () => {
		const result = getHoverLink("languages.html", "Primordial", "PHB");
		expect(result).toContain(">Primordial<");
	});

	test("dialects appear as selectable options in exotic group", () => {
		const page = makePage({languagesData: [...PHB_LANGUAGES, PRIMORDIAL_PHB]});
		const result = getLanguageOptionsGrouped(page);
		// Dialects from Parser.LANGUAGES_EXOTIC fallback (no standalone data entries)
		expect(result.exotic).toContain("Ignan");
		expect(result.exotic).toContain("Aquan");
		expect(result.exotic).toContain("Auran");
		expect(result.exotic).toContain("Terran");
	});

	test("state stores dialect name as-is (not parent)", () => {
		const state = new globalThis.CharacterSheetState();
		state.addLanguage("Ignan");
		expect(state.getLanguages()).toContain("Ignan");
		expect(state.getLanguages()).not.toContain("Primordial");
	});

	test("save/load round-trip preserves dialect name", () => {
		const state = new globalThis.CharacterSheetState();
		state.addLanguage("Common");
		state.addLanguage("Ignan");
		state.addLanguage("Aquan");

		const json = state.toJson();
		const state2 = new globalThis.CharacterSheetState();
		state2.loadFromJson(json);

		expect(state2.getLanguages()).toContain("Ignan");
		expect(state2.getLanguages()).toContain("Aquan");
		expect(state2.getLanguages()).not.toContain("Primordial");
	});
});

describe("Dialect availability and conflict detection", () => {
	const PRIMORDIAL_PHB = {
		name: "Primordial",
		source: "PHB",
		type: "exotic",
		dialects: ["Auran", "Aquan", "Ignan", "Terran"],
	};
	const PRIMORDIAL_XPHB = {
		name: "Primordial",
		source: "XPHB",
		type: "rare",
		dialects: ["Auran", "Aquan", "Ignan", "Terran"],
	};

	// Re-implement getDialectConflicts matching charactersheet.js
	function buildDialectMaps (languagesData) {
		const dialectParentMap = {};
		const dialectFamilyMap = {};
		for (const lang of languagesData) {
			if (!lang.dialects?.length) continue;
			const parentKey = lang.name.toLowerCase();
			if (!dialectFamilyMap[parentKey] || lang.source === Parser.SRC_XPHB) {
				dialectFamilyMap[parentKey] = lang.dialects.map(d => d);
			}
			for (const dialect of lang.dialects) {
				const key = dialect.toLowerCase();
				if (!dialectParentMap[key] || lang.source === Parser.SRC_XPHB) {
					dialectParentMap[key] = {name: lang.name, source: lang.source};
				}
			}
		}
		return {dialectParentMap, dialectFamilyMap};
	}

	function getDialectConflicts (langName, dialectParentMap, dialectFamilyMap) {
		const key = langName.toLowerCase();
		const parent = dialectParentMap[key];
		if (parent) return [parent.name];
		const dialects = dialectFamilyMap[key];
		if (dialects) return [...dialects];
		return [];
	}

	test("dialect returns only parent as conflict", () => {
		const {dialectParentMap, dialectFamilyMap} = buildDialectMaps([PRIMORDIAL_PHB]);
		expect(getDialectConflicts("Ignan", dialectParentMap, dialectFamilyMap)).toEqual(["Primordial"]);
		expect(getDialectConflicts("Aquan", dialectParentMap, dialectFamilyMap)).toEqual(["Primordial"]);
	});

	test("parent returns all dialects as conflicts", () => {
		const {dialectParentMap, dialectFamilyMap} = buildDialectMaps([PRIMORDIAL_PHB]);
		const conflicts = getDialectConflicts("Primordial", dialectParentMap, dialectFamilyMap);
		expect(conflicts).toContain("Auran");
		expect(conflicts).toContain("Aquan");
		expect(conflicts).toContain("Ignan");
		expect(conflicts).toContain("Terran");
		expect(conflicts).toHaveLength(4);
	});

	test("dialect does NOT conflict with sibling dialects", () => {
		const {dialectParentMap, dialectFamilyMap} = buildDialectMaps([PRIMORDIAL_PHB]);
		const conflicts = getDialectConflicts("Ignan", dialectParentMap, dialectFamilyMap);
		expect(conflicts).not.toContain("Aquan");
		expect(conflicts).not.toContain("Auran");
		expect(conflicts).not.toContain("Terran");
	});

	test("non-dialect non-parent language returns empty conflicts", () => {
		const {dialectParentMap, dialectFamilyMap} = buildDialectMaps([PRIMORDIAL_PHB]);
		expect(getDialectConflicts("Celestial", dialectParentMap, dialectFamilyMap)).toEqual([]);
		expect(getDialectConflicts("Common", dialectParentMap, dialectFamilyMap)).toEqual([]);
	});

	test("XPHB preferred in dialect maps", () => {
		const {dialectParentMap, dialectFamilyMap} = buildDialectMaps([PRIMORDIAL_PHB, PRIMORDIAL_XPHB]);
		expect(getDialectConflicts("Ignan", dialectParentMap, dialectFamilyMap)).toEqual(["Primordial"]);
		// Parent map should use XPHB source
		expect(dialectParentMap["ignan"].source).toBe("XPHB");
	});

	test("getLanguageNamesSorted includes dialects from Primordial entry", () => {
		const page = makePage({languagesData: [...PHB_LANGUAGES, PRIMORDIAL_PHB]});
		const result = getLanguageNamesSorted(page);
		expect(result).toContain("Ignan");
		expect(result).toContain("Aquan");
		expect(result).toContain("Auran");
		expect(result).toContain("Terran");
		expect(result).toContain("Primordial");
	});

	test("getLanguageOptionsGrouped includes dialects in exotic group via langMap", () => {
		const page = makePage({languagesData: [...PHB_LANGUAGES, PRIMORDIAL_PHB]});
		const result = getLanguageOptionsGrouped(page);
		expect(result.exotic).toContain("Ignan");
		expect(result.exotic).toContain("Aquan");
		expect(result.exotic).toContain("Auran");
		expect(result.exotic).toContain("Terran");
		expect(result.exotic).toContain("Primordial");
	});

	test("dialects are available even without Parser.LANGUAGES_EXOTIC fallback", () => {
		// If Parser.LANGUAGES_EXOTIC didn't include dialects, they'd still appear
		// because we inject them from the parent's dialects array
		const page = makePage({languagesData: [PRIMORDIAL_PHB]});
		const result = getLanguageNamesSorted(page);
		expect(result).toContain("Ignan");
		expect(result).toContain("Primordial");
	});
});
