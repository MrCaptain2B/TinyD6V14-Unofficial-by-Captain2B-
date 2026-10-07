/* ============================================================
   Homerule: TinyD6+ / 0 HP
   ============================================================
   Когда HP персонажа падает до 0:
   - герой и «важный NPC» (галочка Important NPC): с момента обнуления
     ставится счётчик, и сразу кидается спасбросок смерти 1d6:
     успех (>= порога) - стабилизирован (счётчик сбрасывается),
     провал - Dying: счётчик тикает каждый ход персонажа, на исходе - Dead;
   - обычный NPC - сразу статус выведения из строя, без броска.
   При возврате HP выше 0 счётчик сбрасывается и статусы снимаются.
   Статусы смерти - системные, чтобы модули, работающие с логикой
   Foundry, не конфликтовали с системой: для финальной смерти
   используется ВСТРОЕННЫЙ статус ядра id "dead", а не свой.
   ============================================================ */

import { gmProxy, registerSystemSocket } from "./socket.js";
import { iconSvg } from "./icons.js";
import { applyDeathFx } from "./deathFx.js";

export const DEATH_STATUSES = {
    // Статус выведения из строя для обычных NPC (красное кольцо).
    down:   { id: "tinyd6Down",   label: "tinyd6.death.down"   },
    dying:  { id: "tinyd6Dying",  label: "tinyd6.death.dying"  },
    // Финальная смерть - ВСТРОЕННЫЙ статус Foundry (id "dead"), чтобы
    // внешние модули, работающие с ядром, не конфликтовали с системой.
    dead:   { id: "dead", label: "tinyd6.death.dead" }
};

/* Пока персонаж выведен из строя (0 HP) - атаковать нельзя. */
export function isDowned(actor) {
    const d = actor?.system?.death;
    return Boolean(d?.down || d?.dying || d?.dead);
}

export function isDying(actor) {
    return Boolean(actor?.system?.death?.dying);
}

/* Палитра статус-эффектов свелась к 4 пунктам. «Поражён» и «Умирает» -
 * свои (иконки системы), финальные «Смерть» (id "dead") и «Без сознания»
 * (id "unconscious") - ВСТРОЕННЫЕ статусы Foundry: берём их готовыми из
 * core (или как есть со стороны модулей), чтобы внешние хендлеры ядра
 * работали без конфликтов. Остальные статусы ядра (ослеплён, отравлен
 * и т.п.) системе не нужны и из палитры убраны. */
export function registerDeathStatusEffects() {
    const path = "systems/tinyd6v14/assets/icons/";
    const core = new Map(CONFIG.statusEffects.filter(s => s?.id).map(s => [s.id, s]));
    const dead = core.get("dead")
        ? { ...core.get("dead"), name: DEATH_STATUSES.dead.label }
        : { id: DEATH_STATUSES.dead.id, name: DEATH_STATUSES.dead.label, img: "icons/svg/skull.svg" };
    const unconscious = core.get("unconscious")
        ? { ...core.get("unconscious") }
        : { id: "unconscious", name: "tinyd6.death.unconscious", img: "icons/svg/unconscious.svg" };
    CONFIG.statusEffects = [
        { id: DEATH_STATUSES.down.id,  name: DEATH_STATUSES.down.label,  img: path + "death-defeated.svg" },
        { id: DEATH_STATUSES.dying.id, name: DEATH_STATUSES.dying.label, img: path + "death-dying.svg" },
        dead,
        unconscious
    ];
}

/* Применяет статус смерти к актёру. В v14 статус-эффекты токена полностью
 * хранятся на Active Effects актёра: для unlinked NPC-токена это вложенный
 * актёр токена, для героя - актёр в директории. Actor#toggleStatusEffect -
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

/* Иконка выпавшей грани: d6-грани (fa-dice-one..six), для кубиков d8/d10 -
 * иконка типа самого кубика. */
function _deathRollIcon(formula, total) {
    const faces = [null, "fa-dice-one", "fa-dice-two", "fa-dice-three", "fa-dice-four", "fa-dice-five", "fa-dice-six"];
    if (faces[total]) return faces[total];
    const m = String(formula || "").match(/d([0-9]+)$/);
    if (m && ["4", "8", "10", "12", "20"].includes(m[1])) return `fa-dice-d${m[1]}`;
    return "fa-dice-d6";
}

/* Правильная форма слова по числу (Intl.PluralRules по языку игры). */
function _pluralWord(kind, n) {
    const lang = game.i18n?.lang || "en";
    let rules;
    try { rules = new Intl.PluralRules(lang); }
    catch (err) { rules = new Intl.PluralRules("en"); }
    const form = rules.select(Number(n) || 0);
    const key = `tinyd6.plural.${kind}.${form}`;
    const w = game.i18n.localize(key);
    return w === key ? game.i18n.localize(`tinyd6.plural.${kind}.many`) : w;
}

/* Склонение слова «раунд» по числу (таймер смерти). */
export function roundsWord(n) { return _pluralWord("round", n); }

/* Склонение слова «ход» по числу (сообщения таймера). */
export function turnsWord(n) { return _pluralWord("turn", n); }

/* Кубик спасброска героя: персональное поле листа (d4-d10) или d6. */
function _deathDie(actor) {
    const hb = String(actor?.system?.homebrew?.deathDie ?? "").trim();
    return /^d[0-9]+$/.test(hb) ? hb : "1d6";
}

/* Порог спасброска: персональное поле героя, иначе настройка мира. */
function _deathThreshold(actor) {
    const hb = Number(actor?.system?.homebrew?.deathSaveThreshold);
    if (!Number.isNaN(hb) && hb > 0) return hb;
    return Number(game.settings.get('tinyd6v14', 'deathSaveThreshold')) || 4;
}

/* «Раунды до смерти»: персональное поле героя (если заполнено) или
 * настройка мира. Принимает и число (3), и формулу (1d6+2, 2d5) -
 * формула кидается один раз при падении HP в 0. Возвращает итог. */
async function _resolveDeathRounds(actor) {
    const hb = String(actor?.system?.homebrew?.deathRounds ?? "").trim();
    const world = String(game.settings.get('tinyd6v14', 'deathRounds') ?? "3").trim() || "3";
    const raw = hb || world;
    if (/^\s*-?\d+\s*$/.test(raw)) return { total: Math.max(1, Number(raw)), formula: null };
    try {
        const roll = await new Roll(raw, {}).evaluate();
        return { total: Math.max(1, roll.total), formula: raw };
    } catch (err) {
        return { total: 3, formula: null };
    }
}

/* Предложение-результат карточки смерти: имя персонажа + локализованный текст.
 * Успех - стабилизирован; провал - умирает, без помощи умрёт через N раундов. */
function _deathSentence(actor, success, rounds) {
    const name = `<b>${actor.name}</b>`;
    if (success)
    {
        return `<span class="death-mini-text">${name} ${game.i18n.localize("tinyd6.death.stabilizedRest")}</span>`;
    }
    const word = roundsWord(rounds);
    return `<span class="death-mini-text">${name} ${game.i18n.format("tinyd6.death.dyingRest", { n: rounds, word })}</span>`;
}

async function _clearAll(actor) {
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
    broadcastDeathFx(actor.id, 0);
}

/* Основной хендлер попадания HP в 0. */
export async function handleZeroHp(actor) {
    if (!actor || !game.settings.get('tinyd6v14', 'enableTinyD6Plus')) return;

    console.info("tinyd6 | death << handleZeroHp", { actor: actor.id, name: actor.name, type: actor.type });

    const isHero = actor.type === "hero";
    const importantNpc = actor.type === "npc" && Boolean(actor.system?.important);
    const doesDeathSave = isHero || importantNpc;

    // Обычный NPC: статус выведения из строя (красное кольцо), без броска.
    if (!doesDeathSave)
    {
        console.info("tinyd6 | death << npc defeated (no death save)");
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

    // Герой / важный NPC: спасбросок смерти.
    // Количество раундов и кубик/порог задаются в настройках мира и листа
    // героя; «раунды» могут быть формулой (1d6+2, 2d5) - она кидается один
    // раз при падении HP в 0, чтобы каждое падение давало разный срок.
    const roundsRes = await _resolveDeathRounds(actor);
    const rounds = roundsRes.total;
    const threshold = _deathThreshold(actor);
    const dieFormula = _deathDie(actor);
    const roll = await new Roll(dieFormula, {}).evaluate();
    const success = roll.total >= threshold;

    // Счётчик ставится с момента обнуления: при успехе (стабилизация) - 0,
    // при провале - deathRounds раундов, которые тикают вниз до смерти.
    await actor.update({
        "system.death.down": true,
        "system.death.dying": !success,
        "system.death.dead": false,
        "system.death.roundsLeft": success ? 0 : rounds
    }, { render: false });
    await _setStatus(actor, DEATH_STATUSES.down.id, false);
    if (!success)
    {
        console.info("tinyd6 | death << save FAIL, rounds:", { rounds, tier: deathTickTier(rounds) });
        await _setStatus(actor, DEATH_STATUSES.dying.id, true);
        // Подсветка токена по ступени оставшихся раундов (5+ → край, и т.д.).
        broadcastDeathFx(actor.id, deathTickTier(rounds));
    }
    else
    {
        console.info("tinyd6 | death << save SUCCESS (stabilized)");
    }

    const speaker = ChatMessage.getSpeaker({ actor });
    await ChatMessage.create({
        speaker,
        flavor: game.i18n.localize("tinyd6.death.thrown") + " - " + game.i18n.localize("tinyd6.death.self"),
        content: success
            ? `<div class="tinyd6 death-mini stable"><span class="death-mini-icon"><i class="fas ${_deathRollIcon(dieFormula, roll.total)}"></i></span><div class="death-mini-body"><span class="death-mini-title">${game.i18n.localize("tinyd6.death.stabilized")}</span>${_deathSentence(actor, true)}</div></div>`
            : `<div class="tinyd6 death-mini dying"><span class="death-mini-icon"><i class="fas ${_deathRollIcon(dieFormula, roll.total)}"></i></span><div class="death-mini-body"><span class="death-mini-title">${game.i18n.localize("tinyd6.death.dying")}</span>${_deathSentence(actor, false, rounds)}</div></div>`,
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
        console.info("tinyd6 | death << tickDeathTimers", { actor: actor.id, name: actor.name, left, next, tier: deathTickTier(left) });
        // Начало хода умирающего: тревожный тик (слышат все) + списание раунда.
        broadcastDeathTick(deathTickTier(left));
        await actor.update({ "system.death.roundsLeft": next }, { render: false });
        // Стадия подсветки токена обновляется под новый остаток раундов.
        broadcastDeathFx(actor.id, deathTickTier(next));
        const text = game.i18n.format("tinyd6.death.turnsLeft", { actor: actor.name, n: next, word: turnsWord(next) });
        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="tinyd6 death-stub death-timer">${text}</div>`
        });
    }
    else
    {
        // Время вышло - персонаж умирает: системный статус смерти.
        await actor.update({
            "system.death.dying": false,
            "system.death.dead": true,
            "system.death.roundsLeft": 0
        }, { render: false });
        await _setStatus(actor, DEATH_STATUSES.dying.id, false);
        await _setStatus(actor, DEATH_STATUSES.dead.id, true);
        ChatMessage.create({
            speaker: ChatMessage.getSpeaker({ actor }),
            content: `<div class="tinyd6 death-stub death-timer death-died"><b>${actor.name}</b> ${game.i18n.localize("tinyd6.death.died")}</div>`
        });
        // Токен умер: эффект умирания НЕ снимаем - кровавые фильтры
        // остаются на токене, сверху накладывается тёмный тинт «умер»
        // (deathFx.js сам замораживает пульс у мёртвых). Снимется эффект
        // только при лечении/стабилизации.
        broadcastDeathSound();
        // Уведомление: GM видит всегда, игрок - за своего персонажа.
        if (game.user.isGM || Boolean(actor?.isOwner))
        {
            ui.notifications.warn(game.i18n.format("tinyd6.death.diedNotify", { actor: actor.name }));
        }
    }
}

/* ============================================================
   Звук смерти. Управляется мировой настройкой enableDeathSound
   (мастер-выключатель). Если задан файл deathSoundFile - играем
   его через game.audio (Foundry сам поддержит любой формат:
   mp3/ogg/wav/webm/m4a/flac и т.п.); иначе - синтезированный
   мрачный аккорд через Web Audio (G4→Eb4→A3→F3). Рассылается
   всем клиентам по socket, чтобы смерть услышала вся группа.
   Громкость регулируется настройкой deathSoundVolume (0.05-1,
   по умолчанию 0.5) и применяется и к файлу, и к синтезу - чтобы
   даже без кастомного файла звук не был оглушающим.
   ============================================================ */
let _deathAudioCtx = null;

/* Активный звук смерти/тика: каждый новый звук жёстко останавливает
 * предыдущий, чтобы длинные файлы не наслаивались друг на друга. */
let _deathAudioCurrent = null;   // текущий файловый Sound (если играли файл)
let _deathAudioSeq = 0;          // счётчик - защита от гонки загрузки
const _deathSynthNodes = new Set(); // активные синтезированные узлы

/* Резко останавливает текущий звук смерти/тика (файл и синтез). */
function _stopDeathAudio() {
    _deathAudioSeq++;
    if (_deathAudioCurrent)
    {
        try { _deathAudioCurrent.stop(); } catch (err) { /* ignore */ }
        _deathAudioCurrent = null;
    }
    for (const node of Array.from(_deathSynthNodes))
    {
        try { node.stop(); } catch (err) { /* ignore */ }
        _deathSynthNodes.delete(node);
    }
}

/* Громкость звука смерти: настройка мира deathSoundVolume. */
function _deathSoundVolume() {
    const v = Number(game.settings.get('tinyd6v14', 'deathSoundVolume'));
    if (Number.isNaN(v)) return 0.5;
    return Math.max(0.05, Math.min(1, v));
}

export function playDeathSoundLocal() {
    try {
        if (!game.settings.get('tinyd6v14', 'enableDeathSound')) return;
        _stopDeathAudio(); // с началом нового звука старый резко умолкает

        const file = String(game.settings.get('tinyd6v14', 'deathSoundFile') || "").trim();
        if (file)
        {
            if (!game.audio) return;
            const seq = ++_deathAudioSeq;
            const p = game.audio.play(file, { context: game.audio.interface, volume: _deathSoundVolume(), loop: false });
            if (p && typeof p.then === "function")
            {
                p.then(sound => {
                    if (seq !== _deathAudioSeq) { try { sound.stop(); } catch (err) { /* ignore */ } return; }
                    _deathAudioCurrent = sound;
                }).catch(() => {});
            }
            return;
        }

        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return;
        if (!_deathAudioCtx) _deathAudioCtx = new AudioCtor();
        const ctx = _deathAudioCtx;
        if (ctx.state === "suspended") ctx.resume();
        const now = ctx.currentTime;
        const motif = [392, 311, 233, 174]; // G4 → Eb4 → A3 → F3
        const peak = 0.22 * _deathSoundVolume();
        motif.forEach((freq, i) => {
            const t = now + i * 0.28;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, t);
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(peak, t + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
            osc.connect(gain).connect(ctx.destination);
            osc.addEventListener("ended", () => { _deathSynthNodes.delete(osc); });
            _deathSynthNodes.add(osc);
            osc.start(t);
            osc.stop(t + 0.3);
        });
    } catch (err) { /* звук не критичен - молча */ }
}

/* Играет звук смерти локально и рассылает остальным клиентам. */
export function broadcastDeathSound() {
    try { playDeathSoundLocal(); } catch (err) { /* ignore */ }
    try {
        registerSystemSocket()?.executeForOthers("playDeathSound");
    } catch (err) {
        console.warn("tinyd6 | broadcastDeathSound failed:", err);
    }
}

/* Применяет оверлей умирания локально и рассылает остальным клиентам
 * (tier: 1-3 ступень подсветки токена, 0 - убрать). */
export function broadcastDeathFx(actorId, tier = 0) {
    if (!actorId) return;
    const sceneId = game.canvas?.scene?.id ?? null;
    console.info("tinyd6 | FX << broadcastDeathFx", { actorId, tier, sceneId });
    try { applyDeathFx({ actorId, tier, sceneId }); }
    catch (err) { console.warn("tinyd6 | FX local apply error:", err); }
    try {
        registerSystemSocket()?.executeForOthers("setDeathFx", { actorId, tier, sceneId });
    } catch (err) {
        console.warn("tinyd6 | broadcastDeathFx failed:", err);
    }
}

/* ============================================================
   Тревожный «тик» смерти.
   Проигрывается ОДИН раз - в начале хода умирающего персонажа,
   когда тикает его счётчик смерти - и его слышат все клиенты
   (рассылка через socket от инициатора - GM). Три ступени
   по остатку раундов (до тика текущего хода):
     5+ → медленный, спокойный тик (ниже и тише)
     3-4 → середина
     1-2 → резкий (выше и громче + сдвоенный «тик-так»)
   Звук синтезируется Web Audio - файлы не нужны. Мастер-
   выключатель: enableDeathTicks (мир).
   ============================================================ */

/* Ступень тика (1..3) по остатку раундов. */
export function deathTickTier(left) {
    const n = Math.max(0, Math.ceil(Number(left) || 0));
    if (n >= 5) return 3;
    if (n >= 3) return 2;
    return 1;
}

/* Один «тик» нужной ступени. Если задан кастомный файл deathTickFile -
 * играем его с громкостью по ступени (тихо на 5+, громче к смерти);
 * иначе - синтезированный короткий клик Web Audio (чем выше ступень,
 * тем выше тон и громче). */
export function playDeathTickLocal(tier = 1) {
    try {
        if (!game.settings.get('tinyd6v14', 'enableDeathTicks')) return;
        _stopDeathAudio(); // с началом нового тика старый звук резко умолкает

        const file = String(game.settings.get('tinyd6v14', 'deathTickFile') || "").trim();
        if (file)
        {
            if (!game.audio) return;
            const volume = tier <= 1 ? 0.9 : tier === 2 ? 0.5 : 0.2; // 5+ тихо → 1-2 громко
            const seq = ++_deathAudioSeq;
            const p = game.audio.play(file, { context: game.audio.interface, volume, loop: false });
            if (p && typeof p.then === "function")
            {
                p.then(sound => {
                    if (seq !== _deathAudioSeq) { try { sound.stop(); } catch (err) { /* ignore */ } return; }
                    _deathAudioCurrent = sound;
                }).catch(() => {});
            }
            return;
        }

        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return;
        if (!_deathAudioCtx) _deathAudioCtx = new AudioCtor();
        const ctx = _deathAudioCtx;
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        if (ctx.state !== "running") return;

        const urgency = tier <= 1 ? 1 : tier === 2 ? 0.6 : 0.3;
        const now = ctx.currentTime;
        const baseFreq = 1700 + urgency * 1000;

        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(baseFreq, now);
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.55, now + 0.06);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.1 + urgency * 0.14, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
        osc.connect(gain).connect(ctx.destination);
        osc.addEventListener("ended", () => { _deathSynthNodes.delete(osc); });
        _deathSynthNodes.add(osc);
        osc.start(now);
        osc.stop(now + 0.09);

        if (urgency >= 0.6) // ступень 1-2 - сдвоенный удар «тик-так»
        {
            const t2 = now + 0.13;
            const osc2 = ctx.createOscillator();
            const gain2 = ctx.createGain();
            osc2.type = "sine";
            osc2.frequency.setValueAtTime(baseFreq * 0.72, t2);
            gain2.gain.setValueAtTime(0.0001, t2);
            gain2.gain.exponentialRampToValueAtTime(0.09 + urgency * 0.08, t2 + 0.006);
            gain2.gain.exponentialRampToValueAtTime(0.0001, t2 + 0.05);
            osc2.connect(gain2).connect(ctx.destination);
            osc2.addEventListener("ended", () => { _deathSynthNodes.delete(osc2); });
            _deathSynthNodes.add(osc2);
            osc2.start(t2);
            osc2.stop(t2 + 0.06);
        }
    } catch (err) { /* звук не критичен - молча */ }
}

/* Играет тик локально и рассылает остальным клиентам. */
export function broadcastDeathTick(tier = 1) {
    try { playDeathTickLocal(tier); } catch (err) { /* ignore */ }
    try {
        registerSystemSocket()?.executeForOthers("playDeathTick", tier);
    } catch (err) {
        console.warn("tinyd6 | broadcastDeathTick failed:", err);
    }
}

/* ============================================================
   Стабилизация (Homerule: TinyD6+ / кнопка «Стабилизировать»)
   ============================================================
   Персонаж с 0 HP пытается стабилизироваться: кидается спасбросок против
   deathSaveThreshold (по умолчанию 4). Режим броска - как у атаки:
   Помеха (1 куб) / Стандарт (2 куба) / Преимущество (3 куба).
   Успех (хотя бы один куб >= порога) - стабилизирован: dying снимается,
   счётчик сбрасывается, «Поражён» остаётся. Провал - Dying
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
        content: `<p><b>${name}</b> - ${game.i18n.localize("tinyd6.stabilize.subtitle")}</p>`,
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
 * Успех - хотя бы один куб >= порога. При успехе стабилизирует цель и
 * пишет карточку в чат. Возвращает { success, roll }. */
export async function rollStabilize(stabilizer, target, dice = 2) {
    if (!stabilizer || !target?.actor) return null;
    const actor = target.actor;
    if (stabilizer?.id === actor.id) return null;
    if (!game.settings.get('tinyd6v14', 'enableTinyD6Plus')) return null;
    const stabProxy = game.settings.get('tinyd6v14', 'enableHealStabProxy');

    // Стабилизация тратит 1 действие стабилизирующего.
    const actions = parseInt(stabilizer.system?.actions?.value ?? 0) || 0;
    if (actions <= 0)
    {
        ui.notifications.warn(game.i18n.localize("tinyd6.movement.noActions"));
        return null;
    }

    const threshold = Number(game.settings.get('tinyd6v14', 'deathSaveThreshold')) || 4;
    const roll = await new Roll(`${dice}d6cs>=${threshold}`, {}).evaluate();
    const success = roll.total >= 1;
    const results = roll.dice?.[0]?.results?.map(r => r.result) ?? [];
    const faces = results.map(r => _dieFace(r));
    await stabilizer.update({ "system.actions.value": actions - 1 }, { render: false });

    // Цель чужая и у игрока нет прав - применяем через GM-прокси (socketlib),
    // если включена настройка enableHealStabProxy. Иначе - fallback на карточку.
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
        await _setStatus(actor, DEATH_STATUSES.dying.id, false);
        broadcastDeathFx(actor.id, 0);
    }

    const speaker = ChatMessage.getSpeaker({ actor: stabilizer });
    const flavor = `${game.i18n.localize("tinyd6.stabilize.thrown")} - ${game.i18n.localize("tinyd6.stabilize.target")} ${actor.name}`;
    const facesHtml = faces.map(f => `<span class="death-mini-icon mini"><i class="fas ${f}"></i></span>`).join("");
    const failRounds = Number(actor.system?.death?.roundsLeft) || 3;
    const rollsHtml = facesHtml ? `<div class="death-mini-rolls">${facesHtml}</div>` : "";
    const content = success
        ? `<div class="tinyd6 death-mini stable"><div class="death-mini-icon">${iconSvg("kit-medical")}</div><div class="death-mini-body">${_deathSentence(actor, true)}${rollsHtml}</div></div>`
        : `<div class="tinyd6 death-mini dying"><div class="death-mini-icon">${iconSvg("skull-crossbones")}</div><div class="death-mini-body">${_deathSentence(actor, false, failRounds)}${rollsHtml}</div></div>`;

    await ChatMessage.create({
        speaker,
        flavor,
        content,
        rolls: [roll]
    });
    return { success, roll };
}

/* Может ли текущий пользователь менять актёра (GM всегда, игрок - только своих). */
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
    const flavor = `${game.i18n.localize("tinyd6.stabilize.thrown")} - ${game.i18n.localize("tinyd6.stabilize.target")} ${actor.name}`;

    const facesHtml = faces.map(f => `<span class="death-mini-icon mini"><i class="fas ${f}"></i></span>`).join("");
    const content = `<div class="tinyd6 death-mini stab-confirm ${success ? "stable" : "dying"}"
        data-stab-target='${_stabJsonAttr(_extractTokenRefStab(target))}'
        data-stab-success="${success ? "true" : "false"}">
        <div class="death-mini-body">
            <span class="death-mini-title">${success ? game.i18n.localize("tinyd6.stabilize.success") : game.i18n.localize("tinyd6.stabilize.fail")}</span>
            <span class="death-mini-sub"><b>${stabilizer.name}</b> → <b>${actor.name}</b></span>
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
        await _setStatus(actor, DEATH_STATUSES.dying.id, false);
        broadcastDeathFx(actor.id, 0);
    }

    const speaker = ChatMessage.getSpeaker({ actor });
    const flavor = game.i18n.localize("tinyd6.stabilize.thrown");
    const failRounds = Number(actor.system?.death?.roundsLeft) || 3;
    const content = success
        ? `<div class="tinyd6 death-mini stable"><div class="death-mini-icon">${iconSvg("kit-medical")}</div><div class="death-mini-body">${_deathSentence(actor, true)}</div></div>`
        : `<div class="tinyd6 death-mini dying"><div class="death-mini-icon">${iconSvg("skull-crossbones")}</div><div class="death-mini-body">${_deathSentence(actor, false, failRounds)}</div></div>`;

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