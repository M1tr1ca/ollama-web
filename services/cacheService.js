// ===========================
// Cache Service
// Sistema de caché para noticias con expiración
// ===========================

const NEWS_CACHE_KEY = 'ollama-web-news-cache';
const CACHE_EXPIRY_HOURS = 24;

/**
 * Guardar noticias en caché
 * @param {Array} news - Array de noticias
 */
export function saveNewsCache(news) {
    try {
        const cacheData = {
            data: news,
            cachedAt: Date.now(),
            expiresAt: getNextMidnight()
        };
        localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify(cacheData));
    } catch (error) {
        console.error('Error saving news cache:', error);
    }
}

/**
 * Obtener noticias del caché
 * @returns {Array|null} - Noticias o null si no hay caché válido
 */
export function getNewsCache() {
    try {
        const cached = localStorage.getItem(NEWS_CACHE_KEY);
        if (!cached) return null;

        const cacheData = JSON.parse(cached);

        // Verificar si expiró (a las 00:00 o después de 24h)
        if (Date.now() > cacheData.expiresAt) {
            clearNewsCache();
            return null;
        }

        // Verificar si hay URLs antiguas de example.com o Google News search y limpiar caché
        if (cacheData.data && cacheData.data.length > 0) {
            const hasOldUrls = cacheData.data.some(item =>
                item.url && (item.url.includes('example.com') || item.url.includes('news.google.com/search'))
            );
            if (hasOldUrls) {
                console.log('📰 Clearing outdated news cache with old URLs');
                clearNewsCache();
                return null;
            }
        }

        return cacheData.data;
    } catch (error) {
        console.error('Error reading news cache:', error);
        return null;
    }
}

/**
 * Limpiar caché de noticias
 */
export function clearNewsCache() {
    localStorage.removeItem(NEWS_CACHE_KEY);
}

/**
 * Verificar si hay caché válido
 * @returns {boolean}
 */
export function hasValidCache() {
    return getNewsCache() !== null;
}

/**
 * Obtener timestamp de la próxima medianoche (00:00)
 * @returns {number}
 */
function getNextMidnight() {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setDate(midnight.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    return midnight.getTime();
}

/**
 * Obtener información del caché
 * @returns {{cachedAt: Date, expiresAt: Date}|null}
 */
export function getCacheInfo() {
    try {
        const cached = localStorage.getItem(NEWS_CACHE_KEY);
        if (!cached) return null;

        const cacheData = JSON.parse(cached);
        return {
            cachedAt: new Date(cacheData.cachedAt),
            expiresAt: new Date(cacheData.expiresAt),
            newsCount: cacheData.data?.length || 0
        };
    } catch (error) {
        return null;
    }
}
