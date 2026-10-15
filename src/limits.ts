/** Conservative limits for packing questions into one engine request. */
export const MAX_REQUEST_BODY_BYTES = 28 * 1024 * 1024;
export const MAX_QUESTIONS_PER_REQUEST = 128;

export function estimateRequestBytes(body: unknown): number {
  return Buffer.byteLength(JSON.stringify(body), "utf8");
}
