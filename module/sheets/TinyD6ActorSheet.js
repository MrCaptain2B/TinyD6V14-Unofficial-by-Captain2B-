import * as Dice from "../helpers/dice.js";
import { openStabilizeDialog, getStabilizeTarget } from "../helpers/death.js";
import MasteredWeaponSelector from "../applications/MasteredWeaponSelector.js";

export default class TinyD6ActorSheet extends ActorSheet {
    /**
     * Core issue workaround: opening a sheet by double-clicking a token passes
     * the TokenDocument itself in the render options. Application#_render merges
     * those options into this.options with mergeObject, and once the document is
     * stored there, any later re-render tries to write its read-only _id
     * property, throwing
     * "Cannot assign to read only property '_id' of object '#<TokenDocument>'"
     * Keep the token document out of the merged options instead.
     */
    async _render(force = false, options = {}) {
        const isDocument = (value) => value instanceof foundry.abstract.Document;

        if (options.token && isDocument(options.token)) {
            this._tokenDocument = options.token;
            options = { ...options };
            delete options.token;
        }

        if (this.options.token && isDocument(this.options.token)) {
            this._tokenDocument ??= this.options.token;
            delete this.options.token;
        }

        return super._render(force, options);
    }

    get token() {
        return this._tokenDocument ?? super.token;
    }

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
        data.config.enableTinyD6Plus = game.settings.get('tinyd6v14', 'enableTinyD6Plus');
        
        data.data.system.owner = this.actor.isOwner;

        // Старые актёры могут не иметь поля actions — подставляем дефолт из настроек.
        if (!data.data.system.actions)
        {
            const def = Number(game.settings.get('tinyd6v14', 'defaultActions'));
            data.data.system.actions = { value: 0, max: Number.isNaN(def) ? 1 : Math.max(0, def) };
        }
        data.data.system.traits = data.data.items.filter(item => { return item.type === "trait" });
        // У NPC вся броня и всё оружие всегда считаются экипированными.
        const npcAll = this.actor.type === "npc";
        data.data.system.weapons = data.data.items.filter(item => { return item.type === "weapon" && (npcAll || item.system.equipped) });
        data.data.system.armor = data.data.items.filter(item => { return item.type === "armor" && item.system?.group !== "shield" && (npcAll || item.system.equipped) });
        data.data.system.shields = data.data.items.filter(item => { return item.type === "armor" && item.system?.group === "shield" && (npcAll || item.system.equipped) });

        // Мастерство оружия — кнопка открывает окно выбора (в стиле dnd5e).
        // Список оружий собирается из директории мира (game.items), а не из
        // инвентаря актёра. Храним id оружия мира; на листе показываем его имя.
        const masteredId = data.data.system.proficiencies?.masteredWeapons ?? "";
        const masteredItem = game.items.get(masteredId);
        data.data.system.masteredWeaponId = masteredId;
        data.data.system.masteredWeaponName = masteredItem?.name ?? "";
        data.data.system.gear = data.data.items.filter(item => { return item.type !== "trait" && item.type !== "heritage" });
        data.data.system.currencies = data.data.items.filter(item => { return item.type === "gear" && item.system?.category === "money" });
        data.data.system.nonMoneyGear = data.data.items.filter(item => {
            if (item.type === "trait" || item.type === "heritage") return false;
            if (item.type === "gear" && item.system?.category === "money") return false;
            if (item.type === "weapon" && (npcAll || item.system.equipped)) return false;
            if (item.type === "armor" && item.system?.group !== "shield" && (npcAll || item.system.equipped)) return false;
            return true;
        });
        data.data.system.heritage = data.data.items.find(item => { return item.type === "heritage" }) ?? null;

        data.rollData = this.actor.getRollData();
        const TextEditorImpl = foundry.applications.ux.TextEditor.implementation ?? TextEditor;
        data.descriptionHTML = await TextEditorImpl.enrichHTML(this.actor.system.description,
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

        html.find(".stab-btn").click(this._onStabilize.bind(this));
        html.find(".item-use").click(this._onUseHeal.bind(this));

        html.find(".currency-input").on('change', this._onMoneyEdit.bind(this));

        html.find(".action-meter .act").on('click', this._setCurrentAction.bind(this));
        html.find(".actions-btns .plus").click(this._onActionPlus.bind(this));
        html.find(".actions-btns .minus").click(this._onActionMinus.bind(this));

        html.find(".mastered-weapon-picker").click(this._onMasteredWeaponPicker.bind(this));
        html.find(".mastered-slot-clear").click(this._onMasteredSlotClear.bind(this));

        html.find(".inline-num").on("change", this._onInlineEdit.bind(this));
        html.find(".inv-row-btn.attack").click(this._onWeaponAttack.bind(this));
        html.find(".inv-row-btn.delete").click(this._onItemDelete.bind(this));
        html.find(".inv-row-img, .inv-row-name").click(this._onInvRowOpen.bind(this));
        html.find(".inv-section-toggle").click(this._onSectionToggle.bind(this));
    }

    /* Кнопка «мастерское оружие» открывает окно выбора из директории мира. */
    _onMasteredWeaponPicker(event)
    {
        event.preventDefault();
        const slotEl = event.currentTarget.closest(".mastered-slot");
        const slotIndex = slotEl ? Number(slotEl.dataset.slot) : null;
        const app = new MasteredWeaponSelector(this.actor, { slotIndex: Number.isNaN(slotIndex) ? null : slotIndex });
        app.render(true);
    }

    /* Очистка ячейки мастерства: убираем выбранное оружие из списка. */
    async _onMasteredSlotClear(event)
    {
        event.preventDefault();
        const slotEl = event.currentTarget.closest(".mastered-slot");
        if (!slotEl) return;
        const idx = Number(slotEl.dataset.slot);
        const ids = ((this.actor.system?.proficiencies?.masteredWeapons) || "")
            .split(",").map(s => s.trim()).filter(Boolean);
        if (Number.isNaN(idx) || idx < 0 || idx >= ids.length) return;
        ids.splice(idx, 1);
        await this.actor.update({ "system.proficiencies.masteredWeapons": ids.join(",") });
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

    /* Перезарядка оружия (кнопка ↻): списывает ammo-гир (рожок) и заполняет
     * магазин до uses. Если ammo-гира нет — предупреждение, заряды не меняются.
     * Для NPC сообщение в чат выводится только если включено в настройках. */
    async _onWeaponReload(event)
    {
        event.preventDefault();
        const element = event.currentTarget;
        const weaponId = element.closest("[data-weapon-id]").dataset.weaponId;
        const weapon = this.actor.items.get(weaponId);
        if (!weapon) return;

        // Анимация: крутится только иконка, затем перезаряжаем.
        element.classList.add("spin");
        await new Promise(resolve => {
            element.addEventListener("animationend", () => resolve(), { once: true });
            setTimeout(resolve, 700);
        });

        const result = await Dice.reloadWeapon(this.actor, weapon);
        if (!result.ok)
        {
            const reason = result.reason;
            const ammoType = weapon.system?.ammoType;
            const msg = reason === "empty"
                ? game.i18n.format("tinyd6.reload.emptyMag", { type: ammoType || "" })
                : (ammoType ? game.i18n.format("tinyd6.reload.noMag", { type: ammoType }) : game.i18n.localize("tinyd6.reload.noMagAny"));
            ui.notifications.warn(msg);
            this.render(false);
            return;
        }

        const isNpc = this.actor.type === "npc";
        const showNpcMessages = game.settings.get('tinyd6v14', 'showNpcReloadMessages');
        if (showNpcMessages || !isNpc)
        {
            await Dice.postReloadMessage(this.actor, weapon, result.ammo, { showForNpc: showNpcMessages });
        }
        this.render(false);
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

        // Heritage (архетип) кидает в чат ДВЕ отдельные секции: описание и
        // архетип-способность (trait). Для всех остальных предметов — только
        // описание, как и раньше.
        const isHeritage = item.type === "heritage";
        const enrich = (text) => text
            ? TextEditor.enrichHTML(text, { secrets: this.actor.isOwner, async: true, rollData: this.actor.getRollData() })
            : Promise.resolve("");

        const cardContent = await renderTemplate("systems/tinyd6v14/templates/partials/item-card.hbs",
        {
            item: item,
            name: item.name,
            img: item.img,
            descriptionHTML: await enrich(item.system?.description || ""),
            traitHTML: (isHeritage ? await enrich(item.system?.trait || "") : "")
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
     * (armorHp.value = armorHp.max) для всех предметов брони и щитов актёра. */
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

    /* Стабилизация поверженного токена-цели: открывает диалог с режимами
     * броска (Помеха/Стандарт/Преимущество). Только по токенам-целям,
     * на себя нацелиться нельзя. */
    async _onStabilize(event)
    {
        event.preventDefault();
        if (!game.settings.get('tinyd6v14', 'enableTinyD6Plus')) return;

        const target = getStabilizeTarget(this.actor);
        if (!target)
        {
            const downed = Array.from(game.user.targets ?? []).some(t =>
                t.actor && t.actor.id !== this.actor.id && (Number(t.actor.system?.wounds?.value) || 0) <= 0);
            ui.notifications.warn(downed
                ? game.i18n.localize("tinyd6.stabilize.self")
                : game.i18n.localize("tinyd6.stabilize.noTarget"));
            return;
        }
        openStabilizeDialog(this.actor, target);
    }

    /* Использование heal-гира из инвентаря: лечит выбранную цель (или себя,
     * если целей нет), списывает 1 шт. */
    async _onUseHeal(event)
    {
        event.preventDefault();
        if (!game.settings.get('tinyd6v14', 'enableTinyD6Plus')) return;

        const element = event.currentTarget;
        const itemId = element.closest("[data-item-id]").dataset.itemId;
        const healItem = this.actor.items.get(itemId);
        if (!healItem || healItem.system?.category !== "heal") return;

        const targets = Array.from(game.user.targets ?? []).filter(t => t.actor && t.actor.id !== this.actor.id);
        const targetToken = targets[0] ?? null;
        const targetActor = targetToken?.actor ?? this.actor;

        const healerRef = { actorId: this.actor.id };
        const targetRef = targetToken
            ? { sceneId: game.canvas?.scene?.id ?? null, tokenId: targetToken.id ?? null, actorId: targetActor.id }
            : { actorId: targetActor.id };

        const result = await Dice.useHealItem(this.actor, healItem, targetActor, { healerRef, targetRef });
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
        this.render(false);
    }

    /* Inline-редактирование количества денег (money-гир) прямо в инвентаре. */
    async _onMoneyEdit(event)
    {
        const input = event.currentTarget;
        const itemId = input.dataset.itemId;
        const value = Math.max(0, Number(input.value) || 0);
        const item = this.actor.items.get(itemId);
        if (!item || item.system?.category !== "money") { this.render(false); return; }
        if (Number(item.system?.quantity?.value) === value) return;
        await this.actor.updateEmbeddedDocuments("Item", [
            { _id: itemId, "system.quantity.value": value }
        ]);
        this.render(false);
    }

    async _onInlineEdit(event)
    {
        const input = event.currentTarget;

        // Поле самого актёра из панели настроек (data-path): пишем сразу,
        // не полагаясь на сабмит формы. Так не возникает дублей name,
        // из-за которых Foundry собирала значение в массив.
        const path = input.dataset.path;
        if (path)
        {
            if (input.tagName === "SELECT")
            {
                const raw = input.value;
                if (foundry.utils.getProperty(this.actor.system, path) === raw) return;
                await this.actor.update({ [path]: raw }, { render: false });
                this.render(false);
                return;
            }
            const min = input.min !== undefined && input.min !== "" ? Number(input.min) : 0;
            let value = Number(input.value);
            if (Number.isNaN(value)) return;
            if (Number.isFinite(min)) value = Math.max(min, value);
            const max = input.max !== undefined && input.max !== "" ? Number(input.max) : Infinity;
            if (Number.isFinite(max)) value = Math.min(value, max);
            if (foundry.utils.getProperty(this.actor.system, path) === value) return;
            await this.actor.update({ [path]: value }, { render: false });
            this.render(false);
            return;
        }

        const itemId = input.dataset.itemId;
        const field = input.dataset.field;
        if (!itemId || !field) return;
        const item = this.actor.items.get(itemId);
        if (!item) return;
        const max = input.max ? Number(input.max) : Infinity;
        let value = Math.max(0, Number(input.value) || 0);
        if (max !== Infinity) value = Math.min(value, max);
        if (Number(foundry.utils.getProperty(item, field)) === value) return;
        await this.actor.updateEmbeddedDocuments("Item", [
            { _id: itemId, [field]: value }
        ]);
        this.render(false);
    }

    _onInvRowOpen(event)
    {
        const row = event.currentTarget.closest(".inv-row");
        if (!row) return;
        if (event.target.classList.contains("inline-num")) return;
        const itemId = row.dataset.itemId;
        if (!itemId) return;
        const item = this.actor.items.get(itemId);
        if (item) item.sheet.render(true);
    }

    _onSectionToggle(event)
    {
        const toggle = event.currentTarget;
        const section = toggle.closest(".inv-collapsible");
        if (section) section.classList.toggle("collapsed");
    }
}
