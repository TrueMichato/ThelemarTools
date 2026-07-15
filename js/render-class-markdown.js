export class RenderClassesMarkdown {
	static _FLOW_LINES_PER_COLUMN = 50;
	static _MIN_FLOW_LINES_TO_SPLIT_COLUMN = 6;
	static _MAX_KEEP_TOGETHER_FLOW_LINES = 16;
	static _TAG_BLOCKLIST_LINKS = new Set(["@5etools", "@link", "@loader"]);

	static async pGetMarkdown ({cls, subclasses = [], isIncludeFeatureSources = true, baseUrl = globalThis.location?.href}) {
		const [classFluff, subclassFluffs] = await Promise.all([
			Renderer.class.pGetFluff(cls),
			Promise.all(subclasses.map(sc => Renderer.subclass.pGetFluff(sc))),
		]);

		return this.getMarkdown({
			cls,
			subclasses,
			classFluff,
			subclassFluffs,
			isIncludeFeatureSources,
			baseUrl,
		});
	}

	static getMarkdown (
		{
			cls,
			subclasses = [],
			classFluff = null,
			subclassFluffs = [],
			isIncludeFeatureSources = true,
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

		const isIncludeDocumentFeatureSources = isIncludeFeatureSources && this._hasMixedFeatureSources({
			ownerSources: [
				cls.source,
				...subclasses.map(sc => sc.source),
			],
			features: [
				cls.classFeatures,
				...subclasses.map(sc => sc.subclassFeatures),
			],
		});
		const contentBlocks = [
			`## ${cls.name} Class Features`,
			...this._getFeatureBlocks({
				features: cls.classFeatures,
				isIncludeFeatureSources: isIncludeDocumentFeatureSources,
			}),
		];

		subclasses.forEach((sc, ix) => {
			const scFluff = subclassFluffs[ix];
			contentBlocks.push(
				this._getSubclassTitle({cls, sc}),
				this._getImageMarkdown({ent: sc, fluff: scFluff, baseUrl}),
				this._getFluff({ent: sc, fluff: scFluff}),
				...this._getSubclassTables({sc}),
				...this._getFeatureBlocks({
					features: sc.subclassFeatures,
					isIncludeFeatureSources: isIncludeDocumentFeatureSources,
				}),
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

	static getDownloadFilename ({cls, subclasses = []}) {
		if (!cls) throw new Error("A class is required to generate a download filename.");

		const subclassSuffix = !subclasses.length
			? "Class-Only"
			: subclasses.length <= 3
				? subclasses.map(sc => sc.shortName || sc.name).join("-")
				: `${subclasses.length}-Subclasses`;

		return `${DataUtil.getCleanFilename(`${cls.name}-${cls.source}-${subclassSuffix}`)}.md`;
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

	static _getFeatureBlocks ({features, isIncludeFeatureSources = false}) {
		return (features || [])
			.flat()
			.filter(Boolean)
			.map(feature => {
				const name = feature._displayName || feature.name;
				const heading = name
					? `#### ${feature.level ? `Level ${feature.level}: ` : ""}${Renderer.stripTags(name)}`
					: null;
				const source = isIncludeFeatureSources && feature.source
					? this._getFeatureSourceMarkdown(feature)
					: null;
				const body = feature.entries?.length
					? this._renderEntries(feature.entries, {isIncludeFeatureSources})
					: this._renderEntries([{...feature, name: null, _displayName: null}], {isIncludeFeatureSources});

				return [heading, source, body]
					.filter(Boolean)
					.join("\n\n");
			});
	}

	static _hasMixedFeatureSources ({ownerSources = [], features}) {
		const sources = new Set(ownerSources.filter(Boolean));

		const addSources = entry => {
			if (Array.isArray(entry)) return entry.forEach(addSources);
			if (!entry || typeof entry !== "object") return;
			if (entry.source) sources.add(entry.source);
			if (entry.entries) addSources(entry.entries);
			if (entry.items) addSources(entry.items);
		};
		addSources(features);

		return sources.size > 1;
	}

	static _getFeatureSourceMarkdown ({source, page}) {
		const sourceFull = Parser.sourceJsonToFull(source);
		if (!sourceFull) return null;
		return `*Source: ${sourceFull}${page != null ? `, p. ${page}` : ""}*`;
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
			.flatMap(block => this._getFlowSegments(block))
			.flatMap(block => this._getSplitFlowBlocks(block));
		if (!pendingBlocks.length) return [];

		const pages = [];
		let columns = [[]];
		let linesInColumn = 0;

		const getCurrentColumn = () => columns[columns.length - 1];
		const doFlushPage = () => {
			if (columns.some(column => column.length)) {
				pages.push(columns.map(column => column.join("\n\n")).join("\n\n\\column\n\n"));
			}
			columns = [[]];
			linesInColumn = 0;
		};
		const doAdvance = () => {
			if (columns.length === 1) {
				columns.push([]);
				linesInColumn = 0;
				return;
			}

			doFlushPage();
		};

		while (pendingBlocks.length) {
			const block = pendingBlocks.shift();
			if (this._isPageStartBlock(block)) doFlushPage();
			if (this._isWideFlowBlock(block)) {
				doFlushPage();
				pages.push(block);
				continue;
			}

			const blockLines = this._getFlowLines(block);
			const spacingLines = getCurrentColumn().length ? 0.25 : 0;
			if (!getCurrentColumn().length || linesInColumn + spacingLines + blockLines <= this._FLOW_LINES_PER_COLUMN) {
				getCurrentColumn().push(block);
				linesInColumn += spacingLines + blockLines;
				continue;
			}

			const remaining = this._FLOW_LINES_PER_COLUMN - linesInColumn - spacingLines;
			const split = remaining >= this._MIN_FLOW_LINES_TO_SPLIT_COLUMN
				? this._getSplitFlowBlockAtSize(block, remaining)
				: null;
			if (split) {
				getCurrentColumn().push(split[0]);
				linesInColumn += spacingLines + this._getFlowLines(split[0]);
				doAdvance();
				pendingBlocks.unshift(split[1]);
				continue;
			}

			doAdvance();
			getCurrentColumn().push(block);
			linesInColumn += blockLines;
		}

		doFlushPage();

		return pages;
	}

	static _getFlowSegments (block) {
		const paragraphs = block.split(/\n{2,}/);
		if (!paragraphs.some(paragraph => this._isWideFlowBlock(paragraph))) return [block];

		const out = [];
		let stack = [];

		const doFlush = () => {
			if (!stack.length) return;
			out.push(stack.join("\n\n"));
			stack = [];
		};

		paragraphs.forEach(paragraph => {
			if (this._isWideFlowBlock(paragraph)) {
				doFlush();
				out.push(paragraph);
				return;
			}

			stack.push(paragraph);
		});
		doFlush();

		return out;
	}

	static _isPageStartBlock (block) {
		return /^# [^#]/.test(block);
	}

	static _isWideFlowBlock (block) {
		return /^\{\{[^\n}]*\bwide\b/.test(block);
	}

	static _getSplitFlowBlockAtSize (block, maxLines) {
		if (this._getFlowLines(block) <= maxLines || /^\{\{[^]*\}\}$/.test(block)) return null;

		const sections = this._getFlowSections(block);
		const stack = [];
		let stackLines = 0;
		let ixSection = 0;

		for (; ixSection < sections.length; ++ixSection) {
			const section = sections[ixSection];
			const linesWithSpacing = this._getFlowLines(section) + (stack.length ? 0.25 : 0);
			if (stack.length && stackLines + linesWithSpacing > maxLines) break;
			if (!stack.length && linesWithSpacing > maxLines) break;
			stack.push(section);
			stackLines += linesWithSpacing;
		}

		if (!stack.length) {
			const section = sections[0];
			if (this._getFlowLines(section) <= this._MAX_KEEP_TOGETHER_FLOW_LINES) return null;

			const split = this._getSplitFlowSectionAtSize(section, maxLines);
			if (!split) return null;
			return [
				split[0],
				[split[1], ...sections.slice(1)].join("\n\n"),
			];
		}
		if (ixSection === sections.length) return null;

		return [
			stack.join("\n\n"),
			sections.slice(ixSection).join("\n\n"),
		];
	}

	static _getSplitFlowBlocks (block) {
		if (this._getFlowLines(block) <= this._FLOW_LINES_PER_COLUMN) return [block];
		if (/^\{\{[^]*\}\}$/.test(block)) return [block];

		const sections = this._getFlowSections(block)
			.flatMap(section => this._getSplitFlowSection(section));
		const out = [];
		let stack = [];
		let stackLines = 0;

		const doFlush = () => {
			if (!stack.length) return;
			out.push(stack.join("\n\n"));
			stack = [];
			stackLines = 0;
		};

		sections
			.forEach(section => {
				const linesWithSpacing = this._getFlowLines(section) + (stack.length ? 0.25 : 0);
				if (stack.length && stackLines + linesWithSpacing > this._FLOW_LINES_PER_COLUMN) {
					doFlush();
				}
				stack.push(section);
				stackLines += this._getFlowLines(section) + (stack.length > 1 ? 0.25 : 0);
			});
		doFlush();

		return out;
	}

	static _getFlowSections (block) {
		const paragraphs = block.split(/\n{2,}/);
		const out = [];
		let stack = [];

		paragraphs.forEach(paragraph => {
			if (this._isFlowHeading(paragraph) && stack.length) {
				out.push(stack.join("\n\n"));
				stack = [];
			}
			stack.push(paragraph);
		});
		if (stack.length) out.push(stack.join("\n\n"));

		return out;
	}

	static _getSplitFlowSection (section) {
		if (this._getFlowLines(section) <= this._FLOW_LINES_PER_COLUMN) return [section];

		const out = [];
		let remaining = section;
		while (this._getFlowLines(remaining) > this._FLOW_LINES_PER_COLUMN) {
			const split = this._getSplitFlowSectionAtSize(remaining, this._FLOW_LINES_PER_COLUMN);
			if (!split) return [...out, remaining];
			out.push(split[0]);
			remaining = split[1];
		}
		if (remaining) out.push(remaining);
		return out;
	}

	static _getSplitFlowSectionAtSize (section, maxLines) {
		const paragraphs = section
			.split(/\n{2,}/)
			.flatMap(paragraph => this._getSplitFlowParagraph(paragraph));
		const stack = [];
		let stackLines = 0;
		let ixParagraph = 0;

		for (; ixParagraph < paragraphs.length; ++ixParagraph) {
			const paragraph = paragraphs[ixParagraph];
			const linesWithSpacing = this._getFlowLines(paragraph) + (stack.length ? 0.25 : 0);
			if (stack.length && stackLines + linesWithSpacing > maxLines) break;
			stack.push(paragraph);
			stackLines += linesWithSpacing;
		}

		if (stack.length === 1 && this._isFlowHeading(stack[0])) return null;
		if (!stack.length || ixParagraph === paragraphs.length) return null;
		return [
			stack.join("\n\n"),
			paragraphs.slice(ixParagraph).join("\n\n"),
		];
	}

	static _isFlowHeading (paragraph) {
		return /^#{2,6}\s/.test(paragraph);
	}

	static _getSplitFlowParagraph (paragraph) {
		if (this._getFlowLines(paragraph) <= this._FLOW_LINES_PER_COLUMN) return [paragraph];
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
				if (this._getFlowLines(part) <= this._FLOW_LINES_PER_COLUMN) return [part];

				const words = part.split(/\s+/);
				if (words.length > 1) return this._getSplitFlowParts(words, " ");

				const out = [];
				for (let i = 0; i < part.length; i += this._FLOW_LINES_PER_COLUMN * 55) {
					out.push(part.slice(i, i + (this._FLOW_LINES_PER_COLUMN * 55)));
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
			if (this._getFlowLines(`${stack}${separator}${part}`) <= this._FLOW_LINES_PER_COLUMN) {
				stack += `${separator}${part}`;
				return;
			}
			out.push(stack);
			stack = part;
		});
		if (stack) out.push(stack);

		return out;
	}

	static _getFlowLines (block) {
		return block
			.split("\n")
			.reduce((total, line) => {
				const cleanLine = line
					.replace(/^(?:#{1,6}|[-*+]|\d+\.)\s+/, "")
					.replace(/[*_`]/g, "")
					.trim();
				if (!cleanLine) return total + 0.25;

				if (/^#{1,2}\s/.test(line)) return total + 3 + Math.max(0, Math.ceil(cleanLine.length / 45) - 1);
				if (/^#{3,6}\s/.test(line)) return total + 2 + Math.max(0, Math.ceil(cleanLine.length / 48) - 1);
				if (/^(?:[-*+]|\d+\.)\s+/.test(line)) return total + Math.max(1, Math.ceil(cleanLine.length / 48));
				return total + Math.max(1, Math.ceil(cleanLine.length / 55));
			}, 0);
	}

	static _renderEntries (entries, {isIncludeFeatureSources = false} = {}) {
		if (isIncludeFeatureSources) entries = this._getEntriesWithFeatureSources(entries);
		return this._getPortableMarkdown(RendererMarkdown.get()
			.setFirstSection(true)
			.render({type: "entries", entries: this._getEntriesPortable(entries)})
			.trim());
	}

	static _getEntriesWithFeatureSources (entry) {
		if (Array.isArray(entry)) return entry.map(it => this._getEntriesWithFeatureSources(it));
		if (entry == null || typeof entry !== "object") return entry;

		const out = Object.fromEntries(
			Object.entries(entry)
				.map(([key, value]) => [key, this._getEntriesWithFeatureSources(value)]),
		);
		if (
			entry.name
			&& entry.source
			&& Array.isArray(out.entries)
			&& ["entries", "section", "optfeature"].includes(entry.type)
		) {
			const source = this._getFeatureSourceMarkdown(entry);
			if (source) out.entries.unshift(source);
		}
		return out;
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

		const tableWrapper = colCount > 2 ? "{{wide" : "{{";
		const pts = [
			entry.intro?.length ? this._renderEntries(entry.intro) : null,
			`${tableWrapper}
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
