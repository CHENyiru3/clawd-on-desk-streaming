"use strict";

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(value, max));
}

function computeLeftChatPanelBounds({ petBounds, workArea, chatWidth, chatHeight, gap }) {
  const wa = workArea || { x: 0, y: 0, width: 1280, height: 800 };
  const pet = petBounds || { x: wa.x, y: wa.y, width: 1, height: 1 };
  const width = Math.max(1, Math.round(chatWidth || 1));
  const height = Math.max(1, Math.round(chatHeight || 1));
  const panelGap = Number.isFinite(gap) ? gap : 0;

  const idealX = Math.round(pet.x - width - panelGap);
  const maxX = wa.x + Math.max(0, wa.width - width);
  const x = clamp(idealX, wa.x, maxX);

  const petCenterY = pet.y + pet.height / 2;
  const desiredY = Math.round(petCenterY - height / 2);
  const maxY = wa.y + Math.max(0, wa.height - height);
  const y = clamp(desiredY, wa.y, maxY);

  return { x, y, width, height };
}

module.exports = {
  computeLeftChatPanelBounds,
};
