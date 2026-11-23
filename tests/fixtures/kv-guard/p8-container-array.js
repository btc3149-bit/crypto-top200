// 原已拦类别：容器（数组）转手
export async function onRequest({ env }) {
  const arr = [env.BOARD_KV];
  await arr[0].put("v1:board:current", "{}");
}
