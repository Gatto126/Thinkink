// Only credential-free HTTPS URLs on public DNS names. Never accept local IP
// literals, alternate ports or browser-only schemes from publisher metadata.
export function imagePublicUrl(value: string, base?: string): URL | null {
  try {
    if (value.length > 4096) return null;
    const url = new URL(value, base);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(
        host,
      ) ||
      /\.(?:localhost|local|internal|lan|home|arpa|onion)$/.test(host) ||
      /^(?:encrypted-)?tbn\d*\.(?:gstatic|google)\.com$/.test(host)
    )
      return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

export function publicAddress(value: string): boolean {
  if (value.includes(':')) {
    // Global unicast only; exclude documentation, transition and special-use
    // prefixes (including IPv4-mapped, NAT64, loopback and link-local ranges).
    const first = Number.parseInt(value.split(':')[0] ?? '', 16);
    if (first < 0x2000 || first > 0x3fff || !Number.isFinite(first))
      return false;
    if (!/^[a-f0-9:]+$/i.test(value)) return false;
    if (first === 0x2002 || first === 0x3fff) return false;
    if (first === 0x2001) {
      const second = Number.parseInt(value.split(':')[1] || '0', 16);
      if (second < 0x200 || second === 0xdb8) return false;
    }
    return true;
  }
  const parts = value.split('.');
  if (
    parts.length !== 4 ||
    parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)
  )
    return false;
  const [a, b, c] = parts.map(Number) as [number, number, number, number];
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

export async function hasPublicDns(
  host: string,
  signal: AbortSignal,
): Promise<boolean> {
  const results = await Promise.all(
    ['A', 'AAAA'].map(async (type) => {
      const response = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
        {
          headers: { Accept: 'application/dns-json' },
          redirect: 'manual',
          signal,
        },
      );
      if (!response.ok) throw new Error('DNS unavailable');
      const text = await boundedText(response, 16384);
      const data = JSON.parse(text) as {
        Status?: number;
        Answer?: { type: number; data: string }[];
      };
      if (data.Status !== 0) throw new Error('DNS unavailable');
      return (data.Answer ?? [])
        .filter((answer) => answer.type === 1 || answer.type === 28)
        .map((answer) => answer.data);
    }),
  );
  const addresses = results.flat();
  return addresses.length > 0 && addresses.every(publicAddress);
}

export async function boundedText(
  response: Response,
  limit: number,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '',
    size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, limit - size);
      size += chunk.byteLength;
      text += decoder.decode(chunk, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel();
  }
}
