// F8-03 样本：可选链直调 kv?.put()
export async function onRequest({ env }) {
  await env.BOARD_KV?.put("v1:board:current", "{}");
}
