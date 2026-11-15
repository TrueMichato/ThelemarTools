/**
 * P3a — the `/` command console, docked at the top of the dock (mockup §6): an always-visible command line with a `/`
 * hint. Type a command (`7 fire @gob`, `save dex 14 8d6 fire half`, `prone 2r`, `bless 1 min by @mage`), see what it
 * will do to whom before Enter, run it through the shell actions / `pCommit` (undoable, logged). While active, the
 * panel under the line shows example chips, the full grammar, the live preview or an inline error. ↑/↓ walk the
 * history, Esc clears then closes. Rail rows get a `›_` quick action that opens the console pre-targeted at that
 * creature.
 */

import {endEncounterConcentration, getEncounterEffectPresets, applyEncounterEffect, removeEncounterEffect, startEncounterConcentration} from "../../encounterworkspace-fx.js";
import {setEncounterExhaustion} from "../../encounterworkspace-conditions-rules.js";
import {rollEncounterDeathSave} from "../../encounterworkspace-deathsaves.js";
import {getEncounterRolledAmount} from "../../encounterworkspace-massroll.js";
import {h} from "../dom.js";
import {
	COCKPIT_CONSOLE_CHEATSHEET,
	COCKPIT_CONSOLE_EXAMPLES,
	getCockpitConsoleCommand,
	getCockpitConsoleEffects,
	getCockpitConsoleHandle,
	getCockpitConsoleHistoryStep,
	getCockpitConsoleHistoryWith,
	getCockpitConsolePreview,
	getCockpitConsoleSaveOutcome,
	getCockpitCritExpr,
} from "./act-console-model.js";
import {getCockpitDurationText} from "./act-effect-model.js";
import {pRollCockpitToTray} from "./act-roll.js";
import {getKbd, getWhoText, toTitle} from "./act-shared.js";

export function createCockpitConsole (api, {tray}) {
	let isOpen = false;
	let history = [];
	let histIndex = null;
	let draft = "";
	let status = null; // {kind: "ok"|"error", text}
	let review = null; // {run (decisions), unresolved, decisions, title}
	let pActive = null;
	let pQueued = null;
	let previewIds = [];
	let returnFocus = null;

	let isCheatOpen = false;

	const input = h("input.ewc-con__in", {id: "ewc-console-in",
		type: "text",
		autocomplete: "off",
		spellcheck: "false",
		placeholder: "Type a command",
		"aria-label": "Command",
		"aria-describedby": "ewc-console-help",
		"aria-keyshortcuts": "/",
		"data-ewc-console-in": "",
	});
	const help = h("div.ewc-con__help", {id: "ewc-console-help", "aria-live": "polite"});
	const close = h("button.ewc-btn.ewc-btn--icon.ewc-btn--ghost.ewc-con__x", {type: "button", title: "Close (Esc)", "aria-label": "Close the console", "data-ewc-console-close": ""}, "×");
	const bar = h("div.ewc-con__bar", null,
		h("span.ewc-con__prompt", {"aria-hidden": "true"}, "›"),
		input,
		h("span.ewc-con__key", {"aria-hidden": "true"}, getKbd(["/"], api.isMac)),
		h("span.ewc-con__run", null, getKbd(["Enter"], api.isMac)),
		close);
	// The whole line is the hit target: clicking its padding or prompt focuses the input.
	bar.addEventListener("mousedown", evt => {
		if (evt.target === input || evt.target.closest("button")) return;
		evt.preventDefault();
		input.focus();
	});
	const idle = h("p.ewc-con__idle", {"data-ewc-console-idle": ""}, "Press ", getKbd(["/"], api.isMac), " to type a command — or use the tools below.");
	const panel = h("div.ewc-con__panel", {hidden: true, "data-ewc-console": ""}, help);
	const root = h("section.ewc-con", {"aria-label": "Command console", "data-ewc-console-dock": ""}, bar, idle, panel);
	api.getRegion("dockTop").prepend(root);

	const getParseOpts = ctx => ({
		state: ctx.state,
		effects: getCockpitConsoleEffects(getEncounterEffectPresets(ctx.state)),
		selectedIds: ctx.ui.selectedIds || [],
		activeId: ctx.activeInstanceId,
		viewedId: ctx.ui.viewedId,
		chipGroups: ctx.groupChips.map(it => ({name: it.name, ids: it.memberIds})),
		dockTargetIds: ctx.targetIds,
	});

	const parse = (ctx = api.getCtx()) => {
		const opts = getParseOpts(ctx);
		const parsed = getCockpitConsoleCommand(input.value, opts);
		return {parsed, preview: parsed.cmd && !parsed.error ? getCockpitConsolePreview(parsed, {state: ctx.state, labels: ctx.labels, settings: ctx.settings, effects: opts.effects}) : null};
	};

	/* ---------------- Rendering ---------------- */

	const getExample = (item, {label = item, title = null, onclick = null} = {}) => h("button.ewc-con__ex", {
		type: "button",
		title: title || (item.startsWith("@") ? `Target: ${item}` : `Stage “${item}”`),
		"data-ewc-console-ex": item,
		onclick: onclick || (() => stage(item.startsWith("@") ? `${item} ` : `${input.value.match(/^(?:@\S+\s+)*/)?.[0] || ""}${item}`)),
	}, label);

	const getCheatSheet = () => h("div.ewc-con__cheatwrap", null,
		h("div.ewc-con__exs", {"aria-label": "Examples"},
			COCKPIT_CONSOLE_EXAMPLES.map(it => getExample(it)),
			history.length ? getExample("↑", {label: "↑ history", title: "Recall the last command (↑)", onclick: () => { input.focus(); step(-1); }}) : null),
		h("button.ewc-btn.ewc-btn--link.ewc-act__disc.ewc-con__more", {
			type: "button",
			"aria-expanded": `${isCheatOpen}`,
			"data-ewc-console-more": "",
			onclick: () => { isCheatOpen = !isCheatOpen; draw(); input.focus(); },
		}, isCheatOpen ? "▾ All commands" : "▸ All commands"),
		isCheatOpen ? h("div.ewc-con__cheat", {"aria-label": "Command grammar"},
			COCKPIT_CONSOLE_CHEATSHEET.map(group => h("div.ewc-con__cg", null,
				h("span.ewc-con__cgl", null, group.group),
				group.items.map(item => getExample(item))))) : null,
		h("p.ewc-con__keys.ewc-muted", null, getKbd(["Enter"], api.isMac), " run · ", getKbd(["↑"], api.isMac), getKbd(["↓"], api.isMac), " history · ", getKbd(["Esc"], api.isMac), " close · no @ = the dock targets"));

	const getReview = ctx => h("div.ewc-review.ewc-con__review", {role: "group", "aria-label": "Conditional defenses"},
		h("p.ewc-review__head", null, h("b", null, review.title), " Does each defense apply?"),
		review.unresolved.map(item => h("label.ewc-review__row", null,
			h("span", null, `${ctx.labels.get(item.id) || item.id} — ${item.defense} ${item.note}`),
			h("select.ewc-input.ewc-input--sm", {
				"data-ewc-console-rv": `${item.id}-${item.key}`,
				onchange: evt => {
					review.decisions[item.id] = {...review.decisions[item.id], [item.key]: evt.target.value === "" ? undefined : evt.target.value === "yes"};
				},
			},
			h("option", {value: ""}, "Choose…"),
			h("option", {value: "yes"}, "Applies"),
			h("option", {value: "no"}, "Does not apply")))),
		h("div.ewc-act__row", null,
			h("button.ewc-btn.ewc-btn--sm.ewc-btn--bad", {type: "button", "data-ewc-console-rv-go": "", onclick: () => pContinueReview()}, "Continue"),
			h("button.ewc-btn.ewc-btn--sm", {type: "button", onclick: () => { review = null; draw(); input.focus(); }}, "Cancel")));

	function draw () {
		if (!isOpen) return;
		const ctx = api.getCtx();
		const {parsed, preview} = parse(ctx);
		const nodes = [];
		if (review) {
			nodes.push(getReview(ctx));
		} else if (parsed.error) {
			nodes.push(h("p.ewc-con__err", {role: "alert"}, h("span", {"aria-hidden": "true"}, "⚠ "), parsed.error));
		} else if (preview) {
			nodes.push(h("div.ewc-con__pv", {"data-ewc-console-preview": ""},
				h("p.ewc-con__pvt", null, h("b", null, preview.title), h("span.ewc-muted", null, ` → ${preview.rows.length ? getWhoText(preview.rows.map(it => it.id), ctx.labels) : "nobody"}`)),
				preview.rows.length ? h("ul.ewc-con__pvl", null, preview.rows.slice(0, 8).map(row => {
					const name = h("span.ewc-con__pvn", null, row.label);
					const instance = ctx.state.instances.find(it => it.id === row.id);
					if (instance) api.hover.bindCreature(name, instance);
					return h("li", {"data-ewc-console-pvrow": row.id}, name, h("span.ewc-con__pvx", null, row.text));
				}), preview.rows.length > 8 ? h("li.ewc-muted", null, `+${preview.rows.length - 8} more`) : null) : null,
				h("p.ewc-con__keys.ewc-muted", null, getKbd(["Enter"], api.isMac), preview.isRoll ? " roll — results open in the tray" : " apply — undo with ", preview.isRoll ? null : getKbd(["mod", "Z"], api.isMac))));
		} else if (status) {
			nodes.push(h(`p.ewc-con__status${status.kind === "error" ? ".ewc-error" : ""}`, {role: status.kind === "error" ? "alert" : "status"}, status.text));
			nodes.push(getCheatSheet());
		} else {
			nodes.push(getCheatSheet());
		}
		help.replaceChildren(...nodes);
		root.classList.toggle("is-error", !!parsed.error && !review);
		syncOpen();
		const ids = !parsed.error && parsed.cmd ? parsed.ids : [];
		if (ids.join() !== previewIds.join()) {
			previewIds = ids;
			api.render();
		}
	}

	/* ---------------- Open / close / history ---------------- */

	function syncOpen () {
		root.classList.toggle("is-open", isOpen);
		panel.hidden = !isOpen;
		idle.hidden = isOpen;
	}

	function open ({text = null} = {}) {
		if (!isOpen) returnFocus = document.activeElement instanceof HTMLElement && !root.contains(document.activeElement) ? document.activeElement : null;
		isOpen = true;
		if (text != null) input.value = text;
		histIndex = null;
		status = null;
		syncOpen();
		input.focus();
		const end = input.value.length;
		input.setSelectionRange(end, end);
		draw();
	}

	function hide ({isRestoreFocus = true} = {}) {
		if (!isOpen) return;
		isOpen = false;
		input.value = "";
		review = null;
		status = null;
		histIndex = null;
		root.classList.remove("is-error");
		syncOpen();
		if (previewIds.length) {
			previewIds = [];
			api.render();
		}
		if (isRestoreFocus && returnFocus?.isConnected) returnFocus.focus({preventScroll: true});
		returnFocus = null;
		// An idle input keeping focus would swallow the global keys (⌘Z, R, E…).
		if (root.contains(document.activeElement)) document.activeElement.blur();
	}

	function stage (text) {
		input.value = text;
		histIndex = null;
		status = null;
		input.focus();
		input.setSelectionRange(text.length, text.length);
		draw();
	}

	function step (dir) {
		const out = getCockpitConsoleHistoryStep({history, index: histIndex, draft}, dir);
		if (histIndex == null && dir < 0) draft = input.value;
		histIndex = out.index;
		input.value = out.text;
		input.setSelectionRange(input.value.length, input.value.length);
		draw();
	}

	// Clicking or tabbing into the always-visible line activates the console.
	input.addEventListener("focus", () => { if (!isOpen) open(); });
	input.addEventListener("input", () => {
		histIndex = null;
		status = null;
		review = null;
		draw();
	});
	input.addEventListener("keydown", evt => {
		if (evt.isComposing) return;
		if (evt.key === "Enter") {
			evt.preventDefault();
			evt.stopPropagation();
			pRun();
		} else if (evt.key === "Escape") {
			evt.preventDefault();
			evt.stopPropagation();
			if (review) {
				review = null;
				draw();
			} else if (input.value) {
				input.value = "";
				status = null;
				draw();
			} else {
				hide();
			}
		} else if ((evt.key === "ArrowUp" || evt.key === "ArrowDown") && !evt.altKey) {
			evt.preventDefault();
			step(evt.key === "ArrowUp" ? -1 : 1);
		}
	});
	root.addEventListener("keydown", evt => {
		if (evt.key === "Escape" && evt.target !== input) {
			evt.preventDefault();
			evt.stopPropagation();
			if (review) {
				review = null;
				draw();
				input.focus();
			} else {
				hide();
			}
		}
	});
	root.addEventListener("focusout", evt => {
		if (evt.relatedTarget && root.contains(evt.relatedTarget)) return;
		setTimeout(() => {
			if (isOpen && !root.contains(document.activeElement) && !input.value.trim() && !review) hide({isRestoreFocus: false});
		}, 0);
	});
	close.addEventListener("click", () => hide());

	/* ---------------- Execution ---------------- */

	const finish = (text, line) => {
		history = getCockpitConsoleHistoryWith(history, line);
		draft = "";
		histIndex = null;
		// A command typed while this one awaited stays put.
		if (input.value.trim() === line) input.value = "";
		status = text ? {kind: "ok", text} : null;
		draw();
	};

	const fail = text => {
		status = {kind: "error", text};
		root.classList.remove("is-shake");
		void root.offsetWidth;
		root.classList.add("is-shake");
		draw();
	};

	const commit = (label, recipe) => api.pCommit(label, (draft, {log}) => { recipe(draft, log); return draft; });

	async function pDamage ({line, ids, cmd}) {
		let amount = cmd.amount;
		let amountText = `${cmd.amount}`;
		if (cmd.expr) {
			const expr = cmd.crit ? getCockpitCritExpr(cmd.expr) : cmd.expr;
			const rolled = getEncounterRolledAmount(expr);
			amount = rolled.amount;
			amountText = `${expr} = ${amount}`;
		}
		if (cmd.half) {
			amount = Math.floor(amount / 2);
			amountText = `half of ${amountText}`;
		}
		const run = async decisions => api.actions.pDamage({amount, amountText, damageType: cmd.damageType || null, source: "unspecified", isCrit: !!cmd.crit, decisions, targetIds: ids});
		const res = await run({});
		if (res?.unresolved) {
			review = {run, unresolved: res.unresolved, decisions: {}, title: `Rolled ${amountText}${cmd.damageType ? ` ${cmd.damageType}` : ""}.`, line};
			draw();
			help.querySelector("select")?.focus();
			return;
		}
		if (res?.ok) finish(`${amountText}${cmd.damageType ? ` ${cmd.damageType}` : ""} → ${getWhoText(ids, api.getCtx().labels)}`, line);
	}

	async function pContinueReview () {
		const missing = review.unresolved.find(it => review.decisions[it.id]?.[it.key] === undefined);
		if (missing) {
			help.querySelector(`[data-ewc-console-rv="${CSS.escape(`${missing.id}-${missing.key}`)}"]`)?.focus();
			api.toast("Choose Applies or Does not apply for every conditional defense.", {kind: "error"});
			return;
		}
		const {run, decisions, line} = review;
		review = null;
		const res = await run(decisions);
		if (res?.ok) finish("Damage applied.", line);
		else draw();
		input.focus();
	}

	function pRun (opts) {
		// Enter during an awaited command runs once it settles instead of being dropped.
		if (pActive) {
			pQueued ||= pActive.then(() => {
				pQueued = null;
				return pRun({isQueued: true});
			});
			return pQueued;
		}
		pActive = pRunNow(opts).finally(() => pActive = null);
		return pActive;
	}

	async function pRunNow ({isQueued = false} = {}) {
		const ctx = api.getCtx();
		const line = input.value.trim();
		// A repeated Enter finds its line already run and cleared.
		if (!line) return isQueued ? undefined : hide();
		const {parsed} = parse(ctx);
		if (parsed.error) return fail(parsed.error);
		const {cmd, ids, casterId} = parsed;
		const who = getWhoText(ids, ctx.labels);
		const ruleset = api.getSettings().ruleset;
		try {
			switch (cmd.verb) {
				case "target":
					api.setSelection(ids);
					return finish(`Selected ${who}.`, line);
				case "damage":
					return await pDamage({line, ids, cmd});
				case "heal":
				case "temp":
				case "set": {
					let amount = cmd.amount;
					let amountText = `${amount}`;
					if (cmd.expr) {
						amount = getEncounterRolledAmount(cmd.expr).amount;
						amountText = `${cmd.expr} = ${amount}`;
					}
					const res = await api.actions.pHp({mode: cmd.verb, amount, amountText, targetIds: ids});
					if (res?.ok !== false) finish(`${toTitle(cmd.verb === "set" ? "set HP" : cmd.verb)} ${amountText} → ${who}`, line);
					return;
				}
				case "condition":
					await api.actions.pCondition({condition: cmd.condition, isAdd: true, rounds: cmd.rounds ?? null, targetIds: ids});
					return finish(`${toTitle(cmd.condition)} → ${who}`, line);
				case "remove":
					if (cmd.condition) {
						await api.actions.pCondition({condition: cmd.condition, isAdd: false, targetIds: ids});
						return finish(`Ended ${cmd.condition} on ${who}`, line);
					}
					if (!(await commit(`End ${cmd.effect} → ${who}`, (draft, log) => removeEncounterEffect(draft, {targetIds: ids, key: cmd.effect, log})))) return;
					return finish(`Ended it on ${who}`, line);
				case "effect": {
					const def = getEncounterEffectPresets(ctx.state).find(it => it.key === cmd.effect);
					const label = `${def?.name || cmd.effect} → ${who}`;
					if (!(await commit(label, (draft, log) => applyEncounterEffect(draft, {targetIds: ids, def: cmd.effect, rounds: cmd.rounds ?? null, casterId, ruleset, log})))) return;
					api.toast(`${label} (${getCockpitDurationText(cmd.rounds ?? null)}).`, {isUndo: true});
					return finish(label, line);
				}
				case "save":
				case "check": {
					const request = cmd.verb === "save"
						? {kind: "save", ability: cmd.ability, skill: null, dc: cmd.dc, mode: cmd.mode}
						: {kind: "check", ability: cmd.ability, skill: cmd.skill, dc: cmd.dc, mode: cmd.mode};
					const title = `${cmd.skill ? toTitle(cmd.skill) : `${toTitle(cmd.ability)} ${cmd.verb}`}${cmd.dc != null ? ` DC ${cmd.dc}` : ""}`;
					const rolled = await pRollCockpitToTray(api, tray, {ids, request, outcome: getCockpitConsoleSaveOutcome(cmd), title, forcedLabel: "Console", isFocus: false});
					if (rolled) finish(null, line);
					return;
				}
				case "deathSave": {
					const rolls = new Map(ids.map(id => [id, 1 + Math.floor(Math.random() * 20)]));
					if (!(await commit(`Death save → ${who}`, (draft, log) => rolls.forEach((d20, id) => rollEncounterDeathSave(draft, {id, d20, log}))))) return;
					return finish(`Death save → ${[...rolls].map(([id, d20]) => `${ctx.labels.get(id)} ${d20}`).join(", ")}`, line);
				}
				case "initiative":
					for (const id of ids) await api.actions.pSetInitiative(id, cmd.total);
					return finish(`Initiative ${cmd.total} → ${who}`, line);
				case "dropConcentration":
					if (!(await commit(`Drop concentration → ${who}`, (draft, log) => ids.forEach(id => endEncounterConcentration(draft, id, {log}))))) return;
					return finish(`Dropped concentration — ${who}`, line);
				case "concentration": {
					const label = cmd.spell ? `Concentrate on ${cmd.spell} → ${who}` : `Drop concentration → ${who}`;
					if (!(await commit(label, (draft, log) => ids.forEach(id => cmd.spell ? startEncounterConcentration(draft, id, cmd.spell, {log}) : endEncounterConcentration(draft, id, {log}))))) return;
					return finish(label, line);
				}
				case "exhaustion":
					if (!(await commit(`Exhaustion ${cmd.level} → ${who}`, (draft, log) => setEncounterExhaustion(draft, {targetIds: ids, level: cmd.level, ruleset, log})))) return;
					return finish(`Exhaustion ${cmd.level} → ${who}`, line);
				default:
					return fail("That command can't run here yet.");
			}
		} catch (e) {
			fail(e.message);
		}
	}

	/* ---------------- Entry points ---------------- */

	api.registerKey({
		section: "Act",
		keys: ["/"],
		action: "console",
		label: "Command console",
		run: () => { open(); },
	});

	api.addRailRowDecorator((row, instance, ctx) => {
		if (previewIds.includes(instance.id)) row.classList.add("ewc-row--con");
		const qa = row.querySelector(".ewc-row__qa");
		if (!qa) return;
		const label = ctx.labels.get(instance.id) || instance.id;
		qa.append(h("button.ewc-qa.ewc-qa--con", {
			type: "button",
			title: `Type a command for ${label} (opens the console at ${getCockpitConsoleHandle(label)})`,
			"aria-label": `Command for ${label}`,
			"data-ewc-fk": `qa-con-${instance.id}`,
			"data-ewc-qa": "console",
			onclick: evt => {
				evt.stopPropagation();
				open({text: `${getCockpitConsoleHandle(label)} `});
			},
		}, "›_"));
	});

	api.onRender(() => { if (isOpen && !review && document.activeElement !== input) draw(); });

	return {open, hide, getIsOpen: () => isOpen, stage};
}
