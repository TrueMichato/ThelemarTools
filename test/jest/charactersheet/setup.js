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
		_html: html,
		_children: [],
		get innerHTML () { return this._html; },
		set innerHTML (v) { this._html = v; },
		get outerHTML () { return this._html; },
		set outerHTML (v) { this._html = v; },
		textContent: opts.txt || "",
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
		prepend (...children) { this._children.unshift(...children); },
		querySelector () { return null; },
		querySelectorAll () { return []; },
		addEventListener () {},
		removeEventListener () {},
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
