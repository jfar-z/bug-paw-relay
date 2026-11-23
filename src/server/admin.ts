import { resolve, join } from "node:path";
import { mkdirSync, copyFileSync } from "node:fs";
import { Store } from "./store.js";
/** 管理员只能在服务器本地执行一致性备份或二要素恢复；无需开放额外远程接口。 */
const dir = resolve(process.env.RELAY_DATA_DIR || "data");
const store = new Store(join(dir, "relay.db"));
try {
  if (process.argv[2] === "backup") {
    const destination = resolve(process.argv[3] || "");
    if (!process.argv[3]) throw new Error("请指定全新备份目录");
    mkdirSync(destination, { recursive: false, mode: 0o700 });
    await store.backup(join(destination, "relay.db"));
    copyFileSync(join(dir, "master.key"), join(destination, "master.key"));
    console.log("数据库一致性备份与主密钥已保存，请离线保护备份目录。");
  } else if (process.argv[2] === "reset-totp") {
    store.put("users", { totp: null, pendingTotp: null }, "owner");
    store.db.exec("DELETE FROM auth_sessions");
    console.log("二要素已停用，所有登录已失效。");
  } else throw new Error("用法：npm run admin -- backup <新目录> | reset-totp");
} finally {
  store.close();
}
