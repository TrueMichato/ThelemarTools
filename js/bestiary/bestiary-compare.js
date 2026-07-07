"use strict";

/* ==============================================================
 * bestiary-compare.js
 *
 * Compare-Creatures side-by-side view.
 *
 * Provides two layers:
 *   - CompareCreaturesDiff  (pure, no DOM, no Renderer required for the
 *     core comparison contract) — returns a flat list of rows describing
 *     each statblock field and how it differs between the provided
 *     monsters. Directly unit-testable.
 *   - RenderCompareCreatures  (DOM/Renderer-dependent) — turns the diff
 *     rows into a CSS-grid comparison table, opens it in a fullscreen
 *     modal, wires the header, "Copy link" button, etc.
 *
 * The diff module operates on plain monster objects (as loaded from
 * bestiary JSON). It uses Parser primitives for rendering the plain-
 * text value where possible, but every comparison is done on
 * normalised strings so that harmless whitespace / tag differences
 * don't count as diffs.
 *
 * See docs & plan: session `Compare creatures` plan.md.
 * ============================================================== */

const CMP_STATUS_SAME = "same";
const CMP_STATUS_DIFF = "diff";
const CMP_STATUS_MISSING = "missing";

// -------------------------------------------------------------
// CompareCreaturesDiff — pure module
// -------------------------------------------------------------

class CompareCreaturesDiff {
	static STATUS_SAME = CMP_STATUS_SAME;
	static STATUS_DIFF = CMP_STATUS_DIFF;
	static STATUS_MISSING = CMP_STATUS_MISSING;

	/**
	 * @param {Array<object>} monsters Parsed monster objects (post `Renderer.monster.initParsed` is fine but not required).
	 * @returns {Array<object>} Ordered rows describing every comparison field.
	 */
	static getRows (monsters) {
		if (!Array.isArray(monsters) || monsters.length < 2) return [];

		const out = [];

		// ---- Header ("size, type, alignment") ----
		out.push(this._makeSimpleRow({
			key: "sizeTypeAlignment",
			label: "Size / Type / Alignment",
			monsters,
			fnExtract: mon => this._getSizeTypeAlignmentText(mon),
		}));

		// ---- AC ----
		out.push(this._makeSimpleRow({
			key: "ac",
			label: "AC",
			monsters,
			fnExtract: mon => this._getAcText(mon),
			fnNumeric: mon => this._getAcNumeric(mon),
		}));

		// ---- HP ----
		out.push(this._makeSimpleRow({
			key: "hp",
			label: "HP",
			monsters,
			fnExtract: mon => this._getHpText(mon),
			fnNumeric: mon => this._getHpNumeric(mon),
		}));

		// ---- Initiative (2024) ----
		out.push(this._makeSimpleRow({
			key: "initiative",
			label: "Initiative",
			monsters,
			fnExtract: mon => this._getInitiativeText(mon),
		}));

		// ---- Speed ----
		out.push(this._makeSimpleRow({
			key: "speed",
			label: "Speed",
			monsters,
			fnExtract: mon => this._getSpeedText(mon),
		}));

		// ---- Ability scores (one row per ability) ----
		this._getAbilities().forEach(ab => {
			out.push(this._makeAbilityRow({monsters, ab}));
		});

		// ---- Saves ----
		out.push(this._makeSimpleRow({
			key: "save",
			label: "Saving Throws",
			monsters,
			fnExtract: mon => this._getSavesText(mon),
		}));

		// ---- Skills ----
		out.push(this._makeSimpleRow({
			key: "skill",
			label: "Skills",
			monsters,
			fnExtract: mon => this._getSkillsText(mon),
		}));

		// ---- Damage vulnerabilities / resistances / immunities / condition immunities ----
		out.push(this._makeSimpleRow({key: "vulnerable", label: "Damage Vulnerabilities", monsters, fnExtract: mon => this._getImmResText(mon, "vulnerable")}));
		out.push(this._makeSimpleRow({key: "resist", label: "Damage Resistances", monsters, fnExtract: mon => this._getImmResText(mon, "resist")}));
		out.push(this._makeSimpleRow({key: "immune", label: "Damage Immunities", monsters, fnExtract: mon => this._getImmResText(mon, "immune")}));
		out.push(this._makeSimpleRow({key: "conditionImmune", label: "Condition Immunities", monsters, fnExtract: mon => this._getCondImmuneText(mon)}));

		// ---- Senses (incl. passive perception) ----
		out.push(this._makeSimpleRow({
			key: "senses",
			label: "Senses",
			monsters,
			fnExtract: mon => this._getSensesText(mon),
		}));

		// ---- Languages ----
		out.push(this._makeSimpleRow({
			key: "languages",
			label: "Languages",
			monsters,
			fnExtract: mon => this._getLanguagesText(mon),
		}));

		// ---- CR ----
		out.push(this._makeSimpleRow({
			key: "cr",
			label: "CR",
			monsters,
			fnExtract: mon => this._getCrText(mon),
			fnNumeric: mon => this._getCrNumeric(mon),
		}));

		// ---- PB ----
		out.push(this._makeSimpleRow({
			key: "pb",
			label: "Proficiency Bonus",
			monsters,
			fnExtract: mon => this._getPbText(mon),
			fnNumeric: mon => (mon.pbNote ?? null) == null ? this._getPbNumeric(mon) : null,
		}));

		// ---- Entry-list sections (name-keyed sub-rows) ----
		[
			{sectionKey: "trait", label: "Traits"},
			{sectionKey: "action", label: "Actions"},
			{sectionKey: "bonus", label: "Bonus Actions"},
			{sectionKey: "reaction", label: "Reactions"},
			{sectionKey: "legendary", label: "Legendary Actions"},
			{sectionKey: "mythic", label: "Mythic Actions"},
		].forEach(({sectionKey, label}) => {
			const subRows = this._makeEntryListSection({monsters, prop: sectionKey, sectionLabel: label});
			if (subRows.length) {
				out.push(this._makeSectionHeader({key: sectionKey, label, subRowsCount: subRows.length}));
				subRows.forEach(r => out.push(r));
			}
		});

		// ---- Spellcasting block (whole-block equality; no sub-diff) ----
		out.push(this._makeSimpleRow({
			key: "spellcasting",
			label: "Spellcasting",
			monsters,
			fnExtract: mon => this._getSpellcastingText(mon),
		}));

		// ---- Environment / Treasure / Source ----
		out.push(this._makeSimpleRow({
			key: "environment",
			label: "Environment",
			monsters,
			fnExtract: mon => (mon.environment || []).map(e => this._normalise(e)).sort().join(", "),
		}));
		out.push(this._makeSimpleRow({
			key: "treasure",
			label: "Treasure",
			monsters,
			fnExtract: mon => (mon.treasure || []).map(e => this._normalise(e)).sort().join(", "),
		}));
		out.push(this._makeSimpleRow({
			key: "source",
			label: "Source",
			monsters,
			fnExtract: mon => `${mon.source || ""}${mon.page != null ? ` p.${mon.page}` : ""}`.trim(),
		}));

		return out;
	}

	// -------------------------------------------------------------
	// Row constructors
	// -------------------------------------------------------------

	static _makeSimpleRow ({key, label, monsters, fnExtract, fnNumeric}) {
		const cells = monsters.map(mon => {
			const raw = fnExtract(mon);
			const isPresent = raw != null && raw !== "" && !(Array.isArray(raw) && !raw.length);
			const textPlain = isPresent ? String(raw) : "";
			const value = fnNumeric ? fnNumeric(mon) : null;
			return {
				textPlain,
				textNorm: this._normalise(textPlain),
				value,
				isPresent,
				status: null,
			};
		});
		this._assignStatuses(cells);
		return {
			key,
			label,
			sectionKey: null,
			subLabel: null,
			cells,
			isAllSame: cells.every(c => c.status === CMP_STATUS_SAME),
			isAllPresent: cells.every(c => c.isPresent),
			isSectionHeader: false,
		};
	}

	static _makeSectionHeader ({key, label, subRowsCount}) {
		return {
			key: `_hdr_${key}`,
			label,
			sectionKey: key,
			subLabel: null,
			cells: [],
			isAllSame: false,
			isAllPresent: false,
			isSectionHeader: true,
			subRowsCount,
		};
	}

	static _makeAbilityRow ({monsters, ab}) {
		const cells = monsters.map(mon => {
			const raw = mon[ab];
			const isPresent = typeof raw === "number";
			const value = isPresent ? raw : null;
			return {
				textPlain: isPresent ? String(raw) : "",
				textNorm: isPresent ? String(raw) : "",
				value,
				isPresent,
				status: null,
				abilityDelta: null,
			};
		});
		this._assignStatuses(cells);

		// Attach heat-map delta from the mean of present values.
		const presentValues = cells.filter(c => c.isPresent).map(c => c.value);
		if (presentValues.length) {
			const mean = presentValues.reduce((a, b) => a + b, 0) / presentValues.length;
			cells.forEach(c => { if (c.isPresent) c.abilityDelta = c.value - mean; });
		}

		return {
			key: `ability_${ab}`,
			label: (typeof Parser !== "undefined" && Parser.attAbvToFull) ? Parser.attAbvToFull(ab) : ab.toUpperCase(),
			ability: ab,
			sectionKey: "ability",
			subLabel: null,
			cells,
			isAllSame: cells.every(c => c.status === CMP_STATUS_SAME),
			isAllPresent: cells.every(c => c.isPresent),
			isSectionHeader: false,
		};
	}

	/**
	 * Build name-keyed sub-rows for a trait/action/reaction/etc. section.
	 * Each unique entry name across all monsters becomes one sub-row.
	 * Cells that are missing on a given monster get status="missing".
	 */
	static _makeEntryListSection ({monsters, prop, sectionLabel}) {
		// Collect unique entry names in stable order (first-appearance across
		// the monster list wins).
		const nameOrder = [];
		const seen = new Set();
		monsters.forEach(mon => {
			const arr = mon[prop];
			if (!Array.isArray(arr)) return;
			arr.forEach(ent => {
				const name = this._getEntryName(ent);
				if (!seen.has(name)) {
					seen.add(name);
					nameOrder.push(name);
				}
			});
		});

		return nameOrder.map(name => {
			const cells = monsters.map(mon => {
				const arr = Array.isArray(mon[prop]) ? mon[prop] : [];
				const ent = arr.find(e => this._getEntryName(e) === name);
				if (!ent) {
					return {
						textPlain: "",
						textNorm: "",
						value: null,
						entry: null,
						isPresent: false,
						status: CMP_STATUS_MISSING,
					};
				}
				const textPlain = this._getEntryBodyText(ent);
				return {
					textPlain,
					textNorm: this._normalise(textPlain),
					value: null,
					entry: ent,
					isPresent: true,
					status: null,
				};
			});
			this._assignStatuses(cells);
			const isAllPresent = cells.every(c => c.isPresent);
			return {
				key: `${prop}_${name}`,
				label: name,
				sectionKey: prop,
				sectionLabel,
				subLabel: name,
				cells,
				isAllSame: isAllPresent && cells.every(c => c.status === CMP_STATUS_SAME),
				isAllPresent,
				isSectionHeader: false,
			};
		});
	}

	// -------------------------------------------------------------
	// Status assignment
	// -------------------------------------------------------------

	static _assignStatuses (cells) {
		const presentCells = cells.filter(c => c.isPresent);
		if (presentCells.length === 0) {
			cells.forEach(c => { c.status = CMP_STATUS_MISSING; });
			return;
		}

		const norms = presentCells.map(c => c.textNorm);
		const isAllSameNorm = norms.every(n => n === norms[0]);
		const isAllPresent = presentCells.length === cells.length;

		cells.forEach(c => {
			if (!c.isPresent) { c.status = CMP_STATUS_MISSING; return; }
			// If a value is present but at least one other creature is missing
			// it, flag it as diff — the absence is itself a difference.
			if (!isAllPresent) { c.status = CMP_STATUS_DIFF; return; }
			c.status = isAllSameNorm ? CMP_STATUS_SAME : CMP_STATUS_DIFF;
		});
	}

	// -------------------------------------------------------------
	// Field extractors — small wrappers that gracefully degrade when
	// the Renderer/Parser are unavailable (so the diff runs in a
	// minimal test harness with just parser.js + utils.js loaded).
	// -------------------------------------------------------------

	static _getAbilities () { return ["str", "dex", "con", "int", "wis", "cha"]; }

	static _getSizeTypeAlignmentText (mon) {
		const parts = [];
		if (mon.size) {
			const sizes = Array.isArray(mon.size) ? mon.size : [mon.size];
			parts.push(sizes.map(s => typeof Renderer !== "undefined" && Renderer.utils && Renderer.utils.getRenderedSize ? Renderer.utils.getRenderedSize(s) : s).join("/"));
		}
		if (mon.type) {
			const typeText = typeof Parser !== "undefined" && Parser.monTypeToFullObj
				? Parser.monTypeToFullObj(mon.type).asText
				: (typeof mon.type === "string" ? mon.type : mon.type?.type || "");
			if (typeText) parts.push(typeText);
		}
		if (mon.alignment) {
			const alignText = typeof Parser !== "undefined" && Parser.alignmentListToFull
				? Parser.alignmentListToFull(mon.alignment)
				: (Array.isArray(mon.alignment) ? mon.alignment.join(" ") : String(mon.alignment));
			if (alignText) parts.push(alignText);
		}
		return parts.join(", ");
	}

	static _getAcText (mon) {
		if (mon.ac == null) return "";
		if (typeof Parser !== "undefined" && Parser.acToFull) {
			try { return Parser.acToFull(mon.ac); } catch (e) { /* fall through */ }
		}
		return this._fallbackAcText(mon.ac);
	}

	static _fallbackAcText (ac) {
		if (typeof ac === "string" || typeof ac === "number") return String(ac);
		if (!Array.isArray(ac)) return "";
		return ac.map(entry => {
			if (entry == null) return "";
			if (typeof entry === "number" || typeof entry === "string") return String(entry);
			if (entry.ac != null) {
				let s = String(entry.ac);
				if (entry.from && entry.from.length) s += ` (${entry.from.map(f => this._stripTags(String(f))).join(", ")})`;
				return s;
			}
			return entry.special || "";
		}).filter(Boolean).join(", ");
	}

	static _getAcNumeric (mon) {
		if (mon.ac == null) return null;
		if (typeof mon.ac === "number") return mon.ac;
		if (Array.isArray(mon.ac)) {
			for (const entry of mon.ac) {
				if (typeof entry === "number") return entry;
				if (entry && typeof entry.ac === "number") return entry.ac;
			}
		}
		return null;
	}

	static _getHpText (mon) {
		if (mon.hp == null) return "";
		if (typeof mon.hp === "string" || typeof mon.hp === "number") return String(mon.hp);
		if (typeof Renderer !== "undefined" && Renderer.monster?.getRenderedHp) {
			try { return this._stripTags(Renderer.monster.getRenderedHp(mon.hp)); } catch (e) { /* fall through */ }
		}
		if (mon.hp.average != null && mon.hp.formula) return `${mon.hp.average} (${mon.hp.formula})`;
		if (mon.hp.average != null) return String(mon.hp.average);
		if (mon.hp.special) return String(mon.hp.special);
		return "";
	}

	static _getHpNumeric (mon) {
		if (mon.hp == null) return null;
		if (typeof mon.hp === "number") return mon.hp;
		if (typeof mon.hp === "object" && typeof mon.hp.average === "number") return mon.hp.average;
		return null;
	}

	static _getInitiativeText (mon) {
		if (!mon.initiative) return "";
		if (typeof mon.initiative === "number") return String(mon.initiative);
		if (typeof Renderer !== "undefined" && Renderer.monster?.getInitiativePart) {
			try { return this._stripTags(Renderer.monster.getInitiativePart(mon, {isPlainText: true})); } catch (e) { /* fall through */ }
		}
		return "";
	}

	static _getSpeedText (mon) {
		if (!mon.speed) return "";
		if (typeof mon.speed === "number") return `${mon.speed} ft.`;
		if (typeof Parser !== "undefined" && Parser.getSpeedString) {
			try { return this._stripTags(Parser.getSpeedString(mon)); } catch (e) { /* fall through */ }
		}
		if (typeof mon.speed === "object") {
			return Object.entries(mon.speed)
				.filter(([k, v]) => typeof v === "number" || (v && typeof v === "object" && typeof v.number === "number"))
				.map(([k, v]) => {
					const n = typeof v === "number" ? v : v.number;
					return `${k === "walk" ? "" : `${k} `}${n} ft.`.trim();
				})
				.join(", ");
		}
		return "";
	}

	static _getSavesText (mon) {
		if (!mon.save) return "";
		if (typeof Renderer !== "undefined" && Renderer.monster?.getSavesPart) {
			try { return this._stripTags(Renderer.monster.getSavesPart(mon)); } catch (e) { /* fall through */ }
		}
		return Object.entries(mon.save).map(([ab, v]) => `${ab.toUpperCase()} ${v}`).join(", ");
	}

	static _getSkillsText (mon) {
		if (!mon.skill) return "";
		if (typeof Renderer !== "undefined" && Renderer.monster?.getSkillsString) {
			try { return this._stripTags(Renderer.monster.getSkillsString(Renderer.get(), mon)); } catch (e) { /* fall through */ }
		}
		return Object.entries(mon.skill).map(([sk, v]) => `${sk} ${v}`).join(", ");
	}

	static _getImmResText (mon, prop) {
		const arr = mon[prop];
		if (!Array.isArray(arr) || !arr.length) return "";
		if (typeof Parser !== "undefined" && Parser.getFullImmRes) {
			try { return this._stripTags(Parser.getFullImmRes(arr, {isPlainText: true})); } catch (e) { /* fall through */ }
		}
		return arr.map(v => typeof v === "string" ? v : JSON.stringify(v)).join(", ");
	}

	static _getCondImmuneText (mon) {
		const arr = mon.conditionImmune;
		if (!Array.isArray(arr) || !arr.length) return "";
		if (typeof Parser !== "undefined" && Parser.getFullCondImm) {
			try { return this._stripTags(Parser.getFullCondImm(arr, {isPlainText: true})); } catch (e) { /* fall through */ }
		}
		return arr.map(v => typeof v === "string" ? v : JSON.stringify(v)).join(", ");
	}

	static _getSensesText (mon) {
		const parts = [];
		if (typeof Renderer !== "undefined" && Renderer.monster?.getSensesPart) {
			try {
				const senses = Renderer.monster.getSensesPart(mon, {isForcePassive: true});
				if (senses) parts.push(this._stripTags(senses));
			} catch (e) { /* fall through */ }
		} else {
			if (Array.isArray(mon.senses) && mon.senses.length) parts.push(mon.senses.join(", "));
			if (typeof mon.passive === "number") parts.push(`passive Perception ${mon.passive}`);
		}
		return parts.filter(Boolean).join("; ");
	}

	static _getLanguagesText (mon) {
		const arr = mon.languages;
		if (!Array.isArray(arr) || !arr.length) return "";
		if (typeof Renderer !== "undefined" && Renderer.monster?.getRenderedLanguages) {
			try { return this._stripTags(Renderer.monster.getRenderedLanguages(arr)); } catch (e) { /* fall through */ }
		}
		return arr.join(", ");
	}

	static _getCrText (mon) {
		if (mon.cr == null) return "";
		if (typeof mon.cr === "string" || typeof mon.cr === "number") return String(mon.cr);
		if (typeof mon.cr === "object") return String(mon.cr.cr ?? "");
		return "";
	}

	static _getCrNumeric (mon) {
		const raw = typeof mon.cr === "object" ? mon.cr?.cr : mon.cr;
		if (raw == null) return null;
		if (typeof raw === "number") return raw;
		const s = String(raw).trim();
		if (s.includes("/")) {
			const [a, b] = s.split("/").map(Number);
			return b ? a / b : null;
		}
		const n = Number(s);
		return Number.isFinite(n) ? n : null;
	}

	static _getPbText (mon) {
		if (mon.pbNote != null && typeof mon.pbNote === "string") return mon.pbNote;
		const n = this._getPbNumeric(mon);
		return n == null ? "" : (n >= 0 ? `+${n}` : String(n));
	}

	static _getPbNumeric (mon) {
		const cr = this._getCrNumeric(mon);
		if (cr == null) return null;
		if (cr < 5) return 2;
		if (cr < 9) return 3;
		if (cr < 13) return 4;
		if (cr < 17) return 5;
		if (cr < 21) return 6;
		if (cr < 25) return 7;
		if (cr < 29) return 8;
		return 9;
	}

	static _getSpellcastingText (mon) {
		if (!Array.isArray(mon.spellcasting) || !mon.spellcasting.length) return "";
		try {
			return mon.spellcasting.map(sc => {
				const parts = [];
				if (sc.name) parts.push(sc.name);
				if (Array.isArray(sc.headerEntries)) parts.push(sc.headerEntries.map(e => this._getEntryBodyText(e)).join(" "));
				if (sc.will) parts.push(`will:${(sc.will || []).map(v => typeof v === "string" ? v : JSON.stringify(v)).join(",")}`);
				if (sc.daily) parts.push(`daily:${JSON.stringify(sc.daily)}`);
				if (sc.spells) parts.push(`spells:${JSON.stringify(sc.spells)}`);
				return parts.join("|");
			}).join(";;");
		} catch (e) {
			return JSON.stringify(mon.spellcasting);
		}
	}

	// -------------------------------------------------------------
	// Entry helpers
	// -------------------------------------------------------------

	static _getEntryName (entry) {
		if (!entry) return "";
		if (typeof entry === "string") return "";
		return (entry.name || "").trim();
	}

	/**
	 * Flatten an entry's body to a plain-text string for comparison.
	 * Ignores the entry's name (we compare bodies, not headers).
	 */
	static _getEntryBodyText (entry) {
		if (entry == null) return "";
		if (typeof entry === "string") return this._stripTags(entry);
		if (Array.isArray(entry)) return entry.map(e => this._getEntryBodyText(e)).join(" ");
		const parts = [];
		if (Array.isArray(entry.entries)) parts.push(entry.entries.map(e => this._getEntryBodyText(e)).join(" "));
		if (Array.isArray(entry.items)) parts.push(entry.items.map(e => this._getEntryBodyText(e)).join(" "));
		if (typeof entry.entry === "string") parts.push(this._stripTags(entry.entry));
		return parts.join(" ");
	}

	// -------------------------------------------------------------
	// String helpers
	// -------------------------------------------------------------

	static _stripTags (str) {
		if (str == null) return "";
		let s = String(str);
		if (typeof Renderer !== "undefined" && typeof Renderer.stripTags === "function") {
			try { s = Renderer.stripTags(s); } catch (e) { /* fall through */ }
		} else {
			// Minimal fallback: strip {@tag ...} and HTML.
			s = s.replace(/\{@\w+\s+([^|}]+?)(?:\|[^}]*)?\}/g, "$1");
			s = s.replace(/<[^>]+>/g, "");
		}
		return s;
	}

	static _normalise (str) {
		if (str == null) return "";
		return this._stripTags(String(str))
			.replace(/\s+/g, " ")
			.trim()
			.toLowerCase();
	}
}

globalThis.CompareCreaturesDiff = CompareCreaturesDiff;

// -------------------------------------------------------------
// RenderCompareCreatures — DOM/Renderer-dependent
// -------------------------------------------------------------

class RenderCompareCreatures {
	static _MAX_COLS_NO_SCROLL = 4;

	/**
	 * @param {Array<object>} monsters
	 * @returns {HTMLElement}
	 */
	static getModalContent (monsters) {
		const rows = CompareCreaturesDiff.getRows(monsters);
		const isWide = monsters.length > this._MAX_COLS_NO_SCROLL;

		const wrp = ee`<div class="ve-cmp__wrp ${isWide ? "ve-cmp__wrp--scroll" : ""}"></div>`;

		// Header row — creature name + type/source badge.
		const headerCells = monsters.map(mon => {
			const nameHtml = this._escape(mon._displayName || mon.name || "?");
			const srcAbv = typeof Parser !== "undefined" && Parser.sourceJsonToAbv ? Parser.sourceJsonToAbv(mon.source) : (mon.source || "");
			const srcColor = typeof Parser !== "undefined" && Parser.sourceJsonToColor ? Parser.sourceJsonToColor(mon.source) : "";
			return `<div class="ve-cmp__hdr-cell">
				<div class="ve-cmp__hdr-name" title="${this._escape(mon.name || "")}">${nameHtml}</div>
				<div class="ve-cmp__hdr-sub" ${srcColor ? `style="color:${srcColor};"` : ""}>${this._escape(srcAbv)}</div>
			</div>`;
		}).join("");

		const grid = ee`<div class="ve-cmp__grid" style="grid-template-columns: minmax(140px, 180px) repeat(${monsters.length}, minmax(220px, 1fr));">
			<div class="ve-cmp__hdr-cell ve-cmp__hdr-cell--row-label"></div>
			${headerCells}
		</div>`;

		rows.forEach(row => this._appendRow(grid, row, monsters));
		wrp.appendChild(grid);
		return wrp;
	}

	static _appendRow (grid, row, monsters) {
		if (row.isSectionHeader) {
			const hdr = ee`<div class="ve-cmp__section-hdr" style="grid-column: 1 / -1;">
				<span class="ve-cmp__section-hdr-label">${this._escape(row.label)}</span>
				<span class="ve-cmp__section-hdr-count">${row.subRowsCount} shared/differing</span>
			</div>`;
			grid.appendChild(hdr);
			return;
		}

		const labelHtml = row.subLabel
			? `<span class="ve-cmp__row-label--sub">${this._escape(row.label)}</span>`
			: `<span class="ve-cmp__row-label--main">${this._escape(row.label)}</span>`;
		const labelCell = ee`<div class="ve-cmp__cell ve-cmp__cell--row-label">${labelHtml}</div>`;
		grid.appendChild(labelCell);

		// If a section sub-row is fully shared AND every cell present, collapse to a single spanning cell.
		const isEntrySection = row.sectionKey && row.sectionKey !== "ability";
		const canCollapseShared = isEntrySection && row.isAllPresent && row.isAllSame;

		if (canCollapseShared) {
			const spanCell = ee`<div class="ve-cmp__cell ve-cmp__cell--shared" style="grid-column: 2 / -1;">
				<span class="ve-cmp__shared-badge" title="Identical across all compared creatures">shared</span>
				<div class="ve-cmp__cell-body">${this._renderCellBody(row.cells[0], row)}</div>
			</div>`;
			grid.appendChild(spanCell);
			return;
		}

		row.cells.forEach((cell, ix) => {
			const mon = monsters[ix];
			const classes = ["ve-cmp__cell", `ve-cmp__cell--${cell.status || "diff"}`];
			if (row.ability && cell.abilityDelta != null) {
				if (cell.abilityDelta > 0.5) classes.push("ve-cmp__cell--ab-hi");
				else if (cell.abilityDelta < -0.5) classes.push("ve-cmp__cell--ab-lo");
				else classes.push("ve-cmp__cell--ab-mid");
			}
			const bodyHtml = cell.isPresent ? this._renderCellBody(cell, row) : `<span class="ve-cmp__cell-missing">—</span>`;
			const dataMon = `data-mon="${this._escape(mon?.name || "")}"`;
			const dataStatus = `data-status="${cell.status || ""}"`;
			const cellEl = ee`<div class="${classes.join(" ")}" ${dataMon} ${dataStatus}>${bodyHtml}</div>`;
			grid.appendChild(cellEl);
		});
	}

	static _renderCellBody (cell, row) {
		// Entry-list rows render the full entry body (with tags) via Renderer.
		if (row.sectionKey && row.sectionKey !== "ability" && cell.entry && typeof Renderer !== "undefined") {
			try {
				const renderer = Renderer.get();
				const stack = [];
				renderer.recursiveRender(cell.entry, stack, {depth: 2});
				return stack.join("");
			} catch (e) { /* fall through */ }
		}
		return this._escape(cell.textPlain);
	}

	static _escape (str) {
		if (str == null) return "";
		return String(str)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	}

	/**
	 * @param {Array<object>} monsters
	 * @returns {Promise<void>}
	 */
	static async pOpen (monsters) {
		if (!Array.isArray(monsters) || monsters.length < 2) {
			if (typeof JqueryUtil !== "undefined" && JqueryUtil.doToast) {
				JqueryUtil.doToast({content: "Pin at least two creatures to the sublist before comparing.", type: "warning"});
			}
			return;
		}

		const eleTitleSplit = this._getModalTitleSplit(monsters);

		const {eleModalInner, doClose} = UiUtil.getShowModal({
			title: `Compare ${monsters.length} creatures`,
			eleTitleSplit,
			isFullscreenModal: true,
			isHeaderBorder: true,
			overlayColor: "#0009",
		});

		const content = this.getModalContent(monsters);
		eleModalInner.appendChild(content);

		return {doClose};
	}

	static _getModalTitleSplit (monsters) {
		const btnCopyLink = ee`<button class="ve-btn ve-btn-default ve-btn-xs ve-mr-2" title="Copy shareable link">
			<span class="glyphicon glyphicon-link"></span> Copy link
		</button>`.onn("click", async () => {
				try {
					const hashes = monsters.map(mon => UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_BESTIARY](mon)).join(",");
					const url = `${location.origin}${location.pathname}#compare=${hashes}`;
					await MiscUtil.pCopyTextToClipboard(url);
					if (typeof JqueryUtil !== "undefined" && JqueryUtil.showCopiedEffect) JqueryUtil.showCopiedEffect(btnCopyLink);
				} catch (e) {
					// eslint-disable-next-line no-console
					console.error(e);
				}
			});
		return ee`<div class="ve-flex-v-center ve-ml-auto">${btnCopyLink}</div>`;
	}
}

globalThis.RenderCompareCreatures = RenderCompareCreatures;

export {CompareCreaturesDiff, RenderCompareCreatures};
