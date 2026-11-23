// F8-03 样本：可选链 + 计算属性
export async function onRequest({ env }) {
  await env.BOARD_KV?.["put"]("v1:board:current", "{}");
}
