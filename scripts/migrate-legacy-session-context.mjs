#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const stripQuotes = (value) =>
  value.replace(/^"(.*)"$/s, "$1").replace(/^'(.*)'$/s, "$1");

const envEntries = (text) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => line.replace(/^export\s+/, ""))
    .map((line) => {
      const [key, ...valueParts] = line.split("=");
      return [key.trim(), stripQuotes(valueParts.join("=").trim())];
    });

const parseEnv = (text) => Object.fromEntries(envEntries(text));

const nonEmpty = (value) => (typeof value === "string" ? value.trim() : "");

const isBlank = (value) => nonEmpty(value) === "";

const hasText = (value) => nonEmpty(value) !== "";

const restUrl = (supabaseUrl, path) =>
  `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/${path}`;

const authHeaders = (serviceRoleKey) => ({
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
});

const responseText = (response) =>
  response.text().then((text) => (text ? text : response.statusText));

const requireOk = (response) =>
  response.ok
    ? Promise.resolve(response)
    : responseText(response).then((text) =>
        Promise.reject(
          new Error(`${response.status} ${response.statusText}: ${text}`),
        ),
      );

const jsonResponse = (response) => requireOk(response).then((ok) => ok.json());

const readPage = ({ supabaseUrl, serviceRoleKey, offset, limit }) =>
  fetch(
    restUrl(
      supabaseUrl,
      [
        "sessions",
        "?select=id,goal,context,facilitator_goal,facilitator_context,created_at",
        "&order=created_at.asc",
      ].join(""),
    ),
    {
      headers: {
        ...authHeaders(serviceRoleKey),
        "Range-Unit": "items",
        Range: `${offset}-${offset + limit - 1}`,
      },
    },
  ).then(jsonResponse);

const readAllRows = ({
  supabaseUrl,
  serviceRoleKey,
  offset = 0,
  limit = 1000,
}) =>
  readPage({ supabaseUrl, serviceRoleKey, offset, limit }).then((rows) =>
    rows.length < limit
      ? rows
      : readAllRows({
          supabaseUrl,
          serviceRoleKey,
          offset: offset + limit,
          limit,
        }).then((rest) => [...rows, ...rest]),
  );

const legacyRow = (row) =>
  isBlank(row.facilitator_goal) &&
  isBlank(row.facilitator_context) &&
  (hasText(row.goal) || hasText(row.context));

const publicFieldsStillPopulated = (row) =>
  !legacyRow(row) && (hasText(row.goal) || hasText(row.context));

const patchLegacyRow =
  ({ supabaseUrl, serviceRoleKey }) =>
  (row) =>
    fetch(
      restUrl(supabaseUrl, `sessions?id=eq.${encodeURIComponent(row.id)}`),
      {
        method: "PATCH",
        headers: {
          ...authHeaders(serviceRoleKey),
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          facilitator_goal: row.goal ?? "",
          facilitator_context: row.context ?? "",
          goal: "",
          context: "",
        }),
      },
    ).then(requireOk);

const patchRows = (config) => (rows) =>
  rows.reduce(
    (chain, row) =>
      chain.then((count) => patchLegacyRow(config)(row).then(() => count + 1)),
    Promise.resolve(0),
  );

const migrationConfig = (envPath, env) => {
  const supabaseUrl = nonEmpty(env.NEXT_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = nonEmpty(env.SUPABASE_SERVICE_ROLE_KEY);

  return !supabaseUrl
    ? {
        type: "skip",
        reason: `NEXT_PUBLIC_SUPABASE_URL not found in ${envPath}`,
      }
    : !serviceRoleKey
      ? {
          type: "skip",
          reason: `SUPABASE_SERVICE_ROLE_KEY not found in ${envPath}`,
        }
      : { type: "run", supabaseUrl, serviceRoleKey };
};

const runMigration = (config) =>
  readAllRows(config).then((rows) => {
    const legacyRows = rows.filter(legacyRow);
    const preservedPublicRows = rows.filter(publicFieldsStillPopulated);

    return patchRows(config)(legacyRows).then((updated) => ({
      inspected: rows.length,
      updated,
      preservedPublicRows: preservedPublicRows.length,
    }));
  });

const main = (envPath) =>
  readFile(envPath, "utf8")
    .then(parseEnv)
    .then((env) => migrationConfig(envPath, env))
    .then((config) =>
      config.type === "skip"
        ? console.log(
            `::notice::${config.reason}; skipping legacy session context migration`,
          )
        : runMigration(config).then(
            ({ inspected, updated, preservedPublicRows }) =>
              console.log(
                [
                  "Applied legacy session context migration",
                  `inspected=${inspected}`,
                  `updated=${updated}`,
                  `preserved_public_rows=${preservedPublicRows}`,
                ].join(" "),
              ),
          ),
    );

main(process.argv[2] ?? ".env.staging").catch((error) => {
  console.error(
    `Failed to apply legacy session context migration: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
});
