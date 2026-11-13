import {inspectCreatureTransformationSourceInputs, previewCreatureTransformationSourceInputs, SOURCE_ESTIMATE_MODE} from "./bestiary-transformation-source-inputs.js";
import {createEditorFields, describeFact, element, paragraph} from "./bestiary-transformation-editor-controls.js";
import {renderSourceChoices} from "./bestiary-transformation-editor-source.js";
import {renderEstimateForm} from "./bestiary-transformation-editor-estimate.js";

let nextErrorId = 0;

export function renderGuidedTarget ({parent, target, resolved, onChange, getLegendaryGroups}) {
	const model = inspectCreatureTransformationSourceInputs({target, resolved});
	const root = element("fieldset", {className: "bqa__transformation-resolution"});
	root.append(element("legend", {text: target.label}));
	paragraph(root, `Observed source: ${model.current.name} (${model.chassisSource}); type ${describeFact(model.current.type)}; size ${describeFact(model.current.size)}; CR ${describeFact(model.current.cr)}. These are facts, not eligibility confirmations.`);
	const status = paragraph(root, "Needs answers");
	status.setAttribute("role", "status");
	const error = element("p", {className: "bqa__transformation-resolution-error"});
	error.id = `bqa-source-error-${++nextErrorId}`;
	error.setAttribute("role", "status");
	const output = element("div", {className: "bqa__transformation-cr-estimate"});
	output.setAttribute("aria-live", "polite");
	const ui = createEditorFields({onChange, error});
	const source = renderSourceChoices({parent: root, model, resolved, ui, getLegendaryGroups});
	const formsRoot = element("div");
	const forms = new Map();
	let sourceKey = null;
	let formsKey = null;
	let requirements = model.requirements;
	root.append(formsRoot, error, output);
	parent.append(root);
	const read = () => {
		const answers = {mode: SOURCE_ESTIMATE_MODE, targetKey: model.targetKey, source: source()};
		const nextSource = JSON.stringify(Object.fromEntries(Object.entries(answers.source).map(([id, answer]) => [id, answer.value])));
		if (sourceKey !== nextSource) {
			const hadForms = forms.size > 0;
			sourceKey = nextSource;
			forms.clear(); formsKey = null; formsRoot.replaceChildren();
			if (hadForms) paragraph(formsRoot, "Source choices changed. Previous form judgments were discarded; review the new actual forms.");
		}
		const preview = previewCreatureTransformationSourceInputs({target, resolved, answers, legendaryGroups: getLegendaryGroups()});
		if (preview.status === "source-ready") {
			const key = JSON.stringify(preview.forms.map(form => form.targetKey));
			if (formsKey !== key) {
				formsKey = key; forms.clear(); formsRoot.replaceChildren();
				for (const form of preview.forms) forms.set(form.id, renderEstimateForm({parent: formsRoot, form, ui, onChange}));
			}
			answers.forms = Object.fromEntries([...forms].map(([id, panel]) => [id, panel.read()]));
		}
		return answers;
	};
	return {root,
		model,
		read,
		focus: () => {
			const requirement = requirements[0];
			const control = model.controls.find(control => control.id === requirement?.control)
				|| model.controls.find(control => new RegExp(`\\b${control.path.at(-1)}\\b`, "i").test(requirement?.reason || ""));
			const source = control && [...root.querySelectorAll("details")].find(node => node.dataset.sourceControl === control.id);
			ui.focus(source || root);
		},
		update: compiled => {
			requirements = compiled?.requirements || model.requirements;
			ui.validate(root);
			status.textContent = compiled?.status === "ready" ? "Ready" : compiled?.status === "ineligible" ? "Ineligible" : "Needs answers";
			error.textContent = compiled?.requirements?.map(it => it.reason).join("; ") || model.requirements.map(it => it.reason).join("; ");
			output.replaceChildren();
			for (const estimate of compiled?.estimates || []) {
				const {receipt, value} = estimate;
				paragraph(output, `${forms.get(estimate.form)?.form.label || estimate.form}: DMG 2014 estimate, not playtested. Estimated CR ${receipt.estimatedCr}; defensive ${receipt.defensiveCr}; offensive ${receipt.offensiveCr}. Final CR ${value.cr}, ${value.xp} XP.`);
				paragraph(output, `Effective HP ${receipt.effectiveHp}; AC ${receipt.effectiveAc}; routine ${receipt.routineId}, DPR ${receipt.damagePerRound}, accuracy ${receipt.accuracy}. PB ${receipt.proficiency.before} → ${receipt.proficiency.after} (${receipt.proficiency.source}).`);
				if (receipt.assumptions.override) paragraph(output, `Override (independent estimate retained): CR ${receipt.assumptions.override.cr}. ${receipt.assumptions.override.reason}`);
			}
		}};
}
