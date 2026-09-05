"use strict";

/**
 * Crafting, harvesting and cooking.
 *
 * Three flows, and only two of them roll dice:
 *
 *   Harvest — Dexterity (Harvesting) against the material's DC. Success puts the material in your
 *             bag. Arcadia 11 defines the skill; the DCs come from whichever book describes the
 *             part.
 *   Cook    — Wisdom (Cooking) against the dish's DC, resolving the Arcadia 11 outcome ladder:
 *             meeting the DC is a Success, beating it by 5 is Delicious, and a natural 20 on a
 *             successful check is Extra Delicious.
 *   Craft   — no roll. The Complete Crafter defines crafting as materials worth half the item's
 *             sell price, `gp ÷ 50` workweeks, and the right tools. Rolling for it would invent a
 *             rule none of the six books contain, so this is a commit dialog, not a check.
 *
 * Two invariants hold this together:
 *
 *   1. Materials are ordinary inventory items. Crafting consumes them through the same
 *      `setItemQuantity` / `removeItem` path the spell-component picker reads, so an Aboleth Eye
 *      spent on a Lens of Forgotten History disappears from the cast picker with no code in
 *      between. A separate material ledger would desync the moment anyone touched it.
 *   2. Every roll goes through `_rollSkillCheck`. A bare `Math.random()` would silently drop
 *      conditional modifiers, exhaustion, advantage from active states, 3D dice and roll history.
 */
class CharacterSheetCrafting {
	constructor (page, state) {
		this._page = page;
		this._state = state;
	}

	/* -------------------------------------------------------------------------- */
	/* Shared                                                                      */
	/* -------------------------------------------------------------------------- */

	/** Crafter profession → the tool a character would plausibly hold. Advisory only. */
	static CRAFTER_TO_TOOL = {
		"Alchemist": "Alchemist's Supplies",
		"Artificer": "Tinker's Tools",
		"Blacksmith": "Smith's Tools",
		"Cook": "Cook's Utensils",
		"Leatherworker": "Leatherworker's Tools",
		"Thaumaturge": "Arcana",
		"Tinker": "Tinker's Tools",
	};

	/** Rarity → the proficiency bonus Hamund's optional Crafter Skill rule wants for it. */
	static RARITY_TO_MIN_PROF = {
		"common": 2,
		"uncommon": 3,
		"rare": 4,
		"very rare": 5,
		"legendary": 6,
	};

	async _pGetCatalog () {
		return this._page.pGetCraftingCatalog();
	}

	static _fmtValue (valueCp) {
		if (valueCp == null) return "\u2014";
		return Parser.getDisplayCurrency(CurrencyUtil.doSimplifyCoins({cp: valueCp}));
	}

	/**
	 * Value as a single gp figure, for prose.
	 *
	 * The table wants the exact mixed-coin string; a sentence wants one number. Kept free of the
	 * site currency helpers so the stake threshold stays pure.
	 */
	static _fmtValueGp (valueCp) {
		const gp = (valueCp ?? 0) / 100;
		const rounded = gp >= 1 ? Math.round(gp * 100) / 100 : Math.round(gp * 1000) / 1000;
		return `${rounded.toLocaleString("en-US")} gp`;
	}

	/**
	 * A required amount, readably.
	 *
	 * Hamund's prices a few recipes in fractions of a part — a third of an astral dreadnought eye,
	 * a quarter of a frost giant tongue — which reach the data as 0.3333 and 0.25. Printed raw they
	 * read as a rounding error rather than a deliberate portion.
	 *
	 * Pure and static.
	 */
	static _fmtRequired (n) {
		if (typeof n !== "number" || Number.isInteger(n)) return `${n}`;
		const known = {0.25: "\u00bc", 0.5: "\u00bd", 0.75: "\u00be", 0.3333: "\u2153", 0.6667: "\u2154"};
		const hit = Object.keys(known).find(k => Math.abs(Number(k) - n) < 0.005);
		if (hit) return known[hit];
		return `${Math.round(n * 100) / 100}`;
	}

	static _fmtQuantity (harvest) {
		if (!harvest) return "1";
		if (harvest.quantityRoll) return harvest.quantityRoll;
		const n = harvest.quantity ?? 1;
		return harvest.quantityUnit ? `${n} ${harvest.quantityUnit}` : `${n}`;
	}

	/** Roll a quantity expression through the dice pipeline so it lands in the roll log. */
	_rollQuantity (harvest) {
		if (!harvest?.quantityRoll) return harvest?.quantity ?? 1;
		const m = /^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/i.exec(harvest.quantityRoll);
		if (!m) return harvest.quantity ?? 1;
		let total = this._page.rollDice(Number(m[1]), Number(m[2]));
		if (m[3]) total += (m[3] === "-" ? -1 : 1) * Number(m[4]);
		return Math.max(1, total);
	}

	/** Does the character hold the tool this crafter profession implies? Never blocks. */
	_getCrafterAdvisory (crafter) {
		if (!crafter) return null;
		const tool = this.constructor.CRAFTER_TO_TOOL[crafter];
		if (!tool) return {crafter, tool: null, isProficient: false};

		const tools = (this._state.getToolProficiencies?.() || []).map(t => `${t?.name ?? t}`.toLowerCase());
		const isProficient = tools.some(t => t.includes(tool.toLowerCase()) || tool.toLowerCase().includes(t));
		return {crafter, tool, isProficient};
	}

	/** Hamund's optional Crafter Skill rule: proficiency bonus must reach the item's rarity. */
	_getRarityAdvisory (rarity) {
		const needed = this.constructor.RARITY_TO_MIN_PROF[`${rarity ?? ""}`.toLowerCase()];
		if (!needed) return null;
		const prof = this._state.getProficiencyBonus?.() ?? 2;
		return {needed, prof, isSufficient: prof >= needed};
	}

	/**
	 * Add a harvested material to inventory, stacking onto an existing pile.
	 *
	 * Marked `_isCraftingMaterial` so the inventory can group it — a harvested organ is otherwise
	 * indistinguishable from a coil of rope, both being `type: "G"`.
	 */
	_addMaterialToInventory (material, quantity) {
		const key = CharacterSheetState.normaliseMaterialKey(material.name);
		const item = this._getHarvestedMaterialItem(material);

		// Match the exact part first, then any other stack that is itself a crafting material —
		// which is what lets "Aboleth Eye" and "Aboleth Eye (1 lb)" from two books share a pile.
		// A plain key match would also catch a *crafted* item of the same name: the one real
		// collision in the catalogue is Hamund's "Mimic Gel" recipe, whose output normalises onto
		// the "Mimic Gel (3 vials)" it is made from, so harvested vials were being filed as
		// finished goods.
		const candidates = this._state.getInventory().filter(inv => CharacterSheetState.normaliseMaterialKey(inv.item?.name) === key);
		const existing = candidates.find(inv => inv.item?.name === material.name)
			|| candidates.find(inv => inv.item?._isCraftingMaterial);
		if (!this._isCampaignItemMutationAllowed({after: item})) return null;

		if (existing) {
			this._state.setItemQuantity(existing.id, (existing.quantity || 1) + quantity);
			return existing;
		}

		this._state.addItem(item, quantity);

		return this._state.getInventory().find(inv => inv.item?.name === material.name) || null;
	}

	_getHarvestedMaterialItem (material) {
		return {
			name: material.name,
			source: material.source,
			type: "G",
			rarity: material.rarity || "unknown",
			weight: material.weight ?? 0,
			value: material.value ?? 0,
			entries: material.entries || [],
			_isCraftingMaterial: true,
			...(material.variantComponent ? {variantComponent: material.variantComponent} : {}),
		};
	}

	_isCampaignItemMutationAllowed ({before = null, after}) {
		if (this._page?._inventory?._isCampaignItemMutationAllowed) {
			return this._page._inventory._isCampaignItemMutationAllowed({before, after});
		}
		if (
			this._page?._isHubContextRefreshing
			|| this._page?._isHubContextUnavailable
			|| this._page?._isHubContextRevalidationRequired
		) return false;
		if (!this._page?._hubContext) return true;
		return !!this._page.isCampaignContentMutationAllowed?.({before, after});
	}

	/** How many of a material the character currently carries. */
	_getHeldQuantity (name) {
		const key = CharacterSheetState.normaliseMaterialKey(name);
		return this._state.getInventory()
			.filter(inv => CharacterSheetState.normaliseMaterialKey(inv.item?.name) === key)
			.reduce((acc, inv) => acc + (inv.quantity || 1), 0);
	}

	/* -------------------------------------------------------------------------- */
	/* Harvest                                                                     */
	/* -------------------------------------------------------------------------- */

	/**
	 * Creature-first, because that is how the question arrives at the table: something died, and
	 * the player wants to know what comes off it. Every book that describes the creature
	 * contributes rows, and each row is individually rollable — a corpse is not a loot-all button.
	 */
	async pShowHarvestModal ({creatureName = null} = {}) {
		const catalog = await this._pGetCatalog();
		if (!catalog) return JqueryUtil.doToast({type: "danger", content: "Could not load the crafting data."});

		// Deliberately NOT `isHeight100` — the modal opens on a one-line prompt, and a forced
		// full-height shell left more than a third of it empty before the player had typed
		// anything. The results container carries its own max-height instead, so the modal grows
		// into the search and stops.
		const {eleModalInner: modalInner} = await CharacterSheetModal.pGetShow({
			title: "\ud83e\uddfa Harvest",
			isWidth100: true,
			isMinHeight0: true,
		});

		const iptSearch = ee`<input id="cs-crafting-harvest-search" class="ve-form-control" placeholder="Search a creature\u2026" autocomplete="off" spellcheck="false">`;
		const wrpResults = ee`<div class="ve-overflow-y-auto ve-min-h-0 cs-crafting__results" role="region" aria-live="polite" aria-label="Harvestable parts"></div>`;

		const creatures = [...catalog.materialsByCreature.keys()].sort();
		const foraged = this._state.getForagedMaterials();

		const render = () => {
			const term = iptSearch.value.trim().toLowerCase();
			wrpResults.empty();

			if (!term) {
				ee(wrpResults)`<div class="ve-muted ve-p-2">Search for the creature you just felled, or for a herb, mineral or ingredient you are gathering.</div>`;
				return;
			}

			const matches = creatures.filter(c => c.includes(term)).slice(0, 20);
			const gathered = foraged
				.filter(mat => mat.name.toLowerCase().includes(term) || `${mat.materialCategory || ""}`.toLowerCase().includes(term))
				.slice(0, 40);

			if (!matches.length && !gathered.length) {
				ee(wrpResults)`<div class="ve-muted ve-p-2">Nothing harvestable is recorded for "${term}".</div>`;
				return;
			}

			matches.forEach(key => this._renderHarvestCreature(wrpResults, catalog.materialsByCreature.get(key)));
			if (gathered.length) this._renderHarvestForaged(wrpResults, gathered, term);
		};

		iptSearch.addEventListener("input", () => render());

		ee(modalInner)`
			<div class="cs-crafting cs-adaptive-panel ve-flex-col ve-h-100 ve-min-h-0">
				<label class="ve-hidden" for="cs-crafting-harvest-search">Search a creature</label>
				<div class="ve-mb-2">${iptSearch}</div>
				${wrpResults}
			</div>
		`;

		if (creatureName) iptSearch.value = creatureName;
		render();
		iptSearch.focus();
	}

	_renderHarvestCreature (wrp, materials) {
		const first = materials[0];
		const creature = first.harvest.creature;
		const subtitle = [
			first.harvest.creatureType ? first.harvest.creatureType.toTitleCase() : null,
			first.harvest.cr != null ? `CR ${Parser.numberToCr(first.harvest.cr)}` : null,
		].filter(Boolean).join(", ");

		const block = ee`<div class="cs-crafting__creature">
			<div class="cs-crafting__creature-head">
				<span class="cs-crafting__creature-name">${creature.name}</span>
				${subtitle ? `<span class="ve-muted ve-ml-2">${subtitle}</span>` : ""}
				<span class="ve-muted ve-ml-auto">${materials.length} harvestable${materials.length === 1 ? "" : "s"}</span>
			</div>
		</div>`;

		const table = this.constructor._getHarvestTable();
		const tbody = table.querySelector("tbody");

		materials.forEach(mat => this._renderHarvestRow(tbody, mat));

		block.appendChild(table);

		const eleCarcass = this._getCarcassYieldsEle(first.harvest);
		if (eleCarcass) block.appendChild(eleCarcass);

		wrp.appendChild(block);
	}

	static _getHarvestTable () {
		return ee`<table class="ve-w-100 cs-crafting__table stripe-odd-table">
			<thead><tr>
				<th scope="col" class="ve-text-center">DC</th>
				<th scope="col">Material</th>
				<th scope="col" class="ve-text-center">Qty</th>
				<th scope="col" class="ve-text-center">Time</th>
				<th scope="col" class="ve-text-center">Value</th>
				<th scope="col" class="ve-text-center">Source</th>
				<th scope="col"><span class="ve-hidden">Action</span></th>
			</tr></thead>
			<tbody></tbody>
		</table>`;
	}

	/**
	 * The other half of the harvesting rule: what you gather rather than butcher.
	 *
	 * Grouped by category because this list is browsed, not looked up — "herb" is a plausible
	 * search term in a way that "Aloyleaf" only is once you already know the book.
	 */
	_renderHarvestForaged (wrp, materials, term) {
		const byCategory = new Map();
		for (const mat of materials) {
			const cat = mat.materialCategory || "other";
			if (!byCategory.has(cat)) byCategory.set(cat, []);
			byCategory.get(cat).push(mat);
		}

		const block = ee`<div class="cs-crafting__creature">
			<div class="cs-crafting__creature-head">
				<span class="cs-crafting__creature-name">From the earth</span>
				<span class="ve-muted ve-ml-2">gathered, not butchered</span>
				<span class="ve-muted ve-ml-auto">${materials.length} match${materials.length === 1 ? "" : "es"} for "${term}"</span>
			</div>
		</div>`;

		for (const [cat, group] of byCategory) {
			ee(block)`<div class="cs-crafting__foraged-cat">${cat.toTitleCase()}</div>`;
			const table = this.constructor._getHarvestTable();
			const tbody = table.querySelector("tbody");
			group.forEach(mat => this._renderHarvestRow(tbody, mat));
			block.appendChild(table);
		}

		wrp.appendChild(block);
	}

	/**
	 * Arcadia 11: any dead creature yields ordinary ingredients at DC 10 + its challenge rating.
	 *
	 * Ten of its nineteen dishes call for something like "owlbear meat", which exists in no book
	 * as a material of its own — it is the generic ingredient, taken from that creature. Without
	 * this the recipes name a thing the game can never produce.
	 *
	 * Collapsed by default: it is the same five rows on all 1,600 creatures, and the parts the
	 * books actually document for *this* creature are what the player came for.
	 */
	_getCarcassYieldsEle (harvest) {
		const cr = harvest?.cr;
		const creature = harvest?.creature?.name;
		if (cr == null || !creature) return null;

		const yields = this._state.getForagedMaterials()
			.filter(mat => this.constructor._CARCASS_YIELDS.has(CharacterSheetState.normaliseMaterialKey(mat.name)));
		if (!yields.length) return null;

		// "10 + the creature's challenge rating" leaves a fraction for CR 1/8, 1/4 and 1/2. The
		// game's standing instruction is to round down, so a CR 1/2 boar is DC 10, not DC 11.
		const dc = 10 + Math.floor(cr);
		const details = ee`<details class="cs-crafting__carcass">
			<summary>Generic ingredients from the carcass \u2014 DC ${dc}</summary>
			<div class="ve-muted ve-small ve-mb-1">Arcadia 11 lets any dead creature yield ordinary ingredients at DC 10 + CR. Take what the creature plausibly provides.</div>
		</details>`;

		const table = this.constructor._getHarvestTable();
		const tbody = table.querySelector("tbody");

		yields.forEach(mat => this._renderHarvestRow(tbody, {
			...mat,
			name: `${creature} ${mat.name}`,
			harvest: {...mat.harvest, dc, creature: harvest.creature},
			printings: [],
		}));

		details.appendChild(table);
		return details;
	}

	/**
	 * One row per logical material.
	 *
	 * When two books describe the same part they are merged into a single row carrying the
	 * primary's DC, and the alternates hang off a disclosure. Listing them as sibling rows — which
	 * is what the raw catalog produces — reads as two different parts of the corpse and makes an
	 * Aboleth look like it has thirteen harvestables instead of seven.
	 */
	_renderHarvestRow (tbody, mat) {
		const printings = mat.printings || [];
		const hasAlternates = printings.length > 1;

		const eleHeld = ee`<span class="ve-muted ve-small cs-crafting__held"></span>`;
		const syncHeld = () => {
			const n = this._getHeldQuantity(mat.name);
			eleHeld.textContent = n ? ` \u00b7 holding ${n}` : "";
		};

		const btnRoll = ee`<button class="ve-btn ve-btn-xxs ve-btn-primary cs-crafting__btn-roll" ${mat.harvest.dc == null ? "disabled title='No harvest DC is recorded for this part'" : ""}>Roll</button>`;

		const btnAlternates = hasAlternates
			? ee`<button class="ve-btn ve-btn-xxs ve-btn-default cs-crafting__btn-printings" aria-expanded="false" title="This part is described by more than one rule set">${printings.length} rule sets</button>`
			: null;

		const row = ee`<tr>
			<td class="ve-text-center">${mat.harvest.dc ?? "\u2014"}</td>
			<td>
				<span class="cs-crafting__mat-name">${mat.name}</span>
				${eleHeld}
			</td>
			<td class="ve-text-center">${this.constructor._fmtQuantity(mat.harvest)}</td>
			<td class="ve-text-center${mat.harvest.time ? "" : " cs-crafting__cell--empty"}">${mat.harvest.time || "\u2014"}</td>
			<td class="ve-text-center${mat.value == null ? " cs-crafting__cell--empty" : ""}">${this.constructor._fmtValue(mat.value)}</td>
			<td class="ve-text-center"><abbr title="${Parser.sourceJsonToFull(mat.source).qq()}">${Parser.sourceJsonToAbv(mat.source)}</abbr></td>
			<td class="ve-text-right cs-crafting__cell-act"></td>
		</tr>`;

		const cellAct = row.querySelector(".cs-crafting__cell-act");
		if (btnAlternates) cellAct.appendChild(btnAlternates);
		cellAct.appendChild(btnRoll);

		syncHeld();

		const doRoll = async (btn, harvest, over = null) => {
			btn.disabled = true;
			await this.pRollHarvest(harvest === mat.harvest && !over ? mat : {...mat, ...over, harvest});
			btn.disabled = false;
			syncHeld();
		};

		btnRoll.addEventListener("click", () => doRoll(btnRoll, mat.harvest));

		tbody.appendChild(row);

		if (!btnAlternates) return;

		// One extra row, hidden until asked for, carrying every other book's numbers for this same
		// part. Each is individually rollable because the DCs differ and the table has to pick one.
		const rowAlt = ee`<tr class="cs-crafting__row-printings ve-hidden"><td colspan="7"></td></tr>`;
		const cellAlt = rowAlt.querySelector("td");

		printings.forEach((printing, ix) => {
			const isPrimary = ix === 0;
			const line = ee`<div class="cs-crafting__printing">
				<span class="cs-crafting__printing-src">${Parser.sourceJsonToFull(printing.source)}${printing.page ? ` p${printing.page}` : ""}</span>
				<span class="ve-muted">DC ${printing.harvestDc ?? "\u2014"} \u00b7 ${this.constructor._fmtValue(printing.value)}</span>
			</div>`;

			if (isPrimary) {
				ee(line)`<span class="ve-muted ve-small">used above</span>`;
			} else {
				const btnAlt = ee`<button class="ve-btn ve-btn-xxs ve-btn-default cs-crafting__btn-roll" ${printing.harvestDc == null ? "disabled title='No harvest DC is recorded in this book'" : ""}>Roll DC ${printing.harvestDc ?? "\u2014"}</button>`;
				// Roll this book's rules, not the primary's wearing this book's DC — the line the
				// player clicked quotes this printing's value, so that is what has to land.
				btnAlt.addEventListener("click", () => doRoll(btnAlt, {...mat.harvest, dc: printing.harvestDc}, {
					value: printing.value ?? mat.value,
					source: printing.source ?? mat.source,
				}));
				line.appendChild(btnAlt);
			}

			cellAlt.appendChild(line);
		});

		btnAlternates.addEventListener("click", () => {
			const isOpen = rowAlt.classList.toggle("ve-hidden");
			btnAlternates.setAttribute("aria-expanded", isOpen ? "false" : "true");
		});

		tbody.appendChild(rowAlt);
	}

	/**
	 * Resolve one harvest attempt.
	 *
	 * Routed through `_rollSkillCheck` so the roll carries everything a Harvesting check should:
	 * proficiency, conditional modifiers, exhaustion, advantage from active states, and the roll
	 * log. A local d20 would look identical and be quietly wrong.
	 */
	async pRollHarvest (material) {
		const dc = material.harvest?.dc;
		if (dc == null) return;
		const prospectiveItem = this._getHarvestedMaterialItem(material);
		if (!this._isCampaignItemMutationAllowed({after: prospectiveItem})) return;

		if (!await this._pConfirmHarvestStake(material, dc)) return;

		const result = await this._page._rollSkillCheck("harvesting", "Harvesting", null, null, {dc});

		// A cancelled roll is not a failed roll. `_rollSkillCheck` returns null when the player
		// backs out of the conditional-modifier picker; treating that as a miss destroyed the part
		// — and, on a dangerous material, opened the "it bit you" dialog for a roll never made.
		if (result == null) return;

		if (!result.isSuccess) {
			await this._pHandleHarvestFailure(material, {dc, total: result.total});
			return;
		}

		const quantity = this._rollQuantity(material.harvest);
		if (!this._addMaterialToInventory(material, quantity)) return;

		this._page.saveCharacter();
		this._page._inventory?.render?.();

		JqueryUtil.doToast({
			type: "success",
			content: `\ud83e\uddfa Harvested ${quantity}\u00d7 ${material.name}${result.total != null ? ` \u2014 rolled ${result.total} vs DC ${dc}` : ""}`,
		});
	}

	/**
	 * What a failed harvest actually costs, if anything.
	 *
	 * A botched roll destroys the part, so some harvests are a real gamble and some are a
	 * formality. Prompting on all of them would train the player to dismiss the prompt, which is
	 * worse than not having one — so this only speaks up when there is something to lose:
	 * the part is worth money, it doubles as a spell component, or the optional dangerous-material
	 * rule is on and this one bites back.
	 *
	 * Pure and static so the threshold is testable without a DOM.
	 *
	 * @returns {string[]} Reasons this roll is worth pausing over. Empty means roll silently.
	 */
	static getHarvestStakes (material, settings = {}) {
		const stakes = [];

		if ((material?.value ?? 0) > 0) stakes.push(`It is worth ${CharacterSheetCrafting._fmtValueGp(material.value)}.`);

		const spells = (material?.variantComponent?.spellEffects || [])
			.map(se => se.match?.spell?.split("|")[0])
			.filter(Boolean)
			.map(s => s.toTitleCase());
		if (spells.length) stakes.push(`It is a spell component for ${spells.join(", ")}.`);
		else if (material?.variantComponent) stakes.push("It doubles as a spell component.");

		if (settings.craftingDangerousHarvest
			&& material?.hasUseEffect
			&& (material.effectTags || []).some(tag => CharacterSheetCrafting._DAMAGING_TAGS.has(tag))) {
			stakes.push("Botching it turns the material on you.");
		}

		return stakes;
	}

	async _pConfirmHarvestStake (material, dc) {
		const settings = this._state.getSettings() || {};
		if (settings.craftingSkipStakePrompt) return true;

		const stakes = CharacterSheetCrafting.getHarvestStakes(material, settings);
		if (!stakes.length) return true;

		const answer = await InputUiUtil.pGetUserBoolean({
			title: "\ud83e\uddfa Harvest",
			htmlDescription: `<p>A failed check destroys the <strong>${material.name.qq()}</strong>. There is no second attempt.</p>
				<ul class="ve-small mb-2">${stakes.map(s => `<li>${s.qq()}</li>`).join("")}</ul>
				<p class="ve-small ve-muted">Dexterity (Harvesting) against DC ${dc}.</p>`,
			textYes: "Roll it",
			textNo: "Leave it",
		});

		return answer === true;
	}

	/**
	 * Hamund's optional "Harvesting Dangerous Materials": botching a venom, acid or breath sac
	 * turns it on the harvester. Off by default — it is a harsh rule, and the books present it as
	 * optional.
	 */
	async _pHandleHarvestFailure (material, {dc = null, total = null} = {}) {
		const settings = this._state.getSettings() || {};
		const isDangerous = settings.craftingDangerousHarvest
			&& material.hasUseEffect
			&& (material.effectTags || []).some(tag => CharacterSheetCrafting._DAMAGING_TAGS.has(tag));

		// The roll is the reason the material is gone; a bare "it was ruined" leaves the player
		// checking the roll log to find out by how much.
		const margin = (total != null && dc != null) ? ` \u2014 rolled ${total} vs DC ${dc}` : "";

		if (!isDangerous) {
			JqueryUtil.doToast({type: "warning", content: `The ${material.name} was ruined${margin}.`});
			return;
		}

		const useText = CharacterSheetCrafting._getUseText(material);
		await InputUiUtil.pGetUserBoolean({
			title: "\u2620\ufe0f Dangerous Material",
			htmlDescription: `<p>The <strong>${material.name.qq()}</strong> is ruined${margin.qq()} \u2014 and it goes off in your hands.</p>
				${useText ? `<p class="ve-muted ve-small">${useText.qq()}</p>` : ""}
				<p class="ve-small">Apply its effect to yourself.</p>`,
			textYes: "Understood",
			textNo: null,
		});
	}

	/**
	 * What a corpse plausibly yields under Arcadia 11's "from a dead creature" clause.
	 *
	 * Only the three that read sensibly off any body. Poultry and fish are kinds of meat you
	 * gather or buy rather than butcher out of an arbitrary monster, and "Owlbear Fish" is the
	 * sort of line that costs a tool its credibility. They remain foraging rows.
	 */
	static _CARCASS_YIELDS = new Set(["meat", "fats", "eggs"]);

	/**
	 * How close to empty counts as empty.
	 *
	 * A third of a crystal is stored as 0.3333, so spending it three times leaves 0.0001 of one —
	 * a stack the player owns, can see, and can never use.
	 */
	static _QUANTITY_EPSILON = 0.005;

	static _DAMAGING_TAGS = new Set([
		"acid", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison damage",
		"psychic", "radiant", "slashing", "thunder", "poisoned",
	]);

	/** The `Use:` sub-entry, which is where a harvestable's mechanical text lives. */
	static _getUseText (material) {
		const stack = [...(material.entries || [])];
		while (stack.length) {
			const cur = stack.shift();
			if (!cur || typeof cur !== "object") continue;
			if (cur.name && /^Use\b/i.test(cur.name)) return Renderer.stripTags(`${cur.entries?.join(" ") ?? ""}`);
			if (Array.isArray(cur.entries)) stack.push(...cur.entries);
		}
		return null;
	}

	/* -------------------------------------------------------------------------- */
	/* Craft & Cook                                                                */
	/* -------------------------------------------------------------------------- */

	/**
	 * Answer-first. There are 456 craftables, which is unbrowsable mid-session, so the workbench
	 * leads with what the character can make *right now* and only then widens out.
	 */
	async pShowCraftWorkbench ({filterMaterial = null} = {}) {
		const catalog = await this._pGetCatalog();
		if (!catalog) return JqueryUtil.doToast({type: "danger", content: "Could not load the crafting data."});

		const {eleModalInner: modalInner} = await CharacterSheetModal.pGetShow({
			title: "\ud83d\udd28 Craft",
			isHeight100: true,
			isWidth100: true,
			isUncappedHeight: true,
			isMinHeight0: true,
		});

		const iptSearch = ee`<input id="cs-crafting-craft-search" class="ve-form-control" placeholder="Search craftables\u2026" autocomplete="off" spellcheck="false">`;
		const wrpResults = ee`<div class="ve-overflow-y-auto ve-min-h-0 cs-crafting__results cs-crafting__results--fill" role="region" aria-live="polite" aria-label="Craftable items"></div>`;

		const render = ({isPreserveView = false} = {}) => {
			// A craft changes what is craftable, so the workbench has to redraw — but redrawing on
			// top of a player who has scrolled into a band and is working through it would throw
			// away their place. Reopen what was open, and land where they were.
			const openBands = isPreserveView
				? new Set([...wrpResults.querySelectorAll(".cs-crafting__band[open]")].map(d => d.getAttribute("data-band")))
				: null;
			const scrollTop = isPreserveView ? wrpResults.scrollTop : 0;

			const term = iptSearch.value.trim().toLowerCase();
			wrpResults.empty();

			const scored = catalog.recipes
				.filter(recipe => !filterMaterial || (recipe.ingredients || []).some(ing => CharacterSheetState.normaliseMaterialKey(ing.name) === CharacterSheetState.normaliseMaterialKey(filterMaterial)))
				.filter(recipe => !term || `${recipe.name ?? ""}`.toLowerCase().includes(term))
				.map(recipe => ({recipe, status: this._getRecipeReadiness(recipe)}));

			const ready = scored.filter(s => s.status.nMissing === 0 && s.status.nIngredients > 0);
			const nearly = scored.filter(s => s.status.nMissing === 1);
			const rest = scored.filter(s => s.status.nMissing > 1 || s.status.nIngredients === 0);

			// A search result the player can't see isn't a result. When they've typed something,
			// the first band that actually matched opens — otherwise typing "sword" answered with
			// three collapsed headers and the one hit buried in the last of them.
			const bands = [
				{title: "Ready to craft", entries: ready, opts: {emptyText: term ? null : "Nothing yet \u2014 harvest some materials and they'll show up here."}},
				{title: "Shopping list \u2014 one ingredient short", entries: nearly, opts: {limit: 40}},
				{title: "Everything else", entries: rest, opts: {limit: term ? 60 : 0, hint: term ? null : "Search to browse the full catalogue."}},
			];
			const ixOpen = CharacterSheetCrafting.getOpenBandIndex(bands.map(b => b.entries.length), !!term);

			// The band the player was reading may not survive the craft that just happened — the
			// recipe they made leaves "Ready to craft", which then renders nothing at all. Falling
			// through to "nothing is open" answers a completed craft with an empty panel.
			const isAnySurvives = openBands && bands.some(b => openBands.has(b.title) && b.entries.length);
			const ixFallback = bands.findIndex(b => b.entries.length);

			bands.forEach((band, ix) => this._renderCraftBand(wrpResults, band.title, band.entries, {
				...band.opts,
				isOpen: openBands
					? (isAnySurvives ? openBands.has(band.title) : ix === ixFallback)
					: ix === ixOpen,
				onCommit: () => render({isPreserveView: true}),
			}));

			if (isPreserveView) wrpResults.scrollTop = scrollTop;
		};

		iptSearch.addEventListener("input", () => render());

		ee(modalInner)`
			<div class="cs-crafting cs-adaptive-panel ve-flex-col ve-h-100 ve-min-h-0">
				<label class="ve-hidden" for="cs-crafting-craft-search">Search craftables</label>
				<div class="ve-mb-2">${iptSearch}</div>
				${wrpResults}
			</div>
		`;

		render();
		iptSearch.focus();
	}

	/**
	 * How close is the character to being able to make this?
	 *
	 * An Arcadia 11 dish is several component recipes in a trench coat: Owlbear Omelette is an
	 * omelette *and* a slice of toast, and each names its own portion of fats. Treating the two
	 * rows as one requirement told the player a single portion was enough while
	 * `_consumeIngredients` went on to spend both — the two halves of the same question
	 * disagreeing. Demand is therefore summed per material across the whole recipe.
	 *
	 * Pure and static so the arithmetic is testable without an inventory.
	 *
	 * @param ingredients Raw `recipe.ingredients`.
	 * @param fnGetHeld Maps a material name to the quantity carried.
	 */
	static getRecipeDemand (ingredients, fnGetHeld) {
		const totals = new Map();
		for (const ing of ingredients || []) {
			if (ing.alternativeGroup) continue;
			const key = CharacterSheetState.normaliseMaterialKey(ing.name);
			totals.set(key, (totals.get(key) || 0) + (ing.quantity ?? 1));
		}

		const seen = new Set();
		return (ingredients || []).map(ing => {
			const held = fnGetHeld(ing.name);
			const key = CharacterSheetState.normaliseMaterialKey(ing.name);
			const required = ing.alternativeGroup ? (ing.quantity ?? 1) : totals.get(key);

			// A material that appears in more than one component group is one requirement listed
			// several times. Every row carries the summed total, so rendering them all as peers
			// reads as several separate requirements — Hydra 5 Ways names hydra meat five times and
			// would show "0/5" on each, asking for twenty-five.
			const isRepeat = !ing.alternativeGroup && seen.has(key);
			if (!ing.alternativeGroup) seen.add(key);

			return {...ing, held, required, isHeld: held >= required, isRepeat};
		});
	}

	_getRecipeReadiness (recipe) {
		const ingredients = this.constructor.getRecipeDemand(recipe.ingredients, name => this._getHeldQuantity(name));

		// Alternatives ("Ghast Hide or Ghoul Hide") count as satisfied if any one is held; repeats
		// of one material across component groups are a single requirement for the summed amount.
		const groups = new Map();
		for (const ing of ingredients) {
			const key = ing.alternativeGroup || `solo-${CharacterSheetState.normaliseMaterialKey(ing.name)}`;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(ing);
		}

		const nMissing = [...groups.values()].filter(group => !group.some(ing => ing.isHeld)).length;

		return {ingredients, nMissing, nIngredients: groups.size};
	}

	_renderCraftBand (wrp, title, entries, {isOpen = false, limit = 0, emptyText = null, hint = null, onCommit = null} = {}) {
		if (!entries.length && !emptyText) return;

		const section = ee`<details class="cs-crafting__band" data-band="${title}" ${isOpen ? "open" : ""}>
			<summary class="cs-crafting__band-head">${title} <span class="cs-crafting__band-count">(${entries.length})</span></summary>
		</details>`;

		if (!entries.length) {
			ee(section)`<div class="ve-muted ve-p-2">${emptyText}</div>`;
			wrp.appendChild(section);
			return;
		}

		// A closed band still costs what an open one does if its rows are built eagerly, and the
		// "one ingredient short" band alone is 378 recipes — enough DOM to make every keystroke in
		// the search box stutter. Build a band's rows the first time it is actually opened.
		let isBuilt = false;
		const doBuild = () => {
			if (isBuilt) return;
			isBuilt = true;

			const shown = limit ? entries.slice(0, limit) : entries;
			shown.forEach(({recipe, status}) => section.appendChild(this._getRecipeRow(recipe, status, onCommit)));

			if (hint) ee(section)`<div class="ve-muted ve-p-2">${hint}</div>`;
			else if (shown.length < entries.length) ee(section)`<div class="ve-muted ve-p-2">Showing ${shown.length} of ${entries.length} \u2014 refine your search to see the rest.</div>`;
		};

		if (isOpen) doBuild();
		else section.addEventListener("toggle", () => { if (section.open) doBuild(); });

		wrp.appendChild(section);
	}

	/**
	 * Where a missing ingredient comes from.
	 *
	 * A shopping list that only names what you lack is a dead end; the catalog already knows which
	 * creature every harvestable is cut from, so the name can carry the answer and open the
	 * Harvest modal on that creature.
	 */
	_getIngredientSourceCreature (ingredientName) {
		const direct = this._state.getCraftingMaterialByName?.(ingredientName)?.harvest?.creature?.name;
		if (direct) return direct;

		// Arcadia 11 names creature-taken ingredients as "<creature> <category>" — "owlbear meat",
		// "chuul meat" — and none of them exists as a material in its own right. The creature is
		// still recoverable from the name, which is all the player needs to go and get one.
		const words = `${ingredientName || ""}`.trim().split(/\s+/);
		if (words.length < 2) return null;
		if (!this.constructor._CARCASS_YIELDS.has(CharacterSheetState.normaliseMaterialKey(words.at(-1)))) return null;

		const creature = words.slice(0, -1).join(" ");
		return this._state.getHarvestablesForCreature(creature).length ? creature.toTitleCase() : null;
	}

	_getIngredientLi (ing) {
		// A repeat only exists to show that this group also calls for the material; the count and
		// the "go and get one" affordance belong to its first appearance.
		if (ing.isRepeat) {
			return ee`<li class="${ing.isHeld ? "cs-crafting__ing--held" : "cs-crafting__ing--missing"} cs-crafting__ing--repeat">
				<span class="cs-crafting__ing-name">${ing.name}</span>
				<span class="ve-muted">counted above</span>
			</li>`;
		}

		const li = ee`<li class="${ing.isHeld ? "cs-crafting__ing--held" : "cs-crafting__ing--missing"}">
			${ing.isAlternative && ing.alternativeIndex > 0 ? `<i class="ve-muted">or </i>` : ""}<span class="cs-crafting__ing-name">${ing.name}</span>
			<span class="ve-muted">${ing.held}/${this.constructor._fmtRequired(ing.required ?? ing.quantity ?? 1)}</span>
		</li>`;

		if (ing.isHeld) return li;

		const creatureName = this._getIngredientSourceCreature(ing.name);
		if (!creatureName) return li;

		const btn = ee`<button class="ve-btn-xxs cs-crafting__btn-source" title="Open Harvest on ${creatureName.qq()}">from ${creatureName}</button>`;
		btn.addEventListener("click", () => this.pShowHarvestModal({creatureName}));
		li.appendChild(btn);

		return li;
	}

	_getRecipeRow (recipe, status, onCommit = null) {
		const isDish = recipe.recipeCategory === "dish";
		const crafterAdvisory = this._getCrafterAdvisory(recipe.crafter);
		const rarityAdvisory = this._getRarityAdvisory(recipe.rarity);
		const isReady = status.nMissing === 0 && status.nIngredients > 0;

		const chips = [
			recipe.crafter ? `<span class="cs-crafting__chip ${crafterAdvisory?.isProficient ? "cs-crafting__chip--ok" : "cs-crafting__chip--warn"}" title="${crafterAdvisory?.isProficient ? `You have ${crafterAdvisory.tool}` : `Needs ${recipe.crafter}${crafterAdvisory?.tool ? ` (${crafterAdvisory.tool})` : ""} — you're not proficient`}">${recipe.crafter}</span>` : "",
			recipe.rarity ? `<span class="charsheet__rarity-badge--${recipe.rarity.toLowerCase().replace(/\s+/g, "-")} cs-crafting__chip-rarity">${recipe.rarity.toTitleCase()}</span>` : "",
			isDish && recipe.craftDC != null ? `<span class="cs-crafting__chip">Cooking DC ${recipe.craftDC}</span>` : "",
			rarityAdvisory && !rarityAdvisory.isSufficient ? `<span class="cs-crafting__chip cs-crafting__chip--warn" title="Hamund's optional Crafter Skill rule wants a +${rarityAdvisory.needed} proficiency bonus; yours is +${rarityAdvisory.prof}">Prof +${rarityAdvisory.needed}</span>` : "",
			this.constructor.isFormulaRequired(recipe) ? `<span class="cs-crafting__chip" title="The Complete Crafter: &quot;A character needs a formula for a magic item in order to create it.&quot; No book in the catalog stocks formulae, so this is your table's call — the sheet won't stop you.">Formula</span>` : "",
		].filter(Boolean).join("");

		// Primary is a promise that something will happen. Reserve it for the rows that can
		// actually deliver — an indigo button on all 378 unmakeable recipes reads as an invitation
		// and resolves as a refusal.
		const btn = ee`<button class="ve-btn ve-btn-xs ${isReady ? "ve-btn-primary" : "ve-btn-default"} cs-crafting__btn-make" ${isReady ? "" : `title="Still ${status.nMissing} ingredient${status.nMissing === 1 ? "" : "s"} short"`}>${isDish ? "\ud83c\udf72 Cook" : "\ud83d\udd28 Craft"}</button>`;

		const row = ee`<div class="cs-crafting__recipe">
			<div class="cs-crafting__recipe-head">
				<span class="cs-crafting__recipe-name">${recipe.name}</span>
				<span class="ve-muted ve-small ve-ml-1">${Parser.sourceJsonToAbv(recipe.source)}</span>
				<span class="cs-crafting__chips ve-ml-2">${chips}</span>
			</div>
			<ul class="cs-crafting__ingredients"></ul>
		</div>`;

		const ul = row.querySelector(".cs-crafting__ingredients");
		if (!status.ingredients.length) {
			ee(ul)`<li class="ve-muted">No ingredients recorded \u2014 the book doesn't list any.</li>`;
		} else if ((recipe.componentGroups || []).length > 1) {
			// An Arcadia 11 dish is several component recipes served together. Flattening them
			// loses the one fact that explains why fats appears twice.
			recipe.componentGroups.forEach(group => {
				ee(ul)`<li class="cs-crafting__ing-group">${group}</li>`;
				status.ingredients.filter(ing => ing.group === group).forEach(ing => ul.appendChild(this._getIngredientLi(ing)));
			});
			status.ingredients.filter(ing => !recipe.componentGroups.includes(ing.group)).forEach(ing => ul.appendChild(this._getIngredientLi(ing)));
		} else {
			// With no component groups there is nothing for a repeat to explain — "Mark of Lolth"
			// three times over is the same requirement printed three times.
			status.ingredients.filter(ing => !ing.isRepeat).forEach(ing => ul.appendChild(this._getIngredientLi(ing)));
		}

		row.querySelector(".cs-crafting__recipe-head").appendChild(btn);
		btn.addEventListener("click", async () => {
			btn.disabled = true;
			if (isDish) await this.pCookDish(recipe, status);
			else await this.pCommitCraft(recipe, status);
			btn.disabled = false;
			// The bag changed, so every row's readiness did too.
			onCommit?.();
		});

		return row;
	}

	/**
	 * Which band opens.
	 *
	 * Idle: the first one, so "Ready to craft" is what the workbench says about you — including
	 * when the honest answer is zero. Searching: the first band that actually matched, because a
	 * result the player can't see isn't a result.
	 *
	 * @returns {number} Index to open, or -1 for none.
	 */
	static getOpenBandIndex (counts, isSearching) {
		if (!isSearching) return 0;
		return counts.findIndex(n => n > 0);
	}

	/**
	 * Craft: a commit dialog, not a check.
	 *
	 * The Complete Crafter prices a craft in materials and workweeks, not in dice, so this mirrors
	 * the Scribe Spell modal's three-way shape — do it, do it anyway, or back out.
	 */
	async pCommitCraft (recipe, status) {
		if (!this._isCampaignItemMutationAllowed({after: this._getCraftedItem(recipe)})) return;
		const settings = this._state.getSettings() || {};
		const advisory = this._getCrafterAdvisory(recipe.crafter);
		const rarityAdvisory = this._getRarityAdvisory(recipe.rarity);

		// Never trust the caller's readiness. The workbench builds each row once and hands its
		// `status` to the click handler, so a second click reuses the readiness computed before the
		// first craft spent the materials — a row that says "Ready" forever and mints an item per
		// click from an empty bag. Inventory is the only authority on what is held.
		status = this._getRecipeReadiness(recipe);

		const workweeks = recipe.value != null ? Math.max(1, Math.round(recipe.value / 100 / 50)) : null;

		// A component spent on a craft is a component you can no longer cast with. Say so.
		// Driven off the spend plan rather than the raw ingredient rows: the plan is already
		// deduplicated and already carries the summed amount, so a material named once per
		// component group warns once, against what the craft will really take.
		const lastComponentWarnings = this.constructor.getSpendPlan(status.ingredients)
			.map(spend => {
				const inv = this._state.getInventory().find(it => CharacterSheetState.normaliseMaterialKey(it.item?.name) === CharacterSheetState.normaliseMaterialKey(spend.name));
				if (!inv?.item?.variantComponent?.spellEffects?.length) return null;
				if ((inv.quantity || 1) > spend.quantity) return null;
				const spells = (inv.item.variantComponent.spellEffects || [])
					.map(se => se.match?.spell?.split("|")[0])
					.filter(Boolean)
					.map(s => s.toTitleCase());
				return `This is your last ${inv.item.name}${spells.length ? `; it also enhances ${spells.join(", ")}` : ", which is also a spell component"}.`;
			})
			.filter(Boolean);

		const blocked = settings.craftingStrictCrafterGating && advisory && !advisory.isProficient;

		// Twelve Complete Crafter recipes — Dragonplate Armor and Potion of Superior Mana among
		// them — record no ingredients at all. `nMissing` is therefore 0, which read as "ready" and
		// offered a primary Craft button that minted a legendary item for nothing. No cost data is
		// not the same as no cost; the player's table has to supply the answer.
		const isCostUnknown = status.nIngredients === 0;

		const lines = [
			`<p>Crafting <strong>${recipe.name.qq()}</strong>${recipe.rarity ? ` (${recipe.rarity.toTitleCase()})` : ""}.</p>`,
			`<ul class="mb-2">`,
			recipe.crafter ? `<li><strong>Crafter:</strong> ${recipe.crafter}${advisory?.tool ? ` \u2014 ${advisory.tool}` : ""} ${advisory?.isProficient ? "\u2705" : "\u26a0\ufe0f not proficient"}</li>` : "",
			workweeks ? `<li><strong>Time:</strong> ~${workweeks} workweek${workweeks === 1 ? "" : "s"} (gp \u00f7 50)</li>` : "",
			rarityAdvisory && !rarityAdvisory.isSufficient ? `<li>\u26a0\ufe0f Hamund's Crafter Skill rule wants a +${rarityAdvisory.needed} proficiency bonus; yours is +${rarityAdvisory.prof}</li>` : "",
			`</ul>`,
			status.ingredients.length ? `<p class="mb-1"><strong>Consumes:</strong></p><ul class="mb-2">${this.constructor.getSpendPlan(status.ingredients).map(sp => `<li>${this.constructor._fmtRequired(sp.quantity)}\u00d7 ${sp.name.qq()}</li>`).join("")}</ul>` : "",
			...lastComponentWarnings.map(w => `<p class="ve-small cs-crafting__warning">\u26a0\ufe0f ${w.qq()}</p>`),
			isCostUnknown ? `<p class="ve-small cs-crafting__warning">\u26a0\ufe0f ${Parser.sourceJsonToAbv(recipe.source)} lists no materials for this item, so the sheet has nothing to deduct \u2014 crafting it here costs you nothing. Settle the price with your DM first.</p>` : "",
			!isCostUnknown && status.nMissing > 0 ? `<p class="ve-small ve-muted">You are missing ${status.nMissing} ingredient${status.nMissing === 1 ? "" : "s"} — crafting anyway will consume only what you hold.</p>` : "",
			this._getCraftMaterialPickerHtml(),
		].filter(Boolean).join("");

		// Captured from the optional Material select, read at change time because the dialog
		// resolves after its DOM is gone.
		let materialRef = null;
		const choice = await this._pThreeWay({
			title: "\ud83d\udd28 Craft",
			html: lines,
			labelPrimary: "Craft",
			labelSecondary: status.nMissing > 0 || blocked || isCostUnknown ? "Craft anyway" : null,
			isPrimaryDisabled: status.nMissing > 0 || blocked || isCostUnknown,
			onRender: (body) => {
				const sel = body.querySelector(".cs-crafting__material-select");
				sel?.addEventListener("change", () => { materialRef = CharacterSheetCrafting._parseMaterialValue(sel.value); });
			},
		});

		if (choice === "cancel") return;
		const craftedItem = this._getCraftedItem(recipe, {material: materialRef});
		if (!this._isCampaignItemMutationAllowed({after: craftedItem})) return;

		const ledger = this._consumeIngredients(status.ingredients);
		this._state.addItem(craftedItem, 1);

		this._page.saveCharacter();
		this._page._inventory?.render?.();

		await this._pShowCraftOutcome(recipe, {ledger, workweeks, consumed: this.constructor.getSpendPlan(status.ingredients)});
	}

	/**
	 * The moment the thing exists.
	 *
	 * Cooking already ends on a proper outcome dialog; crafting ended on a three-second toast for
	 * an act that can consume a Very Rare component and represent weeks of in-world work. Same
	 * shape, plus the one affordance a consuming action owes the player: a way back.
	 */
	async _pShowCraftOutcome (recipe, {ledger, workweeks, consumed}) {
		const renderer = Renderer.get();

		const choice = await this._pThreeWay({
			title: `\ud83d\udd28 ${recipe.name}`,
			html: `<p><strong>Crafted.</strong>${recipe.rarity ? ` ${recipe.rarity.toTitleCase()}.` : ""}${workweeks ? ` About ${workweeks} workweek${workweeks === 1 ? "" : "s"} of work.` : ""}</p>
				${consumed.length ? `<p class="ve-small ve-muted mb-1">Spent: ${consumed.map(i => `${CharacterSheetCrafting._fmtRequired(i.quantity ?? 1)}\u00d7 ${i.name}`).join(", ").qq()}</p>` : ""}
				${recipe.entries?.length ? `<div class="mb-2">${renderer.render({entries: recipe.entries}, 2)}</div>` : ""}
				<p class="ve-small ve-muted">It is in your inventory.</p>`,
			labelPrimary: "Done",
			labelSecondary: "Undo",
			labelCancel: null,
		});

		// Escape and the close button both read as "keep it" \u2014 only an explicit Undo reverses.
		if (choice !== "secondary") return;

		this._undoCraft(recipe, ledger);
		this._page.saveCharacter();
		this._page._inventory?.render?.();
		JqueryUtil.doToast({type: "info", content: `Undone \u2014 ${recipe.name} unmade, materials returned.`});
	}

	/** Reverse one craft: take the item back out, put the ingredients back. */
	_undoCraft (recipe, ledger) {
		this._removeOneCrafted(recipe.name, recipe.source);
		this._restoreLedger(ledger);
	}

	/** Take a single unit of a just-made thing back out of the bag. */
	_removeOneCrafted (name, source) {
		const key = CharacterSheetState.normaliseMaterialKey(name);
		const candidates = this._state.getInventory().filter(it => CharacterSheetState.normaliseMaterialKey(it.item?.name) === key && it.item?.source === source);

		// `addItem` merges on name + source, so the stack that grew is the exact-name one. Undo
		// must take from that stack and not from a same-key neighbour — the raw material the
		// recipe consumed, or a custom item the player named similarly.
		const inv = candidates.find(it => it.item?.name === name) || candidates.find(it => !it.item?._isCraftingMaterial);
		if (!inv) return;

		const remaining = (inv.quantity || 1) - 1;
		if (remaining > 0) this._state.setItemQuantity(inv.id, remaining);
		else this._state.removeItem(inv.id);
	}

	/** Put every stack back exactly as `_consumeIngredients` found it. */
	_restoreLedger (ledger) {
		for (const rec of ledger || []) {
			if (rec.wasRemoved) this._state.addItem({...rec.item, id: rec.id}, rec.prevQuantity);
			else this._state.setItemQuantity(rec.id, rec.prevQuantity);
		}
	}

	/**
	 * Cook: Wisdom (Cooking) against the dish's DC, resolving Arcadia 11's outcome ladder.
	 * Meeting the DC is a Success; beating it by 5 is Delicious; a natural 20 on a successful
	 * check is Extra Delicious.
	 */
	async pCookDish (recipe, status) {
		const dc = recipe.craftDC;
		if (dc == null) return this.pCommitCraft(recipe, status);
		if (!this._isCampaignItemMutationAllowed({after: this._getCookedDishItem(recipe, "success")})) return;

		const settings = this._state.getSettings() || {};

		// Same reason as `pCommitCraft`: the row's `status` is a snapshot from render time.
		status = this._getRecipeReadiness(recipe);

		// Cooking rolls before it consumes, so an unconfirmed short cook spends the roll *and* the
		// partial ingredient list. Crafting asks first; cooking has to as well.
		if (status.nMissing > 0) {
			const goOn = await InputUiUtil.pGetUserBoolean({
				title: "\ud83c\udf72 Cook",
				htmlDescription: `<p>You are ${status.nMissing} ingredient${status.nMissing === 1 ? "" : "s"} short of <strong>${recipe.name.qq()}</strong>.</p>
					<p class="ve-small ve-muted">Cooking anyway still rolls the check and still spends everything you do hold.</p>`,
				textYes: "Cook anyway",
				textNo: "Back",
			});
			if (goOn !== true) return;
		}

		const result = await this._page._rollSkillCheck("cooking", "Cooking", null, null, {dc});

		if (!result) return;

		const isSuccess = result.isSuccess;
		const renderer = Renderer.get();
		const consumed = this.constructor.getSpendPlan(status.ingredients);

		// A botched dish only costs the ingredients under the optional rule \u2014 but when it does,
		// it destroys the whole list at once, which is far too much to report in a toast.
		if (!isSuccess) {
			const ledgerFail = settings.craftingConsumeOnFailure ? this._consumeIngredients(status.ingredients) : null;
			if (ledgerFail) {
				this._page.saveCharacter();
				this._page._inventory?.render?.();
			}

			await this._pCookOutcome({
				recipe,
				ledger: ledgerFail,
				html: `<p><strong>It didn't come out right.</strong> Rolled ${result.total} against DC ${dc}.</p>
					${ledgerFail
		? `<p class="ve-small ve-muted mb-1">Lost: ${consumed.map(i => `${CharacterSheetCrafting._fmtRequired(i.quantity ?? 1)}\u00d7 ${i.name}`).join(", ").qq()}</p>`
		: `<p class="ve-small ve-muted">Your ingredients are untouched.</p>`}`,
			});
			return;
		}

		const tier = this.constructor.getCookTier(result, dc);
		const outcome = this.constructor.getCookOutcome(recipe, tier);
		const cookedItem = this._getCookedDishItem(recipe, tier);
		if (!this._isCampaignItemMutationAllowed({after: cookedItem})) return;

		const ledger = this._consumeIngredients(status.ingredients);
		this._state.addItem(cookedItem, 1);
		const dishName = cookedItem.name;
		this._page.saveCharacter();
		this._page._inventory?.render?.();

		const label = {success: "Success", delicious: "Delicious!", extraDelicious: "Extra Delicious!"}[tier];

		await this._pCookOutcome({
			recipe,
			ledger,
			dishName,
			html: `<p><strong>${label}</strong> \u2014 rolled ${result.total} against DC ${dc}.</p>
				${outcome ? `<div class="mb-2">${renderer.render({entries: outcome.entries}, 2)}</div>` : ""}
				${tier === "extraDelicious" ? `<p class="ve-small ve-muted mb-1">A natural 20 on a successful Cooking check.</p>` : ""}
				${consumed.length ? `<p class="ve-small ve-muted mb-1">Spent: ${consumed.map(i => `${CharacterSheetCrafting._fmtRequired(i.quantity ?? 1)}\u00d7 ${i.name}`).join(", ").qq()}</p>` : ""}
				<p class="ve-small ve-muted">It's in your pack. Arcadia 11 gives the benefit to whoever <em>eats</em> it \u2014 so it keeps until someone does.</p>`,
		});
	}

	/**
	 * Put the finished dish in the bag.
	 *
	 * Arcadia 11 is explicit that a successful check "grants a benefit to creatures who eat the
	 * prepared food" \u2014 cooking and eating are two acts, and the eater need not be the cook. So a
	 * cook produces an object, exactly as a craft does, rather than silently applying a benefit to
	 * whoever happened to roll.
	 *
	 * The rolled tier is baked into the name and the entries, because how well it came out is a
	 * property of *this portion*. It also keeps two portions of the same dish cooked to different
	 * standards from merging into one stack \u2014 `addItem` merges on name and source.
	 *
	 * @returns {string} The name it went in under, so an undo can find it again.
	 */
	_addCookedDish (recipe, tier) {
		const item = this._getCookedDishItem(recipe, tier);
		if (!this._isCampaignItemMutationAllowed({after: item})) return null;
		this._state.addItem(item, 1);
		return item.name;
	}

	_getCookedDishItem (recipe, tier) {
		const label = this.constructor._COOK_TIER_LABELS[tier] || "Success";
		const name = `${recipe.name} (${label})`;
		const real = (this._page.getItems() || []).find(it => it.name === recipe.name && it.source === recipe.source);
		const benefits = this.constructor.getCookedBenefitEntries(recipe, tier);

		return {
			name,
			source: recipe.source,
			type: Parser.ITM_TYP_ABV__FOOD_AND_DRINK,
			rarity: "none",
			weight: real?.weight ?? 0,
			value: real?.value ?? 0,
			entries: [
				...(recipe.entries || []),
				...(benefits.length ? benefits : [{type: "entries", name: `${label}:`, entries: ["No recorded benefit."]}]),
			],
			cookedTier: tier,
		};
	}

	/**
	 * Whether The Complete Crafter's formula requirement applies: "A character needs a formula for
	 * a magic item in order to create it."
	 *
	 * Surfaced as a chip and nothing more. Not one of the six source books stocks a formula as an
	 * obtainable item, so enforcing the rule would brick every magic-item recipe against a
	 * prerequisite the player has no way to satisfy — the definition of an advisory rather than a
	 * gate. Consumables are exempt: the book carves out potions of healing and spell scrolls, and
	 * the surrounding rules treat consumables as the shortcut path throughout.
	 *
	 * Pure and static.
	 */
	static isFormulaRequired (recipe) {
		if (!recipe?.rarity) return false;
		const rarity = String(recipe.rarity).toLowerCase();
		if (rarity === "none" || rarity === "unknown" || rarity === "varies") return false;
		return recipe.recipeCategory !== "potion" && recipe.recipeCategory !== "dish";
	}

	/** The ladder, best first. */
	static _COOK_TIERS = ["extraDelicious", "delicious", "success"];

	static _COOK_TIER_LABELS = {success: "Success", delicious: "Delicious", extraDelicious: "Extra Delicious"};

	/**
	 * The benefit blocks a portion cooked to `tier` actually carries.
	 *
	 * Eight of the nineteen dishes phrase their best outcome as "You can use both of the above
	 * benefits" \u2014 a back-reference that is perfectly clear on the page and completely meaningless
	 * once the tier is lifted out on its own into an inventory item. When the rolled tier refers to
	 * "the above", the tiers it refers to come with it.
	 *
	 * Pure and static.
	 */
	static getCookedBenefitEntries (recipe, tier) {
		const outcomes = recipe?.outcomes || [];
		const byTier = tier2 => outcomes.find(o => o.tier === tier2);

		const rolled = byTier(tier);
		if (!rolled) return [];

		const asBlock = t => {
			const o = byTier(t);
			return o?.entries?.length ? {type: "entries", name: `${this._COOK_TIER_LABELS[t]}:`, entries: [...o.entries]} : null;
		};

		const text = rolled.entries.map(e => typeof e === "string" ? e : JSON.stringify(e)).join(" ");
		const isBackReference = /\bthe above\b/i.test(text);
		if (!isBackReference) return [asBlock(tier)].filter(Boolean);

		// Lowest first, so the item reads in the order the book prints it.
		const idx = this._COOK_TIERS.indexOf(tier);
		return this._COOK_TIERS.slice(idx).reverse().map(asBlock).filter(Boolean);
	}

	/**
	 * The subset of a benefit's parsed effects the sheet may safely apply on its own.
	 *
	 * `parseEffectsFromDescription` is tuned for *feature* prose, where "the target takes 6 damage"
	 * does not occur. Dish prose is full of attacks the eater may make, and the parser reads those
	 * as buffs \u2014 measured against all 57 Arcadia 11 outcomes it turns Big Wild Charcuterie Board's
	 * "the target takes 6 (2d6) damage" into a standing +6 to the eater's own damage.
	 *
	 * So this is an allowlist, not a filter: only effect kinds that can *only* mean a lasting grant
	 * to the eater. Against the real data that yields seven correct applications and no false ones.
	 * Everything else stays prose, which is the honest result for "you can use a bonus action to
	 * exhale fire in a 15-foot cone" anyway.
	 *
	 * Pure and static.
	 */
	static getSafeDishEffects (text) {
		if (!text || !globalThis.CharacterSheetState?.parseEffectsFromDescription) return [];

		const plain = String(text).replace(/\{@\w+ ([^}|]+)(\|[^}]*)?\}/g, "$1");
		const parsed = globalThis.CharacterSheetState.parseEffectsFromDescription(plain) || [];

		return parsed
			.filter(fx => {
				if (fx.type === "tempHp" || fx.type === "resistance" || fx.type === "immunity" || fx.type === "advantage") return true;
				// A dish never grants a standing bonus to attack or damage; AC and speed it does.
				if (fx.type === "bonus") return fx.target === "ac" || fx.target === "speed";
				return false;
			})
			.map(fx => CharacterSheetCrafting._normaliseDishEffect(fx));
	}

	/**
	 * Translate a parser effect into the vocabulary active states actually consume.
	 *
	 * `parseEffectsFromDescription` names a damage type bare (`lightning`), but
	 * `_getResistancesFromStates` / `_getImmunitiesFromStates` only recognise a `damage:`-prefixed
	 * target. An unprefixed effect is silently inert \u2014 it renders in the dialog, lands in the
	 * active state, and protects the character from nothing. Advantage needs no translation: the
	 * parser already emits the `check:wis` / `skill:perception` targets `getAdvantageState` matches.
	 *
	 * Pure and static.
	 *
	 * @private
	 */
	static _normaliseDishEffect (fx) {
		if (fx.type !== "resistance" && fx.type !== "immunity") return fx;
		if (!fx.target || String(fx.target).includes(":")) return fx;
		return {...fx, target: `damage:${fx.target}`};
	}

	/**
	 * Arcadia 11's outcome ladder for a *successful* Cooking check.
	 *
	 * Meeting the DC is a Success, beating it by 5 is Delicious, and a natural 20 is Extra
	 * Delicious. Only ever called past the failure branch, so a natural 20 here is necessarily
	 * a successful one.
	 *
	 * Pure and static.
	 */
	static getCookTier (result, dc) {
		if (result?.isNat20) return "extraDelicious";
		return (result?.total ?? 0) >= dc + 5 ? "delicious" : "success";
	}

	/**
	 * The entries for a tier, falling back down the ladder.
	 *
	 * Not every dish defines every tier \u2014 a simple recipe may only carry `success` \u2014 and a player
	 * who rolled a 20 should never be told nothing happened.
	 *
	 * Pure and static.
	 */
	static getCookOutcome (recipe, tier) {
		const outcomes = recipe?.outcomes || [];
		const ladder = ["extraDelicious", "delicious", "success"];
		for (const t of ladder.slice(ladder.indexOf(tier))) {
			const found = outcomes.find(o => o.tier === t);
			if (found) return found;
		}
		return null;
	}

	/**
	 * The end of a cook, in the same shape as the end of a craft.
	 *
	 * A dish leaves nothing in the inventory to take back, so undo only returns the ingredients \u2014
	 * which is also what makes it the right affordance on a *failed* cook under the consume-on-failure
	 * rule, where the loss is total and the only mistake worth catching is having rolled at all.
	 */
	async _pCookOutcome ({recipe, ledger, dishName, html}) {
		const choice = await this._pThreeWay({
			title: `\ud83c\udf72 ${recipe.name}`,
			html,
			labelPrimary: "Serve it",
			labelSecondary: (ledger || dishName) ? "Undo" : null,
			labelCancel: null,
		});

		if (choice !== "secondary") return;

		if (dishName) this._removeOneCrafted(dishName, recipe.source);
		this._restoreLedger(ledger);
		this._page.saveCharacter();
		this._page._inventory?.render?.();
		JqueryUtil.doToast({type: "info", content: `Undone \u2014 ${recipe.name} unmade, ingredients returned.`});
	}

	/**
	 * What this craft actually costs, one line per material.
	 *
	 * The readiness pass sums a material's demand across component groups, so the spend has to be
	 * deduplicated to match — otherwise a recipe naming fats twice bills for it twice. Shared by
	 * the confirmation dialog, the outcome dialog and the consumption itself so all three tell
	 * the player the same number.
	 *
	 * A partly-held requirement still gets spent, for whatever is held. The "Craft anyway" path
	 * tells the player it "will consume only what you hold"; billing them nothing for the two
	 * dragon scales they *do* have made that copy a lie and left the materials in the bag.
	 *
	 * Pure and static.
	 */
	static getSpendPlan (ingredients) {
		const plan = [];
		const bestByGroup = new Map();
		const seen = new Set();

		for (const ing of ingredients || []) {
			const held = ing.held ?? (ing.isHeld ? (ing.required ?? ing.quantity ?? 1) : 0);
			if (!(held > 0)) continue;

			const required = ing.required ?? ing.quantity ?? 1;
			const entry = {name: ing.name, quantity: Math.min(required, held)};

			// For an "A or B" set only one alternative is spent — the one the player can most
			// nearly satisfy, so a full Ghast Hide is never passed over for a part-used Ghoul Hide.
			if (ing.alternativeGroup) {
				const prev = bestByGroup.get(ing.alternativeGroup);
				if (!prev || entry.quantity > prev.entry.quantity) bestByGroup.set(ing.alternativeGroup, {entry, ix: prev?.ix ?? plan.length});
				if (!prev) plan.push(entry);
				continue;
			}

			const key = CharacterSheetState.normaliseMaterialKey(ing.name);
			if (seen.has(key)) continue;
			seen.add(key);

			plan.push(entry);
		}

		for (const {entry, ix} of bestByGroup.values()) plan[ix] = entry;

		return plan;
	}

	/**
	 * Remove the held portion of each ingredient through the ordinary inventory API.
	 *
	 * Spends across every stack that answers to the material, because readiness sums them: two
	 * Devil Wings from two different books read as "2 held", and consuming only the first stack
	 * produced the item while leaving one wing behind. Raw materials go first, so a finished
	 * Mimic Gel is never eaten to make another Mimic Gel while the harvested vial sits unused.
	 *
	 * @returns {Array<{id:string, item:object, prevQuantity:number, wasRemoved:boolean}>} Enough to
	 *   put every stack back exactly as it was — see `_undoCraft`.
	 */
	_consumeIngredients (ingredients) {
		const ledger = [];

		for (const spend of this.constructor.getSpendPlan(ingredients)) {
			const key = CharacterSheetState.normaliseMaterialKey(spend.name);
			const stacks = this._state.getInventory()
				.filter(it => CharacterSheetState.normaliseMaterialKey(it.item?.name) === key)
				.sort((a, b) => (b.item?._isCraftingMaterial ? 1 : 0) - (a.item?._isCraftingMaterial ? 1 : 0));

			let owed = spend.quantity;

			for (const inv of stacks) {
				if (owed <= this.constructor._QUANTITY_EPSILON) break;

				const prevQuantity = inv.quantity || 1;
				const taken = Math.min(prevQuantity, owed);
				const remaining = prevQuantity - taken;
				owed -= taken;

				// 1/3 of a crystal three times over leaves 0.0001 of one, which renders as a stack
				// the player owns and can never use. Anything within a rounding error of empty is
				// empty.
				const isRemoved = remaining <= this.constructor._QUANTITY_EPSILON;
				ledger.push({id: inv.id, item: inv.item, prevQuantity, wasRemoved: isRemoved});

				if (isRemoved) this._state.removeItem(inv.id);
				else this._state.setItemQuantity(inv.id, Math.round(remaining * 1e4) / 1e4);
			}
		}

		return ledger;
	}

	/** Put the finished thing in the bag, preferring the real item entry over a stub. */
	/**
	 * @param {object} recipe
	 * @param {object} [opts]
	 * @param {{name: string, source: string}|null} [opts.material] Material chosen at the workbench.
	 */
	_addCraftedItem (recipe, {material = null} = {}) {
		const item = this._getCraftedItem(recipe, {material});
		if (!this._isCampaignItemMutationAllowed({after: item})) return null;
		this._state.addItem(item, 1);
		return item;
	}

	_getCraftedItem (recipe, {material = null} = {}) {
		const real = (this._page.getItems() || []).find(it => it.name === recipe.name && it.source === recipe.source);

		const base = real ? {...real} : {
			name: recipe.name,
			source: recipe.source,
			_isCraftedItem: true,
			type: "G",
			rarity: recipe.rarity || "unknown",
			entries: recipe.entries || [],
		};

		// Provenance: what this item was made from, so a later material swap or a DM audit can
		// see the workbench decision rather than inferring it.
		base._craftedFrom = {recipe: recipe.name, source: recipe.source, ...(material ? {material} : {})};
		if (material) base.material = material;

		return base;
	}

	/**
	 * Optional Material select for the craft commit dialog. Empty string when materials are
	 * disabled or the catalog is empty, so the dialog is unchanged for a vanilla game.
	 * @returns {string}
	 */
	_getCraftMaterialPickerHtml () {
		if (typeof CharacterSheetMaterials === "undefined") return "";
		if (this._state.getSettings?.()?.enableMaterials === false) return "";
		const materials = this._page.getItemMaterials?.() || [];
		if (!materials.length) return "";

		const byCategory = new Map();
		for (const mat of materials) {
			const cat = mat.materialCategory || "other";
			if (!byCategory.has(cat)) byCategory.set(cat, []);
			byCategory.get(cat).push(mat);
		}
		const groups = [...byCategory.entries()].map(([cat, mats]) => {
			const label = CharacterSheetMaterials.CATEGORY_LABELS[cat] || cat;
			return `<optgroup label="${label.qq()}">${mats.map(m => `<option value="${`${m.name}|${m.source}`.qq()}">${m.name.qq()}</option>`).join("")}</optgroup>`;
		}).join("");

		return `<p class="mb-1"><strong>Material:</strong>
			<select class="ve-form-control input-xs cs-crafting__material-select" style="display: inline-block; width: auto;">
				<option value="">Default</option>${groups}
			</select>
			<span class="ve-small ve-muted d-block">What the finished item is made of. Applied non-destructively.</span></p>`;
	}

	/**
	 * @param {string} value A `name|source` option value.
	 * @returns {{name: string, source: string}|null}
	 */
	static _parseMaterialValue (value) {
		if (!value) return null;
		const [name, source] = String(value).split("|");
		return name ? {name, source: source || "TGTT"} : null;
	}

	/**
	 * Do it / do it anyway / cancel — the shape the Scribe Spell modal established, so a player
	 * is never trapped by an advisory they disagree with.
	 *
	 * @param {object} opts
	 * @param {function(HTMLElement): void} [opts.onRender] Called with the modal body after it is
	 *        populated, so a caller can wire up extra form controls and read their values before
	 *        the dialog resolves.
	 * @returns {Promise<"primary"|"secondary"|"cancel">}
	 */
	async _pThreeWay ({title, html, labelPrimary, labelSecondary, labelCancel = "Cancel", isPrimaryDisabled = false, onRender = null}) {
		let result = "cancel";
		let resolveOuter;
		const pResult = new Promise(resolve => { resolveOuter = resolve; });

		const {eleModalInner: modalInner, doClose} = await CharacterSheetModal.pGetShow({
			title,
			isMinHeight0: true,
			cbClose: () => resolveOuter(result),
		});

		const body = e_({tag: "div", html});
		modalInner.appendChild(body);
		onRender?.(body);

		const btnRow = e_({tag: "div", style: "display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end;"});

		if (!isPrimaryDisabled) {
			const btnPrimary = e_({tag: "button", clazz: "ve-btn ve-btn-primary", text: labelPrimary});
			btnPrimary.addEventListener("click", () => { result = "primary"; doClose(true); });
			btnRow.appendChild(btnPrimary);
		}

		if (labelSecondary) {
			const btnSecondary = e_({tag: "button", clazz: "ve-btn ve-btn-default", text: labelSecondary});
			btnSecondary.addEventListener("click", () => { result = "secondary"; doClose(true); });
			btnRow.appendChild(btnSecondary);
		}

		// An outcome dialog has no third way out: `Done` and `Undo` are the whole decision.
		if (labelCancel) {
			const btnCancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", text: labelCancel});
			btnCancel.addEventListener("click", () => { result = "cancel"; doClose(false); });
			btnRow.appendChild(btnCancel);
		}

		modalInner.appendChild(btnRow);

		return pResult;
	}
}

globalThis.CharacterSheetCrafting = CharacterSheetCrafting;
