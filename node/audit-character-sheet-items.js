import fs from "fs";
import path from "path";

const STRUCTURED_FIELDS = new Set([
	"ability",
	"attachedSpells",
	"bonusAbilityCheck",
	"bonusAc",
	"bonusProficiencyBonus",
	"bonusSavingThrow",
	"bonusSavingThrowConcentration",
	"bonusSpellAttack",
	"bonusSpellDamage",
	"bonusSpellSaveDc",
	"bonusWeapon",
	"bonusWeaponAttack",
	"bonusWeaponDamage",
	"charges",
	"conditionImmune",
	"critThreshold",
	"effects",
	"immune",
	"modifySpeed",
	"resist",
	"senses",
	"spellImmunitySlots",
	"vulnerable",
]);
const ATTACHED_SPELL_KEYS = new Set(["ability", "charges", "daily", "limited", "other", "rest", "ritual", "will"]);
const ACTIVATION_RE = /\b(?:as (?:a|an) (?:bonus )?action|as (?:a|an) reaction|use (?:a|an|your) action|when you hit|expend \d+ charges?|once (?:this property is )?used|until (?:the )?next dawn|short or long rest)\b/i;

function getEntryText (entry) {
	if (entry == null) return "";
	if (typeof entry === "string") return entry.replace(/\{@\w+\s+([^}|]+)(?:\|[^}]*)?\}/g, "$1");
	if (Array.isArray(entry)) return entry.map(getEntryText).join(" ");
	if (typeof entry !== "object") return String(entry);
	return [entry.name, getEntryText(entry.entries), getEntryText(entry.items), getEntryText(entry.rows)].filter(Boolean).join(" ");
}

function getAttachedSpellKeys (item) {
	if (!item.attachedSpells || Array.isArray(item.attachedSpells)) return [];
	return Object.keys(item.attachedSpells);
}

function classifyItem (item) {
	const fields = [...STRUCTURED_FIELDS].filter(field => item[field] != null);
	const unsupportedSpellKeys = getAttachedSpellKeys(item).filter(key => !ATTACHED_SPELL_KEYS.has(key));
	const text = getEntryText(item.entries);
	const namedActive = (item.entries || []).some(entry =>
		entry && typeof entry === "object" && entry.name && ACTIVATION_RE.test(getEntryText(entry.entries)));
	const hasActiveProse = ACTIVATION_RE.test(text);
	const hasPowerData = !!item.attachedSpells || namedActive;
	if (unsupportedSpellKeys.length) {
		return {status: "unsupported", fields, reasons: unsupportedSpellKeys.map(key => `attachedSpells.${key}`)};
	}
	if (fields.length || hasPowerData) {
		return {
			status: hasActiveProse && !hasPowerData ? "surfacedOnly" : "fullyFunctional",
			fields,
			reasons: hasActiveProse && !hasPowerData ? ["unstructured active prose"] : [],
		};
	}
	if (text) return {status: "surfacedOnly", fields, reasons: ["rules text only"]};
	return {status: "unsupported", fields, reasons: ["no structured mechanics or rules text"]};
}

function readJson (file) {
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

function isMagicItem (item) {
	const rarity = String(item.rarity || "").toLowerCase();
	return (!!rarity && !["none", "unknown"].includes(rarity))
		|| [...STRUCTURED_FIELDS].some(field => item[field] != null)
		|| !!(item.wondrous || item.staff || item.wand || item.rod || item.ring || item.tattoo);
}

function loadCorpus (attachmentPath = null) {
	const items = readJson("data/items.json").item.filter(isMagicItem).map(item => ({...item, _corpus: "site"}));
	const variants = readJson("data/magicvariants.json").magicvariant
		.map(item => ({...item, ...(item.inherits || {}), _corpus: "magicvariants"}));
	const tgtt = readJson("homebrew/TravelersGuidetoThelemar.json").item.filter(isMagicItem)
		.map(item => ({...item, _corpus: "TGTT"}));
	const out = [...items, ...variants, ...tgtt];
	if (!attachmentPath) return out;
	const exported = readJson(attachmentPath);
	for (const document of exported.async?.HOMEBREW_2_STORAGE || []) {
		const label = document.head?.filename || document.body?._meta?.sources?.[0]?.full || "attached homebrew";
		for (const item of (document.body?.item || []).filter(isMagicItem)) out.push({...item, _corpus: `attachment: ${label}`});
	}
	return out;
}

function summarize (items) {
	const rows = items.map(item => ({item, result: classifyItem(item)}));
	const status = {fullyFunctional: 0, surfacedOnly: 0, unsupported: 0};
	const byCorpus = {};
	const fields = {};
	const reasons = {};
	for (const {item, result} of rows) {
		status[result.status]++;
		const corpus = byCorpus[item._corpus] ||= {fullyFunctional: 0, surfacedOnly: 0, unsupported: 0, total: 0};
		corpus[result.status]++;
		corpus.total++;
		for (const field of result.fields) fields[field] = (fields[field] || 0) + 1;
		for (const reason of result.reasons) reasons[reason] = (reasons[reason] || 0) + 1;
	}
	return {total: rows.length, status, byCorpus, fields, reasons};
}

function toMarkdown (summary, attachmentPath) {
	const pct = value => `${((value / summary.total) * 100).toFixed(1)}%`;
	const lines = [
		"# Character Sheet Magic-Item Coverage Audit",
		"",
		`Generated from the in-repo site catalog, magic-variant templates, TGTT homebrew${attachmentPath ? ", and the supplied 5etools export" : ""}.`,
		"",
		"| Status | Items | Share |",
		"| --- | ---: | ---: |",
		`| Fully functional | ${summary.status.fullyFunctional} | ${pct(summary.status.fullyFunctional)} |`,
		`| Surfaced only | ${summary.status.surfacedOnly} | ${pct(summary.status.surfacedOnly)} |`,
		`| Unsupported | ${summary.status.unsupported} | ${pct(summary.status.unsupported)} |`,
		`| **Total** | **${summary.total}** | **100%** |`,
		"",
		"## Corpus breakdown",
		"",
		"| Corpus | Full | Surfaced | Unsupported | Total |",
		"| --- | ---: | ---: | ---: | ---: |",
	];
	for (const [corpus, counts] of Object.entries(summary.byCorpus).sort((a, b) => b[1].total - a[1].total)) {
		lines.push(`| ${corpus.replace(/\|/g, "\\|")} | ${counts.fullyFunctional} | ${counts.surfacedOnly} | ${counts.unsupported} | ${counts.total} |`);
	}
	lines.push(
		"",
		"## Structured mechanics covered",
		"",
		"| Field family | Items |",
		"| --- | ---: |",
	);
	for (const [field, count] of Object.entries(summary.fields).sort((a, b) => b[1] - a[1])) lines.push(`| \`${field}\` | ${count} |`);
	lines.push(
		"",
		"## Classification contract",
		"",
		"- **Fully functional:** mechanics use a supported structured field, attached-spell shape, or named active-power block.",
		"- **Surfaced only:** rules text remains visible, but no safe structured operation can be inferred.",
		"- **Unsupported:** the entity has an unknown attached-spell shape or neither mechanics nor rules text.",
		"",
		"Run `node node/audit-character-sheet-items.js [5etools-export.json]` to refresh this report.",
	);
	return `${lines.join("\n")}\n`;
}

const attachmentPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const summary = summarize(loadCorpus(attachmentPath));
process.stdout.write(toMarkdown(summary, attachmentPath));
