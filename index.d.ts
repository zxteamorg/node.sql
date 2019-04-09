import { CancellationToken, Disposable, Factory, Financial, Task } from "@zxteam/contract";

export interface SqlProviderFactory extends Factory<SqlProvider> {
}

export interface EmbeddedSqlProviderFactory extends SqlProviderFactory {
	/**
	 * Check if a Database exists
	 * @param cancellationToken Cancellation Token allows your to cancel execution process
	 */
	isDatabaseExists(cancellationToken: CancellationToken): Task<boolean>;

	/**
	 * Setup new database
	 * @param cancellationToken Cancellation Token allows your to cancel execution process
	 * @param location URL location to new database
	 * @param initScriptUrl URL location to init SQL script. Currently supported file:// and http(s):// schemas.
	 */
	newDatabase(cancellationToken: CancellationToken, initScriptUrl?: URL): Task<void>;
}

export type SqlStatementParam =
	null | boolean | string | number | Financial | Date | Uint8Array
	| Array<string> | Array<number> | Array<Financial> | Array<Date> | Array<Uint8Array>;

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
	statement(sql: string): SqlStatement;
	createTempTable(cancellationToken: CancellationToken, tableName: string, columnsDefinitions: string): Task<SqlTemporaryTable>;
}

export interface SqlResultRecord {
	get(name: string): SqlData;
	get(index: number): SqlData;
}

// export interface SqlResultSet extends IEnumerator<SqlResultRecord>, Disposable {
// }

export interface SqlStatement {
	execute(cancellationToken: CancellationToken, ...values: Array<SqlStatementParam>): Task<void>;
	executeQuery(cancellationToken: CancellationToken, ...values: Array<SqlStatementParam>): Task<Array<SqlResultRecord>>;
	//executeQueryLazy(cancellationToken: CancellationToken, ...values: Array<SqlStatementParam>): Task<SqlResultSet>;
	executeQueryMultiSets(cancellationToken: CancellationToken, ...values: Array<SqlStatementParam>): Task<Array<Array<SqlResultRecord>>>;
	//executeQueryMultiSetsLazy(cancellationToken: CancellationToken, ...values: Array<SqlStatementParam>): Task<Array<Array<SqlResultRecord>>>;
	executeScalar(cancellationToken: CancellationToken, ...values: Array<SqlStatementParam>): Task<SqlData>;
}

export interface SqlTemporaryTable extends Disposable {
	bulkInsert(cancellationToken: CancellationToken, bulkValues: Array<Array<SqlStatementParam>>): Task<void>;
	crear(cancellationToken: CancellationToken): Task<void>;
	insert(cancellationToken: CancellationToken, values: Array<SqlStatementParam>): Task<void>;
}
