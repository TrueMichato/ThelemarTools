export class ListVirtualLayout {
	constructor (heights = []) {
		this.reset(heights);
	}

	reset (heights) {
		this._heights = [...heights];
		this._tree = new Float64Array(heights.length + 1);
		for (let i = 1; i < this._tree.length; ++i) {
			this._tree[i] += heights[i - 1];
			const parent = i + (i & -i);
			if (parent < this._tree.length) this._tree[parent] += this._tree[i];
		}
	}

	get length () { return this._heights.length; }
	get total () { return this.offset(this.length); }

	offset (index) {
		let out = 0;
		for (let i = index; i > 0; i -= i & -i) out += this._tree[i];
		return out;
	}

	height (index) { return this._heights[index]; }

	setHeight (index, height) {
		if (!(height > 0) || !Number.isFinite(height)) throw new Error(`Invalid virtual row height: ${height}`);
		const delta = height - this._heights[index];
		if (Math.abs(delta) < 0.1) return false;
		this._heights[index] = height;
		for (let i = index + 1; i < this._tree.length; i += i & -i) this._tree[i] += delta;
		return true;
	}

	indexAt (offset) {
		if (!this.length) return -1;
		let index = 0;
		let sum = 0;
		for (let step = 2 ** Math.floor(Math.log2(this.length)); step; step = Math.floor(step / 2)) {
			const next = index + step;
			if (next <= this.length && sum + this._tree[next] <= offset) {
				sum += this._tree[next];
				index = next;
			}
		}
		return Math.min(index, this.length - 1);
	}
}

/** DOM windowing is independent of the list's search, filter, sort, and selection model. */
export class ListVirtualRenderer {
	static THRESHOLD = 200;
	static ESTIMATED_HEIGHT = 16;

	constructor ({list, wrpList}) {
		this._list = list;
		this._wrpList = wrpList;
		this._items = [];
		this._indices = new Map();
		this._heights = new Map();
		this._layout = new ListVirtualLayout();
		this._cache = new Map();
		this._mounted = [];
		this._spacers = [];
		this._isRenderAll = false;
		this._frame = null;
		this._width = wrpList.clientWidth;
		this._initialOverflowAnchor = wrpList.style.overflowAnchor;
		this._isDestroyed = false;
		this._onScroll = () => this._schedule();
		this._onKeydown = evt => this._handleTab(evt);
		this._onFocus = () => this._schedule();
		this._onResize = () => this.invalidateMeasurements();
		this._resizeObserver = new ResizeObserver(() => {
			if (this._width !== this._wrpList.clientWidth && this._wrpList.clientWidth) {
				this._width = this._wrpList.clientWidth;
				this.invalidateMeasurements();
			} else this._schedule();
		});
		this._resizeObserver.observe(wrpList);
		wrpList.addEventListener("scroll", this._onScroll, {passive: true});
		wrpList.addEventListener("keydown", this._onKeydown);
		wrpList.addEventListener("focusin", this._onFocus);
		wrpList.addEventListener("focusout", this._onFocus);
		window.addEventListener("resize", this._onResize);
		document.fonts?.addEventListener("loadingdone", this._onResize);
		wrpList.setAttribute("role", "list");
	}

	get isVirtual () { return !this._isRenderAll && this._items.length > this.constructor.THRESHOLD; }
	get renderedItems () { return this._mounted; }

	onMaterialize (item) {
		this._cache.delete(item);
		this._cache.set(item, true);
		this._schedule();
	}

	update (items) {
		const isChanged = items.length !== this._items.length || items.some((item, i) => item !== this._items[i]);
		if (isChanged) {
			this._items = [...items];
			this._indices = new Map(items.map((item, i) => [item, i]));
			this._resetLayout();
			this._wrpList.scrollTop = 0;
		}
		this._render();
	}

	setRenderingMode ({isRenderAll}) {
		const anchor = this._getAnchor();
		this._isRenderAll = isRenderAll;
		this._render();
		if (anchor) {
			this.scrollToItem(anchor.item, {align: "start"});
			this._wrpList.scrollTop = this._layout.offset(this._indices.get(anchor.item)) + anchor.offset;
			this._render();
		}
	}

	_resetLayout () {
		this._layout.reset(this._items.map(item => this._heights.get(item) || this.constructor.ESTIMATED_HEIGHT));
	}

	invalidateMeasurements () {
		if (this._isDestroyed) return;
		const anchor = this._getAnchor();
		const anchorHeight = anchor ? this._layout.height(this._indices.get(anchor.item)) : null;
		this._heights.clear();
		// An expanded anchor may span several screens; replacing it with an estimate loses its identity.
		if (anchor) this._heights.set(anchor.item, Math.max(anchorHeight, anchor.offset + 1));
		this._resetLayout();
		if (anchor) this._wrpList.scrollTop = this._layout.offset(this._indices.get(anchor.item)) + anchor.offset;
		this._schedule();
	}

	_getAnchor () {
		if (!this._items.length) return null;
		const index = this._layout.indexAt(this._wrpList.scrollTop);
		return {item: this._items[index], offset: this._wrpList.scrollTop - this._layout.offset(index)};
	}

	_schedule () {
		if (this._frame != null || this._isDestroyed) return;
		this._frame = requestAnimationFrame(() => {
			this._frame = null;
			this._render();
		});
	}

	_getFocusedItem () {
		const active = document.activeElement;
		return this._mounted.find(item => item.peekEle()?.contains(active));
	}

	_getRange () {
		if (!this.isVirtual) return {start: 0, end: this._items.length};
		const height = Math.max(1, this._wrpList.clientHeight);
		const overscan = Math.max(200, height);
		const start = Math.max(0, this._layout.indexAt(Math.max(0, this._wrpList.scrollTop - overscan)));
		const end = Math.min(this._items.length, this._layout.indexAt(this._wrpList.scrollTop + height + overscan) + 1);
		return {start, end};
	}

	_getSpacer (index, height) {
		if (!this._spacers[index]) {
			const ele = document.createElement("div");
			ele.className = "ve-lst__virtual-spacer";
			ele.setAttribute("aria-hidden", "true");
			ele.style.pointerEvents = "none";
			ele.style.flexShrink = "0";
			this._spacers[index] = ele;
		}
		const ele = this._spacers[index];
		ele.style.height = `${Math.max(0, height)}px`;
		return ele;
	}

	_render () {
		if (this._isDestroyed) return;
		this._wrpList.style.overflowAnchor = this.isVirtual ? "none" : this._initialOverflowAnchor;
		const anchor = this._getAnchor();
		const active = document.activeElement;
		const focusedItem = this._getFocusedItem();
		const {start, end} = this._getRange();
		const indices = Array.from({length: end - start}, (_, i) => start + i);
		const focusedIndex = this._indices.get(focusedItem);
		if (focusedIndex != null && (focusedIndex < start || focusedIndex >= end)) indices.push(focusedIndex);
		indices.sort((a, b) => a - b);
		const nextMounted = indices.map(index => this._items[index]);
		const mountedSet = new Set(nextMounted);
		const previousMounted = new Set(this._mounted);
		for (const item of this._mounted) {
			if (!mountedSet.has(item) && item.peekEle()) this._resizeObserver.unobserve(item.peekEle());
		}
		const nodes = [];
		let previous = 0;
		let spacerIndex = 0;
		for (const index of indices) {
			if (this.isVirtual && index > previous) nodes.push(this._getSpacer(spacerIndex++, this._layout.offset(index) - this._layout.offset(previous)));
			const item = this._items[index];
			const ele = item.ele;
			item.runElementRenderHooks();
			ele.setAttribute("role", "listitem");
			ele.setAttribute("aria-posinset", `${index + 1}`);
			ele.setAttribute("aria-setsize", `${this._items.length}`);
			nodes.push(ele);
			this._cache.delete(item);
			this._cache.set(item, true);
			if (!previousMounted.has(item)) this._resizeObserver.observe(ele);
			previous = index + 1;
		}
		if (this.isVirtual && previous < this._items.length) nodes.push(this._getSpacer(spacerIndex, this._layout.total - this._layout.offset(previous)));
		const nodeSet = new Set(nodes);
		for (const node of [...this._wrpList.childNodes]) {
			if (!nodeSet.has(node)) node.remove();
		}
		let cursor = this._wrpList.firstChild;
		for (const node of nodes) {
			if (cursor === node) cursor = cursor.nextSibling;
			else this._wrpList.insertBefore(node, cursor);
		}
		while (cursor) {
			const next = cursor.nextSibling;
			cursor.remove();
			cursor = next;
		}
		this._mounted = nextMounted;
		if (focusedItem && mountedSet.has(focusedItem) && active !== document.activeElement) active.focus({preventScroll: true});

		const measurements = nextMounted.map(item => ({item, height: item.peekEle().getBoundingClientRect().height}));
		let isChanged = false;
		for (const {item, height} of measurements) {
			if (!height) continue;
			this._heights.set(item, height);
			isChanged = this._layout.setHeight(this._indices.get(item), height) || isChanged;
		}
		if (isChanged) {
			if (anchor && this._indices.has(anchor.item)) {
				const index = this._indices.get(anchor.item);
				this._wrpList.scrollTop = this._layout.offset(index) + Math.max(0, Math.min(anchor.offset, this._layout.height(index) - 1));
			}
			this._schedule();
		}
		this._trimCache(mountedSet);
		this._list._trigger("rendered");
	}

	_trimCache (mountedSet) {
		const limit = Math.max(this.constructor.THRESHOLD, this._mounted.length * 2);
		for (const item of this._cache.keys()) {
			if (this._cache.size <= limit) break;
			if (mountedSet.has(item)) continue;
			item.disposeElement();
			this._cache.delete(item);
		}
	}

	removeItem (item) {
		if (item.peekEle()) this._resizeObserver.unobserve(item.peekEle());
		item.disposeElement();
		this._cache.delete(item);
		this._heights.delete(item);
	}

	scrollToItem (item, {isFocus = false, align = "nearest", isLast = false} = {}) {
		const index = this._indices.get(item);
		if (index == null) return false;
		for (let pass = 0; pass < 3; ++pass) {
			const top = this._layout.offset(index);
			const bottom = top + this._layout.height(index);
			const height = this._wrpList.clientHeight;
			if (align === "start" || top < this._wrpList.scrollTop) this._wrpList.scrollTop = top;
			else if (bottom > this._wrpList.scrollTop + height) this._wrpList.scrollTop = Math.max(0, Math.min(top, bottom - height));
			this._render();
		}
		if (isFocus) {
			const targets = this._getFocusTargets(item);
			const target = isLast ? targets.at(-1) : targets[0];
			if (target) target.focus({preventScroll: true});
		}
		return true;
	}

	refresh () {
		this._render();
	}

	_getFocusTargets (item) {
		return [...item.ele.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]")]
			.filter(ele => ele.tabIndex >= 0 && ele.getClientRects().length);
	}

	_handleTab (evt) {
		if (evt.key !== "Tab" || evt.ctrlKey || evt.metaKey || evt.altKey) return;
		const item = this._getFocusedItem();
		if (!item) return;
		const targets = this._getFocusTargets(item);
		const boundary = evt.shiftKey ? targets[0] : targets.at(-1);
		if (evt.target !== boundary) return;
		const next = this._items[this._indices.get(item) + (evt.shiftKey ? -1 : 1)];
		if (!next) return;
		evt.preventDefault();
		this.scrollToItem(next, {isFocus: true, isLast: evt.shiftKey});
	}

	destroy () {
		this._isDestroyed = true;
		if (this._frame != null) cancelAnimationFrame(this._frame);
		this._resizeObserver.disconnect();
		this._wrpList.removeEventListener("scroll", this._onScroll);
		this._wrpList.removeEventListener("keydown", this._onKeydown);
		this._wrpList.removeEventListener("focusin", this._onFocus);
		this._wrpList.removeEventListener("focusout", this._onFocus);
		window.removeEventListener("resize", this._onResize);
		document.fonts?.removeEventListener("loadingdone", this._onResize);
		this._spacers.forEach(ele => ele.remove());
		this._wrpList.style.overflowAnchor = this._initialOverflowAnchor;
		this._cache.clear();
		this._heights.clear();
	}
}
