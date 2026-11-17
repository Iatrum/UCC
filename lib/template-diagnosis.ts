/**
 * Structured removal of the diagnosis from an HTML document template.
 *
 * Instead of a regex over raw HTML, the template is tokenised into tags / text,
 * a light element tree is built, and the smallest self-contained element that
 * holds the `{{diagnosis}}` placeholder (plus a separate "Diagnosis:" label
 * sibling, if any) is dropped. Anything that cannot be removed safely is
 * blanked in place. Callers must ALSO never pass the diagnosis value as data
 * when hiding, so a miss here can leave an empty label but never leak the value.
 */

const PLACEHOLDER = /\{\{\s*diagnosis\s*\}\}/i;
const ANY_PLACEHOLDER = /\{\{[^}]*\}\}/g;
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const INLINE = new Set(["span", "strong", "b", "em", "i", "u", "a", "small", "font", "label", "sup", "sub", "mark"]);
const UNIT = new Set(["p", "li", "dt", "dd", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote"]);
const LABEL_ONLY = /^\s*diagnos[ie]s\s*:?\s*$/i;

interface Token { kind: "text" | "open" | "close" | "other"; name?: string; raw: string; selfClose?: boolean }
interface Node { name: string; open: number; close: number; parent: Node | null; children: Node[] }

const TAG_RE = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-zA-Z][^\s/>]*(?:"[^"]*"|'[^']*'|[^>"'])*>/g;

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of html.matchAll(TAG_RE)) {
    if (m.index! > last) tokens.push({ kind: "text", raw: html.slice(last, m.index) });
    const raw = m[0];
    const tag = /^<(\/?)([a-zA-Z][^\s/>]*)/.exec(raw);
    if (!tag) tokens.push({ kind: "other", raw });
    else tokens.push({ kind: tag[1] ? "close" : "open", name: tag[2].toLowerCase(), raw, selfClose: /\/>$/.test(raw) });
    last = m.index! + raw.length;
  }
  if (last < html.length) tokens.push({ kind: "text", raw: html.slice(last) });
  return tokens;
}

function buildTree(tokens: Token[]): { root: Node; ownerOf: (Node | null)[] } {
  const root: Node = { name: "#root", open: -1, close: tokens.length, parent: null, children: [] };
  const ownerOf: (Node | null)[] = [];
  let cur = root;
  tokens.forEach((t, i) => {
    ownerOf[i] = cur === root ? null : cur;
    if (t.kind === "open") {
      const node: Node = { name: t.name!, open: i, close: i, parent: cur, children: [] };
      cur.children.push(node);
      ownerOf[i] = cur === root ? null : cur;
      if (!VOID.has(t.name!) && !t.selfClose) cur = node;
    } else if (t.kind === "close") {
      let n: Node | null = cur;
      while (n && n !== root && n.name !== t.name) n = n.parent;
      if (n && n !== root) { n.close = i; cur = n.parent ?? root; }
    }
  });
  return { root, ownerOf };
}

function textOf(tokens: Token[], n: Node, skip?: Set<number>): string {
  let s = "";
  for (let i = n.open + 1; i < n.close; i++) if (tokens[i].kind === "text" && !skip?.has(i)) s += tokens[i].raw;
  return s;
}

/** True if the element holds no other {{placeholder}} besides diagnosis. */
const onlyDiagnosisPlaceholder = (text: string) => !text.replace(new RegExp(PLACEHOLDER, "gi"), "").match(ANY_PLACEHOLDER);

function removable(tokens: Token[], n: Node): boolean {
  if (n.close <= n.open) return false; // never closed: range unknown
  const text = textOf(tokens, n);
  if (!onlyDiagnosisPlaceholder(text)) return false;
  if (UNIT.has(n.name)) return true;
  // generic container (div/section…): only when it is just a short diagnosis line
  return !INLINE.has(n.name) && text.replace(PLACEHOLDER, "").trim().length <= 40;
}

export function stripDiagnosisFromTemplate(html: string): string {
  if (!PLACEHOLDER.test(html)) return html;
  const tokens = tokenize(html);
  const { ownerOf } = buildTree(tokens);
  const dropped = new Set<number>();
  const drop = (n: Node) => { for (let i = n.open; i <= n.close; i++) dropped.add(i); };

  tokens.forEach((t, i) => {
    if (t.kind !== "text" || !PLACEHOLDER.test(t.raw) || dropped.has(i)) return;
    // Nearest non-inline ancestor chain, outward.
    let target: Node | null = null;
    for (let a = ownerOf[i]; a; a = a.parent) {
      if (INLINE.has(a.name)) continue;
      if (a.name === "table" || a.name === "tbody" || a.name === "body" || a.name === "html") break;
      if (removable(tokens, a)) {
        target = a;
        // td/th: widen to the whole row when the row only holds the diagnosis
        if ((a.name === "td" || a.name === "th") && a.parent?.name === "tr" && removable(tokens, a.parent)) target = a.parent;
        break;
      }
      if (!UNIT.has(a.name)) break; // a big container: do not delete it
    }
    if (target) {
      drop(target);
      // separate label sibling right before ("<div><b>Diagnosis:</b></div>")
      const sibs = target.parent?.children ?? [];
      const prev = sibs[sibs.indexOf(target) - 1];
      if (prev && prev.close > prev.open && LABEL_ONLY.test(textOf(tokens, prev))) drop(prev);
    }
  });

  return tokens
    .map((t, i) => {
      if (dropped.has(i)) return "";
      // fallback: blank the placeholder (and its inline "Diagnosis:" label) in place
      return t.kind === "text" ? t.raw.replace(new RegExp(`(?:diagnos[ie]s\\s*:?\\s*)?${PLACEHOLDER.source}`, "gi"), "") : t.raw;
    })
    .join("")
    .replace(new RegExp(PLACEHOLDER.source, "gi"), ""); // e.g. inside attributes
}
