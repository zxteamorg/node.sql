import { CancellationToken, Logger } from "@zxteam/contract";
import { InnerError } from "@zxteam/errors";

import * as fs from "fs";
import { EOL } from "os";
import * as path from "path";
import { promisify } from "util";
import * as vm from "vm";

import { SqlProviderFactory, SqlProvider } from "./index";
import { MigrationSources } from "./MigrationSources";

export abstract class MigrationManager {
	private readonly _sqlProviderFactory: SqlProviderFactory;
	private readonly _migrationSources: MigrationSources;
	private readonly _log: Logger;
	private readonly _versionTableName: string;


	public constructor(opts: MigrationManager.Opts) {
		this._migrationSources = opts.migrationSources;
		this._sqlProviderFactory = opts.sqlProviderFactory;
		this._log = opts.log;
		this._versionTableName = opts.versionTableName !== undefined ? opts.versionTableName : "__migration";
	}

	/**
	 * Install versions (increment version)
	 * @param cancellationToken A cancellation token that can be used to cancel the action.
	 * @param targetVersion Optional target version. Will use latest version if omited.
	 */
	public async install(cancellationToken: CancellationToken, targetVersion?: string): Promise<void> {
		const currentVersion: string | null = await this.getCurrentVersion(cancellationToken);
		const availableVersions: Array<string> = [...this._migrationSources.versionNames].sort();
		let scheduleVersions: Array<string> = availableVersions;

		if (currentVersion !== null) {
			scheduleVersions = scheduleVersions.reduce<Array<string>>(
				(p, c) => { if (c > currentVersion) { p.push(c); } return p; },
				[]
			);
		}

		if (targetVersion !== undefined) {
			scheduleVersions = scheduleVersions.reduceRight<Array<string>>(function (p, c) {
				if (c <= targetVersion) { p.unshift(c); } return p;
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

				const versionBundle: MigrationSources.VersionBundle = this._migrationSources.getVersionBundle(version);
				const installScriptNames: Array<string> = [...versionBundle.installScriptNames].sort();
				for (const scriptName of installScriptNames) {
					const script: MigrationSources.Script = versionBundle.getInstallScript(scriptName);
					switch (script.kind) {
						case MigrationSources.Script.Kind.SQL: {
							migrationLogger.info(`Execute SQL script: ${script.name}`);
							migrationLogger.trace(EOL + script.content);
							await this._executeMigrationSql(cancellationToken, sqlProvider, migrationLogger, script.content);
							break;
						}
						case MigrationSources.Script.Kind.JAVASCRIPT: {
							migrationLogger.info(`Execute JS script: ${script.name}`);
							migrationLogger.trace(EOL + script.content);
							await this._executeMigrationJavaScript(
								cancellationToken, sqlProvider, migrationLogger,
								{
									content: script.content,
									file: script.file
								}
							);
							break;
						}
						default:
							migrationLogger.warn(`Skip script '${version}:${script.name}' due unknown kind of script`);
					}
				}

				const logText: string = migrationLogger.flush();
				await this._insertVersionLog(cancellationToken, sqlProvider, version, logText);
			});
		}
	}

	/**
	 * Install versions (increment version)
	 * @param cancellationToken A cancellation token that can be used to cancel the action.
	 * @param targetVersion Optional target version. Will use latest version if omited.
	 */
	public async rollback(cancellationToken: CancellationToken, targetVersion?: string): Promise<void> {
		const currentVersion: string | null = await this.getCurrentVersion(cancellationToken);
		const availableVersions: Array<string> = [...this._migrationSources.versionNames].sort().reverse();
		let scheduleVersionNames: Array<string> = availableVersions;

		if (currentVersion !== null) {
			scheduleVersionNames = scheduleVersionNames.reduce<Array<string>>(
				(p, c) => { if (c <= currentVersion) { p.push(c); } return p; },
				[]
			);
		}

		if (targetVersion !== undefined) {
			scheduleVersionNames = scheduleVersionNames.reduceRight<Array<string>>(
				(p, c) => { if (c > targetVersion) { p.unshift(c); } return p; },
				[]
			);
		}

		for (const versionName of scheduleVersionNames) {
			await this.sqlProviderFactory.usingProviderWithTransaction(cancellationToken, async (sqlProvider: SqlProvider) => {
				if (! await this._isVersionLogExist(cancellationToken, sqlProvider, versionName)) {
					this._log.warn(`Skip rollback for version '${versionName}' due this does not present inside database.`);
					return;
				}

				const versionBundle: MigrationSources.VersionBundle = this._migrationSources.getVersionBundle(versionName);
				const rollbackScriptNames: Array<string> = [...versionBundle.rollbackScriptNames].sort().reverse();
				for (const scriptName of rollbackScriptNames) {
					const script: MigrationSources.Script = versionBundle.getRollbackScript(scriptName);
					switch (script.kind) {
						case MigrationSources.Script.Kind.SQL: {
							this._log.info(`Execute SQL script: ${script.name}`);
							this._log.trace(EOL + script.content);
							await this._executeMigrationSql(cancellationToken, sqlProvider, this._log, script.content);
							break;
						}
						case MigrationSources.Script.Kind.JAVASCRIPT: {
							this._log.info(`Execute JS script: ${script.name}`);
							this._log.trace(EOL + script.content);
							await this._executeMigrationJavaScript(
								cancellationToken, sqlProvider, this._log,
								{
									content: script.content,
									file: script.file
								}
							);
							break;
						}
						default:
							this._log.warn(`Skip script '${versionName}:${script.name}' due unknown kind of script`);
					}
				}

				await this._removeVersionLog(cancellationToken, sqlProvider, versionName);
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

	protected get versionTableName(): string { return this._versionTableName; }

	protected abstract _createVersionTable(
		cancellationToken: CancellationToken, sqlProvider: SqlProvider
	): Promise<void>;

	protected async _executeMigrationJavaScript(
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

	protected async _executeMigrationSql(
		cancellationToken: CancellationToken,
		sqlProvider: SqlProvider,
		migrationLogger: Logger,
		sqlText: string
	): Promise<void> {
		migrationLogger.trace(EOL + sqlText);
		await sqlProvider.statement(sqlText).execute(cancellationToken);
	}

	protected abstract _insertVersionLog(
		cancellationToken: CancellationToken, sqlProvider: SqlProvider, version: string, logText: string
	): Promise<void>;

	protected abstract _isVersionLogExist(
		cancellationToken: CancellationToken, sqlProvider: SqlProvider, version: string
	): Promise<boolean>;

	protected abstract _isVersionTableExist(
		cancellationToken: CancellationToken, sqlProvider: SqlProvider
	): Promise<boolean>;

	protected abstract _removeVersionLog(
		cancellationToken: CancellationToken, sqlProvider: SqlProvider, version: string
	): Promise<void>;

	protected abstract _verifyVersionTableStructure(
		cancellationToken: CancellationToken, sqlProvider: SqlProvider
	): Promise<void>;
}

export namespace MigrationManager {
	export interface Opts {
		readonly migrationSources: MigrationSources;

		readonly sqlProviderFactory: SqlProviderFactory;

		readonly log: Logger;

		/**
		 * Name of version table. Default `__migration`.
		 */
		readonly versionTableName?: string;
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
