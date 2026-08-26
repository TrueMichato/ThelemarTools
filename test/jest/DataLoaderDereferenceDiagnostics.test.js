import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/utils-dataloader.js";
import {DataLoaderDereferencerFacade} from "../../js/utils-dataloader/utils-dataloader-dereferencing.js";
import {DataLoaderInternalUtil} from "../../js/utils-dataloader/utils-dataloader-internal-util.js";
import {jest} from "@jest/globals";

describe("DataLoader dereference diagnostics", () => {
	let timeoutSpy;
	let toastSpy;
	let warnSpy;

	beforeEach(() => {
		BrewDiagnostics.setStrictModeForTests(false);
		BrewDiagnostics.clear();
		DataLoaderInternalUtil._NOTIFIED_FAILED_DEREFERENCES = new Set();
		timeoutSpy = jest.spyOn(globalThis, "setTimeout").mockImplementation(() => 0);
		toastSpy = jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
		warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		BrewDiagnostics.setStrictModeForTests(false);
		timeoutSpy.mockRestore();
		toastSpy.mockRestore();
		warnSpy.mockRestore();
	});

	const getOrphanFeat = () => ({
		name: "Orphan Feat",
		source: "HB",
		_copy: {
			name: "Missing Parent",
			source: "HB-PARENT",
		},
		__diagnostic: {
			origin: "brew",
			documentId: "doc-copy",
			filename: "orphan.json",
			url: "https://example.com/orphan.json",
			prop: "feat",
		},
	});

	it("records a missing _copy parent with owner and provenance", async () => {
		const orphan = getOrphanFeat();

		await expect(DataUtil.feat.pMergeCopy([orphan], orphan, {isErrorOnMissing: false})).resolves.toBeUndefined();

		expect(BrewDiagnostics.getRecords()).toEqual([
			expect.objectContaining({
				code: BrewDiagnostics.CODES.COPY_MISSING_PARENT,
				origin: "brew",
				documentId: "doc-copy",
				owner: {prop: "feat", name: "Orphan Feat", source: "HB"},
				fieldPath: "_copy",
				target: expect.objectContaining({
					kind: UrlUtil.PG_FEATS,
					uid: "Missing Parent|HB-PARENT",
					source: "HB-PARENT",
				}),
			}),
		]);
	});

	it("records missing classFeature and subclassFeature references with exact owner fields", async () => {
		const owner = {
			name: "Broken Feature",
			source: "HB",
			className: "Fighter",
			classSource: "PHB",
			level: 3,
			entries: [
				{type: "refClassFeature", classFeature: "Missing Class Feature|Fighter|PHB|1"},
				{
					type: "entries",
					entries: [
						{type: "refSubclassFeature", subclassFeature: "Missing Subclass Feature|Fighter|PHB|Champion|PHB|3"},
					],
				},
			],
			__diagnostic: {
				origin: "brew",
				documentId: "doc-ref",
				filename: "features.json",
				prop: "classFeature",
			},
		};

		await DataLoaderDereferencerFacade.pGetDereferenced([owner], "classFeature");

		expect(BrewDiagnostics.getRecords()).toEqual([
			expect.objectContaining({
				code: BrewDiagnostics.CODES.REFERENCE_MISSING,
				owner: {prop: "classFeature", name: "Broken Feature", source: "HB"},
				fieldPath: "entries[0].classFeature",
				target: expect.objectContaining({
					kind: "classFeature",
					uid: "Missing Class Feature|Fighter|PHB|1",
				}),
			}),
			expect.objectContaining({
				code: BrewDiagnostics.CODES.REFERENCE_MISSING,
				owner: {prop: "classFeature", name: "Broken Feature", source: "HB"},
				fieldPath: "entries[1].entries[0].subclassFeature",
				target: expect.objectContaining({
					kind: "subclassFeature",
					uid: "Missing Subclass Feature|Fighter|PHB|Champion|PHB|3",
				}),
			}),
		]);
		expect(toastSpy).toHaveBeenCalledTimes(1);
		expect(timeoutSpy).toHaveBeenCalledTimes(1);
	});

	it("records a failed string reference without adding legacy toast or deferred-throw behavior", async () => {
		const owner = {
			name: "Broken String Feature",
			source: "HB",
			className: "Fighter",
			classSource: "PHB",
			level: 3,
			entries: [
				"{#classFeature Missing String Feature|Fighter|PHB|1}",
			],
			__diagnostic: {
				origin: "brew",
				documentId: "doc-string-ref",
				filename: "string-features.json",
				prop: "classFeature",
			},
		};

		await DataLoaderDereferencerFacade.pGetDereferenced([owner], "classFeature");

		expect(BrewDiagnostics.getRecords()).toEqual([
			expect.objectContaining({
				code: BrewDiagnostics.CODES.REFERENCE_MISSING,
				owner: {prop: "classFeature", name: "Broken String Feature", source: "HB"},
				fieldPath: "entries[0]",
				target: expect.objectContaining({
					kind: "classFeature",
					uid: "Missing String Feature|Fighter|PHB|1",
				}),
			}),
		]);
		expect(toastSpy).not.toHaveBeenCalled();
		expect(timeoutSpy).not.toHaveBeenCalled();
		expect(DataLoaderInternalUtil._NOTIFIED_FAILED_DEREFERENCES).toEqual(new Set());
	});

	it("preserves the strict missing-parent merge exception after recording", async () => {
		const orphan = getOrphanFeat();

		await expect(DataUtil.feat.pMergeCopy([orphan], orphan, {isErrorOnMissing: true, isIgnoreMissing: true}))
			.rejects.toThrow(`Could not find "feats.html" entity "Missing Parent" ("HB-PARENT")`);
		expect(BrewDiagnostics.getRecords()).toHaveLength(1);
	});

	it("dedupes repeated failures for the same owner, field, and target", async () => {
		const orphan = getOrphanFeat();

		await DataUtil.feat.pMergeCopy([orphan], orphan, {isErrorOnMissing: false});
		await DataUtil.feat.pMergeCopy([orphan], orphan, {isErrorOnMissing: false});

		expect(BrewDiagnostics.getRecords()).toHaveLength(1);
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});

	it("keeps explicitly ignored missing _copy parents silent", async () => {
		const orphan = getOrphanFeat();

		await expect(DataUtil.feat.pMergeCopy(
			[orphan],
			orphan,
			{isErrorOnMissing: false, isIgnoreMissing: true},
		)).resolves.toBeUndefined();

		expect(BrewDiagnostics.getRecords()).toEqual([]);
		expect(warnSpy).not.toHaveBeenCalled();
	});
});
