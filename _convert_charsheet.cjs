/**
 * Convert jQuery patterns to vanilla JS in charactersheet.js
 * ONLY process lines 7800+ (0-indexed: 7799+)
 */
const fs = require("fs");
const FILE = "js/charactersheet/charactersheet.js";
const START_LINE = 7799; // 0-indexed, means line 7800+

const src = fs.readFileSync(FILE, "utf8");
const lines = src.split("\n");

let totalFixes = 0;
const fixLog = [];

function log (lineNum, desc) {
	fixLog.push(`L${lineNum + 1}: ${desc}`);
	totalFixes++;
}

// Process only lines 7800+ individually for simple patterns
for (let i = START_LINE; i < lines.length; i++) {
	let line = lines[i];
	const orig = line;

	// --- $$` → ee` ---
	if (line.includes("$$" + "`")) {
		line = line.replace(/\$\$`/g, "ee`");
		if (line !== orig) log(i, "$$` -> ee`");
	}

	// --- $(`<html>`) → e_({outer: `<html>`}) ---
	line = line.replace(/\$\(\s*`(<[^`]+>)`\s*\)/g, function (m, html) {
		log(i, "$(`<html>`) -> e_({outer: `<html>`})");
		return `e_({outer: \`${html}\`})`;
	});

	// --- .on("event", fn) → .addEventListener("event", fn) ---
	line = line.replace(/\.on\("(click|change|input|keypress|keyup|mouseenter|mouseleave|blur|focus)",\s*/g, function (m, evt) {
		log(i, `.on("${evt}") -> .addEventListener("${evt}")`);
		return `.addEventListener("${evt}", `;
	});

	// --- .find(".x") → .querySelector(".x") ---
	line = line.replace(/\.find\("([^"]+)"\)/g, function (m, sel) {
		log(i, ".find -> .querySelector");
		return `.querySelector("${sel}")`;
	});

	// --- .val() getter → .value ---
	line = line.replace(/\.val\(\)(?!\s*=)/g, function (m) {
		log(i, ".val() -> .value");
		return ".value";
	});

	// --- .val(x) setter → .value = x ---
	line = line.replace(/\.val\(([^)]+)\)/g, function (m, val) {
		log(i, ".val(x) -> .value = x");
		return `.value = ${val}`;
	});

	// --- .text("x") / .text(x) → .textContent = x ---
	line = line.replace(/\.text\(([^)]+)\)/g, function (m, content) {
		log(i, ".text(x) -> .textContent = x");
		return `.textContent = ${content}`;
	});

	// --- .prop("checked", val) → .checked = val ---
	line = line.replace(/\.prop\("checked",\s*([^)]+)\)/g, function (m, val) {
		log(i, ".prop(\"checked\", x) -> .checked = x");
		return `.checked = ${val}`;
	});

	// --- .prop("checked") → .checked ---
	line = line.replace(/\.prop\("checked"\)/g, function (m) {
		log(i, ".prop(\"checked\") -> .checked");
		return ".checked";
	});

	// --- .prop("disabled", val) → .disabled = val ---
	line = line.replace(/\.prop\("disabled",\s*([^)]+)\)/g, function (m, val) {
		log(i, ".prop(\"disabled\", x) -> .disabled = x");
		return `.disabled = ${val}`;
	});

	// --- .show() → .style.display = "" ---
	line = line.replace(/\.show\(\)/g, function (m) {
		log(i, ".show() -> .style.display = \"\"");
		return ".style.display = \"\"";
	});

	// --- .hide() → .style.display = "none" ---
	line = line.replace(/\.hide\(\)/g, function (m) {
		log(i, ".hide() -> .style.display = \"none\"");
		return ".style.display = \"none\"";
	});

	// --- .addClass("x") → .classList.add("x") ---
	line = line.replace(/\.addClass\("([^"]+)"\)/g, function (m, cls) {
		log(i, ".addClass -> .classList.add");
		return `.classList.add("${cls}")`;
	});

	// --- .removeClass("x") → .classList.remove("x") ---
	line = line.replace(/\.removeClass\("([^"]+)"\)/g, function (m, cls) {
		log(i, ".removeClass -> .classList.remove");
		return `.classList.remove("${cls}")`;
	});

	// --- .empty() → .innerHTML = "" ---
	line = line.replace(/\.empty\(\)/g, function (m) {
		log(i, ".empty() -> .innerHTML = \"\"");
		return ".innerHTML = \"\"";
	});

	// --- .html(`...`) setter → .innerHTML = `...`  ---
	// Match .html(`<anything>`)
	line = line.replace(/\.html\(`([^`]*)`\)/g, function (m, content) {
		log(i, ".html() -> .innerHTML");
		return `.innerHTML = \`${content}\``;
	});

	// --- .data("editing-id") → .dataset.editingId ---
	line = line.replace(/\.data\("editing-id"\)/g, function (m) {
		log(i, ".data -> .dataset");
		return ".dataset.editingId";
	});

	// --- .data("editing-id", val) → .dataset.editingId = val ---
	line = line.replace(/\.data\("editing-id",\s*([^)]+)\)/g, function (m, val) {
		log(i, ".data setter -> .dataset");
		return `.dataset.editingId = ${val}`;
	});

	// --- .removeData("editing-id") → delete el.dataset.editingId ---
	line = line.replace(/\.removeData\("editing-id"\)/g, function (m) {
		log(i, ".removeData -> delete dataset");
		return "/* FIXME_REMOVEDATA */";
	});

	// --- .trigger("change") → .dispatchEvent(new Event("change")) ---
	line = line.replace(/\.trigger\("(change|click|input)"\)/g, function (m, evt) {
		log(i, ".trigger -> .dispatchEvent");
		return `.dispatchEvent(new Event("${evt}"))`;
	});

	// --- .each((i, el) => {) → .forEach((el, i) => {) ---
	line = line.replace(/\.each\(\((\w+),\s*(\w+)\)\s*=>\s*\{/g, function (m, idx, elem) {
		log(i, ".each -> .forEach (swapped args)");
		return `.forEach((${elem}, ${idx}) => {`;
	});

	// --- $(el).val() → el.value ---
	line = line.replace(/\$\((\w+)\)\.value/g, function (m, el) {
		// This catches cases where .val() already got converted to .value
		log(i, "$(el).value -> el.value");
		return `${el}.value`;
	});

	// --- $(el).checked → el.checked ---
	line = line.replace(/\$\((\w+)\)\.checked/g, function (m, el) {
		log(i, "$(el).checked -> el.checked");
		return `${el}.checked`;
	});

	// --- $(this).css({...}) or this.css({...}) ---
	// Convert .css({"key": "val", ...}) to Object.assign(el.style, {"key": "val", ...})
	// Simple inline single-line cases
	const cssMatch = line.match(/(\w+)\.css\(\{([^}]+)\}\)/);
	if (cssMatch) {
		const elName = cssMatch[1];
		const props = cssMatch[2];
		line = line.replace(cssMatch[0], `Object.assign(${elName}.style, {${props}})`);
		log(i, ".css({}) -> Object.assign(style)");
	}

	// --- $(this) → this ---
	line = line.replace(/\$\(this\)/g, function (m) {
		log(i, "$(this) -> this");
		return "this";
	});

	// --- $("body") → document.body ---
	line = line.replace(/\$\("body"\)/g, function (m) {
		log(i, "$(\"body\") -> document.body");
		return "document.body";
	});

	// --- .fadeOut(300, () => varName.remove()) → setTimeout(() => el.remove(), 300) ---
	line = line.replace(/(\w+)\.fadeOut\(\s*(\d+)\s*,\s*\(\)\s*=>\s*\w+\.remove\(\)\s*\)/g, function (m, el, ms) {
		log(i, ".fadeOut -> setTimeout remove");
		return `setTimeout(() => ${el}.remove(), ${ms})`;
	});

	// --- $(".selector") → document.querySelector(".selector") ---
	// --- $("#id") → document.getElementById("id") ---
	line = line.replace(/\$\("(#[^"]+)"\)/g, function (m, sel) {
		if (!sel.includes(" ") && !sel.includes(".") && !sel.includes(":")) {
			const id = sel.slice(1);
			log(i, "$(\"#id\") -> document.getElementById");
			return `document.getElementById("${id}")`;
		}
		log(i, "$(\"sel\") -> document.querySelector");
		return `document.querySelector("${sel}")`;
	});

	// --- $(".class-selector") or more complex selectors ---
	line = line.replace(/\$\("(\.[^"]+)"\)/g, function (m, sel) {
		log(i, "$(\"sel\") -> document.querySelector");
		return `document.querySelector("${sel}")`;
	});

	lines[i] = line;
}

// === SECOND PASS: Variable renaming in the target range ===
let content = lines.join("\n");
const preLines = content.split("\n").slice(0, START_LINE);
const postLines = content.split("\n").slice(START_LINE);
let post = postLines.join("\n");

// Rename $-prefixed variables
const varRenames = [
	["$result", "resultEl"],
	["$container", "container"],
	["$content", "contentEl"],
	["$acDisplay", "acDisplay"],
	["$breakdownList", "breakdownList"],
	["$equipment", "equipment"],
	["$modalInner", "modalInner"],
	["$sourceFilter", "sourceFilter"],
	["$quickButtons", "quickButtons"],
	["$group", "groupEl"],
	["$checkbox", "checkboxEl"],
	["$exhaustionToggle", "exhaustionToggle"],
	["$thelemar_masterToggle", "thelemar_masterToggle"],
	["$thelemar_carryWeight", "thelemar_carryWeight"],
	["$thelemar_linguisticsBonus", "thelemar_linguisticsBonus"],
	["$thelemar_criticalRolls", "thelemar_criticalRolls"],
	["$thelemar_asiFeat", "thelemar_asiFeat"],
	["$thelemar_jumping", "thelemar_jumping"],
	["$thelemar_itemUtilization", "thelemar_itemUtilization"],
	["$thelemar_spellRarity", "thelemar_spellRarity"],
	["$includeCoreSpells", "includeCoreSpells"],
	["$allowExoticLanguages", "allowExoticLanguages"],
	["$prioritySection", "prioritySection"],
	["$prioritySelect", "prioritySelect"],
	["$walkList", "walkList"],
	["$list", "listEl"],
	["$row", "rowEl"],
	["$form", "formEl"],
	["$nameInput", "nameInput"],
	["$typeSelect", "typeSelect"],
	["$valueInput", "valueInput"],
	["$scalingSelect", "scalingSelect"],
	["$noteInput", "noteInput"],
	["$advSelect", "advSelect"],
	["$minInput", "minInput"],
	["$diceCountInput", "diceCountInput"],
	["$diceTypeSelect", "diceTypeSelect"],
	["$conditionalInput", "conditionalInput"],
	["$customSkillInput", "customSkillInput"],
	["$customSkillAbilitySelect", "customSkillAbilitySelect"],
	["$customSkillFields", "customSkillFields"],
	["$typeOptions", "typeOptionsHtml"],
	["$summary", "summaryEl"],
	["$status", "statusEl"],
	["$search", "searchEl"],
	["$footer", "footerEl"],
	["$confirmBtn", "confirmBtn"],
	["$searchContainer", "searchContainer"],
	["$section", "sectionEl"],
	["$input", "inputEl"],
	["$addBtn", "addBtnEl"],
	["$dropdown", "dropdownEl"],
	["$badge", "badgeEl"],
	["$checkboxes", "checkboxesEl"],
	["$label", "labelEl"],
	["$card", "cardEl"],
	["$name", "nameEl"],
	["$ability", "abilityEl"],
	["$cancelBtn", "cancelBtn"],
	["$item", "itemEl"],
];

for (const [from, to] of varRenames) {
	const escaped = from.replace(/\$/g, "\\$");
	// Match the variable name followed by non-word char or end of string
	const re = new RegExp(`${escaped}(?=[^a-zA-Z0-9_]|$)`, "g");
	const before = post;
	post = post.replace(re, to);
	if (post !== before) {
		log(0, `Renamed ${from} -> ${to}`);
	}
}

// Fix {modalInner, doClose} = await UiUtil.pGetShowModal
// → {eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal
post = post.replace(
	/\{modalInner,\s*doClose\}\s*=\s*await\s+UiUtil\.pGetShowModal/g,
	"{eleModalInner: modalInner, doClose} = await UiUtil.pGetShowModal",
);
log(0, "Fixed pGetShowModal destructuring");

// Fix .appendTo(parent) → parent.append(el)
// These are tricky - need to handle the chain pattern:
// const x = ee`...`.appendTo(parent) → const x = ee`...`; parent.append(x);
// Or: expr.appendTo(parent) → parent.append(expr)
// For ee`` chains, we need special handling
// For now, let's handle the simpler patterns

// Fix: .append(`<html string>`) → .insertAdjacentHTML("beforeend", `<html>`)
// Only when the argument starts with a backtick containing HTML tags
// Pattern: something.append(`\n<div...>...\n`)
// Multi-line appends are complex. We handle what we can.

// Fix removeData placeholder
post = post.replace(/\/\* FIXME_REMOVEDATA \*\//g, function (m) {
	return ";\n\t\t\tdelete formEl.dataset.editingId";
});

content = `${preLines.join("\n")}\n${post}`;
fs.writeFileSync(FILE, content);

console.log(`Total fixes applied: ${totalFixes}`);
console.log("\nFix categories:");
const categories = {};
fixLog.forEach(l => {
	const cat = l.replace(/^L\d+: /, "");
	categories[cat] = (categories[cat] || 0) + 1;
});
Object.entries(categories).sort((a, b) => b[1] - a[1]).forEach(([cat, count]) => {
	console.log(`  ${count}x ${cat}`);
});
