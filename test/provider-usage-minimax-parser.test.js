"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const checkerScriptsDir = path.join(__dirname, "..", "scripts", "provider-usage-checker", "scripts");

function runPythonSnippet(snippet) {
  const output = execFileSync("python3", ["-c", snippet], {
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      PYTHONPATH: checkerScriptsDir,
    },
    encoding: "utf8",
  });
  return JSON.parse(output);
}

describe("MiniMax usage parser", () => {
  it("treats visible MiniMax percentages as used progress, not remaining quota", () => {
    const result = runPythonSnippet(`
import json
from providers import minimax
used, remaining = minimax._parse_pct("可用额度 2%")
print(json.dumps({"used": used, "remaining": remaining}))
`);

    assert.strictEqual(result.used, 2);
    assert.strictEqual(result.remaining, 98);
  });

  it("normalizes primary page text to remaining = 100 - visible percent", () => {
    const result = runPythonSnippet(`
import json
from providers import minimax
window = minimax._extract_primary_window("Starter月度套餐 可用额度 2% 截止日期 2026-05-01")
print(json.dumps(window.to_dict(), ensure_ascii=False))
`);

    assert.strictEqual(result.used_percent, 2);
    assert.strictEqual(result.remaining_percent, 98);
  });
});
