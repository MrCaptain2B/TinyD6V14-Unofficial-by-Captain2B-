import * as Dice from "../helpers/dice.js";

export default class TinyD6ActorSheet extends ActorSheet {
    async getData() {
        const data = super.getData();

        data.config = CONFIG.tinyd6;
        data.config.heritageHeaderPath = `tinyd6.actor.${data.config.theme}.heritage.header`;
        data.config.characterHeaderPath = `tinyd6.actor.${data.config.theme}.character`;
        data.config.heritageTraitPath = `tinyd6.actor.${data.config.theme}.heritage.traits`;
        data.config.heritageDeleteTooltipPath = `tinyd6.actor.${data.config.theme}.heritage.delete`;

        // Determine optional element display based on settings
        data.config.enableCorruption = game.settings.get('tinyd6v14', 'enableCorruption');
        data.config.advancementMethod = game.settings.get('tinyd6v14', 'enableAdvancement');
        
        data.data.system.owner = this.actor.isOwner;

        // Старые актёры могут не иметь поля actions — подставляем дефолт из настроек.
        if (!data.data.system.actions)
        {
            const def = Number(game.settings.get('tinyd6v14', 'defaultActions'));
            data.data.system.actions = { value: 0, max: Number.isNaN(def) ? 1 : Math.max(0, def) };
        }
        data.data.system.traits = data.data.items.filter(item => { return item.type === "trait" });
        data.data.system.weapons = data.data.items.filter(item => { return item.type === "weapon" && item.system.equipped });
        data.data.system.armor = data.data.items.filter(item => { return item.type === "armor" && item.system.equipped });
        data.data.system.gear = data.data.items.filter(item => { return item.type !== "trait" && item.type !== "heritage" });
        data.data.system.heritage = data.data.items.find(item => { return item.type === "heritage" }) ?? null;

        data.rollData = this.actor.getRollData();
        data.descriptionHTML = await TextEditor.enrichHTML(this.actor.system.description,
            { secrets: this.actor.isOwner, async: true, rollData: data.rollData });

        return data;
    }

    activateListeners(html)
    {
        super.activateListeners(html);

        html.find(".item-add").click(this._onItemCreate.bind(this));
        html.find(".item-show").click(this._onItemShow.bind(this));
        html.find(".item-delete").click(this._onItemDelete.bind(this));
        html.find(".item-equip").click(this._onItemEquip.bind(this));
        html.find(".item-chat").click(this._onItemChat.bind(this));
        html.find(".roll-dice").click(this._onDieRoll.bind(this));
        html.find(".weapon-attack").click(this._onWeaponAttack.bind(this));
        html.find(".weapon-reload").click(this._onWeaponReload.bind(this));
        html.find(".armor-restore").click(this._onArmorRestore.bind(this));
        html.find(".armor-hp-input").on('change', this._onArmorHpEdit.bind(this));

        html.find(".health-box").on('click', this._setCurrentDamage.bind(this));

        html.find(".action-meter .act").on('click', this._setCurrentAction.bind(this));
        html.find(".actions-btns .plus").click(this._onActionPlus.bind(this));
        html.find(".actions-btns .minus").click(this._onActionMinus.bind(this));
    }

    async _onDieRoll(event)
    {
        event.preventDefault();
        const element = event.currentTarget;

        const rollData = {
            numberOfDice: element.dataset.diceX,
            defaultThreshold: element.dataset.threshold,
            focusAction: element.dataset.enableFocus,
            marksmanTrait: element.dataset.enableMarksman
        };

        //TinyD6System.emit('dieRoll', rollData);
        Dice.RollTest(rollData);
    }

    _onItemCreate(event)
    {
        event.preventDefault();
        let element = event.currentTarget;

        let itemData = {
            name: game.i18n.localize("tinyd6.sheet.newItem"),
            img: CONFIG.tinyd6.defaultItemImage,
            type: element.dataset.type
        };

    
        return this.actor.createEmbeddedDocuments('Item', [ itemData ]);
    }

    _onItemDelete(event)
    {
        event.preventDefault();
        let element = event.currentTarget;
        let itemId = element.closest("[data-item-id]").dataset.itemId;
        return this.actor.items.get(itemId).delete();
    }

    _onItemShow(event)
    {
        event.preventDefault();
        let element = event.currentTarget;
        let itemId = element.closest("[data-item-id]").dataset.itemId;
        let item = this.actor.items.get(itemId);

        item.sheet.render(true);
    }

    _onWeaponAttack(event)
    {
        event.preventDefault();
        const element = event.currentTarget;
        const weaponId = element.closest("[data-weapon-id]").dataset.weaponId;
        const weapon = this.actor.items.get(weaponId);
        if (!weapon) return;

        Dice.openAttackDialog(this.actor, weapon);
    }

    /* Перезарядка оружия (кнопка ↻): сбрасывает заряды до максимума и
     * выводит в чат «(actor) перезарядил (weapon)». Не тратит действие.
     * Для NPC сообщение в чат выводится только если включено в настройках.
     * Лист обновляется автоматически хуком updateItem. */
    async _onWeaponReload(event)
    {
        event.preventDefault();
        const element = event.currentTarget;
        const weaponId = element.closest("[data-weapon-id]").dataset.weaponId;
        const weapon = this.actor.items.get(weaponId);
        if (!weapon) return;

        const max = Number(weapon.system.uses) || 0;

        // Анимация: крутится только иконка, затем сбрасываем заряды.
        element.classList.add("spin");
        await new Promise(resolve => {
            element.addEventListener("animationend", () => resolve(), { once: true });
            setTimeout(resolve, 700);
        });

        await weapon.update({ "system.charges": max }, { render: false });

        const isNpc = this.actor.type === "npc";
        const showNpcMessages = game.settings.get('tinyd6v14', 'showNpcReloadMessages');
        if (showNpcMessages || !isNpc)
        {
            const speaker = ChatMessage.getSpeaker({ actor: this.actor });
            await ChatMessage.create({
                speaker,
                content: `<div class="tinyd6 reload-stub"><i class="fas fa-undo-alt"></i> <b>${this.actor.name}</b> ${game.i18n.localize("tinyd6.reload.reloaded")} <b>${weapon.name}</b></div>`
            });
        }
    }

    async _onItemChat(event)
    {
        event.preventDefault();
        let element = event.currentTarget;
        let itemId = element.closest("[data-item-id]").dataset.itemId;
        let item = this.actor.items.get(itemId);

        if (!item)
        {
            element.closest(".actor-item")?.remove();
            return;
        }

        const description = item.system?.description || item.system?.trait || "";
        const cardContent = await renderTemplate("systems/tinyd6v14/templates/partials/item-card.hbs",
        {
            item: item,
            name: item.name,
            img: item.img,
            descriptionHTML: await TextEditor.enrichHTML(description,
                { secrets: this.actor.isOwner, async: true, rollData: this.actor.getRollData() })
        });

        const chatData = {
            user: game.user.id,
            speaker: ChatMessage.getSpeaker({ actor: this.actor }),
            content: cardContent
        };

        return ChatMessage.create(chatData);
    }

    _onItemEquip(event)
    {
        event.preventDefault();
        let element = event.currentTarget;
        let itemId = element.closest("[data-item-id]").dataset.itemId;
        let item = this.actor.items.get(itemId);

        item.update({ "system.equipped": !item.system.equipped });
    }

    _toggleActionButton(event)
    {
        const element = event.element;
        element.getElementsByClassName('.hidden').toggleClass('hidden');
    }

    async _setCurrentDamage(event)
    {
        event.preventDefault();

        // Определяем значение по индексу кликнутого бокса, а не по состоянию
        // чекбокса (preventDefault на клике не гарантирует переключение checked).
        const element = event.currentTarget;
        const boxes = this.element.find(".health-box");
        const index = boxes.index(element);
        const max = parseInt(this.actor.system.wounds.max) || 0;
        const currentDamage = parseInt(this.actor.system.wounds.value ?? 0);

        // Пошаговое изменение HP на 1 за клик: клик по заполненному (активному)
        // боксу снимает 1 HP (граница уходит влево), клик по пустому боксу
        // справа лечит на 1 HP (граница уходит вправо). Так нельзя снять весь
        // запас одним кликом по левому боксу.
        let newValue;
        if (index < currentDamage)
        {
            newValue = Math.max(0, currentDamage - 1);
        }
        else
        {
            newValue = Math.min(max, currentDamage + 1);
        }
        if (newValue === currentDamage) return;

        // Обновляем данные и дожидаемся применения, иначе лист героя
        // (настоящий актёр) перерисовывается со старым значением HP и ручная
        // синхронизация боксов затирается (последний бокс не закрашивается).
        await this.actor.update({ "system.wounds.value": newValue }, { render: false });
        this._setLive("wounds", `${newValue}/${max}`);
        this.element.find(".health-box").each((i, el) => { el.checked = i < newValue; });
    }

    /* Обновляет «живые» значения (data-live) в шапке листа без перерисовки. */
    _setLive(attr, text)
    {
        this.element.find(`[data-live="${attr}"]`).text(text);
    }

    /* Трата/возврат действия по клику на фигуру. Считаем по индексу
     * кликнутой фигуры (как у health-box): клик правее текущего значения
     * тратит действие, левее — возвращает. */
    async _setCurrentAction(event)
    {
        event.preventDefault();
        if (!this.actor.system.actions) await this._ensureActions();
        const element = event.currentTarget;
        const boxes = this.element.find(".action-meter .act");
        const index = boxes.index(element);
        const max = parseInt(this.actor.system.actions?.max) || 0;
        const current = parseInt(this.actor.system.actions?.value ?? 0);

        let newValue;
        if (index >= current)
        {
            newValue = Math.min(max, index + 1);
        }
        else
        {
            newValue = Math.max(0, index);
        }
        if (newValue === current) return;

        await this.actor.update({ "system.actions.value": newValue }, { render: false });
        boxes.each((i, el) => { el.classList.toggle("spent", i < newValue); el.classList.toggle("avail", i >= newValue); });
    }

    /* Если у актёра ещё нет поля actions (старые актёры до введения виджета) —
     * инициализируем его значением из настроек мира, чтобы счёт начинался
     * с дефолта системы, а не с 0. */
    async _ensureActions()
    {
        if (this.actor.system.actions) return;
        const def = Number(game.settings.get('tinyd6v14', 'defaultActions'));
        const max = Number.isNaN(def) ? 1 : Math.max(0, def);
        await this.actor.update({ "system.actions": { value: 0, max } }, { render: false });
    }

    /* Увеличить максимум действий (+1) для владельца. */
    async _onActionPlus(event)
    {
        event.preventDefault();
        await this._ensureActions();
        const max = Math.min(12, (parseInt(this.actor.system.actions?.max) || 0) + 1);
        await this.actor.update({ "system.actions.max": max }, { render: false });
        this._syncActionBoxes();
    }

    /* Уменьшить максимум действий (−1) для владельца, без превышения значения. */
    async _onActionMinus(event)
    {
        event.preventDefault();
        await this._ensureActions();
        const max = Math.max(0, (parseInt(this.actor.system.actions?.max) || 0) - 1);
        const value = Math.min(parseInt(this.actor.system.actions?.value ?? 0), max);
        await this.actor.update({ "system.actions.max": max, "system.actions.value": value }, { render: false });
        this._syncActionBoxes();
    }

    /* Синхронизирует отрисованные фигуры с текущим значением после изменения
     * максимума: если фигур стало больше/меньше — перерисовываем лист, иначе
     * только переключаем классы. */
    _syncActionBoxes()
    {
        const max = parseInt(this.actor.system.actions?.max) || 0;
        const value = parseInt(this.actor.system.actions?.value ?? 0);
        const boxes = this.element.find(".action-meter .act");
        if (boxes.length !== max) {
            this.render(false);
            return;
        }
        boxes.each((i, el) => { el.classList.toggle("spent", i < value); el.classList.toggle("avail", i >= value); });
    }

    /* Полное восстановление запаса прочности всей экипированной брони
     * (armorHp.value = armorHp.max) для всех предметов брони актёра. */
    async _onArmorRestore(event)
    {
        event.preventDefault();
        const armorItems = (this.actor.items ?? []).filter(i => i.type === "armor" && i.system?.equipped);
        if (!armorItems.length) return;

        // Анимация: крутится только иконка, затем восстанавливаем броню.
        const element = event.currentTarget;
        element.classList.add("spin");
        await new Promise(resolve => {
            element.addEventListener("animationend", () => resolve(), { once: true });
            setTimeout(resolve, 700);
        });

        const updates = armorItems
            .filter(i => Number(i.system.armorHp?.max) > 0)
            .map(i => ({ _id: i.id, "system.armorHp.value": Number(i.system.armorHp.max) || 0 }));
        if (!updates.length) return;

        await this.actor.updateEmbeddedDocuments("Item", updates);
        this.render(false);
    }

    /* Редактирование суммарного HP брони в инвентаре: распределяем дельту
     * по экипированным предметам брони (как на HUD токена), не превышая
     * максимум каждого предмета. */
    async _onArmorHpEdit(event)
    {
        const target = Math.max(0, Number(event.currentTarget.value) || 0);
        const armorItems = (this.actor.items ?? []).filter(i => i.type === "armor" && i.system?.equipped);
        if (!armorItems.length) { this.render(false); return; }

        const current = armorItems.reduce((s, i) => s + (Number(i.system.armorHp?.value) || 0), 0);
        let delta = target - current;
        const updates = [];
        for (const item of armorItems) {
            if (delta === 0) break;
            const cur = Number(item.system.armorHp?.value) || 0;
            const max = Number(item.system.armorHp?.max) || cur;
            let next = Math.max(0, cur + delta);
            next = Math.min(next, max);
            updates.push({ _id: item.id, "system.armorHp.value": Math.max(0, next) });
            delta -= (next - cur);
        }
        if (updates.length) await this.actor.updateEmbeddedDocuments("Item", updates);
        this.render(false);
    }
}
