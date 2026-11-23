// F7-03 绕过样本 2：解构方法
export async function onRequest({ env }) {
  const { put } = env.BOARD_KV;
  await put("v1:meta:health", "{}");
}
