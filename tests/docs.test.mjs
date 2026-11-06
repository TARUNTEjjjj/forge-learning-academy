import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("README does not hard-code a check count that drifts from npm test", () => {
  // The README said 93 after commit 611d0c5 had raised the suite to 95; npm test prints the live total.
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.equal(readme.match(/\b\d+ automated checks\b/)?.[0], undefined);
});
