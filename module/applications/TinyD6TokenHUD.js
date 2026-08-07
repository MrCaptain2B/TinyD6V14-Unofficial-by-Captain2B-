import * as Dice from "../helpers/dice.js";
import { openStabilizeDialog, getStabilizeTarget } from "../helpers/death.js";

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
                hpStep: TinyD6TokenHUD._onHpStep,
                stabilize: TinyD6TokenHUD._onStabilize,
                healUse: TinyD6TokenHUD._onHealUse
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
        const homeruleEnabled = game.settings.get('tinyd6v14', 'enableTinyD6Plus');
        const death = actor?.system?.death;
        if (homeruleEnabled && death?.dead)
        {
            deathChip = { state: "dead", label: game.i18n.localize("tinyd6.death.dead"), icon: "fa-skull", tooltip: game.i18n.localize("tinyd6.death.dead") };
        }
        else if (homeruleEnabled && death?.dying)
        {
            const rounds = Number(death.roundsLeft) || 0;
            deathChip = {
                state: "dying",
                label: `${game.i18n.localize("tinyd6.death.dying")} · ${rounds}`,
                icon: "fa-skull-crossbones",
                tooltip: game.i18n.format("tinyd6.death.dyingHint", { rounds })
            };
        }
        else if (homeruleEnabled && death?.down)
        {
            deathChip = { state: "down", label: game.i18n.localize("tinyd6.death.down"), icon: "fa-skull-crossbones", tooltip: game.i18n.localize("tinyd6.death.down") };
        }

        // У NPC вся броня и всё оружие всегда считаются экипированными
        // (NPC не «переодевается»), у героев — только помеченные equipped.
        const npcAll = actor?.type === "npc";

        // Только «живая» броня (экипированная, с запасом прочности > 0).
        const activeArmor = (actor?.items ?? []).filter(i => (i.type === "armor") && (npcAll || i.system.equipped)
            && ((Number(i.system.armorHp?.value) || 0) > 0));
        const armorTotal = activeArmor.reduce((sum, i) => sum + (Number(i.system.damageReduction) || 0), 0);
        const armorHpTotal = activeArmor.reduce((sum, i) => sum + (Number(i.system.armorHp?.value) || 0), 0);

        // Экипированное оружие для палитры атаки/перезарядки.
        // empty = только у оружия с перезарядкой, у которого кончились заряды
        // (у ближнего uses/charges = 0, но оно не «пустое»).
        const weapons = (actor?.items ?? [])
            .filter(i => (i.type === "weapon") && (npcAll || i.system.equipped))
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

        const weaponsEnabled = homeruleEnabled;

        // Heal-гиры (gear.category = heal) с количеством для палитры лечения.
        const healItems = (actor?.items ?? [])
            .filter(i => i.type === "gear" && i.system?.category === "heal")
            .map(i => ({
                id: i.id,
                name: i.name,
                img: i.img || "icons/svg/item-bag.svg",
                heal: Dice.formatHealFormula(i.system?.heal),
                qty: Number(i.system?.quantity?.value) || 0
            }));

        const healEnabled = homeruleEnabled;
        const stabTarget = homeruleEnabled ? getStabilizeTarget(actor) : null;

        // Палитры оружия и лечения на HUD показываем только владельцам токена
        // (как HP-степеры и броню). Иначе игрок, выбравший чужой токен, увидел
        // бы кнопки Атака/Перезарядить/Лечить, которые без прав не работают.
        const owner = Boolean(actor?.isOwner);

        return foundry.utils.mergeObject(context, {
            armorIcon: "systems/tinyd6v14/assets/icons/armor.svg",
            healIcon: "systems/tinyd6v14/assets/icons/heal.svg",
            armorTotal,
            armorHpTotal,
            showArmor: actor !== undefined,
            armorEditable: actor?.isOwner ?? false,
            weapons,
            showWeapons: owner && weaponsEnabled && weapons.length > 0,
            healItems,
            showHeal: owner && healEnabled,
            showStab: owner && healEnabled,
            stabEnabled: Boolean(stabTarget),
            hasHealItems: healItems.length > 0,
            hpMax,
            hpEditable: owner,
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
        const npcAll = actor?.type === "npc";
        const items = (actor?.items ?? []).filter(i => (i.type === "armor") && (npcAll || i.system.equipped));
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
        const next = Math.max(0, Math.min(max, current + step));
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

        // Homerule: TinyD6+ — оружие без зарядов из HUD недоступно.
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

        // Homerule: TinyD6+ — выведенный из строя персонаж не может атаковать.
        if (game.settings.get('tinyd6v14', 'enableTinyD6Plus') && actor.system?.death?.down)
        {
            ui.notifications.warn(game.i18n.localize("tinyd6.death.cannotAct"));
            return;
        }
        Dice.openAttackDialog(actor, weapon);
    }

    /** Перезарядка оружия из HUD: списывает ammo-гир (рожок) и заполняет
     *  магазин до uses. Если ammo-гира нет — предупреждение, заряды не меняются. */
    static async _onWeaponReload(event, target) {
        event.preventDefault();
        const actor = this.document?.actor;
        const card = target?.closest?.("[data-weapon-id]");
        const weaponId = card?.dataset?.weaponId;
        const weapon = actor?.items?.get(weaponId);
        if (!weapon) return;

        // Анимация: крутится только иконка, затем перезаряжаем.
        target.classList.add("spin");
        await new Promise(resolve => {
            target.addEventListener("animationend", () => resolve(), { once: true });
            setTimeout(resolve, 700);
        });

        const result = await Dice.reloadWeapon(actor, weapon);
        if (!result.ok)
        {
            const reason = result.reason;
            const ammoType = weapon.system?.ammoType;
            const msg = reason === "empty"
                ? game.i18n.format("tinyd6.reload.emptyMag", { type: ammoType || "" })
                : (ammoType ? game.i18n.format("tinyd6.reload.noMag", { type: ammoType }) : game.i18n.localize("tinyd6.reload.noMagAny"));
            ui.notifications.warn(msg);
            this.render();
            return;
        }

        const isNpc = actor.type === "npc";
        const showNpcMessages = game.settings.get('tinyd6v14', 'showNpcReloadMessages');
        if (showNpcMessages || !isNpc)
        {
            await Dice.postReloadMessage(actor, weapon, result.ammo, { showForNpc: showNpcMessages });
        }
        this.render();
    }

    /** Стабилизация поверженного токена-цели из палитры Heal. */
    static async _onStabilize(event, target) {
        event.preventDefault();
        const actor = this.document?.actor;
        if (!game.settings.get('tinyd6v14', 'enableTinyD6Plus')) return;

        const stabTarget = getStabilizeTarget(actor);
        if (!stabTarget)
        {
            ui.notifications.warn(game.i18n.localize("tinyd6.stabilize.noTarget"));
            return;
        }
        openStabilizeDialog(actor, stabTarget);
    }

    /** Использование heal-гира из палитры Heal: лечит цель (или себя). */
    static async _onHealUse(event, target) {
        event.preventDefault();
        const actor = this.document?.actor;
        const card = target?.closest?.("[data-heal-id]");
        const healId = card?.dataset?.healId;
        const healItem = actor?.items?.get(healId);
        if (!actor || !healItem || healItem.system?.category !== "heal") return;

        const targets = Array.from(game.user.targets ?? []).filter(t => t.actor && t.actor.id !== actor.id);
        const targetToken = targets[0] ?? null;
        const targetActor = targetToken?.actor ?? actor;

        const healerRef = { sceneId: game.canvas?.scene?.id ?? null, tokenId: this.document?.id ?? null, actorId: actor.id };
        const targetRef = targetToken
            ? { sceneId: game.canvas?.scene?.id ?? null, tokenId: targetToken.id ?? null, actorId: targetActor.id }
            : { actorId: targetActor.id };

        const result = await Dice.useHealItem(actor, healItem, targetActor, { healerRef, targetRef });
        if (!result.ok)
        {
            const reason = result.reason;
            const msg = reason === "empty"
                ? game.i18n.localize("tinyd6.heal.empty")
                : reason === "full"
                    ? game.i18n.localize("tinyd6.heal.full")
                    : reason === "bad-formula"
                        ? game.i18n.localize("tinyd6.heal.badFormula")
                        : game.i18n.localize("tinyd6.heal.noTarget");
            ui.notifications.warn(msg);
        }
        this.render();
    }
}
