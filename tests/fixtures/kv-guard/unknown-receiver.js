// F7-03 绕过样本 10：接收者来源不可判定（形参）→ fail-closed
export async function onRequest(store) {
  await store.put("v1:board:current", "{}");
}
