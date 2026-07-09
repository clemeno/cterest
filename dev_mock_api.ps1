# Start mock API dev server (bun dev in apps/mock-api)
Push-Location "$PSScriptRoot/apps/mock-api"
try { bun dev } finally { Pop-Location }
