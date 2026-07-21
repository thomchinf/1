@echo off
cd /d "%~dp0"
echo Starting PickPick Xiaohongshu draft proxy...
echo This opens and fills Xiaohongshu drafts only. You must click publish manually.
echo Keep this window open while preparing drafts.
set PICKPICK_XHS_MAX_IMAGES=9
node xiaohongshu-mcp-proxy.js
pause
