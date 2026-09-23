const _decodeHtml = (html) => String(html || "")
	.replace(/&nbsp;/g, "\u00a0")
	.replace(/&amp;/g, "&")
	.replace(/&lt;/g, "<")
	.replace(/&gt;/g, ">")
	.replace(/&quot;/g, "\"")
	.replace(/&#39;/g, "'");

class FakeClassList {
	constructor (owner) {
		this._owner = owner;
	}

	_getClasses () {
		return new Set(String(this._owner.className || "").split(/\s+/g).filter(Boolean));
	}

	_setClasses (classes) {
		this._owner.className = [...classes].join(" ");
	}

	add (...names) {
		const classes = this._getClasses();
		names.forEach(name => classes.add(name));
		this._setClasses(classes);
	}

	remove (...names) {
		const classes = this._getClasses();
		names.forEach(name => classes.delete(name));
		this._setClasses(classes);
	}

	toggle (name, force) {
		const classes = this._getClasses();
		const isActive = force == null ? !classes.has(name) : !!force;
		if (isActive) classes.add(name);
		else classes.delete(name);
		this._setClasses(classes);
		return isActive;
	}

	contains (name) {
		return this._getClasses().has(name);
	}
}

class FakeElement {
	constructor (tagName, ownerDocument = null) {
		this.tagName = String(tagName || "div").toUpperCase();
		this.ownerDocument = ownerDocument;
		this.parentElement = null;
		this._children = [];
		this._text = "";
		this._attributes = new Map();
		this._listeners = {};
		this._className = "";
		this.classList = new FakeClassList(this);
		this.style = {};
		this.dataset = {};
		this.value = "";
		this.checked = false;
		this.disabled = false;
		this.hidden = false;
		this.tabIndex = 0;
	}

	get className () {
		return this._className;
	}

	set className (value) {
		this._className = String(value || "");
		this._attributes.set("class", this._className);
	}

	get childNodes () {
		return this._children;
	}

	get children () {
		return this._children.filter(child => child instanceof FakeElement);
	}

	get childElementCount () {
		return this.children.length;
	}

	get options () {
		return this.tagName === "SELECT"
			? this.children.filter(child => child.tagName === "OPTION")
			: undefined;
	}

	get textContent () {
		return `${this._text}${this._children.map(child => child.textContent || "").join("")}`;
	}

	set textContent (value) {
		this._text = value == null ? "" : String(value);
		this._children = [];
	}

	get innerHTML () {
		return this.textContent;
	}

	set innerHTML (value) {
		this._children = [];
		this._text = _decodeHtml(String(value || "").replace(/<[^>]+>/g, ""));
	}

	append (...children) {
		children
			.flat()
			.filter(child => child != null)
			.forEach(child => {
				child.parentElement = this;
				this._children.push(child);
				if (
					this.tagName === "SELECT"
					&& child.tagName === "OPTION"
					&& this._children.filter(it => it.tagName === "OPTION").length === 1
				) this.value = child.value;
			});
	}

	appendChild (child) {
		this.append(child);
		return child;
	}

	setAttribute (name, value) {
		const cleanValue = String(value);
		this._attributes.set(name, cleanValue);
		if (name === "class") this.className = cleanValue;
		if (name === "value") this.value = cleanValue;
		if (name === "tabindex") this.tabIndex = Number(cleanValue);
		if (name === "disabled") this.disabled = true;
		if (name === "checked") this.checked = true;
	}

	getAttribute (name) {
		return this._attributes.get(name) ?? null;
	}

	addEventListener (type, listener) {
		(this._listeners[type] ||= []).push(listener);
	}

	focus () {
		if (this.ownerDocument) this.ownerDocument.activeElement = this;
	}
}

class FakeOptionElement extends FakeElement {
	constructor (ownerDocument) {
		super("option", ownerDocument);
	}
}

class FakeDocumentFragment {
	constructor (children = []) {
		this.childNodes = children;
	}
}

class FakeTemplateElement extends FakeElement {
	constructor (ownerDocument) {
		super("template", ownerDocument);
		this.content = new FakeDocumentFragment();
	}

	set innerHTML (html) {
		const cleanHtml = String(html || "").trim();
		const match = cleanHtml.match(/^<([a-z0-9-]+)([^>]*)>([\s\S]*)<\/\1>$/i);
		if (!match) throw new Error(`Unsupported test HTML: ${cleanHtml}`);

		const [, tagName, rawAttributes, inner] = match;
		const element = this.ownerDocument.createElement(tagName);
		for (const attrMatch of rawAttributes.matchAll(/([a-z0-9-]+)="([^"]*)"/gi)) {
			element.setAttribute(attrMatch[1], _decodeHtml(attrMatch[2]));
		}
		if (inner) element.textContent = _decodeHtml(inner.replace(/<[^>]+>/g, ""));
		this.content = new FakeDocumentFragment([element]);
	}

	get innerHTML () {
		return "";
	}
}

class FakeDocument {
	constructor () {
		this.activeElement = null;
		this.body = new FakeElement("body", this);
	}

	createElement (tagName) {
		if (String(tagName).toLowerCase() === "template") return new FakeTemplateElement(this);
		if (String(tagName).toLowerCase() === "option") return new FakeOptionElement(this);
		return new FakeElement(tagName, this);
	}

	createTextNode (text) {
		const element = new FakeElement("#text", this);
		element.textContent = text;
		return element;
	}

	getElementById (id) {
		return findElements(this.body, element => element.getAttribute("id") === id)[0] || null;
	}

	querySelector (selector) {
		return this.querySelectorAll(selector)[0] || null;
	}

	querySelectorAll (selector) {
		return findElements(this.body, element => {
			if (selector.startsWith(".")) return element.classList.contains(selector.slice(1));
			return element.tagName === selector.toUpperCase();
		}).slice(1);
	}

	addEventListener () {}
	removeEventListener () {}
}

export function findElements (root, predicate) {
	const out = [];
	const visit = (element) => {
		if (!(element instanceof FakeElement)) return;
		if (predicate(element)) out.push(element);
		element.childNodes.forEach(visit);
	};
	visit(root);
	return out;
}

export function installElementUtilTestDom () {
	if (!globalThis.ElementUtil?.getOrModify) throw new Error("Load js/utils.js before installing the ElementUtil test DOM.");

	const previous = {
		Element: globalThis.Element,
		HTMLElement: globalThis.HTMLElement,
		HTMLOptionElement: globalThis.HTMLOptionElement,
		document: globalThis.document,
		e_: globalThis.e_,
		windowDocument: globalThis.window?.document,
		windowE_: globalThis.window?.e_,
	};
	const document = new FakeDocument();
	const e_ = globalThis.ElementUtil.getOrModify.bind(globalThis.ElementUtil);

	globalThis.Element = FakeElement;
	globalThis.HTMLElement = FakeElement;
	globalThis.HTMLOptionElement = FakeOptionElement;
	globalThis.document = document;
	globalThis.e_ = e_;
	if (globalThis.window) {
		globalThis.window.document = document;
		globalThis.window.e_ = e_;
	}

	return {
		document,
		e_,
		restore: () => {
			if (previous.Element === undefined) delete globalThis.Element;
			else globalThis.Element = previous.Element;
			if (previous.HTMLElement === undefined) delete globalThis.HTMLElement;
			else globalThis.HTMLElement = previous.HTMLElement;
			if (previous.HTMLOptionElement === undefined) delete globalThis.HTMLOptionElement;
			else globalThis.HTMLOptionElement = previous.HTMLOptionElement;
			if (previous.document === undefined) delete globalThis.document;
			else globalThis.document = previous.document;
			if (previous.e_ === undefined) delete globalThis.e_;
			else globalThis.e_ = previous.e_;
			if (globalThis.window) {
				if (previous.windowDocument === undefined) delete globalThis.window.document;
				else globalThis.window.document = previous.windowDocument;
				if (previous.windowE_ === undefined) delete globalThis.window.e_;
				else globalThis.window.e_ = previous.windowE_;
			}
		},
	};
}
