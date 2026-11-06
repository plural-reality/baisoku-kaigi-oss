"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

type ThemeProviderProps = ComponentProps<typeof NextThemesProvider>;

// /embed/* is framed into the marketing site, which always shows the light
// screens; the viewer's OS or saved theme must not turn the demo dark.
export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  const isEmbed = usePathname()?.startsWith("/embed/") ?? false;
  return (
    <NextThemesProvider {...props} forcedTheme={isEmbed ? "light" : undefined}>
      {children}
    </NextThemesProvider>
  );
}
