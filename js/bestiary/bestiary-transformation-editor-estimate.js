import {ABILITIES, CR_CHOICES, MULTIPLIERS, YES_NO, button, describeFact, element, entryFact, group, paragraph, renderNumericBindings} from "./bestiary-transformation-editor-controls.js";

const DEFENSE_NAMES = {hp: "Hit points",
	ac: "Armor Class",
	save: "Saving throws",
	skill: "Skills",
	passive: "Passive Perception",
	resist: "Resistances",
	immune: "Immunities",
	vulnerable: "Vulnerabilities",
	conditionImmune: "Condition immunities",
	speed: "Movement (including alternatives)",
	senses: "Senses",
	legendaryGroup: "Lair / regional / mythic group",
	mythic: "Mythic actions"};
const decisionOptions = [["represented", "Represented in the declared routines"], ["excluded", "Excluded from the estimate with a reason"]];
const tokenLabel = (entry, token) => `${entry.match.name} (${entry.match.source}) · paragraph ${token.paragraph + 1}, ${token.kind} ${token.token + 1}`;

function renderCoverage ({parent, form, ui, onChange}) {
	const root = group(parent, "Entry and numeric-token accounting", {open: false});
	paragraph(root, "Review each entry and every number. Marking damage represented is not enough: schedule a positive use in a routine, or account for that exact token in a fixed adjudication. Exclusions need reasons and do not remove source rules.");
	const reads = form.entries.map(entry => {
		const panel = group(root, `${entry.section}: ${entry.match.name} (${entry.match.source})`, {open: false});
		entryFact(panel, entry);
		const decision = ui.select(panel, "Entry contribution to estimate", decisionOptions);
		const reason = ui.reason(panel, `${entry.match.name} coverage reason`);
		const tokens = entry.tokens.map(token => {
			paragraph(panel, `${tokenLabel(entry, token)}: ${token.kind === "damage" ? `printed average ${token.average ?? "unsupported"}; bonus ${token.value}` : token.value}`);
			const choice = ui.select(panel, `${token.kind} ${token.paragraph + 1}:${token.token + 1} contribution`, decisionOptions);
			const explanation = ui.reason(panel, `${token.kind} ${token.paragraph + 1}:${token.token + 1} accounting reason`);
			return {choice, explanation, read: () => ({tokenId: token.id, decision: choice.read(), reason: explanation.read()})};
		});
		if (tokens.length) {
			panel.append(button("Use this entry decision and reason for its unreviewed tokens", () => {
				if (!decision.read() || !reason.read()?.trim()) return;
				for (const token of tokens) {
					if (token.choice.read() !== undefined || token.explanation.read() !== undefined) continue;
					token.choice.set(decision.read()); token.explanation.set(reason.read());
				}
				onChange();
			}));
		}
		return () => ({entryId: entry.id, decision: decision.read(), reason: reason.read(), tokens: tokens.map(token => token.read())});
	});
	return () => reads.map(read => read());
}

function renderRoutines ({parent, form, ui, onChange}) {
	const root = group(parent, "Three-round routines");
	paragraph(root, "Declare complete alternatives, not extra attacks on top of Multiattack. Include all relevant riders, targets, recharge limits and off-turn effects, or explain their exclusion. Mist / no-actions forms can use an explained zero-damage fixed routine.");
	const damage = form.entries.flatMap(entry => entry.tokens.filter(token => token.kind === "damage").map(token => ({entry, token})));
	const supportedDamage = damage.filter(({entry, token}) => entry.supported && token.average !== undefined);
	const accuracy = form.entries.filter(entry => entry.supported).flatMap(entry => entry.tokens.filter(token => ["hit", "dc"].includes(token.kind)).map(token => [token.id, tokenLabel(entry, token)]));
	const routines = [];
	let nextRoutine = 0;
	const selection = ui.select(root, "Routine selection policy", [["highest-damage", "Evaluate highest three-round damage"]]);
	const list = element("div");
	root.append(list);
	const refreshSelection = () => {
		const previous = selection.read();
		selection.node.replaceChildren(new Option("Choose…", ""), new Option("Evaluate highest three-round damage", "highest-damage"));
		routines.forEach(item => selection.node.add(new Option(item.id, item.id)));
		selection.set(previous);
	};
	const addRoutine = button("Add alternative routine", () => {
		const id = `routine-${++nextRoutine}`;
		const panel = group(list, id);
		const rows = [];
		const rowList = element("div");
		panel.append(rowList);
		const predominant = ui.select(panel, "Predominant attack / save accuracy", [...accuracy, ["fixed", "Fixed adjudication (including no attack / save)"]]);
		const fixedAccuracy = element("fieldset", {className: "bqa__transformation-optional"});
		fixedAccuracy.disabled = fixedAccuracy.hidden = true;
		panel.append(fixedAccuracy);
		const kind = ui.select(fixedAccuracy, "Fixed accuracy kind", [["attack", "Attack bonus"], ["save", "Save DC"]]);
		const accuracyValue = ui.number(fixedAccuracy, "Fixed accuracy value", -100, 100);
		const accuracyName = ui.field(fixedAccuracy, "Accuracy source name", {value: form.current.name});
		const accuracySource = ui.field(fixedAccuracy, "Accuracy source book", {value: form.chassisSource});
		const accuracyReason = ui.reason(fixedAccuracy, "Fixed accuracy reason");
		ui.toggle(predominant, fixedAccuracy, () => predominant.read() === "fixed");
		const mixedReason = ui.reason(panel, "Predominant / mixed-accuracy explanation");
		const note = ui.reason(panel, "Routine source and schedule explanation");
		const addRow = button("Add contribution", () => {
			const row = element("fieldset", {className: "bqa__transformation-resolution-row"});
			row.append(element("legend", {text: `Contribution ${rows.length + 1}`}));
			rowList.append(row);
			const source = ui.select(row, "Damage contribution", [...supportedDamage.map(({entry, token}) => [token.id, `${tokenLabel(entry, token)} · ${token.average} per use`]),
				["fixed", "Bounded fixed adjudication (not inferred from prose)"]]);
			const fixedFields = element("fieldset", {className: "bqa__transformation-optional"});
			fixedFields.disabled = fixedFields.hidden = true;
			row.append(fixedFields);
			const value = ui.number(fixedFields, "Fixed per-use value", 0, 100_000);
			value.node.step = "any";
			const name = ui.field(fixedFields, "Adjudication source name", {value: form.current.name});
			const book = ui.field(fixedFields, "Adjudication source code", {value: form.chassisSource});
			const fixedReason = ui.reason(fixedFields, "Fixed contribution reason");
			paragraph(fixedFields, "If this value replaces observed damage, select the exact damage tokens it accounts for. Positive scheduled use is still required. Leave unrelated / excluded tokens unlinked.");
			const accounts = damage.map(({entry, token}) => [token.id, ui.select(fixedFields, `Accounts for ${tokenLabel(entry, token)}?`,
				[["yes", "Included in this fixed value"]], {required: false})]);
			ui.toggle(source, fixedFields, () => source.read() === "fixed");
			const timing = ui.select(row, "Timing / use restriction", ["normal", "conditional", "off-turn", "ongoing", "recharge", "limited-use"].map(it => [it, it]));
			const explanation = ui.reason(row, "Contribution schedule reason");
			const counts = []; const targets = [];
			const schedule = element("div", {className: "bqa__transformation-schedule"});
			row.append(schedule);
			for (let i = 0; i < 3; ++i) {
				const round = element("div");
				schedule.append(round);
				counts.push(ui.number(round, `Round ${i + 1} uses`, 0, 20));
				targets.push(ui.number(round, `Round ${i + 1} targets`, 1, 100));
			}
			const read = () => {
				const links = accounts.filter(([, input]) => input.read() === "yes").map(([id]) => id);
				return {counts: counts.map(it => it.read()),
					targets: targets.map(it => it.read()),
					timing: timing.read(),
					reason: explanation.read(),
					...source.read() === "fixed" ? {fixed: {value: value.read(), source: {name: name.read(), source: book.read()}, reason: fixedReason.read()},
						...links.length ? {accountsFor: links} : {}} : {tokenId: source.read()}};
			};
			rows.push(read);
			row.append(button("Remove contribution", () => { rows.splice(rows.indexOf(read), 1); row.remove(); addRow.disabled = false; onChange(); addRow.focus({preventScroll: true}); }));
			addRow.disabled = rows.length >= 24;
			onChange();
		});
		panel.append(addRow);
		const item = {id,
			read: () => ({id,
				rows: rows.map(read => read()),
				accuracy: predominant.read() === "fixed" ? {kind: kind.read(), value: accuracyValue.read(), source: {name: accuracyName.read(), source: accuracySource.read()}, reason: accuracyReason.read()} : predominant.read(),
				mixedReason: mixedReason.read(),
				note: note.read()})};
		routines.push(item);
		panel.append(button("Remove routine", () => { routines.splice(routines.indexOf(item), 1); panel.remove(); addRoutine.disabled = false; refreshSelection(); onChange(); addRoutine.focus({preventScroll: true}); }));
		addRoutine.disabled = routines.length >= 12;
		refreshSelection();
		onChange();
	});
	root.append(addRoutine);
	return () => ({routines: routines.map(item => item.read()), routine: selection.read()});
}

export function renderEstimateForm ({parent, form, ui, onChange}) {
	const root = group(parent, `Post-source · ${form.label}`);
	root.dataset.estimateForm = form.id;
	paragraph(root, "These are the actual numbers after source changes, before CR-derived proficiency reconciliation. Declare their ownership and estimate-only judgments separately. Every permitted form must be completed, even when inactive.");
	paragraph(root, `Abilities: ${ABILITIES.map(key => `${Parser.attAbvToFull(key)} ${form.current[key]}`).join(", ")}. HP: ${describeFact(form.current.hp)}. CR: ${describeFact(form.current.cr)}.`);
	const bindingsGroup = group(root, "Post-source armor and numeric ownership", {open: false});
	const bindings = renderNumericBindings({parent: bindingsGroup, current: form.current, entries: form.entries, ui});
	const armorReason = ui.reason(bindingsGroup, "Post-source armor reason");
	const proficiencies = group(root, "Post-source saving throw / skill proficiency", {open: false});
	const proficiencyReads = Object.fromEntries(["save", "skill"].map(section => [section, Object.entries(form.current[section] || {}).map(([name, value]) => {
		const locked = form.sourceProficiencies[section][name];
		if (locked !== undefined) {
			paragraph(proficiencies, `${section}: ${name}, observed ${value}. Source-defined PB multiplier: ${locked} (locked).`);
			return [name, () => locked];
		}
		const input = ui.select(proficiencies, `${section}: ${name}, observed ${value} - PB multiplier`, MULTIPLIERS);
		return [name, () => input.read() === undefined ? undefined : Number(input.read())];
	})]));
	const ownership = ui.optional(proficiencies, "Declare PB ownership (ambiguity / source-fixed policy)?", body => {
		const mode = ui.select(body, "PB ownership", [["derived", "Derived from CR"], ["source-fixed", "Source-fixed"]]);
		const value = ui.number(body, "Exact current PB for ownership answer", 1, 30);
		const reason = ui.reason(body, "PB ownership reason");
		return () => ({mode: mode.read(), value: value.read(), reason: reason.read()});
	});
	const defenses = group(root, "Actual defenses and explained review", {open: false});
	const defenseReads = form.defenses.map(({field, value}) => {
		paragraph(defenses, `${DEFENSE_NAMES[field]}: ${describeFact(value)}`);
		const reason = ui.reason(defenses, `${DEFENSE_NAMES[field]} review (including absence / conditions)`);
		return () => ({field, reason: reason.read()});
	});
	const defense = group(root, "Defense assumptions");
	paragraph(defense, `Observed CR ${describeFact(form.current.cr)} is only a suggestion for the expected band. Poison immunity alone does not establish an effective defense multiplier.`);
	const expectedCr = ui.select(defense, "Expected CR band (deliberately adopt or edit)", CR_CHOICES);
	const acIndex = ui.select(defense, "AC alternative to evaluate", (form.current.ac || []).map((value, i) => [i, `${i + 1}: ${describeFact(value)}`]));
	const resistance = ui.select(defense, "Effective resistance policy", [["none", "None"], ["resistance", "Resistance"], ["immunity", "Immunity"]]);
	const vulnerability = ui.select(defense, "Prevalent multiple vulnerabilities?", YES_NO);
	const regeneration = ui.number(defense, "Applicable regeneration per round", 0, 1000);
	const hpAdjustment = ui.number(defense, "Estimate-only effective HP adjustment", -100_000, 100_000);
	const acAdjustment = ui.number(defense, "Estimate-only effective AC adjustment", -100, 100);
	const hpBoundary = ui.select(defense, "Exact 760 / 805 effective HP overlap policy (only if required)", [["lower", "Lower row"], ["higher", "Higher row"]], {required: false});
	const defenseNote = ui.reason(defense, "Defense policy and reviewed feature adjustments");
	const coverage = renderCoverage({parent: root, form, ui, onChange});
	const routines = renderRoutines({parent: root, form, ui, onChange});
	const final = group(root, "Estimated CR and explained override");
	paragraph(final, "DMG 2014 estimate, not playtested. The estimate stays visible and saved independently of any final CR override.");
	const override = ui.optional(final, "Override estimated CR?", body => {
		const cr = ui.select(body, "Final CR override", CR_CHOICES);
		const reason = ui.reason(body, "CR override reason");
		return () => ({cr: cr.read(), reason: reason.read()});
	});
	const zeroXp = ui.select(final, "Final CR0 no-threat 0 XP policy?", [["no", "No - canonical XP (CR0 normally 10)"], ["yes", "Yes - final CR0 only"]]);
	const review = ui.select(final, "All relevant effects and complete alternatives reviewed?", [["yes", "I confirm complete review"]]);
	const reviewReason = ui.reason(final, "Completeness explanation (never auto-authored)");
	return {root,
		form,
		read: () => ({
			targetKey: form.targetKey,
			bindings: bindings(),
			proficiencies: Object.fromEntries(Object.entries(proficiencyReads).map(([section, reads]) => [section, Object.fromEntries(reads.map(([name, read]) => [name, read()]))])),
			armorReason: armorReason.read(),
			defenses: defenseReads.map(read => read()),
			cr: {defense: {expectedCr: expectedCr.read(),
				hpBoundary: hpBoundary.read() ?? null,
				acIndex: acIndex.read() === undefined ? undefined : Number(acIndex.read()),
				acAdjustment: acAdjustment.read(),
				hpAdjustment: hpAdjustment.read(),
				resistance: resistance.read(),
				vulnerability: vulnerability.read() === undefined ? undefined : vulnerability.read() === "yes",
				regeneration: regeneration.read(),
				note: defenseNote.read()},
			...routines(),
			coverage: coverage(),
			review: {confirmed: review.read() === "yes", reason: reviewReason.read()},
			override: override() ?? null,
			zeroXp: zeroXp.read() === undefined ? undefined : zeroXp.read() === "yes",
			proficiencyAnswer: ownership() ?? null},
		})};
}
