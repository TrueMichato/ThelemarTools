/**
 * Custom Abilities UI Module for Character Sheet
 * Unified system for custom features, homebrew abilities, house rules, boons, curses, etc.
 * Uses the same effect system as custom modifiers for consistency.
 */
class CharacterSheetCustomAbilities {
	constructor (sheet) {
		this._sheet = sheet;
		this._boundAddHandler = null;
	}

	/**
	 * Initialize event handlers
	 */
	init () {
		const addBtn = document.getElementById("charsheet-add-custom-ability");
		if (addBtn && !this._boundAddHandler) {
			this._boundAddHandler = () => this._showAbilityModal(null);
			addBtn.addEventListener("click", this._boundAddHandler);
		}
	}

	/**
	 * Get preset icon options for the icon picker
	 */
	_getIconOptions () {
		return [
			// Combat & Defense
			"⚔️", "🗡️", "🛡️", "🏹", "🔪", "⚡", "💥", "🎯",
			// Magic & Spells
			"✨", "🔮", "💫", "🌟", "⭐", "🌙", "☀️", "🔥",
			// Nature & Elements
			"🌊", "💨", "🌿", "🍃", "❄️", "⛈️", "🌪️", "🌋",
			// Status & Effects
			"❤️", "💀", "👁️", "👊", "💪", "🦾", "🧠", "👻",
			// Items & Objects
			"💎", "🔑", "📜", "📖", "🗝️", "💰", "🎲", "🃏",
			// Creatures & Characters
			"🐉", "🦅", "🐺", "🦇", "🕷️", "🧙", "👤", "🧝",
			// Misc & Symbolic
			"🌀", "♾️", "⚙️", "🔧", "🛠️", "✝️", "☯️", "🔱",
		];
	}

	/**
	 * Render the custom abilities list
	 */
	render () {
		this.init(); // Ensure handlers are bound

		const container = document.querySelector("#features-custom-abilities");
		if (!container) return;

		const state = this._sheet.getState();
		const abilities = state.getCustomAbilities();

		container.innerHTML = "";

		// Add search/filter bar if there are abilities
		if (abilities.length > 0) {
			const filterBar = this._buildFilterBar(abilities);
			container.appendChild(filterBar);
		}

		if (!abilities.length) {
			container.innerHTML = `
				<div class="custom-abilities__empty">
					<p class="ve-muted ve-text-center py-2">No custom abilities. Click <strong>+ Add</strong> above to create homebrew features, house rules, boons, or other custom effects.</p>
				</div>
			`;
			return;
		}

		// Content container for filtered results
		const contentContainer = document.createElement("div");
		contentContainer.id = "custom-abilities__content";
		container.appendChild(contentContainer);

		// Initial render with no filter
		this._renderFilteredAbilities(contentContainer, abilities, "", "all");
	}

	/**
	 * Build the search/filter bar
	 */
	_buildFilterBar (abilities) {
		const bar = document.createElement("div");
		bar.className = "custom-abilities__filter-bar";

		// Search input
		const searchInput = document.createElement("input");
		searchInput.type = "text";
		searchInput.className = "ve-form-control custom-abilities__search-input";
		searchInput.placeholder = "🔍 Search abilities...";
		searchInput.id = "custom-abilities-search";

		// Category filter
		const categorySelect = document.createElement("select");
		categorySelect.className = "ve-form-control custom-abilities__category-filter";
		categorySelect.id = "custom-abilities-category-filter";

		const categories = CharacterSheetState.CUSTOM_ABILITY_CATEGORIES;
		categorySelect.innerHTML = `
			<option value="all">All Categories</option>
			${Object.entries(categories).map(([id, cat]) => 
				`<option value="${id}">${cat.icon} ${cat.name}</option>`
			).join("")}
		`;

		// Count display
		const countDisplay = document.createElement("span");
		countDisplay.className = "custom-abilities__filter-count";
		countDisplay.id = "custom-abilities-count";
		countDisplay.textContent = `${abilities.length} abilities`;

		bar.appendChild(searchInput);
		bar.appendChild(categorySelect);
		bar.appendChild(countDisplay);

		// Bind filter events
		const updateFilter = () => {
			const searchTerm = searchInput.value.toLowerCase();
			const categoryFilter = categorySelect.value;
			const contentContainer = document.getElementById("custom-abilities__content");
			if (contentContainer) {
				const state = this._sheet.getState();
				const allAbilities = state.getCustomAbilities();
				this._renderFilteredAbilities(contentContainer, allAbilities, searchTerm, categoryFilter);
			}
		};

		searchInput.addEventListener("input", updateFilter);
		categorySelect.addEventListener("change", updateFilter);

		return bar;
	}

	/**
	 * Render filtered abilities list
	 */
	_renderFilteredAbilities (container, abilities, searchTerm, categoryFilter) {
		container.innerHTML = "";

		// Filter abilities
		let filtered = abilities;
		if (categoryFilter !== "all") {
			filtered = filtered.filter(a => a.category === categoryFilter);
		}
		if (searchTerm) {
			filtered = filtered.filter(a => {
				const nameMatch = a.name.toLowerCase().includes(searchTerm);
				const descMatch = (a.description || "").toLowerCase().includes(searchTerm);
				const effectMatch = (a.effects || []).some(e => 
					(e.type || "").toLowerCase().includes(searchTerm)
				);
				return nameMatch || descMatch || effectMatch;
			});
		}

		// Update count
		const countEl = document.getElementById("custom-abilities-count");
		if (countEl) {
			const total = abilities.length;
			const showing = filtered.length;
			countEl.textContent = showing === total ? `${total} abilities` : `${showing} of ${total}`;
		}

		if (!filtered.length) {
			container.innerHTML = `
				<div class="custom-abilities__empty">
					<p class="ve-muted ve-text-center py-2">No abilities match your search.</p>
				</div>
			`;
			return;
		}

		// Group abilities by category
		const categories = CharacterSheetState.CUSTOM_ABILITY_CATEGORIES;
		const grouped = {};

		for (const ability of filtered) {
			if (!grouped[ability.category]) grouped[ability.category] = [];
			grouped[ability.category].push(ability);
		}

		// Render abilities by category
		for (const [categoryId, categoryAbilities] of Object.entries(grouped)) {
			if (!categoryAbilities.length) continue;
			const category = categories[categoryId] || {name: categoryId, icon: "❓", color: "#666"};
			const section = this._buildCategorySection(category, categoryAbilities);
			container.appendChild(section);
		}
	}

	/**
	 * Build a category section containing abilities
	 */
	_buildCategorySection (category, abilities) {
		const section = document.createElement("div");
		section.className = "custom-abilities__category";

		const header = document.createElement("div");
		header.className = "custom-abilities__category-header";
		header.style.borderLeftColor = category.color;
		header.innerHTML = `
			<span class="custom-abilities__category-icon">${category.icon}</span>
			<span class="custom-abilities__category-name">${category.name}</span>
			<span class="custom-abilities__category-count">(${abilities.length})</span>
		`;
		section.appendChild(header);

		const list = document.createElement("div");
		list.className = "custom-abilities__list";

		for (const ability of abilities) {
			list.appendChild(this._buildAbilityCard(ability, category));
		}

		section.appendChild(list);
		return section;
	}

	/**
	 * Build a card for a single ability
	 */
	_buildAbilityCard (ability, category) {
		const card = document.createElement("div");
		card.className = `custom-abilities__card ${ability.mode === "toggleable" && ability.isActive ? "custom-abilities__card--active" : ""}`;
		card.dataset.abilityId = ability.id;

		// Header row
		const header = document.createElement("div");
		header.className = "custom-abilities__card-header";
		
		// Build badges HTML
		const badgesHtml = [];
		badgesHtml.push(`<span class="custom-abilities__mode-badge custom-abilities__mode-badge--${ability.mode}">
			${ability.mode === "passive" ? "Passive" : ability.mode === "toggleable" ? "Toggle" : "Limited"}
		</span>`);
		
		// Activation action badge (for non-passive, non-free)
		if (ability.activationAction && ability.activationAction !== "free") {
			const actionLabels = {action: "Action", bonus: "Bonus Action", reaction: "Reaction", special: "Special"};
			const actionIcons = {action: "🔷", bonus: "🔶", reaction: "⚡", special: "⭐"};
			badgesHtml.push(`<span class="custom-abilities__action-badge custom-abilities__action-badge--${ability.activationAction}">
				${actionIcons[ability.activationAction] || ""} ${actionLabels[ability.activationAction] || ability.activationAction}
			</span>`);
		}
		
		// Duration badge (for toggleable with duration)
		if (ability.mode === "toggleable" && ability.duration) {
			badgesHtml.push(`<span class="custom-abilities__duration-badge">⏱️ ${ability.duration}</span>`);
		}
		
		// Concentration badge
		if (ability.concentration) {
			badgesHtml.push(`<span class="custom-abilities__concentration-badge">🔮 Concentration</span>`);
		}
		
		header.innerHTML = `
			<span class="custom-abilities__card-icon" style="color: ${category.color}">${ability.icon || category.icon}</span>
			<span class="custom-abilities__card-name">${ability.name}</span>
			<div class="custom-abilities__card-badges">${badgesHtml.join("")}</div>
		`;
		card.appendChild(header);

		// Description
		if (ability.description) {
			const desc = document.createElement("div");
			desc.className = "custom-abilities__card-description";
			// Render with 5etools renderer if available
			try {
				desc.innerHTML = Renderer.get().render(ability.description);
			} catch {
				desc.textContent = ability.description;
			}
			card.appendChild(desc);
		}

		// Effects summary
		if (ability.effects?.length) {
			const effects = document.createElement("div");
			effects.className = "custom-abilities__card-effects";
			const summaries = ability.effects.slice(0, 4).map(e => this._formatEffectSummary(e));
			effects.innerHTML = summaries.join(", ") + (ability.effects.length > 4 ? ` <span class="ve-muted">+${ability.effects.length - 4} more</span>` : "");
			card.appendChild(effects);
		}

		// Grants summary
		if (ability.grants) {
			const grantsSummary = this._formatGrantsSummary(ability.grants);
			if (grantsSummary) {
				const grantsDiv = document.createElement("div");
				grantsDiv.className = "custom-abilities__card-grants";
				grantsDiv.innerHTML = `<span class="custom-abilities__grants-badge">🎁</span> ${grantsSummary}`;
				card.appendChild(grantsDiv);
			}
		}

		// Defensive traits summary
		if (ability.defensiveTraits) {
			const traitsSummary = this._formatDefensiveTraitsSummary(ability.defensiveTraits);
			if (traitsSummary) {
				const traitsDiv = document.createElement("div");
				traitsDiv.className = "custom-abilities__card-defensive";
				traitsDiv.innerHTML = traitsSummary;
				card.appendChild(traitsDiv);
			}
		}

		// Controls row
		const controls = document.createElement("div");
		controls.className = "custom-abilities__card-controls";

		// Left side: mode-specific controls
		const leftControls = document.createElement("div");
		leftControls.className = "custom-abilities__card-controls-left";

		if (ability.mode === "toggleable") {
			const toggleBtn = document.createElement("button");
			toggleBtn.className = `custom-abilities__toggle-btn ${ability.isActive ? "custom-abilities__toggle-btn--active" : ""}`;
			toggleBtn.innerHTML = ability.isActive ? "✓ Active" : "○ Inactive";
			toggleBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this._toggleAbility(ability.id);
			});
			leftControls.appendChild(toggleBtn);
		} else if (ability.mode === "limited" && ability.uses) {
			const usesDiv = document.createElement("div");
			usesDiv.className = "custom-abilities__uses";
			usesDiv.innerHTML = `
				<button class="custom-abilities__use-btn" ${ability.uses.current <= 0 ? "disabled" : ""}>Use</button>
				<span class="custom-abilities__use-counter">${ability.uses.current}/${ability.uses.max}</span>
				<span class="custom-abilities__recharge" title="${ability.uses.recharge === "short" ? "Recharges on Short Rest" : "Recharges on Long Rest"}">
					${ability.uses.recharge === "short" ? "⚡SR" : "🌙LR"}
				</span>
			`;
			usesDiv.querySelector(".custom-abilities__use-btn").addEventListener("click", (e) => {
				e.stopPropagation();
				this._useAbility(ability.id);
			});
			leftControls.appendChild(usesDiv);
		}

		controls.appendChild(leftControls);

		// Right side: duplicate/edit/delete
		const rightControls = document.createElement("div");
		rightControls.className = "custom-abilities__card-controls-right";
		rightControls.innerHTML = `
			<button class="custom-abilities__action-btn custom-abilities__action-btn--duplicate" title="Duplicate">📋</button>
			<button class="custom-abilities__action-btn custom-abilities__action-btn--edit" title="Edit">✏️</button>
			<button class="custom-abilities__action-btn custom-abilities__action-btn--delete" title="Delete">🗑️</button>
		`;
		rightControls.querySelector(".custom-abilities__action-btn--duplicate").addEventListener("click", (e) => {
			e.stopPropagation();
			this._duplicateAbility(ability.id);
		});
		rightControls.querySelector(".custom-abilities__action-btn--edit").addEventListener("click", (e) => {
			e.stopPropagation();
			this._showAbilityModal(ability.id);
		});
		rightControls.querySelector(".custom-abilities__action-btn--delete").addEventListener("click", (e) => {
			e.stopPropagation();
			this._confirmDelete(ability.id, ability.name);
		});
		controls.appendChild(rightControls);

		card.appendChild(controls);

		// Click card to expand/view
		card.addEventListener("click", () => this._showAbilityModal(ability.id));

		return card;
	}

	/**
	 * Format an effect for display
	 */
	_formatEffectSummary (effect) {
		const typeInfo = this._getEffectTypeInfo(effect.type);
		const label = typeInfo?.label || effect.type;

		const parts = [];
		if (effect.value != null && effect.value !== 0) {
			const val = effect.value >= 0 ? `+${effect.value}` : effect.value;
			parts.push(`<span class="${effect.value >= 0 ? "text-success" : "text-danger"}">${val}</span>`);
		}
		if (effect.advantage) parts.push(`<span class="text-success">Adv</span>`);
		if (effect.disadvantage) parts.push(`<span class="text-danger">Dis</span>`);
		if (effect.setMinimum != null) parts.push(`<span class="ve-muted">Min:${effect.setMinimum}</span>`);
		if (effect.bonusDie) parts.push(`<span class="text-info">+${effect.bonusDie}</span>`);

		return `${label}${parts.length ? " " + parts.join(" ") : ""}`;
	}

	/**
	 * Format grants for display summary
	 */
	_formatGrantsSummary (grants) {
		if (!grants) return "";

		const parts = [];

		// Spells
		if (grants.spells?.length) {
			const spellNames = grants.spells.slice(0, 2).map(s => s.name);
			const spellStr = spellNames.join(", ") + (grants.spells.length > 2 ? ` +${grants.spells.length - 2}` : "");
			parts.push(`<span class="text-info">✨${spellStr}</span>`);
		}

		// Features
		if (grants.features?.length) {
			const featNames = grants.features.slice(0, 2).map(f => f.name);
			const featStr = featNames.join(", ") + (grants.features.length > 2 ? ` +${grants.features.length - 2}` : "");
			parts.push(`<span class="text-warning">⚔️${featStr}</span>`);
		}

		// Proficiencies
		const profs = grants.proficiencies;
		if (profs) {
			const profParts = [];
			if (profs.skills?.length) profParts.push(`${profs.skills.length} skill${profs.skills.length > 1 ? "s" : ""}`);
			if (profs.tools?.length) profParts.push(`${profs.tools.length} tool${profs.tools.length > 1 ? "s" : ""}`);
			if (profs.languages?.length) profParts.push(`${profs.languages.length} lang${profs.languages.length > 1 ? "s" : ""}`);
			if (profs.weapons?.length) profParts.push(`weapons`);
			if (profs.armor?.length) profParts.push(`armor`);
			if (profParts.length) {
				parts.push(`<span class="text-success">📚${profParts.join(", ")}</span>`);
			}
		}

		return parts.join(" · ");
	}

	/**
	 * Format defensive traits for display summary
	 */
	_formatDefensiveTraitsSummary (traits) {
		if (!traits) return "";

		const parts = [];

		// Resistances (yellow)
		if (traits.resistances?.length) {
			const items = traits.resistances.slice(0, 2).join(", ");
			const more = traits.resistances.length > 2 ? ` +${traits.resistances.length - 2}` : "";
			parts.push(`<span class="text-warning">🛡️ Resist: ${items}${more}</span>`);
		}

		// Immunities (green)
		if (traits.immunities?.length) {
			const items = traits.immunities.slice(0, 2).join(", ");
			const more = traits.immunities.length > 2 ? ` +${traits.immunities.length - 2}` : "";
			parts.push(`<span class="text-success">🛡️ Immune: ${items}${more}</span>`);
		}

		// Vulnerabilities (red)
		if (traits.vulnerabilities?.length) {
			const items = traits.vulnerabilities.slice(0, 2).join(", ");
			const more = traits.vulnerabilities.length > 2 ? ` +${traits.vulnerabilities.length - 2}` : "";
			parts.push(`<span class="text-danger">⚠️ Vulnerable: ${items}${more}</span>`);
		}

		// Condition immunities (purple)
		if (traits.conditionImmunities?.length) {
			const items = traits.conditionImmunities.slice(0, 2).join(", ");
			const more = traits.conditionImmunities.length > 2 ? ` +${traits.conditionImmunities.length - 2}` : "";
			parts.push(`<span class="custom-abilities__condition-immune">🚫 ${items}${more}</span>`);
		}

		return parts.join(" · ");
	}

	/**
	 * Get effect type info from the modifier groups
	 */
	_getEffectTypeInfo (type) {
		for (const group of this._getModifierGroups()) {
			const opt = group.options.find(o => o.value === type);
			if (opt) return {label: opt.label, group: group.group};
		}
		return null;
	}

	/**
	 * Get modifier groups (same as modifiers modal)
	 */
	_getModifierGroups () {
		const skills = this._sheet.getSkillsList?.() || [];
		return [
			{
				group: "⭐ Global",
				options: [
					{value: "d20:all", label: "All d20 Rolls"},
				],
			},
			{
				group: "🛡️ Combat",
				options: [
					{value: "ac", label: "Armor Class (AC)"},
					{value: "initiative", label: "Initiative"},
					{value: "attack", label: "Attack Rolls (All)"},
					{value: "attack:melee", label: "Melee Attack Rolls"},
					{value: "attack:ranged", label: "Ranged Attack Rolls"},
					{value: "attack:weapon", label: "Weapon Attack Rolls"},
					{value: "attack:spell", label: "Spell Attack Rolls"},
					{value: "damage", label: "Damage Rolls (All)"},
					{value: "damage:melee", label: "Melee Damage"},
					{value: "damage:ranged", label: "Ranged Damage"},
					{value: "damage:weapon", label: "Weapon Damage"},
					{value: "damage:spell", label: "Spell Damage"},
					{value: "critRange", label: "Critical Hit Range (Set)"},
					{value: "critRange:expand", label: "Critical Hit Range (Expand)"},
				],
			},
			{
				group: "👟 Movement",
				options: [
					{value: "speed", label: "Speed (All)"},
					{value: "speed:walk", label: "Walking Speed"},
					{value: "speed:fly", label: "Flying Speed"},
					{value: "speed:swim", label: "Swimming Speed"},
					{value: "speed:climb", label: "Climbing Speed"},
					{value: "speed:burrow", label: "Burrowing Speed"},
				],
			},
			{
				group: "✨ Spellcasting",
				options: [
					{value: "spellDc", label: "Spell Save DC"},
					{value: "spellAttack", label: "Spell Attack Bonus"},
					{value: "concentration", label: "Concentration Saves"},
				],
			},
			{
				group: "💪 Saving Throws",
				options: [
					{value: "save:all", label: "All Saving Throws"},
					{value: "save:str", label: "Strength Save"},
					{value: "save:dex", label: "Dexterity Save"},
					{value: "save:con", label: "Constitution Save"},
					{value: "save:int", label: "Intelligence Save"},
					{value: "save:wis", label: "Wisdom Save"},
					{value: "save:cha", label: "Charisma Save"},
				],
			},
			{
				group: "🎲 Ability Checks",
				options: [
					{value: "check:all", label: "All Ability Checks"},
					{value: "check:str", label: "Strength Checks"},
					{value: "check:dex", label: "Dexterity Checks"},
					{value: "check:con", label: "Constitution Checks"},
					{value: "check:int", label: "Intelligence Checks"},
					{value: "check:wis", label: "Wisdom Checks"},
					{value: "check:cha", label: "Charisma Checks"},
				],
			},
			{
				group: "📚 Skills",
				options: [
					{value: "skill:all", label: "All Skill Checks"},
					...skills.map(skill => {
						const key = skill.name.toLowerCase().replace(/\s+/g, "");
						return {value: `skill:${key}`, label: `${skill.name} (${skill.ability?.toUpperCase() || "—"})`};
					}),
				],
			},
			{
				group: "👁️ Passive Scores",
				options: [
					{value: "passive:all", label: "All Passive Scores"},
					...skills.map(skill => {
						const key = skill.name.toLowerCase().replace(/\s+/g, "");
						return {value: `passive:${key}`, label: `Passive ${skill.name}`};
					}),
				],
			},
			{
				group: "❤️ Hit Points",
				options: [
					{value: "hp:max", label: "HP Maximum"},
					{value: "hp:temp", label: "Temp HP"},
				],
			},
			{
				group: "📊 Ability Scores",
				options: [
					{value: "ability:str", label: "Strength Score"},
					{value: "ability:dex", label: "Dexterity Score"},
					{value: "ability:con", label: "Constitution Score"},
					{value: "ability:int", label: "Intelligence Score"},
					{value: "ability:wis", label: "Wisdom Score"},
					{value: "ability:cha", label: "Charisma Score"},
				],
			},
			{
				group: "🌙 Senses",
				options: [
					{value: "sense:darkvision", label: "Darkvision"},
					{value: "sense:blindsight", label: "Blindsight"},
					{value: "sense:tremorsense", label: "Tremorsense"},
					{value: "sense:truesight", label: "Truesight"},
				],
			},
			{
				group: "�️ Resistances",
				options: [
					{value: "resistance:fire", label: "Fire Resistance"},
					{value: "resistance:cold", label: "Cold Resistance"},
					{value: "resistance:lightning", label: "Lightning Resistance"},
					{value: "resistance:thunder", label: "Thunder Resistance"},
					{value: "resistance:acid", label: "Acid Resistance"},
					{value: "resistance:poison", label: "Poison Resistance"},
					{value: "resistance:necrotic", label: "Necrotic Resistance"},
					{value: "resistance:radiant", label: "Radiant Resistance"},
					{value: "resistance:psychic", label: "Psychic Resistance"},
					{value: "resistance:force", label: "Force Resistance"},
					{value: "resistance:bludgeoning", label: "Bludgeoning Resistance"},
					{value: "resistance:piercing", label: "Piercing Resistance"},
					{value: "resistance:slashing", label: "Slashing Resistance"},
				],
			},
			{
				group: "🔰 Immunities",
				options: [
					{value: "immunity:fire", label: "Fire Immunity"},
					{value: "immunity:cold", label: "Cold Immunity"},
					{value: "immunity:lightning", label: "Lightning Immunity"},
					{value: "immunity:thunder", label: "Thunder Immunity"},
					{value: "immunity:acid", label: "Acid Immunity"},
					{value: "immunity:poison", label: "Poison Immunity"},
					{value: "immunity:necrotic", label: "Necrotic Immunity"},
					{value: "immunity:radiant", label: "Radiant Immunity"},
					{value: "immunity:psychic", label: "Psychic Immunity"},
					{value: "immunity:force", label: "Force Immunity"},
					{value: "immunity:bludgeoning", label: "Bludgeoning Immunity"},
					{value: "immunity:piercing", label: "Piercing Immunity"},
					{value: "immunity:slashing", label: "Slashing Immunity"},
				],
			},
			{
				group: "⚠️ Vulnerabilities",
				options: [
					{value: "vulnerability:fire", label: "Fire Vulnerability"},
					{value: "vulnerability:cold", label: "Cold Vulnerability"},
					{value: "vulnerability:lightning", label: "Lightning Vulnerability"},
					{value: "vulnerability:thunder", label: "Thunder Vulnerability"},
					{value: "vulnerability:acid", label: "Acid Vulnerability"},
					{value: "vulnerability:poison", label: "Poison Vulnerability"},
					{value: "vulnerability:necrotic", label: "Necrotic Vulnerability"},
					{value: "vulnerability:radiant", label: "Radiant Vulnerability"},
					{value: "vulnerability:psychic", label: "Psychic Vulnerability"},
					{value: "vulnerability:force", label: "Force Vulnerability"},
					{value: "vulnerability:bludgeoning", label: "Bludgeoning Vulnerability"},
					{value: "vulnerability:piercing", label: "Piercing Vulnerability"},
					{value: "vulnerability:slashing", label: "Slashing Vulnerability"},
				],
			},
			{
				group: "🚫 Condition Immunities",
				options: [
					{value: "conditionImmunity:charmed", label: "Immunity to Charmed"},
					{value: "conditionImmunity:frightened", label: "Immunity to Frightened"},
					{value: "conditionImmunity:poisoned", label: "Immunity to Poisoned"},
					{value: "conditionImmunity:paralyzed", label: "Immunity to Paralyzed"},
					{value: "conditionImmunity:stunned", label: "Immunity to Stunned"},
					{value: "conditionImmunity:petrified", label: "Immunity to Petrified"},
					{value: "conditionImmunity:blinded", label: "Immunity to Blinded"},
					{value: "conditionImmunity:deafened", label: "Immunity to Deafened"},
					{value: "conditionImmunity:prone", label: "Immunity to Prone"},
					{value: "conditionImmunity:grappled", label: "Immunity to Grappled"},
					{value: "conditionImmunity:restrained", label: "Immunity to Restrained"},
					{value: "conditionImmunity:incapacitated", label: "Immunity to Incapacitated"},
					{value: "conditionImmunity:exhaustion", label: "Immunity to Exhaustion"},
				],
			},
			{
				group: "📈 Miscellaneous",
				options: [
					{value: "proficiencyBonus", label: "Proficiency Bonus"},
					{value: "carryCapacity", label: "Carry Capacity"},
					{value: "deathSave", label: "Death Saving Throws"},
				],
			},
		];
	}

	/**
	 * Get HTML options for class level selector
	 */
	_getClassOptionsHtml (state, selectedClass) {
		// Common PHB classes as fallback
		const commonClasses = ["Artificer", "Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard"];
		
		// Get character's actual classes
		const characterClasses = (state.getClasses?.() || []).map(c => c.name).filter(Boolean);
		
		// Combine and dedupe, prioritizing character classes
		const allClasses = [...new Set([...characterClasses, ...commonClasses])];
		
		return allClasses.map(className => 
			`<option value="${className}" ${className === selectedClass ? "selected" : ""}>${className}</option>`,
		).join("");
	}

	_toggleAbility (id) {
		const state = this._sheet.getState();
		state.toggleCustomAbility(id);
		this.render();
		this._sheet._updateAllCalculations?.();
		this._sheet._renderActiveStates?.();
		this._sheet._renderOverviewAbilities?.();
		this._sheet._combatModule?.renderCombatStates?.();
		this._sheet._combat?.renderCombatActions?.();
		this._sheet._renderCharacter?.(); // Update size/reach display
		this._sheet._saveCurrentCharacter?.();
	}

	_useAbility (id) {
		const state = this._sheet.getState();
		if (state.useCustomAbility(id)) {
			this.render();
			this._sheet._updateAllCalculations?.();
			this._sheet._renderOverviewAbilities?.();
			this._sheet._renderResources?.();
			this._sheet._combat?.renderCombatActions?.();
			this._sheet._saveCurrentCharacter?.();
		}
	}

	async _confirmDelete (id, name) {
		const doDelete = await InputUiUtil.pGetUserBoolean({
			title: "Delete Custom Ability",
			htmlDescription: `<p>Delete "${name}"? This cannot be undone.</p>`,
			textYes: "Delete",
			textNo: "Cancel",
		});
		if (!doDelete) return;
		const state = this._sheet.getState();
		if (state.removeCustomAbility(id)) {
			this.render();
			this._sheet._updateAllCalculations?.();
			this._sheet._renderOverviewAbilities?.();
			this._sheet._renderResources?.();
			this._sheet._combat?.renderCombatActions?.();
			this._sheet._saveCurrentCharacter?.();
		}
	}

	/**
	 * Duplicate an existing ability
	 */
	_duplicateAbility (id) {
		const state = this._sheet.getState();
		const original = state.getCustomAbility(id);
		if (!original) return;

		// Deep clone the ability
		const cloned = JSON.parse(JSON.stringify(original));
		
		// Remove id and reset state
		delete cloned.id;
		cloned.name = `${cloned.name} (Copy)`;
		cloned.isActive = false;
		if (cloned.uses) {
			cloned.uses.current = cloned.uses.max;
		}

		// Add as new ability
		const newId = state.addCustomAbility(cloned);
		
		if (newId) {
			this.render();
			this._sheet._updateAllCalculations?.();
			this._sheet._renderOverviewAbilities?.();
			this._sheet._renderResources?.();
			this._sheet._combat?.renderCombatActions?.();
			this._sheet._saveCurrentCharacter?.();
			
			// Open the modal for editing the new copy
			this._showAbilityModal(newId);
		}
	}

	/**
	 * Show the ability create/edit modal
	 */
	_showAbilityModal (abilityId) {
		const state = this._sheet.getState();
		const existingAbility = abilityId ? state.getCustomAbility(abilityId) : null;
		const isEditing = !!existingAbility;

		// Build optgroup HTML for effect types
		const typeOptionsHtml = this._getModifierGroups().map(group => {
			const opts = group.options.map(o => `<option value="${o.value}">${o.label}</option>`).join("");
			return `<optgroup label="${group.group}">${opts}</optgroup>`;
		}).join("");

		// Category options
		const categories = CharacterSheetState.CUSTOM_ABILITY_CATEGORIES;
		const categoryOptionsHtml = Object.entries(categories).map(([id, cat]) =>
			`<option value="${id}" ${existingAbility?.category === id ? "selected" : ""}>${cat.icon} ${cat.name}</option>`,
		).join("");

		// Build resource pool options for linking
		const resources = state.getResources?.() || [];
		const hasStamina = state.usesCombatSystem?.() && (state.getStaminaMax?.() || 0) > 0;
		const resourceOptionsHtml = [
			hasStamina ? `<option value="stamina" ${existingAbility?.resourceSource?.resourceId === "stamina" ? "selected" : ""}>Stamina</option>` : "",
			...resources.map(r => `<option value="${r.id}" ${existingAbility?.resourceSource?.resourceId === r.id ? "selected" : ""}>${r.name}</option>`),
		].filter(Boolean).join("");

		// Create modal
		const modal = document.createElement("div");
		modal.className = "custom-abilities__modal modal-overlay";
		modal.innerHTML = `
			<div class="custom-abilities__modal-content modal-content">
				<div class="modal-header">
					<h4 class="modal-title">${isEditing ? "Edit" : "Create"} Custom Ability</h4>
					<button class="modal-close" title="Close">&times;</button>
				</div>
				<div class="custom-abilities__modal-body modal-body">
					<!-- Mode selector: Simple or Advanced -->
					<div class="custom-abilities__editor-mode-toggle">
						<button class="custom-abilities__editor-mode-btn custom-abilities__editor-mode-btn--active" data-mode="simple">
							🎯 Simple Mode
						</button>
						<button class="custom-abilities__editor-mode-btn" data-mode="advanced">
							⚙️ Advanced Mode
						</button>
					</div>

					<!-- Simple Mode -->
					<div class="custom-abilities__editor-simple" data-editor="simple">
						<!-- Basic Info -->
						<div class="custom-abilities__form-section">
							<div class="custom-abilities__form-row">
								<div class="custom-abilities__form-field" style="flex: 2;">
									<label>Name <span class="text-danger">*</span></label>
									<input type="text" class="ve-form-control" name="name" placeholder="e.g., Blessing of the Sun God" value="${existingAbility?.name || ""}">
								</div>
								<div class="custom-abilities__form-field custom-abilities__icon-field">
									<label>Icon</label>
									<div class="custom-abilities__icon-picker">
										<button type="button" class="custom-abilities__icon-preview" title="Click to choose icon">
											${existingAbility?.icon || "⚡"}
										</button>
										<div class="custom-abilities__icon-dropdown">
											<div class="custom-abilities__icon-grid">
												${this._getIconOptions().map(icon => `<button type="button" class="custom-abilities__icon-option" data-icon="${icon}">${icon}</button>`).join("")}
											</div>
											<div class="custom-abilities__icon-custom">
												<input type="text" class="ve-form-control" placeholder="Or paste emoji..." maxlength="2">
											</div>
										</div>
									</div>
									<input type="hidden" name="icon" value="${existingAbility?.icon || "⚡"}">
								</div>
								<div class="custom-abilities__form-field">
									<label>Category</label>
									<select class="ve-form-control" name="category">${categoryOptionsHtml}</select>
								</div>
							</div>

							<div class="custom-abilities__form-field">
								<label>Description</label>
								<textarea class="ve-form-control" name="description" rows="3" placeholder="What does this ability do? (Supports 5etools tags like {@dice 2d6})">${existingAbility?.description || ""}</textarea>
							</div>
						</div>

						<!-- Activation Mode -->
						<div class="custom-abilities__form-section">
							<label class="custom-abilities__form-section-title">Activation Mode</label>
							<div class="custom-abilities__mode-options">
								<label class="custom-abilities__mode-option">
									<input type="radio" name="mode" value="passive" ${(!existingAbility || existingAbility.mode === "passive") ? "checked" : ""}>
									<div class="custom-abilities__mode-option-content">
										<strong>Passive</strong>
										<span>Always active - effects apply permanently</span>
									</div>
								</label>
								<label class="custom-abilities__mode-option">
									<input type="radio" name="mode" value="toggleable" ${existingAbility?.mode === "toggleable" ? "checked" : ""}>
									<div class="custom-abilities__mode-option-content">
										<strong>Toggleable</strong>
										<span>Can be turned on/off (e.g., Rage, Bladesong)</span>
									</div>
								</label>
								<label class="custom-abilities__mode-option">
									<input type="radio" name="mode" value="limited" ${existingAbility?.mode === "limited" ? "checked" : ""}>
									<div class="custom-abilities__mode-option-content">
										<strong>Limited Uses</strong>
										<span>Has charges that recharge on rest</span>
									</div>
								</label>
							</div>
							<div class="custom-abilities__limited-options" style="display: ${existingAbility?.mode === "limited" ? "flex" : "none"};">
								<div class="custom-abilities__form-field custom-abilities__resource-source-field">
									<label>Resource Source</label>
									<select class="ve-form-control" name="resourceSource">
										<option value="self" ${!existingAbility?.resourceSource?.type || existingAbility?.resourceSource?.type === "self" ? "selected" : ""}>Self-contained Uses</option>
										<option value="linked" ${existingAbility?.resourceSource?.type === "linked" ? "selected" : ""}>Link to Existing Resource</option>
										<option value="new" ${existingAbility?.resourceSource?.type === "new" ? "selected" : ""}>Create New Resource Pool</option>
									</select>
								</div>
								<div class="custom-abilities__self-uses-options" style="display: ${!existingAbility?.resourceSource?.type || existingAbility?.resourceSource?.type === "self" ? "flex" : "none"};">
									<div class="custom-abilities__form-field">
										<label>Max Uses</label>
										<input type="number" class="ve-form-control" name="maxUses" min="1" value="${existingAbility?.uses?.max || 1}">
									</div>
									<div class="custom-abilities__form-field">
										<label>Recharges On</label>
										<select class="ve-form-control" name="recharge">
											<option value="long" ${existingAbility?.uses?.recharge !== "short" ? "selected" : ""}>🌙 Long Rest</option>
											<option value="short" ${existingAbility?.uses?.recharge === "short" ? "selected" : ""}>⚡ Short Rest</option>
										</select>
									</div>
								</div>
								<div class="custom-abilities__linked-resource-options" style="display: ${existingAbility?.resourceSource?.type === "linked" ? "flex" : "none"};">
									<div class="custom-abilities__form-field" style="flex: 2;">
										<label>Resource Pool</label>
										<select class="ve-form-control" name="linkedResourceId">
											${resourceOptionsHtml || '<option value="" disabled>No resources available</option>'}
										</select>
									</div>
									<div class="custom-abilities__form-field">
										<label>Cost</label>
										<input type="number" class="ve-form-control" name="linkedResourceCost" min="1" value="${existingAbility?.resourceSource?.cost || 1}">
									</div>
								</div>
								<div class="custom-abilities__new-resource-options" style="display: ${existingAbility?.resourceSource?.type === "new" ? "flex" : "none"};">
									<div class="custom-abilities__form-field" style="flex: 2;">
										<label>Resource Name</label>
										<input type="text" class="ve-form-control" name="newResourceName" placeholder="e.g., Divine Charges" value="${existingAbility?.resourceSource?.newResourceName || ""}">
									</div>
									<div class="custom-abilities__form-field">
										<label>Max</label>
										<input type="number" class="ve-form-control" name="newResourceMax" min="1" value="${existingAbility?.resourceSource?.newResourceMax || 3}">
									</div>
									<div class="custom-abilities__form-field">
										<label>Recharges</label>
										<select class="ve-form-control" name="newResourceRecharge">
											<option value="long" ${existingAbility?.resourceSource?.newResourceRecharge !== "short" ? "selected" : ""}>🌙 Long</option>
											<option value="short" ${existingAbility?.resourceSource?.newResourceRecharge === "short" ? "selected" : ""}>⚡ Short</option>
										</select>
									</div>
								</div>
							</div>
							<div class="custom-abilities__activation-options" style="display: ${existingAbility?.mode && existingAbility.mode !== "passive" ? "flex" : "none"};">
								<div class="custom-abilities__form-field">
									<label>Activation</label>
									<select class="ve-form-control" name="activationAction">
										<option value="free" ${!existingAbility?.activationAction || existingAbility?.activationAction === "free" ? "selected" : ""}>Free (No Action)</option>
										<option value="action" ${existingAbility?.activationAction === "action" ? "selected" : ""}>Action</option>
										<option value="bonus" ${existingAbility?.activationAction === "bonus" ? "selected" : ""}>Bonus Action</option>
										<option value="reaction" ${existingAbility?.activationAction === "reaction" ? "selected" : ""}>Reaction</option>
										<option value="special" ${existingAbility?.activationAction === "special" ? "selected" : ""}>Special</option>
									</select>
								</div>
							</div>
							<div class="custom-abilities__duration-options" style="display: ${existingAbility?.mode === "toggleable" ? "flex" : "none"};">
								<div class="custom-abilities__form-field">
									<label>Duration</label>
									<select class="ve-form-control" name="duration">
										<option value="" ${!existingAbility?.duration ? "selected" : ""}>Until Toggled Off</option>
										<option value="1 round" ${existingAbility?.duration === "1 round" ? "selected" : ""}>1 Round</option>
										<option value="1 minute" ${existingAbility?.duration === "1 minute" ? "selected" : ""}>1 Minute</option>
										<option value="10 minutes" ${existingAbility?.duration === "10 minutes" ? "selected" : ""}>10 Minutes</option>
										<option value="1 hour" ${existingAbility?.duration === "1 hour" ? "selected" : ""}>1 Hour</option>
										<option value="8 hours" ${existingAbility?.duration === "8 hours" ? "selected" : ""}>8 Hours</option>
										<option value="24 hours" ${existingAbility?.duration === "24 hours" ? "selected" : ""}>24 Hours</option>
										<option value="until rest" ${existingAbility?.duration === "until rest" ? "selected" : ""}>Until Rest</option>
									</select>
								</div>
								<div class="custom-abilities__form-field custom-abilities__concentration-field">
									<label class="custom-abilities__checkbox-label">
										<input type="checkbox" name="concentration" ${existingAbility?.concentration ? "checked" : ""}>
										<span>Requires Concentration</span>
									</label>
									<span class="ve-muted ve-small">Ends if you lose concentration or concentrate on something else</span>
								</div>
							</div>
							<div class="custom-abilities__toggleable-resource-options" style="display: ${existingAbility?.mode === "toggleable" ? "block" : "none"};">
								<div class="custom-abilities__form-field">
									<label class="custom-abilities__checkbox-label">
										<input type="checkbox" name="hasResourceCost" ${existingAbility?.resourceCost ? "checked" : ""}>
										<span>Costs a Resource to Activate</span>
									</label>
								</div>
								<div class="custom-abilities__toggleable-resource-details" style="display: ${existingAbility?.resourceCost ? "flex" : "none"};">
									<div class="custom-abilities__form-field" style="flex: 2;">
										<label>Resource Pool</label>
										<select class="ve-form-control" name="toggleResourceId">
											${resourceOptionsHtml || '<option value="" disabled>No resources available</option>'}
										</select>
									</div>
									<div class="custom-abilities__form-field">
										<label>Cost</label>
										<input type="number" class="ve-form-control" name="toggleResourceCost" min="1" value="${existingAbility?.resourceCost?.cost || 1}">
									</div>
								</div>
							</div>
						</div>

						<!-- Effects -->
						<div class="custom-abilities__form-section">
							<div class="custom-abilities__effects-header">
								<label class="custom-abilities__form-section-title">Effects (Optional)</label>
								<button class="btn btn-sm btn-primary custom-abilities__add-effect-btn">+ Add Effect</button>
							</div>
							<p class="ve-muted ve-small mb-2">Add mechanical effects that this ability grants. Leave empty for flavor-only features.</p>
							<div class="custom-abilities__effects-list" id="ability-effects-list">
								<!-- Rendered dynamically -->
							</div>
						</div>

						<!-- Defensive Traits -->
						<div class="custom-abilities__form-section">
							<label class="custom-abilities__form-section-title">Defensive Traits (Optional)</label>
							<p class="ve-muted ve-small mb-2">Grant resistance, immunity, or vulnerability to damage types and conditions</p>
							
							<details class="custom-abilities__grants-section">
								<summary><span class="custom-abilities__grants-icon">🛡️</span> Damage Resistances <span class="custom-abilities__grants-count" id="defensive-resistances-count"></span></summary>
								<div class="custom-abilities__grants-content">
									<div class="custom-abilities__defensive-pills" id="defensive-resistances"></div>
									<div class="custom-abilities__grants-prof-add mt-1">
										<input type="text" class="ve-form-control" placeholder="Custom damage type..." id="defensive-resistance-custom">
										<button type="button" class="btn btn-xs btn-primary" id="defensive-resistance-add">+ Add</button>
									</div>
								</div>
							</details>
							
							<details class="custom-abilities__grants-section">
								<summary><span class="custom-abilities__grants-icon">🔰</span> Damage Immunities <span class="custom-abilities__grants-count" id="defensive-immunities-count"></span></summary>
								<div class="custom-abilities__grants-content">
									<div class="custom-abilities__defensive-pills" id="defensive-immunities"></div>
									<div class="custom-abilities__grants-prof-add mt-1">
										<input type="text" class="ve-form-control" placeholder="Custom damage type..." id="defensive-immunity-custom">
										<button type="button" class="btn btn-xs btn-primary" id="defensive-immunity-add">+ Add</button>
									</div>
								</div>
							</details>
							
							<details class="custom-abilities__grants-section">
								<summary><span class="custom-abilities__grants-icon">⚠️</span> Damage Vulnerabilities <span class="custom-abilities__grants-count" id="defensive-vulnerabilities-count"></span></summary>
								<div class="custom-abilities__grants-content">
									<div class="custom-abilities__defensive-pills" id="defensive-vulnerabilities"></div>
									<div class="custom-abilities__grants-prof-add mt-1">
										<input type="text" class="ve-form-control" placeholder="Custom damage type..." id="defensive-vulnerability-custom">
										<button type="button" class="btn btn-xs btn-primary" id="defensive-vulnerability-add">+ Add</button>
									</div>
								</div>
							</details>
							
							<details class="custom-abilities__grants-section">
								<summary><span class="custom-abilities__grants-icon">🚫</span> Condition Immunities <span class="custom-abilities__grants-count" id="defensive-conditions-count"></span></summary>
								<div class="custom-abilities__grants-content">
									<div class="custom-abilities__defensive-pills" id="defensive-conditions"></div>
									<div class="custom-abilities__grants-prof-add mt-1">
										<input type="text" class="ve-form-control" placeholder="Custom condition..." id="defensive-condition-custom">
										<button type="button" class="btn btn-xs btn-primary" id="defensive-condition-add">+ Add</button>
									</div>
								</div>
							</details>
						</div>

						<!-- Size & Movement -->
						<div class="custom-abilities__form-section">
							<label class="custom-abilities__form-section-title">Size & Movement (Optional)</label>
							<p class="ve-muted ve-small mb-2">Modify creature size (affects carry capacity) or melee reach</p>
							
							<div class="custom-abilities__size-reach-row">
								<div class="custom-abilities__size-section">
									<label class="ve-small ve-muted">Size Change (categories)</label>
									<div class="custom-abilities__size-control">
										<button type="button" class="btn btn-xs custom-abilities__size-dec" title="Decrease size">−</button>
										<span class="custom-abilities__size-value" id="size-value">0</span>
										<button type="button" class="btn btn-xs custom-abilities__size-inc" title="Increase size">+</button>
									</div>
									<span class="ve-muted ve-small custom-abilities__size-preview" id="size-preview"></span>
								</div>
								<div class="custom-abilities__reach-section">
									<label class="ve-small ve-muted">Reach Bonus (feet)</label>
									<div class="custom-abilities__reach-control">
										<button type="button" class="btn btn-xs custom-abilities__reach-dec" title="Decrease reach">−</button>
										<span class="custom-abilities__reach-value" id="reach-value">0</span>
										<button type="button" class="btn btn-xs custom-abilities__reach-inc" title="Increase reach">+</button>
									</div>
									<span class="ve-muted ve-small">Each increment = +5 ft melee reach</span>
								</div>
							</div>
						</div>

						<!-- Temporary HP -->
						<div class="custom-abilities__form-section">
							<label class="custom-abilities__form-section-title">Temporary HP (Optional)</label>
							<p class="ve-muted ve-small mb-2">Grant temporary hit points (like False Life, Inspiring Leader, Armor of Agathys)</p>
							
							<div class="custom-abilities__temphp-section" id="temphp-section">
								<label class="custom-abilities__temphp-toggle">
									<input type="checkbox" id="temphp-enabled" name="tempHpEnabled">
									<span>Grant Temporary HP</span>
								</label>
								
								<div class="custom-abilities__temphp-config" id="temphp-config" style="display: none;">
									<div class="custom-abilities__temphp-mode">
										<label class="custom-abilities__temphp-mode-option">
											<input type="radio" name="tempHpMode" value="static" checked>
											<span>Fixed Amount</span>
										</label>
										<label class="custom-abilities__temphp-mode-option">
											<input type="radio" name="tempHpMode" value="dice">
											<span>Roll Dice</span>
										</label>
									</div>
									
									<div class="custom-abilities__temphp-value-row" id="temphp-static-row">
										<span class="ve-small">Amount:</span>
										<input type="number" class="ve-form-control" id="temphp-static-value" min="1" value="5" style="width: 80px;">
										<span class="ve-muted ve-small">temp HP</span>
									</div>
									
									<div class="custom-abilities__temphp-value-row" id="temphp-dice-row" style="display: none;">
										<span class="ve-small">Roll:</span>
										<input type="text" class="ve-form-control" id="temphp-dice-value" placeholder="1d4+4" value="1d4+4" style="width: 100px;">
										<span class="ve-muted ve-small">(e.g., 1d4+4, 2d10, 5+level)</span>
									</div>
									
									<div class="custom-abilities__temphp-timing mt-2">
										<label class="custom-abilities__temphp-timing-option">
											<input type="checkbox" id="temphp-on-activation" checked>
											<span class="ve-small">Grant on activation only</span>
										</label>
										<span class="ve-muted ve-small d-block">When unchecked, temp HP persists while ability is active</span>
									</div>
								</div>
							</div>
						</div>

						<!-- Bonus Damage -->
						<div class="custom-abilities__form-section">
							<label class="custom-abilities__form-section-title">Bonus Damage (Optional)</label>
							<p class="ve-muted ve-small mb-2">Add extra damage on hits (like Hex, Hunter's Mark, Flame Tongue)</p>
							
							<div class="custom-abilities__bonus-damage-list" id="bonus-damage-list">
								<!-- Dynamically populated -->
							</div>
							<button type="button" class="btn btn-sm btn-outline-primary custom-abilities__add-damage-btn" id="add-bonus-damage-btn">
								+ Add Bonus Damage
							</button>
						</div>

						<!-- Reroll Effects -->
						<div class="custom-abilities__form-section">
							<label class="custom-abilities__form-section-title">Reroll Effects (Optional)</label>
							<p class="ve-muted ve-small mb-2">Grant rerolls on certain dice (like Lucky feat or Great Weapon Fighting)</p>
							
							<div class="custom-abilities__reroll-list" id="reroll-list">
								<!-- Dynamically populated -->
							</div>
							<button type="button" class="btn btn-sm btn-outline-primary custom-abilities__add-reroll-btn" id="add-reroll-btn">
								+ Add Reroll Effect
							</button>
						</div>

						<!-- Critical Range -->
						<div class="custom-abilities__form-section">
							<label class="custom-abilities__form-section-title">Critical Hit Range (Optional)</label>
							<p class="ve-muted ve-small mb-2">Modify critical hit range (like Champion Fighter's Improved Critical or Hexblade's Curse)</p>
							
							<div class="custom-abilities__critrange-section" id="critrange-section">
								<label class="custom-abilities__critrange-toggle">
									<input type="checkbox" id="critrange-enabled" name="critRangeEnabled">
									<span>Enable Critical Range Modification</span>
								</label>
								
								<div class="custom-abilities__critrange-config" id="critrange-config" style="display: none;">
									<div class="custom-abilities__critrange-mode">
										<label class="custom-abilities__critrange-mode-option">
											<input type="radio" name="critRangeMode" value="set" checked>
											<span>Set Range To</span>
										</label>
										<label class="custom-abilities__critrange-mode-option">
											<input type="radio" name="critRangeMode" value="expand">
											<span>Expand Range By</span>
										</label>
									</div>
									
									<div class="custom-abilities__critrange-value-row" id="critrange-set-row">
										<span class="ve-small">Critical on:</span>
										<select class="ve-form-control" id="critrange-set-value" style="width: 100px;">
											<option value="19">19-20</option>
											<option value="18">18-20</option>
											<option value="17">17-20</option>
											<option value="16">16-20</option>
											<option value="15">15-20</option>
											<option value="14">14-20</option>
											<option value="13">13-20</option>
											<option value="12">12-20</option>
											<option value="11">11-20</option>
											<option value="10">10-20</option>
											<option value="5">5-20</option>
											<option value="2">2-20</option>
										</select>
										<span class="ve-muted ve-small">(like Champion Fighter)</span>
									</div>
									
									<div class="custom-abilities__critrange-value-row" id="critrange-expand-row" style="display: none;">
										<span class="ve-small">Expand by:</span>
										<input type="number" class="ve-form-control" id="critrange-expand-value" min="1" max="19" value="1" style="width: 70px;">
										<span class="ve-muted ve-small">→ Preview: <span id="critrange-expand-preview">19-20</span></span>
									</div>
								</div>
							</div>
						</div>

						<!-- Grants -->
						<div class="custom-abilities__form-section">
							<label class="custom-abilities__form-section-title">Grants (Optional)</label>
							<p class="ve-muted ve-small mb-2">Grant spells, proficiencies, or optional features (invocations, metamagic, fighting styles, etc.)</p>
							
							<!-- Spells Grant -->
							<details class="custom-abilities__grants-section">
								<summary><span class="custom-abilities__grants-icon">✨</span> Spells <span class="custom-abilities__grants-count" id="grants-spell-count"></span></summary>
								<div class="custom-abilities__grants-content">
									<div class="custom-abilities__grants-filters">
										<input type="text" class="ve-form-control custom-abilities__grants-search" placeholder="Search spells..." id="grants-spell-search">
										<select class="ve-form-control custom-abilities__grants-filter" id="grants-spell-level-filter">
											<option value="">All Levels</option>
											<option value="0">Cantrips</option>
											<option value="1">1st Level</option>
											<option value="2">2nd Level</option>
											<option value="3">3rd Level</option>
											<option value="4">4th Level</option>
											<option value="5">5th Level</option>
											<option value="6">6th Level</option>
											<option value="7">7th Level</option>
											<option value="8">8th Level</option>
											<option value="9">9th Level</option>
										</select>
										<select class="ve-form-control custom-abilities__grants-filter" id="grants-spell-school-filter">
											<option value="">All Schools</option>
											<option value="A">Abjuration</option>
											<option value="C">Conjuration</option>
											<option value="D">Divination</option>
											<option value="E">Enchantment</option>
											<option value="V">Evocation</option>
											<option value="I">Illusion</option>
											<option value="N">Necromancy</option>
											<option value="T">Transmutation</option>
										</select>
									</div>
									<div class="custom-abilities__grants-list" id="grants-spell-list">
										<!-- Populated dynamically -->
									</div>
									<div class="custom-abilities__grants-selected" id="grants-spell-selected">
										<!-- Selected spells with options -->
									</div>
								</div>
							</details>

							<!-- Proficiencies Grant -->
							<details class="custom-abilities__grants-section">
								<summary><span class="custom-abilities__grants-icon">📚</span> Proficiencies <span class="custom-abilities__grants-count" id="grants-prof-count"></span></summary>
								<div class="custom-abilities__grants-content">
									<!-- Skills -->
									<div class="custom-abilities__grants-prof-group">
										<label class="custom-abilities__grants-prof-label">Skills</label>
										<div class="custom-abilities__grants-prof-pills" id="grants-skills-list">
											<!-- Populated dynamically -->
										</div>
									</div>
									<!-- Tools -->
									<div class="custom-abilities__grants-prof-group">
										<label class="custom-abilities__grants-prof-label">Tools</label>
										<div class="custom-abilities__grants-prof-add">
											<input type="text" class="ve-form-control" placeholder="Tool name..." id="grants-tools-input" list="grants-tools-datalist">
											<datalist id="grants-tools-datalist">
												<option value="Thieves' Tools">
												<option value="Alchemist's Supplies">
												<option value="Brewer's Supplies">
												<option value="Calligrapher's Supplies">
												<option value="Carpenter's Tools">
												<option value="Cartographer's Tools">
												<option value="Cobbler's Tools">
												<option value="Cook's Utensils">
												<option value="Glassblower's Tools">
												<option value="Herbalism Kit">
												<option value="Jeweler's Tools">
												<option value="Leatherworker's Tools">
												<option value="Mason's Tools">
												<option value="Navigator's Tools">
												<option value="Painter's Supplies">
												<option value="Poisoner's Kit">
												<option value="Potter's Tools">
												<option value="Smith's Tools">
												<option value="Tinker's Tools">
												<option value="Weaver's Tools">
												<option value="Woodcarver's Tools">
												<option value="Disguise Kit">
												<option value="Forgery Kit">
												<option value="Gaming Set">
												<option value="Musical Instrument">
											</datalist>
											<button type="button" class="btn btn-xs btn-primary" id="grants-tools-add">+ Add</button>
										</div>
										<div class="custom-abilities__grants-selected-pills" id="grants-tools-selected"></div>
									</div>
									<!-- Languages -->
									<div class="custom-abilities__grants-prof-group">
										<label class="custom-abilities__grants-prof-label">Languages</label>
										<div class="custom-abilities__grants-prof-add">
											<input type="text" class="ve-form-control" placeholder="Language name..." id="grants-languages-input" list="grants-languages-datalist">
											<datalist id="grants-languages-datalist">
												<option value="Common">
												<option value="Dwarvish">
												<option value="Elvish">
												<option value="Giant">
												<option value="Gnomish">
												<option value="Goblin">
												<option value="Halfling">
												<option value="Orc">
												<option value="Abyssal">
												<option value="Celestial">
												<option value="Draconic">
												<option value="Deep Speech">
												<option value="Infernal">
												<option value="Primordial">
												<option value="Sylvan">
												<option value="Undercommon">
												<option value="Thieves' Cant">
												<option value="Druidic">
											</datalist>
											<button type="button" class="btn btn-xs btn-primary" id="grants-languages-add">+ Add</button>
										</div>
										<div class="custom-abilities__grants-selected-pills" id="grants-languages-selected"></div>
									</div>
									<!-- Weapons -->
									<div class="custom-abilities__grants-prof-group">
										<label class="custom-abilities__grants-prof-label">Weapons</label>
										<div class="custom-abilities__grants-prof-pills">
											<button type="button" class="custom-abilities__grants-pill" data-weapon="simple">Simple Weapons</button>
											<button type="button" class="custom-abilities__grants-pill" data-weapon="martial">Martial Weapons</button>
											<button type="button" class="custom-abilities__grants-pill" data-weapon="firearms">Firearms</button>
										</div>
										<div class="custom-abilities__grants-prof-add mt-1">
											<input type="text" class="ve-form-control" placeholder="Specific weapon..." id="grants-weapons-input">
											<button type="button" class="btn btn-xs btn-primary" id="grants-weapons-add">+ Add</button>
										</div>
										<div class="custom-abilities__grants-selected-pills" id="grants-weapons-selected"></div>
									</div>
									<!-- Armor -->
									<div class="custom-abilities__grants-prof-group">
										<label class="custom-abilities__grants-prof-label">Armor</label>
										<div class="custom-abilities__grants-prof-pills">
											<button type="button" class="custom-abilities__grants-pill" data-armor="light">Light Armor</button>
											<button type="button" class="custom-abilities__grants-pill" data-armor="medium">Medium Armor</button>
											<button type="button" class="custom-abilities__grants-pill" data-armor="heavy">Heavy Armor</button>
											<button type="button" class="custom-abilities__grants-pill" data-armor="shields">Shields</button>
										</div>
									</div>
								</div>
							</details>

							<!-- Optional Features Grant -->
							<details class="custom-abilities__grants-section">
								<summary><span class="custom-abilities__grants-icon">⚔️</span> Features <span class="custom-abilities__grants-count" id="grants-feature-count"></span></summary>
								<div class="custom-abilities__grants-content">
									<div class="custom-abilities__grants-filters">
										<input type="text" class="ve-form-control custom-abilities__grants-search" placeholder="Search features..." id="grants-feature-search">
										<select class="ve-form-control custom-abilities__grants-filter" id="grants-feature-type-filter">
											<option value="">All Types</option>
											<!-- Populated dynamically with homebrew types -->
										</select>
										<select class="ve-form-control custom-abilities__grants-filter" id="grants-feature-source-filter">
											<option value="">All Sources</option>
											<!-- Populated dynamically -->
										</select>
									</div>
									<div class="custom-abilities__grants-list" id="grants-feature-list">
										<!-- Populated dynamically -->
									</div>
									<div class="custom-abilities__grants-selected" id="grants-feature-selected">
										<!-- Selected features -->
									</div>
								</div>
							</details>
						</div>
					</div>

					<!-- Advanced Mode (JSON) -->
					<div class="custom-abilities__editor-advanced" data-editor="advanced" style="display: none;">
						<div class="custom-abilities__advanced-intro">
							<p>Edit the ability definition directly as JSON. This gives full control over all properties.</p>
						</div>
						<textarea class="ve-form-control custom-abilities__json-editor" rows="20" id="ability-json-editor"></textarea>
						<div class="custom-abilities__advanced-docs">
							<details>
								<summary><strong>📚 JSON Documentation</strong></summary>
								<div class="custom-abilities__docs-content">
									<h5>Required Fields</h5>
									<ul>
										<li><code>name</code>: String - The ability name</li>
									</ul>

									<h5>Optional Fields</h5>
									<ul>
										<li><code>description</code>: String - Description text (supports 5etools tags)</li>
										<li><code>icon</code>: String - Emoji icon (default: "⚡")</li>
										<li><code>category</code>: "homebrew" | "houserule" | "boon" | "curse" | "campaign" | "magicitem"</li>
										<li><code>mode</code>: "passive" | "toggleable" | "limited" (default: "passive")</li>
										<li><code>uses</code>: Object for limited mode - { max: number, recharge: "short" | "long" }</li>
										<li><code>effects</code>: Array of effect objects (see below)</li>
									</ul>

									<h5>Effect Object Properties</h5>
									<ul>
										<li><code>type</code>: Effect target (e.g., "ac", "attack", "save:dex", "skill:stealth")</li>
										<li><code>value</code>: Numeric bonus/penalty</li>
										<li><code>advantage</code>: true for advantage</li>
										<li><code>disadvantage</code>: true for disadvantage</li>
										<li><code>setMinimum</code>: Minimum roll value (like Reliable Talent)</li>
										<li><code>setMaximum</code>: Maximum roll value</li>
										<li><code>bonusDie</code>: Bonus dice string (e.g., "1d4")</li>
										<li><code>conditional</code>: Condition text (e.g., "against undead")</li>
									</ul>

									<h5>Effect Types</h5>
									<p class="ve-small ve-muted">ac, initiative, attack, attack:melee, attack:ranged, attack:spell, damage, damage:melee, damage:ranged, damage:spell, critRange (set absolute, e.g. 19), critRange:expand (expand by amount), tempHp (static amount), tempHp:dice (roll dice like "1d4+4"), speed, speed:fly, speed:swim, speed:climb, spellDc, spellAttack, save:all, save:str/dex/con/int/wis/cha, check:all, check:str/dex/con/int/wis/cha, skill:all, skill:[skillname], passive:[skillname], hp:max, ability:str/dex/con/int/wis/cha, sense:darkvision/blindsight/tremorsense/truesight, resistance:[damage type], proficiencyBonus, carryCapacity, deathSave</p>

									<h5>Example</h5>
									<pre>{
  "name": "Blessing of Protection",
  "description": "Divine favor grants you protection.",
  "icon": "🛡️",
  "category": "boon",
  "mode": "passive",
  "effects": [
    { "type": "ac", "value": 1 },
    { "type": "save:all", "value": 1 }
  ]
}</pre>
								</div>
							</details>
						</div>
					</div>
				</div>
				<div class="modal-footer">
					<button class="btn btn-default custom-abilities__cancel-btn">Cancel</button>
					<button class="btn btn-primary custom-abilities__save-btn">${isEditing ? "Save Changes" : "Create Ability"}</button>
				</div>
			</div>
		`;

		document.body.appendChild(modal);

		// State
		let grants = existingAbility?.grants ? JSON.parse(JSON.stringify(existingAbility.grants)) : {
			spells: [],
			proficiencies: {skills: [], tools: [], weapons: [], armor: [], languages: []},
			features: [],
		};
		let defensiveTraits = existingAbility?.defensiveTraits ? JSON.parse(JSON.stringify(existingAbility.defensiveTraits)) : {
			resistances: [],
			immunities: [],
			vulnerabilities: [],
			conditionImmunities: [],
		};
		
		// Size, reach, bonus damage, rerolls, crit range, temp HP - extracted from effects array
		let sizeChange = 0; // Positive = enlarge, negative = reduce
		let reachBonus = 0; // In increments of 5 ft
		let bonusDamage = []; // [{type: "fire", dice: "1d6"}, ...]
		let rerolls = []; // [{trigger: "1", rollType: "attack"}, ...]
		let critRangeConfig = {enabled: false, mode: "set", value: 19, expand: 1}; // Critical range config
		let tempHpConfig = {enabled: false, mode: "static", value: 5, dice: "1d4+4", onActivation: true}; // Temp HP config
		let effects = []; // General effects (not size/reach/damage/reroll/critRange/tempHp)
		
		// Initialize from existing effects - extract special types and keep others
		if (existingAbility?.effects) {
			for (const e of existingAbility.effects) {
				if (e.type === "sizeIncrease") {
					sizeChange += (e.value || 1);
				} else if (e.type === "sizeDecrease") {
					sizeChange -= (e.value || 1);
				} else if (e.type === "reach") {
					reachBonus += Math.floor((e.value || 5) / 5);
				} else if (e.type?.startsWith("extraDamage:")) {
					bonusDamage.push({type: e.type.replace("extraDamage:", ""), dice: e.dice || "1d6"});
				} else if (e.type?.startsWith("reroll:")) {
					// Parse reroll:TRIGGER:ROLLTYPE format
					const parts = e.type.split(":");
					rerolls.push({trigger: parts[1] || "1", rollType: parts[2] || "all"});
				} else if (e.type?.startsWith("damage:reroll:")) {
					// Parse damage:reroll:TRIGGER:RESTRICTION format
					const parts = e.type.split(":");
					rerolls.push({trigger: parts[2] || "1or2", rollType: "damage", restriction: parts[3] || ""});
				} else if (e.type === "critRange") {
					// Absolute critical range (set to a specific value)
					critRangeConfig.enabled = true;
					critRangeConfig.mode = "set";
					critRangeConfig.value = e.value || 19;
				} else if (e.type === "critRange:expand") {
					// Expand critical range by amount
					critRangeConfig.enabled = true;
					critRangeConfig.mode = "expand";
					critRangeConfig.expand = e.value || 1;
				} else if (e.type === "tempHp" || e.type === "tempHp:dice") {
					// Temporary HP grant
					tempHpConfig.enabled = true;
					if (e.type === "tempHp:dice") {
						tempHpConfig.mode = "dice";
						tempHpConfig.dice = e.dice || "1d4+4";
					} else {
						tempHpConfig.mode = "static";
						tempHpConfig.value = e.value || 5;
					}
					tempHpConfig.onActivation = e.onActivation !== false;
				} else {
					// Keep as general effect
					effects.push(JSON.parse(JSON.stringify(e)));
				}
			}
		}
		let currentMode = "simple";

		// Get data from sheet for pickers
		const allSpells = this._sheet.getSpells?.() || [];
		const allOptionalFeatures = this._sheet.getOptionalFeatures?.() || [];
		const skillsList = this._sheet.getSkillsList?.() || [];
		const languagesList = this._sheet.getLanguagesList?.() || [];
		const toolsList = this._sheet.getToolsList?.() || [];
		const conditionsList = this._getConditionsWithSources();
		const damageTypesList = this._getDamageTypesList();

		// Helper to render grants UI
		const renderGrantsUI = () => {
			this._renderGrantsSpells(modal, grants, allSpells);
			this._renderGrantsSkills(modal, grants, skillsList);
			this._renderGrantsTools(modal, grants, toolsList);
			this._renderGrantsLanguages(modal, grants, languagesList);
			this._renderGrantsWeapons(modal, grants);
			this._renderGrantsArmor(modal, grants);
			this._renderGrantsFeatures(modal, grants, allOptionalFeatures);
		};

		// Helper to render defensive traits UI
		const renderDefensiveTraitsUI = () => {
			this._renderDefensiveTraits(modal, defensiveTraits, damageTypesList, conditionsList);
		};

		// Helper to render size/reach section
		const renderSizeReachUI = () => {
			// Update size value display
			const sizeValueEl = modal.querySelector("#size-value");
			if (sizeValueEl) {
				const sign = sizeChange > 0 ? "+" : "";
				sizeValueEl.textContent = sizeChange === 0 ? "0" : `${sign}${sizeChange}`;
				sizeValueEl.className = "custom-abilities__size-value" + 
					(sizeChange > 0 ? " custom-abilities__size-value--positive" : "") +
					(sizeChange < 0 ? " custom-abilities__size-value--negative" : "");
			}
			
			// Update size preview
			const state = this._sheet.getState();
			const baseSize = state.getBaseSize();
			const preview = modal.querySelector("#size-preview");
			if (preview) {
				if (sizeChange !== 0) {
					const sizes = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
					const baseIdx = sizes.indexOf(baseSize);
					const newIdx = Math.max(0, Math.min(baseIdx + sizeChange, sizes.length - 1));
					const baseName = baseSize.charAt(0).toUpperCase() + baseSize.slice(1);
					const newName = sizes[newIdx].charAt(0).toUpperCase() + sizes[newIdx].slice(1);
					preview.textContent = `${baseName} → ${newName}`;
				} else {
					preview.textContent = "";
				}
			}
			
			// Update reach value display
			const reachValueEl = modal.querySelector("#reach-value");
			if (reachValueEl) {
				const reachFt = reachBonus * 5;
				const sign = reachFt > 0 ? "+" : "";
				reachValueEl.textContent = reachFt === 0 ? "0" : `${sign}${reachFt}`;
				reachValueEl.className = "custom-abilities__reach-value" + 
					(reachBonus > 0 ? " custom-abilities__reach-value--positive" : "") +
					(reachBonus < 0 ? " custom-abilities__reach-value--negative" : "");
			}
		};

		// Helper to render bonus damage list
		const renderBonusDamageList = () => {
			const list = modal.querySelector("#bonus-damage-list");
			list.innerHTML = "";
			
			if (!bonusDamage.length) {
				list.innerHTML = `<div class="ve-muted ve-small py-1">No bonus damage added</div>`;
				return;
			}

			const damageTypeOptions = damageTypesList.map(t => `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join("");
			
			bonusDamage.forEach((dmg, idx) => {
				const row = document.createElement("div");
				row.className = "custom-abilities__bonus-damage-row";
				row.innerHTML = `
					<input type="text" class="ve-form-control" placeholder="1d6" value="${dmg.dice || "1d6"}" style="width: 70px;">
					<select class="ve-form-control" style="flex: 1;">${damageTypeOptions}</select>
					<button type="button" class="btn btn-xs btn-danger">&times;</button>
				`;
				row.querySelector("select").value = dmg.type || "fire";
				row.querySelector("input").addEventListener("change", e => { bonusDamage[idx].dice = e.target.value.trim() || "1d6"; });
				row.querySelector("select").addEventListener("change", e => { bonusDamage[idx].type = e.target.value; });
				row.querySelector("button").addEventListener("click", () => { bonusDamage.splice(idx, 1); renderBonusDamageList(); });
				list.appendChild(row);
			});
		};

		// Helper to render reroll effects list
		const renderRerollsUI = () => {
			const list = modal.querySelector("#reroll-list");
			if (!list) return;
			list.innerHTML = "";
			
			if (!rerolls.length) {
				list.innerHTML = `<div class="ve-muted ve-small py-1">No reroll effects added</div>`;
				return;
			}
			
			rerolls.forEach((r, idx) => {
				const row = document.createElement("div");
				row.className = "custom-abilities__reroll-row";
				
				const isDamage = r.rollType === "damage";
				
				row.innerHTML = `
					<span class="ve-small">Reroll</span>
					<select class="ve-form-control custom-abilities__reroll-trigger" style="width: 100px;">
						<option value="1" ${r.trigger === "1" ? "selected" : ""}>1s</option>
						<option value="1or2" ${r.trigger === "1or2" ? "selected" : ""}>1s and 2s</option>
						<option value="1to3" ${r.trigger === "1to3" ? "selected" : ""}>1s to 3s</option>
					</select>
					<span class="ve-small">on</span>
					<select class="ve-form-control custom-abilities__reroll-type" style="flex: 1;">
						<option value="attack" ${r.rollType === "attack" ? "selected" : ""}>Attack Rolls</option>
						<option value="save" ${r.rollType === "save" ? "selected" : ""}>Saving Throws</option>
						<option value="ability" ${r.rollType === "ability" ? "selected" : ""}>Ability Checks</option>
						<option value="all" ${r.rollType === "all" ? "selected" : ""}>All d20 Rolls</option>
						<option value="damage" ${r.rollType === "damage" ? "selected" : ""}>Damage Dice</option>
					</select>
					${isDamage ? `
						<select class="ve-form-control custom-abilities__reroll-restrict" style="width: 120px;">
							<option value="" ${!r.restriction ? "selected" : ""}>All Damage</option>
							<option value="melee" ${r.restriction === "melee" ? "selected" : ""}>Melee Only</option>
							<option value="twoHanded" ${r.restriction === "twoHanded" ? "selected" : ""}>Two-Handed</option>
							<option value="spell" ${r.restriction === "spell" ? "selected" : ""}>Spell Damage</option>
						</select>
					` : ""}
					<button type="button" class="btn btn-xs btn-danger">&times;</button>
				`;
				
				row.querySelector(".custom-abilities__reroll-trigger").addEventListener("change", e => {
					rerolls[idx].trigger = e.target.value;
				});
				row.querySelector(".custom-abilities__reroll-type").addEventListener("change", e => {
					rerolls[idx].rollType = e.target.value;
					// Re-render to show/hide restriction dropdown
					renderRerollsUI();
				});
				const restrictEl = row.querySelector(".custom-abilities__reroll-restrict");
				if (restrictEl) {
					restrictEl.addEventListener("change", e => {
						rerolls[idx].restriction = e.target.value;
					});
				}
				row.querySelector("button").addEventListener("click", () => {
					rerolls.splice(idx, 1);
					renderRerollsUI();
				});
				
				list.appendChild(row);
			});
		};

		// Helper to render critical range UI
		const renderCritRangeUI = () => {
			const enabledCheckbox = modal.querySelector("#critrange-enabled");
			const configSection = modal.querySelector("#critrange-config");
			const setRow = modal.querySelector("#critrange-set-row");
			const expandRow = modal.querySelector("#critrange-expand-row");
			const setValue = modal.querySelector("#critrange-set-value");
			const expandValue = modal.querySelector("#critrange-expand-value");
			const expandPreview = modal.querySelector("#critrange-expand-preview");
			const modeRadios = modal.querySelectorAll("input[name='critRangeMode']");
			
			if (!enabledCheckbox) return;
			
			// Set checkbox state
			enabledCheckbox.checked = critRangeConfig.enabled;
			
			// Show/hide config section
			configSection.style.display = critRangeConfig.enabled ? "block" : "none";
			
			// Set mode radio
			modeRadios.forEach(r => {
				r.checked = r.value === critRangeConfig.mode;
			});
			
			// Show/hide appropriate row
			setRow.style.display = critRangeConfig.mode === "set" ? "flex" : "none";
			expandRow.style.display = critRangeConfig.mode === "expand" ? "flex" : "none";
			
			// Set values
			setValue.value = critRangeConfig.value;
			expandValue.value = critRangeConfig.expand;
			
			// Update expand preview
			const expandedRange = 20 - critRangeConfig.expand;
			expandPreview.textContent = `${expandedRange}-20`;
		};

		// Helper to render temp HP UI
		const renderTempHpUI = () => {
			const enabledCheckbox = modal.querySelector("#temphp-enabled");
			const configSection = modal.querySelector("#temphp-config");
			const staticRow = modal.querySelector("#temphp-static-row");
			const diceRow = modal.querySelector("#temphp-dice-row");
			const staticValue = modal.querySelector("#temphp-static-value");
			const diceValue = modal.querySelector("#temphp-dice-value");
			const onActivationCheckbox = modal.querySelector("#temphp-on-activation");
			const modeRadios = modal.querySelectorAll("input[name='tempHpMode']");
			
			if (!enabledCheckbox) return;
			
			// Set checkbox state
			enabledCheckbox.checked = tempHpConfig.enabled;
			
			// Show/hide config section
			configSection.style.display = tempHpConfig.enabled ? "block" : "none";
			
			// Set mode radio
			modeRadios.forEach(r => {
				r.checked = r.value === tempHpConfig.mode;
			});
			
			// Show/hide appropriate row
			staticRow.style.display = tempHpConfig.mode === "static" ? "flex" : "none";
			diceRow.style.display = tempHpConfig.mode === "dice" ? "flex" : "none";
			
			// Set values
			staticValue.value = tempHpConfig.value;
			diceValue.value = tempHpConfig.dice;
			onActivationCheckbox.checked = tempHpConfig.onActivation;
		};

		// Helper to render effects list
		const renderEffectsList = () => {
			const list = modal.querySelector("#ability-effects-list");
			list.innerHTML = "";

			if (!effects.length) {
				list.innerHTML = `<div class="ve-muted ve-text-center py-2">No effects added. This ability will be flavor-only.</div>`;
				return;
			}

			effects.forEach((effect, idx) => {
				const isAbilityType = effect.type?.startsWith("ability:");
				const row = document.createElement("div");
				row.className = "custom-abilities__effect-row";
				row.innerHTML = `
					<div class="custom-abilities__effect-row-main">
						<select class="ve-form-control custom-abilities__effect-type">${typeOptionsHtml}</select>
						<select class="ve-form-control custom-abilities__effect-mode" style="width: 85px; ${isAbilityType ? "" : "display: none;"}" title="Add to score or set score to value">
							<option value="" ${!effect.mode ? "selected" : ""}>Add</option>
							<option value="set" ${effect.mode === "set" ? "selected" : ""}>Set To</option>
						</select>
						<input type="number" class="ve-form-control custom-abilities__effect-value" placeholder="${isAbilityType && effect.mode === "set" ? "19" : "±0"}" value="${effect.value || 0}" style="width: 70px;">
						<select class="ve-form-control custom-abilities__effect-scaling" style="width: 145px;" title="Add a stat-based bonus">
							<option value="">Fixed Only</option>
							<optgroup label="Proficiency">
								<option value="proficiencyBonus" ${effect.proficiencyBonus ? "selected" : ""}>+ Prof Bonus</option>
								<option value="halfProficiency" ${effect.halfProficiency ? "selected" : ""}>+ Half Prof</option>
								<option value="doubleProficiency" ${effect.doubleProficiency ? "selected" : ""}>+ Double Prof</option>
							</optgroup>
							<optgroup label="Ability Modifier">
								<option value="abilityMod:str" ${effect.abilityMod === "str" ? "selected" : ""}>+ STR mod</option>
								<option value="abilityMod:dex" ${effect.abilityMod === "dex" ? "selected" : ""}>+ DEX mod</option>
								<option value="abilityMod:con" ${effect.abilityMod === "con" ? "selected" : ""}>+ CON mod</option>
								<option value="abilityMod:int" ${effect.abilityMod === "int" ? "selected" : ""}>+ INT mod</option>
								<option value="abilityMod:wis" ${effect.abilityMod === "wis" ? "selected" : ""}>+ WIS mod</option>
								<option value="abilityMod:cha" ${effect.abilityMod === "cha" ? "selected" : ""}>+ CHA mod</option>
							</optgroup>
							<optgroup label="Level Scaling">
								<option value="perLevel" ${effect.perLevel ? "selected" : ""}>× Character Level</option>
								<option value="perClassLevel" ${effect.perClassLevel ? "selected" : ""}>× Class Level...</option>
							</optgroup>
						</select>
						${effect.perClassLevel ? `<select class="ve-form-control custom-abilities__effect-class-level" style="width: 110px;">${this._getClassOptionsHtml(state, effect.perClassLevel)}</select>` : ""}
					</div>
					<div class="custom-abilities__effect-row-extra">
						<select class="ve-form-control custom-abilities__effect-advdis" style="width: 120px;">
							<option value="">Normal</option>
							<option value="advantage" ${effect.advantage ? "selected" : ""}>Advantage</option>
							<option value="disadvantage" ${effect.disadvantage ? "selected" : ""}>Disadvantage</option>
						</select>
						<input type="number" class="ve-form-control custom-abilities__effect-minimum" placeholder="Min" value="${effect.setMinimum ?? ""}" style="width: 65px;" title="Minimum roll (like Reliable Talent)">
						<input type="text" class="ve-form-control custom-abilities__effect-bonusdie" placeholder="e.g. 1d4" value="${effect.bonusDie || ""}" style="width: 75px;" title="Bonus dice">
						<select class="ve-form-control custom-abilities__effect-conditional" style="width: 140px;" title="When does this effect apply?">
							<option value="">Always</option>
							<option value="against:undead" ${effect.conditional === "against:undead" ? "selected" : ""}>vs Undead</option>
							<option value="against:fiend" ${effect.conditional === "against:fiend" ? "selected" : ""}>vs Fiends</option>
							<option value="against:aberration" ${effect.conditional === "against:aberration" ? "selected" : ""}>vs Aberrations</option>
							<option value="against:fey" ${effect.conditional === "against:fey" ? "selected" : ""}>vs Fey</option>
							<option value="against:dragon" ${effect.conditional === "against:dragon" ? "selected" : ""}>vs Dragons</option>
							<option value="against:giant" ${effect.conditional === "against:giant" ? "selected" : ""}>vs Giants</option>
							<option value="against:beast" ${effect.conditional === "against:beast" ? "selected" : ""}>vs Beasts</option>
							<option value="against:humanoid" ${effect.conditional === "against:humanoid" ? "selected" : ""}>vs Humanoids</option>
							<option value="in:dim" ${effect.conditional === "in:dim" ? "selected" : ""}>In Dim Light</option>
							<option value="in:darkness" ${effect.conditional === "in:darkness" ? "selected" : ""}>In Darkness</option>
							<option value="while:bloodied" ${effect.conditional === "while:bloodied" ? "selected" : ""}>While Bloodied</option>
							<option value="while:hidden" ${effect.conditional === "while:hidden" ? "selected" : ""}>While Hidden</option>
							<option value="first:attack" ${effect.conditional === "first:attack" ? "selected" : ""}>First Attack/Turn</option>
							<option value="custom" ${effect.conditional?.startsWith("custom:") ? "selected" : ""}>Custom...</option>
						</select>
						<button class="btn btn-sm btn-danger custom-abilities__effect-remove" title="Remove">&times;</button>
					</div>
					${effect.conditional?.startsWith("custom:") ? `
						<div class="custom-abilities__effect-row-conditional">
							<input type="text" class="ve-form-control custom-abilities__effect-conditional-text" placeholder="Custom condition..." value="${effect.conditional.replace("custom:", "")}" style="flex: 1;">
						</div>
					` : ""}
				`;

				// Set selected type
				row.querySelector(".custom-abilities__effect-type").value = effect.type || "ac";

				// Bind change handlers
				const typeEl = row.querySelector(".custom-abilities__effect-type");
				const modeEl = row.querySelector(".custom-abilities__effect-mode");
				const valueEl = row.querySelector(".custom-abilities__effect-value");

				typeEl.addEventListener("change", (e) => {
					effects[idx].type = e.target.value;
					// Show/hide mode dropdown based on type
					const isAbility = e.target.value.startsWith("ability:");
					modeEl.style.display = isAbility ? "" : "none";
					if (!isAbility) {
						delete effects[idx].mode;
						valueEl.placeholder = "±0";
					}
				});
				modeEl.addEventListener("change", (e) => {
					if (e.target.value === "set") {
						effects[idx].mode = "set";
						valueEl.placeholder = "19";
					} else {
						delete effects[idx].mode;
						valueEl.placeholder = "±0";
					}
				});
				valueEl.addEventListener("change", (e) => {
					effects[idx].value = parseInt(e.target.value) || 0;
				});

				// Scaling dropdown handler
				const scalingEl = row.querySelector(".custom-abilities__effect-scaling");
				scalingEl.addEventListener("change", (e) => {
					// Clear all scaling properties first
					delete effects[idx].proficiencyBonus;
					delete effects[idx].halfProficiency;
					delete effects[idx].doubleProficiency;
					delete effects[idx].abilityMod;
					delete effects[idx].perLevel;
					delete effects[idx].perClassLevel;

					const val = e.target.value;
					if (val === "proficiencyBonus") effects[idx].proficiencyBonus = true;
					else if (val === "halfProficiency") effects[idx].halfProficiency = true;
					else if (val === "doubleProficiency") effects[idx].doubleProficiency = true;
					else if (val.startsWith("abilityMod:")) effects[idx].abilityMod = val.replace("abilityMod:", "");
					else if (val === "perLevel") effects[idx].perLevel = true;
					else if (val === "perClassLevel") {
						// Default to first class or "Fighter"
						const classes = state.getClasses?.() || [];
						effects[idx].perClassLevel = classes[0]?.name || "Fighter";
						renderEffectsList(); // Re-render to show class selector
						return;
					}
				});

				// Class level dropdown handler (if present)
				const classLevelEl = row.querySelector(".custom-abilities__effect-class-level");
				if (classLevelEl) {
					classLevelEl.addEventListener("change", (e) => {
						effects[idx].perClassLevel = e.target.value;
					});
				}

				row.querySelector(".custom-abilities__effect-advdis").addEventListener("change", (e) => {
					delete effects[idx].advantage;
					delete effects[idx].disadvantage;
					if (e.target.value === "advantage") effects[idx].advantage = true;
					if (e.target.value === "disadvantage") effects[idx].disadvantage = true;
				});
				row.querySelector(".custom-abilities__effect-minimum").addEventListener("change", (e) => {
					const val = parseInt(e.target.value);
					if (!isNaN(val)) effects[idx].setMinimum = val;
					else delete effects[idx].setMinimum;
				});
				row.querySelector(".custom-abilities__effect-bonusdie").addEventListener("change", (e) => {
					const val = e.target.value.trim();
					if (val) effects[idx].bonusDie = val;
					else delete effects[idx].bonusDie;
				});
				row.querySelector(".custom-abilities__effect-conditional").addEventListener("change", (e) => {
					const val = e.target.value;
					if (val === "custom") {
						effects[idx].conditional = "custom:";
						renderEffectsList(); // Re-render to show custom input
					} else if (val) {
						effects[idx].conditional = val;
					} else {
						delete effects[idx].conditional;
					}
				});
				const conditionalText = row.querySelector(".custom-abilities__effect-conditional-text");
				if (conditionalText) {
					conditionalText.addEventListener("change", (e) => {
						const val = e.target.value.trim();
						effects[idx].conditional = val ? `custom:${val}` : "";
					});
				}
				row.querySelector(".custom-abilities__effect-remove").addEventListener("click", () => {
					effects.splice(idx, 1);
					renderEffectsList();
				});

				list.appendChild(row);
			});
		};

		// Sync form to JSON
		const syncFormToJson = () => {
			// Build complete effects array from all sources
			const allEffects = [...effects];
			
			// Add size change effects (supports multiple increments)
			if (sizeChange > 0) {
				allEffects.push({type: "sizeIncrease", value: sizeChange});
			} else if (sizeChange < 0) {
				allEffects.push({type: "sizeDecrease", value: Math.abs(sizeChange)});
			}
			
			// Add reach bonus effect (supports multiple increments)
			if (reachBonus > 0) {
				allEffects.push({type: "reach", value: reachBonus * 5});
			}
			
			// Add bonus damage effects
			for (const dmg of bonusDamage) {
				allEffects.push({type: `extraDamage:${dmg.type}`, dice: dmg.dice || "1d6"});
			}
			
			// Add reroll effects
			for (const r of rerolls) {
				if (r.rollType === "damage") {
					// Format: damage:reroll:TRIGGER:RESTRICTION
					const type = r.restriction 
						? `damage:reroll:${r.trigger}:${r.restriction}`
						: `damage:reroll:${r.trigger}`;
					allEffects.push({type});
				} else {
					// Format: reroll:TRIGGER:ROLLTYPE
					allEffects.push({type: `reroll:${r.trigger}:${r.rollType}`});
				}
			}
			
			// Add critical range effect
			if (critRangeConfig.enabled) {
				if (critRangeConfig.mode === "set") {
					allEffects.push({type: "critRange", value: critRangeConfig.value});
				} else if (critRangeConfig.mode === "expand") {
					allEffects.push({type: "critRange:expand", value: critRangeConfig.expand});
				}
			}
			
			// Add temp HP effect
			if (tempHpConfig.enabled) {
				if (tempHpConfig.mode === "dice") {
					allEffects.push({
						type: "tempHp:dice",
						dice: tempHpConfig.dice,
						onActivation: tempHpConfig.onActivation,
					});
				} else {
					allEffects.push({
						type: "tempHp",
						value: tempHpConfig.value,
						onActivation: tempHpConfig.onActivation,
					});
				}
			}
			
			const data = {
				name: modal.querySelector("input[name='name']").value,
				description: modal.querySelector("textarea[name='description']").value,
				icon: modal.querySelector("input[name='icon']").value || "⚡",
				category: modal.querySelector("select[name='category']").value,
				mode: modal.querySelector("input[name='mode']:checked")?.value || "passive",
				effects: allEffects,
			};

			// Add grants if any are defined (grants object is maintained by UI handlers)
			const hasGrants = grants.spells.length > 0 ||
				grants.proficiencies.skills.length > 0 ||
				grants.proficiencies.tools.length > 0 ||
				grants.proficiencies.weapons.length > 0 ||
				grants.proficiencies.armor.length > 0 ||
				grants.proficiencies.languages.length > 0 ||
				grants.features.length > 0;

			if (hasGrants) {
				data.grants = {
					spells: grants.spells,
					proficiencies: {
						skills: grants.proficiencies.skills,
						tools: grants.proficiencies.tools,
						weapons: grants.proficiencies.weapons,
						armor: grants.proficiencies.armor,
						languages: grants.proficiencies.languages,
					},
					features: grants.features,
				};
			}

			// Add defensive traits if any are selected
			const hasDefensiveTraits = defensiveTraits.resistances.length > 0 ||
				defensiveTraits.immunities.length > 0 ||
				defensiveTraits.vulnerabilities.length > 0 ||
				defensiveTraits.conditionImmunities.length > 0;

			if (hasDefensiveTraits) {
				data.defensiveTraits = {
					resistances: [...defensiveTraits.resistances],
					immunities: [...defensiveTraits.immunities],
					vulnerabilities: [...defensiveTraits.vulnerabilities],
					conditionImmunities: [...defensiveTraits.conditionImmunities],
				};
			}

			if (data.mode === "limited") {
				const resourceSource = modal.querySelector("select[name='resourceSource']").value || "self";
				data.resourceSource = { type: resourceSource };
				
				if (resourceSource === "self") {
					data.uses = {
						max: parseInt(modal.querySelector("input[name='maxUses']").value) || 1,
						recharge: modal.querySelector("select[name='recharge']").value || "long",
					};
				} else if (resourceSource === "linked") {
					data.resourceSource.resourceId = modal.querySelector("select[name='linkedResourceId']").value;
					data.resourceSource.cost = parseInt(modal.querySelector("input[name='linkedResourceCost']").value) || 1;
				} else if (resourceSource === "new") {
					data.resourceSource.newResourceName = modal.querySelector("input[name='newResourceName']").value;
					data.resourceSource.newResourceMax = parseInt(modal.querySelector("input[name='newResourceMax']").value) || 3;
					data.resourceSource.newResourceRecharge = modal.querySelector("select[name='newResourceRecharge']").value || "long";
				}
			}

			// Add activation action for non-passive modes
			if (data.mode && data.mode !== "passive") {
				const activationAction = modal.querySelector("select[name='activationAction']").value;
				if (activationAction && activationAction !== "free") {
					data.activationAction = activationAction;
				}
			}

			// Add duration and concentration for toggleable mode
			if (data.mode === "toggleable") {
				const duration = modal.querySelector("select[name='duration']").value;
				if (duration) {
					data.duration = duration;
				}
				const concentration = modal.querySelector("input[name='concentration']").checked;
				if (concentration) {
					data.concentration = true;
				}
				// Add resource cost if enabled
				const hasResourceCost = modal.querySelector("input[name='hasResourceCost']").checked;
				if (hasResourceCost) {
					data.resourceCost = {
						resourceId: modal.querySelector("select[name='toggleResourceId']").value,
						cost: parseInt(modal.querySelector("input[name='toggleResourceCost']").value) || 1,
					};
				}
			}

			if (existingAbility) {
				data.id = existingAbility.id;
				data.isActive = existingAbility.isActive;
				if (existingAbility.uses) {
					data.uses = {...existingAbility.uses, ...data.uses};
				}
			}

			return data;
		};

		// Sync JSON to form
		const syncJsonToForm = (data) => {
			if (!data) return;
			modal.querySelector("input[name='name']").value = data.name || "";
			modal.querySelector("textarea[name='description']").value = data.description || "";
			modal.querySelector("input[name='icon']").value = data.icon || "⚡";
			modal.querySelector("select[name='category']").value = data.category || "homebrew";
			const modeRadio = modal.querySelector(`input[name='mode'][value='${data.mode || "passive"}']`);
			if (modeRadio) modeRadio.checked = true;

			// Restore resource source for limited mode
			if (data.resourceSource) {
				modal.querySelector("select[name='resourceSource']").value = data.resourceSource.type || "self";
				if (data.resourceSource.type === "linked") {
					const linkedSelect = modal.querySelector("select[name='linkedResourceId']");
					if (linkedSelect) linkedSelect.value = data.resourceSource.resourceId || "";
					modal.querySelector("input[name='linkedResourceCost']").value = data.resourceSource.cost || 1;
				} else if (data.resourceSource.type === "new") {
					modal.querySelector("input[name='newResourceName']").value = data.resourceSource.newResourceName || "";
					modal.querySelector("input[name='newResourceMax']").value = data.resourceSource.newResourceMax || 3;
					modal.querySelector("select[name='newResourceRecharge']").value = data.resourceSource.newResourceRecharge || "long";
				}
			}

			if (data.uses) {
				modal.querySelector("input[name='maxUses']").value = data.uses.max || 1;
				modal.querySelector("select[name='recharge']").value = data.uses.recharge || "long";
			}

			// Restore activation action
			if (data.activationAction) {
				modal.querySelector("select[name='activationAction']").value = data.activationAction;
			}

			// Restore duration and concentration
			if (data.duration) {
				modal.querySelector("select[name='duration']").value = data.duration;
			}
			if (data.concentration) {
				modal.querySelector("input[name='concentration']").checked = true;
			}

			// Restore resource cost for toggleable mode
			if (data.resourceCost) {
				modal.querySelector("input[name='hasResourceCost']").checked = true;
				const toggleSelect = modal.querySelector("select[name='toggleResourceId']");
				if (toggleSelect) toggleSelect.value = data.resourceCost.resourceId || "";
				modal.querySelector("input[name='toggleResourceCost']").value = data.resourceCost.cost || 1;
			}

			// Parse effects array to extract special effect types
			sizeChange = 0;
			reachBonus = 0;
			bonusDamage = [];
			rerolls = [];
			critRangeConfig = {enabled: false, mode: "set", value: 19, expand: 1};
			effects = [];
			
			for (const e of (data.effects || [])) {
				if (e.type === "sizeIncrease") {
					sizeChange += (e.value || 1);
				} else if (e.type === "sizeDecrease") {
					sizeChange -= (e.value || 1);
				} else if (e.type === "reach") {
					reachBonus += Math.floor((e.value || 5) / 5);
				} else if (e.type?.startsWith("extraDamage:")) {
					bonusDamage.push({type: e.type.replace("extraDamage:", ""), dice: e.dice || "1d6"});
				} else if (e.type?.startsWith("reroll:")) {
					// Parse reroll:TRIGGER:ROLLTYPE format
					const parts = e.type.split(":");
					rerolls.push({trigger: parts[1] || "1", rollType: parts[2] || "all"});
				} else if (e.type?.startsWith("damage:reroll:")) {
					// Parse damage:reroll:TRIGGER:RESTRICTION format
					const parts = e.type.split(":");
					rerolls.push({trigger: parts[2] || "1or2", rollType: "damage", restriction: parts[3] || ""});
				} else if (e.type === "critRange") {
					// Absolute critical range
					critRangeConfig.enabled = true;
					critRangeConfig.mode = "set";
					critRangeConfig.value = e.value || 19;
				} else if (e.type === "critRange:expand") {
					// Expand critical range
					critRangeConfig.enabled = true;
					critRangeConfig.mode = "expand";
					critRangeConfig.expand = e.value || 1;
				} else if (e.type === "tempHp" || e.type === "tempHp:dice") {
					// Temporary HP grant
					tempHpConfig.enabled = true;
					if (e.type === "tempHp:dice") {
						tempHpConfig.mode = "dice";
						tempHpConfig.dice = e.dice || "1d4+4";
					} else {
						tempHpConfig.mode = "static";
						tempHpConfig.value = e.value || 5;
					}
					tempHpConfig.onActivation = e.onActivation !== false;
				} else {
					// Keep other effects in the regular effects array
					effects.push(e);
				}
			}
			
			renderEffectsList();
			renderSizeReachUI();
			renderBonusDamageList();
			renderRerollsUI();
			renderCritRangeUI();
			renderTempHpUI();

			// Restore grants
			if (data.grants) {
				grants = {
					spells: data.grants.spells || [],
					proficiencies: {
						skills: data.grants.proficiencies?.skills || [],
						tools: data.grants.proficiencies?.tools || [],
						weapons: data.grants.proficiencies?.weapons || [],
						armor: data.grants.proficiencies?.armor || [],
						languages: data.grants.proficiencies?.languages || [],
					},
					features: data.grants.features || [],
				};
				renderGrantsUI();
			}

			// Restore defensive traits
			if (data.defensiveTraits) {
				defensiveTraits = {
					resistances: data.defensiveTraits.resistances || [],
					immunities: data.defensiveTraits.immunities || [],
					vulnerabilities: data.defensiveTraits.vulnerabilities || [],
					conditionImmunities: data.defensiveTraits.conditionImmunities || [],
				};
			}
			renderDefensiveTraitsUI();

			// Update visibility after restoring values
			updateModeVisibility();
			updateResourceSourceVisibility();
			updateToggleableResourceVisibility();
		};

		// Update limited options visibility
		const updateModeVisibility = () => {
			const mode = modal.querySelector("input[name='mode']:checked")?.value;
			modal.querySelector(".custom-abilities__limited-options").style.display = mode === "limited" ? "flex" : "none";
			modal.querySelector(".custom-abilities__activation-options").style.display = mode && mode !== "passive" ? "flex" : "none";
			modal.querySelector(".custom-abilities__duration-options").style.display = mode === "toggleable" ? "flex" : "none";
			modal.querySelector(".custom-abilities__toggleable-resource-options").style.display = mode === "toggleable" ? "block" : "none";
		};

		// Update resource source visibility (for limited mode)
		const updateResourceSourceVisibility = () => {
			const sourceType = modal.querySelector("select[name='resourceSource']")?.value || "self";
			modal.querySelector(".custom-abilities__self-uses-options").style.display = sourceType === "self" ? "flex" : "none";
			modal.querySelector(".custom-abilities__linked-resource-options").style.display = sourceType === "linked" ? "flex" : "none";
			modal.querySelector(".custom-abilities__new-resource-options").style.display = sourceType === "new" ? "flex" : "none";
		};

		// Update toggleable resource cost visibility
		const updateToggleableResourceVisibility = () => {
			const hasResourceCost = modal.querySelector("input[name='hasResourceCost']")?.checked;
			modal.querySelector(".custom-abilities__toggleable-resource-details").style.display = hasResourceCost ? "flex" : "none";
		};

		// Event handlers
		modal.querySelectorAll("input[name='mode']").forEach(r => r.addEventListener("change", updateModeVisibility));
		modal.querySelector("select[name='resourceSource']")?.addEventListener("change", updateResourceSourceVisibility);
		modal.querySelector("input[name='hasResourceCost']")?.addEventListener("change", updateToggleableResourceVisibility);

		// Icon picker
		const iconPreview = modal.querySelector(".custom-abilities__icon-preview");
		const iconDropdown = modal.querySelector(".custom-abilities__icon-dropdown");
		const iconHidden = modal.querySelector("input[name='icon']");
		const iconCustomInput = modal.querySelector(".custom-abilities__icon-custom input");

		const updateIcon = (newIcon) => {
			iconPreview.textContent = newIcon;
			iconHidden.value = newIcon;
			iconDropdown.classList.remove("custom-abilities__icon-dropdown--open");
		};

		iconPreview.addEventListener("click", (e) => {
			e.stopPropagation();
			iconDropdown.classList.toggle("custom-abilities__icon-dropdown--open");
		});

		modal.querySelectorAll(".custom-abilities__icon-option").forEach(btn => {
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				updateIcon(btn.dataset.icon);
			});
		});

		iconCustomInput.addEventListener("input", (e) => {
			if (e.target.value.trim()) {
				updateIcon(e.target.value.trim().slice(0, 2));
			}
		});

		// Close icon dropdown when clicking outside
		modal.addEventListener("click", (e) => {
			if (!e.target.closest(".custom-abilities__icon-picker")) {
				iconDropdown.classList.remove("custom-abilities__icon-dropdown--open");
			}
		});

		// Editor mode toggle
		modal.querySelectorAll(".custom-abilities__editor-mode-btn").forEach(btn => {
			btn.addEventListener("click", () => {
				const newMode = btn.dataset.mode;
				if (newMode === currentMode) return;

				// Sync data when switching modes
				if (currentMode === "simple" && newMode === "advanced") {
					const data = syncFormToJson();
					modal.querySelector(".custom-abilities__json-editor").value = JSON.stringify(data, null, 2);
				} else if (currentMode === "advanced" && newMode === "simple") {
					try {
						const data = JSON.parse(modal.querySelector(".custom-abilities__json-editor").value);
						syncJsonToForm(data);
					} catch (e) {
						alert("Invalid JSON. Please fix errors before switching to Simple mode.");
						return;
					}
				}

				currentMode = newMode;
				modal.querySelectorAll(".custom-abilities__editor-mode-btn").forEach(b => b.classList.remove("custom-abilities__editor-mode-btn--active"));
				btn.classList.add("custom-abilities__editor-mode-btn--active");
				modal.querySelector("[data-editor='simple']").style.display = newMode === "simple" ? "" : "none";
				modal.querySelector("[data-editor='advanced']").style.display = newMode === "advanced" ? "" : "none";
			});
		});

		// Add effect
		modal.querySelector(".custom-abilities__add-effect-btn").addEventListener("click", () => {
			effects.push({type: "ac", value: 0});
			renderEffectsList();
		});

		// Close handlers
		const closeModal = () => modal.remove();
		modal.querySelector(".modal-close").addEventListener("click", closeModal);
		modal.querySelector(".custom-abilities__cancel-btn").addEventListener("click", closeModal);
		modal.addEventListener("click", (e) => {
			if (e.target === modal) closeModal();
		});

		// Save handler
		modal.querySelector(".custom-abilities__save-btn").addEventListener("click", () => {
			let data;

			if (currentMode === "advanced") {
				try {
					data = JSON.parse(modal.querySelector(".custom-abilities__json-editor").value);
				} catch (e) {
					alert("Invalid JSON: " + e.message);
					return;
				}
			} else {
				data = syncFormToJson();
			}

			if (!data.name?.trim()) {
				alert("Please enter a name for the ability.");
				return;
			}

			if (isEditing) {
				state.updateCustomAbility(abilityId, data);
			} else {
				state.addCustomAbility(data);
			}

			closeModal();
			this.render();
			this._sheet._updateAllCalculations?.();
			this._sheet._renderOverviewAbilities?.();
			this._sheet._renderResources?.();
			this._sheet._combat?.renderCombatActions?.();
			this._sheet._saveCurrentCharacter?.();
		});

		// Size increment/decrement handlers
		modal.querySelector(".custom-abilities__size-inc")?.addEventListener("click", () => {
			sizeChange = Math.min(sizeChange + 1, 5); // Max 5 size categories
			renderSizeReachUI();
		});
		modal.querySelector(".custom-abilities__size-dec")?.addEventListener("click", () => {
			sizeChange = Math.max(sizeChange - 1, -5); // Min -5 size categories
			renderSizeReachUI();
		});

		// Reach increment/decrement handlers
		modal.querySelector(".custom-abilities__reach-inc")?.addEventListener("click", () => {
			reachBonus = Math.min(reachBonus + 1, 10); // Max +50 ft reach
			renderSizeReachUI();
		});
		modal.querySelector(".custom-abilities__reach-dec")?.addEventListener("click", () => {
			reachBonus = Math.max(reachBonus - 1, -10); // Min -50 ft (for curses)
			renderSizeReachUI();
		});

		// Add bonus damage handler
		modal.querySelector("#add-bonus-damage-btn")?.addEventListener("click", () => {
			bonusDamage.push({type: "fire", dice: "1d6"});
			renderBonusDamageList();
		});

		// Add reroll handler
		modal.querySelector("#add-reroll-btn")?.addEventListener("click", () => {
			rerolls.push({trigger: "1", rollType: "attack"});
			renderRerollsUI();
		});

		// Critical range handlers
		modal.querySelector("#critrange-enabled")?.addEventListener("change", e => {
			critRangeConfig.enabled = e.target.checked;
			renderCritRangeUI();
		});
		modal.querySelectorAll("input[name='critRangeMode']").forEach(radio => {
			radio.addEventListener("change", e => {
				critRangeConfig.mode = e.target.value;
				renderCritRangeUI();
			});
		});
		modal.querySelector("#critrange-set-value")?.addEventListener("change", e => {
			critRangeConfig.value = parseInt(e.target.value) || 19;
		});
		modal.querySelector("#critrange-expand-value")?.addEventListener("change", e => {
			critRangeConfig.expand = Math.max(1, Math.min(19, parseInt(e.target.value) || 1));
			renderCritRangeUI();
		});

		// Temp HP handlers
		modal.querySelector("#temphp-enabled")?.addEventListener("change", e => {
			tempHpConfig.enabled = e.target.checked;
			renderTempHpUI();
		});
		modal.querySelectorAll("input[name='tempHpMode']").forEach(radio => {
			radio.addEventListener("change", e => {
				tempHpConfig.mode = e.target.value;
				renderTempHpUI();
			});
		});
		modal.querySelector("#temphp-static-value")?.addEventListener("change", e => {
			tempHpConfig.value = Math.max(1, parseInt(e.target.value) || 5);
		});
		modal.querySelector("#temphp-dice-value")?.addEventListener("change", e => {
			tempHpConfig.dice = e.target.value.trim() || "1d4+4";
		});
		modal.querySelector("#temphp-on-activation")?.addEventListener("change", e => {
			tempHpConfig.onActivation = e.target.checked;
		});

		// Initialize
		renderEffectsList();
		renderGrantsUI();
		renderDefensiveTraitsUI();
		renderSizeReachUI();
		renderBonusDamageList();
		renderRerollsUI();
		renderCritRangeUI();
		renderTempHpUI();

		// Update initial grant counts
		this._updateGrantCount(modal, "grants-spell-count", grants.spells.length);
		this._updateGrantCount(modal, "grants-feature-count", grants.features.length);
		this._updateProfCount(modal, grants);

		if (existingAbility) {
			modal.querySelector(".custom-abilities__json-editor").value = JSON.stringify(existingAbility, null, 2);
		}

		// Focus name input
		setTimeout(() => modal.querySelector("input[name='name']").focus(), 100);
	}

	// #region Grants Rendering Helpers

	/**
	 * Get hover link HTML for a spell
	 */
	_getSpellHoverLink (spell) {
		try {
			const source = spell.source || Parser.SRC_PHB;
			const hash = UrlUtil.encodeForHash([spell.name, source].join(HASH_LIST_SEP));
			const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_SPELLS, source, hash});
			return `<a href="${UrlUtil.PG_SPELLS}#${hash}" ${hoverAttrs} class="custom-abilities__hover-link">${spell.name}</a>`;
		} catch (e) {
			return spell.name;
		}
	}

	/**
	 * Get hover link HTML for an optional feature
	 */
	_getOptFeatureHoverLink (feature) {
		try {
			const source = feature.source || Parser.SRC_PHB;
			const hash = UrlUtil.encodeForHash([feature.name, source].join(HASH_LIST_SEP));
			const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_OPT_FEATURES, source, hash});
			return `<a href="${UrlUtil.PG_OPT_FEATURES}#${hash}" ${hoverAttrs} class="custom-abilities__hover-link">${feature.name}</a>`;
		} catch (e) {
			return feature.name;
		}
	}

	/**
	 * Update grant count badge
	 */
	_updateGrantCount (modal, elementId, count) {
		const countEl = modal.querySelector(`#${elementId}`);
		if (countEl) {
			countEl.textContent = count > 0 ? `(${count})` : "";
			countEl.classList.toggle("has-items", count > 0);
		}
	}

	/**
	 * Render spells grant section with improved UI
	 */
	_renderGrantsSpells (modal, grants, allSpells) {
		const searchInput = modal.querySelector("#grants-spell-search");
		const levelFilter = modal.querySelector("#grants-spell-level-filter");
		const schoolFilter = modal.querySelector("#grants-spell-school-filter");
		const listContainer = modal.querySelector("#grants-spell-list");
		const selectedContainer = modal.querySelector("#grants-spell-selected");

		const renderSpellList = () => {
			const searchTerm = searchInput?.value.toLowerCase() || "";
			const levelFilterVal = levelFilter?.value || "";
			const schoolFilterVal = schoolFilter?.value || "";

			let filteredSpells = allSpells.filter(s => {
				if (searchTerm && !s.name.toLowerCase().includes(searchTerm)) return false;
				if (levelFilterVal !== "" && String(s.level) !== levelFilterVal) return false;
				if (schoolFilterVal && s.school !== schoolFilterVal) return false;
				// Hide already selected spells
				if (grants.spells.some(gs => gs.name === s.name && gs.source === s.source)) return false;
				return true;
			}).slice(0, 30);

			if (!searchTerm && !levelFilterVal && !schoolFilterVal) {
				listContainer.innerHTML = `<div class="custom-abilities__grants-hint">Type to search or use filters above</div>`;
				return;
			}

			listContainer.innerHTML = filteredSpells.map(s => {
				const levelStr = s.level === 0 ? "Cantrip" : `${s.level}${Parser.getOrdinalForm(s.level)}`;
				const schoolStr = Parser.spSchoolAbvToFull(s.school) || "";
				return `
					<div class="custom-abilities__grants-item" data-name="${s.name}" data-source="${s.source}" data-level="${s.level}">
						<div class="custom-abilities__grants-item-info">
							${this._getSpellHoverLink(s)}
							<span class="custom-abilities__grants-item-meta">${levelStr} ${schoolStr}</span>
						</div>
						<button type="button" class="btn btn-xs btn-primary custom-abilities__grants-add-btn">Add</button>
					</div>
				`;
			}).join("") || `<div class="custom-abilities__grants-empty">No matching spells</div>`;

			// Bind add buttons
			listContainer.querySelectorAll(".custom-abilities__grants-add-btn").forEach(btn => {
				btn.addEventListener("click", (e) => {
					e.preventDefault();
					const item = btn.closest(".custom-abilities__grants-item");
					const name = item.dataset.name;
					const source = item.dataset.source;
					const level = parseInt(item.dataset.level);

					if (!grants.spells.some(s => s.name === name && s.source === source)) {
						grants.spells.push({name, source, level, atWill: level === 0, uses: level === 0 ? null : 1, recharge: "long"});
					}
					renderSpellList();
					renderSelectedSpells();
				});
			});
		};

		const renderSelectedSpells = () => {
			this._updateGrantCount(modal, "grants-spell-count", grants.spells.length);

			if (!grants.spells.length) {
				selectedContainer.innerHTML = `<div class="custom-abilities__grants-empty-selected">No spells selected</div>`;
				return;
			}

			selectedContainer.innerHTML = grants.spells.map(s => {
				const spellData = allSpells.find(sp => sp.name === s.name && sp.source === s.source) || s;
				const levelStr = s.level === 0 ? "Cantrip" : `${s.level}${Parser.getOrdinalForm(s.level)}`;
				const isAtWill = s.atWill || s.level === 0;

				return `
					<div class="custom-abilities__grants-selected-item" data-name="${s.name}" data-source="${s.source}">
						<div class="custom-abilities__grants-selected-info">
							${this._getSpellHoverLink(spellData)}
							<span class="custom-abilities__grants-item-meta">${levelStr}</span>
						</div>
						<div class="custom-abilities__grants-selected-options">
							${s.level > 0 ? `
								<label class="custom-abilities__grants-option">
									<input type="checkbox" class="spell-at-will" ${isAtWill ? "checked" : ""}>
									<span>At Will</span>
								</label>
								${!isAtWill ? `
									<label class="custom-abilities__grants-option">
										<span>Uses:</span>
										<input type="number" class="ve-form-control spell-uses" value="${s.uses || 1}" min="1" max="10" style="width: 50px;">
									</label>
									<select class="ve-form-control spell-recharge" style="width: 80px;">
										<option value="long" ${s.recharge !== "short" ? "selected" : ""}>Long</option>
										<option value="short" ${s.recharge === "short" ? "selected" : ""}>Short</option>
									</select>
								` : ""}
							` : `<span class="ve-muted ve-small">At Will</span>`}
						</div>
						<button type="button" class="btn btn-xs btn-danger custom-abilities__grants-remove-btn">&times;</button>
					</div>
				`;
			}).join("");

			// Bind handlers
			selectedContainer.querySelectorAll(".custom-abilities__grants-selected-item").forEach(item => {
				const name = item.dataset.name;
				const source = item.dataset.source;
				const spell = grants.spells.find(s => s.name === name && s.source === source);
				if (!spell) return;

				// At-will toggle
				const atWillCb = item.querySelector(".spell-at-will");
				if (atWillCb) {
					atWillCb.addEventListener("change", () => {
						spell.atWill = atWillCb.checked;
						renderSelectedSpells();
					});
				}

				// Uses input
				const usesInput = item.querySelector(".spell-uses");
				if (usesInput) {
					usesInput.addEventListener("change", () => {
						spell.uses = parseInt(usesInput.value) || 1;
					});
				}

				// Recharge select
				const rechargeSelect = item.querySelector(".spell-recharge");
				if (rechargeSelect) {
					rechargeSelect.addEventListener("change", () => {
						spell.recharge = rechargeSelect.value;
					});
				}

				// Remove button
				item.querySelector(".custom-abilities__grants-remove-btn")?.addEventListener("click", (e) => {
					e.preventDefault();
					grants.spells = grants.spells.filter(s => !(s.name === name && s.source === source));
					renderSpellList();
					renderSelectedSpells();
				});
			});
		};

		searchInput?.addEventListener("input", renderSpellList);
		levelFilter?.addEventListener("change", renderSpellList);
		schoolFilter?.addEventListener("change", renderSpellList);

		renderSpellList();
		renderSelectedSpells();
	}

	/**
	 * Helper to find a skill in the grants.proficiencies.skills array
	 * Handles both string and object formats
	 */
	_findGrantedSkill (skills, skillName) {
		return skills.findIndex(s => {
			if (typeof s === "string") return s === skillName;
			return s.name === skillName;
		});
	}

	/**
	 * Helper to get skill expertise status
	 */
	_getGrantedSkillExpertise (skills, skillName) {
		const skill = skills.find(s => {
			if (typeof s === "string") return s === skillName;
			return s.name === skillName;
		});
		if (!skill) return null;
		if (typeof skill === "string") return false;
		return skill.expertise || false;
	}

	/**
	 * Render skills grant section with pill-based selection and expertise toggle
	 */
	_renderGrantsSkills (modal, grants, skillsList) {
		const container = modal.querySelector("#grants-skills-list");
		if (!container) return;

		const render = () => {
			container.innerHTML = skillsList.map(skill => {
				const isSelected = this._findGrantedSkill(grants.proficiencies.skills, skill.name) >= 0;
				const hasExpertise = this._getGrantedSkillExpertise(grants.proficiencies.skills, skill.name);
				const stateClass = hasExpertise ? "expertise" : (isSelected ? "selected" : "");
				const stateLabel = hasExpertise ? " (E)" : "";
				return `
					<button type="button" class="custom-abilities__grants-pill ${stateClass}" data-skill="${skill.name}" title="Click to add, click again for expertise, click again to remove">
						${skill.name}${stateLabel}
					</button>
				`;
			}).join("");

			container.querySelectorAll(".custom-abilities__grants-pill").forEach(btn => {
				btn.addEventListener("click", () => {
					const skillName = btn.dataset.skill;
					const idx = this._findGrantedSkill(grants.proficiencies.skills, skillName);
					const hasExpertise = this._getGrantedSkillExpertise(grants.proficiencies.skills, skillName);

					if (idx < 0) {
						// Not selected -> add as proficient
						grants.proficiencies.skills.push({name: skillName, expertise: false});
					} else if (!hasExpertise) {
						// Proficient -> upgrade to expertise
						grants.proficiencies.skills[idx] = {name: skillName, expertise: true};
					} else {
						// Expertise -> remove
						grants.proficiencies.skills.splice(idx, 1);
					}
					render();
					this._updateProfCount(modal, grants);
				});
			});
		};

		render();
	}

	/**
	 * Update proficiency count badge
	 */
	_updateProfCount (modal, grants) {
		const count = grants.proficiencies.skills.length +
			grants.proficiencies.tools.length +
			grants.proficiencies.weapons.length +
			grants.proficiencies.armor.length +
			grants.proficiencies.languages.length;
		this._updateGrantCount(modal, "grants-prof-count", count);
	}

	/**
	 * Render proficiency input section with improved styling
	 */
	_renderProficiencyInputSection (modal, grants, type, inputId, addBtnId, selectedContainerId) {
		const input = modal.querySelector(`#${inputId}`);
		const addBtn = modal.querySelector(`#${addBtnId}`);
		const selectedContainer = modal.querySelector(`#${selectedContainerId}`);

		const renderSelected = () => {
			const items = grants.proficiencies[type] || [];
			selectedContainer.innerHTML = items.map(item => `
				<span class="custom-abilities__grants-selected-pill">
					${item}
					<button type="button" class="custom-abilities__grants-pill-remove" data-item="${item}">&times;</button>
				</span>
			`).join("");

			selectedContainer.querySelectorAll(".custom-abilities__grants-pill-remove").forEach(btn => {
				btn.addEventListener("click", (e) => {
					e.preventDefault();
					const itemToRemove = btn.dataset.item;
					grants.proficiencies[type] = grants.proficiencies[type].filter(i => i !== itemToRemove);
					renderSelected();
					this._updateProfCount(modal, grants);
				});
			});
		};

		const addItem = () => {
			const value = input?.value.trim();
			if (!value) return;
			if (!grants.proficiencies[type].includes(value)) {
				grants.proficiencies[type].push(value);
			}
			input.value = "";
			renderSelected();
			this._updateProfCount(modal, grants);
		};

		addBtn?.addEventListener("click", addItem);
		input?.addEventListener("keypress", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				addItem();
			}
		});

		renderSelected();
	}

	/**
	 * Render tools grant section with datalist suggestions
	 */
	_renderGrantsTools (modal, grants, toolsList) {
		// Populate datalist with tools
		const datalist = modal.querySelector("#grants-tools-datalist");
		if (datalist && toolsList.length) {
			datalist.innerHTML = toolsList.map(t => `<option value="${t.name}">`).join("");
		}
		
		this._renderProficiencyInputSection(modal, grants, "tools", "grants-tools-input", "grants-tools-add", "grants-tools-selected");
	}

	/**
	 * Render languages grant section with datalist suggestions
	 */
	_renderGrantsLanguages (modal, grants, languagesList) {
		// Populate datalist with languages (includes homebrew)
		const datalist = modal.querySelector("#grants-languages-datalist");
		if (datalist && languagesList.length) {
			datalist.innerHTML = languagesList.map(l => `<option value="${l.name}">`).join("");
		}
		
		this._renderProficiencyInputSection(modal, grants, "languages", "grants-languages-input", "grants-languages-add", "grants-languages-selected");
	}

	/**
	 * Render weapons grant section with pill toggles
	 */
	_renderGrantsWeapons (modal, grants) {
		// Category pills
		modal.querySelectorAll(".custom-abilities__grants-pill[data-weapon]").forEach(btn => {
			const weapon = btn.dataset.weapon;
			btn.classList.toggle("selected", grants.proficiencies.weapons.includes(weapon));

			btn.addEventListener("click", () => {
				const idx = grants.proficiencies.weapons.indexOf(weapon);
				if (idx >= 0) {
					grants.proficiencies.weapons.splice(idx, 1);
				} else {
					grants.proficiencies.weapons.push(weapon);
				}
				btn.classList.toggle("selected", grants.proficiencies.weapons.includes(weapon));
				this._updateProfCount(modal, grants);
			});
		});

		// Specific weapons input - filter out category grants for display
		const weaponCategories = ["simple", "martial", "firearms"];
		const specificWeaponsContainer = modal.querySelector("#grants-weapons-selected");
		const input = modal.querySelector("#grants-weapons-input");
		const addBtn = modal.querySelector("#grants-weapons-add");

		const renderSpecific = () => {
			const specificWeapons = grants.proficiencies.weapons.filter(w => !weaponCategories.includes(w.toLowerCase()));
			specificWeaponsContainer.innerHTML = specificWeapons.map(item => `
				<span class="custom-abilities__grants-selected-pill">
					${item}
					<button type="button" class="custom-abilities__grants-pill-remove" data-item="${item}">&times;</button>
				</span>
			`).join("");

			specificWeaponsContainer.querySelectorAll(".custom-abilities__grants-pill-remove").forEach(btn => {
				btn.addEventListener("click", (e) => {
					e.preventDefault();
					const itemToRemove = btn.dataset.item;
					grants.proficiencies.weapons = grants.proficiencies.weapons.filter(i => i !== itemToRemove);
					renderSpecific();
					this._updateProfCount(modal, grants);
				});
			});
		};

		const addSpecific = () => {
			const value = input?.value.trim();
			if (!value || weaponCategories.includes(value.toLowerCase())) return;
			if (!grants.proficiencies.weapons.includes(value)) {
				grants.proficiencies.weapons.push(value);
			}
			input.value = "";
			renderSpecific();
			this._updateProfCount(modal, grants);
		};

		addBtn?.addEventListener("click", addSpecific);
		input?.addEventListener("keypress", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				addSpecific();
			}
		});

		renderSpecific();
	}

	/**
	 * Render armor grant section with pill toggles
	 */
	_renderGrantsArmor (modal, grants) {
		modal.querySelectorAll(".custom-abilities__grants-pill[data-armor]").forEach(btn => {
			const armor = btn.dataset.armor;
			btn.classList.toggle("selected", grants.proficiencies.armor.includes(armor));

			btn.addEventListener("click", () => {
				const idx = grants.proficiencies.armor.indexOf(armor);
				if (idx >= 0) {
					grants.proficiencies.armor.splice(idx, 1);
				} else {
					grants.proficiencies.armor.push(armor);
				}
				btn.classList.toggle("selected", grants.proficiencies.armor.includes(armor));
				this._updateProfCount(modal, grants);
			});
		});
	}

	/**
	 * Render optional features grant section with improved UI
	 */
	_renderGrantsFeatures (modal, grants, allOptionalFeatures) {
		const typeFilter = modal.querySelector("#grants-feature-type-filter");
		const sourceFilter = modal.querySelector("#grants-feature-source-filter");
		const searchInput = modal.querySelector("#grants-feature-search");
		const listContainer = modal.querySelector("#grants-feature-list");
		const selectedContainer = modal.querySelector("#grants-feature-selected");

		// Build dynamic type options including homebrew
		const typeSet = new Set();
		const sourceSet = new Set();
		allOptionalFeatures.forEach(f => {
			f.featureType?.forEach(ft => typeSet.add(ft));
			if (f.source) sourceSet.add(f.source);
		});

		// Populate type filter with homebrew types
		if (typeFilter) {
			const standardTypes = {
				"EI": "Eldritch Invocation",
				"MM": "Metamagic",
				"FS:F": "Fighting Style (Fighter)",
				"FS:P": "Fighting Style (Paladin)",
				"FS:R": "Fighting Style (Ranger)",
				"FS:B": "Fighting Style (Bard)",
				"MV": "Maneuver",
				"MV:B": "Maneuver (Battle Master)",
				"AI": "Artificer Infusion",
				"ED": "Elemental Discipline",
				"PB": "Pact Boon",
				"AS": "Arcane Shot",
				"RN": "Rune Knight Rune",
				"OR": "Onomancy Resonant",
				"AF": "Alchemical Formula",
				"TT": "Traveler's Trick",
				"OTH": "Other",
			};

			let optionsHtml = '<option value="">All Types</option>';
			// Standard types first
			Object.entries(standardTypes).forEach(([code, name]) => {
				if (typeSet.has(code)) {
					optionsHtml += `<option value="${code}">${name}</option>`;
				}
			});
			// Homebrew types (not in standard list)
			typeSet.forEach(code => {
				if (!standardTypes[code]) {
					const fullName = Parser.optFeatureTypeToFull?.(code) || code;
					optionsHtml += `<option value="${code}">${fullName} (Homebrew)</option>`;
				}
			});
			typeFilter.innerHTML = optionsHtml;
		}

		// Populate source filter
		if (sourceFilter) {
			let sourceOptions = '<option value="">All Sources</option>';
			[...sourceSet].sort().forEach(src => {
				const srcFull = Parser.sourceJsonToFull?.(src) || src;
				sourceOptions += `<option value="${src}">${srcFull}</option>`;
			});
			sourceFilter.innerHTML = sourceOptions;
		}

		const renderFeatureList = () => {
			const typeFilterVal = typeFilter?.value || "";
			const sourceFilterVal = sourceFilter?.value || "";
			const searchTerm = searchInput?.value.toLowerCase() || "";

			let filteredFeatures = allOptionalFeatures.filter(f => {
				if (typeFilterVal && (!f.featureType || !f.featureType.includes(typeFilterVal))) return false;
				if (sourceFilterVal && f.source !== sourceFilterVal) return false;
				if (searchTerm && !f.name.toLowerCase().includes(searchTerm)) return false;
				// Hide already selected
				if (grants.features.some(gf => gf.name === f.name && gf.source === f.source)) return false;
				return true;
			}).slice(0, 30);

			if (!searchTerm && !typeFilterVal && !sourceFilterVal) {
				listContainer.innerHTML = `<div class="custom-abilities__grants-hint">Select a type or search to browse features</div>`;
				return;
			}

			listContainer.innerHTML = filteredFeatures.map(f => {
				const typeStr = f.featureType?.map(ft => Parser.optFeatureTypeToFull?.(ft) || ft).join(", ") || "";
				const srcStr = Parser.sourceJsonToAbv?.(f.source) || f.source || "";
				return `
					<div class="custom-abilities__grants-item" data-name="${f.name}" data-source="${f.source}">
						<div class="custom-abilities__grants-item-info">
							${this._getOptFeatureHoverLink(f)}
							<span class="custom-abilities__grants-item-meta">${typeStr}</span>
							<span class="custom-abilities__grants-item-source">[${srcStr}]</span>
						</div>
						<button type="button" class="btn btn-xs btn-primary custom-abilities__grants-add-btn">Add</button>
					</div>
				`;
			}).join("") || `<div class="custom-abilities__grants-empty">No matching features</div>`;

			// Bind add buttons
			listContainer.querySelectorAll(".custom-abilities__grants-add-btn").forEach(btn => {
				btn.addEventListener("click", (e) => {
					e.preventDefault();
					const item = btn.closest(".custom-abilities__grants-item");
					const name = item.dataset.name;
					const source = item.dataset.source;

					const fullFeature = allOptionalFeatures.find(f => f.name === name && f.source === source);
					if (!grants.features.some(f => f.name === name && f.source === source)) {
						grants.features.push({
							name,
							source,
							featureType: fullFeature?.featureType?.[0] || "",
							entries: fullFeature?.entries,
							description: fullFeature?.entries ? Renderer.get().render({entries: fullFeature.entries}) : "",
						});
					}
					renderFeatureList();
					renderSelectedFeatures();
				});
			});
		};

		const renderSelectedFeatures = () => {
			this._updateGrantCount(modal, "grants-feature-count", grants.features.length);

			if (!grants.features.length) {
				selectedContainer.innerHTML = `<div class="custom-abilities__grants-empty-selected">No features selected</div>`;
				return;
			}

			selectedContainer.innerHTML = grants.features.map(f => {
				const featureData = allOptionalFeatures.find(of => of.name === f.name && of.source === f.source) || f;
				const typeStr = featureData.featureType?.map(ft => Parser.optFeatureTypeToFull?.(ft) || ft).join(", ") || f.featureType || "";
				return `
					<div class="custom-abilities__grants-selected-item" data-name="${f.name}" data-source="${f.source}">
						<div class="custom-abilities__grants-selected-info">
							${this._getOptFeatureHoverLink(featureData)}
							<span class="custom-abilities__grants-item-meta">${typeStr}</span>
						</div>
						<button type="button" class="btn btn-xs btn-danger custom-abilities__grants-remove-btn">&times;</button>
					</div>
				`;
			}).join("");

			// Bind remove buttons
			selectedContainer.querySelectorAll(".custom-abilities__grants-remove-btn").forEach(btn => {
				btn.addEventListener("click", (e) => {
					e.preventDefault();
					const item = btn.closest(".custom-abilities__grants-selected-item");
					const name = item.dataset.name;
					const source = item.dataset.source;
					grants.features = grants.features.filter(f => !(f.name === name && f.source === source));
					renderFeatureList();
					renderSelectedFeatures();
				});
			});
		};

		typeFilter?.addEventListener("change", renderFeatureList);
		sourceFilter?.addEventListener("change", renderFeatureList);
		searchInput?.addEventListener("input", renderFeatureList);

		renderFeatureList();
		renderSelectedFeatures();
	}

	/**
	 * Get list of standard damage types plus any custom ones from data
	 * @returns {string[]} List of damage type strings
	 */
	_getDamageTypesList () {
		return [
			"acid", "bludgeoning", "cold", "fire", "force", "lightning",
			"necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
		];
	}

	/**
	 * Generate HTML options for damage type dropdown selects
	 * @returns {string} HTML string of option elements
	 */
	_getDamageTypeOptionsHtml () {
		const types = this._getDamageTypesList();
		return types.map(t => `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join("");
	}

	/**
	 * Get unique condition names from all available conditions, applying priority source filtering
	 * Returns objects with {name, source} for hover support
	 * @returns {Array<{name: string, source: string}>} List of unique conditions with sources
	 */
	_getConditionsWithSources () {
		const conditionsList = this._sheet.getConditionsList?.() || [];
		const state = this._sheet.getState?.();
		const prioritySources = state?.getPrioritySources?.() || [];
		
		// Group conditions by name, preferring priority sources, then XPHB
		const conditionMap = new Map();
		conditionsList.forEach(cond => {
			const existing = conditionMap.get(cond.name.toLowerCase());
			if (!existing) {
				conditionMap.set(cond.name.toLowerCase(), {name: cond.name, source: cond.source});
			} else if (prioritySources.length) {
				// If we have priority sources, prefer those
				const existingIsPriority = prioritySources.includes(existing.source);
				const newIsPriority = prioritySources.includes(cond.source);
				if (newIsPriority && !existingIsPriority) {
					conditionMap.set(cond.name.toLowerCase(), {name: cond.name, source: cond.source});
				}
			} else if (cond.source === Parser.SRC_XPHB && existing.source !== Parser.SRC_XPHB) {
				// Default: prefer XPHB
				conditionMap.set(cond.name.toLowerCase(), {name: cond.name, source: cond.source});
			}
		});
		
		return Array.from(conditionMap.values()).sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Render defensive traits section (resistances, immunities, vulnerabilities, condition immunities)
	 * @param {Element} modal - The modal element
	 * @param {object} defensiveTraits - The defensive traits object
	 * @param {string[]} damageTypes - List of damage types
	 * @param {string[]} conditions - List of condition names
	 */
	_renderDefensiveTraits (modal, defensiveTraits, damageTypes, conditions) {
		// Render damage type pills for resistances
		this._renderDamageTypePills(
			modal,
			"#defensive-resistances",
			"#defensive-resistance-custom",
			"#defensive-resistance-add",
			"#defensive-resistances-count",
			defensiveTraits.resistances,
			damageTypes,
			"resistance",
		);

		// Render damage type pills for immunities
		this._renderDamageTypePills(
			modal,
			"#defensive-immunities",
			"#defensive-immunity-custom",
			"#defensive-immunity-add",
			"#defensive-immunities-count",
			defensiveTraits.immunities,
			damageTypes,
			"immunity",
		);

		// Render damage type pills for vulnerabilities
		this._renderDamageTypePills(
			modal,
			"#defensive-vulnerabilities",
			"#defensive-vulnerability-custom",
			"#defensive-vulnerability-add",
			"#defensive-vulnerabilities-count",
			defensiveTraits.vulnerabilities,
			damageTypes,
			"vulnerability",
		);

		// Render condition immunity pills
		this._renderConditionImmunityPills(
			modal,
			"#defensive-conditions",
			"#defensive-condition-custom",
			"#defensive-condition-add",
			"#defensive-conditions-count",
			defensiveTraits.conditionImmunities,
			conditions,
		);
	}

	/**
	 * Render damage type pills for a defensive trait category
	 */
	_renderDamageTypePills (modal, containerSelector, customInputSelector, addBtnSelector, countSelector, selectedTypes, allTypes, traitType) {
		const container = modal.querySelector(containerSelector);
		const customInput = modal.querySelector(customInputSelector);
		const addBtn = modal.querySelector(addBtnSelector);

		if (!container) return;

		// Combine standard types with any custom selected ones
		const allTypesSet = new Set([...allTypes, ...selectedTypes]);
		const sortedTypes = [...allTypesSet].sort();

		// Render pills
		container.innerHTML = sortedTypes.map(type => {
			const isSelected = selectedTypes.includes(type);
			const isCustom = !allTypes.includes(type);
			return `
				<button type="button" 
					class="custom-abilities__defensive-pill ${isSelected ? "selected" : ""} ${isCustom ? "custom" : ""}" 
					data-type="${type}"
					data-trait-type="${traitType}"
					title="${type.charAt(0).toUpperCase() + type.slice(1)}${isCustom ? " (custom)" : ""}">
					${type.charAt(0).toUpperCase() + type.slice(1)}
				</button>
			`;
		}).join("");

		// Bind pill click handlers
		container.querySelectorAll(".custom-abilities__defensive-pill").forEach(pill => {
			pill.addEventListener("click", () => {
				const type = pill.dataset.type;
				const idx = selectedTypes.indexOf(type);
				if (idx >= 0) {
					selectedTypes.splice(idx, 1);
					pill.classList.remove("selected");
				} else {
					selectedTypes.push(type);
					pill.classList.add("selected");
				}
				this._updateDefensiveCount(modal, countSelector, selectedTypes.length);
			});
		});

		// Custom type input
		if (addBtn && customInput) {
			addBtn.onclick = () => {
				const customType = customInput.value.trim().toLowerCase();
				if (customType && !selectedTypes.includes(customType)) {
					selectedTypes.push(customType);
					customInput.value = "";
					// Re-render to show the new custom type
					this._renderDamageTypePills(modal, containerSelector, customInputSelector, addBtnSelector, countSelector, selectedTypes, allTypes, traitType);
				}
			};
			customInput.onkeydown = (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					addBtn.click();
				}
			};
		}

		this._updateDefensiveCount(modal, countSelector, selectedTypes.length);
	}

	/**
	 * Render condition immunity pills
	 * @param {Element} modal - The modal element
	 * @param {string} containerSelector - Selector for the pills container
	 * @param {string} customInputSelector - Selector for the custom input
	 * @param {string} addBtnSelector - Selector for the add button
	 * @param {string} countSelector - Selector for the count badge
	 * @param {string[]} selectedConditions - Array of selected condition names
	 * @param {Array<{name: string, source: string}>} allConditions - Array of condition objects with sources
	 */
	_renderConditionImmunityPills (modal, containerSelector, customInputSelector, addBtnSelector, countSelector, selectedConditions, allConditions) {
		const container = modal.querySelector(containerSelector);
		const customInput = modal.querySelector(customInputSelector);
		const addBtn = modal.querySelector(addBtnSelector);

		if (!container) return;

		// Build map of condition names to their source info
		const conditionSourceMap = new Map();
		allConditions.forEach(c => conditionSourceMap.set(c.name.toLowerCase(), c));

		// Get all condition names (lowercased for comparison)
		const allConditionNames = allConditions.map(c => c.name);
		const allConditionNamesLower = allConditionNames.map(c => c.toLowerCase());
		const selectedLower = selectedConditions.map(c => c.toLowerCase());
		
		// Find custom conditions (selected but not in allConditions)
		const customConditions = selectedConditions.filter(c => !allConditionNamesLower.includes(c.toLowerCase()));
		
		// Combine standard and custom
		const allDisplayConditions = [...allConditionNames, ...customConditions].sort();

		// Render pills
		container.innerHTML = allDisplayConditions.map(condName => {
			const isSelected = selectedLower.includes(condName.toLowerCase());
			const condInfo = conditionSourceMap.get(condName.toLowerCase());
			const isCustom = !condInfo;
			
			// Build hover attributes for known conditions
			let hoverAttrs = "";
			if (condInfo) {
				try {
					const hash = UrlUtil.encodeForHash([condInfo.name, condInfo.source].join(HASH_LIST_SEP));
					hoverAttrs = Renderer.hover.getHoverElementAttributes({
						page: UrlUtil.PG_CONDITIONS_DISEASES,
						source: condInfo.source,
						hash: hash,
					});
				} catch {
					// Ignore hover errors
				}
			}
			
			return `
				<button type="button" 
					class="custom-abilities__defensive-pill condition ${isSelected ? "selected" : ""} ${isCustom ? "custom" : ""}" 
					data-condition="${condName}"
					data-trait-type="conditionImmunity"
					${hoverAttrs}>
					${condName}${isCustom ? " (custom)" : ""}
				</button>
			`;
		}).join("");

		// Bind pill click handlers
		container.querySelectorAll(".custom-abilities__defensive-pill").forEach(pill => {
			pill.addEventListener("click", () => {
				const cond = pill.dataset.condition;
				const idx = selectedConditions.findIndex(c => c.toLowerCase() === cond.toLowerCase());
				if (idx >= 0) {
					selectedConditions.splice(idx, 1);
					pill.classList.remove("selected");
				} else {
					selectedConditions.push(cond);
					pill.classList.add("selected");
				}
				this._updateDefensiveCount(modal, countSelector, selectedConditions.length);
			});
		});

		// Custom condition input
		if (addBtn && customInput) {
			addBtn.onclick = () => {
				const customCond = customInput.value.trim();
				if (customCond && !selectedConditions.some(c => c.toLowerCase() === customCond.toLowerCase())) {
					selectedConditions.push(customCond);
					customInput.value = "";
					// Re-render to show the new custom condition
					this._renderConditionImmunityPills(modal, containerSelector, customInputSelector, addBtnSelector, countSelector, selectedConditions, allConditions);
				}
			};
			customInput.onkeydown = (e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					addBtn.click();
				}
			};
		}

		this._updateDefensiveCount(modal, countSelector, selectedConditions.length);
	}

	/**
	 * Update defensive trait count badge
	 */
	_updateDefensiveCount (modal, selector, count) {
		const countEl = modal.querySelector(selector);
		if (countEl) {
			countEl.textContent = count > 0 ? `(${count})` : "";
			countEl.classList.toggle("has-items", count > 0);
		}
	}

	// #endregion
}

// Export for ES modules
export {CharacterSheetCustomAbilities};
