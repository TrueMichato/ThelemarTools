/**
 * Character Sheet — Mobile Interaction Module
 * Provides touch-optimized interactions for mobile devices:
 * - Mobile detection
 * - Swipe navigation between tabs (with scrollable-container exclusion)
 * - Long-press context menus (replaces right-click)
 * - Roll modifier toolbar (replaces Shift+click / Ctrl+click)
 * - Floating Action Button (FAB) with backdrop
 * - Collapsible sections with smooth animation
 * - Haptic feedback
 * - iOS safe-area and viewport fixes
 * - Scroll-position-preserving modal scroll lock
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
		this._longPressTarget = null;
		this._longPressFired = false;
		this._rollTarget = null;
		this._fabOpen = false;
		this._contextMenuVisible = false;
		this._scrollYBeforeLock = 0;

		// Guard against duplicate initialization on resize
		this._mobileInitialized = false;

		// Elements (created lazily)
		this._elRollToolbar = null;
		this._elContextMenu = null;
		this._elFab = null;
		this._elFabBackdrop = null;

		// Bound handlers for cleanup
		this._boundOnResize = this._onResize.bind(this);
		this._boundLongPressStart = this._onLongPressStart.bind(this);
		this._boundLongPressMove = this._onLongPressMove.bind(this);
		this._boundLongPressEnd = this._onLongPressEnd.bind(this);

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

		// Set CSS custom property for iOS dynamic viewport height
		this._updateViewportHeight();

		if (this._isMobile) {
			document.body.classList.add("is-charsheet-mobile");
			this._initMobileLayout();
		}

		// Re-evaluate on resize/orientation change
		window.addEventListener("resize", this._boundOnResize);
		window.addEventListener("orientationchange", () => {
			setTimeout(() => {
				this._updateViewportHeight();
				this._boundOnResize();
			}, 150);
		});
	}

	_initMobileLayout () {
		if (this._mobileInitialized) return;
		this._mobileInitialized = true;

		this._initCollapsibleSections();
		this._initSwipeNavigation();
		this._initLongPress();
		this._initRollToolbar();
		this._initFab();
		this._initHeaderToggle();
		this._initTouchFeedback();
		this._initModalScrollLock();
		this._initDropdownMobilePositioning();

		// Scroll active tab into view on load
		requestAnimationFrame(() => {
			const activeTab = document.querySelector("#charsheet-tabs > li.ve-active");
			activeTab?.scrollIntoView({behavior: "smooth", inline: "center", block: "nearest"});
		});
	}

	_onResize () {
		const wasMobile = this._isMobile;
		this._isMobile = CharacterSheetMobile.isMobile();
		this._updateViewportHeight();

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
		this._elFabBackdrop?.remove();
		this._elRollToolbar = null;
		this._elContextMenu = null;
		this._elFab = null;
		this._elFabBackdrop = null;

		// Disconnect header observer
		this._headerObserver?.disconnect();
		this._headerObserver = null;

		// Remove global touch listeners added by _initLongPress and _initTouchFeedback
		document.removeEventListener("touchstart", this._boundLongPressStart);
		document.removeEventListener("touchmove", this._boundLongPressMove);
		document.removeEventListener("touchend", this._boundLongPressEnd);
		if (this._boundTouchFeedbackStart) {
			document.removeEventListener("touchstart", this._boundTouchFeedbackStart);
		}
		if (this._boundTouchFeedbackEnd) {
			document.removeEventListener("touchend", this._boundTouchFeedbackEnd);
		}

		// Unwrap section-content wrappers so desktop DOM is clean
		document.querySelectorAll(".charsheet-mobile__section-content").forEach(wrapper => {
			const parent = wrapper.parentNode;
			while (wrapper.firstChild) {
				parent.insertBefore(wrapper.firstChild, wrapper);
			}
			wrapper.remove();
		});

		// Clear collapsible data attributes so they can be re-initialized
		document.querySelectorAll("[data-mobile-collapsible]").forEach(el => {
			delete el.dataset.mobileCollapsible;
		});

		// Uncollapse all sections
		document.querySelectorAll(".charsheet-mobile--collapsed").forEach(el => {
			el.classList.remove("charsheet-mobile--collapsed");
		});

		// Clear header toggle data
		const secondaryRow = document.getElementById("charsheet-header-secondary");
		if (secondaryRow) {
			delete secondaryRow.dataset.mobileToggle;
			secondaryRow.classList.remove("charsheet-mobile--expanded");
		}

		this._mobileInitialized = false;
	}

	/** Set --vh custom property for iOS Safari dynamic toolbar */
	_updateViewportHeight () {
		const vh = window.innerHeight * 0.01;
		document.documentElement.style.setProperty("--vh", `${vh}px`);
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

			// Skip if already initialized
			if (title.dataset.mobileCollapsible) return;
			title.dataset.mobileCollapsible = "true";

			// Wrap content for animated collapse (skip the title itself)
			const contentWrapper = document.createElement("div");
			contentWrapper.className = "charsheet-mobile__section-content";
			const children = [...section.children].filter(c => c !== title);
			children.forEach(c => contentWrapper.appendChild(c));
			section.appendChild(contentWrapper);

			// Collapse by default for specified sections
			const shouldCollapse = [...defaultCollapsed].some(cls => section.classList.contains(cls));
			if (shouldCollapse) {
				section.classList.add("charsheet-mobile--collapsed");
				contentWrapper.style.maxHeight = "0";
			} else {
				// Set initial max-height for animation
				contentWrapper.style.maxHeight = contentWrapper.scrollHeight + "px";
			}

			// Add tap-to-toggle behavior
			title.addEventListener("click", (e) => {
				// Don't toggle if clicking edit buttons within the title
				if (e.target.closest(".charsheet__section-edit, .ve-btn, button")) return;

				const isCollapsed = section.classList.toggle("charsheet-mobile--collapsed");

				if (isCollapsed) {
					contentWrapper.style.maxHeight = contentWrapper.scrollHeight + "px";
					// Force reflow then collapse
					contentWrapper.offsetHeight; // eslint-disable-line no-unused-expressions
					contentWrapper.style.maxHeight = "0";
				} else {
					contentWrapper.style.maxHeight = contentWrapper.scrollHeight + "px";
					// After transition, remove max-height to allow dynamic content changes
					const onTransitionEnd = () => {
						if (!section.classList.contains("charsheet-mobile--collapsed")) {
							contentWrapper.style.maxHeight = "none";
						}
						contentWrapper.removeEventListener("transitionend", onTransitionEnd);
					};
					contentWrapper.addEventListener("transitionend", onTransitionEnd);
				}

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

		// Selectors for containers that scroll horizontally — swipe should NOT trigger tab nav on these
		this._horizontalScrollSelectors = [
			".charsheet__spell-slots-grid",
			".charsheet__builder-steps",
			"#charsheet-tabs",
			".charsheet__header-row--primary",
		].join(", ");

		tabContent.addEventListener("touchstart", (e) => {
			if (e.touches.length !== 1) return;

			// Don't intercept swipes on horizontally-scrollable containers
			if (e.target.closest(this._horizontalScrollSelectors)) {
				this._swipeStartX = null;
				return;
			}

			this._swipeStartX = e.touches[0].clientX;
			this._swipeStartY = e.touches[0].clientY;
		}, {passive: true});

		tabContent.addEventListener("touchend", (e) => {
			if (this._swipeStartX == null) return;
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

			// Scroll the tab into view in the bottom bar
			tabs[newIdx].scrollIntoView({behavior: "smooth", inline: "center", block: "nearest"});

			// Scroll content to top on tab switch
			window.scrollTo({top: 0, behavior: "smooth"});
		}
	}

	// =========================================================================
	// Long Press (replaces right-click)
	// =========================================================================

	_initLongPress () {
		document.addEventListener("touchstart", this._boundLongPressStart, {passive: true});
		document.addEventListener("touchmove", this._boundLongPressMove, {passive: true});
		document.addEventListener("touchend", this._boundLongPressEnd, {passive: true});
	}

	_onLongPressStart (e) {
		const target = e.target.closest(
			".charsheet__skill-row, .charsheet__save-row, .charsheet__attack-item, "
			+ ".charsheet__ability, .charsheet__combat-stat--clickable, "
			+ ".charsheet__inventory-item, .charsheet__resource-item",
		);
		if (!target) return;

		this._longPressFired = false;
		this._longPressTarget = target;
		const touch = e.touches[0];
		// Capture touch coords now (event object won't be available later)
		const touchData = {clientX: touch.clientX, clientY: touch.clientY};

		this._longPressTimer = setTimeout(() => {
			this._longPressFired = true;
			this._haptic("medium");
			this._showContextMenu(target, touchData);
		}, this._longPressDuration);
	}

	_onLongPressMove () {
		this._cancelLongPress();
	}

	_onLongPressEnd (e) {
		this._cancelLongPress();

		// If long press fired, suppress the synthetic click that follows touchend.
		// preventDefault() on touchend doesn't prevent click — use a capture-phase
		// click blocker with a brief timing window instead.
		if (this._longPressFired) {
			this._longPressFired = false;
			const blocker = (evt) => {
				evt.stopPropagation();
				evt.preventDefault();
			};
			document.addEventListener("click", blocker, {capture: true, once: true});
			// Safety: remove blocker if the click never comes (e.g., scrolled away)
			setTimeout(() => {
				document.removeEventListener("click", blocker, {capture: true});
			}, 500);
		}
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
		this._hideRollToolbar();

		if (!this._elContextMenu) {
			this._elContextMenu = this._createContextMenu();
			document.body.appendChild(this._elContextMenu);
		}

		// Build menu items based on target type
		const items = this._getContextMenuItems(target);
		if (!items.length) return;

		const contentEl = this._elContextMenu.querySelector(".charsheet-mobile__context-menu-items");
		contentEl.innerHTML = "";

		// Add a header showing what element this is for
		const label = this._getTargetLabel(target);
		if (label) {
			const header = document.createElement("div");
			header.className = "charsheet-mobile__context-menu-header";
			header.textContent = label;
			contentEl.appendChild(header);
		}

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

		// Position: ensure menu doesn't overflow screen or go behind bottom tab bar
		const tabBarHeight = 60;
		const menuWidth = 200;
		const menuEstHeight = items.length * 48 + (label ? 36 : 0);
		const x = Math.max(8, Math.min(touch.clientX, window.innerWidth - menuWidth - 8));
		const y = Math.max(8, Math.min(touch.clientY - 20, window.innerHeight - tabBarHeight - menuEstHeight - 8));
		this._elContextMenu.style.left = `${x}px`;
		this._elContextMenu.style.top = `${y}px`;
		this._elContextMenu.classList.add("charsheet-mobile--visible");
		this._contextMenuVisible = true;

		// Close on outside tap
		setTimeout(() => {
			document.addEventListener("touchstart", this._hideContextMenuHandler = (evt) => {
				if (this._elContextMenu?.contains(evt.target)) return;
				this._hideContextMenu();
			}, {once: true, capture: true});
		}, 50);
	}

	_hideContextMenu () {
		if (this._elContextMenu) {
			this._elContextMenu.classList.remove("charsheet-mobile--visible");
		}
		this._contextMenuVisible = false;
		if (this._hideContextMenuHandler) {
			document.removeEventListener("touchstart", this._hideContextMenuHandler, {capture: true});
			this._hideContextMenuHandler = null;
		}
	}

	_createContextMenu () {
		const el = document.createElement("div");
		el.className = "charsheet-mobile__context-menu";
		el.innerHTML = `<div class="charsheet-mobile__context-menu-items"></div>`;
		return el;
	}

	/** Extract a human-readable label for the target element */
	_getTargetLabel (target) {
		// Skill row
		const skillName = target.querySelector(".charsheet__skill-name");
		if (skillName) return skillName.textContent.trim();

		// Save row
		const saveName = target.querySelector(".charsheet__save-name");
		if (saveName) return `${saveName.textContent.trim()} Save`;

		// Attack
		const attackName = target.querySelector(".charsheet__attack-name");
		if (attackName) return attackName.textContent.trim();

		// Ability
		const abilityLabel = target.querySelector(".charsheet__ability-label");
		if (abilityLabel) return abilityLabel.textContent.trim();

		// Inventory item
		const itemName = target.querySelector(".charsheet__inventory-name, .charsheet__resource-name");
		if (itemName) return itemName.textContent.trim();

		// Combat stat
		const statLabel = target.querySelector(".charsheet__combat-stat-label");
		if (statLabel) return statLabel.textContent.trim();

		return null;
	}

	_getContextMenuItems (target) {
		const items = [];

		// Skill/Save row
		if (target.matches(".charsheet__skill-row, .charsheet__save-row")) {
			items.push(
				{icon: "🎲", label: "Roll Normal", action: () => this._simulateModifiedClick(target, {})},
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
				{icon: "🎲", label: "Roll Check", action: () => this._simulateModifiedClick(target, {})},
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

		// Resource item
		if (target.matches(".charsheet__resource-item")) {
			items.push(
				{icon: "✨", label: "Use Resource", action: () => target.querySelector(".charsheet__resource-use, .charsheet__resource-decrement")?.click()},
				{icon: "🔄", label: "Reset", action: () => target.querySelector(".charsheet__resource-reset")?.click()},
				{icon: "✏️", label: "Edit", action: () => target.querySelector(".charsheet__resource-edit")?.click()},
			);
		}

		// Combat stat (initiative, AC)
		if (target.matches(".charsheet__combat-stat--clickable")) {
			items.push(
				{icon: "🎲", label: "Roll", action: () => this._simulateModifiedClick(target, {})},
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

		// Tap on rollable elements shows the toolbar (does NOT block the click)
		// Normal tap = roll normally (click passes through to original handler)
		// The toolbar gives Adv/Disadv options for the NEXT roll
		document.addEventListener("click", (e) => {
			if (!this._isMobile) return;

			// Don't intercept clicks originating from inside the toolbar itself
			if (e.target.closest(".charsheet-mobile__roll-toolbar")) return;

			// Don't intercept if long press just fired (context menu is showing)
			if (this._contextMenuVisible) return;

			const rollable = e.target.closest(
				".charsheet__skill-row, .charsheet__save-row, "
				+ ".charsheet__ability[data-ability], .charsheet__combat-stat--initiative, "
				+ ".charsheet__attack-roll",
			);

			if (!rollable) {
				this._hideRollToolbar();
				return;
			}

			// Show the toolbar for this element — but let the click pass through
			// so the user gets a normal roll immediately. The toolbar stays visible
			// for subsequent Adv/Disadv rolls on the same target.
			this._showRollToolbar(rollable);
		});
	}

	_showRollToolbar (target) {
		this._rollTarget = target;

		// Update the label showing what we're rolling
		const label = this._getTargetLabel(target) || "Roll";
		const labelEl = this._elRollToolbar.querySelector(".charsheet-mobile__roll-toolbar-label");
		if (labelEl) labelEl.textContent = label;

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
			<span class="charsheet-mobile__roll-toolbar-label"></span>
			<div class="charsheet-mobile__roll-toolbar-buttons">
				<button class="charsheet-mobile__roll-toolbar-btn charsheet-mobile__roll-toolbar-btn--advantage" data-roll="advantage">
					⬆️ Adv.
				</button>
				<button class="charsheet-mobile__roll-toolbar-btn charsheet-mobile__roll-toolbar-btn--disadvantage" data-roll="disadvantage">
					⬇️ Disadv.
				</button>
				<button class="charsheet-mobile__roll-toolbar-close" data-roll="close">✕</button>
			</div>
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
			}

			this._haptic("medium");
			this._hideRollToolbar();
		});

		return el;
	}

	// =========================================================================
	// Floating Action Button (FAB) with Backdrop
	// =========================================================================

	_initFab () {
		this._elFabBackdrop = document.createElement("div");
		this._elFabBackdrop.className = "charsheet-mobile__fab-backdrop";
		this._elFabBackdrop.addEventListener("click", () => this._closeFab());
		document.body.appendChild(this._elFabBackdrop);

		this._elFab = this._createFab();
		document.body.appendChild(this._elFab);
	}

	_closeFab () {
		if (!this._fabOpen) return;
		this._fabOpen = false;
		const mainBtn = this._elFab?.querySelector(".charsheet-mobile__fab-main");
		mainBtn?.classList.remove("charsheet-mobile__fab--open");
		this._elFabBackdrop?.classList.remove("charsheet-mobile--visible");
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
			this._elFabBackdrop?.classList.toggle("charsheet-mobile--visible", this._fabOpen);
			this._haptic("light");
		});

		// FAB actions
		el.addEventListener("click", (e) => {
			const action = e.target.closest("[data-action]");
			if (!action) return;

			const actionType = action.dataset.action;
			this._executeFabAction(actionType);
			this._closeFab();
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
		const secondaryRow = document.getElementById("charsheet-header-secondary");
		if (!secondaryRow) return;

		// Skip if already initialized
		if (secondaryRow.dataset.mobileToggle) return;
		secondaryRow.dataset.mobileToggle = "true";

		// Hook into the existing More button — the desktop handler toggles
		// charsheet__header-row--collapsed. We listen for that class change and
		// sync our mobile-specific expanded class.
		// Use a state guard to prevent infinite loop (our toggle triggers another mutation).
		let lastKnownCollapsed = secondaryRow.classList.contains("charsheet__header-row--collapsed");
		this._headerObserver = new MutationObserver(() => {
			const isDesktopCollapsed = secondaryRow.classList.contains("charsheet__header-row--collapsed");
			if (isDesktopCollapsed === lastKnownCollapsed) return;
			lastKnownCollapsed = isDesktopCollapsed;
			secondaryRow.classList.toggle("charsheet-mobile--expanded", !isDesktopCollapsed);
		});
		this._headerObserver.observe(secondaryRow, {attributes: true, attributeFilter: ["class"]});
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

		this._boundTouchFeedbackStart = (e) => {
			const target = e.target.closest(interactiveSelectors);
			if (target) {
				target.classList.add("charsheet-mobile--touch-active");
			}
		};

		this._boundTouchFeedbackEnd = () => {
			document.querySelectorAll(".charsheet-mobile--touch-active").forEach(el => {
				setTimeout(() => el.classList.remove("charsheet-mobile--touch-active"), 300);
			});
		};

		document.addEventListener("touchstart", this._boundTouchFeedbackStart, {passive: true});
		document.addEventListener("touchend", this._boundTouchFeedbackEnd, {passive: true});
	}

	// =========================================================================
	// Modal Scroll Lock (preserves scroll position)
	// =========================================================================

	_initModalScrollLock () {
		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const node of mutation.addedNodes) {
					if (node.nodeType === 1 && node.classList?.contains("ve-ui-modal__overlay")) {
						this._lockScroll();
					}
				}
				for (const node of mutation.removedNodes) {
					if (node.nodeType === 1 && node.classList?.contains("ve-ui-modal__overlay")) {
						const remaining = document.querySelectorAll(".ve-ui-modal__overlay");
						if (!remaining.length) {
							this._unlockScroll();
						}
					}
				}
			}
		});

		observer.observe(document.body, {childList: true});
	}

	_lockScroll () {
		this._scrollYBeforeLock = window.scrollY;
		document.body.classList.add("charsheet-mobile--no-scroll");
		document.body.style.top = `-${this._scrollYBeforeLock}px`;
	}

	_unlockScroll () {
		document.body.classList.remove("charsheet-mobile--no-scroll");
		document.body.style.top = "";
		window.scrollTo(0, this._scrollYBeforeLock);
	}

	// =========================================================================
	// Dropdown Mobile Positioning
	// =========================================================================

	_initDropdownMobilePositioning () {
		// Watch for dropdown activation and re-position for mobile
		const dropdownSelectors = [
			".charsheet__theme-dropdown",
			".charsheet__font-dropdown",
			".charsheet__dice-dropdown",
			".charsheet__textsize-dropdown",
		];

		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				if (mutation.type !== "attributes" || mutation.attributeName !== "class") continue;
				const el = mutation.target;
				if (!dropdownSelectors.some(sel => el.matches(sel))) continue;

				if (el.classList.contains("active")) {
					this._repositionDropdown(el);
				}
			}
		});

		// Observe the header area where dropdowns live
		const header = document.querySelector(".charsheet__main-header");
		if (header) {
			observer.observe(header, {attributes: true, attributeFilter: ["class"], subtree: true});
		}
	}

	_repositionDropdown (dropdown) {
		if (!this._isMobile) return;

		// Clear previous inline positioning to avoid stale conflicts
		dropdown.style.left = "";
		dropdown.style.right = "";
		dropdown.style.maxHeight = "";
		dropdown.style.overflowY = "";

		// Re-read rect after clearing styles
		const rect = dropdown.getBoundingClientRect();
		const vpWidth = window.innerWidth;

		if (rect.right > vpWidth - 8) {
			dropdown.style.left = "auto";
			dropdown.style.right = "8px";
		}
		if (rect.left < 8) {
			dropdown.style.left = "8px";
			dropdown.style.right = "auto";
		}

		// Ensure dropdown doesn't extend beyond bottom tab bar
		const tabBarHeight = 60;
		const maxBottom = window.innerHeight - tabBarHeight;
		if (rect.bottom > maxBottom) {
			dropdown.style.maxHeight = `${maxBottom - rect.top - 8}px`;
			dropdown.style.overflowY = "auto";
		}
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
