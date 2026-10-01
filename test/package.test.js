import path from "node:path";
import { fileURLToPath } from "node:url";

import { tests } from "@iobroker/testing";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));

tests.packageFiles(path.join(testDirectory, ".."));
