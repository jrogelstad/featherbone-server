/**
    Framework for building object relational database apps

    Copyright (C) 2015  John Rogelstad
    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <http://www.gnu.org/licenses/>.
**/

/*global window, f, m */
(function (f) {
  "use strict";

  /**
    View model for sort dialog.

    @param {Object} Options
    @param {Array} [options.propertyName] Filter property being modified
    @param {Array} [options.attrs] Attributes
    @param {Array} [options.list] Model list
    @param {Function} [options.filter] Filter property
  */
  f.viewModels.filterDialogViewModel = function (options) {
    options = options || {};
    var vm, state, createButton, buttonAdd, buttonRemove,
      buttonDown, buttonUp,
      selection = m.prop();

    // ..........................................................
    // PUBLIC
    //

    vm = {};
    vm.add = function () {
      var addAttr, hasAttr,
       ary = vm.data(),
       attrs = vm.attrs();

      addAttr = function (attr) {
        if (!ary.some(hasAttr.bind(attr))) {
          ary.push({property: attr});
          return true;
        }
      };

      hasAttr = function (item) { 
        return item.property === this;
      };

      attrs.some(addAttr);

      if (!vm.isSelected()) {
        vm.selection(ary.length - 1);
      }

      buttonRemove.enable();
      vm.scrollBottom(true);
    };
    vm.attrs = function () {
      return options.attrs;
    };
    vm.buttonAdd = function () {
      return buttonAdd;
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
    vm.cancel = function () {
      vm.reset();
      state.send("close");
    };
    vm.data = function () {
      return vm.filter()[vm.propertyName()];
    };
    vm.propertyName = m.prop(options.propertyName || "criteria");
    vm.id = m.prop(options.id || f.createId());
    vm.isSelected = function () {
      return state.resolve(state.resolve("/Selection").current()[0]).isSelected();
    };
    vm.itemChanged = function (index, property, value) {
      vm.data()[index][property] = value;
    };
    vm.items = function () {
      var i = 0,
        items = vm.data().map(function (item) {
          var ret = JSON.parse(JSON.stringify(item));
          ret.index = i;
          i += 1;
          return ret;
        });

      return items;
    };
    vm.filter = m.prop();
    vm.list = m.prop(options.list);
    vm.moveDown = function () {
      var ary = vm.data(),
        idx = vm.selection(),
        a = ary[idx],
        b = ary[idx + 1];

      ary.splice(idx, 2, b, a);
      vm.selection(idx + 1);
    };
    vm.moveUp = function () {
      var  ary = vm.data(),
        idx = vm.selection() - 1,
        a = ary[idx],
        b = ary[idx + 1];

      ary.splice(idx, 2, b, a);
      vm.selection(idx);
    };
    vm.ok = function () {
      options.filter(vm.filter()); // Kicks off refresh
      state.send("close");
    };
    vm.operators = function () {
      return {
        "=": "equals",
        "!=": "not equals",
        "~*": "matches",
        "!~*": "not matches",
        ">": "greater than",
        "<": "less than",
        ">=": "greater than or equals",
        "<=": "less than or equals"
      };
    };
    vm.remove = function () {
      var idx = selection(),
        ary = vm.data();
      ary.splice(idx, 1);
      state.send("unselected");
      if (ary.length) {
        if (idx > 0) { idx -= 1; }
        selection(idx);
        return;
      }
      buttonRemove.disable();
    };
    vm.reset = function () {
      var name = vm.propertyName(),
        filter = JSON.parse(JSON.stringify(options.filter()));
      filter[name] = filter[name] || [];
      vm.filter(filter);
      if (!filter[name].length) { vm.add(); }
      vm.selection(0);
    };
    vm.rowColor = function (index) {
      if (vm.selection() === index) {
        if (vm.isSelected()) {
          return "LightSkyBlue" ;
        }
        return "AliceBlue";
      }
      return "White";
    };
    vm.title = m.prop(options.propertyName || "filter");
    vm.viewHeaderConfig = function (index, property, e) {
      var ids;
      if (!index) {
        ids = vm.viewHeaderIds();
        document.getElementById(ids[property]).style.minWidth = e.clientWidth + 3 + "px";
      }
    };
    vm.viewHeaderIds = m.prop({
      column: f.createId(),
      operator: f.createId(),
      value: f.createId()
    });
    vm.viewHeaders = function () {
      var ids = vm.viewHeaderIds();
      return [
        m("th", {id: ids.column }, "Column"),
        m("th", {id: ids.operator}, "Operator"),
        m("th", {id: ids.value}, "Value")
      ];
    };
    vm.viewRows = function () {
      var view,
        operators = vm.operators();

      view = vm.items().map(function (item) {
        var row;

        row = m("tr", {
          onclick: vm.selection.bind(this, item.index, true),
          style: {backgroundColor: vm.rowColor(item.index)}
        },[
          m("td",
            m("select", {
              style: {minWidth: "150px"}, 
              value: item.property,
              onchange: m.withAttr("value", vm.itemChanged.bind(this, item.index, "property")),
              config: vm.viewHeaderConfig.bind(this, item.index, "column")
            }, vm.attrs().map(function (attr) {
                return m("option", {value: attr}, attr.toName());
              })
            )
          ),
          m("td", [
            m("select", {
              style: {minWidth: "150px"},
              onchange: m.withAttr("value", vm.itemChanged.bind(this, item.index, "operator")),
              config: vm.viewHeaderConfig.bind(this, item.index, "operator")
            }, Object.keys(operators).map(function (op) {
              return m("option", {value: op}, operators[op]);
            }), item.operator || "=")
          ]),
          m("td", [
            m("input", {
              style: {minWidth: "150px"},
              onchange: m.withAttr("value", vm.itemChanged.bind(this, item.index, "value")),
              config: vm.viewHeaderConfig.bind(this, item.index, "value"),  
              value: item.value
            })
          ])
        ]);

        return row;
      });

      return view;
    };
    vm.scrollBottom = m.prop(false);
    vm.selection = function (index, select) {
      var ary = vm.data();

      if (select) { state.send("selected"); }

      if (arguments.length) {
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
    vm.show = function () {
      state.send("show");
    };

    // ..........................................................
    // PRIVATE
    //

    createButton = f.viewModels.buttonViewModel;
    buttonAdd = createButton({
      onclick: vm.add,
      label: "Add",
      icon: "plus-circle",
      style: {backgroundColor: "white"}
    });

    buttonRemove = createButton({
      onclick: vm.remove,
      label: "Remove",
      icon: "remove",
      style: {backgroundColor: "white"}
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
    state = f.statechart.State.define({concurrent: true}, function () {
      this.state("Display", function () {
        this.state("Closed", function () {
          this.enter(function () {
            var  id = vm.id(),
              dlg = document.getElementById(id);
            if (dlg) { dlg.close(); }
          });
          this.event("show", function () {
            this.goto("../Showing");
          });
        });
        this.state("Showing", function () {
          this.enter(function () {
            var id = vm.id(),
              dlg = document.getElementById(id);
            vm.reset();
            if (dlg) { dlg.showModal(); }
          });
          this.event("close", function () {
            this.goto("../Closed");
          });
        });
      });
      this.state("Selection", function () {
        this.state("Off", function () {
          this.event("selected", function () {
            this.goto("../On");
          });
          this.isSelected = function () { return false; };
        });
        this.state("On", function () {
          this.event("unselected", function () {
            this.goto("../Off");
          });
          this.isSelected = function () { return true; };
        });
      });
    });
    state.goto();

    vm.reset();

    return vm;
  };

  /**
    Filter dialog component

    @params {Object} View model
  */
  f.components.filterDialog = function (options) {
    var component = {};

    component.controller = function () {
      this.vm = options.viewModel;
    };

    component.view = function (ctrl) {
      var view,
        button = f.components.button,
        vm = ctrl.vm;

      view = m("dialog", {
          id: vm.id(),
          style: {
            borderRadius: "10px",
            padding: "0px"
          }
        }, [
        m("h3", {
          style: {
            backgroundColor: "snow",
            borderBottomColor: "lightgrey",
            borderBottomStyle: "solid",
            borderBottomWidth: "thin",
            margin: "2px",
            padding: "6px"
          }
        }, [m("i", {
          class:"fa fa-" + vm.title(), 
          style: {marginRight: "3px"}
        })], vm.title().toName()),
        m("div", {style: {padding: "1em"}}, [
          m.component(button({viewModel: vm.buttonAdd()})),
          m.component(button({viewModel: vm.buttonRemove()})),
          m.component(button({viewModel: vm.buttonDown()})),
          m.component(button({viewModel: vm.buttonUp()})),
          m("table", {
            class: "pure-table",
            style: {minWidth: "350px"}
          }, [
            m("thead", {
              style: {
                minWidth: "inherit",
                display: "inherit"
              }
            }, vm.viewHeaders()),
            m("tbody", {
              id: "sortTbody",
              style: {
                maxHeight: "175px",
                minHeight: "175px",
                overflowX: "hidden",
                overflowY: "auto",
                display: "inline-block"
              },
              config: function (e) {
                if (vm.scrollBottom()) {
                  e.scrollTop = e.scrollHeight;
                }
                vm.scrollBottom(false);
              } 
            }, vm.viewRows()
            )
          ]),
          m("br"),
          m("button", {
            class: "pure-button  pure-button-primary",
            style: {marginRight: "5px"},
            autofocus: true,
            onclick: vm.ok
          }, "Ok"),
          m("button", {
            class: "pure-button",
            onclick: vm.cancel
          }, "Cancel")
        ])
      ]);

      return view;
    };

    return component;
  };

}(f));

