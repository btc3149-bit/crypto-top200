// F8-34 样本：计算属性字符串内 Unicode 转义
export async function onRequest({ env }) {
  await env.BOARD_KV["pu\u0074"]("v1:board:current", "{}");
}
