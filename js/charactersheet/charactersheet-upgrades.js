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
	 * Parse gold cost from either a free-form string ("100 gp (base)", "1,000 gp")
	 * or a structured cost object ({gp, isBase?, note?}).
	 * @param {string|object} cost - The cost value from the upgrade entity
	 * @returns {number} Gold cost in gp
	 */
	static parseGoldCost (cost) {
		if (cost == null) return 0;
		if (typeof cost === "object") {
			return typeof cost.gp === "number" && cost.gp >= 0 ? cost.gp : 0;
		}
		if (typeof cost !== "string") return 0;
		const match = cost.replace(/,/g, "").match(/([\d.]+)\s*gp/i);
		return match ? parseFloat(match[1]) : 0;
	}

	/**
	 * Format a cost value for display, normalising both string and structured forms.
	 * @param {string|object} cost
	 * @returns {string}
	 */
	static formatCostDisplay (cost) {
		if (cost == null) return "Free";
		if (typeof cost === "string") return cost;
		if (typeof cost === "object" && typeof cost.gp === "number") {
			const gpStr = `${cost.gp.toLocaleString()} gp`;
			if (cost.note) return `${gpStr} (${cost.note})`;
			if (cost.isBase) return `${gpStr} (base)`;
			return gpStr;
		}
		return "Free";
	}

	/**
	 * Whether this cost is flagged as a per-upgrade base cost (DM may scale per item).
	 * @param {string|object} cost
	 * @returns {boolean}
	 */
	static isBaseCost (cost) {
		if (cost == null) return false;
		if (typeof cost === "object") return !!cost.isBase;
		if (typeof cost === "string") return /\(base\)/i.test(cost);
		return false;
	}

	/**
	 * Get the governing variant rule (variantrule entity) for an item being upgraded.
	 * Used to render a hover-link to the source rules in the modal header.
	 * Armor/Shield → links to the real "Upgrading Armor" variantrule in the TCAH brew.
	 * Weapons → inline predefined hover (no variantrule entity exists upstream in TCAH).
	 * @param {object} item - The inventory item
	 * @returns {{name: string, source: string, label: string, isVariantrule?: boolean, inlineEntry?: object}|null}
	 */
	static getRulesReference (item) {
		if (CharacterSheetUpgrades.isArmor(item) || CharacterSheetUpgrades.isShield(item)) {
			return {name: "Upgrading Armor", source: "TCAH", label: "Armor & Shield Upgrade Rules", isVariantrule: true};
		}
		if (CharacterSheetUpgrades.isWeapon(item)) {
			return {
				name: "Upgrading Weapons",
				source: "TCAH",
				label: "Weapon Upgrade Rules",
				inlineEntry: CharacterSheetUpgrades._WEAPON_UPGRADE_RULES_ENTRY,
			};
		}
		return null;
	}

	/**
	 * Inline entry content for the weapon upgrade rules hover.
	 * Sourced from TCAH p.11 — kept here instead of modifying the upstream TCAH brew file.
	 */
	static _WEAPON_UPGRADE_RULES_ENTRY = {
		type: "entries",
		name: "Upgrading Weapons",
		source: "TCAH",
		page: 11,
		entries: [
			"Upgrading weapons follows a branching path system, with available options split into multiple tiers. At first, a weapon can only be upgraded with a limited selection of 1st tier tags depending on its type, each of which \"unlocks\" one or more options from the next tier. The following additional rules apply when upgrading a weapon with a new tag:",
			{
				type: "list",
				items: [
					"All prerequisite conditions must be satisfied to apply a new tag, as shown in the Weapon Upgrades table.",
					"2nd tier upgrades can only be applied by a trained craftsman, with 3rd tier upgrades requiring the skills of a master artisan.",
					"Typically, it takes an artisan a full day of work (minimum 8 hours) to upgrade a weapon with a new tag.",
					"Once added, a tag can't be removed from a weapon.",
				],
			},
			{
				type: "entries",
				name: "Weapon Upgrade Cost Structure",
				entries: [
					"Upgrading a weapon has a base cost associated with each tier, with subsequent upgrades of that tier costing twice the previous amount for that tier. For example, adding the {@b {@i balanced}} tag costs the tier 1 base cost of 100 gp. A second 1st tier upgrade costs 200 gp, the next 400 gp, and so on.",
					"Upgrades are grouped by tier for the purposes of this cost scaling.",
				],
			},
			{
				type: "table",
				caption: "Weapon Upgrade Comparison",
				colLabels: ["Tier", "Rarity", "Guide Price (DMG)", "Equivalent Upgrade Cost"],
				colStyles: ["col-1 text-center", "col-3", "col-4 text-right", "col-4 text-right"],
				rows: [
					["+1", "Uncommon", "101\u2013500 gp", "300\u20131,700 gp*"],
					["+2", "Rare", "501\u20135,000 gp", "4,000\u20135,000 gp"],
					["+3", "Very rare", "5,001\u201350,000 gp", "16,000\u201328,000 gp"],
				],
				footnotes: [
					"* Cost varies depending on the requirement for the ability to overcome resistance and immunity to nonmagical attacks and damage.",
				],
			},
		],
		data: {
			hoverTitle: "Upgrading Weapons \u2014 TCAH p. 11",
		},
	};

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
		const rulesRef = CharacterSheetUpgrades.getRulesReference(item);

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Upgrade: ${item.name}`,
			isMinHeight0: true,
			isWidth100: true,
		});

		const content = e_({outer: `<div class="charsheet__upgrade-modal"></div>`});

		// Rules reference header — gives players one-click hover access to the governing TCAH rules
		if (rulesRef) {
			let rulesLink;
			if (rulesRef.isVariantrule) {
				// Real variantrule entity in the loaded TCAH brew — standard hover link
				rulesLink = CharacterSheetPage.getHoverLink(
					UrlUtil.PG_VARIANTRULES,
					rulesRef.name,
					rulesRef.source,
					null,
					rulesRef.label,
				);
			} else if (rulesRef.inlineEntry) {
				// No upstream variantrule — render a predefined hover from inline entry content
				const hoverMeta = Renderer.hover.getMakePredefinedHover(rulesRef.inlineEntry, {isBookContent: true});
				rulesLink = `<a href="#" ${hoverMeta.html} onclick="event.preventDefault()">${rulesRef.label}</a>`;
			}
			if (rulesLink) {
				content.append(e_({outer: `
					<div class="charsheet__upgrade-rules-ref ve-flex-v-center mb-2 p-2 stripe-even ve-small">
						<span class="glyphicon glyphicon-book mr-1" aria-hidden="true"></span>
						<span><strong>Rules:</strong> ${rulesLink} <span class="ve-muted">(hover for full text)</span></span>
					</div>
				`}));
			}
		}

		// Current upgrades section
		if (currentUpgrades.length) {
			const currentSection = e_({outer: `<div class="charsheet__upgrade-current mb-3"></div>`});
			currentSection.append(e_({outer: `<h5>Applied Upgrades</h5>`}));
			for (const upgrade of currentUpgrades) {
				const tierLabel = CharacterSheetUpgrades.getUpgradeTierLabel(upgrade.upgradeType);
				const tierColor = CharacterSheetUpgrades.getUpgradeTierColor(upgrade.upgradeType);
				const upgradeLink = CharacterSheetPage.getHoverLink(UrlUtil.PG_ITEM_UPGRADES, upgrade.name, upgrade.source);
				currentSection.append(e_({outer: `
					<div class="charsheet__upgrade-applied ve-flex-v-center mb-1 p-1 stripe-even">
						<div class="ve-flex-1">
							<span class="badge ${tierColor} ve-small mr-1">${tierLabel}</span>
							<span class="charsheet__upgrade-name">${upgradeLink}</span>
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
				const gemLink = CharacterSheetPage.getHoverLink(UrlUtil.PG_ITEM_UPGRADES, gem.name, gem.source);
				gemSection.append(e_({outer: `
					<div class="charsheet__upgrade-gem ve-flex-v-center mb-1 p-1 stripe-even">
						<div class="ve-flex-1">
							<span class="badge badge-success ve-small mr-1">${gem.gemName || tierLabel}</span>
							<span class="charsheet__upgrade-name">${gemLink}</span>
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
					const isBase = CharacterSheetUpgrades.isBaseCost(upgrade.cost);
					const costLabel = CharacterSheetUpgrades.formatCostDisplay(upgrade.cost);
					const canAfford = totalGold >= gpCost;
					const prereqItems = upgrade.prerequisite?.[0]?.item;
					const prereqText = prereqItems?.length ? `Requires: ${prereqItems.join("; ")}` : "";
					const renderedEntries = upgrade.entries?.length
						? Renderer.get().render({type: "entries", entries: upgrade.entries})
						: "";
					const btnAttr = !canAfford ? 'disabled title="Insufficient gold"' : `title="Apply for ${gpCost} gp"`;
					const upgradeLink = CharacterSheetPage.getHoverLink(UrlUtil.PG_ITEM_UPGRADES, upgrade.name, upgrade.source);
					const baseHint = isBase
						? `<span class="badge badge-default ve-small ml-1" title="Per-upgrade base cost. The DM may scale this for the specific item per the source's pricing tables.">base</span>`
						: "";

					const row = e_({outer: `
						<div class="charsheet__upgrade-option mb-1 p-2 stripe-even">
							<div class="ve-flex-v-center mb-1">
								<div class="ve-flex-1">
									<span class="charsheet__upgrade-name">${upgradeLink}</span>
									<span class="ve-muted ve-small ml-1">${costLabel}</span>${baseHint}
									${prereqText ? `<div class="ve-small ve-muted">${prereqText}</div>` : ""}
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
							${renderedEntries ? `<details class="ve-small charsheet__upgrade-details"><summary class="ve-muted">Details</summary><div class="mt-1">${renderedEntries}</div></details>` : ""}
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

			// Remove upgrade (with optional refund)
			const removeBtn = e.target.closest(".charsheet__upgrade-remove");
			if (removeBtn) {
				const name = removeBtn.dataset.upgradeName;
				const source = removeBtn.dataset.upgradeSource;
				const applied = this._state.getItemUpgrades(itemId).find(
					u => u.name === name && u.source === source,
				);
				const paid = applied?.costPaid || 0;

				let refund = 0;
				if (paid > 0) {
					const choice = await InputUiUtil.pGetUserEnum({
						title: `Remove "${name}"`,
						placeholder: "How should the cost be handled?",
						values: ["No refund", `Full refund (${paid} gp)`, `Half refund (${paid / 2} gp)`],
						isResolveItem: false,
					});
					if (choice == null) return; // cancelled
					if (choice === 1) refund = paid;
					else if (choice === 2) refund = paid / 2;
				} else {
					const ok = await InputUiUtil.pGetUserBoolean({
						title: `Remove "${name}"?`,
						htmlDescription: `This upgrade will be removed from <strong>${item.name}</strong>.`,
						textYes: "Remove",
						textNo: "Cancel",
					});
					if (!ok) return;
				}

				const removed = this._state.removeItemUpgrade(itemId, name, source);
				if (!removed) {
					JqueryUtil.doToast({content: `Could not remove "${name}"`, type: "danger"});
					return;
				}
				if (refund > 0) this._state.addGold(refund);

				const refundStr = refund > 0 ? ` (refunded ${refund} gp)` : "";
				JqueryUtil.doToast({content: `Removed "${name}" from ${item.name}${refundStr}`, type: "info"});
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
	async showEmpowermentModal (opts = {}) {
		const gemstones = this.getGemstoneUpgrades();
		if (!gemstones.length) {
			JqueryUtil.doToast({content: "No gemstone data loaded. Check if Thelemar homebrew is enabled.", type: "warning"});
			return;
		}

		// Check if character has the Gem Empowerment skill
		const hasGemEmpowerment = this._state.isProficientInSkill("gemempowerment");
		const gemEmpowermentMod = this._state.getSkillMod("gemempowerment");

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: opts.fromInventoryGem ? `Empower: ${opts.fromInventoryGem.name}` : "Gemstone Empowerment",
			isMinHeight0: true,
			isWidth100: true,
		});

		const content = e_({outer: `<div class="charsheet__empower-modal"></div>`});

		const skillBadge = hasGemEmpowerment
			? `<span class="badge badge-success ve-small">+${gemEmpowermentMod}</span>`
			: `<span class="badge badge-danger ve-small">Not proficient</span>`;

		content.append(e_({outer: `
			<div class="charsheet__empower-header">
				<span class="ve-small"><strong>Gem Empowerment</strong> ${skillBadge}</span>
				<span class="ve-small ve-muted">⚠ Failure destroys the gem</span>
				${!hasGemEmpowerment ? `<div class="charsheet__empower-warning ve-small">Add <strong>Gem Empowerment</strong> as a custom skill first.</div>` : ""}
			</div>
		`}));

		// Filter gems to matching gemName when empowering from inventory
		const filteredGemstones = opts.fromInventoryGem
			? gemstones.filter(g => g.gemName && g.gemName.toLowerCase() === opts.fromInventoryGem.name.toLowerCase())
			: gemstones;

		if (opts.fromInventoryGem && !filteredGemstones.length) {
			content.append(e_({outer: `<div class="charsheet__empower-warning ve-small">No empowerment options found for "${opts.fromInventoryGem.name}".</div>`}));
			modalInner.append(content);
			const footer = ee`<div class="ve-flex-v-center ve-flex-h-right mt-1"><button class="ve-btn ve-btn-default ve-btn-xs">Close</button></div>`;
			modalInner.append(footer);
			footer.querySelector("button").addEventListener("click", () => doClose(false));
			return;
		}

		// Group gemstones by rarity
		const grouped = {};
		for (const gem of filteredGemstones) {
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
			const minNeeded = hasGemEmpowerment ? Math.max(1, dc - gemEmpowermentMod) : "—";

			const section = e_({outer: `<div class="charsheet__empower-rarity"></div>`});
			section.append(e_({outer: `
				<div class="charsheet__empower-rarity-header ve-flex-v-center ve-small">
					<span class="badge charsheet__rarity-badge--${rarity.replace(/\s+/g, "-")}">${rarity.toTitleCase()}</span>
					<span class="ml-1">DC ${dc}</span>
					${hasGemEmpowerment ? `<span class="ve-muted ml-1">(need ${minNeeded}+)</span>` : ""}
				</div>
			`}));

			for (const gem of gems) {
				const renderedEntries = gem.entries?.length
					? Renderer.get().render({type: "entries", entries: gem.entries})
					: "";
				const gemLink = CharacterSheetPage.getHoverLink(UrlUtil.PG_ITEM_UPGRADES, gem.name, gem.source);

				section.append(e_({outer: `
					<div class="charsheet__empower-option">
						<div class="ve-flex-v-center">
							<span class="charsheet__upgrade-name ve-flex-1">${gemLink}${gem.gemName ? ` <span class="ve-muted ve-small">(${gem.gemName})</span>` : ""}${gem.charges ? ` <span class="badge badge-info ve-small">${gem.charges}ch</span>` : ""}</span>
							<button type="button"
								class="ve-btn ve-btn-xs ${hasGemEmpowerment ? "ve-btn-success" : "ve-btn-default"} charsheet__empower-select"
								data-gem-name="${gem.name}"
								data-gem-source="${gem.source}"
								data-gem-dc="${gem.craftingDC || dc}"
								${!hasGemEmpowerment ? `disabled title="Requires Gem Empowerment skill"` : `title="DC ${gem.craftingDC || dc}"`}>
								⚡ Empower
							</button>
						</div>
						${renderedEntries ? `<details class="ve-small charsheet__empower-details"><summary class="ve-muted">Details</summary>${renderedEntries}</details>` : ""}
					</div>
				`}));
			}
			content.append(section);
		}

		modalInner.append(content);

		const footer = ee`<div class="ve-flex-v-center ve-flex-h-right mt-1">
			<button class="ve-btn ve-btn-default ve-btn-xs">Close</button>
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

			doClose(false);
			await this._showCraftingRollModal(gemName, gemSource, dc, opts);
		});
	}

	/**
	 * Show the crafting roll modal for empowerment
	 * @param {string} gemName - Gemstone power name
	 * @param {string} gemSource - Gemstone source
	 * @param {number} dc - Crafting DC
	 * @param {object} [opts] - Options (fromInventoryGem, etc.)
	 */
	async _showCraftingRollModal (gemName, gemSource, dc, opts = {}) {
		const gemEmpowermentMod = this._state.getSkillMod("gemempowerment");
		const minRoll = Math.max(1, dc - gemEmpowermentMod);

		const {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal({
			title: `Empower: ${gemName}`,
			isMinHeight0: true,
		});

		const content = e_({outer: `<div class="charsheet__empower-roll"></div>`});

		content.append(e_({outer: `
			<div style="text-align: center;">
				<div class="charsheet__empower-roll-info">
					<span class="ve-small ve-muted">Gem Empowerment</span>
					<div class="charsheet__empower-roll-dc">+${gemEmpowermentMod} vs DC ${dc}</div>
					<span class="ve-small ve-muted">Need ${minRoll}+ on d20</span>
				</div>
				<div class="charsheet__empower-roll-warning ve-small">⚠ Failure destroys the gem</div>
				<button type="button" class="ve-btn ve-btn-sm ve-btn-success charsheet__empower-roll-btn">🎲 Roll Empowerment</button>
			</div>
			<div class="charsheet__empower-result" style="display: none;"></div>
		`}));

		modalInner.append(content);

		const rollBtn = content.querySelector(".charsheet__empower-roll-btn");
		const resultDiv = content.querySelector(".charsheet__empower-result");

		rollBtn.addEventListener("click", () => {
			const roll = Math.floor(Math.random() * 20) + 1;
			const total = roll + gemEmpowermentMod;
			const success = total >= dc;
			const nat20 = roll === 20;
			const nat1 = roll === 1;

			rollBtn.style.display = "none";

			if (nat20 || (success && !nat1)) {
				const gemEntity = this.getGemstoneUpgrades().find(
					g => g.name === gemName && g.source === gemSource,
				);

				if (gemEntity) {
					const baseGemName = gemEntity.gemName || opts.fromInventoryGem?.name || "Gemstone";
					const empoweredName = `Empowered ${baseGemName} (${gemEntity.name})`;
					const gemstoneData = {
						name: gemEntity.name,
						source: gemEntity.source,
						gemName: gemEntity.gemName,
						rarity: gemEntity.rarity,
						upgradeType: gemEntity.upgradeType,
						entries: gemEntity.entries,
						charges: gemEntity.charges || null,
						recharge: gemEntity.recharge || null,
					};

					if (opts.fromInventoryGem) {
						const existingItems = this._state.getItems();
						const existingGem = existingItems.find(i => i.id === opts.fromInventoryGem.id);
						if (existingGem) {
							existingGem.name = empoweredName;
							existingGem.rarity = gemEntity.rarity || "common";
							existingGem.entries = gemEntity.entries || [];
							existingGem._isEmpoweredGemstone = true;
							existingGem._gemstoneData = gemstoneData;
						}
					} else {
						this._state.addItem({
							name: empoweredName,
							source: gemSource,
							type: "$G",
							rarity: gemEntity.rarity || "common",
							entries: gemEntity.entries || [],
							weight: 0,
							_isEmpoweredGemstone: true,
							_gemstoneData: gemstoneData,
						});
					}
				}

				resultDiv.style.display = "";
				resultDiv.innerHTML = `
					<div class="charsheet__empower-result--success" style="text-align: center;">
						<div class="charsheet__empower-result-title">${nat20 ? "🎯 Natural 20! " : "✨ "}Success!</div>
						<div class="ve-small ve-muted">Rolled ${roll} + ${gemEmpowermentMod} = <strong>${total}</strong> vs DC ${dc}</div>
						<div class="ve-small">${opts.fromInventoryGem ? "Gemstone empowered!" : "Added to inventory."} Socket it into equipment.</div>
					</div>
				`;

				const toastGemLabel = gemEntity?.gemName || opts.fromInventoryGem?.name || gemName;
				JqueryUtil.doToast({content: `Empowered ${toastGemLabel} with ${gemName}!${opts.fromInventoryGem ? "" : " Added to inventory."}`, type: "success"});
				this._page.saveCharacter();
				this._page._inventory?.render();
			} else {
				if (opts.fromInventoryGem) {
					this._state.removeItem(opts.fromInventoryGem.id);
					this._page.saveCharacter();
					this._page._inventory?.render();
				}

				resultDiv.style.display = "";
				resultDiv.innerHTML = `
					<div class="charsheet__empower-result--failure" style="text-align: center;">
						<div class="charsheet__empower-result-title">${nat1 ? "💥 Natural 1! " : "💔 "}Failed</div>
						<div class="ve-small ve-muted">Rolled ${roll} + ${gemEmpowermentMod} = <strong>${total}</strong> vs DC ${dc}</div>
						<div class="ve-small">The gemstone shatters and is destroyed.</div>
					</div>
				`;

				JqueryUtil.doToast({content: `Empowerment failed — ${opts.fromInventoryGem?.name || gemName} was destroyed.`, type: "danger"});
			}

			const closeBtn = e_({outer: `<div class="ve-flex-v-center ve-flex-h-center mt-1"><button class="ve-btn ve-btn-default ve-btn-xs">Close</button></div>`});
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
			content.append(e_({outer: `<h5 class="mb-2">Available Empowered Gemstones</h5>`}));

			for (const gem of empoweredGems) {
				const gemData = gem._gemstoneData;
				const chargeStr = gemData.charges ? `${gemData.charges} charges` : "";
				const renderedEntries = gemData.entries?.length
					? Renderer.get().render({type: "entries", entries: gemData.entries})
					: "";
				const gemLink = CharacterSheetPage.getHoverLink(UrlUtil.PG_ITEM_UPGRADES, gemData.name, gemData.source);

				content.append(e_({outer: `
					<div class="charsheet__socket-option mb-2 p-2" style="border-radius: 8px; border: 1px solid rgba(0,0,0,0.08); background: var(--rgb-bg, white);">
						<div class="ve-flex-v-center mb-1">
							<div class="ve-flex-1">
								<span class="charsheet__upgrade-name" style="font-weight: 600;">${gemLink}</span>
								${chargeStr ? `<span class="badge badge-info ve-small ml-2">${chargeStr}</span>` : ""}
							</div>
							<button type="button" class="ve-btn ve-btn-sm ve-btn-success charsheet__socket-apply"
								data-gem-id="${gem.id}" title="Socket into ${item.name}">
								<span class="glyphicon glyphicon-log-in"></span> Socket
							</button>
						</div>
						${renderedEntries ? `<div class="ve-small mt-1 ve-muted">${renderedEntries}</div>` : ""}
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
			critDamageReduction: 0,
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
			else if (name === "reinforced") { effects.reinforced = true; effects.critDamageReduction = 3; }
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
	 * Get human-readable notes for armor upgrade effects
	 * @param {object} item - Inventory item with appliedUpgrades
	 * @returns {Array<{label: string, description: string, type: string}>} Display-ready notes
	 */
	static getArmorUpgradeNotes (item) {
		const flags = this.getArmorUpgradeEffects(item);
		const notes = [];

		if (flags.muffled) notes.push({label: "Muffled", description: "No disadvantage on Stealth checks", type: "passive"});
		if (flags.reinforced) notes.push({label: "Reinforced", description: "Reduce critical damage from nonmagical attacks by 3", type: "passive"});
		if (flags.armorProofingTier >= 1) {
			const thresholds = {1: "6", 2: "7", 3: "8"};
			const types = {1: "slashing", 2: "slashing and piercing", 3: "slashing, piercing, and bludgeoning"};
			notes.push({
				label: `Armor Proofing (Tier ${flags.armorProofingTier})`,
				description: `Ignore ${thresholds[flags.armorProofingTier]} or less nonmagical ${types[flags.armorProofingTier]} damage`,
				type: "passive",
			});
		}
		if (flags.spiked) notes.push({label: "Spiked", description: "Attackers take 1d4 piercing (unarmed/natural weapons)", type: "reactive"});
		if (flags.breathable) notes.push({label: "Breathable", description: "Advantage on exhaustion saves vs extreme heat", type: "passive"});
		if (flags.insulated) notes.push({label: "Insulated", description: "Counts as cold weather gear", type: "passive"});
		if (flags.climbingHarness) notes.push({label: "Climbing Harness", description: "Advantage on Athletics to climb with rope", type: "passive"});
		if (flags.lockingJoints) notes.push({label: "Locking Joints", description: "Advantage on Athletics vs shove attempts", type: "passive"});
		if (flags.quickRelease) notes.push({label: "Quick-release Clasps", description: "Doff armor as an action", type: "passive"});
		if (flags.decorated) notes.push({label: "Decorated", description: "Usable as spellcasting focus (Cleric/Paladin)", type: "passive"});
		if (flags.runic) notes.push({label: "Runic", description: "Can be imbued with rune magic", type: "passive"});
		if (flags.burnished) notes.push({label: "Burnished", description: "Advantage on Charisma checks vs certain humanoids (24h or until combat)", type: "passive"});

		return notes;
	}

	/**
	 * Get the total bonus adjustments from applied upgrades on an item
	 * @param {object} item - Inventory item data (with appliedUpgrades array)
	 * @returns {object} Bonus adjustments including numeric bonuses, tags, notes, and extra damage
	 */
	static getUpgradeEffects (item) {
		const effects = {
			bonusWeaponAttack: 0,
			bonusWeaponDamage: 0,
			critThresholdReduction: 0,
			bonusSpellAttack: 0,
			bonusSpellSaveDc: 0,
			damageDieIncrease: 0,
			// Tags: weapon properties granted by upgrades (e.g., "Silvered", "Magical")
			tags: [],
			// Notes: free-text mechanical reminders for the player
			notes: [],
			// Extra damage dice (e.g., Saw-toothed +1d4 slashing)
			bonusDamageDice: null,
			bonusDamageType: null,
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

			// Silvered: weapon counts as silvered
			if (name === "silvered") {
				effects.tags.push("Silvered");
			}

			// Magical: weapon counts as magical
			if (name === "magical") {
				effects.tags.push("Magical");
			}

			// Runic (weapon): can be imbued with rune magic
			if (name === "runic") {
				effects.tags.push("Runic");
			}

			// Saw-toothed: +1d4 slashing (no effect vs constructs/undead)
			if (name === "saw-toothed") {
				effects.bonusDamageDice = "1d4";
				effects.bonusDamageType = "slashing";
				effects.notes.push("Saw-toothed: +1d4 slashing damage (no effect vs constructs/undead)");
			}

			// Brutal: on max damage die, reroll and add (repeats if max again)
			if (name === "brutal") {
				effects.notes.push("Brutal: Reroll max damage dice and add to total (repeats if max rolled again)");
			}

			// Flanged: sunder armor on hit
			if (name === "flanged") {
				effects.notes.push("Flanged: On hit, target\u2019s medium/heavy armor takes cumulative \u22121 AC");
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
			usedToday: gem.usedToday || false,
		}));
	}

	/**
	 * Get a concise summary string for a gemstone's mechanical effect
	 * @param {object} gem - Socketed gemstone data
	 * @returns {string} One-line summary of the gemstone's effect
	 */
	static getGemstoneSummary (gem) {
		if (!gem?.name) return "";
		const name = gem.name.toLowerCase();
		const summaries = {
			"alchemist": "+2 HP when drinking potion of healing",
			"mariner": "No disadvantage on underwater weapon attacks",
			"thief": "1/day: Reroll failed DEX check",
			"warrior": "Can\u2019t be disarmed while conscious",
			"arrow-catcher": "Reaction: Impose disadvantage on ranged attack (3 charges, 1d3/dawn)",
			"bound armor": "Bonus action: Don/doff armor instantly",
			"bound weapon": "Bonus action: Make weapon disappear/appear",
			"cat": "1/dawn: 1 hour darkvision 120 ft.",
			"chaos": "Critical hit triggers Wild Magic Surge",
			"daywalker": "Unaffected by sunlight with hood drawn",
			"elemental shield": "Reaction: Reduce chosen damage by 2\u00D7level + CON mod (1 exhaustion)",
			"featherfoot": "Standing jump = walking speed (1 ft. per ft. cleared)",
			"knock": "1/dawn: Cast Knock by tapping fist",
			"nondetection": "Hidden from divination magic and scrying",
			"serpent": "1/dawn: On hit, CON save or poisoned 1 min",
			"bastion": "1/dawn: Bonus action 10-ft. force dome (1 min)",
			"berserker": "1/dawn: Expend Hit Dice on hit, add to damage (take equal damage)",
			"chalice": "Store up to 2 spell levels; cast stored spells",
			"death": "Kill humanoid = rises as zombie (1 HP, 1 min)",
			"hunt": "1/dawn: Mark creature \u226490 ft.; bonus action teleport \u226430 ft. on ranged hit",
			"journey": "+10 speed; fast pace without Perception penalty; halved food/water",
			"magebane": "On hit: end \u22643rd level spells; check for 4th+ (3 charges, 1d3/dawn)",
			"phoenix": "1/dawn: At 0 HP, casts Fireball on you; gain 1d6 HP next turn",
			"soultrap": "1/dawn: Kill CR \u2265 level = regain 1 spell slot (max level = PB)",
			"superconductor": "Gains charges from targeted spells; spend for +1d6 force per charge",
			"warmage": "Fail concentration save = reroll (3 charges; spend slot to recover)",
			"blood weapon": "Critical hit: Regain HP = damage dealt (not vs undead/constructs)",
			"displacement": "1/turn: Take weapon damage = teleport 30 ft.",
			"dragonbane": "Hit dragon: +2d6 damage; STR save or flying speed 0",
			"earthshaker": "1/dawn: Action Earthquake spell (1 round)",
			"giant slayer": "Hit giant: +2d6 damage; STR save or prone",
			"mark/recall": "1/dawn: Mark surface; concentrate 1 min = teleport to mark with up to 5",
			"overshield": "Gain 8 temp HP at start of each turn",
			"retribution": "Take damage = advantage on next attack vs that creature type",
			"wolfsbane": "Sheds moonlight; hit shapechanger: +2d6 radiant; CON save or true form",
			"force of will": "Can\u2019t be affected by enchantment magic unless you choose",
			"mime": "Short rest: Copy magic item properties (no fixed bonuses)",
			"tempest": "1/turn on hit: +1d10 lightning; arcs to 3 creatures within 30 ft.",
			"volant": "Gain hover flight speed = 2\u00D7 walking speed",
		};
		return summaries[name] || (gem.entries?.length ? Renderer.stripTags(gem.entries[0]?.toString?.() || "") : "");
	}

	/**
	 * Detect gemstones that have passive mechanical effects on calculations
	 * @param {object} gem - Socketed gemstone data
	 * @returns {object} Passive effects: {speedBonus, notes[]}
	 */
	static getGemstonePassiveEffects (gem) {
		const effects = {speedBonus: 0, flightSpeed: 0, notes: []};
		if (!gem?.name) return effects;
		const name = gem.name.toLowerCase();

		// --- Passive / always-on effects ---
		if (name === "journey") {
			effects.speedBonus = 10;
			effects.notes.push("Journey: +10 speed; fast pace without Perception penalty; halved food/water");
		}
		if (name === "overshield") effects.notes.push("Overshield: Gain 8 temp HP at start of each turn");
		if (name === "featherfoot") effects.notes.push("Featherfoot: Standing jump distance equals walking speed");
		if (name === "warrior") effects.notes.push("Warrior: Can\u2019t be disarmed while conscious");
		if (name === "nondetection") effects.notes.push("Nondetection: Hidden from divination and scrying");
		if (name === "daywalker") effects.notes.push("Daywalker: Unaffected by sunlight with hood drawn");
		if (name === "force of will") effects.notes.push("Force of Will: Immune to enchantment magic unless you choose");
		if (name === "volant") {
			effects.flightSpeed = -1; // sentinel: 2x walk, resolved dynamically
			effects.notes.push("Volant: Hover flight speed = 2\u00D7 walking speed");
		}
		if (name === "chaos") effects.notes.push("Chaos: Critical hits trigger Wild Magic Surge");
		if (name === "retribution") effects.notes.push("Retribution: Advantage on next attack when damaged");
		if (name === "alchemist") effects.notes.push("Alchemist: +2 HP when drinking healing potions");
		if (name === "mariner") effects.notes.push("Mariner: No underwater attack disadvantage");
		if (name === "blood weapon") effects.notes.push("Blood Weapon: Critical hit heals HP = extra crit damage (not vs undead/constructs)");
		if (name === "wolfsbane") effects.notes.push("Wolfsbane: Sheds moonlight 5 ft.; +2d6 radiant vs shapechangers; CON save or true form");
		if (name === "dragonbane") effects.notes.push("Dragonbane: +2d6 damage vs dragons; STR save or flying speed 0");
		if (name === "giant slayer") effects.notes.push("Giant Slayer: +2d6 damage vs Large+ creatures; STR save or prone");
		if (name === "superconductor") effects.notes.push("Superconductor: Gains charges from targeted spells; spend for +1d6 force per charge");
		if (name === "tempest") effects.notes.push("Tempest: 1/turn on hit: +1d10 lightning; arcs to 3 creatures within 30 ft.");

		// --- Active / charge-based abilities (note for reference) ---
		if (name === "thief") effects.notes.push("Thief: 1/day reroll failed DEX (Stealth) check");
		if (name === "arrow-catcher") effects.notes.push("Arrow-catcher: Reaction: impose disadvantage on ranged attack (3 charges, 1d3/dawn)");
		if (name === "bound armor") effects.notes.push("Bound Armor: Bonus action don/doff armor instantly");
		if (name === "bound weapon") effects.notes.push("Bound Weapon: Bonus action make weapon disappear/appear");
		if (name === "cat") effects.notes.push("Cat: 1/dawn darkvision 120 ft. for 1 hour");
		if (name === "elemental shield") effects.notes.push("Elemental Shield: Reaction: reduce chosen element damage by 2\u00D7level + CON mod (1 exhaustion)");
		if (name === "knock") effects.notes.push("Knock: 1/dawn cast Knock by tapping fist on lock");
		if (name === "serpent") effects.notes.push("Serpent: 1/dawn on hit: CON save or poisoned 1 min");
		if (name === "bastion") effects.notes.push("Bastion: 1/dawn bonus action 10 ft. force dome (1 min)");
		if (name === "berserker") effects.notes.push("Berserker: 1/dawn expend Hit Dice on hit, add to damage (take equal)");
		if (name === "chalice") effects.notes.push("Chalice: Store up to 2 spell levels; cast stored spells");
		if (name === "death") effects.notes.push("Death: Kill humanoid = rises as zombie (1 HP, 1 min)");
		if (name === "hunt") effects.notes.push("Hunt: 1/dawn mark creature \u226490 ft.; bonus action teleport \u226430 ft. on ranged hit");
		if (name === "magebane") effects.notes.push("Magebane: On hit: end \u22643rd level spells; check for 4th+ (3 charges, 1d3/dawn)");
		if (name === "phoenix") effects.notes.push("Phoenix: 1/dawn at 0 HP, casts Fireball centered on you; gain 1d6 HP next turn");
		if (name === "soultrap") effects.notes.push("Soultrap: 1/dawn kill CR \u2265 level = regain 1 spell slot (max level = PB)");
		if (name === "warmage") effects.notes.push("Warmage: Fail concentration save = reroll (3 charges; spend slot to recover)");
		if (name === "displacement") effects.notes.push("Displacement: 1/turn take weapon damage = teleport 30 ft.");
		if (name === "earthshaker") effects.notes.push("Earthshaker: 1/dawn Earthquake spell (1 round, 100 ft.)");
		if (name === "mark/recall") effects.notes.push("Mark/Recall: 1/dawn mark surface; concentrate 1 min = teleport with up to 5 creatures");
		if (name === "mime") effects.notes.push("Mime: Short rest: copy magic item properties (no fixed bonuses)");

		return effects;
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
