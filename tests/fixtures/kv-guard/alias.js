// F7-03 绕过样本 1：直接别名
export async function onRequest(context) {
  const kv = context.env.BOARD_KV;
  await kv.put("v1:board:current", "{}");
}
