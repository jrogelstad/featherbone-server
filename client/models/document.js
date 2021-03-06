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
/*jslint browser*/
import catalog from "./catalog.js";
import f from "../core.js";

function doc(data, feather) {
    if (data === undefined) {
        data = {
            owner: f.currentUser().name
        };
    } else if (data.owner === undefined) {
        data.owner = f.currentUser().name;
    }
    feather = feather || catalog.getFeather("Document");
    let model = f.createModel(data, feather);
    let d = model.data;

    function handleReadOnly() {
        let user = f.currentUser();

        d.owner.isReadOnly(
            d.owner() !== user.name &&
            !user.isSuper
        );
    }

    model.onLoad(handleReadOnly);

    return model;
}

catalog.registerModel("Document", doc);
