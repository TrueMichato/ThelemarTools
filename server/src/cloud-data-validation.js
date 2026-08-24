import sanitizeHtml from "sanitize-html";
import {HubStoreError} from "./hub-store-error.js";

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_DEPTH = 150;
const MAX_NODES = 200_000;
export const MAX_CLOUD_CHARACTER_BYTES = 1_500_000;
const CHARACTER_HTML_TAGS = [
	"a",
	"abbr",
	"b",
	"blockquote",
	"br",
	"code",
	"dd",
	"del",
	"details",
	"div",
	"dl",
	"dt",
	"em",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"hr",
	"i",
	"li",
	"mark",
	"ol",
	"p",
	"pre",
	"s",
	"small",
	"span",
	"strong",
	"sub",
	"summary",
	"sup",
	"table",
	"tbody",
	"td",
	"th",
	"thead",
	"tr",
	"u",
	"ul",
];
const CHARACTER_HTML_OPTIONS = {
	allowedTags: CHARACTER_HTML_TAGS,
	allowedAttributes: {
		"*": ["aria-*", "class", "role", "title"],
		a: ["aria-*", "class", "href", "role", "title"],
		td: ["aria-*", "class", "colspan", "role", "rowspan", "title"],
		th: ["aria-*", "class", "colspan", "role", "rowspan", "scope", "title"],
	},
	allowedSchemes: ["http", "https", "mailto"],
	allowProtocolRelative: false,
	disallowedTagsMode: "escape",
};
const HTML_LIKE_RE = /<\/?[a-z][^>]*>/i;
const INCOMPLETE_DANGEROUS_HTML_RE = /<(?:\/?(?:base|button|embed|form|iframe|img|input|link|math|meta|object|script|source|style|svg|video)\b|[a-z][^>]*\bon\w+\s*=)/i;

export function validateCloudValue (value, {label = "Cloud data", isAllowHtml = false} = {}) {
	let nodes = 0;
	const seen = new Set();
	const walk = (current, depth) => {
		if (++nodes > MAX_NODES) throw new HubStoreError("CLOUD_DATA_TOO_LARGE", `${label} contains too many values.`);
		if (depth > MAX_DEPTH) throw new HubStoreError("CLOUD_DATA_TOO_DEEP", `${label} nesting is too deep.`);
		if (current == null || typeof current === "boolean") return;
		if (typeof current === "number") {
			if (!Number.isFinite(current)) throw new HubStoreError("CLOUD_DATA_INVALID", `${label} contains a non-finite number.`);
			return;
		}
		if (typeof current === "string") {
			const compact = [...current].filter(char => char.charCodeAt(0) > 0x20).join("");
			if (!isAllowHtml && (HTML_LIKE_RE.test(current) || /\bon\w+\s*=/i.test(current))) throw new HubStoreError("CLOUD_HTML_FORBIDDEN", `${label} contains raw HTML.`);
			if (/(?:^|\|)(?:javascript|data|vbscript|file):/i.test(compact)) {
				throw new HubStoreError("CLOUD_URL_FORBIDDEN", `${label} contains an unsafe URL scheme.`);
			}
			return;
		}
		if (typeof current !== "object") throw new HubStoreError("CLOUD_DATA_INVALID", `${label} is not JSON-safe.`);
		if (seen.has(current)) throw new HubStoreError("CLOUD_DATA_INVALID", `${label} contains a cycle.`);
		seen.add(current);
		try {
			if (Array.isArray(current)) {
				current.forEach(child => walk(child, depth + 1));
				return;
			}
			for (const [key, child] of Object.entries(current)) {
				if (FORBIDDEN_KEYS.has(key)) throw new HubStoreError("CLOUD_KEY_FORBIDDEN", `${label} contains an unsafe object key.`);
				walk(child, depth + 1);
			}
		} finally {
			seen.delete(current);
		}
	};
	walk(value, 0);
	return value;
}

function sanitizeCharacterHtmlInPlace (value) {
	const sanitizeString = string => {
		if (HTML_LIKE_RE.test(string)) return sanitizeHtml(string, CHARACTER_HTML_OPTIONS);
		if (INCOMPLETE_DANGEROUS_HTML_RE.test(string)) return string.replaceAll("<", "&lt;");
		return string;
	};
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; ++i) {
			const child = value[i];
			value[i] = typeof child === "string"
				? sanitizeString(child)
				: sanitizeCharacterHtmlInPlace(child);
		}
		return value;
	}
	if (!value || typeof value !== "object") return value;
	for (const [key, child] of Object.entries(value)) {
		value[key] = typeof child === "string"
			? sanitizeString(child)
			: sanitizeCharacterHtmlInPlace(child);
	}
	return value;
}

export function validateCloudCharacterData (data) {
	if (!data || typeof data !== "object" || Array.isArray(data)) throw new HubStoreError("CHARACTER_INVALID", `Character data must be an object.`);
	validateCloudValue(data, {label: "Character data", isAllowHtml: true});
	sanitizeCharacterHtmlInPlace(data);
	validateCloudValue(data, {label: "Character data", isAllowHtml: true});
	const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
	if (bytes > MAX_CLOUD_CHARACTER_BYTES) {
		throw new HubStoreError("CHARACTER_TOO_LARGE", `Character data exceeds the ${MAX_CLOUD_CHARACTER_BYTES}-byte limit.`, {
			status: 413,
			details: {bytes, maxBytes: MAX_CLOUD_CHARACTER_BYTES},
		});
	}
	return data;
}
