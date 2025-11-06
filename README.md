# Ollama Web Chat 🌟

Una interfaz web moderna y elegante para interactuar con modelos locales de Ollama, inspirada en Claude.

![Ollama Web Chat](https://img.shields.io/badge/Ollama-Web_Chat-blue?style=for-the-badge)
![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

## ✨ Características

### 🎨 Interfaz moderna
- **Diseño inspirado en Claude**: Interfaz elegante y minimalista con tema oscuro
- **Fondo animado**: Estrellas parpadeantes que crean un ambiente nocturno
- **Diseño responsivo**: Se adapta a diferentes tamaños de pantalla
- **Sidebar con gestión de conversaciones**: Crear, renombrar y eliminar conversaciones

### 💬 Chat avanzado
- **Streaming en tiempo real**: Respuestas carácter por carácter mientras el modelo genera
- **Múltiples conversaciones**: Gestiona varias conversaciones simultáneas
- **Persistencia local**: Todas las conversaciones se guardan en LocalStorage
- **Historial completo**: Navega entre conversaciones anteriores

### 🔧 Capacidades técnicas
- **Múltiples modelos**: Cambia entre diferentes modelos de Ollama
- **Renderizado Markdown**: Formato enriquecido con soporte para:
  - Encabezados (H1, H2, H3)
  - Negrita, cursiva
  - Código inline y bloques de código
  - Listas
  - Enlaces
- **Matemáticas con KaTeX**: Renderizado perfecto de fórmulas matemáticas
  - Inline: `$formula$`
  - Bloques: `$$formula$$`
  - Conversión automática de sintaxis común
- **Indicador de "pensamiento"**: Visualiza el razonamiento interno del modelo (compatible con modelos que lo soportan)

### ⚡ Usabilidad
- **Enter para enviar**: Presiona Enter para enviar, Shift+Enter para nueva línea
- **Textarea auto-expandible**: El campo de entrada crece automáticamente
- **Selector de modelo visual**: Interfaz elegante para cambiar de modelo

## 🚀 Instalación

### Requisitos previos
- [Node.js](https://nodejs.org/) (v14 o superior)
- [Ollama](https://ollama.ai/) instalado y ejecutándose localmente

### Pasos de instalación

1. **Clona el repositorio**:
```bash
git clone <url-del-repositorio>
cd ollama-web
```

2. **Instala las dependencias**:
```bash
npm install
```

3. **Inicia el servidor de desarrollo**:
```bash
npm run dev
```

4. **Abre tu navegador**:
```
http://localhost:5173
```

## 🎯 Uso

### Iniciar una conversación
1. Selecciona un modelo del menú desplegable
2. Escribe tu mensaje en el campo de entrada
3. Presiona Enter o haz clic en el botón de enviar (↑)

### Gestionar conversaciones
- **Nueva conversación**: Haz clic en "+ Nueva conversación" en el sidebar
- **Renombrar**: Haz clic en el icono ✎ en el encabezado del chat
- **Eliminar**: Haz clic en el icono 🗑 en el encabezado del chat
- **Cambiar de conversación**: Haz clic en cualquier conversación del sidebar

### Escribir matemáticas
- **Inline**: Usa `$tu_formula$` para fórmulas dentro del texto
- **Bloques**: Usa `$$tu_formula$$` para fórmulas centradas en su propia línea

Ejemplo:
```
La fórmula de Euler es $e^{i\pi} + 1 = 0$

La distancia euclidiana se calcula como:
$$d(x,y) = \sqrt{(x-a)^2 + (y-b)^2}$$
```

### Modelos con razonamiento
Algunos modelos soportan mostrar su proceso de pensamiento. Consulta [RAZONAMIENTO.md](RAZONAMIENTO.md) para más detalles.

## 🛠️ Tecnologías

- **[Vite](https://vitejs.dev/)**: Build tool y servidor de desarrollo ultrarrápido
- **[Ollama API](https://ollama.ai/)**: API local para modelos de lenguaje
- **[KaTeX](https://katex.org/)**: Renderizado de matemáticas LaTeX
- **Vanilla JavaScript**: Sin frameworks, puro y rápido
- **CSS moderno**: Animaciones, gradientes, y diseño responsivo

## 📁 Estructura del proyecto

```
ollama-web/
├── index.html          # Estructura HTML principal
├── styles.css          # Estilos y animaciones
├── app.js             # Lógica de la aplicación
├── package.json       # Dependencias y scripts
├── .gitignore         # Archivos a ignorar en Git
├── README.md          # Este archivo
└── RAZONAMIENTO.md    # Documentación sobre la característica de razonamiento
```

## 🎨 Personalización

### Cambiar colores
Edita las variables CSS en `styles.css`:
```css
body {
  --primary-color: #ff6b6b;
  --background-color: #2b2b2b;
  /* ... más variables ... */
}
```

### Agregar más estrellas
En `index.html`, dentro de `.starry-background`, agrega más elementos `<span class="star">`:
```html
<span class="star star-51">✦</span>
```

Luego en `styles.css`, define su posición y animación:
```css
.star-51 { 
  top: 50%; 
  left: 50%; 
  font-size: 14px; 
  animation-delay: 1s; 
  animation-duration: 4s; 
}
```

## 🔧 Configuración de Ollama

### Puerto personalizado
Si Ollama está en un puerto diferente al 11434, edita `app.js`:
```javascript
const API_BASE = 'http://localhost:TU_PUERTO/api';
```

### CORS
Si tienes problemas de CORS, asegúrate de que Ollama permita conexiones desde tu origen:
```bash
OLLAMA_ORIGINS=http://localhost:5173 ollama serve
```

## 🤝 Contribuciones

Las contribuciones son bienvenidas! Si encuentras un bug o tienes una idea para mejorar la aplicación:

1. Haz un fork del proyecto
2. Crea una rama para tu característica (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## 📝 Licencia

Este proyecto es de código abierto y está disponible bajo la [MIT License](LICENSE).

## 🙏 Agradecimientos

- Inspirado en la interfaz de [Claude](https://claude.ai/)
- Powered by [Ollama](https://ollama.ai/)
- Matemáticas renderizadas con [KaTeX](https://katex.org/)

## 📧 Contacto

¿Preguntas o sugerencias? Abre un issue en el repositorio.

---

Hecho con ❤️ y ✨ para la comunidad de Ollama

