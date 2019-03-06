import { CancellationTokenLike, DisposableLike, FinancialLike, TaskLike } from "@zxteam/contract";

export type SqlStatementParam = boolean | string | number | Date | Uint8Array | FinancialLike
	| Array<string> | Array<number> | Array<Date> | Array<Uint8Array> | Array<FinancialLike>;

export interface SqlDataLike {
	readonly asBoolean: boolean;
	readonly asNullableBoolean: boolean | null;
	readonly asString: string;
	readonly asNullableString: string | null;
	readonly asNumber: number;
	readonly asNullableNumber: number | null;
	readonly asFinancial: FinancialLike;
	readonly asNullableFinancial: FinancialLike | null;
	readonly asDate: Date;
	readonly asNullableDate: Date | null;
	readonly asBinary: Uint8Array;
	readonly asNullableBinary: Uint8Array | null;
}

export interface SqlProviderLike extends DisposableLike {
	statement(sql: string): SqlStatementLike;
	createTempTable(cancellationToken: CancellationTokenLike | null, tableName: string, columnsDefinition: string): Promise<DisposableLike>;
}

export interface SqlResultRecordLike {
	get(name: string): SqlDataLike;
	get(index: number): SqlDataLike;
}

// export interface SqlResultSet extends IEnumerator<SqlResultRecord>, DisposableLike {
// }

export interface SqlStatementLike {
	execute(cancellationToken: CancellationTokenLike | null, ...values: Array<SqlStatementParam>): TaskLike<void>;
	executeQuery(cancellationToken: CancellationTokenLike | null, ...values: Array<SqlStatementParam>): TaskLike<Array<SqlResultRecordLike>>;
	//executeQueryLazy(cancellationToken: CancellationTokenLike | null, ...values: Array<SqlStatementParam>): Promise<SqlResultSet>;
	executeScalar(cancellationToken: CancellationTokenLike | null, ...values: Array<SqlStatementParam>): TaskLike<SqlDataLike>;
}
