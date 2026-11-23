// F8-34 样本：标识符 Unicode 转义方法名
export async function onRequest({ env }) {
  await env.BOARD_KV.pu\u0074("v1:board:current", "{}");
}
