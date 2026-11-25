import { Socket } from "node:net";
import { Agent, request, type RequestOptions, type IncomingMessage } from "node:http";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AppError } from "../shared/contracts.js";
import { message } from "../shared/i18n.js";
import { backendByteLimit, backendCall, backendPort, backendResult } from "../shared/light-apps.js";

const binding = z.object({ sessionId: z.uuid(), serviceId: z.uuid() }).strict();
const invocation = binding.extend({ port: backendPort, call: backendCall });
const unavailable = () => new AppError("LIGHT_SERVICE", message("light.backend.unavailable"), 503);

/** 每次调用独占一条连接；探测后的业务请求只能复用刚验证的套接字。 */
function send(options: RequestOptions, body?: string) {
  return new Promise<IncomingMessage>((resolve, reject) => {
    const req = request(options, resolve);
    req.on("error", reject);
    req.on("upgrade", (_response, socket) => {
      socket.destroy();
      reject(unavailable());
    });
    req.end(body);
  });
}

export class LightBackend {
  private active = 0;
  constructor(private dir: string) {}

  async handle(method: string, params: unknown) {
    const invoke = method === "light.backend.call";
    const input = invoke ? invocation.parse(params) : { ...binding.parse(params), call: undefined, port: undefined };
    if (this.active >= 8) throw new AppError("LIGHT_BUSY", message("light.backend.busy"), 429);
    this.active++;
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    let dispatched = false;
    try {
      // 登记文件由来源环境维护；页面无法传入路径、端口或请求头。
      const file = await open(join(this.dir, "light-services", input.sessionId, input.serviceId + ".port"), constants.O_RDONLY | constants.O_NONBLOCK);
      let port: number;
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > 16) throw unavailable();
        const buf = Buffer.alloc(17);
        const { bytesRead } = await file.read(buf);
        const value = buf.toString("utf8", 0, bytesRead).trim();
        if (!/^\d{4,5}$/.test(value)) throw unavailable();
        port = backendPort.parse(Number(value));
      } finally { await file.close(); }
      if (input.port !== undefined && input.port !== port) throw unavailable();
      const options = { agent, hostname: "127.0.0.1", port, signal: AbortSignal.timeout(8000) };
      const probe = await send({ ...options, method: "HEAD", path: "/.well-known/bugpaw-light-service" });
      for await (const _ of probe) { /* 消费探测响应后才能复用连接。 */ }
      if (probe.statusCode !== 204 || probe.headers["x-bugpaw-light-service"] !== input.serviceId)
        throw unavailable();
      if (!input.call) return { port };
      // 服务若关闭连接则明确失败，禁止新连接在未经核验时接收业务数据。
      agent.createConnection = (_options, callback) => {
        callback?.(unavailable(), new Socket());
        return undefined;
      };
      const { method: verb, path, body } = input.call;
      dispatched = true;
      const response = await send({ ...options, method: verb, path,
        headers: body === undefined ? {} : { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      }, body);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response) {
        size += chunk.length;
        if (size > backendByteLimit) throw unavailable();
        chunks.push(chunk);
      }
      return backendResult.parse({ status: response.statusCode, body: size ? Buffer.concat(chunks).toString("utf8") : null });
    } catch {
      if (dispatched) throw new AppError("LIGHT_RESULT_UNKNOWN", message("light.backend.unknown"), 502);
      throw unavailable();
    } finally {
      agent.destroy();
      this.active--;
    }
  }
}
