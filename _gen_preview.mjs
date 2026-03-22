import "./test/jest/charactersheet/setup.js";
import fs from "fs";

const {CharacterSheetState} = await import("./js/charactersheet/charactersheet-state.js");
const {CharacterSheetPdf} = await import("./js/charactersheet/charactersheet-pdf.js");

const state = new CharacterSheetState();
state._data.name = "Thandril Ironforge";
state._data.classes = [{name: "Fighter", source: "PHB", level: 5, subclass: "Champion"}];
state._data.abilities = {str: 18, dex: 14, con: 16, int: 10, wis: 12, cha: 8};
state._data.abilityBonuses = {str: 2, dex: 0, con: 0, int: 0, wis: 0, cha: 0};
state._data.hp = {current: 44, max: 44, temp: 0};
state._data.saveProficiencies = ["str", "con"];
state._data.skillProficiencies = {athletics: 1, perception: 1, intimidation: 1};
state._data.attacks = [
	{id: "a1", name: "Greatsword", bonus: 7, damage: "2d6+4", damageType: "slashing", range: "5 ft."},
	{id: "a2", name: "Javelin", bonus: 7, damage: "1d6+4", damageType: "piercing", range: "30/120 ft."},
];
state._data.features = [
	{name: "Second Wind", featureType: "Class", className: "Fighter", level: 1, description: "Regain 1d10+5 hit points as a bonus action.", uses: {current: 1, max: 1, recharge: "short rest"}},
	{name: "Action Surge", featureType: "Class", className: "Fighter", level: 2, description: "Take an additional action on your turn.", uses: {current: 1, max: 1, recharge: "short rest"}},
	{name: "Extra Attack", featureType: "Class", className: "Fighter", level: 5, description: "You can attack twice when you take the Attack action."},
	{name: "Improved Critical", featureType: "Subclass", className: "Fighter", subclassName: "Champion", level: 3, description: "Your weapon attacks score a critical hit on a roll of 19 or 20."},
];
state._data.inventory = [
	{id: "i1", item: {name: "Greatsword"}, quantity: 1, equipped: true, attuned: false},
	{id: "i2", item: {name: "Chain Mail"}, quantity: 1, equipped: true, attuned: false},
	{id: "i3", item: {name: "Javelin"}, quantity: 3, equipped: false, attuned: false},
	{id: "i4", item: {name: "Explorer's Pack"}, quantity: 1, equipped: false, attuned: false},
];
state._data.currency = {gp: 25, sp: 10, cp: 0, ep: 0, pp: 0};
state._data.armorProficiencies = ["Light", "Medium", "Heavy", "Shields"];
state._data.weaponProficiencies = ["Simple", "Martial"];
state._data.languages = ["Common", "Dwarvish"];
state._data.senses = {darkvision: 60};
state._data.combatTraditions = [
	{code: "TI", name: "Tempered Iron"},
	{code: "GH", name: "Gallant Heart"},
];
state._data.exertionMax = 6;
state._data.exertionCurrent = 4;

const pdf = new CharacterSheetPdf(state);
const html = pdf.generate();
fs.writeFileSync("/tmp/charsheet-preview.html", html);
console.log("Done: " + html.length + " bytes");
