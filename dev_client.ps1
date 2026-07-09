# Start client dev server (bun dev in apps/client)
Push-Location "$PSScriptRoot/apps/client"
try { bun dev } finally { Pop-Location }
