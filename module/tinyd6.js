import { registerGameSettings } from "./settings.js";
import { tinyd6 } from "./config.js";
import TinyD6ItemSheet from "./sheets/TinyD6ItemSheet.js";
import TinyD6HeroSheet from "./sheets/TinyD6HeroSheet.js";
import TinyD6NpcSheet from "./sheets/TinyD6NpcSheet.js";
import TinyD6TokenHUD from "./applications/TinyD6TokenHUD.js";
import DieRoller from "./applications/DieRoller.js";
import * as Dice from "./helpers/dice.js";
import { registerDeathStatusEffects, handleZeroHp, clearDeathState, tickDeathTimers } from "./helpers/death.js";

export class TinyD6System {
    static SYSTEM = "tinyd6v14";
    static SOCKET = "system.tinyd6v14";

    static init() {
        console.log("tinyd6 | Initializing Tiny D6 system");

        CONFIG.tinyd6 = tinyd6;
        // CONFIG.debug.hooks = true;
    
        Actors.unregisterSheet("core", ActorSheet);
        Actors.registerSheet(TinyD6System.SYSTEM, TinyD6HeroSheet, { makeDefault: true, types: ["hero"] });
        Actors.registerSheet(TinyD6System.SYSTEM, TinyD6NpcSheet, { types: ["npc"] });
    
        Items.unregisterSheet("core", ItemSheet);
        Items.registerSheet(TinyD6System.SYSTEM, TinyD6ItemSheet, { makeDefault: true });

        CONFIG.Token.hudClass = TinyD6TokenHUD;

        registerGameSettings();
        this._preloadHandlebarsTemplates();
        registerDeathStatusEffects();
    
        Handlebars.registerHelper("times", function(n, content)
        {
            let result = "";
            for (let i = 0; i < n; ++i)
            {
                result += content.fn(i);
            }
    
            return result;
        });
    
        Handlebars.registerHelper("face", Dice.diceToFaces);

        this._patchTokenBarAttributes();
    }

    /* Переопределение getBarAttribute для токена: принудительно показываем
     * полосы атрибутов в HUD токена (Bar 1 = HP, Bar 2 = уровень порчи у
     * героев). Если в Token Config вручную задан явный атрибут — уважаем его.
     * Bar 2 для NPC отсутствует (нет поля corruptionThreshold) и скрывается. */
    /* Настройка полос токена: Bar 1 = HP, Bar 2 = уровень порчи у героев.
     * Вместо монки-патча прототипа переопределяем поведение через чистую
     * подмену в CONFIG: core-метод не трогаем, а система задаёт атрибуты
     * через primaryTokenAttribute/secondaryTokenAttribute (в system.json).
     * Здесь же переопределяем getBarAttribute так, чтобы уважать явный
     * выбор атрибута в Token Config и скрывать Bar 2 у NPC. */
    static _patchTokenBarAttributes() {
        const TokenClass = CONFIG.Token.documentClass;

        // Если системные атрибуты уже заданы корректно — патч не нужен.
        // Проверяем только, что core-метод не переопределён нами ранее.
        if (TokenClass.prototype._tdBarPatched) return;
        TokenClass.prototype._tdBarPatched = true;

        TokenClass.prototype.getBarAttribute = function(barName, { alternative } = {}) {
            const explicit = alternative || this[barName]?.attribute;
            let attribute = explicit;
            if ( !attribute || (attribute === "null") || (attribute === "") ) {
                attribute = (barName === "bar1") ? "wounds"
                    : (this.actor?.type === "hero" ? "corruptionThreshold" : null);
            }
            if ( !attribute || !this.actor ) return null;

            const system = this.actor.system;
            const data = foundry.utils.getProperty(system, attribute);
            if ( (data === null) || (data === undefined) ) return null;

            const editable = this.actor.isOwner;
            if ( Number.isNumeric(data) ) {
                return { type: "value", attribute, value: Number(data), editable };
            }
            if ( ("value" in data) && ("max" in data) ) {
                return {
                    type: "bar",
                    attribute,
                    value: parseInt(data.value || 0),
                    max: parseInt(data.max || 0),
                    editable
                };
            }
            return null;
        };

        // PrototypeToken унаследовал ссылку на исходный getBarAttribute,
        // обновим и его, чтобы полосы отображались и в превью Token Config.
        const PrototypeClass = CONFIG.Token.prototypeClass;
        if ( PrototypeClass && (PrototypeClass !== TokenClass) ) {
            PrototypeClass.prototype.getBarAttribute = TokenClass.prototype.getBarAttribute;
        }
    }

    static ready() {
        console.log("tinyd6 | ready");
        //game.socket.on(TinyD6System.SOCKET, TinyD6System.onMessage);
        TinyD6System.displayFloatingDieRollerApplication();

        // Применяем выключатель анимаций к текущему клиенту при старте.
        const animFx = game.settings.get('tinyd6v14', 'animFx');
        document.body.classList.toggle("td-no-fx", animFx === false);
        // CONFIG.statusEffects перезаписывается при setup — повторно
        // регистрируем статусы смерти на ready, чтобы токены их видели.
        registerDeathStatusEffects();

        // Тематизация чат-карточек: вешаем текущий sheetStyle на сообщение,
        // чтобы внешние карточки (бросок/атака/предмет) брали палитру темы.
        Hooks.on("renderChatMessage", (message, html) => {
            if (!html.find(".tinyd6").length) return;
            const sheetStyle = game.settings.get(TinyD6System.SYSTEM, "sheetStyle");
            html.addClass(sheetStyle);
        });
    }

    static async displayFloatingDieRollerApplication() {
        new DieRoller(DieRoller.defaultOptions, { excludeTextLabels: true }).render(true);
    }
    
    static async _preloadHandlebarsTemplates() {
        const templatePaths = [
            "systems/tinyd6v14/templates/partials/trait-block.hbs",
            "systems/tinyd6v14/templates/partials/roll-bar.hbs",
            "systems/tinyd6v14/templates/partials/item-header.hbs",
            "systems/tinyd6v14/templates/partials/inventory-card.hbs",
            "systems/tinyd6v14/templates/partials/item-card.hbs",
            "systems/tinyd6v14/templates/partials/attack-card.hbs",
            "systems/tinyd6v14/templates/partials/action-tracker.hbs"
        ];
    
        return loadTemplates(templatePaths);
    }

    static emit(action, args = {}) {
        console.log(action, TinyD6System.SOCKET);
        args.action = action;
        args.senderId = game.user.id;
        game.socket.emit(TinyD6System.SOCKET, args, (resp) => { console.log(resp); });
    }

    static onMessage(data) {
        switch (data.action) {
            case 'dieRoll': {
                Dice.RollTest(data);
            } 
            break;
        }
    }
}

Hooks.once("init", () => {
    TinyD6System.init();
});

Hooks.on("ready", TinyD6System.ready);

/* Токены на сцене: NPC — независимые копии (unlinked), герои — связаны
 * со своим актёром (linked). Для NPC, если включена настройка
 * independentNpcTokens, каждый токен получает свой ActorDelta (свои
 * HP/армор) и не связан с шаблоном в директории. Героев наоборот
 * принудительно связываем с их sheet. */
Hooks.on("preCreateToken", (document, data, options, userId) => {
    const actorId = document.actorId ?? data.actorId;
    if (!actorId) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;

    if (actor.type === "hero")
    {
        if (!document.actorLink) document.updateSource({ actorLink: true });
        return;
    }

    if (actor.type === "npc")
    {
        // Homerule: Important NPC — токен важного NPC связан с актёром,
        // чтобы открывался полный лист актёра (приоритет над независимостью).
        if (actor.system?.important)
        {
            document.updateSource({ actorLink: true });
            return;
        }
        if (!game.settings.get(TinyD6System.SYSTEM, "independentNpcTokens")) return;
        if (!document.actorLink) return;
        document.updateSource({ actorLink: false });
    }
});

/* При создании актёра задаём максимум действий из настройки мира
 * (сток = 1 по правилам Tiny D6; гомерул задаёт своё значение). */
Hooks.on("preCreateActor", (document, data, options, userId) => {
    if (document.type !== "hero" && document.type !== "npc") return;
    const def = Number(game.settings.get(TinyD6System.SYSTEM, "defaultActions"));
    if (Number.isNaN(def) || def < 0) return;
    if (foundry.utils.getProperty(document, "system.actions.max") !== undefined) return;
    document.updateSource({ "system.actions": { value: def, max: def } });
});

/* При изменении максимального HP (wounds.max) текущее HP не должно
 * превышать новое значение максимума. Аналогично для действий. */
Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
    const newMax = foundry.utils.getProperty(changes, "system.wounds.max");
    if (newMax !== undefined)
    {
        const max = Number(newMax);
        if (!Number.isNaN(max))
        {
            const currentValue = Number(actor.system?.wounds?.value) || 0;
            if (currentValue > max) {
                foundry.utils.setProperty(changes, "system.wounds.value", max);
            }
        }
    }

    const newActionMax = foundry.utils.getProperty(changes, "system.actions.max");
    if (newActionMax !== undefined)
    {
        const amax = Number(newActionMax);
        if (!Number.isNaN(amax))
        {
            const currentValue = Number(actor.system?.actions?.value) || 0;
            if (currentValue > amax) {
                foundry.utils.setProperty(changes, "system.actions.value", amax);
            }
        }
    }
});

/* Homerule: TinyD6+ — при изменении Uses (или включении Reload) у оружия
 * синхронизируем текущее число зарядов, чтобы они не расходились с максимумом. */
Hooks.on("preUpdateItem", (item, changes, options, userId) => {
    if (item.type !== "weapon") return;
    const newUses = foundry.utils.getProperty(changes, "system.uses");
    const newReload = foundry.utils.getProperty(changes, "system.reload");
    if (newUses === undefined && newReload === undefined) return;

    const uses = newUses !== undefined ? Number(newUses) : Number(item.system.uses) || 0;
    const current = Number(item.system.charges) ?? uses;
    if (current > uses) {
        foundry.utils.setProperty(changes, "system.charges", uses);
    }
});

/* Homerule: TinyD6+ / 0 HP — отслеживаем переход HP в 0 и обратно.
 * Храним предыдущее HP актёра, чтобы сработать только на реальном переходе
 * (не на повторном 0 → 0), и только если тима смерти включена. */
const PREV_WOUNDS = new Map();
Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
    if (userId !== game.user.id) return;
    if (foundry.utils.getProperty(changes, "system.wounds.value") !== undefined) {
        PREV_WOUNDS.set(actor.id, Number(actor.system?.wounds?.value) || 0);
    }
});

/* Homerule: TinyD6+ tint — слегка затемняем токен только по финальным статусам
 * смерти: tinyd6Down («выведен из строя», обычные НПС) и tinyd6Dead («мёртв»,
 * герои и важные НПС). Промежуточные unconscious/dying не затемняют, чтобы
 * герой не темнел раньше времени (в момент обнуления HP). Оригинальный тинт
 * храним во флаге tinyd6v14.deathTint, чтобы вернуть его при снятии статуса
 * даже после перезагрузки клиента. */
const DEATH_TINT_COLOR = "#7d8287";
const DEATH_FLAG = "deathTint";
const DEATH_STATUS_IDS = ["tinyd6Down", "tinyd6Dead"];

/* Находит токен для актёра: по явному tokenId (зарегистрированному атакой),
 * либо по совпадению экземпляра; только если копия с таким actor.id одна. */
function _findTokenForActor(actor, tokenId) {
    const scene = game.canvas?.scene;
    if (!scene || !canvas.tokens) return null;
    if (tokenId) return canvas.tokens.get(tokenId) ?? null;
    const list = canvas.tokens.placeables;
    let match = list.find(t => t.actor === actor) ?? null;
    if (!match) {
        const byId = list.filter(t => t.actor?.id === actor?.id);
        if (byId.length === 1) match = byId[0];
    }
    return match;
}

async function _setDeathTint(doc) {
    try {
        if (!doc) return;
        if (doc.getFlag(TinyD6System.SYSTEM, DEATH_FLAG)) return;
        const prev = foundry.utils.getProperty(doc, "texture.tint") ?? "#ffffff";
        await doc.setFlag(TinyD6System.SYSTEM, DEATH_FLAG, prev);
        await doc.update({ texture: { tint: DEATH_TINT_COLOR } }, { render: false });
    } catch (err) {
        console.warn("tinyd6 | death tint set skipped:", err);
    }
}

async function _restoreDeathTint(doc) {
    try {
        if (!doc) return;
        if (!doc.getFlag(TinyD6System.SYSTEM, DEATH_FLAG)) return;
        const prev = doc.getFlag(TinyD6System.SYSTEM, DEATH_FLAG);
        await doc.unsetFlag(TinyD6System.SYSTEM, DEATH_FLAG);
        await doc.update({ texture: { tint: prev } }, { render: false });
    } catch (err) {
        console.warn("tinyd6 | death tint restore skipped:", err);
    }
}

/* Приводит тинт одного токена к текущему состоянию статусов его актёра. */
function _syncDeathTint(token) {
    const doc = token.document ?? token;
    if (!doc || !doc.actor) return;
    const downed = DEATH_STATUS_IDS.some(id => doc.actor.statuses?.has(id));
    if (downed) return _setDeathTint(doc);
    return _restoreDeathTint(doc);
}

/* Синхронизирует тинты всех токенов активной сцены. Вызывается при изменении
 * статус-эффекта (создание/удаление/обновление) и при загрузке сцены. */
function _syncSceneDeathTints() {
    const scene = game.canvas?.scene;
    if (!scene) return;
    for (const token of scene.tokens) _syncDeathTint(token);
}

/* Статус-эффект смерти (statuses — Set id-шников статусов активного эффекта). */
function _onDeathStatusEffectChange(effect) {
    if (!effect?.statuses?.size) return;
    if (!DEATH_STATUS_IDS.some(id => effect.statuses.has(id))) return;
    if (!game.user.isGM) return;
    _syncSceneDeathTints();
}

Hooks.on("createActiveEffect", _onDeathStatusEffectChange);
Hooks.on("deleteActiveEffect", _onDeathStatusEffectChange);
Hooks.on("updateActiveEffect", _onDeathStatusEffectChange);
Hooks.on("canvasReady", () => { if (game.user.isGM) _syncSceneDeathTints(); });

Hooks.on("updateActor", async (actor, changes, options, userId) => {
    if (userId !== game.user.id) return;
    if (actor.type !== "hero" && actor.type !== "npc") return;
    const newValuePath = foundry.utils.getProperty(changes, "system.wounds.value");
    if (newValuePath !== undefined)
    {
        const prev = PREV_WOUNDS.has(actor.id) ? PREV_WOUNDS.get(actor.id) : Number(actor.system?.wounds?.value) || 0;
        PREV_WOUNDS.delete(actor.id);
        const newValue = Number(actor.system?.wounds?.value) || 0;

        // HP упал в 0 (с положительного) → смерть/выведение из строя.
        // HP снова больше 0 → снимаем состояние смерти.
        const deathEntered = prev > 0 && newValue <= 0;
        const deathCleared = prev <= 0 && newValue > 0;

        // Всплывающее число урона/лечения над токеном при изменении HP.
        // Если атака зарегистрировала конкретного токена-цель (applyAttackDamage
        // вызвал _setPendingFloat) — показываем число только над ним, чтобы
        // для unlinked NPC-копий не всплывало над всеми сразу.
        const pending = Dice._takePendingFloat(actor.id);
        const delta = newValue - prev;
        if (delta !== 0)
        {
            const type = delta < 0 ? "dmg" : "heal";
            const sign = delta < 0 ? "" : "+";
            if (pending?.tokenId)
            {
                const tok = game.canvas?.scene ? canvas.tokens.get(pending.tokenId) ?? null : null;
                if (tok)
                {
                    Dice.spawnFloatingNumber(tok, actor, `${sign}${delta}`, type);
                    Dice.spawnTokenFlash(tok, type);
                }
            }
            else
            {
                Dice.spawnFloatingNumber(null, actor, `${sign}${delta}`, type);
            }
        }

        if (deathEntered) {
            const tok = _findTokenForActor(actor, pending?.tokenId);
            if (tok) Dice.spawnTokenDeath(tok);
            await handleZeroHp(actor);
            return;
        }
        if (deathCleared) {
            await clearDeathState(actor);
        }
    }

    // Homerule: Important NPC — токен важного NPC связан с актёром
    // (открывает полный лист актёра). Переключаем actorLink на всех токенах.
    if (actor.type === "npc" && foundry.utils.getProperty(changes, "system.important") !== undefined)
    {
        const important = Boolean(actor.system?.important);
        for (const scene of game.scenes)
        {
            for (const token of scene.tokens)
            {
                if (token.actorId !== actor.id) continue;
                if (token.actorLink === important) continue;
                await token.update({ actorLink: important });
            }
        }
    }
});

/* Homerule: TinyD6+ — тикает таймер смерти на начало хода поверженного
 * персонажа (смена активного бойца). Только на клиенте GM. */
Hooks.on("updateCombat", (combat, changes, options, userId) => {
    if (!game.user.isGM) return;
    if (!combat.active) return;
    if (changes?.turn === undefined) return;
    tickDeathTimers(combat);
});

/* Homerule: TinyD6+ — после изменения зарядов оружия (выстрел с токена,
 * возврат ресурса, перезарядка) синхронизируем открытый лист актёра и HUD,
 * чтобы счётчик не расходился с данными. render(false) не пересоздаёт окно,
 * поэтому мерцания нет. */
Hooks.on("updateItem", (item, changes, options, userId) => {
    if (item.type !== "weapon") return;
    if (foundry.utils.getProperty(changes, "system.charges") === undefined) return;

    const actor = item.actor;
    if (actor?.sheet?.rendered) actor.sheet.render(false);

    const hud = game.canvas?.hud?.token;
    if (hud?.rendered && hud.document?.actor?.id === actor?.id) hud.render();

    // «Прыжок» счётчика зарядов при выстреле/перезарядке (анимация .bump).
    if (actor?.sheet?.rendered && actor.sheet.element)
    {
        const charges = actor.sheet.element.find(".weapon-charges");
        if (charges.length)
        {
            charges.addClass("bump");
            setTimeout(() => charges.removeClass("bump"), 400);
        }
    }
});

Hooks.on("createItem", (item, temporary) => {
    console.log("tinyd6 | handling owned item");

    console.log("ACTOR:", item.actor);
    console.log("ITEM:", item);

    if (item.actor && item.type === "heritage")
    {
        const others = item.actor.items.filter(i => i.type === "heritage" && i.id !== item.id);
        if (others.length)
        {
            item.actor.deleteEmbeddedDocuments("Item", others.map(i => i.id));
        }

        item.actor.update({
            "system.wounds.value": item.system.startingHealth,
            "system.wounds.max": item.system.startingHealth,
            "system.corruptionThreshold.value": 0,
            "system.corruptionThreshold.max": item.system.corruptionThreshold
        });
    }
});

/* Homerule: Armor HP — при изменении брони (HP/DR/экипировка) синхронизируем
 * открытый лист актёра и HUD токена, чтобы суммарные значения DR/HP брони
 * не расходились с данными. Покрывает как героев, так и важных NPC
 * (link-токены открывают полный лист). render(false) не пересоздаёт окно. */
Hooks.on("updateItem", (item, changes, options, userId) => {
    if (item.type !== "armor") return;
    const armorKeys = ["system.armorHp", "system.armorHp.value", "system.armorHp.max", "system.damageReduction", "system.equipped"];
    if (!armorKeys.some(k => foundry.utils.getProperty(changes, k) !== undefined)) return;

    const actor = item.actor;
    if (actor?.sheet?.rendered) actor.sheet.render(false);

    const hud = game.canvas?.hud?.token;
    if (hud?.rendered && hud.document?.actor?.id === actor?.id) hud.render();
});

Hooks.on("renderChatLog", (chatLog, html) => {
    const log = html instanceof HTMLElement ? html : html[0] || html;
    log.addEventListener("click", async (event) => {
        // Кнопка «Вернуть ресурс»: откат случайно потраченного заряда оружия.
        const undo = event.target.closest(".attack-undo");
        if (undo)
        {
            event.preventDefault();
            const card = undo.closest(".attack-card");
            if (!card) return;

            // Атакующий: для unlinked NPC-токена актёр находится через токен сцены.
            let actor = null;
            let attackerRef = null;
            try { attackerRef = JSON.parse(card.dataset.attackerToken || "null"); } catch (err) { attackerRef = null; }
            if (attackerRef && attackerRef.tokenId)
            {
                const scene = game.scenes.get(attackerRef.sceneId);
                actor = scene?.tokens.get(attackerRef.tokenId)?.actor ?? null;
            }
            if (!actor)
            {
                const actorId = card.dataset.actorId;
                actor = actorId ? game.actors.get(actorId) : null;
            }

            const weaponId = undo.dataset.weaponId;
            const weapon = actor?.items?.get(weaponId);
            if (!actor || !weapon) return;

            const max = Number(weapon.system.uses) || 0;
            const current = (weapon.system.charges !== undefined && weapon.system.charges !== null)
                ? Number(weapon.system.charges) : max;
            await weapon.update({ "system.charges": Math.min(max, current + 1) }, { render: false });
            undo.closest(".attack-card-undo")?.remove();
            return;
        }

        const button = event.target.closest(".attack-apply");
        if (!button) return;
        event.preventDefault();
        const card = button.closest(".attack-card");
        if (!card) return;

        let targetIds = [];
        try { targetIds = JSON.parse(card.dataset.targets || "[]"); } catch (err) { targetIds = []; }
        if (!targetIds.length) return;
        const damage = Number(card.dataset.damage) || 1;
        const actorId = card.dataset.actorId;
        const isCrit = card.dataset.isCrit === "true";

        const { applied, reported } = await Dice.applyAttackDamage({ actorId, targetIds, damage, isCrit });
        if (!applied.length && !reported.length) return;

        card.querySelector(".attack-apply")?.remove();
        const footer = card.querySelector(".attack-card-footer");
        if (!footer) return;

        const parts = [];
        if (applied.length) parts.push(applied.map(u => `${u.name} -${u.damage}`).join(", "));
        if (reported.length) parts.push(reported.map(u => `${u.name} -${u.damage} (урон не списан)`).join(", "));

        const report = document.createElement("span");
        report.className = "attack-report";
        report.textContent = parts.join("; ");
        footer.appendChild(report);

        // Для чужих героев (урон не списан) — выводим отдельное сообщение в чат.
        if (reported.length)
        {
            const attackerName = card.dataset.actorName || game.actors.get(actorId)?.name || "Атака";
            await ChatMessage.create({
                speaker: ChatMessage.getSpeaker(),
                content: reported.map(u =>
                    `<div class="tinyd6 attack-report-chat"><b>${attackerName}</b> наносит <b>${u.damage}</b> урона персонажу <b>${u.name}</b> (HP не списан)</div>`
                ).join("")
            });
        }
    });
});
