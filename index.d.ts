import * as zxteam from "@zxteam/contract";

export interface SqlProviderFactory extends zxteam.Factory<SqlProvider> {
}

export interface EmbeddedSqlProviderFactory extends SqlProviderFactory {
	/**
	 * Check if a Database exists
	 * @param cancellationToken Cancellation Token allows your to cancel execution process
	 */
	isDatabaseExists(cancellationToken: zxteam.CancellationToken): zxteam.Task<boolean>;

	/**
	 * Setup new database
	 * @param cancellationToken Cancellation Token allows your to cancel execution process
	 * @param location URL location to new database
	 * @param initScriptUrl URL location to init SQL script. Currently supported file:// and http(s):// schemas.
	 */
	newDatabase(cancellationToken: zxteam.CancellationToken, initScriptUrl?: URL): zxteam.Task<void>;
}

export const enum SqlDialect {
	/**
	 * https://en.wikipedia.org/wiki/MySQL
	 */
	MySQL,
	/**
	 * https://en.wikipedia.org/wiki/PostgreSQL
	 */
	PostgreSQL,
	/**
	 * https://en.wikipedia.org/wiki/SQLite
	 */
	SQLite
}

export type SqlStatementParam =
	null | boolean | string | number | zxteam.Financial | Date | Uint8Array
	| Array<string> | Array<number> | Array<zxteam.Financial> | Array<Date> | Array<Uint8Array>;

export interface SqlData {
	readonly asBoolean: boolean;
	readonly asNullableBoolean: boolean | null;

	readonly asString: string;
	readonly asNullableString: string | null;

	readonly asInteger: number;
	readonly asNullableInteger: number | null;

	readonly asNumber: number;
	readonly asNullableNumber: number | null;

	readonly asFinancial: zxteam.Financial;
	readonly asNullableFinancial: zxteam.Financial | null;

	readonly asDate: Date;
	readonly asNullableDate: Date | null;

	readonly asBinary: Uint8Array;
	readonly asNullableBinary: Uint8Array | null;
}

export interface SqlProvider extends zxteam.Disposable {
	readonly dialect: SqlDialect;
	statement(sql: string): SqlStatement;
	createTempTable(cancellationToken: zxteam.CancellationToken, tableName: string, columnsDefinitions: string): zxteam.Task<SqlTemporaryTable>;
}

export interface SqlResultRecord {
	get(name: string): SqlData;
	get(index: number): SqlData;
}

// export interface SqlResultSet extends IEnumerator<SqlResultRecord>, Disposable {
// }

export interface SqlStatement {
	execute(cancellationToken: zxteam.CancellationToken, ...values: Array<SqlStatementParam>): zxteam.Task<void>;
	executeQuery(cancellationToken: zxteam.CancellationToken, ...values: Array<SqlStatementParam>): zxteam.Task<Array<SqlResultRecord>>;
	//executeQueryLazy(cancellationToken: zxteam.CancellationToken, ...values: Array<SqlStatementParam>): zxteam.Task<SqlResultSet>;
	executeQueryMultiSets(cancellationToken: zxteam.CancellationToken, ...values: Array<SqlStatementParam>): zxteam.Task<Array<Array<SqlResultRecord>>>;
	//executeQueryMultiSetsLazy(cancellationToken: zxteam.CancellationToken, ...values: Array<SqlStatementParam>): Task<Array<Array<SqlResultRecord>>>;
	executeScalar(cancellationToken: zxteam.CancellationToken, ...values: Array<SqlStatementParam>): zxteam.Task<SqlData>;
}

export interface SqlTemporaryTable extends zxteam.Disposable {
	bulkInsert(cancellationToken: zxteam.CancellationToken, bulkValues: Array<Array<SqlStatementParam>>): zxteam.Task<void>;
	crear(cancellationToken: zxteam.CancellationToken): zxteam.Task<void>;
	insert(cancellationToken: zxteam.CancellationToken, values: Array<SqlStatementParam>): zxteam.Task<void>;
}
