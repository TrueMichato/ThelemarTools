import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/utils-dataloader.js";
import {jest} from "@jest/globals";

describe("Renderer.events inline statblocks", () => {
	afterEach(() => {
		jest.restoreAllMocks();
		delete globalThis.veE;
	});

	it("renders, replaces, binds, and initializes collapse behavior", async () => {
		const attrs = {
			"data-rd-tag": "creature",
			"data-rd-uid": "Goblin|MM",
			"data-rd-page": "bestiary.html",
			"data-rd-source": "MM",
			"data-rd-name": "Goblin",
			"data-rd-display-name": "",
			"data-rd-hash": "goblin_mm",
			"data-rd-style": "classic",
			"data-rd-entry-data": JSON.stringify({renderCompact: {isShowScalers: true}}),
			"data-rd-slot-size": "1",
			"data-rd-is-fixed-height-initial": "true",
		};

		const eleEmbedContent = {vee: {removeClass: jest.fn()}};
		const wrpRenderedData = {
			vee: {find: jest.fn(() => eleEmbedContent)},
			replaceWith: jest.fn(),
		};
		const tbl = {vee: {closest: jest.fn(() => wrpRenderedData)}};
		const tr = {vee: {closest: jest.fn(() => tbl), html: jest.fn()}};
		const ele = {vee: {attr: jest.fn(key => attrs[key]), closest: jest.fn(() => tr)}};
		const entryTarget = {};
		const renderTarget = {};
		const nxt = {nodeType: 1, querySelector: jest.fn(() => renderTarget)};

		globalThis.veE = jest.fn(arg => arg === entryTarget ? ele : nxt);

		const toRender = {name: "Goblin", source: "MM", __prop: "monster"};
		jest.spyOn(DataLoader, "pCacheAndGet").mockResolvedValue(toRender);
		jest.spyOn(Renderer.events, "_handleLoad_inlineStatblock_getHtmlNames").mockReturnValue({
			htmlNameCollapsed: "Goblin",
			htmlNameExpanded: "Open",
		});
		jest.spyOn(Renderer.utils.embed, "getHeader").mockReturnValue("<table>");
		jest.spyOn(Renderer.utils.embed, "getFooter").mockReturnValue("</table>");
		const fnRender = jest.fn(() => "<tbody></tbody>");
		jest.spyOn(Renderer.hover, "getFnRenderCompact").mockReturnValue(fnRender);
		const fnBind = jest.fn();
		jest.spyOn(Renderer.hover, "getFnBindListenersCompact").mockReturnValue(fnBind);
		const collapseSpy = jest.spyOn(Renderer.statblockCollapse, "apply").mockImplementation(() => {});

		const observer = {getIsIntersecting: jest.fn(() => true)};
		await expect(Renderer.events._handleLoad_inlineStatblock_pFnOnObserve({
			entry: {target: entryTarget},
			observer,
		})).resolves.toBe(true);

		expect(fnRender).toHaveBeenCalledWith(toRender, {isShowScalers: true, isEmbeddedEntity: true});
		expect(wrpRenderedData.replaceWith).toHaveBeenCalledWith(nxt);
		expect(nxt.querySelector).toHaveBeenCalledWith(`[data-rd-rendered-data-embed-render-target="true"]`);
		expect(fnBind).toHaveBeenCalledWith(toRender, renderTarget);
		expect(collapseSpy).toHaveBeenCalledWith(nxt);
	});
});
