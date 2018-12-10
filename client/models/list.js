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
/*global require, Promise, module, console*/
/*jslint this, es6*/
(function () {
    "use strict";

    var list, createList,
            m = require("mithril"),
            f = require("common-core"),
            stream = require("stream"),
            qs = require("Qs"),
            catalog = require("catalog"),
            statechart = require("statechartjs"),
            LIMIT = 20;

    /**
      Return a function that when called will return an array of models
      based on the feather name passed. The function accepts an object supporting
      the following options:

        fetch: Boolean flags whether to automatically fetch a list of models.
        subscribe: Boolean flags whether to subscribe to events.
        filter: A filter object definition.
        showDeleted: Boolean whether to include deleted records on fetch.

      The model array includes support for the following three functions:

        add(model): Adds the passed model to the array.
        remove(model): Removes the passed model from the array.
        fetch (filter): Requeries the server for new results.

      @param {String} Feather name
      @return {Function}
    */
    list = function (feather) {
        // Instantiate the list, optionally auto fetch
        // and return a property that contains the array.
        return function (options) {
            options = options || {};
            var plural,
                ary = options.value || createList(feather),
                prop = stream(ary);

            if (options.path) {
                ary.path(options.path);
            } else {
                plural = catalog.getFeather(feather).plural.toSpinalCase();
                ary.path("/data/" + plural);
            }

            ary.showDeleted(options.showDeleted === true);
            ary.subscribe(options.subscribe === true);

            if (options.fetch !== false) {
                ary.fetch(options.filter, options.merge);
            } else {
                ary.filter(options.filter || {});
            }

            return prop;
        };
    };

    // ..........................................................
    // PRIVATE
    //

    createList = function (feather) {
        var state, doFetch, doSave, doSend,
                onClean, onDirty, onDelete,
                models = catalog.store().models(),
                name = feather.toCamelCase(),
                isSubscribed = false,
                ary = [],
                dirty = [],
                sid = f.createId();

        // ..........................................................
        // PUBLIC
        //

        // Add a model to the list. Will replace existing
        // if model with same id is already found in array
        ary.add = function (model, subscribe) {
            var mstate, payload, url, query, subid,
                    id = model.id(),
                    idx = ary.index(),
                    oid = idx[id];

            if (!isNaN(oid)) {
                dirty.remove(ary[oid]);
                ary.splice(oid, 1, model);
            } else {
                idx[id] = ary.length;
                ary.push(model);
            }

            mstate = model.state();
            mstate.resolve("/Delete").enter(onDirty.bind(model));
            mstate.resolve("/Ready/Fetched/Dirty").enter(onDirty.bind(model));
            mstate.resolve("/Ready/Fetched/Clean").enter(onClean.bind(model));
            mstate.resolve("/Deleted").enter(onDelete.bind(model));

            if (model.state().current()[0] === "/Ready/New") {
                dirty.push(model);
                state.send("changed");
            }

            // Subscribe to events on new model if applicable
            if (subscribe) {
                subid = ary.subscribe();

                if (!subid) {
                    return;
                }

                query = qs.stringify({
                    id: model.id(),
                    subscription: {
                        id: subid,
                        sessionId: catalog.sessionId(),
                        merge: true
                    }
                });
                url = "/do/subscribe/" + query;
                payload = {
                    method: "POST",
                    url: url
                };

                m.request(payload).catch(console.error);
            }
        };

        ary.canFilter = stream(true);

        /*
          Fetch data.

          @param {Object} filter,
          @param {Boolean} merge
          @return Promise
        */
        ary.fetch = function (filter, merge) {
            ary.filter(filter || {});

            return doSend("fetch", merge);
        };

        ary.filter = stream({});

        ary.defaultLimit = stream(LIMIT);

        ary.index = stream({});

        ary.model = models[feather.toCamelCase() || 'Model'];

        ary.path = stream();

        /*
          Array of properties to fetch if only a subset required.
          If undefined, then all properties returned.
        */
        ary.properties = stream();

        // Remove a model from the list
        ary.remove = function (model) {
            var id = model.id(),
                idx = ary.index(),
                i = idx[id];

            if (!isNaN(i)) {
                ary.splice(i, 1);
                Object.keys(idx).forEach(function (key) {
                    if (idx[key] > i) {
                        idx[key] -= 1;
                    }
                });
                delete idx[id];
            }
            dirty.remove(model);
        };

        ary.reset = function () {
            ary.length = 0;
            dirty.length = 0;
            ary.index({});
        };

        ary.showDeleted = stream(false);

        ary.save = function () {
            return doSend("save");
        };

        ary.state = function () {
            return state;
        };

        /**
          Subscribe to change events on any records
          in the array. Returns subscription id when
          enabled by passing true at least once. Pass
          false to unsubscribe.

          @param {Boolean} Subscribe or unsubscribe.
          @return {String} Subcription id.
        */
        ary.subscribe = function (...args) {
            var query, url, payload;

            if (args.length) {
                if (args[0] === true) {
                    isSubscribed = true;
                    catalog.register("subscriptions", sid, ary);
                } else {
                    if (isSubscribed) {
                        catalog.unregister("subscriptions", sid);

                        // Let the server know we're unsubscribing
                        query = {
                            subscription: {
                                id: sid
                            }
                        };

                        query = qs.stringify(query);
                        url = "/do/unsubscribe/" + query;
                        payload = {
                            method: "POST",
                            url: url
                        };

                        return m.request(payload)
                            .catch(console.error);
                    }

                    isSubscribed = false;
                }
            }

            return isSubscribed
                ? sid
                : false;
        };

        // ..........................................................
        // PRIVATE
        //

        onClean = function () {
            dirty.remove(this);
            state.send("changed");
        };

        onDelete = function () {
            ary.remove(this);
            state.send("changed");
        };

        onDirty = function () {
            dirty.push(this);
            state.send("changed");
        };

        dirty.remove = function (model) {
            var i = dirty.indexOf(model);
            if (i > -1) {
                dirty.splice(i, 1);
            }
        };

        doFetch = function (context) {
            var url, payload,
                    subid = ary.subscribe(),
                    body = {},
                    merge = true;

            // Undo any edited rows
            ary.forEach(function (model) {
                model.undo();
            });

            if (context.merge === false) {
                merge = false;
            }

            function callback(data) {
                if (!merge) {
                    ary.reset();
                }

                data.forEach(function (item) {
                    var model = models[name]();
                    model.set(item, true, true);
                    model.state().goto("/Ready/Fetched");
                    ary.add(model);
                });

                state.send("fetched");
                context.resolve(ary);
            }

            if (ary.properties()) {
                body.properties = ary.properties();
            }

            if (ary.filter()) {
                body.filter = ary.filter();
                body.filter.limit = body.filter.limit || ary.defaultLimit();
            }

            body.showDeleted = ary.showDeleted();
            if (subid) {
                body.subscription = {
                    id: subid,
                    sessionId: catalog.sessionId(),
                    merge: merge
                };
            }

            url = ary.path();
            payload = {
                method: "POST",
                url: url,
                data: body
            };
console.log(payload.url);
            return m.request(payload)
                .then(callback)
                .catch(console.error);
        };

        doSave = function (context) {
            var requests = [];

            dirty.forEach(function (model) {
                requests.push(model.save());
            });

            Promise.all(requests)
                .then(context.resolve)
                .catch(context.reject);
        };

        doSend = function (...args) {
            var evt = args[0],
                merge = args[1];

            return new Promise(function (resolve, reject) {
                var context = {
                    resolve: resolve,
                    reject: reject
                };

                if (args.length > 1) {
                    context.merge = merge;
                }

                state.send(evt, context);
            });
        };

        // Define statechart
        state = statechart.define(function () {
            this.state("Unitialized", function () {
                this.event("fetch", function (context) {
                    this.goto("/Busy", {
                        context: context
                    });
                });
            });

            this.state("Busy", function () {
                this.state("Fetching", function () {
                    this.enter(doFetch);
                });
                this.state("Saving", function () {
                    this.enter(doSave);
                    this.event("changed", function () {
                        this.goto("/Fetched");
                    });
                    this.canExit = function () {
                        return !dirty.length;
                    };
                });
                this.event("fetched", function () {
                    this.goto("/Fetched");
                });
            });

            this.state("Fetched", function () {
                this.event("changed", function () {
                    this.goto("/Fetched", {
                        force: true
                    });
                });
                this.C(function () {
                    if (dirty.length) {
                        return "./Dirty";
                    }
                    return "./Clean";
                });
                this.event("fetch", function (context) {
                    this.goto("/Busy", {
                        context: context
                    });
                });
                this.state("Clean", function () {
                    this.enter(function () {
                        dirty.length = 0;
                    });
                });
                this.state("Dirty", function () {
                    this.event("save", function (context) {
                        this.goto("/Busy/Saving", {
                            context: context
                        });
                    });
                });
            });
        });
        state.goto();

        return ary;
    };

    module.exports = list;

}());