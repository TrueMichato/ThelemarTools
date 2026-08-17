/**
 * Test Setup for Character Sheet Tests
 * Provides mocks for global utilities used by charactersheet-state.js
 */

// Mock e_() and ee`` — vanilla DOM helpers used after jQuery removal.
// In Node test environment there's no real DOM, so return stub objects with
// the subset of properties that rendering code reads/writes.
globalThis.e_ = function (opts = {}) {
	const html = opts.outer || opts.html || "";
	const el = {
		tag: opts.tag || "div",
		_clazz: opts.clazz || opts.class || "",
		_html: html,
		_children: [],
		_handlers: {},
		get innerHTML () { return this._html; },
		set innerHTML (v) { this._html = v; },
		get outerHTML () { return this._html; },
		set outerHTML (v) { this._html = v; },
		textContent: opts.txt || opts.text || "",
		style: {},
		dataset: {},
		classList: {add () {}, remove () {}, toggle () {}, contains () { return false; }},
		get children () { return this._children; },
		append (...children) {
			for (const child of children) {
				this._children.push(child);
				const childHtml = typeof child === "string" ? child : (child?._html || child?.outerHTML || "");
				// Insert child HTML before the last closing tag
				const lastClose = this._html.lastIndexOf("</");
				if (lastClose >= 0) {
					this._html = this._html.slice(0, lastClose) + childHtml + this._html.slice(lastClose);
				} else {
					this._html += childHtml;
				}
			}
		},
		appendChild (child) { this.append(child); return child; },
		prepend (...children) { this._children.unshift(...children); },
		querySelector () { return null; },
		querySelectorAll () { return []; },
		addEventListener (eventName, handler) { this._handlers[eventName] = handler; },
		removeEventListener (eventName) { delete this._handlers[eventName]; },
		click () { this._handlers.click?.(); },
		setAttribute () {},
		getAttribute () { return null; },
		remove () {},
		replaceWith () {},
		closest () { return null; },
		parentElement: null,
		cloneNode () { return globalThis.e_(opts); },
		insertAdjacentHTML (pos, html) { this._html += html; },
		dispatchEvent () {},
		matches () { return false; },
		html () { return this._html; },
	};
	return el;
};
globalThis.ee = function () { return globalThis.e_({}); };

// Add String.prototype.toTitleCase if not present
if (!String.prototype.toTitleCase) {
	String.prototype.toTitleCase = function () {
		return this.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
	};
}

// Prototype extensions the shared `js/` modules assume exist (defined in js/utils.js,
// which is not loaded in the Node test environment). Mirrors the real implementations
// so modules imported straight from `js/` — e.g. the summon-scaler reused by the
// character sheet's companion recalculation — behave identically under test.
if (!String.prototype.trimAnyChar) {
	String.prototype.trimAnyChar = function (chars) {
		let start = 0; let end = this.length;
		while (start < end && chars.indexOf(this[start]) >= 0) ++start;
		while (end > start && chars.indexOf(this[end - 1]) >= 0) --end;
		return (start > 0 || end < this.length) ? this.substring(start, end) : this;
	};
}
if (!Array.prototype.last) {
	Object.defineProperty(Array.prototype, "last", {
		enumerable: false,
		writable: true,
		value: function (arg) {
			if (arg !== undefined) this[this.length - 1] = arg;
			else return this[this.length - 1];
		},
	});
}
if (!Array.prototype.mergeMap) {
	Object.defineProperty(Array.prototype, "mergeMap", {
		enumerable: false,
		writable: true,
		value: function (fnMap) {
			return this.map((...args) => fnMap(...args)).filter(it => it != null).reduce((a, b) => Object.assign(a, b), {});
		},
	});
}

// Mock RollerUtil before CryptUtil needs it
globalThis.RollerUtil = {
	isCrypto: () => typeof crypto !== "undefined" && crypto.getRandomValues,
};

// Mock CryptUtil.uid() for generating unique IDs
globalThis.CryptUtil = {
	uid: () => {
		// Simple UUID-like generator for tests
		return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
			const r = Math.random() * 16 | 0;
			const v = c === "x" ? r : (r & 0x3 | 0x8);
			return v.toString(16);
		});
	},
	md5: (s) => s, // Simple passthrough for tests
	hashCode: (obj) => {
		if (typeof obj === "string") {
			if (!obj) return 0;
			let h = 0;
			for (let i = 0; i < obj.length; ++i) h = 31 * h + obj.charCodeAt(i);
			return h;
		} else if (typeof obj === "number") return obj;
		return 0;
	},
};

// Mock Parser if needed
globalThis.Parser = globalThis.Parser || {
	ABIL_ABVS: ["str", "dex", "con", "int", "wis", "cha"],
	SKILL_TO_ATB_ABV: {
		"athletics": "str",
		"acrobatics": "dex",
		"sleight of hand": "dex",
		"stealth": "dex",
		"arcana": "int",
		"history": "int",
		"investigation": "int",
		"nature": "int",
		"religion": "int",
		"animal handling": "wis",
		"insight": "wis",
		"medicine": "wis",
		"perception": "wis",
		"survival": "wis",
		"deception": "cha",
		"intimidation": "cha",
		"performance": "cha",
		"persuasion": "cha",
	},
	ATB_ABV_TO_FULL: {
		str: "Strength",
		dex: "Dexterity",
		con: "Constitution",
		int: "Intelligence",
		wis: "Wisdom",
		cha: "Charisma",
	},
	SRC_PHB: "PHB",
	SRC_XPHB: "XPHB",
	attAbvToFull: (abv) => globalThis.Parser.ATB_ABV_TO_FULL[abv] || abv,
	getAbilityModNumber: (score) => Math.floor((score - 10) / 2),
	spLevelToFull: (level) => {
		if (level === 0) return "Cantrip";
		const suffixes = ["st", "nd", "rd"];
		const suffix = level <= 3 ? suffixes[level - 1] : "th";
		return `${level}${suffix}`;
	},
	sourceJsonToAbv: (source) => source,
	sourceJsonToFull: (source) => source,
	nameToTokenName: (name) => (name || "").replace(/"/g, ""),
	levelToPb: (level) => (!level ? 2 : Math.ceil(level / 4) + 1),
	textToNumber: (str) => {
		// True parity with `Parser.textToNumber` (js/parser.js:136-170): same cases, same
		// values, same NaN fallback. Deliberate deviation: the `String()` coercion, so the
		// shim tolerates numeric input rather than throwing on `.trim()`.
		//
		// Parity is load-bearing, not tidiness. Two of the three call sites in
		// scalecreature-scaler-summon-class.js capture `(?<perLevel>\d+|[a-z]+)` — an
		// UNBOUNDED word — so a summon reading "5 + fifteen times your level" resolves to
		// 15 in production. A narrower shim would silently yield NaN into the HP string
		// here while production was fine, and the divergence would be invisible because
		// the real Parser wins wherever it is imported and the shim wins where it is not.
		// Note production has no ordinals above "tenth": "eleventh" is NaN, not 11.
		str = String(str).trim().toLowerCase();
		if (!isNaN(str)) return Number(str);
		switch (str) {
			case "zero": return 0;
			case "one": case "a": case "an": case "first": return 1;
			case "two": case "double": case "second": return 2;
			case "three": case "triple": case "third": return 3;
			case "four": case "quadruple": case "fourth": return 4;
			case "five": case "fifth": return 5;
			case "six": case "sixth": return 6;
			case "seven": case "seventh": return 7;
			case "eight": case "eighth": return 8;
			case "nine": case "ninth": return 9;
			case "ten": case "tenth": return 10;
			case "eleven": return 11;
			case "twelve": return 12;
			case "thirteen": return 13;
			case "fourteen": return 14;
			case "fifteen": return 15;
			case "sixteen": return 16;
			case "seventeen": return 17;
			case "eighteen": return 18;
			case "nineteen": return 19;
			case "twenty": return 20;
			case "thirty": return 30;
			case "forty": return 40;
			case "fifty": return 50;
			case "sixty": return 60;
			case "seventy": return 70;
			case "eighty": return 80;
			case "ninety": return 90;
			default: return NaN;
		}
	},
	getOrdinalForm: (n) => {
		const suffixes = ["th", "st", "nd", "rd"];
		const v = n % 100;
		return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
	},
};

// Mock MiscUtil if needed
globalThis.MiscUtil = globalThis.MiscUtil || {
	copyFast: (obj) => JSON.parse(JSON.stringify(obj)),
	copy: (obj) => JSON.parse(JSON.stringify(obj)),
	getProperty: (obj, path) => {
		const parts = path.split(".");
		let current = obj;
		for (const part of parts) {
			if (current == null) return undefined;
			current = current[part];
		}
		return current;
	},
	setProperty: (obj, path, value) => {
		const parts = path.split(".");
		let current = obj;
		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i];
			if (current[part] == null) current[part] = {};
			current = current[part];
		}
		current[parts[parts.length - 1]] = value;
	},
	GENERIC_WALKER_ENTRIES_KEY_BLOCKLIST: new Set(["caption", "type", "colLabels", "colLabelRows", "name", "colStyles", "style", "shortName", "subclassShortName", "id", "path", "source"]),
	// Minimal stand-in for the real recursive walker: enough to drive the string
	// handler over an entries tree, honouring the key blocklist.
	getWalker: ({keyBlocklist} = {}) => ({
		walk: (obj, handlers) => {
			const blocked = keyBlocklist || new Set();
			const rec = (node) => {
				if (typeof node === "string") return handlers?.string ? handlers.string(node) : node;
				if (Array.isArray(node)) return node.map(rec);
				if (node && typeof node === "object") {
					const out = {};
					for (const [k, v] of Object.entries(node)) out[k] = blocked.has(k) ? v : rec(v);
					return out;
				}
				return node;
			};
			return rec(obj);
		},
	}),
};

// Mock UiUtil (used by shared `js/` modules imported into sheet code)
globalThis.UiUtil = globalThis.UiUtil || {
	intToBonus: (int, {isPretty = false} = {}) => `${int >= 0 ? "+" : int < 0 ? (isPretty ? "\u2212" : "-") : ""}${Math.abs(int)}`,
};

// Mock StorageUtil if needed for serialization
globalThis.StorageUtil = globalThis.StorageUtil || {
	pGetForPage: async () => null,
	pSetForPage: async () => {},
	getForPage: () => null,
	setForPage: () => {},
};

// Mock JqueryUtil — some charactersheet modules destructure this at load time
// (see charactersheet-builder.js line 8), so it must be present BEFORE the
// module is imported. Tests that need to inspect toasts can override doToast.
globalThis.JqueryUtil = globalThis.JqueryUtil || {
	doToast: () => {},
};

// Mock InputUiUtil — destructured at load time by some modules (e.g. charactersheet-upgrades.js).
// Defaults resolve to "confirm"/first-choice; tests can override individual methods (the captured
// reference is the same object, so mutating its methods after import takes effect).
globalThis.InputUiUtil = globalThis.InputUiUtil || {
	pGetUserBoolean: async () => true,
	pGetUserEnum: async () => 0,
	pGetUserString: async () => "",
};

// Mock Renderer if needed
globalThis.Renderer = globalThis.Renderer || {
	get: () => ({
		render: (entry) => typeof entry === "string" ? entry : JSON.stringify(entry),
		recursiveRender: (entry) => typeof entry === "string" ? entry : JSON.stringify(entry),
		getMediaUrl: (type, path) => `${type}/${path}`,
		baseUrl: "",
	}),
	stripTags: (str) => (str || "").replace(/\{@[^}]+\s([^|}]+)[^}]*\}/g, "$1"),
};
// Ensure Renderer.monster exists for companion icon token URLs
if (!globalThis.Renderer.monster) {
	globalThis.Renderer.monster = {
		getTokenUrl: (mon) => {
			if (!mon?.name || !mon?.source) return null;
			const tokenName = (globalThis.Parser?.nameToTokenName || ((n) => n))(mon.name);
			return `img/bestiary/tokens/${mon.source}/${tokenName}.webp`;
		},
		hasToken: (mon) => !!mon?.hasToken,
	};
}
// Ensure Renderer.generic exists
if (!globalThis.Renderer.generic) {
	globalThis.Renderer.generic = {
		getTokenUrl: (ent, mediaDir) => {
			if (!ent?.name || !ent?.source) return null;
			const tokenName = (globalThis.Parser?.nameToTokenName || ((n) => n))(ent.name);
			return `img/${mediaDir}/${ent.source}/${tokenName}.webp`;
		},
		hasToken: (ent) => !!ent?.hasToken,
	};
}
// Musical-instrument list used by tool-proficiency choice UIs (Builder / multiclass level-up).
if (!globalThis.Renderer.generic.FEATURE__TOOLS_MUSICAL_INSTRUMENTS) {
	globalThis.Renderer.generic.FEATURE__TOOLS_MUSICAL_INSTRUMENTS = [
		"bagpipes",
		"drum",
		"dulcimer",
		"flute",
		"horn",
		"lute",
		"lyre",
		"pan flute",
		"shawm",
		"viol",
	];
}
// Ensure Renderer.spell.getCombinedClasses exists for spell filtering tests
if (!globalThis.Renderer.spell) {
	globalThis.Renderer.spell = {
		getCombinedClasses: (sp, prop) => (sp.classes || {})[prop] || [],
	};
} else if (!globalThis.Renderer.spell.getCombinedClasses) {
	globalThis.Renderer.spell.getCombinedClasses = (sp, prop) => (sp.classes || {})[prop] || [];
}

// Mock UrlUtil if needed
globalThis.UrlUtil = globalThis.UrlUtil || {
	autoEncodeHash: (it) => it?.name?.toLowerCase().replace(/\s+/g, "-") || "",
	PG_SPELLS: "spells.html",
	PG_ITEMS: "items.html",
};
