import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Twilio webhook signature validation (https://www.twilio.com/docs/usage/webhooks/webhooks-security).
 *
 * Same algorithm as the official `twilio` helper `validateRequest`:
 * base64(HMAC-SHA1(authToken, url + sortedParamKeys.map(k => k + value).join(""))).
 * Fails closed: a missing token, URL or signature never validates.
 */
export function computeTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(Buffer.from(data, "utf-8")).digest("base64");
}

export function isValidTwilioSignature(input: {
  authToken?: string;
  url?: string;
  signature?: string | null;
  params: Record<string, string>;
}): boolean {
  const { authToken, url, signature, params } = input;
  if (!authToken || !url || !signature) return false;
  const expected = Buffer.from(computeTwilioSignature(authToken, url, params));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
