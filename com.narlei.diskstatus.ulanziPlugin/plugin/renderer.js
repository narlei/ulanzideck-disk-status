import { formatBytes } from './disk-fetcher.js';

const SIZE = 200;
const BG = '#1f1f23';
const TRACK = '#2c2c33';
const TEXT = '#ffffff';
const SHADOW = 'rgba(0,0,0,0.85)';
const MIN_BAR_RATIO = 0.04;

const COLORS = {
  ok: '#3ecf6b',
  warn: '#e3b341',
  high: '#e8893c',
  crit: '#e3434c',
  muted: '#4a4a52',
};

function thresholdColor(usedRatio) {
  if (usedRatio >= 0.95) return COLORS.crit;
  if (usedRatio >= 0.85) return COLORS.high;
  if (usedRatio >= 0.7) return COLORS.warn;
  return COLORS.ok;
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function svgDoc(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">${body}</svg>`;
}

function toDataUrl(svg) {
  const b64 = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${b64}`;
}

function textWithShadow(text, x, y, fontSize, weight = '700', anchor = 'middle') {
  const t = escapeXml(text);
  return (
    `<text x="${x + 1}" y="${y + 1}" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="${fontSize}" font-weight="${weight}" text-anchor="${anchor}" fill="${SHADOW}">${t}</text>` +
    `<text x="${x}" y="${y}" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="${fontSize}" font-weight="${weight}" text-anchor="${anchor}" fill="${TEXT}">${t}</text>`
  );
}

// Truncates so the rendered string never exceeds maxWidth px at fontSize,
// using a conservative average glyph-width ratio for the bold UI font.
function fitText(text, fontSize, maxWidth = SIZE - 20) {
  if (!text) return '';
  const charW = fontSize * 0.58;
  const maxChars = Math.max(1, Math.floor(maxWidth / charW));
  return text.length > maxChars ? `${text.slice(0, Math.max(1, maxChars - 1))}…` : text;
}

const DISK_PIXEL_GRID = [
  'XXXXXXXXXXXX',
  'X..........X',
  'X..........X',
  'X..........X',
  'XXXXXXXXXXXX',
  'X..........X',
  'X...OO.....X',
  'XXXXXXXXXXXX',
];

function diskIcon(centerX, centerY, width, color) {
  const cols = DISK_PIXEL_GRID[0].length;
  const rows = DISK_PIXEL_GRID.length;
  const cell = width / cols;
  const height = rows * cell;
  const x0 = centerX - width / 2;
  const y0 = centerY - height / 2;
  let rects = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = DISK_PIXEL_GRID[r][c];
      if (ch === 'X') {
        const x = (x0 + c * cell).toFixed(2);
        const y = (y0 + r * cell).toFixed(2);
        const s = (cell + 0.5).toFixed(2);
        rects += `<rect x="${x}" y="${y}" width="${s}" height="${s}" fill="${color}"/>`;
      } else if (ch === 'O') {
        const cx = (x0 + (c + 0.5) * cell).toFixed(2);
        const cy = (y0 + (r + 0.5) * cell).toFixed(2);
        rects += `<circle cx="${cx}" cy="${cy}" r="${(cell / 2).toFixed(2)}" fill="${color}"/>`;
      }
    }
  }
  return rects;
}

function topLabelWithIcon(label, y, fontSize) {
  const margin = 6;
  const gap = 6;
  const iconHeight = Math.round(fontSize * 0.8);
  const iconWidth = Math.round(iconHeight * 1.5);
  const textBudget = SIZE - iconWidth - gap - margin * 2;
  const text = fitText(label, fontSize, textBudget);
  const textW = text.length * fontSize * 0.58;
  const groupW = iconWidth + gap + textW;
  const startX = Math.max(margin, (SIZE - groupW) / 2);
  const iconCx = startX + iconWidth / 2;
  const iconCy = y - fontSize * 0.35;
  const textX = startX + iconWidth + gap;
  return diskIcon(iconCx, iconCy, iconWidth, '#9a9aa2') + textWithShadow(text, textX, y, fontSize, '700', 'start');
}

function staleDot(staleSec) {
  if (!staleSec || staleSec < 120) return '';
  return `<circle cx="${SIZE - 16}" cy="16" r="6" fill="${COLORS.warn}" stroke="${BG}" stroke-width="2"/>`;
}

export function renderUsage({ label, used, total, free, stale }) {
  const usedRatio = total > 0 ? used / total : 0;
  const color = thresholdColor(usedRatio);
  const fillRatio = Math.max(usedRatio, MIN_BAR_RATIO);
  const barW = Math.round(SIZE * Math.min(fillRatio, 1));
  // Hero number = space in use; the line below = space still free.
  const usedText = formatBytes(used);
  const freeText = `${formatBytes(free)} free`;

  const body = [
    `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${BG}"/>`,
    `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${TRACK}"/>`,
    `<rect x="0" y="0" width="${barW}" height="${SIZE}" fill="${color}"/>`,
    topLabelWithIcon(label, 34, 18),
    textWithShadow(fitText(usedText, 46), SIZE / 2, 112, 46),
    textWithShadow('used', SIZE / 2, 138, 20, '600'),
    textWithShadow(fitText(freeText, 24), SIZE / 2, 176, 24, '600'),
    staleDot(stale),
  ].join('');

  return toDataUrl(svgDoc(body));
}

function renderNeutral({ icon, line1, line2, accent }) {
  const accentColor = accent || COLORS.muted;
  const body = [
    `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${BG}"/>`,
    icon ? `<text x="${SIZE / 2}" y="92" font-size="64" text-anchor="middle" fill="${accentColor}">${escapeXml(icon)}</text>` : '',
    line1 ? textWithShadow(fitText(line1, 26), SIZE / 2, 138, 26, '700') : '',
    line2 ? textWithShadow(fitText(line2, 22), SIZE / 2, 172, 22, '600') : '',
  ].join('');
  return toDataUrl(svgDoc(body));
}

export function renderLoading({ label }) {
  return renderNeutral({ icon: '…', line1: label || 'Disk', line2: 'loading' });
}

export function renderNoSelection() {
  return renderNeutral({ icon: '💾', line1: 'Disk Status', line2: 'Pick a disk' });
}

export function renderNotFound({ label }) {
  return renderNeutral({ icon: '⏏', line1: label || 'Disk', line2: 'Not connected', accent: COLORS.warn });
}

export function renderError({ label, msg }) {
  return renderNeutral({ icon: '⚠', line1: label || 'Disk', line2: msg || 'error', accent: COLORS.warn });
}
