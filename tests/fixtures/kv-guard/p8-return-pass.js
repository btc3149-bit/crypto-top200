// 原已拦类别：返回值传递（来源不可静态判定，fail-closed）
export async function onRequest({ env }) {
  const kv = getKv(env);
  await kv.put("v1:board:current", "{}");
}
function getKv(env) { return env.BOARD_KV; }
