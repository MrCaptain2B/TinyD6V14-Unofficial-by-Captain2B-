/* ============================================================
   Homerule: TinyD6+ / 0 HP
   ============================================================
   Когда HP персонажа падает до 0:
   - герой и «важный NPC» (галочка Important NPC): токен получает
     встроенный статус «потеря сознания» (unconscious), с момента
     обнуления ставится счётчик, и сразу кидается спасбросок смерти
     1d6: успех (>= порога) — стабилизирован (счётчик сбрасывается),
     провал — Dying: счётчик тикает каждый ход персонажа, на исходе — Dead;
   - обычный NPC — сразу статус выведения из строя, без броска.
   При возврате HP выше 0 счётчик сбрасывается и статусы снимаются.
   ============================================================ */

import { gmProxy } from "./socket.js";

export const DEATH_STATUSES = {
    // Встроенный статус Foundry «потеря сознания» (hero / important NPC).
    unconscious: { id: "unconscious", label: "tinyd6.death.unconscious" },
    // Статус выведения из строя для обычных NPC (красное кольцо).
    down:   { id: "tinyd6Down",   label: "tinyd6.death.down"   },
    dying:  { id: "tinyd6Dying",  label: "tinyd6.death.dying"  },
    dead:   { id: "tinyd6Dead",   label: "tinyd6.death.dead"   }
};

/* Пока персонаж выведен из строя (0 HP) — атаковать нельзя. */
export function isDowned(actor) {
    const d = actor?.system?.death;
    return Boolean(d?.down || d?.dying || d?.dead);
}

export function isDying(actor) {
    return Boolean(actor?.system?.death?.dying);
}

/* Регистрирует кастомные статусы в CONFIG.statusEffects. Статус unconscious
 * (потеря сознания) — встроенный в Foundry, добавляем только свои. */
export function registerDeathStatusEffects() {
    const path = "systems/tinyd6v14/assets/icons/";
    const existing = new Set(CONFIG.statusEffects.map(s => s.id));
    const defs = [
        { id: DEATH_STATUSES.down.id,  name: DEATH_STATUSES.down.label,  img: path + "death-defeated.svg" },
        { id: DEATH_STATUSES.dying.id, name: DEATH_STATUSES.dying.label, img: path + "death-dying.svg" },
        { id: DEATH_STATUSES.dead.id,  name: DEATH_STATUSES.dead.label,  img: path + "death-dead.svg" }
    ];
    for (const def of defs) {
        if (!existing.has(def.id)) CONFIG.statusEffects.push(def);
    }
}

/* Применяет статус смерти к актёру. В v14 статус-эффекты токена полностью
 * хранятся на Active Effects актёра: для unlinked NPC-токена это вложенный
 * актёр токена, для героя — актёр в директории. Actor#toggleStatusEffect —
 * официальный API, который сам создаёт/удаляет нужный ActiveEffect. */
async function _setStatus(actor, id, active, { overlay = false } = {}) {
    if (!actor || typeof actor.toggleStatusEffect !== "function") return;
    try {
        await actor.toggleStatusEffect(id, { active, overlay });
    } catch (err) { /* ignore */ }
}

/* Иконка грани куба (fa-dice-*) по выпавшему результату 1d6. */
const DIE_FACES = [null, "fa-dice-one", "fa-dice-two", "fa-dice-three", "fa-dice-four", "fa-dice-five", "fa-dice-six"];
function _dieFace(total) {
    return DIE_FACES[total] || "fa-dice-one";
}

async function _clearAll(actor) {
    await _setStatus(actor, DEATH_STATUSES.unconscious.id, false);
    await _setStatus(actor, DEATH_STATUSES.down.id, false);
    await _setStatus(actor, DEATH_STATUSES.dying.id, false);
    await _setStatus(actor, DEATH_STATUSES.dead.id, false);
}

/* Сбрасывает состояние смерти и статусы (HP поднялся выше 0). */
export async function clearDeathState(actor) {
    if (!actor) return;
    const changed = [];
    if (actor.system.death?.down) changed.push("system.death.down");
    if (actor.system.death?.dying) changed.push("system.death.dying");
    if (actor.system.death?.dead) changed.push("system.death.dead");
    if (actor.system.death?.roundsLeft) changed.push("system.death.roundsLeft");

    if (changed.length) {
        await actor.update({
            "system.death.down": false,
            "system.death.dying": false,
            "system.death.dead": false,
            "system.death.roundsLeft": 0
        }, { render: false });
    }
    await _clearAll(actor);
}

/* Основной хендлер попадания HP в 0. */
export async function handleZeroHp(actor) {
    if (!actor || !game.settings.get('tinyd6v14', 'enableTinyD6Plus')) return;

    const isHero = actor.type === "hero";
    const importantNpc = actor.type === "npc" && Boolean(actor.system?.important);
    const doesDeathSave = isHero || importantNpc;

    // Обычный NPC: статус выведения из строя (красное кольцо), без броска.
    if (!doesDeathSave)
    {
        await actor.update({ "system.death.down": true }, { render: false });
        await _setStatus(actor, DEATH_STATUSES.down.id, true, { overlay: true });
        if (game.settings.get('tinyd6v14', 'showNpcDeathMessages'))
        {
            ChatMessage.create({
                speaker: ChatMessage.getSpeaker({ actor }),
                content: `<div class="tinyd6 death-stub"><b>${actor.name}</b> ${game.i18n.localize("tinyd6.death.defeated")}</div>`
            });
        }
        return;
    }

    // Герой / важный NPC: «потеря сознания» + спасбросок смерти.
    const rounds = Number(game.settings.get('tinyd6v14', 'deathRounds')) || 3;
    const threshold = Number(game.settings.get('tinyd6v14', 'deathSaveThreshold')) || 4;
    const roll = await new Roll("1d6", {}).evaluate();
    const success = roll.total >= threshold;

    // Счётчик ставится с момента обнуления: при успехе (стабилизация) — 0,
    // при провале — deathRounds раундов, которые тикают вниз до смерти.
    await actor.update({
        "system.death.down": true,
        "system.death.dying": !success,
        "system.death.dead": false,
        "system.death.roundsLeft": success ? 0 : rounds
    }, { render: false });
    await _setStatus(actor, DEATH_STATUSES.unconscious.id, true);
    await _setStatus(actor, DEATH_STATUSES.down.id, false);
    if (!success) await _setStatus(actor, DEATH_STATUSES.dying.id, true);

    const speaker = ChatMessage.getSpeaker({ actor });
    await ChatMessage.create({
        speaker,
        flavor: game.i18n.localize("tinyd6.death.thrown") + " — " + game.i18n.localize("tinyd6.death.self"),
        content: success
            ? `<div class="tinyd6 death-mini stable"><span class="death-mini-icon"><i class="fas ${_dieFace(roll.total)}"></i></span><div class="death-mini-body"><span class="death-mini-title">${game.i18n.localize("tinyd6.death.stabilized")}</span><span class="death-mini-sub">${game.i18n.localize("tinyd6.death.stabilizedHint")}</span></div></div>`
            : `<div class="tinyd6 death-mini dying"><span class="death-mini-icon"><i class="fas ${_dieFace(roll.total)}"></i></span><div class="death-mini-body"><span class="death-mini-title">${game.i18n.localize("tinyd6.death.dying")}</span><span class="death-mini-sub">${game.i18n.localize("tinyd6.death.dyingHint").replace("{rounds}", rounds)}</span></div></div>`,
        rolls: [roll]
    });
}

/* Тикает таймер смерти на начало хода поверженного персонажа в бою.
 * Вызывается из updateCombat, когда активный боец сменился.
 * Каждый ход поверженного героя/важного NPC в чат выводится сообщение:
 * «(@actor) умрёт через N ходов», N уменьшается на 1 за ход. */
export async function tickDeathTimers(combat) {
    if (!combat || !game.settings.get('tinyd6v14', 'enableTinyD6Plus')) return;

    const combatant = combat.combatant;
    if (!combatant) return;
    const actor = combatant.actor;
    if (!actor || !isDying(actor)) return;
    if ((Number(actor.system?.wounds?.value) || 0) > 0) return;

    const left = Number(actor.system?.death?.roundsLeft) || 0;
    const next = left - 1;
    if (next > 0)
    {
        await actor.update({ "system.death.roundsLeft": next }, { render: false });
        const text = game.i18n.format("tinyd6.death.turnsLeft", { actor: actor.name, n: next });
        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="tinyd6 death-stub death-timer">${text}</div>`
        });
    }
    else
    {
        // Время вышло — персонаж умирает: статус мёртв, без сознания остаётся.
        await actor.update({
            "system.death.dying": false,
            "system.death.dead": true,
            "system.death.roundsLeft": 0
        }, { render: false });
        await _setStatus(actor, DEATH_STATUSES.dying.id, false);
        await _setStatus(actor, DEATH_STATUSES.dead.id, true);
        await _setStatus(actor, DEATH_STATUSES.unconscious.id, true);
        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="tinyd6 death-stub death-timer death-died"><b>${actor.name}</b> ${game.i18n.localize("tinyd6.death.died")}</div>`
        });
    }
}

/* ============================================================
   Стабилизация (Homerule: TinyD6+ / кнопка «Стабилизировать»)
   ============================================================
   Персонаж с 0 HP пытается стабилизироваться: кидается спасбросок против
   deathSaveThreshold (по умолчанию 4). Режим броска — как у атаки:
   Помеха (1 куб) / Стандарт (2 куба) / Преимущество (3 куба).
   Успех (хотя бы один куб >= порога) — стабилизирован: dying снимается,
   счётчик сбрасывается, «потеря сознания» остаётся. Провал — Dying
   продолжает тикать. Работает только по токенам-целям (не на себя). */

function _stabilizeTargets(stabilizer) {
    const targets = [];
    if (game.user.targets?.size)
    {
        game.user.targets.forEach(t => {
            if (!t.actor) return;
            // На себя нацеливаться нельзя.
            if (stabilizer && t.actor.id === stabilizer.id) return;
            if (t.actor.type === "npc" || t.actor.type === "hero") targets.push(t);
        });
    }
    return targets;
}

/* Токен-цель, которой можно стабилизироваться (0 HP, повержена). */
export function getStabilizeTarget(stabilizer) {
    const targets = _stabilizeTargets(stabilizer);
    return targets.find(t => (Number(t.actor?.system?.wounds?.value) || 0) <= 0) ?? null;
}

/* Открывает диалог стабилизации: выбор режима броска (помеха/стандарт/
 * преимущество). Общий для листа актёра и HUD. */
export function openStabilizeDialog(stabilizer, target) {
    if (!stabilizer || !target) return;
    if (stabilizer.id === target.actor?.id)
    {
        ui.notifications.warn(game.i18n.localize("tinyd6.stabilize.self"));
        return;
    }
    if ((Number(target.actor?.system?.wounds?.value) || 0) > 0)
    {
        ui.notifications.warn(game.i18n.localize("tinyd6.stabilize.notDowned"));
        return;
    }

    const name = target.actor?.name ?? "";
    new Dialog({
        title: game.i18n.localize("tinyd6.stabilize.title"),
        content: `<p><b>${name}</b> — ${game.i18n.localize("tinyd6.stabilize.subtitle")}</p>`,
        buttons: {
            disadvantage: {
                label: game.i18n.localize("tinyd6.dice.roll.disadvantage"),
                callback: () => rollStabilize(stabilizer, target, 1)
            },
            standard: {
                label: game.i18n.localize("tinyd6.dice.roll.standard"),
                callback: () => rollStabilize(stabilizer, target, 2)
            },
            advantage: {
                label: game.i18n.localize("tinyd6.dice.roll.advantage"),
                callback: () => rollStabilize(stabilizer, target, 3)
            }
        },
        default: "standard"
    }).render(true);
}

/* Бросок стабилизации: dice = 1 (помеха), 2 (стандарт), 3 (преимущество).
 * Успех — хотя бы один куб >= порога. При успехе стабилизирует цель и
 * пишет карточку в чат. Возвращает { success, roll }. */
export async function rollStabilize(stabilizer, target, dice = 2) {
    if (!target?.actor) return null;
    const actor = target.actor;
    if (stabilizer?.id === actor.id) return null;
    if (!game.settings.get('tinyd6v14', 'enableTinyD6Plus')) return null;
    const stabProxy = game.settings.get('tinyd6v14', 'enableHealStabProxy');

    const threshold = Number(game.settings.get('tinyd6v14', 'deathSaveThreshold')) || 4;
    const roll = await new Roll(`${dice}d6cs>=${threshold}`, {}).evaluate();
    const success = roll.total >= 1;
    const results = roll.dice?.[0]?.results?.map(r => r.result) ?? [];
    const faces = results.map(r => _dieFace(r));

    // Цель чужая и у игрока нет прав — применяем через GM-прокси (socketlib),
    // если включена настройка enableHealStabProxy. Иначе — fallback на карточку.
    if (!_canEditStab(actor))
    {
        const targetRef = _extractTokenRefStab(target);
        if (stabProxy)
        {
            const proxyResult = await gmProxy("applyStabilize", { targetRef, success });
            if (proxyResult && proxyResult.ok)
            {
                return { success, roll, needConfirm: false, proxy: true, targetRef };
            }
        }
        await _postStabilizeConfirmation(stabilizer, target, { success, roll, faces, results });
        return { success, roll, needConfirm: true };
    }

    if (success)
    {
        // Стабилизирован: повержен, но жив; Dying и счётчик сбрасываются.
        await actor.update({
            "system.death.down": true,
            "system.death.dying": false,
            "system.death.dead": false,
            "system.death.roundsLeft": 0
        }, { render: false });
        await _setStatus(actor, DEATH_STATUSES.unconscious.id, true);
        await _setStatus(actor, DEATH_STATUSES.dying.id, false);
    }

    const speaker = ChatMessage.getSpeaker({ actor: stabilizer });
    const flavor = `${game.i18n.localize("tinyd6.stabilize.thrown")} — ${game.i18n.localize("tinyd6.stabilize.target")} ${actor.name}`;
    const facesHtml = faces.map(f => `<span class="death-mini-icon mini"><i class="fas ${f}"></i></span>`).join("");
    const content = success
        ? `<div class="tinyd6 death-mini stable"><div class="death-mini-icon"><i class="fas fa-kit-medical"></i></div><div class="death-mini-body"><span class="death-mini-title">${game.i18n.localize("tinyd6.stabilize.success")}</span><span class="death-mini-sub">${actor.name} — ${game.i18n.localize("tinyd6.death.stabilizedHint")}</span></div><div class="death-mini-rolls">${facesHtml}</div></div>`
        : `<div class="tinyd6 death-mini dying"><div class="death-mini-icon"><i class="fas fa-skull-crossbones"></i></div><div class="death-mini-body"><span class="death-mini-title">${game.i18n.localize("tinyd6.stabilize.fail")}</span><span class="death-mini-sub">${actor.name} — ${game.i18n.localize("tinyd6.death.dyingHint").replace("{rounds}", Number(actor.system?.death?.roundsLeft) || 0)}</span></div><div class="death-mini-rolls">${facesHtml}</div></div>`;

    await ChatMessage.create({
        speaker,
        flavor,
        content,
        rolls: [roll]
    });
    return { success, roll };
}

/* Может ли текущий пользователь менять актёра (GM всегда, игрок — только своих). */
function _canEditStab(actor) {
    if (game.user?.isGM) return true;
    try { return Boolean(actor?.testUserPermission?.(game.user, CONST.DOCUMENT_PERMISSION_LEVELS.OWNER)); }
    catch (err) { return false; }
}

/* Экранирует JSON для атрибута data-* карточки. */
function _stabJsonAttr(value) {
    let s = JSON.stringify(value ?? {});
    s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    return s;
}

/* Карточка-подтверждение стабилизации для GM: бросок сделан игроком,
 * а статус смерти мастер применяет кнопкой (видят только GM). */
async function _postStabilizeConfirmation(stabilizer, target, { success, roll, faces, results }) {
    const actor = target.actor;
    const speaker = ChatMessage.getSpeaker({ actor: stabilizer });
    const flavor = `${game.i18n.localize("tinyd6.stabilize.thrown")} — ${game.i18n.localize("tinyd6.stabilize.target")} ${actor.name}`;

    const facesHtml = faces.map(f => `<span class="death-mini-icon mini"><i class="fas ${f}"></i></span>`).join("");
    const content = `<div class="tinyd6 death-mini stab-confirm ${success ? "stable" : "dying"}"
        data-stab-target='${_stabJsonAttr(_extractTokenRefStab(target))}'
        data-stab-success="${success ? "true" : "false"}">
        <div class="death-mini-body">
            <span class="death-mini-title">${success ? game.i18n.localize("tinyd6.stabilize.thrown") + " — " + game.i18n.localize("tinyd6.stabilize.success") : game.i18n.localize("tinyd6.stabilize.thrown") + " — " + game.i18n.localize("tinyd6.stabilize.fail")}</span>
            <span class="death-mini-sub"><b>${stabilizer.name}</b> — <b>${actor.name}</b></span>
            ${facesHtml ? `<div class="death-mini-rolls">${facesHtml}</div>` : ""}
            <button type="button" class="stab-apply" data-action="confirm-stabilize">${game.i18n.localize("tinyd6.stabilize.applyConfirm")}</button>
        </div>
    </div>`;

    const chatData = { speaker, flavor, content };
    if (roll) chatData.rolls = [roll];
    await ChatMessage.create(chatData);
}

/* Применяет подтверждённую GM стабилизацию по референсу токена-цели.
 * Работает по proxy-схеме: вызывается socket-обработчиком (GM-прокси)
 * и (как fallback) кнопкой подтверждения на карточке. */
export async function applyStabilizeRefs({ targetRef, success }) {
    if (!targetRef) return { ok: false };
    const actor = _resolveStabActor(targetRef);
    if (!actor) return { ok: false };

    if (success)
    {
        await actor.update({
            "system.death.down": true,
            "system.death.dying": false,
            "system.death.dead": false,
            "system.death.roundsLeft": 0
        }, { render: false });
        await _setStatus(actor, DEATH_STATUSES.unconscious.id, true);
        await _setStatus(actor, DEATH_STATUSES.dying.id, false);
    }

    const speaker = ChatMessage.getSpeaker({ actor });
    const flavor = game.i18n.localize("tinyd6.stabilize.thrown");
    const content = success
        ? `<div class="tinyd6 death-mini stable"><div class="death-mini-icon"><i class="fas fa-kit-medical"></i></div><div class="death-mini-body"><span class="death-mini-title">${game.i18n.localize("tinyd6.stabilize.success")}</span><span class="death-mini-sub">${actor.name} — ${game.i18n.localize("tinyd6.death.stabilizedHint")}</span></div></div>`
        : `<div class="tinyd6 death-mini dying"><div class="death-mini-icon"><i class="fas fa-skull-crossbones"></i></div><div class="death-mini-body"><span class="death-mini-title">${game.i18n.localize("tinyd6.stabilize.fail")}</span><span class="death-mini-sub">${actor.name} — ${game.i18n.localize("tinyd6.death.dyingHint").replace("{rounds}", Number(game.settings.get('tinyd6v14', 'deathRounds')) || 3)}</span></div></div>`;

    await ChatMessage.create({ speaker, flavor, content });
    return { ok: true, success, actor };
}

/* Применяет подтверждённую GM стабилизацию с карточки-подтверждения
 * (fallback, когда GM-прокси через socket недоступен). */
export async function applyStabilizeConfirmation(card) {
    const ref = card.dataset.stabTarget ? JSON.parse(card.dataset.stabTarget) : null;
    const success = card.dataset.stabSuccess === "true";
    if (!ref) return { ok: false };
    return applyStabilizeRefs({ targetRef: ref, success });
}

/* Референс токена-цели: id сцены и токена (для unlinked копий) + id актёра. */
function _extractTokenRefStab(token) {
    return {
        sceneId: token.scene?.id ?? null,
        tokenId: token.id ?? null,
        actorId: token.actor?.id ?? null
    };
}

/* Находит актёра по референсу из карточки подтверждения стабилизации. */
function _resolveStabActor(ref) {
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