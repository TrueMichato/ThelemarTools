import {RenderBestiary} from "../../render-bestiary.js";

const _PROPS_ATTACK = ["action", "bonus", "reaction", "legendary", "mythic"];

export function getNpcTrackerDetailModel (monster, {fluff = null} = {}) {
	if (!monster) return null;

	return {
		abilities: Parser.ABIL_ABVS
			.filter(abv => typeof monster[abv] === "number")
			.map(abv => ({
				abv,
				score: monster[abv],
				modifier: Parser.getAbilityModNumber(monster[abv]),
			})),
		saves: Object.entries(monster.save || {})
			.filter(([key]) => Parser.ABIL_ABVS.includes(key))
			.map(([ability, bonus]) => ({ability, bonus})),
		skills: Object.entries(monster.skill || {})
			.filter(([key]) => !["other", "special"].includes(key))
			.map(([skill, bonus]) => ({skill, bonus})),
		traits: monster.trait || [],
		spellcasting: monster.spellcasting || [],
		attacks: _PROPS_ATTACK
			.flatMap(prop => (monster[prop] || []).map(entry => ({...entry, _prop: prop})))
			.filter(entry => hasNpcTrackerAttackRoll(entry)),
		fluffEntries: fluff?.entries || monster.fluff?.entries || [],
	};
}

export function hasNpcTrackerAttackRoll (entry) {
	return JSON.stringify(entry?.entries || []).includes("{@atk")
		|| JSON.stringify(entry?.entries || []).includes("{@hit");
}

export function getNpcTrackerDisplayName (npc) {
	return npc?.alias || npc?.monster?.name || "Unnamed NPC";
}

export function getNpcTrackerSignedNumber (value) {
	const num = Number(value);
	if (!Number.isFinite(num)) return `${value}`;
	return num >= 0 ? `+${num}` : `${num}`;
}

export class NpcTrackerDetail {
	constructor ({fnGetNpc, fnSetViewMode, fnUpdateHp}) {
		this._fnGetNpc = fnGetNpc;
		this._fnSetViewMode = fnSetViewMode;
		this._fnUpdateHp = fnUpdateHp;
	}

	render ({wrp, isFullStatblock = false, isNarrow = false, fnShowRoster = null}) {
		wrp.empty();
		const npc = this._fnGetNpc();
		if (!npc) {
			ee`<div class="dm-npc__empty">
				<span class="glyphicon glyphicon-user"></span>
				<strong>Select an NPC</strong>
				<span>Choose someone from the roster to see roleplay details and rolls.</span>
			</div>`.appendTo(wrp);
			return;
		}

		const wrpDetail = ee`<div class="dm-npc__detail"></div>`;
		this._renderHeader({npc, wrp: wrpDetail, isFullStatblock, isNarrow, fnShowRoster});

		const wrpScroll = ee`<div class="dm-npc__detail-scroll"></div>`.appendTo(wrpDetail);
		if (isFullStatblock) this._renderFullStatblock({npc, wrp: wrpScroll});
		else this._renderRoleplayView({npc, wrp: wrpScroll});

		wrpDetail.appendTo(wrp);
	}

	_renderHeader ({npc, wrp, isFullStatblock, isNarrow, fnShowRoster}) {
		const mon = npc.monster;
		const btnBack = isNarrow
			? ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-npc__back" type="button"><span class="glyphicon glyphicon-chevron-left"></span> Roster</button>`
				.onn("click", fnShowRoster)
			: null;

		const btnMode = ee`<button class="ve-btn ve-btn-default ve-btn-xs" type="button"></button>`;
		btnMode.textContent = isFullStatblock ? "Roleplay view" : "Full statblock";
		btnMode.onn("click", () => this._fnSetViewMode(!isFullStatblock));

		const eleName = ee`<h2 class="dm-npc__name"></h2>`;
		eleName.textContent = getNpcTrackerDisplayName(npc);
		const eleOriginal = npc.alias ? ee`<span class="dm-npc__original-name"></span>` : null;
		if (eleOriginal) eleOriginal.textContent = mon.name;

		const eleMeta = ee`<div class="dm-npc__meta"></div>`;
		eleMeta.textContent = this._getMetaText(mon);

		const wrpIdentity = ee`<div class="dm-npc__identity">${eleName}${eleOriginal}${eleMeta}</div>`;
		const wrpControls = ee`<div class="dm-npc__detail-actions">${btnMode}</div>`;

		ee`<div class="dm-npc__detail-header">
			${btnBack}
			${wrpIdentity}
			${this._getHpControl(npc)}
			${wrpControls}
		</div>`.appendTo(wrp);
	}

	_getMetaText (mon) {
		const parts = [];
		if (mon.size) parts.push(Parser.sizeAbvToFull(Array.isArray(mon.size) ? mon.size[0] : mon.size));
		if (mon.type) parts.push(Parser.monTypeToFullObj(mon.type).asText);
		if (mon.cr != null) parts.push(`CR ${mon.cr.cr || mon.cr}`);
		return parts.filter(Boolean).join(" · ");
	}

	_getHpControl (npc) {
		const getInput = ({value, label, prop}) => ee`<input class="ve-form-control ve-input-xs dm-npc__hp-input" type="number" min="0" value="${value}" aria-label="${label}">`
			.onn("change", evt => this._fnUpdateHp({npc, prop, value: evt.currentTarget.value}));

		return ee`<div class="dm-npc__hp" aria-label="Hit points">
			<span class="dm-npc__hp-label">HP</span>
			${getInput({value: npc.hp.current, label: "Current hit points", prop: "current"})}
			<span>/</span>
			${getInput({value: npc.hp.max, label: "Maximum hit points", prop: "max"})}
			<span class="dm-npc__hp-temp-label">Temp</span>
			${getInput({value: npc.hp.temp, label: "Temporary hit points", prop: "temp"})}
		</div>`;
	}

	_renderRoleplayView ({npc, wrp}) {
		const mon = npc.monster;
		const model = getNpcTrackerDetailModel(mon, {fluff: npc.fluff});

		this._renderCoreStats({mon, model, wrp});
		this._renderEntriesSection({wrp, title: "Roleplay Traits", entries: model.traits});
		this._renderEntriesSection({wrp, title: "Spellcasting", entries: model.spellcasting});
		this._renderEntriesSection({wrp, title: "Attacks", entries: model.attacks});
		this._renderEntriesSection({wrp, title: "Lore & Information", entries: model.fluffEntries});
	}

	_renderCoreStats ({mon, model, wrp}) {
		const wrpAbilities = ee`<div class="dm-npc__abilities"></div>`;
		model.abilities.forEach(({abv, score, modifier}) => {
			const btn = ee`<button class="dm-npc__ability" type="button"></button>`;
			btn.innerHTML = `<span>${abv.toUpperCase()}</span><strong>${score}</strong><span>${getNpcTrackerSignedNumber(modifier)}</span>`;
			btn.attr("title", `Roll ${Parser.attAbvToFull(abv)} check`);
			btn.onn("click", () => this._roll({
				npcName: this._fnGetNpc()?.alias || mon.name,
				label: `${Parser.attAbvToFull(abv)} check`,
				bonus: modifier,
			}));
			btn.appendTo(wrpAbilities);
		});

		const wrpSection = ee`<section class="dm-npc__section dm-npc__section--core">
			<h3>At a glance</h3>
			${wrpAbilities}
		</section>`.appendTo(wrp);

		const addLine = ({label, html}) => {
			if (!html) return;
			ee`<div class="dm-npc__stat-line"><strong>${label}</strong><span>${html}</span></div>`.appendTo(wrpSection);
		};
		addLine({label: "Saving Throws", html: model.saves.map(({ability, bonus}) => this._getRollButtonHtml({name: ability.toUpperCase(), bonus, label: `${Parser.attAbvToFull(ability)} save`})).join(", ")});
		addLine({label: "Skills", html: model.skills.map(({skill, bonus}) => this._getRollButtonHtml({name: skill.toTitleCase(), bonus, label: `${skill.toTitleCase()} check`})).join(", ")});
		addLine({label: "Resistances", html: mon.resist ? Parser.getFullImmRes(mon.resist) : ""});
		addLine({label: "Vulnerabilities", html: mon.vulnerable ? Parser.getFullImmRes(mon.vulnerable) : ""});
		addLine({label: "Immunities", html: Renderer.monster.getImmunitiesCombinedPart(mon)});
		addLine({label: "Senses", html: Renderer.monster.getSensesPart(mon)});
		addLine({label: "Languages", html: Renderer.monster.getRenderedLanguages(mon.languages)});

		wrpSection.querySelectorAll("[data-roll-bonus]").forEach(btn => btn.addEventListener("click", () => this._roll({
			npcName: this._fnGetNpc()?.alias || mon.name,
			label: btn.dataset.rollLabel,
			bonus: btn.dataset.rollBonus,
		})));
	}

	_getRollButtonHtml ({name, bonus, label}) {
		return `<button class="dm-npc__inline-roll roller" type="button" data-roll-bonus="${bonus}" data-roll-label="${label}">${name} ${getNpcTrackerSignedNumber(bonus)}</button>`;
	}

	_renderEntriesSection ({wrp, title, entries}) {
		if (!entries?.length) return;
		const renderer = Renderer.get();
		const wrpEntries = ee`<div class="dm-npc__entries"></div>`;
		entries.forEach(entry => {
			const entryRenderable = entry?.name && entry?.entries
				? {type: "entries", name: entry.name, entries: entry.entries}
				: entry;
			ee`<div class="dm-npc__entry">${renderer.render(entryRenderable, 2)}</div>`.appendTo(wrpEntries);
		});
		ee`<section class="dm-npc__section"><h3>${title}</h3>${wrpEntries}</section>`.appendTo(wrp);
	}

	_renderFullStatblock ({npc, wrp}) {
		const rendered = RenderBestiary.getRenderedCreature(npc.monster, {isSkipTokenRender: true});
		ee`<div class="dm-npc__statblock"></div>`.appends(rendered).appendTo(wrp);
	}

	_roll ({npcName, label, bonus}) {
		return Renderer.dice.pRoll2(`1d20${getNpcTrackerSignedNumber(bonus)}`, {
			isUser: false,
			name: npcName,
			label,
		});
	}
}
