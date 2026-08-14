export const GEMSTONE_EFFECT_REGISTRY = Object.freeze({
	alchemist: {summary: "+2 HP when drinking a potion of healing", effects: [{type: "healingPotionBonus", value: 2}]},
	mariner: {summary: "Host weapon ignores underwater attack disadvantage", effects: [{type: "removeDisadvantage", target: "attack", conditional: "underwater"}]},
	thief: {summary: "1/day: Reroll a failed Dexterity check", resource: {key: "uses", name: "Thief Gemstone", max: 1, recharge: "dawn"}},
	warrior: {summary: "Host weapon can't be disarmed while conscious", notes: ["Can't be disarmed of the host weapon while conscious."]},
	"arrow-catcher": {summary: "Reaction: Impose disadvantage on a ranged attack (3 charges; regain 1d3 at dawn)", resource: {key: "charges", name: "Arrow-Catcher Charges", max: 3, recharge: "dawn", recovery: "1d3"}},
	"bound armor": {summary: "Bonus action: Instantly don/doff or dismiss the host armor", powers: [{id: "bound-armor", name: "Bound Armor", actionType: "bonus", kind: "toggle"}]},
	"bound weapon": {summary: "Bonus action: Make the host weapon disappear or appear", powers: [{id: "bound-weapon", name: "Bound Weapon", actionType: "bonus", kind: "toggle"}]},
	cat: {summary: "1/dawn: Gain darkvision 120 ft. for 1 hour", resource: {key: "uses", name: "Cat Gemstone", max: 1, recharge: "dawn"}, effects: [{type: "sense", sense: "darkvision", value: 120, requiresRuntimeActive: true}]},
	chaos: {summary: "Critical hits with the host weapon trigger Wild Magic", trigger: {type: "criticalHit", outcome: "wildMagicSurge"}},
	daywalker: {summary: "Unaffected by sunlight while the hood is drawn", notes: ["Unaffected by sunlight while the host armor's hood is drawn."]},
	"elemental shield": {summary: "Reaction: Reduce chosen elemental damage by 2x level + CON; gain 1 exhaustion", choices: {damageType: ["acid", "cold", "fire", "lightning", "thunder"]}},
	featherfoot: {summary: "Standing jump distance equals walking speed", effects: [{type: "standingJumpEqualsWalk"}]},
	knock: {summary: "1/dawn: Cast Knock from the host armor", resource: {key: "uses", name: "Knock Gemstone", max: 1, recharge: "dawn"}, powers: [{id: "knock", name: "Knock", actionType: "action", kind: "spell", spellName: "Knock", spellSource: "PHB"}]},
	nondetection: {summary: "Hidden from divination magic and magical scrying", effects: [{type: "protection", protection: "divination"}]},
	serpent: {summary: "1/dawn on hit: CON save or poisoned for 1 minute", resource: {key: "uses", name: "Serpent Gemstone", max: 1, recharge: "dawn"}, trigger: {type: "onHit", outcome: "poisoned"}},
	bastion: {summary: "1/dawn: Bonus action creates a 10-ft force dome for 1 minute", resource: {key: "uses", name: "Bastion Charges", max: 1, recharge: "dawn"}, powers: [{id: "bastion", name: "Bastion Dome", actionType: "bonus", kind: "ability"}]},
	berserker: {summary: "1/dawn on hit: Spend Hit Dice for damage and equal self-damage", resource: {key: "uses", name: "Berserker Gemstone", max: 1, recharge: "dawn"}, trigger: {type: "onHit", outcome: "berserker"}},
	chalice: {summary: "Store and cast up to 2 spell levels", requiresAttunement: true, spellStorage: {capacity: 2}},
	death: {summary: "Humanoids killed by the host weapon rise as 1-HP zombies for 1 minute", trigger: {type: "kill", outcome: "zombie"}},
	hunt: {summary: "1/dawn: Mark a target, then teleport after a ranged host hit", resource: {key: "uses", name: "Hunt Gemstone", max: 1, recharge: "dawn"}},
	journey: {summary: "+10 speed; improved travel pace and halved food/water", effects: [{type: "speedBonus", speed: "walk", value: 10}]},
	magebane: {summary: "On hit: End spells using one of 3 charges", resource: {key: "charges", name: "Magebane Charges", max: 3, recharge: "dawn", recovery: "1d3"}, trigger: {type: "onHit", outcome: "dispel"}},
	phoenix: {summary: "1/dawn at 0 HP: Fireball, then regain 1d6 HP next turn", resource: {key: "uses", name: "Phoenix Gemstone", max: 1, recharge: "dawn"}, trigger: {type: "zeroHp", outcome: "phoenix"}},
	soultrap: {summary: "1/dawn after a qualifying kill: Regain a spell slot up to PB", resource: {key: "uses", name: "Soultrap Gemstone", max: 1, recharge: "dawn"}},
	superconductor: {summary: "Store charges up to PB spell levels; spend for +1d6 force each", resource: {key: "charges", name: "Superconductor Charges", max: "proficiency", recharge: "none", resetOnRest: true}, rider: {dicePerCharge: "1d6", damageType: "force"}},
	warmage: {summary: "Reroll failed concentration saves using one of 3 charges", resource: {key: "charges", name: "Warmage Charges", max: 3, recharge: "special"}},
	"blood weapon": {summary: "Critical hit: Regain HP equal to damage dealt (not constructs/undead)", trigger: {type: "criticalHit", outcome: "heal"}},
	displacement: {summary: "After weapon damage: Teleport 30 ft. once per turn", trigger: {type: "damaged", outcome: "teleport"}},
	dragonbane: {summary: "+2d6 host-weapon damage against dragons; STR save or flight 0", rider: {dice: "2d6", targetTypes: ["dragon"], damageType: "weapon"}},
	earthshaker: {summary: "1/dawn: Create a 1-round Earthquake effect", resource: {key: "uses", name: "Earthshaker Gemstone", max: 1, recharge: "dawn"}, powers: [{id: "earthshaker", name: "Earthshaker", actionType: "action", kind: "spell", spellName: "Earthquake", spellSource: "PHB"}]},
	"giant slayer": {summary: "+2d6 host-weapon damage against giants (Large or larger); STR save or prone", rider: {dice: "2d6", targetTypes: ["giant"], damageType: "weapon"}},
	"mark/recall": {summary: "1/dawn: Mark a location, then teleport there with up to five creatures", resource: {key: "uses", name: "Mark/Recall Gemstone", max: 1, recharge: "dawn"}},
	overshield: {summary: "Gain 8 temp HP at the start of each turn", effects: [{type: "turnStartTempHp", value: 8}]},
	retribution: {summary: "After taking damage, gain advantage on the next attack against that creature type", trigger: {type: "damaged", outcome: "retribution"}},
	wolfsbane: {summary: "Moonlight; +2d6 radiant against shapechangers and force true form", effects: [{type: "light", bright: 15, dim: 15}], rider: {dice: "2d6", targetTypes: ["shapechanger"], damageType: "radiant"}},
	"force of will": {summary: "Immune to enchantment magic unless you choose otherwise", effects: [{type: "protection", protection: "enchantment"}]},
	mime: {summary: "Copy a same-type magic item's non-fixed properties during a short rest", notes: ["Copied magic item properties require DM adjudication; artifacts and fixed bonuses can't be copied."]},
	tempest: {summary: "1/turn on hit: +1d10 lightning and arcs to up to 3 creatures", rider: {dice: "1d10", damageType: "lightning", perTurn: true, chainedTargetsMax: 3}},
	volant: {summary: "Hover flight speed equals twice walking speed", effects: [{type: "flightSpeedMultiplier", speed: "walk", value: 2, hover: true}]},
});

const _copy = value => value == null ? value : JSON.parse(JSON.stringify(value));

export function isWeapon (item) {
	return !!(item?.weapon || ["M", "R"].includes(String(item?.type || "").split("|")[0]));
}

export function isArmor (item) {
	return !!(item?.armor || ["LA", "MA", "HA"].includes(String(item?.type || "").split("|")[0]));
}

export function isShield (item) {
	return !!(item?.shield || String(item?.type || "").split("|")[0] === "S");
}

export function isSocketable (item) {
	return isWeapon(item) || isArmor(item) || isShield(item);
}

export function getEligibleUpgrades ({item, upgrades = []}) {
	const appliedNames = new Set((item?.appliedUpgrades || []).map(it => String(it?.name || "").toLowerCase()));
	return upgrades.filter(upgrade => {
		const upgradeType = upgrade?.upgradeType?.[0] || "";
		if (upgradeType.startsWith("GS:")) return false;
		if (appliedNames.has(String(upgrade?.name || "").toLowerCase())) return false;
		if (upgradeType.startsWith("WU") && !isWeapon(item)) return false;
		if (upgradeType === "AU" && !isArmor(item) && !isShield(item)) return false;
		return true;
	});
}

export function getGemstoneDescriptor (gem) {
	return _copy(GEMSTONE_EFFECT_REGISTRY[String(gem?.name || gem || "").trim().toLowerCase()] || null);
}

export function getGemstoneRegistryNames () {
	return Object.keys(GEMSTONE_EFFECT_REGISTRY);
}
