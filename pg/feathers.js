[
    {
        "name": "Role",
        "description": "User authorization role",
        "authorization": false,
        "properties": {
            "name": {
                "description": "Name",
                "type": "string"
            },
            "description": {
                "description": "Description",
                "type": "string"
            }
        }
    },
    {
        "name": "RoleMember",
        "description": "Member reference to a parent role",
        "authorization": false,
        "properties": {
            "parent": {
                "description": "Parent role",
                "type": {
                    "relation": "Role",
                    "childOf": "members"
                }
            },
            "member": {
                "description": "member",
                "type": "string"
            }
        }
    },
    {
        "name": "Folder",
        "description": "Container of parent objects",
        "authorization": false,
        "properties": {
            "owner": {
                "description": "Owner of the document",
                "type": "string",
                "defaultValue": "getCurrentUser()"
            },
            "name": {
                "description": "Name",
                "type": "string"
            },
            "description": {
                "description": "Description",
                "type": "string"
            }
        }
    },
    {
        "name": "Document",
        "description": "Base document class",
        "authorization": false,
        "properties": {
            "owner": {
                "description": "Owner of the document",
                "type": "string",
                "defaultValue": "getCurrentUser()"
            },
            "etag": {
                "description": "Optimistic locking key",
                "type": "string",
                "defaultValue": "createId()"
            }
        }
    },
    {
        "name": "Log",
        "description": "Feather for logging all schema and data changes",
        "authorization": false,
        "properties": {
            "objectId": {
                "description": "Object change was performed against",
                "type": "string"
            },
            "action": {
                "description": "Action performed",
                "type": "string"
            },
            "change": {
                "description": "Patch formatted json indicating changes",
                "type": "object"
            }
        }
    }
]
