// shared/http.js — F6-33：安全响应头单一定义。
// board.js 与 health.js 共同 import，全出口同带，避免端点间口径漂移
// （public/_headers 对 Pages Function 不生效，Function 必须自带）。
export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'",
};
