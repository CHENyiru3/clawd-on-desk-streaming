"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert");

const { formatDroppedPaths, buildDropContext, HANDOVER_DIR } = require("../src/chat-drop-paths");

describe("chat-drop-paths", () => {
  describe("formatDroppedPaths", () => {
    it("returns an empty array for null input", () => {
      assert.deepStrictEqual(formatDroppedPaths(null), []);
    });

    it("returns an empty array for undefined input", () => {
      assert.deepStrictEqual(formatDroppedPaths(undefined), []);
    });

    it("extracts one file path", () => {
      const files = [{ path: "/Users/eric/Documents/file.txt" }];
      assert.deepStrictEqual(formatDroppedPaths(files), ["/Users/eric/Documents/file.txt"]);
    });

    it("extracts one folder path", () => {
      const files = [{ path: "/Users/eric/Projects/my-app" }];
      assert.deepStrictEqual(formatDroppedPaths(files), ["/Users/eric/Projects/my-app"]);
    });

    it("extracts multiple paths", () => {
      const files = [
        { path: "/Users/eric/file1.txt" },
        { path: "/Users/eric/file2.js" },
        { path: "/Users/eric/folder" },
      ];
      assert.deepStrictEqual(formatDroppedPaths(files), [
        "/Users/eric/file1.txt",
        "/Users/eric/file2.js",
        "/Users/eric/folder",
      ]);
    });

    it("skips items with empty or missing paths", () => {
      const files = [
        { path: "/Users/eric/valid.txt" },
        { path: "" },
        { path: "   " },
        { noPath: true },
        { path: "/Users/eric/also-valid.md" },
      ];
      assert.deepStrictEqual(formatDroppedPaths(files), [
        "/Users/eric/valid.txt",
        "/Users/eric/also-valid.md",
      ]);
    });

    it("handles paths with spaces", () => {
      const files = [{ path: "/Users/eric/My Documents/file with spaces.txt" }];
      assert.deepStrictEqual(formatDroppedPaths(files), ["/Users/eric/My Documents/file with spaces.txt"]);
    });

    it("uses resolver callback when provided", () => {
      const files = [{ name: "file.txt" }, { name: "folder" }];
      const getPathForFile = (f) => (f.name === "file.txt" ? "/resolved/file.txt" : "/resolved/folder");
      assert.deepStrictEqual(formatDroppedPaths(files, getPathForFile), [
        "/resolved/file.txt",
        "/resolved/folder",
      ]);
    });

    it("skips items when resolver returns empty string", () => {
      const files = [{ name: "ok.txt" }, { name: "bad" }];
      const getPathForFile = (f) => (f.name === "ok.txt" ? "/valid/path.txt" : "");
      assert.deepStrictEqual(formatDroppedPaths(files, getPathForFile), ["/valid/path.txt"]);
    });

    it("skips items when resolver throws", () => {
      const files = [{ name: "good.txt" }, { name: "bad.txt" }];
      const getPathForFile = (f) => {
        if (f.name === "good.txt") return "/good/path.txt";
        throw new Error("resolver failed");
      };
      assert.deepStrictEqual(formatDroppedPaths(files, getPathForFile), ["/good/path.txt"]);
    });

    it("falls back to file.path when resolver is not a function", () => {
      const files = [{ path: "/fallback/case.txt" }];
      assert.deepStrictEqual(formatDroppedPaths(files, null), ["/fallback/case.txt"]);
      assert.deepStrictEqual(formatDroppedPaths(files, undefined), ["/fallback/case.txt"]);
      assert.deepStrictEqual(formatDroppedPaths(files, 42), ["/fallback/case.txt"]);
    });
  });

  describe("buildDropContext", () => {
    it("returns empty string for empty array", () => {
      assert.strictEqual(buildDropContext([]), "");
    });

    it("returns empty string for null", () => {
      assert.strictEqual(buildDropContext(null), "");
    });

    it("formats a single file path as a quoted context line", () => {
      const result = buildDropContext(["/Users/eric/Documents/file.txt"]);
      assert.strictEqual(result, `@"/Users/eric/Documents/file.txt"`);
    });

    it("formats a single folder path as a quoted context line", () => {
      const result = buildDropContext(["/Users/eric/Projects/my-app"]);
      assert.strictEqual(result, `@"/Users/eric/Projects/my-app"`);
    });

    it("appends one path per line for multiple paths", () => {
      const result = buildDropContext([
        "/Users/eric/file1.txt",
        "/Users/eric/file2.js",
      ]);
      assert.strictEqual(
        result,
        `@"/Users/eric/file1.txt"\n@"/Users/eric/file2.js"\n\nNote: Put processed outputs in ${HANDOVER_DIR}.`
      );
    });

    it("includes handover guidance when multiple paths are dropped", () => {
      const result = buildDropContext([
        "/Users/eric/data/dataset.csv",
        "/Users/eric/data/config.json",
      ]);
      assert.ok(result.includes(`Put processed outputs in ${HANDOVER_DIR}.`), result);
    });

    it("does not include handover guidance for a single path", () => {
      const result = buildDropContext(["/Users/eric/Documents/file.txt"]);
      assert.ok(!result.includes("Put processed outputs"));
    });

    it("handles paths with spaces in quoted context", () => {
      const result = buildDropContext(["/Users/eric/My Documents/file with spaces.txt"]);
      assert.strictEqual(result, `@"/Users/eric/My Documents/file with spaces.txt"`);
    });
  });
});
