// 正向样本：与现行 board.js 批准调用同形（仅在以 board.js 路径扫描时应被计为 allowed）
async function addLegacyCredits(env, credits) {
  if (!env || !env.BOARD_KV || typeof env.BOARD_KV.put !== "function") return;
  await env.BOARD_KV.put(KV_KEYS.legacyCredits, JSON.stringify({ credits }));
}
