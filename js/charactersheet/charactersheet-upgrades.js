/**
 * Character Sheet Upgrades Module
 * Handles item upgrade application, gemstone empowerment, socketing, and mechanical effects
 */
class CharacterSheetUpgrades {
	constructor (page) {
		this._page = page;
		this._state = page.getState();
		this._allUpgrades = [];
	}

	setUpgrades (upgrades) {
		this._allUpgrades = upgrades;
	}

	// ==========================================
	// Upgrade Type Helpers
	// ==========================================

	/**
	 * Check if an item is eligible for weapon upgrades
	 * @param {object} item - Inventory item data
	 * @returns {boolean}
	 */
	static isWeapon (item) {
		return !!(item.weapon || item.type === "M" || item.type === "R");
	}

	/**
	 * Check if an item is eligible for armor upgrades
	 * @param {object} item - Inventory item data
	 * @returns {boolean}
	 */
	static isArmor (item) {
		return !!(item.armor || item.type === "LA" || item.type === "MA" || item.type === "HA");
	}

	/**
	 * Check if an item is a shield
	 * @param {object} item - Inventory item data
	 * @returns {boolean}
	 */
	static isShield (item) {
		return !!(item.shield || item.type === "S");
	}

	/**
	 * Check if an item is eligible for gemstone socketing (weapon, armor, or shield)
	 * @param {object} item - Inventory item data
	 * @returns {boolean}
	 */
	static isSocketable (item) {
		return CharacterSheetUpgrades.isWeapon(item) || CharacterSheetUpgrades.isArmor(item) || CharacterSheetUpgrades.isShield(item);
	}

	/**
	 * Get all upgrades applicable to an item, filtering by type and prerequisites
	 * @param {object} item - The inventory item
	 * @returns {Array} Filtered upgrade entities
	 */
	getEligibleUpgrades (item) {
		const upgrades = this._page.getItemUpgrades?.() || this._allUpgrades;
		if (!upgrades?.length) return [];

		const isWeapon = CharacterSheetUpgrades.isWeapon(item);
		const isArmor = CharacterSheetUpgrades.isArmor(item);
		const isShield = CharacterSheetUpgrades.isShield(item);
		const appliedNames = (item.appliedUpgrades || []).map(u => u.name.toLowerCase());

		return upgrades.filter(upgrade => {
			// Skip gemstones (those go through the empowerment flow)
			const uType = upgrade.upgradeType?.[0] || "";
			if (uType.startsWith("GS:")) return false;

			// Already applied?
			if (appliedNames.includes(upgrade.name.toLowerCase())) return false;

			// Type matching
			if (uType.startsWith("WU") && !isWeapon) return false;
			if (uType === "AU" && !isArmor && !isShield) return false;

			return true;
		});
	}

	/**
	 * Get all gemstone upgrade entities (not empowered — these are the power definitions)
	 * @returns {Array}
	 */
	getGemstoneUpgrades () {
		const upgrades = this._page.getItemUpgrades?.() || this._allUpgrades;
		return upgrades.filter(u => (u.upgradeType?.[0] || "").startsWith("GS:"));
	}

	/**
	 * Parse gold cost from a cost string like "100 gp (base)" or "1,000 gp"
	 * @param {string} costStr - The cost string
	 * @returns {number} Gold cost in gp
	 */
	static parseGoldCost (costStr) {
		if (!costStr) return 0;
		const match = costStr.replace(/,/g, "").match(/([\d.]+)\s*gp/i);
		return match ? parseFloat(match[1]) : 0;
	}

	/**
	 * Get the tier label for an upgrade type code
	 * @param {string} upgradeType - e.g. "WU:1", "AU", "GS:C"
	 * @returns {string}
	 */
	static getUpgradeTierLabel (upgradeType) {
		const labels = {
			"WU:1": "1st Tier Weapon",
			"WU:2": "2nd Tier Weapon",
			"WU:3": "3rd Tier Weapon",
			"AU": "Armor",
			"GS:C": "Common Gemstone",
			"GS:U": "Uncommon Gemstone",
			"GS:R": "Rare Gemstone",
			"GS:VR": "Very Rare Gemstone",
			"GS:L": "Legendary Gemstone",
		};
		return labels[upgradeType] || upgradeType;
	}

	/**
	 * Get the tier color class for an upgrade type
	 * @param {string} upgradeType
	 * @returns {string}
	 */
	static getUpgradeTierColor (upgradeType) {
		if (upgradeType?.startsWith("WU:1")) return "badge-info";
		if (upgradeType?.startsWith("WU:2")) return "badge-primary";
		if (upgradeType?.startsWith("WU:3")) return "badge-warning";
		if (upgradeType === "AU") return "badge-secondary";
		if (upgradeType?.startsWith("GS:")) return "badge-success";
		return "badge-default";
	}

	// ==========================================
	// Upgrade Picker Modal
	// ==========================================

	/**
	 * Show the upgrade picker modal for an item
	 * @param {string} itemId - The item ID
	 */
	async showUpgradePickerModal (itemId) {
		const items = this._state.getItems();
		const item = items.find(i => i.id === itemId);
		if (!item) return;

		const eligibleUpgrades = this.getEligibleUpgrades(item);
		const currentUpgrades = this._state.getItemUpgrades(itemId);
		const totalGold = this._state.getTotalGold();

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Upgrade: ${item.name}`,
			isMinHeight0: true,
			isWidth100: true,
		});

		const content = e_({outer: `<div class="charsheet__upgrade-modal"></div>`});

		// Current upgrades section
		if (currentUpgrades.length) {
			const currentSection = e_({outer: `<div class="charsheet__upgrade-current mb-3"></div>`});
			currentSection.append(e_({outer: `<h5>Applied Upgrades</h5>`}));
			for (const upgrade of currentUpgrades) {
				const tierLabel = CharacterSheetUpgrades.getUpgradeTierLabel(upgrade.upgradeType);
				const tierColor = CharacterSheetUpgrades.getUpgradeTierColor(upgrade.upgradeType);
				currentSection.append(e_({outer: `
					<div class="charsheet__upgrade-applied ve-flex-v-center mb-1 p-1 stripe-even">
						<div class="ve-flex-1">
							<span class="badge ${tierColor} ve-small mr-1">${tierLabel}</span>
							<strong>${upgrade.name}</strong>
							${upgrade.costPaid ? `<span class="ve-muted ve-small ml-1">(${upgrade.costPaid} gp)</span>` : ""}
						</div>
						<button type="button" class="ve-btn ve-btn-xs ve-btn-danger charsheet__upgrade-remove" data-upgrade-name="${upgrade.name}" data-upgrade-source="${upgrade.source}" title="Remove upgrade">
							<span class="glyphicon glyphicon-trash"></span>
						</button>
					</div>
				`}));
			}
			content.append(currentSection);
		}

		// Socketed gemstones section
		const gemstones = this._state.getSocketedGemstones(itemId);
		if (gemstones.length) {
			const gemSection = e_({outer: `<div class="charsheet__upgrade-gems mb-3"></div>`});
			gemSection.append(e_({outer: `<h5>Socketed Gemstones</h5>`}));
			for (const gem of gemstones) {
				const tierLabel = CharacterSheetUpgrades.getUpgradeTierLabel(gem.upgradeType);
				const chargeStr = gem.chargesMax != null ? ` (${gem.chargesCurrent}/${gem.chargesMax} charges)` : "";
				gemSection.append(e_({outer: `
					<div class="charsheet__upgrade-gem ve-flex-v-center mb-1 p-1 stripe-even">
						<div class="ve-flex-1">
							<span class="badge badge-success ve-small mr-1">${gem.gemName || tierLabel}</span>
							<strong>${gem.name}</strong>
							<span class="ve-muted ve-small">${chargeStr}</span>
						</div>
						<button type="button" class="ve-btn ve-btn-xs ve-btn-warning charsheet__gem-unsocket" data-gem-name="${gem.name}" title="Unsocket gemstone">
							<span class="glyphicon glyphicon-eject"></span>
						</button>
					</div>
				`}));
			}
			content.append(gemSection);
		}

		// Available upgrades section
		if (eligibleUpgrades.length) {
			const availSection = e_({outer: `<div class="charsheet__upgrade-available mb-3"></div>`});
			availSection.append(e_({outer: `<h5>Available Upgrades</h5>`}));
			availSection.append(e_({outer: `<p class="ve-small ve-muted">Gold available: <strong>${totalGold.toFixed(1)} gp</strong></p>`}));

			// Group by tier
			const grouped = {};
			for (const upgrade of eligibleUpgrades) {
				const tier = upgrade.upgradeType?.[0] || "Other";
				if (!grouped[tier]) grouped[tier] = [];
				grouped[tier].push(upgrade);
			}

			for (const [tier, upgrades] of Object.entries(grouped)) {
				const tierLabel = CharacterSheetUpgrades.getUpgradeTierLabel(tier);
				const tierColor = CharacterSheetUpgrades.getUpgradeTierColor(tier);
				availSection.append(e_({outer: `<div class="ve-small ve-bold mt-2 mb-1"><span class="badge ${tierColor}">${tierLabel}</span></div>`}));

				for (const upgrade of upgrades) {
					const gpCost = CharacterSheetUpgrades.parseGoldCost(upgrade.cost);
					const canAfford = totalGold >= gpCost;
					const prereqText = upgrade.prerequisite?.[0]?.item?.join("; ") || "None";
					const entrySummary = (upgrade.entries || []).join(" ");
					const entryTrimmed = entrySummary.length > 120 ? entrySummary.substring(0, 120) + "..." : entrySummary;
					const btnAttr = !canAfford ? 'disabled title="Insufficient gold"' : "title=\"Apply for " + gpCost + " gp\"";

					const row = e_({outer: `
						<div class="charsheet__upgrade-option ve-flex-v-center mb-1 p-2 stripe-even">
							<div class="ve-flex-1">
								<strong>${upgrade.name}</strong>
								<span class="ve-muted ve-small ml-1">${upgrade.cost || "Free"}</span>
								<div class="ve-small ve-muted">${prereqText}</div>
								<div class="ve-small">${entryTrimmed}</div>
							</div>
							<button type="button"
								class="ve-btn ve-btn-xs ${canAfford ? "ve-btn-primary" : "ve-btn-default"} charsheet__upgrade-apply"
								data-upgrade-name="${upgrade.name}"
								data-upgrade-source="${upgrade.source}"
								data-upgrade-cost="${gpCost}"
								${btnAttr}>
								<span class="glyphicon glyphicon-plus"></span> Apply
							</button>
						</div>
					`});
					availSection.append(row);
				}
			}
			content.append(availSection);
		} else if (!currentUpgrades.length) {
			content.append(e_({outer: `<p class="ve-muted">No upgrades available for this item type.</p>`}));
		}

		// Socket gemstone button (if item is socketable and has room)
		if (CharacterSheetUpgrades.isSocketable(item) && gemstones.length < 1) {
			const socketSection = e_({outer: `<div class="charsheet__upgrade-socket mt-3"></div>`});
			socketSection.append(e_({outer: `
				<button type="button" class="ve-btn ve-btn-sm ve-btn-success charsheet__gem-socket-btn">
					<span class="glyphicon glyphicon-plus-sign"></span> Socket Gemstone
				</button>
			`}));
			content.append(socketSection);
		}

		modalInner.append(content);

		// Footer
		const footer = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default">Close</button>
		</div>`;
		modalInner.append(footer);
		footer.querySelector("button").addEventListener("click", () => doClose(false));

		// Event delegation for the modal
		content.addEventListener("click", async (e) => {
			// Apply upgrade
			const applyBtn = e.target.closest(".charsheet__upgrade-apply");
			if (applyBtn) {
				const name = applyBtn.dataset.upgradeName;
				const source = applyBtn.dataset.upgradeSource;
				const cost = parseFloat(applyBtn.dataset.upgradeCost);
				const upgrade = (this._page.getItemUpgrades?.() || this._allUpgrades).find(
					u => u.name === name && u.source === source,
				);
				if (!upgrade) return;

				// Deduct gold
				if (cost > 0) {
					const result = this._state.deductGold(cost);
					if (!result.success) {
						JqueryUtil.doToast({content: result.error, type: "danger"});
						return;
					}
				}

				// Apply upgrade
				const result = this._state.applyItemUpgrade(itemId, upgrade, cost);
				if (!result.success) {
					JqueryUtil.doToast({content: result.error, type: "danger"});
					return;
				}

				JqueryUtil.doToast({content: `Applied "${upgrade.name}" to ${item.name} for ${cost} gp`, type: "success"});
				this._page.saveCharacter();
				doClose(true);
				this._page._inventory?.render();
				return;
			}

			// Remove upgrade
			const removeBtn = e.target.closest(".charsheet__upgrade-remove");
			if (removeBtn) {
				const name = removeBtn.dataset.upgradeName;
				const source = removeBtn.dataset.upgradeSource;
				this._state.removeItemUpgrade(itemId, name, source);
				JqueryUtil.doToast({content: `Removed "${name}" from ${item.name}`, type: "info"});
				this._page.saveCharacter();
				doClose(true);
				this._page._inventory?.render();
				return;
			}

			// Unsocket gemstone
			const unsocketBtn = e.target.closest(".charsheet__gem-unsocket");
			if (unsocketBtn) {
				const gemName = unsocketBtn.dataset.gemName;
				const removed = this._state.unsocketGemstone(itemId, gemName);
				if (removed) {
					JqueryUtil.doToast({content: `Unsocketed "${gemName}" from ${item.name}`, type: "info"});
					this._page.saveCharacter();
					doClose(true);
					this._page._inventory?.render();
				}
				return;
			}

			// Socket gemstone button
			if (e.target.closest(".charsheet__gem-socket-btn")) {
				doClose(false);
				await this.showGemstoneSocketModal(itemId);
				return;
			}
		});
	}

	// ==========================================
	// Gemstone Empowerment Modal
	// ==========================================

	/**
	 * Show the gemstone empowerment modal
	 */
	async showEmpowermentModal () {
		const gemstones = this.getGemstoneUpgrades();
		if (!gemstones.length) {
			JqueryUtil.doToast({content: "No gemstone data loaded. Check if Thelemar homebrew is enabled.", type: "warning"});
			return;
		}

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: "Gemstone Empowerment",
			isMinHeight0: true,
			isWidth100: true,
		});

		const content = e_({outer: `<div class="charsheet__empower-modal"></div>`});

		// Instructions
		content.append(e_({outer: `
			<div class="charsheet__empower-rules mb-3 p-2" style="background: var(--rgb-bg-secondary, #f5f5f5); border-radius: 4px;">
				<p class="ve-small mb-1"><strong>Gemstone Empowerment:</strong> Choose a gemstone power to imbue. You must succeed on a crafting check to empower the gem.</p>
				<p class="ve-small mb-0"><strong>Crafting Check:</strong> Proficiency bonus + CHA or WIS modifier vs. the gemstone's crafting DC.</p>
			</div>
		`}));

		// Group gemstones by rarity
		const grouped = {};
		for (const gem of gemstones) {
			const rarity = gem.rarity || "Unknown";
			if (!grouped[rarity]) grouped[rarity] = [];
			grouped[rarity].push(gem);
		}

		const rarityOrder = ["common", "uncommon", "rare", "very rare", "legendary"];
		const rarityDCs = {"common": 10, "uncommon": 15, "rare": 20, "very rare": 25, "legendary": 30};

		for (const rarity of rarityOrder) {
			const gems = grouped[rarity];
			if (!gems?.length) continue;

			const dc = rarityDCs[rarity] || "?";
			const tierLabel = CharacterSheetUpgrades.getUpgradeTierLabel(
				gems[0].upgradeType?.[0] || "",
			);

			const section = e_({outer: `<div class="charsheet__empower-rarity mb-3"></div>`});
			section.append(e_({outer: `
				<div class="ve-bold mb-1">
					<span class="badge badge-success">${rarity.toTitleCase()}</span>
					<span class="ve-muted ve-small ml-1">DC ${dc}</span>
				</div>
			`}));

			for (const gem of gems) {
				const costGp = CharacterSheetUpgrades.parseGoldCost(gem.cost);
				const canAfford = this._state.getTotalGold() >= costGp;
				const entrySummary = (gem.entries || []).join(" ").substring(0, 150);

				section.append(e_({outer: `
					<div class="charsheet__empower-option ve-flex-v-center mb-1 p-2 stripe-even">
						<div class="ve-flex-1">
							<strong>${gem.name}</strong>
							${gem.gemName ? `<span class="ve-muted ve-small ml-1">(${gem.gemName})</span>` : ""}
							<span class="ve-muted ve-small ml-1">${gem.cost || "Free"}</span>
							${gem.charges ? `<span class="badge badge-info ve-small ml-1">${gem.charges} charges</span>` : ""}
							<div class="ve-small">${entrySummary}${entrySummary.length >= 150 ? "..." : ""}</div>
						</div>
						<button type="button"
							class="ve-btn ve-btn-xs ${canAfford ? "ve-btn-success" : "ve-btn-default"} charsheet__empower-select"
							data-gem-name="${gem.name}"
							data-gem-source="${gem.source}"
							data-gem-dc="${gem.craftingDC || dc}"
							data-gem-cost="${costGp}"
							${!canAfford ? "disabled title=\"Insufficient gold\"" : `title="Empower for ${costGp} gp"`}>
							<span class="glyphicon glyphicon-flash"></span> Empower
						</button>
					</div>
				`}));
			}
			content.append(section);
		}

		modalInner.append(content);

		// Footer
		const footer = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default">Close</button>
		</div>`;
		modalInner.append(footer);
		footer.querySelector("button").addEventListener("click", () => doClose(false));

		// Event delegation
		content.addEventListener("click", async (e) => {
			const empowerBtn = e.target.closest(".charsheet__empower-select");
			if (!empowerBtn) return;

			const gemName = empowerBtn.dataset.gemName;
			const gemSource = empowerBtn.dataset.gemSource;
			const dc = parseInt(empowerBtn.dataset.gemDc);
			const costGp = parseFloat(empowerBtn.dataset.gemCost);

			doClose(false);
			await this._showCraftingRollModal(gemName, gemSource, dc, costGp);
		});
	}

	/**
	 * Show the crafting roll modal for empowerment
	 * @param {string} gemName - Gemstone power name
	 * @param {string} gemSource - Gemstone source
	 * @param {number} dc - Crafting DC
	 * @param {number} costGp - Gold cost
	 */
	async _showCraftingRollModal (gemName, gemSource, dc, costGp) {
		const profBonus = this._state.getProficiencyBonus();
		const chaMod = this._state.getAbilityMod("cha");
		const wisMod = this._state.getAbilityMod("wis");
		const bestMod = Math.max(chaMod, wisMod);
		const bestAbility = chaMod >= wisMod ? "CHA" : "WIS";
		const totalBonus = profBonus + bestMod;

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Empower: ${gemName}`,
			isMinHeight0: true,
		});

		const content = e_({outer: `<div class="charsheet__empower-roll p-2"></div>`});

		content.append(e_({outer: `
			<div class="mb-3">
				<p><strong>Crafting Check</strong></p>
				<p class="ve-small">
					Proficiency (+${profBonus}) + ${bestAbility} (+${bestMod}) = <strong>+${totalBonus}</strong> vs DC <strong>${dc}</strong>
				</p>
				<p class="ve-small ve-muted">Cost: ${costGp} gp (paid on success)</p>
			</div>
			<div class="ve-flex-v-center ve-flex-h-center mb-3">
				<button type="button" class="ve-btn ve-btn-lg ve-btn-success charsheet__empower-roll-btn">
					<span class="glyphicon glyphicon-random"></span> Roll Crafting Check
				</button>
			</div>
			<div class="charsheet__empower-result" style="display: none;"></div>
		`}));

		modalInner.append(content);

		const rollBtn = content.querySelector(".charsheet__empower-roll-btn");
		const resultDiv = content.querySelector(".charsheet__empower-result");

		rollBtn.addEventListener("click", () => {
			const roll = Math.floor(Math.random() * 20) + 1;
			const total = roll + totalBonus;
			const success = total >= dc;
			const nat20 = roll === 20;
			const nat1 = roll === 1;

			rollBtn.style.display = "none";

			if (nat20 || (success && !nat1)) {
				// Deduct gold on success
				if (costGp > 0) {
					const goldResult = this._state.deductGold(costGp);
					if (!goldResult.success) {
						resultDiv.style.display = "";
						resultDiv.innerHTML = `
							<div class="alert alert-danger">
								<strong>Roll: ${roll} + ${totalBonus} = ${total} vs DC ${dc} — Success!</strong>
								<p>But you can't afford the ${costGp} gp cost.</p>
							</div>
						`;
						return;
					}
				}

				// Find the gemstone entity and add to inventory
				const gemEntity = this.getGemstoneUpgrades().find(
					g => g.name === gemName && g.source === gemSource,
				);

				if (gemEntity) {
					// Add empowered gemstone to inventory
					this._state.addItem({
						name: `${gemName} (Empowered ${gemEntity.gemName || "Gemstone"})`,
						source: gemSource,
						type: "G",
						rarity: gemEntity.rarity || "common",
						entries: gemEntity.entries || [],
						weight: 0,
						_isEmpoweredGemstone: true,
						_gemstoneData: {
							name: gemEntity.name,
							source: gemEntity.source,
							gemName: gemEntity.gemName,
							rarity: gemEntity.rarity,
							upgradeType: gemEntity.upgradeType,
							entries: gemEntity.entries,
							charges: gemEntity.charges || null,
							recharge: gemEntity.recharge || null,
						},
					});
				}

				resultDiv.style.display = "";
				resultDiv.innerHTML = `
					<div class="alert alert-success">
						<strong>${nat20 ? "🎯 Natural 20! " : ""}Roll: ${roll} + ${totalBonus} = ${total} vs DC ${dc} — Success!</strong>
						<p>The gemstone has been empowered and added to your inventory. You can now socket it into a weapon, armor, or shield.</p>
						${costGp > 0 ? `<p class="ve-muted ve-small">Paid ${costGp} gp</p>` : ""}
					</div>
				`;

				JqueryUtil.doToast({content: `Empowered ${gemName}! Added to inventory.`, type: "success"});
				this._page.saveCharacter();
				this._page._inventory?.render();
			} else {
				resultDiv.style.display = "";
				resultDiv.innerHTML = `
					<div class="alert alert-danger">
						<strong>${nat1 ? "💥 Natural 1! " : ""}Roll: ${roll} + ${totalBonus} = ${total} vs DC ${dc} — Failed!</strong>
						<p>The empowerment fails. The gemstone is muted and cannot hold the power.</p>
					</div>
				`;
			}

			// Add close button
			const closeBtn = e_({outer: `<div class="ve-flex-v-center ve-flex-h-right mt-3"><button class="ve-btn ve-btn-default">Close</button></div>`});
			resultDiv.append(closeBtn);
			closeBtn.querySelector("button").addEventListener("click", () => doClose(false));
		});
	}

	// ==========================================
	// Gemstone Socket Modal
	// ==========================================

	/**
	 * Show the gemstone socket picker for an item
	 * @param {string} itemId - The target item ID
	 */
	async showGemstoneSocketModal (itemId) {
		const items = this._state.getItems();
		const item = items.find(i => i.id === itemId);
		if (!item) return;

		// Find empowered gemstones in inventory
		const empoweredGems = items.filter(i =>
			i._isEmpoweredGemstone && i._gemstoneData,
		);

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Socket Gemstone: ${item.name}`,
			isMinHeight0: true,
			isWidth100: true,
		});

		const content = e_({outer: `<div class="charsheet__socket-modal"></div>`});

		if (!empoweredGems.length) {
			content.append(e_({outer: `
				<p class="ve-muted">You don't have any empowered gemstones in your inventory. Use the "Empower Gemstone" action to create one first.</p>
			`}));
		} else {
			content.append(e_({outer: `<h5>Available Empowered Gemstones</h5>`}));

			for (const gem of empoweredGems) {
				const gemData = gem._gemstoneData;
				const chargeStr = gemData.charges ? `${gemData.charges} charges` : "";
				const entrySummary = (gemData.entries || []).join(" ").substring(0, 120);

				content.append(e_({outer: `
					<div class="charsheet__socket-option ve-flex-v-center mb-1 p-2 stripe-even">
						<div class="ve-flex-1">
							<strong>${gem.name}</strong>
							${chargeStr ? `<span class="badge badge-info ve-small ml-1">${chargeStr}</span>` : ""}
							<div class="ve-small">${entrySummary}${entrySummary.length >= 120 ? "..." : ""}</div>
						</div>
						<button type="button" class="ve-btn ve-btn-xs ve-btn-success charsheet__socket-apply"
							data-gem-id="${gem.id}" title="Socket into ${item.name}">
							<span class="glyphicon glyphicon-log-in"></span> Socket
						</button>
					</div>
				`}));
			}
		}

		modalInner.append(content);

		// Footer
		const footer = ee`<div class="ve-flex-v-center ve-flex-h-right mt-3">
			<button class="ve-btn ve-btn-default">Close</button>
		</div>`;
		modalInner.append(footer);
		footer.querySelector("button").addEventListener("click", () => doClose(false));

		// Event delegation
		content.addEventListener("click", (e) => {
			const socketBtn = e.target.closest(".charsheet__socket-apply");
			if (!socketBtn) return;

			const gemId = socketBtn.dataset.gemId;
			const gem = items.find(i => i.id === gemId);
			if (!gem?._gemstoneData) return;

			const result = this._state.socketGemstone(itemId, gem._gemstoneData);
			if (!result.success) {
				JqueryUtil.doToast({content: result.error, type: "danger"});
				return;
			}

			// Remove the empowered gemstone from inventory
			this._state.removeItem(gemId);

			JqueryUtil.doToast({content: `Socketed "${gem.name}" into ${item.name}`, type: "success"});
			this._page.saveCharacter();
			doClose(true);
			this._page._inventory?.render();
		});
	}

	// ==========================================
	// Mechanical Effect Application
	// ==========================================

	/**
	 * Get armor-specific upgrade effects (flags for passive/reference effects)
	 * @param {object} item - Armor item data (with appliedUpgrades array)
	 * @returns {object} Flags for each armor upgrade type
	 */
	static getArmorUpgradeEffects (item) {
		const effects = {
			muffled: false,
			reinforced: false,
			armorProofingTier: 0,
			spiked: false,
			breathable: false,
			insulated: false,
			climbingHarness: false,
			lockingJoints: false,
			quickRelease: false,
			decorated: false,
			runic: false,
			burnished: false,
		};

		if (!item?.appliedUpgrades?.length) return effects;

		for (const upgrade of item.appliedUpgrades) {
			const name = upgrade.name.toLowerCase();

			if (name === "muffled") effects.muffled = true;
			else if (name === "reinforced") effects.reinforced = true;
			else if (name === "spiked") effects.spiked = true;
			else if (name === "breathable") effects.breathable = true;
			else if (name === "insulated") effects.insulated = true;
			else if (name === "climbing harness") effects.climbingHarness = true;
			else if (name === "locking joints") effects.lockingJoints = true;
			else if (name === "quick-release clasps") effects.quickRelease = true;
			else if (name === "decorated") effects.decorated = true;
			else if (name === "runic") effects.runic = true;
			else if (name === "burnished") effects.burnished = true;
			else if (name.startsWith("armor proofing")) {
				const tierMatch = name.match(/(\d)(?:st|nd|rd)/);
				if (tierMatch) effects.armorProofingTier = Math.max(effects.armorProofingTier, parseInt(tierMatch[1]));
			}
		}

		return effects;
	}

	/**
	 * Get the total bonus adjustments from applied upgrades on an item
	 * @param {object} item - Inventory item data (with appliedUpgrades array)
	 * @returns {object} Bonus adjustments {bonusWeaponAttack, bonusWeaponDamage, critThreshold, bonusSpellAttack, bonusSpellSaveDc, damageDieIncrease}
	 */
	static getUpgradeEffects (item) {
		const effects = {
			bonusWeaponAttack: 0,
			bonusWeaponDamage: 0,
			critThresholdReduction: 0,
			bonusSpellAttack: 0,
			bonusSpellSaveDc: 0,
			damageDieIncrease: 0,
		};

		if (!item?.appliedUpgrades?.length) return effects;

		for (const upgrade of item.appliedUpgrades) {
			const name = upgrade.name.toLowerCase();

			// Balanced: +1 attack
			if (name === "balanced") {
				effects.bonusWeaponAttack += 1;
			}

			// Wounding (Keen or Oiled String): +1 damage
			if (name.startsWith("wounding:")) {
				effects.bonusWeaponDamage += 1;
			}

			// Critical upgrades: lower crit threshold by 1
			if (name.startsWith("critical:")) {
				effects.critThresholdReduction += 1;
			}

			// Superior: damage die increase
			if (name === "superior") {
				effects.damageDieIncrease += 1;
			}

			// Masterwork: +1/+1 attack and damage
			if (name === "masterwork") {
				effects.bonusWeaponAttack += 1;
				effects.bonusWeaponDamage += 1;
			}

			// Enchanted: +1 spell attack
			if (name === "enchanted") {
				effects.bonusSpellAttack += 1;
			}

			// Arcane: +1 spell save DC
			if (name === "arcane") {
				effects.bonusSpellSaveDc += 1;
			}
		}

		return effects;
	}

	/**
	 * Get all socketed gemstone effects on an item
	 * @param {object} item - Inventory item with socketedGemstones
	 * @returns {Array} Array of effect description objects
	 */
	static getGemstoneEffects (item) {
		if (!item?.socketedGemstones?.length) return [];
		return item.socketedGemstones.map(gem => ({
			name: gem.name,
			gemName: gem.gemName,
			entries: gem.entries || [],
			charges: gem.chargesMax,
			chargesCurrent: gem.chargesCurrent,
			recharge: gem.recharge,
		}));
	}

	/**
	 * Increase a damage die by one step (e.g., "1d6" -> "1d8")
	 * @param {string} damageDie - e.g. "1d6", "2d6", "1d10"
	 * @param {number} steps - Number of steps to increase
	 * @returns {string} The increased die string
	 */
	static increaseDamageDie (damageDie, steps = 1) {
		if (!damageDie) return damageDie;
		const dieOrder = [4, 6, 8, 10, 12];
		const match = damageDie.match(/(\d+)d(\d+)/);
		if (!match) return damageDie;

		const numDice = parseInt(match[1]);
		let dieSize = parseInt(match[2]);
		const idx = dieOrder.indexOf(dieSize);
		if (idx === -1) return damageDie;

		const newIdx = Math.min(idx + steps, dieOrder.length - 1);
		return `${numDice}d${dieOrder[newIdx]}`;
	}
}

globalThis.CharacterSheetUpgrades = CharacterSheetUpgrades;
export {CharacterSheetUpgrades};
