Featherbone
===========
A JavaScript based persistence framework for building object relational database applications.

# Prerequisites
* [PostgreSQL v10.7](http://www.postgresql.org/)
* [NodeJS v10.15.3](https://nodejs.org/en/)
  
# Install

On the first install you will need to pass credentials of a postgres superuser that can create the database, if applicable, and grant permissions to your adminstrative service user defined [here](https://github.com/jrogelstad/featherbone/blob/master/server/config.json).

Clone this repository and from the cloned location:

```text
$ npm install
$ node install --username postgres --password <your password>
$ node server
```

From your browser navigate to <http://localhost:10001> to run the application. Use the same username and password as specified as in your PostgreSQL [configuration](https://github.com/jrogelstad/featherbone/blob/master/server/config.json) service user ("admin"/"password" by default) to sign in.

An additional example module may be loaded [here](https://github.com/jrogelstad/cardinal)

A documentation server may be installed from [here](https://github.com/jrogelstad/featherbone-docs)
