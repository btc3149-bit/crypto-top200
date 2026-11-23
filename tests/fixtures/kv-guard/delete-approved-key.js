// F7-03 绕过样本 9：对批准键的 delete 仍是未批准写
export async function addLegacyCredits(env) {
  await env.BOARD_KV.delete(KV_KEYS.legacyCredits);
}
