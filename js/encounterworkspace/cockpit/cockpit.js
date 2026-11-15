// Lantern Cockpit: the redesigned Encounter Workspace UI (in development; reach it with `?ew=2`).
export const pBootEncounterCockpit = async () => {
	const root = document.getElementById("ew-cockpit");
	root.removeAttribute("aria-busy");
	root.replaceChildren(Object.assign(document.createElement("p"), {
		className: "ewc__placeholder",
		textContent: "The new Encounter Workspace is under construction. Open the current workspace with ?ew=1.",
	}));
};
