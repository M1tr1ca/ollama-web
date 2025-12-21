// ===========================
// Weather Service
// Usando Open-Meteo API (100% gratis, sin API key)
// ===========================

const WEATHER_CODES = {
    0: { condition: 'Despejado', icon: 'sun', color: '#FDB813' },
    1: { condition: 'Mayormente despejado', icon: 'sun-cloud', color: '#FDB813' },
    2: { condition: 'Parcialmente nublado', icon: 'cloud-sun', color: '#94A3B8' },
    3: { condition: 'Nublado', icon: 'cloud', color: '#94A3B8' },
    45: { condition: 'Niebla', icon: 'fog', color: '#94A3B8' },
    48: { condition: 'Niebla helada', icon: 'fog', color: '#60A5FA' },
    51: { condition: 'Llovizna ligera', icon: 'rain-light', color: '#60A5FA' },
    53: { condition: 'Llovizna moderada', icon: 'rain', color: '#60A5FA' },
    55: { condition: 'Llovizna intensa', icon: 'rain-heavy', color: '#3B82F6' },
    61: { condition: 'Lluvia ligera', icon: 'rain', color: '#60A5FA' },
    63: { condition: 'Lluvia moderada', icon: 'rain-heavy', color: '#3B82F6' },
    65: { condition: 'Lluvia intensa', icon: 'rain-heavy', color: '#2563EB' },
    71: { condition: 'Nieve ligera', icon: 'snow', color: '#E0F2FE' },
    73: { condition: 'Nieve moderada', icon: 'snow', color: '#BAE6FD' },
    75: { condition: 'Nieve intensa', icon: 'snow-heavy', color: '#7DD3FC' },
    77: { condition: 'Granizo', icon: 'snow', color: '#BAE6FD' },
    80: { condition: 'Chubascos ligeros', icon: 'rain-light', color: '#60A5FA' },
    81: { condition: 'Chubascos moderados', icon: 'rain', color: '#3B82F6' },
    82: { condition: 'Chubascos intensos', icon: 'storm', color: '#6366F1' },
    85: { condition: 'Nevadas ligeras', icon: 'snow', color: '#BAE6FD' },
    86: { condition: 'Nevadas intensas', icon: 'snow-heavy', color: '#7DD3FC' },
    95: { condition: 'Tormenta', icon: 'storm', color: '#6366F1' },
    96: { condition: 'Tormenta con granizo', icon: 'storm', color: '#4F46E5' },
    99: { condition: 'Tormenta fuerte con granizo', icon: 'storm', color: '#4338CA' }
};

const DAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/**
 * Obtener clima por coordenadas usando Open-Meteo
 * @param {number} lat 
 * @param {number} lon 
 * @returns {Promise<{temperature: number, condition: string, icon: string, forecast: Array}>}
 */
export async function getWeatherByCoords(lat, lon) {
    try {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max&timezone=auto&forecast_days=7`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error('Weather API request failed');
        }

        const data = await response.json();

        // Datos actuales
        const currentCode = data.current.weather_code;
        const currentWeather = WEATHER_CODES[currentCode] || { condition: 'Desconocido', icon: 'cloud', color: '#94A3B8' };

        // Pronóstico de 7 días
        const forecast = data.daily.time.map((date, index) => {
            const weatherCode = data.daily.weather_code[index];
            const weather = WEATHER_CODES[weatherCode] || { condition: 'Desconocido', icon: 'cloud', color: '#94A3B8' };
            const dayDate = new Date(date);

            return {
                day: DAYS_SHORT[dayDate.getDay()],
                date: date,
                tempMax: Math.round(data.daily.temperature_2m_max[index]),
                tempMin: Math.round(data.daily.temperature_2m_min[index]),
                condition: weather.condition,
                icon: weather.icon,
                color: weather.color,
                precipitation: data.daily.precipitation_probability_max[index] || 0,
                uvIndex: data.daily.uv_index_max[index] || 0
            };
        });

        return {
            temperature: Math.round(data.current.temperature_2m),
            feelsLike: Math.round(data.current.apparent_temperature),
            humidity: data.current.relative_humidity_2m,
            windSpeed: Math.round(data.current.wind_speed_10m),
            windDirection: data.current.wind_direction_10m,
            condition: currentWeather.condition,
            icon: currentWeather.icon,
            color: currentWeather.color,
            weatherCode: currentCode,
            forecast: forecast
        };
    } catch (error) {
        console.error('Error fetching weather:', error);
        // Retornar datos por defecto en caso de error
        return {
            temperature: '--',
            feelsLike: '--',
            humidity: 0,
            windSpeed: 0,
            windDirection: 0,
            condition: 'No disponible',
            icon: 'cloud',
            color: '#94A3B8',
            weatherCode: 0,
            forecast: []
        };
    }
}
