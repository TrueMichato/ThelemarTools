/**
 * Character Sheet — Mobile Interaction Module
 * Provides touch-optimized interactions for mobile devices:
 * - Mobile detection
 * - Swipe navigation between tabs
 * - Long-press context menus (replaces right-click)
 * - Roll modifier toolbar (replaces Shift+click / Ctrl+click)
 * - Floating Action Button (FAB)
 * - Collapsible sections
 * - Haptic feedback
 */
class CharacterSheetMobile {
	constructor (page) {
		this._page = page;

		// State
		this._isMobile = false;
		this._swipeStartX = 0;
		this._swipeStartY = 0;
		this._swipeThreshold = 60;
		this._longPressTimer = null;
		this._longPressDuration = 500;
		this._rollTarget = null;
		this._fabOpen = false;
		this._contextMenuVisible = false;

		// Elements (created lazily)
		this._elRollToolbar = null;
		this._elContextMenu = null;
		this._elFab = null;

		this._init();
	}

	// =========================================================================
	// Detection
	// =========================================================================

	static isMobile () {
		return (
			window.matchMedia("(max-width: 768px)").matches
			&& ("ontouchstart" in window || navigator.maxTouchPoints > 0)
		);
	}

	static isTouchDevice () {
		return "ontouchstart" in window || navigator.maxTouchPoints > 0;
	}

	// =========================================================================
	// Initialization
	// =========================================================================

	_init () {
		this._isMobile = CharacterSheetMobile.isMobile();

		if (!this._isMobile && !CharacterSheetMobile.isTouchDevice()) return;

		// Add touch class to body for CSS hooks
		document.body.classList.add("is-touch-device");

		if (this._isMobile) {
			document.body.classList.add("is-charsheet-mobile");
			this._initMobileLayout();
		}

		// Re-evaluate on resize/orientation change
		window.addEventListener("resize", this._onResize.bind(this));
		window.addEventListener("orientationchange", () => {
			setTimeout(() => this._onResize(), 100);
		});
	}

	_initMobileLayout () {
		this._initCollapsibleSections();
		this._initSwipeNavigation();
		this._initLongPress();
		this._initRollToolbar();
		this._initFab();
		this._initHeaderToggle();
		this._initTouchFeedback();
		this._initModalScrollLock();
	}

	_onResize () {
		const wasMobile = this._isMobile;
		this._isMobile = CharacterSheetMobile.isMobile();

		if (this._isMobile && !wasMobile) {
			document.body.classList.add("is-charsheet-mobile");
			this._initMobileLayout();
		} else if (!this._isMobile && wasMobile) {
			document.body.classList.remove("is-charsheet-mobile");
			this._teardownMobile();
		}
	}

	_teardownMobile () {
		// Remove mobile-specific elements
		this._elRollToolbar?.remove();
		this._elContextMenu?.remove();
		this._elFab?.remove();
		this._elRollToolbar = null;
		this._elContextMenu = null;
		this._elFab = null;

		// Uncollapse all sections
		document.querySelectorAll(".charsheet-mobile--collapsed").forEach(el => {
			el.classList.remove("charsheet-mobile--collapsed");
		});
	}

	// =========================================================================
	// Collapsible Sections
	// =========================================================================

	_initCollapsibleSections () {
		const sections = document.querySelectorAll(".charsheet__section");

		// Sections to NOT collapse by default
		const noCollapse = new Set([
			"charsheet__section--hp",
			"charsheet__section--identity",
			"charsheet__section--combat-stats",
			"charsheet__section--header",
		]);

		// Sections to collapse by default on mobile
		const defaultCollapsed = new Set([
			"charsheet__section--saves",
			"charsheet__section--skills",
			"charsheet__section--passives",
			"charsheet__section--senses",
			"charsheet__section--features",
			"charsheet__section--currency",
			"charsheet__section--exhaustion",
		]);

		sections.forEach(section => {
			// Skip non-collapsible sections
			const isNoCollapse = [...noCollapse].some(cls => section.classList.contains(cls));
			if (isNoCollapse) return;

			const title = section.querySelector(".charsheet__section-title");
			if (!title) return;

			// Collapse by default for specified sections
			const shouldCollapse = [...defaultCollapsed].some(cls => section.classList.contains(cls));
			if (shouldCollapse) {
				section.classList.add("charsheet-mobile--collapsed");
			}

			// Add tap-to-toggle behavior
			title.addEventListener("click", (e) => {
				// Don't toggle if clicking edit buttons within the title
				if (e.target.closest(".charsheet__section-edit, .ve-btn, button")) return;
				section.classList.toggle("charsheet-mobile--collapsed");
				this._haptic("light");
			});
		});
	}

	// =========================================================================
	// Swipe Navigation
	// =========================================================================

	_initSwipeNavigation () {
		const tabContent = document.querySelector(".charsheet-page .tab-content");
		if (!tabContent) return;

		tabContent.addEventListener("touchstart", (e) => {
			if (e.touches.length !== 1) return;
			this._swipeStartX = e.touches[0].clientX;
			this._swipeStartY = e.touches[0].clientY;
		}, {passive: true});

		tabContent.addEventListener("touchend", (e) => {
			if (e.changedTouches.length !== 1) return;
			const deltaX = e.changedTouches[0].clientX - this._swipeStartX;
			const deltaY = e.changedTouches[0].clientY - this._swipeStartY;

			// Only trigger if horizontal swipe is dominant
			if (Math.abs(deltaX) < this._swipeThreshold) return;
			if (Math.abs(deltaY) > Math.abs(deltaX) * 0.5) return;

			if (deltaX > 0) {
				this._navigateTab(-1); // swipe right = previous tab
			} else {
				this._navigateTab(1); // swipe left = next tab
			}
		}, {passive: true});
	}

	_navigateTab (direction) {
		const tabs = document.querySelectorAll("#charsheet-tabs > li");
		if (!tabs.length) return;

		let activeIdx = -1;
		tabs.forEach((tab, i) => {
			if (tab.classList.contains("ve-active")) activeIdx = i;
		});

		const newIdx = activeIdx + direction;
		if (newIdx < 0 || newIdx >= tabs.length) return;

		const targetLink = tabs[newIdx].querySelector("a");
		if (targetLink) {
			targetLink.click();
			this._haptic("light");

			// Scroll the tab into view
			tabs[newIdx].scrollIntoView({behavior: "smooth", inline: "center", block: "nearest"});
		}
	}

	// =========================================================================
	// Long Press (replaces right-click)
	// =========================================================================

	_initLongPress () {
		// Attach to rollable elements and items
		document.addEventListener("touchstart", (e) => {
			const target = e.target.closest(
				".charsheet__skill-row, .charsheet__save-row, .charsheet__attack-item, "
				+ ".charsheet__ability, .charsheet__combat-stat--clickable, "
				+ ".charsheet__inventory-item, .charsheet__resource-item",
			);
			if (!target) return;

			this._longPressTimer = setTimeout(() => {
				e.preventDefault();
				this._haptic("medium");
				this._showContextMenu(target, e.touches[0]);
			}, this._longPressDuration);
		}, {passive: false});

		document.addEventListener("touchmove", () => {
			this._cancelLongPress();
		}, {passive: true});

		document.addEventListener("touchend", () => {
			this._cancelLongPress();
		}, {passive: true});
	}

	_cancelLongPress () {
		if (this._longPressTimer) {
			clearTimeout(this._longPressTimer);
			this._longPressTimer = null;
		}
	}

	// =========================================================================
	// Context Menu
	// =========================================================================

	_showContextMenu (target, touch) {
		this._hideContextMenu();

		if (!this._elContextMenu) {
			this._elContextMenu = this._createContextMenu();
			document.body.appendChild(this._elContextMenu);
		}

		// Build menu items based on target type
		const items = this._getContextMenuItems(target);
		const contentEl = this._elContextMenu.querySelector(".charsheet-mobile__context-menu-items");
		contentEl.innerHTML = "";

		items.forEach(item => {
			if (item.separator) {
				const sep = document.createElement("div");
				sep.className = "charsheet-mobile__context-menu-separator";
				contentEl.appendChild(sep);
				return;
			}

			const el = document.createElement("div");
			el.className = "charsheet-mobile__context-menu-item";
			el.innerHTML = `
				<span class="charsheet-mobile__context-menu-item-icon">${item.icon}</span>
				<span>${item.label}</span>
			`;
			el.addEventListener("click", () => {
				this._hideContextMenu();
				item.action();
			});
			contentEl.appendChild(el);
		});

		// Position the menu
		const x = Math.min(touch.clientX, window.innerWidth - 200);
		const y = Math.min(touch.clientY - 20, window.innerHeight - 250);
		this._elContextMenu.style.left = `${x}px`;
		this._elContextMenu.style.top = `${y}px`;
		this._elContextMenu.classList.add("charsheet-mobile--visible");
		this._contextMenuVisible = true;

		// Close on outside tap
		setTimeout(() => {
			document.addEventListener("touchstart", this._hideContextMenuHandler = () => {
				this._hideContextMenu();
			}, {once: true});
		}, 50);
	}

	_hideContextMenu () {
		if (this._elContextMenu) {
			this._elContextMenu.classList.remove("charsheet-mobile--visible");
		}
		this._contextMenuVisible = false;
		if (this._hideContextMenuHandler) {
			document.removeEventListener("touchstart", this._hideContextMenuHandler);
			this._hideContextMenuHandler = null;
		}
	}

	_createContextMenu () {
		const el = document.createElement("div");
		el.className = "charsheet-mobile__context-menu";
		el.innerHTML = `<div class="charsheet-mobile__context-menu-items"></div>`;
		return el;
	}

	_getContextMenuItems (target) {
		const items = [];

		// Skill/Save row
		if (target.matches(".charsheet__skill-row, .charsheet__save-row")) {
			items.push(
				{icon: "🎲", label: "Roll Normal", action: () => target.click()},
				{icon: "⬆️", label: "Roll with Advantage", action: () => this._simulateModifiedClick(target, {shiftKey: true})},
				{icon: "⬇️", label: "Roll with Disadvantage", action: () => this._simulateModifiedClick(target, {ctrlKey: true})},
			);
		}

		// Attack item
		if (target.matches(".charsheet__attack-item")) {
			const rollBtn = target.querySelector(".charsheet__attack-roll");
			const dmgBtn = target.querySelector(".charsheet__attack-damage");
			items.push(
				{icon: "⚔️", label: "Roll Attack", action: () => rollBtn?.click()},
				{icon: "💥", label: "Roll Damage", action: () => dmgBtn?.click()},
				{icon: "⬆️", label: "Attack (Advantage)", action: () => this._simulateModifiedClick(rollBtn, {shiftKey: true})},
				{icon: "⬇️", label: "Attack (Disadvantage)", action: () => this._simulateModifiedClick(rollBtn, {ctrlKey: true})},
				{separator: true},
				{icon: "✏️", label: "Edit Attack", action: () => target.querySelector(".charsheet__attack-edit")?.click()},
			);
		}

		// Ability score
		if (target.matches(".charsheet__ability")) {
			items.push(
				{icon: "🎲", label: "Roll Check", action: () => target.click()},
				{icon: "⬆️", label: "Roll (Advantage)", action: () => this._simulateModifiedClick(target, {shiftKey: true})},
				{icon: "⬇️", label: "Roll (Disadvantage)", action: () => this._simulateModifiedClick(target, {ctrlKey: true})},
			);
		}

		// Inventory item
		if (target.matches(".charsheet__inventory-item")) {
			items.push(
				{icon: "🔍", label: "View Details", action: () => target.click()},
				{icon: "⚔️", label: "Equip/Unequip", action: () => target.querySelector(".charsheet__inventory-equip")?.click()},
				{icon: "🗑️", label: "Remove", action: () => target.querySelector(".charsheet__inventory-remove")?.click()},
			);
		}

		// Combat stat (initiative, AC)
		if (target.matches(".charsheet__combat-stat--clickable")) {
			items.push(
				{icon: "🎲", label: "Roll", action: () => target.click()},
				{icon: "⬆️", label: "Roll (Advantage)", action: () => this._simulateModifiedClick(target, {shiftKey: true})},
				{icon: "⬇️", label: "Roll (Disadvantage)", action: () => this._simulateModifiedClick(target, {ctrlKey: true})},
			);
		}

		return items;
	}

	// =========================================================================
	// Roll Modifier Toolbar
	// =========================================================================

	_initRollToolbar () {
		this._elRollToolbar = this._createRollToolbar();
		document.body.appendChild(this._elRollToolbar);

		// Intercept taps on rollable elements
		document.addEventListener("click", (e) => {
			if (!this._isMobile) return;

			const rollable = e.target.closest(
				".charsheet__skill-row, .charsheet__save-row, "
				+ ".charsheet__ability[data-ability], .charsheet__combat-stat--initiative, "
				+ ".charsheet__attack-roll",
			);

			if (!rollable) {
				this._hideRollToolbar();
				return;
			}

			// On mobile, intercept the click and show toolbar instead
			if (this._isRollToolbarNeeded(rollable)) {
				e.preventDefault();
				e.stopPropagation();
				this._showRollToolbar(rollable);
			}
		}, {capture: true});
	}

	_isRollToolbarNeeded (target) {
		// Only show toolbar for elements that support advantage/disadvantage
		return target.matches(
			".charsheet__skill-row, .charsheet__save-row, "
			+ ".charsheet__ability[data-ability], .charsheet__combat-stat--initiative, "
			+ ".charsheet__attack-roll",
		);
	}

	_showRollToolbar (target) {
		this._rollTarget = target;
		this._elRollToolbar.classList.add("charsheet-mobile--visible");
		this._haptic("light");
	}

	_hideRollToolbar () {
		this._elRollToolbar?.classList.remove("charsheet-mobile--visible");
		this._rollTarget = null;
	}

	_createRollToolbar () {
		const el = document.createElement("div");
		el.className = "charsheet-mobile__roll-toolbar";
		el.innerHTML = `
			<button class="charsheet-mobile__roll-toolbar-btn charsheet-mobile__roll-toolbar-btn--advantage" data-roll="advantage">
				⬆️ Adv.
			</button>
			<button class="charsheet-mobile__roll-toolbar-btn" data-roll="normal">
				🎲 Normal
			</button>
			<button class="charsheet-mobile__roll-toolbar-btn charsheet-mobile__roll-toolbar-btn--disadvantage" data-roll="disadvantage">
				⬇️ Disadv.
			</button>
			<button class="charsheet-mobile__roll-toolbar-close" data-roll="close">✕</button>
		`;

		el.addEventListener("click", (e) => {
			const btn = e.target.closest("[data-roll]");
			if (!btn) return;

			const rollType = btn.dataset.roll;

			if (rollType === "close") {
				this._hideRollToolbar();
				return;
			}

			if (!this._rollTarget) return;

			switch (rollType) {
				case "advantage":
					this._simulateModifiedClick(this._rollTarget, {shiftKey: true});
					break;
				case "disadvantage":
					this._simulateModifiedClick(this._rollTarget, {ctrlKey: true});
					break;
				case "normal":
				default:
					this._simulateModifiedClick(this._rollTarget, {});
					break;
			}

			this._haptic("medium");
			this._hideRollToolbar();
		});

		return el;
	}

	// =========================================================================
	// Floating Action Button (FAB)
	// =========================================================================

	_initFab () {
		this._elFab = this._createFab();
		document.body.appendChild(this._elFab);
	}

	_createFab () {
		const el = document.createElement("div");
		el.className = "charsheet-mobile__fab";
		el.innerHTML = `
			<button class="charsheet-mobile__fab-main" id="charsheet-mobile-fab-toggle" title="Quick Actions">
				⚡
			</button>
			<div class="charsheet-mobile__fab-actions">
				<div class="charsheet-mobile__fab-action" data-action="short-rest">
					<span class="charsheet-mobile__fab-action-label">Short Rest</span>
					<span class="charsheet-mobile__fab-action-btn">🏕️</span>
				</div>
				<div class="charsheet-mobile__fab-action" data-action="long-rest">
					<span class="charsheet-mobile__fab-action-label">Long Rest</span>
					<span class="charsheet-mobile__fab-action-btn">🛏️</span>
				</div>
				<div class="charsheet-mobile__fab-action" data-action="initiative">
					<span class="charsheet-mobile__fab-action-label">Roll Initiative</span>
					<span class="charsheet-mobile__fab-action-btn">⚡</span>
				</div>
				<div class="charsheet-mobile__fab-action" data-action="death-save">
					<span class="charsheet-mobile__fab-action-label">Death Save</span>
					<span class="charsheet-mobile__fab-action-btn">💀</span>
				</div>
			</div>
		`;

		// Toggle FAB
		const mainBtn = el.querySelector(".charsheet-mobile__fab-main");
		mainBtn.addEventListener("click", () => {
			this._fabOpen = !this._fabOpen;
			mainBtn.classList.toggle("charsheet-mobile__fab--open", this._fabOpen);
			this._haptic("light");
		});

		// FAB actions
		el.addEventListener("click", (e) => {
			const action = e.target.closest("[data-action]");
			if (!action) return;

			const actionType = action.dataset.action;
			this._executeFabAction(actionType);
			this._fabOpen = false;
			mainBtn.classList.remove("charsheet-mobile__fab--open");
		});

		return el;
	}

	_executeFabAction (actionType) {
		switch (actionType) {
			case "short-rest":
				document.getElementById("charsheet-btn-short-rest")?.click();
				break;
			case "long-rest":
				document.getElementById("charsheet-btn-long-rest")?.click();
				break;
			case "initiative":
				document.getElementById("charsheet-roll-initiative")?.click()
					|| document.getElementById("charsheet-box-initiative")?.click();
				break;
			case "death-save":
				document.getElementById("charsheet-btn-deathsave")?.click();
				break;
		}
		this._haptic("medium");
	}

	// =========================================================================
	// Header Toggle
	// =========================================================================

	_initHeaderToggle () {
		const moreBtn = document.getElementById("charsheet-btn-more");
		const secondaryRow = document.getElementById("charsheet-header-secondary");

		if (!moreBtn || !secondaryRow) return;

		// On mobile, the secondary row starts collapsed (CSS handles initial state)
		// The More button toggles it
		moreBtn.addEventListener("click", () => {
			secondaryRow.classList.toggle("charsheet-mobile--expanded");
			this._haptic("light");
		});
	}

	// =========================================================================
	// Touch Feedback
	// =========================================================================

	_initTouchFeedback () {
		const interactiveSelectors = [
			".charsheet__icon-btn",
			".charsheet__action-btn",
			".charsheet__tool-btn",
			".charsheet__quick-action",
			".charsheet__skill-row",
			".charsheet__save-row",
			".charsheet__attack-roll",
			".charsheet__attack-damage",
			".ve-btn",
		].join(", ");

		document.addEventListener("touchstart", (e) => {
			const target = e.target.closest(interactiveSelectors);
			if (target) {
				target.classList.add("charsheet-mobile--touch-active");
			}
		}, {passive: true});

		document.addEventListener("touchend", () => {
			document.querySelectorAll(".charsheet-mobile--touch-active").forEach(el => {
				setTimeout(() => el.classList.remove("charsheet-mobile--touch-active"), 300);
			});
		}, {passive: true});
	}

	// =========================================================================
	// Modal Scroll Lock
	// =========================================================================

	_initModalScrollLock () {
		// Watch for modal overlays appearing/disappearing
		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					if (node.nodeType === 1 && node.classList?.contains("ve-ui-modal__overlay")) {
						document.body.classList.add("charsheet-mobile--no-scroll");
					}
				}
				for (const node of mutation.removedNodes) {
					if (node.nodeType === 1 && node.classList?.contains("ve-ui-modal__overlay")) {
						// Check if any other modals remain
						const remaining = document.querySelectorAll(".ve-ui-modal__overlay");
						if (!remaining.length) {
							document.body.classList.remove("charsheet-mobile--no-scroll");
						}
					}
				}
			}
		});

		observer.observe(document.body, {childList: true});
	}

	// =========================================================================
	// Utilities
	// =========================================================================

	_simulateModifiedClick (target, modifiers = {}) {
		if (!target) return;
		const event = new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			shiftKey: modifiers.shiftKey || false,
			ctrlKey: modifiers.ctrlKey || false,
			metaKey: modifiers.metaKey || false,
			altKey: modifiers.altKey || false,
		});
		target.dispatchEvent(event);
	}

	_haptic (intensity = "light") {
		if (!navigator.vibrate) return;
		switch (intensity) {
			case "light": navigator.vibrate(10); break;
			case "medium": navigator.vibrate(25); break;
			case "heavy": navigator.vibrate([25, 50, 25]); break;
		}
	}
}

// Auto-initialize when DOM is ready
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", () => {
		if (document.querySelector(".charsheet-page")) {
			window._charsheetMobile = new CharacterSheetMobile(window._charsheetPage);
		}
	});
} else {
	if (document.querySelector(".charsheet-page")) {
		window._charsheetMobile = new CharacterSheetMobile(window._charsheetPage);
	}
}
