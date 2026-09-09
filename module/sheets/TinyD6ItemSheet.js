import { TinyD6System } from "../tinyd6.js";

export default class TinyD6ItemSheet extends ItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: [ TinyD6System.SYSTEM, "tinyd6", "sheet", "item", game.settings.get(TinyD6System.SYSTEM, "theme") ]
        });
    }

    get template() {
        const type = this.document.type === "shield" ? "armor" : this.document.type;
        return `systems/tinyd6v14/templates/sheets/${type}-sheet.hbs`;
    }

    async getData() {
        const data = super.getData();

        data.data.traits = {};
        data.config = CONFIG.tinyd6;
        data.config.enableTinyD6Plus = game.settings.get('tinyd6v14', 'enableTinyD6Plus');

        // Список типов патронов для выпадашки в листе оружия: уникальные
        // ammoType из всех ammo-гиров мира и (если есть) владельца предмета.
        const ammoTypes = new Set();
        for (const item of game.items ?? [])
        {
            if (item.type === "gear" && item.system?.category === "ammo" && item.system?.ammoType)
                ammoTypes.add(item.system.ammoType);
        }
        if (this.item.parent?.items)
        {
            for (const item of this.item.parent.items)
            {
                if (item.type === "gear" && item.system?.category === "ammo" && item.system?.ammoType)
                    ammoTypes.add(item.system.ammoType);
            }
        }
        data.config.ammoTypes = [...ammoTypes].sort();

        // Миграция старых оружий: два поля (damageType + group) -> один weaponType.
        if (this.item.type === "weapon")
        {
            const sys = this.item.system;
            if (!sys.weaponType && (sys.damageType || sys.group))
            {
                sys.weaponType = `${sys.damageType || "light"}${sys.group || "melee"}`;
            }
        }

        data.rollData = this.item.getRollData();
        data.descriptionHTML = await TextEditor.enrichHTML(this.item.system.description,
            { secrets: this.item.isOwner, async: true, rollData: data.rollData });
        if (this.item.system.trait)
            data.traitHTML = await TextEditor.enrichHTML(this.item.system.trait,
                { secrets: this.item.isOwner, async: true, rollData: data.rollData });

        return data;
    }
}