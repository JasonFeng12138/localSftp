<template>
  <router-view />
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}
html, body, #app {
  height: 100%;
  font-family: "SF Pro Display", "SF Pro Text", "Neue Haas Grotesk", "Segoe UI", system-ui, sans-serif;
  color: #0f172a;
}

:root {
  --glass-bg: rgba(255, 255, 255, 0.58);
  --glass-bg-strong: rgba(255, 255, 255, 0.72);
  --glass-border: rgba(255, 255, 255, 0.55);
  --glass-shadow: 0 14px 40px rgba(15, 23, 42, 0.12);
  --glass-blur: 18px;
  --accent: #3b82f6;
  --accent-strong: #2563eb;
  --text-muted: #64748b;
}

body {
  background:
    radial-gradient(1200px 600px at 20% -10%, rgba(59, 130, 246, 0.28), transparent 60%),
    radial-gradient(1000px 600px at 100% 0%, rgba(14, 165, 233, 0.22), transparent 55%),
    radial-gradient(800px 500px at 10% 100%, rgba(99, 102, 241, 0.18), transparent 60%),
    linear-gradient(180deg, #eef2ff 0%, #e2e8f0 50%, #f1f5f9 100%);
  color: #0f172a;
}

#app {
  backdrop-filter: blur(0px);
}

/* Glass helpers for Element Plus surfaces */
.el-card,
.el-table,
.el-dialog,
.el-message-box,
.el-popover,
.el-dropdown-menu,
.el-descriptions {
  background: rgba(255, 255, 255, 0.68);
  border: 1px solid rgba(255, 255, 255, 0.5);
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08);
  backdrop-filter: blur(14px);
}

.el-card {
  border-radius: 14px;
  overflow: hidden;
}

/* 表格嵌套在卡片内时去掉自身的 box-shadow 和 border，由卡片统一处理 */
.el-card .el-table,
.el-card .el-descriptions,
.section-block .el-descriptions {
  box-shadow: none;
  border: none;
  border-radius: 0;
  backdrop-filter: none;
}

.el-dialog,
.el-message-box {
  border-radius: 18px;
}

.el-table {
  border-radius: 12px;
  overflow: hidden;
}

.el-descriptions {
  border-radius: 14px;
  overflow: hidden;
}

.el-table__header-wrapper,
.el-table__body-wrapper,
.el-table__header,
.el-table__body {
  background: transparent;
}

.el-table th.el-table__cell {
  background: rgba(241, 245, 249, 0.85) !important;
  color: #475569;
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.3px;
  border-bottom: none;
}

.el-table tr {
  background: transparent;
}

/* 斑马纹：奇数行透明，偶数行淡蓝底 */
.el-table .el-table__row:nth-child(odd) > td.el-table__cell {
  background: transparent;
}
.el-table .el-table__row:nth-child(even) > td.el-table__cell {
  background: rgba(241, 245, 249, 0.55);
}

/* 去掉行间分割线 */
.el-table td.el-table__cell {
  border-bottom: none;
}

.el-table__row:hover > td.el-table__cell {
  background: rgba(59, 130, 246, 0.07) !important;
}

.el-button--primary {
  background: linear-gradient(135deg, var(--accent) 0%, var(--accent-strong) 100%);
  border: none;
}

.el-tag {
  border-radius: 999px;
}

.el-input__wrapper,
.el-textarea__inner,
.el-select__wrapper {
  background: rgba(255, 255, 255, 0.65);
  border: 1px solid rgba(148, 163, 184, 0.35);
  box-shadow: none;
}

.el-input__wrapper.is-focus,
.el-select__wrapper.is-focus {
  border-color: rgba(59, 130, 246, 0.6);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18);
}
</style>
