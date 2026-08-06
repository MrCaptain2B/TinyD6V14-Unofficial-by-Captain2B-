import TinyD6ActorSheet from "./TinyD6ActorSheet.js";
import * as Dice from "../helpers/dice.js";
import { TinyD6System } from "../tinyd6.js";

export default class TinyD6HeroSheet extends TinyD6ActorSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            template: "systems/tinyd6v14/templates/sheets/hero-sheet.hbs",
            classes: [ TinyD6System.SYSTEM, "tinyd6", "sheet", "hero", game.settings.get(TinyD6System.SYSTEM, "theme"), game.settings.get(TinyD6System.SYSTEM, "sheetStyle") ]
        });
    }

    async getData() {
        const data = await super.getData();

        const itemList = data.data.items ?? data.items ?? [];
        data.data.system.heritage = itemList.filter(item => { return item.type === "heritage" })[0];
        data.data.system.xp.remaining = data.data.system.xp.max - data.data.system.xp.spent;

        data.data.system.armorTotal = 0;
        data.data.system.armorHpTotal = 0;
        data.data.system.armor.forEach((item, n) => {
            // Броня защищает, только пока у неё есть запас прочности.
            if ((Number(item.system.armorHp?.value) || 0) <= 0) return;
            data.data.system.armorTotal += item.system.damageReduction;
            data.data.system.armorHpTotal += Number(item.system.armorHp.value) || 0;
        });
        
        return data;
    }

    activateListeners(html)
    {
        html.find(".toggle-focus").click(this._setFocusAction.bind(this));
        html.find(".toggle-marksman").on('click change', this._setMarksmanTrait.bind(this));
        html.find(".corruption-box").on('click change', this._setCurrentCorruption.bind(this));
        html.find(".advancement-progress-box").on('click change', this._setAdvancementProgress.bind(this));

        html.find(".td-tab").click(this._onTabClick.bind(this));
        this._restoreActiveTab(html);

        super.activateListeners(html);
    }

    _onTabClick(event)
    {
        const tab = event.currentTarget.dataset.tab;
        this._activeTab = tab;
        this._applyActiveTab(this.element);
    }

    _restoreActiveTab(html)
    {
        if (this._activeTab)
        {
            this._applyActiveTab(html);
        }
    }

    _applyActiveTab(html)
    {
        html.find(".td-tab").removeClass("active").filter(`[data-tab="${this._activeTab}"]`).addClass("active");
        html.find(".td-pane").removeClass("active").filter(`[data-pane="${this._activeTab}"]`).addClass("active");
    }

    _setFocusAction(event)
    {
        const element = event.currentTarget;

        const form = $(element.closest("form"));
        Dice.setFocusOption(form, element);
    }

    _setMarksmanTrait(event)
    {
        const element = event.currentTarget;

        const form = $(element.closest("form"));
        Dice.setMarksmanOption(form, element);
    }

    async _setCurrentCorruption(event)
    {
        event.preventDefault();

        const element = event.currentTarget;
        const boxes = this.element.find(".corruption-box");
        const index = boxes.index(element);
        const max = parseInt(this.actor.system.corruptionThreshold.max) || 0;
        const current = parseInt(this.actor.system.corruptionThreshold.value ?? 0);

        let v;
        if (index >= current)
        {
            v = Math.min(max, index + 1);
        }
        else
        {
            v = Math.max(0, index);
        }
        if (v === current) return;

        await this.actor.update({ "system.corruptionThreshold.value": v }, { render: false });
        boxes.each((i, el) => { el.checked = i < v; });
        this._setLive("corruption", v);
    }

    async _setAdvancementProgress(event)
    {
        event.preventDefault();

        const element = event.currentTarget;
        const boxes = this.element.find(".advancement-progress-box");
        const index = boxes.index(element);
        const max = parseInt(this.actor.system.advancement.max) || 0;
        const current = parseInt(this.actor.system.advancement.value ?? 0);

        let v;
        if (index >= current)
        {
            v = Math.min(max, index + 1);
        }
        else
        {
            v = Math.max(0, index);
        }
        if (v === current) return;

        await this.actor.update({ "system.advancement.value": v }, { render: false });
        boxes.each((i, el) => { el.checked = i < v; });
    }
}