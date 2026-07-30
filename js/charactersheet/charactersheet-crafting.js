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
		const existing = this._state.getInventory().find(inv => CharacterSheetState.normaliseMaterialKey(inv.item?.name) === CharacterSheetState.normaliseMaterialKey(material.name));

		if (existing) {
			this._state.setItemQuantity(existing.id, (existing.quantity || 1) + quantity);
			return existing;
		}

		this._state.addItem({
			name: material.name,
			source: material.source,
			type: "G",
			rarity: material.rarity || "unknown",
			weight: material.weight ?? 0,
			value: material.value ?? 0,
			entries: material.entries || [],
			_isCraftingMaterial: true,
			...(material.variantComponent ? {variantComponent: material.variantComponent} : {}),
		}, quantity);

		return this._state.getInventory().find(inv => inv.item?.name === material.name) || null;
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

		const {eleModalInner: modalInner} = await UiUtil.pGetShowModal({
			title: "\ud83e\uddfa Harvest",
			isHeight100: true,
			isWidth100: true,
			isUncappedHeight: true,
			isMinHeight0: true,
		});

		const iptSearch = ee`<input class="ve-form-control" placeholder="Search a creature\u2026" autocomplete="off" spellcheck="false">`;
		const wrpResults = ee`<div class="ve-overflow-y-auto ve-h-100 ve-min-h-0 cs-crafting__results"></div>`;

		const creatures = [...catalog.materialsByCreature.keys()].sort();

		const render = () => {
			const term = iptSearch.value.trim().toLowerCase();
			wrpResults.empty();

			if (!term) {
				ee(wrpResults)`<div class="ve-muted ve-p-2">Search for the creature you just felled.</div>`;
				return;
			}

			const matches = creatures.filter(c => c.includes(term)).slice(0, 20);
			if (!matches.length) {
				ee(wrpResults)`<div class="ve-muted ve-p-2">Nothing harvestable is recorded for "${term}".</div>`;
				return;
			}

			matches.forEach(key => this._renderHarvestCreature(wrpResults, catalog.materialsByCreature.get(key)));
		};

		iptSearch.addEventListener("input", () => render());

		ee(modalInner)`
			<div class="ve-mb-2">${iptSearch}</div>
			${wrpResults}
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

		// Two books describing the same part is normal, not a bug — Arcadia 8 and Hamund's both
		// document an Aboleth Eye, at different DCs. Show both, labelled, and let the player pick
		// which rule set the table is using.
		const nameCounts = new Map();
		materials.forEach(m => nameCounts.set(m.name.toLowerCase(), (nameCounts.get(m.name.toLowerCase()) || 0) + 1));

		const block = ee`<div class="cs-crafting__creature">
			<div class="cs-crafting__creature-head">
				<span class="cs-crafting__creature-name">${creature.name}</span>
				${subtitle ? `<span class="ve-muted ve-ml-2">${subtitle}</span>` : ""}
				<span class="ve-muted ve-ml-auto">${materials.length} harvestable${materials.length === 1 ? "" : "s"}</span>
			</div>
		</div>`;

		const table = ee`<table class="ve-w-100 cs-crafting__table stripe-odd-table">
			<thead><tr>
				<th class="ve-text-center">DC</th>
				<th>Material</th>
				<th class="ve-text-center">Qty</th>
				<th class="ve-text-center">Time</th>
				<th class="ve-text-center">Value</th>
				<th class="ve-text-center">Source</th>
				<th></th>
			</tr></thead>
			<tbody></tbody>
		</table>`;
		const tbody = table.querySelector("tbody");

		materials.forEach(mat => {
			const isTwinned = nameCounts.get(mat.name.toLowerCase()) > 1;
			const held = this._getHeldQuantity(mat.name);

			const btnRoll = ee`<button class="ve-btn ve-btn-xxs ve-btn-primary" ${mat.harvest.dc == null ? "disabled title='No harvest DC is recorded for this part'" : ""}>Roll</button>`;

			const row = ee`<tr>
				<td class="ve-text-center">${mat.harvest.dc ?? "\u2014"}</td>
				<td>
					${mat.name}
					${isTwinned ? `<span class="ve-muted ve-small" title="The same part, described by two rule sets — either roll fills the same stack"> \u00b7 also in another book</span>` : ""}
					${held ? `<span class="ve-muted ve-small"> \u00b7 holding ${held}</span>` : ""}
				</td>
				<td class="ve-text-center">${this.constructor._fmtQuantity(mat.harvest)}</td>
				<td class="ve-text-center">${mat.harvest.time || "\u2014"}</td>
				<td class="ve-text-center">${this.constructor._fmtValue(mat.value)}</td>
				<td class="ve-text-center">${Parser.sourceJsonToAbv(mat.source)}</td>
				<td class="ve-text-center"></td>
			</tr>`;

			row.querySelector("td:last-child").appendChild(btnRoll);
			btnRoll.addEventListener("click", async () => {
				btnRoll.disabled = true;
				await this.pRollHarvest(mat);
				btnRoll.disabled = false;
				// Reflect the new stack size without rebuilding the whole modal
				const heldNow = this._getHeldQuantity(mat.name);
				const cell = row.querySelector("td:nth-child(2)");
				if (cell && heldNow) cell.querySelector(".cs-crafting__held")?.remove();
			});

			tbody.appendChild(row);
		});

		block.appendChild(table);
		wrp.appendChild(block);
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

		const result = await this._page._rollSkillCheck("harvesting", "Harvesting", null, null, {dc});

		if (!result?.isSuccess) {
			await this._pHandleHarvestFailure(material);
			return;
		}

		const quantity = this._rollQuantity(material.harvest);
		this._addMaterialToInventory(material, quantity);

		this._page.saveCharacter();
		this._page._inventory?.render?.();

		JqueryUtil.doToast({
			type: "success",
			content: `\ud83e\uddfa Harvested ${quantity}\u00d7 ${material.name}`,
		});
	}

	/**
	 * Hamund's optional "Harvesting Dangerous Materials": botching a venom, acid or breath sac
	 * turns it on the harvester. Off by default — it is a harsh rule, and the books present it as
	 * optional.
	 */
	async _pHandleHarvestFailure (material) {
		const settings = this._state.getSettings() || {};
		const isDangerous = settings.craftingDangerousHarvest
			&& material.hasUseEffect
			&& (material.effectTags || []).some(tag => CharacterSheetCrafting._DAMAGING_TAGS.has(tag));

		if (!isDangerous) {
			JqueryUtil.doToast({type: "warning", content: `The ${material.name} was ruined.`});
			return;
		}

		const useText = CharacterSheetCrafting._getUseText(material);
		await InputUiUtil.pGetUserBoolean({
			title: "\u2620\ufe0f Dangerous Material",
			htmlDescription: `<p>The <strong>${material.name.qq()}</strong> is ruined \u2014 and it goes off in your hands.</p>
				${useText ? `<p class="ve-muted ve-small">${useText.qq()}</p>` : ""}
				<p class="ve-small">Apply its effect to yourself.</p>`,
			textYes: "Understood",
			textNo: null,
		});
	}

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

		const {eleModalInner: modalInner} = await UiUtil.pGetShowModal({
			title: "\ud83d\udd28 Craft",
			isHeight100: true,
			isWidth100: true,
			isUncappedHeight: true,
			isMinHeight0: true,
		});

		const iptSearch = ee`<input class="ve-form-control" placeholder="Search craftables\u2026" autocomplete="off" spellcheck="false">`;
		const wrpResults = ee`<div class="ve-overflow-y-auto ve-h-100 ve-min-h-0 cs-crafting__results"></div>`;

		const render = () => {
			const term = iptSearch.value.trim().toLowerCase();
			wrpResults.empty();

			const scored = catalog.recipes
				.filter(recipe => !filterMaterial || (recipe.ingredients || []).some(ing => CharacterSheetState.normaliseMaterialKey(ing.name) === CharacterSheetState.normaliseMaterialKey(filterMaterial)))
				.filter(recipe => !term || recipe.name.toLowerCase().includes(term))
				.map(recipe => ({recipe, status: this._getRecipeReadiness(recipe)}));

			const ready = scored.filter(s => s.status.nMissing === 0 && s.status.nIngredients > 0);
			const nearly = scored.filter(s => s.status.nMissing === 1);
			const rest = scored.filter(s => s.status.nMissing > 1 || s.status.nIngredients === 0);

			this._renderCraftBand(wrpResults, "Ready to craft", ready, {isOpen: true, emptyText: term ? null : "Nothing yet — harvest some materials and they'll show up here."});
			this._renderCraftBand(wrpResults, "Missing one ingredient", nearly, {isOpen: ready.length === 0});
			this._renderCraftBand(wrpResults, "Everything else", rest, {isOpen: false, limit: term ? 60 : 0, hint: term ? null : "Search to browse the full catalogue."});
		};

		iptSearch.addEventListener("input", () => render());

		ee(modalInner)`
			<div class="ve-mb-2">${iptSearch}</div>
			${wrpResults}
		`;

		render();
		iptSearch.focus();
	}

	/** How close is the character to being able to make this? */
	_getRecipeReadiness (recipe) {
		const ingredients = (recipe.ingredients || []).map(ing => {
			const held = this._getHeldQuantity(ing.name);
			return {...ing, held, isHeld: held >= (ing.quantity ?? 1)};
		});

		// Alternatives ("Ghast Hide or Ghoul Hide") count as satisfied if any one is held
		const groups = new Map();
		for (const ing of ingredients) {
			const key = ing.alternativeGroup || `solo-${ing.name}`;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(ing);
		}

		const nMissing = [...groups.values()].filter(group => !group.some(ing => ing.isHeld)).length;

		return {ingredients, nMissing, nIngredients: groups.size};
	}

	_renderCraftBand (wrp, title, entries, {isOpen = false, limit = 0, emptyText = null, hint = null} = {}) {
		if (!entries.length && !emptyText) return;

		const section = ee`<details class="cs-crafting__band" ${isOpen ? "open" : ""}>
			<summary class="cs-crafting__band-head">${title} <span class="ve-muted">(${entries.length})</span></summary>
		</details>`;

		if (!entries.length) {
			ee(section)`<div class="ve-muted ve-p-2">${emptyText}</div>`;
			wrp.appendChild(section);
			return;
		}

		const shown = limit ? entries.slice(0, limit) : entries;
		shown.forEach(({recipe, status}) => section.appendChild(this._getRecipeRow(recipe, status)));

		if (hint) ee(section)`<div class="ve-muted ve-p-2">${hint}</div>`;
		else if (shown.length < entries.length) ee(section)`<div class="ve-muted ve-p-2">Showing ${shown.length} of ${entries.length} — refine your search to see the rest.</div>`;

		wrp.appendChild(section);
	}

	_getRecipeRow (recipe, status) {
		const isDish = recipe.recipeCategory === "dish";
		const crafterAdvisory = this._getCrafterAdvisory(recipe.crafter);
		const rarityAdvisory = this._getRarityAdvisory(recipe.rarity);

		const chips = [
			recipe.crafter ? `<span class="cs-crafting__chip ${crafterAdvisory?.isProficient ? "cs-crafting__chip--ok" : "cs-crafting__chip--warn"}" title="${crafterAdvisory?.isProficient ? `You have ${crafterAdvisory.tool}` : `Needs ${recipe.crafter}${crafterAdvisory?.tool ? ` (${crafterAdvisory.tool})` : ""} — you're not proficient`}">${recipe.crafter}</span>` : "",
			recipe.rarity ? `<span class="cs-crafting__chip">${recipe.rarity.toTitleCase()}</span>` : "",
			isDish && recipe.craftDC != null ? `<span class="cs-crafting__chip">Cooking DC ${recipe.craftDC}</span>` : "",
			rarityAdvisory && !rarityAdvisory.isSufficient ? `<span class="cs-crafting__chip cs-crafting__chip--warn" title="Hamund's optional Crafter Skill rule wants a +${rarityAdvisory.needed} proficiency bonus; yours is +${rarityAdvisory.prof}">Prof +${rarityAdvisory.needed}</span>` : "",
		].filter(Boolean).join("");

		const ingredientList = status.ingredients.length
			? status.ingredients.map(ing => `<li class="${ing.isHeld ? "cs-crafting__ing--held" : "cs-crafting__ing--missing"}">${ing.isAlternative && ing.alternativeIndex > 0 ? `<i class="ve-muted">or </i>` : ""}${ing.name.qq()} <span class="ve-muted">${ing.held}/${ing.quantity ?? 1}</span></li>`).join("")
			: `<li class="ve-muted">No ingredients recorded — the book doesn't list any.</li>`;

		const btn = ee`<button class="ve-btn ve-btn-xs ve-btn-primary">${isDish ? "\ud83c\udf72 Cook" : "\ud83d\udd28 Craft"}</button>`;

		const row = ee`<div class="cs-crafting__recipe">
			<div class="cs-crafting__recipe-head">
				<span class="cs-crafting__recipe-name">${recipe.name}</span>
				<span class="ve-muted ve-small ve-ml-1">${Parser.sourceJsonToAbv(recipe.source)}</span>
				<span class="cs-crafting__chips ve-ml-2">${chips}</span>
			</div>
			<ul class="cs-crafting__ingredients">${ingredientList}</ul>
		</div>`;

		row.querySelector(".cs-crafting__recipe-head").appendChild(btn);
		btn.addEventListener("click", async () => {
			btn.disabled = true;
			if (isDish) await this.pCookDish(recipe, status);
			else await this.pCommitCraft(recipe, status);
			btn.disabled = false;
		});

		return row;
	}

	/**
	 * Craft: a commit dialog, not a check.
	 *
	 * The Complete Crafter prices a craft in materials and workweeks, not in dice, so this mirrors
	 * the Scribe Spell modal's three-way shape — do it, do it anyway, or back out.
	 */
	async pCommitCraft (recipe, status) {
		const settings = this._state.getSettings() || {};
		const advisory = this._getCrafterAdvisory(recipe.crafter);
		const rarityAdvisory = this._getRarityAdvisory(recipe.rarity);

		const workweeks = recipe.value != null ? Math.max(1, Math.round(recipe.value / 100 / 50)) : null;

		// A component spent on a craft is a component you can no longer cast with. Say so.
		const lastComponentWarnings = status.ingredients
			.filter(ing => ing.isHeld)
			.map(ing => {
				const inv = this._state.getInventory().find(it => CharacterSheetState.normaliseMaterialKey(it.item?.name) === CharacterSheetState.normaliseMaterialKey(ing.name));
				if (!inv?.item?.variantComponent?.spellEffects?.length) return null;
				if ((inv.quantity || 1) > (ing.quantity ?? 1)) return null;
				const spells = (inv.item.variantComponent.spellEffects || [])
					.map(se => se.match?.spell?.split("|")[0])
					.filter(Boolean)
					.map(s => s.toTitleCase());
				return `This is your last ${inv.item.name}${spells.length ? `; it also enhances ${spells.join(", ")}` : ", which is also a spell component"}.`;
			})
			.filter(Boolean);

		const blocked = settings.craftingStrictCrafterGating && advisory && !advisory.isProficient;

		const lines = [
			`<p>Crafting <strong>${recipe.name.qq()}</strong>${recipe.rarity ? ` (${recipe.rarity.toTitleCase()})` : ""}.</p>`,
			`<ul class="mb-2">`,
			recipe.crafter ? `<li><strong>Crafter:</strong> ${recipe.crafter}${advisory?.tool ? ` \u2014 ${advisory.tool}` : ""} ${advisory?.isProficient ? "\u2705" : "\u26a0\ufe0f not proficient"}</li>` : "",
			workweeks ? `<li><strong>Time:</strong> ~${workweeks} workweek${workweeks === 1 ? "" : "s"} (gp \u00f7 50)</li>` : "",
			rarityAdvisory && !rarityAdvisory.isSufficient ? `<li>\u26a0\ufe0f Hamund's Crafter Skill rule wants a +${rarityAdvisory.needed} proficiency bonus; yours is +${rarityAdvisory.prof}</li>` : "",
			`</ul>`,
			status.ingredients.length ? `<p class="mb-1"><strong>Consumes:</strong></p><ul class="mb-2">${status.ingredients.filter(i => i.isHeld).map(i => `<li>${i.quantity ?? 1}\u00d7 ${i.name.qq()}</li>`).join("")}</ul>` : "",
			...lastComponentWarnings.map(w => `<p class="ve-small cs-crafting__warning">\u26a0\ufe0f ${w.qq()}</p>`),
			status.nMissing > 0 ? `<p class="ve-small ve-muted">You are missing ${status.nMissing} ingredient${status.nMissing === 1 ? "" : "s"} — crafting anyway will consume only what you hold.</p>` : "",
		].filter(Boolean).join("");

		const choice = await this._pThreeWay({
			title: "\ud83d\udd28 Craft",
			html: lines,
			labelPrimary: "Craft",
			labelSecondary: status.nMissing > 0 || blocked ? "Craft anyway" : null,
			isPrimaryDisabled: status.nMissing > 0 || blocked,
		});

		if (choice === "cancel") return;

		this._consumeIngredients(status.ingredients);
		this._addCraftedItem(recipe);

		this._page.saveCharacter();
		this._page._inventory?.render?.();
		JqueryUtil.doToast({type: "success", content: `\ud83d\udd28 Crafted ${recipe.name}`});
	}

	/**
	 * Cook: Wisdom (Cooking) against the dish's DC, resolving Arcadia 11's outcome ladder.
	 * Meeting the DC is a Success; beating it by 5 is Delicious; a natural 20 on a successful
	 * check is Extra Delicious.
	 */
	async pCookDish (recipe, status) {
		const dc = recipe.craftDC;
		if (dc == null) return this.pCommitCraft(recipe, status);

		const settings = this._state.getSettings() || {};
		const result = await this._page._rollSkillCheck("cooking", "Cooking", null, null, {dc});
		if (!result) return;

		const isSuccess = result.isSuccess;

		if (!isSuccess) {
			if (settings.craftingConsumeOnFailure) this._consumeIngredients(status.ingredients);
			JqueryUtil.doToast({
				type: "warning",
				content: `The ${recipe.name} didn't come out right.${settings.craftingConsumeOnFailure ? " Ingredients lost." : " Ingredients kept."}`,
			});
			return;
		}

		const tier = (result.isNat20 && isSuccess)
			? "extraDelicious"
			: (result.total >= dc + 5 ? "delicious" : "success");

		const outcome = (recipe.outcomes || []).find(o => o.tier === tier)
			|| (recipe.outcomes || []).find(o => o.tier === "success");

		this._consumeIngredients(status.ingredients);
		this._page.saveCharacter();
		this._page._inventory?.render?.();

		const label = {success: "Success", delicious: "Delicious!", extraDelicious: "Extra Delicious!"}[tier];
		const renderer = Renderer.get();

		await InputUiUtil.pGetUserBoolean({
			title: `\ud83c\udf72 ${recipe.name}`,
			htmlDescription: `<p><strong>${label}</strong> \u2014 rolled ${result.total} against DC ${dc}.</p>
				${outcome ? `<div>${renderer.render({entries: outcome.entries}, 2)}</div>` : ""}
				${tier === "extraDelicious" ? `<p class="ve-small ve-muted">A natural 20 on a successful Cooking check.</p>` : ""}`,
			textYes: "Serve it",
			textNo: null,
		});
	}

	/** Remove the held portion of each ingredient through the ordinary inventory API. */
	_consumeIngredients (ingredients) {
		const takenGroups = new Set();

		for (const ing of ingredients) {
			if (!ing.isHeld) continue;
			// For an "A or B" set, only one alternative is actually spent
			const group = ing.alternativeGroup;
			if (group) {
				if (takenGroups.has(group)) continue;
				takenGroups.add(group);
			}

			const key = CharacterSheetState.normaliseMaterialKey(ing.name);
			const inv = this._state.getInventory().find(it => CharacterSheetState.normaliseMaterialKey(it.item?.name) === key);
			if (!inv) continue;

			const remaining = (inv.quantity || 1) - (ing.quantity ?? 1);
			if (remaining > 0) this._state.setItemQuantity(inv.id, remaining);
			else this._state.removeItem(inv.id);
		}
	}

	/** Put the finished thing in the bag, preferring the real item entry over a stub. */
	_addCraftedItem (recipe) {
		const real = (this._page.getItems() || []).find(it => it.name === recipe.name && it.source === recipe.source);

		this._state.addItem(real ? {...real} : {
			name: recipe.name,
			source: recipe.source,
			type: "G",
			rarity: recipe.rarity || "unknown",
			entries: recipe.entries || [],
		}, 1);
	}

	/**
	 * Do it / do it anyway / cancel — the shape the Scribe Spell modal established, so a player
	 * is never trapped by an advisory they disagree with.
	 *
	 * @returns {Promise<"primary"|"secondary"|"cancel">}
	 */
	async _pThreeWay ({title, html, labelPrimary, labelSecondary, isPrimaryDisabled = false}) {
		let result = "cancel";
		let resolveOuter;
		const pResult = new Promise(resolve => { resolveOuter = resolve; });

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title,
			isMinHeight0: true,
			cbClose: () => resolveOuter(result),
		});

		modalInner.appendChild(e_({tag: "div", html}));

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

		const btnCancel = e_({tag: "button", clazz: "ve-btn ve-btn-default", text: "Cancel"});
		btnCancel.addEventListener("click", () => { result = "cancel"; doClose(false); });
		btnRow.appendChild(btnCancel);

		modalInner.appendChild(btnRow);

		return pResult;
	}
}

globalThis.CharacterSheetCrafting = CharacterSheetCrafting;
