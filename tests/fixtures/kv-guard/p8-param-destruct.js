// F8-33 样本：形参嵌套解构（来源不可判定，fail-closed）
export async function onRequest({ env: { BOARD_KV: { put } } }) {
  await put("v1:board:current", "{}");
}
