import {jest} from "@jest/globals";
import "../../js/parser.js";
import "../../js/utils.js";
import {findElements, installElementUtilTestDom} from "./helpers/element-util-test-dom.js";

describe("production toast lifecycle and report interactions", () => {
	let dom;
	let originalWindow;
	let originalVeE;
	let animation;
	const fire = (node, type, extras = {}) => {
		const event = {preventDefault: jest.fn(), stopPropagation: jest.fn(), ...extras};
		for (const listener of node._listeners[type] || []) listener(event);
		return event;
	};
	const show = async (options = {}) => {
		JqueryUtil.doToast({content: "Full report content", ...options});
		await Promise.resolve();
		return JqueryUtil._ACTIVE_TOAST.at(-1);
	};
	beforeEach(() => {
		jest.useFakeTimers();
		originalWindow = globalThis.window;
		globalThis.window = {};
		dom = installElementUtilTestDom();
		originalVeE = globalThis.veE;
		globalThis.veE = dom.e_;
		animation = jest.spyOn(AnimationUtil, "pRecomputeStyles").mockResolvedValue();
		JqueryUtil._WRP_TOAST = null;
		JqueryUtil._ACTIVE_TOAST = [];
	});
	afterEach(() => {
		jest.clearAllTimers();
		jest.useRealTimers();
		animation.mockRestore();
		dom.restore();
		if (originalWindow === undefined) delete globalThis.window;
		else globalThis.window = originalWindow;
		if (originalVeE === undefined) delete globalThis.veE;
		else globalThis.veE = originalVeE;
		JqueryUtil._WRP_TOAST = null;
		JqueryUtil._ACTIVE_TOAST = [];
	});

	it("allows report content selection/clicks but closes through its independent named button", async () => {
		const meta = await show({isAutoHide: false, isDismissOnClick: false});
		const content = findElements(meta.eleToast, node => node.classList.contains("toast__wrp-content"))[0];
		const close = findElements(meta.eleToast, node => node.tagName === "BUTTON")[0];
		expect(content.getAttribute("tabindex")).toBe("0");
		expect(content.getAttribute("aria-label")).toBe("Notification content");
		expect(close.getAttribute("aria-label")).toContain("Close notification");
		expect(close.getAttribute("type")).toBe("button");
		expect(fire(meta.eleToast, "mousedown").preventDefault).not.toHaveBeenCalled();
		fire(meta.eleToast, "click");
		expect(JqueryUtil._ACTIVE_TOAST).toContain(meta);
		fire(close, "click");
		expect(JqueryUtil._ACTIVE_TOAST).toHaveLength(0);
		await jest.advanceTimersByTimeAsync(85);
		expect(meta.eleToast.parentElement).toBeNull();
	});

	it.each(["ctrlKey", "metaKey"])("retains three persistent reports and supports explicit %s close-all", async key => {
		const reports = [];
		for (let ix = 0; ix < 3; ix++) reports.push(await show({isAutoHide: false, isDismissOnClick: false}));
		await jest.advanceTimersByTimeAsync(30_000);
		expect(JqueryUtil._ACTIVE_TOAST).toEqual(reports);
		const close = findElements(reports[1].eleToast, node => node.tagName === "BUTTON")[0];
		fire(close, "click", {[key]: true});
		expect(JqueryUtil._ACTIVE_TOAST).toHaveLength(0);
	});

	it("preserves ordinary body-dismiss/default timing and ignores cleanup after earlier dismissal", async () => {
		const ordinary = await show();
		expect(fire(ordinary.eleToast, "mousedown").preventDefault).toHaveBeenCalled();
		fire(ordinary.eleToast, "click");
		const persistent = await show({isAutoHide: false});
		await jest.advanceTimersByTimeAsync(5000);
		expect(JqueryUtil._ACTIVE_TOAST).toEqual([persistent]);
		const timed = await show();
		await jest.advanceTimersByTimeAsync(4999);
		expect(JqueryUtil._ACTIVE_TOAST).toContain(timed);
		await jest.advanceTimersByTimeAsync(1);
		expect(JqueryUtil._ACTIVE_TOAST).toEqual([persistent]);
	});
});
