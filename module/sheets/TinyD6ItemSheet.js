import { TinyD6System } from "../tinyd6.js";

export default class TinyD6ItemSheet extends ItemSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: [ TinyD6System.SYSTEM, "tinyd6", "sheet", "item", game.settings.get(TinyD6System.SYSTEM, "theme") ]
        });
    }

    get template() {
        return `systems/tinyd6v14/templates/sheets/${this.document.type}-sheet.hbs`;
    }

    async getData() {
        const data = super.getData();

        data.data.traits = {};
        data.config = CONFIG.tinyd6;
        data.config.enableReloadHomerule = game.settings.get('tinyd6v14', 'enableReloadHomerule');

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