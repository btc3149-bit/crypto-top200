// 原已拦类别：容器（对象）转手
export async function onRequest({ env }) {
  const box = { kv: env.BOARD_KV };
  await box.kv.put("v1:board:current", "{}");
}
