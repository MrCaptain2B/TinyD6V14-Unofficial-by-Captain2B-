/* Homerule: TinyD6+ - раскраска пути токена при перетаскивании по "бюджету
 * передвижения": зелёный - обычное передвижение (Move), жёлтый - сверх-
 * передвижение (рывок, +мировое передвижение за 1 действие), красный - всё,
 * что выходит за бюджет. Похожим образом красит путь dnd5e/сплав-ядра TokenRuler.
 *
 * В бою бюджет считается «на ход» самим ядром: путь при перетаскивании
 * строится от origin (учитывая movement history за текущий ход), и ядро
 * чистит history на старте хода каждого бойца - поэтому cost показывает
 * суммарный пройденный за ход путь, остаток бюджета считается сам собой,
 * двойного учёта нет. Вне боя ограничений нет - путь не красим.
 *
 * Значения скорости храним в футах, а на канвасе переводим в единицы сцены:
 * если gridUnits сцены метрические (m/м) - мир в режиме "m", делим на
 * конверсию фут→метр. Это даёт корректную раскраску и для имперской сетки.
 */
const CoreTokenRuler = foundry?.canvas?.placeables?.tokens?.TokenRuler ?? null;

export default class TinyTokenRuler extends (CoreTokenRuler ?? Object) {

    /* Множитель скорости от активных состояний (statuses токена/актёра):
     * опрокинут/устал/перегружен - 0.5, парализован/без сознания/повержен - 0. */
    static _conditionMoveFactor(actor) {
        if (!actor?.statuses?.size) return 1;
        const zero = new Set(["paralyzed", "petrified", "unconscious", "tinyd6Down", "tinyd6Dying", "dead"]);
        const half = new Set(["prone", "exhausted", "encumbered"]);
        let factor = 1;
        for (const id of actor.statuses) {
            if (zero.has(id)) return 0;
            if (half.has(id)) factor = 0.5;
        }
        return factor;
    }

    /* Эффективная скорость ходьбы персонажа в футах: персональное поле
     * homebrew.movement (пусто = мир) либо мировая настройка movementDefault.
     * Учитываются понижающие условия (см. _conditionMoveFactor). */
    static _moveFeet(actor) {
        const raw = actor?.system?.homebrew?.movement;
        const v = Number(raw);
        const ft = Number.isFinite(v) && v > 0 ? v
            : (Number(game.settings.get("tinyd6v14", "movementDefault")) || 0);
        const base = Number.isFinite(ft) && ft > 0 ? ft : 0;
        return Math.round(base * (TinyTokenRuler._conditionMoveFactor(actor) ?? 1));
    }

    /* Дополнительные футы рывка (сверхпередвижение) - мировое передвижение,
     * масштабируемое теми же понижающими условиями, что и ходьба. */
    static _dashExtraFeet(actor) {
        const world = Number(game.settings.get("tinyd6v14", "movementDefault")) || 0;
        return Math.round(Math.max(0, world) * (TinyTokenRuler._conditionMoveFactor(actor) ?? 1));
    }

    /* В бою ли сейчас персонаж (активная боевая встреча + токен участник).
     * Вне боя передвижение не ограничено, раскрашивать нечего. */
    static _inCombat(token) {
        if (!game.combat?.started || !game.combat.active) return false;
        return Boolean(token?.document?.combatant);
    }

    /* Фактор: сколько футов в одной единице сетки текущей сцены.
     * Имперская система (ft) - 1; метрическая (m/м) - 3.28084. */
    static _feetPerSceneUnit() {
        const units = String(canvas?.scene?.grid?.units ?? "").trim().toLowerCase();
        const unitSetting = String(game.settings.get("tinyd6v14", "movementUnit") ?? "ft");
        const metricUnits = /^(m|м)(e?t?re?s?)?(eter|etre|ètre|eters|etres)?$/i.test(units)
            || /^(meter|metre|mètre)s?$/.test(units);
        const metric = unitSetting === "m" || (metricUnits && !/(f|ft|фут)/.test(units));
        return metric ? (CONFIG.tinyd6.feetPerMeter || 3.28084) : 1;
    }

    /* Точки-маркеры пути (кружки между сегментами). */
    _getWaypointStyle(waypoint) {
        const style = super._getWaypointStyle?.(waypoint) ?? { radius: 0 };
        return this._applyMovementColor(waypoint, style);
    }

    /* Линия сегмента пути. */
    _getSegmentStyle(waypoint) {
        const style = super._getSegmentStyle?.(waypoint) ?? { width: 0 };
        return this._applyMovementColor(waypoint, style);
    }

    /* Подсветка клеток под токеном. */
    _getGridHighlightStyle(waypoint, offset) {
        const style = super._getGridHighlightStyle?.(waypoint, offset) ?? { alpha: 0 };
        return this._applyMovementColor(waypoint, style);
    }

    /* Единая логика: подкрашивает style по бюджету передвижения токена. */
    _applyMovementColor(waypoint, style) {
        // Красим только собственное планирование этого клиента.
        if (!(game.user?.id in (this.token?._plannedMovement ?? {}))) return style;
        if (waypoint.actionConfig?.teleport) return style;
        // Гомерул «передвижение по бюджету» можно выключить мировой настройкой.
        if (!game.settings.get("tinyd6v14", "enableMovementBudget")) return style;

        const actor = this.token?.actor;
        if (!actor || (actor.type !== "hero" && actor.type !== "npc")) return style;
        // Вне боя передвижение не ограничено - не красим (путь обычным цветом).
        if (!TinyTokenRuler._inCombat(this.token)) return style;

        const moveFeet = TinyTokenRuler._moveFeet(actor);
        if (!moveFeet) return style;

        const feetPerUnit = TinyTokenRuler._feetPerSceneUnit();
        const walkUnits = moveFeet / feetPerUnit;

        let dashUnits = walkUnits;
        if (actor.flags["tinyd6v14"]?.dashed)
        {
            dashUnits = (moveFeet + TinyTokenRuler._dashExtraFeet(actor)) / feetPerUnit;
        }

        // Стоимость пути на этой точке уже включает пройденное за ход
        // (ядро строит путь от origin с учётом movement history).
        const cost = Number(waypoint.measurement?.cost) || 0;
        const { normal, dash, over } = CONFIG.tinyd6.tokenRulerColors;
        if (cost <= walkUnits + 1e-6) style.color = normal ?? style.color;
        else if (cost <= dashUnits + 1e-6) style.color = dash ?? style.color;
        else style.color = over ?? style.color;
        return style;
    }
}