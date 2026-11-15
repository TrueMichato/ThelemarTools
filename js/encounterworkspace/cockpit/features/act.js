/**
 * P3a — act on the target: the dock Roll (R) and Fx (E) tabs, the roll tray, the `/` command console and (P4) the
 * statblock roll feed.
 * Owned by the P3a session; installed by cockpit.js after the shell mounts. See `getApi()` in cockpit.js.
 */

import {createCockpitConsole} from "./act-console.js";
import {createCockpitRollFeed} from "./act-feed.js";
import {createCockpitFxTab} from "./act-fx.js";
import {createCockpitRollTab} from "./act-roll.js";
import {createCockpitRollTray} from "./act-tray.js";

export function installCockpitActFeatures (api) {
	const tray = createCockpitRollTray(api);
	api.registerDockTab(createCockpitRollTab(api, {tray}));
	api.registerDockTab(createCockpitFxTab(api));
	const commandConsole = createCockpitConsole(api, {tray});
	const feed = createCockpitRollFeed(api, {tray, console: commandConsole});
	tray.onShow(() => feed.hide());
	return {tray, console: commandConsole, feed};
}
