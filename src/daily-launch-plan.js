export const DAILY_LAUNCH_COUNT = 5;
export const animalArtwork = [
  ['golden-retriever', 'Golden Retriever Shades', 'GOLDPUP'], ['ginger-kitten', 'Ginger Kitten Shades', 'GINGERCAT'],
  ['rabbit', 'Rabbit Shades', 'BUNNY'], ['red-panda', 'Red Panda Shades', 'REDPANDA'],
  ['otter', 'Otter Sunshine', 'OTTERSUN'], ['hedgehog', 'Hedgehog Chill', 'HEDGECHILL'],
  ['corgi', 'Corgi Cool', 'CORGI'], ['capybara', 'Capy Sunshine', 'CAPYSUN'],
  ['raccoon', 'Raccoon Rays', 'RACRAYS'], ['koala', 'Koala Shades', 'KOALASHADE'],
];
export function rotatingTemplate(slot, now = new Date(), base = null) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= DAILY_LAUNCH_COUNT) throw new Error('Invalid daily launch slot.');
  const date = singaporeDay(now).date;
  const dayOffset = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse('2026-10-26T00:00:00Z')) / 86400000);
  const index = ((dayOffset * DAILY_LAUNCH_COUNT + slot) % animalArtwork.length + animalArtwork.length) % animalArtwork.length;
  const [file, name, ticker] = animalArtwork[index];
  return { fields: { description: 'A little sunshine, a lot of cool.', initialBuy: '0', initialSlippage: '100', ...base?.fields, name, ticker }, image: `/weekday-animals/${file}.png` };
}
export function singaporeDay(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, due: (Number(parts.hour) * 60 + Number(parts.minute)) >= 555 };
}
