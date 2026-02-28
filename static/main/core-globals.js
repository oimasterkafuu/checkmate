function htmlescape(x) {
  return $('<div>').text(x).html();
}

const dire = [
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: -1 },
  { x: 0, y: 1 },
];
const dire_char = ['↑', '↓', '←', '→'];
const dire_class = ['arrow_u', 'arrow_d', 'arrow_l', 'arrow_r'];
const map_token_max_length = 32;
const replay_binary_magic = [0x52, 0x50, 0x42, 0x31]; // RPB1
const replay_class_from_code = ['', 'dead', 'afk'];
const replay_text_decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
const neutral_cell_color = [128, 128, 128];
const owner_base_colors = {
  1: [255, 0, 0],
  2: [0, 128, 0],
  3: [0, 0, 255],
  4: [128, 0, 128],
  5: [0, 128, 128],
  6: [0, 70, 0],
  7: [255, 165, 0],
  8: [165, 42, 42],
  9: [128, 0, 0],
  10: [236, 112, 99],
  11: [147, 81, 22],
  12: [26, 82, 118],
  13: [46, 204, 113],
  14: [100, 30, 22],
  15: [183, 149, 11],
  16: [255, 87, 51],
  17: [243, 33, 221],
};

function normalizeMapTokenInput(token) {
  return String(token || '').slice(0, map_token_max_length);
}

function getSurrenderMixedColor(ownerId, fadeProgress) {
  const from = owner_base_colors[ownerId];
  if (!from) {
    return '';
  }
  const p = Math.max(0, Math.min(1, Number(fadeProgress) || 0));
  const r = Math.round(from[0] + (neutral_cell_color[0] - from[0]) * p);
  const g = Math.round(from[1] + (neutral_cell_color[1] - from[1]) * p);
  const b = Math.round(from[2] + (neutral_cell_color[2] - from[2]) * p);
  return 'background-color: rgb(' + r + ', ' + g + ', ' + b + ') !important;';
}
