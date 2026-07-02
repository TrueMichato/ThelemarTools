/**
 * S2 Bug #4 — Weapon masteries are hoverable in the combat tab.
 *
 * Weapon-mastery properties (Sap / Cleave / Vex / …) must be real 5etools hover
 * targets on the `itemMastery` faux-page, not static `title` badges. Both combat
 * display sites are covered:
 *   - charactersheet-combat.js `_renderAttackItem` (the "⚔ …" span per attack row),
 *     via `_getMasteryHoverAttrs` / `_formatMasteryLink`.
 *   - charactersheet.js `_renderWeaponMasteries` (the masteries badge group),
 *     via `_getMasteryHoverAttrs` / `_getMasterySource`.
 *
 * The helpers fall back to a plain `title` when the hover subsystem is absent so
 * rendering never breaks.
 */

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-combat.js";

const CharacterSheetCombat = globalThis.CharacterSheetCombat;

// The shared setup.js mocks Renderer WITHOUT `.hover`, and UrlUtil without
// `encodeForHash`; there is no HASH_LIST_SEP. Install faithful stand-ins so we
// can assert the exact hover attributes the production helper emits, and record
// what page/source/hash it targets.
function installHoverMocks () {
	const calls = [];
	globalThis.HASH_LIST_SEP = "_";
	globalThis.UrlUtil.encodeForHash = (v) => (Array.isArray(v) ? v.join(globalThis.HASH_LIST_SEP) : String(v)).toLowerCase().replace(/\s+/g, "%20");
	globalThis.Renderer.hover = {
		getHoverElementAttributes: ({page, source, hash, isFauxPage}) => {
			calls.push({page, source, hash, isFauxPage});
			return [
				`onmouseover="Renderer.hover.pHandleLinkMouseOver(event, this)"`,
				`data-vet-page="${page}"`,
				`data-vet-source="${source}"`,
				`data-vet-hash="${hash}"`,
				isFauxPage ? `data-vet-is-faux-page="true"` : "",
			].filter(Boolean).join(" ");
		},
	};
	return calls;
}

function removeHoverMocks () {
	delete globalThis.Renderer.hover;
	delete globalThis.UrlUtil.encodeForHash;
	delete globalThis.HASH_LIST_SEP;
}

afterEach(() => removeHoverMocks());

// ===========================================================================
// combat.js — `_getMasteryHoverAttrs` / `_formatMasteryLink` / `_renderAttackItem`
// ===========================================================================
describe("#4 combat.js mastery hover helpers", () => {
	const mkCombat = () => Object.create(CharacterSheetCombat.prototype);

	it("_getMasteryHoverAttrs targets the itemMastery faux-page with source+hash", () => {
		const calls = installHoverMocks();
		const attrs = mkCombat()._getMasteryHoverAttrs("Sap", "XPHB");

		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({page: "itemMastery", source: "XPHB", isFauxPage: true});
		// Hash carries BOTH name and source so the correct itemMastery entry resolves.
		expect(calls[0].hash).toBe("sap_xphb");
		expect(attrs).toContain(`data-vet-page="itemMastery"`);
		expect(attrs).toContain(`data-vet-source="XPHB"`);
		expect(attrs).toContain(`data-vet-is-faux-page="true"`);
		expect(attrs).toContain(`data-vet-hash="sap_xphb"`);
	});

	it("_getMasteryHoverAttrs falls back to a plain title when the hover subsystem is absent", () => {
		removeHoverMocks(); // no Renderer.hover / UrlUtil.encodeForHash
		const attrs = mkCombat()._getMasteryHoverAttrs("Cleave", "XPHB");
		expect(attrs).toBe(`title="Weapon Mastery: Cleave"`);
	});

	it("_formatMasteryLink emits a hoverable span carrying the itemMastery attrs (default source XPHB)", () => {
		const calls = installHoverMocks();
		const html = mkCombat()._formatMasteryLink("Vex"); // no |source → default XPHB

		expect(calls[0]).toMatchObject({page: "itemMastery", source: "XPHB"});
		expect(html).toContain("charsheet__mastery-link");
		expect(html).toContain(`data-vet-page="itemMastery"`);
		expect(html).toContain(">Vex</span>");
	});

	it("_formatMasteryLink honours an explicit source and title-cases the name", () => {
		const calls = installHoverMocks();
		const html = mkCombat()._formatMasteryLink("sap|HB");
		expect(calls[0]).toMatchObject({source: "HB"});
		expect(calls[0].hash).toBe("sap_hb");
		expect(html).toContain(">Sap</span>");
	});

	it("_formatMasteryLink handles object-shaped mastery entries ({uid})", () => {
		const calls = installHoverMocks();
		const html = mkCombat()._formatMasteryLink({uid: "Vex|XPHB", note: "brew"});
		expect(calls[0]).toMatchObject({page: "itemMastery", source: "XPHB"});
		expect(calls[0].hash).toBe("vex_xphb");
		expect(html).toContain(">Vex</span>");
		expect(html).not.toContain("[object Object]");
	});

	it("_renderAttackItem wires the itemMastery hover onto the ⚔ mastery span", () => {
		installHoverMocks();
		const combat = mkCombat();
		combat._state = {
			getWeaponAbilityMod: () => 3,
			getProficiencyBonus: () => 2,
			getAttackModifierContributions: () => [],
			getCriticalRange: () => 20,
			getActiveCombatMethodEffects: () => [],
			getClassLevel: () => 0,
			isStateTypeActive: () => false,
			getAttackNote: () => null,
		};
		combat._getAttackRollKind = () => ({isMelee: true});
		combat._formatProperty = () => "";
		combat._buildAttackRangeDisplay = () => ({rangeHtml: ""});
		combat._renderAmmoSelector = () => "";
		combat._renderChannelSpellButton = () => "";

		const html = combat._renderAttackItem({
			id: "w1", name: "Longsword", damage: "1d8", damageType: "slashing", mastery: ["Sap|XPHB"],
		}).outerHTML;

		expect(html).toContain("charsheet__attack-mastery");
		expect(html).toContain("charsheet__mastery-link");
		expect(html).toContain(`data-vet-page="itemMastery"`);
		expect(html).toContain(">Sap</span>");
	});
});

// ===========================================================================
// charactersheet.js — `_getMasterySource` / `_getMasteryHoverAttrs` / `_renderWeaponMasteries`
// ===========================================================================
describe("#4 charactersheet.js mastery hover helpers", () => {
	let CharacterSheetPage;

	beforeAll(async () => {
		globalThis.window = globalThis.window || {
			addEventListener: () => {},
			dispatchEvent: () => {},
			location: {search: ""},
			matchMedia: () => ({matches: false, addEventListener: () => {}}),
		};
		globalThis.document = globalThis.document || {
			querySelector: () => null,
			querySelectorAll: () => [],
			getElementById: () => null,
			addEventListener: () => {},
			body: {classList: {add () {}, remove () {}}},
		};
		await import("../../../js/charactersheet/charactersheet.js");
		CharacterSheetPage = globalThis.CharacterSheetPage;
	});

	const mkPage = () => Object.create(CharacterSheetPage.prototype);

	it("_getMasterySource parses the source, defaulting to XPHB", () => {
		const page = mkPage();
		expect(page._getMasterySource("Sap|HB")).toBe("HB");
		expect(page._getMasterySource("Sap")).toBe("XPHB");
		expect(page._getMasterySource({uid: "Vex|PHB"})).toBe("PHB");
		expect(page._getMasterySource(null)).toBe("XPHB");
	});

	it("_getMasteryHoverAttrs targets the itemMastery faux-page (and falls back to a title)", () => {
		const calls = installHoverMocks();
		const attrs = mkPage()._getMasteryHoverAttrs("Topple", "XPHB");
		expect(calls[0]).toMatchObject({page: "itemMastery", source: "XPHB", isFauxPage: true});
		expect(attrs).toContain(`data-vet-page="itemMastery"`);

		removeHoverMocks();
		expect(mkPage()._getMasteryHoverAttrs("Topple", "XPHB")).toBe(`title="Weapon Mastery: Topple"`);
	});

	it("_renderWeaponMasteries renders a hoverable itemMastery span for each mastery weapon", () => {
		installHoverMocks();

		// Fake DOM: group + container elements returned by getElementById.
		const group = e_({outer: "<div></div>"});
		const container = e_({outer: "<div></div>"});
		const prevDoc = globalThis.document;
		globalThis.document = {
			...prevDoc,
			getElementById: (id) => (id === "charsheet-masteries-group" ? group : id === "charsheet-combat-masteries" ? container : null),
		};

		const page = mkPage();
		page._state = {getWeaponMasteries: () => ["Longsword|XPHB"]};
		page._getMaxWeaponMasteries = () => 2;
		page._itemsData = [{
			name: "Longsword", source: "XPHB", _isBaseItem: true, mastery: ["Sap|XPHB"],
		}];

		page._renderWeaponMasteries();
		globalThis.document = prevDoc;

		const html = container.innerHTML;
		expect(html).toContain("charsheet__mastery-badge");
		expect(html).toContain("charsheet__mastery-link");
		expect(html).toContain(`data-vet-page="itemMastery"`);
		expect(html).toContain("Sap");
	});
});
