import { assert } from "chai";

import { CancellationToken } from "@zxteam/contract";
import { SqlProvider, SqlProviderFactory } from "@zxteam/contract.sql";

import Factory from "../";

const DUMMY_CANCELLATION_TOKEN: CancellationToken = {
	get isCancellationRequested(): boolean { return false; },
	addCancelListener(cb: Function): void { /* STUB */ },
	removeCancelListener(cb: Function): void { /* STUB */ },
	throwIfCancellationRequested(): void { /* STUB */ }
};

describe("MySQL Tests", function () {
	let sqlProviderFactory: SqlProviderFactory;
	let sqlProvider: SqlProvider | null;

	function getSqlProvider(): SqlProvider {
		if (!sqlProvider) { throw new Error(); }
		return sqlProvider;
	}

	before(async function () {
		// runs before all tests in this block

		if (process.env.TEST_DB_URL) {
			let urlStr = process.env.TEST_DB_URL;
			switch (urlStr) {
				case "mysql://": {
					const host = "localhost";
					const port = 3306;
					const user = "devtest";
					urlStr = `mysql://${user}@${host}:${port}/emptytestdb`;
					break;
				}
			}

			const url = new URL(urlStr);
			if (url.protocol !== "mysql:") {
				throw new Error(`Not supported DB Server protocol = ${process.env.TEST_DB_URL}`);
			}
			sqlProviderFactory = new Factory(url);
		} else {
			throw new Error("TEST_DB_URL environment is not defined. Please set the variable to use these tests.");
		}


		// Uncomment rows below to enable trace log
		/*
		configure({
			appenders: {
				out: { type: "console" }
			},
			categories: {
				default: { appenders: ["out"], level: "trace" }
			}
		});
		*/
	});

	beforeEach(async function () {
		// runs before each test in this block
		sqlProvider = await sqlProviderFactory.create();
	});
	afterEach(async function () {
		// runs after each test in this block
		if (sqlProvider) {
			await sqlProvider.dispose();
			sqlProvider = null;
		}
	});

	it("Read 0 as Integer through executeScalar", async function () {
		const result = await getSqlProvider()
			.statement("SELECT 0")
			.executeScalar(DUMMY_CANCELLATION_TOKEN); // executeScalar() should return first row + first column
		assert.equal(result.asInteger, 0);
	});
});
