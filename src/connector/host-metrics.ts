import { cpus, freemem, totalmem } from "node:os";
import { readFile, realpath, readdir, statfs } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  maxSampleGapMs,
  type HostSample,
} from "../shared/environment-metrics.js";

type Interfaces = HostSample["interfaces"];
type Disk = HostSample["resources"]["disk"];

async function linuxInterfaces(): Promise<Interfaces> {
  const [stats, names] = await Promise.all([
    readFile("/proc/net/dev", "utf8"),
    readdir("/sys/class/net"),
  ]);
  const physical = (
    await Promise.all(
      names.map(
        async (name) =>
          await realpath(join("/sys/class/net", name, "device")).then(
            () => name,
            () => null,
          ),
      ),
    )
  ).filter((name) => name !== null);
  // 容器和部分虚拟机只有虚拟网卡，此时选默认路由接口，避开桥与其下层设备重复计数。
  const selected = new Set(physical);
  if (!selected.size) {
    const routes = await readFile("/proc/net/route", "utf8").catch(() => "");
    for (const line of routes.trim().split("\n")) {
      const [name, destination, , flags, , , , mask] = line.trim().split(/\s+/);
      if (
        destination === "00000000" &&
        mask === "00000000" &&
        parseInt(flags, 16) & 1
      )
        selected.add(name);
    }
    const routes6 = await readFile("/proc/net/ipv6_route", "utf8").catch(
      () => "",
    );
    for (const line of routes6.trim().split("\n")) {
      const fields = line.trim().split(/\s+/);
      if (/^0{32}$/.test(fields[0]) && fields[1] === "00")
        selected.add(fields.at(-1)!);
    }
  }
  selected.delete("lo");
  const result: NonNullable<Interfaces> = [];
  for (const line of stats.split("\n")) {
    const [name, values] = line.trim().split(":");
    if (!selected.has(name) || !values) continue;
    const fields = values.trim().split(/\s+/);
    const index = await readFile(
      join("/sys/class/net", name, "ifindex"),
      "utf8",
    );
    result.push({
      id: name + "/" + index.trim(),
      received: Number(fields[0]),
      sent: Number(fields[8]),
    });
  }
  return result.length && result.length === selected.size ? result : null;
}

async function linuxDisk(dir: string): Promise<Disk> {
  const [path, mounts, stats] = await Promise.all([
    realpath(dir),
    readFile("/proc/self/mountinfo", "utf8"),
    statfs(dir),
  ]);
  const volume = mounts
    .trim()
    .split("\n")
    .map((line) =>
      line
        .split(" ")[4]
        .replace(/\\([0-7]{3})/g, (_, octal: string) =>
          String.fromCharCode(parseInt(octal, 8)),
        ),
    )
    .filter(
      (mount) =>
        mount === "/" || path === mount || path.startsWith(mount + "/"),
    )
    .sort((a, b) => b.length - a.length)[0];
  return volume ? { volume, availableBytes: stats.bavail * stats.bsize } : null;
}

/** 使用系统网络适配器与卷管理接口，数据目录通过环境参数传入。 */
async function windowsMetrics(
  dir: string,
): Promise<{ disk: Disk; interfaces: Interfaces }> {
  const script = [
    "$ErrorActionPreference='Stop'",
    "$disk=$null; $interfaces=$null",
    "try { $v=Get-Volume -FilePath $env:RELAY_METRICS_FILE; if ($v) { $disk=@{ volume=[string]$v.Path; availableBytes=[long]$v.SizeRemaining } } } catch {}",
    "try { $adapters=@(Get-NetAdapter -Physical | Where-Object Status -eq 'Up')",
    "if (!$adapters.Count) { $ids=@(Get-NetRoute | Where-Object { $_.DestinationPrefix -in '0.0.0.0/0','::/0' } | Select-Object -ExpandProperty InterfaceIndex -Unique); $adapters=@(Get-NetAdapter | Where-Object { $_.Status -eq 'Up' -and $_.ifIndex -in $ids }) }",
    "if ($adapters.Count) { $interfaces=@(foreach ($a in $adapters) { $s=Get-NetAdapterStatistics -Name ([System.Management.Automation.WildcardPattern]::Escape($a.Name)); if ($null -eq $s.ReceivedBytes -or $null -eq $s.SentBytes) { throw 'counter' }; @{ id=[string]$a.InterfaceGuid; received=[long]$s.ReceivedBytes; sent=[long]$s.SentBytes } }) } } catch { $interfaces=$null }",
    "@{ disk=$disk; interfaces=$interfaces } | ConvertTo-Json -Depth 4 -Compress",
  ].join("\n");
  const { stdout } = await promisify(execFile)(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      env: { ...process.env, RELAY_METRICS_FILE: join(dir, "worker.lock") },
      windowsHide: true,
      timeout: 12000,
    },
  );
  return JSON.parse(stdout);
}

function cpuTimes() {
  const processors = cpus();
  let idle = 0,
    total = 0;
  for (const { times } of processors) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.irq + times.idle;
  }
  return { count: processors.length, idle, total, at: performance.now() };
}

async function memoryPercent() {
  if (process.platform === "linux") {
    const info = await readFile("/proc/meminfo", "utf8");
    const total = Number(/^MemTotal:\s+(\d+)/m.exec(info)?.[1]);
    const available = Number(/^MemAvailable:\s+(\d+)/m.exec(info)?.[1]);
    if (!(total > 0 && available >= 0 && available <= total)) return null;
    return (1 - available / total) * 100;
  }
  return totalmem() > 0 ? (1 - freemem() / totalmem()) * 100 : null;
}

/** 每条连接独立建立基线，首帧 CPU 和累计流量都需要等待下一次采样。 */
export function hostSampler(dir: string) {
  let previous: ReturnType<typeof cpuTimes> | undefined;
  return async (): Promise<HostSample> => {
    const current = cpuTimes();
    let cpuPercent = null;
    if (
      previous &&
      current.count === previous.count &&
      current.at - previous.at <= maxSampleGapMs
    ) {
      const total = current.total - previous.total,
        idle = current.idle - previous.idle;
      if (total > 0 && idle >= 0 && idle <= total)
        cpuPercent = (1 - idle / total) * 100;
    }
    previous = current;
    const memory = memoryPercent().catch(() => null);
    let disk: Disk = null,
      interfaces: Interfaces = null;
    if (process.platform === "linux") {
      [disk, interfaces] = await Promise.all([
        linuxDisk(dir).catch(() => null),
        linuxInterfaces().catch(() => null),
      ]);
    } else if (process.platform === "win32") {
      ({ disk, interfaces } = await windowsMetrics(dir).catch(() => ({
        disk: null,
        interfaces: null,
      })));
    }
    return {
      measuredMs: Math.round(performance.now()),
      interfaces,
      resources: { cpuPercent, memoryPercent: await memory, disk },
    };
  };
}
