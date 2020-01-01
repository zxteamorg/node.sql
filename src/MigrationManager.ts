import { CancellationToken, Logger } from "@zxteam/contract";
import { Initable } from "@zxteam/disposable";
import { InnerError, InvalidOperationError } from "@zxteam/errors";

import * as fs from "fs";
import { EOL } from "os";
import * as path from "path";
import { promisify } from "util";
import * as vm from "vm";

import { SqlProviderFactory, SqlProvider, SqlError } from "./index";

const existsAsync = promisify(fs.exists);
const readdirAsync = promisify(fs.readdir);
const readFileAsync = promisify(fs.readFile);

export abstract class MigrationManager extends Initable {
	private readonly _migrationFilesRootPath: string;
	private readonly _sqlProviderFactory: SqlProviderFactory;
	private readonly _log: Logger;
	private readonly _versionTableName: string;

	private _migrationData: MigrationManager.MigrationData | null;

	public constructor(opts: MigrationManager.Opts) {
		super();
		this._migrationFilesRootPath = opts.migrationFilesRootPath;
		this._sqlProviderFactory = opts.sqlProviderFactory;
		this._log = opts.log;
		this._versionTableName = opts.versionTableName !== undefined ? opts.versionTableName : "version";
		this._migrationData = null;
	}

	/**
	 * Make migration
	 * @param cancellationToken Allows to request cancel of the operation.
	 * @param targetVersion Optional target version. Will use latest version if omited.
	 */
	public async migrate(cancellationToken: CancellationToken, targetVersion?: string): Promise<void> {
		const currentVersion: string | null = await this.getCurrentVersion(cancellationToken);
		const availableVersions: Array<string> = Object.keys(this.migrationData).sort();
		let scheduleVersions: Array<string> = availableVersions;

		if (currentVersion !== null) {
			scheduleVersions = scheduleVersions.reduce<Array<string>>(function (p, c) { if (c > currentVersion) { p.push(c); } return p; }, []);
		}

		if (targetVersion !== undefined) {
			scheduleVersions = scheduleVersions.reduceRight<Array<string>>(function (p, c) {
				if (c <= targetVersion) { p.push(c); } return p;
			}, []);
		}

		await this.sqlProviderFactory.usingProvider(cancellationToken, async (sqlProvider: SqlProvider) => {
			if (!(await this._isVersionTableExist(cancellationToken, sqlProvider))) {
				await this._createVersionTable(cancellationToken, sqlProvider);
			}
		});

		for (const version of scheduleVersions) {
			await this.sqlProviderFactory.usingProviderWithTransaction(cancellationToken, async (sqlProvider: SqlProvider) => {
				const migrationLogger = new MigrationManager.MigrationLogger(this._log.getLogger(version));

				const migrationTuple = this.migrationData[version];

				if (migrationTuple.initSql !== null) {
					migrationLogger.debug("Execute initSql");
					await this.executeMigrationSql(cancellationToken, sqlProvider, migrationLogger, migrationTuple.initSql);
				} else {
					migrationLogger.debug("No initSql in this migration");
				}

				if (migrationTuple.migrationJavaScript !== null) {
					migrationLogger.debug("Execute migrationJavaScriptFile");
					migrationLogger.trace(EOL + migrationTuple.migrationJavaScript.content);
					await this.executeMigrationJavaScript(
						cancellationToken, sqlProvider, migrationLogger, migrationTuple.migrationJavaScript
					);
				} else {
					migrationLogger.debug("No migrationJavaScriptFile in this migration");
				}

				if (migrationTuple.finalizeSql !== null) {
					migrationLogger.debug("Execute finalizeSql");
					await this.executeMigrationSql(cancellationToken, sqlProvider, migrationLogger, migrationTuple.finalizeSql);
				} else {
					migrationLogger.debug("No finalizeSql in this migration");
				}

				const logText: string = migrationLogger.flush();
				this._insertVersionLog(cancellationToken, sqlProvider, version, logText);
			});
		}
	}

	/**
	 * Gets current version of the database or `null` if version table is not presented.
	 * @param cancellationToken Allows to request cancel of the operation.
	 */
	public abstract getCurrentVersion(cancellationToken: CancellationToken): Promise<string | null>;

	protected get sqlProviderFactory(): SqlProviderFactory { return this._sqlProviderFactory; }

	protected get log(): Logger { return this._log; }

	protected get migrationData(): MigrationManager.MigrationData {
		if (this._migrationData === null) {
			throw new InvalidOperationError("Wrong operation at current state. Did you call init()?");
		}
		return this._migrationData;
	}

	protected get versionTableName(): string { return this._versionTableName; }

	protected async onInit(cancellationToken: CancellationToken) {
		if (!await existsAsync(this._migrationFilesRootPath)) {
			throw new MigrationManager.WrongMigrationDataError(`Migration directory '${this._migrationFilesRootPath}' is not exist`);
		}

		const migrationData: {
			[version: string]: {
				readonly initSql: string | null;
				readonly migrationJavaScript: {
					readonly content: string;
					readonly file: string;
				} | null;
				readonly finalizeSql: string | null;
			};
		} = {};

		const listVersions: Array<string> = (await readdirAsync(this._migrationFilesRootPath, { withFileTypes: true }))
			.filter(w => w.isDirectory())
			.map(directory => directory.name);


		if (listVersions.length > 0) {
			for (const version of listVersions) {
				cancellationToken.throwIfCancellationRequested();
				const versionDirectory = path.join(this._migrationFilesRootPath, version);
				const migrationFiles = await readdirAsync(versionDirectory);

				const migrationVersionData: {
					initSql: string | null;
					migrationJavaScript: {
						readonly content: string;
						readonly file: string;
					} | null;
					finalizeSql: string | null;
				} = {
					initSql: null, migrationJavaScript: null, finalizeSql: null
				};

				if (migrationFiles.includes(MigrationManager.SCRIPT.INIT)) {
					cancellationToken.throwIfCancellationRequested();
					const initScriptFile = path.join(versionDirectory, MigrationManager.SCRIPT.INIT);
					const initScriptContent: string = await readFileAsync(initScriptFile, "utf-8");
					migrationVersionData.initSql = initScriptContent;
				}

				if (migrationFiles.includes(MigrationManager.SCRIPT.MIGRATION)) {
					cancellationToken.throwIfCancellationRequested();
					const migrationJavaScriptFile = path.join(versionDirectory, MigrationManager.SCRIPT.MIGRATION);
					const migrationJavaScriptContent = await readFileAsync(migrationJavaScriptFile, "utf-8");
					migrationVersionData.migrationJavaScript = Object.freeze({
						file: migrationJavaScriptFile,
						content: migrationJavaScriptContent
					});
				}

				if (migrationFiles.includes(MigrationManager.SCRIPT.FINALIZE)) {
					cancellationToken.throwIfCancellationRequested();
					const finalizeScriptFile = path.join(versionDirectory, MigrationManager.SCRIPT.FINALIZE);
					const finalizeScriptContent: string = await readFileAsync(finalizeScriptFile, "utf-8");
					migrationVersionData.finalizeSql = finalizeScriptContent;
				}

				migrationData[version] = Object.freeze(migrationVersionData);
			}
		}

		this._migrationData = Object.freeze(migrationData);
	}

	protected onDispose() {
		// Noting to dispose
	}

	protected abstract _createVersionTable(
		cancellationToken: CancellationToken, sqlProvider: SqlProvider
	): Promise<void>;
	protected abstract _insertVersionLog(
		cancellationToken: CancellationToken, sqlProvider: SqlProvider, version: string, logText: string
	): Promise<void>;
	protected abstract _isVersionTableExist(
		cancellationToken: CancellationToken, sqlProvider: SqlProvider
	): Promise<boolean>;
	protected abstract _verifyVersionTableStructure(
		cancellationToken: CancellationToken, sqlProvider: SqlProvider
	): Promise<void>;

	protected async executeMigrationJavaScript(
		cancellationToken: CancellationToken,
		sqlProvider: SqlProvider,
		migrationLogger: Logger,
		migrationJavaScript: {
			readonly content: string;
			readonly file: string;
		}
	): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const sandbox = {
				__private: { cancellationToken, log: migrationLogger, resolve, reject, sqlProvider },
				__dirname: path.dirname(migrationJavaScript.file),
				__filename: migrationJavaScript.file
			};
			const script = new vm.Script(`${migrationJavaScript.content}
migration(__private.cancellationToken, __private.sqlProvider, __private.log).then(__private.resolve).catch(__private.reject);`,
				{
					filename: migrationJavaScript.file
				}
			);
			script.runInNewContext(sandbox, { displayErrors: false });
		});
	}

	protected async executeMigrationSql(
		cancellationToken: CancellationToken,
		sqlProvider: SqlProvider,
		migrationLogger: Logger,
		sqlText: string
	): Promise<void> {
		migrationLogger.trace(EOL + sqlText);
		await sqlProvider.statement(sqlText).execute(cancellationToken);
	}
}

export namespace MigrationManager {
	export interface Opts {
		readonly migrationFilesRootPath: string;

		readonly sqlProviderFactory: SqlProviderFactory;

		readonly log: Logger;

		/**
		 * Name of version table. Default `version`
		 */
		readonly versionTableName?: string;
	}

	export interface MigrationData {
		readonly [version: string]: {
			readonly initSql: string | null;
			readonly migrationJavaScript: {
				readonly content: string;
				readonly file: string;
			} | null;
			readonly finalizeSql: string | null;
		};
	}

	export const enum SCRIPT {
		INIT = "init.sql",
		MIGRATION = "migration.js",
		FINALIZE = "finalize.sql"
	}

	export class MigrationError extends InnerError { }
	export class WrongMigrationDataError extends MigrationError { }

	export class MigrationLogger implements Logger {
		public readonly isTraceEnabled: boolean;
		public readonly isDebugEnabled: boolean;
		public readonly isInfoEnabled: boolean;
		public readonly isWarnEnabled: boolean;
		public readonly isErrorEnabled: boolean;
		public readonly isFatalEnabled: boolean;

		private readonly _wrap: Logger;
		private readonly _lines: Array<string>;

		public constructor(wrap: Logger) {
			this.isTraceEnabled = true;
			this.isDebugEnabled = true;
			this.isInfoEnabled = true;
			this.isWarnEnabled = true;
			this.isErrorEnabled = true;
			this.isFatalEnabled = true;

			this._lines = [];
			this._wrap = wrap;
		}

		public flush(): string {
			// Join and empty _lines
			return this._lines.splice(0).join(EOL);
		}

		public trace(message: string, ...args: any[]): void {
			this._wrap.trace(message, ...args);
			this._lines.push("[TRACE] " + message);
		}
		public debug(message: string, ...args: any[]): void {
			this._wrap.debug(message, ...args);
			this._lines.push("[DEBUG] " + message);
		}
		public info(message: string, ...args: any[]): void {
			this._wrap.info(message, ...args);
			this._lines.push("[INFO] " + message);
		}
		public warn(message: string, ...args: any[]): void {
			this._wrap.warn(message, ...args);
			this._lines.push("[WARN] " + message);
		}
		public error(message: string, ...args: any[]): void {
			this._wrap.error(message, ...args);
			this._lines.push("[ERROR] " + message);
		}
		public fatal(message: string, ...args: any[]): void {
			this._wrap.fatal(message, ...args);
			this._lines.push("[FATAL]" + message);
		}

		public getLogger(name?: string | undefined): Logger { return this; }
	}
}
