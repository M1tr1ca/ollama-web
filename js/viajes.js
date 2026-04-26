// ========================================
// MÓDULO DE VIAJES - LEAFLET + OPENSTREETMAP
// Versión 6.0 - Rutas reales por calles (OSRM)
// ========================================

// Estado por conversación
const travelState = {
  currentPlaces: [],
  inlineMaps: {},
  currentConversationId: null
};

function debugTravelLog(hypothesisId, location, message, data = {}, runId = 'run-1') {
  // #region agent log
  fetch('http://127.0.0.1:7698/ingest/6d43e7c4-b55e-475d-a28f-263a1d520ed5',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'349350'},body:JSON.stringify({sessionId:'349350',runId,hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

// ========================================
// OSRM ROUTING - Rutas reales por calles
// ========================================

async function fetchOSRMRoute(places) {
  if (!places || places.length < 2) return null;

  // Construir coordenadas para OSRM (lng,lat format)
  const coords = places.map(p => `${p.lng},${p.lat}`).join(';');
  const url = `https://router.project-osrm.org/route/v1/foot/${coords}?overview=full&geometries=geojson&steps=true`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      return {
        coordinates: route.geometry.coordinates, // [lng, lat] pairs
        duration: route.duration, // seconds
        distance: route.distance, // meters
        legs: route.legs || []
      };
    }
  } catch (error) {
    console.warn('OSRM route fetch failed, falling back to straight lines:', error);
  }
  return null;
}

function formatRouteDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

function formatRouteDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// ========================================
// CREAR MAPAS INLINE EN EL CHAT (LEAFLET)
// ========================================

function createInlineChatMap(containerId, places = [], options = {}) {
  const container = document.getElementById(containerId);
  debugTravelLog('H3', 'js/viajes.js:createInlineChatMap:container-check', 'Intento crear mapa inline', {
    containerId,
    hasContainer: !!container,
    placesCount: Array.isArray(places) ? places.length : -1
  });
  if (!container) {
    console.error('Container not found:', containerId);
    return null;
  }

  let center = options.center || [40.4168, -3.7038];
  let zoom = options.zoom || 13;

  if (places.length > 0) {
    const avgLat = places.reduce((sum, p) => sum + p.lat, 0) / places.length;
    const avgLng = places.reduce((sum, p) => sum + p.lng, 0) / places.length;
    center = [avgLat, avgLng];

    if (places.length > 1) {
      const latSpread = Math.max(...places.map(p => p.lat)) - Math.min(...places.map(p => p.lat));
      const lngSpread = Math.max(...places.map(p => p.lng)) - Math.min(...places.map(p => p.lng));
      const maxSpread = Math.max(latSpread, lngSpread);
      zoom = maxSpread > 1 ? 10 : maxSpread > 0.1 ? 13 : 15;
    }
  }

  try {
    const map = L.map(containerId, {
      zoomControl: false,
      attributionControl: false
    }).setView(center, zoom);

    // Tile layer oscuro premium (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(map);

    // Control de zoom en esquina superior derecha
    L.control.zoom({ position: 'topright' }).addTo(map);

    // Atribución pequeña y sutil
    L.control.attribution({ position: 'bottomleft', prefix: false })
      .addAttribution('Leaflet | © OpenStreetMap © CARTO')
      .addTo(map);

    const markers = [];

    places.forEach((place, index) => {
      const isFirst = index === 0;
      const isLast = index === places.length - 1 && places.length > 1;

      // Marcador especial para inicio y fin
      let markerHTML;
      if (isFirst && places.length > 1) {
        markerHTML = `<div class="travel-marker travel-marker-start"><span>${index + 1}</span></div>`;
      } else if (isLast) {
        markerHTML = `<div class="travel-marker travel-marker-end"><span>${index + 1}</span></div>`;
      } else {
        markerHTML = `<div class="travel-marker"><span>${place.rating || (index + 1)}</span></div>`;
      }

      const customIcon = L.divIcon({
        className: 'travel-marker-icon',
        html: markerHTML,
        iconSize: [40, 40],
        iconAnchor: [20, 40],
        popupAnchor: [0, -40]
      });

      const marker = L.marker([place.lat, place.lng], { icon: customIcon })
        .addTo(map)
        .bindPopup(`<div class="travel-popup"><strong>${place.name}</strong><span class="popup-cat">${place.category || ''}</span></div>`);

      marker.on('click', () => showPlaceDetailModal(place));
      markers.push(marker);
    });

    // Obtener ruta REAL por calles usando OSRM
    if (places.length > 1) {
      // Mostrar línea temporal punteada mientras carga OSRM
      const tempCoords = places.map(p => [p.lat, p.lng]);
      const tempLine = L.polyline(tempCoords, {
        color: 'rgba(100,100,120,0.3)',
        weight: 2,
        dashArray: '6, 8'
      }).addTo(map);

      // Ajustar vista
      const group = L.featureGroup(markers);
      map.fitBounds(group.getBounds().pad(0.15));

      // Obtener ruta real de OSRM
      fetchOSRMRoute(places).then(routeData => {
        // Quitar línea temporal
        map.removeLayer(tempLine);

        if (routeData && routeData.coordinates.length > 0) {
          // Las coordenadas de OSRM vienen como [lng, lat], Leaflet necesita [lat, lng]
          const routeLatLngs = routeData.coordinates.map(c => [c[1], c[0]]);

          // Sombra de la ruta (da efecto de profundidad)
          L.polyline(routeLatLngs, {
            color: '#000000',
            weight: 8,
            opacity: 0.3,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(map);

          // Ruta principal - línea sólida azul brillante
          const mainRoute = L.polyline(routeLatLngs, {
            color: '#4285F4',
            weight: 5,
            opacity: 0.9,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(map);

          // Brillo encima de la ruta
          L.polyline(routeLatLngs, {
            color: '#6ea8fe',
            weight: 2,
            opacity: 0.5,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(map);

          // Ajustar vista a la ruta completa
          const allElements = [...markers, mainRoute];
          const routeGroup = L.featureGroup(allElements);
          map.fitBounds(routeGroup.getBounds().pad(0.12));

          // Actualizar info de ruta en el panel
          const routeInfoEl = container.closest('.chat-travel-embed')?.querySelector('.travel-route-info');
          if (routeInfoEl) {
            routeInfoEl.innerHTML = `
              <div class="route-info-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                <span>${formatRouteDuration(routeData.duration)}</span>
              </div>
              <div class="route-info-separator">·</div>
              <div class="route-info-item">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                <span>${formatRouteDistance(routeData.distance)}</span>
              </div>
              <div class="route-info-separator">·</div>
              <div class="route-info-item">
                <span>${places.length} paradas</span>
              </div>
            `;
            routeInfoEl.style.display = 'flex';
          }

          console.log('🗺️ Ruta OSRM dibujada:', formatRouteDistance(routeData.distance), '-', formatRouteDuration(routeData.duration));
        } else {
          // Fallback: línea directa si OSRM falla
          const fallbackCoords = places.map(p => [p.lat, p.lng]);
          L.polyline(fallbackCoords, {
            color: '#4285F4',
            weight: 4,
            opacity: 0.7,
            dashArray: '8, 12',
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(map);

          const routeGroup = L.featureGroup(markers);
          map.fitBounds(routeGroup.getBounds().pad(0.12));
        }
      });
    } else if (markers.length === 1) {
      map.setView([places[0].lat, places[0].lng], 15);
    }

    travelState.inlineMaps[containerId] = map;
    debugTravelLog('H4', 'js/viajes.js:createInlineChatMap:success', 'Mapa Leaflet creado', {
      containerId,
      clientWidth: container.clientWidth,
      clientHeight: container.clientHeight,
      placesCount: places.length
    });

    // Forzar el redimensionado del mapa
    setTimeout(() => {
      map.invalidateSize();
    }, 400);
    setTimeout(() => {
      map.invalidateSize();
    }, 1000);

    console.log('🗺️ Mapa Leaflet creado correctamente con', places.length, 'lugares');
    return map;

  } catch (error) {
    console.error('Error creando mapa Leaflet:', error);
    return null;
  }
}

// ========================================
// OBTENER IMAGEN REAL DE WIKIPEDIA
// ========================================

function getWikipediaImageUrl(placeName) {
  // URL de búsqueda de imagen en Wikipedia - esto busca la imagen del artículo
  const encodedName = encodeURIComponent(placeName.replace(/\s+/g, '_'));
  // Usar el servicio de thumbnail de Wikipedia
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodedName}.jpg?width=400`;
}

function getPlaceImage(placeName, width = 400, height = 200) {
  // Intentar obtener imagen de Wikipedia Commons basada en el nombre
  // Si falla, usar un placeholder con el nombre del lugar
  const encodedName = encodeURIComponent(placeName);

  // Fallback a una imagen de placeholder con texto
  return `https://placehold.co/${width}x${height}/1a1a1f/d4956a?text=${encodedName.substring(0, 20)}`;
}

// Función async para obtener imagen real de Wikipedia
async function fetchWikipediaImage(placeName) {
  try {
    const searchUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(placeName)}`;
    const response = await fetch(searchUrl);
    if (response.ok) {
      const data = await response.json();
      if (data.thumbnail && data.thumbnail.source) {
        return data.thumbnail.source;
      }
    }
    // Intentar en español
    const searchUrlEs = `https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(placeName)}`;
    const responseEs = await fetch(searchUrlEs);
    if (responseEs.ok) {
      const dataEs = await responseEs.json();
      if (dataEs.thumbnail && dataEs.thumbnail.source) {
        return dataEs.thumbnail.source;
      }
    }
  } catch (e) {
    console.log('No se pudo obtener imagen de Wikipedia para:', placeName);
  }
  return null;
}

// ========================================
// MODAL DE DETALLES DEL LUGAR
// ========================================

function showPlaceDetailModal(place) {
  const existing = document.getElementById('place-detail-modal');
  if (existing) existing.remove();

  const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(place.name)}`;

  // Placeholder inicial mientras carga la imagen real
  const placeholderImg = `https://placehold.co/800x400/1a1a1f/d4956a?text=${encodeURIComponent(place.name.substring(0, 30))}`;

  const modal = document.createElement('div');
  modal.id = 'place-detail-modal';
  modal.className = 'place-detail-modal';
  modal.innerHTML = `
    <div class="place-modal-backdrop"></div>
    <div class="place-modal-content">
      <button class="place-modal-close">&times;</button>
      
      <div class="place-modal-header">
        <div class="place-modal-info">
          <h2 class="place-modal-name">${place.name}</h2>
          ${place.rating ? `
            <div class="place-modal-rating">
              <span class="star">★</span> ${place.rating}
              <span class="reviews">(${Math.floor(Math.random() * 30000 + 1000)})</span>
            </div>
          ` : ''}
          <div class="place-modal-address">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
              <circle cx="12" cy="10" r="3"></circle>
            </svg>
            ${place.category || 'Lugar de interés'}
          </div>
        </div>
        <div class="place-modal-image">
          <img id="modal-place-image" src="${placeholderImg}" alt="${place.name}">
          <div class="image-loading">Buscando foto real...</div>
        </div>
      </div>
      
      <div class="place-modal-actions">
        <a href="${gmapsUrl}" target="_blank" class="place-modal-btn primary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
          </svg>
          Indicaciones
        </a>
        <a href="${searchUrl}" target="_blank" class="place-modal-btn secondary">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          Buscar info
        </a>
        <button class="place-modal-btn secondary" onclick="window.open('https://www.google.com/maps/@${place.lat},${place.lng},3a,75y,90t/data=!3m6!1e1!3m4!1s', '_blank')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polygon points="10 8 16 12 10 16 10 8"></polygon>
          </svg>
          Street View
        </a>
      </div>
      
      <div class="place-modal-section">
        <h3 class="section-title">
          <span>Información</span>
        </h3>
        <p class="section-content">${place.description || 'Un lugar increíble que vale la pena visitar durante tu viaje.'}</p>
      </div>
      
      <div class="place-modal-features">
        <div class="feature-card positive">
          <span class="feature-icon">✓</span>
          <div class="feature-content">
            <strong>${place.category || 'Atracción turística'}</strong>
            <p>Altamente recomendado por visitantes</p>
          </div>
        </div>
        <div class="feature-card positive">
          <span class="feature-icon">★</span>
          <div class="feature-content">
            <strong>Rating: ${place.rating || '4.5'}/5</strong>
            <p>Basado en reseñas de viajeros</p>
          </div>
        </div>
      </div>
      
      <div class="place-modal-coords">
        <small>📍 Coordenadas: ${place.lat.toFixed(4)}, ${place.lng.toFixed(4)}</small>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Intentar cargar imagen real de Wikipedia
  fetchWikipediaImage(place.name).then(imageUrl => {
    const imgElement = modal.querySelector('#modal-place-image');
    const loadingElement = modal.querySelector('.image-loading');
    if (imageUrl && imgElement) {
      imgElement.src = imageUrl;
      if (loadingElement) loadingElement.style.display = 'none';
    } else if (loadingElement) {
      loadingElement.textContent = 'Imagen no disponible';
    }
  });

  modal.querySelector('.place-modal-backdrop').onclick = () => modal.remove();
  modal.querySelector('.place-modal-close').onclick = () => modal.remove();
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', handler);
    }
  });

  requestAnimationFrame(() => modal.classList.add('visible'));
}

// ========================================
// GENERAR HTML PARA COMPONENTES DE VIAJE
// ========================================

function generateTravelMapHTML(places, mapId) {
  const id = mapId || `travel-map-${Date.now()}`;

  // Limitar a 10 lugares para la lista
  const displayPlaces = places.slice(0, 10);

  // Crear URL de ruta a pie con todos los lugares
  const routePlaces = places.slice(0, 10);
  const origin = `${routePlaces[0].lat},${routePlaces[0].lng}`;
  const destination = `${routePlaces[routePlaces.length - 1].lat},${routePlaces[routePlaces.length - 1].lng}`;
  const waypoints = routePlaces.slice(1, -1).map(p => `${p.lat},${p.lng}`).join('|');
  const walkingRouteUrl = waypoints
    ? `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${waypoints}&travelmode=walking`
    : `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=walking`;

  let placesListHTML = '';
  if (displayPlaces.length > 0) {
    placesListHTML = `
      <div class="chat-travel-places-list">
        ${displayPlaces.map((place, index) => `
          <div class="chat-travel-place-item" data-index="${index}">
            <div class="place-item-number">${index + 1}</div>
            <div class="place-item-content">
              <h4 class="place-item-name">${place.name}</h4>
              <div class="place-item-meta">
                <span class="place-item-category">${place.category || ''}</span>
                ${place.rating ? `<span class="place-item-rating">★ ${place.rating}</span>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
        ${places.length > 10 ? `
          <div class="chat-travel-more-places">
            +${places.length - 10} lugares más
          </div>
        ` : ''}
        <a href="${walkingRouteUrl}" target="_blank" class="chat-travel-see-more">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"></path>
          </svg>
          <span>Abrir en Google Maps</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </a>
      </div>
    `;
  }

  return `
    <div class="chat-travel-embed">
      <div class="chat-travel-layout">
        <div class="chat-travel-map-container">
          <div id="${id}" class="chat-travel-map"></div>
          <div class="travel-map-overlay-controls">
            <div class="travel-route-info" style="display:none;"></div>
            <button class="travel-map-expand-btn" title="Ver mapa grande" data-map-id="${id}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 3 21 3 21 9"></polyline>
                <polyline points="9 21 3 21 3 15"></polyline>
                <line x1="21" y1="3" x2="14" y2="10"></line>
                <line x1="3" y1="21" x2="10" y2="14"></line>
              </svg>
            </button>
          </div>
        </div>
        ${placesListHTML}
      </div>
    </div>
  `;
}

function generateGoogleMapsLinkHTML(places) {
  if (places.length === 0) return '';

  const origin = `${places[0].lat},${places[0].lng}`;
  const destination = `${places[places.length - 1].lat},${places[places.length - 1].lng}`;
  const waypoints = places.slice(1, -1).map(p => `${p.lat},${p.lng}`).join('|');

  const url = waypoints
    ? `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${waypoints}`
    : `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;

  return `
    <div class="chat-travel-route-link">
      <a href="${url}" target="_blank" class="travel-route-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
        </svg>
        Abrir ruta completa (${places.length} lugares)
      </a>
    </div>
  `;
}

// ========================================
// PARSEAR RESPUESTAS DE LA IA
// ========================================

function parseTravelCommands(content) {
  console.log('🗺️ Parseando contenido, longitud:', content?.length);

  const result = {
    text: content,
    hasTravel: false,
    places: [],
    showMap: false,
    showRoute: false
  };

  if (!content) return result;

  // Detectar bloque de mapa con lugares
  const mapBlockRegex = /\[TRAVEL_MAP\]([\s\S]*?)\[\/TRAVEL_MAP\]/g;
  const mapMatch = content.match(mapBlockRegex);

  if (mapMatch) {
    console.log('🗺️ Encontrado bloque TRAVEL_MAP');
    debugTravelLog('H1', 'js/viajes.js:parseTravelCommands:map-block', 'Bloque TRAVEL_MAP detectado', {
      contentLength: content?.length || 0,
      blocksFound: mapMatch.length
    });
    result.hasTravel = true;
    result.showMap = true;

    const placeRegex = /\[PLACE:([^\]]+)\]/g;
    let placeMatch;

    mapMatch.forEach(block => {
      while ((placeMatch = placeRegex.exec(block)) !== null) {
        const parts = placeMatch[1].split('|');
        if (parts.length >= 3) {
          const lat = parseFloat(parts[1]);
          const lng = parseFloat(parts[2]);
          if (!isNaN(lat) && !isNaN(lng)) {
            result.places.push({
              name: parts[0].trim(),
              lat: lat,
              lng: lng,
              category: parts[3]?.trim() || '',
              description: parts[4]?.trim() || '',
              rating: parts[5]?.trim() || null
            });
          }
        }
      }
    });

    console.log('🗺️ Lugares parseados:', result.places.length);
    debugTravelLog('H1', 'js/viajes.js:parseTravelCommands:places-result', 'Resultado parseo TRAVEL_MAP', {
      placesCount: result.places.length,
      firstPlace: result.places[0]?.name || null
    });

    // Cuando hay TRAVEL_MAP, NO mostrar ningún texto - solo el mapa
    // IMPORTANTE: Limpiar TODO el contenido, incluyendo texto antes y después del bloque TRAVEL_MAP
    result.text = '';

    return result; // Salir temprano, no hacer más procesamiento
  }

  // Si no había TRAVEL_MAP, procesar lugares standalone y comandos de ruta
  if (!result.hasTravel) {
    // Detectar lugares individuales fuera de bloques
    const standalonePlaceRegex = /\[PLACE:([^\]]+)\]/g;
    let standaloneMatch;
    let foundStandalone = false;

    while ((standaloneMatch = standalonePlaceRegex.exec(content)) !== null) {
      const parts = standaloneMatch[1].split('|');
      if (parts.length >= 3) {
        const lat = parseFloat(parts[1]);
        const lng = parseFloat(parts[2]);
        if (!isNaN(lat) && !isNaN(lng)) {
          result.hasTravel = true;
          foundStandalone = true;
          result.places.push({
            name: parts[0].trim(),
            lat: lat,
            lng: lng,
            category: parts[3]?.trim() || '',
            description: parts[4]?.trim() || '',
            rating: parts[5]?.trim() || null
          });
        }
      }
    }

    if (foundStandalone && result.places.length > 0) {
      result.showMap = true;
    }
    result.text = result.text.replace(standalonePlaceRegex, '').trim();

    // Detectar comando de ruta
    if (content.includes('[GMAPS_ROUTE]')) {
      result.hasTravel = true;
      result.showRoute = true;
      result.text = result.text.replace(/\[GMAPS_ROUTE\]/g, '').trim();
    }
  }

  console.log('🗺️ Resultado final - hasTravel:', result.hasTravel, 'places:', result.places.length);

  return result;
}

// ========================================
// RENDERIZAR COMPONENTES DE VIAJE
// ========================================

function renderTravelComponents(messageContainer, travelData) {
  console.log('🗺️ renderTravelComponents llamado con', travelData?.places?.length, 'lugares');
  debugTravelLog('H2', 'js/viajes.js:renderTravelComponents:entry', 'Entrada a renderTravelComponents', {
    hasTravel: !!travelData?.hasTravel,
    placesCount: travelData?.places?.length || 0,
    showMap: !!travelData?.showMap,
    messageContainerClass: messageContainer?.className || null
  });

  if (!travelData.hasTravel || !travelData.places || travelData.places.length === 0) {
    console.log('🗺️ No hay datos de viaje para renderizar');
    return;
  }

  travelState.currentPlaces = [...travelState.currentPlaces, ...travelData.places];

  const travelContainer = document.createElement('div');
  travelContainer.className = 'chat-travel-components';

  let mapId = null;

  if (travelData.showMap && travelData.places.length > 0) {
    mapId = `travel-map-${Date.now()}`;
    travelContainer.innerHTML = generateTravelMapHTML(travelData.places, mapId);
  }

  if (travelData.showRoute && travelState.currentPlaces.length >= 2) {
    travelContainer.insertAdjacentHTML('beforeend', generateGoogleMapsLinkHTML(travelState.currentPlaces));
  }

  // Insertar en el DOM
  messageContainer.appendChild(travelContainer);
  console.log('🗺️ Container añadido al DOM');

  // Inicializar el mapa
  if (mapId) {
    setTimeout(() => {
      const container = document.getElementById(mapId);
      console.log('🗺️ Buscando container:', mapId, '- Encontrado:', !!container);
      debugTravelLog('H2', 'js/viajes.js:renderTravelComponents:map-container', 'Validacion de contenedor previo a createInlineChatMap', {
        mapId,
        foundContainer: !!container
      });
      if (container) {
        createInlineChatMap(mapId, travelData.places);

        // Eventos en los items de lugares
        travelContainer.querySelectorAll('.chat-travel-place-item').forEach((item, idx) => {
          item.addEventListener('click', () => {
            const place = travelData.places[idx];
            if (place) showPlaceDetailModal(place);
          });
        });

        // Evento botón expandir mapa
        const expandBtn = travelContainer.querySelector('.travel-map-expand-btn');
        if (expandBtn) {
          expandBtn.addEventListener('click', () => {
            toggleMapFullscreen(mapId, travelData.places);
          });
        }
      }
    }, 500);
  }
}

// ========================================
// MAPA A PANTALLA COMPLETA
// ========================================

function toggleMapFullscreen(mapId, places) {
  const existingFullscreen = document.getElementById('travel-map-fullscreen');
  if (existingFullscreen) {
    closeMapFullscreen();
    return;
  }

  const fullscreenEl = document.createElement('div');
  fullscreenEl.id = 'travel-map-fullscreen';
  fullscreenEl.className = 'travel-map-fullscreen';

  // Crear URL ruta Google Maps
  let gmapsUrl = '#';
  if (places && places.length >= 2) {
    const origin = `${places[0].lat},${places[0].lng}`;
    const destination = `${places[places.length - 1].lat},${places[places.length - 1].lng}`;
    const waypoints = places.slice(1, -1).map(p => `${p.lat},${p.lng}`).join('|');
    gmapsUrl = waypoints
      ? `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${waypoints}&travelmode=walking`
      : `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=walking`;
  }

  fullscreenEl.innerHTML = `
    <div class="fullscreen-map-header">
      <div class="fullscreen-map-title">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
        </svg>
        <span>Mapa del viaje</span>
        <div class="fullscreen-route-info"></div>
      </div>
      <div class="fullscreen-map-actions">
        <a href="${gmapsUrl}" target="_blank" class="fullscreen-gmaps-btn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
          </svg>
          Google Maps
        </a>
        <button class="fullscreen-map-close" id="fullscreen-map-close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>
    <div class="fullscreen-map-body">
      <div id="fullscreen-map-container" class="fullscreen-map-container"></div>
      <div class="fullscreen-places-sidebar">
        ${places ? places.map((place, index) => `
          <div class="fullscreen-place-item" data-index="${index}">
            <div class="fullscreen-place-number">${index + 1}</div>
            <div class="fullscreen-place-info">
              <div class="fullscreen-place-name">${place.name}</div>
              <div class="fullscreen-place-meta">
                ${place.category ? `<span class="fullscreen-place-cat">${place.category}</span>` : ''}
                ${place.rating ? `<span class="fullscreen-place-rating">★ ${place.rating}</span>` : ''}
              </div>
            </div>
          </div>
        `).join('') : ''}
      </div>
    </div>
  `;

  document.body.appendChild(fullscreenEl);

  // Animación de entrada
  requestAnimationFrame(() => {
    fullscreenEl.classList.add('visible');
  });

  // Crear mapa fullscreen
  setTimeout(() => {
    const fullMap = createInlineChatMap('fullscreen-map-container', places || []);

    // Eventos de lugares
    fullscreenEl.querySelectorAll('.fullscreen-place-item').forEach((item, idx) => {
      item.addEventListener('click', () => {
        const place = places[idx];
        if (place && fullMap) {
          fullMap.flyTo([place.lat, place.lng], 16, { duration: 1 });
          // Destacar item
          fullscreenEl.querySelectorAll('.fullscreen-place-item').forEach(i => i.classList.remove('active'));
          item.classList.add('active');
        }
      });
    });

    // Actualizar info ruta en header
    if (places && places.length > 1) {
      fetchOSRMRoute(places).then(routeData => {
        if (routeData) {
          const routeInfo = fullscreenEl.querySelector('.fullscreen-route-info');
          if (routeInfo) {
            routeInfo.innerHTML = `
              <span class="route-badge">${formatRouteDuration(routeData.duration)}</span>
              <span class="route-badge">${formatRouteDistance(routeData.distance)}</span>
              <span class="route-badge">${places.length} paradas</span>
            `;
          }
        }
      });
    }
  }, 100);

  // Cerrar
  fullscreenEl.querySelector('#fullscreen-map-close').addEventListener('click', closeMapFullscreen);
  fullscreenEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMapFullscreen();
  });
}

function closeMapFullscreen() {
  const el = document.getElementById('travel-map-fullscreen');
  if (!el) return;
  el.classList.remove('visible');
  setTimeout(() => {
    // Limpiar mapa
    const mapInstance = travelState.inlineMaps['fullscreen-map-container'];
    if (mapInstance && typeof mapInstance.remove === 'function') {
      mapInstance.remove();
      delete travelState.inlineMaps['fullscreen-map-container'];
    }
    el.remove();
  }, 300);
}

// ========================================
// PROMPT DEL SISTEMA
// ========================================

function getTravelSystemPrompt() {
  return `
Cuando el usuario pregunte sobre lugares, viajes, o qué hacer en algún sitio, DEBES generar las coordenadas GPS CORRECTAS Y PRECISAS de cada lugar. Usa este formato:

[TRAVEL_MAP]
[PLACE:Nombre exacto del lugar|latitud|longitud|categoría|descripción breve|valoración]
[/TRAVEL_MAP]

REGLAS ESTRICTAS PARA LAS COORDENADAS:
1. Las coordenadas DEBEN ser las ubicaciones GPS REALES del lugar
2. Latitud: número decimal entre -90 y 90 (positivo = norte, negativo = sur)
3. Longitud: número decimal entre -180 y 180 (positivo = este, negativo = oeste)
4. Usa 4 decimales mínimo para precisión (ej: 40.4168)
5. NO inventes coordenadas - busca las ubicaciones reales

EJEMPLOS CON COORDENADAS CORRECTAS:

Madrid:
[TRAVEL_MAP]
[PLACE:Museo del Prado|40.4138|-3.6921|Museo|Museo de arte más importante de España|4.9]
[PLACE:Puerta del Sol|40.4168|-3.7038|Plaza|Centro y kilómetro cero de España|4.6]
[PLACE:Palacio Real|40.4180|-3.7143|Monumento|Residencia oficial de los Reyes de España|4.8]
[/TRAVEL_MAP]

Barcelona:
[TRAVEL_MAP]
[PLACE:La Sagrada Familia|41.4036|2.1744|Basílica|Obra maestra de Gaudí|4.9]
[PLACE:Park Güell|41.4145|2.1527|Parque|Parque público con arquitectura de Gaudí|4.7]
[/TRAVEL_MAP]

Alcalá de Henares:
[TRAVEL_MAP]
[PLACE:Casa Natal de Cervantes|40.4818|-3.3641|Museo|Casa-museo del autor del Quijote|4.7]
[PLACE:Universidad de Alcalá|40.4823|-3.3634|Monumento|Universidad histórica renacentista|4.8]
[PLACE:Plaza de Cervantes|40.4816|-3.3651|Plaza|Plaza principal con estatua de Cervantes|4.6]
[/TRAVEL_MAP]

IMPORTANTE:
- MÁXIMO 10 lugares por respuesta
- Coordenadas decimales PRECISAS Y REALES
- Siempre usa [TRAVEL_MAP]...[/TRAVEL_MAP]
- Valoración entre 1.0 y 5.0
`;
}

// ========================================
// LIMPIAR ESTADO
// ========================================

function clearTravelState() {
  travelState.currentPlaces = [];
  Object.values(travelState.inlineMaps).forEach(map => {
    if (map && typeof map.remove === 'function') map.remove();
  });
  travelState.inlineMaps = {};
}

// ========================================
// EXPORTAR API PÚBLICA
// ========================================

window.travelMode = {
  createInlineMap: createInlineChatMap,
  generateMapHTML: generateTravelMapHTML,
  generateRouteHTML: generateGoogleMapsLinkHTML,
  parseCommands: parseTravelCommands,
  renderComponents: renderTravelComponents,
  getSystemPrompt: getTravelSystemPrompt,
  getState: () => travelState,
  clearState: clearTravelState,
  showPlaceDetail: showPlaceDetailModal,
  setActive: (active) => {
    window._travelModeActive = active;
    console.log(active ? '🗺️ Modo Viajes activado' : '🗺️ Modo Viajes desactivado');
  },
  init: () => console.log('🗺️ Leaflet Maps v6.0 listo'),
  toggleFullscreen: toggleMapFullscreen
};

// Toggle setup
document.addEventListener('DOMContentLoaded', () => {
  const setup = () => {
    document.querySelectorAll('.chat-mode-option[data-mode="travel"]').forEach(btn => {
      btn.addEventListener('click', () => {
        window.travelMode.setActive(true);
        window._studyModeActive = false;
        window._webSearchModeActive = false;
        window._musicModeActive = false;
      });
    });
    document.querySelectorAll('.chat-mode-option:not([data-mode="travel"])').forEach(btn => {
      btn.addEventListener('click', () => window.travelMode.setActive(false));
    });
  };
  setup();
  setTimeout(setup, 1000);
});

console.log('📍 Módulo de viajes v6.0 - Rutas OSRM + Fullscreen');
