import "../../js/parser.js";
import "../../js/utils.js";
import {BrewUtil2Base} from "../../js/utils-brew/utils-brew-base.js";
import {jest} from "@jest/globals";

describe("BrewDiagnostics", () => {
	let warnSpy;

	beforeEach(() => {
		BrewDiagnostics.setStrictModeForTests(false);
		BrewDiagnostics.setConsoleVerbose(false);
		BrewDiagnostics.clear();
		warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		BrewDiagnostics.setStrictModeForTests(false);
		BrewDiagnostics.setConsoleVerbose(false);
		warnSpy.mockRestore();
	});

	const getRecord = (overrides = {}) => ({
		code: BrewDiagnostics.CODES.ITEM_MISSING_TYPE,
		severity: "warning",
		target: {kind: "itemType", uid: "armor"},
		origin: "brew",
		documentId: "doc-1",
		filename: "armor.json",
		url: "https://example.com/armor.json",
		owner: {prop: "item", name: "Homebrew Armor", source: "HB"},
		fieldPath: "type",
		detail: `Item type "armor" not found!`,
		...overrides,
	});

	it("normalizes, stores, stays silent on the console by default, and returns defensive copies of records", () => {
		const out = BrewDiagnostics.report(getRecord());

		expect(out).toEqual(expect.objectContaining({
			...getRecord(),
			target: {
				kind: "itemType",
				uid: "armor",
				page: null,
				source: null,
				hash: null,
			},
		}));
		// Quiet by default: collected in-memory, but never logged to the console.
		expect(warnSpy).not.toHaveBeenCalled();
		expect(BrewDiagnostics.getRecords()).toHaveLength(1);

		out.owner.name = "Mutated";
		expect(BrewDiagnostics.getRecords()[0].owner.name).toBe("Homebrew Armor");
	});

	it("logs to the console only when verbose mode is enabled, deduping repeats", () => {
		BrewDiagnostics.setConsoleVerbose(true);

		BrewDiagnostics.report(getRecord());
		BrewDiagnostics.report(getRecord());

		expect(BrewDiagnostics.getRecords()).toHaveLength(1);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith(
			`[5et:brew-diagnostics] Item type "armor" not found!`,
			expect.objectContaining({
				...getRecord(),
				target: expect.objectContaining({kind: "itemType", uid: "armor"}),
			}),
		);
	});

	it("dedupes repeated renders of the same document, entity, field, and target", () => {
		BrewDiagnostics.report(getRecord());
		BrewDiagnostics.report(getRecord());

		expect(BrewDiagnostics.getRecords()).toHaveLength(1);
	});

	it("retains separate records for separate owners and fields", () => {
		BrewDiagnostics.report(getRecord());
		BrewDiagnostics.report(getRecord({owner: {prop: "item", name: "Other Armor", source: "HB"}}));
		BrewDiagnostics.report(getRecord({fieldPath: "inherits.type"}));

		expect(BrewDiagnostics.getRecords()).toHaveLength(3);
	});

	it("notifies subscribers and supports unsubscribe and clear", () => {
		const subscriber = jest.fn();
		const unsubscribe = BrewDiagnostics.subscribe(subscriber);

		BrewDiagnostics.report(getRecord());
		BrewDiagnostics.clear();
		unsubscribe();
		BrewDiagnostics.report(getRecord({documentId: "doc-2"}));

		expect(subscriber).toHaveBeenCalledTimes(2);
		expect(subscriber).toHaveBeenNthCalledWith(1, expect.objectContaining({type: "report"}));
		expect(subscriber).toHaveBeenNthCalledWith(2, {type: "clear"});
	});

	it("throws through the explicit strict-mode test hook while retaining the record", () => {
		BrewDiagnostics.setStrictModeForTests(true);

		expect(() => BrewDiagnostics.report(getRecord())).toThrow(`[5et:brew-diagnostics] Item type "armor" not found!`);
		expect(BrewDiagnostics.getRecords()).toHaveLength(1);
	});

	it("formats a copyable support report with provenance", () => {
		BrewDiagnostics.report(getRecord());

		expect(BrewDiagnostics.getCopyableReport()).toBe([
			"[5et:brew-diagnostics] 1 issue",
			`1. [WARNING] item.missingType: Item type "armor" not found!`,
			"   Document: armor.json",
			`   Entity: item "Homebrew Armor" (HB)`,
			"   Field: type",
			"   Target: itemType armor",
		].join("\n"));
	});

	it("annotates every entity on a private brew copy before merge", () => {
		const original = {
			head: {
				docIdLocal: "doc-1",
				filename: "armor.json",
				url: "https://example.com/armor.json",
			},
			body: {
				_meta: {sources: [{json: "HB", full: "Homebrew Source"}]},
				item: [{name: "Homebrew Armor", source: "HB"}],
				spell: [{name: "Homebrew Spell", source: "HB"}],
			},
		};
		const cpy = MiscUtil.copyFast(original);
		const brewUtil = new BrewUtil2Base();
		brewUtil.PAGE_MANAGE = UrlUtil.PG_MANAGE_BREW;

		brewUtil._pGetBrewProcessed_mutDiagnostics(cpy);

		expect(original.body.item[0].__diagnostic).toBeUndefined();
		expect(cpy.body.item[0].__diagnostic).toEqual({
			origin: "brew",
			documentId: "doc-1",
			filename: "armor.json",
			url: "https://example.com/armor.json",
			prop: "item",
			source: {json: "HB", full: "Homebrew Source"},
		});
		expect(cpy.body.spell[0].__diagnostic).toEqual(expect.objectContaining({prop: "spell"}));
	});
});
