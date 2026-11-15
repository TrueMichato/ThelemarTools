/**
 * P3b — adding to the fight: the prep Add tab ("+1 Goblin", open bestiary / party) and the Add dialog (⇧A), which
 * searches the full site bestiary or adds party members from saved characters or a quick form. New monsters join
 * their kind's group (sharing its initiative) and roll initiative once combat order exists.
 */

import {h, kbd, replaceKeepingFocus} from "../dom.js";
import {EncounterWorkspaceState, getEncounterInstanceV8Defaults} from "../../encounterworkspace-state.js";
import {getEncounterResourceDefaults} from "../../encounterworkspace-resources.js";
import {withEncounterAutoGroup, withEncounterGroupInitiative} from "../../encounterworkspace-groups-v8.js";
import {
	getEncounterPartyStatsFromCharacter,
	pGetEncounterSavedCharacters,
	withEncounterPartyMembers,
} from "../../encounterworkspace-party.js";
import {
	PREP_CR_BANDS,
	PREP_MAX_QUANTITY,
	assertPrepRoom,
	clampPrepQuantity,
	fmtPrepCr,
	getPrepAddHp,
	getPrepCrText,
	getPrepKinds,
	getPrepMonsterType,
	getPrepMonsterTypes,
	searchPrepBestiary,
	validatePrepManualPc,
} from "./prep-model.js";
import {acts, btn, field, getErrorText, input, lbl, plural, seg, tip} from "./prep-ui.js";

const PC_DEFAULTS = Object.freeze({name: "", ac: "14", hp: "30", init: "2", passive: "12"});

export const getPrepAddDraft = () => ({
	tab: "bestiary",
	q: "",
	band: "",
	type: "",
	sel: null,
	qty: 1,
	hpMode: "average",
	pc: {...PC_DEFAULTS},
	pcError: null,
	saved: null,
});

/* -------------------------------------------- Data -------------------------------------------- */

let _pBestiary = null;
let _types = null;

/** The full site bestiary (every source the Bestiary page lists), loaded once. */
function pGetPrepBestiary () {
	return (_pBestiary ||= DataLoader.pCacheAndGetAllSite(UrlUtil.PG_BESTIARY)
		.then(list => {
			const monsters = (list || []).filter(it => it?.name && it?.source);
			_types = getPrepMonsterTypes(monsters);
			return monsters;
		})
		.catch(e => { _pBestiary = null; throw e; }));
}

const getMonKey = mon => `${mon.name}|${mon.source}`.toLowerCase();
const getMonHash = mon => UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BESTIARY](mon);
const getAcText = mon => {
	const ac = Array.isArray(mon.ac) ? mon.ac[0] : mon.ac;
	return typeof ac === "number" ? ac : ac?.ac ?? "—";
};
const getHpText = mon => mon.hp?.average ?? "—";
const rollFormula = formula => Renderer.dice.parseRandomise2(formula);

/* -------------------------------------------- Committing -------------------------------------------- */

function getNewMonsterInstance (mon, {hpMode}) {
	const hash = getMonHash(mon);
	return {
		id: CryptUtil.uid(),
		hash,
		customHashId: null,
		monster: MiscUtil.copyFast(mon),
		conditions: [],
		areaNotes: [],
		modifiers: [],
		statblockOperations: [],
		hp: getPrepAddHp(mon, {hpMode, fnRoll: rollFormula}),
		initiative: null,
		resources: getEncounterResourceDefaults(mon),
		...getEncounterInstanceV8Defaults(hash),
	};
}

/** New members of a group that already has a rolled initiative take it; returns the next state. */
function withJoinedGroupInitiative (state, grouped, newIds) {
	let next = state;
	for (const {name} of grouped) {
		const existing = next.instances.find(it => it.customGroup === name && !newIds.includes(it.id) && it.initiative != null);
		if (existing) next = withEncounterGroupInitiative(next, {name, total: existing.initiative});
	}
	return next;
}

/** Initiative for newcomers still without one, once anyone in the fight has rolled. */
async function pRollNewcomers (api, ids) {
	const state = api.getState();
	if (!state.instances.some(it => it.initiative != null && !ids.includes(it.id))) return;
	const need = ids.filter(id => state.instances.find(it => it.id === id)?.initiative == null);
	if (need.length) await api.actions.pRollInitiative(need);
}

export async function pAddPrepMonsters (api, mon, {qty = 1, hpMode = "average"} = {}) {
	const n = clampPrepQuantity(qty);
	let newIds = [];
	let grouped = [];
	const label = `Add ${n} × ${mon.name}`;
	const next = await api.pCommit(label, state => {
		assertPrepRoom(state, n);
		const added = Array.from({length: n}, () => getNewMonsterInstance(mon, {hpMode}));
		newIds = added.map(it => it.id);
		let out = EncounterWorkspaceState.validate({...state, instances: [...state.instances, ...added]});
		({state: out, grouped} = withEncounterAutoGroup(out, newIds));
		return withJoinedGroupInitiative(out, grouped, newIds);
	});
	if (!next) return null;
	api.view(newIds[0]);
	await pRollNewcomers(api, newIds);
	const group = grouped[0]?.name;
	api.toast(`Added ${n} × ${mon.name}${hpMode === "rolled" ? " (rolled HP)" : ""}${group ? ` → ${group}` : ""}.`, {isUndo: true});
	return newIds;
}

/** One more of a kind already in the fight: copies the base statblock (not edits made to one creature). */
async function pAddOneMore (api, kind) {
	const source = api.getState().instances.find(it => it.id === kind.instanceId);
	if (!source) return;
	return pAddPrepMonsters(api, source.monster, {qty: 1});
}

async function pAddPartyMembers (api, members, {isApprox = false} = {}) {
	let result = null;
	const names = members.map(it => it.name).join(", ");
	const next = await api.pCommit(`Add ${names}`, state => {
		assertPrepRoom(state, members.length);
		result = withEncounterPartyMembers(state, {members, fnUid: () => CryptUtil.uid()});
		if (!result.addedIds.length) throw new Error(result.skipped.map(it => `${it.name} is ${it.reason}`).join("; ") || "Nobody to add");
		return result.state;
	});
	if (!next) return null;
	api.view(result.addedIds[0]);
	await pRollNewcomers(api, result.addedIds);
	api.toast(`${names} join${members.length === 1 ? "s" : ""} the fight${isApprox ? " (some stats approximate — check their sheet)" : ""}.`, {isUndo: true});
	return result.addedIds;
}

/* -------------------------------------------- Prep Add tab -------------------------------------------- */

export function renderPrepAddTab (P, {onOpen}) {
	const {api, ctx} = P;
	const kinds = getPrepKinds(ctx.state, {labels: null});
	return [
		acts(
			btn("Open bestiary…", () => onOpen("bestiary"), {key: "add-open", kind: "primary", extra: kbd(["⇧", "A"])}),
			btn("Add party member…", () => onOpen("party"), {key: "add-party"}),
		),
		kinds.length
			? [
				lbl("One more of"),
				h("div.ewc-prep__more", null, kinds.map(kind => {
					const b = btn(`+1 ${kind.name}`, () => pAddOneMore(api, kind), {key: `add-more-${kind.hash}`, kind: "ghost", title: `${kind.count} in the fight`});
					const inst = ctx.state.instances.find(it => it.id === kind.instanceId);
					if (inst) api.hover.bindCreature(b, inst);
					return b;
				})),
			]
			: null,
		tip("New creatures join their kind's group and share its initiative."),
	];
}

/* -------------------------------------------- Add dialog -------------------------------------------- */

export class PrepAddDialog {
	constructor (api) {
		this._api = api;
		this._A = getPrepAddDraft();
		this._monsters = null;
		this._loadError = null;
		this._lastSel = null;
		this._dlg = h("dialog.ewc-dialog.ewc-add", {
			"aria-labelledby": "ewc-add-title",
			onclick: evt => { if (evt.target === this._dlg) this.close(); },
			onkeydown: evt => this._onKeydown(evt),
			onclose: () => { this._A.saved = null; },
		});
		api.getRegion("layer").append(this._dlg);
	}

	get isOpen () { return this._dlg.open; }

	close () { if (this._dlg.open) this._dlg.close(); }

	open (tab = null) {
		const A = this._A;
		if (tab) A.tab = tab;
		A.q = "";
		A.sel = null;
		A.qty = 1;
		A.pcError = null;
		this._render();
		if (!this._dlg.open) this._dlg.showModal();
		this._focusFirst();
		if (!this._monsters) {
			pGetPrepBestiary()
				.then(list => { this._monsters = list; this._loadError = null; if (this._dlg.open) this._render(); })
				.catch(e => { this._loadError = getErrorText(e); if (this._dlg.open) this._render(); });
		}
		if (A.tab === "party") this._pLoadSaved();
	}

	_focusFirst () {
		const target = this._A.tab === "bestiary" ? this._dlg.querySelector("[data-ewc-fk=add-q]") : this._dlg.querySelector("[data-ewc-fk=add-tab-party]");
		target?.focus();
	}

	_pLoadSaved () {
		if (this._A.saved) return;
		this._A.saved = "loading";
		pGetEncounterSavedCharacters()
			.then(list => { this._A.saved = list; })
			.catch(e => { this._A.saved = {error: getErrorText(e)}; })
			.then(() => { if (this._dlg.open) this._render(); });
	}

	_getResults () {
		if (!this._monsters) return {rows: [], total: 0};
		const A = this._A;
		const result = searchPrepBestiary(this._monsters, {q: A.q, band: A.band, type: A.type});
		const keys = result.rows.map(it => getMonKey(it.mon));
		if (!A.sel || !keys.includes(A.sel)) A.sel = keys[0] || null;
		return result;
	}

	_getSelected (rows) {
		return rows.find(it => getMonKey(it.mon) === this._A.sel)?.mon || null;
	}

	_onKeydown (evt) {
		evt.stopPropagation();
		const A = this._A;
		if (A.tab !== "bestiary" || !this._monsters) return;
		const isList = evt.target.closest?.("[data-ewc-add-row]");
		const isSearch = evt.target.matches?.("[data-ewc-fk=add-q]");
		if ((evt.key === "ArrowDown" || evt.key === "ArrowUp") && (isSearch || isList)) {
			evt.preventDefault();
			const {rows} = this._getResults();
			const ix = rows.findIndex(it => getMonKey(it.mon) === A.sel);
			const next = rows[Math.max(0, Math.min(rows.length - 1, ix + (evt.key === "ArrowDown" ? 1 : -1)))];
			if (next) { A.sel = getMonKey(next.mon); this._render(); }
			return;
		}
		if (evt.key === "Enter" && !evt.shiftKey && (isSearch || isList || evt.target.matches?.("[data-ewc-fk=add-qty]"))) {
			evt.preventDefault();
			if (isList) A.sel = isList.dataset.ewcAddRow;
			this._pAdd();
		}
	}

	async _pAdd () {
		const {rows} = this._getResults();
		const mon = this._getSelected(rows);
		if (!mon) return;
		const A = this._A;
		this.close();
		await pAddPrepMonsters(this._api, mon, {qty: A.qty, hpMode: A.hpMode});
	}

	async _pAddPc (members, opts) {
		this.close();
		await pAddPartyMembers(this._api, members, opts);
	}

	_render () {
		const A = this._A;
		const head = h("div.ewc-dialog__head", null,
			h("div", null,
				h("h2.ewc-dialog__title", {id: "ewc-add-title"}, "Add to the fight"),
				h("p.ewc-muted.ewc-add__sub", null, "New creatures join their type's group and get rolled initiative."),
			),
			h("div.ewc-add__headr", null,
				seg({
					label: "Add from",
					key: "add-tab",
					value: A.tab,
					items: [{id: "bestiary", label: "Bestiary"}, {id: "party", label: "Party member"}],
					onPick: id => {
						A.tab = id;
						if (id === "party") this._pLoadSaved();
						this._render();
					},
				}),
				h("button.ewc-btn.ewc-btn--icon", {type: "button", "aria-label": "Close", title: "Close (Esc)", dataset: {ewcFk: "add-close"}, onclick: () => this.close()}, "×"),
			),
		);
		const [body, foot] = A.tab === "bestiary" ? this._renderBestiary() : this._renderParty();
		replaceKeepingFocus(this._dlg, [head, h("div.ewc-add__body", null, body), h("div.ewc-add__foot", null, foot)]);
		const selRow = this._dlg.querySelector(".ewc-add__row[aria-selected=true]");
		if (selRow && this._lastSel !== A.sel) {
			selRow.scrollIntoView({block: "nearest"});
			this._lastSel = A.sel;
		}
	}

	_renderBestiary () {
		const A = this._A;
		const api = this._api;
		if (this._loadError) return [h("p.ewc-error", {role: "alert"}, `Could not load the bestiary: ${this._loadError}.`), null];
		const {rows, total} = this._getResults();
		const here = new Map();
		api.getState().instances.forEach(it => { if (it.kind !== "party") here.set(getMonKey(it.monster), (here.get(getMonKey(it.monster)) || 0) + 1); });
		const mon = this._getSelected(rows);
		const filters = h("div.ewc-add__filters", null,
			input({key: "add-q", value: A.q, type: "search", placeholder: this._monsters ? `Search ${this._monsters.length.toLocaleString()} monsters — name or type` : "Loading the bestiary…", ariaLabel: "Search the bestiary", onInput: value => { A.q = value; A.sel = null; this._render(); }}),
			h("select.ewc-input.ewc-input--sm", {"aria-label": "Challenge rating", dataset: {ewcFk: "add-cr"}, onchange: evt => { A.band = evt.target.value; A.sel = null; this._render(); }},
				PREP_CR_BANDS.map(it => h("option", {value: it.id, selected: it.id === A.band}, it.label))),
			h("select.ewc-input.ewc-input--sm", {"aria-label": "Creature type", dataset: {ewcFk: "add-type"}, onchange: evt => { A.type = evt.target.value; A.sel = null; this._render(); }},
				h("option", {value: "", selected: !A.type}, "Any type"),
				(_types || []).map(t => h("option", {value: t, selected: t === A.type}, t.toTitleCase()))),
		);
		const searchEle = filters.querySelector("[data-ewc-fk=add-q]");
		searchEle.setAttribute("role", "combobox");
		searchEle.setAttribute("aria-controls", "ewc-add-list");
		searchEle.setAttribute("aria-expanded", "true");
		searchEle.setAttribute("aria-autocomplete", "list");
		const selIx = rows.findIndex(it => getMonKey(it.mon) === A.sel);
		if (selIx >= 0) searchEle.setAttribute("aria-activedescendant", `ewc-add-opt-${selIx}`);
		const list = !this._monsters
			? h("p.ewc-muted.ewc-add__empty", {role: "status"}, "Loading every monster on the site…")
			: h("div.ewc-add__list", {id: "ewc-add-list", role: "listbox", "aria-label": "Monsters"},
				rows.length
					? rows.map(({mon: m}, ix) => {
						const key = getMonKey(m);
						const count = here.get(key) || 0;
						const name = h("span.ewc-add__name", null, m.name);
						api.hover.bindLink(name, {page: UrlUtil.PG_BESTIARY, source: m.source, hash: getMonHash(m)});
						return h("button.ewc-add__row", {
							type: "button",
							role: "option",
							id: `ewc-add-opt-${ix}`,
							tabindex: "-1",
							"aria-selected": `${key === A.sel}`,
							dataset: {ewcAddRow: key},
							onclick: evt => {
								if (A.sel === key && evt.detail === 2) return this._pAdd();
								A.sel = key;
								this._render();
							},
						},
						h("span.ewc-add__n", null, name, h("small.ewc-add__src", null, ` ${Parser.sourceJsonToAbv(m.source)}`), count ? h("small.ewc-add__in", null, `in fight ×${count}`) : null),
						h("span.ewc-add__m", null, getPrepMonsterType(m).toTitleCase()),
						h("span.ewc-add__m", null, fmtPrepCr(getPrepCrText(m)) || "—"),
						h("span.ewc-add__m", null, `${getHpText(m)}`),
						);
					})
					: h("p.ewc-muted.ewc-add__empty", null, "No monsters match — try fewer filters."));
		const body = [
			filters,
			h("div.ewc-add__row.ewc-add__row--head", {"aria-hidden": "true"},
				h("span.ewc-add__n.ewc-muted", null, this._monsters ? `${plural(total, "result")}${total > rows.length ? ` · showing ${rows.length}` : ""}` : ""),
				h("span.ewc-add__m", null, "Type"), h("span.ewc-add__m", null, "CR"), h("span.ewc-add__m", null, "HP"),
			),
			list,
		];
		const setQty = value => {
			A.qty = clampPrepQuantity(value);
			const go = this._dlg.querySelector("[data-ewc-fk=add-go]");
			if (go) go.firstChild.textContent = `Add ${A.qty > 1 ? `${A.qty} ` : ""}`;
		};
		const qty = input({key: "add-qty", value: `${A.qty}`, isNum: true, isSm: true, ariaLabel: "Quantity", onInput: setQty, onChange: () => this._render()});
		const foot = mon
			? [
				h("span.ewc-add__sum", null, h("b", null, mon.name), ` · AC ${getAcText(mon)} · ${getHpText(mon)} HP${mon.hp?.formula ? ` (${mon.hp.formula})` : ""}`),
				h("span.ewc-add__qty", {role: "group", "aria-label": "Quantity"},
					h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {type: "button", "aria-label": "One fewer", disabled: A.qty <= 1, dataset: {ewcFk: "add-qty-dn"}, onclick: () => { A.qty = clampPrepQuantity(A.qty - 1); this._render(); }}, "−"),
					qty,
					h("button.ewc-btn.ewc-btn--sm.ewc-btn--ghost", {type: "button", "aria-label": "One more", disabled: A.qty >= PREP_MAX_QUANTITY, dataset: {ewcFk: "add-qty-up"}, onclick: () => { A.qty = clampPrepQuantity(A.qty + 1); this._render(); }}, "+"),
				),
				seg({label: "Hit points", key: "add-hp", value: A.hpMode, items: [{id: "average", label: "Average HP"}, {id: "rolled", label: "Rolled", disabled: !mon.hp?.formula}], onPick: id => { A.hpMode = id; this._render(); }}),
				btn(`Add ${A.qty > 1 ? `${A.qty} ` : ""}`, () => this._pAdd(), {key: "add-go", kind: "primary", extra: kbd(["↵"])}),
			]
			: [h("span.ewc-add__sum.ewc-muted", null, this._monsters ? "Pick a monster" : "")];
		return [body, foot];
	}

	_renderParty () {
		const A = this._A;
		const state = this._api.getState();
		const have = new Set(state.instances.map(it => it.party?.characterId).filter(Boolean));
		let saved;
		if (A.saved === "loading" || A.saved == null) saved = h("p.ewc-muted", {role: "status"}, "Loading saved characters…");
		else if (A.saved.error) saved = h("p.ewc-error", null, `Could not read saved characters: ${A.saved.error}.`);
		else if (!A.saved.length) saved = h("p.ewc-muted", null, "No saved characters yet — characters saved in the Character Sheet appear here.");
		else {
			saved = h("div.ewc-add__pcs", null, A.saved.map(row => {
				let stats = null;
				try { stats = getEncounterPartyStatsFromCharacter(row.character); } catch (e) { /* unreadable: shown disabled */ }
				const isIn = row.characterId && have.has(row.characterId);
				const approx = new Set(stats?.approximate || []);
				const n = (key, text) => approx.has(key) ? h("span.ewc-add__approx", {title: "Approximate — worked out from the saved sheet"}, `${text}≈`) : text;
				return h("button.ewc-add__pc", {
					type: "button",
					disabled: !stats || isIn,
					dataset: {ewcFk: `add-pc-${row.characterId || row.label}`, ewcAddPc: row.characterId || row.label},
					onclick: () => this._pAddPc([stats], {isApprox: approx.size > 0}),
				},
				h("b", null, row.label),
				stats
					? h("small", null, n("ac", `AC ${stats.ac}`), ` · ${stats.hpMax} HP · `, n("initBonus", `init ${stats.initBonus >= 0 ? "+" : ""}${stats.initBonus}`), " · ", n("passive", `passive ${stats.passive}`), isIn ? " · already in the fight" : "")
					: h("small", null, "This saved character can't be read."));
			}));
		}
		const set = key => value => { A.pc[key] = value; A.pcError = null; };
		const submit = () => {
			const result = validatePrepManualPc(A.pc);
			if (result.error) { A.pcError = result.error; this._render(); return; }
			A.pc = {...PC_DEFAULTS};
			this._pAddPc([result.member]);
		};
		const onKeydown = evt => { if (evt.key === "Enter") { evt.preventDefault(); submit(); } };
		const body = [
			lbl("Saved characters"),
			saved,
			h("p.ewc-muted.ewc-prep__tip", null, "≈ marks numbers worked out from the sheet — check them against the player's."),
			lbl("Quick player character"),
			h("div.ewc-add__qpc", null,
				field("Name", input({key: "pc-name", value: A.pc.name, placeholder: "e.g. Rook (Rogue 5)", onInput: set("name"), onKeydown})),
				field("AC", input({key: "pc-ac", value: A.pc.ac, isNum: true, onInput: set("ac"), onKeydown})),
				field("Max HP", input({key: "pc-hp", value: A.pc.hp, isNum: true, onInput: set("hp"), onKeydown})),
				field("Init bonus", input({key: "pc-init", value: A.pc.init, isNum: true, onInput: set("init"), onKeydown})),
				field("Passive Perc.", input({key: "pc-passive", value: A.pc.passive, isNum: true, onInput: set("passive"), onKeydown})),
			),
			A.pcError ? h("p.ewc-error", {role: "alert"}, A.pcError) : null,
		];
		const foot = [
			h("span.ewc-add__sum.ewc-muted", null, "Initiative is rolled for them — click their number to type the real roll."),
			btn("Add player", submit, {key: "pc-go", kind: "primary"}),
		];
		return [body, foot];
	}
}
