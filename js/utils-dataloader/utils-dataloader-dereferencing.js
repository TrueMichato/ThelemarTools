import {DataLoaderInternalUtil} from "./utils-dataloader-internal-util.js";
import {DataLoaderDereferencerClassSubclassFeatures} from "./dereferencer/utils-dataloader-dereferencer-classsubclassfeatures.js";
import {DataLoaderDereferencerOptionalfeatures} from "./dereferencer/utils-dataloader-dereferencer-optionalfeatures.js";
import {DataLoaderDereferencerFeats} from "./dereferencer/utils-dataloader-dereferencer-feats.js";
import {DataLoaderDereferencerItemEntries} from "./dereferencer/utils-dataloader-dereferencer-itementries.js";

export class DataLoaderDereferencerFacade {
	static _REF_TYPE_TO_DEREFERENCER = {};

	static _init () {
		this._REF_TYPE_TO_DEREFERENCER["refClassFeature"] =
		this._REF_TYPE_TO_DEREFERENCER["refSubclassFeature"] =
			new DataLoaderDereferencerClassSubclassFeatures();

		this._REF_TYPE_TO_DEREFERENCER["refOptionalfeature"] =
			new DataLoaderDereferencerOptionalfeatures();

		this._REF_TYPE_TO_DEREFERENCER["refFeat"] =
			new DataLoaderDereferencerFeats();

		this._REF_TYPE_TO_DEREFERENCER["refItemEntry"] =
			new DataLoaderDereferencerItemEntries();

		return null;
	}

	static _ = this._init();

	static _WALKER_READ = MiscUtil.getWalker({
		keyBlocklist: MiscUtil.GENERIC_WALKER_ENTRIES_KEY_BLOCKLIST,
		isNoModification: true,
		isBreakOnReturn: true,
	});

	/**
	 *  Build an object of the form `{page: [...entities...]}` and return it.
	 * @param entities
	 * @param {string} page
	 * @param {string} propEntries
	 * @param {string} propIsRef
	 * @param {DataLoaderConst.LOADSPACE_SITE | DataLoaderConst.LOADSPACE_BREW | DataLoaderConst.LOADSPACE_PRERELEASE | null} loadspace
	 */
	static async pGetDereferenced (
		entities,
		page,
		{
			propEntries = "entries",
			propIsRef = null,
			loadspace = null,
		} = {},
	) {
		if (page.toLowerCase().endsWith(".html")) throw new Error(`Could not dereference "${page}" content. Dereferencing is only supported for props!`);

		if (!entities || !entities.length) return {};

		const out = {};
		const entriesWithRefs = {};
		const entriesWithoutRefs = {};

		this._pGetDereferenced_doSegregateWithWithoutRefs({
			entities,
			page,
			propEntries,
			propIsRef,
			entriesWithRefs,
			entriesWithoutRefs,
		});

		await this._pGetDereferenced_pDoDereference({propEntries, entriesWithRefs, entriesWithoutRefs, loadspace});
		this._pGetDereferenced_doNotifyFailed({entriesWithRefs, entities, propEntries});
		this._pGetDereferenced_doPopulateOutput({page, out, entriesWithoutRefs, entriesWithRefs});

		return out;
	}

	/* -------------------------------------------- */

	static _pGetDereferenced_doSegregateWithWithoutRefs ({entities, page, propEntries, propIsRef, entriesWithRefs, entriesWithoutRefs}) {
		const hashBuilder = UrlUtil.URL_TO_HASH_BUILDER[page];
		entities
			.forEach(ent => {
				const hash = hashBuilder(ent);
				const hasRefs = this._pGetDereferenced_hasRefs({ent, propEntries, propIsRef});

				(
					(hasRefs ? entriesWithRefs : entriesWithoutRefs)[page] = (hasRefs ? entriesWithRefs : entriesWithoutRefs)[page] || {}
				)[hash] = hasRefs ? MiscUtil.copyFast(ent) : ent;
			});
	}

	static _pGetDereferenced_hasRefs ({ent, propEntries, propIsRef}) {
		if (propIsRef != null) return !!ent[propIsRef];

		const ptrHasRef = {_: false};
		this._WALKER_READ.walk(ent[propEntries], this._pGetDereferenced_doPopulateRaw_getHandlers({ptrHasRef}));
		return ptrHasRef._;
	}

	static _pGetDereferenced_doPopulateRaw_getHandlers ({ptrHasRef}) {
		return {
			object: (obj) => {
				if (this._REF_TYPE_TO_DEREFERENCER[obj.type]) return ptrHasRef._ = true;
			},
			string: (str) => {
				if (str.startsWith("{#") && str.endsWith("}")) return ptrHasRef._ = true;
			},
		};
	}

	/* -------------------------------------------- */

	static _MAX_DEREFERENCE_LOOPS = 25; // conservatively avoid infinite looping

	static async _pGetDereferenced_pDoDereference ({propEntries, entriesWithRefs, entriesWithoutRefs, loadspace}) {
		for (let i = 0; i < this._MAX_DEREFERENCE_LOOPS; ++i) {
			if (!Object.keys(entriesWithRefs).length) break;

			for (const [page, pageEntries] of Object.entries(entriesWithRefs)) {
				for (const [hash, ent] of Object.entries(pageEntries)) {
					const toReplaceMetas = [];
					this._WALKER_READ.walk(
						ent[propEntries],
						this._pGetDereferenced_doDereference_getHandlers({toReplaceMetas}),
					);

					for (const {type} of toReplaceMetas) {
						if (!this._REF_TYPE_TO_DEREFERENCER[type]) continue;
						await this._REF_TYPE_TO_DEREFERENCER[type].pPreloadRefContent({loadspace});
					}

					let cntReplaces = 0;
					for (let ixReplace = 0; ixReplace < toReplaceMetas.length; ++ixReplace) {
						const toReplaceMeta = this._pGetDereferenced_doDereference_getToReplaceMeta(toReplaceMetas[ixReplace]);

						const derefMeta = this._REF_TYPE_TO_DEREFERENCER[toReplaceMeta.type].dereference({
							ent,
							entriesWithoutRefs,
							toReplaceMeta,
							ixReplace,
						});
						cntReplaces += derefMeta.cntReplaces;

						if (!derefMeta.offsetIx) continue;

						toReplaceMetas.slice(ixReplace + 1).forEach(it => it.ix += derefMeta.offsetIx);
					}

					if (cntReplaces === toReplaceMetas.length) {
						delete pageEntries[hash];
						(entriesWithoutRefs[page] = entriesWithoutRefs[page] || {})[hash] = ent;
					}
				}

				if (!Object.keys(pageEntries).length) delete entriesWithRefs[page];
			}
		}
	}

	static _pGetDereferenced_doDereference_getHandlers ({toReplaceMetas}) {
		return {
			array: (arr) => {
				arr.forEach((it, i) => {
					if (this._REF_TYPE_TO_DEREFERENCER[it.type]) {
						toReplaceMetas.push({
							...it,
							array: arr,
							ix: i,
						});
						return;
					}

					if (typeof it === "string" && it.startsWith("{#") && it.endsWith("}")) {
						toReplaceMetas.push({
							string: it,
							array: arr,
							ix: i,
						});
					}
				});
			},
		};
	}

	static _pGetDereferenced_doDereference_getToReplaceMeta (toReplaceMetaRaw) {
		if (toReplaceMetaRaw.string == null) return toReplaceMetaRaw;

		const str = toReplaceMetaRaw.string;
		delete toReplaceMetaRaw.string;
		return {...toReplaceMetaRaw, ...Renderer.hover.getRefMetaFromTag(str)};
	}

	/* -------------------------------------------- */

	static _pGetDereferenced_doNotifyFailed ({entriesWithRefs, entities, propEntries}) {
		const failedRefs = Object.entries(entriesWithRefs)
			.flatMap(([page, hashToEntry]) => Object.values(hashToEntry)
				.flatMap(ent => this._pGetDereferenced_getFailedRefs({ent, page, propEntries})));

		if (!failedRefs.length) return;

		DataLoaderInternalUtil.doNotifyFailedDereferences({
			failedRefs,
			diagnostics: entities
				.map(ent => ent.__diagnostic)
				.filter(Boolean),
		});
	}

	static _pGetDereferenced_getFailedRefs ({ent, page, propEntries}) {
		const out = [];
		const owner = {
			prop: ent.__diagnostic?.prop || ent.__prop || page,
			name: ent.name || null,
			source: SourceUtil.getEntitySource(ent) || null,
		};

		this._pGetDereferenced_getFailedRefs_recurse({
			value: ent[propEntries],
			fieldPath: propEntries,
			out,
			owner,
			diagnostic: ent.__diagnostic || null,
		});
		return out;
	}

	static _pGetDereferenced_getFailedRefs_recurse ({value, fieldPath, out, owner, diagnostic}) {
		if (value instanceof Array) {
			value.forEach((it, ix) => this._pGetDereferenced_getFailedRefs_recurse({
				value: it,
				fieldPath: `${fieldPath}[${ix}]`,
				out,
				owner,
				diagnostic,
			}));
			return;
		}

		if (typeof value === "string") {
			if (!value.startsWith("{#") || !value.endsWith("}")) return;
			this._pGetDereferenced_getFailedRefs_add({
				ref: Renderer.hover.getRefMetaFromTag(value),
				fieldPath,
				out,
				owner,
				diagnostic,
				isDirect: true,
			});
			return;
		}

		if (!value || typeof value !== "object") return;
		if (this._pGetDereferenced_getFailedRefs_add({ref: value, fieldPath, out, owner, diagnostic})) return;

		Object.entries(value)
			.filter(([k]) => !MiscUtil.GENERIC_WALKER_ENTRIES_KEY_BLOCKLIST.has(k))
			.forEach(([k, v]) => this._pGetDereferenced_getFailedRefs_recurse({
				value: v,
				fieldPath: `${fieldPath}.${k}`,
				out,
				owner,
				diagnostic,
			}));
	}

	static _pGetDereferenced_getFailedRefs_add ({ref, fieldPath, out, owner, diagnostic, isDirect = false}) {
		const meta = this._pGetDereferenced_getFailedRefs_getMeta(ref);
		if (!meta) return false;

		out.push({
			...meta,
			owner,
			diagnostic,
			refKind: isDirect ? "string" : "object",
			fieldPath: `${fieldPath}${isDirect ? "" : meta.fieldSuffix}`,
		});
		return true;
	}

	static _pGetDereferenced_getFailedRefs_getMeta (ref) {
		switch (ref.type) {
			case "refClassFeature": return {prop: "classFeature", uid: ref.classFeature, fieldSuffix: ".classFeature"};
			case "refSubclassFeature": return {prop: "subclassFeature", uid: ref.subclassFeature, fieldSuffix: ".subclassFeature"};
			case "refOptionalfeature": return {prop: "optionalfeature", uid: ref.optionalfeature, fieldSuffix: ".optionalfeature"};
			case "refFeat": return {prop: "feat", uid: ref.feat, fieldSuffix: ".feat"};
			case "refItemEntry": return {prop: "itemEntry", uid: ref.itemEntry, fieldSuffix: ".itemEntry"};
			default: return null;
		}
	}

	/* -------------------------------------------- */

	static _pGetDereferenced_doPopulateOutput ({isOverwrite, out, entriesWithoutRefs, entriesWithRefs}) {
		[
			...Object.entries(entriesWithoutRefs),
			// Add the failed-to-resolve entities to the cache; the missing refs will simply not be rendered
			...Object.entries(entriesWithRefs),
		]
			.forEach(([page, hashToEnt]) => {
				Object.entries(hashToEnt)
					.forEach(([hash, ent]) => {
						if (!isOverwrite && globalThis.DataLoader.getFromCache(page, ent.source, hash)) return;
						(out[page] = out[page] || []).push(ent);
					});
			});
	}
}
