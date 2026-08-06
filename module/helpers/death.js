/* ============================================================
   Homerule: Death / 0 HP
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
    if (!actor || !game.settings.get('tinyd6v14', 'enableDeathHomerule')) return;

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
    if (!combat || !game.settings.get('tinyd6v14', 'enableDeathHomerule')) return;

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