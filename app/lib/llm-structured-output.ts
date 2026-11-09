// OpenRouter structured outputs (response_format json_schema, strict). Shared by
// the web app and the Ptolemy agent; dependency-free because flake.nix copies it
// into the deployed agent package next to llm-models.ts.

export type JsonSchema = Readonly<Record<string, unknown>>;

export type JsonSchemaResponseFormat = {
  readonly type: "json_schema";
  readonly json_schema: {
    readonly name: string;
    readonly strict: true;
    readonly schema: JsonSchema;
  };
};

export const jsonSchemaFormat = (
  name: string,
  schema: JsonSchema,
): JsonSchemaResponseFormat => ({
  type: "json_schema",
  json_schema: { name, strict: true, schema },
});

// Strict mode needs an object at the top level on many providers, so a string
// list is wrapped as { [key]: string[] }.
export const stringListFormat = (
  name: string,
  key: string,
): JsonSchemaResponseFormat =>
  jsonSchemaFormat(name, {
    type: "object",
    properties: { [key]: { type: "array", items: { type: "string" } } },
    required: [key],
    additionalProperties: false,
  });

// Request-body fields for a structured call. Deliberately NOT
// `provider.require_parameters`: OpenRouter would then only route to endpoints
// that support every parameter in the request, and the Vertex endpoints of
// google/gemini-3.8-flash (SURVEY_STATEMENTS_MODEL in production) do not list
// `temperature`, which the agent always sends. That would silently move those
// calls from Vertex to AI Studio. All current Gemini endpoints support
// response_format, and the legacy parsers stay as the fallback if a provider
// ever ignores it.
export const structuredOutputFields = (
  format: JsonSchemaResponseFormat,
): { response_format: JsonSchemaResponseFormat } => ({
  response_format: format,
});

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

// Reads the structured { [key]: string[] } answer, or a bare string[] (older
// cached / unstructured answers). Null when the text is neither, so the caller
// can fall back to its lenient parser.
export const structuredStringList = (
  text: string,
  key: string,
): string[] | null => {
  const parsed = parseJson(text.trim());
  const list =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)[key]
      : parsed;
  return isStringArray(list) ? list : null;
};
