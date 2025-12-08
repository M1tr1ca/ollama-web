class TranslationManager {
    constructor() {
        this.currentLang = 'es';
        // Traducciones de respaldo (ES) para estados offline/error
        this.translations = {
            'es': {
                "app.title": "Ollama Web",
                "sidebar.newConversation": "Nueva conversación",
                "sidebar.projects": "Proyectos",
                "sidebar.recent": "Recientes",
                "sidebar.settings": "Configuración",
                "sidebar.changeName": "Cambiar nombre",
                "sidebar.aiPersonalization": "Personalización de IA",
                "sidebar.memory": "Memoria",
                "sidebar.dashboard": "Dashboard de uso",
                "sidebar.backgroundPersonalization": "Personalizar fondo",
                "sidebar.themes": "Temas:",
                "sidebar.font": "Fuente:",
                "sidebar.fontNormal": "Normal",
                "sidebar.fontDyslexic": "Dislexia",
                "sidebar.noProjects": "No hay proyectos aún.",
                "sidebar.createProjectHint": "Crea uno para organizar tus chats",
                "modal.changeName.title": "Cambiar nombre",
                "modal.changeName.label": "Nuevo nombre:",
                "modal.changeName.placeholder": "Ingresa tu nombre",
                "modal.cancel": "Cancelar",
                "modal.save": "Guardar",
                "modal.aiPersonalization.title": "Personalización de IA",
                "modal.aiPersonalization.personalInfo": "Información personal",
                "modal.aiPersonalization.personalInfoPlaceholder": "Ej: Estudio ingeniería informática, trabajo como desarrollador...",
                "modal.aiPersonalization.responseStyle": "Estilo de respuesta",
                "style.normal": "Normal",
                "style.normalDesc": "Deja el modelo como está",
                "style.learning": "Aprendizaje",
                "style.learningDesc": "Paciente y educativo",
                "style.concise": "Conciso",
                "style.conciseDesc": "Respuestas cortas",
                "style.explanatory": "Explicativo",
                "style.explanatoryDesc": "Didáctico y claro",
                "style.formal": "Formal",
                "style.formalDesc": "Estructurado",
                "style.plan": "Plan",
                "style.planDesc": "Estratégico y detallado",
                "modal.background.title": "Personalizar fondo",
                "modal.background.auto": "Cambio automático diario",
                "modal.background.autoDesc": "El fondo cambiará automáticamente cada día a las 00:00",
                "modal.background.manual": "Seleccionar fondo manualmente",
                "modal.dashboard.title": "📊 Dashboard de Uso",
                "modal.dashboard.tabStats": "Estadísticas",
                "modal.dashboard.tabModels": "Modelos",
                "modal.dashboard.totalMessages": "Mensajes totales",
                "modal.dashboard.totalConversations": "Conversaciones",
                "modal.dashboard.estimatedTokens": "Tokens estimados",
                "modal.dashboard.avgResponseTime": "Tiempo promedio respuesta",
                "modal.dashboard.detailedUsage": "📈 Uso detallado",
                "modal.dashboard.userMessages": "Mensajes enviados (usuario)",
                "modal.dashboard.assistantMessages": "Respuestas recibidas (IA)",
                "modal.dashboard.charsSent": "Caracteres enviados",
                "modal.dashboard.charsReceived": "Caracteres recibidos",
                "modal.dashboard.filesAttached": "Archivos adjuntados",
                "modal.dashboard.projectsCreated": "Proyectos creados",
                "modal.dashboard.recentActivity": "📅 Actividad reciente (últimos 7 días)",
                "modal.dashboard.topModels": "🏆 Modelos más usados",
                "modal.dashboard.loadingModels": "Cargando información de modelos...",
                "modal.close": "Cerrar",
                "modal.memory.title": "🧠 Memoria",
                "modal.memory.active": "Memoria activa",
                "modal.memory.activeDesc": "La IA recordará información importante entre conversaciones",
                "modal.memory.add": "Añadir nuevo recuerdo",
                "modal.memory.addPlaceholder": "Ej: Estudio ingeniería informática...",
                "modal.memory.saved": "Recuerdos guardados",
                "modal.memory.clearAll": "Borrar todos",
                "modal.memory.empty": "No hay recuerdos guardados",
                "modal.memory.emptyHint": "Añade información que quieras que la IA recuerde sobre ti",
                "modal.settings.title": "Configuración",
                "modal.settings.themeLabel": "Selecciona un color de tema:",
                "modal.project.title": "Nuevo Proyecto",
                "modal.project.name": "Nombre del proyecto",
                "modal.project.namePlaceholder": "Ej: Desarrollo Web, Tesis, etc.",
                "modal.project.instructions": "Instrucciones personalizadas para la IA",
                "modal.project.instructionsPlaceholder": "Ej: Responde siempre en español técnico. Cuando expliques código, incluye comentarios detallados. Prioriza soluciones eficientes...",
                "modal.project.instructionsHint": "Estas instrucciones se enviarán a la IA en cada mensaje de este proyecto",
                "modal.project.files": "Archivos de contexto",
                "modal.project.dropzone": "Arrastra archivos aquí o haz clic para seleccionar",
                "modal.project.dropzoneHint": "Estos archivos se usarán como contexto en todas las conversaciones del proyecto",
                "modal.project.contextUsage": "Uso de contexto del modelo",
                "modal.project.selectModel": "Selecciona un modelo",
                "modal.project.tokensUsed": "tokens usados",
                "modal.project.instructionsTokens": "Instrucciones:",
                "modal.project.documentsTokens": "Documentos:",
                "modal.project.chatTokens": "Reserva para chat:",
                "modal.project.warningTitle": "Contexto excedido",
                "modal.project.warningMessage": "El contenido supera la capacidad del modelo. Considera usar un modelo con más contexto o reducir los archivos.",
                "modal.project.suggestedModels": "Modelos compatibles con tu contenido:",
                "modal.project.save": "Guardar proyecto",
                "modal.rename.title": "Renombrar conversación",
                "modal.rename.label": "Nuevo nombre:",
                "modal.rename.placeholder": "Nombre de la conversación",
                "modal.delete.title": "Eliminar conversación",
                "modal.delete.warning": "¿Estás seguro de que quieres eliminar esta conversación?",
                "modal.delete.confirm": "Eliminar",
                "modal.deleteAll.title": "Borrar todas las conversaciones",
                "modal.deleteAll.warning": "⚠️ ¿Estás seguro de que quieres eliminar <strong>todas</strong> las conversaciones?",
                "modal.deleteAll.hint": "Esta acción no se puede deshacer.",
                "modal.deleteAll.confirm": "Eliminar todas",
                "modal.deleteProject.title": "Eliminar proyecto",
                "modal.deleteProject.warning": "¿Estás seguro de que quieres eliminar este proyecto? Se eliminarán también todas las conversaciones asociadas.",
                "modal.editMessage.title": "Editar mensaje",
                "modal.editMessage.hint": "Edita tu mensaje. Al guardar, se regenerará la respuesta desde este punto.",
                "modal.editMessage.placeholder": "Escribe tu mensaje...",
                "modal.editMessage.save": "Guardar y regenerar",
                "greeting.title": "Buenas noches, <span class=\"user-name\">{name}</span>",
                "greeting.morning": "Buenos días, <span class=\"user-name\">{name}</span>",
                "greeting.afternoon": "Buenas tardes, <span class=\"user-name\">{name}</span>",
                "greeting.evening": "Buenas noches, <span class=\"user-name\">{name}</span>",
                "greeting.subtitle": "¿Cómo puedo ayudarle hoy?",
                "chat.dropzone": "Arrastra archivos aquí o haz clic para seleccionar",
                "chat.placeholder": "¿Cómo puedo ayudarle hoy?",
                "chat.newConversation": "Nueva conversación",
                "chat.attachments": "Archivos adjuntos",
                "error.fileTooLarge": "El archivo {name} es demasiado grande ({size}). El tamaño máximo es {maxSize}.",
                "error.pdfTooManyPages": "El PDF {name} tiene demasiadas páginas ({pages}). El máximo permitido es {maxPages} páginas.",
                "error.fileReadError": "Error al leer el archivo {name}: {error}",
                "error.genericFileTooLarge": "El archivo {name} es demasiado grande. El tamaño máximo es 50MB.",
                "confirm.clearMemories": "¿Estás seguro de que quieres borrar todos los recuerdos?",
                "chat.user": "Tú",
                "chat.copied": "Copiado!",
                "chat.copy": "Copiar",
                "chat.regenerate": "Regenerar respuesta",
                "chat.edit": "Editar mensaje",
                "time.seconds": "Actualizado hace unos segundos",
                "time.minutes": "Actualizado hace {minutes} min",
                "time.hours": "Actualizado hace {hours} h",
                "time.date": "Actualizado {date} {time}",
                "empty.noConversations": "No hay conversaciones todavía",
                "empty.noMessages": "Sin mensajes aún",
                "theme.orange": "Naranja",
                "theme.green": "Verde Oscuro",
                "theme.purple": "Morado",
                "theme.pink": "Rojo Cereza",
                "theme.cyan": "Azul Cielo",
                "theme.navy": "Azul Marino",
                "theme.petroleum": "Azul Petróleo",
                "theme.custom": "Color personalizado",
                "screenOverlay.title": "Chat con Captura",
                "screenOverlay.capture": "Capturar pantalla (Ctrl+Shift+S)",
                "screenOverlay.popout": "Abrir en ventana flotante (siempre visible)",
                "screenOverlay.minimize": "Minimizar",
                "screenOverlay.close": "Cerrar modo overlay",
                "screenOverlay.currentCapture": "Captura actual:",
                "screenOverlay.screenshotAlt": "Captura de pantalla",
                "screenOverlay.clearCapture": "Eliminar captura",
                "screenOverlay.placeholder": "Captura tu pantalla y pregunta sobre lo que ves",
                "screenOverlay.hint": "Presiona el botón de cámara o Ctrl+Shift+S para capturar",
                "screenOverlay.inputPlaceholder": "Pregunta sobre lo que ves...",
                "screenOverlay.send": "Enviar",
                "screenOverlay.restore": "Restaurar chat"
            }
        };
        this.observers = [];
        this.loadedLanguages = new Set(['es']);
    }

    async init() {
        // Cargar idioma guardado en localStorage si está disponible
        const savedLang = localStorage.getItem('ollama-web-lang');
        if (savedLang) {
            this.currentLang = savedLang;
        }

        // Cargar idioma por defecto (es)
        await this.loadLanguage('es');

        // Si el idioma actual es diferente, cargarlo también
        if (this.currentLang !== 'es') {
            await this.loadLanguage(this.currentLang);
        }

        this.applyTranslations();
    }

    async loadLanguage(lang) {
        if (this.translations[lang]) return;

        try {
            const response = await fetch(`/translations/${lang}.json`);
            if (!response.ok) throw new Error(`Failed to load language: ${lang}`);
            const data = await response.json();
            this.translations[lang] = data;
            this.loadedLanguages.add(lang);
        } catch (error) {
            console.error('Error al cargar la traducción:', error);
            // Si el idioma no es español, cargar español como respaldo
            if (lang !== 'es') {
                this.currentLang = 'es';
                await this.loadLanguage('es');
            }
        }
    }

    async setLanguage(lang) {
        if (this.currentLang === lang) return;

        await this.loadLanguage(lang);
        this.currentLang = lang;
        localStorage.setItem('ollama-web-lang', lang);
        this.applyTranslations();
        this.notifyObservers();
    }

    translate(key, params = {}) {
        // Asegurar que el objeto de traducción existe
        const langData = (this.translations && this.translations[this.currentLang])
            ? this.translations[this.currentLang]
            : (this.translations && this.translations['es']) ? this.translations['es'] : {};

        let text = langData[key] || key;

        // Reemplazar parámetros
        Object.keys(params).forEach(param => {
            text = text.replace(`{${param}}`, params[param]);
        });

        return text;
    }

    applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translated = this.translate(key);

            // Manejar diferentes tipos de elementos
            if (element.tagName === 'INPUT' && element.getAttribute('placeholder')) {
                element.placeholder = translated;
            } else if (element.tagName === 'TEXTAREA' && element.getAttribute('placeholder')) {
                element.placeholder = translated;
            } else if (element.title && element.getAttribute('data-i18n-title')) {
                // Si específicamente se está apuntando al título
                element.title = translated;
            } else {
                // Preservar iconos/estructura en elementos complejos
                const target = element.getAttribute('data-i18n-target');
                if (target === 'title') {
                    element.title = translated;
                    // Si específicamente se está apuntando al placeholder
                } else if (target === 'placeholder') {
                    element.placeholder = translated;
                } else {
                    const icon = element.querySelector('svg, .icon, .menu-icon');
                    if (icon && element.childNodes.length > 1) {
                        // Si tiene un icono
                        const textSpan = element.querySelector('span:not(.icon):not(.menu-icon)');
                        if (textSpan) {
                            textSpan.textContent = translated;
                        } else {
                            element.textContent = translated;
                        }
                    } else {
                        element.innerHTML = translated;
                    }
                }
            }
        });

        // Actualizar atributo lang del HTML
        document.documentElement.lang = this.currentLang;
    }

    subscribe(callback) {
        this.observers.push(callback);
    }

    notifyObservers() {
        this.observers.forEach(cb => cb(this.currentLang));
    }
}

// Exportar instancia
window.translationManager = new TranslationManager();
