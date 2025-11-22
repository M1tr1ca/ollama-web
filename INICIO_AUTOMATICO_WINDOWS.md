# Configurar Inicio Automático en Windows

PM2 no soporta nativamente `pm2 startup` en Windows. Aquí tienes dos alternativas para que tu aplicación se inicie automáticamente:

## Opción 1: Tarea Programada de Windows (Recomendada)

Esta es la forma más confiable en Windows:

1. **Abre PowerShell como Administrador**:
   - Presiona `Win + X` y selecciona "Windows PowerShell (Administrador)" o "Terminal (Administrador)"

2. **Navega al directorio del proyecto**:
```powershell
cd C:\Estudios\Local\ollama-web
```

3. **Ejecuta el script de configuración**:
```powershell
.\configurar-inicio-automatico.ps1
```

Esto creará una tarea programada que iniciará automáticamente tu aplicación cada vez que inicies sesión en Windows.

### Verificar la tarea programada:
```powershell
Get-ScheduledTask -TaskName "OllamaWeb-PM2-Startup"
```

### Eliminar la tarea programada (si es necesario):
```powershell
Unregister-ScheduledTask -TaskName "OllamaWeb-PM2-Startup" -Confirm:$false
```

## Opción 2: Carpeta de Inicio de Windows (Más Simple)

1. **Presiona `Win + R`** y escribe: `shell:startup`
2. **Crea un acceso directo** al archivo `start-pm2.bat` en esa carpeta
   - O copia el archivo `start-pm2.bat` directamente a esa carpeta

La aplicación se iniciará automáticamente cuando inicies sesión.

## Opción 3: Usar pm2-windows-startup (Alternativa)

Si prefieres usar una herramienta específica para PM2 en Windows:

1. **Instala pm2-windows-startup globalmente**:
```bash
npm install -g pm2-windows-startup
```

2. **Configura el inicio automático**:
```bash
pm2-windows-startup install
```

3. **Guarda la configuración de PM2**:
```bash
npx pm2 save
```

## Verificar que todo funciona

1. **Reinicia tu computadora** o cierra sesión y vuelve a iniciar sesión
2. **Verifica que la aplicación esté ejecutándose**:
```bash
npm run status
```

O abre tu navegador y ve a `http://localhost:5173/`

## Notas importantes

- La aplicación se iniciará cuando **inicies sesión** en Windows, no cuando se encienda la computadora
- Si necesitas que se inicie antes de iniciar sesión, necesitarás crear un servicio de Windows (más complejo)
- Los logs de PM2 se guardan en la carpeta `logs/`
- Puedes ver los logs en tiempo real con: `npm run logs`

