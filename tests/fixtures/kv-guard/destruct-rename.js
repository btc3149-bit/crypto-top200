// F7-03 绕过样本 6：解构重命名取绑定
export async function onRequest({ env }) {
  const { BOARD_KV: kv } = env;
  await kv.put("v1:board:current", "{}");
}
