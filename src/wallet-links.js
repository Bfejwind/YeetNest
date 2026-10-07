export function walletBrowseLink(name, pageUrl) {
  if (!['Phantom', 'Solflare'].includes(name)) throw new Error('Unsupported wallet.');
  const page = new URL(pageUrl);
  if (page.protocol !== 'https:' || page.username || page.password || !page.hostname.includes('.') || page.hostname.endsWith('.local')) {
    throw new Error('Open the deployed HTTPS website to continue on your phone.');
  }
  // Do not transfer query strings or fragments that could contain sensitive data.
  const destination = encodeURIComponent(page.origin + page.pathname);
  const ref = encodeURIComponent(page.origin);
  return `${name === 'Phantom' ? 'https://phantom.com' : 'https://solflare.com'}/ul/v1/browse/${destination}?ref=${ref}`;
}
