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

        const armorStacking = game.settings.get('tinyd6v14', 'enableArmorStacking');

        data.data.system.armorTotal = 0;
        data.data.system.armorHpTotal = 0;

        let maxArmorDr = 0;
        data.data.system.armor.forEach((item) => {
            if ((Number(item.system.armorHp?.value) || 0) <= 0) return;
            const dr = item.system.damageReduction || 0;
            if (!armorStacking) {
                if (dr > maxArmorDr) maxArmorDr = dr;
            } else {
                data.data.system.armorTotal += dr;
            }
            data.data.system.armorHpTotal += Number(item.system.armorHp.value) || 0;
        });
        if (!armorStacking) data.data.system.armorTotal = maxArmorDr;

        (data.data.system.shields || []).forEach((item) => {
            if ((Number(item.system.armorHp?.value) || 0) <= 0) return;
            data.data.system.armorTotal += item.system.damageReduction;
            data.data.system.armorHpTotal += Number(item.system.armorHp.value) || 0;
        });

        // Resolve preferred weapon IDs to actual actor items
        const preferredIds = data.data.system.preferredWeapons || [];
        data.data.system.preferredWeapons = preferredIds
            .map(id => this.actor.items.get(id))
            .filter(Boolean);

        return data;
    }

    activateListeners(html) {
        super.activateListeners(html);

        // Remove preferred weapon
        html.find('.npc-remove-preferred').on('click', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const weaponId = event.currentTarget.dataset.preferredId;
            if (!weaponId) return;
            const current = this.actor.system.preferredWeapons || [];
            const updated = current.filter(id => id !== weaponId);
            await this.actor.update({ 'system.preferredWeapons': updated });
        });

        // Add preferred weapon
        html.find('.npc-add-preferred').on('click', (event) => {
            event.preventDefault();
            this._openPreferredWeaponSelector();
        });

        // Preferred weapon attack
        html.find('.npc-pref-btn.attack').on('click', (event) => {
            event.preventDefault();
            const weaponId = event.currentTarget.dataset.weaponId;
            const weapon = this.actor.items.get(weaponId);
            if (weapon) this._onWeaponAttack(event);
        });

        // Add Ammo button
        html.find('.npc-add-ammo').on('click', (event) => {
            event.preventDefault();
            this._openAddAmmoDialog();
        });
    }

    _openPreferredWeaponSelector() {
        const weapons = this.actor.items.filter(i => i.type === 'weapon');
        if (weapons.length === 0) {
            ui.notifications.warn(game.i18n.localize('tinyd6.sheet.noWeapons'));
            return;
        }

        const currentIds = this.actor.system.preferredWeapons || [];
        const selected = new Set(currentIds);

        const rows = weapons.map(w => {
            const checked = selected.has(w.id) ? 'checked' : '';
            return `<div class="pref-row" data-weapon-id="${w.id}">
                <input type="checkbox" ${checked}/>
                <img src="${w.img}" width="28" height="28"/>
                <span class="pref-name">${w.name}</span>
            </div>`;
        }).join('');

        const content = `<div class="pref-selector-body">
            <p class="pref-hint">${game.i18n.localize('tinyd6.actor.selectWeapon')}</p>
            <div class="pref-list">${rows}</div>
        </div>`;

        const dialog = new Dialog({
            title: game.i18n.localize('tinyd6.actor.preferredWeapons'),
            content,
            buttons: {
                save: {
                    icon: '<i class="fas fa-check"></i>',
                    label: game.i18n.localize('SETTINGS.Save'),
                    callback: async (html) => {
                        const checked = [];
                        html.find('.pref-row input[type="checkbox"]:checked').each(function() {
                            checked.push($(this).closest('.pref-row').data('weapon-id'));
                        });
                        await this.actor.update({ 'system.preferredWeapons': checked });
                    }
                }
            },
            default: 'save',
            render: (html) => {
                // Toggle checkbox on row click
                html.find('.pref-row').on('click', function(e) {
                    if (e.target.tagName === 'INPUT') return;
                    const cb = $(this).find('input[type="checkbox"]');
                    cb.prop('checked', !cb.prop('checked'));
                });
            }
        }, {
            classes: ['tinyd6', 'pref-selector'],
            width: 320,
            height: 'auto'
        });
        dialog.render(true);
    }

    _openAddAmmoDialog() {
        const actorAmmo = this.actor.items.filter(i => i.type === 'gear' && i.system.category === 'ammo');
        const worldAmmo = game.items.filter(i => i.type === 'gear' && i.system.category === 'ammo');
        const allAmmoTypes = [...new Set([...actorAmmo, ...worldAmmo].map(i => i.system.ammoType).filter(Boolean))];

        const typeOptions = allAmmoTypes.map(t => `<option value="${t}">${t}</option>`).join('');

        const content = `<div style="padding:8px 4px;">
            <div class="form-group">
                <label>${game.i18n.localize('tinyd6.actor.ammoType')}</label>
                <select name="ammoType" style="width:100%;">${typeOptions}</select>
            </div>
            <div class="form-group" style="margin-top:8px;">
                <label>${game.i18n.localize('tinyd6.gear.quantity')}</label>
                <input type="number" name="ammoQty" value="10" min="1" style="width:100%;"/>
            </div>
        </div>`;

        new Dialog({
            title: game.i18n.localize('tinyd6.actor.addAmmoTitle'),
            content,
            buttons: {
                add: {
                    icon: '<i class="fas fa-plus"></i>',
                    label: game.i18n.localize('tinyd6.actor.addAmmo'),
                    callback: async (html) => {
                        const type = html.find('[name="ammoType"]').val();
                        const qty = parseInt(html.find('[name="ammoQty"]').val()) || 10;
                        if (!type) return;

                        const existingAmmo = actorAmmo.find(i => i.system.ammoType === type);
                        if (existingAmmo) {
                            const currentQty = existingAmmo.system.quantity.value || 0;
                            await existingAmmo.update({ 'system.quantity.value': currentQty + qty });
                        } else {
                            await Item.create({
                                name: type,
                                type: 'gear',
                                img: 'icons/svg/item-bag.svg',
                                system: {
                                    category: 'ammo',
                                    ammoType: type,
                                    quantity: { value: qty },
                                    description: ''
                                }
                            }, { parent: this.actor });
                        }
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: game.i18n.localize('tinyd6.attack.cancel'),
                    callback: () => {}
                }
            },
            default: 'add'
        }, {
            classes: ['tinyd6'],
            width: 300
        }).render(true);
    }
}
