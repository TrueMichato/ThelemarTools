export class ManageBrewDiagnosticsUtil {
	static getUpdateReport ({brewUtil, brews, brewDocsUpdated = [], failedBrews = [], error = null}) {
		const getDocument = brew => ({
			documentId: brew.head?.docIdLocal || null,
			filename: brew.head?.filename || null,
			url: brew.head?.url || null,
			sources: structuredClone(brew.body?._meta?.sources || []),
		});
		const documents = [...brews, ...brewDocsUpdated, ...failedBrews.map(it => it.brew).filter(Boolean)].map(getDocument);
		const origin = brewUtil.PAGE_MANAGE === UrlUtil.PG_MANAGE_PRERELEASE ? "prerelease" : "brew";
		const records = BrewDiagnostics.getRecords();
		const diagnostics = records.filter(record => {
			if (record.origin !== "unknown" && record.origin !== origin) return false;
			const identity = ["documentId", "url", "filename"].find(key => record[key]);
			if (identity) return documents.some(doc => doc[identity] === record[identity]);
			if (!record.owner?.source) return false;
			const matches = documents.filter(doc => doc.sources.some(source => source.json === record.owner.source));
			return new Set(matches.map(doc => doc.documentId || doc.url || doc.filename)).size === 1;
		});
		const outcome = error ? "failed" : failedBrews.length ? brewDocsUpdated.length ? "partial" : "failed" : brewDocsUpdated.length ? "updated" : "unchanged";
		return {
			id: CryptUtil.uid(),
			outcome,
			summary: error
				? `Update failed! ${error.message || error}`
				: brewDocsUpdated.length
					? `Update complete! ${brewDocsUpdated.length} ${brewDocsUpdated.length === 1 ? `${brewUtil.DISPLAY_NAME} was` : `${brewUtil.DISPLAY_NAME_PLURAL} were`} updated.`
					: failedBrews.length
						? `Update failed for ${failedBrews.length} ${failedBrews.length === 1 ? brewUtil.DISPLAY_NAME : brewUtil.DISPLAY_NAME_PLURAL}.`
						: `Update complete! No ${brewUtil.DISPLAY_NAME} was updated.`,
			updated: brewDocsUpdated.map(getDocument),
			failed: failedBrews.map(it => ({document: it.brew ? getDocument(it.brew) : null, url: it.url, error: this._getUpdateError(it.error)})),
			error: error ? this._getUpdateError(error) : null,
			diagnostics,
			unassociatedDiagnostics: records.length - diagnostics.length,
		};
	}

	static _getUpdateError (error, seen = new Set()) {
		if (error == null || typeof error !== "object") return {message: String(error)};
		if (seen.has(error)) return {message: "(Circular error cause)"};
		seen.add(error);
		return {
			name: error.name || "Error",
			message: error.message || String(error),
			stack: error.stack || null,
			...(error.cause !== undefined ? {cause: this._getUpdateError(error.cause, seen)} : {}),
		};
	}

	static getUpdateReportText (report) {
		const label = doc => doc.sources.map(it => it.full || it.json || "(Unknown source)").join(", ") || doc.filename || doc.url || doc.documentId || "(Unknown document)";
		const lines = [
			report.summary,
			`Updated documents (${report.updated.length}):`,
			...report.updated.map((doc, ix) => `${ix + 1}. ${label(doc)}\n${JSON.stringify(doc, null, 2)}`),
			`Failed documents (${report.failed.length}):`,
			...report.failed.map((failure, ix) => `${ix + 1}. ${failure.document ? label(failure.document) : failure.url}\n${JSON.stringify(failure, null, 2)}`),
			...(report.error ? [`Update error:\n${JSON.stringify(report.error, null, 2)}`] : []),
			"Known issues at report time (not a fresh validation scan):",
			this.getCopyableReport(report.diagnostics),
			`Diagnostic association: ${report.diagnostics.length} included; ${report.unassociatedDiagnostics} unrelated or unassociated records not attributed to this update.`,
		];
		return lines.join("\n\n");
	}

	static logUpdateReport (report, {isReplay = false} = {}) {
		const text = `[5et:brew-update] ${report.id}${isReplay ? " (restored report; not a new update)" : ""}\n${this.getUpdateReportText(report)}`;
		// eslint-disable-next-line no-console
		console[report.outcome === "failed" ? "error" : report.outcome === "partial" || report.diagnostics.length ? "warn" : "info"](text);
	}

	static getUpdateReportHtml (report) {
		const label = doc => doc.sources.map(it => it.full || it.json || "(Unknown source)").join(", ") || doc.filename || doc.url || doc.documentId || "(Unknown document)";
		const list = items => `<ul class="ve-mt-2 ve-mb-0">${items.map(it => `<li>${it.qq()}</li>`).join("")}</ul>`;
		return `<div>
			<div>${report.summary.qq()}</div>
			${report.updated.length ? list(report.updated.map(label)) : ""}
			${report.failed.length ? `<div class="ve-mt-2">${report.failed.length} failed to update:</div>${list(report.failed.map(it => `${it.document ? label(it.document) : it.url}: ${it.error.message}`))}` : ""}
			${report.diagnostics.length ? `<div class="ve-mt-2">Known issues at report time:</div>${list(report.diagnostics.map(it => `[${it.severity.toUpperCase()}] ${it.owner.name || it.filename || it.url || it.code}: ${it.detail || it.code}`))}` : ""}
			<div class="ve-mt-2">Full update report logged to the console. Close this notification when finished reading.</div>
		</div>`;
	}

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
