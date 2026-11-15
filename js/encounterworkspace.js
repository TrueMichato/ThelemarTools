// Encounter Workspace entry point: picks the cockpit or the legacy UI.
// `?ew=1` always opens the legacy UI; `?ew=2` always opens the cockpit.
// The cockpit is the default; the legacy UI stays reachable at `?ew=1` until it is retired.
export const ENCOUNTER_WORKSPACE_COCKPIT_DEFAULT = true;

export const getEncounterWorkspaceUiMode = (search = globalThis.location?.search || "") => {
	const ew = new URLSearchParams(search).get("ew");
	if (ew === "1") return "legacy";
	if (ew === "2") return "cockpit";
	return ENCOUNTER_WORKSPACE_COCKPIT_DEFAULT ? "cockpit" : "legacy";
};

const pWhenLoaded = () => document.readyState === "complete"
	? Promise.resolve()
	: new Promise(resolve => window.addEventListener("load", resolve, {once: true}));

const pBoot = async () => {
	const mode = getEncounterWorkspaceUiMode();
	const [module] = await Promise.all([
		mode === "cockpit"
			? import("./encounterworkspace/cockpit/cockpit.js")
			: import("./encounterworkspace/legacy/encounterworkspace-legacy.js"),
		pWhenLoaded(),
	]);
	document.getElementById(mode === "cockpit" ? "ew-cockpit" : "encounter-workspace").hidden = false;
	return mode === "cockpit" ? module.pBootEncounterCockpit() : module.pBootEncounterWorkspaceLegacy();
};

if (globalThis.document && globalThis.window) pBoot();
