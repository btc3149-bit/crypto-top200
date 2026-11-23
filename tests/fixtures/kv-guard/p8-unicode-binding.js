// F8-34 样本：绑定名 Unicode 转义
export async function onRequest({ env }) {
  await env.BOARD\u005fKV.put("v1:board:current", "{}");
}
