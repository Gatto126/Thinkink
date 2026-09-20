import { Parser } from 'htmlparser2';
import { imagePublicUrl } from './image-urls';

// Priority order: original social image, Twitter, structured article image,
// then images inside the article itself. Never guess URLs or strip signatures.
export function imageCandidates(html: string, articleUrl: string): string[] {
  const groups: string[][] = [[], [], [], []];
  const add = (value: unknown, group: number) => {
    if (typeof value !== 'string') return;
    const url = imagePublicUrl(value.trim(), articleUrl);
    if (url && groups[group]!.length < 24) groups[group]!.push(url.href);
  };
  const jsonImage = (value: unknown, depth = 0): void => {
    if (depth > 5 || !value) return;
    if (typeof value === 'string') {
      add(value, 2);
      return;
    }
    if (Array.isArray(value)) {
      value.slice(0, 12).forEach((item) => jsonImage(item, depth + 1));
      return;
    }
    if (typeof value === 'object') {
      const item = value as Record<string, unknown>;
      add(item.contentUrl ?? item.url, 2);
    }
  };
  const structured = (value: unknown, depth = 0): void => {
    if (depth > 6 || !value) return;
    if (Array.isArray(value)) {
      value.slice(0, 30).forEach((item) => structured(item, depth + 1));
      return;
    }
    if (typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    const types = Array.isArray(item['@type'])
      ? item['@type']
      : [item['@type']];
    if (
      types.some(
        (type) =>
          typeof type === 'string' &&
          /(?:Article|Posting|WebPage|Report|Photograph)$/.test(type),
      )
    ) {
      jsonImage(item.image);
      jsonImage(item.primaryImageOfPage);
    }
    structured(item['@graph'], depth + 1);
    structured(item.mainEntity, depth + 1);
  };
  const srcset = (value: string | undefined) => {
    if (!value) return;
    value
      .split(',')
      .map((part) => {
        const [url, size] = part.trim().split(/\s+/);
        return {
          url,
          size: Number.parseFloat(size ?? '1'),
          width: size?.endsWith('w'),
        };
      })
      .filter((item) => !item.width || item.size >= 640)
      .sort((a, b) => b.size - a.size)
      .slice(0, 6)
      .forEach((item) => add(item.url, 3));
  };
  let articleDepth = 0,
    json = '',
    inJson = false;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        if (name === 'article' || name === 'main') articleDepth++;
        if (name === 'meta') {
          const property = (attrs.property ?? attrs.name ?? '').toLowerCase();
          if (
            ['og:image', 'og:image:url', 'og:image:secure_url'].includes(
              property,
            )
          )
            add(attrs.content, 0);
          if (['twitter:image', 'twitter:image:src'].includes(property))
            add(attrs.content, 1);
        }
        if (name === 'link' && attrs.rel === 'image_src') add(attrs.href, 2);
        if (
          name === 'script' &&
          attrs.type?.toLowerCase() === 'application/ld+json'
        ) {
          inJson = true;
          json = '';
        }
        if (articleDepth && (name === 'img' || name === 'source')) {
          srcset(attrs.srcset ?? attrs['data-srcset']);
          if (name === 'img') {
            if (
              (Number(attrs.width) > 0 && Number(attrs.width) < 640) ||
              (Number(attrs.height) > 0 && Number(attrs.height) < 360)
            )
              return;
            add(attrs['data-src'], 3);
            add(attrs.src, 3);
          }
        }
      },
      ontext(text) {
        if (inJson && json.length < 131072) json += text;
      },
      onclosetag(name) {
        if (name === 'article' || name === 'main')
          articleDepth = Math.max(0, articleDepth - 1);
        if (name === 'script' && inJson) {
          try {
            structured(JSON.parse(json));
          } catch {
            /* Invalid metadata is optional. */
          }
          inJson = false;
        }
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  // Explicit article metadata takes precedence over inline avatars, ads and
  // related-story thumbnails. Only scan inline photos when metadata is absent.
  const metadata = groups.slice(0, 3).flat();
  return [...new Set(metadata.length ? metadata : groups[3])].slice(0, 6);
}
