"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { buildCliEnv, buildCliPath } = require("../src/cli-env");

describe("cli-env", () => {
  it("prepends common user CLI paths before the existing PATH", () => {
    const result = buildCliPath("/custom/bin:/usr/bin", {
      platform: "darwin",
      home: "/Users/example",
      delimiter: ":",
    }).split(":");

    assert.strictEqual(result[0], "/Users/example/.local/bin");
    assert.ok(result.includes("/opt/homebrew/bin"));
    assert.ok(result.includes("/custom/bin"));
    assert.strictEqual(result.filter((entry) => entry === "/usr/bin").length, 1);
  });

  it("preserves overrides while normalizing PATH", () => {
    const env = buildCliEnv(
      { PATH: "/usr/bin", EXISTING: "1" },
      { EXTRA: "2" },
    );

    assert.strictEqual(env.EXISTING, "1");
    assert.strictEqual(env.EXTRA, "2");
    assert.ok(env.PATH.includes("/.local/bin"));
    assert.ok(env.PATH.includes("/usr/bin"));
  });
});
