import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const requiredFiles = [
  "README.md",
  "io-package.json",
  "main.js",
  "admin/jsonConfig.json",
  "admin/viessmann-climate-api.png",
  "docs/de/README.md",
  "docs/en/README.md"
];

const forbiddenPathPatterns = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)\.pkce\.local\.json$/i,
  /(^|\/)tokens\.local\.json$/i,
  /(^|\/)discovery\.local\.json$/i,
  /(^|\/)VIESSMANN_API_OBJECT_OVERVIEW\.md$/i,
  /(^|\/)PUBLISHING\.md$/i,
  /(^|\/)(scripts|test|test-stage|tests)(\/|$)/i,
  /\.(?:log|tgz|tar\.gz)$/i
];

test("npm pack contains only the intended public runtime surface", () => {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  const result = JSON.parse(output)[0];
  const files = result.files.map(file => file.path.replaceAll("\\", "/"));
  const forbiddenFiles = files.filter(file => forbiddenPathPatterns.some(pattern => pattern.test(file)));

  assert.deepEqual(forbiddenFiles, [], `Forbidden npm package files: ${forbiddenFiles.join(", ")}`);
  for (const requiredFile of requiredFiles) {
    assert.ok(files.includes(requiredFile), `Required npm package file is missing: ${requiredFile}`);
  }
});
