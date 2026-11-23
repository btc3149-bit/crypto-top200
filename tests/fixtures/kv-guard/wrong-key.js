// F7-03 绕过样本 8：形似批准调用但键错误（即便位于 board.js 亦应拦）
export async function addLegacyCredits(env) {
  await env.BOARD_KV.put("v1:board:current", "{}");
}
