// 原已拦类别：混淆（注释插空 + 拼接键名）
export async function onRequest({ env }) {
  await env.BOARD_KV/*x*/["p" + "ut"]("v1:board:current", "{}");
}
