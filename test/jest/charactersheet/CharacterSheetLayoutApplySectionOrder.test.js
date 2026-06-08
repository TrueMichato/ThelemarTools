import "./setup.js";
import "../../../js/charactersheet/charactersheet-layout.js";

const CharacterSheetLayout = globalThis.CharacterSheetLayout;

function makeContainer (ids, {withHeader = false} = {}) {
	const children = [];
	if (withHeader) {
		children.push({className: "charsheet__column-title", dataset: {}});
	}

	const mkSection = (id) => {
		const section = {
			className: "charsheet__section",
			dataset: {sectionId: id},
			_container: null,
			after (other) {
				const arr = this._container.children;
				const thisIx = arr.indexOf(this);
				const otherIx = arr.indexOf(other);
				if (otherIx >= 0) arr.splice(otherIx, 1);
				arr.splice(thisIx + 1, 0, other);
			},
		};
		return section;
	};

	ids.forEach(id => children.push(mkSection(id)));
	const container = {
		children,
		querySelectorAll (sel) {
			if (sel === ":scope > .charsheet__section") {
				return this.children.filter(it => String(it.className || "").includes("charsheet__section"));
			}
			return [];
		},
		querySelector (sel) {
			if (sel === ":scope > .charsheet__section") {
				return this.children.find(it => String(it.className || "").includes("charsheet__section")) || null;
			}
			return null;
		},
		insertBefore (node, beforeNode) {
			const arr = this.children;
			const curIx = arr.indexOf(node);
			if (curIx >= 0) arr.splice(curIx, 1);
			const beforeIx = arr.indexOf(beforeNode);
			if (beforeIx >= 0) arr.splice(beforeIx, 0, node);
			else arr.push(node);
		},
	};

	container.children.forEach(it => {
		if (String(it.className || "").includes("charsheet__section")) it._container = container;
	});

	return container;
}

function getSectionIds (container) {
	return container.querySelectorAll(":scope > .charsheet__section").map(s => s.dataset.sectionId);
}

describe("_applySectionOrder", () => {
	test("appends sections absent from saved order at the end in DOM order", () => {
		const container = makeContainer(["a", "c", "b", "d"]);
		const layout = Object.create(CharacterSheetLayout.prototype);

		layout._applySectionOrder(container, ["b", "a"]);

		expect(getSectionIds(container)).toEqual(["b", "a", "c", "d"]);
	});

	test("inserts first ordered section before the first section child only", () => {
		const container = makeContainer(["a", "b", "c"], {withHeader: true});
		const layout = Object.create(CharacterSheetLayout.prototype);

		layout._applySectionOrder(container, ["c", "a"]);

		expect(container.children[0].className).toBe("charsheet__column-title");
		expect(getSectionIds(container)).toEqual(["c", "a", "b"]);
	});
});
