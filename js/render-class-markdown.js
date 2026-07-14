export class RenderClassesMarkdown {
	static _CHARS_PER_COLUMN = 2100;
	static _MIN_CHARS_TO_SPLIT_COLUMN = 600;
	static _TAG_BLOCKLIST_LINKS = new Set(["@5etools", "@link", "@loader"]);

	static async pGetMarkdown ({cls, subclasses = [], baseUrl = globalThis.location?.href}) {
		const [classFluff, subclassFluffs] = await Promise.all([
			Renderer.class.pGetFluff(cls),
			Promise.all(subclasses.map(sc => Renderer.subclass.pGetFluff(sc))),
		]);

		return this.getMarkdown({
			cls,
			subclasses,
			classFluff,
			subclassFluffs,
			baseUrl,
		});
	}

	static getMarkdown (
		{
			cls,
			subclasses = [],
			classFluff = null,
			subclassFluffs = [],
			baseUrl = globalThis.location?.href,
		},
	) {
		if (!cls) throw new Error("A class is required to generate Markdown.");

		const pages = [];
		const classImage = this._getImageMarkdown({
			ent: cls,
			fluff: classFluff,
			baseUrl,
			isFullPage: true,
		});
		const ptClassTitle = this._getClassTitle({cls});

		if (classImage) {
			pages.push([
				classImage,
				ptClassTitle,
			].join("\n\n"));
		}

		pages.push(...this._getFlowPages([
			!classImage ? ptClassTitle : null,
			this._getCoreTraits({cls}),
			this._getFluff({ent: cls, fluff: classFluff}),
		]));

		const classTable = this._getClassTable({cls, subclasses});
		if (classTable) pages.push(classTable);

		const contentBlocks = [
			`## ${cls.name} Class Features`,
			...this._getFeatureBlocks({features: cls.classFeatures}),
		];

		subclasses.forEach((sc, ix) => {
			const scFluff = subclassFluffs[ix];
			contentBlocks.push(
				this._getSubclassTitle({cls, sc}),
				this._getImageMarkdown({ent: sc, fluff: scFluff, baseUrl}),
				this._getFluff({ent: sc, fluff: scFluff}),
				...this._getSubclassTables({sc}),
				`## ${sc.name} Features`,
				...this._getFeatureBlocks({features: sc.subclassFeatures}),
			);
		});
		pages.push(...this._getFlowPages(contentBlocks));

		const ptsPages = pages
			.map(page => page.trim())
			.filter(Boolean)
			.map(page => `${page}\n\n{{pageNumber,auto}}`);

		return [
			this._getMetadata({cls, subclasses}),
			ptsPages.join("\n\n\\page\n\n"),
			"",
		].join("\n\n");
	}

	static _getMetadata ({cls, subclasses}) {
		const description = subclasses.length
			? `${cls.name} class with ${subclasses.map(sc => sc.name).join(", ")}`
			: `${cls.name} class`;

		return `\`\`\`metadata
title: ${JSON.stringify(cls.name)}
description: ${JSON.stringify(description)}
tags:
  - class
systems:
  - 5e
renderer: V3
\`\`\``;
	}

	static _getClassTitle ({cls}) {
		const edition = cls.edition === "one" ? "2024 Edition" : "2014 Edition";
		const source = Parser.sourceJsonToFull(cls.source);
		return `# ${cls.name}

{{banner,--color:"rgba(177, 154, 120, 0.8)"
## ${edition}${source ? ` — ${source}` : ""}
}}`;
	}

	static _getSubclassTitle ({cls, sc}) {
		const subclassTitle = cls.subclassTitle || `${cls.name} Subclass`;
		const source = Parser.sourceJsonToFull(sc.source);
		return `# ${sc.name}

{{banner,--color:"rgba(177, 154, 120, 0.8)"
## ${subclassTitle}${source ? ` — ${source}` : ""}
}}`;
	}

	static _getCoreTraits ({cls}) {
		const rows = [
			["Primary Ability", this._getPrimaryAbility({cls})],
			["Hit Point Die", cls.hd ? `${cls.hd.number === 1 ? "" : cls.hd.number}D${cls.hd.faces} per ${cls.name} level` : null],
			["Saving Throw Proficiencies", cls.proficiency?.map(it => Parser.attAbvToFull(it)).join(" and ")],
			["Skill Proficiencies", this._getSkillProficiencies({cls})],
			["Weapon Proficiencies", this._getWeaponProficiencies({cls})],
			[cls.edition === "classic" ? "Armor Proficiencies" : "Armor Training", this._getArmorProficiencies({cls})],
			["Tool Proficiencies", this._getToolProficiencies({cls})],
			["Starting Equipment", this._getStartingEquipment({cls})],
		]
			.filter(([, value]) => value);

		if (!rows.length) return null;

		return `{{classTraits
##### Core ${cls.name} Traits
| | |
|:---|:---|
${rows.map(([name, value]) => `| **${name}** | ${this._getTableCell(value)} |`).join("\n")}
}}`;
	}

	static _getPrimaryAbility ({cls}) {
		if (cls.primaryAbility?.length) {
			return cls.primaryAbility
				.map(abilityGroup => {
					return this._joinConjunct(
						Object.entries(abilityGroup)
							.filter(([, isActive]) => isActive)
							.map(([ability]) => Parser.attAbvToFull(ability)),
						"and",
					);
				})
				.filter(Boolean)
				.join(" or ");
		}

		const requirements = cls.multiclassing?.requirements;
		if (!requirements) return null;

		const pts = Object.entries(requirements)
			.filter(([ability]) => Parser.ABIL_ABVS.includes(ability))
			.map(([ability]) => Parser.attAbvToFull(ability));
		const ptsOr = requirements.or
			?.map(group => this._joinConjunct(
				Object.keys(group)
					.filter(ability => Parser.ABIL_ABVS.includes(ability))
					.map(ability => Parser.attAbvToFull(ability)),
				"or",
			))
			.filter(Boolean);

		return [
			this._joinConjunct(pts, "and"),
			...(ptsOr || []),
		]
			.filter(Boolean)
			.join(" or ");
	}

	static _getSkillProficiencies ({cls}) {
		if (!cls.startingProficiencies?.skills) return null;
		return this._renderInline(Parser.skillProficienciesToFull(cls.startingProficiencies.skills, {styleHint: cls.edition}));
	}

	static _getWeaponProficiencies ({cls}) {
		const proficiencies = cls.startingProficiencies?.weapons;
		if (!proficiencies?.length) return null;

		const pts = proficiencies.map(it => {
			if (typeof it !== "string") return this._renderInline(it.proficiency || it.full || it);
			if (["simple", "martial"].includes(it)) return `${it.toTitleCase()} weapons`;
			return this._renderInline(it);
		});
		return this._joinConjunct(pts, "and");
	}

	static _getArmorProficiencies ({cls}) {
		const proficiencies = cls.startingProficiencies?.armor;
		if (!proficiencies?.length) return null;

		const ptsArmor = proficiencies
			.filter(it => typeof it === "string" && ["light", "medium", "heavy"].includes(it))
			.map(it => it.toTitleCase());
		const ptsOther = proficiencies
			.filter(it => !(typeof it === "string" && ["light", "medium", "heavy"].includes(it)))
			.map(it => {
				if (it === "shield") return "Shields";
				return this._renderInline(it.full || it);
			});

		return [
			ptsArmor.length ? `${this._joinConjunct(ptsArmor, "and")} armor` : null,
			...ptsOther,
		]
			.filter(Boolean)
			.join(" and ");
	}

	static _getToolProficiencies ({cls}) {
		const proficiencies = cls.startingProficiencies?.tools;
		if (!proficiencies?.length) return null;
		return this._joinConjunct(proficiencies.map(it => this._renderInline(it)), "and");
	}

	static _getStartingEquipment ({cls}) {
		const equipment = cls.startingEquipment;
		if (!equipment) return null;

		const pts = equipment.entries?.length
			? equipment.entries.map(it => this._renderInline(it))
			: equipment.default?.map(it => this._renderInline(it)) || [];

		if (equipment.goldAlternative) {
			pts.push(`Alternatively, ${this._renderInline(equipment.goldAlternative)} GP`);
		}

		return pts.join("; ");
	}

	static _getClassTable ({cls, subclasses}) {
		const groups = cls.classTableGroups || [];
		const rowCount = Math.max(
			cls.classFeatures?.length || 0,
			...groups.flatMap(group => [group.rows?.length || 0, group.rowsSpellProgression?.length || 0]),
		);
		if (!rowCount) return null;

		const labels = [
			"Level",
			"Proficiency<br>Bonus",
			"Class Features",
			...groups.flatMap(group => group.colLabels || []),
		];
		const rows = [...new Array(rowCount)]
			.map((_, ixLevel) => {
				const level = ixLevel + 1;
				const features = (cls.classFeatures?.[ixLevel] || [])
					.filter(feature => feature.name && feature.type !== "inset")
					.map(feature => feature._displayNameTable || feature._displayName || feature.name);
				const isGainSubclassLevel = (cls.classFeatures?.[ixLevel] || []).some(feature => feature.gainSubclassFeature);
				const isSubclassFeatureLevel = subclasses.some(sc => {
					return (sc.subclassFeatures || [])
						.some(levelFeatures => levelFeatures.some(feature => feature.level === level));
				});
				const isSubclassFeatureListed = features
					.some(name => name === cls.subclassTitle || name.toLowerCase().includes("subclass feature"));
				if (isSubclassFeatureLevel && !isGainSubclassLevel && !isSubclassFeatureListed) features.push("Subclass Feature");

				return [
					level,
					`+${Math.ceil(level / 4) + 1}`,
					features.length ? features.join(", ") : "—",
					...groups.flatMap(group => {
						const row = (group.rows || group.rowsSpellProgression || [])[ixLevel] || [];
						return (group.colLabels || []).map((_, ixCell) => this._renderTableValue(row[ixCell]));
					}),
				];
			});

		return this._getWideTable({
			caption: `${cls.name} Features`,
			labels,
			rows,
			leftAlignedColumns: new Set([2]),
		});
	}

	static _getSubclassTables ({sc}) {
		return (sc.subclassTableGroups || [])
			.map(group => {
				const rowsRaw = group.rows || group.rowsSpellProgression || [];
				const rows = rowsRaw.map((row, ix) => [
					ix + 1,
					...(group.colLabels || []).map((_, ixCell) => this._renderTableValue(row?.[ixCell])),
				]);

				return this._getWideTable({
					caption: group.title || `${sc.name} Progression`,
					labels: ["Level", ...(group.colLabels || [])],
					rows,
				});
			});
	}

	static _getWideTable ({caption, labels, rows, leftAlignedColumns = new Set()}) {
		if (!labels.length || !rows.length) return null;
		const alignments = labels.map((_, ix) => leftAlignedColumns.has(ix) ? ":---" : ":---:");

		return `{{classTable,wide
##### ${caption}
| ${labels.map(it => this._getTableCell(this._renderInline(it))).join(" | ")} |
|${alignments.join("|")}|
${rows.map(row => `| ${row.map(it => this._getTableCell(it)).join(" | ")} |`).join("\n")}
}}`;
	}

	static _getFeatureBlocks ({features}) {
		return (features || [])
			.flat()
			.filter(Boolean)
			.map(feature => {
				const name = feature._displayName || feature.name;
				const heading = name
					? `#### ${feature.level ? `Level ${feature.level}: ` : ""}${Renderer.stripTags(name)}`
					: null;
				const body = feature.entries?.length
					? this._renderEntries(feature.entries)
					: this._renderEntries([{...feature, name: null, _displayName: null}]);

				return [heading, body]
					.filter(Boolean)
					.join("\n\n");
			});
	}

	static _getFluff ({ent, fluff}) {
		if (!fluff?.entries?.length) return null;

		const entries = MiscUtil.copyFast(fluff.entries);
		const first = entries[0];
		if (
			first
			&& typeof first === "object"
			&& first.name
			&& [ent.name, `The ${ent.name}`].some(name => name.toLowerCase() === first.name.toLowerCase())
		) {
			delete first.name;
		}

		return this._renderEntries(entries);
	}

	static _getImageMarkdown ({ent, fluff, baseUrl, isFullPage = false}) {
		const image = fluff?.images?.[0];
		if (!image?.href) return null;

		const rawUrl = Renderer.utils.getEntryMediaUrl(image, "href", "img", {isUrlEncode: true});
		if (!rawUrl) return null;

		let url;
		try {
			url = new URL(rawUrl, baseUrl).href;
		} catch {
			throw new Error(`Could not create an absolute artwork URL for "${ent.name}".`);
		}

		const imageMarkdown = `![${Renderer.stripTags(ent.name)}](${url}) {width:100%;}`;
		if (!isFullPage) return imageMarkdown;
		return `{{fullPage
${imageMarkdown}
}}`;
	}

	static _getFlowPages (blocks) {
		const pendingBlocks = blocks
			.filter(Boolean)
			.map(block => block.trim())
			.filter(Boolean)
			.flatMap(block => this._getSplitFlowBlocks(block));
		if (!pendingBlocks.length) return [];

		const pages = [];
		let columns = [[]];
		let charsInColumn = 0;

		const getCurrentColumn = () => columns[columns.length - 1];
		const doAdvance = () => {
			if (columns.length === 1) {
				columns.push([]);
				charsInColumn = 0;
				return;
			}

			pages.push(columns.map(column => column.join("\n\n")).join("\n\n\\column\n\n"));
			columns = [[]];
			charsInColumn = 0;
		};

		while (pendingBlocks.length) {
			const block = pendingBlocks.shift();
			if (!getCurrentColumn().length || charsInColumn + block.length <= this._CHARS_PER_COLUMN) {
				getCurrentColumn().push(block);
				charsInColumn += block.length;
				continue;
			}

			const remaining = this._CHARS_PER_COLUMN - charsInColumn;
			const split = remaining >= this._MIN_CHARS_TO_SPLIT_COLUMN
				? this._getSplitFlowBlockAtLength(block, remaining)
				: null;
			if (split) {
				getCurrentColumn().push(split[0]);
				charsInColumn += split[0].length;
				doAdvance();
				pendingBlocks.unshift(split[1]);
				continue;
			}

			doAdvance();
			getCurrentColumn().push(block);
			charsInColumn += block.length;
		}

		if (columns.some(column => column.length)) {
			pages.push(columns.map(column => column.join("\n\n")).join("\n\n\\column\n\n"));
		}

		return pages;
	}

	static _getSplitFlowBlockAtLength (block, maxLength) {
		if (block.length <= maxLength || /^\{\{[^]*\}\}$/.test(block)) return null;

		const paragraphs = block.split(/\n{2,}/);
		const heading = paragraphs[0].match(/^(#{2,6} .+)$/)?.[1];
		const stack = [];
		let stackLength = 0;
		let ixParagraph = 0;

		for (; ixParagraph < paragraphs.length; ++ixParagraph) {
			const paragraph = paragraphs[ixParagraph];
			const lengthWithSpacing = paragraph.length + (stack.length ? 2 : 0);
			if (stack.length && stackLength + lengthWithSpacing > maxLength) break;
			stack.push(paragraph);
			stackLength += lengthWithSpacing;
		}

		const isOnlyHeading = heading && stack.length === 1;
		if (!stack.length || isOnlyHeading || ixParagraph === paragraphs.length) return null;

		const remainder = paragraphs.slice(ixParagraph);
		if (heading) remainder.unshift(`${heading} *(continued)*`);
		return [
			stack.join("\n\n"),
			remainder.join("\n\n"),
		];
	}

	static _getSplitFlowBlocks (block) {
		if (block.length <= this._CHARS_PER_COLUMN) return [block];
		if (/^\{\{[^]*\}\}$/.test(block)) return [block];

		const paragraphs = block.split(/\n{2,}/);
		const heading = paragraphs[0].match(/^(#{2,6} .+)$/)?.[1];
		const continuationHeading = heading ? `${heading} *(continued)*` : null;
		const out = [];
		let stack = [];
		let stackLength = 0;

		const doFlush = () => {
			if (!stack.length) return;
			out.push(stack.join("\n\n"));
			stack = continuationHeading ? [continuationHeading] : [];
			stackLength = continuationHeading?.length || 0;
		};

		paragraphs
			.flatMap(paragraph => this._getSplitFlowParagraph(paragraph))
			.forEach(paragraph => {
				const lengthWithSpacing = paragraph.length + (stack.length ? 2 : 0);
				const isStackOnlyHeading = stack.length === 1 && /^#{2,6} /.test(stack[0]);
				if (stack.length && !isStackOnlyHeading && stackLength + lengthWithSpacing > this._CHARS_PER_COLUMN) doFlush();
				stack.push(paragraph);
				stackLength += paragraph.length + (stack.length > 1 ? 2 : 0);
			});
		doFlush();

		return out;
	}

	static _getSplitFlowParagraph (paragraph) {
		if (paragraph.length <= this._CHARS_PER_COLUMN) return [paragraph];
		if (/^(?:\{\{|\|)/.test(paragraph)) return [paragraph];

		const lines = paragraph.split("\n");
		if (lines.length > 1) return this._getSplitFlowParts(lines, "\n");

		const sentences = paragraph.split(/(?<=[.!?])\s+/);
		if (sentences.length > 1) return this._getSplitFlowParts(sentences, " ");

		return this._getSplitFlowParts(paragraph.split(/\s+/), " ");
	}

	static _getSplitFlowParts (parts, separator) {
		parts = parts
			.flatMap(part => {
				if (part.length <= this._CHARS_PER_COLUMN) return [part];

				const words = part.split(/\s+/);
				if (words.length > 1) return this._getSplitFlowParts(words, " ");

				const out = [];
				for (let i = 0; i < part.length; i += this._CHARS_PER_COLUMN) {
					out.push(part.slice(i, i + this._CHARS_PER_COLUMN));
				}
				return out;
			});

		const out = [];
		let stack = "";

		parts.forEach(part => {
			if (!part) return;
			if (!stack) {
				stack = part;
				return;
			}
			if (stack.length + separator.length + part.length <= this._CHARS_PER_COLUMN) {
				stack += `${separator}${part}`;
				return;
			}
			out.push(stack);
			stack = part;
		});
		if (stack) out.push(stack);

		return out;
	}

	static _renderEntries (entries) {
		return this._getPortableMarkdown(RendererMarkdown.get()
			.setFirstSection(true)
			.render({type: "entries", entries: this._getEntriesPortable(entries)})
			.trim());
	}

	static _getEntriesPortable (entry) {
		if (Array.isArray(entry)) return entry.map(it => this._getEntriesPortable(it));
		if (typeof entry === "string") return Renderer.stripTags(entry, {blocklistTags: this._TAG_BLOCKLIST_LINKS});
		if (entry == null || typeof entry !== "object") return entry;
		if (entry.type === "statblock") return this._getStatblockReference(entry);
		if (entry.type === "table") return this._getFeatureTableMarkdown(entry);

		return Object.fromEntries(
			Object.entries(entry)
				.map(([key, value]) => [key, this._getEntriesPortable(value)]),
		);
	}

	static _getFeatureTableMarkdown (entry) {
		const rows = (entry.rows || [])
			.map(row => row?.type === "row" ? row.row : row)
			.filter(Boolean);
		const headerRows = Renderer.table.getHeaderRowMetas(entry);
		const labels = headerRows?.at(-1)
			?.flatMap(cell => {
				const entryCell = cell?.type === "cellHeader" ? cell.entry : cell;
				return [
					this._renderInline(entryCell),
					...[...new Array((cell?.type === "cellHeader" ? cell.width || 1 : 1) - 1)].map(() => ""),
				];
			})
			|| [...new Array(Math.max(1, ...rows.map(row => row.length)))].map(() => "");
		const colCount = Math.max(labels.length, ...rows.map(row => row.length));
		while (labels.length < colCount) labels.push("");

		const alignments = [...new Array(colCount)]
			.map((_, ix) => {
				const style = entry.colStyles?.[ix] || "";
				if (style.includes("text-right")) return "---:";
				if (style.includes("text-center") || ix === 0) return ":---:";
				return ":---";
			});
		const tableRows = rows
			.map(row => {
				const cells = [...new Array(colCount)]
					.map((_, ix) => this._getTableCell(this._renderInline(this._getFeatureTableCellEntry(row[ix]))));
				return `| ${cells.join(" | ")} |`;
			});

		const pts = [
			entry.intro?.length ? this._renderEntries(entry.intro) : null,
			`{{wide
${entry.caption ? `##### ${Renderer.stripTags(entry.caption)}\n` : ""}| ${labels.map(label => this._getTableCell(label)).join(" | ")} |
|${alignments.join("|")}|
${tableRows.join("\n")}
}}`,
			entry.footnotes?.length ? this._renderEntries(entry.footnotes) : null,
			entry.outro?.length ? this._renderEntries(entry.outro) : null,
		];
		return pts.filter(Boolean).join("\n\n");
	}

	static _getFeatureTableCellEntry (cell) {
		if (cell?.type !== "cell") return cell ?? "";
		if (cell.roll?.entry != null) return cell.roll.entry;
		if (cell.roll?.exact != null) return cell.roll.pad ? StrUtil.padNumber(cell.roll.exact, 2, "0") : cell.roll.exact;
		if (cell.roll?.min != null && cell.roll?.max != null) {
			return cell.roll.pad
				? `${StrUtil.padNumber(cell.roll.min, 2, "0")}-${StrUtil.padNumber(cell.roll.max, 2, "0")}`
				: `${cell.roll.min}-${cell.roll.max}`;
		}
		return cell.entry ?? "";
	}

	static _getStatblockReference (entry) {
		const name = entry.displayName || entry.name || entry.abbreviation || "Embedded statblock";
		const source = entry.source ? ` (${Parser.sourceJsonToAbv(entry.source)})` : "";
		return `**${name}.** See the ${entry.tag || entry.prop || "referenced"} entry${source}.`;
	}

	static _renderInline (entry) {
		if (entry == null) return "";
		return this._getPortableMarkdown(RendererMarkdown.get()
			.render({type: "inline", entries: [this._getEntriesPortable(entry)]})
			.replace(/\n+/g, " ")
			.trim());
	}

	static _getPortableMarkdown (markdown) {
		return markdown
			.replace(/<(?:b|strong)>(.*?)<\/(?:b|strong)>/gi, "**$1**")
			.replace(/<(?:i|em)>(.*?)<\/(?:i|em)>/gi, "*$1*")
			.replace(/<\/?(?:a|span)\b[^>]*>/gi, "");
	}

	static _renderTableValue (value) {
		if (value == null || value === 0 || value === "") return "—";
		return this._renderInline(value);
	}

	static _getTableCell (value) {
		return `${value ?? "—"}`
			.replace(/\|/g, "\\|")
			.replace(/\n+/g, "<br>")
			.trim();
	}

	static _joinConjunct (values, conjunction) {
		const cleanValues = values.filter(Boolean);
		if (cleanValues.length < 2) return cleanValues[0] || "";
		if (cleanValues.length === 2) return `${cleanValues[0]} ${conjunction} ${cleanValues[1]}`;
		return `${cleanValues.slice(0, -1).join(", ")}, ${conjunction} ${cleanValues.at(-1)}`;
	}
}
