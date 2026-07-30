/**
 * Harvest Lookup — pick a creature, see everything harvestable from it.
 *
 * The six source books each carry their own harvest table for the same creature, so this merges
 * them into one list. Answering "what do I get off this corpse?" is the single most common
 * question at the table, and it is the one thing the raw books make hardest.
 */
export class CraftingHarvestLookup {
	constructor ({entities}) {
		this._materialsByCreature = this.constructor._indexByCreature(entities);
	}

	static _indexByCreature (entities) {
		/** @type {Map<string, {name: string, source: ?string, creatureType: ?string, cr: ?number, materials: object[]}>} */
		const out = new Map();

		for (const ent of entities) {
			if (ent.__prop !== "craftingMaterial") continue;
			const creature = ent.harvest?.creature;
			if (!creature?.name) continue;

			const key = creature.name.toLowerCase();
			if (!out.has(key)) {
				out.set(key, {
					name: creature.name,
					source: creature.source,
					creatureType: ent.harvest.creatureType ?? null,
					cr: ent.harvest.cr ?? null,
					materials: [],
				});
			}

			const bucket = out.get(key);
			bucket.creatureType ??= ent.harvest.creatureType ?? null;
			bucket.cr ??= ent.harvest.cr ?? null;
			bucket.materials.push(ent);
		}

		for (const bucket of out.values()) {
			bucket.materials.sort((a, b) => (a.harvest.dc ?? 99) - (b.harvest.dc ?? 99) || SortUtil.ascSortLower(a.name, b.name));
		}

		return out;
	}

	get creatureCount () { return this._materialsByCreature.size; }

	async pShow () {
		const {eleModalInner} = UiUtil.getShowModal({
			title: "Harvest Lookup",
			isHeight100: true,
			isWidth100: true,
			isUncappedHeight: true,
			isMinHeight0: true,
		});

		const iptSearch = ee`<input class="ve-form-control" placeholder="Search creatures\u2026" autocomplete="off" spellcheck="false">`;
		const wrpResults = ee`<div class="ve-overflow-y-auto ve-h-100 ve-min-h-0 crafting-tool__results"></div>`;

		const sorted = [...this._materialsByCreature.values()].sort((a, b) => SortUtil.ascSortLower(a.name, b.name));

		const render = () => {
			const term = iptSearch.value.trim().toLowerCase();
			const matches = term
				? sorted.filter(it => it.name.toLowerCase().includes(term))
				: sorted;

			wrpResults.empty();

			if (!matches.length) {
				ee(wrpResults)`<div class="ve-muted ve-p-2">No creature matches "${term}".</div>`;
				return;
			}

			// Rendering ~800 creature panels at once is wasteful, so cap it and nudge toward searching
			const toRender = matches.slice(0, 40);
			toRender.forEach(meta => ee(wrpResults)`${this._getCreatureBlock(meta)}`);

			if (matches.length > toRender.length) {
				ee(wrpResults)`<div class="ve-muted ve-p-2">Showing ${toRender.length} of ${matches.length} creatures \u2014 refine your search to see the rest.</div>`;
			}
		};

		iptSearch.addEventListener("input", () => render());

		ee(eleModalInner)`
			<div class="ve-mb-2">${iptSearch}</div>
			${wrpResults}
		`;

		render();
		iptSearch.focus();
	}

	_getCreatureBlock (meta) {
		const renderer = Renderer.get();

		const subtitle = [
			meta.creatureType ? meta.creatureType.toTitleCase() : null,
			meta.cr != null ? `CR ${Parser.numberToCr(meta.cr)}` : null,
		].filter(Boolean).join(", ");

		const rows = meta.materials.map(mat => {
			const usedIn = (mat.usedInRecipes || []).map(ref => ref.name).join(", ");
			const value = mat.value != null ? Parser.getDisplayCurrency(CurrencyUtil.doSimplifyCoins({cp: mat.value})) : "\u2014";
			const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CRAFTING](mat);

			return `<tr>
				<td class="ve-text-center">${mat.harvest.dc ?? "\u2014"}</td>
				<td><a href="#${hash}">${mat.name.qq()}</a></td>
				<td class="ve-text-center">${renderer.render(Parser.craftingQuantityToFull(mat.harvest))}</td>
				<td class="ve-text-center">${mat.harvest.time || "\u2014"}</td>
				<td class="ve-text-center">${value}</td>
				<td class="ve-text-center">${mat.weight != null ? `${mat.weight} lb.` : "\u2014"}</td>
				<td>${usedIn || "\u2014"}</td>
				<td class="ve-text-center">${Parser.sourceJsonToAbv(mat.source)}</td>
			</tr>`;
		}).join("");

		return ee`<div class="crafting-tool__creature">
			<div class="crafting-tool__creature-head">
				<span class="crafting-tool__creature-name">${meta.source ? renderer.render(`{@creature ${meta.name}|${meta.source}}`) : meta.name}</span>
				${subtitle ? `<span class="ve-muted ve-ml-2">${subtitle}</span>` : ""}
				<span class="ve-muted ve-ml-auto">${meta.materials.length} harvestable${meta.materials.length === 1 ? "" : "s"}</span>
			</div>
			<table class="ve-w-100 crafting-tool__table stripe-odd-table">
				<thead><tr>
					<th class="ve-text-center">DC</th>
					<th>Material</th>
					<th class="ve-text-center">Qty</th>
					<th class="ve-text-center">Time</th>
					<th class="ve-text-center">Value</th>
					<th class="ve-text-center">Weight</th>
					<th>Crafts Into</th>
					<th class="ve-text-center">Source</th>
				</tr></thead>
				<tbody>${rows}</tbody>
			</table>
		</div>`;
	}
}
