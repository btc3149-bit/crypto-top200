// F7-03 绕过样本 4：间接别名链 + env 别名
export async function onRequest(context) {
  const e = context.env;
  const k2 = e.BOARD_KV;
  const k3 = k2;
  await k3.delete("v1:meta:health");
}
