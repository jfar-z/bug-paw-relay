// 在样式和应用加载前恢复旧版偏好，存储受限时沿用 HTML 的 BUG 皮肤。
try {
  const saved = localStorage.getItem("relay-theme");
  if (saved === "light" || saved === "dark" || saved === "bug") {
    document.documentElement.dataset.theme = saved;
  }
} catch {
  // 浏览器可能禁止访问站点存储。
}
