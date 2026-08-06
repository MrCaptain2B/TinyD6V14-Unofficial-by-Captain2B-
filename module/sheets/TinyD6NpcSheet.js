import TinyD6ActorSheet from "./TinyD6ActorSheet.js";
import { TinyD6System } from "../tinyd6.js";

export default class TinyD6NpcSheet extends TinyD6ActorSheet {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            height: null,
            template: "systems/tinyd6v14/templates/sheets/npc-sheet.hbs",
            classes: [ TinyD6System.SYSTEM, "tinyd6", "sheet", "npc", game.settings.get(TinyD6System.SYSTEM, "theme"), game.settings.get(TinyD6System.SYSTEM, "sheetStyle") ]
        });
    }

    async getData() {
        const data = await super.getData();

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
}