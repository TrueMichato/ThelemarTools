import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/utils-config.js";
import "../../js/render.js";
import "../../js/render-markdown.js";

// The NPC exporter writes action economy as `{@sup {@tip B|Bonus Action}}` — a raised
// glyph that names itself on hover. Markdown has neither superscript nor hover, so
// without a case of its own the mark falls through to `Renderer.stripTags` and degrades
// to a mute "B". These tests pin the recovery: markdown prints the fact the mark stands
// for, and every other `{@sup ...}` in `data/` (footnote markers) is left alone.
describe("RendererMarkdown — @sup", () => {
	// Markdown preserves the casing the tag was written with; the exporter always
	// writes a spell's display name, so real output reads "*Misty Step*".
	const md = str => RendererMarkdown.get().render({type: "entries", entries: [str]}).trim();

	it("prints the hover title for an action-economy mark", () => {
		expect(md("{@spell misty step|XPHB}{@sup {@tip B|Bonus Action}}")).toBe("*misty step* (Bonus Action)");
		expect(md("{@spell shield|XPHB}{@sup {@tip R|Reaction}}")).toBe("*shield* (Reaction)");
		expect(md("{@spell fireball|XPHB}{@sup {@tip A|Action}}")).toBe("*fireball* (Action)");
	});

	it("prints a long casting time in full rather than as a glyph", () => {
		expect(md("{@spell ceremony|XPHB}{@sup {@tip 1hr|Takes 1 Hour}}")).toBe("*ceremony* (Takes 1 Hour)");
		expect(md("{@spell scrying|XPHB}{@sup {@tip 10min|Takes 10 Minutes}}")).toBe("*scrying* (Takes 10 Minutes)");
	});

	it("keeps the mark ahead of a provenance parenthetical", () => {
		expect(md("{@spell misty step|XPHB}{@sup {@tip B|Bonus Action}} ({@feat Fey Touched|TCE})"))
			.toBe("*misty step* (Bonus Action) (Fey Touched)");
	});

	it("leaves a non-tip superscript rendering as before", () => {
		// The three `{@sup}` uses in `data/` all wrap a footnote, not a tip.
		expect(md("Text{@sup 1}")).toBe("Text1");
		expect(md("Text{@sup {@b 2}}")).toBe("Text**2**");
	});
});
