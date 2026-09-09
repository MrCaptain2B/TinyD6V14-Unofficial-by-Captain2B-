import * as Dice from "../helpers/dice.js";
import { openStabilizeDialog, getStabilizeTarget, roundsWord } from "../helpers/death.js";

/* РљР°СЃС‚РѕРјРЅС‹Р№ HUD С‚РѕРєРµРЅР°: СѓР±РёСЂР°РµС‚ РЅРµСЂРµР»РµРІР°РЅС‚РЅС‹Рµ РґР»СЏ TinyD6 СЌР»РµРјРµРЅС‚С‹ (РІС‹СЃРѕС‚Р°,
 * РїР°Р»РёС‚СЂС‹ СѓСЂРѕРІРЅРµР№ Рё РґРІРёР¶РµРЅРёСЏ, СЃРѕСЂС‚РёСЂРѕРІРєР°), РґРѕР±Р°РІР»СЏРµС‚ HP-СЃС‚РµРїРµСЂС‹, С‡РёРї СЃРѕСЃС‚РѕСЏРЅРёСЏ
 * СЃРјРµСЂС‚Рё Рё С€РёСЂРѕРєСѓСЋ РїР°Р»РёС‚СЂСѓ РѕСЂСѓР¶РёСЏ СЃ РєРЅРѕРїРєР°РјРё РђС‚Р°РєР° / РџРµСЂРµР·Р°СЂСЏРґРёС‚СЊ. РќР°СЃР»РµРґСѓРµС‚
 * СЃС‚РѕРєРѕРІС‹Р№ TokenHUD (РєР»Р°СЃСЃ Р±РµСЂС‘Рј РёР· CONFIG.Token.hudClass вЂ” РІРЅСѓС‚СЂРµРЅРЅРёР№ Р°Р»РёР°СЃ
 * @client РЅРµ РґРѕСЃС‚СѓРїРµРЅ РёР· СЃРёСЃС‚РµРјРЅС‹С… РјРѕРґСѓР»РµР№), РїРѕСЌС‚РѕРјСѓ СЃС‚Р°РЅРґР°СЂС‚РЅС‹Рµ РєРЅРѕРїРєРё Рё
 * РѕР±СЂР°Р±РѕС‚С‡РёРєРё СЃРѕС…СЂР°РЅСЏСЋС‚СЃСЏ. */
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

        // HP РґР»СЏ СЃС‚РµРїРїРµСЂРѕРІ Рё С‡РёРїР°.
        const wounds = actor?.system?.wounds ?? null;
        const hpMax = Number(wounds?.max) || 0;
        const hpEditable = Boolean(actor?.isOwner) && actor !== undefined;

        // Р§РёРї СЃРѕСЃС‚РѕСЏРЅРёСЏ СЃРјРµСЂС‚Рё: С‚РѕР»СЊРєРѕ С„РёРЅР°Р»СЊРЅС‹Рµ/Р°РєС‚РёРІРЅС‹Рµ СЃС‚Р°С‚СѓСЃС‹.
        let deathChip = null;
        const homeruleEnabled = game.settings.get('tinyd6v14', 'enableTinyD6Plus');
        const death = actor?.system?.death;
        if (homeruleEnabled && death?.dead)
        {
            deathChip = { state: "dead", label: game.i18n.localize("tinyd6.death.dead"), icon: "skull", tooltip: game.i18n.localize("tinyd6.death.dead") };
        }
        else if (homeruleEnabled && death?.dying)
        {
            const rounds = Number(death.roundsLeft) || 0;
            deathChip = {
                state: "dying",
                label: `${game.i18n.localize("tinyd6.death.dying")} В· ${rounds}`,
                icon: "skull-crossbones",
                tooltip: game.i18n.format("tinyd6.death.dyingHint", { rounds, word: roundsWord(rounds) })
            };
        }
        else if (homeruleEnabled && death?.down)
        {
            deathChip = { state: "down", label: game.i18n.localize("tinyd6.death.down"), icon: "skull-crossbones", tooltip: game.i18n.localize("tinyd6.death.down") };
        }

        // РЈ NPC РІСЃСЏ Р±СЂРѕРЅСЏ Рё РІСЃС‘ РѕСЂСѓР¶РёРµ РІСЃРµРіРґР° СЃС‡РёС‚Р°СЋС‚СЃСЏ СЌРєРёРїРёСЂРѕРІР°РЅРЅС‹РјРё
        // (NPC РЅРµ В«РїРµСЂРµРѕРґРµРІР°РµС‚СЃСЏВ»), Сѓ РіРµСЂРѕРµРІ вЂ” С‚РѕР»СЊРєРѕ РїРѕРјРµС‡РµРЅРЅС‹Рµ equipped.
        const npcAll = actor?.type === "npc";

        // РўРѕР»СЊРєРѕ В«Р¶РёРІР°СЏВ» Р±СЂРѕРЅСЏ (СЌРєРёРїРёСЂРѕРІР°РЅРЅР°СЏ, СЃ Р·Р°РїР°СЃРѕРј РїСЂРѕС‡РЅРѕСЃС‚Рё > 0).
        const activeArmor = (actor?.items ?? []).filter(i => (i.type === "armor") && (npcAll || i.system.equipped)
            && ((Number(i.system.armorHp?.value) || 0) > 0));
        const armorTotal = activeArmor.reduce((sum, i) => sum + (Number(i.system.damageReduction) || 0), 0);
        const armorHpTotal = activeArmor.reduce((sum, i) => sum + (Number(i.system.armorHp?.value) || 0), 0);

        // Р­РєРёРїРёСЂРѕРІР°РЅРЅРѕРµ РѕСЂСѓР¶РёРµ РґР»СЏ РїР°Р»РёС‚СЂС‹ Р°С‚Р°РєРё/РїРµСЂРµР·Р°СЂСЏРґРєРё.
        // empty = С‚РѕР»СЊРєРѕ Сѓ РѕСЂСѓР¶РёСЏ СЃ РїРµСЂРµР·Р°СЂСЏРґРєРѕР№, Сѓ РєРѕС‚РѕСЂРѕРіРѕ РєРѕРЅС‡РёР»РёСЃСЊ Р·Р°СЂСЏРґС‹
        // (Сѓ Р±Р»РёР¶РЅРµРіРѕ uses/charges = 0, РЅРѕ РѕРЅРѕ РЅРµ В«РїСѓСЃС‚РѕРµВ»).
        // РЈ NPC: С‚РѕР»СЊРєРѕ preferredWeapons (РµСЃР»Рё Р·Р°РґР°РЅС‹), РёРЅР°С‡Рµ РІСЃРµ.
        let weaponItems = (actor?.items ?? [])
            .filter(i => (i.type === "weapon") && (npcAll || i.system.equipped));

        if (npcAll) {
            const preferredIds = actor.system?.preferredWeapons || [];
            if (preferredIds.length > 0) {
                weaponItems = weaponItems.filter(i => preferredIds.includes(i.id));
            }
        }

        const weapons = weaponItems
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

        // Heal-РіРёСЂС‹ (gear.category = heal) СЃ РєРѕР»РёС‡РµСЃС‚РІРѕРј РґР»СЏ РїР°Р»РёС‚СЂС‹ Р»РµС‡РµРЅРёСЏ.
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

        // РџР°Р»РёС‚СЂС‹ РѕСЂСѓР¶РёСЏ Рё Р»РµС‡РµРЅРёСЏ РЅР° HUD РїРѕРєР°Р·С‹РІР°РµРј С‚РѕР»СЊРєРѕ РІР»Р°РґРµР»СЊС†Р°Рј С‚РѕРєРµРЅР°
        // (РєР°Рє HP-СЃС‚РµРїРµСЂС‹ Рё Р±СЂРѕРЅСЋ). РРЅР°С‡Рµ РёРіСЂРѕРє, РІС‹Р±СЂР°РІС€РёР№ С‡СѓР¶РѕР№ С‚РѕРєРµРЅ, СѓРІРёРґРµР»
        // Р±С‹ РєРЅРѕРїРєРё РђС‚Р°РєР°/РџРµСЂРµР·Р°СЂСЏРґРёС‚СЊ/Р›РµС‡РёС‚СЊ, РєРѕС‚РѕСЂС‹Рµ Р±РµР· РїСЂР°РІ РЅРµ СЂР°Р±РѕС‚Р°СЋС‚.
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

    /** Р РµРґР°РєС‚РёСЂРѕРІР°РЅРёРµ РїРѕР»СЏ Р±СЂРѕРЅРё (DR РёР»Рё HP) РїСЂСЏРјРѕ РёР· HUD. */
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

        // РџРµСЂРµР·Р°РїРёСЃС‹РІР°РµРј СЃСѓРјРјСѓ СЃ РґРµР»СЊС‚РѕР№ РїРѕ РїСЂРµРґРјРµС‚Р°Рј Р±СЂРѕРЅРё/С‰РёС‚РѕРІ.
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

    /** HP-СЃС‚РµРїРµСЂ: в€’1 / +1 HP Р·Р° РєР»РёРє (РїРѕС€Р°РіРѕРІРѕ, РєР°Рє РІ Р»РёСЃС‚Рµ). */
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

    /** Р—Р°РїСѓСЃРє Р°С‚Р°РєРё РІС‹Р±СЂР°РЅРЅС‹Рј РѕСЂСѓР¶РёРµРј РёР· РїР°Р»РёС‚СЂС‹ HUD. */
    static async _onWeaponAttack(event, target) {
        event.preventDefault();
        const actor = this.document?.actor;
        const card = target?.closest?.("[data-weapon-id]");
        const weaponId = card?.dataset?.weaponId;
        const weapon = actor?.items?.get(weaponId);
        if (!weapon) return;

        // Homerule: TinyD6+ вЂ” РѕСЂСѓР¶РёРµ Р±РµР· Р·Р°СЂСЏРґРѕРІ РёР· HUD РЅРµРґРѕСЃС‚СѓРїРЅРѕ.
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

        // Homerule: TinyD6+ вЂ” РІС‹РІРµРґРµРЅРЅС‹Р№ РёР· СЃС‚СЂРѕСЏ РїРµСЂСЃРѕРЅР°Р¶ РЅРµ РјРѕР¶РµС‚ Р°С‚Р°РєРѕРІР°С‚СЊ.
        if (game.settings.get('tinyd6v14', 'enableTinyD6Plus') && actor.system?.death?.down)
        {
            ui.notifications.warn(game.i18n.localize("tinyd6.death.cannotAct"));
            return;
        }
        Dice.openAttackDialog(actor, weapon);
    }

    /** РџРµСЂРµР·Р°СЂСЏРґРєР° РѕСЂСѓР¶РёСЏ РёР· HUD: СЃРїРёСЃС‹РІР°РµС‚ ammo-РіРёСЂ (СЂРѕР¶РѕРє) Рё Р·Р°РїРѕР»РЅСЏРµС‚
     *  РјР°РіР°Р·РёРЅ РґРѕ uses. Р•СЃР»Рё ammo-РіРёСЂР° РЅРµС‚ вЂ” РїСЂРµРґСѓРїСЂРµР¶РґРµРЅРёРµ, Р·Р°СЂСЏРґС‹ РЅРµ РјРµРЅСЏСЋС‚СЃСЏ. */
    static async _onWeaponReload(event, target) {
        event.preventDefault();
        const actor = this.document?.actor;
        const card = target?.closest?.("[data-weapon-id]");
        const weaponId = card?.dataset?.weaponId;
        const weapon = actor?.items?.get(weaponId);
        if (!weapon) return;

        // РђРЅРёРјР°С†РёСЏ: РєСЂСѓС‚РёС‚СЃСЏ С‚РѕР»СЊРєРѕ РёРєРѕРЅРєР°, Р·Р°С‚РµРј РїРµСЂРµР·Р°СЂСЏР¶Р°РµРј.
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

    /** РЎС‚Р°Р±РёР»РёР·Р°С†РёСЏ РїРѕРІРµСЂР¶РµРЅРЅРѕРіРѕ С‚РѕРєРµРЅР°-С†РµР»Рё РёР· РїР°Р»РёС‚СЂС‹ Heal. */
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

    /** РСЃРїРѕР»СЊР·РѕРІР°РЅРёРµ heal-РіРёСЂР° РёР· РїР°Р»РёС‚СЂС‹ Heal: Р»РµС‡РёС‚ С†РµР»СЊ (РёР»Рё СЃРµР±СЏ). */
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

