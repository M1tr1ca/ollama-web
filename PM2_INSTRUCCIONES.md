# Instrucciones para ejecutar la aplicación automáticamente con PM2

## Instalación

1. Instala las dependencias (incluye PM2):
```bash
npm install
```

## Uso básico

### Iniciar la aplicación
```bash
npm start
```
Esto iniciará la aplicación y la mantendrá ejecutándose en segundo plano.

### Ver el estado de la aplicación
```bash
npm run status
```

### Ver los logs en tiempo real
```bash
npm run logs
```

### Detener la aplicación
```bash
npm stop
```

### Reiniciar la aplicación
```bash
npm run restart
```

### Eliminar la aplicación de PM2
```bash
npm run delete
```

## Configurar inicio automático al arrancar Windows

⚠️ **Nota importante**: PM2 no soporta nativamente `pm2 startup` en Windows. 

Para configurar el inicio automático en Windows, consulta el archivo **`INICIO_AUTOMATICO_WINDOWS.md`** que contiene varias opciones:

1. **Tarea Programada de Windows** (Recomendada) - Usa el script `configurar-inicio-automatico.ps1`
2. **Carpeta de Inicio** - Copia `start-pm2.bat` a la carpeta de inicio
3. **pm2-windows-startup** - Herramienta alternativa para PM2 en Windows

La opción más simple es usar la carpeta de inicio de Windows (Opción 2).

## Comandos PM2 útiles

- `npx pm2 list` - Ver todas las aplicaciones gestionadas por PM2
- `npx pm2 monit` - Monitor en tiempo real de CPU y memoria
- `npx pm2 logs ollama-web --lines 50` - Ver las últimas 50 líneas de logs
- `npx pm2 flush` - Limpiar todos los logs

## Notas

- La aplicación se ejecutará en el puerto configurado en Vite (normalmente 5173)
- Si la aplicación falla, PM2 la reiniciará automáticamente
- Los logs se guardan en la carpeta `logs/`
- Para cambiar el puerto, edita el archivo `vite.config.js` o crea un archivo `.env`

