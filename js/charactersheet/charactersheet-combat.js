/**
 * Character Sheet Combat Manager
 * Handles attacks, weapons, and combat-related actions
 */
const {e_, ee} = /** @type {*} */ (globalThis);

class CharacterSheetCombat {
	constructor (page) {
		this._page = page;
		this._state = page.getState();
		this._allItems = [];
		this._cachedAttacks = [];
		this._sneakAttackEnabled = false; // Toggle for including Sneak Attack in damage rolls
		this._lastSneakAttackRoundUsed = null;
		this._lastAttackContext = null;
		this._sneakAttackHasAdjacentAlly = false;
		this._selectedCunningStrikes = []; // Active CS option selections for current attack
		this._turnActionUsage = {action: false, bonus: false, reaction: false};
		this._handOfHarmUsedThisTurn = false;

		this._init();
	}

	_init () {
		this._initEventListeners();
	}

	setItems (items) {
		this._allItems = items.filter(i => i.weapon);
	}

	_initEventListeners () {
		// Add attack button - support both ID variants
		document.getElementById("charsheet-add-attack")?.addEventListener("click", () => this._showAttackCreator());
		document.getElementById("charsheet-btn-add-attack")?.addEventListener("click", () => this._showAttackCreator());

		// Roll attack (Shift=Advantage, Ctrl=Disadvantage)
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__attack-roll");
			if (!target) return;
			const attackId = target.closest(".charsheet__attack-item")?.dataset.attackId;
			this._rollAttack(attackId, e);
		});

		// Roll damage
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__attack-damage");
			if (!target) return;
			const attackId = target.closest(".charsheet__attack-item")?.dataset.attackId;
			this._rollDamage(attackId);
		});

		// Edit attack
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__attack-edit");
			if (!target) return;
			const attackId = target.closest(".charsheet__attack-item")?.dataset.attackId;
			this._editAttack(attackId);
		});

		// Remove attack
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__attack-remove");
			if (!target) return;
			const attackId = target.closest(".charsheet__attack-item")?.dataset.attackId;
			this._removeAttack(attackId);
		});

		// Attack note
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__attack-note");
			if (!target) return;
			const attackId = target.closest(".charsheet__attack-item")?.dataset.attackId;
			const attack = this._state.getAttacks().find(a => a.id === attackId);
			if (!attack) return;
			const renderFn = () => this.renderAttacks();
			this._page.getNotes()?.showNoteModal(
				"attack",
				attackId,
				attack.name,
				renderFn,
			);
		});

		// Initiative roll (Shift=Advantage, Ctrl=Disadvantage)
		document.getElementById("charsheet-roll-initiative")?.addEventListener("click", (/** @type {*} */ e) => this._rollInitiative(e));

		// Death save buttons
		document.getElementById("charsheet-death-save-success")?.addEventListener("click", () => this._rollDeathSave(true));
		document.getElementById("charsheet-death-save-failure")?.addEventListener("click", () => this._rollDeathSave(false));
		document.getElementById("charsheet-death-save-reset")?.addEventListener("click", () => this._resetDeathSaves());

		// Combat spell casting
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__combat-spell-cast");
			if (!target) return;
			const spellId = target.dataset.spellId;
			this._castCombatSpell(spellId);
		});

		// Combat Methods: use method (spend stamina)
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__method-use");
			if (!target) return;
			const methodId = target.dataset.methodId;
			this._useMethod(methodId);
		});

		// Combat Methods: choose weapon for weapon-modifier methods
		document.addEventListener("click", (/** @type {*} */ e) => {
			const target = e.target.closest(".charsheet__method-choose-weapon");
			if (!target) return;
			const methodId = target.dataset.methodId;
			this._chooseWeaponForMethod(methodId);
		});

		// Stamina controls
		document.getElementById("charsheet-stamina-add")?.addEventListener("click", () => this._modifyStamina(1));
		document.getElementById("charsheet-stamina-remove")?.addEventListener("click", () => this._modifyStamina(-1));

		// Combat Methods: add/manage methods
		document.getElementById("charsheet-btn-add-method")?.addEventListener("click", () => this._showMethodPicker());

		// Add condition button in combat tab
		document.getElementById("charsheet-combat-add-condition")?.addEventListener("click", () => this._onAddCondition());
	}

	/**
	 * Add a condition from the combat tab
	 */
	async _onAddCondition () {
		// Delegate to main page's add condition method
		await this._page._onAddCondition?.();
		// Sync the combat tab
		this.renderCombatConditions();
		this.renderCombatEffects();
		this.renderCombatDefenses();
	}

	async _castCombatSpell (spellId) {
		// Delegate to the spells module if available
		if (this._page._spells) {
			await this._page._spells._castSpell(spellId);
			this.renderCombatSpells(); // Refresh to update slot display
			this.renderCombatStates(); // Refresh to show concentration
			this.renderCombatEffects(); // Refresh effects
		} else {
			JqueryUtil.doToast({type: "warning", content: "Spells module not available."});
		}
	}

	async _showAttackCreator () {
		await this._pShowAttackModal();
	}

	async _pShowAttackModal (existingAttack = null) {
		const isEdit = !!existingAttack;
		const attack = existingAttack || {
			name: "",
			attackBonus: 0,
			damage: "1d6",
			damageType: "slashing",
			damageBonus: 0,
			range: "",
			properties: [],
			isMelee: true,
			abilityMod: "str",
		};

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `${isEdit ? "⚔️ Edit" : "➕ Add"} Attack`,
			isMinHeight0: true,
		});

		// Add custom modal class
		modalInner.classList.add("charsheet__attack-modal");

		// Build enhanced form with sections
		const content = e_({tag: "div", clazz: "charsheet__attack-form"});
		modalInner.append(content);

		// Main Info Section
		const mainSection = e_({outer: `
			<div class="charsheet__attack-section">
				<div class="charsheet__attack-section-header">
					<span class="charsheet__attack-section-icon">📋</span>
					<span class="charsheet__attack-section-title">Basic Information</span>
				</div>
				<div class="charsheet__attack-field">
					<label class="charsheet__attack-label">Attack Name</label>
					<input type="text" class="charsheet__attack-input charsheet__attack-input--name" value="${attack.name}" placeholder="e.g., Longsword, Eldritch Blast">
				</div>
				<div class="charsheet__attack-field-row">
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Type</label>
						<select class="charsheet__attack-select">
							<option value="melee" ${attack.isMelee ? "selected" : ""}>⚔️ Melee</option>
							<option value="ranged" ${!attack.isMelee ? "selected" : ""}>🏹 Ranged</option>
						</select>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Ability</label>
						<select class="charsheet__attack-select charsheet__attack-select--ability">
							<option value="finesse" ${attack.abilityMod === "finesse" ? "selected" : ""}>Finesse (STR/DEX)</option>
							<option value="spellcasting" ${attack.abilityMod === "spellcasting" ? "selected" : ""}>Spellcasting (INT/WIS/CHA)</option>
							${Parser.ABIL_ABVS.map(a => `<option value="${a}" ${attack.abilityMod === a ? "selected" : ""}>${Parser.attAbvToFull(a)} (${a.toUpperCase()})</option>`).join("")}
						</select>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Range</label>
						<input type="text" class="charsheet__attack-input charsheet__attack-input--range" value="${attack.range || ""}" placeholder="5 ft. or 30/120 ft.">
					</div>
				</div>
			</div>
		`});
		content.append(mainSection);

		// Combat Stats Section
		const combatSection = e_({outer: `
			<div class="charsheet__attack-section">
				<div class="charsheet__attack-section-header">
					<span class="charsheet__attack-section-icon">🎯</span>
					<span class="charsheet__attack-section-title">Combat Statistics</span>
				</div>
				<div class="charsheet__attack-field-row">
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Attack Bonus</label>
						<div class="charsheet__attack-number-input">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--minus" data-field="bonus">−</button>
							<input type="number" class="charsheet__attack-input charsheet__attack-input--bonus" value="${attack.attackBonus}">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--plus" data-field="bonus">+</button>
						</div>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Damage Dice</label>
						<input type="text" class="charsheet__attack-input charsheet__attack-input--damage" value="${attack.damage}" placeholder="1d8, 2d6, etc.">
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Damage Type</label>
						<select class="charsheet__attack-select charsheet__attack-select--dmgtype">
							${["bludgeoning", "piercing", "slashing", "fire", "cold", "lightning", "thunder", "poison", "acid", "necrotic", "radiant", "force", "psychic"].map(t =>
		`<option value="${t}" ${attack.damageType === t ? "selected" : ""}>${this._getDamageTypeEmoji(t)} ${(/** @type {*} */ (t)).toTitleCase()}</option>`,
	).join("")}
						</select>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Damage Bonus</label>
						<div class="charsheet__attack-number-input">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--minus" data-field="dmgbonus">−</button>
							<input type="number" class="charsheet__attack-input charsheet__attack-input--dmgbonus" value="${attack.damageBonus}">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--plus" data-field="dmgbonus">+</button>
						</div>
					</div>
				</div>
			</div>
		`});
		content.append(combatSection);

		// Properties Section
		const hasMonkLevels = (this._state.getClassLevel("Monk") || 0) > 0;
		const propsSection = e_({outer: `
			<div class="charsheet__attack-section">
				<div class="charsheet__attack-section-header">
					<span class="charsheet__attack-section-icon">✨</span>
					<span class="charsheet__attack-section-title">Properties</span>
				</div>
				<div class="charsheet__attack-field">
					<label class="charsheet__attack-label">Weapon Properties</label>
					<input type="text" class="charsheet__attack-input charsheet__attack-input--properties" value="${(attack.properties || []).join(", ")}" placeholder="e.g., versatile, finesse, light, two-handed">
					<div class="charsheet__attack-properties-hint">Common: finesse, light, heavy, reach, thrown, two-handed, versatile</div>
				</div>
				${hasMonkLevels ? `
				<div class="charsheet__attack-field">
					<label class="charsheet__attack-label charsheet__attack-label--checkbox">
						<input type="checkbox" class="charsheet__attack-checkbox--monk-weapon" ${attack.isMonkWeapon ? "checked" : ""}>
						\u{1F94B} Monk Weapon
					</label>
				</div>
				` : ""}
			</div>
		`});
		content.append(propsSection);

		// Quick Add Section
		const inventoryItems = this._state.getItems();
		const inventoryWeapons = inventoryItems.filter(i => i.weapon);

		const quickSection = e_({outer: `
			<div class="charsheet__attack-section charsheet__attack-section--quick">
				<div class="charsheet__attack-section-header">
					<span class="charsheet__attack-section-icon">⚡</span>
					<span class="charsheet__attack-section-title">Quick Select</span>
				</div>
				<div class="charsheet__attack-quick-grid">
					${inventoryWeapons.length ? `
						<div class="charsheet__attack-quick-group">
							<label class="charsheet__attack-label">🎒 From Inventory</label>
							<select class="charsheet__attack-select charsheet__attack-select--inventory">
								<option value="">— Select weapon —</option>
								${inventoryWeapons.map(weapon => {
		const eff = this._state.getEffectiveItemBonuses?.(weapon.id);
		const bonus = eff ? ((eff.bonusWeapon || 0) + (eff.bonusWeaponAttack || 0)) : ((weapon.bonusWeapon || 0) + (weapon.bonusWeaponAttack || 0));
		const label = bonus > 0 ? `${weapon.name} (+${bonus})` : weapon.name;
		return `<option value="inv:${weapon.name}">${label}</option>`;
	}).join("")}
							</select>
						</div>
					` : ""}
					<div class="charsheet__attack-quick-group">
						<label class="charsheet__attack-label">📚 From Catalog</label>
						<select class="charsheet__attack-select charsheet__attack-select--catalog">
							<option value="">— Select from all weapons —</option>
							${this._allItems
		.filter(i => i.weapon)
		.sort((a, b) => a.name.localeCompare(b.name))
		.map(weapon => {
			const bonus = this._parseBonus(weapon.bonusWeapon) + this._parseBonus(weapon.bonusWeaponAttack);
			const label = bonus > 0 ? `${weapon.name} (+${bonus})` : weapon.name;
			return `<option value="${weapon.name}|${weapon.source}">${label}</option>`;
		}).join("")}
						</select>
					</div>
				</div>
			</div>
		`});
		content.append(quickSection);

		// Get form elements
		const nameInput = content.querySelector(".charsheet__attack-input--name");
		const typeSelect = content.querySelector(".charsheet__attack-section:first-child .charsheet__attack-select");
		const abilitySelect = content.querySelector(".charsheet__attack-select--ability");
		const rangeInput = content.querySelector(".charsheet__attack-input--range");
		const bonusInput = content.querySelector(".charsheet__attack-input--bonus");
		const damageInput = content.querySelector(".charsheet__attack-input--damage");
		const damageTypeSelect = content.querySelector(".charsheet__attack-select--dmgtype");
		const dmgBonusInput = content.querySelector(".charsheet__attack-input--dmgbonus");
		const propertiesInput = content.querySelector(".charsheet__attack-input--properties");
		const monkWeaponCheckbox = content.querySelector(".charsheet__attack-checkbox--monk-weapon");
		const inventorySelect = content.querySelector(".charsheet__attack-select--inventory");
		const weaponSelect = content.querySelector(".charsheet__attack-select--catalog");

		// Number input +/- buttons
		content.querySelectorAll(".charsheet__attack-number-btn").forEach(btn => btn.addEventListener("click", () => {
			const field = btn.dataset.field;
			const input = field === "bonus" ? bonusInput : dmgBonusInput;
			const delta = btn.classList.contains("charsheet__attack-number-btn--plus") ? 1 : -1;
			input.value = parseInt(input.value || 0) + delta;
		}));

		// Inventory weapon select handler
		if (inventorySelect) {
			inventorySelect.addEventListener("change", () => {
				if (!inventorySelect.value) return;
				const weaponName = inventorySelect.value.replace("inv:", "");
				const weapon = inventoryWeapons.find(i => i.name === weaponName);
				if (weapon) {
					nameInput.value = weapon.name;
					// Use property (5etools format) or properties (normalized format)
					const props = weapon.property || weapon.properties || [];
					const isRanged = props.some(p => p.includes("A") || p.toLowerCase().includes("ammunition")) || weapon.range;
					typeSelect.value = isRanged ? "ranged" : "melee";
					const hasFinesse = props.some(p => p.includes("F") || p.toLowerCase().includes("finesse"));
					abilitySelect.value = isRanged ? "dex" : (hasFinesse ? "finesse" : "str");
					if (weapon.damage) {
						const dmgMatch = weapon.damage.match(/(\d+d\d+)/);
						if (dmgMatch) damageInput.value = dmgMatch[1];
						const typeMatch = weapon.damage.match(/\d+d\d+\s*(\w+)/);
						if (typeMatch) damageTypeSelect.value = typeMatch[1].toLowerCase();
					}
					if (weapon.range) rangeInput.value = weapon.range;
					if (props.length) propertiesInput.value = props.map(p => typeof p === "string" ? p : Parser.itemPropertyToFull(p)).join(", ");
					const eff = this._state.getEffectiveItemBonuses?.(weapon.id);
					let attackBonusVal;
					let damageBonusVal;
					if (eff) {
						attackBonusVal = (eff.bonusWeapon || 0) + (eff.bonusWeaponAttack || 0);
						damageBonusVal = (eff.bonusWeapon || 0) + (eff.bonusWeaponDamage || 0);
					} else {
						attackBonusVal = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponAttack || 0);
						damageBonusVal = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponDamage || 0);
					}
					bonusInput.value = attackBonusVal;
					dmgBonusInput.value = damageBonusVal;
					weaponSelect.value = "";
					if (monkWeaponCheckbox) monkWeaponCheckbox.checked = !!this._state.isMonkWeapon?.(weapon);
				}
			});
		}

		// Catalog weapon select handler
		weaponSelect.addEventListener("change", () => {
			if (!weaponSelect.value) return;
			const [name, source] = weaponSelect.value.split("|");
			const weapon = this._allItems.find(i => i.name === name && i.source === source);
			if (weapon) {
				nameInput.value = weapon.name;
				const isRanged = weapon.property?.includes("A") || weapon.range;
				typeSelect.value = isRanged ? "ranged" : "melee";
				const hasFinesse = weapon.property?.includes("F");
				abilitySelect.value = isRanged ? "dex" : (hasFinesse ? "finesse" : "str");
				if (weapon.dmg1) damageInput.value = weapon.dmg1;
				if (weapon.dmgType) damageTypeSelect.value = Parser.dmgTypeToFull(weapon.dmgType).toLowerCase();
				if (weapon.range) rangeInput.value = weapon.range;
				if (weapon.property) propertiesInput.value = weapon.property.map(p => Parser.itemPropertyToFull(p)).join(", ");
				const attackBonusVal = this._parseBonus(weapon.bonusWeapon) + this._parseBonus(weapon.bonusWeaponAttack);
				const damageBonusVal = this._parseBonus(weapon.bonusWeapon) + this._parseBonus(weapon.bonusWeaponDamage);
				bonusInput.value = attackBonusVal;
				dmgBonusInput.value = damageBonusVal;
				if (inventorySelect) inventorySelect.value = "";
				if (monkWeaponCheckbox) monkWeaponCheckbox.checked = !!this._state.isMonkWeapon?.(weapon);
			}
		});

		// Footer buttons
		const footer = e_({outer: `
			<div class="charsheet__attack-footer">
				<button class="charsheet__attack-btn charsheet__attack-btn--cancel">Cancel</button>
				<button class="charsheet__attack-btn charsheet__attack-btn--save">${isEdit ? "💾 Save Changes" : "➕ Add Attack"}</button>
			</div>
		`});
		content.append(footer);

		footer.querySelector(".charsheet__attack-btn--cancel").addEventListener("click", () => doClose(false));
		footer.querySelector(".charsheet__attack-btn--save").addEventListener("click", () => {
			const newAttack = {
				id: existingAttack?.id || CryptUtil.uid(),
				name: nameInput.value.trim(),
				isMelee: typeSelect.value === "melee",
				abilityMod: abilitySelect.value,
				attackBonus: parseInt(bonusInput.value) || 0,
				range: rangeInput.value.trim(),
				damage: damageInput.value.trim(),
				damageType: damageTypeSelect.value,
				damageBonus: parseInt(dmgBonusInput.value) || 0,
				properties: propertiesInput.value.split(",").map(p => p.trim()).filter(Boolean),
				isMonkWeapon: monkWeaponCheckbox?.checked || false,
			};

			if (!newAttack.name) {
				JqueryUtil.doToast({type: "warning", content: "Please enter an attack name."});
				return;
			}

			if (isEdit) {
				this._state.updateAttack(newAttack);
			} else {
				this._state.addAttack(newAttack);
			}

			doClose(true);
			this.renderAttacks();
			this._page.saveCharacter();
		});

		// Focus name field
		setTimeout(() => nameInput.focus(), 100);
	}

	_getDamageTypeEmoji (type) {
		const emojis = {
			bludgeoning: "🔨",
			piercing: "🗡️",
			slashing: "⚔️",
			fire: "🔥",
			cold: "❄️",
			lightning: "⚡",
			thunder: "💥",
			poison: "☠️",
			acid: "🧪",
			necrotic: "💀",
			radiant: "✨",
			force: "💫",
			psychic: "🧠",
		};
		return emojis[type] || "⚔️";
	}

	async _editAttack (attackId) {
		// Check if it's an auto-generated attack from equipped weapon
		if (attackId?.startsWith?.("auto_")) {
			// Extract the weapon ID from the attack ID (format: auto_weaponId)
			const weaponId = attackId.substring(5); // Remove "auto_" prefix
			const weapon = this._state.getItems().find(item => item.id === weaponId);

			if (!weapon) {
				JqueryUtil.doToast({type: "warning", content: "Weapon not found in inventory."});
				return;
			}

			// Open the full attack edit modal for the weapon (same as unarmed strike)
			await this._pShowWeaponAttackModal(weapon);
			return;
		}

		const attacks = this._state.getAttacks();
		const attack = attacks.find(a => a.id === attackId);
		if (!attack) {
			// eslint-disable-next-line no-console
			console.warn("[Combat] Attack not found:", attackId);
			return;
		}

		await this._pShowAttackModal(attack);
	}

	/**
	 * Show a full attack edit modal for a weapon - same fields as unarmed strike / manual attacks
	 * Changes are stored as overrides on the weapon item in inventory
	 */
	async _pShowWeaponAttackModal (weapon) {
		// Build the current attack stats from weapon data + any existing overrides
		// Handle both raw 5etools items (property) and normalized inventory items (properties)
		const props = weapon.property || weapon.properties || [];
		const isRanged = props.some(p => p === "A" || p === "T" || p.startsWith("A|") || p.startsWith("T|")) || weapon.range;
		const hasFinesse = props.some(p => p === "F" || p.startsWith("F|"));

		// Get weapon's base stats with overrides
		const overrides = weapon.attackOverrides || {};
		const magicBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponAttack || 0);
		const magicDmgBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponDamage || 0);

		// Extract raw damage die — prefer dmg1 (raw), fall back to parsing from formatted damage string
		const rawDamageDie = weapon.dmg1 || (weapon.damage ? weapon.damage.split(" ")[0] : null) || "1d6";
		const rawDamageType = weapon.dmgType
			? Parser.dmgTypeToFull(weapon.dmgType).toLowerCase()
			: (weapon.damageType || (weapon.damage ? weapon.damage.split(" ").slice(1).join(" ").toLowerCase() : null) || "slashing");

		const attack = {
			name: overrides.name ?? weapon.name,
			attackBonus: overrides.attackBonus ?? (weapon.customAttackBonus || 0),
			damage: overrides.damage ?? rawDamageDie,
			damageType: overrides.damageType ?? rawDamageType,
			damageBonus: overrides.damageBonus ?? (weapon.customDamageBonus || 0),
			range: overrides.range ?? (weapon.range || ""),
			properties: overrides.properties ?? (props.map(p => this._formatProperty(p)) || []),
			isMelee: overrides.isMelee ?? !isRanged,
			abilityMod: overrides.abilityMod ?? (isRanged ? "dex" : (hasFinesse ? "finesse" : "str")),
		};

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `⚔️ Edit ${weapon.name}`,
			isMinHeight0: true,
		});

		modalInner.classList.add("charsheet__attack-modal");

		const content = e_({tag: "div", clazz: "charsheet__attack-form"});
		modalInner.append(content);

		// Info about magic item bonuses
		if (magicBonus > 0 || magicDmgBonus > 0) {
			content.append(e_({outer: `
				<div class="ve-small ve-muted mb-2 p-2 rounded" style="background: var(--cs-bg-surface, #1e293b);">
					<strong>Magic Item Bonuses (auto-applied):</strong> 
					${magicBonus > 0 ? `+${magicBonus} to hit` : ""}
					${magicBonus > 0 && magicDmgBonus > 0 ? ", " : ""}
					${magicDmgBonus > 0 ? `+${magicDmgBonus} damage` : ""}
				</div>
			`}));
		}

		// Main Info Section
		const mainSection = e_({outer: `
			<div class="charsheet__attack-section">
				<div class="charsheet__attack-section-header">
					<span class="charsheet__attack-section-icon">📋</span>
					<span class="charsheet__attack-section-title">Basic Information</span>
				</div>
				<div class="charsheet__attack-field">
					<label class="charsheet__attack-label">Attack Name</label>
					<input type="text" class="charsheet__attack-input charsheet__attack-input--name" value="${attack.name}" placeholder="e.g., Longsword">
				</div>
				<div class="charsheet__attack-field-row">
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Type</label>
						<select class="charsheet__attack-select charsheet__attack-select--type">
							<option value="melee" ${attack.isMelee ? "selected" : ""}>⚔️ Melee</option>
							<option value="ranged" ${!attack.isMelee ? "selected" : ""}>🏹 Ranged</option>
						</select>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Ability</label>
						<select class="charsheet__attack-select charsheet__attack-select--ability">
							<option value="finesse" ${attack.abilityMod === "finesse" ? "selected" : ""}>Finesse (STR/DEX)</option>
							<option value="spellcasting" ${attack.abilityMod === "spellcasting" ? "selected" : ""}>Spellcasting (INT/WIS/CHA)</option>
							${Parser.ABIL_ABVS.map(a => `<option value="${a}" ${attack.abilityMod === a ? "selected" : ""}>${Parser.attAbvToFull(a)} (${a.toUpperCase()})</option>`).join("")}
						</select>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Range</label>
						<input type="text" class="charsheet__attack-input charsheet__attack-input--range" value="${attack.range || ""}" placeholder="5 ft. or 30/120 ft.">
					</div>
				</div>
			</div>
		`});
		content.append(mainSection);

		// Combat Stats Section
		const combatSection = e_({outer: `
			<div class="charsheet__attack-section">
				<div class="charsheet__attack-section-header">
					<span class="charsheet__attack-section-icon">🎯</span>
					<span class="charsheet__attack-section-title">Combat Statistics</span>
				</div>
				<div class="charsheet__attack-field-row">
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Attack Bonus</label>
						<div class="charsheet__attack-number-input">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--minus" data-field="bonus">−</button>
							<input type="number" class="charsheet__attack-input charsheet__attack-input--bonus" value="${attack.attackBonus}">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--plus" data-field="bonus">+</button>
						</div>
						<div class="ve-small ve-muted">Custom bonus (${magicBonus > 0 ? `+${magicBonus} magic added auto` : "no magic bonus"})</div>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Damage Dice</label>
						<input type="text" class="charsheet__attack-input charsheet__attack-input--damage" value="${attack.damage}" placeholder="1d8, 2d6, etc.">
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Damage Type</label>
						<select class="charsheet__attack-select charsheet__attack-select--dmgtype">
							${["bludgeoning", "piercing", "slashing", "fire", "cold", "lightning", "thunder", "poison", "acid", "necrotic", "radiant", "force", "psychic"].map(t =>
		`<option value="${t}" ${attack.damageType === t ? "selected" : ""}>${this._getDamageTypeEmoji(t)} ${(/** @type {*} */ (t)).toTitleCase()}</option>`,
	).join("")}
						</select>
					</div>
					<div class="charsheet__attack-field">
						<label class="charsheet__attack-label">Damage Bonus</label>
						<div class="charsheet__attack-number-input">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--minus" data-field="dmgbonus">−</button>
							<input type="number" class="charsheet__attack-input charsheet__attack-input--dmgbonus" value="${attack.damageBonus}">
							<button class="charsheet__attack-number-btn charsheet__attack-number-btn--plus" data-field="dmgbonus">+</button>
						</div>
						<div class="ve-small ve-muted">Custom bonus (${magicDmgBonus > 0 ? `+${magicDmgBonus} magic added auto` : "no magic bonus"})</div>
					</div>
				</div>
			</div>
		`});
		content.append(combatSection);

		// Properties Section
		const hasMonkLevels2 = (this._state.getClassLevel("Monk") || 0) > 0;
		const propsSection = e_({outer: `
			<div class="charsheet__attack-section">
				<div class="charsheet__attack-section-header">
					<span class="charsheet__attack-section-icon">✨</span>
					<span class="charsheet__attack-section-title">Properties</span>
				</div>
				<div class="charsheet__attack-field">
					<label class="charsheet__attack-label">Weapon Properties</label>
					<input type="text" class="charsheet__attack-input charsheet__attack-input--properties" value="${(attack.properties || []).join(", ")}" placeholder="e.g., versatile, finesse, light, two-handed">
					<div class="charsheet__attack-properties-hint">Common: finesse, light, heavy, reach, thrown, two-handed, versatile</div>
				</div>
				${hasMonkLevels2 ? `
				<div class="charsheet__attack-field">
					<label class="charsheet__attack-label charsheet__attack-label--checkbox">
						<input type="checkbox" class="charsheet__attack-checkbox--monk-weapon" ${this._state.isMonkWeapon?.(weapon) ? "checked" : ""}>
						\u{1F94B} Monk Weapon
					</label>
				</div>
				` : ""}
			</div>
		`});
		content.append(propsSection);

		// Get form elements
		const nameInput = content.querySelector(".charsheet__attack-input--name");
		const typeSelect = content.querySelector(".charsheet__attack-select--type");
		const abilitySelect = content.querySelector(".charsheet__attack-select--ability");
		const rangeInput = content.querySelector(".charsheet__attack-input--range");
		const bonusInput = content.querySelector(".charsheet__attack-input--bonus");
		const damageInput = content.querySelector(".charsheet__attack-input--damage");
		const damageTypeSelect = content.querySelector(".charsheet__attack-select--dmgtype");
		const dmgBonusInput = content.querySelector(".charsheet__attack-input--dmgbonus");
		const propertiesInput = content.querySelector(".charsheet__attack-input--properties");

		// Number input +/- buttons
		content.querySelectorAll(".charsheet__attack-number-btn").forEach(btn => btn.addEventListener("click", () => {
			const field = btn.dataset.field;
			const input = field === "bonus" ? bonusInput : dmgBonusInput;
			const delta = btn.classList.contains("charsheet__attack-number-btn--plus") ? 1 : -1;
			input.value = parseInt(input.value || 0) + delta;
		}));

		// Footer buttons
		const footer = e_({outer: `
			<div class="charsheet__attack-footer">
				<button class="charsheet__attack-btn charsheet__attack-btn--reset" title="Reset to weapon defaults">🔄 Reset</button>
				<button class="charsheet__attack-btn charsheet__attack-btn--cancel">Cancel</button>
				<button class="charsheet__attack-btn charsheet__attack-btn--save">💾 Save Changes</button>
			</div>
		`});
		content.append(footer);

		// Reset button - clear all overrides
		footer.querySelector(".charsheet__attack-btn--reset").addEventListener("click", () => {
			delete weapon.attackOverrides;
			delete weapon.customAttackBonus;
			delete weapon.customDamageBonus;
			this.renderAttacks();
			this._page._inventory?.render?.();
			this._page._saveCurrentCharacter?.();
			JqueryUtil.doToast({type: "success", content: `Reset ${weapon.name} to default stats.`});
			doClose(true);
		});

		footer.querySelector(".charsheet__attack-btn--cancel").addEventListener("click", () => doClose(false));
		footer.querySelector(".charsheet__attack-btn--save").addEventListener("click", () => {
			// Save overrides to the weapon item
			weapon.attackOverrides = {
				name: nameInput.value.trim(),
				isMelee: typeSelect.value === "melee",
				abilityMod: abilitySelect.value,
				range: rangeInput.value.trim(),
				damage: damageInput.value.trim(),
				damageType: damageTypeSelect.value,
				properties: propertiesInput.value.split(",").map(p => p.trim()).filter(Boolean),
			};
			// Also update legacy custom bonus fields for backward compatibility
			weapon.customAttackBonus = parseInt(bonusInput.value) || 0;
			weapon.customDamageBonus = parseInt(dmgBonusInput.value) || 0;

			this.renderAttacks();
			this._page._inventory?.render?.();
			this._page._saveCurrentCharacter?.();

			JqueryUtil.doToast({type: "success", content: `Updated ${weapon.name}.`});
			doClose(true);
		});

		// Focus name field
		setTimeout(() => nameInput.focus(), 100);
	}

	/**
	 * Show a modal to edit weapon bonuses (attack bonus, damage bonus)
	 * This is for equipped weapons - we store custom bonuses on the inventory item
	 * @deprecated Use _pShowWeaponAttackModal instead for full editing
	 */
	async _pShowWeaponBonusModal (weapon) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `⚔️ Edit ${weapon.name} Bonuses`,
			isMinHeight0: true,
		});

		// Get current custom bonuses (these are player-added bonuses, separate from magic item bonuses)
		const customAttackBonus = weapon.customAttackBonus || 0;
		const customDamageBonus = weapon.customDamageBonus || 0;

		// Show the weapon's base stats and allow editing bonuses
		const magicBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponAttack || 0);
		const magicDmgBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponDamage || 0);

		const content = e_({outer: `
			<div class="charsheet__weapon-bonus-modal">
				<div class="ve-small ve-muted mb-3">
					Edit custom bonuses for this weapon. Magic item bonuses (${magicBonus > 0 ? `+${magicBonus}` : "none"}) are applied automatically.
				</div>
				
				<div class="charsheet__attack-section">
					<div class="charsheet__attack-section-header">
						<span class="charsheet__attack-section-icon">📋</span>
						<span class="charsheet__attack-section-title">Weapon Info</span>
					</div>
					<div class="ve-flex gap-3 mb-2">
						<div><strong>Damage:</strong> ${weapon.dmg1 || "1d4"} ${weapon.dmgType || ""}</div>
						${weapon.property?.length ? `<div><strong>Properties:</strong> ${weapon.property.map(p => this._formatProperty(p)).join(", ")}</div>` : ""}
					</div>
				</div>

				<div class="charsheet__attack-section">
					<div class="charsheet__attack-section-header">
						<span class="charsheet__attack-section-icon">🎯</span>
						<span class="charsheet__attack-section-title">Custom Bonuses</span>
					</div>
					<div class="charsheet__attack-field-row">
						<div class="charsheet__attack-field">
							<label class="charsheet__attack-label">Attack Bonus</label>
							<div class="charsheet__attack-number-input">
								<button class="charsheet__attack-number-btn charsheet__attack-number-btn--minus" data-field="attack">−</button>
								<input type="number" class="charsheet__attack-input charsheet__weapon-bonus-attack" value="${customAttackBonus}">
								<button class="charsheet__attack-number-btn charsheet__attack-number-btn--plus" data-field="attack">+</button>
							</div>
							<div class="ve-small ve-muted">Added to attack rolls</div>
						</div>
						<div class="charsheet__attack-field">
							<label class="charsheet__attack-label">Damage Bonus</label>
							<div class="charsheet__attack-number-input">
								<button class="charsheet__attack-number-btn charsheet__attack-number-btn--minus" data-field="damage">−</button>
								<input type="number" class="charsheet__attack-input charsheet__weapon-bonus-damage" value="${customDamageBonus}">
								<button class="charsheet__attack-number-btn charsheet__attack-number-btn--plus" data-field="damage">+</button>
							</div>
							<div class="ve-small ve-muted">Added to damage rolls</div>
						</div>
					</div>
				</div>
			</div>
		`});
		modalInner.append(content);

		// Number input buttons
		content.querySelectorAll(".charsheet__attack-number-btn").forEach(btn => btn.addEventListener("click", () => {
			const field = btn.dataset.field;
			const isMinus = btn.classList.contains("charsheet__attack-number-btn--minus");
			const input = field === "attack"
				? content.querySelector(".charsheet__weapon-bonus-attack")
				: content.querySelector(".charsheet__weapon-bonus-damage");
			const current = parseInt(input.value) || 0;
			input.value = current + (isMinus ? -1 : 1);
		}));

		// Buttons
		const buttons = e_({outer: `
			<div class="ve-flex-v-center ve-flex-h-right mt-3 gap-2">
				<button class="ve-btn ve-btn-default">Cancel</button>
				<button class="ve-btn ve-btn-primary">Save</button>
			</div>
		`});
		modalInner.append(buttons);

		buttons.querySelector(".ve-btn-default").addEventListener("click", () => doClose(false));
		buttons.querySelector(".ve-btn-primary").addEventListener("click", () => {
			// Save the custom bonuses to the weapon in inventory
			weapon.customAttackBonus = parseInt(content.querySelector(".charsheet__weapon-bonus-attack").value) || 0;
			weapon.customDamageBonus = parseInt(content.querySelector(".charsheet__weapon-bonus-damage").value) || 0;

			// Re-render attacks and save
			this.renderAttacks();
			this._page._inventory?.render?.();
			this._page._saveCurrentCharacter?.();

			JqueryUtil.doToast({type: "success", content: `Updated bonuses for ${weapon.name}.`});
			doClose(true);
		});
	}

	_removeAttack (attackId) {
		// Check if it's a temporary attack
		const tempAttacks = this._state.getTemporaryAttacks?.() || [];
		const tempAttack = tempAttacks.find(a => a.id === attackId);
		if (tempAttack) {
			this._state.removeTemporaryAttack(attackId);
			this.renderAttacks();
			this._page.saveCharacter();
			JqueryUtil.doToast({type: "success", content: `Dismissed temporary attack: ${tempAttack.name}`});
			return;
		}

		// Check if it's an auto-generated attack from equipped weapon
		if (attackId?.startsWith?.("auto_")) {
			// Extract the weapon ID and unequip it
			const weaponId = attackId.substring(5);
			const invItem = this._state.getInventory().find(item => item.id === weaponId);
			if (invItem) {
				const weaponName = invItem.item?.name || invItem.name || "item";
				this._state.unequip(weaponId);
				this._page._inventory?.render?.();
				this.renderAttacks();
				this._page._saveCurrentCharacter?.();
				JqueryUtil.doToast({type: "success", content: `Unequipped ${weaponName}.`});
			}
			return;
		}

		this._state.removeAttack(attackId);
		this.renderAttacks();
		this._page.saveCharacter();
	}

	_rollAttack (attackId, event) {
		const attacks = this._state.getAttacks();
		let attack = attacks.find(a => a.id === attackId);
		if (!attack && this._cachedAttacks?.length) {
			attack = this._cachedAttacks.find(a => a.id === attackId);
		}
		// Check temporary attacks
		if (!attack) {
			const tempAttacks = this._state.getTemporaryAttacks?.() || [];
			attack = tempAttacks.find(a => a.id === attackId);
		}
		if (!attack) return;

		// Ammunition consumption (if enabled and weapon uses ammo)
		let ammoNote = "";
		if (this._state.isAmmunitionTrackingEnabled?.() && attack.sourceItem?.ammoType) {
			const ammoItems = this._state.getAmmunitionForWeapon?.(attack.sourceItem.id) || [];
			if (ammoItems.length > 0) {
				// Use first available ammunition
				const ammo = ammoItems[0];
				if (this._state.consumeAmmunition?.(ammo.id, 1)) {
					const remaining = ammo.quantity - 1;
					ammoNote = ` [${ammo.name}: ${remaining} remaining]`;
				}
			} else {
				// No compatible ammunition
				if (typeof JqueryUtil !== "undefined" && JqueryUtil.doToast) {
					JqueryUtil.doToast({type: "warning", content: `No compatible ammunition for ${attack.name}!`});
				}
			}
		}

		// Determine attack type for advantage/disadvantage matching
		const isMelee = attack.isMelee || attack.type === "melee" || attack.range === "melee"
			|| (attack.range && !attack.range.includes("/"));
		const abilityUsed = attack.abilityMod || (isMelee ? "str" : "dex");
		const attackType = `attack:${isMelee ? "melee" : "ranged"}:${abilityUsed}`;

		// Check for advantage/disadvantage from active states and conditions
		let stateMode;
		const hasAdvantage = this._state.hasAdvantageFromStates?.(attackType)
			|| this._state.hasAdvantageFromStates?.("attack");
		const hasDisadvantage = this._state.hasDisadvantageFromStates?.(attackType)
			|| this._state.hasDisadvantageFromStates?.("attack");
		if (hasAdvantage && !hasDisadvantage) stateMode = "advantage";
		else if (hasDisadvantage && !hasAdvantage) stateMode = "disadvantage";

		// Calculate total attack bonus - resolve finesse to use higher of STR/DEX
		const abilityMod = this._resolveAbilityMod(attack.abilityMod || "str");
		const profBonus = this._state.getProficiencyBonus();

		// Get attack modifiers from named modifiers (from features like Battle Tactics, magic items, etc.)
		const attackModifiers = this._state.getNamedModifiersByType("attack");
		const featureAttackBonus = attackModifiers.reduce((sum, mod) => sum + (mod.value || 0), 0);

		// Get bonus from active states (activated abilities like combat stances)
		const stateAttackBonus = this._state.getBonusFromStates?.("attack") || 0;

		const totalBonus = abilityMod + profBonus + (attack.attackBonus || 0) + featureAttackBonus + stateAttackBonus;

		// Roll d20 with advantage/disadvantage support (state mode can be overridden by shift/ctrl keys)
		const rollResult = this._page.rollD20({event, mode: stateMode});
		const total = rollResult.roll + totalBonus;

		// Check for crit/fumble
		const critRange = this._state.getCriticalRange?.() || 20;
		let resultClass = "";
		let resultNote = "";
		if (rollResult.roll >= critRange) {
			resultClass = "charsheet__dice-result-total--crit";
			resultNote = "Critical Hit!";
		} else if (rollResult.roll === 1) {
			resultClass = "charsheet__dice-result-total--fumble";
			resultNote = "Critical Miss!";
		}

		// Build state effect label for display
		const stateEffectLabel = this._getStateEffectLabel(hasAdvantage, hasDisadvantage);

		// Show result
		const modeLabel = this._page.getModeLabel(rollResult.mode);
		this._page.showDiceResult({
			title: `${attack.name} Attack${modeLabel}${stateEffectLabel}`,
			roll: rollResult.roll,
			modifier: totalBonus,
			total,
			resultClass,
			resultNote: resultNote + ammoNote,
			subtitle: this._page.formatD20Breakdown(rollResult, totalBonus),
		});

		this._lastAttackContext = {
			attackId,
			mode: rollResult.mode || "normal",
			hasAdvantage,
			hasDisadvantage,
		};

		// Auto-refresh SA section to show updated advantage status
		this._renderSneakAttackToggle?.();

		// Auto-enable SA when conditions are met after attack
		const sneakAttackInfo = this._state.getFeatureCalculations?.()?.sneakAttack;
		if (sneakAttackInfo && !this._sneakAttackEnabled && this._isSneakAttackAvailableThisTurn()) {
			const triggerMet = (hasAdvantage && !hasDisadvantage) || this._sneakAttackHasAdjacentAlly;
			if (triggerMet && this._isSneakAttackWeaponEligible(attack)) {
				this._sneakAttackEnabled = true;
				this._renderSneakAttackToggle?.();
				JqueryUtil.doToast({type: "success", content: `Sneak Attack auto-enabled (${sneakAttackInfo.dice}). Disable before damage roll if unwanted.`});
			}
		}

		// Consume "next attack only" states (e.g. Steady Aim grants advantage on ONE attack)
		this._consumeOnAttackStates();
	}

	/**
	 * Deactivate active states flagged with consumeOnAttack (e.g. Steady Aim).
	 * For Steady Aim: removes advantage after the next attack, but keeps speedZero
	 * until end of turn by removing only the advantage effect rather than deactivating entirely.
	 */
	_consumeOnAttackStates () {
		const activeStates = this._state.getActiveStates?.() || [];
		for (const state of activeStates) {
			if (!state.active) continue;
			const typeDef = CharacterSheetState.ACTIVE_STATE_TYPES[state.stateTypeId];
			if (!typeDef?.consumeOnAttack) continue;

			// Remove advantage effects but keep other effects (speedZero) active
			// We do this by replacing the state's effects with only non-advantage effects
			const remaining = (typeDef.effects || []).filter(e => e.type !== "advantage");
			if (remaining.length > 0) {
				// Keep the state active but without advantage
				this._state.updateActiveStateEffects?.(state.stateTypeId, remaining);
			} else {
				this._state.deactivateState(state.stateTypeId);
			}

			// Re-render combat UI to reflect the change
			this.renderCombatActions?.();
			this.renderCombatStates?.();
			this.renderCombatEffects?.();
		}
	}

	/**
	 * Get label showing state effects on roll
	 */
	_getStateEffectLabel (hasAdvantage, hasDisadvantage) {
		if (hasAdvantage && hasDisadvantage) return " (adv+disadv cancel)";
		if (hasAdvantage) return " (from states)";
		if (hasDisadvantage) return " (from states)";
		return "";
	}

	async _rollDamage (attackId, isCrit = false) {
		const attacks = this._state.getAttacks();
		let attack = attacks.find(a => a.id === attackId);
		if (!attack && this._cachedAttacks?.length) {
			attack = this._cachedAttacks.find(a => a.id === attackId);
		}
		// Check temporary attacks
		if (!attack) {
			const tempAttacks = this._state.getTemporaryAttacks?.() || [];
			attack = tempAttacks.find(a => a.id === attackId);
		}
		if (!attack || !attack.damage) return;

		// Monk: Hand of Harm — prompt BEFORE rolling damage for unarmed strikes
		// Per-turn limit only applies during active combat; outside combat always allow
		let handOfHarmDamage = 0;
		let handOfHarmFormula = null;
		if (attack.isUnarmedStrike) {
			const harmCalc = this._state.getFeatureCalculations?.() || {};
			const inCombat = this._state.isInCombat?.();
			const harmBlocked = inCombat && this._handOfHarmUsedThisTurn;
			if (harmCalc.hasHandOfHarm && !harmBlocked) {
				const accepted = await this._promptHandOfHarm(harmCalc);
				if (accepted) {
					handOfHarmFormula = harmCalc.handOfHarmDamage;
					const harmRoll = this._parseDamage(handOfHarmFormula);
					handOfHarmDamage = harmRoll.total;
				}
			}
		}

		// Combat method effects (e.g. Wounding Strike) — prompt if weapon has active effect
		let methodEffectApplied = null;
		const activeMethodEffect = (this._state.getActiveCombatMethodEffects?.() || []).find(e => e.weaponId === attack.id);
		if (activeMethodEffect) {
			const accepted = await this._promptApplyMethodEffect(activeMethodEffect);
			if (accepted) {
				methodEffectApplied = activeMethodEffect;
			}
		} else {
			// No active effect yet — check for weapon-modifier methods targeting this weapon
			methodEffectApplied = await this._promptUseCombatMethod(attack);
		}

		// Parse damage dice
		const damageRoll = this._parseDamage(attack.damage, isCrit);
		const abilityMod = this._resolveAbilityMod(attack.abilityMod || "str");

		// Get damage modifiers from named modifiers (from features, magic items, etc.)
		const damageModifiers = this._state.getNamedModifiersByType("damage");
		const featureDamageBonus = damageModifiers.reduce((sum, mod) => sum + (mod.value || 0), 0);

		// Get bonus from active states (activated abilities)
		const stateDamageBonus = this._state.getBonusFromStates?.("damage") || 0;

		// Check if attack uses strength and if rage is active (for rage damage)
		let rageBonus = 0;
		const isMeleeStrengthAttack = (attack.abilityMod === "str" || !attack.abilityMod)
			&& !attack.isRanged && !attack.isSpell;
		if (this._state.isStateTypeActive?.("rage")) {
			rageBonus = this._state.getRageDamageBonus?.(
				!attack.isRanged && !attack.isSpell, // isMelee
				attack.abilityMod || "str",
			) || 0;
		}

		// Check for Sneak Attack
		let sneakAttackDamage = 0;
		let sneakAttackDice = "";
		let cunningStrikeEffects = [];
		const sneakAttackInfo = this._state.getFeatureCalculations?.()?.sneakAttack;
		if (this._canApplySneakAttack(attack, sneakAttackInfo)) {
			// Subtract Cunning Strike dice cost from SA dice
			const baseSneakDice = parseInt(sneakAttackInfo.dice) || 0;
			const csDiceCost = this._selectedCunningStrikes.reduce((sum, cs) => sum + cs.cost, 0);
			const effectiveDice = Math.max(0, baseSneakDice - csDiceCost);

			if (effectiveDice > 0) {
				const effectiveDiceStr = `${effectiveDice}d6`;
				const sneakRoll = this._parseDamage(effectiveDiceStr, isCrit);
				sneakAttackDamage = sneakRoll.total;
				sneakAttackDice = effectiveDiceStr;
			}

			// Record CS effects for display
			if (this._selectedCunningStrikes.length) {
				const saveDC = 8 + this._state.getProficiencyBonus() + this._state.getAbilityMod("dex");
				cunningStrikeEffects = this._selectedCunningStrikes.map(cs => ({
					name: cs.name,
					cost: cs.cost,
					save: cs.save,
					saveDC,
					desc: cs.desc,
				}));
			}

			this._markSneakAttackUsedThisTurn();
		}

		// Magic item crit damage bonus (e.g., bonusWeaponCritDamage on the weapon)
		let critDamageBonus = 0;
		if (isCrit && attack.sourceItem?.bonusWeaponCritDamage) {
			critDamageBonus = attack.sourceItem.bonusWeaponCritDamage;
		}

		// Spell damage bonus from magic items (e.g., Wand of the War Mage, Rod of the Pact Keeper)
		let spellDamageBonus = 0;
		if (attack.isSpell) {
			spellDamageBonus = this._state.getItemBonus?.("spellDamage") || 0;
		}

		const totalBonus = abilityMod + (attack.damageBonus || 0) + featureDamageBonus + rageBonus + stateDamageBonus + critDamageBonus + spellDamageBonus;

		// Get extra damage dice from active states (e.g., Hex, Flame Tongue)
		const extraDamageEntries = this._state.getExtraDamageFromStates?.() || [];
		let extraDamageTotal = 0;
		const extraDamageParts = [];
		for (const entry of extraDamageEntries) {
			const extraRoll = this._parseDamage(entry.dice, isCrit);
			extraDamageTotal += extraRoll.total;
			extraDamageParts.push({dice: entry.dice, total: extraRoll.total, type: entry.damageType, source: entry.source});
		}

		// Roll ongoing damage from combat method effect (e.g. Wounding Strike 1d4)
		let methodEffectDamage = 0;
		let methodEffectFormula = null;
		if (methodEffectApplied?.ongoingDamage) {
			methodEffectFormula = methodEffectApplied.ongoingDamage;
			const methodRoll = this._parseDamage(methodEffectFormula);
			methodEffectDamage = methodRoll.total;
		}

		const baseDamageTotal = damageRoll.total + totalBonus + sneakAttackDamage + extraDamageTotal;
		const total = baseDamageTotal + handOfHarmDamage + methodEffectDamage;

		// Build subtitle with breakdown
		let subtitle = `${attack.damage}${isCrit ? " (crit)" : ""} + ${abilityMod} (${attack.abilityMod || "STR"})`;
		if (attack.damageBonus) subtitle += ` + ${attack.damageBonus} (weapon)`;
		if (featureDamageBonus) subtitle += ` + ${featureDamageBonus} (features)`;
		if (rageBonus) subtitle += ` + ${rageBonus} (rage)`;
		if (stateDamageBonus) subtitle += ` + ${stateDamageBonus} (states)`;
		if (critDamageBonus) subtitle += ` + ${critDamageBonus} (crit bonus)`;
		if (spellDamageBonus) subtitle += ` + ${spellDamageBonus} (spell item)`;
		if (sneakAttackDamage) subtitle += ` + ${sneakAttackDamage} (sneak attack ${sneakAttackDice})`;
		for (const ep of extraDamageParts) {
			subtitle += ` + ${ep.total} (${ep.source}${ep.type ? ` ${ep.type}` : ""})`;
		}
		subtitle += ` ${attack.damageType}`;
		if (handOfHarmDamage) subtitle += ` | <strong style="color:#9b59b6">+${handOfHarmDamage} necrotic</strong> (Hand of Harm ${handOfHarmFormula})`;
		if (methodEffectDamage) subtitle += ` | <strong style="color:#c44">+${methodEffectDamage} ongoing</strong> (${methodEffectApplied.name} ${methodEffectFormula}${methodEffectApplied.ongoingSaveType ? `, ${methodEffectApplied.ongoingSaveType.charAt(0).toUpperCase() + methodEffectApplied.ongoingSaveType.slice(1)} DC ${methodEffectApplied.saveDc} to end` : ""})`;

		// Append Cunning Strike effects to subtitle
		if (cunningStrikeEffects.length) {
			const csDesc = cunningStrikeEffects.map(cs => {
				if (cs.save) return `${cs.name} (DC ${cs.saveDC} ${cs.save.toUpperCase()})`;
				return cs.name;
			}).join(", ");
			subtitle += ` | Cunning Strike: ${csDesc}`;
		}

		// Show result — separate damage types in title when multi-type damage is present
		let totalTitle;
		if (handOfHarmDamage && methodEffectDamage) {
			totalTitle = `${baseDamageTotal} ${attack.damageType} + ${handOfHarmDamage} necrotic + ${methodEffectDamage} ongoing = ${total}`;
		} else if (handOfHarmDamage) {
			totalTitle = `${baseDamageTotal} ${attack.damageType} + ${handOfHarmDamage} necrotic = ${total}`;
		} else if (methodEffectDamage) {
			totalTitle = `${baseDamageTotal} ${attack.damageType} + ${methodEffectDamage} ongoing = ${total}`;
		}
		this._page.showDiceResult({
			title: `${attack.name} Damage`,
			roll: damageRoll.total + sneakAttackDamage,
			modifier: totalBonus,
			total: totalTitle || total,
			subtitle,
		});

		// Auto-disable sneak attack after use (once per turn)
		if (sneakAttackDamage > 0 || cunningStrikeEffects.length) {
			this._sneakAttackEnabled = false;
			this._sneakAttackHasAdjacentAlly = false;
			this._resetCunningStrikeSelections();
			this._renderSneakAttackToggle?.();
		}
	}

	_isSneakAttackWeaponEligible (attack) {
		if (!attack || attack.isSpell) return false;

		if (attack.isRanged) return true;
		if (attack.abilityMod === "dex" || attack.abilityMod === "finesse") return true;

		const properties = attack.properties || [];
		return properties.includes("F") || properties.includes("T")
			|| properties.some?.(prop => typeof prop === "string" && /^(F|T)(\||$)/.test(prop));
	}

	_isSneakAttackAvailableThisTurn () {
		if (!this._state?.isInCombat?.()) return true;

		const round = this._state.getCombatRound?.() || 0;
		if (!round) return true;
		return this._lastSneakAttackRoundUsed !== round;
	}

	_markSneakAttackUsedThisTurn () {
		if (!this._state?.isInCombat?.()) return;
		const round = this._state.getCombatRound?.() || 0;
		if (!round) return;
		this._lastSneakAttackRoundUsed = round;
	}

	_isSneakAttackContextDisadvantaged (attackId) {
		if (!this._lastAttackContext || this._lastAttackContext.attackId !== attackId) return false;
		return this._lastAttackContext.mode === "disadvantage" || this._lastAttackContext.hasDisadvantage;
	}

	_isSneakAttackContextAdvantaged (attackId) {
		if (!this._lastAttackContext || this._lastAttackContext.attackId !== attackId) return false;
		return this._lastAttackContext.mode === "advantage" || this._lastAttackContext.hasAdvantage;
	}

	_isSneakAttackTriggerSatisfied (attackId, {showWarnings = true} = {}) {
		const hasAdvantage = this._isSneakAttackContextAdvantaged(attackId);
		const hasDisadvantage = this._isSneakAttackContextDisadvantaged(attackId);

		if (hasDisadvantage) {
			if (showWarnings) {
				JqueryUtil.doToast({
					type: "warning",
					content: "Sneak Attack can't apply when this attack has disadvantage.",
				});
			}
			return false;
		}

		if (hasAdvantage || this._sneakAttackHasAdjacentAlly) return true;

		if (showWarnings) {
			JqueryUtil.doToast({
				type: "warning",
				content: "Sneak Attack requires advantage or an adjacent ally threatening the target.",
			});
		}
		return false;
	}

	_resetTurnActionUsage () {
		this._turnActionUsage = {action: false, bonus: false, reaction: false};
		this._handOfHarmUsedThisTurn = false;
	}

	_isActionTypeAvailable (actionType) {
		if (!this._state?.isInCombat?.()) return true;
		if (!actionType || actionType === "free") return true;
		return !this._turnActionUsage?.[actionType];
	}

	_consumeActionType (actionType) {
		if (!this._state?.isInCombat?.()) return;
		if (!actionType || actionType === "free") return;
		if (!this._turnActionUsage) this._resetTurnActionUsage();
		if (Object.hasOwn(this._turnActionUsage, actionType)) this._turnActionUsage[actionType] = true;
	}

	_getFeatureActionType (feature) {
		const desc = feature?.description?.toLowerCase() || "";
		if (/bonus action/i.test(desc)) return "bonus";
		if (/reaction/i.test(desc)) return "reaction";
		if (/no action required|free/i.test(desc)) return "free";
		return "action";
	}

	_canApplySneakAttack (attack, sneakAttackInfo, {showWarnings = true} = {}) {
		if (!sneakAttackInfo || !this._sneakAttackEnabled) return false;

		if (!this._isSneakAttackWeaponEligible(attack)) {
			if (showWarnings) {
				JqueryUtil.doToast({
					type: "warning",
					content: "Sneak Attack requires a finesse or ranged weapon attack.",
				});
			}
			return false;
		}

		if (!this._isSneakAttackAvailableThisTurn()) {
			if (showWarnings) {
				JqueryUtil.doToast({
					type: "warning",
					content: "Sneak Attack has already been used this round.",
				});
			}
			return false;
		}

		if (!this._isSneakAttackTriggerSatisfied(attack.id, {showWarnings})) return false;

		return true;
	}

	_parseDamage (damageStr, isCrit = false) {
		// Parse dice notation like "1d8", "2d6+2", etc.
		const match = damageStr.match(/(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?/);
		if (!match) {
			return {total: 0, rolls: []};
		}

		let numDice = parseInt(match[1]);
		const dieSize = parseInt(match[2]);
		const modifier = match[4] ? parseInt(match[4]) * (match[3] === "-" ? -1 : 1) : 0;

		// Double dice on crit
		if (isCrit) numDice *= 2;

		const rolls = [];
		let total = 0;

		for (let i = 0; i < numDice; i++) {
			const roll = this._page.rollDice(1, dieSize);
			rolls.push(roll);
			total += roll;
		}

		total += modifier;

		return {total, rolls, modifier};
	}

	/**
	 * Resolve an ability modifier key, handling special cases like "finesse" and "spellcasting"
	 * @param {string} abilityKey - The ability key (e.g., "str", "dex", "finesse", "spellcasting")
	 * @returns {number} The resolved ability modifier
	 */
	_resolveAbilityMod (abilityKey) {
		if (abilityKey === "finesse") {
			return Math.max(this._state.getAbilityMod("str"), this._state.getAbilityMod("dex"));
		} else if (abilityKey === "spellcasting") {
			return Math.max(
				this._state.getAbilityMod("int"),
				this._state.getAbilityMod("wis"),
				this._state.getAbilityMod("cha"),
			);
		}
		return this._state.getAbilityMod(abilityKey);
	}

	/**
	 * Parse a bonus string like "+1", "+2", "+3" into a number
	 * @param {string|number} bonus - The bonus value (e.g., "+1", "2", or a number)
	 * @returns {number} The parsed bonus as a number
	 */
	_parseBonus (bonus) {
		if (bonus == null) return 0;
		if (typeof bonus === "number") return bonus;
		// Parse strings like "+1", "+2", "-1"
		const parsed = parseInt(bonus.toString().replace(/\s/g, ""), 10);
		return isNaN(parsed) ? 0 : parsed;
	}

	_parseDieMax (dieStr) {
		// Parse "1d6" → 6, "2d8" → 16, "1d10" → 10
		const match = (dieStr || "").match(/(\d+)d(\d+)/);
		if (!match) return 0;
		return parseInt(match[1]) * parseInt(match[2]);
	}

	_rollInitiative (event) {
		const mod = this._state.getInitiative();
		const rollResult = this._page.rollD20({event});
		const total = rollResult.roll + mod;

		const modeLabel = this._page.getModeLabel(rollResult.mode);
		this._page.showDiceResult({
			title: `Initiative${modeLabel}`,
			roll: rollResult.roll,
			modifier: mod,
			total,
			subtitle: this._page.formatD20Breakdown(rollResult, mod),
		});

		// Update initiative display
		document.getElementById("charsheet-initiative-value").textContent = total;

		// Trigger initiative-based focus/ki recovery features
		this._triggerInitiativeRecovery();
	}

	/**
	 * Trigger recovery features that activate on initiative rolls (Uncanny Metabolism, Perfect Focus/Self).
	 * Uncanny Metabolism (XPHB Monk 2+): Regain all focus points + heal (Martial Arts die + Monk level). 1/long rest.
	 * Perfect Focus (XPHB Monk 15+): If UM not used and focus <= 3, regain up to 4.
	 * Perfect Self (PHB Monk 20): If ki = 0, regain 4.
	 */
	async _triggerInitiativeRecovery () {
		const calc = this._state.getFeatureCalculations?.() || {};
		const kiMax = this._state.getKiPoints?.() || 0;
		const kiCurrent = this._state.getKiPointsCurrent?.() || 0;

		// Uncanny Metabolism (1/long rest, optional — player chooses)
		if (calc.hasUncannyMetabolism && kiCurrent < kiMax) {
			const feature = this._state.getFeature("Uncanny Metabolism");

			// Backfill uses for existing saves that have the feature but no .uses tracking
			if (feature && !feature.uses) {
				feature.uses = {max: 1, current: 1, recharge: "long"};
			}
			// Feature may not be in _data.features for old saves — trust getFeatureCalculations
			const hasUsesLeft = feature ? feature.uses.current > 0 : true;

			if (hasUsesLeft) {
				const pointName = calc.focusPoints ? "Focus" : "Ki";
				const chosen = await this._showCombatActionChoiceModal(
					{name: "Uncanny Metabolism"},
					[
						{
							id: "use",
							name: `Use Uncanny Metabolism`,
							description: `Regain all ${pointName} Points (${kiMax}) and heal ${calc.uncannyMetabolismHealing || "1d6+level"} HP. (1/Long Rest)`,
						},
						{
							id: "skip",
							name: "Skip",
							description: "Don't use Uncanny Metabolism this time.",
						},
					],
					() => {},
				);

				if (!chosen || chosen.id !== "use") return;

				// Restore all focus/ki points
				this._state.setKiPointsCurrent(kiMax);

				// Roll martial arts die for healing
				const martialArtsDice = calc.martialArtsDie || "1d6";
				const dieMatch = martialArtsDice.match(/(\d+)d(\d+)/);
				const dieCount = dieMatch ? parseInt(dieMatch[1]) : 1;
				const dieSize = dieMatch ? parseInt(dieMatch[2]) : 6;
				let healRoll = 0;
				for (let i = 0; i < dieCount; i++) {
					healRoll += this._page.rollDice(1, dieSize);
				}

				const monkLevel = this._state.getClassLevel?.("Monk") || 0;
				const totalHeal = healRoll + monkLevel;

				// Apply healing
				const currentHp = this._state.getCurrentHp();
				const maxHp = this._state.getMaxHp();
				this._state.setCurrentHp(Math.min(maxHp, currentHp + totalHeal));

				// Consume the use via proper state method
				if (feature?.uses && feature.id) {
					this._state.setFeatureUses(feature.id, Math.max(0, feature.uses.current - 1));
				} else if (feature?.uses) {
					feature.uses.current = Math.max(0, feature.uses.current - 1);
				}

				JqueryUtil.doToast({
					type: "success",
					content: `Uncanny Metabolism: Regained all ${pointName} Points (${kiMax}) and healed ${totalHeal} HP (${martialArtsDice}+${monkLevel})`,
				});

				this.renderCombatActions();
				this.renderCombatResources();
				this._page._renderResources?.();
				if (this._page._features) this._page._features.render();
				this._page.saveCharacter?.();
				return;
			}
		}

		// Perfect Focus (XPHB Monk 15+): regain focus up to 4 if at 3 or fewer
		if (calc.hasPerfectFocus && kiCurrent <= 3 && kiMax > 0) {
			const newKi = Math.min(kiMax, calc.perfectFocusRecovery || 4);
			if (newKi > kiCurrent) {
				this._state.setKiPointsCurrent(newKi);
				JqueryUtil.doToast({
					type: "info",
					content: `Perfect Focus: Regained Focus Points (now ${newKi}/${kiMax})`,
				});
				this.renderCombatActions();
				return;
			}
		}

		// Perfect Self (PHB Monk 20): regain 4 ki if at 0
		if (calc.hasPerfectSelf && kiCurrent === 0 && kiMax > 0) {
			const recovery = Math.min(kiMax, calc.perfectSelfRecovery || 4);
			this._state.setKiPointsCurrent(recovery);
			JqueryUtil.doToast({
				type: "info",
				content: `Perfect Self: Regained ${recovery} Ki Points`,
			});
			this.renderCombatActions();
		}
	}

	_rollDeathSave (isManualSuccess = null) {
		const deathSaves = this._state.getDeathSaves();

		if (isManualSuccess !== null) {
			// Manual success/failure marking
			if (isManualSuccess) {
				deathSaves.successes = Math.min(3, deathSaves.successes + 1);
			} else {
				deathSaves.failures = Math.min(3, deathSaves.failures + 1);
			}
		} else {
			// Roll death save
			const roll = this._page.rollDice(1, 20);

			// C9: Disciplined Survivor adds proficiency bonus to death saves
			const calc = this._state.getFeatureCalculations?.() || {};
			const profBonus = calc.hasDeathSaveProficiency ? (this._state.getProficiencyBonus?.() || 0) : 0;
			const total = roll + profBonus;
			const profNote = profBonus > 0 ? ` (+${profBonus} prof)` : "";

			if (roll === 20) {
				// Natural 20: regain 1 HP
				this._state.heal(1);
				this._resetDeathSaves();
				JqueryUtil.doToast({type: "success", content: "Natural 20! You regain 1 HP and are stable!"});
				this._page.renderCharacter();
				return;
			} else if (roll === 1) {
				// Natural 1: 2 failures
				deathSaves.failures = Math.min(3, deathSaves.failures + 2);
				this._page.showDiceResult({
					title: "Death Save",
					roll,
					total,
					resultClass: "text-danger",
					resultNote: ` (2 Failures!)${profNote}`,
				});
			} else if (total >= 10) {
				deathSaves.successes = Math.min(3, deathSaves.successes + 1);
				this._page.showDiceResult({
					title: "Death Save",
					roll,
					total,
					resultClass: "text-success",
					resultNote: ` (Success)${profNote}`,
				});
			} else {
				deathSaves.failures = Math.min(3, deathSaves.failures + 1);
				this._page.showDiceResult({
					title: "Death Save",
					roll,
					total,
					resultClass: "text-danger",
					resultNote: ` (Failure)${profNote}`,
				});
			}
		}

		this._state.setDeathSaves(deathSaves);

		// Check for stabilization or death
		if (deathSaves.successes >= 3) {
			JqueryUtil.doToast({type: "success", content: "You have stabilized!"});
			this._resetDeathSaves();
		} else if (deathSaves.failures >= 3) {
			JqueryUtil.doToast({type: "danger", content: "Your character has died."});
		}

		this.renderDeathSaves();
		this._page.saveCharacter();
	}

	_resetDeathSaves () {
		this._state.setDeathSaves({successes: 0, failures: 0});
		this.renderDeathSaves();
		this._page.saveCharacter();
	}

	// #region Rendering
	renderAttacks () {
		const container = document.getElementById("charsheet-attacks-list") || document.getElementById("charsheet-combat-attacks");
		if (!container) return;

		container.innerHTML = "";

		// Get configured attacks
		let attacks = this._state.getAttacks();

		// Also add attacks from equipped weapons if not already configured
		const items = this._state.getItems();
		const equippedWeapons = items.filter(i => i.weapon && i.equipped);

		equippedWeapons.forEach(weapon => {
			// Check if we already have an attack for this weapon
			const existingAttack = attacks.find(a => a.name === weapon.name);
			if (!existingAttack) {
				// Get any user overrides for this weapon's attack
				const overrides = weapon.attackOverrides || {};

				// Auto-generate attack from weapon
				// Use property (5etools format) or properties (normalized format)
				const props = weapon.property || weapon.properties || [];
				const isRanged = props.some(p => p === "A" || p === "T" || p.startsWith("A|") || p.startsWith("T|"));
				const hasFinesse = props.some(p => p === "F" || p.startsWith("F|"));
				const isMonkWeapon = this._state.isMonkWeapon?.(weapon);
				const defaultAbility = isRanged ? "dex" : ((hasFinesse || isMonkWeapon) ? "finesse" : "str");

				// Calculate total bonuses including magic item bonuses, upgrade bonuses, and custom bonuses
				const effectiveBonuses = this._state.getEffectiveItemBonuses?.(weapon.id);
				let magicAttackBonus;
				let magicDamageBonus;
				let damageDieIncrease = 0;
				if (effectiveBonuses) {
					magicAttackBonus = (effectiveBonuses.bonusWeapon || 0) + (effectiveBonuses.bonusWeaponAttack || 0);
					magicDamageBonus = (effectiveBonuses.bonusWeapon || 0) + (effectiveBonuses.bonusWeaponDamage || 0);
					damageDieIncrease = effectiveBonuses.damageDieIncrease || 0;
				} else {
					magicAttackBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponAttack || 0);
					magicDamageBonus = (weapon.bonusWeapon || 0) + (weapon.bonusWeaponDamage || 0);
				}
				const customAttackBonus = weapon.customAttackBonus || 0;
				const customDamageBonus = weapon.customDamageBonus || 0;

				// Extract raw damage die — prefer dmg1 (raw), fall back to parsing from formatted damage string
				let baseDamageDie = weapon.dmg1 || (weapon.damage ? weapon.damage.split(" ")[0] : null) || "1d6";
				let baseDamageType = weapon.dmgType
					? Parser.dmgTypeToFull(weapon.dmgType)
					: (weapon.damageType || (weapon.damage ? weapon.damage.split(" ").slice(1).join(" ") : null) || "slashing");

				// Monk weapon damage: use martial arts die if higher than weapon die
				if (isMonkWeapon) {
					const calc = this._state.getFeatureCalculations();
					if (calc.martialArtsDie) {
						const weaponMax = this._parseDieMax(baseDamageDie);
						const monkMax = this._parseDieMax(calc.martialArtsDie);
						if (monkMax > weaponMax) baseDamageDie = calc.martialArtsDie;
					}
				}

				// Apply Superior upgrade damage die increase (e.g., 1d6 → 1d8)
				if (damageDieIncrease > 0 && typeof CharacterSheetUpgrades !== "undefined") {
					baseDamageDie = CharacterSheetUpgrades.increaseDamageDie(baseDamageDie, damageDieIncrease);
				}

				const autoAttack = {
					id: `auto_${weapon.id}`,
					// Use overrides if present, otherwise use weapon defaults
					name: overrides.name ?? weapon.name,
					isMelee: overrides.isMelee ?? !isRanged,
					abilityMod: overrides.abilityMod ?? defaultAbility,
					attackBonus: magicAttackBonus + customAttackBonus,
					range: overrides.range ?? (weapon.range || (isRanged ? "80/320 ft." : "5 ft.")),
					damage: overrides.damage ?? baseDamageDie,
					damageType: overrides.damageType ?? baseDamageType,
					damageBonus: magicDamageBonus + customDamageBonus,
					properties: overrides.properties ?? props,
					mastery: weapon.mastery || [],
					isAutoGenerated: true,
					isMonkWeapon: !!isMonkWeapon,
					sourceItem: weapon, // Keep reference for hover
				};
				attacks.push(autoAttack);
			}
		});

		this._cachedAttacks = [...attacks];

		// Append temporary attacks (from variant spell components, etc.)
		const tempAttacks = this._state.getTemporaryAttacks?.() || [];
		for (const ta of tempAttacks) {
			attacks.push({...ta, isTemporary: true});
		}

		if (!attacks.length) {
			container.innerHTML = `
				<p class="ve-muted text-center">
					No attacks configured. Equip weapons from Inventory or add custom attacks.
					<br>
					<button class="ve-btn ve-btn-primary ve-btn-sm mt-2" id="charsheet-add-attack-empty">
						<span class="glyphicon glyphicon-plus"></span> Add Attack
					</button>
				</p>
			`;

			document.getElementById("charsheet-add-attack-empty")?.addEventListener("click", () => this._showAttackCreator());
			return;
		}

		attacks.forEach(attack => {
			const item = this._renderAttackItem(attack);
			container.append(item);
		});
	}

	_renderAttackItem (attack) {
		// Calculate ability modifier - handle special cases for natural weapons
		let abilityMod;
		const abilityKey = attack.abilityMod || "str";
		if (abilityKey === "finesse") {
			// Use higher of STR or DEX
			abilityMod = Math.max(this._state.getAbilityMod("str"), this._state.getAbilityMod("dex"));
		} else if (abilityKey === "spellcasting") {
			// Use highest mental stat as approximation for spellcasting ability
			abilityMod = Math.max(
				this._state.getAbilityMod("int"),
				this._state.getAbilityMod("wis"),
				this._state.getAbilityMod("cha"),
			);
		} else {
			abilityMod = this._state.getAbilityMod(abilityKey);
		}

		const profBonus = this._state.getProficiencyBonus();
		const totalAttackBonus = abilityMod + profBonus + (attack.attackBonus || 0);
		const totalDamageBonus = abilityMod + (attack.damageBonus || 0);
		const isAutoGenerated = attack.isAutoGenerated || attack.id?.startsWith?.("auto_");
		const isNaturalWeapon = attack.isNaturalWeapon;

		// Get critical range
		const critRange = this._state.getCriticalRange?.() || 20;
		const critRangeHtml = critRange < 20
			? `<span class="badge badge-warning" title="Critical Hit Range: ${critRange}-20">Crit ${critRange}+</span>`
			: "";

		// Format properties using the same logic as inventory
		const propertyNames = (attack.properties || [])
			.map(p => this._formatProperty(p))
			.filter(Boolean);
		const propertiesHtml = propertyNames.length
			? `<span class="ve-small ve-muted">(${propertyNames.join(", ")})</span>`
			: "";

		// Format mastery
		const masteryNames = (attack.mastery || [])
			.map(m => this._formatMastery(m))
			.filter(Boolean);
		const masteryHtml = masteryNames.length
			? `<span class="ve-small text-info" title="Mastery">⚔ ${masteryNames.join(", ")}</span>`
			: "";

		// Create hoverable name for auto-generated attacks
		let nameHtml;
		if (isAutoGenerated && attack.sourceItem) {
			const item = attack.sourceItem;
			try {
				nameHtml = Renderer.get().render(`{@item ${item.name}|${item.source || "PHB"}}`);
			} catch (e) {
				nameHtml = attack.name;
			}
		} else {
			nameHtml = attack.name;
		}

		// Determine badge type
		let badgeHtml = "";
		if (attack.isTemporary) {
			const srcParts = [attack.sourceComponent, attack.sourceSpell, attack.sourceDuration].filter(Boolean);
			const srcTitle = srcParts.length ? srcParts.join(" — ") : "Temporary Attack";
			badgeHtml = ` <span class="badge badge-info" title="${srcTitle}">🧪 Temp</span>`;
		} else if (attack.isMonkWeapon) {
			const title = attack.isUnarmedStrike ? "Monk Unarmed Strike with Martial Arts" : "Monk Weapon \u2014 uses Martial Arts die and DEX";
			badgeHtml = ` <span class="badge badge-warning" title="${title}">Monk</span>`;
		} else if (isNaturalWeapon) {
			badgeHtml = " <span class=\"badge badge-info\" title=\"Natural Weapon from feature\">Natural</span>";
		} else if (isAutoGenerated) {
			badgeHtml = " <span class=\"badge badge-secondary\">Auto</span>";
		}

		// Show active combat method effect badge
		const methodEffects = this._state.getActiveCombatMethodEffects?.() || [];
		const activeMethod = methodEffects.find(e => e.weaponId === attack.id);
		if (activeMethod) {
			const methodTitle = `${activeMethod.name}${activeMethod.ongoingDamage ? `: ${activeMethod.ongoingDamage} ongoing damage` : ""}`;
			badgeHtml += ` <span class="badge badge-danger" title="${methodTitle}">🩸 ${activeMethod.name}</span>`;
		}

		// Show upgrade/gemstone badges for auto-generated attacks with upgraded items
		let upgradeNotesHtml = "";
		if (attack.sourceItem?.appliedUpgrades?.length) {
			if (typeof CharacterSheetUpgrades !== "undefined") {
				const eff = CharacterSheetUpgrades.getUpgradeEffects(attack.sourceItem);
				const parts = [];
				if (eff.bonusWeaponAttack) parts.push(`+${eff.bonusWeaponAttack} atk`);
				if (eff.bonusWeaponDamage) parts.push(`+${eff.bonusWeaponDamage} dmg`);
				if (eff.critThresholdReduction) parts.push(`crit ${20 - eff.critThresholdReduction}-20`);
				if (eff.damageDieIncrease) parts.push(`die +${eff.damageDieIncrease}`);
				if (eff.bonusDamageDice) parts.push(`+${eff.bonusDamageDice} ${eff.bonusDamageType}`);
				const tagStr = eff.tags.length ? eff.tags.join(", ") : "";
				const bonusStr = parts.length ? parts.join(", ") : "";
				const tooltip = [bonusStr, tagStr].filter(Boolean).join(" | ");
				badgeHtml += ` <span class="badge badge-info" title="${tooltip || "Upgrades"}">⚒ ${attack.sourceItem.appliedUpgrades.length}</span>`;
				for (const tag of eff.tags) {
					badgeHtml += ` <span class="badge badge-secondary" title="${tag}">${tag}</span>`;
				}
				if (eff.notes.length) upgradeNotesHtml = eff.notes.map(n => `<div class="ve-small ve-muted charsheet__attack-upgrade-note">${n}</div>`).join("");
			} else {
				const upgradeNames = attack.sourceItem.appliedUpgrades.map(u => u.name).join(", ");
				badgeHtml += ` <span class="badge badge-info" title="Upgrades: ${upgradeNames}">⚒ ${attack.sourceItem.appliedUpgrades.length}</span>`;
			}
		}
		if (attack.sourceItem?.socketedGemstones?.length) {
			const gem = attack.sourceItem.socketedGemstones[0];
			const summary = typeof CharacterSheetUpgrades !== "undefined" ? CharacterSheetUpgrades.getGemstoneSummary(gem) : "";
			const chargeStr = gem.chargesMax ? ` [${gem.chargesCurrent ?? gem.chargesMax}/${gem.chargesMax}]` : "";
			badgeHtml += ` <span class="badge badge-success" title="${gem.name}${chargeStr}${summary ? `: ${summary}` : ""}">💎 ${gem.gemName || gem.name}${chargeStr}</span>`;
			if (summary && !upgradeNotesHtml) upgradeNotesHtml = `<div class="ve-small ve-muted charsheet__attack-upgrade-note">💎 ${summary}</div>`;
		}

		return e_({outer: `
			<div class="charsheet__attack-item" data-attack-id="${attack.id}">
				<div class="charsheet__attack-info">
					<span class="charsheet__attack-name">${nameHtml}${badgeHtml}</span>
					<span class="charsheet__attack-details">
						${attack.range ? `<span class="ve-muted">${attack.range}</span>` : ""}
						<span class="badge badge-primary">+${totalAttackBonus}</span>
						<span class="badge badge-danger">${attack.damage}${totalDamageBonus >= 0 ? "+" : ""}${totalDamageBonus} ${attack.damageType}</span>
						${critRangeHtml}
						${propertiesHtml}
						${masteryHtml}
					</span>
					${upgradeNotesHtml}
				</div>
				<div class="charsheet__attack-actions">
					<button class="ve-btn ve-btn-sm ve-btn-primary charsheet__attack-roll" title="Roll Attack">
						<span class="glyphicon glyphicon-screenshot"></span> Attack
					</button>
					<button class="ve-btn ve-btn-sm ve-btn-danger charsheet__attack-damage" title="Roll Damage">
						<span class="glyphicon glyphicon-fire"></span> Damage
					</button>
					<button class="ve-btn ve-btn-sm ${this._state.getAttackNote?.(attack.id) ? "ve-btn-warning" : "ve-btn-default"} charsheet__attack-note" title="${this._state.getAttackNote?.(attack.id) ? "Edit Note" : "Add Note"}">
						<span class="glyphicon glyphicon-comment"></span>
					</button>
					${attack.isTemporary ? "" : `<button class="ve-btn ve-btn-sm ve-btn-default charsheet__attack-edit" title="${isAutoGenerated ? "Edit in Inventory" : "Edit"}">
						<span class="glyphicon glyphicon-pencil"></span>
					</button>`}
					<button class="ve-btn ve-btn-sm ve-btn-default charsheet__attack-remove" title="${attack.isTemporary ? "Dismiss Temporary Attack" : isAutoGenerated ? "Unequip Weapon" : "Remove"}">
						<span class="glyphicon glyphicon-trash"></span>
					</button>
				</div>
			</div>
		`});
	}

	/**
	 * Format a weapon property code to display name
	 * @param {string} prop - Property code like "2H|XPHB" or just "2H"
	 * @returns {string} Formatted property name
	 */
	_formatProperty (prop) {
		// Try using Parser if available
		if (typeof Parser !== "undefined" && Parser.itemPropertyToFull) {
			try {
				return Parser.itemPropertyToFull(prop);
			} catch (e) {
				// Fall back to basic formatting
			}
		}

		// Basic property code mapping
		const propMap = {
			"A": "Ammunition",
			"AF": "Ammunition (Firearm)",
			"F": "Finesse",
			"H": "Heavy",
			"L": "Light",
			"LD": "Loading",
			"R": "Reach",
			"RLD": "Reload",
			"S": "Special",
			"T": "Thrown",
			"2H": "Two-Handed",
			"V": "Versatile",
		};

		// Extract property code (before |)
		const code = prop.split("|")[0].toUpperCase();
		return propMap[code] || code;
	}

	/**
	 * Format a weapon mastery code to display name
	 * @param {string} mastery - Mastery code like "Sap|XPHB"
	 * @returns {string} Formatted mastery name
	 */
	_formatMastery (mastery) {
		// Extract mastery name (before |source)
		const name = mastery.split("|")[0];
		return (/** @type {*} */ (name)).toTitleCase();
	}

	renderDeathSaves () {
		const deathSaves = this._state.getDeathSaves();

		// Render success pips
		document.querySelectorAll(".charsheet__death-save-success .charsheet__death-save-pip").forEach((el, i) => {
			el.classList.toggle("filled", i < deathSaves.successes);
		});

		// Render failure pips
		document.querySelectorAll(".charsheet__death-save-failure .charsheet__death-save-pip").forEach((el, i) => {
			el.classList.toggle("filled", i < deathSaves.failures);
		});

		// C9: Render Disciplined Survivor reroll button + proficiency note
		const calc = this._state.getFeatureCalculations?.() || {};
		const rerollContainer = document.querySelector(".charsheet__death-save-reroll");
		if (rerollContainer) {
			rerollContainer.innerHTML = "";
			if (calc.hasDisciplinedSurvivor) {
				const profBonus = this._state.getProficiencyBonus?.() || 0;
				if (profBonus > 0) {
					rerollContainer.append(e_({outer: `<span class="ve-small ve-muted mr-2">+${profBonus} prof</span>`}));
				}
				const rerollCost = calc.disciplinedSurvivorRerollCost || 1;
				const btn = e_({outer: `<button class="ve-btn ve-btn-xs ve-btn-primary" title="Spend ${rerollCost} Focus Point to reroll a failed death save">Reroll (${rerollCost} Focus)</button>`});
				btn.addEventListener("click", () => {
					const focusPoints = this._state.getKiPointsCurrent?.() || 0;
					if (focusPoints < rerollCost) {
						JqueryUtil.doToast({type: "warning", content: "Not enough Focus Points to reroll!"});
						return;
					}
					this._state.useKiPoint(rerollCost);
					this._rollDeathSave();
					JqueryUtil.doToast({type: "info", content: `Spent ${rerollCost} Focus Point to reroll death save`});
				});
				rerollContainer.append(btn);
			}
		}
	}

	renderCombatSpells () {
		const container = document.getElementById("charsheet-combat-spells");
		const section = document.getElementById("charsheet-combat-spells-section");
		if (!container) return;

		container.innerHTML = "";

		// Get spells - cantrips and prepared attack spells
		const spells = this._state.getSpells();

		// Hide the entire section if character has no spells at all
		if (!spells.length) {
			if (section) section.style.display = "none";
			return;
		}
		if (section) section.style.display = "";

		// Get spell attack and save DC — Gambler uses dice formula instead of static value
		const calcs = this._state.getFeatureCalculations?.();
		const isGambler = calcs?.hasGamblerSpellcasting;

		const elSpellAttack = document.getElementById("charsheet-combat-spell-attack");
		const elSpellDc = document.getElementById("charsheet-combat-spell-dc");
		if (isGambler) {
			if (elSpellAttack) elSpellAttack.textContent = calcs.gamblerSpellAttackFormula;
			if (elSpellDc) elSpellDc.textContent = calcs.gamblerSpellDcFormula;
		} else {
			const spellAttack = this._state.getSpellAttackBonus?.() || 0;
			const spellDC = this._state.getSpellSaveDc?.() || 10;
			if (elSpellAttack) elSpellAttack.textContent = `+${spellAttack}`;
			if (elSpellDc) elSpellDc.textContent = spellDC;
		}

		// Filter to combat-relevant spells: cantrips + prepared leveled spells
		const combatSpells = spells.filter(spell => {
			// Always show cantrips
			if (spell.level === 0) return true;
			// Show prepared leveled spells
			return spell.prepared;
		}).sort((a, b) => {
			// Sort by level, then name
			if (a.level !== b.level) return a.level - b.level;
			return a.name.localeCompare(b.name);
		});

		if (!combatSpells.length) {
			container.innerHTML = `<p class="ve-muted text-center">No prepared spells. Prepare spells from the Spells tab to use them in combat.</p>`;
			return;
		}

		// Group by level
		const spellsByLevel = {};
		combatSpells.forEach(spell => {
			const level = spell.level === 0 ? "Cantrips" : `Level ${spell.level}`;
			if (!spellsByLevel[level]) spellsByLevel[level] = [];
			spellsByLevel[level].push(spell);
		});

		// Get spell slots for display
		const slots = this._state.getSpellSlots();
		const pactSlots = this._state.getPactSlots();

		// Render each group
		Object.entries(spellsByLevel).forEach(([level, levelSpells]) => {
			const group = e_({tag: "div", clazz: "charsheet__combat-spell-group mb-2"});

			// Build level header with slot info
			let slotInfo = "";
			if (level !== "Cantrips") {
				const levelNum = parseInt(level.replace("Level ", ""));
				const slotData = slots[levelNum];
				if (slotData && slotData.max > 0) {
					slotInfo = ` <span class="ve-muted">(${slotData.current}/${slotData.max} slots)</span>`;
				}
				// Also show pact slots if character has them and this is the pact slot level
				if (pactSlots && pactSlots.level === levelNum && pactSlots.max > 0) {
					slotInfo += ` <span class="ve-muted" style="color: #9b59b6">(${pactSlots.current}/${pactSlots.max} pact)</span>`;
				}
			}

			group.append(e_({outer: `<div class="charsheet__combat-spell-level ve-small">${level}${slotInfo}</div>`}));

			levelSpells.forEach(spell => {
				const spellEl = this._renderCombatSpellItem(spell);
				group.append(spellEl);
			});

			container.append(group);
		});
	}

	_renderCombatSpellItem (spell) {
		const isCantrip = spell.level === 0;
		const spellId = spell.id || `${spell.name}|${spell.source}`;

		// Look up full spell data for metamagic and hover
		const spellData = this._page._spells?._allSpells?.find(s => s.name === spell.name && s.source === spell.source);
		const modStats = this._state.getModifiedSpellStats?.(spellData);

		// Create hoverable spell name — uses custom predefined hover with metamagic + rarity/legality
		let spellLink;
		try {
			if (this._page?.getSpellHoverLink) {
				spellLink = this._page.getSpellHoverLink(
					spell.name,
					spell.source || Parser.SRC_XPHB,
					spellData,
					spell,
				);
			} else if (this._page?.getHoverLink) {
				spellLink = this._page.getHoverLink(
					UrlUtil.PG_SPELLS,
					spell.name,
					spell.source || Parser.SRC_XPHB,
				);
			} else {
				spellLink = Renderer.get().render(`{@spell ${spell.name}|${spell.source || "PHB"}}`);
			}
		} catch (e) {
			spellLink = spell.name;
		}

		// Get school full name
		const schoolFull = spell.school ? Parser.spSchoolAbvToFull(spell.school) : "";

		// Build details string — apply tuned passive metamagic stat overrides
		const detailParts = [];
		const castingTime = spell.castingTime || "";
		if (castingTime) detailParts.push(castingTime);

		if (modStats?.range?.changed) {
			detailParts.push(modStats.range.modified);
		} else if (spell.range) {
			detailParts.push(spell.range);
		}

		if (modStats?.duration?.changed) {
			detailParts.push(modStats.duration.modified);
		} else if (spell.duration) {
			detailParts.push(spell.duration);
		}

		const components = spell.components || "";
		if (components) detailParts.push(components);
		const details = detailParts.join(" · ");

		const metamagicNotesHtml = modStats?.notes?.length
			? `<div class="charsheet__metamagic-mod ve-small">${modStats.notes.join(" · ")}</div>`
			: "";

		const el = e_({outer: `
			<div class="charsheet__combat-spell-item" data-spell-id="${spellId}">
				<div class="charsheet__combat-spell-info">
					<div class="charsheet__combat-spell-header">
						<span class="charsheet__combat-spell-name">${spellLink}</span>
						${schoolFull ? `<span class="badge badge-secondary ve-small ml-1">${schoolFull}</span>` : ""}
						${spell.concentration ? `<span class="badge badge-info ve-small ml-1" title="Concentration">C</span>` : ""}
					</div>
					${details ? `<div class="charsheet__combat-spell-details ve-muted ve-small">${details}</div>` : ""}
					${metamagicNotesHtml}
				</div>
				<button class="ve-btn ve-btn-xs ve-btn-success charsheet__combat-spell-cast" data-spell-id="${spellId}" title="Cast Spell">
					<span class="glyphicon glyphicon-flash"></span> Cast
				</button>
			</div>
		`});

		// Add click handler on spell name to show metamagic-aware info modal
		const nameEl = el.querySelector(".charsheet__combat-spell-name");
		if (nameEl && spellData && this._page._spells) {
			nameEl.style.cursor = "pointer";
			nameEl.addEventListener("click", (/** @type {*} */ e) => {
				e.preventDefault();
				e.stopPropagation();
				this._page._spells._showSpellInfoFromData(spellData);
			});
		}

		return el;
	}

	render () {
		// Always refresh state reference from page at start of render
		this._state = this._page.getState();

		this.renderAttacks();
		this.renderDeathSaves();
		this.renderCombatSpells();
		this.renderCombatMethods();
		this.renderCombatDefenses();
		this.renderCombatConditions();
		this.renderCombatEffects();
		this.renderCombatResources();
		this.renderCombatActions();
		this.renderCombatMetamagic();
		this.renderCombatStates();

		// Render combat stats
		const initiative = this._state.getInitiative();
		const elInitiative = document.getElementById("charsheet-initiative");
		if (elInitiative) elInitiative.textContent = `${initiative >= 0 ? "+" : ""}${initiative}`;
	}

	/**
	 * Render combat actions - race/class/feat abilities that use action economy
	 * (e.g., Aggressive, Charge, Ram, Breath Weapon, Relentless Endurance, etc.)
	 */
	renderCombatActions () {
		const container = document.getElementById("charsheet-combat-actions");
		const section = document.getElementById("charsheet-combat-actions-section");
		if (!container) return;

		const features = this._state.getFeatures();

		// Filter for combat-relevant features that have action economy
		const combatActions = features.filter(f => {
			const nameLower = f.name?.toLowerCase() || "";

			// Features explicitly classified as combat actions or reactions via overrides
			// are always included regardless of other heuristics
			const classificationOverride = CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES?.[nameLower];
			if (classificationOverride === "combat" || classificationOverride === "reaction") return true;

			// Get description - render entries as fallback if description missing
			let desc = f.description;
			if (!desc && f.entries) {
				try {
					desc = Renderer.get().render({entries: f.entries});
				} catch (e) {
					desc = "";
				}
			}
			if (!desc) return false;
			// Strip HTML tags so rendered {@variantrule Bonus Action|XPHB} etc. don't break regex matching
			desc = desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

			// Skip combat methods (they have their own section)
			if (CharacterSheetClassUtils.isCombatMethod(f)) return false;

			// Skip metamagic features (managed via metamagic dashboard)
			if (f.optionalFeatureTypes?.includes("MM")) return false;

			// Exclude non-combat features explicitly
			const excludePatterns = [
				"suggested characteristics",
				"personality trait",
				"ideal",
				"bond",
				"flaw",
				"equipment",
				"tool proficiency",
				"skill proficiency",
				"languages",
				"starting equipment",
				"proficiencies",
				"background feature",
				"feature:",
				"you gain proficiency",
				"you are proficient",
				"you have proficiency",
				"you can speak",
				"you can read",
				"darkvision",
				"creature type",
				"size",
				"speed",
				"ability score",
			];
			if (excludePatterns.some(pattern => nameLower.includes(pattern) || (desc.includes(pattern) && !desc.includes("action")))) {
				// Only exclude if there's no action economy
				if (!/\b(bonus action|as an action|use your action|as a reaction)\b/i.test(desc)) {
					return false;
				}
			}

			// Must have actual action economy to be considered a combat action
			// More strict: require specific action phrasing, not just "you can use"
			const hasActionEconomy = /\b(as a bonus action|bonus action to|as an action|use your action|take the \w+ action|take a bonus action|take a reaction|take an action|as a reaction|use your reaction)\b/i.test(desc);

			// Check for combat-specific keywords in NAME (not description, too broad)
			const combatKeywords = [
				"aggressive", "charge", "ram", "breath weapon", "relentless",
				"fury of the small", "savage attacks", "hellish rebuke", "healing hands",
				"celestial revelation", "infernal legacy", "fey step", "misty step",
				"stone's endurance", "lucky", "second wind", "action surge",
				"fighting spirit", "cunning action", "uncanny dodge",
				"tantalizing shivers", // Belly Dancer (TGTT Rogue)
				"patient defense", "step of the wind",
				"flurry of blows", "stunning strike", "deflect missiles", "deflect attacks", "slow fall",
				"hand of healing", "hand of harm", "hand of ultimate mercy",
				"wild shape", "channel divinity", "divine smite", "lay on hands",
				"hex", "hexblade's curse",
				"rage", "reckless attack",
				"bardic inspiration",
				"arcane recovery",
			];

			const hasCombatKeyword = combatKeywords.some(kw => nameLower.includes(kw));

			// Include if:
			// 1. Has explicit action economy AND (has uses OR combat keyword in name), OR
			// 2. Has combat keyword in name AND has uses
			const hasLimitedUses = f.uses && f.uses.max > 0;

			return (hasActionEconomy && (hasLimitedUses || hasCombatKeyword))
				|| (hasCombatKeyword && (hasLimitedUses || hasActionEconomy));
		});

		// Sort: features with uses first, then by feature type, then by name
		combatActions.sort((a, b) => {
			const aHasUses = a.uses && a.uses.max > 0;
			const bHasUses = b.uses && b.uses.max > 0;
			if (aHasUses && !bHasUses) return -1;
			if (!aHasUses && bHasUses) return 1;

			const typeOrder = ["Species", "Subrace", "Class", "Background", "Other"];
			const aType = typeOrder.indexOf(a.featureType) !== -1 ? typeOrder.indexOf(a.featureType) : 999;
			const bType = typeOrder.indexOf(b.featureType) !== -1 ? typeOrder.indexOf(b.featureType) : 999;
			if (aType !== bType) return aType - bType;

			return (a.name || "").localeCompare(b.name || "");
		});

		// Get limited-use custom abilities
		const customAbilities = this._state.getCustomAbilities?.() || [];
		const limitedAbilities = customAbilities.filter(a => a.mode === "limited");

		// Hide section if no combat actions or custom abilities
		if (!combatActions.length && !limitedAbilities.length) {
			section.style.display = "none";
			return;
		}

		section.style.display = "";
		container.innerHTML = "";

		// Render class/race/feat actions first
		for (const feature of combatActions) {
			// Enrich feature with parsed combat action effects if not already present
			if (!feature.combatActionEffects) {
				const desc = feature.description || "";
				const textClean = desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
				feature.combatActionEffects = CharacterSheetState._parseCombatActionEffects?.(textClean, desc) || null;
			}

			// Merge calculation-driven effects for features with pre-computed data
			const calc = this._state.getFeatureCalculations?.() || {};
			const nameLower = feature.name?.toLowerCase() || "";
			if (nameLower === "wall walk" && calc.wallWalkSpiderClimbEffects) {
				feature.combatActionEffects = {...(feature.combatActionEffects || {}), ...calc.wallWalkSpiderClimbEffects};
			}
			if (nameLower === "instant step" && calc.instantStepEffects) {
				feature.combatActionEffects = {...(feature.combatActionEffects || {}), ...calc.instantStepEffects};
			}

			const actionEl = this._createCombatActionElement(feature);
			container.append(actionEl);
		}

		// Render limited-use custom abilities
		for (const ability of limitedAbilities) {
			const actionEl = this._createCustomAbilityElement(ability);
			container.append(actionEl);
		}
	}

	/**
	 * Create an element for a limited-use custom ability
	 */
	_createCustomAbilityElement (ability) {
		const uses = this._state.getCustomAbilityUsesDisplay?.(ability.id);
		if (!uses) return document.createDocumentFragment();

		const activationAction = ability.activationAction || "free";
		const hasActionAvailable = this._isActionTypeAvailable(activationAction);
		const canUseResource = this._state.canUseCustomAbility?.(ability.id) ?? uses.current > 0;
		const canUse = canUseResource && hasActionAvailable;

		// Determine action type
		let actionIcon = "✨";
		let actionType = "Free";
		if (activationAction === "action") {
			actionIcon = "⚔️";
			actionType = "Action";
		} else if (activationAction === "bonus") {
			actionIcon = "⚡";
			actionType = "Bonus Action";
		} else if (activationAction === "reaction") {
			actionIcon = "🔄";
			actionType = "Reaction";
		}

		// Recharge icon
		const rechargeIcon = uses.recharge === "short" ? "☀️" : "🌙";

		// Category badge
		const categories = CharacterSheetState.CUSTOM_ABILITY_CATEGORIES || {};
		const category = categories[ability.category];
		const categoryBadge = category
			? `<span class="badge badge-secondary mr-1 ve-small">${category.icon} ${category.name}</span>`
			: "";

		const action = e_({outer: `
			<div class="charsheet__combat-action-item charsheet__combat-action-item--custom charsheet__combat-action-clickable" 
				data-ability-id="${ability.id}">
				<div class="charsheet__combat-action-header">
					<span class="charsheet__combat-action-icon" title="${actionType}">${ability.icon || actionIcon}</span>
					<span class="charsheet__combat-action-name">${ability.name}</span>
					${categoryBadge}
				</div>
				<div class="charsheet__combat-action-info">
					<div class="charsheet__combat-action-uses">
						<span class="charsheet__combat-action-uses-label">${uses.current}/${uses.max}</span>
						<span class="charsheet__combat-action-uses-recharge" title="${uses.recharge} rest">${rechargeIcon}</span>
					</div>
					<button class="ve-btn ve-btn-xs ve-btn-primary charsheet__combat-action-use" 
						${!canUse ? "disabled" : ""} title="Use this ability">Use</button>
				</div>
			</div>
		`});

		// Click on card to show modal with description
		action.addEventListener("click", (/** @type {*} */ e) => {
			// Don't trigger if clicking the Use button
			if (e.target.classList.contains("charsheet__combat-action-use")) return;
			this._showAbilityModal(ability);
		});

		// Use button handler
		action.querySelector(".charsheet__combat-action-use").addEventListener("click", (/** @type {*} */ e) => {
			e.stopPropagation();
			this._useCustomAbility(ability);
		});

		return action;
	}

	/**
	 * Use a limited-use custom ability
	 */
	_useCustomAbility (ability) {
		const actionType = ability.activationAction || "free";
		if (!this._isActionTypeAvailable(actionType)) {
			const actionName = actionType === "bonus" ? "Bonus Action" : actionType === "reaction" ? "Reaction" : "Action";
			JqueryUtil.doToast({type: "warning", content: `${actionName} already used this round.`});
			return;
		}

		if (!this._state.canUseCustomAbility?.(ability.id)) {
			JqueryUtil.doToast({type: "warning", content: `No uses remaining for ${ability.name}!`});
			return;
		}

		if (this._state.useCustomAbility(ability.id)) {
			this._consumeActionType(actionType);
			// Re-render
			this.renderCombatActions();
			this.renderCombatResources();
			this._page?._renderResources?.();
			this._page?._renderOverviewAbilities?.();
			this._page?._customAbilities?.render?.();
			this._page?._saveCurrentCharacter?.();

			JqueryUtil.doToast({type: "success", content: `Used ${ability.name}!`});
		}
	}

	/**
	 * Show a modal with ability details
	 */
	_showAbilityModal (ability) {
		const uses = this._state.getCustomAbilityUsesDisplay?.(ability.id);
		const categories = CharacterSheetState.CUSTOM_ABILITY_CATEGORIES || {};
		const category = categories[ability.category];

		// Build effects summary
		let effectsSummary = "";
		if (ability.effects?.length) {
			const effectsList = ability.effects.map(e => {
				if (e.type === "sizeIncrease") return `Size +${e.value || 1} category`;
				if (e.type === "sizeDecrease") return `Size -${e.value || 1} category`;
				if (e.type === "reach") return `Reach +${e.value || 5} ft.`;
				if (e.type?.startsWith("extraDamage:")) return `+${e.dice || "1d6"} ${e.type.replace("extraDamage:", "")} damage`;
				if (e.type?.startsWith("reroll:")) return `Reroll ${e.type.replace("reroll:", "")}`;
				return `${e.type}: ${e.value > 0 ? "+" : ""}${e.value}`;
			});
			effectsSummary = `<div class="mt-2"><strong>Effects:</strong> ${effectsList.join(", ")}</div>`;
		}

		// Build defensive traits summary
		let defenseSummary = "";
		if (ability.defensiveTraits) {
			const parts = [];
			if (ability.defensiveTraits.resistances?.length) {
				parts.push(`Resist: ${ability.defensiveTraits.resistances.join(", ")}`);
			}
			if (ability.defensiveTraits.immunities?.length) {
				parts.push(`Immune: ${ability.defensiveTraits.immunities.join(", ")}`);
			}
			if (parts.length) {
				defenseSummary = `<div class="mt-2"><strong>Defenses:</strong> ${parts.join("; ")}</div>`;
			}
		}

		const modalContent = `
			<div class="charsheet__ability-modal-header">
				<span class="charsheet__ability-modal-icon">${ability.icon || "⚡"}</span>
				<h4 class="charsheet__ability-modal-title">${ability.name}</h4>
				${category ? `<span class="badge badge-secondary ml-2">${category.icon} ${category.name}</span>` : ""}
			</div>
			<div class="charsheet__ability-modal-body">
				<div class="charsheet__ability-modal-description">
					${Renderer.get().render(ability.description || "No description.")}
				</div>
				${effectsSummary}
				${defenseSummary}
				${uses ? `<div class="mt-2"><strong>Uses:</strong> ${uses.current}/${uses.max} (${uses.recharge} rest)</div>` : ""}
			</div>
		`;

		// Create and show modal
		const modal = e_({outer: `
			<div class="modal-overlay charsheet__ability-detail-modal">
				<div class="modal-content charsheet__ability-detail-content">
					<div class="modal-header">
						<button class="modal-close" title="Close">&times;</button>
					</div>
					<div class="modal-body">
						${modalContent}
					</div>
					<div class="modal-footer">
						<button class="ve-btn ve-btn-primary charsheet__ability-modal-use" 
							${!this._state.canUseCustomAbility?.(ability.id) ? "disabled" : ""}>Use Ability</button>
						<button class="ve-btn ve-btn-default charsheet__ability-modal-close">Close</button>
					</div>
				</div>
			</div>
		`});

		modal.querySelectorAll(".modal-close, .charsheet__ability-modal-close").forEach(el => {
			el.addEventListener("click", () => {
				modal.remove();
			});
		});

		modal.querySelector(".charsheet__ability-modal-use").addEventListener("click", () => {
			this._useCustomAbility(ability);
			modal.remove();
		});

		// Close on background click
		modal.addEventListener("click", (/** @type {*} */ e) => {
			if (e.target.classList.contains("modal-overlay")) {
				modal.remove();
			}
		});

		document.body.append(modal);
	}

	/**
	 * Create a combat action element for a feature
	 */
	_createCombatActionElement (feature) {
		const featureId = `${feature.name}-${feature.source || ""}`.replace(/\s+/g, "-").toLowerCase();
		const hasUses = feature.uses && feature.uses.max > 0;
		const actionTypeKey = this._getFeatureActionType(feature);
		const actionIsAvailable = this._isActionTypeAvailable(actionTypeKey);
		const usesAvailable = !hasUses || feature.uses.current > 0;
		const canUse = usesAvailable && actionIsAvailable;

		// Determine action type icon
		const desc = feature.description?.toLowerCase() || "";
		let actionIcon = "⚔️";
		let actionType = "Action";
		if (/bonus action/i.test(desc)) {
			actionIcon = "⚡";
			actionType = "Bonus Action";
		} else if (/reaction/i.test(desc)) {
			actionIcon = "🔄";
			actionType = "Reaction";
		} else if (/no action required|free/i.test(desc)) {
			actionIcon = "✨";
			actionType = "Free";
		}

		// Get feature type badge
		const typeBadge = feature.featureType
			? `<span class="badge badge-${this._getFeatureTypeBadgeClass(feature.featureType)} mr-1 ve-small">${feature.featureType}</span>` : "";

		// Build uses display if applicable
		let usesHtml = "";
		if (hasUses) {
			const rechargeIcon = feature.uses.recharge === "short" ? "☀️"
				: (feature.uses.recharge === "long" ? "🌙" : "");
			usesHtml = `
				<div class="charsheet__combat-action-uses">
					<span class="charsheet__combat-action-uses-label">${feature.uses.current}/${feature.uses.max}</span>
					<span class="charsheet__combat-action-uses-recharge" title="${feature.uses.recharge} rest">${rechargeIcon}</span>
				</div>
			`;
		}

		// Get hover link if possible - try multiple approaches
		let nameHtml = feature.name;
		let hasHoverLink = false;

		if (this._page?.getHoverLink && feature.source) {
			try {
				// Try to get hover link based on feature type
				if (feature.optionalFeatureTypes?.length) {
					const isCM = CharacterSheetClassUtils.isCombatMethod(feature);
					nameHtml = this._page.getHoverLink(isCM ? UrlUtil.PG_COMBAT_METHODS : UrlUtil.PG_OPT_FEATURES, feature.name, feature.source);
					hasHoverLink = true;
				} else if (feature.featureType === "Class" && feature.className) {
					// Class features - use proper page and hash
					const storedClass = this._state.getClasses()?.find(c => c.name?.toLowerCase() === feature.className?.toLowerCase());
					const classSource = feature.classSource || feature.source || storedClass?.source || Parser.SRC_XPHB;

					const hashInput = {
						name: feature.name,
						className: feature.className,
						classSource: classSource,
						level: feature.level || 1,
						source: feature.source || Parser.SRC_XPHB,
					};
					if (feature.subclassName || feature.isSubclassFeature) {
						hashInput.subclassShortName = feature.subclassShortName || feature.subclassName;
						hashInput.subclassSource = feature.subclassSource || storedClass?.subclass?.source || feature.source || Parser.SRC_XPHB;
					}
					const hash = UrlUtil.URL_TO_HASH_BUILDER[UrlUtil.PG_CLASS_SUBCLASS_FEATURES](hashInput);
					nameHtml = this._page.getHoverLink(UrlUtil.PG_CLASS_SUBCLASS_FEATURES, feature.name, feature.source, hash);
					hasHoverLink = true;
				}
			} catch {
				// Fallback to plain name
			}
		}

		// If no hover link, show description in a tooltip on click
		const tooltipDesc = this._cleanDescriptionForTooltip(feature.description);

		const action = e_({outer: `
			<div class="charsheet__combat-action-item charsheet__combat-action-clickable" 
				data-action-id="${featureId}">
				<div class="charsheet__combat-action-header">
					<span class="charsheet__combat-action-icon" title="${actionType}">${actionIcon}</span>
					<span class="charsheet__combat-action-name">${nameHtml}</span>
					${typeBadge}
				</div>
				<div class="charsheet__combat-action-info">
					<span class="badge badge-outline-secondary ve-small mr-1">${actionIcon} ${actionType}</span>
					${usesHtml}
					<button class="ve-btn ve-btn-xs ve-btn-primary charsheet__combat-action-use" data-action-id="${featureId}" title="${canUse ? "Use this ability" : `No ${actionType} available`}" ${canUse ? "" : "disabled"}>Use</button>
				</div>
			</div>
		`});

		// Click on card opens the detail modal
		action.addEventListener("click", (/** @type {*} */ e) => {
			if (e.target.classList.contains("charsheet__combat-action-use")) return;
			this._showCombatActionModal(feature);
		});

		// Add click handler for use button
		action.querySelector(".charsheet__combat-action-use").addEventListener("click", (/** @type {*} */ e) => {
			e.stopPropagation();
			this._useCombatAction(feature);
		});

		return action;
	}

	/**
	 * Get badge class for feature type
	 */
	_getFeatureTypeBadgeClass (featureType) {
		switch (featureType) {
			case "Species":
			case "Subrace":
				return "info";
			case "Class":
				return "primary";
			case "Background":
				return "secondary";
			default:
				return "light";
		}
	}

	/**
	 * Use a combat action (spend a use if applicable, deduct ki/focus/stamina)
	 */
	async _useCombatAction (feature) {
		try {
			const actionType = this._getFeatureActionType(feature);
			if (!this._isActionTypeAvailable(actionType)) {
				const actionName = actionType === "bonus" ? "Bonus Action" : actionType === "reaction" ? "Reaction" : "Action";
				JqueryUtil.doToast({type: "warning", content: `${actionName} already used this round.`});
				return;
			}

			if (feature.uses && feature.uses.current <= 0) {
				JqueryUtil.doToast({type: "warning", content: `No uses remaining for ${feature.name}!`});
				return;
			}

			// Check and deduct ki/focus cost from description
			const calc = this._state.getFeatureCalculations?.() || {};
			const nameLower = feature.name?.toLowerCase() || "";

			// Hand of Healing/Harm manage their own focus cost inside their handlers
			const selfManagedCost = nameLower === "hand of healing" || nameLower === "hand of harm";

			const kiCost = selfManagedCost ? 0 : this._parseResourceCost(feature, "ki");
			const focusCost = selfManagedCost ? 0 : this._parseResourceCost(feature, "focus");
			const staminaCost = selfManagedCost ? 0 : this._parseResourceCost(feature, "stamina");
			let resourceCost = kiCost || focusCost || staminaCost;

			// Unhindered Flurry (TGTT level 8+): Flurry of Blows costs 0 focus
			if (nameLower === "flurry of blows" && calc.hasUnhinderedFlurry) {
				resourceCost = 0;
			}

			if (resourceCost > 0) {
				if (kiCost > 0 || focusCost > 0) {
					const amount = kiCost || focusCost;
					if (!this._state.useKiPoint(amount)) {
						const pointName = focusCost > 0 ? "focus" : "ki";
						JqueryUtil.doToast({type: "warning", content: `Not enough ${pointName} points for ${feature.name}!`});
						return;
					}
				} else if (staminaCost > 0) {
					if (this._state.canUseFocusForStamina?.()) {
						if (!this._state.useFocusForStamina(staminaCost)) {
							JqueryUtil.doToast({type: "warning", content: `Not enough focus/stamina for ${feature.name}!`});
							return;
						}
					} else {
						JqueryUtil.doToast({type: "warning", content: `No stamina resource available for ${feature.name}!`});
						return;
					}
				}
			}

			// Spend a use if this feature has uses
			if (feature.uses) {
				feature.uses.current--;
			}

			this._consumeActionType(actionType);

			// Update state
			const features = this._state.getFeatures();
			const idx = features.findIndex(f => f.name === feature.name && f.source === feature.source);
			if (idx >= 0 && feature.uses) {
				features[idx].uses = feature.uses;
			}

			// Apply combat action effects (conditions, temp HP, state activation)
			const effects = feature.combatActionEffects;
			if (effects) {
				this._applyCombatActionEffects(feature, effects);
			}

			// Monk: Patient Defense — activate toggle state (disadvantage on attacks, advantage on DEX saves)
			if (nameLower === "patient defense") {
				this._state.activateState("patientDefense");
				this._page._renderActiveStates?.();
			}

			// Monk: Flurry of Blows — roll unarmed strike attacks
			// Await so Hand of Harm prompt completes before re-render/toast
			if (nameLower === "flurry of blows") {
				const flurryOk = await this._executeFlurryOfBlows(feature, calc);
				if (flurryOk === false) {
					// User cancelled the choice modal — refund resources
					if (resourceCost > 0) this._state.setKiPointsCurrent(this._state.getKiPointsCurrent() + resourceCost);
					if (feature.uses) feature.uses.current++;
					if (this._state.isInCombat?.() && actionType && this._turnActionUsage) {
						this._turnActionUsage[actionType] = false;
					}
					this.renderCombatActions();
					this.renderCombatResources();
					this._page._renderResources?.();
					return;
				}
			}

			// Monk: Step of the Wind — activate speed-doubling state
			if (nameLower === "step of the wind") {
				this._state.activateState("stepOfTheWind");
				this._page._renderActiveStates?.();
				this._page._renderCombatStats?.();
			}

			// Monk: Hand of Healing — handler manages its own focus cost
			if (nameLower === "hand of healing") {
				await this._executeHandOfHealing(calc);
			}

			// Monk: Hand of Harm — handler manages its own focus cost
			if (nameLower === "hand of harm") {
				this._executeHandOfHarm(calc);
			}

			// C11: Whirlpool Strike — show multi-target workflow
			if (nameLower === "whirlpool strike") {
				await this._showWhirlpoolStrikeModal(feature);
			}

			// Re-render
			this.renderCombatActions();
			this.renderCombatResources();
			this._page._renderFeatures?.();
			this._page._renderResources?.();
			this._page._saveCurrentCharacter?.();

			// Toast notification
			const remaining = feature.uses?.current;
			const remainingText = feature.uses ? ` (${remaining}/${feature.uses.max} remaining)` : "";
			const costText = resourceCost > 0
				? ` (${resourceCost} ${kiCost ? "ki" : focusCost ? "focus" : "stamina"} spent)`
				: "";
			JqueryUtil.doToast({
				type: "success",
				content: `Used ${feature.name}!${remainingText}${costText}`,
			});
		} catch (ex) {
			// eslint-disable-next-line no-console
			console.error(`[CharSheet] Error using combat action "${feature?.name}":`, ex);
			JqueryUtil.doToast({type: "danger", content: `Error using ${feature?.name}: ${ex.message}`});
		}
	}

	// region Combat Action Effects Pipeline

	/**
	 * Apply combat action effects after resource deduction.
	 * Processes conditions, temp HP, state activation, and dice rolls.
	 * @param {object} feature - The feature being used
	 * @param {object} effects - The combatActionEffects object
	 */
	_applyCombatActionEffects (feature, effects) {
		if (!effects) return;

		// Apply condition (e.g., Instant Step → invisible)
		if (effects.applyCondition) {
			const cond = effects.applyCondition;
			const added = this._state.addCondition?.({
				name: cond.name,
				source: feature.name,
			});
			if (added) {
				const durationText = cond.duration ? ` (${cond.duration})` : "";
				JqueryUtil.doToast({
					type: "info",
					content: `${feature.name}: Applied ${cond.name}${durationText}`,
				});
			}
		}

		// Activate a toggle state (e.g., a stance)
		if (effects.activateState) {
			this._page._activateState?.(effects.activateState);
		}

		// Grant temporary HP
		if (effects.grantTempHp) {
			const tempHp = this._resolveTempHp(effects.grantTempHp, feature);
			if (tempHp > 0) {
				const currentTemp = this._state.getTempHp?.() || 0;
				// Temp HP doesn't stack — use the higher value
				if (tempHp > currentTemp) {
					this._state.setTempHp?.(tempHp);
					JqueryUtil.doToast({
						type: "info",
						content: `${feature.name}: Gained ${tempHp} temporary HP`,
					});
				}
			}
		}

		// Remove a condition
		if (effects.removeCondition) {
			const removed = this._state.removeCondition?.(effects.removeCondition);
			if (removed) {
				JqueryUtil.doToast({
					type: "info",
					content: `${feature.name}: Removed ${effects.removeCondition}`,
				});
			}
		}

		// Roll dice (damage, healing, etc.)
		if (effects.rollDice) {
			this._rollCombatActionDice(feature, effects.rollDice);
		}
	}

	/**
	 * Resolve a temp HP formula to a concrete number.
	 * Supports static numbers and simple formulas like "1d8+WIS".
	 * @param {object} config - {formula: string} or {value: number}
	 * @param {object} feature - The source feature (for context)
	 * @returns {number} Resolved temp HP value
	 */
	_resolveTempHp (config, feature) {
		if (typeof config.value === "number") return config.value;
		if (!config.formula) return 0;

		// Parse dice formula: NdX+MOD
		const diceMatch = config.formula.match(/(\d+)d(\d+)(?:\s*\+\s*(\w+))?/i);
		if (diceMatch) {
			const numDice = parseInt(diceMatch[1]);
			const dieSize = parseInt(diceMatch[2]);
			const modStr = diceMatch[3];
			let roll = 0;
			for (let i = 0; i < numDice; i++) {
				roll += (typeof RollerUtil !== "undefined" ? RollerUtil.randomise(dieSize) : Math.ceil(Math.random() * dieSize));
			}
			let mod = 0;
			if (modStr) {
				const abilityMod = this._state.getAbilityMod?.(modStr.toLowerCase());
				mod = typeof abilityMod === "number" ? abilityMod : (parseInt(modStr) || 0);
			}
			return roll + mod;
		}

		// Static number
		const num = parseInt(config.formula);
		return isNaN(num) ? 0 : num;
	}

	/**
	 * Roll dice for a combat action and display the result.
	 * Supports attack rolls (d20 with bonus), save prompts (DC display), and damage dice.
	 * @param {object} feature - The feature being used
	 * @param {object} diceConfig - Configuration for the roll
	 * @param {string} [diceConfig.type] - "attack", "save", "damage", "healing"
	 * @param {string} [diceConfig.formula] - Dice formula (e.g., "2d6+3")
	 * @param {string} [diceConfig.label] - Display label for the roll
	 * @param {number} [diceConfig.dc] - DC for save-type rolls
	 * @param {string} [diceConfig.saveAbility] - Ability for save-type rolls
	 * @param {number} [diceConfig.attackBonus] - Bonus for attack-type rolls
	 * @param {"advantage"|"disadvantage"|"normal"} [diceConfig.mode] - Roll mode
	 */
	_rollCombatActionDice (feature, diceConfig) {
		if (!diceConfig) return;

		const type = diceConfig.type || "damage";

		if (type === "attack") {
			const bonus = diceConfig.attackBonus || 0;
			const mode = diceConfig.mode || "normal";
			const result = this._page.rollD20?.({mode}) || {roll: 10, roll1: 10, roll2: 10, mode};
			const total = result.roll + bonus;
			const bonusStr = bonus >= 0 ? `+${bonus}` : `${bonus}`;
			const modeNote = mode !== "normal" ? ` (${mode})` : "";
			this._page._showDiceResult?.(
				`${feature.name} — Attack Roll`,
				total,
				`d20(${result.roll}) ${bonusStr}${modeNote}`,
				result.roll === 20 ? "charsheet__dice-crit" : result.roll === 1 ? "charsheet__dice-fumble" : "",
			);
			return {type: "attack", total, roll: result.roll, isNat20: result.roll === 20, isNat1: result.roll === 1};
		}

		if (type === "save") {
			const dc = diceConfig.dc || 10;
			const ability = diceConfig.saveAbility || "con";
			const abilityName = ability.charAt(0).toUpperCase() + ability.slice(1).toUpperCase();
			this._page._showDiceResult?.(
				`${feature.name} — Save Required`,
				`DC ${dc}`,
				`${abilityName} saving throw`,
			);
			return {type: "save", dc, saveAbility: ability};
		}

		if (type === "damage" || type === "healing") {
			const formula = diceConfig.formula;
			if (!formula) return null;
			const result = this._parseDamage(formula);
			const label = diceConfig.label || (type === "healing" ? "Healing" : "Damage");
			this._page._showDiceResult?.(
				`${feature.name} — ${label}`,
				result.total,
				`${formula} = [${result.rolls.join(", ")}]`,
			);
			return {type, total: result.total, rolls: result.rolls};
		}

		return null;
	}

	/**
	 * Show a choice modal for combat actions with multiple sub-options.
	 * Used for abilities like Flurry of Healing/Harm where the user picks a variant.
	 * @param {object} feature - The parent feature
	 * @param {Array<{name: string, description?: string, effects?: object, id?: string}>} choices - Available sub-actions
	 * @param {Function} [onChoice] - Callback receiving the chosen option
	 * @returns {Promise<object|null>} The chosen option, or null if cancelled
	 */
	async _showCombatActionChoiceModal (feature, choices, onChoice) {
		if (!choices?.length) return null;

		const {eleModalInner: modalInner, doClose, pGetResolved} = await UiUtil.pGetShowModal({
			title: `${feature.name} — Choose`,
			isMinHeight0: true,
			zIndex: 10003,
			isUncappedHeight: true,
		});

		let resolved = null;

		for (const choice of choices) {
			const btn = e_({outer: `<button class="ve-btn ve-btn-default w-100 mb-2 text-left p-2">
				<div class="bold">${choice.name}</div>
				${choice.description ? `<div class="ve-muted ve-small mt-1">${choice.description}</div>` : ""}
			</button>`});

			btn.addEventListener("click", () => {
				resolved = choice;
				if (onChoice) onChoice(choice);
				doClose(true);
			});

			modalInner.append(btn);
		}

		// Cancel button
		const cancelBtn = e_({outer: `<button class="ve-btn ve-btn-default w-100 mt-2 ve-muted">Cancel</button>`});
		cancelBtn.addEventListener("click", () => doClose(false));
		modalInner.append(cancelBtn);

		await pGetResolved();
		return resolved;
	}

	// endregion

	// region Feature-Specific Modal Flows (Phase C)

	/**
	 * Execute Flurry of Blows: roll unarmed strike attacks.
	 * 2 strikes normally, 3 with Heightened Focus (level 10+).
	 * If the monk has Flurry of Healing and Harm, shows a choice modal
	 * to replace one strike with Hand of Healing or Hand of Harm.
	 * If Hand of Harm is available, prompts after hits.
	 */
	async _executeFlurryOfBlows (feature, calc) {
		const unarmedStrike = this._state.getUnarmedStrike?.();
		if (!unarmedStrike) return;

		let strikes = calc.heightenedFlurryAttacks || 2;

		// Mercy Monk: unified choice modal before rolling
		// Level 3+: Hand of Healing replaces 1 strike (free); Hand of Harm adds necrotic (1 focus)
		// Level 11+: Hand of Healing can replace ALL strikes (free); Both option available
		let useHarm = false;
		let healingStrikes = 0; // number of strikes replaced by Hand of Healing
		const inCombat = this._state.isInCombat?.();
		const canHarm = calc.hasHandOfHarm && !(inCombat && this._handOfHarmUsedThisTurn);
		const canHeal = calc.hasHandOfHealing;
		const canHealAll = calc.hasFlurryOfHealingAndHarm; // level 11+

		if (canHeal || canHarm) {
			const harmFormula = calc.handOfHarmDamage || "?";
			const healFormula = calc.handOfHealingAmount || "?";
			const choices = [];
			if (canHealAll && canHarm) {
				choices.push({name: "Both", key: "both", description: `Healing (${healFormula} HP, free) + Harm (${harmFormula} necrotic, 1 Focus)`});
			}
			if (canHarm) {
				choices.push({name: "Hand of Harm", key: "harm", description: `Add ${harmFormula} necrotic to one strike (1 Focus Point)`});
			}
			if (canHealAll) {
				choices.push({name: "All Healing", key: "healall", description: `Replace all ${strikes} strikes with ${healFormula} HP healing each (free)`});
			}
			if (canHeal) {
				choices.push({name: "Hand of Healing", key: "healing", description: `Replace one strike with ${healFormula} HP healing (free)`});
			}
			choices.push({name: "Normal Strikes", key: "skip", description: `${strikes} unarmed strikes only`});

			const chosen = await this._showCombatActionChoiceModal(feature, choices, () => {});
			if (!chosen) return false; // Cancel — abort Flurry entirely
			const key = chosen.key;
			useHarm = key === "harm" || key === "both";
			if (key === "healall") {
				healingStrikes = strikes;
			} else if (key === "healing" || key === "both") {
				healingStrikes = 1;
			}
		}

		// Handle Hand of Harm: deduct focus, calculate bonus damage
		let handOfHarmDamage = 0;
		if (useHarm) {
			if (!this._state.useKiPoint(1)) {
				JqueryUtil.doToast({type: "warning", content: "Not enough focus points for Hand of Harm!"});
				useHarm = false;
			} else {
				const harmRoll = this._parseDamage(calc.handOfHarmDamage);
				handOfHarmDamage = harmRoll.total;
				this._handOfHarmUsedThisTurn = true;
				if (calc.hasPhysiciansTouch) {
					JqueryUtil.doToast({type: "info", content: "Physician's Touch: target is also poisoned until end of your next turn"});
				}
				this.renderCombatResources();
				this._page._renderResources?.();
			}
		}

		// Handle Hand of Healing: replace strikes with healing rolls (suppress individual dice results)
		const healResults = [];
		for (let h = 0; h < healingStrikes; h++) {
			strikes--;
			const result = await this._executeHandOfHealing(calc, {free: true, showResult: false});
			if (result) healResults.push(result);
		}

		// If all strikes were replaced by healing, show consolidated healing display
		if (strikes <= 0) {
			if (healResults.length) {
				const healLines = healResults.map((r, i) => {
					const label = r.isSelf ? "Self" : "Other";
					return `<div style="margin:3px 0"><strong style="color:#28a745">Heal ${i + 1} (${label}):</strong> [${r.rolls.join(", ")}]${r.modifier ? ` + ${r.modifier}` : ""} = <strong style="color:#28a745">${r.total} HP</strong>${r.conditionNote}</div>`;
				});
				const totalHealing = healResults.reduce((sum, r) => sum + r.total, 0);
				this._page._showDiceResult?.(
					"Flurry of Blows — Healing",
					`${totalHealing} total HP`,
					healLines.join(""),
					"", "", {duration: 12000},
				);
			}
			return true;
		}

		// Resolve attack parameters once
		const abilityMod = this._resolveAbilityMod(unarmedStrike.abilityMod || "str");
		const profBonus = this._state.getProficiencyBonus();
		const attackModifiers = this._state.getNamedModifiersByType("attack");
		const featureAttackBonus = attackModifiers.reduce((sum, mod) => sum + (mod.value || 0), 0);
		const stateAttackBonus = this._state.getBonusFromStates?.("attack") || 0;
		const totalBonus = abilityMod + profBonus + (unarmedStrike.attackBonus || 0) + featureAttackBonus + stateAttackBonus;

		// Resolve damage parameters once
		const damageModifiers = this._state.getNamedModifiersByType("damage");
		const featureDamageBonus = damageModifiers.reduce((sum, mod) => sum + (mod.value || 0), 0);
		const stateDamageBonus = this._state.getBonusFromStates?.("damage") || 0;
		const totalDamageBonus = abilityMod + (unarmedStrike.damageBonus || 0) + featureDamageBonus + stateDamageBonus;

		// Check advantage/disadvantage
		const hasAdvantage = this._state.hasAdvantageFromStates?.("attack:melee:str")
			|| this._state.hasAdvantageFromStates?.("attack");
		const hasDisadvantage = this._state.hasDisadvantageFromStates?.("attack:melee:str")
			|| this._state.hasDisadvantageFromStates?.("attack");
		let rollMode;
		if (hasAdvantage && !hasDisadvantage) rollMode = "advantage";
		else if (hasDisadvantage && !hasAdvantage) rollMode = "disadvantage";

		// Roll all strikes and collect results
		const results = [];
		const critRange = this._state.getCriticalRange?.() || 20;
		let handOfHarmApplied = false;
		const dmgType = unarmedStrike.damageType || "bludgeoning";
		for (let i = 0; i < strikes; i++) {
			const rollResult = this._page.rollD20?.({mode: rollMode}) || {roll: 10, mode: "normal"};
			const attackTotal = rollResult.roll + totalBonus;
			const isCrit = rollResult.roll >= critRange;
			const isFumble = rollResult.roll === 1;

			// Roll damage
			const damageRoll = this._parseDamage(unarmedStrike.damage || "1d6", isCrit);
			const baseDamage = damageRoll.total + totalDamageBonus;

			// Apply Hand of Harm to the first non-fumble strike
			let harmOnThisStrike = 0;
			if (handOfHarmDamage > 0 && !handOfHarmApplied && !isFumble) {
				harmOnThisStrike = handOfHarmDamage;
				handOfHarmApplied = true;
			}

			results.push({roll: rollResult.roll, attackTotal, isCrit, isFumble, baseDamage, harmDamage: harmOnThisStrike, damageRolls: damageRoll.rolls});
		}

		// Build consolidated display with separated damage types
		const stateEffectLabel = this._getStateEffectLabel?.(hasAdvantage, hasDisadvantage) || "";
		const modeLabel = this._page.getModeLabel?.(rollMode || "normal") || "";
		const attackBonusStr = totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`;

		const strikeLines = results.map((r, i) => {
			const num = i + 1;
			if (r.isFumble) {
				return `<div style="margin:3px 0"><strong>Strike ${num}:</strong> <span style="color:#dc3545">💀 Miss! (nat 1)</span></div>`;
			}
			const totalStrikeDmg = r.baseDamage + r.harmDamage;
			const harmNote = r.harmDamage ? ` + <strong style="color:#9b59b6">${r.harmDamage} necrotic</strong> = <strong>${totalStrikeDmg}</strong>` : "";
			if (r.isCrit) {
				const critDice = `[${r.damageRolls.join(", ")}]`;
				return `<div style="margin:3px 0"><strong>Strike ${num}:</strong> <span style="color:#e5c100">⚡ CRIT! ${r.attackTotal} to hit</span> — <strong style="color:#e5c100">${r.baseDamage}</strong> ${dmgType}${harmNote} <span style="opacity:0.7">(${critDice} double dice)</span></div>`;
			}
			return `<div style="margin:3px 0"><strong>Strike ${num}:</strong> ${r.attackTotal} to hit — <strong>${r.baseDamage}</strong> ${dmgType}${harmNote}</div>`;
		});

		const totalBaseDamage = results.reduce((sum, r) => sum + r.baseDamage, 0);
		const totalHarmDamage = results.reduce((sum, r) => sum + r.harmDamage, 0);
		const grandTotal = totalBaseDamage + totalHarmDamage;

		// Add healing lines if any strikes were replaced
		const healLines = healResults.map((r, i) => {
			const label = r.isSelf ? "Self" : "Other";
			return `<div style="margin:3px 0"><strong style="color:#28a745">Heal (${label}):</strong> [${r.rolls.join(", ")}]${r.modifier ? ` + ${r.modifier}` : ""} = <strong style="color:#28a745">${r.total} HP</strong>${r.conditionNote}</div>`;
		});

		const totalLine = totalHarmDamage
			? `${totalBaseDamage} ${dmgType} + ${totalHarmDamage} necrotic = ${grandTotal} total`
			: `${grandTotal} total damage`;
		const formulaLine = `<div style="margin-bottom:4px;opacity:0.7"><em>Attack ${attackBonusStr} to hit, ${unarmedStrike.damage}${totalDamageBonus >= 0 ? "+" : ""}${totalDamageBonus} damage per strike</em></div>`;
		const breakdown = formulaLine + strikeLines.join("") + healLines.join("");

		this._page._showDiceResult?.(
			`Flurry of Blows${modeLabel}${stateEffectLabel}`,
			totalLine,
			breakdown,
			"", "", {duration: 12000},
		);

		return true;
	}

	/**
	 * Show an interactive confirmation modal prompting to use Hand of Harm.
	 * Deducts 1 focus point on accept, marks used this turn.
	 * @returns {boolean} True if the user accepted and focus was deducted.
	 */
	/**
	 * Check if any weapon-modifier combat methods are configured for this weapon
	 * and prompt the user to activate one during the damage roll.
	 * Spends stamina on acceptance and creates the effect.
	 * @param {object} attack - The attack being rolled
	 * @returns {Promise<*>} The activated effect, or null
	 */
	async _promptUseCombatMethod (attack) {
		const methods = this._state.getCombatMethods?.() || [];
		const matchingMethods = methods.filter(m => {
			if (m.methodCategory !== "weaponModifier") return false;
			const remembered = this._state.getCombatMethodWeapon(m.name);
			return remembered?.weaponId === attack.id;
		});

		if (!matchingMethods.length) return null;

		for (const method of matchingMethods) {
			const cost = this._getMethodStaminaCost(method);
			const currentStamina = this._state.getStaminaCurrent();
			const dmgDesc = method.ongoingDamage || "effect";
			const saveDesc = method.ongoingSaveType
				? ` (${method.ongoingSaveType.charAt(0).toUpperCase() + method.ongoingSaveType.slice(1)} save to end)`
				: "";

			const canPayWithKi = this._state.canUseFocusForStamina?.() && (this._state.getKiPointsCurrent?.() ?? 0) >= cost;
			if (currentStamina < cost && !canPayWithKi) continue;

			const costLabel = currentStamina >= cost ? `${cost} EP` : `${cost} ki/focus`;
			const choices = [
				{name: "Yes", description: `Use ${method.name}: ${dmgDesc}${saveDesc} (costs ${costLabel})`},
				{name: "No", description: `Attack normally`},
			];

			const chosen = await this._showCombatActionChoiceModal({name: `⚔️ ${method.name}`}, choices);
			if (!chosen || chosen.name !== "Yes") continue;

			// Spend stamina (or ki)
			if (currentStamina >= cost) {
				this._state.setStaminaCurrent(currentStamina - cost);
			} else if (canPayWithKi) {
				if (!this._state.useFocusForStamina(cost)) continue;
			}
			this._updateStaminaDisplay();
			if (this._page?._features) this._page._features._renderResources();

			const calcs = this._state.getFeatureCalculations?.() || {};
			const saveDc = calcs.combatMethodDc || 10;

			const effect = {
				name: method.name,
				weaponId: attack.id,
				weaponName: attack.name,
				ongoingDamage: method.ongoingDamage || null,
				ongoingSaveType: method.ongoingSaveType || method.saveType || null,
				saveDc,
				alternativeEndCheck: method.alternativeEndCheck || null,
				description: method.entries ? JSON.stringify(method.entries) : "",
			};

			this._state.activateCombatMethodEffect(effect);
			this.renderCombatEffects();
			this._page._saveCurrentCharacter?.();

			JqueryUtil.doToast({type: "success", content: `${method.name} applied to ${attack.name}!`});
			return effect;
		}

		return null;
	}

	/**
	 * Prompt player to apply an active combat method effect (e.g. Wounding Strike) during a damage roll.
	 */
	async _promptApplyMethodEffect (effect) {
		const dmgDesc = effect.ongoingDamage ? `${effect.ongoingDamage} ongoing damage` : "effect";
		const saveDesc = effect.ongoingSaveType
			? ` (${effect.ongoingSaveType.charAt(0).toUpperCase() + effect.ongoingSaveType.slice(1)} save DC ${effect.saveDc} to end)`
			: "";

		const choices = [
			{name: "Yes", description: `Apply ${effect.name}: ${dmgDesc}${saveDesc}`},
			{name: "No", description: `Skip ${effect.name} this time`},
		];

		const fakeFeature = {name: effect.name};
		const chosen = await this._showCombatActionChoiceModal(fakeFeature, choices, () => {});
		return chosen?.name === "Yes";
	}

	async _promptHandOfHarm (calc) {
		const formula = calc.handOfHarmDamage;
		if (!formula) return false;

		const choices = [
			{name: "Yes", description: `Spend 1 Focus Point to deal ${formula} necrotic damage`},
			{name: "No", description: "Skip Hand of Harm this time"},
		];

		const fakeFeature = {name: "Hand of Harm"};
		const chosen = await this._showCombatActionChoiceModal(fakeFeature, choices, () => {});
		if (!chosen || chosen.name !== "Yes") return false;

		// Deduct focus point
		if (!this._state.useKiPoint(1)) {
			JqueryUtil.doToast({type: "warning", content: "Not enough focus points for Hand of Harm!"});
			return false;
		}

		this._handOfHarmUsedThisTurn = true;

		// Physician's Touch condition note
		if (calc.hasPhysiciansTouch) {
			JqueryUtil.doToast({type: "info", content: "Physician's Touch: target is also poisoned until end of your next turn"});
		}

		this.renderCombatResources();
		this._page._renderResources?.();
		this._page._saveCurrentCharacter?.();
		return true;
	}

	/**
	 * Execute Hand of Healing: roll healing dice and optionally apply to self.
	 * Shows Self/Other choice. Self applies heal; Other shows roll only.
	 * @param {object} calc - Feature calculations from getFeatureCalculations()
	 * @param {*} [opts] - Options: {free?: boolean, showResult?: boolean}
	 */
	async _executeHandOfHealing (calc, opts = {}) {
		const {free = false, showResult = true} = opts;
		const formula = calc.handOfHealingAmount;
		if (!formula) return null;

		// Show Self/Other choice
		const choices = [
			{name: "Self", description: "Heal yourself"},
			{name: "Another Creature", description: "Heal a creature you touch (roll only)"},
		];

		let chosen = null;
		const fakeFeature = {name: "Hand of Healing"};
		chosen = await this._showCombatActionChoiceModal(fakeFeature, choices, () => {});
		if (!chosen) return null;

		// Deduct focus point if not free
		if (!free) {
			if (!this._state.useKiPoint(1)) {
				JqueryUtil.doToast({type: "warning", content: "Not enough focus points for Hand of Healing!"});
				return null;
			}
			this.renderCombatResources();
			this._page._renderResources?.();
		}

		// Roll healing
		const healRoll = this._parseDamage(formula);
		const total = healRoll.total;

		// Physician's Touch condition note
		let conditionNote = "";
		if (calc.hasPhysiciansTouch && calc.physiciansTouchConditions?.length) {
			conditionNote = `<div style="margin-top:4px;opacity:0.85">✨ Physician's Touch: also end one of <strong>${calc.physiciansTouchConditions.join(", ")}</strong></div>`;
		}

		const isSelf = chosen.name === "Self";
		if (isSelf) {
			this._state.heal(total);
			this._page._renderHp?.();
			this._page._renderCombatStats?.();
		}

		if (showResult) {
			if (isSelf) {
				this._page._showDiceResult?.(
					"Hand of Healing (Self)",
					`+${total} HP`,
					`[${healRoll.rolls.join(", ")}]${healRoll.modifier ? ` + ${healRoll.modifier}` : ""} = ${total} HP restored${conditionNote}`,
				);
			} else {
				this._page._showDiceResult?.(
					"Hand of Healing",
					`${total} HP`,
					`[${healRoll.rolls.join(", ")}]${healRoll.modifier ? ` + ${healRoll.modifier}` : ""} = heal ${total} HP${conditionNote}`,
				);
			}
		}

		this._page._saveCurrentCharacter?.();
		return {total, rolls: healRoll.rolls, modifier: healRoll.modifier, isSelf, conditionNote};
	}

	/**
	 * Execute Hand of Harm: roll necrotic damage dice.
	 * @param {object} calc - Feature calculations from getFeatureCalculations()
	 * @param {object} [opts]
	 * @param {boolean} [opts.free=false] - If true, skip focus point cost (e.g. from Flurry)
	 */
	_executeHandOfHarm (calc, {free = false} = {}) {
		const formula = calc.handOfHarmDamage;
		if (!formula) return;

		// Deduct focus point if not free
		if (!free) {
			if (!this._state.useKiPoint(1)) {
				JqueryUtil.doToast({type: "warning", content: "Not enough focus points for Hand of Harm!"});
				return;
			}
			this.renderCombatResources();
			this._page._renderResources?.();
		}

		// Roll necrotic damage
		const damageRoll = this._parseDamage(formula);
		const total = damageRoll.total;

		// Mark used this turn
		this._handOfHarmUsedThisTurn = true;

		// Physician's Touch condition note
		let conditionNote = "";
		if (calc.hasPhysiciansTouch && calc.physiciansTouchConditions?.length) {
			conditionNote = `<div style="margin-top:4px;opacity:0.85">✨ Physician's Touch: also inflict <strong>poisoned</strong> until end of your next turn</div>`;
		}

		this._page._showDiceResult?.(
			"Hand of Harm",
			`${total} necrotic`,
			`[${damageRoll.rolls.join(", ")}]${damageRoll.modifier ? ` + ${damageRoll.modifier}` : ""} = ${total} necrotic damage${conditionNote}`,
		);

		this._page._saveCurrentCharacter?.();
	}

	/**
	 * C6: Show choice modal for Flurry of Healing and Harm.
	 * When using Flurry of Blows at level 11+, one unarmed strike can be
	 * replaced with Hand of Healing or Hand of Harm.
	 */
	async _showFlurryChoiceModal (feature, calc) {
		const martialArtsDie = calc.martialArtsDie || "1d6";
		const wisMod = this._state.getAbilityMod?.("wis") || 0;

		const choices = [
			{
				name: "Hand of Healing",
				description: `Restore ${martialArtsDie}+${wisMod} HP to a creature you touch`,
			},
			{
				name: "Hand of Harm",
				description: `Deal ${martialArtsDie}+${wisMod} necrotic damage (on unarmed hit)`,
			},
		];

		// Use onChoice as a no-op; handle the async work AFTER the modal resolves
		const chosen = await this._showCombatActionChoiceModal(feature, choices, () => {});

		if (chosen) {
			if (chosen.name === "Hand of Healing") {
				// Flurry healing: show Self/Other choice then roll
				await this._executeHandOfHealing(calc, {free: true});
			} else if (chosen.name === "Hand of Harm") {
				// Flurry harm: rolls directly (sync)
				this._executeHandOfHarm(calc, {free: true});
			}

			JqueryUtil.doToast({
				type: "info",
				content: `${feature.name}: Chose ${chosen.name}`,
			});
		}
	}

	/**
	 * C11: Show multi-target workflow modal for Whirlpool Strike.
	 * Lets user choose number of targets, pick an attack, roll each,
	 * and calculates escalating bonus damage per subsequent hit.
	 */
	async _showWhirlpoolStrikeModal (feature) {
		const {eleModalInner: modalInner, doClose, pGetResolved} = await UiUtil.pGetShowModal({
			title: `${feature.name} — Multi-Target Attack`,
			isMinHeight0: true,
			zIndex: 10003,
			isUncappedHeight: true,
		});

		// Get available melee attacks
		const attacks = (this._state.getAttacks?.() || []).filter(a =>
			a.isMelee || a.type === "melee" || (a.range && !a.range.includes("/")),
		);

		if (!attacks.length) {
			modalInner.append(e_({outer: `<div class="ve-muted p-2">No melee attacks available</div>`}));
			const closeBtn = e_({outer: `<button class="ve-btn ve-btn-default w-100 mt-2">Close</button>`});
			closeBtn.addEventListener("click", () => doClose(false));
			modalInner.append(closeBtn);
			await pGetResolved();
			return;
		}

		// Step 1: Choose number of creatures
		modalInner.append(e_({outer: `<div class="mb-2 ve-small"><strong>How many creatures?</strong> (each in reach)</div>`}));
		const numInput = e_({outer: `<input type="number" class="ve-form-control ve-input-sm mb-3" min="1" max="10" value="2" style="width: 80px;">`});
		modalInner.append(numInput);

		// Step 2: Choose weapon
		modalInner.append(e_({outer: `<div class="mb-2 ve-small"><strong>Choose weapon attack:</strong></div>`}));
		const select = e_({tag: "select", clazz: "ve-form-control ve-input-sm mb-3"});
		for (const atk of attacks) {
			select.append(e_({outer: `<option value="${atk.id}">${atk.name} (+${atk.attackBonus || 0})</option>`}));
		}
		modalInner.append(select);

		// Step 3: Roll button and results
		const resultArea = e_({tag: "div", clazz: "charsheet__whirlpool-results"});
		modalInner.append(resultArea);

		const rollBtn = e_({outer: `<button class="ve-btn ve-btn-sm ve-btn-primary mb-2">🎲 Roll Attacks</button>`});
		rollBtn.addEventListener("click", () => {
			const numTargets = Math.max(1, Math.min(10, parseInt(numInput.value) || 2));
			const selectedAtkId = select.value;
			const selectedAtk = attacks.find(a => String(a.id) === String(selectedAtkId)) || attacks[0];
			const bonus = selectedAtk.attackBonus || 0;

			resultArea.innerHTML = "";
			const rows = [];
			for (let i = 0; i < numTargets; i++) {
				const result = this._page.rollD20?.({mode: "normal"}) || {roll: 10};
				const total = result.roll + bonus;
				const bonusDamage = i > 0 ? `+${i}d6` : "—";
				const critClass = result.roll === 20 ? "text-success bold" : result.roll === 1 ? "text-danger bold" : "";
				rows.push(`<tr>
					<td>${i + 1}</td>
					<td class="${critClass}">${result.roll}</td>
					<td>${total}</td>
					<td>${bonusDamage}</td>
				</tr>`);
			}
			resultArea.innerHTML = `
				<table class="w-100 ve-small mb-2" style="border-collapse: collapse;">
					<thead><tr>
						<th class="p-1 border-bottom">Target</th>
						<th class="p-1 border-bottom">Roll</th>
						<th class="p-1 border-bottom">Total</th>
						<th class="p-1 border-bottom">Bonus Dmg</th>
					</tr></thead>
					<tbody>${rows.join("")}</tbody>
				</table>
				<div class="ve-muted ve-small">Bonus damage: 2nd target +1d6, 3rd +2d6, etc.</div>
			`;
		});
		modalInner.append(rollBtn);

		const closeBtn = e_({outer: `<button class="ve-btn ve-btn-default w-100 mt-2">Close</button>`});
		closeBtn.addEventListener("click", () => doClose(false));
		modalInner.append(closeBtn);

		await pGetResolved();
	}

	// endregion

	/**
	 * Parse a resource cost (ki/focus/stamina) from a feature's description.
	 * @param {object} feature - Feature object
	 * @param {"ki"|"focus"|"stamina"} resourceType - Resource type to parse
	 * @returns {number} Cost amount, or 0 if not found
	 */
	_parseResourceCost (feature, resourceType) {
		const desc = (feature?.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").toLowerCase();
		const patterns = {
			ki: /(\d+)\s*ki\s*point/i,
			focus: /(\d+)\s*focus\s*point/i,
			stamina: /(\d+)\s*stamina\s*point/i,
		};
		const match = desc.match(patterns[resourceType]);
		return match ? parseInt(match[1]) : 0;
	}

	/**
	 * Show a detail modal for a combat action feature.
	 * Shows full description, action type, resource cost, effects preview,
	 * interactive dice rolls, and a Use button.
	 */
	async _showCombatActionModal (feature) {
		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: feature.name,
			isMinHeight0: true,
			zIndex: 10002,
			isUncappedHeight: true,
		});

		// Action type
		const actionType = this._getFeatureActionType(feature);
		let actionLabel = "Action";
		let actionIcon = "⚔️";
		if (actionType === "bonus") { actionLabel = "Bonus Action"; actionIcon = "⚡"; } else if (actionType === "reaction") { actionLabel = "Reaction"; actionIcon = "🔄"; } else if (actionType === "free") { actionLabel = "Free"; actionIcon = "✨"; }

		// Feature type badge
		const featureTypeBadge = feature.featureType
			? `<span class="badge badge-${this._getFeatureTypeBadgeClass(feature.featureType)} ml-2">${feature.featureType}</span>`
			: "";

		modalInner.append(e_({outer: `
			<div class="ve-flex-v-center mb-2">
				<span class="mr-1">${actionIcon}</span>
				<span class="badge badge-outline-secondary">${actionLabel}</span>
				${featureTypeBadge}
			</div>
		`}));

		// Resource cost line
		const kiCost = this._parseResourceCost(feature, "ki");
		const focusCost = this._parseResourceCost(feature, "focus");
		const staminaCost = this._parseResourceCost(feature, "stamina");
		const costParts = [];
		if (kiCost) costParts.push(`${kiCost} Ki Point${kiCost > 1 ? "s" : ""}`);
		if (focusCost) costParts.push(`${focusCost} Focus Point${focusCost > 1 ? "s" : ""}`);
		if (staminaCost) costParts.push(`${staminaCost} Stamina`);

		if (costParts.length) {
			const kiCurrent = this._state.getKiPointsCurrent?.() ?? 0;
			const kiMax = this._state.getKiPoints?.() ?? 0;
			modalInner.append(e_({outer: `
				<div class="mb-2 ve-muted ve-small">
					<strong>Cost:</strong> ${costParts.join(", ")}
					${(kiCost || focusCost) && kiMax > 0 ? ` <span class="ml-1">(${kiCurrent}/${kiMax} remaining)</span>` : ""}
				</div>
			`}));
		}

		// Uses line
		if (feature.uses && feature.uses.max > 0) {
			const rechargeIcon = feature.uses.recharge === "short" ? "☀️" : "🌙";
			modalInner.append(e_({outer: `
				<div class="mb-2 ve-muted ve-small">
					<strong>Uses:</strong> ${feature.uses.current}/${feature.uses.max}
					<span title="${feature.uses.recharge} rest">${rechargeIcon}</span>
				</div>
			`}));
		}

		// Description
		if (feature.description) {
			modalInner.append(e_({outer: `<div class="rd__b mb-3">${Renderer.get().render(feature.description)}</div>`}));
		} else if (feature.entries) {
			try {
				modalInner.append(e_({outer: `<div class="rd__b mb-3">${Renderer.get().render({type: "entries", entries: feature.entries})}</div>`}));
			} catch { /* fall through */ }
		}

		// Feature-specific content (strike counts, choice hints, range, etc.)
		const featureContent = this._getFeatureSpecificContent(feature);
		if (featureContent) modalInner.append(featureContent);

		// Effects preview section
		const effects = feature.combatActionEffects;
		if (effects) {
			const effectsSection = this._renderEffectsPreview(effects, feature);
			if (effectsSection) modalInner.append(effectsSection);
		}

		// Roll section (interactive dice)
		if (effects?.rollDice) {
			const rollSection = this._renderModalRollSection(effects.rollDice, feature);
			modalInner.append(rollSection);
		}

		// Use + Close buttons
		const canUse = this._isActionTypeAvailable(actionType)
			&& (!feature.uses || feature.uses.current > 0);

		const btnBar = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-primary mr-2 charsheet__action-modal-use" ${!canUse ? "disabled" : ""}>Use</button>
			<button class="ve-btn ve-btn-default charsheet__action-modal-close">Close</button>
		</div>`;
		modalInner.append(btnBar);
		btnBar.querySelector(".charsheet__action-modal-use")?.addEventListener("click", async () => {
			doClose(false);
			try {
				await this._useCombatAction(feature);
			} catch (ex) {
				// eslint-disable-next-line no-console
				console.error(`[CharSheet] Error using combat action from modal:`, ex);
			}
		});
		btnBar.querySelector(".charsheet__action-modal-close")?.addEventListener("click", () => doClose(false));
	}

	/**
	 * Render an effects preview section for the combat action modal.
	 * Shows what will happen when the action is used: conditions, temp HP, dice, etc.
	 * @param {object} effects - The combatActionEffects object
	 * @param {object} feature - The source feature
	 * @returns {*} The effects preview element, or null if nothing to show
	 */
	_renderEffectsPreview (effects, feature) {
		const lines = [];

		if (effects.applyCondition) {
			const cond = effects.applyCondition;
			const target = cond.self ? "Self" : "Target";
			const duration = cond.duration ? ` (${cond.duration})` : "";
			lines.push(`<span class="mr-1">🎯</span> <strong>Applies:</strong> ${cond.name}${duration} <span class="ve-muted">[${target}]</span>`);
		}

		if (effects.grantTempHp) {
			const hp = effects.grantTempHp;
			const amount = hp.value != null ? `${hp.value}` : hp.formula || "?";
			lines.push(`<span class="mr-1">💛</span> <strong>Grants:</strong> ${amount} Temporary HP`);
		}

		if (effects.removeCondition) {
			lines.push(`<span class="mr-1">✅</span> <strong>Removes:</strong> ${effects.removeCondition}`);
		}

		if (effects.activateState) {
			lines.push(`<span class="mr-1">⚡</span> <strong>Activates:</strong> ${effects.activateState}`);
		}

		if (effects.rollDice) {
			const dice = effects.rollDice;
			if (dice.type === "damage" && dice.formula) {
				lines.push(`<span class="mr-1">🗡️</span> <strong>Damage:</strong> ${dice.formula}${dice.label ? ` ${dice.label}` : ""}`);
			} else if (dice.type === "healing" && dice.formula) {
				lines.push(`<span class="mr-1">💚</span> <strong>Healing:</strong> ${dice.formula}`);
			}
		}

		if (effects.multiTarget) {
			lines.push(`<span class="mr-1">👥</span> <strong>Multi-target</strong>`);
		}

		if (!lines.length) return null;

		return e_({outer: `
			<div class="charsheet__action-modal-effects mb-3 p-2 ve-small" style="background: var(--bg-faint, #f8f9fa); border-radius: 4px; border-left: 3px solid var(--color-primary, #4a90d9);">
				<div class="bold mb-1 ve-muted">Effects on Use</div>
				${lines.map(l => `<div class="mb-1">${l}</div>`).join("")}
			</div>
		`});
	}

	/**
	 * Render an interactive dice roll section for the combat action modal.
	 * Shows attack roll, save DC, and damage/healing buttons with advantage indicator.
	 * @param {object} diceConfig - The rollDice portion of combatActionEffects
	 * @param {object} feature - The source feature
	 * @returns {*} The roll section element
	 */
	_renderModalRollSection (diceConfig, feature) {
		const section = e_({outer: `<div class="charsheet__action-modal-rolls mb-3 p-2" style="background: var(--bg-faint, #f8f9fa); border-radius: 4px;"></div>`});
		section.append(e_({outer: `<div class="bold mb-2">🎲 Dice</div>`}));

		// Determine advantage/disadvantage from active states
		const hasAdvantage = this._state.hasAdvantageFromStates?.("attack") || false;
		const hasDisadvantage = this._state.hasDisadvantageFromStates?.("attack") || false;
		let rollMode = "normal";
		if (hasAdvantage && !hasDisadvantage) rollMode = "advantage";
		else if (hasDisadvantage && !hasAdvantage) rollMode = "disadvantage";

		// Advantage/disadvantage indicator
		if (rollMode !== "normal") {
			const modeIcon = rollMode === "advantage" ? "🟢" : "🔴";
			const modeLabel = rollMode === "advantage" ? "Advantage" : "Disadvantage";
			section.append(e_({outer: `
				<div class="mb-2 ve-small">
					<span class="mr-1">${modeIcon}</span>
					<strong>${modeLabel}</strong> <span class="ve-muted">(from active states)</span>
				</div>
			`}));
		}

		const type = diceConfig.type || "damage";

		if (type === "attack") {
			const bonus = diceConfig.attackBonus || 0;
			const bonusStr = bonus >= 0 ? `+${bonus}` : `${bonus}`;
			const resultArea = e_({tag: "div", clazz: "charsheet__action-modal-roll-result mt-1"});

			const atkBtn = e_({outer: `<button class="ve-btn ve-btn-sm ve-btn-primary mr-2">🎯 Roll Attack (d20${bonusStr})</button>`});
			atkBtn.addEventListener("click", () => {
				const result = this._rollCombatActionDice(feature, {...diceConfig, mode: rollMode});
				if (result) {
					const critClass = result.isNat20 ? "bold text-success" : result.isNat1 ? "bold text-danger" : "";
					const critLabel = result.isNat20 ? " — Critical Hit!" : result.isNat1 ? " — Critical Miss!" : "";
					resultArea.innerHTML = `<span class="${critClass}">${result.total}${critLabel}</span>`;
				}
			});

			const row = e_({tag: "div", clazz: "ve-flex-v-center"});
			row.append(atkBtn, resultArea);
			section.append(row);
		}

		if (type === "save") {
			const dc = diceConfig.dc || 10;
			const ability = diceConfig.saveAbility || "con";
			const abilityLabel = ability.charAt(0).toUpperCase() + ability.slice(1).toUpperCase();
			section.append(e_({outer: `
				<div class="charsheet__action-modal-save-prompt p-2 mb-1" style="border: 1px solid var(--color-warning, #f0ad4e); border-radius: 4px; background: var(--bg-warning-faint, #fff8e1);">
					<strong>DC ${dc} ${abilityLabel}</strong> saving throw
				</div>
			`}));
		}

		if ((type === "damage" || type === "healing") && diceConfig.formula) {
			const label = diceConfig.label || (type === "healing" ? "Healing" : "Damage");
			const icon = type === "healing" ? "💚" : "🗡️";
			const resultArea = e_({tag: "div", clazz: "charsheet__action-modal-roll-result mt-1"});

			const dmgBtn = e_({outer: `<button class="ve-btn ve-btn-sm ve-btn-default">${icon} Roll ${label} (${diceConfig.formula})</button>`});
			dmgBtn.addEventListener("click", () => {
				const result = this._rollCombatActionDice(feature, diceConfig);
				if (result) {
					resultArea.innerHTML = `<strong>${result.total}</strong> <span class="ve-muted">[${result.rolls.join(", ")}]</span>`;
				}
			});

			const row = e_({tag: "div", clazz: "ve-flex-v-center mt-2"});
			row.append(dmgBtn, resultArea);
			section.append(row);
		}

		// Combined save + damage/healing (common pattern: "DC X save, then Nd6 damage")
		if (type === "save" && diceConfig.formula) {
			const label = diceConfig.label || "Damage";
			const resultArea = e_({tag: "div", clazz: "charsheet__action-modal-roll-result mt-1"});

			const dmgBtn = e_({outer: `<button class="ve-btn ve-btn-sm ve-btn-default mt-1">🗡️ Roll ${label} (${diceConfig.formula})</button>`});
			dmgBtn.addEventListener("click", () => {
				const dmgConfig = {...diceConfig, type: "damage"};
				const result = this._rollCombatActionDice(feature, dmgConfig);
				if (result) {
					resultArea.innerHTML = `<strong>${result.total}</strong> <span class="ve-muted">[${result.rolls.join(", ")}]</span>`;
				}
			});

			const row = e_({tag: "div", clazz: "ve-flex-v-center mt-1"});
			row.append(dmgBtn, resultArea);
			section.append(row);
		}

		return section;
	}

	/**
	 * Get combat-classified features from FEATURE_CLASSIFICATION_OVERRIDES.
	 * Returns features whose classification is "combat" or "reaction".
	 * Used by both the combat tab and overview tab.
	 */
	getCombatClassifiedFeatures () {
		const features = this._state.getFeatures();
		const overrides = CharacterSheetState.FEATURE_CLASSIFICATION_OVERRIDES || {};
		return features.filter(f => {
			const nameLower = f.name?.toLowerCase() || "";
			const cls = overrides[nameLower];
			return cls === "combat" || cls === "reaction";
		});
	}

	/**
	 * Generate feature-specific contextual UI for the combat action modal.
	 * Returns element with additional guidance, strike counts, choice hints, etc.
	 * Uses getFeatureCalculations() to pull data-driven values.
	 * @param {object} feature - The combat action feature
	 * @returns {HTMLElement|null} Feature-specific content element, or null
	 */
	_getFeatureSpecificContent (feature) {
		const nameLower = feature.name?.toLowerCase() || "";
		const calc = this._state.getFeatureCalculations?.() || {};
		const lines = [];

		// --- C1: Flurry of Blows ---
		if (nameLower === "flurry of blows") {
			const strikes = calc.heightenedFlurryAttacks || 2;
			lines.push(`<span class="mr-1">👊</span> Make <strong>${strikes} unarmed strike${strikes > 1 ? "s" : ""}</strong> as a bonus action`);
			if (calc.hasHeightenedFocus && strikes === 3) {
				lines.push(`<span class="mr-1">✨</span> <span class="ve-muted">Heightened Focus: 3rd strike added</span>`);
			}
			if (calc.hasFlurryOfHealingAndHarm) {
				lines.push(`<span class="mr-1">🔄</span> You may replace one strike with <strong>Hand of Healing</strong> or <strong>Hand of Harm</strong>`);
			}
		}

		// --- C2: Patient Defense ---
		if (nameLower === "patient defense") {
			lines.push(`<span class="mr-1">🧘</span> Take the <strong>Dodge</strong> action as a <strong>bonus action</strong>`);
			if (calc.hasHeightenedFocus) {
				lines.push(`<span class="mr-1">✨</span> <span class="ve-muted">Heightened Focus: also take the <strong>Disengage</strong> action</span>`);
			}
		}

		// --- C3: Step of the Wind ---
		if (nameLower === "step of the wind") {
			lines.push(`<span class="mr-1">💨</span> <strong>Dash</strong> or <strong>Disengage</strong> as a bonus action`);
			lines.push(`<span class="mr-1">🦘</span> Jump distance <strong>doubled</strong> for this turn`);
			if (calc.hasHeightenedFocus) {
				const dist = calc.heightenedStepOfTheWindDistance || 20;
				lines.push(`<span class="mr-1">✨</span> <span class="ve-muted">Heightened Focus: Move one creature within 5 ft up to ${dist} ft</span>`);
			}
		}

		// --- C7: Instant Step ---
		if (nameLower === "instant step") {
			const range = calc.instantStepRange || 60;
			const cost = calc.instantStepCost || 4;
			lines.push(`<span class="mr-1">⚡</span> Teleport up to <strong>${range} ft</strong> to an unoccupied space you can see`);
			lines.push(`<span class="mr-1">👻</span> <strong>Invisible</strong> until the start of your next turn`);
			lines.push(`<span class="mr-1">💎</span> Cost: <strong>${cost} stamina</strong>`);
		}

		// --- C8: Religious Training ---
		if (nameLower === "religious training") {
			lines.push(`<span class="mr-1">🙏</span> Spend stamina to gain temporary <strong>divine favor</strong>`);
			lines.push(`<span class="mr-1">💎</span> Variable cost: choose stamina amount on use`);
		}

		// --- C10: Wind Strike ---
		if (nameLower === "wind strike") {
			lines.push(`<span class="mr-1">🏹</span> Ranged weapon attack, <strong>20/60 ft</strong>`);
			lines.push(`<span class="mr-1">🟢</span> Roll with <strong>advantage</strong>`);
			lines.push(`<span class="mr-1">🎯</span> If both dice hit: add <strong>extra weapon damage die</strong>`);
		}

		// --- C11: Whirlpool Strike ---
		if (nameLower === "whirlpool strike") {
			lines.push(`<span class="mr-1">🌊</span> Attack <strong>multiple creatures</strong> in reach`);
			lines.push(`<span class="mr-1">🗡️</span> Choose a melee weapon attack to use`);
			lines.push(`<span class="mr-1">📈</span> Each subsequent hit: <strong>+1d6 bonus damage</strong>`);
		}

		// --- C4: Wall Walk (combat action aspect) ---
		if (nameLower === "wall walk") {
			lines.push(`<span class="mr-1">🕷️</span> Cast <strong>Spider Climb</strong> on self as a bonus action`);
			lines.push(`<span class="mr-1">💎</span> Cost: <strong>1 stamina</strong>`);
			lines.push(`<span class="mr-1">🔮</span> Duration: concentration, up to <strong>10 minutes</strong>`);
		}

		// --- Hand of Healing ---
		if (nameLower === "hand of healing") {
			const formula = calc.handOfHealingAmount || "?";
			lines.push(`<span class="mr-1">💚</span> Heal <strong>${formula}</strong> HP to a creature you touch`);
			lines.push(`<span class="mr-1">🎯</span> Choose <strong>Self</strong> (apply) or <strong>Other</strong> (roll only)`);
			if (calc.hasPhysiciansTouch) {
				lines.push(`<span class="mr-1">✨</span> <span class="ve-muted">Physician's Touch: also end one condition (${calc.physiciansTouchConditions?.join(", ")})</span>`);
			}
		}

		// --- Hand of Harm ---
		if (nameLower === "hand of harm") {
			const formula = calc.handOfHarmDamage || "?";
			lines.push(`<span class="mr-1">💀</span> Deal <strong>${formula}</strong> necrotic damage on unarmed strike hit`);
			lines.push(`<span class="mr-1">⚡</span> Once per turn`);
			if (calc.hasPhysiciansTouch) {
				lines.push(`<span class="mr-1">✨</span> <span class="ve-muted">Physician's Touch: also inflict <strong>poisoned</strong> until end of your next turn</span>`);
			}
		}

		if (!lines.length) return null;

		return e_({outer: `
			<div class="charsheet__action-modal-specific mb-3 p-2 ve-small" style="background: var(--bg-faint, #f8f9fa); border-radius: 4px; border-left: 3px solid var(--color-secondary, #6c757d);">
				${lines.map(l => `<div class="mb-1">${l}</div>`).join("")}
			</div>
		`});
	}

	/**
	 * Clean description text for tooltip display
	 */
	_cleanDescriptionForTooltip (description) {
		if (!description) return "";
		// Remove HTML tags and extra whitespace
		return description
			.replace(/<[^>]+>/g, "")
			.replace(/\s+/g, " ")
			.trim()
			.substring(0, 300) + (description.length > 300 ? "..." : "");
	}

	/**
	 * Render active conditions in combat tab
	 */
	renderCombatConditions () {
		const container = document.getElementById("charsheet-combat-conditions");
		if (!container) return;

		// Now returns {name, source} objects
		const conditions = this._state.getConditions?.() || [];

		if (!conditions.length) {
			container.innerHTML = `<div class="ve-muted ve-text-center py-2">No active conditions</div>`;
			return;
		}

		container.innerHTML = "";

		for (const condObj of conditions) {
			const conditionName = condObj.name;
			const conditionSource = condObj.source;
			const conditionDef = CharacterSheetState.getConditionEffects(conditionName);

			const icon = conditionDef?.icon || "⚠️";
			const description = conditionDef?.description || conditionName;
			const sourceAbbr = Parser.sourceJsonToAbv(conditionSource);

			// Build tooltip with effects
			let tooltip = `${conditionName} (${sourceAbbr}): ${description}`;
			if (conditionDef?.effects?.length) {
				const effectList = conditionDef.effects.map(e => {
					if (e.type === "advantage") return `• Advantage on ${this._formatEffectTarget(e.target)}`;
					if (e.type === "disadvantage") return `• Disadvantage on ${this._formatEffectTarget(e.target)}`;
					if (e.type === "autoFail") return `• Auto-fail ${this._formatEffectTarget(e.target)}`;
					if (e.type === "setSpeed") return `• Speed set to ${e.value}`;
					if (e.type === "resistance") return `• Resistance to ${e.target}`;
					if (e.type === "bonus") return `• ${e.value >= 0 ? "+" : ""}${e.value} to ${this._formatEffectTarget(e.target)}`;
					if (e.type === "note") return `• ${e.value}`;
					return null;
				}).filter(Boolean);
				if (effectList) {
					tooltip += `\n${effectList.join("\n")}`;
				}
			}

			// Create hoverable condition link
			let conditionLink = conditionName;
			try {
				const hash = UrlUtil.encodeForHash([conditionName, conditionSource].join(HASH_LIST_SEP));
				const hoverAttrs = Renderer.hover.getHoverElementAttributes({page: UrlUtil.PG_CONDITIONS_DISEASES, source: conditionSource, hash: hash});
				conditionLink = `<a href="${UrlUtil.PG_CONDITIONS_DISEASES}#${hash}" ${hoverAttrs}>${conditionName}</a>`;
			} catch (e) {
				// Fall back to plain name if hover fails
				conditionLink = conditionName;
			}

			const condition = e_({outer: `
				<div class="charsheet__combat-condition badge badge-warning mr-1 mb-1" 
					title="${tooltip}" data-condition-name="${conditionName}" data-condition-source="${conditionSource}">
					${icon} <span class="charsheet__condition-name-link">${conditionLink}</span>
					<span class="charsheet__condition-source-badge">${sourceAbbr}</span>
					<span class="charsheet__condition-remove ml-1" title="Remove condition">&times;</span>
				</div>
			`});

			condition.querySelector(".charsheet__condition-remove")?.addEventListener("click", (/** @type {*} */ e) => {
				e.stopPropagation();
				// Now passes {name, source} object
				this._state.removeCondition?.({name: conditionName, source: conditionSource});
				this.renderCombatConditions();
				this.renderCombatEffects();
				this.renderCombatDefenses();
				this._page._renderConditions?.();
				this._page._saveCurrentCharacter?.();
				this._page._renderCharacter?.();
			});

			container.append(condition);
		}
	}

	/**
	 * Render defenses (resistances, immunities, vulnerabilities, condition immunities)
	 */
	renderCombatDefenses () {
		// Get base defenses from character state
		const resistances = this._state.getResistances?.() || [];
		const immunities = this._state.getImmunities?.() || [];
		const vulnerabilities = this._state.getVulnerabilities?.() || [];
		const conditionImmunities = this._state.getConditionImmunities?.() || [];

		// Also get defenses from active states (like Rage giving resistance to B/P/S)
		// Strip "damage:" prefix to match base resistance format
		const activeStateEffects = this._state.getActiveStateEffects?.() || [];
		const stateResistances = activeStateEffects
			.filter(e => e.type === "resistance")
			.map(e => (e.target || "").replace(/^damage:/i, ""));
		const stateImmunities = activeStateEffects
			.filter(e => e.type === "immunity")
			.map(e => (e.target || "").replace(/^damage:/i, ""));
		const stateConditionImmunities = activeStateEffects
			.filter(e => e.type === "conditionImmunity")
			.map(e => e.target);

		// Merge and deduplicate
		const allResistances = [...new Set([...resistances, ...stateResistances])];
		const allImmunities = [...new Set([...immunities, ...stateImmunities])];
		const allVulnerabilities = [...new Set([...vulnerabilities])];
		const allConditionImmunities = [...new Set([...conditionImmunities, ...stateConditionImmunities])];

		// Render resistances
		const resistancesEl = document.getElementById("charsheet-resistances");
		if (resistancesEl) {
			if (allResistances) {
				resistancesEl.innerHTML = allResistances.map(r => {
					const isFromState = stateResistances.includes(r) && !resistances.includes(r);
					return `<span class="badge ${isFromState ? "badge-warning" : "badge-success"} mr-1" title="${isFromState ? "From active state" : "Base resistance"}">${this._formatDamageType(r)}</span>`;
				}).join("");
			} else {
				resistancesEl.innerHTML = `<span class="ve-muted">—</span>`;
			}
		}

		// Render immunities (damage)
		const immunitiesEl = document.getElementById("charsheet-immunities");
		if (immunitiesEl) {
			if (allImmunities) {
				immunitiesEl.innerHTML = allImmunities.map(i => {
					const isFromState = stateImmunities.includes(i) && !immunities.includes(i);
					return `<span class="badge ${isFromState ? "badge-warning" : "badge-primary"} mr-1" title="${isFromState ? "From active state" : "Base immunity"}">${this._formatDamageType(i)}</span>`;
				}).join("");
			} else {
				immunitiesEl.innerHTML = `<span class="ve-muted">—</span>`;
			}
		}

		// Render vulnerabilities
		const vulnerabilitiesEl = document.getElementById("charsheet-vulnerabilities");
		if (vulnerabilitiesEl) {
			if (allVulnerabilities) {
				vulnerabilitiesEl.innerHTML = allVulnerabilities.map(v =>
					`<span class="badge badge-danger mr-1">${this._formatDamageType(v)}</span>`,
				).join("");
			} else {
				vulnerabilitiesEl.innerHTML = `<span class="ve-muted">—</span>`;
			}
		}

		// Add condition immunities section if not exists
		let condImmunities = document.getElementById("charsheet-condition-immunities");
		if (!condImmunities && allConditionImmunities.length) {
			// Add condition immunities row dynamically
			const defenses = document.getElementById("charsheet-combat-defenses");
			if (defenses) {
				defenses.insertAdjacentHTML("beforeend", `
					<div class="charsheet__defense-row">
						<span class="charsheet__defense-label">Condition Immunities:</span>
						<span class="charsheet__defense-value" id="charsheet-condition-immunities">—</span>
					</div>
				`);
				condImmunities = document.getElementById("charsheet-condition-immunities");
			}
		}

		if (condImmunities) {
			if (allConditionImmunities) {
				// Get condition sources for hover support
				const conditionsList = this._page?.getConditionsListUnique?.() || this._page?.getConditionsList?.() || [];
				const conditionSourceMap = new Map();
				conditionsList.forEach(c => {
					if (!conditionSourceMap.has(c.name.toLowerCase())) {
						conditionSourceMap.set(c.name.toLowerCase(), c.source);
					}
				});

				condImmunities.innerHTML = allConditionImmunities.map(c => {
					const isFromState = stateConditionImmunities.includes(c) && !conditionImmunities.includes(c);
					const conditionSource = conditionSourceMap.get(c.toLowerCase()) || Parser.SRC_XPHB;
					const displayName = c.charAt(0).toUpperCase() + c.slice(1);

					// Create hoverable link
					let conditionContent = displayName;
					try {
						const hash = UrlUtil.encodeForHash([c, conditionSource].join(HASH_LIST_SEP));
						const hoverAttrs = Renderer.hover.getHoverElementAttributes({
							page: UrlUtil.PG_CONDITIONS_DISEASES,
							source: conditionSource,
							hash: hash,
						});
						conditionContent = `<a href="${UrlUtil.PG_CONDITIONS_DISEASES}#${hash}" ${hoverAttrs} class="charsheet__condition-immune-link">${displayName}</a>`;
					} catch {
						// Fall back to plain name if hover fails
						conditionContent = displayName;
					}

					return `<span class="badge ${isFromState ? "badge-warning" : "badge-info"} mr-1" title="${isFromState ? "From active state" : "Base immunity"}">${conditionContent}</span>`;
				}).join("");
			} else {
				condImmunities.innerHTML = `<span class="ve-muted">—</span>`;
			}
		}
	}

	/**
	 * Format damage type for display
	 */
	_formatDamageType (type) {
		if (!type) return "Unknown";
		// Strip "damage:" prefix if present, then capitalize first letter
		const clean = type.replace(/^damage:/i, "").trim();
		// Handle compound types like "bludgeoning, piercing, and slashing"
		return clean.split(/,\s*/).map(t => t.trim().charAt(0).toUpperCase() + t.trim().slice(1)).join(", ");
	}

	/**
	 * Render active combat effects from states, conditions, and features
	 */
	renderCombatEffects () {
		const container = document.getElementById("charsheet-combat-effects");
		if (!container) return;

		const effects = [];

		// Get all active state effects
		const stateEffects = this._state.getActiveStateEffects?.() || [];

		// Get conditions
		const conditions = this._state.getConditions?.() || [];

		// Process advantage/disadvantage effects
		const advantageTypes = new Map(); // rollType -> [sources]
		const disadvantageTypes = new Map();
		const bonusEffects = []; // {target, value, source}
		const otherEffects = []; // misc effects like speed changes

		// Separate effects: "attacksAgainst" means attacks AGAINST you (enemies' rolls)
		// Regular advantage/disadvantage applies to YOUR rolls
		const enemyAdvantageAgainst = new Map(); // Enemies have advantage attacking you
		const enemyDisadvantageAgainst = new Map(); // Enemies have disadvantage attacking you

		for (const effect of stateEffects) {
			const source = effect.stateName || "Active State";

			switch (effect.type) {
				case "advantage":
					// Check if this is "attacks against" (enemy's advantage) vs your own advantage
					if (effect.target?.includes("Against")) {
						if (!enemyAdvantageAgainst.has(effect.target)) enemyAdvantageAgainst.set(effect.target, []);
						enemyAdvantageAgainst.get(effect.target).push(source);
					} else {
						if (!advantageTypes.has(effect.target)) advantageTypes.set(effect.target, []);
						advantageTypes.get(effect.target).push(source);
					}
					break;
				case "disadvantage":
					// Check if this is "attacks against" (enemy's disadvantage) vs your own disadvantage
					if (effect.target?.includes("Against")) {
						if (!enemyDisadvantageAgainst.has(effect.target)) enemyDisadvantageAgainst.set(effect.target, []);
						enemyDisadvantageAgainst.get(effect.target).push(source);
					} else {
						if (!disadvantageTypes.has(effect.target)) disadvantageTypes.set(effect.target, []);
						disadvantageTypes.get(effect.target).push(source);
					}
					break;
				case "bonus":
					if (effect.value) {
						bonusEffects.push({
							target: effect.target,
							value: effect.value,
							source: source,
						});
					}
					break;
				case "speed":
					if (effect.value !== undefined) {
						otherEffects.push({
							icon: "🏃",
							text: `Speed ${effect.value >= 0 ? "+" : ""}${effect.value} ft`,
							source: source,
							type: "speed",
						});
					}
					break;
				case "ac":
					if (effect.value) {
						bonusEffects.push({
							target: "AC",
							value: effect.value,
							source: source,
						});
					}
					break;
				case "attackRoll":
					if (effect.value) {
						bonusEffects.push({
							target: "Attack Rolls",
							value: effect.value,
							source: source,
						});
					}
					break;
				case "damageRoll":
					if (effect.value) {
						bonusEffects.push({
							target: "Damage",
							value: effect.value,
							source: source,
						});
					}
					break;
				case "autoFail":
					otherEffects.push({
						icon: "❌",
						text: `Auto-fail ${this._formatEffectTarget(effect.target)}`,
						source: source,
						type: "negative",
					});
					break;
				case "incapacitated":
					otherEffects.push({
						icon: "💫",
						text: "Incapacitated (can't take actions/reactions)",
						source: source,
						type: "negative",
					});
					break;
				case "speedZero":
					otherEffects.push({
						icon: "🚫",
						text: "Speed is 0",
						source: source,
						type: "negative",
					});
					break;
			}
		}

		// Build HTML
		container.innerHTML = "";

		// Advantage section
		if (advantageTypes.size > 0) {
			const advSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			advSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-success mb-1">⬆️ Advantage On:</div>`);
			for (const [target, sources] of advantageTypes) {
				advSection.insertAdjacentHTML("beforeend", `
					<div class="charsheet__effect-item badge badge-success mr-1 mb-1" title="From: ${sources.join(", ")}">
						${this._formatEffectTarget(target)}
					</div>
				`);
			}
			container.append(advSection);
		}

		// Disadvantage section
		if (disadvantageTypes.size > 0) {
			const disadvSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			disadvSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-danger mb-1">⬇️ Disadvantage On:</div>`);
			for (const [target, sources] of disadvantageTypes) {
				disadvSection.insertAdjacentHTML("beforeend", `
					<div class="charsheet__effect-item badge badge-danger mr-1 mb-1" title="From: ${sources.join(", ")}">
						${this._formatEffectTarget(target)}
					</div>
				`);
			}
			container.append(disadvSection);
		}

		// Bonus section
		if (bonusEffects.length > 0) {
			const bonusSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			bonusSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-primary mb-1">📊 Bonuses:</div>`);
			for (const bonus of bonusEffects) {
				const sign = bonus.value >= 0 ? "+" : "";
				bonusSection.insertAdjacentHTML("beforeend", `
					<div class="charsheet__effect-item badge badge-primary mr-1 mb-1" title="From: ${bonus.source}">
						${bonus.target} ${sign}${bonus.value}
					</div>
				`);
			}
			container.append(bonusSection);
		}

		// Other effects (negative effects, speed changes, etc.)
		if (otherEffects.length > 0) {
			const otherSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			otherSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-warning mb-1">⚠️ Other Effects:</div>`);
			for (const effect of otherEffects) {
				const badgeClass = effect.type === "negative" ? "badge-danger" : (effect.type === "speed" ? "badge-info" : "badge-secondary");
				otherSection.insertAdjacentHTML("beforeend", `
					<div class="charsheet__effect-item badge ${badgeClass} mr-1 mb-1" title="From: ${effect.source}">
						${effect.icon} ${effect.text}
					</div>
				`);
			}
			container.append(otherSection);
		}

		// Enemy advantage against you (defensive: they have advantage)
		if (enemyAdvantageAgainst.size > 0) {
			const enemyAdvSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			enemyAdvSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-danger mb-1">⚠️ Enemies Have Advantage On:</div>`);
			for (const [target, sources] of enemyAdvantageAgainst) {
				enemyAdvSection.insertAdjacentHTML("beforeend", `
					<div class="charsheet__effect-item badge badge-danger mr-1 mb-1" title="From: ${sources.join(", ")}">
						${this._formatEffectTarget(target)}
					</div>
				`);
			}
			container.append(enemyAdvSection);
		}

		// Enemy disadvantage against you (defensive: they have disadvantage)
		if (enemyDisadvantageAgainst.size > 0) {
			const enemyDisadvSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			enemyDisadvSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-success mb-1">🛡️ Enemies Have Disadvantage On:</div>`);
			for (const [target, sources] of enemyDisadvantageAgainst) {
				enemyDisadvSection.insertAdjacentHTML("beforeend", `
					<div class="charsheet__effect-item badge badge-success mr-1 mb-1" title="From: ${sources.join(", ")}">
						${this._formatEffectTarget(target)}
					</div>
				`);
			}
			container.append(enemyDisadvSection);
		}

		// Critical hit range display
		const critRange = this._state.getCriticalRange?.() || 20;
		if (critRange < 20) {
			const critSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			critSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-warning mb-1">⚔️ Critical Hit Range:</div>`);
			critSection.insertAdjacentHTML("beforeend", `
				<div class="charsheet__effect-item badge badge-warning mr-1 mb-1" title="You score a critical hit on ${critRange}-20">
					${critRange}-20 (${21 - critRange} numbers)
				</div>
			`);
			container.append(critSection);
		}

		// Temp HP display with source
		const tempHp = this._state.getTempHp?.() || 0;
		const tempHpSource = this._state._data?.tempHpSource;
		if (tempHp > 0 && tempHpSource) {
			const tempHpSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			tempHpSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-info mb-1">💙 Temporary HP:</div>`);
			tempHpSection.insertAdjacentHTML("beforeend", `
				<div class="charsheet__effect-item badge badge-info mr-1 mb-1" title="From: ${tempHpSource}">
					${tempHp} THP (${tempHpSource})
				</div>
			`);
			container.append(tempHpSection);
		}

		// Conditional modifiers section (show available conditional bonuses)
		const conditionalAttack = this._state.getConditionalModifiersByType?.("attack") || [];
		const conditionalDamage = this._state.getConditionalModifiersByType?.("damage") || [];
		const allConditionals = [...conditionalAttack, ...conditionalDamage];
		if (allConditionals.length > 0) {
			const conditionalSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			conditionalSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-secondary mb-1">📝 Conditional Bonuses:</div>`);
			for (const mod of allConditionals) {
				const condText = this._state.formatConditionalText?.(mod) || mod.conditional;
				const sign = mod.value >= 0 ? "+" : "";
				const typeLabel = mod.type === "attack" ? "atk" : "dmg";
				conditionalSection.insertAdjacentHTML("beforeend", `
					<div class="charsheet__effect-item badge badge-secondary mr-1 mb-1" title="From: ${mod.name}">
						${sign}${mod.value} ${typeLabel} (${condText})
					</div>
				`);
			}
			container.append(conditionalSection);
		}

		// Item-granted defenses display (resistances, immunities, etc. from magic items)
		const itemDefenses = this._state.getItemDefenses?.() || {};
		const hasItemDefenses = (itemDefenses.resist?.length > 0) || (itemDefenses.immune?.length > 0) || (itemDefenses.vulnerable?.length > 0) || (itemDefenses.conditionImmune?.length > 0);
		if (hasItemDefenses) {
			const defSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			defSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold text-info mb-1">🛡️ Magic Item Defenses:</div>`);

			if (itemDefenses.resist?.length) {
				for (const d of itemDefenses.resist) {
					defSection.insertAdjacentHTML("beforeend", `
						<div class="charsheet__effect-item badge badge-info mr-1 mb-1" title="From: ${d.source}">
							Resist ${d.type.toTitleCase()} (${d.source})
						</div>
					`);
				}
			}
			if (itemDefenses.immune?.length) {
				for (const d of itemDefenses.immune) {
					defSection.insertAdjacentHTML("beforeend", `
						<div class="charsheet__effect-item badge badge-success mr-1 mb-1" title="From: ${d.source}">
							Immune ${d.type.toTitleCase()} (${d.source})
						</div>
					`);
				}
			}
			if (itemDefenses.vulnerable?.length) {
				for (const d of itemDefenses.vulnerable) {
					defSection.insertAdjacentHTML("beforeend", `
						<div class="charsheet__effect-item badge badge-danger mr-1 mb-1" title="From: ${d.source}">
							Vulnerable ${d.type.toTitleCase()} (${d.source})
						</div>
					`);
				}
			}
			if (itemDefenses.conditionImmune?.length) {
				for (const d of itemDefenses.conditionImmune) {
					defSection.insertAdjacentHTML("beforeend", `
						<div class="charsheet__effect-item badge badge-warning mr-1 mb-1" title="From: ${d.source}">
							Immune to ${d.type.toTitleCase()} (${d.source})
						</div>
					`);
				}
			}

			container.append(defSection);
		}

		// Active combat method effects (Wounding Strike, etc.)
		const methodEffects = this._state.getActiveCombatMethodEffects?.() || [];
		if (methodEffects.length > 0) {
			const methodSection = e_({outer: `<div class="charsheet__effect-group mb-2"></div>`});
			methodSection.insertAdjacentHTML("beforeend", `<div class="ve-small ve-bold mb-1" style="color: #c44;">🩸 Active Method Effects:</div>`);

			for (const effect of methodEffects) {
				const card = e_({outer: `
					<div class="charsheet__method-effect-card p-2 mb-1" style="border: 1px solid #c44; border-radius: 6px; background: rgba(204,68,68,0.08);">
						<div class="ve-flex ve-flex-v-center ve-flex-h-space-between mb-1">
							<span style="font-weight: bold;">⚔️ ${effect.name} → ${effect.weaponName || "weapon"}</span>
							<button class="ve-btn ve-btn-xs ve-btn-danger charsheet__method-effect-end" data-effect-id="${effect.id}" title="End this effect">✕</button>
						</div>
						<div class="ve-small ve-muted mb-1">
							${effect.ongoingDamage ? `${effect.ongoingDamage} ongoing damage` : ""}${effect.ongoingSaveType ? ` · ${effect.ongoingSaveType.charAt(0).toUpperCase() + effect.ongoingSaveType.slice(1)} save DC ${effect.saveDc} to end` : ""}${effect.alternativeEndCheck ? ` · or ${effect.alternativeEndCheck.charAt(0).toUpperCase() + effect.alternativeEndCheck.slice(1)} check DC ${effect.saveDc}` : ""}
						</div>
						<div class="ve-flex gap-1">
							${effect.ongoingDamage ? `<button class="ve-btn ve-btn-xs ve-btn-danger charsheet__method-effect-roll-damage" data-dice="${effect.ongoingDamage}" data-name="${effect.name}">🎲 Roll ${effect.ongoingDamage}</button>` : ""}
						</div>
					</div>
				`});

				// End effect button handler
				card.querySelector(".charsheet__method-effect-end")?.addEventListener("click", () => {
					this._state.deactivateCombatMethodEffect(effect.id);
					this.renderCombatEffects();
					this._page._saveCurrentCharacter?.();
					JqueryUtil.doToast({content: `${effect.name} ended.`});
				});

				// Roll ongoing damage button
				card.querySelector(".charsheet__method-effect-roll-damage")?.addEventListener("click", () => {
					const roll = this._parseDamage(effect.ongoingDamage);
					const rollBreakdown = roll.rolls.join(" + ") + (roll.modifier ? ` ${roll.modifier >= 0 ? "+" : ""}${roll.modifier}` : "");
					this._page.showDiceResult({
						title: `${effect.name} — Ongoing Damage (${effect.weaponName || "weapon"})`,
						total: roll.total,
						subtitle: `${effect.ongoingDamage} → [${rollBreakdown}] = ${roll.total}`,
					});
				});

				methodSection.append(card);
			}
			container.append(methodSection);
		}

		// If no effects, show placeholder
		const hasTempHpDisplay = tempHp > 0 && tempHpSource;
		const hasConditionals = allConditionals.length > 0;
		const hasMethodEffects = methodEffects.length > 0;
		const hasAnyEffects = advantageTypes.size > 0 || disadvantageTypes.size > 0 || bonusEffects.length > 0 || otherEffects.length > 0 || enemyAdvantageAgainst.size > 0 || enemyDisadvantageAgainst.size > 0 || critRange < 20 || hasTempHpDisplay || hasConditionals || hasItemDefenses || hasMethodEffects;
		if (!hasAnyEffects) {
			container.innerHTML = `<div class="ve-muted ve-text-center py-2">No active effects</div>`;
		}
	}

	/**
	 * Format effect target for display
	 */
	_formatEffectTarget (target) {
		if (!target) return "Unknown";

		const targetLabels = {
			"attack": "Attack Rolls",
			"attackRoll": "Attack Rolls",
			"attacks": "Attack Rolls",
			"attack:melee": "Melee Attacks",
			"attack:ranged": "Ranged Attacks",
			"save": "Saving Throws",
			"saves": "Saving Throws",
			"savingThrow": "Saving Throws",
			"check": "Ability Checks",
			"checks": "Ability Checks",
			"abilityCheck": "Ability Checks",
			"check:str": "STR Checks",
			"check:dex": "DEX Checks",
			"check:con": "CON Checks",
			"check:int": "INT Checks",
			"check:wis": "WIS Checks",
			"check:cha": "CHA Checks",
			"strCheck": "STR Checks",
			"dexCheck": "DEX Checks",
			"conCheck": "CON Checks",
			"intCheck": "INT Checks",
			"wisCheck": "WIS Checks",
			"chaCheck": "CHA Checks",
			"save:str": "STR Saves",
			"save:dex": "DEX Saves",
			"save:con": "CON Saves",
			"save:int": "INT Saves",
			"save:wis": "WIS Saves",
			"save:cha": "CHA Saves",
			"strSave": "STR Saves",
			"dexSave": "DEX Saves",
			"conSave": "CON Saves",
			"intSave": "INT Saves",
			"wisSave": "WIS Saves",
			"chaSave": "CHA Saves",
			"initiative": "Initiative",
			"concentration": "Concentration",
			"deathSave": "Death Saves",
			// "Attacks against" targets
			"attacksAgainst": "Attacks Against You",
			"meleeAttacksAgainst": "Melee Attacks Against You",
			"rangedAttacksAgainst": "Ranged Attacks Against You",
			// Check-specific targets
			"check:sight": "Checks Requiring Sight",
			"check:hearing": "Checks Requiring Hearing",
		};

		return targetLabels[target] || target.charAt(0).toUpperCase() + target.slice(1);
	}

	/**
	 * Render combat resources (quick access in combat tab)
	 * Shows limited-use features relevant to combat (rage, ki, spell slots, etc.)
	 */
	renderCombatResources () {
		const container = document.getElementById("charsheet-combat-resources");
		if (!container) return;

		const resources = this._state.getResources();
		if (!resources?.length) {
			container.innerHTML = `<div class="ve-muted ve-text-center py-2">No combat resources</div>`;
			this._renderSneakAttackToggle(container);
			return;
		}

		// Filter to combat-relevant resources
		const combatResources = resources.filter(r => {
			const name = r.name.toLowerCase();
			// Include combat-relevant resources
			return name.includes("rage")
				|| name.includes("ki")
				|| name.includes("focus")
				|| name.includes("sorcery")
				|| name.includes("superiority")
				|| name.includes("stamina")
				|| name.includes("channel")
				|| name.includes("wild shape")
				|| name.includes("bardic")
				|| name.includes("action surge")
				|| name.includes("second wind")
				|| name.includes("smite")
				|| name.includes("lay on hands")
				|| name.includes("arcane recovery")
				|| name.includes("sneak attack") // Not a resource but might be tracked
				|| r.recharge; // Any resource with recharge is likely combat-relevant
		});

		if (!combatResources.length) {
			container.innerHTML = `<div class="ve-muted ve-text-center py-2">No combat resources</div>`;
			this._renderSneakAttackToggle(container);
			return;
		}

		container.innerHTML = "";
		for (const resource of combatResources) {
			// Build pips - filled = available, empty = used
			const resourceEl = e_({outer: `
				<div class="charsheet__combat-resource-item mb-2" data-resource-id="${resource.id}">
					<div class="charsheet__combat-resource-name ve-small font-weight-bold">${resource.name}</div>
					<div class="charsheet__combat-resource-pips">
						${Array.from({length: resource.max}, (_, i) => `
							<span class="charsheet__resource-pip ${i < resource.current ? "" : "used"}" data-pip-index="${i}" title="Click to use/restore"></span>
						`).join("")}
					</div>
					<div class="ve-small ve-muted">${resource.current}/${resource.max}${resource.recharge ? ` (${resource.recharge})` : ""}</div>
				</div>
			`});

			// Click on pips to use/restore
			resourceEl.querySelector(".charsheet__resource-pip")?.addEventListener("click", (/** @type {*} */ e) => {
				const pipIndex = e.currentTarget.dataset.pipIndex;
				const isUsed = e.currentTarget.classList.contains("used");
				if (isUsed) {
					// Restore one use (pip was empty/used, now fill it)
					this._state.setResourceCurrent(resource.id, resource.current + 1);
				} else {
					// Use one (pip was filled/available, now empty it)
					this._state.setResourceCurrent(resource.id, resource.current - 1);
				}
				this.renderCombatResources();
				// Also update the main resources display
				this._page._renderResources?.();
				this._page._features?._renderResources?.();
			});

			container.append(resourceEl);
		}

		// Render Sneak Attack toggle if character is a Rogue
		this._renderSneakAttackToggle(container);
	}

	/**
	 * Render Sneak Attack toggle and Cunning Strike options in combat resources
	 */
	_renderSneakAttackToggle (container) {
		if (!container) container = document.getElementById("charsheet-combat-resources");
		if (!container) return;

		// Remove existing sneak attack UI
		container.querySelector(".charsheet__sneak-attack-section")?.remove();

		const calcs = this._state.getFeatureCalculations?.();
		if (!calcs?.sneakAttack) return;

		const sa = calcs.sneakAttack;
		const isSpentThisRound = !this._isSneakAttackAvailableThisTurn();
		if (isSpentThisRound && this._sneakAttackEnabled) this._sneakAttackEnabled = false;

		// Calculate total CS dice cost for display
		const totalCSDiceCost = this._selectedCunningStrikes.reduce((sum, cs) => sum + cs.cost, 0);
		const baseSneakDice = parseInt(sa.dice) || Math.ceil((this._state.getClassLevel?.("Rogue") || 1) / 2);
		const effectiveSneakDice = Math.max(0, baseSneakDice - totalCSDiceCost);

		const section = e_({outer: `<div class="charsheet__sneak-attack-section mt-3" style="border-top: 1px solid var(--rgb-border-grey, #444); padding-top: 0.5rem;"></div>`});

		// ===== HEADER: Dice count as visual anchor =====
		const diceDisplay = totalCSDiceCost > 0
			? `<span style="text-decoration: line-through; opacity: 0.5;">${baseSneakDice}d6</span> ${effectiveSneakDice}d6`
			: `${baseSneakDice}d6`;
		const avgDisplay = Math.floor(effectiveSneakDice * 3.5);

		section.insertAdjacentHTML("beforeend", `
			<div class="ve-flex-v-center mb-1">
				<strong class="mr-2" style="font-size: 1.05em;">Sneak Attack ${diceDisplay}</strong>
				<span class="ve-small ve-muted">(avg ${avgDisplay})</span>
			</div>
		`);

		// ===== TOGGLE: Clear toggle-switch style =====
		const toggleState = isSpentThisRound ? "used" : this._sneakAttackEnabled ? "ready" : "off";
		const toggleColors = {
			ready: "ve-btn-success",
			off: "ve-btn-default",
			used: "ve-btn-danger",
		};
		const toggleLabels = {
			ready: "READY",
			off: "OFF",
			used: "USED",
		};
		const toggleTitle = isSpentThisRound
			? "Sneak Attack already used this round"
			: this._sneakAttackEnabled
				? "Click to disable Sneak Attack for next damage roll"
				: "Click to enable Sneak Attack for next damage roll";

		const toggle = e_({outer: `
			<div class="ve-flex-v-center mb-1">
				<button class="ve-btn ve-btn-xs ${toggleColors[toggleState]} charsheet__sneak-attack-toggle mr-2" title="${toggleTitle}" ${isSpentThisRound ? "disabled" : ""}>
					<span class="glyphicon glyphicon-flash mr-1"></span>${toggleLabels[toggleState]}
				</button>
			</div>
		`});

		toggle.querySelector(".charsheet__sneak-attack-toggle")?.addEventListener("click", () => {
			if (!this._isSneakAttackAvailableThisTurn()) {
				JqueryUtil.doToast({type: "warning", content: "Sneak Attack has already been used this round."});
				return;
			}
			this._sneakAttackEnabled = !this._sneakAttackEnabled;
			// Clear CS selections when disabling SA
			if (!this._sneakAttackEnabled) this._selectedCunningStrikes = [];
			this._renderSneakAttackToggle();
		});

		section.append(toggle);

		// ===== CONDITION INDICATORS: Real-time SA eligibility =====
		const ctx = this._lastAttackContext;
		const hasAdv = ctx?.hasAdvantage && !ctx?.hasDisadvantage;
		const hasDisadv = ctx?.hasDisadvantage && !ctx?.hasAdvantage;
		const allyAdj = this._sneakAttackHasAdjacentAlly;

		const conditions = e_({outer: `<div class="ve-flex-v-center gap-1 mb-2 flex-wrap"></div>`});

		// Advantage indicator
		if (hasAdv) {
			conditions.insertAdjacentHTML("beforeend", `<span class="ve-badge ve-badge--success ve-small" title="Last attack had advantage" style="padding: 1px 6px; border-radius: 3px;">&#x2714; Advantage</span>`);
		} else if (hasDisadv) {
			conditions.insertAdjacentHTML("beforeend", `<span class="ve-badge ve-badge--danger ve-small" title="Last attack had disadvantage — SA blocked" style="padding: 1px 6px; border-radius: 3px;">&#x2718; Disadvantage</span>`);
		} else {
			conditions.insertAdjacentHTML("beforeend", `<span class="ve-badge ve-badge--default ve-small" title="No advantage from last attack" style="padding: 1px 6px; border-radius: 3px; opacity: 0.6;">&#x2014; No Advantage</span>`);
		}

		// Ally adjacent toggle (as inline pill)
		const allyPill = e_({outer: `<button class="ve-btn ve-btn-xxs ${allyAdj ? "ve-btn-info" : "ve-btn-default"} ve-small" title="Toggle: ally within 5ft of target" style="padding: 1px 6px; border-radius: 3px;">${allyAdj ? "&#x2714; Ally within 5ft" : "Ally within 5ft"}</button>`});
		allyPill.addEventListener("click", () => {
			this._sneakAttackHasAdjacentAlly = !this._sneakAttackHasAdjacentAlly;
			this._renderSneakAttackToggle();
		});
		conditions.append(allyPill);

		section.append(conditions);

		// ===== WARNING: SA conditions not met =====
		if (this._sneakAttackEnabled && !isSpentThisRound) {
			const triggerMet = hasAdv || allyAdj;
			if (!triggerMet && !hasDisadv) {
				section.insertAdjacentHTML("beforeend", `<div class="ve-small ve-muted mb-1" style="color: var(--rgb-warning, #f0ad4e);"><span class="glyphicon glyphicon-warning-sign mr-1"></span>No advantage and no ally adjacent — Sneak Attack won't apply</div>`);
			} else if (hasDisadv) {
				section.insertAdjacentHTML("beforeend", `<div class="ve-small ve-muted mb-1" style="color: var(--rgb-danger, #d9534f);"><span class="glyphicon glyphicon-remove mr-1"></span>Disadvantage blocks Sneak Attack</div>`);
			}
		}

		// ===== CUNNING STRIKE: Mechanical integration =====
		if (calcs.hasCunningStrike) {
			const csOptions = this._getCunningStrikeOptions(calcs);
			const saveDC = 8 + this._state.getProficiencyBonus() + this._state.getAbilityMod("dex");

			const cs = e_({outer: `<div class="ve-small mt-1"></div>`});
			cs.insertAdjacentHTML("beforeend", `<div class="ve-flex-v-center mb-1"><strong>Cunning Strike</strong> <span class="ve-muted ml-1">DC ${saveDC}</span></div>`);

			const optList = e_({outer: `<div class="ve-flex gap-1 flex-wrap"></div>`});
			csOptions.forEach(opt => {
				const isSelected = this._selectedCunningStrikes.some(s => s.name === opt.name);
				const canAfford = opt.cost <= effectiveSneakDice + (isSelected ? opt.cost : 0);
				const btnClass = isSelected ? "ve-btn-primary" : canAfford ? "ve-btn-default" : "ve-btn-default";
				const btn = e_({outer: `<button class="ve-btn ve-btn-xxs ${btnClass}" title="${opt.desc} (costs ${opt.cost}d6)" ${!canAfford && !isSelected ? "disabled" : ""} style="${!canAfford && !isSelected ? "opacity: 0.5;" : ""}">${opt.name} <span class="ve-muted">${opt.cost}d6</span></button>`});

				btn.addEventListener("click", () => {
					if (isSelected) {
						this._selectedCunningStrikes = this._selectedCunningStrikes.filter(s => s.name !== opt.name);
					} else {
						if (opt.cost > effectiveSneakDice) {
							JqueryUtil.doToast({type: "warning", content: `Not enough Sneak Attack dice (need ${opt.cost}d6, have ${effectiveSneakDice}d6)`});
							return;
						}
						this._selectedCunningStrikes.push(opt);
					}
					this._renderSneakAttackToggle();
				});
				optList.append(btn);
			});
			cs.append(optList);

			// Show selected CS effects summary
			if (this._selectedCunningStrikes.length) {
				const summary = this._selectedCunningStrikes.map(s => `${s.name} (${s.cost}d6)`).join(", ");
				cs.insertAdjacentHTML("beforeend", `<div class="ve-muted mt-1" style="font-size: 0.85em;">Selected: ${summary} — ${totalCSDiceCost}d6 deducted from Sneak Attack</div>`);
			}

			section.append(cs);
		}

		container.append(section);
	}

	/**
	 * Get available Cunning Strike options based on Rogue level
	 */
	_getCunningStrikeOptions (calcs) {
		const options = [];
		// Base options (level 5)
		options.push({name: "Poison", cost: 1, save: "con", desc: "Target must succeed CON save or be poisoned"});
		options.push({name: "Trip", cost: 1, save: "dex", desc: "Target must succeed DEX save or fall prone"});
		options.push({name: "Withdraw", cost: 1, save: null, desc: "Disengage as part of this attack"});

		// Improved options (level 11)
		if (calcs.hasImprovedCunningStrike) {
			options.push({name: "Daze", cost: 2, save: "con", desc: "Target must succeed CON save or be dazed"});
		}

		// Devious Strikes (level 14)
		if (calcs.hasDeviousStrikes) {
			options.push({name: "Knock Out", cost: 6, save: "con", desc: "Target must succeed CON save or fall unconscious"});
			options.push({name: "Obscure", cost: 3, save: "dex", desc: "Target must succeed DEX save or be blinded"});
		}

		return options;
	}

	/**
	 * Reset cunning strike selections (on SA use, round advance, combat end)
	 */
	_resetCunningStrikeSelections () {
		this._selectedCunningStrikes = [];
	}

	/**
	 * Render active states in combat tab - includes both active states and available activatable features
	 */
	renderCombatStates () {
		const container = document.getElementById("charsheet-combat-states");
		if (!container) return;

		// Refresh state reference in case called independently (not via render())
		this._state = this._page.getState();

		// Update combat tracker controls
		this._updateCombatTrackerUI();

		container.innerHTML = "";

		const allStates = this._state?.getActiveStates?.() || [];
		// Filter for only currently active, non-condition states
		const activeStates = allStates.filter(s => s.active && !s.isCondition);

		// Also check for concentration
		const concentration = this._state.getConcentration?.();

		// Get activatable features (same as Overview tab)
		const activatableFeatures = this._state.getActivatableFeatures?.() || [];
		// Filter out limited-use custom abilities - they're shown in Resources section
		const availableFeatures = activatableFeatures.filter(af => {
			if (af.isActive) return false;
			// Exclude limited-use custom abilities (shown in Resources)
			if (af.feature?.isCustomAbility) {
				const customAbility = this._state.getCustomAbility?.(af.feature.id);
				if (customAbility?.mode === "limited") return false;
			}
			return true;
		});

		// === Section 1: Currently Active States ===
		const hasActiveStates = activeStates.length > 0 || concentration;

		if (hasActiveStates) {
			const activeSection = e_({outer: `<div class="charsheet__combat-active-section mb-2">
				<div class="ve-small ve-bold text-success mb-1">● Currently Active</div>
			</div>`});

			// Render concentration first if active
			if (concentration) {
				const conc = e_({outer: `
					<div class="charsheet__combat-state-item badge badge-info mr-1 mb-1">
						🔮 ${concentration.spellName || "Concentrating"}
						<span class="charsheet__state-remove ml-1" title="Break Concentration">&times;</span>
					</div>
				`});
				conc.querySelector(".charsheet__state-remove")?.addEventListener("click", (/** @type {*} */ e) => {
					e.stopPropagation();
					this._state.breakConcentration?.();
					this.renderCombatStates();
					this._page._renderActiveStates?.();
					this._page._saveCurrentCharacter?.();
					this._page._renderCharacter?.();
				});
				activeSection.append(conc);
			}

			for (const state of activeStates) {
				const stateType = CharacterSheetState.ACTIVE_STATE_TYPES?.[state.stateTypeId];
				const tooltipParts = [];
				if (stateType?.description) tooltipParts.push(stateType.description);
				if (stateType?.effects?.length) {
					const effectsStr = stateType.effects.map(e => e.type && e.target ? `${e.type} → ${e.target}` : e.type || "").filter(Boolean).join("; ");
					if (effectsStr) tooltipParts.push(`Effects: ${effectsStr}`);
				}
				const tooltip = tooltipParts.join("\n");

				// Check if this is a spell effect
				const isSpellEffect = state.isSpellEffect || state.sourceFeatureId?.startsWith("spell_");

				// Try to create hoverable name from source feature or spell
				let stateNameHtml = state.name || stateType?.name || state.stateTypeId;
				if (isSpellEffect) {
					// Create spell hover link with charsheet modifications (metamagic, rarity)
					try {
						const source = state.spellSource || Parser.SRC_XPHB;
						const spellData = this._page._spells?._allSpells?.find(s => s.name === state.name && s.source === source);
						const characterSpell = this._state.getSpells?.().find(s => s.name === state.name && s.source === source);
						stateNameHtml = this._page.getSpellHoverLink(state.name, source, spellData || null, characterSpell || null);
					} catch (e) {
						// Fall back to plain name
						stateNameHtml = state.name;
					}
				} else if (state.sourceFeatureId) {
					const feature = this._state.getFeatures?.().find(f => f.id === state.sourceFeatureId);
					if (feature) {
						stateNameHtml = this._page._getFeatureHoverLink?.(feature) || stateNameHtml;
					}
				}

				// Check if this state can be manually ended
				const isEndable = this._isStateEndable(state, stateType);

				// Round-remaining indicator
				let roundsLabel = "";
				if (this._state.isInCombat?.() && state.roundsRemaining != null) {
					if (state.roundsRemaining <= 1) {
						roundsLabel = ` <span class="ve-small text-warning" title="${state.roundsRemaining} round(s) left">(${state.roundsRemaining}r!)</span>`;
					} else {
						roundsLabel = ` <span class="ve-small ve-muted" title="${state.roundsRemaining} rounds left">(${state.roundsRemaining}r)</span>`;
					}
				}

				const stateEl = e_({outer: `
					<div class="charsheet__combat-state-item badge ${this._getStateBadgeClass(state.stateTypeId)} mr-1 mb-1" data-state-id="${state.id}" title="${tooltip}">
						${state.icon || stateType?.icon || "⚡"} <span class="charsheet__state-name-link">${stateNameHtml}</span>${roundsLabel}
						${stateType?.activationAction ? `<span class="ve-small" style="opacity: 0.7"> (${this._getActionTypeShortLabel(stateType.activationAction)})</span>` : ""}
						${isEndable ? `<span class="charsheet__state-remove ml-1" title="End">&times;</span>` : ""}
					</div>
				`});

				if (isEndable) {
					stateEl.querySelector(".charsheet__state-remove")?.addEventListener("click", (/** @type {*} */ e) => {
						e.stopPropagation();
						// Check if this is a custom ability state
						const customAbility = state.sourceFeatureId && this._state.getCustomAbilities?.()?.find(a => a.id === state.sourceFeatureId);
						if (customAbility) {
							this._state.toggleCustomAbility(customAbility.id);
							// Sync custom abilities panel
							this._page._customAbilitiesPanel?.render?.();
						} else {
							this._state.deactivateState(state.stateTypeId);
							// Bridge combat stance deactivation to the stance-specific system
							if (state.stateTypeId === "combatStance") {
								this._state.deactivateStance();
							}
						}
						this.renderCombatStates();
						this.renderCombatDefenses();
						this.renderCombatEffects();
						this._page._renderActiveStates?.();
						this._page._saveCurrentCharacter?.();
						this._page._renderCharacter?.();
					});
				}

				activeSection.append(stateEl);
			}

			container.append(activeSection);
		}

		// === Section 2: Available to Activate ===
		if (availableFeatures.length > 0) {
			const availableSection = e_({outer: `<div class="charsheet__combat-available-section">
				<div class="ve-small ve-muted mb-1">Available to Activate</div>
			</div>`});

			availableFeatures.forEach(({feature, activationInfo, resource, stateTypeId, customAbilityId}) => {
				const stateType = activationInfo.stateType || CharacterSheetState.ACTIVE_STATE_TYPES[stateTypeId];
				// For custom abilities, get the actual ability's icon; otherwise use state type icon
				let icon = stateType?.icon || "⚡";
				const customAbility = feature.isCustomAbility ? this._state.getCustomAbility?.(feature.id) : null;
				if (feature.isCustomAbility) {
					icon = customAbility?.icon || this._getCustomAbilityIcon(feature.category);
				}
				const resourceCost = resource?.cost || activationInfo.staminaCost || stateType?.resourceCost || 1;
				const hasResourceAvailable = !resource || resource.current >= resourceCost;

				const buttonText = this._getActivationButtonText({activationInfo, customAbility});

				// Get activation action type
				const activationAction = activationInfo.activationAction || stateType?.activationAction;
				const actionLabel = this._getActionLabel(activationAction);

				// Create hoverable feature name link
				const featureNameHtml = this._page._getFeatureHoverLink?.(feature) || feature.name;

				// Build resource info string
				let resourceInfo = "";
				let resourceTooltip = "";
				if (resource) {
					const shortName = this._getShortResourceName(resource.name);
					resourceInfo = `${resource.current}/${resource.max} ${shortName}`;
					resourceTooltip = `Uses ${resourceCost} ${resource.name} (${resource.current}/${resource.max} remaining)`;
				} else if (activationInfo.staminaCost) {
					resourceInfo = `${resourceCost} Stamina`;
					resourceTooltip = `Costs ${resourceCost} Stamina`;
				}

				const row = e_({outer: `
					<div class="charsheet__activatable-row ve-flex-v-center py-1 px-2 mb-1 rounded" 
						style="background: var(--cs-bg-surface, var(--rgb-bg-alt, #1e293b)); font-size: 0.85em;">
						<span class="mr-1">${icon}</span>
						<span class="flex-grow-1 text-truncate charsheet__state-name-link">${featureNameHtml}</span>
						<div class="ve-flex-v-center ml-auto">
							${actionLabel ? `<span class="ve-small ve-muted mr-1">${actionLabel}</span>` : ""}
							${resourceInfo ? `<span class="ve-small ve-muted mr-1" title="${resourceTooltip}">${resourceInfo}</span>` : ""}
							<button class="ve-btn ve-btn-xs ve-btn-success charsheet__activate-btn" 
								${!hasResourceAvailable ? `disabled title="Not enough ${resource?.name || "uses"} remaining"` : ""}>
								${buttonText}
							</button>
						</div>
					</div>
				`});

				row.querySelector(".charsheet__activate-btn")?.addEventListener("click", () => {
					this._activateCombatFeature(feature, stateTypeId, stateType, resource, resourceCost, activationInfo);
				});

				availableSection.append(row);
			});

			container.append(availableSection);
		}

		// Show message if nothing to display
		if (!hasActiveStates && availableFeatures.length === 0) {
			container.innerHTML = `<div class="ve-muted ve-text-center py-2">No activatable features</div>`;
		}

		// Set up quick activation buttons
		this._initQuickStateButtons();

		// Set up combat tracker buttons (idempotent)
		this._initCombatTracker();
	}

	_activateCombatFeature (feature, stateTypeId, stateType, resource, resourceCost, activationInfo = null) {
		this._page._activateFeatureState?.(feature, stateTypeId, stateType, resource, resourceCost, activationInfo);
		this.renderCombatStates();
		this._page._renderActiveStates?.();
		if (feature.isCustomAbility) {
			this._page._customAbilitiesPanel?.render?.();
		}
	}

	_getActivationButtonText ({activationInfo = null, customAbility = null} = {}) {
		const interactionMode = activationInfo?.interactionMode || (activationInfo?.isToggle ? "toggle" : "limited");
		const isLimitedUse = customAbility?.mode === "limited"
			|| interactionMode === "limited"
			|| interactionMode === "trigger"
			|| interactionMode === "instant";

		return isLimitedUse ? "Use" : "Activate";
	}

	/**
	 * Get action label for activation type
	 */
	_getActionLabel (actionType) {
		switch (actionType) {
			case "bonus": return "⚡ Bonus";
			case "action": return "⚔️ Action";
			case "reaction": return "🔄 Reaction";
			case "free": return "✨ Free";
			case "special": return "🔶 Special";
			case "varies": return "🔷 Varies";
			default: return "";
		}
	}

	_getActionTypeShortLabel (actionType) {
		switch (actionType) {
			case "bonus": return "Bonus";
			case "action": return "Action";
			case "reaction": return "Reaction";
			case "free": return "Free";
			case "special": return "Special";
			case "varies": return "Varies";
			default: return "";
		}
	}

	/**
	 * Get icon for custom ability category
	 */
	_getCustomAbilityIcon (category) {
		const icons = {
			"buff": "⬆️",
			"defensive": "🛡️",
			"offensive": "⚔️",
			"utility": "🔧",
			"homebrew": "🧪",
			"houserule": "📜",
			"boon": "✨",
			"curse": "💀",
			"temporary": "⏳",
			"item": "💎",
			"other": "⚡",
		};
		return icons[category] || "⚡";
	}

	/**
	 * Get a shortened version of a resource name for compact display
	 */
	_getShortResourceName (name) {
		if (!name) return "";
		// Common shortenings
		const shortenings = {
			"Bardic Inspiration": "Insp",
			"Channel Divinity": "CD",
			"Wild Shape": "WS",
			"Ki Points": "Ki",
			"Sorcery Points": "SP",
			"Superiority Dice": "SD",
			"Lay on Hands": "LoH",
			"Rage": "Rage",
			"Bladesong": "BS",
		};

		// Check for exact or partial match
		for (const [full, short] of Object.entries(shortenings)) {
			if (name.toLowerCase().includes(full.toLowerCase())) return short;
		}

		// Default: take first word or abbreviate
		const words = name.split(/\s+/);
		if (words.length === 1) return name.length > 8 ? `${name.slice(0, 6)}…` : name;
		// Take initials for multi-word names
		return words.map(w => w[0]).join("").toUpperCase();
	}

	_getStateBadgeClass (typeId) {
		const classes = {
			"rage": "badge-danger",
			"concentration": "badge-info",
			"wildshape": "badge-success",
			"dodge": "badge-primary",
			"defensivestance": "badge-warning",
			"combatStance": "badge-warning",
			"prone": "badge-secondary",
		};
		return classes[typeId] || "badge-secondary";
	}

	/**
	 * Check if a state can be manually ended
	 * Some passive features (like Tough, Unarmored Defense) shouldn't be endable
	 */
	_isStateEndable (state, stateType) {
		// If stateType explicitly says not endable
		if (stateType?.isPassive || stateType?.notEndable) return false;

		// If it has a resource cost, it's definitely endable (activated abilities)
		if (stateType?.resourceCost || stateType?.resourceName) return true;

		// Check source feature to see if it's a passive ability
		if (state.sourceFeatureId) {
			const feature = this._state.getFeatures?.().find(f => f.id === state.sourceFeatureId);
			if (feature) {
				const name = feature.name?.toLowerCase() || "";

				// Passive abilities that shouldn't be endable (truly passive, always-on effects)
				const passivePatterns = [
					/^unarmored defense$/i,
					/^tough$/i,
					/^durable$/i,
					/^observant$/i,
					/^alert$/i,
				];

				if (passivePatterns.some(p => p.test(name))) return false;
			}
		}

		return true;
	}

	_initQuickStateButtons () {
		// Only show Rage button if rage resource exists in parsed data
		const hasRageResource = this._state.getResources?.()?.some(r => r.name.toLowerCase().includes("rage"));
		document.getElementById("charsheet-combat-rage").style.display = hasRageResource ? "" : "none";

		// Show Concentration button if character has spellcasting
		// getSpellSlots returns an object keyed by level, not an array
		const spellSlots = this._state.getSpellSlots?.() || {};
		const hasSpellSlots = Object.values(spellSlots).some(slot => slot?.max > 0);
		const hasSpellcasting = hasSpellSlots || this._state.getSpells?.()?.length > 0;
		document.getElementById("charsheet-combat-concentrate").style.display = hasSpellcasting ? "" : "none";

		// Add hover attributes to Dodge button for action hover tooltip
		try {
			const dodgeHash = UrlUtil.encodeForHash(["Dodge", Parser.SRC_XPHB].join(HASH_LIST_SEP));
			const hoverAttrs = Renderer.hover.getHoverElementAttributes({
				page: UrlUtil.PG_ACTIONS,
				source: Parser.SRC_XPHB,
				hash: dodgeHash,
			});
			// Parse the attributes string and apply them to the button
			const dodgeBtn = document.getElementById("charsheet-combat-dodge");
			const tempEl = document.createElement("div");
			tempEl.innerHTML = `<span ${hoverAttrs}></span>`;
			const span = /** @type {*} */ (tempEl.firstChild);
			for (const attr of span.attributes) {
				dodgeBtn.setAttribute(attr.name, attr.value);
			}
		} catch (e) {
			// eslint-disable-next-line no-console
			console.warn("[Combat] Error adding Dodge hover attrs:", e);
		}

		// Rage button
		document.getElementById("charsheet-combat-rage").onclick = () => {
			if (this._state.isStateTypeActive?.("rage")) {
				this._state.deactivateState("rage");
			} else {
				// Check if character has rage resource
				const rageResource = this._state.getResources?.()?.find(r => r.name.toLowerCase().includes("rage"));
				if (rageResource && rageResource.current <= 0) {
					JqueryUtil.doToast({type: "warning", content: "No rage uses remaining!"});
					return;
				}
				this._state.activateState("rage");
				// Spend rage use
				if (rageResource) {
					this._state.setResourceCurrent(rageResource.id, rageResource.current - 1);
					this.renderCombatResources();
				}
			}
			this.renderCombatStates();
			this.renderCombatDefenses(); // Rage gives resistances
			this.renderCombatEffects(); // Rage gives advantage on STR checks/saves
			this._page._renderActiveStates?.();
			this._page._saveCurrentCharacter?.();
			this._page._renderCharacter?.(); // Re-render to apply/remove effects
			this._updateQuickButtonStates();
		};

		// Dodge button
		document.getElementById("charsheet-combat-dodge").onclick = () => {
			if (this._state.isStateTypeActive?.("dodge")) {
				this._state.deactivateState("dodge");
			} else {
				this._state.activateState("dodge");
			}
			this.renderCombatStates();
			this.renderCombatEffects(); // Dodge gives advantage on DEX saves
			this._page._renderActiveStates?.();
			this._page._saveCurrentCharacter?.();
			this._page._renderCharacter?.(); // Re-render to apply/remove effects
			this._updateQuickButtonStates();
		};

		// Concentration button (show modal to enter spell name)
		document.getElementById("charsheet-combat-concentrate").onclick = async () => {
			if (this._state.isConcentrating?.()) {
				const confirmed = await InputUiUtil.pGetUserBoolean(/** @type {*} */ ({
					title: "Break Concentration?",
					textYes: "Yes, break",
					textNo: "Cancel",
					htmlDescription: `Currently concentrating on: <strong>${this._state.getConcentration?.()?.spellName || "Unknown"}</strong>`,
				}));
				if (confirmed) {
					this._state.breakConcentration();
					this.renderCombatStates();
					this._page._renderActiveStates?.();
					this._page._saveCurrentCharacter?.();
					this._page._renderCharacter?.(); // Re-render to remove effects
				}
			} else {
				// Get character's known spells with concentration
				const allSpells = this._state.getSpells() || [];
				const concentrationSpells = allSpells.filter(spell => {
					// Check the stored concentration boolean property
					// (duration array format won't work for stored spells as duration is stored as string)
					return spell.concentration === true;
				});

				let spellName;
				if (concentrationSpells.length > 0) {
					// Build choice values - spell names plus a custom option
					const values = concentrationSpells.map(s => s.name);
					values.push("__OTHER__");

					const result = await InputUiUtil.pGetUserEnum({
						title: "Select Concentration Spell",
						values: values,
						fnDisplay: (val) => {
							if (val === "__OTHER__") return "-- Enter other spell --";
							const spell = concentrationSpells.find(s => s.name === val);
							return spell ? `${spell.name} (Level ${spell.level || 0})` : val;
						},
						isResolveItem: true,
						isAllowNull: true,
					});

					if (result === "__OTHER__") {
						spellName = await InputUiUtil.pGetUserString({title: "Enter spell name"});
					} else {
						spellName = result;
					}
				} else {
					// No concentration spells found, fallback to text input
					spellName = await InputUiUtil.pGetUserString({title: "Concentrating on which spell?"});
				}

				if (spellName) {
					this._state.setConcentration(spellName);
					this.renderCombatStates();
					this._page._renderActiveStates?.();
					this._page._saveCurrentCharacter?.();
					this._page._renderCharacter?.(); // Re-render to apply effects
				}
			}
			this._updateQuickButtonStates();
		};

		// Concentration Save button - roll CON save to maintain concentration
		document.getElementById("charsheet-combat-conc-save").onclick = async () => {
			if (!this._state.isConcentrating?.()) {
				JqueryUtil.doToast({type: "warning", content: "You are not currently concentrating on a spell."});
				return;
			}

			// Ask for damage amount to calculate DC
			const damageStr = await InputUiUtil.pGetUserString({
				title: "Concentration Save",
				default: "0",
				htmlDescription: `
					<p>Enter the damage you took to calculate the DC.</p>
					<p class="ve-muted ve-small">DC = max(10, damage ÷ 2)</p>
				`,
			});

			if (damageStr === null) return;

			const damage = parseInt(damageStr) || 0;
			const concentrationCheck = this._state.makeConcentrationCheck?.(damage) || {
				dc: Math.max(10, Math.floor(damage / 2)),
				bonus: 0,
				advantage: false,
				sources: [],
			};
			const dc = concentrationCheck.dc;
			const totalBonus = concentrationCheck.bonus;
			const hasAdvantage = concentrationCheck.advantage;

			// Roll the d20
			const roll1 = this._page.rollDice(1, 20);
			const roll2 = hasAdvantage ? this._page.rollDice(1, 20) : null;
			let finalRoll1 = roll1;
			let finalRoll2 = roll2;
			let roll = hasAdvantage ? Math.max(finalRoll1, finalRoll2) : finalRoll1;
			const total = roll + totalBonus;
			let success = total >= dc;
			let rerollMessage = "";

			if (!success && this._state.canUseFocusedConcentrationReroll?.()) {
				this._state.useFocusedConcentrationReroll?.();
				const rerolledDieLabel = hasAdvantage && finalRoll2 != null
					? (finalRoll1 <= finalRoll2 ? "lower concentration die" : "higher concentration die")
					: "concentration die";
				const rerolledValue = this._page.rollDice(1, 20);

				if (hasAdvantage && finalRoll2 != null) {
					if (finalRoll1 <= finalRoll2) finalRoll1 = rerolledValue;
					else finalRoll2 = rerolledValue;
					roll = Math.max(finalRoll1, finalRoll2);
				} else {
					finalRoll1 = rerolledValue;
					roll = finalRoll1;
				}

				success = (roll + totalBonus) >= dc;
				rerollMessage = ` Focused Spell rerolled the ${rerolledDieLabel}.`;
			}

			// Build result message
			let rollStr = `d20(${roll})`;
			if (hasAdvantage) {
				const sourceText = concentrationCheck.sources?.length
					? ` (${concentrationCheck.sources.join(", ")})`
					: "";
				rollStr = `d20(${finalRoll1}, ${finalRoll2}) = ${roll}${sourceText}`;
			}

			const bonusStr = totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`;
			const resultEmoji = success ? "✅" : "❌";
			const resultText = success ? `SUCCESS - Concentration maintained!${rerollMessage}` : `FAILED - Concentration broken!${rerollMessage}`;

			JqueryUtil.doToast({
				type: success ? "success" : "danger",
				content: `${resultEmoji} Concentration Save vs DC ${dc}: ${rollStr} ${bonusStr} = ${roll + totalBonus}. ${resultText}`,
			});

			// If failed, break concentration
			if (!success) {
				this._state.breakConcentration?.();
				this.renderCombatStates();
				this._page._renderActiveStates?.();
				this._page._saveCurrentCharacter?.();
				this._page._renderCharacter?.();
				this._updateQuickButtonStates();
			}
		};

		this._updateQuickButtonStates();
	}

	_updateQuickButtonStates () {
		// Update button active states - toggle both active class and button color
		const rageActive = this._state.isStateTypeActive?.("rage") || false;
		const rageBtn = document.getElementById("charsheet-combat-rage");
		rageBtn.classList.toggle("active", rageActive);
		rageBtn.classList.toggle("ve-btn-warning", rageActive); rageBtn.classList.toggle("ve-btn-danger", !rageActive);
		rageBtn.textContent = rageActive ? "End Rage" : "Rage";

		const dodgeActive = this._state.isStateTypeActive?.("dodge") || false;
		const dodgeBtn = document.getElementById("charsheet-combat-dodge");
		dodgeBtn.classList.toggle("active", dodgeActive);
		dodgeBtn.classList.toggle("ve-btn-warning", dodgeActive); dodgeBtn.classList.toggle("ve-btn-primary", !dodgeActive);
		dodgeBtn.textContent = dodgeActive ? "End Dodge" : "Dodge";

		const concentrating = this._state.isConcentrating?.() || false;
		const concBtn = document.getElementById("charsheet-combat-concentrate");
		concBtn.classList.toggle("active", concentrating);
		concBtn.classList.toggle("ve-btn-info", concentrating); concBtn.classList.toggle("ve-btn-warning", !concentrating);
		if (concentrating) {
			const spellName = this._state.getConcentration?.()?.spellName;
			concBtn.textContent = spellName ? `🔮 ${spellName}` : "Concentrating";
		} else {
			concBtn.textContent = "Concentrate";
		}

		// Show/hide concentration save button based on whether concentrating
		const concSaveBtn = document.getElementById("charsheet-combat-conc-save");
		concSaveBtn.style.display = (concentrating) ? "" : "none";
	}

	/**
	 * Update combat tracker UI (Start/End button, round display, Next Round button)
	 */
	_updateCombatTrackerUI () {
		const inCombat = this._state?.isInCombat?.() || false;
		const round = this._state?.getCombatRound?.() || 0;

		const startBtn = document.getElementById("charsheet-combat-start");
		const roundDisplay = document.getElementById("charsheet-combat-round-display");
		const roundNum = document.getElementById("charsheet-combat-round-num");
		const nextBtn = document.getElementById("charsheet-combat-next-round");

		if (inCombat) {
			startBtn.textContent = "🏁 End Combat"; startBtn.classList.remove("ve-btn-success"); startBtn.classList.add("ve-btn-danger");
			roundDisplay.style.display = "";
			roundNum.textContent = round;
			nextBtn.style.display = "";
		} else {
			startBtn.textContent = "⚔️ Start Combat"; startBtn.classList.remove("ve-btn-danger"); startBtn.classList.add("ve-btn-success");
			roundDisplay.style.display = "none";
			nextBtn.style.display = "none";
		}
	}

	/**
	 * Initialise combat tracker button handlers (called once on first render)
	 */
	_initCombatTracker () {
		if (this._combatTrackerInitialised) return;
		this._combatTrackerInitialised = true;

		document.getElementById("charsheet-combat-start").onclick = () => {
			if (this._state.isInCombat?.()) {
				this._state.endCombat();
				this._lastSneakAttackRoundUsed = null;
				this._sneakAttackEnabled = false;
				this._sneakAttackHasAdjacentAlly = false;
				this._lastAttackContext = null;
				this._handOfHarmUsedThisTurn = false;
				this._resetTurnActionUsage();
				this._resetCunningStrikeSelections();
				JqueryUtil.doToast({type: "info", content: "Combat ended."});
			} else {
				this._state.startCombat();
				this._lastSneakAttackRoundUsed = null;
				this._sneakAttackEnabled = false;
				this._sneakAttackHasAdjacentAlly = false;
				this._lastAttackContext = null;
				this._handOfHarmUsedThisTurn = false;
				this._resetTurnActionUsage();
				this._resetCunningStrikeSelections();
				JqueryUtil.doToast({type: "success", content: "Combat started — Round 1!"});
			}
			this.renderCombatStates();
			this.renderCombatActions();
			this.renderCombatEffects();
			this._renderSneakAttackToggle?.();
			this._page._saveCurrentCharacter?.();
		};

		document.getElementById("charsheet-combat-next-round").onclick = () => {
			const expired = this._state.advanceRound?.() || [];
			const round = this._state.getCombatRound?.() || 0;
			this._resetTurnActionUsage();
			this._sneakAttackHasAdjacentAlly = false;
			this._lastAttackContext = null;
			this._resetCunningStrikeSelections();

			if (expired) {
				JqueryUtil.doToast({type: "warning", content: `Round ${round} — expired: ${expired.join(", ")}`});
			} else {
				JqueryUtil.doToast({type: "info", content: `Round ${round}`});
			}

			this.renderCombatStates();
			this.renderCombatActions();
			this._renderSneakAttackToggle?.();
			this.renderCombatDefenses();
			this.renderCombatEffects();
			this._page._renderActiveStates?.();
			this._page._saveCurrentCharacter?.();
			this._page._renderCharacter?.();
			this._updateQuickButtonStates();
		};
	}

	/**
	 * Render Combat Methods section (Thelemar homebrew)
	 */
	renderCombatMethods () {
		// Get combat method features from character
		const features = this._state.getFeatures();
		const combatMethods = features.filter(f => CharacterSheetClassUtils.isCombatMethod(f));

		// Main page section
		const section = document.getElementById("charsheet-combat-methods-section");
		const container = document.getElementById("charsheet-combat-methods");
		const dcDisplay = document.getElementById("charsheet-method-dc");
		const staminaDisplay = document.getElementById("charsheet-stamina-pool");

		// Combat Tab section
		const tabSection = document.getElementById("charsheet-combat-methods-tab-section");
		const tabContainer = document.getElementById("charsheet-combat-methods-tab");
		const tabDcDisplay = document.getElementById("charsheet-method-dc-tab");

		if (!section || !container) return;

		// Hide sections if no combat methods
		if (combatMethods.length === 0) {
			section.style.display = "none";
			if (tabSection) tabSection.style.display = "none";
			return;
		}

		section.style.display = "";
		if (tabSection) tabSection.style.display = "";
		container.innerHTML = "";
		if (tabContainer) tabContainer.innerHTML = "";

		// Use state-calculated Method DC (handles Monk +1 base, WIS mod, Hexblade/Bladesinger override)
		const calcs = this._state.getFeatureCalculations();
		const profBonus = this._state.getProficiencyBonus();
		const methodDC = calcs.combatMethodDc ??
			(8 + profBonus + Math.max(this._state.getAbilityMod("str"), this._state.getAbilityMod("dex")));
		if (dcDisplay) dcDisplay.textContent = methodDC;
		if (tabDcDisplay) tabDcDisplay.textContent = methodDC;

		// Ensure stamina is initialized, then read from state (single source of truth)
		this._state.ensureStaminaInitialized();
		const staminaMax = this._state.getStaminaMax();
		if (staminaDisplay) staminaDisplay.textContent = staminaMax;
		if (this._state.getStaminaCurrent() === null || this._state.getStaminaCurrent() === undefined) {
			this._state.setStaminaCurrent(staminaMax);
		}

		// Update stamina display
		this._updateStaminaDisplay();

		// Group methods by tradition
		const methodsByTradition = new Map();
		for (const method of combatMethods) {
			const tradCode = this._getMethodTradition(method);
			if (!methodsByTradition.has(tradCode)) {
				methodsByTradition.set(tradCode, []);
			}
			methodsByTradition.get(tradCode).push(method);
		}

		// Render methods grouped by tradition to both containers
		this._renderMethodsToContainer(container, methodsByTradition, {showUseButton: false});
		this._renderMethodsToContainer(tabContainer, methodsByTradition, {showUseButton: true});
	}

	_renderMethodsToContainer (container, methodsByTradition, {showUseButton = false} = {}) {
		for (const [tradCode, methods] of methodsByTradition) {
			const tradName = this._getTraditionName(tradCode);
			const tradGroup = e_({outer: `
				<div class="charsheet__methods-group mb-2">
					<div class="charsheet__methods-tradition-header ve-small ve-muted mb-1 ve-flex ve-flex-v-center">
						<span class="bold">${tradName}</span>
					</div>
				</div>
			`});

			methods.sort((a, b) => {
				const degreeA = this._getMethodDegree(a);
				const degreeB = this._getMethodDegree(b);
				return degreeA - degreeB || a.name.localeCompare(b.name);
			}).forEach(method => {
				const degree = this._getMethodDegree(method);
				const staminaCost = this._getMethodStaminaCost(method);
				const methodId = `${method.name}-${method.source || ""}`.replace(/\s+/g, "-").toLowerCase();

				// Parse enhanced effects from state
				const parsed = this._state._parseCombatMethodEffects?.(method) || {};

				// Create hoverable link for method name (like spells/weapons)
				let methodNameHtml = method.name;
				if (this._page?.getHoverLink && method.source) {
					try {
						methodNameHtml = this._page.getHoverLink(
							UrlUtil.PG_COMBAT_METHODS,
							method.name,
							method.source,
						);
					} catch (e) {
						methodNameHtml = method.name;
					}
				}

				// Build extra badges for method properties
				const extraBadges = [];
				if (parsed.isMultiTarget) {
					const targetLabel = parsed.maxTargets === "proficiency" ? "Multi (Prof)" : "Multi-target";
					extraBadges.push(`<span class="badge badge-info ml-1" title="Multi-target attack">${targetLabel}</span>`);
				}
				if (parsed.range) {
					extraBadges.push(`<span class="badge badge-warning ml-1" title="Ranged: ${parsed.range.normal}/${parsed.range.long} ft">${parsed.range.normal}/${parsed.range.long} ft</span>`);
				}
				if (parsed.grantsAdvantage) {
					extraBadges.push(`<span class="badge badge-success ml-1" title="Grants advantage on attack rolls">Adv</span>`);
				}
				if (parsed.actionType) {
					let actionIcon = "⚔️";
					if (parsed.actionType === "Bonus Action") actionIcon = "⚡";
					else if (parsed.actionType === "Reaction") actionIcon = "🔄";
					extraBadges.push(`<span class="badge badge-outline-secondary ml-1">${actionIcon} ${parsed.actionType}</span>`);
				}

				const isWeaponModifier = parsed.methodCategory === "weaponModifier";
				const rememberedWeapon = isWeaponModifier ? this._state.getCombatMethodWeapon(method.name) : null;
				const weaponLabel = rememberedWeapon ? `<span class="ve-muted ve-small ml-1" title="Remembered weapon: ${rememberedWeapon.weaponName}">🗡️ ${rememberedWeapon.weaponName}</span>` : "";

				const methodEl = e_({outer: `
					<div class="charsheet__method-item mb-1 p-1 ve-flex ve-flex-v-center ve-flex-h-space-between" style="border-left: 2px solid var(--rgb-link); padding-left: 0.5rem;">
						<div class="ve-flex ve-flex-v-center ve-flex-wrap">
							<span class="charsheet__method-name" style="font-weight: bold;">${methodNameHtml}</span>
							<span class="ve-muted ve-small ml-2">(${degree}${this._getOrdinalSuffix(degree)})</span>
							${staminaCost > 0 ? `<span class="badge badge-secondary ml-2" title="Stamina cost">${staminaCost} EP</span>` : ""}
							${extraBadges.join("")}
							${weaponLabel}
						</div>
						${showUseButton ? `<div class="ve-flex ve-flex-v-center ml-2">
							<button class="ve-btn ve-btn-xs ve-btn-primary charsheet__method-use" data-method-id="${methodId}" data-cost="${staminaCost}" title="Use this method (costs ${staminaCost} stamina)">Use</button>
							${isWeaponModifier ? `<button class="ve-btn ve-btn-xs ve-btn-default charsheet__method-choose-weapon ml-1" data-method-id="${methodId}" title="Choose which weapon to use">🗡️</button>` : ""}
						</div>` : ""}
					</div>
				`});

				// Store method data for later use
				methodEl._methodData = method;

				tradGroup.append(methodEl);
			});

			container.append(tradGroup);
		}
	}

	_getMethodStaminaCost (method) {
		// Try to extract stamina cost from method entries
		// Usually formatted like "Cost: X stamina" or mentions stamina in the text
		if (!method.entries) return 1; // Default cost

		const entriesStr = JSON.stringify(method.entries).toLowerCase();

		// Look for patterns like "costs X stamina" or "X stamina points"
		const costMatch = entriesStr.match(/costs?\s+(\d+)\s+stamina/i);
		if (costMatch) return parseInt(costMatch[1]);

		// Also check for degree-based default costs (1st=1, 2nd=2, etc.)
		const degree = this._getMethodDegree(method);
		return degree || 1;
	}

	_useMethod (methodId) {
		const btn = /** @type {*} */ (document.querySelector(`.charsheet__method-use[data-method-id="${methodId}"]`));
		const cost = parseInt(btn.dataset.cost) || 1;
		const currentStamina = this._state.getStaminaCurrent();

		if (currentStamina < cost) {
			// Try ki/focus-to-stamina conversion for Monks with the combat system
			if (this._state.canUseFocusForStamina?.()) {
				const kiCurrent = this._state.getKiPointsCurrent?.() ?? 0;
				if (kiCurrent >= cost) {
					if (!this._state.useFocusForStamina(cost)) {
						JqueryUtil.doToast({type: "warning", content: `Not enough ki/focus points to fuel this method!`});
						return;
					}
					// Ki was spent — continue to activation (skip stamina deduction below)
					this._activateMethodAfterPayment(btn, methodId, cost, "ki/focus");
					return;
				}
			}
			JqueryUtil.doToast({type: "warning", content: `Not enough stamina! You have ${currentStamina}, but this method costs ${cost}.`});
			return;
		}

		// Get the method data from the parent element (validate before spending stamina)
		const method = /** @type {*} */ (btn.closest(".charsheet__method-item"))?._methodData;
		if (!method) {
			JqueryUtil.doToast({type: "warning", content: `Could not resolve method data. Please try again.`});
			return;
		}

		this._state.setStaminaCurrent(currentStamina - cost);
		this._updateStaminaDisplay();

		// Also update resources section
		if (this._page?._features) {
			this._page._features._renderResources();
		}

		this._activateMethodEffect(btn, methodId, method, cost, "stamina");
	}

	/**
	 * Activate a combat method after paying with ki/focus points
	 */
	_activateMethodAfterPayment (btn, methodId, cost, resourceName) {
		const method = btn.closest(".charsheet__method-item")?._methodData;

		// Also update resources section (ki display)
		if (this._page?._features) {
			this._page._features._renderResources();
		}

		this._activateMethodEffect(btn, methodId, method, cost, resourceName);
	}

	/**
	 * Apply the method's effect after payment has been deducted
	 */
	_activateMethodEffect (btn, methodId, method, cost, resourceName) {
		if (method) {
			// Check if this is a stance (typically has duration) vs instant effect
			const isStance = this._isMethodStance(method);

			if (isStance) {
				// Parse effects from description
				const description = method.entries ? JSON.stringify(method.entries) : "";
				const parsedEffects = CharacterSheetState.parseEffectsFromDescription?.(description) || [];

				// Activate as a combat stance state
				this._state.activateState("combatStance", {
					name: method.name,
					icon: "⚔️",
					sourceFeatureId: method.id || methodId,
					description: description,
					customEffects: parsedEffects.length > 0 ? parsedEffects : null,
				});

				this.renderCombatStates();
				this.renderCombatEffects();
				this._page._renderActiveStates?.();
				this._page._saveCurrentCharacter?.();
				this._page._renderCharacter?.();

				JqueryUtil.doToast({type: "success", content: `Activated ${method.name}! (−${cost} ${resourceName})`});
			} else {
				// Non-stance method — handle by category
				// Use pre-parsed fields from getCombatMethods() if available, otherwise re-parse
				const parsedEffects = method.methodCategory
					? method
					: (this._state._parseCombatMethodEffects?.(method) || {});
				const category = parsedEffects.methodCategory || "instant";

				if (category === "weaponModifier") {
					this._activateWeaponModifierMethod(method, parsedEffects, cost, resourceName);
				} else {
					// selfHeal, acBuff, reaction, instant — toast for now
					JqueryUtil.doToast({type: "success", content: `Used ${method.name}! (−${cost} ${resourceName})`});
				}
			}
		} else {
			// Fallback: find method name for feedback
			const methodName = methodId.split("-").slice(0, -1).join(" ").replace(/\b\w/g, c => c.toUpperCase());
			JqueryUtil.doToast({type: "success", content: `Used ${methodName}! (−${cost} ${resourceName})`});
		}

		// Flash the button to indicate use
		btn.classList.add("ve-btn-success");
		setTimeout(() => btn.classList.remove("ve-btn-success"), 200);
	}

	/**
	 * Choose (or re-choose) a weapon for a weapon-modifier method without spending stamina.
	 */
	async _chooseWeaponForMethod (methodId) {
		const methodEl = /** @type {*} */ (document.querySelector(`.charsheet__method-choose-weapon[data-method-id="${methodId}"]`)?.closest(".charsheet__method-item"));
		const method = methodEl?._methodData;
		if (!method) return;

		const attacks = this._cachedAttacks?.length ? this._cachedAttacks : (this._state.getAttacks?.() || []);
		const weaponAttacks = attacks.filter(a => !a.isSpell && !a.isUnarmedStrike);

		if (weaponAttacks.length === 0) {
			JqueryUtil.doToast({type: "warning", content: `No weapon attacks available!`});
			return;
		}

		const choices = weaponAttacks.map(atk => ({
			name: `${atk.name} (${atk.damage} ${atk.damageType || ""})`,
			attack: atk,
		}));

		const chosen = await this._showCombatActionChoiceModal(
			{name: `🗡️ ${method.name} — Choose Weapon`},
			choices,
		);

		if (!chosen) return;

		this._state.setCombatMethodWeapon(method.name, chosen.attack.id, chosen.attack.name);
		this._page._saveCurrentCharacter?.();
		this.renderCombatMethods();
		JqueryUtil.doToast({type: "info", content: `${method.name} will now target ${chosen.attack.name}`});
	}

	/**
	 * Handle a weapon-modifier combat method (e.g. Wounding Strike).
	 * Shows weapon picker, then activates ongoing effect card.
	 */
	_activateWeaponModifierMethod (method, parsedEffects, cost, resourceName) {
		// Use cachedAttacks (includes auto-generated from equipped weapons), fall back to state attacks
		const attacks = this._cachedAttacks?.length ? this._cachedAttacks : (this._state.getAttacks?.() || []);
		// Filter to real weapons only — exclude unarmed strikes and spell attacks
		const weaponAttacks = attacks.filter(a => !a.isSpell && !a.isUnarmedStrike);

		if (weaponAttacks.length === 0) {
			JqueryUtil.doToast({type: "warning", content: `No weapon attacks available for ${method.name}!`});
			return;
		}

		// Check for a remembered weapon choice
		const remembered = this._state.getCombatMethodWeapon(method.name);
		if (remembered) {
			const rememberedAttack = weaponAttacks.find(a => a.id === remembered.weaponId);
			if (rememberedAttack) {
				this._applyWeaponModifierEffect(method, parsedEffects, rememberedAttack, cost, resourceName);
				return;
			}
		}

		// No remembered weapon (or it's no longer available) — show picker
		this._showWeaponPicker(method, parsedEffects, weaponAttacks, cost, resourceName);
	}

	/**
	 * Show a weapon picker modal for weapon-modifier combat methods.
	 */
	async _showWeaponPicker (method, parsedEffects, weaponAttacks, cost, resourceName) {
		const choices = weaponAttacks.map(atk => ({
			name: `${atk.name} (${atk.damage} ${atk.damageType || ""})`,
			attack: atk,
		}));

		const chosen = await this._showCombatActionChoiceModal(
			{name: `⚔️ ${method.name} — Choose Weapon`},
			choices,
		);

		if (!chosen) return;

		// Remember this weapon choice
		this._state.setCombatMethodWeapon(method.name, chosen.attack.id, chosen.attack.name);

		this._applyWeaponModifierEffect(method, parsedEffects, chosen.attack, cost, resourceName);

		// Re-render methods to show remembered weapon label
		this.renderCombatMethods();
	}

	/**
	 * Apply a weapon modifier effect to a chosen weapon attack.
	 */
	_applyWeaponModifierEffect (method, parsedEffects, attack, cost, resourceName) {
		const calcs = this._state.getFeatureCalculations?.() || {};
		const saveDc = calcs.combatMethodDc || 10;

		this._state.activateCombatMethodEffect({
			name: method.name,
			weaponId: attack.id,
			weaponName: attack.name,
			ongoingDamage: parsedEffects.ongoingDamage || null,
			ongoingSaveType: parsedEffects.ongoingSaveType || parsedEffects.saveType || null,
			saveDc,
			alternativeEndCheck: parsedEffects.alternativeEndCheck || null,
			description: method.entries ? JSON.stringify(method.entries) : "",
		});

		this.renderCombatEffects();
		this._page._saveCurrentCharacter?.();

		const dmgText = parsedEffects.ongoingDamage ? ` (${parsedEffects.ongoingDamage} ongoing damage)` : "";
		JqueryUtil.doToast({type: "success", content: `${method.name} applied to ${attack.name}${dmgText}! (−${cost} ${resourceName})`});
	}

	/**
	 * Check if a combat method is a stance (has duration) vs instant effect
	 */
	_isMethodStance (method) {
		// Quick check: if "Stance" is in the name
		if (method.name?.toLowerCase().includes("stance")) return true;

		if (!method.entries) return false;
		const entriesStr = JSON.stringify(method.entries).toLowerCase();

		// Check for duration indicators
		const stanceIndicators = [
			"until the start of your next turn",
			"until the end of your next turn",
			"for 1 minute",
			"for the duration",
			"while this stance",
			"while in this stance",
			"this stance lasts",
			"you enter",
			"you maintain",
			"concentration",
		];

		return stanceIndicators.some(indicator => entriesStr.includes(indicator));
	}

	_modifyStamina (delta) {
		const current = this._state.getStaminaCurrent() || 0;
		const max = this._state.getStaminaMax() || 0;
		const newValue = Math.max(0, Math.min(max, current + delta));
		this._state.setStaminaCurrent(newValue);
		this._updateStaminaDisplay();
		// Also update resources section
		if (this._page?._features) {
			this._page._features._renderResources();
		}
	}

	_updateStaminaDisplay () {
		const current = this._state.getStaminaCurrent() || 0;
		const max = this._state.getStaminaMax() || 0;

		document.getElementById("charsheet-stamina-current").textContent = current;
		document.getElementById("charsheet-stamina-max").textContent = max;

		// Color-code based on remaining stamina
		const display = document.getElementById("charsheet-stamina-display-tab");
		display.classList.remove("text-success", "text-warning", "text-danger");
		if (current === 0) {
			display.classList.add("text-danger");
		} else if (current <= max / 2) {
			display.classList.add("text-warning");
		} else {
			display.classList.add("text-success");
		}

		// Update resource pips in the resources section
		// Filled = available, empty = used
		const resourcePips = document.querySelectorAll("[data-resource-id=\"stamina\"] .charsheet__resource-pip--stamina");
		if (resourcePips.length) {
			resourcePips.forEach((pip, i) => {
				pip.classList.toggle("used", i >= current); // Empty (used) if index >= current available
			});
		}
	}

	/**
	 * Show the Combat Methods picker modal
	 * Allows adding/removing combat methods from selected traditions
	 */
	async _showMethodPicker () {
		const allOptFeatures = this._page.getOptionalFeatures() || [];
		const combatMethodEntities = this._page.getCombatMethodEntities?.() || [];

		// Get all combat method features (both legacy optionalfeatures and new combatMethod entities)
		const allMethods = [...allOptFeatures, ...combatMethodEntities].filter(opt =>
			CharacterSheetClassUtils.isCombatMethod(opt),
		);

		if (allMethods.length === 0) {
			JqueryUtil.doToast({type: "warning", content: "No combat methods available. Load the Thelemar homebrew source."});
			return;
		}

		// Get character's selected traditions
		let selectedTraditions = this._getCharacterTraditions();

		// Get currently known methods
		const knownMethods = this._state.getFeatures().filter(f => CharacterSheetClassUtils.isCombatMethod(f));
		const knownMethodNames = new Set(knownMethods.map(m => `${m.name}|${m.source || ""}`));

		// Get max degree and max methods based on character level
		const maxDegree = this._getCharacterMaxDegree();
		const maxMethods = this._getCharacterMaxMethods();

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "Combat Methods",
			isMinHeight0: true,
			isWidth100: true,
			isMaxWidth640p: true,
			zIndex: 1500, // Higher z-index to ensure hover popups work
			cbClose: () => document.body.classList.remove("has-method-picker"),
		});

		// Add class for styling and make sure hovers appear above
		modalInner.classList.add("charsheet__method-picker");
		document.body.classList.add("has-method-picker");
		modalInner.closest(".ve-ui-modal__inner").style.zIndex = "1500";

		// Create content container
		const content = e_({outer: `<div class="ve-flex-col h-100"></div>`}); modalInner.append(content);

		// === HEADER: Stats summary ===
		const header = e_({outer: `
			<div class="charsheet__method-picker-header">
				<div class="charsheet__method-picker-header-left">
					<span class="charsheet__method-picker-header-icon">⚔️</span>
					<div>
						<div class="charsheet__method-picker-header-title">Combat Methods</div>
						<div class="charsheet__method-picker-header-stat" style="display: flex; align-items: center; gap: 0.6rem; margin-top: 0.15rem;">
							<span>Max Degree: <span class="charsheet__method-picker-header-stat-value">${maxDegree > 0 ? maxDegree + this._getOrdinalSuffix(maxDegree) : "—"}</span></span>
							<span style="opacity: 0.4;">•</span>
							<span>Traditions: <span class="charsheet__method-picker-header-stat-value" id="method-picker-trad-count">${selectedTraditions.length}</span></span>
						</div>
					</div>
				</div>
				<div class="charsheet__method-picker-header-right">
					<div class="charsheet__method-picker-header-known-row">
						<span class="charsheet__method-picker-header-stat">Known:</span>
						<span class="charsheet__method-picker-header-known" id="method-picker-known-count">${knownMethodNames.size}</span>
						<span class="charsheet__method-picker-header-stat">/ ${maxMethods > 0 ? maxMethods : "∞"}</span>
					</div>
				</div>
			</div>
		`}); content.append(header);

		// === TRADITIONS SECTION ===
		const tradSection = e_({outer: `
			<div class="charsheet__method-picker-trads-section">
				<div class="charsheet__method-picker-trads-header">
					<span class="charsheet__method-picker-trads-title">Your Traditions</span>
					<button class="ve-btn ve-btn-xs ve-btn-default" id="method-picker-toggle-trads" title="Edit traditions">
						<span class="glyphicon glyphicon-pencil"></span> Edit
					</button>
				</div>
				<div id="method-picker-trads-display" class="charsheet__method-picker-trads-display"></div>
				<div id="method-picker-trads-edit" style="display: none;"></div>
			</div>
		`}); content.append(tradSection);

		// Render tradition display (compact pills)
		const tradsDisplay = tradSection.querySelector("#method-picker-trads-display");
		const tradsEdit = tradSection.querySelector("#method-picker-trads-edit");
		const toggleBtn = tradSection.querySelector("#method-picker-toggle-trads");
		let editMode = false;

		const tradIcons = this._getTraditionIcons();

		const renderTradsDisplay = () => {
			tradsDisplay.innerHTML = "";
			if (selectedTraditions.length === 0) {
				tradsDisplay.insertAdjacentHTML("beforeend", `<span class="charsheet__method-picker-header-stat" style="font-style: italic;">No traditions selected. Click Edit to choose.</span>`);
			} else {
				for (const code of selectedTraditions) {
					tradsDisplay.insertAdjacentHTML("beforeend", `
						<span class="charsheet__method-picker-trad-pill">
							<span class="charsheet__method-picker-trad-icon">${tradIcons[code] || "⚔️"}</span>
							${this._getTraditionName(code)}
						</span>
					`);
				}
			}
		};
		renderTradsDisplay();

		// Toggle edit mode
		toggleBtn.addEventListener("click", () => {
			editMode = !editMode;
			tradsDisplay.style.display = (!editMode) ? "" : "none";
			tradsEdit.style.display = (editMode) ? "" : "none";
			toggleBtn.innerHTML = editMode
				? "<span class=\"glyphicon glyphicon-ok\"></span> Done"
				: "<span class=\"glyphicon glyphicon-pencil\"></span> Edit";
			if (!editMode) {
				renderTradsDisplay();
				document.getElementById("method-picker-trad-count").textContent = selectedTraditions.length;
				this._renderMethodList(methodList, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);
			}
		});

		// Render tradition editor
		this._renderTraditionSelection(tradsEdit, selectedTraditions, () => {
			selectedTraditions = this._getSelectedTraditionsFromUI(tradsEdit);
		});

		// === FILTERS SECTION ===
		let filterTrad = "all";
		let filterDegree = "all";
		let filterStatus = "all";
		let searchQuery = "";

		const filterSection = e_({outer: `
			<div class="charsheet__method-picker-filters">
				<div class="charsheet__method-picker-search">
					<input type="text" class="ve-form-control ve-input-sm" id="method-picker-search" placeholder="🔍 Search methods...">
				</div>
				<select class="ve-form-control ve-input-sm charsheet__method-picker-filter-select" id="method-picker-trad-filter" style="min-width: 130px;">
					<option value="all">All Traditions</option>
				</select>
				<select class="ve-form-control ve-input-sm charsheet__method-picker-filter-select" id="method-picker-degree" style="min-width: 100px;">
					<option value="all">All Degrees</option>
					${[1, 2, 3, 4, 5].filter(d => d <= maxDegree).map(d =>
		`<option value="${d}">${d}${this._getOrdinalSuffix(d)} Degree</option>`,
	).join("")}
				</select>
				<select class="ve-form-control ve-input-sm charsheet__method-picker-filter-select" id="method-picker-filter" style="min-width: 90px;">
					<option value="all">All</option>
					<option value="known">Known</option>
					<option value="available">Available</option>
				</select>
			</div>
		`}); content.append(filterSection);

		// Populate tradition filter dropdown
		const tradFilter = filterSection.querySelector("#method-picker-trad-filter");
		const updateTradFilterOptions = () => {
			tradFilter.querySelectorAll("option:not(:first-child)").forEach(o => o.remove());
			for (const code of selectedTraditions) {
				tradFilter.insertAdjacentHTML("beforeend", `<option value="${code}">${tradIcons[code] || "⚔️"} ${this._getTraditionName(code)}</option>`);
			}
		};
		updateTradFilterOptions();

		// === METHOD LIST ===
		const methodList = e_({outer: `
			<div class="charsheet__method-picker-list"></div>
		`}); content.append(methodList);

		// Initial render
		this._renderMethodList(methodList, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);

		// Filter event listeners
		filterSection.querySelector("#method-picker-search")?.addEventListener("input", MiscUtil.debounce((e) => {
			searchQuery = e.target.value.toLowerCase();
			this._renderMethodList(methodList, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);
		}, 150));

		filterSection.querySelector("#method-picker-trad-filter")?.addEventListener("change", (/** @type {*} */ e) => {
			filterTrad = e.target.value;
			this._renderMethodList(methodList, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);
		});

		filterSection.querySelector("#method-picker-degree")?.addEventListener("change", (/** @type {*} */ e) => {
			filterDegree = e.target.value;
			this._renderMethodList(methodList, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);
		});

		filterSection.querySelector("#method-picker-filter")?.addEventListener("change", (/** @type {*} */ e) => {
			filterStatus = e.target.value;
			this._renderMethodList(methodList, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);
		});

		// === FOOTER ===
		const footer = e_({outer: `
			<div class="charsheet__method-picker-footer">
				<span class="charsheet__method-picker-footer-hint">💡 Hover method names for details</span>
				<button class="charsheet__method-picker-footer-btn">Done</button>
			</div>
		`}); content.append(footer);

		footer.querySelector("button")?.addEventListener("click", async () => {
			this._saveSelectedTraditions(selectedTraditions);
			await this._page.saveCharacter();
			this._page.renderCharacter();
			doClose(true);
		});
	}

	/**
	 * Get tradition icons mapping
	 */
	_getTraditionIcons () {
		return {
			"AM": "🏔️",
			"AK": "✨",
			"BU": "🐺",
			"BZ": "💨",
			"CJ": "🎭",
			"EB": "🌑",
			"GH": "💖",
			"MG": "🪞",
			"MS": "🌫️",
			"RC": "🌊",
			"RE": "🗡️",
			"SK": "🩸",
			"SS": "🐎",
			"TI": "⚔️",
			"TC": "🦷",
			"UW": "☯️",
			"UH": "🦅",
		};
	}

	/**
	 * Calculate max methods character can know
	 */
	_getCharacterMaxMethods () {
		// Look for a class with Combat Methods progression
		const classes = this._state.getClasses();
		let maxMethods = 0;

		for (const cls of classes) {
			const classData = this._page.getClasses?.().find(c => c.name === cls.name && c.source === cls.source);
			if (!classData?.optionalfeatureProgression) continue;

			const cmProg = classData.optionalfeatureProgression.find(prog =>
				prog.featureType?.some(ft => ft.startsWith("CTM:")) || prog.name?.toLowerCase().includes("combat method"),
			);
			if (!cmProg?.progression) continue;

			// Get methods at current level
			const level = cls.level || 1;
			const levelKey = String(level);
			if (cmProg.progression[levelKey]) {
				maxMethods += cmProg.progression[levelKey];
			} else {
				// Find the highest level <= current level
				const levels = Object.keys(cmProg.progression).map(Number).filter(l => l <= level).sort((a, b) => b - a);
				if (levels.length > 0) {
					maxMethods += cmProg.progression[String(levels[0])];
				}
			}
		}

		return maxMethods;
	}

	/**
	 * Render tradition selection with card-style UI
	 */
	_renderTraditionSelection (container, selectedTraditions, onChange) {
		container.innerHTML = "";
		Object.assign(container.style, {"display": "flex", "flex-wrap": "wrap", "gap": "0.4rem", "padding": "0.5rem", "background": "var(--rgb-bg-alt)", "border-radius": "4px"});

		const allTraditions = Object.entries(CharacterSheetClassUtils.TRADITION_CODE_TO_NAME)
			.map(([code, name]) => ({code, name}))
			.sort((a, b) => a.name.localeCompare(b.name));

		const tradIcons = this._getTraditionIcons();

		for (const trad of allTraditions) {
			const isSelected = selectedTraditions.includes(trad.code);
			const chip = e_({outer: `
				<label class="ve-flex ve-flex-v-center" style="
					cursor: pointer;
					padding: 0.25rem 0.5rem;
					border: 1px solid ${isSelected ? "var(--rgb-link)" : "var(--rgb-border-grey)"};
					border-radius: 4px;
					background: ${isSelected ? "rgba(51,122,183,0.15)" : "transparent"};
					font-size: 0.85rem;
					transition: all 0.15s;
				" data-trad="${trad.code}">
					<input type="checkbox" class="mr-1" style="margin: 0;" ${isSelected ? "checked" : ""}>
					<span>${tradIcons[trad.code] || "⚔️"}</span>
					<span class="ml-1">${trad.name}</span>
				</label>
			`});

			chip.querySelector("input")?.addEventListener("change", function () {
				const code = chip.dataset.trad;
				const checked = this.checked;

				if (checked && !selectedTraditions.includes(code)) {
					selectedTraditions.push(code);
				} else if (!checked) {
					const idx = selectedTraditions.indexOf(code);
					if (idx >= 0) selectedTraditions.splice(idx, 1);
				}

				Object.assign(chip.style, {
					"border-color": checked ? "var(--rgb-link)" : "var(--rgb-border-grey)",
					"background": checked ? "rgba(51,122,183,0.15)" : "transparent",
				});
				onChange();
			});

			container.append(chip);
		}
	}

	/**
	 * Get selected traditions from the UI checkboxes
	 */
	_getSelectedTraditionsFromUI (container) {
		const selected = [];
		container.querySelectorAll("input:checked").forEach((el) => {
			selected.push(el.closest("label")?.dataset.trad);
		});
		return selected;
	}

	/**
	 * Render the method list with filtering and hoverable names
	 */
	_renderMethodList (container, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad = "all", filterDegree = "all", filterStatus = "all", searchQuery = "") {
		container.innerHTML = "";

		// Filter methods
		let filteredMethods = allMethods.filter(method => {
			const tradCode = this._getMethodTraditionFromOptFeature(method);
			const key = `${method.name}|${method.source || ""}`;
			const isKnown = knownMethodNames.has(key);

			// Known methods should always appear (so they can be removed),
			// even if their tradition is no longer selected
			if (!isKnown && !selectedTraditions.includes(tradCode)) return false;

			// Tradition filter (if specific tradition selected in dropdown)
			if (filterTrad !== "all" && tradCode !== filterTrad) return false;

			// Must be within max degree (but known methods are exempt)
			const degree = this._getMethodDegreeFromOptFeature(method);
			if (!isKnown && degree > maxDegree) return false;

			// Search filter
			if (searchQuery && !method.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;

			// Degree filter
			if (filterDegree !== "all" && degree !== parseInt(filterDegree)) return false;

			// Status filter
			if (filterStatus === "known" && !isKnown) return false;
			if (filterStatus === "available" && isKnown) return false;

			return true;
		});

		if (selectedTraditions.length === 0) {
			container.insertAdjacentHTML("beforeend", `
				<div class="charsheet__method-picker-empty">
					<div class="charsheet__method-picker-empty-icon">📜</div>
					<p class="charsheet__method-picker-empty-text">Select at least one tradition to see available methods.</p>
				</div>
			`);
			return;
		}

		if (filteredMethods.length === 0) {
			container.insertAdjacentHTML("beforeend", `
				<div class="charsheet__method-picker-empty">
					<div class="charsheet__method-picker-empty-icon">🔍</div>
					<p class="charsheet__method-picker-empty-text">No methods match the current filters.</p>
				</div>
			`);
			return;
		}

		// Group by tradition and degree
		const methodsByTrad = new Map();
		for (const method of filteredMethods) {
			const tradCode = this._getMethodTraditionFromOptFeature(method);
			if (!methodsByTrad.has(tradCode)) {
				methodsByTrad.set(tradCode, []);
			}
			methodsByTrad.get(tradCode).push(method);
		}

		// Tradition icons mapping
		const tradIcons = {
			"AM": "🏔️",
			"AK": "✨",
			"BU": "🐺",
			"BZ": "💨",
			"CJ": "🎭",
			"EB": "🌑",
			"GH": "💖",
			"MG": "🪞",
			"MS": "🌫️",
			"RC": "🌊",
			"RE": "🗡️",
			"SK": "🩸",
			"SS": "🐎",
			"TI": "⚔️",
			"TC": "🦷",
			"UW": "☯️",
			"UH": "🦅",
		};

		// Get all tradition codes that have methods to show (selected + those with known methods)
		const traditionsToRender = new Set(selectedTraditions);
		for (const [tradCode] of methodsByTrad) {
			traditionsToRender.add(tradCode);
		}

		// Render grouped methods - selected traditions first, then others
		const sortedTraditions = [...traditionsToRender].sort((a, b) => {
			const aSelected = selectedTraditions.includes(a);
			const bSelected = selectedTraditions.includes(b);
			if (aSelected !== bSelected) return aSelected ? -1 : 1;
			return this._getTraditionName(a).localeCompare(this._getTraditionName(b));
		});

		for (const tradCode of sortedTraditions) {
			const methods = methodsByTrad.get(tradCode) || [];
			if (methods.length === 0) continue;

			const isSelectedTradition = selectedTraditions.includes(tradCode);
			const tradGroup = e_({outer: `
				<div class="charsheet__method-picker-trad-group ${!isSelectedTradition ? "charsheet__method-picker-trad-group--unselected" : ""}">
					<div class="charsheet__method-picker-trad-group-header">
						<span class="charsheet__method-picker-trad-group-icon">${tradIcons[tradCode] || "⚔️"}</span>
						<span class="charsheet__method-picker-trad-group-name">${this._getTraditionName(tradCode)}${!isSelectedTradition ? " (not selected)" : ""}</span>
						<span class="charsheet__method-picker-trad-group-count">${methods.length}</span>
					</div>
				</div>
			`});

			// Sort by degree then name
			methods.sort((a, b) => {
				const degA = this._getMethodDegreeFromOptFeature(a);
				const degB = this._getMethodDegreeFromOptFeature(b);
				return degA - degB || a.name.localeCompare(b.name);
			});

			for (const method of methods) {
				const key = `${method.name}|${method.source || ""}`;
				const isKnown = knownMethodNames.has(key);
				const degree = this._getMethodDegreeFromOptFeature(method);
				const cost = this._getMethodStaminaCostFromOptFeature(method);
				const activation = this._getMethodActivationTime(method);
				const isStance = this._isMethodStance(method);

				// Create hoverable method name link
				let methodNameHtml = `<span class="bold">${method.name}</span>`;
				try {
					if (this._page?.getHoverLink && method.source) {
						methodNameHtml = this._page.getHoverLink(UrlUtil.PG_COMBAT_METHODS, method.name, method.source);
					}
				} catch (e) {
					// Fall back to plain text
				}

				// Activation badge class
				const activationBadgeClass = {
					"A": "charsheet__method-badge--action",
					"BA": "charsheet__method-badge--bonus",
					"R": "charsheet__method-badge--reaction",
				};
				const actClass = activation ? activationBadgeClass[activation] : null;
				const activationLabels = {"A": "Action", "BA": "Bonus", "R": "React"};

				const methodEl = e_({outer: `
					<div class="charsheet__method-picker-item ${isKnown ? "charsheet__method-picker-item--known" : ""}">
						<div class="charsheet__method-picker-item-content">
							${isKnown ? "<span class=\"glyphicon glyphicon-ok charsheet__method-picker-item-known-icon\"></span>" : ""}
							<span class="charsheet__method-picker-item-name">${methodNameHtml}</span>
							<span class="charsheet__method-badge charsheet__method-badge--degree">${degree}${this._getOrdinalSuffix(degree)}</span>
							${actClass ? `<span class="charsheet__method-badge ${actClass}">${activationLabels[activation]}</span>` : ""}
							${cost > 0 ? `<span class="charsheet__method-badge charsheet__method-badge--ep">${cost} EP</span>` : ""}
							${isStance ? `<span class="charsheet__method-badge charsheet__method-badge--stance">Stance</span>` : ""}
						</div>
						<div class="charsheet__method-picker-item-actions">
							${isKnown
		? `<button class="charsheet__method-picker-btn charsheet__method-picker-btn--remove charsheet__method-remove" data-method-key="${key}">
									<span class="glyphicon glyphicon-minus"></span>
								</button>`
		: `<button class="charsheet__method-picker-btn charsheet__method-picker-btn--add charsheet__method-add" data-method-key="${key}">
									<span class="glyphicon glyphicon-plus"></span>
								</button>`
}
						</div>
					</div>
				`});

				// Store method data
				methodEl._methodData = method;

				// Event handlers
				methodEl.querySelector(".charsheet__method-add")?.addEventListener("click", (/** @type {*} */ e) => {
					e.stopPropagation();
					this._addCombatMethod(method);
					knownMethodNames.add(key);
					this._renderMethodList(container, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);
					// Update known count badge
					document.getElementById("method-picker-known-count").textContent = knownMethodNames.size;
				});

				methodEl.querySelector(".charsheet__method-remove")?.addEventListener("click", (/** @type {*} */ e) => {
					e.stopPropagation();
					this._removeCombatMethod(method);
					knownMethodNames.delete(key);
					this._renderMethodList(container, allMethods, selectedTraditions, maxDegree, knownMethodNames, filterTrad, filterDegree, filterStatus, searchQuery);
					// Update known count badge
					document.getElementById("method-picker-known-count").textContent = knownMethodNames.size;
				});

				tradGroup.append(methodEl);
			}

			container.append(tradGroup);
		}
	}

	/**
	 * Get character's selected combat traditions
	 */
	_getCharacterTraditions () {
		// Prefer canonical state traditions
		const stateTraditions = this._state.getCombatTraditions?.() || [];
		if (stateTraditions.length) return stateTraditions;

		// Infer from known combat methods
		const knownMethods = this._state.getFeatures().filter(f => CharacterSheetClassUtils.isCombatMethod(f));

		const traditions = new Set();
		for (const method of knownMethods) {
			const tradCode = CharacterSheetClassUtils.getMethodTraditionCode(method);
			if (tradCode) traditions.add(tradCode);
		}

		return Array.from(traditions);
	}

	/**
	 * Save selected traditions to character settings
	 */
	_saveSelectedTraditions (traditions) {
		this._state.setCombatTraditions?.(traditions);
	}

	/**
	 * Get max method degree based on character class level
	 */
	_getCharacterMaxDegree () {
		// Look for a class with Combat Methods progression
		const classes = this._state.getClasses();
		let maxDegree = 0;

		for (const cls of classes) {
			const classData = this._page.getClasses?.().find(c => c.name === cls.name && c.source === cls.source);
			if (!classData?.optionalfeatureProgression) continue;

			const cmProg = classData.optionalfeatureProgression.find(prog =>
				prog.featureType?.some(ft => ft.startsWith("CTM:")) || prog.name?.toLowerCase().includes("combat method"),
			);
			if (!cmProg) continue;

			// Get max degree at current level
			// Degrees are typically: 1st at 1-4, 2nd at 5-8, 3rd at 9-12, 4th at 13-16, 5th at 17+
			const level = cls.level || 1;
			let degree = 1;
			if (level >= 17) degree = 5;
			else if (level >= 13) degree = 4;
			else if (level >= 9) degree = 3;
			else if (level >= 5) degree = 2;

			maxDegree = Math.max(maxDegree, degree);
		}

		return maxDegree || 1; // Default to at least 1st degree
	}

	/**
	 * Add a combat method to the character
	 */
	_addCombatMethod (method) {
		const featureData = {
			name: method.name,
			source: method.source,
			featureType: "Optional Feature",
			optionalFeatureTypes: method.featureType,
			description: method.entries ? Renderer.get().render({entries: method.entries}) : "",
			entries: method.entries,
		};
		this._state.addFeature(featureData);
		JqueryUtil.doToast({type: "success", content: `Learned ${method.name}!`});
	}

	/**
	 * Remove a combat method from the character
	 */
	_removeCombatMethod (method) {
		this._state.removeFeature(method.name, method.source);
		JqueryUtil.doToast({type: "info", content: `Removed ${method.name}.`});
	}

	/**
	 * Get method tradition code from optional feature
	 */
	_getMethodTraditionFromOptFeature (method) {
		return CharacterSheetClassUtils.getMethodTraditionCode(method) || "Unknown";
	}

	_getMethodDegreeFromOptFeature (method) {
		return CharacterSheetClassUtils.getMethodDegree(method);
	}

	_getMethodStaminaCostFromOptFeature (method) {
		return CharacterSheetClassUtils.getMethodStaminaCost(method);
	}

	_getMethodActivationTime (method) {
		const actionType = CharacterSheetClassUtils.getMethodActionType(method);
		if (!actionType) return null;
		const lower = actionType.toLowerCase();
		if (lower.includes("reaction")) return "R";
		if (lower.includes("bonus")) return "BA";
		if (lower.includes("action")) return "A";
		return null;
	}

	_getMethodDegree (feature) {
		return CharacterSheetClassUtils.getMethodDegree(feature);
	}

	_getMethodTradition (feature) {
		return CharacterSheetClassUtils.getMethodTraditionCode(feature) || "Unknown";
	}

	_getTraditionName (tradCode) {
		return CharacterSheetClassUtils.getTraditionName(tradCode);
	}

	_getOrdinalSuffix (n) {
		const s = ["th", "st", "nd", "rd"];
		const v = n % 100;
		return s[(v - 20) % 10] || s[v] || s[0];
	}
	// #endregion

	// #region Metamagic Dashboard

	renderCombatMetamagic () {
		CharacterSheetCombat.renderMetamagicDashboard(this._state, this._page, "#charsheet-combat-metamagic", "#charsheet-combat-metamagic-section", "#charsheet-combat-metamagic-sp");
	}

	static renderMetamagicDashboard (state, page, containerSel, sectionSel, spBadgeSel) {
		const container = document.querySelector(containerSel);
		const section = document.querySelector(sectionSel);
		const spBadge = document.querySelector(spBadgeSel);
		if (!container) return;

		const calc = state.getFeatureCalculations();
		if (!calc.hasMetamagic) {
			section.style.display = "none";
			return;
		}

		const knownKeys = new Set(state.getKnownMetamagicKeys?.() || []);
		if (!knownKeys.size) {
			section.style.display = "none";
			return;
		}

		section.style.display = "";
		container.innerHTML = "";

		const sp = state.getSorceryPoints();

		// Update SP badge
		if (spBadge) {
			spBadge.textContent = `${sp.current}/${sp.max}`;
		}

		const passiveMetamagics = (state.getPassiveMetamagics?.() || [])
			.filter(meta => knownKeys.has(meta.key));
		const activeMetamagics = (state.getActiveMetamagics?.() || [])
			.filter(meta => knownKeys.has(meta.key));

		const renderCost = (cost) => {
			if (cost === "level") return "spell level SP";
			if (cost === "halfLevel") return "½ level SP";
			return `${cost} SP`;
		};

		// SP summary row
		const spRow = e_({outer: `
			<div class="charsheet__mm-sp-summary">
				<div class="charsheet__mm-sp-current">
					<span class="charsheet__mm-sp-label">Available</span>
					<span class="charsheet__mm-sp-value">${sp.current}</span>
					<span class="charsheet__mm-sp-max">/ ${sp.max}</span>
				</div>
			</div>
		`});
		container.append(spRow);

		// Tuned passives section
		const tunedPassives = passiveMetamagics.filter(m => m.tuned);
		const untunedPassives = passiveMetamagics.filter(m => !m.tuned);

		if (tunedPassives.length) {
			const tunedHeader = e_({outer: `<div class="charsheet__mm-group-label">Tuned Passives</div>`});
			container.append(tunedHeader);

			for (const meta of tunedPassives) {
				const row = e_({outer: `
					<div class="charsheet__mm-row charsheet__mm-row--tuned">
						<span class="charsheet__mm-indicator charsheet__mm-indicator--active">●</span>
						<div class="charsheet__mm-info">
							<span class="charsheet__mm-name">${meta.name}</span>
							<span class="charsheet__mm-cost">${renderCost(meta.cost)}</span>
						</div>
						<span class="charsheet__mm-desc">${meta.description}</span>
						<button class="ve-btn ve-btn-xs ve-btn-outline-danger charsheet__mm-tune-btn" data-metamagic-key="${meta.key}">Detune</button>
					</div>
				`});
				container.append(row);
			}
		}

		// Available passives section
		if (untunedPassives.length) {
			const untunedHeader = e_({outer: `<div class="charsheet__mm-group-label">Available Passives</div>`});
			container.append(untunedHeader);

			for (const meta of untunedPassives) {
				const canAfford = typeof meta.cost === "number" && sp.max >= meta.cost && sp.current >= meta.cost;
				const row = e_({outer: `
					<div class="charsheet__mm-row charsheet__mm-row--available">
						<span class="charsheet__mm-indicator">○</span>
						<div class="charsheet__mm-info">
							<span class="charsheet__mm-name">${meta.name}</span>
							<span class="charsheet__mm-cost">${renderCost(meta.cost)}</span>
						</div>
						<span class="charsheet__mm-desc">${meta.description}</span>
						<button class="ve-btn ve-btn-xs ve-btn-outline-success charsheet__mm-tune-btn" data-metamagic-key="${meta.key}" ${!canAfford ? `disabled title="Not enough effective sorcery points"` : ""}>Tune</button>
					</div>
				`});
				container.append(row);
			}
		}

		// Active metamagics section (info-only)
		if (activeMetamagics.length) {
			const activeHeader = e_({outer: `<div class="charsheet__mm-group-label">Active <span class="ve-muted ve-small">(at cast time)</span></div>`});
			container.append(activeHeader);

			for (const meta of activeMetamagics) {
				const row = e_({outer: `
					<div class="charsheet__mm-row charsheet__mm-row--active-info">
						<span class="charsheet__mm-indicator charsheet__mm-indicator--cast">◆</span>
						<div class="charsheet__mm-info">
							<span class="charsheet__mm-name">${meta.name}</span>
							<span class="charsheet__mm-cost">${renderCost(meta.cost)}</span>
						</div>
						<span class="charsheet__mm-desc">${meta.description}</span>
					</div>
				`});
				container.append(row);
			}
		}

		// Bind tune/detune buttons
		container.querySelectorAll(".charsheet__mm-tune-btn").forEach((btn) => {
			btn.addEventListener("click", () => {
				const key = btn.dataset.metamagicKey;
				if (state.isMetamagicTuned?.(key)) {
					state.detuneMetamagic(key);
				} else {
					if (!state.tuneMetamagic(key)) {
						JqueryUtil.doToast({type: "warning", content: "Not enough sorcery points to tune this metamagic."});
						return;
					}
				}
				page.saveCharacter?.();
				// Re-render all metamagic dashboards
				CharacterSheetCombat.renderMetamagicDashboard(state, page, containerSel, sectionSel, spBadgeSel);
				// Also refresh the other tab's dashboard
				CharacterSheetCombat.renderMetamagicDashboard(
					state, page,
					containerSel === "#charsheet-combat-metamagic" ? "#charsheet-overview-metamagic" : "#charsheet-combat-metamagic",
					containerSel === "#charsheet-combat-metamagic" ? "#charsheet-overview-metamagic-section" : "#charsheet-combat-metamagic-section",
					containerSel === "#charsheet-combat-metamagic" ? "#charsheet-overview-metamagic-sp" : "#charsheet-combat-metamagic-sp",
				);
				// Refresh resources section so SP counter stays in sync
				if (typeof page._renderResources === "function") page._renderResources();
				// Refresh spell list so metamagic modifications are reflected
				if (page._spells && typeof page._spells._renderSpellList === "function") page._spells._renderSpellList();
				// Refresh combat spells tab so metamagic modifications are reflected
				if (page._combat && typeof page._combat.renderCombatSpells === "function") page._combat.renderCombatSpells();
			});
		});
	}

	// #endregion
}

globalThis.CharacterSheetCombat = CharacterSheetCombat;

export {CharacterSheetCombat};
