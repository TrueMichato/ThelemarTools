import {ABILITIES, CR_CHOICES, MULTIPLIERS, YES_NO, button, describeFact, element, entryFact, group, paragraph, renderNumericBindings} from "./bestiary-transformation-editor-controls.js";
import {compileCreatureTransformation} from "../creature-transformations.js";
import {observeCreatureTransformationBindings} from "../creature-transformation-bindings.js";
import {BestiaryCreatureTransformation} from "./bestiary-creature-transformation.js";
import {normalizeCreatureTransformation} from "./bestiary-transformation-catalog-adapter.js";

const named = values => values.map(value => [value, String(value).replaceAll("-", " ")]);
const address = entry => ({section: entry.section, match: structuredClone(entry.match)});
const title = entry => `${entry.section || "trait"}: ${entry.match.name} (${entry.match.source})`;
const weaponEntries = entries => entries.filter(entry => /\{@atk(?:r)? [^}]*[mr]w/.test(JSON.stringify(entry.entry.entries)));

function renderChecks (parent, values, ui, label) {
	const reads = values.map(([value, name]) => [value, ui.bool(parent, `${label}: ${name}`)]);
	return () => reads.some(([, read]) => read() === undefined) ? undefined : reads.filter(([, read]) => read() === true).map(([value]) => value);
}

function renderOrder (parent, values, ui) {
	paragraph(parent, "Select each applicable source clause once, in the order to apply it. Leave unused positions empty.");
	const reads = values.map((_, i) => ui.select(parent, `Clause position ${i + 1}`, named(values), {required: false}));
	return () => reads.map(it => it.read()).filter(it => it !== undefined);
}

function renderCapabilities (parent, entries, ui, {bat = false, armor = false} = {}) {
	const armorPolicy = armor ? ui.select(parent, "Form equipment AC policy", [["retain", "Retain the declared armor"], ["unarmored", "Equipment unusable: use unarmored AC"]]) : null;
	const armorReason = armor ? ui.reason(parent, "Form armor reason") : null;
	const reads = entries.map(entry => {
		const row = group(parent, title(entry), {open: false});
		entryFact(row, entry);
		const speech = ui.bool(row, "Requires speech?");
		const equipment = ui.select(row, "Equipment in this form", [["not-required", "No equipment required"], ["usable", "Required equipment remains usable"], ["unusable", "Required equipment cannot be used"]]);
		return () => ({...address(entry), requiresSpeech: speech(), [bat ? "carriedEquipment" : "equipment"]: equipment.read()});
	});
	return () => armor ? {armor: {mode: armorPolicy.read(), reason: armorReason.read()}, entries: reads.map(read => read())} : reads.map(read => read());
}

function renderLair (parent, current, ui, getLegendaryGroups) {
	paragraph(parent, `Current lair group: ${describeFact(current.legendaryGroup)}. Replacing lair actions preserves its regional and mythic rules.`);
	const policy = ui.select(parent, "Lair policy", [["retain", "Retain current lair actions"], ["remove", "Remove all lair actions"], ["replace", "Replace lair actions with reviewed rules"]]);
	const body = element("fieldset", {className: "bqa__transformation-optional"});
	body.hidden = body.disabled = true;
	parent.append(body);
	const name = ui.field(body, "Replacement lair action name");
	const rule = ui.reason(body, "Replacement lair action rules (one paragraph per line)");
	ui.toggle(policy, body, () => policy.read() === "replace");
	return () => {
		if (policy.read() === "retain" || policy.read() === undefined) return {mode: policy.read()};
		const pointer = current.legendaryGroup;
		const baseline = pointer ? (["lairActions", "regionalEffects", "mythicEncounter"].some(key => Object.hasOwn(pointer, key))
			? pointer : getLegendaryGroups()?.find(item => item.name === pointer.name && item.source === pointer.source)) : {name: current.name, source: current.source};
		return {mode: "replace",
			baseline: baseline && Object.fromEntries(["name", "source", "page", "lairActions", "regionalEffects", "mythicEncounter"].filter(key => Object.hasOwn(baseline, key)).map(key => [key, structuredClone(baseline[key])])),
			actions: policy.read() === "remove" ? [] : [{type: "entries", name: name.read(), entries: rule.read()?.split("\n").filter(line => line.trim())}]};
	};
}

function renderDamageComponents (parent, entries, ui, {physical = false} = {}) {
	const reads = entries.map(entry => {
		const row = group(parent, title(entry), {open: false});
		entryFact(row, entry);
		const components = [];
		let index = 0;
		for (const text of entry.entry.entries || []) {
			for (const token of JSON.stringify(text).matchAll(physical
				? /\{@damage ([^{}]+)}\)?\s+(bludgeoning|piercing|slashing) damage/g
				: /\{@damage ([^{}]+)}\)?\s+(\w+) damage/g)) {
				components.push([index++, `${token[1]} ${token[2]}`]);
			}
		}
		const read = renderChecks(row, components, ui, "Convert this damage component");
		return () => ({...address(entry), components: read()});
	});
	return () => reads.map(read => read());
}

function renderFallen (parent, key, facts, ui) {
	if (["angel"].includes(key)) return ui.bool(parent, "Is this creature an angel?");
	if (["proficiencyBonus", "charisma"].includes(key)) return ui.number(parent, key === "charisma" ? "Actual Charisma score" : "Actual source PB", 1, 30).read;
	if (key === "weapons") {
		const traits = facts.traits;
		const selected = ui.select(parent, "Angelic Weapons trait", [...facts.allowNone ? [["none", "No applicable Angelic Weapons"]] : [], ...traits.map((entry, i) => [i, `${entry.match.name} (${entry.match.source})`])]);
		const body = element("fieldset", {className: "bqa__transformation-optional"});
		body.hidden = body.disabled = true;
		parent.append(body);
		ui.toggle(selected, body, () => selected.read() !== undefined && selected.read() !== "none");
		const token = ui.select(body, "Actual radiant trait component", traits.flatMap((entry, i) =>
			entry.tokens.map(part => [JSON.stringify({trait: i, token: part.index}), `${entry.match.name}: ${part.dice} radiant (component ${part.index + 1})`])));
		const attacks = facts.attacks.map(entry => {
			const read = renderChecks(body, entry.tokens.map((token, i) => [i, `${title(entry)}: ${describeFact(token)}`]), ui, "Angelic weapon rider");
			return () => ({...address(entry), tokens: read()});
		});
		return () => {
			if (selected.read() === "none") return null;
			const component = token.read() && JSON.parse(token.read());
			return {match: traits[Number(selected.read())]?.match,
				token: component?.trait === Number(selected.read()) ? component.token : undefined,
				attacks: attacks.map(read => read())};
		};
	}
	if (key === "healing") {
		const action = ui.select(parent, "Actual Healing Touch", facts.actions.map((entry, i) => [i, `${entry.match.name} (${entry.match.source})`]));
		const kind = ui.select(parent, "Original Healing Touch usage", named(facts.usageKinds));
		const count = ui.number(parent, "Original uses (day or rest)", 1, 99, {required: false});
		const minimum = ui.number(parent, "Original recharge minimum", 2, 6, {required: false});
		return () => ({match: facts.actions[Number(action.read())]?.match,
			usage: {kind: kind.read(),
				...["day", "shortRest", "longRest"].includes(kind.read()) ? {uses: count.read()} : {},
				...kind.read() === "recharge" ? {minimum: minimum.read()} : {}}});
	}
	if (["innate", "spellExceptions"].includes(key)) {
		paragraph(parent, "Retain at-will spells and Dispel Evil and Good at its original uses. Limited-use Detect Evil and Good is not an exception.");
		const exception = (body, spell) => {
			paragraph(body, describeFact(spell.value));
			const value = ui.bool(body, "Is this specifically Dispel Evil and Good?");
			return () => ({prop: spell.prop, ...spell.key !== undefined ? {key: spell.key} : {}, index: spell.index, value: value()});
		};
		const reads = (facts.entries || facts.spells).map(entry => {
			const body = group(parent, `${entry.match.name} (${entry.match.source})`);
			if (key === "spellExceptions") {
				const read = exception(body, entry);
				return () => ({match: entry.match, ...read()});
			}
			paragraph(body, describeFact(entry.entry));
			const innate = ui.select(body, "Is this casting innate?", YES_NO);
			const exceptionFields = element("fieldset", {className: "bqa__transformation-optional"});
			exceptionFields.disabled = exceptionFields.hidden = true;
			body.append(exceptionFields);
			ui.toggle(innate, exceptionFields, () => innate.read() === "yes");
			const exceptions = [];
			for (const prop of ["constant", "will", "ritual", "daily", "rest", "weekly", "monthly", "yearly", "recharge", "charges", "legendary", "spells"]) {
				const value = entry.entry[prop];
				if (!value) continue;
				const parts = Array.isArray(value) ? [[undefined, value]] : Object.entries(value);
				for (const [partKey, row] of parts) {
					for (const [index, spell] of (prop === "spells" ? row.spells || [] : row).entries()) {
						const rule = typeof spell === "string" ? spell : spell.entry;
						if (prop === "will" || /^\{@spell /i.test(rule)) continue;
						exceptions.push(exception(exceptionFields, {prop, key: partKey, index, value: spell}));
					}
				}
			}
			return () => ({match: entry.match,
				value: innate.read() === undefined ? undefined : innate.read() === "yes",
				...innate.read() === "yes" && exceptions.length ? {exceptions: exceptions.map(read => read())} : {}});
		});
		return () => reads.map(read => read());
	}
	if (key === "silver") {
		const reads = facts.groups.map(part => [part.index, ui.bool(parent, `Does this nonmagical weapon resistance need a silver exception? ${describeFact(part.value)}`)]);
		return () => reads.map(([index, value]) => ({index, value: value()}));
	}
	if (key === "sight") {
		const reads = facts.senses.map(part => {
			paragraph(parent, `Actual sense: ${part.value}`);
			const range = ui.number(parent, "Actual truesight range (ft.)", 1, 1000);
			const condition = ui.field(parent, "Retained sense condition (empty if unconditional)", {required: false});
			return () => ({index: part.index, range: range.read(), condition: condition.read() ?? ""});
		});
		return () => reads.map(read => read());
	}
	throw new Error(`Missing Fallen Angel editor for ${key}.`);
}

function renderControl ({parent, control, model, resolved, ui, getLegendaryGroups, getSourceInputs}) {
	const [namespace, key] = control.path;
	const facts = control.facts;
	const current = model.current;
	const entries = model.entries;
	if (namespace === "fallenAngel") return renderFallen(parent, key, facts, ui);
	if (namespace === "bindings" || key === "bindings") {
		const observed = namespace === "spore" ? entries.filter(entry => entry.section !== "trait" && entry.section !== "spellcasting"
			&& /\{@atk mw(?:,rw)?}/.test(JSON.stringify(entry.entry.entries)) && /\b(?:bludgeoning|piercing|slashing) damage/.test(JSON.stringify(entry.entry.entries)))
			: entries;
		return renderNumericBindings({parent,
			current,
			entries: observed,
			ui,
			includeArmor: namespace !== "spore",
			includePb: namespace !== "undead",
			sourcePbRequired: ["vampire", "lycanthropy", "wereshark"].includes(resolved.automation.profile),
			includeEntry: entry => resolved.automation.profile !== "skeletal-wyrmling" || !getSourceInputs().reanimation?.breaths?.some(part =>
				part.mode === "remove" && part.section === entry.section && JSON.stringify(part.match) === JSON.stringify(entry.match))});
	}
	if (key === "lair") return renderLair(parent, current, ui, getLegendaryGroups);
	if (namespace === "hp") {
		paragraph(parent, `Current HP: ${describeFact(current.hp)}. Constitution reconciliation retains actual Hit Dice and the non-Constitution residual.`);
		const mode = ui.select(parent, "HP policy", [["constitution", "Reconcile Constitution once"], ["override", "Exact authored HP override"]]);
		const average = ui.number(parent, "Override HP average", 1, 1_000_000, {required: false});
		const formula = ui.field(parent, "Override Hit Dice formula", {required: false});
		return () => ({mode: mode.read(), ...mode.read() === "override" ? {value: {average: average.read(), formula: formula.read()}} : {}});
	}
	if (key === "donor") {
		paragraph(parent, `Actual blood donor: ${facts.name} (${facts.source}). No example or different edition may be substituted.`);
		const confirm = ui.select(parent, "Blood donor", [["actual", `${facts.name} (${facts.source})`]]);
		return () => confirm.read() ? structuredClone(facts) : undefined;
	}
	if (key === "physiology" || key === "breaths") {
		const rows = (key === "physiology" ? facts : facts.filter(entry => /\bbreath\b/i.test(entry.match.name))).map(entry => {
			entryFact(parent, entry);
			const mode = ui.select(parent, `${entry.match.name} policy`, [["retain", "Retain"], ["remove", "Remove"]]);
			return () => ({...key === "breaths" ? {section: entry.section} : {}, match: entry.match, mode: mode.read()});
		});
		return () => rows.map(read => read());
	}
	if (["hybrid", "animal"].includes(key)) return renderCapabilities(parent, entries, ui, {armor: true});
	if (key === "batEntries") return renderCapabilities(parent, entries, ui, {bat: true});
	if (key === "legendaryResistance") {
		const policy = ui.select(parent, "Legendary Resistance pool", facts.length
			? [["retain", "Retain the one existing pool"], ["replace", "Replace existing pools with the source 3/Day pool"]]
			: [["grant", "Grant the source 3/Day pool"]]);
		return () => ({mode: policy.read(), ...policy.read() === "retain" ? {match: facts[0]?.match} : policy.read() === "replace" ? {matches: facts.map(entry => entry.match)} : {}});
	}
	if (key === "replaceFeatures") {
		const read = renderChecks(parent, facts.map((entry, i) => [i, title(entry)]), ui, "Replace competing source feature (not arbitrary removal)");
		return () => read()?.map(index => address(facts[index]));
	}
	if (key === "stealth") {
		paragraph(parent, `Current Stealth ${facts.total ?? "absent"}; Dexterity ${facts.dex}. Declare existing contributions, not the template's doubled PB.`);
		const proficiency = ui.select(parent, "Current Stealth PB multiplier", MULTIPLIERS);
		const residual = ui.number(parent, "Current Stealth non-PB residual", -1000, 1000);
		return () => ({proficiency: proficiency.read() === undefined ? undefined : Number(proficiency.read()), residual: residual.read()});
	}
	if (key === "attacks") {
		const reads = facts.map(entry => {
			const role = ui.select(parent, `${title(entry)} role`, [["bite", "Bite"], ["breath", "Breath"], ["other", "Other"]]);
			return () => ({...address(entry), role: role.read()});
		});
		return () => reads.map(read => read());
	}
	if (key === "equipmentDamage") {
		const reads = facts.filter(entry => entry.section !== "trait" && entry.section !== "spellcasting"
			&& /\{@atk mw/.test(JSON.stringify(entry.entry.entries)) && /\b(?:bludgeoning|piercing|slashing) damage/.test(JSON.stringify(entry.entry.entries))).flatMap(entry =>
			entry.tokens.filter(token => {
				if (token.kind !== "damage") return false;
				const components = [...token.text.matchAll(/\{@damage [^{}]+}\)?\s+(\w+) damage/g)];
				return components[token.token] && !["bludgeoning", "piercing", "slashing"].includes(components[token.token][1]);
			}).map(token => {
				const equipment = ui.bool(parent, `${title(entry)}, paragraph ${token.paragraph + 1}, damage ${token.token + 1}: is this damage from equipment?`);
				return () => ({...address(entry), paragraph: token.paragraph, token: token.token, equipment: equipment()});
			}));
		return () => reads.map(read => read());
	}
	if (namespace === "undead") {
		if (key === "additionalTraits") return renderChecks(parent, named(facts.additionalTraits), ui, "Additional source clause");
		if (key === "alignment") {
			const input = ui.select(parent, "Concrete alignment", facts.alignment.map((value, i) => [i, Parser.alignmentListToFull(value)]));
			return () => input.read() === undefined ? undefined : facts.alignment[Number(input.read())];
		}
		if (["abilityOrder", "movementOrder"].includes(key)) {
			return renderOrder(parent, key === "abilityOrder"
				? ["ghost-abilities", "mummy-abilities", "skeletal-abilities", "zombie-abilities"]
				: ["ghost-flight", "mummy-movement", "slowed-movement"], ui);
		}
		if (key === "ghostWeapons") return renderDamageComponents(parent, weaponEntries(entries), ui, {physical: true});
		if (key === "ghostFlight") {
			const speed = facts.speed;
			const choices = ["walk", "swim"].flatMap(mode => [...speed[mode] !== undefined ? [[JSON.stringify({mode}), `${mode}: ${describeFact(speed[mode])}`]] : [],
				...(speed.alternate?.[mode] || []).map((value, alternate) => [JSON.stringify({mode, alternate}), `${mode} alternative ${alternate + 1}: ${describeFact(value)}`])]);
			const choice = ui.select(parent, "Actual movement branch for ghost flight", choices);
			return () => choice.read() ? JSON.parse(choice.read()) : undefined;
		}
		if (key === "drainAttack") {
			const attacks = entries.filter(entry => /^bite\b/i.test(entry.match.name) || /\{@atk mw/.test(JSON.stringify(entry.entry.entries)));
			const choice = ui.select(parent, "Draining Strikes attack", attacks.map((entry, i) => [i, title(entry)]));
			return () => choice.read() === undefined ? undefined : address(attacks[Number(choice.read())]);
		}
		if (key === "components") return renderChecks(parent, named(facts.components), ui, "Required spell component");
		if (key === "senses") {
			const reads = facts.senses.flatMap((value, index) => {
				const found = /^(darkvision|blindsight) (\d+) ft\..+$/i.exec(value);
				if (!found) return [];
				const range = ui.number(parent, `Actual ${value} range (ft.)`, 0, 1000);
				return [() => ({sense: found[1].toLowerCase(), index, range: range.read()})];
			});
			return () => reads.map(read => read());
		}
		if (key === "challengeRating") {
			const input = ui.select(parent, "Current source CR (only when absent / ambiguous)", CR_CHOICES);
			return () => input.read() === undefined ? undefined : Parser.crToNumber(input.read());
		}
		if (["allowUnusualType", "headless"].includes(key)) return ui.bool(parent, key === "headless" ? "Former eyes or head are now absent?" : "Approve this unusual creature type?");
	}
	if (["proficiencyBonus", "grappleDc"].includes(key)) return ui.number(parent, key === "grappleDc" ? "Fixed grapple escape DC (no source formula is defined)" : "Actual source PB", key === "grappleDc" ? 0 : 1, key === "grappleDc" ? 100 : 30).read;
	if (control.choices || facts?.[key]) {
		const values = control.choices || facts[key];
		const choice = ui.select(parent, {
			age: "Age",
			trueDragon: "Is this a true dragon?",
			shadowDragon: "Is this a shadow dragon?",
			shadowfell: "Shadowfell origin",
			wyrmling: "Is this the actual wyrmling?",
			adaptation: "Source adaptation",
			embrace: "Embrace the curse?",
			speaksSylvan: "Already speaks Sylvan?",
			ghostAbility: "Ability for former Strength-based attacks",
			ghostDamage: "Ghost strike damage",
			spellAbility: "Innate spellcasting ability",
			glareAbility: "Dreadful Glare ability",
			movementRounding: "Fractional movement rounding",
		}[key] || key, values.map(value => [typeof value === "boolean" ? value ? "yes" : "no" : value,
			typeof value === "boolean" ? value ? "Yes" : "No" : ABILITIES.includes(value) ? Parser.attAbvToFull(value) : String(value).replaceAll("-", " ")]));
		return () => choice.read() === undefined ? undefined : values.find(value => String(typeof value === "boolean" ? value ? "yes" : "no" : value) === choice.read());
	}
	throw new Error(`Missing finite source editor for ${control.path.join(".")}.`);
}

const LABELS = {
	bindings: "Armor and numeric declarations",
	hp: "Hit point policy",
	proficiencyBonus: "Source proficiency bonus",
	equipmentDamage: "Equipment damage riders",
	trueDragon: "True dragon identity",
	shadowDragon: "Shadow dragon identity",
	physiology: "Living physiology",
	lair: "Lair actions",
	donor: "Actual blood donor",
	breaths: "Donor breath weapons",
	stealth: "Current Stealth contributions",
	attacks: "Ambiguous attack roles",
	batEntries: "Bat capabilities",
	hybrid: "Hybrid capabilities",
	animal: "Animal capabilities",
	legendaryResistance: "Legendary Resistance",
	replaceFeatures: "Competing source features",
	additionalTraits: "Additional Undead source clauses",
	abilityOrder: "Overlapping ability clauses",
	movementOrder: "Overlapping movement clauses",
	ghostWeapons: "Ghost weapon components",
	ghostFlight: "Ghost flight branch",
	senses: "Conditional senses",
	weapons: "Angelic weapon components",
	healing: "Healing Touch usage",
	innate: "Innate casting classification",
	spellExceptions: "Opaque spell exceptions",
	silver: "Silver bypass ownership",
	sight: "Truesight declaration",
	alignment: "Undead alignment",
	allowUnusualType: "Unusual type approval",
	ghostAbility: "Ghost attack ability",
	ghostDamage: "Ghost damage type",
	spellAbility: "Spellcasting ability",
	components: "Spell components",
	glareAbility: "Dreadful Glare ability",
	headless: "Headless confirmation",
	movementRounding: "Movement rounding",
	challengeRating: "Missing source CR",
	drainAttack: "Draining Strikes attack",
};

export function renderSourceChoices ({parent, model, resolved, ui, getLegendaryGroups}) {
	const source = group(parent, "Source choices");
	paragraph(source, "Observed facts are read-only. Choose source policies and explain them; optional declarations are needed only when the source asks for them. Source-fixed retention never skips a source grant or removal.");
	const refreshers = [];
	let sourceInputs = {};
	const reads = model.controls.map(control => {
		const key = control.path.at(-1);
		const body = group(source, LABELS[key] || key.replace(/([A-Z])/g, " $1"), {open: control.required});
		body.dataset.sourceControl = control.id;
		const render = parent => {
			let read;
			if (control.path[0] === "spore" && key === "bindings") {
				const numbers = element("div");
				parent.append(numbers);
				let entriesKey;
				refreshers.push(inputs => {
					const retained = model.entries.filter(entry => entry.section !== "trait" && entry.section !== "spellcasting"
						&& /\{@atk mw(?:,rw)?}/.test(JSON.stringify(entry.entry.entries))
						&& /\b(?:bludgeoning|piercing|slashing) damage/.test(JSON.stringify(entry.entry.entries)));
					try {
						// Observe cleanup through the real compiler; provisional retention is never returned as the user's answer.
						const compiled = compileCreatureTransformation({resolved,
							current: model.current,
							chassisSource: model.chassisSource,
							inputs: {spore: {...inputs.spore,
								bindings: {entries: retained.filter(entry => entry.needsBinding)
									.map(entry => ({...address(entry), mode: "retain"}))}}},
							legendaryGroups: getLegendaryGroups()});
						const projection = BestiaryCreatureTransformation.projectSourceProfile({original: model.current, current: model.current, resolved: normalizeCreatureTransformation(compiled)});
						const observed = observeCreatureTransformationBindings({current: projection, chassisSource: model.chassisSource})
							.filter(entry => retained.some(item => item.section === entry.section && JSON.stringify(item.match) === JSON.stringify(entry.match)));
						const next = JSON.stringify(observed);
						if (entriesKey === next) return;
						entriesKey = next; numbers.replaceChildren();
						paragraph(numbers, "Actual source-cleaned melee numbers (Brute and non-equipment riders have already been removed). Declare original ability ownership below; source ability changes are then applied once.");
						read = renderNumericBindings({parent: numbers, current: model.current, entries: observed, ui, includeArmor: false});
					} catch (error) {
						if (!["CREATURE_TRANSFORMATION_INPUT_REQUIRED", "CREATURE_TRANSFORMATION_INELIGIBLE", "CREATURE_TRANSFORMATION_ENTRY_MATCH"].includes(error.code)) throw error;
						const next = `unresolved:${error.message}`;
						if (entriesKey === next) return;
						entriesKey = next; numbers.replaceChildren();
						paragraph(numbers, `Complete the other source choices before declaring cleaned melee numbers: ${error.message}`);
						read = () => ({entries: []});
					}
				});
				read = () => ({entries: []});
			} else read = renderControl({parent, control, model, resolved, ui, getLegendaryGroups, getSourceInputs: () => sourceInputs});
			const reason = ui.reason(parent, `${LABELS[key] || key} source reason`);
			return () => ({value: read(), reason: reason.read()});
		};
		const read = control.required ? render(body) : ui.optional(body, `Declare ${LABELS[key] || key}?`, render);
		return () => [control.id, read()];
	});
	return () => {
		const answers = () => Object.fromEntries(reads.map(read => read()).filter(([, answer]) => answer !== undefined));
		const current = answers();
		const inputs = {};
		for (const control of model.controls) {
			const answer = current[control.id];
			if (!answer) continue;
			const [namespace, field] = control.path;
			if (field) (inputs[namespace] ||= {})[field] = answer.value;
			else inputs[namespace] = answer.value;
		}
		sourceInputs = inputs;
		refreshers.forEach(refresh => refresh(inputs));
		return answers();
	};
}
