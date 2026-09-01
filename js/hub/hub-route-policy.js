const _HUB_NETWORK_ONLY_PATHS = new Set([
	"/api",
	"/auth",
	"/campaign.html",
	"/css/hub.css",
	"/hub.html",
	"/manifest.webmanifest",
	"/sw-injector.js",
	"/sw.js",
]);

const _HUB_NETWORK_ONLY_PREFIXES = [
	"/api/",
	"/auth/",
	"/js/hub/",
];

export function isHubNetworkOnlyUrl ({url, appOrigin}) {
	const parsed = url instanceof URL ? url : new URL(url, appOrigin);
	if (parsed.origin !== appOrigin) return false;
	if (_HUB_NETWORK_ONLY_PATHS.has(parsed.pathname)) return true;
	return _HUB_NETWORK_ONLY_PREFIXES.some(prefix => parsed.pathname.startsWith(prefix));
}
