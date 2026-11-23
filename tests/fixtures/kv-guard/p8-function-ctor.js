// F8-37 样本：Function 构造内写调用（构造本身即 offender）
export async function onRequest({ env }) {
  const g = new Function("env", "return env.BOARD_KV.put('k','v')");
  await g(env);
}
