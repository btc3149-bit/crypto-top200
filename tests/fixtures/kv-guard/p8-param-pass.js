// 原已拦类别：参数传递（接收者来源不可判定，fail-closed）
export async function onRequest({ env }) {
  await write(env.BOARD_KV);
}
async function write(kv) {
  await kv.put("v1:board:current", "{}");
}
