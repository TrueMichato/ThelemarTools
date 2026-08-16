import {
	getNpcTrackerDisplayName,
	getNpcTrackerRollBonus,
	getNpcTrackerSignedNumber,
	pRollNpcTrackerD20,
} from "./dmscreen-npctracker-roll.js";
import {getNpcTrackerConditionControls} from "./dmscreen-npctracker-condition.js";
import {
	getNpcTrackerMonsterSkillMeta,
	getNpcTrackerSkillDescriptors,
} from "./dmscreen-npctracker-data.js";
import {
	getNpcTrackerAttackBonus,
	getNpcTrackerSpecialEquipmentEntries,
} from "./dmscreen-npctracker-resource.js";

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
		traits: getNpcTrackerSpecialEquipmentEntries(monster),
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

export function getNpcTrackerProficiencyBonusText (monster) {
	if (monster?.pbNote != null && `${monster.pbNote}`.trim()) return `${monster.pbNote}`.trim();
	if (monster?.cr == null) return null;
	const proficiencyBonus = Parser.crToPb(monster.cr?.cr ?? monster.cr);
	return Number.isFinite(proficiencyBonus) ? getNpcTrackerSignedNumber(proficiencyBonus) : null;
}

export function getNpcTrackerAllSkillsModel (monster, {skillCatalog = []} = {}) {
	return getNpcTrackerSkillDescriptors({skillCatalog, monsters: [monster]})
		.map(skill => ({
			...skill,
			skill: skill.name,
			bonus: getNpcTrackerRollBonus({
				npc: {monster},
				rollType: "skill",
				skill,
			}),
			isProficient: !!getNpcTrackerMonsterSkillMeta({monster, skill}),
		}));
}

export {getNpcTrackerDisplayName, getNpcTrackerSignedNumber};

export class NpcTrackerDetail {
	constructor (
		{
			fnGetNpc,
			fnGetReferenceData,
			fnSetViewMode,
			fnUpdateHp,
			fnUpdateCondition,
			fnUpdateSpellSlot,
			fnUpdateCharge,
			fnAddCharge,
			fnEditCharge,
			fnRemoveCharge,
		},
	) {
		this._fnGetNpc = fnGetNpc;
		this._fnGetReferenceData = fnGetReferenceData;
		this._fnSetViewMode = fnSetViewMode;
		this._fnUpdateHp = fnUpdateHp;
		this._fnUpdateCondition = fnUpdateCondition;
		this._fnUpdateSpellSlot = fnUpdateSpellSlot;
		this._fnUpdateCharge = fnUpdateCharge;
		this._fnAddCharge = fnAddCharge;
		this._fnEditCharge = fnEditCharge;
		this._fnRemoveCharge = fnRemoveCharge;
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
		const conditions = getNpcTrackerConditionControls({
			npc,
			fnUpdate: this._fnUpdateCondition,
			conditionCatalog: this._fnGetReferenceData().conditions,
		});

		ee`<div class="dm-npc__detail-header">
			<div class="dm-npc__detail-heading">${btnBack}${wrpIdentity}${wrpControls}</div>
			<div class="dm-npc__detail-vitals">${this._getHpControl(npc)}${conditions}</div>
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
		this._renderSkills({npc, wrp});
		this._renderEntriesSection({wrp, title: "Roleplay Traits", entries: model.traits});
		this._renderSpellSlots({npc, wrp});
		this._renderEntriesSection({wrp, title: "Spellcasting", entries: model.spellcasting});
		this._renderCharges({npc, wrp});
		this._renderEntriesSection({npc, wrp, title: "Attacks", entries: model.attacks, isAttackSection: true});
		this._renderEntriesSection({wrp, title: "Lore & Information", entries: model.fluffEntries});
	}

	_renderCoreStats ({mon, model, wrp}) {
		const wrpAbilities = ee`<div class="dm-npc__abilities"></div>`;
		model.abilities.forEach(({abv, score, modifier}) => {
			const btn = ee`<button class="dm-npc__ability" type="button"></button>`;
			btn.innerHTML = `<span>${abv.toUpperCase()}</span><strong>${score}</strong><span>${getNpcTrackerSignedNumber(modifier)}</span>`;
			btn.attr("title", `Roll ${Parser.attAbvToFull(abv)} check`);
			btn.onn("click", () => this._roll({
				rollType: "ability",
				key: abv,
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
		addLine({label: "Proficiency Bonus", html: getNpcTrackerProficiencyBonusText(mon)});
		addLine({label: "Saving Throws", html: model.saves.map(({ability, bonus}) => this._getRollButtonHtml({name: ability.toUpperCase(), bonus, label: `${Parser.attAbvToFull(ability)} save`})).join(", ")});
		addLine({label: "Resistances", html: mon.resist ? Parser.getFullImmRes(mon.resist) : ""});
		addLine({label: "Vulnerabilities", html: mon.vulnerable ? Parser.getFullImmRes(mon.vulnerable) : ""});
		addLine({label: "Immunities", html: Renderer.monster.getImmunitiesCombinedPart(mon)});
		addLine({label: "Senses", html: Renderer.monster.getSensesPart(mon)});
		addLine({label: "Languages", html: Renderer.monster.getRenderedLanguages(mon.languages)});

		wrpSection.querySelectorAll("[data-roll-bonus]").forEach(btn => btn.addEventListener("click", () => this._roll({
			rollType: "save",
			key: btn.dataset.rollKey,
			label: btn.dataset.rollLabel,
			bonus: btn.dataset.rollBonus,
		})));
	}

	_renderSkills ({npc, wrp}) {
		const wrpSkills = ee`<div class="dm-npc__skills"></div>`;
		getNpcTrackerAllSkillsModel(npc.monster, {skillCatalog: this._fnGetReferenceData().skills}).forEach(skillMeta => {
			const {skill, ability, bonus, isProficient, label} = skillMeta;
			const button = ee`<button class="dm-npc__skill ${isProficient ? "dm-npc__skill--proficient" : ""}" type="button"></button>`;
			const name = ee`<span class="dm-npc__skill-name"></span>`;
			name.textContent = label;
			const meta = ee`<span class="dm-npc__skill-meta"></span>`;
			meta.textContent = `${ability ? ability.toUpperCase() : "Flat"} ${getNpcTrackerSignedNumber(bonus)}`;
			button.append(name, meta);
			button.attr("title", isProficient
				? `Roll ${label} with the listed bonus`
				: ability
					? `Roll ${label} using ${Parser.attAbvToFull(ability)}`
					: `Roll ${label} with its flat bonus`);
			button.onn("click", () => this._roll({
				rollType: "skill",
				key: skillMeta.id,
				label: `${label} check`,
				bonus,
			}));
			button.appendTo(wrpSkills);
		});

		ee`<section class="dm-npc__section dm-npc__section--skills">
			<div class="dm-npc__section-heading">
				<h3>Skills</h3>
				<span>Listed proficiencies are emphasized; every other skill uses its governing ability.</span>
			</div>
			${wrpSkills}
		</section>`.appendTo(wrp);
	}

	_getRollButtonHtml ({name, bonus, label}) {
		const ability = Parser.ABIL_ABVS.find(abv => label === `${Parser.attAbvToFull(abv)} save`) || "";
		return `<button class="dm-npc__inline-roll roller" type="button" data-roll-key="${ability}" data-roll-bonus="${bonus}" data-roll-label="${label}">${name} ${getNpcTrackerSignedNumber(bonus)}</button>`;
	}

	_renderEntriesSection ({npc = null, wrp, title, entries, isAttackSection = false}) {
		if (!entries?.length) return;
		const renderer = Renderer.get();
		const wrpEntries = ee`<div class="dm-npc__entries"></div>`;
		entries.forEach(entry => {
			const entryRenderable = entry?.name && entry?.entries
				? {type: "entries", name: entry.name, entries: entry.entries}
				: entry;
			const wrpEntry = ee`<div class="dm-npc__entry">${renderer.render(entryRenderable, 2)}</div>`;
			if (isAttackSection) {
				const bonus = getNpcTrackerAttackBonus(entry);
				if (bonus != null) {
					const button = ee`<button class="ve-btn ve-btn-default ve-btn-xxs dm-npc__attack-roll" type="button"></button>`;
					button.textContent = `Roll attack ${getNpcTrackerSignedNumber(bonus)}`;
					button.onn("click", () => this._roll({
						rollType: "attack",
						key: entry.name || "Attack",
						label: `${entry.name || "Attack"} attack`,
						bonus,
					}));
					button.appendTo(wrpEntry);
				}
			}
			wrpEntry.appendTo(wrpEntries);
		});
		ee`<section class="dm-npc__section"><h3>${title}</h3>${wrpEntries}</section>`.appendTo(wrp);
	}

	_renderSpellSlots ({npc, wrp}) {
		const levels = Object.keys(npc.spellSlots || {}).sort((a, b) => Number(a) - Number(b));
		if (!levels.length) return;
		const rows = ee`<div class="dm-npc__resources"></div>`;
		levels.forEach(level => {
			const slots = npc.spellSlots[level];
			const current = ee`<strong class="dm-npc__resource-value"></strong>`;
			current.textContent = `${slots.current}/${slots.max}`;
			const btnCast = ee`<button class="ve-btn ve-btn-primary ve-btn-xxs" type="button">Cast</button>`
				.onn("click", () => this._fnUpdateSpellSlot({npc, level, mode: "spend"}));
			btnCast.disabled = slots.current < 1;
			const btnRestore = ee`<button class="ve-btn ve-btn-default ve-btn-xxs" type="button" title="Restore one spell slot">+1</button>`
				.onn("click", () => this._fnUpdateSpellSlot({npc, level, mode: "restore"}));
			btnRestore.disabled = slots.current >= slots.max;
			const btnReset = ee`<button class="ve-btn ve-btn-default ve-btn-xxs" type="button">Reset</button>`
				.onn("click", () => this._fnUpdateSpellSlot({npc, level, mode: "reset"}));
			ee`<div class="dm-npc__resource-row">
				<span class="dm-npc__resource-name">Level ${level}</span>
				${current}
				<div class="dm-npc__resource-actions">${btnCast}${btnRestore}${btnReset}</div>
			</div>`.appendTo(rows);
		});
		ee`<section class="dm-npc__section dm-npc__section--resources">
			<div class="dm-npc__section-heading"><h3>Spell Slots</h3><span>Track slots as spells are cast.</span></div>
			${rows}
		</section>`.appendTo(wrp);
	}

	_renderCharges ({npc, wrp}) {
		const rows = ee`<div class="dm-npc__resources"></div>`;
		(npc.charges || []).forEach(charge => {
			const current = ee`<strong class="dm-npc__resource-value"></strong>`;
			current.textContent = `${charge.current}/${charge.max}`;
			const btnSpend = ee`<button class="ve-btn ve-btn-primary ve-btn-xxs" type="button">Use</button>`
				.onn("click", () => this._fnUpdateCharge({npc, chargeId: charge.id, mode: "spend"}));
			btnSpend.disabled = charge.current < 1;
			const btnRestore = ee`<button class="ve-btn ve-btn-default ve-btn-xxs" type="button" title="Restore one charge">+1</button>`
				.onn("click", () => this._fnUpdateCharge({npc, chargeId: charge.id, mode: "restore"}));
			btnRestore.disabled = charge.current >= charge.max;
			const btnReset = ee`<button class="ve-btn ve-btn-default ve-btn-xxs" type="button">Reset</button>`
				.onn("click", () => this._fnUpdateCharge({npc, chargeId: charge.id, mode: "reset"}));
			const btnEdit = ee`<button class="ve-btn ve-btn-default ve-btn-xxs" type="button" title="Edit charge tracker">
				<span class="glyphicon glyphicon-pencil" aria-hidden="true"></span>
			</button>`.onn("click", () => this._fnEditCharge({npc, chargeId: charge.id}));
			const btnRemove = ee`<button class="ve-btn ve-btn-danger ve-btn-xxs" type="button" title="Remove charge tracker">
				<span class="glyphicon glyphicon-trash" aria-hidden="true"></span>
			</button>`.onn("click", () => this._fnRemoveCharge({npc, chargeId: charge.id}));
			ee`<div class="dm-npc__resource-row">
				<span class="dm-npc__resource-name">${charge.name}</span>
				${current}
				<div class="dm-npc__resource-actions">${btnSpend}${btnRestore}${btnReset}${btnEdit}${btnRemove}</div>
			</div>`.appendTo(rows);
		});
		const btnAdd = ee`<button class="ve-btn ve-btn-default ve-btn-xs dm-npc__resource-add" type="button">
			<span class="glyphicon glyphicon-plus" aria-hidden="true"></span> Add charge tracker
		</button>`.onn("click", () => this._fnAddCharge({npc}));
		ee`<section class="dm-npc__section dm-npc__section--resources">
			<div class="dm-npc__section-heading"><h3>Item Charges</h3><span>Charged Special Equipment and custom items.</span></div>
			${npc.charges?.length ? rows : ee`<div class="dm-npc__resource-empty">No charged equipment detected.</div>`}
			${btnAdd}
		</section>`.appendTo(wrp);
	}

	_renderFullStatblock ({npc, wrp}) {
		const table = ee`<table class="ve-w-100 ve-stats"><tbody>${Renderer.monster.getCompactRenderedString(npc.monster, {isShowScalers: false})}</tbody></table>`;
		Renderer.statblockCollapse.apply(table);
		ee`<div class="dm-npc__statblock">${table}</div>`.appendTo(wrp);
	}

	async _roll ({rollType, key, label, bonus}) {
		const result = await pRollNpcTrackerD20({
			npc: this._fnGetNpc(),
			rollType,
			key,
			label,
			bonus: Number(bonus),
		});
		if (result?.mode === "unavailable" || result?.mode === "autoFail") {
			JqueryUtil.doToast({
				type: result.mode === "unavailable" ? "warning" : "info",
				content: `${label}: ${result.statusText}.`,
			});
		}
		return result;
	}
}
