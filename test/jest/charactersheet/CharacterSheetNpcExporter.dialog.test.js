import {jest} from "@jest/globals";
import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";
import {CharacterSheetModal} from "../../../js/charactersheet/charactersheet-modal.js";

const elements = [];
let ExportDialog;
const Exporter = globalThis.CharacterSheetNpcExporter;
const State = globalThis.CharacterSheetState;

beforeAll(async () => {
	globalThis.DataUtil ||= {userDownload: () => {}};
	const base = globalThis.e_;
	globalThis.e_ = opts => {
		const el = base(opts);
		if (opts?.click) el.addEventListener("click", opts.click);
		const values = [...String(opts?.outer || "").matchAll(/<option value="([^"]+)"/g)].map(match => match[1]);
		if (values.length) {
			let value = values[0];
			Object.defineProperty(el, "value", {get: () => value, set: next => { value = values.includes(next) ? next : ""; }});
		}
		elements.push(el);
		return el;
	};
	({CharacterSheetExport: ExportDialog} = await import("../../../js/charactersheet/charactersheet-export.js"));
	globalThis.e_ = base;
});

afterEach(() => jest.restoreAllMocks());

const open = async stored => {
	elements.length = 0;
	const preferences = new Map([["charsheet-npc-export-options", stored]]);
	jest.spyOn(StorageUtil, "pGetForPage").mockImplementation(async key => preferences.get(key));
	jest.spyOn(StorageUtil, "pSetForPage").mockImplementation(async (key, value) => preferences.set(key, value));
	jest.spyOn(CharacterSheetModal, "pGetShow").mockResolvedValue({eleModalInner: e_(), doClose: jest.fn()});
	Renderer.monster.getCompactRenderedString ||= () => "";
	Renderer.statblockCollapse ||= {apply: () => {}};
	jest.spyOn(Renderer.monster, "getCompactRenderedString").mockReturnValue("<tr><td>Rendered NPC</td></tr>");
	const state = new State({isDetached: true});
	state.addFeature({name: "Unique Rule", source: "PHB", description: "As a bonus action, teleport 10 feet."});
	const dialog = Object.assign(Object.create(ExportDialog.prototype), {_state: state});
	jest.spyOn(dialog, "_pGetNpcExportSpellIndex").mockResolvedValue([]);
	jest.spyOn(dialog, "_pGetNpcCompanionCreatures").mockResolvedValue([]);
	jest.spyOn(dialog, "_registerNpcCreatureHovers").mockImplementation(() => {});
	jest.spyOn(dialog, "_registerCompanionItemHovers").mockImplementation(() => {});
	const built = jest.spyOn(Exporter, "buildExportDocument");
	const save = jest.spyOn(dialog, "_pSaveNpcToEditableBrew").mockResolvedValue();
	MiscUtil.pCopyTextToClipboard ||= async () => {};
	const copy = jest.spyOn(MiscUtil, "pCopyTextToClipboard").mockResolvedValue();
	DataUtil.userDownload ||= () => {};
	const download = jest.spyOn(DataUtil, "userDownload").mockImplementation(() => {});
	await dialog._showNpcExportDialog();
	expect(built).toHaveBeenCalled();
	const select = elements.find(el => el._html.includes("aria-label=\"Export presentation\""));
	expect(select).toBeDefined();
	return {dialog, preferences, built, select, save, copy, download};
};

describe("NPC dialog presentation and real destination callbacks", () => {
	it.each([undefined, {defenseMode: "persistent"}, {presentationMode: "bad"}])("opens legacy/default preferences as Playable: %j", async stored => {
		const {built, select, preferences} = await open(stored);
		expect(select.value).toBe("playable");
		expect(built.mock.lastCall[1].presentationMode).toBe("playable");
		expect(preferences.get("charsheet-npc-export-options").presentationMode).toBe("playable");
		expect(select._html).toContain("Complete source rules");
		expect(select._html).toContain("Compact (legacy; omission warnings)");
	});

	it.each(["complete", "compact", "playable"])("honors and persists explicit %s, then sends one document shape to every destination", async presentationMode => {
		const {dialog, preferences, built, select, save, copy, download} = await open({presentationMode});
		expect(select.value).toBe(presentationMode);
		expect(built.mock.lastCall[1].presentationMode).toBe(presentationMode);
		select.value = "playable";
		await select._handlers.change();
		expect((await dialog._pGetNpcExportOptions()).presentationMode).toBe("playable");
		expect(preferences.get("charsheet-npc-export-options").presentationMode).toBe("playable");
		for (const label of ["Copy JSON", "Download JSON", "Save to Homebrew"]) {
			const button = elements.find(el => el._html.includes(label));
			expect(button).toBeDefined();
			await button._handlers.click();
		}
		const payload = JSON.parse(copy.mock.lastCall[0]);
		expect(payload).toEqual(built.mock.results.at(-1).value.document);
		expect(download.mock.calls.find(([, data]) => data.monster)?.[1]).toEqual(payload);
		expect(save.mock.lastCall[0]).toEqual(payload.monster[0]);
		expect(save.mock.lastCall[1].companionMonsters).toEqual(payload.monster.slice(1));
	});
});
