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
    Import and export
    @module IO
*/
(function (exports) {
    "use strict";

    const {CRUD} = require("./crud");
    const {Tools} = require("./tools");
    const f = require("../../common/core");
    const XLSX = require("xlsx");
    const fs = require("fs");
    const crud = new CRUD();
    const tools = new Tools();

    function getFeather(client, name, localFeathers) {
        return new Promise(function (resolve, reject) {
            function getChildFeathers(resp) {
                let frequests = [];
                let props = resp.properties;

                try {
                    localFeathers[name] = resp;

                    // Recursively get feathers for all children
                    Object.keys(props).forEach(function (key) {
                        let type = props[key].type;

                        if (
                            typeof type === "object" && (
                                type.parentOf || type.isChild
                            )
                        ) {
                            frequests.push(
                                getFeather(
                                    client,
                                    type.relation,
                                    localFeathers
                                )
                            );
                        }
                    });
                } catch (e) {
                    reject(e);
                    return;
                }

                Promise.all(
                    frequests
                ).then(resolve).catch(reject);
            }

            tools.getFeather({
                client,
                data: {
                    name: name
                }
            }).then(getChildFeathers).catch(reject);
        });
    }

    function commit(client) {
        return new Promise(function (resolve) {
            client.query("COMMIT;").then(resolve);
        });
    }

    function rollback(client) {
        return new Promise(function (resolve) {
            client.query("ROLLBACK;").then(resolve);
        });
    }

    /**
        @class Exporter
        @constructor
        @namespace Services
    */
    exports.Exporter = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        function tidy(obj) {
            delete obj.objectType;
            delete obj.isDeleted;
            delete obj.lock;

            Object.keys(obj).forEach(function (key) {
                if (Array.isArray(obj[key])) {
                    obj[key].forEach(function (row) {
                        delete row.id;
                        tidy(row);
                    });
                }
            });
        }

        function doExport(
            client,
            feather,
            properties,
            filter,
            dir,
            format,
            writeFile
        ) {
            return new Promise(function (resolve, reject) {
                let id = f.createId();
                let filename = dir + id + "." + format;
                let payload = {
                    client: client,
                    name: feather,
                    filter: filter,
                    properties: properties
                };

                if (properties && properties.indexOf("objectType") === -1) {
                    properties.push("objectType");
                }

                function callback(resp) {
                    writeFile(filename, resp, format, client, feather).then(
                        () => resolve(filename)
                    );
                }

                crud.doSelect(
                    payload,
                    false,
                    true
                ).then(callback).catch(reject);
            });
        }

        function writeWorkbook(filename, data, format, client, feather) {
            return new Promise(function (resolve, reject) {
                let wb = XLSX.utils.book_new();
                let sheets = {};
                let localFeathers = {};
                let keys;
                let key;
                let ws;

                function toSheets(d, rename, feather) {
                    let type;
                    let tmp;
                    let c = 0;

                    function doRename(data, key) {
                        if (
                            key === "objectType" ||
                            key === "isDeleted" ||
                            key === "lock"
                        ) {
                            tmp[key] = data[key];
                        } else {
                            tmp[key.toName()] = data[key];
                        }
                    }

                    if (d.length) {
                        d.forEach(function (row) {
                            let pkey = feather + " Id";
                            let pval = row.id;
                            let rel;
                            let prop;
                            let cfeather;

                            Object.keys(row).forEach(function (key) {
                                let n;

                                cfeather = localFeathers[feather];
                                prop = cfeather.properties[
                                    key.replace(" ", "").toCamelCase()
                                ];

                                if (
                                    prop &&
                                    typeof prop.type === "object" &&
                                    prop.type.parentOf
                                ) {
                                    // Add parent key in
                                    rel = prop.type.relation.toCamelCase(true);
                                    n = 0;
                                    row[key] = row[key] || [];
                                    row[key].forEach(function (r) {
                                        tmp = {};
                                        tmp[pkey] = pval;
                                        Object.keys(r).forEach(
                                            doRename.bind(null, r)
                                        );
                                        row[key][n] = tmp;
                                        n += 1;
                                    });
                                    toSheets(row[key], false, rel);
                                    delete row[key];
                                } else if (
                                    prop && (
                                        typeof prop.type === "object" ||
                                        prop.type === "object"
                                    )
                                ) {
                                    if (prop.type.isChild) {
                                        rel = prop.type.relation.toCamelCase(
                                            true
                                        );

                                        if (
                                            row[key] !== null &&
                                            row[key] !== undefined
                                        ) {
                                            tmp = {};
                                            tmp.objectType = rel;
                                            Object.keys(row[key]).forEach(
                                                doRename.bind(null, row[key])
                                            );
                                            toSheets([tmp], false, rel);
                                            row[key] = row[key].id;
                                        }
                                    } else if (prop.format === "money") {
                                        if (row[key].effective) {
                                            row[key] = (
                                                row[key].amount + " " +
                                                row[key].currency + " " +
                                                row[key].effective + " " +
                                                row[key].baseAmount
                                            );
                                        } else {
                                            row[key] = (
                                                row[key].amount + " " +
                                                row[key].currency
                                            );
                                        }
                                    } else if (row[key] && row[key].id) {
                                        row[key] = row[key].id;
                                    }
                                }
                            });

                            if (rename !== false) {
                                tmp = {};
                                Object.keys(row).forEach(
                                    doRename.bind(null, row)
                                );
                                d[c] = tmp;
                                c += 1;
                            }
                        });

                        type = d[0].objectType;
                        if (!sheets[type]) {
                            sheets[type] = d;
                        } else {
                            sheets[type] = sheets[type].concat(d);
                        }
                    }
                }

                function callback() {
                    toSheets(data, true, feather);

                    // Add worksheets in reverse order
                    keys = Object.keys(sheets);
                    while (keys.length) {
                        key = keys.pop();
                        sheets[key].forEach(tidy);
                        ws = XLSX.utils.json_to_sheet(sheets[key]);
                        XLSX.utils.book_append_sheet(wb, ws, key);
                    }

                    XLSX.writeFile(wb, filename, {bookType: format});
                    resolve();
                }

                getFeather(
                    client,
                    feather,
                    localFeathers
                ).then(callback).catch(reject);
            });
        }

        /**
            Export as json.

            @method json
            @param {Object} client Database client
            @param {String} feather Feather name
            @param {Array} properties
            @param {Object} filter
            @param {String} dir Target file directory
            @return {Promise} Resolves filename of exported data
        */
        that.json = function (client, feather, properties, filter, dir) {
            return new Promise(function (resolve, reject) {
                function writeFile(filename, data) {
                    return new Promise(function (resolve) {
                        data.forEach(tidy);

                        fs.appendFile(
                            filename,
                            JSON.stringify(data, null, 4),
                            function (err) {
                                if (err) {
                                    reject(err);
                                    return;
                                }

                                resolve();
                            }
                        );
                    });
                }

                doExport(
                    client,
                    feather,
                    properties,
                    filter,
                    dir,
                    "json",
                    writeFile
                ).then(resolve).catch(reject);
            });
        };

        /**
            Export as Open Document spreadsheet.

            @method ods
            @param {Object} Database client
            @param {String} Feather name
            @param {Array} Properties
            @param {Object} Filter
            @param {String} Target file directory
            @return {String} Filename
        */
        that.ods = function (client, feather, properties, filter, dir) {
            return new Promise(function (resolve, reject) {
                doExport(
                    client,
                    feather,
                    properties,
                    filter,
                    dir,
                    "ods",
                    writeWorkbook
                ).then(resolve).catch(reject);
            });
        };

        /**
            Export as Excel spreadsheet.

            @method xlsx
            @param {Object} Database client
            @param {String} Feather name
            @param {Array} Properties
            @param {Object} Filter
            @param {String} Target file directory
            @return {String} Filename
        */
        that.xlsx = function (client, feather, properties, filter, dir) {
            return new Promise(function (resolve, reject) {
                doExport(
                    client,
                    feather,
                    properties,
                    filter,
                    dir,
                    "xlsx",
                    writeWorkbook
                ).then(resolve).catch(reject);
            });
        };

        return that;
    };

    /**
        @class Importer
        @constructor
        @namespace Services
    */
    exports.Importer = function () {
        // ..........................................................
        // PUBLIC
        //

        let that = {};

        /**
            Import JSON file.

            @method json
            @param {Object} Datasource
            @param {Object} Database client
            @param {String} Feather name
            @param {String} Source file
            @return {Array} Error log
        */
        that.json = function (datasource, client, feather, filename) {
            return new Promise(function (resolve, reject) {
                let requests = [];
                let log = [];

                function error(err) {
                    log.push({
                        feather: this.name,
                        id: this.id,
                        error: err
                    });
                }

                function writeLog() {
                    let logname;

                    if (log.length) {
                        logname = "./files/downloads/" + f.createId() + ".json";
                        fs.appendFile(
                            logname,
                            JSON.stringify(log, null, 4),
                            function (err) {
                                if (err) {
                                    reject(err);
                                    return;
                                }

                                fs.unlink(filename, function () {
                                    resolve(logname);
                                });
                            }
                        );
                        return;
                    }

                    fs.unlink(filename, resolve);
                }

                function callback(err, data) {
                    if (err) {
                        console.error(err);
                        fs.unlink(filename, reject.bind(null, err));
                        return;
                    }

                    try {
                        data = JSON.parse(data);

                        data.forEach(function (item) {
                            let payload = {
                                method: "POST",
                                client: client,
                                name: feather,
                                id: item.id,
                                data: item
                            };

                            requests.push(
                                datasource.request(payload).catch(
                                    error.bind(payload)
                                )
                            );
                        });
                    } catch (e) {
                        fs.unlink(filename, reject.bind(null, e));
                        return;
                    }

                    Promise.all(requests).then(
                        commit.bind(null, client)
                    ).then(writeLog).catch(function (err) {
                        rollback().then(function () {
                            fs.unlink(filename, reject.bind(null, err));
                        });
                    });
                }

                fs.readFile(filename, "utf8", callback);
            });
        };

        /**
            Import Excel file.

            @method xlsx
            @param {Object} Datasource
            @param {Object} Database client
            @param {String} Feather name
            @param {String} Source file
            @return {Array} Error log
        */
        that.xlsx = function (datasource, client, feather, filename) {
            return new Promise(function (resolve, reject) {
                let requests = [];
                let log = [];
                let wb = XLSX.readFile(filename);
                let sheets = {};
                let localFeathers = {};

                wb.SheetNames.forEach(function (name) {
                    sheets[name] = XLSX.utils.sheet_to_json(
                        wb.Sheets[name]
                    );
                });

                function error(err) {
                    log.push({
                        feather: this.name,
                        id: this.id,
                        error: {
                            message: err.message,
                            statusCode: err.statusCode
                        }
                    });
                }

                function buildRow(feather, row) {
                    let ret = {};
                    let props = localFeathers[feather].properties;
                    let ary;
                    let id = row.Id;

                    if (!id) {
                        throw new Error(
                            "Id is required for \"" + feather + "\""
                        );
                    }

                    try {
                        Object.keys(props).forEach(function (key) {
                            let value = row[key.toName()];
                            let pkey = feather.toName() + " Id";
                            let rel;
                            let attrs;

                            if (typeof props[key].type === "object") {
                                // Handle child array
                                if (
                                    props[key].type.parentOf &&
                                    sheets[props[key].type.relation]
                                ) {
                                    rel = props[key].type.relation;
                                    ary = sheets[rel].filter(
                                        (r) => r[pkey] === id
                                    );
                                    ret[key] = ary.map(
                                        buildRow.bind(null, rel)
                                    );

                                // Handle child object
                                } else if (props[key].type.isChild) {
                                    if (sheets[rel]) {
                                        rel = props[key].type.relation;
                                        ret[key] = sheets[rel].find(
                                            (r) => r.Id === row[key.toName()]
                                        );
                                        ret[key] = buildRow(rel, ret[key]);
                                    }

                                // Regular relation
                                } else if (value) {
                                    ret[key] = {id: value};
                                }
                            } else if (props[key].format === "money") {
                                attrs = value.split(" ");
                                ret[key] = {
                                    amount: Number(attrs[0]),
                                    currency: attrs[1],
                                    effective: attrs[2],
                                    baseAmount: Number(attrs[3])
                                };
                            } else if (value !== undefined) {
                                ret[key] = value;
                            }
                        });
                    } catch (e) {
                        reject(e);
                        return;
                    }

                    return ret;
                }

                function doRequest(row) {
                    let payload = {
                        client: client,
                        method: "POST",
                        name: feather,
                        id: row.Id,
                        data: buildRow(feather, row)
                    };

                    requests.push(
                        datasource.request(payload).catch(
                            error.bind(payload)
                        )
                    );
                }

                function writeLog() {
                    let logname;

                    if (log.length) {
                        logname = "./files/downloads/" + f.createId() + ".json";
                        fs.appendFile(
                            logname,
                            JSON.stringify(log, null, 4),
                            function (err) {
                                if (err) {
                                    reject(err);
                                    return;
                                }

                                fs.unlink(filename, function () {
                                    resolve(logname);
                                });
                            }
                        );
                        return;
                    }

                    fs.unlink(filename, resolve);
                }

                function callback() {
                    sheets[feather].forEach(doRequest);

                    Promise.all(requests).then(
                        commit.bind(null, client)
                    ).then(writeLog).catch(reject);
                }

                getFeather(
                    client,
                    feather,
                    localFeathers
                ).then(callback).catch(function (err) {
                    rollback().then(function () {
                        fs.unlink.bind(filename, function () {
                            reject(err);
                        });
                    });
                });
            });
        };

        /**
            Import Open Document Spreadsheet file.

            @method ods
            @param {Object} Datasource
            @param {Object} Database client
            @param {String} Feather name
            @param {String} Source file
            @return {Array} Error log
        */
        that.ods = that.xlsx;

        return that;
    };

}(exports));

