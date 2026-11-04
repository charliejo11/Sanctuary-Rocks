// Allow-list HTML sanitizer for Roadie Manual text. What is saved here is shown to other staff, so everything that
// is not a known harmless tag is dropped on the server, whatever the browser sent. Text is kept, markup is not.
const ALLOWED = new Set(["p", "h3", "h4", "b", "strong", "i", "em", "u", "ul", "ol", "li", "br", "a", "blockquote"]);
const VOID = new Set(["br"]);
const DROP_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math", "title", "textarea", "select"]);
const CLASSES = new Set(["listline", "subhead"]);

const escapeText = (s) => s.replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s) => s.replace(/&(?!amp;)/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function safeHref(value) {
  // browsers ignore control characters and whitespace inside a scheme: strip them before judging it
  const v = value.replace(/&#x?[0-9a-f]+;?/gi, (m) => {
    const n = /x/i.test(m) ? parseInt(m.replace(/[^0-9a-f]/gi, "").slice(0), 16) : parseInt(m.replace(/\D/g, ""), 10);
    return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : "";   // out of range: dropped, not a crash
  }).replace(/[\u0000- \u007f-\u009f]/g, "");
  if (/^https?:\/\//i.test(v) || /^secondlife:\/\//i.test(v) || /^\/(?!\/)/.test(v) || /^#/.test(v)) return value.trim();
  return null;
}

export function sanitizeHtml(input) {
  const html = String(input ?? "").replace(/<!--[\s\S]*?-->/g, "");
  const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let out = "", last = 0, m, skip = null;
  const open = [];
  while ((m = tagRe.exec(html))) {
    if (!skip) out += escapeText(html.slice(last, m.index));
    last = tagRe.lastIndex;
    const closing = !!m[1], tag = m[2].toLowerCase(), attrs = m[3] ?? "";
    if (skip) {
      if (closing && tag === skip) skip = null;
      continue;
    }
    if (DROP_CONTENT.has(tag)) {
      if (!closing && !attrs.trim().endsWith("/")) skip = tag;
      continue;
    }
    if (!ALLOWED.has(tag)) continue;
    if (closing) {
      const i = open.lastIndexOf(tag);
      if (i === -1) continue;
      while (open.length > i) out += `</${open.pop()}>`;
      continue;
    }
    if (VOID.has(tag)) { out += `<${tag}>`; continue; }
    let extra = "";
    const cls = attrs.match(/\sclass\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (cls) {
      const good = (cls[2] ?? cls[3] ?? "").split(/\s+/).filter((c) => CLASSES.has(c));
      if (good.length) extra += ` class="${good.join(" ")}"`;
    }
    if (tag === "a") {
      const href = attrs.match(/\shref\s*=\s*("([^"]*)"|'([^']*)')/i);
      const safe = href && safeHref(href[2] ?? href[3] ?? "");
      if (!safe) continue;                       // a link with an unsafe target becomes plain text
      extra += ` href="${escapeAttr(safe)}" rel="noopener noreferrer"`;
      if (/^https?:/i.test(safe)) extra += ' target="_blank"';
    }
    out += `<${tag}${extra}>`;
    open.push(tag);
  }
  if (!skip) out += escapeText(html.slice(last));
  while (open.length) out += `</${open.pop()}>`;
  return out;
}
