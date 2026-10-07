import { applyHealRefs, applyAttackDamage, spawnFloatingNumber, spawnTokenFlash, spawnTokenDeath } from "./dice.js";
import { applyStabilizeRefs, playDeathSoundLocal, playDeathTickLocal } from "./death.js";
import { applyDeathFx } from "./deathFx.js";

/* ============================================================
   GM-прокси через socketlib: позволяет компании наносить,
   лечить и стабилизировать чужого (другого игрока / NPC) без
   права владения. Запрос уходит GM-клиенту, который применяет
   изменения от своего имени (у GM есть права на всё).

   Помимо применения данных, GM рассылает всем клиентам события
   визуальных эффектов (playFx): всплывающие числа урона/лечения,
   вспышки крита и затемнение при смерти. Каждый клиент рисует
   эффект на собственный canvas - иначе анимации видит только GM.
   ============================================================ */

let _socket = null;

/* Рисует события FX на canvas текущего клиента. Вызывается у всех
 * клиентов по socket (в т.ч. у игроков), когда GM применил повреждения. */
function _applyFxLocal(fxEvents) {
    if (!fxEvents?.length) return;
    if (!game.canvas?.scene) return;
    for (const fx of fxEvents)
    {
        if (!fx || !fx.tokenId) continue;
        if (fx.sceneId && fx.sceneId !== game.canvas.scene.id) continue;
        const tokenDoc = game.canvas.scene.tokens.get(fx.tokenId) ?? null;
        const placeable = tokenDoc ? canvas.tokens.get(tokenDoc.id) ?? null : null;
        if (!placeable) continue;

        if (fx.kind === "float")
        {
            spawnFloatingNumber(placeable, tokenDoc.actor, fx.text, fx.type, { html: Boolean(fx.html) });
        }
        else if (fx.kind === "flash")
        {
            spawnTokenFlash(placeable, fx.type);
        }
        else if (fx.kind === "death")
        {
            spawnTokenDeath(placeable);
        }
    }
}

/* Обновляет содержимое сообщения (chat card) на GM-клиенте и возвращает true.
 * Игроки без прав на сообщение не могут update() сами, поэтому синхронизация
 * карточек уходит через GM-прокси, как и остальные записи. */
async function _syncCard({ messageId, content }) {
    if (!messageId) return false;
    const message = game.messages.get(messageId);
    if (!message) return false;
    await message.update({ content });
    return true;
}

/* Отправляет события FX всем ОСТАЛЬНЫМ клиентам (инициатор уже
 * нарисовал их у себя локально, поэтому не получает их повторно). */
export function broadcastFx(fxEvents) {
    if (!fxEvents?.length) return;
    const sock = registerSystemSocket();
    if (!sock) return;
    try {
        sock.executeForOthers("playFx", fxEvents);
    } catch (err) {
        console.warn("tinyd6 | broadcastFx failed:", err);
    }
}

const HANDLERS = {
    applyHeal: applyHealRefs,
    applyStabilize: applyStabilizeRefs,
    applyDamage: applyAttackDamage,
    playFx: _applyFxLocal,
    syncCard: _syncCard,
    playDeathSound: playDeathSoundLocal,
    playDeathTick: (tier) => playDeathTickLocal(Number(tier) || 1),
    setDeathFx: (fx) => applyDeathFx(fx || {})
};

/* Регистрирует системный socket (socketlib). Вызывается из ready
 * системы, после инициализации socketlib. */
export function registerSystemSocket() {
    if (_socket) return _socket;
    if (typeof socketlib === "undefined" || !socketlib.registerSystem) return null;
    try {
        _socket = socketlib.registerSystem("tinyd6v14");
    } catch (err) {
        console.warn("tinyd6 | socketlib registration failed:", err);
        return null;
    }
    if (!_socket) return null;

    for (const [name, handler] of Object.entries(HANDLERS))
    {
        _socket.register(name, handler);
    }
    return _socket;
}

/* Отправляет запрос GM-клиенту. Возвращает результат (resolve)
 * или null, если GM-прокси недоступен. */
export async function gmProxy(action, payload) {
    const sock = registerSystemSocket();
    if (!sock) return null;
    const handler = HANDLERS[action];
    if (!handler) return null;
    try {
        if (game.user.isGM) {
            // GM применяет локально (нет смысла слать себе).
            return await handler(payload);
        }
        if (!game.users.activeGM) return null;
        return await sock.executeAsGM(action, payload);
    } catch (err) {
        console.warn(`tinyd6 | socket GM proxy '${action}' failed:`, err);
        return null;
    }
}
