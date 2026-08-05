import fs from "fs";
import path from "path";
import {pathToFileURL} from "url";

if (!String.prototype.toTitleCase) {
	String.prototype.toTitleCase = function () {
		return this.replace(/\w\S*/g, txt => `${txt.charAt(0).toUpperCase()}${txt.slice(1).toLowerCase()}`);
	};
}
globalThis.Parser ||= {SRC_PHB: "PHB"};
globalThis.MiscUtil ||= {copyFast: value => structuredClone(value)};

await import("../js/charactersheet/charactersheet-class-utils.js");
await import("../js/charactersheet/charactersheet-state.js");

const ITEM_NORMALIZER = new globalThis.CharacterSheetState();

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
const OPERATIONAL_STRUCTURED_FIELDS = new Set([
	"ability",
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
	"bonusWeaponCritDamage",
	"conditionImmune",
	"critThreshold",
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

export function classifyItem (item) {
	const fields = [...STRUCTURED_FIELDS].filter(field => item[field] != null);
	const unsupportedSpellKeys = getAttachedSpellKeys(item).filter(key => !ATTACHED_SPELL_KEYS.has(key));
	const text = getEntryText(item.entries);
	const hasActiveProse = ACTIVATION_RE.test(text);
	const powers = ITEM_NORMALIZER._normalizeItemPowers(item);
	const effects = ITEM_NORMALIZER._normalizeItemEffects(item);
	const damageRiders = ITEM_NORMALIZER._normalizeItemDamageRiders(item);
	const criticalRiders = ITEM_NORMALIZER._normalizeItemCritRiders(item);
	const conditionalBonuses = ITEM_NORMALIZER._detectConditionalBonuses(item);
	const actionablePowers = powers.filter(power => power.kind === "spell" || !power.isReferenceOnly);
	const referencePowers = powers.filter(power => power.isReferenceOnly);
	const explicitEffects = Array.isArray(item.effects) && item.effects.length;
	const operationalStructured = [...OPERATIONAL_STRUCTURED_FIELDS].filter(field => item[field] != null);
	const operationalDerived = [
		...effects,
		...damageRiders,
		...criticalRiders,
		...conditionalBonuses,
	];
	const choices = [
		...(item.spellScrollLevel != null && !item.attachedSpells ? ["spellScrollLevel"] : []),
		...(item.ability?.choose?.length ? ["ability.choose"] : []),
		...(item.grantsLanguage ? ["grantsLanguage"] : []),
	];
	const hasOperational = operationalStructured.length || actionablePowers.length || operationalDerived.length;
	const hasUnresolvedActive = hasActiveProse && !actionablePowers.length;
	const reasons = [];

	if (unsupportedSpellKeys.length) {
		return {
			status: "unsupported",
			operationalStatus: "invalidShape",
			fields,
			reasons: unsupportedSpellKeys.map(key => `attachedSpells.${key}`),
		};
	}

	if (hasOperational && (hasUnresolvedActive || choices.length || referencePowers.length)) {
		if (hasUnresolvedActive) reasons.push("unresolved active prose");
		if (choices.length) reasons.push(...choices.map(choice => `choice required: ${choice}`));
		if (referencePowers.length) reasons.push("reference-only power");
		return {
			status: "surfacedOnly",
			operationalStatus: "partiallyOperational",
			fields,
			reasons,
		};
	}

	if (hasOperational) {
		const isStructured = operationalStructured.length || actionablePowers.some(power => power.kind === "spell") || explicitEffects;
		return {
			status: "fullyFunctional",
			operationalStatus: isStructured ? "structuredOperational" : "proseOperational",
			fields,
			reasons,
		};
	}

	if (choices.length) {
		return {
			status: "surfacedOnly",
			operationalStatus: "choiceRequired",
			fields,
			reasons: choices.map(choice => `choice required: ${choice}`),
		};
	}

	if (item.charges != null) {
		return {
			status: "surfacedOnly",
			operationalStatus: "resourceOnly",
			fields,
			reasons: [typeof item.charges === "number" ? "charges have no operational power" : "charge maximum requires resolution"],
		};
	}

	if (referencePowers.length) {
		return {
			status: "surfacedOnly",
			operationalStatus: "referenceOnly",
			fields,
			reasons: ["reference-only power"],
		};
	}

	if (text || item._isExpandedVariant || item._isItemGroup) {
		return {status: "surfacedOnly", operationalStatus: "bespoke", fields, reasons: ["rules text only"]};
	}

	return {
		status: "unsupported",
		operationalStatus: "invalidShape",
		fields,
		reasons: ["no structured mechanics or rules text"],
	};
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

export function loadCorpus (attachmentPath = null) {
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

export function summarize ({items, documents}) {
	const rows = items.map(item => ({item, result: classifyItem(item)}));
	const status = {fullyFunctional: 0, surfacedOnly: 0, unsupported: 0};
	const operationalStatus = {};
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
		operationalStatus[result.operationalStatus] = (operationalStatus[result.operationalStatus] || 0) + 1;
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
	return {total: rows.length, status, operationalStatus, byCorpus, byDocument, fields, reasons};
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
		"## Operational status",
		"",
		"| Status | Items | Share |",
		"| --- | ---: | ---: |",
		...Object.entries(summary.operationalStatus)
			.sort((a, b) => b[1] - a[1])
			.map(([status, count]) => `| ${status} | ${count} | ${pct(count)} |`),
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
		"- **Fully functional:** production normalization or a downstream structured consumer provides operational mechanics, with no unresolved choice, active clause, or reference-only power detected.",
		"- **Surfaced only:** includes partial automation, unresolved choices, bare resources, reference-only powers, and bespoke rules text.",
		"- **Unsupported:** the entity has an invalid attached-spell shape or neither mechanics nor rules text.",
		"- Operational sub-statuses distinguish `structuredOperational`, `proseOperational`, `partiallyOperational`, `choiceRequired`, `resourceOnly`, `referenceOnly`, `bespoke`, and `invalidShape`.",
		"",
		"Run `node node/audit-character-sheet-items.js [5etools-site-backup.json]` to refresh this report.",
	);
	return `${lines.join("\n")}\n`;
}

const attachmentPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const summary = summarize(loadCorpus(attachmentPath));
	process.stdout.write(toMarkdown(summary, attachmentPath));
}
