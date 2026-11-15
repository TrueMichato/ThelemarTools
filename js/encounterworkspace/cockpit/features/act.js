/**
 * P3a — act on the target: the dock Roll (R) and Fx (E) tabs, the roll tray and the `/` command console.
 * Owned by the P3a session; installed by cockpit.js after the shell mounts. See `getApi()` in cockpit.js.
 */

import {createCockpitConsole} from "./act-console.js";
import {createCockpitFxTab} from "./act-fx.js";
import {createCockpitRollTab} from "./act-roll.js";
import {createCockpitRollTray} from "./act-tray.js";

export function installCockpitActFeatures (api) {
	const tray = createCockpitRollTray(api);
	api.registerDockTab(createCockpitRollTab(api, {tray}));
	api.registerDockTab(createCockpitFxTab(api));
	const commandConsole = createCockpitConsole(api, {tray});
	return {tray, console: commandConsole};
}
