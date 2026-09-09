export const tinyd6 = {};

tinyd6.systemLogo = "systems/tinyd6v14/assets/images/tiny-d6-logo.webp";
tinyd6.theme = "tiny-cthulhu";
tinyd6.defaultItemImage = "icons/svg/mystery-man.svg";
tinyd6.threshold = {};

tinyd6.weaponTypes = {
    none: "",
    light: "tinyd6.weaponTypes.light",
    heavy: "tinyd6.weaponTypes.heavy"
}

/* Комбинированные типы оружия (Homerule: TinyD6+): один селект вместо
 * двух (light/heavy + melee/ranged). */
tinyd6.weaponCombos = {
    none: "tinyd6.weaponTypes.none",
    lightMelee: "tinyd6.weapon.lightMelee",
    heavyMelee: "tinyd6.weapon.heavyMelee",
    lightRanged: "tinyd6.weapon.lightRanged",
    heavyRanged: "tinyd6.weapon.heavyRanged"
}

tinyd6.themes = {
    "tiny-cthulhu": "tinyd6.settings.theme.choices.cthulhu",
    "tiny-dungeon": "tinyd6.settings.theme.choices.dungeon"
}

tinyd6.sheetStyles = {
    "td-sheet-default": "tinyd6.settings.sheetStyle.choices.default",
    "td-sheet-minimal": "tinyd6.settings.sheetStyle.choices.minimal",
    "td-sheet-perkament": "tinyd6.settings.sheetStyle.choices.perkament",
    "td-sheet-noir": "tinyd6.settings.sheetStyle.choices.noir",
    "td-sheet-cyberpunk": "tinyd6.settings.sheetStyle.choices.cyberpunk"
}

tinyd6.advancementMethods = {
    "none": "tinyd6.settings.enableAdvancement.choices.none",
    "minimalist": "tinyd6.settings.enableAdvancement.choices.minimalist",
    "xp": "tinyd6.settings.enableAdvancement.choices.xp"
}

/* Homerule: Crit Advantage-Normal — на каких бросках действует крит
 * (удвоение урона при выпадении одинаковых 6-ок на всех кубах). */
tinyd6.critAdvantageModes = {
    off: "tinyd6.settings.critAdvantage.choices.off",
    two: "tinyd6.settings.critAdvantage.choices.two",
    three: "tinyd6.settings.critAdvantage.choices.three",
    both: "tinyd6.settings.critAdvantage.choices.both"
}

tinyd6.weaponCategories = {
    none: "",
    melee: "tinyd6.weaponCategories.melee",
    ranged: "tinyd6.weaponCategories.ranged"
}

tinyd6.armorTypes = {
    none: "",
    light: "tinyd6.armorTypes.light",
    medium: "tinyd6.armorTypes.medium",
    heavy: "tinyd6.armorTypes.heavy",
    shield: "tinyd6.armorTypes.shield"
}

tinyd6.corruptionTests = {
    none: "tinyd6.corruptionTests.none",
    disadvantage: "tinyd6.corruptionTests.disadvantage",
    standard: "tinyd6.corruptionTests.standard"
}

/* Homerule: TinyD6+ — категории снаряжения (gear). ammo = патроны/рожки,
 * которые перезарядка оружия списывает по одному за клик. */
tinyd6.gearCategories = {
    item: "tinyd6.gear.categories.item",
    ammo: "tinyd6.gear.categories.ammo",
    heal: "tinyd6.gear.categories.heal",
    money: "tinyd6.gear.categories.money"
}
