import "../../js/parser.js";
import "../../js/utils.js";
import {ManageBrewDiagnosticsUtil} from "../../js/utils-brew/utils-brew-ui-manage-diagnostics.js";

describe("ManageBrewDiagnosticsUtil", () => {
	const getRecord = ({
		code = BrewDiagnostics.CODES.ITEM_MISSING_TYPE,
		severity = "warning",
		filename = "zeta.json",
		documentId = "doc-zeta",
		ownerName = "Zeta Armor",
		targetUid = "armor",
		fieldPath = "type",
		detail = `Item type "armor" not found!`,
	} = {}) => ({
		code,
		severity,
		target: {kind: "itemType", uid: targetUid, page: null, source: "HB", hash: null},
		origin: "brew",
		documentId,
		filename,
		url: `https://example.com/${filename}`,
		owner: {prop: "item", name: ownerName, source: "HB"},
		fieldPath,
		detail,
	});

	it("groups by the preferred document identity and sorts error groups and rows first", () => {
		const records = [
			getRecord({filename: "alpha.json", documentId: "doc-alpha", ownerName: "Warning Owner"}),
			getRecord({filename: "zeta.json", ownerName: "Zeta Warning"}),
			getRecord({filename: "zeta.json", ownerName: "Alpha Error", severity: "error", code: BrewDiagnostics.CODES.COPY_MISSING_PARENT}),
			{
				...getRecord({filename: null, documentId: "doc-only", ownerName: "Document ID Owner"}),
				url: null,
			},
		];

		const groups = ManageBrewDiagnosticsUtil.getGroups(records);

		expect(groups.map(group => group.label)).toEqual(["zeta.json", "alpha.json", "doc-only"]);
		expect(groups[0]).toEqual(expect.objectContaining({countErrors: 1, countWarnings: 1}));
		expect(groups[0].records.map(record => record.owner.name)).toEqual(["Alpha Error", "Zeta Warning"]);
	});

	it("filters case-insensitively across document, owner, target, code, detail, and severity", () => {
		const records = [
			getRecord({filename: "armor.json", ownerName: "Clockwork Plate", targetUid: "armor"}),
			getRecord({
				filename: "weapons.json",
				ownerName: "Hook Blade",
				targetUid: "ADV_TRIP",
				code: BrewDiagnostics.CODES.ITEM_MISSING_PROPERTY,
				fieldPath: "property[0]",
				detail: "Missing trip property",
			}),
			getRecord({filename: "copy.json", ownerName: "Broken Copy", severity: "error", code: BrewDiagnostics.CODES.COPY_MISSING_PARENT}),
		];

		expect(ManageBrewDiagnosticsUtil.getFilteredRecords(records, {search: "clockWORK"})).toHaveLength(1);
		expect(ManageBrewDiagnosticsUtil.getFilteredRecords(records, {search: "adv_trip"})).toHaveLength(1);
		expect(ManageBrewDiagnosticsUtil.getFilteredRecords(records, {search: "missing trip"})).toHaveLength(1);
		expect(ManageBrewDiagnosticsUtil.getFilteredRecords(records, {severity: "error"}).map(record => record.owner.name)).toEqual(["Broken Copy"]);
		expect(ManageBrewDiagnosticsUtil.getFilteredRecords(records, {search: "weapons", severity: "error"})).toHaveLength(0);
	});

	it("marks the current records seen and re-raises the unseen count for later records", () => {
		const seenKeys = new Set();
		const records = [getRecord()];

		expect(ManageBrewDiagnosticsUtil.getUnseenMeta({records, seenKeys})).toEqual({count: 1, hasError: false});

		ManageBrewDiagnosticsUtil.markSeen({records, seenKeys});
		expect(ManageBrewDiagnosticsUtil.getUnseenMeta({records, seenKeys})).toEqual({count: 0, hasError: false});

		const recordsWithNewError = [
			...records,
			getRecord({ownerName: "Later Error", severity: "error", code: BrewDiagnostics.CODES.REFERENCE_MISSING}),
		];
		expect(ManageBrewDiagnosticsUtil.getUnseenMeta({records: recordsWithNewError, seenKeys})).toEqual({count: 1, hasError: true});
	});

	it("distinguishes empty, filtered-empty, and populated models", () => {
		expect(ManageBrewDiagnosticsUtil.getViewModel([], {})).toEqual(expect.objectContaining({
			isEmpty: true,
			isFilteredEmpty: false,
			recordsVisible: [],
			groups: [],
		}));

		expect(ManageBrewDiagnosticsUtil.getViewModel([getRecord()], {search: "no match"})).toEqual(expect.objectContaining({
			isEmpty: false,
			isFilteredEmpty: true,
			recordsVisible: [],
		}));

		expect(ManageBrewDiagnosticsUtil.getViewModel([getRecord()], {})).toEqual(expect.objectContaining({
			isEmpty: false,
			isFilteredEmpty: false,
			countDocuments: 1,
		}));
	});

	it("uses the collector's copyable-report formatter for the visible records verbatim", () => {
		const records = [
			getRecord({filename: "zeta-visible.json", ownerName: "Warning Item"}),
			getRecord({filename: "alpha-visible.json", ownerName: "Error Item", severity: "error", code: BrewDiagnostics.CODES.COPY_MISSING_PARENT}),
			getRecord({filename: "hidden.json", ownerName: "Hidden Item"}),
		];
		const model = ManageBrewDiagnosticsUtil.getViewModel(records, {search: "visible"});
		const visibleSorted = model.groups.flatMap(group => group.records);

		expect(visibleSorted.map(record => record.owner.name)).toEqual(["Error Item", "Warning Item"]);
		expect(ManageBrewDiagnosticsUtil.getCopyableReport(visibleSorted)).toBe(BrewDiagnostics.getCopyableReport(visibleSorted));
	});
});
