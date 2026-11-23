// F7-03 绕过样本 7：括号取绑定
export async function onRequest({ env }) {
  await env["BOARD_KV"].put("v1:board:current", "{}");
}
