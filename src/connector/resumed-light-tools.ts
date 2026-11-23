import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

/** 旧 Codex 线程固定了初建工具。恢复时通过本轮私有的原生 MCP 入口提供当前契约。 */
export async function resumedLightTools(
  tools: Tool[],
  invoke: (name: string, args: unknown, callId: string) => Promise<unknown>,
) {
  const authorization = "Bearer " + randomUUID();
  const listener = createServer(async (req, res) => {
    if (
      req.method !== "POST" ||
      req.url !== "/" ||
      req.headers.authorization !== authorization ||
      req.headers.origin
    ) {
      res.writeHead(403).end();
      return;
    }
    const server = new Server(
      { name: "relay_light", version: "2" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    server.setRequestHandler(
      CallToolRequestSchema,
      async ({ params }, extra) => {
        if (!tools.some((t) => t.name === params.name))
          throw Error("Unknown tool");
        const result = await invoke(
          params.name,
          params.arguments,
          String(extra.requestId),
        );
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
      },
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.once("close", () => {
      void server.close().catch(() => {});
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address() as { port: number };
  return {
    config: {
      url: "http://127.0.0.1:" + address.port + "/",
      http_headers: { Authorization: authorization },
      required: true,
    },
    close() {
      listener.close();
      listener.closeAllConnections();
    },
  };
}
