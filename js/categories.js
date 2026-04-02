/**
 * 效果分类注册表
 *
 * 新增分类只需在数组中添加一项，计算引擎和UI会自动适配。
 * 例如新增"脆弱"：
 *   { key: "fragile", label: "脆弱" }
 */
export const categories = [
  { key: "DMG_Dealt", label: "增伤" },
  { key: "DMG_Taken", label: "易伤" },
  { key: "Susceptibility", label: "脆弱" },
  { key: "Arts_Amp", label: "增幅" },
  { key: "Resistance", label: "抗性" },
  { key: "Link", label: "连击" },
  { key: "Staggered", label: "失衡" },



  { key: "Da_Pan_MORE_SPICE!", label: "大潘独有" },
  { key: "Rossi_Boiling_Blood", label: "洛茜独有" },
  { key: "Laevatain_Fragments_from_the_Past", label: "莱万汀独有" },
  { key: "Alesh_Mega_Lunker_Rumors", label: "阿列什独有" },
  { key: "Avywenna_Carrot_and_Sharp_Stick", label: "艾维文娜独有" }
];
