import "./setup.js";
import "../../../js/charactersheet/charactersheet-class-utils.js";

const CharacterSheetClassUtils = globalThis.CharacterSheetClassUtils;

describe("Companion Icon Utilities", () => {
	// ===================================================================
	// getCreatureEmoji — centralized emoji resolution
	// ===================================================================
	describe("getCreatureEmoji", () => {
		test("exact name match returns correct emoji", () => {
			expect(CharacterSheetClassUtils.getCreatureEmoji("Cat")).toBe("🐱");
			expect(CharacterSheetClassUtils.getCreatureEmoji("Owl")).toBe("🦉");
			expect(CharacterSheetClassUtils.getCreatureEmoji("Bat")).toBe("🦇");
			expect(CharacterSheetClassUtils.getCreatureEmoji("Wolf")).toBe("🐺");
		});

		test("includes-match handles compound names", () => {
			expect(CharacterSheetClassUtils.getCreatureEmoji("Giant Bat")).toBe("🦇");
			expect(CharacterSheetClassUtils.getCreatureEmoji("Dire Wolf")).toBe("🐺");
			expect(CharacterSheetClassUtils.getCreatureEmoji("Giant Spider")).toBe("🕷️");
			expect(CharacterSheetClassUtils.getCreatureEmoji("Giant Frog")).toBe("🐸");
		});

		test("hawk and eagle both resolve (not same as default)", () => {
			expect(CharacterSheetClassUtils.getCreatureEmoji("Hawk")).toBe("🦅");
			expect(CharacterSheetClassUtils.getCreatureEmoji("Eagle")).toBe("🦅");
		});

		test("raven has distinct emoji", () => {
			expect(CharacterSheetClassUtils.getCreatureEmoji("Raven")).toBe("🐦‍⬛");
		});

		test("type fallback for unknown beast", () => {
			expect(CharacterSheetClassUtils.getCreatureEmoji("Badger", "beast")).toBe("🐾");
		});

		test("type fallback for fey", () => {
			expect(CharacterSheetClassUtils.getCreatureEmoji("Quickling", "fey")).toBe("🧚");
		});

		test("type fallback for elemental", () => {
			expect(CharacterSheetClassUtils.getCreatureEmoji("Magmin", "elemental")).toBe("✨");
		});

		test("type as object with .type property", () => {
			expect(CharacterSheetClassUtils.getCreatureEmoji("Badger", {type: "beast"})).toBe("🐾");
		});

		test("unknown name and type returns default paw", () => {
			expect(CharacterSheetClassUtils.getCreatureEmoji("Aboleth", "aberration")).toBe("🐾");
		});

		test("case-insensitive matching", () => {
			expect(CharacterSheetClassUtils.getCreatureEmoji("OWL")).toBe("🦉");
			expect(CharacterSheetClassUtils.getCreatureEmoji("giant bat")).toBe("🦇");
		});

		test("null/empty name returns default", () => {
			expect(CharacterSheetClassUtils.getCreatureEmoji("")).toBe("🐾");
			expect(CharacterSheetClassUtils.getCreatureEmoji(null)).toBe("🐾");
		});
	});

	// ===================================================================
	// getCompanionIconHtml — hybrid token image + emoji fallback
	// ===================================================================
	describe("getCompanionIconHtml", () => {
		test("creature with source returns img tag with token URL", () => {
			const html = CharacterSheetClassUtils.getCompanionIconHtml({name: "Cat", source: "MM"});
			expect(html).toContain("<img");
			expect(html).toContain("img/bestiary/tokens/MM/Cat.webp");
			expect(html).toContain("border-radius: 50%");
			expect(html).toContain('alt="Cat"');
		});

		test("creature without source returns emoji span", () => {
			const html = CharacterSheetClassUtils.getCompanionIconHtml({name: "Cat"});
			expect(html).toContain("<span");
			expect(html).toContain("🐱");
			expect(html).not.toContain("<img");
		});

		test("img onerror swaps to emoji fallback", () => {
			const html = CharacterSheetClassUtils.getCompanionIconHtml({name: "Owl", source: "MM"});
			expect(html).toContain("onerror=");
			expect(html).toContain("🦉");
		});

		test("size sm produces smallest dimensions", () => {
			const html = CharacterSheetClassUtils.getCompanionIconHtml({name: "Cat", source: "MM"}, "sm");
			expect(html).toContain("width: 24px");
			expect(html).toContain("height: 24px");
		});

		test("size md produces medium dimensions", () => {
			const html = CharacterSheetClassUtils.getCompanionIconHtml({name: "Cat", source: "MM"}, "md");
			expect(html).toContain("width: 36px");
			expect(html).toContain("height: 36px");
		});

		test("size lg produces largest dimensions", () => {
			const html = CharacterSheetClassUtils.getCompanionIconHtml({name: "Cat", source: "MM"}, "lg");
			expect(html).toContain("width: 48px");
			expect(html).toContain("height: 48px");
		});

		test("default size is md", () => {
			const html = CharacterSheetClassUtils.getCompanionIconHtml({name: "Cat", source: "MM"});
			expect(html).toContain("width: 36px");
		});

		test("compound creature name resolves correct token URL", () => {
			const html = CharacterSheetClassUtils.getCompanionIconHtml({name: "Giant Bat", source: "MM"});
			expect(html).toContain("img/bestiary/tokens/MM/Giant Bat.webp");
		});

		test("includes companion-icon CSS class for styling hooks", () => {
			const html = CharacterSheetClassUtils.getCompanionIconHtml({name: "Cat", source: "MM"}, "lg");
			expect(html).toContain("charsheet__companion-icon");
			expect(html).toContain("charsheet__companion-icon--lg");
		});

		test("emoji fallback span also includes CSS class", () => {
			const html = CharacterSheetClassUtils.getCompanionIconHtml({name: "Cat"}, "sm");
			expect(html).toContain("charsheet__companion-icon");
			expect(html).toContain("charsheet__companion-icon--sm");
		});

		test("special characters in name are escaped in alt attribute", () => {
			const html = CharacterSheetClassUtils.getCompanionIconHtml({name: 'Test "Creature"', source: "MM"});
			expect(html).toContain('alt="Test &quot;Creature&quot;"');
		});
	});
});
