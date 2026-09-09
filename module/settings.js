import { localizeAll } from "./helpers/utils.js";

export const registerGameSettings = function () {
    let systemName = "tinyd6v14";

    game.settings.register(systemName, "theme", {
        name: game.i18n.localize("tinyd6.settings.theme.name"),
        hint:  game.i18n.localize("tinyd6.settings.theme.hint"),
        scope: "world",
        config: false,
        choices: localizeAll(CONFIG.tinyd6.themes),
        default: "tiny-cthulhu",
        type: String
    });

    game.settings.register(systemName, "sheetStyle", {
        name: game.i18n.localize("tinyd6.settings.sheetStyle.name"),
        hint:  game.i18n.localize("tinyd6.settings.sheetStyle.hint"),
        scope: "world",
        config: true,
        choices: localizeAll(CONFIG.tinyd6.sheetStyles),
        default: "td-sheet-default",
        onChange: () => window.location.reload(),
        type: String
    });

    game.settings.register(systemName, "enableCorruption", {
        name: game.i18n.localize("tinyd6.settings.enableCorruption.name"),
        hint:  game.i18n.localize("tinyd6.settings.enableCorruption.hint"),
        scope: "world",
        config: true,
        default: false,
        type: Boolean
    });

    game.settings.register(systemName, "enableAdvancement", {
        name: game.i18n.localize("tinyd6.settings.enableAdvancement.name"),
        hint:  game.i18n.localize("tinyd6.settings.enableAdvancement.hint"),
        scope: "world",
        config: true,
        choices: localizeAll(CONFIG.tinyd6.advancementMethods),
        default: "none",
        type: String
    });

    game.settings.register(systemName, "enableItemTracking", {
        name: game.i18n.localize("tinyd6.settings.enableItemTracking.name"),
        hint:  game.i18n.localize("tinyd6.settings.enableItemTracking.hint"),
        scope: "world",
        config: false,
        default: false,
        type: Boolean
    });

    game.settings.register(systemName, "enableDepletionPoints", {
        name: game.i18n.localize("tinyd6.settings.enableDepletionPoints.name"),
        hint:  game.i18n.localize("tinyd6.settings.enableDepletionPoints.hint"),
        scope: "world",
        config: true,
        default: false,
        type: Boolean
    });

    game.settings.register(systemName, "enableVariableWeaponDamage", {
        name: game.i18n.localize("tinyd6.settings.enableVariableWeaponDamage.name"),
        hint:  game.i18n.localize("tinyd6.settings.enableVariableWeaponDamage.hint"),
        scope: "world",
        config: false,
        default: false,
        type: Boolean
    });

    game.settings.register(systemName, "enableCriticalHits", {
        name: game.i18n.localize("tinyd6.settings.enableCriticalHits.name"),
        hint:  game.i18n.localize("tinyd6.settings.enableCriticalHits.hint"),
        scope: "world",
        config: false,
        default: false,
        type: Boolean
    });

    game.settings.register(systemName, "independentNpcTokens", {
        name: game.i18n.localize("tinyd6.settings.independentNpcTokens.name"),
        hint:  game.i18n.localize("tinyd6.settings.independentNpcTokens.hint"),
        scope: "world",
        config: true,
        default: true,
        type: Boolean
    });

    game.settings.register(systemName, "defaultActions", {
        name: game.i18n.localize("tinyd6.settings.defaultActions.name"),
        hint:  game.i18n.localize("tinyd6.settings.defaultActions.hint"),
        scope: "world",
        config: true,
        default: 1,
        type: Number
    });

    game.settings.register(systemName, "enableTinyD6Plus", {
        name: game.i18n.localize("tinyd6.settings.enableTinyD6Plus.name"),
        hint:  game.i18n.localize("tinyd6.settings.enableTinyD6Plus.hint"),
        scope: "world",
        config: true,
        default: false,
        type: Boolean
    });

    game.settings.register(systemName, "enableHealStabProxy", {
        name: game.i18n.localize("tinyd6.settings.enableHealStabProxy.name"),
        hint:  game.i18n.localize("tinyd6.settings.enableHealStabProxy.hint"),
        scope: "world",
        config: true,
        default: false,
        type: Boolean
    });

    game.settings.register(systemName, "enablePlayerDamageProxy", {
        name: game.i18n.localize("tinyd6.settings.enablePlayerDamageProxy.name"),
        hint:  game.i18n.localize("tinyd6.settings.enablePlayerDamageProxy.hint"),
        scope: "world",
        config: true,
        default: false,
        type: Boolean
    });

    game.settings.register(systemName, "enableAttackProficiency", {
        name: game.i18n.localize("tinyd6.settings.enableAttackProficiency.name"),
        hint:  game.i18n.localize("tinyd6.settings.enableAttackProficiency.hint"),
        scope: "world",
        config: true,
        default: false,
        type: Boolean
    });

    game.settings.register(systemName, "enableArmorStacking", {
        name: game.i18n.localize("tinyd6.settings.enableArmorStacking.name"),
        hint:  game.i18n.localize("tinyd6.settings.enableArmorStacking.hint"),
        scope: "world",
        config: true,
        default: false,
        type: Boolean
    });

    game.settings.register(systemName, "critAdvantage", {
        name: game.i18n.localize("tinyd6.settings.critAdvantage.name"),
        hint:  game.i18n.localize("tinyd6.settings.critAdvantage.hint"),
        scope: "world",
        config: true,
        choices: localizeAll(CONFIG.tinyd6.critAdvantageModes),
        default: "off",
        type: String
    });

    game.settings.register(systemName, "showNpcReloadMessages", {
        name: game.i18n.localize("tinyd6.settings.showNpcReloadMessages.name"),
        hint:  game.i18n.localize("tinyd6.settings.showNpcReloadMessages.hint"),
        scope: "world",
        config: true,
        default: false,
        type: Boolean
    });

    game.settings.register(systemName, "deathRounds", {
        name: game.i18n.localize("tinyd6.settings.deathRounds.name"),
        hint:  game.i18n.localize("tinyd6.settings.deathRounds.hint"),
        scope: "world",
        config: true,
        default: "3",
        type: String
    });

    game.settings.register(systemName, "deathSaveThreshold", {
        name: game.i18n.localize("tinyd6.settings.deathSaveThreshold.name"),
        hint:  game.i18n.localize("tinyd6.settings.deathSaveThreshold.hint"),
        scope: "world",
        config: true,
        default: 4,
        type: Number
    });

    game.settings.register(systemName, "showNpcDeathMessages", {
        name: game.i18n.localize("tinyd6.settings.showNpcDeathMessages.name"),
        hint:  game.i18n.localize("tinyd6.settings.showNpcDeathMessages.hint"),
        scope: "world",
        config: true,
        default: false,
        type: Boolean
    });

    game.settings.register(systemName, "animFx", {
        name: game.i18n.localize("tinyd6.settings.animFx.name"),
        hint:  game.i18n.localize("tinyd6.settings.animFx.hint"),
        scope: "world",
        config: true,
        default: true,
        type: Boolean,
        onChange: (value) => {
            document.body.classList.toggle("td-no-fx", !value);
        }
    });

    game.settings.register(systemName, "dieRollerPosition", {
        scope: "client",
        config: false,
        default: null,
        type: Object
    });

    game.settings.register(systemName, "threshold", {
        scope: "world",
        config: false,
        default: 5,
        type: Number
    });

    game.settings.register(systemName, "enableArmorBreakMessages", {
        name: game.i18n.localize("tinyd6.settings.enableArmorBreakMessages.name"),
        hint:  game.i18n.localize("tinyd6.settings.enableArmorBreakMessages.hint"),
        scope: "world",
        config: true,
        default: false,
        type: Boolean
    });
};

/* ============================================================
   Перезагрузка мира после изменения правил.
   Любая мировая настройка tinyd6 (в т.ч. включение/выключение
   гомерулов) перезапускает клиент (эквивалент F5), чтобы новые
   правила гарантированно применились во всех открытых данных.
   Дебаунс: пачка изменений из формы настроек проскакивает одним
   перезапуском, а не серией.
   ============================================================ */
let _reloadTimer = null;
function _reloadWorldAfterChange() {
    clearTimeout(_reloadTimer);
    _reloadTimer = setTimeout(() => window.location.reload(), 500);
}

export function registerWorldSettingsReload() {
    const reloadFor = (setting) => {
        const key = typeof setting?.key === "string" ? setting.key : "";
        if (!key.startsWith("tinyd6v14.")) return;
        _reloadWorldAfterChange();
    };

    // Дополняем onChange каждого мирового ключа системы (вызывается ядром
    // при game.settings.set) — надёжно, поверх любых существующих колбэков.
    for (const [key, cfg] of game.settings.settings)
    {
        if (!key.startsWith("tinyd6v14.") || cfg.scope !== "world") continue;
        const prev = cfg.onChange ?? null;
        cfg.onChange = (...args) => {
            try { if (typeof prev === "function") prev(...args); }
            finally { _reloadWorldAfterChange(); }
        };
    }

    // На всякий случай — хук документа Setting (мировые настройки хранятся
    // как документы Setting в коллекции мира).
    Hooks.on("updateSetting", reloadFor);
}
