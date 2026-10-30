import {jest} from "@jest/globals";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import {BrewUtil2Base} from "../../js/utils-brew/utils-brew-base.js";
import {ManageBrewDiagnosticsUtil} from "../../js/utils-brew/utils-brew-ui-manage-diagnostics.js";

let ManageBrewUi;
const document = (id, name = `Source ${id}`) => ({head: {docIdLocal: id, filename: `${id}.json`, url: `https://example.invalid/${id}.json`}, body: {_meta: {sources: [{json: id, full: name}]}}});
const issue = (doc, severity = "warning", origin = "unknown") => ({
	code: "fixture.issue",
	severity,
	origin,
	documentId: doc.head.docIdLocal,
	owner: {prop: "item", name: `Owner ${doc.head.docIdLocal}`, source: doc.body._meta.sources[0].json},
	target: {kind: "item", uid: "fixture|tst"},
	fieldPath: "type",
	detail: `${severity} fixture ${doc.head.docIdLocal}`,
});

describe("production Update All report and reload replay", () => {
	let toast;
	let logs;
	let oldVeE;
	const baseGlobals = {};
	beforeAll(async () => {
		for (const key of ["BaseComponent", "PageFilterBase", "Filter", "ListUiPreviewButtonHandlerBase"]) {
			baseGlobals[key] = globalThis[key];
			globalThis[key] ||= class {};
		}
		ManageBrewUi = (await import("../../js/utils-brew/utils-brew-ui-manage.js")).ManageBrewUi;
	});
	afterAll(() => {
		for (const [key, value] of Object.entries(baseGlobals)) {
			if (value === undefined) delete globalThis[key];
			else globalThis[key] = value;
		}
	});
	beforeEach(() => {
		BrewDiagnostics.clear();
		oldVeE = globalThis.veE;
		globalThis.veE = ({outer}) => ({html: outer});
		toast = jest.spyOn(JqueryUtil, "doToast").mockImplementation(() => {});
		logs = ["info", "warn", "error"].map(key => jest.spyOn(console, key).mockImplementation(() => {}));
	});
	afterEach(() => {
		toast.mockRestore();
		logs.forEach(spy => spy.mockRestore());
		if (oldVeE === undefined) delete globalThis.veE;
		else globalThis.veE = oldVeE;
	});
	const setup = (result, brews) => {
		const brewUtil = new BrewUtil2Base();
		brewUtil.DISPLAY_NAME = "homebrew";
		brewUtil.DISPLAY_NAME_PLURAL = "homebrews";
		brewUtil.PAGE_MANAGE = UrlUtil.PG_MANAGE_BREW;
		brewUtil._isDirty = true;
		brewUtil.pPullAllBrews = jest.fn(async () => result);
		brewUtil.doLocationReload = jest.fn();
		let serialized;
		brewUtil.pSetReloadMessage = jest.fn(async message => { serialized = JSON.stringify(message); });
		brewUtil._storage = {pGet: async () => JSON.parse(serialized), pRemove: jest.fn(async () => {})};
		const ui = new ManageBrewUi({brewUtil});
		ui._pRender_pBrewList = jest.fn(async () => {});
		return {ui, brewUtil, rdState: {brews}, payload: () => JSON.parse(serialized)};
	};
	const consoleText = () => logs.flatMap(spy => spy.mock.calls.map(args => args.join(" "))).join("\n");

	it.each([false, true])("backs up every success and scoped issue through persisted replay (partial=%s)", async partial => {
		const updated = Array.from({length: 60}, (_, ix) => document(`doc-${ix}`, `Source ${ix} ${"UNBROKEN".repeat(40)}`));
		const failed = document("bad", "<Bad & source>");
		const failure = new Error("Download failed", {cause: new Error("Underlying fixture")});
		const {ui, brewUtil, rdState, payload} = setup({brewDocsUpdated: updated, failedBrews: partial ? [{brew: failed, url: failed.head.url, error: failure}] : []}, [...updated, failed]);
		BrewDiagnostics.report(issue(updated[0]));
		BrewDiagnostics.report(issue(updated[59], "error", "brew"));
		BrewDiagnostics.report(issue(document("unrelated")));
		BrewDiagnostics.report({...issue(updated[0], "error", "prerelease"), code: "prerelease.fixture"});
		await ui._pDoPullAll({rdState, isReload: true});
		expect(brewUtil.doLocationReload).toHaveBeenCalledTimes(1);
		expect(toast).not.toHaveBeenCalled();
		const saved = payload();
		expect(saved.updateReport.updated).toHaveLength(60);
		expect(saved.updateReport.diagnostics).toHaveLength(2);
		expect(saved.updateReport.unassociatedDiagnostics).toBe(2);
		expect(saved).toMatchObject({isAutoHide: false, isDismissOnClick: false, type: "warning"});
		const first = consoleText();
		expect(first).toContain(updated[59].body._meta.sources[0].full);
		expect(first).toContain("error fixture doc-59");
		expect(first).toContain("warning fixture doc-0");
		expect(first).not.toContain("fixture unrelated");
		expect(first).not.toContain("<li>");
		expect(first).toContain("2 unrelated or unassociated");
		if (partial) {
			expect(saved.updateReport.failed[0].error).toMatchObject({message: "Download failed", stack: expect.stringContaining("Download failed"), cause: {message: "Underlying fixture"}});
			expect(saved.contentHtml).toContain("&lt;Bad &amp; source&gt;");
		}
		updated[59].body._meta.sources[0].full = "Mutated after snapshot";
		BrewDiagnostics.clear();
		logs.forEach(spy => spy.mockClear());
		await brewUtil._pInit_pDoShowReloadMessage();
		const replay = consoleText();
		expect(replay).toContain(saved.updateReport.id);
		expect(replay).toContain("restored report; not a new update");
		expect(replay).toContain(saved.updateReport.updated[59].sources[0].full);
		expect(replay).not.toContain("Mutated after snapshot");
		expect(replay).toContain("warning fixture doc-0");
		expect(replay).toContain("error fixture doc-59");
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({isAutoHide: false, isDismissOnClick: false, content: {html: saved.contentHtml}}));
		expect(brewUtil._storage.pRemove).toHaveBeenCalledTimes(1);
	});

	it.each([false, true])("logs and shows a complete persistent no-reload outcome (all-failed=%s)", async allFailed => {
		const doc = document("bad");
		const result = {brewDocsUpdated: [], failedBrews: allFailed ? [{brew: doc, url: doc.head.url, error: new Error("404 fixture")}] : []};
		const {ui, brewUtil, rdState} = setup(result, [doc]);
		await ui._pDoPullAll({rdState, isReload: true});
		expect(brewUtil.doLocationReload).not.toHaveBeenCalled();
		expect(brewUtil.pSetReloadMessage).not.toHaveBeenCalled();
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({isAutoHide: false, isDismissOnClick: false, type: allFailed ? "danger" : "info"}));
		expect(consoleText()).toContain(allFailed ? "404 fixture" : "No homebrew was updated");
	});

	it("logs fatal errors including causes and rethrows the exact original rejection", async () => {
		const {ui, brewUtil, rdState} = setup({}, [document("managed")]);
		const failure = new Error("Conversion fixture", {cause: new Error("root cause")});
		brewUtil.pPullAllBrews.mockRejectedValue(failure);
		await expect(ui._pDoPullAll({rdState, isReload: true})).rejects.toBe(failure);
		expect(consoleText()).toContain("Conversion fixture");
		expect(consoleText()).toContain("root cause");
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({type: "danger", isAutoHide: false}));
	});

	it("replays old reload messages without requiring report metadata", async () => {
		const brewUtil = new BrewUtil2Base();
		brewUtil._storage = {pGet: async () => ({contentHtml: "<div>Legacy</div>"}), pRemove: async () => {}};
		await brewUtil._pInit_pDoShowReloadMessage();
		expect(toast).toHaveBeenCalledWith(expect.objectContaining({content: {html: "<div>Legacy</div>"}}));
		expect(consoleText()).toBe("");
	});

	it("associates source-only unknown-origin diagnostics without collecting another document", () => {
		const doc = document("managed");
		BrewDiagnostics.report({...issue(doc), documentId: undefined});
		BrewDiagnostics.report({...issue(doc, "error"), documentId: "different-doc"});
		const report = ManageBrewDiagnosticsUtil.getUpdateReport({brewUtil: {}, brews: [doc]});
		expect(report.diagnostics).toHaveLength(1);
		expect(report.unassociatedDiagnostics).toBe(1);
	});

	it.each([
		["documentId", {url: "https://example.invalid/old.json", filename: "old.json"}, true],
		["url", {documentId: undefined, filename: "old.json"}, true],
		["conflicting documentId", {documentId: "different-doc"}, false],
	])("uses canonical %s without trusting weaker stale identities", (_label, fields, isIncluded) => {
		const doc = document("managed");
		BrewDiagnostics.report({...issue(doc), url: doc.head.url, filename: doc.head.filename, ...fields});
		const report = ManageBrewDiagnosticsUtil.getUpdateReport({brewUtil: {}, brews: [doc]});
		expect(report.diagnostics).toHaveLength(isIncluded ? 1 : 0);
		expect(report.unassociatedDiagnostics).toBe(isIncluded ? 0 : 1);
	});

	it("does not attribute source-only diagnostics when separate managed documents claim the same source", () => {
		const first = document("managed");
		const second = document("other");
		second.body._meta.sources = first.body._meta.sources;
		BrewDiagnostics.report({...issue(first), documentId: undefined});
		const report = ManageBrewDiagnosticsUtil.getUpdateReport({brewUtil: {}, brews: [first, second]});
		expect(report.diagnostics).toHaveLength(0);
		expect(report.unassociatedDiagnostics).toBe(1);
	});
});
