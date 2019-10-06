/*
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
*/
/*jslint node, for*/
/**
    Create, read, update and delete methods for persisting data to the
    database.
    @module CRUD
*/
(function (exports) {
    "use strict";

    const {Currency} = require("./currency");
    const {Database} = require("../database");
    const {Events} = require("./events");
    const {Feathers} = require("./feathers");
    const {Tools} = require("./tools");

    const currency = new Currency();
    const db = new Database();
    const events = new Events();
    const feathers = new Feathers();
    const tools = new Tools();
    const formats = tools.formats;
    const f = require("../../common/core");
    const jsonpatch = require("fast-json-patch");

    /**
        Return a promise that resolves money object with
        zero amount and base currency. Used as currency
        default.

        @method money
        @for f
        @return {Promise} Resolves to {{#crossLink "Money"}}{{/crossLink}}
    */
    f.money = function () {
        return new Promise(function (resolve, reject) {
            function callback(baseCurr) {
                resolve({
                    amount: 0,
                    currency: baseCurr.code,
                    effective: null,
                    baseAmount: null
                });
            }

            currency.baseCurrency({data: {}}).then(
                callback
            ).catch(
                reject
            );
        });
    };

    /**
        Services for create, read, update and delete actions.

        @class CRUD
        @constructor
        @namespace Services
    */
    exports.CRUD = function () {
        // ..........................................................
        // PRIVATE
        //

        const crud = {};

        // ..........................................................
        // PUBLIC
        //

        /**
            Perform soft delete on object records.

            @method doDelete
            @param {Object} payload Request payload
            @param {String} payload.id Id of record to delete
            @param {String | Object} payload.client Database client
            @param {Boolean} [payload.isHard] Hard delete flag. Default false.
            @param {Boolean} [isChild] Request as child. Default false.
            @param {Boolean} [isSuperUser] Request as super user. Default false.
            @return {Promise} Resolves `true` if successful
        */
        crud.doDelete = function (obj, isChild, isSuperUser) {
            return new Promise(function (resolve, reject) {
                let oldRec;
                let keys;
                let props;
                let noChildProps;
                let afterGetFeather;
                let afterAuthorization;
                let afterDoSelect;
                let afterDelete;
                let afterLog;
                let sql = "UPDATE object SET is_deleted = true WHERE id=$1;";
                let clen = 1;
                let c = 0;
                let client = db.getClient(obj.client);

                if (obj.isHard === true) {
                    sql = "DELETE FROM object WHERE id=$1;";
                }

                noChildProps = function (key) {
                    let t = props[key].type;

                    if (typeof t !== "object" || !t.childOf) {
                        return true;
                    }
                };

                afterGetFeather = function (feather) {
                    props = feather.properties;

                    if (!isChild && feather.isChild) {
                        reject("Can not directly delete a child class");
                        return;
                    }

                    if (isSuperUser === false) {
                        feathers.isAuthorized({
                            client: client,
                            data: {
                                id: obj.id,
                                action: "canDelete"
                            }
                        }).then(afterAuthorization).catch(reject);
                        return;
                    }

                    afterAuthorization(true);
                };

                afterAuthorization = function (authorized) {
                    if (!authorized) {
                        reject("Not authorized to delete \"" + obj.id + "\"");
                        return;
                    }

                    // Get old record, bail if it doesn't exist
                    // Exclude childOf relations when we select
                    crud.doSelect({
                        name: obj.name,
                        id: obj.id,
                        showDeleted: true,
                        properties: Object.keys(props).filter(noChildProps),
                        client: client
                    }, true).then(afterDoSelect).catch(reject);
                };

                afterDoSelect = function (resp) {
                    let eventKey = "_eventkey"; // JSLint no underscore
                    let msg;

                    oldRec = resp;

                    if (!oldRec) {
                        reject("Record " + obj.id + " not found.");
                        return;
                    }

                    if (oldRec.isDeleted) {
                        reject("Record " + obj.id + " already deleted.");
                        return;
                    }

                    if (
                        oldRec && oldRec.lock &&
                        oldRec.lock[eventKey] !== obj.eventkey
                    ) {
                        msg = "Record is locked by " + oldRec.lock.username;
                        msg += " and cannot be updated.";
                        reject(new Error(msg));
                        return;
                    }

                    // Get keys for properties of child arrays.
                    // Count expected callbacks along the way.
                    keys = Object.keys(props).filter(function (key) {
                        if (
                            typeof props[key].type === "object" &&
                            props[key].type.parentOf
                        ) {
                            clen += oldRec[key].length;
                            return true;
                        }
                    });

                    // Delete children recursively
                    keys.forEach(function (key) {
                        let rel = props[key].type.relation;
                        oldRec[key].forEach(function (row) {
                            crud.doDelete({
                                name: rel,
                                id: row.id,
                                client: client,
                                isHard: obj.isHard
                            }, true).then(afterDelete).catch(reject);
                        });
                    });

                    // Finally, delete parent object
                    client.query(sql, [obj.id], afterDelete);
                };

                // Handle change log
                afterDelete = function () {
                    let now = f.now();

                    // Move on only after all callbacks report back
                    c += 1;
                    if (c < clen) {
                        return;
                    }

                    if (isChild || obj.isHard) {
                        afterLog();
                        return;
                    }

                    // Log the completed deletion
                    crud.doInsert({
                        name: "Log",
                        data: {
                            objectId: obj.id,
                            action: "DELETE",
                            created: now,
                            createdBy: now,
                            updated: now,
                            updatedBy: now
                        },
                        client: client
                    }, true).then(afterLog).catch(reject);
                };

                afterLog = function () {
                    resolve(true);
                };

                // Kick off query by getting feather, the rest falls
                // through callbacks
                feathers.getFeather({
                    client: client,
                    data: {
                        name: obj.name
                    }
                }).then(afterGetFeather).catch(reject);
            });
        };

        /**
            Insert records for a passed object.

            @method doInsert
            @param {Object} payload Request payload
            @param {String} payload.name Object type name
            @param {Object} payload.data Data to insert
            @param {String | Object} payload.client Database client
            @param {Boolean} [isChild] Request as child. Default false.
            @param {Boolean} [isSuperUser] Request as super user. Default false.
            @return {Promise} Resolves to array of patches reporting back
            differences between request and actual saved record result.
        */
        crud.doInsert = function (obj, isChild, isSuperUser) {
            return new Promise(function (resolve, reject) {
                let sql;
                let col;
                let key;
                let child;
                let pk;
                let n;
                let dkeys;
                let fkeys;
                let len;
                let msg;
                let props;
                let prop;
                let value;
                let result;
                let afterGetFeather;
                let afterIdCheck;
                let afterNextVal;
                let afterAuthorized;
                let buildInsert;
                let afterGetPk;
                let afterHandleRelations;
                let insertChildren;
                let afterInsert;
                let afterDoSelect;
                let afterLog;
                let afterUniqueCheck;
                let feather;
                let payload;
                let data = f.copy(obj.data);
                let name = obj.name || "";
                let args = [name.toSnakeCase()];
                let tokens = [];
                let params = [];
                let values = [];
                let unique = false;
                let clen = 1;
                let c = 0;
                let p = 2;
                let client = db.getClient(obj.client);

                payload = {
                    data: {
                        name: obj.name
                    },
                    client: client
                };

                afterGetFeather = function (resp) {
                    if (!resp) {
                        reject("Class \"" + name + "\" not found");
                        return;
                    }

                    feather = resp;
                    props = feather.properties;
                    fkeys = Object.keys(props);
                    dkeys = Object.keys(data);

                    /* Validate properties are valid */
                    len = dkeys.length;
                    for (n = 0; n < len; n += 1) {
                        if (fkeys.indexOf(dkeys[n]) === -1) {
                            msg = "Feather \"" + name;
                            msg += "\" does not contain property \"";
                            msg += dkeys[n] + "\"";
                            reject(new Error(msg));
                            return;
                        }
                    }

                    /* Check id for existence and uniqueness and regenerate
                       if needed */
                    if (!data.id) {
                        afterIdCheck(null, -1);
                        return;
                    }

                    tools.getKey({
                        id: data.id,
                        client: client
                    }, true).then(afterIdCheck).catch(reject);
                };

                afterIdCheck = function (id) {
                    if (id !== undefined) {
                        data.id = f.createId();
                    }

                    Object.keys(feather.properties).some(function (key) {
                        let fp = feather.properties[key];

                        if (fp.isNaturalKey && !fp.autonumber) {
                            unique = {
                                feather: fp.inheritedFrom || feather.name,
                                prop: key,
                                value: obj.data[key],
                                label: fp.alias || key
                            };

                            return true;
                        }

                        return false;
                    });

                    if (unique) {
                        tools.getKeys({
                            client: client,
                            name: unique.feather,
                            filter: {
                                criteria: [{
                                    property: unique.prop,
                                    value: unique.value
                                }]
                            }
                        }).then(afterUniqueCheck).catch(reject);
                        return;
                    }

                    afterUniqueCheck();
                };

                afterUniqueCheck = function (resp) {
                    if (resp && resp.length) {
                        msg = "Value '" + unique.value + "' assigned to ";
                        msg += unique.label.toName() + " on ";
                        msg += feather.name.toName();
                        msg += " is not unique to data type ";
                        msg += unique.feather.toName() + ".";
                        reject(new Error(msg));
                        return;
                    }

                    if (!isChild && isSuperUser === false) {
                        feathers.isAuthorized({
                            client: client,
                            data: {
                                feather: name,
                                action: "canCreate"
                            }
                        }).then(afterAuthorized).catch(reject);
                        return;
                    }

                    afterAuthorized(true);
                };

                afterAuthorized = function (authorized) {
                    if (!authorized) {
                        msg = "Not authorized to create \"";
                        msg += obj.name + "\"";
                        reject({
                            statusCode: 401,
                            message: msg
                        });
                        return;
                    }

                    // Set some system controlled values
                    data.updated = f.now();
                    data.created = data.updated;
                    data.createdBy = client.currentUser();
                    data.updatedBy = client.currentUser();
                    data.isDeleted = false;
                    data.lock = null;

                    // Get primary key
                    sql = "select nextval('object__pk_seq')";
                    client.query(sql, afterNextVal);
                };

                afterNextVal = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    pk = resp.rows[0].nextval;
                    values.push(pk);

                    /* Build values */
                    len = fkeys.length;
                    n = 0;
                    buildInsert();
                };

                buildInsert = function () {
                    let callback;

                    if (n < len) {
                        key = fkeys[n];
                        child = false;
                        prop = props[key];
                        n += 1;
                        value = undefined;

                        /* Handle relations */
                        if (typeof prop.type === "object") {
                            if (prop.type.parentOf) {
                                /* To many */
                                child = true;

                                /* To one */
                            } else {
                                col = tools.relationColumn(
                                    key,
                                    prop.type.relation
                                );

                                if (
                                    data[key] === null ||
                                    data[key] === undefined
                                ) {
                                    if (
                                        prop.default !== undefined && (
                                            prop.default !== null ||
                                            prop.type === "object" ||
                                            prop.type === "array" ||
                                            prop.format === "date" ||
                                            prop.format === "dateTime"
                                        )
                                    ) {
                                        data[key] = prop.default;
                                    } else if (prop.isRequired !== true) {
                                        value = -1;
                                    } else {
                                        msg = "Property " + key;
                                        msg += " is required on ";
                                        msg += feather.name + ".";
                                        reject(new Error(msg));
                                        return;
                                    }
                                }
                                if (value !== -1) {
                                    if (prop.type.isChild) {
                                        /* Insert child relation on the fly */
                                        crud.doInsert({
                                            name: prop.type.relation,
                                            data: data[key],
                                            client: client
                                        }, true, true).then(function () {
                                            tools.getKey({
                                                id: data[key].id,
                                                client: client
                                            }).then(afterGetPk).catch(reject);
                                        }).catch(reject);
                                        return;
                                    }

                                    /* Relation must already exist */
                                    if (prop.type.childOf && obj.pk) {
                                        afterGetPk(obj.pk);
                                    } else {
                                        tools.getKey({
                                            id: data[key].id,
                                            client: client
                                        }).then(afterGetPk).catch(reject);
                                    }
                                    return;
                                }
                            }

                            /* Handle discriminator */
                        } else if (key === "objectType") {
                            child = true;

                            /* Handle regular types */
                        } else {
                            value = data[key];
                            col = key.toSnakeCase();

                            // Handle objects whose values are actually strings
                            if (
                                prop.type === "object" &&
                                typeof value === "string" &&
                                value.slice(0, 1) !== "["
                            ) {
                                value = "\"" + value + "\"";
                            } else if (prop.type === "array") {
                                value = JSON.stringify(value);
                            }

                            // Handle autonumber
                            if (
                                prop.autonumber && (
                                    value === undefined || prop.isReadOnly
                                )
                            ) {
                                callback = function (err, resp) {
                                    let seq = resp.rows[0].seq - 0;

                                    if (err) {
                                        reject(err);
                                        return;
                                    }

                                    value = prop.autonumber.prefix || "";
                                    value += seq.pad(prop.autonumber.length);
                                    value += prop.autonumber.suffix || "";
                                    afterHandleRelations();
                                };

                                client.query(
                                    "SELECT nextval($1) AS seq",
                                    [prop.autonumber.sequence],
                                    callback
                                );
                                return;
                            }

                            // Handle other types of defaults
                            if (value === undefined) {
                                if (
                                    prop.default !== undefined
                                ) {
                                    value = prop.default;
                                } else if (
                                    prop.format &&
                                    formats[prop.format] &&
                                    formats[prop.format].default !== undefined
                                ) {
                                    value = formats[prop.format].default;
                                } else {
                                    value = tools.types[prop.type].default;
                                }

                                // If we have a class specific default that
                                // calls a function
                                if (
                                    typeof value === "string" &&
                                    value.match(/\(\)$/)
                                ) {
                                    value = f[value.replace(/\(\)$/, "")]();

                                    if (value.constructor.name === "Promise") {
                                        Promise.all([value]).then(
                                            function (resp) {
                                                value = resp[0];
                                                afterHandleRelations();
                                            }
                                        ).catch(
                                            reject
                                        );
                                        return;
                                    }
                                }
                            }
                        }

                        afterHandleRelations();
                        return;
                    }

                    sql = (
                        "INSERT INTO %I (_pk, " + tokens.toString(",") +
                        ") VALUES ($1," + params.toString(",") + ");"
                    );
                    sql = sql.format(args);

                    // Insert children first so notification gets full object
                    insertChildren();
                };

                afterGetPk = function (id) {
                    value = id;

                    if (value === undefined) {
                        msg = "Relation not found in \"";
                        msg += prop.type.relation;
                        msg += "\" for \"" + key + "\" with id \"";
                        msg += data[key].id + "\"";
                        reject(new Error(msg));
                        return;
                    }

                    if (!isChild && prop.type.childOf) {
                        msg = "Child records may only be created from the";
                        msg += " parent.";
                        reject(new Error(msg));
                        return;
                    }

                    afterHandleRelations();
                };

                afterHandleRelations = function () {
                    if (!child) {
                        if (prop.isRequired && value === null) {
                            msg = "\"" + key + "\" is required on ";
                            msg += feather.name + ".";
                            reject(new Error(msg));
                            return;
                        }

                        /* Handle non-relational composites */
                        if (
                            prop.type === "object" &&
                            prop.format === "money"
                        ) {
                            Object.keys(value || {}).forEach(function (attr) {
                                args.push(col);
                                args.push(attr.toSnakeCase());
                                tokens.push("%I.%I");
                                values.push(value[attr.toSnakeCase()]);
                                params.push("$" + p);
                                p += 1;
                            });
                            buildInsert();
                            return;
                        }

                        /* Handle everything else */
                        args.push(col);
                        tokens.push("%I");
                        values.push(value);
                        params.push("$" + p);
                        p += 1;
                    }

                    buildInsert();
                };

                insertChildren = function (err) {
                    let ckeys;

                    if (err) {
                        reject(err);
                        return;
                    }

                    // Get keys for properties of child arrays.
                    // Count expected callbacks along the way.
                    ckeys = Object.keys(props).filter(function (key) {
                        if (
                            typeof props[key].type === "object" &&
                            props[key].type.parentOf &&
                            data[key] !== undefined
                        ) {
                            clen += data[key].length;
                            return true;
                        }
                    });

                    // Insert children recursively
                    ckeys.forEach(function (key) {
                        let rel = props[key].type.relation;

                        data[key].forEach(function (row) {
                            row[props[key].type.parentOf] = {
                                id: data.id
                            };
                            crud.doInsert({
                                pk: pk,
                                name: rel,
                                data: row,
                                client: client
                            }, true).then(afterInsert).catch(reject);
                        });
                    });

                    afterInsert();
                };

                afterInsert = function () {
                    function afterParentInsert() {
                        // We're done here if child
                        if (isChild) {
                            resolve(result);
                            return;
                        }

                        // Otherwise move on to log the change
                        crud.doSelect({
                            name: obj.name,
                            id: data.id,
                            client: client
                        }).then(afterDoSelect).catch(reject);
                    }

                    // Done only when all callbacks report back
                    c += 1;
                    if (c < clen) {
                        return;
                    }

                    // Perform the parent insert
                    client.query(sql, values).then(
                        afterParentInsert
                    ).catch(
                        reject
                    );
                };

                afterDoSelect = function (resp) {
                    result = resp;

                    /* Handle change log */
                    crud.doInsert({
                        name: "Log",
                        data: {
                            objectId: data.id,
                            action: "POST",
                            created: data.created,
                            createdBy: data.createdBy,
                            updated: data.updated,
                            updatedBy: data.updatedBy,
                            change: f.copy(result)
                        },
                        client: client
                    }, true).then(afterLog).catch(reject);
                };

                afterLog = function () {
                    // We're going to return the changes
                    result = jsonpatch.compare(obj.cache, result);

                    // Report back result
                    resolve(result);
                };

                // Kick off query by getting feather, the rest falls
                // through callbacks
                feathers.getFeather(payload).then(
                    afterGetFeather
                ).catch(
                    reject
                );
            });
        };

        /**
            Select records for an object based on payload id or an
            array of objects if no id provided.

            @method doSelect
            @param {Object} payload Request payload
            @param {String} [payload.id] Id of record to select
            @param {String} payload.name Name of feather
            @param {Object} [payload.filter] Filter criteria of records to
            select
            @param {Array} [payload.properties] Array of properties to include.
            If not specified, all properties will be returned.
            @param {String | Object} payload.client Database client
            @param {Boolean} [payload.showDeleted] include deleted records
            @param {Object} [payload.subscription] subscribe to events on
            results
            @param {Boolean} [payload.sanitize] sanitize result. Default true
            @param {Boolean} [isChild] Request as child. Default false.
            @param {Boolean} [isSuperUser] Request as super user. Default false.
            @return {Promise} Resolves to object or array.
        */
        crud.doSelect = function (obj, isChild, isSuperUser) {
            return new Promise(function (resolve, reject) {
                let sql;
                let table;
                let keys;
                let payload;
                let feather;
                let afterGetFeather;
                let afterGetKey;
                let afterGetKeys;
                let mapKeys;
                let tokens = [];
                let cols = [];
                let client = db.getClient(obj.client);
                let pk = "_pk";

                payload = {
                    name: obj.name,
                    client: client,
                    showDeleted: obj.showDeleted
                };

                function selectToOne(row) {
                    return new Promise(function (resolve, reject) {
                        let props = feather.properties;
                        let requests = [];
                        let rels;

                        rels = Object.keys(props).filter(function (key) {
                            return (
                                typeof props[key].type === "object" &&
                                !props[key].type.parentOf &&
                                !props[key].type.childOf
                            );
                        });

                        rels.forEach(function (key) {
                            let rel = props[key].type.relation;
                            let col = "_" + key + "_" + rel + pk;
                            let attrs = f.copy(props[key].type.properties);

                            col = col.toSnakeCase();

                            if (attrs.indexOf("id") === -1) {
                                attrs.unshift("id");
                            }

                            requests.push(crud.doSelect({
                                client: obj.client,
                                name: rel,
                                properties: attrs,
                                filter: {
                                    criteria: [{
                                        property: pk,
                                        value: row[col]
                                    }]
                                },
                                sanitize: false
                            }, true, true));
                        });

                        Promise.all(requests).then(function (resp) {
                            let i = 0;

                            resp.forEach(function (data) {
                                let key = rels[i];
                                let rel = props[key].type.relation;
                                let col = "_" + key + "_" + rel + pk;

                                col = col.toSnakeCase();

                                delete row[col];
                                row[key] = data[0] || null;
                                i += 1;
                            });

                            resolve();
                        }).catch(reject);
                    });
                }

                function selectToMany(row) {
                    return new Promise(function (resolve, reject) {
                        let props = feather.properties;
                        let keys = obj.properties || Object.keys(props);
                        let requests = [];
                        let rels;

                        rels = keys.filter(function (key) {
                            return (
                                props[key] &&
                                typeof props[key].type === "object" &&
                                props[key].type.parentOf
                            );
                        });

                        rels.forEach(function (key) {
                            let rel = props[key].type.relation;
                            let attr = (
                                "_" + props[key].type.parentOf +
                                "_" + feather.name + pk
                            );

                            attr = attr.toSnakeCase();

                            requests.push(crud.doSelect({
                                client: obj.client,
                                name: rel,
                                filter: {
                                    criteria: [{
                                        property: attr,
                                        value: row[pk]
                                    }],
                                    sort: [{
                                        property: pk
                                    }]
                                },
                                sanitize: false
                            }, true, true));
                        });

                        Promise.all(requests).then(function (resp) {
                            let i = 0;

                            resp.forEach(function (data) {
                                row[rels[i]] = data || [];
                                i += 1;
                            });

                            resolve();
                        }).catch(reject);
                    });
                }

                afterGetFeather = function (resp) {
                    feather = resp;
                    let attrs = [];

                    if (!feather.name) {
                        reject("Feather \"" + obj.name + "\" not found.");
                        return;
                    }

                    table = feather.name.toSnakeCase();

                    // Strip dot notation. Just fetch whole relation
                    if (obj.properties) {
                        keys = obj.properties.map(function (p) {
                            let i = p.indexOf(".");
                            let ret = p;

                            if (i !== -1) {
                                ret = p.slice(0, i);
                                if (attrs.indexOf(ret) !== -1) {
                                    ret = undefined;
                                }
                                attrs.push(ret);
                            }
                            attrs.push(ret);
                            return ret;
                        }).filter(function (p) {
                            return p !== undefined;
                        });
                    }

                    keys = keys || Object.keys(feather.properties);

                    /* Validate */
                    if (!isChild && feather.isChild && !isSuperUser) {
                        reject("Can not query directly on a child class");
                        return;
                    }

                    tokens.push("%I");
                    cols.push(pk);

                    keys.forEach(function (key) {
                        let col = key.toSnakeCase();
                        let type = feather.properties[key].type;

                        if (
                            typeof type === "object" &&
                            !type.parentOf && !type.childOf
                        ) {
                            tokens.push("%I");
                            cols.push(
                                "_" + col + "_" + type.relation.toSnakeCase() +
                                pk
                            );
                        } else if (
                            typeof type !== "object" &&
                            key !== "objectType"
                        ) {
                            tokens.push("%I");
                            cols.push(col);
                        }
                    });

                    cols.push(table);
                    sql = (
                        "SELECT " + tokens.toString(",") + " FROM %I"
                    );
                    sql = sql.format(cols);

                    /* Get one result by key */
                    if (obj.id) {
                        payload.id = obj.id;
                        tools.getKey(
                            payload,
                            isSuperUser
                        ).then(afterGetKey).catch(reject);

                        /* Get a filtered result */
                    } else {
                        payload.filter = obj.filter;
                        tools.getKeys(
                            payload,
                            isSuperUser
                        ).then(afterGetKeys).catch(reject);
                    }
                };

                afterGetKey = function (key) {
                    if (key === undefined) {
                        resolve(undefined);
                        return;
                    }

                    sql += " WHERE _pk = $1";

                    client.query(sql, [key], function (err, resp) {
                        let result;

                        if (err) {
                            reject(err);
                            return;
                        }

                        result = mapKeys(resp.rows[0]);
                        if (obj.sanitize !== false) {
                            result = tools.sanitize(result);
                        }

                        resolve(result);
                    });
                };

                afterGetKeys = function (keys) {
                    let result;
                    let feathername;
                    let sort = (
                        obj.filter
                        ? obj.filter.sort || []
                        : []
                    );
                    let subscription = obj.subscription || {};
                    let i = 0;

                    if (keys.length) {
                        tokens = [];

                        while (keys[i]) {
                            i += 1;
                            tokens.push("$" + i);
                        }

                        sql += " WHERE _pk IN (";
                        sql += tokens.toString(",") + ")";

                        tokens = [];
                        sql += tools.processSort(sort, tokens);
                        sql = sql.format(tokens);

                        client.query(sql, keys).then(function (resp) {
                            let requests = [];

                            resp.rows.forEach(function (row) {
                                if (keys.indexOf("objectType") !== -1) {
                                    row.objectType = obj.name;
                                }
                                requests.push(selectToOne(row));
                                requests.push(selectToMany(row));
                            });

                            Promise.all(requests).then(function () {
                                result = tools.sanitize(resp.rows);

                                if (
                                    !obj.filter || (
                                        !obj.filter.criteria &&
                                        !obj.filter.limit
                                    )
                                ) {
                                    feathername = obj.name;
                                }

                                if (isChild) {
                                    resolve(result);
                                    return;
                                }

                                // Handle subscription
                                events.subscribe(
                                    client,
                                    obj.subscription,
                                    result.map((item) => item.id),
                                    feathername
                                ).then(resolve.bind(null, result)).catch(
                                    reject
                                );
                            });
                        }).catch(reject);
                    } else {
                        // Handle subscription
                        // Q: What if there were just no results in the most
                        // recent offset page, do we really want to completely
                        // unsubscribe?
                        events.unsubscribe(
                            client,
                            subscription.id
                        ).then(
                            function () {
                                resolve([]);
                            }
                        ).catch(
                            reject
                        );
                    }
                };

                mapKeys = function (row) {
                    let rkeys;
                    let result = row.result;
                    let ret = {};
                    let i = 0;

                    if (typeof result === "object") {
                        rkeys = Object.keys(result);
                        rkeys.forEach(function (key) {
                            ret[keys[i]] = result[key];
                            i += 1;
                        });

                        // If only one attribute returned
                    } else {
                        ret[keys[0]] = result;
                    }

                    return ret;
                };

                // Kick off query by getting feather, the rest falls through
                // callbacks
                feathers.getFeather({
                    client: client,
                    data: {
                        name: obj.name
                    }
                }).then(afterGetFeather).catch(reject);
            });
        };

        /**
            Update records based on patch definition.

            @method doUpdate
            @param {Object} payload Request payload
            @param {String} payload.id Id of record to update
            @param {Object} payload.data Patch to apply
            @param {String | Object} payload.client Database client
            @param {Boolean} [isChild] Request as child. Default false.
            @param {Boolean} [isSuperUser] Request as super user. Default
            false.
            @return {Promise} Resolves to array of patches reporting back
            differences between request and actual saved record result.
        */
        crud.doUpdate = function (obj, isChild, isSuperUser) {
            return new Promise(function (resolve, reject) {
                let result;
                let updRec;
                let props;
                let value;
                let sql;
                let pk;
                let relation;
                let key;
                let keys;
                let oldRec;
                let newRec;
                let cpatches;
                let feather;
                let tokens;
                let afterGetKey;
                let afterDoSelect;
                let afterUpdate;
                let afterSelectUpdated;
                let done;
                let nextProp;
                let afterProperties;
                let afterUniqueCheck;
                let unique;
                let doUnlock;
                let afterGetRelKey;
                let cacheRec;
                let patches = obj.data || [];
                let id = obj.id;
                let doList = [];
                let params = [];
                let ary = [];
                let clen = 0;
                let children = [];
                let p = 1;
                let n = 0;
                let client = db.getClient(obj.client);

                if (!patches.length) {
                    resolve([]);
                    return;
                }

                function find(ary, id) {
                    return ary.filter(function (item) {
                        return item && item.id === id;
                    })[0] || false;
                }

                function noChildProps(key) {
                    if (
                        typeof feather.properties[key].type !== "object" ||
                        !feather.properties[key].type.childOf
                    ) {
                        return true;
                    }
                }

                function afterAuthorization(authorized) {
                    if (!authorized) {
                        reject("Not authorized to update \"" + id + "\"");
                        return;
                    }

                    tools.getKey({
                        id: id,
                        client: client
                    }).then(afterGetKey).catch(reject);
                }

                function afterGetFeather(resp) {
                    if (!resp) {
                        reject("Feather \"" + obj.name + "\" not found.");
                        return;
                    }

                    feather = resp;
                    tokens = [feather.name.toSnakeCase()];
                    props = feather.properties;

                    /* Validate */
                    if (!isChild && feather.isChild) {
                        reject("Can not directly update a child class");
                        return;
                    }

                    if (isSuperUser === false) {
                        feathers.isAuthorized({
                            client: client,
                            data: {
                                id: id,
                                action: "canUpdate"
                            }
                        }).then(afterAuthorization).catch(reject);
                        return;
                    }

                    afterAuthorization(true);
                }

                afterGetKey = function (resp) {
                    pk = resp;
                    keys = Object.keys(props);

                    // Get existing record
                    crud.doSelect({
                        name: obj.name,
                        id: obj.id,
                        properties: keys.filter(noChildProps),
                        client: client,
                        sanitize: false
                    }, isChild).then(afterDoSelect).catch(reject);
                };

                afterDoSelect = function (resp) {
                    let eventKey = "_eventkey"; // JSLint no underscore
                    let msg;

                    function requiredIsNull(fkey) {
                        if (props[fkey].isRequired && updRec[fkey] === null) {
                            key = fkey;
                            return true;
                        }
                    }

                    function uniqueChanged(fkey) {
                        let pf = props[fkey];

                        if (
                            pf.isNaturalKey &&
                            updRec[fkey] !== oldRec[fkey]
                        ) {

                            unique = {
                                feather: pf.inheritedFrom || feather.name,
                                prop: fkey,
                                value: updRec[fkey],
                                label: pf.alias || fkey
                            };

                            return true;
                        }
                    }

                    if (
                        oldRec && oldRec.lock &&
                        oldRec.lock[eventKey] !== obj.eventkey
                    ) {
                        msg = "Record is locked by ";
                        msg += oldRec.lock.username;
                        msg += " and cannot be updated.";
                        reject(new Error(msg));
                        return;
                    }

                    oldRec = tools.sanitize(resp);

                    if (!Object.keys(oldRec).length || oldRec.isDeleted) {
                        resolve(false);
                        return;
                    }

                    newRec = f.copy(oldRec);
                    jsonpatch.applyPatch(newRec, patches);

                    // Capture changes from original request
                    if (obj.cache) {
                        cacheRec = f.copy(oldRec);
                        jsonpatch.applyPatch(cacheRec, obj.cache);
                    }

                    if (!patches.length) {
                        afterUpdate();
                        return;
                    }

                    updRec = f.copy(newRec);

                    // Revert data that may not be updated directly
                    updRec.created = oldRec.created;
                    updRec.createdBy = oldRec.createdBy;
                    updRec.updated = new Date().toJSON();
                    updRec.updatedBy = client.currentUser();
                    updRec.isDeleted = false;
                    updRec.lock = oldRec.lock;

                    if (props.etag) {
                        updRec.etag = f.createId();
                    }

                    // Check required properties
                    if (keys.some(requiredIsNull)) {
                        reject("\"" + key + "\" is required.");
                        return;
                    }

                    // Check unique properties
                    if (keys.some(uniqueChanged)) {
                        tools.getKeys({
                            client: client,
                            name: unique.feather,
                            filter: {
                                criteria: [{
                                    property: unique.prop,
                                    value: unique.value
                                }]
                            }
                        }).then(afterUniqueCheck).catch(reject);
                        return;
                    }

                    // Process properties
                    nextProp();
                };

                afterUniqueCheck = function (resp) {
                    let msg;

                    if (resp && resp.length) {
                        msg = "Value '" + unique.value + "' assigned to ";
                        msg += unique.label.toName() + " on ";
                        msg += feather.name.toName();
                        msg += " is not unique to data type ";
                        msg += unique.feather.toName() + ".";
                        reject(new Error(msg));
                        return;
                    }

                    nextProp();
                };

                nextProp = function () {
                    let updProp;
                    let oldProp;
                    let msg;

                    key = keys[n];
                    n += 1;

                    if (n <= keys.length) {
                        /* Handle composite types */
                        if (typeof props[key].type === "object") {
                            updProp = updRec[key] || {};
                            oldProp = oldRec[key] || {};

                            /* Handle child records */
                            if (Array.isArray(updRec[key])) {
                                relation = props[key].type.relation;

                                /* Process deletes */
                                oldRec[key].forEach(function (row) {
                                    let cid = row.id;

                                    if (!find(updRec[key], cid)) {
                                        clen += 1;
                                        doList.push({
                                            func: crud.doDelete,
                                            payload: {
                                                name: relation,
                                                id: cid,
                                                client: client
                                            }
                                        });
                                    }
                                });

                                /* Process inserts and updates */
                                updRec[key].forEach(function (cNewRec) {
                                    if (!cNewRec) {
                                        return;
                                    }

                                    let cid = cNewRec.id || null;
                                    let cOldRec = find(oldRec[key], cid);

                                    if (cOldRec) {
                                        cpatches = jsonpatch.compare(
                                            cOldRec,
                                            cNewRec
                                        );

                                        if (cpatches.length) {
                                            clen += 1;
                                            doList.push({
                                                func: crud.doUpdate,
                                                payload: {
                                                    name: relation,
                                                    id: cid,
                                                    data: cpatches,
                                                    client: client
                                                }
                                            });
                                        }
                                    } else {
                                        cNewRec[props[key].type.parentOf] = {
                                            id: updRec.id
                                        };
                                        clen += 1;
                                        doList.push({
                                            func: crud.doInsert,
                                            payload: {
                                                name: relation,
                                                data: cNewRec,
                                                client: client
                                            }
                                        });
                                    }
                                });

                            /* Handle child relation updates */
                            } else if (props[key].type.isChild) {
                                /* Do delete */
                                if (oldRec[key] && !updRec[key]) {
                                    crud.doDelete({
                                        name: props[key].type.relation,
                                        id: oldRec[key].id,
                                        client: client,
                                        isHard: true
                                    }, true, true).then(function () {
                                        afterGetRelKey(null, -1);
                                    }).catch(reject);

                                    return;
                                }

                                /* Do insert */
                                if (updRec[key] && !oldRec[key]) {
                                    crud.doInsert({
                                        name: props[key].type.relation,
                                        id: updRec[key].id,
                                        data: updRec[key],
                                        client: client
                                    }, true, true).then(function () {
                                        tools.getKey({
                                            id: updRec[key].id,
                                            client: client
                                        }).then(
                                            afterGetRelKey
                                        ).catch(
                                            reject
                                        );
                                    }).catch(reject);

                                    return;
                                }

                                if (
                                    updRec[key] && oldRec[key] &&
                                    updRec[key].id !== oldRec[key].id
                                ) {
                                    msg = "Id cannot be changed on child";
                                    msg += "relation '" + key + "'";
                                    reject(new Error(msg));
                                    return;
                                }

                                /* Do update */
                                cpatches = jsonpatch.compare(
                                    oldRec[key] || {},
                                    updRec[key] || {}
                                );

                                if (cpatches.length) {
                                    crud.doUpdate({
                                        name: props[key].type.relation,
                                        id: updRec[key].id,
                                        data: cpatches,
                                        client: client
                                    }, true, true).then(function () {
                                        tools.getKey({
                                            id: updRec[key].id,
                                            client: client
                                        }).then(
                                            afterGetRelKey
                                        ).catch(
                                            reject
                                        );
                                    }).catch(reject);
                                    return;
                                }

                                nextProp();
                                return;
                            }

                            /* Handle regular to one relations */
                            if (
                                !props[key].type.childOf &&
                                updProp.id !== oldProp.id
                            ) {

                                if (updProp.id) {
                                    tools.getKey({
                                        id: updRec[key].id,
                                        client: client
                                    }).then(afterGetRelKey).catch(reject);
                                } else {
                                    afterGetRelKey(null, -1);
                                }
                                return;
                            }

                            /* Handle non-relational composites */
                        } else if (
                            updRec[key] !== oldRec[key] &&
                            props[key].type === "object" &&
                            props[key].format === "money"
                        ) {

                            Object.keys(updRec[key]).forEach(
                                function (attr) {
                                    tokens.push(key.toSnakeCase());
                                    tokens.push(attr.toSnakeCase());
                                    ary.push("%I.%I = $" + p);
                                    params.push(updRec[key][attr]);
                                    p += 1;
                                }
                            );

                            /* Handle regular data types */
                        } else if (
                            updRec[key] !== oldRec[key] && key !== "objectType"
                        ) {

                            // Handle objects whose values are actually
                            // strings
                            if (
                                props[key].type === "object" &&
                                typeof updRec[key] === "string" &&
                                updRec[key].slice(0, 1) !== "["
                            ) {
                                updRec[key] = "\"" + updRec[key] + "\"";
                            } else if (props[key].type === "array") {
                                updRec[key] = JSON.stringify(updRec[key]);
                            }

                            tokens.push(key.toSnakeCase());
                            ary.push("%I = $" + p);
                            params.push(updRec[key]);
                            p += 1;
                        }

                        nextProp();
                        return;
                    }

                    // Done, move on
                    afterProperties();
                };

                afterGetRelKey = function (resp) {
                    let msg;

                    value = resp;
                    relation = props[key].type.relation;

                    if (value === undefined) {
                        msg = "Relation not found in \"";
                        msg += relation + "\" for \"" + key;
                        msg += "\" with id \"" + updRec[key].id + "\"";
                        reject(new Error(msg));
                        return;
                    }

                    tokens.push(tools.relationColumn(key, relation));
                    ary.push("%I = $" + p);
                    params.push(value);
                    p += 1;

                    nextProp();
                };

                afterProperties = function () {
                    // Execute child changes first so all captured in any
                    // notification
                    children = doList.map(
                        (item) => item.func(item.payload, true)
                    );

                    // Execute top level object change
                    sql = (
                        "UPDATE %I SET " + ary.join(",") +
                        " WHERE _pk = $" + p
                    );
                    sql = sql.format(tokens);
                    params.push(pk);
                    clen += 1;

                    Promise.all(children).then(
                        () => client.query(sql, params)
                    ).then(
                        afterUpdate
                    ).catch(
                        reject
                    );
                };

                afterUpdate = function () {
                    // If child, we're done here
                    if (isChild) {
                        resolve();
                        return;
                    }

                    // If a top level record, return patch of what changed
                    crud.doSelect({
                        name: feather.name,
                        id: id,
                        client: client
                    }).then(afterSelectUpdated).catch(reject);
                };

                afterSelectUpdated = function (resp) {
                    result = resp;

                    // Handle change log
                    if (updRec) {
                        crud.doInsert({
                            name: "Log",
                            data: {
                                objectId: id,
                                action: "PATCH",
                                created: updRec.updated,
                                createdBy: updRec.updatedBy,
                                updated: updRec.updated,
                                updatedBy: updRec.updatedBy,
                                change: JSON.stringify(jsonpatch.compare(
                                    oldRec,
                                    result
                                ))
                            },
                            client: client
                        }, true).then(doUnlock).catch(reject);
                        return;
                    }
                    doUnlock();
                };

                doUnlock = function () {
                    crud.unlock(client, {
                        id: obj.id
                    }).then(
                        done
                    ).catch(
                        reject
                    );
                };

                done = function () {
                    // Remove the lock information
                    result.lock = null;

                    // Send back the differences between what user asked
                    // for and result
                    resolve(jsonpatch.compare(cacheRec, result));
                };

                // Kick off query by getting feather, the rest falls
                // through callbacks
                feathers.getFeather({
                    client: client,
                    data: {
                        name: obj.name
                    }
                }).then(afterGetFeather).catch(reject);
            });
        };

        /**
            Lock a record to prevent others from editing.

            @method lock
            @param {Object} client Database client connection id
            @param {String} nodeId Node id.
            @param {String} id Record id
            @param {String} username
            @param {String} eventKey
            @return {Promise} Resolves to `true` if successful.
        */
        crud.lock = function (client, nodeid, id, username, eventkey) {
            return new Promise(function (resolve, reject) {
                let msg;

                if (!nodeid) {
                    reject(new Error("Lock requires a node id."));
                    return;
                }

                if (!eventkey) {
                    reject(new Error("Lock requires an eventkey."));
                    return;
                }

                if (!id) {
                    reject(new Error("Lock requires an object id."));
                    return;
                }

                if (!username) {
                    reject(new Error("Lock requires a username."));
                    return;
                }

                function checkLock() {
                    return new Promise(function (resolve, reject) {
                        let sql = "SELECT lock FROM object WHERE id = $1";

                        function callback(resp) {
                            if (!resp.rows.length) {
                                msg = "Record " + id + " not found.";
                                reject(new Error(msg));
                                return;
                            }

                            if (resp.rows[0].lock) {
                                msg = "Record " + id + " is already locked.";
                                reject(new Error(msg));
                                return;
                            }

                            resolve();
                        }

                        client.query(sql, [id]).then(
                            callback
                        ).catch(
                            reject
                        );
                    });
                }

                function doLock() {
                    return new Promise(function (resolve, reject) {
                        let params;
                        let sql;

                        sql = (
                            "UPDATE object " +
                            "SET lock = ROW($1, now(), $2, $3) " +
                            "WHERE id = $4"
                        );

                        function callback() {
                            resolve(true);
                        }

                        params = [
                            username,
                            nodeid,
                            eventkey,
                            id
                        ];

                        client.query(sql, params).then(
                            callback
                        ).catch(
                            reject
                        );
                    });
                }

                Promise.resolve().then(
                    checkLock
                ).then(
                    doLock
                ).then(
                    resolve
                ).catch(
                    reject
                );

            });
        };

        /**
            Unlock object(s) by type. At least one criteria must be provided.

            @method unlock
            @param {Object} client Database client connection id
            @param {Object} criteria Criteria for what to unlock.
            @param {String} [criteria.id] Object id.
            @param {String} [criteria.username] User name.
            @param {String} [criteria.eventKey] Browser instance key.
            @param {String} [criteria.nodeId] Node id.
            @return {Promise} Resolves to array of ids unlocked.
        */
        crud.unlock = function (client, criteria) {
            return new Promise(function (resolve, reject) {
                let sql;
                let params = [];

                function callback(resp) {
                    resolve(resp.rows);
                }

                sql = "UPDATE object SET lock = NULL WHERE true ";

                if (criteria.id) {
                    params.push(criteria.id);
                    sql += " AND object.id = $1";
                }

                if (criteria.username) {
                    params.push(criteria.username);
                    sql += " AND username(lock) = $" + params.length;
                }

                if (criteria.eventKey) {
                    params.push(criteria.eventKey);
                    sql += " AND _eventkey(lock) = $" + params.length;
                }

                if (criteria.nodeId) {
                    params.push(criteria.nodeId);
                    sql += " AND _nodeid(lock) = $" + params.length;
                }

                if (!params.length) {
                    reject(new Error("No lock criteria defined."));
                    return;
                }

                sql += " RETURNING id; ";

                client.query(sql, params).then(
                    callback
                ).catch(
                    reject
                );
            });
        };

        return crud;
    };

}(exports));

