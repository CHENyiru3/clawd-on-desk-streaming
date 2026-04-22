"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { computeLeftChatPanelBounds } = require("../src/chat-panel-layout");

describe("chat-panel-layout", () => {
  const workArea = { x: 0, y: 0, width: 1280, height: 800 };

  it("places the chat panel left of the pet when there is room", () => {
    const bounds = computeLeftChatPanelBounds({
      petBounds: { x: 500, y: 240, width: 200, height: 200 },
      workArea,
      chatWidth: 240,
      chatHeight: 340,
      gap: 8,
    });

    assert.strictEqual(bounds.x, 252);
    assert.strictEqual(bounds.y, 170);
    assert.strictEqual(bounds.width, 240);
    assert.strictEqual(bounds.height, 340);
  });

  it("stays on the left side by clamping to the work-area edge instead of falling right", () => {
    const bounds = computeLeftChatPanelBounds({
      petBounds: { x: 80, y: 240, width: 200, height: 200 },
      workArea,
      chatWidth: 240,
      chatHeight: 340,
      gap: 8,
    });

    assert.strictEqual(bounds.x, 0);
    assert.ok(bounds.x < 80);
  });

  it("keeps the panel vertically visible near work-area edges", () => {
    const top = computeLeftChatPanelBounds({
      petBounds: { x: 500, y: 10, width: 200, height: 200 },
      workArea,
      chatWidth: 240,
      chatHeight: 340,
      gap: 8,
    });
    const bottom = computeLeftChatPanelBounds({
      petBounds: { x: 500, y: 700, width: 200, height: 200 },
      workArea,
      chatWidth: 240,
      chatHeight: 340,
      gap: 8,
    });

    assert.strictEqual(top.y, 0);
    assert.strictEqual(bottom.y, 460);
  });
});
