// Renders untrusted event descriptions (Google returns HTML fragments or
// plain text; any inviter controls the content) as a safe DocumentFragment:
// text, line breaks, and validated http(s) links only. Parsing happens in
// DOMParser's inert document — nothing executes, nothing prefetches — and
// anchors are rebuilt from scratch, never cloned, so no attribute survives.

// Elements whose end implies a visual line break when flattened.
const BLOCK_TAGS = new Set(["P", "DIV", "LI", "UL", "OL", "TABLE", "TR"]);

// Google caps descriptions at 8192 chars; anything bigger means a poisoned
// cache, and the depth cap keeps crafted nesting from blowing the stack.
// Past either bound we flatten to text rather than render.
const MAX_LENGTH = 10000;
const MAX_DEPTH = 100;

// WHATWG URL parsing (not a prefix/regex check — the parser normalizes
// control-character tricks like "java\tscript:" before we see the scheme).
// Relative URLs throw and are rejected: there's no sane base for them here.
function safeUrl(raw) {
  try {
    const url = new URL(raw);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
  } catch {
    // fall through
  }
  return null;
}

// These hrefs are third-party-controlled, so unlike the app's own Google
// Calendar link, noreferrer is warranted on top of noopener.
function makeLink(href, label) {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.title = href; // hover reveals the real destination when the label lies
  a.textContent = label;
  return a;
}

// Append text, converting newlines to <br> when the source was plain text
// (HTML sources treat newlines as insignificant whitespace instead).
function appendText(out, text, keepNewlines) {
  if (!keepNewlines) {
    out.appendChild(document.createTextNode(text));
    return;
  }
  text.split("\n").forEach((line, i) => {
    if (i > 0) out.appendChild(document.createElement("br"));
    if (line) out.appendChild(document.createTextNode(line));
  });
}

// Bare URLs in text become anchors. Trailing punctuation is trimmed as prose
// ("see https://x.com/foo.") — this can clip a URL that really ends in ")",
// a known cosmetic tradeoff over a full URL grammar.
function linkifyText(out, text, keepNewlines) {
  let last = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"]+/g)) {
    const url = match[0].replace(/[.,;:!?)\]}'"]+$/, "");
    if (match.index > last) {
      appendText(out, text.slice(last, match.index), keepNewlines);
    }
    const href = safeUrl(url);
    if (href) {
      out.appendChild(makeLink(href, url));
    } else {
      appendText(out, url, keepNewlines);
    }
    last = match.index + url.length;
  }
  if (last < text.length) {
    appendText(out, text.slice(last), keepNewlines);
  }
}

function walk(node, out, keepNewlines, depth) {
  if (depth > MAX_DEPTH) {
    linkifyText(out, node.textContent, keepNewlines);
    return;
  }
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      linkifyText(out, child.textContent, keepNewlines);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      if (child.tagName === "A") {
        const href = safeUrl(child.getAttribute("href"));
        const label = child.textContent.trim();
        if (href && label) {
          out.appendChild(makeLink(href, label));
        } else {
          // Unsafe or empty link — keep its text (linkified) instead.
          walk(child, out, keepNewlines, depth + 1);
        }
      } else if (child.tagName === "BR") {
        out.appendChild(document.createElement("br"));
      } else {
        walk(child, out, keepNewlines, depth + 1);
        if (BLOCK_TAGS.has(child.tagName)) {
          out.appendChild(document.createElement("br"));
        }
      }
    }
    // Other node types (comments, etc.) are dropped.
  }
}

export function sanitizeDescription(html) {
  const doc = new DOMParser().parseFromString(html.slice(0, MAX_LENGTH), "text/html");
  const frag = document.createDocumentFragment();
  // No element children means a plain-text description (the common case for
  // API-created events, e.g. conferencing tools) — its newlines are real.
  const keepNewlines = doc.body.childElementCount === 0;
  walk(doc.body, frag, keepNewlines, 0);
  return frag;
}
