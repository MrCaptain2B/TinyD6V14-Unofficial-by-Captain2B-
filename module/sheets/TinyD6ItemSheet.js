import { TinyD6System } from "../tinyd6.js";

export default class TinyD6ItemSheet extends ItemSheet {

    /* ───────── Реестр вкладок модулей ─────────
     * Модули регистрируют вкладки через API:
     *   game.tinyd6ItemSheets.registerTab("weapon", {
     *       key:   "aoe",           // уникальный ключ вкладки
     *       label: "td6we.tabAoe",  // ключ локализации ИЛИ готовая строка
     *       icon:  "fas fa-burst",  // FontAwesome-класс иконки
     *       render: (node, sheet) => { ... }  // рендер содержимого в узел
     *   });
     *
     * Хост-шаблон (.weapon-sheet.hbs) отрисовывает кнопки из moduleTabs,
     * а activateListeners вызывает render() в пустые .td-pane.
     * Если модуль перерегистрируется (обновился) — объект перезаписывается. */
    static _MODULE_TABS = new Map();

    static registerTab(sheetType, tab) {
        if (!sheetType || !tab || !tab.key) return null;
        const list = TinyD6ItemSheet._MODULE_TABS.get(sheetType) ?? [];
        const idx = list.findIndex(t => t.key === tab.key);
        const entry = {
            key:   tab.key,
            label: tab.label ?? tab.key,
            icon:  tab.icon  ?? "fas fa-plug",
            render: typeof tab.render === "function" ? tab.render : null
        };
        if (idx >= 0) list[idx] = entry; else list.push(entry);
        TinyD6ItemSheet._MODULE_TABS.set(sheetType, list);
        return entry;
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: [ TinyD6System.SYSTEM, "tinyd6", "sheet", "item", game.settings.get(TinyD6System.SYSTEM, "theme") ]
        });
    }

    get template() {
        const type = this.document.type === "shield" ? "armor" : this.document.type;
        if (type === "weapon") return "systems/tinyd6v14/templates/sheets/weapon-sheet-v2.hbs";
        return `systems/tinyd6v14/templates/sheets/${type}-sheet.hbs`;
    }

    constructor(...args) {
        super(...args);
        this._activeTab = "description";
    }

    async getData() {
        const data = super.getData();

        data.data.traits = {};
        data.config = CONFIG.tinyd6;
        data.config.enableTinyD6Plus = game.settings.get('tinyd6v14', 'enableTinyD6Plus');

        // Список типов патронов для выпадашки в листе оружия: уникальные
        // ammoType из всех ammo-гиров мира и (если есть) владельца предмета.
        const ammoTypes = new Set();
        for (const item of game.items ?? [])
        {
            if (item.type === "gear" && item.system?.category === "ammo" && item.system?.ammoType)
                ammoTypes.add(item.system.ammoType);
        }
        if (this.item.parent?.items)
        {
            for (const item of this.item.parent.items)
            {
                if (item.type === "gear" && item.system?.category === "ammo" && item.system?.ammoType)
                    ammoTypes.add(item.system.ammoType);
            }
        }
        data.config.ammoTypes = [...ammoTypes].sort();

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

        // Модульные вкладки: список { key, label, icon } для текущего типа предмета.
        const tabs = TinyD6ItemSheet._MODULE_TABS.get(this.document.type) ?? [];
        data.moduleTabs = tabs.map(tab => ({
            key:   tab.key,
            label: game.i18n.localize(tab.label),
            icon:  tab.icon
        }));

        return data;
    }

    activateListeners(html) {
        super.activateListeners(html);
        const root = html instanceof HTMLElement ? html : (html[0] ?? html);
        if (!root) return;

        // ──── Переключение вкладок (поддержка td-* и ws-* селекторов) ────
        root.querySelectorAll(".td-tab, .ws-tab").forEach(btn => {
            btn.addEventListener("click", (ev) => {
                ev.preventDefault();
                this._activeTab = btn.dataset.tab || "description";
                this._applyTab(root);
            });
        });
        this._applyTab(root);

        // ──── Рендер модульных вкладок ────
        const tabs = TinyD6ItemSheet._MODULE_TABS.get(this.document.type) ?? [];
        for (const tab of tabs) {
            const pane = root.querySelector(`.td-pane[data-pane="${tab.key}"], .ws-pane[data-pane="${tab.key}"]`);
            if (pane && tab.render) {
                pane.innerHTML = "";
                try { tab.render(pane, this); }
                catch (err) {
                    console.error(`tinyd6 | Module tab "${tab.key}" render failed:`, err);
                }
            }
        }

        // ──── Оружие: расширяем окно под 3-колоночный макет ────
        if (this.document.type === "weapon" && (this.position.width ?? 0) < 700) {
            this.setPosition({ width: 880 });
        }
    }

    /** Применить активную вкладку: подсветка кнопки + видимость панели. */
    _applyTab(root) {
        if (!this._activeTab) this._activeTab = "description";
        root.querySelectorAll(".td-tab, .ws-tab").forEach(btn =>
            btn.classList.toggle("active", btn.dataset.tab === this._activeTab));
        root.querySelectorAll(".td-pane, .ws-pane").forEach(pane =>
            pane.classList.toggle("active", pane.dataset.pane === this._activeTab));
    }
}
