export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
export const CR_CHOICES = ["0", "1/8", "1/4", "1/2", ...Array.from({length: 30}, (_, i) => String(i + 1))].map(it => [it, it]);
export const YES_NO = [["yes", "Yes"], ["no", "No"]];
export const MULTIPLIERS = [[0, "No proficiency contribution"], [1, "Proficient"], [2, "Expertise / double proficiency"]];
let nextFieldId = 0;

export function element (tag, {className, text} = {}) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text != null) node.textContent = text;
	return node;
}

export function button (text, onClick, className = "ve-btn ve-btn-default ve-btn-sm") {
	const node = element("button", {className, text});
	node.type = "button";
	node.addEventListener("click", onClick);
	return node;
}

export function paragraph (parent, text) {
	const node = element("p", {text});
	parent.append(node);
	return node;
}

export function group (parent, title, {open = true} = {}) {
	const node = element("details");
	node.open = open;
	node.append(element("summary", {text: title}));
	parent.append(node);
	return node;
}

export function describeFact (value) {
	if (value == null) return "Not present";
	if (Array.isArray(value)) return value.length ? value.map(describeFact).join("; ") : "None";
	if (typeof value !== "object") return typeof value === "string" ? Renderer.stripTags(value) : String(value);
	return Object.entries(value).map(([key, part]) => `${key}: ${describeFact(part)}`).join("; ");
}

export function entryFact (parent, entry) {
	paragraph(parent, `${entry.section}: ${entry.match.name} (${entry.match.source})`);
	paragraph(parent, Renderer.stripTags(describeFact(entry.entry.entries ?? entry.entry.headerEntries)));
}

export function createEditorFields ({onChange, error}) {
	const fields = [];
	const field = (parent, label, {options, type = "text", min, max, required = true, value, onEdit} = {}) => {
		const wrapper = element("label", {className: "bqa__field"});
		const input = element(options ? "select" : type === "textarea" ? "textarea" : "input", {className: "ve-form-control"});
		input.id = `bqa-source-field-${++nextFieldId}`;
		if (!options && type !== "textarea") input.type = type;
		if (options) {
			input.add(new Option("Choose…", ""));
			options.forEach(([value, name]) => input.add(new Option(name, String(value))));
		}
		if (type === "number") Object.assign(input, {min: String(min), max: String(max), step: "1"});
		else input.maxLength = 1000;
		input.required = required;
		if (value !== undefined) input.value = String(value);
		input.setAttribute("aria-describedby", error.id);
		wrapper.append(element("span", {className: "bqa__field-label", text: label}), input);
		parent.append(wrapper);
		const item = {node: input,
			read: () => input.value === "" ? undefined : type === "number" ? Number(input.value) : input.value,
			set: value => { input.value = value === undefined ? "" : String(value); }};
		fields.push(item);
		input.addEventListener(options ? "change" : "input", () => { onEdit?.(); onChange(); });
		return item;
	};
	const reason = (parent, label = "Reason / source policy") => field(parent, label, {type: "textarea"});
	const number = (parent, label, min, max, options = {}) => field(parent, label, {type: "number", min, max, ...options});
	const select = (parent, label, options, extra = {}) => field(parent, label, {options, ...extra});
	const bool = (parent, label) => {
		const input = select(parent, label, YES_NO);
		return () => input.read() === undefined ? undefined : input.read() === "yes";
	};
	const optional = (parent, label, render) => {
		const body = element("fieldset", {className: "bqa__transformation-optional"});
		const enabled = select(parent, label, [["declare", "Declare an explicit decision"]], {required: false,
			onEdit: () => { body.disabled = body.hidden = !enabled.read(); }});
		body.disabled = body.hidden = true;
		parent.append(body);
		const read = render(body);
		return () => enabled.read() ? read() : undefined;
	};
	const enabled = (node, root) => {
		if (!node.isConnected || !root.contains(node)) return false;
		for (let parent = node; parent; parent = parent.parentElement) {
			if (parent.disabled || parent.hidden) return false;
			if (parent === root) return true;
		}
		return false;
	};
	const missing = root => fields.filter(it => enabled(it.node, root) && it.node.required
		&& (it.read() === undefined || it.node.validity?.valid === false));
	const toggle = (input, body, test) => input.node.addEventListener("change", () => { body.hidden = body.disabled = !test(); }, {capture: true});
	return {field,
		reason,
		number,
		select,
		bool,
		optional,
		toggle,
		focus: root => {
			const node = missing(root)[0]?.node || fields.find(it => enabled(it.node, root))?.node || root;
			if (root.tagName === "DETAILS") root.open = true;
			for (let parent = node.parentElement; parent && parent !== root; parent = parent.parentElement) if (parent.tagName === "DETAILS") parent.open = true;
			if (node === root) root.tabIndex = -1;
			node.focus();
		},
		validate: root => {
			const unresolved = missing(root);
			fields.filter(it => it.node.isConnected).forEach(it => it.node.setAttribute("aria-invalid", String(unresolved.includes(it))));
		}};
}

export function renderArmorBindings ({parent, current, ui}) {
	paragraph(parent, `Observed ordered AC alternatives: ${describeFact(current.ac)}. Conditions and equipment are preserved.`);
	const policy = ui.select(parent, "Armor policy", [["retain", "Retain these source-fixed AC alternatives"], ["recalculate", "Declare armor / Dexterity contributions"]]);
	const body = element("fieldset", {className: "bqa__transformation-optional"});
	body.hidden = body.disabled = true;
	parent.append(body);
	const alternatives = (current.ac || []).map((value, i) => {
		const row = group(body, `AC alternative ${i + 1}: ${describeFact(value)}`);
		const mode = ui.select(row, "Alternative policy", [["retain", "Retain source-fixed value"], ["bind", "Declare contributions"]]);
		const declarations = element("fieldset", {className: "bqa__transformation-optional"});
		declarations.hidden = declarations.disabled = true;
		row.append(declarations);
		ui.toggle(mode, declarations, () => mode.read() === "bind");
		const kind = ui.select(declarations, "Armor kind", ["worn", "natural", "unarmored"].map(it => [it, it]));
		const base = ui.number(declarations, "Armor base", 0, 100);
		const dexterity = ui.select(declarations, "Dexterity contribution", [["none", "None"], ["full", "Full modifier"], ["capped", "Capped modifier"]]);
		const cap = ui.number(declarations, "Dexterity cap (capped policy only)", 0, 10, {required: false});
		const shield = ui.number(declarations, "Shield contribution", 0, 10);
		const fixed = ui.number(declarations, "Other fixed AC contribution", -100, 100);
		const minimum = ui.number(declarations, "AC minimum (if applicable)", 0, 100, {required: false});
		return () => mode.read() === "retain" ? {mode: "retain"} : {kind: kind.read(),
			base: base.read(),
			dexterity: dexterity.read(),
			shield: shield.read(),
			fixed: fixed.read(),
			...dexterity.read() === "capped" ? {maxDex: cap.read()} : {},
			...minimum.read() !== undefined ? {minimum: minimum.read()} : {}};
	});
	ui.toggle(policy, body, () => policy.read() === "recalculate");
	return () => policy.read() === "retain" ? {mode: "retain"} : {mode: policy.read(), alternatives: alternatives.map(read => read())};
}

export function renderNumericBindings ({parent, current, entries, ui, includeArmor = true, includePb = true, sourcePbRequired = false, includeEntry = () => true}) {
	const armor = includeArmor ? renderArmorBindings({parent, current, ui}) : null;
	let pb = () => undefined;
	if (includePb) {
		paragraph(parent, `Observed PB: ${current.profBonus ?? current.pbNote ?? "not explicitly authored"}. Current CR: ${describeFact(current.cr)}. A bonus's magnitude is not evidence of proficiency.`);
		const render = body => {
			const value = ui.number(body, "Current source PB", 1, 30, {value: current.profBonus ?? current.pbNote});
			return value.read;
		};
		pb = sourcePbRequired ? render(parent) : ui.optional(parent, "Declare a current source PB?", render);
	}
	const reads = entries.filter(it => it.needsBinding).map(entry => {
		const panel = group(parent, `${entry.section}: ${entry.match.name} (${entry.match.source})`, {open: false});
		const content = element("fieldset", {className: "bqa__transformation-optional"});
		panel.append(content);
		entryFact(content, entry);
		if (!entry.supported) paragraph(content, `Numeric binding unavailable: ${entry.reason}. Explicit retention does not establish CR coverage.`);
		const required = entry.sourceNumbers?.length > 0 && entry.supported;
		const policy = required ? null : ui.select(content, "Entry policy", [
			...entry.supported ? [["bind", "Bind every numeric token"]] : [],
			["retain", "Retain this entire source-fixed entry"],
		]);
		if (required) paragraph(content, "Source-defined formulas / donor constants are locked. Declare any remaining numbers below.");
		const body = element("fieldset", {className: "bqa__transformation-optional"});
		body.hidden = body.disabled = !required;
		content.append(body);
		if (policy) ui.toggle(policy, body, () => policy.read() === "bind");
		const tokens = entry.tokens.map(token => {
			const row = element("div", {className: "bqa__transformation-resolution-row"});
			body.append(row);
			paragraph(row, `Paragraph ${token.paragraph + 1}, ${token.kind} ${token.token + 1}: ${token.value}${token.dice ? `; ${token.dice.number}d${token.dice.faces}, printed average ${token.average ?? "unsupported"}` : ""}.`);
			const locked = entry.sourceNumbers?.find(it => it.paragraph === token.paragraph && it.kind === token.kind && it.token === token.token);
			if (locked) {
				paragraph(row, locked.mode === "fixed" ? `Source-fixed: ${locked.value}${token.dice ? ` bonus, ${token.dice.number}d${token.dice.faces} dice` : ""}`
					: `Source formula: ${Parser.attAbvToFull(locked.ability)} modifier + ${locked.proficiency} × PB + ${locked.fixed}.`);
				return () => structuredClone(locked);
			}
			const interpretation = ui.select(row, "Token interpretation", [["ability", "Ability plus PB and declared residual"], ["fixed", "Source-fixed observed value"]]);
			const formula = element("fieldset", {className: "bqa__transformation-optional"});
			formula.disabled = formula.hidden = true;
			row.append(formula);
			const ability = ui.select(formula, "Governing ability", ABILITIES.map(it => [it, Parser.attAbvToFull(it)]));
			const multiplier = ui.select(formula, "Token PB multiplier", MULTIPLIERS);
			const residual = ui.number(formula, "Fixed non-ability / non-PB contribution", -10_000, 10_000);
			ui.toggle(interpretation, formula, () => interpretation.read() === "ability");
			return () => ({paragraph: token.paragraph,
				kind: token.kind,
				token: token.token,
				...token.dice ? {dice: structuredClone(token.dice)} : {},
				...interpretation.read() === "fixed" ? {mode: "fixed", value: token.value}
					: {mode: interpretation.read(), ability: ability.read(), proficiency: multiplier.read() === undefined ? undefined : Number(multiplier.read()), fixed: residual.read()}});
		});
		return () => {
			panel.hidden = content.disabled = !includeEntry(entry);
			if (panel.hidden) return undefined;
			return {section: entry.section,
				match: structuredClone(entry.match),
				...policy?.read() === "retain" ? {mode: "retain"} : {mode: required ? "bind" : policy?.read(), numbers: tokens.map(read => read())}};
		};
	});
	return () => ({...includeArmor ? {armor: armor()} : {}, entries: reads.map(read => read()).filter(Boolean), ...pb() !== undefined ? {proficiencyBonus: pb()} : {}});
}
