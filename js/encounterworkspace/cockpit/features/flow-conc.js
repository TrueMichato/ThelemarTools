/** P3c — concentration checks: after a concentrating creature takes damage, a quiet strip offers the Con save. */
import {h} from "../dom.js";
import {getCockpitContributorGetter} from "../rules.js";
import {getEncounterRollBreakdown} from "../../encounterworkspace-rollbreakdown.js";
import {endEncounterConcentration, getEncounterConcentration} from "../../encounterworkspace-fx.js";
import {bindFlowConcentration} from "./flow-util.js";

export function installFlowConcentration (api) {
	const strip = h("div.ewc-conc", {"data-ewc-flow": "conc", role: "region", "aria-label": "Concentration checks"});
	api.getRegion("stageTop").append(strip);
	/** {key, id, dc, spell, result?, dropped?} — one per damaging hit, as the rules ask. */
	let checks = [];
	let seq = 0;

	api.onDamageApplied(({results, state}) => {
		results.forEach(res => {
			if (!res.concentrationDc) return;
			const instance = state.instances.find(it => it.id === res.id);
			const spell = getEncounterConcentration(instance);
			if (!spell) return;
			checks.push({key: `c${++seq}`, id: res.id, dc: res.concentrationDc, spell});
		});
		render();
	});

	api.engine.subscribe(() => {
		const state = api.getState();
		const before = checks.length;
		// A check with no result is moot once the creature stops concentrating (dropped, defeated, removed).
		checks = checks.filter(it => it.result || getEncounterConcentration(state.instances.find(inst => inst.id === it.id)) === it.spell);
		if (checks.length !== before) render();
	});

	const dismiss = key => {
		checks = checks.filter(it => it.key !== key);
		render();
	};

	async function pDrop (check, reason) {
		const name = api.getCtx().labels.get(check.id) || "Creature";
		const next = await api.pCommit(`${name} drops ${check.spell}`, (draft, {log}) => { endEncounterConcentration(draft, check.id, {reason, log}); });
		if (next) check.dropped = true;
		return !!next;
	}

	async function pRoll (check) {
		const state = api.getState();
		const instance = state.instances.find(it => it.id === check.id);
		if (!instance) return dismiss(check.key);
		const name = api.getCtx().labels.get(check.id) || "Creature";
		let roll;
		try {
			roll = getEncounterRollBreakdown({instance, query: {kind: "save", ability: "con", dc: check.dc}, getContributors: getCockpitContributorGetter(state, api.getSettings())});
		} catch (e) {
			api.toast(`Could not roll the Con save: ${e.message}.`, {kind: "error"});
			return;
		}
		check.result = roll;
		const verdict = roll.success ? "keeps concentration" : "loses concentration";
		await api.engine.pLog("save", `${name} Con save ${roll.text} vs DC ${check.dc} (concentration on ${check.spell}) — ${verdict}${roll.autoFail ? " (automatic failure)" : ""}.`, {target: check.id});
		if (!roll.success) await pDrop(check, "failed the concentration save");
		render();
	}

	function render () {
		const ctx = api.getCtx();
		const state = ctx.state;
		strip.replaceChildren(...checks.map(check => {
			const name = ctx.labels.get(check.id) || "Creature";
			const spellEl = bindFlowConcentration(api, h("b.ewc-conc__spell", null, check.spell), state, check.id, check.spell);
			const nameEl = h("button.ewc-conc__who", {type: "button", title: "View this creature", onclick: () => api.view(check.id)}, name);
			const inst = state.instances.find(it => it.id === check.id);
			if (inst) api.hover.bindCreature(nameEl, inst);
			const res = check.result;
			const body = res
				? h("p.ewc-conc__t", null, nameEl, ` rolled ${res.text} vs DC ${check.dc} — `, res.success ? h("b.is-ok", null, "keeps ") : h("b.is-bad", null, check.dropped ? "drops " : "fails, "), spellEl, ".")
				: h("p.ewc-conc__t", null, h("span.ewc-conc__mark", {"aria-hidden": "true"}, "◉"), " ", nameEl, " took damage while concentrating on ", spellEl, " — ", h("b", null, `Con save DC ${check.dc}`));
			const actions = res
				? [h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {type: "button", "data-ewc-flow": "conc-ok", onclick: () => dismiss(check.key)}, "OK")]
				: [
					h("button.ewc-btn.ewc-btn--sm.ewc-btn--primary", {type: "button", "data-ewc-flow": "conc-roll", title: `Roll ${name}'s Constitution save against DC ${check.dc}; a failure drops ${check.spell}`, onclick: () => pRoll(check)}, `🎲 Roll Con save`),
					h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {type: "button",
						"data-ewc-flow": "conc-keep",
						title: "The save succeeded at the table — keep concentrating",
						onclick: () => {
							api.engine.pLog("save", `${name} kept concentration on ${check.spell} (DC ${check.dc}).`, {target: check.id}).catch(() => {});
							dismiss(check.key);
						}}, "Kept"),
					h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {type: "button", "data-ewc-flow": "conc-drop", title: `The save failed at the table — end ${check.spell} and its effects`, onclick: async () => { if (await pDrop(check, "failed the concentration save")) dismiss(check.key); }}, "Drop"),
				];
			return h(`div.ewc-conc__item${res ? (res.success ? ".is-ok" : ".is-bad") : ""}`, {"data-ewc-conc": check.id}, body, h("div.ewc-conc__acts", null, actions));
		}));
	}

	// The shell's "◉ Conc" marker gets the real spell hover when the concentration names a known spell.
	api.addRailRowDecorator((row, instance, ctx) => {
		const label = getEncounterConcentration(instance);
		const span = label ? row.querySelector(".ewc-row__conc > span") : null;
		if (span) bindFlowConcentration(api, span, ctx.state, instance.id, label);
	});
}
