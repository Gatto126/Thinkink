import { imageCandidates } from './image-metadata';
import { boundedText, hasPublicDns, imagePublicUrl } from './image-urls';

// Enrich any public publisher, without credentials, browser cookies or script
// execution. Validate DNS and every redirect; bound time, bytes and candidates.
async function discoverArticleImages(articleUrl: string): Promise<string[]> {
  try {
    const initial = imagePublicUrl(articleUrl.replace(/^http:/i, 'https:'));
    if (!initial) return [];
    let article: URL = initial;
    const signal = AbortSignal.timeout(6000);
    for (let redirects = 0; redirects <= 2; redirects++) {
      if (!(await hasPublicDns(article.hostname, signal))) return [];
      const response = await fetch(article.href, {
        redirect: 'manual',
        signal,
        headers: {
          Accept: 'text/html, application/xhtml+xml',
          'User-Agent': 'Thinkink/0.1 (news image metadata)',
        },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        const next: URL | null = location
          ? imagePublicUrl(location, article.href)
          : null;
        if (!next || redirects === 2) return [];
        article = next;
        continue;
      }
      if (
        !response.ok ||
        !/^(?:text\/html|application\/xhtml\+xml)\b/i.test(
          response.headers.get('content-type') ?? '',
        )
      ) {
        await response.body?.cancel();
        return [];
      }
      const html = await boundedText(response, 1048576);
      const candidates = imageCandidates(html, article.href);
      const checked = new Map<string, Promise<boolean>>();
      const accepted: string[] = [];
      for (const candidate of candidates) {
        const image = imagePublicUrl(candidate)!;
        let check = checked.get(image.hostname);
        if (!check) {
          check = hasPublicDns(image.hostname, signal).catch(() => false);
          checked.set(image.hostname, check);
        }
        if (await check) accepted.push(candidate);
      }
      return accepted;
    }
  } catch {
    /* Image enrichment must never prevent saving news or an overview. */
  }
  return [];
}

export async function resolveLeadImage(
  articleUrl: string,
): Promise<string | null> {
  return (await resolveArticleImages(articleUrl))[0] ?? null;
}

export async function resolveArticleImages(
  articleUrl: string,
  providedImage?: string | null,
): Promise<string[]> {
  const images = await discoverArticleImages(articleUrl);
  const fallback = providedImage && imagePublicUrl(providedImage);
  if (fallback && images.length < 6 && !images.includes(fallback.href)) {
    try {
      if (await hasPublicDns(fallback.hostname, AbortSignal.timeout(2000)))
        images.push(fallback.href);
    } catch {
      /* A provider fallback is subject to the same public-host checks. */
    }
  }
  return images;
}
