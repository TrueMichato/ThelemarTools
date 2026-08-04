import {BrewDocContentMigrator} from "./utils-brew-content-migrator.js";

export class BrewDoc {
	// Things which are stored in "_meta", but are "content metadata" rather than "file metadata."
	static _META_KEYS_CONTENT_METADATA__OBJECT = [
		"skills",
		"senses",
		"spellSchools",
		"spellDistanceUnits",
		"featCategories",
		"optionalFeatureTypes",
		"psionicTypes",
		"currencyConversions",
	];

	constructor (opts) {
		opts = opts || {};
		this.head = opts.head;
		this.body = opts.body;
	}

	toObject () {
		return {
			head: this.head instanceof _BrewDocHead ? this.head.toObject() : MiscUtil.copyFast(this.head),
			body: MiscUtil.copyFast(this.body),
		};
	}

	static fromValues ({head, body}) {
		return new this({
			head: _BrewDocHead.fromValues(head),
			body,
		});
	}

	static fromObject (obj, opts = {}) {
		const {isCopy = false} = opts;
		return new this({
			head: _BrewDocHead.fromObject(obj.head, opts),
			body: isCopy ? MiscUtil.copyFast(obj.body) : obj.body,
		});
	}

	mutUpdate ({json}) {
		this.body = json;
		this.head.mutUpdate({json, body: this.body});
		return this;
	}

	isEmpty () {
		if (
			Object.entries(this.body)
				.some(([k, v]) => {
					if (!(v instanceof Array)) return false;
					if (k === "_meta" || k === "_test") return false;
					return !!v.length;
				})
		) return false;

		if (!this.body._meta) return false;

		if (
			this.constructor._META_KEYS_CONTENT_METADATA__OBJECT
				.some(k => !!Object.keys(this.body._meta[k] || {}).length)
		) return false;

		return true;
	}

	// region Conditions
	static isOperationPermitted_moveToEditable ({brew, isAllowLocal = false} = {}) {
		return !brew.head.isEditable
			&& (isAllowLocal || !brew.head.isLocal);
	}
	// endregion

	// region Merging
	mutMerge ({json, isLazy = false}) {
		this.body = this.constructor.mergeObjects({isCopy: !isLazy, isMutMakeCompatible: false}, this.body, json);
		this.head.mutMerge({json, body: this.body, isLazy});
		return this;
	}

	static mergeObjects ({isCopy = true, isMutMakeCompatible = true} = {}, ...jsons) {
		const out = {};

		jsons.forEach(json => {
			json = isCopy ? MiscUtil.copyFast(json) : json;

			if (isMutMakeCompatible) BrewDocContentMigrator.mutMakeCompatible(json);

			Object.entries(json)
				.forEach(([prop, val]) => {
					switch (prop) {
						case "_meta": return this._mergeObjects_key__meta({out, prop, val});
						case "_test": return; // ignore; used for static testing
						default: return this._mergeObjects_default({out, prop, val});
					}
				});
		});

		return out;
	}

	static _META_KEYS_MERGEABLE_OBJECTS = [
		...this._META_KEYS_CONTENT_METADATA__OBJECT,
	];

	static _META_KEYS_MERGEABLE_SPECIAL = {
		"dateAdded": (a, b) => a != null && b != null ? Math.min(a, b) : a ?? b,
		"dateLastModified": (a, b) => a != null && b != null ? Math.max(a, b) : a ?? b,

		"dependencies": (a, b) => this._metaMerge_dependenciesIncludes(a, b),
		"includes": (a, b) => this._metaMerge_dependenciesIncludes(a, b),
		"internalCopies": (a, b) => [...(a || []), ...(b || [])].unique(),

		"otherSources": (a, b) => this._metaMerge_otherSources(a, b),

		"status": (a, b) => this._metaMerge_status(a, b),
	};

	static _metaMerge_dependenciesIncludes (a, b) {
		if (a != null && b != null) {
			Object.entries(b)
				.forEach(([prop, arr]) => a[prop] = [...(a[prop] || []), ...arr].unique());
			return a;
		}

		return a ?? b;
	}

	static _metaMerge_otherSources (a, b) {
		if (a != null && b != null) {
			// Note that this can clobber the values in the mapping, but we don't really care since they're not used.
			Object.entries(b)
				.forEach(([prop, obj]) => a[prop] = Object.assign(a[prop] || {}, obj));
			return a;
		}

		return a ?? b;
	}

	static _META_MERGE__STATUS_PRECEDENCE = [
		"invalid",
		"deprecated",
		"wip",
		"ready",
	];

	static _metaMerge_status (a, b) {
		return [a || "ready", b || "ready"]
			.sort((a, b) => this._META_MERGE__STATUS_PRECEDENCE.indexOf(a) - this._META_MERGE__STATUS_PRECEDENCE.indexOf(b))[0];
	}

	static _mergeObjects_key__meta ({out, val}) {
		out._meta = out._meta || {};

		out._meta.sources = [...(out._meta.sources || []), ...(val.sources || [])];

		Object.entries(val)
			.forEach(([metaProp, metaVal]) => {
				if (this._META_KEYS_MERGEABLE_SPECIAL[metaProp]) {
					out._meta[metaProp] = this._META_KEYS_MERGEABLE_SPECIAL[metaProp](out._meta[metaProp], metaVal);
					return;
				}
				if (!this._META_KEYS_MERGEABLE_OBJECTS.includes(metaProp)) return;
				Object.assign(out._meta[metaProp] = out._meta[metaProp] || {}, metaVal);
			});
	}

	static _mergeObjects_default ({out, prop, val}) {
		// If we cannot merge a prop, use the first value found for it, as a best-effort fallback
		if (!(val instanceof Array)) return out[prop] === undefined ? out[prop] = val : null;

		out[prop] = [...out[prop] || [], ...val];
	}
	// endregion
}

class _BrewDocHead {
	constructor (opts) {
		opts = opts || {};

		this.docIdLocal = opts.docIdLocal;
		this.timeAdded = opts.timeAdded;
		this.checksum = opts.checksum;
		this.url = opts.url;
		this.filename = opts.filename;
		this.isLocal = opts.isLocal;
		this.isEditable = opts.isEditable;
	}

	/**
	 * Install `checksum` as a self-replacing lazy accessor.
	 *
	 * Checksumming is `md5(JSON.stringify(...))` over the entire document body. For a user with a large local
	 *   homebrew collection this is multiple seconds of work on every page load, yet the checksum is only ever
	 *   read when de-duplicating user-added brew. Computing it on first read instead makes it free for the (much
	 *   more common) case where the document is merely loaded and rendered.
	 *
	 * The property is left enumerable and configurable, so that it behaves as an ordinary data property to
	 *   everything which observes it -- including object spread and the structured-clone used to persist documents
	 *   to IndexedDB, both of which read accessors, and so materialise the checksum exactly when it is needed.
	 */
	static _defineChecksumLazy (tgt, fnGet) {
		Object.defineProperty(tgt, "checksum", {
			enumerable: true,
			configurable: true,
			get () {
				const val = fnGet();
				Object.defineProperty(this, "checksum", {value: val, enumerable: true, configurable: true, writable: true});
				return val;
			},
			set (val) {
				Object.defineProperty(this, "checksum", {value: val, enumerable: true, configurable: true, writable: true});
			},
		});
		return tgt;
	}

	static _getChecksum (json) { return CryptUtil.md5(JSON.stringify(json)); }

	toObject () {
		// Note the explicit construction (rather than a spread): key order is preserved, and the checksum is
		//   materialised deliberately, as the result is intended for persistence.
		return {
			docIdLocal: this.docIdLocal,
			timeAdded: this.timeAdded,
			checksum: this.checksum,
			url: this.url,
			filename: this.filename,
			isLocal: this.isLocal,
			isEditable: this.isEditable,
		};
	}

	static fromValues (
		{
			json,
			url = null,
			filename = null,
			isLocal = false,
			isEditable = false,
		},
	) {
		const out = new this({
			docIdLocal: CryptUtil.uid(),
			timeAdded: Date.now(),
			url: url,
			filename: filename,
			isLocal: isLocal,
			isEditable: isEditable,
		});
		return this._defineChecksumLazy(out, () => this._getChecksum(json));
	}

	static fromObject (obj, {isCopy = false} = {}) {
		return new this(isCopy ? MiscUtil.copyFast(obj) : obj);
	}

	mutUpdate ({json}) {
		return this.constructor._defineChecksumLazy(this, () => this.constructor._getChecksum(json));
	}

	mutMerge ({json, body, isLazy}) {
		if (!isLazy) return this.constructor._defineChecksumLazy(this, () => this.constructor._getChecksum(body ?? json));
		return this;
	}
}
