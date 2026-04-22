"use strict";

const HANDOVER_DIR = "/Users/eric_yiru/Desktop/Clawdie_handover";

/**
 * Format File objects from a DataTransfer file list into local paths.
 * Returns an array of non-empty string paths.
 *
 * @param {FileList|File[]} files - The dropped file list
 * @param {function} [getPathForFile] - Optional resolver callback that takes a File and returns
 *   its absolute path string. When omitted, falls back to the legacy File.path property.
 * @returns {string[]} an array of file system paths
 */
function formatDroppedPaths(files, getPathForFile) {
  const paths = [];
  if (!files) return paths;
  const len = Array.isArray(files) ? files.length : files.length;
  for (let i = 0; i < len; i++) {
    const file = files[i];
    let filePath;
    if (typeof getPathForFile === "function") {
      try {
        filePath = getPathForFile(file);
      } catch (_) {
        filePath = "";
      }
    } else {
      // Electron legacy: File.path is attached to dropped File objects
      filePath = file.path;
    }
    if (filePath && typeof filePath === "string" && filePath.trim()) {
      paths.push(filePath.trim());
    }
  }
  return paths;
}

/**
 * Build the context string inserted into the chat input when files/folders are dropped.
 * Each path is prefixed with @" and appended as one line.
 * If multiple paths are provided, handover guidance is appended.
 *
 * @param {string[]} paths - Non-empty file system paths
 * @returns {string} the context string to insert into the input
 */
function buildDropContext(paths) {
  if (!paths || paths.length === 0) return "";
  const contextLines = paths.map((p) => `@"${p}"`).join("\n");
  const extra = paths.length > 1 ? `\n\nNote: Put processed outputs in ${HANDOVER_DIR}.` : "";
  return contextLines + extra;
}

module.exports = {
  formatDroppedPaths,
  buildDropContext,
  HANDOVER_DIR,
};
