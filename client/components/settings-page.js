/**
    Framework for building object relational database apps
    Copyright (C) 2018  John Rogelstad

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

/*global window*/
(function () {
  "use strict";

  var settingsPage = {},
    m = require("mithril"),
    stream = require("stream"),
    button = require("button"),
    formWidget = require("form-widget"),
    catalog = require("catalog");

  /**
    View model for settings page.

    @param {Object} Options
  */
  settingsPage.viewModel = function (options) {
    options = options || {};
    var vm = {},
      form = {},
      models = catalog.store().models(),
      model = models[options.settings](),
      definition = models[options.settings].definition();

    // Build form from settings definition
    form.name = definition.name;
    form.description = definition.description;
    form.attrs = [];
    Object.keys(definition.properties).forEach(function (key) {
      form.attrs.push({
        attr: key,
        grid: 0,
        unit: 0
      });
    });

    // ..........................................................
    // PUBLIC
    //
    vm.buttonDone = stream();
    vm.doDone = function () {
      if (model.canSave()) {
        vm.formWidget().model().save().then(function () {
          window.history.back();
        });
        return;
      }

      window.history.back();
    };

    vm.formWidget = stream(formWidget.viewModel({
      model: model,
      id: options.settings,
      config: form,
      outsideElementIds: ["toolbar"]
    }));

    vm.model = stream(model);
    vm.title = function () {
      return options.settings.toName();
    };

    // ..........................................................
    // PRIVATE
    //

    vm.buttonDone(button.viewModel({
      onclick: vm.doDone,
      label: "&Done"
    }));

    if (model.state().current()[0] === "/Ready/New") {
      model.fetch();
    }

    return vm;
  };

  /**
    Settings page component

    @params {Object} View model
  */
  settingsPage.component = {
    oninit: function (vnode) {
      this.viewModel = vnode.attrs.viewModel || settingsPage.viewModel(vnode.attrs);
    },

    view: function () {
      var vm = this.viewModel;

      // Build view
      return m("div", [
        m("div", {
          id: "toolbar",
          class: "suite-toolbar"
        }, [
          m(button.component, {viewModel: vm.buttonDone()})
        ]),
        m("div", {
          class: "suite-title"
        }, [
        m("i", {
          class:"fa fa-wrench suite-title-icon"
        }),
        m("label", vm.title())
        ]),
        m(formWidget.component, {viewModel: vm.formWidget()})
      ]);
    }
  };

  catalog.register("components", "settingsPage", settingsPage.component);
  module.exports = settingsPage;

}());