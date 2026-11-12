import fs from 'node:fs';
import { PNG } from 'pngjs';

// Broaden the logo's aspect ratio by 40%, as requested for mobile shortcuts.
// A square opaque canvas is required by mobile launchers; avoid extra padding.
const source = PNG.sync.read(fs.readFileSync(new URL('../logo.png', import.meta.url)));
for (const size of [32, 180, 192, 512]) {
  const output = new PNG({ width: size, height: size });
  const scale = size / source.width;
  const verticalScale = scale / 1.4;
  const height = source.height * verticalScale;
  const top = (size - height) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const target = (y * size + x) * 4;
      output.data.set([17, 18, 22, 255], target);
      if (y < top || y >= top + height) continue;
      const sx = Math.min(source.width - 1, Math.max(0, (x + 0.5) / scale - 0.5));
      const sy = Math.min(source.height - 1, Math.max(0, (y - top + 0.5) / verticalScale - 0.5));
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      const x1 = Math.min(x0 + 1, source.width - 1), y1 = Math.min(y0 + 1, source.height - 1);
      const dx = sx - x0, dy = sy - y0;
      const sample = channel =>
        source.data[(y0 * source.width + x0) * 4 + channel] * (1 - dx) * (1 - dy) +
        source.data[(y0 * source.width + x1) * 4 + channel] * dx * (1 - dy) +
        source.data[(y1 * source.width + x0) * 4 + channel] * (1 - dx) * dy +
        source.data[(y1 * source.width + x1) * 4 + channel] * dx * dy;
      const alpha = sample(3) / 255;
      for (let c = 0; c < 3; c++) output.data[target + c] = Math.round(sample(c) * alpha + output.data[target + c] * (1 - alpha));
    }
  }
  const name = size === 180 ? 'apple-touch-icon-wide-v2.png' : size === 32 ? 'favicon-32x32.png' : `icon-wide-v2-${size}.png`;
  fs.writeFileSync(new URL(`../public/${name}`, import.meta.url), PNG.sync.write(output));
}
