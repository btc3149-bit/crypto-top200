// F8-03 样本：可选链调用 kv.put?.()
export async function onRequest({ env }) {
  await env.BOARD_KV.put?.("v1:board:current", "{}");
}
