"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const {
  ENV_CHECKER_PATH,
  REPO_CHECKER_PATH,
  defaultProviderUsageCheckerScriptPath,
  resolveProviderUsageCheckerScriptPath,
} = require("../src/provider-usage-checker-path");

describe("provider-usage-checker-path", () => {
  it("prefers an existing configured checker path", () => {
    const configured = "/custom/check_usage.py";
    assert.strictEqual(
      resolveProviderUsageCheckerScriptPath(configured, {
        homeDir: "/home/me",
        fileExists: (candidate) => candidate === configured,
      }),
      configured
    );
  });

  it("falls back to the repo-local checker when a saved path is stale", () => {
    const repoPath = "/repo/scripts/provider-usage-checker/scripts/check_usage.py";
    assert.strictEqual(
      resolveProviderUsageCheckerScriptPath("/stale/check_usage.py", {
        repoPath,
        fileExists: (candidate) => candidate === repoPath,
      }),
      repoPath
    );
  });

  it("lets an environment override become the default checker path", () => {
    const envPath = path.join("/tmp", "check_usage.py");
    assert.strictEqual(
      defaultProviderUsageCheckerScriptPath({
        env: { [ENV_CHECKER_PATH]: envPath },
        repoPath: REPO_CHECKER_PATH,
        fileExists: () => false,
      }),
      envPath
    );
  });
});
