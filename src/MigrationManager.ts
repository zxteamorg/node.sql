import { CancellationToken, Logger } from "@zxteam/contract";
import { Initable } from "@zxteam/disposable";
import { InnerError, InvalidOperationError } from "@zxteam/errors";

import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import * as vm from "vm";

import { SqlProviderFactory, SqlProvider } from "./index";

const existsAsync = promisify(fs.exists);
const readdirAsync = promisify(fs.readdir);
const readFileAsync = promisify(fs.readFile);

export abstract class MigrationManager extends Initable {
	private readonly _migrationFilesRootPath: string;
	private readonly _sqlProviderFactory: SqlProviderFactory;
	private _migrationData: MigrationManager.MigrationData | null;

	public constructor(migrationFilesRootPath: string, sqlProviderFactory: SqlProviderFactory) {
		super();
		this._migrationFilesRootPath = migrationFilesRootPath;
		this._sqlProviderFactory = sqlProviderFactory;
		this._migrationData = null;
	}

	/**
	 * Make migration
	 * @param cancellationToken Allows to request cancel of the operation.
	 * @param targetVersion Optional target version. Will use latest version if omited.
	 */
	public abstract migrate(cancellationToken: CancellationToken, targetVersion?: string): Promise<void>;

	/**
	 * Gets current version of the database or `null` if version table is not presented.
	 * @param cancellationToken Allows to request cancel of the operation.
	 */
	public abstract getCurrentVersion(cancellationToken: CancellationToken): Promise<string | null>;

	protected get sqlProviderFactory(): SqlProviderFactory {
		return this._sqlProviderFactory;
	}

	protected get migrationData(): MigrationManager.MigrationData {
		if (this._migrationData === null) {
			throw new InvalidOperationError("Wrong operation at current state. Did you call init()?");
		}
		return this._migrationData;
	}

	protected async onInit(cancellationToken: CancellationToken) {
		if (!await existsAsync(this._migrationFilesRootPath)) {
			throw new MigrationManager.WrongMigrationDataError(`Migration directory '${this._migrationFilesRootPath}' is not exist`);
		}

		const migrationData: {
			[version: string]: {
				readonly initSql: string | null;
				readonly migrationJavaScriptFile: string | null;
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
					migrationJavaScriptFile: string | null;
					finalizeSql: string | null;
				} = {
					initSql: null, migrationJavaScriptFile: null, finalizeSql: null
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
					migrationVersionData.migrationJavaScriptFile = migrationJavaScriptFile;
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

	protected static async executeMigrationJavaScript(
		cancellationToken: CancellationToken,
		sqlProvider: SqlProvider, log: Logger,
		migrationJavaScriptFile: string
	): Promise<void> {
		const migrationJavaScriptContent = await readFileAsync(migrationJavaScriptFile, "utf-8");
		await new Promise<void>((resolve, reject) => {
			const sandbox = {
				__private: { cancellationToken, log, resolve, reject, sqlProvider },
				__dirname: path.dirname(migrationJavaScriptFile),
				__filename: migrationJavaScriptFile
			};
			const script = new vm.Script(`${migrationJavaScriptContent}
migration(__private.cancellationToken, __private.sqlProvider, __private.log).then(__private.resolve).catch(__private.reject);`,
				{
					filename: migrationJavaScriptFile
				}
			);
			script.runInNewContext(sandbox, { displayErrors: false });
		});
	}
}

export namespace MigrationManager {

	export class WrongMigrationDataError extends InnerError { }


	export interface MigrationData {
		readonly [version: string]: {
			readonly initSql: string | null;
			readonly migrationJavaScriptFile: string | null;
			readonly finalizeSql: string | null;
		};
	}

	export const enum SCRIPT {
		INIT = "init.sql",
		MIGRATION = "migration.js",
		FINALIZE = "finalize.sql"
	}
}
