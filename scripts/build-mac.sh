#!/usr/bin/env bash
# ============================================================
# build-mac.sh  —  一键构建 macOS .dmg 安装包
# 用法:
#   bash scripts/build-mac.sh          # 构建 universal (x64+arm64)
#   bash scripts/build-mac.sh --arm64  # 仅 Apple Silicon
#   bash scripts/build-mac.sh --x64    # 仅 Intel
# ============================================================
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> [1/4] 安装根目录依赖 (electron + electron-builder + 服务端依赖)..."
npm install

echo "==> [2/4] 构建 Vue 前端..."
cd client
npm install
npm run build
cd "$ROOT_DIR"

echo "==> [3/4] 生成应用图标 (如果 build/icon.icns 不存在)..."
ICON_ICNS="$ROOT_DIR/build/icon.icns"
ICON_PNG="$ROOT_DIR/build/icon.png"
mkdir -p "$ROOT_DIR/build"

if [ ! -f "$ICON_ICNS" ]; then
  if [ -f "$ICON_PNG" ]; then
    echo "    从 build/icon.png 生成 icon.icns ..."
    ICONSET_DIR="$ROOT_DIR/build/icon.iconset"
    mkdir -p "$ICONSET_DIR"
    for size in 16 32 64 128 256 512; do
      sips -z $size $size "$ICON_PNG" --out "$ICONSET_DIR/icon_${size}x${size}.png"   2>/dev/null
      sips -z $((size*2)) $((size*2)) "$ICON_PNG" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" 2>/dev/null
    done
    iconutil -c icns "$ICONSET_DIR" -o "$ICON_ICNS"
    rm -rf "$ICONSET_DIR"
    echo "    icon.icns 生成完成"
  else
    echo "    ⚠️  未找到 build/icon.png，将使用 Electron 默认图标"
    echo "    （提示：将 1024×1024 PNG 放到 build/icon.png 可自定义图标）"
    # 移除 package.json 中的 icon 字段以避免构建报错
    # electron-builder 在找不到文件时会用默认图标
  fi
fi

echo "==> [4/4] 打包 macOS 应用..."
ARCH_FLAG="${1:-}"
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
if [ "$ARCH_FLAG" = "--arm64" ]; then
  npm run dist:mac-arm64
elif [ "$ARCH_FLAG" = "--x64" ]; then
  npm run dist:mac-x64
else
  npm run dist:mac
fi

echo ""
echo "✅ 构建完成！输出目录: dist-electron/"
ls -lh "$ROOT_DIR/dist-electron/"*.dmg 2>/dev/null || true
