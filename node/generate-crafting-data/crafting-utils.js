/**
 * Shared parsing helpers for the crafting data generator.
 *
 * The source books encode nearly everything as prose, so these helpers do the heavy lifting of
 * turning table cells and free text into structured, filterable values.
 */

/* -------------------------------------------- */
/* Identity                                     */
/* -------------------------------------------- */

export const getUid = (name, source) => `${(name || "").toLowerCase().trim()}|${(source || "").toLowerCase().trim()}`;

/* -------------------------------------------- */
/* Text                                         */
/* -------------------------------------------- */

/** Flatten an entry (string | entries object | array) into plain searchable text. */
export function entriesToText (entry) {
	if (entry == null) return "";
	if (typeof entry === "string") return Renderer.stripTags(entry);
	if (typeof entry === "number") return `${entry}`;
	if (Array.isArray(entry)) return entry.map(entriesToText).filter(Boolean).join(" ");

	const parts = [];
	if (entry.name) parts.push(Renderer.stripTags(entry.name));
	if (entry.caption) parts.push(Renderer.stripTags(entry.caption));
	if (entry.entry) parts.push(entriesToText(entry.entry));
	if (entry.entries) parts.push(entriesToText(entry.entries));
	if (entry.items) parts.push(entriesToText(entry.items));
	if (entry.rows) parts.push(entriesToText(entry.rows));
	return parts.filter(Boolean).join(" ");
}

/** Pull every `{@item Name|SOURCE|display}` reference out of an entry tree. */
export function extractItemRefs (entry) {
	const text = JSON.stringify(entry ?? "");
	const out = [];
	const re = /\{@item ([^}]+)\}/g;
	let m;
	while ((m = re.exec(text)) !== null) {
		const [name, source] = m[1].split("|").map(it => it.replace(/\\"/g, `"`).trim());
		if (!name) continue;
		out.push({name, source: source || "DMG"});
	}
	return dedupeRefs(out);
}

/** Pull every `{@creature Name|SOURCE}` reference out of an entry tree. */
export function extractCreatureRefs (entry) {
	const text = JSON.stringify(entry ?? "");
	const out = [];
	const re = /\{@creature ([^}]+)\}/g;
	let m;
	while ((m = re.exec(text)) !== null) {
		const [name, source] = m[1].split("|").map(it => it.replace(/\\"/g, `"`).trim());
		if (!name) continue;
		out.push({name, source: source || "MM"});
	}
	return dedupeRefs(out);
}

/** Pull every `{@spell Name|SOURCE}` reference out of an entry tree. */
export function extractSpellRefs (entry) {
	const text = JSON.stringify(entry ?? "");
	const out = [];
	const re = /\{@spell ([^}]+)\}/g;
	let m;
	while ((m = re.exec(text)) !== null) {
		const [name, source] = m[1].split("|").map(it => it.replace(/\\"/g, `"`).trim());
		if (!name) continue;
		out.push({name, source: source || "PHB"});
	}
	return dedupeRefs(out);
}

export function dedupeRefs (refs) {
	const seen = new Set();
	return refs.filter(ref => {
		const uid = getUid(ref.name, ref.source);
		if (seen.has(uid)) return false;
		seen.add(uid);
		return true;
	});
}

/* -------------------------------------------- */
/* Numbers                                      */
/* -------------------------------------------- */

const _COIN_TO_COPPER = {cp: 1, sp: 10, ep: 50, gp: 100, pp: 1000};

/**
 * Parse a value cell (`"8 sp"`, `"1,200 gp"`, `"2 gp each"`, `"—"`) into copper pieces,
 * matching the 5etools `item.value` convention.
 *
 * @returns {?number} Copper pieces, or `null` when the cell holds no parseable value.
 */
export function parseValueToCopper (raw) {
	if (raw == null) return null;
	const text = typeof raw === "string" ? raw : entriesToText(raw);
	const m = /(\d[\d,]*(?:\.\d+)?)\s*(cp|sp|ep|gp|pp)\b/i.exec(text);
	if (!m) return null;
	const amount = Number(m[1].replace(/,/g, ""));
	if (!isFinite(amount)) return null;
	return Math.round(amount * _COIN_TO_COPPER[m[2].toLowerCase()]);
}

/**
 * Parse a weight cell (`"2 lb"`, `"1/2 lb"`, `"0.05 lb"`, `"—"`) into pounds.
 *
 * @returns {?number}
 */
export function parseWeightToPounds (raw) {
	if (raw == null) return null;
	const text = typeof raw === "string" ? raw : entriesToText(raw);

	const mFraction = /(\d+)\s*\/\s*(\d+)\s*lb/i.exec(text);
	if (mFraction) {
		const denom = Number(mFraction[2]);
		if (denom) return Number((Number(mFraction[1]) / denom).toFixed(4));
	}

	const m = /(\d[\d,]*(?:\.\d+)?)\s*lb/i.exec(text);
	if (!m) return null;
	const weight = Number(m[1].replace(/,/g, ""));
	return isFinite(weight) ? weight : null;
}

/**
 * Parse a DC cell. Handles plain numbers, ranges (`"5–10"` → the low end), and `"DC 15"`.
 *
 * @returns {?number}
 */
export function parseDc (raw) {
	if (raw == null) return null;
	if (typeof raw === "number") return raw;
	const text = entriesToText(raw);
	const m = /(\d+)/.exec(text);
	return m ? Number(m[1]) : null;
}

/**
 * Split a material name into its base name and harvestable quantity.
 * `"Alhoon Tentacle (×4)"` → `{name: "Alhoon Tentacle", quantity: 4}`
 * `"Aarakocra Feathers (small pouch)"` → `{name: "Aarakocra Feathers (small pouch)", quantity: 1}`
 * `"Griffon Feather (1d4)"` → `{name: "Griffon Feather", quantity: null, quantityRoll: "1d4"}`
 */
export function parseNameAndQuantity (rawName) {
	const name = entriesToText(rawName).trim();

	const mMult = /^(.*?)\s*\(\s*[×x]\s*(\d+)\s*\)\s*$/i.exec(name);
	if (mMult) return {name: mMult[1].trim(), quantity: Number(mMult[2]), quantityRoll: null};

	const mRoll = /^(.*?)\s*\(\s*(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*\)\s*$/i.exec(name);
	if (mRoll) return {name: mRoll[1].trim(), quantity: null, quantityRoll: mRoll[2].replace(/\s+/g, "")};

	return {name, quantity: 1, quantityRoll: null};
}

/**
 * Parse an ingredient list string into structured ingredients.
 *
 * The handbooks are inconsistent here, so this handles all of:
 *   `"Young Dragon Tooth ×1"`
 *   `"Salamander Scale ×1 large pouch"`
 *   `"Basilisk Eye ×2, Powdered Silver ×1"`
 *   `"Ghast Hide ×1 or Ghoul Hide ×1 or Maurezhi Hide"`  (alternatives)
 *   `"Astral Dreadnought Eye ×1/3"`                       (fractional units)
 */
export function parseIngredientList (raw, {defaultSource} = {}) {
	if (!raw) return [];
	const text = entriesToText(raw);

	// Alternatives are joined with "or"; everything else is a separate required ingredient
	const groups = text.split(/\s*(?:,|;|\+)\s*/).filter(Boolean);

	const out = [];
	for (const group of groups) {
		const alternatives = group.split(/\s+\bor\b\s+/i).map(it => it.trim()).filter(Boolean);

		alternatives.forEach((part, ix) => {
			const parsed = _parseIngredient(part, {defaultSource});
			if (!parsed) return;
			if (alternatives.length > 1) {
				parsed.isAlternative = true;
				parsed.alternativeGroup = `alt-${groups.indexOf(group)}`;
				parsed.alternativeIndex = ix;
			}
			out.push(parsed);
		});
	}

	return out;
}

function _parseIngredient (raw, {defaultSource}) {
	const part = raw.trim().replace(/^or\s+/i, "").replace(/\.$/, "");
	if (!part || part === "—" || part === "-") return null;

	// "<name> ×<qty> [unit]" — quantity may be fractional ("×1/3")
	const m = /^(.*?)\s*[×x*]\s*(\d+(?:\/\d+)?)\s*(.*)$/i.exec(part);

	const name = (m ? m[1] : part).trim().replace(/\.$/, "");
	if (!name) return null;

	let quantity = 1;
	if (m) {
		const raw = m[2];
		quantity = raw.includes("/")
			? Number((Number(raw.split("/")[0]) / Number(raw.split("/")[1])).toFixed(4))
			: Number(raw);
		if (!isFinite(quantity)) quantity = 1;
	}

	const unit = m && m[3] ? m[3].trim() : null;

	return {
		name,
		quantity,
		...(unit ? {unit} : {}),
		uid: defaultSource ? getUid(name, defaultSource) : null,
	};
}

/* -------------------------------------------- */
/* Entry construction                           */
/* -------------------------------------------- */

/**
 * Join a creature name and a material name without repeating the words they share.
 * `"Adult Dragon"` + `"Dragon Tooth"` → `"Adult Dragon Tooth"`
 * `"Bone Devil"`   + `"Devil Hide"`   → `"Bone Devil Hide"`
 * `"Chuul"`        + `"Venom"`        → `"Chuul Venom"`
 */
export function joinCreatureAndMaterialName (creatureName, materialName) {
	const creatureWords = `${creatureName}`.trim().split(/\s+/).filter(Boolean);
	const materialWords = `${materialName}`.trim().split(/\s+/).filter(Boolean);
	if (!creatureWords.length) return materialWords.join(" ");
	if (!materialWords.length) return creatureWords.join(" ");

	for (let nOverlap = Math.min(creatureWords.length, materialWords.length); nOverlap > 0; --nOverlap) {
		const creatureTail = creatureWords.slice(-nOverlap).join(" ").toLowerCase();
		const materialHead = materialWords.slice(0, nOverlap).join(" ").toLowerCase();
		if (creatureTail === materialHead) return [...creatureWords, ...materialWords.slice(nOverlap)].join(" ");
	}

	return [...creatureWords, ...materialWords].join(" ");
}

/** Normalise a table Description cell into a valid `entries` array. */
export function cellToEntries (cell) {
	if (cell == null) return [];
	if (typeof cell === "string") return cell === "—" ? [] : [cell];
	if (Array.isArray(cell)) return cell;
	return [cell];
}

/**
 * Find a named sub-entry (e.g. `Use:`, `Effect:`, `Shelf Life:`) within an entries tree.
 *
 * @returns {?object} The matching entry, or `null`.
 */
export function findNamedEntry (entries, namePattern) {
	if (!entries) return null;
	const stack = Array.isArray(entries) ? [...entries] : [entries];
	while (stack.length) {
		const cur = stack.shift();
		if (!cur || typeof cur !== "object") continue;
		if (cur.name && namePattern.test(cur.name)) return cur;
		if (Array.isArray(cur.entries)) stack.push(...cur.entries);
		if (Array.isArray(cur.items)) stack.push(...cur.items);
	}
	return null;
}

/** Text of a named sub-entry, or `""`. */
export function findNamedEntryText (entries, namePattern) {
	const found = findNamedEntry(entries, namePattern);
	return found ? entriesToText(found.entries ?? found.entry ?? "") : "";
}
