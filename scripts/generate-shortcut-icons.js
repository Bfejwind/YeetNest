import fs from 'node:fs';
import { PNG } from 'pngjs';

// Render from the original high-resolution artwork without flattening it.
// Area averaging includes every source pixel to avoid jagged downsampled edges.
const source = PNG.sync.read(fs.readFileSync(new URL('../logo.png', import.meta.url)));
for (const size of [32, 180, 192, 512]) {
  const output = new PNG({ width: size, height: size });
  const scale = size / source.width;
  const top = (size - source.height * scale) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const target = (y * size + x) * 4;
      const background = [17, 18, 22];
      output.data.set([...background, 255], target);
      const left = x / scale, right = (x + 1) / scale;
      const upper = (y - top) / scale, lower = (y + 1 - top) / scale;
      const yStart = Math.max(0, upper), yEnd = Math.min(source.height, lower);
      if (yEnd <= yStart) continue;
      const totalArea = (right - left) * (lower - upper);
      const colors = [0, 0, 0];
      let coverage = 0;
      for (let sy = Math.floor(yStart); sy < Math.ceil(yEnd); sy++) {
        const wy = Math.min(yEnd, sy + 1) - Math.max(yStart, sy);
        for (let sx = Math.floor(left); sx < Math.min(source.width, Math.ceil(right)); sx++) {
          const weight = wy * (Math.min(right, sx + 1) - Math.max(left, sx));
          const pixel = (sy * source.width + sx) * 4;
          const alphaWeight = weight * source.data[pixel + 3] / 255;
          coverage += alphaWeight;
          for (let c = 0; c < 3; c++) colors[c] += source.data[pixel + c] * alphaWeight;
        }
      }
      for (let c = 0; c < 3; c++) output.data[target + c] = Math.round((colors[c] + background[c] * (totalArea - coverage)) / totalArea);
    }
  }
  const name = size === 180 ? 'apple-touch-icon-v3.png' : size === 32 ? 'favicon-32x32.png' : `icon-v3-${size}.png`;
  const encoded = PNG.sync.write(output);
  fs.writeFileSync(new URL(`../public/${name}`, import.meta.url), encoded);
  if (size === 180) fs.writeFileSync(new URL('../public/apple-touch-icon.png', import.meta.url), encoded);
}
