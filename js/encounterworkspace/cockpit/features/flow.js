/**
 * P3c — the flow of combat: timeline stage mode, log drawer, death-save pips, concentration markers, groups UI,
 * end combat. Owned by the P3c session; installed by cockpit.js after the shell mounts.
 */
import {installFlowConcentration} from "./flow-conc.js";
import {installFlowEnd} from "./flow-end.js";
import {installFlowGroups} from "./flow-groups.js";
import {installFlowLog} from "./flow-log.js";
import {installFlowRows} from "./flow-rows.js";
import {installFlowTimeline} from "./flow-timeline.js";

export function installCockpitFlowFeatures (api) {
	// Each part stands alone: one failing to install must not take the others (or the shell) down with it.
	[installFlowTimeline, installFlowLog, installFlowRows, installFlowConcentration, installFlowGroups, installFlowEnd].forEach(install => {
		try {
			install(api);
		} catch (e) {
			setTimeout(() => { throw e; });
		}
	});
}
