// F7-03 绕过样本 11：计算属性键为变量，方法名不可静态判定 → fail-closed
export async function onRequest({ env }, m) {
  await env.BOARD_KV[m]("v1:board:current", "{}");
}
