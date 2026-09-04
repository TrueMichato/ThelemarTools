import {BrewUtil2_} from "../../../js/utils-brew/utils-brew-impl-brew.js";

describe("whole-site campaign context bootstrap", () => {
	afterEach(() => {
		delete globalThis.HubPageContext;
	});

	it("finishes campaign context installation before BrewUtil initialization releases page data loading", async () => {
		const order = [];
		const brew = Object.create(BrewUtil2_.prototype);
		brew._pActiveInit = null;
		brew._pGetBrew_pGetLocalBrew = async () => order.push("personal-brew-ready");
		brew._pInit_doBindDragDrop = () => order.push("drag-drop-ready");
		brew._pInit_pDoLoadFonts = async () => order.push("fonts-started");
		brew._pInit_pDoShowReloadMessage = async () => order.push("reload-check-ready");
		globalThis.HubPageContext = {
			pInit: async () => order.push("campaign-context-ready"),
		};

		await brew.pInit();
		order.push("page-data-may-load");

		expect(order).toEqual([
			"personal-brew-ready",
			"drag-drop-ready",
			"fonts-started",
			"reload-check-ready",
			"campaign-context-ready",
			"page-data-may-load",
		]);
	});

	it("preserves the original BrewUtil initialization path when no shared navigation bootstrap exists", async () => {
		const order = [];
		const brew = Object.create(BrewUtil2_.prototype);
		brew._pActiveInit = null;
		brew._pGetBrew_pGetLocalBrew = async () => order.push("personal-brew-ready");
		brew._pInit_doBindDragDrop = () => {};
		brew._pInit_pDoLoadFonts = async () => {};
		brew._pInit_pDoShowReloadMessage = async () => {};

		await brew.pInit();

		expect(order).toEqual(["personal-brew-ready"]);
	});
});
