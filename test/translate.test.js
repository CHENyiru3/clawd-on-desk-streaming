"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert");

const translate = require("../src/translate");

const ORIGINAL_KEY = process.env.MINIMAX_API_KEY;

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.MINIMAX_API_KEY;
  else process.env.MINIMAX_API_KEY = ORIGINAL_KEY;
  translate.setApiKey("");
  translate.setClientFactoryForTests(null);
});

describe("translate.detectLang", () => {
  it("treats Chinese-heavy text as zh", () => {
    assert.strictEqual(translate.detectLang("你好，world"), "zh");
  });

  it("treats Latin text as en", () => {
    assert.strictEqual(translate.detectLang("hello world"), "en");
  });
});

describe("translate.translateText", () => {
  it("returns translated text and direction on success", async () => {
    translate.setApiKey("secret");
    translate.setClientFactoryForTests(() => ({
      messages: {
        create: async () => ({
          content: [{ type: "text", text: "你好世界" }],
        }),
      },
    }));
    const result = await translate.translateText("hello world");
    assert.deepStrictEqual(result, {
      text: "你好世界",
      detectedLang: "en",
      direction: "en-zh",
      provider: "minimax",
    });
  });

  it("throws missing_key when no API key is configured", async () => {
    await assert.rejects(
      () => translate.translateText("hello"),
      (err) => err && err.code === "missing_key" && /MiniMax API key/.test(err.message)
    );
  });

  it("maps auth failures", async () => {
    translate.setApiKey("secret");
    translate.setClientFactoryForTests(() => ({
      messages: {
        create: async () => {
          const err = new Error("unauthorized");
          err.status = 401;
          throw err;
        },
      },
    }));
    await assert.rejects(
      () => translate.translateText("hello"),
      (err) => err && err.code === "auth" && /rejected/.test(err.message)
    );
  });

  it("maps network failures", async () => {
    translate.setApiKey("secret");
    translate.setClientFactoryForTests(() => ({
      messages: {
        create: async () => {
          throw new Error("ENOTFOUND minimaxi.com");
        },
      },
    }));
    await assert.rejects(
      () => translate.translateText("hello"),
      (err) => err && err.code === "network" && /Could not reach MiniMax/.test(err.message)
    );
  });

  it("maps empty text blocks to empty_result", async () => {
    translate.setApiKey("secret");
    translate.setClientFactoryForTests(() => ({
      messages: {
        create: async () => ({
          content: [{ type: "image", text: "" }],
        }),
      },
    }));
    await assert.rejects(
      () => translate.translateText("hello"),
      (err) => err && err.code === "empty_result" && /no translated text/i.test(err.message)
    );
  });
});
