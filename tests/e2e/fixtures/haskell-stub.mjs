import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const PORT = parseInt(process.env.HASKELL_STUB_PORT || "8080", 10);

// The real backend projects a new session into Postgres
// (backend/src/Effect/Projection.hs) and the Next.js route polls for that row.
// With SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY set, the stub writes the same
// rows through PostgREST; without them it only answers.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const insertRows = async (table, rows) => {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(`insert ${table}: ${res.status} ${await res.text()}`);
  }
};

const projectSession = async (session, request) => {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return;
  await insertRows("sessions", [
    {
      id: session.sessionId,
      title: request.title,
      context: request.background ?? "",
      host_user_id: request.hostUserId,
      goal: request.purpose,
      is_public: false,
      admin_access_token: session.adminAccessToken,
    },
  ]);
  const questions = request.initialQuestions ?? [];
  if (questions.length > 0) {
    await insertRows(
      "statements",
      questions.map((text, index) => ({
        id: randomUUID(),
        session_id: session.sessionId,
        text,
        order_index: index + 1,
      })),
    );
  }
};

const server = createServer((req, res) => {
  const timestamp = new Date().toISOString();
  let body = "";

  req.on("data", (chunk) => {
    body += chunk;
  });

  req.on("end", () => {
    console.log(
      `[${timestamp}] ${req.method} ${req.url}${body ? ` body=${body}` : ""}`,
    );

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // POST /sessions - Create session
    if (req.method === "POST" && req.url === "/sessions") {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        // ignore parse errors
      }

      const response = {
        sessionId: randomUUID(),
        adminAccessToken: randomUUID(),
      };

      projectSession(response, parsed).then(
        () => {
          console.log(`[${timestamp}] Responding with session:`, response);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(response));
        },
        (error) => {
          console.error(`[${timestamp}] Projection failed:`, error);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: String(error) }));
        },
      );
      return;
    }

    // GET /health - Health check
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // Fallback - 404
    console.log(`[${timestamp}] Unhandled route: ${req.method} ${req.url}`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
});

server.listen(PORT, () => {
  console.log(`[haskell-stub] Listening on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[haskell-stub] SIGTERM received, shutting down...");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("[haskell-stub] SIGINT received, shutting down...");
  server.close(() => process.exit(0));
});
