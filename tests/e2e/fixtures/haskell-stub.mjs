import { createServer } from "node:http";

const PORT = parseInt(process.env.HASKELL_STUB_PORT || "8080", 10);

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
      let _parsed = {};
      try {
        _parsed = JSON.parse(body);
      } catch {
        // ignore parse errors
      }

      const response = {
        id: "test-session-id-e2e",
        adminAccessToken: "test-admin-token-e2e",
      };

      console.log(`[${timestamp}] Responding with session:`, response);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
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
