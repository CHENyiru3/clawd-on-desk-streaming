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
  it("reverses checked MiniMax usage into leftover quota", () => {
    const result = runPythonSnippet(`
import json
from providers import minimax
used, remaining = minimax._parse_pct("可用额度 2%")
print(json.dumps({"used": used, "remaining": remaining}))
`);

    assert.strictEqual(result.used, 2);
    assert.strictEqual(result.remaining, 98);
  });

  it("normalizes primary page text to display leftover = 100 - checked usage", () => {
    const result = runPythonSnippet(`
import json
from providers import minimax
window = minimax._extract_primary_window("Starter月度套餐 可用额度 2% 截止日期 2026-05-01")
print(json.dumps(window.to_dict(), ensure_ascii=False))
`);

    assert.strictEqual(result.used_percent, 2);
    assert.strictEqual(result.remaining_percent, 98);
    assert.strictEqual(result.display_text, "98%");
  });

  it("ignores slash-form dates when looking for quota counts", () => {
    const result = runPythonSnippet(`
import json
from providers import minimax
text = "Starter月度套餐 可用额度 2% 截止日期 2026/05/01"
window = minimax._extract_primary_window(text)
print(json.dumps(window.to_dict(), ensure_ascii=False))
`);

    assert.strictEqual(result.used_percent, 2);
    assert.strictEqual(result.remaining_percent, 98);
    assert.strictEqual(result.display_text, "98%");
  });

  it("uses quota count ratios only from usage-like context", () => {
    const result = runPythonSnippet(`
import json
from providers import minimax
text = "公告 4/27 Starter月度套餐 调用次数 599 / 600 可用额度 2%"
window = minimax._extract_primary_window(text)
print(json.dumps(window.to_dict(), ensure_ascii=False))
`);

    assert.strictEqual(result.used_percent, 99.83);
    assert.strictEqual(result.remaining_percent, 0.17);
    assert.strictEqual(result.display_text, "0%");
  });

  it("reports a detail when the page has no usable MiniMax usage value", () => {
    const result = runPythonSnippet(`
import json
from providers import minimax
window = minimax._extract_primary_window("Starter月度套餐 截止日期 2026-05-01")
print(json.dumps(window.to_dict(), ensure_ascii=False))
`);

    assert.strictEqual(result.used_percent, null);
    assert.strictEqual(result.remaining_percent, null);
    assert.match(result.detail_text, /not found/);
  });
});
