@echo off
setlocal

set "DIR=%~dp0"
set "EXECUTABLE=%DIR%..\..\Trickroom.exe"
if exist "%DIR%..\app.asar.unpacked\bin\trickroom-mcp.js" (
	set "MCP_ENTRY=%DIR%..\app.asar.unpacked\bin\trickroom-mcp.js"
) else (
	set "MCP_ENTRY=%DIR%..\app\bin\trickroom-mcp.js"
)

set ELECTRON_RUN_AS_NODE=1
if not defined TRICKROOM_RUNTIME_ENV set TRICKROOM_RUNTIME_ENV=production
"%EXECUTABLE%" "%MCP_ENTRY%" %*
