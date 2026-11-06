import { createServer } from "node:http";

const PORT = parseInt(process.env.LLM_STUB_PORT || "9090", 10);

const FIXED_QUESTIONS = [
  "テスト質問1: AIは仕事を奪うか？",
  "テスト質問2: リモートワークは生産性を上げるか？",
  "テスト質問3: 教育にAIを導入すべきか？",
];

const FIXED_CHAT_RESPONSE = `これはテスト用の質問です。\n---\n${FIXED_QUESTIONS.join("\n")}`;

const FIXED_REPORT_RESPONSE = `# セッションレポート

## 概要

本セッションでは、参加者間の認識の差異を可視化しました。

## 主な発見

- AIの活用に関して、参加者間で概ね合意が見られました。
- リモートワークについては意見が分かれました。

## 結論

全体として建設的な議論が行われ、チームの方向性について共通理解が深まりました。`;

const server = createServer((req, res) => {
  const timestamp = new Date().toISOString();
  let body = "";

  req.on("data", (chunk) => {
    body += chunk;
  });

  req.on("end", () => {
    console.log(
      `[${timestamp}] ${req.method} ${req.url}${body ? ` body=${body.slice(0, 200)}...` : ""}`,
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

    // POST /api/v1/chat/completions - Chat completions
    if (
      req.method === "POST" &&
      (req.url === "/api/v1/chat/completions" ||
        req.url === "/chat/completions" ||
        req.url === "/v1/chat/completions")
    ) {
      let parsed = {};
      try {
        parsed = JSON.parse(body);
      } catch {
        // ignore parse errors
      }

      const isStreaming = parsed.stream === true;

      // Detect report generation requests
      const messages = parsed.messages || [];
      const lastMessage = messages[messages.length - 1] || {};
      const messageContent = (lastMessage.content || "").toLowerCase();
      const isReportRequest =
        messageContent.includes("レポート") ||
        messageContent.includes("report") ||
        messageContent.includes("まとめ") ||
        messageContent.includes("分析");

      const responseContent = isReportRequest
        ? FIXED_REPORT_RESPONSE
        : FIXED_CHAT_RESPONSE;

      if (isStreaming) {
        console.log(
          `[${timestamp}] Responding with SSE stream (report=${isReportRequest})`,
        );
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        // Send content in chunks
        const content = responseContent;
        const chunkSize = 10;

        for (let i = 0; i < content.length; i += chunkSize) {
          const chunk = content.slice(i, i + chunkSize);
          const sseData = JSON.stringify({
            id: "chatcmpl-test",
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: "test-model",
            choices: [
              {
                index: 0,
                delta: { content: chunk },
                finish_reason: null,
              },
            ],
          });
          res.write(`data: ${sseData}\n\n`);
        }

        // Send final chunk with finish_reason
        const finalData = JSON.stringify({
          id: "chatcmpl-test",
          object: "chat.completion.chunk",
          created: Math.floor(Date.now() / 1000),
          model: "test-model",
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: "stop",
            },
          ],
        });
        res.write(`data: ${finalData}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      // Non-streaming response
      console.log(
        `[${timestamp}] Responding with JSON (report=${isReportRequest})`,
      );
      const response = {
        id: "chatcmpl-test",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "test-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: responseContent,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
      return;
    }

    // GET /api/v1/models - List models
    if (
      req.method === "GET" &&
      (req.url === "/api/v1/models" ||
        req.url === "/models" ||
        req.url === "/v1/models")
    ) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: [{ id: "test-model", object: "model", owned_by: "test" }],
        }),
      );
      return;
    }

    // Fallback - 404
    console.log(`[${timestamp}] Unhandled route: ${req.method} ${req.url}`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });
});

server.listen(PORT, () => {
  console.log(`[llm-stub] Listening on port ${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("[llm-stub] SIGTERM received, shutting down...");
  server.close(() => process.exit(0));
});

process.on("SIGINT", () => {
  console.log("[llm-stub] SIGINT received, shutting down...");
  server.close(() => process.exit(0));
});
