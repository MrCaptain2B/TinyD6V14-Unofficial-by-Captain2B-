import { isDowned } from "./death.js";
import { gmProxy, broadcastFx } from "./socket.js";
import { iconSvg } from "./icons.js";

/* Р’РєР»СЋС‡РµРЅС‹ Р»Рё Р°РЅРёРјР°С†РёРё Р±РѕСЏ (РЅР°СЃС‚СЂРѕР№РєР° РјРёСЂР° animFx). */
export function isAnimFxEnabled() {
    try { return game.settings.get("tinyd6v14", "animFx") !== false; }
    catch (err) { return true; }
}

/* Р РµРµСЃС‚СЂ РІСЃРїР»С‹РІР°СЋС‰РёС… С‡РёСЃРµР», РїСЂРёРІСЏР·Р°РЅРЅС‹С… Рє РєРѕРЅРєСЂРµС‚РЅРѕРјСѓ С‚РѕРєРµРЅСѓ-С†РµР»Рё.
 * РљР»СЋС‡ - id Р°РєС‚С‘СЂР°, Р·РЅР°С‡РµРЅРёРµ - id С‚РѕРєРµРЅР°, РЅР°Рґ РєРѕС‚РѕСЂС‹Рј РЅР°РґРѕ РїРѕРєР°Р·Р°С‚СЊ С‡РёСЃР»Рѕ.
 * РќСѓР¶РµРЅ РїРѕС‚РѕРјСѓ, С‡С‚Рѕ РґР»СЏ unlinked NPC Сѓ РІСЃРµС… РєРѕРїРёР№ РѕРґРЅРѕРіРѕ Р°РєС‚С‘СЂР° РѕРґРёРЅР°РєРѕРІС‹Р№
 * actor.id, РїРѕСЌС‚РѕРјСѓ С…СѓРє updateActor СЃР°Рј РЅРµ РјРѕР¶РµС‚ СЂР°Р·Р»РёС‡РёС‚СЊ, РєР°РєРѕР№ РёР· РЅРёС… СЂР°РЅРµРЅ. */
const PENDING_FLOAT = new Map();

export function _setPendingFloat(actorId, tokenId) {
    PENDING_FLOAT.set(actorId, tokenId);
}

export function _takePendingFloat(actorId) {
    const tokenId = PENDING_FLOAT.get(actorId);
    if (!tokenId) return null;
    PENDING_FLOAT.delete(actorId);
    return { tokenId };
}

export async function RollTest({
    numberOfDice = 2,
    numberOfSides = 6,
    defaultThreshold = 5,
    focusAction = false,
    marksmanTrait = false } = {}) {

    let threshold = defaultThreshold;
    if (focusAction && (focusAction === 'true'))
    {
        threshold = threshold - 1;
    }

    if (marksmanTrait && (marksmanTrait === 'true'))
    {
        threshold = threshold - 1;
    }
    
    const rollForumla = `${numberOfDice}d${numberOfSides}cs>=${threshold}`;

    // Execute the roll
    let result = await new Roll(rollForumla, {}).evaluate();
    let renderedRoll = await renderTemplate("systems/tinyd6v14/templates/partials/test-result.hbs", { rollResult: result });
    // let renderedRoll = await result.render({ result: result, template: "systems/tinyd6v14/templates/partials/test-result.hbs" });

    const chatData = {
        speaker: ChatMessage.getSpeaker(),
        content: renderedRoll
    };

    result.toMessage(chatData);
}

export function setFocusOption(form, element) {
    form.find(".die-roller > .roll-dice").each((n, tag) => {
        tag.dataset.enableFocus = element.checked
    });

    if (element.checked)
    {
        form.find(".action-modifiers .toggle-marksman").prop("disabled", false);
    }
    else
    {
        const marksmanElement = form.find(".action-modifiers .toggle-marksman");
        marksmanElement.prop("checked", false);
        marksmanElement.prop("disabled", true);
    }
}

export function setMarksmanOption(form, element)
{
    form.find(".die-roller > .roll-dice").each((n, tag) => {
        tag.dataset.enableMarksman = element.checked;
    });
}

export function diceToFaces(value, content)
{
    switch (value)
    {
        case 1:
            return "fa-dice-one";
        case 2:
            return "fa-dice-two";
        case 3:
            return "fa-dice-three";
        case 4:
            return "fa-dice-four";
        case 5:
            return "fa-dice-five";
        case 6:
            return "fa-dice-six";
    }

    return "fa-dice-d6";
}

/* ============================================================
   РђРІС‚РѕРјР°С‚РёР·РёСЂРѕРІР°РЅРЅС‹Рµ Р°С‚Р°РєРё (РѕСЂСѓР¶РёРµ РїРѕ С‚Р°СЂРіРµС‚Р°Рј)
   ============================================================ */

function _attackTargets(attacker) {
    const targets = [];
    if (game.user.targets?.size)
    {
        game.user.targets.forEach(t => {
            if (!t.actor) return;
            // Р¦РµР»СЊСЋ РјРѕР¶РµС‚ Р±С‹С‚СЊ NPC РёР»Рё РґСЂСѓРіРѕР№ РіРµСЂРѕР№, РЅРѕ РЅРµ СЃР°Рј СЃС‚СЂРµР»СЏСЋС‰РёР№.
            if (attacker && t.actor.id === attacker.id) return;
            if (t.actor.type === "npc" || t.actor.type === "hero") targets.push({ actor: t.actor, token: t.document });
        });
    }
    return targets;
}

/* РџСЂРѕРІРµСЂРєР°, СЏРІР»СЏРµС‚СЃСЏ Р»Рё РїСЂРµРґРјРµС‚ С‰РёС‚РѕРј (armor СЃ group === "shield"). */
function _isShield(item) {
    return item?.type === "armor" && item?.system?.group === "shield";
}

/* Р­РєРёРїРёСЂРѕРІР°РЅРЅР°СЏ Р±СЂРѕРЅСЏ. РЈ NPC РІСЃСЏ Р±СЂРѕРЅСЏ РІСЃРµРіРґР° СЃС‡РёС‚Р°РµС‚СЃСЏ СЌРєРёРїРёСЂРѕРІР°РЅРЅРѕР№:
 * NPC РЅРµ В«РїРµСЂРµРѕРґРµРІР°РµС‚СЃСЏВ», Рё Р±РµР· СЌС‚РѕРіРѕ Р±СЂРѕРЅСЏ, РґРѕР±Р°РІР»РµРЅРЅР°СЏ РІ Р»РёСЃС‚ NPC, РЅРµ РґР°РІР°Р»Р°
 * Р±С‹ DR Рё РЅРµ РїРѕРєР°Р·С‹РІР°Р»Р°СЃСЊ РІ HUD. Р”Р»СЏ РіРµСЂРѕРµРІ РїРѕ-РїСЂРµР¶РЅРµРјСѓ РІР°Р¶РµРЅ С„Р»Р°Рі equipped. */
function _equippedArmor(actor) {
    const npcAll = actor?.type === "npc";
    return (actor?.items ?? []).filter(i => i.type === "armor" && (npcAll || i.system?.equipped));
}

/* РўРѕР»СЊРєРѕ В«Р¶РёРІР°СЏВ» Р±СЂРѕРЅСЏ: СЌРєРёРїРёСЂРѕРІР°РЅРЅР°СЏ Рё СЃ РЅРµРЅСѓР»РµРІС‹Рј Р·Р°РїР°СЃРѕРј РїСЂРѕС‡РЅРѕСЃС‚Рё. */
function _activeArmor(actor) {
    return _equippedArmor(actor).filter(i => (Number(i.system?.armorHp?.value) || 0) > 0);
}

/* Требуется ли NPC «надеть» оружие перед использованием.
 * По умолчанию NPC использует всё оружие без экипировки; правило включается
 * мировой настройкой npcRequireEquipped или персональным полем NPC
 * (homebrew.requireEquipped: "" - по миру, "on"/"off" - переопределение). */
export function npcRequiresEquip(actor) {
    if (actor?.type !== "npc") return false;
    const override = actor.system?.homebrew?.requireEquipped;
    if (override === "on") return true;
    if (override === "off") return false;
    try { return game.settings.get('tinyd6v14', 'npcRequireEquipped') === true; }
    catch (err) { return false; }
}

/* Р­РєРёРїРёСЂРѕРІР°РЅРЅС‹Рµ С‰РёС‚С‹ СЃ РЅРµРЅСѓР»РµРІС‹Рј HP. */
function _activeShields(actor) {
    const npcAll = actor?.type === "npc";
    return (actor?.items ?? []).filter(i => _isShield(i) && (npcAll || i.system?.equipped) && (Number(i.system?.armorHp?.value) || 0) > 0);
}

/* РЎСѓРјРјР°СЂРЅС‹Р№ DR Р°РєС‚РёРІРЅРѕР№ (РЅРµ РёСЃС‚СЂР°С‡РµРЅРЅРѕР№) Р±СЂРѕРЅРё СЃ СѓС‡С‘С‚РѕРј stacking. */
function _actorArmorTotal(actor) {
    const armorStacking = game.settings.get('tinyd6v14', 'enableArmorStacking');
    const active = _activeArmor(actor);

    if (armorStacking) {
        // РЎС‚Р°РєРёРЅРі: СЃСѓРјРјРёСЂСѓРµРј DR РІСЃРµР№ Р±СЂРѕРЅРё.
        return active.reduce((sum, i) => sum + (Number(i.system?.damageReduction) || 0), 0);
    } else {
        // Р‘РµР· СЃС‚Р°РєРёРЅРіР°: С‚РѕР»СЊРєРѕ РјР°РєСЃРёРјР°Р»СЊРЅС‹Р№ DR РѕРґРЅРѕР№ Р±СЂРѕРЅРё.
        let maxDr = 0;
        for (const i of active) {
            const dr = Number(i.system?.damageReduction) || 0;
            if (dr > maxDr) maxDr = dr;
        }
        return maxDr;
    }
}

/* РЎРЅРёРјР°РµС‚ 1 Р·Р°РїР°СЃ РїСЂРѕС‡РЅРѕСЃС‚Рё: СЃРЅР°С‡Р°Р»Р° СЃ С‰РёС‚Р°, РїРѕС‚РѕРј СЃ Р±СЂРѕРЅРё.
 * Р’РѕР·РІСЂР°С‰Р°РµС‚ true, РµСЃР»Рё Р·Р°РїР°СЃ Р±С‹Р» СЃРЅСЏС‚. */
async function _reduceArmorHp(actor) {
    const breakMsg = game.settings.get('tinyd6v14', 'enableArmorBreakMessages');

    // РЎРЅР°С‡Р°Р»Р° С‰РёС‚С‹
    const shields = _activeShields(actor);
    if (shields.length) {
        const item = shields[0];
        const current = Number(item.system?.armorHp?.value) || 0;
        const newVal = Math.max(0, current - 1);
        await item.update({ "system.armorHp.value": newVal });
        if (breakMsg && newVal <= 0) {
            await ChatMessage.create({
speaker: ChatMessage.getSpeaker({ actor }),
                content: `<div class="tinyd6">${iconSvg("shield-halved")} ${game.i18n.format("tinyd6.armor.shieldBreak", { name: item.name, actor: actor.name })}</div>`
            });
        }
        return item;
    }
    // РџРѕС‚РѕРј Р±СЂРѕРЅСЏ
    const active = _activeArmor(actor).filter(i => i.type === "armor");
    if (!active.length) return null;
    const item = active[0];
    const current = Number(item.system?.armorHp?.value) || 0;
    const newVal = Math.max(0, current - 1);
    await item.update({ "system.armorHp.value": newVal });
    if (breakMsg && newVal <= 0) {
        await ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
content: `<div class="tinyd6">${iconSvg("shield-halved")} ${game.i18n.format("tinyd6.armor.armorBreak", { name: item.name, actor: actor.name })}</div>`
        });
    }
    return item;
}

/* РЈСЂРѕРЅ Р°С‚Р°РєРё РїРѕ РєРѕРЅРєСЂРµС‚РЅРѕР№ С†РµР»Рё СЃ СѓС‡С‘С‚РѕРј РµС‘ Р±СЂРѕРЅРё.
 * Р‘СЂРѕРЅСЏ РІ Tiny D6 РІСЃРµРіРґР° Р°РєС‚РёРІРЅР°:
 *  - РµСЃР»Рё СѓСЂРѕРЅ <= DR Р°РєС‚РёРІРЅРѕР№ Р±СЂРѕРЅРё - СѓСЂРѕРЅ РїРѕР»РЅРѕСЃС‚СЊСЋ РїРѕРіР»РѕС‰С‘РЅ (0),
 *    РЅРѕ СЃ Р±СЂРѕРЅРё СЃРЅРёРјР°РµС‚СЃСЏ 1 Р·Р°РїР°СЃ РїСЂРѕС‡РЅРѕСЃС‚Рё;
 *  - РµСЃР»Рё СѓСЂРѕРЅ > DR - С†РµР»СЊ РїРѕР»СѓС‡Р°РµС‚ СѓСЂРѕРЅ - DR, Рё СЃ Р±СЂРѕРЅРё СЃРЅРёРјР°РµС‚СЃСЏ 1 Р·Р°РїР°СЃ;
 *  - РєРѕРіРґР° Р·Р°РїР°СЃ Р±СЂРѕРЅРё РЅР° РЅСѓР»Рµ, РѕРЅР° РїРµСЂРµСЃС‚Р°С‘С‚ Р·Р°С‰РёС‰Р°С‚СЊ. */
export function computeDamage(weaponDamage, targetActor) {
    let dmg = Number(weaponDamage) || 1;
    const armor = _actorArmorTotal(targetActor);
    if (armor > 0)
    {
        dmg = Math.max(0, dmg - armor);
    }
    return dmg;
}

function _diceFace(result) {
    switch (result) {
        case 1: return "fa-dice-one";
        case 2: return "fa-dice-two";
        case 3: return "fa-dice-three";
        case 4: return "fa-dice-four";
        case 5: return "fa-dice-five";
        case 6: return "fa-dice-six";
    }
    return "fa-dice-d6";
}

/* РћС‚РєСЂС‹РІР°РµС‚ РґРёР°Р»РѕРі Р°С‚Р°РєРё РѕСЂСѓР¶РёРµРј: РІС‹Р±РѕСЂ СЂРµР¶РёРјР° Р±СЂРѕСЃРєР° (РїРѕРјРµС…Р°/СЃС‚Р°РЅРґР°СЂС‚/
 * РїСЂРµРёРјСѓС‰РµСЃС‚РІРѕ) Рё РјРѕРґРёС„РёРєР°С‚РѕСЂРѕРІ Focus/Marksman. РћР±С‰РёР№ РґР»СЏ Р»РёСЃС‚Р° Р°РєС‚С‘СЂР° Рё HUD. */
/* РћРїСЂРµРґРµР»СЏРµС‚ СЂРµРєРѕРјРµРЅРґСѓРµРјС‹Р№ СѓСЂРѕРІРµРЅСЊ Р±СЂРѕСЃРєР° Р°С‚Р°РєРё РїРѕ РїСЂРѕС„РёС€РµРЅСЃРё Р°РєС‚С‘СЂР°
 * (Homerule: TinyD6+ + enableAttackProficiency):
 *  - РѕСЂСѓР¶РёРµ, РёРјСЏ РєРѕС‚РѕСЂРѕРіРѕ РµСЃС‚СЊ РІ masteredWeapons в†’ РїСЂРµРёРјСѓС‰РµСЃС‚РІРѕ (3d6);
 *  - РІР»Р°РґРµР»РµС† РѕР±СѓС‡РµРЅ С‚РёРїСѓ РѕСЂСѓР¶РёСЏ в†’ СЃС‚Р°РЅРґР°СЂС‚ (2d6);
 *  - РЅРµРѕР±СѓС‡РµРЅ в†’ РїРѕРјРµС…Р° (1d6);
 *  - NPC Р±РµР· Р·Р°РїРѕР»РЅРµРЅРЅС‹С… РїСЂРѕС„РёС€РµРЅСЃРё в†’ СЃС‚Р°РЅРґР°СЂС‚.
 * Р’РѕР·РІСЂР°С‰Р°РµС‚ 1 | 2 | 3. РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ С‚РѕР»СЊРєРѕ РєР°Рє В«РїРѕРґСЃРєР°Р·РєР°В» РІ РґРёР°Р»РѕРіРµ -
 * РёРіСЂРѕРє РјРѕР¶РµС‚ РІС‹Р±СЂР°С‚СЊ Р»СЋР±РѕР№ СѓСЂРѕРІРµРЅСЊ РІСЂСѓС‡РЅСѓСЋ. */
/* Мастерство оружия (новая механика слотов мастерства, homebrew.masteredCount):
 * system.proficiencies.masteredWeapons хранит запятая-разделённый список ID
 * оружия из директории мира (слоты). Поддерживаем все форматы:
 *  - новые слоты: "id1,id2,id3";
 *  - одиночный ID старой механики: "id";
 *  - legacy-имена через запятую ("Длинный меч,Топорик").
 * Инвентарная копия оружия у актёра имеет свой id, поэтому сравниваем и по имени
 * элемента директории (по id) - как это делала старая логика для одного оружия. */
export function isMasteredWeapon(actor, weapon) {
    if (!actor || !weapon) return false;
    const raw = ((actor.system?.proficiencies?.masteredWeapons) || "").trim();
    if (!raw) return false;
    const weaponId = (weapon.id || "").toLowerCase();
    const weaponName = (weapon.name || "").trim().toLowerCase();
    for (const chunk of raw.split(","))
    {
        const entry = chunk.trim();
        if (!entry) continue;
        if (entry.toLowerCase() === weaponId) return true;
        const dirItem = game.items.get(entry);
        if (dirItem)
        {
            if ((dirItem.name || "").trim().toLowerCase() === weaponName) return true;
            continue;
        }
        if (entry.toLowerCase() === weaponName) return true;
    }
    return false;
}

export function suggestAttackDice(actor, weapon) {
    if (!actor || !weapon) return 2;
    if (actor.type === "npc")
    {
        const prof = actor.system?.proficiencies ?? {};
        if (!prof.lightMelee && !prof.heavyMelee && !prof.lightRanged && !prof.heavyRanged && !(prof.masteredWeapons || "").trim())
            return 2;
}

    if (isMasteredWeapon(actor, weapon)) return 3;

    const prof = actor.system?.proficiencies ?? {};
    const type = _weaponProficiencyKey(weapon);
    if (type && prof[type]) return 2;
    return 1;
}

/* РљР»СЋС‡ РїСЂРѕС„РёС€РµРЅСЃРё РґР»СЏ РѕСЂСѓР¶РёСЏ: РїРѕ weaponType (TinyD6+) РёР»Рё РїРѕ
 * РіСЂСѓРїРїРµ/С‚РёРїСѓ СѓСЂРѕРЅР° (Р±Р°Р·РѕРІС‹Р№ СЂРµР¶РёРј). Р’РѕР·РІСЂР°С‰Р°РµС‚ РєР»СЋС‡ РёР»Рё null. */
function _weaponProficiencyKey(weapon) {
    const s = weapon.system ?? {};
    const wt = s.weaponType;
    if (wt === "lightMelee" || wt === "heavyMelee" || wt === "lightRanged" || wt === "heavyRanged") return wt;
    const group = s.group;
    const type = s.damageType;
    if (group === "melee") return type === "heavy" ? "heavyMelee" : "lightMelee";
    if (group === "ranged") return type === "heavy" ? "heavyRanged" : "lightRanged";
    return null;
}

export function openAttackDialog(actor, weapon) {
    if (!actor || !weapon) return;

    const focusLabel = game.i18n.localize("tinyd6.dice.modifier.focus");
    const marksmanLabel = game.i18n.localize("tinyd6.dice.modifier.marksman");

    // Homerule: TinyD6+ + Auto weapon proficiency - СЂРµРєРѕРјРµРЅРґСѓРµРјС‹Р№ СѓСЂРѕРІРµРЅСЊ
    // РїРѕРґСЃРІРµС‡РёРІР°РµС‚СЃСЏ РІ РґРёР°Р»РѕРіРµ, РЅРѕ РІСЃРµ РєРЅРѕРїРєРё РѕСЃС‚Р°СЋС‚СЃСЏ Р°РєС‚РёРІРЅС‹РјРё, С‡С‚РѕР±С‹
    // РёРіСЂРѕРє РјРѕРі РїРµСЂРµРѕРїСЂРµРґРµР»РёС‚СЊ РїРѕРґ СЃРёС‚СѓР°С†РёСЋ (РќР Р, Р° РЅРµ Р°РІС‚Рѕ-РёРіСЂР°).
    let suggested = 2;
    if (game.settings.get('tinyd6v14', 'enableTinyD6Plus')
        && game.settings.get('tinyd6v14', 'enableAttackProficiency'))
    {
        suggested = suggestAttackDice(actor, weapon);
    }

    // РљРЅРѕРїРєРё РґРёР°Р»РѕРіР° РІ Foundry v14 РїРѕР»СѓС‡Р°СЋС‚ cssClass РёР· key/default, Р° РЅРµ РёР·
    // РїРµСЂРµРґР°РЅРЅРѕРіРѕ className - РїРѕСЌС‚РѕРјСѓ СЂРµРєРѕРјРµРЅРґСѓРµРјСѓСЋ РєРЅРѕРїРєСѓ РїРѕРґСЃРІРµС‡РёРІР°РµРј
    // РІСЂСѓС‡РЅСѓСЋ С‡РµСЂРµР· render-РєРѕР»Р±СЌРє (РєР»Р°СЃСЃ attack-suggest).
    const suggestButtons = { 1: "disadvantage", 2: "standard", 3: "advantage" };
    const suggestKey = suggestButtons[suggested] ?? null;

    new Dialog({
        title: game.i18n.localize("tinyd6.attack.attack"),
        content: `
            <p><b>${weapon.name}</b></p>
            <div class="d-flex action-modifiers justify-content-center mt-2">
                <span class="mr-2">
                    <label>
                        <input type="checkbox" class="toggle-focus"/>
                        ${focusLabel}
                    </label>
                </span>
                <span>
                    <label>
                        <input type="checkbox" class="toggle-marksman" disabled/>
                        ${marksmanLabel}
                    </label>
                </span>
            </div>
        `,
        buttons: {
            disadvantage: {
                label: game.i18n.localize("tinyd6.dice.roll.disadvantage"),
                callback: (html) => {
                    const focusAction = html.find(".toggle-focus").prop("checked");
                    const marksmanTrait = html.find(".toggle-marksman").prop("checked");
                    performWeaponAttack(actor, weapon, 1, { focusAction, marksmanTrait });
                }
            },
            standard: {
                label: game.i18n.localize("tinyd6.dice.roll.standard"),
                callback: (html) => {
                    const focusAction = html.find(".toggle-focus").prop("checked");
                    const marksmanTrait = html.find(".toggle-marksman").prop("checked");
                    performWeaponAttack(actor, weapon, 2, { focusAction, marksmanTrait });
                }
            },
            advantage: {
                label: game.i18n.localize("tinyd6.dice.roll.advantage"),
                callback: (html) => {
                    const focusAction = html.find(".toggle-focus").prop("checked");
                    const marksmanTrait = html.find(".toggle-marksman").prop("checked");
                    performWeaponAttack(actor, weapon, 3, { focusAction, marksmanTrait });
                }
            }
        },
        default: suggestKey || "standard",
        close: () => {},
        render: (html) => {
            // РџРѕРґСЃРІРµС‚РєР° СЂРµРєРѕРјРµРЅРґСѓРµРјРѕРіРѕ СѓСЂРѕРІРЅСЏ Р±СЂРѕСЃРєР° (РµСЃР»Рё РІРєР»СЋС‡РµРЅРѕ).
            if (suggestKey && game.settings.get('tinyd6v14', 'enableTinyD6Plus')
                && game.settings.get('tinyd6v14', 'enableAttackProficiency')) {
                html.find(`.dialog-button[data-button="${suggestKey}"]`).addClass("attack-suggest");
            }
            html.find(".toggle-focus").on("change", (ev) => {
                const enabled = ev.currentTarget.checked;
                html.find(".toggle-marksman").prop("disabled", !enabled);
                if (!enabled) html.find(".toggle-marksman").prop("checked", false);
            });
        }
    }, {
        classes: ['tinyd6', 'attack-dialog']
    }).render(true);
}

/* РџРѕР»РЅС‹Р№ Р±СЂРѕСЃРѕРє Р°С‚Р°РєРё: РІР°Р»РёРґРёСЂСѓРµС‚ С‚Р°СЂРіРµС‚С‹, РєРёРґР°РµС‚ d6cs>=5,
 * СЂРµРЅРґРµСЂРёС‚ attack-card РІ С‡Р°С‚. РЈСЂРѕРЅ РїСЂРёРјРµРЅСЏРµС‚СЃСЏ РєРЅРѕРїРєРѕР№ РЅР° РєР°СЂС‚РѕС‡РєРµ.
 * dice: 1 = РїРѕРјРµС…Р°, 2 = СЃС‚Р°РЅРґР°СЂС‚, 3 = РїСЂРµРёРјСѓС‰РµСЃС‚РІРѕ.
 * focusAction / marksmanTrait СЃРЅРёР¶Р°СЋС‚ РїРѕСЂРѕРі СѓСЃРїРµС…Р° РЅР° 1 РєР°Р¶РґС‹Р№.
 * Homerule: TinyD6+ - Сѓ РѕСЂСѓР¶РёСЏ СЃ reload С‚СЂР°С‚РёС‚СЃСЏ 1 Р·Р°СЂСЏРґ (РґР°Р¶Рµ РїСЂРё
 * РїСЂРѕРјР°С…Рµ); РїСЂРё 0 Р·Р°СЂСЏРґРѕРІ Р°С‚Р°РєР° Р±Р»РѕРєРёСЂСѓРµС‚СЃСЏ Рё РІ С‡Р°С‚ РёРґС‘С‚ Р·Р°РіР»СѓС€РєР°. */
export async function performWeaponAttack(actor, weapon, dice = 2, { focusAction = false, marksmanTrait = false } = {}) {
const homerule = game.settings.get('tinyd6v14', 'enableTinyD6Plus');
    const showNpcMessages = game.settings.get('tinyd6v14', 'showNpcReloadMessages');
    const isNpc = actor?.type === "npc";
    // Homerule: персональная опция NPC «бесконечные патроны» - заряды не
    // списываются, пустой магазин невозможен.
    const infiniteAmmo = isNpc && Boolean(actor?.system?.homebrew?.infiniteAmmo);

    // Homerule: TinyD6+ - РІС‹РІРµРґРµРЅРЅС‹Р№ РёР· СЃС‚СЂРѕСЏ РїРµСЂСЃРѕРЅР°Р¶ РЅРµ РјРѕР¶РµС‚ Р°С‚Р°РєРѕРІР°С‚СЊ.
if (game.settings.get('tinyd6v14', 'enableTinyD6Plus') && isDowned(actor))
    {
        ui.notifications.warn(game.i18n.localize("tinyd6.death.cannotAct"));
        return;
    }

    // Homerule: режим «NPC должен надеть оружие» - без экипировки атака невозможна.
    if (isNpc && npcRequiresEquip(actor) && !weapon?.system?.equipped)
    {
        ui.notifications.warn(game.i18n.localize("tinyd6.attack.notEquipped"));
        return;
    }

    // Homerule: TinyD6+ - РїСЂРѕРІРµСЂРєР° Р·Р°СЂСЏРґРѕРІ РїРµСЂРµРґ Р°С‚Р°РєРѕР№.
    let weaponReload = false;
    let weaponMax = 0;
let weaponCharges = 0;
    if (homerule && weapon?.system?.reload && !infiniteAmmo)
    {
        weaponReload = true;
        weaponMax = Number(weapon.system.uses) || 0;
        weaponCharges = (weapon.system.charges !== undefined && weapon.system.charges !== null)
            ? Number(weapon.system.charges) : weaponMax;

        // РќРµ РїРѕРєР°Р·С‹РІР°РµРј Р·Р°РіР»СѓС€РєРё РґР»СЏ NPC, РµСЃР»Рё РѕС‚РєР»СЋС‡РµРЅРѕ РІ РЅР°СЃС‚СЂРѕР№РєР°С….
        const announce = showNpcMessages || !isNpc;
        if (weaponCharges <= 0)
        {
            if (announce)
            {
                ChatMessage.create({
                    speaker: ChatMessage.getSpeaker({ actor }),
                    content: `<div class="tinyd6 reload-stub">вљ  <b>${weapon.name}</b> (${actor.name}): ${game.i18n.localize("tinyd6.reload.outOfAmmo")}</div>`
                });
            }
            ui.notifications.warn(game.i18n.localize("tinyd6.reload.outOfAmmo"));
            return;
        }
    }

    const targets = _attackTargets(actor);

    if (!targets.length)
    {
        ui.notifications.warn(game.i18n.localize("tinyd6.attack.noTarget"));
        return;
    }

    let threshold = 5;
    if (focusAction) threshold -= 1;
    if (marksmanTrait) threshold -= 1;

    const weaponName = weapon?.name || actor.name;
    const weaponDamage = Number(weapon?.system?.damage) || 1;
    const weaponImg = weapon?.img || actor.img;

    const roll = await new Roll(`${dice}d6cs>=${threshold}`, {}).evaluate();
    const isHit = roll.total >= 1;
    const targetNames = targets.map(t => t.actor.name).join(", ");
    const results = roll.dice[0].results;

    // Homerule: Crit Advantage-Normal - РїСЂРё РІС‹РїР°РґРµРЅРёРё РѕРґРёРЅР°РєРѕРІС‹С… 6-РѕРє РЅР° РІСЃРµС…
    // РєСѓР±Р°С… (2d6 РёР»Рё 3d6 РІ Р·Р°РІРёСЃРёРјРѕСЃС‚Рё РѕС‚ РЅР°СЃС‚СЂРѕР№РєРё) СѓСЂРѕРЅ СѓРґРІР°РёРІР°РµС‚СЃСЏ.
    let isCrit = false;
    const critMode = game.settings.get('tinyd6v14', 'critAdvantage');
    if (critMode !== "off" && isHit && results.length > 0)
    {
        const allSixes = results.every(r => r.result === 6);
        const applies = (critMode === "both" && (dice === 2 || dice === 3)) ||
            (critMode === "two" && dice === 2) ||
            (critMode === "three" && dice === 3);
        isCrit = allSixes && applies;
    }
    // Доп. урон из листа героя (homebrew.damageBonus): плоская прибавка
    // к урону атаки, добавляется и к криту («Урон, добавляемый к любому
    // случайному броску урона» - настройка на листе персонажа).
    const damageBonus = Number(actor?.system?.homebrew?.damageBonus) || 0;
    const cardDamage = (isCrit ? weaponDamage * 2 : weaponDamage) + damageBonus;

    // Homerule: TinyD6+ - С‚СЂР°С‚РёРј 1 Р·Р°СЂСЏРґ РїРѕСЃР»Рµ Р±СЂРѕСЃРєР° (Рё РїСЂРё РїСЂРѕРјР°С…Рµ).
    let reloadedToEmpty = false;
    if (weaponReload)
    {
        const newCharges = Math.max(0, weaponCharges - 1);
        await weapon.update({ "system.charges": newCharges }, { render: false });
        reloadedToEmpty = (newCharges <= 0);
    }

    const content = await renderTemplate("systems/tinyd6v14/templates/partials/td6-attack-card.hbs", {
        attackId: foundry.utils.randomID(8),
        actorId: actor.id,
        actorName: actor.name,
        actorImg: actor.token?.img || actor.img,
        weaponName,
        weaponImg,
        isHit,
        isCrit,
        targetNames,
        targetIds: JSON.stringify(targets.map(t => ({ sceneId: t.token?.parent?.id, tokenId: t.token?.id }))),
        hasTargets: targets.length > 0,
        damage: cardDamage,
        weaponDamage,
        faces: results.map(r => _diceFace(r.result)),
        roll,
        // РљРЅРѕРїРєР° В«Р’РµСЂРЅСѓС‚СЊ СЂРµСЃСѓСЂСЃВ» - С‚РѕР»СЊРєРѕ Сѓ ranged+reload РѕСЂСѓР¶РёСЏ.
        showUndoResource: weaponReload,
        weaponId: weapon?.id || "",
        // Р”Р»СЏ РїРѕРёСЃРєР° РѕСЂСѓР¶РёСЏ Сѓ unlinked NPC-С‚РѕРєРµРЅР° (Р°РєС‚С‘СЂ РЅРµ РІ game.actors).
        attackerToken: (actor?.token && actor.token.parent)
            ? JSON.stringify({ sceneId: actor.token.parent.id, tokenId: actor.token.id })
            : "",
        // РЎРѕРѕР±С‰РµРЅРёРµ В«РїР°С‚СЂРѕРЅС‹ РєРѕРЅС‡РёР»РёСЃСЊВ» РІ РјРѕРјРµРЅС‚ РѕРїСѓСЃС‚РѕС€РµРЅРёСЏ.
        ranOut: reloadedToEmpty,
        announceRanOut: showNpcMessages || !isNpc
    });

    await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        content
    });
}

/* РќР°С…РѕРґРёС‚ ammo-РіРёСЂ РґР»СЏ РїРµСЂРµР·Р°СЂСЏРґРєРё РѕСЂСѓР¶РёСЏ.
 * РС‰РµС‚ РїРѕ ammoType РѕСЂСѓР¶РёСЏ. Р•СЃР»Рё С‚РёРї РЅРµ Р·Р°РґР°РЅ - РЅРµ_consumes ammo (РїСЂРѕСЃС‚РѕР№ reset).
 * Р’РѕР·РІСЂР°С‰Р°РµС‚ РїРѕРґС…РѕРґСЏС‰РёР№ РїСЂРµРґРјРµС‚ РёР»Рё null. */
export function findAmmoItem(actor, weapon) {
    if (!weapon?.system?.reload) return null;
    const type = weapon.system.ammoType;
    if (!type) return null;
    const ammoItems = (actor?.items ?? []).filter(i => i.type === "gear" && i.system?.category === "ammo" && (Number(i.system.quantity?.value) || 0) > 0);
    if (!ammoItems.length) return null;
    return ammoItems.find(i => i.system.ammoType === type) ?? null;
}

/* РџРµСЂРµР·Р°СЂСЏРґРєР° РѕСЂСѓР¶РёСЏ СЃ СѓС‡С‘С‚РѕРј ammo-РіРёСЂР°: СЃРїРёСЃС‹РІР°РµС‚ 1 СЂРѕР¶РѕРє Рё Р·Р°РїРѕР»РЅСЏРµС‚
 * РјР°РіР°Р·РёРЅ (charges = uses). Р•СЃР»Рё Сѓ РѕСЂСѓР¶РёСЏ РЅРµС‚ ammoType - РїСЂРѕСЃС‚РѕР№ reset
 * Р±РµР· consumo ammo. Р’РѕР·РІСЂР°С‰Р°РµС‚ { ok, weapon, ammo } РіРґРµ
 * ammo - РёСЃРїРѕР»СЊР·РѕРІР°РЅРЅС‹Р№ РіРёСЂ Р»РёР±Рѕ null. */
export async function reloadWeapon(actor, weapon, { render = true } = {}) {
    const weaponReload = Boolean(weapon?.system?.reload);
    if (!weaponReload) return { ok: false, weapon, ammo: null, reason: "notReload" };

    const ammo = findAmmoItem(actor, weapon);
    const hasAmmoType = Boolean(weapon.system?.ammoType);

    if (hasAmmoType && !ammo) {
        return { ok: false, weapon, ammo: null, reason: "no-ammo" };
    }

    if (ammo) {
        const qty = Number(ammo.system.quantity?.value) || 0;
        if (qty <= 0) return { ok: false, weapon, ammo, reason: "empty" };
        await ammo.update({ "system.quantity.value": qty - 1 }, { render: false });
    }

    await weapon.update({ "system.charges": Number(weapon.system.uses) || 0 }, { render });
    return { ok: true, weapon, ammo };
}

/* РћС„РѕСЂРјР»РµРЅРёРµ СЃРѕРѕР±С‰РµРЅРёСЏ РѕР± РёСЃС…РѕРґРµ РїРµСЂРµР·Р°СЂСЏРґРєРё. */
export async function postReloadMessage(actor, weapon, ammo, { showForNpc = false } = {}) {
    const isNpc = actor?.type === "npc";
    const announce = showForNpc || !isNpc;
    if (!announce) return;

    const speaker = ChatMessage.getSpeaker({ actor });
    const ammoName = ammo ? `<i class="fas fa-bell"></i> ${game.i18n.format("tinyd6.reload.ammoUsed", { ammo: ammo.name })}` : "";
    const content = `<div class="tinyd6 reload-stub"><i class="fas fa-undo-alt"></i> <b>${actor.name}</b> ${game.i18n.localize("tinyd6.reload.reloaded")} <b>${weapon.name}</b>${ammoName}</div>`;
    await ChatMessage.create({ speaker, content });
}

/* ============================================================
   Р›РµС‡РµРЅРёРµ (Homerule: TinyD6+ / gear.category = heal)
   ============================================================ */

/* Р Р°Р·Р±РёСЂР°РµС‚ С„РѕСЂРјСѓР»Сѓ Р»РµС‡РµРЅРёСЏ heal-РіРёСЂР°:
 *  - С„РёРєСЃ: С‡РёСЃР»Рѕ ("4", "10");
 *  - РєСѓР±С‹: "NdM" РёР»Рё "NdMВ±B" ("2d4", "1d6", "2d4+2").
 * Р’РѕР·РІСЂР°С‰Р°РµС‚ null, РµСЃР»Рё С„РѕСЂРјСѓР»Р° РЅРµ СЂР°СЃРїРѕР·РЅР°РЅР°. */
export function parseHealFormula(formula) {
    const f = String(formula ?? "").trim().toLowerCase();
    if (!f) return null;
    const diceMatch = f.match(/^(\d+)?d(\d+)([+-]\d+)?$/);
    if (diceMatch) {
        const n = Math.max(1, parseInt(diceMatch[1]) || 1);
        const sides = Math.max(1, parseInt(diceMatch[2]) || 1);
        const bonus = diceMatch[3] ? parseInt(diceMatch[3]) : 0;
        return { kind: "dice", n, sides, bonus };
    }
    const fixed = Number(f);
    if (Number.isFinite(fixed) && f !== "") return { kind: "fixed", value: Math.max(0, fixed) };
    return null;
}

/* РљРѕРјРїР°РєС‚РЅРѕРµ РѕС‚РѕР±СЂР°Р¶РµРЅРёРµ С„РѕСЂРјСѓР»С‹ ("4" РёР»Рё "2d4+2"). */
export function formatHealFormula(formula) {
    const p = parseHealFormula(formula);
    if (!p) return "";
    if (p.kind === "fixed") return String(p.value);
    let s = `${p.n}d${p.sides}`;
    if (p.bonus > 0) s += `+${p.bonus}`;
    else if (p.bonus < 0) s += p.bonus;
    return s;
}

/* Парсинг поля «резист/уязвимость к урону» (homebrew.damageResist):
 *  - число с минусом ("-1") - уязвимость: цель получает +N к урону;
 *  - число/плюс ("1", "+2") - резист: −N к итоговому урону;
 *  - формула кубов ("2d3", "1d2+1", "d6-1") - бросок резиста при применении.
 * Отличие от parseHealFormula: отрицательные числа не обрезаются. */
function parseResistFormula(raw) {
    const f = String(raw ?? "").trim().toLowerCase().replace(/[−-]/g, "-");
    if (!f) return null;
    const diceMatch = f.match(/^(\d+)?d(\d+)([+-]\d+)?$/);
    if (diceMatch) {
        const n = Math.max(1, parseInt(diceMatch[1]) || 1);
        const sides = Math.max(1, parseInt(diceMatch[2]) || 1);
        const bonus = diceMatch[3] ? parseInt(diceMatch[3]) : 0;
        return { kind: "dice", n, sides, bonus };
    }
    const fixed = Number(f);
    if (Number.isFinite(fixed) && f !== "") return { kind: "fixed", value: fixed };
    return null;
}

/* Текущий резист/уязвимость цели: фиксированное число как есть, формула
 * кидается заново при каждом применении урона. Положительное - резист,
 * отрицательное - уязвимость (+N к урону), 0 - нет эффекта. */
export async function rollDamageResist(actor) {
    const parsed = parseResistFormula(actor?.system?.homebrew?.damageResist);
    if (!parsed) return 0;
    if (parsed.kind === "fixed") return parsed.value;
    const formula = `${parsed.n}d${parsed.sides}${parsed.bonus ? (parsed.bonus > 0 ? "+" : "") + parsed.bonus : ""}`;
    const roll = await new Roll(formula, {}).evaluate();
    return Number(roll.total) || 0;
}

/* РљСѓР±РёРєРё С„РѕСЂРјСѓР»С‹ Р»РµС‡РµРЅРёСЏ РґР»СЏ РєР°СЂС‚РѕС‡РєРё РІ С‡Р°С‚Рµ: СЃРїРёСЃРѕРє { face, result }.
 * Р”Р»СЏ С„РёРєСЃР° РІРѕР·РІСЂР°С‰Р°РµС‚ РѕРґРёРЅ СЌР»РµРјРµРЅС‚ Р±РµР· РіСЂР°РЅРё РєСѓР±Р°. */
function _healRollFaces(parsed) {
    if (parsed.kind === "fixed") return [{ face: null, result: parsed.value }];
    const faces = [];
    for (let i = 0; i < parsed.n; i++) faces.push({ face: _diceFace(1), result: 0 });
    return faces;
}

/* РњРѕР¶РµС‚ Р»Рё С‚РµРєСѓС‰РёР№ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ РјРµРЅСЏС‚СЊ Р°РєС‚С‘СЂР° (РёРіСЂРѕРєРё - С‚РѕР»СЊРєРѕ СЃРІРѕРёС…, GM - РІСЃРµС…). */
function _canEditActor(target) {
    if (game.user?.isGM) return true;
    try { return Boolean(target?.testUserPermission?.(game.user, CONST.DOCUMENT_PERMISSION_LEVELS.OWNER)); }
    catch (err) { return false; }
}

/* Р­РєСЂР°РЅРёСЂСѓРµС‚ JSON РґР»СЏ Р°С‚СЂРёР±СѓС‚Р° data-* РєР°СЂС‚РѕС‡РєРё. */
function _jsonAttr(value) {
    let s = JSON.stringify(value ?? {});
    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    return s;
}

/* РџСЂРёРјРµРЅСЏРµС‚ heal-РіРёСЂ Рє С†РµР»Рё: Р±СЂРѕСЃР°РµС‚ С„РѕСЂРјСѓР»Сѓ (РµСЃР»Рё РєСѓР±РѕРІР°СЏ), РІРѕСЃСЃС‚Р°РЅР°РІР»РёРІР°РµС‚
 * HP (РЅРµ РІС‹С€Рµ max), СЃРїРёСЃС‹РІР°РµС‚ 1 С€С‚. Рё РїРѕСЃС‚РёС‚ РєР°СЂС‚РѕС‡РєСѓ РІ С‡Р°С‚. Р•СЃР»Рё Сѓ С‚РµРєСѓС‰РµРіРѕ
 * РёРіСЂРѕРєР° РЅРµС‚ РїСЂР°РІ РЅР° С†РµР»СЊ - РїСЂРёРјРµРЅСЏРµС‚ С‡РµСЂРµР· GM-РїСЂРѕРєСЃРё (socketlib, РЅР°СЃС‚СЂРѕР№РєР°
 * enableHealStabProxy), Р° РµСЃР»Рё РїСЂРѕРєСЃРё РЅРµРґРѕСЃС‚СѓРїРµРЅ - РїРѕСЃС‚РёС‚ РєР°СЂС‚РѕС‡РєСѓ-РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ
 * РґР»СЏ GM. Р’РѕР·РІСЂР°С‰Р°РµС‚ { ok, reason, healed, applied, target, item, needConfirm }. */
export async function useHealItem(healer, healItem, target, { showForNpc = false, healerRef = null, targetRef = null } = {}) {
    const homerule = game.settings.get('tinyd6v14', 'enableTinyD6Plus');
    if (!homerule) return { ok: false, reason: "disabled" };
    const healProxy = game.settings.get('tinyd6v14', 'enableHealStabProxy');
    if (!healer || !healItem || !target) return { ok: false, reason: "no-target" };
    if (healItem.type !== "gear" || healItem.system?.category !== "heal") return { ok: false, reason: "not-heal" };

    const qty = Number(healItem.system?.quantity?.value) || 0;
    if (qty <= 0) return { ok: false, reason: "empty" };

    const parsed = parseHealFormula(healItem.system?.heal);
    if (!parsed) return { ok: false, reason: "bad-formula" };

    const current = Number(target.system?.wounds?.value) || 0;
    const max = Number(target.system?.wounds?.max) || current;
    if (current >= max) return { ok: false, reason: "full" };

    // Р‘СЂРѕСЃРѕРє: РєСѓР±С‹ + Р±РѕРЅСѓСЃ, Р»РёР±Рѕ С„РёРєСЃ.
    let healed = 0;
    let rolls = [];
    let roll = null;
    if (parsed.kind === "dice")
    {
        const formula = `${parsed.n}d${parsed.sides}${parsed.bonus ? (parsed.bonus > 0 ? "+" : "") + parsed.bonus : ""}`;
        roll = await new Roll(formula, {}).evaluate();
        healed = Number(roll.total) || 0;
        rolls = roll.dice?.[0]?.results?.map(r => r.result) ?? [];
    }
    else
    {
        healed = parsed.value;
    }
    healed = Math.max(0, Math.floor(healed));

    // Р¦РµР»СЊ С‡СѓР¶Р°СЏ Рё Сѓ РёРіСЂРѕРєР° РЅРµС‚ РїСЂР°РІ - РїСЂРёРјРµРЅСЏРµРј С‡РµСЂРµР· GM-РїСЂРѕРєСЃРё (socketlib),
    // РµСЃР»Рё РІРєР»СЋС‡РµРЅР° РЅР°СЃС‚СЂРѕР№РєР° enableHealStabProxy. РРЅР°С‡Рµ - fallback РЅР°
    // РєР°СЂС‚РѕС‡РєСѓ-РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ, РєРѕС‚РѕСЂСѓСЋ РїСЂРёРјРµРЅСЏРµС‚ РІР»Р°РґРµР»РµС†/GM РІСЂСѓС‡РЅСѓСЋ.
    if (!_canEditActor(target))
    {
        const refs = {
            healerRef: healerRef ?? { actorId: healer.id },
            targetRef: targetRef ?? { actorId: target.id },
            healItemId: healItem.id,
            healed
        };
        if (healProxy)
        {
            const proxyResult = await gmProxy("applyHeal", refs);
            if (proxyResult && proxyResult.ok)
            {
                return { ok: true, needConfirm: false, proxy: true, healed, target, item: healItem };
            }
        }
        await postHealConfirmation(healer, healItem, target, refs, {
            healed, rolls, roll, faces: _healRollFaces(parsed)
        });
        return { ok: true, needConfirm: true, healed, target, item: healItem };
    }

    // РЎРїРёСЃС‹РІР°РµРј РіРёСЂ С‚РѕР»СЊРєРѕ РїСЂРё СЂРµР°Р»СЊРЅРѕРј Р»РµС‡РµРЅРёРё.
    await healItem.update({ "system.quantity.value": Math.max(0, qty - 1) }, { render: false });
    const applied = Math.min(max - current, healed);
    const wasted = Math.max(0, healed - applied);
    await target.update({ "system.wounds.value": current + applied });

    const isNpc = healer?.type === "npc";
    const announce = showForNpc || !isNpc;
    if (announce)
    {
        await postHealMessage(healer, healItem, target, {
            applied,
            healed,
            wasted,
            rolls,
            roll,
            faces: _healRollFaces(parsed)
        });
    }
    return { ok: true, healed, applied, wasted, target, item: healItem };
}

/* РљР°СЂС‚РѕС‡РєР°-РїРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ С…РёР»Р° РґР»СЏ GM: РёРіСЂРѕРє Р±РµР· РїСЂР°РІ РЅР° С†РµР»СЊ РёРЅРёС†РёРёСЂСѓРµС‚
 * Р»РµС‡РµРЅРёРµ, Р° РјР°СЃС‚РµСЂ РєР»РёРєР°РµС‚ В«РџСЂРёРјРµРЅРёС‚СЊВ», С‡С‚РѕР±С‹ СЃРїРёСЃР°С‚СЊ HP Рё Р·Р°СЂСЏРґ. */
export async function postHealConfirmation(healer, healItem, target, { healerRef = null, targetRef = null } = {}, { healed, rolls = [], roll = null, faces = [] } = {}) {
    const speaker = ChatMessage.getSpeaker({ actor: healer });
    const formula = formatHealFormula(healItem.system?.heal);

    const facesHtml = faces.map((f, i) => {
        const result = rolls[i] ?? f.result;
        const face = rolls[i] ? _diceFace(rolls[i]) : "";
        return `<span class="death-mini-icon mini"><i class="fas ${face}"></i><b>${result}</b></span>`;
    }).join("");

    const content = `<div class="tinyd6 death-mini heal-mini heal-confirm"
        data-healer='${_jsonAttr(healerRef)}'
        data-target='${_jsonAttr(targetRef)}'
        data-heal-item-id="${healItem.id}"
        data-healed="${healed}">
        <div class="death-mini-body">
            <span class="death-mini-title">${game.i18n.localize("tinyd6.heal.confirmTitle")} - <b>${healItem.name}</b></span>
            <span class="death-mini-sub"><b>${healer.name}</b> ${game.i18n.localize("tinyd6.heal.usesOn")} <b>${target.name}</b>: +${healed} HP (${formula || ""})</span>
            ${facesHtml ? `<div class="death-mini-rolls">${facesHtml}</div>` : ""}
            <button type="button" class="heal-apply" data-action="confirm-heal">
                <i class="fas fa-kit-medical"></i>
                ${game.i18n.localize("tinyd6.heal.applyConfirm")}
            </button>
        </div>
    </div>`;

    const chatData = { speaker, content };
    if (roll) chatData.rolls = [roll];
    await ChatMessage.create(chatData);
}

/* РџСЂРёРјРµРЅСЏРµС‚ РїРѕРґС‚РІРµСЂР¶РґС‘РЅРЅС‹Р№ GM С…РёР»: СЃРїРёСЃС‹РІР°РµС‚ Р·Р°СЂСЏРґ РіРёСЂР° Рё HP С†РµР»Рё.
 * Р Р°Р±РѕС‚Р°РµС‚ РїРѕ СЂРµС„РµСЂРµРЅСЃР°Рј (healerRef/targetRef) - РІС‹Р·С‹РІР°РµС‚ Рё GM-РєРЅРѕРїРєР°
 * РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ, Рё socket-РѕР±СЂР°Р±РѕС‚С‡РёРє (GM-РїСЂРѕРєСЃРё). */
export async function applyHealRefs({ healerRef, targetRef, healItemId, healed }) {
    if (!healerRef || !targetRef || !healItemId) return null;

    const healer = _resolveRefActor(healerRef);
    const target = _resolveRefActor(targetRef);
    const healItem = healer?.items?.get(healItemId) ?? null;
    if (!healer || !target || !healItem) return null;

    const qty = Number(healItem.system?.quantity?.value) || 0;
    const current = Number(target.system?.wounds?.value) || 0;
    const max = Number(target.system?.wounds?.max) || current;
    if (current >= max) return { ok: false, reason: "full" };

    await healItem.update({ "system.quantity.value": Math.max(0, qty - 1) }, { render: false });
    const applied = Math.min(max - current, healed);
    const wasted = Math.max(0, healed - applied);
    await target.update({ "system.wounds.value": current + applied });

    await postHealMessage(healer, healItem, target, {
        applied, healed, wasted, rolls: [], roll: null, faces: []
    });
    return { ok: true, applied, healed, wasted, target, item: healItem };
}

/* РџСЂРёРјРµРЅСЏРµС‚ РїРѕРґС‚РІРµСЂР¶РґС‘РЅРЅС‹Р№ GM С…РёР» СЃ РєР°СЂС‚РѕС‡РєРё-РїРѕРґС‚РІРµСЂР¶РґРµРЅРёСЏ (fallback,
 * РєРѕРіРґР° GM-РїСЂРѕРєСЃРё С‡РµСЂРµР· socket РЅРµРґРѕСЃС‚СѓРїРµРЅ). */
export async function applyHealConfirmation(card) {
    const healerRef = card.dataset.healer ? JSON.parse(card.dataset.healer) : null;
    const targetRef = card.dataset.target ? JSON.parse(card.dataset.target) : null;
    const healItemId = card.dataset.healItemId;
    const healed = Number(card.dataset.healed) || 0;
    return applyHealRefs({ healerRef, targetRef, healItemId, healed });
}

/* РќР°С…РѕРґРёС‚ Р°РєС‚С‘СЂР° РїРѕ СЂРµС„РµСЂРµРЅСЃСѓ РёР· РєР°СЂС‚РѕС‡РєРё: СЃРЅР°С‡Р°Р»Р° С‡РµСЂРµР· С‚РѕРєРµРЅ СЃС†РµРЅС‹
 * (РґР»СЏ unlinked NPC-РєРѕРїРёР№), РїРѕС‚РѕРј РїРѕ id Р°РєС‚С‘СЂР° РІ РґРёСЂРµРєС‚РѕСЂРёРё. */
function _resolveRefActor(ref) {
    if (!ref) return null;
    if (ref.sceneId && ref.tokenId)
    {
        const scene = game.scenes.get(ref.sceneId);
        const token = scene?.tokens.get(ref.tokenId) ?? null;
        if (token?.actor) return token.actor;
    }
    if (ref.actorId) return game.actors.get(ref.actorId) ?? null;
    return null;
}

/* РљР°СЂС‚РѕС‡РєР° Р»РµС‡РµРЅРёСЏ РІ С‡Р°С‚ (death-mini РІ В«Р·РµР»С‘РЅРѕРјВ» РІР°СЂРёР°РЅС‚Рµ). */
export async function postHealMessage(healer, healItem, target, { applied, healed, wasted = 0, rolls = [], roll = null, faces = [] } = {}) {
    const speaker = ChatMessage.getSpeaker({ actor: healer });
    const formula = formatHealFormula(healItem.system?.heal);

    const facesHtml = faces.map((f, i) => {
        const result = rolls[i] ?? f.result;
        const face = rolls[i] ? _diceFace(rolls[i]) : "";
        return `<span class="death-mini-icon mini"><i class="fas ${face}"></i><b>${result}</b></span>`;
    }).join("");

    const wastage = wasted > 0
        ? ` <span class="heal-wasted">${game.i18n.format("tinyd6.heal.wasted", { wasted })}</span>`
        : "";

    const content = `<div class="tinyd6 death-mini heal-mini">
        <div class="death-mini-body">
            <span class="death-mini-title">${game.i18n.localize("tinyd6.heal.heal")} - <b>${healItem.name}</b></span>
            <span class="death-mini-sub"><b>${healer.name}</b> ${game.i18n.localize("tinyd6.heal.usesOn")} <b>${target.name}</b>: +${applied} HP (${formula || ""})${wastage}</span>
        </div>
    </div>`;

    const chatData = { speaker, content };
    if (roll) chatData.rolls = [roll];
    await ChatMessage.create(chatData);
}

/* РќР°С…РѕРґРёС‚ heal-РіРёСЂ РїРѕ id (СЃСЂРµРґРё РїСЂРµРґРјРµС‚РѕРІ Р°РєС‚С‘СЂР°). */
export function findHealItem(actor, itemId) {
    return (actor?.items ?? []).get(itemId) ?? null;
}

/* РџСЂРёРјРµРЅСЏРµС‚ СѓСЂРѕРЅ Р°С‚Р°РєРё Рє С†РµР»СЏРј РёР· РєР°СЂС‚РѕС‡РєРё С‡Р°С‚Р° СЃ СѓС‡С‘С‚РѕРј Р±СЂРѕРЅРё С†РµР»Рё.
 * РљР°Р¶РґР°СЏ С†РµР»СЊ РёРґРµРЅС‚РёС„РёС†РёСЂСѓРµС‚СЃСЏ РїРѕ (sceneId, tokenId): СѓСЂРѕРЅ РёРґС‘С‚ РёРјРµРЅРЅРѕ
 * СЌС‚РѕРјСѓ С‚РѕРєРµРЅСѓ, РїРѕСЌС‚РѕРјСѓ РґР»СЏ unlinked NPC-С‚РѕРєРµРЅРѕРІ HP РјРµРЅСЏРµС‚СЃСЏ С‚РѕР»СЊРєРѕ Сѓ
 * РєРѕРЅРєСЂРµС‚РЅРѕР№ РєРѕРїРёРё, Р° РЅРµ Сѓ С€Р°Р±Р»РѕРЅР° РІ РґРёСЂРµРєС‚РѕСЂРёРё.
 * Р•СЃР»Рё Сѓ РёРіСЂРѕРєР° РЅРµС‚ РїСЂР°РІ РЅР° С†РµР»СЊ (С‡СѓР¶РѕР№ РіРµСЂРѕР№) - HP РЅРµ РјРµРЅСЏРµС‚СЃСЏ,
 * РЅРѕ СѓСЂРѕРЅ РІРѕР·РІСЂР°С‰Р°РµС‚СЃСЏ РІ `reported`, С‡С‚РѕР±С‹ РІС‹РІРµСЃС‚Рё РµРіРѕ РІ С‡Р°С‚. */
export async function applyAttackDamage({ actorId, targetIds, damage, isCrit = false }) {
    const applied = [];
    const reported = [];
    const proxyTargets = [];
    const proxyEnabled = game.settings.get('tinyd6v14', 'enableTinyD6Plus')
        && game.settings.get('tinyd6v14', 'enablePlayerDamageProxy');
    const fxEvents = [];

    for (const ref of targetIds)
    {
        let targetActor = null;
        let targetToken = null;

        if (ref && ref.tokenId)
        {
            const scene = game.scenes.get(ref.sceneId);
            targetToken = scene?.tokens.get(ref.tokenId) ?? null;
            targetActor = targetToken?.actor ?? null;
        }

        if (!targetActor)
        {
            const id = typeof ref === "string" ? ref : ref?.actorId;
            targetActor = id ? game.actors.get(id) : null;
        }

        if (!targetActor) continue;

        const armorDamage = computeDamage(damage, targetActor);

        // Резист/уязвимость цели (homebrew.damageResist): вычитается из урона
        // ПОСЛЕ брони, т.е. влияет только на здоровье.
        const resistVal = await rollDamageResist(targetActor);
        const finalDamage = Math.max(0, armorDamage - resistVal);

        // РРіСЂРѕРє РјРѕР¶РµС‚ РјРµРЅСЏС‚СЊ С‚РѕР»СЊРєРѕ СЃРІРѕРёС… Р°РєС‚РѕСЂРѕРІ; GM - РІСЃРµС….
        // Р”Р»СЏ С‚РѕРєРµРЅР° РїСЂР°РІР° Р±РµСЂС‘Рј РёР· С‚РѕРєРµРЅР° (РІР°Р¶РЅРѕ РґР»СЏ unlinked РєРѕРїРёР№).
        const canApply = game.user.isGM || (targetToken ? targetToken.isOwner : targetActor.testUserPermission(game.user, CONST.DOCUMENT_PERMISSION_LEVELS.OWNER));
        if (!canApply)
        {
            // Р§СѓР¶Р°СЏ С†РµР»СЊ: РїСЂРёРјРµРЅСЏРµРј С‡РµСЂРµР· GM-РїСЂРѕРєСЃРё (socketlib, РЅР°СЃС‚СЂРѕР№РєР°
            // enablePlayerDamageProxy), РёРЅР°С‡Рµ - С‚РѕР»СЊРєРѕ РѕС‚С‡РёС‚С‹РІР°РµРјСЃСЏ.
            proxyTargets.push({ ref, name: targetActor.name, finalDamage });
            continue;
        }

        // Р‘Р»РѕРє Р±СЂРѕРЅРё: СЃРµСЂРѕРµ РІСЃРїР»С‹РІР°СЋС‰РµРµ С‡РёСЃР»Рѕ РїРѕРіР»РѕС‰С‘РЅРЅРѕРіРѕ СѓСЂРѕРЅР° (DR).
        const absorbed = Math.max(0, Number(damage) - armorDamage);
        if (absorbed > 0 && isAnimFxEnabled())
        {
            const refTokenId = targetToken?.id ?? ref?.tokenId ?? null;
            const tok = refTokenId ? (game.canvas?.scene ? canvas.tokens.get(refTokenId) ?? null : null) : null;
            if (tok) spawnFloatingNumber(tok, targetActor, `${iconSvg("shield-halved")} ${absorbed}`, "block", { html: true });
            const sceneId = ref?.sceneId ?? game.canvas?.scene?.id ?? null;
            if (sceneId) fxEvents.push({ kind: "float", sceneId, tokenId: refTokenId, text: `${iconSvg("shield-halved")} ${absorbed}`, type: "block", html: true });
        }

        // РљСЂРёС‚ РЅР° СЃС†РµРЅРµ: Р·РѕР»РѕС‚Р°СЏ РІСЃРїС‹С€РєР° РЅР°Рґ С‚РѕРєРµРЅРѕРј С†РµР»Рё.
        if (isCrit && ref?.tokenId && isAnimFxEnabled())
        {
            const tok = game.canvas?.scene ? canvas.tokens.get(ref.tokenId) ?? null : null;
            if (tok) spawnTokenFlash(tok, "crit");
            const sceneId = ref?.sceneId ?? game.canvas?.scene?.id ?? null;
            fxEvents.push({ kind: "flash", sceneId, tokenId: ref?.tokenId, type: "crit" });
        }

        const current = Number(targetActor.system?.wounds?.value) || 0;
        const newValue = Math.max(0, current - finalDamage);

        // РџСЂРёРІСЏР·С‹РІР°РµРј РІСЃРїР»С‹РІР°СЋС‰РµРµ С‡РёСЃР»Рѕ Рє РљРћРќРљР Р•РўРќРћРњРЈ С‚РѕРєРµРЅСѓ-С†РµР»Рё: РґР»СЏ
        // unlinked NPC Сѓ РІСЃРµС… РєРѕРїРёР№ actor.id РѕРґРёРЅР°РєРѕРІС‹Р№, РїРѕСЌС‚РѕРјСѓ Р±РµР· СЏРІРЅРѕРіРѕ
        // С‚РѕРєРµРЅР° С‡РёСЃР»Рѕ РїРѕРєР°Р·Р°Р»РѕСЃСЊ Р±С‹ РЅР°Рґ РІСЃРµРјРё РєРѕРїРёСЏРјРё СЃСЂР°Р·Сѓ.
        const refTokenId = targetToken?.id ?? ref?.tokenId ?? null;
        if (refTokenId) _setPendingFloat(targetActor.id, refTokenId);

        await targetActor.update({ "system.wounds.value": newValue });

        // РЎРЅСЏС‚СЊ 1 Р·Р°РїР°СЃ РїСЂРѕС‡РЅРѕСЃС‚Рё Р±СЂРѕРЅРё (РµСЃР»Рё РѕРЅР° Р±С‹Р»Р° Рё Р·Р°С‰РёС‚РёР»Р°/РїРѕСЃС‚СЂР°РґР°Р»Р°).
const hadArmor = _actorArmorTotal(targetActor) > 0;
        const dentedItem = hadArmor ? await _reduceArmorHp(targetActor) : null;

        applied.push({
            name: targetActor.name,
            damage: finalDamage,
            resist: resistVal > 0 ? resistVal : 0,
            actorId: targetActor.id,
            ref: { sceneId: ref?.sceneId ?? null, tokenId: ref?.tokenId ?? null },
            armorItemId: dentedItem?.id ?? null
        });
    }

    // Р§СѓР¶РёРµ С†РµР»Рё: GM-РїСЂРѕРєСЃРё РїСЂРёРјРµРЅСЏРµС‚ РёС… СѓСЂРѕРЅ Р·Р° РёРіСЂРѕРєР°.
    if (proxyTargets.length && proxyEnabled)
    {
        const result = await gmProxy("applyDamage", {
            actorId,
            targetIds: proxyTargets.map(p => p.ref),
            damage,
            isCrit
        });
        if (result?.applied?.length) applied.push(...result.applied);
        if (result?.reported?.length) reported.push(...result.reported);
    }
    else
    {
        reported.push(...proxyTargets.map(p => ({ name: p.name, damage: p.finalDamage })));
    }

    broadcastFx(fxEvents);

return { applied, reported };
}

/* Откат применённого урона: возвращает HP (и прочность брони, если она
 * «зазубрилась») всем целям атаки. Вызывается кнопкой «Откат урона» на
 * карточке атаки (только GM). Опирается на сохранённые числа
 * applyAttackDamage, а не на повторный бросок (резист/броня не
 * пересчитываются). Если HP после отката снова > 0 - общий хук
 * updateActor сам снимет состояние смерти. */
export async function undoAttackDamage(applied = []) {
    const restored = [];
    for (const entry of applied)
    {
        const t = entry?.ref ?? null;
        let targetActor = null;
        if (t && t.tokenId)
        {
            const scene = game.scenes.get(t.sceneId);
            targetActor = scene?.tokens.get(t.tokenId)?.actor ?? null;
        }
        if (!targetActor && entry?.actorId) targetActor = game.actors.get(entry.actorId);
        if (!targetActor) continue;

        const current = Number(targetActor.system?.wounds?.value) || 0;
        const max = Number(targetActor.system?.wounds?.max) || current;
        const amount = Math.min(Math.max(0, Number(entry.damage) || 0), Math.max(0, max - current));
        if (amount > 0)
        {
            await targetActor.update({ "system.wounds.value": current + amount });
        }

        if (entry?.armorItemId)
        {
            const item = targetActor.items.get(entry.armorItemId);
            if (item?.system?.armorHp)
            {
                const cur = Number(item.system.armorHp.value) || 0;
                const armorMax = Number(item.system.armorHp.max) || cur;
                if (cur < armorMax)
                {
                    await item.update({ "system.armorHp.value": Math.min(armorMax, cur + 1) }, { render: false });
                }
            }
        }

        restored.push({ name: targetActor.name, amount });
    }
    return restored;
}

/* Р’СЃРїР»С‹РІР°СЋС‰РµРµ С‡РёСЃР»Рѕ СѓСЂРѕРЅР°/Р»РµС‡РµРЅРёСЏ РЅР°Рґ С‚РѕРєРµРЅРѕРј (Р°РЅРёРјР°С†РёСЏ .float-num РІ css).
 * РЎРѕР·РґР°С‘Рј .float-num РІ document.body: CSS Р°РЅРёРјРёСЂСѓРµС‚ РїРѕРґСЉС‘Рј Рё Р·Р°С‚СѓС…Р°РЅРёРµ,
 * JS СЃР°Рј СѓРґР°Р»СЏРµС‚ СЌР»РµРјРµРЅС‚ РїРѕСЃР»Рµ Р·Р°РІРµСЂС€РµРЅРёСЏ. РџРѕР·РёС†РёСЏ - client viewport
 * РєРѕРѕСЂРґРёРЅР°С‚С‹, С‡СѓС‚СЊ РІС‹С€Рµ С†РµРЅС‚СЂР° С‚РѕРєРµРЅР° */
export function spawnFloatingNumber(token, actor, text, type = "dmg", { html = false } = {}) {
    try {
        // Р•СЃР»Рё РїРµСЂРµРґР°РЅ С‚РѕРєРµРЅ - РёСЃРїРѕР»СЊР·СѓРµРј РµРіРѕ; РёРЅР°С‡Рµ (РїСЂР°РІРєР° HP РЅР° Р»РёСЃС‚Рµ,
        // Р±РµР· РїСЂРёРІСЏР·РєРё Рє РєРѕРЅРєСЂРµС‚РЅРѕР№ РєРѕРїРёРё) РёС‰РµРј РЅР° СЃС†РµРЅРµ РїРѕ Р°РєС‚С‘СЂСѓ.
        const matches = [];
        if (token)
        {
            const t = game.canvas?.scene ? canvas.tokens.get(token.id) ?? null : null;
            if (t) matches.push(t);
        }
        else
        {
            const list = game.canvas?.scene && canvas.tokens ? canvas.tokens.placeables : [];
            // РЎРЅР°С‡Р°Р»Р° С‚РѕС‡РЅРѕРµ СЃРѕРІРїР°РґРµРЅРёРµ РїРѕ СЌРєР·РµРјРїР»СЏСЂСѓ (linked-С‚РѕРєРµРЅС‹: t.actor -
            // С‚РѕС‚ Р¶Рµ РѕР±СЉРµРєС‚, С‡С‚Рѕ Рё Р°РєС‚С‘СЂ). Р•СЃР»Рё СЌРєР·РµРјРїР»СЏСЂ РЅРµ СЃРѕРІРїР°Р» РЅРё Сѓ РєРѕРіРѕ,
            // РЅРѕ СЃРѕРІРїР°Р» id - РїРѕРєР°Р·С‹РІР°РµРј РўРћР›Р¬РљРћ РµСЃР»Рё С‚Р°РєР°СЏ РєРѕРїРёСЏ РѕРґРЅР° (РёРЅР°С‡Рµ
            // РґР»СЏ unlinked NPC-РєРѕРїРёР№ С‡РёСЃР»Рѕ РІСЃРїР»С‹Р»Рѕ Р±С‹ РЅР°Рґ РІСЃРµРјРё СЃСЂР°Р·Сѓ).
            for (const t of list) {
                if (t.actor === actor) matches.push(t);
            }
            if (!matches.length)
            {
                const byId = list.filter(t => t.actor?.id === actor?.id);
                if (byId.length === 1) matches.push(byId[0]);
            }
        }

        if (!matches.length) return;
        for (const match of matches) {
            const anchor = _floatAnchor(match);
            if (anchor) _spawnFloat(anchor, text, type, { html });
        }
    } catch (err) {
        console.warn("tinyd6 | float number skipped:", err);
    }
}

/* Р’СЃРїС‹С€РєР° РЅР°Рґ С‚РѕРєРµРЅРѕРј (СѓСЂРѕРЅ/Р»РµС‡РµРЅРёРµ/РєСЂРёС‚/СЃРјРµСЂС‚СЊ). РЎРѕР·РґР°С‘С‚ .fx-flash
 * РІ body РїРѕРІРµСЂС… С‚РѕРєРµРЅР°. РџРѕР·РёС†РёСЏ - client viewport РєРѕРѕСЂРґРёРЅР°С‚С‹. */
export function spawnTokenFlash(token, type = "dmg") {
    try {
        if (!isAnimFxEnabled()) return;
        const t = game.canvas?.scene ? canvas.tokens.get(token.id) ?? null : null;
        if (!t) return;
        const rect = _tokenScreenRect(t);
        if (!rect) return;

        const el = document.createElement("div");
        el.className = `fx-flash ${type}`;
        el.style.left = `${rect.x}px`;
        el.style.top = `${rect.y}px`;
        el.style.width = `${rect.w}px`;
        el.style.height = `${rect.h}px`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 650);
    } catch (err) {
        console.warn("tinyd6 | flash skipped:", err);
    }
}

/* Р-Р°С‚РµРјРЅРµРЅРёРµ С‚РѕРєРµРЅР° РїСЂРё СЃРјРµСЂС‚Рё. РЎРѕР·РґР°С‘С‚ .fx-death РїРѕРІРµСЂС… С‚РѕРєРµРЅР°. */
export function spawnTokenDeath(token) {
    try {
        if (!isAnimFxEnabled()) return;
        const t = game.canvas?.scene ? canvas.tokens.get(token.id) ?? null : null;
        if (!t) return;
        const rect = _tokenScreenRect(t);
        if (!rect) return;

        const size = Math.max(rect.w, rect.h) * 1.4;
        const el = document.createElement("div");
        el.className = "fx-death";
        el.style.left = `${rect.x + rect.w / 2 - size / 2}px`;
        el.style.top = `${rect.y + rect.h / 2 - size / 2}px`;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 1050);
    } catch (err) {
        console.warn("tinyd6 | death fx skipped:", err);
    }
}

/* РџСЂСЏРјРѕСѓРіРѕР»СЊРЅРёРє С‚РѕРєРµРЅР° РІ РєР»РёРµРЅС‚СЃРєРёС… РєРѕРѕСЂРґРёРЅР°С‚Р°С…. */
function _tokenScreenRect(placeable) {
    if (!placeable) return null;
    const has = placeable.x !== undefined && placeable.y !== undefined
        && placeable.w !== undefined && placeable.h !== undefined;
    if (!has) return null;

    let tl = { x: placeable.x, y: placeable.y };
    let br = { x: placeable.x + placeable.w, y: placeable.y + placeable.h };
    try {
        if (canvas.clientCoordinatesFromCanvas) {
            tl = canvas.clientCoordinatesFromCanvas(tl);
            br = canvas.clientCoordinatesFromCanvas(br);
        } else if (canvas.coordinates?.toScreenPosition) {
            tl = canvas.coordinates.toScreenPosition(tl);
            br = canvas.coordinates.toScreenPosition(br);
        }
    } catch (err) { return null; }

    const x = Math.min(tl.x, br.x);
    const y = Math.min(tl.y, br.y);
    return { x, y, w: Math.abs(br.x - tl.x), h: Math.abs(br.y - tl.y) };
}

/* РўРѕС‡РєР° РїРѕСЏРІР»РµРЅРёСЏ С‡РёСЃР»Р°: 3/4 РѕС‚ РЅРёР·Р° С‚РѕРєРµРЅР° (С‡СѓС‚СЊ РІС‹С€Рµ С†РµРЅС‚СЂР°). */
function _floatAnchor(placeable) {
    if (!placeable) return null;
    const has = placeable.h !== undefined && placeable.y !== undefined;
    if (has)
    {
        return { x: placeable.center.x, y: placeable.y + placeable.h * 0.25 };
    }
    return placeable.center ?? null;
}

function _spawnFloat(center, text, type, { html = false } = {}) {
    // РљРѕРЅРІРµСЂС‚РёСЂСѓРµРј РєРѕРѕСЂРґРёРЅР°С‚С‹ РєР°РЅРІР°СЃР° РІ РєР»РёРµРЅС‚СЃРєРёРµ (viewport), С‚.Рє. СЌР»РµРјРµРЅС‚
    // РїРѕР·РёС†РёРѕРЅРёСЂСѓРµС‚СЃСЏ position:fixed. Р’ v14 СЌС‚Рѕ canvas.clientCoordinatesFromCanvas.
    let point = null;
    try {
        if (canvas.clientCoordinatesFromCanvas) {
            point = canvas.clientCoordinatesFromCanvas({ x: center.x, y: center.y });
        } else if (canvas.coordinates?.toScreenPosition) {
            point = canvas.coordinates.toScreenPosition({ x: center.x, y: center.y });
        }
    } catch (err) {
        point = null;
    }
    if (!point) return;

    const el = document.createElement("div");
    el.className = `float-num ${type}`;
    if (html) el.innerHTML = text;
    else el.textContent = text;
    el.style.left = `${point.x}px`;
    el.style.top = `${point.y}px`;
    document.body.appendChild(el);

    setTimeout(() => el.remove(), 1100);
}
