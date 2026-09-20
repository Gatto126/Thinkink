import { describe, expect, it, vi } from 'vitest';
import {
  resolveArticleImages,
  resolveLeadImage,
} from '../../src/content/images';
import { imageCandidates } from '../../src/content/image-metadata';
import { imagePublicUrl, publicAddress } from '../../src/content/image-urls';
const article = 'https://publisher.test/story';
function mock(
  html: string,
  options: { privateHost?: string; redirect?: string; status?: number } = {},
) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'cloudflare-dns.com')
      return Response.json({
        Status: 0,
        Answer:
          url.searchParams.get('type') === 'AAAA'
            ? []
            : [
                {
                  type: 1,
                  data:
                    url.searchParams.get('name') === options.privateHost
                      ? '127.0.0.1'
                      : '93.184.215.14',
                },
              ],
      });
    if (options.redirect && url.href === article)
      return new Response(null, {
        status: 302,
        headers: { Location: options.redirect },
      });
    return new Response(html, {
      status: options.status ?? 200,
      headers: { 'Content-Type': 'text/html' },
    });
  });
}
describe('publisher-independent image discovery', () => {
  it('accepts a new publisher and extensionless signed CDN URL without changing signatures', async () => {
    const image = 'https://cdn.test/asset?id=42&signature=a%2Fb%3D';
    mock(
      `<meta content="${image.replace(/&/g, '&amp;')}" PROPERTY="og:image">`,
    );
    expect(await resolveLeadImage(article)).toBe(image);
  });
  it('orders Open Graph, Twitter and article JSON-LD without unrelated inline photos', () => {
    expect(
      imageCandidates(
        `<head>
      <meta property=og:image content='/cover.avif'>
      <meta property='og:image:secure_url' content='/cover.avif'>
      <meta name=twitter:image content='//cdn.test/photo.webp'>
      <script type="application/ld+json">{"@graph":[{"@type":"Organization","logo":"/logo.png"},{"@type":"NewsArticle","image":[{"@type":"ImageObject","contentUrl":"/structured.png"}]}]}</script>
      </head><img src='/logo.png'><article><picture><source srcset='/small.jpg 320w, /large.jpg 1200w'><img src='/fallback.gif'></picture></article>`,
        article,
      ),
    ).toEqual([
      'https://publisher.test/cover.avif',
      'https://cdn.test/photo.webp',
      'https://publisher.test/structured.png',
    ]);
  });
  it('selects large responsive article images when metadata is missing', () => {
    expect(
      imageCandidates(
        `<img src='/logo.png'><article><img width='32' height='32' src='/avatar.png'><picture><source srcset='/small.jpg 320w, /large.jpg 1200w'><img src='/fallback.gif'></picture></article>`,
        article,
      ),
    ).toEqual([
      'https://publisher.test/large.jpg',
      'https://publisher.test/fallback.gif',
    ]);
  });
  it('accepts image formats and encoded entities without file-extension assumptions', () => {
    expect(imagePublicUrl('https://新聞.香港/photo')?.hostname).toBe(
      'xn--efvv70d.xn--j6w193g',
    );
    expect(
      imageCandidates(
        `<meta name="twitter:image" content="/image&#63;id=4&#38;v=2"><link rel="image_src" href="/picture.svg">`,
        article,
      ),
    ).toEqual([
      'https://publisher.test/image?id=4&v=2',
      'https://publisher.test/picture.svg',
    ]);
  });
  it('ignores malformed structured data and bounds untrusted metadata', () => {
    expect(
      imageCandidates(
        '<script type="application/ld+json">{oops</script><meta property="og:image" content="data:image/png;base64,bad">',
        article,
      ),
    ).toEqual([]);
    expect(
      imageCandidates(
        Array.from(
          { length: 100 },
          (_, i) => `<meta property="og:image" content="/${i}.jpg">`,
        ).join(''),
        article,
      ),
    ).toHaveLength(6);
  });
  it('rejects private URLs and search thumbnails before sending requests', async () => {
    const fetch = mock('');
    for (const url of [
      'https://localhost/a',
      'https://127.0.0.1/a',
      'https://2130706433/a',
      'https://[::1]/a',
      'https://user:pass@publisher.test/a',
      'https://publisher.test:8443/a',
      'https://host.internal/a',
      'file:///etc/passwd',
      'https://encrypted-tbn0.gstatic.com/images?q=tiny',
    ]) {
      expect(imagePublicUrl(url)).toBeNull();
      expect(await resolveLeadImage(url)).toBeNull();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('blocks private DNS destinations for articles, image CDNs and cross-host redirects', async () => {
    let fetch = mock(
      '<meta property="og:image" content="https://cdn.test/image">',
      { privateHost: 'publisher.test' },
    );
    expect(await resolveLeadImage(article)).toBeNull();
    expect(
      fetch.mock.calls.every(([url]) =>
        String(url).startsWith('https://cloudflare-dns.com/'),
      ),
    ).toBe(true);
    fetch.mockRestore();
    fetch = mock(
      '<meta property="og:image" content="https://cdn.test/image">',
      { privateHost: 'cdn.test' },
    );
    expect(await resolveLeadImage(article)).toBeNull();
    fetch.mockRestore();
    fetch = mock('', {
      privateHost: 'private.test',
      redirect: 'https://private.test/secret',
    });
    expect(await resolveLeadImage(article)).toBeNull();
    expect(
      fetch.mock.calls.some(
        ([url]) => String(url) === 'https://private.test/secret',
      ),
    ).toBe(false);
  });
  it('allows public cross-publisher redirects and checks their final metadata', async () => {
    mock('<meta property="og:image" content="/cover.jpg">', {
      redirect: 'https://syndicated.test/report',
    });
    expect(await resolveLeadImage(article)).toBe(
      'https://syndicated.test/cover.jpg',
    );
  });
  it('caps redirect loops and handles blocked publishers without failing preparation', async () => {
    const fetch = mock('', { redirect: article });
    expect(await resolveArticleImages(article)).toEqual([]);
    expect(
      fetch.mock.calls.filter(([url]) => String(url) === article),
    ).toHaveLength(3);
    fetch.mockRestore();
    mock('', { status: 403 });
    expect(await resolveLeadImage(article)).toBeNull();
  });
  it('uses the supplied original when metadata is blocked, subject to public DNS checks', async () => {
    const fetch = mock('', { status: 403 });
    expect(
      await resolveArticleImages(article, 'https://cdn.test/original.webp'),
    ).toEqual(['https://cdn.test/original.webp']);
    fetch.mockRestore();
    mock('', { status: 403, privateHost: 'cdn.test' });
    expect(
      await resolveArticleImages(article, 'https://cdn.test/original.webp'),
    ).toEqual([]);
  });
  it('caps HTML at one megabyte and fails closed when DNS is unavailable', async () => {
    const fetch = mock(
      'x'.repeat(1048576) +
        '<meta property="og:image" content="/too-late.jpg">',
    );
    expect(await resolveLeadImage(article)).toBeNull();
    fetch.mockRejectedValue(new Error('timeout'));
    expect(await resolveLeadImage(article)).toBeNull();
  });
  it('rejects non-public IPv4 and IPv6 address ranges', () => {
    for (const address of [
      '0.0.0.0',
      '10.0.0.1',
      '127.0.0.1',
      '100.64.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '192.0.2.1',
      '198.18.0.1',
      '198.51.100.1',
      '203.0.113.1',
      '224.0.0.1',
      '999.1.1.1',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      'fe80::1',
      '2001:db8::1',
      '2002:7f00:1::',
      '2001::1',
      '64:ff9b::1',
    ])
      expect(publicAddress(address), address).toBe(false);
    expect(publicAddress('93.184.215.14')).toBe(true);
    expect(publicAddress('2606:4700:4700::1111')).toBe(true);
  });
});
