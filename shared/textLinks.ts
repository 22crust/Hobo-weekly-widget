export type TextSegment =
  | { type: "text"; text: string }
  | { type: "link"; label: string; href: string };

const LINK_PATTERN =
  /\[([^\]]+)\]\(((?:https?:\/\/|www\.)[^\s)]+)\)|((?:https?:\/\/|www\.)[^\s<>"']+)/gi;

function normalizeSafeHref(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : /^www\./i.test(trimmed)
    ? `https://${trimmed}`
    : null;
  if (!withScheme) return null;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function splitTrailingPunctuation(rawUrl: string): {
  url: string;
  trailing: string;
} {
  let url = rawUrl;
  let trailing = "";
  while (url.length > 0 && /[.,;:!?]$/.test(url)) {
    trailing = url[url.length - 1] + trailing;
    url = url.slice(0, -1);
  }
  while (url.endsWith(")")) {
    const opens = (url.match(/\(/g) || []).length;
    const closes = (url.match(/\)/g) || []).length;
    if (closes > opens) {
      trailing = ")" + trailing;
      url = url.slice(0, -1);
    } else {
      break;
    }
  }
  return { url, trailing };
}

/**
 * Splits plain text into text and link segments, supporting both `[label](url)`
 * and bare `https://`, `http://`, or `www.` URLs.
 */
export function parseTextWithLinks(input: string): TextSegment[] {
  if (!input) return [];
  const segments: TextSegment[] = [];
  let lastIndex = 0;

  LINK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = LINK_PATTERN.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: "text",
        text: input.slice(lastIndex, match.index),
      });
    }

    const mdLabel = match[1];
    const mdUrl = match[2];
    const bareRaw = match[3];

    if (mdLabel !== undefined && mdUrl !== undefined) {
      const href = normalizeSafeHref(mdUrl);
      if (href) {
        segments.push({ type: "link", label: mdLabel, href });
      } else {
        segments.push({ type: "text", text: match[0] });
      }
      lastIndex = match.index + match[0].length;
    } else if (bareRaw !== undefined) {
      const { url, trailing } = splitTrailingPunctuation(bareRaw);
      const href = normalizeSafeHref(url);
      if (href) {
        segments.push({ type: "link", label: url, href });
        if (trailing) {
          segments.push({ type: "text", text: trailing });
        }
      } else {
        segments.push({ type: "text", text: match[0] });
      }
      lastIndex = match.index + match[0].length;
    }
  }

  if (lastIndex < input.length) {
    segments.push({
      type: "text",
      text: input.slice(lastIndex),
    });
  }

  return segments;
}
