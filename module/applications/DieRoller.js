import * as Dice from "../helpers/dice.js";
import { TinyD6System } from "../tinyd6.js";

export default class DieRoller extends FormApplication {
    constructor(options) {
	    super(options);

        console.log("tinyd6 | building DieRoller");
        //game.user.setFlag(TinyD6System.SYSTEM, "dieRollerPosition", null);
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "die-roller",
            title: game.i18n.localize("tinyd6.system.dieRoller"),
            template: "systems/tinyd6v14/templates/applications/die-roll.hbs",
            classes: [ TinyD6System.SYSTEM, "tinyd6", "die-roller", game.settings.get(TinyD6System.SYSTEM, "theme"), game.settings.get(TinyD6System.SYSTEM, "sheetStyle") ],
            popOut: true,
            minimizable: false,
            buttons: [],
        });
    }

    /** @override */
    getData(options)
    {
        console.log("tinyd6 | getData");
        const data = super.getData();
        //console.log(data);

        data.config = CONFIG.tinyd6;
        data.config.heritageHeaderPath = `tinyd6.actor.${data.config.theme}.heritage.header`;

        // Локальный счётчик действий: хранится только у этого пользователя,
        // не привязан к актёру и не синхронизируется между клиентами.
        const def = Number(game.settings.get(TinyD6System.SYSTEM, "defaultActions"));
        const fallback = (Number.isNaN(def) || def < 0) ? 1 : def;
        const current = Number(game.user.getFlag(TinyD6System.SYSTEM, "actionCounter"));
        data.actions = (Number.isNaN(current) || current < 0) ? fallback : Math.floor(current);
        data.spentMap = {};
        const flag = game.user.getFlag(TinyD6System.SYSTEM, "actionSpent");
        if (Array.isArray(flag)) {
            for (const idx of flag) data.spentMap[idx] = true;
        }

        //let pos = this.getPos();
        //console.log("tinyd6 | getData", pos);        
        //data.pos = pos;
        this.setPos();
    
        return data;
    }

    getPos() {
        console.log("tinyd6 | getting position");

        this.pos = game.user.getFlag(TinyD6System.SYSTEM, "dieRollerPosition");

        if (!this.pos || (this.pos.length === 0)) {
            let hbpos = $('#hotbar').position();
            let width = $('#hotbar').width();
            this.pos = { left: hbpos.left + width + 4, right: '', top: '', bottom: 110 };

            game.user.setFlag(TinyD6System.SYSTEM, "dieRollerPosition", this.pos);
        }

        let result = '';
        if (this.pos != undefined) {
            result = Object.entries(this.pos).filter(k => {
                return (''+ k[1]) !== '';
            }).map(k => {
                return k[0] + ":" + k[1] + ((''+ k[1]).indexOf('px') > 1 ? '' : 'px');
            }).join('; ') + ';';
        }

        return result;
    }

    setPos() {
        console.log("tinyd6 | setting position", this.pos);

        let cssPosition = this.getPos();
        let position = this.pos;
        // if ((position === null) || (position.length === 0)) {
        //     this.getPos();
        //     position = game.user.getFlag(TinyD6System.SYSTEM, "dieRollerPosition");
        // }

        $(this.element).css(cssPosition);
        
        this.position.left = position.left || null;
        if (this.position.left) { Math.round(this.position.left); }

        if (position.bottom) {
            this.position.top = Math.round(window.innerHeight - position.bottom);
        } else if (position.top) {
            this.position.top = Math.round(position.top);
        }

        return this;
    }

    async minimize() {
        if (!this.rendered || this.element.hasClass("collapsed")) { return this; }
        this.element.addClass("collapsed");
        return this;
    }

    async maximize() {
        if (!this.rendered || !this.element.hasClass("collapsed")) { return this; }
        this.element.removeClass("collapsed");
        return this;
    }

    /** The DieRoller never closes - it collapses instead. */
    close(options = {}) {
        return this.minimize();
    }

    activateListeners(html)
    {
        html.find(".roll-dice").on('click', this._onDieRoll.bind(this));
        html.find(".toggle-focus").on('click', this._setFocusAction.bind(this));
        html.find(".toggle-marksman").on('click', this._setMarksmanTrait.bind(this));
        html.find(".toggle-marksman").on('change', this._setMarksmanTrait.bind(this));

        html.find(".dr-act-minus").on('click', this._onActionCountChange.bind(this, -1));
        html.find(".dr-act-plus").on('click', this._onActionCountChange.bind(this, +1));
        // Делегирование: клики по ромбам (в т.ч. пересозданным после +/−)
        // обрабатываются на контейнере action-meter.
        html.find("#dr-actions-meter").on('click', '.act', this._onActionSpend.bind(this));

        html.find(".die-roller-collapse").on('click', this._onCollapse.bind(this));
        html.find(".die-roller-collapsed").on('click', this._onExpand.bind(this));

        // Move the collapsed bar out of the (hidden) window-content so it stays visible when collapsed
        this.element.append(html.find(".die-roller-collapsed"));

        let elmnt = html.find("#die-roller-move-handle");
        let dieRoller = elmnt.closest('.window-app');
        //console.log("tinyd6 | element", dieRoller);
        let newPosX = 0, newPosY = 0, startPosX = 0, startPosY = 0;

        elmnt.on("mousedown", e => {
            e = e || window.event;
            e.preventDefault();
    
            // get the starting position of the cursor
            startPosX = e.clientX;
            startPosY = e.clientY;

            // Set settings if they don't exist
        
            dieRoller[0].style = dieRoller[0].style ?? { top: (''+ math.round(startPosY) + 'px'), left: (''+ Math.round(startPosX) + 'px') };
            //console.log("tinyd6 | element", dieRoller[0].style);

            document.onmousemove = mouseMove;
            document.onmouseup = () => {
                this.pos = { top: newPosY, left: newPosX };
                game.user.setFlag(TinyD6System.SYSTEM, 'dieRollerPosition', this.pos);

                document.onmousemove = null;
                document.onmouseup = null;
            };

        });

        let mouseMove = e => {
            e = e || window.event;

            // calculate the new position
            newPosX = startPosX - e.movementX;
            newPosY = startPosY - e.movementY;

            // with each move we also want to update the start X and Y
            startPosX = e.clientX;
            startPosY = e.clientY;
        
            // set the element's new position:
            dieRoller[0].style.top = ''+ newPosY + "px";
            dieRoller[0].style.left = ''+ newPosX + "px";
        };

        super.activateListeners(html);
    }
    
    async _onDieRoll(event)
    {
        event.preventDefault();
        const element = event.currentTarget;

        const rollData = {
            numberOfDice: element.dataset.diceX,
            defaultThreshold: element.dataset.threshold,
            focusAction: element.dataset.enableFocus,
            marksmanTrait: element.dataset.enableMarksman
        };

        Dice.RollTest(rollData);
    }

    /** Клик −/+ меняет количество ромбов (действий) этого пользователя. */
    _onActionCountChange(delta, event)
    {
        event.preventDefault();
        const count = Math.max(1, this._count + delta);
        game.user.setFlag(TinyD6System.SYSTEM, "actionCounter", count);
        this._rerenderActionMeter(count);
    }

    /** Клик по ромбу тратит/возвращает только этот ромб (независимый toggle). */
    _onActionSpend(event)
    {
        event.preventDefault();
        const element = event.currentTarget;
        const index = Number(element.dataset?.actionIdx);
        if (Number.isNaN(index)) return;

        const spent = this._spent;
        const next = new Set(spent);
        if (next.has(index)) next.delete(index);
        else next.add(index);

        game.user.setFlag(TinyD6System.SYSTEM, "actionSpent", [...next]);
        element.classList.toggle("spent", next.has(index));
        element.classList.toggle("avail", !next.has(index));
    }

    /* Текущее число ромбов из флага юзера. */
    get _count() {
        const def = Number(game.settings.get(TinyD6System.SYSTEM, "defaultActions"));
        const fallback = (Number.isNaN(def) || def < 0) ? 1 : def;
        const current = Number(game.user.getFlag(TinyD6System.SYSTEM, "actionCounter"));
        return (Number.isNaN(current) || current < 0) ? fallback : Math.floor(current);
    }

    /* Текущий набор потраченных ромбов (массив индексов).
     * Старый числовой формат флага обнуляем: пользователь ведёт вручную,»
     * поэтому не «угадываем» какие индексы были потрачены. */
    get _spent() {
        const flag = game.user.getFlag(TinyD6System.SYSTEM, "actionSpent");
        if (Array.isArray(flag)) {
            return flag.filter(i => Number.isInteger(i) && i >= 0 && i < this._count);
        }
        game.user.setFlag(TinyD6System.SYSTEM, "actionSpent", []);
        return [];
    }

    /* Перерисовывает ряд ромбов под новое количество (потраченные сохраняются). */
    _rerenderActionMeter(count)
    {
        const meter = this.element.find("#dr-actions-meter");
        if (!meter.length) return;
        const spent = new Set(this._spent);
        meter.empty();
        for (let i = 0; i < count; i++) {
            const cls = spent.has(i) ? "spent" : "avail";
            meter.append(`<button type="button" class="act ${cls}" data-action-idx="${i}"></button>`);
        }
    }

    _onCollapse(event)
    {
        event.preventDefault();
        this.minimize();
    }

    _onExpand(event)
    {
        event.preventDefault();
        this.maximize();
    }

    _setFocusAction(event)
    {
        const element = event.currentTarget;
        //console.log("tinyd6 | _setFocusAction", element);

        const form = $(element.closest("form"));
        Dice.setFocusOption(form, element);
    }

    _setMarksmanTrait(event)
    {
        const element = event.currentTarget;
        //console.log("tinyd6 | _setMarksmanTrait", element);

        const form = $(element.closest("form"));
        Dice.setMarksmanOption(form, element);
    }
}