import { CancellationToken } from "@zxteam/contract";
import { InvalidOperationError, ArgumentError } from "@zxteam/errors";

import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { fileURLToPath } from "url";

const existsAsync = promisify(fs.exists);
const mkdirAsync = promisify(fs.mkdir);
const readdirAsync = promisify(fs.readdir);
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);

export class MigrationSources {
	public readonly versionNames: ReadonlyArray<string>;
	private readonly _versions: Map<string, MigrationSources.VersionBundle>;

	/**
	 * Load data into memory and represent it as MigrationSources
	 * @param cancellationToken A cancellation token that can be used to cancel the action.
	 * @param sourceUri Sources url. Support schemas `file:`, `http+tar+gz:` and `https+tar+gz:`
	 */
	public static load(cancellationToken: CancellationToken, sourceUri: URL): Promise<MigrationSources> {
		switch (sourceUri.protocol as UrlSchemas) {
			case UrlSchemas.FILE: {
				const sourceDirectory: string = fileURLToPath(sourceUri);
				return MigrationSources.loadFromFilesystem(cancellationToken, sourceDirectory);
			}
			case UrlSchemas.HTTP_TAR_GZ:
				throw new InvalidOperationError("Not implemented yet");
			case UrlSchemas.HTTPS_TAR_GZ:
				throw new InvalidOperationError("Not implemented yet");
			default:
				throw new NotSupportedUrlSchemaError(sourceUri);
		}
	}

	public static async loadFromFilesystem(
		cancellationToken: CancellationToken, sourceDirectory: string
	): Promise<MigrationSources> {
		if (!await existsAsync(sourceDirectory)) {
			throw new MigrationSources.WrongMigrationDataError(`Migration directory '${sourceDirectory}' is not exist`);
		}

		const migrationBundles: Array<MigrationSources.VersionBundle> = [];

		const listVersions: Array<string> = (await readdirAsync(sourceDirectory, { withFileTypes: true }))
			.filter(w => w.isDirectory())
			.map(directory => directory.name);


		if (listVersions.length > 0) {
			for (const version of listVersions) {
				cancellationToken.throwIfCancellationRequested();
				const versionDirectory = path.join(sourceDirectory, version);

				const installDirectory = path.join(versionDirectory, MigrationSources.Direction.INSTALL);
				const rollbackDirectory = path.join(versionDirectory, MigrationSources.Direction.ROLLBACK);

				const installBundleItems: Array<MigrationSources.Script> = [];
				const rollbackBundleItems: Array<MigrationSources.Script> = [];

				if (await existsAsync(installDirectory)) {
					const migrationFiles = await readdirAsync(installDirectory);
					if (migrationFiles.length > 0) {
						for (const migrationFile of migrationFiles) {
							cancellationToken.throwIfCancellationRequested();
							const scriptFile = path.join(installDirectory, migrationFile);
							const scriptContent: string = await readFileAsync(scriptFile, "utf-8");
							const scriptKind: MigrationSources.Script.Kind = resolveScriptKindByExtension(scriptFile);
							installBundleItems.push(
								new MigrationSources.Script(migrationFile, scriptKind, scriptFile, scriptContent)
							);
						}
					}
				}
				if (await existsAsync(rollbackDirectory)) {
					const migrationFiles = await readdirAsync(rollbackDirectory);
					if (migrationFiles.length > 0) {
						for (const migrationFile of migrationFiles) {
							cancellationToken.throwIfCancellationRequested();
							const scriptFile = path.join(rollbackDirectory, migrationFile);
							const scriptContent: string = await readFileAsync(scriptFile, "utf-8");
							const scriptKind: MigrationSources.Script.Kind = resolveScriptKindByExtension(scriptFile);
							rollbackBundleItems.push(
								new MigrationSources.Script(migrationFile, scriptKind, scriptFile, scriptContent)
							);
						}
					}
				}

				migrationBundles.push(
					new MigrationSources.VersionBundle(version, installBundleItems, rollbackBundleItems)
				);
			}
		}

		return new MigrationSources(migrationBundles);
	}

	public getVersionBundle(versionName: string): MigrationSources.VersionBundle {
		const item = this._versions.get(versionName);
		if (item === undefined) {
			throw new ArgumentError("versionName", `No version bundle with name: ${versionName}`);
		}
		return item;
	}

	public map(
		callbackfn: (content: MigrationSources.Script["content"], info: {
			readonly versionName: string;
			readonly direction: MigrationSources.Direction;
			readonly itemName: string;
		}) => MigrationSources.Script["content"]
	): MigrationSources {
		const mappedBundles: Array<MigrationSources.VersionBundle> = [];
		for (const versionName of this.versionNames) {
			const bundle: MigrationSources.VersionBundle = this.getVersionBundle(versionName);
			const newBundle = bundle.map((item, opts) => {
				return callbackfn(item.content, Object.freeze({
					itemName: item.name,
					direction: opts.direction,
					versionName
				}));
			});
			mappedBundles.push(newBundle);
		}
		return new MigrationSources(mappedBundles);
	}

	public async saveToFilesystem(
		cancellationToken: CancellationToken, destinationDirectory: string
	): Promise<void> {
		if (!(await existsAsync(destinationDirectory))) {
			throw new ArgumentError(
				"destinationDirectory",
				`Target directory '${destinationDirectory}' not exist. You must provide empty directory.`
			);
		}

		for (const versionName of this.versionNames) {
			cancellationToken.throwIfCancellationRequested();

			const versionDirectory: string = path.join(destinationDirectory, versionName);
			const installDirectory: string = path.join(versionDirectory, MigrationSources.Direction.INSTALL);
			const rollbackDirectory: string = path.join(versionDirectory, MigrationSources.Direction.ROLLBACK);

			await mkdirAsync(versionDirectory);
			cancellationToken.throwIfCancellationRequested();
			await mkdirAsync(installDirectory);
			cancellationToken.throwIfCancellationRequested();
			await mkdirAsync(rollbackDirectory);

			const versionBundle: MigrationSources.VersionBundle = this.getVersionBundle(versionName);

			for (const installItemName of versionBundle.installScriptNames) {
				cancellationToken.throwIfCancellationRequested();
				const bundleFile = path.join(installDirectory, installItemName);
				const bundleItem: MigrationSources.Script = versionBundle.getInstallScript(installItemName);
				await writeFileAsync(bundleFile, bundleItem.content, "utf-8");
			}

			for (const rollbackItemName of versionBundle.rollbackScriptNames) {
				cancellationToken.throwIfCancellationRequested();
				const bundleFile: string = path.join(rollbackDirectory, rollbackItemName);
				const bundleItem: MigrationSources.Script = versionBundle.getRollbackScript(rollbackItemName);
				await writeFileAsync(bundleFile, bundleItem.content, "utf-8");
			}
		}
	}

	private constructor(bundles: Array<MigrationSources.VersionBundle>) {
		this._versions = new Map(bundles.map(bundle => ([bundle.versionName, bundle])));
		this.versionNames = Object.freeze([...this._versions.keys()].sort());
	}
}

export namespace MigrationSources {
	export class WrongMigrationDataError extends InvalidOperationError { }

	export class VersionBundle {
		public readonly versionName: string;
		public readonly installScriptNames: ReadonlyArray<string>;
		public readonly rollbackScriptNames: ReadonlyArray<string>;
		private readonly _installScripts: Map<string, Script>;
		private readonly _rollbackScripts: Map<string, Script>;

		public constructor(
			versionName: string,
			installItems: ReadonlyArray<Script>,
			rollbackItems: ReadonlyArray<Script>
		) {
			this.versionName = versionName;
			this._installScripts = new Map(installItems.map(installItem => ([installItem.name, installItem])));
			this._rollbackScripts = new Map(rollbackItems.map(rollbackItem => ([rollbackItem.name, rollbackItem])));
			this.installScriptNames = Object.freeze([...this._installScripts.keys()].sort());
			this.rollbackScriptNames = Object.freeze([...this._rollbackScripts.keys()].sort());
		}

		public getInstallScript(itemName: string): Script {
			const item = this._installScripts.get(itemName);
			if (item === undefined) {
				throw new ArgumentError("itemName", `No bundle item with name: ${itemName}`);
			}
			return item;
		}

		public getRollbackScript(itemName: string): Script {
			const script = this._rollbackScripts.get(itemName);
			if (script === undefined) {
				throw new ArgumentError("itemName", `No bundle item with name: ${itemName}`);
			}
			return script;
		}

		public map(
			callbackFn: (item: Script, opts: {
				readonly direction: MigrationSources.Direction;
			}) => Script["content"]
		): VersionBundle {
			const installScripts: ReadonlyArray<Script> =
				VersionBundle._map(this.installScriptNames, this._installScripts, (item) => {
					return callbackFn(item, { direction: MigrationSources.Direction.INSTALL });
				});
			const rollbackScripts: ReadonlyArray<Script> =
				VersionBundle._map(this.rollbackScriptNames, this._rollbackScripts, (item) => {
					return callbackFn(item, { direction: MigrationSources.Direction.ROLLBACK });
				});

			return new VersionBundle(this.versionName, installScripts, rollbackScripts);
		}

		private static _map(
			itemNames: ReadonlyArray<string>,
			itemsMap: ReadonlyMap<string, Script>,
			callbackfn: (item: Script) => Script["content"]
		): ReadonlyArray<Script> {
			const mappedItems: Array<Script> = [];
			for (const itemName of itemNames) {
				const item: Script = itemsMap.get(itemName)!;
				const newContent: Script["content"] = callbackfn(item);
				mappedItems.push(new Script(item.name, item.kind, item.file, newContent));
			}
			return mappedItems;
		}
	}

	export class Script {
		public constructor(
			readonly name: string,
			readonly kind: Script.Kind,
			readonly file: string,
			readonly content: string
		) { }
	}
	export namespace Script {
		export enum Kind {
			SQL = "SQL",
			JAVASCRIPT = "JAVASCRIPT",
			UNKNOWN = "UNKNOWN"
		}
		export namespace Kind {
			export function guard(kind: string): kind is Kind {
				const friendlyValue: Kind = kind as Kind;
				switch (friendlyValue) {
					case Kind.SQL:
					case Kind.JAVASCRIPT:
					case Kind.UNKNOWN:
						return true;
					default:
						return guardFalse(friendlyValue);
				}
			}
			// tslint:disable-next-line: no-shadowed-variable
			export function parse(kind: string): Kind {
				const friendlyValue: Kind = kind as Kind;
				if (guard(friendlyValue)) { return friendlyValue; }
				throw new UnreachableNotSupportedScriptKindError(friendlyValue);
			}
			export class UnreachableNotSupportedScriptKindError extends ArgumentError {
				public constructor(kind: never) {
					super("fiatCurrency", `Not supported script kind '${JSON.stringify(kind)}'`);
				}
			}
			function guardFalse(_never: never): false { return false; }
		}
	}

	export const enum Direction {
		INSTALL = "install",
		ROLLBACK = "rollback"
	}
}


const enum UrlSchemas {
	FILE = "file:",
	HTTP_TAR_GZ = "http+tar+gz:",
	HTTPS_TAR_GZ = "https+tar+gz:"
}

class NotSupportedUrlSchemaError extends InvalidOperationError {
	public constructor(uri: URL) {
		super(`Not supported schema: ${uri}`);
	}
}


const sqlFilesExtensions = Object.freeze([".sql"]);
const jsFilesExtensions = Object.freeze([".js"]);
function resolveScriptKindByExtension(fileName: string): MigrationSources.Script.Kind {
	const ext = path.extname(fileName);
	if (sqlFilesExtensions.includes(ext)) {
		return MigrationSources.Script.Kind.SQL;
	}
	if (jsFilesExtensions.includes(ext)) {
		return MigrationSources.Script.Kind.JAVASCRIPT;

	}
	return MigrationSources.Script.Kind.UNKNOWN;
}
