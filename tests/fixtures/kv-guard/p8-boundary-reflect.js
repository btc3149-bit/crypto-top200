// 已登记边界（F8-36）：Reflect 抽取写方法——守卫不覆盖，靠 baseline §5.2 人工评审清单兜底。
// 本样本断言 offenders=0 以固化边界口径：边界若变化（被拦或评审清单删除）须同步改登记。
export async function onRequest({ env }) {
  const put = Reflect.get(env.BOARD_KV, "put");
  await put.call(env.BOARD_KV, "v1:board:current", "{}");
}
