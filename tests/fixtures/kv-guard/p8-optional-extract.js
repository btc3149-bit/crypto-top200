// F8-03 样本：可选链方法抽取
export async function onRequest({ env }) {
  const p = env.BOARD_KV?.put;
  await p("v1:board:current", "{}");
}
