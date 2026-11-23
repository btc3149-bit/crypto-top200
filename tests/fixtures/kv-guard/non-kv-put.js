// 正向样本：已证明非 KV 的接收者（caches.default 派生）的 put 不应被拦
export async function onRequest() {
  const cache = typeof caches !== "undefined" && caches.default ? caches.default : null;
  if (cache) await cache.put("https://example.com/k", new Response("{}"));
}
