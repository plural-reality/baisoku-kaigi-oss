import * as React from "react";

import { cn } from "@/lib/utils";

interface TextareaProps extends React.ComponentProps<"textarea"> {
  autoResize?: boolean;
}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoResize, ...props }, ref) => {
    const internalRef = React.useRef<HTMLTextAreaElement | null>(null);

    const setRefs = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        internalRef.current = node;
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      [ref],
    );

    const adjustHeight = React.useCallback(() => {
      const textarea = internalRef.current;
      if (!textarea || !autoResize) return;
      textarea.style.height = "auto";
      const maxH = parseFloat(getComputedStyle(textarea).maxHeight);
      const clamped = maxH && textarea.scrollHeight > maxH;
      textarea.style.height = clamped
        ? `${maxH}px`
        : `${textarea.scrollHeight}px`;
      textarea.style.overflowY = clamped ? "auto" : "hidden";
    }, [autoResize]);

    React.useEffect(() => {
      adjustHeight();
    }, [adjustHeight]);

    return (
      <textarea
        className={cn(
          "flex min-h-[60px] w-full rounded-lg border border-input bg-muted px-3 py-2 text-base placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          autoResize && "resize-none overflow-hidden",
          className,
        )}
        ref={setRefs}
        onInput={autoResize ? adjustHeight : undefined}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
