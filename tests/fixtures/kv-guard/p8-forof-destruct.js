// F8-33 样本：for-of 解构
export async function onRequest({ env }) {
  for (const { put } of [env.BOARD_KV]) await put("v1:board:current", "{}");
}
