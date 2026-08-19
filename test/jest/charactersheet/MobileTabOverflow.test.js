/**
 * Mobile tab-bar overflow policy
 *
 * At 390px the ten-tab strip measured a 459px `scrollWidth` inside a 390px
 * container with no scroll affordance, so "Companions", "Builder" and "Respec"
 * were unreachable on a phone and "Companion" clipped mid-word. The fix keeps
 * five play tabs in the bar and moves the rest behind a "More" bottom sheet.
 *
 * The split is a product decision — which tabs a player needs mid-encounter —
 * so it lives in a pure static (`CharacterSheetMobile.partitionTabs`) rather
 * than inside the DOM wiring, and is tested here without a DOM.
 *
 * The load-bearing assertion is the last one: mobile is allowed to *rearrange*
 * the sheet but never to *shrink* it. Every tab must land in exactly one of the
 * two buckets, or a capability silently disappears on phones.
 */

// The module auto-initializes against the DOM at import time. Stub only what
// that guard touches, before importing.
globalThis.document = {
	readyState: "complete",
	querySelector: () => null,
	addEventListener: () => {},
};
globalThis.window = globalThis;
globalThis.navigator = globalThis.navigator || {};

await import("../../../js/charactersheet/charactersheet-mobile.js");

const CharacterSheetMobile = globalThis.CharacterSheetMobile;

/** The full tab strip as authored in charactersheet.html. */
const ALL_TABS = [
	"#charsheet-tab-overview",
	"#charsheet-tab-abilities",
	"#charsheet-tab-combat",
	"#charsheet-tab-spells",
	"#charsheet-tab-inventory",
	"#charsheet-tab-features",
	"#charsheet-tab-powers",
	"#charsheet-tab-notes",
	"#charsheet-tab-companions",
	"#charsheet-tab-builder",
	"#charsheet-tab-respec",
];

describe("Mobile tab overflow policy", () => {
	it("exposes the partition as a pure static", () => {
		expect(typeof CharacterSheetMobile.partitionTabs).toBe("function");
	});

	it("keeps exactly the five play tabs in the bar", () => {
		const {play} = CharacterSheetMobile.partitionTabs(ALL_TABS);
		expect(play).toEqual([
			"#charsheet-tab-overview",
			"#charsheet-tab-combat",
			"#charsheet-tab-spells",
			"#charsheet-tab-inventory",
			"#charsheet-tab-features",
		]);
	});

	it("moves the prep tabs behind More", () => {
		const {overflow} = CharacterSheetMobile.partitionTabs(ALL_TABS);
		expect(overflow).toEqual([
			"#charsheet-tab-abilities",
			"#charsheet-tab-powers",
			"#charsheet-tab-notes",
			"#charsheet-tab-companions",
			"#charsheet-tab-builder",
			"#charsheet-tab-respec",
		]);
	});

	// The bar's five slots are a fixed budget, so a tab that is dead for THIS character
	// is a slot stolen from one that is not. A Talent has no spellcasting at all.
	describe("resolving the play set for the character", () => {
		const asTalent = ({spells = []} = {}) => ({
			isPsionicManifester: () => true,
			getSpells: () => spells,
		});

		it("keeps the standard five for a character with no psionics", () => {
			expect(CharacterSheetMobile.resolvePlayTabs(null)).toContain("#charsheet-tab-spells");
			expect(CharacterSheetMobile.resolvePlayTabs({isPsionicManifester: () => false}))
				.not.toContain("#charsheet-tab-powers");
		});

		it("spends the dead Spells slot on Powers for a manifester who casts nothing", () => {
			const play = CharacterSheetMobile.resolvePlayTabs(asTalent());
			expect(play).toContain("#charsheet-tab-powers");
			expect(play).not.toContain("#charsheet-tab-spells");
			expect(play).toHaveLength(5);
		});

		it("keeps Spells for a manifester who also casts, so neither surface is lost", () => {
			const play = CharacterSheetMobile.resolvePlayTabs(asTalent({spells: [{name: "Shield"}]}));
			expect(play).toContain("#charsheet-tab-spells");
			expect(play).not.toContain("#charsheet-tab-powers");
		});

		it("puts Powers in the bar and Spells behind More for a pure Talent", () => {
			const {play, overflow} = CharacterSheetMobile.partitionTabs(ALL_TABS, {
				playHrefs: CharacterSheetMobile.resolvePlayTabs(asTalent()),
			});
			expect(play).toContain("#charsheet-tab-powers");
			expect(overflow).toContain("#charsheet-tab-spells");
			// The invariant that matters: nothing became unreachable.
			expect([...play, ...overflow].sort()).toEqual([...ALL_TABS].sort());
		});

		it("still accounts for every tab whichever play set is used", () => {
			for (const state of [null, asTalent(), asTalent({spells: [{name: "Shield"}]})]) {
				const {play, overflow} = CharacterSheetMobile.partitionTabs(ALL_TABS, {
					playHrefs: CharacterSheetMobile.resolvePlayTabs(state),
				});
				expect(play).toHaveLength(5);
				expect([...play, ...overflow].sort()).toEqual([...ALL_TABS].sort());
			}
		});
	});

	it("preserves document order within each bucket", () => {
		const reordered = [...ALL_TABS].reverse();
		const {play, overflow} = CharacterSheetMobile.partitionTabs(reordered);
		expect(play).toEqual(reordered.filter(h => play.includes(h)));
		expect(overflow).toEqual(reordered.filter(h => overflow.includes(h)));
	});

	it("leaves the bar untouched when there is nothing to overflow", () => {
		const playOnly = [
			"#charsheet-tab-overview",
			"#charsheet-tab-combat",
		];
		const {play, overflow} = CharacterSheetMobile.partitionTabs(playOnly);
		expect(play).toEqual(playOnly);
		expect(overflow).toEqual([]);
	});

	it("ignores missing hrefs instead of emitting empty entries", () => {
		const {play, overflow} = CharacterSheetMobile.partitionTabs([
			"#charsheet-tab-combat",
			null,
			undefined,
			"",
			"#charsheet-tab-respec",
		]);
		expect(play).toEqual(["#charsheet-tab-combat"]);
		expect(overflow).toEqual(["#charsheet-tab-respec"]);
	});

	it("tolerates a missing tab list", () => {
		expect(CharacterSheetMobile.partitionTabs(undefined)).toEqual({play: [], overflow: []});
	});

	it("never drops a tab — mobile rearranges the sheet, it does not shrink it", () => {
		const {play, overflow} = CharacterSheetMobile.partitionTabs(ALL_TABS);
		expect([...play, ...overflow].sort()).toEqual([...ALL_TABS].sort());
		expect(play.filter(h => overflow.includes(h))).toEqual([]);
	});

	it("routes any future tab to More rather than crowding the play bar", () => {
		const {play, overflow} = CharacterSheetMobile.partitionTabs([...ALL_TABS, "#charsheet-tab-crafting"]);
		expect(play).toHaveLength(5);
		expect(overflow).toContain("#charsheet-tab-crafting");
	});
});
