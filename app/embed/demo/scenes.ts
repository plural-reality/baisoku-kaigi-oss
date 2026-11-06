export const DEMO_SCENES = ["participant", "issues", "participants"] as const;
export type DemoScene = (typeof DEMO_SCENES)[number];
export const isDemoScene = (value: unknown): value is DemoScene =>
  typeof value === "string" &&
  (DEMO_SCENES as readonly string[]).includes(value);
