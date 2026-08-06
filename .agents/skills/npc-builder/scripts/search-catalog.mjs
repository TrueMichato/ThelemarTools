#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Catalog discovery — enumerate and filter the FULL loaded catalog (official +
 * every auto-loaded homebrew: TGTT, the Moorchlyne Ioun-stone document, Grim
 * Hollow, Griffon's Saddlebag, Valda's, plus any homebrew the user dropped in)
 * the exact same way the spawn engine sees it: `charSheet.getItems()`,
 * `.getFeats()`, `.getSpells()`.
 *
 * The whole point is to STOP guessing item/feat/spell names from memory (which
 * defaults to a handful of official XDMG/DMG staples and the same three
 * half-feats) and instead pick from the deep homebrew shelves that are actually
 * loaded. Run this BEFORE writing a loadout or a feat/spell list and search by
 * theme, rarity, type, level — you will find far better, more varied options
 * than recall gives you.
 *
 * Usage:
 *   node search-catalog.mjs items  [--name <sub>] [--source <a,b>] [--type <code>]
 *                                  [--rarity <sub>] [--attune yes|no] [--limit N]
 *   node search-catalog.mjs feats  [--name <sub>] [--source <a,b>] [--prereq <sub>]
 *                                  [--noprereq] [--limit N]
 *   node search-catalog.mjs spells [--name <sub>] [--source <a,b>] [--level 0-9]
 *                                  [--school <ltr|name>] [--limit N]
 *
 * Every result ends with a by-source histogram, so you can see at a glance how much
 * homebrew exists for what you searched (if it's all DMG/XDMG, widen the search).
 *
 * Add --json to dump the full raw objects for the matches (copy exact name +
 * source for a loadout/spec). --repo defaults to cwd; must hold charactersheet.html.
 *
 * Examples:
 *   node search-catalog.mjs items --name "ioun" --source MECIounStones --limit 40
 *   node search-catalog.mjs items --name fire --rarity "very rare"
 *   node search-catalog.mjs items --type SCF --attune yes            # arcane foci
 *   node search-catalog.mjs feats --source TGTT
 *   node search-catalog.mjs spells --source GrimHollowPG24 --level 3-5
 */
import {chromium} from "playwright";
import {spawn} from "child_process";
import path from "path";

const argv = process.argv.slice(2);
const CAT = (argv[0] && !argv[0].startsWith("--")) ? argv[0] : "items";
const arg = (name) => {
	const eq = argv.find(a => a.startsWith(`--${name}=`));
	if (eq) return eq.split("=").slice(1).join("=");
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "true") : "";
};
const flag = (name) => argv.includes(`--${name}`) || arg(name) === "true";

const REPO = path.resolve(arg("repo") || process.env.NPC_REPO || process.cwd());
const PORT = Number(process.env.SPAWN_PORT || 8080);
const BASE = `http://localhost:${PORT}`;
const LIMIT = Number(arg("limit") || 200);
const AS_JSON = flag("json");

const f = {
	name: (arg("name") || "").toLowerCase(),
	source: (arg("source") || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean),
	type: (arg("type") || "").toLowerCase(),
	rarity: (arg("rarity") || "").toLowerCase(),
	attune: arg("attune").toLowerCase(), // "yes" | "no" | ""
	prereq: (arg("prereq") || "").toLowerCase(),
	noprereq: flag("noprereq"),
	level: arg("level"), // "3" | "3-5"
	school: (arg("school") || "").toLowerCase(),
};

async function isServerUp () {
	try { return (await fetch(`${BASE}/charactersheet.html`, {method: "HEAD"})).ok; } catch (e) { return false; }
}
async function ensureServer () {
	if (await isServerUp()) return null;
	const proc = spawn("npx", ["http-server", "-p", String(PORT), "-c-1", "--silent", "."], {cwd: REPO, stdio: "ignore", detached: false});
	for (let i = 0; i < 80; ++i) { await new Promise(r => setTimeout(r, 500)); if (await isServerUp()) return proc; }
	proc.kill();
	throw new Error(`Static server did not come up on ${BASE}`);
}

async function main () {
	const server = await ensureServer();
	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		page.on("pageerror", e => console.error(`[page] ${e.message}`));
		console.error("→ loading charactersheet.html (auto-loading full homebrew set, may take a minute)…");
		await page.goto(`${BASE}/charactersheet.html`, {waitUntil: "domcontentloaded"});
		await page.waitForFunction(() => !!globalThis.charSheet?.getItems, null, {timeout: 180_000});

		// Homebrew merges in asynchronously; wait until the item count stops growing
		// (a generic "everything loaded" signal that needs no hardcoded names).
		await page.waitForFunction(() => {
			const cs = globalThis.charSheet;
			const n = (cs.getItems?.() || []).length;
			globalThis.__lastN = globalThis.__lastN || {v: -1, stable: 0};
			const s = globalThis.__lastN;
			if (n > 0 && n === s.v) s.stable++; else { s.v = n; s.stable = 0; }
			return n > 500 && s.stable >= 3;
		}, null, {timeout: 180_000, polling: 1000});

		const out = await page.evaluate(({CAT, f, LIMIT, AS_JSON}) => {
			const cs = globalThis.charSheet;
			const rows = CAT === "feats" ? (cs.getFeats() || [])
				: CAT === "spells" ? (cs.getSpells() || [])
					: (cs.getItems() || []);

			const srcLc = (o) => String(o.source || "").toLowerCase();
			const nameLc = (o) => String(o.name || "").toLowerCase();
			const typeCode = (o) => String(o.type || "").split("|")[0].toLowerCase();
			const reqAttune = (o) => o.reqAttune != null && o.reqAttune !== false;
			const prereqStr = (o) => JSON.stringify(o.prerequisite || "").toLowerCase();

			let lvlMin = null; let lvlMax = null;
			if (f.level) {
				const m = String(f.level).split("-");
				lvlMin = Number(m[0]); lvlMax = Number(m[1] != null ? m[1] : m[0]);
			}
			const SCHOOL = {a: "abjuration", c: "conjuration", d: "divination", e: "enchantment", v: "evocation", i: "illusion", n: "necromancy", t: "transmutation"};

			const matches = rows.filter((o) => {
				if (f.name && !nameLc(o).includes(f.name)) return false;
				if (f.source.length && !f.source.some(s => srcLc(o).includes(s))) return false;
				if (CAT === "items") {
					if (f.type && typeCode(o) !== f.type && !typeCode(o).includes(f.type)) return false;
					if (f.rarity && !String(o.rarity || "").toLowerCase().includes(f.rarity)) return false;
					if (f.attune === "yes" && !reqAttune(o)) return false;
					if (f.attune === "no" && reqAttune(o)) return false;
				}
				if (CAT === "feats") {
					if (f.prereq && !prereqStr(o).includes(f.prereq)) return false;
					if (f.noprereq && o.prerequisite) return false;
				}
				if (CAT === "spells") {
					if (lvlMin != null && (o.level < lvlMin || o.level > lvlMax)) return false;
					if (f.school) {
						const sc = String(o.school || "").toLowerCase();
						if (sc !== f.school && (SCHOOL[sc] || sc) !== f.school && !(SCHOOL[sc] || "").includes(f.school)) return false;
					}
				}
				return true;
			});

			// Source histogram so the breadth of homebrew is visible at a glance.
			const hist = {};
			for (const o of matches) hist[o.source || "?"] = (hist[o.source || "?"] || 0) + 1;

			const fmt = (o) => {
				if (CAT === "feats") {
					const pre = o.prerequisite ? `  prereq:${JSON.stringify(o.prerequisite).replace(/[{}"[\]]/g, "").slice(0, 60)}` : "  (no prereq)";
					return `${o.name}|${o.source}${pre}`;
				}
				if (CAT === "spells") {
					return `${o.name}|${o.source}  L${o.level} ${o.school || ""}`;
				}
				const rar = o.rarity && o.rarity !== "none" ? o.rarity : "";
				const at = (o.reqAttune != null && o.reqAttune !== false) ? "attune" : "";
				return `${o.name}|${o.source}  [${String(o.type || "").split("|")[0]}]${rar ? ` ${rar}` : ""}${at ? ` · ${at}` : ""}`;
			};

			return {
				total: rows.length,
				matched: matches.length,
				hist: Object.entries(hist).sort((a, b) => b[1] - a[1]),
				lines: matches.slice(0, LIMIT).sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(fmt),
				json: AS_JSON ? matches.slice(0, LIMIT) : null,
			};
		}, {CAT, f, LIMIT, AS_JSON});

		console.error(`✓ catalog loaded: ${out.total} ${CAT} total`);
		console.log(`\n${out.matched} match${out.matched === 1 ? "" : "es"} (showing ${Math.min(out.matched, LIMIT)}):\n`);
		if (AS_JSON) { console.log(JSON.stringify(out.json, null, 2)); } else {
			for (const line of out.lines) console.log(`  ${line}`);
			console.log(`\n── by source ──`);
			for (const [src, n] of out.hist) console.log(`  ${String(n).padStart(4)}  ${src}`);
			if (out.matched > LIMIT) console.log(`\n(+${out.matched - LIMIT} more — narrow with --name/--source/--type/--rarity or raise --limit)`);
		}
	} finally {
		await browser.close();
		if (server) server.kill();
	}
}

main().catch(e => { console.error(e); process.exit(1); });
