/**
    Framework for building object relational database apps
    Copyright (C) 2016  John Rogelstad

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

(function () {
  "use strict";

  var tableModel,
    catalog = require("catalog"),
    model = require("model");

  /**
    A factory that returns a persisting object based on a definition called a
    `feather`. Can be extended by modifying the return object directly.
    @param {Object} Default data
    return {Object}
  */
  tableModel = function (data) {
    var that, feathers, modules,
      feather = catalog.getFeather("Table");

    // ..........................................................
    // PUBLIC
    //

    that = model(data, feather);

    feathers = function () {
      var tables = catalog.data(),
        keys = Object.keys(tables);
      keys = keys.filter(function (key) {
        return !tables[key].isSystem;
      }).sort();

      return keys.map(function (key) {
        return {value: key, label: key};
      });
    };
    that.addCalculated({
      name: "feathers",
      type: "array",
      function: feathers
    });

    modules = function () {
      var tables = catalog.data(),
        keys = Object.keys(tables),
        ary = [];
      keys.forEach(function (key) {
        var mod = tables[key].module;
        if (mod && ary.indexOf(mod) === -1) {
          ary.push(mod);
        }
      });

      return ary.map(function (item) {
        return {value: item, label: item};
      });
    };
    that.addCalculated({
      name: "modules",
      type: "array",
      function: modules
    });

    return that;
  };

  catalog.register("models", "table", tableModel);
  module.exports = tableModel;

}());