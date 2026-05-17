import DOMPurify from 'dompurify';

const ALLOWED_TAGS = ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li'];
const ALLOWED_ATTR: string[] = [];

export function sanitizeHtml(html: string | undefined | null): string {
  if (!html) return '';
  if (typeof window === 'undefined') {
    // SSR fallback: strip all HTML tags so no markup reaches the server response
    return html.replace(/<[^>]*>/g, '').trim();
  }
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}
