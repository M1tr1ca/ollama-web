// ===========================
// Location Service
// Geolocalización y reverse geocoding
// ===========================

const LOCATION_STORAGE_KEY = 'ollama-web-user-location';

/**
 * Obtener ubicación del usuario usando Geolocation API
 * @returns {Promise<{lat: number, lon: number, city: string, country: string}>}
 */
export async function getUserLocation() {
    // Primero intentar cargar desde localStorage
    const cached = localStorage.getItem(LOCATION_STORAGE_KEY);
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            // Verificar que no tenga más de 7 días
            if (parsed.timestamp && Date.now() - parsed.timestamp < 7 * 24 * 60 * 60 * 1000) {
                return parsed;
            }
        } catch (e) {
            console.warn('Error parsing cached location:', e);
        }
    }

    // Obtener ubicación fresca
    try {
        const coords = await getCoordinates();
        const cityData = await getCityFromCoords(coords.lat, coords.lon);

        const location = {
            lat: coords.lat,
            lon: coords.lon,
            city: cityData.city,
            country: cityData.country,
            timestamp: Date.now()
        };

        // Guardar en localStorage
        localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(location));

        return location;
    } catch (error) {
        console.warn('Error getting location, using default:', error);
        // Ubicación por defecto: Madrid, España
        return {
            lat: 40.4168,
            lon: -3.7038,
            city: 'Alcalá de Henares',
            country: 'España',
            timestamp: Date.now()
        };
    }
}

/**
 * Obtener coordenadas con Geolocation API
 * @returns {Promise<{lat: number, lon: number}>}
 */
function getCoordinates() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported'));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    lat: position.coords.latitude,
                    lon: position.coords.longitude
                });
            },
            (error) => {
                reject(error);
            },
            {
                enableHighAccuracy: false,
                timeout: 10000,
                maximumAge: 300000 // 5 minutos
            }
        );
    });
}

/**
 * Obtener ciudad desde coordenadas usando Nominatim (OpenStreetMap)
 * @param {number} lat 
 * @param {number} lon 
 * @returns {Promise<{city: string, country: string}>}
 */
export async function getCityFromCoords(lat, lon) {
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`,
            {
                headers: {
                    'Accept-Language': 'es'
                }
            }
        );

        if (!response.ok) {
            throw new Error('Reverse geocoding failed');
        }

        const data = await response.json();

        return {
            city: data.address.city || data.address.town || data.address.village || data.address.municipality || 'Desconocido',
            country: data.address.country || 'Desconocido'
        };
    } catch (error) {
        console.warn('Error in reverse geocoding:', error);
        return {
            city: 'Desconocido',
            country: 'Desconocido'
        };
    }
}

/**
 * Limpiar ubicación guardada
 */
export function clearSavedLocation() {
    localStorage.removeItem(LOCATION_STORAGE_KEY);
}
