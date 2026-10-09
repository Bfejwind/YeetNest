let source = null, timer = null;

export function configureMarketEvents(enabled, refresh) {
  if (!enabled) {
    source?.close(); source = null;
    clearTimeout(timer); timer = null;
    return;
  }
  if (source) return;
  source = new EventSource('/api/market/events');
  const changed = event => {
    if (document.hidden) return;
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    window.dispatchEvent(new CustomEvent('memepop-market', { detail: payload }));
    if (!timer) timer = setTimeout(() => { timer = null; refresh(); }, 5000);
  };
  source.addEventListener('market', changed);
  source.addEventListener('reset', changed);
}
