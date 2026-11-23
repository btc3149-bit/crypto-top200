// 原已拦类别：call 转手（方法抽取点即拦）
export async function onRequest({ env }) {
  await env.BOARD_KV.put.call(env.BOARD_KV, "v1:board:current", "{}");
}
