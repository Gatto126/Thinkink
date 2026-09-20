import { useState } from 'react';

export function PublisherIcon({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  // Send only the publisher's hostname, never the article path or query.
  const hostname = new URL(url).hostname;
  return (
    <span className="publisher-icon" aria-hidden="true">
      {failed ? (
        <span className="publisher-initial">
          {name.trim().charAt(0).toUpperCase()}
        </span>
      ) : (
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32`}
          width={16}
          height={16}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
