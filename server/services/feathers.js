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
/*jslint node, this*/
/**
    @module Feathers
*/
(function (exports) {
    "use strict";

    const {Database} = require("../database");
    const {Tools} = require("./tools");
    const {Settings} = require("./settings");
    const f = require("../../common/core");

    const db = new Database();
    const settings = new Settings();
    const tools = new Tools();
    const formats = tools.formats;

    const reserved = [
        "ALL",
        "ANALYSE",
        "ANALYZE",
        "AND",
        "ANY",
        "ARRAY",
        "AS",
        "ASC",
        "ASYMMETRIC",
        "AUTHORIZATION",
        "BINARY",
        "BOTH",
        "CASE",
        "CAST",
        "CHECK",
        "COLLATE",
        "COLLATION",
        "COLUMN",
        "CONCURRENTLY",
        "CONSTRAINT",
        "CREATE",
        "CROSS",
        "CURRENT_CATALOG",
        "CURRENT_DATE",
        "CURRENT_ROLE",
        "CURRENT_SCHEMA",
        "CURRENT_TIME",
        "CURRENT_TIMESTAMP",
        "CURRENT_USER",
        "DEFAULT",
        "DEFERRABLE",
        "DESC",
        "DISTINCT",
        "DO",
        "ELSE",
        "END",
        "EXCEPT",
        "FALSE",
        "FETCH",
        "FOR",
        "FOREIGN",
        "FREEZE",
        "FROM",
        "FULL",
        "GRANT",
        "GROUP",
        "HAVING",
        "ILIKE",
        "IN",
        "INITIALLY",
        "INNER",
        "INTERSECT",
        "INTO",
        "IS",
        "ISNULL",
        "JOIN",
        "LATERAL",
        "LEADING",
        "LEFT",
        "LIKE",
        "LIMIT",
        "LOCALTIME",
        "LOCALTIMESTAMP",
        "MONEY",
        "NATURAL",
        "NOT",
        "NOTNULL",
        "NULL",
        "OFFSET",
        "ON",
        "ONLY",
        "OR",
        "ORDER",
        "OUTER",
        "OVERLAPS",
        "PLACING",
        "PRIMARY",
        "REFERENCES",
        "RETURNING",
        "RIGHT",
        "SELECT",
        "SESSION_USER",
        "SIMILAR",
        "SOME",
        "SYMMETRIC",
        "TABLE",
        "TABLESAMPLE",
        "THEN",
        "TO",
        "TRAILING",
        "TRUE",
        "UNION",
        "UNIQUE",
        "USER",
        "USING",
        "VARIADIC",
        "VERBOSE",
        "WHEN",
        "WHERE",
        "WINDOW",
        "WITH"
    ];

    /**
        Feather management service.

        @class Feathers
        @constructor
        @namespace Services
    */
    exports.Feathers = function () {
        // ..........................................................
        // PRIVATE
        //

        let that = {};

        function createView(obj) {
            let parent;
            let alias;
            let type;
            let view;
            let sub;
            let col;
            let feather;
            let props;
            let keys;
            let afterGetFeather;
            let name = obj.name;
            let execute = obj.execute !== false;
            let dropFirst = obj.dropFirst;
            let table = name.toSnakeCase();
            let args = ["_" + table, "_pk"];
            let cols = ["%I"];
            let sql = "";
            let client = obj.client;
            // Child view variables
            let tProps;
            let tArgs;
            let tCols;
            let tRel;
            let vSql = "";
            let childSql = "";
            let i;

            afterGetFeather = function (resp) {
                feather = resp;
                props = feather.properties;
                keys = Object.keys(props);

                keys.forEach(function (key) {
                    let clause;

                    alias = key.toSnakeCase();

                    /* Handle discriminator */
                    if (key === "objectType") {
                        cols.push("%s");
                        clause = "to_camel_case(tableoid::regclass::text) AS ";
                        clause += alias;
                        args.push(clause);

                        /* Handle relations */
                    } else if (typeof props[key].type === "object") {
                        type = props[key].type;
                        parent = (
                            props[key].inheritedFrom
                            ? props[key].inheritedFrom.toSnakeCase()
                            : table
                        );

                        /* Handle to many */
                        if (type.parentOf) {
                            sub = "ARRAY(SELECT %I FROM %I ";
                            sub += "WHERE %I.%I = %I._pk ";
                            sub += "AND NOT %I.is_deleted ORDER BY %I._pk) ";
                            sub += "AS %I";
                            view = "_";
                            view += props[key].type.relation.toSnakeCase();
                            col = "_" + type.parentOf.toSnakeCase();
                            col += "_" + parent + "_pk";
                            args = args.concat([
                                view,
                                view,
                                view,
                                col,
                                table,
                                view,
                                view,
                                alias
                            ]);

                            /* Handle to one */
                        } else if (!type.childOf) {
                            col = "_" + key.toSnakeCase() + "_";
                            col += props[key].type.relation.toSnakeCase();
                            col += "_pk";
                            sub = "(SELECT %I FROM %I WHERE %I._pk = %I) ";
                            sub += "AS %I";

                            if (props[key].type.properties) {
                                view = "_" + parent + "$" + key.toSnakeCase();

                                // Create child view
                                tProps = props[key].type.properties;
                                tCols = ["%I"];
                                tArgs = [view, "_pk"];

                                /* Always include "id" whether
                                   specified or not */
                                if (tProps.indexOf("id") === -1) {
                                    tProps.unshift("id");
                                }

                                i = 0;
                                while (i < tProps.length) {
                                    tCols.push("%I");
                                    tArgs.push(tProps[i].toSnakeCase());
                                    i += 1;
                                }

                                tRel = (
                                    "_" + props[key].type.relation.toSnakeCase()
                                );
                                tArgs.push(tRel);
                                vSql = "CREATE OR REPLACE VIEW %I AS SELECT ";
                                vSql += tCols.join(",");
                                vSql += " FROM %I ";
                                vSql += "WHERE NOT is_deleted;";
                                childSql += vSql.format(tArgs);
                            } else {
                                view = "_";
                                view += props[key].type.relation.toSnakeCase();
                            }

                            args = args.concat([view, view, view, col, alias]);
                        } else {
                            sub = "_" + key.toSnakeCase() + "_";
                            sub += type.relation.toSnakeCase() + "_pk";
                        }

                        cols.push(sub);

                        /* Handle regular types */
                    } else {
                        cols.push("%I");
                        args.push(alias);
                    }
                });

                args.push(table);

                if (dropFirst) {
                    sql = "DROP VIEW IF EXISTS %I CASCADE;";
                    sql = sql.format(["_" + table]);
                }

                sql += childSql;
                sql += "CREATE OR REPLACE VIEW %I AS SELECT " + cols.join(",");
                sql += " FROM %I;";
                sql = sql.format(args);

                // If execute, run the sql now
                if (execute) {
                    client.query(sql, function (err) {
                        if (err) {
                            obj.callback(err);
                            return;
                        }

                        obj.callback(null, true);
                        return;
                    });
                }

                // Otherwise send the sql back
                obj.callback(null, sql);
            };

            tools.getFeather({
                client: client,
                data: {
                    name: obj.name
                }
            }).then(afterGetFeather).catch(obj.callback);
        }

        function propagateViews(obj) {
            let cprops;
            let catalog;
            let afterGetCatalog;
            let afterCreateView;
            let name = obj.name;
            let statements = obj.statements || [];
            let level = obj.level || 0;
            let sql = "";
            let client = obj.client;

            afterGetCatalog = function (resp) {
                catalog = resp;
                createView({
                    name: name,
                    client: client,
                    callback: afterCreateView,
                    dropFirst: true,
                    execute: false
                });
            };

            afterCreateView = function (err, resp) {
                let keys;
                let next;
                let propagateUp;
                let functions = [];
                let i = 0;

                if (err) {
                    obj.callback(err);
                    return;
                }

                statements.push({
                    level: level,
                    sql: resp
                });

                // Callback to process functions sequentially
                next = function (err, resp) {
                    let o;

                    if (err) {
                        obj.callback(err);
                        return;
                    }

                    // Responses that are result of createView get appended
                    if (typeof resp === "string") {
                        statements.push({
                            level: level,
                            sql: resp
                        });
                    }

                    // Iterate to next function to build statement
                    o = functions[i];
                    i += 1;

                    if (o) {
                        o.func(o.payload);
                        return;
                    }

                    // Only top level will actually execute statements
                    if (level > 0) {
                        obj.callback(null, true);
                        return;
                    }

                    // If here then ready to execute
                    // Sort by level
                    statements.sort(function (a, b) {
                        if (a.level === b.level || a.level < b.level) {
                            return 0;
                        }
                        return 1;
                    });

                    statements.forEach(function (statement) {
                        sql += statement.sql;
                    });

                    client.query(sql, function (err) {
                        if (err) {
                            obj.callback(err);
                            return;
                        }

                        obj.callback(null, true);
                    });
                };

                // Build object to propagate relations */
                keys = Object.keys(catalog);
                keys.forEach(function (key) {
                    let ckeys;

                    cprops = catalog[key].properties;
                    ckeys = Object.keys(cprops);

                    ckeys.forEach(function (ckey) {
                        if (
                            cprops.hasOwnProperty(ckey) &&
                            typeof cprops[ckey].type === "object" &&
                            cprops[ckey].type.relation === name &&
                            !cprops[ckey].type.childOf &&
                            !cprops[ckey].type.parentOf
                        ) {
                            functions.push({
                                func: propagateViews,
                                payload: {
                                    name: key,
                                    client: client,
                                    callback: next,
                                    statements: statements,
                                    level: level + 1
                                }
                            });
                        }
                    });
                });

                /* Propagate down */
                keys = Object.keys(catalog);
                keys.forEach(function (key) {
                    if (catalog[key].inherits === name) {
                        functions.push({
                            func: propagateViews,
                            payload: {
                                name: key,
                                client: client,
                                callback: next,
                                statements: statements,
                                level: level + 1
                            }
                        });
                    }
                });

                /* Propagate up */
                propagateUp = function (name, plevel) {
                    let pkeys;
                    let props;

                    plevel = plevel - 1;
                    props = catalog[name].properties;
                    pkeys = Object.keys(props);
                    pkeys.forEach(function (key) {
                        let type = props[key].type;
                        if (typeof type === "object" && type.childOf) {
                            functions.push({
                                func: createView,
                                payload: {
                                    name: type.relation,
                                    client: client,
                                    callback: next,
                                    execute: false
                                }
                            });
                            propagateUp(type.relation, plevel);
                        }
                    });
                };

                propagateUp(name, level);

                next();
            };

            settings.getSettings({
                client: client,
                data: {
                    name: "catalog"
                }
            }).then(afterGetCatalog).catch(obj.callback);
        }

        function getParentKey(obj) {
            return new Promise(function (resolve, reject) {
                let cParent;
                let afterGetChildFeather;
                let afterGetParentFeather;
                let done;
                let client = obj.client;

                afterGetChildFeather = function (resp) {
                    let cKeys;
                    let cProps;

                    cProps = resp.properties;
                    cKeys = Object.keys(cProps);
                    cKeys.every(function (cKey) {
                        if (
                            typeof cProps[cKey].type === "object" &&
                            cProps[cKey].type.childOf
                        ) {
                            cParent = cProps[cKey].type.relation;

                            tools.getFeather({
                                client: client,
                                data: {
                                    name: obj.parent
                                }
                            }).then(afterGetParentFeather).catch(reject);

                            return false;
                        }

                        return true;
                    });
                };

                afterGetParentFeather = function (resp) {
                    if (resp.isChildFeather) {
                        getParentKey({
                            child: cParent,
                            parent: obj.parent,
                            client: client
                        }).then(resolve).catch(reject);
                        return;
                    }

                    tools.getKey({
                        name: cParent.toSnakeCase(),
                        client: client
                    }).then(done).catch(reject);
                };

                done = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(resp);
                };

                tools.getFeather({
                    client: client,
                    data: {
                        name: obj.child
                    }
                }).then(afterGetChildFeather).catch(reject);
            });
        }

        // ..........................................................
        // PUBLIC
        //

        /**
            Remove a feather definition from the database.

            @method deleteFeather
            @param {Object} payload Request payload
            @param {Object} payload.data Payload data
            @param {String | Array} payload.data.name Name(s) of
                feather(s) to delete
            @param {Client} payload.client Database client
            @return {Promise} Resolves to `true` if successful.
        */
        that.deleteFeather = function (obj) {
            return new Promise(function (resolve, reject) {
                let name;
                let table;
                let catalog;
                let sql;
                let sql1;
                let sql2;
                let sql3;
                let rels;
                let props;
                let view;
                let type;
                let keys;
                let afterGetCatalog;
                let next;
                let createViews;
                let dropTables;
                let names = (
                    Array.isArray(obj.data.name)
                    ? obj.data.name
                    : [obj.data.name]
                );
                let o = 0;
                let c = 0;
                let client = db.getClient(obj.client);

                afterGetCatalog = function (resp) {
                    catalog = resp;
                    next();
                };

                dropTables = function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    // Drop table(s)
                    sql1 = (
                        "DROP VIEW IF EXISTS %I; " +
                        "DROP TABLE IF EXISTS %I;" + sql
                    );
                    sql1 = sql1.format(["_" + table, table]);
                    client.query(sql1, function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        sql2 = "DELETE FROM \"$auth\" WHERE object_pk=";
                        sql2 += "(SELECT _pk FROM \"$feather\" WHERE id=$1);";
                        client.query(sql2, [table], function (err) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            sql3 = "DELETE FROM \"$feather\" WHERE id=$1;";
                            client.query(sql3, [table], function (err) {
                                if (err) {
                                    reject(err);
                                    return;
                                }

                                next();
                            });
                        });
                    });
                };

                createViews = function () {
                    let rel;

                    if (c < rels.length) {
                        rel = rels[c];
                        c += 1;

                        // Update views
                        createView({
                            name: rel,
                            dropFirst: true,
                            client: client,
                            callback: createViews
                        });
                        return;
                    }

                    dropTables();
                };

                next = function () {
                    sql = "";
                    if (o < names.length) {
                        name = names[o];
                        o += 1;
                        table = name.toSnakeCase();
                        rels = [];

                        if (!table || !catalog[name]) {
                            reject("Feather not found");
                            return;
                        }

                        /* Drop views for composite types */
                        props = catalog[name].properties;
                        keys = Object.keys(props);
                        keys.forEach(function (key) {
                            let cfp;

                            if (typeof props[key].type === "object") {
                                type = props[key].type;

                                if (type.properties) {
                                    view = "_" + name.toSnakeCase() + "$";
                                    view += key.toSnakeCase();
                                    sql += "DROP VIEW IF EXISTS %I;";
                                    sql = sql.format([view]);
                                }

                                if (type.childOf && catalog[type.relation]) {
                                    cfp = catalog[type.relation].properties;
                                    delete cfp[type.childOf];
                                    rels.push(type.relation);
                                }
                            }
                        });

                        /* Update catalog settings */
                        delete catalog[name];
                        settings.saveSettings({
                            client: client,
                            data: {
                                name: "catalog",
                                data: catalog
                            }
                        }).then(createViews).catch(reject);
                        return;
                    }

                    // All done
                    resolve(true);
                };

                settings.getSettings({
                    client: client,
                    data: {
                        name: "catalog"
                    }
                }).then(afterGetCatalog).catch(reject);
            });
        };

        /**
            Check whether a user is authorized to perform an action on a
            particular feather (class) or object.

            Allowable actions: `canCreate`, `canRead`, `canUpdate`, `canDelete`

            `canCreate` will only check feather names.

            @method isAuthorized
            @param {Object} payload
            @param {Object} payload.data Payload data
            @param {String} payload.data.action
            @param {String} [payload.data.feather] Feather name
            @param {String} [payload.data.id] Object id
            @param {String} [payload.data.user] Defaults to current user
            @param {Client} payload.client Database client
            @return {Promise} Resolves to Boolean.
        */
        that.isAuthorized = function (obj) {
            return new Promise(function (resolve, reject) {
                let table;
                let pk;
                let authSql;
                let sql;
                let params;
                let user = obj.data.user || obj.client.currentUser();
                let feather = obj.data.feather;
                let action = obj.data.action;
                let id = obj.data.id;
                let tokens = [];
                let result = false;
                let client = db.getClient(obj.client);

                function callback(isSuper) {
                    if (isSuper) {
                        resolve(true);
                        return;
                    }

                    /* If feather, check class authorization */
                    if (feather) {
                        params = [feather.toSnakeCase(), user];
                        sql = (
                            "SELECT pk FROM \"$auth\" " +
                            "  JOIN \"$feather\" " +
                            "    ON \"$feather\"._pk=\"$auth\".object_pk " +
                            "  JOIN pg_authid " +
                            "   ON \"$auth\".role=pg_authid.rolname " +
                            "WHERE \"$feather\".id=$1" +
                            "  AND pg_has_role($2, pg_authid.oid, 'member')" +
                            "  AND \"$auth\".object_pk=\"$feather\".parent_pk" +
                            "  AND %I;"
                        );
                        sql = sql.format([action.toSnakeCase()]);

                        client.query(sql, params, function (err, resp) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            result = resp.rows.length > 0;
                            resolve(result);
                        });

                        /* Otherwise check object authorization */
                    } else if (id) {
                        /* Find object */
                        sql = "SELECT _pk, tableoid::regclass::text AS \"t\" ";
                        sql += "FROM object WHERE id = $1;";

                        client.query(sql, [id], function (err, resp) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            /* If object found, check authorization */
                            if (resp.rows.length > 0) {
                                table = resp.rows[0].t;
                                pk = resp.rows[0][tools.PKCOL];

                                tokens.push(table);
                                authSql = tools.buildAuthSql(
                                    action,
                                    table,
                                    tokens
                                );
                                sql = (
                                    "SELECT _pk FROM %I WHERE _pk = $2 " +
                                    authSql
                                );
                                sql = sql.format(tokens);

                                client.query(
                                    sql,
                                    [user, pk],
                                    function (err, resp) {
                                        if (err) {
                                            reject(err);
                                            return;
                                        }

                                        result = resp.rows.length > 0;

                                        resolve(result);
                                    }
                                );
                            }
                        });
                    }
                }

                if (!obj.data.feather && !obj.data.id) {
                    throw new Error(
                        "Authorization check requires feather or id"
                    );
                }

                tools.isSuperUser({
                    client: client,
                    user: obj.data.user
                }).then(callback).catch(reject);
            });
        };

        /**
            Set authorazition for a particular authorization role. Must pass
            data `id` or `feather`.

            @example
                // Example payload
                {
                    id: "ExWIx6'",
                    role: "jdoe",
                    actions:
                    {
                        canCreate: false,
                        canRead: true,
                        canUpdate: false,
                        canDelete: false
                    }
                }

            @method saveAuthorization
            @param {Object} payload
            @param {Client} payload.client
            @param {Object} payload.data Payload data
            @param {String} [payload.data.id] Object id (if record level)
            @param {String} [payload.data.feather] Feather
            @param {String} payload.data.role Role
            @param {Boolean} [payload.data.isInternal] Not a feather
            @param {Boolean} [payload.data.isSilentError] Silence errors
            @param {Object} payload.data.actions
            @param {Boolean} [payload.data.actions.canCreate]
            @param {Boolean} [payload.data.actions.canRead]
            @param {Boolean} [payload.data.actions.canUpdate]
            @param {Boolean} [payload.data.actions.canDelete]
            @return {Promise}
        */
        that.saveAuthorization = function (obj) {
            return new Promise(function (resolve, reject) {
                let result;
                let sql;
                let pk;
                let feather;
                let params;
                let objPk;
                let err;
                let afterGetObjKey;
                let afterGetRoleKey;
                let afterGetFeatherName;
                let afterGetFeather;
                let checkSuperUser;
                let afterCheckSuperUser;
                let afterQueryAuth;
                let done;
                let id = (
                    obj.data.feather
                    ? obj.data.feather.toSnakeCase()
                    : obj.data.id
                );
                let actions = obj.data.actions || {};
                let hasAuth = false;
                let client = db.getClient(obj.client);

                afterGetObjKey = function (resp) {
                    objPk = resp;

                    // Validation
                    if (!objPk) {
                        reject("Object \"" + id + "\" not found");
                        return;
                    }

                    client.query(
                        "SELECT _pk FROM \"role\" WHERE name = $1",
                        [obj.data.role]
                    ).then(afterGetRoleKey).catch(reject);
                };

                afterGetRoleKey = function (resp) {
                    // Validation
                    if (!resp.rows.length) {
                        reject("Role \"" + obj.data.role + "\" not found");
                        return;
                    }

                    if (obj.data.isInternal) {
                        afterCheckSuperUser();
                        return;
                    }

                    if (obj.data.id) {
                        sql = (
                            "SELECT tableoid::regclass::text AS feather " +
                            "FROM object WHERE id=$1"
                        );
                        client.query(sql, [id], afterGetFeatherName);
                        return;
                    }

                    afterGetFeatherName(null, {
                        rows: [{
                            feather: obj.data.feather
                        }]
                    });
                };

                afterGetFeatherName = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    feather = resp.rows[0].feather.toCamelCase(true);

                    tools.getFeather({
                        client: client,
                        data: {
                            name: feather,
                            includeInherited: true
                        }
                    }).then(afterGetFeather).catch(reject);
                };

                afterGetFeather = function (resp) {
                    feather = resp;

                    if (tools.isChildFeather(feather)) {
                        err = "Can not set authorization on child feathers.";
                    } else if (!feather.properties.owner) {
                        err = (
                            "Feather '" + resp.name +
                            "' must have owner property to set " +
                            "authorization."
                        );
                    }

                    if (err) {
                        if (obj.data.isSilentError) {
                            done(null, false);
                            return;
                        }
                        reject(err);
                        return;
                    }

                    checkSuperUser();
                };

                checkSuperUser = function () {
                    tools.isSuperUser({
                        client: client
                    }).then(function (isSuper) {
                        if (isSuper) {
                            afterCheckSuperUser();
                            return;
                        }

                        sql = "SELECT owner FROM object WHERE _pk=$1;";

                        client.query(sql, [objPk], function (err, resp) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            if (resp.rows[0].owner !== client.currentUser()) {
                                if (obj.data.isSilentError) {
                                    done(null, false);
                                    return;
                                }
                                err = "Must be super user or owner of \"" + id;
                                err += "\" to set authorization.";
                                reject(err);
                                return;
                            }

                            afterCheckSuperUser();
                        });
                        return;
                    }).catch(reject);
                };

                afterCheckSuperUser = function () {
                    // Determine whether any authorization has been granted
                    hasAuth = !(
                        (
                            actions.canCreate === false &&
                            actions.canRead === false &&
                            actions.canUpdate === false &&
                            actions.canDelete === false
                        ) || (
                            actions.canCreate === null &&
                            actions.canRead === null &&
                            actions.canUpdate === null &&
                            actions.canDelete === null
                        )
                    );

                    // Find an existing authorization record
                    sql = (
                        "SELECT auth.* FROM \"$auth\" AS auth " +
                        "  JOIN object ON object._pk=object_pk " +
                        "WHERE object.id=$1 " +
                        "  AND auth.role=$2;"
                    );

                    client.query(
                        sql,
                        [id, obj.data.role],
                        afterQueryAuth
                    );
                };

                afterQueryAuth = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    result = resp.rows[0] || false;

                    if (result) {
                        pk = result.pk;

                        if (!hasAuth) {
                            sql = "DELETE FROM \"$auth\" WHERE pk=$1";
                            params = [pk];
                        } else {
                            sql = (
                                "UPDATE \"$auth\" SET can_create=$1," +
                                "can_read=$2, can_update=$3, can_delete=$4 " +
                                "WHERE pk=$5"
                            );

                            params = [
                                (
                                    actions.canCreate === undefined
                                    ? result.can_create
                                    : actions.canCreate
                                ),
                                (
                                    actions.canRead === undefined
                                    ? result.can_read
                                    : actions.canRead
                                ),
                                (
                                    actions.canUpdate === undefined
                                    ? result.can_update
                                    : actions.canUpdate
                                ),
                                (
                                    actions.canDelete === undefined
                                    ? result.can_delete
                                    : actions.canDelete
                                ),
                                pk
                            ];
                        }
                    } else if (hasAuth) {
                        sql = (
                            "INSERT INTO \"$auth\" AS a VALUES " +
                            "(nextval('$auth_pk_seq'), " +
                            "$1, $2, $3, $4, $5, $6)"
                        );
                        params = [
                            objPk,
                            obj.data.role,
                            (
                                actions.canCreate === undefined
                                ? null
                                : actions.canCreate
                            ),
                            (
                                actions.canRead === undefined
                                ? null
                                : actions.canRead
                            ),
                            (
                                actions.canUpdate === undefined
                                ? null
                                : actions.canUpdate
                            ),
                            (
                                actions.canDelete === undefined
                                ? null
                                : actions.canDelete
                            )
                        ];
                    } else {
                        done(null, false);
                        return;
                    }

                    client.query(sql, params, done);
                };

                done = function (err, resp) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    resolve(resp !== false);
                };

                // Kick off query by getting object key, the rest falls
                // through callbacks
                tools.getKey({
                    id: id,
                    client: client
                }).then(afterGetObjKey).catch(reject);
            });
        };

        /**
            Create or update a persistence class. This function is idempotent.
            Subsequent saves will automatically drop properties no longer
            present.

            @example
            // example payload:
            {
                "name": "Contact",
                "description": "Contact data about a person",
                "inherits": "Object",
                "properties": {
                    "fullName": {
                        "description": "Full name",
                        "type": "string"
                    },
                    "birthDate": {
                        "description": "Birth date",
                        "type": "string"
                        "format": "date"
                    },
                    "isMarried": {
                        "description": "Marriage status",
                        "type": "boolean"
                    },
                    "dependents": {
                        "description": "Number of dependents",
                        "type": "integer"
                    }
                }
            }

            @method saveFeather
            @param {Object} payload
            @param {Client} payload.client Database client.
            @param {Object | Array} [payload.spec] Feather specification(s).
            @param {String} payload.spec.name Name
            @param {String} [payload.spec.description] Description
            @param {Object | Array | Boolean} [payload.spec.authorizations]
            Authorization spec. Defaults to grant all to everyone if
            undefined.
            @param {String} [payload.spec.properties] Feather properties
            @param {String} [payload.spec.properties.description]
            Description
            @param {String} [spec.properties.default] Default value
            or function name.
            @param {String | Object} payload.spec.properties.type
            Type. Standard types are string, boolean, number, date.
            Object is used for relation specs.
            @param {String} [payload.spec.properties.relation] Feather name of
            relation.
            @param {String} [payload.spec.properties.childOf] Property name
                on parent relation if one to many relation.
            @return {Promise}
        */
        that.saveFeather = function (obj) {
            return new Promise(function (resolve, reject) {
                let spec;
                let parent;
                let specs = (
                    Array.isArray(obj.data.specs)
                    ? obj.data.specs
                    : [obj.data.specs]
                );
                let c = 0;
                let len = specs.length;
                let client = db.getClient(obj.client);

                function nextSpec() {
                    let sqlUpd;
                    let token;
                    let values;
                    let defaultValue;
                    let props;
                    let keys;
                    let recs;
                    let type;
                    let name;
                    let isChild;
                    let pk;
                    let prec;
                    let scale;
                    let feather;
                    let catalog;
                    let autonumber;
                    let afterGetCatalog;
                    let afterUpdateSchema;
                    let updateCatalog;
                    let afterUpdateCatalog;
                    let afterPropagateViews;
                    let afterNextVal;
                    let createIndex;
                    let afterInsertFeather;
                    let afterSaveAuthorization;
                    let createSequence;
                    let table;
                    let inherits;
                    let dropSql;
                    let changed = false;
                    let sql = "";
                    let tokens = [];
                    let adds = [];
                    let args = [];
                    let fns = [];
                    let cols = [];
                    let unique = [];
                    let indices = [];
                    let i = 0;
                    let n = 0;
                    let p = 1;
                    let err;

                    function createDropSql(name) {
                        let statements;
                        let buildDeps;
                        let feathers = [];

                        buildDeps = function (name) {
                            let dkeys = Object.keys(catalog);

                            feathers.push(name);
                            dkeys.forEach(function (key) {
                                if (
                                    key !== name &&
                                    catalog[key].inherits === name
                                ) {
                                    buildDeps(key);
                                }
                            });
                        };

                        buildDeps(name);

                        statements = feathers.map(function (feather) {
                            let stmt = "DROP VIEW IF EXISTS %I CASCADE";
                            return stmt.format(["_" + feather.toSnakeCase()]);
                        });

                        return statements.join(";") + ";";
                    }

                    function afterGetFeather(resp) {
                        feather = resp;

                        settings.getSettings({
                            client: client,
                            data: {
                                name: "catalog"
                            }
                        }).then(afterGetCatalog).catch(reject);
                    }

                    function handleProps(key) {
                        let vSql;
                        let prop = props[key];
                        let fProp;
                        let pProps;
                        let tProps;
                        let tRel;
                        let descr;

                        if (feather && feather.properties) {
                            fProp = feather.properties[key];
                        }

                        function createRelationView() {
                            tProps = type.properties;
                            cols = ["%I"];
                            name = "_" + table + "$";
                            name += key.toSnakeCase();
                            args = [name, "_pk"];

                            /* Always include "id" whether
                               specified or not */
                            if (tProps.indexOf("id") === -1) {
                                tProps.unshift("id");
                            }

                            i = 0;
                            while (i < tProps.length) {
                                cols.push("%I");
                                args.push(tProps[i].toSnakeCase());
                                i += 1;
                            }

                            tRel = "_";
                            tRel += type.relation.toSnakeCase();
                            args.push(tRel);
                            vSql = "CREATE VIEW %I AS SELECT ";
                            vSql += cols.join(",");
                            vSql += " FROM %I ";
                            vSql += "WHERE NOT is_deleted;";
                            sql += vSql.format(args);
                        }

                        type = (
                            typeof prop.type === "string"
                            ? tools.types[prop.type]
                            : prop.type
                        );

                        if (type && key !== spec.discriminator) {
                            if (!feather || !fProp) {

                                /* Drop views */
                                if (feather && !changed) {
                                    sql += dropSql;
                                }

                                changed = true;
                                sql += "ALTER TABLE %I ADD COLUMN %I ";

                                /* Handle composite types */
                                if (typeof prop.type === "object") {
                                    if (type.relation) {
                                        sql += "integer;";
                                        token = tools.relationColumn(
                                            key,
                                            type.relation
                                        );

                                        /* Update parent class for to-many
                                           children */
                                        if (type.childOf) {
                                            parent = catalog[type.relation];
                                            pProps = parent.properties;
                                            if (!pProps[type.childOf]) {
                                                descr = "Parent of \"" + key;
                                                descr += "\" on \"";
                                                descr += spec.name + "\"";

                                                pProps[type.childOf] = {
                                                    description: descr,
                                                    type: {
                                                        relation: spec.name,
                                                        parentOf: key
                                                    }
                                                };

                                            } else {
                                                err = "Property \"";
                                                err += type.childOf;
                                                err += "\" already exists on";
                                                err += "\"" + type.relation;
                                                err += "\"";
                                            }
                                        } else if (type.parentOf) {
                                            err = "Can not set parent ";
                                            err += "directly for \"";
                                            err += key + "\"";
                                        } else if (
                                            !type.properties ||
                                            !type.properties.length
                                        ) {
                                            err = "Properties must be defined";
                                            err += "for relation \"" + key;
                                            err += "\"";
                                        /* Must be to-one relation.
                                           If relation feather is flagged
                                           as child, flag property as
                                           child on this feather. */
                                        } else {
                                            parent = catalog[type.relation];
                                            if (parent.isChild) {
                                                prop.type.isChild = true;
                                            }
                                        }
                                    } else {
                                        err = "Relation not defined for ";
                                        err += "composite type \"" + key;
                                        err += "\"";
                                    }

                                    if (err) {
                                        return false;
                                    }

                                    if (
                                        typeof prop.type === "object" &&
                                        !prop.type.childOf
                                    ) {
                                        createRelationView();
                                    }

                                    /* Handle standard types */
                                } else {
                                    if (prop.format) {
                                        if (formats[prop.format]) {
                                            sql += formats[prop.format].type;
                                        } else if (formats[prop.type]) {
                                            sql += formats[prop.type].type;
                                        } else {
                                            err = "Invalid format \"";
                                            err += prop.format;
                                            err += "\" for property \"";
                                            err += key + "\" on class \"";
                                            err += spec.name + "\"";
                                            return false;
                                        }
                                    } else {
                                        sql += type.type;
                                        if (type.type === "numeric") {
                                            if (
                                                prop.precision !== undefined &&
                                                !Number.isNaN(prop.precision) &&
                                                prop.precision !== -1
                                            ) {
                                                prec = prop.precision;
                                            } else {
                                                prec = f.PRECISION_DEFAULT;
                                            }

                                            if (
                                                prop.scale !== undefined &&
                                                !Number.isNaN(prop.scale) &&
                                                prop.scale !== -1
                                            ) {
                                                scale = prop.scale;
                                            } else {
                                                scale = f.SCALE_DEFAULT;
                                            }

                                            sql += "(" + prec + "," + scale;
                                            sql += ")";
                                        }
                                    }
                                    sql += ";";
                                    token = key.toSnakeCase();
                                }

                                adds.push(key);
                                tokens = tokens.concat([table, token]);

                                if (prop.isNaturalKey) {
                                    unique.push(key);
                                }

                                if (prop.isIndexed) {
                                    indices.push(key);
                                }

                                if (prop.description) {
                                    sql += "COMMENT ON COLUMN %I.%I IS %L;";

                                    tokens = tokens.concat([
                                        table,
                                        token,
                                        prop.description || ""
                                    ]);
                                }
                                // Always regenerate relation views in case
                                // properties changed
                            } else if (
                                fProp &&
                                typeof fProp.type === "object" &&
                                !fProp.childOf &&
                                !fProp.parentOf &&
                                typeof type === "object" &&
                                !type.childOf &&
                                !type.parentOf
                            ) {
                                createRelationView();
                            }
                        } else {
                            err = "Invalid type \"" + prop.type;
                            err += "\" for property \"";
                            err += key + "\" on class \"" + spec.name + "\"";

                            return false;
                        }

                        return true;
                    }

                    afterGetCatalog = function (resp) {
                        catalog = resp;

                        dropSql = createDropSql(spec.name);

                        /* Create table if applicable */
                        if (!feather) {
                            sql = "CREATE TABLE %I( ";
                            sql += "CONSTRAINT %I PRIMARY KEY (_pk), ";
                            sql += "CONSTRAINT %I UNIQUE (id)) ";
                            sql += "INHERITS (%I);";
                            sql += "CREATE TRIGGER %I AFTER INSERT ON %I ";
                            sql += "FOR EACH ROW EXECUTE PROCEDURE ";
                            sql += "insert_trigger();";
                            sql += "CREATE TRIGGER %I AFTER UPDATE ON %I ";
                            sql += "FOR EACH ROW EXECUTE PROCEDURE ";
                            sql += "update_trigger();";

                            tokens = tokens.concat([
                                table,
                                table + "_pkey",
                                table + "_id_key",
                                inherits,
                                table + "_insert_trigger",
                                table,
                                table + "_update_trigger",
                                table
                            ]);

                        } else {
                            /* Drop non-inherited columns not included
                               in properties */
                            props = feather.properties;
                            keys = Object.keys(props);
                            keys.forEach(function (key) {
                                let viewName;
                                if (
                                    spec.properties && !spec.properties[key] &&
                                    !(
                                        typeof props[key].type === "object" &&
                                        Boolean(props[key].type.parentOf)
                                    )
                                ) {
                                    /* Drop views */
                                    if (!changed) {
                                        sql += dropSql;
                                        changed = true;
                                    }

                                    /* Handle relations */
                                    type = props[key].type;

                                    if (
                                        typeof type === "object" &&
                                        type.properties
                                    ) {
                                        // Drop associated view if applicable
                                        sql += "DROP VIEW IF EXISTS %I;";
                                        viewName = "_" + table;
                                        viewName += "$" + key.toSnakeCase();
                                        tokens = tokens.concat([
                                            viewName,
                                            table,
                                            tools.relationColumn(
                                                key,
                                                type.relation
                                            )
                                        ]);
                                    } else {
                                        tokens = tokens.concat([
                                            table,
                                            key.toSnakeCase()
                                        ]);
                                    }

                                    sql += "ALTER TABLE %I DROP COLUMN %I;";

                                    // Unrelate parent if applicable
                                    if (type.childOf) {
                                        parent = catalog[type.relation];
                                        delete parent.properties[type.childOf];
                                    }
                                    // Always drop/recreate relation views in
                                    // case properties changed
                                } else if (
                                    typeof props[key].type === "object" &&
                                    !Boolean(props[key].type.parentOf) &&
                                    !Boolean(props[key].type.childOf)
                                ) {
                                    if (!changed) {
                                        sql += dropSql;
                                        changed = true;
                                    }

                                    sql += "DROP VIEW IF EXISTS %I;";
                                    viewName = (
                                        "_" + table +
                                        "$" + key.toSnakeCase()
                                    );
                                    tokens.push(viewName);

                                    // Parent properties need to be added back
                                    // into spec so not lost
                                } else if (
                                    spec.properties &&
                                    !spec.properties[key] && (
                                        typeof props[key].type === "object" &&
                                        props[key].type.parentOf
                                    )
                                ) {
                                    spec.properties[key] = props[key];
                                }
                            });
                        }

                        // Add table description
                        if (spec.description) {
                            sql += "COMMENT ON TABLE %I IS %L;";
                            tokens = tokens.concat([
                                table,
                                spec.description || ""
                            ]);
                        }

                        /* Add columns */
                        spec.properties = spec.properties || {};
                        props = spec.properties;
                        keys = Object.keys(props).filter(function (item) {
                            let prop = props[item];
                            if (prop.autonumber) {
                                autonumber = prop.autonumber;
                                autonumber.key = item;
                            }

                            return !prop.inheritedFrom;
                        });
                        keys.every(handleProps);

                        if (err) {
                            reject(err);
                            return;
                        }

                        /* Update schema */
                        sql = sql.format(tokens);
                        client.query(sql, createSequence);
                    };

                    createSequence = function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        if (!autonumber) {
                            afterUpdateSchema();
                            return;
                        }
                        let sequence = autonumber.sequence;
                        sql = "SELECT relname FROM pg_class ";
                        sql += "JOIN pg_namespace ";
                        sql += "ON relnamespace=pg_namespace.oid ";
                        sql += "WHERE relkind = 'S' AND relname = $1 ";
                        sql += "AND nspname = 'public'";

                        client.query(sql, [sequence], function (err, resp) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            if (!resp.rows.length) {
                                sql = "CREATE SEQUENCE %I;";
                                sql = sql.format([sequence]);
                                client.query(sql, function (err) {
                                    if (err) {
                                        reject(err);
                                        return;
                                    }

                                    afterUpdateSchema();
                                });
                                return;
                            }

                            afterUpdateSchema();
                        });
                    };

                    afterUpdateSchema = function (err) {
                        let afterPopulateDefaults;
                        let iterateDefaults;

                        function disableTriggers() {
                            return new Promise(function (resolve, reject) {
                                sql = "ALTER TABLE %I DISABLE TRIGGER ALL;";
                                sql = sql.format([table]);
                                client.query(sql).then(
                                    resolve
                                ).catch(
                                    reject
                                );
                            });
                        }

                        function updateTable() {
                            return new Promise(function (resolve, reject) {
                                sql = "UPDATE %I SET " + tokens.join(",");
                                sql += ";";
                                sql = sql.format(args);
                                client.query(sql, values).then(
                                    resolve
                                ).catch(
                                    reject
                                );
                            });
                        }

                        function enableTriggers() {
                            return new Promise(function (resolve, reject) {
                                sql = "ALTER TABLE %I ENABLE TRIGGER ALL;";
                                sql = sql.format([table]);
                                client.query(sql).then(
                                    resolve
                                ).catch(
                                    reject
                                );
                            });
                        }

                        if (err) {
                            reject(err);
                            return;
                        }

                        afterPopulateDefaults = function () {
                            let atoken;

                            // Update function based defaults (one by one)
                            if (fns.length || autonumber) {
                                tokens = [];
                                args = [table];
                                i = 0;

                                fns.forEach(function (fn) {
                                    tokens.push("%I=$" + (i + 2));
                                    args.push(fn.col);
                                    i += 1;
                                });

                                if (autonumber) {
                                    atoken = "%I='";
                                    atoken += (autonumber.prefix || "");
                                    atoken += "' || lpad(nextval('";
                                    atoken += autonumber.sequence;
                                    atoken += "')::text, ";
                                    atoken += (autonumber.length || 0);
                                    atoken += ", '0') || '";
                                    atoken += (autonumber.suffix || "") + "'";
                                    tokens.push(atoken);
                                    args.push(autonumber.key);
                                }

                                sql = "SELECT _pk FROM %I ORDER BY _pk ";
                                sql += "OFFSET $1 LIMIT 1;";
                                sql = sql.format([table]);
                                sqlUpd = "UPDATE %I SET " + tokens.join(",");
                                sqlUpd += " WHERE _pk = $1";
                                sqlUpd = sqlUpd.format(args);
                                client.query(sql, [n], iterateDefaults);
                                return;
                            }

                            createIndex();
                        };

                        iterateDefaults = function (err, resp) {
                            if (err) {
                                reject(err);
                                return;
                            }

                            recs = resp.rows;

                            if (recs.length) {
                                values = [recs[0][tools.PKCOL]];
                                i = 0;
                                n += 1;

                                while (i < fns.length) {
                                    values.push(f[fns[i].default]());
                                    i += 1;
                                }

                                client.query(
                                    sqlUpd,
                                    values,
                                    function (err) {
                                        if (err) {
                                            reject(err);
                                            return;
                                        }

                                        // Look for next record
                                        client.query(
                                            sql,
                                            [n],
                                            iterateDefaults
                                        );
                                    }
                                );
                                return;
                            }

                            createIndex();
                        };

                        // Populate defaults
                        if (adds.length) {
                            values = [];
                            tokens = [];
                            args = [table];

                            adds.forEach(function (add) {
                                let pformat = props[add].format;

                                type = props[add].type;

                                if (typeof type === "object") {
                                    defaultValue = -1;
                                } else {
                                    defaultValue = props[add].default;
                                    if (defaultValue === undefined) {
                                        defaultValue = (
                                            (pformat && formats[pformat])
                                            ? formats[pformat].default
                                            : false
                                        ) || tools.types[type].default;
                                    }
                                }

                                if (
                                    typeof defaultValue === "string" &&
                                    defaultValue.match(/\(\)$/)
                                ) {
                                    fns.push({
                                        col: add.toSnakeCase(),
                                        default: defaultValue.replace(
                                            /\(\)$/,
                                            ""
                                        )
                                    });
                                } else {
                                    values.push(defaultValue);
                                    tokens.push("%I=$" + p);
                                    if (typeof type === "object") {
                                        args.push(
                                            tools.relationColumn(
                                                add,
                                                type.relation
                                            )
                                        );
                                    } else {
                                        args.push(add.toSnakeCase());
                                    }
                                    p += 1;
                                }
                            });

                            if (values.length) {
                                Promise.resolve().then(
                                    disableTriggers
                                ).then(
                                    updateTable
                                ).then(
                                    enableTriggers
                                ).then(
                                    afterPopulateDefaults
                                ).catch(
                                    reject
                                );

                                return;
                            }

                            afterPopulateDefaults();
                            return;
                        }

                        createIndex();
                    };

                    createIndex = function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        if (unique.length || indices.length) {
                            sql = "";
                            tokens = [];

                            unique.forEach(function (key) {
                                sql += "CREATE INDEX %I ON %I (%I);";
                                tokens = tokens.concat([
                                    table + "_index_" + key.toSnakeCase(),
                                    table,
                                    key.toSnakeCase()
                                ]);
                            });

                            indices.forEach(function (key) {
                                sql += "CREATE INDEX %I ON %I (%I);";
                                tokens = tokens.concat([
                                    table + "_index_" + key.toSnakeCase(),
                                    table,
                                    key.toSnakeCase()
                                ]);
                            });

                            client.query(
                                sql.format(tokens),
                                updateCatalog
                            );
                            return;
                        }
                        updateCatalog();
                    };

                    updateCatalog = function (err) {
                        let fprops;
                        let sprops;

                        function handleFP(attr) {
                            let pr = this;
                            let st = sprops[pr].type;
                            let ft = fprops[pr].type;

                            if (attr === "type") {
                                if (
                                    typeof sprops[pr].type === "object" &&
                                    st.relation === ft.relation &&
                                    ft.isChild
                                ) {
                                    st.isChild = true;
                                }
                            }
                        }

                        function handleSP(p) {
                            if (fprops[p]) {
                                Object.keys(
                                    fprops[p]
                                ).forEach(
                                    handleFP.bind(p)
                                );
                            }
                        }

                        if (err) {
                            reject(err);
                            return;
                        }

                        /* Make sure certain values added automatically
                           persist */
                        if (feather) {
                            fprops = feather.properties;
                            sprops = spec.properties;

                            Object.keys(sprops).forEach(handleSP);
                        }

                        /* Update catalog settings */
                        name = spec.name;
                        catalog[name] = spec;
                        delete spec.name;

                        if (
                            typeof spec.authorization === "object" &&
                            !Array.isArray(spec.authorization)
                        ) {
                            spec.authorization = [spec.authorization];
                        }

                        spec.isChild = (
                            spec.isChild || tools.isChildFeather(spec)
                        );

                        settings.saveSettings({
                            client: client,
                            data: {
                                name: "catalog",
                                data: catalog
                            }
                        }).then(afterUpdateCatalog).catch(reject);
                    };

                    afterUpdateCatalog = function () {
                        let callback;

                        callback = function (resp) {
                            isChild = tools.isChildFeather(resp);
                            sql = "SELECT nextval('object__pk_seq') AS pk;";
                            client.query(sql, afterNextVal);
                        };

                        if (!feather) {
                            tools.getFeather({
                                client: client,
                                callback: callback,
                                data: {
                                    name: name
                                }
                            }).then(callback).catch(reject);
                            return;
                        }

                        isChild = tools.isChildFeather(feather);
                        afterInsertFeather();
                    };

                    afterNextVal = function (err, resp) {
                        let callback;

                        if (err) {
                            reject(err);
                            return;
                        }

                        pk = resp.rows[0].pk;

                        callback = function (err, resp) {
                            let key;

                            if (err) {
                                reject(err);
                                return;
                            }

                            key = resp;

                            sql = "INSERT INTO \"$feather\" ";
                            sql += "(_pk, id, created, created_by, updated, ";
                            sql += "updated_by, is_deleted, is_child, ";
                            sql += "parent_pk) VALUES ";
                            sql += "($1, $2, now(), $3, now(), $4, false, ";
                            sql += "$5, $6);";
                            values = [
                                pk,
                                table,
                                client.currentUser(),
                                client.currentUser(),
                                isChild,
                                key
                            ];
                            client.query(sql, values, afterInsertFeather);
                        };

                        if (isChild) {
                            getParentKey({
                                parent: parent,
                                child: name,
                                client: client
                            }).then(callback).catch(reject);
                            return;
                        }

                        callback(null, pk);
                    };

                    afterInsertFeather = function (err) {
                        if (err) {
                            reject(err);
                            return;
                        }

                        /* Propagate views */
                        changed = changed || !feather;
                        if (changed) {
                            propagateViews({
                                name: name,
                                client: client,
                                callback: afterPropagateViews
                            });
                            return;
                        }

                        afterPropagateViews();
                    };

                    afterPropagateViews = function (err) {
                        let requests = [];

                        if (err) {
                            reject(err);
                            return;
                        }

                        /* If no specific authoriztion this won't work */
                        if (
                            !isChild && !spec.isChild && (
                                spec.authorizations === undefined ||
                                spec.authorizations === null
                            )
                        ) {
                            throw new Error(
                                "Feather must specify authorization."
                            );
                        }

                        /* Set authorization */
                        if (
                            Array.isArray(spec.authorizations) &&
                            spec.authorizations.length
                        ) {
                            spec.authorizations.forEach(function (auth) {
                                auth.feather = name;
                                auth.isSilentError = true;
                                requests.push(that.saveAuthorization({
                                    client: client,
                                    data: auth
                                }));
                            });

                            Promise.all(requests).then(
                                afterSaveAuthorization
                            ).catch(reject);
                            return;
                        }

                        afterSaveAuthorization();
                    };

                    afterSaveAuthorization = function () {
                        if (c < len) {
                            nextSpec();
                            return;
                        }

                        resolve(true);
                    };

                    // Real work starts here
                    spec = specs[c];
                    c += 1;
                    table = (
                        spec.name
                        ? spec.name.toSnakeCase()
                        : false
                    );
                    inherits = (spec.inherits || "Object");
                    inherits = inherits.toSnakeCase();

                    if (!table) {
                        reject("No name defined");
                        return;
                    }

                    if (reserved.indexOf(
                        table.toSnakeCase().toUpperCase()
                    ) !== -1) {
                        reject(
                            "Cannot create feather \"" + table +
                            "\" because it is a reserved word."
                        );
                        return;
                    }

                    tools.getFeather({
                        client: client,
                        data: {
                            name: spec.name,
                            includeInherited: false
                        }
                    }).then(afterGetFeather).catch(reject);
                }

                // Real work starts here
                nextSpec();
            });
        };

        return that;
    };

}(exports));