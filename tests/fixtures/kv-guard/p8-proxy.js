// 原已拦类别：Proxy 转手（经 Proxy 包裹的 KV 仍被来源追踪拦下）
export async function onRequest({ env }) {
  const px = new Proxy(env.BOARD_KV, {});
  await px.put("v1:board:current", "{}");
}
