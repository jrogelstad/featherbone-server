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
/*jslint this, browser*/
/**
   @module WorkbookPage
*/
import f from "../core.js";
import icons from "../icons.js";

const catalog = f.catalog();
const datasource = f.datasource();
const workbookPage = {};
const m = window.m;
const console = window.console;
const jsonpatch = window.jsonpatch;
const editWorkbookConfig = {
    tabs: [{
        name: "Definition"
    }, {
        name: "Authorizations"
    }],
    attrs: [{
        attr: "name",
        grid: 1
    }, {
        attr: "description",
        grid: 1
    }, {
        attr: "icon",
        dataList: icons,
        grid: 1
    }, {
        attr: "sequence",
        grid: 1
    }, {
        attr: "module",
        dataList: "modules",
        grid: 1
    }, {
        attr: "authorizations",
        showLabel: false,
        height: "98px",
        grid: 2,
        columns: [{
            attr: "role"
        }, {
            label: "Read",
            attr: "canRead",
            width: 60
        }, {
            label: "Update",
            attr: "canUpdate",
            width: 60
        }]
    }]
};

const editSheetConfig = {
    tabs: [{
        name: "Sheet"
    }, {
        name: "Columns"
    }, {
        name: "Actions"
    }],
    attrs: [{
        attr: "name",
        grid: 1
    }, {
        attr: "feather",
        grid: 1
    }, {
        attr: "openInNewWindow",
        label: "Open in new tab",
        grid: 1
    }, {
        attr: "form",
        grid: 1
    }, {
        attr: "isEditModeEnabled",
        label: "Enable edit mode",
        grid: 1
    }, {
        attr: "columns",
        showLabel: false,
        height: "139px",
        grid: 2,
        columns: [{
            attr: "attr",
            label: "Column",
            width: 165
        }, {
            attr: "label",
            width: 165
        }]
    }, {
        attr: "actions",
        showLabel: false,
        height: "139px",
        grid: 3,
        columns: [{
            attr: "name",
            width: 165
        }, {
            attr: "title",
            width: 165
        }, {
            attr: "icon",
            width: 165
        }, {
            attr: "method",
            width: 165
        }, {
            attr: "validator",
            width: 165
        }]
    }]
};

let profileInvalid = false;

function saveProfile(name, config, dlg) {
    let oldProfile = catalog.store().data().profile();
    let newProfile = f.copy(oldProfile);
    let patch;

    function callback(resp) {
        newProfile.etag = resp;
        catalog.store().data().profile(newProfile);
    }

    if (profileInvalid) {
        return;
    }

    if (oldProfile) {
        if (!newProfile.data.workbooks) {
            newProfile.data.workbooks = {};
        }

        if (config) {
            newProfile.data.workbooks[name] = f.copy(config);
        } else {
            delete newProfile.data.workbooks[name];
        }
        patch = jsonpatch.compare(oldProfile.data, newProfile.data);
        if (patch && patch.length) {
            datasource.request({
                method: "PATCH",
                path: "/profile",
                body: {
                    etag: oldProfile.etag,
                    patch: patch
                }
            }).then(callback).catch(function (err) {
                profileInvalid = true;
                dlg.message(err.message);
                dlg.icon("window-close");
                dlg.buttonCancel().hide();
                dlg.show();
            });
        }
    } else if (config) {
        newProfile = {data: {workbooks: {}}};
        newProfile.data.workbooks[name] = f.copy(config);
        datasource.request({
            method: "PUT",
            path: "/profile",
            body: newProfile.data
        }).then(callback);
    }
}

/**
    Define workbook view model
    @class WorkbookPage
    @constructor
    @namespace ViewModels
    @param {Object} options
    @param {String} options.workbook name
    @param {String} options.page worksheet name
*/
workbookPage.viewModel = function (options) {
    let listState;
    let tableState;
    let searchState;
    let currentSheet;
    let feather;
    let sseState = catalog.store().global().sseState;
    let workbook = catalog.store().workbooks()[
        options.workbook.toCamelCase()
    ];

    if (!workbook) {
        m.route.set("/home");
        options.isInvalid = true;
        return;
    }

    let config = workbook.getConfig();
    let the_sheet = config.find(function (sheet) {
        return sheet.name.toSpinalCase() === options.page;
    });

    if (!the_sheet) {
        m.route.set("/home");
        options.isInvalid = true;
        return;
    }

    let sheetId = the_sheet.id;
    let receiverKey = f.createId();
    let vm = {};
    let toolbarButtonClass = "fb-toolbar-button";
    let formWorkbookClass = "fb-form-workbook";
    let sheetEditModel = f.createModel("Worksheet");

    switch (f.currentUser().mode) {
    case "test":
        toolbarButtonClass += " fb-toolbar-button-test";
        formWorkbookClass += " fb-form-workbook-test";
        break;
    case "dev":
        toolbarButtonClass += " fb-toolbar-button-dev";
        formWorkbookClass += " fb-form-workbook-dev";
        break;
    }

    // ..........................................................
    // PUBLIC
    //

    /**
        @method aggregateDialog
        @param {ViewModels.TableDialog} dialog
        @return {ViewModels.TableDialog}
    */
    vm.aggregateDialog = f.prop();
    /**
        @method buttonAggregate
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonAggregate = f.prop();
    /**
        @method buttonClear
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonClear = f.prop();
    /**
        @method buttonDelete
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonDelete = f.prop();
    /**
        @method buttonEdit
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonEdit = f.prop();
    /**
        @method buttonFilter
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonFilter = f.prop();
    /**
        @method buttonNew
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonNew = f.prop();
    /**
        @method buttonRefresh
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonRefresh = f.prop();
    /**
        @method buttonSave
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonSave = f.prop();
    /**
        @method buttonSort
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonSort = f.prop();
    /**
        @method buttonUndo
        @param {ViewModels.Button} button
        @return {ViewModels.Button}
    */
    vm.buttonUndo = f.prop();
    /**
        Layout configuration.
        @method config
        @param {Object} config
        @return {Object}
    */
    vm.config = f.prop(config);
    /**
        @method confirmDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.confirmDialog = f.prop(f.createViewModel("Dialog", {
        icon: "question-circle",
        title: "Confirmation"
    }));
    /**
        Open worksheet configuration dialog.
        @method configureSheet
    */
    vm.configureSheet = function (e) {
        let dlg = vm.sheetConfigureDialog();
        let sheet = vm.sheet(e.sheetId);
        let onCancel = vm.sheetConfigureDialog().onCancel();
        let data = {
            id: sheet.id,
            name: sheet.name,
            feather: sheet.feather,
            form: sheet.feather || "",
            isEditModeEnabled: sheet.isEditModeEnabled,
            openInNewWindow: sheet.openInNewWindow,
            actions: sheet.actions || [],
            columns: sheet.list.columns || []
        };

        sheetEditModel.set(data, true, true);
        sheetEditModel.state().send("fetched");
        vm.sheetConfigureDialog().onCancel(function () {
            if (onCancel) {
                onCancel();
            }
            sheetEditModel.state().send("clear");
        });
        vm.sheetConfigureDialog().onOk = function () {
            data = sheetEditModel.toJSON();
            sheetEditModel.state().send("clear");

            // Update sheet with new values
            sheet.name = data.name;
            sheet.feather = data.feather;
            sheet.form = data.form;
            sheet.isEditModeEnabled = data.isEditModeEnabled;
            sheet.openInNewWindow = data.openInNewWindow;
            sheet.list.columns.length = 0;
			sheet.actions = sheet.actions || [];
            sheet.actions.length = 0;
            data.columns.forEach(function (d) {
                if (d === undefined) { // Deleted
                    return;
                }
                sheet.list.columns.push({
                    attr: d.attr,
                    label: d.label,
                    width: d.width
                });
            });
            data.actions.forEach(function (d) {
                if (d === undefined) { // Deleted
                    return;
                }
                sheet.actions.push({
                    name: d.name,
                    title: d.title,
                    icon: d.icon,
                    method: d.method,
                    validator: d.validator
                });
            });

            if (data.isEditModeEnabled) {
                vm.buttonEdit().enable();
            } else {
                vm.buttonEdit().disable();
            }

            vm.saveProfile();
        };
        dlg.show();
    };
    /**
        @method footerId
        @param {String} id
        @return {String}
    */
    vm.footerId = f.prop(f.createId());
    /**
        Drop event handler for deleting sheets.
        @method deleteSheet
        @param {Event} event
    */
    vm.deleteSheet = function (ev) {
        let doDelete;
        let idx = ev.dataTransfer.getData("text") - 0;
        let confirmDialog = vm.confirmDialog();

        doDelete = function () {
            let activeSheetId = vm.sheet().id;
            let deleteSheetId = vm.config()[idx].id;

            vm.config().splice(idx, 1);
            if (activeSheetId === deleteSheetId) {
                if (idx === vm.config().length) {
                    idx -= 1;
                }
                vm.tabClicked(config[idx].name);
            }
            vm.saveProfile();
        };

        confirmDialog.message(
            "Are you sure you want to delete this sheet?"
        );
        confirmDialog.icon("question-circle");
        confirmDialog.onOk(doDelete);
        confirmDialog.show();
    };
    /**
        Editor dialog for workbook.
        @method editWorkbookDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.editWorkbookDialog = f.prop();
    /**
        @method filter
        @param {Filter} filter
        @return {Filter}
    */
    vm.filter = f.prop();
    /**
        @method filterDialog
        @param {ViewModels.FilterDialog} dialog
        @return {ViewModels.FilterDialog}
    */
    vm.filterDialog = f.prop();
    /**
        @method goHome
    */
    vm.goHome = function () {
        m.route.set("/home");
    };
    /**
        @method goSignOut
    */
    vm.goSignOut = function () {
        f.state().send("signOut");
    };
    /**
        @method goSettings
    */
    vm.goSettings = function () {
        m.route.set("/settings/:settings", {
            settings: workbook.data.launchConfig().settings
        });
    };
    /**
        @method isDraggingTab
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.isDraggingTab = f.prop(false);
    /**
        @method hasSettings
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.hasSettings = f.prop(
        Boolean(workbook.data.launchConfig().settings)
    );
    /**
        Create a new model in form, tab or row depending on state.
        @method modelNew
    */
    vm.modelNew = function () {
        let form = vm.sheet().form || {};
        let url;
        let win;

        if (vm.sheet().openInNewWindow) {
            url = (
                window.location.protocol + "//" +
                window.location.hostname + ":" +
                window.location.port + "#!/edit/" +
                feather.name.toSpinalCase() + "/" +
                f.createId()
            );

            win = window.open(url);
            win.options = {
                form: form.id,
                create: true,
                isNewWindow: true
            };
            win.receiver = function (model) {
                // If model came from other window now closed it's
                // unstable, so rebuild it
                let nmodel = f.createModel(model.name, model.toJSON());

                nmodel.state().goto("/Ready/Fetched/Clean");
                nmodel.checkDelete();
                nmodel.checkUpdate();
                vm.tableWidget().models().add(nmodel, true);
                m.redraw();
            };
            return;
        }

        if (!vm.tableWidget().modelNew()) {
            m.route.set("/edit/:feather/:key", {
                feather: feather.name.toSpinalCase(),
                key: f.createId()
            }, {
                state: {
                    form: form.id,
                    receiver: receiverKey,
                    create: true
                }
            });
        }
    };
    /**
        Open model in form.
        @method openModel
    */
    vm.modelOpen = function () {
        let selection = vm.tableWidget().selection();
        let sheet = vm.sheet() || {};
        let form = sheet.form || {};
        let type = vm.tableWidget().model().data.objectType();
        let url;
        let win;

        if (vm.sheet().openInNewWindow) {
            url = (
                window.location.protocol + "//" +
                window.location.hostname + ":" +
                window.location.port + "#!/edit/" + type + "/" +
                selection.id()
            );

            win = window.open(url);
            win.options = {
                form: form.id,
                isNewWindow: true
            };
            return;
        }

        if (selection) {
            m.route.set("/edit/:feather/:key", {
                feather: type,
                key: selection.id()
            }, {
                state: {
                    form: form.id,
                    receiver: receiverKey
                }
            });
        }
    };
    /**
        @method menu
        @param {ViewModels.NavigatorMenu} navigator
        @return {ViewModels.NavigatorMenu}
    */
    vm.menu = f.prop(f.createViewModel("NavigatorMenu"));
    /**
        Add a new sheet to the workbook.
        @method newSheet
    */
    vm.newSheet = function () {
        let undo;
        let newSheet;
        let sheetName;
        let next;
        let dialogSheetConfigure = vm.sheetConfigureDialog();
        let id = f.createId();
        let sheets = vm.sheets();
        let sheet = f.copy(vm.sheet());
        let i = 0;

        while (!sheetName) {
            i += 1;
            next = "Sheet" + i;
            if (sheets.indexOf(next) === -1) {
                sheetName = next;
            }
        }

        i = 0;

        newSheet = {
            id: id,
            name: sheetName,
            feather: sheet.feather,
            list: {
                columns: sheet.list.columns
            },
            actions: []
        };

        undo = function () {
            vm.config().pop();
            dialogSheetConfigure.onCancel(undefined);
        };

        vm.config().push(newSheet);
        dialogSheetConfigure.onCancel(undo);
        vm.configureSheet({sheetId: id});
    };
    /**
        @method ondragend
    */
    vm.ondragend = function () {
        vm.isDraggingTab(false);
    };
    /**
        @method ondragover
        @param {Event} event
    */
    vm.ondragover = function (ev) {
        ev.preventDefault();
    };
    /**
        @method ondragstart
        @param {Integer} index
        @param {Event} event
    */
    vm.ondragstart = function (idx, ev) {
        vm.isDraggingTab(true);
        ev.dataTransfer.setData("text", idx);
    };
    /**
        @method ondrop
        @param {Integer} index
        @param {Array} ary
        @param {Event} event
    */
    vm.ondrop = function (toIdx, ary, ev) {
        let moved;
        let fromIdx;

        ev.preventDefault();
        fromIdx = ev.dataTransfer.getData("text") - 0;
        if (fromIdx !== toIdx) {
            moved = ary.splice(fromIdx, 1)[0];
            ary.splice(toIdx, 0, moved);
            vm.saveProfile();
        }
        vm.isDraggingTab(false);
    };
    /**
        Handle keyboard up and down keys.
        @method onkeydown
        @param {Event} event
    */
    vm.onkeydown = function (ev) {
        let key = ev.key || ev.keyIdentifier;

        switch (key) {
        case "Up":
        case "ArrowUp":
            vm.tableWidget().goPrevRow();
            break;
        case "Down":
        case "ArrowDown":
            vm.tableWidget().goNextRow();
            break;
        }
    };
    /**
        Handle on click of actions menu.
        @method onclickactions
    */
    vm.onclickactions = function () {
        vm.showActions(true);
    };
    /**
        Hide actions menu if mouse out.
        @method onmouseoutactions
        @param {Event} event
    */
    vm.onmouseoutactions = function (ev) {
        if (
            !ev || !ev.toElement || !ev.toElement.id ||
            ev.toElement.id.indexOf("nav-actions") === -1
        ) {
            vm.showActions(false);
        }
    };
    /**
        Handle on click of workbook menu.
        @method onclickmenu
    */
    vm.onclickmenu = function () {
        vm.showMenu(!vm.showMenu());
    };
    /**
        Hide workbook menu if mouse out.
        @method onmouseoutactions
        @param {Event} event
    */
    vm.onmouseoutmenu = function (ev) {
        if (
            !ev || !ev.toElement || !ev.toElement.id ||
            ev.toElement.id.indexOf("nav-menu") === -1
        ) {
            vm.showMenu(false);
        }
    };
    /**
        Requery list.
        @method refresh
    */
    vm.refresh = function () {
        vm.tableWidget().refresh();
    };
    /**
        Revert selected model if dirty.
        @method revert
    */
    vm.revert = function () {
        saveProfile(workbook.data.name(), undefined, vm.confirmDialog());
        document.location.reload();
    };
    /**
        Save user workbook configuration to server.
        @method saveProfile
    */
    vm.saveProfile = function () {
        saveProfile(
            workbook.data.name(),
            vm.config(),
            vm.confirmDialog()
        );
    };
    /**
        @method searchInput
        @param {ViewModels.SearchInput} input
        @return {ViewModels.SearchInput}
    */
    vm.searchInput = f.prop();
    /**
        Make user's model configuration the new default.
        @method share
    */
    vm.share = function () {
        let doShare;
        let confirmDialog = vm.confirmDialog();

        doShare = function () {
            let d = f.copy(vm.config());
            workbook.data.localConfig(d);
            workbook.save();
        };

        confirmDialog.message(
            "Are you sure you want to share your workbook " +
            "configuration with all other users?"
        );
        confirmDialog.icon("question-circle");
        confirmDialog.onOk(doShare);
        confirmDialog.show();
    };
    /**
        Return sheet configuration. Passing `value` will set
        the sheet to the configuration of `value`.
        @method sheet
        @param {Object | String} id
        @param {Object} value
        @return {Object} sheet
    */
    vm.sheet = function (id, value) {
        let idx = 0;

        if (id) {
            if (typeof id === "object") {
                value = id;
                id = sheetId;
            }
        } else {
            id = sheetId;
        }

        if (currentSheet && currentSheet.id === id && !value) {
            return currentSheet;
        }

        config.some(function (item) {
            if (id === item.id) {
                return true;
            }
            idx += 1;
        });
        if (value) {
            vm.config().splice(idx, 1, value);
        }
        currentSheet = vm.config()[idx];

        return currentSheet;
    };
    /**
        Return an array of sheet names.
        @method sheets
        @return {Array}
    */
    vm.sheets = function () {
        return vm.config().map(function (sheet) {
            return sheet.name;
        });
    };
    /**
        @method sheetConfigureDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.sheetConfigureDialog = f.prop();
    /**
        @method showFilterDialog
    */
    vm.showFilterDialog = function () {
        if (vm.tableWidget().models().canFilter()) {
            vm.filterDialog().show();
        }
    };
    /**
        @method showActions
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.showActions = f.prop(false);
    /**
        @method showMenu
        @param {Boolean} flag
        @return {Boolean}
    */
    vm.showMenu = f.prop(false);
    /**
        @method showSortDialog
    */
    vm.showSortDialog = function () {
        if (vm.tableWidget().models().canFilter()) {
            vm.sortDialog().show();
        }
    };
    /**
        @method sortDialog
        @param {ViewModels.SortDialog} dialog
        @return {ViewModels.SortDialog}
    */
    vm.sortDialog = f.prop();
    /**
        Dialog for handling server side events.
        @method sseDialog
        @param {ViewModels.Dialog} dialog
        @return {ViewModels.Dialog}
    */
    vm.sseErrorDialog = f.prop(f.createViewModel("Dialog", {
        icon: "window-close",
        title: "Connection Error",
        message: (
            "You have lost connection to the server. " +
            "Click \"Ok\" to attempt to reconnect."
        ),
        onOk: function () {
            document.location.reload();
        }
    }));
    vm.sseErrorDialog().buttonCancel().hide();
    /**
        Navigate to sheet.
        @method tabClicked
        @param {String} name Sheet name
    */
	vm.tabClicked = function (sheet) {
		let wb = workbook.data.name().toSpinalCase();
		let pg = sheet.toSpinalCase();

		m.route.set("/workbook/:workbook/:page", {
			workbook: wb,
			page: pg,
			key: f.hashCode(wb + "-" + pg)
		});
	};
    /**
        @method tableWidget
        @param {ViewModels.TableWidget} widget
        @return {ViewModels.TableWidget}
    */
    vm.tableWidget = f.prop();
    /**
        @method workbook
        @return {Models.Workbook} dialog
    */
    vm.workbook = function () {
        return workbook;
    };
    /**
        @method zoom
        @param {Integer} percent
        @return {Integer}
    */
    vm.zoom = function (value) {
        let w = vm.tableWidget();
        if (value !== undefined) {
            w.zoom(value);
        }
        return w.zoom();
    };

    // ..........................................................
    // PRIVATE
    //
    feather = catalog.getFeather(vm.sheet().feather);

    // Register callback
    catalog.register("receivers", receiverKey, {
        callback: function (model) {
            let tableModel = vm.tableWidget().selection();

            if (!(tableModel && tableModel.id() === model.id())) {
                vm.tableWidget().models().add(model, true);
            }
        }
    });

    // Create search widget view model
    vm.searchInput(f.createViewModel("SearchInput", {
        refresh: vm.refresh
    }));

    // Create table widget view model
    vm.tableWidget(f.createViewModel("TableWidget", {
        class: formWorkbookClass,
        actions: vm.sheet().actions,
        config: vm.sheet().list,
        isEditModeEnabled: vm.sheet().isEditModeEnabled,
        feather: vm.sheet().feather,
        search: vm.searchInput().value,
        ondblclick: vm.modelOpen,
        subscribe: true,
        footerId: vm.footerId()
    }));

    // Watch when columns change and save profile
    vm.tableWidget().isDragging.state().resolve("/Changing").exit(function () {
        if (!vm.tableWidget().isDragging()) {
            vm.saveProfile();
        }
    });

    // Create dialog view models
    vm.filterDialog(f.createViewModel("FilterDialog", {
        filter: vm.tableWidget().filter,
        list: vm.tableWidget().models(),
        feather: feather,
        onOk: vm.saveProfile
    }));

    vm.editWorkbookDialog(f.createViewModel("FormDialog", {
        icon: "cogs",
        title: "Edit workbook",
        model: workbook,
        config: editWorkbookConfig
    }));
    vm.editWorkbookDialog().style().width = "475px";

    vm.editWorkbookDialog().buttons().push(
        f.prop(f.createViewModel("Button", {
            label: "Delete",
            onclick: function () {
                let dlg = vm.confirmDialog();
                dlg.message(
                    "This will permanently delete this workbook. Are you sure?"
                );
                dlg.icon("exclamation-triangle");
                dlg.onOk(function () {
                    let name = workbook.data.name();
                    name = name.toSpinalCase().toCamelCase();

                    function callback() {
                        catalog.unregister("workbooks", name);
                        vm.editWorkbookDialog().cancel();
                        m.route.set("/home");
                    }

                    workbook.delete(true).then(callback);
                });
                dlg.show();
            },
            class: "fb-button-delete"
        }))
    );
    if (!f.currentUser().isSuper) {
        vm.editWorkbookDialog().buttons()[2]().disable();
        vm.editWorkbookDialog().buttons()[2]().title(
            "Must be a super user to delete this workbook"
        );
    }

    vm.sheetConfigureDialog(f.createViewModel("FormDialog", {
        icon: "table",
        title: "Configure worksheet",
        model: sheetEditModel,
        config: editSheetConfig
    }));
    vm.sheetConfigureDialog().style().width = "520px";

    vm.aggregateDialog(f.createViewModel("AggregateDialog", {
        aggregates: vm.tableWidget().aggregates,
        list: vm.tableWidget().models(),
        feather: feather,
        onOk: function () {
            vm.refresh();
            vm.saveProfile();
        }
    }));

    vm.sortDialog(f.createViewModel("SortDialog", {
        filter: vm.tableWidget().filter,
        list: vm.tableWidget().models(),
        feather: feather,
        onOk: vm.saveProfile
    }));

    // Create button view models
    vm.buttonEdit(f.createViewModel("Button", {
        onclick: vm.tableWidget().toggleMode,
        title: "Edit mode",
        hotkey: "E",
        icon: "edit",
        class: toolbarButtonClass
    }));
    if (!vm.tableWidget().isEditModeEnabled()) {
        vm.buttonEdit().disable();
    }

    vm.buttonSave(f.createViewModel("Button", {
        onclick: vm.tableWidget().save,
        label: "&Save",
        icon: "cloud-upload-alt",
        class: toolbarButtonClass
    }));
    vm.buttonSave().hide();

    vm.buttonNew(f.createViewModel("Button", {
        onclick: vm.modelNew,
        label: "&New",
        icon: "plus-circle",
        class: toolbarButtonClass
    }));

    vm.buttonDelete(f.createViewModel("Button", {
        onclick: vm.tableWidget().modelDelete,
        label: "&Delete",
        icon: "trash",
        class: toolbarButtonClass
    }));
    vm.buttonDelete().disable();

    if (feather.isReadOnly) {
        vm.buttonNew().disable();
        vm.buttonNew().title("Table is read only");
        vm.buttonDelete().title("Table is read only");
    }

    vm.buttonUndo(f.createViewModel("Button", {
        onclick: vm.tableWidget().undo,
        label: "&Undo",
        icon: "undo",
        class: toolbarButtonClass
    }));
    vm.buttonUndo().hide();

    vm.buttonRefresh(f.createViewModel("Button", {
        onclick: vm.refresh,
        title: "Refresh",
        hotkey: "R",
        icon: "sync",
        class: toolbarButtonClass
    }));

    vm.buttonClear(f.createViewModel("Button", {
        onclick: vm.searchInput().clear,
        title: "Clear search",
        hotkey: "C",
        icon: "eraser",
        class: toolbarButtonClass
    }));
    vm.buttonClear().disable();

    vm.buttonSort(f.createViewModel("Button", {
        onclick: vm.showSortDialog,
        icon: "sort",
        hotkey: "T",
        title: "Sort results",
        class: toolbarButtonClass
    }));

    vm.buttonFilter(f.createViewModel("Button", {
        onclick: vm.showFilterDialog,
        icon: "filter",
        hotkey: "F",
        title: "Filter results",
        class: toolbarButtonClass
    }));

    vm.buttonAggregate(f.createViewModel("Button", {
        onclick: vm.aggregateDialog().show,
        icon: "calculator",
        title: "Calculate sum, count and other aggregations",
        class: toolbarButtonClass
    }));

    // Bind button states to list statechart events
    listState = vm.tableWidget().models().state();
    listState.resolve("/Fetched").enter(function () {
        let model = vm.tableWidget().selection();

        if (model && model.canUndo()) {
            vm.buttonDelete().hide();
            vm.buttonUndo().show();
            return;
        }

        vm.buttonDelete().show();
        vm.buttonUndo().hide();
    });
    listState.resolve("/Fetched/Clean").enter(function () {
        vm.buttonSave().disable();
    });
    listState.state().resolve("/Fetched/Dirty").enter(function () {
        vm.buttonSave().enable();
    });

    // Bind button states to search statechart events
    searchState = vm.searchInput().state();
    searchState.resolve("/Search/On").enter(function () {
        vm.buttonClear().enable();
    });
    searchState.resolve("/Search/Off").enter(function () {
        vm.buttonClear().disable();
    });

    // Bind buttons to table widget state change events
    tableState = vm.tableWidget().state();
    tableState.resolve("/Mode/View").enter(function () {
        vm.buttonEdit().deactivate();
        vm.buttonSave().hide();
    });
    tableState.resolve("/Mode/Edit").enter(function () {
        vm.buttonEdit().activate();
        vm.buttonSave().show();
    });
    tableState.resolve("/Selection/Off").enter(function () {
        vm.buttonDelete().disable();
        vm.buttonDelete().show();
        vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On/Clean").enter(function () {
        vm.buttonDelete().show();
        vm.buttonUndo().hide();
    });
    tableState.resolve("/Selection/On/Dirty").enter(function () {
        vm.buttonDelete().hide();
        vm.buttonUndo().show();
    });

    sseState.resolve("Error").enter(function () {
        vm.sseErrorDialog().show();
    });

    catalog.isAuthorized({
        feather: feather.name,
        action: "canCreate"
    }).then(function (canCreate) {
        if (!canCreate) {
            vm.buttonNew().disable();
            vm.buttonNew().title("Unauthorized");
        }
    }).catch(function (err) {
        console.error(err.message);
    });

    return vm;
};

/**
    Define workbook component.
    @class WorkbookPage
    @static
    @namespace Components
*/
workbookPage.component = {
    /**
        Must pass view model instance or options to build one.
        @method oninit
        @param {Object} [vnode] Virtual node
        @param {Object} [vnode.attrs] Options
        @param {String} [vnode.attrs.workbook] Workbook name
        @param {Object} [vnode.attrs.page] Worksheet name
        @param {String} [vnode.attrs.isInvalid] Passed if view model
        was determined invalid. View will return nothing.
    */
    oninit: function (vnode) {
        let workbook = vnode.attrs.workbook;
        let sheet = vnode.attrs.page;
        let viewModels = catalog.register("workbookViewModels");

        if (viewModels[workbook] && viewModels[workbook][sheet]) {
            this.viewModel = viewModels[workbook][sheet];
            return;
        }

        this.viewModel = workbookPage.viewModel(vnode.attrs);

        if (vnode.attrs.isInvalid) {
            return; // Nothing to see here folks...
        }

        this.viewModel.menu().selected(workbook);

        // Memoize the model for total state persistence
        if (!viewModels[workbook]) {
            viewModels[workbook] = {};
        }

        viewModels[workbook][sheet] = this.viewModel;
    },

    /**
        @method onupdate
        @param {Object} vnode Virtual node
    */
    onupdate: function (vnode) {
        this.viewModel.menu().selected(vnode.attrs.workbook);
    },

    /**
        @method view
        @param {Object} vnode Virtual node
        @return {Object} view
    */
    view: function (vnode) {
        if (vnode.attrs.isInvalid) {
            return; // Nothing to see here folks...
        }

        let filterMenuClass;
        let tabs;
        let vm = this.viewModel;
        let createTabClass = "pure-button fb-workbook-tab-edit";
        let deleteTabClass = "pure-button fb-workbook-tab-edit";
        let activeSheet = vm.sheet();
        let config = vm.config();
        let idx = 0;
        let btn = f.getComponent("Button");
        let srtdlg = f.getComponent("SortDialog");
        let fltdlg = f.getComponent("FilterDialog");
        let frmdlg = f.getComponent("FormDialog");
        let aggdlg = f.getComponent("AggregateDialog");
        let srch = f.getComponent("SearchInput");
        let tw = f.getComponent("TableWidget");
        let dlg = f.getComponent("Dialog");
        let nav = f.getComponent("NavigatorMenu");
        let menu = f.getComponent("AccountMenu");
        let toolbarClass = "fb-toolbar";
        let menuButtonClass = "fb-menu-button";

        switch (f.currentUser().mode) {
        case "test":
            toolbarClass += " fb-toolbar-test";
            menuButtonClass += " fb-menu-button-test";
            break;
        case "dev":
            toolbarClass += " fb-toolbar-dev";
            menuButtonClass += " fb-menu-button-dev";
            break;
        }

        if (vm.tableWidget().selections().some((s) => s.canDelete())) {
            vm.buttonDelete().enable();
        } else {
            vm.buttonDelete().disable();
        }

        // Build tabs
        tabs = vm.sheets().map(function (sheet) {
            let tab;
            let tabOpts;

            // Build tab
            tabOpts = {
                class: (
                    "fb-workbook-tab pure-button" + (
                        activeSheet.name.toName() === sheet.toName()
                        ? " pure-button-primary"
                        : ""
                    )
                ),
                onclick: vm.tabClicked.bind(this, sheet)
            };

            if (vm.config().length > 1) {
                tabOpts.ondragover = vm.ondragover;
                tabOpts.draggable = true;
                tabOpts.ondragstart = vm.ondragstart.bind(this, idx);
                tabOpts.ondrop = vm.ondrop.bind(this, idx, config);
                tabOpts.ondragend = vm.ondragend;
                tabOpts.class += " fb-workbook-tab-draggable";
            }

            tab = m("button[type=button]", tabOpts, sheet.toName());
            idx += 1;

            return tab;
        });

        // Create/delete tab buttons
        if (vm.isDraggingTab()) {
            createTabClass += " fb-workbook-tab-edit-hide";
            deleteTabClass += " fb-workbook-tab-edit-show";
        } else {
            createTabClass += " fb-workbook-tab-edit-show";
            deleteTabClass += " fb-workbook-tab-edit-hide";
        }

        tabs.push(m("button[type=button]", {
            class: createTabClass,
            title: "Add sheet",
            onclick: vm.newSheet
        }, [m("i", {
            class: "fa fa-plus"
        })]));

        // Delete target
        tabs.push(m("div", {
            class: deleteTabClass,
            ondragover: vm.ondragover,
            ondrop: vm.deleteSheet
        }, [m("i", {
            class: "fa fa-trash"
        })]));

        // Finally assemble the whole view
        filterMenuClass = "pure-menu-link";
        if (!vm.tableWidget().models().canFilter()) {
            filterMenuClass += " pure-menu-disabled";
        }

        return m("div", {
            class: "pure-form",
            oncreate: function () {
                let title = vm.sheet().name.toName();
                document.getElementById("fb-title").text = title;
            }
        }, [
            m(srtdlg, {
                viewModel: vm.sortDialog()
            }),
            m(fltdlg, {
                viewModel: vm.filterDialog()
            }),
            m(aggdlg, {
                viewModel: vm.aggregateDialog()
            }),
            m(frmdlg, {
                viewModel: vm.editWorkbookDialog()
            }),
            m(frmdlg, {
                viewModel: vm.sheetConfigureDialog()
            }),
            m(dlg, {
                viewModel: vm.confirmDialog()
            }),
            m(dlg, {
                viewModel: vm.sseErrorDialog()
            }),
            m("div", {
                class: "fb-navigator-menu-container"
            }, [
                m(nav, {
                    viewModel: vm.menu()
                }),
                m("div", [
                    m("div", {
                        id: "toolbar",
                        class: toolbarClass,
                        onkeydown: vm.onkeydown
                    }, [
                        m(btn, {
                            viewModel: vm.buttonEdit()
                        }),
                        m(btn, {
                            viewModel: vm.buttonSave()
                        }),
                        m(btn, {
                            viewModel: vm.buttonNew()
                        }),
                        m(btn, {
                            viewModel: vm.buttonDelete()
                        }),
                        m(btn, {
                            viewModel: vm.buttonUndo()
                        }),
                        m("div", {
                            id: "nav-actions-div",
                            class: (
                                "pure-menu " +
                                "custom-restricted-width " +
                                "fb-menu"
                            ),
                            onclick: vm.onclickactions,
                            onmouseout: vm.onmouseoutactions
                        }, [
                            m("span", {
                                id: "nav-actions-button",
                                class: (
                                    "pure-button " +
                                    "fa fa-bolt " +
                                    menuButtonClass
                                )
                            }),
                            m("ul", {
                                id: "nav-actions-list",
                                class: (
                                    "pure-menu-list fb-menu-list" + (
                                        vm.showActions()
                                        ? " fb-menu-list-show"
                                        : ""
                                    )
                                )
                            }, vm.tableWidget().actions())
                        ]),
                        m("div", {
                            class: "fb-toolbar-spacer"
                        }),
                        m(btn, {
                            viewModel: vm.buttonRefresh()
                        }),
                        m(srch, {
                            viewModel: vm.searchInput()
                        }),
                        m(btn, {
                            viewModel: vm.buttonClear()
                        }),
                        m(btn, {
                            viewModel: vm.buttonSort()
                        }),
                        m(btn, {
                            viewModel: vm.buttonFilter()
                        }),
                        m(btn, {
                            viewModel: vm.buttonAggregate()
                        }),
                        m("div", {
                            id: "nav-menu-div",
                            class: (
                                "pure-menu " +
                                "custom-restricted-width " +
                                "fb-menu fb-menu-setup"
                            ),
                            onclick: vm.onclickmenu,
                            onmouseout: vm.onmouseoutmenu
                        }, [
                            m("span", {
                                id: "nav-meun-button",
                                class: (
                                    "pure-button " +
                                    "fa fa-list " +
                                    menuButtonClass
                                )
                            }),
                            m("ul", {
                                id: "nav-menu-list",
                                class: (
                                    "pure-menu-list fb-menu-list " +
                                    "fb-menu-list-setup" + (
                                        vm.showMenu()
                                        ? " fb-menu-list-show"
                                        : ""
                                    )
                                )
                            }, [
                                m("li", {
                                    id: "nav-menu-configure-worksheet",
                                    class: "pure-menu-link",
                                    title: "Configure current worksheet",
                                    onclick: vm.configureSheet
                                }, [m("i", {
                                    id: "nav-menu-configure-worksheet-icon",
                                    class: "fa fa-table  fb-menu-list-icon"
                                })], "Sheet"),
                                m("li", {
                                    id: "nav-menu-configure-workbook",
                                    class: "pure-menu-link",
                                    title: "Configure current workbook",
                                    onclick: vm.editWorkbookDialog().show
                                }, [m("i", {
                                    id: "nav-menu-configure-workbook-icon",
                                    class: "fa fa-cogs  fb-menu-list-icon"
                                })], "Workbook"),
                                m("li", {
                                    id: "nav-menu-share",
                                    class: (
                                        "pure-menu-link " + (
                                            vm.workbook().canUpdate()
                                            ? ""
                                            : " pure-menu-disabled"
                                        )
                                    ),
                                    title: "Share workbook configuration",
                                    onclick: vm.share
                                }, [m("i", {
                                    id: "nav-menu-share-icon",
                                    class: (
                                        "fa fa-share-alt " +
                                        "fb-menu-list-icon"
                                    )
                                })], "Share"),
                                m("li", {
                                    id: "nav-menu-revert",
                                    class: "pure-menu-link",
                                    title: (
                                        "Revert workbook configuration " +
                                        "to original state"
                                    ),
                                    onclick: vm.revert
                                }, [m("i", {
                                    id: "nav-menu-revert-icon",
                                    class: "fa fa-reply fb-menu-list-icon"
                                })], "Revert"),
                                m("li", {
                                    id: "nav-menu-settings",
                                    class: (
                                        "pure-menu-link " +
                                        "fb-menu-list-separator" + (
                                            vm.hasSettings()
                                            ? ""
                                            : " pure-menu-disabled"
                                        )
                                    ),
                                    title: "Change module settings",
                                    onclick: vm.goSettings
                                }, [m("i", {
                                    id: "nav-menu-settings-icon",
                                    class: "fa fa-wrench fb-menu-list-icon"
                                })], "Settings")
                            ])
                        ]),
                        m(menu)
                    ]),
                    m(tw, {
                        viewModel: vm.tableWidget()
                    }),
                    m("div", {
                        id: vm.footerId()
                    }, [
                        tabs,
                        m("i", {
                            class: (
                                "fa fa-search-plus " +
                                "fb-zoom-icon fb-zoom-right-icon"
                            )
                        }),
                        m("input", {
                            class: "fb-zoom-control",
                            title: "Zoom " + vm.zoom() + "%",
                            type: "range",
                            step: "5",
                            min: "50",
                            max: "150",
                            value: vm.zoom(),
                            oninput: (e) => vm.zoom(e.target.value)
                        }),
                        m("i", {
                            class: (
                                "fa fa-search-minus " +
                                "fb-zoom-icon fb-zoom-left-icon"
                            )
                        })
                    ])
                ])
            ])
        ]);
    }
};

catalog.register("components", "workbookPage", workbookPage.component);

export default Object.freeze(workbookPage);