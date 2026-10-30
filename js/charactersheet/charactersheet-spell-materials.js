/** Required supplies are ordinary inventory items, not Arcadia enhancement components. */
export class CharacterSheetSpellMaterials {
	static getMaterialInfo (spell) {
		const raw = spell?.components?.m;
		if (!raw) return null;
		if (typeof raw !== "string") {
			const prose = raw.cost == null ? this.getMaterialInfo({components: {m: raw.text}}) : null;
			const cost = Number(raw.cost ?? prose?.cost) || 0;
			const consume = raw.consume ?? prose?.consume ?? false;
			return {text: raw.text || "", cost, consume, ...(prose?.manual ? {manual: true} : {}), requiresFocus: cost <= 0 && !consume && !prose?.manual};
		}
		const prices = [...raw.matchAll(/([\d,]+(?:\.\d+)?)\s*\+?\s*(CP|SP|EP|GP|PP|copper pieces?|silver pieces?|electrum pieces?|gold pieces?|platinum pieces?)\b/gi)];
		const currency = {cp: 1, copper: 1, sp: 10, silver: 10, ep: 50, electrum: 50, gp: 100, gold: 100, pp: 1000, platinum: 1000};
		const cost = prices.length === 1 ? Number(prices[0][1].replace(/,/g, "")) * currency[prices[0][2].toLowerCase().split(" ")[0]] : 0;
		const consumed = !/(?:not|never) consumed|does not consume|doesn't consume/i.test(raw) && /(?:spell|which|you) consumes?|consumed|shatters when the spell ends/i.test(raw);
		const consume = consumed && /optionally|may (?:be )?consum|can (?:be )?consum/i.test(raw) ? "optional" : consumed;
		const manual = prices.length > 1 || (!prices.length && /\bworth\b/i.test(raw));
		return {text: raw, cost, consume, manual, requiresFocus: cost <= 0 && !consume && !manual};
	}

	static _part (name, cost, consume, extra = {}) {
		const material = name.toLowerCase();
		return {key: `${material}|${cost}`, material, name, cost, consume, quantity: 1, manual: false, timing: "cast", ...extra};
	}

	static getRequirements (spell) {
		const m = this.getMaterialInfo(spell);
		if (!m || (!m.cost && !m.consume && !m.manual)) return [];
		const text = String(m.text || "");
		const name = String(spell.name || "");
		const source = String(spell.source || "").toUpperCase();
		const part = (label, cost = Number(m.cost) || 0, consume = m.consume || false, extra = {}) => this._part(label, cost, consume, {text, ...extra});
		const official = ["PHB", "XPHB"].includes(source);
		let parts;
		if (official && name === "Simulacrum") parts = [part("Powdered Ruby")];
		else if (official && name === "Warding Bond") parts = [part("Platinum Ring", 5000, false, {quantity: 2})];
		else if (official && name === "Clone") {
			parts = [
				part(source === "PHB" ? "Diamond and Clone Preparation" : "Diamond", 100000, true, {manual: source === "PHB"}),
				part("Sealable Clone Vessel", 200000, false),
			];
		} else if (official && name === "Legend Lore") parts = [part("Incense", 25000, true), part("Ivory Strip", 5000, false, {quantity: 4})];
		else if (official && name === "Leomund's Secret Chest") parts = [part("Exquisite Chest", 500000, false), part("Tiny Chest Replica", 5000, false)];
		else if (source === "PHB" && name === "Mordenkainen's Magnificent Mansion") {
			parts = [
				part("Miniature Ivory Portal", 500, false), part("Polished Marble", 500, false), part("Tiny Silver Spoon", 500, false),
			];
		} else if (source === "PHB" && name === "Find Familiar") parts = [part("Charcoal, Incense and Herbs", 1000, true), part("Brass Brazier", 0, false)];
		else if (source === "IDROTF" && name === "Create Magen") parts = [part("Quicksilver and Life-sized Doll", 50000, true), part("Intricate Crystal Rod", 150000, false)];
		else if (source === "XGE" && name === "Create Homunculus") parts = [part("Clay, Ash and Mandrake Root", 0, true), part("Jewel-encrusted Dagger", 100000, false)];
		else if (source === "FRHOF" && name === "Deryan's Helpful Homunculi") {
			parts = [
				part("Powdered Gemstones", 10000, true), part("Proficient Artisan's Tools", 0, false, {manual: true}),
			];
		} else if (source === "XPHB" && name === "Gentle Repose") parts = [part("Copper Piece", 1, true, {quantity: 2})];
		else {
			// A complete set retains alternatives/qualifications verbatim; it is not
			// an assertion that any one noun appearing in the prose is sufficient.
			let label = text
				.replace(/,\s*(?:both of which|all of which|which)\s+the spell consumes.*$/i, "")
				.replace(/\s+worth\b.*$/i, "")
				.replace(/^[\d,]+\s*(?:gp|sp|cp)\s+worth of\s+/i, "")
				.replace(/^(?:a|an|the|some)\s+/i, "")
				.replace(/^a?\s*pinch of\s+/i, "")
				.trim();
			if (/^(?:a )?diamond(?:s)?(?: worth|$)/i.test(text)) label = "Diamond";
			if (/^(?:a pinch of )?diamond dust\b/i.test(text)) label = "Diamond Dust";
			if (/^(?:powdered ruby|ruby dust)\b/i.test(text)) label = "Powdered Ruby";
			if (/^powdered diamond\b/i.test(text)) label = "Diamond Dust";
			const variable = m.manual || /per Hit Die|for each|each of the spell's targets|for each corpse/i.test(text);
			const complex = !label || label.length > 65 || /\band\b|\bor\b|;|,/.test(label);
			const manual = variable || /determined by|varies|proficiency|attuned|tuned to|died|a particular|caster's blood|flesh|from the location/i.test(text)
				|| (complex && !official);
			parts = [part(complex ? `${name} Material Set` : label.charAt(0).toUpperCase() + label.slice(1), variable ? 0 : Number(m.cost) || 0, m.consume || false, {
				manual,
				...(complex ? {material: `set:${text.toLowerCase()}`, key: `set:${text.toLowerCase()}|${Number(m.cost) || 0}`} : {}),
				timing: /when the spell ends/i.test(text) ? "end" : (variable || (complex && !official)) && m.consume ? "manual" : "cast",
			})];
		}
		return parts.map(row => ({...row, spellUid: `${spell.name}|${spell.source}`}));
	}

	static buildCatalog (spells) {
		const items = new Map();
		for (const spell of spells || []) {
			for (const requirement of this.getRequirements(spell)) {
				const key = `${String(spell.source).toLowerCase()}|${requirement.key}`;
				let item = items.get(key);
				if (!item) {
					const price = requirement.cost ? ` (${requirement.cost / 100} gp)` : "";
					item = {
						name: `${requirement.name}${price}`,
						source: spell.source,
						...(spell.page != null ? {page: spell.page} : {}),
						type: "G",
						rarity: "none",
						...(requirement.cost > 0 ? {value: requirement.cost} : {}),
						spellComponent: {key: requirement.key, material: requirement.material, spells: []},
						entries: [],
					};
					items.set(key, item);
				}
				if (!item.spellComponent.spells.includes(requirement.spellUid)) item.spellComponent.spells.push(requirement.spellUid);
				const handling = requirement.consume
					? requirement.timing === "end" ? "Consumed when the spell ends; remove it manually at that time."
						: requirement.timing === "manual" ? "Target-dependent quantity and consumption require manual bookkeeping."
							: requirement.consume === "optional" ? "Consumption is optional." : "Consumed when cast."
					: "Reusable; not consumed when cast.";
				const entry = `${requirement.spellUid}: ${requirement.quantity > 1 ? `${requirement.quantity} required. ` : ""}${handling} ${requirement.text}${requirement.manual ? " Confirm qualifications with the DM for each cast." : ""}`;
				if (!item.entries.includes(entry)) item.entries.push(entry);
			}
		}
		return [...items.values()];
	}

	static matches (item, requirement) {
		const value = Number(item.value) || 0;
		if (value > 0 && value < requirement.cost) return false;
		if (item.spellComponent) return item.spellComponent.material === requirement.material;
		if (requirement.material.startsWith("set:")) return false;
		const stem = text => String(text).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).map(word => word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word);
		const words = stem(String(item.name).replace(/ruby dust/i, "powdered ruby").replace(/powdered diamond/i, "diamond dust"));
		const needed = stem(requirement.name);
		if (["diamond", "ruby", "sapphire"].includes(requirement.material) && words.some(word => ["dust", "powdered"].includes(word))) return false;
		return needed.length > 0 && needed.every(word => words.includes(word));
	}

	static getMissing (state, requirements) {
		return requirements.filter(requirement => state.getSpellMaterialCandidates(requirement).reduce((sum, row) => sum + row.quantity, 0) < requirement.quantity);
	}
}
