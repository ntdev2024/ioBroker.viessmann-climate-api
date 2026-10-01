import path from "node:path";
import { fileURLToPath } from "node:url";

import { tests } from "@iobroker/testing";
import { before, it } from "mocha";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const controllerVersion = process.env.IOBROKER_TEST_CONTROLLER_VERSION;

tests.integration(path.join(testDirectory, ".."), {
  ...(controllerVersion ? { controllerVersion } : {}),
  defineAdditionalTests({ suite }) {
    suite("Adapter unload lifecycle", getHarness => {
      let harness;

      before(() => {
        harness = getHarness();
      });

      it("stops and stays quiet after unload", async function () {
        this.timeout(15_000);
        await harness.startAdapterAndWait();
        await harness.stopAdapter();
        harness.clearLogs();
        await new Promise(resolve => setTimeout(resolve, 250));
        if (harness.getLogs().length > 0) {
          throw new Error(`Adapter logged after unload: ${JSON.stringify(harness.getLogs())}`);
        }
      });
    });
  }
});
