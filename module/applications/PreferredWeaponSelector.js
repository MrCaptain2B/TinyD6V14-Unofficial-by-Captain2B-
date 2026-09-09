/* Окно выбора предпочитаемого оружия NPC.
 *
 * Использует HandlebarsApplicationMixin(ApplicationV2) — тот же паттерн
 * что и MasteredWeaponSelector. Чекбоксы, toggle selection, без лимита.
 */

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export default class PreferredWeaponSelector extends HandlebarsApplicationMixin(ApplicationV2) {
    actor;

    constructor(actor, options) {
        super(options);
        this.actor = actor;
    }

    static DEFAULT_OPTIONS = {
        id: "preferred-weapon-selector",
        tag: "form",
        classes: ["tinyd6", "pref-selector"],
        window: {
            title: "tinyd6.actor.preferredWeapons",
            icon: "fa-solid fa-crosshairs",
            resizable: false,
            minimizable: false
        },
        position: { width: 340, height: "auto" },
        form: {
            handler: PreferredWeaponSelector.#_onSubmit,
            closeOnSubmit: true
        },
        actions: {}
    };

    static PARTS = {
        content: {
            template: "systems/tinyd6v14/templates/applications/preferred-weapon-selector.hbs"
        }
    };

    async _prepareContext(options) {
        const weapons = this.actor.items
            .filter(i => i.type === "weapon")
            .map(i => ({ id: i.id, name: i.name, img: i.img }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const current = this.actor.system?.preferredWeapons || [];

        return {
            weapons,
            current,
            currentIds: current
        };
    }

    static async #_onSubmit(event, form, formData) {
        // Use getAll for multiple checkboxes with same name
        let selected = formData.getAll("preferredWeapons");
        if (!Array.isArray(selected)) selected = selected ? [selected] : [];
        // No limit on preferred weapons
        await this.actor.update({ "system.preferredWeapons": selected });
    }
}
