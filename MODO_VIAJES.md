# 🗺️ Modo Viajes - Guía de Uso

## Configuración Inicial

1. **Obtener API Key de Mapbox**
   - Visita [Mapbox Account](https://account.mapbox.com)
   - Crea una cuenta o inicia sesión
   - Genera un nuevo Access Token
   - Copia el token

2. **Configurar en la App**
   - Click en el icono de usuario (esquina superior derecha)
   - Selecciona "API Keys"
   - Pega tu Mapbox API Key en el campo correspondiente
   - Guarda los cambios

## Cómo Usar el Modo Viajes

### Activar Modo Viajes

1. Click en el botón de modo viajes (icono de capas) en el toggle de modos de chat
2. Se abrirá el panel de viajes con el mapa de Mapbox

### Interactuar con el Mapa

**Controles del Mapa:**
- 🎯 **Mi ubicación**: Centra el mapa en tu posición actual
- 🗺️ **Capas**: Cambia el estilo del mapa (calles, satélite, exterior, claro, oscuro)
- Zoom in/out con los botones + y -
- Arrastre para mover el mapa

### Usar la IA para Planificar Viajes

La IA puede ayudarte a planificar viajes mediante comandos naturales:

#### Ejemplos de Comandos:

**Añadir Lugares:**
```
"Muéstrame lugares interesantes en Madrid"
"Añade la Torre Eiffel a mi viaje"
"Quiero visitar el Museo del Prado"
```

**Crear Rutas:**
```
"Crea una ruta con todos los lugares"
"Genera un itinerario optimizado"
```

**Generar Enlaces:**
```
"Dame un link de Google Maps con la ruta"
"Genera un enlace para compartir el viaje"
```

**Buscar Lugares:**
```
"Busca restaurantes cerca de la Plaza Mayor"
"Encuentra museos en París"
```

### Comandos Especiales para Desarrolladores

Si estás integrando la IA, estos son los comandos que puede usar:

- `[ADD_PLACE:nombre|lat|lng|categoria|descripcion]` - Añade un lugar al mapa
- `[CREATE_ROUTE]` - Crea una ruta entre todos los lugares
- `[GOOGLE_MAPS_LINK]` - Genera y copia link de Google Maps
- `[SEARCH_PLACES:query]` - Busca lugares

### Gestionar Lugares

**Panel de Lugares:**
- Lista todos los lugares añadidos con numeración
- Click en una tarjeta para ver detalles completos
- 📍 Ver en mapa - Centra el mapa en ese lugar
- 🗑️ Eliminar - Quita el lugar del viaje

**Modal de Detalles:**
- Nombre y categoría del lugar
- Dirección completa
- Descripción detallada
- Valoración (si disponible)
- Botón para abrir en Google Maps
- Botón para ver en el mapa de la app

### Crear Rutas

1. Añade al menos 2 lugares a tu viaje
2. Click en "Crear ruta" o pídele a la IA que lo haga
3. Se dibujará la ruta óptima en el mapa
4. Se generará automáticamente un link de Google Maps

### Estilos de Mapa Disponibles

- **Calles**: Vista estándar con calles y nombres
- **Satélite**: Imágenes satelitales con nombres de calles
- **Exterior**: Optimizado para actividades al aire libre
- **Claro**: Diseño minimalista claro
- **Oscuro**: Diseño minimalista oscuro (mejor para modo nocturno)

## Características Técnicas

### API de Mapbox Utilizada

- **Mapbox GL JS v3.0.1**: Renderizado de mapas interactivos
- **Geocoding API**: Búsqueda de lugares
- **Directions API**: Cálculo de rutas optimizadas

### Almacenamiento Local

- Los lugares añadidos persisten en `localStorage`
- La API Key se guarda de forma segura localmente
- El estado del mapa se restaura al reabrir

### Integración con IA

La IA puede:
- ✅ Buscar lugares relevantes
- ✅ Añadir marcadores al mapa
- ✅ Crear rutas optimizadas
- ✅ Generar enlaces compartibles
- ✅ Proporcionar información detallada sobre lugares
- ✅ Sugerir itinerarios completos

## Ejemplos de Uso

### Planificar un Día en Barcelona

```
Usuario: "Quiero planificar un día en Barcelona"
IA: "¡Claro! Te sugiero estos lugares:
     1. Sagrada Familia
     2. Park Güell  
     3. La Rambla
     4. Casa Batlló
     ¿Los añado al mapa?"

Usuario: "Sí, añádelos y crea una ruta"
IA: [Añade los 4 lugares y crea la ruta automáticamente]
    "✅ He añadido todos los lugares y creado una ruta óptima.
     La ruta tiene 15.2 km y tomará aproximadamente 45 minutos en auto."
```

### Buscar Restaurantes

```
Usuario: "Busca buenos restaurantes cerca del Museo del Prado"
IA: [Busca y muestra opciones]
    "Encontré estos restaurantes:
     1. Restaurante Sobrino de Botín (⭐ 4.5/5)
     2. Casa Lucio (⭐ 4.3/5)
     3. El Club Allard (⭐ 4.7/5)
     ¿Cuál te gustaría añadir?"
```

### Generar Link para Compartir

```
Usuario: "Dame un link para compartir mi ruta"
IA: [Genera link de Google Maps]
    "✅ He generado el link y lo he copiado al portapapeles.
     Puedes compartirlo directamente desde ahí."
```

## Solución de Problemas

**El mapa no se muestra:**
- Verifica que has configurado la Mapbox API Key
- Revisa la consola del navegador para errores
- Asegúrate de tener conexión a internet

**Los lugares no se añaden:**
- Verifica que estás en modo viajes
- Comprueba que la API Key es válida
- Revisa que las coordenadas sean correctas

**La ruta no se crea:**
- Necesitas al menos 2 lugares añadidos
- Verifica la Mapbox API Key
- Comprueba tu límite de uso de la API

## Límites de la API de Mapbox

**Plan Gratuito:**
- 50,000 cargas de mapa/mes
- 100,000 búsquedas/mes
- 2,000 rutas/mes

Para uso intensivo, considera actualizar a un plan de pago en Mapbox.

## Soporte

Para problemas o sugerencias:
1. Revisa la consola del navegador (F12) para errores
2. Verifica los logs con prefijo `📍`, `🗺️`, `✅` o `❌`
3. Comprueba la configuración de API Keys

---

**¡Disfruta planificando tus viajes con IA! 🌍✈️**
