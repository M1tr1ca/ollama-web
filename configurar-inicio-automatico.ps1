# Script para configurar el inicio automático de la aplicación en Windows
# Debes ejecutar este script como administrador

Write-Host "Configurando inicio automático para ollama-web..." -ForegroundColor Green

# Obtener la ruta del script actual
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$batFile = Join-Path $scriptPath "start-pm2.bat"

# Crear una tarea programada que se ejecute al iniciar Windows
$taskName = "OllamaWeb-PM2-Startup"
$description = "Inicia automáticamente ollama-web con PM2 al arrancar Windows"

# Eliminar la tarea si ya existe
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) {
    Write-Host "Eliminando tarea existente..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

# Crear la acción (ejecutar el script batch)
$action = New-ScheduledTaskAction -Execute $batFile -WorkingDirectory $scriptPath

# Crear el trigger (al iniciar sesión)
$trigger = New-ScheduledTaskTrigger -AtLogOn

# Crear la configuración
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable

# Crear la tarea
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive

try {
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description $description -Force -ErrorAction Stop
    Write-Host "`n¡Configuración completada exitosamente!" -ForegroundColor Green
    Write-Host "La aplicación se iniciará automáticamente cuando inicies sesión en Windows." -ForegroundColor Cyan
    Write-Host "`nPara verificar la tarea programada, ejecuta:" -ForegroundColor Yellow
    Write-Host "Get-ScheduledTask -TaskName '$taskName'" -ForegroundColor White
    Write-Host "`nPara eliminar la tarea programada, ejecuta:" -ForegroundColor Yellow
    Write-Host "Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false" -ForegroundColor White
} catch {
    Write-Host "`n❌ Error al crear la tarea programada: $_" -ForegroundColor Red
    Write-Host "`n⚠️  Asegúrate de ejecutar este script como administrador." -ForegroundColor Yellow
    Write-Host "`n💡 Alternativa más simple (sin permisos de administrador):" -ForegroundColor Cyan
    Write-Host "   1. Presiona Win + R y escribe: shell:startup" -ForegroundColor White
    Write-Host "   2. Copia el archivo 'start-pm2.bat' a esa carpeta" -ForegroundColor White
    Write-Host "   3. ¡Listo! La aplicación se iniciará automáticamente." -ForegroundColor White
    exit 1
}

