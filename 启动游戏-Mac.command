#!/bin/bash
# 德州扑克之夜 - Mac 启动脚本
cd "$(dirname "$0")" || exit 1

echo ""
echo "  ============================================"
echo "     德州扑克之夜 - 正在启动..."
echo "  ============================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "  [错误] 没有检测到 Node.js"
  echo ""
  echo "  请先安装 Node.js:"
  echo "    1. 打开 https://nodejs.org"
  echo "    2. 下载 LTS 版本并安装"
  echo "    3. 装完重新运行本脚本"
  echo ""
  read -rp "  按回车退出..."
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "  首次运行，正在下载依赖（需要联网，约1-2分钟）..."
  echo ""
  npm install --no-audit --no-fund || { echo "  [错误] 依赖安装失败"; read -rp "按回车退出..."; exit 1; }
  echo ""
fi

echo "  启动服务器..."
echo ""
node server.js

echo ""
echo "  服务器已停止。"
read -rp "  按回车退出..."
