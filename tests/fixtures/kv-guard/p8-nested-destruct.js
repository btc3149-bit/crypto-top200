// F8-33 样本：多层嵌套解构
export async function onRequest({ env }) {
  const { BOARD_KV: { put } } = env;
  await put("v1:board:current", "{}");
}
