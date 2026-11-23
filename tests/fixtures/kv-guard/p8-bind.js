// 原已拦类别：bind 转手（方法抽取点即拦）
export async function onRequest({ env }) {
  const p = env.BOARD_KV.put.bind(env.BOARD_KV);
  await p("v1:board:current", "{}");
}
