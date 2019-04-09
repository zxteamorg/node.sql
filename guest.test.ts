import { assert } from "chai";
import * as fs from "fs";

import { CancellationToken } from "@zxteam/contract";
import { SqlProvider, SqlProviderFactory } from "@zxteam/contract.sql";

import Factory from "../";

const DUMMY_CANCELLATION_TOKEN: CancellationToken = {
	get isCancellationRequested(): boolean { return false; },
	addCancelListener(cb: Function): void { /* STUB */ },
	removeCancelListener(cb: Function): void { /* STUB */ },
	throwIfCancellationRequested(): void { /* STUB */ }
};

interface GuestQueries {
	init: Array<string>;
}

describe("Guest Tests", function () {
	let sqlProviderFactory: SqlProviderFactory;
	let queries: GuestQueries;
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
			const ctor = sqlProviderFactory.constructor.name;
			queries = JSON.parse(fs.readFileSync(__dirname + "/guest.test." + ctor + ".json").toString());

			const provider = await sqlProviderFactory.create(DUMMY_CANCELLATION_TOKEN);
			try {
				for (let initIndex = 0; initIndex < queries.init.length; ++initIndex) {
					const initSql = queries.init[initIndex];
					await provider.statement(initSql).execute(DUMMY_CANCELLATION_TOKEN);
				}
			} finally {
				await provider.dispose();
			}

		} else {
			throw new Error("TEST_DB_URL environment is not defined. Please set the variable to use these tests.");
		}
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
	it("Read with IN condition", async function () {
		const result = await getSqlProvider()
			.statement("SELECT `A` FROM `guest_tb_1` WHERE `B` IN (?)")
			.executeQuery(DUMMY_CANCELLATION_TOKEN, [1, 3]);
		assert.isArray(result);
		assert.equal(result.length, 2);
		assert.equal(result[0].get("A").asString, "one");
		assert.equal(result[1].get("A").asString, "three");
	});
});
