#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * NPC spawn engine — build importable 5etools character-sheet NPCs through the
 * REAL character sheet + its spawn engine, add named artifacts + magic items,
 * and write native `state.toJson()` files that re-import cleanly.
 *
 * This file is CONSTANT machinery. The per-batch character data (SPECS +
 * LOADOUTS) lives in a separate ES module you point at with --batch. See
 * references/spec-format.md + references/magic-items.md, or copy
 * assets/npc-batch.template.mjs to start.
 *
 * Usage:
 *   node spawn-npcs.mjs --batch <batch.mjs> [--only Name1,Name2]
 *                       [--repo <repo-root>] [--out <dir>]
 *
 *   --batch  ES module exporting `SPECS` (required) and `LOADOUTS` (optional).
 *   --only   Comma-separated subset of SPECS keys (default: all).
 *   --repo   5etools repo root that contains charactersheet.html
 *            (default: $NPC_REPO or the current working directory).
 *   --out    Output directory (default: $NPC_OUT or <repo>/npc-exports).
 */
import {chromium} from "playwright";
import {spawn} from "child_process";
import fs from "fs";
import path from "path";
import {pathToFileURL} from "url";

const arg = (name) => {
	const eq = process.argv.find(a => a.startsWith(`--${name}=`));
	if (eq) return eq.split("=").slice(1).join("=");
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? (process.argv[i + 1] || "") : "";
};

const REPO = path.resolve(arg("repo") || process.env.NPC_REPO || process.cwd());
const BATCH = arg("batch");
const OUT_DIR = path.resolve(arg("out") || process.env.NPC_OUT || path.join(REPO, "npc-exports"));
const PORT = Number(process.env.SPAWN_PORT || 8080);
const BASE = `http://localhost:${PORT}`;

if (!fs.existsSync(path.join(REPO, "charactersheet.html"))) {
	console.error(`✗ --repo "${REPO}" has no charactersheet.html. Pass --repo <5etools-repo-root> or run from the repo root.`);
	process.exit(2);
}
if (!BATCH || !fs.existsSync(path.resolve(BATCH))) {
	console.error(`✗ --batch <file.mjs> is required and must exist. Got: ${BATCH || "(none)"}`);
	process.exit(2);
}

// ── Server bootstrap ───────────────────────────────────────────────────────
async function isServerUp () {
	try {
		const res = await fetch(`${BASE}/charactersheet.html`, {method: "HEAD"});
		return res.ok;
	} catch (e) { return false; }
}
async function ensureServer () {
	if (await isServerUp()) return null;
	const proc = spawn("npx", ["http-server", "-p", String(PORT), "-c-1", "--silent", "."], {cwd: REPO, stdio: "ignore", detached: false});
	for (let i = 0; i < 80; ++i) {
		await new Promise(r => setTimeout(r, 500));
		if (await isServerUp()) return proc;
	}
	proc.kill();
	throw new Error(`Static server did not come up on ${BASE}`);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main () {
	const batchMod = await import(pathToFileURL(path.resolve(BATCH)).href);
	const SPECS = batchMod.SPECS || batchMod.default?.SPECS;
	const LOADOUTS = batchMod.LOADOUTS || batchMod.default?.LOADOUTS || {};
	if (!SPECS || !Object.keys(SPECS).length) {
		console.error(`✗ batch "${BATCH}" must export a non-empty SPECS object.`);
		process.exit(2);
	}

	const onlyArg = arg("only");
	const only = onlyArg ? onlyArg.split(",").map(s => s.trim()) : Object.keys(SPECS);

	// Derive the homebrew content THIS batch depends on, so the readiness wait is
	// generic: every referenced subclass, plus at least one resolvable candidate
	// per loadout entry. Homebrew items (named artifacts, Ioun-stone docs) load
	// with the homebrew set, so item-resolvability doubles as a "homebrew ready"
	// signal without hardcoding any names.
	const requiredSubclasses = [];
	const loadoutCandidateSets = [];
	for (const key of only) {
		const spec = SPECS[key];
		if (!spec) { console.error(`✗ unknown --only name: ${key}`); process.exit(2); }
		for (const c of spec.classes || []) {
			if (c.subclass) requiredSubclasses.push({className: c.name, subclass: c.subclass});
		}
		for (const entry of (LOADOUTS[key] || [])) {
			loadoutCandidateSets.push((entry.candidates || []).map(cd => cd.name));
		}
	}

	fs.mkdirSync(OUT_DIR, {recursive: true});
	const server = await ensureServer();
	const browser = await chromium.launch();
	const results = [];
	try {
		const page = await browser.newPage();
		page.on("pageerror", e => console.error(`[page] ${e.message}`));
		console.error("→ loading charactersheet.html (auto-loading full homebrew set, may take a minute)…");
		await page.goto(`${BASE}/charactersheet.html`, {waitUntil: "domcontentloaded"});
		await page.waitForFunction(() => !!globalThis.charSheet?.spawn, null, {timeout: 180_000});

		// Wait until every subclass this batch references is registered AND every
		// loadout entry has at least one resolvable catalog item.
		await page.waitForFunction(({requiredSubclasses, loadoutCandidateSets}) => {
			const cs = globalThis.charSheet;
			if (!cs?.getClasses || !cs.spawn) return false;
			const classes = cs.getClasses();
			if (!classes || !classes.length) return false;
			const hasSub = ({className, subclass}) => {
				const c = classes.find(x => x.name === className);
				return c && (c.subclasses || []).some(s => s.name === subclass || s.shortName === subclass);
			};
			if (!requiredSubclasses.every(hasSub)) return false;
			const items = cs.getItems ? cs.getItems() : [];
			const itemPresent = (nm) => items.some(i => i.name === nm);
			return loadoutCandidateSets.every(set => !set.length || set.some(itemPresent));
		}, {requiredSubclasses, loadoutCandidateSets}, {timeout: 180_000, polling: 1000});
		console.error("✓ homebrew loaded; required subclasses + items resolved.");

		for (const key of only) {
			const spec = SPECS[key];
			const loadout = LOADOUTS[key] || [];
			console.error(`\n── Spawning ${key} …`);
			const result = await page.evaluate(async ({spec, loadout, key}) => {
				const cs = globalThis.charSheet;
				const log = [];

				// Instrument the picker to capture the exact section label (key) and the
				// verbatim candidate labels for every control, so we can steer choices
				// with the real strings rather than guesses.
				const Picker = globalThis.CharacterSheetSpawnPicker;
				globalThis.__pickLog = [];
				if (Picker && !Picker.__instrumented) {
					Picker.__instrumented = true;
					const orig = Picker.prototype.pickMany;
					Picker.prototype.pickMany = function (opts) {
						try {
							const nameFn = opts.nameOf || ((o) => (typeof o === "string" ? o : o?.name));
							globalThis.__pickLog.push({
								bucket: opts.bucket,
								key: opts.key,
								kind: opts.kind,
								count: opts.count,
								candidates: (opts.options || []).map((o) => { try { return nameFn(o); } catch (e) { return String(o); } }),
							});
						} catch (e) { /* never let instrumentation break a spawn */ }
						// Feats are placed exclusively by the feat-priming wrapper below (it
						// types into the search box and clicks the real row). The generic
						// autofill must NEVER auto-pick a feat: after a pick the picker
						// re-renders the option list back to the unselected alphabetical
						// top-50, which the autofill would otherwise "fill" with junk,
						// overwriting the intended feat. Returning [] leaves feats to us.
						try {
							const R = globalThis.CharacterSheetSpawnResolve;
							// Epic Boons live in a dedicated "Epic Boon Selection" bucket and
							// are always placed by the priming wrapper below (the L19 selector
							// filters the feat list to category==="EB").
							if (R && R.namesMatch(opts.key, "Epic Boon Selection")) return [];
							// "Feat Selection" is overloaded: the ASI/level feat selectors use
							// it (the full alphabetical feat list, which the priming wrapper
							// owns), but some homebrew classes ALSO label a specialised picker
							// "Feat Selection" — e.g. TGTT Paladin renders its Fighting Style
							// choice this way (whereas TGTT Fighter labels it "Fighting
							// Style:"). Only defer to the priming wrapper for the real ASI feat
							// list; a fighting-style-style short list must be auto-picked here or
							// the "classfeats" step stalls with an empty selector. The full feat
							// list is unmistakable: it always offers "Ability Score Improvement"
							// as an option, which a restricted list never does.
							if (R && R.namesMatch(opts.key, "Feat Selection")) {
								const names = (opts.options || []).map((o) => (typeof o === "string" ? o : o?.name) || "");
								const isFullFeatList = names.some((n) => /^Ability Score Improvement/i.test(n));
								if (isFullFeatList) return [];
							}
						} catch (e) { /* fall through to normal pick */ }
						return orig.call(this, opts);
					};
				}

				// The Quick Build feat list is search-filtered and capped at 50 rows, so
				// a target feat like "War Caster" is never rendered for the autofill to
				// click. Additionally, most ASI levels default to the "+2 ability" radio
				// and only reveal the feat picker once "Take a Feat" is chosen (the L4
				// TGTT "ASI + Feat" level shows both). Wrap the autofill so that, before
				// its normal pass, it (1) flips every ASI level to Feat mode and (2) types
				// each desired feat into the search box and clicks the real row — running
				// the wizard's own handlers, exactly as a player would.
				const AF = globalThis.CharacterSheetSpawnAutoFill;
				const Resolve = globalThis.CharacterSheetSpawnResolve;
				if (AF && Resolve && !AF.__featPrimePatched) {
					AF.__featPrimePatched = true;
					const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
					const origRun = AF.prototype.run;
					AF.prototype.run = async function (opts) {
						try {
							const picker = this._picker;
							const root = this._root;
							const self = this;
							// Place every desired override from `bucketKey` (a search-filtered,
							// 50-row-capped feat/boon selector) by typing the name and clicking
							// the real row. `wantEpic` decides which ASI levels this pass may
							// flip to reveal a fresh selector: normal feats flip "Take a Feat"
							// levels; Epic Boons flip only the L19 "Take a Boon" level. Keeping
							// the two passes from flipping each other's radios is what prevents
							// a feat chase from opening an empty boon selector (or vice versa),
							// which would leave an unfilled selector and stall the ASI step.
							const placeFrom = async (bucketKey, wantEpic) => {
								let guard = 0;
								while (guard++ < 60) {
									const pending = (picker._getOverrides("options", bucketKey) || [])
										.filter((o) => !picker._consumed.has(o.token));
									if (!pending.length) break; // all placed; leave remaining levels as ASI

									// (A) Prefer filling an already-revealed, unfilled selector.
									let acted = false;
									for (const c of root.querySelectorAll(".charsheet__quickbuild-feat-select")) {
										if (c.querySelector(".charsheet__quickbuild-option.selected")) continue;
										const search = c.querySelector("input");
										const optRow = c.querySelector(".charsheet__quickbuild-option");
										const listDiv = optRow ? optRow.parentElement : null;
										if (!search || !listDiv) continue;
										const key = AF._sectionLabel(listDiv);
										if (!Resolve.namesMatch(key, bucketKey)) continue; // skip other selectors (feats vs boons vs Fighting Style)
										const target = pending[0];
										search.value = target.name;
										search.dispatchEvent(new Event("input", {bubbles: true}));
										await sleep(200); // search render is debounced ~100ms
										const row = [...listDiv.querySelectorAll(".charsheet__quickbuild-option")]
											.find((el) => !el.classList.contains("selected")
												&& !AF._isOptionLocked(el)
												&& Resolve.namesMatch(AF._optionName(el), target.name));
										if (!row) continue;
										row.click();
										picker._consumed.add(target.token);
										if (self._report && self._report.record) {
											self._report.record({level: self._level, kind: "option", key, chosen: AF._optionName(row), from: "spec"});
										}
										acted = true;
										await sleep(60);
										break;
									}
									if (acted) continue;

									// (B) No unfilled selector yet — reveal ONE by flipping a single
									// ASI level to Feat/Boon mode, then loop to fill it. An Epic Boon
									// level's radio label reads "Take a Boon"; a normal feat level's
									// reads "Take a Feat". Only flip the kind this pass owns.
									let flipped = false;
									for (const radio of root.querySelectorAll("input[type=\"radio\"][value=\"feat\"]")) {
										if (!/qb-asi-mode/.test(radio.name || "")) continue;
										if (radio.checked) continue;
										const lbl = radio.closest("label");
										const isBoonRadio = /\bboon\b/i.test(lbl ? (lbl.textContent || "") : "");
										if (isBoonRadio !== wantEpic) continue;
										radio.click();
										flipped = true;
										break;
									}
									if (flipped) { await sleep(60); continue; }
									break; // still pending but nothing left to flip/fill; give up
								}
							};

							await placeFrom("Feat Selection", false);
							await placeFrom("Epic Boon Selection", true);
						} catch (e) { /* priming is best-effort; fall through to normal autofill */ }
						return origRun.call(this, opts);
					};
				}

				try {
					const report = await cs.spawn(spec, {save: false});
					const state = cs._state;

					// Resolve + add items.
					const items = cs.getItems();
					const PREF = ["TGTT", "XDMG", "DMG", "XPHB", "PHB"];
					const resolve = (cand) => {
						for (const c of cand) {
							const bySrc = items.find(i => i.name === c.name && (!c.source || i.source === c.source));
							if (bySrc) return bySrc;
						}
						for (const c of cand) {
							const byName = items.filter(i => i.name === c.name);
							if (byName.length) {
								byName.sort((a, b) => (PREF.indexOf(a.source) + 1 || 99) - (PREF.indexOf(b.source) + 1 || 99));
								return byName[0];
							}
						}
						return null;
					};
					const itemsAdded = [];
					const invMod = cs._inventory;
					for (const entry of loadout) {
						// `entry.custom` is a raw, hand-authored item object (e.g. a fused
						// homebrew weapon that exists in no catalog). Use it verbatim and skip
						// resolution; it still flows through the same _addItem enrichment below,
						// so bonusWeapon/armor fields are parsed identically to catalog items.
						const it = entry.custom || resolve(entry.candidates);
						if (!it) { log.push(`ITEM NOT FOUND: ${(entry.candidates || []).map(c => c.name).join(" | ")}`); continue; }
						// Route through the inventory module's _addItem enrichment so bonus
						// strings ("+2") are parsed to numbers and armor fields (ac, armorType,
						// dexterityMax, stealth) are populated. Adding raw catalog items via
						// state.addItem stores unparsed "+2" strings, which makes AC math
						// concatenate ("0+2") and getArmorClass return NaN.
						if (invMod && typeof invMod._addItem === "function") {
							invMod._addItem(it);
							const w = state._data.inventory[state._data.inventory.length - 1];
							if (w) {
								w.equipped = !!entry.equip;
								w.attuned = !!entry.attune;
								w.quantity = entry.qty || 1;
								// Pre-load a spell-storing item (e.g. Ring of Spell Storing) with a
								// reserve of *castable* spells. `_addItem` hardcodes `storedSpells: []`
								// and derives `maxSpellLevels` from the item name, so a real "Ring of
								// Spell Storing" already reports a 5-level capacity on this wrapper —
								// we only need to populate the reserve so the sheet's stored-spell UI
								// (state.getStoredSpells/castStoredSpell) can list and cast them. A
								// prose-only "currently holds …" description does nothing here; the
								// structured array is the single source of truth. Entry shape:
								// {spell, level, saveDc, attackBonus, ability, casterName}.
								if (Array.isArray(entry.storedSpells) && entry.storedSpells.length) {
									if (!w.item.maxSpellLevels) w.item.maxSpellLevels = entry.maxSpellLevels || 5;
									w.item.storedSpells = entry.storedSpells.map(s => ({
										spell: s.spell,
										level: s.level ?? 1,
										saveDc: s.saveDc ?? 13,
										attackBonus: s.attackBonus ?? 5,
										ability: s.ability || "int",
										casterName: s.casterName || "",
									}));
									log.push(`stored spells → ${it.name}: ${entry.storedSpells.map(s => `${s.spell} (L${s.level})`).join(", ")}`);
								}
							}
						} else {
							state.addItem(it, entry.qty || 1, !!entry.equip, !!entry.attune);
						}
						itemsAdded.push(`${it.name}|${it.source}${entry.attune ? " (attuned)" : ""}${entry.equip ? " [equipped]" : ""}${entry.qty > 1 ? ` x${entry.qty}` : ""}`);
					}

					// Recompute item-derived state (armor AC, AC bonuses, defenses, senses, and
					// ability overrides such as Belt of Giant Strength STR). _addItem enriches the
					// item fields but leaves the aggregate derive step (which reads the now-correct
					// equipped/attuned flags we just set) to this call.
					try { cs._inventory?.syncItemDerivedState?.(); } catch (e) { log.push(`item derive failed: ${e.message}`); }

					// The sheet parses AC-setting formulas ("AC equals 15 + your Dexterity
					// modifier") from FEATURE entries into _data.acFormulas, but never from ITEM
					// entries — so items like the Robe of the Archmagi that set unarmored AC are
					// silently ignored by getAc(). Mirror the feature path here for equipped,
					// attuned items: parse their entries with the sheet's own FeatureModifierParser
					// and push any acFormula into _data.acFormulas with sourceType:"item" (which
					// survives the classFeature-only reapply filter and toJson serialization). Clear
					// the "aren't wearing armor" conditional — getAc() only consults formulas on the
					// unarmored branch, and _getBestAcFormula skips any formula with a conditional.
					try {
						const Parser = globalThis.FeatureModifierParser;
						if (Parser?.parseModifiers) {
							if (!Array.isArray(state._data.acFormulas)) state._data.acFormulas = [];
							// Recursive entry flattener: handles strings, nested `entries`, list
							// `items`, and single `entry` — the Robe's AC line lives inside a
							// {type:"list", items:[...]} block that a shallow join would drop.
							const flatten = (arr) => (arr || []).map(e => {
								if (typeof e === "string") return e;
								if (!e) return "";
								let s = "";
								if (e.entries) s += ` ${flatten(e.entries)}`;
								if (e.items) s += ` ${flatten(e.items)}`;
								if (e.entry) s += ` ${typeof e.entry === "string" ? e.entry : flatten([e.entry])}`;
								return s;
							}).join(" ");
							for (const w of state._data.inventory) {
								const itm = w.item || w;
								if (!w.equipped) continue;
								if ((itm.requiresAttunement || itm.reqAttune) && !w.attuned) continue;
								// Re-hydrate entries from the catalog when the stored item lacks them.
								let entries = itm.entries;
								if ((!entries || !entries.length) && cs._inventory?._getEffectiveItemEntries) {
									try { entries = cs._inventory._getEffectiveItemEntries(itm); } catch { /* ignore */ }
								}
								const text = flatten(entries || [])
									// Strip {@tag display|extra} → display. Anchor the tag name with
									// \w+ (not [^}]+) so multi-word display text like
									// "{@variantrule Armor Class|XPHB}" yields "Armor Class", not "Class".
									.replace(/\{@\w+\s+([^|}]+)(?:\|[^}]*)?\}/g, "$1")
									.replace(/<[^>]*>/g, " ")
									// Normalize "15 plus your Dexterity" → "15 + your Dexterity" so the
									// sheet's Dex-adding AC pattern (which requires a literal +) matches
									// the XDMG phrasing.
									.replace(/(\d+)\s+plus\s+(your\s+)?(dexterity|dex)\b/gi, "$1 + $2$3")
									.replace(/\s+/g, " ")
									.trim();
								if (!text) continue;
								const mods = Parser.parseModifiers(text, itm.name || "Item");
								for (const m of mods) {
									if (m.type !== "acFormula" || !m.acFormula) continue;
									if (state._data.acFormulas.some(f => f.sourceName === (itm.name || "Item") && f.base === m.acFormula.base && f.addDex === m.acFormula.addDex)) continue;
									state._data.acFormulas.push({
										...m.acFormula,
										sourceName: itm.name || "Item",
										sourceType: "item",
										conditional: null,
									});
									log.push(`item AC formula: ${itm.name} → ${m.acFormula.base}${m.acFormula.addDex ? "+DEX" : ""}`);
								}
							}
						}
					} catch (e) { log.push(`item AC formula parse failed: ${e.message}`); }

					// Prepared-spell curation for prepared casters: the spawn engine adds the
					// curated `choices.spellbook` list to the spellbook (known) but auto-prepares
					// its own default set (which skews low-level and includes filler spells). For a
					// strong NPC we want the curated control/support list PREPARED. Prepare every
					// spellbook-choice spell (adding it if the engine didn't), then unprepare only
					// generic "Wizard Spellbook" filler that isn't in the curated list — subclass /
					// feat / racial always-prepared grants (e.g. Daemonologist Bane/Fear) are left
					// untouched so they stay available for free.
					try {
						const prep = spec.choices?.spellbook;
						if (Array.isArray(prep) && prep.length && state.setSpellPrepared && state.getSpells) {
							const norm = s => String(s || "").toLowerCase().replace(/[’]/g, "'").trim();
							const wanted = new Set(prep.map(norm));
							for (const name of prep) {
								let sp = state.getSpells().find(s => s.level > 0 && norm(s.name) === norm(name));
								if (!sp && state.addSpell) {
									state.addSpell({name, inSpellbook: true, sourceFeature: "Wizard Spellbook"}, true);
									sp = state.getSpells().find(s => s.level > 0 && norm(s.name) === norm(name));
								}
								if (sp) state.setSpellPrepared(sp.id, true);
								else log.push(`prepared spell not found: ${name}`);
							}
							for (const s of state.getSpells()) {
								if (s.level === 0 || s.alwaysPrepared) continue;
								if (!/spellbook/i.test(s.sourceFeature || "")) continue; // keep subclass/feat grants
								if (s.prepared && !wanted.has(norm(s.name))) state.setSpellPrepared(s.id, false);
							}
							const prepCount = state.getSpells().filter(s => s.level > 0 && s.prepared).length;
							log.push(`prepared curated: ${prep.length} requested, ${prepCount} total prepared`);
						}
					} catch (e) { log.push(`prepared curation failed: ${e.message}`); }

					// Talna's esoteric research library: scribe extra spells into the spellbook
					// as KNOWN but UNPREPARED (added last so the prepared-curation unprepare pass
					// above never touches them). Cheap for a wizard; pure flavour + repertoire.
					try {
						const known = spec.spellbookKnown ?? spec.choices?.spellbookKnown;
						if (Array.isArray(known) && known.length && state.addSpell && state.getSpells) {
							const norm = s => String(s || "").toLowerCase().replace(/[’]/g, "'").trim();
							let added = 0;
							for (const entry of known) {
								const nm = typeof entry === "string" ? entry : entry.name;
								const src = typeof entry === "string" ? undefined : entry.source;
								if (state.getSpells().some(s => norm(s.name) === norm(nm))) continue;
								state.addSpell({name: nm, source: src, inSpellbook: true, prepared: false, sourceFeature: "Wizard Spellbook"}, false);
								if (state.getSpells().some(s => norm(s.name) === norm(nm))) added++;
								else log.push(`spellbookKnown not found: ${nm}`);
							}
							log.push(`spellbookKnown scribed: ${added}/${known.length}`);
						}
					} catch (e) { log.push(`spellbookKnown failed: ${e.message}`); }

					// Generic prepared-caster curation (Cleric / Druid / Paladin / Bard). Unlike the
					// Wizard path this does not gate on a "Wizard Spellbook" sourceFeature: it simply
					// prepares each curated spell (adding it as a class spell if the engine didn't),
					// giving the NPC a strong, coherent day-one loadout. Domain / oath / subclass
					// always-prepared grants are left untouched (they're already free).
					try {
						const prep = spec.prepare;
						if (Array.isArray(prep) && prep.length && state.setSpellPrepared && state.getSpells) {
							const norm = s => String(s || "").toLowerCase().replace(/[’]/g, "'").trim();
							const primary = (state.getClasses()[0] || {}).name || null;
							let ok = 0;
							for (const name of prep) {
								let sp = state.getSpells().find(s => s.level > 0 && norm(s.name) === norm(name));
								if (!sp && state.addSpell) {
									state.addSpell({name, prepared: true, sourceClass: primary}, true);
									sp = state.getSpells().find(s => s.level > 0 && norm(s.name) === norm(name));
								}
								if (sp) { state.setSpellPrepared(sp.id, true); ok++; } else log.push(`prepare not found: ${name}`);
							}
							log.push(`prepare curated: ${ok}/${prep.length}`);
						}
					} catch (e) { log.push(`prepare curation failed: ${e.message}`); }

					// Divine favor: set god → level → boon choices (order matters so the Apostle
					// ability-score boost exists to receive its str/cha choice). Catalog is
					// auto-loaded from the homebrew divineFavor entries at sheet boot.
					try {
						if (spec.favor && state.setDivineFavorGod) {
							state.setDivineFavorGod(spec.favor.god);
							if (state.setDivineFavorLevel) state.setDivineFavorLevel(spec.favor.level);
							for (const [k, v] of Object.entries(spec.favor.boonChoices || {})) {
								if (state.setDivineFavorBoonChoice) state.setDivineFavorBoonChoice(k, v);
							}
							log.push(`divine favor: ${spec.favor.god} @${spec.favor.level}${Object.keys(spec.favor.boonChoices || {}).length ? ` (${JSON.stringify(spec.favor.boonChoices)})` : ""}`);
						}
					} catch (e) { log.push(`divine favor failed: ${e.message}`); }

					// Grafted abilities (e.g. Lorian's level-2 Rogue kit on a full Cleric): extra
					// skill proficiencies / expertise written straight to state, plus documented
					// custom abilities (Cunning Action, Sneak Attack) for anything the class engine
					// won't wire without a real class leg.
					try {
						const graft = spec.graft;
						if (graft) {
							if (graft.skills && state.setSkillProficiency) {
								for (const s of graft.skills.prof || []) state.setSkillProficiency(s, 1);
								for (const s of graft.skills.expertise || []) state.setSkillProficiency(s, 2);
								log.push(`graft skills: prof[${(graft.skills.prof || []).join(",")}] exp[${(graft.skills.expertise || []).join(",")}]`);
							}
							if (Array.isArray(graft.customAbilities) && state.addCustomAbility) {
								for (const ca of graft.customAbilities) state.addCustomAbility(ca);
								log.push(`graft customAbilities: ${graft.customAbilities.map(c => c.name).join(", ")}`);
							}
							// Signature fixed skill totals (e.g. Juen's supernatural senses:
							// "+40 Perception, passive 50"). For each skill we set its flat custom
							// modifier so the *computed* total (ability + prof + expertise + item +
							// states + custom) lands exactly on the requested number, regardless of
							// how the other contributions stack. This is the sanctioned "you can
							// manually set" channel and survives re-import (customModifiers.skills
							// is read by getSkillMod()).
							if (graft.skillTotals && state.getSkillMod && state.getSkillCustomMod && state.setCustomModifier) {
								for (const [skill, target] of Object.entries(graft.skillTotals)) {
									const cur = state.getSkillMod(skill);
									const curCustom = state.getSkillCustomMod(skill);
									const next = curCustom + (target - cur);
									state.setCustomModifier(`skill:${skill}`, next);
									log.push(`graft skillTotal: ${skill} ${cur}→${state.getSkillMod(skill)} (custom ${curCustom}→${next})`);
								}
							}
							// A flat proficiency-bonus bump. Some items grant "+1 proficiency
							// bonus" (e.g. the DMG/XDMG `Ioun Stone, Mastery`), but that effect
							// is prose-only with no structured field, so the sheet can't apply
							// it from the item on import. getProficiencyBonus() sums
							// customModifiers.proficiencyBonus, so setting it here makes the +1
							// land deterministically — attach it to the NPC that carries the item.
							if (typeof graft.profBonus === "number" && state.setCustomModifier) {
								state.setCustomModifier("proficiencyBonus", graft.profBonus);
								log.push(`graft profBonus: +${graft.profBonus}`);
							}
							// Flat, deterministic ability-score bumps written straight to
							// customModifiers.abilityScores, which getAbilityScore() sums as a
							// "featureBonus". Use this to bake in a permanent stat gain that has
							// no structured item to carry it — e.g. an ability increase a player
							// wants baked into the character rather than tracked as a nonsensical
							// one-use consumable (a Tome of Clear Thought/Understanding sitting in
							// the pack). It survives export/import because customModifiers is
							// serialized, and unlike bumping the spec's base score it does NOT get
							// overridden by the builder's auto-ASI allocation. Shape: {int: 2, …}.
							if (graft.abilityScores && state._data?.customModifiers) {
								const tgt = state._data.customModifiers.abilityScores
									|| (state._data.customModifiers.abilityScores = {});
								for (const [abl, amt] of Object.entries(graft.abilityScores)) {
									tgt[abl] = (tgt[abl] || 0) + amt;
								}
								log.push(`graft abilityScores: ${Object.entries(graft.abilityScores).map(([a, v]) => `${a}+${v}`).join(", ")}`);
							}
							// Grant epic boons directly. Some classes (e.g. Talent) have no
							// epic-boon selection slot, so the normal chooser can never reach
							// these — the only way to give such an NPC a boon is to inject it.
							// addFeat derives the boon's description/uses/modifiers/spells from
							// its catalog entry AND applies any `abilityBonus` we attach, so a
							// boon whose stat increase is a {choose} block (unresolvable without
							// a UI pick) still lands deterministically when we specify which
							// ability it feeds. Shape: "Boon Name" | {name, source?, ability?}.
							if (Array.isArray(graft.boons) && state.addFeat && cs.getFeats) {
								const allFeats = cs.getFeats() || [];
								for (const bspec of graft.boons) {
									const nm = typeof bspec === "string" ? bspec : bspec.name;
									const src = typeof bspec === "string" ? null : bspec.source;
									const found = allFeats.find(f => f.name === nm && (!src || f.source === src));
									if (!found) { log.push(`graft boon NOT FOUND: ${nm}${src ? `|${src}` : ""}`); continue; }
									const featObj = {...found};
									delete featObj.ability; // drop the unresolved {choose} block
									if (bspec.ability) featObj.abilityBonus = bspec.ability;
									const ok = state.addFeat(featObj);
									log.push(`graft boon: ${nm} ${ok ? "added" : "(dup/skip)"}${bspec.ability ? ` +${JSON.stringify(bspec.ability)}` : ""}`);
								}
							}
						}
					} catch (e) { log.push(`graft failed: ${e.message}`); }

					// Feature-regranted cantrip de-dup. Some cantrips a caster "chooses"
					// are ALSO auto-granted by a feature on import (`_reconcileClassFeatures`
					// re-adds e.g. the Thaumaturge order cantrip, a Bard/Druid grant, …). The
					// spawn stores a single clean copy, but the import re-grant then makes it
					// appear twice. Removing our stored copy here means the import's own grant
					// becomes the sole copy — one entry, no duplicate. (The feature grant is
					// unconditional, so the cantrip is never lost; verified via import probe.)
					try {
						const drop = spec.regrantedCantrips;
						const sc = state._data.spellcasting;
						if (Array.isArray(drop) && drop.length && sc && Array.isArray(sc.cantripsKnown)) {
							const norm = s => String(s || "").toLowerCase().trim();
							for (const nm of drop) {
								const i = sc.cantripsKnown.findIndex(c => norm(c.name) === norm(nm));
								if (i >= 0) { sc.cantripsKnown.splice(i, 1); log.push(`regranted cantrip de-dup: dropped stored ${nm}`); }
							}
						}
					} catch (e) { log.push(`regranted-cantrip de-dup failed: ${e.message}`); }

					// Re-stamp the name (spawn may default it) and recompute.
					if (spec.name) state.setName?.(spec.name);

					const abil = {};
					for (const a of ["str", "dex", "con", "int", "wis", "cha"]) {
						abil[a] = (state.getAbilityScore ? state.getAbilityScore(a) : null);
					}
					const summary = {
						name: state.getName(),
						level: state.getTotalLevel(),
						classes: state.getClasses().map(c => `${c.name} ${c.level}${c.subclass ? ` (${c.subclass.name || c.subclass.shortName})` : ""}`),
						race: state.getRace()?.name || null,
						raceSource: state.getRace()?.source || null,
						background: state.getBackground()?.name || null,
						abilities: abil,
						hp: state.getMaxHp ? state.getMaxHp() : null,
						ac: state.getArmorClass ? state.getArmorClass() : null,
						itemsAdded,
						favor: (() => { try { return state.getDivineFavor ? state.getDivineFavor() : null; } catch (e) { return null; } })(),
						customAbilities: (() => { try { return (state._data.customAbilities || []).map(c => c.name); } catch (e) { return []; } })(),
						skillProfs: (() => { try { return {...state._data.skillProficiencies}; } catch (e) { return {}; } })(),
						cantripCount: (() => { try { return state.getSpells().filter(s => s.level === 0).length; } catch (e) { return null; } })(),
						preparedCount: (() => { try { return state.getSpells().filter(s => s.level > 0 && (s.prepared || s.alwaysPrepared)).length; } catch (e) { return null; } })(),
						knownCount: (() => { try { return state.getSpells().filter(s => s.level > 0).length; } catch (e) { return null; } })(),
					};
					return {ok: true, key, report: report.toJson(), character: state.toJson(), summary, log, pickLog: globalThis.__pickLog};
				} catch (e) {
					return {ok: false, key, error: e.message, stack: e.stack, log, pickLog: globalThis.__pickLog};
				}
			}, {spec, loadout, key});

			results.push(result);
			if (!result.ok) {
				console.error(`✗ ${key}: ${result.error}`);
				(result.log || []).forEach(l => console.error(`    ${l}`));
			} else {
				const r = result.report;
				const issues = (r.unresolved || []).length + (r.unhandledPrompts || []).length;
				console.error(`${issues ? "⚠" : "✓"} ${key} → ${result.summary.classes.join(" / ")}, ${result.summary.race} (${result.summary.raceSource})`);
				console.error(`   abil: ${JSON.stringify(result.summary.abilities)}  HP:${result.summary.hp}  AC:${result.summary.ac}`);
				console.error(`   spells: cantrips ${result.summary.cantripCount}, prepared ${result.summary.preparedCount}, known ${result.summary.knownCount}`);
				if (result.summary.favor) console.error(`   favor: ${JSON.stringify(result.summary.favor)}`);
				if ((result.summary.customAbilities || []).length) console.error(`   customAbilities: ${result.summary.customAbilities.join(", ")}`);
				console.error(`   items: ${result.summary.itemsAdded.join(", ")}`);
				(result.log || []).forEach(l => console.error(`   ${l}`));
				(r.unresolved || []).forEach(u => console.error(`    ✗ unresolved: ${u}`));
				(r.unhandledPrompts || []).forEach(u => console.error(`    ? unhandled: ${typeof u === "string" ? u : JSON.stringify(u)}`));
				(r.warnings || []).forEach(u => console.error(`    ! warn: ${typeof u === "string" ? u : JSON.stringify(u)}`));

				// Write importable native JSON + a debug bundle.
				fs.writeFileSync(path.join(OUT_DIR, `${key}.json`), JSON.stringify(result.character, null, "\t"));
				fs.writeFileSync(path.join(OUT_DIR, `${key}.report.json`), JSON.stringify({summary: result.summary, report: r}, null, "\t"));
				if (result.pickLog) fs.writeFileSync(path.join(OUT_DIR, `${key}.picklog.json`), JSON.stringify(result.pickLog, null, "\t"));
			}
		}
	} finally {
		await browser.close();
		server?.kill();
	}

	const failed = results.some(r => !r.ok);
	console.error(`\nDone. Wrote to ${OUT_DIR}`);
	process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
