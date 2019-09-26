import { CancellationToken, Disposable, Financial } from "@zxteam/contract";

export interface SqlProviderFactory {
	create(cancellationToken: CancellationToken): Promise<SqlProvider>;
}

export interface EmbeddedSqlProviderFactory extends SqlProviderFactory {
	/**
	 * Check if a Database exists
	 * @param cancellationToken Cancellation Token allows your to cancel execution process
	 */
	isDatabaseExists(cancellationToken: CancellationToken): Promise<boolean>;

	/**
	 * Setup new database
	 * @param cancellationToken Cancellation Token allows your to cancel execution process
	 * @param location URL location to new database
	 * @param initScriptUrl URL location to init SQL script. Currently supported file:// and http(s):// schemas.
	 */
	newDatabase(cancellationToken: CancellationToken, initScriptUrl?: URL): Promise<void>;
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
	null | boolean | string | number
	| Financial | Date | Uint8Array
	| ReadonlyArray<string> | ReadonlyArray<number>
	| ReadonlyArray<Financial> | ReadonlyArray<Date>
	| ReadonlyArray<Uint8Array>;

export interface SqlData {
	readonly asBoolean: boolean;
	readonly asNullableBoolean: boolean | null;

	readonly asString: string;
	readonly asNullableString: string | null;

	readonly asInteger: number;
	readonly asNullableInteger: number | null;

	readonly asNumber: number;
	readonly asNullableNumber: number | null;

	readonly asFinancial: Financial;
	readonly asNullableFinancial: Financial | null;

	readonly asDate: Date;
	readonly asNullableDate: Date | null;

	readonly asBinary: Uint8Array;
	readonly asNullableBinary: Uint8Array | null;
}

export interface SqlProvider extends Disposable {
	readonly dialect: SqlDialect;
	statement(sql: string): SqlStatement;
	createTempTable(cancellationToken: CancellationToken, tableName: string, columnsDefinitions: string): Promise<SqlTemporaryTable>;
}

export interface SqlResultRecord {
	get(name: string): SqlData;
	get(index: number): SqlData;
}

// export interface SqlResultSet extends IEnumerator<SqlResultRecord>, Disposable {
// }

export interface SqlStatement {
	execute(cancellationToken: CancellationToken, ...values: Array<SqlStatementParam>): Promise<void>;
	executeQuery(cancellationToken: CancellationToken, ...values: Array<SqlStatementParam>): Promise<ReadonlyArray<SqlResultRecord>>;
	//executeQueryLazy(cancellationToken: CancellationToken, ...values: Array<SqlStatementParam>): Promise<SqlResultSet>;
	executeQueryMultiSets(cancellationToken: CancellationToken, ...values: Array<SqlStatementParam>): Promise<ReadonlyArray<ReadonlyArray<SqlResultRecord>>>;
	//executeQueryMultiSetsLazy(cancellationToken: CancellationToken, ...values: Array<SqlStatementParam>): Task<Array<Array<SqlResultRecord>>>;
	executeScalar(cancellationToken: CancellationToken, ...values: Array<SqlStatementParam>): Promise<SqlData>;
}

export interface SqlTemporaryTable extends Disposable {
	bulkInsert(cancellationToken: CancellationToken, bulkValues: ReadonlyArray<ReadonlyArray<SqlStatementParam>>): Promise<void>;
	clear(cancellationToken: CancellationToken): Promise<void>;
	insert(cancellationToken: CancellationToken, values: ReadonlyArray<SqlStatementParam>): Promise<void>;
}
