"use client";

import { type ComponentProps, Fragment, type ReactNode } from "react";

import { Markdown } from "@/components/Markdown";
import { StatementTagPopover } from "@/components/report/StatementTagPopover";

type StatementTagContext = Readonly<{
  sessionId: string;
  accessToken: string;
  reportId: string;
  userId: string;
}>;

type TextSegment = Readonly<{
  kind: "text";
  key: string;
  text: string;
}>;

type TagSegment = Readonly<{
  kind: "tag";
  key: string;
  statementNumber: number;
}>;

export type StatementTagSegment = TextSegment | TagSegment;

type SplitAccumulator = Readonly<{
  segments: ReadonlyArray<StatementTagSegment>;
  lastIndex: number;
}>;

type MarkdownComponents = NonNullable<
  ComponentProps<typeof Markdown>["components"]
>;

type ReportMarkdownProps = StatementTagContext &
  Readonly<{
    children: string;
  }>;

const STATEMENT_TAG_PATTERN = /#(\d+)/g;

const appendTextSegment = (
  segments: ReadonlyArray<StatementTagSegment>,
  key: string,
  text: string,
): ReadonlyArray<StatementTagSegment> =>
  text.length > 0 ? [...segments, { kind: "text", key, text }] : segments;

export const splitStatementTags = (
  text: string,
): ReadonlyArray<StatementTagSegment> => {
  const result = Array.from(text.matchAll(STATEMENT_TAG_PATTERN)).reduce(
    (acc: SplitAccumulator, match): SplitAccumulator => {
      const raw = match[0] ?? "";
      const index = match.index ?? acc.lastIndex;
      const statementNumber = Number.parseInt(match[1] ?? "", 10);
      const segmentsWithPrefix = appendTextSegment(
        acc.segments,
        `text-${acc.lastIndex}-${index}`,
        text.slice(acc.lastIndex, index),
      );

      return {
        segments: [
          ...segmentsWithPrefix,
          Number.isFinite(statementNumber)
            ? {
                kind: "tag",
                key: `tag-${index}-${statementNumber}`,
                statementNumber,
              }
            : {
                kind: "text",
                key: `text-${index}-${index + raw.length}`,
                text: raw,
              },
        ],
        lastIndex: index + raw.length,
      };
    },
    { segments: [], lastIndex: 0 } satisfies SplitAccumulator,
  );

  return appendTextSegment(
    result.segments,
    `text-${result.lastIndex}-${text.length}`,
    text.slice(result.lastIndex),
  );
};

const renderStatementTagString =
  (context: StatementTagContext) =>
  (text: string): ReactNode =>
    context.userId.length === 0
      ? text
      : splitStatementTags(text).map((segment) =>
          segment.kind === "text" ? (
            <Fragment key={segment.key}>{segment.text}</Fragment>
          ) : (
            <StatementTagPopover
              key={segment.key}
              statementNumber={segment.statementNumber}
              sessionId={context.sessionId}
              accessToken={context.accessToken}
              reportId={context.reportId}
              userId={context.userId}
            />
          ),
        );

const renderStatementTaggedNode =
  (context: StatementTagContext) =>
  (children: ReactNode): ReactNode => {
    const renderNode = renderStatementTaggedNode(context);
    return typeof children === "string"
      ? renderStatementTagString(context)(children)
      : typeof children === "number"
        ? renderStatementTagString(context)(String(children))
        : Array.isArray(children)
          ? // Segment keys are local to each child string, so two sibling text
            // nodes (e.g. around inline formatting) can collide on keys like
            // `text-0-1`. Scope each child's subtree under a per-child key.
            children.map((child, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: markdown children come from a stable AST and are never reordered/filtered
              <Fragment key={`child-${index}`}>{renderNode(child)}</Fragment>
            ))
          : children;
  };

const createStatementTagComponents = (
  context: StatementTagContext,
): MarkdownComponents => {
  const renderTags = renderStatementTaggedNode(context);
  return {
    p: ({ children }) => <p>{renderTags(children)}</p>,
    li: ({ children }) => <li>{renderTags(children)}</li>,
    td: ({ children }) => <td>{renderTags(children)}</td>,
    th: ({ children }) => <th>{renderTags(children)}</th>,
    strong: ({ children }) => <strong>{renderTags(children)}</strong>,
    em: ({ children }) => <em>{renderTags(children)}</em>,
  };
};

export const ReportMarkdown = ({
  children,
  sessionId,
  accessToken,
  reportId,
  userId,
}: ReportMarkdownProps) => (
  <Markdown
    components={createStatementTagComponents({
      sessionId,
      accessToken,
      reportId,
      userId,
    })}
  >
    {children}
  </Markdown>
);
