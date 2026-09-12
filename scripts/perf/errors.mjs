/** The development checkout lacks this generated, optional service-worker bootstrap. */
export function observeErrors (page, {isLocal = false} = {}) {
	const consoleErrors = [];
	const requestErrors = [];
	const warnings = [];
	const isOptional = url => {
		if (!isLocal || !url) return false;
		const parsed = new URL(url);
		return ["localhost", "127.0.0.1"].includes(parsed.hostname) && parsed.pathname === "/sw-injector.js";
	};
	page.on("pageerror", error => consoleErrors.push(error.message));
	page.on("console", message => {
		if (message.type() !== "error") return;
		const target = isOptional(message.location().url) && /Failed to load resource/.test(message.text()) ? warnings : consoleErrors;
		target.push(message.text());
	});
	page.on("requestfailed", request => {
		const target = isOptional(request.url()) ? warnings : requestErrors;
		target.push(`${request.url()}: ${request.failure()?.errorText}`);
	});
	page.on("response", response => {
		if (response.status() < 400) return;
		const target = isOptional(response.url()) && response.status() === 404 ? warnings : requestErrors;
		target.push(`${response.status()} ${response.url()}`);
	});
	return {consoleErrors, requestErrors, warnings};
}
