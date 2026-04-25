#!/bin/bash

# 自动发布脚本
# 用法: ./scripts/publish.sh <version>
# 示例: ./scripts/publish.sh 1.0.4

set -e

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "错误: 请提供版本号"
  echo "用法: ./scripts/publish.sh <version>"
  echo "示例: ./scripts/publish.sh 1.0.4"
  exit 1
fi

echo "=========================================="
echo "开始发布 Forge Code v$VERSION"
echo "=========================================="

# 1. 更新 package.json 版本号
echo ""
echo "1. 更新版本号..."
npm version $VERSION --no-git-tag-version

# 2. 构建前端
echo ""
echo "2. 构建前端..."
pnpm build

# 3. 打包应用
echo ""
echo "3. 打包应用..."
pnpm package

# 4. 检查打包文件
echo ""
echo "4. 检查打包文件..."
INSTALLER="dist/Forge Code Setup $VERSION.exe"
LATEST_YML="dist/latest.yml"

if [ ! -f "$INSTALLER" ]; then
  echo "错误: 找不到安装包 $INSTALLER"
  exit 1
fi

if [ ! -f "$LATEST_YML" ]; then
  echo "错误: 找不到更新配置文件 $LATEST_YML"
  exit 1
fi

echo "✓ 安装包: $INSTALLER"
echo "✓ 更新配置: $LATEST_YML"

# 5. 提示手动上传
echo ""
echo "=========================================="
echo "打包完成！"
echo "=========================================="
echo ""
echo "接下来请手动完成以下步骤："
echo ""
echo "1. 访问 Gitee 仓库创建 Release:"
echo "   https://gitee.com/你的用户名/仓库名/releases/new"
echo ""
echo "2. 填写 Release 信息:"
echo "   - 标签名称: v$VERSION"
echo "   - 发行版标题: v$VERSION"
echo "   - 发行说明: (描述本次更新内容)"
echo ""
echo "3. 上传以下文件:"
echo "   - $INSTALLER"
echo "   - $LATEST_YML"
echo ""
echo "4. 点击发布按钮"
echo ""
echo "=========================================="
