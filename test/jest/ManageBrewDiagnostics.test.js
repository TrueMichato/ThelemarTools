import "../../js/parser.js";
import "../../js/utils.js";
import {ManageBrewDiagnosticsUtil} from "../../js/utils-brew/utils-brew-ui-manage-diagnostics.js";
import {jest} from "@jest/globals";

describe("ManageBrew diagnostics UI state", () => {
	let warnSpy;

	const getRecord = ({severity = "warning", ownerName = "Homebrew Armor"} = {}) => ({
		code: BrewDiagnostics.CODES.ITEM_MISSING_TYPE,
		severity,
		target: {kind: "itemType", uid: "armor"},
		origin: "brew",
		documentId: "doc-1",
		filename: "armor.json",
		url: "https://example.com/armor.json",
		owner: {prop: "item", name: ownerName, source: "HB"},
		fieldPath: "type",
		detail: `Item type "armor" not found!`,
	});

	beforeEach(() => {
		BrewDiagnostics.clear();
		warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => warnSpy.mockRestore());

	it("builds the toolbar badge model from current records and clears it after records are marked seen", () => {
		const seenKeys = new Set();
		BrewDiagnostics.report(getRecord({severity: "error"}));

		expect(ManageBrewDiagnosticsUtil.getLaunchButtonMeta({
			records: BrewDiagnostics.getRecords(),
			seenKeys,
		})).toEqual({
			count: 1,
			hasError: true,
			ariaLabel: "Check for homebrew issues; 1 unseen issue",
			badgeText: "1",
			badgeTone: "error",
		});

		ManageBrewDiagnosticsUtil.markSeen({
			records: BrewDiagnostics.getRecords(),
			seenKeys,
		});
		expect(ManageBrewDiagnosticsUtil.getLaunchButtonMeta({
			records: BrewDiagnostics.getRecords(),
			seenKeys,
		})).toEqual({
			count: 0,
			hasError: false,
			ariaLabel: "Check for homebrew issues; no unseen issues",
			badgeText: "",
			badgeTone: null,
		});
	});

	it("subscribes to live snapshots and unsubscribes without leaking updates", () => {
		const listener = jest.fn();
		const unsubscribe = ManageBrewDiagnosticsUtil.subscribe(listener);

		BrewDiagnostics.report(getRecord());
		unsubscribe();
		BrewDiagnostics.report(getRecord({ownerName: "Other Armor"}));

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith(expect.objectContaining({
			event: expect.objectContaining({type: "report"}),
			records: [expect.objectContaining({owner: expect.objectContaining({name: "Homebrew Armor"})})],
		}));
	});

	it("reacts to clear with an empty live view", () => {
		const snapshots = [];
		const unsubscribe = ManageBrewDiagnosticsUtil.subscribe(({event, records}) => snapshots.push({
			type: event.type,
			model: ManageBrewDiagnosticsUtil.getViewModel(records, {}),
		}));

		BrewDiagnostics.report(getRecord());
		BrewDiagnostics.clear();
		unsubscribe();

		expect(snapshots).toHaveLength(2);
		expect(snapshots[0]).toEqual(expect.objectContaining({type: "report", model: expect.objectContaining({isEmpty: false})}));
		expect(snapshots[1]).toEqual(expect.objectContaining({type: "clear", model: expect.objectContaining({isEmpty: true})}));
	});
});
