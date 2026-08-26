export class ManageBrewDiagnosticsUtil {
	static getRecordKey (record) {
		return JSON.stringify([
			record.code,
			record.documentId || record.filename || record.url || record.origin,
			record.owner?.prop,
			record.owner?.name,
			record.owner?.source,
			record.fieldPath,
			record.target?.kind,
			record.target?.uid,
			record.target?.page,
			record.target?.source,
			record.target?.hash,
		]);
	}

	static getDocumentKey (record) {
		return record.filename || record.url || record.documentId || record.origin || "(Unknown document)";
	}

	static getFilteredRecords (records, {search = "", severity = "all"} = {}) {
		const searchClean = search.trim().toLowerCase();

		return records.filter(record => {
			if (severity !== "all" && record.severity !== severity) return false;
			if (!searchClean) return true;

			return [
				this.getDocumentKey(record),
				record.owner?.prop,
				record.owner?.name,
				record.owner?.source,
				record.target?.kind,
				record.target?.uid,
				record.target?.source,
				record.code,
				record.detail,
				record.fieldPath,
			]
				.filter(Boolean)
				.some(value => `${value}`.toLowerCase().includes(searchClean));
		});
	}

	static getGroups (records) {
		const byDocument = new Map();
		records.forEach(record => {
			const key = this.getDocumentKey(record);
			const group = byDocument.get(key) || {
				key,
				label: key,
				records: [],
				countErrors: 0,
				countWarnings: 0,
			};
			group.records.push(record);
			if (record.severity === "error") group.countErrors++;
			else group.countWarnings++;
			byDocument.set(key, group);
		});

		return [...byDocument.values()]
			.map(group => ({
				...group,
				records: group.records.sort((a, b) => (
					this._getSeverityRank(a.severity) - this._getSeverityRank(b.severity)
					|| this._ascSortLower(a.owner?.name || "", b.owner?.name || "")
					|| this._ascSortLower(a.code, b.code)
				)),
			}))
			.sort((a, b) => (
				Number(b.countErrors > 0) - Number(a.countErrors > 0)
				|| this._ascSortLower(a.label, b.label)
			));
	}

	static getUnseenMeta ({records, seenKeys}) {
		const recordsUnseen = records.filter(record => !seenKeys.has(this.getRecordKey(record)));
		return {
			count: recordsUnseen.length,
			hasError: recordsUnseen.some(record => record.severity === "error"),
		};
	}

	static getLaunchButtonMeta ({records, seenKeys}) {
		const {count, hasError} = this.getUnseenMeta({records, seenKeys});
		return {
			count,
			hasError,
			ariaLabel: count
				? `Check for homebrew issues; ${count} unseen issue${count === 1 ? "" : "s"}`
				: "Check for homebrew issues; no unseen issues",
			badgeText: count ? `${count}` : "",
			badgeTone: !count ? null : hasError ? "error" : "warning",
		};
	}

	static markSeen ({records, seenKeys}) {
		records.forEach(record => seenKeys.add(this.getRecordKey(record)));
	}

	static getViewModel (records, filterState) {
		const recordsVisible = this.getFilteredRecords(records, filterState);
		return {
			isEmpty: records.length === 0,
			isFilteredEmpty: records.length > 0 && recordsVisible.length === 0,
			recordsVisible,
			groups: this.getGroups(recordsVisible),
			countDocuments: new Set(recordsVisible.map(record => this.getDocumentKey(record))).size,
		};
	}

	static getCopyableReport (records) {
		return BrewDiagnostics.getCopyableReport(records);
	}

	static subscribe (fn) {
		return BrewDiagnostics.subscribe(event => fn({
			event,
			records: BrewDiagnostics.getRecords(),
		}));
	}

	/**
	 * Actively validate the loaded homebrew so structural content issues -- e.g. an item that
	 * references an item `type`/`property` no entity defines -- surface in the "Homebrew Issues"
	 * finder, instead of only appearing on another page's console when that item happens to render.
	 *
	 * Reuses the canonical `Renderer.item` enhancement path (the same code content pages run), so
	 * "what counts as an issue" never diverges between the finder and real usage. `_copy` and
	 * dereference issues are already collected at brew-load time; this adds the render-time item
	 * diagnostics Manage Homebrew otherwise never triggers, because it never enhances items.
	 *
	 * Pure orchestration (no DOM), with an injectable `renderer` so it is unit-testable; the DOM
	 * caller passes `globalThis.Renderer`. Best-effort: silently no-ops when the enhancement API is
	 * unavailable, and callers wrap it so a scan failure never breaks homebrew management.
	 *
	 * @return {Promise<boolean>} `true` if the enhancement scan actually ran, `false` if it was
	 *   skipped because the required `Renderer.item` API was unavailable.
	 */
	static async pRunValidationScan ({brewUtil, renderer} = {}) {
		if (!brewUtil) return false;
		if (!renderer || !renderer.item) return false;
		if (typeof renderer.item.pGetSiteUnresolvedRefItemsFromPrereleaseBrew !== "function") return false;

		// Load the site item property/type reference first, so brew items that legitimately reference
		//   site types/properties (e.g. "M", "LA", "V") are not falsely reported as missing.
		if (typeof renderer.item.pPopulatePropertyAndTypeReference === "function") {
			await renderer.item.pPopulatePropertyAndTypeReference();
		}

		// Enhance every loaded brew item on the private throwaway copies returned by
		//   `pGetBrewProcessed()`; enhancement triggers `getType()`/`getProperty()`, which report
		//   `item.missingType` / `item.missingProperty` into `BrewDiagnostics` for undefined references.
		await renderer.item.pGetSiteUnresolvedRefItemsFromPrereleaseBrew({brewUtil});
		return true;
	}

	static _getSeverityRank (severity) {
		return severity === "error" ? 0 : 1;
	}

	static _ascSortLower (a, b) {
		return `${a}`.toLowerCase().localeCompare(`${b}`.toLowerCase());
	}
}
