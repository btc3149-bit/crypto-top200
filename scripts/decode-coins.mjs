// scripts/decode-coins.mjs — JS 侧 coins.json 解码单一来源（F6-71，第六期批 5/6）
// W3-22 双形态解码：对象形态（doc.coins）直通；rows 紧凑形态按 meta.fields 解码。
// 行长契约：rows 每行长度必须恰等于 meta.fields 长度，否则抛错——禁止像旧实现
// 那样短行补 undefined / 长行静默丢弃多余值（与 Python 侧 check_meta.decode_coins
// 的 zip 截断语义分叉正是 F6-71 的问题；Python 侧断言由其文件域负责人处理）。
// 使用方：scripts/gen-paprika-map.mjs、scripts/verify-paprika-coverage.mjs。
// 注：public/index.html 与 tests/ 内的解码副本不在本模块覆盖范围内（文件域外，
// 见 P6_NOTES.md F6-71 条）。

export function decodeCoins(doc) {
  if (doc && Array.isArray(doc.coins)) return doc.coins;
  if (doc && Array.isArray(doc.rows)) {
    const fields = doc.meta && Array.isArray(doc.meta.fields) ? doc.meta.fields : null;
    if (!fields) return [];
    return doc.rows.map((r, idx) => {
      if (!Array.isArray(r) || r.length !== fields.length) {
        throw new Error(
          `decodeCoins: rows[${idx}] 行长 ${Array.isArray(r) ? r.length : typeof r} != fields 长度 ${fields.length}（行长契约违反，拒绝静默截断/补位）`
        );
      }
      const o = {};
      for (let i = 0; i < fields.length; i++) o[fields[i]] = r[i];
      return o;
    });
  }
  return [];
}

export default decodeCoins;
