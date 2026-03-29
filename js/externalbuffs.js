/**
 * 外部 Buff 目录（场地 / 食物 / 其他消耗品）
 *
 * 数据从 data/external-buffs.json 加载，由 data-loader.js 注入。
 *
 * 用户从目录中选择添加，添加后自动生效，可删除。
 * 结构与普通 buff 一致，额外增加 group 字段用于分组显示。
 *
 * 新增条目只需在 JSON 文件对应分组下添加一项。
 */
export let externalBuffCatalog = [];

export function setExternalBuffCatalog(data) {
  externalBuffCatalog = data;
}
