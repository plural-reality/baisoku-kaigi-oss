// A user-facing message held in state as a key (+ ICU values) rather than a
// rendered string, so it re-renders in the viewer's current locale and effects
// that set it don't need the translator in their dependency lists.
export type UiMessage<K extends string> = {
  readonly key: K;
  readonly values?: Record<string, string | number>;
};

export const uiMessage = <K extends string>(
  key: K,
  values?: Record<string, string | number>,
): UiMessage<K> => (values ? { key, values } : { key });
