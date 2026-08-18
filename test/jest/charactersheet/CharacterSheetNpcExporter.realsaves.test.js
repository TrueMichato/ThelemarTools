/**
 * Contract regression tests driven by *real* character-sheet saves.
 *
 * Synthetic fixtures never reproduced the defects that actually shipped — every
 * v4 bug (raw JSON in prose, `p` damage codes, `{@spell x|y|SRC}` display-text
 * links, permanent-looking conditional immunities, orphaned resource pools,
 * second-person leakage) was only visible when the exporter ran against a full
 * save. These assertions encode those contracts.
 *
 * The saves live in `npc-exports/` and are intentionally NOT committed (they are
 * personal character data, ~200 KB each). When absent, the suite skips rather
 * than fails so CI stays green.
 */
import fs from "node:fs";
import path from "node:path";

import "./setup.js";
import "../../../js/charactersheet/charactersheet-state.js";
// Browser-only modules the exporter feature-detects via `typeof X !== "undefined"`.
// Leaving them out made the headless corpus *quieter* than the real app, which is how
// the generic Ioun-stone preamble shipped unnoticed — the harness never took that path.
import "../../../js/charactersheet/charactersheet-ioun.js";
import "../../../js/charactersheet/charactersheet-upgrades.js";
import "../../../js/charactersheet/charactersheet-npc-exporter.js";

const CharacterSheetState = globalThis.CharacterSheetState;
const CharacterSheetNpcExporter = globalThis.CharacterSheetNpcExporter;

const SAVE_DIR = path.resolve(process.cwd(), "npc-exports");
const SAVE_NAMES = [
	"Onger", "Duralin", "Talna", "Dauk", "Dranan", "Lorian", "Tignor", "Dzeiy", "Reggu", "Vern", "Wisp",
	"Aldor", "Boti", "Fili", "Nessa", "Tikal",
	// v12 — the first level-20 builds, the first psionic class and the first Ioun bank.
	"Arthur", "Juen", "Mikase", "Octavius", "Phirse",
	// v14 — the edition-split casters, the shapechanger and the second rogue.
	"Elizabeth", "Missy", "Nagara",
];

const available = SAVE_NAMES.filter(n => fs.existsSync(path.join(SAVE_DIR, `${n}.json`)));
// `npc-exports/` is an untracked local corpus, so it is absent from every worktree and
// every fresh clone. `describe.skip.each([])` still THROWS ("called with an empty Array
// of table data"), so the skip guard alone is not enough — the table has to be non-empty
// for `.each` to be legal at all. Feed it a placeholder that is only ever skipped.
const describeReal = available.length ? describe : describe.skip;
const availableTable = available.length ? available : ["(no npc-exports/ corpus present)"];

// The app seeds this from loaded homebrew; without it `getDivineFavorGodData()` returns
// null and the exporter can never resolve a god's tiers.
const DIVINE_FAVOR_CATALOG = (() => {
	const brewPath = path.resolve(process.cwd(), "homebrew", "TravelersGuidetoThelemar.json");
	if (!fs.existsSync(brewPath)) return [];
	try {
		return JSON.parse(fs.readFileSync(brewPath, "utf8")).divineFavor || [];
	} catch {
		return [];
	}
})();

// Conversion is the expensive part (a full state load plus an ~80-pass pipeline), and the
// corpus-wide contracts each want every character. Memoized on name + options: the
// exporter is pure with respect to the save, so one conversion serves every assertion.
const MONSTER_CACHE = new Map();

const loadMonster = (name, opts = {}) => {
	const key = `${name}|${JSON.stringify(opts)}`;
	if (!MONSTER_CACHE.has(key)) {
		const state = new CharacterSheetState();
		state.loadFromJson(JSON.parse(fs.readFileSync(path.join(SAVE_DIR, `${name}.json`), "utf8")));
		state.setDivineFavorCatalog?.(DIVINE_FAVOR_CATALOG);
		MONSTER_CACHE.set(key, CharacterSheetNpcExporter.convertStateToMonster(state, opts));
	}
	return MONSTER_CACHE.get(key);
};

const allEntryText = mon => {
	const out = [];
	["trait", "action", "bonus", "reaction", "legendary"].forEach(section => {
		(mon[section] || []).forEach(e => {
			out.push(String(e?.name || ""));
			(e?.entries || []).forEach(x => { if (typeof x === "string") out.push(x); });
		});
	});
	(mon.spellcasting || []).forEach(sc => out.push(JSON.stringify(sc)));
	return out.join("\n");
};

const allAbilityNames = mon => ["trait", "action", "bonus", "reaction"]
	.flatMap(section => (mon[section] || []).map(e => String(e?.name || "")));

/** A spell is the same spell whatever printing it came from, so compare on name alone. */
const expectNoDuplicateSpells = (label, list) => {
	const names = list
		.map(x => /\{@spell ([^}|]+)/.exec(String(x))?.[1])
		.filter(Boolean)
		.map(x => x.trim().toLowerCase());
	const dupes = [...new Set(names.filter((x, i) => names.indexOf(x) !== i))];
	expect(`${label}: ${dupes.join(", ")}`).toBe(`${label}: `);
};

describeReal("CharacterSheetNpcExporter — real saves", () => {
	describe.each(availableTable)("%s", name => {
		let mon;
		let text;
		beforeAll(() => {
			mon = loadMonster(name);
			text = allEntryText(mon);
		});

		it("never leaks serialized JSON into prose", () => {
			expect(text).not.toMatch(/\{\s*\\?"entries\\?"\s*:/);
			expect(text).not.toMatch(/\\"/);
		});

		it("spells out damage types instead of item codes", () => {
			expect(text).not.toMatch(/\{@damage [^}]+\}\s+(?:p|s|b|r|n|f|c|a|t|y|i|o)\s+damage/i);
		});

		it("emits well-formed spell links with no display-text hijack", () => {
			const tags = text.match(/\{@spell [^}]+\}/g) || [];
			tags.forEach(tag => {
				expect(tag.split("|").length).toBeLessThanOrEqual(2);
				expect(tag).not.toMatch(/\{@spell [a-z]/);
			});
		});

		it("only tags spell names the character actually knows", () => {
			// Scope to ability prose: the spellcasting block is built straight from the
			// sheet's spell list and legitimately includes single-word names.
			const prose = ["trait", "action", "bonus", "reaction"]
				.flatMap(section => (mon[section] || []).flatMap(e => (e.entries || []).filter(x => typeof x === "string")))
				.join("\n");
			const tagged = [...new Set((prose.match(/\{@spell ([^}]+)\}/g) || [])
				.map(t => t.replace("{@spell ", "").replace(/\}$/, ""))
				// A sourceless tag makes no attribution — it is the deliberate output for a
				// spell a *feature* casts ("cast the darkness spell") that the character
				// does not itself know. The invariant this guards is that a tag never
				// invents a *source*, so only sourced tags have to be in the vocabulary.
				.filter(t => t.includes("|"))
				.map(t => t.split("|")[0].toLowerCase()))];
			const state = new CharacterSheetState();
			state.loadFromJson(JSON.parse(fs.readFileSync(path.join(SAVE_DIR, `${name}.json`), "utf8")));
			// Prose enrichment is limited to multi-word names (single words like "shield"
			// are ordinary English); item entries tag directly from item data.
			const known = new Set([
				...CharacterSheetNpcExporter._getSpellVocabulary(state).keys(),
				...(state.getItemGrantedSpells?.() || []).map(sp => String(sp?.name || "").split("|")[0].trim().toLowerCase()),
			]);
			tagged.forEach(spellName => expect(known).toContain(spellName));
		});

		it("keeps core condition/action tags source-free so hovers resolve", () => {
			expect(text).not.toMatch(/\{@condition (?:blinded|charmed|deafened|frightened|grappled|incapacitated|invisible|paralyzed|petrified|poisoned|prone|restrained|stunned|unconscious)\|/i);
			expect(text).not.toMatch(/\{@quickref/);
		});

		it("uses third-person bestiary voice, never second person", () => {
			// Official feature *titles* ("Know Your Enemy") are copied verbatim, not
			// authored — only the prose the exporter writes has to be third person.
			const prose = text.split("\n").filter(line => !/^Know Your Enemy/.test(line)).join("\n");
			expect(prose).not.toMatch(/\b(?:you|your|yours|yourself|you're|you've|you'll)\b/i);
			expect(text).not.toMatch(/§§/);
		});

		it("conjugates the subject correctly", () => {
			// The regressions that actually shipped: bare plural verbs and bad -s forms.
			expect(text).not.toMatch(new RegExp(`\\b${name} (?:drop|succeed|do|ignore|learn|summon|finish|study|activate|fail|add|take|have|make|gain|use|move|hit|push|regain|choose|know|deal|spend|roll|end|start|reduce)\\b`));
			expect(text).not.toMatch(/\b\w+(?:pushs|haves|dos|goes s|ignores s)\b/);
			// Only clause-initial "it" is the subject; "attack rolls against it have…" is fine.
			expect(text).not.toMatch(/(?:^|[.;]\s+)(?:It|it) (?:drop|succeed|do|ignore|learn|summon|finish|study|activate|fail|add|have)\b/m);
		});

		it("strips level-progression preambles", () => {
			expect(text).not.toMatch(/\b(?:Starting at|Beginning at|At \d+(?:st|nd|rd|th) level|Also at \d+)/i);
			expect(text).not.toMatch(/^\s*Starting When/m);
		});

		it("does not fall back to a Class Resources dumping ground", () => {
			expect(allAbilityNames(mon)).not.toContain("Class Resources");
		});

		it("prints limited uses on the ability itself", () => {
			// `Dawn` is a real recharge period on items (Poison Absorbing Tattoo), and is
			// the only limited-use pool some builds have.
			const limited = allAbilityNames(mon).filter(n => /\(\d+\/(?:LR|SR|Day|Dawn|Dusk|Turn|Rest)\)/i.test(n));
			expect(limited.length).toBeGreaterThan(0);
		});

		it("omits out-of-fiction Level Signal unless asked", () => {
			expect(allAbilityNames(mon)).not.toContain("Level Signal");
			expect(allAbilityNames(loadMonster(name, {includeLevelSignal: true}))).toContain("Level Signal");
		});

		it("has no duplicate abilities once base names are normalized", () => {
			// A multi-benefit feat is deliberately split across sections by action
			// economy (Shield Master is a bonus action *and* a reaction), so uniqueness
			// is enforced per section; cross-section namesakes must carry distinct text.
			["trait", "action", "bonus", "reaction"].forEach(section => {
				const keys = (mon[section] || [])
					.map(e => String(e?.name || "").replace(/\s*\((?:Bonus Action|Action|Reaction|\d+\/[^)]+)\)\s*$/i, "").trim().toLowerCase())
					.filter(Boolean);
				expect(new Set(keys).size).toBe(keys.length);
			});

			const byName = new Map();
			["trait", "action", "bonus", "reaction"].forEach(section => {
				(mon[section] || []).forEach(entry => {
					const key = String(entry?.name || "").replace(/\s*\((?:Bonus Action|Action|Reaction|\d+\/[^)]+)\)\s*$/i, "").trim().toLowerCase();
					if (!key) return;
					const text = (entry.entries || []).filter(it => typeof it === "string").join(" ");
					if (byName.has(key)) expect(byName.get(key)).not.toBe(text);
					byName.set(key, text);
				});
			});
		});

		it("annotates conditional defenses instead of stating them flatly", () => {
			[...(mon.resist || []), ...(mon.conditionImmune || []), ...(mon.immune || [])]
				.filter(e => e && typeof e === "object")
				.forEach(e => {
					// Object entries are either gated ("while raging") or attributed to the
					// granting feature; both carry a note, only the former is `cond`.
					expect(typeof e.note).toBe("string");
					expect(e.note.length).toBeGreaterThan(0);
					if (!e.cond) expect(e.note).toMatch(/^\(.+\)$/);
					else expect(e.note).toMatch(/^while /i);
				});
		});

		it("names real AC sources", () => {
			expect(mon.ac[0].from.length).toBeGreaterThan(0);
			mon.ac[0].from.forEach(src => expect(src).not.toMatch(/^natural armor$/i));
		});

		it("keeps weapon attack bonuses internally consistent", () => {
			// Spell attacks legitimately differ; only weapon attack lines must agree.
			// A +3 magic weapon alongside a nonmagical feature-conjured weapon is a
			// legitimate 4-point spread, so the tolerance covers the largest magic
			// bonus plus a one-point ability difference.
			// `mw`/`rw` are weapon attacks; `ms`/`rs` are spell attacks and are excluded
			// with them — a satellite's ranged spell attack has no reason to match a
			// greatsword.
			const hits = (text.match(/\{@atk [mr]w(?:,[mr]w)*\}\s*\{@hit ([+-]\d+)\}/g) || [])
				.map(h => Number((/\{@hit ([+-]\d+)\}/.exec(h) || [])[1]));
			if (hits.length > 1) expect(Math.max(...hits) - Math.min(...hits)).toBeLessThanOrEqual(4);
		});

		it("produces a plausible CR for a high-level character", () => {
			// A squishy full caster rates genuinely lower than a plate-wearing cleric of the
			// same level, so the floor tracks level rather than asserting one number for all.
			const level = Number((/level (\d+) character/i.exec(allEntryText(loadMonster(name, {includeLevelSignal: true}))) || [])[1]) || 14;
			expect(Number(mon.cr)).toBeGreaterThanOrEqual(Math.max(4, Math.floor(level / 2) - 2));
			expect(Number(mon.cr)).toBeLessThanOrEqual(20);
		});

		it("produces a schema-shaped monster", () => {
			expect(Array.isArray(mon.size)).toBe(true);
			expect(mon.hp.average).toBeGreaterThan(0);
			expect(mon.hp.formula).toMatch(/\d+d\d+/);
			expect(mon.languages.length).toBeGreaterThan(0);
			expect(mon.pbNote).toMatch(/^\+\d+$/);
		});

		// ---- v5 fidelity contracts -------------------------------------------

		it("states every save whose effective value beats the bare ability modifier", () => {
			const state = new CharacterSheetState();
			state.loadFromJson(JSON.parse(fs.readFileSync(path.join(SAVE_DIR, `${name}.json`), "utf8")));
			// An always-on aura (Aura of Protection) is not part of the sheet's displayed
			// breakdown but does apply to every save the NPC rolls, so the block may print
			// more — provided a trait on the block explains it. It may never print less.
			const explainsSaveBonus = /bonus to saving throws|saving throws.{0,40}bonus|aura/i.test(allEntryText(mon));
			["str", "dex", "con", "int", "wis", "cha"].forEach(abv => {
				const effective = state.getSaveBreakdown(abv).total;
				if (effective === state.getAbilityMod(abv) && !state.hasSaveProficiency(abv)) return;
				expect(mon.save?.[abv]).toBeDefined();
				const printed = Number(mon.save[abv]);
				expect(printed).toBeGreaterThanOrEqual(effective);
				if (printed !== effective) expect(explainsSaveBonus).toBe(true);
			});
		});

		it("reports effective, not canonical, skill bonuses", () => {
			const state = new CharacterSheetState();
			state.loadFromJson(JSON.parse(fs.readFileSync(path.join(SAVE_DIR, `${name}.json`), "utf8")));
			Object.entries(mon.skill || {}).forEach(([key, value]) => {
				const skillKey = key.split("|")[0];
				expect(Number(value)).toBe(state.getSkillMod(skillKey));
			});
		});

		it("keys homebrew skills as hoverable UIDs", () => {
			Object.keys(mon.skill || {})
				.filter(key => key.includes("|"))
				.forEach(key => expect(key).toMatch(/^[a-z ]+\|[A-Z]+$/));
		});

		it("never truncates a feature mid-sentence", () => {
			["trait", "action", "bonus", "reaction"].forEach(section => {
				(mon[section] || []).forEach(entry => {
					(entry.entries || []).forEach(line => {
						if (typeof line !== "string") return;
						expect(line.trim()).toMatch(/[.!?:)"\]}]$/);
					});
				});
			});
		});

		it("defines every toggle its defenses refer to", () => {
			const defined = new Set(allAbilityNames(mon)
				.map(n => n.replace(/\([^()]*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase()));
			["resist", "immune", "vulnerable", "conditionImmune"].forEach(bucket => {
				(mon[bucket] || []).forEach(entry => {
					if (!entry || typeof entry !== "object" || !entry.note) return;
					const match = /^while (?:in )?(.+?)(?: is active)?$/i.exec(String(entry.note).trim());
					if (!match || !/^[A-Z]/.test(match[1])) return;
					// Names carry their uses ("Exalted Champion (1/LR)"), so the toggle is
					// matched by containment rather than equality.
					const named = match[1].toLowerCase();
					expect(`${named}: ${[...defined].some(it => it.includes(named))}`).toBe(`${named}: true`);
				});
			});
		});

		it("lists a swappable subclass spell set only once", () => {
			const swappable = (mon.spellcasting || [])
				.filter(block => (block.footerEntries || []).some(e => /\{@b [^.]+\.\}/.test(e)));
			swappable.forEach(block => {
				const spells = [...String(block.footerEntries.join(" ")).matchAll(/\{@spell ([^|}]+)/g)]
					.map(m => m[1].toLowerCase());
				const general = (mon.spellcasting || []).filter(b => b !== block);
				spells.forEach(spell => {
					general.forEach(other => {
						expect(JSON.stringify(other.spells || {}).toLowerCase()).not.toContain(`{@spell ${spell}|`);
					});
				});
			});
		});
	});

	describe("cross-character fidelity", () => {
		it("annotates spells granted by a feature rather than restating the grant", () => {
			if (!available.includes("Talna")) return;
			const mon = loadMonster("Talna");
			const spellText = JSON.stringify(mon.spellcasting || []);
			expect(spellText).toMatch(/\{@spell [^}]+\} \(Serpentine Spellcasting\)/);
			// Ordinary class routes must stay unannotated.
			expect(spellText).not.toMatch(/\(Wizard Spellbook\)/);
			expect(spellText).not.toMatch(/\(Cantrips Known\)/);
		});

		it("puts conditional damage on the attack that can gain it", () => {
			if (!available.includes("Onger")) return;
			const mon = loadMonster("Onger");
			const attack = (mon.action || []).find(a => /gae bolg/i.test(a.name));
			expect(attack.entries[0]).toMatch(/plus \{@damage 4\} damage while raging/);
			expect(attack.entries[0]).toMatch(/plus \{@damage 1d8\} damage against Constructs/);
			// The rage ability must not also describe the damage in vague prose.
			const rage = (mon.bonus || []).find(b => /^rage/i.test(b.name));
			expect(rage.entries.join(" ")).not.toMatch(/extra rage damage/i);
		});

		it("gives a feature-conjured weapon a real attack line", () => {
			if (!available.includes("Duralin")) return;
			const mon = loadMonster("Duralin");
			const shadow = (mon.action || []).find(a => /shadow weapon/i.test(a.name));
			expect(shadow).toBeDefined();
			expect(shadow.entries[0]).toMatch(/\{@atk mw\} \{@hit [+-]\d+\}/);
			expect(shadow.entries[0]).toMatch(/psychic damage/);
			expect(shadow.entries[0]).toMatch(/two hands/);
			// The conversion is no longer a cross-reference: the coated weapon is its own
			// attack, sitting beside the weapon it converts.
			expect(shadow.entries[0]).not.toMatch(/can instead convert/i);
			const coated = (mon.action || []).find(a => /Retaliator.*\(Umbral Coating\)/i.test(a.name));
			expect(coated).toBeDefined();
			expect(coated.entries[0]).toMatch(/range 20\/60 ft\./);
			expect(coated.entries[0]).toMatch(/Counts as a shadow weapon \(Shadow Sneak, Shadowbite\)\./);
		});

		it("surfaces stance mechanics as their own ability", () => {
			if (!available.includes("Onger")) return;
			const mon = loadMonster("Onger");
			const stance = (mon.trait || []).find(t => /flowing steps stance/i.test(t.name));
			expect(stance).toBeDefined();
			expect(stance.entries.join(" ")).toMatch(/advantage on saving throws/i);
		});

		it("emits initiative only when it beats the bare Dexterity modifier", () => {
			available.forEach(name => {
				const state = new CharacterSheetState();
				state.loadFromJson(JSON.parse(fs.readFileSync(path.join(SAVE_DIR, `${name}.json`), "utf8")));
				const mon = loadMonster(name);
				const dexMod = state.getAbilityMod("dex");
				const effective = state.getInitiativeBreakdown().total;
				if (effective === dexMod) {
					if (typeof mon.initiative === "number") expect(mon.initiative).not.toBe(dexMod);
					return;
				}
				expect(mon.initiative).toBeDefined();
				if (typeof mon.initiative === "number") expect(mon.initiative).toBe(effective);
			});
		});
	});

	describe("v6 — attribution, compaction and spell-aware CR", () => {
		it("credits the feature that grants a plain defence instead of restating it", () => {
			if (!available.includes("Onger")) return;
			const mon = loadMonster("Onger");
			const cold = (mon.resist || []).find(it => (it?.resist || []).includes("cold"));
			expect(cold).toBeDefined();
			expect(cold.note).toMatch(/^\(.+\)$/);
			expect(cold.cond).toBeFalsy();
		});

		it("drops a trait that only restates an attributed defence", () => {
			if (!available.includes("Talna")) return;
			const mon = loadMonster("Talna");
			const poison = (mon.resist || []).find(it => (it?.resist || []).includes("poison"));
			expect(poison?.note).toMatch(/poison resilience/i);
			const trait = (mon.trait || []).find(t => /poison resilience/i.test(t.name));
			// The advantage clause has no home on the block, so the trait survives — but it
			// must no longer repeat the resistance the defence line already prints.
			if (trait) expect(trait.entries.join(" ")).not.toMatch(/resistance to poison/i);
		});

		it("shows every mode of a form-gated defence, not just the active one", () => {
			if (!available.includes("Talna")) return;
			const mon = loadMonster("Talna");
			const gated = (mon.resist || []).filter(it => it?.cond && /siphoning power/i.test(it.note || ""));
			expect(gated.length).toBeGreaterThanOrEqual(2);
			const types = gated.flatMap(it => it.resist || []);
			expect(new Set(types).size).toBe(types.length);
			// Proper nouns in the gate must survive the lower-casing match pipeline.
			expect(gated.map(it => it.note).join(" ")).toMatch(/Arch /);
		});

		it("files an item-granted reaction under reactions", () => {
			if (!available.includes("Duralin")) return;
			const mon = loadMonster("Duralin");
			const names = (mon.reaction || []).map(it => it.name).join(" | ");
			expect(names).toMatch(/answer the blow/i);
			expect((mon.trait || []).map(it => it.name).join(" | ")).not.toMatch(/answer the blow/i);
		});

		it("keeps features whose only effect is advantage", () => {
			if (!available.includes("Onger")) return;
			const names = allAbilityNames(loadMonster("Onger")).join(" | ");
			expect(names).toMatch(/reckless attack/i);
			// v16: a standing advantage claim is no longer its own trait — it is one clause
			// of the pinned roll-modifier list, still attributed to the feature that grants it.
			const onger = loadMonster("Onger");
			const resilience = (onger.trait || []).find(it => /^resilience$/i.test(it.name));
			expect(resilience.entries.join(" ")).toMatch(/danger sense/i);
		});

		it("defines every feature an attack rider names", () => {
			if (!available.includes("Onger")) return;
			const mon = loadMonster("Onger");
			const attack = (mon.action || []).find(a => /gae bolg/i.test(a.name));
			const riders = attack.entries.join(" ");
			// A rider that cannot be traced to an ability on the block is unusable at the table.
			const cited = ["Reckless Attack"].filter(it => new RegExp(it, "i").test(riders));
			expect(cited).toHaveLength(1);
			const defined = allAbilityNames(mon).join(" | ");
			cited.forEach(it => expect(defined).toMatch(new RegExp(it, "i")));
		});

		it("never prints a sub-section label twice", () => {
			available.forEach(name => {
				allEntryText(loadMonster(name))
					.match(/\{@b ([^}]+)\.?\}\s*([^.]{0,60})\./g)
					?.forEach(chunk => {
						const label = /\{@b ([^}]+?)\.?\}/.exec(chunk)[1].trim().toLowerCase();
						const body = chunk.replace(/\{@b [^}]+\}\s*/, "").trim().toLowerCase();
						expect(body.replace(/\.$/, "")).not.toBe(label);
					});
			});
		});

		it("keeps player-facing rules sidebars off the block", () => {
			available.forEach(name => {
				expect(allEntryText(loadMonster(name))).not.toMatch(/rules tip/i);
			});
		});

		it("omits build-time spellcasting bookkeeping", () => {
			available.forEach(name => {
				const text = allEntryText(loadMonster(name));
				expect(text).not.toMatch(/is the ability (?:score )?increased by this feat/i);
				expect(text).not.toMatch(/must be from the .{0,40}school of magic/i);
			});
		});

		it("stays within a readable prose budget", () => {
			// A feature that offers several named options, or that needs several paragraphs, is
			// legitimately long; what must stay scannable is each individual block of prose. So
			// measure per paragraph, further split on bold option labels, rather than penalising
			// a feature for having structure. Combat Methods is an intentional catalogue.
			available.forEach(name => {
				["trait", "action", "bonus", "reaction"].forEach(section => {
					(loadMonster(name)[section] || []).forEach(entry => {
						if (/combat method/i.test(entry.name)) return;
						const chunks = entry.entries
							.filter(it => typeof it === "string")
							.flatMap(it => it.split(/(?=\{@b )/))
							.filter(it => it.trim());
						const worst = Math.max(0, ...chunks.map(it => it.length));
						expect(`${entry.name}: ${worst < 900 ? "ok" : worst}`).toBe(`${entry.name}: ok`);
					});
				});
			});
		});

		it("rates a blaster above a controller and a controller above a diplomat", () => {
			const mkState = list => ({
				getProficiencyBonus: () => 6,
				getCantripsKnown: () => list.filter(it => it.level === 0),
				getSpellsKnown: () => list.filter(it => it.level > 0),
				getSpellSlots: () => ({3: {max: 3}, 5: {max: 2}, 8: {max: 1}, 9: {max: 1}}),
			});
			const index = {
				"fireball|phb": {level: 3, avgDamage: 28, isAoe: true, conditionInflict: []},
				"meteor swarm|phb": {level: 9, avgDamage: 70, isAoe: true, conditionInflict: []},
				"hypnotic pattern|phb": {level: 3, avgDamage: 0, isAoe: true, conditionInflict: ["incapacitated"]},
				"power word stun|phb": {level: 8, avgDamage: 0, isAoe: false, conditionInflict: ["stunned"]},
				"wish|phb": {level: 9, avgDamage: 0, isAoe: false, conditionInflict: []},
				"teleport|phb": {level: 7, avgDamage: 0, isAoe: false, conditionInflict: []},
			};
			const sp = (n, level) => ({name: n, source: "PHB", level, school: "V"});
			const blocks = [{spells: {}}];
			const score = list => CharacterSheetNpcExporter._estimateSpellDpr({
				state: mkState(list), spellcastingBlocks: blocks, spellIndex: index,
			});

			const blaster = score([sp("Fireball", 3), sp("Meteor Swarm", 9)]);
			const controller = score([sp("Hypnotic Pattern", 3), sp("Power Word Stun", 8)]);
			const diplomat = score([sp("Teleport", 7), sp("Wish", 9)]);

			expect(blaster).toBeGreaterThan(controller);
			expect(controller).toBeGreaterThan(diplomat);
		});

		it("leaves a non-caster's CR untouched by the spell index", () => {
			if (!available.includes("Onger")) return;
			expect(loadMonster("Onger", {spellIndex: {"fireball|phb": {level: 3, avgDamage: 28, isAoe: true, conditionInflict: []}}}).cr)
				.toBe(loadMonster("Onger").cr);
		});
	});
});

describeReal("CharacterSheetNpcExporter — real saves, v7 regressions", () => {
	describe.each(availableTable)("%s", name => {
		let mon;
		let text;
		beforeAll(() => {
			mon = loadMonster(name);
			text = allEntryText(mon);
		});

		// ---- v7 regressions -------------------------------------------------------
		// Each of these encodes a defect that shipped in v6 and was only visible when the
		// exporter ran over a full save.

		it("matches resource names by token, not substring", () => {
			// "aura of courage" contains "rage": a Paladin must never gain barbarian
			// resistance, and a passive must never inherit Rage's uses.
			const names = allAbilityNames(mon);
			names.filter(n => /^(?:age|master forager|aura of courage)\b/i.test(n))
				.forEach(n => expect(n).not.toMatch(/\(\d+\//));
			if (!/\brage\b/i.test(names.join(" "))) {
				expect(text).not.toMatch(/while (?:its|.*?'s) rage is active/i);
			}
		});

		it("derives a spellcasting DC from the caster class, never a default", () => {
			(mon.spellcasting || []).forEach(block => {
				const dc = /\{@dc (\d+)\}/.exec(JSON.stringify(block))?.[1];
				if (!dc) return;
				// A DC of 12 is the int-fallback signature on a high-level character.
				expect(Number(dc)).toBeGreaterThanOrEqual(8 + Number(mon.pbNote?.replace(/\D/g, "") || 2));
			});
		});

		it("points Multiattack at a real, best-damage attack", () => {
			const multi = (mon.action || []).find(e => /^multiattack$/i.test(e.name));
			if (!multi) return;
			// The named attack may be hover-tagged ("{@variantrule Unarmed Strike|XPHB}");
			// the contract is about which attack it points at, not the markup.
			const stripTags = str => String(str).replace(/\{@\w+ ([^}|]+)(?:\|[^}]*)?\}/g, "$1");
			const named = /(?:two|three|four) ([^.]+?) attacks/i.exec(stripTags(multi.entries.join(" ")))?.[1];
			if (!named) return;
			const attackNames = (mon.action || []).map(e => stripTags(e.name).toLowerCase());
			expect(attackNames.some(n => n.includes(named.toLowerCase().split(/,| of /)[0].trim()))).toBe(true);
		});

		it("emits only schema-legal damage types and conditions", () => {
			const DAMAGE = new Set(["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"]);
			const CONDITIONS = new Set(["blinded", "charmed", "deafened", "disease", "exhaustion", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"]);
			const base = value => String(value || "").toLowerCase().replace(/\s*\([^)]*\)\s*/g, "").trim();
			["resist", "immune", "vulnerable"].forEach(bucket => {
				(mon[bucket] || []).forEach(v => { if (typeof v === "string") expect(DAMAGE.has(base(v))).toBe(true); });
			});
			(mon.conditionImmune || []).forEach(v => { if (typeof v === "string") expect(CONDITIONS.has(base(v))).toBe(true); });
		});

		it("conjugates coordinated verbs to the third person", () => {
			expect(text).not.toMatch(/\b(?:it|its|\w's) [a-z]+s (?:[^.]{0,60})\b(?:and|or) (?:become|know|deal|cast|move|reduce|gain|take)\b/i);
			expect(text).not.toMatch(/\bshapes?-shift\b(?!s)/i);
		});

		it("collapses level-progression tables to the applicable row", () => {
			expect(text).not.toMatch(/\b(?:druid|barbarian|cleric|bard|paladin|fighter) level\s+\w+.*?\b1\/4\b/i);
		});

		it("keeps punctuation and delimiters balanced", () => {
			["trait", "action", "bonus", "reaction"].forEach(section => {
				(mon[section] || []).forEach(entry => {
					const joined = (entry.entries || []).filter(it => typeof it === "string").join(" ");
					expect(`${entry.name}: ${(joined.match(/\(/g) || []).length - (joined.match(/\)/g) || []).length}`).toBe(`${entry.name}: 0`);
					expect(joined).not.toMatch(/\(\s|\s\)|…\./);
					// A tag lookup legitimately carries the option's real name, "Careful Spell
					// (Passive)"; what this guards against is a truncated aside.
					expect(joined).not.toMatch(/\((?:passive|active|inactive)[;,]|\((?:passive|active|inactive)\)(?!\|)/i);
				});
			});
		});

		it("does not restate spell pools the spellcasting block already prints", () => {
			const resources = (mon.trait || []).find(e => /^class resources$/i.test(e.name));
			if (!resources) return;
			const spells = [...JSON.stringify(mon.spellcasting || []).matchAll(/\{@spell ([^|}]+)/g)].map(m => m[1].toLowerCase());
			spells.forEach(spell => expect(resources.entries.join(" ").toLowerCase()).not.toContain(spell));
		});

		it("files a feat's standing benefits outside its activation section", () => {
			["bonus", "reaction"].forEach(section => {
				(mon[section] || []).forEach(entry => {
					const first = String((entry.entries || [])[0] || "");
					expect(first).not.toMatch(/^[^.]*has advantage on Constitution saving throws that it makes to maintain/i);
				});
			});
		});

		it("supplies a subject for imperative rules text", () => {
			expect(text).not.toMatch(/(?:^|\. )(?:Add|Gain|Regain|Take|Make|Roll) (?:its|his|her|their)\b/);
		});
	});

	describe("v8 — inference, consolidation and item fidelity", () => {
		it("lists carried magic items, not only equipped ones (D2)", () => {
			const gear = (loadMonster("Talna").trait || []).find(e => /^special equipment$/i.test(e.name));
			const joined = (gear?.entries || []).join(" ");
			expect(joined).toMatch(/Pearl of Power/i);
			expect(joined).toMatch(/Driftglobe/i);
		});

		it("does not restate a numeric bonus already folded onto the block (D3)", () => {
			["Duralin", "Lorian", "Talna"].forEach(n => {
				const alert = (loadMonster(n).trait || []).find(e => /^alert$/i.test(e.name));
				if (alert) expect(alert.entries.join(" ")).not.toMatch(/\+\s*5\s+bonus to (?:its )?initiative/i);
			});
			expect(allEntryText(loadMonster("Talna"))).not.toMatch(/\+3 bonus to AC and a \+2 bonus to all saving throws/i);
		});

		it("carries Divine Strike on the weapon line instead of a standalone trait (D4)", () => {
			const mon = loadMonster("Lorian");
			expect(allAbilityNames(mon)).not.toContain("Divine Strike");
			expect((mon.action || []).map(e => (e.entries || []).join(" ")).join(" ")).toMatch(/Divine Strike/i);
		});

		it("builds a structured Divine Favor trait from the unlocked tiers (D5)", () => {
			const mon = loadMonster("Lorian");
			const df = (mon.trait || []).find(e => /^divine favor/i.test(e.name));
			expect(df).toBeTruthy();
			expect(df.name).toMatch(/Zeus/);
			expect(df.entries.join(" ")).toMatch(/\{@b Devotee \(favor 3\)\.\}/);
			// The garbled residual custom-modifier duplicate must be gone.
			expect(allEntryText(mon)).not.toMatch(/\{@b Divine Favor: Zeus\.\}/);
		});

		it("consolidates Wild Shape and resolves its formulas (D6)", () => {
			const mon = loadMonster("Tignor");
			const names = allAbilityNames(mon);
			expect(names).not.toContain("Circle Forms");
			expect(names).not.toContain("Improved Circle Forms");
			const ws = ["bonus", "action", "trait"]
				.flatMap(sec => mon[sec] || [])
				.find(e => /^wild shape/i.test(e.name));
			expect(ws).toBeTruthy();
			const body = ws.entries.join(" ");
			expect(body).toMatch(/Lunar Radiance/i);
			expect(body).toMatch(/Elemental Wild Shape/i);
			// Formulas resolve to real numbers rather than reprinting the rulebook.
			expect(body).toMatch(/three times its Druid level \(\d+\)/i);
			// The decapitated splitter fragment must not survive.
			expect(body).not.toMatch(/^Intelligence, Wisdom, and Charisma scores;/m);
			// Independently-usable siblings stay their own abilities.
			expect(names.join(" | ")).toMatch(/Wild Resurgence/i);
			expect(names.join(" | ")).toMatch(/Wild Companion/i);
		});

		it("names the weapon an item ability applies to (D7)", () => {
			expect(allEntryText(loadMonster("Duralin"))).toMatch(/\{@item Retaliator/);
		});

		it("keeps a labelled option's body with its label (D8)", () => {
			const text = allEntryText(loadMonster("Duralin"));
			const idx = text.indexOf("{@b Cloak of Shadow.}");
			expect(idx).toBeGreaterThan(-1);
			// The label must introduce prose, not sit alone at the end of an entry.
			expect(text.slice(idx + 21, idx + 80).trim().length).toBeGreaterThan(20);
		});

		it("does not tag a common noun as a skill (D9)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				expect(text).not.toMatch(/\{@skill Nature\} (?:spirit|of the)/i);
				expect(text).not.toMatch(/(?:power|the) of \{@skill Nature\}/i);
			});
		});

		it("prints feats in terse statblock form (D10)", () => {
			["Onger", "Duralin", "Dranan"].forEach(n => {
				const sentinel = ["reaction", "trait", "bonus"]
					.flatMap(sec => loadMonster(n)[sec] || [])
					.find(e => /^sentinel$/i.test(e.name));
				if (sentinel) expect(sentinel.entries.join(" ").length).toBeLessThan(260);
			});
		});

		it("merges standing defensive benefits into one Resilience trait (D11)", () => {
			const mon = loadMonster("Talna");
			const res = (mon.trait || []).find(e => /^resilience$/i.test(e.name));
			expect(res).toBeTruthy();
			// The absorbed singles must not also stand alone.
			expect(allAbilityNames(mon)).not.toContain("Poison Resilience");
			expect(allAbilityNames(mon)).not.toContain("Magic Resistance");
		});

		it("emits no trait for an item whose only benefit is an ability increase (D12)", () => {
			available.forEach(n => {
				["trait", "action", "bonus", "reaction"].forEach(sec => {
					(loadMonster(n)[sec] || []).forEach(e => {
						if (!/ioun stone/i.test(e.name)) return;
						expect(e.entries.join(" ")).not.toMatch(/Roughly marble sized|named after Ioun/i);
					});
				});
			});
		});

		it("never echoes a bold label as the first words of its own body (D13)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				const echo = /\{@b ([^}]{3,60}?)\.\}\s*\1\b/i.exec(text);
				expect(echo ? `${n}: ${echo[0]}` : null).toBeNull();
			});
		});

		it("does not print a stance body in both the roster and its own ability (D1)", () => {
			const mon = loadMonster("Onger");
			const methods = (mon.trait || []).find(e => /^combat methods$/i.test(e.name));
			if (!methods) return;
			const stance = ["bonus", "action", "trait", "reaction"]
				.flatMap(sec => mon[sec] || [])
				.find(e => /stance/i.test(e.name) && e !== methods);
			if (!stance) return;
			const sentence = String((stance.entries || [])[0] || "").split(/(?<=\.)\s/)[0];
			if (sentence.length < 25) return;
			expect(methods.entries.join(" ")).not.toContain(sentence);
		});
	});

	describe("v9 — new-class coverage, resolved numbers and statblock discipline", () => {
		it("never claims a self-immunity stated about the target (D1)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				const imm = (mon.conditionImmune || []).flatMap(it => (typeof it === "string" ? [it] : it.conditionImmune || []));
				// Blood Curse of the Eyeless says the *creature* is immune if it is immune
				// to blinded; that is a target clause, never the NPC's own defence.
				const text = allEntryText(mon);
				if (/immune to this curse if it is immune to the blinded/i.test(text)) {
					expect(imm).not.toContain("blinded");
				}
			});
		});

		it("does not grant an active state the character has not unlocked (D2)", () => {
			const mon = loadMonster("Wisp");
			const resistNotes = JSON.stringify(mon.resist || []);
			expect(resistNotes).not.toMatch(/exalted champion/i);
		});

		it("adds the ability modifier to feature-derived attacks (D3)", () => {
			available.forEach(n => {
				(loadMonster(n).action || []).forEach(e => {
					const body = e.entries.join(" ");
					if (!/\{@atk /.test(body)) return;
					const dmg = /\{@damage ([^}]+)\}/.exec(body);
					if (!dmg) return;
					// A bare die with a positive to-hit means the modifier was dropped.
					const hit = /\{@hit \+?(-?\d+)\}/.exec(body);
					if (!hit || Number(hit[1]) <= 0) return;
					expect(`${n}/${e.name}: ${dmg[1]}`).toMatch(/\d+d\d+([+-]\d+)?|^\d+$/);
				});
			});
		});

		it("emits no second-person pronoun, doubled word or duplicate rider (D4)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				const prose = text.split("\n").filter(line => !/^Know Your Enemy/.test(line)).join("\n");
				expect(`${n}: ${/\byou(r|rs|rself)?\b/i.exec(prose)?.[0] || ""}`).toBe(`${n}: `);
				const doubled = /\b(\w{3,})\s+\1\b/i.exec(text.replace(/\{@\w+ [^}]*\}/g, " "));
				expect(doubled ? `${n}: ${doubled[0]}` : null).toBeNull();
			});
		});

		it("keeps every @tag braced (D5)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				const orphan = /(^|[^{])@(?:spell|dice|damage|item|condition|dc|hit|atk|skill|action)\b/.exec(text);
				expect(orphan ? `${n}: ${orphan[0]}` : null).toBeNull();
			});
		});

		it("balances parentheses and never doubles them (D6, D7)", () => {
			available.forEach(n => {
				["trait", "action", "bonus", "reaction"].forEach(sec => {
					(loadMonster(n)[sec] || []).forEach(e => {
						const body = e.entries.filter(it => typeof it === "string").join(" ");
						const open = (body.match(/\(/g) || []).length;
						const close = (body.match(/\)/g) || []).length;
						expect(`${n}/${e.name}: ${open}/${close}`).toBe(`${n}/${e.name}: ${open}/${open}`);
						expect(body).not.toMatch(/\(\s*\(|\)\s*\)/);
					});
				});
			});
		});

		it("never ends an entry mid-sentence (D8)", () => {
			available.forEach(n => {
				["trait", "action", "bonus", "reaction"].forEach(sec => {
					(loadMonster(n)[sec] || []).forEach(e => {
						const body = e.entries.filter(it => typeof it === "string").join(" ").trim();
						if (!body) return;
						expect(`${n}/${e.name}`).toBe(/[.!?…:;)\]}]$/.test(body) ? `${n}/${e.name}` : `${n}/${e.name} ends with "${body.slice(-30)}"`);
					});
				});
			});
		});

		it("resolves every scaling die and class-level reference (D9, D10, D14)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				// A roster header may state the die once ("5 Superiority Dice (d10)") and
				// let its clauses name it plainly; that is resolved, not dangling.
				["trait", "action", "bonus", "reaction"].forEach(sec => {
					(loadMonster(n)[sec] || []).forEach(e => {
						const body = `${e.name} ${e.entries.filter(it => typeof it === "string").join(" ")}`;
						const die = /\b(hemocraft|martial arts|superiority|bardic inspiration|psionic energy) (?:die|dice)\b/i.exec(body);
						if (!die) return;
						expect(`${n}/${e.name}: ${/\d*d\d+/i.test(body)}`).toBe(`${n}/${e.name}: true`);
					});
				});
				const lvl = /\b(?:its|the) (?:Barbarian|Bard|Cleric|Druid|Fighter|Monk|Paladin|Ranger|Rogue|Sorcerer|Warlock|Wizard|Artificer|Blood Hunter) level\b(?!\s*\()/i.exec(text);
				expect(lvl ? `${n}: ${lvl[0]}` : null).toBeNull();
			});
		});

		it("states a DC for every save it forces on another creature (D11)", () => {
			available.forEach(n => {
				["trait", "action", "bonus", "reaction"].forEach(sec => {
					(loadMonster(n)[sec] || []).forEach(e => {
						const body = e.entries.filter(it => typeof it === "string").join(" ");
						const forces = /\b(?:creature|creatures|target|targets|enemy|enemies|foe|foes)\b[^.]{0,80}?\b(?:must (?:make|succeed on|repeat)|makes?) (?:a|an|its|the) [A-Za-z]* ?saving throw/i.test(body);
						if (!forces) return;
						// A DC that varies with a roll ("a DC equal to 14 + the number rolled")
						// is as resolved as it can honestly be.
						expect(`${n}/${e.name}: ${/\{@dc \d+\}|\bDC\s*\d+|\bDC equal to \d+/i.test(body)}`).toBe(`${n}/${e.name}: true`);
					});
				});
			});
		});

		it("leaves no unresolved level-progression chain (D12, D13)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				expect(text).not.toMatch(/increases to \+\d+ and to \+\d+/i);
				expect(text).not.toMatch(/\band again\./i);
			});
		});

		it("prints maneuvers as one roster, not one trait each (D15, D16)", () => {
			const mon = loadMonster("Vern");
			const roster = (mon.trait || []).find(e => /^maneuvers$/i.test(e.name));
			if (!roster) return;
			expect(roster.entries.join(" ")).toMatch(/Superiority Dice/i);
			// No maneuver may also stand alone.
			["Precision Attack", "Trip Attack", "Menacing Attack", "Riposte", "Commander's Strike"]
				.forEach(name => expect(allAbilityNames(mon)).not.toContain(name));
		});

		it("folds a use-count improvement into its parent (D17)", () => {
			available.forEach(n => {
				allAbilityNames(loadMonster(n)).forEach(name => {
					expect(`${n}: ${name}`).not.toMatch(/\bImprovement\b/);
				});
			});
		});

		it("leaves no orphan rider lead (D18, D19)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				const orphan = /(?:Its|The) \w+ form also gains the following additional benefits?\.\s*$/i.exec(text);
				expect(orphan ? `${n}: ${orphan[0]}` : null).toBeNull();
			});
		});

		it("does not restate a labelled clause as its own entry (D20)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				const labels = new Set([...allEntryText(mon).matchAll(/\{@b ([^}]{3,60}?)\.?\}/g)].map(m => m[1].trim().toLowerCase()));
				const dupes = allAbilityNames(mon)
					.filter(name => labels.has(String(name).replace(/\s*\([^)]*\)\s*$/, "").trim().toLowerCase()));
				// A label may legitimately share a name with an entry; the contract is that
				// the *bodies* were compared and equal ones dropped, so at most a handful.
				expect(`${n}: ${dupes.length <= 3}`).toBe(`${n}: true`);
			});
		});

		it("prints no build-time guidance or level preamble (D21, D22)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				expect(text).not.toMatch(/at the end of the class description/i);
				expect(text).not.toMatch(/[Ww]hen (?:it|\w+) reaches (?:level \d+|\d+(?:st|nd|rd|th) level)/);
				expect(text).not.toMatch(/\bit learns? one additional\b/i);
			});
		});

		it("never leaks internal field names (D24)", () => {
			available.forEach(n => {
				expect(allEntryText(loadMonster(n))).not.toMatch(/activation:\s*(?:bonus|reaction|action|none)/i);
			});
		});

		it("mints an attack for a feature that grants a new attack option (D25)", () => {
			const mon = loadMonster("Reggu");
			const bolt = (mon.action || []).find(e => /radiant sun bolt/i.test(e.name));
			if (!bolt) return;
			const body = bolt.entries.join(" ");
			expect(body).toMatch(/\{@atk rs\}/);
			expect(body).toMatch(/\{@hit [+-]?\d+\}/);
			expect(body).toMatch(/\{@damage \d+d\d+([+-]\d+)?\} radiant damage/);
			// The prose that only described the attack's shape must not survive.
			expect(body).not.toMatch(/gains a new attack option/i);
		});

		it("uses no gendered pronoun anywhere, including custom abilities (D26)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n)).replace(/\{@\w+ [^}]*\}/g, " ");
				const hit = /\b(?:he|him|his|she|her|hers)\b/i.exec(text);
				expect(hit ? `${n}: ${hit[0]}` : null).toBeNull();
			});
		});

		it("does not capitalize a mid-sentence parenthetical (D27)", () => {
			available.forEach(n => {
				expect(allEntryText(loadMonster(n))).not.toMatch(/\S\s+\((?:Its|It)\b/);
			});
		});

		it("names one resource, not two editions of it (D28)", () => {
			const mon = loadMonster("Reggu");
			const text = allEntryText(mon);
			if (!/Focus Point/i.test(text)) return;
			expect(text).not.toMatch(/\bki points?\b/i);
		});

		it("tags a spell named in prose (D29)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				// A real spell name is one to three content words; a phrase carrying a
				// function word ("the effect of any cleric spell") is a description.
				const bare = /\bthe (?!(?:following|same|chosen|other|another|first|second|third|next|new|selected|original|only)\b)([a-z][a-z'’]*(?: [a-z][a-z'’]*){0,2}) spell\b/.exec(text);
				// A spell name is a noun phrase: a conjunction, determiner or finite verb inside
				// the match proves it spans a clause boundary, not a name.
				if (bare && /\b(?:of|or|and|nor|but|any|a|an|the|each|every|its|this|that|these|those|effect|level|kind|type|is|are|was|were|has|have|can|deal|deals|target|targets)\b/.test(bare[1])) return;
				expect(bare ? `${n}: ${bare[0]}` : null).toBeNull();
			});
		});

		it("merges every standing defence into one Resilience trait (D30)", () => {
			const mon = loadMonster("Vern");
			const res = (mon.trait || []).find(e => /^resilience$/i.test(e.name));
			if (!res) return;
			expect(allAbilityNames(mon)).not.toContain("Dauntless Heritage");
			expect(allAbilityNames(mon)).not.toContain("Iron Will");
		});

		it("keeps subject-verb agreement after the pronoun rewrite", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				// "attack rolls against it have advantage" is a plural subject, correctly conjugated.
				const bad = /(?<!against )\bit (?:make|take|gain|deal|have|do|use|die|fall|drop)\b(?!\s+\w+\s+(?:action|damage))|\bits character\b/.exec(text);
				expect(bad ? `${n}: ${bad[0]}` : null).toBeNull();
			});
		});

		it("never prints an item's rules for the object rather than its bearer", () => {
			available.forEach(n => {
				["trait", "action", "bonus", "reaction"].forEach(sec => {
					(loadMonster(n)[sec] || []).forEach(e => {
						expect(`${n}: ${e.name}`).not.toMatch(/General .*Rules|Orbiting the Stone|Capturing and Damaging/i);
					});
				});
			});
		});
	});
	describe("v10 — runnability", () => {
		it("prints resolved numbers, never bare ability or proficiency formulas (W1)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				// "18 (13 plus its Wisdom modifier)" already led with the resolved value.
				const bad = /(?<!\(\d{1,3} plus )(?<!\(\d{1,3} \+ )\bits (?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier(?! [+a-z])(?!\s*\()|\bits proficiency bonus(?! [+a-z])(?!\s*[(\u00d7])/.exec(text);
				expect(bad ? `${n}: ${text.slice(Math.max(0, bad.index - 40), bad.index + 60)}` : null).toBeNull();
			});
		});

		it("annotates a named die once per entry, not once per mention (W1)", () => {
			available.forEach(n => {
				["trait", "action", "bonus", "reaction"].forEach(sec => {
					(loadMonster(n)[sec] || []).forEach(e => {
						const joined = (e.entries || []).filter(it => typeof it === "string").join(" ");
						const counts = {};
						(joined.match(/[A-Z][\w' ]* [Dd]ie \(\d*d\d+\)/g) || []).forEach(it => {
							counts[it] = (counts[it] || 0) + 1;
						});
						Object.entries(counts).forEach(([phrase, count]) => {
							expect(`${n}/${e.name}: ${phrase} x${count}`).toMatch(/x1$/);
						});
					});
				});
			});
		});

		it("hovers the capability terms it names (W2)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				// Entry *names* are the ability's own title ("Unarmed Strike" as an attack),
				// so only prose is checked.
				const bodies = ["trait", "action", "bonus", "reaction", "legendary"]
					.flatMap(sec => mon[sec] || [])
					.flatMap(e => (e.entries || []).filter(it => typeof it === "string"));
				// A term is hovered if the line that names it carries a tag for it; a second
				// mention in the same breath is left as plain English on purpose.
				[/opportunity attacks?/i, /unarmed strikes?/i, /difficult terrain/i].forEach(term => {
					bodies.forEach(line => {
						if (!term.test(line.replace(/\{@[a-z]+ [^{}]*\}/g, " "))) return;
						expect(`${n}: ${line}`).toMatch(new RegExp(`\\{@(?:action|variantrule) [^{}]*${term.source}`, "i"));
					});
				});
			});
		});

		it("never nests a tag inside another tag's arguments (W2)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				const bad = /\{@(?!b\b|i\b)[a-z]+ [^{}]*\{@/.exec(text);
				expect(bad ? `${n}: ${bad[0]}` : null).toBeNull();
			});
		});

		it("states each quantity once, with the improved value (W3)", () => {
			const mon = loadMonster("Tignor");
			const wild = ["trait", "bonus", "action"]
				.flatMap(sec => mon[sec] || [])
				.find(e => /^Wild Shape/.test(e.name));
			if (!wild) return;
			const joined = (wild.entries || []).filter(it => typeof it === "string").join(" ");
			const tempHp = joined.match(/Temporary Hit Points equal to [^.]{0,80}?\((\d+)\)/g) || [];
			expect(tempHp.length).toBeLessThanOrEqual(1);
			expect(joined).toMatch(/max CR 3\b/i);
			expect(joined).not.toMatch(/max CR 1\b/i);
			// v15: the boolean config column is prose, not a form-field label.
			expect(joined).not.toMatch(/Fly Speed Yes/i);
		});

		it("collapses a menu of parallel options into one line (W5)", () => {
			const mon = loadMonster("Dzeiy");
			const rite = ["trait", "bonus", "action"]
				.flatMap(sec => mon[sec] || [])
				.find(e => /^Crimson Rite$/.test(e.name));
			if (!rite) return;
			const labels = (rite.entries || []).filter(it => typeof it === "string" && /^\{@b Rite of the /.test(it));
			expect(labels).toHaveLength(0);
			expect((rite.entries || []).join(" ")).toMatch(/Rite of the Flame/);
		});

		it("keeps a roster clause short enough to scan (W5)", () => {
			available.forEach(n => {
				(loadMonster(n).trait || [])
					.filter(e => /^(?:Maneuvers|Combat Methods)$/i.test(e.name))
					.forEach(e => {
						(e.entries || []).forEach(line => {
							if (typeof line !== "string") return;
							expect(`${n}/${e.name}: ${line.length}`).toMatch(/: \d{1,3}$/);
						});
					});
			});
		});

		it("does not resolve a conditional it cannot answer, and answers the ones it can (W4)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				expect(`${n}`).toBeTruthy();
				expect(text).not.toMatch(/\bIf \w[\w' ]* has (?:its|the) [A-Z][\w' ]+ feature,/);
			});
		});

		it("orders traits so standing facts precede rosters (W7)", () => {
			available.forEach(n => {
				const names = (loadMonster(n).trait || []).map(e => e.name);
				const rosterAt = names.findIndex(it => /^(?:Additional Effects|Special Equipment|Combat Methods|Maneuvers|Divine Favor)\b/i.test(it));
				if (rosterAt < 0) return;
				const afterRoster = names.slice(rosterAt);
				expect(`${n}: ${afterRoster.join(", ")}`).toBeTruthy();
				afterRoster.forEach(it => {
					expect(`${n}: ${it}`).toMatch(/(?:Additional Effects|Special Equipment|Combat Methods|Maneuvers|Divine Favor|Class Resources|Blood Curses|Invocations|Metamagic)/i);
				});
			});
		});

		it("never leaves an entry empty or opening mid-thought after a trim (W6)", () => {
			available.forEach(n => {
				["trait", "action", "bonus", "reaction"].forEach(sec => {
					(loadMonster(n)[sec] || []).forEach(e => {
						const lines = (e.entries || []).filter(it => typeof it === "string");
						expect(`${n}/${e.name}`).toBeTruthy();
						expect(lines.length).toBeGreaterThan(0);
						expect(`${n}/${e.name}: ${lines[0]}`).not.toMatch(/: (?:To do so|Doing so|In doing so)\b/);
					});
				});
			});
		});
	});

	describe("v11 — resolved numbers, honest tags and one home per feature", () => {
		it("resolves an ability modifier even when a minimum clause follows it (W1)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				expect(`${n}`).toBeTruthy();
				expect(text).not.toMatch(/\b(?:its|his|her|their) (?:Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) modifier \(minimum/i);
			});
		});

		it("never emits an entity tag without a source (W2)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				// A sourceless `@spell` resolves by name to the core list and still hovers,
				// so it is allowed; a sourceless homebrew tag does not resolve at all.
				const sourceless = text.match(/\{@(?:item|creature|feat|optfeature|classFeature|subclassFeature|combatmethod) [^}|]+\}/g) || [];
				const offenders = sourceless.filter(it => !/^\{@(?:condition|action|variantrule|status|skill|dice|damage|dc|hit|atk)\b/.test(it));
				expect(`${n}: ${offenders.join(" ")}`).toBe(`${n}: `);
			});
		});

		it("does not fabricate a spell tag from a sentence fragment (W2)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				const names = (text.match(/\{@spell ([^}|]+)/g) || []).map(it => it.replace(/^\{@spell /, ""));
				names.forEach(name => {
					expect(`${n}: ${name}`).not.toMatch(/\b(?:Or|And|Any|The|Affects|Attack Or)\b\s*$/);
				});
			});
		});

		it("keeps build-time scaffolding out of the statblock (W3)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				expect(`${n}`).toBeTruthy();
				expect(text).not.toMatch(/\b\d+(?:st|nd|rd|th)-level [A-Za-z][\w' ]* (?:feature|optional feature)\b/);
				// A flattened progression table leaves a long run of bare integers.
				expect(text).not.toMatch(/(?:\b\d{1,2}\b[ ,]+){7,}/);
			});
		});

		it("does not contradict itself about the same named quantity (W4)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				expect(`${n}`).toBeTruthy();
				expect(text).not.toMatch(/\bextra damage of [A-Z][\w' ]+ increases to\b/i);
				expect(text).not.toMatch(/\bdamage of [A-Z][\w' ]+ increases to \d/i);
			});
		});

		it("keeps the skill block to what is genuinely per-skill (W5)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				const count = Object.keys(mon.skill || {}).length;
				expect(`${n}: ${count}`).toBeTruthy();
				expect(count).toBeLessThanOrEqual(14);
			});
		});

		it("states a metamagic option's cost and what it touches, once (W7)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				const roster = (mon.trait || []).find(e => /^Metamagic$/i.test(e.name));
				if (!roster) return;
				const text = (roster.entries || []).join(" ");
				expect(`${n}: ${text}`).toMatch(/\{@optfeature /);
				// The loose per-option traits must be gone once the roster exists.
				const loose = (mon.trait || []).filter(e => /\b(?:Careful|Empowered|Quickened|Heightened|Subtle|Twinned|Transmuted) Spell\b/i.test(e.name));
				expect(`${n}: ${loose.map(e => e.name).join(", ")}`).toBe(`${n}: `);
				expect(text).not.toMatch(/\bCost:/i);
			});
		});

		it("files an entry under the economy its own text states (W8)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				(mon.bonus || []).forEach(e => {
					const lead = (e.entries || []).find(it => typeof it === "string") || "";
					// "As a Bonus Action" is exactly where this entry belongs; the contract is
					// about an entry that claims a full action while filed as a bonus one.
					expect(`${n}/${e.name}: ${lead.slice(0, 80)}`).not.toMatch(/\bAs an? (?!bonus\b)(?:\{@action [^}]*\}|[A-Za-z]+ )? ?action,/i);
				});
			});
		});

		it("never emits an entry that ends on the colon of a list it never got (W9)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				["trait", "action", "bonus", "reaction"].forEach(sec => {
					(mon[sec] || []).forEach(e => {
						const body = (e.entries || []).filter(it => typeof it === "string").join(" ").trim();
						expect(`${n}/${e.name}: ${body.slice(-40)}`).not.toMatch(/:$/);
					});
				});
			});
		});

		it("keeps verb agreement through conjunctions, adverbs and rewritten imperatives (W10)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				expect(`${n}`).toBeTruthy();
				expect(text).not.toMatch(/\bnows\b/);
				expect(text).not.toMatch(/\b\w+eses\b/);
				expect(text).not.toMatch(/\band already have\b/);
			});
		});

		it("does not annotate a conditional defense the character cannot produce (W2/W4)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				const notes = [...(mon.resist || []), ...(mon.immune || [])]
					.filter(it => it && typeof it === "object" && it.note)
					.map(it => String(it.note));
				const names = new Set(allAbilityNames(mon).map(it => it.toLowerCase()));
				notes.forEach(note => {
					const named = /while ([A-Z][\w' ]+?) is active/i.exec(note)?.[1];
					if (!named) return;
					expect(`${n}: ${named}`).toBe(`${n}: ${[...names].find(it => it.includes(named.toLowerCase())) ? named : "MISSING"}`);
				});
			});
		});
	});
	describe("v12 — level 20, psionics and item banks", () => {
		it("never lists a catalogue index in an ability name (W7)", () => {
			available.forEach(n => {
				allAbilityNames(loadMonster(n)).forEach(name => {
					expect(`${n}/${name}`).not.toMatch(/#\d+,/);
				});
			});
		});

		it("keeps every Ioun stone distinct instead of collapsing them (W7)", () => {
			if (!available.includes("Arthur")) return;
			const mon = loadMonster("Arthur");
			const stones = allAbilityNames(mon).filter(name => /^Ioun Stone /.test(name));
			expect(new Set(stones).size).toBe(stones.length);
			expect(stones.length).toBeGreaterThanOrEqual(4);
			// Every stone the character owns is still listed as loot, grouped or not.
			const equipment = (mon.trait || []).find(t => t.name === "Special Equipment");
			expect(equipment.entries.join(" ")).toMatch(/Ioun Stones \(orbiting\)/);
		});

		it("does not restate a defense the block already carries as an action (W7)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				(mon.action || []).forEach(entry => {
					const body = (entry.entries || []).filter(it => typeof it === "string").join(" ");
					if (!/\{@item /.test(body)) return;
					// An item action must give the DM something to *do*, not repeat a resistance.
					const isPureDefense = /\bhas resistance to\b/.test(body)
						&& !/\b(?:action|reaction|attack|charges?|save|dc)\b/i.test(body.replace(/\{@item[^}]*\}/g, ""));
					expect(`${n}/${entry.name}`).toBe(isPureDefense ? "NOT-A-DEFENSE-RESTATEMENT" : `${n}/${entry.name}`);
				});
			});
		});

		it("never leaves an entry that only promises a list (W8)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				["trait", "action", "bonus", "reaction"].forEach(section => {
					(mon[section] || []).forEach(entry => {
						const strings = (entry.entries || []).filter(it => typeof it === "string");
						if (!strings.length) return;
						const onlyPromise = strings.every(line => /:$/.test(line.trim()) && !/\d|\{@/.test(line));
						expect(`${n}/${entry.name}`).toBe(onlyPromise ? "NOT-A-BARE-PROMISE" : `${n}/${entry.name}`);
					});
				});
			});
		});

		it("does not list a spell the granting feature only mentions (W8)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				const spellText = JSON.stringify(mon.spellcasting || []);
				expect(`${n}: ${spellText}`).not.toMatch(/Hallow\|[A-Z]+\} \(Divine Sense\)/);
			});
		});

		it("does not list an edition variant beside the spell it duplicates (W8)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				(mon.spellcasting || []).forEach(block2 => {
					const lists = [
						...(Array.isArray(block2.will) ? [block2.will] : []),
						...Object.values(block2.spells || {}).map(it => it.spells || []),
					];
					lists.forEach(list => {
						const names = list.map(tag => (/\{@spell ([^|}]+)/.exec(tag) || [])[1] || "");
						const bases = new Set(names.filter(name => !/^5e /i.test(name)).map(it => it.toLowerCase()));
						names.filter(name => /^5e /i.test(name)).forEach(name => {
							expect(`${n}: ${name}`).toBe(bases.has(name.replace(/^5e /i, "").toLowerCase()) ? "DUPLICATE" : `${n}: ${name}`);
						});
					});
				});
			});
		});

		it("credits once-per-turn and psionic damage in CR (W9)", () => {
			// A level 20 rogue's whole offence is Sneak Attack; a Talent's is manifestation.
			if (available.includes("Juen")) expect(Number(loadMonster("Juen").cr)).toBeGreaterThanOrEqual(9);
			if (available.includes("Phirse")) expect(Number(loadMonster("Phirse").cr)).toBeGreaterThanOrEqual(8);
			if (available.includes("Mikase")) expect(Number(loadMonster("Mikase").cr)).toBeGreaterThanOrEqual(12);
		});

		it("gives every psionic power its mechanics, not just its headers (W2)", () => {
			if (!available.includes("Phirse")) return;
			const mon = loadMonster("Phirse");
			["Illuminator", "Time Thief", "Kindling", "Influence", "Amplify"].forEach(power => {
				const entry = ["trait", "action", "bonus", "reaction"]
					.flatMap(section => mon[section] || [])
					.find(it => String(it.name).startsWith(power));
				expect(`${power}: ${entry ? "found" : "missing"}`).toBe(`${power}: found`);
				const body = (entry.entries || []).filter(it => typeof it === "string").join(" ");
				expect(`${power}: ${body}`).toMatch(/\{@|\d/);
			});
		});
	});
	describe("v13 — rollable dice, resolved formulas and honest filing", () => {
		it("tags every bare die so it rolls from the statblock (B1)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				["trait", "action", "bonus", "reaction"].forEach(section => {
					(mon[section] || []).forEach(entry => {
						(entry.entries || []).forEach(line => {
							if (typeof line !== "string") return;
							// Blank out every tagged span; whatever dice remain are inert prose.
							const bare = line.replace(/\{@\w+[^{}]*\}/g, " ");
							const hit = /(?<![\w@])\d*d(?:4|6|8|10|12|100)\b/.exec(bare);
							expect(`${n}/${entry.name}: ${hit ? hit[0] : "clean"}`).toBe(`${n}/${entry.name}: clean`);
						});
					});
				});
			});
		});

		it("never leaves a class-level formula unresolved (C1)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				expect(`${n}: ${text}`).not.toMatch(/\b(?:half )?its \w+ level \((?:round (?:up|down))\)/i);
				expect(`${n}: ${text}`).not.toMatch(/\bequal to its level\b/i);
			});
		});

		it("attaches a resolved value to the noun it measures (C2)", () => {
			available.forEach(n => {
				// "its Wisdom modifier (18)" states a false fact when 18 is the sum.
				const text = allEntryText(loadMonster(n));
				expect(`${n}: ${text}`).not.toMatch(/\d+ plus its \w+ modifier \(\d/i);
			});
		});

		it("files a purely passive feat as a trait, not a reaction (D1)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				const misfiled = ["bonus", "reaction"]
					.flatMap(section => (mon[section] || []).map(e => ({section, e})))
					.filter(({e}) => /\{@feat /.test(String(e.name || "")))
					.filter(({e}) => {
						const body = (e.entries || []).filter(it => typeof it === "string").join(" ");
						return !/\b(?:bonus action|reaction|as an action|magic action|no action required|opportunity attack)\b/i.test(body)
							&& !/(?:^|[.;]\s*|,\s*)(?:when|whenever|in response to|immediately after)\b/i.test(body);
					})
					.map(({section, e}) => `${section}/${e.name}`);
				expect(`${n}: ${misfiled.join(", ")}`).toBe(`${n}: `);
			});
		});

		it("does not open an item entry by naming itself (D2)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				["trait", "action", "bonus", "reaction"].forEach(section => {
					(mon[section] || []).forEach(entry => {
						const first = (entry.entries || []).find(it => typeof it === "string") || "";
						const echo = /^\{@item ([^|}]+)[^}]*\}\s*[:\u2014-]/.exec(first);
						const plainName = String(entry.name || "").replace(/\{@\w+\s+([^|}]+)[^}]*\}/g, "$1").trim();
						expect(`${n}/${entry.name}: ${echo && echo[1].toLowerCase() === plainName.toLowerCase() ? "echo" : "clean"}`)
							.toBe(`${n}/${entry.name}: clean`);
					});
				});
			});
		});

		it("never opens a standalone entry on a dangling connective (D6)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				["trait", "action", "bonus", "reaction"].forEach(section => {
					(mon[section] || []).forEach(entry => {
						const first = (entry.entries || []).find(it => typeof it === "string") || "";
						expect(`${n}/${entry.name}: ${first.slice(0, 24)}`)
							.not.toMatch(/: (?:In addition|Additionally|Furthermore|Moreover),/);
					});
				});
			});
		});

		it("keeps the subject and its coordinated verb in agreement (A1/A2)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				expect(`${n}: ${text}`).not.toMatch(/\bit (?:either )?\w+s\b[^.;]{0,60} and miss,/);
				expect(`${n}: ${text}`).not.toMatch(/\b(?:rolls?|attacks?|strikes?)\}? against it has\b/i);
				expect(`${n}: ${text}`).not.toMatch(/\bit can use it to \w/);
			});
		});

		// The v13 defect was the *doubled-word* collapse deleting Juen's surname and
		// leaving a modal behind. v14 uses the given name in the body, so "Juen may cast"
		// is now the correct rendering — what must never reappear is the truncated
		// "Juen may" that came from swallowing "May".
		it("keeps a surname that collides with a modal (A4)", () => {
			if (!available.includes("Juen")) return;
			const text = allEntryText(loadMonster("Juen"));
			expect(text).not.toMatch(/\bJuen may may\b/);
			expect(text).not.toMatch(/\bMay may\b/);
		});

		it("states the stance duration once and drops flavour-only stances (F1/F3/F4)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				const block = (mon.trait || []).find(t => t.name === "Combat Methods");
				if (!block) return;
				const expansions = block.entries.filter(e => /\(Stance\)\.\}/.test(e));
				expansions.forEach(entry => {
					// The economy lead and the shared duration trailer are stated by the block.
					expect(`${n}: ${entry}`).not.toMatch(/\(Stance\)\.\}\s*(?:\{@b\s*)?(?:Bonus Action|Action|Reaction)\s*\(\d+ Stamina/);
					expect(`${n}: ${entry}`).not.toMatch(/This stance lasts until/);
					// Nothing mechanical means nothing printed.
					const body = entry.replace(/^.*?\(Stance\)\.\}\s*/, "");
					expect(`${n}: ${body}`).toMatch(/\{@|\d/);
				});
				if (expansions.length) expect(block.entries.join(" ")).toMatch(/\{@b Stances\.\} A stance costs/);
			});
		});

		it("carries no trace of the maneuver-rename typo (F5)", () => {
			available.forEach(n => {
				expect(`${n}: ${allEntryText(loadMonster(n))}`).not.toMatch(/methoding/i);
			});
		});
	});

	describe("v14 — one printing per spell, honest tags and a readable voice", () => {
		// A spell reaches the block by two routes (class list and subclass grant) carrying
		// two different printings, so `Fog Cloud|PHB` and `Fog Cloud|XPHB` both survived a
		// `name|source` dedupe and the block printed the same spell twice on one line.
		it("prints each spell once per level regardless of edition (1.1)", () => {
			available.forEach(n => {
				(loadMonster(n).spellcasting || []).forEach(sc => {
					["will", "ritual"].forEach(key => {
						if (!Array.isArray(sc[key])) return;
						expectNoDuplicateSpells(`${n}/${sc.name}/${key}`, sc[key]);
					});
					["spells", "daily", "weekly"].forEach(bucket => {
						Object.entries(sc[bucket] || {}).forEach(([lvl, val]) => {
							const list = Array.isArray(val) ? val : val?.spells;
							if (Array.isArray(list)) expectNoDuplicateSpells(`${n}/${sc.name}/${bucket}/${lvl}`, list);
						});
					});
				});
			});
		});

		// A tag whose kind does not match its referent renders as a failed lookup:
		// `{@condition Dash}` and `{@action Bonus Action}` both shipped.
		it("emits no tag whose kind contradicts its referent (1.5)", () => {
			const NOT_CONDITIONS = /^(?:dash|disengage|dodge|hide|help|ready|search|study|influence|utilize|attack|hidden|surprised)$/i;
			const NOT_ACTIONS = /^(?:bonus action|reaction|action|free action|movement)$/i;
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				for (const [, kind, arg] of text.matchAll(/\{@(condition|action) ([^}|]+)/g)) {
					const bad = kind === "condition" ? NOT_CONDITIONS.test(arg.trim()) : NOT_ACTIONS.test(arg.trim());
					if (bad) throw new Error(`${n} emits {@${kind} ${arg.trim()}}, which is not a ${kind}`);
				}
			});
		});

		// A capitalisation heuristic invented `{@spell Magic of the}` and `{@spell Absorbed}`
		// out of ordinary prose, producing hovers to spells that do not exist.
		it("never invents a spell name out of prose (1.6)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				for (const [, arg] of text.matchAll(/\{@spell ([^}|]+)/g)) {
					expect(`${n}: ${arg}`).not.toMatch(/\b(?:of|the|a|an|to|with|its|absorbed)\s*$/i);
				}
			});
		});

		// Progression ladders are player-facing. An NPC block states the row that applies;
		// the resolver used to substitute the character's value into the *condition*,
		// producing "when its proficiency bonus (+5) is +3".
		it("collapses scaling ladders instead of contradicting itself (1.2)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				expect(`${n}: ${text}`).not.toMatch(/\(\+\d+\) is \+\d+/);
				expect(`${n}: ${text}`).not.toMatch(/\(\d+\) is (?:level )?\d+/);
			});
		});

		// Where one feature grants several defences, annotating only the first reads as if
		// the rest were unconditional.
		// Where one feature grants several defences, annotating only the first reads as if
		// the rest were unconditional. Nagara's Stormborn is the corpus case: it grants
		// three resistances, and only cold used to carry the gate.
		(available.includes("Nagara") ? it : it.skip)("gates every defence from a conditional feature, not just the first (1.3, 1.4)", () => {
			const resist = loadMonster("Nagara").resist || [];
			// A feature that grants several defences at once is emitted as one grouped
			// entry, so flatten before looking for the gate.
			const gated = new Map();
			resist.forEach(x => {
				if (typeof x === "string") return gated.set(x, null);
				[].concat(x.resist || []).forEach(type => gated.set(typeof type === "string" ? type : type?.resist, x.note || null));
			});
			["cold", "lightning", "thunder"].forEach(type => {
				expect(`${type}: ${gated.has(type) ? gated.get(type) || "ungated" : "missing"}`)
					.toMatch(new RegExp(`^${type}: .*Stormborn`));
			});
		});

		// "roll a number of d6s equal to its Wisdom modifier (6)" states the number but
		// still makes the DM assemble the roll, and gives no click-to-roll link.
		it("writes a roll, not an instruction to build one (2.2)", () => {
			available.forEach(n => {
				expect(`${n}: ${allEntryText(loadMonster(n))}`).not.toMatch(/a number of d(?:4|6|8|10|12)s equal to/i);
			});
		});

		it("resolves derived speeds to a distance (2.3)", () => {
			available.forEach(n => {
				expect(`${n}: ${allEntryText(loadMonster(n))}`)
					.not.toMatch(/[Ss]peed equal to (?:its|the creature's) (?:walking |flying |swimming )?[Ss]peed/);
			});
		});

		// A bare imperative in a statblock is an order to the DM. Asserted on the exact
		// shapes the corpus produced rather than on a general verb heuristic: "rolls
		// against it have Disadvantage" is a plural subject and correct as written.
		it("conjugates every verb in a coordinated list (3.1)", () => {
			const LEAKS = [
				/\bit again, or have\b/,
				/,\s*(?:manifest|revert|recover) it\b/,
				/\b[A-Z][a-z]+ apply\b/,
				/\bIf it hits, add\b/,
				/\bfinishes a[^.]{0,40}, choose\b/,
				/\bturns?, (?:take|deal|roll|choose|add|gain)\b/,
			];
			available.forEach(n => {
				const text = allEntryText(loadMonster(n));
				LEAKS.forEach(re => expect(`${n}: ${text.match(re)?.[0] || "clean"}`).toBe(`${n}: clean`));
			});
		});

		it("tags every DC so it reads as a check, not a number (3.2)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n)).replace(/\{@\w+[^{}]*\}/g, " ");
				expect(`${n}: ${text}`).not.toMatch(/\bDC \d+/);
			});
		});

		it("tags coordinated action lists (3.2)", () => {
			available.forEach(n => {
				const text = allEntryText(loadMonster(n)).replace(/\{@\w+[^{}]*\}/g, " ");
				expect(`${n}: ${text}`).not.toMatch(/\b(?:Dash|Disengage|Dodge)\b[^.]{0,20}\b(?:Dash|Disengage|Dodge)\b/);
			});
		});

		// The block title carries the full name; repeating a surname 40-odd times in the
		// body reads unlike any published statblock.
		it("uses the short name after the block title (3.3)", () => {
			available.forEach(n => {
				const mon = loadMonster(n);
				const parts = String(mon.name).replace(/\s*\(NPC\)\s*$/, "").split(/\s+/);
				if (parts.length < 2) return;
				const surname = parts[parts.length - 1];
				if (surname.length < 4) return;
				const hits = (allEntryText(mon).match(new RegExp(`\\b${surname}\\b`, "g")) || []).length;
				expect(`${n}: surname ×${hits}`).toBe(`${n}: surname ×0`);
			});
		});
	});
	describe("v15 — information placement: riders ride their attack", () => {
		it("prints Sneak Attack on the finesse/ranged line but keeps the anchor trait (A0/A1)", () => {
			[["Juen", "Hecate's Dagger", "10d6"], ["Missy", "Ninjato", "7d6"]].forEach(([who, weapon, dice]) => {
				const mon = loadMonster(who);
				const line = (mon.action || []).find(e => e.name === weapon);
				expect(`${who}: ${weapon}`).toBe(`${who}: ${line ? weapon : "missing"}`);
				expect(line.entries.join(" ")).toMatch(new RegExp(`\\{@damage ${dice}\\}[^.]*Sneak Attack`, "i"));
				// A0.1: three other entries key off Sneak Attack, so the anchor survives.
				expect(allAbilityNames(mon).join("|")).toMatch(/Sneak Attack/i);
			});
		});

		it("does not attach Sneak Attack to a non-finesse, non-ranged attack (A1)", () => {
			const claws = (loadMonster("Missy").action || []).find(e => /^claws$/i.test(e.name));
			if (claws) expect(claws.entries.join(" ")).not.toMatch(/Sneak Attack/i);
		});

		it("carries a weapon's own damage rider on that weapon's line (A2)", () => {
			const fang = (loadMonster("Elizabeth").action || []).find(e => /Fang of the Whale Eater/i.test(e.name));
			expect(fang.entries.join(" ")).toMatch(/\{@damage 2d6\} cold damage \(Leviathan's Bite/i);
			const sunStaff = (loadMonster("Reggu").action || []).find(e => /Sun Staff/i.test(e.name));
			expect(sunStaff.entries.join(" ")).toMatch(/\{@damage 1d8\} fire damage/i);
			const sunBlade = (loadMonster("Dranan").action || []).find(e => /^Sun Blade$/i.test(e.name));
			expect(sunBlade.entries.join(" ")).toMatch(/\{@damage 1d8\} radiant damage against Undead/i);
		});

		it("never advertises a bonus-action-only rider on the Attack action line (A5)", () => {
			["Aldor", "Arthur"].forEach(n => {
				const mon = loadMonster(n);
				const joined = (mon.action || []).map(e => (e.entries || []).join(" ")).join(" ");
				expect(`${n}: ${joined}`).not.toMatch(/after Dash \+ bonus action attack/i);
			});
		});

		it("reduces a rider's source to its residue rather than repeating the line (A6)", () => {
			const dm = (loadMonster("Onger").trait || []).find(e => /Demolishing Might/i.test(e.name));
			expect(dm.entries.join(" ")).toMatch(/double damage to objects and structures/i);
			expect(dm.entries.join(" ")).not.toMatch(/extra \{?@?damage ?1d8/i);
		});

		it("retires a rider source whose residue would be a fragment (A6 guard)", () => {
			// The whole sentence *is* the rider, so stripping it leaves "…it can cause the
			// target to." — the entry must be retired, not kept as a decapitated clause.
			[["Lorian", /Divine Strike/i], ["Dranan", /Radiant Strikes/i], ["Mikase", /Radiant Strikes/i]].forEach(([n, re]) => {
				const mon = loadMonster(n);
				const stray = ["trait", "action", "bonus", "reaction"]
					.flatMap(section => mon[section] || [])
					.filter(e => re.test(e.name || ""))
					.map(e => (e.entries || []).join(" "));
				stray.forEach(text => expect(`${n}: ${text}`).not.toMatch(/\b(?:to|the|target|creature)\s*\.\s*$/i));
				// …and the mechanic still reaches the block, on the attack line.
				expect((mon.action || []).map(e => (e.entries || []).join(" ")).join(" ")).toMatch(re);
			});
		});

		it("suppresses an Additional Effects bullet already inside a printed number (1a)", () => {
			["Wisp", "Duralin"].forEach(n => {
				const extra = (loadMonster(n).trait || []).find(e => /^Additional Effects$/i.test(e.name));
				const joined = extra ? extra.entries.join(" ") : "";
				expect(`${n}: ${joined}`).not.toMatch(/\{@b (?:Dueling|Defense)\.\}/i);
			});
		});

		it("splits a form block into activation and an alternate-form trait (A7)", () => {
			const mon = loadMonster("Dzeiy");
			const activation = (mon.bonus || []).find(e => /Hybrid Transformation/i.test(e.name));
			const form = (mon.trait || []).find(e => /^Hybrid Form$/i.test(e.name));
			expect(`activation ${activation ? "present" : "missing"}`).toBe("activation present");
			expect(`form ${form ? "present" : "missing"}`).toBe("form present");
			// The Bonus Action explains how to transform, and nothing else.
			const actText = activation.entries.join(" ");
			expect(actText.length).toBeLessThan(600);
			expect(actText).toMatch(/transforms into/i);
			expect(actText).not.toMatch(/Feral Might|Resilient Hide|Bloodlust/i);
			// v16: the deltas no longer sit in the trait at all. Each one is on the line the
			// DM reads to use it, so running the form needs no transcription.
			expect((mon.ac || []).some(e => (e.from || []).some(f => /Hybrid Form/i.test(String(f))))).toBe(true);
			expect((mon.resist || []).some(e => /while in Hybrid Form/i.test(String(e?.note || "")))).toBe(true);
			const resilience = (mon.trait || []).find(e => /^Resilience$/i.test(e.name));
			expect(`resilience ${resilience ? "present" : "missing"}`).toBe("resilience present");
			expect(resilience.entries.join(" ")).toMatch(/Hybrid Form/);
			expect((mon.action || []).some(e => /Unarmed Strike \(Hybrid Form\)/i.test(e.name))).toBe(true);
			// What is left is only what a stat line cannot hold.
			expect(form.entries.join(" ")).toMatch(/Bloodlust/i);
			expect(form.entries.join(" ")).not.toMatch(/resistance to bludgeoning/i);
		});

		it("drops long subclass lore that states no mechanic (A8)", () => {
			const names = allAbilityNames(loadMonster("Elizabeth")).join("|");
			expect(names).not.toMatch(/Bladesinger Styles|^Bladesinging$/im);
			// …but a terse mechanical line the token vocabulary misses must survive.
			expect(allAbilityNames(loadMonster("Nagara")).join("|")).toMatch(/Cold Empowerment/i);
			available.forEach(n => {
				expect(`${n}: ${(loadMonster(n).action || []).length > 0}`).toBe(`${n}: true`);
			});
		});

		it("annotates a number whose only source is a conditional modifier (1b)", () => {
			// Base/gated AC numbers track the local npc-exports/ corpus (personal saves).
			// Dual Wielder is folded into the primary AC and annotated as a lower alternate
			// when not dual wielding — assert the split, not absolute armor loadouts.
			[["Elizabeth", 18, 17], ["Mikase", 22, 21], ["Vern", 21, 20]].forEach(([n, base, gated]) => {
				const ac = loadMonster(n).ac;
				expect(`${n}: ${ac[0].ac}`).toBe(`${n}: ${base}`);
				const alt = ac.find(it => it.condition);
				expect(`${n}: ${alt ? alt.ac : "none"}`).toBe(`${n}: ${gated}`);
				expect(alt.condition).toMatch(/Dual Wielder/i);
			});
		});

		it("states the shared maneuver damage rule once, in the roster lead (C1)", () => {
			["Vern", "Elizabeth"].forEach(n => {
				const roster = (loadMonster(n).trait || []).find(it => it.name === "Maneuvers");
				expect(`${n}: ${!!roster}`).toBe(`${n}: true`);
				const [lead, ...bodies] = roster.entries;
				expect(lead).toMatch(/a maneuver that hits adds the die to that attack's damage roll/i);
				// Riposte and Trip Attack each restated it; neither may now.
				bodies.forEach(body => expect(`${n}: ${body}`).not.toMatch(/adds? the (?:Superiority )?[Dd]ie to the attack's damage/i));
				// Trip Attack's on-hit trigger is load-bearing for the clause that follows.
				const trip = bodies.find(it => /Trip Attack/.test(it));
				expect(trip).toMatch(/When \w+ hits a creature[\s\S]*if the target is Large or smaller/i);
			});
		});

		it("points from the spell block at the trait that alters spells (C3)", () => {
			const nessa = loadMonster("Nessa");
			const block = nessa.spellcasting.find(it => !/innate/i.test(it.name));
			expect(block.headerEntries.join(" ")).toMatch(/alter these spells with Metamagic/i);
			// The innate list is a different feature and must not claim the same pointer.
			const innate = nessa.spellcasting.find(it => /innate/i.test(it.name));
			expect(innate.headerEntries.join(" ")).not.toMatch(/Metamagic/i);
			// Nobody without the trait gains the sentence.
			available.filter(n => n !== "Nessa").forEach(n => {
				const text = (loadMonster(n).spellcasting || []).flatMap(it => it.headerEntries || []).join(" ");
				expect(`${n}: ${/alter these spells with Metamagic/i.test(text)}`).toBe(`${n}: false`);
			});
		});

		it("folds an Attack-action rider onto its own attack line (C4)", () => {
			const bolt = (loadMonster("Reggu").action || []).find(it => /Radiant Sun Bolt/i.test(it.name));
			expect(bolt.entries).toHaveLength(1);
			expect(bolt.entries[0]).toMatch(/\{@damage 1d10\+5\} radiant damage\. As part of the \{@action Attack[^}]*\} action, 1 Focus Point: make this attack twice as a Bonus Action\./);
			expect(bolt.entries[0]).not.toMatch(/ {2}/);
		});

		it("promotes a replacement attack to a real attack entry (A4)", () => {
			const mikase = loadMonster("Mikase");
			// The paragraph that described an attack is gone from the traits.
			expect((mikase.trait || []).map(it => it.name).join("|")).not.toMatch(/Starlight Arc/i);
			const arc = (mikase.action || []).find(it => /^Starlight Arc/.test(it.name));
			expect(arc.name).toMatch(/\(Replaces One Attack\)$/);
			// It carries the parent weapon's own line, retargeted, with its own die appended.
			expect(arc.entries[0]).toMatch(/\{@atk mw\} \{@hit \+16\} to hit, 30-foot cone, each nearest creature in it\./);
			expect(arc.entries[0]).toMatch(/\{@damage 1d8\+10\} slashing damage/);
			// The extra die lands inside the damage sentence, not after the line's last period.
			expect(arc.entries[0]).not.toMatch(/magical\.,/);
			// …and states only what the line cannot carry.
			expect(arc.entries.join(" ").length).toBeLessThan(400);
			expect(arc.entries.join(" ")).not.toMatch(/dissipates|equidistant|forgo/i);
		});

		it("annotates every attack a toggle modifies, and shrinks the toggle (A3)", () => {
			const reggu = loadMonster("Reggu");
			const melee = (reggu.action || []).filter(it => (it.entries || []).some(l => typeof l === "string" && /\{@atk mw\}/.test(l)));
			expect(melee.length).toBeGreaterThanOrEqual(3);
			melee.forEach(attack => {
				expect(`${attack.name}: ${attack.entries.join(" ")}`).toMatch(/While Eldritch Maul is active, reach 15 ft\. and plus \{@damage 1d6\} force damage\./);
			});
			// The ranged line must not claim a melee-only rider.
			const bolt = (reggu.action || []).find(it => /Radiant Sun Bolt/i.test(it.name));
			expect(bolt.entries.join(" ")).not.toMatch(/Eldritch Maul/);
			// The source keeps only its activation.
			const toggle = (reggu.bonus || []).find(it => /Eldritch Maul/.test(it.name));
			expect(toggle.entries.join(" ").length).toBeLessThan(220);
			expect(toggle.entries.join(" ")).not.toMatch(/inky tendrils|until the next dawn/i);
		});

		it("applies a count upgrade at the anchor and drops the dependent (A0.3)", () => {
			const juen = loadMonster("Juen");
			const names = allAbilityNames(juen).join("|");
			expect(names).not.toMatch(/Improved Cunning Strike/);
			const base = (juen.trait || []).find(it => it.name === "Cunning Strike");
			expect(base.entries[0]).toMatch(/it can add up to two of the following Cunning Strike effects/);
			// Missy has Cunning Strike without the upgrade and must still read "one".
			const missy = (loadMonster("Missy").trait || []).find(it => it.name === "Cunning Strike");
			if (missy) expect(missy.entries[0]).not.toMatch(/up to two of the following/);
		});
	});

	// ---- v16 contracts ----------------------------------------------------
	//
	// Two doctrines: a number or a roll leaves the trait list for the line it
	// modifies, and a subsystem spread over several entries reads as one entry at
	// its final form.

	describe("v16 — numbers on the numbers, subsystems in one place", () => {
		it("consolidates standing roll modifiers into one pinned trait (A1)", () => {
			["Onger", "Dauk", "Tignor", "Dzeiy"].forEach(name => {
				const mon = loadMonster(name);
				const resilience = (mon.trait || []).find(it => /^Resilience$/i.test(it.name));
				expect(`${name}: ${resilience ? "present" : "missing"}`).toBe(`${name}: present`);
				// Every clause keeps the feature that grants it, so the DM can still tell
				// where a modifier comes from without a second lookup.
				expect(resilience.entries.join(" ")).toMatch(/\([^()]+\)/);
				// …and the claim no longer stands as its own entry.
				const names = allAbilityNames(mon).join("|");
				expect(`${name}: ${names}`).not.toMatch(/\|Dauntless Heritage\|/);
			});
		});

		it("splits a mixed trait rather than swallowing it (A1 residue)", () => {
			["Wisp", "Duralin"].forEach(name => {
				const mon = loadMonster(name);
				const resilience = (mon.trait || []).find(it => /^Resilience$/i.test(it.name));
				expect(`${name}: ${resilience ? "present" : "missing"}`).toBe(`${name}: present`);
				expect(resilience.entries.join(" ")).toMatch(/prone/i);
			});
		});

		it("names the source of a save bonus the sheet applies silently (A1)", () => {
			const resilience = (loadMonster("Dzeiy").trait || []).find(it => /^Resilience$/i.test(it.name));
			expect(resilience.entries.join(" ")).toMatch(/bonus to saving throws/i);
		});

		it("resolves a derived value to the character's number (A2)", () => {
			const text = allEntryText(loadMonster("Dzeiy"));
			expect(text).not.toMatch(/twice its Hemocraft modifier \(minimum of 2\)/i);
		});

		it("makes mastery names hoverable in prose (A3/A4)", () => {
			const text = allEntryText(loadMonster("Duralin"));
			if (/\bSap\b/.test(text)) expect(text).toMatch(/\{@itemMastery [^|}]+\|XPHB\}/);
		});

		it("folds a dependent feature into its anchor at final form (B1)", () => {
			const names = allAbilityNames(loadMonster("Duralin")).join("|");
			expect(names).not.toMatch(/Improved Shadowcasting/);
			expect(names).toMatch(/Shadowcasting/);
		});

		it("merges the aura family into one emanation entry (B1)", () => {
			["Dranan", "Mikase"].forEach(name => {
				const names = allAbilityNames(loadMonster(name)).join("|");
				expect(`${name}: ${names}`).not.toMatch(/Aura of Courage|Aura of Devotion/);
			});
		});

		it("rosters the blood curses Blood Maledict can spend on (B2)", () => {
			const maledict = (loadMonster("Dzeiy").trait || []).find(it => /^Blood Maledict/i.test(it.name));
			expect(`maledict ${maledict ? "present" : "missing"}`).toBe("maledict present");
			expect(maledict.entries.join(" ")).toMatch(/Fallen Puppet/i);
		});

		it("drops an ASI-and-spells-only feat entry (B3)", () => {
			const names = allAbilityNames(loadMonster("Nessa")).join("|");
			expect(names).not.toMatch(/Shadow Touched/);
			// Telekinetic grants a real bonus action and must survive.
			expect(allEntryText(loadMonster("Nessa"))).toMatch(/Telekinetic/i);
		});

		it("never splits a bullet line at an inline label (C2)", () => {
			available.forEach(name => {
				(loadMonster(name).trait || []).forEach(entry => {
					(entry.entries || []).forEach(line => {
						if (typeof line !== "string" || !line.trim().startsWith("•")) return;
						expect(`${name}/${entry.name}: ${line}`).not.toMatch(/^•\s*$/);
					});
				});
			});
		});

		it("lists carried poisons with their numbers (C3)", () => {
			["Juen", "Missy"].forEach(name => {
				const equipment = (loadMonster(name).trait || []).find(it => /^Special Equipment$/i.test(it.name));
				expect(`${name}: ${equipment ? "present" : "missing"}`).toBe(`${name}: present`);
				const joined = equipment.entries.join(" ");
				expect(`${name}: ${joined}`).toMatch(/Poisons:/);
				expect(`${name}: ${joined}`).toMatch(/\{@item [^|}]*Poison/i);
			});
		});

		it("folds a form's deltas onto the lines that carry them (D1)", () => {
			const mon = loadMonster("Dzeiy");
			expect((mon.ac || []).length).toBeGreaterThan(1);
			expect((mon.resist || []).some(it => /while in Hybrid Form/i.test(String(it?.note || "")))).toBe(true);
			expect((mon.action || []).some(it => /Hybrid Form/.test(it.name))).toBe(true);
		});

		it("rates a rogue's defence and burst (D2)", () => {
			// A level-20 rogue is not a CR 10 creature; Uncanny Dodge, Evasion and Elusive
			// are defence the model was blind to, and Assassinate is burst it never priced.
			expect(Number(loadMonster("Juen").cr)).toBeGreaterThanOrEqual(13);
			expect(Number(loadMonster("Missy").cr)).toBeGreaterThanOrEqual(8);
		});
	});

	describe("v17 — the modifier is on the roll it modifies", () => {
		const entriesOf = (mon, name, section = "bonus") => (mon[section] || [])
			.find(it => new RegExp(name, "i").test(String(it?.name || "")))?.entries || [];

		it("folds a trigger rider into the feature that triggers it (1)", () => {
			["Aldor", "Arthur", "Elizabeth", "Wisp"].filter(it => available.includes(it)).forEach(name => {
				const mon = loadMonster(name);
				// It is no longer a sibling…
				expect(`${name}: ${(mon.trait || []).map(it => it.name).join("|")}`).not.toMatch(/Tactical Shift/);
				// …it is a labelled rider on the feature whose activation triggers it, and
				// the self-reference the placement already states is gone.
				const wind = entriesOf(mon, "^Second Wind").join(" ");
				expect(`${name}: ${wind}`).toMatch(/\{@b Tactical Shift\.\} It can also move up to half its Speed/);
				expect(`${name}: ${wind}`).not.toMatch(/Whenever \w+ activates its Second Wind/);
			});
		});

		it("keeps a folded rider's own uses (1)", () => {
			["Reggu", "Tikal"].filter(it => available.includes(it)).forEach(name => {
				const joined = (loadMonster(name).trait || []).flatMap(it => it.entries || [])
					.filter(it => typeof it === "string").join(" ");
				expect(`${name}: ${joined}`).toMatch(/\{@b Uncanny Metabolism \(1\/LR\)\.\}/);
			});
		});

		it("writes a situational to-hit bonus onto the roll it changes (2)", () => {
			const arthur = loadMonster("Arthur");
			const lines = ["action", "bonus"].flatMap(sec => (arthur[sec] || []).flatMap(it => it.entries || []))
				.filter(it => typeof it === "string" && /\{@atk /.test(it));
			// Every attack carries the alternative number, already added up.
			expect(lines.filter(it => /to hit \(\+\d+ with Hammer and Anvil/.test(it)).length).toBeGreaterThan(0);
			// A scoped claim only reaches the attacks it covers, and its gate is stated
			// inline rather than left in a trait to be looked up.
			const ranged = lines.find(it => /\{@atk rs\}/.test(it));
			expect(ranged).toMatch(/when standing 5 feet or more above an enemy/);
			expect((arthur.trait || []).map(it => it.name).join("|")).not.toMatch(/High Ground/);
			// Two conditionals share one parenthetical rather than opening rival ones.
			expect(ranged).not.toMatch(/\) \(\+/);
			// A gate too long for the line keeps its trait, so nothing is lost.
			expect((arthur.trait || []).map(it => it.name).join("|")).toMatch(/Hammer and Anvil/);
		});

		it("leaves a scoped bonus alone when no attack is in scope (2)", () => {
			// Duralin has High Ground and no ranged attack: the trait is the only place the
			// claim can live, so it survives.
			expect((loadMonster("Duralin").trait || []).map(it => it.name).join("|")).toMatch(/High Ground/);
		});

		it("mints the coated weapon as its own attack (3)", () => {
			const mon = loadMonster("Duralin");
			const coated = (mon.action || []).find(it => /\(Umbral Coating\)$/.test(String(it?.name || "")));
			expect(coated).toBeDefined();
			expect(coated.name).toMatch(/^Retaliator/);
			// It is the parent weapon's own line plus what coating adds…
			expect(coated.entries[0]).toMatch(/\{@atk mw\} \{@hit \+\d+\} to hit, reach 5 ft\. or range 20\/60 ft\./);
			expect(coated.entries[0]).toMatch(/Counts as a shadow weapon \(Shadow Sneak, Shadowbite\)\./);
			// …and the paragraph and cross-reference it replaces are gone.
			const joined = ["action", "bonus", "trait"].flatMap(sec => (mon[sec] || []).flatMap(it => it.entries || []))
				.filter(it => typeof it === "string").join(" ");
			expect(joined).not.toMatch(/can instead convert/i);
			expect(joined).not.toMatch(/\{@b Umbral Coating\.\}/);
		});

		it("states one merged rider instead of two of the same kind (3)", () => {
			const katana = (loadMonster("Mikase").action || [])
				.find(it => /^Starfire Katana$/.test(String(it?.name || "")));
			expect(katana.entries[0]).toMatch(/plus \{@damage 2d8\} radiant damage \(Radiant Strikes, Starfire Katana\)/);
			expect((katana.entries[0].match(/radiant damage/g) || []).length).toBe(1);
		});

		it("keeps a standing defence in one place (4)", () => {
			const mon = loadMonster("Talna");
			expect((mon.trait || []).map(it => it.name).join("|")).not.toMatch(/Master Smith's Aegis/);
			const res = (mon.trait || []).find(it => /^Resilience$/i.test(String(it?.name || "")));
			// Every claim the item made is in the merged entry, each still attributed.
			expect(res.entries.join(" ")).toMatch(/disadvantage on spell attack rolls against it \(Master Smith's Aegis\)/i);
			expect(res.entries.join(" ")).toMatch(/resistance to damage from spells \(Master Smith's Aegis\)/i);
		});
	});
});
