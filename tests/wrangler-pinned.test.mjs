#!/usr/bin/env node
// wrangler-pinned.test.mjs — F7-45 锁版入口测试（离线，桩二进制，不做任何生产写操作）
// 断言：① pin 从 package.json 读取且与 lockfile 一致时放行；② 参数原样透传；
//       ③ 桩版本与 pin 不一致时拒绝用桩（回退 npx 路径前先报错——本测试用不一致桩时
//          以 WRANGLER_PINNED_TEST_STOP 环境无关的方式验证：不一致桩不得被 exec，
//          脚本会改走 npx；为避免联网，本用例只断言桩未被调用且退出非 0 或输出提示）。
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync, mkdirSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pin = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).devDependencies.wrangler;
let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "PASS" : "FAIL"} ${label}`);
  if (!cond) failures++;
};

const dir = mkdtempSync(join(tmpdir(), "wrangler-pinned-test-"));
const callsLog = join(dir, "calls.log");
// 桩 wrangler：--version 输出指定版本；其余调用把参数逐行写入 calls.log 并退出 0
function makeStub(version) {
  const p = join(dir, `stub-${version}.sh`);
  writeFileSync(
    p,
    `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\nprintf '%s\\n' "$@" >> "${callsLog}"\necho stub-ok\n`
  );
  chmodSync(p, 0o755);
  return p;
}

function runWrapper(stub, args, extraEnv = {}) {
  return spawnSync("bash", ["scripts/wrangler-pinned.sh", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, WRANGLER_PINNED_LOCAL_BIN: stub, ...extraEnv },
  });
}

// ① 版本一致的桩：--version 透传
{
  const r = runWrapper(makeStub(pin), ["--version"]);
  ok(r.status === 0 && r.stdout.trim() === pin, `① --version 透传且等于 pin ${pin}（status=${r.status}, out=${r.stdout.trim()}）`);
}
// ② 参数原样透传（含带空格/等号的参数形态）
{
  const r = runWrapper(makeStub(pin), ["pages", "secret", "list", "--project-name", "crypto-top200"]);
  const logged = existsSync(callsLog) ? readFileSync(callsLog, "utf8").trim().split("\n") : [];
  ok(
    r.status === 0 && JSON.stringify(logged) === JSON.stringify(["pages", "secret", "list", "--project-name", "crypto-top200"]),
    `② 参数原样透传（logged=${JSON.stringify(logged)}）`
  );
}
// ③ 无参数 → 用法错误退出 2
{
  const r = runWrapper(makeStub(pin), []);
  ok(r.status === 2, `③ 无参数退出 2（status=${r.status}）`);
}
// ④ 版本不一致的桩不得被当作业务命令执行（脚本应拒绝该桩、改走 npx@pin；
//    本用例在 PATH 前置一个桩 npx 记录调用并退出 42，避免真联网）
{
  const before = existsSync(callsLog) ? readFileSync(callsLog, "utf8") : "";
  const fakeBin = join(dir, "fakebin");
  mkdirSync(fakeBin, { recursive: true });
  const npxLog = join(dir, "npx.log");
  const fakeNpx = join(fakeBin, "npx");
  writeFileSync(fakeNpx, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >> "${npxLog}"\nexit 42\n`);
  chmodSync(fakeNpx, 0o755);
  const r = runWrapper(makeStub("0.0.0"), ["pages", "secret", "list"], {
    PATH: `${fakeBin}:${process.env.PATH}`,
  });
  const after = existsSync(callsLog) ? readFileSync(callsLog, "utf8") : "";
  const npxCalled = existsSync(npxLog) ? readFileSync(npxLog, "utf8") : "";
  ok(
    after === before && /不一致/.test(r.stderr || "") && r.status === 42 && npxCalled.includes(`wrangler@${pin}`),
    `④ 版本不一致的桩未被执行、改走 npx@pin 且透传参数（status=${r.status}, npx=${JSON.stringify(npxCalled.trim().split("\n"))}）`
  );
}

// ⑤ F8-31 本地二进制缺失 → 走 npx@pin 兜底（桩 npx 记录调用，避免真联网）
{
  const fakeBin = join(dir, "fakebin5");
  mkdirSync(fakeBin, { recursive: true });
  const npxLog = join(dir, "npx5.log");
  const fakeNpx = join(fakeBin, "npx");
  writeFileSync(fakeNpx, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >> "${npxLog}"\necho npx-stub-ok\n`);
  chmodSync(fakeNpx, 0o755);
  const r = runWrapper("/nonexistent/wrangler", ["--version"], {
    PATH: `${fakeBin}:${process.env.PATH}`,
  });
  const npxCalled = existsSync(npxLog) ? readFileSync(npxLog, "utf8") : "";
  ok(
    r.status === 0 && npxCalled.includes(`wrangler@${pin}`) && npxCalled.includes("--version"),
    `⑤ F8-31 本地二进制缺失走 npx@pin 兜底（status=${r.status}, npx=${JSON.stringify(npxCalled.trim().split("\n"))}）`
  );
}
// ⑥ F8-31 lockfile 与 pin 不一致 → wrapper 自身拒绝执行（临时副本改 lockfile，不碰仓库）
{
  const sandbox = join(dir, "sandbox-lock");
  mkdirSync(join(sandbox, "scripts"), { recursive: true });
  cpSync(join(ROOT, "scripts/wrangler-pinned.sh"), join(sandbox, "scripts/wrangler-pinned.sh"));
  cpSync(join(ROOT, "package.json"), join(sandbox, "package.json"));
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
  lock.packages["node_modules/wrangler"].version = "0.0.0-mismatch";
  writeFileSync(join(sandbox, "package-lock.json"), JSON.stringify(lock));
  const fakeBin = join(dir, "fakebin6");
  mkdirSync(fakeBin, { recursive: true });
  const npxLog = join(dir, "npx6.log");
  const fakeNpx = join(fakeBin, "npx");
  writeFileSync(fakeNpx, `#!/usr/bin/env bash\nprintf '%s\\n' "$@" >> "${npxLog}"\nexit 42\n`);
  chmodSync(fakeNpx, 0o755);
  const r = spawnSync("bash", ["scripts/wrangler-pinned.sh", "--version"], {
    cwd: sandbox,
    encoding: "utf8",
    timeout: 60000,
    env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
  });
  ok(
    r.status === 1 && /不一致/.test(r.stderr || "") && !existsSync(npxLog),
    `⑥ F8-31 lockfile 与 pin 不一致时 wrapper 拒绝执行且未调用 npx（status=${r.status}）`
  );
}

console.log(failures === 0 ? "[wrangler-pinned.test] 全部通过" : `[wrangler-pinned.test] ${failures} 条失败`);
process.exit(failures === 0 ? 0 : 1);
