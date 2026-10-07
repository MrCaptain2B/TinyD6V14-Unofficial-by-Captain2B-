import { registerGameSettings, registerWorldSettingsReload } from "./settings.js";
import { tinyd6 } from "./config.js";
import TinyD6ItemSheet from "./sheets/TinyD6ItemSheet.js";
import TinyD6HeroSheet from "./sheets/TinyD6HeroSheet.js";
import TinyD6NpcSheet from "./sheets/TinyD6NpcSheet.js";
import TinyD6TokenHUD from "./applications/TinyD6TokenHUD.js";
import TinyTokenRuler from "./canvas/TokenRuler.js";
import DieRoller from "./applications/DieRoller.js";
import * as Dice from "./helpers/dice.js";
import { registerDeathStatusEffects, handleZeroHp, clearDeathState, tickDeathTimers, applyStabilizeConfirmation } from "./helpers/death.js";
import { registerSystemSocket, broadcastFx, gmProxy } from "./helpers/socket.js";
import { initDeathFxHooks } from "./helpers/deathFx.js";
import { iconSvg } from "./helpers/icons.js";

/* Палитры тем для инлайн-покраски чат-карточек (Carolingian UI бьёт CSS -
 * красим из JS с !important). Держим синхронно с --td-* в
 * scss/theme/_td-themes.scss. */
const TINYD6_THEME_PALETTES = {
    "td-sheet-default":   { accent: "#4a52ca", accentSoft: "#6ea8fe", card: "#24242a", text: "#d7d8dc", border: "#3b3b44", field: "#2f2f36", bg: "#1b1b1f" },
    "td-sheet-minimal":   { accent: "#2e6eb0", accentSoft: "#4f7fb5", card: "#d5d5d1", text: "#27272c", border: "#b0b0aa", field: "#e4e4e0", bg: "#dedede" },
    "td-sheet-perkament": { accent: "#8b2f2f", accentSoft: "#a85a3c", card: "#ddcca6", text: "#241c0f", border: "#a08a58", field: "#e4d6b2", bg: "#cdbb92" },
    "td-sheet-noir":      { accent: "#b0773a", accentSoft: "#d3a25e", card: "#16181d", text: "#d8d8d8", border: "#2c2c34", field: "#1b1d23", bg: "#0d0e11" },
    "td-sheet-cyberpunk": { accent: "#00e5d0", accentSoft: "#ff2e88", card: "#10141b", text: "#b8e6e0", border: "#23415a", field: "#151b24", bg: "#0a0c10" }
};

export class TinyD6System {
    static SYSTEM = "tinyd6v14";

    static init() {
        console.log("tinyd6 | Initializing Tiny D6 system");

        CONFIG.tinyd6 = tinyd6;
        // CONFIG.debug.hooks = true;
    
        Actors.unregisterSheet("core", ActorSheet);
        Actors.registerSheet(TinyD6System.SYSTEM, TinyD6HeroSheet, { makeDefault: true, types: ["hero"] });
        Actors.registerSheet(TinyD6System.SYSTEM, TinyD6NpcSheet, { types: ["npc"] });
    
        Items.unregisterSheet("core", ItemSheet);
        Items.registerSheet(TinyD6System.SYSTEM, TinyD6ItemSheet, { makeDefault: true });

        // Публичный API для модулей: регистрация собственных вкладок в листах предметов.
        // Модули вызывают game.tinyd6ItemSheets.registerTab(type, { key, label, icon, render }).
        game.tinyd6ItemSheets = { registerTab: TinyD6ItemSheet.registerTab.bind(TinyD6ItemSheet) };

        CONFIG.Token.hudClass = TinyD6TokenHUD;

        // Homerule: TinyD6+ - раскраска пути токена по бюджету передвижения
        // (зелёный/жёлтый/красный). Если ядро не экспонирует TokenRuler -
        // тихо пропускаем, останется дефолтный путь Foundry.
        if (foundry?.canvas?.placeables?.tokens?.TokenRuler)
        {
            CONFIG.Token.rulerClass = TinyTokenRuler;
        }

        registerGameSettings();
        // Мировые правила меняются → перезагрузка клиента (F5), чтобы
        // новые значения гарантированно применились.
        registerWorldSettingsReload();
        this._preloadHandlebarsTemplates();
        registerDeathStatusEffects();

        // Carolingian UI и тематизация чата - регистрируем уже в init():
        // хук ready() не срабатывает, если инициализация канваса упала
        // (сломанный модуль/старый Chromium), а листы и чат тогда остаются
        // без нашей темы.
        TinyD6System._injectCarolingianCompat();
        TinyD6System._ensureUnlayeredStyles();
        Hooks.on("renderActorSheet", () => TinyD6System._injectCarolingianCompat());
        Hooks.on("renderTokenHUD", () => TinyD6System._injectCarolingianCompat());
        Hooks.on("renderChatLog", () => TinyD6System._injectCarolingianCompat());
        Hooks.on("renderChatLog", (log, html) => TinyD6System._paintCardDiceIcons(html));
        Hooks.on("renderChatMessage", (message, html) => TinyD6System._onRenderChatMessage(message, html));
        // Смена темы в настройках → сразу обновляем палитру на <body>.
        Hooks.on("updateSetting", (setting) => {
            if (setting.key === (TinyD6System.SYSTEM + ".sheetStyle")) TinyD6System._applyBodyTheme();
        });
    
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

        Handlebars.registerHelper("td6icon", (name, opts) => iconSvg?.(name, (opts && opts.hash) || {}));

        Handlebars.registerHelper("add", function(a, b) {
            return (Number(a) || 0) + (Number(b) || 0);
        });

        Handlebars.registerHelper("includes", function(arr, val) {
            return Array.isArray(arr) && arr.includes(val);
        });

        this._patchTokenBarAttributes();
    }

    /* Переопределение getBarAttribute для токена: принудительно показываем
     * полосы атрибутов в HUD токена (Bar 1 = HP, Bar 2 = уровень порчи у
     * героев). Если в Token Config вручную задан явный атрибут - уважаем его.
     * Bar 2 для NPC отсутствует (нет поля corruptionThreshold) и скрывается. */
    /* Настройка полос токена: Bar 1 = HP, Bar 2 = уровень порчи у героев.
     * Вместо монки-патча прототипа переопределяем поведение через чистую
     * подмену в CONFIG: core-метод не трогаем, а система задаёт атрибуты
     * через primaryTokenAttribute/secondaryTokenAttribute (в system.json).
     * Здесь же переопределяем getBarAttribute так, чтобы уважать явный
     * выбор атрибута в Token Config и скрывать Bar 2 у NPC. */
    static _patchTokenBarAttributes() {
        const TokenClass = CONFIG.Token.documentClass;

        // Если системные атрибуты уже заданы корректно - патч не нужен.
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
        // Производительность: гасим DEBUG-спам ядра (CONFIG.debug.hooks) -
        // какой-то из модулей в этой сборке включает его, и Foundry пишет в
        // консоль каждую регистрацию/вызов хука (тысячи строк), что сильно
        // нагружает клиент и рвёт WebGL-контекст при работе канваса.
        try { CONFIG.debug.hooks = false; } catch (err) { /* ignore */ }
        console.log("tinyd6 | ready [build 2026-09-11s]");
        registerSystemSocket();
        TinyD6System.displayFloatingDieRollerApplication();
        TinyD6System.patchCoinTexture();
        TinyD6System._migrateShieldItems();
        TinyD6System._injectCarolingianCompat();
        // Тема на <body>: чтобы чат-карточки не зависели от класса на
        // самом сообщении, а палитра наследовалась от body.
        TinyD6System._applyBodyTheme();

        // Применяем выключатель анимаций к текущему клиенту при старте.
        const animFx = game.settings.get('tinyd6v14', 'animFx');
        document.body.classList.toggle("td-no-fx", animFx === false);
        // CONFIG.statusEffects перезаписывается при setup - повторно
        // регистрируем статусы смерти на ready, чтобы токены их видели.
        registerDeathStatusEffects();
        // Подсветка токенов умирающих персонажей (хуки пана/зума/сцены).
        initDeathFxHooks();
    }

    /* Тематизация одной чат-карточки: вешаем текущий sheetStyle на
     * сообщение, чтобы карточки (бросок/атака/предмет) брали палитру темы.
     * Вынесено из ready() - хук регистрируется в init(), чтобы тематизация
     * работала даже если инициализация канваса упала. */
    static _onRenderChatMessage(message, html)
    {
        if (!html.find(".tinyd6").length) return;
        const sheetStyle = game.settings.get(TinyD6System.SYSTEM, "sheetStyle");
        html.addClass(sheetStyle);

        // Идентификатор сообщения на карточке: чтобы её синхронно
        // обновлять через ChatMessage.update() (кнопка применения урона,
        // отчёт и т.п.) - тогда Foundry перерисует сразу у всех клиентов.
        const card = html.find(".td6-attack-card, .heal-confirm, .stab-confirm").first();
        if (card.length) card.attr("data-message-id", message.id);

        // Применение урона - только GM, либо игроки, если включён
        // GM-прокси урона (enablePlayerDamageProxy). Подтверждение
        // хила/стабилизации (fallback без socket) - только GM.
        if (!game.user.isGM)
        {
            const damageProxy = game.settings.get('tinyd6v14', 'enableTinyD6Plus')
                && game.settings.get('tinyd6v14', 'enablePlayerDamageProxy');
            if (!damageProxy) html.find(".attack-apply").remove();
            // Кнопки ± урона (награда за креативную заявку) и «Откат урона» - только GM.
            html.find(".attack-damage-step").remove();
            html.find(".attack-undo-damage").remove();
            html.find(".heal-apply").remove();
            html.find(".stab-apply").remove();
        }

        // Красим иконки кубиков инлайн-стилем: Carolingian UI (Custom-тема)
        // красит напрямую каждый элемент (*, i.fas, h3…), побеждая любой
        // CSS. Инлайн-значение с !important CSS перебить не может.
        TinyD6System._paintCardDiceIcons(html);
    }

    /* Принудительная покраска чат-карточек и их иконок кубиков инлайн-стилем.
     * Carolingian UI (Custom-тема) красит напрямую каждый элемент (*, i.fas, h3…),
     * CSS ему «не противостоит». Палитру текущей темы берём из JS-карты
     * TINYD6_THEME_PALETTES (по настройке sheetStyle) и ставим цвета инлайн
     * с !important - CSS перебить не может. Заодно форсируем семейство FA7,
     * чтобы Carolingian не подменял глифы своим шрифтом. */
    static _paintCardDiceIcons(root, _followUp = false)
    {
        if (!root) return;
        // renderChatLog отдаёт сырой HTMLElement, а не jQuery - приводим
        // единообразно (упало бы на root.find).
        if (typeof root.find !== "function") root = $(root);

        let sheetStyle = "td-sheet-default";
        try
        {
            sheetStyle = game.settings.get(TinyD6System.SYSTEM, "sheetStyle") || sheetStyle;
        }
        catch (err) { /* ignore */ }

        const p = TINYD6_THEME_PALETTES[sheetStyle] || TINYD6_THEME_PALETTES["td-sheet-default"];

        // Сама карточка атаки и плашка разбора кубиков - фон/текст/бордер темы.
        root.find(".tinyd6.td6-attack-card").each((i, el) => {
            el.style.setProperty("background", p.card, "important");
            el.style.setProperty("color", p.text, "important");
            el.style.setProperty("border", "1px solid " + p.border, "important");
        });
        root.find(".tinyd6.td6-attack-card .attack-die").each((i, el) => {
            el.style.setProperty("background", p.field, "important");
            el.style.setProperty("border", "1px solid " + p.border, "important");
            el.style.setProperty("color", p.accent, "important");
        });
        root.find(".tinyd6.td6-dice-breakdown").each((i, el) => {
            el.style.setProperty("background", p.card, "important");
            el.style.setProperty("color", p.text, "important");
            el.style.setProperty("border", "1px solid " + p.border, "important");
        });

        // Сами иконки кубиков - акцент темы + семейство FA7. Берём любые
        // иконоподобные элементы внутри клетки кубика (i/span), а не только
        // фабрично отрендеренные классы: Carolingian может подменить глиф.
        const selector = [
            ".tinyd6.td6-attack-card .attack-die i.fas",
            ".tinyd6.td6-attack-card .attack-die i.fa-solid",
            ".tinyd6.td6-attack-card .attack-die span.fas",
            ".tinyd6.td6-attack-card .attack-die span.fa-solid",
            ".tinyd6.td6-attack-card .attack-die [class*='fa-dice-']",
            ".tinyd6.td6-attack-card .attack-die [class*='fa-gem-']",
            ".tinyd6.td6-dice-breakdown i.fas",
            ".tinyd6.td6-dice-breakdown i.fa-solid",
            ".tinyd6.td6-dice-breakdown span.fas",
            ".tinyd6.td6-dice-breakdown span.fa-solid",
            ".tinyd6.td6-dice-breakdown [class*='fa-dice-']",
            ".tinyd6.td6-dice-breakdown [class*='fa-shield-']"
        ].join(", ");
        root.find(selector).each((i, el) => {
            el.style.setProperty("color", p.accent, "important");
            el.style.setProperty("font-family", "var(--_fa-family, 'Font Awesome 7 Pro')", "important");
        });

        // Форс-пасс: ЛЮБОЙ потомок клетки кубика - акцент темы. Покрывает
        // svg Font Awesome (JS-режим), псевдоглифы и пересобранные
        // Carolingian'ом иконки, у которых съехали/сменились классы.
        root.find(".tinyd6.td6-attack-card .attack-die *").each((i, el) => {
            el.style.setProperty("color", p.accent, "important");
            el.style.setProperty("fill", p.accent, "important");
            el.style.setProperty("font-family", "var(--_fa-family, 'Font Awesome 7 Pro')", "important");
        });
        root.find(".tinyd6.td6-attack-card .attack-die svg path").each((i, el) => {
            el.style.setProperty("fill", p.accent, "important");
        });

        // Грани fa-dice-one..six - это фоновые SVG-картинки (не глифы FA):
        // color/fill их не красят. Перекрашиваем через alpha-mask: фон -> акцент,
        // исходная картинка -> mask-image (важна только прозрачность SVG, тёмный
        // fill внутри не мешает). Силуэт грани остаётся, цвет становится акцентным.
        const bgDieSelector = [
            ".tinyd6.td6-attack-card .attack-die [class*='fa-dice-']",
            ".tinyd6.td6-dice-breakdown [class*='fa-dice-']",
            ".tinyd6.death-mini .death-mini-rolls [class*='fa-dice-']"
        ].join(", ");
        root.find(bgDieSelector).each((i, el) => {
            const st = getComputedStyle(el);
            if (st.display === "none") return;
            const bg = st.backgroundImage;
            if (!bg || bg === "none" || !bg.startsWith("url(")) return;
            el.style.setProperty("background", p.accent, "important");
            el.style.setProperty("mask-image", bg, "important");
            el.style.setProperty("mask-size", "contain", "important");
            el.style.setProperty("mask-position", "center", "important");
            el.style.setProperty("mask-repeat", "no-repeat", "important");
            el.style.setProperty("-webkit-mask-image", bg, "important");
            el.style.setProperty("-webkit-mask-size", "contain", "important");
            el.style.setProperty("-webkit-mask-position", "center", "important");
            el.style.setProperty("-webkit-mask-repeat", "no-repeat", "important");
        });

        // Кнопки карточки атаки - по палитре темы.
        root.find(".tinyd6.td6-attack-card .attack-apply").each((i, el) => {
            el.style.setProperty("background", p.accent, "important");
            el.style.setProperty("color", "#fff", "important");
        });
        root.find(".tinyd6.td6-attack-card .attack-apply i.fas, .tinyd6.td6-attack-card .attack-apply .fa-solid, .tinyd6.td6-attack-card .attack-apply .fas").each((i, el) => {
            el.style.setProperty("color", "#fff", "important");
        });
        root.find(".tinyd6.td6-attack-card .attack-undo").each((i, el) => {
            el.style.setProperty("background", p.field, "important");
            el.style.setProperty("color", p.accent, "important");
            el.style.setProperty("border", "1px solid " + p.border, "important");
        });
        root.find(".tinyd6.td6-attack-card .attack-undo i.fas, .tinyd6.td6-attack-card .attack-undo .fa-solid, .tinyd6.td6-attack-card .attack-undo .fas").each((i, el) => {
            el.style.setProperty("color", p.accent, "important");
        });
        root.find(".tinyd6.td6-attack-card .attack-undo-damage").each((i, el) => {
            el.style.setProperty("background", p.field, "important");
            el.style.setProperty("color", p.accent, "important");
            el.style.setProperty("border", "1px solid " + p.border, "important");
        });
        root.find(".tinyd6.td6-attack-card .attack-undo-damage i.fas, .tinyd6.td6-attack-card .attack-undo-damage .fa-solid, .tinyd6.td6-attack-card .attack-undo-damage .fas").each((i, el) => {
            el.style.setProperty("color", p.accent, "important");
        });

        // Правая панель урона («табель»): фон поля, перегородка, цифра урона
        // и кнопки ± - по палитре темы.
        root.find(".tinyd6.td6-attack-card .attack-card-dmg").each((i, el) => {
            el.style.setProperty("background", p.field, "important");
            el.style.setProperty("border-left", "1px solid " + p.border, "important");
            el.style.setProperty("color", p.text, "important");
        });
        root.find(".tinyd6.td6-attack-card .attack-card-dmg .attack-damage-value").each((i, el) => {
            el.style.setProperty("color", p.accent, "important");
        });
        root.find(".tinyd6.td6-attack-card .attack-card-dmg .attack-damage-step").each((i, el) => {
            el.style.setProperty("background", p.card, "important");
            el.style.setProperty("border", "1px solid " + p.border, "important");
            el.style.setProperty("color", p.accent, "important");
        });

        // MutationObserver: Carolingian (и другие модули) перекрашивают иконки
        // инлайн после нас. Один глобальный observer на #chat / #chat-notifications
        // с фильтрами style + fill + class + childList. При обнаружении
        // каскада Carolingian'а - целиком перекрашиваем задетую карточку,
        // но не чаще раза за тик (guard по dataset, а не таймер).
        if (!TinyD6System._iconObserver)
        {
            TinyD6System._iconObserver = new MutationObserver((mutations) => {
                const cards = new Set();
                for (const m of mutations)
                {
                    const t = m.target;
                    if (t?.nodeType === 1 && t.closest?.(".tinyd6.td6-attack-card"))
                        cards.add(t.closest(".tinyd6.td6-attack-card"));
                    if (m.type === "childList")
                    {
                        for (const n of m.addedNodes)
                        {
                            if (n?.nodeType !== 1) continue;
                            if (n.matches?.(".tinyd6.td6-attack-card")) cards.add(n);
                            n.querySelectorAll?.(".tinyd6.td6-attack-card").forEach(c => cards.add(c));
                        }
                    }
                }
                for (const card of cards)
                {
                    if (card.dataset._paintGuard === "1") continue;
                    card.dataset._paintGuard = "1";
                    try { TinyD6System._paintCardDiceIcons($(card), true); }
                    finally { setTimeout(() => { delete card.dataset._paintGuard; }, 0); }
                }
            });
        }
        for (const logId of ["chat", "chat-notifications"])
        {
            const el = document.getElementById(logId);
            if (el && !el.dataset?.tinyd6Obs)
            {
                if (el.dataset) el.dataset.tinyd6Obs = "1";
                TinyD6System._iconObserver.observe(el, {
                    subtree: true, attributes: true,
                    attributeFilter: ["style", "fill", "class"], childList: true
                });
            }
        }

        // Carolingian может перекрасить иконки уже ПОСЛЕ renderChatMessage
        // (инлайн-палитрой своей темы). Один повторный проход через 150 мс
        // добивает окончательно; MutationObserver ловит остатки.
        if (!_followUp) setTimeout(() => TinyD6System._paintCardDiceIcons(root, true), 150);
    }

    /* Класс текущей темы вешаем на <body>: палитра наследуется всеми
     * чат-карточками (атака/проверки/предметы) и элементами вне листа,
     * даже если класс не попал на само сообщение. Слушаем и смену
     * настройки (updateSetting), чтобы тема менялась без перезагрузки. */
    static _applyBodyTheme()
    {
        try
        {
            const keys = ["td-sheet-default", "td-sheet-minimal", "td-sheet-perkament", "td-sheet-noir", "td-sheet-cyberpunk"];
            document.body.classList.remove(...keys);
            const sheetStyle = game.settings.get(TinyD6System.SYSTEM, "sheetStyle") || "td-sheet-default";
            document.body.classList.add(keys.includes(sheetStyle) ? sheetStyle : "td-sheet-default");
        }
        catch (err) { /* настройка может быть ещё не готова на init - тихо пропускаем */ }
    }

    /* Кастомная текстура монеты для модуля «Dice So Nice!». Спрайт-атлас
     * лежит в системном каталоге assets/dice и переживает обновления DSN,
     * потому что правим не файлы модуля, а регистрируем свой пресет монеты
     * в уже готовой фабрике 3D-кубов через хук diceSoNiceReady. */
    static patchCoinTexture() {
        Hooks.once("diceSoNiceReady", (dice3d) => {
            try {
                const factory = dice3d.DiceFactory;
                if (!factory) return;
                const preset = factory.systems.get("standard")?.dice.get("dc");
                if (!preset) return;

                preset.setAtlas("systems/tinyd6v14/assets/dice/coin-atlas.json");
                preset.loadTextures().then(() => {
                    /* Сбрасываем собранные материалы кубов, чтобы монета
                     * взяла новые текстуры без перезагрузки страницы. */
                    const factory2 = dice3d.box?.dicefactory;
                    if (factory2?.disposeCachedMaterials) factory2.disposeCachedMaterials();
                }).catch(err => {
                    console.warn("tinyd6 | coin atlas load failed:", err);
                });
            }
            catch (err) {
                console.warn("tinyd6 | coin texture patch skipped:", err);
            }
        });
    }

    /* Инжектим CSS-оверрайды ПОСЛЕ загрузки всех модулей.
     * Carolingian UI вставляет свой <style> через JS в ready,
     * поэтому наш компилированный CSS (tinyd6.css) всегда
     * перекрывается. Решение: добавить наш <style> позже всех. */
    /* Foundry v14 грузит CSS систем внутри @layer(system), а CSS ядра
     * (например, «themed»-стили кнопок) и модулей (Carolingian) - БЕЗ слоя.
     * Безслойные обычные правила бьют слоёные при любой специфичности,
     * из-за чего кнопки/карточки теряют нашу тему (серые ромбы действий,
     * серые задники сообщений). Лечение: подключаем тот же tinyd6.css
     * вторым безслойным <link> - он стоит в <head> позже всех и каскад
     * возвращается к дов14-поведению. */
    static _ensureUnlayeredStyles() {
        let link = document.getElementById("tinyd6-unlayered");
        if (!link) {
            link = document.createElement("link");
            link.id = "tinyd6-unlayered";
            link.rel = "stylesheet";
            link.href = `systems/${TinyD6System.SYSTEM}/css/tinyd6.css?v=${game.system.version}`;
            document.head.appendChild(link);
        } else {
            document.head.appendChild(link);
        }
    }

    static _injectCarolingianCompat() {
        let style = document.getElementById("tinyd6-crlngn-compat");
        if (style) {
            document.head.appendChild(style);
        } else {
            style = document.createElement("style");
            style.id = "tinyd6-crlngn-compat";
            style.textContent = `
/* ================================================================
   TinyD6 × Carolingian UI
   1) Propagate theme variables from sheet to :root
   2) Fix FontAwesome icon font-family
   3) Minimal targeted overrides for Carolingian core selectors
   ================================================================ */

/* ---- FontAwesome icons: Foundry v14 = Font Awesome 7 (--_fa-family).
   "Font Awesome 6 Free" не существует на v14 - его жёсткое прописывание
   давало «тофу» вместо иконок. Семейство берём из переменной ядра,
   вес не трогаем (900 у .far ломает обычные иконки). ---- */
body.crlngn-ui .tinyd6 i.fas,
body.crlngn-ui .tinyd6 span.fas,
body.crlngn-ui .tinyd6 .fa-solid,
body.crlngn-ui #token-hud i.fas,
body.crlngn-ui #token-hud span.fas,
body.crlngn-ui #token-hud .fa-solid,
body.crlngn-ui .float-num i.fas,
body.crlngn-ui .float-num span.fas,
body.crlngn-ui .float-num .fa-solid {
    font-family: var(--_fa-family, "Font Awesome 7 Pro") !important;
    font-style: normal !important;
}

/* ---- Акцентные цвета: свои, а не от темы Carolingian.
   Специфичность выше, чем у body.crlngn-ui.game .app из crlngn,
   и стиль инжектится без слоя и позже - поэтому побеждаем. ---- */
body.crlngn-ui .app.tinyd6.sheet,
body.crlngn-ui .chat-message .tinyd6 {
    --color-warm-1: var(--td-accent-soft) !important;
    --color-warm-2: var(--td-accent) !important;
    --color-warm-3: var(--td-accent-soft) !important;
}

/* ---- Attack card in chat: keep our themed styling ---- */
body.crlngn-ui .chat-message .tinyd6 .td6-attack-card {
    background: var(--td-card) !important;
    border-color: var(--td-border) !important;
    color: var(--td-text) !important;
}
body.crlngn-ui .chat-message .tinyd6 .td6-attack-card .attack-die {
    background: var(--td-field) !important;
    border-color: var(--td-border) !important;
    color: var(--td-accent) !important;
}
/* Carolingian Custom-тема красит напрямую каждый элемент
   (h3, i.fas, div… *:not(.degree)) цветом своей темы - наследование
   от .attack-die до иконки не доходит. Красим сами иконки:
   !important + высокая специфичность побеждают любой её каскад. */
body.crlngn-ui .chat-message .tinyd6 .td6-attack-card .attack-die i.fas,
body.crlngn-ui .chat-message .tinyd6 .td6-attack-card .attack-die span.fas,
body.crlngn-ui .chat-message .tinyd6 .td6-attack-card .attack-die .fa-solid,
body.crlngn-ui .chat-message .tinyd6 .td6-attack-card .attack-die [class*="fa-dice-"] {
    color: var(--td-accent) !important;
}
body.crlngn-ui .chat-message .tinyd6 .td6-attack-card .attack-apply i,
body.crlngn-ui .chat-message .tinyd6 .td6-attack-card .attack-apply .fas,
body.crlngn-ui .chat-message .tinyd6 .td6-attack-card .attack-apply .fa-solid {
    color: #fff !important;
}
body.crlngn-ui .chat-message .tinyd6 .td6-attack-card .attack-undo i,
body.crlngn-ui .chat-message .tinyd6 .td6-attack-card .attack-undo .fas,
body.crlngn-ui .chat-message .tinyd6 .td6-attack-card .attack-undo .fa-solid {
    color: var(--td-accent) !important;
}
body.crlngn-ui .chat-message .tinyd6 .td6-attack-card .attack-apply {
    background: var(--td-accent) !important;
    color: #fff !important;
}
body.crlngn-ui .chat-message .tinyd6 .td6-attack-card .attack-apply:hover {
    background: var(--td-accent-soft) !important;
}

/* ---- Roll results: keep themed success/danger ---- */
body.crlngn-ui .tinyd6 .td6-roll-result.bg-success {
    background-color: var(--td-ok) !important;
    color: #fff !important;
}
body.crlngn-ui .tinyd6 .td6-roll-result.bg-danger {
    background-color: var(--td-danger) !important;
    color: #fff !important;
}

/* ---- Dice breakdown in chat ---- */
body.crlngn-ui .chat-message .tinyd6 .td6-dice-breakdown {
    background: var(--td-card) !important;
    color: var(--td-text) !important;
    border-color: var(--td-border) !important;
}
body.crlngn-ui .chat-message .tinyd6 .td6-dice-breakdown .fas,
body.crlngn-ui .chat-message .tinyd6 .td6-dice-breakdown .fa-solid,
body.crlngn-ui .chat-message .tinyd6 .td6-dice-breakdown [class*="fa-dice-"] {
    color: var(--td-accent) !important;
}
/* Текст на цветных чипах успеха/провала: Carolingian красит h3
   напрямую - белый нужен всегда. */
body.crlngn-ui .tinyd6.td6-roll-result.bg-success h3,
body.crlngn-ui .tinyd6.td6-roll-result.bg-danger h3 {
    color: #fff !important;
}

/* ---- Reload stub in chat ---- */
body.crlngn-ui .chat-message .tinyd6.reload-stub {
    background: var(--td-card) !important;
    border-color: var(--td-border) !important;
    color: var(--td-text) !important;
}
body.crlngn-ui .chat-message .tinyd6.reload-stub i.fas {
    color: var(--td-accent) !important;
}

/* ---- Attack dialog: theme the suggest button ---- */
.tinyd6.attack-dialog .dialog-button.attack-suggest {
    background: var(--td-accent) !important;
    border-color: var(--td-accent) !important;
    color: #fff !important;
}
.tinyd6.attack-dialog .dialog-button.attack-suggest:hover {
    background: var(--td-accent-soft) !important;
}

/* ---- Window header: keep our theme ---- */
body.crlngn-ui .tinyd6.window-app .window-header {
    background: var(--td-bg) !important;
    color: var(--td-text) !important;
}
body.crlngn-ui .tinyd6.sheet .window-content {
    background-color: var(--td-bg) !important;
    background-image: none !important;
    color: var(--td-text) !important;
}

/* ---- Token HUD buttons ---- */
body.crlngn-ui #token-hud .hp-stepper,
body.crlngn-ui #token-hud .wbtn,
body.crlngn-ui #token-hud .wcard {
    pointer-events: all !important;
}
`;
            document.head.appendChild(style);
        }

        /* Propagate computed CSS variables from the sheet to :root,
         * so Carolingian's :root overrides don't kill our theme. */
        const sheet = document.querySelector(".tinyd6.sheet");
        if (sheet) {
            const cs = getComputedStyle(sheet);
            const root = document.documentElement;
            for (const prop of ["--td-accent","--td-accent-soft","--td-bg","--td-text","--td-strong","--td-border","--td-card-bg","--td-card","--td-input-bg","--td-field","--td-hover","--td-muted","--td-ok","--td-danger","--td-radius","--td-font"]) {
                const val = cs.getPropertyValue(prop).trim();
                if (val) root.style.setProperty(prop, val);
            }
        }
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
            "systems/tinyd6v14/templates/partials/td6-attack-card.hbs",
            "systems/tinyd6v14/templates/partials/action-tracker.hbs"
        ];
    
        return loadTemplates(templatePaths);
    }

    /* Миграция: старые предметы типа "shield" → armor с group: "shield". */
    static async _migrateShieldItems() {
        if (!game.user.isGM) return;

        // 1. Мировые предметы (game.items)
        const worldShields = game.items?.filter(i => i.type === "shield") ?? [];
        if (worldShields.length) {
            const updates = worldShields.map(i => ({
                _id: i.id,
                type: "armor",
                "system.group": "shield"
            }));
            console.log(`tinyd6 | Migrating ${updates.length} world shield item(s) to armor type`);
            await Item.updateDocuments(updates);
        }

        // 2. Предметы на актёрах
        for (const actor of game.actors ?? []) {
            const actorShields = actor.items.filter(i => i.type === "shield");
            if (!actorShields.length) continue;
            const updates = actorShields.map(i => ({
                _id: i.id,
                type: "armor",
                "system.group": "shield"
            }));
            console.log(`tinyd6 | Migrating ${updates.length} shield(s) on actor "${actor.name}"`);
            await actor.updateEmbeddedDocuments("Item", updates);
        }
    }
}

Hooks.once("init", () => {
    TinyD6System.init();
});

Hooks.on("ready", TinyD6System.ready);

/* Токены на сцене: NPC - независимые копии (unlinked), герои - связаны
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
        // Homerule: Important NPC - токен важного NPC связан с актёром,
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
    document.updateSource({ "system.actions": { value: def, max: def } });

    // Мастерство оружия: у героя всегда есть минимум 1 слот (по умолчанию).
    if (document.type === "hero" && !document.system?.homebrew)
    {
        document.updateSource({ "system.homebrew": {
            masteredCount: 1,
            deathDie: "",
            deathRounds: "",
            deathSaveThreshold: "",
            damageBonus: 0,
            damageResist: "",
            movement: ""
        } });
    }
});

/* При изменении максимального HP (wounds.max) текущее HP не должно
 * превышать новое значение максимума. Аналогично для действий. */
/* Нормализует значение в число, вытаскивая его из массива/строки с мусором
 * (массивы попадали в данные из-за дублей name в форме). Для max-полей
 * дополнительно обрезаем до целого (дробные max бессмысленны). */
function _coerceNumber(value, { integer = false } = {}) {
    let n;
    if (typeof value === "number") n = value;
    else if (Array.isArray(value) && value.length) n = _coerceNumber(value[value.length - 1], { integer });
    else n = Number(String(value ?? "").replace(/,/g, ".").trim());
    if (Number.isNaN(n)) return NaN;
    return integer ? Math.trunc(n) : n;
}

Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
    const newMax = foundry.utils.getProperty(changes, "system.wounds.max");
    if (newMax !== undefined)
    {
        const max = _coerceNumber(newMax, { integer: true });
        if (!Number.isNaN(max))
        {
            foundry.utils.setProperty(changes, "system.wounds.max", max);
            const currentValue = Number(actor.system?.wounds?.value) || 0;
            if (currentValue > max) {
                foundry.utils.setProperty(changes, "system.wounds.value", max);
            }
        }
    }

    // Те же дубли name портили и эти поля - приводим к числам при обновлении.
    const corruptionMax = foundry.utils.getProperty(changes, "system.corruptionThreshold.max");
    if (corruptionMax !== undefined)
    {
        const cmax = _coerceNumber(corruptionMax, { integer: true });
        if (!Number.isNaN(cmax)) foundry.utils.setProperty(changes, "system.corruptionThreshold.max", cmax);
    }
    const xpMax = foundry.utils.getProperty(changes, "system.xp.max");
    if (xpMax !== undefined)
    {
        const xmax = _coerceNumber(xpMax, { integer: true });
        if (!Number.isNaN(xmax)) foundry.utils.setProperty(changes, "system.xp.max", xmax);
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

/* Миграция: лечит актёров, у которых числовые поля системы были испорчены
 * массивом/строкой (дубли name в форме херо-листа). Затрагиваем только
 * заведомо битые значения, обычные числа и строки из цифр не трогаем. */
Hooks.once("ready", async () => {
    const NUMERIC_PATHS = {
        "system.wounds.max": { integer: true },
        "system.wounds.value": { integer: true },
        "system.corruptionThreshold.max": { integer: true },
        "system.xp.max": { integer: true }
    };
    const isOk = (raw) => (typeof raw === "number" && Number.isFinite(raw)) || /^\s*-?\d+\s*$/.test(String(raw ?? ""));
    const updates = [];
    for (const actor of game.actors)
    {
        if (actor.type !== "hero" && actor.type !== "npc") continue;
        const patch = {};
        for (const [p, opts] of Object.entries(NUMERIC_PATHS))
        {
            const raw = foundry.utils.getProperty(actor, p);
            if (raw === undefined || raw === null || raw === "") continue;
            if (isOk(raw)) continue;
            const n = _coerceNumber(raw, opts);
            if (!Number.isNaN(n)) patch[p] = n;
        }
        if (Object.keys(patch).length) updates.push({ _id: actor.id, ...patch });

        // Мастерство оружия: если у героя вовсе нет homebrew.masteredCount,
        // выставляем дефолт 1, чтобы слоты мастерства отображались всегда.
        if (actor.type === "hero")
        {
            const mc = foundry.utils.getProperty(actor, "system.homebrew.masteredCount");
            if (mc === undefined || mc === null || mc === "")
            {
                if (!patch["system.homebrew.masteredCount"])
                {
                    const existing = updates.find(u => u._id === actor.id);
                    if (existing) existing["system.homebrew.masteredCount"] = 1;
                    else updates.push({ _id: actor.id, "system.homebrew.masteredCount": 1 });
                }
            }
        }
    }
    if (updates.length)
    {
        console.log(`tinyd6 | Healed corrupted numeric fields / seeded mastery on ${updates.length} actor(s)`);
        try
        {
            // game.actors.* не имеет updateDocuments в v14 - массовое обновление
            // делаем статикой класса Actor. Миграция не критична: если упадёт,
            // просто попробуем снова при следующей загрузке мира.
            await Actor.updateDocuments(updates, { render: false });
        }
        catch (err)
        {
            console.warn("tinyd6 | numeric migration failed (will retry next load):", err);
        }
    }
});

/* Homerule: TinyD6+ - при изменении Uses (или включении Reload) у оружия
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

/* Homerule: TinyD6+ / 0 HP - отслеживаем переход HP в 0 и обратно.
 * Храним предыдущее HP актёра, чтобы сработать только на реальном переходе
 * (не на повторном 0 → 0), и только если тима смерти включена. */
const PREV_WOUNDS = new Map();
Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
    if (userId !== game.user.id) return;
    if (foundry.utils.getProperty(changes, "system.wounds.value") !== undefined) {
        PREV_WOUNDS.set(actor.id, Number(actor.system?.wounds?.value) || 0);
    }
});

/* Homerule: TinyD6+ tint - слегка затемняем токен только по финальным статусам
 * смерти: tinyd6Down («выведен из строя», обычные НПС) и «dead» («смерть»,
 * герои и важные НПС; системный статус Foundry). Промежуточные dying не
 * затемняют, чтобы герой не темнел раньше времени (в момент обнуления HP).
 * Оригинальный тинт храним во флаге tinyd6v14.deathTint, чтобы вернуть его
 * при снятии статуса даже после перезагрузки клиента. */
const DEATH_TINT_COLOR = "#7d8287";
const DEATH_FLAG = "deathTint";
const DEATH_STATUS_IDS = ["tinyd6Down", "dead"];

/* Визуал умирающего (краснота, кровь, пульс) делает deathFx - PIXI-фильтром
 * на токене (module/helpers/deathFx.js). Перекраска texture.tint красным
 * убрана, чтобы не дублировать эффект и не глушить токен. */

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

/* Статус-эффект смерти (statuses - Set id-шников статусов активного эффекта). */
function _onDeathStatusEffectChange(effect) {
    if (!effect?.statuses?.size) return;
    if (!DEATH_STATUS_IDS.some(id => effect.statuses.has(id))) return;
    if (!game.user.isGM) return;
    _syncSceneDeathTints();
}

Hooks.on("createActiveEffect", _onDeathStatusEffectChange);
Hooks.on("deleteActiveEffect", _onDeathStatusEffectChange);
Hooks.on("updateActiveEffect", _onDeathStatusEffectChange);
Hooks.on("canvasReady", () => { if (game.user.isGM) { _syncSceneDeathTints(); } });

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
        // вызвал _setPendingFloat) - показываем число только над ним, чтобы
        // для unlinked NPC-копий не всплывало над всеми сразу.
        const pending = Dice._takePendingFloat(actor.id);
        const delta = newValue - prev;
        if (delta !== 0)
        {
            const type = delta < 0 ? "dmg" : "heal";
            const sign = delta < 0 ? "" : "+";
            const sceneId = game.canvas?.scene?.id ?? null;
            if (pending?.tokenId)
            {
                const tok = game.canvas?.scene ? canvas.tokens.get(pending.tokenId) ?? null : null;
                if (tok)
                {
                    Dice.spawnFloatingNumber(tok, actor, `${sign}${delta}`, type);
                    Dice.spawnTokenFlash(tok, type);
                    if (sceneId) broadcastFx([{ kind: "float", sceneId, tokenId: pending.tokenId, text: `${sign}${delta}`, type }]);
                }
            }
            else
            {
                Dice.spawnFloatingNumber(null, actor, `${sign}${delta}`, type);
                // Без привязки к токену - транслируем по токенам цели, если она одна.
            }
        }

        if (deathEntered) {
            const tok = _findTokenForActor(actor, pending?.tokenId);
            if (tok) Dice.spawnTokenDeath(tok);
            const sceneId = game.canvas?.scene?.id ?? null;
            if (tok && sceneId) broadcastFx([{ kind: "death", sceneId, tokenId: tok.id }]);
            await handleZeroHp(actor);
            return;
        }
        if (deathCleared) {
            await clearDeathState(actor);
        }
    }

    // Проверка остатка раундов выполняется death.js (таймер смерти),
    // визуал умирающего - PIXI-фильтром deathFx на токене.

    // Homerule: Important NPC - токен важного NPC связан с актёром
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

/* Homerule: TinyD6+ - тикает таймер смерти на начало хода поверженного
 * персонажа (смена активного бойца). Только на клиенте GM. */
Hooks.on("updateCombat", (combat, changes, options, userId) => {
    if (!game.user.isGM) return;
    if (!combat.active) return;
    if (changes?.turn !== undefined) tickDeathTimers(combat);

    // Смена хода: восстанавливаем рывок (сверхпередвижение) и счётчик
    // действий у всех участников. Бюджет движения за ход ядро сбрасывает
    // само (movement history чистится на старте хода каждого бойца).
    if (changes?.turn !== undefined)
    {
        for (const combatant of combat.combatants)
        {
            const actor = combatant.actor;
            if (!actor || (actor.type !== "hero" && actor.type !== "npc")) continue;
            const up = {};
            if (actor.flags["tinyd6v14"]?.dashed) up["flags.tinyd6v14.dashed"] = false;
            if (Number.isFinite(actor.system?.actions?.max)) up["system.actions.value"] = actor.system.actions.max;
            if (Object.keys(up).length) actor.update(up, { render: false });
        }
    }
});

/* Homerule: TinyD6+ - после изменения зарядов оружия (выстрел с токена,
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

/* Homerule: Armor HP - при изменении брони (HP/DR/экипировка) синхронизируем
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

/* ============================================================
   Кнопки чат-карточек (Применить урон / Вернуть ресурс / хилы /
   стабилизация). Регистрируются на ДВУХ контейнерах:
   1) основной лог чата #chat - через renderChatLog: html корня
      пересоздаётся ядром, поэтому вешаем на каждый свежий элемент;
   2) плавающие нотификации справа #chat-notifications - это
      ОТДЕЛЬНЫЙ контейнер сайдбара (ядро копирует сообщения туда
      самостоятельно, они не лежат внутри #chat), поэтому без
      второго слушателя кнопки там мёртвые. При message.update()
      ядро перерисовывает и основную карточку, и её копию в
      нотификациях → дубликатов не возникает.
   ============================================================ */
async function _onAttackCardClick(event) {
    // Кнопки ± урона: GM корректирует итоговый урон карточки за
    // креативную/усложнённую заявку (или снижает за слабую). Правят
    // data-damage (крит уже внутри) и сразу синхронятся всем клиентам.
    const step = event.target.closest(".attack-damage-step");
    if (step)
    {
        event.preventDefault();
        if (!game.user.isGM) return;
        const card = step.closest(".td6-attack-card");
        if (!card || card.dataset.damageApplied === "true") return;
        const current = Number(card.dataset.damage) || 0;
        const delta = Number(step.dataset.step) || 0;
        const next = Math.max(0, current + delta);
        card.dataset.damage = String(next);
        const value = card.querySelector(".attack-damage-value");
        if (value) value.textContent = String(next);
        _syncCardToMessage(card, card);
        return;
    }

    // Кнопка «Вернуть ресурс»: откат случайно потраченного заряда оружия.
    const undo = event.target.closest(".attack-undo");
    if (undo)
    {
        event.preventDefault();
        const card = undo.closest(".td6-attack-card");
        if (!card) return;

        // Заряд возвращается только один раз: до re-render ставим флаг,
        // чтобы двойной клик (или ре-рендер карточки) не дал +2 и больше.
        if (card.dataset.undoApplied === "true") return;
        card.dataset.undoApplied = "true";
        undo.disabled = true;

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
        // Запоминаем возврат заряда: «Откат урона» должен аннулировать
        // и его (заряд снова считается потраченным), а кнопку вернуть в карточку.
        card.dataset.resourceReturned = "1";
        card.dataset.resourceWeaponId = weaponId;
        undo.closest(".attack-card-undo")?.remove();
        _syncCardToMessage(card, card);
        return;
    }

    // Кнопка «Откат урона»: возвращает HP и прочность брони всем целям
    // атаки и переводит карточку обратно в состояние «до применения» -
    // урон снова можно править кнопками ± и применить повторно.
    const undoDamage = event.target.closest(".attack-undo-damage");
    if (undoDamage)
    {
        event.preventDefault();
        if (!game.user.isGM) return;
        const card = undoDamage.closest(".td6-attack-card");
        if (!card || card.dataset.damageApplied !== "true") return;
        if (undoDamage.dataset.busy === "true") return;
        undoDamage.dataset.busy = "true";
        undoDamage.disabled = true;

        let applied = [];
        try { applied = JSON.parse(card.dataset.applied || "[]"); } catch (err) { applied = []; }
        if (applied.length) await Dice.undoAttackDamage(applied);

        // Возвращаем карточку в «до применения».
        delete card.dataset.applied;
        card.dataset.damageApplied = "false";
        undoDamage.remove();
        card.querySelector(".attack-report")?.remove();

        // «Откат урона» откатывает и «Возврат ресурсов»: атака остаётся
        // в силе, поэтому ранее возвращённый заряд снова считается
        // потраченным, а кнопка «Вернуть ресурс» возвращается в карточку.
        if (card.dataset.resourceReturned === "1")
        {
            const resourceWeaponId = card.dataset.resourceWeaponId || "";
            let resourceActor = null;
            let attackerRef = null;
            try { attackerRef = JSON.parse(card.dataset.attackerToken || "null"); } catch (err) { attackerRef = null; }
            if (attackerRef?.tokenId)
                resourceActor = game.scenes.get(attackerRef.sceneId)?.tokens.get(attackerRef.tokenId)?.actor ?? null;
            if (!resourceActor)
            {
                const rid = card.dataset.actorId;
                resourceActor = rid ? game.actors.get(rid) : null;
            }
            const weapon = resourceActor?.items?.get(resourceWeaponId);
            if (weapon)
            {
                const max = Number(weapon.system.uses) || 0;
                const current = (weapon.system.charges !== undefined && weapon.system.charges !== null)
                    ? Number(weapon.system.charges) : max;
                await weapon.update({ "system.charges": Math.max(0, current - 1) }, { render: false });
            }
            delete card.dataset.resourceReturned;
            delete card.dataset.resourceWeaponId;
            // Восстанавливаем кнопку «Вернуть ресурс» (удалена при исходном возврате).
            if (!card.querySelector(".attack-undo"))
            {
                const row = document.createElement("div");
                row.className = "attack-card-undo d-flex align-items-center";
                const btn = document.createElement("button");
                btn.type = "button";
                btn.className = "attack-undo";
                btn.dataset.action = "undo-resource";
                btn.dataset.weaponId = resourceWeaponId;
                btn.innerHTML = `<i class="fas fa-undo"></i> ${game.i18n.localize("tinyd6.reload.undoResource")}`;
                row.appendChild(btn);
                card.appendChild(row);
            }
        }

        const cardFooter = card.querySelector(".attack-card-footer");
        let hasTargets = false;
        try { hasTargets = (JSON.parse(card.dataset.targets || "[]").length > 0); } catch (err) { hasTargets = false; }
        if (hasTargets && cardFooter && !card.querySelector(".attack-apply"))
        {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "attack-apply";
            btn.dataset.action = "apply-attack";
            btn.innerHTML = `<i class="fas fa-crosshairs"></i> ${game.i18n.localize("tinyd6.attack.applyDamage")}`;
            cardFooter.appendChild(btn);
        }

        // Возвращаем кнопки ± (контейнер мог остаться, кнопки мы снимали).
        let stepsWrap = card.querySelector(".attack-damage-steps");
        if (!stepsWrap)
        {
            stepsWrap = document.createElement("span");
            stepsWrap.className = "attack-damage-steps";
            const valueEl = card.querySelector(".attack-damage-value");
            if (valueEl) valueEl.after(stepsWrap);
            else (card.querySelector(".attack-damage") || cardFooter)?.appendChild(stepsWrap);
        }
        if (!stepsWrap.querySelector(".attack-damage-step"))
        {
            const mkStep = (delta, label) => {
                const b = document.createElement("button");
                b.type = "button";
                b.className = "attack-damage-step";
                b.dataset.action = "adjust-damage";
                b.dataset.step = String(delta);
                b.title = label;
                b.textContent = delta < 0 ? "−" : "+";
                return b;
            };
            stepsWrap.appendChild(mkStep(-1, "Понизить урон"));
            stepsWrap.appendChild(mkStep(1, "Повысить урон"));
        }

        TinyD6System._paintCardDiceIcons($(card));
        _syncCardToMessage(card, card);
        return;
    }

    const button = event.target.closest(".attack-apply");
    if (!button) return;
    event.preventDefault();
    const card = button.closest(".td6-attack-card");
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
    // Урон применён - подкручивать карточку больше нельзя.
    card.dataset.damageApplied = "true";
    card.querySelectorAll(".attack-damage-step").forEach(b => b.remove());

    // Данные для возможного отката: вернём HP и прочность брони по факту
    // применённого урона (резист/броня не пересчитываются заново).
    if (applied.length) card.dataset.applied = JSON.stringify(applied);

    // После применения - кнопка «Откат урона» (рядом с «Вернуть ресурс»).
    const footer = card.querySelector(".attack-card-footer");
    const undoRow = card.querySelector(".attack-card-undo");
    const undoDamageBtn = document.createElement("button");
    undoDamageBtn.type = "button";
    undoDamageBtn.className = "attack-undo-damage";
    undoDamageBtn.dataset.action = "undo-damage";
    undoDamageBtn.innerHTML = `<i class="fas fa-rotate-left"></i> ${game.i18n.localize("tinyd6.attack.undoDamage")}`;
    if (undoRow) undoRow.appendChild(undoDamageBtn);
    else if (footer) footer.appendChild(undoDamageBtn);

    const parts = [];
    if (applied.length) parts.push(applied.map(u => `${u.name} -${u.damage}${u.resist ? ` (резист ${u.resist})` : ""}`).join(", "));
    if (reported.length) parts.push(reported.map(u => `${u.name} -${u.damage} (урон не списан)`).join(", "));

    if (footer && parts.length)
    {
        const report = document.createElement("span");
        report.className = "attack-report";
        report.textContent = parts.join("; ");
        footer.appendChild(report);
    }

    // Синхронизируем карточку на всех клиентах: убираем кнопку и
    // показываем отчёт у каждого, а не только у нажавшего.
    _syncCardToMessage(card, card);

    // Для чужих героев (урон не списан) - выводим отдельное сообщение в чат.
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
}

// Обновляет содержимое сообщения карточки (chat card) у ВСЕХ клиентов.
// Мутации в tinyd6 меняют только локальный DOM нажавшего; чтобы Foundry
// перерисовал карточку у всех, обновляем сам ChatMessage через GM-прокси
// (т.к. у игрока может не быть прав на чужое сообщение).
function _syncCardToMessage(card, sourceCard) {
    const cardEl = card ?? sourceCard;
    const messageId = cardEl?.dataset?.messageId;
    if (!messageId) return;
    const content = sourceCard?.outerHTML ?? card?.outerHTML;
    if (!content) return;
    gmProxy("syncCard", { messageId, content });
}

// Подтверждение хила из карточки heal-confirm: применяет только GM
// (кнопка скрыта у игроков через renderChatMessage).
async function _onHealConfirmClick(event) {
    const button = event.target.closest(".heal-apply");
    if (!button) return;
    event.preventDefault();
    if (!game.user.isGM) return;

    const card = button.closest(".heal-confirm");
    if (!card) return;

    const result = await Dice.applyHealConfirmation(card);
    if (!result)
    {
        ui.notifications.warn(game.i18n.localize("tinyd6.heal.noTarget"));
        return;
    }
    if (!result.ok)
    {
        const msg = result.reason === "full"
            ? game.i18n.localize("tinyd6.heal.full")
            : game.i18n.localize("tinyd6.heal.noTarget");
        ui.notifications.warn(msg);
        return;
    }

    button.remove();
    const body = card.querySelector(".death-mini-body");
    if (body)
    {
        const done = document.createElement("div");
        done.className = "heal-confirm-done";
        done.textContent = game.i18n.localize("tinyd6.heal.confirmed");
        body.appendChild(done);
    }
    _syncCardToMessage(card, card);
}

// Подтверждение стабилизации из карточки stab-confirm: применяет только GM.
async function _onStabConfirmClick(event) {
    const button = event.target.closest(".stab-apply");
    if (!button) return;
    event.preventDefault();
    if (!game.user.isGM) return;

    const card = button.closest(".stab-confirm");
    if (!card) return;

    const result = await applyStabilizeConfirmation(card);
    if (!result || !result.ok)
    {
        ui.notifications.warn(game.i18n.localize("tinyd6.stabilize.noTarget"));
        return;
    }

    button.remove();
    const body = card.querySelector(".death-mini-body");
    if (body)
    {
        const done = document.createElement("div");
        done.className = "heal-confirm-done";
        done.textContent = game.i18n.localize("tinyd6.heal.confirmed");
        body.appendChild(done);
    }
    _syncCardToMessage(card, card);
}

// Вешает обработчики карточек на контейнер (идемпотентно).
function _attachChatCardHandlers(root) {
    if (!root || root.dataset.tinyd6Cards === "1") return;
    root.dataset.tinyd6Cards = "1";
    root.addEventListener("click", _onAttackCardClick);
    root.addEventListener("click", _onHealConfirmClick);
    root.addEventListener("click", _onStabConfirmClick);
}

Hooks.on("renderChatLog", (chatLog, html) => {
    const log = html instanceof HTMLElement ? html : html[0] || html;
    _attachChatCardHandlers(log);
    // Нотификации могут пересоздаваться ядром - перевешиваем идемпотентно.
    _attachChatCardHandlers(document.getElementById("chat-notifications"));
});

Hooks.on("ready", () => {
    _attachChatCardHandlers(document.getElementById("chat-notifications"));
});
