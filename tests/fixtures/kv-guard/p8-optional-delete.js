// F8-03 样本：可选链 delete
export async function onRequest({ env }) {
  await env.BOARD_KV?.delete("v1:board:current");
}
