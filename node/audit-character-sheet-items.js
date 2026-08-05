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
const ACTIONABLE_ACTIVE_RE = /\b(?:expend (?:one|\d+) charges?|(?:staff|item|weapon|armor) is destroyed|until (?:the )?next dawn|until you finish a (?:short or )?long rest)\b/i;
const DERIVED_WEAPON_RIDER_RE = /\b(?:when you hit|it deals|target takes|roll a 20)[^.]*\bextra\s+(?:\{@damage\s+)?(?:\d+d\d+|\d+)\b/i;

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
	const namedActive = (item.entries || []).some(entry => {
		if (!entry || typeof entry !== "object" || !entry.name) return false;
		const entryText = getEntryText(entry.entries);
		return ACTIVATION_RE.test(entryText) && ACTIONABLE_ACTIVE_RE.test(entryText);
	});
	const hasActiveProse = ACTIVATION_RE.test(text);
	const hasDerivedWeaponRider = DERIVED_WEAPON_RIDER_RE.test(text);
	if (hasDerivedWeaponRider) fields.push("derivedWeaponRider");
	const hasPowerData = !!item.attachedSpells || namedActive || hasDerivedWeaponRider;
	const hasCooldownLimitedSpeed = !!item.modifySpeed && /\b(?:can be used|use this property)\s+once every\b/i.test(text);
	if (unsupportedSpellKeys.length) {
		return {status: "unsupported", fields, reasons: unsupportedSpellKeys.map(key => `attachedSpells.${key}`)};
	}
	if (hasCooldownLimitedSpeed) return {status: "surfacedOnly", fields, reasons: ["cooldown-limited structured speed"]};
	if (fields.length || hasPowerData) {
		return {
			status: hasActiveProse && !hasPowerData ? "surfacedOnly" : "fullyFunctional",
			fields,
			reasons: hasActiveProse && !hasPowerData ? ["unstructured active prose"] : [],
		};
	}
	if (text || item._isExpandedVariant || item._isItemGroup) return {status: "surfacedOnly", fields, reasons: ["rules text only"]};
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

function isRequirementMatch (candidate, requirement, method) {
	if (candidate == null || requirement == null) return false;
	return Object.entries(requirement)[method](([key, expected]) => {
		const actual = candidate[key];
		if (Array.isArray(expected)) return Array.isArray(actual) ? actual.some(it => expected.includes(it)) : expected.includes(actual);
		if (expected && typeof expected === "object") return isRequirementMatch(actual, expected, method);
		return Array.isArray(actual) ? actual.includes(expected) : actual === expected;
	});
}

function isEditionMatch (baseItem, variant) {
	if (baseItem.edition === variant.edition) return true;
	if (baseItem.edition === "classic") return false;
	if (baseItem.edition == null) return true;
	if (baseItem.edition === "one") return variant.edition !== "classic";
	return false;
}

function applyProperties (value, props) {
	if (typeof value === "string") {
		return value.replace(/\{=([^}]+)}/g, (full, key) => props[key] == null ? full : String(props[key]));
	}
	if (Array.isArray(value)) return value.map(it => applyProperties(it, props));
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, applyProperties(child, props)]));
}

function createSpecificVariant (baseItem, variant, corpus) {
	const inherits = variant.inherits || {};
	const out = structuredClone(baseItem);
	const props = {...baseItem, ...inherits};
	for (const [key, rawValue] of Object.entries(inherits).sort(([a], [b]) => Number(b.includes("Remove")) - Number(a.includes("Remove")))) {
		const value = applyProperties(rawValue, props);
		switch (key) {
			case "namePrefix": out.name = `${value}${out.name}`; break;
			case "nameSuffix": out.name = `${out.name}${value}`; break;
			case "nameRemove": out.name = out.name.replace(new RegExp(value, "g"), ""); break;
			case "entries": out.entries = [...value, ...(out.entries || [])]; break;
			case "conditionImmune":
			case "resist":
			case "immune":
			case "vulnerable": out[key] = [...new Set([...(out[key] || []), ...value])]; break;
			case "propertyAdd": out.property = [...new Set([...(out.property || []), ...value])]; break;
			case "propertyRemove": out.property = (out.property || []).filter(it => !value.includes(it?.uid || it)); break;
			case "weightExpression":
			case "valueExpression":
			case "barding": break;
			default: out[key] = value;
		}
	}
	out.source = inherits.source || variant.source || out.source;
	out.baseItem = `${baseItem.name}|${baseItem.source}`;
	out._variantName = variant.name;
	out._isExpandedVariant = true;
	out._corpus = corpus;
	out._auditDocumentIndex = variant._auditDocumentIndex;
	return out;
}

function expandVariants (baseItems, variants, corpusForVariant) {
	const out = [];
	for (const variant of variants) {
		if (!Array.isArray(variant.requires) || !variant.requires.length) continue;
		for (const baseItem of baseItems) {
			if (baseItem.packContents) continue;
			if (!isEditionMatch(baseItem, variant)) continue;
			if (!variant.requires.some(requirement => isRequirementMatch(baseItem, requirement, "every"))) continue;
			if (variant.excludes && isRequirementMatch(baseItem, variant.excludes, "some")) continue;
			out.push(createSpecificVariant(baseItem, variant, corpusForVariant(variant)));
		}
	}
	return out;
}

function dedupeItems (items) {
	const byUid = new Map();
	for (const item of items) {
		const uid = `${item.name || ""}|${item.source || ""}`.toLowerCase();
		if (!byUid.has(uid)) byUid.set(uid, item);
	}
	return [...byUid.values()];
}

function loadCorpus (attachmentPath = null) {
	const siteItems = readJson("data/items.json").item;
	const siteBaseItems = readJson("data/items-base.json").baseitem;
	const siteVariants = readJson("data/magicvariants.json").magicvariant;
	const direct = siteItems.filter(isMagicItem).map(item => ({...item, _corpus: "site items"}));
	const baseItems = [...siteBaseItems];
	const variants = [...siteVariants.map(item => ({...item, _auditCorpus: "site variants"}))];
	const documents = [];

	if (attachmentPath) {
		const exported = readJson(attachmentPath);
		for (const [documentIndex, document] of (exported.async?.HOMEBREW_2_STORAGE || []).entries()) {
			const label = document.head?.filename || document.body?._meta?.sources?.[0]?.full || "attached homebrew";
			const corpus = `backup: ${label}`;
			const body = document.body || {};
			const documentMeta = {
				index: documentIndex + 1,
				label,
				item: body.item?.length || 0,
				baseitem: body.baseitem?.length || 0,
				magicvariant: body.magicvariant?.length || 0,
				itemGroup: body.itemGroup?.length || 0,
				expanded: 0,
			};
			documents.push(documentMeta);
			for (const item of body.item || []) {
				if (isMagicItem(item)) direct.push({...item, _corpus: corpus, _auditDocumentIndex: documentIndex});
			}
			for (const group of body.itemGroup || []) {
				direct.push({...group, _isItemGroup: true, _corpus: `${corpus} (groups)`, _auditDocumentIndex: documentIndex});
			}
			baseItems.push(...(body.baseitem || []));
			variants.push(...(body.magicvariant || []).map(item => ({
				...item,
				_auditCorpus: `${corpus} variants`,
				_auditDocumentIndex: documentIndex,
			})));
		}
	} else {
		const tgtt = readJson("homebrew/TravelersGuidetoThelemar.json");
		direct.push(...(tgtt.item || []).filter(isMagicItem).map(item => ({...item, _corpus: "TGTT"})));
		baseItems.push(...(tgtt.baseitem || []));
		variants.push(...(tgtt.magicvariant || []).map(item => ({...item, _auditCorpus: "TGTT variants"})));
	}

	const expanded = expandVariants(baseItems, variants, variant => variant._auditCorpus || "site variants");
	for (const item of expanded) {
		if (item._auditDocumentIndex == null) continue;
		documents[item._auditDocumentIndex].expanded++;
	}
	return {items: dedupeItems([...direct, ...expanded]), documents};
}

function summarize ({items, documents}) {
	const rows = items.map(item => ({item, result: classifyItem(item)}));
	const status = {fullyFunctional: 0, surfacedOnly: 0, unsupported: 0};
	const byCorpus = {};
	const byDocument = documents.map(document => ({
		...document,
		fullyFunctional: 0,
		surfacedOnly: 0,
		unsupported: 0,
		total: 0,
	}));
	const fields = {};
	const reasons = {};
	for (const {item, result} of rows) {
		status[result.status]++;
		const corpus = byCorpus[item._corpus] ||= {fullyFunctional: 0, surfacedOnly: 0, unsupported: 0, total: 0};
		corpus[result.status]++;
		corpus.total++;
		if (item._auditDocumentIndex != null) {
			const document = byDocument[item._auditDocumentIndex];
			document[result.status]++;
			document.total++;
		}
		for (const field of result.fields) fields[field] = (fields[field] || 0) + 1;
		for (const reason of result.reasons) reasons[reason] = (reasons[reason] || 0) + 1;
	}
	return {total: rows.length, status, byCorpus, byDocument, fields, reasons};
}

function toMarkdown (summary, attachmentPath) {
	const pct = value => `${((value / summary.total) * 100).toFixed(1)}%`;
	const lines = [
		"# Character Sheet Magic-Item Coverage Audit",
		"",
		`Generated from the in-repo site catalog and concrete magic-variant expansions${attachmentPath ? ", plus all item content in the supplied 5etools site backup" : ", plus TGTT homebrew"}.`,
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
	if (attachmentPath) {
		lines.push(
			"",
			"## Backup document proof",
			"",
			"Raw counts prove every backup document was read. `Expanded` is the number of concrete candidates generated by that document's variant templates before global `name|source` deduplication; classified totals are the globally deduplicated concrete entities credited to that document.",
			"",
			"| # | Document | item | baseitem | magicvariant | itemGroup | Expanded | Full | Surfaced | Unsupported | Credited |",
			"| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
		);
		for (const document of summary.byDocument) {
			lines.push(`| ${document.index} | ${document.label.replace(/\|/g, "\\|")} | ${document.item} | ${document.baseitem} | ${document.magicvariant} | ${document.itemGroup} | ${document.expanded} | ${document.fullyFunctional} | ${document.surfacedOnly} | ${document.unsupported} | ${document.total} |`);
		}
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
		"Run `node node/audit-character-sheet-items.js [5etools-site-backup.json]` to refresh this report.",
	);
	return `${lines.join("\n")}\n`;
}

const attachmentPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const summary = summarize(loadCorpus(attachmentPath));
process.stdout.write(toMarkdown(summary, attachmentPath));
