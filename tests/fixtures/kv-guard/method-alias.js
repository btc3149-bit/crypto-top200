// F7-03 绕过样本 5：方法别名抽取后调用
export async function onRequest({ env }) {
  const p = env.BOARD_KV.put;
  await p("v1:board:shadow", "{}");
}
