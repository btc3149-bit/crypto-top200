// F8-37 样本：eval 内写调用（eval 构造本身即 offender）
export async function onRequest({ env }) {
  eval("env.BOARD_KV.put('v1:board:current','{}')");
}
