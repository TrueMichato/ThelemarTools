#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Re-import verifier — loads each exported NPC JSON exactly the way the character
 * sheet UI import does (state.loadFromJson → _reconcileClassFeatures) and prints
 * the derived values, to confirm nothing recomputes to NaN / drops on load.
 *
 * Constant machinery; no per-batch data. It reads whatever `<out>/*.json`
 * exports the spawn step produced and derives the homebrew it must wait for
 * (required subclasses) from those files.
 *
 * Usage:
 *   node verify-npcs.mjs [--only Name1,Name2] [--repo <repo-root>] [--out <dir>]
 */
import {chromium} from "playwright";
import {spawn} from "child_process";
import fs from "fs";
import path from "path";

const arg = (name) => {
	const eq = process.argv.find(a => a.startsWith(`--${name}=`));
	if (eq) return eq.split("=").slice(1).join("=");
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? (process.argv[i + 1] || "") : "";
};

const REPO = path.resolve(arg("repo") || process.env.NPC_REPO || process.cwd());
const OUT_DIR = path.resolve(arg("out") || process.env.NPC_OUT || path.join(REPO, "npc-exports"));
const PORT = Number(process.env.SPAWN_PORT || 8080);
const BASE = `http://localhost:${PORT}`;

if (!fs.existsSync(path.join(REPO, "charactersheet.html"))) {
	console.error(`✗ --repo "${REPO}" has no charactersheet.html. Pass --repo <5etools-repo-root>.`);
	process.exit(2);
}

async function isServerUp () {
	try { return (await fetch(`${BASE}/charactersheet.html`, {method: "HEAD"})).ok; } catch { return false; }
}
async function ensureServer () {
	if (await isServerUp()) return null;
	const proc = spawn("npx", ["http-server", "-p", String(PORT), "-c-1", "--silent", "."], {cwd: REPO, stdio: "ignore", detached: false});
	for (let i = 0; i < 80; ++i) { await new Promise(r => setTimeout(r, 500)); if (await isServerUp()) return proc; }
	proc.kill();
	throw new Error("server did not start");
}

async function main () {
	const onlyArg = arg("only");
	let names = onlyArg ? onlyArg.split(",").map(s => s.trim()) : null;
	if (!names) {
		names = fs.readdirSync(OUT_DIR)
			.filter(f => f.endsWith(".json") && !f.endsWith(".report.json") && !f.endsWith(".picklog.json"))
			.map(f => f.replace(/\.json$/, ""));
	}
	if (!names.length) { console.error(`✗ no exports found in ${OUT_DIR}`); process.exit(2); }

	// Derive required subclasses from the export files so the homebrew-ready wait
	// is generic (no hardcoded subclass names).
	const requiredSubclasses = [];
	const jsons = {};
	for (const nm of names) {
		const p = path.join(OUT_DIR, `${nm}.json`);
		if (!fs.existsSync(p)) { console.error(`✗ missing export: ${p}`); process.exit(2); }
		const j = JSON.parse(fs.readFileSync(p, "utf8"));
		jsons[nm] = j;
		for (const c of (j.classes || [])) {
			if (c.subclass) requiredSubclasses.push({className: c.name, subclass: c.subclass.shortName || c.subclass.name});
		}
	}

	const server = await ensureServer();
	const browser = await chromium.launch();
	let anyBad = false;
	try {
		const page = await browser.newPage();
		page.on("pageerror", e => console.error(`[page] ${e.message}`));
		await page.goto(`${BASE}/charactersheet.html`, {waitUntil: "domcontentloaded"});
		await page.waitForFunction(() => !!globalThis.charSheet?.spawn, null, {timeout: 180_000});
		await page.waitForFunction((requiredSubclasses) => {
			const cs = globalThis.charSheet;
			if (!cs?.getClasses) return false;
			const classes = cs.getClasses();
			if (!classes || !classes.length) return false;
			return requiredSubclasses.every(({className, subclass}) => {
				const c = classes.find(x => x.name === className);
				return c && (c.subclasses || []).some(s => s.name === subclass || s.shortName === subclass);
			});
		}, requiredSubclasses, {timeout: 180_000, polling: 1000});
		console.error("✓ homebrew loaded\n");

		for (const nm of names) {
			const out = await page.evaluate((data) => {
				const cs = globalThis.charSheet;
				cs._state.loadFromJson(data);
				try { cs._reconcileClassFeatures?.(); } catch (e) { /* ignore */ }
				const st = cs._state;
				const sc = st._data.spellcasting || {};
				const prep = (sc.spellsKnown || []).filter(s => s.prepared && s.level > 0);
				return {
					name: st.getName(),
					ac: st.getArmorClass ? st.getArmorClass() : null,
					hp: st.getMaxHp ? st.getMaxHp() : null,
					str: st.getAbilityScore("str"),
					dex: st.getAbilityScore("dex"),
					con: st.getAbilityScore("con"),
					int: st.getAbilityScore("int"),
					wis: st.getAbilityScore("wis"),
					cha: st.getAbilityScore("cha"),
					preparedCount: prep.length,
					cantrips: (sc.cantripsKnown || []).map(c => c.name),
					acFormulas: (st._data.acFormulas || []).map(f => `${f.sourceName}:${f.base}${f.addDex ? "+DEX" : ""}`),
					feats: (st._data.feats || []).map(f => f.name || f),
				};
			}, jsons[nm]);
			const acOk = Number.isFinite(out.ac) && Number.isFinite(out.hp);
			if (!acOk) anyBad = true;
			console.error(`${acOk ? "✓" : "✗"} ${nm}: AC=${out.ac} HP=${out.hp} STR=${out.str} DEX=${out.dex} CON=${out.con} INT=${out.int} WIS=${out.wis} CHA=${out.cha} prepared=${out.preparedCount}`);
			if (out.cantrips.length) console.error(`    cantrips: ${out.cantrips.join(", ")}`);
			if (out.acFormulas.length) console.error(`    acFormulas: ${out.acFormulas.join(", ")}`);
			if (out.feats.length) console.error(`    feats: ${out.feats.join(", ")}`);
		}
	} finally {
		await browser.close();
		if (server) server.kill();
	}
	process.exit(anyBad ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
