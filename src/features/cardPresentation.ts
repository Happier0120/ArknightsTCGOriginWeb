export function effectTypeLabel(category: string) {
  if (category.includes("天赋")) return "天赋";
  if (category.includes("技能")) return "技能";
  if (category.includes("关键词")) return "关键词";
  if (category.includes("指令")) return "指令";
  if (category.includes("支援")) return "支援";
  if (category.includes("场地")) return "场地";
  return category;
}
