// F7-03 绕过样本 3：计算属性（字面与拼接两形）
export async function onRequest({ env }) {
  await env.BOARD_KV["put"]("v1:board:current", "{}");
  await env.BOARD_KV["del" + "ete"]("v1:board:current");
}
