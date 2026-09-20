// Relative provider labels are anchored to retrieval, never to the reader's clock.
export function publicationDate(label: unknown, checkedAt: string | null) {
  const publishedDateLabel =
    typeof label === 'string' ? label.trim().slice(0, 100) : null;
  const age = publishedDateLabel?.match(
    /^(\d+)\s+(second|minute|hour|day|week)s?\s+ago$/i,
  );
  const checked = checkedAt ? Date.parse(checkedAt) : NaN;
  if (age && Number.isFinite(checked)) {
    const units: Record<string, number> = {
      second: 1000,
      minute: 60000,
      hour: 3600000,
      day: 86400000,
      week: 604800000,
    };
    const date = new Date(
      checked - Number(age[1]) * units[age[2]!.toLowerCase()]!,
    );
    if (Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1970)
      return {
        publishedAt: date.toISOString(),
        publishedAtEstimated: true,
        publishedDateLabel,
      };
  }
  return { publishedAt: null, publishedAtEstimated: false, publishedDateLabel };
}
