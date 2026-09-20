/** Remove numeric source markers while retaining prose and non-citation brackets. */
export function withoutCitationMarkers(text: string): string {
  return text
    .replace(/[\t ]*\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, '')
    .replace(/ +([.,;:!?])/g, '$1')
    .trim();
}
