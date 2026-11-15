/** Minimal element builder for cockpit modules: h("button.btn.btn--sm", {type: "button", onclick}, "Text", child). */
export function h (spec, attrs = null, ...children) {
	const [tag, ...classes] = spec.split(".");
	const ele = document.createElement(tag || "div");
	if (classes.length) ele.className = classes.join(" ");
	if (attrs) {
		for (const [key, value] of Object.entries(attrs)) {
			if (value == null || value === false) continue;
			if (key.startsWith("on") && typeof value === "function") ele.addEventListener(key.slice(2), value);
			else if (key === "dataset") Object.assign(ele.dataset, value);
			else if (key === "style" && typeof value === "object") Object.entries(value).forEach(([prop, v]) => ele.style.setProperty(prop, v));
			else if (key === "html") ele.innerHTML = value;
			else if (key === "class") ele.className = [ele.className, value].filter(Boolean).join(" ");
			else if (key in ele && typeof value !== "string" && key !== "list") ele[key] = value;
			else ele.setAttribute(key, value === true ? "" : `${value}`);
		}
	}
	appendChildren(ele, children);
	return ele;
}

function appendChildren (ele, children) {
	for (const child of children) {
		if (child == null || child === false) continue;
		if (Array.isArray(child)) appendChildren(ele, child);
		else ele.append(child instanceof Node ? child : `${child}`);
	}
}

/** Keyboard hint chips. */
export function kbd (labels) {
	return labels.map(label => h("kbd.ewc-kbd", {"aria-hidden": "true"}, label));
}

/** Replace a container's children while preserving focus on an element with the same data-ewc-fk key. */
export function replaceKeepingFocus (container, children) {
	const active = document.activeElement;
	const fk = active && container.contains(active) ? active.dataset?.ewcFk : null;
	const selStart = fk && "selectionStart" in active ? active.selectionStart : null;
	container.replaceChildren(...children);
	if (!fk) return;
	const next = container.querySelector(`[data-ewc-fk="${CSS.escape(fk)}"]`);
	if (!next) return;
	next.focus({preventScroll: true});
	if (selStart != null && typeof next.setSelectionRange === "function") {
		try { next.setSelectionRange(selStart, selStart); } catch (e) { /* not a text input */ }
	}
}
