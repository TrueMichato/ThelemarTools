import "../../js/parser.js";
import "../../js/utils.js";
import {jest} from "@jest/globals";

// Regression coverage: a non-rate-limit error (e.g. a 404 from a renamed homebrew file) must NOT
// poison the GitHub-raw request limiter. Only a genuine 429 should.
describe("DataUtil request limiter", () => {
	describe("_isRequestLimitedStatus", () => {
		it("treats only HTTP 429 as a rate-limit", () => {
			expect(DataUtil._isRequestLimitedStatus(429)).toBe(true);
			expect(DataUtil._isRequestLimitedStatus(404)).toBe(false);
			expect(DataUtil._isRequestLimitedStatus(403)).toBe(false);
			expect(DataUtil._isRequestLimitedStatus(500)).toBe(false);
			expect(DataUtil._isRequestLimitedStatus(200)).toBe(false);
			expect(DataUtil._isRequestLimitedStatus(0)).toBe(false);
		});
	});

	describe("poisoning behaviour via mocked XMLHttpRequest", () => {
		const URL_RAW = "https://raw.githubusercontent.com/foo/bar/main/x.json";
		let originalXhr;
		let responder;

		class MockXhr {
			constructor () { this._listeners = {}; }
			open (method, url) { this._url = url; }
			overrideMimeType () {}
			addEventListener (type, cb) { this._listeners[type] = cb; }
			send () {
				const {status, response} = responder(this._url);
				this.status = status;
				this.readyState = 4;
				this.responseType = "";
				this.statusText = "";
				this.response = response;
				if (status === 0) this._listeners.error?.();
				else this._listeners.load?.();
			}
		}

		beforeEach(() => {
			originalXhr = globalThis.XMLHttpRequest;
			globalThis.XMLHttpRequest = MockXhr;
			// Reset limiter between cases
			DataUtil.REQUEST_LIMITER_GITHUB_RAW._limitedUntil = null;
		});

		afterEach(() => {
			globalThis.XMLHttpRequest = originalXhr;
			DataUtil.REQUEST_LIMITER_GITHUB_RAW._limitedUntil = null;
		});

		it("does NOT limit the host after a 404", async () => {
			responder = () => ({status: 404, response: "Not Found"});

			const res = await DataUtil._pLoad_pGetJson_pGetOptionalJson({url: URL_RAW});

			expect(res.status).toBe(404);
			expect(res.json).toBeNull();
			expect(DataUtil.REQUEST_LIMITER_GITHUB_RAW.isLimited(URL_RAW)).toBe(false);
		});

		it("does NOT limit the host after a 200 with unparseable JSON", async () => {
			responder = () => ({status: 200, response: "<html>not json</html>"});

			const res = await DataUtil._pLoad_pGetJson_pGetOptionalJson({url: URL_RAW});

			expect(res.json).toBeNull();
			expect(res.error).toEqual(expect.stringContaining("Could not parse JSON"));
			expect(DataUtil.REQUEST_LIMITER_GITHUB_RAW.isLimited(URL_RAW)).toBe(false);
		});

		it("DOES limit the host after a real 429", async () => {
			responder = () => ({status: 429, response: "Too Many Requests"});

			const res = await DataUtil._pLoad_pGetJson_pGetOptionalJson({url: URL_RAW});

			expect(res.status).toBe(429);
			expect(DataUtil.REQUEST_LIMITER_GITHUB_RAW.isLimited(URL_RAW)).toBe(true);
		});

		it("returns parsed JSON on a 200 without limiting", async () => {
			responder = () => ({status: 200, response: JSON.stringify({ok: true})});

			const res = await DataUtil._pLoad_pGetJson_pGetOptionalJson({url: URL_RAW});

			expect(res.json).toEqual({ok: true});
			expect(DataUtil.REQUEST_LIMITER_GITHUB_RAW.isLimited(URL_RAW)).toBe(false);
		});

		it("a 404 does not poison a subsequent request to the same host", async () => {
			responder = url => {
				if (url.endsWith("missing.json")) return {status: 404, response: "Not Found"};
				return {status: 200, response: JSON.stringify({ok: true})};
			};

			const resMissing = await DataUtil._pLoad_pGetJson_pGetOptionalJson({url: "https://raw.githubusercontent.com/foo/bar/main/missing.json"});
			expect(resMissing.status).toBe(404);

			const resOk = await DataUtil._pLoad_pGetJson_pGetOptionalJson({url: "https://raw.githubusercontent.com/foo/bar/main/present.json"});
			expect(resOk.json).toEqual({ok: true});
		});

		it("DOES limit the host after a network error (status 0), preserving backoff", async () => {
			responder = () => ({status: 0, response: ""});

			const res = await DataUtil._pLoad_pGetJson_pGetOptionalJson({url: URL_RAW});

			expect(res.json).toBeNull();
			expect(DataUtil.REQUEST_LIMITER_GITHUB_RAW.isLimited(URL_RAW)).toBe(true);
		});

		it("still falls back to jsDelivr on a genuine 429", async () => {
			responder = url => {
				if (url.startsWith("https://cdn.jsdelivr.net/")) return {status: 200, response: JSON.stringify({viaJsDelivr: true})};
				return {status: 429, response: "Too Many Requests"};
			};

			const json = await DataUtil._pLoad_pGetJson({url: URL_RAW, id: "req-limiter-jsdelivr-fallback"});

			expect(json).toEqual({viaJsDelivr: true});
			delete DataUtil._loaded["req-limiter-jsdelivr-fallback"];
		});
	});
});
