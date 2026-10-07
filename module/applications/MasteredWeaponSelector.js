/* Окно выбора мастерского оружия (Homerule: TinyD6+).
 *
 * Подход в стиле dnd5e: на листе - кнопка, открывающая отдельное окно со
 * списком всех оружий из директории мира (game.items). Игрок/мастер
 * выбирает одно оружие, и оно сохраняется в system.proficiencies.masteredWeapons.
 * При атаке с этого оружия рекомендуемый уровень броска становится
 * «преимущество» (см. suggestAttackDice).
 *
 * При передаче options.slotIndex = N окно правит только N-й слот
 * (запись в позицию массива, остальные слоты не трогаются).
 */

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export default class MasteredWeaponSelector extends HandlebarsApplicationMixin(ApplicationV2) {
    /** @type {Actor} актёр, которому настраиваем мастерство. */
    actor;

    /** @type {number|null} индекс слота, который редактируем (null - одиночный режим). */
    slotIndex = null;

    constructor(actor, options) {
        super(options);
        this.actor = actor;
        this.slotIndex = options?.slotIndex ?? null;
    }

    /** Список id мастерских оружий как массив. */
    #currentIds()
    {
        const raw = this.actor.system?.proficiencies?.masteredWeapons ?? "";
        return raw.split(",").map(s => s.trim()).filter(Boolean);
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

        const ids = this.#currentIds();
        const current = this.slotIndex != null ? (ids[this.slotIndex] ?? "") : ids.join(",");
        return {
            weapons,
            current
        };
    }

    /** Сохраняет выбранное оружие в актёра. Вызывается ядром при submit
     *  c `this`, привязанным к инстансу приложения. */
    static async #_onSubmit(event, form, formData) {
        const value = formData.get("masteredWeapons") ?? "";
        const ids = this.#currentIds();

        // Одиночный режим / legacy-поле: перезаписываем целиком.
        if (this.slotIndex == null) {
            await this.actor.update({ "system.proficiencies.masteredWeapons": value });
            return;
        }

        // Слотовый режим: меняем только свой слот, пустые значения убираем.
        if (this.slotIndex >= 0 && this.slotIndex < ids.length)
        {
            if (value === "") ids.splice(this.slotIndex, 1);
            else ids[this.slotIndex] = value;
        }
        else if (value !== "")
        {
            ids.push(value);
        }
        await this.actor.update({ "system.proficiencies.masteredWeapons": ids.join(",") });
    }
}