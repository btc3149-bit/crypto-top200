// 原已拦类别：模板字面量键名
export async function onRequest({ env }) {
  await env.BOARD_KV[`put`]("v1:board:current", "{}");
}
