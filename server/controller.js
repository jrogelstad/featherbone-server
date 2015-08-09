/**
    Featherbone is a JavaScript based persistence framework for building object
    relational database applications
    
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

/*global plv8 */
(function (exports) {

  require("../common/extend-string");

  var that, createView, curry, getKey, getKeys, isChildModel,
    propagateViews, propagateAuth, currentUser, setCurrentUser, buildAuthSql,
    relationColumn, sanitize, doInsert, doSelect, doUpdate, doDelete,
    f = require("../common/core"),
    jsonpatch = require("fast-json-patch"),
    format = require("pg-format"),
    settings = {},
    types = {
      object: {type: "json", default: {}},
      array: {type: "json", default: []},
      string: {type: "text", default: "''"},
      integer: {type: "integer", default: 0},
      number: {type: "numeric", default: 0},
      date: {type: "date", default: "minDate()"},
      boolean: {type: "boolean", default: "false"}
    },
    formats = {
      integer: {type: "integer", default: 0},
      long: {type: "bigint", default: 0},
      float: {type: "real", default: 0},
      double: {type: "double precision", default: 0},
      string: {type: "text", default: "''"},
      boolean: {type: "boolean", default: "false"},
      date: {type: "date", default: "minDate()"},
      dateTime: {type: "timestamp with time zone", default: "minDate()"},
      password: {type: "text", default: ""}
    },
    PRECISION_DEFAULT = 18,
    SCALE_DEFAULT = 6;

  /**
    * Escape strings to prevent sql injection
      http://www.postgresql.org/docs/9.1/interactive/functions-string.html
    *
    * @param {String} A string with tokens to replace.
    * @param {Array} Array of replacement strings.
    * @return {String} Escaped string.
  */
  String.prototype.format = function (ary) {
    var params = [],
      i = 0;

    ary = ary || [];
    ary.unshift(this);

    while (ary[i]) {
      i++;
      params.push("$" + i);
    }

    return curry(format, ary)();
  };

  that = {

    /**
      Check to see if an etag is current.

      * @param {Object} Payload
      * @param {String} [payload.id] Object id
      * @param {String} [payload.etag] Object etag
      * @param {Object} [payload.client] Database client
      * @param {String} [payload.callback] Callback
      * @return receiver
    */

    checkEtag: function (obj) {
      var sql = "SELECT etag FROM %I WHERE id = $1"
          .format([obj.name.toSnakeCase()]);

      obj.client.query(sql, [obj.id], function (err, resp) {
        var result;

        if (err) {
          obj.callback(err);
          return;
        }

        result = resp.rows.length ? resp.rows[0].etag === obj.etag : false;
        obj.callback(null, result);
      });

      return this;
    },

    /**
      Remove a class from the database.

      * @param {String | Array} Names(s) of model(s) to remove.
      * @return {Boolean}
    */
    deleteModel: function (names) {
      names = Array.isArray ? names : [names];

      var name, table, catalog, sql, rels, i, props, view, type, key,
        o = 0;

      while (o < names.length) {
        name = names[o];
        table = name.toSnakeCase();
        catalog = that.getSettings('catalog');
        sql = ("DROP VIEW %I; DROP TABLE %I;" +
          "DELETE FROM \"$model\" WHERE id=$1;")
          .format(["_" + table, table]);
        rels = [];
        i = 0;

        if (!table || !catalog[name]) {
          throw "Class not found";
        }

        /* Drop views for composite types */
        props = catalog[name].properties;
        for (key in props) {
          if (props.hasOwnProperty(key) &&
              typeof props[key].type === "object") {
            type = props[key].type;

            if (type.properties) {
              view = "_" + name.toSnakeCase() + "$" + key.toSnakeCase();
              sql += "DROP VIEW %I;".format([view]);
            }

            if (type.childOf && catalog[type.relation]) {
              delete catalog[type.relation].properties[type.childOf];
              rels.push(type.relation);
            }
          }
        }

        /* Update catalog settings */
        delete catalog[name];
        that.saveSettings("catalog", catalog);

        /* Update views */
        while (i < rels.length) {
          createView(rels[i], true);
          i++;
        }

        /* Drop table(s) */
        plv8.execute(sql, [table]);

        o++;
      }

      return true;
    },

    /**
      Return the current user.

      @return {String}
    */
    getCurrentUser: function () {
      if (currentUser) { return currentUser; }

      throw "Current user undefined";
    },

    /**
      Return a class definition, including inherited properties.

      @param {Object} Request payload
      @param {Object} [payload.name] Model name
      @param {Object} [payload.client] Database client
      @param {Function} [payload.callback] callback
      @param {Boolean} Include inherited or not. Defult = true.
      @return receiver
    */
    getModel: function (obj, includeInherited) {
      var payload = {},
        name = obj.name;

      payload.name = "catalog";
      payload.client = obj.client;
      payload.callback = function (err, catalog) {
        var resultProps, modelProps, keys, appendParent,
          result = {name: name, inherits: "Object"};

        appendParent = function (child, parent) {
          var model = catalog[parent],
            parentProps = model.properties,
            childProps = child.properties,
            ckeys = Object.keys(parentProps);

          if (parent !== "Object") {
            appendParent(child, model.inherits || "Object");
          }

          ckeys.forEach(function (key) {
            if (childProps[key] === undefined) {
              childProps[key] = parentProps[key];
              childProps[key].inheritedFrom = parent;
            }
          });

          return child;
        };

        /* Validation */
        if (!catalog[name]) {
          obj.callback("Model " + name + " not found.");
          return;
        }

        /* Add other attributes after name */
        keys = Object.keys(catalog[name]);
        keys.forEach(function (key) {
          result[key] = catalog[name][key];
        });

        /* Want inherited properites before class properties */
        if (includeInherited !== false && name !== "Object") {
          result.properties = {};
          result = appendParent(result, result.inherits);
        } else {
          delete result.inherits;
        }

        /* Now add local properties back in */
        modelProps = catalog[name].properties;
        resultProps = result.properties;
        keys = Object.keys(modelProps);
        keys.forEach(function (key) {
          resultProps[key] = modelProps[key];
        });

        obj.callback(null, result);
      };

      /* First, get catalog */
      that.getSettings(payload);
    },

    /**
      Return settings.

      @param {Object} Request payload
      @param {Object} [payload.name] Settings name
      @param {Object} [payload.client] Database client
      @param {Function} [paylead.callback] callback
      @return {Object}
    */
    getSettings: function (obj) {
      var callback,
        name = obj.name;

      callback = function (err, ok) {
        var sql = "SELECT data FROM \"$settings\" WHERE name = $1";

        if (err) {
          obj.callback(err);
          return;
        }

        // If etag checks out, pass back cached
        if (ok) {
          obj.callback(null, settings[name]);
          return;
        }

        // If here, need to query for the current settings
        obj.client.query(sql, [name], function (err, resp) {
          var rec;

          if (err) {
            obj.callback(err);
            return;
          }

          // If we found something, cache it
          if (resp.rows.length) {
            rec = resp.rows[0];

            settings[name] = {
              id: rec.id,
              etag: rec.etag,
              data: rec.data
            };
          }

          // Send back the settings if any were found, otherwise "false"
          obj.callback(null, settings[name] ? settings[name].data : false);
        });
      };

      if (settings[name]) {
        that.checkEtag({
          name: "$settings",
          id: settings[name].id,
          etag: settings[name].etag,
          client: obj.client,
          callback: callback
        });

        return;
      }

      callback(null, false);
    },

    /**
      Check whether a user is authorized to perform an action on a
      particular model (class) or object.

      Allowable actions: "canCreate", "canRead", "canUpdate", "canDelete"

      "canCreate" will only check model names.

      @param {Object} Specification
      @param {String} [specification.action] Required
      @param {String} [specification.model] Class
      @param {String} [specification.id] Object id
      @param {String} [specification.user] User. Defaults to current user
      @param {String} [specification.folder] Folder. Applies to "canCreate"
        action
    */
    isAuthorized: function (obj) {
      var table, pk, authSql, sql,
        user = obj.user || that.getCurrentUser(),
        model = obj.model,
        folder = obj.folder,
        action = obj.action,
        id = obj.id,
        tokens = [],
        result = false;

      /* If model, check class authorization */
      if (model) {
        sql =
          "SELECT pk FROM \"$auth\" AS auth " +
          "  JOIN \"$model\" AS model ON model._pk=auth.object_pk " +
          "  JOIN role ON role._pk=auth.role_pk " +
          "  JOIN role_member ON role_member._parent_role_pk=role._pk " +
          "WHERE model.id=$1" +
          "  AND role_member.member=$2" +
          "  AND %I";
        sql = sql.format([action.toSnakeCase()]);
        result = plv8.execute(sql, [model.toSnakeCase(), user]);

      /* Otherwise check object authorization */
      } else if (id) {
        /* Find object */
        sql = "SELECT _pk, tableoid::regclass::text AS \"table\"" +
          "FROM object WHERE id = $1;";
        result = plv8.execute(sql, [id]);

        /* If object found, check authorization */
        if (result.length > 0) {
          table = result[0].table;
          pk = result[0]._pk;

          tokens.push(table);
          authSql =  buildAuthSql(action, table, tokens);
          sql = "SELECT _pk FROM %I WHERE _pk = $2 " + authSql;
          sql = sql.format(tokens);

          result = plv8.execute(sql, [user, pk]).length > 0;
        }
      }

      /* Check target location for create */
      if (action === "canCreate" && result) {
        if (!folder) { return false; }
        sql =
          "SELECT can_create FROM \"$auth\" AS auth " +
          "  JOIN folder ON folder._pk=auth.object_pk " +
          "  JOIN role ON role._pk=auth.role_pk " +
          "  JOIN role_member ON role_member._parent_role_pk=role._pk " +
          "WHERE role_member.member=$1" +
          "  AND folder.id=$2" +
          "  AND is_member_auth " +
          "ORDER BY is_inherited, can_create DESC " +
          "LIMIT 1";

        result = plv8.execute(sql, [user, folder]);
        result = result.length > 0 ? result[0].can_create : false;
      }

      return result;
    },

    /**
      Returns whether user is super user.

      @param {String} User. Defaults to current user
      @return {Boolean}
    */
    isSuperUser: function (user) {
      user = user === undefined ? that.getCurrentUser() : user;

      var sql = "SELECT is_super FROM \"$user\" WHERE username=$1;",
        result;

      result = plv8.execute(sql, [user]);

      return result.length ? result[0].is_super : false;
    },

    /**
      Request.

      Example payload:
          {
             "name": "Contact",
             "method": "POST",
             "data": {
               "id": "1f8c8akkptfe",
               "created": "2015-04-26T12:57:57.896Z",
               "createdBy": "admin",
               "updated": "2015-04-26T12:57:57.896Z",
               "updatedBy": "admin",
               "fullName": "John Doe",
               "birthDate": "1970-01-01T00:00:00.000Z",
               "isMarried": true,
               "dependentes": 2
             }
          }

      @param {Object} Payload
      @param {Boolean} Bypass authorization checks. Default = false.
      @return receiver
    */
    request: function (obj, isSuperUser) {
      isSuperUser = isSuperUser === undefined ? false : isSuperUser;

      var result, args, fn,
        prop = obj.name,
        callback = obj.callback;

      setCurrentUser(obj.user);

      obj.callback = function (err, resp) {
        setCurrentUser(undefined);

        // Format errors into objects that can be handled by server
        if (err) {
          console.error(err);
          if (typeof err === "object") {
            err = {message: err.message, statusCode: err.statusCode || 500};
          } else {
            err = {message: err, statusCode: 500};
          }
          err.isError = true;
          callback(err);
          return;
        }

        // Otherwise return response
        callback(err, resp);
      };

      switch (obj.method) {
      case "GET":
        doSelect(obj, false, isSuperUser);
        break;
      case "POST":
        /* Handle if posting a function call */
        if (that[prop] && typeof that[prop] === "function") {
          args = Array.isArray(obj.data) ? obj.data : [obj.data];
          fn = curry(that[prop], args);
          result = fn();
        } else {
          result = doInsert(obj, false, isSuperUser);
        }
        break;
      case "PATCH":
        result = doUpdate(obj, false, isSuperUser);
        break;
      case "DELETE":
        result = doDelete(obj, false, isSuperUser);
        break;
      default:
        throw "method \"" + obj.method + "\" unknown";
      }

      return this;
    },

    /**
      Set authorazition for a particular authorization role.

      Example:
        {
          id: "ExWIx6'",
          role: "IWi.QWvo",
          isMember: true,
          actions: 
            {
              canCreate: false,
              canRead: true,
              canUpdate: false,
              canDelete: false
            }
        }

      @param {Object} Specificication
      @param {String} [specification.model] Class name
      @param {String} [specification.id] Object id
      @param {Boolean} [specification.isMember] Indicates member privilege
        of folder
      @param {String} [specification.role] Role
      @param {Object} [specification.actions] Required
      @param {Boolean} [specification.actions.canCreate]
      @param {Boolean} [specification.actions.canRead]
      @param {Boolean} [specification.actions.canUpdate]
      @param {Boolean} [specification.actions.canDelete]
    */
    saveAuthorization: function (obj) {
      var result, sql, pk, err, model, params,
        id = obj.model ? obj.model.toSnakeCase() : obj.id,
        objPk = getKey(id),
        rolePk = getKey(obj.role),
        actions = obj.actions || {},
        isMember = false,
        hasAuth = false;

      /* Validation */
      if (!objPk) {
        err = "Object \"" + id + "\" not found";
      } else if (!rolePk) {
        err = "Role \"" + id + "\" not found";
      }

      if (err) { throw err; }

      if (obj.id && obj.isMember) {
        sql = "SELECT tableoid::regclass::text AS model " +
          "FROM object WHERE id=$1";
        model = plv8.execute(sql, [id])[0].model.toCamelCase(true);

        if (model === "Folder") {
          isMember = obj.isMember || false;
        }

        model = that.getModel(model);

        if (isChildModel(model)) {
          err = "Can not set authorization on child models.";
        } else if (!model.properties.owner) {
          err = "Model must have owner property to set authorization";
        }

        if (err) { throw err; }
      }

      if (!that.isSuperUser()) {
        sql = "SELECT owner FROM %I WHERE _pk=$1"
          .format(model.name.toSnakeCase());
        result = plv8.execute(sql, [objPk]);

        if (result[0].owner !== that.getCurrentUser()) {
          err = "Must be super user or owner of \"" + id + "\" to set " +
            "authorization.";
          throw err;
        }
      }

      /* Determine whether any authorization has been granted */
      hasAuth = actions.canCreate ||
        actions.canRead ||
        actions.canUpdate ||
        actions.canDelete;

      /* Find an existing authorization record */
      sql = "SELECT auth.* FROM \"$auth\" AS auth " +
        "JOIN object ON object._pk=object_pk " +
        "JOIN role ON role._pk=role_pk " +
        "WHERE object.id=$1 AND role.id=$2 AND is_member_auth=$3 " +
        " ORDER BY is_inherited";
      result = plv8.execute(sql, [id, obj.role, isMember]);
      result = result.length ? result[0] : false;

      if (result && !result.is_inherited) {
        pk = result.pk;

        if (!hasAuth && isMember) {
          sql = "DELETE FROM \"$auth\" WHERE pk=$1";
          params = [pk];
        } else {
          sql = "UPDATE \"$auth\" SET can_create=$1, can_read=$2," +
            "can_update=$3, can_delete=$4 WHERE pk=$5";
          params = [
            actions.canCreate === undefined ?
                result.can_create : actions.canCreate,
            actions.canRead === undefined ?
                result.can_read : actions.canRead,
            actions.canUpdate === undefined ?
                result.can_update : actions.canUpdate,
            actions.canDelete === undefined ?
                result.can_delete : actions.canDelete,
            pk
          ];
        }
      } else if (hasAuth || (!isMember || result.is_inherited)) {
        sql = "INSERT INTO \"$auth\" VALUES (" +
          "nextval('$auth_pk_seq'), $1, $2, false," +
          "$3, $4, $5, $6, $7)";
        params = [
          objPk,
          rolePk,
          actions.canCreate === undefined ? false : actions.canCreate,
          actions.canRead === undefined ? false : actions.canRead,
          actions.canUpdate === undefined ? false : actions.canUpdate,
          actions.canDelete === undefined ? false : actions.canDelete,
          isMember
        ];
      } else {
        return;
      }

      plv8.execute(sql, params);

      if (model === "Folder" && isMember) {
        propagateAuth({folderId: obj.id, roleId: obj.role});
      }
    },

    /**
      Create or update a persistence class. This function is idempotent. 
      Subsequent saves will automatically drop properties no longer present.

      Example payload:
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
            "type": "date"
          },
          "isMarried": {
            "description": "Marriage status",
            "type": "boolean"
          },
          "dependents": {
            "description": "Number of dependents",
            "type": "number"
          }
        }
      }

     * @param {Object | Array} Model specification payload(s).
     * @param {String} [specification.name] Name
     * @param {String} [specification.description] Description
     * @param {Object | Boolean} [specification.authorization] Authorization
     *  spec. Defaults to grant all to everyone if undefined. Pass false to
     *  grant no auth.
     * @param {String} [specification.properties] Model properties
     * @param {String} [specification.properties.description] Description
     * @param {String} [specification.properties.default] Default value
     *  or function name.
     * @param {String | Object} [specification.properties.type] Type. Standard
     *  types are string, boolean, number, date. Object is used for relation
     *  specs.
     * @param {String} [specification.properties.relation] Model name of
     *  relation.
     * @param {String} [specification.properties.childOf] Property name on
     *  parent relation if one to many relation.
     * @return {Boolean}
    */
    saveModel: function (specs) {
      specs = Array.isArray(specs) ? specs : [specs];

      var table, inherits, model, catalog, sql, sqlUpd, token, tokens, values,
        adds, args, fns, cols, defaultValue, props, keys, recs, type, name,
        parent, i, n, p, dropSql, changed, isChild, pk, authorization,
        getParentKey = function (child) {
          var cParent, cKeys, cProps;

          cProps = that.getModel(child).properties;
          cKeys = Object.keys(cProps);
          cKeys.forEach(function (cKey) {
            if (typeof cProps[cKey].type === "object" &&
                cProps[cKey].type.childOf) {
              cParent = cProps[cKey].type.relation;

              if (isChildModel(that.getModel(parent))) {
                return getParentKey(cParent);
              }

              return getKey(cParent.toSnakeCase());
            }
          });

        };

      specs.forEach(function (obj) {
        var precision, scale;

        table = obj.name ? obj.name.toSnakeCase() : false;
        inherits = (obj.inherits || "Object").toSnakeCase();
        model = that.getModel(obj.name, false);
        catalog = that.getSettings("catalog");
        authorization = obj.authorization;
        dropSql = "DROP VIEW IF EXISTS %I CASCADE;".format(["_" + table]);
        changed = false;
        sql = "";
        tokens = [];
        adds = [];
        args = [];
        fns = [];
        cols = [];
        i = 0;
        n = 0;
        p = 1;

        if (!table) { throw "No name defined"; }

        /* Create table if applicable */
        if (!model) {
          sql = "CREATE TABLE %I( " +
            "CONSTRAINT %I PRIMARY KEY (_pk), " +
            "CONSTRAINT %I UNIQUE (id)) " +
            "INHERITS (%I);";
          tokens = tokens.concat([
            table,
            table + "_pkey",
            table + "_id_key",
            inherits
          ]);
        } else {
          /* Drop non-inherited columns not included in properties */
          props = model.properties;
          keys = Object.keys(props);
          keys.forEach(function (key) {
            if (obj.properties && !obj.properties[key] &&
                !(typeof model.properties[key].type === "object" &&
                typeof model.properties[key].type.parentOf)) {
              /* Drop views */
              if (!changed) {
                sql += dropSql;
                changed = true;
              }

              /* Handle relations */
              type = props[key].type;

              if (typeof type === "object" && type.properties) {
                /* Drop associated view if applicable */
                sql += "DROP VIEW %I;";
                tokens = tokens.concat([
                  "_" + table + "_" + key.toSnakeCase(),
                  table,
                  relationColumn(key, type.relation)
                ]);
              } else {
                tokens = tokens.concat([table, key.toSnakeCase()]);
              }

              sql += "ALTER TABLE %I DROP COLUMN %I;";

              /* Unrelate parent if applicable */
              if (type.childOf) {
                parent = catalog[type.relation];
                delete parent.properties[type.childOf];
              }

            // Parent properties need to be added back into spec so not lost
            } else if (obj.properties && !obj.properties[key] &&
                (typeof model.properties[key].type === "object" &&
                typeof model.properties[key].type.parentOf)) {
              obj.properties[key] = model.properties[key];
            }
          });
        }

        /* Add table description */
        if (obj.description) {
          sql += "COMMENT ON TABLE %I IS %L;";
          tokens = tokens.concat([table, obj.description || ""]);
        }

        /* Add columns */
        obj.properties = obj.properties || {};
        props = obj.properties;
        keys = Object.keys(props).filter(function (item) {
          return !props[item].inheritedFrom;
        });
        keys.forEach(function (key) {
          var prop = props[key];
          type = typeof prop.type === "string" ?
              types[prop.type] : prop.type;

          if (type && key !== obj.discriminator) {
            if (!model || !model.properties[key]) {
              /* Drop views */
              if (model && !changed) {
                sql += dropSql;
              }

              changed = true;

              sql += "ALTER TABLE %I ADD COLUMN %I ";

              if (prop.isUnique) { sql += "UNIQUE "; }

              /* Handle composite types */
              if (type.relation) {
                sql += "integer;";
                token = relationColumn(key, type.relation);

                /* Update parent class for children */
                if (type.childOf) {
                  parent = catalog[type.relation];
                  if (!parent.properties[type.childOf]) {
                    parent.properties[type.childOf] = {
                      description: 'Parent of "' + key + '" on "' +
                        obj.name + '"',
                      type: {
                        relation: obj.name,
                        parentOf: key
                      }
                    };

                  } else {
                    throw 'Property "' + type.childOf +
                      '" already exists on "' + type.relation + '"';
                  }

                } else if (type.parentOf) {
                  throw 'Can not set parent directly for "' + key + '"';
                }

                if (type.properties) {
                  cols = ["%I"];
                  name = "_" + table + "$" + key.toSnakeCase();
                  args = [name, "_pk"];

                  /* Always include "id" whether specified or not */
                  if (type.properties.indexOf("id") === -1) {
                    type.properties.unshift("id");
                  }

                  while (i < type.properties.length) {
                    cols.push("%I");
                    args.push(type.properties[i].toSnakeCase());
                    i++;
                  }

                  args.push(type.relation.toSnakeCase());
                  sql += ("CREATE VIEW %I AS SELECT " + cols.join(",") +
                    " FROM %I WHERE NOT is_deleted;").format(args);
                }

              /* Handle standard types */
              } else {
                if (prop.format && formats[prop.format]) {
                  sql += formats[prop.format].type;
                } else {
                  sql += type.type;
                  if (type.type === "numeric") {
                    precision = typeof prop.precision === "number" ?
                        prop.precision : PRECISION_DEFAULT;
                    scale = typeof prop.scale === "number" ?
                        prop.scale : SCALE_DEFAULT;
                    sql += "(" + precision + "," + scale + ")";
                  }
                }
                sql += ";";
                token = key.toSnakeCase();
              }
              adds.push(key);

              tokens = tokens.concat([table, token]);

              if (props[key].description) {
                sql += "COMMENT ON COLUMN %I.%I IS %L;";
                tokens = tokens.concat([
                  table,
                  token,
                  props[key].description || ""
                ]);
              }
            }
          } else {
            throw 'Invalid type "' + props[key].type + '" for property "' +
                key + '" on class "' + obj.name + '"';
          }
        });

        /* Update schema */
        sql = sql.format(tokens);
        plv8.execute(sql);

        /* Populate defaults */
        if (adds.length) {
          values = [];
          tokens = [];
          args = [table];
          i = 0;

          while (i < adds.length) {
            type = props[adds[i]].type;
            if (typeof type === "object") {
              defaultValue = -1;
            } else {
              defaultValue = props[adds[i]].default ||
                types[type].default;
            }

            if (typeof defaultValue === "string" &&
                defaultValue.match(/\(\)$/)) {
              fns.push({
                col: adds[i].toSnakeCase(),
                default: defaultValue.replace(/\(\)$/, "")
              });
            } else {
              values.push(defaultValue);
              tokens.push("%I=$" + p);
              if (typeof type === "object") {
                args.push(relationColumn(adds[i], type.relation));
              } else {
                args.push(adds[i].toSnakeCase());
              }
              p++;
            }
            i++;
          }

          if (values.length) {
            sql = ("UPDATE %I SET " + tokens.join(",") + ";").format(args);
            plv8.execute(sql, values);
          }

          /* Update function based defaults (one by one) */
          if (fns.length) {
            sql = "SELECT _pk FROM %I ORDER BY _pk OFFSET $1 LIMIT 1;"
              .format([table]);
            recs = plv8.execute(sql, [n]);
            tokens = [];
            args = [table];
            i = 0;

            while (i < fns.length) {
              tokens.push("%I=$" + (i + 2));
              args.push(fns[i].col);
              i++;
            }

            sqlUpd = ("UPDATE %I SET " + tokens.join(",") + " WHERE _pk = $1")
              .format(args);

            while (recs.length) {
              values = [recs[0]._pk];
              i = 0;
              n++;

              while (i < fns.length) {
                values.push(f[fns[i].default]());
                i++;
              }

              plv8.execute(sqlUpd, values);
              recs = plv8.execute(sql, [n]);
            }
          }
        }

        /* Update catalog settings */
        name = obj.name;
        catalog[name] = obj;
        delete obj.name;
        delete obj.authorization;
        obj.isChild = isChildModel(obj);
        that.saveSettings("catalog", catalog);

        if (!model) {
          isChild = isChildModel(that.getModel(name));
          pk = plv8.execute("select nextval('object__pk_seq') as pk;")[0].pk;
          sql = "INSERT INTO \"$model\" " +
            "(_pk, id, created, created_by, updated, updated_by, is_deleted, " +
            " is_child, parent_pk) VALUES " +
            "($1, $2, now(), $3, now(), $4, false, $5, $6);";
          values = [pk, table, that.getCurrentUser(),
            that.getCurrentUser(), isChild,
            isChild ? getParentKey(name) : pk];

          plv8.execute(sql, values);
        }

        /* Propagate views */
        changed = changed || !model;
        if (changed) {
          propagateViews(name);
        }

        /* If no specific authorization, grant to all */
        if (authorization === undefined) {
          authorization = {
            model: name,
            role: "everyone",
            actions: {
              canCreate: true,
              canRead: true,
              canUpdate: true,
              canDelete: true
            }
          };
        }

        /* Set authorization */
        if (authorization) {
          that.saveAuthorization(authorization);
        }
      });

      return true;
    },

    /**
      Create or upate settings.

      @param {String} Name of settings
      @param {Object} Settings payload
      @return {String}
    */
    saveSettings: function (name, settings) {
      var sql = "SELECT data FROM \"$settings\" WHERE name = $1;",
        params = [name, settings],
        result,
        rec;

      result = plv8.execute(sql, [name]);

      if (result.length) {
        rec = result[0];

        if (settings.etag !== rec.etag) {
          throw 'Settings for "' + name +
            '" changed by another user. Save failed.';
        }

        sql = "UPDATE \"$settings\" SET data = $2 WHERE name = $1;";

        plv8.execute(sql, params);
      } else {
        sql = "INSERT INTO \"$settings\" (name, data) VALUES ($1, $2);";
        plv8.execute(sql, params);
      }

      settings[name] = settings;

      return true;
    },

    /**
      Returns whether user is super user.

      @param {String} User
      @param {Boolean} Is super user. Default = true
    */
    setSuperUser: function (user, isSuper) {
      isSuper = isSuper === undefined ? true : isSuper;

      var sql = "SELECT * FROM pg_user WHERE usename=$1;",
        params = [user, isSuper],
        result;

      if (!that.isSuperUser(that.getCurrentUser())) {
        throw "Only a super user can set another super user";
      }

      result = plv8.execute(sql, [user]);

      if (!result.length) {
        throw "User does not exist";
      }

      sql = "SELECT * FROM \"$user\" WHERE username=$1;";
      result = plv8.execute(sql, [user]);

      if (result.length) {
        sql = "UPDATE \"$user\" SET is_super=$2 WHERE username=$1";
      } else {
        sql = "INSERT INTO \"$user\" VALUES ($1, $2)";
      }

      plv8.execute(sql, params);
    }
  };

  // Set properties on exports
  Object.keys(that).forEach(function (key) {
    exports[key] = that[key];
  });

  // ..........................................................
  // PRIVATE
  //

  /** private */
  buildAuthSql = function (action, table, tokens) {
    var actions = [
        "canRead",
        "canUpdate",
        "canDelete"
      ],
      i = 8;

    if (actions.indexOf(action) === -1) {
      throw "Invalid authorization action for object \"" + action + "\"";
    }

    while (i--) {
      tokens.push(table);
    }

    action = action.toSnakeCase();

    return " AND _pk IN (" +
        "SELECT %I._pk " +
        "FROM %I " +
        "  JOIN \"$model\" ON \"$model\".id::regclass::oid=%I.tableoid " +
        "WHERE EXISTS (" +
        "  SELECT " + action + " FROM ( " +
        "    SELECT " + action +
        "    FROM \"$auth\"" +
        "      JOIN \"role\" on \"$auth\".\"role_pk\"=\"role\".\"_pk\"" +
        "      JOIN \"role_member\"" +
        "        ON \"role\".\"_pk\"=\"role_member\".\"_parent_role_pk\"" +
        "    WHERE member=$1" +
        "      AND object_pk=\"$model\".parent_pk" +
        "    ORDER BY " + action + " DESC" +
        "    LIMIT 1" +
        "  ) AS data" +
        "  WHERE " + action +
        ") " +
        "INTERSECT " +
        "SELECT %I._pk " +
        "FROM %I" +
        "  JOIN \"$objectfolder\" ON _pk=object_pk " +
        "WHERE EXISTS (" +
        "  SELECT " + action + " FROM (" +
        "    SELECT " + action +
        "    FROM \"$auth\"" +
        "      JOIN \"role\" on \"$auth\".\"role_pk\"=\"role\".\"_pk\"" +
        "      JOIN \"role_member\"" +
        "        ON \"role\".\"_pk\"=\"role_member\".\"_parent_role_pk\"" +
        "    WHERE member=$1" +
        "      AND object_pk=folder_pk" +
        "      AND is_member_auth" +
        "    ORDER BY is_inherited, " + action + " DESC" +
        "    LIMIT 1" +
        "  ) AS data" +
        "  WHERE " + action +
        ") " +
        "EXCEPT " +
        "SELECT %I._pk " +
        "FROM %I " +
        "WHERE EXISTS ( " +
        "  SELECT " + action + " FROM (" +
        "    SELECT " + action +
        "    FROM \"$auth\"" +
        "    JOIN \"role\" on \"$auth\".\"role_pk\"=\"role\".\"_pk\"" +
        "    JOIN \"role_member\" " +
        "      ON \"role\".\"_pk\"=\"role_member\".\"_parent_role_pk\"" +
        "    WHERE member=$1" +
        "      AND object_pk=%I._pk" +
        "    ORDER BY " + action + " DESC" +
        "    LIMIT 1 " +
        "  ) AS data " +
        "WHERE NOT " + action + "))";
  };

  /** private */
  createView = function (name, dropFirst) {
    var parent, alias, type, view, sub, col,
      model = that.getModel(name),
      table = name.toSnakeCase(),
      args = ["_" + table, "_pk"],
      props = model.properties,
      keys = Object.keys(props),
      cols = ["%I"],
      sql = "";

    keys.forEach(function (key) {
      alias = key.toSnakeCase();

      /* Handle discriminator */
      if (key === "objectType") {
        cols.push("%s");
        args.push("to_camel_case(tableoid::regclass::text, true) AS " + alias);

      /* Handle relations */
      } else if (typeof props[key].type === "object") {
        type = props[key].type;
        parent =  props[key].inheritedFrom ?
            props[key].inheritedFrom.toSnakeCase() : table;

        /* Handle to many */
        if (type.parentOf) {
          sub = "ARRAY(SELECT %I FROM %I WHERE %I.%I = %I._pk " +
            "AND NOT %I.is_deleted ORDER BY %I._pk) AS %I";
          view = "_" + props[key].type.relation.toSnakeCase();
          col = "_" + type.parentOf.toSnakeCase() + "_" + parent + "_pk";
          args = args.concat([view, view, view, col, table, view, view,
            alias]);

        /* Handle to one */
        } else if (!type.childOf) {
          col = "_" + key.toSnakeCase() + "_" +
            props[key].type.relation.toSnakeCase() + "_pk";
          sub = "(SELECT %I FROM %I WHERE %I._pk = %I) AS %I";

          if (props[key].type.properties) {
            view = "_" + parent + "$" + key.toSnakeCase();
          } else {
            view = "_" + props[key].type.relation.toSnakeCase();
          }

          args = args.concat([view, view, view, col, alias]);
        } else {
          sub = "_" + key.toSnakeCase() + "_" + type.relation.toSnakeCase() +
             "_pk";
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
      sql = "DROP VIEW %I;".format(["_" + table]);
    }

    sql += ("CREATE OR REPLACE VIEW %I AS SELECT " + cols.join(",") +
      " FROM %I;").format(args);

    plv8.execute(sql);
  };

  /** private */
  curry = function (fn, args) {
    return function () {
      return fn.apply(this, args.concat([].slice.call(arguments)));
    };
  };

  /** private */
  doDelete = function (obj, isChild, isSuperUser) {
    var oldRec, keys, i, child, rel, now,
      sql = "UPDATE object SET is_deleted = true WHERE id=$1;",
      model = that.getModel(obj.name),
      props = model.properties,
      noChildProps = function (key) {
        if (typeof model.properties[key].type !== "object" ||
            !model.properties[key].type.childOf) {
          return true;
        }
      };

    if (!isChild && isChildModel(obj.name)) {
      throw "Can not directly delete a child class";
    }

    if (isSuperUser === false &&
        !that.isAuthorized({action: "canDelete", id: obj.id})) {
      throw "Not authorized to delete \"" + obj.id + "\"";
    }

    // Get old record, bail if it doesn't exist
    /* Exclude child key when we select */
    obj.properties = Object.keys(model.properties)
      .filter(noChildProps);
    oldRec = doSelect(obj, true);
    if (!Object.keys(oldRec).length) {
      throw "Record " + obj.id + " not found.";
    }

    if (oldRec.isDeleted) {
      throw "Record " + obj.id + " already deleted.";
    }

    /* Delete children recursively */
    keys = Object.keys(props);
    keys.forEach(function (key) {
      if (typeof props[key].type === "object" &&
          props[key].type.parentOf) {
        rel = props[key].type.relation;
        i = 0;

        while (i < oldRec[key].length) {
          child = {name: rel, id: oldRec[key][i].id};
          doDelete(child, true);
          i++;
        }
      }
    });

    /* Now delete object */
    plv8.execute(sql, [obj.id]);

    /* Handle change log */
    now = f.now();

    doInsert({
      name: "Log",
      data: {
        objectId: obj.id,
        action: "DELETE",
        created: now,
        createdBy: now,
        updated: now,
        updatedBy: now
      }
    }, true);

    return true;
  };

  /** private */
  doInsert = function (obj, isChild, isSuperUser) {
    var child, key, col, prop, result, value, sql, err, pk, fkeys, dkeys,
      len, n, msg,
      data = JSON.parse(JSON.stringify(obj.data)),
      model = that.getModel(obj.name),
      folder = obj.folder !== false ? obj.folder || "global" : false,
      args = [obj.name.toSnakeCase()],
      props = model.properties,
      children = {},
      tokens = [],
      params = [],
      values = [],
      i = 0,
      p = 2;

    if (!model) {
      throw "Class \"" + obj.name + "\" not found";
    }

    fkeys = Object.keys(props);
    dkeys = Object.keys(data);

    /* Validate */
    len = dkeys.length;
    for (n = 0; n < len; n++) {
      if (fkeys.indexOf(dkeys[n]) === -1) {
        throw "Model \"" + obj.name +
          "\" does not contain property \"" + dkeys[n] + "\"";
      }
    }

    /* Check id for existence and uniqueness and regenerate if any problem */
    if (!data.id ||  getKey(data.id) !== undefined) {
      data.id = f.createId();
    } else if (isSuperUser === false) {
      if (!that.isAuthorized({
          action: "canCreate",
          model: obj.name,
          folder: folder
        })) {
        msg = "Not authorized to create \"" + obj.name + "\" in folder \"" +
          folder + "\"";
        throw {statusCode: 401, message: msg};
      }
    }

    /* Set some system controlled values */
    data.created = data.updated = f.now();
    data.createdBy = that.getCurrentUser();
    data.updatedBy = that.getCurrentUser();

    /* Get primary key */
    pk = plv8.execute("select nextval('object__pk_seq')")[0].nextval;
    values.push(pk);

    /* Build values */
    len = fkeys.length;
    for (n = 0; n < len; n++) {
      key = fkeys[n];
      child = false;
      prop = props[key];

      /* Handle relations */
      if (typeof prop.type === "object") {
        if (prop.type.parentOf) {
        /* To many */
          child = true;
          children[key] = prop;

        /* To one */
        } else {
          col = relationColumn(key, prop.type.relation);
          value = data[key] !== undefined ? getKey(data[key].id) : -1;
          if (value === undefined) {
            err = 'Relation not found in "{rel}" for "{key}" with id "{id}"'
              .replace("{rel}", prop.type.relation)
              .replace("{key}", key)
              .replace("{id}", data[key].id);
          } else if (!isChild && prop.type.childOf) {
            err = "Child records may only be created from the parent.";
          }
          if (err) {
            throw err;
          }
        }

      /* Handle discriminator */
      } else if (key === "objectType") {
        child = true;

      /* Handle regular types */
      } else {
        value = data[key];
        col = key.toSnakeCase();

        if (value === undefined) {
          value = prop.default === undefined ?
              types[prop.type].default : prop.default;

          /* If we have a class specific default that calls a function */
          if (value && typeof value === "string" && value.match(/\(\)$/)) {
            value = f[value.replace(/\(\)$/, "")]();
          }
        }
      }

      if (!child) {
        args.push(col);
        tokens.push("%I");
        values.push(value);
        params.push("$" + p);
        p++;
      }
    }

    sql = ("INSERT INTO %I (_pk, " + tokens.toString(",") + ") VALUES ($1," +
      params.toString(",") + ");").format(args);

    /* Execute */
    plv8.execute(sql, values);

    /* Iterate through children */
    for (key in children) {
      if (children.hasOwnProperty(key) && data[key]) {
        i = 0;
        while (i < data[key].length) {
          data[key][i][children[key].type.parentOf] = {id: data.id};
          child = {
            name: children[key].type.relation,
            data: data[key][i]
          };
          doInsert(child, true);
          i++;
        }
      }
    }

    if (isChild) { return; }

    result = doSelect({name: obj.name, id: data.id});

    /* Handle folder */
    if (folder) {
      sql = "INSERT INTO \"$objectfolder\" VALUES ($1, $2);";
      plv8.execute(sql, [pk, getKey(folder)]);
    }

    /* Handle change log */
    doInsert({
      name: "Log",
      data: {
        objectId: data.id,
        action: "POST",
        created: data.created,
        createdBy: data.createdBy,
        updated: data.updated,
        updatedBy: data.updatedBy,
        change: JSON.parse(JSON.stringify(result))
      }
    }, true);

    /* Handle folder authorization propagation */
    if (obj.name === "Folder") {
      propagateAuth({folderId: obj.folder});
    }

    return jsonpatch.compare(obj.data, result);
  };

  /** private */
  doSelect = function (obj, isChild, isSuperUser) {
    var key, sql, table, keys,
      callback = obj.callback,
      payload = {name: obj.name, client: obj.client},
      tokens = [],
      cols = [],
      i = 0;

    payload.callback = function (err, model) {
      if (err) {
        callback(err);
        return;
      }

      table = "_" + model.name.toSnakeCase();
      keys = obj.properties || Object.keys(model.properties);

      /* Validate */
      if (!isChild && model.isChild) {
        callback("Can not query directly on a child class");
      }

      /* "While" is much faster than "forEach." Performance matters here. */
      while (i < keys.length) {
        key = keys[i];
        tokens.push("%I");
        cols.push(key.toSnakeCase());
        i++;
      }

      cols.push(table);
      sql = ("SELECT " +  tokens.toString(",") + " FROM %I").format(cols);

      /* Get one result by key */
      if (obj.id) {
        obj.callback = function (err, key) {
          if (err) {
            callback(err);
            return;
          }

          if (key === undefined) {
            callback(null, {});
            return;
          }

          sql +=  " WHERE _pk = $1";

          obj.client.query(sql, [key], function (err, resp) {
            if (err) {
              callback(err);
              return;
            }

            callback(null, sanitize(resp.rows[0]));
          });

        };

        getKey(obj, isSuperUser);

      /* Get a filtered result */
      } else {
        obj.callback = function (err, keys) {
          if (keys.length) {
            tokens = [];
            i = 0;

            while (keys[i]) {
              i++;
              tokens.push("$" + i);
            }

            sql += " WHERE _pk IN (" + tokens.toString(",") + ")";

            obj.client.query(sql, keys, function (err, resp) {
              if (err) {
                callback(err);
                return;
              }

              callback(null, sanitize(resp.rows));
            });
          }
        };

        getKeys(obj, isSuperUser);
      }

      return this;
    };

    // Kick of query by getting model, the rest falls through callbacks
    that.getModel(payload);

    return this;
  };

  /** Private */
  doUpdate = function (obj, isChild, isSuperUser) {
    var result, updRec, props, value, keys, sql, i, cModel, cid, child,
      oldRec, newRec, cOldRec, cNewRec, cpatches,
      patches = obj.data || [],
      model = that.getModel(obj.name),
      tokens = [model.name.toSnakeCase()],
      id = obj.id,
      pk = getKey(id),
      params = [],
      ary = [],
      p = 1,
      find = function (ary, id) {
        var n = 0;

        while (n < ary.length) {
          if (ary[n].id === id) { return ary[n]; }
          n++;
        }

        return false;
      },
      noChildProps = function (key) {
        if (typeof model.properties[key].type !== "object" ||
            !model.properties[key].type.childOf) {
          return true;
        }
      };

    /* Validate */
    if (!isChild && isChildModel(model)) {
      throw "Can not directly update a child class";
    }

    if (isSuperUser === false &&
        !that.isAuthorized({action: "canUpdate", id: id})) {
      throw "Not authorized to update \"" + id + "\"";
    }

    obj.properties = Object.keys(model.properties).filter(noChildProps);
    oldRec = doSelect(obj, isChild);
    if (!Object.keys(oldRec).length || oldRec.isDeleted) { return false; }

    newRec = JSON.parse(JSON.stringify(oldRec));

    jsonpatch.apply(newRec, patches);

    if (patches.length) {
      props = model.properties;
      updRec = JSON.parse(JSON.stringify(newRec));
      updRec.updated = new Date().toJSON();
      updRec.updatedBy = that.getCurrentUser();
      if (model.properties.etag) {
        updRec.etag = f.createId();
      }

      keys = Object.keys(props);
      keys.forEach(function (key) {
        /* Handle composite types */
        if (typeof props[key].type === "object") {
          /* Handle child records */
          if (Array.isArray(updRec[key])) {
            cModel = that.getModel(props[key].type.relation);
            i = 0;

            /* Process deletes */
            while (i < oldRec[key].length) {
              cid = oldRec[key][i].id;
              if (!find(updRec[key], cid)) {
                child = {name: cModel.name, id: cid};
                doDelete(child, true);
              }

              i++;
            }

            /* Process inserts and updates */
            i = 0;
            while (i < updRec[key].length) {
              cid = updRec[key][i].id || null;
              cOldRec = find(oldRec[key], cid);
              cNewRec = updRec[key][i];
              if (cOldRec) {
                cpatches = jsonpatch.compare(cOldRec, cNewRec);

                if (cpatches.length) {
                  child = {name: cModel.name, id: cid, data: cpatches};
                  doUpdate(child, true);
                }
              } else {
                cNewRec[props[key].type.parentOf] = {id: updRec.id};
                child = {name: cModel.name, data: cNewRec};
                doInsert(child, true);
              }

              i++;
            }

          /* Handle to one relations */
          } else if (!props[key].type.childOf &&
              updRec[key].id !== oldRec[key].id) {
            value = updRec[key].id ? getKey(updRec[key].id) : -1;

            if (value === undefined) {
              throw "Relation not found in \"" + props[key].type.relation +
                "\" for \"" + key + "\" with id \"" + updRec[key].id + "\"";
            }

            tokens.push(relationColumn(key, props[key].type.relation));
            ary.push("%I = $" + p);
            params.push(value);
            p++;
          }

        /* Handle regular data types */
        } else if (updRec[key] !== oldRec[key] && key !== "objectType") {
          tokens.push(key.toSnakeCase());
          ary.push("%I = $" + p);
          params.push(updRec[key]);
          p++;
        }
      });

      sql = ("UPDATE %I SET " + ary.join(",") + " WHERE _pk = $" + p)
        .format(tokens);
      params.push(pk);
      plv8.execute(sql, params);

      if (isChild) { return; }

      /* If a top level record, return patch of what changed */
      result = doSelect({name: model.name, id: id});

      /* Handle change log */
      doInsert({
        name: "Log",
        data: {
          objectId: id,
          action: "PATCH",
          created: updRec.updated,
          createdBy: updRec.updatedBy,
          updated: updRec.updated,
          updatedBy: updRec.updatedBy,
          change: jsonpatch.compare(oldRec, result)
        }
      }, true);

      return jsonpatch.compare(newRec, result);
    }

    return [];
  };

  /** private */
  isChildModel = function (model) {
    var props = model.properties,
      key;

    for (key in props) {
      if (props.hasOwnProperty(key)) {
        if (typeof props[key].type === "object" &&
            props[key].type.childOf) {
          return true;
        }
      }
    }

    return false;
  };

  /** private */
  getKey = function (obj, isSuperUser) {
    var payload = {
        name: obj.name || "Object",
        filter: {criteria: [{property: "id", value: obj.id}]},
        client: obj.client
      };

    payload.callback = function (err, keys) {
      if (err) {
        obj.callback(err);
        return;
      }

      obj.callback(null, keys.length ? keys[0] : undefined);
    };

    getKeys(payload, isSuperUser);

    return this;
  };

  /** private */
  getKeys = function (obj, isSuperUser) {
    var part, order, op, err, n,
      name = obj.name,
      filter = obj.filter,
      ops = ["=", "!=", "<", ">", "<>", "~", "*~", "!~", "!~*"],
      table = name.toSnakeCase(),
      clause = obj.showDeleted ? "true" : "NOT is_deleted",
      sql = "SELECT _pk FROM %I WHERE " + clause,
      tokens = [table],
      criteria = filter ? filter.criteria || [] : false,
      sort = filter ? filter.sort || [] : false,
      params = [],
      parts = [],
      i = 0,
      p = 1;

    /* Add authorization criteria */
    if (isSuperUser === false) {
      sql += buildAuthSql("canRead", table, tokens);

      params.push(that.getCurrentUser());
      p++;
    }

    /* Process filter */
    if (filter) {

      /* Process criteria */
      while (criteria[i]) {
        op = criteria[i].operator || "=";
        tokens.push(criteria[i].property.toSnakeCase());

        if (op === "IN") {
          n = criteria[i].value.length;
          part = [];
          while (n--) {
            params.push(criteria[i].value[n]);
            part.push("$" + p++);
          }
          part = " %I IN (" + part.join(",") + ")";
        } else {
          if (ops.indexOf(op) === -1) {
            err = 'Unknown operator "' + criteria[i].operator + '"';
            throw err;
          }
          params.push(criteria[i].value);
          part = " %I" + op + "$" + p++;
          i++;
        }
        parts.push(part);
        i++;
      }

      if (parts.length) {
        sql += " AND " + parts.join(" AND ");
      }

      /* Process sort */
      i = 0;
      parts = [];
      while (sort[i]) {
        order = (sort[i].order || "ASC").toUpperCase();
        if (order !== "ASC" && order !== "DESC") {
          throw 'Unknown operator "' + order + '"';
        }
        tokens.push(sort[i].property);
        parts.push(" %I " + order);
        i++;
      }

      if (parts.length) {
        sql += " ORDER BY " + parts.join(",");
      }

      /* Process offset and limit */
      if (filter.offset) {
        sql += " OFFSET $" + p++;
        params.push(filter.offset);
      }

      if (filter.limit) {
        sql += " LIMIT $" + p;
        params.push(filter.limit);
      }
    }

    sql = sql.format(tokens);

    obj.client.query(sql, params, function (err, resp) {
      var keys;

      if (err) {
        obj.callback(err);
        return;
      }

      keys = resp.rows.map(function (rec) {
        return rec._pk;
      });

      obj.callback(null, keys);
    });
  };

  /** private 
    @param {Object} Specification
    @param {String} [specification.folderId] Folder id. Required.
    @param {String} [specification.roleId] Role id.
    @param {String} [specification.isDeleted] Folder is hard deleted.
  */
  propagateAuth = function (obj) {
    var auth, auths, children, child, roleKey, n,
      folderKey = getKey(obj.folderId),
      params = [folderKey, false],
      authSql = "SELECT object_pk, role_pk, can_create, can_read, " +
      " can_update, can_delete " +
      "FROM \"$auth\" AS auth" +
      "  JOIN role ON role_pk=_pk " +
      "WHERE object_pk=$1 " +
      "  AND is_member_auth " +
      "  AND is_inherited= $2",
      childSql = "SELECT _pk, id " +
      "FROM \"$objectfolder\"" +
      " JOIN folder ON object_pk=_pk " +
      "WHERE folder_pk=$1 ",
      delSql = "DELETE FROM \"$auth\"" +
      "WHERE object_pk=$1 AND role_pk=$2 " +
      "  AND is_inherited " +
      "  AND is_member_auth",
      insSql = "INSERT INTO \"$auth\" VALUES (nextval('$auth_pk_seq')," +
      "$1, $2, true, $3, $4, $5, $6, true)",
      roleSql = "SELECT id FROM role WHERE _pk=$1",
      i = 0;

    if (obj.roleId) {
      roleKey = getKey(obj.roleId);
      authSql += " AND role.id=$3";
      params.push(roleKey);
    }

    /* Get all authorizations for this folder */
    auths = plv8.execute(authSql, params);

    if (!obj.roleId) {
      authSql += " AND role.id=$3";
    }

    /* Propagate each authorization to children */
    while (i < auths.length) {
      auth = auths[i];

      /* Only process if auth has no manual over-ride */
      params = [folderKey, false, auth.role_pk];

      if (!plv8.execute(authSql, params).length) {

        /* Find child folders */
        children = plv8.execute(childSql, [auth.object_pk]);
        n = 0;

        while (n < children.length) {
          child = children[n];

          /* Delete old authorizations */
          plv8.execute(delSql, [child._pk, auth.role_pk]);

          /* Insert new authorizations */
          params = [child._pk, auth.role_pk, auth.can_create, auth.can_read,
            auth.can_update, auth.can_delete];
          if (!obj.isDeleted) { plv8.execute(insSql, params); }

          /* Propagate recursively */
          propagateAuth({
            folderId: child.id,
            roleId: obj.roleId || plv8.execute(roleSql, [auth.role_pk])[0].id,
            isDeleted: obj.isDeleted
          });

          n++;
        }
      }

      i++;
    }
  };

  /** private */
  propagateViews = function (name) {
    var props, key, cprops, ckey,
      catalog = that.getSettings("catalog");

    createView(name);

    /* Propagate relations */
    for (key in catalog) {
      if (catalog.hasOwnProperty(key)) {
        cprops = catalog[key].properties;

        for (ckey in cprops) {
          if (cprops.hasOwnProperty(ckey) &&
              typeof cprops[ckey].type === "object" &&
              cprops[ckey].type.relation === name &&
              !cprops[ckey].type.childOf &&
              !cprops[ckey].type.parentOf) {
            propagateViews(key);
          }
        }
      }
    }

    /* Propagate down */
    for (key in catalog) {
      if (catalog.hasOwnProperty(key) && catalog[key].inherits === name) {
        propagateViews(key);
      }
    }

    /* Propagate up */
    props = catalog[name].properties;
    for (key in props) {
      if (props.hasOwnProperty(key)) {
        if (typeof props[key].type === "object" && props[key].type.childOf) {
          createView(props[key].type.relation);
        }
      }
    }
  };

  /** private */
  relationColumn = function (key, relation) {
    return "_" + key.toSnakeCase() + "_" + relation.toSnakeCase() + "_pk";
  };

  /** private */
  sanitize = function (obj) {
    var isArray = Array.isArray(obj),
      ary = isArray ? obj : [obj],
      i = 0,
      oldObj,
      newObj,
      oldKey,
      newKey;

    while (i < ary.length) {

      /* Copy to convert dates back to string for accurate comparisons */
      oldObj = JSON.parse(JSON.stringify(ary[i]));
      newObj = {};

      for (oldKey in oldObj) {
        if (oldObj.hasOwnProperty(oldKey)) {

          /* Remove internal properties */
          if (oldKey.match("^_")) {
            delete oldObj[oldKey];
          } else {
            /* Make properties camel case */
            newKey = oldKey.toCamelCase();
            newObj[newKey] = oldObj[oldKey];

            /* Recursively sanitize objects */
            if (typeof newObj[newKey] === "object") {
              newObj[newKey] = newObj[newKey] ? sanitize(newObj[newKey]) : {};
            }
          }
        }
      }
      ary[i] = newObj;

      i++;
    }

    return isArray ? ary : ary[0];
  };

  /** private */
  setCurrentUser = function (user) {
    currentUser = user;
  };
}(exports));


