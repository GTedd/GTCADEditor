#!/bin/bash
# 一次跑完 tools/ 下全部界面测试和界面脚本语法检查（实现见 ui-check-all.cjs）。参数1：日志目录。
cd "$(dirname "$0")/.." || exit 1
exec node tools/ui-check-all.cjs "$@"
