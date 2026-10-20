import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requiredNewsLanguages = ["en", "de", "ru", "pt", "nl", "fr", "it", "es", "pl", "uk", "zh-cn"];

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
}

function normalizeNews(text) {
  return text.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

test("release versions and localized news stay consistent", async () => {
  const [packageJson, packageLock, ioPackage] = await Promise.all([
    readJson("../package.json"),
    readJson("../package-lock.json"),
    readJson("../io-package.json")
  ]);

  const version = packageJson.version;
  assert.equal(packageLock.version, version, "package-lock.json version must match package.json");
  assert.equal(packageLock.packages[""].version, version, "package-lock root version must match package.json");
  assert.equal(ioPackage.common.version, version, "io-package.json version must match package.json");
  assert.ok(ioPackage.common.news[version], `common.news must contain the current version ${version}`);

  for (const [newsVersion, translations] of Object.entries(ioPackage.common.news)) {
    assert.deepEqual(
      Object.keys(translations).sort(),
      [...requiredNewsLanguages].sort(),
      `common.news ${newsVersion} must contain every supported language`
    );

    const english = normalizeNews(translations.en);
    assert.ok(english, `common.news ${newsVersion}.en must not be empty`);

    for (const language of requiredNewsLanguages.filter(entry => entry !== "en")) {
      const localized = normalizeNews(translations[language]);
      assert.ok(localized, `common.news ${newsVersion}.${language} must not be empty`);
      assert.notEqual(
        localized,
        english,
        `common.news ${newsVersion}.${language} must be translated instead of copying English`
      );
    }
  }
});
