import * as Dice from "../helpers/dice.js";

/* Кастомный HUD токена: убирает нерелевантные для TinyD6 элементы (высота,
 * палитры уровней и движения, сортировка), добавляет HP-степеры, чип состояния
 * смерти и широкую палитру оружия с кнопками Атака / Перезарядить. Наследует
 * стоковый TokenHUD (класс берём из CONFIG.Token.hudClass — внутренний алиас
 * @client не доступен из системных модулей), поэтому стандартные кнопки и
 * обработчики сохраняются. */
export default class TinyD6TokenHUD extends CONFIG.Token.hudClass {

    /** @override */
    static PARTS = {
        hud: {
            root: true,
            template: "systems/tinyd6v14/templates/hud/token-hud.hbs"
        }
    };

    /** @inheritDoc */
    static get DEFAULT_OPTIONS() {
        return foundry.utils.mergeObject(super.DEFAULT_OPTIONS, {
            actions: {
                weaponAttack: TinyD6TokenHUD._onWeaponAttack,
                weaponReload: TinyD6TokenHUD._onWeaponReload,
                hpStep: TinyD6TokenHUD._onHpStep
            }
        });
    }

    /** @inheritDoc */
    async _prepareContext(options) {
        const context = await super._prepareContext(options);
        const actor = this.document?.actor;

        // HP для степперов и чипа.
        const wounds = actor?.system?.wounds ?? null;
        const hpMax = Number(wounds?.max) || 0;
        const hpEditable = Boolean(actor?.isOwner) && actor !== undefined;

        // Чип состояния смерти: только финальные/активные статусы.
        let deathChip = null;
        const death = actor?.system?.death;
        if (death?.dead)
        {
            deathChip = { state: "dead", label: game.i18n.localize("tinyd6.death.dead"), icon: "fa-skull", tooltip: game.i18n.localize("tinyd6.death.dead") };
        }
        else if (death?.dying)
        {
            const rounds = Number(death.roundsLeft) || 0;
            deathChip = {
                state: "dying",
                label: `${game.i18n.localize("tinyd6.death.dying")} · ${rounds}`,
                icon: "fa-skull-crossbones",
                tooltip: game.i18n.format("tinyd6.death.dyingHint", { rounds })
            };
        }
        else if (death?.down)
        {
            deathChip = { state: "down", label: game.i18n.localize("tinyd6.death.down"), icon: "fa-skull-crossbones", tooltip: game.i18n.localize("tinyd6.death.down") };
        }

        // Только «живая» броня (экипированная, с запасом прочности > 0).
        const activeArmor = (actor?.items ?? []).filter(i => (i.type === "armor") && i.system.equipped
            && ((Number(i.system.armorHp?.value) || 0) > 0));
        const armorTotal = activeArmor.reduce((sum, i) => sum + (Number(i.system.damageReduction) || 0), 0);
        const armorHpTotal = activeArmor.reduce((sum, i) => sum + (Number(i.system.armorHp?.value) || 0), 0);

        // Экипированное оружие для палитры атаки/перезарядки.
        // empty = только у оружия с перезарядкой, у которого кончились заряды
        // (у ближнего uses/charges = 0, но оно не «пустое»).
        const weapons = (actor?.items ?? [])
            .filter(i => (i.type === "weapon") && i.system.equipped)
            .map(i => {
                const reload = Boolean(i.system.reload);
                const uses = Number(i.system.uses) || 0;
                const charges = (i.system.charges !== undefined && i.system.charges !== null)
                    ? Number(i.system.charges) : uses;
                return {
                    id: i.id,
                    name: i.name,
                    img: i.img || "icons/svg/sword.svg",
                    reload,
                    uses,
                    charges,
                    empty: reload && (charges <= 0)
                };
            });

        return foundry.utils.mergeObject(context, {
            armorIcon: "systems/tinyd6v14/assets/icons/armor.svg",
            armorTotal,
            armorHpTotal,
            showArmor: actor !== undefined,
            armorEditable: actor?.isOwner ?? false,
            weapons,
            showWeapons: weapons.length > 0,
            hpMax,
            hpEditable,
            deathChip
        });
    }

    /** @inheritDoc */
    _onRender(context, options) {
        super._onRender(context, options);
        this.element.querySelectorAll("[data-edit-attr]")
            .forEach(el => el.addEventListener("change", this._onArmorEdit.bind(this)));
    }

    /** Редактирование поля брони (DR или HP) прямо из HUD. */
    async _onArmorEdit(event) {
        event.preventDefault();
        const attr = event.currentTarget.dataset.editAttr; // "dr" | "hp"
        const actor = this.document?.actor;
        const items = (actor?.items ?? []).filter(i => (i.type === "armor") && i.system.equipped);
        if (!items.length || !actor?.isOwner) return;

        const target = Math.max(0, Number(event.currentTarget.value) || 0);
        const current = attr === "dr"
            ? items.reduce((s, i) => s + (Number(i.system.damageReduction) || 0), 0)
            : items.reduce((s, i) => s + (Number(i.system.armorHp?.value) || 0), 0);

        // Перезаписываем сумму с дельтой по предметам брони.
        let delta = target - current;
        const updates = [];
        for (const item of items) {
            if (delta === 0) break;
            const cur = attr === "dr" ? (Number(item.system.damageReduction) || 0)
                : (Number(item.system.armorHp?.value) || 0);
            let next = Math.max(0, cur + delta);
            if (attr === "hp") next = Math.min(next, Number(item.system.armorHp?.max) || next);
            updates.push({ _id: item.id, system: { [attr === "dr" ? "damageReduction" : "armorHp"]: attr === "hp" ? { ...item.system.armorHp, value: next } : next } });
            delta -= (next - cur);
        }
        if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
        this.render();
    }

    /** HP-степер: −1 / +1 HP за клик (пошагово, как в листе). */
    static async _onHpStep(event, target) {
        event.preventDefault();
        const actor = this.document?.actor;
        if (!actor?.isOwner) return;
        const wounds = actor.system?.wounds;
        if (!wounds) return;

        const step = Number(target?.dataset?.step) || 0;
        if (step === 0) return;
        const current = Number(wounds.value) || 0;
        const max = Number(wounds.max) || current;
        const next = Math.clamp(current + step, 0, max);
        if (next === current) return;
        await actor.update({ "system.wounds.value": next }, { render: false });
        this.render();
    }

    /** Запуск атаки выбранным оружием из палитры HUD. */
    static async _onWeaponAttack(event, target) {
        event.preventDefault();
        const actor = this.document?.actor;
        const card = target?.closest?.("[data-weapon-id]");
        const weaponId = card?.dataset?.weaponId;
        const weapon = actor?.items?.get(weaponId);
        if (!weapon) return;

        // Homerule: Reloading — оружие без зарядов из HUD недоступно.
        if (weapon.system.reload)
        {
            const charges = (weapon.system.charges !== undefined && weapon.system.charges !== null)
                ? Number(weapon.system.charges) : (Number(weapon.system.uses) || 0);
            if (charges <= 0)
            {
                ui.notifications.warn(game.i18n.localize("tinyd6.reload.outOfAmmo"));
                return;
            }
        }

        // Homerule: Death — выведенный из строя персонаж не может атаковать.
        if (game.settings.get('tinyd6v14', 'enableDeathHomerule') && actor.system?.death?.down)
        {
            ui.notifications.warn(game.i18n.localize("tinyd6.death.cannotAct"));
            return;
        }
        Dice.openAttackDialog(actor, weapon);
    }

    /** Перезарядка оружия из HUD: сбрасывает заряды до максимума (uses). */
    static async _onWeaponReload(event, target) {
        event.preventDefault();
        const actor = this.document?.actor;
        const card = target?.closest?.("[data-weapon-id]");
        const weaponId = card?.dataset?.weaponId;
        const weapon = actor?.items?.get(weaponId);
        if (!weapon) return;

        // Анимация: крутится только иконка, затем сбрасываем заряды.
        target.classList.add("spin");
        await new Promise(resolve => {
            target.addEventListener("animationend", () => resolve(), { once: true });
            setTimeout(resolve, 700);
        });

        await weapon.update({ "system.charges": Number(weapon.system.uses) || 0 }, { render: false });

        const isNpc = actor.type === "npc";
        const showNpcMessages = game.settings.get('tinyd6v14', 'showNpcReloadMessages');
        if (showNpcMessages || !isNpc)
        {
            const speaker = ChatMessage.getSpeaker({ actor });
            await ChatMessage.create({
                speaker,
                content: `<div class="tinyd6 reload-stub"><i class="fas fa-undo-alt"></i> <b>${actor.name}</b> ${game.i18n.localize("tinyd6.reload.reloaded")} <b>${weapon.name}</b></div>`
            });
        }
        this.render();
    }
}
