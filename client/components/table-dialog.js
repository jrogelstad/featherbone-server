/**
    Framework for building object relational database apps
    Copyright (C) 2019  John Rogelstad

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
**/
/*jslint this*/
import { f } from "../../common/core-client.js";
import { stream } from "../../common/stream-client.js";
import { button } from "./button.js";
import { catalog } from "../models/catalog.js";
import { dialog } from "./dialog.js";
import { State as statechart } from "../../common/state.js";

const tableDialog = {};

/**
  View model for sort dialog.

  @param {Object} Options
  @param {Array} [options.propertyName] Filter property being modified
  @param {Array} [options.attrs] Attributes
  @param {Array} [options.list] Model list
  @param {Array} [options.feather] Feather
  @param {Function} [options.filter] Filter property
*/
tableDialog.viewModel = function (options) {
    options = options || {};
    let vm;
    let state;
    let createButton;
    let buttonAdd;
    let buttonRemove;
    let buttonClear;
    let buttonDown;
    let buttonUp;
    let selection = stream();

    // ..........................................................
    // PUBLIC
    //

    vm = dialog.viewModel(options);
    vm.add = function () {
        let ary = vm.data();
        let attrs = vm.attrs();

        attrs.some(vm.addAttr.bind(ary));

        if (!vm.isSelected()) {
            vm.selection(ary.length - 1);
        }

        buttonRemove.enable();
        buttonClear.enable();
        vm.scrollBottom(true);
    };
    vm.addAttr = function (attr) {
        if (!this.some(vm.hasAttr.bind(attr))) {
            this.push({
                property: attr
            });
            return true;
        }
    };
    vm.buttonAdd = function () {
        return buttonAdd;
    };
    vm.buttonClear = function () {
        return buttonClear;
    };
    vm.buttonDown = function () {
        return buttonDown;
    };
    vm.buttonRemove = function () {
        return buttonRemove;
    };
    vm.buttonUp = function () {
        return buttonUp;
    };
    vm.clear = function () {
        vm.data().length = 0;
        buttonClear.disable();
    };
    vm.content = function () {
        return [
            m(button.component, {
                viewModel: vm.buttonAdd()
            }),
            m(button.component, {
                viewModel: vm.buttonRemove()
            }),
            m(button.component, {
                viewModel: vm.buttonClear()
            }),
            m(button.component, {
                viewModel: vm.buttonDown()
            }),
            m(button.component, {
                viewModel: vm.buttonUp()
            }),
            m("table", {
                class: "pure-table"
            }, [
                m("thead", {
                    class: "fb-table-dialog-table-header"
                }, vm.viewHeaders()),
                m("tbody", {
                    id: "sortTbody",
                    class: "fb-table-dialog-table-body",
                    oncreate: function (vnode) {
                        let e = document.getElementById(vnode.dom.id);

                        if (vm.scrollBottom()) {
                            e.scrollTop = e.scrollHeight;
                        }
                        vm.scrollBottom(false);
                    }
                }, vm.viewRows())
            ])
        ];
    };
    vm.data = function () {
        // Implement list here
        return;
    };
    vm.isSelected = function () {
        return state.resolve(
            state.resolve("/Selection").current()[0]
        ).isSelected();
    };
    vm.itemChanged = function (index, property, value) {
        vm.data()[index][property] = value;
    };
    vm.items = function () {
        let i = 0;
        let items = vm.data().map(function (item) {
            let ret = f.copy(item);
            ret.index = i;
            i += 1;
            return ret;
        });

        return items;
    };
    vm.hasAttr = function (item) {
        return item.property === this;
    };
    vm.list = stream(options.list);
    vm.moveDown = function () {
        let ary = vm.data();
        let idx = vm.selection();
        let a = ary[idx];
        let b = ary[idx + 1];

        ary.splice(idx, 2, b, a);
        vm.selection(idx + 1);
    };
    vm.moveUp = function () {
        let ary = vm.data();
        let idx = vm.selection() - 1;
        let a = ary[idx];
        let b = ary[idx + 1];

        ary.splice(idx, 2, b, a);
        vm.selection(idx);
    };
    vm.remove = function () {
        let idx = selection();
        let ary = vm.data();

        ary.splice(idx, 1);
        state.send("unselected");
        if (ary.length) {
            if (idx > 0) {
                idx -= 1;
            }
            selection(idx);
            return;
        }
        buttonRemove.disable();
    };
    vm.reset = function () {
        // Reset code here
        return;
    };
    vm.resolveProperties = function (feather, properties, ary, prefix) {
        prefix = prefix || "";
        let result = ary || [];

        properties.forEach(function (key) {
            let rfeather;
            let prop = feather.properties[key];
            let isObject = typeof prop.type === "object";
            let path = prefix + key;

            if (isObject && prop.type.properties) {
                rfeather = catalog.getFeather(prop.type.relation);
                vm.resolveProperties(
                    rfeather,
                    prop.type.properties,
                    result,
                    path + "."
                );
            }

            if (prop.format === "money") {
                path += ".amount";
            } else if (
                prop.type === "object" || (
                    isObject && (
                        prop.type.childOf ||
                        prop.type.parentOf ||
                        prop.type.isChild
                    )
                )
            ) {
                return;
            }

            result.push(path);
        });

        return result;
    };
    vm.rowColor = function (index) {
        if (vm.selection() === index) {
            if (vm.isSelected()) {
                return "LightSkyBlue";
            }
            return "AliceBlue";
        }
        return "White";
    };
    vm.title = stream(options.title);
    vm.viewHeaderIds = stream();
    vm.viewHeaders = function () {
        return;
    };
    vm.viewRows = function () {
        return;
    };
    vm.scrollBottom = stream(false);
    vm.selection = function (...args) {
        let ary = vm.data();
        let index = args[0];
        let select = args[1];

        if (select) {
            state.send("selected");
        }

        if (args.length) {
            buttonUp.disable();
            buttonDown.disable();

            if (ary.length > 1) {
                if (index < ary.length - 1) {
                    buttonDown.enable();
                }
                if (index > 0) {
                    buttonUp.enable();
                }
            }

            return selection(index);
        }

        return selection();
    };

    // ..........................................................
    // PRIVATE
    //

    createButton = button.viewModel;
    buttonAdd = createButton({
        onclick: vm.add,
        label: "Add",
        icon: "plus-circle",
        style: {
            backgroundColor: "white"
        }
    });

    buttonRemove = createButton({
        onclick: vm.remove,
        label: "Remove",
        icon: "remove",
        style: {
            backgroundColor: "white"
        }
    });

    buttonClear = createButton({
        onclick: vm.clear,
        title: "Clear",
        icon: "eraser",
        style: {
            backgroundColor: "white"
        }
    });

    buttonUp = createButton({
        onclick: vm.moveUp,
        icon: "chevron-up",
        title: "Move up",
        style: {
            backgroundColor: "white",
            float: "right"
        }
    });

    buttonDown = createButton({
        onclick: vm.moveDown,
        icon: "chevron-down",
        title: "Move down",
        style: {
            backgroundColor: "white",
            float: "right"
        }
    });

    // Statechart
    state = statechart.define(function () {
        this.state("Selection", function () {
            this.state("Off", function () {
                this.event("selected", function () {
                    this.goto("../On");
                });
                this.isSelected = function () {
                    return false;
                };
            });
            this.state("On", function () {
                this.event("unselected", function () {
                    this.goto("../Off");
                });
                this.isSelected = function () {
                    return true;
                };
            });
        });
    });
    state.goto();

    vm.state().resolve("/Display/Showing").enter(function () {
        vm.reset();
    });

    return vm;
};

/**
  Table dialog component

  @params {Object} View model
*/
tableDialog.component = dialog.component;

export { tableDialog };