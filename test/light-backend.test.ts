import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { LightBackend } from "../src/connector/light-backend.js";

test("环境端通过已登记且已验明身份的连接读写，停止、身份变化时拒绝转发", async t => {
  const home = await mkdtemp(join(tmpdir(), "light-service-"));
  t.after(() => rm(home, {recursive: true, force: true}));
  const serviceId = randomUUID(), sessionId = randomUUID();
  const backend = new LightBackend(home);
  const dataFile = join(home, "record.json");
  let identity = serviceId, closeProbe = false, writes = 0;
  const server = createServer(async (req, res) => {
    if (req.method === "HEAD" && req.url === "/.well-known/bugpaw-light-service") {
      res.writeHead(204, { "x-bugpaw-light-service": identity, connection: closeProbe ? "close" : "keep-alive" }).end();
    } else if (req.url === "/records" && req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      await writeFile(dataFile, Buffer.concat(chunks));
      writes++;
      res.writeHead(201).end('{"saved":true}');
    } else if (req.url === "/records") {
      res.end(await readFile(dataFile));
    } else res.writeHead(422).end('{"error":"invalid"}');
  });
  const start = async (port: number) => {
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
  };
  const stop = () => new Promise<void>(resolve => server.close(() => resolve()));
  await start(0);
  t.after(async () => { if (server.listening) await stop(); });
  const port = (server.address() as { port: number }).port;
  const binding = { serviceId, sessionId };
  const registration = join(home, "light-services", sessionId);
  const probe = () => backend.handle("light.backend.probe", binding);
  await assert.rejects(probe, {code: "LIGHT_SERVICE"});
  await mkdir(registration, {recursive: true});
  await writeFile(join(registration, serviceId + ".port"), String(port));
  assert.deepEqual(await probe(), {port});
  const call = (method: string, path: string, body?: string) =>
    backend.handle("light.backend.call", {...binding, port, call: {method, path, body}});
  const record = '{"name":"示例"}';
  assert.deepEqual(await call("POST", "/records", record), {status: 201, body: '{"saved":true}'});
  assert.equal(await readFile(dataFile, "utf8"), record);
  assert.deepEqual(await call("GET", "/missing"), {status: 422, body: '{"error":"invalid"}'});
  identity = randomUUID();
  await assert.rejects(call("POST", "/records", record), {code: "LIGHT_SERVICE"});
  identity = serviceId;
  closeProbe = true;
  await assert.rejects(call("POST", "/records", record));
  closeProbe = false;
  await stop();
  await assert.rejects(call("GET", "/records"), {code: "LIGHT_SERVICE"});
  await start(port);
  assert.deepEqual(await call("GET", "/records"), {status: 200, body: record});
  assert.equal(writes, 1);
});
