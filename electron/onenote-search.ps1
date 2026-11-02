# OneNote 搜索 PowerShell 桥接脚本
# ------------------------------------------------------------------
# 由 Electron 主进程通过 spawn 调用：
#   powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass ^
#     -File onenote-search.ps1 -Keyword "<关键词>"
#
# 设计要点：
#   1. 关键词仅通过 -Keyword 参数传入，绝不拼接进脚本文本，避免注入/转义问题。
#   2. 结果以 OneNote FindPages 返回的层级 XML 直接输出到 stdout。
#   3. 任何异常以 "__ONENOTE_ERROR__" 前缀输出，便于主进程识别并转为友好提示。
param([string]$Keyword)

$ErrorActionPreference = 'Stop'

try {
    # 输出编码设为 UTF-8，保证中文页面标题在主进程按 utf8 解码不乱码。
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8

    $onenote = New-Object -ComObject OneNote.Application

    # FindPages(bstrStartNodeID, bstrSearchTerm, [out] pbstrHierarchyXmlOut)
    # 首参传 '' 表示从整棵层次树根开始搜索。
    # out 参数取值方式因 COM 桥而异，做两级回退（实测本机 PowerShell 5.1 + OneNote C2R：
    # [ref] 方式拿不到数据，返回值方式有效）：
    $xml = ''
    try {
        # 方式 1：[out] 参数被 PowerShell 包装为函数返回值
        $xml = $onenote.FindPages('', $Keyword)
    } catch {
        $xml = ''
    }
    if ([string]::IsNullOrWhiteSpace([string]$xml)) {
        # 方式 2：显式 [ref] 接收 out 参数
        $xmlRef = ''
        $null = $onenote.FindPages('', $Keyword, [ref]$xmlRef)
        $xml = $xmlRef
    }
    if ([string]::IsNullOrWhiteSpace([string]$xml)) {
        Write-Output "__ONENOTE_ERROR__FindPages 未返回任何内容（关键词：$Keyword）"
        exit 0
    }

    Write-Output ([string]$xml)
} catch {
    Write-Output ("__ONENOTE_ERROR__" + $_.Exception.Message)
}
