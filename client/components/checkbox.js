/*
    Framework for building object relational database apps
    Copyright (C) 2020  John Rogelstad

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

/*jslint this, browser*/
/**
    @module Checkbox
*/
import f from "../core.js";

const catalog = f.catalog();
const checkbox = {};
const m = window.m;

/**
    Generate view model for checkbox.

    @class Checkbox
    @constructor
    @namespace ViewModels
    @param {Object} [options] Options
    @param {String} [options.id] Id
    @param {Boolean} [options.isCell] Use style for cell in table
*/
checkbox.viewModel = function (options) {
    let vm = {};

    vm.hasFocus = f.prop(false);
    vm.id = f.prop(options.id || f.createId());
    /**
        @method isCell
        @param {Boolean} flag
        @return {String}
    */
    vm.isCell = f.prop(Boolean(options.isCell));

    return vm;
};

/**
    Checkbox component

    @class Checkbox
    @static
    @namespace Components
*/
checkbox.component = {
    /**
        @method oninit
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs Options
        @param {String} [vnode.attrs.id] Id
        @param {String} [vnode.attrs.label] Label
        @param {Function} [vnode.attrs.onclick] On click handler
        @param {Function} [vnode.attrs.onCreate] On create handler
        @param {Function} [vnode.attrs.onRemove] On remove handler
        @param {Function} [vnode.attrs.value] Value
        @param {Boolean} [vnode.attrs.title] Title
        @param {Boolean} [vnode.attrs.readonly] Read only flag
        @param {Object} [vnode.attrs.style] Style
    */
    oninit: function (vnode) {
        this.viewModel = checkbox.viewModel(vnode.attrs);
    },

    /**
        @method view
        @param {Object} vnode Virtual node
        @param {Object} vnode.attrs Options
        @param {String} [vnode.attrs.label] Label
        @param {Function} [vnode.attrs.onclick] On click handler
        @param {Function} [vnode.attrs.onCreate] On create handler
        @param {Function} [vnode.attrs.onRemove] On remove handler
        @param {Function} [vnode.attrs.value] Value
        @param {Boolean} [vnode.attrs.title] Title
        @param {Boolean} [vnode.attrs.readonly] Read only flag
        @param {Object} [vnode.attrs.style] Style
        @return {Object} View
    */
    view: function (vnode) {
        let labelClass = "fb-checkbox-label";
        let vm = this.viewModel;
        let id = vm.id();
        let theclass;
        let thestyle;
        let label;

        function createLabel() {
            if (!vm.isCell()) {
                theclass = "fb-checkbox-input";
                thestyle = vnode.attrs.style || {};

                if (vnode.attrs.readonly) {
                    labelClass += " fb-checkbox-readonly";
                }

                if (vm.hasFocus()) {
                    labelClass += " fb-checkbox-focus";
                }

                return m("label", {
                    for: id,
                    title: vnode.attrs.title,
                    class: labelClass
                }, m("i", {
                    class: "fa fa-check",
                    style: {
                        visibility: (
                            vnode.attrs.value
                            ? "visible"
                            : "hidden"
                        )
                    }
                }));
            }
        }

        label = createLabel();

        return m("div", {
            class: "fb-checkbox"
        }, [
            m("input", {
                id: id,
                class: theclass,
                type: "checkbox",
                onclick: function (e) {
                    vnode.attrs.onclick(e.target.checked);
                },
                oncreate: vnode.attrs.onCreate,
                onremove: vnode.attrs.onRemove,
                checked: vnode.attrs.value,
                style: thestyle,
                disabled: vnode.attrs.readonly,
                required: Boolean(vnode.attrs.required),
                onfocus: () => vm.hasFocus(true),
                onblur: () => vm.hasFocus(false)
            }),
            label
        ]);
    }
};

catalog.register("components", "checkbox", checkbox.component);

export default Object.freeze(checkbox);
