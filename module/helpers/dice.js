import { isDowned } from "./death.js";

/* Включены ли анимации боя (настройка мира animFx). */
export function isAnimFxEnabled() {
    try { return game.settings.get("tinyd6v14", "animFx") !== false; }
    catch (err) { return true; }
}

/* Реестр всплывающих чисел, привязанных к конкретному токену-цели.
 * Ключ — id актёра, значение — id токена, над которым надо показать число.
 * Нужен потому, что для unlinked NPC у всех копий одного актёра одинаковый
 * actor.id, поэтому хук updateActor сам не может различить, какой из них ранен. */
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
   Автоматизированные атаки (оружие по таргетам)
   ============================================================ */

function _attackTargets(attacker) {
    const targets = [];
    if (game.user.targets?.size)
    {
        game.user.targets.forEach(t => {
            if (!t.actor) return;
            // Целью может быть NPC или другой герой, но не сам стреляющий.
            if (attacker && t.actor.id === attacker.id) return;
            if (t.actor.type === "npc" || t.actor.type === "hero") targets.push({ actor: t.actor, token: t.document });
        });
    }
    return targets;
}

function _equippedArmor(actor) {
    return (actor?.items ?? []).filter(i => i.type === "armor" && i.system?.equipped);
}

/* Только «живая» броня: экипированная и с ненулевым запасом прочности. */
function _activeArmor(actor) {
    return _equippedArmor(actor).filter(i => (Number(i.system?.armorHp?.value) || 0) > 0);
}

/* Суммарный DR активной (не истраченной) брони. */
function _actorArmorTotal(actor) {
    return _activeArmor(actor).reduce((sum, i) => sum + (Number(i.system?.damageReduction) || 0), 0);
}

/* Снимает 1 запас прочности с первой активной брони.
 * Возвращает true, если запас был снят. */
async function _reduceArmorHp(actor) {
    const active = _activeArmor(actor);
    if (!active.length) return false;
    const item = active[0];
    const current = Number(item.system?.armorHp?.value) || 0;
    await item.update({ "system.armorHp.value": Math.max(0, current - 1) });
    return true;
}

/* Урон атаки по конкретной цели с учётом её брони.
 * Броня в Tiny D6 всегда активна:
 *  - если урон <= DR активной брони — урон полностью поглощён (0),
 *    но с брони снимается 1 запас прочности;
 *  - если урон > DR — цель получает урон - DR, и с брони снимается 1 запас;
 *  - когда запас брони на нуле, она перестаёт защищать. */
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

/* Открывает диалог атаки оружием: выбор режима броска (помеха/стандарт/
 * преимущество) и модификаторов Focus/Marksman. Общий для листа актёра и HUD. */
export function openAttackDialog(actor, weapon) {
    if (!actor || !weapon) return;

    const focusLabel = game.i18n.localize("tinyd6.dice.modifier.focus");
    const marksmanLabel = game.i18n.localize("tinyd6.dice.modifier.marksman");

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
        render: (html) => {
            html.find(".toggle-focus").on("change", (ev) => {
                const enabled = ev.currentTarget.checked;
                html.find(".toggle-marksman").prop("disabled", !enabled);
                if (!enabled) html.find(".toggle-marksman").prop("checked", false);
            });
        },
        default: "standard"
    }).render(true);
}

/* Полный бросок атаки: валидирует таргеты, кидает d6cs>=5,
 * рендерит attack-card в чат. Урон применяется кнопкой на карточке.
 * dice: 1 = помеха, 2 = стандарт, 3 = преимущество.
 * focusAction / marksmanTrait снижают порог успеха на 1 каждый.
 * Homerule: TinyD6+ — у оружия с reload тратится 1 заряд (даже при
 * промахе); при 0 зарядов атака блокируется и в чат идёт заглушка. */
export async function performWeaponAttack(actor, weapon, dice = 2, { focusAction = false, marksmanTrait = false } = {}) {
    const homerule = game.settings.get('tinyd6v14', 'enableTinyD6Plus');
    const showNpcMessages = game.settings.get('tinyd6v14', 'showNpcReloadMessages');
    const isNpc = actor?.type === "npc";

    // Homerule: TinyD6+ — выведенный из строя персонаж не может атаковать.
    if (game.settings.get('tinyd6v14', 'enableTinyD6Plus') && isDowned(actor))
    {
        ui.notifications.warn(game.i18n.localize("tinyd6.death.cannotAct"));
        return;
    }

    // Homerule: TinyD6+ — проверка зарядов перед атакой.
    let weaponReload = false;
    let weaponMax = 0;
    let weaponCharges = 0;
    if (homerule && weapon?.system?.reload)
    {
        weaponReload = true;
        weaponMax = Number(weapon.system.uses) || 0;
        weaponCharges = (weapon.system.charges !== undefined && weapon.system.charges !== null)
            ? Number(weapon.system.charges) : weaponMax;

        // Не показываем заглушки для NPC, если отключено в настройках.
        const announce = showNpcMessages || !isNpc;
        if (weaponCharges <= 0)
        {
            if (announce)
            {
                ChatMessage.create({
                    speaker: ChatMessage.getSpeaker({ actor }),
                    content: `<div class="tinyd6 reload-stub">⚠ <b>${weapon.name}</b> (${actor.name}): ${game.i18n.localize("tinyd6.reload.outOfAmmo")}</div>`
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

    // Homerule: Crit Advantage-Normal — при выпадении одинаковых 6-ок на всех
    // кубах (2d6 или 3d6 в зависимости от настройки) урон удваивается.
    let isCrit = false;
    const critMode = game.settings.get('tinyd6v14', 'critAdvantage');
    if (critMode !== "off" && isHit && results.length > 0)
    {
        const allSixes = results.every(r => r.result === 6);
        const applies = (critMode === "both") ||
            (critMode === "two" && dice === 2) ||
            (critMode === "three" && dice === 3);
        isCrit = allSixes && applies;
    }
    const cardDamage = isCrit ? weaponDamage * 2 : weaponDamage;

    // Homerule: TinyD6+ — тратим 1 заряд после броска (и при промахе).
    let reloadedToEmpty = false;
    if (weaponReload)
    {
        const newCharges = Math.max(0, weaponCharges - 1);
        await weapon.update({ "system.charges": newCharges }, { render: false });
        reloadedToEmpty = (newCharges <= 0);
    }

    const content = await renderTemplate("systems/tinyd6v14/templates/partials/attack-card.hbs", {
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
        // Кнопка «Вернуть ресурс» — только у ranged+reload оружия.
        showUndoResource: weaponReload,
        weaponId: weapon?.id || "",
        // Для поиска оружия у unlinked NPC-токена (актёр не в game.actors).
        attackerToken: (actor?.token && actor.token.parent)
            ? JSON.stringify({ sceneId: actor.token.parent.id, tokenId: actor.token.id })
            : "",
        // Сообщение «патроны кончились» в момент опустошения.
        ranOut: reloadedToEmpty,
        announceRanOut: showNpcMessages || !isNpc
    });

    await roll.toMessage({
        speaker: ChatMessage.getSpeaker({ actor }),
        content
    });
}

/* Находит ammo-гир для перезарядки оружия.
 * Ищет по ammoType оружия; если тип не задан или задан но не найден —
 * по fallback: сначала тот же тип у любого гира, при пустой цели — любой
 * ammo-гир. Возвращает первый подходящий предмет или null. */
export function findAmmoItem(actor, weapon) {
    if (!weapon?.system?.reload) return null;
    const ammoItems = (actor?.items ?? []).filter(i => i.type === "gear" && i.system?.category === "ammo" && (Number(i.system.quantity?.value) || 0) > 0);
    if (!ammoItems.length) return null;
    const type = weapon.system.ammoType;
    if (type) {
        return ammoItems.find(i => i.system.ammoType === type) ?? null;
    }
    return ammoItems[0] ?? null;
}

/* Перезарядка оружия с учётом ammo-гира: списывает 1 рожок и заполняет
 * магазин (charges = uses). Возвращает { ok, weapon, ammo } где
 * ammo — использованный гир либо null. Если ammo нет — возвращает { ok:false }
 * (рожок не списывается, заряды не трогаются). */
export async function reloadWeapon(actor, weapon, { render = true } = {}) {
    const ammo = findAmmoItem(actor, weapon);
    const weaponReload = Boolean(weapon?.system?.reload);

    // Если не reload либо ammo-гир не нужен/не найден — обычный сброс (резерв).
    if (!weaponReload || !ammo) {
        if (!weaponReload) return { ok: false, weapon, ammo: null, reason: "notReload" };
        return { ok: false, weapon, ammo: null, reason: "no-ammo" };
    }

    const qty = Number(ammo.system.quantity?.value) || 0;
    if (qty <= 0) return { ok: false, weapon, ammo, reason: "empty" };

    await ammo.update({ "system.quantity.value": qty - 1 }, { render: false });
    await weapon.update({ "system.charges": Number(weapon.system.uses) || 0 }, { render });

    return { ok: true, weapon, ammo };
}

/* Оформление сообщения об исходе перезарядки. */
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
   Лечение (Homerule: TinyD6+ / gear.category = heal)
   ============================================================ */

/* Разбирает формулу лечения heal-гира:
 *  - фикс: число ("4", "10");
 *  - кубы: "NdM" или "NdM±B" ("2d4", "1d6", "2d4+2").
 * Возвращает null, если формула не распознана. */
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

/* Компактное отображение формулы ("4" или "2d4+2"). */
export function formatHealFormula(formula) {
    const p = parseHealFormula(formula);
    if (!p) return "";
    if (p.kind === "fixed") return String(p.value);
    let s = `${p.n}d${p.sides}`;
    if (p.bonus > 0) s += `+${p.bonus}`;
    else if (p.bonus < 0) s += p.bonus;
    return s;
}

/* Кубики формулы лечения для карточки в чате: список { face, result }.
 * Для фикса возвращает один элемент без грани куба. */
function _healRollFaces(parsed) {
    if (parsed.kind === "fixed") return [{ face: null, result: parsed.value }];
    const faces = [];
    for (let i = 0; i < parsed.n; i++) faces.push({ face: _diceFace(1), result: 0 });
    return faces;
}

/* Применяет heal-гир к цели: бросает формулу (если кубовая), восстанавливает
 * HP (не выше max), списывает 1 шт. и постит карточку в чат. Возвращает
 * { ok, reason, healed, applied, target }. */
export async function useHealItem(healer, healItem, target, { showForNpc = false } = {}) {
    const homerule = game.settings.get('tinyd6v14', 'enableTinyD6Plus');
    if (!homerule) return { ok: false, reason: "disabled" };
    if (!healer || !healItem || !target) return { ok: false, reason: "no-target" };
    if (healItem.type !== "gear" || healItem.system?.category !== "heal") return { ok: false, reason: "not-heal" };

    const qty = Number(healItem.system?.quantity?.value) || 0;
    if (qty <= 0) return { ok: false, reason: "empty" };

    const parsed = parseHealFormula(healItem.system?.heal);
    if (!parsed) return { ok: false, reason: "bad-formula" };

    const current = Number(target.system?.wounds?.value) || 0;
    const max = Number(target.system?.wounds?.max) || current;
    if (current >= max) return { ok: false, reason: "full" };

    // Бросок: кубы + бонус, либо фикс.
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

    // Списываем гир только при реальном лечении.
    await healItem.update({ "system.quantity.value": Math.max(0, qty - 1) }, { render: false });
    const applied = Math.min(max - current, healed);
    await target.update({ "system.wounds.value": current + applied });

    const isNpc = healer?.type === "npc";
    const announce = showForNpc || !isNpc;
    if (announce)
    {
        await postHealMessage(healer, healItem, target, {
            applied,
            healed,
            rolls,
            roll,
            faces: _healRollFaces(parsed)
        });
    }
    return { ok: true, healed, applied, target, item: healItem };
}

/* Карточка лечения в чат (death-mini в «зелёном» варианте). */
export async function postHealMessage(healer, healItem, target, { applied, healed, rolls = [], roll = null, faces = [] } = {}) {
    const speaker = ChatMessage.getSpeaker({ actor: healer });
    const formula = formatHealFormula(healItem.system?.heal);

    const facesHtml = faces.map((f, i) => {
        const result = rolls[i] ?? f.result;
        const face = rolls[i] ? _diceFace(rolls[i]) : "";
        return `<span class="death-mini-icon mini"><i class="fas ${face}"></i><b>${result}</b></span>`;
    }).join("");

    const content = `<div class="tinyd6 death-mini heal-mini">
        <div class="death-mini-body">
            <span class="death-mini-title">${game.i18n.localize("tinyd6.heal.heal")} — <b>${healItem.name}</b></span>
            <span class="death-mini-sub"><b>${healer.name}</b> ${game.i18n.localize("tinyd6.heal.usesOn")} <b>${target.name}</b>: ${applied} HP (${formula || ""})</span>
        </div>
    </div>`;

    const chatData = { speaker, content };
    if (roll) chatData.rolls = [roll];
    await ChatMessage.create(chatData);
}

/* Находит heal-гир по id (среди предметов актёра). */
export function findHealItem(actor, itemId) {
    return (actor?.items ?? []).get(itemId) ?? null;
}

/* Применяет урон атаки к целям из карточки чата с учётом брони цели.
 * Каждая цель идентифицируется по (sceneId, tokenId): урон идёт именно
 * этому токену, поэтому для unlinked NPC-токенов HP меняется только у
 * конкретной копии, а не у шаблона в директории.
 * Если у игрока нет прав на цель (чужой герой) — HP не меняется,
 * но урон возвращается в `reported`, чтобы вывести его в чат. */
export async function applyAttackDamage({ actorId, targetIds, damage, isCrit = false }) {
    const applied = [];
    const reported = [];
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

        const finalDamage = computeDamage(damage, targetActor);

        // Блок брони: серое всплывающее число поглощённого урона (DR).
        const absorbed = Math.max(0, Number(damage) - finalDamage);
        if (absorbed > 0 && isAnimFxEnabled())
        {
            const refTokenId = targetToken?.id ?? ref?.tokenId ?? null;
            const tok = refTokenId ? (game.canvas?.scene ? canvas.tokens.get(refTokenId) ?? null : null) : null;
            if (tok) spawnFloatingNumber(tok, targetActor, `<i class="fas fa-shield-alt"></i> ${absorbed}`, "block", { html: true });
        }

        // Крит на сцене: золотая вспышка над токеном цели.
        if (isCrit && ref?.tokenId && isAnimFxEnabled())
        {
            const tok = game.canvas?.scene ? canvas.tokens.get(ref.tokenId) ?? null : null;
            if (tok) spawnTokenFlash(tok, "crit");
        }

        // Игрок может менять только своих акторов; GM — всех.
        // Для токена права берём из токена (важно для unlinked копий).
        const canApply = game.user.isGM || (targetToken ? targetToken.isOwner : targetActor.testUserPermission(game.user, CONST.DOCUMENT_PERMISSION_LEVELS.OWNER));
        if (canApply)
        {
            const current = Number(targetActor.system?.wounds?.value) || 0;
            const newValue = Math.max(0, current - finalDamage);

            // Привязываем всплывающее число к КОНКРЕТНОМУ токену-цели: для
            // unlinked NPC у всех копий actor.id одинаковый, поэтому без явного
            // токена число показалось бы над всеми копиями сразу.
            const refTokenId = targetToken?.id ?? ref?.tokenId ?? null;
            if (refTokenId) _setPendingFloat(targetActor.id, refTokenId);

            await targetActor.update({ "system.wounds.value": newValue });

            // Снять 1 запас прочности брони (если она была и защитила/пострадала).
            const hadArmor = _actorArmorTotal(targetActor) > 0;
            if (hadArmor) await _reduceArmorHp(targetActor);

            applied.push({ name: targetActor.name, damage: finalDamage });
        }
        else
        {
            reported.push({ name: targetActor.name, damage: finalDamage });
        }
    }
    return { applied, reported };
}

/* Всплывающее число урона/лечения над токеном (анимация .float-num в css).
 * Создаём .float-num в document.body: CSS анимирует подъём и затухание,
 * JS сам удаляет элемент после завершения. Позиция — client viewport
 * координаты, чуть выше центра токена */
export function spawnFloatingNumber(token, actor, text, type = "dmg", { html = false } = {}) {
    try {
        // Если передан токен — используем его; иначе (правка HP на листе,
        // без привязки к конкретной копии) ищем на сцене по актёру.
        const matches = [];
        if (token)
        {
            const t = game.canvas?.scene ? canvas.tokens.get(token.id) ?? null : null;
            if (t) matches.push(t);
        }
        else
        {
            const list = game.canvas?.scene && canvas.tokens ? canvas.tokens.placeables : [];
            // Сначала точное совпадение по экземпляру (linked-токены: t.actor —
            // тот же объект, что и актёр). Если экземпляр не совпал ни у кого,
            // но совпал id — показываем ТОЛЬКО если такая копия одна (иначе
            // для unlinked NPC-копий число всплыло бы над всеми сразу).
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

/* Вспышка над токеном (урон/лечение/крит/смерть). Создаёт .fx-flash
 * в body поверх токена. Позиция — client viewport координаты. */
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

/* Затемнение токена при смерти. Создаёт .fx-death поверх токена. */
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

/* Прямоугольник токена в клиентских координатах. */
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

/* Точка появления числа: 3/4 от низа токена (чуть выше центра). */
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
    // Конвертируем координаты канваса в клиентские (viewport), т.к. элемент
    // позиционируется position:fixed. В v14 это canvas.clientCoordinatesFromCanvas.
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