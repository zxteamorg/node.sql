# ZXTeam's SQL Facade Contract 
[![npm version badge](https://img.shields.io/npm/v/@zxteam/sql.svg)](https://www.npmjs.com/package/@zxteam/sql)
[![downloads badge](https://img.shields.io/npm/dm/@zxteam/sql.svg)](https://www.npmjs.com/package/@zxteam/sql)
[![commit activity badge](https://img.shields.io/github/commit-activity/m/zxteamorg/node.sql)](https://github.com/zxteamorg/node.sql/pulse)
[![last commit badge](https://img.shields.io/github/last-commit/zxteamorg/node.sql)](https://github.com/zxteamorg/node.sql/graphs/commit-activity)
[![twitter badge](https://img.shields.io/twitter/follow/zxteamorg?style=social&logo=twitter)](https://twitter.com/zxteamorg)

The package declares TypeScript interfaces and error classes.

## API
### Interfaces
#### EmbeddedSqlProviderFactory
#### SqlProviderFactory
#### SqlData
#### SqlProvider
#### SqlResultRecord
#### SqlStatement
#### SqlTemporaryTable

### Enums

#### SqlDialect

### Types

#### SqlStatementParam

TBD


## Migration

The library provides general low-level approach to control database version. Each version bundle (directory) contains set of SQL files and scripts that provide install/rollback behavior. 

### Migration Directory layout
```
MyDatabase
├── v0001
│   ├── install
│   │   ├── 01-init.sql
│   │   ├── 50-migration.js
│   │   └── 99-finalize.sql
│   └── rollback
│       ├── drop-A.sql
│       ├── drop-B.sql
│       └── drop-C.sql
├── v0002
│   ├── install
│   │   ├── 01-init.sql
│   │   ├── 50-migration.js
│   │   └── 99-finalize.sql
│   └── rollback
│       ├── 10-drop-table-user.sql
│       └── 20-drop-table-group.sql
└── vXXXX
    ├── install
    │   ├── 01-init.sql
    │   ├── 50-migration.js
    │   └── 99-finalize.sql
    └── rollback
        ├── 1-drop-something.sql
        └── 2-drop-something.js
```

### Migration Components

* `MigrationSources` - JavaScript class provides lazy loader around set of SQL files and scripts. Main responsibility is read/write [Migration Directory Layout](#migration-directory-layout)
* `MigrationManager` - JavaScript class represents migration executor. Main responsibility install/rollback database versions.

#### MigrationSources

`MigrationSources` provides:

* Static methods for read sources from filesystem and networks
* Methods to transform content (for example: apply templating processor over SQL scripts)
* Methods to iterate through version bundles and files inside a version bundle
* Methods to save sources (for example: after transformation)

#### MigrationManager

`MigrationManager` works with your database in order to bring the database to the required version. Your database should have a techninal table where `MigrationManager` stores migration history. Migraton Algorithm is pretty straightforward.

!!!Note
	Version directories and migration files are sorted in ascending, ASCII character order.

##### Increment version

* `MigrationManager` detects current version of DB
* `MigrationManager` executes files `instal/*` on each version bundle (directory) unless target version(or latest version) is reached

##### Decrement version

* `MigrationManager` detects current version of DB
* `MigrationManager` executes files `rollback/*` on each-down version bundle (directory) unless target version(or latest version) is reached
