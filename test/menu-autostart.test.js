const { describe, it } = require("node:test");
const assert = require("node:assert");

const { getLoginItemSettings } = require("../src/login-item");

describe("login item settings", () => {
  it("uses the default packaged login item settings on macOS", () => {
    const settings = getLoginItemSettings({
      isPackaged: true,
      openAtLogin: true,
    });

    assert.deepStrictEqual(settings, { openAtLogin: true });
  });

  it("returns openAtLogin=false when disabled", () => {
    const settings = getLoginItemSettings({
      isPackaged: true,
      openAtLogin: false,
    });

    assert.deepStrictEqual(settings, { openAtLogin: false });
  });

});
