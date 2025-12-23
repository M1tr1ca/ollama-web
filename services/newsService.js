// ===========================
// News Service
// Obtener y procesar noticias con GNews.io API
// ===========================

import { saveNewsCache, getNewsCache, clearNewsCache } from './cacheService.js';

const GNEWS_BASE_URL = 'https://gnews.io/api/v4';

// Noticias de demostración para cuando no hay API key
const DEMO_NEWS = [
    {
        id: 'demo-1',
        title: 'Google aprovecha el monopolio de búsqueda para dominar la carrera de IA, advierte el CEO de OpenAI',
        description: 'Los rastreadores de IA de Google acceden a mucho más contenido web que sus rivales al combinar sistemas de búsqueda e IA, obligando a los editores a elegir entre visibilidad y protección de contenido.',
        url: 'https://elpais.com/tecnologia/',
        imageUrl: 'https://images.unsplash.com/photo-1573804633927-bfcbcd909acd?w=800&h=450&fit=crop',
        source: 'El País',
        publishedAt: new Date().toISOString(),
        category: 'tecnología',
        timeAgo: 'hace 2 horas',
        sources: 56
    },
    {
        id: 'demo-2',
        title: 'Los conservadores ganan en Extremadura, asestando un golpe a Sánchez',
        description: 'El Partido Popular obtiene mayoría absoluta en las elecciones regionales, marcando un cambio significativo en el mapa político español.',
        url: 'https://www.elmundo.es/espana/',
        imageUrl: 'https://images.unsplash.com/photo-1541872703-74c5e44368f9?w=600&h=400&fit=crop',
        source: 'El Mundo',
        publishedAt: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
        category: 'política',
        timeAgo: 'hace 1 hora',
        sources: 71
    },
    {
        id: 'demo-3',
        title: 'Rutte advierte que un conflicto entre China y Taiwán podría desencadenar agresión rusa en Europa',
        description: 'El secretario general de la OTAN alerta sobre las consecuencias globales de una posible escalada militar en el Estrecho de Taiwán.',
        url: 'https://www.reuters.com/world/',
        imageUrl: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=600&h=400&fit=crop',
        source: 'Reuters',
        publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        category: 'internacional',
        timeAgo: 'hace 2 horas',
        sources: 74
    },
    {
        id: 'demo-4',
        title: 'La visión de IA de Larry Page de 2000 hecha realidad en Gemini 3 de Google',
        description: 'La nueva versión de Gemini materializa las predicciones del cofundador de Google sobre asistentes inteligentes capaces de entender contexto y anticipar necesidades.',
        url: 'https://www.theverge.com/ai-artificial-intelligence',
        imageUrl: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?w=600&h=400&fit=crop',
        source: 'The Verge',
        publishedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        category: 'tecnología',
        timeAgo: 'hace 3 horas',
        sources: 57
    },
    {
        id: 'demo-5',
        title: 'Un tablero de ajedrez robótico establece récord mundial al combinar madera con tecnología',
        description: 'El dispositivo integra inteligencia artificial para mover piezas automáticamente mientras el jugador se enfrenta a oponentes de todo el mundo.',
        url: 'https://techcrunch.com/',
        imageUrl: 'https://images.unsplash.com/photo-1529699211952-734e80c4d42b?w=600&h=400&fit=crop',
        source: 'TechCrunch',
        publishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
        category: 'tecnología',
        timeAgo: 'hace 4 horas',
        sources: 23
    },
    {
        id: 'demo-6',
        title: 'El mercado de criptomonedas experimenta volatilidad récord tras nuevas regulaciones',
        description: 'Bitcoin y Ethereum registran fluctuaciones significativas mientras los inversores evalúan el impacto de las nuevas normativas en Estados Unidos y Europa.',
        url: 'https://www.bloomberg.com/markets',
        imageUrl: 'https://images.unsplash.com/photo-1621761191319-c6fb62004040?w=600&h=400&fit=crop',
        source: 'Bloomberg',
        publishedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        category: 'economía',
        timeAgo: 'hace 5 horas',
        sources: 89
    },
    {
        id: 'demo-7',
        title: 'Nuevos avances en energía de fusión nuclear prometen revolucionar el sector energético',
        description: 'Científicos del MIT logran mantener plasma a temperaturas récord durante más tiempo, acercando la viabilidad comercial de la fusión.',
        url: 'https://www.nature.com/news',
        imageUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=600&h=400&fit=crop',
        source: 'Nature',
        publishedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
        category: 'ciencia',
        timeAgo: 'hace 6 horas',
        sources: 34
    },
    {
        id: 'demo-8',
        title: 'El Real Madrid ficha a la joven promesa brasileña por 80 millones de euros',
        description: 'El club blanco cierra el fichaje más caro de la temporada al hacerse con los servicios del delantero de 19 años considerado el futuro del fútbol.',
        url: 'https://www.marca.com/',
        imageUrl: 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=600&h=400&fit=crop',
        source: 'Marca',
        publishedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
        category: 'deportes',
        timeAgo: 'hace 7 horas',
        sources: 45
    },
    {
        id: 'demo-9',
        title: 'Descubren nuevo tratamiento que reduce tumores cancerígenos en un 60%',
        description: 'Investigadores españoles desarrollan una terapia innovadora que combina inmunoterapia con nanotecnología, mostrando resultados prometedores en ensayos clínicos.',
        url: 'https://www.abc.es/salud/',
        imageUrl: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=600&h=400&fit=crop',
        source: 'ABC Salud',
        publishedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
        category: 'salud',
        timeAgo: 'hace 8 horas',
        sources: 62
    },
    {
        id: 'demo-10',
        title: 'La Bolsa española cierra con ganancias del 2,3% impulsada por el sector tecnológico',
        description: 'El Ibex 35 registra su mejor jornada del mes con subidas generalizadas en todos los sectores, destacando las empresas de telecomunicaciones.',
        url: 'https://cincodias.elpais.com/',
        imageUrl: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&h=400&fit=crop',
        source: 'Cinco Días',
        publishedAt: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(),
        category: 'economía',
        timeAgo: 'hace 9 horas',
        sources: 38
    },
    {
        id: 'demo-11',
        title: 'España lanza ambicioso plan de transición energética con inversión de 50.000 millones',
        description: 'El gobierno presenta una estrategia integral para alcanzar la neutralidad de carbono en 2050, priorizando energías renovables y movilidad sostenible.',
        url: 'https://www.lavanguardia.com/natural/',
        imageUrl: 'https://images.unsplash.com/photo-1466611653911-95081537e5b7?w=600&h=400&fit=crop',
        source: 'La Vanguardia',
        publishedAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(),
        category: 'medio ambiente',
        timeAgo: 'hace 10 horas',
        sources: 52
    },
    {
        id: 'demo-12',
        title: 'Netflix anuncia nueva serie española que ya bate récords de anticipación',
        description: 'La plataforma revela detalles de su próxima producción original ambientada en Madrid, con un reparto estelar y presupuesto millonario.',
        url: 'https://www.sensacine.com/',
        imageUrl: 'https://images.unsplash.com/photo-1574267432644-f610a4ab9e11?w=600&h=400&fit=crop',
        source: 'SensaCine',
        publishedAt: new Date(Date.now() - 11 * 60 * 60 * 1000).toISOString(),
        category: 'entretenimiento',
        timeAgo: 'hace 11 horas',
        sources: 28
    },
    {
        id: 'demo-13',
        title: 'Telescopio James Webb detecta señales de vida potencial en exoplaneta cercano',
        description: 'Los científicos identifican biomarcadores en la atmósfera de un planeta a 120 años luz, marcando un hito en la búsqueda de vida extraterrestre.',
        url: 'https://www.space.com/',
        imageUrl: 'https://images.unsplash.com/photo-1614730321146-b6fa6a46bcb4?w=600&h=400&fit=crop',
        source: 'Space.com',
        publishedAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
        category: 'ciencia',
        timeAgo: 'hace 12 horas',
        sources: 91
    },
    {
        id: 'demo-14',
        title: 'Apple presenta iPhone 16 con revolucionaria batería de grafeno',
        description: 'La nueva generación del smartphone estrella promete 5 días de autonomía y carga completa en 15 minutos gracias a la innovadora tecnología.',
        url: 'https://www.apple.com/',
        imageUrl: 'https://images.unsplash.com/photo-1592286927505-b0c2e0e0c5b6?w=600&h=400&fit=crop',
        source: 'Apple Newsroom',
        publishedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(),
        category: 'tecnología',
        timeAgo: 'hace 13 horas',
        sources: 103
    },
    {
        id: 'demo-15',
        title: 'La inflación en la zona euro desciende al 2,1%, su nivel más bajo en tres años',
        description: 'Los datos del BCE muestran una moderación sostenida de los precios, abriendo la puerta a posibles recortes de tipos de interés.',
        url: 'https://www.ecb.europa.eu/',
        imageUrl: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=600&h=400&fit=crop',
        source: 'BCE',
        publishedAt: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString(),
        category: 'economía',
        timeAgo: 'hace 14 horas',
        sources: 67
    }
];

/**
 * Obtener noticias (desde caché, GNews.io API, o demo)
 * @param {Object} location - {lat, lon, city, country}
 * @param {string} category - Categoría (general, technology, business)
 * @param {boolean} forceRefresh - Si true, ignora el caché y obtiene noticias nuevas
 * @returns {Promise<Array>}
 */
export async function fetchNews(location = null, category = 'general', forceRefresh = false) {
    // Si se fuerza actualización, limpiar caché primero
    if (forceRefresh) {
        console.log('📰 Force refresh requested, clearing cache...');
        clearNewsCache();
    } else {
        // Verificar caché solo si no se fuerza actualización
        const cached = getNewsCache();
        if (cached && cached.length > 0) {
            console.log('📰 Using cached news');
            return cached;
        }
    }

    // Si no hay API key, usar noticias demo
    const apiKey = getGNewsApiKey();
    if (!apiKey) {
        console.log('📰 No GNews API key, using demo news');
        saveNewsCache(DEMO_NEWS);
        return DEMO_NEWS;
    }

    console.log('📰 API Key found:', apiKey.substring(0, 8) + '...');

    // Buscar con GNews.io
    try {
        // Mapear categorías al formato de GNews
        const gnewsCategory = mapCategoryToGNews(category);

        // Construir URL con parámetros - Noticias globales en inglés (medios americanos)
        const params = new URLSearchParams({
            apikey: apiKey,
            lang: 'en',
            max: '20'
        });

        // Usar endpoint de top-headlines o search según la categoría
        let url;
        if (gnewsCategory && gnewsCategory !== 'general') {
            params.append('category', gnewsCategory);
            url = `${GNEWS_BASE_URL}/top-headlines?${params.toString()}`;
        } else {
            // Sin restricción de ubicación - noticias globales
            url = `${GNEWS_BASE_URL}/top-headlines?${params.toString()}`;
        }

        console.log('📰 GNews URL:', url.replace(apiKey, '***'));

        const response = await fetch(url);

        console.log('📰 GNews response status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('📰 GNews API error:', errorText);
            throw new Error('GNews API request failed: ' + response.status);
        }

        const data = await response.json();
        console.log('📰 GNews raw response:', data);

        const newsItems = data.articles || [];
        console.log('📰 News items received:', newsItems.length);

        if (newsItems.length === 0) {
            console.log('📰 No news from GNews, using demo news');
            return DEMO_NEWS;
        }

        const news = parseGNewsArticles(newsItems);

        if (news.length > 0) {
            saveNewsCache(news);
        }

        return news;
    } catch (error) {
        console.error('📰 Error fetching news from GNews:', error);
        // Fallback a noticias demo
        return DEMO_NEWS;
    }
}

/**
 * Mapear categorías internas al formato de GNews.io
 * Categorías válidas de GNews: general, world, nation, business, technology, entertainment, sports, science, health
 * @param {string} category 
 * @returns {string}
 */
function mapCategoryToGNews(category) {
    const categoryMap = {
        'general': 'general',
        'technology': 'technology',
        'tecnología': 'technology',
        'business': 'business',
        'economía': 'business',
        'economia': 'business',
        'sports': 'sports',
        'deportes': 'sports',
        'science': 'science',
        'ciencia': 'science',
        'health': 'health',
        'salud': 'health',
        'entertainment': 'entertainment',
        'entretenimiento': 'entertainment',
        'world': 'world',
        'internacional': 'world',
        'nation': 'nation',
        'política': 'nation',
        'politica': 'nation'
    };
    return categoryMap[category?.toLowerCase()] || 'general';
}

/**
 * Parsear respuesta de GNews.io a formato interno
 * @param {Array} articles 
 * @returns {Array}
 */
function parseGNewsArticles(articles) {
    return articles.map((item, index) => ({
        id: `news-${Date.now()}-${index}`,
        title: item.title || 'Sin título',
        description: item.description || '',
        url: item.url || '#',
        imageUrl: item.image || getPlaceholderImage(index),
        source: item.source?.name || 'Fuente desconocida',
        publishedAt: item.publishedAt || new Date().toISOString(),
        category: detectCategory(item.title + ' ' + (item.description || '')),
        timeAgo: formatTimeAgo(item.publishedAt),
        content: item.content || '' // GNews incluye contenido parcial
    }));
}

/**
 * Detectar categoría de noticia basada en contenido
 * @param {string} text 
 * @returns {string}
 */
function detectCategory(text) {
    const lowerText = text.toLowerCase();

    if (/tecnolog|ia\s|software|hardware|startup|app|digital|robot|intel|microsoft|google|apple|amazon/.test(lowerText)) {
        return 'tecnología';
    }
    if (/economía|mercado|bolsa|acciones|bitcoin|cripto|inversión|banco|finanz/.test(lowerText)) {
        return 'economía';
    }
    if (/polític|gobierno|president|ministro|elecciones|congreso|parlamento/.test(lowerText)) {
        return 'política';
    }
    if (/ciencia|científico|estudio|investigación|universidad|espacio|nasa/.test(lowerText)) {
        return 'ciencia';
    }
    if (/deport|fútbol|basket|tenis|olimpi|mundial|liga|champions/.test(lowerText)) {
        return 'deportes';
    }
    if (/salud|médico|hospital|enfermedad|tratamiento|vacuna|covid/.test(lowerText)) {
        return 'salud';
    }

    return 'general';
}

/**
 * Formatear fecha relativa
 * @param {string} dateStr 
 * @returns {string}
 */
function formatTimeAgo(dateStr) {
    if (!dateStr) return 'recientemente';

    try {
        const date = new Date(dateStr);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 60) {
            return `hace ${diffMins} min`;
        } else if (diffHours < 24) {
            return `hace ${diffHours}h`;
        } else if (diffDays < 7) {
            return `hace ${diffDays}d`;
        } else {
            return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
        }
    } catch {
        return 'recientemente';
    }
}

/**
 * Obtener imagen placeholder
 * @param {number} index 
 * @returns {string}
 */
function getPlaceholderImage(index) {
    const placeholders = [
        'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=400&h=250&fit=crop',
        'https://images.unsplash.com/photo-1495020689067-958852a7765e?w=400&h=250&fit=crop',
        'https://images.unsplash.com/photo-1586339949916-3e9457bef6d3?w=400&h=250&fit=crop',
        'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=400&h=250&fit=crop',
        'https://images.unsplash.com/photo-1523995462485-3d171b5c8fa9?w=400&h=250&fit=crop'
    ];
    return placeholders[index % placeholders.length];
}

/**
 * Obtener API key de GNews.io
 * @returns {string|null}
 */
function getGNewsApiKey() {
    // Leer desde localStorage
    const stored = localStorage.getItem('gnews-api-key');
    if (stored) return stored;

    // Intentar desde variable de entorno (si usa Vite)
    if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GNEWS_API_KEY) {
        return import.meta.env.VITE_GNEWS_API_KEY;
    }

    return null;
}

/**
 * Configurar API key de GNews.io
 * @param {string} apiKey 
 */
export function setGNewsApiKey(apiKey) {
    localStorage.setItem('gnews-api-key', apiKey);
}

/**
 * Limpiar API key de GNews.io
 */
export function clearGNewsApiKey() {
    localStorage.removeItem('gnews-api-key');
}
