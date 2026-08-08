/* Окно выбора мастерского оружия (Homerule: TinyD6+).
 *
 * Подход в стиле dnd5e: на листе — кнопка, открывающая отдельное окно со
 * списком всех оружий из директории мира (game.items). Игрок/мастер
 * выбирает одно оружие, и оно сохраняется в system.proficiencies.masteredWeapons.
 * При атаке с этого оружия рекомендуемый уровень броска становится
 * «преимущество» (см. suggestAttackDice).
 */

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export default class MasteredWeaponSelector extends HandlebarsApplicationMixin(ApplicationV2) {
    /** @type {Actor} актёр, которому настраиваем мастерство. */
    actor;

    constructor(actor, options) {
        super(options);
        this.actor = actor;
    }

    static DEFAULT_OPTIONS = {
        id: "mastered-weapon-selector",
        tag: "form",
        classes: [ "tinyd6", "mastered-selector" ],
        window: {
            title: "tinyd6.actor.proficiencies.mastered",
            icon: "fa-solid fa-crosshairs",
            resizable: false,
            minimizable: false
        },
        position: { width: 420, height: "auto" },
        form: {
            handler: MasteredWeaponSelector.#_onSubmit,
            closeOnSubmit: true
        },
        actions: {}
    };

    /** Рендерим одну часть через Handlebars-шаблон. */
    static PARTS = {
        content: {
            template: "systems/tinyd6v14/templates/applications/mastered-weapon-selector.hbs"
        }
    };

    async _prepareContext(options) {
        // Все оружия мира (директория Item), отсортированные по имени.
        const weapons = game.items.filter(item => item.type === "weapon")
            .map(item => ({ id: item.id, name: item.name }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const current = this.actor.system?.proficiencies?.masteredWeapons ?? "";
        return {
            weapons,
            current
        };
    }

    /** Сохраняет выбранное оружие в актёра. Вызывается ядром при submit
     *  c `this`, привязанным к инстансу приложения. */
    static async #_onSubmit(event, form, formData) {
        const value = formData.get("masteredWeapons") ?? "";
        await this.actor.update({ "system.proficiencies.masteredWeapons": value });
    }
}